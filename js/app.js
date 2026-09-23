/* ============================================================
   Lanka Lens — client application
   Hash router + JSON API client (no framework dependency)
   ============================================================ */
(function () {
  'use strict';

  /* ---------- utilities ---------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Allow basic article formatting without allowing scripts, event handlers,
  // embedded objects, unsafe URLs, or arbitrary attributes.
  function sanitizeRichHtml(input) {
    var template = document.createElement('template');
    template.innerHTML = String(input || '');
    var allowed = {
      P: 1, BR: 1, H2: 1, H3: 1, H4: 1, UL: 1, OL: 1, LI: 1,
      STRONG: 1, EM: 1, B: 1, I: 1, BLOCKQUOTE: 1, A: 1
    };
    Array.prototype.slice.call(template.content.querySelectorAll('*')).forEach(function (el) {
      if (!allowed[el.tagName]) {
        el.replaceWith(document.createTextNode(el.textContent || ''));
        return;
      }
      var raw = el.tagName === 'A' ? (el.getAttribute('href') || '') : '';
      Array.prototype.slice.call(el.attributes).forEach(function (attr) {
        el.removeAttribute(attr.name);
      });
      if (el.tagName === 'A') {
        if (/^(https?:|mailto:|\/|#)/i.test(raw)) {
          el.setAttribute('href', raw);
          el.setAttribute('rel', 'noopener noreferrer');
        }
      }
    });
    return template.innerHTML;
  }
  function icon(name, cls) {
    return '<ion-icon name="' + name + '"' + (cls ? ' class="' + cls + '"' : '') + '></ion-icon>';
  }

  /* ---------- shared loading / empty / error states ----------
     Every API-driven section renders one of these blocks, so a slow, failed or
     empty request can never leave the UI stuck on a spinner or silently blank.
     renderAsync() wires them up (including the retry button) in one place. */
  function loadingHtml(msg) {
    return '<div class="state-block state-loading"><div class="spinner"></div>' +
      (msg ? '<p>' + esc(msg) + '</p>' : '') + '</div>';
  }
  function emptyHtml(msg, sub, iconName) {
    return '<div class="state-block state-empty"><div class="e-icon">' + icon(iconName || 'file-tray-outline') + '</div>' +
      '<h3>' + esc(msg || 'Nothing here yet') + '</h3>' + (sub ? '<p>' + esc(sub) + '</p>' : '') + '</div>';
  }
  function errorHtml(msg, retryLabel, iconName, heading) {
    return '<div class="state-block state-error"><div class="e-icon err">' + icon(iconName || 'cloud-offline-outline') + '</div>' +
      '<h3>' + esc(heading || 'Could not load this') + '</h3><p>' + esc(msg || 'Something went wrong.') + '</p>' +
      '<button class="btn btn-outline btn-sm" type="button" data-state-retry>' +
      icon('refresh-outline') + esc(retryLabel || 'Try again') + '</button></div>';
  }

  /**
   * Background calls whose failure must not blank the UI (telemetry pings,
   * favourite-id sync, share sheet, logout). They used to end in an empty
   * .catch(function () {}) — the error vanished completely, which made "why is
   * this section empty?" undiagnosable. These are recorded on state and logged,
   * so nothing fails silently.
   */
  function logNonCritical(what) {
    return function (e) {
      state.softErrors.push({ what: what, message: (e && e.message) || String(e || ''), at: Date.now() });
      if (state.softErrors.length > 20) state.softErrors.shift();
      try { if (window.console && console.warn) console.warn('[LankaLens] ' + what + ' failed:', (e && e.message) || e); } catch (ignore) { /* no console */ }
    };
  }

  /**
   * Run a mutation (delete / renew / accept / block / save…) and always tell the
   * user the outcome. These used to be bare api.post(...).then(...) chains: when
   * the request failed nothing happened at all — no toast, no state change — so
   * a click looked like the app had ignored it.
   * Returns a promise that resolves to the payload, or null on failure.
   */
  function act(promise, successMsg, done, fail) {
    return promise.then(function (r) {
      if (successMsg) toast(successMsg, 'success');
      if (done) done(r);
      return r;
    }, function (e) {
      var msg = (e && e.message) ? e.message : 'That did not work. Please try again.';
      toast(msg, 'error');
      logNonCritical(successMsg || 'action')(e);
      if (fail) fail(e);
      return null;
    });
  }

  /**
   * Load data into a container with explicit loading / success / empty / error
   * states. opts:
   *   into        selector of the container to fill
   *   load        function returning a Promise of the data (re-run on retry)
   *   render      function(data) -> html for the success state
   *   isEmpty     function(data) -> bool (default: falsy or zero-length)
   *   emptyText / emptySub / emptyIcon   empty-state copy
   *   loadingText                          loading-state copy (null to skip)
   *   retryLabel                           error-state button copy
   *   onRender / onEmpty / onError         post-render hooks(el, data|error)
   */
  function renderAsync(opts) {
    var el = $(opts.into);
    if (!el) return;
    if (opts.loadingText !== null) el.innerHTML = loadingHtml(opts.loadingText || 'Loading…');
    var req;
    try {
      req = opts.load();
    } catch (e) {
      fail(el, opts, e);
      return;
    }
    if (!req || typeof req.then !== 'function') return;
    req.then(function (data) {
      var target = $(opts.into);
      if (!target) return;
      var empty = opts.isEmpty ? opts.isEmpty(data) : (!data || !data.length);
      if (empty) {
        target.innerHTML = opts.emptyHtml || emptyHtml(opts.emptyText, opts.emptySub, opts.emptyIcon);
        if (opts.onEmpty) opts.onEmpty(target, data);
        return;
      }
      target.innerHTML = opts.render(data);
      if (opts.onRender) opts.onRender(target, data);
    }).catch(function (e) { fail($(opts.into), opts, e); });

    function fail(target, o, e) {
      if (!target) return;
      var msg = (e && e.message) ? e.message : 'Something went wrong.';
      target.innerHTML = errorHtml(msg, o.retryLabel, o.errorIcon);
      var btn = target.querySelector('[data-state-retry]');
      if (btn) btn.addEventListener('click', function () { renderAsync(o); });
      if (o.onError) o.onError(target, e);
    }
  }
  function fmtLKR(n) {
    return 'Rs. ' + Number(n || 0).toLocaleString('en-LK');
  }
  function fmtDate(ts) {
    if (!ts) return '';
    var d = new Date(ts * 1000);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function timeAgo(ts) {
    if (!ts) return '';
    var s = Math.floor(Date.now() / 1000) - ts;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' hr ago';
    if (s < 86400 * 7) return Math.floor(s / 86400) + ' days ago';
    return fmtDate(ts);
  }
  var AV_COLORS = ['#0E7C66', '#C77D23', '#3A6FB0', '#9C4F96', '#B04A3A', '#2C8C8C', '#5B6BB0'];
  function avColor(name) {
    var h = 0;
    for (var i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return AV_COLORS[h % AV_COLORS.length];
  }
  function initials(name) {
    var p = (name || '').trim().split(/\s+/);
    var a = (p[0] || '').charAt(0) || '';
    var b = (p[1] || '').charAt(0) || '';
    return (a + b).toUpperCase();
  }
  function avatarHtml(user, size) {
    var c = size === 'lg' ? 46 : size === 'sm' ? 30 : 40;
    if (user && user.avatar) {
      return '<span class="avatar"><img class="avatar-img" src="' + esc(user.avatar) + '" style="width:' + c + 'px;height:' + c + 'px" alt=""></span>';
    }
    return '<span class="avatar"><span class="circle" style="background:' + avColor(user.name) + ';width:' + c + 'px;height:' + c + 'px;font-size:' + Math.round(c / 2.6) + 'px">' + esc(initials(user.name)) + '</span></span>';
  }
  function phoneDigits(p) {
    var d = (p || '').replace(/\D/g, '');
    if (d.indexOf('0') === 0) d = '94' + d.slice(1);
    return d;
  }
  var STATUS_META = {
    active: { label: 'Active', color: '#0E7C66' },
    pending: { label: 'Pending', color: '#C77D23' },
    draft: { label: 'Draft', color: '#74817C' },
    sold: { label: 'Sold', color: '#3A6FB0' },
    expired: { label: 'Expired', color: '#B04A3A' },
    paused: { label: 'Paused', color: '#9C4F96' },
    rejected: { label: 'Rejected', color: '#E5484D' }
  };
  function statusChip(status) {
    var m = STATUS_META[status] || { label: status || '', color: '#74817C' };
    return '<span class="status-chip" style="color:' + m.color + ';background:' + m.color + '1a">' + esc(m.label) + '</span>';
  }
  function starsHtml(avg, count) {
    avg = Number(avg || 0);
    var out = '<span class="stars">';
    for (var i = 1; i <= 5; i++) {
      out += '<span class="star' + (i <= Math.round(avg) ? ' on' : '') + '">' + (i <= Math.round(avg) ? icon('star') : icon('star-outline')) + '</span>';
    }
    out += '</span>';
    if (count) out += '<span class="stars-count">' + esc(avg) + ' (' + esc(count) + ')</span>';
    return out;
  }
  function locationSelectsHtml(prov, dist, city) {
    var provs = state.locations || [];
    var opts = function (sel) { return '<option value="">Select…</option>' + (sel || []).map(function (x) { return '<option value="' + esc(x) + '">' + esc(x) + '</option>'; }).join(''); };
    return '<div class="form-group"><label>Province</label><select class="select" data-loc="province">' + opts(provs.map(function (p) { return p.name; })) + '</select></div>' +
      '<div class="form-group"><label>District</label><select class="select" data-loc="district"><option value="">Select…</option></select></div>' +
      '<div class="form-group"><label>City / Town</label><select class="select" data-loc="city"><option value="">Select…</option></select></div>';
  }
  function bindLocationSelects(root, data) {
    // data = {province, district, city}
    var provs = state.locations || [];
    var selP = root.querySelector('[data-loc="province"]');
    var selD = root.querySelector('[data-loc="district"]');
    var selC = root.querySelector('[data-loc="city"]');
    function setVal(sel, v) { if (sel && v) { for (var i = 0; i < sel.options.length; i++) { if (sel.options[i].value === v) { sel.value = v; return; } } } }
    setVal(selP, data.province);
    function fillDistricts() {
      selD.innerHTML = '<option value="">Select…</option>';
      selC.innerHTML = '<option value="">Select…</option>';
      var p = provs.find(function (x) { return x.name === selP.value; });
      (p ? p.districts : []).forEach(function (d) {
        selD.insertAdjacentHTML('beforeend', '<option value="' + esc(d.name) + '">' + esc(d.name) + '</option>');
      });
      setVal(selD, data.district);
      fillCities();
    }
    function fillCities() {
      selC.innerHTML = '<option value="">Select…</option>';
      var p = provs.find(function (x) { return x.name === selP.value; });
      var d = p && p.districts.find(function (x) { return x.name === selD.value; });
      (d ? d.cities : []).forEach(function (c) {
        selC.insertAdjacentHTML('beforeend', '<option value="' + esc(c.name) + '">' + esc(c.name) + '</option>');
      });
      setVal(selC, data.city);
    }
    selP.addEventListener('change', fillDistricts);
    selD.addEventListener('change', fillCities);
    if (data.province) fillDistricts();
  }

  /* ---------- state ---------- */
  var state = {
    user: null,
    meta: null,
    locations: null,
    favIds: [],
    sessionRestored: false,
    softErrors: [],
    route: { path: '/', query: new URLSearchParams() }
  };

  /* ---------- storage helpers (private-mode safe) ---------- */
  function storeGet(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
  function storeSet(key, val) { try { window.localStorage.setItem(key, val); } catch (e) {} }
  function storeDel(key) { try { window.localStorage.removeItem(key); } catch (e) {} }
  function sessGet(key) { try { return window.sessionStorage.getItem(key); } catch (e) { return null; } }
  function sessSet(key, val) { try { window.sessionStorage.setItem(key, val); } catch (e) {} }
  function sessDel(key) { try { window.sessionStorage.removeItem(key); } catch (e) {} }

  /* ---------- api ----------
     The SPA is normally served by the Flask app itself, so a relative base is
     correct. It is also regularly opened from a static dev server, a preview
     host or straight off disk (file://) — there is no API on those origins, so
     the base can be overridden and, on local dev origins only, falls back to
     the Flask dev server instead of failing every request. */
  var API_LOCAL_FALLBACK = 'http://localhost:8000/api';

  function configuredApiBase() {
    var explicit = window.LL_API_BASE;
    if (!explicit) {
      var meta = document.querySelector('meta[name="ll-api-base"]');
      if (meta) explicit = meta.getAttribute('content');
    }
    if (explicit) {
      // An explicit override is authoritative: never second-guess it.
      api.baseExplicit = true;
      return String(explicit).replace(/\/+$/, '');
    }
    var remembered = sessGet('ll_api_base');
    if (remembered) return remembered;
    if (location.protocol === 'file:') return API_LOCAL_FALLBACK;
    return '/api';
  }
  function isLocalDevOrigin() {
    var h = location.hostname;
    return location.protocol === 'file:' || h === '' || h === 'localhost' || h === '127.0.0.1' ||
      h === '0.0.0.0' || h === '[::1]' || h === '::1';
  }
  function isAuthPath(path) { return /^\/auth\/(login|signup|forgot|reset)/.test(path || ''); }

  function apiError(message, status, extra) {
    var e = new Error(message || 'Something went wrong');
    e.status = status || 0;
    e.isApiError = true;
    if (extra) { for (var k in extra) { if (Object.prototype.hasOwnProperty.call(extra, k)) e[k] = extra[k]; } }
    return e;
  }
  function statusMessage(status, path) {
    if (status === 400) return 'That request was rejected. Please check the details and try again.';
    if (status === 401) return isAuthPath(path) ? 'Invalid email or password.' : 'Your session has expired — please sign in again.';
    if (status === 403) return 'You don’t have permission to do that.';
    if (status === 404) return 'We couldn’t reach that endpoint (' + path + '). It may not exist on this server.';
    if (status === 405) return 'That action isn’t allowed here.';
    if (status === 408) return 'The request timed out. Please try again.';
    if (status === 409) return 'That conflicts with data that already exists.';
    if (status === 413) return 'That file is too large to upload.';
    if (status === 415) return 'Unsupported request format.';
    if (status === 422) return 'Please check the form and try again.';
    if (status === 429) return 'Too many attempts — please wait a minute and try again.';
    if (status >= 500) return 'Server error (' + status + '). Please try again in a moment.';
    if (status > 0) return 'Request failed (HTTP ' + status + ').';
    return 'Cannot reach the Lanka Lens server. Check your connection, then try again.';
  }
  function notJsonMessage(status, path, text) {
    // Keep the actionable HTTP result when a proxy/static server sends no body.
    // This is deliberately not a raw response dump: upstream error pages can
    // contain implementation details, but the status and requested endpoint are
    // enough for a user (and support) to diagnose the failed request.
    var endpoint = api.base + path;
    if (!(text || '').length) {
      return 'Request to ' + endpoint + ' failed with HTTP ' + (status || 'unknown') +
        ': the server returned an empty response.';
    }
    var htmlish = /<\/?(html|head|body|!doctype)/i.test(text);
    if (!htmlish) return statusMessage(status, path);
    // An HTML page where JSON was expected is almost always "this origin is not
    // the Flask API" (static dev server, preview host, proxy error page).
    if (status >= 500) {
      return 'Request to ' + endpoint + ' returned an error page instead of JSON (HTTP ' + status + '). Please try again in a moment.';
    }
    if (status === 404) {
      return 'Request to ' + endpoint + ' returned HTML instead of the Lanka Lens API (HTTP 404).';
    }
    return 'Unexpected response from ' + endpoint + ' (HTTP ' + status + ', expected JSON).';
  }

  var api = {
    base: '/api',
    baseExplicit: false,
    token: (function () {
      var token = (sessGet('ll_token') || storeGet('ll_token') || '').replace(/^undefined$|^null$/, '');
      if (token) sessSet('ll_token', token);
      storeDel('ll_token'); // one-time migration away from persistent localStorage
      return token;
    }()),
    req: function (method, path, body) {
      var headers = {};
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (api.token) headers['Authorization'] = 'Bearer ' + api.token;
      return fetch(api.base + path, {
        method: method, headers: headers, body: body !== undefined ? JSON.stringify(body) : undefined
      }).then(function (res) {
        return res.text().catch(function () { return ''; }).then(function (text) {
          var data = null;
          if (text) { try { data = JSON.parse(text); } catch (parseErr) { data = null; } }
          var isJson = !!(data && typeof data === 'object');
          if (res.ok && (res.status === 204 || !text)) return null;  // no content is a valid success
          if (!res.ok) {
            var msg = isJson ? (data.error || data.message || '') : '';
            if (!msg) msg = isJson ? statusMessage(res.status, path) : notJsonMessage(res.status, path, text);
            // A rejected token on a normal (non-auth) call means the stored session is dead.
            if (res.status === 401 && api.token && !isAuthPath(path)) clearSession();
            throw apiError(msg, res.status, { path: path, notJson: !isJson });
          }
          if (!isJson) throw apiError(notJsonMessage(res.status, path, text), res.status, { path: path, notJson: true });
          if (data.ok === false) throw apiError(data.error || statusMessage(res.status, path), res.status, { path: path });
          return data.data;
        });
      }, function (netErr) {
        // fetch itself failed: offline, DNS, mixed content, CORS or a dead server.
        throw apiError('Cannot reach the Lanka Lens server at ' + api.base + '. ' +
          'Check your connection and that the backend is running (python3 server/app.py).',
          0, { path: path, network: true, cause: netErr && netErr.message });
      });
    },
    // Multipart uploads use the same response/error contract as JSON requests.
    // Do not call response.json() directly: an empty or HTML proxy response
    // must retain its HTTP status and surface a useful, safe error message.
    form: function (path, formData) {
      var headers = {};
      if (api.token) headers['Authorization'] = 'Bearer ' + api.token;
      return fetch(api.base + path, { method: 'POST', headers: headers, body: formData }).then(function (res) {
        return res.text().catch(function () { return ''; }).then(function (text) {
          var data = null;
          if (text) { try { data = JSON.parse(text); } catch (parseErr) { data = null; } }
          var isJson = !!(data && typeof data === 'object');
          if (!res.ok) {
            var msg = isJson ? (data.error || data.message || '') : '';
            if (!msg) msg = isJson ? statusMessage(res.status, path) : notJsonMessage(res.status, path, text);
            if (res.status === 401 && api.token) clearSession();
            throw apiError(msg, res.status, { path: path, notJson: !isJson });
          }
          if (!isJson) throw apiError(notJsonMessage(res.status, path, text), res.status, { path: path, notJson: true });
          if (data.ok === false) throw apiError(data.error || statusMessage(res.status, path), res.status, { path: path });
          return data.data;
        });
      }, function (netErr) {
        throw apiError('Cannot reach the Lanka Lens server at ' + api.base + '. ' +
          'Check your connection and that the backend is running (python3 server/app.py).',
          0, { path: path, network: true, cause: netErr && netErr.message });
      });
    },
    get: function (p) { return api.req('GET', p); },
    post: function (p, b) { return api.req('POST', p, b); },
    patch: function (p, b) { return api.req('PATCH', p, b); },
    put: function (p, b) { return api.req('PUT', p, b); },
    del: function (p) { return api.req('DELETE', p); },
    /** Resolve the API base once the api object exists (see configuredApiBase). */
    init: function () { api.base = configuredApiBase(); return api.base; },
    health: function (base) {
      return fetch((base || api.base) + '/health').then(function (res) {
        return res.text().then(function (t) {
          var parsed = null;
          try { parsed = JSON.parse(t); } catch (e) { parsed = null; }
          return !!(res.ok && parsed && parsed.ok);
        });
      }).catch(function () { return false; });
    },
    /** Local dev only: if the current origin has no API, try the Flask dev server. */
    recoverBase: function () {
      if (api.baseExplicit) return Promise.resolve(false);
      if (!isLocalDevOrigin() || api.base === API_LOCAL_FALLBACK) return Promise.resolve(false);
      if (location.protocol === 'https:') return Promise.resolve(false); // mixed content would be blocked anyway
      return api.health(API_LOCAL_FALLBACK).then(function (good) {
        if (!good) return false;
        api.base = API_LOCAL_FALLBACK;
        sessSet('ll_api_base', API_LOCAL_FALLBACK);
        return true;
      });
    }
  };

  /** Drop every trace of the signed-in session. */
  function clearSession() {
    api.token = '';
    storeDel('ll_token');
    sessDel('ll_token');
    state.user = null;
    state.favIds = [];
  }

  /**
   * Metadata (categories / brands / conditions) used by the sell wizard, the
   * browse filters and the home grid. Boot normally loads it, but any view that
   * needs it must be able to fetch it on demand: a failed or still-pending /meta
   * call used to render those pages completely empty (e.g. "Choose a Category"
   * with no categories to choose).
   */
  var metaInFlight = null;
  function ensureMeta() {
    if (state.meta && state.meta.categories && state.meta.categories.length) return Promise.resolve(state.meta);
    if (!metaInFlight) {
      metaInFlight = api.get('/meta').then(function (d) {
        state.meta = d || state.meta;
        metaInFlight = null;
        return state.meta;
      }, function (e) { metaInFlight = null; throw e; });
    }
    return metaInFlight;
  }

  /**
   * Run a search. An empty term browses everything instead of doing nothing,
   * and re-running the same term re-queries (a plain hash assignment would not
   * fire hashchange, so the page would appear to ignore the click).
   */
  function goSearch(q) {
    q = String(q == null ? '' : q).trim();
    var target = '#/browse' + (q ? '?q=' + encodeURIComponent(q) : '');
    if (location.hash === target) render();
    else location.hash = target;
    return target;
  }

  function requireAuth() {
    if (state.user) return true;
    // Don't bounce to the sign-in page while the stored session is still being
    // restored on boot — that used to log people out on every refresh.
    if (!state.sessionRestored) return false;
    location.hash = '#/sign-in?next=' + encodeURIComponent(location.hash || '#/');
    return false;
  }
  function setUser(u) {
    state.user = u || null;
    refreshFavIds();
    renderDrawer();
    renderTabbar();
  }
  function refreshFavIds() {
    if (state.user) {
      api.get('/favorites/ids').then(function (ids) { state.favIds = ids || []; }).catch(logNonCritical('favourite sync'));
    } else {
      state.favIds = [];
    }
  }
  function isFav(id) { return state.favIds.indexOf(id) !== -1; }
  function toggleFav(id, btn) {
    if (!requireAuth()) return;
    var on = isFav(id);
    api.req(on ? 'DELETE' : 'POST', '/favorites/' + id).then(function () {
      if (on) state.favIds = state.favIds.filter(function (x) { return x !== id; });
      else state.favIds.push(id);
      toast(on ? 'Removed from favorites' : 'Added to favorites', 'success');
      updateFavButtons(id);
    }).catch(function (e) { toast(e.message, 'error'); });
  }
  function updateFavButtons(id) {
    $$('[data-fav="' + id + '"]').forEach(function (b) {
      var on = isFav(id);
      b.classList.toggle('active', on);
      b.innerHTML = icon(on ? 'heart' : 'heart-outline');
    });
  }

  /* ---------- SEO (dynamic title / description / canonical) ---------- */
  function siteName() {
    return (state.meta && state.meta.settings && state.meta.settings.site_name) || 'Lanka Lens';
  }
  function siteTagline() {
    return (state.meta && state.meta.settings && state.meta.settings.tagline) || 'Buy & Sell Cameras in Sri Lanka';
  }
  /** Absolute URL for a possibly root-relative asset (needed by OG tags). */
  function absUrl(u) {
    if (!u) return '';
    if (/^https?:\/\//i.test(u) || u.indexOf('data:') === 0) return u;
    return location.origin + (u.charAt(0) === '/' ? u : '/' + u);
  }

  function setMetaTag(selector, attr, value) {
    var el = document.querySelector(selector);
    if (!el) {
      var m = selector.match(/\[(\w+)="([^"]+)"\]/);
      if (!m) return;
      el = document.createElement('meta');
      el.setAttribute(m[1], m[2]);
      document.head.appendChild(el);
    }
    el.setAttribute(attr, value);
  }

  /**
   * Per-route metadata. Also keeps Open Graph / Twitter tags in sync, because
   * listings are mostly shared over WhatsApp and Facebook in Sri Lanka: without
   * this the share preview always showed the homepage title and no photo.
   */
  function setMeta(title, desc, canonical, image) {
    document.title = title;
    var url = canonical || (location.origin + location.pathname);
    var img = absUrl(image || '/images/hero-camera.jpg');
    setMetaTag('meta[name="description"]', 'content', desc || '');
    setMetaTag('link[rel="canonical"]', 'href', url);
    setMetaTag('meta[property="og:title"]', 'content', title);
    setMetaTag('meta[property="og:description"]', 'content', desc || '');
    setMetaTag('meta[property="og:url"]', 'content', url);
    setMetaTag('meta[property="og:image"]', 'content', img);
    setMetaTag('meta[property="og:type"]', 'content', image ? 'product' : 'website');
    setMetaTag('meta[name="twitter:title"]', 'content', title);
    setMetaTag('meta[name="twitter:description"]', 'content', desc || '');
    setMetaTag('meta[name="twitter:image"]', 'content', img);
  }
  function defaultMeta(path) {
    var s = siteName();
    var map = {
      '/': s + ' — ' + siteTagline(),
      '/categories': 'All Categories — ' + s,
      '/browse': 'Browse Listings — ' + s,
      '/search': 'Search — ' + s,
      '/sell': 'Sell Your Camera — ' + s,
      '/favorites': 'Favorites — ' + s,
      '/chat': 'Messages — ' + s,
      '/profile': 'My Profile — ' + s,
      '/settings': 'Settings — ' + s,
      '/my-ads': 'My Ads — ' + s,
      '/my-offers': 'My Offers — ' + s,
      '/analytics': 'Seller Analytics — ' + s,
      '/shops': 'Camera Shops in Sri Lanka — ' + s,
      '/blog': 'Camera Buying Guides — ' + s,
      '/safety': 'Buy & Sell Safely — ' + s,
      '/buying-guide': 'Camera Buying Guide — ' + s,
      '/admin': 'Admin Panel — ' + s
    };
    if (path.indexOf('/admin') === 0) return 'Admin Panel — ' + s;
    return map[path] || s + ' — ' + siteTagline();
  }

  /* ---------- ui primitives ---------- */
  var toastTimer = null;
  function toast(msg, type) {
    var el = $('#toast');
    el.className = 'toast ' + (type || '');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2400);
  }

  var sheetCbs = [];
  function openSheet(title, options) {
    var html = '<div class="sheet-mask" data-close-sheet><div class="sheet" data-stop><div class="grab"></div>' +
      (title ? '<div class="sheet-title">' + esc(title) + '</div>' : '') +
      options.map(function (o, i) {
        return '<div class="sheet-opt ' + (o.danger ? 'danger' : '') + '" data-sheet-idx="' + i + '">' +
          (o.icon ? icon(o.icon) : '') + '<span>' + esc(o.label) + '</span></div>';
      }).join('') + '</div></div>';
    var host = $('#sheet-host');
    host.innerHTML = html;
    sheetCbs = options.map(function (o) { return o.onClick; });
    requestAnimationFrame(function () {
      var mask = $('.sheet-mask', host);
      var panel = $('.sheet', host);
      if (mask) mask.classList.add('open');
      if (panel) panel.classList.add('open');
    });
  }
  function closeSheet() {
    var host = $('#sheet-host');
    var mask = $('.sheet-mask', host);
    var panel = $('.sheet', host);
    if (mask) mask.classList.remove('open');
    if (panel) panel.classList.remove('open');
    setTimeout(function () { host.innerHTML = ''; sheetCbs = []; }, 240);
  }

  var dialogOk = null;
  function openDialog(title, bodyHtml, okText, okDanger, onOk, cancelText) {
    var html =
      '<div class="dialog-mask" data-dialog-cancel><div class="dialog" data-stop>' +
      '<h3>' + esc(title) + '</h3><div class="d-body">' + bodyHtml + '</div>' +
      '<div class="d-actions">' +
      '<button class="btn btn-outline" data-dialog-cancel>' + esc(cancelText || 'Cancel') + '</button>' +
      '<button class="btn ' + (okDanger ? 'btn-danger' : 'btn-primary') + '" data-dialog-ok>' + esc(okText || 'OK') + '</button>' +
      '</div></div></div>';
    var host = $('#dialog-host');
    host.innerHTML = html;
    dialogOk = onOk;
    requestAnimationFrame(function () {
      $('.dialog-mask', host).classList.add('open');
    });
  }
  function closeDialog() {
    var host = $('#dialog-host');
    var mask = $('.dialog-mask', host);
    if (mask) mask.classList.remove('open');
    setTimeout(function () { host.innerHTML = ''; dialogOk = null; }, 180);
  }

  /* ---------- components ---------- */
  function header(title, opts) {
    opts = opts || {};
    // Authentication routes must always offer a safe route back into the app.
    // A browser-history entry can belong to another site (or not exist at all),
    // so auth pages use the SPA router's explicit home target rather than a bare
    // history.back(). Other in-app pages retain their existing back behaviour.
    var left = opts.back === false ? '<span style="width:40px"></span>' :
      (opts.backTo
        ? '<button class="back-btn" data-nav="' + esc(opts.backTo) + '" aria-label="Back to Home">' + icon('chevron-back-outline') + '</button>'
        : '<button class="back-btn" data-back aria-label="Back">' + icon('chevron-back-outline') + '</button>');
    var right = opts.right || '<span style="width:40px"></span>';
    // The header title is the page's <h1> unless the view renders its own
    // heading (opts.heading === false) - exactly one h1 per page.
    var tag = opts.heading === false ? 'div' : 'h1';
    return '<header class="app-header"><div class="app-header-inner">' + left +
      '<' + tag + ' class="title">' + esc(title) + '</' + tag + '>' + '<div class="spacer"></div>' + right + '</div></header>';
  }

  function seoClean(v) {
    return String(v || '').trim().replace(/\s+/g, ' ');
  }

  function seoTrim(v, limit) {
    var text = seoClean(v);
    if (text.length <= limit) return text;
    var cut = text.slice(0, Math.max(1, limit - 1));
    var lastSpace = cut.lastIndexOf(' ');
    if (lastSpace > 12) cut = cut.slice(0, lastSpace);
    cut = cut.replace(/[\s\-|,:;]+$/g, '');
    return cut + '…';
  }

  var SEO_PLACEHOLDER_BRANDS = {
    'other': true,
    'others': true,
    'unbranded': true,
    'no brand': true,
    'no-brand': true,
    'n/a': true,
    'na': true,
    'none': true,
    'unknown': true,
    'not specified': true,
    'generic': true
  };

  function listingSeoBrand(l) {
    var brand = seoClean(l && l.brand);
    return SEO_PLACEHOLDER_BRANDS[brand.toLowerCase()] ? '' : brand;
  }

  function listingSeoIdentity(l) {
    var brand = listingSeoBrand(l);
    var model = seoClean(l && l.model);
    var title = seoClean(l && l.title);
    if (brand && model) {
      if (model.toLowerCase().indexOf(brand.toLowerCase()) === 0) return model;
      return brand + ' ' + model;
    }
    return title || model || 'Camera Gear';
  }

  function listingSeoTitle(l) {
    var suffix = ' for Sale in Sri Lanka | Lanka Lens';
    var room = Math.max(20, 68 - suffix.length);
    return seoTrim(listingSeoIdentity(l), room) + suffix;
  }

  function listingSeoDescription(l) {
    var identity = listingSeoIdentity(l);
    var condition = seoClean(l && l.condition).toLowerCase();
    if (condition === 'like new') condition = 'like-new';
    if (condition === 'brand new') condition = 'brand-new';
    var locationName = seoClean(l && (l.city || l.district || l.province)) || 'Sri Lanka';
    var where = locationName.toLowerCase() === 'sri lanka' ? 'Sri Lanka' : locationName + ', Sri Lanka';
    var text = 'Find ' + (condition ? 'a ' + condition + ' ' : '') + identity + ' for sale in ' + where;
    var price = Number(l && l.price || 0);
    if (price > 0) text += ' for Rs. ' + Math.round(price).toLocaleString('en-US');
    text += '. View photos, condition and seller details on LankaLens.';
    return seoTrim(text, 160);
  }

  function listingImageAlt(l) {
    var locationName = seoClean(l && (l.city || l.province)) || 'Sri Lanka';
    var where = locationName.toLowerCase() === 'sri lanka' ? 'Sri Lanka' : locationName + ', Sri Lanka';
    return seoTrim(listingSeoIdentity(l) + ' for sale in ' + where, 125);
  }

  function listingPublicHref(l) {
    return '/listing/' + encodeURIComponent((l && l.slug) || slugify((l && l.title) || 'listing')) + '-' + l.id;
  }

  function lcard(l) {
    var img = (l.images && l.images[0])
      ? '<img src="' + esc(l.images[0]) + '" loading="lazy" alt="' + esc(listingImageAlt(l)) + '">'
      : '<span class="ph">' + icon('camera-outline') + '</span>';
    var favOn = isFav(l.id);
    var sellerOk = l.seller && l.seller.verified ? '<span class="seller-ok">' + icon('shield-checkmark') + '</span>' : '';
    return '<div class="lcard" data-nav="#/ads/' + l.id + '">' +
      '<div class="thumb">' + img +
      (l.condition ? '<span class="cond-chip">' + esc(l.condition) + '</span>' : '') +
      (l.featured ? '<span class="featured-flag">Featured</span>' : '') +
      (l.urgent ? '<span class="urgent-flag">URGENT</span>' : '') +
      '<button class="fav' + (favOn ? ' active' : '') + '" data-fav="' + l.id + '" aria-label="Favorite">' + icon(favOn ? 'heart' : 'heart-outline') + '</button>' +
      '</div><div class="body">' +
      '<div class="title"><a href="' + listingPublicHref(l) + '" data-nav="#/ads/' + l.id + '" style="color:inherit;text-decoration:none">' + esc(l.title) + '</a></div>' +
      '<div class="price">' + fmtLKR(l.price) + (l.negotiable ? ' <span class="neg">negotiable</span>' : '') + '</div>' +
      '<div class="meta"><span>' + icon('location-outline') + esc(l.city || l.district || l.province || '') + '</span>' +
      '<span class="sep">·</span><span>' + timeAgo(l.created_at) + '</span>' + sellerOk + '</div>' +
      '</div></div>';
  }

  function listingGrid(items, q) {
    if (!items || !items.length) {
      return '<div class="empty"><div class="e-icon">' + icon('search-outline') + '</div>' +
        '<h3>' + (q ? 'No results for “' + esc(q) + '”' : 'No listings found') + '</h3>' +
        '<p>' + (q
          ? 'Check the spelling, try fewer words, or search a broader term like “Canon”, “lens” or “drone”.'
          : 'Try a different search, or be the first to post in this category.') + '</p></div>';
    }
    return '<div class="listing-grid">' + items.map(lcard).join('') + '</div>';
  }

  function catTile(c) {
    var colors = ['#0E7C66', '#C77D23', '#3A6FB0', '#9C4F96', '#B04A3A'];
    var i = (c.id || 0) % colors.length;
    return '<a class="cat-tile" href="/category/' + esc(c.slug) + '" data-nav="#/category/' + esc(c.slug) + '" style="color:inherit;text-decoration:none">' +
      '<div class="tile-icon" style="background:' + colors[i] + '1a;color:' + colors[i] + '">' + icon(c.icon || 'camera-outline') + '</div>' +
      '<div class="tile-name">' + esc(c.name) + '</div>' +
      '<div class="tile-count">' + (c.children ? c.children.length + ' types' : '') + '</div></a>';
  }

  function brandChips(brands) {
    return '<div class="chips">' + (brands || []).map(function (b) {
      return '<a class="chip" data-nav="#/browse?q=' + encodeURIComponent(b) + '">' + esc(b) + '</a>';
    }).join('') + '</div>';
  }

  function fullHeader(title, opts) {
    return header(title, opts);
  }

  /* ============================================================
     Views
     ============================================================ */
  var views = {};

  views.home = function () {
    var stats = '<div class="hero"><div class="hero-inner">' +
      '<div class="flex aic jcsb"><div class="brand" data-nav="#/">' + logoMark() +
      '<div class="brand-text"><div class="brand-name">Lanka <b>Lens</b></div><div class="brand-tag">Buy &amp; Sell Cameras in Sri Lanka</div></div></div>' +
      '<div style="display:flex;gap:4px">' +
      '<button class="icon-btn badge-dot" data-nav="#/notifications" aria-label="Notifications">' + icon('notifications-outline') + '</button>' +
      '<button class="icon-btn" data-open-drawer aria-label="Menu">' + icon('menu-outline') + '</button></div></div>' +
      '<h1 style="margin-top:18px">Your next camera<br>starts here</h1>' +
      '<p class="sub">Sri Lanka’s camera marketplace — bodies, lenses, drones &amp; gear.</p>' +
      '<div class="hero-stats"><div class="stat"><b>' + (state.meta ? state.meta.brands.length : 0) + '+</b><span>Brands</span></div>' +
      '<div class="stat"><b>9</b><span>Provinces</span></div>' +
      '<div class="stat"><b>LKR</b><span>Local prices</span></div></div></div></div>' +
      '<form class="search-hero" id="home-search"><span>' + icon('search-outline') + '</span>' +
      '<input type="search" placeholder="Search cameras, lenses, GoPro, DJI, drones..." aria-label="Search" inputmode="search" enterkeyhint="search" autocomplete="off">' +
      '<button type="submit">Search</button></form>';

    var sections = '';
    if (state.user && !state.user.email_verified) {
      sections += '<div class="verify-home-banner"><div><b>' + icon('mail-unread-outline') + 'Verify Email</b>' +
        '<span>Verify your email to publish listings.</span></div>' +
        '<button class="btn btn-primary btn-sm" id="home-verify-email">Verify Email</button></div>';
    }
    sections += '<div class="section"><div class="section-head"><h2>' + icon('grid-outline') + 'Browse Categories</h2>' +
      '<a class="more" data-nav="#/categories">View all</a></div><div id="home-cats">' + loadingHtml('Loading categories…') + '</div></div>';

    sections += '<div class="section" id="home-featured"><div class="section-head"><h2>' + icon('flash-outline') + 'Featured Listings</h2>' +
      '<a class="more" data-nav="#/browse">View all</a></div><div id="home-featured-body">' + loadingHtml('Loading listings…') + '</div></div>';
    sections += '<div class="section" id="home-latest"><div class="section-head"><h2>' + icon('time-outline') + 'Latest Listings</h2>' +
      '<a class="more" data-nav="#/browse">View all</a></div><div id="home-latest-body">' + loadingHtml('Loading listings…') + '</div></div>';

    sections += '<div class="section"><div class="section-head"><h2>' + icon('star-outline') + 'Popular Brands</h2></div>' +
      '<div id="home-brands">' + loadingHtml() + '</div></div>';

    sections += promoBanner('cart-outline', 'Find a Camera Shop', 'Authorised dealers and trusted local shops across the island.', '#/shops');
    sections += promoBanner('shield-checkmark', 'Buy & Sell Safely', 'Our tips to avoid scams and meet sellers safely.', '#/safety');

    sections += '<div class="section" id="home-shops"><div class="section-head"><h2>' + icon('cart-outline') + 'Camera Shops</h2>' +
      '<a class="more" data-nav="#/shops">View all</a></div><div id="home-shops-body">' + loadingHtml('Loading camera shops…') + '</div></div>';
    sections += '<div class="section" id="home-posts"><div class="section-head"><h2>' + icon('reader-outline') + 'Buying Guides</h2>' +
      '<a class="more" data-nav="#/blog">View all</a></div><div id="home-posts-body">' + loadingHtml('Loading guides…') + '</div></div>';

    return {
      html: stats + sections + footer(),
      mount: function () {
        var verifyHome = $('#home-verify-email');
        if (verifyHome) verifyHome.addEventListener('click', function () {
          requestEmailOtp('#/');
        });

        var f = $('#home-search');
        if (f) f.addEventListener('submit', function (e) {
          e.preventDefault();
          var input = $('input', f);
          var q = (input ? input.value : '').trim();
          goSearch(q);
        });

        renderAsync({
          into: '#home-cats',
          load: function () { return ensureMeta().then(function (m) { return m.categories; }); },
          isEmpty: function (c) { return !c || !c.length; },
          emptyText: 'No categories available',
          emptySub: 'Check your connection and reload.',
          retryLabel: 'Reload categories',
          render: function (c) { return '<div class="cat-grid">' + c.map(catTile).join('') + '</div>'; }
        });

        renderAsync({
          into: '#home-brands',
          load: function () { return ensureMeta().then(function (m) { return (m.brands || []).slice(0, 12); }); },
          isEmpty: function (b) { return !b || !b.length; },
          emptyText: 'No brands yet',
          render: function (b) {
            return '<div class="chips" style="padding:0 16px">' + b.map(function (n) {
              return '<a class="chip" data-nav="#/browse?q=' + encodeURIComponent(n) + '">' + esc(n) + '</a>';
            }).join('') + '</div>';
          }
        });

        function listingStrip(sel, url, emptyText) {
          renderAsync({
            into: sel,
            load: function () { return api.get(url); },
            isEmpty: function (d) { return !d || !(d.items || []).length; },
            emptyText: emptyText,
            emptySub: 'New gear shows up here as soon as it is listed.',
            render: function (d) { return '<div class="hscroll">' + (d.items || []).slice(0, 8).map(lcard).join('') + '</div>'; }
          });
        }
        listingStrip('#home-featured-body', '/listings?featured=1', 'No featured listings yet');
        listingStrip('#home-latest-body', '/listings?sort=newest', 'No listings yet');

        renderAsync({
          into: '#home-shops-body',
          load: function () { return api.get('/businesses'); },
          isEmpty: function (s) { return !s || !s.length; },
          emptyText: 'No trusted camera shops yet',
          emptySub: 'Shops appear here once they register as business sellers.',
          retryLabel: 'Reload shops',
          render: function (s) { return '<div class="hscroll">' + s.slice(0, 5).map(shopCardSmall).join('') + '</div>'; }
        });

        renderAsync({
          into: '#home-posts-body',
          load: function () { return api.get('/posts'); },
          isEmpty: function () { return false; },
          render: function (posts) {
            posts = (posts && posts.length) ? posts : builtInBuyingGuides();
            return '<div class="hscroll">' + posts.slice(0, 4).map(function (p) {
              var href = p.href || ('#/blog/' + p.slug);
              var cleanGuide = p.slug ? ('/guide/' + encodeURIComponent(p.slug)) : '';
              return '<div class="lcard card-sm" data-nav="' + esc(href) + '">' +
                '<div class="thumb">' + (p.image ? '<img src="' + esc(p.image) + '" alt="' + esc(p.title || 'Guide') + '">' : '<span class="ph">' + icon('reader-outline') + '</span>') + '</div>' +
                '<div class="body"><div class="title" style="min-height:auto">' + (cleanGuide ? '<a href="' + cleanGuide + '" data-nav="' + esc(href) + '" style="color:inherit;text-decoration:none">' + esc(p.title) + '</a>' : esc(p.title)) + '</div>' +
                '<div class="meta"><span>' + esc(p.category || 'Guide') + '</span><span class="sep">·</span><span>' + fmtDate(p.created_at) + '</span></div></div></div>';
            }).join('') + '</div>';
          }
        });
      }
    };
  };

  function builtInBuyingGuides() {
    return [
      {
        title: 'How to inspect a used camera body',
        excerpt: 'Check shutter count, sensor condition, controls, autofocus and included accessories before paying.',
        image: '/images/products/sony-a7iii-1.jpg',
        href: '#/buying-guide'
      },
      {
        title: 'How to check a second-hand lens',
        excerpt: 'Inspect glass, fungus, aperture, stabilisation, focus and mount compatibility with your camera.',
        image: '/images/products/lens-canon-1.jpg',
        href: '#/buying-guide'
      },
      {
        title: 'Buying action cameras and creator gear',
        excerpt: 'Test recording, batteries, ports, microphones, stabilisation and waterproof seals safely.',
        image: '/images/products/gopro-1.jpg',
        href: '#/buying-guide'
      }
    ];
  }

  function shopCardSmall(s) {
    return '<a class="lcard card-sm" href="/shop/' + esc(s.slug) + '" data-nav="#/shop/' + esc(s.slug) + '" style="color:inherit;text-decoration:none">' +
      '<div class="thumb">' + (s.logo ? '<img src="' + esc(s.logo) + '" alt="' + esc(s.name || 'Shop') + ' logo' + '">' : '<span class="ph">' + icon('cart-outline') + '</span>') + '</div>' +
      '<div class="body"><div class="title" style="min-height:auto">' + esc(s.name) + (s.verified ? ' ' + icon('shield-checkmark') : '') + '</div>' +
      '<div class="meta"><span>' + icon('location-outline') + esc(s.city || s.area) + '</span></div></div></a>';
  }

  function promoBanner(ic, title, sub, link) {
    return '<div class="promo" data-nav="' + link + '"><div class="p-icon">' + icon(ic) + '</div>' +
      '<div><b>' + esc(title) + '</b><span>' + esc(sub) + '</span></div><div class="go">' + icon('chevron-forward-outline') + '</div></div>';
  }

  function footer() {
    return '<div class="footer" style="padding:26px 20px 20px;border-top:1px solid var(--line);margin-top:22px">' +
      '<div class="flex aic" style="gap:10px;margin-bottom:12px">' + logoMark() +
      '<div><div class="brand-name" style="font-size:15px">Lanka <b>Lens</b></div>' +
      '<div class="brand-tag">Buy &amp; Sell Cameras in Sri Lanka</div></div></div>' +
      '<div class="chips" style="gap:6px">' +
      ['About', 'Safety', 'Buying Guide', 'Sell Your Camera', 'Shops', 'FAQ', 'Help', 'Contact', 'Privacy', 'Terms'].map(function (p) {
        var slug = p.toLowerCase().replace(/[^a-z]+/g, '-');
        return '<a class="chip" style="font-size:11px;padding:6px 11px" data-nav="#/' + slug + '">' + p + '</a>';
      }).join('') + '</div>' +
      '<p class="muted fs12" style="margin-top:16px">© ' + new Date().getFullYear() + ' Lanka Lens. All rights reserved. Prices in Sri Lankan Rupees (LKR).</p></div>';
  }

  /* Website logo.
     When a logo file is configured (Admin → Settings → Logo URL, which also
     backs the uploaded /images/ asset) it is used EXACTLY as provided — an
     <img> contain-fitted inside the .brand-mark box (see lankalens.css), so it
     is never recoloured, distorted or cropped; the box scales it
     responsively at each placement (navbar 38px, drawer 44px, auth 62/48px).
     Until a logo file is configured the built-in mark below renders instead,
     so removing/changing the file can never break the pages.
     Every logo placement (home hero, footer, sign in/up, reset, drawer) goes
     through this one function — there is no second logo to keep in sync. */
  function logoMark() {
    var logo = (state.meta && state.meta.settings && state.meta.settings.logo) || '';
    if (!logo && window.LL_LOGO_URL) logo = window.LL_LOGO_URL;
    if (logo) {
      return '<span class="brand-mark"><img src="' + esc(logo) + '" alt="Lanka Lens logo" draggable="false"></span>';
    }
    return '<span class="brand-mark"><svg viewBox="0 0 64 64" width="100%" height="100%"><rect width="64" height="64" rx="14" fill="#0E7C66"/><circle cx="32" cy="32" r="19" fill="none" stroke="#fff" stroke-width="4"/><g fill="#F0A500"><path d="M32 17.5 L38.2 28.3 L50.5 30.1 L42 38.5 L44 50.8 L32 44.5 L20 50.8 L22 38.5 L13.5 30.1 L25.8 28.3 Z"/></g><circle cx="32" cy="32" r="6" fill="#0E7C66"/><circle cx="32" cy="32" r="3.2" fill="#fff"/></svg></span>';
  }

  views.categories = function () {
    var html = fullHeader('Categories', { right: '<button class="icon-btn" data-nav="#/search">' + icon('search-outline') + '</button>' });
    html += '<div class="section" style="padding-top:14px"><div id="cats-grid">' + loadingHtml('Loading categories…') + '</div></div>';
    html += '<div class="section"><div class="section-head"><h2>' + icon('layers-outline') + 'Browse by Type</h2></div>' +
      '<div id="cats-types">' + loadingHtml() + '</div></div>';
    html += '<div style="height:12px"></div>';
    return {
      html: html,
      mount: function () {
        function loadCats() { return ensureMeta().then(function (m) { return m.categories; }); }
        var states = {
          isEmpty: function (c) { return !c || !c.length; },
          emptyText: 'No categories available',
          emptySub: 'Check your connection and reload.',
          retryLabel: 'Reload categories'
        };
        renderAsync(Object.assign({
          into: '#cats-grid', load: loadCats,
          render: function (cats) { return '<div class="cat-grid">' + cats.map(catTile).join('') + '</div>'; }
        }, states));
        renderAsync(Object.assign({
          into: '#cats-types', load: loadCats,
          render: function (cats) {
            return cats.map(function (c) {
              return '<div class="divider-label">' + esc(c.name) + '</div><div class="subcats" style="padding:0 16px 6px">' +
                (c.children || []).map(function (s) {
                  return '<a class="chip" href="/category/' + esc(s.slug) + '" data-nav="#/category/' + esc(s.slug) + '">' + esc(s.name) + '</a>';
                }).join('') + '</div>';
            }).join('');
          }
        }, states));
      }
    };
  };

  views.category = function (params) {
    var slug = params.slug;
    var known = findSub(slug);
    var name = known ? known.sub.name : 'Category';
    var html = header(name, {});
    html += '<div class="subcats" id="cat-siblings" style="padding-top:12px">' + (known ? siblingsHtml(known, slug) : '') + '</div>';
    html += '<div class="section" style="padding-top:12px"><div class="section-head"><h2>' + icon('grid-outline') + 'Listings</h2>' +
      '<span class="muted fs12" id="cat-count"></span></div></div>';
    html += '<div id="cat-results">' + loadingHtml('Loading listings…') + '</div>';
    return {
      html: html,
      mount: function () {
        // Resolve the category names too, so a deep link works even when /meta
        // had not loaded before the first render.
        ensureMeta().then(function () {
          var found = findSub(slug) || findParent(slug);
          var t = $('.app-header .title');
          if (t && found) t.textContent = found.sub ? found.sub.name : found.name;
          var sib = $('#cat-siblings');
          if (sib && found) sib.innerHTML = siblingsHtml(found, slug);
        }).catch(logNonCritical('category header'));

        renderAsync({
          into: '#cat-results',
          // category= matches a sub-category AND everything under a parent, so
          // the home "Browse Categories" tiles (which link to parent slugs like
          // #/category/cameras) list gear instead of an empty page.
          load: function () { return api.get('/listings?category=' + encodeURIComponent(slug)); },
          isEmpty: function (d) { return !d || !(d.items || []).length; },
          emptyText: 'No listings in this category yet',
          emptySub: 'Be the first to post here — it takes about a minute.',
          retryLabel: 'Reload listings',
          render: function (d) {
            var c = $('#cat-count'); if (c) c.textContent = (d.total || 0) + ' found';
            return listingGrid(d.items);
          },
          onError: function () { var c = $('#cat-count'); if (c) c.textContent = ''; }
        });
      }
    };
  };

  function findParent(slug) {
    var cats = (state.meta && state.meta.categories) || [];
    for (var i = 0; i < cats.length; i++) if (cats[i].slug === slug) return cats[i];
    return null;
  }

  function siblingsHtml(found, slug) {
    var parent = found.sub ? found.parent : found;
    var kids = parent.children || [];
    return '<a class="chip" href="/category/' + esc(parent.slug) + '" data-nav="#/category/' + esc(parent.slug) + '">All ' + esc(parent.name) + '</a>' +
      kids.map(function (s) {
        return '<a class="chip' + (s.slug === slug ? ' active' : '') + '" href="/category/' + esc(s.slug) + '" data-nav="#/category/' + esc(s.slug) + '">' + esc(s.name) + '</a>';
      }).join('');
  }

  views.browse = function (query) {
    var q = query.get('q') || '';
    var filters = {
      q: q, category: query.get('category') || '', brand: '', model: '',
      condition: '', province: '', district: '', city: '', min: '', max: '',
      sort: 'recommended', page: 1, specs: {}
    };
    var html = header('Browse', { back: false, right: '<button class="icon-btn" data-nav="#/search">' + icon('search-outline') + '</button>' });
    html += '<form class="search-hero" id="browse-search" style="margin-top:14px"><span>' + icon('search-outline') + '</span>' +
      '<input type="search" placeholder="Search cameras, lenses, GoPro, DJI, drones..." value="' + esc(q) + '" inputmode="search" enterkeyhint="search" autocomplete="off">' +
      '<button type="submit">Search</button></form>';
    html += '<div class="filter-row" id="browse-filters">' +
      '<button class="chip" id="btn-sort">' + icon('swap-vertical-outline') + 'Sort</button>' +
      '<button class="chip" id="btn-filter">' + icon('funnel-outline') + 'Filters</button>' +
      '<span id="active-filter-chips" class="chips" style="padding-left:0"></span></div>';
    html += '<div class="section" style="padding-top:8px"><div class="section-head"><h2>' + icon('search-outline') + 'Results</h2>' +
      '<span class="muted fs12" id="browse-count"></span></div></div>';
    html += '<div id="browse-results"><div class="spinner"></div></div>';
    html += '<div id="browse-more" style="text-align:center;padding:8px 16px 20px"></div>';
    return {
      html: html,
      mount: function () {
        function buildQuery() {
          var qs = new URLSearchParams();
          if (filters.q) qs.set('q', filters.q);
          if (filters.category) qs.set('category', filters.category);
          if (filters.brand) qs.set('brand', filters.brand);
          if (filters.model) qs.set('model', filters.model);
          if (filters.condition) qs.set('condition', filters.condition);
          if (filters.province) qs.set('province', filters.province);
          if (filters.district) qs.set('district', filters.district);
          if (filters.city) qs.set('city', filters.city);
          if (filters.min) qs.set('min', filters.min);
          if (filters.max) qs.set('max', filters.max);
          Object.keys(filters.specs).forEach(function (k) {
            var v = filters.specs[k];
            if (typeof v === 'object') { // {min,max}
              if (v.min) qs.set('spec_' + k + '_min', v.min);
              if (v.max) qs.set('spec_' + k + '_max', v.max);
            } else if (v) {
              qs.set('spec_' + k, v);
            }
          });
          qs.set('sort', filters.sort);
          return qs;
        }
        function moreButton(d) {
          var m = $('#browse-more');
          if (!m) return;
          m.innerHTML = (filters.page < (d.pages || 1))
            ? '<button class="btn btn-outline btn-sm" id="load-more">Load more</button>' : '';
          var lm = $('#load-more');
          if (lm) lm.addEventListener('click', function () { filters.page++; loadMore(); });
        }
        function load() {
          filters.page = 1;
          var qs = buildQuery();
          var r0 = $('#browse-results');
          if (r0) r0.innerHTML = loadingHtml('Searching listings…');
          var c0 = $('#browse-count'); if (c0) c0.textContent = '';
          api.get('/listings?' + qs.toString()).then(function (d) {
            d = d || {};
            var c = $('#browse-count'); if (c) c.textContent = (d.total || 0) + ' found';
            var r = $('#browse-results');
            if (r) r.innerHTML = listingGrid(d.items, filters.q);
            moreButton(d);
            renderActiveChips();
          }).catch(function (e) {
            var c = $('#browse-count'); if (c) c.textContent = '';
            var r = $('#browse-results');
            if (r) {
              r.innerHTML = errorHtml((e && e.message) || 'Search failed.', 'Search again');
              var btn = r.querySelector('[data-state-retry]');
              if (btn) btn.addEventListener('click', function () { load(); });
            }
            var m = $('#browse-more'); if (m) m.innerHTML = '';
          });
        }
        function loadMore() {
          var qs = buildQuery();
          qs.set('page', filters.page);
          var m0 = $('#browse-more');
          if (m0) m0.innerHTML = '<div class="spinner spinner-sm"></div>';
          api.get('/listings?' + qs.toString()).then(function (d) {
            var r = $('#browse-results');
            var grid = r ? r.querySelector('.listing-grid') : null;
            if (grid) grid.insertAdjacentHTML('beforeend', (d.items || []).map(lcard).join(''));
            moreButton(d);
          }).catch(function (e) {
            filters.page = Math.max(1, filters.page - 1);   // let the user retry the same page
            var m = $('#browse-more');
            if (m) {
              m.innerHTML = '<div class="state-block state-error compact"><p>' + esc((e && e.message) || 'Could not load more listings.') + '</p>' +
                '<button class="btn btn-outline btn-sm" type="button" id="load-more-retry">' + icon('refresh-outline') + 'Retry</button></div>';
              var btn = $('#load-more-retry');
              if (btn) btn.addEventListener('click', function () { filters.page++; loadMore(); });
            }
          });
        }
        function renderActiveChips() {
          var host = $('#active-filter-chips');
          if (!host) return;
          var chips = [];
          if (filters.category) chips.push(['Category: ' + catName(filters.category), function () { filters.category = ''; load(); }]);
          if (filters.brand) chips.push([filters.brand, function () { filters.brand = ''; load(); }]);
          if (filters.model) chips.push(['Model: ' + filters.model, function () { filters.model = ''; load(); }]);
          if (filters.condition) chips.push([filters.condition, function () { filters.condition = ''; load(); }]);
          if (filters.province) chips.push([filters.province, function () { filters.province = ''; filters.district = ''; filters.city = ''; load(); }]);
          if (filters.min || filters.max) chips.push(['Rs ' + (filters.min || '0') + '–' + (filters.max || '∞'), function () { filters.min = ''; filters.max = ''; load(); }]);
          Object.keys(filters.specs).forEach(function (k) {
            var v = filters.specs[k];
            if (v) chips.push([pretty(k) + ': ' + (typeof v === 'object' ? ((v.min || '') + '–' + (v.max || '')) : v), function () { delete filters.specs[k]; load(); }]);
          });
          host.innerHTML = chips.map(function (c) {
            return '<a class="chip active" style="padding:6px 11px">' + esc(c[0]) + ' ' + icon('close-outline') + '</a>';
          }).join('');
          $$('#active-filter-chips .chip').forEach(function (c, i) {
            c.addEventListener('click', function () { chips[i][1](); });
          });
        }
        function catName(slug) {
          var cats = state.meta ? state.meta.categories : [];
          for (var i = 0; i < cats.length; i++) if (cats[i].slug === slug) return cats[i].name;
          return slug;
        }
        load();
        var f = $('#browse-search');
        f.addEventListener('submit', function (e) { e.preventDefault(); filters.q = $('input', f).value.trim(); load(); });
        $('#btn-sort').addEventListener('click', function () {
          openSheet('Sort by', [
            { icon: 'flash-outline', label: 'Recommended', onClick: function () { filters.sort = 'recommended'; load(); } },
            { icon: 'time-outline', label: 'Newest first', onClick: function () { filters.sort = 'newest'; load(); } },
            { icon: 'eye-outline', label: 'Most viewed', onClick: function () { filters.sort = 'popular'; load(); } },
            { icon: 'arrow-up-outline', label: 'Price: low to high', onClick: function () { filters.sort = 'price_asc'; load(); } },
            { icon: 'arrow-down-outline', label: 'Price: high to low', onClick: function () { filters.sort = 'price_desc'; load(); } }
          ]);
        });
        $('#btn-filter').addEventListener('click', function () { showFilterSheet(); });

        function showFilterSheet() {
          var host = $('#sheet-host');
          host.innerHTML = '<div class="sheet-mask" data-close-sheet><div class="sheet" data-stop><div class="grab"></div>' +
            '<div class="sheet-title">Filters</div><div class="filter-sheet" id="filter-sheet"><div class="spinner"></div></div>' +
            '<div class="filter-foot"><button class="btn btn-outline" id="fs-clear" style="flex:1">Clear</button>' +
            '<button class="btn btn-primary" id="fs-apply" style="flex:2">Apply filters</button></div>' +
            '</div></div>';
          requestAnimationFrame(function () { $('.sheet-mask', host).classList.add('open'); });
          function facetFor(cat) {
            api.get('/facets?category=' + encodeURIComponent(cat)).then(function (fd) {
              renderSheet(fd);
            }).catch(function () { renderSheet({ brands: [], models: [], specs: {} }); });
          }
          function renderSheet(fd) {
            var cats = state.meta ? state.meta.categories : [];
            var conds = state.meta ? state.meta.conditions : [];
            var provs = state.locations || [];
            var h = '';
            h += '<div class="f-label">Category</div><div class="chips" style="padding:0 16px">' +
              '<a class="chip' + (!filters.category ? ' active' : '') + '" data-fcat="">All</a>' +
              cats.map(function (c) {
                return '<a class="chip' + (filters.category === c.slug ? ' active' : '') + '" data-fcat="' + esc(c.slug) + '">' + esc(c.name) + '</a>';
              }).join('') + '</div>';
            h += '<div class="f-label">Brand</div><div class="form-group" style="padding:0 16px">' +
              '<select class="select" id="fs-brand"><option value="">All brands</option>' +
              (fd.brands || []).map(function (b) { return '<option value="' + esc(b) + '"' + (filters.brand === b ? ' selected' : '') + '>' + esc(b) + '</option>'; }).join('') + '</select></div>';
            h += '<div class="f-label">Model</div><div class="form-group" style="padding:0 16px">' +
              '<input class="input" id="fs-model" value="' + esc(filters.model) + '" placeholder="e.g. A7 III"></div>';
            h += '<div class="f-label">Condition</div><div class="chips" style="padding:0 16px">' +
              conds.map(function (c) {
                return '<a class="chip' + (filters.condition === c ? ' active' : '') + '" data-fcond="' + esc(c) + '">' + esc(c) + '</a>';
              }).join('') + '</div>';
            h += '<div class="f-label">Price (LKR)</div><div class="flex gap8" style="padding:0 16px">' +
              '<input class="input" id="fs-min" inputmode="numeric" placeholder="Min" value="' + esc(filters.min) + '">' +
              '<input class="input" id="fs-max" inputmode="numeric" placeholder="Max" value="' + esc(filters.max) + '"></div>';
            h += '<div class="f-label">Location</div><div style="padding:0 16px">' +
              '<div class="form-group"><select class="select" id="fs-prov"><option value="">All provinces</option>' +
              provs.map(function (p) { return '<option value="' + esc(p.name) + '"' + (filters.province === p.name ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select></div></div>';
            // category-specific spec filters
            Object.keys(fd.specs || {}).forEach(function (key) {
              var vals = fd.specs[key];
              if (!vals.length) return;
              if (key === 'shutter_count' && filters.category === 'cameras') return; // handled by numeric input below
              var cur = filters.specs[key];
              h += '<div class="f-label">' + esc(pretty(key)) + '</div><div class="chips" style="padding:0 16px">' +
                '<a class="chip' + (!cur ? ' active' : '') + '" data-fspec="' + esc(key) + '" data-fspecval="">Any</a>' +
                vals.map(function (v) {
                  return '<a class="chip' + (cur === v ? ' active' : '') + '" data-fspec="' + esc(key) + '" data-fspecval="' + esc(v) + '">' + esc(v) + '</a>';
                }).join('') + '</div>';
            });
            // numeric spec range (shutter count for cameras)
            if (filters.category === 'cameras') {
              var sc = filters.specs.shutter_count;
              var curMin = (sc && typeof sc === 'object') ? sc.min : '';
              var curMax = (sc && typeof sc === 'object') ? sc.max : '';
              h += '<div class="f-label">Max shutter count</div><div style="padding:0 16px">' +
                '<input class="input" id="fs-shutter" inputmode="numeric" placeholder="e.g. 50000" value="' + esc(curMax) + '"></div>';
            }
            var sheet = $('#filter-sheet');
            sheet.innerHTML = h;
            // category chip click -> refetch facets
            $$('#filter-sheet [data-fcat]').forEach(function (a) {
              a.addEventListener('click', function () {
                filters.category = a.getAttribute('data-fcat');
                facetFor(filters.category);
              });
            });
            $$('#filter-sheet [data-fcond]').forEach(function (a) {
              a.addEventListener('click', function () {
                $$('#filter-sheet [data-fcond]').forEach(function (x) { x.classList.remove('active'); });
                a.classList.add('active');
                filters.condition = filters.condition === a.getAttribute('data-fcond') ? '' : a.getAttribute('data-fcond');
                a.classList.toggle('active', !!filters.condition);
              });
            });
            $$('#filter-sheet [data-fspec]').forEach(function (a) {
              a.addEventListener('click', function () {
                var key = a.getAttribute('data-fspec');
                var val = a.getAttribute('data-fspecval');
                filters.specs[key] = val || undefined;
                renderSheet(fd);
              });
            });
          }
          facetFor(filters.category);

          $('#fs-apply').addEventListener('click', function () {
            filters.brand = ($('#fs-brand') ? $('#fs-brand').value : '');
            filters.model = ($('#fs-model') ? $('#fs-model').value.trim() : '');
            filters.min = ($('#fs-min') ? $('#fs-min').value.trim() : '');
            filters.max = ($('#fs-max') ? $('#fs-max').value.trim() : '');
            filters.province = ($('#fs-prov') ? $('#fs-prov').value : '');
            filters.district = ''; filters.city = '';
            if ($('#fs-shutter')) {
              var smax = $('#fs-shutter').value.trim();
              if (smax) filters.specs.shutter_count = { max: smax };
              else if (filters.specs.shutter_count && typeof filters.specs.shutter_count === 'object') delete filters.specs.shutter_count;
            }
            closeSheet();
            load();
          });
          $('#fs-clear').addEventListener('click', function () {
            filters.brand = ''; filters.model = ''; filters.condition = '';
            filters.province = ''; filters.district = ''; filters.city = '';
            filters.min = ''; filters.max = ''; filters.specs = {};
            closeSheet();
            load();
          });
        }
      }
    };
  };

  views.search = function () {
    var html = header('Search', { back: true });
    html += '<div class="section" style="padding-top:14px"><form id="search-form">' +
      '<div class="search-hero" style="margin:0"><span>' + icon('search-outline') + '</span>' +
      '<input type="search" placeholder="Search cameras, lenses, GoPro, DJI, drones..." ' +
      'inputmode="search" enterkeyhint="search" autocomplete="off">' +
      '<button type="submit">Search</button></div></form></div>';
    html += '<div class="section"><div class="section-head"><h2>' + icon('grid-outline') + 'Search by Category</h2></div>' +
      '<div id="search-cats">' + loadingHtml('Loading categories…') + '</div></div>';
    html += '<div class="section"><div class="section-head"><h2>' + icon('trending-up-outline') + 'Popular Searches</h2></div>' +
      '<div class="chips" style="padding:0 16px">' +
      ['Sony A7 III', 'Canon 50mm', 'GoPro', 'DJI Mini', 'Fujifilm', 'Sigma lens', 'Tripod', 'Gimbal'].map(function (s) {
        return '<a class="chip" data-nav="#/browse?q=' + encodeURIComponent(s) + '">' + esc(s) + '</a>';
      }).join('') + '</div></div>';
    return {
      html: html,
      mount: function () {
        var form = $('#search-form');
        if (form) {
          form.addEventListener('submit', function (e) {
            e.preventDefault();
            var input = $('input', form);
            // Empty searches browse everything instead of silently doing nothing.
            goSearch(input ? input.value : '');
          });
          // On mobile, `autofocus` on dynamically injected content is not
          // reliable: focus explicitly (after the first frame, once the page
          // has laid out) so the field receives focus and the keyboard opens.
          var searchInput = $('input', form);
          if (searchInput) {
            requestAnimationFrame(function () {
              try { searchInput.focus({ preventScroll: true }); } catch (e) { searchInput.focus(); }
            });
          }
        }
        renderAsync({
          into: '#search-cats',
          load: function () { return ensureMeta().then(function (m) { return m.categories; }); },
          isEmpty: function (c) { return !c || !c.length; },
          emptyText: 'No categories available',
          emptySub: 'Use the search box above, or try a popular search.',
          retryLabel: 'Reload categories',
          render: function (c) { return '<div class="cat-grid">' + c.map(catTile).join('') + '</div>'; }
        });
      }
    };
  };

  views.detail = function (params) {
    var html = '<div id="detail-root"><div class="spinner" style="margin-top:80px"></div></div>';
    return {
      html: html,
      hideTabbar: true,
      mount: function () {
        api.get('/listings/' + params.id).then(function (l) {
          renderDetail(l);
        }).catch(function (e) {
          $('#detail-root').innerHTML = header('Listing', {}) + '<div class="empty"><div class="e-icon">' + icon('alert-circle-outline') + '</div><h3>Not found</h3><p>' + esc(e.message) + '</p></div>';
        });
      }
    };
  };

  function renderDetail(l) {
    var imgs = l.images && l.images.length ? l.images : [];
    var favOn = isFav(l.id);
    setMeta(listingSeoTitle(l),
      listingSeoDescription(l),
      location.origin + '/listing/' + (l.slug || slugify(l.title || '')) + '-' + l.id,
      (l.images && l.images[0]) || '');
    var ghtml = '<div class="gallery">' +
      '<button class="back" data-back>' + icon('chevron-back-outline') + '</button>' +
      '<button class="favbig' + (favOn ? ' active' : '') + '" data-fav="' + l.id + '">' + icon(favOn ? 'heart' : 'heart-outline') + '</button>' +
      '<div class="main">' + (imgs.length ? imgs.map(function (src, i) {
        return '<div class="slide"><img src="' + esc(src) + '" alt="' + esc(listingImageAlt(l)) + ' photo ' + (i + 1) + '"></div>';
      }).join('') : '<div class="slide" style="display:flex;align-items:center;justify-content:center;color:#889;font-size:60px">' + icon('camera-outline') + '</div>') + '</div>' +
      '<span class="counter" id="g-counter">1 / ' + Math.max(1, imgs.length) + '</span></div>' +
      (imgs.length > 1 ? '<div class="thumbs">' + imgs.map(function (src, i) {
        return '<div class="t' + (i === 0 ? ' active' : '') + '" data-thumb="' + i + '"><img src="' + esc(src) + '" alt="' + esc(listingImageAlt(l)) + ' thumbnail ' + (i + 1) + '"></div>';
      }).join('') + '</div>' : '');

    var cond = l.condition || '—';
    var catName = l.category_name || '';
    var meta = '<div class="detail-wrap">' +
      (l.featured || l.urgent ? '<div style="margin-bottom:8px">' +
        (l.featured ? '<span class="vbadge" style="background:var(--accent-light);color:var(--accent-dark);margin-right:6px">' + icon('flash-outline') + ' Featured</span>' : '') +
        (l.urgent ? '<span class="vbadge" style="background:#FDE8E8;color:#C62828">' + icon('flame-outline') + ' Urgent</span>' : '') + '</div>' : '') +
      '<div class="detail-price-row"><div><div class="detail-price">' + fmtLKR(l.price) + (l.negotiable ? ' <small>negotiable</small>' : '') + '</div></div>' +
      (l.category_slug ? '<a class="vbadge" href="/category/' + esc(l.category_slug) + '" data-nav="#/category/' + esc(l.category_slug) + '" style="text-decoration:none">' + icon('pricetag-outline') + esc(catName) + '</a>' : '<span class="vbadge">' + icon('pricetag-outline') + esc(catName) + '</span>') + '</div>' +
      '<h1 class="detail-title">' + esc(l.title) + '</h1>' +
      '<div class="detail-meta">' +
      '<span>' + icon('location-outline') + esc(l.location || 'Sri Lanka') + '</span>' +
      '<span>' + icon('calendar-outline') + 'Posted ' + timeAgo(l.created_at) + '</span>' +
      '<span>' + icon('eye-outline') + l.views + ' views</span>' +
      '<span>' + icon('pricetag-outline') + esc(cond) + '</span></div></div>';

    var specRows = '';
    (l.fields || []).forEach(function (f) {
      var v = l.specs && l.specs[f.name] ? l.specs[f.name] : '';
      if (v) specRows += '<div class="spec-row"><span class="k">' + esc(f.label) + '</span><span class="v">' + esc(v) + '</span></div>';
    });
    // Product identifiers are safe to show publicly and should match the
    // structured data Google sees. They are not unique item serial numbers.
    var gtinValue = l.specs && (l.specs.gtin || l.specs.barcode);
    if (gtinValue) specRows += '<div class="spec-row"><span class="k">GTIN / Barcode</span><span class="v">' + esc(gtinValue) + '</span></div>';
    if (l.specs && l.specs.mpn) specRows += '<div class="spec-row"><span class="k">MPN</span><span class="v">' + esc(l.specs.mpn) + '</span></div>';

    var policyRows = '';
    var sp = Object.assign({}, (l.seller && l.seller.business && l.seller.business.merchant_policy) || {}, l.specs || {});
    var hasShipping = ['shipping_rate_lkr', 'handling_min_days', 'handling_max_days', 'transit_min_days', 'transit_max_days'].every(function (k) {
      return sp[k] !== undefined && sp[k] !== null && String(sp[k]).trim() !== '';
    });
    if (hasShipping) {
      var shippingRate = parseInt(sp.shipping_rate_lkr, 10) || 0;
      policyRows += '<div class="spec-row"><span class="k">Shipping</span><span class="v">' +
        (shippingRate === 0 ? 'Free' : fmtLKR(shippingRate)) + '</span></div>';
      policyRows += '<div class="spec-row"><span class="k">Delivery time</span><span class="v">Handling ' +
        esc(sp.handling_min_days) + '-' + esc(sp.handling_max_days) + ' day(s); transit ' +
        esc(sp.transit_min_days) + '-' + esc(sp.transit_max_days) + ' day(s)</span></div>';
    }
    if (sp.return_policy === 'not_permitted') {
      policyRows += '<div class="spec-row"><span class="k">Returns</span><span class="v">Returns not accepted</span></div>';
    } else if (sp.return_policy === 'unlimited') {
      policyRows += '<div class="spec-row"><span class="k">Returns</span><span class="v">Unlimited return window</span></div>';
    } else if (sp.return_policy === 'finite' && sp.return_days) {
      policyRows += '<div class="spec-row"><span class="k">Returns</span><span class="v">Returns accepted within ' +
        esc(sp.return_days) + ' day(s)</span></div>';
    }

    // extras not in schema
    var extraKeys = ['warranty', 'receipt', 'charger', 'original_box', 'box', 'battery', 'batteries', 'accessories', 'reason_for_selling'];
    var doneKeys = (l.fields || []).map(function (f) { return f.name; });
    extraKeys.forEach(function (k) {
      if (doneKeys.indexOf(k) === -1 && l.specs && l.specs[k]) {
        specRows += '<div class="spec-row"><span class="k">' + esc(pretty(k)) + '</span><span class="v">' + esc(l.specs[k]) + '</span></div>';
      }
    });

    var specs = '<div class="detail-wrap" style="padding-top:0"><div class="section-head" style="margin-bottom:8px"><h2>' + icon('list-outline') + 'Specifications</h2></div>' +
      '<div class="info-card">' + (specRows || '<div class="spec-row"><span class="k">Details</span><span class="v">Contact seller for more info</span></div>') + '</div></div>' +
      (policyRows ? '<div class="detail-wrap" style="padding-top:0"><div class="section-head" style="margin-bottom:8px"><h2>' + icon('car-outline') + 'Delivery &amp; Returns</h2></div><div class="info-card">' + policyRows + '</div></div>' : '');

    var desc = l.description ? '<div class="detail-wrap" style="padding-top:0"><div class="section-head" style="margin-bottom:8px"><h2>' + icon('document-text-outline') + 'Description</h2></div>' +
      '<div class="info-card" style="padding:14px"><p style="font-size:14px;line-height:1.65;color:var(--ink-2);white-space:pre-line">' + esc(l.description) + '</p></div></div>' : '';

    var s = l.seller || {};
    var seller = '<div class="detail-wrap" style="padding-top:0"><div class="section-head" style="margin-bottom:8px"><h2>' + icon('person-outline') + 'Seller Information</h2></div>' +
      '<div class="seller-card" data-nav="#/seller/' + s.id + '">' + avatarHtml(s, 'lg') +
      '<div class="info"><div class="name">' + esc(s.name) + (s.verified ? '<span class="vbadge">' + icon('shield-checkmark') + 'Verified</span>' : '') +
      (s.seller_type === 'business' ? '<span class="vbadge" style="background:#EAF1FD;color:#3A6FB0">' + icon('briefcase-outline') + 'Business</span>' : '') + '</div>' +
      '<div class="loc">' + icon('location-outline') + esc([s.city, s.province].filter(Boolean).join(', ') || 'Sri Lanka') + '</div>' +
      '<div class="loc">' + icon('time-outline') + 'Member since ' + fmtDate(s.created_at) + '</div></div>' +
      '<div class="chev">' + icon('chevron-forward-outline') + '</div></div>' +
      (s.business ? '<a class="biz-link" href="/shop/' + esc(s.business.slug) + '" data-nav="#/shop/' + esc(s.business.slug) + '">' + icon('briefcase-outline') + ' Visit shop: ' + esc(s.business.name) + icon('chevron-forward-outline') + '</a>' : '') +
      '</div>';

    var related = (l.related || []).length ? '<div class="section"><div class="section-head"><h2>' + icon('albums-outline') + 'Related Listings</h2></div>' +
      '<div class="hscroll">' + l.related.map(lcard).join('') + '</div></div>' : '';

    var safe = '<div class="detail-wrap" style="padding-top:0">' +
      '<div class="info-card" style="display:flex;gap:10px;align-items:center;background:var(--brand-light);border-color:transparent;padding:13px 14px">' +
      '<span style="color:var(--brand);font-size:24px">' + icon('shield-checkmark') + '</span>' +
      '<div style="font-size:12.5px;color:var(--ink-2)"><b style="color:var(--ink)">Stay safe.</b> Meet in a public place, test before you pay, and never send money in advance. <a data-nav="#/safety" style="font-weight:700">Safety tips</a></div></div></div>';

    var prefs = l.contact_prefs || {};
    var actionBar = '<div class="action-bar">' +
      '<button class="icon-action" data-fav="' + l.id + '" id="ab-fav">' + icon(favOn ? 'heart' : 'heart-outline') + '</button>' +
      (prefs.chat !== false ? '<button class="icon-action" id="btn-chat" aria-label="Chat">' + icon('chatbubble-ellipses-outline') + '</button>' : '') +
      (prefs.whatsapp !== false ? '<button class="btn btn-wa" id="btn-wa">' + icon('logo-whatsapp') + 'WhatsApp</button>' : '') +
      (prefs.phone !== false ? '<button class="btn btn-primary" id="btn-call">' + icon('call-outline') + 'Call</button>' : '') +
      '<button class="icon-action" id="btn-more">' + icon('ellipsis-horizontal-outline') + '</button></div>';

    $('#detail-root').innerHTML = ghtml + meta + specs + desc + seller + related + safe + '<div style="height:20px"></div>' + actionBar;

    // gallery events
    var main = $('.gallery .main');
    if (main) main.addEventListener('scroll', function () {
      var idx = Math.round(main.scrollLeft / main.clientWidth);
      var c = $('#g-counter'); if (c) c.textContent = (idx + 1) + ' / ' + Math.max(1, imgs.length);
      $$('.thumbs .t').forEach(function (t, i) { t.classList.toggle('active', i === idx); });
    });
    $$('.thumbs .t').forEach(function (t) {
      t.addEventListener('click', function () {
        var i = parseInt(t.getAttribute('data-thumb'), 10);
        main.scrollTo({ left: i * main.clientWidth, behavior: 'smooth' });
      });
    });

    function recordContact(kind) {
      api.post('/listings/' + l.id + '/contact', { kind: kind }).catch(logNonCritical('contact analytics'));
    }
    var chatButton = $('#btn-chat');
    if (chatButton) chatButton.addEventListener('click', function () {
      recordContact('chat');
      if (requireAuth()) location.hash = '#/chat/' + s.id + '?listing=' + l.id;
    });
    var whatsappButton = $('#btn-wa');
    if (whatsappButton) whatsappButton.addEventListener('click', function () {
      var num = phoneDigits(s.whatsapp || s.phone);
      if (!num) return toast('Seller did not share a number', 'error');
      recordContact('whatsapp');
      window.open('https://wa.me/' + num + '?text=' + encodeURIComponent('Hi, I\'m interested in your listing "' + l.title + '" on Lanka Lens.'), '_blank');
    });
    var callButton = $('#btn-call');
    if (callButton) callButton.addEventListener('click', function () {
      if (!s.phone) return toast('Seller did not share a number', 'error');
      recordContact('call');
      window.location.href = 'tel:' + phoneDigits(s.phone);
    });
    var moreButton = $('#btn-more');
    if (moreButton) moreButton.addEventListener('click', function () {
      openSheet(null, [
        { icon: 'chatbubble-ellipses-outline', label: 'Chat with seller', onClick: function () { recordContact('chat'); if (requireAuth()) location.hash = '#/chat/' + s.id + '?listing=' + l.id; } },
        { icon: 'cash-outline', label: 'Make an offer', onClick: function () { openOfferDialog(l); } },
        { icon: 'share-social-outline', label: 'Share listing', onClick: function () { shareListing(l); } },
        { icon: 'flag-outline', label: 'Report listing', danger: true, onClick: function () { openReportSheet(l); } }
      ]);
    });
  }

  function pretty(k) {
    return k.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function shareListing(l) {
    var url = location.origin + listingPublicHref(l);
    if (navigator.share) {
      navigator.share({ title: l.title, text: l.title + ' — ' + fmtLKR(l.price), url: url })
        .catch(function (e) {
          // Dismissing the share sheet is not an error; anything else is worth recording.
          if (e && (e.name === 'AbortError' || e.name === 'NotAllowedError')) return;
          logNonCritical('share')(e);
          toast('Could not open the share sheet', 'error');
        });
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function () { toast('Link copied', 'success'); }).catch(function () { toast('Could not copy link', 'error'); });
    } else {
      toast('Share this link: ' + url);
    }
  }

  function openReportSheet(l) {
    var reasons = (state.meta && state.meta.report_reasons) || ['Scam', 'Fake product', 'Wrong information', 'Duplicate', 'Wrong category', 'Prohibited item', 'Other'];
    openSheet('Report this listing', reasons.map(function (r) {
      return { icon: 'flag-outline', label: r, danger: true, onClick: function () {
        if (!requireAuth()) return;
        api.post('/listings/' + l.id + '/report', { reason: r }).then(function () {
          toast('Thanks — our team will review it', 'success');
        }).catch(function (e) { toast(e.message, 'error'); });
      } };
    }));
  }

  function openOfferDialog(l) {
    if (!requireAuth()) return;
    openDialog('Make an offer', '<p>Offer a price for “' + esc(l.title) + '”. The seller will be notified.</p>' +
      '<div class="form-group mt16"><label>Your offer (LKR)</label><input class="input" id="offer-amt" inputmode="numeric" placeholder="e.g. 300000"></div>' +
      '<div class="form-group"><label>Message (optional)</label><textarea class="textarea" id="offer-msg" style="min-height:70px" placeholder="Hi, would you consider...?"></textarea></div>',
      'Send offer', false, function () {
        var amt = $('#offer-amt').value.trim();
        var msg = $('#offer-msg').value.trim();
        api.post('/listings/' + l.id + '/offer', { amount: parseInt(amt, 10), message: msg }).then(function () {
          closeDialog(); toast('Offer sent to the seller', 'success');
        }).catch(function (e) { toast(e.message, 'error'); });
      });
  }

  views.sell = function () {
    var html = header('Sell Your Camera', {});
    html += '<div class="section" style="padding-top:14px"><div class="section-head"><h2>' + icon('add-circle-outline') + 'Choose a Category</h2></div>' +
      '<p class="form-hint" style="padding:0 16px 4px">Pick what you are selling — the next steps adapt to it (a lens asks for mount and aperture, a drone for flight time and batteries).</p></div>';
    html += '<div id="sell-cats">' + loadingHtml('Loading categories…') + '</div>';
    html += '<div style="height:12px"></div>';
    return { html: html, mount: loadSellCategories };
  };

  /**
   * Category list for the Post Ad entry page. Loaded on demand from the API so
   * the page works even when /meta failed or had not resolved at first render
   * (that used to show the heading and nothing to click).
   */
  function sellCatsHtml(cats) {
    var out = '';
    cats.forEach(function (c) {
      var kids = c.children || [];
      out += '<div class="divider-label">' + esc(c.name) + '</div>';
      out += '<div class="subcats" style="padding:0 16px 8px">' + (kids.length
        ? kids.map(function (s) {
            return '<a class="chip" role="button" tabindex="0" data-nav="#/sell/' + esc(s.slug) + '">' + esc(s.name) + '</a>';
          }).join('')
        : '<a class="chip" role="button" tabindex="0" data-nav="#/sell/' + esc(c.slug) + '">' + esc(c.name) + '</a>') + '</div>';
    });
    return out;
  }

  function loadSellCategories() {
    renderAsync({
      into: '#sell-cats',
      load: function () { return ensureMeta().then(function (m) { return m.categories; }); },
      isEmpty: function (c) { return !c || !c.length; },
      emptyText: 'No categories available',
      emptySub: 'Categories come from the server. Check the connection and try again.',
      emptyIcon: 'alert-circle-outline',
      retryLabel: 'Reload categories',
      render: sellCatsHtml
    });
  }

  /* ============================================================
     Multi-step post-an-ad wizard (also powers edit)
     ============================================================ */
  function catFlatten() {
    var out = [];
    (state.meta ? state.meta.categories : []).forEach(function (c) {
      (c.children || []).forEach(function (s) { out.push({ parent: c, sub: s }); });
    });
    return out;
  }
  function findSub(slug) {
    var list = catFlatten();
    for (var i = 0; i < list.length; i++) if (list[i].sub.slug === slug) return list[i];
    return null;
  }
  function findSubById(id) {
    var list = catFlatten();
    for (var i = 0; i < list.length; i++) if (list[i].sub.id === id) return list[i];
    return null;
  }

  var WZ_STEPS = ['Brand & Model', 'Product Details', 'Condition', 'Price', 'Title & Description', 'Photos', 'Location', 'Contact', 'Preview'];

  function listingWizard(initial) {
    initial = initial || {};
    var edit = initial.edit || null;
    var wz = {
      step: 0,
      submitting: false,
      cat: initial.cat || null,
      title: edit ? edit.title : '',
      price: edit ? String(edit.price || '') : '',
      negotiable: edit ? !!edit.negotiable : true,
      condition: edit ? (edit.condition || 'Good') : 'Good',
      description: edit ? (edit.description || '') : '',
      specs: edit ? (edit.specs || {}) : {},
      province: edit ? (edit.province || '') : '',
      district: edit ? (edit.district || '') : '',
      city: edit ? (edit.city || '') : '',
      contact: (edit && edit.contact_prefs && Object.keys(edit.contact_prefs).length)
        ? { phone: !!edit.contact_prefs.phone, whatsapp: !!edit.contact_prefs.whatsapp, chat: !!edit.contact_prefs.chat }
        : { phone: true, whatsapp: true, chat: true },
      images: (edit && edit.images) ? edit.images.map(function (u) { return { url: u }; }) : []
    };

    function fields() {
      if (!wz.cat) return [];
      return (wz.cat.sub.fields && wz.cat.sub.fields.length) ? wz.cat.sub.fields : wz.cat.parent.fields;
    }
    function field(name) {
      var fs = fields();
      for (var i = 0; i < fs.length; i++) if (fs[i].name === name) return fs[i];
      return null;
    }
    function brandOptions() {
      var f = field('brand');
      if (f && f.options && f.options.length) return f.options;
      return (state.meta ? state.meta.brands : []);
    }

    function fieldInput(f) {
      var v = wz.specs[f.name] || '';
      var req = f.required ? ' required' : '';
      if (f.type === 'select') {
        return '<select class="select" data-spec="' + esc(f.name) + '"' + req + '><option value="">Select…</option>' +
          (f.options || []).map(function (o) { return '<option value="' + esc(o) + '"' + (String(v) === String(o) ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
      }
      if (f.type === 'textarea') {
        return '<textarea class="textarea" data-spec="' + esc(f.name) + '" placeholder="' + esc(f.label) + '" style="min-height:80px">' + esc(v) + '</textarea>';
      }
      if (f.type === 'number') {
        return '<input class="input" type="number" data-spec="' + esc(f.name) + '" value="' + esc(v) + '" placeholder="' + esc(f.label) + '">';
      }
      return '<input class="input" data-spec="' + esc(f.name) + '" value="' + esc(v) + '" placeholder="' + esc(f.label) + '"' + req + '>';
    }

    function progressHtml() {
      var pct = Math.round((wz.step + 1) / WZ_STEPS.length * 100);
      return '<div class="wizard-top"><div class="wizard-track"><div class="wizard-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="wizard-label">' + esc(wz.cat ? wz.cat.sub.name : '') + ' · Step ' + (wz.step + 1) + ' of ' + WZ_STEPS.length + '</div></div>';
    }

    function stepBody() {
      var i = wz.step;
      var b = '';
      if (i === 0) {
        // Brand & model (+ year when present)
        var brands = brandOptions();
        var bf = field('brand');
        b += '<div class="form-card"><div class="section-head" style="margin-bottom:4px"><h2>' + icon('pricetag-outline') + 'Brand &amp; Model</h2></div>';
        b += '<div class="form-group"><label>Brand' + (bf && bf.required ? ' <span class="req">*</span>' : '') + '</label>' +
          '<select class="select" data-spec="brand"' + (bf && bf.required ? ' required' : '') + '><option value="">Select…</option>' +
          brands.map(function (o) { return '<option value="' + esc(o) + '"' + (String(wz.specs.brand || '') === String(o) ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select></div>';
        b += '<div class="form-group"><label>Model <span class="req">*</span></label><input class="input" data-spec="model" value="' + esc(wz.specs.model || '') + '" placeholder="e.g. A7 III" required></div>';
        if (field('year')) {
          b += '<div class="form-group"><label>Year</label><input class="input" data-spec="year" value="' + esc(wz.specs.year || '') + '" placeholder="e.g. 2021"></div>';
        }
        b += '<div class="form-group"><label>GTIN / Barcode <span class="muted">(optional)</span></label>' +
          '<input class="input" data-spec="gtin" inputmode="numeric" maxlength="18" value="' + esc(wz.specs.gtin || wz.specs.barcode || '') + '" placeholder="e.g. 012345678905">' +
          '<div class="form-hint">Use the product barcode number only. Leave blank if the item has no GTIN.</div></div>';
        b += '<div class="form-group"><label>Manufacturer part number (MPN) <span class="muted">(optional)</span></label>' +
          '<input class="input" data-spec="mpn" maxlength="70" value="' + esc(wz.specs.mpn || '') + '" placeholder="e.g. CHDHX-121-RW">' +
          '<div class="form-hint">Use the manufacturer\'s part number, not the item serial number.</div></div>';
        b += '</div>';
      } else if (i === 1) {
        // Remaining dynamic fields
        var rest = fields().filter(function (f) { return f.name !== 'brand' && f.name !== 'model' && f.name !== 'year'; });
        b += '<div class="form-card"><div class="section-head" style="margin-bottom:4px"><h2>' + icon('list-outline') + esc(wz.cat ? wz.cat.sub.name : '') + ' Details</h2></div>';
        if (!rest.length) {
          b += '<p class="form-hint">No extra specifications for this category.</p>';
        } else {
          rest.forEach(function (f) {
            b += '<div class="form-group"><label>' + esc(f.label) + (f.required ? ' <span class="req">*</span>' : '') + '</label>' + fieldInput(f) + '</div>';
          });
        }
        b += '</div>';
        b += '<div class="form-card"><div class="section-head" style="margin-bottom:4px"><h2>' + icon('car-outline') + 'Delivery &amp; Returns <span class="muted">(optional)</span></h2></div>' +
          '<p class="form-hint" style="margin-bottom:10px">Add these only if you offer delivery. The information is shown to buyers and may be used by Google Merchant listings.</p>' +
          '<div class="form-group"><label>Shipping cost (LKR)</label><input class="input" type="number" min="0" max="1000000" step="1" data-spec="shipping_rate_lkr" value="' + esc(wz.specs.shipping_rate_lkr || '') + '" placeholder="0 for free shipping"></div>' +
          '<div class="form-group"><label>Handling time (days)</label><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
          '<input class="input" type="number" min="0" max="365" step="1" data-spec="handling_min_days" value="' + esc(wz.specs.handling_min_days || '') + '" placeholder="Min">' +
          '<input class="input" type="number" min="0" max="365" step="1" data-spec="handling_max_days" value="' + esc(wz.specs.handling_max_days || '') + '" placeholder="Max"></div></div>' +
          '<div class="form-group"><label>Transit time (days)</label><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
          '<input class="input" type="number" min="0" max="365" step="1" data-spec="transit_min_days" value="' + esc(wz.specs.transit_min_days || '') + '" placeholder="Min">' +
          '<input class="input" type="number" min="0" max="365" step="1" data-spec="transit_max_days" value="' + esc(wz.specs.transit_max_days || '') + '" placeholder="Max"></div></div>' +
          '<div class="form-group"><label>Return policy</label><select class="select" data-spec="return_policy">' +
          '<option value="">Not specified</option>' +
          '<option value="not_permitted"' + (wz.specs.return_policy === 'not_permitted' ? ' selected' : '') + '>Returns not accepted</option>' +
          '<option value="finite"' + (wz.specs.return_policy === 'finite' ? ' selected' : '') + '>Returns accepted within a set number of days</option>' +
          '<option value="unlimited"' + (wz.specs.return_policy === 'unlimited' ? ' selected' : '') + '>Unlimited return window</option></select></div>' +
          '<div class="form-group"><label>Return window (days)</label><input class="input" type="number" min="1" max="365" step="1" data-spec="return_days" value="' + esc(wz.specs.return_days || '') + '" placeholder="Only needed for a set return window">' +
          '<div class="form-hint">Leave blank when returns are not accepted or the return window is unlimited.</div></div></div>';
      } else if (i === 2) {
        b += '<div class="form-card"><div class="section-head" style="margin-bottom:4px"><h2>' + icon('checkmark-circle-outline') + 'Condition</h2></div>' +
          '<div class="seg seg-2" id="wz-cond">' +
          (state.meta ? state.meta.conditions : []).map(function (c) {
            return '<div class="opt' + (wz.condition === c ? ' active' : '') + '" data-cond="' + esc(c) + '">' + esc(c) + '</div>';
          }).join('') + '</div></div>';
      } else if (i === 3) {
        b += '<div class="form-card"><div class="section-head" style="margin-bottom:4px"><h2>' + icon('cash-outline') + 'Price</h2></div>' +
          '<div class="form-group"><label>Price (LKR) <span class="req">*</span></label>' +
          '<input class="input" id="wz-price" inputmode="numeric" value="' + esc(wz.price) + '" placeholder="e.g. 325000"></div>' +
          '<div class="switch-row"><div><label style="margin:0">Negotiable</label><div class="form-hint">Let buyers send you offers</div></div>' +
          '<label class="switch"><input type="checkbox" id="wz-neg"' + (wz.negotiable ? ' checked' : '') + '><span class="slider"></span></label></div></div>';
      } else if (i === 4) {
        b += '<div class="form-card"><div class="section-head" style="margin-bottom:4px"><h2>' + icon('document-text-outline') + 'Title &amp; Description</h2></div>' +
          '<div class="form-group"><label>Listing title <span class="req">*</span></label>' +
          '<input class="input" id="wz-title" value="' + esc(wz.title) + '" placeholder="e.g. Sony A7 III body, excellent condition" maxlength="90"></div>' +
          '<div class="form-group"><label>Description</label>' +
          '<textarea class="textarea" id="wz-desc" placeholder="Condition, usage history, what’s included…" style="min-height:130px">' + esc(wz.description) + '</textarea></div></div>';
      } else if (i === 5) {
        b += '<div class="form-card"><div class="section-head" style="margin-bottom:4px"><h2>' + icon('images-outline') + 'Photos</h2></div>' +
          '<p class="form-hint" style="margin-bottom:10px">Add up to 3 photos. The first photo is your cover. Use ★ to set a cover, arrows to reorder.</p>' +
          '<div class="upload-grid" id="wz-upload"></div></div>' +
          '<p class="form-hint" style="padding:0 16px;margin-top:10px">Tip for used gear: shoot the front, back, top, LCD, lens mount and accessories. Never show serial numbers publicly.</p>';
      } else if (i === 6) {
        b += '<div class="form-card"><div class="section-head" style="margin-bottom:4px"><h2>' + icon('location-outline') + 'Location</h2></div>' +
          locationSelectsHtml() + '</div>';
      } else if (i === 7) {
        b += '<div class="form-card"><div class="section-head" style="margin-bottom:4px"><h2>' + icon('call-outline') + 'Contact Options</h2></div>' +
          '<p class="form-hint" style="margin-bottom:6px">Choose how buyers can reach you. Your number is taken from your profile.</p>' +
          '<div class="switch-row form-group"><div><label style="margin:0">Phone calls</label></div>' +
          '<label class="switch"><input type="checkbox" id="wz-phone"' + (wz.contact.phone ? ' checked' : '') + '><span class="slider"></span></label></div>' +
          '<div class="switch-row form-group"><div><label style="margin:0">WhatsApp</label></div>' +
          '<label class="switch"><input type="checkbox" id="wz-wa"' + (wz.contact.whatsapp ? ' checked' : '') + '><span class="slider"></span></label></div>' +
          '<div class="switch-row form-group"><div><label style="margin:0">In-app chat</label></div>' +
          '<label class="switch"><input type="checkbox" id="wz-chat"' + (wz.contact.chat ? ' checked' : '') + '><span class="slider"></span></label></div></div>';
      } else if (i === 8) {
        b += '<div class="form-card"><div class="section-head" style="margin-bottom:8px"><h2>' + icon('eye-outline') + 'Preview</h2></div>' + previewHtml() + '</div>';
      }
      return b;
    }

    function previewHtml() {
      var img = wz.images.length ? (wz.images[0].url || (wz.images[0].file ? '' : '')) : '';
      if (!img && wz.images.length && wz.images[0].file) img = 'file://pending';
      var showImg = wz.images.length ? wz.images[0].url : null;
      var imgsrc = showImg ? '<img src="' + esc(showImg) + '" alt="' + 'Selected photo preview' + '">' : '';
      if (!showImg && wz.images.length && wz.images[0].file) {
        // can't preview a local file easily after re-render; show placeholder
        imgsrc = '<span class="ph">' + icon('image-outline') + '</span>';
      }
      var specRows = fields().map(function (f) {
        var v = wz.specs[f.name];
        return v ? '<div class="spec-row"><span class="k">' + esc(f.label) + '</span><span class="v">' + esc(v) + '</span></div>' : '';
      }).join('');
      return '<div class="preview-card">' +
        '<div class="pc-thumb">' + (imgsrc || '<span class="ph">' + icon('camera-outline') + '</span>') +
        (wz.images.length ? '<span class="cond-chip">' + wz.images.length + ' photo(s)</span>' : '') + '</div>' +
        '<div class="pc-body"><div class="title">' + esc(wz.title || 'Your listing title') + '</div>' +
        '<div class="price">' + fmtLKR(wz.price || 0) + (wz.negotiable ? ' <span class="neg">negotiable</span>' : '') + '</div>' +
        '<div class="meta"><span>' + icon('location-outline') + esc(wz.city || wz.district || wz.province || 'Location') + '</span>' +
        '<span class="sep">·</span><span>' + esc(wz.condition || 'Condition') + '</span></div></div></div>' +
        (specRows ? '<div class="info-card mt16">' + specRows + '</div>' : '') +
        (wz.description ? '<div class="fs13 muted mt16" style="line-height:1.6">' + esc(wz.description) + '</div>' : '');
    }

    function renderUploads() {
      var grid = $('#wz-upload');
      if (!grid) return;
      var tiles = wz.images.map(function (it, i) {
        var src = it.file ? (it._url || '') : it.url;
        var thumb = it.file
          ? '<div class="ph">' + icon('image-outline') + '</div>'
          : '<img src="' + esc(it.url) + '" alt="' + 'Photo ' + (i + 1) + '">';
        return '<div class="upload-tile has-img">' + (src && it.file ? '<img src="' + esc(src) + '" alt="' + 'Photo ' + (i + 1) + ' preview' + '">' : thumb) +
          (i === 0 ? '<span class="cover-badge">Cover</span>' : '') +
          '<span class="rm" data-wz-rm="' + i + '">' + icon('close-outline') + '</span>' +
          '<div class="tile-tools">' +
          '<button type="button" data-wz-left="' + i + '"' + (i === 0 ? ' disabled' : '') + '>' + icon('arrow-back-outline') + '</button>' +
          '<button type="button" data-wz-cover="' + i + '">' + icon('star-outline') + '</button>' +
          '<button type="button" data-wz-right="' + i + '"' + (i === wz.images.length - 1 ? ' disabled' : '') + '>' + icon('arrow-forward-outline') + '</button>' +
          '</div></div>';
      }).join('');
      grid.innerHTML = tiles + (wz.images.length < 3
        ? '<label class="upload-tile" id="wz-add">' + icon('add-outline') + '<input type="file" accept="image/*" multiple hidden></label>'
        : '');
      var inp = $('#wz-add input');
      if (inp) inp.addEventListener('change', function () {
        var picked = Array.prototype.slice.call(this.files || []);
        var skipped = 0;
        var tooLarge = 0;
        picked.forEach(function (f) {
          if (wz.images.length >= 3) { skipped++; return; }
          if (f.size > 1048576) { tooLarge++; return; }
          if (f.type && f.type.indexOf('image/') !== 0) { return; }
          var item = { file: f, _url: URL.createObjectURL(f) };
          wz.images.push(item);
        });
        if (tooLarge) toast('Some photos were over 1MB and were skipped', 'error');
        else if (skipped) toast('Maximum is 3 photos', 'error');
        renderUploads();
      });
      $$('#wz-upload [data-wz-rm]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault(); e.stopPropagation();
          wz.images.splice(parseInt(btn.getAttribute('data-wz-rm'), 10), 1);
          renderUploads();
        });
      });
      $$('#wz-upload [data-wz-left]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var i = parseInt(btn.getAttribute('data-wz-left'), 10);
          if (i > 0) { var t = wz.images[i - 1]; wz.images[i - 1] = wz.images[i]; wz.images[i] = t; renderUploads(); }
        });
      });
      $$('#wz-upload [data-wz-right]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var i = parseInt(btn.getAttribute('data-wz-right'), 10);
          if (i < wz.images.length - 1) { var t = wz.images[i + 1]; wz.images[i + 1] = wz.images[i]; wz.images[i] = t; renderUploads(); }
        });
      });
      $$('#wz-upload [data-wz-cover]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var i = parseInt(btn.getAttribute('data-wz-cover'), 10);
          if (i > 0) { var it = wz.images.splice(i, 1)[0]; wz.images.unshift(it); renderUploads(); }
        });
      });
    }

    function readStep() {
      var i = wz.step;
      var root = $('#wizard-root');
      if (!root) return;
      function val(sel) { var el = $(sel, root); return el ? el.value : ''; }
      function checked(sel) { var el = $(sel, root); return el ? !!el.checked : false; }
      if (i === 0) {
        $('[data-spec]', root).forEach(function (inp) { wz.specs[inp.getAttribute('data-spec')] = inp.value.trim(); });
        // Older listings may have stored this as "barcode"; new edits use the
        // canonical "gtin" key so the same identifier is never submitted twice.
        delete wz.specs.barcode;
      } else if (i === 1) {
        // Store every value (including cleared ones) so editing an ad can remove
        // a spec instead of silently keeping the old value.
        $$('[data-spec]', root).forEach(function (inp) {
          var v = inp.value.trim();
          var key = inp.getAttribute('data-spec');
          if (v) wz.specs[key] = v; else delete wz.specs[key];
        });
      } else if (i === 2) {
        // condition handled via click handlers
      } else if (i === 3) {
        wz.price = val('#wz-price').trim();
        wz.negotiable = checked('#wz-neg');
      } else if (i === 4) {
        wz.title = val('#wz-title').trim();
        wz.description = val('#wz-desc').trim();
      } else if (i === 6) {
        wz.province = val('[data-loc="province"]');
        wz.district = val('[data-loc="district"]');
        wz.city = val('[data-loc="city"]');
      } else if (i === 7) {
        wz.contact = { phone: checked('#wz-phone'), whatsapp: checked('#wz-wa'), chat: checked('#wz-chat') };
      }
    }

    function validate() {
      var i = wz.step;
      if (i === 0) {
        if (field('model') && !wz.specs.model) return 'Please enter the model';
      } else if (i === 1) {
        var bad = fields().filter(function (f) { return f.required && f.name !== 'brand' && f.name !== 'model' && f.name !== 'year' && !wz.specs[f.name]; });
        if (bad.length) return 'Please fill in ' + bad[0].label;
      } else if (i === 3) {
        if (!wz.price || parseInt(wz.price, 10) <= 0) return 'Please enter a valid price';
      } else if (i === 4) {
        if (!wz.title) return 'Please add a title';
      } else if (i === 6) {
        if (!wz.province || !wz.district) return 'Please choose a location';
      }
      return null;
    }

    function navHtml() {
      var last = wz.step === WZ_STEPS.length - 1;
      var backLabel = wz.step === 0 ? 'Back' : 'Back';
      var backAction = wz.step === 0 ? (edit ? '#/my-ads' : '#/sell') : null;
      return '<div class="wizard-nav">' +
        '<button class="btn btn-outline" id="wz-back" style="flex:1">' + icon('arrow-back-outline') + esc(backLabel) + '</button>' +
        (last
          ? '<button class="btn btn-primary" id="wz-publish" style="flex:2">' + icon('checkmark-circle-outline') + 'Publish Listing</button>'
          : '<button class="btn btn-primary" id="wz-next" style="flex:2">' + esc('Next') + icon('arrow-forward-outline') + '</button>') +
        '</div>';
    }

    function render() {
      var root = $('#wizard-root');
      root.innerHTML = progressHtml() + '<div class="wizard-body">' + stepBody() + '</div>' + navHtml();
      if (wz.step === 2) {
        $$('#wz-cond .opt').forEach(function (o) {
          o.addEventListener('click', function () {
            $$('#wz-cond .opt').forEach(function (x) { x.classList.remove('active'); });
            o.classList.add('active');
            wz.condition = o.getAttribute('data-cond');
          });
        });
      }
      if (wz.step === 5) renderUploads();
      if (wz.step === 6) bindLocationSelects($('#wizard-root'), { province: wz.province, district: wz.district, city: wz.city });
      if (wz.step === 8) {
        $('#wz-publish').addEventListener('click', function () { submit('active'); });
        // also offer draft save
        var body = $('.wizard-body');
        if (body && !$('#wz-draft')) {
          body.insertAdjacentHTML('beforeend', '<button class="btn btn-outline mt16" id="wz-draft" style="width:100%">' + icon('document-outline') + 'Save as Draft</button>');
          $('#wz-draft').addEventListener('click', function () { submit('draft'); });
        }
      }
      $('#wz-back').addEventListener('click', function () {
        if (wz.step === 0) { location.hash = backAction; return; }
        readStep();
        wz.step--;
        render();
      });
      var next = $('#wz-next');
      if (next) next.addEventListener('click', function () {
        readStep();
        var problem = validate();
        if (problem) return toast(problem, 'error');
        wz.step++;
        render();
        window.scrollTo(0, 0);
      });
    }

    /** Validate every required field, not just the visible step. */
    function validateAll() {
      if (!wz.cat || !wz.cat.sub) return { step: -1, msg: 'Please choose a category' };
      if (field('model') && !(wz.specs.model || '').trim()) return { step: 0, msg: 'Please enter the model' };
      var bad = fields().filter(function (f) { return f.required && !String(wz.specs[f.name] == null ? '' : wz.specs[f.name]).trim(); });
      if (bad.length) return { step: (bad[0].name === 'brand' || bad[0].name === 'model' || bad[0].name === 'year') ? 0 : 1, msg: 'Please fill in ' + bad[0].label };
      if (!wz.condition) return { step: 2, msg: 'Please choose a condition' };
      if (!wz.price || parseInt(wz.price, 10) <= 0) return { step: 3, msg: 'Please enter a valid price' };
      if (!wz.title.trim()) return { step: 4, msg: 'Please add a title' };
      if (!wz.province || !wz.district) return { step: 6, msg: 'Please choose a location' };
      return null;
    }

    function submit(status) {
      if (wz.submitting) return;                 // ignore double clicks / double taps
      readStep();
      var problem = validateAll();
      if (problem) {
        toast(problem.msg, 'error');
        if (problem.step >= 0 && problem.step !== wz.step) { wz.step = problem.step; render(); window.scrollTo(0, 0); }
        return;
      }
      var buttons = [$$('#wizard-root #wz-publish'), $$('#wizard-root #wz-draft')];
      buttons = Array.prototype.concat.apply([], buttons).filter(Boolean);
      function setBusy(on) {
        wz.submitting = on;
        buttons.forEach(function (b) { b.disabled = on; });
        var pub = $('#wz-publish');
        if (pub) pub.innerHTML = on
          ? '<div class="spinner spinner-sm"></div>' + esc(status === 'draft' ? 'Saving…' : 'Publishing…')
          : icon('checkmark-circle-outline') + esc(edit ? 'Save Changes' : 'Publish Listing');
      }
      setBusy(true);

      var files = wz.images.filter(function (it) { return it.file; }).map(function (it) { return it.file; });

      function finish(uploadedUrls) {
        var idx = 0;
        var imgs = wz.images.map(function (it) { return it.file ? uploadedUrls[idx++] : it.url; });
        var payload = {
          category_id: wz.cat.sub.id,
          title: wz.title,
          price: parseInt(wz.price, 10) || 0,
          negotiable: wz.negotiable,
          condition: wz.condition,
          description: wz.description,
          province: wz.province, district: wz.district, city: wz.city || wz.district,
          specs: wz.specs, images: imgs,
          contact_prefs: wz.contact, status: status
        };
        var req = edit ? api.patch('/listings/' + edit.id, payload) : api.post('/listings', payload);
        req.then(function (r) {
          toast(status === 'draft' ? 'Draft saved' : (edit ? 'Listing updated' : 'Listing published!'), 'success');
          setBusy(false);
          location.hash = status === 'draft' ? '#/my-ads' : '#/ads/' + ((r && r.id) || '');
        }).catch(function (er) { toast(er.message, 'error'); setBusy(false); });
      }

      if (files.length) {
        // Client-side 1MB guard (server also enforces 1MB)
        var oversize = files.filter(function (f) { return f.size > 1048576; });
        if (oversize.length) {
          toast('Each photo must be 1MB or smaller — "' + oversize[0].name + '" is too large', 'error');
          setBusy(false);
          return;
        }
        if (wz.images.length > 3) {
          toast('Maximum is 3 photos per listing', 'error');
          setBusy(false);
          return;
        }
        var fd = new FormData();
        files.forEach(function (f) { fd.append('files', f); });
        api.form('/upload', fd)
          .then(function (d) {
            finish(((d && d.items) || []).map(function (x) { return x.key || x.url; }));
          })
          .catch(function (er) { toast(er.message, 'error'); setBusy(false); });
      } else finish([]);
    }

    return {
      get html() {
        return header(edit ? 'Edit Listing' : 'Post an Ad', {}) + '<div id="wizard-root"></div>';
      },
      mount: function () { render(); },
      hideTabbar: true,
      render: render
    };
  }

  views.sellForm = function (params) {
    if (!requireAuth()) return { html: '' };
    // Categories must be resolved before the wizard can be built. Previously a
    // missing/failed /meta made findSub() return null and the router silently
    // bounced back to #/sell, so the wizard never appeared.
    var html = header('Post an Ad', {}) + '<div id="wizard-root">' + loadingHtml('Preparing your ad…') + '</div>';
    return {
      html: html,
      hideTabbar: true,
      mount: function () {
        ensureMeta().then(function () {
          var root = $('#wizard-root');
          if (!root) return;
          var found = findSub(params.slug);
          if (!found) {
            root.innerHTML = errorHtml('No category matches "' + (params.slug || '') + '". Pick one from the list.', 'Choose a category', 'alert-circle-outline');
            var pick = root.querySelector('[data-state-retry]');
            if (pick) pick.addEventListener('click', function () { location.hash = '#/sell'; });
            return;
          }
          listingWizard({ cat: found }).render();
        }).catch(function (e) {
          var root = $('#wizard-root');
          if (!root) return;
          root.innerHTML = errorHtml((e && e.message) || 'Could not load the category list.', 'Try again', 'cloud-offline-outline');
          var btn = root.querySelector('[data-state-retry]');
          if (btn) btn.addEventListener('click', function () { render(); });
        });
      }
    };
  };

  function listingWizardView(wz) {
    return { html: wz.html, mount: wz.mount, hideTabbar: true };
  }

  views.editAd = function (params) {
    if (!requireAuth()) return { html: '' };
    return {
      html: '<div class="spinner" style="margin-top:80px"></div>',
      hideTabbar: true,
      mount: function () {
        api.get('/listings/' + params.id).then(function (l) {
          if (l.seller && l.seller.id !== state.user.id && !state.user.is_admin) {
            $('#page').innerHTML = header('Edit Listing', {}) + '<div class="empty"><div class="e-icon">' + icon('alert-circle-outline') + '</div><h3>Not allowed</h3><p>You can only edit your own listings.</p></div>';
            return;
          }
          var cat = findSubById(l.category_id);
          if (!cat) {
            $('#page').innerHTML = header('Edit Listing', {}) + '<div class="empty"><p>Unknown category.</p></div>';
            return;
          }
          var wz = listingWizard({ cat: cat, edit: l });
          $('#page').innerHTML = wz.html;
          document.getElementById('app').classList.toggle('hide-tabbar', true);
          wz.mount();
        }).catch(function (e) {
          $('#page').innerHTML = header('Edit Listing', {}) + '<div class="empty"><p>' + esc(e.message) + '</p></div>';
        });
      }
    };
  };

  views.myAds = function () {
    if (!requireAuth()) return { html: '' };
    var html = header('My Ads', { right: '<a class="icon-btn" data-nav="#/analytics" aria-label="Analytics">' + icon('bar-chart-outline') + '</a>' });
    html += '<div class="subcats" style="padding-top:12px" id="myads-tabs">' +
      ['All', 'Active', 'Pending', 'Draft', 'Sold', 'Expired', 'Paused', 'Rejected'].map(function (s, i) {
        return '<a class="chip' + (i === 0 ? ' active' : '') + '" data-adtab="' + s.toLowerCase() + '">' + s + '</a>';
      }).join('') + '</div>';
    html += '<div class="stat-strip"><div class="stat-box"><b id="st-active">–</b><span>Active</span></div>' +
      '<div class="stat-box"><b id="st-views">–</b><span>Total views</span></div>' +
      '<div class="stat-box"><b id="st-favs">–</b><span>Favorites</span></div></div>';
    html += '<div id="myads-list"><div class="spinner"></div></div>';
    return {
      html: html,
      mount: function () {
        var tab = 'all';
        function load() {
          api.get('/me/listings').then(function (items) {
            var active = items.filter(function (x) { return x.status === 'active'; });
            var views = items.reduce(function (a, b) { return a + (b.views || 0); }, 0);
            var a = $('#st-active'), v = $('#st-views');
            if (a) a.textContent = active.length;
            if (v) v.textContent = views;
            api.get('/me/analytics').then(function (an) { var f = $('#st-favs'); if (f) f.textContent = an.summary.favorites; })
              .catch(function () { var f = $('#st-favs'); if (f) f.textContent = '–'; });

            var shown = tab === 'all' ? items : items.filter(function (x) { return x.status === tab; });
            var el = $('#myads-list');
            if (!shown.length) {
              el.innerHTML = '<div class="empty"><div class="e-icon">' + icon('duplicate-outline') + '</div><h3>' +
                (items.length ? 'No ' + tab + ' listings' : 'No listings yet') + '</h3>' +
                (items.length ? '' : '<p>Post your first camera or lens in minutes.</p><a class="btn btn-primary btn-sm" data-nav="#/sell" style="margin-top:12px">Sell an item</a>') + '</div>';
              return;
            }
            el.innerHTML = shown.map(adRow).join('');
            bindAdActions(el);
          }).catch(function (e) { $('#myads-list').innerHTML = '<div class="empty"><p>' + esc(e.message) + '</p></div>'; });
        }
        load();
        $$('#myads-tabs [data-adtab]').forEach(function (t) {
          t.addEventListener('click', function () {
            $$('#myads-tabs [data-adtab]').forEach(function (x) { x.classList.remove('active'); });
            t.classList.add('active');
            tab = t.getAttribute('data-adtab');
            load();
          });
        });
      }
    };
  };

  function adRow(l) {
    var expiring = l.status === 'active' && l.expiry_at && (l.expiry_at - Math.floor(Date.now() / 1000)) < 3 * 86400;
    var expiryLine = l.expiry_at ? (l.status === 'active'
      ? 'Expires ' + fmtDate(l.expiry_at) : 'Expired ' + fmtDate(l.expiry_at)) : '';
    var rejectLine = l.status === 'rejected' && l.rejection_reason
      ? '<span class="status-chip" style="color:#C62828;background:#FDE8E8">' + icon('alert-circle-outline') + ' ' + esc(l.rejection_reason) + '</span>' : '';
    return '<div class="ad-row">' +
      '<div class="ad-thumb">' + (l.images && l.images[0] ? '<img src="' + esc(l.images[0]) + '" alt="' + esc(l.title || 'Listing') + '">' : icon('camera-outline')) + '</div>' +
      '<div class="ad-main">' +
      '<div class="ad-title" data-nav="#/ads/' + l.id + '">' + esc(l.title) + '</div>' +
      '<div class="ad-sub">' + fmtLKR(l.price) + (l.negotiable ? ' · negotiable' : '') + ' · ' + l.views + ' views</div>' +
      '<div class="ad-meta">' + statusChip(l.status) +
      (l.urgent ? '<span class="status-chip" style="color:#C62828;background:#FDE8E8">' + icon('flame-outline') + ' Urgent</span>' : '') +
      (expiring ? '<span class="status-chip" style="color:#C77D23;background:#C77D231a">Expiring soon</span>' : '') +
      (expiryLine ? '<span class="muted fs12">' + esc(expiryLine) + '</span>' : '') + '</div>' +
      (rejectLine ? '<div class="ad-meta" style="margin-top:4px">' + rejectLine + '</div>' : '') +
      '</div>' +
      '<div class="ad-actions">' +
      '<button class="btn btn-outline btn-sm" data-ad-act="edit" data-id="' + l.id + '">' + icon('create-outline') + 'Edit</button>' +
      (l.status === 'active'
        ? '<button class="btn btn-outline btn-sm" data-ad-act="pause" data-id="' + l.id + '">' + icon('pause-outline') + 'Pause</button>' +
          '<button class="btn btn-outline btn-sm" data-ad-act="sold" data-id="' + l.id + '">' + icon('checkmark-circle-outline') + 'Sold</button>'
        : '') +
      (l.status === 'paused'
        ? '<button class="btn btn-primary btn-sm" data-ad-act="resume" data-id="' + l.id + '">' + icon('play-outline') + 'Resume</button>' : '') +
      (l.status === 'expired' || (l.status === 'active' && expiring)
        ? '<button class="btn btn-outline btn-sm" data-ad-act="renew" data-id="' + l.id + '">' + icon('refresh-outline') + 'Renew</button>' : '') +
      (l.status === 'draft'
        ? '<button class="btn btn-primary btn-sm" data-ad-act="publish" data-id="' + l.id + '">' + icon('checkmark-circle-outline') + 'Publish</button>' : '') +
      (l.status === 'rejected'
        ? '<button class="btn btn-primary btn-sm" data-ad-act="resubmit" data-id="' + l.id + '">' + icon('refresh-outline') + 'Resubmit</button>' : '') +
      (l.status === 'active' && !l.featured
        ? '<button class="btn btn-accent btn-sm" data-ad-act="promote" data-id="' + l.id + '">' + icon('flash-outline') + 'Promote</button>' : '') +
      '<button class="btn btn-danger btn-sm" data-ad-act="delete" data-id="' + l.id + '">' + icon('trash-outline') + '</button>' +
      '</div></div>';
  }

  function bindAdActions(root) {
    $$('[data-ad-act]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-id');
        // Named `adAct` (not `act`): a local named `act` used to shadow the
        // global act() promise helper, so the delete/renew calls below threw
        // `TypeError: act is not a function` after the request had already
        // been sent — the listing was deleted/renewed server-side but the UI
        // never confirmed or re-rendered.
        var adAct = b.getAttribute('data-ad-act');
        if (adAct === 'edit') { location.hash = '#/edit-ad/' + id; return; }
        if (adAct === 'delete') {
          openDialog('Delete listing', '<p>This will permanently remove your listing. This cannot be undone.</p>', 'Delete', true, function () {
            act(api.del('/listings/' + id), 'Listing deleted', function () { closeDialog(); views.myAdsRemount(); });
          });
          return;
        }
        var statusMap = { pause: 'paused', resume: 'active', sold: 'sold', publish: 'active', resubmit: 'pending' };
        if (statusMap[adAct]) {
          api.patch('/listings/' + id, { status: statusMap[adAct] }).then(function () {
            toast(adAct === 'sold' ? 'Listing marked as sold' : (adAct === 'resubmit' ? 'Listing resubmitted for review' : 'Listing ' + adAct + 'd'), 'success');
            views.myAdsRemount();
          }).catch(function (e) { toast(e.message, 'error'); });
          return;
        }
        if (adAct === 'renew') {
          act(api.post('/listings/' + id + '/renew'), 'Listing renewed', function () { views.myAdsRemount(); });
          return;
        }
        if (adAct === 'promote') {
          openPromoteSheet(id);
          return;
        }
      });
    });
  }
  views.myAdsRemount = function () { var v = views.myAds(); if (v.mount) v.mount(); };

  function openPromoteSheet(id) {
    api.get('/promotions').then(function (pkgs) {
      if (!pkgs || !pkgs.length) return toast('Promotions are not available yet', 'error');
      openSheet('Promote this listing', pkgs.map(function (p) {
        var ic = { featured: 'flash-outline', boost: 'trending-up-outline', homepage: 'home-outline', urgent: 'flame-outline' }[p.type] || 'flash-outline';
        return {
          icon: ic,
          label: p.name + ' — ' + fmtLKR(p.price) + ' · ' + p.duration_days + ' days',
          onClick: function () {
            api.post('/promotions/purchase', { listing_id: id, type: p.type }).then(function (r) {
              toast('Payment request created: ' + r.transaction_id, 'success');
              views.myAdsRemount();
            }).catch(function (e) { toast(e.message, 'error'); });
          }
        };
      }));
    }).catch(function (e) { toast(e.message, 'error'); });
  }

  views.favorites = function () {
    if (!requireAuth()) return { html: '' };
    var html = header('Favorites', { right: '<button class="icon-btn" data-nav="#/search">' + icon('search-outline') + '</button>' });
    html += '<div class="section"><div class="section-head"><h2>' + icon('heart-outline') + 'Saved Listings</h2></div></div>';
    html += '<div id="fav-list">' + loadingHtml('Loading your favourites…') + '</div>';
    return {
      html: html,
      mount: function () {
        renderAsync({
          into: '#fav-list',
          load: function () { return api.get('/favorites'); },
          isEmpty: function (items) { return !items || !items.length; },
          emptyHtml: '<div class="empty"><div class="e-icon">' + icon('heart-outline') + '</div><h3>No favorites yet</h3>' +
            '<p>Tap the heart on any listing to save it here.</p>' +
            '<a class="btn btn-primary btn-sm" data-nav="#/browse" style="margin-top:12px">Browse listings</a></div>',
          retryLabel: 'Reload favourites',
          render: function (items) { return listingGrid(items); }
        });
      }
    };
  };

  views.chat = function () {
    if (!requireAuth()) return { html: '' };
    var html = header('Messages', {});
    html += '<div id="conv-list"><div class="spinner"></div></div>';
    return {
      html: html,
      mount: function () {
        api.get('/chat/conversations').then(function (rows) {
          var el = $('#conv-list');
          if (!rows.length) {
            el.innerHTML = '<div class="empty"><div class="e-icon">' + icon('chatbubble-ellipses-outline') + '</div><h3>No conversations</h3><p>Contact a seller from any listing to start chatting.</p></div>';
            return;
          }
          el.innerHTML = rows.map(function (r) {
            var mine = r.last_sender === state.user.id;
            return '<div class="chat-list-item" data-nav="#/chat/' + r.other_id + '">' +
              avatarHtml({ name: r.other_name, avatar: r.other_avatar }, 'lg') +
              '<div class="meta"><b>' + esc(r.other_name) + '</b>' +
              '<p>' + (mine ? 'You: ' : '') + (r.listing_title ? 'Re: ' + esc(r.listing_title) : esc(r.last_body)) + '</p></div>' +
              '<div class="c-right">' +
              (r.unread ? '<span class="unread">' + r.unread + '</span>' : '') +
              '<div class="time">' + timeAgo(r.last_at || r.created_at) + '</div></div></div>';
          }).join('');
        }).catch(function (e) { $('#conv-list').innerHTML = '<div class="empty"><p>' + esc(e.message) + '</p></div>'; });
      }
    };
  };

  views.chatThread = function (params) {
    if (!requireAuth()) return { html: '' };
    var otherId = params.id;
    var listingId = (params.q && params.q.get('listing')) || '';
    var html = header('Chat', { right: '<button class="icon-btn" id="thr-more" aria-label="More">' + icon('ellipsis-horizontal-outline') + '</button>' });
    html += '<div id="thr-head"></div>';
    html += '<div class="chat-thread" id="thread"></div>';
    html += '<div class="chat-input"><input id="msg-input" placeholder="Type a message…"><button class="send" id="msg-send">' + icon('send-outline') + '</button></div>';
    return {
      html: html,
      hideTabbar: true,
      mount: function () {
        var threadEl = $('#thread');
        var blockedBy = false;
        var loadedOnce = false;
        if (threadEl) threadEl.innerHTML = loadingHtml('Loading conversation…');
        function load() {
          api.get('/chat/' + otherId).then(function (d) {
            loadedOnce = true;
            blockedBy = d.blocked_by;
            var u = state.user;
            var h = (d.messages || []).map(function (m) {
              var mine = m.sender_id === u.id;
              return '<div class="bubble ' + (mine ? 'me' : 'other') + '">' + esc(m.body) + '<span class="t">' + timeAgo(m.created_at) + '</span></div>';
            }).join('');
            threadEl.innerHTML = h || '<div class="empty"><p>Say hello to start the conversation.</p></div>';
            var head = $('#thr-head');
            var hh = '';
            if (d.listing) {
              hh += '<div class="thr-listing" data-nav="#/ads/' + d.listing.id + '">' +
                (d.listing.image ? '<img src="' + esc(d.listing.image) + '" alt="' + esc(d.listing.title || 'Listing') + '">' : '<span class="ph">' + icon('camera-outline') + '</span>') +
                '<div class="tl-main"><b>' + esc(d.listing.title) + '</b><span>' + fmtLKR(d.listing.price) + '</span></div>' +
                icon('chevron-forward-outline') + '</div>';
            }
            if (d.blocked_by) hh += '<div class="thr-notice">' + icon('ban-outline') + 'This user has blocked messaging.</div>';
            else if (d.blocked) hh += '<div class="thr-notice">' + icon('ban-outline') + 'You blocked this user. <a id="thr-unblock">Unblock</a></div>';
            head.innerHTML = hh;
            var ub = $('#thr-unblock');
            if (ub) ub.addEventListener('click', function () { act(api.del('/chat/' + otherId + '/block'), 'User unblocked', function () { load(); }); });
            var inp = $('#msg-input'), btn = $('#msg-send');
            if (inp) inp.disabled = blockedBy;
            if (btn) btn.disabled = blockedBy;
            window.scrollTo(0, document.body.scrollHeight);
          }).catch(function (e) {
            // First load failed: show a retryable error. A failed background
            // poll must not wipe a conversation the user is reading.
            if (!loadedOnce) {
              if (threadEl) {
                threadEl.innerHTML = errorHtml((e && e.message) || 'Could not load this conversation.', 'Reload conversation', 'chatbubble-ellipses-outline');
                var btn = threadEl.querySelector('[data-state-retry]');
                if (btn) btn.addEventListener('click', function () { load(); });
              }
            } else {
              logNonCritical('chat refresh')(e);
            }
          });
        }
        load();
        function send() {
          var inp = $('#msg-input'); var t = inp.value.trim();
          if (!t || blockedBy) return;
          var payload = { body: t };
          if (listingId) payload.listing_id = parseInt(listingId, 10);
          api.post('/chat/' + otherId, payload).then(function () { inp.value = ''; listingId = ''; load(); })
            .catch(function (e) { toast(e.message, 'error'); });
        }
        $('#msg-send').addEventListener('click', send);
        $('#msg-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });
        $('#thr-more').addEventListener('click', function () {
          openSheet(null, [
            { icon: 'ban-outline', label: 'Block user', onClick: function () {
              openDialog('Block user', '<p>They won’t be able to message you anymore.</p>', 'Block', true, function () {
                act(api.post('/chat/' + otherId + '/block'), null, function () { closeDialog(); load(); });
              });
            } },
            { icon: 'flag-outline', label: 'Report user', danger: true, onClick: function () {
              var reasons = (state.meta && state.meta.report_reasons) || ['Scam', 'Fake product', 'Wrong information', 'Other'];
              openSheet('Report user', reasons.map(function (r) {
                return { icon: 'flag-outline', label: r, danger: true, onClick: function () {
                  act(api.post('/chat/' + otherId + '/report', { reason: r }), 'Reported — thanks');
                } };
              }));
            } }
          ]);
        });
        addPoller(function () {
          // Only refresh while the thread is still the visible view.
          if (threadEl && document.body.contains(threadEl)) load();
        }, 6000);
      }
    };
  };

  views.notifications = function () {
    if (!requireAuth()) return { html: '' };
    var html = header('Notifications', { right: '<button class="icon-btn" id="mark-read">' + icon('checkmark-done-outline') + '</button>' });
    html += '<div id="notif-list"><div class="spinner"></div></div>';
    return {
      html: html,
      mount: function () {
        renderAsync({
          into: '#notif-list',
          load: function () { return api.get('/notifications'); },
          isEmpty: function (d) { return !d || !(d.items || []).length; },
          emptyHtml: '<div class="empty"><div class="e-icon">' + icon('notifications-outline') + '</div><h3>No notifications</h3><p>Offers, messages and listing updates show up here.</p></div>',
          retryLabel: 'Reload notifications',
          render: function (d) { return d.items.map(function (n) {
            var colors = { offer: '#C77D23', message: '#3A6FB0', listing: '#0E7C66', favorite: '#E5484D', promotion: '#F0A500', expiring: '#B04A3A', rating: '#9C4F96', info: '#74817C' };
            var ic = { offer: 'cash-outline', message: 'chatbubble-ellipses-outline', listing: 'camera-outline', favorite: 'heart-outline', promotion: 'flash-outline', expiring: 'hourglass-outline', rating: 'star-outline', info: 'notifications-outline' };
            return '<div class="notif-item' + (n.read ? '' : ' unread') + '"' + (n.link ? ' data-nav="' + esc(n.link) + '"' : '') + '>' +
              '<span class="ni-icon" style="background:' + (colors[n.type] || '#74817C') + '1a;color:' + (colors[n.type] || '#74817C') + '">' + icon(ic[n.type] || 'notifications-outline') + '</span>' +
              '<div class="ni-main"><b>' + esc(n.title) + '</b><p>' + esc(n.body) + '</p></div>' +
              '<span class="ni-time">' + timeAgo(n.created_at) + '</span></div>';
          }).join(''); }
        });
        var mr = $('#mark-read');
        if (mr) mr.addEventListener('click', function () {
          act(api.post('/notifications/read'), null, function () {
            $$('.notif-item').forEach(function (x) { x.classList.remove('unread'); });
          });
        });
      }
    };
  };

  views.profile = function () {
    if (!requireAuth()) {
      return authPrompt('Profile', 'Sign in to manage your listings, favorites and messages.');
    }
    var u = state.user;
    var html = '<div class="hero-page" style="padding-bottom:24px"><div class="flex aic" style="gap:14px">' +
      avatarHtml(u, 'lg') + '<div><h1>' + esc(u.name) + '</h1>' +
      '<p>' + (u.verified ? '<span class="vbadge" style="background:rgba(255,255,255,.2);color:#fff">' + icon('shield-checkmark') + ' Verified seller</span> ' : '') + esc(u.city || 'Sri Lanka') + '</p></div></div>' +
      '<div style="margin-top:16px" class="flex gap8">' +
      '<a class="btn btn-accent btn-sm" data-nav="#/settings">' + icon('create-outline') + 'Edit profile</a>' +
      '<a class="btn btn-outline btn-sm" style="background:rgba(255,255,255,.12);color:#fff;border-color:rgba(255,255,255,.3)" data-nav="#/my-ads">' + icon('duplicate-outline') + 'My ads</a></div></div>';
    html += '<div class="stat-strip" style="padding:14px 16px"><div class="stat-box"><b id="p-l">–</b><span>Listings</span></div>' +
      '<div class="stat-box"><b id="p-f">–</b><span>Favorites</span></div>' +
      '<div class="stat-box"><b id="p-r">–</b><span>Offers</span></div></div>';
    if (u.is_admin) {
      html += '<div class="divider-label">Administration</div>';
      html += menuRow('speedometer-outline', '#5B6BB0', 'Admin Panel', 'Manage users, listings & settings', '#/admin');
    }
    html += '<div class="divider-label">Account</div>';
    html += menuRow('duplicate-outline', '#0E7C66', 'My Ads', 'Manage your listings', '#/my-ads');
    html += menuRow('heart-outline', '#E5484D', 'Favorites', 'Saved listings', '#/favorites');
    html += menuRow('chatbubble-ellipses-outline', '#3A6FB0', 'Messages', 'Chat with buyers and sellers', '#/chat');
    html += menuRow('cash-outline', '#C77D23', 'My Offers', 'Offers made and received', '#/my-offers');
    html += menuRow('bar-chart-outline', '#0E7C66', 'Analytics', 'Views, calls & offers', '#/analytics');
    if (u.seller_type === 'business') html += menuRow('briefcase-outline', '#3A6FB0', 'My Shop', 'Business page & hours', '#/my-shop');
    html += menuRow('notifications-outline', '#9C4F96', 'Notifications', 'Updates on your activity', '#/notifications');
    html += '<div class="divider-label">Explore</div>';
    html += menuRow('cart-outline', '#0E7C66', 'Camera Shops', 'Dealers across Sri Lanka', '#/shops');
    html += menuRow('reader-outline', '#3A6FB0', 'Buying Guides', 'Tips & advice', '#/blog');
    html += menuRow('shield-checkmark', '#0E7C66', 'Safety', 'Buy and sell safely', '#/safety');
    html += menuRow('settings-outline', '#74817C', 'Settings', 'Profile & password', '#/settings');
    html += menuRow('log-out-outline', '#E5484D', 'Sign Out', '', '#/sign-out', true);
    return {
      html: html,
      mount: function () {
        function setCount(sel, v) { var el = $(sel); if (el) el.textContent = v; }
        setCount('#p-l', '…'); setCount('#p-f', '…'); setCount('#p-r', '…');
        api.get('/me').then(function (d) {
          var c = (d && d.counts) || {};
          setCount('#p-l', c.listings == null ? '—' : c.listings);
          setCount('#p-f', c.favorites == null ? '—' : c.favorites);
        }).catch(function (e) {
          logNonCritical('profile counts')(e);
          setCount('#p-l', '—'); setCount('#p-f', '—');
        });
        api.get('/me/offers').then(function (d) {
          setCount('#p-r', ((d && d.received) || []).length + ((d && d.sent) || []).length);
        }).catch(function (e) {
          logNonCritical('offer counts')(e);
          setCount('#p-r', '—');
        });
      }
    };
  };

  function menuRow(ic, color, title, sub, link, danger) {
    return '<div class="row-item" data-nav="' + link + '"><span class="ri-icon" style="background:' + color + '1a;color:' + color + '">' + icon(ic) + '</span>' +
      '<div class="ri-main"><b style="' + (danger ? 'color:var(--danger)' : '') + '">' + esc(title) + '</b><span>' + esc(sub) + '</span></div>' +
      '<span class="chev">' + icon('chevron-forward-outline') + '</span></div>';
  }

  function authPrompt(title, msg) {
    return {
      html: header(title, {}) + '<div class="empty" style="padding-top:70px"><div class="e-icon">' + icon('person-outline') + '</div>' +
        '<h3>' + esc(title) + '</h3><p>' + esc(msg) + '</p>' +
        '<a class="btn btn-primary" style="max-width:240px;margin:14px auto 0" data-nav="#/sign-in">Sign In</a>' +
        '<a class="btn btn-outline" style="max-width:240px;margin:10px auto 0" data-nav="#/sign-up">Create Account</a></div>',
      mount: function () {}
    };
  }

  views.seller = function (params) {
    var html = '<div id="seller-root"><div class="spinner" style="margin-top:80px"></div></div>';
    return {
      html: html,
      mount: function () {
        api.get('/seller/' + params.id).then(function (d) {
          var s = d.seller;
          var isSelf = state.user && state.user.id === s.id;
          var ratingLine = d.rating && d.rating.count ? starsHtml(d.rating.avg, d.rating.count) : '<span class="muted fs12">No ratings yet</span>';
          var bizChip = d.business ? '<a class="biz-link" style="margin-top:12px" data-nav="#/shop/' + esc(d.business.slug) + '">' + icon('briefcase-outline') + ' Visit shop: ' + esc(d.business.name) + icon('chevron-forward-outline') + '</a>' : '';
          $('#seller-root').innerHTML = header(s.name, { heading: false }) +
            '<div class="hero-page" style="text-align:center"><div style="display:flex;justify-content:center;margin-bottom:10px">' + avatarHtml(s, 'lg') + '</div>' +
            '<h1>' + esc(s.name) + '</h1>' +
            '<p>' + (s.verified ? icon('shield-checkmark') + ' Verified seller · ' : '') +
            (s.seller_type === 'business' ? icon('briefcase-outline') + ' Business · ' : '') +
            esc([s.city, s.province].filter(Boolean).join(', ') || 'Sri Lanka') + '</p>' +
            '<p style="margin-top:6px">' + ratingLine + '</p>' +
            (s.bio ? '<p style="margin-top:8px;max-width:420px;margin-left:auto;margin-right:auto">' + esc(s.bio) + '</p>' : '') +
            '<div class="flex gap8" style="justify-content:center;margin-top:14px">' +
            '<button class="btn btn-wa btn-sm" data-wa-user="' + esc(s.phone) + '">' + icon('logo-whatsapp') + 'WhatsApp</button>' +
            '<button class="btn btn-outline btn-sm" data-nav="#/chat/' + s.id + '">' + icon('chatbubble-ellipses-outline') + 'Chat</button>' +
            (!isSelf ? '<button class="btn btn-accent btn-sm" id="rate-btn">' + icon('star-outline') + 'Rate</button>' : '') +
            '</div>' + bizChip + '</div>' +
            '<div class="section"><div class="section-head"><h2>' + icon('camera-outline') + 'Listings (' + (d.listings || []).length + ')</h2></div></div>' +
            '<div>' + listingGrid(d.listings) + '</div>' +
            ((d.ratings && d.ratings.length)
              ? '<div class="section"><div class="section-head"><h2>' + icon('star-outline') + 'Reviews (' + d.ratings.length + ')</h2></div></div>' +
                d.ratings.slice(0, 8).map(function (r) {
                  return '<div class="row-item"><span class="ri-icon" style="background:#FDF1D8;color:#C77D23">' + icon('star') + '</span>' +
                    '<div class="ri-main"><b>' + esc(r.buyer_name) + ' · ' + r.stars + '/5</b><span>' + esc(r.comment || '') + '</span></div>' +
                    '<span class="muted fs12">' + timeAgo(r.created_at) + '</span></div>';
                }).join('')
              : '') + '<div style="height:16px"></div>';
          var rb = $('#rate-btn');
          if (rb) rb.addEventListener('click', function () {
            if (!requireAuth()) return;
            openDialog('Rate this seller', '<div class="form-group"><label>Stars</label><div class="seg" id="rate-seg">' +
              [1, 2, 3, 4, 5].map(function (n) { return '<div class="opt' + (n === 5 ? ' active' : '') + '" data-star="' + n + '">' + n + '</div>'; }).join('') + '</div></div>' +
              '<div class="form-group"><label>Comment (optional)</label><textarea class="textarea" id="rate-comment" style="min-height:60px"></textarea></div>',
              'Submit rating', false, function () {
                var star = 5;
                $$('#rate-seg .opt').forEach(function (o) { if (o.classList.contains('active')) star = parseInt(o.getAttribute('data-star'), 10); });
                api.post('/seller/' + s.id + '/rate', { stars: star, comment: $('#rate-comment').value }).then(function () {
                  closeDialog(); toast('Thanks for rating!', 'success'); views.sellerRemount(params);
                }).catch(function (e) { toast(e.message, 'error'); });
              });
            $$('#rate-seg .opt').forEach(function (o) {
              o.addEventListener('click', function () {
                $$('#rate-seg .opt').forEach(function (x) { x.classList.remove('active'); });
                o.classList.add('active');
              });
            });
          });
        }).catch(function (e) {
          $('#seller-root').innerHTML = header('Seller', {}) + '<div class="empty"><p>' + esc(e.message) + '</p></div>';
        });
      }
    };
  };
  views.sellerRemount = function (params) {
    var root = $('#seller-root');
    if (!root) return;
    views.seller(params).mount();
  };

  views.myOffers = function () {
    if (!requireAuth()) return { html: '' };
    var html = header('My Offers', {});
    html += '<div id="offers-root"><div class="spinner"></div></div>';
    return {
      html: html,
      mount: function () {
        api.get('/me/offers').then(function (d) {
          var received = d.received || [], sent = d.sent || [];
          var h = '<div class="divider-label">Received (' + received.length + ')</div>';
          h += received.map(function (o) {
            return offerRow(o, true);
          }).join('') || '<div class="empty" style="padding:20px"><p>No offers received yet.</p></div>';
          h += '<div class="divider-label">Sent (' + sent.length + ')</div>';
          h += sent.map(function (o) { return offerRow(o, false); }).join('') || '<div class="empty" style="padding:20px"><p>No offers sent yet.</p></div>';
          $('#offers-root').innerHTML = h;
          $$('#offers-root [data-accept]').forEach(function (b) {
            b.addEventListener('click', function () {
              act(api.post('/offers/' + b.getAttribute('data-accept'), { action: 'accept' }), 'Offer accepted', function () { views.myOffersRemount(); });
            });
          });
          $$('#offers-root [data-decline]').forEach(function (b) {
            b.addEventListener('click', function () {
              act(api.post('/offers/' + b.getAttribute('data-decline'), { action: 'decline' }), 'Offer declined', function () { views.myOffersRemount(); });
            });
          });
          $$('#offers-root [data-counter]').forEach(function (b) {
            b.addEventListener('click', function () {
              var id = b.getAttribute('data-counter');
              openDialog('Counter offer', '<div class="form-group"><label>Your counter (LKR)</label><input class="input" id="counter-amt" inputmode="numeric" placeholder="e.g. 275000"></div>',
                'Send counter', false, function () {
                  var amt = parseInt($('#counter-amt').value, 10);
                  if (!amt || amt <= 0) return toast('Enter a valid amount', 'error');
                  api.post('/offers/' + id, { action: 'counter', amount: amt }).then(function () { closeDialog(); toast('Counter sent', 'success'); views.myOffersRemount(); })
                    .catch(function (e) { toast(e.message, 'error'); });
                });
            });
          });
        });
      }
    };
  };
  views.myOffersRemount = function () { var v = views.myOffers(); if (v.mount) v.mount(); };
  function offerRow(o, received) {
    var statusColor = { pending: '#C77D23', accepted: '#0E7C66', declined: '#E5484D', countered: '#9C4F96' };
    var sub = (received ? 'From ' + esc(o.buyer_name) : 'To ' + esc(o.seller_name)) + ' · ' +
      '<b style="color:' + (statusColor[o.status] || '#74817C') + '">' + esc(o.status) + '</b>';
    if (o.status === 'countered' && o.counter_amount) sub += ' · counter: ' + fmtLKR(o.counter_amount);
    if (o.message) sub += ' · "' + esc(o.message) + '"';
    var actions = '';
    if (received && o.status === 'pending') {
      actions = '<button class="btn btn-primary btn-sm" data-accept="' + o.id + '">Accept</button>' +
        '<button class="btn btn-outline btn-sm" data-decline="' + o.id + '">Decline</button>' +
        '<button class="btn btn-outline btn-sm" data-counter="' + o.id + '">Counter</button>';
    } else if (!received && o.status === 'countered') {
      actions = '<button class="btn btn-primary btn-sm" data-accept="' + o.id + '">Accept</button>' +
        '<button class="btn btn-outline btn-sm" data-decline="' + o.id + '">Decline</button>';
    }
    return '<div class="row-item">' +
      '<span class="ri-icon" style="background:#f1f4f3;color:#0E7C66">' + icon('cash-outline') + '</span>' +
      '<div class="ri-main" data-nav="#/ads/' + o.listing_id + '"><b>' + fmtLKR(o.amount) + ' — ' + esc(o.listing_title || '') + '</b>' +
      '<span>' + sub + '</span></div>' +
      (actions ? '<div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end;max-width:170px">' + actions + '</div>' : '') +
      '</div>';
  }

  views.settings = function () {
    if (!requireAuth()) return { html: '' };
    var u = state.user;
    var html = header('Settings', {});
    html += '<div class="detail-wrap">' +
      '<div class="form-card" style="display:flex;align-items:center;gap:14px;margin-bottom:16px">' +
      avatarHtml(u, 'lg') +
      '<div><div class="fs13 fw7">Profile photo</div><div class="form-hint">JPG, PNG or WEBP</div></div>' +
      '<label class="btn btn-outline btn-sm" style="margin-left:auto;width:auto">Upload' +
      '<input type="file" id="avatar-input" accept="image/*" hidden></label></div>' +

      '<form id="settings-form"><div class="form-card">' +
      '<div class="section-head" style="margin-bottom:4px"><h2>' + icon('person-outline') + 'Profile</h2></div>' +
      '<div class="form-group"><label>Full name</label><input class="input" name="name" value="' + esc(u.name) + '"></div>' +
      '<div class="form-group"><label>Email</label><input class="input" value="' + esc(u.email) + '" disabled>' +
      (u.email_verified ? '<div class="form-hint" style="color:var(--brand)">' + icon('checkmark-circle-outline') + ' Verified</div>'
        : '<a class="form-hint" id="resend-verify" style="color:var(--brand);font-weight:700">Verify your email →</a>') + '</div>' +
      '<div class="form-group"><label>Phone</label><input class="input" name="phone" value="' + esc(u.phone) + '" placeholder="+94 77 123 4567">' +
      (u.phone_verified ? '<div class="form-hint" style="color:var(--brand)">' + icon('checkmark-circle-outline') + ' Verified</div>'
        : '<a class="form-hint" id="verify-phone" style="color:var(--brand);font-weight:700">Verify phone number →</a>') + '</div>' +
      '<div class="form-group"><label>WhatsApp number</label><input class="input" name="whatsapp" value="' + esc(u.whatsapp) + '" placeholder="+94 77 123 4567"></div>' +
      locationSelectsHtml() +
      '<div class="form-group"><label>About you</label><textarea class="textarea" name="bio" style="min-height:80px">' + esc(u.bio) + '</textarea></div>' +
      '<div class="form-group"><label>Account type</label><div class="seg" id="stype-seg">' +
      '<div class="opt' + (u.seller_type !== 'business' ? ' active' : '') + '" data-stype="individual">Individual</div>' +
      '<div class="opt' + (u.seller_type === 'business' ? ' active' : '') + '" data-stype="business">Business</div></div>' +
      '<p class="form-hint" style="margin-top:6px">Individuals buy and sell personal gear with no extra steps. Business accounts are for shops — the shop still needs admin verification before it gets the verified badge.</p></div>' +
      '<button class="btn btn-primary" type="submit">' + icon('checkmark-outline') + 'Save Changes</button></div></form>' +

      (u.seller_type === 'business' ? '<div class="form-card" style="margin-top:16px">' +
      '<div class="section-head" style="margin-bottom:4px"><h2>' + icon('briefcase-outline') + 'Business shop</h2></div>' +
      '<p class="form-hint" style="margin-bottom:10px">Manage your shop details, location, opening hours and verification request.</p>' +
      '<a class="btn btn-outline" data-nav="#/my-shop">' + icon('create-outline') + 'Manage my shop</a></div>' : '') +

      '<div class="form-card" style="margin-top:16px"><div class="section-head" style="margin-bottom:4px"><h2>' + icon('key-outline') + 'Password</h2></div>' +
      '<form id="pw-form"><div class="form-group"><label>Current password</label><input class="input" type="password" name="old"></div>' +
      '<div class="form-group"><label>New password</label><input class="input" type="password" name="new"></div>' +
      '<button class="btn btn-outline" type="submit">Update password</button></form></div>' +
      '<a class="btn btn-danger" style="margin-top:16px" data-nav="#/sign-out">' + icon('log-out-outline') + 'Sign out</a>' +
      '</div><div style="height:16px"></div>';
    return {
      html: html,
      mount: function () {
        bindLocationSelects($('#settings-form'), { province: u.province, district: u.district, city: u.city });
        var stype = u.seller_type || 'individual';
        $$('#stype-seg .opt').forEach(function (o) {
          o.addEventListener('click', function () {
            $$('#stype-seg .opt').forEach(function (x) { x.classList.remove('active'); });
            o.classList.add('active');
            stype = o.getAttribute('data-stype');
          });
        });
        $('#avatar-input').addEventListener('change', function () {
          var f = this.files[0];
          if (!f) return;
          var fd = new FormData(); fd.append('file', f);
          api.form('/me/avatar', fd)
            .then(function (d) {
              state.user.avatar = d.url;
              renderDrawer(); renderTabbar();
              toast('Photo updated', 'success');
              views.settingsRemount();
            }).catch(function (e) { toast(e.message, 'error'); });
        });
        $('#settings-form').addEventListener('submit', function (e) {
          e.preventDefault();
          var locs = $('#settings-form');
          var prov = locs.querySelector('[data-loc="province"]').value;
          var dist = locs.querySelector('[data-loc="district"]').value;
          var city = locs.querySelector('[data-loc="city"]').value;
          api.patch('/me', {
            name: $('[name="name"]', this).value, phone: $('[name="phone"]', this).value,
            whatsapp: $('[name="whatsapp"]', this).value,
            province: prov, district: dist, city: city,
            bio: $('[name="bio"]', this).value, seller_type: stype
          }).then(function (d) {
            state.user = d.user;
            renderDrawer();
            toast('Profile updated', 'success');
          }).catch(function (er) { toast(er.message, 'error'); });
        });
        $('#pw-form').addEventListener('submit', function (e) {
          e.preventDefault();
          api.post('/me/password', { old: $('[name="old"]', this).value, new: $('[name="new"]', this).value }).then(function () {
            toast('Password updated', 'success'); this.reset();
          }.bind(this)).catch(function (er) { toast(er.message, 'error'); });
        });
        var rv = $('#resend-verify');
        if (rv) rv.addEventListener('click', function () {
          requestEmailOtp('#/settings');
        });
        var vp = $('#verify-phone');
        if (vp) vp.addEventListener('click', function () {
          openDialog('Verify phone', '<p>We’ll send a 6-digit code to your phone.</p><div class="form-group mt16"><label>Phone number</label><input class="input" id="vp-phone" value="' + esc($('[name="phone"]').value) + '" placeholder="+94 77 123 4567"></div>',
            'Send code', false, function () {
              api.post('/auth/verify-phone/request', { phone: $('#vp-phone').value }).then(function (d) {
                var code = d.dev && d.dev.code;
                closeDialog();
                openDialog('Enter code', '<p>Code sent to your phone.</p>' +
                  (code ? '<p class="form-hint" style="margin:6px 0">Dev code: <b>' + esc(code) + '</b></p>' : '') +
                  '<div class="form-group mt16"><label>6-digit code</label><input class="input" id="vp-code" inputmode="numeric" placeholder="000000"></div>',
                  'Verify', false, function () {
                    api.post('/auth/verify-phone', { code: $('#vp-code').value }).then(function () {
                      closeDialog(); toast('Phone verified', 'success');
                      state.user.phone_verified = true; renderDrawer(); views.settingsRemount();
                    }).catch(function (e) { toast(e.message, 'error'); });
                  });
              }).catch(function (er) { toast(er.message, 'error'); });
            });
        });
      }
    };
  };
  views.settingsRemount = function () { var v = views.settings(); if (v.mount) v.mount(); };

  /* ---------- auth form helpers ---------- */
  function showEmailOtpDialog(nextHash, devCode) {
    var destination = nextHash || '#/';
    openDialog('Verify your email',
      '<p>Enter the 6-digit code sent to <b>' + esc((state.user && state.user.email) || 'your email') + '</b>.</p>' +
      (devCode ? '<p class="form-hint">Development code: <b>' + esc(devCode) + '</b></p>' : '') +
      '<div class="form-group mt16"><label>Verification code</label>' +
      '<input class="input" id="email-otp-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000"></div>' +
      '<button class="btn btn-outline btn-sm" type="button" id="email-otp-skip" style="margin-top:8px">Skip for now</button>',
      'Verify code', false, function () {
        var code = ($('#email-otp-code').value || '').trim();
        if (!/^\d{6}$/.test(code)) { toast('Enter the 6-digit code', 'error'); return; }
        api.post('/auth/verify-email', { code: code }).then(function () {
          state.user.email_verified = true;
          renderDrawer(); renderTabbar(); closeDialog();
          toast('Email verified', 'success');
          location.hash = destination;
        }).catch(function (e) { toast(e.message, 'error'); });
      });
    var skip = $('#email-otp-skip');
    if (skip) skip.addEventListener('click', function () {
      closeDialog();
      location.hash = destination;
      toast('You can browse now. Verify your email before posting an ad.');
    });
    var input = $('#email-otp-code');
    if (input) input.focus();
  }

  function requestEmailOtp(nextHash) {
    api.post('/auth/resend-verification').then(function (d) {
      if (d.verified) {
        state.user.email_verified = true;
        toast('Your email is already verified', 'success');
        return;
      }
      showEmailOtpDialog(nextHash, d.dev && d.dev.email_code);
    }).catch(function (e) { toast(e.message, 'error'); });
  }

  var EMAIL_RE_CLIENT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function formErrorBox(form) {
    if (!form) return null;
    var box = form.querySelector('.form-error');
    if (!box) {
      box = document.createElement('div');
      box.className = 'form-error';
      box.setAttribute('role', 'alert');
      form.insertBefore(box, form.firstChild);
    }
    return box;
  }
  function showFormError(form, message) {
    var box = formErrorBox(form);
    if (!box) { toast(message, 'error'); return; }
    box.textContent = message;
    box.classList.add('show');
    toast(message, 'error');
  }
  function clearFormError(form) {
    var box = form && form.querySelector('.form-error');
    if (box) { box.textContent = ''; box.classList.remove('show'); }
  }
  function setPending(form, pending, label) {
    if (!form) return;
    var btn = form.querySelector('button[type="submit"]');
    if (!btn) return;
    if (pending) {
      if (!btn.getAttribute('data-label')) btn.setAttribute('data-label', btn.textContent);
      btn.disabled = true;
      btn.classList.add('is-pending');
      btn.textContent = label || 'Please wait…';
    } else {
      btn.disabled = false;
      btn.classList.remove('is-pending');
      var prev = btn.getAttribute('data-label');
      if (prev) btn.textContent = prev;
    }
  }
  /** Only ever navigate to an internal hash route after signing in. */
  function safeNext(raw) {
    var n = String(raw == null ? '' : raw).trim();
    if (!n) return '#/';
    if (/[a-z][a-z0-9+.\-]*:/i.test(n) || n.indexOf('//') !== -1) return '#/';  // any scheme or protocol-relative URL
    if (n.charAt(0) !== '#') n = '#' + (n.charAt(0) === '/' ? '' : '/') + n;
    if (n.slice(0, 2) !== '#/') return '#/';                  // must be an internal hash route
    if (/^#\/\/+/.test(n)) return '#/';                       // "#//evil.com" → external
    if (/^#\/(sign-in|sign-up|sign-out|forgot|reset-password|verify-email)([/?]|$)/.test(n)) return '#/';
    return n;
  }
  /** Persist a freshly issued session token (guards against a malformed 200). */
  function applySession(d) {
    if (!d || typeof d.token !== 'string' || !d.token) {
      throw apiError('The server did not return a session token. Please try again.', 0);
    }
    if (!d.user || !d.user.id) {
      throw apiError('The server did not return your account details. Please try again.', 0);
    }
    api.token = d.token;
    sessSet('ll_token', d.token);
    storeDel('ll_token');
    setUser(d.user);
    return d;
  }
  function firstName(u) {
    var n = (u && u.name ? String(u.name) : '').trim();
    return n ? n.split(/\s+/)[0] : 'there';
  }

  views.signin = function (query) {
    var html = header('Sign In', { heading: false, backTo: '#/' });
    html += '<div class="auth-wrap"><div class="auth-hero">' + logoMark() + '<h1>Welcome back</h1><p>Sign in to manage your listings and chats.</p></div>' +
      '<form id="login-form" class="auth-form"><div class="form-error" role="alert"></div>' +
      '<div class="form-group"><label for="si-email">Email</label>' +
      '<input class="input" id="si-email" type="email" name="email" required placeholder="you@example.com" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false"></div>' +
      '<div class="form-group"><label for="si-password">Password</label>' +
      '<input class="input" id="si-password" type="password" name="password" required placeholder="••••••••" autocomplete="current-password"></div>' +
      '<button class="btn btn-primary" type="submit">Sign In</button></form>' +
      '<div class="flex jcsb aic" style="margin-top:10px">' +
      '<a class="fs12 fw7" data-nav="#/forgot">Forgot password?</a></div>' +
      '<p class="form-hint" style="margin-top:10px;text-align:center">Demo: <b>demo@lankalens.lk</b> / <b>demo1234</b></p>' +
      '<div class="auth-alt">New to Lanka Lens? <a data-nav="#/sign-up">Create an account</a></div></div>';
    return {
      html: html,
      hideTabbar: true,
      pageClass: 'page-auth',
      mount: function () {
        var form = $('#login-form');
        if (!form) return;
        var emailEl = $('[name="email"]', form);
        var passEl = $('[name="password"]', form);
        if (emailEl) emailEl.addEventListener('input', function () { clearFormError(form); });
        if (passEl) passEl.addEventListener('input', function () { clearFormError(form); });

        form.addEventListener('submit', function (e) {
          e.preventDefault();
          clearFormError(form);
          var email = (emailEl.value || '').trim();
          var password = passEl.value || '';

          // Client-side checks mirror the API so the user gets an instant, precise
          // message; server errors are still shown verbatim below.
          if (!email) { showFormError(form, 'Please enter your email.'); emailEl.focus(); return; }
          if (!EMAIL_RE_CLIENT.test(email)) { showFormError(form, 'That doesn’t look like a valid email address.'); emailEl.focus(); return; }
          if (!password) { showFormError(form, 'Please enter your password.'); passEl.focus(); return; }

          setPending(form, true, 'Signing in…');
          api.post('/auth/login', { email: email, password: password }).then(function (d) {
            applySession(d);
            setPending(form, false);
            toast('Welcome back, ' + firstName(d.user) + '!', 'success');
            location.hash = safeNext(query && query.get ? query.get('next') : '');
          }).catch(function (er) {
            setPending(form, false);
            showFormError(form, (er && er.message) || 'Sign in failed. Please try again.');
            if (er && er.status === 401) { passEl.value = ''; passEl.focus(); }
            else if (er && (er.network || er.notJson)) { emailEl.focus(); }
          });
        });
      }
    };
  };

  views.signup = function (query) {
    var html = header('Create Account', { heading: false, backTo: '#/' });
    html += '<div class="auth-wrap"><div class="auth-hero">' + logoMark() + '<h1>Join Lanka Lens</h1><p>Create a free account to buy and sell camera gear.</p></div>' +
      '<form id="signup-form" class="auth-form"><div class="form-error" role="alert"></div>' +
      '<div class="form-group"><label for="su-name">Full name</label><input class="input" id="su-name" name="name" required placeholder="Your name" autocomplete="name"></div>' +
      '<div class="form-group"><label for="su-email">Email</label><input class="input" id="su-email" type="email" name="email" required placeholder="you@example.com" autocomplete="email" autocapitalize="none" autocorrect="off" spellcheck="false"></div>' +
      '<div class="form-group"><label for="su-phone">Phone (optional)</label><input class="input" id="su-phone" type="tel" name="phone" placeholder="+94 77 123 4567" autocomplete="tel" inputmode="tel"></div>' +
      '<div class="form-group"><label for="su-password">Password</label><input class="input" id="su-password" type="password" name="password" required minlength="12" placeholder="at least 12 characters" autocomplete="new-password"></div>' +
      '<div class="form-group"><label>I am a…</label><div class="seg" id="stype-seg">' +
      '<div class="opt active" data-stype="individual" role="button" tabindex="0">Individual</div>' +
      '<div class="opt" data-stype="business" role="button" tabindex="0">Business</div></div>' +
      '<p class="form-hint" id="stype-hint">For personal buying &amp; selling. Verify your email before posting ads.</p></div>' +
      '<button class="btn btn-primary" type="submit">Create Account</button>' +
      '<p class="form-hint" style="margin-top:12px;text-align:center">By creating an account you agree to our ' +
      '<a data-nav="#/terms">Terms</a> and <a data-nav="#/privacy">Privacy Policy</a>.</p></form>' +
      '<div id="verify-banner"></div>' +
      '<div class="auth-alt">Already have an account? <a data-nav="#/sign-in">Sign in</a></div></div>';
    return {
      html: html,
      hideTabbar: true,
      pageClass: 'page-auth',
      mount: function () {
        var form = $('#signup-form');
        if (!form) return;
        var stype = 'individual';
        var stypeHints = {
          individual: 'For personal buying &amp; selling. Verify your email before posting ads.',
          business: 'For shops &amp; camera stores. After sign up you complete shop details and request verification — a verified badge is only granted after admin approval.'
        };
        $$('#stype-seg .opt').forEach(function (o) {
          o.addEventListener('click', function () {
            $$('#stype-seg .opt').forEach(function (x) { x.classList.remove('active'); });
            o.classList.add('active');
            stype = o.getAttribute('data-stype');
            var hint = $('#stype-hint');
            if (hint) hint.innerHTML = stypeHints[stype] || stypeHints.individual;
          });
        });
        $$('input', form).forEach(function (i) { i.addEventListener('input', function () { clearFormError(form); }); });

        form.addEventListener('submit', function (e) {
          e.preventDefault();
          clearFormError(form);
          var name = ($('[name="name"]', form).value || '').trim();
          var email = ($('[name="email"]', form).value || '').trim();
          var phone = ($('[name="phone"]', form).value || '').trim();
          var pw = $('[name="password"]', form).value || '';

          if (name.length < 2) { showFormError(form, 'Please enter your name.'); $('[name="name"]', form).focus(); return; }
          if (!EMAIL_RE_CLIENT.test(email)) { showFormError(form, 'Please enter a valid email address.'); $('[name="email"]', form).focus(); return; }
          if (pw.length < 12) { showFormError(form, 'Password must be at least 12 characters.'); $('[name="password"]', form).focus(); return; }

          setPending(form, true, 'Creating account…');
          api.post('/auth/signup', {
            name: name, email: email, phone: phone, password: pw, seller_type: stype
          }).then(function (d) {
            applySession(d);
            setPending(form, false);
            toast('Account created — welcome, ' + firstName(d.user) + '!', 'success');
            // Choosing "Business" only sets the account type — no shop or badge
            // exists yet. Route them to My Shop to complete the profile and
            // request verification.
            var next = (stype === 'business') ? '#/my-shop'
              : safeNext(query && query.get ? query.get('next') : '');
            if (d.verification_sent) {
              toast('We sent a 6-digit code to your email', 'success');
              showEmailOtpDialog(next, d.dev && d.dev.email_code);
            } else {
              toast('Account created, but the verification email could not be sent.', 'error');
              location.hash = next;
            }
          }).catch(function (er) {
            setPending(form, false);
            showFormError(form, (er && er.message) || 'Sign up failed. Please try again.');
            if (er && er.status === 409) { $('[name="email"]', form).focus(); }
          });
        });
      }
    };
  };

  views.signout = function () {
    // Ask the server to drop the session, but clear local state regardless of
    // the outcome so a failed request can never leave the user "signed in".
    // The request must be built while the token is still set (headers are read
    // synchronously), so fire it before clearing.
    if (api.token) {
      api.post('/auth/logout').catch(logNonCritical('logout'));
    }
    clearSession();
    renderDrawer(); renderTabbar();
    toast('Signed out');
    state.sessionRestored = true;
    location.hash = '#/';
    return {
      html: '<div class="spinner" style="margin-top:80px"></div>',
      hideTabbar: true,
      mount: function () {}
    };
  };

  views.contact = function () {
    var html = header('Contact', { heading: false });
    html += '<div class="hero-page"><h1>Get in touch</h1><p>Questions, feedback or a partnership idea — we’d love to hear from you.</p></div>';
    html += '<div class="detail-wrap"><form id="contact-form"><div class="form-card">' +
      '<div class="form-group"><label>Name</label><input class="input" name="name" required></div>' +
      '<div class="form-group"><label>Email</label><input class="input" type="email" name="email"></div>' +
      '<div class="form-group"><label>Subject</label><input class="input" name="subject"></div>' +
      '<div class="form-group"><label>Message</label><textarea class="textarea" name="message" required style="min-height:120px"></textarea></div>' +
      '<button class="btn btn-primary" type="submit">' + icon('send-outline') + 'Send Message</button></div></form>' +
      '<div class="form-card" style="margin-top:16px"><div class="section-head" style="margin-bottom:4px"><h2>' + icon('information-circle-outline') + 'Contact details</h2></div>' +
      '<div class="spec-row"><span class="k">Email</span><span class="v">support@lankalens.online</span></div>' +
      '<div class="spec-row"><span class="k">Phone</span><span class="v">+94 777 4666 75</span></div>' +
      '<div class="spec-row"><span class="k">Head office</span><span class="v">Tangalle, Sri Lanka</span></div></div></div><div style="height:16px"></div>';
    return {
      html: html,
      mount: function () {
        $('#contact-form').addEventListener('submit', function (e) {
          e.preventDefault();
          var form = this;
          var btn = form.querySelector('button[type="submit"]');
          if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner spinner-sm"></div>Sending…'; }
          act(api.post('/contact', {
            name: $('[name="name"]', form).value, email: $('[name="email"]', form).value,
            subject: $('[name="subject"]', form).value, message: $('[name="message"]', form).value
          }), 'Message sent — thank you!', function () { form.reset(); }, null).then(function () {
            if (btn) { btn.disabled = false; btn.innerHTML = icon('send-outline') + 'Send Message'; }
          });
        });
      }
    };
  };

  views.blog = function () {
    var html = header('Buying Guides', { heading: false });
    html += '<div class="hero-page" style="padding:22px 20px"><h1 style="font-size:20px">Camera guides & tips</h1><p>Practical advice for buying, selling and shooting in Sri Lanka.</p></div>';
    html += '<div id="posts-list">' + loadingHtml('Loading guides…') + '</div>';
    return {
      html: html,
      mount: function () {
        renderAsync({
          into: '#posts-list',
          load: function () { return api.get('/posts'); },
          isEmpty: function () { return false; },
          retryLabel: 'Reload guides',
          render: function (posts) {
            posts = (posts && posts.length) ? posts : builtInBuyingGuides();
            return posts.map(function (p) {
              var href = p.href || ('#/blog/' + p.slug);
              var cleanGuide = p.slug ? ('/guide/' + encodeURIComponent(p.slug)) : '';
              return '<div class="post-card" data-nav="' + esc(href) + '">' +
                (p.image ? '<img class="thumb" src="' + esc(p.image) + '" alt="' + esc(p.title || 'Guide') + '">' : '') +
                '<div class="meta"><span class="cat">' + esc(p.category || 'Guide') + '</span><b>' + (cleanGuide ? '<a href="' + cleanGuide + '" data-nav="' + esc(href) + '" style="color:inherit;text-decoration:none">' + esc(p.title) + '</a>' : esc(p.title)) + '</b>' +
                '<span class="excerpt">' + esc(p.excerpt) + '</span></div></div>';
            }).join('');
          }
        });
      }
    };
  };

  views.post = function (params) {
    var html = '<div id="post-root"><div class="spinner" style="margin-top:80px"></div></div>';
    return {
      html: html,
      mount: function () {
        api.get('/posts/' + params.slug).then(function (p) {
          setMeta(p.title + ' — ' + siteName() + ' Buying Guide', (p.excerpt || p.title).slice(0, 160),
            location.origin + '/guide/' + p.slug, p.image || '');
          $('#post-root').innerHTML = header('Guide', { heading: false }) +
            (p.image ? '<img src="' + esc(p.image) + '" style="width:100%;height:210px;object-fit:cover" alt="' + esc(p.title || 'Guide') + '">' : '') +
            '<div class="detail-wrap"><span class="vbadge">' + esc(p.category || 'Guide') + '</span>' +
            '<h1 class="detail-title" style="margin-top:10px">' + esc(p.title) + '</h1>' +
            '<div class="detail-meta"><span>' + icon('person-outline') + esc(p.author || 'Lanka Lens') + '</span><span>' + icon('calendar-outline') + fmtDate(p.created_at) + '</span></div></div>' +
            '<div class="prose">' + sanitizeRichHtml(p.body || '') + '</div>';
        }).catch(function (e) {
          $('#post-root').innerHTML = header('Guide', {}) + '<div class="empty"><p>' + esc(e.message) + '</p></div>';
        });
      }
    };
  };

  views.shops = function () {
    var html = header('Camera Shops', { heading: false });
    html += '<div class="hero-page" style="padding:22px 20px"><h1 style="font-size:20px">Trusted camera shops</h1><p>Authorised dealers and specialist stores across Sri Lanka.</p></div>';
    html += '<div id="shops-list">' + loadingHtml('Loading camera shops…') + '</div>';
    return {
      html: html,
      mount: function () {
        renderAsync({
          into: '#shops-list',
          load: function () { return api.get('/businesses'); },
          isEmpty: function (shops) { return !shops || !shops.length; },
          emptyText: 'No verified camera shops yet.',
          emptySub: 'Shops appear here once a business completes its profile and an admin verifies it.',
          emptyIcon: 'storefront-outline',
          retryLabel: 'Reload shops',
          render: function (shops) {
            return '<div class="detail-wrap" style="display:grid;gap:14px">' + shops.map(function (s) {
              return '<div class="shop-card" data-nav="#/shop/' + esc(s.slug) + '">' +
                '<div class="cover">' + (s.logo ? '<img src="' + esc(s.logo) + '" alt="' + esc(s.name || 'Shop') + ' logo' + '">' : '<span class="ph">' + icon('storefront-outline') + '</span>') + '</div>' +
                '<div class="body"><div class="name"><a href="/shop/' + esc(s.slug) + '" data-nav="#/shop/' + esc(s.slug) + '" style="color:inherit;text-decoration:none">' + esc(s.name) + '</a>' + (s.verified ? '<span class="vbadge">' + icon('shield-checkmark') + 'Verified</span>' : '') + '</div>' +
                '<div class="area">' + icon('location-outline') + esc([s.area, s.city, s.province].filter(Boolean).join(', ')) + '</div>' +
                '<p class="fs13 muted" style="margin-top:8px;line-height:1.5">' + esc(s.description) + '</p>' +
                '<div class="specs">' + (s.listing_count ? '<span class="chip">' + s.listing_count + ' listings</span>' : '') +
                (s.rating && s.rating.count ? '<span class="chip">' + s.rating.avg + ' ★ (' + s.rating.count + ')</span>' : '') + '</div>' +
                '<div class="flex gap8" style="margin-top:12px">' +
                '<button class="btn btn-primary btn-sm" data-call-shop="' + esc(s.phone) + '">' + icon('call-outline') + 'Call</button>' +
                '<button class="btn btn-wa btn-sm" data-wa-shop="' + esc(s.whatsapp || s.phone) + '">' + icon('logo-whatsapp') + 'WhatsApp</button></div></div></div>';
            }).join('') + '</div><div style="height:16px"></div>';
          }
        });
      }
    };
  };

  /* ---------- static info pages ---------- */
  var STATIC_PAGES = {
    'about': {
      title: 'About', hero: 'About Lanka Lens', sub: 'Sri Lanka’s home for buying and selling camera gear.',
      body: '<p class="lead">Lanka Lens is a dedicated marketplace for photographers, videographers and creators in Sri Lanka.</p>' +
        '<p>We built Lanka Lens because buying and selling camera equipment locally was too hard — gear scattered across general classifieds, no way to check specifications, and no trusted space for the community.</p>' +
        '<p>Our goal is simple: make it safe, fast and transparent to trade cameras, lenses, drones, action cameras and accessories — priced in rupees, listed by location, and reviewed by a community that cares about photography.</p>' +
        '<h3>What you can do</h3><ul><li>Post ads with category-specific specifications (shutter count, mount, aperture and more).</li><li>Search by brand, condition, price and location across all nine provinces.</li><li>Contact sellers by call, WhatsApp or in-app chat, and make offers.</li><li>Discover authorised camera shops and read practical buying guides.</li></ul>'
    },
    'safety': {
      title: 'Safety', hero: 'Buy & Sell Safely', sub: 'A few simple steps protect you from most scams.',
      body: '<p class="lead">The vast majority of Lanka Lens users are honest, but it pays to be careful.</p>' +
        '<h3>When buying</h3><ul>' +
        '<li><b>Meet in person</b> — choose a busy, public place and inspect the item before paying.</li>' +
        '<li><b>Test everything</b> — check the sensor, lens glass, shutter and all buttons (see our buying guide).</li>' +
        '<li><b>Ask for the receipt</b> and original box — good signs the item is genuine.</li>' +
        '<li><b>Never pay a deposit or “shipping fee” in advance.</b> Pay only after you see the item.</li></ul>' +
        '<h3>When selling</h3><ul>' +
        '<li>Meet buyers in public and avoid sharing your home address.</li>' +
        '<li>Beware of overpayments, fake payment screenshots and urgent “I’ll send a courier” requests.</li>' +
        '<li>Use in-app chat so you have a record of the conversation.</li></ul>' +
        '<h3>Report it</h3><p>If something feels wrong, use the <b>Report</b> button on any listing and our team will review it.</p>'
    },
    'buying-guide': {
      title: 'Buying Guide', hero: 'Buy Used Camera Gear With Confidence',
      sub: 'Practical Sri Lankan checklists for cameras, lenses and creator gear.',
      body: '<p class="lead">A good deal is not only a low price. Confirm the condition, ownership and full cost before you pay. Meet in a bright public place and take enough time to test.</p>' +
        '<div class="guide-grid">' +
        '<article class="guide-card"><img class="guide-photo" src="/images/products/sony-a7iii-1.jpg" alt="Mirrorless camera for the used camera inspection guide">' +
        '<div class="guide-copy"><span class="guide-tag">Camera bodies</span><h2>Inspect a DSLR or mirrorless camera</h2>' +
        '<ul><li><b>Check the exterior:</b> look for impact marks, loose doors, damaged ports and corrosion around the battery compartment.</li>' +
        '<li><b>Test the sensor:</b> photograph a plain bright surface at a small aperture, then zoom in to identify persistent dust or marks.</li>' +
        '<li><b>Check shutter count:</b> compare it with the manufacturer’s expected shutter life, but also judge the camera’s overall condition.</li>' +
        '<li><b>Test controls:</b> try autofocus, burst shooting, video, card slots, hot shoe, flash, screen, viewfinder, Wi-Fi and every button.</li>' +
        '<li><b>Review files:</b> bring a compatible memory card and inspect full-size photos and video on your own phone or laptop.</li></ul></div></article>' +
        '<article class="guide-card"><img class="guide-photo" src="/images/products/lens-canon-1.jpg" alt="Camera lens for the used lens inspection guide">' +
        '<div class="guide-copy"><span class="guide-tag">Lenses</span><h2>Check glass, focus and compatibility</h2>' +
        '<ul><li><b>Confirm the mount:</b> match the exact mount to your camera; an adapter can reduce autofocus or stabilization features.</li>' +
        '<li><b>Inspect in good light:</b> check front and rear glass for fungus, haze, separation, scratches and excessive internal dust.</li>' +
        '<li><b>Move every ring:</b> zoom, focus and aperture controls should operate smoothly without grinding, stiffness or unusual play.</li>' +
        '<li><b>Take sample photos:</b> test wide open and stopped down at near and far distances; check sharpness on every side of the frame.</li>' +
        '<li><b>Test electronics:</b> verify autofocus, stabilization, aperture control and lens recognition on your own camera body.</li></ul></div></article>' +
        '<article class="guide-card"><img class="guide-photo" src="/images/products/gopro-1.jpg" alt="Action camera for the creator gear inspection guide">' +
        '<div class="guide-copy"><span class="guide-tag">Action cameras & creator gear</span><h2>Test batteries, recording and accessories</h2>' +
        '<ul><li><b>Record continuously:</b> make a long high-resolution clip and check for overheating, shutdowns, corrupted files or audio problems.</li>' +
        '<li><b>Inspect seals and ports:</b> damaged doors or seals can remove water resistance; never rely only on the seller’s claim.</li>' +
        '<li><b>Check battery health:</b> confirm charging, runtime and whether replacement batteries are genuine and locally available.</li>' +
        '<li><b>Verify stabilization:</b> walk while recording and review the footage for shaking, horizon problems or focus issues.</li>' +
        '<li><b>Count the complete kit:</b> confirm mounts, cages, charger, cables, remote, microphone adapters and memory-card requirements.</li></ul></div></article>' +
        '</div>' +
        '<div class="guide-checklist"><h2>Before paying</h2><ol>' +
        '<li>Compare the asking price with similar Lanka Lens listings and include the cost of missing batteries, chargers or repairs.</li>' +
        '<li>Match the serial number on the item, box and receipt where available. Ask the seller to explain any mismatch.</li>' +
        '<li>Confirm the seller can reset accounts, remove activation locks and transfer any valid warranty.</li>' +
        '<li>Meet in a public place, test the exact item, and pay only after you are satisfied. Avoid deposits and payment screenshots.</li>' +
        '<li>Write down what is included and keep the listing, chat and payment record.</li></ol></div>'
    },
    'sell-your-camera': {
      title: 'Sell Your Camera', hero: 'Sell Your Camera', sub: 'Turn your unused gear into cash in three steps.',
      body: '<p class="lead">Listing on Lanka Lens is free and takes only a few minutes.</p>' +
        '<h3>1. Choose a category</h3><p>Pick the right category — the listing form shows fields that match your item (shutter count for cameras, mount for lenses, and so on).</p>' +
        '<h3>2. Add photos and details</h3><p>Listings with clear photos and complete specifications sell much faster. Add up to 3 photos and an honest description.</p>' +
        '<h3>3. Publish and respond</h3><p>Buyers can reach you by call, WhatsApp or chat, and can make offers. Respond quickly to close the sale.</p>' +
        '<h3>Pricing tips</h3><ul><li>Check similar listings to set a realistic price.</li><li>Mark as negotiable if you’re flexible — it attracts more offers.</li><li>Include what’s in the box (charger, batteries, warranty) to justify your price.</li></ul>' +
        '<div class="mt16"><a class="btn btn-primary" data-nav="#/sell">Start selling</a></div>'
    },
    'privacy': {
      title: 'Privacy', hero: 'Privacy Policy', sub: 'How we handle your information.',
      body: '<p class="lead">Your privacy matters to us. This policy explains what we collect and how we use it.</p>' +
        '<h3>What we collect</h3><p>When you create an account we store your name, email, phone number and location, plus the listings, messages and offers you create.</p>' +
        '<h3>How we use it</h3><p>We use this information to run the marketplace — showing your listings, connecting you with buyers and sellers, and notifying you about activity on your ads.</p>' +
        '<h3>What we share</h3><p>Your public profile (name, location, verified badge) is shown on your listings. We never sell your personal data to third parties.</p>' +
        '<h3>Your choices</h3><p>You can update or delete your account information from Settings. Contact us at support@lankalens.online with any privacy questions.</p>'
    },
    'terms': {
      title: 'Terms', hero: 'Terms of Use', sub: 'The rules for using Lanka Lens.',
      body: '<p class="lead">By using Lanka Lens you agree to these terms.</p>' +
        '<h3>1. Be honest</h3><p>List only items you actually own and describe them accurately, including any faults. Misleading listings may be removed.</p>' +
        '<h3>2. Keep it legal</h3><p>Do not list stolen, counterfeit or prohibited items. You are responsible for complying with Sri Lankan law.</p>' +
        '<h3>3. Stay respectful</h3><p>Communicate politely in chat and messages. Harassment, spam and fraud are not tolerated.</p>' +
        '<h3>4. Transactions are your responsibility</h3><p>Lanka Lens connects buyers and sellers but is not a party to any sale. Please follow our safety tips and resolve disputes between yourselves.</p>' +
        '<h3>5. Changes</h3><p>We may update these terms from time to time. Continued use of the site means you accept the latest version.</p>'
    },
    'faq': {
      title: 'FAQ', hero: 'Frequently Asked Questions', sub: 'Quick answers to common questions.',
      body: ''
    },
    'help': {
      title: 'Help', hero: 'Help & Support', sub: 'Everything you need to get the most from Lanka Lens.',
      body: '<p class="lead">Browse the topics below or contact us if you still need a hand.</p>' +
        '<h3>Posting a listing</h3><ul><li>Tap the orange + button, choose a category and fill in the details.</li><li>Add up to 3 photos — your first photo is the cover image.</li><li>Set a price in Sri Lankan Rupees (LKR).</li></ul>' +
        '<h3>Buying</h3><ul><li>Use search or browse by category, brand and location.</li><li>Contact sellers by Call, WhatsApp or Chat from any listing.</li><li>Save listings with the heart icon to find them again in Favorites.</li></ul>' +
        '<h3>Account</h3><ul><li>Update your name, phone and location in Settings.</li><li>Manage your ads in My Ads — mark items as sold or delete them.</li><li>Track offers in My Offers.</li></ul>' +
        '<h3>Still stuck?</h3><p>Email support@lankalens.online or use the contact form.</p>'
    }
  };

  function staticPage(slug) {
    var cfg = STATIC_PAGES[slug];
    return function () {
      var html = header(cfg.title, { heading: false });
      html += '<div class="hero-page"><h1>' + cfg.hero + '</h1><p>' + cfg.sub + '</p></div>';
      if (slug === 'faq') {
        html += '<div class="detail-wrap" style="padding-top:8px">' + FAQ_ITEMS.map(function (f, i) {
          return '<div class="faq-item"><div class="faq-q" data-faq="' + i + '">' + esc(f.q) + icon('chevron-down-outline') + '</div>' +
            '<div class="faq-a"><p>' + f.a + '</p></div></div>';
        }).join('') + '</div>';
      } else {
        html += '<div class="prose" style="padding-top:14px">' + cfg.body + '</div>';
      }
      return {
        html: html,
        mount: function () {
          $$('[data-faq]').forEach(function (q) {
            q.addEventListener('click', function () {
              var item = q.parentElement;
              var wasOpen = item.classList.contains('open');
              $$('.faq-item').forEach(function (x) { x.classList.remove('open'); });
              if (!wasOpen) item.classList.add('open');
            });
          });
        }
      };
    };
  }

  var FAQ_ITEMS = [
    { q: 'Is Lanka Lens free to use?', a: 'Yes — browsing, creating an account and posting listings are all free. There are no hidden fees for buyers or sellers.' },
    { q: 'How do I post an ad?', a: 'Tap the orange + button, pick a category and fill in the form. Add photos, a price in LKR and your location, then publish. Your ad goes live instantly.' },
    { q: 'Which currencies are supported?', a: 'All prices are in Sri Lankan Rupees (LKR / Rs.), which makes it easy to compare listings locally.' },
    { q: 'How do buyers contact me?', a: 'Buyers can call you, message you on WhatsApp, or use in-app chat directly from your listing. You’ll get a notification for new chats and offers.' },
    { q: 'How do I make an offer?', a: 'Open any listing and tap “Make an offer”. Enter your price and an optional message — the seller can accept or decline it.' },
    { q: 'Is my account required to browse?', a: 'No, you can browse and search freely. You only need an account to post ads, save favorites, chat and make offers.' },
    { q: 'How do I stay safe?', a: 'Meet in public, test the item before paying, and never send money in advance. See our Safety page for the full checklist.' },
    { q: 'Can I delete or mark my ad as sold?', a: 'Yes — open My Ads and use the Sold or delete buttons on any of your listings.' }
  ];

  views.about = staticPage('about');
  views.safety = staticPage('safety');
  views['buying-guide'] = staticPage('buying-guide');
  views['sell-your-camera'] = staticPage('sell-your-camera');
  views.privacy = staticPage('privacy');
  views.terms = staticPage('terms');
  views.faq = staticPage('faq');
  views.help = staticPage('help');

  views.forgot = function () {
    var html = header('Forgot Password', { heading: false, backTo: '#/' });
    html += '<div class="auth-wrap"><div class="auth-hero">' + logoMark() + '<h1>Reset your password</h1><p>Enter your email and we’ll send you a reset link.</p></div>' +
      '<form id="forgot-form" class="auth-form"><div class="form-error" role="alert"></div>' +
      '<div class="form-group"><label for="fp-email">Email</label><input class="input" id="fp-email" type="email" name="email" required placeholder="you@example.com" autocomplete="email" autocapitalize="none" spellcheck="false"></div>' +
      '<button class="btn btn-primary" type="submit">Send reset link</button></form>' +
      '<div id="reset-banner"></div>' +
      '<div class="auth-alt">Remembered it? <a data-nav="#/sign-in">Sign in</a></div></div>';
    return {
      html: html,
      hideTabbar: true,
      pageClass: 'page-auth',
      mount: function () {
        var form = $('#forgot-form');
        if (!form) return;
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          clearFormError(form);
          var email = ($('[name="email"]', form).value || '').trim();
          if (!EMAIL_RE_CLIENT.test(email)) { showFormError(form, 'Please enter a valid email address.'); return; }
          setPending(form, true, 'Sending…');
          api.post('/auth/forgot', { email: email }).then(function (d) {
            setPending(form, false);
            if (d.dev && d.dev.reset_token) {
              $('#reset-banner').innerHTML = '<div class="info-card mt16" style="padding:13px 14px"><div class="fs13" style="color:var(--ink)"><b>Reset link created</b></div><p class="fs12 muted" style="margin:6px 0 10px">We emailed you a link. In this dev build:</p><a class="btn btn-primary btn-sm" data-nav="#/reset-password?token=' + encodeURIComponent(d.dev.reset_token) + '">Open reset page</a></div>';
            } else {
              $('#reset-banner').innerHTML = '<div class="info-card mt16" style="padding:13px 14px"><p class="fs13">If that email exists, a reset link has been sent.</p></div>';
            }
          }).catch(function (er) {
            setPending(form, false);
            showFormError(form, (er && er.message) || 'Could not send the reset link. Please try again.');
          });
        });
      }
    };
  };

  views.resetPassword = function (q) {
    var token = q.get('token') || '';
    var html = header('Set New Password', { heading: false, backTo: '#/' });
    html += '<div class="auth-wrap"><div class="auth-hero"><h1>Choose a new password</h1><p>Enter a new password for your account.</p></div>' +
      '<form id="reset-form" class="auth-form"><div class="form-error" role="alert"></div>' +
      '<div class="form-group"><label for="rp-password">New password</label><input class="input" id="rp-password" type="password" name="password" required minlength="12" placeholder="at least 12 characters" autocomplete="new-password"></div>' +
      '<div class="form-group"><label for="rp-confirm">Confirm password</label><input class="input" id="rp-confirm" type="password" name="confirm" required minlength="12" placeholder="Repeat it" autocomplete="new-password"></div>' +
      '<button class="btn btn-primary" type="submit">Reset password</button></form>' +
      '<div class="auth-alt"><a data-nav="#/sign-in">Back to sign in</a></div></div>';
    return {
      html: html,
      hideTabbar: true,
      pageClass: 'page-auth',
      mount: function () {
        var form = $('#reset-form');
        if (!form) return;
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          clearFormError(form);
          var pw = $('[name="password"]', form).value || '';
          var cf = $('[name="confirm"]', form).value || '';
          if (!token) { showFormError(form, 'This reset link is missing its token. Request a new one.'); return; }
          if (pw.length < 12) { showFormError(form, 'Password must be at least 12 characters.'); return; }
          if (pw !== cf) { showFormError(form, 'Passwords do not match.'); $('[name="confirm"]', form).focus(); return; }
          setPending(form, true, 'Resetting…');
          api.post('/auth/reset', { token: token, password: pw }).then(function () {
            setPending(form, false);
            toast('Password reset — sign in with your new password', 'success');
            location.hash = '#/sign-in';
          }).catch(function (er) {
            setPending(form, false);
            showFormError(form, (er && er.message) || 'Could not reset the password. Please try again.');
          });
        });
      }
    };
  };

  views.verifyEmail = function (q) {
    var token = q.get('token') || '';
    var html = header('Verify Email', { backTo: '#/' });
    html += '<div id="verify-root"><div class="spinner" style="margin-top:80px"></div></div>';
    return {
      html: html,
      hideTabbar: true,
      pageClass: 'page-auth',
      mount: function () {
        if (!token) {
          $('#verify-root').innerHTML = '<div class="empty"><div class="e-icon">' + icon('alert-circle-outline') + '</div><h3>Missing token</h3><p>This verification link is incomplete.</p></div>';
          return;
        }
        api.post('/auth/verify-email', { token: token }).then(function () {
          if (state.user) { state.user.email_verified = true; renderDrawer(); }
          $('#verify-root').innerHTML = '<div class="empty"><div class="e-icon">' + icon('checkmark-circle-outline') + '</div><h3>Email verified</h3><p>Thanks — your email is now confirmed.</p><a class="btn btn-primary btn-sm" data-nav="#/" style="margin-top:12px">Continue</a></div>';
        }).catch(function (e) {
          $('#verify-root').innerHTML = '<div class="empty"><div class="e-icon">' + icon('alert-circle-outline') + '</div><h3>Couldn’t verify</h3><p>' + esc(e.message) + '</p></div>';
        });
      }
    };
  };

  views.analytics = function () {
    if (!requireAuth()) return { html: '' };
    var html = header('Seller Analytics', {});
    html += '<div id="an-root"><div class="spinner"></div></div>';
    return {
      html: html,
      mount: function () {
        api.get('/me/analytics').then(function (d) {
          var s = d.summary;
          var cards = [
            ['eye-outline', s.views, 'Views'],
            ['heart-outline', s.favorites, 'Favorites'],
            ['chatbubble-ellipses-outline', s.messages, 'Messages'],
            ['call-outline', s.calls, 'Calls'],
            ['logo-whatsapp', s.whatsapp, 'WhatsApp'],
            ['cash-outline', s.offers, 'Offers']
          ];
          var h = '<div class="stat-strip" style="grid-template-columns:repeat(3,1fr)">' + cards.map(function (c) {
            return '<div class="stat-box"><b>' + c[1] + '</b><span>' + c[2] + '</span></div>';
          }).join('') + '</div>';
          h += '<div class="section"><div class="section-head"><h2>' + icon('bar-chart-outline') + 'Per listing</h2></div></div>';
          if (!d.listings.length) h += '<div class="empty"><p>No listings yet.</p></div>';
          else h += '<div>' + d.listings.map(function (l) {
            return '<div class="row-item"><div class="an-thumb">' + (l.image ? '<img src="' + esc(l.image) + '" alt="' + esc(l.title || 'Listing') + '">' : icon('camera-outline')) + '</div>' +
              '<div class="ri-main" data-nav="#/ads/' + l.id + '"><b>' + esc(l.title) + '</b>' +
              '<span>' + l.views + ' views · ' + l.favorites + ' favs · ' + l.messages + ' msgs · ' + l.calls + ' calls · ' + l.whatsapp + ' WA · ' + l.offers + ' offers</span></div>' +
              statusChip(l.status) + '</div>';
          }).join('') + '</div>';
          $('#an-root').innerHTML = h;
        }).catch(function (e) { $('#an-root').innerHTML = '<div class="empty"><p>' + esc(e.message) + '</p></div>'; });
      }
    };
  };

  views.myShop = function () {
    if (!requireAuth()) return { html: '' };
    var BIZ_CATEGORIES = ['Camera & Lens Sales', 'Repair & Service', 'Rentals',
      'Photo Studio / Printing', 'Online Store', 'Accessories & Bags', 'Other'];
    var DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];
    var html = header('My Shop', {});
    html += '<div id="shop-root"><div class="spinner"></div></div>';
    return {
      html: html,
      mount: function () { load(); }
    };
    function statusCard(biz) {
      var st = biz.verification_status || 'not_submitted';
      var meta = {
        not_submitted: ['Not submitted', '#74817C',
          'Complete your shop details below, then submit them for admin verification. Until an admin approves the shop it stays private — no public listing and no verified badge.'],
        pending: ['Pending review', '#C77D23',
          'Your shop is under review by an administrator. You will be notified as soon as it has been checked.'],
        approved: ['Verified shop', '#0E7C66',
          'Your shop has been verified and appears in the camera shops directory with the verified badge.'],
        rejected: ['Verification rejected', '#E5484D',
          '']
      }[st];
      var h = '<div class="detail-wrap" style="padding-bottom:0"><div class="info-card" style="padding:14px 16px">';
      h += '<div class="flex aic jcsb" style="gap:10px"><div class="fs13 fw7">' + icon('storefront-outline') + ' Shop verification</div>' +
        '<span class="status-chip" style="color:' + meta[1] + ';background:' + meta[1] + '1a">' + esc(meta[0]) + '</span></div>';
      h += '<p class="fs12 muted" style="margin:6px 0 0">' + esc(meta[2]);
      if (st === 'rejected' && biz.rejection_reason) h += ' Reason: <b style="color:#B42318">' + esc(biz.rejection_reason) + '</b>';
      if (st === 'pending' && biz.submitted_at) h += ' Submitted ' + fmtDate(biz.submitted_at) + '.';
      h += '</p></div></div>';
      return h;
    }
    function load() {
      api.get('/me/business').then(function (biz) { render(biz || {}); })
        .catch(function (e) { $('#shop-root').innerHTML = '<div class="empty"><p>' + esc(e.message) + '</p></div>'; });
    }
    function render(biz) {
      var hours = biz.opening_hours || {};
      var merchantPolicy = biz.merchant_policy || {};
      var st = biz.verification_status || 'not_submitted';
      var isBizUser = (state.user.seller_type || 'individual') === 'business';
      var h = '';
      if (!isBizUser) {
        h += '<div class="detail-wrap" style="padding-bottom:0"><div class="info-card" style="padding:16px">' +
          '<div class="fs13 fw7">Switch to a business account</div>' +
          '<p class="fs12 muted" style="margin:6px 0 12px">For shops and camera stores that sell regularly. Individual sellers can keep selling personal items without registering a shop.</p>' +
          '<button class="btn btn-primary" id="become-business">Become a business seller</button></div></div>';
      }
      if (biz.name || isBizUser) h += statusCard(biz);
      h += '<div class="detail-wrap"><form id="shop-form" novalidate><div class="form-card">' +
        '<div class="section-head" style="margin-bottom:4px"><h2>' + icon('briefcase-outline') + 'Shop details</h2></div>' +
        '<div class="form-group"><label>Business name <span class="req">*</span></label><input class="input" name="name" value="' + esc(biz.name || '') + '" placeholder="e.g. Colombo Camera House" maxlength="60"></div>' +
        '<div class="form-group"><label>Business category <span class="req">*</span></label>' +
        '<select class="select" name="business_category"><option value="">Select…</option>' +
        BIZ_CATEGORIES.map(function (c) { return '<option value="' + esc(c) + '"' + (biz.business_category === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></div>' +
        '<div class="form-group"><label>Owner / contact name <span class="req">*</span></label><input class="input" name="owner_name" value="' + esc(biz.owner_name || '') + '" placeholder="Full name of the shop owner" maxlength="60"></div>' +
        '<div class="form-group"><label>Business phone <span class="req">*</span></label><input class="input" name="phone" type="tel" value="' + esc(biz.phone || '') + '" placeholder="+94 11 250 4400"></div>' +
        '<div class="form-group"><label>WhatsApp (optional)</label><input class="input" name="whatsapp" type="tel" value="' + esc(biz.whatsapp || '') + '" placeholder="94112504400"></div>' +
        '<div class="form-group"><label>Business address — area / street <span class="req">*</span></label><input class="input" name="area" value="' + esc(biz.area || '') + '" placeholder="e.g. 42 Galle Road"></div>' +
        '<div class="form-group"><label>Business registration no. (optional)</label><input class="input" name="registration_number" value="' + esc(biz.registration_number || '') + '" placeholder="e.g. DSC/DP 123456"></div>' +
        '<div class="form-group"><label>Logo</label><div class="flex aic gap8">' +
        (biz.logo ? '<img id="logo-prev" class="logo-prev" src="' + esc(biz.logo) + '" alt="' + esc(biz.name || 'Business') + ' logo">' : '<span id="logo-prev" class="logo-prev ph">' + icon('image-outline') + '</span>') +
        '<label class="btn btn-outline btn-sm" style="width:auto">Upload<input type="file" id="logo-input" accept="image/*" hidden></label></div></div>' +
        '<div class="form-group"><label>Description</label><textarea class="textarea" name="description" style="min-height:90px">' + esc(biz.description || '') + '</textarea></div>' +
        '</div>' +
        '<div class="form-card" style="margin-top:16px"><div class="section-head" style="margin-bottom:4px"><h2>' + icon('location-outline') + 'Location</h2></div>' +
        locationSelectsHtml() + '</div>' +
        '<div class="form-card" style="margin-top:16px"><div class="section-head" style="margin-bottom:4px"><h2>' + icon('time-outline') + 'Opening hours</h2>' +
        '<button class="btn btn-outline btn-sm" type="button" id="hours-24-7" style="width:auto">' + icon('time-outline') + 'Open 24/7</button></div>' +
        '<p class="form-hint" style="margin-bottom:10px">Tap Open 24/7 to set every day to “24 Hours Open”, or enter separate hours below.</p>' +
        DAYS.map(function (d) {
          return '<div class="form-group"><label>' + d[1] + '</label><input class="input" name="hours_' + d[0] + '" value="' + esc(hours[d[0]] || '') + '" placeholder="9:00 AM – 6:00 PM or Closed"></div>';
        }).join('') + '</div>' +
        '<div class="form-card" style="margin-top:16px"><div class="section-head" style="margin-bottom:4px"><h2>' + icon('cart-outline') + 'Merchant listing settings</h2></div>' +
        '<p class="form-hint" style="margin-bottom:10px">Set your default delivery and return policy once. These values are used for your shop listings unless a listing has its own delivery/return details.</p>' +
        '<div class="form-group"><label>Shipping cost (LKR)</label><input class="input" name="merchant_shipping_rate_lkr" type="number" min="0" max="1000000" step="1" value="' + esc(merchantPolicy.shipping_rate_lkr || '') + '" placeholder="0 for free shipping"></div>' +
        '<div class="form-group"><label>Handling time (days)</label><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        '<input class="input" name="merchant_handling_min_days" type="number" min="0" max="365" step="1" value="' + esc(merchantPolicy.handling_min_days || '') + '" placeholder="Min">' +
        '<input class="input" name="merchant_handling_max_days" type="number" min="0" max="365" step="1" value="' + esc(merchantPolicy.handling_max_days || '') + '" placeholder="Max"></div></div>' +
        '<div class="form-group"><label>Transit time (days)</label><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        '<input class="input" name="merchant_transit_min_days" type="number" min="0" max="365" step="1" value="' + esc(merchantPolicy.transit_min_days || '') + '" placeholder="Min">' +
        '<input class="input" name="merchant_transit_max_days" type="number" min="0" max="365" step="1" value="' + esc(merchantPolicy.transit_max_days || '') + '" placeholder="Max"></div></div>' +
        '<div class="form-group"><label>Return policy</label><select class="select" name="merchant_return_policy">' +
        '<option value="">Not specified</option>' +
        '<option value="not_permitted"' + (merchantPolicy.return_policy === 'not_permitted' ? ' selected' : '') + '>Returns not accepted</option>' +
        '<option value="finite"' + (merchantPolicy.return_policy === 'finite' ? ' selected' : '') + '>Returns accepted within a set number of days</option>' +
        '<option value="unlimited"' + (merchantPolicy.return_policy === 'unlimited' ? ' selected' : '') + '>Unlimited return window</option></select></div>' +
        '<div class="form-group"><label>Return window (days)</label><input class="input" name="merchant_return_days" type="number" min="1" max="365" step="1" value="' + esc(merchantPolicy.return_days || '') + '" placeholder="Only needed for a set return window"></div>' +
        '<p class="form-hint">Only enter your real shop policy. Leave fields blank if they do not apply.</p></div>';
      h += '<div class="detail-wrap" style="padding-top:14px">';
      h += '<button class="btn btn-primary" type="submit">' + icon('checkmark-outline') + 'Save shop details</button>';
      if (st === 'not_submitted' || st === 'rejected') {
        h += '<button class="btn btn-accent" type="button" id="shop-submit" style="margin-top:8px">' + icon('shield-checkmark') + (st === 'rejected' ? 'Save & resubmit for verification' : 'Submit for verification') + '</button>' +
          '<p class="form-hint" style="text-align:center;margin-top:8px">An admin checks your shop details. Only approved shops get the verified badge and a public shop page.</p>';
      } else if (st === 'pending') {
        h += '<p class="form-hint" style="text-align:center;margin-top:10px">Changes are saved, but a new verification request is not needed while the review is running.</p>';
      } else if (st === 'approved') {
        h += '<p class="form-hint" style="text-align:center;margin-top:10px">Your shop is verified — changes below update your live shop page.</p>';
      }
      h += '</div></form></div><div style="height:16px"></div>';
      if (isBizUser) {
        h += '<div class="detail-wrap" id="shop-admin-contact"><div class="info-card"><b>' +
          icon('chatbubble-ellipses-outline') + 'Need help from Lanka Lens?</b>' +
          '<p class="form-hint" style="margin:6px 0 10px">Business owners can message an administrator directly.</p>' +
          '<span class="muted fs12">Loading admin contact…</span></div></div>';
      }
      $('#shop-root').innerHTML = h;

      if (isBizUser) {
        api.get('/support/admin').then(function (admin) {
          var contact = $('#shop-admin-contact');
          if (contact) contact.innerHTML = '<div class="info-card"><b>' + icon('chatbubble-ellipses-outline') +
            'Lanka Lens support</b><p class="form-hint" style="margin:6px 0 10px">Message ' + esc(admin.name) +
            ' about verification or your shop.</p><a class="btn btn-outline btn-sm" data-nav="#/chat/' + admin.id + '">Message admin</a></div>';
        }).catch(function () {
          var contact = $('#shop-admin-contact');
          if (contact) contact.innerHTML = '';
        });
      }

      if (isBizUser && biz.slug) {
        var label = st === 'approved' ? 'View your public shop page' : 'Preview your shop page';
        var sub = st === 'approved' ? 'Share this link with customers' : 'Visible to you until verification is approved';
        $('#shop-root').insertAdjacentHTML('afterbegin', '<div class="detail-wrap" style="padding-bottom:0"><div class="promo" data-nav="#/shop/' + esc(biz.slug) + '"><div class="p-icon">' + icon('eye-outline') + '</div><div><b>' + label + '</b><span>' + sub + '</span></div><div class="go">' + icon('chevron-forward-outline') + '</div></div></div>');
      }
      var bb = $('#become-business');
      if (bb) bb.addEventListener('click', function () {
        act(api.patch('/me', { seller_type: 'business' }), 'You are now a business seller — complete your shop details and submit for verification', function (d) {
          if (d && d.user) state.user = d.user;
          renderDrawer(); renderTabbar(); render({});
        });
      });
      bindLocationSelects($('#shop-root'), { province: biz.province, district: biz.district, city: biz.city });
      var openAllDay = $('#hours-24-7');
      if (openAllDay) openAllDay.addEventListener('click', function () {
        DAYS.forEach(function (d) {
          var field = $('#shop-form').querySelector('[name="hours_' + d[0] + '"]');
          if (field) field.value = '24 Hours Open';
        });
        toast('Opening hours set to 24 Hours Open for every day', 'success');
      });

      function uploadImage(id, setter, prevId, alt) {
        var inp = $(id);
        if (!inp) return;
        inp.addEventListener('change', function () {
          var f = this.files[0];
          if (!f) return;
          if (f.size > 1048576) { toast('Image is over 1MB — please use a smaller file', 'error'); return; }
          var fd = new FormData(); fd.append('file', f);
          api.form('/upload', fd).then(function (d) {
            var item = d && d.items && d.items[0];
            if (!item || !item.url) throw apiError('The server did not return an uploaded image.', 0, { path: '/upload' });
            setter(item.url);
            var p = $(prevId);
            if (p) p.outerHTML = '<img id="' + prevId.slice(1) + '" class="logo-prev" src="' + esc(item.url) + '" alt="' + esc(alt) + '">';
          }).catch(function (e) { toast(e.message, 'error'); });
        });
      }
      uploadImage('#logo-input', function (url) { biz.logo = url; }, '#logo-prev', (biz.name || 'Business') + ' logo');

      function collectForm() {
        var form = $('#shop-form');
        var oh = {};
        DAYS.forEach(function (d) {
          var el = form.querySelector('[name="hours_' + d[0] + '"]');
          if (el && el.value.trim()) oh[d[0]] = el.value.trim();
        });
        var sel = function (loc) { var el = $('#shop-root').querySelector('[data-loc="' + loc + '"]'); return el ? el.value : ''; };
        function shopValue(name) {
          var el = form.querySelector('[name="' + name + '"]');
          return el ? el.value.trim() : '';
        }
        return {
          name: form.querySelector('[name="name"]').value.trim(),
          logo: biz.logo || '', description: form.querySelector('[name="description"]').value,
          area: form.querySelector('[name="area"]').value.trim(),
          phone: form.querySelector('[name="phone"]').value.trim(),
          whatsapp: form.querySelector('[name="whatsapp"]').value.trim(),
          business_category: form.querySelector('[name="business_category"]').value,
          owner_name: form.querySelector('[name="owner_name"]').value.trim(),
          registration_number: form.querySelector('[name="registration_number"]').value.trim(),
          province: sel('province'), district: sel('district'), city: sel('city'),
          opening_hours: oh,
          merchant_policy: {
            shipping_rate_lkr: shopValue('merchant_shipping_rate_lkr'),
            handling_min_days: shopValue('merchant_handling_min_days'),
            handling_max_days: shopValue('merchant_handling_max_days'),
            transit_min_days: shopValue('merchant_transit_min_days'),
            transit_max_days: shopValue('merchant_transit_max_days'),
            return_policy: shopValue('merchant_return_policy'),
            return_days: shopValue('merchant_return_days')
          }
        };
      }
      function validate(p) {
        if (!p.name) return 'Enter your business name';
        if (!p.business_category) return 'Choose a business category';
        if (!p.owner_name) return 'Enter the owner / contact name';
        if (!p.phone) return 'Enter the business phone number';
        if (!p.area) return 'Enter the business address';
        if (!(p.province && p.district && p.city)) return 'Select the province, district and city';
        return null;
      }
      function saveForm() { return api.put('/me/business', collectForm()); }
      $('#shop-form').addEventListener('submit', function (e) {
        e.preventDefault();
        var p = collectForm();
        var problem = validate(p);
        if (problem) { toast(problem, 'error'); return; }
        setPending(this, true, 'Saving…');
        saveForm().then(function (d) {
          setPending(this2, false);
          state.user.seller_type = 'business';
          renderDrawer(); renderTabbar();
          toast('Shop details saved', 'success');
          load();
        }).catch(function (er) {
          setPending(this2, false);
          toast(er.message, 'error');
        });
        var this2 = this;
      });
      var submitBtn = $('#shop-submit');
      if (submitBtn) submitBtn.addEventListener('click', function () {
        var p = collectForm();
        var problem = validate(p);
        if (problem) { toast(problem, 'error'); return; }
        submitBtn.disabled = true;
        api.put('/me/business', p).then(function () {
          return api.post('/me/business/submit');
        }).then(function () {
          toast('Submitted for verification', 'success');
          load();
        }).catch(function (er) {
          submitBtn.disabled = false;
          toast(er.message, 'error');
        });
      });
    }
  };

  views.shopPage = function (params) {
    var html = '<div id="shop-page"><div class="spinner" style="margin-top:80px"></div></div>';
    return {
      html: html,
      mount: function () {
        api.get('/business/' + params.slug).then(function (d) {
          var b = d.business;
          setMeta(b.name + ' — Camera Shop on ' + siteName(), (b.description || b.name).slice(0, 160),
            location.origin + '/shop/' + b.slug, b.logo || '');
          var days = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
          var hoursHtml = days.map(function (dd) {
            return '<div class="spec-row"><span class="k">' + dd[1] + '</span><span class="v">' + esc((b.opening_hours || {})[dd[0]] || '—') + '</span></div>';
          }).join('');
          $('#shop-page').innerHTML = header(b.name, { heading: false }) +
            '<div class="hero-page" style="text-align:center">' +
            (b.logo ? '<img class="shop-logo" src="' + esc(b.logo) + '" alt="' + esc(b.name || 'Shop') + ' logo' + '">' : '<div style="width:76px;height:76px;margin:0 auto;border-radius:18px;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:34px">' + icon('briefcase-outline') + '</div>') +
            '<h1>' + esc(b.name) + '</h1>' +
            '<p>' + (b.verified ? icon('shield-checkmark') + ' Verified business · ' : '') + esc([b.city, b.province].filter(Boolean).join(', ') || 'Sri Lanka') + '</p>' +
            '<p style="margin-top:8px">' + starsHtml(d.rating ? d.rating.avg : 0, d.rating ? d.rating.count : 0) + '</p></div>' +
            (d.preview ? '<div class="detail-wrap" style="padding-top:0"><div class="info-card" style="padding:12px 14px;background:#FBF3E2;border-color:#F0E2C0">' +
              icon('hourglass-outline') + '<span class="fs13" style="color:#8A5A00;display:inline-flex;align-items:center;gap:8px"><b>This is a private preview.</b> Your shop is not public yet — it will appear in the shops directory with the verified badge once an admin approves it.</span></div></div>' : '') +
            '<div class="detail-wrap"><div class="section-head" style="margin-bottom:8px"><h2>' + icon('information-circle-outline') + 'About</h2></div>' +
            (b.description ? '<div class="info-card" style="padding:14px"><p style="font-size:13.5px;line-height:1.6">' + esc(b.description) + '</p></div>' : '') +
            '<div class="section-head" style="margin:14px 0 8px"><h2>' + icon('time-outline') + 'Opening hours</h2></div>' +
            '<div class="info-card">' + hoursHtml + '</div>' +
            '<div class="section-head" style="margin:14px 0 8px"><h2>' + icon('call-outline') + 'Contact</h2></div>' +
            '<div class="info-card">' +
            (b.phone ? '<div class="spec-row"><span class="k">Phone</span><span class="v">' + esc(b.phone) + '</span></div>' : '') +
            (b.area ? '<div class="spec-row"><span class="k">Address</span><span class="v">' + esc(b.area) + '</span></div>' : '') +
            '</div>' +
            '<div class="flex gap8 mt16">' +
            '<button class="btn btn-primary" data-call-shop="' + esc(b.phone || '') + '">' + icon('call-outline') + 'Call</button>' +
            '<button class="btn btn-wa" data-wa-shop="' + esc(b.whatsapp || b.phone || '') + '">' + icon('logo-whatsapp') + 'WhatsApp</button>' +
            '</div>' +
            '<div class="section-head" style="margin:18px 0 8px"><h2>' + icon('camera-outline') + 'Listings (' + (d.listings || []).length + ')</h2></div>' +
            '</div><div>' + listingGrid(d.listings) + '</div><div style="height:16px"></div>';
        }).catch(function (e) {
          var el = $('#shop-page');
          if (el) {
            el.innerHTML = header('Shop', {}) + errorHtml((e && e.message) || 'Could not load this shop.', 'Try again', 'storefront-outline');
            var btn = el.querySelector('[data-state-retry]');
            if (btn) btn.addEventListener('click', function () { render(); });
          }
        });
      }
    };
  };

  /* ============================================================
     Admin panel (Part 3)
     ============================================================ */
  var ADMIN_SECTIONS = [
    ['dashboard', 'Dashboard', 'speedometer-outline'],
    ['users', 'Users', 'people-outline'],
    ['listings', 'Listings', 'albums-outline'],
    ['businesses', 'Businesses', 'storefront-outline'],
    ['reports', 'Reports', 'flag-outline'],
    ['categories', 'Categories', 'layers-outline'],
    ['brands', 'Brands & Models', 'pricetag-outline'],
    ['locations', 'Locations', 'location-outline'],
    ['promotions', 'Promotions', 'flash-outline'],
    ['payments', 'Payments', 'card-outline'],
    ['posts', 'Blog Posts', 'reader-outline'],
    ['settings', 'Settings', 'settings-outline'],
    ['audit', 'Audit Log', 'clipboard-outline']
  ];

  function adminGuard() {
    if (!requireAuth()) return null;
    if (!state.user.is_admin) return null;
    return true;
  }

  function adminTabsInner(active) {
    return ADMIN_SECTIONS.map(function (s) {
      return '<a class="atab' + (s[0] === active ? ' active' : '') + '" data-atab="' + s[0] + '">' + icon(s[2]) + '<span>' + s[1] + '</span></a>';
    }).join('');
  }

  function adminTabsHtml(active) {
    return '<div class="admin-tabs">' + adminTabsInner(active) + '</div>';
  }

  function adminBody(html) {
    // Section views return inner content only; loadAdminSection() injects it
    // into the single #admin-body and refreshes the .admin-tabs bar.
    return html;
  }

  function bindAdminTabs() {
    $$('.admin-tabs .atab').forEach(function (a) {
      a.addEventListener('click', function () {
        $$('.admin-tabs .atab').forEach(function (x) { x.classList.remove('active'); });
        a.classList.add('active');
        var section = a.getAttribute('data-atab');
        var target = section === 'dashboard' ? '#/admin' : '#/admin/' + section;
        if (location.hash !== target) history.replaceState(null, '', target);
        loadAdminSection(section);
        window.scrollTo(0, 0);
      });
    });
  }

  function adminStatCards(cards) {
    return '<div class="admin-stats">' + cards.map(function (c) {
      return '<div class="astat"><div class="ico" style="color:' + c[2] + ';background:' + c[2] + '1a">' + icon(c[0]) + '</div>' +
        '<div><b>' + c[1] + '</b><span>' + esc(c[3]) + '</span></div></div>';
    }).join('') + '</div>';
  }

  function adminActionBar(leftHtml, rightHtml) {
    return '<div class="a-bar">' + (leftHtml || '') + (rightHtml || '') + '</div>';
  }

  function adminTable(headers, rowsHtml) {
    return '<div class="a-table-wrap"><table class="a-table"><thead><tr>' +
      headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + (rowsHtml || '') + '</tbody></table></div>';
  }

  function aChip(status, color) {
    return '<span class="status-chip" style="color:' + (color || '#74817C') + ';background:' + (color || '#74817C') + '1a">' + esc(status) + '</span>';
  }

  /**
   * Shared failure state for the admin panel. Every admin section's API
   * .catch() funnels through here so that:
   *   - a failed request shows WHICH section failed, with a Retry action —
   *     never a permanent spinner;
   *   - a rejected session (401: expired token or signed out elsewhere)
   *     offers a way back to sign-in instead of a dead-end error;
   *   - a container that no longer exists (the user navigated away before the
   *     request settled) is ignored instead of throwing a TypeError inside
   *     the catch handler and surfacing as an unhandled rejection.
   */
  function adminRenderError(el, e, section, retry) {
    if (!el) return;
    var label = ADMIN_SECTIONS.filter(function (s) { return s[0] === section; })[0];
    var heading = label ? 'Could not load the ' + label[1].toLowerCase() + ' section' : null;
    if (e && e.status === 401) {
      el.innerHTML = errorHtml('Your session has expired. Please sign in again to continue.',
        'Sign in', 'lock-closed-outline', heading || 'Session expired');
      var signin = el.querySelector('[data-state-retry]');
      if (signin) signin.addEventListener('click', function (ev) {
        ev.preventDefault();
        location.hash = '#/sign-in?next=' + encodeURIComponent(location.hash || '#/admin');
      });
      return;
    }
    var msg = (e && e.message) ? e.message : 'Something went wrong. Please try again.';
    el.innerHTML = errorHtml(msg, 'Retry', null, heading);
    var btn = el.querySelector('[data-state-retry]');
    if (btn) btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      if (retry) retry();
    });
  }

  var ADMIN_VIEWS = {};

  /* ----- Dashboard ----- */
  ADMIN_VIEWS.dashboard = function () {
    return {
      html: '<div class="spinner"></div>',
      mount: function () {
        api.get('/admin/dashboard').then(function (d) {
          var c = d.counts;
          var h = adminStatCards([
            ['people-outline', c.users, '#0E7C66', 'Total users'],
            ['albums-outline', c.active_listings, '#3A6FB0', 'Active listings'],
            ['hourglass-outline', c.pending_listings, '#C77D23', 'Pending review'],
            ['checkmark-circle-outline', c.sold_listings, '#0E7C66', 'Sold'],
            ['storefront-outline', c.shops, '#9C4F96', 'Camera shops'],
            ['shield-checkmark', c.shops_verified, '#0E7C66', 'Verified shops'],
            ['hourglass-outline', c.shops_pending, '#C77D23', 'Shops pending'],
            ['flag-outline', c.reports_open, '#E5484D', 'Open reports'],
            ['cash-outline', fmtLKR(c.revenue), '#F0A500', 'Revenue'],
            ['chatbubble-ellipses-outline', c.messages, '#5B6BB0', 'Messages']
          ]);
          h += '<div class="a-sec-head"><h3>' + icon('hourglass-outline') + 'Pending approval</h3></div>';
          var pend = d.pending || [];
          h += pend.length ? pend.map(function (l) {
            return '<div class="a-row">' +
              '<div class="a-thumb">' + (l.images && l.images[0] ? '<img src="' + esc(l.images[0]) + '" alt="' + esc(l.title || 'Listing') + '">' : icon('camera-outline')) + '</div>' +
              '<div class="a-main"><b>' + esc(l.title) + '</b><span>' + fmtLKR(l.price) + ' · ' + esc(l.category_name || '') + ' · ' + timeAgo(l.created_at) + '</span></div>' +
              '<div class="a-actions">' +
              '<button class="btn btn-primary btn-sm" data-mod="approve" data-lid="' + l.id + '">Approve</button>' +
              '<button class="btn btn-outline btn-sm" data-mod="reject" data-lid="' + l.id + '">Reject</button></div></div>';
          }).join('') : '<p class="muted fs12 pad16">No listings waiting for review.</p>';
          var pendBiz = d.pending_businesses || [];
          h += '<div class="a-sec-head"><h3>' + icon('storefront-outline') + 'Shop verification' +
            (c.shops_pending ? ' <span class="muted fs12">(' + c.shops_pending + ' pending)</span>' : '') + '</div>';
          h += pendBiz.length ? pendBiz.map(function (b) {
            return '<div class="a-row">' +
              '<div class="a-thumb">' + (b.logo ? '<img src="' + esc(b.logo) + '" alt="' + esc(b.name) + ' logo">' : icon('storefront-outline')) + '</div>' +
              '<div class="a-main"><b>' + esc(b.name) + '</b>' +
              '<span>' + esc(b.business_category || 'No category') + ' · ' + esc([b.city, b.district, b.province].filter(Boolean).join(', ') || 'No location') + '</span>' +
              '<span>Owner: ' + esc((b.owner && b.owner.name) || '—') + (b.owner && b.owner.phone ? ' · ' + esc(b.owner.phone) : '') + '</span></div>' +
              '<div class="a-actions">' +
              '<button class="btn btn-outline btn-sm" data-biz-view="' + b.id + '">Check details</button>' +
              '<button class="btn btn-primary btn-sm" data-bizmod="approve" data-bid="' + b.id + '">Approve</button>' +
              '<button class="btn btn-outline btn-sm" data-bizmod="reject" data-bid="' + b.id + '">Reject</button></div></div>';
          }).join('') : '<p class="muted fs12 pad16">No shops waiting for verification.</p>';
          h += '<div class="a-sec-head"><h3>' + icon('people-outline') + 'Newest users</h3></div>';
          h += adminTable(['Name', 'Email', 'Status', 'Joined'], (d.recent_users || []).map(function (u) {
            return '<tr><td>' + esc(u.name) + (u.seller_type === 'business' ? ' ' + aChip('Business', '#9C4F96') : '') +
              '</td><td>' + esc(u.email) + '</td><td>' + aChip(u.status, u.status === 'banned' ? '#E5484D' : u.status === 'suspended' ? '#C77D23' : '#0E7C66') + '</td><td>' + fmtDate(u.created_at) + '</td></tr>';
          }).join(''));
          h += '<div class="a-sec-head"><h3>' + icon('flag-outline') + 'Recent reports</h3></div>';
          h += (d.recent_reports || []).length ? adminTable(['Listing', 'Reason', 'Status'], d.recent_reports.map(function (r) {
            return '<tr><td>' + esc(r.listing_title || '—') + '</td><td>' + esc(r.reason) + '</td><td>' + aChip(r.status, r.status === 'open' ? '#C77D23' : '#0E7C66') + '</td></tr>';
          }).join('')) : '<p class="muted fs12 pad16">No reports.</p>';
          var body = $('#admin-body');
          if (body) {
            body.innerHTML = h;
            bindModeration(body);
            bindBusinessModeration(body);
            var tabs = $('.admin-tabs'); if (tabs) tabs.innerHTML = adminTabsInner('dashboard');
            bindAdminTabs();
          }
        }).catch(function (e) { adminRenderError($('#admin-body'), e, 'dashboard', function () { loadAdminSection('dashboard'); }); });
      }
    };
  };

  /* ----- Users ----- */
  ADMIN_VIEWS.users = function () {
    var html = adminActionBar(
      '<form class="a-search" id="au-search"><span>' + icon('search-outline') + '</span><input placeholder="Search name, email, phone…"></form>',
      '<select class="select" id="au-status" style="width:auto">' +
      ['all', 'active', 'suspended', 'banned'].map(function (s) { return '<option value="' + s + '">' + (s === 'all' ? 'All statuses' : s) + '</option>'; }).join('') + '</select>');
    html += '<div id="au-list"><div class="spinner"></div></div>';
    return {
      html: adminBody(html),
      mount: function () {
        function load() {
          var q = $('#au-search input').value.trim();
          var st = $('#au-status').value;
          api.get('/admin/users?q=' + encodeURIComponent(q) + '&status=' + st).then(function (users) {
            var el = $('#au-list');
            el.innerHTML = users.map(function (u) {
              return '<div class="a-row" data-nav="#/admin/users/' + u.id + '">' +
                avatarHtml(u, 'sm') +
                '<div class="a-main"><b>' + esc(u.name) + (u.is_admin ? ' <span class="vbadge">admin</span>' : '') + (u.verified ? ' ' + icon('shield-checkmark') : '') + '</b>' +
                '<span>' + esc(u.email) + ' · ' + u.listing_count + ' listings · joined ' + fmtDate(u.created_at) + '</span></div>' +
                aChip(u.status, u.status === 'banned' ? '#E5484D' : u.status === 'suspended' ? '#C77D23' : '#0E7C66') +
                '<span class="chev">' + icon('chevron-forward-outline') + '</span></div>';
            }).join('') || '<div class="empty"><p>No users found.</p></div>';
          }).catch(function (e) { adminRenderError($('#au-list'), e, 'users', load); });
        }
        load();
        $('#au-search').addEventListener('submit', function (e) { e.preventDefault(); load(); });
        $('#au-status').addEventListener('change', load);
      }
    };
  };

  ADMIN_VIEWS.userDetail = function (params) {
    var id = params.id;
    var html = '<div id="aud-root"><div class="spinner"></div></div>';
    return {
      html: adminBody(html),
      mount: function () {
        api.get('/admin/users/' + id).then(function (d) {
          // Named `activity` (not `act`): a local named `act` used to shadow
          // the global act() promise helper, so the Ban and Delete buttons
          // threw `TypeError: act is not a function` right after sending the
          // request — the user was banned/deleted server-side but the dialog
          // never confirmed and the detail view never re-rendered.
          var u = d.user, activity = d.activity, biz = d.business;
          var h = '<div class="a-sec-head"><h3>' + avatarHtml(u, 'lg') + ' <span style="margin-left:8px">' + esc(u.name) + '</span></h3></div>';
          h += '<div class="info-card">' +
            '<div class="spec-row"><span class="k">Email</span><span class="v">' + esc(u.email) + '</span></div>' +
            '<div class="spec-row"><span class="k">Phone</span><span class="v">' + esc(u.phone || '—') + '</span></div>' +
            '<div class="spec-row"><span class="k">WhatsApp</span><span class="v">' + esc(u.whatsapp || '—') + '</span></div>' +
            '<div class="spec-row"><span class="k">Location</span><span class="v">' + esc([u.city, u.district, u.province].filter(Boolean).join(', ') || '—') + '</span></div>' +
            '<div class="spec-row"><span class="k">Account type</span><span class="v">' + esc(u.seller_type || 'individual') + (biz ? ' — ' + esc(biz.name) : '') + '</span></div>' +
            '<div class="spec-row"><span class="k">Status</span><span class="v">' + aChip(u.status, u.status === 'banned' ? '#E5484D' : u.status === 'suspended' ? '#C77D23' : '#0E7C66') + '</span></div>' +
            '<div class="spec-row"><span class="k">Verified</span><span class="v">' + (u.verified ? 'Yes' : 'No') + ' · Email ' + (u.email_verified ? '✓' : '✗') + ' · Phone ' + (u.phone_verified ? '✓' : '✗') + '</span></div>' +
            '<div class="spec-row"><span class="k">Joined</span><span class="v">' + fmtDate(u.created_at) + '</span></div></div>';
          if (biz) {
            var bmeta = { not_submitted: ['Not submitted', '#74817C'], pending: ['Pending review', '#C77D23'], approved: ['Verified', '#0E7C66'], rejected: ['Rejected', '#E5484D'] }[biz.verification_status || 'not_submitted'] || ['Not submitted', '#74817C'];
            h += '<div class="a-sec-head"><h3>' + icon('storefront-outline') + 'Business / shop</h3></div>';
            h += '<div class="info-card">' +
              '<div class="spec-row"><span class="k">Shop</span><span class="v">' + esc(biz.name || '') + (biz.verified ? ' ' + icon('shield-checkmark') : '') + '</span></div>' +
              '<div class="spec-row"><span class="k">Verification</span><span class="v"><span class="status-chip" style="color:' + bmeta[1] + ';background:' + bmeta[1] + '1a">' + esc(bmeta[0]) + '</span></span></div>' +
              '<div class="spec-row"><span class="k">Category</span><span class="v">' + esc(biz.business_category || '—') + '</span></div>' +
              '<div class="spec-row"><span class="k">Owner</span><span class="v">' + esc(biz.owner_name || '—') + ' · ' + esc(biz.phone || '—') + '</span></div>' +
              '<div class="spec-row"><span class="k">Address</span><span class="v">' + esc([biz.area, biz.city, biz.district, biz.province].filter(Boolean).join(', ') || '—') + '</span></div>' +
              (biz.registration_number ? '<div class="spec-row"><span class="k">Reg. no.</span><span class="v">' + esc(biz.registration_number) + '</span></div>' : '') +
              (biz.rejection_reason ? '<div class="spec-row"><span class="k">Reason</span><span class="v" style="color:#C62828">' + esc(biz.rejection_reason) + '</span></div>' : '') +
              '</div>';
          }

          var acts = [['camera-outline', activity.listings, 'Listings'], ['heart-outline', activity.favorites, 'Favorites'], ['cash-outline', activity.offers_made, 'Offers made'], ['chatbubble-ellipses-outline', activity.messages_sent, 'Msgs sent'], ['flag-outline', activity.reports_against, 'Reports against'], ['card-outline', activity.payments, 'Payments']];
          h += '<div class="a-sec-head"><h3>' + icon('bar-chart-outline') + 'Activity</h3></div>' +
            '<div class="admin-stats">' + acts.map(function (c) { return '<div class="astat"><b>' + c[1] + '</b><span>' + esc(c[2]) + '</span></div>'; }).join('') + '</div>';

          h += '<div class="a-sec-head"><h3>' + icon('construct-outline') + 'Actions</h3></div>';
          h += '<div class="chips" style="padding:4px 16px 8px">';
          h += (u.verified ? '' : '<button class="btn btn-outline btn-sm" data-uact="verify">' + icon('shield-checkmark') + 'Verify</button>');
          h += (u.verified ? '<button class="btn btn-outline btn-sm" data-uact="unverify">Unverify</button>' : '');
          if (u.status !== 'suspended') h += '<button class="btn btn-outline btn-sm" data-uact="suspend">' + icon('pause-outline') + 'Suspend</button>';
          if (u.status !== 'banned' && !u.is_admin) h += '<button class="btn btn-danger btn-sm" data-uact="ban">' + icon('ban-outline') + 'Ban</button>';
          if (u.status !== 'active') h += '<button class="btn btn-primary btn-sm" data-uact="activate">' + icon('play-outline') + 'Activate</button>';
          if (!u.is_admin) h += '<button class="btn btn-danger btn-sm" data-uact="delete">' + icon('trash-outline') + 'Delete</button>';
          h += '</div>';

          h += '<div class="a-sec-head"><h3>' + icon('albums-outline') + 'Listings (' + (d.listings || []).length + ')</h3></div>';
          h += (d.listings || []).length ? d.listings.map(function (l) {
            return '<div class="a-row" data-nav="#/ads/' + l.id + '">' +
              '<div class="a-thumb">' + (l.images && l.images[0] ? '<img src="' + esc(l.images[0]) + '" alt="' + esc(l.title || 'Listing') + '">' : icon('camera-outline')) + '</div>' +
              '<div class="a-main"><b>' + esc(l.title) + '</b><span>' + fmtLKR(l.price) + ' · ' + l.views + ' views</span></div>' +
              statusChip(l.status) + '<span class="chev">' + icon('chevron-forward-outline') + '</span></div>';
          }).join('') : '<p class="muted fs12 pad16">No listings.</p>';

          $('#aud-root').innerHTML = h + '<div style="height:12px"></div>';
          $$('#aud-root [data-uact]').forEach(function (b) {
            b.addEventListener('click', function () {
              var act2 = b.getAttribute('data-uact');
              if (act2 === 'delete') {
                openDialog('Delete user', '<p>This permanently removes <b>' + esc(u.name) + '</b> and all their data. This cannot be undone.</p>', 'Delete', true, function () {
                  act(api.del('/admin/users/' + id), 'User deleted', function () { closeDialog(); location.hash = '#/admin/users'; });
                });
                return;
              }
              if (act2 === 'ban') {
                openDialog('Ban user', '<p>Ban <b>' + esc(u.name) + '</b>? Their listings will be paused and their email blocked from registering.</p>', 'Ban', true, function () {
                  act(api.patch('/admin/users/' + id, { action: 'ban' }), 'User banned', function () { closeDialog(); ADMIN_VIEWS.userDetail(params).mount(); });
                });
                return;
              }
              api.patch('/admin/users/' + id, { action: act2 }).then(function () {
                toast('User updated', 'success');
                ADMIN_VIEWS.userDetail(params).mount();
              }).catch(function (e) { toast(e.message, 'error'); });
            });
          });
        }).catch(function (e) { adminRenderError($('#aud-root'), e, 'users', function () { loadAdminSection('users', params); }); });
      }
    };
  };

  /* ----- Listings moderation ----- */
  function bindModeration(root) {
    $$('[data-mod]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var lid = b.getAttribute('data-lid');
        // `mod` (not `act`) so the global act() helper cannot be shadowed here.
        var mod = b.getAttribute('data-mod');
        if (mod === 'delete') {
          openDialog('Delete listing', '<p>Permanently delete this fake or unsafe listing? Its stored listing images will also be removed.</p>',
            'Delete listing', true, function () {
              api.del('/listings/' + lid).then(function () {
                closeDialog(); toast('Listing deleted', 'success'); loadAdminSection('listings');
              }).catch(function (e) { toast(e.message, 'error'); });
            });
          return;
        }
        if (mod === 'reject') {
          openDialog('Reject listing', '<p>Send the seller a reason for the rejection.</p><div class="form-group mt16"><label>Reason</label>' +
            '<textarea class="textarea" id="reject-reason" style="min-height:70px" placeholder="e.g. Missing photos / not enough details"></textarea></div>',
            'Reject', true, function () {
              api.post('/admin/listings/' + lid + '/moderate', { action: 'reject', reason: $('#reject-reason').value }).then(function () {
                closeDialog(); toast('Listing rejected', 'success'); loadAdminSection('listings');
              }).catch(function (e) { toast(e.message, 'error'); });
            });
          return;
        }
        api.post('/admin/listings/' + lid + '/moderate', { action: mod }).then(function () {
          toast('Listing ' + mod.replace('_', ' '), 'success');
          loadAdminSection('listings');
        }).catch(function (e) { toast(e.message, 'error'); });
      });
    });
  }

  function openAdminBusinessDetails(bid, reload) {
    api.get('/admin/businesses/' + bid).then(function (b) {
      var owner = b.owner || {};
      var hours = b.opening_hours || {};
      var hourRows = Object.keys(hours).map(function (day) {
        return '<div class="spec-row"><span class="k">' + esc(day.charAt(0).toUpperCase() + day.slice(1)) +
          '</span><span class="v">' + esc(hours[day] || '—') + '</span></div>';
      }).join('');
      var html = (b.logo ? '<img src="' + esc(b.logo) + '" alt="' + esc(b.name) + ' logo" style="width:88px;height:88px;object-fit:cover;border-radius:16px;margin-bottom:12px">' : '') +
        '<div class="info-card">' +
        '<div class="spec-row"><span class="k">Shop</span><span class="v">' + esc(b.name || '—') + '</span></div>' +
        '<div class="spec-row"><span class="k">Category</span><span class="v">' + esc(b.business_category || '—') + '</span></div>' +
        '<div class="spec-row"><span class="k">Description</span><span class="v">' + esc(b.description || '—') + '</span></div>' +
        '<div class="spec-row"><span class="k">Owner</span><span class="v">' + esc(owner.name || b.owner_name || '—') + '</span></div>' +
        '<div class="spec-row"><span class="k">Owner email</span><span class="v">' + esc(owner.email || '—') + '</span></div>' +
        '<div class="spec-row"><span class="k">Owner phone</span><span class="v">' + esc(owner.phone || '—') + '</span></div>' +
        '<div class="spec-row"><span class="k">Shop phone</span><span class="v">' + esc(b.phone || '—') + '</span></div>' +
        '<div class="spec-row"><span class="k">WhatsApp</span><span class="v">' + esc(b.whatsapp || owner.whatsapp || '—') + '</span></div>' +
        '<div class="spec-row"><span class="k">Address</span><span class="v">' + esc([b.area, b.city, b.district, b.province].filter(Boolean).join(', ') || '—') + '</span></div>' +
        '<div class="spec-row"><span class="k">Registration no.</span><span class="v">' + esc(b.registration_number || 'Not provided') + '</span></div>' +
        '<div class="spec-row"><span class="k">Listings</span><span class="v">' + (b.listings || []).length + '</span></div>' +
        '<div class="spec-row"><span class="k">Submitted</span><span class="v">' + (b.submitted_at ? fmtDate(b.submitted_at) : 'Not submitted') + '</span></div>' +
        '</div>' +
        (hourRows ? '<h3 style="margin:16px 0 8px">Opening hours</h3><div class="info-card">' + hourRows + '</div>' : '') +
        '<div class="flex" style="gap:8px;flex-wrap:wrap;margin-top:14px">' +
        '<button class="btn btn-outline btn-sm" id="admin-message-owner">' + icon('chatbubble-ellipses-outline') + 'Message owner</button>' +
        (b.verification_status === 'approved'
          ? '<button class="btn btn-outline btn-sm" id="admin-pin-shop">' + icon('pin-outline') + (b.pinned ? 'Unpin shop' : 'Pin shop to top') + '</button>'
          : '') + '</div>';
      openDialog('Check shop details', html, 'Close', false, closeDialog);
      var message = $('#admin-message-owner');
      if (message) message.addEventListener('click', function () {
        closeDialog(); location.hash = '#/chat/' + owner.id;
      });
      var pin = $('#admin-pin-shop');
      if (pin) pin.addEventListener('click', function () {
        api.post('/admin/businesses/' + bid + '/moderate', { action: b.pinned ? 'unpin' : 'pin' }).then(function () {
          closeDialog(); toast(b.pinned ? 'Shop unpinned' : 'Shop pinned to top', 'success');
          if (reload) reload();
        }).catch(function (e) { toast(e.message, 'error'); });
      });
    }).catch(function (e) { toast(e.message, 'error'); });
  }

  /* Approve / reject shop verification from any admin surface (dashboard). */
  function bindBusinessModeration(root) {
    $$('[data-biz-view]', root).forEach(function (button) {
      button.addEventListener('click', function () {
        openAdminBusinessDetails(button.getAttribute('data-biz-view'), function () { loadAdminSection('dashboard'); });
      });
    });
    $$('[data-bizmod]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var bid = b.getAttribute('data-bid');
        var m = b.getAttribute('data-bizmod');
        if (m === 'reject') {
          openDialog('Reject shop verification', '<p>Send the owner a reason. They can fix the details and resubmit from My Shop.</p>' +
            '<div class="form-group mt16"><label>Reason</label>' +
            '<textarea class="textarea" id="dash-biz-reason" style="min-height:70px" placeholder="e.g. Document does not match the shop name"></textarea></div>',
            'Reject', true, function () {
              api.post('/admin/businesses/' + bid + '/moderate', { action: 'reject', reason: $('#dash-biz-reason').value }).then(function () {
                closeDialog(); toast('Shop verification rejected', 'success'); loadAdminSection('dashboard');
              }).catch(function (e) { toast(e.message, 'error'); });
            });
          return;
        }
        api.post('/admin/businesses/' + bid + '/moderate', { action: 'approve' }).then(function () {
          toast('Shop approved & verified', 'success'); loadAdminSection('dashboard');
        }).catch(function (e) { toast(e.message, 'error'); });
      });
    });
  }

  ADMIN_VIEWS.listings = function () {
    var html = adminActionBar(
      '<form class="a-search" id="al-search"><span>' + icon('search-outline') + '</span><input placeholder="Search title, brand, model…"></form>',
      '<select class="select" id="al-status" style="width:auto">' +
      ['all', 'pending', 'active', 'rejected', 'paused', 'sold', 'expired', 'draft'].map(function (s) {
        return '<option value="' + s + '">' + (s === 'all' ? 'All statuses' : s) + '</option>';
      }).join('') + '</select>');
    html += '<div id="al-list"><div class="spinner"></div></div>';
    return {
      html: adminBody(html),
      mount: function () {
        function load() {
          var q = $('#al-search input').value.trim();
          var st = $('#al-status').value;
          api.get('/admin/listings?q=' + encodeURIComponent(q) + '&status=' + st).then(function (items) {
            var el = $('#al-list');
            el.innerHTML = items.map(function (l) {
              var actions = '';
              if (l.status === 'pending') {
                actions += '<button class="btn btn-primary btn-sm" data-mod="approve" data-lid="' + l.id + '">Approve</button>' +
                  '<button class="btn btn-outline btn-sm" data-mod="reject" data-lid="' + l.id + '">Reject</button>';
              }
              if (l.status === 'active') {
                actions += '<button class="btn btn-outline btn-sm" data-mod="suspend" data-lid="' + l.id + '">Suspend</button>' +
                  '<button class="btn btn-outline btn-sm" data-mod="mark_sold" data-lid="' + l.id + '">Sold</button>' +
                  (l.featured ? '<button class="btn btn-outline btn-sm" data-mod="unfeature" data-lid="' + l.id + '">Unfeature</button>'
                    : '<button class="btn btn-accent btn-sm" data-mod="feature" data-lid="' + l.id + '">Feature</button>');
              }
              if (l.status === 'paused') {
                actions += '<button class="btn btn-primary btn-sm" data-mod="approve" data-lid="' + l.id + '">Activate</button>';
              }
              actions += '<button class="btn btn-outline btn-sm" data-nav="#/ads/' + l.id + '">View</button>' +
                '<button class="btn btn-danger btn-sm" data-mod="delete" data-lid="' + l.id + '">Delete</button>';
              return '<div class="a-row">' +
                '<div class="a-thumb">' + (l.images && l.images[0] ? '<img src="' + esc(l.images[0]) + '" alt="' + esc(l.title || 'Listing') + '">' : icon('camera-outline')) + '</div>' +
                '<div class="a-main"><b>' + esc(l.title) + '</b>' +
                '<span>' + fmtLKR(l.price) + ' · ' + esc((l.seller && l.seller.name) || '') + ' · ' + l.views + ' views</span>' +
                (l.rejection_reason ? '<span class="muted fs12" style="color:#C62828">' + icon('alert-circle-outline') + ' ' + esc(l.rejection_reason) + '</span>' : '') + '</div>' +
                statusChip(l.status) +
                '<div class="a-actions" style="flex-wrap:wrap;justify-content:flex-end">' + actions + '</div></div>';
            }).join('') || '<div class="empty"><p>No listings found.</p></div>';
            bindModeration(el);
          }).catch(function (e) { adminRenderError($('#al-list'), e, 'listings', load); });
        }
        load();
        $('#al-search').addEventListener('submit', function (e) { e.preventDefault(); load(); });
        $('#al-status').addEventListener('change', load);
      }
    };
  };

  /* ----- Businesses (shop verification) ----- */
  var BIZ_STATUS_META = {
    not_submitted: ['Not submitted', '#74817C'],
    pending: ['Pending review', '#C77D23'],
    approved: ['Verified', '#0E7C66'],
    rejected: ['Rejected', '#E5484D']
  };
  function bizStatusChip(st) {
    var m = BIZ_STATUS_META[st] || BIZ_STATUS_META.not_submitted;
    return '<span class="status-chip" style="color:' + m[1] + ';background:' + m[1] + '1a">' + esc(m[0]) + '</span>';
  }
  ADMIN_VIEWS.businesses = function () {
    var html = adminActionBar('',
      '<select class="select" id="ab-status" style="width:auto">' +
      ['pending', 'all', 'not_submitted', 'approved', 'rejected'].map(function (s) {
        return '<option value="' + s + '">' + (BIZ_STATUS_META[s] ? BIZ_STATUS_META[s][0] : 'All') + (s === 'all' ? '' : '') + '</option>';
      }).join('') + '</select>');
    html += '<div id="ab-list"><div class="spinner"></div></div>';
    return {
      html: adminBody(html),
      mount: function () {
        function moderate(bid, action, label, needReason) {
          if (action === 'pin' || action === 'unpin') {
            api.post('/admin/businesses/' + bid + '/moderate', { action: action }).then(function () {
              toast(action === 'pin' ? 'Shop pinned to top' : 'Shop unpinned', 'success'); load();
            }).catch(function (e) { toast(e.message, 'error'); });
            return;
          }
          if (needReason) {
            openDialog(label, '<p>Send the owner a reason. They can fix the details and resubmit from My Shop.</p>' +
              '<div class="form-group mt16"><label>Reason</label>' +
              '<textarea class="textarea" id="biz-reject-reason" style="min-height:70px" placeholder="e.g. Document unreadable / does not match the shop name"></textarea></div>',
              label, true, function () {
                api.post('/admin/businesses/' + bid + '/moderate', { action: action, reason: $('#biz-reject-reason').value }).then(function () {
                  closeDialog(); toast(label + ' — done', 'success'); load();
                }).catch(function (e) { toast(e.message, 'error'); });
              });
            return;
          }
          openDialog(label, '<p>This immediately ' + (action === 'approve' ? 'publishes the shop with the verified badge' : 'removes the verified badge and hides the shop from the public directory') + '. The owner is notified.</p>',
            label, action === 'revoke', function () {
              api.post('/admin/businesses/' + bid + '/moderate', { action: action }).then(function () {
                closeDialog(); toast('Shop updated', 'success'); load();
              }).catch(function (e) { toast(e.message, 'error'); });
            });
        }
        function load() {
          api.get('/admin/businesses?status=' + $('#ab-status').value).then(function (rows) {
            var el = $('#ab-list');
            el.innerHTML = rows.map(function (b) {
              var actions = '';
              if (b.verification_status === 'pending') {
                actions += '<button class="btn btn-primary btn-sm" data-biz-act="approve" data-bid="' + b.id + '">Approve</button>' +
                  '<button class="btn btn-outline btn-sm" data-biz-act="reject" data-bid="' + b.id + '">Reject</button>';
              }
              if (b.verification_status === 'approved') {
                actions += '<button class="btn btn-outline btn-sm" data-biz-act="revoke" data-bid="' + b.id + '">Revoke</button>' +
                  '<button class="btn btn-outline btn-sm" data-biz-act="' + (b.pinned ? 'unpin' : 'pin') + '" data-bid="' + b.id + '">' +
                  icon('pin-outline') + (b.pinned ? 'Unpin' : 'Pin to top') + '</button>';
              }
              if (b.verification_status === 'rejected' || b.verification_status === 'not_submitted') {
                actions += '<button class="btn btn-outline btn-sm" data-nav="#/admin/users/' + b.user_id + '">Owner</button>';
              }
              actions += '<button class="btn btn-outline btn-sm" data-biz-view="' + b.id + '">Check details</button>' +
                '<button class="btn btn-outline btn-sm" data-nav="#/chat/' + b.user_id + '">Message owner</button>' +
                '<button class="btn btn-outline btn-sm" data-nav="#/shop/' + esc(b.slug) + '">View</button>';
              return '<div class="a-row">' +
                '<div class="a-thumb">' + (b.logo ? '<img src="' + esc(b.logo) + '" alt="' + esc(b.name) + ' logo">' : icon('storefront-outline')) + '</div>' +
                '<div class="a-main"><b>' + esc(b.name) + (b.verified ? ' ' + icon('shield-checkmark') : '') + '</b>' +
                '<span>' + esc(b.business_category || 'No category') + ' · ' + esc([b.city, b.district, b.province].filter(Boolean).join(', ') || 'No location') + '</span>' +
                '<span>Owner: ' + esc((b.owner && b.owner.name) || '—') + (b.owner && b.owner.email ? ' · ' + esc(b.owner.email) : '') + (b.owner && b.owner.phone ? ' · ' + esc(b.owner.phone) : '') + '</span>' +
                (b.rejection_reason ? '<span class="muted fs12" style="color:#C62828">' + icon('alert-circle-outline') + ' ' + esc(b.rejection_reason) + '</span>' : '') + '</div>' +
                '<div class="a-side">' + bizStatusChip(b.verification_status) +
'</div>' +
                '<div class="a-actions" style="flex-wrap:wrap;justify-content:flex-end">' + actions + '</div></div>';
            }).join('') || '<div class="empty"><p>No shops in this state yet.</p></div>';
            $$('#ab-list [data-biz-view]').forEach(function (button) {
              button.addEventListener('click', function () {
                openAdminBusinessDetails(button.getAttribute('data-biz-view'), load);
              });
            });
            $$('#ab-list [data-biz-act]').forEach(function (b2) {
              b2.addEventListener('click', function () {
                moderate(b2.getAttribute('data-bid'), b2.getAttribute('data-biz-act'),
                  b2.getAttribute('data-biz-act') === 'approve' ? 'Approve shop'
                    : b2.getAttribute('data-biz-act') === 'reject' ? 'Reject shop'
                      : b2.getAttribute('data-biz-act') === 'pin' ? 'Pin shop to top'
                        : b2.getAttribute('data-biz-act') === 'unpin' ? 'Unpin shop' : 'Revoke verification',
                  b2.getAttribute('data-biz-act') === 'reject' || b2.getAttribute('data-biz-act') === 'revoke');
              });
            });
          }).catch(function (e) { adminRenderError($('#ab-list'), e, 'businesses', load); });
        }
        load();
        $('#ab-status').addEventListener('change', load);
      }
    };
  };

  /* ----- Reports ----- */
  ADMIN_VIEWS.reports = function () {
    var html = adminActionBar('',
      '<select class="select" id="ar-status" style="width:auto">' +
      '<option value="all">All statuses</option><option value="open">Open</option><option value="resolved">Resolved</option></select>');
    html += '<div id="ar-list"><div class="spinner"></div></div>';
    return {
      html: adminBody(html),
      mount: function () {
        function load() {
          api.get('/admin/reports?status=' + $('#ar-status').value).then(function (rows) {
            var el = $('#ar-list');
            el.innerHTML = rows.map(function (r) {
              return '<div class="a-row">' +
                '<div class="a-main"><b>' + esc(r.reason || 'Report') + '</b>' +
                '<span>Listing: ' + esc(r.listing_title || '(removed)') + ' · by ' + esc(r.reporter_name || 'anonymous') + ' · ' + timeAgo(r.created_at) + '</span>' +
                (r.resolution ? '<span class="muted fs12">Resolution: ' + esc(r.resolution) + '</span>' : '') + '</div>' +
                aChip(r.status, r.status === 'open' ? '#C77D23' : '#0E7C66') +
                (r.status === 'open' ? '<button class="btn btn-primary btn-sm" data-resolve="' + r.id + '">Resolve</button>' : '') +
                '</div>';
            }).join('') || '<div class="empty"><p>No reports.</p></div>';
            $$('#ar-list [data-resolve]').forEach(function (b) {
              b.addEventListener('click', function () {
                var rid = b.getAttribute('data-resolve');
                openDialog('Resolve report', '<div class="form-group"><label>Resolution note</label>' +
                  '<textarea class="textarea" id="res-note" style="min-height:60px" placeholder="e.g. Reviewed and removed the listing"></textarea></div>' +
                  '<div class="form-group"><label>Action</label><select class="select" id="res-action">' +
                  '<option value="none">No further action</option>' +
                  '<option value="remove_listing">Remove the listing</option>' +
                  '<option value="suspend_seller">Suspend the seller</option></select></div>',
                  'Resolve', false, function () {
                    api.post('/admin/reports/' + rid + '/resolve', { resolution: $('#res-note').value, action: $('#res-action').value }).then(function () {
                      closeDialog(); toast('Report resolved', 'success'); load();
                    }).catch(function (e) { toast(e.message, 'error'); });
                  });
              });
            });
          }).catch(function (e) { adminRenderError($('#ar-list'), e, 'reports', load); });
        }
        load();
        $('#ar-status').addEventListener('change', load);
      }
    };
  };

  /* ----- Categories ----- */
  function fieldRowHtml(f, i) {
    return '<div class="field-row" data-fidx="' + i + '">' +
      '<input class="input" data-f="name" placeholder="field_key" value="' + esc(f.name || '') + '">' +
      '<input class="input" data-f="label" placeholder="Label" value="' + esc(f.label || '') + '">' +
      '<select class="select" data-f="type">' + ['text', 'select', 'number', 'textarea'].map(function (t) {
        return '<option value="' + t + '"' + ((f.type || 'text') === t ? ' selected' : '') + '>' + t + '</option>';
      }).join('') + '</select>' +
      '<label class="switch" style="margin:0"><input type="checkbox" data-f="required"' + (f.required ? ' checked' : '') + '><span class="slider"></span></label>' +
      (f.type === 'select' ? '<input class="input" data-f="options" placeholder="opt1, opt2" value="' + esc((f.options || []).join(', ')) + '">' : '') +
      '<button class="btn btn-danger btn-sm" data-field-del="' + i + '">' + icon('trash-outline') + '</button></div>';
  }

  function openCategoryFields(cat) {
    var fields = (cat.fields || []).slice();
    function render() {
      var list = $('#cf-list');
      list.innerHTML = fields.map(fieldRowHtml).join('') || '<p class="muted fs12">No fields yet.</p>';
      $$('#cf-list [data-field-del]').forEach(function (b) {
        b.addEventListener('click', function () { fields.splice(parseInt(b.getAttribute('data-field-del'), 10), 1); render(); });
      });
      $$('#cf-list [data-f="type"]').forEach(function (s) {
        s.addEventListener('change', function () {
          var row = s.closest('.field-row');
          var idx = parseInt(row.getAttribute('data-fidx'), 10);
          fields[idx].type = s.value;
          render();
        });
      });
    }
    openDialog('Edit fields — ' + cat.name,
      '<p class="form-hint">Fields drive the listing form for this category. Use select + options for dropdowns.</p>' +
      '<div class="form-group"><label>Fields</label><div id="cf-list"></div>' +
      '<button class="btn btn-outline btn-sm" id="cf-add" type="button" style="margin-top:8px">' + icon('add-outline') + 'Add field</button></div>',
      'Save fields', false, function () {
        var out = [];
        $$('#cf-list .field-row').forEach(function (row) {
          var f = {};
          var n = row.querySelector('[data-f="name"]').value.trim();
          var lb = row.querySelector('[data-f="label"]').value.trim();
          if (!n && !lb) return;
          f.name = n || slugify(lb); f.label = lb || n;
          f.type = row.querySelector('[data-f="type"]').value;
          f.required = row.querySelector('[data-f="required"]').checked;
          var opt = row.querySelector('[data-f="options"]');
          if (f.type === 'select' && opt) f.options = opt.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
          out.push(f);
        });
        api.patch('/admin/categories/' + cat.id, { fields: out }).then(function () {
          closeDialog(); toast('Fields saved', 'success'); refreshMeta();
        }).catch(function (e) { toast(e.message, 'error'); });
      });
    render();
    $('#cf-add').addEventListener('click', function () { fields.push({ name: '', label: '', type: 'text', required: false, options: [] }); render(); });
  }

  function refreshMeta() {
    api.get('/meta').then(function (d) { state.meta = d; }).catch(logNonCritical('metadata refresh'));
  }

  ADMIN_VIEWS.categories = function () {
    var html = '<div id="ac-list"><div class="spinner"></div></div>';
    return {
      html: adminBody(html),
      mount: function () {
        function load() {
          api.get('/meta').then(function (meta) {
            var cats = meta.categories;
            var el = $('#ac-list');
            var h = adminActionBar('',
              '<button class="btn btn-primary btn-sm" id="ac-add-top">' + icon('add-outline') + 'Add category</button>');
            cats.forEach(function (c) {
              h += '<div class="a-cat">' +
                '<div class="a-cat-head"><span class="ri-icon" style="background:#0E7C661a;color:#0E7C66">' + icon(c.icon || 'layers-outline') + '</span>' +
                '<div class="a-main"><b>' + esc(c.name) + '</b><span>' + (c.children || []).length + ' subcategories</span></div>' +
                '<button class="btn btn-outline btn-sm" data-cat-edit="' + c.id + '" data-cat-name="' + esc(c.name) + '">' + icon('create-outline') + '</button>' +
                '<button class="btn btn-outline btn-sm" data-cat-fields="' + c.id + '" data-cat-name="' + esc(c.name) + '" data-cat-fieldsjson=\'' + esc(JSON.stringify(c.fields || [])) + '\'>' + icon('list-outline') + '</button>' +
                '<button class="btn btn-outline btn-sm" data-cat-addchild="' + c.id + '" data-cat-name="' + esc(c.name) + '">' + icon('add-outline') + '</button>' +
                '<button class="btn btn-danger btn-sm" data-cat-del="' + c.id + '">' + icon('trash-outline') + '</button></div>';
              (c.children || []).forEach(function (s) {
                h += '<div class="a-sub">' + icon('chevron-forward-outline') + esc(s.name) +
                  '<span class="spacer"></span>' +
                  '<button class="btn btn-outline btn-sm" data-cat-edit="' + s.id + '" data-cat-name="' + esc(s.name) + '">' + icon('create-outline') + '</button>' +
                  '<button class="btn btn-outline btn-sm" data-cat-fields="' + s.id + '" data-cat-name="' + esc(s.name) + '" data-cat-fieldsjson=\'' + esc(JSON.stringify(s.fields || [])) + '\'>' + icon('list-outline') + '</button>' +
                  '<button class="btn btn-danger btn-sm" data-cat-del="' + s.id + '">' + icon('trash-outline') + '</button></div>';
              });
              h += '</div>';
            });
            el.innerHTML = h;
            $('#ac-add-top').addEventListener('click', function () {
              openDialog('Add category', '<div class="form-group"><label>Name</label><input class="input" id="ac-name" placeholder="e.g. Film Cameras"></div>' +
                '<div class="form-group"><label>Icon (ionicon name)</label><input class="input" id="ac-icon" value="layers-outline"></div>',
                'Add', false, function () {
                  api.post('/admin/categories', { name: $('#ac-name').value, icon: $('#ac-icon').value }).then(function () {
                    closeDialog(); toast('Category added', 'success'); refreshMeta(); load();
                  }).catch(function (e) { toast(e.message, 'error'); });
                });
            });
            $$('#ac-list [data-cat-addchild]').forEach(function (b) {
              b.addEventListener('click', function () {
                var pid = b.getAttribute('data-cat-addchild');
                var pname = b.getAttribute('data-cat-name');
                openDialog('Add subcategory to ' + pname, '<div class="form-group"><label>Name</label><input class="input" id="ac-name" placeholder="e.g. Medium Format"></div>',
                  'Add', false, function () {
                    api.post('/admin/categories', { name: $('#ac-name').value, parent_id: parseInt(pid, 10) }).then(function () {
                      closeDialog(); toast('Subcategory added', 'success'); refreshMeta(); load();
                    }).catch(function (e) { toast(e.message, 'error'); });
                  });
              });
            });
            $$('#ac-list [data-cat-edit]').forEach(function (b) {
              b.addEventListener('click', function () {
                var cid = b.getAttribute('data-cat-edit');
                var cname = b.getAttribute('data-cat-name');
                openDialog('Rename category', '<div class="form-group"><label>Name</label><input class="input" id="ac-name" value="' + esc(cname) + '"></div>',
                  'Save', false, function () {
                    api.patch('/admin/categories/' + cid, { name: $('#ac-name').value }).then(function () {
                      closeDialog(); toast('Category updated', 'success'); refreshMeta(); load();
                    }).catch(function (e) { toast(e.message, 'error'); });
                  });
              });
            });
            $$('#ac-list [data-cat-fields]').forEach(function (b) {
              b.addEventListener('click', function () {
                openCategoryFields({
                  id: parseInt(b.getAttribute('data-cat-fields'), 10),
                  name: b.getAttribute('data-cat-name'),
                  fields: JSON.parse(b.getAttribute('data-cat-fieldsjson'))
                });
              });
            });
            $$('#ac-list [data-cat-del]').forEach(function (b) {
              b.addEventListener('click', function () {
                var cid = b.getAttribute('data-cat-del');
                openDialog('Delete category', '<p>This removes the category and its subcategories. Listings are also removed.</p>', 'Delete', true, function () {
                  api.del('/admin/categories/' + cid).then(function () { closeDialog(); toast('Category deleted', 'success'); refreshMeta(); load(); })
                    .catch(function (e) { toast(e.message, 'error'); });
                });
              });
            });
          }).catch(function (e) { adminRenderError($('#ac-list'), e, 'categories', load); });
        }
        load();
      }
    };
  };

  /* ----- Brands & models ----- */
  ADMIN_VIEWS.brands = function () {
    var html = adminActionBar('',
      '<button class="btn btn-primary btn-sm" id="ab-add">' + icon('add-outline') + 'Add brand</button>');
    html += '<div id="ab-list"><div class="spinner"></div></div>';
    return {
      html: adminBody(html),
      mount: function () {
        function load() {
          api.get('/admin/brands').then(function (brands) {
            var el = $('#ab-list');
            el.innerHTML = brands.map(function (b) {
              var models = (b.models || []).map(function (m) {
                return '<span class="chip">' + esc(m.name) + ' <a data-model-del="' + m.id + '">' + icon('close-outline') + '</a></span>';
              }).join('');
              return '<div class="a-cat"><div class="a-cat-head">' +
                '<div class="a-main"><b>' + esc(b.name) + '</b><span>' + esc(b.category || '') + ' · ' + (b.models || []).length + ' models</span></div>' +
                '<button class="btn btn-outline btn-sm" data-brand-del="' + b.id + '">' + icon('trash-outline') + '</button></div>' +
                '<div class="chips" style="padding:6px 16px 10px">' + (models || '<span class="muted fs12">No models</span>') + '</div>' +
                '<div class="flex gap8" style="padding:0 16px 12px">' +
                '<input class="input" data-model-name="' + b.id + '" placeholder="Add model…">' +
                '<button class="btn btn-outline btn-sm" data-model-add="' + b.id + '">Add</button></div></div>';
            }).join('') || '<div class="empty"><p>No brands yet.</p></div>';
            $('#ab-add').addEventListener('click', function () {
              openDialog('Add brand', '<div class="form-group"><label>Name</label><input class="input" id="ab-name"></div>' +
                '<div class="form-group"><label>Category</label><input class="input" id="ab-cat" placeholder="e.g. Cameras"></div>',
                'Add', false, function () {
                  api.post('/admin/brands', { name: $('#ab-name').value, category: $('#ab-cat').value }).then(function () {
                    closeDialog(); toast('Brand added', 'success'); refreshMeta(); load();
                  }).catch(function (e) { toast(e.message, 'error'); });
                });
            });
            $$('#ab-list [data-brand-del]').forEach(function (b) {
              b.addEventListener('click', function () {
                act(api.del('/admin/brands/' + b.getAttribute('data-brand-del')), 'Brand deleted', function () { refreshMeta(); load(); });
              });
            });
            $$('#ab-list [data-model-add]').forEach(function (b) {
              b.addEventListener('click', function () {
                var bid = b.getAttribute('data-model-add');
                var inp = document.querySelector('[data-model-name="' + bid + '"]');
                var name = inp.value.trim();
                if (!name) return toast('Enter a model name', 'error');
                act(api.post('/admin/models', { brand_id: parseInt(bid, 10), name: name }), 'Model added', function () { load(); });
              });
            });
            $$('#ab-list [data-model-del]').forEach(function (a) {
              a.addEventListener('click', function (e) {
                e.preventDefault(); e.stopPropagation();
                act(api.del('/admin/models/' + a.getAttribute('data-model-del')), 'Model deleted', function () { load(); });
              });
            });
          }).catch(function (e) { adminRenderError($('#ab-list'), e, 'brands', load); });
        }
        load();
      }
    };
  };

  /* ----- Locations ----- */
  ADMIN_VIEWS.locations = function () {
    var html = '<div id="aloc-list"><div class="spinner"></div></div>';
    return {
      html: adminBody(html),
      mount: function () {
        api.get('/locations').then(function (provs) {
          var el = $('#aloc-list');
          var h = '<div class="form-card" style="margin:16px">' +
            '<div class="section-head"><h3>' + icon('add-circle-outline') + 'Add location data</h3></div>' +
            '<div class="form-group"><label>Province</label><input class="input" id="loc-prov" placeholder="e.g. Western Province"></div>' +
            '<div class="form-group"><label>District (choose province)</label><div class="flex gap8">' +
            '<select class="select" id="loc-prov-sel">' + provs.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + '</option>'; }).join('') + '</select>' +
            '<input class="input" id="loc-dist" placeholder="District name"></div></div>' +
            '<div class="form-group"><label>City (choose district)</label><div class="flex gap8">' +
            '<select class="select" id="loc-dist-sel"><option value="">—</option></select>' +
            '<input class="input" id="loc-city" placeholder="City name"></div></div>' +
            '<div class="flex gap8">' +
            '<button class="btn btn-primary btn-sm" id="loc-add-prov">Add province</button>' +
            '<button class="btn btn-outline btn-sm" id="loc-add-dist">Add district</button>' +
            '<button class="btn btn-outline btn-sm" id="loc-add-city">Add city</button></div></div>';
          provs.forEach(function (p) {
            h += '<div class="a-cat"><div class="a-cat-head">' +
              '<div class="a-main"><b>' + esc(p.name) + '</b><span>' + p.districts.length + ' districts</span></div>' +
              '<button class="btn btn-danger btn-sm" data-prov-del="' + p.id + '">' + icon('trash-outline') + '</button></div>';
            p.districts.forEach(function (d) {
              h += '<div class="a-sub">' + icon('chevron-forward-outline') + '<b>' + esc(d.name) + '</b>' +
                '<span class="muted fs12" style="margin-left:6px">' + d.cities.map(function (c) { return esc(c.name); }).join(', ') + '</span>' +
                '<span class="spacer"></span>' +
                '<button class="btn btn-outline btn-sm" data-dist-del="' + d.id + '">' + icon('trash-outline') + '</button></div>';
            });
            h += '</div>';
          });
          el.innerHTML = h;
          function fillDistricts() {
            var pid = $('#loc-prov-sel').value;
            var p = provs.find(function (x) { return String(x.id) === String(pid); });
            $('#loc-dist-sel').innerHTML = (p ? p.districts : []).map(function (d) {
              return '<option value="' + d.id + '">' + esc(d.name) + '</option>';
            }).join('');
          }
          $('#loc-prov-sel').addEventListener('change', fillDistricts);
          fillDistricts();
          $('#loc-add-prov').addEventListener('click', function () {
            act(api.post('/admin/provinces', { name: $('#loc-prov').value }), 'Province added', function () { ADMIN_VIEWS.locations().mount(); });
          });
          $('#loc-add-dist').addEventListener('click', function () {
            act(api.post('/admin/districts', { province_id: parseInt($('#loc-prov-sel').value, 10), name: $('#loc-dist').value }), 'District added', function () { ADMIN_VIEWS.locations().mount(); });
          });
          $('#loc-add-city').addEventListener('click', function () {
            var did = $('#loc-dist-sel').value;
            if (!did) return toast('Choose a district first', 'error');
            act(api.post('/admin/cities', { district_id: parseInt(did, 10), name: $('#loc-city').value }), 'City added', function () { ADMIN_VIEWS.locations().mount(); });
          });
          $$('#aloc-list [data-prov-del]').forEach(function (b) {
            b.addEventListener('click', function () {
              act(api.del('/admin/provinces/' + b.getAttribute('data-prov-del')), 'Province deleted', function () { ADMIN_VIEWS.locations().mount(); });
            });
          });
          $$('#aloc-list [data-dist-del]').forEach(function (b) {
            b.addEventListener('click', function () {
              act(api.del('/admin/districts/' + b.getAttribute('data-dist-del')), 'District deleted', function () { ADMIN_VIEWS.locations().mount(); });
            });
          });
        }).catch(function (e) { adminRenderError($('#aloc-list'), e, 'locations', function () { loadAdminSection('locations'); }); });
      }
    };
  };

  /* ----- Promotions ----- */
  ADMIN_VIEWS.promotions = function () {
    var html = '<div id="apromo"><div class="spinner"></div></div>';
    return {
      html: adminBody(html),
      mount: function () {
        api.get('/admin/settings').then(function (d) {
          var pkgs = d.promotions;
          var h = '<div class="a-sec-head"><h3>' + icon('flash-outline') + 'Promotion packages</h3></div>' +
            '<p class="muted fs12 pad16">Prices and durations are configurable in Settings.</p>' +
            adminTable(['Package', 'Price', 'Duration'], pkgs.map(function (p) {
              return '<tr><td><b>' + esc(p.name) + '</b><br><span class="muted fs12">' + esc(p.description) + '</span></td><td>' + fmtLKR(p.price) + '</td><td>' + p.duration_days + ' days</td></tr>';
            }).join(''));
          h += '<div class="a-sec-head"><h3>' + icon('trending-up-outline') + 'Active promotions</h3></div>';
          var body = $('#apromo');
          body.innerHTML = h;
          // Returned so a failure here is reported instead of becoming an
          // unhandled rejection that leaves the table half-drawn.
          return api.get('/admin/promotions').then(function (rows) {
            var el = $('#apromo');
            el.innerHTML = h + ((rows || []).length ? adminTable(['Listing', 'User', 'Type', 'Paid', 'Expires'], rows.map(function (r) {
              return '<tr><td>' + esc(r.listing_title || '—') + '</td><td>' + esc(r.user_name || '') + '</td><td>' + aChip(r.ptype, '#F0A500') + '</td><td>' + fmtLKR(r.price) + '</td><td>' + (r.ends_at ? fmtDate(r.ends_at) : '—') + '</td></tr>';
            }).join('')) : '<p class="muted fs12 pad16">No promotions purchased yet.</p>');
          }, function (e) {
            var el = $('#apromo');
            if (el) {
              el.innerHTML = h + errorHtml((e && e.message) || 'Could not load promotions.', 'Reload', 'alert-circle-outline');
              var btn = el.querySelector('[data-state-retry]');
              if (btn) btn.addEventListener('click', function () { loadAdminSection('promotions'); });
            }
          });
        }).catch(function (e) { adminRenderError($('#apromo'), e, 'promotions', function () { loadAdminSection('promotions'); }); });
      }
    };
  };

  /* ----- Payments ----- */
  ADMIN_VIEWS.payments = function () {
    var html = '<div id="apay"><div class="spinner"></div></div>';
    return {
      html: adminBody(html),
      mount: function () {
        api.get('/admin/payments').then(function (rows) {
          var el = $('#apay');
          var statusColor = { pending: '#C77D23', processing: '#3A6FB0', successful: '#0E7C66', failed: '#E5484D', cancelled: '#74817C', refunded: '#9C4F96' };
          el.innerHTML = rows.length ? adminTable(['Transaction', 'User', 'Package', 'Amount', 'Status', 'Date'], rows.map(function (r) {
            return '<tr><td>' + esc(r.transaction_id) + '</td><td>' + esc(r.user_name || r.user_email || '') + '</td><td>' + esc(r.package_name || r.package) + '</td><td>' + fmtLKR(r.amount) + ' ' + esc(r.currency) + '</td>' +
              '<td>' + aChip(r.status, statusColor[r.status]) + '</td><td>' + fmtDate(r.created_at) + '</td></tr>';
          }).join('')) : '<div class="empty"><p>No payments yet.</p></div>';
        }).catch(function (e) { adminRenderError($('#apay'), e, 'payments', function () { loadAdminSection('payments'); }); });
      }
    };
  };

  /* ----- Blog posts ----- */
  ADMIN_VIEWS.posts = function () {
    var html = adminActionBar('',
      '<button class="btn btn-primary btn-sm" id="ap-add">' + icon('add-outline') + 'New post</button>');
    html += '<div id="ap-list"><div class="spinner"></div></div>';
    return {
      html: adminBody(html),
      mount: function () {
        function load() {
          api.get('/posts').then(function (posts) {
            var el = $('#ap-list');
            el.innerHTML = posts.map(function (p) {
              return '<div class="a-row">' +
                '<div class="a-thumb">' + (p.image ? '<img src="' + esc(p.image) + '" alt="' + esc(p.title || 'Guide') + '">' : icon('reader-outline')) + '</div>' +
                '<div class="a-main"><b>' + esc(p.title) + '</b><span>' + esc(p.category || 'Guide') + ' · ' + fmtDate(p.created_at) + '</span></div>' +
                '<button class="btn btn-outline btn-sm" data-post-edit="' + p.id + '" data-post-slug="' + esc(p.slug) + '">' + icon('create-outline') + '</button>' +
                '<button class="btn btn-danger btn-sm" data-post-del="' + p.id + '">' + icon('trash-outline') + '</button></div>';
            }).join('') || '<div class="empty"><p>No posts yet.</p></div>';
            bindPostRows();
          }).catch(function (e) { adminRenderError($('#ap-list'), e, 'posts', load); });
        }
        function bindPostRows() {
            $('#ap-add').addEventListener('click', function () { openPostEditor(null); });
            $$('#ap-list [data-post-edit]').forEach(function (b) {
              b.addEventListener('click', function () {
                act(api.get('/posts/' + b.getAttribute('data-post-slug')), null, function (p) { if (p) openPostEditor(p); });
              });
            });
            $$('#ap-list [data-post-del]').forEach(function (b) {
              b.addEventListener('click', function () {
                var pid = b.getAttribute('data-post-del');
                openDialog('Delete post', '<p>This permanently removes the post.</p>', 'Delete', true, function () {
                  act(api.del('/admin/posts/' + pid), 'Post deleted', function () { closeDialog(); load(); });
                });
              });
            });
        }
        load();
      }
    };
  };

  function openPostEditor(p) {
    p = p || {};
    openDialog(p.id ? 'Edit post' : 'New post',
      '<div class="form-group"><label>Title</label><input class="input" id="pe-title" value="' + esc(p.title || '') + '"></div>' +
      '<div class="form-group"><label>Category</label><input class="input" id="pe-cat" value="' + esc(p.category || 'Guide') + '"></div>' +
      '<div class="form-group"><label>Excerpt</label><textarea class="textarea" id="pe-excerpt" style="min-height:50px">' + esc(p.excerpt || '') + '</textarea></div>' +
      '<div class="form-group"><label>Body (HTML)</label><textarea class="textarea" id="pe-body" style="min-height:140px">' + esc(p.body || '') + '</textarea></div>' +
      '<div class="form-group"><label>Image URL</label><input class="input" id="pe-img" value="' + esc(p.image || '') + '"></div>' +
      '<div class="form-group"><label>Author</label><input class="input" id="pe-author" value="' + esc(p.author || 'Lanka Lens') + '"></div>',
      'Save', false, function () {
        var payload = {
          title: $('#pe-title').value, category: $('#pe-cat').value, excerpt: $('#pe-excerpt').value,
          body: $('#pe-body').value, image: $('#pe-img').value, author: $('#pe-author').value
        };
        var req = p.id ? api.patch('/admin/posts/' + p.id, payload) : api.post('/admin/posts', payload);
        req.then(function () { closeDialog(); toast('Post saved', 'success'); loadAdminSection('posts'); })
          .catch(function (e) { toast(e.message, 'error'); });
      });
  }

  /* ----- Settings ----- */
  ADMIN_VIEWS.settings = function () {
    var html = '<div id="as-root"><div class="spinner"></div></div>';
    return {
      html: adminBody(html),
      mount: function () {
        api.get('/admin/settings').then(function (d) {
          var s = d.settings;
          var toggles = [
            ['require_approval', 'Require admin approval for new listings'],
            ['verification_required_to_sell', 'Require verified account to sell']
          ];
          function tg(name, label, val) {
            return '<div class="switch-row"><div><label style="margin:0">' + esc(label) + '</label></div>' +
              '<label class="switch"><input type="checkbox" id="st-' + name + '"' + (val === '1' || val === 'true' ? ' checked' : '') + '><span class="slider"></span></label></div>';
          }
          var h = '<form id="as-form"><div class="form-card" style="margin:16px">' +
            '<div class="section-head"><h3>' + icon('globe-outline') + 'Branding</h3></div>' +
            '<div class="form-group"><label>Site name</label><input class="input" name="site_name" value="' + esc(s.site_name) + '"></div>' +
            '<div class="form-group"><label>Tagline</label><input class="input" name="tagline" value="' + esc(s.tagline) + '"></div>' +
            '<div class="form-group"><label>Logo URL</label><input class="input" name="logo" value="' + esc(s.logo) + '"></div>' +
            '<div class="form-group"><label>Footer text</label><input class="input" name="footer_text" value="' + esc(s.footer_text) + '"></div>' +
            '<div class="section-head" style="margin-top:14px"><h3>' + icon('call-outline') + 'Contact</h3></div>' +
            '<div class="form-group"><label>Email</label><input class="input" name="contact_email" value="' + esc(s.contact_email) + '"></div>' +
            '<div class="form-group"><label>Phone</label><input class="input" name="contact_phone" value="' + esc(s.contact_phone) + '"></div>' +
            '<div class="form-group"><label>Address</label><input class="input" name="contact_address" value="' + esc(s.contact_address) + '"></div>' +
            '<div class="section-head" style="margin-top:14px"><h3>' + icon('settings-outline') + 'Listing limits</h3></div>' +
            '<div class="form-group"><label>Max listings per user</label><input class="input" type="number" name="max_listings_per_user" value="' + esc(s.max_listings_per_user) + '"></div>' +
            '<div class="form-group"><label>Max images per listing</label><input class="input" type="number" name="max_images_per_listing" value="' + esc(s.max_images_per_listing) + '"></div>' +
            '<div class="form-group"><label>Listing expiry (days)</label><input class="input" type="number" name="listing_expiry_days" value="' + esc(s.listing_expiry_days) + '"></div>' +
            toggles.map(function (t) { return tg(t[0], t[1], s[t[0]]); }).join('') +
            '<div class="section-head" style="margin-top:14px"><h3>' + icon('flash-outline') + 'Promotion pricing</h3></div>';
          [['featured', 'Featured Listing'], ['boost', 'Boost'], ['homepage', 'Homepage Featured'], ['urgent', 'Urgent Badge']].forEach(function (p) {
            h += '<div class="form-group"><label>' + esc(p[1]) + ' — price (LKR) / days</label><div class="flex gap8">' +
              '<input class="input" type="number" name="promo_' + p[0] + '_price" value="' + esc(s['promo_' + p[0] + '_price']) + '">' +
              '<input class="input" type="number" name="promo_' + p[0] + '_days" value="' + esc(s['promo_' + p[0] + '_days']) + '"></div></div>';
          });
          h += '<div class="section-head" style="margin-top:14px"><h3>' + icon('card-outline') + 'Payments</h3></div>' +
            '<div class="form-group"><label>Webhook secret (backend only — never shown to users)</label><input class="input" name="payment_webhook_secret" value="' + esc(s.payment_webhook_secret) + '" placeholder="Set to enable provider webhooks"></div>' +
            '<div class="section-head" style="margin-top:14px"><h3>' + icon('image-outline') + 'Homepage banners (JSON)</h3></div>' +
            '<div class="form-group"><textarea class="textarea" name="homepage_banners" style="min-height:70px">' + esc(s.homepage_banners) + '</textarea></div>' +
            '<div class="section-head" style="margin-top:14px"><h3>' + icon('share-social-outline') + 'Social links</h3></div>' +
            '<div class="form-group"><label>Facebook</label><input class="input" name="social_facebook" value="' + esc(s.social_facebook) + '"></div>' +
            '<div class="form-group"><label>Instagram</label><input class="input" name="social_instagram" value="' + esc(s.social_instagram) + '"></div>' +
            '<div class="form-group"><label>YouTube</label><input class="input" name="social_youtube" value="' + esc(s.social_youtube) + '"></div>' +
            '<button class="btn btn-primary" type="submit">' + icon('checkmark-outline') + 'Save settings</button>' +
            '</div></form>';
          $('#as-root').innerHTML = h;
          $('#as-form').addEventListener('submit', function (e) {
            e.preventDefault();
            var payload = {};
            $$('#as-form [name]').forEach(function (inp) {
              if (inp.type === 'checkbox') payload[inp.name] = inp.checked ? '1' : '0';
              else payload[inp.name] = inp.value;
            });
            api.put('/admin/settings', payload).then(function (r) {
              toast('Settings saved', 'success');
              refreshMeta();
            }).catch(function (er) { toast(er.message, 'error'); });
          });
        }).catch(function (e) { adminRenderError($('#as-root'), e, 'settings', function () { loadAdminSection('settings'); }); });
      }
    };
  };

  /* ----- Audit log ----- */
  ADMIN_VIEWS.audit = function () {
    var html = '<div id="aa-list"><div class="spinner"></div></div>';
    return {
      html: adminBody(html),
      mount: function () {
        api.get('/admin/audit').then(function (rows) {
          var el = $('#aa-list');
          el.innerHTML = rows.length ? adminTable(['Admin', 'Action', 'Entity', 'Detail', 'When'], rows.map(function (r) {
            return '<tr><td>' + esc(r.admin_name || '—') + '</td><td>' + aChip(r.action, '#5B6BB0') + '</td><td>' + esc(r.entity + (r.entity_id ? ' #' + r.entity_id : '')) + '</td><td>' + esc(r.detail || '') + '</td><td>' + timeAgo(r.created_at) + '</td></tr>';
          }).join('')) : '<div class="empty"><p>No audit entries yet.</p></div>';
        }).catch(function (e) { adminRenderError($('#aa-list'), e, 'audit', function () { loadAdminSection('audit'); }); });
      }
    };
  };

  function loadAdminSection(section, params) {
    var map = {
      dashboard: ADMIN_VIEWS.dashboard,
      users: ADMIN_VIEWS.users,
      businesses: ADMIN_VIEWS.businesses,
      listings: ADMIN_VIEWS.listings,
      reports: ADMIN_VIEWS.reports,
      categories: ADMIN_VIEWS.categories,
      brands: ADMIN_VIEWS.brands,
      locations: ADMIN_VIEWS.locations,
      promotions: ADMIN_VIEWS.promotions,
      payments: ADMIN_VIEWS.payments,
      posts: ADMIN_VIEWS.posts,
      settings: ADMIN_VIEWS.settings,
      audit: ADMIN_VIEWS.audit
    };
    // `fn` was previously assigned without a `var` declaration. Inside this
    // file's 'use strict' IIFE that assignment throws
    // `ReferenceError: fn is not defined`, which aborted loadAdminSection()
    // before ANY section could render — the admin panel stayed on its loading
    // spinner forever (every tab, every #/admin/<section> route). Declaring it
    // is the root-cause fix for the admin page never finishing its load.
    var fn;
    if (section === 'users' && params && params.id) {
      fn = ADMIN_VIEWS.userDetail;
    } else {
      fn = map[section];
      if (!fn) { section = 'dashboard'; fn = ADMIN_VIEWS.dashboard; }
    }
    var body = $('#admin-body');
    if (!body) return;
    var v;
    try {
      v = fn(params);
    } catch (e) {
      // A section view that throws while building its markup must never leave
      // the panel stuck on the spinner — show the failure with a Retry.
      console.error('[LankaLens] admin section "' + section + '" failed to render:', e);
      adminRenderError(body, e, section, function () { loadAdminSection(section, params); });
      return;
    }
    body.innerHTML = v.html;
    // re-render active tab bar
    var tabs = $('.admin-tabs');
    if (tabs) tabs.innerHTML = adminTabsInner(section);
    bindAdminTabs();
    if (v.mount) {
      try {
        v.mount();
      } catch (e) {
        // Same guarantee for the async boot path of a section.
        console.error('[LankaLens] admin section "' + section + '" failed to load:', e);
        adminRenderError(body, e, section, function () { loadAdminSection(section, params); });
      }
    }
  }

  views.admin = function () {
    if (!requireAuth()) return { html: '' };
    if (!state.user.is_admin) {
      return {
        html: header('Admin Panel', {}) + '<div class="empty" style="padding-top:70px"><div class="e-icon">' + icon('lock-closed-outline') + '</div><h3>Admins only</h3><p>You need an administrator account to view this page.</p></div>',
        mount: function () {}
      };
    }
    var html = header('Admin Panel', {}) + adminTabsHtml('dashboard') + '<div id="admin-body"><div class="spinner"></div></div>';
    return {
      html: html,
      hideTabbar: true,
      mount: function () {
        bindAdminTabs();
        loadAdminSection('dashboard');
      }
    };
  };

  views.adminSection = function (params) {
    if (!requireAuth()) return { html: '' };
    if (!state.user.is_admin) return { html: header('Admin Panel', {}) + '<div class="empty"><p>Admins only.</p></div>', mount: function () {} };
    var section = params.section;
    var html = header('Admin Panel', {}) + adminTabsHtml(section) + '<div id="admin-body"><div class="spinner"></div></div>';
    return {
      html: html,
      hideTabbar: true,
      mount: function () {
        bindAdminTabs();
        loadAdminSection(section, params);
      }
    };
  };

  /* ---------- router ---------- */
  function parseHash() {
    var h = location.hash.slice(1) || '/';
    var parts = h.split('?');
    var path = parts[0];
    var query = new URLSearchParams(parts[1] || '');
    return { path: path, query: query };
  }

  var routes = [
    { re: /^\/$/, handler: function (p, q) { return views.home(); } },
    { re: /^\/categories$/, handler: function () { return views.categories(); } },
    { re: /^\/category\/([^\/]+)$/, handler: function (p, q, m) { return views.category({ slug: m[1] }); } },
    { re: /^\/browse$/, handler: function (p, q) { return views.browse(q); } },
    { re: /^\/search$/, handler: function () { return views.search(); } },
    { re: /^\/ads\/(\d+)$/, handler: function (p, q, m) { return views.detail({ id: m[1] }); } },
    { re: /^\/sell$/, handler: function () { return views.sell(); } },
    { re: /^\/sell\/([^\/]+)$/, handler: function (p, q, m) { return views.sellForm({ slug: m[1] }); } },
    { re: /^\/edit-ad\/(\d+)$/, handler: function (p, q, m) { return views.editAd({ id: m[1] }); } },
    { re: /^\/my-ads$/, handler: function () { return views.myAds(); } },
    { re: /^\/my-offers$/, handler: function () { return views.myOffers(); } },
    { re: /^\/favorites$/, handler: function () { return views.favorites(); } },
    { re: /^\/chat$/, handler: function () { return views.chat(); } },
    { re: /^\/chat\/(\d+)$/, handler: function (p, q, m) { return views.chatThread({ id: m[1], q: q }); } },
    { re: /^\/notifications$/, handler: function () { return views.notifications(); } },
    { re: /^\/profile$/, handler: function () { return views.profile(); } },
    { re: /^\/seller\/(\d+)$/, handler: function (p, q, m) { return views.seller({ id: m[1] }); } },
    { re: /^\/settings$/, handler: function () { return views.settings(); } },
    { re: /^\/analytics$/, handler: function () { return views.analytics(); } },
    { re: /^\/my-shop$/, handler: function () { return views.myShop(); } },
    { re: /^\/shop\/([^\/]+)$/, handler: function (p, q, m) { return views.shopPage({ slug: m[1] }); } },
    { re: /^\/sign-in$/, handler: function (p, q) { return views.signin(q); } },
    { re: /^\/sign-up$/, handler: function (p, q) { return views.signup(q); } },
    { re: /^\/forgot$/, handler: function () { return views.forgot(); } },
    { re: /^\/reset-password$/, handler: function (p, q) { return views.resetPassword(q); } },
    { re: /^\/verify-email$/, handler: function (p, q) { return views.verifyEmail(q); } },
    { re: /^\/sign-out$/, handler: function () { return views.signout(); } },
    { re: /^\/contact$/, handler: function () { return views.contact(); } },
    { re: /^\/blog$/, handler: function () { return views.blog(); } },
    { re: /^\/blog\/([^\/]+)$/, handler: function (p, q, m) { return views.post({ slug: m[1] }); } },
    { re: /^\/shops$/, handler: function () { return views.shops(); } },
    { re: /^\/admin$/, handler: function () { return views.admin(); } },
    { re: /^\/admin\/users\/(\d+)$/, handler: function (p, q, m) { return views.adminSection({ section: 'users', id: m[1] }); } },
    { re: /^\/admin\/([^\/]+)$/, handler: function (p, q, m) { return views.adminSection({ section: m[1] }); } },
    { re: /^\/about$/, handler: function () { return views.about(); } },
    { re: /^\/safety$/, handler: function () { return views.safety(); } },
    { re: /^\/buying-guide$/, handler: function () { return views['buying-guide'](); } },
    { re: /^\/sell-your-camera$/, handler: function () { return views['sell-your-camera'](); } },
    { re: /^\/privacy$/, handler: function () { return views.privacy(); } },
    { re: /^\/terms$/, handler: function () { return views.terms(); } },
    { re: /^\/faq$/, handler: function () { return views.faq(); } },
    { re: /^\/help$/, handler: function () { return views.help(); } }
  ];

  function currentRoute() {
    var h = parseHash();
    for (var i = 0; i < routes.length; i++) {
      var m = h.path.match(routes[i].re);
      if (m) return { view: routes[i].handler(h.path, h.query, m), hideTabbar: false };
    }
    return { view: notFound(), hideTabbar: false };
  }

  function notFound() {
    return {
      html: header('Not found', {}) + '<div class="empty" style="padding-top:70px"><div class="e-icon">' + icon('alert-circle-outline') + '</div><h3>Page not found</h3><p>The page you’re looking for doesn’t exist.</p><a class="btn btn-primary btn-sm" data-nav="#/" style="margin-top:12px">Go home</a></div>',
      mount: function () {}
    };
  }

  var renderTimer = null;
  /**
   * Views that poll (the chat thread refreshes every 6s) register their timer
   * here. Every route change clears them, so navigating away cannot leave an
   * interval polling the API forever and writing into a detached node.
   */
  var activePollers = [];
  function addPoller(fn, ms) {
    var id = setInterval(function () {
      // Stop polling as soon as the view's container is gone from the document.
      if (!document.body.contains(($('#page') || document.body))) { clearInterval(id); return; }
      fn();
    }, ms);
    activePollers.push(id);
    return id;
  }
  function clearPollers() {
    activePollers.forEach(function (id) { clearInterval(id); });
    activePollers = [];
  }

  /**
   * A broken, missing or still-uploading image must never punch a hole in a
   * card or show the browser's broken-image glyph. Swap in the branded
   * placeholder (image error events do not bubble, so this listens in the
   * capture phase).
   */
  var IMG_FALLBACK = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120">' +
    '<rect width="160" height="120" fill="#E4EAE7"/>' +
    '<g fill="none" stroke="#9AA8A2" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M46 46h14l6-9h28l6 9h14a6 6 0 0 1 6 6v34a6 6 0 0 1-6 6H46a6 6 0 0 1-6-6V52a6 6 0 0 1 6-6z"/>' +
    '<circle cx="80" cy="69" r="13"/></g></svg>');
  function bindImageFallbacks() {
    document.addEventListener('error', function (e) {
      var el = e.target;
      if (!el || el.tagName !== 'IMG') return;
      if (el.getAttribute('data-img-fallback') === '1') return;   // never loop
      el.setAttribute('data-img-fallback', '1');
      el.classList.add('img-fallback');
      el.src = IMG_FALLBACK;
      if (!el.getAttribute('alt')) el.setAttribute('alt', 'Image unavailable');
    }, true);
  }

  function render() {
    clearPollers();
    var h = parseHash();
    state.route = h;
    var route = currentRoute();
    var v = route.view;
    var page = $('#page');
    // A view that needs a session but renders nothing while the stored token is
    // still being verified would otherwise flash an empty page.
    if (!v.html && !state.sessionRestored) {
      v = { html: '<div class="spinner" style="margin-top:80px"></div>', mount: function () {}, hideTabbar: v.hideTabbar, pageClass: v.pageClass };
    }
    page.className = 'page-view' + (v.pageClass ? ' ' + v.pageClass : '');
    page.innerHTML = v.html;
    document.getElementById('app').classList.toggle('hide-tabbar', !!v.hideTabbar);
    window.scrollTo(0, 0);
    setMeta(defaultMeta(h.path), (state.meta && state.meta.settings && state.meta.settings.tagline) || '');
    updateTabbar(h.path);
    renderDrawer();
    if (v.mount) {
      try { v.mount(); } catch (e) { console.error(e); }
    }
  }

  function updateTabbar(path) {
    $$('.app-tabbar a[data-tab]').forEach(function (a) {
      var key = a.getAttribute('data-tab');
      var active = (key === 'home' && (path === '/' || path === '/browse' || path.indexOf('/category') === 0)) ||
        (key === 'search' && path === '/search') ||
        (key === 'favorites' && path === '/favorites') ||
        (key === 'profile' && (path === '/profile' || path === '/settings' || path === '/my-ads' || path === '/my-offers' || path === '/analytics' || path === '/my-shop' || path.indexOf('/edit-ad') === 0 || path === '/admin'));
      a.classList.toggle('active', active);
    });
  }

  function renderTabbar() {
    var el = $('#tabbar');
    if (!el) return;
    el.innerHTML =
      '<a data-tab="home" data-nav="#/" class="active"><span>' + icon('home-outline') + '</span>Home</a>' +
      '<a data-tab="search" data-nav="#/search"><span>' + icon('search-outline') + '</span>Search</a>' +
      '<a class="sell-tab" data-nav="#/sell"><span class="sell-fab">' + icon('add-outline') + '</span><span>Post Ad</span></a>' +
      '<a data-tab="favorites" data-nav="#/favorites"><span>' + icon('heart-outline') + '</span>Favorites</a>' +
      '<a data-tab="profile" data-nav="#/profile"><span>' + icon('person-outline') + '</span>' + (state.user ? 'Profile' : 'Sign in') + '</a>';
  }

  function renderDrawer() {
    var el = $('#drawer');
    if (!el) return;
    var u = state.user;
    var head = u
      ? '<div class="drawer-head"><div class="mini-user">' + avatarHtml(u, 'lg') +
        '<div><div class="name">' + esc(u.name) + '</div><div class="sub">' + (u.verified ? icon('shield-checkmark') + ' Verified seller · ' : '') + esc(u.city || 'Sri Lanka') + '</div></div></div></div>'
      : '<div class="drawer-head"><div class="mini-user">' + logoMark() +
        '<div><div class="name">Lanka Lens</div><div class="sub">Buy & Sell Cameras in Sri Lanka</div></div></div>' +
        '<div class="flex gap8" style="margin-top:14px"><a class="btn btn-accent btn-sm" data-nav="#/sign-in">Sign in</a>' +
        '<a class="btn btn-outline btn-sm" style="background:rgba(255,255,255,.12);color:#fff;border-color:rgba(255,255,255,.3)" data-nav="#/sign-up">Sign up</a></div></div>';

    var nav = [
      ['Marketplace'],
      ['grid-outline', 'All Categories', '#/categories'],
      ['search-outline', 'Browse & Search', '#/browse'],
      ['cart-outline', 'Camera Shops', '#/shops'],
      ['reader-outline', 'Buying Guides', '#/blog']
    ];
    var account = state.user ? [
      ['Account'],
      ['duplicate-outline', 'My Ads', '#/my-ads'],
      ['heart-outline', 'Favorites', '#/favorites'],
      ['chatbubble-ellipses-outline', 'Messages', '#/chat'],
      ['cash-outline', 'My Offers', '#/my-offers'],
      ['bar-chart-outline', 'Analytics', '#/analytics'],
      ['notifications-outline', 'Notifications', '#/notifications'],
      ['settings-outline', 'Settings', '#/settings']
    ] : [];
    if (state.user && state.user.seller_type === 'business') {
      account.splice(account.length - 2, 0, ['briefcase-outline', 'My Shop', '#/my-shop']);
    }
    if (state.user && state.user.is_admin) {
      account.push(['speedometer-outline', 'Admin Panel', '#/admin']);
    }
    var info = [
      ['Information'],
      ['information-circle-outline', 'About', '#/about'],
      ['shield-checkmark', 'Safety', '#/safety'],
      ['help-circle-outline', 'Buying Guide', '#/buying-guide'],
      ['cash-outline', 'Sell Your Camera', '#/sell-your-camera'],
      ['help-outline', 'Help', '#/help'],
      ['chatbubble-outline', 'FAQ', '#/faq'],
      ['mail-outline', 'Contact', '#/contact'],
      ['document-text-outline', 'Privacy', '#/privacy'],
      ['document-outline', 'Terms', '#/terms']
    ];

    function block(items) {
      var h = '';
      items.forEach(function (it) {
        if (it.length === 1) { h += '<div class="nav-label">' + esc(it[0]) + '</div>'; return; }
        h += '<a data-nav="' + it[2] + '">' + icon(it[0]) + '<span>' + esc(it[1]) + '</span></a>';
      });
      return h;
    }

    el.innerHTML = head + '<div class="drawer-nav">' + block(nav) + block(account) + block(info) +
      (u ? '<div class="nav-sep"></div><a class="signout" data-nav="#/sign-out">' + icon('log-out-outline') + '<span>Sign Out</span></a>' : '') +
      '</div><div class="drawer-foot">' + icon('shield-checkmark') + ' Safe trading tips · <a data-nav="#/safety">Learn more</a></div>';
  }

  /* ---------- global events ---------- */
  function bindGlobal() {
    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-fav]') : null;
      if (el) {
        e.preventDefault(); e.stopPropagation();
        toggleFav(parseInt(el.getAttribute('data-fav'), 10), el);
        return;
      }
      var nav = e.target.closest ? e.target.closest('[data-nav]') : null;
      if (nav) {
        e.preventDefault();
        var target = nav.getAttribute('data-nav');
        if (target === '#/sign-out') { location.hash = target; return; }
        location.hash = target;
        return;
      }
      if (e.target.closest && e.target.closest('[data-back]')) {
        e.preventDefault();
        if (history.length > 1) history.back();
        else location.hash = '#/';
        return;
      }
      if (e.target.closest && e.target.closest('[data-open-drawer]')) { openDrawer(); return; }
      if (e.target.closest && e.target.closest('[data-close-drawer]')) { closeDrawer(); return; }
      if (e.target.closest && e.target.closest('[data-close-sheet]')) { closeSheet(); return; }
      var so = e.target.closest ? e.target.closest('[data-sheet-idx]') : null;
      if (so) {
        var idx = parseInt(so.getAttribute('data-sheet-idx'), 10);
        closeSheet();
        if (sheetCbs[idx]) sheetCbs[idx]();
        return;
      }
      if (e.target.closest && e.target.closest('[data-dialog-ok]')) {
        closeDialog();
        if (dialogOk) dialogOk();
        return;
      }
      if (e.target.closest && e.target.closest('[data-dialog-cancel]')) { closeDialog(); return; }
      if (e.target.closest && e.target.closest('[data-call-shop]')) {
        window.location.href = 'tel:' + phoneDigits(e.target.closest('[data-call-shop]').getAttribute('data-call-shop'));
        return;
      }
      if (e.target.closest && e.target.closest('[data-wa-shop]')) {
        var n = phoneDigits(e.target.closest('[data-wa-shop]').getAttribute('data-wa-shop'));
        window.open('https://wa.me/' + n, '_blank');
        return;
      }
      if (e.target.closest && e.target.closest('[data-wa-user]')) {
        var nu = phoneDigits(e.target.closest('[data-wa-user]').getAttribute('data-wa-user'));
        window.open('https://wa.me/' + nu, '_blank');
        return;
      }
    });
    window.addEventListener('hashchange', render);
  }

  function openDrawer() { $('#drawer').classList.add('open'); $('#drawer-overlay').classList.add('open'); }
  function closeDrawer() { $('#drawer').classList.remove('open'); $('#drawer-overlay').classList.remove('open'); }

  /* ---------- boot ---------- */
  function seoRedirect() {
    // Map server-rendered SEO URLs to their SPA hash routes so landing pages
    // deep-link correctly (crawler/user hits /listing/slug-id etc.).
    var p = location.pathname;
    var m;
    if ((m = p.match(/^\/listing\/.+?-(\d+)$/))) return '#/ads/' + m[1];
    if ((m = p.match(/^\/guide\/([^/]+)$/))) return '#/blog/' + m[1];
    if ((m = p.match(/^\/shop\/([^/]+)$/))) return '#/shop/' + m[1];
    if ((m = p.match(/^\/category\/([^/]+)$/))) return '#/category/' + m[1];
    return null;
  }

  function loadBootstrapData() {
    function load() {
      return Promise.all([
        api.get('/meta').then(function (d) { state.meta = d; }),
        api.get('/locations').then(function (d) { state.locations = d; })
      ]);
    }
    return load().catch(function () {
      // Nothing answered on this origin. When the page is being served from a
      // local dev origin without the Flask app behind it, point the client at
      // the dev server and retry once instead of failing every later request.
      return api.recoverBase().then(function (switched) {
        if (!switched) return null;
        return load().catch(function () { return null; });
      });
    });
  }

  function restoreSession() {
    if (!api.token) {
      state.sessionRestored = true;
      return Promise.resolve();
    }
    return api.get('/me').then(function (d) {
      state.user = (d && d.user) || null;
      if (!state.user) clearSession();
    }).catch(function (e) {
      // Only a rejected token (401/403) means the stored session is dead — drop
      // it so the UI never claims to be signed in. A server error (5xx) or a
      // network failure is not the user's fault: keep the token and retry on the
      // next load instead of signing everybody out during a hiccup.
      var status = e ? e.status : 0;
      if (status === 401 || status === 403) clearSession();
      else logNonCritical('session restore')(e);
    }).then(function () {
      state.sessionRestored = true;
      refreshFavIds();
    });
  }

  function boot() {
    api.init();
    renderTabbar();
    renderDrawer();

    // If the user landed on a server-rendered SEO URL, route to the matching view.
    var target = (!location.hash || location.hash === '#' || location.hash === '#/') ? seoRedirect() : null;
    if (target) {
      history.replaceState(null, '', location.pathname + location.search + target);
    }

    // Both the reference data and the stored session must be resolved BEFORE the
    // first render. Previously the first render raced the /api/me call, so
    // refreshing a protected route (e.g. #/profile, #/favorites) rendered as
    // signed-out and bounced a signed-in user straight back to the sign-in page.
    var bootDone = false;
    function firstRender() {
      renderDrawer();
      renderTabbar();
      render();

      // The server may include crawlable SEO fallback content in #page so search
      // engines can discover clean links before JavaScript runs. Keep that from
      // flashing to users during refresh, then uncover the real SPA after its
      // first synchronous render has been painted.
      var cover = document.getElementById('app-boot-cover');
      if (cover) {
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            if (cover.parentNode) cover.parentNode.removeChild(cover);
          });
        });
      }
    }
    // Never leave the shell blank if the API is unreachable/very slow.
    setTimeout(function () { if (!bootDone) firstRender(); }, 6000);
    Promise.all([loadBootstrapData(), restoreSession()]).then(function () {
      bootDone = true;
      firstRender();
    });

    bindGlobal();
    bindImageFallbacks();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
