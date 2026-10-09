// Offline support: cache the app files, serve them cache-first, and refresh
// the cache in the background. Bump VERSION whenever you deploy changes.
const VERSION = 'fittrack-v8';
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/config.js',
  'js/drafts.js',
  'js/profiles.js',
  'js/seed.js',
  'js/share.js',
  'js/stats.js',
  'js/store.js',
  'js/sync.js',
  'js/ui.js',
  'js/util.js',
  'js/views/common.js',
  'js/views/exercises.js',
  'js/views/logsheets.js',
  'js/views/plans.js',
  'js/views/profile.js',
  'js/views/progress.js',
  'js/views/settings.js',
  'js/views/today.js',
  'js/views/workout.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Only handle our own files; Google sign-in and Drive calls go straight to the network.
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      const fresh = fetch(e.request)
        .then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; })
        .catch(() => cached);
      return cached || fresh;
    }),
  );
});
