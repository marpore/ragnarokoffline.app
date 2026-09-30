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
  assert.match(result.script, /ro_isle,8,10,4\tscript\tRO-201 Urgent ticket#lnticket001\t4_M_SAGE_A/);
  assert.match(result.script, /ro_isle,15,10,4\tscript\tRO-202 A 'quoted' title#lnticket002\t4_M_SAGE_A/);
  assert.match(result.script, /Status: In Progress/);
  assert.match(result.script, /Priority: 3/);
  assert.match(result.script, /Assignee: Ada/);
  assert.match(result.script, /Recent comments:/);
  assert.match(result.script, /Keep \\\\safe please/);
  assert.match(result.script, /Linear: https:\/\/linear\.app\/team\/RO-202/);
  assert.doesNotMatch(result.script, /Closed ticket/);
  assert.equal((result.script.match(/\tscript\t/g) || []).length, 2);
});

test('generates 100 NPCs from 105 open tickets, reports 5 omitted, and keeps every slot walkable', async () => {
  const tickets = Array.from({ length: 105 }, (_, i) => ({
    id: `RO-${String(100 + i).padStart(3, '0')}`,
    title: `Ticket ${i}`,
    status: 'open',
    priority: i === 104 ? 1 : 4,
  }));
  const result = renderTicketNpcs(tickets);
  assert.equal(result.ticketCount, 100);
  assert.equal(result.omittedCount, 5);
  assert.match(result.script, /ro_isle,71,64,4\tscript\tRO-198 Ticket 98#lnticket100\t4_M_SAGE_A/);
  assert.match(result.script, /RO-204 Ticket 104#lnticket001/);
  assert.doesNotMatch(result.script, /RO-199 Ticket 99/);
  const coordinates = [...result.script.matchAll(/^ro_isle,(\d+),(\d+),4\tscript/gm)]
    .map(([, x, y]) => [Number(x), Number(y)]);
  assert.equal(coordinates.length, 100);
  const gat = await readFile(join(__dirname, '../../mods/custom-map/data/ro_isle.gat'));
  const width = gat.readUInt32LE(6);
  const height = gat.readUInt32LE(10);
  for (const [x, y] of coordinates) {
    assert.ok(x >= 0 && x < width && y >= 0 && y < height, `(${x},${y}) inside ${width}x${height}`);
    assert.equal(gat.readUInt32LE(14 + (y * width + x) * 20 + 16), 0, `(${x},${y}) is walkable`);
  }
  assert.ok(coordinates.every(([x, y]) => (x - 40) ** 2 + (y - 40) ** 2 >= 25), 'away from the spawn point');
  assert.ok(coordinates.every(([x, y]) => (x - 40) ** 2 + (y - 68) ** 2 >= 41), 'away from the return warp');
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
      return { ok: true, async json() { return { tickets: Array.from({ length: 105 }, (_, i) => ({ id: `RO-${i + 1}`, title: `Fixture ${i + 1}`, status: 'open' })) }; } };
    },
  });

  assert.equal(requested, 'http://127.0.0.1:8787/linear/tickets?status=open');
  assert.equal(result.ticketCount, 100);
  assert.equal(result.omittedCount, 5);
  const script = await readFile(outputPath, 'utf8');
  assert.match(script, /lnticket100/);
  assert.equal((script.match(/^ro_isle,.*\tscript\t/gm) || []).length, 100);
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
