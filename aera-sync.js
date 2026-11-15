// dev-dsue.de – AERA changelog straight from the GitHub releases of the beta repository – by Desue
//
// Publish a release in BETA_REPO (default desuee/aera-beta) with the changelog as its text – the website picks it up
// within a few minutes (or at once with the webhook below). No more typing it into /admin/studio.
// The release text uses the usual website format, e.g.
//   AERA 0.11.1 – AERA look
//   Neu / New
//   - Deutscher Punkt
//     English point
//   Verbessert / Improved
//   - …
// If the text contains a ``` code block, only the first code block is used (so a Discord part below it is ignored).
// A version that was entered by hand in the Studio always wins over the release text.
//
// Environment:
//   BETA_REPO               default desuee/aera-beta
//   BETA_GITHUB_TOKEN       token with Contents: Read for BETA_REPO (already set for /beta)
//   RELEASE_WEBHOOK_SECRET  optional – GitHub webhook "Releases" → POST https://www.dev-dsue.de/hooks/aera-release
//   CHANGELOG_SYNC_MIN      poll interval in minutes, default 5
const crypto = require('crypto');
const REPO = process.env.BETA_REPO || 'desuee/aera-beta';
const TOKEN = process.env.BETA_GITHUB_TOKEN || process.env.GITHUB_TOKEN || '';
const SECRET = process.env.RELEASE_WEBHOOK_SECRET || '';
const EVERY = Math.max(1, +process.env.CHANGELOG_SYNC_MIN || 5) * 60000;
let DATE = '';
const today = () => DATE;

const HEAD = [
  [/^(verbessert\s*[\/&+]\s*behoben|improved\s*[\/&+]\s*fixed|improvements?\s*[\/&+]\s*fixes)$/i, 'impfix'],
  [/^(neu|new|neue features?|new features?|added|hinzugefügt)$/i, 'new'],
  [/^(verbessert|verbesserungen|improved|improvements?|geändert|changed|changes|änderungen)$/i, 'imp'],
  [/^(behoben|fehlerbehebungen|bugfixes|fixed|fixes|bug fixes)$/i, 'fix'],
  [/^(erste version|first version|first release|erstes release)$/i, 'first'],
];
const EN_HEAD = /^(new|new features?|added|improved|improvements?|changed|changes|fixed|fixes|bug ?fixes|first version|first release|improved\s*[\/&+]\s*fixed)$/i;
function kindOf(t) { const h = HEAD.find(x => x[0].test(t)); return h ? h[1] : null; }
// "Neu / New" → same kind in both languages (bilingual block); "Verbessert / Behoben" → impfix
function headOf(plain) {
  const k = kindOf(plain); if (k) return { kind: k, bi: false };
  const parts = plain.split(/\s*[\/|]\s*/);
  if (parts.length === 2) {
    const a = kindOf(parts[0]), b = kindOf(parts[1]);
    if (a && b) return a === b ? { kind: a, bi: true } : { kind: (a === 'imp' && b === 'fix') || (a === 'fix' && b === 'imp') ? 'impfix' : a, bi: false };
  }
  if (parts.length === 4) { const a = kindOf(parts[0] + ' / ' + parts[1]); if (a) return { kind: a, bi: true }; }
  return null;
}
function parseText(txt) {
  const blocks = []; let cur = null, lang = null, sec = null, item = null, last = null;
  const start = (version, title) => { cur = { version, title, lang, bi: false, sections: [] }; blocks.push(cur); sec = null; item = null; last = null; };
  for (const raw of txt.replace(/\r/g, '').split('\n')) {
    if (!raw.trim()) continue;
    const indent = raw.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;
    const line = raw.trim();
    if (/^(deutsch|german)$/i.test(line)) { lang = 'de'; cur = null; continue; }
    if (/^(english|englisch)$/i.test(line)) { lang = 'en'; cur = null; continue; }
    if (/^\d{1,2}\.\s?[A-Za-zÄÖÜäöü]+\.?\s\d{4}/.test(line) || /(^|\s)@\w+/.test(line)) continue;   // date / author line
    const bullet = line.match(/^([-–•*◦▪·]|\d+[.)])\s+(.*)$/);
    const plain = line.replace(/:$/, '').trim();
    const head = !bullet && headOf(plain);
    const ver = !bullet && !head && line.match(/^(?:[A-Za-zÄÖÜäöü][\w .&-]{0,40}?\s+)?v?(\d+\.\d+(?:\.\d+)?)(?:\s*[–—:-]\s*(.+))?$/);
    if (ver && !/changelog/i.test(line)) { start(ver[1], ver[2] ? ver[2].trim() : ''); continue; }
    if (/changelog/i.test(line) && !bullet) continue;   // document title
    if (!cur) start('', '');
    if (head) {
      if (head.bi) cur.bi = true;
      else if (!cur.lang) cur.lang = EN_HEAD.test(plain) ? 'en' : 'de';
      sec = { kind: head.kind, items: [] }; cur.sections.push(sec); item = null; last = null; continue;
    }
    if (!sec) { sec = { kind: 'new', items: [] }; cur.sections.push(sec); }
    const text = bullet ? bullet[2].trim() : line;
    const isSub = item && (line.startsWith('◦') || (bullet && indent >= 2));
    if (isSub) { item.sub.push(text); item.subEn.push(''); last = 'sub'; }
    else if (bullet || !item) { item = { text, en: '', sub: [], subEn: [] }; sec.items.push(item); last = 'item'; }
    else if (cur.bi) {
      // bilingual: the line under a point is its English version
      if (last === 'sub') { const i = item.sub.length - 1; item.subEn[i] = item.subEn[i] ? item.subEn[i] + ' ' + text : text; }
      else item.en = item.en ? item.en + ' ' + text : text;
    }
    else if (item.sub.length) item.sub[item.sub.length - 1] += ' ' + text;
    else item.text += ' ' + text;
  }
  const conv = it => ({ de: it.text, en: it.en, sub: it.sub.map((x, k) => [x, it.subEn[k] || '']) });
  // pair the German and English block of each version (a bilingual block is complete on its own)
  const out = [], byVer = new Map();
  blocks.forEach((b, i) => {
    const key = b.version || '#' + i;
    if (b.bi) { out.push({ version: b.version, bi: b }); return; }
    if (!b.lang) b.lang = byVer.has(key) && byVer.get(key).de ? 'en' : 'de';
    if (!byVer.has(key)) { const o = { version: b.version }; byVer.set(key, o); out.push(o); }
    byVer.get(key)[b.lang] = b;
  });
  return out.map(o => {
    if (o.bi) return { version: o.version, date: today(), title: { de: o.bi.title || '', en: '' }, sections: o.bi.sections.map(s => ({ kind: s.kind, items: s.items.map(conv) })) };
    const de = o.de || { sections: [], title: '' }, en = o.en || { sections: [], title: '' };
    const base = de.sections.length >= en.sections.length ? de.sections : en.sections;
    return {
      version: o.version, date: today(), title: { de: de.title || '', en: en.title || '' },
      sections: base.map((s, si) => {
        const d = de.sections[si], e = en.sections[si];
        const n = Math.max(d ? d.items.length : 0, e ? e.items.length : 0);
        return { kind: s.kind, items: Array.from({ length: n }, (_, ii) => {
          const di = d && d.items[ii], ei = e && e.items[ii];
          const ns = Math.max(di ? di.sub.length : 0, ei ? ei.sub.length : 0);
          return { de: di ? di.text : '', en: ei ? ei.text : '', sub: Array.from({ length: ns }, (_, k) => [di && di.sub[k] || '', ei && ei.sub[k] || '']) };
        }) };
      }),
    };
  });
}


// release body → plain text for the parser
// Release texts are often written for Discord (### headings, > quotes, emoji bullets, **bold**, `code`).
// They are turned into the website format here: topic headings become points, the lines under them sub-points.
const EMO = /^[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️‍]+\s*/u;
function clean(body) {
  let t = String(body || '').replace(/\r/g, '');
  const fence = t.match(/```[a-z]*\n([\s\S]*?)```/i); if (fence) t = fence[1];
  const inl = l => l.replace(/\*\*(.*?)\*\*/g, '$1').replace(/__(.*?)__/g, '$1').replace(/`([^`]*)`/g, '$1').replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1$2').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  const out = []; let topic = false;
  for (let raw of t.split('\n')) {
    if (!raw.trim()) { out.push(''); continue; }
    let l = inl(raw);
    const indent = l.match(/^\s*/)[0];
    let body = l.trim();
    if (/(^|\s)#[a-z0-9][\w-]*(\s|$)/i.test(body) && !/^#{1,6}\s/.test(body)) continue;            // "#beta-downloads · #bug-reports" footer
    if (/^(🇬🇧|🇩🇪)[^\p{L}]*(english|englisch)?[^\p{L}]*(🇬🇧|🇩🇪)?[^\p{L}]*(deutsch|german)?\s*$/iu.test(body) || /^(🇬🇧|🇩🇪)\s*(english|deutsch)\s*[·|/]\s*(🇬🇧|🇩🇪)\s*(english|deutsch)\s*$/iu.test(body)) continue;   // language legend
    const h = body.match(/^#{1,6}\s+(.*)$/);
    if (h) {
      const txt = h[1].replace(EMO, '').replace(/\s+[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}️]+\s*$/u, '').trim();
      if (headOf(txt.replace(/:$/, '')) || /\d+\.\d+/.test(txt) || /^(english|deutsch|german|englisch)$/i.test(txt)) { out.push(txt); topic = false; continue; }
      out.push('- ' + txt); topic = true; continue;                                                  // topic heading → point
    }
    const q = body.match(/^>\s?(.*)$/); if (q) body = q[1].trim();
    const flag = body.match(/^(🇬🇧|🇩🇪)\s*(.*)$/u); if (flag) body = flag[2];
    const emo = EMO.test(body); body = body.replace(EMO, '');
    if (!body) continue;
    if (/^[-–•*◦▪·]\s|^\d+[.)]\s/.test(body)) { out.push(indent + body); continue; }
    if (headOf(body.replace(/:$/, '')) || /^(english|deutsch|german|englisch)$/i.test(body)) { out.push(body); topic = false; continue; }
    if (q || flag || emo || /^[→↪]/.test(body)) { out.push((topic ? '  - ' : '- ') + body.replace(/^[→↪]\s*/, '')); continue; }
    out.push(indent + body);
  }
  return out.join('\n');
}
const vnum = v => v.split(/[.-]/).map(x => +x || 0);
const cmp = (a, b) => { const x = vnum(a.version), y = vnum(b.version); for (let i = 0; i < 4; i++) if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0); return 0; };

function fromRelease(r) {
  const tagVer = (String(r.tag_name || '').match(/\d+\.\d+(?:\.\d+)?/) || [''])[0];
  DATE = String(r.published_at || r.created_at || '').slice(0, 10);
  let list = [];
  try { list = parseText(clean(r.body)); } catch (e) { return null; }
  const e = list.find(x => x.version === tagVer) || list.find(x => x.sections && x.sections.length) || null;
  if (!e || !e.sections.length) return null;
  e.version = e.version || tagVer; if (!e.version) return null;
  if (!e.title.de && r.name) { const m = String(r.name).match(/[–—:-]\s*(.+)$/); if (m) e.title.de = m[1].trim(); }
  if (!e.title.en) e.title.en = e.title.de;
  e.date = DATE || null;
  return e;
}

const state = { at: null, ok: null, error: null, versions: [] };
function start(studio) {
  async function sync() {
    if (!TOKEN) { state.error = 'BETA_GITHUB_TOKEN fehlt'; return state; }
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, { headers: { Authorization: 'Bearer ' + TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'dev-dsue-changelog' } });
      if (!r.ok) throw new Error('GitHub ' + r.status);
      const rel = (await r.json()).filter(x => !x.draft);
      const auto = rel.map(fromRelease).filter(Boolean);
      state.versions = studio.mergeAuto(auto, cmp);
      state.ok = true; state.error = null;
    } catch (e) { state.ok = false; state.error = String(e.message || e); console.warn('changelog sync:', state.error); }
    state.at = new Date().toISOString();
    return state;
  }
  sync(); setInterval(sync, EVERY).unref();
  // GitHub webhook (event "Releases"): sync right away when a release is published or edited
  async function hook(req, res, send) {
    const chunks = []; for await (const c of req) { chunks.push(c); if (chunks.length > 400) break; }
    const raw = Buffer.concat(chunks);
    if (SECRET) {
      const sig = String(req.headers['x-hub-signature-256'] || ''), want = 'sha256=' + crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
      if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return send(res, 401, { error: 'bad signature' });
    } else return send(res, 503, { error: 'RELEASE_WEBHOOK_SECRET not set' });
    const s = await sync();
    return send(res, 200, { ok: s.ok, versions: s.versions.length });
  }
  return { sync, hook, state };
}
module.exports = { start, fromRelease, clean };
