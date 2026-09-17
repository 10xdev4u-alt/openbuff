# Install OpenBuff

OpenBuff is a web GUI for running coding agents on your machine.

## Requirements

Node.js `^22.16 || ^23.11 || >=24.10` on the machine that runs the OpenBuff server.

A Freebuff login on that machine. OpenBuff reuses the session the Freebuff CLI or Freebuff Desktop
app created — it does not start a sign-in flow itself. Run `freebuff login` (or log into the
Freebuff Desktop app) before your first session; `CODEBUFF_API_KEY` also works.

## Run Without Installing

```bash
npx openbuff@latest
```

This starts the OpenBuff server on your machine and opens the local web app. Use
`npx openbuff@latest --help` for the full CLI reference.

## Providers

OpenBuff ships a single built-in provider: the Freebuff driver, which wraps the Freebuff agent
service in-process. There are no external provider CLIs to install; OpenBuff reuses the Freebuff
session from the CLI or Desktop app as described under Requirements.

The provider shows its auth status in **Settings** and fails at session start with the login
instruction (`freebuff login` or Freebuff Desktop) if no session is available.

## Next Steps

- [Permission modes](./permission-modes.md): how much OpenBuff asks before acting
- [Remote access](./remote-access.md): connect from a phone, tablet, or another machine's browser
- [Keeping OpenBuff in sync](./updating.md): client and server version skew
- [Running in the background](./background-service.md): Linux background service
