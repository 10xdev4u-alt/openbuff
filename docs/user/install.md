# Install OpenBuff

OpenBuff is a web GUI for running coding agents on your machine.

## Requirements

Node.js `^22.16 || ^23.11 || >=24.10` on the machine that runs the OpenBuff server.

A Freebuff account. The built-in provider talks to Freebuff; there are no provider CLIs to install.

## Run Without Installing

```bash
npx openbuff@latest
```

This starts the OpenBuff server on your machine and opens the local web app. Use
`npx openbuff@latest --help` for the full CLI reference.

## Providers

OpenBuff ships a single built-in provider: the Freebuff driver, which wraps the Freebuff agent
service in-process. There are no external provider CLIs to install or authenticate; sign in with
your Freebuff account when the web app asks.

The provider shows its auth status in **Settings** and fails at session start with a sign-in prompt
if your credentials are missing or expired.

## Next Steps

- [Permission modes](./permission-modes.md): how much OpenBuff asks before acting
- [Remote access](./remote-access.md): connect from a phone, tablet, or another machine's browser
- [Keeping OpenBuff in sync](./updating.md): client and server version skew
- [Running in the background](./background-service.md): Linux background service
