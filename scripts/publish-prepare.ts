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
 *   4. Install the staged tree for real (`npm install --omit=dev` inside the
 *      stage — the staged manifest's `overrides` apply there) so the
 *      `bundleDependencies` closure (@codebuff/sdk → ai/anthropic/undici)
 *      ships physically pre-resolved. npm 12 removed shrinkwrap and IGNORES
 *      `overrides` declared by an installed dependency (#96), and
 *      @codebuff/sdk exact-pins vulnerable versions — the bundle is the only
 *      mechanism that reaches them. The overrides are then stripped from the
 *      staged manifest (npm's pack guard forbids override-affected bundles)
 *      and the pinned versions are asserted; a drift fails the stage.
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
import { ChildProcess } from "effect/unstable/process";
import * as Yaml from "yaml";

import { hasPinnedUndici, REQUIRED_UNDICI_VERSION, scanStagedTree } from "./install-security.ts";

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
  const readmePath = path.join(repoRoot, "README.md");
  if (!(yield* fs.exists(readmePath))) {
    return yield* new StageError({
      message: "README.md missing — the npm package page renders it from the tarball root",
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
  yield* fs.copy(readmePath, path.join(stageDir, "README.md"));
  yield* fs.copy(distDir, path.join(stageDir, "dist"));
  // The installed CLI must serve the web UI itself: the monorepo fallback in
  // resolveWebClientDist cannot exist in an installed package, and an installed
  // CLI without the client boots then 503s every page.
  yield* fs.copy(webDistDir, path.join(stageDir, "dist", "client"));
  yield* fs.writeFileString(path.join(stageDir, "package.json"), `${encodeJsonText(manifest)}\n`);

  // npm resolves the staged manifest with the overrides honored (the stage
  // is the project root here) and materializes node_modules, which `npm pack`
  // then ships for every bundleDependencies entry — physically, pre-resolved,
  // immune to the client's own override policy.
  // #146 evidence: on CI runners the child install once sat 12 minutes with
  // ZERO output (run 35994905306's timeout killed an orphan `npm install`);
  // the same step takes ~35 s locally. npm's default fetch-retry ladder
  // outlives the gate's kill window, so a stalled registry fetch hangs
  // silently forever. These bounds turn any stall into a loud failure in
  // ~3 minutes with npm's own error naming the host; CI adds info-level
  // logging so the next hang self-describes.
  const npmArgs = [
    "install",
    "--omit=dev",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--fetch-timeout=60000",
    "--fetch-retries=2",
    "--fetch-retry-mintimeout=15000",
    "--fetch-retry-maxtimeout=60000",
  ];
  if (process.env.CI === "true") npmArgs.push("--loglevel=info");
  const install = yield* ChildProcess.make("npm", npmArgs, {
      cwd: stageDir,
      stdout: "inherit",
      stderr: "inherit",
    },
  ).pipe(
    Effect.mapError(
      (cause) =>
        new StageError({
          message: `npm install failed to start in ${stageDirName}: ${String(cause)}`,
        }),
    ),
  );
  const installExitCode = yield* install.exitCode.pipe(
    Effect.mapError(
      (cause) =>
        new StageError({
          message: `npm install crashed: ${String(cause)}`,
        }),
    ),
  );
  if (installExitCode !== 0) {
    return yield* new StageError({
      message: `npm install exited ${installExitCode} — staged manifest does not resolve`,
    });
  }

  // Fail closed on the security pins (#96, #97): the contract must cover
  // EVERY manifest in the staged tree — the bundled closure ships nested
  // copies a root-level check never sees. Any `@ai-sdk/anthropic` outside
  // the pin fails, as does any undici copy selected through the vulnerable
  // `^5.29.0` range (unrelated undici versions stay out of scope); the
  // pinned clean undici must also EXIST somewhere — positive proof the
  // override resolution held.
  const stagedViolations = scanStagedTree(stageDir);
  if (stagedViolations.length > 0) {
    return yield* new StageError({
      message: `bundled closure violates the security pins — re-prove the audit before shipping:\n${stagedViolations.map((v) => `  - ${v.packageJsonPath}: ${v.violation}`).join("\n")}`,
    });
  }
  if (!hasPinnedUndici(stageDir)) {
    return yield* new StageError({
      message: `staged tree carries no undici@${REQUIRED_UNDICI_VERSION} — the override resolution did not hold`,
    });
  }

  // npm's pack guard rejects manifests where `overrides` affect bundled
  // packages ("consumers do not apply your package's overrides"). The
  // overrides have already done their job — the node_modules above were
  // resolved WITH them — so the shipped manifest drops them and the bundle
  // travels as the physical, pre-resolved truth. Verified end-to-end:
  // consumer install reports 0 vulnerabilities and arborist extracts the
  // bundle without re-resolving its edges.
  const stagedManifestPath = path.join(stageDir, "package.json");
  delete manifestRecord["overrides"];
  yield* fs.writeFileString(stagedManifestPath, `${encodeJsonText(manifest)}\n`);

  yield* Effect.logInfo(
    `staged ${manifestRecord["name"] as string}@${manifestRecord["version"] as string} in ${stageDirName}: ${Object.keys(resolved).length} dependencies resolved (catalog rewritten), vulnerable chain bundled pre-resolved, web client bundled at dist/client`,
  );
});

// NodeRuntime.runMain exits non-zero when the effect fails, so a staging
// failure never masquerades as success.
if (import.meta.main) {
  prepareStage.pipe(Effect.scoped, Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
