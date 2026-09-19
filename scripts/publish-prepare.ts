/**
 * Build a publish-ready stage of the server CLI for npm (#90).
 *
 * The workspace manifest uses pnpm-only `catalog:` dependency specifiers, and
 * pnpm 11's `pack`/`deploy` refuse to rewrite them for this package
 * (ERR_PNPM_CANNOT_RESOLVE_WORKSPACE_PROTOCOL), so publishing needs a corrected
 * manifest. This script stages one deterministically — no invented versions:
 *
 *   1. Read the real `catalog:` versions from pnpm-workspace.yaml.
 *   2. Copy apps/server/dist (prebuilt via `pnpm --filter … run build:bundle`)
 *      into the stage.
 *   3. Emit the staged package.json: real versions for `catalog:` deps,
 *      devDependencies dropped (all workspace/internal), bin/files intact.
 *
 * Output: .publish-stage/ at the repo root. Publish from there:
 *
 *   npx pnpm@11.10.0 build && pnpm --filter @princetheprogrammerbtw/openbuff run build:bundle
 *   node --experimental-strip-types scripts/publish-prepare.ts
 *   cd .publish-stage && npm publish --access public
 *
 * The stage is gitignored; it is always rebuilt, never committed.
 *
 * @module publish-prepare
 */
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";

const repoRoot = NodePath.resolve(import.meta.dirname, "..");
const stageDir = NodePath.join(repoRoot, ".publish-stage");
const serverDir = NodePath.join(repoRoot, "apps", "server");
const distDir = NodePath.join(serverDir, "dist");

/** Parse the flat top-level `catalog:` map out of pnpm-workspace.yaml. */
function readCatalog(): Record<string, string> {
  const text = NodeFs.readFileSync(NodePath.join(repoRoot, "pnpm-workspace.yaml"), "utf8");
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === "catalog:");
  if (start === -1) throw new Error("pnpm-workspace.yaml has no top-level catalog");
  const catalog: Record<string, string> = {};
  for (const line of lines.slice(start + 1)) {
    if (!/^\s{2}/.test(line)) break; // next top-level key ends the catalog block
    const match = line.match(/^\s{2}"?([^":]+)"?:\s*(\S+)\s*$/);
    if (match) catalog[match[1]!] = match[2]!;
  }
  return catalog;
}

function resolveSpec(spec: string, catalog: Record<string, string>): string {
  if (spec !== "catalog:") return spec;
  throw new Error("catalog entries must be bare names mapped to versions");
}

function resolveDep(
  spec: string,
  name: string,
  catalog: Record<string, string>,
): string {
  if (spec === "catalog:") {
    const version = catalog[name];
    if (version === undefined) {
      throw new Error(`dependency ${name} uses catalog: but is not in the catalog`);
    }
    // Verbatim, zero invention: the catalog value IS the specifier (it may
    // already carry ^, ~, or a prerelease exact).
    return version;
  }
  return spec;
}

const serverPackageJson = JSON.parse(
  NodeFs.readFileSync(NodePath.join(serverDir, "package.json"), "utf8"),
) as {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
};

if (!NodeFs.existsSync(NodePath.join(distDir, "bin.mjs"))) {
  throw new Error(
    "apps/server/dist/bin.mjs missing — run `pnpm --filter @princetheprogrammerbtw/openbuff run build:bundle` first",
  );
}

const catalog = readCatalog();

const dependencies: Record<string, string> = {};
for (const [name, spec] of Object.entries(serverPackageJson.dependencies ?? {})) {
  if (spec.startsWith("workspace:")) {
    throw new Error(`runtime dependency ${name} is a workspace package — not publishable`);
  }
  dependencies[name] = resolveDep(spec, name, catalog);
}

if (Object.keys(dependencies).length === 0) {
  throw new Error("no runtime dependencies resolved — refusing to stage an empty manifest");
}

// devDependencies are dropped unconditionally — they never publish, and every
// one of them is workspace-internal or a type/test-only package.

NodeFs.rmSync(stageDir, { recursive: true, force: true });
NodeFs.mkdirSync(stageDir, { recursive: true });
NodeFs.cpSync(distDir, NodePath.join(stageDir, "dist"), { recursive: true });

// The installed CLI must serve the web UI itself: resolveWebClientDist
// (apps/server/src/config.ts) looks for `client/index.html` next to the server
// bundle at dist/client — the monorepo fallback cannot exist in an installed
// package. An installed CLI without the client boots then 503s every page.
const webDistDir = NodePath.join(repoRoot, "apps", "web", "dist");
if (!NodeFs.existsSync(NodePath.join(webDistDir, "index.html"))) {
  throw new Error("apps/web/dist/index.html missing — run `pnpm build` first");
}
NodeFs.cpSync(webDistDir, NodePath.join(stageDir, "dist", "client"), { recursive: true });

const staged = {
  ...serverPackageJson,
  dependencies,
  devDependencies: undefined,
};
delete staged.devDependencies;
NodeFs.writeFileSync(
  NodePath.join(stageDir, "package.json"),
  `${JSON.stringify(staged, null, 2)}\n`,
);

console.log(`staged ${serverPackageJson.name}@${serverPackageJson.version} in .publish-stage`);
console.log(`dependencies resolved: ${Object.keys(dependencies).length} (catalog rewritten)`);
console.log("web client bundled at dist/client");
