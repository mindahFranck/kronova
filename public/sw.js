/* Kronova — service worker (sans dépendance).
 * Incrémenter CACHE_VERSION à chaque changement de l'app shell précaché.
 */
const CACHE_VERSION = 'v2';
const SHELL_CACHE = `kronova-shell-${CACHE_VERSION}`;
const ASSETS_CACHE = `kronova-assets-${CACHE_VERSION}`;
const KNOWN_CACHES = [SHELL_CACHE, ASSETS_CACHE];

const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/apple-touch-icon.png',
];

// Chemins jamais interceptés (API, WebSocket Gemini Live, téléchargements).
const BYPASS_PREFIXES = ['/api/', '/live', '/downloads/'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: 'reload' })))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('kronova-') && !KNOWN_CACHES.includes(key))
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function shouldBypass(request, url) {
  if (request.method !== 'GET') return true;
  if (url.origin !== self.location.origin) return true;
  if (BYPASS_PREFIXES.some((p) => url.pathname === p.replace(/\/$/, '') || url.pathname.startsWith(p))) {
    return true;
  }
  if (request.headers.get('accept')?.includes('text/event-stream')) return true;
  return false;
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok && response.type === 'basic') {
      const cache = await caches.open(SHELL_CACHE);
      cache.put('/index.html', response.clone());
    }
    return response;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    return (
      (await cache.match('/index.html')) ||
      (await cache.match('/')) ||
      new Response('<h1>Hors-ligne</h1>', {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    );
  }
}

async function cacheFirstAsset(request) {
  const cache = await caches.open(ASSETS_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok && response.type === 'basic') {
    cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidateShell(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok && response.type === 'basic') cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || network;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (shouldBypass(request, url)) return; // laisse passer le réseau

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirstAsset(request));
    return;
  }

  if (APP_SHELL.includes(url.pathname)) {
    event.respondWith(staleWhileRevalidateShell(request));
  }
  // Autres requêtes same-origin : comportement réseau par défaut.
});
