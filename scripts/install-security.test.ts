// @effect-diagnostics nodeBuiltinImport:off - reads the real repo manifests.
import * as NodeFS from "node:fs";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";
import * as Yaml from "yaml";

import { assert, describe, it } from "@effect/vitest";

import { hasPinnedUndici, NPM_PACKAGE_NAME, scanStagedTree } from "./install-security.ts";

const readServerManifest = (): Record<string, unknown> =>
  JSON.parse(
    NodeFS.readFileSync(
      NodePath.join(import.meta.dirname, "..", "apps", "server", "package.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;

/**
 * Install-security contract (#96).
 *
 * The published artifact must install clean under npm's script gating and
 * npm's advisory database. These pins are load-bearing: `node-pty`'s 1.1.0
 * tarball ships Linux prebuilds only via an install script (blocked by
 * default → fatal boot), and the `ai`/`gateway` chain pins vulnerable
 * `undici@5.29.0` / `@ai-sdk/provider-utils` copies that only overrides can
 * reach. If you touch any of these, re-prove the fresh-install audit = 0.
 */
describe("install security contract", () => {
  it("pins node-pty to the prebuild-bundled beta (no install script needed)", () => {
    const manifest = readServerManifest();
    const dependencies = manifest["dependencies"] as Record<string, string>;
    assert.strictEqual(
      dependencies["node-pty"],
      "1.2.0-beta.15",
      "node-pty must stay exactly on the beta whose tarball ships prebuilds/linux-*",
    );
  });

  it("overrides the vulnerable nested undici copies", () => {
    const manifest = readServerManifest();
    const overrides = manifest["overrides"] as Record<string, string>;
    assert.strictEqual(
      overrides["undici@^5.29.0"],
      "6.28.1",
      "ai@5/gateway@2 pin undici ^5.29.0 (12 advisories); the override forces the patched 6.28.1",
    );
  });

  it("overrides the vulnerable nested provider-utils chain", () => {
    const manifest = readServerManifest();
    const overrides = manifest["overrides"] as Record<string, string>;
    assert.strictEqual(
      overrides["@ai-sdk/anthropic"],
      "2.0.102",
      "anthropic@2.0.50 pins provider-utils 3.0.18 (vulnerable); 2.0.102 depends on 3.0.28 (patched)",
    );
  });

  it("bundles the sdk so its exact-pinned vulnerable subtree ships pre-resolved", () => {
    const manifest = readServerManifest();
    const bundled = manifest["bundleDependencies"] as string[];
    assert.ok(
      bundled.includes("@codebuff/sdk"),
      "npm 12 removed shrinkwrap and ignores dep-position overrides; @codebuff/sdk exact-pins anthropic@2.0.50/ai→undici@^5.29.0 — only a physical bundle ships the pinned clean closure",
    );
  });

  it("stays the scoped npm identity", () => {
    const manifest = readServerManifest();
    assert.strictEqual(manifest["name"], NPM_PACKAGE_NAME);
  });
});

/**
 * Dev-toolchain advisory pins (#99).
 *
 * The published artifact is clean (audited in #96/#97), but the dev
 * workspace carries 25 advisories (1 critical, 19 high, 5 moderate —
 * 2026-09-22 census). These overrides force every vulnerable nested copy to
 * its minimum patched release. Each pin was verified to exist on the
 * registry before landing; do not bump them casually — re-run
 * `pnpm audit` and this suite after any change.
 */
describe("dev-toolchain advisory pins (#99)", () => {
  const workspace = (): Record<string, unknown> =>
    Yaml.parse(
      NodeFS.readFileSync(NodePath.join(import.meta.dirname, "..", "pnpm-workspace.yaml"), "utf8"),
    ) as Record<string, unknown>;

  const readOverrides = (): Record<string, string> => {
    const overrides = workspace()["overrides"] as Record<string, string>;
    const expected: Array<[string, string]> = [
      ["brace-expansion@^1.1.11", "1.1.18"],
      ["nanoid@^3", "3.3.18"],
      ["postcss@^8", "8.5.23"],
      ["browserslist@^4", "4.28.7"],
      ["js-yaml@^3", "3.15.2"],
      ["baseline-browser-mapping", "2.11.0"],
      ["fast-uri", "3.1.6"],
      ["path-to-regexp", "6.3.0"],
      ["electron", "41.10.7"],
    ];
    const missing = expected.filter(([key, version]) => overrides[key] !== version);
    assert.deepStrictEqual(missing, [], `overrides missing or wrong: ${JSON.stringify(missing)}`);
    return overrides;
  };

  it("pins every advisory with a published fix (audit census 2026-09-22)", () => {
    readOverrides();
  });

  it("resolves the locked tree to the pinned versions after install", () => {
    readOverrides();
    const lock = NodeFS.readFileSync(
      NodePath.join(import.meta.dirname, "..", "pnpm-lock.yaml"),
      "utf8",
    );
    for (const pin of [
      "brace-expansion@1.1.18",
      "nanoid@3.3.18",
      "postcss@8.5.23",
      "browserslist@4.28.7",
      "js-yaml@3.15.2",
      "baseline-browser-mapping@2.11.0",
      "fast-uri@3.1.6",
      "path-to-regexp@6.3.0",
      "electron@41.10.7",
    ]) {
      assert.ok(
        lock.includes(pin),
        `lockfile must resolve ${pin} (override not applied or install stale)`,
      );
    }
  });
});

describe("staged tree scan (#97 security review)", () => {
  const writeManifest = (
    dir: string,
    name: string,
    version: string,
    deps?: Record<string, string>,
  ): void => {
    NodeFS.mkdirSync(dir, { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(dir, "package.json"),
      JSON.stringify({ name, version, ...(deps ? { dependencies: deps } : {}) }),
    );
  };

  const makeStage = (): string => {
    const stageDir = NodeFS.mkdtempSync(
      NodePath.join(NodeFS.realpathSync(NodeOs.tmpdir()), "ob-stage-"),
    );
    // Root + a bundled-closure nesting like the real stage ships.
    writeManifest(stageDir, NPM_PACKAGE_NAME, "0.0.0-test", { "@codebuff/sdk": "0.35.0" });
    writeManifest(NodePath.join(stageDir, "node_modules", "undici"), "undici", "6.28.1");
    const sdk = NodePath.join(stageDir, "node_modules", "@codebuff", "sdk");
    writeManifest(sdk, "@codebuff/sdk", "0.35.0", {
      ai: "5.0.261",
      "@ai-sdk/anthropic": "2.0.102",
    });
    const sdkNm = NodePath.join(sdk, "node_modules");
    writeManifest(NodePath.join(sdkNm, "@ai-sdk", "anthropic"), "@ai-sdk/anthropic", "2.0.102");
    writeManifest(NodePath.join(sdkNm, "ai"), "ai", "5.0.261", { "@ai-sdk/gateway": "2.0.153" });
    writeManifest(NodePath.join(sdkNm, "@ai-sdk", "gateway"), "@ai-sdk/gateway", "2.0.153", {
      undici: "^5.29.0",
    });
    return stageDir;
  };

  it("accepts a clean bundled tree with the pinned copies", () => {
    assert.deepStrictEqual(scanStagedTree(makeStage()), []);
    assert.ok(hasPinnedUndici(makeStage()));
  });

  it("rejects a vulnerable nested anthropic copy inside the closure", () => {
    const stageDir = makeStage();
    writeManifest(
      NodePath.join(
        stageDir,
        "node_modules",
        "@codebuff",
        "sdk",
        "node_modules",
        "@ai-sdk",
        "anthropic",
      ),
      "@ai-sdk/anthropic",
      "2.0.50",
    );
    const violations = scanStagedTree(stageDir);
    assert.ok(violations[0] !== undefined, "expected exactly one violation");
    assert.match(violations[0].violation, /2\.0\.50 != pinned 2\.0\.102/);
  });

  it("rejects a vulnerable-range undici copy while preserving unrelated versions", () => {
    const stageDir = makeStage();
    // Deep-nest a copy selected through the vulnerable range.
    const sdkNm = NodePath.join(stageDir, "node_modules", "@codebuff", "sdk", "node_modules");
    writeManifest(NodePath.join(sdkNm, "undici"), "undici", "5.29.0");
    writeManifest(
      NodePath.join(stageDir, "node_modules", "unrelated-lib"),
      "unrelated-lib",
      "1.0.0",
      { undici: "^7.0.0" },
    );
    const violations = scanStagedTree(stageDir);
    assert.strictEqual(
      violations.length,
      1,
      `expected only the vulnerable-scope violation, got: ${JSON.stringify(violations)}`,
    );
    assert.ok(violations[0] !== undefined);
    assert.match(violations[0].violation, /vulnerable \^5\.29\.0 range/);
    // An unrelated-range undici somewhere else must NOT be flagged.
    writeManifest(
      NodePath.join(stageDir, "node_modules", "unrelated-lib", "node_modules", "undici"),
      "undici",
      "7.2.1",
    );
    assert.strictEqual(scanStagedTree(stageDir).length, 1);
  });

  it("fails when the pinned undici copy is missing entirely", () => {
    const stageDir = makeStage();
    NodeFS.rmSync(NodePath.join(stageDir, "node_modules", "undici"), { recursive: true });
    assert.ok(!hasPinnedUndici(stageDir));
  });
});
