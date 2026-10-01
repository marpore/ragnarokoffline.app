'use strict';

const { mkdir, rename, unlink, writeFile } = require('node:fs/promises');
const { dirname, resolve } = require('node:path');

const MAX_TICKETS = 100;
const MAX_COMMENTS = 3;
const GRID = {
  columns: 10,
  x: [8, 15, 22, 29, 35, 45, 51, 57, 64, 71],
  y: [10, 16, 22, 28, 34, 40, 46, 52, 58, 64],
};
const MAX_NPC_LABEL_LENGTH = 23;
const STATUS_STYLES = {
  todo: { prefix: 'T', noPr: '4_M_SAGE_A', pr: '4_M_SAGE_C' },
  progress: { prefix: 'P', noPr: '4_M_ALCHE_A', pr: '4_M_ALCHE_C' },
  review: { prefix: 'R', noPr: '4_M_KNIGHT_BLACK', pr: '4_M_KNIGHT_GOLD' },
  other: { prefix: '?', noPr: '4_F_KAFRA1', pr: '4_M_CRU' },
};

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

function statusBucket(ticket) {
  const status = clean(ticket.linearStatus || ticket.status).toLowerCase().replace(/\s+/g, ' ');
  if (['in progress', 'started'].includes(status)) return 'progress';
  if (['in review', 'code review', 'review', 'qa', 'testing'].includes(status)) return 'review';
  if (['blocked', 'on hold', 'waiting', 'paused', 'other'].includes(status)) return 'other';
  // Todo, Backlog, Triage, Unstarted, and unknown open states use the TODO
  // look so a new workflow name remains visible and predictable.
  return 'todo';
}

function openPr(ticket) {
  if (ticket.pr && typeof ticket.pr === 'object') {
    const state = clean(ticket.pr.state || ticket.pr.status).toLowerCase();
    if (state && state !== 'open') return null;
    return ticket.pr;
  }
  if (typeof ticket.prUrl === 'string' && ticket.prUrl) return { url: ticket.prUrl, state: 'open' };
  return null;
}

function enrichTicketsWithOpenPrs(tickets, prs) {
  const index = new Map();
  for (const pr of (Array.isArray(prs) ? prs : []).slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    if (String(pr.state || '').toLowerCase() !== 'open' || typeof pr.ticketId !== 'string') continue;
    if (!index.has(pr.ticketId)) index.set(pr.ticketId, pr);
  }
  return tickets.map(ticket => {
    if (openPr(ticket)) return ticket;
    const pr = index.get(ticket.id);
    return pr ? { ...ticket, pr, prUrl: pr.url || null } : ticket;
  });
}

function visualForTicket(ticket) {
  const bucket = statusBucket(ticket);
  const pr = openPr(ticket);
  const style = STATUS_STYLES[bucket];
  return {
    bucket,
    prefix: `[${style.prefix}${pr ? '*' : ''}]`,
    hasPr: Boolean(pr),
    prUrl: pr?.url || (pr ? ticket.prUrl || null : null),
    sprite: pr ? style.pr : style.noPr,
  };
}

function asciiNpcLabel(value) {
  // rAthena NAME_LENGTH is a byte-sized C buffer. Non-ASCII (emoji) and
  // apostrophes in display names have aborted tickets.txt on reload.
  return clean(value)
    .replace(/[^\x20-\x7e]/g, ' ')
    .replace(/[:;#{}|,/\\']/g, ' ')
    .replace(/"/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fitBytes(value, maxBytes) {
  let out = '';
  for (const ch of value) {
    const next = out + ch;
    if (Buffer.byteLength(next, 'utf8') > maxBytes) break;
    out = next;
  }
  return out.trimEnd();
}

function displayName(ticket, visual) {
  const safeId = asciiNpcLabel(ticket.id).replace(/ /g, '-');
  const title = asciiNpcLabel(ticket.title);
  const prefix = visual.prefix + ' ';
  const id = fitBytes(safeId, MAX_NPC_LABEL_LENGTH - Buffer.byteLength(prefix, 'utf8'));
  const base = prefix + id;
  const titleRoom = MAX_NPC_LABEL_LENGTH - Buffer.byteLength(base, 'utf8') - (title ? 1 : 0);
  const withTitle = titleRoom > 0 && title ? base + ' ' + fitBytes(title, titleRoom) : base;
  return fitBytes(withTitle.replace(/\s+/g, ' ').trim(), MAX_NPC_LABEL_LENGTH);
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
    `// Up to ${MAX_TICKETS} active tickets occupy the 10 by 10 island grid.`,
    '',
  ];

  selected.forEach((ticket, index) => {
    const column = index % GRID.columns;
    const row = Math.floor(index / GRID.columns);
    const x = GRID.x[column];
    const y = GRID.y[row];
    const id = clean(ticket.id);
    const visual = visualForTicket(ticket);
    const npcLabel = displayName(ticket, visual);
    const priority = Number.isInteger(Number(ticket.priority)) ? Number(ticket.priority) : 0;
    const comments = Array.isArray(ticket.comments) ? ticket.comments.slice(-MAX_COMMENTS) : [];
    const linearUrl = typeof ticket.url === 'string' && /^https?:\/\//i.test(ticket.url) ? ticket.url : '';
    const prUrl = typeof visual.prUrl === 'string' && /^https?:\/\//i.test(visual.prUrl) ? visual.prUrl : '';

    lines.push(`ro_isle,${x},${y},4\tscript\t${npcLabel}#lnticket${String(index + 1).padStart(3, '0')}\t${visual.sprite},{`);
    lines.push(`\tmes ${scriptString('Ticket: ' + id)};`);
    lines.push(`\tmes ${scriptString('Title:')};`);
    for (const part of wrap(ticket.title)) lines.push(`\tmes ${scriptString(part)};`);
    lines.push(`\tmes ${scriptString('Status: ' + (ticket.linearStatus || ticket.status || 'Unknown'))};`);
    lines.push(`\tmes ${scriptString('Priority: ' + (priority === 0 ? 'No priority' : priority))};`);
    lines.push(`\tmes ${scriptString('Assignee: ' + (clean(ticket.assignee) || 'Unassigned'))};`);
    lines.push(`\tmes ${scriptString('PR: ' + (prUrl || (visual.hasPr ? 'Linked PR (URL unavailable)' : 'No PR')))};`);
    lines.push(`\tmes ${scriptString('Linear: ' + (linearUrl || 'No Linear link'))};`);
    lines.push('\tnext;');
    lines.push(`\t.@action = select(${scriptString('Show Linear link:Show PR link:Recent comments:Leave')});`);
    lines.push('\tif (.@action == 1) {', `\t\tmes ${scriptString(linearUrl || 'No Linear link')};`, '\t\tclose;', '\t}');
    lines.push('\tif (.@action == 2) {', `\t\tmes ${scriptString(prUrl || (visual.hasPr ? 'Linked PR URL unavailable' : 'No linked PR'))};`, '\t\tclose;', '\t}');
    lines.push('\tif (.@action == 3) {');
    if (comments.length) {
      lines.push(`\t\tmes ${scriptString('Recent comments:')};`);
      for (const comment of comments) {
        const author = clean(typeof comment === 'object' && comment ? comment.user : '');
        const body = clean(typeof comment === 'string' ? comment : comment?.body);
        if (!body) continue;
        for (const part of wrap((author ? author + ': ' : '') + body)) lines.push(`\t\tmes ${scriptString(part)};`);
      }
    } else {
      lines.push(`\t\tmes ${scriptString('No recent comments')};`);
    }
    lines.push('\t\tclose;', '\t}');
    lines.push('\tclose;', '}\n');
  });

  return { script: lines.join('\n'), ticketCount: selected.length, omittedCount: open.length - selected.length };
}

async function generateIslandNpcs({ baseUrl = process.env.SYNC_BASE_URL || 'http://127.0.0.1:8787', outputPath, fetchImpl = globalThis.fetch } = {}) {
  if (!outputPath) throw new Error('Pass --output or set ISLAND_NPC_OUTPUT to the loaded state/modbuild/npc/linear-mobs/tickets.txt path');
  const [ticketResponse, prResponse] = await Promise.all([
    fetchImpl(new URL('/linear/tickets?status=open', baseUrl)),
    fetchImpl(new URL('/github/prs', baseUrl)),
  ]);
  if (!ticketResponse.ok) throw new Error(`Sync ticket list returned HTTP ${ticketResponse.status}`);
  if (!prResponse.ok) throw new Error(`Sync PR list returned HTTP ${prResponse.status}`);
  const [ticketPayload, prPayload] = await Promise.all([ticketResponse.json(), prResponse.json()]);
  if (!ticketPayload || !Array.isArray(ticketPayload.tickets)) throw new Error('Sync returned an invalid ticket list');
  if (!prPayload || !Array.isArray(prPayload.prs)) throw new Error('Sync returned an invalid PR list');
  const tickets = enrichTicketsWithOpenPrs(ticketPayload.tickets, prPayload.prs);
  const rendered = renderTicketNpcs(tickets);
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
      console.log(`Wrote ${result.ticketCount} ticket NPCs (${result.omittedCount} open tickets beyond the ${MAX_TICKETS}-slot limit) to ${result.outputPath}`);
      console.log('In game, run @reloadscript to apply the snapshot.');
    })
    .catch(error => {
      console.error(`Island NPC generation failed: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  enrichTicketsWithOpenPrs,
  generateIslandNpcs,
  renderTicketNpcs,
  statusBucket,
  visualForTicket,
};
