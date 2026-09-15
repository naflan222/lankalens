(function () {
  'use strict';

  // Keep production sign-in clean: remove the old demo-credentials hint that
  // is still emitted by the legacy app.js login view. This runs after app.js
  // and also watches SPA route re-renders.
  function cleanSignInDemoHint() {
    if (window.location.hash.indexOf('#/sign-in') !== 0) return;
    var wrap = document.querySelector('.auth-wrap');
    if (!wrap) return;
    var hints = wrap.querySelectorAll('p.form-hint');
    Array.prototype.forEach.call(hints, function (hint) {
      var prev = hint.previousElementSibling;
      var next = hint.nextElementSibling;
      if (prev && next && prev.classList.contains('flex') && next.classList.contains('auth-alt')) {
        hint.remove();
      }
    });
  }

  cleanSignInDemoHint();
  window.addEventListener('hashchange', function () {
    window.setTimeout(cleanSignInDemoHint, 0);
  });

  var page = document.getElementById('page');
  if (page && window.MutationObserver) {
    new MutationObserver(cleanSignInDemoHint).observe(page, { childList: true, subtree: true });
  }
}());
