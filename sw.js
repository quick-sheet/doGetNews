/* doGet(news) service worker: works offline, picks up updates on the next open. */
const CACHE = 'dogetnews-v13';   // bump on every release, together with core.js?v= in index.html
const SHELL = ['./', 'index.html', 'core.js', 'gemini.js', 'manifest.webmanifest', 'logo.png', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  // 'reload' skips the browser's own copy, so the offline set is always the release just published
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const FONTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // App files and brief.json: network first so the newest brief and release arrive straight away,
  // the saved copy when offline. 'no-cache' asks GitHub every time (a quick "unchanged" when nothing's new).
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const net = req.mode === 'navigate' ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(req, { cache: 'no-cache' });
        const res = await Promise.race([
          net,
          new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 6000)),
        ]);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        const hit = await cache.match(req, { ignoreSearch: true });
        if (hit && url.pathname.endsWith('/brief.json')) {
          // Tell the page this is the saved copy, so it can say so
          const h = new Headers(hit.headers);
          h.set('x-dgn-saved', '1');
          return new Response(await hit.blob(), { status: 200, headers: h });
        }
        return hit || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
      }
    })());
    return;
  }

  // Fonts: cache first
  if (FONTS.test(req.url)) {
    e.respondWith(caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    }));
  }
  // Everything else (video thumbnails) goes straight to the network
});
