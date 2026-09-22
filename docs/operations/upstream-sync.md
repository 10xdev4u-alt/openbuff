# Upstream sync policy

Upstream is [`CodebuffAI/freebuff`](https://github.com/CodebuffAI/freebuff). It pushes public snapshots frequently (multiple per day at times).

## The structural fact

**Our histories are unrelated.** This repository was seeded from an upstream snapshot, not forked on GitHub — `git merge-base main upstream/main` is empty. Consequences:

- `git merge upstream/main` is **impossible** (unrelated histories) — and `--allow-unrelated-histories` would be catastrophic, not a fix.
- "Sync" means **content-level porting**: read upstream changes, decide which apply to our diverged tree, re-apply them through the normal factory loop (research → issue → PR → review → merge).

## The tracker

**Upstream sync tracker** (`.github/workflows/upstream-sync.yml`) runs weekly (Mondays 06:00 UTC, `workflow_dispatch` for on-demand) and posts a report to the open `upstream-sync`-labeled issue:

- upstream velocity (commits + changed files, last 7 days),
- **semantic watch hits** (`.github/sync-watch-map.txt`): upstream paths that changed, mapped to *our* modules they impact,
- the protected-paths list, re-stated on every report.

It **never merges** — it measures and surfaces.

## Protected paths

`.github/sync-protected-paths.txt` lists files that encode OpenBuff's identity (scoped npm identity, factory docs, install hardening, subagent suite, publish gate). A port that silently drops one of these is a **regression, not a sync**. When porting upstream changes touching the same concepts, re-apply ours on top.

## Port procedure

1. Read the tracker report; pick a watch-hit worth porting (or skip with a reason on the tracking issue).
2. Read the upstream change at the cited prefix — upstream is wire/behavior truth until a graph update says otherwise (AGENTS.md §2.6).
3. Raise a scoped issue referencing the tracking issue; implement through the standard PR loop.
4. Update the knowledge graph row for any behavior change.
