// dev-dsue Admin: dashboard, beta testers, release assistant (uses window.ADM from app.js)
(() => {
  const A = window.ADM, $ = id => document.getElementById(id), esc = A.esc;
  // VIEWS is declared in app.js (shared global scope)
  const fmt = n => (n == null ? '–' : Number(n).toLocaleString('de-DE'));
  const ago = d => { const s = (Date.now() - new Date(d)) / 1000; if (s < 90) return 'gerade eben'; if (s < 3600) return `vor ${Math.round(s / 60)} Min.`; if (s < 86400) return `vor ${Math.round(s / 3600)} Std.`; return `vor ${Math.round(s / 86400)} Tagen`; };
  const SVG = {
    mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
    beta: '<svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></svg>',
    dl: '<svg viewBox="0 0 24 24"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>',
    dc: '<svg viewBox="0 0 24 24"><path d="M8 12h.01M16 12h.01"/><path d="M7.5 7.5c3-1 6-1 9 0M7 16.5c3 1.5 7 1.5 10 0"/><path d="M15.5 17 17 20c2-.5 4-1.6 5-3 .5-4-.5-8-2.5-11.5A16 16 0 0 0 15 4l-.5 1M8.5 17 7 20c-2-.5-4-1.6-5-3-.5-4 .5-8 2.5-11.5A16 16 0 0 1 9 4l.5 1"/></svg>',
  };

  // ======================= DASHBOARD =======================
  let dash = null;
  function greet() {
    const h = new Date().getHours(), name = 'Simon';
    $('dGreet').textContent = (h < 5 ? 'Gute Nacht' : h < 11 ? 'Guten Morgen' : h < 18 ? 'Hallo' : 'Guten Abend') + ', ' + name;
    $('dGreetDate').textContent = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  async function loadDash() {
    greet();
    if (!dash) $('dTiles').innerHTML = '<div class="tile"><div class="k">Lädt …</div><div class="v">·</div></div>'.repeat(4);
    try { dash = await A.call('dashboard'); drawDash(); } catch (e) { A.toast(e.message, true); }
  }
  function drawDash() {
    const d = dash, dl = d.downloads || {}, dc = d.discord || {};
    A.setBadge('navUnread', d.unread); A.setBadge('navBeta', d.beta.open);
    $('dTiles').innerHTML = `
      <button class="tile" data-view="mail"><div class="k">${SVG.mail}Ungelesen</div><div class="v">${fmt(d.unread)}</div><div class="d">${fmt(d.inboxTotal)} E-Mails im Posteingang</div></button>
      <button class="tile" data-view="beta"><div class="k">${SVG.beta}Beta-Anfragen</div><div class="v">${fmt(d.beta.open)}</div><div class="d">${d.beta.open ? 'warten auf deine Antwort' : 'alles beantwortet ✓'}</div></button>
      <a class="tile" href="/admin/downloads" style="text-decoration:none"><div class="k">${SVG.dl}Beta-Downloads</div><div class="v">${dl.error ? '–' : fmt(dl.total)}</div><div class="d">${dl.error ? esc(dl.error) : dl.latest ? `${fmt(dl.latest.n)} für ${esc(dl.latest.tag)}` : 'noch keine'}</div></a>
      <a class="tile" href="https://discord.gg/aera" target="_blank" rel="noopener" style="text-decoration:none"><div class="k">${SVG.dc}Discord</div><div class="v">${dc.members ? fmt(dc.members) : '–'}</div><div class="d">${dc.online ? fmt(dc.online) + ' gerade online' : 'Mitglieder'}</div></a>`;
    $('dRecent').innerHTML = (d.recent || []).length ? d.recent.map(m => `<div class="dmail${m.seen ? '' : ' unread'}" data-open="${m.uid}"><div class="avatar sm">${A.initial(m.from)}</div><div class="t"><b>${esc(A.who(m.from))}</b><span>${esc(m.subject || '(kein Betreff)')}</span></div><time>${esc(A.when(m.date))}</time></div>`).join('') : '<div class="empty">Keine E-Mails.</div>';
    $('dRecent').onclick = e => { const r = e.target.closest('[data-open]'); if (r) A.openMail(d.inbox, +r.dataset.open); };
    const b = d.beta, max = Math.max(1, b.open, b.accepted, b.waitlist, b.declined);
    $('dBeta').innerHTML = b.error ? `<div class="empty">${esc(b.error)}</div>` : `<div class="bars">${[['Offen', b.open], ['Angenommen', b.accepted], ['Warteliste', b.waitlist], ['Abgelehnt', b.declined]].map(([k, n]) => `<div class="bar-row"><span>${k}</span><div class="b"><span style="width:${Math.round(n / max * 100)}%"></span></div><span class="n">${n}</span></div>`).join('')}</div>`;
    const a = d.aera, sy = d.sync || {};
    $('dAera').innerHTML = a ? `<div class="aera-v"><img src="/img/aera-icon.png" alt=""><div><span class="eyebrow">Aktuelle Version</span><b>${esc(a.version)}</b><div class="muted small">${esc((a.title && (a.title.de || a.title.en)) || '')}</div></div></div>
      <dl class="kv"><dt>Veröffentlicht</dt><dd>${a.date ? new Date(a.date).toLocaleDateString('de-DE') : '–'}</dd><dt>Versionen im Changelog</dt><dd>${a.count}</dd><dt>Auto-Sync mit GitHub</dt><dd>${sy.ok ? 'OK · ' + ago(sy.at) : sy.error ? esc(sy.error) : '–'}</dd></dl>` : '<div class="empty">Kein Changelog gefunden.</div>';
    const S = d.services || {};
    const row = (ok, name, txt) => `<div><span class="dot ${ok === true ? 'ok' : ok === false ? 'bad' : 'warn'}"></span>${name}<small>${txt}</small></div>`;
    $('dSys').innerHTML = [
      row(true, 'Postfach (IMAP)', S.mock ? 'Demo-Modus' : 'verbunden'),
      row(S.resend ? true : false, 'E-Mails senden', S.resend ? 'über Resend' : 'RESEND_API_KEY fehlt'),
      row(S.github ? true : false, 'GitHub (Studio)', S.github ? 'Token gesetzt' : 'GITHUB_TOKEN fehlt'),
      row(dl.error ? null : true, 'Beta-Downloads', dl.error ? 'nicht erreichbar' : 'OK'),
      row(dc.members ? true : null, 'Discord-Einladung', dc.members ? 'discord.gg/aera' : 'nicht erreichbar'),
      row(sy.ok ? true : sy.error ? false : null, 'Changelog-Sync', sy.ok ? ago(sy.at) : sy.error ? 'Fehler' : 'wartet'),
    ].join('');
  }
  $('dRefresh').onclick = () => loadDash();
  VIEWS.dash = { enter: loadDash };

  // ======================= BETA =======================
  let bItems = [], bTab = 'open', bSel = null, bMsg = null, bLang = 'de', bWant = null;
  const ST = { accepted: 'Angenommen', waitlist: 'Warteliste', declined: 'Abgelehnt', open: 'Offen' };
  const TPL_RE = { accepted: /angenommen|accepted/i, waitlist: /voll|warteliste|full|waitlist/i, declined: /abgelehnt|declined/i };
  const tplFor = (st, lang) => {
    const list = A.MS.templates.filter(t => TPL_RE[st].test(t.name));
    return list.find(t => (lang === 'en') === /🇬🇧|english|\(en\)/i.test(t.name)) || list[0] || null;
  };
  // every template that is not one of the three decisions, the ones in the request's language first
  const otherTpls = () => {
    const isDec = t => Object.values(TPL_RE).some(r => r.test(t.name));
    const en = t => /🇬🇧|english|\(en\)/i.test(t.name);
    const list = A.MS.templates.map((t, i) => [t, i]).filter(([t]) => !isDec(t) && !/team/i.test(t.name));
    list.sort((a, b) => ((en(a[0]) === (bLang === 'en')) ? 0 : 1) - ((en(b[0]) === (bLang === 'en')) ? 0 : 1));
    return list.map(([t, i]) => `<option value="${i}">${esc(t.name)}</option>`).join('');
  };
  const looksEn = t => { const s = ' ' + String(t || '').toLowerCase() + ' '; const en = (s.match(/\b(the|and|would|could|please|thanks|hi|hello|cheers|access|join|looks)\b/g) || []).length, de = (s.match(/\b(ich|und|der|die|das|bitte|danke|hallo|gerne|würde|viele|grüße)\b/g) || []).length; return en > de; };
  async function loadBeta(opts) {
    if (opts && opts.uid) bWant = opts;
    try {
      const r = await A.call('beta/list'); bItems = r.items || [];
      const n = s => bItems.filter(x => x.status === s).length;
      document.querySelectorAll('#bTabs button').forEach(b => { b.querySelector('i').textContent = n(b.dataset.st) || ''; });
      A.setBadge('navBeta', n('open'));
      if (bWant) { const it = bItems.find(x => x.folder === bWant.folder && x.uid === bWant.uid); bWant = null; if (it) { bTab = it.status; setTab(); return pick(it); } }
      drawBList();
    } catch (e) { A.toast(e.message, true); }
  }
  function setTab() { document.querySelectorAll('#bTabs button').forEach(b => b.classList.toggle('on', b.dataset.st === bTab)); drawBList(); }
  function drawBList() {
    const list = bItems.filter(x => x.status === bTab);
    $('bList').innerHTML = list.length ? list.map(x => `<button class="bcard${!x.seen ? ' new' : ''}${bSel && bSel.folder === x.folder && bSel.uid === x.uid ? ' on' : ''}" data-k="${esc(x.folder)}|${x.uid}"><div class="avatar sm">${A.initial(x.from)}</div><div class="t"><b>${esc(A.who(x.from))}</b><span>${esc(x.from.address || '')} · ${esc(x.subject)}</span></div><time>${esc(A.when(x.date))}</time></button>`).join('')
      : `<div class="panel empty">${bTab === 'open' ? 'Keine offenen Beta-Anfragen 🎉' : 'Noch niemand in „' + ST[bTab] + '“.'}</div>`;
  }
  $('bTabs').onclick = e => { const b = e.target.closest('[data-st]'); if (!b) return; bTab = b.dataset.st; setTab(); };
  $('bList').onclick = e => { const b = e.target.closest('[data-k]'); if (!b) return; const [f, u] = b.dataset.k.split('|'); pick(bItems.find(x => x.folder === f && x.uid === +u)); };
  $('bRefresh').onclick = () => loadBeta();
  async function pick(it) {
    if (!it) return; bSel = it; drawBList();
    $('bDetail').className = 'beta-detail panel'; $('bDetail').innerHTML = '<div class="empty">Lädt …</div>';
    try {
      bMsg = await A.call(`message?folder=${encodeURIComponent(it.folder)}&uid=${it.uid}`);
      it.seen = true;
      bLang = looksEn(bMsg.subject + ' ' + (bMsg.text || '')) ? 'en' : 'de';
      drawDetail();
      $('bDetail').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (e) { $('bDetail').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }
  let bChoice = null;
  function drawDetail() {
    const m = bMsg, it = bSel, f = (m.from || [])[0] || {};
    const text = (m.text || (m.html || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')).trim();
    $('bDetail').innerHTML = `
      <div class="bd-head"><div class="avatar">${A.initial(f)}</div><div style="min-width:0"><h2>${esc(f.name || f.address)}</h2><div class="muted small">${esc(f.address)} · ${esc(new Date(m.date).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }))}</div></div><span class="status-pill ${it.status}">${ST[it.status]}</span></div>
      <div class="bd-msg"><b>${esc(m.subject)}</b>\n\n${esc(text)}</div>
      <div class="bd-act">
        <div class="row3">
          <button class="btn ok" data-dec="accepted">✓ Annehmen</button>
          <button class="btn warn" data-dec="waitlist">⏳ Warteliste</button>
          <button class="btn bad" data-dec="declined">✕ Ablehnen</button>
        </div>
        <div id="bdCompose" class="hidden">
          <div class="opts"><b id="bdTitle"></b><span class="sp" style="flex:1"></span>
            <div class="seg" id="bdLang" style="margin:0"><button data-l="de">🇩🇪 Deutsch</button><button data-l="en">🇬🇧 English</button></div></div>
          <input type="text" id="bdSubj" style="margin-top:10px">
          <textarea id="bdText" style="margin-top:10px"></textarea>
          <div class="opts" style="margin-top:10px">
            <label class="switch"><input type="checkbox" id="bdMail" checked><span></span><em>E-Mail senden</em></label>
            <label class="switch"><input type="checkbox" id="bdHtml" checked><span></span><em>Formatiert</em></label>
            <span style="flex:1"></span>
            <button class="btn" id="bdCancel">Abbrechen</button>
            <button class="btn primary" id="bdGo">Bestätigen</button>
          </div>
        </div>
        <div class="bd-other">
          <select id="bdTpl" title="Antworten, ohne zu entscheiden"><option value="">💬 Mit Vorlage antworten (ohne Entscheidung) …</option>${otherTpls()}</select>
          <button class="link" id="bdOpen">Im Postfach öffnen →</button>
        </div>
      </div>`;
    $('bDetail').querySelectorAll('[data-dec]').forEach(b => b.onclick = () => choose(b.dataset.dec));
    $('bdOpen').onclick = () => A.openMail(it.folder, it.uid);
    $('bdTpl').onchange = e => { const i = e.target.value; e.target.value = ''; if (i === '') return; A.openCompose('reply', bMsg); A.applyTemplate(+i); };
  }
  function fillChoice() {
    const f = (bMsg.from || [])[0] || {}, t = tplFor(bChoice, bLang), name = A.firstName(f.name);
    const base = (bMsg.subject || '').replace(/^((re|aw|fwd?|wg):\s*)+/i, '');
    $('bdSubj').value = 'Re: ' + base;
    const sig = A.MS.sig && A.MS.sig.trim() ? A.SIG_SEP + A.MS.sig.trim() : '';
    $('bdText').value = (t ? A.fillName(t.body, name) : (bLang === 'en' ? `Hi ${name},\n\n` : `Hallo ${name},\n\n`)) + sig;
    document.querySelectorAll('#bdLang button').forEach(b => b.classList.toggle('on', b.dataset.l === bLang));
    if (!t) A.toast('Keine passende Vorlage gefunden – Text bitte selbst schreiben', true);
  }
  function choose(st) {
    bChoice = st;
    $('bdCompose').classList.remove('hidden');
    $('bdTitle').textContent = { accepted: '✓ Annehmen', waitlist: '⏳ Auf die Warteliste', declined: '✕ Ablehnen' }[st] + ' – Antwort';
    $('bdGo').className = 'btn ' + { accepted: 'ok', waitlist: 'warn', declined: 'bad' }[st];
    fillChoice();
    $('bdLang').onclick = e => { const b = e.target.closest('[data-l]'); if (b) { bLang = b.dataset.l; fillChoice(); } };
    $('bdMail').onchange = e => { ['bdSubj', 'bdText'].forEach(id => $(id).disabled = !e.target.checked); };
    $('bdCancel').onclick = () => $('bdCompose').classList.add('hidden');
    $('bdGo').onclick = decide;
    $('bdText').focus(); $('bdText').setSelectionRange(0, 0); $('bdText').scrollTop = 0;
  }
  async function decide() {
    const it = bSel, m = bMsg, f = (m.from || [])[0] || {}, rt = (m.replyTo || []).length ? m.replyTo : m.from;
    const withMail = $('bdMail').checked, btn = $('bdGo'); btn.disabled = true; btn.textContent = 'Wird erledigt …';
    try {
      await A.call('beta/decide', { folder: it.folder, uid: it.uid, status: bChoice, mail: withMail ? { to: (rt || []).map(a => a.address).join(', '), subject: $('bdSubj').value, text: $('bdText').value, html: $('bdHtml').checked, fromName: 'dev-dsue', inReplyTo: m.messageId, references: (m.references ? m.references + ' ' : '') + m.messageId } : null });
      A.toast(`${f.name || f.address}: ${ST[bChoice]} ✓${withMail ? ' · Antwort gesendet' : ''}`);
      bSel = null; $('bDetail').className = 'beta-detail'; $('bDetail').innerHTML = '<div class="empty-reader"><p>Erledigt ✓ – nächste Anfrage auswählen</p></div>';
      await loadBeta();
      const next = bItems.find(x => x.status === 'open'); if (next && bTab === 'open') pick(next);
    } catch (e) { A.toast(e.message, true); btn.disabled = false; btn.textContent = 'Bestätigen'; }
  }
  VIEWS.beta = { enter: loadBeta };

  // ======================= RELEASE =======================
  const KIND = { new: ['🆕', 'Neu', 'New'], imp: ['✨', 'Verbessert', 'Improved'], fix: ['🛠️', 'Behoben', 'Fixed'] };
  const RKEY = 'dsue.release';
  let R = null, rTab = 'web', rState = null, rWebLang = 'de';
  const blank = () => ({ version: '', date: new Date().toISOString().slice(0, 10), title: { de: '', en: '' }, sections: [{ kind: 'new', items: [{ de: '', en: '' }] }, { kind: 'imp', items: [{ de: '', en: '' }] }, { kind: 'fix', items: [{ de: '', en: '' }] }] });
  function loadR() { try { R = JSON.parse(localStorage.getItem(RKEY) || 'null'); } catch {} if (!R || !R.sections) R = blank(); }
  const saveR = () => { try { localStorage.setItem(RKEY, JSON.stringify(R)); } catch {} };
  const bump = v => { const m = String(v || '').match(/^(\d+)\.(\d+)(?:\.(\d+))?/); return m ? `${m[1]}.${m[2]}.${(+m[3] || 0) + 1}` : ''; };
  async function enterRelease() {
    loadR(); drawForm(); preview();
    try { rState = await A.call('studio/state'); if (!R.version && rState.aera && rState.aera[0]) { R.version = bump(rState.aera[0].version); $('rVer').value = R.version; preview(); } } catch {}
  }
  function drawForm() {
    $('rVer').value = R.version; $('rDate').value = R.date || ''; $('rTitDe').value = R.title.de; $('rTitEn').value = R.title.en;
    $('rSecs').innerHTML = R.sections.map((s, si) => `<div class="rsec" data-si="${si}"><div class="rsec-h"><span style="font-size:18px">${KIND[s.kind][0]}</span><b>${KIND[s.kind][1]} / ${KIND[s.kind][2]}</b><button type="button" class="icon-btn danger" data-delsec="${si}" title="Abschnitt entfernen"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button></div>
      ${s.items.map((it, ii) => `<div class="ritem"><textarea data-si="${si}" data-ii="${ii}" data-l="de" placeholder="🇩🇪 Deutsch">${esc(it.de)}</textarea><textarea data-si="${si}" data-ii="${ii}" data-l="en" placeholder="🇬🇧 English">${esc(it.en)}</textarea><button type="button" class="icon-btn" data-delit="${si}|${ii}" title="Punkt entfernen">×</button></div>`).join('')}
      <button type="button" class="link" data-addit="${si}">+ Punkt hinzufügen</button></div>`).join('');
  }
  $('rForm').addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'rVer') R.version = t.value.trim(); else if (t.id === 'rDate') R.date = t.value; else if (t.id === 'rTitDe') R.title.de = t.value; else if (t.id === 'rTitEn') R.title.en = t.value;
    else if (t.dataset.si != null && t.dataset.ii != null) R.sections[+t.dataset.si].items[+t.dataset.ii][t.dataset.l] = t.value;
    saveR(); preview();
  });
  $('rForm').addEventListener('click', e => {
    const a = e.target.closest('[data-add],[data-addit],[data-delit],[data-delsec]'); if (!a) return;
    if (a.dataset.add) { const s = R.sections.find(x => x.kind === a.dataset.add); if (s) s.items.push({ de: '', en: '' }); else R.sections.push({ kind: a.dataset.add, items: [{ de: '', en: '' }] }); R.sections.sort((x, y) => Object.keys(KIND).indexOf(x.kind) - Object.keys(KIND).indexOf(y.kind)); }
    if (a.dataset.addit) R.sections[+a.dataset.addit].items.push({ de: '', en: '' });
    if (a.dataset.delit) { const [si, ii] = a.dataset.delit.split('|').map(Number); R.sections[si].items.splice(ii, 1); if (!R.sections[si].items.length) R.sections.splice(si, 1); }
    if (a.dataset.delsec) R.sections.splice(+a.dataset.delsec, 1);
    saveR(); drawForm(); preview();
    const last = $('rSecs').querySelectorAll('textarea[data-l="de"]'); if (a.dataset.add || a.dataset.addit) { const box = a.dataset.addit ? $('rSecs').querySelector(`[data-si="${a.dataset.addit}"].rsec`) : null; const ts = (box || $('rSecs')).querySelectorAll('textarea[data-l="de"]'); (ts[ts.length - 1] || last[0] || {}).focus && (ts[ts.length - 1] || last[0]).focus(); }
  });
  $('rReset').onclick = () => { if (!confirm('Alles leeren?')) return; R = blank(); if (rState && rState.aera && rState.aera[0]) R.version = bump(rState.aera[0].version); saveR(); drawForm(); preview(); };
  const clean = () => ({ version: R.version, date: R.date || null, title: { de: R.title.de.trim(), en: R.title.en.trim() }, sections: R.sections.map(s => ({ kind: s.kind, items: s.items.map(i => ({ de: i.de.trim(), en: i.en.trim() })).filter(i => i.de || i.en) })).filter(s => s.items.length) });
  function discordText(c) {
    const out = [`# ✈️ AERA ${c.version}${c.title.en || c.title.de ? ' – ' + (c.title.en || c.title.de) : ''}`];
    if (c.title.de && c.title.en && c.title.de !== c.title.en) out.push(`-# 🇩🇪 ${c.title.de}`);
    for (const s of c.sections) {
      out.push('', `## ${KIND[s.kind][0]} ${KIND[s.kind][2]} · ${KIND[s.kind][1]}`);
      for (const i of s.items) { out.push(`- 🇬🇧 ${i.en || i.de}`); if (i.de && i.en) out.push(`  🇩🇪 ${i.de}`); }
    }
    out.push('', '📥 Download: <https://www.dev-dsue.de/beta> · 📝 <https://www.dev-dsue.de/aera/changelog>');
    return out.join('\n');
  }
  function githubText(c) {
    const out = [`AERA ${c.version}${c.title.de ? ' – ' + c.title.de : ''}`];
    for (const s of c.sections) { out.push(`${KIND[s.kind][1]} / ${KIND[s.kind][2]}`); for (const i of s.items) { out.push(`- ${i.de || i.en}`); if (i.en && i.de) out.push(`  ${i.en}`); } }
    return out.join('\n');
  }
  function mdLine(t) { return esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/&lt;(https?:[^&]+)&gt;/g, '<a>$1</a>'); }
  function discordHtml(txt) {
    let html = '', inList = false;
    for (const l of txt.split('\n')) {
      if (/^- /.test(l)) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${mdLine(l.slice(2))}`; continue; }
      if (/^ {2}/.test(l) && inList) { html += `<div class="sub">${mdLine(l.trim())}</div>`; continue; }
      if (inList) { html += '</ul>'; inList = false; }
      if (/^# /.test(l)) html += `<h1>${mdLine(l.slice(2))}</h1>`; else if (/^## /.test(l)) html += `<h2>${mdLine(l.slice(3))}</h2>`; else if (/^-# /.test(l)) html += `<div class="sub" style="font-size:12px">${mdLine(l.slice(3))}</div>`; else if (l.trim()) html += `<div>${mdLine(l)}</div>`;
    }
    return html + (inList ? '</ul>' : '');
  }
  function preview() {
    const c = clean();
    document.querySelectorAll('#rTabs button').forEach(b => b.classList.toggle('on', b.dataset.t === rTab));
    if (!c.version && !c.sections.length) { $('rPrev').innerHTML = '<div class="empty">Links Version und Punkte eintragen – hier erscheint die Vorschau.</div>'; return; }
    if (rTab === 'web') {
      const L = rWebLang;
      $('rPrev').innerHTML = `<div class="pv-web"><div class="seg pv-lang" id="pvLang"><button data-wl="de" class="${L === 'de' ? 'on' : ''}">DE</button><button data-wl="en" class="${L === 'en' ? 'on' : ''}">EN</button></div>
        <h3 class="chrome">AERA ${esc(c.version || '?')}${c.title[L] ? ' – ' + esc(c.title[L]) : ''}</h3><div class="date">${c.date ? new Date(c.date).toLocaleDateString(L === 'de' ? 'de-DE' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}</div>
        ${c.sections.map(s => `<h4>${KIND[s.kind][0]} ${KIND[s.kind][L === 'de' ? 1 : 2]}</h4><ul>${s.items.map(i => `<li>${esc(i[L] || i[L === 'de' ? 'en' : 'de'])}${!i[L] ? ' <small>(fehlt auf ' + (L === 'de' ? 'Deutsch' : 'Englisch') + ')</small>' : ''}</li>`).join('')}</ul>`).join('')}</div>`;
      $('pvLang').onclick = e => { const b = e.target.closest('[data-wl]'); if (b) { rWebLang = b.dataset.wl; preview(); } };
    } else if (rTab === 'discord') {
      $('rPrev').innerHTML = `<div class="pv-dc"><div class="who"><img src="/img/aera-icon.png" alt=""><b>AERA</b><em>APP</em><span class="sub" style="font-size:12px">Heute</span></div>${discordHtml(discordText(c))}</div>`;
    } else $('rPrev').innerHTML = `<pre class="pv-raw">${esc(githubText(c))}</pre>`;
    $('rCopy').querySelector('span').textContent = rTab === 'web' ? 'Discord-Text kopieren' : rTab === 'discord' ? 'Discord-Text kopieren' : 'Release-Text kopieren';
  }
  $('rTabs').onclick = e => { const b = e.target.closest('[data-t]'); if (b) { rTab = b.dataset.t; preview(); } };
  $('rCopy').onclick = async () => {
    const c = clean(), txt = rTab === 'github' ? githubText(c) : discordText(c);
    try { await navigator.clipboard.writeText(txt); A.toast('Kopiert ✓'); } catch { A.toast('Kopieren nicht möglich', true); }
  };
  $('rPublish').onclick = async () => {
    const c = clean();
    if (!/^\d+\.\d+(\.\d+)?/.test(c.version)) return A.toast('Bitte eine gültige Version eintragen (z. B. 0.11.7)', true);
    if (!c.sections.length) return A.toast('Mindestens einen Punkt eintragen', true);
    const miss = c.sections.some(s => s.items.some(i => !i.de || !i.en)) || !c.title.de !== !c.title.en;
    if (miss && !confirm('Einige Punkte sind nur in einer Sprache ausgefüllt. Trotzdem veröffentlichen?')) return;
    try {
      rState = rState || await A.call('studio/state');
      if (!rState.github) return A.toast('GITHUB_TOKEN fehlt auf Railway – Veröffentlichen geht erst mit Token', true);
      const list = (rState.aera || []).filter(v => v.version !== c.version);
      const exists = list.length !== (rState.aera || []).length;
      if (exists && !confirm(`Version ${c.version} gibt es schon. Ersetzen?`)) return;
      const btn = $('rPublish'); btn.disabled = true;
      const r = await A.call('studio/aera', { list: [c, ...list], message: `Release-Assistent: AERA ${c.version}` });
      rState.aera = r.aera; btn.disabled = false;
      A.toast(`AERA ${c.version} ist auf der Website ✓`);
      $('rNote').textContent = `✓ Veröffentlicht (Commit ${r.commit || '–'}). Discord bekommt den Changelog jetzt automatisch von der Website.`;
    } catch (e) { $('rPublish').disabled = false; A.toast(e.message, true); }
  };
  VIEWS.release = { enter: enterRelease };
})();
