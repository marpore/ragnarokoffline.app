# Local sync v0

This standalone Node server keeps a local in-memory ticket cache. With `LINEAR_API_KEY` set, the first ticket/status request pulls open Linear issues through GraphQL; without a key, it serves `fixtures/*.json` exactly as before. If a pull fails, fixtures remain available and `/sync/status` reports `linearPullFailed: true`. Local comments, PATCH updates, and Linear webhooks update only this cache and reset on restart. The server binds to `127.0.0.1` and does not start Electron, Docker, or the game.

Requires Node 20 or newer. From this directory:

```sh
npm install
npm run sync:test
npm run sync:dev
```

`PORT=8787` is the default; set `PORT` in the shell to override it. To pull from Linear, set your personal API key in the server environment (do not put it in a Mod or commit it):

```sh
export LINEAR_API_KEY='your-key'
npm run sync:dev
```

The server sends the key as Linear's `Authorization` header to `https://api.linear.app/graphql`. `.env.example` lists the variables but is not loaded automatically. By default, Linear's documented `viewer.assignedIssues` query pulls issues assigned to the API key's user. Its state type filter includes triage, backlog, unstarted, and started, which excludes all completed and canceled workflow states regardless of their names. Optional `LINEAR_TEAM_ID` and `LINEAR_PROJECT_ID` scope that personal list further by UUID.

For debugging, set `LINEAR_ASSIGNEE=all` or `LINEAR_PULL_ALL=1` to restore the previous all-open-issues query while keeping the state, team, and project filters. The resulting ticket has `status: "open"` for `/linear/tickets?status=open` and `linearStatus` for its exact Linear workflow name. A by-ID cache miss fetches the requested issue directly, even if it is completed or canceled; the list remains limited to your open issues. Pulls happen on demand once per process; restart to refresh the list. Webhooks can update it between restarts.

```sh
LINEAR_ASSIGNEE=all npm run sync:dev
# or: LINEAR_PULL_ALL=1 npm run sync:dev
```

In another terminal:

```sh
curl -sS http://127.0.0.1:8787/health
curl -sS 'http://127.0.0.1:8787/linear/tickets?status=open'
curl -sS http://127.0.0.1:8787/linear/tickets/JOR-123
```

The Linear webhook accepts either a Linear-style `{ "action": "update", "type": "Issue", "data": { ... } }` payload or `{ "issue": { ... } }` for local experiments. Signature verification is a TODO before exposing `/hooks/linear` through a tunnel. Slack, Intercom, and Grok endpoints return HTTP 501; no service tokens or game assets are needed.

The island NPC generator (`npm run sync:island -- --output <state/modbuild/npc/linear-mobs/tickets.txt>`) reads open tickets and the open PR index. `GET /github/prs` returns `{ "prs": [...] }` from the local fixture/cache, joined through each PR's `ticketId`; it does not call GitHub. Regenerate and use `@reloadscript` to apply the new snapshot.
