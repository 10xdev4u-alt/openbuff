/**
 * Pure tree-scan contract for the publish stage's bundled closure (#96, #97).
 *
 * `bundleDependencies: ["@codebuff/sdk"]` ships the SDK's entire resolved
 * closure PHYSICALLY inside the tarball, which means the security pins must
 * hold for every manifest in the staged tree — not just the root-level
 * copies. A future nested `@ai-sdk/anthropic@2.0.50` or a vulnerable-range
 * `undici` copy must fail staging before it can ever reach npm.
 *
 * Scope rules (per the #97 security review):
 * - every `@ai-sdk/anthropic` copy must be exactly the pinned clean version —
 *   it exists in the tree only because of the vulnerable chain;
 * - an `undici` copy is only in security scope when a resolving manifest
 *   selects it via the vulnerable range; unrelated undici versions pass.
 *
 * @module install-security
 */
// @effect-diagnostics nodeBuiltinImport:off - walks the real staged tree on disk.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

/** Mirrors NPM_PACKAGE_NAME in apps/server/src/packageName.ts — kept literal so
 * this composite script project does not pull server sources into its program.
 * If the package identity ever changes, update both. */
export const NPM_PACKAGE_NAME = "@princetheprogrammerbtw/openbuff";

/** @codebuff/sdk exact-pins `@ai-sdk/anthropic@2.0.50` (4 LOW advisories via
 * `@ai-sdk/provider-utils@3.0.18`); 2.0.102 pulls the patched provider-utils.
 * The bundle ships pre-resolved, so this is the ONLY anthropic version
 * allowed anywhere in the staged tree. */
export const REQUIRED_ANTHROPIC_VERSION = "2.0.102";

/** The bundled closure's `ai`/`@ai-sdk/gateway` chain exact-pins
 * `@ai-sdk/provider-utils@3.0.37`, which declares `undici ^5.29.0`
 * (12 advisories, HIGH). The override forces the patched 6.28.1; the bundle
 * ships it pre-resolved. */
export const REQUIRED_UNDICI_VERSION = "6.28.1";

/** The vulnerable manifest range the override targets — only undici copies
 * selected by this range are in security scope. */
export const VULNERABLE_UNDICI_RANGE = "^5.29.0";

export interface Violation {
  readonly packageJsonPath: string;
  readonly packageName: string;
  readonly violation: string;
}

const DEPENDENCY_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies"] as const;

/** Does the given manifest range select the vulnerable undici scope? */
export const undiciVulnerable = (range: unknown): boolean =>
  typeof range === "string" && range.trim() === VULNERABLE_UNDICI_RANGE;

const parseManifest = (manifestPath: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(NodeFS.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const manifestName = (manifest: Record<string, unknown>, fallback: string): string =>
  typeof manifest["name"] === "string" ? manifest["name"] : fallback;

const versionOf = (manifest: Record<string, unknown>): string =>
  typeof manifest["version"] === "string" ? manifest["version"] : "<missing>";

/** Manifests that can select the package at `manifestRelPath` via npm's
 * resolution walk-up: the package directly above the node_modules scope, and
 * every sibling package inside that same scope (they resolve their own
 * node_modules first, then the scope). Deeper nests cannot. */
const collectDependents = (
  stageDir: string,
  manifestRelPath: string,
): Array<{ readonly name: string; readonly range: string }> => {
  const pkgDir = NodePath.join(stageDir, NodePath.dirname(manifestRelPath));
  const nmScope = NodePath.dirname(pkgDir);
  const scopeParent = NodePath.dirname(nmScope);
  const dependents: Array<{ name: string; range: string }> = [];

  const collectRanges = (manifest: Record<string, unknown>, name: string, target: string): void => {
    for (const field of DEPENDENCY_FIELDS) {
      const deps = manifest[field];
      if (
        deps !== null &&
        typeof deps === "object" &&
        target in (deps as Record<string, unknown>)
      ) {
        const range = (deps as Record<string, unknown>)[target];
        if (typeof range === "string") {
          dependents.push({ name, range });
        }
      }
    }
  };

  // The package directly above the scope (stage root for top-level copies,
  // the SDK for copies nested in its closure).
  const parentManifestPath = NodePath.join(scopeParent, "package.json");
  if (NodeFS.existsSync(parentManifestPath)) {
    const manifest = parseManifest(parentManifestPath);
    if (manifest !== null) {
      collectRanges(manifest, manifestName(manifest, "<unnamed>"), "undici");
    }
  }
  // Siblings inside the same node_modules scope (depth 1–2, not nests).
  if (NodeFS.existsSync(nmScope)) {
    for (const entry of NodeFS.readdirSync(nmScope, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const scoped = entry.name.startsWith("@");
      const candidates = scoped
        ? NodeFS.readdirSync(NodePath.join(nmScope, entry.name), { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => NodePath.join(entry.name, e.name))
        : [entry.name];
      for (const name of candidates) {
        const manifest = parseManifest(NodePath.join(nmScope, name, "package.json"));
        if (manifest !== null) {
          collectRanges(manifest, manifestName(manifest, name), "undici");
        }
      }
    }
  }
  return dependents;
};

/**
 * Scan every package manifest inside any `node_modules` of the staged tree
 * and return the security-contract violations. Empty array = clean.
 */
export const scanStagedTree = (stageDir: string): Array<Violation> => {
  const violations: Array<Violation> = [];
  for (const rel of NodeFS.readdirSync(stageDir, { recursive: true })) {
    const relPath = rel.toString();
    if (NodePath.basename(relPath) !== "package.json") {
      continue;
    }
    if (!relPath.split(/[\\/]/).includes("node_modules")) {
      continue; // the staged root manifest is validated elsewhere; only shipped copies count
    }
    const absPath = NodePath.join(stageDir, relPath);
    const manifest = parseManifest(absPath);
    if (manifest === null) {
      violations.push({
        packageJsonPath: relPath,
        packageName: relPath,
        violation: "manifest is not valid JSON",
      });
      continue;
    }
    const name = manifestName(manifest, NodePath.basename(NodePath.dirname(absPath)));
    const version = versionOf(manifest);
    if (name === "@ai-sdk/anthropic" && version !== REQUIRED_ANTHROPIC_VERSION) {
      violations.push({
        packageJsonPath: relPath,
        packageName: name,
        violation: `@ai-sdk/anthropic@${version} != pinned ${REQUIRED_ANTHROPIC_VERSION}`,
      });
    } else if (name === "undici" && version !== REQUIRED_UNDICI_VERSION) {
      const dependents = collectDependents(stageDir, relPath);
      const vulnerableSelectors = dependents.filter((d) => undiciVulnerable(d.range));
      if (vulnerableSelectors.length > 0) {
        violations.push({
          packageJsonPath: relPath,
          packageName: name,
          violation: `undici@${version} selected for the vulnerable ${VULNERABLE_UNDICI_RANGE} range != pinned ${REQUIRED_UNDICI_VERSION}; selected by: ${vulnerableSelectors.map((d) => `${d.name}@${d.range}`).join(", ")}`,
        });
      }
    }
  }
  return violations;
};

/**
 * The tree must CONTAIN the pinned clean undici: the vulnerable selection
 * originates in the bundled closure, so the 6.28.1 copy shipping somewhere in
 * the tree is the positive proof the override resolution held. Existence is
 * checked separately from the scan so a missing pin fails even when no
 * vulnerable copy remains (e.g. the closure dropped the dependency entirely).
 */
export const hasPinnedUndici = (stageDir: string): boolean => {
  for (const rel of NodeFS.readdirSync(stageDir, { recursive: true })) {
    const relPath = rel.toString();
    if (
      NodePath.basename(relPath) !== "package.json" ||
      !relPath.split(/[\\/]/).includes("node_modules")
    ) {
      continue;
    }
    const manifest = parseManifest(NodePath.join(stageDir, relPath));
    if (
      manifest !== null &&
      manifestName(manifest, "") === "undici" &&
      versionOf(manifest) === REQUIRED_UNDICI_VERSION
    ) {
      return true;
    }
  }
  return false;
};
