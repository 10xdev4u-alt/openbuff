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
 *      into the stage, plus the built web client at dist/client, which the
 *      installed CLI requires to serve any page (resolveWebClientDist,
 *      apps/server/src/config.ts).
 *   3. Emit the staged package.json: catalog specs rewritten verbatim,
 *      devDependencies dropped (all workspace/internal), everything else kept.
 *
 * Output: .publish-stage/ at the repo root. Publish from there:
 *
 *   pnpm build && pnpm --filter @princetheprogrammerbtw/openbuff run build:bundle
 *   node --experimental-strip-types scripts/publish-prepare.ts
 *   cd .publish-stage && npm publish --access public
 *
 * The stage is gitignored; it is always rebuilt, never committed.
 *
 * @module publish-prepare
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Yaml from "yaml";

const stageDirName = ".publish-stage";

class StageError extends Data.TaggedError("StageError")<{
  readonly message: string;
}> {}

/** JSON codec used for both reading and writing manifests — house style
 * avoids raw `JSON.parse`/`JSON.stringify` (effect/preferSchemaOverJson). */
const JsonText = Schema.fromJsonString(Schema.Unknown, { space: 2 });
const decodeJsonText = Schema.decodeSync(JsonText);
const encodeJsonText = Schema.encodeSync(JsonText);

const prepareStage = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const repoRoot = yield* path.fromFileUrl(new URL("../", import.meta.url));
  const serverDir = path.join(repoRoot, "apps", "server");
  const distDir = path.join(serverDir, "dist");
  const webDistDir = path.join(repoRoot, "apps", "web", "dist");
  const stageDir = path.join(repoRoot, stageDirName);

  if (!(yield* fs.exists(path.join(distDir, "bin.mjs")))) {
    return yield* new StageError({
      message:
        "apps/server/dist/bin.mjs missing — run `pnpm --filter @princetheprogrammerbtw/openbuff run build:bundle` first",
    });
  }
  if (!(yield* fs.exists(path.join(webDistDir, "index.html")))) {
    return yield* new StageError({
      message: "apps/web/dist/index.html missing — run `pnpm build` first",
    });
  }

  const manifestText = yield* fs.readFileString(path.join(serverDir, "package.json"));
  const manifest = yield* Effect.try({
    try: () => decodeJsonText(manifestText),
    catch: (cause: unknown) =>
      new StageError({ message: `apps/server/package.json is not valid JSON: ${String(cause)}` }),
  });
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    return yield* new StageError({ message: "apps/server/package.json is not a JSON object" });
  }
  const manifestRecord = manifest as Record<string, unknown>;
  if (typeof manifestRecord["name"] !== "string" || typeof manifestRecord["version"] !== "string") {
    return yield* new StageError({ message: "apps/server/package.json lacks name/version" });
  }

  const rawDependencies = manifestRecord["dependencies"];
  if (
    typeof rawDependencies !== "object" ||
    rawDependencies === null ||
    Array.isArray(rawDependencies)
  ) {
    return yield* new StageError({
      message: "apps/server/package.json has no dependencies object — refusing to stage",
    });
  }

  const workspaceText = yield* fs.readFileString(path.join(repoRoot, "pnpm-workspace.yaml"));
  const workspace = Yaml.parse(workspaceText) as unknown;
  if (typeof workspace !== "object" || workspace === null) {
    return yield* new StageError({ message: "pnpm-workspace.yaml is not a mapping" });
  }
  const catalog = (workspace as Record<string, unknown>)["catalog"];
  if (typeof catalog !== "object" || catalog === null) {
    return yield* new StageError({ message: "pnpm-workspace.yaml has no top-level catalog map" });
  }
  const catalogVersions = catalog as Record<string, unknown>;

  const resolved: Record<string, string> = {};
  for (const [name, spec] of Object.entries(rawDependencies as Record<string, unknown>)) {
    if (typeof spec !== "string") {
      return yield* new StageError({
        message: `dependency ${name} has a non-string specifier — not publishable`,
      });
    }
    if (spec.startsWith("workspace:")) {
      return yield* new StageError({
        message: `runtime dependency ${name} is a workspace package — not publishable`,
      });
    }
    if (spec === "catalog:") {
      const version = catalogVersions[name];
      if (typeof version !== "string") {
        return yield* new StageError({
          message: `dependency ${name} uses catalog: but has no catalog version`,
        });
      }
      // Verbatim, zero invention: the catalog value IS the specifier (it may
      // already carry ^, ~, or a prerelease exact).
      resolved[name] = version;
    } else {
      resolved[name] = spec;
    }
  }
  if (Object.keys(resolved).length === 0) {
    return yield* new StageError({
      message: "no runtime dependencies resolved — refusing to stage an empty manifest",
    });
  }

  // devDependencies are dropped unconditionally — they never publish, and
  // every one of them is workspace-internal or a type/test-only package.
  delete manifestRecord["devDependencies"];
  manifestRecord["dependencies"] = resolved;

  yield* fs.remove(stageDir, { recursive: true, force: true });
  yield* fs.makeDirectory(stageDir, { recursive: true });
  yield* fs.copy(distDir, path.join(stageDir, "dist"));
  // The installed CLI must serve the web UI itself: the monorepo fallback in
  // resolveWebClientDist cannot exist in an installed package, and an installed
  // CLI without the client boots then 503s every page.
  yield* fs.copy(webDistDir, path.join(stageDir, "dist", "client"));
  yield* fs.writeFileString(path.join(stageDir, "package.json"), `${encodeJsonText(manifest)}\n`);

  yield* Effect.logInfo(
    `staged ${manifestRecord["name"] as string}@${manifestRecord["version"] as string} in ${stageDirName}: ${Object.keys(resolved).length} dependencies resolved (catalog rewritten), web client bundled at dist/client`,
  );
});

// NodeRuntime.runMain exits non-zero when the effect fails, so a staging
// failure never masquerades as success.
if (import.meta.main) {
  prepareStage.pipe(Effect.scoped, Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
