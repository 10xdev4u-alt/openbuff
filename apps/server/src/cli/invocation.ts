import * as Effect from "effect/Effect";

import { HostProcessArguments } from "@t3tools/shared/hostProcess";

import packageJson from "../../package.json" with { type: "json" };
import { NPM_PACKAGE_NAME, npmPackageSpec } from "../packageName.ts";

export type CliRunner = "npx" | "pnpm dlx" | "bunx";

/**
 * How the CLI was launched, judged by where its entry script lives. Each
 * package runner executes out of a distinctive cache/temp layout:
 *
 *   npx      ~/.npm/_npx/<hash>/node_modules/...
 *   pnpm dlx ~/.cache/pnpm/dlx/..., $PNPM_HOME/.pnpm/dlx/...,
 *            or %LOCALAPPDATA%/pnpm-cache/dlx/... on Windows
 *   bunx     ~/.bun/install/cache/... or $TMPDIR/bunx-<uid>-<spec>/...
 *
 * Global installs and repo checkouts match none of these and return null.
 * Detection keys on the runner's cache *layout*, never the package name, so it
 * works for both this fork's `openbuff` and a stale upstream `t3` cache.
 * Detection is best-effort; callers must fail closed to a plain `openbuff` command.
 */
export function detectCliRunner(entryPath: string): CliRunner | null {
  const path = entryPath.replaceAll("\\", "/");
  if (path.includes("/_npx/")) {
    return "npx";
  }
  if (
    path.includes("/pnpm/dlx/") ||
    path.includes("/.pnpm/dlx/") ||
    path.includes("/pnpm-cache/dlx/")
  ) {
    return "pnpm dlx";
  }
  if (path.includes("/.bun/install/cache/") || path.includes("/bunx-")) {
    return "bunx";
  }
  return null;
}

/**
 * The package spec to suggest. The literal spec the user typed (e.g.
 * `@princetheprogrammerbtw/openbuff@nightly`) is resolved away before our
 * process starts, so re-derive it from the running version: nightly builds
 * re-suggest the nightly channel, anything else the bare scoped package.
 */
export function suggestedPackageSpec(version: string): string {
  return version.includes("-nightly.") ? npmPackageSpec("nightly") : NPM_PACKAGE_NAME;
}

/**
 * Render an `openbuff <subcommand>` suggestion that matches how this process was
 * launched, so copy/pasting it actually works: `npx @princetheprogrammerbtw/openbuff connect` suggests
 * `npx @princetheprogrammerbtw/openbuff serve`, a global install suggests `openbuff serve`, and a nightly build
 * keeps the `@nightly` tag.
 */
export function formatCliCommand(input: {
  readonly subcommand: string;
  readonly entryPath: string;
  readonly version: string;
}): string {
  const runner = detectCliRunner(input.entryPath);
  if (runner === null) {
    return `openbuff ${input.subcommand}`;
  }
  return `${runner} ${suggestedPackageSpec(input.version)} ${input.subcommand}`;
}

/** `formatCliCommand` against this process's real entry path and version. */
export const resolveCliCommand = (subcommand: string) =>
  Effect.map(HostProcessArguments, (processArguments) =>
    formatCliCommand({
      subcommand,
      entryPath: processArguments[1] ?? "",
      version: packageJson.version,
    }),
  );
