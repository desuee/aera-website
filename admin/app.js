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
  file: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
};
const NAMES = { '\\Inbox': 'Posteingang', '\\Sent': 'Gesendet', '\\Drafts': 'Entwürfe', '\\Junk': 'Spam', '\\Trash': 'Papierkorb', '\\Archive': 'Archiv' };
const ICONS = { '\\Inbox': 'inbox', '\\Sent': 'sent', '\\Drafts': 'drafts', '\\Junk': 'junk', '\\Trash': 'trash', '\\Archive': 'archive' };
const ORDER = ['\\Inbox', '\\Drafts', '\\Sent', '\\Archive', '\\Junk', '\\Trash'];

let ME = '', folders = [], folder = 'INBOX', page = 1, q = '', items = [], cur = null, timer = 0;
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
    const r = await call(`list?folder=${encodeURIComponent(folder)}&page=${page}&q=${encodeURIComponent(q)}`);
    items = r.items; for (const u of [...picked]) if (!items.some(m => m.uid === u)) picked.delete(u);
    drawList();
    const pages = Math.max(1, Math.ceil(r.total / r.per));
    $('pager').innerHTML = pages > 1 ? `<button class="icon-btn" data-pg="-1" ${page <= 1 ? 'disabled' : ''}>‹</button><span>Seite ${page} von ${pages} · ${r.total} E-Mails</span><button class="icon-btn" data-pg="1" ${page >= pages ? 'disabled' : ''}>›</button>` : '';
  } catch (e) { if (!quiet) toast(e.message, true); }
}
function drawList() {
  const sentLike = /\\Sent|\\Drafts/.test((folders.find(f => f.path === folder) || {}).special || '');
  $('items').innerHTML = items.length ? items.map(m => `<div class="item${m.seen ? '' : ' unread'}${cur && cur.uid === m.uid ? ' on' : ''}${picked.has(m.uid) ? ' picked' : ''}" data-uid="${m.uid}" role="button" tabindex="0">
    <label class="chk" data-pick="${m.uid}"><input type="checkbox"${picked.has(m.uid) ? ' checked' : ''}><span></span></label>
    <div class="c"><div class="r1"><span class="who">${esc(sentLike ? 'An: ' + (m.to || []).map(who).join(', ') : who(m.from))}</span><time>${esc(when(m.date))}</time></div>
    <div class="subj">${/beta/i.test(m.subject) && !sentLike ? '<span class="tag">Beta</span>' : ''}<span>${esc(m.subject || '(kein Betreff)')}</span>${m.att ? ICON.clip : ''}${m.flagged ? `<span class="star" style="flex:none">${ICON.star}</span>` : ''}</div></div></div>`).join('')
    : `<div class="noitems">${q ? 'Nichts gefunden.' : 'Keine E-Mails in diesem Ordner.'}</div>`;
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
$('selAll').addEventListener('change', e => { picked.clear(); if (e.target.checked) items.forEach(m => picked.add(m.uid)); drawList(); });
async function bulk(action, to) {
  const uids = [...picked]; if (!uids.length) return;
  if (action === 'delete' && !confirm(uids.length + ' E-Mail(s) löschen?')) return;
  try {
    await call('bulk', { folder, uids, action, to });
    toast({ seen: 'Als gelesen markiert', unseen: 'Als ungelesen markiert', flag: 'Markiert', move: 'Verschoben', delete: 'Gelöscht' }[action] + ' ✓');
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
    const it = items.find(x => x.uid === uid); if (it && !it.seen) { it.seen = true; const f = folders.find(x => x.path === folder); if (f && f.unseen) f.unseen--; drawFolders(); }
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
    if (a === 'unread') { await call('flag', { folder, uid: m.uid, flag: 'seen', on: false }); const it = items.find(x => x.uid === m.uid); if (it) it.seen = false; cur = null; drawList(); clearReader(); loadFolders(); }
    if (a === 'delete') { await call('delete', { folder, uid: m.uid }); toast('Gelöscht'); afterRemove(); }
  } catch (er) { toast(er.message, true); }
});
function afterRemove() { items = items.filter(x => x.uid !== cur.uid); cur = null; drawList(); clearReader(); loadFolders(); }

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
];
const SIG_SEP = '\n\n-- \n';
let MS = { sig: SIG_DEF, templates: TPL_DEF };
try { const l = JSON.parse(localStorage.getItem('dsue.mail') || 'null'); if (l && l.templates) MS = l; } catch {}
async function loadMailSettings() {
  try { const r = await call('mail-settings'); if (r && r.settings && r.settings.templates) { MS = r.settings; try { localStorage.setItem('dsue.mail', JSON.stringify(MS)); } catch {} } } catch {}
  fillTpl();
}
function fillTpl() { $('cTpl').innerHTML = '<option value="">📄 Vorlage …</option>' + MS.templates.map((t, i) => `<option value="${i}">${esc(t.name)}</option>`).join(''); }
let toName = '';
const firstName = n => String(n || '').replace(/["']/g, '').trim().split(/[\s,]+/)[0] || '';
const fillName = (txt, name) => txt.replace(/\[Name\]/g, name || '').replace(/^(Hallo|Hi|Hey) ,/m, '$1,');
function applyTemplate(i) {
  const t = MS.templates[i]; if (!t) return;
  const ta = $('cText'), v = ta.value, sigAt = MS.sig ? v.indexOf(SIG_SEP) : -1;
  ta.value = fillName(t.body, toName) + (sigAt >= 0 ? v.slice(sigAt) : v.trim() ? '\n\n' + v : '');
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
$('msReset').addEventListener('click', () => { if (!confirm('Signatur und Vorlagen auf Standard zurücksetzen?')) return; msDraft = { sig: SIG_DEF, templates: JSON.parse(JSON.stringify(TPL_DEF)) }; msCur = 0; $('msSig').value = msDraft.sig; msList(); });
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
  if (e.key === 'r' && view === 'mail' && cur) { e.preventDefault(); openCompose('reply', cur); }
});

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
