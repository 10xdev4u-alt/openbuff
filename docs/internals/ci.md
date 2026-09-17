# CI quality gates

> For maintainers.

[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs three jobs on pull requests and
pushes to `main`:

- **Build**: workspace build plus the web bundle artifacts.
- **Typecheck**: `vp run typecheck` for the workspace type check.
- **Test**: `vp run test` across the workspace.

Other workflows run on pull requests: a charter guard (commit and PR conventions), PR triage and
size labels, and an agentic review pass. Releases are not automated in this fork.
