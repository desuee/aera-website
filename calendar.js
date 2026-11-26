// AERA Admin – calendar: talks CalDAV to iCloud (or any CalDAV server), so events sync with the Apple Calendar.
// Env: ICLOUD_USER (Apple ID), ICLOUD_APP_PASSWORD (app-specific password from appleid.apple.com), optional CALDAV_URL.
// No dependencies: plain fetch + a small iCalendar parser (incl. RRULE expansion) – by Desue
const crypto = require('crypto');

const fs = require('fs'), path = require('path');
const MOCK_ENV = process.env.MOCK === '1';
// The calendar from the Railway variables belongs to ONE admin login (CAL_OWNER, default: first entry of ALLOWED_USERS).
// Every other login connects its own iCloud account in the admin; those logins are stored encrypted in CAL_DATA_DIR / AERA_DATA_DIR.
const ENV_USER = (process.env.ICLOUD_USER || process.env.CALDAV_USER || '').trim();
const ENV_PASS = (process.env.ICLOUD_APP_PASSWORD || process.env.CALDAV_PASSWORD || '').replace(/\s+/g, '');
const ROOT_DEFAULT = process.env.CALDAV_URL || 'https://caldav.icloud.com/';
const OWNER = (process.env.CAL_OWNER || (process.env.ALLOWED_USERS || '').split(',')[0] || (MOCK_ENV ? 'kontakt@aerastudios.de' : '')).trim().toLowerCase();
const DATA_DIR = process.env.CAL_DATA_DIR || process.env.AERA_DATA_DIR || '';
const TZ = 'Europe/Berlin';

// ---------------------------------------------------------------- XML
function httpErr(status, msg) { const e = new Error(msg); e.status = status; return e; }
const NS = '(?:[\\w-]+:)?';
const decodeXml = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
function tag(x, name) { const m = String(x || '').match(new RegExp(`<${NS}${name}\\b[^>]*?(?:/>|>([\\s\\S]*?)</${NS}${name}\\s*>)`, 'i')); return m ? (m[1] || '') : null; }
function responses(xml) {
  const out = [], re = new RegExp(`<${NS}response\\b[^>]*>([\\s\\S]*?)</${NS}response\\s*>`, 'gi'); let m;
  while ((m = re.exec(xml))) {
    const r = m[1], href = decodeXml((tag(r, 'href') || '').trim());
    let props = ''; const ps = new RegExp(`<${NS}propstat\\b[^>]*>([\\s\\S]*?)</${NS}propstat\\s*>`, 'gi'); let p;
    while ((p = ps.exec(r))) if (/\b200\b/.test(tag(p[1], 'status') || '')) props += tag(p[1], 'prop') || '';
    if (!props && !/<\w*:?propstat/i.test(r)) props = r;
    out.push({ href, props, status: tag(r, 'status') });
  }
  return out;
}
const abs = (href, base) => new URL(href, base).href;

// ---------------------------------------------------------------- time zones
const dtf = {};
function tzOffset(ms, tz) {   // ms to add to UTC to get wall time in tz
  const f = dtf[tz] || (dtf[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}
function validTz(tz) { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return TZ; } }
const WIN_TZ = { 'W. Europe Standard Time': 'Europe/Berlin', 'Central Europe Standard Time': 'Europe/Budapest', 'GMT Standard Time': 'Europe/London', 'Pacific Standard Time': 'America/Los_Angeles', 'Eastern Standard Time': 'America/New_York', 'Central Standard Time': 'America/Chicago' };
function wallToUtc(y, mo, d, h, mi, s, tz) {   // wall-clock time in tz -> epoch ms
  const guess = Date.UTC(y, mo, d, h, mi, s);
  let t = guess - tzOffset(guess, tz);
  const o2 = tzOffset(t, tz); if (guess - o2 !== t) t = guess - o2;
  return t;
}
function wallOf(ms, tz) { const w = new Date(ms + tzOffset(ms, tz)); return { y: w.getUTCFullYear(), mo: w.getUTCMonth(), d: w.getUTCDate(), h: w.getUTCHours(), mi: w.getUTCMinutes(), s: w.getUTCSeconds() }; }

// ---------------------------------------------------------------- iCalendar
const unfold = t => String(t || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
function parseLine(line) {
  let i = 0, q = false; for (; i < line.length; i++) { const c = line[i]; if (c === '"') q = !q; else if (c === ':' && !q) break; }
  const head = line.slice(0, i), value = line.slice(i + 1), parts = head.match(/(?:[^;"]|"[^"]*")+/g) || [''];
  const params = {}; for (const p of parts.slice(1)) { const k = p.indexOf('='); if (k > 0) params[p.slice(0, k).toUpperCase()] = p.slice(k + 1).replace(/^"|"$/g, ''); }
  return { name: parts[0].toUpperCase(), params, value };
}
function parseIcs(text) {   // -> tree of { type, props: [{name, params, value}], children }
  const root = { type: 'ROOT', props: [], children: [] }, stack = [root];
  for (const line of unfold(text).split('\n')) {
    if (!line.trim()) continue;
    const p = parseLine(line), top = stack[stack.length - 1];
    if (p.name === 'BEGIN') { const c = { type: p.value.toUpperCase().trim(), props: [], children: [] }; top.children.push(c); stack.push(c); }
    else if (p.name === 'END') { if (stack.length > 1) stack.pop(); }
    else top.props.push(p);
  }
  return root;
}
const prop = (c, n) => c.props.find(p => p.name === n);
const unesc = v => String(v || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
const escTxt = v => String(v || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
function parseDate(p) {   // -> { ms, allDay, tz, wall }
  if (!p) return null;
  const v = p.value.trim(), m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2] - 1, +m[3]];
  if (!m[4] || p.params.VALUE === 'DATE') return { allDay: true, ms: Date.UTC(y, mo, d), y, mo, d };
  const h = +m[4], mi = +m[5], s = +(m[6] || 0);
  if (m[7]) return { ms: Date.UTC(y, mo, d, h, mi, s), tz: 'UTC' };
  const tz = validTz(WIN_TZ[p.params.TZID] || (p.params.TZID || TZ).replace(/^\/[^/]+\/[^/]+\//, ''));
  return { ms: wallToUtc(y, mo, d, h, mi, s, tz), tz };
}
function parseDuration(v) {
  const m = String(v || '').match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  const ms = (((+m[2] || 0) * 7 + (+m[3] || 0)) * 86400 + (+m[4] || 0) * 3600 + (+m[5] || 0) * 60 + (+m[6] || 0)) * 1000;
  return m[1] === '-' ? -ms : ms;
}
const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const ymd = ms => new Date(ms).toISOString().slice(0, 10);

function eventOf(v, cal, href, etag) {
  const st = parseDate(prop(v, 'DTSTART')); if (!st) return null;
  let en = parseDate(prop(v, 'DTEND'));
  const dur = prop(v, 'DURATION') ? parseDuration(prop(v, 'DURATION').value) : null;
  const endMs = en ? en.ms : dur != null ? st.ms + dur : st.allDay ? st.ms + 864e5 : st.ms;
  const alarm = v.children.filter(c => c.type === 'VALARM').map(a => prop(a, 'TRIGGER')).filter(t => t && !t.params.VALUE).map(t => -parseDuration(t.value) / 60000)[0];
  return {
    cal, href, etag, uid: (prop(v, 'UID') || {}).value || '', title: unesc((prop(v, 'SUMMARY') || {}).value) || '(ohne Titel)',
    location: unesc((prop(v, 'LOCATION') || {}).value), notes: unesc((prop(v, 'DESCRIPTION') || {}).value), url: (prop(v, 'URL') || {}).value || '',
    allDay: !!st.allDay, startMs: st.ms, endMs: Math.max(endMs, st.ms), tz: st.tz, alarm: alarm == null ? null : alarm,
    status: ((prop(v, 'STATUS') || {}).value || '').toUpperCase(),
  };
}
// expand one VEVENT master (+ overrides) into instances overlapping [from, to)
function expand(master, overrides, from, to) {
  const rr = prop(master.v, 'RRULE'), base = master.ev, len = base.endMs - base.startMs;
  const inRange = s => s < to && (s + Math.max(len, 1)) > from;
  if (!rr) return inRange(base.startMs) ? [base] : [];
  const R = Object.fromEntries(rr.value.split(';').map(x => x.split('=')).map(([k, v]) => [k.toUpperCase(), v]));
  const freq = R.FREQ, iv = Math.max(1, +R.INTERVAL || 1), count = +R.COUNT || 0;
  const until = R.UNTIL ? parseDate({ value: R.UNTIL, params: R.UNTIL.length === 8 ? { VALUE: 'DATE' } : {} }) : null;
  const untilMs = until ? (until.allDay ? until.ms + 864e5 - 1 : until.ms) : Infinity;
  const ex = new Set(master.v.props.filter(p => p.name === 'EXDATE').flatMap(p => p.value.split(',').map(x => (parseDate({ ...p, value: x }) || {}).ms)));
  const ov = new Map(overrides.map(o => [o.rid, o.ev]));
  const tz = base.allDay ? 'UTC' : base.tz === 'UTC' ? TZ : base.tz;
  const w0 = base.allDay ? { ...wallOf(base.startMs, 'UTC') } : wallOf(base.startMs, tz);
  const at = (y, mo, d) => base.allDay ? Date.UTC(y, mo, d) : wallToUtc(y, mo, d, w0.h, w0.mi, w0.s, tz);
  const byDay = (R.BYDAY || '').split(',').filter(Boolean).map(s => { const m = s.match(/^([+-]?\d+)?(MO|TU|WE|TH|FR|SA|SU)$/); return m ? { n: m[1] ? +m[1] : 0, wd: DAYS.indexOf(m[2]) } : null; }).filter(Boolean);
  const byMonthDay = (R.BYMONTHDAY || '').split(',').filter(Boolean).map(Number);
  const byMonth = (R.BYMONTH || '').split(',').filter(Boolean).map(n => +n - 1);
  const out = []; let n = 0, guard = 0;
  const emit = s => {
    if (s < base.startMs || s > untilMs) return false;
    n++; if (count && n > count) return true;
    if (!ex.has(s)) { const o = ov.get(s); if (o) { if (inRange(o.startMs)) out.push(o); } else if (inRange(s)) out.push({ ...base, startMs: s, endMs: s + len }); }
    return false;
  };
  const dim = (y, mo) => new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  let y = w0.y, mo = w0.mo, d = w0.d;
  if (!count && (freq === 'DAILY' || freq === 'WEEKLY')) {   // jump close to the window instead of walking years of a daily series
    const step = (freq === 'DAILY' ? 1 : 7) * iv, k = Math.floor((from - base.startMs) / (step * 864e5)) - 1;
    if (k > 0) { const t = new Date(Date.UTC(y, mo, d + k * step)); y = t.getUTCFullYear(); mo = t.getUTCMonth(); d = t.getUTCDate(); }
  }
  while (guard++ < 5000) {
    let cands = [];
    if (freq === 'DAILY') cands = [at(y, mo, d)];
    else if (freq === 'WEEKLY') {
      const dow = new Date(Date.UTC(y, mo, d)).getUTCDay(), wkst = DAYS.indexOf(R.WKST || 'MO'), off = (dow - wkst + 7) % 7;
      const days = byDay.length ? byDay.map(b => b.wd) : [new Date(Date.UTC(w0.y, w0.mo, w0.d)).getUTCDay()];
      cands = days.map(wd => (wd - wkst + 7) % 7).sort((a, b) => a - b).map(k => { const t = new Date(Date.UTC(y, mo, d - off + k)); return at(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()); });
    } else if (freq === 'MONTHLY' || freq === 'YEARLY') {
      const months = freq === 'YEARLY' ? (byMonth.length ? byMonth : [w0.mo]) : [mo];
      for (const m of months) {
        const nd = dim(y, m); let ds = [];
        if (byMonthDay.length) ds = byMonthDay.map(x => x < 0 ? nd + x + 1 : x).filter(x => x >= 1 && x <= nd);
        else if (byDay.length) for (const b of byDay) {
          const all = []; for (let x = 1; x <= nd; x++) if (new Date(Date.UTC(y, m, x)).getUTCDay() === b.wd) all.push(x);
          if (!b.n) ds.push(...all); else { const pick = b.n > 0 ? all[b.n - 1] : all[all.length + b.n]; if (pick) ds.push(pick); }
        } else if (w0.d <= nd) ds = [w0.d];
        ds.sort((a, b) => a - b).forEach(x => cands.push(at(y, m, x)));
      }
    } else break;
    let stop = false;
    for (const s of cands.sort((a, b) => a - b)) { if (emit(s)) { stop = true; break; } }
    if (stop || cands.some(s => s > untilMs) || (cands.length && Math.min(...cands) >= to)) break;
    if (freq === 'DAILY') { const t = new Date(Date.UTC(y, mo, d + iv)); y = t.getUTCFullYear(); mo = t.getUTCMonth(); d = t.getUTCDate(); }
    else if (freq === 'WEEKLY') { const t = new Date(Date.UTC(y, mo, d + 7 * iv)); y = t.getUTCFullYear(); mo = t.getUTCMonth(); d = t.getUTCDate(); }
    else if (freq === 'MONTHLY') { const t = new Date(Date.UTC(y, mo + iv, 1)); y = t.getUTCFullYear(); mo = t.getUTCMonth(); }
    else y += iv;
  }
  return out;
}
function eventsFromIcs(text, cal, href, etag, from, to) {
  const root = parseIcs(text), cal0 = root.children.find(c => c.type === 'VCALENDAR') || root;
  const vs = cal0.children.filter(c => c.type === 'VEVENT'), masters = [], overrides = [];
  for (const v of vs) {
    const ev = eventOf(v, cal, href, etag); if (!ev) continue;
    const rid = prop(v, 'RECURRENCE-ID');
    if (rid) overrides.push({ rid: (parseDate(rid) || {}).ms, ev: { ...ev, recurring: true } });
    else masters.push({ v, ev: { ...ev, recurring: !!prop(v, 'RRULE') } });
  }
  if (!masters.length) return overrides.map(o => o.ev).filter(e => e.startMs < to && e.endMs > from);
  return masters.flatMap(m => expand(m, overrides.filter(o => o.ev.uid === m.ev.uid), from, to)).filter(e => e.status !== 'CANCELLED');
}

// ---------------------------------------------------------------- writing
const icsDate = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsDay = s => s.replace(/-/g, '');
function fold(line) { const b = Buffer.from(line, 'utf8'); if (b.length <= 75) return line; const out = []; let cur = ''; for (const ch of line) { if (Buffer.byteLength(cur + ch) > (out.length ? 74 : 75)) { out.push(cur); cur = ''; } cur += ch; } out.push(cur); return out.join('\r\n '); }
function eventLines(e, now) {
  const L = [];
  L.push('SUMMARY:' + escTxt(e.title || 'Termin'));
  if (e.allDay) { L.push('DTSTART;VALUE=DATE:' + icsDay(e.startDay)); L.push('DTEND;VALUE=DATE:' + icsDay(e.endDay)); }
  else { L.push('DTSTART:' + icsDate(e.startMs)); L.push('DTEND:' + icsDate(e.endMs)); }
  if (e.location) L.push('LOCATION:' + escTxt(e.location));
  if (e.notes) L.push('DESCRIPTION:' + escTxt(e.notes));
  L.push('DTSTAMP:' + icsDate(now), 'LAST-MODIFIED:' + icsDate(now));
  return L;
}
function alarmLines(min) { return min == null || min < 0 ? [] : ['BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Erinnerung', 'TRIGGER:' + (min === 0 ? 'PT0S' : '-PT' + Math.round(min) + 'M'), 'END:VALARM']; }
function buildIcs(e, uid) {
  const now = Date.now();
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//aerastudios.de//Admin//DE', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', 'UID:' + uid, 'CREATED:' + icsDate(now), 'SEQUENCE:0',
    ...eventLines(e, now), ...alarmLines(e.alarm), 'END:VEVENT', 'END:VCALENDAR', ''].map(fold).join('\r\n');
}
// change a stored event in place: keep everything we do not edit (attendees, URL, other alarms' settings …)
const EDITED = new Set(['SUMMARY', 'DTSTART', 'DTEND', 'DURATION', 'LOCATION', 'DESCRIPTION', 'DTSTAMP', 'LAST-MODIFIED', 'SEQUENCE']);
function patchIcs(text, e) {
  const lines = unfold(text).split('\n'), out = []; let depth = 0, inEv = false, done = false, seq = 0, skipAlarm = false;
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const p = parseLine(raw);
    if (p.name === 'BEGIN' && p.value.toUpperCase() === 'VEVENT' && !done) { inEv = true; depth = 0; out.push(raw); continue; }
    if (inEv) {
      if (p.name === 'BEGIN') { depth++; if (p.value.toUpperCase() === 'VALARM' && depth === 1 && e.alarm !== undefined) { skipAlarm = true; continue; } }
      if (skipAlarm) { if (p.name === 'END' && p.value.toUpperCase() === 'VALARM' && depth === 1) { skipAlarm = false; depth--; } continue; }
      if (p.name === 'END') { if (depth === 0) { out.push(...eventLines(e, Date.now()), 'SEQUENCE:' + (seq + 1), ...(e.alarm !== undefined ? alarmLines(e.alarm) : []), raw); inEv = false; done = true; continue; } depth--; }
      if (depth === 0 && EDITED.has(p.name)) { if (p.name === 'SEQUENCE') seq = +p.value || 0; continue; }
    }
    out.push(raw);
  }
  return out.map(fold).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- one CalDAV account (iCloud or other server)
function createAccount(USER, PASS, ROOT, MOCK) {
  const configured = true;
async function dav(method, url, body, headers = {}) {
  let u = url;
  for (let i = 0; i < 4; i++) {   // follow redirects by hand: fetch drops the Authorization header on cross-host redirects
    const r = await fetch(u, {
      method, body, redirect: 'manual', signal: AbortSignal.timeout(20000),
      headers: { Authorization: 'Basic ' + Buffer.from(USER + ':' + PASS).toString('base64'), 'User-Agent': 'aera-admin/1.0', ...(body && !headers['Content-Type'] ? { 'Content-Type': 'application/xml; charset=utf-8' } : {}), ...headers },
    });
    if ([301, 302, 307, 308].includes(r.status) && r.headers.get('location')) { u = new URL(r.headers.get('location'), u).href; continue; }
    const text = await r.text();
    if (r.status === 401) throw httpErr(401, 'iCloud hat die Anmeldung abgelehnt – App-spezifisches Passwort prüfen.');
    return { status: r.status, text, etag: r.headers.get('etag'), url: u };
  }
  throw httpErr(502, 'Zu viele Weiterleitungen vom Kalender-Server');
}
// ---------------------------------------------------------------- discovery
let disc = null;
async function discover(force) {
  if (disc && !force && Date.now() - disc.at < 10 * 60e3) return disc;
  const p1 = await dav('PROPFIND', ROOT, '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>', { Depth: '0' });
  const pr = tag(tag(p1.text, 'current-user-principal'), 'href');
  if (!pr) throw httpErr(502, 'Kalender-Server: kein Benutzerkonto gefunden (' + p1.status + ')');
  const principal = abs(decodeXml(pr.trim()), p1.url);
  const p2 = await dav('PROPFIND', principal, '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>', { Depth: '0' });
  const hh = tag(tag(p2.text, 'calendar-home-set'), 'href');
  if (!hh) throw httpErr(502, 'Kalender-Server: keine Kalender gefunden (' + p2.status + ')');
  const home = abs(decodeXml(hh.trim()), p2.url);
  const p3 = await dav('PROPFIND', home, `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/" xmlns:cs="http://calendarserver.org/ns/">
<d:prop><d:displayname/><d:resourcetype/><a:calendar-color/><a:calendar-order/><c:supported-calendar-component-set/><d:current-user-privilege-set/><cs:getctag/></d:prop></d:propfind>`, { Depth: '1' });
  const cals = [], seen = [], names = x => (String(x || '').match(/<([\w-]+:)?[\w-]+/g) || []).map(t => t.replace(/^<([\w-]+:)?/, '')).filter(n => !/^(privilege|prop)$/.test(n));
  for (const r of responses(p3.text)) {
    const rt = tag(r.props, 'resourcetype') || '', comps = tag(r.props, 'supported-calendar-component-set'), priv = tag(r.props, 'current-user-privilege-set');
    const info = { href: r.href.replace(/\d{4,}/g, '…'), name: decodeXml(tag(r.props, 'displayname') || '').trim(), type: names(rt), comps: comps == null ? null : (comps.match(/V[A-Z]+/g) || []), priv: priv == null ? null : names(priv) };
    const isCal = info.type.includes('calendar'), events = !comps || /VEVENT/i.test(comps);
    // write access: anything beyond plain reading (write, write-content, bind, all …). No privilege info = assume writable.
    const readOnly = priv != null && info.priv.length > 0 && !info.priv.some(n => /^(write|write-content|bind|all)$/i.test(n));
    seen.push({ ...info, used: isCal && events, readOnly });
    if (!isCal || !events) continue;   // skip reminders lists, inbox/outbox, notifications
    const color = ((tag(r.props, 'calendar-color') || '').trim().match(/#[0-9a-f]{6}/i) || ['#3b82f6'])[0];
    cals.push({ id: abs(r.href, p3.url), name: info.name || 'Kalender', color, readOnly, order: +(tag(r.props, 'calendar-order') || 99) });
  }
  cals.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  return (disc = { at: Date.now(), home, cals, debug: { home: home.replace(/\d{4,}/g, '…'), status: [p1.status, p2.status, p3.status], bytes: p3.text.length, responses: seen, sample: seen.length ? '' : p3.text.slice(0, 1500).replace(/\d{4,}/g, '…') } });
}

// ---------------------------------------------------------------- demo data (MOCK=1)
let mockStore = null;
function mockInit() {
  if (mockStore) return mockStore;
  const D = (dd, h, m) => { const n = new Date(); return wallToUtc(n.getFullYear(), n.getMonth(), n.getDate() + dd, h, m, 0, TZ); };
  const day = dd => { const n = new Date(); return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate() + dd)).toISOString().slice(0, 10); };
  const cals = [{ id: 'mock://privat/', name: 'Privat', color: '#3b82f6', readOnly: false, order: 1 }, { id: 'mock://aera/', name: 'AERA', color: '#f59e0b', readOnly: false, order: 2 }, { id: 'mock://feiertage/', name: 'Feiertage', color: '#ef4444', readOnly: true, order: 3 }];
  const items = {};
  const put = (cal, e, extra) => { const uid = crypto.randomUUID(); let ics = buildIcs(e, uid); if (extra) ics = ics.replace('END:VEVENT', extra + '\r\nEND:VEVENT'); items[cal + uid + '.ics'] = { cal, ics, etag: '"' + crypto.randomBytes(4).toString('hex') + '"' }; };
  put('mock://aera/', { title: 'AERA Dev-Stream', startMs: D(0, 19, 0), endMs: D(0, 21, 0), location: 'Twitch', alarm: 15 });
  put('mock://privat/', { title: 'Zahnarzt', startMs: D(1, 9, 30), endMs: D(1, 10, 15), location: 'Praxis Dr. Weber' });
  put('mock://aera/', { title: 'Kennenlernen: Max (Social Media)', startMs: D(2, 18, 0), endMs: D(2, 18, 30), location: 'AERA-Discord', notes: 'max@example.com · Discord: maxm' });
  put('mock://aera/', { title: 'Team-Meeting', startMs: D(-3, 20, 0), endMs: D(-3, 21, 0), location: 'Discord' }, 'RRULE:FREQ=WEEKLY;INTERVAL=1');
  put('mock://privat/', { title: 'Urlaub', allDay: true, startDay: day(9), endDay: day(13) });
  put('mock://feiertage/', { title: 'Feiertag (Demo)', allDay: true, startDay: day(5), endDay: day(6) });
  return (mockStore = { cals, items });
}

// ---------------------------------------------------------------- public API
const cache = new Map();
async function calendars() {
  if (MOCK) return mockInit().cals;
  return (await discover()).cals;
}
async function events(fromMs, toMs) {
  if (!configured) return { events: [], calendars: [] };
  const key = fromMs + ':' + toMs, hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60e3) return hit.v;
  const cals = await calendars(), out = [], errors = [];
  if (MOCK) for (const [href, it] of Object.entries(mockInit().items)) out.push(...eventsFromIcs(it.ics, it.cal, href, it.etag, fromMs, toMs));
  else await Promise.all(cals.map(async c => {
    try {
      const r = await dav('REPORT', c.id, `<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop>
<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${icsDate(fromMs)}" end="${icsDate(toMs)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`, { Depth: '1' });
      if (r.status >= 400) throw new Error('HTTP ' + r.status);
      for (const x of responses(r.text)) { const data = tag(x.props, 'calendar-data'); if (data) out.push(...eventsFromIcs(decodeXml(data), c.id, abs(x.href, r.url), decodeXml(tag(x.props, 'getetag') || '').trim(), fromMs, toMs)); }
    } catch (e) { errors.push(c.name + ': ' + e.message); }
  }));
  const v = { calendars: cals, errors, events: out.map(e => ({ id: e.href + '#' + e.startMs, href: e.href, etag: e.etag, cal: e.cal, title: e.title, location: e.location, notes: e.notes, url: e.url, allDay: e.allDay, recurring: !!e.recurring, alarm: e.alarm,
    start: e.allDay ? ymd(e.startMs) : new Date(e.startMs).toISOString(), end: e.allDay ? ymd(e.endMs) : new Date(e.endMs).toISOString() })).sort((a, b) => a.start < b.start ? -1 : 1) };
  cache.set(key, { at: Date.now(), v }); if (cache.size > 30) cache.delete(cache.keys().next().value);
  return v;
}
function clean(b) {
  const e = { title: String(b.title || '').slice(0, 300).trim() || 'Termin', location: String(b.location || '').slice(0, 300), notes: String(b.notes || '').slice(0, 5000), allDay: !!b.allDay, alarm: b.alarm === null || b.alarm === '' || b.alarm === undefined ? -1 : Math.max(0, Math.min(40320, +b.alarm || 0)) };
  if (e.allDay) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(b.end || '')) throw httpErr(400, 'Datum fehlt');
    e.startDay = b.start; e.endDay = b.end > b.start ? b.end : ymd(Date.parse(b.start) + 864e5);
  } else {
    e.startMs = Date.parse(b.start); e.endMs = Date.parse(b.end);
    if (!isFinite(e.startMs) || !isFinite(e.endMs)) throw httpErr(400, 'Datum/Uhrzeit fehlt');
    if (e.endMs <= e.startMs) e.endMs = e.startMs + 30 * 60e3;
  }
  return e;
}
async function save(b) {
  if (!configured) throw httpErr(400, 'Kalender ist nicht verbunden');
  const e = clean(b), cals = await calendars(), cal = cals.find(c => c.id === b.cal);
  if (!cal) throw httpErr(400, 'Kalender nicht gefunden');
  if (cal.readOnly) throw httpErr(400, `„${cal.name}“ ist schreibgeschützt`);
  cache.clear();
  if (MOCK) {
    const S = mockInit();
    if (b.href && S.items[b.href]) {
      const it = S.items[b.href]; if (b.etag && b.etag !== it.etag) throw httpErr(409, 'Der Termin wurde inzwischen geändert – bitte neu laden.');
      let ics = patchIcs(it.ics, e); delete S.items[b.href];
      const href = cal.id + b.href.split('/').pop(); S.items[href] = { cal: cal.id, ics, etag: '"' + crypto.randomBytes(4).toString('hex') + '"' };
      return { ok: true, href };
    }
    const uid = crypto.randomUUID(), href = cal.id + uid + '.ics';
    S.items[href] = { cal: cal.id, ics: buildIcs(e, uid), etag: '"' + crypto.randomBytes(4).toString('hex') + '"' };
    return { ok: true, href };
  }
  if (b.href) {   // update: patch the stored file so attendees/extra fields survive
    const g = await dav('GET', b.href, undefined, { Accept: 'text/calendar' });
    if (g.status >= 400) throw httpErr(g.status === 404 ? 404 : 502, g.status === 404 ? 'Termin gibt es nicht mehr – bitte neu laden.' : 'Termin konnte nicht geladen werden (' + g.status + ')');
    if (/RRULE:/i.test(unfold(g.text))) throw httpErr(400, 'Wiederkehrende Termine bitte in der Kalender-App bearbeiten.');
    const ics = patchIcs(g.text, e), sameCal = b.href.startsWith(cal.id);
    if (sameCal) {
      const r = await dav('PUT', b.href, ics, { 'Content-Type': 'text/calendar; charset=utf-8', ...(g.etag ? { 'If-Match': g.etag } : {}) });
      if (r.status === 412) throw httpErr(409, 'Der Termin wurde inzwischen geändert – bitte neu laden.');
      if (r.status >= 400) throw httpErr(502, 'Speichern fehlgeschlagen (' + r.status + ')');
      return { ok: true, href: b.href };
    }
    const href = cal.id + b.href.split('/').pop();   // moved to another calendar: create there, then remove the old one
    const r = await dav('PUT', href, ics, { 'Content-Type': 'text/calendar; charset=utf-8', 'If-None-Match': '*' });
    if (r.status >= 400) throw httpErr(502, 'Verschieben fehlgeschlagen (' + r.status + ')');
    await dav('DELETE', b.href, undefined, g.etag ? { 'If-Match': g.etag } : {});
    return { ok: true, href };
  }
  const uid = crypto.randomUUID().toUpperCase(), href = cal.id + uid + '.ics';
  const r = await dav('PUT', href, buildIcs(e, uid), { 'Content-Type': 'text/calendar; charset=utf-8', 'If-None-Match': '*' });
  if (r.status >= 400) throw httpErr(502, 'Anlegen fehlgeschlagen (' + r.status + ')');
  return { ok: true, href };
}
async function remove(b) {
  if (!configured) throw httpErr(400, 'Kalender ist nicht verbunden');
  const href = String(b.href || ''); if (!href) throw httpErr(400, 'Termin fehlt');
  const cals = await calendars(), cal = cals.find(c => href.startsWith(c.id));
  if (!cal) throw httpErr(400, 'Kalender nicht gefunden'); if (cal.readOnly) throw httpErr(400, `„${cal.name}“ ist schreibgeschützt`);
  cache.clear();
  if (MOCK) { delete mockInit().items[href]; return { ok: true }; }
  const r = await dav('DELETE', href, undefined, b.etag ? { 'If-Match': b.etag } : {});
  if (r.status === 412) throw httpErr(409, 'Der Termin wurde inzwischen geändert – bitte neu laden.');
  if (r.status >= 400 && r.status !== 404) throw httpErr(502, 'Löschen fehlgeschlagen (' + r.status + ')');
  return { ok: true };
}
async function upcoming(n = 5) {
  if (!configured) return { configured: false };
  const from = Date.now() - 2 * 3600e3, d = new Date(), to = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 15);
  const v = await events(from, to), now = Date.now();
  return { configured: true, calendars: v.calendars, events: v.events.filter(e => Date.parse(e.end + (e.allDay ? 'T00:00:00Z' : '')) > now).slice(0, n) };
}

  return { user: USER, mock: MOCK, discover, calendars, events, save, remove, upcoming, clearCache: () => cache.clear() };
}

// ---------------------------------------------------------------- per-login accounts
let KEY = crypto.randomBytes(32);
const FILE = DATA_DIR ? path.join(DATA_DIR, 'admin-calendars.json') : '';
let store = {};   // admin login -> { u: Apple ID, p: encrypted app password, url, at }
function init(o = {}) {
  if (o.key) KEY = crypto.createHash('sha256').update('dsue-cal-v1|').update(o.key).digest();
  if (FILE) try { store = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch { store = {}; }
}
function persist() { if (!FILE) return; try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(FILE + '.tmp', JSON.stringify(store)); fs.renameSync(FILE + '.tmp', FILE); } catch (e) { console.warn('calendar save', e.message); } }
const enc = t => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', KEY, iv); return Buffer.concat([iv, c.update(t, 'utf8'), c.final(), c.getAuthTag()]).toString('base64'); };
const dec = t => { const b = Buffer.from(t, 'base64'), d = crypto.createDecipheriv('aes-256-gcm', KEY, b.subarray(0, 12)); d.setAuthTag(b.subarray(b.length - 16)); return Buffer.concat([d.update(b.subarray(12, b.length - 16)), d.final()]).toString('utf8'); };
const accts = new Map();
const mask = u => String(u || '').replace(/^(.).*(@.*)$/, '$1…$2');
const isDemo = u => MOCK_ENV && /^demo(@|$)/i.test(u || '');
function accountFor(login) {
  login = String(login || '').toLowerCase();
  if (login && login === OWNER && (MOCK_ENV || (ENV_USER && ENV_PASS))) {
    const k = 'env'; if (!accts.has(k)) accts.set(k, { src: 'env', a: createAccount(MOCK_ENV ? 'demo@icloud.com' : ENV_USER, ENV_PASS, ROOT_DEFAULT, MOCK_ENV) }); return accts.get(k);
  }
  const s = store[login]; if (!s) return null;
  const k = 'u:' + login + ':' + s.at;
  if (!accts.has(k)) { let pw; try { pw = dec(s.p); } catch { return null; } accts.set(k, { src: 'own', a: createAccount(s.u, pw, s.url || ROOT_DEFAULT, isDemo(s.u)) }); }
  return accts.get(k);
}
const isConfigured = login => !!accountFor(login);
async function upcoming(login, n = 5) { const x = accountFor(login); return x ? x.a.upcoming(n) : { configured: false }; }

async function handle(req, res, u, p, send, readJson, login) {
  login = String(login || '').toLowerCase();
  if (req.method === 'POST' && p === '/api/cal/connect') {   // connect this login's own iCloud / CalDAV account
    const b = await readJson(req);
    const user = String(b.user || '').trim(), pw = String(b.pass || '').replace(/\s+/g, ''), url = String(b.url || '').trim();
    if (!user || !pw) return send(res, 400, { error: 'Apple-ID und App-Passwort eingeben' });
    if (url && !/^https:\/\/[^\s/]+/i.test(url)) return send(res, 400, { error: 'Server-Adresse muss mit https:// beginnen' });
    const test = createAccount(user, pw, url || ROOT_DEFAULT, isDemo(user));
    let cals; try { cals = test.mock ? await test.calendars() : (await test.discover(true)).cals; } catch (e) { return send(res, 400, { error: e.status === 401 ? 'Anmeldung abgelehnt – Apple-ID oder App-Passwort stimmt nicht.' : e.message }); }
    if (!cals.length) return send(res, 400, { error: 'Verbunden, aber keine Kalender gefunden.' });
    store[login] = { u: user, p: enc(pw), url: url || '', at: Date.now() }; persist();
    return send(res, 200, { ok: true, calendars: cals.length, persist: !!FILE });
  }
  if (req.method === 'POST' && p === '/api/cal/disconnect') {
    if (!store[login]) return send(res, 400, { error: 'Dieser Kalender kommt aus den Railway-Variablen und lässt sich hier nicht trennen.' });
    delete store[login]; persist(); for (const k of accts.keys()) if (k.startsWith('u:' + login + ':')) accts.delete(k);
    return send(res, 200, { ok: true });
  }
  const x = accountFor(login), A = x && x.a;
  if (p === '/api/cal/status') {
    if (!A) return send(res, 200, { configured: false, persist: !!FILE });
    const base = { configured: true, mock: A.mock, source: x.src, canDisconnect: x.src === 'own', persist: !!FILE, user: A.mock ? 'demo@icloud.com' : mask(A.user) };
    try { return send(res, 200, { ...base, calendars: await A.calendars() }); }
    catch (e) { return send(res, 200, { ...base, error: e.message }); }
  }
  if (!A) return send(res, 200, { configured: false, events: [], calendars: [] });
  if (p === '/api/cal/debug') {   // what the server answered while looking for calendars (no passwords, long numbers masked)
    try { const d = await A.discover(true); A.clearCache(); return send(res, 200, { configured: true, user: mask(A.user), calendars: d.cals.map(c => ({ name: c.name, readOnly: c.readOnly })), ...(d.debug || {}) }); }
    catch (e) { return send(res, 200, { configured: true, error: e.message }); }
  }
  if (p === '/api/cal/events') {
    const from = Date.parse(u.searchParams.get('from')), to = Date.parse(u.searchParams.get('to'));
    if (!isFinite(from) || !isFinite(to) || to <= from || to - from > 100 * 864e5) return send(res, 400, { error: 'Zeitraum ungültig' });
    if (u.searchParams.get('fresh')) A.clearCache();
    return send(res, 200, { configured: true, ...(await A.events(from, to)) });
  }
  if (req.method === 'POST' && p === '/api/cal/save') return send(res, 200, await A.save(await readJson(req)));
  if (req.method === 'POST' && p === '/api/cal/delete') return send(res, 200, await A.remove(await readJson(req)));
  return send(res, 404, { error: 'Not found' });
}

module.exports = { init, isConfigured, handle, upcoming, OWNER, _t: { parseIcs, eventsFromIcs, responses, tag, decodeXml, patchIcs, buildIcs, wallToUtc } };
