/* dev-dsue.de – cookie / storage consent.
   Necessary: login session cookies (/beta, /admin) and this choice itself – always on.
   Optional ("Einstellungen merken"): language + light/dark choice in localStorage – only after "Akzeptieren". */
(function () {
  var KEY = 'consent', OPT = ['theme', 'lang'];
  var ls; try { ls = window.localStorage; } catch (e) { return; }
  function get() { try { return ls.getItem(KEY); } catch (e) { return null; } }
  var raw = Storage.prototype.setItem;
  // block optional keys until the visitor has accepted
  Storage.prototype.setItem = function (k, v) {
    if (this === ls && OPT.indexOf(k) >= 0 && get() !== 'all') return;
    return raw.call(this, k, v);
  };
  function set(v) {
    try { raw.call(ls, KEY, v); } catch (e) {}
    if (v !== 'all') OPT.forEach(function (k) { try { ls.removeItem(k); } catch (e) {} });
    else {
      // keep what the visitor already chose on this page
      try { raw.call(ls, 'theme', document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'); } catch (e) {}
      try { var a = document.querySelector('[data-lang].on,[data-lang].active,[data-lang][aria-pressed="true"]'); if (a) raw.call(ls, 'lang', a.dataset.lang); } catch (e) {}
    }
  }
  var en = (function () { try { var l = ls.getItem('lang'); if (l) return l === 'en'; } catch (e) {} return !/^de/i.test(navigator.language || ''); })();
  var T = en ? {
    t: 'Cookies & storage', p: 'This site uses no tracking or advertising. Necessary cookies are only set when you sign in (beta area). With your consent your browser also remembers your language and light/dark mode.',
    a: 'Accept', r: 'Decline', more: 'Privacy policy', link: 'Cookie settings'
  } : {
    t: 'Cookies & Speicher', p: 'Diese Seite nutzt kein Tracking und keine Werbung. Notwendige Cookies werden nur beim Anmelden (Beta-Bereich) gesetzt. Mit deiner Zustimmung merkt sich dein Browser außerdem deine Sprache und den Hell/Dunkel-Modus.',
    a: 'Akzeptieren', r: 'Ablehnen', more: 'Datenschutz', link: 'Cookie-Einstellungen'
  };
  var css = '#cc{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:99999;width:min(640px,calc(100% - 24px));padding:18px 20px;border-radius:18px;' +
    'background:rgba(14,16,22,.92);color:#eef1f6;border:1px solid rgba(255,255,255,.14);box-shadow:0 24px 70px rgba(0,0,0,.45);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);' +
    'font:14px/1.5 Inter,system-ui,-apple-system,Segoe UI,sans-serif;animation:ccIn .35s ease}' +
    '@keyframes ccIn{from{opacity:0;transform:translate(-50%,16px)}}' +
    '#cc b{display:block;font-size:15px;margin-bottom:4px}#cc p{margin:0 0 14px;color:#c4cad6}#cc a{color:#9fc7ff}' +
    '#cc .cc-r{display:flex;gap:10px;align-items:center;flex-wrap:wrap}#cc .cc-r a{margin-right:auto;font-size:13px}' +
    '#cc button{font:600 14px Inter,system-ui,sans-serif;height:40px;padding:0 20px;border-radius:12px;cursor:pointer;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.06);color:#eef1f6}' +
    '#cc button.y{background:linear-gradient(180deg,#f4f6fa,#b9c0cc);color:#0b0d12;border-color:transparent}' +
    '#cc button:hover{filter:brightness(1.08)}' +
    '.cc-open{background:none;border:0;padding:0;font:inherit;color:inherit;opacity:.85;cursor:pointer;text-decoration:none}.cc-open:hover{opacity:1;text-decoration:underline}' +
    '@media(max-width:520px){#cc .cc-r button{flex:1}#cc .cc-r a{width:100%}}';
  function show() {
    if (document.getElementById('cc')) return;
    var d = document.createElement('div'); d.id = 'cc'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', T.t);
    d.innerHTML = '<b>🍪 ' + T.t + '</b><p>' + T.p + '</p><div class="cc-r"><a href="/datenschutz.html">' + T.more + '</a>' +
      '<button type="button" class="n">' + T.r + '</button><button type="button" class="y">' + T.a + '</button></div>';
    d.querySelector('.y').onclick = function () { set('all'); d.remove(); };
    d.querySelector('.n').onclick = function () { set('necessary'); d.remove(); };
    document.body.appendChild(d);
  }
  function init() {
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    // "Cookie settings" link in every footer
    var f = document.querySelector('footer .in') || document.querySelector('footer');
    if (f) { var b = document.createElement('button'); b.type = 'button'; b.className = 'cc-open'; b.textContent = T.link; b.onclick = show; f.appendChild(b); }
    if (!get()) show();
  }
  window.dsueConsent = show;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
