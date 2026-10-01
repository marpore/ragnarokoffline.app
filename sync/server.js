'use strict';

const http = require('node:http');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { pullOpenIssues, pullIssue } = require('./linear');

function fixture(name) {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));
}

function createStore() {
  return {
    tickets: new Map(fixture('tickets.json').map(ticket => [ticket.id, ticket])),
    prs: new Map(fixture('prs.json').map(pr => [pr.id, pr])),
    issues: new Map(fixture('issues.json').map(issue => [issue.id, issue])),
    nextCommentId: 1,
  };
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) {
      const error = new Error('body_too_large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error('invalid_json');
    return body;
  } catch {
    const error = new Error('invalid_json');
    error.status = 400;
    throw error;
  }
}

function issueFromWebhook(payload) {
  // TODO: verify Linear webhook signatures before accepting traffic from a tunnel.
  if (payload.type && payload.type !== 'Issue') return null;
  const issue = payload.issue || payload.data;
  if (!issue || typeof issue !== 'object' || Array.isArray(issue)) return null;
  const id = issue.identifier || issue.id;
  if (typeof id !== 'string' || !id.trim()) return null;
  return {
    id,
    title: issue.title,
    description: issue.description,
    status: typeof issue.status === 'string' ? issue.status : issue.state?.name,
    priority: issue.priority,
    assignee: issue.assignee,
    comments: issue.comments,
  };
}

function createSyncServer(options = {}) {
  const {
    store = createStore(),
    linearApiKey = process.env.LINEAR_API_KEY,
    linearTeamId = process.env.LINEAR_TEAM_ID,
    linearProjectId = process.env.LINEAR_PROJECT_ID,
    linearAssignee = process.env.LINEAR_ASSIGNEE,
    linearPullAll = process.env.LINEAR_PULL_ALL === '1',
    fetchImpl = globalThis.fetch,
  } = options;
  const apiKey = linearApiKey?.trim();
  const pullAll = linearPullAll || linearAssignee?.trim().toLowerCase() === 'all';
  let source = 'fixtures';
  let pullFailed = false;
  let pullPromise;

  async function ensurePulled() {
    if (!apiKey) return;
    if (!pullPromise) {
      pullPromise = pullOpenIssues({
        apiKey, teamId: linearTeamId, projectId: linearProjectId,
        assignee: pullAll ? 'all' : 'me', fetchImpl,
      }).then(tickets => {
        store.tickets = new Map(tickets.map(ticket => [ticket.id, ticket]));
        source = 'linear';
        pullFailed = false;
      }).catch(error => {
        pullFailed = true;
        console.error('Linear pull failed: ' + error.message);
      });
    }
    await pullPromise;
  }

  return http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const localGameOrigin = origin === 'http://127.0.0.1:3338' || origin === 'http://localhost:3338';
    if (localGameOrigin) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'Origin');
      res.setHeader('access-control-allow-methods', 'GET, POST, PATCH, OPTIONS');
      res.setHeader('access-control-allow-headers', 'Content-Type');
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
      }
    }
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const path = url.pathname;
      const method = req.method;

      if (method === 'GET' && path === '/health') return send(res, 200, { ok: true });

      if (method === 'GET' && path === '/sync/status') {
        await ensurePulled();
        const tickets = [...store.tickets.values()];
        return send(res, 200, {
          ok: true,
          source,
          ticketCount: tickets.length,
          openTicketCount: tickets.filter(ticket => ticket.status === 'open').length,
          prCount: store.prs.size,
          issueCount: store.issues.size,
          ...(apiKey ? { linearPullFailed: pullFailed, linearAssignee: pullAll ? 'all' : 'me' } : {}),
        });
      }

      if (method === 'GET' && path === '/linear/tickets') {
        await ensurePulled();
        const status = url.searchParams.get('status');
        const tickets = [...store.tickets.values()].filter(ticket => !status || ticket.status === status);
        return send(res, 200, { tickets });
      }

      const ticketMatch = /^\/linear\/tickets\/([^/]+)$/.exec(path);
      const commentMatch = /^\/linear\/tickets\/([^/]+)\/comments$/.exec(path);
      if (ticketMatch || commentMatch) {
        await ensurePulled();
        const id = decodeURIComponent((ticketMatch || commentMatch)[1]);
        let ticket = store.tickets.get(id);
        if (!ticket && apiKey) {
          try {
            ticket = await pullIssue({ apiKey, id, fetchImpl });
            if (ticket) store.tickets.set(ticket.id, ticket);
          } catch {
            return send(res, 502, { error: 'linear_unavailable' });
          }
        }
        if (!ticket) return send(res, 404, { error: 'not_found' });
        if (method === 'GET' && ticketMatch) return send(res, 200, ticket);
        if (method === 'POST' && commentMatch) {
          const body = await readJson(req);
          if (typeof body.body !== 'string' || !body.body.trim()) return send(res, 400, { error: 'invalid_comment' });
          ticket.comments.push({ id: 'local-' + store.nextCommentId++, body: body.body.trim(), createdAt: new Date().toISOString() });
          return send(res, 200, ticket);
        }
        if (method === 'PATCH' && ticketMatch) {
          const patch = await readJson(req);
          const keys = Object.keys(patch);
          if (!keys.length || keys.some(key => !['status', 'priority'].includes(key)) ||
              ('status' in patch && (typeof patch.status !== 'string' || !patch.status.trim())) ||
              ('priority' in patch && (!Number.isInteger(patch.priority) || patch.priority < 0 || patch.priority > 4))) {
            return send(res, 400, { error: 'invalid_ticket_patch' });
          }
          Object.assign(ticket, patch);
          return send(res, 200, ticket);
        }
      }

      const prMatch = /^\/github\/prs\/([^/]+)$/.exec(path);
      if (method === 'GET' && path === '/github/prs') {
        const prs = [...store.prs.values()].filter(pr => String(pr.state || '').toLowerCase() === 'open');
        return send(res, 200, { prs });
      }
      if (method === 'GET' && prMatch) return send(res, store.prs.has(prMatch[1]) ? 200 : 404, store.prs.get(prMatch[1]) || { error: 'not_found' });

      const issueMatch = /^\/sentry\/issues\/([^/]+)$/.exec(path);
      if (method === 'GET' && issueMatch) return send(res, store.issues.has(issueMatch[1]) ? 200 : 404, store.issues.get(issueMatch[1]) || { error: 'not_found' });

      if (method === 'POST' && path === '/hooks/linear') {
        await ensurePulled();
        const payload = await readJson(req);
        const issue = issueFromWebhook(payload);
        if (!issue) return send(res, 400, { error: 'invalid_linear_issue' });
        const previous = store.tickets.get(issue.id) || { id: issue.id, comments: [] };
        const updated = { ...previous };
        for (const key of ['title', 'description', 'status', 'priority', 'assignee']) {
          if (issue[key] !== undefined) updated[key] = issue[key];
        }
        if (Array.isArray(issue.comments)) updated.comments = issue.comments;
        store.tickets.set(issue.id, updated);
        return send(res, 200, { ok: true, ticket: updated });
      }

      // TODO: implement each service through its dedicated endpoint and server-side token.
      if (path === '/slack/send' || path === '/grok/talk' ||
          /^\/intercom\/conversations\/[^/]+\/reply$/.test(path) ||
          /^\/github\/prs\/[^/]+\/comments$/.test(path) ||
          ['/hooks/slack', '/hooks/intercom', '/hooks/sentry', '/hooks/github'].includes(path)) {
        return send(res, 501, { error: 'not_implemented' });
      }

      return send(res, 404, { error: 'not_found' });
    } catch (error) {
      return send(res, error.status || 400, { error: error.message === 'body_too_large' ? 'body_too_large' : 'invalid_request' });
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');
  createSyncServer().listen(port, '127.0.0.1', () => {
    console.log(`sync v0 listening on http://127.0.0.1:${port}`);
  });
}

module.exports = { createSyncServer, createStore };
