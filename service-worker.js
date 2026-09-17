/* LankaLens PWA service worker.
   Deliberately network-only: it enables installability without caching marketplace
   pages, API responses, authentication state, or stale listing data. */
const VERSION = 'lankalens-pwa-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // Keep behaviour identical to the normal website: always use the network.
  event.respondWith(fetch(event.request));
});
