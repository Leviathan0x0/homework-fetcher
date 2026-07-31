const CACHE_NAME = 'homework-pwa-v4';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon.svg'
];

// Install Event: Skip waiting immediately
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

// Activate Event: Delete all old caches and claim clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

/**
 * Build output is fingerprinted (/assets/index-a1b2c3.js), so its contents can
 * never change behind a URL. Those requests are answered straight from the
 * cache instead of waiting for the network on every single navigation.
 */
function isImmutableAsset(url) {
  if (url.origin !== self.location.origin) return false;
  return (
    url.pathname.startsWith('/assets/') ||
    /\.(woff2?|ttf|otf|png|jpe?g|gif|svg|webp|ico)$/i.test(url.pathname)
  );
}

// Fetch Event: cached-first for immutable build assets, network-first for
// everything else so HTML and API data stay fresh (with an offline fallback).
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Ignore chrome extensions or non-http requests
  if (!url.protocol.startsWith('http')) return;

  // Writes must always reach the server; passing them through the worker only
  // adds overhead to every action a student takes.
  if (event.request.method !== 'GET') return;

  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});
