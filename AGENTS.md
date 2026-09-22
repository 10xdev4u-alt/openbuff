# OpenBuff — Engineering Charter & Factory Operations Manual

**OpenBuff** is the open-source, ad-free web experience for the Freebuff agent: t3 Code's UI, one engine (`@codebuff/sdk`). One command (`npx openbuff@latest`) starts a local server + web app working on your files — chat, tool calls, diffs, terminals, turn checkpoints.

You can think of OpenBuff as the community-run, bring-your-own-free-tier alternative to closed agent apps.

---

## Part 1 — The Factory: Agentic Git Issues-PR System

This repository is built by an **agent fleet**, not ad-hoc commits. Every change follows one loop. Nothing ships outside it.

### 1.1 Fleet roster (see `agents/` for full briefs)

| Agent                             | Role                                               | Acts as                                 |
| --------------------------------- | -------------------------------------------------- | --------------------------------------- |
| **Builder**                       | Writes code + tests, follows the PR loop           | committer (co-author: the-ai-developer) |
| **Reviewer** (`the-ai-developer`) | Reviews every PR; requests changes before approval | PR reviewer                             |
| **Architect**                     | Owns ADRs, boundaries, performance budget          | issue author `architect`                |
| **Protocol**                      | Owns the Freebuff wire contract, upstream deltas   | issue author `protocol`                 |
| **Security**                      | Threat-models diffs, guards secrets/creds          | issue author `security`                 |
| **Perf**                          | Renders perf regressions; proposes perf fixes      | issue author `perf`                     |
| **Docs**                          | Keeps docs truthful; runs the unslop pass          | issue author `docs`                     |
| **Operator**                      | CI, releases, branch hygiene, dashboards           | issue author `operator`                 |

Any worker agent may spawn subagents for research/verification, but **only Builder commits** and **only Reviewer approves**. Opinions route through issues.

### 1.2 The PR loop (mandatory, in order)

1. **RESEARCH** — gather evidence (code, upstream sources in `.repos/`, logs, benchmarks). Cite `file:line`.
2. **EVALUATE** — multi-POV pass (architect / hacker / maintainer / user / operator / future-self). Conflicts stated as explicit tradeoffs with a reasoned pick.
3. **ISSUE** — file or claim an issue first (`openbuff/` + `factory/` labels, acceptance criteria + risk notes). No work without an issue.
4. **VALIDATE** — design review on the issue: is the approach the smallest correct fix? Subagents may attack the plan before a line is written.
5. **IMPLEMENT** — branch from fresh `main`: `<type>/<issue#>-<slug>`. TDD where tests exist; smallest diff that passes all POVs.
6. **COMMIT** — conventional commits, **subject ≤ 6 words**, type from `feat|fix|refactor|docs|test|chore|perf|ci|build|style|revert`. Body: problem → fix, imperative mood.
   - **Co-author line on every commit, exactly one:**
     `Co-Authored-By: the-ai-developer <88466089+the-ai-developer@users.noreply.github.com>`
   - **No "Generated/Generated with/by" footers, no tool or vendor attribution, no robot emojis in commits, PRs, or PR bodies. Ever.**
   - **Vendor names never appear in commit subjects or PR titles** (hard CI fail). Bodies refer to dependencies by role — "the SDK", "upstream", "the session API" — not by vendor. The guard warns on vendor terms in bodies (identifiers may occasionally require them; attribution never does).
7. **VALIDATE LOCALLY** — typecheck + targeted tests + lint for touched scope; paste real output into the PR (never "should work"). Repo-wide checks stay to CI.
8. **PUSH + OPEN PR** — template followed; scope = one concern; link the issue (`Closes #N`); screenshots/video for UI changes.
9. **REVIEW** — request **the-ai-developer**. Address every finding (or rebut with evidence). Merge only on approval.
10. **MERGE** — **merge commit, never squash, never rebase-merge** (history = research trail). Title: conventional, no "generated" wording.
11. **CLEAN** — delete local + remote branch, prune stale branches, then re-sync `main` and repeat.

### 1.3 Commit subject rule

Hard limit: **6 words or fewer** after the type prefix. Counts as words, not characters. Examples: `fix: route free-tier accounts correctly` (5) ✓ · `feat: add session gate classifier` (5) ✓ · `fix: satisfy Freebuff free-mode gates so turns produce responses` (9) ✗.

### 1.4 Branch & PR hygiene

- Branch names: `<type>/<issue#>-<kebab-slug>` (e.g. `feat/42-gate-classifier`).
- One PR = one concern. If the description says "also", split it.
- Draft PRs allowed mid-research; never merge drafts.
- Stale-branch sweep after every merge (`operator` owns the workflow; local manual sweep before starting new work).

### 1.5 Subagent usage (the fleet multiplier)

- Research fan-out: independent verification questions → parallel subagents, one question each, results cited back into the issue.
- Adversarial pass: one subagent attacks the diff (injection, race, perf, UX edge) before review is requested.
- Never let subagents commit, push, merge, or close anything. Read/analyze only.

---

## Part 2 — Repository Reality (what is actually true here)

OpenBuff is a **fork of pingdotgg/t3code** (MIT) trimmed to its web + server apps, with a
**single Freebuff driver** wrapping `@codebuff/sdk` in-process (`BUILT_IN_DRIVERS` in
`apps/server/src/provider/builtInDrivers.ts` holds exactly one entry). Docs outside `apps/` may
still carry upstream-t3 claims — verify against `apps/` before acting on prose.

Glossary (project / workspace / thread / turn / activity / command / event / decider / projector / reactor / receipt): `docs/internals/glossary.md`.

### 2.1 The three ways to hurt yourself

1. **Killing by pattern.** Never `pkill -f`, `pgrep | kill`, or kill by name/path match. Kill only a PID captured at spawn (we keep them in `.freebuff/*.pid`) or a port owner whose `/proc/<pid>/cwd` you confirmed.
2. **Writing to the live install.** `~/.t3/userdata` is the developer's real T3 database. Read/copy (`VACUUM INTO`) for test data — never open read-write, never run a server against it.
3. **Baking in origins.** Never set `VITE_HTTP_URL`/`VITE_WS_URL` in dev. Dev is single-origin; Vite proxies `/api`, `/ws`, `/oauth`, `/.well-known`. Web dev binds IPv6 loopback — probe `localhost`, not `127.0.0.1`.

### 2.2 Where code lives

- `apps/server` — Effect runtime: CLI (`bin.ts`), HTTP/WS (`http.ts`, `ws.ts`), orchestration (pure `decider.ts` + `projector.ts`), SQLite persistence (event store + projections, 40 migrations), provider layer (`provider/Drivers/FreebuffDriver.ts`, `Services/FreebuffAdapter.ts`, `Services/FreebuffSession.ts`), checkpointing (git hidden refs), terminals (node-pty).
- `apps/web` — React 19 + Vite + TanStack Router + Zustand + Tailwind v4, M3 Expressive design tokens.
- `packages/contracts` — Effect Schema contracts; wire truth for everything crossing WS.
- `packages/shared`, `packages/client-runtime` — shared runtime utils and client code.
- `.repos/` — vendored **read-only reference repos** (`freebuff/` = CodebuffAI/freebuff, the protocol source of truth; `effect-smol/` — read `.repos/effect-smol/LLMS.md` before writing Effect). Never edit or import from them; sync with `vpr sync:repos`.
- `docs/` — user/internals/operations split; new vocabulary lands in the glossary.
- `scripts/` — dev-runner (ports derive from worktree path), migrations, icon export.

### 2.3 Dev servers

- `pnpm dev` (or `npx pnpm@11.10.0 dev`) starts server + web. Worktree state defaults to that worktree's gitignored `.t3/`.
- Ports print from `[dev-runner]` in output; server API answers on `127.0.0.1:13773` (base), web on `localhost:5733` (base) — **offsets shift when ports are taken; trust the log, not memory.**
- Pairing: hand over the full pairing URL **with token**, never the bare origin. Fresh token: `node apps/server/src/bin.ts pair`.
- Stop what you started, by the PID you captured. See rule 2.1.1.

### 2.4 Test data

An empty database is a bad test. Seed your worktree `.t3` by copying from `~/.t3/userdata` or `~/.t3/dev` with `VACUUM INTO` (see `docs/` upstream guides); bring `secrets`/`settings.json` only if the flow needs them. Copy in, never symlink, never back out.

### 2.5 Verifying

- Smallest proof: `vp test run <files>` for touched tests; targeted typecheck + lint for changed scope; paste real output.
- **No repo-wide `vp check` / `vp run -r test` by hand** — CI owns the full suite.
- Server flows emit typed receipts (`RuntimeReceiptBus`) — tests wait on receipts and worker drains, **never on sleeps/polling**; a test needing a timeout to pass is wrong.
- Effect code: read `.repos/effect-smol/LLMS.md` first. Complexity belongs at adapter boundaries; orchestration stays pure; UI stays dumb.
- Never launch your own dev server if one is running for the session; reuse it or ask.

### 2.6 Freebuff protocol (the fork's crown jewels)

- Free mode requires **three gates**: canonical prompt opening, allowlisted agent+model pairing, active session instance id in `codebuff_metadata`.
- Session admission is **header-driven** (`x-freebuff-model`, `x-freebuff-wallet-spend-limit`); the dedicated route is `POST /api/v1/freebuff/session/admission`.
- Gate rejections are **(error-code, HTTP-status) pairs** — never classify by one half alone.
- Wire truth lives in `.repos/freebuff/common/src/types/freebuff-session.ts`. When upstream and our implementation disagree, upstream wins until a graph update says otherwise.
- `docs/KNOWLEDGE_GRAPH.md` is the living map — **every task updates it or the task is incomplete.**

---

## Part 3 — Taste (non-negotiables)

- Performance without compromise: no continuously repainting animations; watch websocket payload sizes; users notice a dropped frame and a lying spinner.
- Hit every surface: command palette + keybindings + settings paths for anything reachable from chat; reverse states (snooze/unsnooze, close/reopen) or it's a bug.
- Inferred types over annotations; `any` is the enemy; no hardcoded secrets; no silent errors.
- Comments explain how a thing is used and move with the code.
- Docs split by audience (`user/` shipped-product voice, `internals/` contributors, `operations/` runbooks); behavior changes a user notices land in `docs/user/`.
- Security matters without over-indexing on dev-mode internals.
- If a rule here fights the task in front of you, say so loudly and get human sign-off before breaking it.

## Part 4 — PR/issue conventions summary

- Conventional commits only; subjects ≤ 6 words after type; imperative body.
- Every commit co-authored by **the-ai-developer only** (trailer in 1.2.6).
- Vendor names never appear in commit subjects or PR titles; bodies use role names for dependencies.
- Merge strategy: **merge commit**; squash/rebase prohibited.
- Reviewer of record: **the-ai-developer** on every PR (rubric below).
- Issues are the unit of work; PRs reference exactly one issue; research lands in the issue, evidence lands in the PR.

### Reviewer rubric (the merge bar)

The reviewer is not a separate product or bot — it is the same engineering discipline operating under a different hat, with a different duty: attack the work instead of defend it. What must be durable is this rubric, not a tool.

Run in order; a step can only be passed, not skipped:

1. **Charter check** — conventional subject ≤ 6 words, exactly one co-author (the-ai-developer), no vendor/generated wording, merge-commit policy respected.
2. **Linkage check** — the PR references exactly one open issue; the issue's acceptance criteria are each addressed or explicitly waived with a reason.
3. **RED-first check** — every behavior claim has a test that failed before the change (or, for pure docs/config, a before-state capture). "It passed" without a failing predecessor is unproven.
4. **Finding disposition** — every review finding (bot or human) is fixed or rebutted **with evidence**; silence is not disposition. Valid findings get a fix commit, not an argument; invalid ones get the evidence that kills them.
5. **Artifact-level proof** — the proof matches the claim's level: code claims need runtime output, install claims need a clean-tree install of the packed artifact, publish claims need the registry. A green build alone proves nothing about behavior.
6. **Approval** — only after 1–5: the-ai-developer approves with a disposition summary. Merge bar = approval + all gates green + zero undispositioned findings.

Bot reviewers (e.g. CodeRabbit) are **findings sources, never approvers**; their state does not gate the merge bar, their findings do.
