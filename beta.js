// dev-dsue.de – AERA beta area (/beta): sign in with Discord, download the newest beta build – by Desue
//
// Who gets in: everybody who is on the AERA Discord server and has one of the roles in BETA_ROLE_IDS.
// Take the role away and the next sign-in fails; a session lasts at most SESSION_DAYS.
// The installers live in a PRIVATE GitHub repository (releases). This server streams them to signed-in testers only,
// so the files have no public link.
//
// Environment (Railway → Variables):
//   DISCORD_CLIENT_ID      Discord application → OAuth2 → Client ID
//   DISCORD_CLIENT_SECRET  Discord application → OAuth2 → Client Secret
//   DISCORD_GUILD_ID       ID of the AERA Discord server
//   BETA_ROLE_IDS          comma separated role IDs that may download (Beta Tester, Developer, …)
//   TEAM_ROLE_IDS          comma separated role IDs of the AERA team – only they get the online speech recognition (and always get in)
//   PUBLIC_URL             default https://www.dev-dsue.de   (redirect: PUBLIC_URL/beta/callback)
//   BETA_REPO              default desuee/aera-beta          (private repository with the releases)
//   BETA_GITHUB_TOKEN      fine-grained token with Contents: Read for BETA_REPO (falls back to GITHUB_TOKEN)
//   BETA_SECRET            optional, signs the session cookie (default: derived from the client secret)
//   SESSION_DAYS           default 7
const crypto = require('crypto');
const { Readable } = require('stream');

const CID = process.env.DISCORD_CLIENT_ID || '';
const CSECRET = process.env.DISCORD_CLIENT_SECRET || '';
const GUILD = process.env.DISCORD_GUILD_ID || '';
const ROLES = (process.env.BETA_ROLE_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
// TEAM_ROLE_IDS: comma separated role IDs of the AERA team (online speech recognition is only for them)
const TEAM = (process.env.TEAM_ROLE_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const PUBLIC_URL = (process.env.PUBLIC_URL || 'https://www.dev-dsue.de').replace(/\/$/, '');
const REPO = process.env.BETA_REPO || 'desuee/aera-beta';
const TOKEN = process.env.BETA_GITHUB_TOKEN || process.env.GITHUB_TOKEN || '';
const SECRET = crypto.createHash('sha256').update(process.env.BETA_SECRET || ('aera-beta:' + CSECRET)).digest();
const DAYS = +process.env.SESSION_DAYS || 7;
const REDIRECT = PUBLIC_URL + '/beta/callback';
const configured = () => !!(CID && CSECRET && GUILD && ROLES.length);

if (!configured()) console.warn('Beta area: DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET / DISCORD_GUILD_ID / BETA_ROLE_IDS not set – /beta sign-in is off.');

// ---------------- signed cookie (survives restarts, nothing stored on the server) ----------------
const b64 = b => Buffer.from(b).toString('base64url');
const sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
function makeToken(o) { const p = b64(JSON.stringify(o)); return p + '.' + sign(p); }
function readToken(t) {
  if (!t || t.indexOf('.') < 0) return null;
  const [p, s] = t.split('.');
  const a = Buffer.from(sign(p)), b = Buffer.from(s || '');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const o = JSON.parse(Buffer.from(p, 'base64url').toString()); return o.exp > Date.now() ? o : null; } catch { return null; }
}
const cookie = (req, n) => { const m = (req.headers.cookie || '').match(new RegExp('(?:^|; )' + n + '=([^;]+)')); return m ? decodeURIComponent(m[1]) : ''; };
const secure = req => (req.headers['x-forwarded-proto'] === 'https' || PUBLIC_URL.startsWith('https')) ? '; Secure' : '';
const user = req => readToken(cookie(req, 'aera_beta'));

// ---------------- GitHub (private releases) ----------------
async function gh(path) {
  if (!TOKEN) { const e = new Error('Beta downloads are not set up yet (token missing)'); e.status = 503; throw e; }
  const r = await fetch('https://api.github.com' + path, { headers: { Authorization: 'Bearer ' + TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'dev-dsue-beta' } });
  if (!r.ok) { const e = new Error(r.status === 404 ? 'No beta release found' : 'GitHub error ' + r.status); e.status = r.status === 404 ? 404 : 502; throw e; }
  return r.json();
}
let cache = { t: 0, data: null };
async function releases() {
  if (cache.data && Date.now() - cache.t < 60000) return cache.data;
  const list = (await gh(`/repos/${REPO}/releases?per_page=10`)).filter(r => !r.draft);
  cache = { t: Date.now(), data: list.map(r => ({
    tag: r.tag_name, name: r.name || r.tag_name, notes: (r.body || '').slice(0, 6000), date: r.published_at, pre: r.prerelease,
    assets: (r.assets || []).map(a => ({ id: a.id, name: a.name, size: a.size, downloads: a.download_count || 0, sha256: /^sha256:[0-9a-f]{64}$/.test(a.digest || '') ? a.digest.slice(7) : '' })) })) };
  return cache.data;
}

// ---------------- routes ----------------
// returns true when the request was handled
async function handle(req, res, u, p, send, serveFile, pagePath) {
  if (p === '/beta/' ) { res.writeHead(301, { Location: '/beta' }); res.end(); return true; }
  if (p === '/beta') { serveFile(res, pagePath); return true; }

  if (p === '/beta/login') {
    if (!configured()) { res.writeHead(302, { Location: '/beta?e=setup' }); res.end(); return true; }
    const state = crypto.randomBytes(16).toString('hex');
    const q = new URLSearchParams({ client_id: CID, redirect_uri: REDIRECT, response_type: 'code', scope: 'identify guilds.members.read', state, prompt: 'none' });
    res.writeHead(302, { Location: 'https://discord.com/oauth2/authorize?' + q, 'Set-Cookie': `aera_state=${state}; HttpOnly; SameSite=Lax; Max-Age=600; Path=/beta${secure(req)}`, 'Cache-Control': 'no-store' });
    res.end(); return true;
  }

  if (p === '/beta/callback') {
    const fail = code => { res.writeHead(302, { Location: '/beta?e=' + code, 'Set-Cookie': `aera_state=; Max-Age=0; Path=/beta` }); res.end(); return true; };
    const code = u.searchParams.get('code'), state = u.searchParams.get('state');
    if (!code || !state || state !== cookie(req, 'aera_state')) return fail('state');
    try {
      const tok = await fetch('https://discord.com/api/v10/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: CID, client_secret: CSECRET, grant_type: 'authorization_code', code, redirect_uri: REDIRECT }) }).then(r => r.json());
      if (!tok.access_token) return fail('discord');
      const H = { Authorization: 'Bearer ' + tok.access_token };
      const mr = await fetch(`https://discord.com/api/v10/users/@me/guilds/${GUILD}/member`, { headers: H });
      if (mr.status === 404) return fail('notmember');
      if (!mr.ok) return fail('discord');
      const m = await mr.json();
      if (!(m.roles || []).some(r => ROLES.includes(r))) return fail('norole');
      const du = m.user || {};
      const t = makeToken({ id: du.id, name: m.nick || du.global_name || du.username, avatar: du.avatar ? `https://cdn.discordapp.com/avatars/${du.id}/${du.avatar}.png?size=64` : '', exp: Date.now() + DAYS * 864e5 });
      res.writeHead(302, { Location: '/beta', 'Set-Cookie': [`aera_beta=${encodeURIComponent(t)}; HttpOnly; SameSite=Lax; Max-Age=${DAYS * 86400}; Path=/${secure(req)}`, 'aera_state=; Max-Age=0; Path=/beta'], 'Cache-Control': 'no-store' });
      res.end(); console.log('beta sign-in', du.username); return true;
    } catch (e) { console.warn('beta callback', e.message); return fail('discord'); }
  }

  if (p === '/beta/logout') { res.writeHead(302, { Location: '/beta', 'Set-Cookie': 'aera_beta=; Max-Age=0; Path=/' }); res.end(); return true; }

  if (p === '/api/beta/me') { const s = user(req); send(res, 200, { user: s ? { name: s.name, avatar: s.avatar } : null, ready: configured() }); return true; }

  if (p === '/api/beta/releases') {
    if (!user(req)) { send(res, 401, { error: 'Not signed in' }); return true; }
    try { send(res, 200, { releases: await releases() }); } catch (e) { send(res, e.status || 500, { error: e.message }); }
    return true;
  }

  const m = p.match(/^\/beta\/download\/(\d+)$/);
  if (m) {
    const s = user(req);
    if (!s) { res.writeHead(302, { Location: '/beta' }); res.end(); return true; }
    try {
      const rel = await releases(), a = rel.flatMap(r => r.assets).find(x => String(x.id) === m[1]);
      if (!a) { send(res, 404, { error: 'File not found' }); return true; }
      // the file itself comes from GitHub (short-lived signed link) – it does not go through this server (Railway bills every byte)
      const loc = await signedUrl(a.id);
      if (loc) { res.writeHead(302, { Location: loc, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }); res.end();
        console.log('beta download (redirect)', a.name, 'by', s.name); LOG.unshift({ t: Date.now(), file: a.name, user: s.name }); if (LOG.length > 1000) LOG.length = 1000; return true; }
      const r = await fetch(`https://api.github.com/repos/${REPO}/releases/assets/${a.id}`, { headers: { Authorization: 'Bearer ' + TOKEN, Accept: 'application/octet-stream', 'User-Agent': 'dev-dsue-beta' }, redirect: 'follow' });
      if (!r.ok || !r.body) { send(res, 502, { error: 'Download failed (' + r.status + ')' }); return true; }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': r.headers.get('content-length') || a.size,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(a.name)}`, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
      Readable.fromWeb(r.body).pipe(res);
      console.log('beta download', a.name, 'by', s.name);
      LOG.unshift({ t: Date.now(), file: a.name, user: s.name }); if (LOG.length > 1000) LOG.length = 1000;
    } catch (e) { send(res, e.status || 500, { error: e.message }); }
    return true;
  }
  return false;
}

// GitHub answers an asset request with a redirect to a signed, short-lived storage link (a few minutes): hand that to the
// player instead of streaming 145 MB through this server. Returns null if GitHub did not redirect (then we stream as before).
async function signedUrl(id) {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/assets/${id}`, { headers: { Authorization: 'Bearer ' + TOKEN, Accept: 'application/octet-stream', 'User-Agent': 'dev-dsue-beta' }, redirect: 'manual' });
    const loc = r.headers.get('location');
    try { if (r.body) await r.body.cancel(); } catch (_) {}
    return (r.status >= 300 && r.status < 400 && loc && /^https:\/\//.test(loc)) ? loc : null;
  } catch (e) { console.warn('signedUrl', e.message); return null; }
}
// download statistics for /admin/downloads: counts from GitHub (kept forever) + who downloaded since the last restart
const LOG = [];
async function stats() {
  cache.t = 0;   // fresh numbers
  const rel = await releases();
  return { since: STARTED, releases: rel.map(r => ({ tag: r.tag, name: r.name, date: r.date, assets: r.assets.map(a => ({ name: a.name, size: a.size, downloads: a.downloads })) })),
    log: LOG.slice(0, 300), users: Object.entries(LOG.reduce((m, x) => (m[x.user] = (m[x.user] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]) };
}
const STARTED = Date.now();
// ---------------- shared with aera-online.js (in-game beta gate + auto-update) ----------------
// roles of a user on the AERA server, from a Discord user access token with scope guilds.members.read
// → { ok, beta, reason }   reason: 'notmember' | 'norole' | 'discord' | 'off'
async function memberCheck(accessToken) {
  if (!GUILD || !ROLES.length) return { ok: false, beta: false, reason: 'off' };
  const mr = await fetch(`https://discord.com/api/v10/users/@me/guilds/${GUILD}/member`, { headers: { Authorization: 'Bearer ' + accessToken } });
  if (mr.status === 404) return { ok: true, beta: false, reason: 'notmember' };
  if (!mr.ok) return { ok: false, beta: false, reason: 'discord' };
  const m = await mr.json();
  const team = (m.roles || []).some(r => TEAM.includes(r));
  const beta = team || (m.roles || []).some(r => ROLES.includes(r));   // the team always gets in
  return { ok: true, beta, team, reason: beta ? '' : 'norole', nick: m.nick || '' };
}
// stream one release asset (by id) to the response; returns false when the asset is unknown
async function pipeAsset(res, id, who) {
  const rel = await releases(), a = rel.flatMap(r => r.assets).find(x => String(x.id) === String(id));
  if (!a) return false;
  const loc = await signedUrl(a.id);
  if (loc) { res.writeHead(302, { Location: loc, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }); res.end();
    console.log('aera update download (redirect)', a.name, 'by', who); LOG.unshift({ t: Date.now(), file: a.name, user: who + ' (in-game)' }); if (LOG.length > 1000) LOG.length = 1000; return true; }
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/assets/${a.id}`, { headers: { Authorization: 'Bearer ' + TOKEN, Accept: 'application/octet-stream', 'User-Agent': 'dev-dsue-beta' }, redirect: 'follow' });
  if (!r.ok || !r.body) { const e = new Error('Download failed (' + r.status + ')'); e.status = 502; throw e; }
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': r.headers.get('content-length') || a.size,
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(a.name)}`, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
  Readable.fromWeb(r.body).pipe(res);
  console.log('aera update download', a.name, 'by', who);
  LOG.unshift({ t: Date.now(), file: a.name, user: who + ' (in-game)' }); if (LOG.length > 1000) LOG.length = 1000;
  return true;
}
const gateReady = () => !!(GUILD && ROLES.length);
module.exports = { handle, stats, releases, memberCheck, pipeAsset, gateReady, DAYS, teamReady: () => TEAM.length > 0 };
