/* Register the LankaLens service worker. No caching is enabled. */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(function (err) {
      console.warn('LankaLens service worker registration failed:', err);
    });
  });
})();
