# Probe resumption runbook (post-#141)

The free-mode test account was banned 2026-09-24 (#141): six admissions in ~35 minutes
with zero completed turns during the US-evening peak read as seat farming. The ban is
terminal per the wire contract (`403 {"status":"banned"}`, bare body). This runbook
governs the FIRST session back — read it before the first admission, not after.

## Before the first probe

1. **Verify the ban actually lifted** with the cheapest possible touch: one admission
   through `scripts/live-wire-probe.ts` (self-contained, releases in `finally`). A
   `403 {"status":"banned"}` means it did NOT lift — stop, no further probes today.
2. **Time the window**: never 02:00–05:00 UTC (US evening, the pool's peak). Early
   UTC morning is the calmest observed period.
3. **State the budget out loud** before starting: the first session back is allowed
   AT MOST **two admissions**, spaced **≥1 hour** apart. Not three. The #141 burst
   was six; the etiquette law is that an admission is an abuse-scored event, not a
   free action.

## The first three probes (in order, each gated on the last)

1. **Admission liveness** (`scripts/live-wire-probe.ts`, default model): expect
   `status: "active"` + instance id + a freebucks quote. This alone proves the
   account is un-banned and the admission route is intact. Release immediately.
2. **Roster re-census** (same probe, priced rows): all 7 picker rows plus the 2
   drain rows (gpt-5.6-luna, solar-pro4) must be priced or explicitly free; any
   row absent from the price map is dead — reconcile against live upstream via the
   contents API before touching our contracts.
3. **Spawn proof** (`apps/server/integration/live-subagent-spawn.probe.ts`, ONE run,
   default model): the #108/#109 completion the ban interrupted. Expect
   `subagent_start`/`subagent_finish` through the event tap. ONE run means one: a
   503 wall here is STOP, not retry-another-lane.

## Kill-switches (any of these ends the session)

- FIRST 503 wall (≥2 consecutive 503s on admission) — wait ≥1 hour or stop.
- Any `4xx` body that is not a documented gate shape — capture it, stop, diagnose
  offline.
- Two completed probes — the budget is spent; book results and leave.

## After the session

- Books row for whatever the probes saw (KG + EVOLUTION_LOG) via its own PR.
- Update #141 with the outcome; close it only when a probe completes a full turn.
- If the ban re-fires at ANY point: freeze again immediately (read-only ceiling,
  contents API + web-search only), and the next attempt gets a NEW owner decision,
  not a retry.
