// Hope Studio service worker: makes the app installable and lets the shell
// open without a connection. Network first, so updates show up right away;
// the API and uploaded media are never cached.

const CACHE = 'hope-studio-shell-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/') || url.pathname.includes('/media/')) return;
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    } catch {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const shell = await caches.match(new URL('./', self.location).href) || await caches.match(new URL('./index.html', self.location).href);
        if (shell) return shell;
      }
      return new Response('Hope Studio is offline. Reconnect to load this page.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }
  })());
});
