import { syncFetch } from './sync-fetch.js';

let initialized = false;

// Extension Hooks will later use the shared syncFetch helper for ticket APIs.
export default function init(_parameters, api) {
  if (api?.version !== 1) {
    console.error('[linear-mobs] requires client API 1, got', api?.version);
    return false;
  }
  if (initialized) return;
  initialized = true;

  const host = document.createElement('div');
  host.id = 'linear-mobs-overlay';
  host.innerHTML = [
    '<style>',
    '#linear-mobs-launcher { position:fixed; left:12px; bottom:12px; z-index:10020; border:1px solid #c6a96b; border-radius:7px; padding:8px 12px; color:#fff6de; background:#2d2418ef; font:14px system-ui; cursor:pointer; }',
    '#linear-mobs-dialog { width:min(820px, 92vw); max-height:82vh; padding:18px; border:1px solid #b89d68; border-radius:12px; color:#f7f0df; background:#211d18; font:14px system-ui; box-shadow:0 12px 50px #000b; }',
    '#linear-mobs-dialog::backdrop { background:#0009; }',
    '#linear-mobs-dialog header { display:flex; align-items:center; gap:8px; margin-bottom:12px; }',
    '#linear-mobs-dialog h2 { flex:1; margin:0; font-size:20px; }',
    '#linear-mobs-dialog button { border:1px solid #75664d; border-radius:6px; padding:7px 10px; color:inherit; background:#393126; cursor:pointer; }',
    '#linear-mobs-layout { display:grid; grid-template-columns:minmax(210px, 0.8fr) minmax(260px, 1.2fr); gap:14px; }',
    '#linear-mobs-list { display:flex; flex-direction:column; gap:6px; max-height:55vh; overflow:auto; }',
    '#linear-mobs-list button { text-align:left; border-left:4px solid #948b7a; }',
    '#linear-mobs-list button[data-priority="1"] { border-left-color:#df5548; }',
    '#linear-mobs-list button[data-priority="2"] { border-left-color:#ec9b4f; }',
    '#linear-mobs-list button[data-priority="3"] { border-left-color:#d8c267; }',
    '#linear-mobs-list button[data-priority="4"] { border-left-color:#83a6a2; }',
    '#linear-mobs-detail { max-height:55vh; overflow:auto; padding:12px; border:1px solid #514838; border-radius:8px; }',
    '#linear-mobs-detail h3 { margin:0 0 5px; }',
    '#linear-mobs-detail dl { display:grid; grid-template-columns:100px 1fr; gap:6px 10px; }',
    '#linear-mobs-detail dt { color:#c6b99c; }',
    '#linear-mobs-detail dd { margin:0; overflow-wrap:anywhere; }',
    '#linear-mobs-detail ul { padding-left:20px; }',
    '#linear-mobs-detail li { margin:8px 0; white-space:pre-wrap; overflow-wrap:anywhere; }',
    '#linear-mobs-status { min-height:1.4em; margin:10px 0 0; color:#c6b99c; }',
    '#linear-mobs-dialog a { color:#9ac8ef; }',
    '@media (max-width:620px) { #linear-mobs-layout { grid-template-columns:1fr; } #linear-mobs-list, #linear-mobs-detail { max-height:32vh; } }',
    '</style>',
    '<button id="linear-mobs-launcher" type="button" aria-haspopup="dialog">Linear tasks <span id="linear-mobs-count">0</span></button>',
    '<dialog id="linear-mobs-dialog" aria-labelledby="linear-mobs-title">',
    '<header><h2 id="linear-mobs-title">My open Linear tickets</h2><button id="linear-mobs-refresh" type="button">Refresh</button><button id="linear-mobs-close" type="button" aria-label="Close">Close</button></header>',
    '<div id="linear-mobs-layout"><nav id="linear-mobs-list" aria-label="Open Linear tickets"></nav><section id="linear-mobs-detail" aria-live="polite">Choose a ticket to inspect it.</section></div>',
    '<p id="linear-mobs-status" role="status"></p>',
    '</dialog>',
  ].join('');
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:1500;';
  const launcherEl = () => host.querySelector('#linear-mobs-launcher');
  // pointer-events on host none; re-enable on controls after append
  document.body.append(host);
  for (const el of host.querySelectorAll('button, dialog')) el.style.pointerEvents = 'auto';
  console.info('[linear-mobs] overlay ready');


  const launcher = host.querySelector('#linear-mobs-launcher');
  const dialog = host.querySelector('#linear-mobs-dialog');
  const count = host.querySelector('#linear-mobs-count');
  const list = host.querySelector('#linear-mobs-list');
  const detail = host.querySelector('#linear-mobs-detail');
  const status = host.querySelector('#linear-mobs-status');
  let tickets = [];
  let onMap = Boolean(api.snapshot().map);
  let refreshPromise = null;
  let syncWarningShown = false;
  let resumeInput = null;

  function priorityName(priority) {
    return ({ 1: 'Urgent', 2: 'High', 3: 'Normal', 4: 'Low' })[priority] || 'None';
  }

  function renderList() {
    count.textContent = String(tickets.length);
    list.replaceChildren();
    if (!tickets.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No open tickets found.';
      list.append(empty);
      return;
    }
    for (const ticket of tickets) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.priority = String(ticket.priority || 0);
      button.textContent = (ticket.title || '(untitled)') + ' · ' + ticket.id;
      button.addEventListener('click', () => inspect(ticket));
      list.append(button);
    }
  }

  function appendField(parent, label, value) {
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value == null || value === '' ? '—' : String(value);
    parent.append(term, description);
  }

  function renderDetails(ticket) {
    detail.replaceChildren();
    const heading = document.createElement('h3');
    heading.textContent = ticket.title || '(untitled)';
    const identifier = document.createElement('p');
    identifier.textContent = ticket.id || 'Unknown ticket';
    detail.append(heading, identifier);

    const fields = document.createElement('dl');
    appendField(fields, 'Status', ticket.linearStatus || ticket.status);
    appendField(fields, 'Priority', priorityName(ticket.priority));
    appendField(fields, 'Assignee', ticket.assignee);
    detail.append(fields);

    if (ticket.url) {
      try {
        const url = new URL(ticket.url);
        if (url.protocol === 'https:' || url.protocol === 'http:') {
          const link = document.createElement('a');
          link.href = url.href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = 'Open in Linear';
          detail.append(link);
        }
      } catch {
        // Ignore malformed fixture or webhook URLs.
      }
    }

    const commentsHeading = document.createElement('h4');
    commentsHeading.textContent = 'Recent comments';
    const comments = document.createElement('ul');
    const recent = Array.isArray(ticket.comments) ? ticket.comments.slice(-5).reverse() : [];
    if (!recent.length) {
      const empty = document.createElement('li');
      empty.textContent = 'No comments in the local cache.';
      comments.append(empty);
    } else {
      for (const comment of recent) {
        const item = document.createElement('li');
        const author = comment.user?.name || comment.author?.name;
        item.textContent = (author ? author + ': ' : '') + (comment.body || comment.text || '');
        comments.append(item);
      }
    }
    detail.append(commentsHeading, comments);
  }

  async function inspect(ticket) {
    detail.textContent = 'Loading ticket details…';
    try {
      const response = await syncFetch('/linear/tickets/' + encodeURIComponent(ticket.id));
      if (!response.ok) throw new Error('Ticket request returned HTTP ' + response.status);
      const fullTicket = await response.json();
      renderDetails(fullTicket);
    } catch {
      renderDetails(ticket);
      status.textContent = 'Showing list data; ticket details could not be refreshed.';
    }
  }

  async function refreshTickets() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      status.textContent = 'Refreshing…';
      try {
        const response = await syncFetch('/linear/tickets?status=open');
        if (!response.ok) throw new Error('Ticket list returned HTTP ' + response.status);
        const result = await response.json();
        if (!Array.isArray(result.tickets)) throw new Error('Invalid ticket list');
        tickets = result.tickets;
        syncWarningShown = false;
        status.textContent = tickets.length + ' open ticket' + (tickets.length === 1 ? '' : 's') + ' from local sync.';
        renderList();
      } catch (error) {
        tickets = [];
        status.textContent = 'Sync server unavailable. Start sync:dev to load tickets.';
        renderList();
        if (!syncWarningShown) {
          console.warn('[linear-mobs] Could not load Linear tickets from local sync server.', error);
          syncWarningShown = true;
        }
      }
    })();
    try {
      await refreshPromise;
    } finally {
      refreshPromise = null;
    }
  }

  launcher.addEventListener('click', () => {
    if (!dialog.open) {
      resumeInput = api.input.suspend();
      dialog.showModal();
    }
  });
  host.querySelector('#linear-mobs-close').addEventListener('click', () => dialog.close());
  host.querySelector('#linear-mobs-refresh').addEventListener('click', refreshTickets);
  dialog.addEventListener('close', () => {
    resumeInput?.();
    resumeInput = null;
  });

  const onFocus = () => {
    if (onMap && document.visibilityState === 'visible') refreshTickets();
  };
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onFocus);
  const poll = window.setInterval(() => {
    if (onMap) refreshTickets();
  }, 60_000);

  api.on('map:enter', () => {
    onMap = true;
    refreshTickets();
  });
  api.on('map:leave', () => {
    onMap = false;
    if (dialog.open) dialog.close();
  });
  launcher.hidden = false;
  api.cleanup(() => {
    window.clearInterval(poll);
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onFocus);
    if (dialog.open) dialog.close();
    host.remove();
  });
  refreshTickets();
}
