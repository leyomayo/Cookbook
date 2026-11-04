/*
 * sw.js — service worker that makes the app work offline.
 *
 * On install it downloads every app file into a cache. After that, files
 * are served from the cache first, so the app opens instantly with no
 * connection. Recipes themselves live in IndexedDB, not here.
 *
 * WHEN YOU CHANGE ANY APP FILE: bump CACHE_VERSION below. The browser sees
 * sw.js has changed, installs the new version in the background, and the
 * next launch of the app uses the fresh files.
 */

const CACHE_VERSION = 'v4';
const CACHE_NAME = `cookbook-${CACHE_VERSION}`;

// Relative paths, so this works under https://<user>.github.io/<repo>/.
const APP_FILES = [
  './',
  'index.html',
  'css/styles.css',
  'js/model.js',
  'js/tags.js',
  'js/transfer.js',
  'js/db.js',
  'js/app.js',
  'manifest.webmanifest',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // cache: 'reload' skips the browser's HTTP cache so we store fresh copies.
      .then((cache) => cache.addAll(APP_FILES.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

// Delete caches left over from older versions.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('cookbook-') && k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    // ignoreSearch: "index.html?source=pwa" still matches the cached page.
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(request).catch(() => {
        // Offline and not cached: for page loads, fall back to the app shell.
        if (request.mode === 'navigate') return caches.match('index.html');
        return Response.error();
      });
    })
  );
});
