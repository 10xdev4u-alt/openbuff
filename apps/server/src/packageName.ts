/**
 * The npm identity of this CLI package — single source of truth for every
 * place the registry name matters: install specs, pinned-runtime entry paths,
 * and the copy/paste commands printed to users.
 *
 * The bare `openbuff` name on npm is held by an unrelated project (#90), so
 * this fork publishes under its own scope. The short `openbuff` PROGRAM name
 * is separate and stays: `bin.openbuff` in package.json keeps global installs
 * (`openbuff serve`), the systemd unit name, and the CLI's argv[0] unchanged.
 */

/** Exact registry name of the publishable package, including the scope. */
export const NPM_PACKAGE_NAME = "@princetheprogrammerbtw/openbuff";

/**
 * Registry spec pinning this fork's package at an exact version or tag:
 * `@princetheprogrammerbtw/openbuff@0.0.33`, `…@latest`, `…@nightly`.
 */
export const npmPackageSpec = (versionOrTag: string): string =>
  `${NPM_PACKAGE_NAME}@${versionOrTag}`;

/**
 * Path segments the package occupies under a `node_modules` directory —
 * scoped packages nest: `node_modules/@princetheprogrammerbtw/openbuff`.
 */
export const npmPackageNodeModulesSegments = [
  "@princetheprogrammerbtw",
  "openbuff",
] as const;
