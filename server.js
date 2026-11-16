// dev-dsue.de – website + webmail (/admin) + studio for changelogs and downloads (/admin/studio, see studio.js) – by Desue
// The website files are served as they are (same files GitHub Pages used). /admin is a small webmail for kontakt@dev-dsue.de.
// Signs in with the mailbox's own address + password (checked by the mail server over IMAP).
// The password is never written anywhere: it lives only in this process's memory, encrypted, for the session.
//
// Environment:
//   PORT            port to listen on (Railway sets it)
//   ALLOWED_USERS   comma separated mail addresses that may sign in (required), e.g. kontakt@dev-dsue.de
//   IMAP_HOST       default dmail01.bero-host.de      IMAP_PORT  default 993 (TLS)
//   SMTP_HOST       default = IMAP_HOST               SMTP_PORT  default 465 (TLS)
//   SESSION_MINUTES idle timeout, default 60
//   MOCK=1          demo mailbox without a mail server (for testing the page)
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const PORT = +process.env.PORT || 8080;
const ALLOWED = (process.env.ALLOWED_USERS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const IMAP_HOST = process.env.IMAP_HOST || 'dmail01.bero-host.de';
const IMAP_PORT = +process.env.IMAP_PORT || 993;
const SMTP_HOST = process.env.SMTP_HOST || IMAP_HOST;
const SMTP_PORT = +process.env.SMTP_PORT || 465;
// Railway (Hobby plan) blocks outgoing SMTP. With RESEND_API_KEY set, mail is sent over HTTPS via resend.com instead.
const RESEND_KEY = process.env.RESEND_API_KEY || '';
const IDLE_MS = (+process.env.SESSION_MINUTES || 60) * 60000;
const MOCK = process.env.MOCK === '1';
const ROOT = __dirname, ADMIN = path.join(__dirname, 'admin');

if (!ALLOWED.length && !MOCK) console.warn('ALLOWED_USERS is not set – nobody can sign in.');

// ---------------- sessions (memory only) ----------------
const KEY = crypto.randomBytes(32);   // new on every start: a restart signs everybody out
const seal = s => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', KEY, iv); const e = Buffer.concat([c.update(s, 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), e]); };
const open = b => { const d = crypto.createDecipheriv('aes-256-gcm', KEY, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'); };
const sessions = new Map();   // token -> { user, pass(sealed), last, client }
setInterval(() => { const now = Date.now(); for (const [t, s] of sessions) if (now - s.last > IDLE_MS) endSession(t); }, 60000).unref();
function endSession(t) { const s = sessions.get(t); if (!s) return; sessions.delete(t); try { s.client && s.client.logout().catch(() => {}); } catch {} }

// sign-in protection: 5 wrong tries per address per 15 minutes, 20 overall per hour
const fails = new Map(); let globalFails = [];
const teamHits = new Map();
function blocked(ip) {
  const now = Date.now(); globalFails = globalFails.filter(t => now - t < 3600000);
  const f = (fails.get(ip) || []).filter(t => now - t < 900000); fails.set(ip, f);
  return f.length >= 5 || globalFails.length >= 20;
}
function failed(ip) { const f = fails.get(ip) || []; f.push(Date.now()); fails.set(ip, f); globalFails.push(Date.now()); }

// ---------------- mail backend ----------------
const { ImapFlow } = MOCK ? {} : require('imapflow');
const { simpleParser } = require('mailparser');
const nodemailer = MOCK ? null : require('nodemailer');

async function imapFor(s) {
  if (MOCK) return null;
  if (s.client && s.client.usable) return s.client;
  const c = new ImapFlow({ host: IMAP_HOST, port: IMAP_PORT, secure: IMAP_PORT === 993, auth: { user: s.user, pass: open(s.pass) }, logger: false, emitLogs: false });
  c.on('error', () => {});
  await c.connect();
  s.client = c;
  return c;
}
async function withBox(s, folder, fn) {
  const c = await imapFor(s);
  const lock = await c.getMailboxLock(folder);
  try { return await fn(c); } finally { lock.release(); }
}

const mock = MOCK ? require('./mock') : null;
const studio = require('./studio');
const aeraSync = require('./aera-sync').start(studio);   // AERA changelog from the GitHub releases of the beta repo
const mailx = require('./mailx');   // HTML mails + beta inbox helpers
const beta = require('./beta');      // /beta: Discord sign-in + private beta downloads (see beta.js)   // /admin/studio: changelogs + program downloads (writes to GitHub)

const api = {
  async folders(s) {
    if (MOCK) return mock.folders();
    const c = await imapFor(s);
    const list = await c.list({ statusQuery: { unseen: true, messages: true } });
    return list.filter(f => !f.flags || !f.flags.has('\\Noselect')).map(f => ({ path: f.path, name: f.name, special: f.specialUse || '', unseen: f.status ? f.status.unseen : 0, total: f.status ? f.status.messages : 0 }));
  },
  async list(s, folder, page, q) {
    if (MOCK) return mock.list(folder, page, q);
    return withBox(s, folder, async c => {
      const per = 50;
      let uids = await c.search(q ? { or: [{ subject: q }, { from: q }, { to: q }, { body: q }] } : { all: true }, { uid: true });
      uids = (uids || []).sort((a, b) => b - a);
      const total = uids.length, pick = uids.slice((page - 1) * per, page * per);
      const out = [];
      if (pick.length) for await (const m of c.fetch(pick.join(','), { uid: true, envelope: true, flags: true, size: true, bodyStructure: true }, { uid: true })) {
        const e = m.envelope || {};
        out.push({ uid: m.uid, subject: e.subject || '', from: (e.from || [])[0] || {}, to: e.to || [], date: e.date, seen: m.flags.has('\\Seen'), flagged: m.flags.has('\\Flagged'), answered: m.flags.has('\\Answered'), size: m.size, att: hasAtt(m.bodyStructure) });
      }
      out.sort((a, b) => b.uid - a.uid);
      return { total, page, per, items: out };
    });
  },
  async message(s, folder, uid) {
    if (MOCK) return mock.message(folder, uid);
    return withBox(s, folder, async c => {
      const m = await c.fetchOne(String(uid), { source: true, flags: true }, { uid: true });
      if (!m) throw new Error('Message not found');
      const p = await simpleParser(m.source);
      c.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true }).catch(() => {});
      return shape(p, uid, m.flags);
    });
  },
  async attachment(s, folder, uid, idx) {
    if (MOCK) return mock.attachment(folder, uid, idx);
    return withBox(s, folder, async c => {
      const m = await c.fetchOne(String(uid), { source: true }, { uid: true });
      const p = await simpleParser(m.source);
      const a = (p.attachments || [])[idx]; if (!a) throw new Error('Attachment not found');
      return { name: a.filename || 'attachment', type: a.contentType || 'application/octet-stream', data: a.content };
    });
  },
  async flag(s, folder, uid, flag, on) {
    if (MOCK) return mock.flag(folder, uid, flag, on);
    return withBox(s, folder, c => on ? c.messageFlagsAdd(String(uid), [flag], { uid: true }) : c.messageFlagsRemove(String(uid), [flag], { uid: true }));
  },
  async move(s, folder, uid, to) {
    if (MOCK) return mock.move(folder, uid, to);
    return withBox(s, folder, c => c.messageMove(String(uid), to, { uid: true }));
  },
  async remove(s, folder, uid) {
    if (MOCK) return mock.remove(folder, uid);
    const fl = await api.folders(s), trash = (fl.find(f => f.special === '\\Trash') || {}).path;
    if (trash && trash !== folder) return api.move(s, folder, uid, trash);
    return withBox(s, folder, c => c.messageDelete(String(uid), { uid: true }));   // already in the bin: delete for good
  },
  async specialFolder(s, kind, re) {
    const fl = await api.folders(s);
    return (fl.find(f => f.special === kind) || fl.find(f => re.test(f.name)) || {}).path;
  },
  async dropDraft(s, uid) {
    const d = await api.specialFolder(s, '\\Drafts', /^(drafts|entw)/i); if (!d || !uid) return;
    if (MOCK) return mock.remove(d, uid, true);
    return withBox(s, d, c => c.messageDelete(String(uid), { uid: true }));
  },
  async saveDraft(s, msg) {
    if (MOCK) return mock.saveDraft(msg);
    const d = await api.specialFolder(s, '\\Drafts', /^(drafts|entw)/i); if (!d) throw new Error('Kein Entwürfe-Ordner gefunden');
    const raw = await new Promise((res, rej) => nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail({ from: s.user, to: msg.to || undefined, cc: msg.cc || undefined, subject: msg.subject, text: msg.text, date: new Date() }, (e, r) => e ? rej(e) : res(r.message)));
    const c = await imapFor(s);
    const r = await c.append(d, raw, ['\\Draft', '\\Seen']);
    if (msg.draftUid) await api.dropDraft(s, msg.draftUid).catch(() => {});
    return { uid: (r && r.uid) || 0, folder: d };
  },
  async ensureFolder(s, name) {
    if (MOCK) return mock.ensure(name);
    const fl = await api.folders(s); if (fl.some(f => f.path === name)) return name;
    const c = await imapFor(s); await c.mailboxCreate(name); return name;
  },
  async bulk(s, folder, uids, action, to) {
    uids = uids.filter(n => Number.isInteger(n) && n > 0).slice(0, 500); if (!uids.length) return;
    if (!/^(seen|unseen|flag|unflag|move|delete)$/.test(action)) throw new Error('Unbekannte Aktion');
    if (MOCK) { for (const u of uids) { if (action === 'delete') mock.remove(folder, u); else if (action === 'move') mock.move(folder, u, to); else mock.flag(folder, u, /seen/.test(action) ? '\\Seen' : '\\Flagged', !/^un/.test(action)); } return; }
    if (action === 'delete') {
      const trash = await api.specialFolder(s, '\\Trash', /^(trash|papierkorb|deleted)/i);
      if (trash && trash !== folder) { action = 'move'; to = trash; }
      else return withBox(s, folder, c => c.messageDelete(uids.join(','), { uid: true }));
    }
    return withBox(s, folder, c => {
      const set = uids.join(',');
      if (action === 'move') return c.messageMove(set, to, { uid: true });
      const fl = /seen/.test(action) ? '\\Seen' : '\\Flagged';
      return /^un/.test(action) ? c.messageFlagsRemove(set, [fl], { uid: true }) : c.messageFlagsAdd(set, [fl], { uid: true });
    });
  },
  // beta requests: mails with "beta" in the subject in the inbox (= open) + everything in the three status folders
  async betaList(s) {
    if (MOCK) return mock.betaList(mailx.BETA);
    const fl = await api.folders(s), have = new Set(fl.map(f => f.path)), out = [];
    const grab = async (folder, status, crit) => {
      if (!have.has(folder)) return;
      await withBox(s, folder, async c => {
        let uids = await c.search(crit, { uid: true }); uids = (uids || []).sort((a, b) => b - a).slice(0, 200);
        if (uids.length) for await (const m of c.fetch(uids.join(','), { uid: true, envelope: true, flags: true }, { uid: true })) {
          const e = m.envelope || {}, f = (e.from || [])[0] || {};
          if ((f.address || '').toLowerCase() === s.user.toLowerCase()) continue;
          out.push({ folder, uid: m.uid, status, subject: e.subject || '', from: f, date: e.date, seen: m.flags.has('\\Seen'), answered: m.flags.has('\\Answered') });
        }
      });
    };
    const inbox = (fl.find(f => f.special === '\\Inbox') || {}).path || 'INBOX';
    await grab(inbox, 'open', { subject: 'beta' });
    for (const [k, name] of Object.entries(mailx.BETA)) await grab(name, k, { all: true });
    return out.sort((a, b) => new Date(b.date) - new Date(a.date));
  },
  async send(s, msg) {
    if (MOCK) { if (msg.draftUid) mock.remove('Drafts', msg.draftUid, true); return mock.send(msg); }
    const from = msg.fromName ? { name: msg.fromName, address: s.user } : s.user;
    const html = msg.html ? mailx.toHtml(msg.text) : undefined;
    const atts = (msg.attachments || []).map(a => ({ filename: a.name, contentType: a.type || 'application/octet-stream', content: Buffer.from(String(a.data || ''), 'base64') }));
    const mail = { from, to: msg.to, cc: msg.cc || undefined, subject: msg.subject, text: msg.text, html, attachments: atts.length ? atts : undefined, inReplyTo: msg.inReplyTo || undefined, references: msg.references || undefined };
    let info;
    if (RESEND_KEY) {
      const list = v => String(v || '').split(/[,;]/).map(x => x.trim()).filter(Boolean);
      const headers = {}; if (msg.inReplyTo) headers['In-Reply-To'] = msg.inReplyTo; if (msg.references) headers.References = msg.references;
      const r = await fetch('https://api.resend.com/emails', { method: 'POST', signal: AbortSignal.timeout(20000),
        headers: { Authorization: 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: msg.fromName ? `${msg.fromName} <${s.user}>` : s.user, to: list(msg.to), cc: list(msg.cc).length ? list(msg.cc) : undefined, subject: msg.subject || '(kein Betreff)', text: msg.text, html, reply_to: s.user, headers, attachments: atts.length ? atts.map(a => ({ filename: a.filename, content: a.content.toString('base64') })) : undefined }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error('Versand fehlgeschlagen (Resend): ' + (j.message || r.status));
      info = { messageId: `<${j.id || crypto.randomBytes(8).toString('hex')}@dev-dsue.de>` };
    } else {
      const pass = open(s.pass);
      const t = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465, auth: { user: s.user, pass }, connectionTimeout: 12000, greetingTimeout: 10000, socketTimeout: 20000 });
      try { info = await t.sendMail(mail); }
      catch (e) {
        if (/ETIMEDOUT|ECONNREFUSED|timeout|ECONNRESET/i.test(String(e.code || e.message))) throw new Error('Der Server erreicht den Mail-Server nicht (Railway blockiert SMTP im Hobby-Plan). Lösung: RESEND_API_KEY auf Railway setzen – siehe RAILWAY.md.');
        throw e;
      }
    }
    // keep a copy in "Sent"
    try {
      const raw = await new Promise((res, rej) => nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail({ ...mail, messageId: info.messageId, date: new Date() }, (e, r) => e ? rej(e) : res(r.message)));
      const fl = await api.folders(s), sent = (fl.find(f => f.special === '\\Sent') || fl.find(f => /^(sent|gesendet)/i.test(f.name)) || {}).path;
      if (sent) { const c = await imapFor(s); await c.append(sent, raw, ['\\Seen']); }
    } catch {}
    if (msg.replyFolder && msg.replyUid) api.flag(s, msg.replyFolder, msg.replyUid, '\\Answered', true).catch(() => {});
    if (msg.draftUid) api.dropDraft(s, msg.draftUid).catch(() => {});
    return { ok: true };
  },
};
function hasAtt(bs) { if (!bs) return false; if (bs.disposition === 'attachment') return true; return (bs.childNodes || []).some(hasAtt); }
function addr(a) { return a && a.value ? a.value.map(v => ({ name: v.name || '', address: v.address || '' })) : []; }
function shape(p, uid, flags) {
  return {
    uid, subject: p.subject || '', date: p.date, from: addr(p.from), to: addr(p.to), cc: addr(p.cc), replyTo: addr(p.replyTo),
    messageId: p.messageId || '', references: [].concat(p.references || []).join(' '),
    html: p.html || '', text: p.text || '', flagged: flags ? flags.has('\\Flagged') : false,
    attachments: (p.attachments || []).map((a, i) => ({ i, name: a.filename || 'attachment', size: a.size, type: a.contentType, cid: a.contentDisposition === 'inline' && a.cid ? a.cid : '' })),
    inline: Object.fromEntries((p.attachments || []).filter(a => a.cid && /^image\//.test(a.contentType) && a.size < 3e6).map(a => [a.cid, `data:${a.contentType};base64,${a.content.toString('base64')}`])),
  };
}

// ---------------- http ----------------
// /admin: e-mails are shown in a sandboxed iframe (no scripts); it inherits this policy, so inline styles and https images
// are allowed here – the iframe adds its own stricter rule that blocks remote images until "Load images" is clicked
const CSP = "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'";
function send(res, code, body, type = 'application/json', extra = {}) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow', 'Content-Security-Policy': CSP, 'Strict-Transport-Security': 'max-age=15552000', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
const readJson = req => new Promise((resolve, reject) => {
  let size = 0; const chunks = [];
  req.on('data', c => { size += c.length; if (size > 30e6) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(new Error('bad json')); } });
  req.on('error', reject);
});
const cookie = (req, n) => { const m = (req.headers.cookie || '').match(new RegExp('(?:^|; )' + n + '=([^;]+)')); return m ? m[1] : ''; };
const ipOf = req => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',').pop().trim();
const secure = req => req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
const TYPES = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'application/javascript; charset=utf-8', png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', svg: 'image/svg+xml', ico: 'image/x-icon', txt: 'text/plain; charset=utf-8' };
// public website: only these files / the img folder (never server code or package files)
const SITE = new Set(['index.html', 'impressum.html', 'datenschutz.html', 'style.css', 'app.js', 'theme.js', 'robots.txt', 'aera.html', 'aera.css', 'aera.js', 'aera-changelog.html', 'aera-lizenz.html', 'aera-about.html', 'aera-team.html', 'beta-page.js', 'consent.js']);
const SITE_CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'";
function serveFile(res, file, cache, csp) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, notFound(), TYPES.html);
  const ext = path.extname(file).slice(1).toLowerCase();
  send(res, 200, fs.readFileSync(file), TYPES[ext] || 'application/octet-stream', { 'Cache-Control': cache, 'Content-Security-Policy': csp, 'X-Robots-Tag': csp === SITE_CSP ? 'all' : 'noindex, nofollow' });
}
const notFound = () => '<!doctype html><meta charset="utf-8"><title>404</title><link rel="stylesheet" href="/style.css"><main class="legal"><h1>404</h1><p>Diese Seite gibt es nicht. <a href="/">Zur Startseite</a></p></main>';
const errText = e => {
  const m = String(e && (e.responseText || e.message) || e);
  if (/auth|login|credentials|password/i.test(m)) return 'Anmeldung beim Mailserver fehlgeschlagen';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout/i.test(m)) return 'Mailserver nicht erreichbar';
  return m.slice(0, 200);
};

// ---------------- AERA Discord: member count for the AERA page ----------------
// The link on the page is DISCORD_URL. Its invite code is looked up from that link (dsc.gg forwards to discord.com/invite/…),
// then Discord's public invite API gives the member and online count. Cached for 5 minutes; no token needed.
const DISCORD_URL = process.env.AERA_DISCORD_URL || 'https://discord.gg/aera';
let dcCache = { t: 0, data: { url: DISCORD_URL } }, dcCode = process.env.AERA_DISCORD_INVITE || 'aera';
async function discordStats() {
  if (Date.now() - dcCache.t < 300000) return dcCache.data;
  dcCache.t = Date.now();
  try {
    try {
      const r = await fetch(DISCORD_URL, { redirect: 'manual', signal: AbortSignal.timeout(4000) });
      const m = (r.headers.get('location') || '').match(/discord(?:app)?\.(?:com\/invite|gg)\/([\w-]+)/i);
      if (m) dcCode = m[1];
    } catch {}
    const r = await fetch(`https://discord.com/api/v10/invites/${dcCode}?with_counts=true`, { signal: AbortSignal.timeout(4000) });
    if (r.ok) {
      const j = await r.json();
      dcCache.data = { url: DISCORD_URL, name: j.guild && j.guild.name, members: j.approximate_member_count, online: j.approximate_presence_count };
    }
  } catch {}
  return dcCache.data;
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  try {
    if (p === '/healthz') return send(res, 200, 'ok', 'text/plain');
    if (p === '/hooks/aera-release' && req.method === 'POST') return aeraSync.hook(req, res, send);
    // beta area: own CSP so Discord avatars can load
    if (req.method === 'GET' && (p === '/beta' || p.startsWith('/beta/') || p.startsWith('/api/beta/'))) {
      const BETA_CSP = SITE_CSP.replace("img-src 'self' data:", "img-src 'self' data: https://cdn.discordapp.com");
      if (await beta.handle(req, res, u, p, send, (r, f) => serveFile(r, f, 'no-cache', BETA_CSP), path.join(ROOT, 'beta.html'))) return;
    }
    // dev-dsue.de is the main address (www.dev-dsue.de is forwarded there by the DNS provider)
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (p === '/admin') { res.writeHead(301, { Location: '/admin/' }); return res.end(); }
      if (p === '/admin/' || /^\/admin\/(app\.js|views\.js|style\.css|studio\.js|studio\.css|downloads\.js)$/.test(p)) return serveFile(res, path.join(ADMIN, p === '/admin/' ? 'index.html' : p.slice(7)), 'no-cache', CSP);
      if (p === '/admin/studio' || p === '/admin/studio/') return serveFile(res, path.join(ADMIN, 'studio.html'), 'no-cache', CSP);
      if (p === '/admin/downloads' || p === '/admin/downloads/') return serveFile(res, path.join(ADMIN, 'downloads.html'), 'no-cache', CSP);
      // data for the public pages, kept in memory so changes from the studio show at once
      if (p === '/api/aera-changelog/status') return send(res, 200, aeraSync.state);
      if (p === '/aera-changelog-data.js') return send(res, 200, studio.js.aera(), TYPES.js, { 'Cache-Control': 'no-cache', 'Content-Security-Policy': SITE_CSP, 'X-Robots-Tag': 'all' });
      if (p === '/site-data.js') return send(res, 200, studio.js.site(), TYPES.js, { 'Cache-Control': 'no-cache', 'Content-Security-Policy': SITE_CSP, 'X-Robots-Tag': 'all' });
      if (p === '/') return serveFile(res, path.join(ROOT, 'index.html'), 'no-cache', SITE_CSP);
      if (p === '/aera/') { res.writeHead(301, { Location: '/aera' }); return res.end(); }
      if (p === '/aera') return serveFile(res, path.join(ROOT, 'aera.html'), 'no-cache', SITE_CSP);
      if (p === '/aera/lizenz' || p === '/aera/license' || p === '/aera/licence') return serveFile(res, path.join(ROOT, 'aera-lizenz.html'), 'no-cache', SITE_CSP);
      if (p === '/aera/about' || p === '/aera/ueber' || p === '/aera/über' || p === '/aera/%C3%BCber') return serveFile(res, path.join(ROOT, 'aera-about.html'), 'no-cache', SITE_CSP);
      if (p === '/aera/team' || p === '/aera/mitmachen' || p === '/aera/join') return serveFile(res, path.join(ROOT, 'aera-team.html'), 'no-cache', SITE_CSP);
      if (p === '/aera/changelog' || p === '/aera/changelog/') return serveFile(res, path.join(ROOT, 'aera-changelog.html'), 'no-cache', SITE_CSP);
      if (p === '/aera/discord.json') return send(res, 200, await discordStats(), 'application/json', { 'Cache-Control': 'public, max-age=120', 'X-Robots-Tag': 'noindex' });
      const name = decodeURIComponent(p.slice(1));
      if (SITE.has(name)) return serveFile(res, path.join(ROOT, name), /\.html$/.test(name) ? 'no-cache' : 'public, max-age=3600', SITE_CSP);
      if (/^img\/[a-z0-9._-]+\.(png|webp|jpg|svg|ico)$/i.test(name)) return serveFile(res, path.join(ROOT, name), 'public, max-age=86400', SITE_CSP);
    }
    if (!p.startsWith('/api/')) return send(res, 404, notFound(), TYPES.html);
    // every change needs this header: a plain form or link from another site cannot set it
    if ((req.method === 'POST' || req.method === 'PUT') && req.headers['x-dsue'] !== '1') return send(res, 403, { error: 'Forbidden' });

    // public: volunteer application (community / social media) – sent as mail to the inbox, nothing is stored on the server
    if (p === '/api/team-apply' && req.method === 'POST') {
      const ip = ipOf(req), now = Date.now(), h = (teamHits.get(ip) || []).filter(t => now - t < 3600e3);
      if (h.length >= 3) return send(res, 429, { error: 'Zu viele Bewerbungen von dieser Adresse – bitte später nochmal. · Too many applications, please try later.' });
      const b = await readJson(req); const de = b.lang !== 'en';
      if (b.website) return send(res, 200, { ok: true });   // honeypot: bots fill in the hidden field
      const c = (v, n) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
      const d = { role: { 'community-lead': 'Leading Community & Moderation Manager', community: 'Community & Moderation Manager', 'social-lead': 'Leading Social Media Manager', social: 'Social Media Manager' }[b.role] || 'Community & Moderation Manager',
        name: c(b.name, 80), email: c(b.email, 120), discord: c(b.discord, 60), langs: c(b.langs, 80), exp: String(b.exp || '').trim().slice(0, 1500),
        links: c(b.links, 300), why: String(b.why || '').trim().slice(0, 1500), time: c(b.time, 80) };
      if (!d.name || !d.discord || !d.why || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) return send(res, 400, { error: de ? 'Bitte Name, gültige E-Mail, Discord und „Warum“ ausfüllen.' : 'Please fill in name, a valid email, Discord and "why".' });
      if (b.adult !== true || b.privacy !== true) return send(res, 400, { error: de ? 'Bitte Alter (18+) und Datenschutz bestätigen.' : 'Please confirm age (18+) and the privacy note.' });
      h.push(now); teamHits.set(ip, h);
      const text = `Neue Bewerbung über dev-dsue.de/aera/team\n\nBereich: ${d.role}\nName: ${d.name}\nE-Mail: ${d.email}\nDiscord: ${d.discord}\nSprachen: ${d.langs || '–'}\nZeit: ${d.time || '–'}\nLinks: ${d.links || '–'}\n18+ bestätigt: ja · Datenschutz bestätigt: ja · Sprache der Seite: ${de ? 'DE' : 'EN'}\n\nErfahrung:\n${d.exp || '–'}\n\nWarum AERA:\n${d.why}\n`;
      const conf = de ? `Hallo ${d.name},\n\ndanke für deine Bewerbung für ${d.role} bei AERA! Sie ist bei mir angekommen. Ich melde mich in den nächsten Tagen per E-Mail oder über Discord (${d.discord}).\n\nKurz zur Erinnerung: Die Mithilfe ist freiwillig und unbezahlt, ohne Pflichtstunden – und du kannst jederzeit wieder aufhören.\n\nViele Grüße\nSimon (Desue)\nAERA · dev-dsue.de`
                      : `Hi ${d.name},\n\nthanks for applying for ${d.role} at AERA! Your application has arrived. I will get back to you in the next few days by email or on Discord (${d.discord}).\n\nJust as a reminder: helping out is voluntary and unpaid, with no required hours – and you can stop at any time.\n\nBest regards\nSimon (Desue)\nAERA · dev-dsue.de`;
      if (MOCK) { console.log('[team-apply]', text); return send(res, 200, { ok: true }); }
      if (!RESEND_KEY) return send(res, 503, { error: de ? 'Bewerbungen gehen gerade nicht – bitte an kontakt@dev-dsue.de schreiben.' : 'Applications are not available right now – please write to kontakt@dev-dsue.de.' });
      const to = process.env.TEAM_MAIL_TO || 'kontakt@dev-dsue.de', from = process.env.TEAM_MAIL_FROM || 'kontakt@dev-dsue.de';
      const mail = async (o) => { const r = await fetch('https://api.resend.com/emails', { method: 'POST', signal: AbortSignal.timeout(20000), headers: { Authorization: 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(o) }); if (!r.ok) throw new Error('resend ' + r.status); };
      try {
        await mail({ from: `AERA Bewerbungen <${from}>`, to: [to], reply_to: d.email, subject: `AERA Team-Bewerbung: ${d.role} – ${d.name}`, text });
        await mail({ from: `Simon (AERA) <${from}>`, to: [d.email], reply_to: to, subject: de ? 'Deine Bewerbung bei AERA' : 'Your application at AERA', text: conf }).catch(() => {});
      } catch (e) { console.error('team-apply', e.message); return send(res, 502, { error: de ? 'Senden fehlgeschlagen – bitte an kontakt@dev-dsue.de schreiben.' : 'Sending failed – please write to kontakt@dev-dsue.de.' }); }
      return send(res, 200, { ok: true });
    }
    if (p === '/api/login' && req.method === 'POST') {
      const ip = ipOf(req);
      if (blocked(ip)) return send(res, 429, { error: 'Zu viele Versuche – bitte in 15 Minuten nochmal.' });
      const b = await readJson(req);
      const user = String(b.user || '').trim().toLowerCase(), pass = String(b.pass || '');
      if (!user || !pass) return send(res, 400, { error: 'E-Mail und Passwort eingeben' });
      if (!MOCK && !ALLOWED.includes(user)) { failed(ip); await new Promise(r => setTimeout(r, 800)); return send(res, 401, { error: 'Anmeldung fehlgeschlagen' }); }
      const s = { user, pass: seal(pass), last: Date.now(), client: null };
      if (MOCK) { if (pass !== 'demo') { failed(ip); return send(res, 401, { error: 'Anmeldung fehlgeschlagen (Demo-Passwort: demo)' }); } }
      else { try { await imapFor(s); } catch (e) { failed(ip); await new Promise(r => setTimeout(r, 800)); return send(res, 401, { error: 'Anmeldung fehlgeschlagen' }); } }
      const t = crypto.randomBytes(32).toString('hex');
      sessions.set(t, s);
      return send(res, 200, { ok: true, user }, 'application/json', { 'Set-Cookie': `dm_s=${t}; HttpOnly; SameSite=Strict; Path=/${secure(req)}` });
    }

    const t = cookie(req, 'dm_s'), s = t && sessions.get(t);
    if (p === '/api/me') return send(res, 200, s ? { user: s.user } : { user: null });
    if (!s) return send(res, 401, { error: 'Nicht angemeldet' });
    s.last = Date.now();

    if (p === '/api/dashboard') {
      const [fl, bl, dl, dc] = await Promise.allSettled([api.folders(s), api.betaList(s), beta.stats(), discordStats()]);
      const val = r => r.status === 'fulfilled' ? r.value : null;
      const folders = val(fl) || [], inbox = folders.find(f => f.special === '\\Inbox' || f.path === 'INBOX') || {};
      let recent = [];
      try { recent = (await api.list(s, inbox.path || 'INBOX', 1, '')).items.slice(0, 6); } catch {}
      const b = val(bl) || [], st = val(dl);
      const sum = r => (r.assets || []).reduce((n, a) => n + (a.downloads || 0), 0);
      const rel = st && st.releases && st.releases[0];
      const peek = studio.peek();
      return send(res, 200, {
        user: s.user, unread: inbox.unseen || 0, inboxTotal: inbox.total || 0, inbox: inbox.path || 'INBOX', recent,
        beta: { open: b.filter(x => x.status === 'open').length, accepted: b.filter(x => x.status === 'accepted').length, waitlist: b.filter(x => x.status === 'waitlist').length, declined: b.filter(x => x.status === 'declined').length, error: bl.status === 'rejected' ? errText(bl.reason) : null },
        downloads: st ? { latest: rel ? { tag: rel.tag, date: rel.date, n: sum(rel) } : null, total: st.releases.reduce((n, r) => n + sum(r), 0), recent: (st.log || []).slice(0, 5) } : { error: dl.reason ? String(dl.reason.message || dl.reason).slice(0, 160) : 'nicht verfügbar' },
        discord: val(dc), aera: peek.aera, sync: aeraSync.state,
        services: { resend: !!RESEND_KEY, github: peek.github, mock: MOCK },
      });
    }
    if (p === '/api/beta/list') return send(res, 200, { items: await api.betaList(s), folders: mailx.BETA });
    if (p === '/api/mail-settings') {
      if (req.method === 'POST') { const b = await readJson(req); const v = { sig: String(b.sig || '').slice(0, 4000), templates: (Array.isArray(b.templates) ? b.templates : []).slice(0, 40).map(t => ({ name: String(t.name || '').slice(0, 80), subject: String(t.subject || '').slice(0, 300), body: String(t.body || '').slice(0, 12000) })) }; try { return send(res, 200, await studio.mail.save(v)); } catch (e) { return send(res, 200, { saved: 'memory', warn: e.message }); } }
      return send(res, 200, { settings: studio.mail.get() });
    }
    if (p === '/api/downloads') { try { return send(res, 200, await beta.stats()); } catch (e) { return send(res, e.status || 500, { error: e.message }); } }
    if (p.startsWith('/api/studio/')) {
      try { return await studio.handle(req, res, u, p, send, readJson); }
      catch (e) { return send(res, e.status || 500, { error: String(e.message || e).slice(0, 300) }); }
    }
    if (p === '/api/logout' && req.method === 'POST') { endSession(t); return send(res, 200, { ok: true }, 'application/json', { 'Set-Cookie': 'dm_s=; Max-Age=0; Path=/' }); }
    if (p === '/api/folders') return send(res, 200, await api.folders(s));
    const folder = u.searchParams.get('folder') || 'INBOX', uid = +u.searchParams.get('uid') || 0;
    if (p === '/api/list') return send(res, 200, await api.list(s, folder, Math.max(1, +u.searchParams.get('page') || 1), (u.searchParams.get('q') || '').slice(0, 100)));
    if (p === '/api/message') return send(res, 200, await api.message(s, folder, uid));
    if (p === '/api/attachment') {
      const a = await api.attachment(s, folder, uid, +u.searchParams.get('i') || 0);
      return send(res, 200, a.data, 'application/octet-stream', { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(a.name)}` });
    }
    if (req.method === 'POST') {
      const b = await readJson(req);
      const f = String(b.folder || 'INBOX'), id = +b.uid || 0;
      if (p === '/api/flag') { const fl = { seen: '\\Seen', flagged: '\\Flagged' }[b.flag]; if (!fl) return send(res, 400, { error: 'bad flag' }); await api.flag(s, f, id, fl, !!b.on); return send(res, 200, { ok: true }); }
      if (p === '/api/move') { await api.move(s, f, id, String(b.to || '')); return send(res, 200, { ok: true }); }
      if (p === '/api/delete') { await api.remove(s, f, id); return send(res, 200, { ok: true }); }
      if (p === '/api/bulk') { await api.bulk(s, f, (Array.isArray(b.uids) ? b.uids : []).map(Number), String(b.action || ''), String(b.to || '')); return send(res, 200, { ok: true }); }
      if (p === '/api/draft') return send(res, 200, await api.saveDraft(s, { to: String(b.to || ''), cc: String(b.cc || ''), subject: String(b.subject || '').slice(0, 500), text: String(b.text || ''), draftUid: +b.draftUid || 0 }));
      if (p === '/api/beta/decide') {
        const st = String(b.status || ''); if (!mailx.BETA[st]) return send(res, 400, { error: 'Unbekannter Status' });
        if (b.mail) {
          const m = b.mail, to = String(m.to || '').trim(); if (!to) return send(res, 400, { error: 'Empfänger fehlt' });
          await api.send(s, { to, subject: String(m.subject || '').slice(0, 500), text: String(m.text || ''), html: !!m.html, fromName: String(m.fromName || '').slice(0, 80), inReplyTo: String(m.inReplyTo || ''), references: String(m.references || ''), replyFolder: f, replyUid: id });
        }
        const dest = await api.ensureFolder(s, mailx.BETA[st]);
        if (dest !== f) await api.move(s, f, id, dest);
        return send(res, 200, { ok: true, folder: dest });
      }
      if (p === '/api/send') {
        const to = String(b.to || '').trim(); if (!to) return send(res, 400, { error: 'Empfänger fehlt' });
        await api.send(s, { to, cc: String(b.cc || '').trim(), subject: String(b.subject || '').slice(0, 500), text: String(b.text || ''), fromName: String(b.fromName || '').slice(0, 80), inReplyTo: String(b.inReplyTo || ''), references: String(b.references || ''), replyFolder: b.replyFolder, replyUid: +b.replyUid || 0, html: !!b.html, draftUid: +b.draftUid || 0, attachments: (Array.isArray(b.attachments) ? b.attachments : []).slice(0, 10).map(a => ({ name: String(a.name || 'datei').slice(0, 120), type: String(a.type || ''), data: String(a.data || '') })) });
        return send(res, 200, { ok: true });
      }
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    send(res, 500, { error: errText(e) });
  }
}).listen(PORT, () => console.log(`dsue Mail on :${PORT}${MOCK ? ' (MOCK)' : ''} – IMAP ${IMAP_HOST}:${IMAP_PORT}, SMTP ${SMTP_HOST}:${SMTP_PORT}`));
