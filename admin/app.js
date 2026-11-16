// dev-dsue Admin (renderer): shell, sign-in, mailbox, compose – dashboard/beta/release live in views.js
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON = {
  inbox: '<svg viewBox="0 0 24 24"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/></svg>',
  sent: '<svg viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/></svg>',
  drafts: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  junk: '<svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
  archive: '<svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  beta: '<svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>',
  clip: '<svg viewBox="0 0 24 24"><path d="m21 11-9.2 9.2a5.5 5.5 0 0 1-7.8-7.8l9.2-9.2a3.7 3.7 0 0 1 5.2 5.2l-9.2 9.2a1.8 1.8 0 0 1-2.6-2.6l8.5-8.5"/></svg>',
  reply: '<svg viewBox="0 0 24 24"><path d="m9 17-5-5 5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>',
  replyAll: '<svg viewBox="0 0 24 24"><path d="m7 17-5-5 5-5"/><path d="m12 17-5-5 5-5"/><path d="M22 18v-2a4 4 0 0 0-4-4H7"/></svg>',
  forward: '<svg viewBox="0 0 24 24"><path d="m15 17 5-5-5-5"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg>',
  unread: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
};
const NAMES = { '\\Inbox': 'Posteingang', '\\Sent': 'Gesendet', '\\Drafts': 'Entwürfe', '\\Junk': 'Spam', '\\Trash': 'Papierkorb', '\\Archive': 'Archiv' };
const ICONS = { '\\Inbox': 'inbox', '\\Sent': 'sent', '\\Drafts': 'drafts', '\\Junk': 'junk', '\\Trash': 'trash', '\\Archive': 'archive' };
const ORDER = ['\\Inbox', '\\Drafts', '\\Sent', '\\Archive', '\\Junk', '\\Trash'];

let ME = '', folders = [], folder = 'INBOX', page = 1, q = '', items = [], cur = null, timer = 0, filter = 'all', counts = null, own = false;
const picked = new Set();

// ---------------- api ----------------
async function call(path, body) {
  const r = await fetch('/api/' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dsue': '1' }, body: JSON.stringify(body) } : { headers: { 'X-Dsue': '1' } });
  let d = {}; try { d = await r.json(); } catch {}
  if (r.status === 401 && path !== 'login') { showLogin(); throw new Error('Bitte neu anmelden'); }
  if (!r.ok) throw new Error(d.error || 'Fehler ' + r.status);
  return d;
}
function toast(t, err) { const el = $('toast'); el.textContent = t; el.classList.toggle('err', !!err); el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 2800); }
const when = d => { const t = new Date(d), n = new Date(); if (t.toDateString() === n.toDateString()) return t.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); if (n - t < 6 * 864e5) return t.toLocaleDateString('de-DE', { weekday: 'short' }); return t.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: n.getFullYear() === t.getFullYear() ? undefined : '2-digit' }); };
const who = a => a ? (a.name || a.address || '') : '';
const initial = a => esc(((a && (a.name || a.address)) || '?').trim().charAt(0).toUpperCase());

// ---------------- theme ----------------
try { if (localStorage.getItem('theme') === 'light') delete document.documentElement.dataset.theme; } catch {}
$('theme').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme !== 'dark';
  if (dark) document.documentElement.dataset.theme = 'dark'; else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch {}
});

// ---------------- sign in ----------------
function showLogin() { clearInterval(timer); $('app').classList.add('hidden'); $('login').classList.remove('hidden'); $('lPass').value = ''; setTimeout(() => ($('lUser').value ? $('lPass') : $('lUser')).focus(), 50); }
$('loginForm').addEventListener('submit', async e => {
  e.preventDefault(); $('lErr').textContent = ''; $('lBtn').disabled = true; $('lBtn').textContent = 'Anmelden …';
  try { const r = await call('login', { user: $('lUser').value, pass: $('lPass').value }); $('lPass').value = ''; ME = r.user; startApp(); }
  catch (err) { $('lErr').textContent = err.message; }
  $('lBtn').disabled = false; $('lBtn').textContent = 'Anmelden';
});
$('logoutBtn').addEventListener('click', async () => { try { await call('logout', {}); } catch {} ME = ''; showLogin(); });

// ---------------- router ----------------
const VIEWS = {};   // views.js registers dash / beta / release
const VIEW_IDS = { dash: 'vDash', mail: 'vMail', beta: 'vBeta', release: 'vRelease' };
let view = '';
function show(v, opts) {
  if (!VIEW_IDS[v]) v = 'dash';
  view = v;
  for (const [k, id] of Object.entries(VIEW_IDS)) $(id).classList.toggle('on', k === v);
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  if (location.hash !== '#' + v) history.replaceState(null, '', '#' + v);
  if (v === 'mail') { if (!opts || !opts.keep) { loadFolders().then(() => loadList()).catch(e => toast(e.message, true)); } }
  else if (VIEWS[v] && VIEWS[v].enter) VIEWS[v].enter(opts);
}
document.addEventListener('click', e => {
  const n = e.target.closest('[data-view]'); if (n) { show(n.dataset.view); return; }
  const g = e.target.closest('[data-go]'); if (g) { if (g.dataset.go === 'compose') openCompose('new'); else show(g.dataset.go); }
});
window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (v && v !== view) show(v); });
function setBadge(id, n) { const el = $(id); el.textContent = n; el.classList.toggle('hidden', !n); }
// open one message from another view (dashboard, beta)
async function openMail(f, uid) { folder = f; page = 1; q = ''; $('q').value = ''; show('mail', { keep: true }); await loadFolders(); await loadList(); if (uid) openMsg(uid); }

// ---------------- folders ----------------
async function loadFolders() {
  folders = await call('folders');
  folders.sort((a, b) => { const ia = ORDER.indexOf(a.special), ib = ORDER.indexOf(b.special); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.path.localeCompare(b.path); });
  if (!folders.some(f => f.path === folder)) folder = (folders.find(f => f.special === '\\Inbox') || folders[0] || {}).path || 'INBOX';
  drawFolders();
}
const fname = f => NAMES[f.special] || (f.path === 'INBOX' ? 'Posteingang' : f.name);
const isBetaF = f => /^beta /i.test(f.path);
const isDrafts = () => ((folders.find(f => f.path === folder) || {}).special || '') === '\\Drafts' || /^(drafts|entw)/i.test(folder);
function fbtn(f) { return `<button class="folder${f.path === folder ? ' on' : ''}" data-f="${esc(f.path)}">${ICON[ICONS[f.special] || (f.path === 'INBOX' ? 'inbox' : isBetaF(f) ? 'beta' : 'folder')]}<span>${esc(isBetaF(f) ? f.name.replace(/^beta /i, '') : fname(f))}</span>${f.unseen && f.special !== '\\Trash' && f.special !== '\\Sent' ? `<i>${f.unseen}</i>` : ''}</button>`; }
function drawFolders() {
  const main = folders.filter(f => !isBetaF(f)), bet = folders.filter(isBetaF);
  $('folders').innerHTML = main.map(fbtn).join('') + (bet.length ? '<div class="fgroup">Beta</div>' + bet.map(fbtn).join('') : '');
  const f = folders.find(x => x.path === folder); $('folderTitle').textContent = f ? (isBetaF(f) ? f.name : fname(f)) : folder;
  const unread = (folders.find(x => x.special === '\\Inbox' || x.path === 'INBOX') || {}).unseen || 0;
  setBadge('navUnread', unread);
  document.title = (unread ? `(${unread}) ` : '') + 'Admin – dev-dsue';
  $('bulkMove').innerHTML = '<option value="">Verschieben …</option>' + folders.filter(x => x.path !== folder).map(x => `<option value="${esc(x.path)}">${esc(isBetaF(x) ? x.name : fname(x))}</option>`).join('');
}
$('folders').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (!b) return; folder = b.dataset.f; page = 1; cur = null; picked.clear(); drawFolders(); loadList(); clearReader(); $('panes').classList.remove('menu-open'); });
$('menuBtn').addEventListener('click', () => $('panes').classList.toggle('menu-open'));

// ---------------- list + multi-select ----------------
async function loadList(quiet) {
  try {
    const r = await call(`list?folder=${encodeURIComponent(folder)}&page=${page}&q=${encodeURIComponent(q)}&filter=${filter}`);
    items = r.items.sort((a, b) => new Date(b.date) - new Date(a.date)); counts = r.counts || null; own = !!r.own; drawChips(); for (const u of [...picked]) if (!items.some(m => m.uid === u)) picked.delete(u);
    drawList();
    const pages = Math.max(1, Math.ceil(r.total / r.per));
    $('pager').innerHTML = pages > 1 ? `<button class="icon-btn" data-pg="-1" ${page <= 1 ? 'disabled' : ''}>‹</button><span>Seite ${page} von ${pages} · ${r.total} E-Mails</span><button class="icon-btn" data-pg="1" ${page >= pages ? 'disabled' : ''}>›</button>` : '';
  } catch (e) { if (!quiet) toast(e.message, true); }
}
// ---- smart bits: answered / waiting / groups / tags ----
const NOREPLY = /(no-?reply|do-?not-?reply|newsletter|notifications?@|notify|mailer-daemon|postmaster|billing|bounce|news@)/i;
const sender = m => (m.replyTo || (m.from && m.from.address) || '').toLowerCase();
const needsReply = m => !own && !m.answered && !NOREPLY.test(sender(m));
const ageDays = d => Math.floor((Date.now() - new Date(d)) / 864e5);
const longDate = d => new Date(d).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
function groupOf(d) {
  const t = new Date(d), n = new Date(), day = 864e5, start = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  if (t >= start) return 'Heute'; if (t >= start - day) return 'Gestern'; if (t >= start - 6 * day) return 'Letzte 7 Tage'; if (t >= start - 30 * day) return 'Letzte 30 Tage'; return 'Älter';
}
function kindTag(m) {
  if (/team-bewerbung/i.test(m.subject)) return '<span class="tag team">Team</span>';
  if (/beta/i.test(m.subject)) return '<span class="tag">Beta</span>';
  return '';
}
function drawChips() {
  const el = $('fchips'); if (!el) return;
  if (own || !counts) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const c = (k, label, n, title) => `<button data-filter="${k}" class="${filter === k ? 'on' : ''}" title="${title}">${label}${n != null ? `<i>${n}</i>` : ''}</button>`;
  el.innerHTML = c('all', 'Alle', null, 'Alle E-Mails (Taste 1)') + c('open', 'Offen', counts.open, 'Noch nicht beantwortet (Taste 2)') + c('unread', 'Ungelesen', counts.unread, 'Ungelesen (Taste 3)') + c('answered', 'Beantwortet', null, 'Schon beantwortet (Taste 4)') + c('flagged', '★', counts.flagged, 'Markiert (Taste 5)');
}
function setFilter(f) { if (filter === f) f = 'all'; filter = f; page = 1; picked.clear(); loadList(); }
function drawList() {
  const sentLike = own;
  let g = '';
  $('items').innerHTML = items.length ? items.map(m => {
    const grp = groupOf(m.date), head = grp !== g ? `<div class="grp">${grp}</div>` : ''; g = grp;
    const wait = needsReply(m) && ageDays(m.date) >= 1 ? `<span class="wait${ageDays(m.date) >= 3 ? ' late' : ''}" title="Wartet seit ${ageDays(m.date)} Tag(en) auf Antwort">${ageDays(m.date)} T.</span>` : '';
    const ans = !sentLike && m.answered ? `<span class="ans" title="${m.answeredAt ? 'Beantwortet am ' + esc(longDate(m.answeredAt)) : 'Beantwortet'}">${ICON.reply}</span>` : '';
    return `${head}<div class="item${m.seen ? '' : ' unread'}${!sentLike && m.answered ? ' answered' : ''}${cur && cur.uid === m.uid ? ' on' : ''}${picked.has(m.uid) ? ' picked' : ''}" data-uid="${m.uid}" role="button" tabindex="0">
    <label class="chk" data-pick="${m.uid}"><input type="checkbox"${picked.has(m.uid) ? ' checked' : ''}><span></span></label>
    <div class="c"><div class="r1"><span class="who">${esc(sentLike ? 'An: ' + (m.to || []).map(who).join(', ') : (/team-bewerbung/i.test(m.subject) && / – ([^–]+)$/.test(m.subject) ? m.subject.match(/ – ([^–]+)$/)[1].trim() : m.replyTo && (m.from || {}).address === ME ? m.replyTo : who(m.from)))}</span>${ans}${wait}<time>${esc(when(m.date))}</time></div>
    <div class="subj">${sentLike ? '' : kindTag(m)}<span>${esc(m.subject || '(kein Betreff)')}</span>${m.att ? ICON.clip : ''}${m.flagged ? `<span class="star" style="flex:none">${ICON.star}</span>` : ''}</div></div></div>`;
  }).join('')
    : `<div class="noitems">${q ? 'Nichts gefunden.' : filter === 'open' ? '🎉 Alles beantwortet – nichts mehr offen.' : filter !== 'all' ? 'Keine passenden E-Mails.' : 'Keine E-Mails in diesem Ordner.'}</div>`;
  drawBulk();
}
function drawBulk() {
  const n = picked.size, all = $('selAll');
  $('bulk').classList.toggle('hidden', !n); $('bulkN').textContent = n + ' ausgewählt';
  all.checked = n > 0 && n === items.length; all.indeterminate = n > 0 && n < items.length;
}
$('items').addEventListener('click', e => {
  const p = e.target.closest('[data-pick]');
  if (p) { e.preventDefault(); const u = +p.dataset.pick; picked.has(u) ? picked.delete(u) : picked.add(u); drawList(); return; }
  const b = e.target.closest('[data-uid]'); if (!b) return;
  if (e.shiftKey || e.metaKey || e.ctrlKey) { const u = +b.dataset.uid; picked.has(u) ? picked.delete(u) : picked.add(u); drawList(); return; }
  openMsg(+b.dataset.uid);
});
$('fchips').addEventListener('click', e => { const b = e.target.closest('[data-filter]'); if (b) setFilter(b.dataset.filter); });
$('selAll').addEventListener('change', e => { picked.clear(); if (e.target.checked) items.forEach(m => picked.add(m.uid)); drawList(); });
async function bulk(action, to) {
  const uids = [...picked]; if (!uids.length) return;
  if (action === 'delete' && !confirm(uids.length + ' E-Mail(s) löschen?')) return;
  try {
    await call('bulk', { folder, uids, action, to });
    toast({ seen: 'Als gelesen markiert', unseen: 'Als ungelesen markiert', flag: 'Markiert', answered: 'Als erledigt markiert', move: 'Verschoben', delete: 'Gelöscht' }[action] + ' ✓');
    if (action === 'move' || action === 'delete') { if (cur && picked.has(cur.uid)) { cur = null; clearReader(); } }
    picked.clear(); await loadFolders(); await loadList();
  } catch (er) { toast(er.message, true); }
}
$('bulk').addEventListener('click', e => { const b = e.target.closest('[data-bulk]'); if (b) bulk(b.dataset.bulk); });
$('bulkMove').addEventListener('change', e => { const to = e.target.value; e.target.value = ''; if (to) bulk('move', to); });
$('pager').addEventListener('click', e => { const b = e.target.closest('[data-pg]'); if (b) { page += +b.dataset.pg; loadList(); } });
$('refreshBtn').addEventListener('click', () => { loadFolders(); loadList(); });
let qt = 0; $('q').addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(() => { q = $('q').value.trim(); page = 1; loadList(); }, 350); });

// ---------------- reading ----------------
function clearReader() { $('reader').innerHTML = '<div class="empty-reader">' + ICON.unread + '<p>Wähle eine E-Mail aus</p></div>'; $('panes').classList.remove('reading'); }
const linkify = t => esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
function frameDoc(m, images) {
  let html = m.html || `<div style="white-space:pre-wrap;font-family:inherit">${linkify(m.text)}</div>`;
  for (const [cid, data] of Object.entries(m.inline || {})) html = html.split('cid:' + cid).join(data);
  const csp = `default-src 'none'; img-src data:${images ? ' https: http:' : ''}; style-src 'unsafe-inline'; font-src data:`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>body{margin:0;padding:18px 20px;font:15px/1.6 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#1b1d22;word-wrap:break-word}img{max-width:100%;height:auto}a{color:#3b4ef0}blockquote{margin:0 0 0 .6em;padding-left:.8em;border-left:3px solid #d5d8e3;color:#5b6176}</style></head><body>${html}</body></html>`;
}
const hasRemote = m => !!m.html && /(<img[^>]+src=["']?https?:|url\(\s*["']?https?:|background=["']?https?:)/i.test(m.html);
async function openMsg(uid) {
  try {
    const m = await call(`message?folder=${encodeURIComponent(folder)}&uid=${uid}`);
    if (isDrafts()) return openCompose('draft', m);
    cur = m;
    const it = items.find(x => x.uid === uid);
    if (it) { m.answered = m.answered || it.answered; m.answeredAt = it.answeredAt; } if (it && !it.seen) { it.seen = true; const f = folders.find(x => x.path === folder); if (f && f.unseen) f.unseen--; drawFolders(); }
    drawList(); drawReader(false);
    $('panes').classList.add('reading');
  } catch (e) { toast(e.message, true); }
}
function drawReader(images) {
  const m = cur, f = (m.from || [])[0] || {};
  const moveOpts = folders.filter(x => x.path !== folder).map(x => `<option value="${esc(x.path)}">${esc(isBetaF(x) ? x.name : fname(x))}</option>`).join('');
  const tpls = MS.templates.map((t, i) => `<option value="${i}">${esc(t.name)}</option>`).join('');
  $('reader').innerHTML = `
    <div class="rbar">
      <button class="icon-btn rback" id="rBack" title="Zurück">${ICON.back}</button>
      <button class="icon-btn" data-act="reply" title="Antworten">${ICON.reply}</button>
      <button class="icon-btn" data-act="replyAll" title="Allen antworten">${ICON.replyAll}</button>
      <button class="icon-btn" data-act="forward" title="Weiterleiten">${ICON.forward}</button>
      <select id="tplReply" title="Mit Vorlage antworten"><option value="">↩︎ Mit Vorlage …</option>${tpls}</select>
      <span class="sp"></span>
      ${own ? '' : `<button class="icon-btn${m.answered ? ' on-ok' : ''}" data-act="done" title="${m.answered ? 'Beantwortet' : 'Als erledigt markieren (E)'}"${m.answered ? ' disabled' : ''}>${ICON.check}</button>`}
      <button class="icon-btn" data-act="star" title="Markieren" style="${m.flagged ? 'color:#f5a623' : ''}">${ICON.star}</button>
      <button class="icon-btn" data-act="unread" title="Als ungelesen markieren">${ICON.unread}</button>
      <select id="moveSel" title="Verschieben"><option value="">Verschieben …</option>${moveOpts}</select>
      <button class="icon-btn danger" data-act="delete" title="Löschen">${ICON.trash}</button>
    </div>
    <div class="rhead">
      <h2>${esc(m.subject || '(kein Betreff)')}</h2>
      <div class="from"><div class="avatar">${initial(f)}</div>
        <div style="min-width:0"><b>${esc(f.name || f.address)}</b><div class="addr">${esc(f.address)}</div></div>
        <time>${esc(new Date(m.date).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }))}</time></div>
      <div class="to">An: ${esc((m.to || []).map(a => a.name ? `${a.name} <${a.address}>` : a.address).join(', '))}${(m.cc || []).length ? ' · Cc: ' + esc(m.cc.map(a => a.address).join(', ')) : ''}</div>
      ${own ? '' : m.answered ? `<div class="rstate ok">${ICON.check}<span>Beantwortet${m.answeredAt ? ' am ' + esc(longDate(m.answeredAt)) : ''}</span></div>`
        : `<div class="rstate open">${ICON.reply}<span>Noch nicht beantwortet${ageDays(m.date) >= 1 ? ` · wartet seit ${ageDays(m.date)} Tag${ageDays(m.date) === 1 ? '' : 'en'}` : ''}</span><button class="link" data-act="done">Als erledigt markieren</button></div>`}
    </div>
    ${!images && hasRemote(m) ? '<div class="blocked">Externe Bilder wurden zu deinem Schutz blockiert. <button id="loadImgs">Bilder laden</button></div>' : ''}
    ${(m.attachments || []).filter(a => !a.cid).length ? `<div class="atts">${m.attachments.filter(a => !a.cid).map(a => `<a class="att" href="/api/attachment?folder=${encodeURIComponent(folder)}&uid=${m.uid}&i=${a.i}">${ICON.file}<span>${esc(a.name)}</span><small>${(a.size / 1024).toFixed(0)} KB</small></a>`).join('')}</div>` : ''}
    <div class="body"><iframe id="frame" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer"></iframe></div>
    <div class="quick"><button class="btn small" data-act="reply">${ICON.reply}Antworten</button><button class="btn small" data-act="forward">${ICON.forward}Weiterleiten</button>${/beta/i.test(m.subject) ? '<button class="btn small" data-act="beta">' + ICON.beta + 'In der Beta-Verwaltung öffnen</button>' : ''}</div>`;
  const fr = $('frame');
  fr.srcdoc = frameDoc(m, images);
  fr.onload = () => { try { fr.style.height = (fr.contentDocument.documentElement.scrollHeight + 10) + 'px'; } catch {} };
  const li = $('loadImgs'); if (li) li.onclick = () => drawReader(true);
  $('rBack').onclick = () => $('panes').classList.remove('reading');
  $('moveSel').onchange = async e => { const to = e.target.value; if (!to) return; try { await call('move', { folder, uid: m.uid, to }); toast('Verschoben'); afterRemove(); } catch (er) { toast(er.message, true); } };
  $('tplReply').onchange = e => { const i = e.target.value; e.target.value = ''; if (i === '') return; openCompose('reply', m); applyTemplate(+i); };
}
$('reader').addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b || !cur) return;
  const a = b.dataset.act, m = cur;
  try {
    if (a === 'reply' || a === 'replyAll' || a === 'forward') return openCompose(a, m);
    if (a === 'beta') return show('beta', { folder, uid: m.uid });
    if (a === 'star') { await call('flag', { folder, uid: m.uid, flag: 'flagged', on: !m.flagged }); m.flagged = !m.flagged; const it = items.find(x => x.uid === m.uid); if (it) it.flagged = m.flagged; drawList(); drawReader(false); }
    if (a === 'done') { await call('flag', { folder, uid: m.uid, flag: 'answered', on: true }); m.answered = true; const it = items.find(x => x.uid === m.uid); if (it) it.answered = true; if (counts && counts.open) counts.open--; toast('Als erledigt markiert ✓'); if (filter === 'open') { order = items.map(x => x.uid); items = items.filter(x => x.uid !== m.uid); const nx = nextAfter(m.uid); order = []; drawChips(); drawList(); nx ? openMsg(nx) : (cur = null, clearReader()); } else { drawChips(); drawList(); drawReader(false); } return; }
    if (a === 'unread') { await call('flag', { folder, uid: m.uid, flag: 'seen', on: false }); const it = items.find(x => x.uid === m.uid); if (it) it.seen = false; cur = null; drawList(); clearReader(); loadFolders(); }
    if (a === 'delete') { await call('delete', { folder, uid: m.uid }); toast('Gelöscht'); afterRemove(); }
  } catch (er) { toast(er.message, true); }
});
let order = [];   // uids in list order before the last change, for "open the next mail"
function nextAfter(uid) { const ids = order.length ? order : items.map(x => x.uid), i = ids.indexOf(uid); for (const u of ids.slice(i + 1).concat(ids.slice(0, Math.max(0, i)).reverse())) if (u !== uid && items.some(x => x.uid === u)) return u; return 0; }
function afterRemove() { order = items.map(x => x.uid); const id = cur.uid; items = items.filter(x => x.uid !== id); const nx = window.innerWidth > 900 ? nextAfter(id) : 0; order = []; cur = null; drawList(); if (nx) openMsg(nx); else clearReader(); loadFolders(); loadList(true); }

// ---------------- signature + templates ----------------
const SIG_DEF = `Simon Risse
AERA – Airspace & Enroute Radar Authority

dev-dsue · Simon Bruno Julius Risse
c/o Online-Impressum 12619
Europaring 90, 53757 Sankt Augustin, Deutschland
kontakt@dev-dsue.de · www.dev-dsue.de/aera
Discord: discord.gg/aera`;
const TPL_DEF = [
  { name: '🇩🇪 Beta angenommen', subject: 'Dein Zugang zur AERA Beta ✈️', body: `Hallo [Name],

vielen Dank für deine Anmeldung zur AERA Beta – du bist dabei! 🎉

So bekommst du deinen Zugang:
1. Tritt unserem Discord bei: discord.gg/aera
2. Öffne den Kanal „🧪┃beta-apply“ und klick auf „Bewerben (Deutsch)“.
3. Schreib bei „Warum willst du AERA testen?“ kurz dazu, dass du per E-Mail angenommen wurdest – dann schalten wir dich sofort frei.
4. Danach kannst du die Beta unter www.dev-dsue.de/beta herunterladen (Anmeldung mit Discord).

Wir freuen uns auf dein Feedback!

Viele Grüße
Simon` },
  { name: '🇬🇧 Beta accepted', subject: 'Your access to the AERA Beta ✈️', body: `Hi [Name],

thanks a lot for signing up for the AERA Beta – you're in! 🎉

Here's how to get your access:
1. Join our Discord: discord.gg/aera
2. Open the channel "🧪┃beta-apply" and click "Apply (English)".
3. Under "Why do you want to test AERA?" mention that you were accepted by email – we'll unlock you right away.
4. Then download the beta at www.dev-dsue.de/beta (sign in with Discord).

We're looking forward to your feedback!

Best regards
Simon` },
  { name: '🇩🇪 Beta voll / Warteliste', subject: 'AERA Beta – aktuell ausgebucht', body: `Hallo [Name],

vielen Dank für dein Interesse an der AERA Beta! 🙏

Leider sind aktuell alle Beta-Plätze vergeben. Wir haben dich aber auf die Warteliste gesetzt und melden uns, sobald neue Plätze frei werden.

Bis dahin kannst du gerne schon unserem Discord beitreten, um nichts zu verpassen: discord.gg/aera

Viele Grüße
Simon` },
  { name: '🇬🇧 Beta full / waitlist', subject: 'AERA Beta – currently full', body: `Hi [Name],

thank you for your interest in the AERA Beta! 🙏

Unfortunately, all beta spots are taken at the moment. We've added you to the waitlist and will get back to you as soon as new spots open up.

In the meantime, feel free to join our Discord so you don't miss anything: discord.gg/aera

Best regards
Simon` },
  { name: '🇩🇪 Beta abgelehnt', subject: 'Deine Anmeldung zur AERA Beta', body: `Hallo [Name],

vielen Dank für deine Anmeldung zur AERA Beta.

Leider können wir dir in dieser Testphase keinen Zugang geben. Das hat nichts mit dir persönlich zu tun – die Zahl der Plätze ist stark begrenzt.

Sobald AERA öffentlich erscheint, erfährst du es als Erstes in unserem Discord: discord.gg/aera

Viele Grüße
Simon` },
  { name: '🇬🇧 Beta declined', subject: 'Your AERA Beta application', body: `Hi [Name],

thank you for applying for the AERA Beta.

Unfortunately, we can't give you access during this test phase. This isn't personal – the number of spots is very limited.

As soon as AERA is released publicly, you'll be the first to know in our Discord: discord.gg/aera

Best regards
Simon` },
  { name: '🇩🇪 Feedback / Bug erhalten', subject: 'Danke für dein Feedback zu AERA', body: `Hallo [Name],

danke für deine Nachricht! Wir haben dein Feedback erhalten und schauen es uns genau an. Falls wir Rückfragen haben, melden wir uns bei dir.

Bugs kannst du übrigens auch direkt in unserem Discord melden: discord.gg/aera

Viele Grüße
Simon` },
  { name: '🇬🇧 Feedback / bug received', subject: 'Thanks for your AERA feedback', body: `Hi [Name],

thanks for your message! We've received your feedback and will take a close look at it. If we have any questions, we'll get back to you.

You can also report bugs directly in our Discord: discord.gg/aera

Best regards
Simon` },
  { name: '🇩🇪 Rückfrage: mehr Infos', subject: 'Kurze Rückfrage zu deiner AERA-Beta-Anmeldung', body: `Hallo [Name],

danke für deine Anmeldung zur AERA Beta! 🙌

Damit ich deine Anfrage einordnen kann, bräuchte ich noch ein paar Infos:
• Wie heißt du auf Discord?
• Hast du schon Erfahrung mit ATC (z. B. VATSIM, IVAO oder andere Lotsen-Spiele)?
• Spielst du lieber auf Deutsch oder Englisch?
• Läuft AERA bei dir auf Windows 10 oder 11?

Antworte einfach direkt auf diese Mail.

Viele Grüße
Simon` },
  { name: '🇬🇧 Follow-up: more info', subject: 'Quick question about your AERA Beta application', body: `Hi [Name],

thanks for signing up for the AERA Beta! 🙌

To process your application, I'd need a few more details:
• What's your Discord username?
• Do you have any ATC experience (e.g. VATSIM, IVAO or other controller games)?
• Do you prefer playing in English or German?
• Would you run AERA on Windows 10 or 11?

Just reply directly to this email.

Best regards
Simon` },
  { name: '🇩🇪 Bereits dabei / doppelt', subject: 'Du bist schon in der AERA Beta', body: `Hallo [Name],

gute Nachricht: Du bist bereits für die AERA Beta freigeschaltet – eine zweite Anmeldung brauchst du nicht. 😊

Den aktuellen Beta-Build bekommst du jederzeit unter www.dev-dsue.de/beta (Anmeldung mit Discord). Falls dort etwas nicht klappt, sag mir einfach Bescheid.

Viele Grüße
Simon` },
  { name: '🇬🇧 Already in / duplicate', subject: "You're already in the AERA Beta", body: `Hi [Name],

good news: you already have access to the AERA Beta – no need to sign up again. 😊

You can always get the current beta build at www.dev-dsue.de/beta (sign in with Discord). If anything doesn't work there, just let me know.

Best regards
Simon` },
  { name: '🇩🇪 Erinnerung: Discord fehlt', subject: 'AERA Beta – nur noch ein Schritt', body: `Hallo [Name],

du bist für die AERA Beta freigeschaltet – mir fehlt nur noch dein Discord-Beitritt. 🙂

1. Tritt unserem Discord bei: discord.gg/aera
2. Melde dich im Kanal „🧪┃beta-apply“, dann bekommst du die Beta-Rolle.
3. Danach kannst du die Beta unter www.dev-dsue.de/beta herunterladen.

Ohne die Discord-Rolle klappt der Download leider nicht.

Viele Grüße
Simon` },
  { name: '🇬🇧 Reminder: Discord missing', subject: 'AERA Beta – just one more step', body: `Hi [Name],

you've been accepted to the AERA Beta – I'm just missing you on Discord. 🙂

1. Join our Discord: discord.gg/aera
2. Post in the "🧪┃beta-apply" channel and you'll get the beta role.
3. Then you can download the beta at www.dev-dsue.de/beta.

Unfortunately the download doesn't work without the Discord role.

Best regards
Simon` },
  { name: '🇩🇪 Hilfe: Download / Login', subject: 'Hilfe zum AERA-Beta-Download', body: `Hallo [Name],

danke für deine Nachricht! Wenn der Beta-Download nicht klappt, liegt es meistens an einem dieser Punkte:

1. Melde dich unter www.dev-dsue.de/beta mit genau dem Discord-Konto an, mit dem du auf unserem Server bist.
2. Du brauchst auf dem AERA-Discord die Beta-Rolle. Siehst du dort keine Beta-Kanäle, fehlt sie dir noch – dann schreib mir kurz deinen Discord-Namen.
3. Wenn Windows beim Start warnt („Der Computer wurde durch Windows geschützt“): auf „Weitere Informationen“ und dann „Trotzdem ausführen“ klicken.

Klappt es dann immer noch nicht, schick mir gern einen Screenshot der Fehlermeldung.

Viele Grüße
Simon` },
  { name: '🇬🇧 Help: download / sign-in', subject: 'Help with the AERA Beta download', body: `Hi [Name],

thanks for your message! If the beta download doesn't work, it's usually one of these:

1. Sign in at www.dev-dsue.de/beta with exactly the Discord account you use on our server.
2. You need the beta role on the AERA Discord. If you can't see any beta channels there, you don't have it yet – just send me your Discord username.
3. If Windows warns you on launch ("Windows protected your PC"), click "More info" and then "Run anyway".

If it still doesn't work, feel free to send me a screenshot of the error.

Best regards
Simon` },
  { name: '🇩🇪 Nur Windows (Mac/Linux)', subject: 'AERA Beta – aktuell nur für Windows', body: `Hallo [Name],

danke für dein Interesse an der AERA Beta! 🙏

AERA läuft im Moment leider nur unter Windows 10 und 11. Eine Version für macOS oder Linux gibt es noch nicht. Ich habe mir deinen Wunsch aber notiert.

Wenn du einen Windows-PC hast, melde dich gern nochmal. Neuigkeiten gibt es immer zuerst im Discord: discord.gg/aera

Viele Grüße
Simon` },
  { name: '🇬🇧 Windows only (Mac/Linux)', subject: 'AERA Beta – currently Windows only', body: `Hi [Name],

thanks for your interest in the AERA Beta! 🙏

Right now AERA only runs on Windows 10 and 11 – there's no macOS or Linux version yet. I've noted your request though.

If you have a Windows PC, feel free to get back to me. News always comes first on our Discord: discord.gg/aera

Best regards
Simon` },
  { name: '🇩🇪 Bitte um Feedback', subject: 'Wie läuft AERA bei dir?', body: `Hallo [Name],

du bist jetzt seit ein paar Tagen in der AERA Beta – danke, dass du mittestest! ✈️

Mich würde interessieren:
• Was gefällt dir bisher am besten?
• Was nervt oder ist unklar?
• Sind dir Bugs aufgefallen?

Ein paar Stichpunkte reichen völlig – einfach auf diese Mail antworten oder im Discord posten: discord.gg/aera

Viele Grüße
Simon` },
  { name: '🇬🇧 Feedback request', subject: "How's AERA working for you?", body: `Hi [Name],

you've been in the AERA Beta for a few days now – thanks for testing! ✈️

I'd love to know:
• What do you like most so far?
• What's annoying or unclear?
• Have you noticed any bugs?

A few bullet points are plenty – just reply to this email or post on Discord: discord.gg/aera

Best regards
Simon` },
  { name: '🇩🇪 Team: Eingang bestätigt', subject: 'Deine Bewerbung fürs AERA-Team', body: `Hallo [Name],

vielen Dank für deine Bewerbung als [Rolle] im AERA-Team! 🙌

Ich habe sie gut erhalten und schaue sie mir in den nächsten Tagen in Ruhe an. Danach melde ich mich bei dir – per E-Mail oder auf Discord.

Viele Grüße
Simon` },
  { name: '🇬🇧 Team: application received', subject: 'Your application for the AERA team', body: `Hi [Name],

thanks a lot for applying as [Rolle] on the AERA team! 🙌

I've received your application and will take a proper look at it over the next few days. After that I'll get back to you – by email or on Discord.

Best regards
Simon` },
  { name: '🇩🇪 Team: Einladung Kennenlernen', subject: 'AERA-Team: Lass uns kurz kennenlernen', body: `Hallo [Name],

deine Bewerbung als [Rolle] hat mir richtig gut gefallen – ich würde dich gerne kurz kennenlernen! 😊

Das Gespräch findet ganz locker im Discord statt (Sprach-Chat, ca. 15–20 Minuten). Schick mir einfach zwei, drei Termine, die dir in den nächsten Tagen passen, oder schreib mir direkt auf Discord.

Falls du noch nicht auf dem AERA-Discord bist: discord.gg/aera

Viele Grüße
Simon` },
  { name: '🇬🇧 Team: invitation to meet', subject: "AERA team: let's get to know each other", body: `Hi [Name],

I really liked your application as [Rolle] – I'd love to get to know you a bit! 😊

We'll have a relaxed chat on Discord (voice, about 15–20 minutes). Just send me two or three times that suit you over the next few days, or message me directly on Discord.

If you're not on the AERA Discord yet: discord.gg/aera

Best regards
Simon` },
  { name: '🇩🇪 Team: Zusage + Vereinbarung', subject: 'Willkommen im AERA-Team! ✈️', body: `Hallo [Name],

danke für das nette Gespräch – ich freue mich sehr, dich als [Rolle] im AERA-Team zu begrüßen! 🎉

Bevor es losgeht, noch ein kleiner Schritt: Im Anhang findest du die Mitwirkungsvereinbarung mit Verschwiegenheitserklärung. Darin geht es vor allem um unveröffentlichte Infos zum Spiel. Lies sie dir bitte in Ruhe durch, unterschreib sie und schick sie mir als Antwort auf diese Mail zurück (ein Foto oder Scan reicht).

Sobald sie da ist, bekommst du deine Team-Rolle im Discord und Zugang zu allen internen Kanälen und Versionen.

Willkommen an Bord!
Simon` },
  { name: '🇬🇧 Team: welcome + agreement', subject: 'Welcome to the AERA team! ✈️', body: `Hi [Name],

thanks for the great chat – I'm really happy to welcome you to the AERA team as [Rolle]! 🎉

One small step before we start: attached you'll find the contributor agreement with a confidentiality clause. It's mainly about unreleased information about the game. Please read it carefully, sign it and send it back as a reply to this email (a photo or scan is fine).

As soon as I have it, you'll get your team role on Discord and access to all internal channels and builds.

Welcome aboard!
Simon` },
  { name: '🇩🇪 Team: Rückfrage', subject: 'Kurze Rückfrage zu deiner AERA-Bewerbung', body: `Hallo [Name],

danke für deine Bewerbung als [Rolle]! Bevor ich mich entscheide, hätte ich noch ein paar kurze Fragen:

• Wie viel Zeit kannst du ungefähr pro Woche einbringen?
• Hast du schon Erfahrung in dem Bereich (z. B. Moderation, Discord-Server, Videos, Social Media)?
• Hast du Beispiele, die du mir zeigen kannst (Links zu Videos, Kanälen, Servern)?

Antworte einfach direkt auf diese Mail.

Viele Grüße
Simon` },
  { name: '🇬🇧 Team: follow-up questions', subject: 'Quick questions about your AERA application', body: `Hi [Name],

thanks for applying as [Rolle]! Before I decide, I have a few quick questions:

• Roughly how much time could you put in per week?
• Do you have experience in this area (e.g. moderation, Discord servers, videos, social media)?
• Do you have examples you can show me (links to videos, channels, servers)?

Just reply directly to this email.

Best regards
Simon` },
  { name: '🇩🇪 Team: Lead-Platz vergeben', subject: 'Deine Bewerbung fürs AERA-Team', body: `Hallo [Name],

danke für deine Bewerbung als [Rolle]! 🙏

Den Lead-Platz habe ich inzwischen leider schon vergeben. Deine Bewerbung hat mir aber gut gefallen – hättest du Lust, stattdessen im Team mitzumachen (ohne Lead-Rolle)? Dann melde ich mich für ein kurzes Kennenlernen im Discord.

Viele Grüße
Simon` },
  { name: '🇬🇧 Team: lead spot taken', subject: 'Your application for the AERA team', body: `Hi [Name],

thanks for applying as [Rolle]! 🙏

Unfortunately the lead spot has already been filled. I did like your application though – would you be up for joining the team without the lead role instead? Then I'll get in touch for a quick chat on Discord.

Best regards
Simon` },
  { name: '🇩🇪 Team: Absage', subject: 'Deine Bewerbung fürs AERA-Team', body: `Hallo [Name],

vielen Dank für deine Bewerbung als [Rolle] und dein Interesse an AERA! 🙏

Ich habe mich diesmal für andere Bewerbungen entschieden. Das ist keine Entscheidung gegen dich als Person – es gab einfach nur wenige Plätze.

Ich würde mich freuen, wenn du AERA trotzdem verfolgst und im Discord dabei bleibst: discord.gg/aera. Wenn wieder Plätze frei werden, sage ich dort Bescheid.

Viele Grüße
Simon` },
  { name: '🇬🇧 Team: not this time', subject: 'Your application for the AERA team', body: `Hi [Name],

thank you very much for applying as [Rolle] and for your interest in AERA! 🙏

This time I've decided to go with other applications. It's not a decision against you personally – there were just very few spots.

I'd be glad if you keep following AERA and stay on our Discord: discord.gg/aera. Whenever new spots open up, I'll announce it there.

Best regards
Simon` },
  { name: '🇩🇪 Team: unter 18', subject: 'Deine Bewerbung fürs AERA-Team', body: `Hallo [Name],

vielen Dank für deine Bewerbung und dein Interesse an AERA! 🙏

Für das Team brauche ich leider Mitglieder ab 18 Jahren – auch wegen der Vereinbarung, die alle Teammitglieder unterschreiben. Deshalb kann ich dich im Moment nicht aufnehmen.

Als Spieler bist du aber jederzeit herzlich willkommen, zum Beispiel im Discord: discord.gg/aera

Viele Grüße
Simon` },
  { name: '🇬🇧 Team: under 18', subject: 'Your application for the AERA team', body: `Hi [Name],

thank you very much for applying and for your interest in AERA! 🙏

Unfortunately, team members need to be at least 18 – partly because of the agreement every team member signs. So I can't take you on at the moment.

You're always welcome as a player though, for example on our Discord: discord.gg/aera

Best regards
Simon` },
];
const SIG_SEP = '\n\n-- \n';
let MS = { sig: SIG_DEF, templates: TPL_DEF, known: TPL_DEF.map(t => t.name) };
// default templates that came later are added once to saved settings; deleted ones stay deleted (MS.known remembers them)
function withNewDefaults(v) {
  // settings saved before this list existed already knew the first 8 defaults
  const known = new Set(v.known || v.templates.map(t => t.name).concat(TPL_DEF.slice(0, 8).map(t => t.name))), add = TPL_DEF.filter(t => !known.has(t.name) && !v.templates.some(x => x.name === t.name));
  return { ...v, templates: [...v.templates, ...add.map(t => ({ ...t }))], known: TPL_DEF.map(t => t.name).concat([...known]).filter((n, i, a) => a.indexOf(n) === i), added: add.length };
}
try { const l = JSON.parse(localStorage.getItem('dsue.mail') || 'null'); if (l && l.templates) MS = withNewDefaults(l); } catch {}
async function loadMailSettings() {
  try {
    const r = await call('mail-settings');
    if (r && r.settings && r.settings.templates) {
      MS = withNewDefaults(r.settings);
      try { localStorage.setItem('dsue.mail', JSON.stringify(MS)); } catch {}
      if (MS.added) { const n = MS.added; delete MS.added; try { await call('mail-settings', MS); } catch {} toast(n + ' neue Vorlagen hinzugefügt'); }
    }
  } catch {}
  delete MS.added; fillTpl();
}
function fillTpl() { $('cTpl').innerHTML = '<option value="">📄 Vorlage …</option>' + MS.templates.map((t, i) => `<option value="${i}">${esc(t.name)}</option>`).join(''); }
let toName = '', toRole = '';
const firstName = n => String(n || '').replace(/["']/g, '').trim().split(/[\s,]+/)[0] || '';
const fillName = (txt, name) => txt.replace(/\[Name\]/g, name || '').replace(/^(Hallo|Hi|Hey) ,/m, '$1,');
function applyTemplate(i) {
  const t = MS.templates[i]; if (!t) return;
  const ta = $('cText'), v = ta.value, sigAt = MS.sig ? v.indexOf(SIG_SEP) : -1;
  ta.value = fillName(t.body, toName).replace(/\[(Rolle|Role)\]/g, toRole || 'Teammitglied') + (sigAt >= 0 ? v.slice(sigAt) : v.trim() ? '\n\n' + v : '');
  if (!replyCtx) $('cSubject').value = t.subject;
  dirty = true; ta.focus(); ta.setSelectionRange(0, 0); ta.scrollTop = 0;
}
$('cTpl').addEventListener('change', e => { const i = e.target.value; e.target.value = ''; if (i !== '') applyTemplate(+i); });
// settings modal
let msCur = 0, msDraft = null;
function msLoad() { const t = msDraft.templates[msCur]; $('msName').value = t ? t.name : ''; $('msSubj').value = t ? t.subject : ''; $('msBody').value = t ? t.body : ''; ['msName', 'msSubj', 'msBody'].forEach(id => $(id).disabled = !t); }
function msStore() { const t = msDraft.templates[msCur]; if (t) { t.name = $('msName').value || 'Ohne Namen'; t.subject = $('msSubj').value; t.body = $('msBody').value; } }
function msList() { $('msList').innerHTML = msDraft.templates.map((t, i) => `<option value="${i}"${i === msCur ? ' selected' : ''}>${esc(t.name)}</option>`).join(''); msLoad(); }
$('mailSetBtn').addEventListener('click', () => { msDraft = JSON.parse(JSON.stringify(MS)); msCur = 0; $('msSig').value = msDraft.sig; msList(); $('mailSet').classList.remove('hidden'); });
$('msClose').addEventListener('click', () => $('mailSet').classList.add('hidden'));
$('msList').addEventListener('change', e => { msStore(); msCur = +e.target.value; msList(); });
$('msName').addEventListener('input', () => { msStore(); const o = $('msList').options[msCur]; if (o) o.textContent = $('msName').value; });
$('msAdd').addEventListener('click', () => { msStore(); msDraft.templates.push({ name: 'Neue Vorlage', subject: '', body: 'Hallo [Name],\n\n\n\nViele Grüße\nSimon' }); msCur = msDraft.templates.length - 1; msList(); $('msName').select(); });
$('msDel').addEventListener('click', () => { if (!msDraft.templates[msCur] || !confirm('Vorlage „' + msDraft.templates[msCur].name + '“ löschen?')) return; msDraft.templates.splice(msCur, 1); msCur = 0; msList(); });
$('msReset').addEventListener('click', () => { if (!confirm('Signatur und Vorlagen auf Standard zurücksetzen?')) return; msDraft = { sig: SIG_DEF, templates: JSON.parse(JSON.stringify(TPL_DEF)), known: TPL_DEF.map(t => t.name) }; msCur = 0; $('msSig').value = msDraft.sig; msList(); });
$('msSave').addEventListener('click', async () => {
  msStore(); msDraft.sig = $('msSig').value; MS = msDraft;
  try { localStorage.setItem('dsue.mail', JSON.stringify(MS)); } catch {}
  fillTpl(); $('mailSet').classList.add('hidden');
  try { const r = await call('mail-settings', MS); toast(r.saved === 'github' ? 'Gespeichert ✓ (dauerhaft)' : 'Gespeichert ✓ (in diesem Browser)'); } catch (er) { toast('Lokal gespeichert – Server: ' + er.message, true); }
});

// ---------------- compose ----------------
let replyCtx = null, draftUid = 0, dirty = false, atts = [], autoT = 0;
const quote = m => `\n\n\nAm ${new Date(m.date).toLocaleString('de-DE')} schrieb ${who((m.from || [])[0])}:\n` + (m.text || m.html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')).trim().split('\n').map(l => '> ' + l).join('\n');
function openCompose(kind, m) {
  replyCtx = null; draftUid = 0; dirty = false; atts = []; drawAtts(); $('draftState').textContent = '';
  $('cTo').value = ''; $('cCc').value = ''; $('cSubject').value = ''; $('cText').value = '';
  $('composeTitle').textContent = 'Neue E-Mail';
  let addSig = true;
  if (m && kind === 'draft') {
    $('composeTitle').textContent = 'Entwurf';
    draftUid = m.uid; addSig = false;
    $('cTo').value = (m.to || []).map(a => a.address).filter(a => a && a.toLowerCase() !== ME).join(', ');
    $('cCc').value = (m.cc || []).map(a => a.address).join(', ');
    $('cSubject').value = m.subject || ''; $('cText').value = m.text || '';
    $('draftState').textContent = 'Entwurf · ' + when(m.date);
  } else if (m) {
    const base = (m.subject || '').replace(/^((re|aw|fwd?|wg):\s*)+/i, '');
    if (kind === 'forward') { $('composeTitle').textContent = 'Weiterleiten'; $('cSubject').value = 'Fwd: ' + base; $('cText').value = `\n\n\n---------- Weitergeleitete Nachricht ----------\nVon: ${who((m.from || [])[0])} <${((m.from || [])[0] || {}).address || ''}>\nDatum: ${new Date(m.date).toLocaleString('de-DE')}\nBetreff: ${m.subject}\n\n` + (m.text || quote(m).replace(/^> /gm, '')); }
    else {
      $('composeTitle').textContent = kind === 'replyAll' ? 'Allen antworten' : 'Antworten';
      const rt = (m.replyTo || []).length ? m.replyTo : m.from;
      $('cTo').value = (rt || []).map(a => a.address).join(', ');
      if (kind === 'replyAll') $('cCc').value = [...(m.to || []), ...(m.cc || [])].map(a => a.address).filter(a => a && a.toLowerCase() !== ME).join(', ');
      $('cSubject').value = 'Re: ' + base; $('cText').value = quote(m);
      replyCtx = { inReplyTo: m.messageId, references: (m.references ? m.references + ' ' : '') + m.messageId, replyFolder: folder, replyUid: m.uid };
    }
  }
  toName = m && kind !== 'forward' && kind !== 'draft' ? firstName((((m.replyTo || []).length ? m.replyTo : m.from) || [])[0]?.name) : '';
  // team applications from the website: name and role are in the mail text ("Name: …", "Bereich: …")
  toRole = '';
  if (m && kind !== 'forward' && kind !== 'draft' && m.text) {
    const nm = m.text.match(/^Name:\s*(.+)$/m), rl = m.text.match(/^Bereich:\s*(.+)$/m);
    if (nm && (!toName || /aera|bewerbung|dsue/i.test(toName))) toName = firstName(nm[1]);
    if (rl) toRole = rl[1].trim();
  }
  if (addSig && MS.sig && MS.sig.trim()) { const sig = SIG_SEP + MS.sig.trim(); const v = $('cText').value; $('cText').value = v ? '\n' + sig + v : '\n' + sig; }
  $('cFrom').textContent = ME;
  $('compose').classList.remove('hidden');
  setTimeout(() => { const t = $('cText'); if ($('cTo').value) { t.focus(); t.setSelectionRange(0, 0); t.scrollTop = 0; } else $('cTo').focus(); }, 30);
}
$('composeBtn').addEventListener('click', () => openCompose('new'));
['cTo', 'cCc', 'cSubject', 'cText'].forEach(id => $(id).addEventListener('input', () => { dirty = true; $('draftState').textContent = 'Nicht gespeichert'; clearTimeout(autoT); autoT = setTimeout(() => saveDraft(true), 20000); }));
async function saveDraft(quiet) {
  clearTimeout(autoT);
  if (!dirty) return true;
  try {
    const r = await call('draft', { to: $('cTo').value, cc: $('cCc').value, subject: $('cSubject').value, text: $('cText').value, draftUid });
    draftUid = r.uid || 0; dirty = false;
    $('draftState').textContent = 'Entwurf gespeichert · ' + new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    if (!quiet) toast('Entwurf gespeichert ✓' + (atts.length ? ' (ohne Anhänge)' : ''));
    if (isDrafts() && view === 'mail') loadList(true);
    return true;
  } catch (er) { if (!quiet) toast(er.message, true); else $('draftState').textContent = 'Entwurf nicht gespeichert'; return false; }
}
$('cDraft').addEventListener('click', () => { dirty = true; saveDraft(false); });
const hasOwnText = () => $('cText').value.replace(SIG_SEP + (MS.sig || '').trim(), '').replace(/^\s*>.*$/gm, '').replace(/-{6,}[\s\S]*$/, '').trim() || $('cSubject').value.trim() && !replyCtx;
$('composeClose').addEventListener('click', async () => {
  if (dirty && hasOwnText()) { if (await saveDraft(true)) toast('Als Entwurf gespeichert'); }
  clearTimeout(autoT); $('compose').classList.add('hidden');
});
// attachments
function drawAtts() { $('cAtts').innerHTML = atts.map((a, i) => `<span class="catt">${ICON.clip}${esc(a.name)} <small class="muted">${Math.max(1, Math.round(a.size / 1024))} KB</small><button type="button" data-rm="${i}" title="Entfernen">×</button></span>`).join(''); }
$('cAtts').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { atts.splice(+b.dataset.rm, 1); drawAtts(); } });
$('cFile').addEventListener('change', async e => {
  for (const f of e.target.files) {
    const total = atts.reduce((n, a) => n + a.size, 0) + f.size;
    if (total > 15e6) { toast('Anhänge zusammen max. 15 MB', true); break; }
    const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(f); });
    atts.push({ name: f.name, type: f.type, size: f.size, data });
  }
  e.target.value = ''; drawAtts();
});
$('composeForm').addEventListener('submit', async e => {
  e.preventDefault(); const btn = $('cSend'); btn.disabled = true; btn.lastChild.textContent = 'Sendet …';
  try {
    await call('send', { to: $('cTo').value, cc: $('cCc').value, subject: $('cSubject').value, text: $('cText').value, html: $('cHtml').checked, fromName: 'dev-dsue', draftUid, attachments: atts.map(a => ({ name: a.name, type: a.type, data: a.data })), ...(replyCtx || {}) });
    clearTimeout(autoT); dirty = false;
    if (replyCtx && replyCtx.replyUid && replyCtx.replyFolder === folder) { const now = new Date(); const it = items.find(x => x.uid === replyCtx.replyUid); if (it) { it.answered = true; it.answeredAt = now; } if (cur && cur.uid === replyCtx.replyUid) { cur.answered = true; cur.answeredAt = now; if (view === 'mail') drawReader(false); } }
    $('compose').classList.add('hidden'); toast('Gesendet ✓'); if (view === 'mail') { loadFolders(); loadList(true); }
  } catch (er) { toast(er.message, true); }
  btn.disabled = false; btn.lastChild.textContent = 'Senden';
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (!$('mailSet').classList.contains('hidden')) return $('msClose').click(); if (!$('compose').classList.contains('hidden')) return $('composeClose').click(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !$('compose').classList.contains('hidden')) { e.preventDefault(); $('composeForm').requestSubmit(); }
  const typing = /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '');
  if (typing || !$('compose').classList.contains('hidden') || $('app').classList.contains('hidden')) return;
  if (e.key === 'c') { e.preventDefault(); openCompose('new'); }
  if (e.key === '/' ) { e.preventDefault(); show('mail', { keep: view === 'mail' }); $('q').focus(); }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '?') { e.preventDefault(); $('keys').classList.toggle('hidden'); return; }
  if (e.key === 'Escape' && !$('keys').classList.contains('hidden')) { $('keys').classList.add('hidden'); return; }
  if (view !== 'mail') return;
  const act = a => { const b = document.querySelector(`#reader [data-act="${a}"]`); if (b && !b.disabled) b.click(); };
  const step = d => { if (!items.length) return; const i = cur ? items.findIndex(x => x.uid === cur.uid) : -1, n = items[Math.min(items.length - 1, Math.max(0, i + d))]; if (n && (!cur || n.uid !== cur.uid)) { openMsg(n.uid); setTimeout(() => { const el = document.querySelector(`.item[data-uid="${n.uid}"]`); if (el) el.scrollIntoView({ block: 'nearest' }); }, 60); } };
  const k = e.key;
  if (k === 'j' || k === 'ArrowDown') { e.preventDefault(); step(1); }
  else if (k === 'k' || k === 'ArrowUp') { e.preventDefault(); step(-1); }
  else if (k === 'n') { e.preventDefault(); const i = cur ? items.findIndex(x => x.uid === cur.uid) : -1, n = items.slice(i + 1).find(needsReply) || items.find(needsReply); if (n) openMsg(n.uid); else toast('Keine offenen E-Mails mehr 🎉'); }
  else if (/^[1-5]$/.test(k) && !own) { e.preventDefault(); filter = ['all', 'open', 'unread', 'answered', 'flagged'][+k - 1]; page = 1; picked.clear(); loadList(); }
  else if (!cur) return;
  else if (k === 'r') { e.preventDefault(); openCompose('reply', cur); }
  else if (k === 'a') { e.preventDefault(); openCompose('replyAll', cur); }
  else if (k === 'f') { e.preventDefault(); openCompose('forward', cur); }
  else if (k === 'e') { e.preventDefault(); act('done'); }
  else if (k === 's') { e.preventDefault(); act('star'); }
  else if (k === 'u') { e.preventDefault(); act('unread'); }
  else if (k === '#' || k === 'Delete') { e.preventDefault(); act('delete'); }
});
$('keysBtn').addEventListener('click', () => $('keys').classList.remove('hidden'));
$('keys').addEventListener('click', e => { if (e.target === $('keys') || e.target.closest('[data-close]')) $('keys').classList.add('hidden'); });

// ---------------- start ----------------
async function pollUnread() { try { const f = await call('folders'); const i = f.find(x => x.special === '\\Inbox' || x.path === 'INBOX') || {}; setBadge('navUnread', i.unseen || 0); if (view === 'mail') { folders = f; loadFolders().catch(() => {}); loadList(true); } } catch {} }
function startApp() {
  if (/[?&]next=studio\b/.test(location.search)) { location.href = '/admin/studio'; return; }
  $('login').classList.add('hidden'); $('app').classList.remove('hidden');
  $('meMail').textContent = ME; $('meAv').textContent = (ME || 'D').charAt(0).toUpperCase();
  loadMailSettings();
  show(location.hash.slice(1) || 'dash');
  pollUnread();
  clearInterval(timer); timer = setInterval(() => { if (document.visibilityState === 'visible') pollUnread(); }, 60000);
}
window.ADM = { call, toast, esc, when, who, initial, ICON, show, openMail, openCompose, applyTemplate, setBadge, firstName, fillName, get MS() { return MS; }, SIG_SEP, get ME() { return ME; } };
(async () => {
  $('lUser').value = 'kontakt@dev-dsue.de';
  try { const r = await call('me'); if (r.user) { ME = r.user; startApp(); } else showLogin(); } catch { showLogin(); }
})();
