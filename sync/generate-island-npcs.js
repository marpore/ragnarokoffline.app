'use strict';

const { mkdir, rename, unlink, writeFile } = require('node:fs/promises');
const { dirname, resolve } = require('node:path');

const MAX_TICKETS = 24;
const MAX_COMMENTS = 3;
const GRID = { columns: 6, startX: 20, startY: 48, stepX: 8, stepY: 5 };

function clean(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

function scriptString(value) {
  return '"' + clean(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function wrap(value, width = 68) {
  const text = clean(value);
  if (!text) return [''];
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const parts = Array.from(word);
    while (parts.length > width) {
      if (line) { lines.push(line); line = ''; }
      lines.push(parts.splice(0, width).join(''));
    }
    const next = line ? line + ' ' + parts.join('') : parts.join('');
    if (Array.from(next).length > width && line) {
      lines.push(line);
      line = parts.join('');
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function priorityRank(priority) {
  const n = Number(priority);
  return Number.isInteger(n) && n >= 1 && n <= 4 ? n : 5;
}

function displayName(ticket) {
  const id = clean(ticket.id).replace(/#/g, '-');
  const title = clean(ticket.title).replace(/"/g, "'");
  const room = Math.max(4, 23 - Array.from(id).length - 1);
  return `${id} ${Array.from(title).slice(0, room).join('')}`.trim();
}

function renderTicketNpcs(tickets, { limit = MAX_TICKETS } = {}) {
  if (!Array.isArray(tickets)) throw new TypeError('tickets must be an array');
  if (!Number.isInteger(limit) || limit < 0 || limit > MAX_TICKETS) throw new RangeError(`limit must be between 0 and ${MAX_TICKETS}`);

  const open = tickets.filter(ticket => ticket && ticket.status === 'open' &&
    typeof ticket.id === 'string' && ticket.id.trim() && typeof ticket.title === 'string')
    .slice()
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.id.localeCompare(b.id));
  const selected = open.slice(0, limit);
  const lines = [
    '// Generated from GET /linear/tickets?status=open by sync/generate-island-npcs.js.',
    '// Up to 24 active tickets occupy the fixed 6 by 4 island grid.',
    '',
  ];

  selected.forEach((ticket, index) => {
    const column = index % GRID.columns;
    const row = Math.floor(index / GRID.columns);
    const x = GRID.startX + column * GRID.stepX;
    const y = GRID.startY + row * GRID.stepY;
    const id = clean(ticket.id);
    const npcLabel = displayName(ticket).replace(/#/g, '-');
    const priority = Number.isInteger(Number(ticket.priority)) ? Number(ticket.priority) : 0;
    const comments = Array.isArray(ticket.comments) ? ticket.comments.slice(-MAX_COMMENTS) : [];

    lines.push(`ro_isle,${x},${y},4\tscript\t${npcLabel}#lnticket${String(index + 1).padStart(2, '0')}\t4_M_SAGE_A,{`);
    lines.push(`\tmes ${scriptString(id)};`);
    lines.push(`\tmes ${scriptString('Title:')};`);
    for (const part of wrap(ticket.title)) lines.push(`\tmes ${scriptString(part)};`);
    lines.push(`\tmes ${scriptString('Status: ' + (ticket.linearStatus || ticket.status || 'Unknown'))};`);
    lines.push(`\tmes ${scriptString('Priority: ' + (priority === 0 ? 'No priority' : priority))};`);
    lines.push(`\tmes ${scriptString('Assignee: ' + (clean(ticket.assignee) || 'Unassigned'))};`);
    if (comments.length) {
      lines.push(`\tmes ${scriptString('Recent comments:')};`);
      for (const comment of comments) {
        const author = clean(typeof comment === 'object' && comment ? comment.user : '');
        const body = clean(typeof comment === 'string' ? comment : comment?.body);
        if (!body) continue;
        for (const part of wrap((author ? author + ': ' : '') + body)) lines.push(`\tmes ${scriptString('- ' + part)};`);
      }
    }
    if (typeof ticket.url === 'string' && /^https?:\/\//i.test(ticket.url)) {
      lines.push(`\tmes ${scriptString('Linear: ' + ticket.url)};`);
    }
    lines.push('\tclose;', '}\n');
  });

  return { script: lines.join('\n'), ticketCount: selected.length, omittedCount: open.length - selected.length };
}

async function generateIslandNpcs({ baseUrl = process.env.SYNC_BASE_URL || 'http://127.0.0.1:8787', outputPath, fetchImpl = globalThis.fetch } = {}) {
  if (!outputPath) throw new Error('Pass --output or set ISLAND_NPC_OUTPUT to the loaded state/modbuild/npc/linear-mobs/tickets.txt path');
  const response = await fetchImpl(new URL('/linear/tickets?status=open', baseUrl));
  if (!response.ok) throw new Error(`Sync returned HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload || !Array.isArray(payload.tickets)) throw new Error('Sync returned an invalid ticket list');
  const rendered = renderTicketNpcs(payload.tickets);
  const target = resolve(outputPath);
  const directory = dirname(target);
  await mkdir(directory, { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  try {
    await writeFile(temp, rendered.script, { encoding: 'utf8' });
    await rename(temp, target);
  } catch (error) {
    try { await unlink(temp); } catch {}
    throw error;
  }
  return { ...rendered, outputPath: target };
}

function cliOutput(args) {
  const index = args.indexOf('--output');
  return index >= 0 ? args[index + 1] : process.env.ISLAND_NPC_OUTPUT;
}

if (require.main === module) {
  generateIslandNpcs({ outputPath: cliOutput(process.argv.slice(2)) })
    .then(result => {
      console.log(`Wrote ${result.ticketCount} ticket NPCs (${result.omittedCount} open tickets beyond the 24-slot limit) to ${result.outputPath}`);
      console.log('In game, run @reloadscript to apply the snapshot.');
    })
    .catch(error => {
      console.error(`Island NPC generation failed: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = { generateIslandNpcs, renderTicketNpcs };
