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
// "Angemeldet bleiben": an encrypted cookie (dm_r, 30 days) lets a new server start (deploy, idle timeout) restore the session.
// Its key must survive restarts: SESSION_SECRET if set, otherwise derived from the other fixed secrets on Railway.
// Changing SESSION_SECRET (or, without it, those secrets) signs every device out.
const REMEMBER_DAYS = +process.env.REMEMBER_DAYS || 30;
const RSRC = process.env.SESSION_SECRET || [process.env.RESEND_API_KEY, process.env.GITHUB_TOKEN, process.env.DISCORD_CLIENT_SECRET, process.env.ICLOUD_APP_PASSWORD, process.env.IMAP_HOST].filter(Boolean).join('|');
const RKEY = (RSRC.length >= 16 || MOCK) ? crypto.createHash('sha256').update('dsue-remember-v1|' + (RSRC || 'mock')).digest() : null;
if (!RKEY) console.warn('Remember-me is off: set SESSION_SECRET (any long random text) on Railway.');
const rSeal = o => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', RKEY, iv); const e = Buffer.concat([c.update(JSON.stringify(o), 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), e]).toString('base64url'); };
const rOpen = t => { const b = Buffer.from(t, 'base64url'), d = crypto.createDecipheriv('aes-256-gcm', RKEY, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8')); };
const rCookie = (req, u, pw) => `dm_r=${rSeal({ u, p: pw, exp: Date.now() + REMEMBER_DAYS * 864e5 })}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${REMEMBER_DAYS * 86400}${secure(req)}`;
const restoring = new Map();   // cookie -> promise (parallel requests right after a restart share one restore)
async function restoreSession(req, res) {
  const raw = cookie(req, 'dm_r'); if (!raw || !RKEY) return null;
  if (!restoring.has(raw)) {
    restoring.set(raw, (async () => {
      let d; try { d = rOpen(raw); } catch { return { clear: true }; }
      if (!d || !d.u || d.exp < Date.now() || (!MOCK && !ALLOWED.includes(d.u))) return { clear: true };
      const s = { user: d.u, pass: seal(d.p), last: Date.now(), client: null };
      if (!MOCK) { try { await imapFor(s); } catch (e) { return e.authenticationFailed || /auth|credential|login failed/i.test(e.message || '') ? { clear: true } : null; } }
      const t = crypto.randomBytes(32).toString('hex'); sessions.set(t, s);
      return { t, s, fresh: rCookie(req, d.u, d.p) };
    })());
    setTimeout(() => restoring.delete(raw), 15000).unref();
  }
  const r = await restoring.get(raw);
  if (!r) return null;
  if (r.clear) { res.setHeader('Set-Cookie', 'dm_r=; Max-Age=0; Path=/'); return null; }
  res.setHeader('Set-Cookie', [`dm_s=${r.t}; HttpOnly; SameSite=Strict; Path=/${secure(req)}`, r.fresh]);
  return r;
}
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
const calendar = require('./calendar');   // /api/cal/*: iCloud calendar via CalDAV, one per admin login (see calendar.js)
calendar.init({ key: RKEY ? RKEY.toString('hex') : '' });
const aeraOnline = require('./aera-online');   // AERA game: Discord sign-in, ranked, multiplayer rooms (see aera-online.js)
const beta = require('./beta');      // /beta: Discord sign-in + private beta downloads (see beta.js)   // /admin/studio: changelogs + program downloads (writes to GitHub)

const api = {
  async folders(s) {
    if (MOCK) return mock.folders();
    const c = await imapFor(s);
    const list = await c.list({ statusQuery: { unseen: true, messages: true } });
    return list.filter(f => !f.flags || !f.flags.has('\\Noselect')).map(f => ({ path: f.path, name: f.name, special: f.specialUse || '', unseen: f.status ? f.status.unseen : 0, total: f.status ? f.status.messages : 0 }));
  },
  // "answered" = IMAP \Answered flag, or a mail in "Sent" that replies to it (In-Reply-To, or same address + same subject after it).
  // Mails found that way get the flag set once, so the IMAP filters (open/answered) stay exact.
  async sentIndex(s) {
    if (s._sent && Date.now() - s._sent.at < 90e3) return s._sent;
    const idx = { at: Date.now(), ids: new Map(), keys: new Map() };
    try {
      const fl = await api.folders(s), sent = (fl.find(f => f.special === '\\Sent') || fl.find(f => /^(sent|gesendet)/i.test(f.name)) || {}).path;
      if (sent) await withBox(s, sent, async c => {
        let uids = await c.search({ all: true }, { uid: true }); uids = (uids || []).sort((a, b) => b - a).slice(0, 600);
        if (uids.length) for await (const m of c.fetch(uids.join(','), { uid: true, envelope: true }, { uid: true })) {
          const e = m.envelope || {}, d = new Date(e.date || 0).getTime();
          if (e.inReplyTo) for (const id of String(e.inReplyTo).split(/\s+/)) if (id) idx.ids.set(id, Math.max(idx.ids.get(id) || 0, d));
          for (const a of [...(e.to || []), ...(e.cc || [])]) { const k = (a.address || '').toLowerCase() + '|' + normSubj(e.subject); idx.keys.set(k, Math.max(idx.keys.get(k) || 0, d)); }
        }
      });
    } catch {}
    return (s._sent = idx);
  },
  async list(s, folder, page, q, filter) {
    if (MOCK) return mock.list(folder, page, q, filter);
    const fl = await api.folders(s), fo = fl.find(f => f.path === folder) || {};
    const own = /\\(Sent|Drafts|Trash|Junk)/.test(fo.special || '') || /^(sent|gesendet|drafts|entw)/i.test(folder);
    const idx = own ? null : await api.sentIndex(s);
    return withBox(s, folder, async c => {
      const per = 50;
      if (idx) {   // heal: flag mails that were answered (seen in Sent) but carry no flag yet
        s._healed = s._healed || {};
        if (!s._healed[folder] || s._healed[folder] < idx.at) {
          s._healed[folder] = idx.at;
          let open = await c.search({ answered: false }, { uid: true }); open = (open || []).sort((a, b) => b - a).slice(0, 400);
          const done = [];
          if (open.length) for await (const m of c.fetch(open.join(','), { uid: true, envelope: true }, { uid: true })) if (answeredAt(idx, m.envelope)) done.push(m.uid);
          if (done.length) await c.messageFlagsAdd(done.join(','), ['\\Answered'], { uid: true }).catch(() => {});
        }
      }
      const base = q ? { or: [{ subject: q }, { from: q }, { to: q }, { body: q }] } : { all: true };
      const crit = { ...base, ...({ open: { answered: false }, answered: { answered: true }, unread: { seen: false }, flagged: { flagged: true } }[filter] || {}) };
      let uids = await c.search(crit, { uid: true });
      uids = (uids || []).sort((a, b) => b - a);
      const total = uids.length, pick = uids.slice((page - 1) * per, page * per);
      const out = [];
      if (pick.length) for await (const m of c.fetch(pick.join(','), { uid: true, envelope: true, flags: true, size: true, bodyStructure: true }, { uid: true })) {
        const e = m.envelope || {}, at = idx ? answeredAt(idx, e) : 0;
        out.push({ uid: m.uid, subject: e.subject || '', from: (e.from || [])[0] || {}, replyTo: ((e.replyTo || [])[0] || {}).address || '', to: e.to || [], date: e.date, seen: m.flags.has('\\Seen'), flagged: m.flags.has('\\Flagged'), answered: m.flags.has('\\Answered') || !!at, answeredAt: at ? new Date(at) : null, size: m.size, att: hasAtt(m.bodyStructure) });
      }
      out.sort((a, b) => b.uid - a.uid);
      let counts = null;
      if (!own) {
        const n = async x => ((await c.search({ ...base, ...x }, { uid: true })) || []).length;
        counts = { open: await n({ answered: false }), unread: await n({ seen: false }), flagged: await n({ flagged: true }) };
      }
      return { total, page, per, items: out, counts, own };
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
    if (!/^(seen|unseen|flag|unflag|answered|unanswered|move|delete)$/.test(action)) throw new Error('Unbekannte Aktion');
    if (MOCK) { for (const u of uids) { if (action === 'delete') mock.remove(folder, u); else if (action === 'move') mock.move(folder, u, to); else mock.flag(folder, u, /seen/.test(action) ? '\\Seen' : /answered/.test(action) ? '\\Answered' : '\\Flagged', !/^un/.test(action)); } return; }
    if (action === 'delete') {
      const trash = await api.specialFolder(s, '\\Trash', /^(trash|papierkorb|deleted)/i);
      if (trash && trash !== folder) { action = 'move'; to = trash; }
      else return withBox(s, folder, c => c.messageDelete(uids.join(','), { uid: true }));
    }
    return withBox(s, folder, c => {
      const set = uids.join(',');
      if (action === 'move') return c.messageMove(set, to, { uid: true });
      const fl = /seen/.test(action) ? '\\Seen' : /answered/.test(action) ? '\\Answered' : '\\Flagged';
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
    s._sent = null;
    if (msg.replyFolder && msg.replyUid) api.flag(s, msg.replyFolder, msg.replyUid, '\\Answered', true).catch(() => {});
    if (msg.draftUid) api.dropDraft(s, msg.draftUid).catch(() => {});
    return { ok: true };
  },
};
function normSubj(t) { let x = String(t || '').trim(), y; do { y = x; x = x.replace(/^\s*(re|aw|antw|fw|fwd|wg|wtr)(\[\d+\])?\s*:\s*/i, ''); } while (x !== y); return x.replace(/\s+/g, ' ').toLowerCase(); }
function answeredAt(idx, e) {
  if (!e) return 0;
  const d = new Date(e.date || 0).getTime();
  if (e.messageId && idx.ids.has(e.messageId)) return idx.ids.get(e.messageId);
  const subj = normSubj(e.subject);
  for (const a of [...(e.replyTo || []), ...(e.from || [])]) { const t = idx.keys.get((a.address || '').toLowerCase() + '|' + subj); if (t && t >= d) return t; }
  return 0;
}
function hasAtt(bs) { if (!bs) return false; if (bs.disposition === 'attachment') return true; return (bs.childNodes || []).some(hasAtt); }
function addr(a) { return a && a.value ? a.value.map(v => ({ name: v.name || '', address: v.address || '' })) : []; }
function shape(p, uid, flags) {
  return {
    uid, subject: p.subject || '', date: p.date, from: addr(p.from), to: addr(p.to), cc: addr(p.cc), replyTo: addr(p.replyTo),
    messageId: p.messageId || '', references: [].concat(p.references || []).join(' '),
    html: p.html || '', text: p.text || '', flagged: flags ? flags.has('\\Flagged') : false, answered: flags ? flags.has('\\Answered') : false,
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
const TYPES = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'application/javascript; charset=utf-8', png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', svg: 'image/svg+xml', ico: 'image/x-icon', txt: 'text/plain; charset=utf-8', webmanifest: 'application/manifest+json; charset=utf-8', woff2: 'font/woff2' };
// public website: only these files / the img folder (never server code or package files)
const SITE = new Set(['index.html', 'impressum.html', 'datenschutz.html', 'style.css', 'site.css', 'app.js', 'theme.js', 'robots.txt', 'aera.html', 'aera.css', 'aera.js', 'aera-changelog.html', 'aera-lizenz.html', 'aera-about.html', 'aera-team.html', 'aera-crew.html', 'aera-ranked.html', 'beta-page.js', 'consent.js']);
const SITE_CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'";
function serveFile(res, file, cache, csp) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, notFound(), TYPES.html);
  const ext = path.extname(file).slice(1).toLowerCase();
  send(res, 200, fs.readFileSync(file), TYPES[ext] || 'application/octet-stream', { 'Cache-Control': cache, 'Content-Security-Policy': csp, 'X-Robots-Tag': csp === SITE_CSP ? 'all' : 'noindex, nofollow' });
}
const notFound = () => '<!doctype html><meta charset="utf-8"><title>404</title><link rel="stylesheet" href="/site.css"><main class="legal"><h1>404</h1><p>Diese Seite gibt es nicht. <a href="/">Zur Startseite</a></p></main>';
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

const OLD_HOST = /(^|\.)dev-dsue\.de(:\d+)?$/i;
const MAIN_ORIGIN = (() => { try { return new URL(process.env.PUBLIC_URL || 'https://www.dev-dsue.de').origin; } catch (_) { return 'https://www.dev-dsue.de'; } })();
const MAIN_HOST = new URL(MAIN_ORIGIN).host;
const SERVER = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  try {
    if (p === '/healthz') return send(res, 200, 'ok', 'text/plain');
    if (p === '/hooks/aera-release' && req.method === 'POST') return aeraSync.hook(req, res, send);
    if (p.startsWith('/aera/auth/') || p.startsWith('/api/aera/')) { if (await aeraOnline.handle(req, res, u, p, send, readJson)) return; }
    // new home aerastudios.de: once PUBLIC_URL points there, pages opened on the old dev-dsue.de move over (301).
    // API, Discord callbacks and webhooks still answer on the old name – games up to 0.16.11 only know dev-dsue.de.
    if ((req.method === 'GET' || req.method === 'HEAD') && OLD_HOST.test(String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim()) && !OLD_HOST.test(MAIN_HOST)
        && !p.startsWith('/api/') && !p.startsWith('/aera/auth/') && !p.startsWith('/hooks/') && !p.endsWith('/callback')) {
      res.writeHead(301, { Location: MAIN_ORIGIN + req.url, 'Cache-Control': 'max-age=3600' }); return res.end();
    }
    // beta area: own CSP so Discord avatars can load
    if (req.method === 'GET' && (p === '/beta' || p.startsWith('/beta/') || p.startsWith('/api/beta/'))) {
      const BETA_CSP = SITE_CSP.replace("img-src 'self' data:", "img-src 'self' data: https://cdn.discordapp.com");
      if (await beta.handle(req, res, u, p, send, (r, f) => serveFile(r, f, 'no-cache', BETA_CSP), path.join(ROOT, 'beta.html'))) return;
    }
    // aerastudios.de is the main address (dev-dsue.de forwards there, see above)
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (p === '/admin') { res.writeHead(301, { Location: '/admin/' }); return res.end(); }
      if (p === '/admin/' || /^\/admin\/(app\.js|views\.js|style\.css|studio\.js|studio\.css|downloads\.js|cal\.js|sw\.js|manifest\.webmanifest)$/.test(p)) return serveFile(res, path.join(ADMIN, p === '/admin/' ? 'index.html' : p.slice(7)), 'no-cache', CSP);
      if (p === '/admin/studio' || p === '/admin/studio/') return serveFile(res, path.join(ADMIN, 'studio.html'), 'no-cache', CSP);
      if (p === '/admin/downloads' || p === '/admin/downloads/') return serveFile(res, path.join(ADMIN, 'downloads.html'), 'no-cache', CSP);
      // data for the public pages, kept in memory so changes from the studio show at once
      if (p === '/api/aera-changelog/status') return send(res, 200, aeraSync.state);
      if (p === '/aera-changelog-data.js') return send(res, 200, studio.js.aera(), TYPES.js, { 'Cache-Control': 'no-cache', 'Content-Security-Policy': SITE_CSP, 'X-Robots-Tag': 'all' });
      if (p === '/aera-team-data.js') return send(res, 200, studio.js.team(), TYPES.js, { 'Cache-Control': 'no-cache', 'Content-Security-Policy': SITE_CSP, 'X-Robots-Tag': 'all' });
      if (p === '/site-data.js') return send(res, 200, studio.js.site(), TYPES.js, { 'Cache-Control': 'no-cache', 'Content-Security-Policy': SITE_CSP, 'X-Robots-Tag': 'all' });
      if (p === '/') return serveFile(res, path.join(ROOT, 'index.html'), 'no-cache', SITE_CSP);
      if (p === '/aera/') { res.writeHead(301, { Location: '/aera' }); return res.end(); }
      if (p === '/aera') return serveFile(res, path.join(ROOT, 'aera.html'), 'no-cache', SITE_CSP);
      if (p === '/aera/lizenz' || p === '/aera/license' || p === '/aera/licence') return serveFile(res, path.join(ROOT, 'aera-lizenz.html'), 'no-cache', SITE_CSP);
      if (p === '/aera/about' || p === '/aera/ueber' || p === '/aera/über' || p === '/aera/%C3%BCber') return serveFile(res, path.join(ROOT, 'aera-about.html'), 'no-cache', SITE_CSP);
      if (p === '/aera/crew' || p === '/aera/crew/' || p === '/aera/das-team') return serveFile(res, path.join(ROOT, 'aera-crew.html'), 'no-cache', SITE_CSP.replace("img-src 'self' data:", "img-src 'self' data: https:"));
      if (p === '/aera/team' || p === '/aera/mitmachen' || p === '/aera/join') return serveFile(res, path.join(ROOT, 'aera-team.html'), 'no-cache', SITE_CSP);
      if (p === '/aera/ranked' || p === '/aera/leaderboard' || p === '/aera/bestenliste') return serveFile(res, path.join(ROOT, 'aera-ranked.html'), 'no-cache', SITE_CSP.replace("img-src 'self' data:", "img-src 'self' data: https://cdn.discordapp.com"));
      if (p === '/aera/changelog' || p === '/aera/changelog/') return serveFile(res, path.join(ROOT, 'aera-changelog.html'), 'no-cache', SITE_CSP);
      if (p === '/aera/discord.json') return send(res, 200, await discordStats(), 'application/json', { 'Cache-Control': 'public, max-age=120', 'X-Robots-Tag': 'noindex' });
      const name = decodeURIComponent(p.slice(1));
      if (SITE.has(name)) return serveFile(res, path.join(ROOT, name), /\.html$/.test(name) ? 'no-cache' : 'public, max-age=3600', SITE_CSP);
      if (/^img\/[a-z0-9._-]+\.(png|webp|jpg|svg|ico)$/i.test(name)) return serveFile(res, path.join(ROOT, name), 'public, max-age=86400', SITE_CSP);
      if (/^fonts\/[a-z0-9._-]+\.woff2$/i.test(name)) return serveFile(res, path.join(ROOT, name), 'public, max-age=31536000, immutable', SITE_CSP);
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
      const T = studio.team(), R = (T.roles || []).find(r => r.id === b.role);
      if ((R && R.taken) || (T.filled || []).includes(b.role)) return send(res, 400, { error: de ? 'Diese Stelle ist schon vergeben – bewirb dich gern für eine der anderen.' : 'This position is already taken – feel free to apply for one of the others.' });
      if ((T.roles || []).length && !R) return send(res, 400, { error: de ? 'Bitte wähle eine Stelle aus.' : 'Please choose a position.' });
      const c = (v, n) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
      const d = { role: R ? R.name : { 'community-lead': 'Leading Community & Moderation Manager', community: 'Community & Moderation Manager', 'social-lead': 'Leading Social Media Manager', social: 'Social Media Manager' }[b.role] || 'Community & Moderation Manager',
        name: c(b.name, 80), email: c(b.email, 120), discord: c(b.discord, 60), langs: c(b.langs, 80), exp: String(b.exp || '').trim().slice(0, 1500),
        links: c(b.links, 300), why: String(b.why || '').trim().slice(0, 1500), time: c(b.time, 80) };
      if (!d.name || !d.discord || !d.why || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) return send(res, 400, { error: de ? 'Bitte Name, gültige E-Mail, Discord und „Warum“ ausfüllen.' : 'Please fill in name, a valid email, Discord and "why".' });
      if (b.adult !== true || b.privacy !== true) return send(res, 400, { error: de ? 'Bitte Alter (18+) und Datenschutz bestätigen.' : 'Please confirm age (18+) and the privacy note.' });
      h.push(now); teamHits.set(ip, h);
      const text = `Neue Bewerbung über dev-dsue.de/aera/team\n\nBereich: ${d.role}\nName: ${d.name}\nE-Mail: ${d.email}\nDiscord: ${d.discord}\nSprachen: ${d.langs || '–'}\nZeit: ${d.time || '–'}\nLinks: ${d.links || '–'}\n18+ bestätigt: ja · Datenschutz bestätigt: ja · Sprache der Seite: ${de ? 'DE' : 'EN'}\n\nErfahrung:\n${d.exp || '–'}\n\nWarum AERA:\n${d.why}\n`;
      const conf = de ? `Hallo ${d.name},\n\ndanke für deine Bewerbung für ${d.role} bei AERA! Sie ist bei mir angekommen. Ich melde mich in den nächsten Tagen per E-Mail oder über Discord (${d.discord}).\n\nKurz zur Erinnerung: Die Mithilfe ist freiwillig und unbezahlt, ohne Pflichtstunden – und du kannst jederzeit wieder aufhören.\n\nViele Grüße\nSimon (Desue)\nAERA · dev-dsue.de`
                      : `Hi ${d.name},\n\nthanks for applying for ${d.role} at AERA! Your application has arrived. I will get back to you in the next few days by email or on Discord (${d.discord}).\n\nJust as a reminder: helping out is voluntary and unpaid, with no required hours – and you can stop at any time.\n\nBest regards\nSimon (Desue)\nAERA · dev-dsue.de`;
      if (MOCK) { console.log('[team-apply]', text); return send(res, 200, { ok: true }); }
      if (!RESEND_KEY) return send(res, 503, { error: de ? 'Bewerbungen gehen gerade nicht – bitte an apply-aera@dev-dsue.de schreiben.' : 'Applications are not available right now – please write to apply-aera@dev-dsue.de.' });
      const to = process.env.TEAM_MAIL_TO || 'apply-aera@dev-dsue.de', from = process.env.TEAM_MAIL_FROM || to;   // applications go to their own mailbox
      const mail = async (o) => { const r = await fetch('https://api.resend.com/emails', { method: 'POST', signal: AbortSignal.timeout(20000), headers: { Authorization: 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(o) }); if (!r.ok) throw new Error('resend ' + r.status); };
      try {
        await mail({ from: `AERA Bewerbungen <${from}>`, to: [to], reply_to: `${d.name.replace(/["<>]/g, '')} <${d.email}>`, subject: `AERA Team-Bewerbung: ${d.role} – ${d.name}`, text });
        await mail({ from: `AERA Recruiting <${from}>`, to: [d.email], reply_to: to, subject: de ? 'Deine Bewerbung bei AERA' : 'Your application at AERA', text: conf }).catch(() => {});
      } catch (e) { console.error('team-apply', e.message); return send(res, 502, { error: de ? 'Senden fehlgeschlagen – bitte an apply-aera@dev-dsue.de schreiben.' : 'Sending failed – please write to apply-aera@dev-dsue.de.' }); }
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
      const ck = [`dm_s=${t}; HttpOnly; SameSite=Strict; Path=/${secure(req)}`, b.remember && RKEY ? rCookie(req, user, pass) : 'dm_r=; Max-Age=0; Path=/'];
      return send(res, 200, { ok: true, user, remember: !!(b.remember && RKEY) }, 'application/json', { 'Set-Cookie': ck });
    }

    let t = cookie(req, 'dm_s'), s = t && sessions.get(t);
    if (!s) { const r = await restoreSession(req, res); if (r) { t = r.t; s = r.s; } }
    if (p === '/api/me') return send(res, 200, s ? { user: s.user } : { user: null });
    if (!s) return send(res, 401, { error: 'Nicht angemeldet' });
    s.last = Date.now();

    if (p === '/api/dashboard') {
      const [fl, bl, dl, dc, cl] = await Promise.allSettled([api.folders(s), api.betaList(s), beta.stats(), discordStats(), calendar.upcoming(s.user, 5)]);
      const val = r => r.status === 'fulfilled' ? r.value : null;
      const folders = val(fl) || [], inbox = folders.find(f => f.special === '\\Inbox' || f.path === 'INBOX') || {};
      let recent = [], open = null;
      try { const l = await api.list(s, inbox.path || 'INBOX', 1, ''); recent = l.items.slice(0, 6); open = l.counts ? l.counts.open : null; } catch {}
      const b = val(bl) || [], st = val(dl);
      const sum = r => (r.assets || []).reduce((n, a) => n + (a.downloads || 0), 0);
      const rel = st && st.releases && st.releases[0];
      const peek = studio.peek();
      return send(res, 200, {
        user: s.user, unread: inbox.unseen || 0, open, inboxTotal: inbox.total || 0, inbox: inbox.path || 'INBOX', recent,
        beta: { open: b.filter(x => x.status === 'open').length, accepted: b.filter(x => x.status === 'accepted').length, waitlist: b.filter(x => x.status === 'waitlist').length, declined: b.filter(x => x.status === 'declined').length, error: bl.status === 'rejected' ? errText(bl.reason) : null },
        downloads: st ? { latest: rel ? { tag: rel.tag, date: rel.date, n: sum(rel) } : null, total: st.releases.reduce((n, r) => n + sum(r), 0), recent: (st.log || []).slice(0, 5) } : { error: dl.reason ? String(dl.reason.message || dl.reason).slice(0, 160) : 'nicht verfügbar' },
        discord: val(dc), cal: cl.status === 'fulfilled' ? cl.value : { configured: true, error: errText(cl.reason) }, aera: peek.aera, sync: aeraSync.state,
        services: { resend: !!RESEND_KEY, github: peek.github, mock: MOCK, cal: calendar.isConfigured(s.user) },
      });
    }
    if (p === '/api/beta/list') return send(res, 200, { items: await api.betaList(s), folders: mailx.BETA });
    if (p === '/api/mail-settings') {
      if (req.method === 'POST') { const b = await readJson(req); const v = { sender: String(b.sender || '').slice(0, 80), role: String(b.role || '').slice(0, 80), sig: String(b.sig || '').slice(0, 4000), templates: (Array.isArray(b.templates) ? b.templates : []).slice(0, 60).map(t => ({ name: String(t.name || '').slice(0, 80), subject: String(t.subject || '').slice(0, 300), body: String(t.body || '').slice(0, 12000) })), known: (Array.isArray(b.known) ? b.known : []).slice(0, 200).map(n => String(n).slice(0, 80)) }; try { return send(res, 200, await studio.mail.save(s.user, v)); } catch (e) { return send(res, 200, { saved: 'memory', warn: e.message }); } }
      return send(res, 200, { settings: studio.mail.get(s.user) });
    }
    if (p === '/api/downloads') { try { return send(res, 200, await beta.stats()); } catch (e) { return send(res, e.status || 500, { error: e.message }); } }
    if (p.startsWith('/api/cal/')) {
      try { return await calendar.handle(req, res, u, p, send, readJson, s.user); }
      catch (e) { return send(res, e.status || 502, { error: String(e.message || e).slice(0, 300) }); }
    }
    if (p.startsWith('/api/studio/')) {
      try { return await studio.handle(req, res, u, p, send, readJson); }
      catch (e) { return send(res, e.status || 500, { error: String(e.message || e).slice(0, 300) }); }
    }
    if (p === '/api/logout' && req.method === 'POST') { endSession(t); return send(res, 200, { ok: true }, 'application/json', { 'Set-Cookie': ['dm_s=; Max-Age=0; Path=/', 'dm_r=; Max-Age=0; Path=/'] }); }
    if (p === '/api/folders') return send(res, 200, await api.folders(s));
    const folder = u.searchParams.get('folder') || 'INBOX', uid = +u.searchParams.get('uid') || 0;
    if (p === '/api/list') return send(res, 200, await api.list(s, folder, Math.max(1, +u.searchParams.get('page') || 1), (u.searchParams.get('q') || '').slice(0, 100), String(u.searchParams.get('filter') || '')));
    if (p === '/api/message') return send(res, 200, await api.message(s, folder, uid));
    if (p === '/api/attachment') {
      const a = await api.attachment(s, folder, uid, +u.searchParams.get('i') || 0);
      return send(res, 200, a.data, 'application/octet-stream', { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(a.name)}` });
    }
    if (req.method === 'POST') {
      const b = await readJson(req);
      const f = String(b.folder || 'INBOX'), id = +b.uid || 0;
      if (p === '/api/flag') { const fl = { seen: '\\Seen', flagged: '\\Flagged', answered: '\\Answered' }[b.flag]; if (!fl) return send(res, 400, { error: 'bad flag' }); await api.flag(s, f, id, fl, !!b.on); return send(res, 200, { ok: true }); }
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
});
aeraOnline.attach(SERVER);
SERVER.listen(PORT, () => console.log(`dsue Mail on :${PORT}${MOCK ? ' (MOCK)' : ''} – IMAP ${IMAP_HOST}:${IMAP_PORT}, SMTP ${SMTP_HOST}:${SMTP_PORT}`));
