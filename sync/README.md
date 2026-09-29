# Local sync v0

This standalone Node server serves fixture data from `fixtures/*.json`. Writes and Linear webhooks update an in-memory cache, which resets when the process restarts. It binds to `127.0.0.1` and does not start Electron, Docker, or the game.

Requires Node 20 or newer. From this directory:

```sh
npm install
npm run sync:test
npm run sync:dev
```

`PORT=8787` is the default; set `PORT` in the shell to override it. `.env.example` documents future server-side credentials; this v0 does not read or use them.

In another terminal:

```sh
curl -sS http://127.0.0.1:8787/health
curl -sS 'http://127.0.0.1:8787/linear/tickets?status=open'
curl -sS http://127.0.0.1:8787/linear/tickets/JOR-123
```

The Linear webhook accepts either a Linear-style `{ "action": "update", "type": "Issue", "data": { ... } }` payload or `{ "issue": { ... } }` for local experiments. Signature verification is a TODO before exposing `/hooks/linear` through a tunnel. Slack, Intercom, and Grok endpoints return HTTP 501; no service tokens or game assets are needed.
