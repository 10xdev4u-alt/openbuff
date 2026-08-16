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

- [x] Freebuff driver: `@codebuff/sdk` inside the orchestration engine (event stream, turn lifecycle)
- [x] Permission approvals via tool overrides (approve terminal commands from the browser)
- [x] Terminal output bridged into the built-in terminal view
- [x] Rebrand sweep (web UI, server strings, package names)
- [x] Turn checkpoints + diff review on Freebuff file changes
- [x] `npx openbuff` distribution
- [x] Local browser login (no pairing gate on loopback) + Freebuff CLI credential reuse
- [x] M3 Expressive design language (see below)

## Design

OpenBuff's visual language adopts **Material 3 Expressive**, inspired by
[rjwarrier/yata](https://github.com/rjwarrier/yata) — a Material 3 Expressive Android app whose
look and feel we brought to the web UI:

- **Typography** — self-hosted variable fonts under SIL OFL (see `apps/web/public/fonts/OFL.txt`):
  Inter Tight (display/headlines), Inter (body/UI), JetBrains Mono (code, terminal, diffs), and
  Bodoni Moda (expressive display serif). No CDN dependency.
- **Shape** — the M3 Expressive radius scale (XS 8 · SM 12 · MD 16 · LG 20 · XL 28 · pill) mapped
  to Tailwind v4 `--radius-*` tokens.
- **Color** — a full M3 tonal role set (`--m3-*` custom properties: primary/secondary/tertiary +
  on/container pairs, the surfaceContainerLowest→Highest ramp, outline/outlineVariant) in light
  and dark, seeded from a buff-orange primary.
- **Motion** — M3 emphasized/decelerate/accelerate/spring easings and nav/sheet/fade/micro
  durations as tokens, with reduced-motion and off modes that honor `prefers-reduced-motion`.

## Credits & licenses

- **[t3 Code](https://github.com/pingdotgg/t3code)** by T3 Tools Inc. — MIT. The entire web
  experience, orchestration engine, and architecture come from this codebase. Go star it.
- **[Freebuff](https://github.com/CodebuffAI/freebuff)** by CodebuffAI — Apache-2.0. The agent SDK
  (`@codebuff/sdk`) powering the engine, plus years of agent-loop engineering we studied closely.
- **[yata](https://github.com/rjwarrier/yata)** by rjwarrier — the Material 3 Expressive reference
  that shaped OpenBuff's design language (typography, shape scale, tonal color roles, motion).
- **Fonts** — Inter Tight, Inter, JetBrains Mono, and Bodoni Moda, self-hosted under the
  [SIL Open Font License](./apps/web/public/fonts/OFL.txt).
- OpenBuff is an independent community project, not affiliated with or endorsed by T3 Tools or
  CodebuffAI. Freebuff is a trademark of its owners; OpenBuff is a client, not a clone of their
  branding.

## License

MIT — see [LICENSE](./LICENSE). The original t3code copyright notice is preserved as required.
