'use strict';

const { afterEach, test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { generateIslandNpcs, renderTicketNpcs } = require('../generate-island-npcs');

let tempDir;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

test('renders open tickets into unique grid NPCs with inspect details and escaped text', () => {
  const tickets = [
    {
      id: 'RO-202', title: 'A "quoted" title', status: 'open', linearStatus: 'In Progress',
      priority: 3, assignee: 'Ada', url: 'https://linear.app/team/RO-202',
      comments: [{ body: 'Keep \\safe\nplease', user: 'Lin' }],
    },
    { id: 'RO-201', title: 'Urgent ticket', status: 'open', priority: 1, assignee: null, comments: [] },
    { id: 'RO-203', title: 'Closed ticket', status: 'done', priority: 1 },
  ];

  const result = renderTicketNpcs(tickets);
  assert.equal(result.ticketCount, 2);
  assert.equal(result.omittedCount, 0);
  assert.match(result.script, /ro_isle,20,48,4\tscript\tRO-201 Urgent ticket#lnticket01\t4_M_SAGE_A/);
  assert.match(result.script, /ro_isle,28,48,4\tscript\tRO-202 A 'quoted' title#lnticket02\t4_M_SAGE_A/);
  assert.match(result.script, /Status: In Progress/);
  assert.match(result.script, /Priority: 3/);
  assert.match(result.script, /Assignee: Ada/);
  assert.match(result.script, /Recent comments:/);
  assert.match(result.script, /Keep \\\\safe please/);
  assert.match(result.script, /Linear: https:\/\/linear\.app\/team\/RO-202/);
  assert.doesNotMatch(result.script, /Closed ticket/);
  assert.equal((result.script.match(/\tscript\t/g) || []).length, 2);
});

test('caps the layout at 24 and prioritizes urgent tickets before stable ID order', () => {
  const tickets = Array.from({ length: 30 }, (_, i) => ({
    id: `RO-${String(100 + i).padStart(3, '0')}`,
    title: `Ticket ${i}`,
    status: 'open',
    priority: i === 29 ? 1 : 4,
  }));
  const result = renderTicketNpcs(tickets);
  assert.equal(result.ticketCount, 24);
  assert.equal(result.omittedCount, 6);
  assert.match(result.script, /ro_isle,60,63,4\tscript/);
  assert.match(result.script, /RO-129 Ticket 29#lnticket01/);
  assert.doesNotMatch(result.script, /RO-123 Ticket 23/);
  assert.equal((result.script.match(/\tscript\t/g) || []).length, 24);
});

test('fetches only the sync open-ticket route and atomically writes its generated script', async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'linear-island-npcs-'));
  const outputPath = join(tempDir, 'state', 'modbuild', 'npc', 'linear-mobs', 'tickets.txt');
  let requested;
  const result = await generateIslandNpcs({
    baseUrl: 'http://127.0.0.1:8787',
    outputPath,
    fetchImpl: async url => {
      requested = String(url);
      return { ok: true, async json() { return { tickets: [{ id: 'RO-1', title: 'Fixture', status: 'open' }] }; } };
    },
  });

  assert.equal(requested, 'http://127.0.0.1:8787/linear/tickets?status=open');
  assert.equal(result.ticketCount, 1);
  assert.match(await readFile(outputPath, 'utf8'), /RO-1 Fixture/);
});

test('sync failure leaves the previous generated script untouched', async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'linear-island-npcs-'));
  const outputPath = join(tempDir, 'tickets.txt');
  const { writeFile } = require('node:fs/promises');
  await writeFile(outputPath, 'previous snapshot');

  await assert.rejects(generateIslandNpcs({
    outputPath,
    fetchImpl: async () => ({ ok: false, status: 503 }),
  }), /HTTP 503/);
  assert.equal(await readFile(outputPath, 'utf8'), 'previous snapshot');
});
