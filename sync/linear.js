'use strict';

const LINEAR_URL = 'https://api.linear.app/graphql';
const ISSUE_FIELDS = `
  id identifier title description priority url
  state { name type }
  assignee { name }
`;
const OPEN_ISSUES_QUERY = `query SyncOpenIssues($filter: IssueFilter!, $after: String) {
  issues(first: 50, after: $after, filter: $filter, orderBy: updatedAt) {
    nodes { ${ISSUE_FIELDS} }
    pageInfo { hasNextPage endCursor }
  }
}`;
const ASSIGNED_OPEN_ISSUES_QUERY = `query SyncAssignedOpenIssues($filter: IssueFilter!, $after: String) {
  viewer {
    assignedIssues(first: 50, after: $after, filter: $filter, orderBy: updatedAt) {
      nodes { ${ISSUE_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;
const ISSUE_QUERY = `query SyncIssue($id: String!) {
  issue(id: $id) { ${ISSUE_FIELDS} }
}`;

function toTicket(issue) {
  const id = issue?.identifier || issue?.id;
  if (typeof id !== 'string' || typeof issue.title !== 'string') throw new Error('Invalid Linear issue');
  const type = issue.state?.type;
  return {
    id,
    title: issue.title,
    description: issue.description || '',
    status: type === 'completed' ? 'done' : type === 'canceled' ? 'canceled' : 'open',
    priority: issue.priority ?? 0,
    assignee: issue.assignee?.name || null,
    comments: [],
    linearId: issue.id,
    linearStatus: issue.state?.name || null,
    url: issue.url || null,
  };
}

async function graphql({ apiKey, query, variables, fetchImpl }) {
  const response = await fetchImpl(LINEAR_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: apiKey },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Linear HTTP ${response.status}`);
  const result = await response.json();
  if (result?.errors?.length) throw new Error('Linear GraphQL errors');
  if (!result?.data) throw new Error('Invalid Linear GraphQL response');
  return result.data;
}

async function pullOpenIssues({ apiKey, teamId, projectId, assignee = 'me', fetchImpl = globalThis.fetch }) {
  const filter = { state: { type: { in: ['triage', 'backlog', 'unstarted', 'started'] } } };
  if (teamId) filter.team = { id: { eq: teamId } };
  if (projectId) filter.project = { id: { eq: projectId } };
  const query = assignee === 'all' ? OPEN_ISSUES_QUERY : ASSIGNED_OPEN_ISSUES_QUERY;
  const tickets = [];
  const seenCursors = new Set();
  let after = null;
  for (;;) {
    const data = await graphql({ apiKey, query, variables: { filter, after }, fetchImpl });
    const connection = assignee === 'all' ? data.issues : data.viewer?.assignedIssues;
    if (!Array.isArray(connection?.nodes) || !connection.pageInfo) throw new Error('Invalid Linear issues response');
    tickets.push(...connection.nodes.map(toTicket));
    if (!connection.pageInfo.hasNextPage) return tickets;
    after = connection.pageInfo.endCursor;
    if (typeof after !== 'string' || seenCursors.has(after)) throw new Error('Invalid Linear cursor');
    seenCursors.add(after);
  }
}

async function pullIssue({ apiKey, id, fetchImpl = globalThis.fetch }) {
  const data = await graphql({ apiKey, query: ISSUE_QUERY, variables: { id }, fetchImpl });
  return data.issue ? toTicket(data.issue) : null;
}

module.exports = { pullOpenIssues, pullIssue };
