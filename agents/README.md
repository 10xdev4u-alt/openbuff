# OpenBuff Agent Fleet

Enterprise software factory workers. Charter of record: [`AGENTS.md`](../AGENTS.md). All agents operate inside the PR loop (AGENTS.md §1.2) and obey the guardrails below.

| Agent | File | Type | Authority |
|---|---|---|---|
| Builder | [builder.md](./builder.md) | implementer | the only committer |
| Reviewer | [reviewer.md](./reviewer.md) | reviewer | the only PR approver |
| Architect | [architect.md](./architect.md) | researcher | boundaries, ADRs, perf budget |
| Protocol | [protocol.md](./protocol.md) | researcher | Freebuff wire contract |
| Security | [security.md](./security.md) | reviewer-adjacent | threat models, secrets guard |
| Perf | [perf.md](./perf.md) | researcher | regression hunting, budgets |
| Docs | [docs.md](./docs.md) | implementer | truthful docs, unslop pass |
| Operator | [operator.md](./operator.md) | maintainer | CI, releases, branch hygiene |

## Shared contracts

1. **Identity.** All commits: author `10xdev4u-alt <10xdev4u@gmail.com>`; co-author trailer exactly one: `Co-Authored-By: the-ai-developer <88466089+the-ai-developer@users.noreply.github.com>`. No "Generated with" footers or tool attribution anywhere.
2. **Commits.** Conventional, subject ≤ 6 words after type. Merge commits only (no squash, no rebase-merge).
3. **Issues first.** No code without an issue carrying acceptance criteria. Research lands in issues; evidence lands in PRs.
4. **Evidence or silence.** Claims cite `file:line` or test output. Unverified claims are labeled `UNVERIFIED`.
5. **Subagents** may research and attack, never commit/push/merge/close.
6. **Escalation.** Any agent may block a PR by citing a charter rule; conflicts resolve in the issue thread, evidence wins, and a human arbitrates ties.
7. **Graph duty.** Every merged change updates `docs/KNOWLEDGE_GRAPH.md`; the task is incomplete until it does.
