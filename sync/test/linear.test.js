'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pullOpenIssues, pullIssue } = require('../linear');
const { createSyncServer } = require('../server');

const issueNode = (overrides = {}) => ({
  id: 'linear-1',
  identifier: 'RO-101',
  title: 'Add local sync',
  description: 'A fixture shaped issue',
  priority: 2,
  url: 'https://linear.app/acme/issue/RO-101',
  state: { name: 'In Progress', type: 'started' },
  assignee: { name: 'Ada Lovelace' },
  ...overrides,
});

function graphResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return data; },
  };
}

function ticketsConnection(nodes, hasNextPage = false, endCursor = null, root = 'viewer') {
  const connection = { nodes, pageInfo: { hasNextPage, endCursor } };
  return root === 'issues'
    ? { issues: connection }
    : { viewer: { assignedIssues: connection } };
}

function listResponse(body, nodes, hasNextPage = false, endCursor = null) {
  const root = /viewer\s*\{/.test(body.query) ? 'viewer' : 'issues';
  return graphResponse({ data: ticketsConnection(nodes, hasNextPage, endCursor, root) });
}

test('pullOpenIssues sends the raw API key, queries open issue types, and maps Linear shape', async () => {
  let request;
  const fetchImpl = async (url, init) => {
    request = { url, init, body: JSON.parse(init.body) };
    return listResponse(request.body, [issueNode()]);
  };

  const tickets = await pullOpenIssues({ apiKey: 'lin_api_test', fetchImpl });

  assert.equal(request.url, 'https://api.linear.app/graphql');
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.headers.authorization, 'lin_api_test');
  assert.match(request.body.query, /assignedIssues\s*\(/);
  assert.match(request.body.query, /viewer\s*\{[\s\S]*assignedIssues/);
  assert.match(request.body.query, /state|type/i);
  assert.deepEqual(request.body.variables.filter.state.type.in, ['triage', 'backlog', 'unstarted', 'started']);
  assert.deepEqual(tickets, [{
    id: 'RO-101',
    title: 'Add local sync',
    description: 'A fixture shaped issue',
    status: 'open',
    priority: 2,
    assignee: 'Ada Lovelace',
    comments: [],
    linearId: 'linear-1',
    linearStatus: 'In Progress',
    url: 'https://linear.app/acme/issue/RO-101',
  }]);
});

test('pullOpenIssues applies optional team and project filters and follows pagination', async () => {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    if (calls.length === 1) return listResponse(body, [issueNode()], true, 'cursor-1');
    return listResponse(body, [issueNode({ id: 'linear-2', identifier: 'RO-102', title: 'Next page' })]);
  };

  const tickets = await pullOpenIssues({
    apiKey: 'lin_api_test', teamId: 'team-1', projectId: 'project-1', fetchImpl,
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(tickets.map(ticket => ticket.id), ['RO-101', 'RO-102']);
  const first = JSON.stringify(calls[0]);
  const second = JSON.stringify(calls[1]);
  assert.equal(calls[0].variables.filter.team.id.eq, 'team-1');
  assert.equal(calls[0].variables.filter.project.id.eq, 'project-1');
  assert.deepEqual(calls[0].variables.filter.state.type.in, ['triage', 'backlog', 'unstarted', 'started']);
  assert.ok(second.includes('cursor-1'));
});

test('assignee all uses the root issues query and supports both server configuration forms', async () => {
  let pullRequest;
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    pullRequest = body;
    return listResponse(body, [issueNode()]);
  };
  const allTickets = await pullOpenIssues({ apiKey: 'lin_api_test', assignee: 'all', fetchImpl });
  assert.equal(allTickets[0].id, 'RO-101');
  assert.match(pullRequest.query, /issues\s*\(/);
  assert.doesNotMatch(pullRequest.query, /assignedIssues/);

  for (const options of [{ linearAssignee: 'all' }, { linearPullAll: true }]) {
    const server = createSyncServer({
      linearApiKey: 'lin_api_test',
      ...options,
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(init.body);
        assert.match(body.query, /issues\s*\(/);
        assert.doesNotMatch(body.query, /assignedIssues/);
        return listResponse(body, [issueNode()]);
      },
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/linear/tickets`);
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.tickets[0].id, 'RO-101');
    } finally {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }
});

test('pullIssue fetches one issue by identifier and maps it to the ticket shape', async () => {
  let sent;
  const fetchImpl = async (_url, init) => {
    sent = JSON.parse(init.body);
    return graphResponse({ data: { issue: issueNode({ identifier: 'RO-777', title: 'Single issue' }) } });
  };

  const ticket = await pullIssue({ apiKey: 'lin_api_test', id: 'RO-777', fetchImpl });
  assert.equal(ticket.id, 'RO-777');
  assert.equal(ticket.title, 'Single issue');
  assert.match(sent.query, /issue\s*\(/);
  assert.ok(JSON.stringify(sent.variables).includes('RO-777'));
});

test('Linear GraphQL errors and non-2xx responses reject with useful errors', async () => {
  await assert.rejects(
    pullOpenIssues({ apiKey: 'lin_api_test', fetchImpl: async () => graphResponse({ errors: [{ message: 'bad query' }] }) }),
    /GraphQL/i,
  );
  await assert.rejects(
    pullIssue({ apiKey: 'lin_api_test', id: 'RO-1', fetchImpl: async () => graphResponse({}, 503) }),
    /503|Linear/i,
  );
});

test('fixture mode keeps local tickets and never calls fetchImpl without an API key', async () => {
  let fetchCalls = 0;
  const server = createSyncServer({
    linearApiKey: '',
    fetchImpl: async () => { fetchCalls++; throw new Error('unexpected fetch'); },
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/linear/tickets?status=open`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.ok(body.tickets.some(ticket => ticket.id === 'JOR-123'));
    assert.equal(fetchCalls, 0);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('failed live pull keeps fixture tickets and reports linearPullFailed', async () => {
  const originalError = console.error;
  console.error = () => {};
  const server = createSyncServer({
    linearApiKey: 'lin_api_test',
    fetchImpl: async () => { throw new Error('mock network failure'); },
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const listResponse = await fetch(`${base}/linear/tickets?status=open`);
    const list = await listResponse.json();
    assert.equal(listResponse.status, 200);
    assert.ok(list.tickets.some(ticket => ticket.id === 'JOR-123'));
    const statusResponse = await fetch(`${base}/sync/status`);
    const status = await statusResponse.json();
    assert.equal(statusResponse.status, 200);
    assert.equal(status.source, 'fixtures');
    assert.equal(status.linearPullFailed, true);
  } finally {
    console.error = originalError;
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('live mode serves on-demand GraphQL issue list and by-id reads through HTTP', async () => {
  const requests = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    if (/issue\s*\(/.test(body.query)) {
      return graphResponse({ data: { issue: issueNode({ id: 'linear-404', identifier: body.variables.id, title: 'HTTP detail' }) } });
    }
    return listResponse(body, [issueNode({ identifier: 'RO-303', title: 'HTTP list' })]);
  };
  const server = createSyncServer({ linearApiKey: 'lin_api_test', linearAssignee: 'me', linearPullAll: false, fetchImpl });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const listResponse = await fetch(`${base}/linear/tickets?status=open`);
    const list = await listResponse.json();
    assert.equal(listResponse.status, 200);
    assert.equal(list.tickets[0].id, 'RO-303');
    const cachedDetailResponse = await fetch(`${base}/linear/tickets/RO-303`);
    const cachedDetail = await cachedDetailResponse.json();
    assert.equal(cachedDetailResponse.status, 200);
    assert.equal(cachedDetail.title, 'HTTP list');
    assert.equal(requests.length, 1);
    const detailResponse = await fetch(`${base}/linear/tickets/RO-404`);
    const detail = await detailResponse.json();
    assert.equal(detailResponse.status, 200);
    assert.equal(detail.title, 'HTTP detail');
    assert.equal(detail.id, 'RO-404');
    assert.equal(requests.length, 2);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
