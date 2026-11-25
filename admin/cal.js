// dev-dsue Admin: calendar view (week / month / list), event dialog, "Termin aus Mail" – data comes from /api/cal/* (iCloud via CalDAV)
(() => {
  const A = window.ADM, $ = id => document.getElementById(id), esc = A.esc;
  VIEW_IDS.cal = 'vCal';   // VIEW_IDS / VIEWS / view are declared in app.js (shared global scope)

  const H = 48;   // px per hour in the week grid
  const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const store = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem('cal.' + k)); localStorage.setItem('cal.' + k, JSON.stringify(v)); } catch { return null; } };
  const mobile = () => window.innerWidth <= 720;
  let mode = store('mode') || (mobile() ? 'list' : 'week'), anchor = startOfDay(new Date()), status = null, data = { events: [], calendars: [] }, hidden = new Set(store('hidden') || []), loading = 0, nowT = 0;

  // ---------- date helpers (local time) ----------
  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function monday(d) { const x = startOfDay(d); return addDays(x, -((x.getDay() + 6) % 7)); }
  const key = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const parseDay = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const hm = d => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const same = (a, b) => key(a) === key(b);
  const dayLabel = d => { const t = startOfDay(new Date()); if (same(d, t)) return 'Heute'; if (same(d, addDays(t, 1))) return 'Morgen'; if (same(d, addDays(t, -1))) return 'Gestern'; return d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }); };
  const evStart = e => e.allDay ? parseDay(e.start) : new Date(e.start);
  const evEnd = e => e.allDay ? parseDay(e.end) : new Date(e.end);
  const calOf = e => data.calendars.find(c => c.id === e.cal) || { color: '#888', name: '' };
  const visible = () => data.events.filter(e => !hidden.has(e.cal));
  function range() {
    if (mode === 'week') { const s = monday(anchor); return [s, addDays(s, 7)]; }
    if (mode === 'month') { const s = monday(new Date(anchor.getFullYear(), anchor.getMonth(), 1)); return [s, addDays(s, 42)]; }
    return [startOfDay(anchor), addDays(startOfDay(anchor), 31)];
  }
  function onDay(e, d) { const s = evStart(e), en = evEnd(e), d0 = startOfDay(d), d1 = addDays(d0, 1); return s < d1 && (en > d0 || (+en === +s && s >= d0)); }

  // ---------- load ----------
  async function enter(opts) {
    if (opts && opts.date) anchor = startOfDay(opts.date);
    if (status && status.for !== ME) status = null;
    if (!status) { $('calMain').innerHTML = '<div class="cal-empty">Kalender wird geladen …</div>'; try { status = await A.call('cal/status'); } catch (e) { status = { configured: true, error: e.message }; } status.for = ME; }
    drawSide();
    if (!status.configured) return drawSetup();
    await load();
    if (opts && opts.open) { const e = data.events.find(x => x.id === opts.open); if (e) openEvent(e); }
  }
  async function load(fresh) {
    const [a, b] = range(), my = ++loading;
    drawHead(); $('calSync').classList.add('spin');
    try {
      const r = await A.call(`cal/events?from=${a.toISOString()}&to=${b.toISOString()}${fresh ? '&fresh=1' : ''}`);
      if (my !== loading) return;
      data = r; if (r.calendars && r.calendars.length) status.calendars = r.calendars;
      if ((r.errors || []).length) A.toast('Teilweise nicht geladen: ' + r.errors[0], true);
    } catch (e) { if (my === loading) { A.toast(e.message, true); data = { events: [], calendars: status.calendars || [] }; } }
    $('calSync').classList.remove('spin');
    drawSide(); draw();
  }
  const refresh = () => load(true);

  // ---------- header / side ----------
  function drawHead() {
    const [a] = range();
    let t;
    if (mode === 'week') { const b = addDays(a, 6); t = a.getMonth() === b.getMonth() ? `${a.getDate()}.–${b.getDate()}. ${b.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}` : `${a.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })} – ${b.toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' })}`; }
    else if (mode === 'month') t = anchor.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    else t = 'Ab ' + dayLabel(anchor).replace(/^(Heute|Morgen|Gestern)$/, m => m.toLowerCase());
    $('calTitle').textContent = t;
    document.querySelectorAll('#calMode [data-m]').forEach(b => b.classList.toggle('on', b.dataset.m === mode));
  }
  function drawSide() {
    const s = status || {}, cals = (data.calendars && data.calendars.length ? data.calendars : s.calendars) || [];
    if (!s.configured) { $('calSide').innerHTML = ''; return; }
    $('calSide').innerHTML = `
      <div class="cal-acc"><span class="dot ${s.error ? 'bad' : 'ok'}"></span><div><b>${s.mock ? 'Demo-Kalender' : 'iCloud-Kalender'}</b><small>${esc(s.error ? s.error : s.user || '')}</small>${s.canDisconnect ? '<button class="link cal-off" id="calOff">Verbindung trennen</button>' : ''}</div></div>
      <div class="cal-sec">Meine Kalender</div>
      ${cals.length && !cals.some(c => !c.readOnly) ? '<p class="muted small cal-warn">Alle Kalender sind nur lesbar – neue Termine gehen gerade nicht.</p>' : ''}
      ${cals.map(c => `<label class="cal-item"><input type="checkbox" data-cal="${esc(c.id)}"${hidden.has(c.id) ? '' : ' checked'}><span class="sw" style="--c:${esc(c.color)}"></span><span class="nm">${esc(c.name)}</span>${c.readOnly ? '<small title="Nur lesen">🔒</small>' : ''}</label>`).join('') || '<div class="muted small">Keine Kalender gefunden.</div>'}
      <a class="cal-diag" href="/api/cal/debug" target="_blank" rel="noopener">Diagnose anzeigen</a>
      <p class="muted small cal-hint">Änderungen landen direkt in deiner Apple-Kalender-App – auf iPhone und Mac meist nach wenigen Sekunden.</p>`;
  }
  $('calSide').addEventListener('change', e => { const c = e.target.dataset.cal; if (!c) return; e.target.checked ? hidden.delete(c) : hidden.add(c); store('hidden', [...hidden]); draw(); });

  function drawSetup() {
    $('calTitle').textContent = 'Kalender';
    $('calMain').innerHTML = `<form class="cal-setup panel" id="calConnect" autocomplete="off">
      <h2>Deinen iCloud-Kalender verbinden</h2>
      <p class="muted">Jedes Admin-Konto hat seinen eigenen Kalender. Verbinde hier deinen – andere sehen ihn nicht. Termine, die du hier einträgst, landen direkt in deiner Kalender-App auf iPhone und Mac.</p>
      <ol>
        <li>Öffne <a href="https://account.apple.com/account/manage" target="_blank" rel="noopener">account.apple.com</a> → <b>Anmelden und Sicherheit</b> → <b>App-spezifische Passwörter</b>.</li>
        <li>Neues Passwort erstellen, z. B. „dev-dsue Admin“, und unten einfügen (Format <code>xxxx-xxxx-xxxx-xxxx</code>). Dein normales Apple-Passwort wird nicht gebraucht.</li>
      </ol>
      <label>Apple-ID (E-Mail)<input id="ccUser" type="email" required placeholder="name@icloud.com" autocomplete="off"></label>
      <label>App-spezifisches Passwort<input id="ccPass" type="password" required placeholder="xxxx-xxxx-xxxx-xxxx" autocomplete="new-password"></label>
      <details class="cc-more"><summary>Anderer Kalender-Server (statt iCloud)</summary><label>CalDAV-Adresse<input id="ccUrl" type="url" placeholder="https://…"></label></details>
      <button class="btn primary" id="ccBtn">Kalender verbinden</button>
      <p class="muted small">Das Passwort wird verschlüsselt auf dem Server gespeichert und nur für deinen Kalender benutzt. Du kannst die Verbindung jederzeit trennen oder das Passwort bei Apple löschen.${status && status.persist === false ? ' <b>Hinweis:</b> Auf dem Server ist kein Datenspeicher eingerichtet (AERA_DATA_DIR) – nach einem Update musst du dich neu verbinden.' : ''}</p>
    </form>`;
    $('calConnect').addEventListener('submit', async e => {
      e.preventDefault(); $('ccBtn').disabled = true; $('ccBtn').textContent = 'Verbinde …';
      try {
        const r = await A.call('cal/connect', { user: $('ccUser').value, pass: $('ccPass').value, url: $('ccUrl').value });
        A.toast(`Verbunden ✓ – ${r.calendars} Kalender gefunden`); status = null; enter();
      } catch (err) { A.toast(err.message, true); $('ccBtn').disabled = false; $('ccBtn').textContent = 'Kalender verbinden'; }
    });
  }
  $('calSide').addEventListener('click', async e => {
    if (!e.target.closest('#calOff')) return;
    const b = e.target.closest('#calOff');
    if (!b.dataset.arm) { b.dataset.arm = '1'; b.textContent = 'Wirklich trennen?'; setTimeout(() => { if (b.isConnected) { delete b.dataset.arm; b.textContent = 'Verbindung trennen'; } }, 4000); return; }
    try { await A.call('cal/disconnect', {}); A.toast('Kalender getrennt'); status = null; data = { events: [], calendars: [] }; enter(); } catch (err) { A.toast(err.message, true); }
  });

  // ---------- views ----------
  function draw() {
    drawHead();
    if (mode === 'week') drawWeek(); else if (mode === 'month') drawMonth(); else drawList();
  }
  function chip(e, d) {
    const c = calOf(e), s = evStart(e);
    const t = e.allDay ? '' : same(s, d) ? `<time>${hm(s)}</time>` : '';
    return `<button class="ev-chip${e.allDay ? ' all' : ''}" data-ev="${esc(e.id)}" style="--c:${esc(c.color)}" title="${esc(e.title)}">${t}<span>${esc(e.title)}</span></button>`;
  }
  function drawMonth() {
    const [a] = range(), today = startOfDay(new Date()), ev = visible();
    let h = `<div class="mo"><div class="mo-head">${WD.map(w => `<span>${w}</span>`).join('')}</div><div class="mo-grid">`;
    for (let i = 0; i < 42; i++) {
      const d = addDays(a, i), list = ev.filter(e => onDay(e, d)).sort((x, y) => (y.allDay - x.allDay) || (evStart(x) - evStart(y)));
      const max = mobile() ? 2 : 3;
      h += `<div class="mo-cell${d.getMonth() !== anchor.getMonth() ? ' other' : ''}${same(d, today) ? ' today' : ''}" data-day="${key(d)}"><span class="num">${d.getDate()}</span>
        ${list.slice(0, max).map(e => chip(e, d)).join('')}${list.length > max ? `<button class="more" data-week="${key(d)}">+${list.length - max} weitere</button>` : ''}</div>`;
    }
    $('calMain').innerHTML = h + '</div></div>';
  }
  function drawList() {
    const [a, b] = range(), ev = visible(), rows = [];
    for (let d = a; d < b; d = addDays(d, 1)) {
      const list = ev.filter(e => onDay(e, d)).sort((x, y) => (y.allDay - x.allDay) || (evStart(x) - evStart(y)));
      if (list.length) rows.push(`<div class="ag-day${same(d, new Date()) ? ' today' : ''}"><div class="ag-date"><b>${d.getDate()}</b><span>${d.toLocaleDateString('de-DE', { weekday: 'short' })}<br>${d.toLocaleDateString('de-DE', { month: 'short' })}</span></div><div class="ag-list">${list.map(e => {
        const c = calOf(e), s = evStart(e), en = evEnd(e);
        const t = e.allDay ? 'ganztägig' : same(s, d) ? `${hm(s)}–${hm(en)}` : 'läuft weiter';
        return `<button class="ag-ev" data-ev="${esc(e.id)}" style="--c:${esc(c.color)}"><span class="bar"></span><span class="t">${t}</span><span class="ti"><b>${esc(e.title)}</b>${e.location ? `<small>${esc(e.location)}</small>` : ''}</span>${e.recurring ? '<small class="rec" title="Wiederholt sich">↻</small>' : ''}</button>`;
      }).join('')}</div></div>`);
    }
    $('calMain').innerHTML = `<div class="ag">${rows.join('') || '<div class="cal-empty">Keine Termine in den nächsten 30 Tagen. 🎉</div>'}</div>`;
  }
  function layoutDay(list) {   // side-by-side columns for overlapping events
    list.sort((x, y) => x.s - y.s || y.e - x.e);
    let cluster = [], end = -1; const out = [];
    const flush = () => { const lanes = []; for (const it of cluster) { let i = lanes.findIndex(t => t <= it.s); if (i < 0) { i = lanes.length; lanes.push(0); } lanes[i] = it.e; it.lane = i; } cluster.forEach(it => { it.n = lanes.length; out.push(it); }); cluster = []; };
    for (const it of list) { if (it.s >= end && cluster.length) flush(); cluster.push(it); end = Math.max(end, it.e); }
    if (cluster.length) flush();
    return out;
  }
  function drawWeek() {
    const [a] = range(), days = [...Array(7)].map((_, i) => addDays(a, i)), today = startOfDay(new Date()), ev = visible();
    // all-day bars
    const allDay = ev.filter(e => e.allDay || (evEnd(e) - evStart(e) >= 864e5 && !e.allDay && startOfDay(evStart(e)) < startOfDay(evEnd(e)) && evEnd(e) - evStart(e) >= 20 * 3600e3));
    const rows = [], bars = [];
    for (const e of allDay.sort((x, y) => evStart(x) - evStart(y))) {
      const s = Math.max(0, Math.round((startOfDay(evStart(e)) - a) / 864e5)), en = Math.min(7, Math.ceil((evEnd(e) - a) / 864e5));
      if (en <= s) continue;
      let r = rows.findIndex(x => x <= s); if (r < 0) { r = rows.length; rows.push(0); } rows[r] = en;
      bars.push(`<button class="ev-chip all" data-ev="${esc(e.id)}" style="--c:${esc(calOf(e).color)};grid-column:${s + 1}/${en + 1};grid-row:${r + 1}" title="${esc(e.title)}"><span>${esc(e.title)}</span></button>`);
    }
    const timed = ev.filter(e => !allDay.includes(e));
    const cols = days.map(d => {
      const d0 = +d, d1 = +addDays(d, 1);
      const items = layoutDay(timed.filter(e => evStart(e) < d1 && evEnd(e) > d0 || (+evStart(e) === +evEnd(e) && +evStart(e) >= d0 && +evStart(e) < d1)).map(e => ({ ev: e, s: Math.max(+evStart(e), d0), e: Math.min(Math.max(+evEnd(e), +evStart(e) + 20 * 60e3), d1) })));
      return `<div class="wk-col${same(d, today) ? ' today' : ''}" data-day="${key(d)}">${items.map(it => {
        const top = (it.s - d0) / 3600e3 * H, ht = Math.max(20, (it.e - it.s) / 3600e3 * H - 2), c = calOf(it.ev), w = 100 / it.n;
        const s = evStart(it.ev), en = evEnd(it.ev);
        return `<button class="wk-ev${ht < 30 ? ' short' : ''}" data-ev="${esc(it.ev.id)}" style="--c:${esc(c.color)};top:${top}px;height:${ht}px;left:calc(${it.lane * w}% + 2px);width:calc(${w}% - 4px)" title="${esc(it.ev.title)}"><b>${esc(it.ev.title)}</b><small>${hm(s)}–${hm(en)}${it.ev.location ? ' · ' + esc(it.ev.location) : ''}</small></button>`;
      }).join('')}</div>`;
    }).join('');
    $('calMain').innerHTML = `<div class="wk">
      <div class="wk-head"><div class="wk-gut"></div>${days.map((d, i) => `<button class="wk-day${same(d, today) ? ' today' : ''}" data-dayhead="${key(d)}"><span>${WD[i]}</span><b>${d.getDate()}</b></button>`).join('')}</div>
      <div class="wk-all"><div class="wk-gut"><small>ganztägig</small></div><div class="wk-allgrid" style="grid-template-rows:repeat(${Math.max(1, rows.length)},24px)">${bars.join('')}</div></div>
      <div class="wk-scroll" id="wkScroll"><div class="wk-grid" style="height:${24 * H}px"><div class="wk-gut wk-hours">${[...Array(24)].map((_, h) => `<span style="top:${h * H}px">${h ? String(h).padStart(2, '0') + ':00' : ''}</span>`).join('')}</div>${cols}<div class="wk-now" id="wkNow"></div></div></div>
    </div>`;
    placeNow();
    const sc = $('wkScroll'), now = new Date();
    sc.scrollTop = (days.some(d => same(d, now)) ? Math.max(0, now.getHours() - 2) : 7) * H;
  }
  function placeNow() {
    const el = $('wkNow'); if (!el) return;
    const [a] = range(), now = new Date(), i = Math.floor((startOfDay(now) - a) / 864e5);
    if (i < 0 || i > 6) { el.style.display = 'none'; return; }
    el.style.display = ''; el.style.top = ((now - startOfDay(now)) / 3600e3 * H) + 'px';
    const g = (document.querySelector('.wk-hours') || {}).offsetWidth || 56; el.style.left = `calc(${g}px + (100% - ${g}px) / 7 * ${i})`; el.style.width = `calc((100% - ${g}px) / 7)`;
  }

  // ---------- interaction ----------
  $('calMain').addEventListener('click', e => {
    const ev = e.target.closest('[data-ev]'); if (ev) { const x = data.events.find(y => y.id === ev.dataset.ev); if (x) openEvent(x); return; }
    const more = e.target.closest('[data-week]'); if (more) { anchor = parseDay(more.dataset.week); setMode('week'); return; }
    const dh = e.target.closest('[data-dayhead]'); if (dh) { anchor = parseDay(dh.dataset.dayhead); setMode('list'); return; }
    const col = e.target.closest('.wk-col');
    if (col) { const r = col.getBoundingClientRect(), min = Math.max(0, Math.min(23.5 * 60, Math.floor((e.clientY - r.top) / H * 2) * 30)); const s = parseDay(col.dataset.day); s.setMinutes(min); return openNew({ start: s }); }
    const cell = e.target.closest('.mo-cell');
    if (cell) { const s = parseDay(cell.dataset.day); s.setHours(10); return openNew({ start: s }); }
  });
  function setMode(m) { mode = m; store('mode', m); load(); }
  $('calMode').addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (b) setMode(b.dataset.m); });
  const step = dir => { anchor = mode === 'week' ? addDays(anchor, 7 * dir) : mode === 'month' ? new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1) : addDays(anchor, 30 * dir); load(); };
  $('calPrev').onclick = () => step(-1); $('calNext').onclick = () => step(1);
  $('calToday').onclick = () => { anchor = startOfDay(new Date()); load(); };
  $('calSync').onclick = () => { status = null; enter().then(refresh); };
  $('calNew').onclick = () => openNew({});
  document.addEventListener('keydown', e => {
    if (!$('evModal').classList.contains('hidden')) { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeEv(); } return; }
    if (view !== 'cal' || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'j') step(-1); else if (k === 'ArrowRight' || k === 'k') step(1);
    else if (k === 't') $('calToday').click(); else if (k === 'w') setMode('week'); else if (k === 'm') setMode('month'); else if (k === 'l') setMode('list');
    else if (k === 'n' || k === 'c') { e.preventDefault(); e.stopImmediatePropagation(); openNew({}); }
    else return;
    e.preventDefault();
  }, true);
  setInterval(() => { if (view === 'cal') placeNow(); }, 60e3);
  setInterval(() => { if (view === 'cal' && status && status.configured && document.visibilityState === 'visible' && $('evModal').classList.contains('hidden')) load(); }, 3 * 60e3);

  // ---------- event dialog ----------
  let edit = null, fromMail = null, delArm = 0;
  const writable = () => ((data.calendars && data.calendars.length ? data.calendars : (status && status.calendars)) || []).filter(c => !c.readOnly);
  const timeStr = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  function fill(e) {
    const cals = (data.calendars && data.calendars.length ? data.calendars : (status && status.calendars)) || [];
    const ro = e.cal && (cals.find(c => c.id === e.cal) || {}).readOnly, locked = ro || e.recurring;
    $('evCal').innerHTML = (locked ? cals.filter(c => c.id === e.cal) : writable()).map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    $('evCal').value = e.cal || store('default') || (writable()[0] || {}).id || '';
    if (!$('evCal').value && $('evCal').options.length) $('evCal').selectedIndex = 0;
    $('evTitle').value = e.title || ''; $('evLoc').value = e.location || ''; $('evNotes').value = e.notes || '';
    $('evAllDay').checked = !!e.allDay;
    const s = e.startD, en = e.endD;
    $('evSD').value = key(s); $('evED').value = key(e.allDay ? addDays(en, -1) : en);
    $('evST').value = timeStr(s); $('evET').value = timeStr(en);
    $('evAlarm').value = e.alarm == null ? '' : String(e.alarm);
    if ($('evAlarm').value === '' && e.alarm != null) { $('evAlarm').insertAdjacentHTML('beforeend', `<option value="${e.alarm}">${e.alarm} Min. vorher</option>`); $('evAlarm').value = String(e.alarm); }
    toggleAllDay();
    for (const id of ['evTitle', 'evCal', 'evAllDay', 'evSD', 'evST', 'evED', 'evET', 'evLoc', 'evNotes', 'evAlarm']) $(id).disabled = !!locked;
    $('evSave').classList.toggle('hidden', !!locked); $('evDel').classList.toggle('hidden', !e.href || !!locked);
    $('evNote').textContent = ro ? 'Dieser Kalender ist schreibgeschützt.' : e.recurring ? 'Wiederkehrender Termin – Serien bitte in der Kalender-App auf iPhone oder Mac bearbeiten.' : '';
    $('evDel').textContent = 'Löschen'; delArm = 0;
  }
  function toggleAllDay() { const on = $('evAllDay').checked; $('evST').classList.toggle('hidden', on); $('evET').classList.toggle('hidden', on); }
  $('evAllDay').addEventListener('change', toggleAllDay);
  let lastStart = null;
  function readStart() { return $('evAllDay').checked ? parseDay($('evSD').value) : new Date(`${$('evSD').value}T${$('evST').value || '00:00'}`); }
  function readEnd() { return $('evAllDay').checked ? parseDay($('evED').value) : new Date(`${$('evED').value}T${$('evET').value || '00:00'}`); }
  // moving the start keeps the duration
  ['evSD', 'evST'].forEach(id => { $(id).addEventListener('focus', () => { lastStart = readStart(); }); $(id).addEventListener('change', () => {
    const s = readStart(); if (!lastStart || isNaN(s) || isNaN(lastStart)) return;
    const en = new Date(+readEnd() + (s - lastStart)); if (!isNaN(en)) { $('evED').value = key(en); $('evET').value = timeStr(en); }
    lastStart = s;
  }); });
  function showEv() { $('evModal').classList.remove('hidden'); setTimeout(() => { if (!$('evTitle').disabled) { $('evTitle').focus(); if (!edit) $('evTitle').select(); } }, 30); }
  function closeEv() { $('evModal').classList.add('hidden'); edit = null; fromMail = null; }
  function openEvent(e) {
    edit = e; fromMail = null;
    $('evHead').textContent = 'Termin'; $('evMailRow').classList.add('hidden');
    fill({ ...e, startD: evStart(e), endD: evEnd(e) });
    showEv();
  }
  function openNew(o) {
    edit = null; fromMail = o.mail || null;
    let s = o.start ? new Date(o.start) : (() => { const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); if (mode !== 'list' && !same(anchor, startOfDay(new Date())) && range()[0] <= anchor) { const x = new Date(anchor); x.setHours(10); return x; } return d; })();
    const en = new Date(+s + (o.minutes || 60) * 60e3);
    $('evHead').textContent = o.mail ? 'Termin aus E-Mail' : 'Neuer Termin';
    $('evMailRow').classList.toggle('hidden', !o.mail); $('evMail').checked = !!o.reply;
    fill({ cal: o.cal, title: o.title || '', location: o.location || '', notes: o.notes || '', allDay: false, alarm: o.alarm === undefined ? 15 : o.alarm, startD: s, endD: en });
    showEv();
  }
  $('evClose').onclick = closeEv; $('evCancel').onclick = closeEv;
  $('evModal').addEventListener('mousedown', e => { if (e.target === $('evModal')) closeEv(); });
  $('evForm').addEventListener('submit', async e => {
    e.preventDefault();
    const allDay = $('evAllDay').checked, s = readStart(), en = readEnd();
    if (isNaN(s) || isNaN(en)) return A.toast('Bitte Datum und Uhrzeit angeben', true);
    if (!allDay && en <= s) return A.toast('Das Ende liegt vor dem Beginn', true);
    if (allDay && en < s) return A.toast('Das Ende liegt vor dem Beginn', true);
    const body = { cal: $('evCal').value, title: $('evTitle').value.trim(), location: $('evLoc').value.trim(), notes: $('evNotes').value, allDay, alarm: $('evAlarm').value,
      start: allDay ? key(s) : s.toISOString(), end: allDay ? key(addDays(en, 1)) : en.toISOString(), ...(edit ? { href: edit.href, etag: edit.etag } : {}) };
    if (!body.cal) return A.toast(status && status.error ? 'Kalender: ' + status.error : !writable().length && ((data.calendars || []).length || (status && (status.calendars || []).length)) ? 'Alle Kalender sind schreibgeschützt – siehe „Diagnose anzeigen“ im Kalender' : 'Keine Kalender gefunden – siehe „Diagnose anzeigen“ im Kalender', true);
    $('evSave').disabled = true;
    try {
      await A.call('cal/save', body);
      store('default', body.cal);
      const mail = fromMail, reply = mail && $('evMail').checked, snap = { ...body, startD: s, endD: allDay ? addDays(en, 1) : en };
      closeEv();
      A.toast(edit ? 'Termin gespeichert ✓' : 'Termin eingetragen ✓ – erscheint gleich auch auf deinem iPhone');
      if (view === 'cal') { anchor = mode === 'list' ? anchor : startOfDay(s); refresh(); } else if (VIEWS.dash && view === 'dash') VIEWS.dash.enter();
      if (reply) replyWithInvite(mail.m, mail.info, snap);
    } catch (err) { A.toast(err.message, true); }
    $('evSave').disabled = false;
  });
  $('evDel').onclick = async () => {
    if (!edit) return;
    if (!delArm) { delArm = 1; $('evDel').textContent = 'Wirklich löschen?'; setTimeout(() => { if (delArm) { delArm = 0; $('evDel').textContent = 'Löschen'; } }, 4000); return; }
    delArm = 0;
    try { await A.call('cal/delete', { href: edit.href, etag: edit.etag }); closeEv(); A.toast('Termin gelöscht ✓'); refresh(); } catch (err) { A.toast(err.message, true); }
  };

  // ---------- from a mail ----------
  const field = (t, k) => { const m = String(t || '').match(new RegExp('^' + k + ':\\s*(.+)$', 'mi')); return m ? m[1].trim() : ''; };
  function mailInfo(m) {
    const t = m.text || '', team = /team-bewerbung/i.test(m.subject || '') || !!field(t, 'Bereich');
    const name = field(t, 'Name') || (m.from && m.from[0] && m.from[0].name) || '';
    const email = field(t, 'E-Mail') || ((m.replyTo || [])[0] || {}).address || ((m.from || [])[0] || {}).address || '';
    return { team, name, first: A.firstName(name) || name, role: field(t, 'Bereich'), discord: field(t, 'Discord'), email };
  }
  function fromMailOpen(m) {
    if (status && status.for !== ME) status = null;
    if (!status) return A.call('cal/status').then(s => { status = s; status.for = ME; fromMailOpen(m); }).catch(e => A.toast(e.message, true));
    if (!status.configured) { A.toast('Kalender ist noch nicht verbunden – unter „Kalender“ einrichten', true); return; }
    const i = mailInfo(m), s = new Date(); s.setDate(s.getDate() + 1); s.setHours(18, 0, 0, 0);
    const notes = [i.email && 'E-Mail: ' + i.email, i.discord && 'Discord: ' + i.discord, i.role && 'Bewerbung als: ' + i.role, 'Mail: ' + (m.subject || '')].filter(Boolean).join('\n');
    openNew(i.team
      ? { mail: { m, info: i }, reply: true, cal: (writable().find(c => /aera|dev|team|arbeit|work/i.test(c.name)) || {}).id, title: `Kennenlernen: ${i.name || i.email}${i.role ? ' (' + i.role + ')' : ''}`, location: 'AERA-Discord (Sprach-Chat)', notes, start: s, minutes: 30, alarm: 15 }
      : { mail: { m, info: i }, reply: false, title: (m.subject || 'Termin').replace(/^\s*((re|aw|fwd?|wg):\s*)+/i, ''), notes, start: s, minutes: 60, alarm: 15 });
  }
  function icsFor(ev, info) {
    const z = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const e = v => String(v || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
    const me = A.myName(), title = info.team ? 'AERA – Kennenlernen' + (me ? ' mit ' + me.split(/\s+/)[0] : '') : ev.title;
    const desc = info.team ? 'Kurzes Kennenlernen fürs AERA-Team im Discord-Sprach-Chat.\nDiscord: https://discord.gg/aera' : '';
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//aerastudios.de//Admin//DE', 'METHOD:PUBLISH', 'BEGIN:VEVENT', 'UID:' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '@aerastudios.de'), 'DTSTAMP:' + z(new Date()),
      ...(ev.allDay ? ['DTSTART;VALUE=DATE:' + ev.start.replace(/-/g, ''), 'DTEND;VALUE=DATE:' + ev.end.replace(/-/g, '')] : ['DTSTART:' + z(ev.startD), 'DTEND:' + z(ev.endD)]),
      'SUMMARY:' + e(title), ...(ev.location ? ['LOCATION:' + e(ev.location)] : []), ...(desc ? ['DESCRIPTION:' + e(desc)] : []), 'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Erinnerung', 'TRIGGER:-PT15M', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR', ''];
    const txt = L.join('\r\n'), bytes = new TextEncoder().encode(txt);
    let bin = ''; bytes.forEach(b => bin += String.fromCharCode(b));
    return { name: 'termin.ics', type: 'text/calendar', size: bytes.length, data: btoa(bin) };
  }
  function replyWithInvite(m, info, ev) {
    A.openCompose('reply', m);
    const de = !/\b(hello|hi|thanks|application|i am|i'm|my name)\b/i.test(m.text || '') || /\b(ich|und|bewerbung|hallo)\b/i.test(m.text || '');
    const d = ev.startD, en = ev.endD;
    const when = de ? (ev.allDay ? d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }) : `${d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })} um ${hm(d)} Uhr`)
      : (ev.allDay ? d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) : `${d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} at ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} (German time)`);
    const mins = ev.allDay ? 0 : Math.round((en - d) / 60e3), hi = info.first ? (de ? 'Hallo ' + info.first : 'Hi ' + info.first) : (de ? 'Hallo' : 'Hi');
    const body = info.team
      ? (de ? `${hi},\n\ndanke für deine Bewerbung${info.role ? ' als ' + info.role : ''}! Ich würde dich gerne kurz kennenlernen – wie wäre es mit ${when}?\n\nWir treffen uns im AERA-Discord im Sprach-Chat (ca. ${mins || 30} Minuten). Falls du noch nicht auf dem Server bist: discord.gg/aera\n\nIm Anhang findest du den Termin für deinen Kalender. Wenn es dir nicht passt, schreib mir einfach einen anderen Vorschlag.\n\nViele Grüße\n${A.myName()}`
        : `${hi},\n\nthanks for your application${info.role ? ' as ' + info.role : ''}! I'd love to get to know you – how about ${when}?\n\nWe'll meet in the AERA Discord in a voice channel (about ${mins || 30} minutes). If you're not on the server yet: discord.gg/aera\n\nThe appointment is attached for your calendar. If it doesn't suit you, just suggest another time.\n\nBest regards\n${A.myName()}`)
      : (de ? `${hi},\n\nich habe uns den Termin eingetragen: ${when}${ev.location ? ', ' + ev.location : ''}. Im Anhang findest du ihn für deinen Kalender.\n\nViele Grüße\n${A.myName()}` : `${hi},\n\nI've put it in the calendar: ${when}${ev.location ? ', ' + ev.location : ''}. The appointment is attached for your calendar.\n\nBest regards\n${A.myName()}`);
    A.composeFill(body, [icsFor(ev, info)]);
  }

  // ---------- dashboard panel ----------
  function dashPanel(c) {
    if (!c || c.configured === false) return `<div class="empty">Dein Kalender ist noch nicht verbunden. <button class="link" data-view="cal">Jetzt verbinden →</button></div>`;
    if (c.error) return `<div class="empty">${esc(c.error)}</div>`;
    const cals = c.calendars || [], list = (c.events || []).filter(e => !hidden.has(e.cal));
    if (!list.length) return '<div class="empty">Keine Termine in den nächsten zwei Wochen.</div>';
    let last = '';
    return list.map(e => {
      const s = evStart(e), lab = dayLabel(startOfDay(s)), head = lab !== last ? `<div class="dcal-day">${esc(lab)}</div>` : ''; last = lab;
      const col = (cals.find(x => x.id === e.cal) || {}).color || '#888';
      return `${head}<button class="dcal-ev" data-calopen="${esc(e.id)}" data-calday="${esc(key(startOfDay(s)))}" style="--c:${esc(col)}"><span class="bar"></span><span class="t">${e.allDay ? 'ganztägig' : hm(s)}</span><span class="ti"><b>${esc(e.title)}</b>${e.location ? `<small>${esc(e.location)}</small>` : ''}</span></button>`;
    }).join('');
  }
  document.addEventListener('click', e => { const b = e.target.closest('[data-calopen]'); if (b) { if (mode === 'month') mode = 'week'; A.show('cal', { date: parseDay(b.dataset.calday), open: b.dataset.calopen }); } });

  VIEWS.cal = { enter };
  window.CAL = { fromMail: fromMailOpen, dashPanel, openNew };
})();
