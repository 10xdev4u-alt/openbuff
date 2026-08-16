# OpenBuff 🐃

**The open-source, ad-free web experience for [Freebuff](https://freebuff.com) — the free AI coding agent.**

One command starts a clean local web app in your browser, backed by the real Freebuff agent engine working on your files: chat, live tool calls, diffs, terminals, and turn-by-turn git checkpoints.

```bash
npx openbuff@latest
```

## What this is

- **Local-first.** A server runs on *your* machine (the execution boundary: files, terminals, git). The web UI is served from it. Nothing of ours runs in the cloud — there is no "ours" to run.
- **Freebuff-powered.** The agent engine is [Freebuff](https://freebuff.com)'s (via `@codebuff/sdk`, Apache-2.0) — free-tier models, no ads in this app, no telemetry from this app. Bring a free API key from [codebuff.com/api-keys](https://codebuff.com/api-keys) and you're running.
- **Flagship UI.** A fork of the gorgeous [t3 Code](https://t3.codes) web experience, rebranded and refocused around a single engine.

## Status: very early fork

This project is a fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code) (MIT), trimmed to its
web + server apps, with the five provider drivers (Codex, Claude, Cursor, Grok, OpenCode) being
replaced by a single Freebuff driver.

Roadmap:

- [ ] Freebuff driver: `@codebuff/sdk` inside the orchestration engine (event stream, turn lifecycle)
- [ ] Permission approvals via tool overrides (approve terminal commands from the browser)
- [ ] Terminal output bridged into the built-in terminal view
- [ ] Rebrand sweep (web UI, server strings, package names)
- [ ] Turn checkpoints + diff review on Freebuff file changes
- [ ] `npx openbuff` distribution

## Credits & licenses

- **[t3 Code](https://github.com/pingdotgg/t3code)** by T3 Tools Inc. — MIT. The entire web
  experience, orchestration engine, and architecture come from this codebase. Go star it.
- **[Freebuff](https://github.com/CodebuffAI/freebuff)** by CodebuffAI — Apache-2.0. The agent SDK
  (`@codebuff/sdk`) powering the engine, plus years of agent-loop engineering we studied closely.
- OpenBuff is an independent community project, not affiliated with or endorsed by T3 Tools or
  CodebuffAI. Freebuff is a trademark of its owners; OpenBuff is a client, not a clone of their
  branding.

## License

MIT — see [LICENSE](./LICENSE). The original t3code copyright notice is preserved as required.
