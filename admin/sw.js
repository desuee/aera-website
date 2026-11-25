// AERA Admin – service worker: makes the admin installable as an app.
// Always loads fresh from the server; the cached copy is only a fallback when offline. Never touches /api/ (mail data stays live).
const CACHE = 'aera-admin-v2';
const SHELL = ['/admin/', '/admin/style.css', '/admin/app.js', '/admin/views.js', '/admin/cal.js', '/img/brand-symbol.svg', '/img/brand-favicon-64.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  const shell = r.mode === 'navigate' && (u.pathname === '/admin/' || u.pathname === '/admin');
  if (!shell && !SHELL.includes(u.pathname)) return;
  e.respondWith(fetch(r).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(shell ? '/admin/' : u.pathname, copy)); }
    return res;
  }).catch(() => caches.match(shell ? '/admin/' : u.pathname).then(m => m || new Response('<!doctype html><meta charset="utf-8"><title>Offline</title><body style="background:#060708;color:#ddd;font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0"><p>Keine Internetverbindung – bitte gleich nochmal versuchen.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))));
});
