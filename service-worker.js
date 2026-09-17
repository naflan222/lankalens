/* LankaLens PWA service worker.
   Deliberately network-only: it enables installability without caching marketplace
   pages, API responses, authentication state, or stale listing data.

   Important: external resources (including Backblaze B2 listing/shop images) are
   left completely untouched so the browser loads their signed URLs directly. */
const VERSION = 'lankalens-pwa-v3';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);

  // Never proxy third-party/cross-origin resources through the service worker.
  // LankaLens listing photos and shop logos can be temporary signed Backblaze B2
  // URLs, so they must go directly from the browser to B2 unchanged.
  if (requestUrl.origin !== self.location.origin) return;

  // Same-origin behaviour stays identical to the normal website: always network.
  event.respondWith(fetch(event.request));
});
