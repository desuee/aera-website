// aerastudios.de – /admin/downloads: how often the AERA beta was downloaded – by Desue
(function () {
  try { if (localStorage.getItem('theme') === 'light') delete document.documentElement.dataset.theme; } catch (e) {}
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const dt = t => new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  async function load() {
    const r = await fetch('/api/downloads', { credentials: 'same-origin' });
    if (r.status === 401) { location.href = '/admin/'; return; }
    const d = await r.json();
    if (!r.ok) { $('#sub').innerHTML = '<span class="err">' + esc(d.error || 'Fehler') + '</span>'; return; }
    const rows = d.releases.flatMap(rel => rel.assets.filter(a => /\.(exe|zip|msi|dmg)$/i.test(a.name)).map(a => ({ rel, a })));
    const total = rows.reduce((s, x) => s + x.a.downloads, 0), max = Math.max(1, ...rows.map(x => x.a.downloads));
    const latest = rows[0];
    $('#sub').textContent = 'Zahlen von GitHub (bleiben dauerhaft erhalten) · Stand ' + dt(Date.now());
    $('#cards').innerHTML = [
      ['Downloads gesamt', total],
      ['Neueste Version', latest ? latest.a.downloads : 0, latest ? latest.rel.tag : ''],
      ['Versionen', d.releases.length],
      ['Tester seit Neustart', d.users.length, 'seit ' + dt(d.since)]
    ].map(([k, v, s]) => `<div class="card">${esc(k)}<b>${esc(v)}</b>${s ? `<small>${esc(s)}</small>` : ''}</div>`).join('');
    $('#rel tbody').innerHTML = rows.map(({ rel, a }) => `<tr><td><b>${esc(rel.tag)}</b></td><td>${esc(a.name)}</td><td>${rel.date ? dt(rel.date) : ''}</td><td class="n">${a.downloads}</td><td style="width:30%"><div class="bar" style="width:${a.downloads / max * 100}%"></div></td></tr>`).join('') || '<tr><td colspan="5">Noch keine Releases</td></tr>';
    $('#usr tbody').innerHTML = d.users.map(([n, c]) => `<tr><td>${esc(n)}</td><td class="n">${c}</td></tr>`).join('') || '<tr><td colspan="2">Seit dem letzten Neustart noch niemand</td></tr>';
    $('#log tbody').innerHTML = d.log.map(x => `<tr><td>${dt(x.t)}</td><td>${esc(x.user)}</td><td>${esc(x.file)}</td></tr>`).join('') || '<tr><td colspan="3">–</td></tr>';
  }
  load().catch(e => { $('#sub').innerHTML = '<span class="err">' + esc(e.message) + '</span>'; });
})();
