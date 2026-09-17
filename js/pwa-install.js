/* Register the LankaLens service worker. No caching is enabled. */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/service-worker.js?v=2', {
      scope: '/',
      updateViaCache: 'none'
    }).then(function (registration) {
      registration.update().catch(function () { /* browser will retry later */ });
    }).catch(function (err) {
      console.warn('LankaLens service worker registration failed:', err);
    });
  });
})();
