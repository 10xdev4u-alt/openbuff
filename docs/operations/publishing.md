# Publishing `@princetheprogrammerbtw/openbuff`

The package publishes from a deterministically staged tree, gated by CI smoke — never from the workspace directly.

## The gate

**Publish gate** (`.github/workflows/publish-gate.yml`, `workflow_dispatch`) proves, on the exact packed artifact:

1. installs clean in user position (fresh dir, npm's default script gating),
2. `npm audit` reports **0 vulnerabilities**,
3. `openbuff serve` boots and serves `/` and `/welcome` with HTTP 200,
4. the installed CLI's version matches the manifest.

A red gate is a hard stop. Both historical escapes — the missing-README page (#93) and the fatal `node-pty@1.1.0` Linux boot (#96) — were catchable by this smoke; nothing ships without it.

## Release procedure

```bash
# 1. Build + stage (stage script fails closed on pin assertions).
pnpm build
pnpm --filter @princetheprogrammerbtw/openbuff run build:bundle
node --experimental-strip-types scripts/publish-prepare.ts

# 2. Gate: run the workflow on this commit and wait for green.
gh workflow run "Publish gate"   # workflow NAME, not the file slug — `publish-gate` alone is not found
gh run watch   # … must end green

# 3. Publish (2FA-enforced account: use a granular automation token).
cd .publish-stage && npm publish --access public

# 4. Live verify: registry doc + a fresh `npm install <pkg>@latest` + boot probe.
```

## Mechanism notes

- **Staging** (`scripts/publish-prepare.ts`): rewrites pnpm `catalog:` specifiers to verbatim versions (pnpm 11 cannot pack this workspace package), drops devDependencies, copies the built web client to `dist/client`, copies `README.md` (fails closed if missing — npm renders the page from the tarball root, #93), and asserts the bundled closure is advisory-free (`scripts/install-security.ts` scans every manifest in the tree, #97).
- **`bundleDependencies: ["@codebuff/sdk"]`**: npm 12 removed shrinkwraps and ignores dependency-position overrides, so the pinned clean closure ships physically in the tarball.
- **`node-pty@1.2.0-beta.15`**: pinned exactly because that tarball ships `prebuilds/linux-*` — the CLI boots with zero install scripts under npm's gating.
- Version bumps happen in `apps/server/package.json` **before** staging (the stage snapshot is a copy — a post-stage bump packs a stale version).

## Post-publish verification (staged ≠ served)

`npm publish` reporting SUCCESS means the registry **staged** the version — not that users can see it. CDN propagation has repeatedly lagged ~10–12 minutes (v0.0.36, 2026-09-23). Verify in this order:

1. **Acceptance proof**: republish the identical tarball. The expected `E409 Cannot publish over previously staged version X` is _positive_ proof the registry accepted the publish. Note the republish RE-PACKS the whole tree (~3,160 files) before the registry answers — give it minutes (v0.0.37's first republish probe timed out at 120 s and answered on the second try with a 300 s window).
2. **Registry truth**: `curl -s "https://registry.npmjs.org/<pkg>"` and check `dist-tags.latest` + `time.modified` directly — `npm view` from the publishing machine reads a local packument cache and can lie about freshness.
3. **User-position proof**: fresh dir (no cache, `--prefer-online`), `npm install <pkg>`, assert the installed `package.json` version, `npm audit` = 0, then boot the CLI and probe the HTTP endpoints. Only this step proves what a real user gets.

Never publish a "hotfix" during the propagation window — the E409 you get back is the system working, not a failure.

## Gate failure modes (learned 2026-09-24, #146)

- The gate's steps carry per-step timeouts and the diagnostics step fires on `failure() || cancelled()`. These are two different kill paths: a per-step TIMEOUT fails the step and the run (run 3's conclusion was `failure`, per the runner's StepsRunner), while an external CANCEL (run 1: user or API cancellation) marks the run CANCELLED — the diagnostics must fire on both, since each is exactly when the logs matter most.
- The child `npm install` inside `scripts/publish-prepare.ts` runs with bounded fetch retries (`--fetch-timeout=60000 --fetch-retries=2 --fetch-retry-mintimeout=15000 --fetch-retry-maxtimeout=60000`) so a registry stall fails loudly in ~3 minutes instead of hanging past the kill window, and `--loglevel=silly` under CI so the last line names the failing operation.
- The runner npm is PINNED (`npm install -g npm@12.0.2` before staging). An un-pinned runner npm drifted to 11.19.0 and hung the gate in the reify phase with zero local repro — deterministic tooling in CI or the runner's weekly drift becomes your incident.
- Dispatch by workflow NAME ("Publish gate"); the concurrency group queues dispatches (`queue: max`, never cancels).
