'use strict';

const { afterEach, test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const {
  enrichTicketsWithOpenPrs,
  generateIslandNpcs,
  renderTicketNpcs,
  visualForTicket,
} = require('../generate-island-npcs');

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
  assert.match(result.script, /ro_isle,8,10,4\tscript\t\[T\] RO-201 Urgent ticke#lnticket001\t4_M_SAGE_A/);
  assert.match(result.script, /ro_isle,15,10,4\tscript\t\[P\] RO-202 A quoted tit#lnticket002\t4_M_ALCHE_A/);
  assert.match(result.script, /Status: In Progress/);
  assert.match(result.script, /Priority: 3/);
  assert.match(result.script, /Assignee: Ada/);
  assert.match(result.script, /Recent comments:/);
  assert.match(result.script, /Keep \\\\safe please/);
  assert.match(result.script, /Linear: https:\/\/linear\.app\/team\/RO-202/);
  assert.match(result.script, /next;[\s\S]*select\("Show Linear link:Show PR link:Recent comments:Leave"\)/);
  assert.match(result.script, /if \(\.@action == 1\)/);
  assert.match(result.script, /if \(\.@action == 2\)/);
  assert.match(result.script, /if \(\.@action == 3\)/);
  assert.doesNotMatch(result.script, /Closed ticket/);
  assert.equal((result.script.match(/\tscript\t/g) || []).length, 2);
});

test('selects the locked status and open-PR sprite/prefix matrix with unknown states falling back to Todo', () => {
  const cases = [
    ['Todo', false, '[T]', '4_M_SAGE_A'],
    ['Backlog', true, '[T*]', '4_M_SAGE_C'],
    ['Triage', false, '[T]', '4_M_SAGE_A'],
    ['In Progress', false, '[P]', '4_M_ALCHE_A'],
    ['in progress', true, '[P*]', '4_M_ALCHE_C'],
    ['In Review', false, '[R]', '4_M_KNIGHT_BLACK'],
    ['Code Review', true, '[R*]', '4_M_KNIGHT_GOLD'],
    ['QA', false, '[R]', '4_M_KNIGHT_BLACK'],
    ['Testing', true, '[R*]', '4_M_KNIGHT_GOLD'],
    ['Blocked', true, '[?*]', '4_M_CRU'],
    ['New workflow state', false, '[T]', '4_M_SAGE_A'],
  ];
  for (const [linearStatus, hasPr, prefix, sprite] of cases) {
    const ticket = { id: 'RO-1', title: 'Visual matrix', status: 'open', linearStatus };
    if (hasPr) ticket.pr = { state: 'open', url: 'https://github.com/example/repo/pull/1' };
    assert.deepEqual(visualForTicket(ticket), {
      bucket: prefix === '[P]' || prefix === '[P*]' ? 'progress' :
        prefix === '[R]' || prefix === '[R*]' ? 'review' :
        prefix.startsWith('[?') ? 'other' : 'todo',
      prefix,
      hasPr,
      prUrl: hasPr ? 'https://github.com/example/repo/pull/1' : null,
      sprite,
    }, `${linearStatus}, hasPR=${hasPr}`);
  }
});

test('joins only open PRs by ticketId and keeps PRs available to already enriched tickets', () => {
  const tickets = [
    { id: 'RO-1', title: 'One', status: 'open' },
    { id: 'RO-2', title: 'Two', status: 'open', prUrl: 'https://github.com/example/repo/pull/2' },
  ];
  const prs = [
    { id: '3', ticketId: 'RO-1', state: 'open', url: 'https://github.com/example/repo/pull/3' },
    { id: '4', ticketId: 'RO-2', state: 'closed', url: 'https://github.com/example/repo/pull/4' },
  ];
  const joined = enrichTicketsWithOpenPrs(tickets, prs);
  assert.equal(joined[0].prUrl, prs[0].url);
  assert.equal(joined[0].pr.id, '3');
  assert.equal(joined[1].prUrl, 'https://github.com/example/repo/pull/2');
  assert.equal(visualForTicket({ ...joined[1], pr: { state: 'closed' } }).hasPr, false);
});

test('NPC names are ASCII, apostrophe-safe, and limited to 23 bytes before their unique suffix', () => {
  const result = renderTicketNpcs([{
    id: 'RO/9:;#{}|,\\',
    title: "a title with :;#{}|,/\\ 'quotes' and \u{1F680} emoji plus more text",
    status: 'open',
    linearStatus: 'Todo',
  }]);
  const header = result.script.split('\n').find(line => line.includes('\tscript\t'));
  const name = header.split('\tscript\t')[1].split('#lnticket')[0];
  assert.ok(Buffer.byteLength(name, 'utf8') <= 23);
  assert.doesNotMatch(name, /[^\x20-\x7e]/);
  assert.doesNotMatch(name, /[:;#{}|,/\\']/);
  assert.doesNotMatch(name, /['"]/);
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
  assert.match(result.script, /ro_isle,71,64,4\tscript\t\[T\] RO-198 Ticket 98#lnticket100\t4_M_SAGE_A/);
  assert.match(result.script, /\[T\] RO-204 Ticket 104#lnticket001/);
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
  assert.ok(coordinates.every(([x, y]) => Math.max(Math.abs(x - 40), Math.abs(y - 44)) > 1), 'not adjacent to the return NPC');
  for (const [x, y] of coordinates) {
    assert.ok(!(x >= 39 && x <= 41 && y >= 46 && y <= 48), `(${x},${y}) outside the return square`);
  }
});

test('fetches only the sync open-ticket route and atomically writes its generated script', async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'linear-island-npcs-'));
  const outputPath = join(tempDir, 'state', 'modbuild', 'npc', 'linear-mobs', 'tickets.txt');
  const requested = [];
  const result = await generateIslandNpcs({
    baseUrl: 'http://127.0.0.1:8787',
    outputPath,
    fetchImpl: async url => {
      const path = new URL(url).pathname;
      requested.push(path);
      if (path === '/github/prs') return { ok: true, async json() { return { prs: [] }; } };
      return { ok: true, async json() { return { tickets: Array.from({ length: 105 }, (_, i) => ({ id: `RO-${i + 1}`, title: `Fixture ${i + 1}`, status: 'open' })) }; } };
    },
  });

  assert.deepEqual(requested.sort(), ['/github/prs', '/linear/tickets']);
  assert.equal(result.ticketCount, 100);
  assert.equal(result.omittedCount, 5);
  const script = await readFile(outputPath, 'utf8');
  assert.match(script, /lnticket100/);
  assert.equal((script.match(/^ro_isle,.*\tscript\t/gm) || []).length, 100);
});

test('generator joins the sync PR index into sprite, display prefix, menu, and link', async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'linear-island-npcs-'));
  const outputPath = join(tempDir, 'tickets.txt');
  const result = await generateIslandNpcs({
    outputPath,
    fetchImpl: async url => {
      const path = new URL(url).pathname;
      if (path === '/github/prs') return { ok: true, async json() { return { prs: [
        { id: '42', ticketId: 'RO-1', state: 'open', url: 'https://github.com/example/repo/pull/42' },
        { id: '43', ticketId: 'RO-2', state: 'closed', url: 'https://github.com/example/repo/pull/43' },
      ] }; } };
      return { ok: true, async json() { return { tickets: [
        { id: 'RO-1', title: 'Build the island', status: 'open', linearStatus: 'In Progress', url: 'https://linear.app/RO-1' },
        { id: 'RO-2', title: 'No pull request', status: 'open', linearStatus: 'Backlog', url: 'https://linear.app/RO-2' },
      ] }; } };
    },
  });
  assert.equal(result.ticketCount, 2);
  const script = await readFile(outputPath, 'utf8');
  assert.match(script, /\[P\*\] RO-1 [^#]+#lnticket001\t4_M_ALCHE_C/);
  assert.match(script, /PR: https:\/\/github\.com\/example\/repo\/pull\/42/);
  assert.match(script, /select\("Show Linear link:Show PR link:Recent comments:Leave"\)/);
  assert.match(script, /\[T\] RO-2 [^#]+#lnticket002\t4_M_SAGE_A/);
  assert.match(script, /PR: No PR/);
  assert.match(script, /No linked PR/);
});

test('island return NPC and walk-over square save Prontera without changing ferry savepoint', async () => {
  const { readFile } = require('node:fs/promises');
  const island = await readFile(join(__dirname, '../../mods/custom-map/npc/isle.txt'), 'utf8');
  const ferry = await readFile(join(__dirname, '../../mods/island-ferry/npc/ferry.txt'), 'utf8');
  const gat = await readFile(join(__dirname, '../../mods/custom-map/data/ro_isle.gat'));
  const width = gat.readUInt32LE(6);
  const walkable = (x, y) => gat.readUInt32LE(14 + (y * width + x) * 20 + 16) === 0;
  assert.match(island, /ro_isle,40,44,4\tscript\tIsle Ferryman#islereturnnpc\t4_M_SEAMAN/);
  assert.match(island, /select\("Back to Prontera\?:Stay here"\)/);
  assert.match(island, /ro_isle,40,47,0\tscript\tReturn Square#islereturnwarp\t-1,1,1/);
  assert.match(island, /OnTouch:\s+savepoint "prontera",154,178;\s+warp "prontera",154,178;/);
  assert.doesNotMatch(ferry, /savepoint\s+"ro_isle"/i);
  assert.equal(walkable(40, 40), true, 'ferry landing is walkable');
  assert.equal(walkable(40, 44), true, 'return NPC tile is walkable');
  for (let y = 46; y <= 48; y++) {
    for (let x = 39; x <= 41; x++) assert.equal(walkable(x, y), true, `return square (${x},${y}) is walkable`);
  }
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
