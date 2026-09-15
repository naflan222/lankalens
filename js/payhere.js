/* LankaLens PayHere bridge.
   app.js owns the Promote UI and API client. This small bridge observes only the
   promotion-purchase response and turns the server-generated checkout fields
   into the form POST required by PayHere. No merchant secret is ever present in
   the browser. */
(function () {
  'use strict';

  if (!window.fetch || window.__LL_PAYHERE_BRIDGE__) return;
  window.__LL_PAYHERE_BRIDGE__ = true;

  var nativeFetch = window.fetch.bind(window);
  var submitting = false;

  function isPromotionPurchase(url, init) {
    var method = (init && init.method ? init.method : 'GET').toUpperCase();
    return method === 'POST' && /\/api\/promotions\/purchase(?:\?|$)/.test(String(url || ''));
  }

  function submitCheckout(checkout) {
    if (submitting || !checkout || !checkout.url || !checkout.fields) return;
    submitting = true;

    var form = document.createElement('form');
    form.method = 'POST';
    form.action = checkout.url;
    form.style.display = 'none';

    Object.keys(checkout.fields).forEach(function (key) {
      var input = document.createElement('input');
      input.type = 'hidden';
      input.name = key;
      input.value = checkout.fields[key] == null ? '' : String(checkout.fields[key]);
      form.appendChild(input);
    });

    document.body.appendChild(form);
    form.submit();
  }

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    return nativeFetch(input, init).then(function (response) {
      if (!isPromotionPurchase(url, init) || !response.ok) return response;

      // Read a clone so app.js can consume the original response normally.
      response.clone().json().then(function (payload) {
        var data = payload && payload.ok !== false ? payload.data : null;
        if (data && data.checkout) submitCheckout(data.checkout);
      }).catch(function () {
        // app.js will surface the normal API error if the response is invalid.
      });

      return response;
    });
  };
}());
