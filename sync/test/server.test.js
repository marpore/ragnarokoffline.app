'use strict';

const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { createSyncServer } = require('../server');

let server;
let base;

before(async () => {
  server = createSyncServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

async function request(path, options) {
  const response = await fetch(base + path, options);
  return { status: response.status, body: await response.json() };
}

function json(method, body) {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

test('health, status, and fixture reads', async () => {
  assert.deepEqual(await request('/health'), { status: 200, body: { ok: true } });
  const status = await request('/sync/status');
  assert.equal(status.status, 200);
  assert.equal(status.body.ok, true);
  assert.equal(status.body.ticketCount, 2);
  const tickets = await request('/linear/tickets?status=open');
  assert.equal(tickets.status, 200);
  assert.deepEqual(tickets.body.tickets.map(ticket => ticket.id), ['JOR-123']);
  assert.equal((await request('/linear/tickets/JOR-123')).body.title, 'Review the login flow');
  assert.equal((await request('/github/prs/42')).body.ticketId, 'JOR-123');
  assert.equal((await request('/sentry/issues/ISSUE-7')).body.status, 'unresolved');
});

test('comments and status changes update the in-memory ticket', async () => {
  const comment = await request('/linear/tickets/JOR-123/comments', json('POST', { body: 'Looks good.' }));
  assert.equal(comment.status, 200);
  assert.equal(comment.body.comments.at(-1).body, 'Looks good.');
  assert.equal((await request('/linear/tickets/JOR-123')).body.comments.at(-1).body, 'Looks good.');
  const patch = await request('/linear/tickets/JOR-123', json('PATCH', { status: 'done', priority: 1 }));
  assert.equal(patch.status, 200);
  assert.equal((await request('/linear/tickets/JOR-123')).body.status, 'done');
  assert.equal((await request('/linear/tickets?status=open')).body.tickets.some(ticket => ticket.id === 'JOR-123'), false);
});

test('Linear webhook supports native and curl-friendly issue shapes', async () => {
  const native = await request('/hooks/linear', json('POST', {
    action: 'create', type: 'Issue', data: { identifier: 'JOR-200', title: 'Native hook', state: { name: 'open' }, priority: 2 },
  }));
  assert.equal(native.status, 200);
  assert.equal(native.body.ticket.status, 'open');
  const simple = await request('/hooks/linear', json('POST', { issue: { id: 'JOR-200', status: 'done' } }));
  assert.equal(simple.status, 200);
  assert.equal((await request('/linear/tickets/JOR-200')).body.status, 'done');
  assert.equal((await request('/sync/status')).body.ticketCount, 3);
});

test('unimplemented endpoints and invalid updates are explicit', async () => {
  assert.deepEqual(await request('/slack/send'), { status: 501, body: { error: 'not_implemented' } });
  assert.equal((await request('/slack/send', json('POST', {}))).status, 501);
  assert.equal((await request('/grok/talk', json('POST', {}))).status, 501);
  assert.equal((await request('/intercom/conversations/1/reply', json('POST', {}))).status, 501);
  assert.equal((await request('/linear/tickets/JOR-123', json('PATCH', { title: 'No' }))).status, 400);
  assert.equal((await request('/linear/tickets/JOR-123/comments', json('POST', { body: '' }))).status, 400);
  assert.equal((await request('/linear/tickets/missing')).status, 404);
});

test('shared syncFetch works from Node without browser globals', async () => {
  const { syncFetch } = await import('../../mods/shared/client/sync-fetch.js');
  const previous = globalThis.SYNC_BASE_URL;
  globalThis.SYNC_BASE_URL = base;
  try {
    const response = await syncFetch('/health');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  } finally {
    if (previous === undefined) delete globalThis.SYNC_BASE_URL;
    else globalThis.SYNC_BASE_URL = previous;
  }
});
