// dev-dsue.de – AERA online: sign in with Discord from the game, ranked shifts + leaderboard, multiplayer rooms – by Desue
//
// Environment (Railway → Variables):
//   DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET   same Discord application as the beta area
//                                               redirect to add in the portal: PUBLIC_URL/aera/auth/callback
//   PUBLIC_URL        default https://www.dev-dsue.de
//   AERA_SECRET       optional, signs the game tokens (default: derived from the client secret)
//   AERA_DATA_DIR     folder for ranked data – a Railway Volume (e.g. mounted at /data). Without it ranked data lives
//                     in memory only and is lost on every restart / deploy.
//   AERA_DEV_AUTH=1   TESTS ONLY: /aera/auth/dev?name=X hands out a token without Discord. Never set this on Railway.
//
// The game is a desktop app, so it opens /aera/auth/login in a small window. After Discord the server sends it to
// /aera/auth/done#t=<token>; the app reads the token from that address and closes the window.
// Calls from the game send "Authorization: Bearer <token>".
const crypto = require('crypto'), fs = require('fs'), path = require('path');

const CID = process.env.DISCORD_CLIENT_ID || '';
const CSECRET = process.env.DISCORD_CLIENT_SECRET || '';
const PUBLIC_URL = (process.env.PUBLIC_URL || 'https://www.dev-dsue.de').replace(/\/$/, '');
const REDIRECT = PUBLIC_URL + '/aera/auth/callback';
const SECRET = crypto.createHash('sha256').update(process.env.AERA_SECRET || ('aera-online:' + CSECRET + ':' + CID)).digest();
const DEV = process.env.AERA_DEV_AUTH === '1';
const DATA_DIR = process.env.AERA_DATA_DIR || '';
const TOKEN_DAYS = 60;
const beta = require('./beta');   // beta role check + private releases (in-game gate and auto-update)
const GATE = process.env.AERA_BETA_GATE !== '0';   // AERA_BETA_GATE=0 → the game starts for everybody (no beta role needed)
// AERA_UPDATE_HOLD=<Discord user IDs, comma separated> → new releases are offered only to these people (test an update yourself first, then remove it)
const HOLD = (process.env.AERA_UPDATE_HOLD || '').split(',').map(x => x.trim()).filter(Boolean);
const MOCK_UPD = DEV ? (process.env.AERA_UPDATE_MOCK || '') : '';   // local tests only: folder with releases.json + files

// ---------------- tokens ----------------
const b64 = b => Buffer.from(b).toString('base64url');
const sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
const makeToken = o => { const p = b64(JSON.stringify(o)); return p + '.' + sign(p); };
function readToken(t) {
  if (!t || t.indexOf('.') < 0) return null;
  const [p, s] = t.split('.');
  const a = Buffer.from(sign(p)), b = Buffer.from(s || '');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const o = JSON.parse(Buffer.from(p, 'base64url').toString()); return o.exp > Date.now() ? o : null; } catch { return null; }
}
const bearer = req => readToken(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
const cookie = (req, n) => { const m = (req.headers.cookie || '').match(new RegExp('(?:^|; )' + n + '=([^;]+)')); return m ? decodeURIComponent(m[1]) : ''; };
const secure = req => (req.headers['x-forwarded-proto'] === 'https' || PUBLIC_URL.startsWith('https')) ? '; Secure' : '';

// ---------------- storage ----------------
let DB = { users: {}, runs: {} };
const FILE = DATA_DIR ? path.join(DATA_DIR, 'aera-online.json') : '';
if (FILE) { try { DB = Object.assign(DB, JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch (e) { if (e.code !== 'ENOENT') console.warn('aera-online: cannot read', FILE, e.message); } }
else console.warn('AERA online: AERA_DATA_DIR is not set – ranked data is kept in memory only (lost on restart).');
let dirty = false;
setInterval(() => { if (!dirty || !FILE) return; dirty = false; try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(FILE + '.tmp', JSON.stringify(DB)); fs.renameSync(FILE + '.tmp', FILE); } catch (e) { console.warn('aera-online save', e.message); dirty = true; } }, 5000).unref();
const save = () => { dirty = true; };

// ---------------- ranked ----------------
// Queues: Köln Approach (app), Köln Tower (twr), Frankfurt Approach (fra). A ranked shift is 30 minutes in real time on the scenario of the week.
const QUEUES = { app: 'Köln/Bonn Approach', twr: 'Köln/Bonn Tower', fra: 'Frankfurt Approach' };
const SHIFT = 1800, PLACEMENT = 3;
// [min rating, level, code, name]
const RANKS = [[0, 1, 'ACR', 'Airspace Recruit'], [800, 2, 'JCO', 'Junior Control Officer'], [950, 3, 'COT', 'Control Operator'], [1100, 4, 'FCO', 'Flight Control Officer'],
  [1250, 5, 'SCO', 'Senior Control Officer'], [1400, 6, 'LCO', 'Lead Control Officer'], [1550, 7, 'PCO', 'Principal Control Officer'], [1700, 8, 'CSE', 'Chief Sector Expert'],
  [1850, 9, 'ACD', 'Airspace Command Director'], [2000, 10, 'DCA', 'Director of Control Authority']];
const rankOf = r => { let x = RANKS[0]; for (const k of RANKS) if (r >= k[0]) x = k; return { lvl: x[1], code: x[2], name: x[3] }; };
const week = (d = new Date()) => { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y = t.getUTCFullYear(); return y * 100 + Math.ceil(((t - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7); };
// performance of one shift on the rating scale (about 1000 = solid, 1500 = very good)
function perf(q, s) {
  const hrs = Math.max(s.t / 3600, 0.25), sph = s.score / hrs;
  const base = q === 'twr' ? 70 : q === 'fra' ? 95 : 80;   // points per hour of a solid shift
  let p = 1000 + (sph - base) * 7 - 110 * s.sep - 55 * ((s.lost || 0) + (s.mva || 0) + (s.edr || 0)) - 20 * Math.max(0, (s.ga || 0) - 1);
  if (s.emg) p += 40 * (s.emgOk || 0) - 60 * Math.max(0, s.emg - (s.emgOk || 0));
  return Math.round(Math.max(200, Math.min(2400, p)));
}
function userEntry(u) {
  const e = DB.users[u.id] || (DB.users[u.id] = { name: u.name, avatar: u.avatar || '', q: {} });
  e.name = u.name; e.avatar = u.avatar || e.avatar; return e;
}
function qPub(q) { if (!q) return null; const placed = q.n >= PLACEMENT; const rk = placed ? rankOf(q.r) : null;
  return { rating: placed ? Math.round(q.r) : null, rank: rk ? rk.name : null, code: rk ? rk.code : null, lvl: rk ? rk.lvl : null, placement: placed ? null : `${q.n}/${PLACEMENT}`, shifts: q.n, best: q.best || 0, last: (q.hist || []).slice(-10) }; }
function check(run, s, now) {
  const why = [];
  const num = (v, lo, hi) => typeof v === 'number' && isFinite(v) && v >= lo && v <= hi;
  if (!num(s.t, SHIFT - 30, SHIFT + 120)) why.push('shift length');
  if ((now - run.at) / 1000 < s.t * 0.9 - 30 && !(DEV && process.env.AERA_DEV_FAST === '1')) why.push('time');   // ranked runs in real time (no time acceleration)
  if (!num(s.score, -2000, s.t / 3600 * 420)) why.push('score');
  if (!num(s.land || 0, 0, s.t / 45) || !num(s.ho || 0, 0, s.t / 35)) why.push('traffic');
  for (const k of ['sep', 'lost', 'mva', 'edr', 'ga', 'emg', 'emgOk']) if (s[k] != null && !num(s[k], 0, 500)) why.push(k);
  if (s.seed !== run.seed || s.q !== run.q) why.push('scenario');
  return why;
}

// ---------------- beta gate + auto-update ----------------
// token from /aera/auth/callback carries beta (1/0), br (why not) and bt (when the role was checked)
// online speech recognition: only for the Discord team role (TEAM_ROLE_IDS), stored in the token at sign-in.
// AERA_STT_ALL=1 opens it for every beta tester.
const sttTeam = me => process.env.AERA_STT_ALL === '1' || (me && me.team === 1);
function gateCheck(req) {
  const me = bearer(req);
  if (!me) return { ok: false, code: 401, error: 'Not signed in', reason: 'login' };
  if (!GATE) return { ok: true, me };
  if (!('beta' in me) || Date.now() - (me.bt || 0) > beta.DAYS * 864e5) return { ok: false, code: 403, error: 'Please sign in again', reason: 'relogin' };
  if (!me.beta) return { ok: false, code: 403, error: me.br === 'notmember' ? 'Not on the AERA Discord' : me.br === 'off' ? 'Beta check is not set up on the server' : me.br === 'discord' ? 'Discord did not answer' : 'No beta tester role', reason: me.br || 'norole' };
  return { ok: true, me };
}
const verOf = t => { const m = String(t || '').match(/(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?/); return m ? (m[4] != null ? [+m[1], +m[2], +m[3], +m[4]] : [+m[1], +m[2], +m[3]]) : null; };   // 0.13.11 or 0.13.0.4
const verCmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || (a[3] || 0) - (b[3] || 0);
const SETUP = /^AERA-Setup-\d+\.\d+\.\d+.*\.exe$/i;
// release text: the first ``` block if there is one (the Discord part below it is left out), else the whole text
const notesOf = b => { const m = String(b || '').match(/```[a-z]*\r?\n([\s\S]*?)```/); return (m ? m[1] : String(b || '')).trim().slice(0, 4000); };
async function updateInfo(v) {
  const cur = verOf(v);
  if (!cur) { const e = new Error('version missing'); e.status = 400; throw e; }
  const rel = MOCK_UPD ? JSON.parse(fs.readFileSync(path.join(MOCK_UPD, 'releases.json'), 'utf8')) : await beta.releases();
  const newer = rel.map(r => ({ r, v: verOf(r.tag) || verOf(r.name), a: (r.assets || []).find(a => SETUP.test(a.name)) }))
    .filter(x => x.v && x.a && verCmp(x.v, cur) > 0).sort((a, b) => verCmp(b.v, a.v));
  if (!newer.length) return { update: false, current: v };
  const top = newer[0];
  return { update: true, current: v, version: top.v.join('.'), name: top.r.name, date: top.r.date || '',
    notes: newer.slice(0, 5).map(x => ({ version: x.v.join('.'), date: x.r.date || '', text: notesOf(x.r.notes) })),
    asset: { id: top.a.id, name: top.a.name, size: top.a.size, sha256: top.a.sha256 || '' } };
}
function mockPipe(res, id) {
  const rel = JSON.parse(fs.readFileSync(path.join(MOCK_UPD, 'releases.json'), 'utf8')), a = rel.flatMap(r => r.assets).find(x => String(x.id) === String(id));
  if (!a) return false;
  const f = path.join(MOCK_UPD, path.basename(a.name)), st = fs.statSync(f);
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(res); return true;
}

// ---------------- online speech recognition (opt-in in the game, beta testers only) ----------------
// The game sends the recorded transmission (16 kHz WAV) here; the server forwards it to the speech API with its own key.
// The key never leaves the server.  Environment (Railway):
//   OPENAI_API_KEY      (or AERA_STT_KEY)  key for the speech API – without it the online recognition is off
//   AERA_STT_MODEL      default gpt-4o-mini-transcribe
//   AERA_STT_URL        default https://api.openai.com/v1/audio/transcriptions  (any OpenAI-compatible endpoint, e.g. Groq)
//   AERA_STT_PER_MIN / AERA_STT_PER_DAY   limits per player, default 30 / 1500
const STT_KEY = process.env.AERA_STT_KEY || process.env.OPENAI_API_KEY || '';
const STT_URL = process.env.AERA_STT_URL || 'https://api.openai.com/v1/audio/transcriptions';
const STT_MODEL = process.env.AERA_STT_MODEL || 'gpt-4o-mini-transcribe';
const STT_MOCK = DEV && process.env.AERA_STT_MOCK === '1';   // local tests only
const STT_PER_MIN = +process.env.AERA_STT_PER_MIN || 30, STT_PER_DAY = +process.env.AERA_STT_PER_DAY || 1500;
const STT_USE = new Map();
const STT_STATS = { n: 0, sec: 0, fail: 0, since: Date.now() };
const sttOn = () => !!(STT_KEY || STT_MOCK);
function sttLimit(id) {
  const now = Date.now(), day = new Date().toISOString().slice(0, 10);
  const u = STT_USE.get(id) || { m: [], day, n: 0 };
  if (u.day !== day) { u.day = day; u.n = 0; }
  u.m = u.m.filter(t => now - t < 60000);
  if (u.m.length >= STT_PER_MIN || u.n >= STT_PER_DAY) { STT_USE.set(id, u); return false; }
  u.m.push(now); u.n++; STT_USE.set(id, u); return true;
}
function readRaw(req, max) {
  return new Promise((res, rej) => { const ch = []; let n = 0;
    let over = false;
    req.on('data', c => { if (over) return; n += c.length; if (n > max) { over = true; ch.length = 0; const e = new Error('transmission too long'); e.status = 413; rej(e); return; } ch.push(c); });
    req.on('end', () => { if (!over) res(Buffer.concat(ch)); }); req.on('error', rej); });
}
async function sttRun(buf, prompt) {
  if (STT_MOCK) return { text: process.env.AERA_STT_MOCK_TEXT || 'mock transcription' };
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'audio/wav' }), 'ptt.wav');
  fd.append('model', STT_MODEL); fd.append('language', 'en'); fd.append('response_format', 'json');
  if (prompt) fd.append('prompt', prompt);
  const r = await fetch(STT_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + STT_KEY }, body: fd, signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((j.error && j.error.message) || ('speech API ' + r.status)); e.status = 502; throw e; }
  return { text: String(j.text || '') };
}

// ---------------- AI understanding (team only for now) ----------------
// When the game's own phrase parser is unsure (no callsign, nothing understood, or an instruction that does not fit the
// aircraft – e.g. a route clearance for an aircraft at the holding point), it sends the transcribed text plus a short list of
// the aircraft and their state here. A language model rewrites it into the standard phrase the game understands; the game
// then runs that phrase through its normal parser (all checks and readbacks stay in the game). Environment (Railway):
//   OPENAI_API_KEY (or AERA_NLU_KEY)   without it the AI understanding is off
//   AERA_NLU_MODEL    default gpt-4.1-mini        (cheaper: gpt-4o-mini)
//   AERA_NLU_URL      default https://api.openai.com/v1/chat/completions   (any OpenAI-compatible endpoint)
//   AERA_NLU_PER_MIN / AERA_NLU_PER_DAY   limits per player, default 30 / 1500
const NLU_KEY = process.env.AERA_NLU_KEY || process.env.OPENAI_API_KEY || '';
const NLU_URL = process.env.AERA_NLU_URL || 'https://api.openai.com/v1/chat/completions';
const NLU_MODEL = process.env.AERA_NLU_MODEL || 'gpt-4.1-mini';
const NLU_PER_MIN = +process.env.AERA_NLU_PER_MIN || 30, NLU_PER_DAY = +process.env.AERA_NLU_PER_DAY || 1500;
const NLU_USE = new Map();
const NLU_STATS = { n: 0, ok: 0, fail: 0, tin: 0, tout: 0, since: Date.now() };
const nluOn = () => !!NLU_KEY;
function nluLimit(id) {
  const now = Date.now(), day = new Date().toISOString().slice(0, 10);
  const u = NLU_USE.get(id) || { m: [], day, n: 0 };
  if (u.day !== day) { u.day = day; u.n = 0; }
  u.m = u.m.filter(t => now - t < 60000);
  if (u.m.length >= NLU_PER_MIN || u.n >= NLU_PER_DAY) { NLU_USE.set(id, u); return false; }
  u.m.push(now); u.n++; NLU_USE.set(id, u); return true;
}
const NLU_VOCAB = {
  APP: [
    '<callsign>, turn left heading 270 | turn right heading 090 | fly heading 180 | continue present heading | turn left by 20 degrees',
    '<callsign>, descend altitude 5000 | climb altitude 6000 | descend flight level 120 | climb flight level 240',
    '<callsign>, speed 220 knots | reduce speed 180 knots | maintain 250 knots or greater | speed 160 knots until 5 DME | resume normal speed',
    '<callsign>, descend flight level 100 rate 1500 feet per minute or greater | resume normal rate',
    '<callsign>, proceed direct ROLIS | resume own navigation | hold over DITAM',
    '<callsign>, cleared ILS approach runway 25L | cleared visual approach runway 25C | go around',
    '<callsign>, squawk 4512 | squawk ident | confirm squawk',
    '<callsign>, contact Tower | contact Langen Radar | frequency change approved',
    '<callsign>, radar contact   (= first contact acknowledged, no instruction)',
    '<callsign>, deviation approved',
    'Several instructions in one transmission are joined with commas, e.g. "<callsign>, turn left heading 250, descend altitude 4000, speed 200 knots".',
  ],
  TWR: [
    'Delivery: <callsign>, cleared to <destination> via <SID> departure, climb flight level 70, squawk 4512 | <callsign>, read back correct | <callsign>, read back correct, report ready for push and start',
    'Ground: <callsign>, startup approved | push back approved | push and start approved, facing south | push back approved, blue line | push back approved, orange line',
    'Ground: <callsign>, taxi to holding point runway 13L via A, hold short runway 06 | taxi via A B | taxi to stand B24 via E A4 | continue taxi | hold position | hold short A | give way to <callsign> | follow <callsign> | expedite',
    'Tower: <callsign>, hold short runway 06 | cross runway 06 | cross runway 06, hold short D, contact ground',
    'Tower: <callsign>, line up and wait runway 13L | behind the landing A320, line up and wait runway 13L | cleared for takeoff runway 13L | cleared for immediate takeoff | cancel takeoff clearance',
    'Tower: <callsign>, cleared to land runway 14L | continue approach | go around | vacate via A4 | expedite vacating',
    'Handoffs: <callsign>, contact ground | contact tower | contact departure | contact delivery',
    '<callsign>, squawk 4512 | confirm squawk',
    'Several instructions in one transmission are joined with commas.',
  ],
};
NLU_VOCAB.CTR = NLU_VOCAB.APP;
function nluPrompt(mode) {
  return [
    'You turn an air traffic controller\'s radio transmission into the exact standard phrase an ATC simulator understands.',
    'The transmission was transcribed by speech recognition, so words, callsigns and waypoint names can be misheard. The controller may also use non-standard but clear wording.',
    'You get the list of aircraft with their current state. Use it to decide which aircraft is meant and what the controller wants.',
    'Rules:',
    '- Write ONLY instructions the controller actually gave. Never add, guess or complete an instruction he did not give. Information for the pilot (wind, QNH, traffic info) is dropped.',
    '- Start with the callsign exactly as written in the "say" field of the aircraft list.',
    '- Use only phrases from this list (numbers in digits, runways like 25L, waypoints exactly as in the lists):',
    ...(NLU_VOCAB[mode] || NLU_VOCAB.APP).map(l => '  ' + l),
    '- Use the state: "cleared for departure" to an aircraft at the holding point or on the runway that already has its clearance means "cleared for takeoff"; a route clearance is only for aircraft at the stand.',
    '- If the callsign is unclear, pick the aircraft whose state fits the instruction; if two fit equally, set conf below 0.5.',
    '- If nothing sensible can be understood, return an empty phrase.',
    'Answer with JSON only: {"cs": "<callsign code from the list or null>", "phrase": "<standard phrase or empty>", "conf": <0..1>}',
  ].join('\n');
}
async function nluRun(body) {
  const mode = ['APP', 'CTR', 'TWR'].includes(body.mode) ? body.mode : 'APP';
  const ctx = { airport: String(body.apt || '').slice(0, 8), runways: body.rwy || null, position: body.pos || null, aircraft: (Array.isArray(body.ac) ? body.ac : []).slice(0, 30), fixes: (Array.isArray(body.fixes) ? body.fixes : []).slice(0, 120), parser_note: String(body.why || '').slice(0, 200) };
  const user = 'Situation:\n' + JSON.stringify(ctx) + '\n\nTranscribed transmission:\n"' + String(body.text || '').slice(0, 400) + '"';
  const r = await fetch(NLU_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + NLU_KEY, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(6000),
    body: JSON.stringify({ model: NLU_MODEL, temperature: 0, max_tokens: 150, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: nluPrompt(mode) }, { role: 'user', content: user }] }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((j.error && j.error.message) || ('AI API ' + r.status)); e.status = 502; throw e; }
  if (j.usage) { NLU_STATS.tin += j.usage.prompt_tokens || 0; NLU_STATS.tout += j.usage.completion_tokens || 0; }
  let o = {}; try { o = JSON.parse((((j.choices || [])[0] || {}).message || {}).content || '{}'); } catch (_) { o = {}; }
  const known = new Set(ctx.aircraft.map(a => a && a.cs).filter(Boolean));
  const cs = known.has(o.cs) ? o.cs : null;
  const phrase = cs ? String(o.phrase || '').replace(/[\r\n]+/g, ' ').slice(0, 300).trim() : '';   // never a callsign that is not on the scope
  const conf = Math.max(0, Math.min(1, +o.conf || 0));
  return { cs, phrase, conf };
}

// ---------------- http routes ----------------
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Dsue', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const configured = () => !!(CID && CSECRET);
const RET_OK = r => /^http:\/\/127\.0\.0\.1:\d{2,5}\/aera-signin$/.test(String(r || ''));
const page = (title, body) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d14;color:#e8eef7;font:16px/1.5 Inter,system-ui,sans-serif;text-align:center}b{color:#ffd23f}p{color:#9aa4b2}</style><main><h2>${title}</h2>${body}</main>`;

async function handle(req, res, u, p, send, readJson) {
  if (p.startsWith('/api/aera/') && req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return true; }
  const J = (code, body) => send(res, code, body, 'application/json', CORS);

  if (p === '/aera/auth/login') {
    if (!configured()) { send(res, 503, page('AERA', '<p>Discord sign-in is not set up yet.</p>'), 'text/html; charset=utf-8'); return true; }
    const state = crypto.randomBytes(16).toString('hex');
    const q = new URLSearchParams({ client_id: CID, redirect_uri: REDIRECT, response_type: 'code', scope: 'identify guilds.members.read', state, prompt: 'none' });
    // sign-in through the normal browser (the game's own window stays black on some PCs): the game listens on 127.0.0.1 and
    // gets the token handed back from the done page. Only a loopback address on this machine is accepted as return address.
    const ret = String(u.searchParams.get('ret') || '');
    const cookies = [`aera_ostate=${state}; HttpOnly; SameSite=Lax; Max-Age=600; Path=/aera/auth${secure(req)}`];
    cookies.push(RET_OK(ret) ? `aera_oret=${encodeURIComponent(ret)}; HttpOnly; SameSite=Lax; Max-Age=600; Path=/aera/auth${secure(req)}` : `aera_oret=; Max-Age=0; Path=/aera/auth`);
    res.writeHead(302, { Location: 'https://discord.com/oauth2/authorize?' + q, 'Set-Cookie': cookies, 'Cache-Control': 'no-store' });
    res.end(); return true;
  }
  if (p === '/aera/auth/callback') {
    const fail = m => { res.writeHead(302, { Location: '/aera/auth/done#e=' + m, 'Cache-Control': 'no-store' }); res.end(); return true; };
    const code = u.searchParams.get('code'), state = u.searchParams.get('state');
    if (!code || !state || state !== cookie(req, 'aera_ostate')) return fail('state');
    try {
      const tok = await fetch('https://discord.com/api/v10/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: CID, client_secret: CSECRET, grant_type: 'authorization_code', code, redirect_uri: REDIRECT }) }).then(r => r.json());
      if (!tok.access_token) return fail('discord');
      const du = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: 'Bearer ' + tok.access_token } }).then(r => r.json());
      if (!du.id) return fail('discord');
      // beta role (AERA desktop only starts for beta testers): checked at sign-in, valid for SESSION_DAYS, then the game signs in again
      let mc = { beta: false, reason: 'off' };
      try { mc = await beta.memberCheck(tok.access_token); } catch (e) { mc = { beta: false, reason: 'discord' }; }
      const t = makeToken({ id: du.id, name: du.global_name || du.username, avatar: du.avatar ? `https://cdn.discordapp.com/avatars/${du.id}/${du.avatar}.png?size=64` : '', exp: Date.now() + TOKEN_DAYS * 864e5,
        beta: mc.beta ? 1 : 0, br: mc.beta ? '' : (mc.reason || 'norole'), bt: Date.now(), team: mc.team ? 1 : 0 });
      res.writeHead(302, { Location: '/aera/auth/done#t=' + t, 'Set-Cookie': `aera_ostate=; Max-Age=0; Path=/aera/auth`, 'Cache-Control': 'no-store' }); res.end();
      console.log('aera sign-in', du.username); return true;
    } catch (e) { console.warn('aera callback', e.message); return fail('discord'); }
  }
  if (p === '/aera/auth/done') {
    let ret = ''; try { ret = decodeURIComponent(cookie(req, 'aera_oret') || ''); } catch (_) { ret = ''; }
    if (!RET_OK(ret)) ret = '';
    const nonce = crypto.randomBytes(12).toString('base64');
    const js = ret ? `<script nonce="${nonce}">(function(){var h=location.hash.slice(1);if(/^(t|e)=/.test(h)){document.getElementById('m').textContent='Signed in – going back to AERA …';location.replace(${JSON.stringify(ret)}+'?'+h);}})();</script>` : '';
    const extra = ret ? { 'Set-Cookie': 'aera_oret=; Max-Age=0; Path=/aera/auth', 'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'` } : {};
    send(res, 200, page('AERA', '<p id="m">Signed in – you can close this window and go back to AERA.</p>' + js), 'text/html; charset=utf-8', extra); return true; }
  if (p === '/aera/auth/dev' && DEV) { const n = (u.searchParams.get('name') || 'Tester').slice(0, 32); const id = 'dev-' + crypto.createHash('sha1').update(n).digest('hex').slice(0, 10);
    const b = u.searchParams.get('beta'), bt = Date.now() - (u.searchParams.get('stale') ? (beta.DAYS + 1) * 864e5 : 0);
    J(200, { token: makeToken(Object.assign({ id, name: n, avatar: '', exp: Date.now() + 864e5 }, b === 'none' ? {} : { beta: b === '0' ? 0 : 1, br: b === '0' ? (u.searchParams.get('why') || 'norole') : '', bt }, u.searchParams.get('team') === '1' ? { team: 1 } : {})) }); return true; }

  if (!p.startsWith('/api/aera/')) return false;
  // ---- beta gate + auto-update (desktop app asks this before the main menu) ----
  if (p === '/api/aera/stt' && req.method === 'POST') {
    const g = gateCheck(req);
    if (!g.ok) { J(g.code, { error: g.error, reason: g.reason }); return true; }
    if (!sttTeam(g.me)) { J(403, { error: 'online recognition is only for the AERA team (just got the role? sign out and in again)', reason: 'team' }); return true; }
    if (!sttOn()) { J(503, { error: 'online speech recognition is not set up' }); return true; }
    if (!sttLimit(String(g.me.id))) { J(429, { error: 'too many transmissions – try again in a moment' }); return true; }
    const t0 = Date.now();
    try {
      const buf = await readRaw(req, 1300000);
      if (buf.length < 1000 || buf.slice(0, 4).toString() !== 'RIFF') { J(400, { error: 'no audio' }); return true; }
      const sec = (buf.length - 44) / 32000; if (sec > 30) { J(413, { error: 'transmission too long' }); return true; }
      const out = await sttRun(buf, String(u.searchParams.get('p') || '').slice(0, 900));
      STT_STATS.n++; STT_STATS.sec += sec;
      J(200, { text: out.text, ms: Date.now() - t0 });
    } catch (e) { STT_STATS.fail++; if (!res.headersSent) J(e.status || 500, { error: e.message }); }
    return true;
  }
  if (p === '/api/aera/nlu' && req.method === 'POST') {
    const g = gateCheck(req);
    if (!g.ok) { J(g.code, { error: g.error, reason: g.reason }); return true; }
    if (!sttTeam(g.me)) { J(403, { error: 'AI understanding is only for the AERA team', reason: 'team' }); return true; }
    if (!nluOn()) { J(503, { error: 'AI understanding is not set up' }); return true; }
    if (!nluLimit(String(g.me.id))) { J(429, { error: 'too many requests – try again in a moment' }); return true; }
    const t0 = Date.now(); NLU_STATS.n++;
    try {
      const raw = await readRaw(req, 24000); let body = {};
      try { body = JSON.parse(raw.toString('utf8')); } catch (_) { J(400, { error: 'bad request' }); return true; }
      if (!body.text) { J(400, { error: 'no text' }); return true; }
      const out = await nluRun(body); NLU_STATS.ok++;
      J(200, Object.assign(out, { ms: Date.now() - t0 }));
    } catch (e) { NLU_STATS.fail++; if (!res.headersSent) J(e.status || 500, { error: e.message }); }
    return true;
  }
  if (p === '/api/aera/access' || p === '/api/aera/update' || p.startsWith('/api/aera/update/file/')) {
    const g = gateCheck(req);
    if (!g.ok) { J(g.code, { error: g.error, reason: g.reason }); return true; }
    if (p === '/api/aera/access') { J(200, { ok: true, name: g.me.name, gate: GATE, stt: sttOn(), sttTeam: sttTeam(g.me), nlu: nluOn() }); return true; }
    if (p === '/api/aera/update') {
      try { J(200, HOLD.length && !HOLD.includes(String(g.me.id)) ? { update: false, held: true } : await updateInfo(String(u.searchParams.get('v') || ''))); } catch (e) { J(e.status || 500, { error: e.message }); }
      return true;
    }
    const id = p.slice('/api/aera/update/file/'.length);
    try {
      if (!/^\d+$/.test(id)) { J(404, { error: 'File not found' }); return true; }
      const ok = MOCK_UPD ? mockPipe(res, id) : await beta.pipeAsset(res, id, g.me.name);
      if (!ok) J(404, { error: 'File not found' });
    } catch (e) { if (!res.headersSent) J(e.status || 500, { error: e.message }); else res.destroy(); }
    return true;
  }
  if (p === '/api/aera/top') {
    const q = QUEUES[u.searchParams.get('q')] ? u.searchParams.get('q') : 'app';
    const list = Object.entries(DB.users).map(([id, e]) => ({ id, name: e.name, avatar: e.avatar, ...qPub(e.q[q]) })).filter(x => x.rating != null).sort((a, b) => b.rating - a.rating).slice(0, 100)
      .map((x, i) => ({ place: i + 1, name: x.name, avatar: x.avatar, rating: x.rating, rank: x.rank, code: x.code, lvl: x.lvl, shifts: x.shifts, best: x.best }));
    J(200, { q, name: QUEUES[q], week: week(), list }); return true;
  }
  if (p === '/api/aera/status') { J(200, { login: configured() || DEV, stt: sttOn(), nlu: nluOn(), ranked: true, storage: !!FILE, week: week(), queues: QUEUES, ranks: RANKS, rooms: ROOMS.size }); return true; }
  const me = bearer(req);
  if (!me) { J(401, { error: 'Not signed in' }); return true; }
  if (p === '/api/aera/me') { const e = DB.users[me.id]; J(200, { user: { id: me.id, name: me.name, avatar: me.avatar }, ranked: Object.fromEntries(Object.keys(QUEUES).map(q => [q, qPub(e && e.q[q])])) }); return true; }
  if (p === '/api/aera/ranked/start' && req.method === 'POST') {
    const b = await readJson(req); const q = String(b.q || '');
    if (!QUEUES[q]) { J(400, { error: 'unknown queue' }); return true; }
    const now = Date.now();
    for (const [id, r] of Object.entries(DB.runs)) if (now - r.at > 3 * 3600e3) delete DB.runs[id];
    if (Object.values(DB.runs).filter(r => r.user === me.id && now - r.at < 3 * 3600e3).length >= 3) { J(429, { error: 'Too many open ranked shifts – finish one first.' }); return true; }
    const id = crypto.randomBytes(9).toString('base64url'), seed = (week() * 7919 + ({ app: 3, twr: 17, fra: 29 })[q]) >>> 0;
    DB.runs[id] = { user: me.id, q, seed, at: now }; save();
    J(200, { run: id, seed, len: SHIFT, week: week() }); return true;
  }
  if (p === '/api/aera/ranked/submit' && req.method === 'POST') {
    const b = await readJson(req), run = DB.runs[String(b.run || '')];
    if (!run || run.user !== me.id) { J(400, { error: 'This ranked shift is unknown or already counted.' }); return true; }
    const s = b.stats || {}; s.q = b.q; s.seed = b.seed; s.t = +b.t; s.score = +b.score;
    const why = check(run, s, Date.now()); delete DB.runs[b.run];
    if (why.length) { save(); console.warn('ranked rejected', me.name, why.join(',')); J(400, { error: 'The shift could not be counted (' + why.join(', ') + ').' }); return true; }
    const e = userEntry(me), q = e.q[run.q] || (e.q[run.q] = { r: 0, n: 0, best: 0, hist: [] });
    const P = perf(run.q, s), before = q.n >= PLACEMENT ? Math.round(q.r) : null;
    q.n++; q.r = q.n <= PLACEMENT ? ((q.r * (q.n - 1)) + P) / q.n : q.r + 0.2 * (P - q.r);
    q.best = Math.max(q.best || 0, s.score); q.hist.push({ d: new Date().toISOString().slice(0, 10), p: P, s: s.score, r: Math.round(q.r) }); if (q.hist.length > 50) q.hist.shift();
    save();
    const pub = qPub(q), place = pub.rating == null ? null : Object.values(DB.users).filter(x => x.q[run.q] && x.q[run.q].n >= PLACEMENT && x.q[run.q].r > q.r).length + 1;
    J(200, { perf: P, before, ...pub, place }); return true;
  }
  J(404, { error: 'Not found' }); return true;
}

// ---------------- multiplayer rooms (WebSocket relay) ----------------
// The host's game runs the simulation; the server only passes messages within a room. Max. 4 controllers per room.
const ROOMS = new Map();
const BOOT = crypto.randomBytes(4).toString('hex');   // changes with every server start – clients can tell a restart from a network drop   // code -> { code, host, cfg, state, members: Map(id -> { ws, user, pos }) }
const code6 = () => { let c; do { c = Array.from(crypto.randomBytes(5), b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join(''); } while (ROOMS.has(c)); return c; };
function roomInfo(r) { return { t: 'room', code: r.code, host: r.host, state: r.state, cfg: r.cfg, members: [...r.members.values()].map(m => ({ id: m.user.id, name: m.user.name, avatar: m.user.avatar, pos: m.pos || [] })) }; }
function bcast(r, msg, except) { const s = JSON.stringify(msg); for (const m of r.members.values()) if (m.ws !== except && m.ws.readyState === 1) m.ws.send(s); }
function leave(ws) {
  const r = ws.room && ROOMS.get(ws.room); ws.room = null; if (!r) return;
  r.members.delete(ws.user.id);
  if (r.host === ws.user.id || !r.members.size) { bcast(r, { t: 'closed', why: 'host left' }); for (const m of r.members.values()) m.ws.room = null; ROOMS.delete(r.code); return; }
  bcast(r, roomInfo(r));
}
function attach(server) {
  let WSS;
  try { WSS = require('ws').WebSocketServer; } catch { console.warn('AERA multiplayer: package "ws" missing'); return; }
  const wss = new WSS({ noServer: true, perMessageDeflate: { threshold: 512 }, maxPayload: 1 << 20 });
  server.on('upgrade', (req, sock, head) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname !== '/aera/ws') { sock.destroy(); return; }
    const user = readToken(u.searchParams.get('token') || '');
    if (!user) { sock.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); sock.destroy(); return; }
    wss.handleUpgrade(req, sock, head, ws => { ws.user = user; ws.alive = true; wss.emit('connection', ws); });
  });
  wss.on('connection', ws => {
    ws.on('pong', () => { ws.alive = true; });
    ws.send(JSON.stringify({ t: 'hello', boot: BOOT, me: { id: ws.user.id, name: ws.user.name, avatar: ws.user.avatar } }));
    ws.on('message', buf => {
      let m; try { m = JSON.parse(buf); } catch { return; }
      const r = ws.room && ROOMS.get(ws.room);
      if (m.t === 'create') {
        leave(ws); let c = code6();
        // after a server restart the host brings its room back with the same code, guests then resume into it
        const want = String(m.restore || '').toUpperCase().trim(); if (/^[A-Z0-9]{5}$/.test(want) && !ROOMS.has(want)) c = want;
        const room = { code: c, host: ws.user.id, cfg: m.cfg || {}, state: m.restore && m.state === 'run' ? 'run' : 'lobby', members: new Map() };
        room.members.set(ws.user.id, { ws, user: ws.user, pos: Array.isArray(m.pos) ? m.pos.slice(0, 3) : ['TWR'] });
        ROOMS.set(c, room); ws.room = c; ws.send(JSON.stringify(roomInfo(room))); return;
      }
      if (m.t === 'join') {
        const room = ROOMS.get(String(m.code || '').toUpperCase().trim());
        if (!room) { ws.send(JSON.stringify({ t: 'err', e: 'room' })); return; }
        if (room.members.size >= 4 && !room.members.has(ws.user.id)) { ws.send(JSON.stringify({ t: 'err', e: 'full' })); return; }
        if (m.ver && room.cfg.ver && m.ver !== room.cfg.ver) { ws.send(JSON.stringify({ t: 'err', e: 'version', need: room.cfg.ver })); return; }
        leave(ws); room.members.set(ws.user.id, { ws, user: ws.user, pos: [] }); ws.room = room.code; bcast(room, roomInfo(room)); return;
      }
      if (m.t === 'resume') {   // reconnect after a dropped connection (Railway closes WebSockets after ~15 min): take the seat back
        const room = ROOMS.get(String(m.code || '').toUpperCase().trim()); let me = room && room.members.get(ws.user.id);
        if (room && !me && room.members.size < 4) {   // room was brought back by the host after a restart: take your seat again
          const taken = new Set([...room.members.values()].flatMap(x => x.pos || []));
          me = { ws, user: ws.user, pos: (Array.isArray(m.pos) ? m.pos : []).filter(x => ['DEL', 'GND', 'TWR', 'RHN', 'CTR', 'APP'].includes(x) && !taken.has(x)) }; room.members.set(ws.user.id, me);
        }
        if (!me) { ws.send(JSON.stringify({ t: 'err', e: 'room' })); return; }
        const old = me.ws; me.ws = ws; me.away = 0; ws.room = room.code; if (old && old !== ws) { old.room = null; try { old.close(); } catch {} }
        bcast(room, roomInfo(room)); return;
      }
      if (!r) return;
      if (m.t === 'leave') { leave(ws); ws.send(JSON.stringify({ t: 'left' })); return; }
      if (m.t === 'pos') { const me = r.members.get(ws.user.id); const want = (Array.isArray(m.pos) ? m.pos : []).filter(x => ['DEL', 'GND', 'TWR', 'RHN', 'CTR', 'APP'].includes(x));   // CTR/APP: "Center × Approach" rooms
        // a position belongs to one controller only
        const taken = new Set([...r.members.values()].filter(x => x !== me).flatMap(x => x.pos || []));
        me.pos = want.filter(x => !taken.has(x)); bcast(r, roomInfo(r)); return; }
      if (m.t === 'cfg' && r.host === ws.user.id) { r.cfg = Object.assign(r.cfg, m.cfg || {}); bcast(r, roomInfo(r)); return; }
      if (m.t === 'state' && r.host === ws.user.id) { r.state = m.state === 'run' ? 'run' : 'lobby'; bcast(r, roomInfo(r)); return; }
      if (m.t === 'kick' && r.host === ws.user.id) { const k = r.members.get(String(m.id)); if (k && k.ws !== ws) { k.ws.send(JSON.stringify({ t: 'closed', why: 'kicked' })); leave(k.ws); } return; }
      if (m.t === 'to') {   // relay: to = 'all' | 'host' | user id
        const out = JSON.stringify({ t: 'msg', from: ws.user.id, d: m.d });
        if (m.to === 'all') { for (const x of r.members.values()) if (x.ws !== ws && x.ws.readyState === 1) x.ws.send(out); }
        else { const x = r.members.get(m.to === 'host' ? r.host : String(m.to)); if (x && x.ws.readyState === 1) x.ws.send(out); }
      }
    });
    ws.on('close', () => {   // keep the seat for 60 s – the client reconnects and resumes
      const r = ws.room && ROOMS.get(ws.room); const me = r && r.members.get(ws.user.id);
      if (!me || me.ws !== ws) return;
      me.away = Date.now();
      setTimeout(() => { const r2 = ROOMS.get(r.code); const m2 = r2 && r2.members.get(ws.user.id); if (m2 && m2.ws === ws) leave(ws); }, 60000).unref();
    });
    ws.on('error', () => {});
  });
  setInterval(() => { for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; try { ws.ping(); } catch {} } }, 25000).unref();
  // deploy / restart (Railway sends SIGTERM): tell everyone why the room ends, save ranked data, then exit
  process.once('SIGTERM', () => {
    const msg = JSON.stringify({ t: 'closed', why: 'restart' });
    for (const ws of wss.clients) { try { ws.send(msg); } catch {} }
    try { if (dirty && FILE) { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(FILE + '.tmp', JSON.stringify(DB)); fs.renameSync(FILE + '.tmp', FILE); } } catch {}
    setTimeout(() => process.exit(0), 600);
  });
  console.log('AERA multiplayer ready on /aera/ws');
}

module.exports = { handle, attach, perf, rankOf, check, makeToken, readToken, sttStats: () => STT_STATS, nluStats: () => NLU_STATS };
