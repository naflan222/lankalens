/* Business social profiles: optional Facebook / Instagram links for verified shops. */
(function () {
  'use strict';

  function apiBase() {
    var explicit = window.LL_API_BASE;
    if (!explicit) {
      var meta = document.querySelector('meta[name="ll-api-base"]');
      if (meta) explicit = meta.getAttribute('content');
    }
    if (!explicit) {
      try { explicit = window.sessionStorage.getItem('ll_api_base'); } catch (e) { /* ignore */ }
    }
    return String(explicit || '/api').replace(/\/+$/, '');
  }

  function authToken() {
    try {
      return (window.sessionStorage.getItem('ll_token') || window.localStorage.getItem('ll_token') || '').trim();
    } catch (e) {
      return '';
    }
  }

  function request(path, options) {
    options = options || {};
    var headers = options.headers || {};
    var token = authToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    options.headers = headers;
    return fetch(apiBase() + path, options).then(function (res) {
      return res.text().then(function (text) {
        var body = null;
        try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
        if (!res.ok || !body || body.ok === false) {
          throw new Error((body && (body.error || body.message)) || 'Could not update social profiles.');
        }
        return body.data;
      });
    });
  }

  function currentPath() {
    var raw = (window.location.hash || '#/').replace(/^#/, '');
    return raw.split('?')[0] || '/';
  }

  function socialCardHtml() {
    return '<div class="form-card" data-business-social-card style="margin-top:16px">' +
      '<div class="section-head" style="margin-bottom:4px"><h2><ion-icon name="share-social-outline"></ion-icon>Social profiles</h2></div>' +
      '<p class="form-hint" style="margin-bottom:10px">Optional. Add your official shop profiles. Customers will see the Facebook and Instagram icons under your name.</p>' +
      '<div class="form-group"><label>Facebook profile</label><input class="input" type="url" inputmode="url" name="social_facebook" placeholder="https://facebook.com/yourshop" autocomplete="url"></div>' +
      '<div class="form-group"><label>Instagram profile</label><input class="input" type="url" inputmode="url" name="social_instagram" placeholder="https://instagram.com/yourshop" autocomplete="url"></div>' +
      '<button class="btn btn-outline btn-sm" type="button" data-save-business-social style="width:auto"><ion-icon name="checkmark-outline"></ion-icon>Save social profiles</button>' +
      '<p class="form-hint" data-business-social-status style="margin-top:8px"></p>' +
      '</div>';
  }

  function enhanceMyShop() {
    var form = document.querySelector('#shop-form');
    if (!form || form.getAttribute('data-social-enhanced') === '1') return;
    form.setAttribute('data-social-enhanced', '1');

    var firstCard = form.querySelector('.form-card');
    if (!firstCard) return;
    firstCard.insertAdjacentHTML('afterend', socialCardHtml());

    var facebook = form.querySelector('[name="social_facebook"]');
    var instagram = form.querySelector('[name="social_instagram"]');
    var status = form.querySelector('[data-business-social-status]');
    var save = form.querySelector('[data-save-business-social]');

    request('/me/business/social').then(function (data) {
      if (facebook) facebook.value = data.facebook_url || '';
      if (instagram) instagram.value = data.instagram_url || '';
    }).catch(function (err) {
      if (status) status.textContent = err.message;
    });

    if (save) save.addEventListener('click', function () {
      save.disabled = true;
      if (status) status.textContent = 'Saving…';
      request('/me/business/social', {
        method: 'PUT',
        body: JSON.stringify({
          facebook_url: facebook ? facebook.value.trim() : '',
          instagram_url: instagram ? instagram.value.trim() : ''
        })
      }).then(function (data) {
        save.disabled = false;
        if (facebook) facebook.value = data.facebook_url || '';
        if (instagram) instagram.value = data.instagram_url || '';
        if (status) {
          status.textContent = 'Social profiles saved.';
          status.style.color = 'var(--brand)';
        }
      }).catch(function (err) {
        save.disabled = false;
        if (status) {
          status.textContent = err.message;
          status.style.color = '#B42318';
        }
      });
    });
  }

  function validSocialUrl(raw, platform) {
    if (!raw) return '';
    try {
      var u = new URL(raw);
      if (u.protocol !== 'https:') return '';
      var h = u.hostname.toLowerCase();
      if (platform === 'facebook' && ['facebook.com', 'www.facebook.com', 'm.facebook.com'].indexOf(h) === -1) return '';
      if (platform === 'instagram' && ['instagram.com', 'www.instagram.com'].indexOf(h) === -1) return '';
      return u.href;
    } catch (e) {
      return '';
    }
  }

  function socialAnchor(url, platform) {
    var a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.setAttribute('aria-label', platform === 'facebook' ? 'Open Facebook profile' : 'Open Instagram profile');
    a.title = platform === 'facebook' ? 'Facebook' : 'Instagram';
    a.style.cssText = 'width:40px;height:40px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:rgba(255,255,255,.16);color:inherit;font-size:22px;text-decoration:none';
    var i = document.createElement('ion-icon');
    i.setAttribute('name', platform === 'facebook' ? 'logo-facebook' : 'logo-instagram');
    a.appendChild(i);
    return a;
  }

  function injectPublicLinks(hero, endpoint) {
    if (!hero || hero.getAttribute('data-social-enhanced') === '1') return;
    hero.setAttribute('data-social-enhanced', '1');
    var heading = hero.querySelector('h1');
    if (!heading) return;

    request(endpoint).then(function (data) {
      var facebook = validSocialUrl(data && data.facebook_url, 'facebook');
      var instagram = validSocialUrl(data && data.instagram_url, 'instagram');
      if (!facebook && !instagram) return;
      var row = document.createElement('div');
      row.className = 'business-social-links';
      row.style.cssText = 'display:flex;justify-content:center;gap:10px;margin:10px 0 2px';
      if (facebook) row.appendChild(socialAnchor(facebook, 'facebook'));
      if (instagram) row.appendChild(socialAnchor(instagram, 'instagram'));
      heading.insertAdjacentElement('afterend', row);
    }).catch(function () {
      // Social profiles are optional; never break the shop/seller page if they fail to load.
    });
  }

  function enhancePublicPage() {
    var path = currentPath();
    var shop = path.match(/^\/shop\/([^/]+)$/);
    if (shop) {
      injectPublicLinks(document.querySelector('#shop-page .hero-page'), '/business/' + encodeURIComponent(decodeURIComponent(shop[1])) + '/social');
      return;
    }
    var seller = path.match(/^\/seller\/(\d+)$/);
    if (seller) {
      injectPublicLinks(document.querySelector('#seller-root .hero-page'), '/seller/' + seller[1] + '/social');
    }
  }

  function enhance() {
    if (currentPath() === '/my-shop') enhanceMyShop();
    enhancePublicPage();
  }

  var scheduled = false;
  function scheduleEnhance() {
    if (scheduled) return;
    scheduled = true;
    window.setTimeout(function () {
      scheduled = false;
      enhance();
    }, 0);
  }

  document.addEventListener('DOMContentLoaded', scheduleEnhance);
  window.addEventListener('hashchange', scheduleEnhance);
  new MutationObserver(scheduleEnhance).observe(document.documentElement, { childList: true, subtree: true });
  scheduleEnhance();
}());
