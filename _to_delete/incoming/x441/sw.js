/* ==========================================================================
   AraBuzz — sw.js
   The service worker. This is what makes AraBuzz genuinely live on the device.

   Without it, Safari has to fetch the app from wherever it was served every
   single time — so if the computer serving it is switched off, or the wifi is
   down, the app will not open at all. Her data would still be safe on the iPad,
   but she could not reach it, which amounts to the same thing on a Tuesday
   night before a spelling test.

   With it, the whole app is stored on the device after the very first load.
   From then on it opens with the computer off, the wifi off, in the car.

   What still needs the internet, and only these:
     · reading a new Spell Buzz PDF
     · building practice material for new words
     · the coach report and memory tricks
   Everything else — every game, the garden, her whole history — is local.
   ========================================================================== */

const VERSION = 'arabuzz-v4.41';
const CORE = 'core-' + VERSION;

/* Everything the app needs to start from nothing. If you add a file to the
   project, add it here — _test/offline.js fails the build if you forget. */
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/theme.css',
  './js/icons.js',
  './js/config.js',
  './js/store.js',
  './js/vault.js',
  './js/phonics.js',
  './js/puzzles.js',
  './js/engine.js',
  './js/game.js',
  './js/charts.js',
  './js/ara.js',
  './js/garden.js',
  './js/scene.js',
  './js/cloud.js',
  './js/sync.js',
  './js/util.js',
  './js/api.js',
  './js/quiz.js',
  './js/parent.js',
  './js/admin.js',
  './js/onboard.js',
  './js/ui.js',
  './vendor/fonts/fonts.css',
  './vendor/fonts/fraunces-latin-full-normal.woff2',
  './vendor/fonts/lexend-latin-300-normal.woff2',
  './vendor/fonts/lexend-latin-400-normal.woff2',
  './vendor/fonts/lexend-latin-500-normal.woff2',
  './vendor/fonts/lexend-latin-600-normal.woff2',
  './vendor/supabase.js',
  './vendor/pdf.min.js',
  './vendor/pdf.worker.min.js',
  './assets/icon-180.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/logo.svg',
  './assets/cokindle-labs.svg'
];

/* Deliberately not cached:
     lan.js      — the serving computer's address, different every session
     connect.html, vendor/qrcode.js — only ever opened on the computer itself
     the Anthropic API — never cached, and POSTs are not cacheable anyway   */

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CORE);
    // One at a time, so a single 404 cannot silently abandon the whole install.
    await Promise.all(SHELL.map(async url => {
      try { await cache.add(new Request(url, { cache: 'reload' })); }
      catch (err) { console.warn('[sw] could not cache', url, err); }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CORE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
  if (e.data === 'version' && e.source) e.source.postMessage({ version: VERSION });
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      // API, fonts elsewhere: not ours
  if (url.pathname.endsWith('/lan.js')) return;          // always fresh, may not exist
  if (url.pathname.startsWith('/__')) return;            // the backup + ping routes

  /* A page request: serve the app shell straight from the cache so it opens
     instantly and works with nothing behind it. */
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CORE);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (err) {
        const cache = await caches.open(CORE);
        return (await cache.match('./index.html')) || (await cache.match('./')) ||
               new Response('AraBuzz is not installed on this device yet.',
                            { headers: { 'Content-Type': 'text/plain' } });
      }
    })());
    return;
  }

  /* Everything else: from the cache first (fast, and works offline), then
     quietly refresh it in the background for next time. */
  e.respondWith((async () => {
    const cache = await caches.open(CORE);
    const hit = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req).then(res => {
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    return hit || (await network) || new Response('', { status: 504 });
  })());
});
