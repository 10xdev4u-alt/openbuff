# EVOLUTION_LOG.md — APEX-0

Format: What I tried | What worked/failed + evidence | Lesson as reusable rule | Graph nodes updated.

## Entry 0 — 2026-09-16 — Phase 0 zero-trust bootstrap

**What I tried**
Read root manifests + README + AGENTS.md, listed `apps/`, `packages/`, `apps/server/src`, `packages/contracts/src`, `persistence/`, `provider/Drivers|Services`, `orchestration/`, `checkpointing/`; read `FreebuffDriver.ts` (150/261), `FreebuffAdapter.ts` (120/719), `FreebuffSession.ts` (90/203), `Migrations.ts`, `005_Projections.ts`, `OrchestrationEngine.ts`, `ws.ts` head, `bin.ts`, glossary head; `git log -12`.

**Worked**
- Repo identified in 4 tool rounds: fork of t3code with single SDK-backed driver; event-sourced server architecture confirmed from `persistence/Services/*` + glossary.
- Docs/code divergence detected twice (AGENTS.md provider list; adapter header vs shipped approval flow) — both recorded in `docs/KNOWLEDGE_GRAPH.md` §4.

**Failed / friction**
- `code_search` returned **0 matches** for "codebuff" inside `apps/` despite the string existing in files it listed — tool silently unreliable here (index hit its 10k-file cap). Lesson recorded below.
- Reading `005_Projections.ts` paid off more than expected: migration files are the cheapest ground truth for the read model.

**Rules (reusable)**
1. In this repo, prefer `glob`/`list_directory`/direct reads over `code_search`; the search index truncates at 10k files and can report 0 on real matches.
2. Migration files are the DB schema's source of truth; read `Migrations.ts` first for any data-layer task.
3. This fork's docs lie in upstream's favor: verify every provider/desktop/mobile claim against `apps/` reality before acting on prose.
4. `@codebuff/sdk` semantics live in three files only (`FreebuffDriver/Adapter/Session.ts`); anything Freebuff-protocol-shaped starts there.

**Graph nodes updated** — initial graph written: `docs/KNOWLEDGE_GRAPH.md` v0 (entities §1, relations §2, mermaid §3).

## Entry 1 — 2026-09-16 — Boot the stack

**What I tried:** read `scripts/dev-runner.ts` → caught `--filter=t3` vs package `openbuff`; fixed runner + pinned test; `npx -y pnpm@11.10.0 install` (2m14s); launched via `setsid nohup`, captured PID to `.freebuff/dev.pid`; probed ports; registered preview on pairing URL.

**Worked:** server+web both verified (302 API root, 200 Vite HTML, pair token consumed, draft-thread UI rendered via preview_snapshot). PREVIEW tool needs `pid` with `url` (error taught the schema).

**Failed:** first IPv4 curl to web got 000 — web binds `[::1]` only. `BACKGROUND` process_type unimplemented → `setsid`+pidfile pattern instead. I tried to edit KNOWLEDGE_GRAPH.md with a fabricated anchor string — my own error, cost one failed tool call.

**Rules:**
1. Probe web on `localhost`/`[::1]`, never `127.0.0.1` (IPv6-only bind).
2. Long-running procs: `setsid nohup … & echo $! > .freebuff/*.pid`; kill only the captured PID.
3. `register_preview` requires `url`+`pid` together for dev servers.
4. Check pinned tests before assuming a string bug is one-line — but check the *code* before assuming the test is wrong (this time test+code agreed).
5. When editing files, re-grep for the anchor if a prior write may have shifted it; never quote from memory.

**Graph nodes updated:** §5 Runtime evidence added; task log row appended.

## Entry 2 — 2026-09-16 — Upstream protocol dive (CodebuffAI/freebuff)

**What I tried:** cloned their monorepo to `.repos/freebuff` (their own convention for vendored references); traced admission path/headers, gate codes, metadata injection, prompt gate, model/agent pairings through `common/`, `cli/`, `sdk/` sources; cross-checked installed SDK dist and npm.

**Worked:** six deltas pinned with file:line (graph §5.5). Their `freebuff-session.ts` is the protocol's Rosetta Stone — typed gate table, admission states, grace-window semantics.

**Failed/friction:** two grep pipelines reported nothing where output was ambiguous (exit codes eaten by `\|\|` chains) — nearly misread as fact. Rule: re-probe with `grep -c` + explicit exit echo when a negative claim matters.

**Rules:**
1. Never claim "X doesn't exist" from a grep whose exit code you didn't check.
2. Vendor references in `.repos/` follow repo convention — clone reference repos there, never import from them.
3. When a workaround smells overbuilt (fetch interceptor), search the vendor's newer source for the official hook *before* trusting the installed version's limits.
4. Pair (`error` code, `statusCode`) is the only reliable gate classifier — status or code alone lets upstream errors impersonate the gate.

**Graph nodes updated:** §5.5 added (9-row protocol audit); task log row appended.

**Mistake counter:** still 1 (no repeats).
