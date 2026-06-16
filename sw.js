// ============================================================
// sw.js — Service Worker: Cache-first offline support v3
// ============================================================

const CACHE_VER  = 'v87';
const APP_CACHE  = `my-planner-app-${CACHE_VER}`;
const CDN_CACHE  = `my-planner-cdn-${CACHE_VER}`;

// App shell — all JS modules + static assets
const APP_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './css/style.css',
  './js/app.js',
  './js/storage.js',
  './js/datepicker.js',

  './js/ai.js',
  './js/utils.js',
  './js/modules/home.js',
  './js/modules/calendar.js',
  './js/modules/tasks.js',
  './js/modules/goals.js',
  './js/modules/settings.js',
  './js/modules/today.js',
  './js/modules/knowledge.js',
  './js/modules/knowledge-graph.js',
  './js/modules/analytics.js',
  './js/modules/search.js',
  './js/modules/archive.js',
  './js/modules/review.js',
  './js/modules/tagspage.js',
  './js/supabase.js',
  './js/sync.js',
  './js/migrate.js',
];

// CDN hostnames to cache with stale-while-revalidate
const CDN_HOSTS = [
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com',
];

// Never intercept Supabase API calls (they must always go to network)
const SUPABASE_SKIP = ['supabase.co', 'supabase.io'];

// ---- Install ----
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then(cache => cache.addAll(
        APP_ASSETS.map(u => new Request(u, { cache: 'no-cache' }))
      ))
      .catch(err => console.warn('[SW] Install cache failed (ok on file://):', err))
  );
  self.skipWaiting();
});

// ---- Activate ----
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => k !== APP_CACHE && k !== CDN_CACHE)
        .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// ---- Fetch ----
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // ① Never cache Anthropic API calls or Supabase API calls
  if (url.hostname === 'api.anthropic.com') return;
  if (SUPABASE_SKIP.some(h => url.hostname.includes(h))) return;

  // ② CDN resources: stale-while-revalidate
  if (CDN_HOSTS.some(h => url.hostname.includes(h))) {
    event.respondWith(staleWhileRevalidate(req, CDN_CACHE));
    return;
  }

  // ③ Same-origin app assets: cache-first with network fallback
  if (url.origin === location.origin) {
    event.respondWith(cacheFirst(req));
    return;
  }
});

// ---- Strategy: cache-first ----
async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;

  try {
    const response = await fetch(req);
    if (response.ok) {
      const cache = await caches.open(APP_CACHE);
      cache.put(req, response.clone());
    }
    return response;
  } catch {
    // Return offline fallback for navigation requests
    if (req.mode === 'navigate') {
      const fallback = await caches.match('./index.html');
      if (fallback) return fallback;
    }
    return new Response(
      JSON.stringify({ error: 'offline' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// ---- Strategy: stale-while-revalidate ----
async function staleWhileRevalidate(req, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(req);

  // Kick off network fetch in background
  const networkPromise = fetch(req)
    .then(res => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);

  return cached ?? (await networkPromise) ?? new Response('', { status: 503 });
}

// ---- Message handler: force update cache ----
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CACHE_URLS') {
    const urls = event.data.urls || [];
    caches.open(APP_CACHE)
      .then(cache => cache.addAll(urls.map(u => new Request(u, { cache: 'no-cache' }))))
      .catch(() => {});
  }
});
