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
4. Check pinned tests before assuming a string bug is one-line — but check the _code_ before assuming the test is wrong (this time test+code agreed).
5. When editing files, re-grep for the anchor if a prior write may have shifted it; never quote from memory.

**Graph nodes updated:** §5 Runtime evidence added; task log row appended.

## Entry 2 — 2026-09-16 — Upstream protocol dive (CodebuffAI/freebuff)

**What I tried:** cloned their monorepo to `.repos/freebuff` (their own convention for vendored references); traced admission path/headers, gate codes, metadata injection, prompt gate, model/agent pairings through `common/`, `cli/`, `sdk/` sources; cross-checked installed SDK dist and npm.

**Worked:** six deltas pinned with file:line (graph §5.5). Their `freebuff-session.ts` is the protocol's Rosetta Stone — typed gate table, admission states, grace-window semantics.

**Failed/friction:** two grep pipelines reported nothing where output was ambiguous (exit codes eaten by `\|\|` chains) — nearly misread as fact. Rule: re-probe with `grep -c` + explicit exit echo when a negative claim matters.

**Rules:**

1. Never claim "X doesn't exist" from a grep whose exit code you didn't check.
2. Vendor references in `.repos/` follow repo convention — clone reference repos there, never import from them.
3. When a workaround smells overbuilt (fetch interceptor), search the vendor's newer source for the official hook _before_ trusting the installed version's limits.
4. Pair (`error` code, `statusCode`) is the only reliable gate classifier — status or code alone lets upstream errors impersonate the gate.

**Graph nodes updated:** §5.5 added (9-row protocol audit); task log row appended.

**Mistake counter:** still 1 (no repeats).

## 2026-09-16 — Admission route port (#24, PRs #43/#44)

**Tried:** Ported `establishFreebuffSession` to the dedicated admission route with the full upstream header contract, typed gate bodies (403/409/429 returned, not thrown), 404/405 fail-closed unsupported-server error, and `FreebuffSessionRequestError` (status + machine code + parsed retry-after). TDD with injected fetch — RED 10/10 (implementation even fired a live network probe before injection existed), GREEN 9/9, provider slice 125/125, typecheck clean.

**What worked:** Injected-fetch test design (zero global mutation); validating design on the issue before coding; CI catching two real findings my local checks missed.

**What failed + evidence:** (1) Local "TSC-EXIT:0" was `head`'s exit code, not tsc's — CI failed on `exactOptionalPropertyTypes` (TS2412) I never saw. (2) Same class again: `pnpm typecheck` grep swallowed the exit code, which then surfaced the real `globalDate` lint. (3) Merged #43 in a batched command without reading CodeRabbit's CHANGES_REQUESTED first — process miss, self-caught, finding fixed as #44.

**Lessons (reusable rules):**

1. After a pipe, `$?` is the LAST command's status. Propagate the real exit: `${PIPESTATUS[0]}` or run the checker bare before grepping. (Repeat of an earlier mistake — counter now 2. A third repeat means the workflow itself changes: no piped checker assertions, ever.)
2. `exactOptionalPropertyTypes` requires `field?: T | undefined` when assigning possibly-undefined values — check tsconfig flags before writing optional-bearing APIs.
3. This repo requires Effect `Clock` for time access; plain modules opt out via `// @effect-diagnostics globalDate:off` with rationale (convention: serviceLauncher.ts, usageAggregation.ts).
4. Never merge in a command batch that also produces the review verdict — read reviews, then merge, as separate steps.

**Graph nodes updated:** §1/§2/mermaid POST refs → admission route (PR #44); task log row appended.

### 2026-09-16 — #28 free model default (PR #47, MERGED ffc59855)

What I tried: contracts free-pin constant + map entry; settings-aware bootstrap selection (first enabled driver, per-driver default, codex fallback); live-settings boot seeding; Layer.merge for chained provides.
What worked/failed: TDD held (RED 3→GREEN); evidence flipped the issue's own acceptance reading — `DEFAULT_MODEL` must STAY `gpt-5.6-sol` because it IS codex's map value; repointing it would hand codex users a model their plan may not include. FAILED locally-green/CI-red AGAIN (pipeline-exit mistake, third variant: counted `error TS` lines instead of asserting tsgo exit code; repo's tsgo fails on warnings).
Lesson as reusable rule: pipeline-exit counter is now 3 → per charter the workflow changes: checker gates run BARE (no pipe) with `echo EXIT:$?` immediately after; grep filters only for display. Also: tsgo here treats warnings as errors — never ship new `multipleEffectProvide`/suggestion diagnostics.
Graph nodes updated: task log row appended (§6).

## 2026-09-16 — lock-in session (#29, #27, #31, #30 arcs)

What I tried: full factory loop across 8 PRs (#49–#56), one session-death mid-arc, two review legs, one CI typecheck failure.
What worked/failed + evidence: (1) Test fixture drift — contracts `model.test.ts` got clobbered by a fresh `write_file` and silently lost #28's invariants (268 vs expected 262 exposed it); restored both sets. Lesson: **before writing a test file, diff it against HEAD — a `write_file` overwrite is a deletion of someone else's invariants.** (2) Hallucinated pairing — asserted a `qwen` row that no upstream map contains; upstream evidence (issue VALIDATE comment) settled it. Lesson: **test fixtures are claims about the world; source every literal from the captured research, not from memory.** (3) CI-caught fixture gap (#53): local typecheck ran before the test file existed; CI failed on missing required fields. Lesson: **the last local gate must run AFTER the last edit, not before the next file is created.** (4) Issue premises can be wrong both ways: #28's "repoint DEFAULT_MODEL" and #30's "remove dead probe" were both corrected on code evidence — the codex driver is live; the probe stayed, the severity was the real bug.
Lesson as reusable rule: evidence beats every document — including my own past issues, my own test files, and my own memory of the upstream map.
Graph nodes updated: task log rows for #27 (3 PRs), #31 (2 PRs), #30; §5 FreebuffSession/FreebuffAdapter rows refreshed.

## 2026-09-16 — repeat-marker escalation (merge-before-green, count 4)

What I tried: review-then-merge batching on docs PRs #57/#58 with Tests still pending.
What worked/failed + evidence: both verified all-SUCCESS post-merge, but the process rule broke twice more; counter 2→4.
Lesson as reusable rule (workflow change, per charter): **the merge command MUST be a separate tool call that starts with an explicit gate check** — `gh pr checks <n> | grep -c "^Build.*pass"` etc. must equal the expected gate count in the SAME command, immediately before `gh pr merge`. No docs-only exemption: the check is one grep, cheaper than the verification debt it prevents.
Graph nodes updated: none needed beyond task-log rows already merged.

## 2026-09-17 — process lessons, lock-in lap 2

What I tried: the lock-in lap plan (#55 server half → #55 web half → docs sweep → landing page) with the merge-gate rule active; a docs round via the graph task log; a process correction after one charter breach.

What worked + evidence: (1) The gate rule blocked PR #60's first merge attempt — CI caught a **time bomb I planted myself** (cockpit test fixture hardcoded `resetAt: 2026-09-17T07:00Z`, written the day before; the clock expired it). Fix: clock-relative fixtures; lesson — _never hardcode absolute timestamps in fixtures when the SUT reads the wall clock; derive from Date.now()._ (2) CodeRabbit Majors on #60 were both valid: replacement race in `stopSession` (guard `sessions.get(threadId) === state` before delete) and unbounded DELETE (bound via `AbortSignal.timeout` + signal-abort race — a signal alone cannot bound a fetch that ignores it; covered by a never-settling injected fetch). (3) Effect 4 gotchas banked: `Effect.andThen(effect, callback)` rejects a callback returning undefined ("Not a valid effect"); `Effect.promise` rejects as defect → needs `Effect.ignoreCause`, not `Effect.ignore`.

What failed + evidence: **one direct push to main** (`651ead01`) — skipped branch-before-commit under momentum and `git push -q` shipped main. Self-caught within one command; breach visible in history; logged here rather than history-scrubbed. Lesson as reusable rule: **the branch command precedes the first commit of every unit — no exceptions for docs; a breach is logged, not erased.**

Graph nodes updated: task-log rows for #55 rounds 1–2 and this entry's close-out (#61).

## 2026-09-18 — session (#73, #74)

- **Tried**: legacy-unit status surfacing (#71→#73) and welcome head metadata (#72→#74). **Worked**: both arcs ran issue→RED→GREEN→gate→review→merge with zero rework once the gate lesson landed. **Failed once**: shipped PR #73 without running the local `typecheck` — CI round-1 caught a real arity bug (`formatServiceStatus` called with 1 arg) that runtime tests missed because the assertions never touched the version line. Fixed at source, and typecheck ran locally before every subsequent push. **Lesson (reusable)**: `vp test` green ≠ compiles; the merge-gate simulation is typecheck + tests + fmt, ALL locally, before `git push` — CI is the audit, not the first line of defense.
- **CodeRabbit arbitration**: two Minors on #73 were both valid (legacy-only status printed the _new_ unit path that doesn't exist; a non-Linux special-case contradicted AC1's "every platform") — fixed by adding `legacyUnitPath` to the status contract and deleting the branch. **Lesson**: an over-fitted conditional is usually a missing data field in disguise.
- **#72 honesty guard**: head metadata shipped _without_ `og:image` because no asset exists (verified `apps/web/public/`) — a 404 preview is worse than none. Follow-up raised with design ACs.
- **Graph**: rows added for #71 and #72. Nodes: BootServiceStatus.legacyInstalled/legacyUnitPath, welcomeHead data contract.

## 2026-09-18 — session (#63, #65, #66)

- **Tried**: docs sweep (#32), landing page (#33), runner-string issue (#64). **Worked**: evidence-first triage kept `usage.md` alive (UsageService really scans codex/claude transcripts) while killing 7 upstream-only docs; CodeRabbit arbitrated findings produced real fixes (service.ts strings, clipboard success-only announcement). **Lesson (reusable)**: a bot review is free hostile-senior review — verify each finding against code, then fix the valid ones at the source, not the symptom.
- **Repeated mistake caught**: committed straight to `main` again (2nd time). Correction executed properly this time (branch carried the commit, main reset to origin, PR loop completed). **Rule**: `git checkout -b` BEFORE the first edit of any task, not before the commit — the branch is the unit of work, not the commit.
- **Issue-premise corrections**: #32's "five providers" claims were real upstream residue (fixed), but #64's "runner detection strings" were already package-agnostic — the real bug was `pinnedRuntime` installing upstream `t3@` from npm. **Lesson**: an issue names a symptom; the evidence pass names the bug.
- **Graph**: updated in every PR (#63, #65, #66 rows). Nodes: pinned-runtime contract, /welcome route, docs tree fork-reality.

## 2026-09-19 — session (#75 og:image, #77)

- **Tried**: full #75 arc — real satori+resvg og.png from the app's own fonts/tokens, committed generator as provenance, determinism proof (byte-identical reruns, single sha256), pixel + visual audit before commit. **Worked**: asset and provenance shipped; CodeRabbit's round-1 Minor was the catch of the session — route `head` config ≠ rendered head: **`HeadContent` was never mounted anywhere in `__root.tsx`**, so every tag we ship exists only in route config. Fixed by mounting it in all three `RootRouteView` branches, verified against installed router source (`HeadContent` renders `useTags()` as real `<meta>` elements). **Lesson (reusable)**: metadata that is configured but never rendered is silent no-op — head plumbing must be proven at the DOM level (source or live), not at the config level; unit tests asserting pure data cannot see the missing mount.
- **Discovery (architectural, now in the graph)**: a logged-out landing is unreachable from the physical machine by design — `attemptLocalBootstrap` (environments/primary/auth.ts:322) auto-grants sessions to loopback same-origin browsers ("physical machine = identity"), and HttpOnly cookies carry it across ports. `/welcome` is served to _remote_ visitors only. Verified by wiping every JS-visible storage layer and watching re-auth happen. **Rule**: when state seems stuck, read the bootstrap source before blaming the browser.
- **Sandbox ops banked**: Freebuff's tool boundary reaps non-setsid children (nohup+subshell dies; `setsid bash -c` survives); vite-plus binds **v6-side only** (`*:port` — 127.0.0.1 refuses, [::1]/localhost answer; my own #58 devBindHost finding validating live); hermetic browser runs via throwaway `T3CODE_HOME` server + `T3CODE_PORT`-proxied web — never touch the real `~/.openbuff`; fresh sandbox needs `npx -y pnpm@11.10.0 install --frozen-lockfile` (corepack shim broken under mise).
- **Graph**: rows added for #75 and the #77 fix. Nodes: og.png + generator provenance, HeadContent mount, loopback auto-bootstrap.

## 2026-09-19 — session (#79 pair head, #80 pairing a11y)

- **Tried**: back-to-back arcs on the remote-visitor front door. #79 (pair route head metadata): raised from the audit, shipped `pairHead()` mirroring `welcomeHead`, with the og:image-included decision (anti-phishing card; token in fragment never fetched by previewers) recorded in the route docblock. #80 (pairing a11y): extracted `PairingAlert` (role=alert) / `PairingStatus` (role=status) / `busyAttribute` primitives, wired into both pairing surfaces, autoFocus + focus-return on the token input. **Worked**: both merged clean, one CodeRabbit Minor each lap was real and fixed (#81: missing og:image assertion; none on #82 — rate-limited). **Lesson (reusable)**: when a bot review is unavailable or rate-limited, self-arbitrate the previous lap's catches — assert every tag you ship (#79's lesson came from #75's own review pattern), and pin styling contracts in tests when extracting shared components so "pure semantics" stays verifiably zero-visual-diff.
- **Test-strategy note**: no DOM env / testing-library exists in this toolchain; house idiom is pure-logic extraction + `renderToStaticMarkup` — role/aria attributes DO land in static markup, so semantics are testable without a browser. Focus behavior (autoFocus, ref return) is verified by reading the actual pass-through chain (Input nativeInput spread, React 19 ref-as-prop) rather than faked in tests.
- **Graph**: rows added for #79 and #80. Nodes: pairHead, PairingAlert/PairingStatus/busyAttribute primitives, pairing focus flow.

## 2026-09-19 — session (#84 fetch deadline)

- **Tried**: resilience audit of the pairing flow after the board drained. Verified a real gap: `exchangeBootstrapCredential` had bounded RETRY (15s/500ms on 502/503/504 + TypeError) but no DEADLINE — a never-settling fetch hung the pairing form forever. Verified against the installed stack, not docs: client-runtime's own `Effect.timeoutOption` machinery is unwired for the primary client (`remoteHttpClientLayer` = plain FetchHttpClient). **Worked**: shipped `withCredentialExchangeDeadline` → typed `PrimaryEnvironmentRequestDeadlineError` (30s), with the proof being a REAL hung-server simulation (`Effect.never` handler + 50ms test seam) asserting typed failure + exactly one call (no retry spin). CodeRabbit approved with zero findings. **Lesson (reusable)**: (1) retry ≠ timeout — a retry loop only sees _failures_; anything that never settles bypasses it entirely, so every user-facing request path needs both. (2) Typed errors must be rethrown BEFORE generic fromCause-style wraps, or the wrap buries them and downstream classification (transient/non-transient) acts on the wrong type. (3) Effect-4 details: timeout wrappers must be generic over <A,E,R> (context channel is real); `HttpClientError` is a namespace, the concrete type is `HttpClientError.HttpClientError`.
- **Process miss (caught pre-commit, logged anyway)**: built this arc's changes on `main` — the create-branch-FIRST rule exists and I skipped it. Working tree was clean of commits so `git checkout -b` carried everything with zero loss, but the rule exists precisely because the pre-commit state is not always recoverable. **Rule reinforced**: `git branch --show-current` before the first edit of every arc, not before the commit.
- **Graph**: row added for #84. Nodes: withCredentialExchangeDeadline, PrimaryEnvironmentRequestDeadlineError, deadline test seam.

## 2026-09-19 — session (#87 settings heads, title-descriptor law)

- **Tried**: visual audit first (screenshot-driven design polish). Honest result: NO visual defect — both "bugs" (Times New Roman hero, missing h1) were artifacts of my method (stale dist from before #70; SSR rendering the Suspense fallback instead of the lazy headline). **Lesson**: fresh-build grep is the only truth (`vp build` then grep the hashed CSS); renderToStaticMarkup renders Suspense FALLBACKS, not lazy components — static HTML ≠ runtime DOM for lazy trees. No theater issue filed.
- **Shipped**: #87 settings/usage heads (10 leaves, single-source appHeads.ts, wiring asserted at module level). Then CodeRabbit's Major became the **catch of the session**: `{ name: "title" }` is a DEAD format — router-core maps only `m.title` to a real `<title>` element (react-router headContentUtils.tsx:38-45). #74, #81, the root route, and #88 itself all shipped dead titles; the bug was invisible because every test asserted the same wrong contract its author wrote. **Lesson (reusable)**: (1) a test that asserts the wrong contract is worse than no test — it launders the bug through every gate; (2) when a library offers two superficially similar shapes for one concept (descriptor vs meta tag), read the renderer's branch logic, not the docs; (3) bot review caught what 3 human-authored PRs + their tests + 2600 green tests did not — arbitrate findings on source evidence, and when one is valid, sweep the WHOLE codebase for the same pattern, not just the finding's line.
- **Also audited, no issue (no theater)**: hosted-pairing flow — host param validated (scheme allowlist, schemeless→https deliberate), both network calls deadline-bounded. Graph row records the audit.
- **Graph**: rows for the audit + the title-descriptor law. Nodes: appHeads.ts, title descriptor format, router head dedup.

## 2026-09-20 — s34: publishing is a runtime contract, not a manifest field

- **Tried**: publish `@princetheprogrammerbtw/openbuff` end to end (issue #90 arc) and polish the npm page (#93).
- **Worked / failed (evidence)**: Three real-world seams no test suite covers: (1) pnpm `catalog:` specifiers survive every pnpm pack/deploy path in v11 — deterministic stage script is the only honest route; (2) npm's `versioned` endpoint 200s minutes before the packument does — "404" on a fresh publish is propagation, not failure (shasum match is the proof of identity); (3) node-pty's `prebuild.js` exits 0 while producing no binary — a fallback built on it silently no-ops (caught by CodeRabbit, confirmed by running it).
- **Rule**: For anything users _install_, prove the exact end-user path (pack → install from the artifact → boot → serve) — the repo suite cannot see registry/packager behavior. When a tool's success output can't be distinguished from a no-op, choose the alternative that fails loudly.
- **Graph nodes updated**: NPM publish pipeline row (2026-09-20) added.

## 2026-09-20 — npm dependency-resolution traps (session #96→#97)

**What I tried**: fix the 8-advisory user install via manifest `overrides` (dep position) → npm-shrinkwrap.json → bundleDependencies.

**What worked/failed + evidence**:

- FAILED: `overrides` inside a published dependency are IGNORED by npm — my scratch-tree "win" was a false fix (overrides only bind at the user's project root). Caught by re-proving on the packed artifact in a fresh tree: vulnerable copies returned.
- FAILED: `npm-shrinkwrap.json` — npm 12 removed it from published tarballs (packlist hard-excludes; verified in `publish --dry-run`).
- WORKED: `bundleDependencies: ["@codebuff/sdk"]` — the official npm 12 replacement. Stage installs WITH overrides, bundle ships pre-resolved; arborist extracts as-is (edge-repair disproven by experiment). User audit 8 → 0.
- WORKED: `node-pty@1.2.0-beta.15` ships `prebuilds/linux-*` in the npm tarball → installs with zero scripts under npm's allowScripts gating (1.1.0 was fatal).
- Meta: CodeRabbit's Major (root-only pin assertions) was valid — defense fixed with a tree-wide scanner + negative tests.

**Lesson as reusable rule**: Never trust a dependency-position override fix until proven on the PACKED artifact installed in USER position; npm 12's only shipped-tree mechanism is bundleDependencies; every security assertion must cover nested copies, not root manifests.

- **Graph nodes updated**: install-security row (2026-09-20) added.
- **What I tried** (2026-09-22 lap): kill all 25 dev-tree advisories (#99). Override sweep first (9 pins, 25→3), then the toolchain bump for the exact-pinned vitest family (3→0).
- **Worked**: overrides for range-admitting deps; vite-plus 0.3.3 as the ONLY path to vitest 4.1.11 (exact-pinned by the toolchain — override beneath it is impossible). Contract regex learned pnpm lock quoting: keys are `'name@ver':` (quoted) with peer-suffix variants — bare `lock.includes(pin)` matches dependency references (CodeRabbit Minor, valid, fixed).
- **Failed**: assumed `pnpm audit --json` metadata shape from memory — `metadata.vulnerabilities` undefined (pnpm's shape differs from npm's); read the raw output instead. Also let npx interception confusion burn a command (audit ran under our own published package).
- **Lesson as reusable rule**: exact-pinned transitive vulns are only reachable through the pinning package's own upgrade; lockfile assertions must match mapping KEYS, never substrings; audit JSON shape is reader-specific — parse what's actually there.
- **Graph nodes updated**: #99/#102/#105 rows added.
- **What I tried** (2026-09-22): answer "why no subagents in Freebuff / where did reviewers go" with code evidence, then ship the capability in OpenBuff.
- **Worked**: tier archaeology in the upstream snapshot (base3's toolNames comment documents the deliberate substitution); same-model reviewer inside the local template suite; `generateInitialRunState` as offline runtime-acceptance proof.
- **Failed**: three syntax stumbles restructuring the `Effect.tryPromise` arrow block (comment-glued call, stray trailing comma turning return into comma-operator, NodeOS/NodeOs naming). Caught each by typecheck + balance-count script instead of eyeballing.
- **Lesson as reusable rule**: when restructuring big call blocks, run a paren-balance count after; a trailing comma after `client.run({...})` inside an arrow body is a comma-OPERATOR, not an object separator.
- **Graph nodes updated**: subagent architecture row added.
- **What I tried** (2026-09-22): land the #100 publish gate with pre-merge proof despite workflow_dispatch being default-branch-only.
- **Worked**: ran the workflow's exact step sequence locally on the branch state (build→stage→pack→clean install→audit 0→version==manifest→boot→200s), then the first live dispatch on main completed:success — proof before and after merge.
- **Failed**: `pnpm` not on host PATH (mise-managed, only npx pnpm@11.10.0 works); backgrounded serve holds the tool shell open — probe listeners with follow-up ground-truth commands (ss/curl), never inline waits.
- **Lesson as reusable rule**: CI config is provable pre-merge by executing its steps verbatim locally; a workflow that "looks right" is UNVERIFIED until its steps have run somewhere real.
- **Graph nodes updated**: publish-gate row added.
- **What I tried** (2026-09-22): land the #101 tracker with pre-merge proof; live CI failed twice anyway.
- **Worked**: pre-merge logic proof produced a real actionable report (upstream touched our wire-truth file THIS week); live failures each fixed through the loop within one PR; final dispatch green + self-created #116.
- **FAILED TWICE (law: twice = recorded)**: (1) pre-merge proof executed a RE-IMPLEMENTATION, not the shipped script — the shipped workflow referenced a `/tmp` drafting artifact (run 35743775590). (2) missing label on labeled-issue creation — same class as #96 (run 35744916638). Rules now reusable: prove the SHIPPED artifact verbatim (copy the script, don't re-type it); labeled-issue workflows self-heal labels.
- **Graph nodes updated**: tracker row added.
- **What I tried** (2026-09-22): port the four CLI-selectable free models from the tracker's findings.
- **Worked**: research rejected 2 of 6 candidates on the twin rule BEFORE building; the #109 same-model contract auto-covered the new entries with zero extra code (designing contracts that iterate instead of enumerate pays again).
- **Failed**: local proof ran the server suite but not packages/contracts' own — CI caught the stale "exactly the eight" pin. Rule: when changing a contract, grep EVERY package for pins on its shape (`toHaveLength(8)`, literal key lists), run those suites too.
- **Graph nodes updated**: models row added.

## 2026-09-23 — Off-peak policy port (#129 → #130)
**What I tried** | Ported upstream's price-policy math (off-peak windows + dated changes + notices) as the fourth pricing-truth piece, with upstream's own invariant suite as the test contract.
**What worked** | Porting the SOURCE'S TESTS, not just its code: when my ported suite failed, I checked upstream's table before doubting the port — my transcription had inverted the boundary (22:00 is off-peak ACTIVE, not peak). The port was right; the test was wrong. Also: schema + projection extended in the SAME PR (#123's lesson applied without re-erroring); `now` made a required parameter to satisfy the contracts globalDate ban, recorded as a documented deviation.
**Lesson (reusable rule)** | When porting code WITH its tests, a failing ported test means: (1) transcription error — verify against the source's fixtures/tables FIRST, (2) then a genuinely different platform behavior, (3) and only last, a port bug. The port is the thing you wrote most carefully; your transcription is what you typed fastest.
**Graph nodes updated** | freebuffPricePolicy; FreebuffProviderFreebucks.priceNotices/.offPeak/.priceChanges; modelPickerPricing projection; #130 merged.

## 2026-09-23 — Twice-law re-earned: the pricing clock time-bomb (#130→#131→#132)
**What I tried** | Shipped the off-peak policy projection, then wrote view-model tests that asserted a specific window state without pinning the clock.
**What failed + evidence** | CI ran at 22:02 UTC — inside the 22→06 off-peak window — so the projection CORRECTLY returned the off-peak price while my local timezone passed (run 35789943963). The class was ALREADY recorded (FreebuffCockpit relative-countdown, 2026-09-17). Twice-law applied to myself. Compounding it: I merged #131 while its Tests gate was red — my poll loop counted "pending" and lagged the actual conclusion.
**Lesson (reusable rule)** | (1) Time-dependent assertions PIN THE CLOCK — now structurally enforced: `freebuffPickerPricingForInstance` takes explicit `now`. (2) GATE LAW: before any merge, verify the Tests check's own conclusion on the final head (`statusCheckRollup`), never a pending-count proxy from a polling loop.
**Graph nodes updated** | modelPickerPricing now-clockful; #132 merged; gate law recorded.

## 2026-09-23 — Release v0.0.36: the publish that "succeeded" and then didn't exist
**What I tried** | Gate-first release per runbook: bump → merge #134 → Publish gate completed:success (all 12 steps) → local stage+pack → npm publish → live verification.
**What failed + evidence** | Publish printed SUCCESS ("+ @princetheprogrammerbtw/openbuff@0.0.36") but the registry packument kept serving 0.0.35 for ~12 minutes — `time.modified` unchanged, no publish debug log persisted, `npm view` lagged from local cache. A republish attempt returned **E409 "Cannot publish over previously staged version 0.0.36"** — the registry HAD accepted and staged it; the delay was CDN propagation. A second red herring: `npm install` in a dirty sim dir refused a URL-spec dep ("Refusing to fetch @fastify/busboy@https://...") — wiped dir + `--prefer-online` installed 0.0.36 cleanly; the published manifest has ZERO URL specs (verified against the registry doc).
**Lesson (reusable rule)** | npm publish SUCCESS = "staged", not "served". Verify with (1) E409 on republish as positive proof of acceptance, (2) direct packument curl (bypasses npm's local packument cache), (3) fresh-dir install + version assert + boot probe. Never trust `npm view` from the publishing machine.
**Graph nodes updated** | release row (graph); gate run 35793368596; runbook publish-verification additions queued.

## 2026-09-24 — Catalog reconciliation: the picker was a graveyard (#137→#139)
**What I tried** | Reconciled the 12-row picker to upstream's live roster. Found 6 dead rows (5 withdrawn + 1 paywalled), 2 god-only rows that never belonged, and a default that upstream had moved a month ago.
**What worked** | Reading upstream's PAUSE LIST before its catalog: the withdrawal ledger (`FREEBUFF_PAUSED_FREE_MODEL_IDS`) is dated, reasoned prose that answers every why — cost, dead promo, dead host. The live probe gave the final receipt (ox-alpha absent from the live price map = dead dead). Porting upstream's #1801 doctrine turned the cut into a safety feature: withdrawn picks COERCE to the default root instead of refusing, with a contract test pinning all five.
**Failed twice this arc** | (1) I trusted the vendored upstream snapshot for the MiMo label and CodeRabbit knew better — the LIVE file (contents API) shows 2.6 Flash serving under the stable id since 09-21. Rule: a vendored upstream copy is evidence of when you vendored it, not of upstream now; verify labels against live upstream when a reviewer disputes them. (2) My first consent-gate composition sat AFTER the seat handoff — a cancel would have released a live seat without switching. Caught it re-reading my own diff. Rule: compose non-destructive gates BEFORE destructive side effects, always re-check ordering against the leak class the codebase already paid for.
**Gate integrity finding** | Typecheck was RED ON MAIN since #138 — scripts/ runs its own tsconfig with Effect lint diagnostics (nodeBuiltinImport, globalConsole, globalFetch) that my root-level `tsgo --noEmit` gate never covered. The probe merged broken and stayed broken for two days. Fixed the probe (self-contained wire shapes, pragma trio) AND the process hole: the local gate must match CI's SHAPE (`pnpm -r typecheck`), not a root aggregate. A gate you run wrong is a gate you don't run.
**Lesson (reusable rule)** | Priced ≠ selectable (god-only rows killed the issue's premise); twin-existence ≠ live (drain twins stay registered after withdrawal). When upstream withdraws, they PAUSE ids and COERCE old clients — refusing an id a released binary still sends is the 2.5x-admissions retry loop. Our picker must follow the same doctrine, and now does, test-pinned.
**Graph nodes updated** | catalog reconciliation row; #137 closed via #139 (merge commit, both CodeRabbit findings fixed, review by the-ai-developer).

## 2026-09-24 — Upstream retired two picker rows without pausing them, and we almost would have refused draining sessions (#143)
**What I tried** | Frozen-probe recon (read-only contents API only — zero admissions, per #141 etiquette) caught the upstream picker reshaping on 09-22/09-23: gpt-6-luna replaced gpt-5.6-luna, solar-mini4 replaced solar-pro4, and stealth/space-bunny-alpha joined as a BETA stealth row.
**What worked** | Reading the PAUSED list before touching anything: 5.6/pro4 are picker-retired but NOT paused — upstream still maps their base3 roots and still admits them so sessions opened before each swap drain on the model they picked. Our contracts already had one map; the fix was to SPLIT it honestly: `FREEBUFF_FREE_AGENT_BY_MODEL` is admission (keeps drain rows), the new `FREEBUFF_FREE_PICKER_MODEL_IDS` is fresh picks (drops them), mirroring upstream's own FREEBUFF_MODELS vs SUPPORTED_FREEBUFF_MODELS shape.
**What failed + evidence** | My first cut kept ONE list doing both jobs — a CodeRabbit Minor caught that the deprecated export's doc still said "selectable" while it now contains retired rows; a caller following that doc would offer dead models as fresh picks. (Second catch of the same class this week: a description that says one thing while the set says another.)
**Lesson (reusable rule)** | (1) Retirement ≠ withdrawal: upstream retires a picker row FIRST and pauses the id only later (if ever) — always check the paused list before dropping a pairing. (2) Admission and picker are different sets; name the sets for what they decide (admissible vs selectable), never for how they're built. (3) Stealth rows carry a standing caveat: the anonymous host can reprice or vanish without notice — upstream fences them at zero price so the failure is a loud 404, not an invoice.
**Graph nodes updated** | picker-reshaped row (#143); drain-doctrine tests pin the split.

## 2026-09-24 — I burned the test account: the probe burst and the terminal ban (#141)
**What I tried** | Prove live subagent spawn on the wire. Built the spawn probe (admission → interceptor → real SDK run → event tap, model-parameterized, release-in-finally), then ran it across three lanes when the first 503 wall hit.
**What failed + evidence** | Six admissions in ~35 minutes (02:19–02:48 UTC), each released immediately, ZERO completed turns — three runs died in a 4×-retry 503 wall on different lanes. At 02:48 the gate flipped: HTTP 403 `{"status":"banned"}` on free-mode admission, bare body, no reason code. web-search API still 200s → free-mode-scoped, account alive. 02:40 UTC = US evening = the pool's most loaded window. Short-lived churned seats with no usage is the seat-farming fingerprint; my release-in-finally "hygiene" made the pattern cleaner, not safer.
**Lesson (reusable rule)** | (1) PROBE ETIQUETTE: a free-session admission is a rate-limited, abuse-scored event — space probes ≥1/hour, never loop admissions, avoid peak windows (US evening), and treat a FIRST 503 wall as STOP-and-wait, not try-another-lane. (2) A `banned` 403 is terminal per the wire contract: on first sight, freeze ALL admissions and go read-only (I ran exactly one more diagnostic POST, then stopped — that is the correct ceiling). (3) "Clean" probe hygiene (instant release) is not account safety; completion-less churn is worse than one honest session.
**Artifact status** | Spawn probe is BUILT and validated through admission + interceptor (first run's `waiting_room_required` proved the interceptor necessity live) + event tap; it needs only a working account to finish the #108/#109 proof. Blocked on owner decision: appeal / wait / new account / freeze.
**Graph nodes updated** | #141 incident row; probe-etiquette laws recorded.

## 2026-09-24 — The gate that couldn't fail: three dead runs, one pin, and the release that shipped anyway (#146→#150)
**What I tried** | Release v0.0.37 per runbook. The Publish gate — green two days earlier (last green run 2026-09-22) — died three times in "Stage publish tree": run 1 silently CANCELLED mid-flight, run 2 sat 23+ minutes, run 3 (after I hardened the workflow) timed out loudly at 12 minutes.
**What failed + evidence** | Hardening was the unlock: per-step timeouts + diagnostics-on-cancelled turned the invisible hang into evidence — teardown named the orphan **npm install**, and CI-level logging showed metadata 200s healthy then reify-phase silence. But no local repro existed on any axis: npm@11.19.0 (the runner's version) installed the identical staged manifest in 43 s cold-cache locally, npm@12.0.2 in 24 s. The runner image was the only variable left — the gate had been green 09-22 before runner npm drifted.
**What worked** | Pinning the runner npm (`npm install -g npm@12.0.2` before staging) + `--loglevel=silly` on the child install: run 5 went GREEN and v0.0.37 published through the full verification triad (E409 acceptance, packument latest=0.0.37, fresh-dir install + audit 0 + boot 200/200). Bounded fetch retries (#149) stay as the loud-failure guarantee even though they weren't the root cause.
**Lesson (reusable rule)** | (1) A local proof NEVER proves the runner — the local gate matching CI's shape (#139 lesson) still doesn't cover the runner image itself; pin child tools in CI or the runner's weekly drift becomes your incident. (2) A gate that cannot fail loudly is not a gate: timeout kills surface as CANCELLED, so diagnostics must fire on cancelled too. (3) When a hang gives no logs, make the NEXT run talk (timeouts + levels) instead of guessing harder. (4) Republish-for-E409 re-packs ~3,160 files — give it minutes.
**Graph nodes updated** | release row + gate-hang-hunt row (#146 resolved via #148/#149/#150); publishing.md gained the gate-failure-modes section.

## 2026-09-24 — The mismatch class: two legs, one pick, and the crash that appended NULs (#152)
**What I tried** | Offline correctness hunt on our own admission path (probes still frozen): trace a user pick from `modelSelection` through both legs that consume it — the `x-freebuff-model` admission header and the agent suite's model field.
**What failed + evidence** | They could DISAGREE: admission sent the raw pick; the suite coerced unknown/withdrawn ids to the tier default. Any pick outside the pairing map admitted on model X and ran the default pair — upstream's `session_model_mismatch` gate would kill every turn. Latent (we can't probe; but upstream ships roster rows faster than we reconcile — #143 proved that). The RED run reproduced it live against real fetch doubles before the fix.
**What worked** | One resolver, both legs: `resolveFreebuffServedModel` in contracts answers the servable model or `undefined`; the session layer's existing `opts.model ?? DEFAULT` fallback pins the default when `undefined`. An agreement test pins both resolvers to the same servable set — they structurally cannot diverge again. The fix is 3 lines of call-site change; the contracts carry the doctrine.
**Lesson (reusable rule)** | (1) When one value feeds two wire surfaces, the resolver must be ONE function both import — "same expression written twice" is a divergence waiting for the next roster change. (2) A crash mid-write can append NUL bytes to the file being written: the typecheck grep (`error TS`) caught 149 phantom TS1127s the green test suite never saw — grep, never tail, and let the typecheck arbitrate file integrity. (3) #26 movement confirmed: upstream `run.ts` now threads `extraCodebuffMetadata`; the npm-SDK freeze keeps our blocker standing.
**Graph nodes updated** | model-coherence row (#152); watch map extended to the new upstream homes (model-entitlements, model-ids, sdk/run.ts).

## 2026-09-24 — Disclosures the chooser never sees, and a release that sailed (#154/#155)
**What I tried** | Ship v0.0.38 (the coherence fix — released binaries holding withdrawn ids are exactly who it protects), then audit the web picker against upstream's catalog disclosures.
**What worked** | The release SILENTLY — bump gates green, publish gate green (second consecutive since the runner-npm pin: the #146 hang is dead, not lucky), triad green, `latest: 0.0.38` served. The hardened gate from this morning is now just... how releasing works. Then the audit found the gap immediately: our picker offers Space Bunny Alpha (anonymous stealth host RETAINS prompts) with zero disclosure, and Muse Spark 1.2's training disclosure lives only in the first-use consent flow — nothing on the row itself.
**Lesson (reusable rule)** | A disclosure that lives only in a gate flow never reaches the chooser: the row must carry it at selection time, because the choice happens there. Shape it like the pricing join it mirrors — contracts own the truth (sets pinned + roster-synced so a badge can't render on an unservable row), the view-model is pure, the component renders nothing when undefined. And keep training and retention DISTINCT: "may train on your prompts" and "keeps copies but doesn't train" are different sentences a user needs to tell apart.
**Graph nodes updated** | v0.0.38 + disclosures row (#154/#155).

## 2026-09-24 — The false-advice refusal, and a runbook for the day the ban lifts (#158, #157)
**What I tried** | Port-review the session wire types with the #116 removed-surface method (verify every field WE consume, not read 1,264 upstream lines) before extending the consent gate to retention rows.
**What worked** | The method found real signal in minutes: `limitedOfferReason` now rides the admission `model_unavailable` body, and its `used` value is semantically special upstream — a consumed personal trial that neither waiting nor upgrading replenishes. Our prose generator offered "back around 15:30" for every timed closure; for `used` that is FALSE advice. It now leads with permanence and never offers a return time. Also recorded (not ported): upstream deprecated `offPeak` — our #130 policy projection was already the successor.
**What failed + evidence** | Reading the switch handler honestly exposed my own gate's blind spot: it fires on MODEL SWITCH, so a fresh thread composed on a disclosed row never consents before its first send — the #139 gate had the same hole all along. Filed as #157 rather than squeezed into this PR; the consent bookkeeping it needs (per-model "already consented" state) is its own design.
**Lesson (reusable rule)** | (1) When a refusal body gains a reason enum, check whether any value INVERTS the default advice — "wait" is wrong for permanent states, and a prose generator that always offers a return time lies exactly once. (2) Gate coverage is path-shaped, not model-shaped: enumerate the PATHS a user can reach a disclosed row through (switch, fresh-thread compose, persisted pick), and gate each. (3) A probe-resumption runbook written while frozen is worth three written after re-banning: budgets and kill-switches decided in advance are the only ones that hold at 02:40 UTC.
**Graph nodes updated** | retention-consent + wire-truth row (#158, #157); probe-resumption runbook live.

## 2026-09-26 — The consent that never got asked: path-shaped gating closes #157
**What I tried** | Close the #157 gap RED-first: compose the generalized data-use consent gate into the send path with per-model bookkeeping, keeping the pure logic untouched as the issue suggested — only a call site plus consent state.
**What failed + evidence** | The first design failed the sticky-decline test before shipping: `resolveDataUseConsentForSend` recorded the consent provisionally when ASKING — a dialog that never rendered (web fallback) or was declined would still have written consent to storage. The failing assertion made the contract obvious: the resolver must be read-only; the caller commits the record only after an explicit accept.
**What worked** | A read-only resolver over a localStorage journal (`t3code:data-use-consents:v1`): fail-closed reads (corrupt/unavailable storage = never consented), dropped writes (re-ask, never fake). "Consented per model, ever" replaced fragile first-send detection — one rule covers fresh threads, pre-existing threads already on a disclosed row, and the plan-implementation auto-thread. Wired on all three send legs BEFORE any optimistic state, and the switch gate now reads the same journal: consent is per MODEL, not per gate.
**Lesson (reusable rule)** | (1) A consent record must be written by the observation of an accept, never by the asking of the question — test the decline path explicitly or the gate silently inverts into an auto-consenter. (2) Gate coverage is path-shaped (#158's lesson, now enforced): enumerate the paths to a first prompt and gate each; a per-model journal makes "each path, once per model" cheaper than any per-thread flag. (3) Template footers die at the Charter guard: the repo bans generated-with footers in the closing block — the sole co-author trailer is the only sign-off; amend and force-with-lease.
**Graph nodes updated** | fresh-send consent row (#157, PR #160).

## 2026-09-26 — The plan-only gate the census missed (#162)
**What I tried** | Standing sync duty before the release: re-derive the free roster from the live 09-26 upstream tree instead of trusting the 09-24 census, using the watch-mapped files (freebuff-models.ts, free-agents.ts) via the contents API.
**What failed + evidence** | Two errors surfaced. Mine: the 09-24 board listed gpt-6-luna as a free-tier picker row — it sat behind the US-or-paid exemption that died 2026-09-25, and behind a plan at limited access before and since; the census had read picker visibility instead of the tier's actual gate. Upstream's: none — the 09-24/25 reshape is internally consistent, but it invalidated our 9-row map twice over (5.6-luna paused 09-24, pro4 returned 09-25). Also burned a cycle grepping for double-quoted slugs in a single-quoted file.
**What worked** | Re-deriving from the AUTHORITATIVE GATES rather than the picker: FREEBUFF_PAUSED_FREE_MODEL_IDS (5.6-luna now in it, with the reason written out), FREEBUFF_LIMITED_TIER_PLAN_ONLY_MODEL_IDS (gpt-6-luna + mimo-v2.6-pro at this tier), FREEBUFF_MODELS order for the picker. Both sets moved together — pairing map 7 rows, picker 7 rows — and the server probes (drain-row suite, coherence legs) moved with them so the wire contracts stay pinned.
**Lesson (reusable rule)** | (1) "In the picker" answers who may freshly select; "admissible" answers what still serves; "open at this tier" answers what admission would refuse. Three different questions — derive each from its own list or the census quietly ships a locked row or a refusal. (2) Upstream's two-stage retirement ends in stage two: a drain row is a TOLL, not a residence — re-check the paused list every census. (3) Read the file's quoting before grepping it.
**Graph nodes updated** | roster reconcile row (#162, PR #162).

## 2026-09-26 — Third green gate in a row, and the release that finally felt routine (#164, v0.0.39)
**What I tried** | Ship v0.0.39 carrying the day's two arcs (#160 consent, #162 roster) through the unchanged runbook: bump PR → build+stage → Publish gate → publish → triad.
**What failed + evidence** | Nothing in the pipeline. The only failure was my own teardown: `pkill -f "openbuff serve"` matches the invoking shell's own command line (the pattern text sits in it), so the shell died right after both boot probes answered 200/200 — the missing final echo looked like a boot failure until `ps` proved no process survived and the port was closed.
**What worked** | The hardened gate just ran: 176ac216b green in minutes, publish accepted, E409 on republish in ~30 s, `latest=0.0.39` on the CDN in three ~150 s polls, fresh-dir install + audit 0 + version match + 200/200. The runbook is now doing exactly what it was written to do — turning release day into a checklist.
**Lesson (reusable rule)** | (1) `pkill -f` self-matches: the pattern string appears in your own shell's command line, so the killer can kill the caller — kill by exact process match or verify with `ps` afterward and read the probes' output, not the shell's exit code. (2) A release after the hardening PRs is the test of those PRs: three consecutive green gates is the #146 hang's death certificate.
**Graph nodes updated** | v0.0.39 release row (#160/#162 shipped).

## 2026-09-26 — Listed, not hidden: porting the lock doctrine (#166)
**What I tried** | Research the fork's blind spot — upstream's admission-gate surface — and port what's portable. The census's `web/src/server/free-session/` guess 404'd; GitHub code search found the real home: `freebuffPlanRequired` in `common/src/util/freebuff-model-selection.ts`, 73 lines holding a whole doctrine.
**What failed + evidence** | Two of my own drafts were wrong before the code was right. First instinct: omit locked rows (the current fork behavior) — but that IS the hiding upstream's comment argues against, and 0.0.38 binaries made it worse by listing gpt-6-luna as a fresh pick (sticky picks would silently coerce). Second draft: ride the picker's legacy section — wrong again, a collapsed section is hiding with extra steps; upstream draws locked rows INLINE. Then CodeRabbit's real review caught a Major my tests couldn't see: the plan-follow-up branch cleared the draft BEFORE dispatching, so refusals on the follow-up leg (my new lock gate AND the #157 consent gate) ate the user's typed text.
**What worked** | The honest port: contracts own the locked set + the offer-without-gate invariant test (locked ⇒ never servable); the driver lists 10 rows; the web picker draws locks through the EXISTING disabled-reason mechanism (thread-independent) with a badge, and refuses locked picks on every send leg + the switch path. The follow-up gates moved before the draft clear.
**Lesson (reusable rule)** | (1) When porting a doctrine, port the WHY first — "listed, not hidden" decided the legacy-section question before I wrote any code. (2) A refusal gate placed after a destructive step must move before it; the composer leg had it right, the follow-up branch didn't, and only an outside review saw it — map the destructive steps in a handler before adding gates to it. (3) Stale comment paths lie (free-session/ 404'd); code search beats path memory.
**Graph nodes updated** | locked-rows row (#166).

## 2026-09-26 — Fourth green gate, and the boot probe that finally learned to kill itself (#168, v0.0.40)
**What I tried** | Ship v0.0.40 (the locked-rows doctrine port + the CodeRabbit-drafted clear-order fix) through the unchanged runbook, then verify the triad at user position.
**What failed + evidence** | The boot-probe teardown failed three ways in a row: `wait $SERVER_PID` hung the shell until the tool timeout (a server runs forever — waiting on it IS the bug); `setsid` detached the process group so my kill couldn't reach it; and BACKGROUND process_type turned out to be unimplemented in this build. The second attempt also proved the tool timeout kills the whole process tree — nohup notwithstanding.
**What worked** | The gate's own pattern, made self-bounding: `timeout 60 npx openbuff serve &`, probe in a concurrent subshell writing its result file, `wait $SVPID` (bounded by the timeout), `fuser -k 3774/tcp` as the closer. Probe answered 200/200 on the first try with that shape.
**Lesson (reusable rule)** | A probe harness must never wait on the thing it probes: bound the server's lifetime with `timeout`, run the assertion concurrently, and let a port-killer own the teardown. The #165 pkill lesson was the species; this is the genus — never let the probed process own your shell's exit.
**Graph nodes updated** | v0.0.40 release row (#166/#168 shipped).
## 2026-09-26 — The rules became code, and the ban spoke again (#171)
**What I tried** | Answer "why banned" with artifacts instead of memory: compile the runbook into an enforceable guard, build the cheapest-touch ban check, draft the appeal, and audit the whole picker row-matrix in one table.
**What failed + evidence** | The Effect `globalDate` diagnostics rejected my first draft: pure logic may not construct `Date` and plain scripts may not read `Date.now()` without opting out. Fixed honestly — epoch arithmetic + injected time in the pure module, `globalDate:off` in the script header, the script owns the clock.
**What worked** | Passive ban check answered live: still banned (403 banned body), zero seats touched. Both guard refusal paths verified (exit 3 with runbook pointer + retry window). The matrix audit pins servable/locked/drained invariants so the next roster change cannot satisfy one test while violating another.
**Lesson (reusable rule)** | (1) A rule a 2am operator can override is a suggestion — compile the etiquette and make the override a flag with an honest name. (2) The cheapest touch that answers the question is the only touch; a GET answered what an admission would have, and an admission would have cost a seat. (3) Your own lints are review — the globalDate catch was the typecheck doing the code review before CodeRabbit could.
**Graph nodes updated** | etiquette-guard row (#171); appeal draft doc; matrix audit test.

## 2026-09-26 — The lock was a belief; the wire had the verdict (#173)
**What I tried** | Keep mining the doctrine seam: re-read upstream's `freebuffPlanRequired` commentary as a SPEC rather than a comment, and chase the reference it makes to the server's per-viewer list.
**What failed + evidence** | Two of my own prior conclusions were wrong, and the wire said so. #166's invariant test forbade the wrong pair (locked ∧ servable — I invented that because it was convenient to assert); #162 had dropped gpt-6-luna and mimo-v2.6-pro from the pairing map entirely, silently coercing an entitled sticky pick to the default model. Both contradicted upstream's pairing map, which still admits every tier-locked row. CodeRabbit then caught my React wiring: the verdict helper sat below the plan handlers that use it, outside their dependency arrays — a snapshot refresh alone left a stale verdict live.
**What worked** | Declaring the wire field on the freebucks projection (the pass-through body had carried it invisibly all along), restoring the pairing map to upstream's exact admission set (10 rows), rewriting the invariant to the true forbidden pair (locked ∧ freshly selectable), and giving every lock gate ONE precedence authority: server verdict present → wins; absent → census. Helper hoisted above both handlers with deps wired.
**Lesson (reusable rule)** | (1) Upstream comments that say "a client would be reading its own belief" are SPEC: find the field they justify and make your client read it — a census is a belief with a timestamp. (2) Locked ≠ inadmissible: per-viewer gates live in wire payloads, not catalogs; a row your catalog omits coerces someone who should have run it. (3) When one resolver becomes every gate's input, hoist it above its consumers and audit the useCallback chains — a memoized gate with a stale input is a lock that opens for the wrong person.
**Graph nodes updated** | server-verdict row (#173).

## 2026-09-26 — Fifth green gate: the runbook is now just Tuesday (#175, v0.0.41)
**What I tried** | Ship 0.0.41 (etiquette guard + server-verdict lock) through the unchanged runbook.
**What failed + evidence** | Nothing. The only operational note: my first triad command concatenated publish + republish in one line and the E409 grep caught the word "error" from the first command's noise — split the legs and read each receipt on its own.
**What worked** | Gate green on 7494a9636, E409 acceptance, CDN in ~5 minutes, fresh-dir install + audit 0 + boot 200/200 with the #168 teardown shape landing first try. Five consecutive green gates since the #146 hardening — the release path is now infrastructure, not an event.
**Lesson (reusable rule)** | A verification step that bundles two receipts into one output can misread its own evidence — one receipt per command, and grep for the EXPECTED string, not the absence of failure.
**Graph nodes updated** | v0.0.41 release row (#171/#173 shipped).

## 2026-09-26 — Importing the discipline, not just the doctrine (#177)
**What I tried** | The comments kept citing `common/src/testing/freebuff-offer-invariants.ts` as the thing "that exists to catch the offer-without-gate shape" — so fetch the cited file and port the checks, not the prose.
**What failed + evidence** | Two of my test expectations were wrong before the checker was right. First, the double-drift case: I expected the lock AND root violations, but #173 had given every row its own root — only the lock fires now, which is the corrected doctrine working (my assertion was a fossil of the old map). Second, CodeRabbit caught the checker's blind spot: my missing-label check accepted ANOTHER model's nonempty label — the exact GLM 5.2 Desktop incident upstream documented (earned row rendered under the fallback's label). Wrong ≠ missing, and only an independent expected lookup sees the difference.
**What worked** | `freebuffOfferViolations` in contracts with six checks wired to OUR gates, applied to three surfaces in their own tests, seeded violations for every check. One surprise from upstream's shape: an empty offer set is a violation — the test that wires itself to the wrong list is the failure a green run hides.
**Lesson (reusable rule)** | (1) An invariant cited in a comment is executable somewhere — find the file, port the checks, and wire them to the surfaces that must hold. (2) A checker that has never failed is a mirror: seed its violations or it tests nothing but the happy list. (3) Wrong and missing are different failure shapes — "not undefined" is not "correct"; verify labels against an independent expectation.
**Graph nodes updated** | offer-invariants row (#177).

