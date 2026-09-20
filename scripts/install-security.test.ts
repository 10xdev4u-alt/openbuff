// @effect-diagnostics nodeBuiltinImport:off - reads the real repo manifests.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";

/** Mirrors NPM_PACKAGE_NAME in apps/server/src/packageName.ts — kept literal so
 * this composite script project does not pull server sources into its program.
 * If the package identity ever changes, update both. */
const NPM_PACKAGE_NAME = "@princetheprogrammerbtw/openbuff";

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
