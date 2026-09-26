# Ban appeal draft — free-mode access (#141)

**Status: DRAFT — owner decision required before anything is sent.**
Owner options were (a) appeal, (b) wait for auto-review, (c) fresh account
(rejected: ToS ban-evasion risk + standing directive), (d) stay frozen.
This document exists so option (a) costs one decision, not one writing session.

---

## To (upstream support / Discord modmail)

Subject: Free-mode access review — automated integration testing from the
OpenBuff fork

Hi — I'm writing about the free-mode ban on `formylovableone@gmail.com`
(2026-09-24, ~02:48 UTC). I'm not contesting that the traffic deserved the
flag; I'm writing to own it and to commit to better behavior.

**What happened, honestly.** I maintain OpenBuff, an open-source fork of
Codebuff. On the night of 09-24 I was running live-integration probes against
the free session endpoints to verify wire shapes our fork ports (admission
headers, quote fields, release discipline). I ran 6 admissions in ~35 minutes
(02:19–02:48 UTC), each released immediately, with **zero completed turns**.
Three runs died in repeated 503 "model unavailable" responses, and my probe
retried into that wall — during your US-evening peak, the pool's most loaded
window. At 02:48 the fourth spawn-probe admission returned `403 banned`.

**Why it looked like abuse — because it was shaped like abuse.** Short-lived
seats that churn fast and never finish a turn are the fingerprint of
seat-farming. I now understand a free-session admission is a rate-limited,
abuse-scored event, not a health check. The 503 wall was the system telling me
to stop; I treated it as a retry signal. That misread is on me.

**What I've changed (in the product, not just intentions).** Our probe tooling
now enforces the etiquette in code: admissions spaced ≥1 hour apart, exactly
one per invocation, no retry ladders, a 503 wall treated as STOP, peak windows
avoided, and a written runbook (`probe-resumption.md` in the repo) that fixes
the budget and kill-switches *before* any session starts. We also build
client-side so the server carries less burden: withdrawn/locked models coerce
or refuse client-side rather than ever reaching admission.

**The ask.** If a review of the account's history shows the burst was an
isolated testing incident, I'd ask for free-mode access to be restored. If it
can't be restored, I understand — the fork's development continues fine on
contract tests, and the account stays read-only either way. I won't create
additional accounts to work around this.

Thank you for the free tier and for the engineering visible in how it's
guarded — the two-staged retirement and the paused-list design are genuinely
good systems, and this incident taught us to respect them.

— the OpenBuff maintainer
(`10xdev4u-alt`, repo: `10xdev4u-alt/openbuff`)

---

## Sending checklist (owner)

- [ ] Pick the actual support channel (Discord modmail vs email) and address it to a human if one is known.
- [ ] Decide the identity: send as the banned account, or reference it from the maintainer account.
- [ ] If sent, record the date + channel in #141 and set a follow-up reminder (2 weeks).
- [ ] Do NOT run any probe the day you send this — the appeal should not coincide with new automated traffic.
