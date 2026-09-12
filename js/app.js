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
  function icon(name, cls) {
    return '<ion-icon name="' + name + '"' + (cls ? ' class="' + cls + '"' : '') + '></ion-icon>';
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
    paused: { label: 'Paused', color: '#9C4F96' }
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
    route: { path: '/', query: new URLSearchParams() }
  };

  /* ---------- api ---------- */
  var api = {
    token: localStorage.getItem('ll_token') || '',
    req: function (method, path, body) {
      var headers = {};
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (api.token) headers['Authorization'] = 'Bearer ' + api.token;
      return fetch('/api' + path, {
        method: method, headers: headers, body: body !== undefined ? JSON.stringify(body) : undefined
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) {
            var e = new Error((data && data.error) || 'Something went wrong');
            e.status = res.status;
            throw e;
          }
          return data.data;
        });
      });
    },
    get: function (p) { return api.req('GET', p); },
    post: function (p, b) { return api.req('POST', p, b); },
    patch: function (p, b) { return api.req('PATCH', p, b); },
    put: function (p, b) { return api.req('PUT', p, b); },
    del: function (p) { return api.req('DELETE', p); }
  };

  function requireAuth() {
    if (state.user) return true;
    location.hash = '#/sign-in?next=' + encodeURIComponent(location.hash || '#/');
    return false;
  }
  function setUser(u) {
    state.user = u;
    refreshFavIds();
    renderDrawer();
    renderTabbar();
  }
  function refreshFavIds() {
    if (state.user) {
      api.get('/favorites/ids').then(function (ids) { state.favIds = ids || []; }).catch(function () {});
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
      $('.sheet-mask', host).classList.add('open');
    });
  }
  function closeSheet() {
    var host = $('#sheet-host');
    var mask = $('.sheet-mask', host);
    if (mask) mask.classList.remove('open');
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
    var left = opts.back === false ? '<span style="width:40px"></span>' :
      '<button class="back-btn" data-back aria-label="Back">' + icon('chevron-back-outline') + '</button>';
    var right = opts.right || '<span style="width:40px"></span>';
    return '<header class="app-header"><div class="app-header-inner">' + left +
      '<div class="title">' + esc(title) + '</div><div class="spacer"></div>' + right + '</div></header>';
  }

  function lcard(l) {
    var img = (l.images && l.images[0])
      ? '<img src="' + esc(l.images[0]) + '" loading="lazy" alt="' + esc(l.title) + '">'
      : '<span class="ph">' + icon('camera-outline') + '</span>';
    var favOn = isFav(l.id);
    var sellerOk = l.seller && l.seller.verified ? '<span class="seller-ok">' + icon('shield-checkmark') + '</span>' : '';
    return '<div class="lcard" data-nav="#/ads/' + l.id + '">' +
      '<div class="thumb">' + img +
      (l.condition ? '<span class="cond-chip">' + esc(l.condition) + '</span>' : '') +
      (l.featured ? '<span class="featured-flag">Featured</span>' : '') +
      '<button class="fav' + (favOn ? ' active' : '') + '" data-fav="' + l.id + '" aria-label="Favorite">' + icon(favOn ? 'heart' : 'heart-outline') + '</button>' +
      '</div><div class="body">' +
      '<div class="title">' + esc(l.title) + '</div>' +
      '<div class="price">' + fmtLKR(l.price) + (l.negotiable ? ' <span class="neg">negotiable</span>' : '') + '</div>' +
      '<div class="meta"><span>' + icon('location-outline') + esc(l.city || l.district || l.province || '') + '</span>' +
      '<span class="sep">·</span><span>' + timeAgo(l.created_at) + '</span>' + sellerOk + '</div>' +
      '</div></div>';
  }

  function listingGrid(items) {
    if (!items || !items.length) {
      return '<div class="empty"><div class="e-icon">' + icon('camera-outline') + '</div>' +
        '<h3>No listings found</h3><p>Try a different search, or be the first to post in this category.</p></div>';
    }
    return '<div class="listing-grid">' + items.map(lcard).join('') + '</div>';
  }

  function catTile(c) {
    var colors = ['#0E7C66', '#C77D23', '#3A6FB0', '#9C4F96', '#B04A3A'];
    var i = (c.id || 0) % colors.length;
    return '<div class="cat-tile" data-nav="#/category/' + esc(c.slug) + '">' +
      '<div class="tile-icon" style="background:' + colors[i] + '1a;color:' + colors[i] + '">' + icon(c.icon || 'camera-outline') + '</div>' +
      '<div class="tile-name">' + esc(c.name) + '</div>' +
      '<div class="tile-count">' + (c.children ? c.children.length + ' types' : '') + '</div></div>';
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
      '<input type="search" placeholder="Search cameras, lenses, GoPro, DJI, drones..." aria-label="Search">' +
      '<button type="submit">Search</button></form>';

    var cats = (state.meta && state.meta.categories) || [];
    var sections = '';
    sections += '<div class="section"><div class="section-head"><h2>' + icon('grid-outline') + 'Browse Categories</h2>' +
      '<a class="more" data-nav="#/categories">View all</a></div><div class="cat-grid">' + cats.map(catTile).join('') + '</div></div>';

    sections += '<div class="section" id="home-featured"></div>';
    sections += '<div class="section" id="home-latest"></div>';

    sections += '<div class="section"><div class="section-head"><h2>' + icon('star-outline') + 'Popular Brands</h2></div>' +
      '<div class="chips" style="padding:0 16px">' + (state.meta ? state.meta.brands.slice(0, 12).map(function (b) {
        return '<a class="chip" data-nav="#/browse?q=' + encodeURIComponent(b) + '">' + esc(b) + '</a>';
      }).join('') : '') + '</div></div>';

    sections += promoBanner('cart-outline', 'Find a Camera Shop', 'Authorised dealers and trusted local shops across the island.', '#/shops');
    sections += promoBanner('shield-checkmark', 'Buy & Sell Safely', 'Our tips to avoid scams and meet sellers safely.', '#/safety');

    sections += '<div class="section" id="home-shops"></div>';
    sections += '<div class="section" id="home-posts"></div>';

    return {
      html: stats + sections + footer(),
      mount: function () {
        var f = $('#home-search');
        if (f) f.addEventListener('submit', function (e) {
          e.preventDefault();
          var q = $('input', f).value.trim();
          location.hash = '#/browse?q=' + encodeURIComponent(q);
        });
        api.get('/listings?featured=1').then(function (d) {
          var el = $('#home-featured');
          if (el) el.innerHTML = '<div class="section-head"><h2>' + icon('flash-outline') + 'Featured Listings</h2><a class="more" data-nav="#/browse">View all</a></div>' +
            '<div class="hscroll">' + (d.items || []).slice(0, 8).map(lcard).join('') + '</div>';
        }).catch(function () {});
        api.get('/listings?sort=newest').then(function (d) {
          var el = $('#home-latest');
          if (el) el.innerHTML = '<div class="section-head"><h2>' + icon('time-outline') + 'Latest Listings</h2><a class="more" data-nav="#/browse">View all</a></div>' +
            '<div class="hscroll">' + (d.items || []).slice(0, 8).map(lcard).join('') + '</div>';
        }).catch(function () {});
        api.get('/shops').then(function (shops) {
          var el = $('#home-shops');
          if (el) el.innerHTML = '<div class="section-head"><h2>' + icon('cart-outline') + 'Camera Shops</h2><a class="more" data-nav="#/shops">View all</a></div>' +
            '<div class="hscroll">' + (shops || []).slice(0, 5).map(shopCardSmall).join('') + '</div>';
        }).catch(function () {});
        api.get('/posts').then(function (posts) {
          var el = $('#home-posts');
          if (el) el.innerHTML = '<div class="section-head"><h2>' + icon('reader-outline') + 'Buying Guides</h2><a class="more" data-nav="#/blog">View all</a></div>' +
            '<div class="hscroll">' + (posts || []).slice(0, 4).map(function (p) {
              return '<div class="lcard card-sm" data-nav="#/blog/' + esc(p.slug) + '">' +
                '<div class="thumb">' + (p.image ? '<img src="' + esc(p.image) + '" alt="">' : '<span class="ph">' + icon('reader-outline') + '</span>') + '</div>' +
                '<div class="body"><div class="title" style="min-height:auto">' + esc(p.title) + '</div>' +
                '<div class="meta"><span>' + esc(p.category || 'Guide') + '</span><span class="sep">·</span><span>' + fmtDate(p.created_at) + '</span></div></div></div>';
            }).join('') + '</div>';
        }).catch(function () {});
      }
    };
  };

  function shopCardSmall(s) {
    return '<div class="lcard card-sm" data-nav="#/shops">' +
      '<div class="thumb">' + (s.image ? '<img src="' + esc(s.image) + '" alt="">' : '<span class="ph">' + icon('cart-outline') + '</span>') + '</div>' +
      '<div class="body"><div class="title" style="min-height:auto">' + esc(s.name) + (s.verified ? ' ' + icon('shield-checkmark') : '') + '</div>' +
      '<div class="meta"><span>' + icon('location-outline') + esc(s.city || s.area) + '</span></div></div></div>';
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

  function logoMark() {
    return '<span class="brand-mark"><svg viewBox="0 0 64 64" width="100%" height="100%"><rect width="64" height="64" rx="14" fill="#0E7C66"/><circle cx="32" cy="32" r="19" fill="none" stroke="#fff" stroke-width="4"/><g fill="#F0A500"><path d="M32 17.5 L38.2 28.3 L50.5 30.1 L42 38.5 L44 50.8 L32 44.5 L20 50.8 L22 38.5 L13.5 30.1 L25.8 28.3 Z"/></g><circle cx="32" cy="32" r="6" fill="#0E7C66"/><circle cx="32" cy="32" r="3.2" fill="#fff"/></svg></span>';
  }

  views.categories = function () {
    var cats = (state.meta && state.meta.categories) || [];
    var html = fullHeader('Categories', { right: '<button class="icon-btn" data-nav="#/search">' + icon('search-outline') + '</button>' });
    html += '<div class="section" style="padding-top:14px"><div class="cat-grid">' + cats.map(catTile).join('') + '</div></div>';
    html += '<div class="section"><div class="section-head"><h2>' + icon('layers-outline') + 'Browse by Type</h2></div></div>';
    cats.forEach(function (c) {
      html += '<div class="divider-label">' + esc(c.name) + '</div><div class="subcats" style="padding:0 16px 6px">' +
        (c.children || []).map(function (s) {
          return '<a class="chip" data-nav="#/category/' + esc(s.slug) + '">' + esc(s.name) + '</a>';
        }).join('') + '</div>';
    });
    html += '<div style="height:12px"></div>';
    return { html: html, mount: function () {} };
  };

  views.category = function (params) {
    var slug = params.slug;
    var cats = (state.meta && state.meta.categories) || [];
    var found = null;
    cats.forEach(function (c) { (c.children || []).forEach(function (s) { if (s.slug === slug) found = { parent: c, sub: s }; }); });
    var name = found ? found.sub.name : 'Category';
    var html = header(name, {});
    html += '<div class="subcats" style="padding-top:12px">' +
      '<a class="chip" data-nav="#/browse?category=' + esc(found ? found.parent.slug : slug) + '">All ' + esc(found ? found.parent.name : name) + '</a>' +
      (found ? found.parent.children.map(function (s) {
        return '<a class="chip' + (s.slug === slug ? ' active' : '') + '" data-nav="#/category/' + esc(s.slug) + '">' + esc(s.name) + '</a>';
      }).join('') : '') + '</div>';
    html += '<div class="section" style="padding-top:12px"><div class="section-head"><h2>' + icon('grid-outline') + 'Listings</h2>' +
      '<span class="muted fs12" id="cat-count"></span></div></div>';
    html += '<div id="cat-results">' + '<div class="spinner"></div>' + '</div>';
    return {
      html: html,
      mount: function () {
        api.get('/listings?subcategory=' + encodeURIComponent(slug)).then(function (d) {
          var el = $('#cat-count'); if (el) el.textContent = d.total + ' found';
          var r = $('#cat-results');
          if (r) r.innerHTML = listingGrid(d.items);
        }).catch(function (e) {
          var r = $('#cat-results'); if (r) r.innerHTML = '<div class="empty"><p>' + esc(e.message) + '</p></div>';
        });
      }
    };
  };

  views.browse = function (query) {
    var q = query.get('q') || '';
    var filters = {
      q: q, category: query.get('category') || '', brand: '', model: '',
      condition: '', province: '', district: '', city: '', min: '', max: '',
      sort: 'recommended', page: 1, specs: {}
    };
    var html = header('Browse', { back: false, right: '<button class="icon-btn" data-nav="#/search">' + icon('search-outline') + '</button>' });
    html += '<form class="search-hero" id="browse-search" style="margin-top:14px"><span>' + icon('search-outline') + '</span>' +
      '<input type="search" placeholder="Search cameras, lenses, GoPro, DJI, drones..." value="' + esc(q) + '">' +
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
        function load() {
          filters.page = 1;
          var qs = buildQuery();
          $('#browse-results').innerHTML = '<div class="spinner"></div>';
          api.get('/listings?' + qs.toString()).then(function (d) {
            var c = $('#browse-count'); if (c) c.textContent = d.total + ' found';
            var r = $('#browse-results');
            if (r) {
              if (filters.page === 1) r.innerHTML = listingGrid(d.items);
            }
            var m = $('#browse-more');
            if (m) m.innerHTML = (filters.page < d.pages)
              ? '<button class="btn btn-outline btn-sm" id="load-more">Load more</button>' : '';
            var lm = $('#load-more');
            if (lm) lm.addEventListener('click', function () { filters.page++; loadMore(); });
            renderActiveChips();
          }).catch(function (e) { $('#browse-results').innerHTML = '<div class="empty"><p>' + esc(e.message) + '</p></div>'; });
        }
        function loadMore() {
          var qs = buildQuery();
          qs.set('page', filters.page);
          api.get('/listings?' + qs.toString()).then(function (d) {
            var r = $('#browse-results');
            var grid = r.querySelector('.listing-grid');
            if (grid) grid.insertAdjacentHTML('beforeend', d.items.map(lcard).join(''));
            var m = $('#browse-more');
            if (m) m.innerHTML = (filters.page < d.pages)
              ? '<button class="btn btn-outline btn-sm" id="load-more">Load more</button>' : '';
            var lm = $('#load-more');
            if (lm) lm.addEventListener('click', function () { filters.page++; loadMore(); });
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
      '<input type="search" placeholder="Search cameras, lenses, GoPro, DJI, drones..." autofocus>' +
      '<button type="submit">Search</button></div></form></div>';
    var cats = (state.meta && state.meta.categories) || [];
    html += '<div class="section"><div class="section-head"><h2>' + icon('grid-outline') + 'Search by Category</h2></div>' +
      '<div class="cat-grid">' + cats.map(catTile).join('') + '</div></div>';
    html += '<div class="section"><div class="section-head"><h2>' + icon('trending-up-outline') + 'Popular Searches</h2></div>' +
      '<div class="chips" style="padding:0 16px">' +
      ['Sony A7 III', 'Canon 50mm', 'GoPro', 'DJI Mini', 'Fujifilm', 'Sigma lens', 'Tripod', 'Gimbal'].map(function (s) {
        return '<a class="chip" data-nav="#/browse?q=' + encodeURIComponent(s) + '">' + esc(s) + '</a>';
      }).join('') + '</div></div>';
    return {
      html: html,
      mount: function () {
        $('#search-form').addEventListener('submit', function (e) {
          e.preventDefault();
          var q = $('input', this).value.trim();
          if (q) location.hash = '#/browse?q=' + encodeURIComponent(q);
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
    var ghtml = '<div class="gallery">' +
      '<button class="back" data-back>' + icon('chevron-back-outline') + '</button>' +
      '<button class="favbig' + (favOn ? ' active' : '') + '" data-fav="' + l.id + '">' + icon(favOn ? 'heart' : 'heart-outline') + '</button>' +
      '<div class="main">' + (imgs.length ? imgs.map(function (src) {
        return '<div class="slide"><img src="' + esc(src) + '" alt=""></div>';
      }).join('') : '<div class="slide" style="display:flex;align-items:center;justify-content:center;color:#889;font-size:60px">' + icon('camera-outline') + '</div>') + '</div>' +
      '<span class="counter" id="g-counter">1 / ' + Math.max(1, imgs.length) + '</span></div>' +
      (imgs.length > 1 ? '<div class="thumbs">' + imgs.map(function (src, i) {
        return '<div class="t' + (i === 0 ? ' active' : '') + '" data-thumb="' + i + '"><img src="' + esc(src) + '" alt=""></div>';
      }).join('') + '</div>' : '');

    var cond = l.condition || '—';
    var catName = l.category_name || '';
    var meta = '<div class="detail-wrap">' +
      (l.featured ? '<div style="margin-bottom:8px"><span class="vbadge" style="background:var(--accent-light);color:var(--accent-dark)">' + icon('flash-outline') + ' Featured</span></div>' : '') +
      '<div class="detail-price-row"><div><div class="detail-price">' + fmtLKR(l.price) + (l.negotiable ? ' <small>negotiable</small>' : '') + '</div></div>' +
      '<span class="vbadge">' + icon('pricetag-outline') + esc(catName) + '</span></div>' +
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
    // extras not in schema
    var extraKeys = ['warranty', 'receipt', 'charger', 'original_box', 'box', 'battery', 'batteries', 'accessories', 'reason_for_selling'];
    var doneKeys = (l.fields || []).map(function (f) { return f.name; });
    extraKeys.forEach(function (k) {
      if (doneKeys.indexOf(k) === -1 && l.specs && l.specs[k]) {
        specRows += '<div class="spec-row"><span class="k">' + esc(pretty(k)) + '</span><span class="v">' + esc(l.specs[k]) + '</span></div>';
      }
    });

    var specs = '<div class="detail-wrap" style="padding-top:0"><div class="section-head" style="margin-bottom:8px"><h2>' + icon('list-outline') + 'Specifications</h2></div>' +
      '<div class="info-card">' + (specRows || '<div class="spec-row"><span class="k">Details</span><span class="v">Contact seller for more info</span></div>') + '</div></div>';

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
      (s.business ? '<a class="biz-link" data-nav="#/shop/' + esc(s.business.slug) + '">' + icon('briefcase-outline') + ' Visit shop: ' + esc(s.business.name) + icon('chevron-forward-outline') + '</a>' : '') +
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
      api.post('/listings/' + l.id + '/contact', { kind: kind }).catch(function () {});
    }
    if ($('#btn-chat')) $('#btn-chat').addEventListener('click', function () {
      recordContact('chat');
      if (requireAuth()) location.hash = '#/chat/' + s.id + '?listing=' + l.id;
    });
    $('#btn-wa').addEventListener('click', function () {
      var num = phoneDigits(s.whatsapp || s.phone);
      if (!num) return toast('Seller did not share a number', 'error');
      recordContact('whatsapp');
      window.open('https://wa.me/' + num + '?text=' + encodeURIComponent('Hi, I\'m interested in your listing "' + l.title + '" on Lanka Lens.'), '_blank');
    });
    $('#btn-call').addEventListener('click', function () {
      if (!s.phone) return toast('Seller did not share a number', 'error');
      recordContact('call');
      window.location.href = 'tel:' + phoneDigits(s.phone);
    });
    $('#btn-more').addEventListener('click', function () {
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
    var url = location.origin + location.pathname + '#/ads/' + l.id;
    if (navigator.share) {
      navigator.share({ title: l.title, text: l.title + ' — ' + fmtLKR(l.price), url: url }).catch(function () {});
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
    var cats = (state.meta && state.meta.categories) || [];
    var html = header('Sell Your Camera', {});
    html += '<div class="section" style="padding-top:14px"><div class="section-head"><h2>' + icon('add-circle-outline') + 'Choose a Category</h2></div></div>';
    cats.forEach(function (c) {
      html += '<div class="divider-label">' + esc(c.name) + '</div>';
      html += '<div class="subcats" style="padding:0 16px 8px">' + (c.children || []).map(function (s) {
        return '<a class="chip" data-nav="#/sell/' + esc(s.slug) + '">' + esc(s.name) + '</a>';
      }).join('') + '</div>';
    });
    html += '<div style="height:12px"></div>';
    return { html: html, mount: function () {} };
  };

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
          '<p class="form-hint" style="margin-bottom:10px">Add up to 15 photos. The first photo is your cover. Use ★ to set a cover, arrows to reorder.</p>' +
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
      var imgsrc = showImg ? '<img src="' + esc(showImg) + '" alt="">' : '';
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
          : '<img src="' + esc(it.url) + '" alt="">';
        return '<div class="upload-tile has-img">' + (src && it.file ? '<img src="' + src + '" alt="">' : thumb) +
          (i === 0 ? '<span class="cover-badge">Cover</span>' : '') +
          '<span class="rm" data-wz-rm="' + i + '">' + icon('close-outline') + '</span>' +
          '<div class="tile-tools">' +
          '<button type="button" data-wz-left="' + i + '"' + (i === 0 ? ' disabled' : '') + '>' + icon('arrow-back-outline') + '</button>' +
          '<button type="button" data-wz-cover="' + i + '">' + icon('star-outline') + '</button>' +
          '<button type="button" data-wz-right="' + i + '"' + (i === wz.images.length - 1 ? ' disabled' : '') + '>' + icon('arrow-forward-outline') + '</button>' +
          '</div></div>';
      }).join('');
      grid.innerHTML = tiles + (wz.images.length < 15
        ? '<label class="upload-tile" id="wz-add">' + icon('add-outline') + '<input type="file" accept="image/*" multiple hidden></label>'
        : '');
      var inp = $('#wz-add input');
      if (inp) inp.addEventListener('change', function () {
        var picked = Array.prototype.slice.call(this.files || []);
        picked.forEach(function (f) {
          if (wz.images.length >= 15) return;
          var item = { file: f, _url: URL.createObjectURL(f) };
          wz.images.push(item);
        });
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
      if (i === 0) {
        $$('[data-spec]', $('#wizard-root')).forEach(function (inp) { wz.specs[inp.getAttribute('data-spec')] = inp.value; });
      } else if (i === 1) {
        $$('[data-spec]', $('#wizard-root')).forEach(function (inp) { if (inp.value) wz.specs[inp.getAttribute('data-spec')] = inp.value; });
      } else if (i === 2) {
        // condition handled via click handlers
      } else if (i === 3) {
        wz.price = $('#wz-price').value.trim();
        wz.negotiable = $('#wz-neg').checked;
      } else if (i === 4) {
        wz.title = $('#wz-title').value.trim();
        wz.description = $('#wz-desc').value.trim();
      } else if (i === 6) {
        var p = $('#wizard-root').querySelector('[data-loc="province"]');
        var d = $('#wizard-root').querySelector('[data-loc="district"]');
        var c = $('#wizard-root').querySelector('[data-loc="city"]');
        wz.province = p ? p.value : '';
        wz.district = d ? d.value : '';
        wz.city = c ? c.value : '';
      } else if (i === 7) {
        wz.contact = { phone: $('#wz-phone').checked, whatsapp: $('#wz-wa').checked, chat: $('#wz-chat').checked };
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

    function submit(status) {
      readStep();
      var problem = validate();
      if (status === 'active' && problem) return toast(problem, 'error');
      var btn = $('#wz-publish') || $('#wz-draft');
      var files = wz.images.filter(function (it) { return it.file; }).map(function (it) { return it.file; });
      function enable() { if (btn) { btn.disabled = false; } }
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
        if (btn) { btn.disabled = true; }
        var req = edit ? api.patch('/listings/' + edit.id, payload) : api.post('/listings', payload);
        req.then(function (r) {
          toast(status === 'draft' ? 'Draft saved' : (edit ? 'Listing updated' : 'Listing published!'), 'success');
          location.hash = status === 'draft' ? '#/my-ads' : '#/ads/' + r.id;
        }).catch(function (er) { toast(er.message, 'error'); enable(); });
      }
      if (files.length) {
        var fd = new FormData();
        files.forEach(function (f) { fd.append('files', f); });
        fetch('/api/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + api.token }, body: fd })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (!d.ok) throw new Error(d.error || 'Upload failed');
            finish(d.data.items.map(function (x) { return x.url; }));
          })
          .catch(function (er) { toast(er.message, 'error'); enable(); });
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
    var found = findSub(params.slug);
    if (!found) { location.hash = '#/sell'; return { html: '' }; }
    return listingWizardView(listingWizard({ cat: found }));
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
      ['All', 'Active', 'Pending', 'Draft', 'Sold', 'Expired', 'Paused'].map(function (s, i) {
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
    return '<div class="ad-row">' +
      '<div class="ad-thumb">' + (l.images && l.images[0] ? '<img src="' + esc(l.images[0]) + '" alt="">' : icon('camera-outline')) + '</div>' +
      '<div class="ad-main">' +
      '<div class="ad-title" data-nav="#/ads/' + l.id + '">' + esc(l.title) + '</div>' +
      '<div class="ad-sub">' + fmtLKR(l.price) + (l.negotiable ? ' · negotiable' : '') + ' · ' + l.views + ' views</div>' +
      '<div class="ad-meta">' + statusChip(l.status) +
      (expiring ? '<span class="status-chip" style="color:#C77D23;background:#C77D231a">Expiring soon</span>' : '') +
      (expiryLine ? '<span class="muted fs12">' + esc(expiryLine) + '</span>' : '') + '</div>' +
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
      (l.status === 'active' && !l.featured
        ? '<button class="btn btn-accent btn-sm" data-ad-act="promote" data-id="' + l.id + '">' + icon('flash-outline') + 'Promote</button>' : '') +
      '<button class="btn btn-danger btn-sm" data-ad-act="delete" data-id="' + l.id + '">' + icon('trash-outline') + '</button>' +
      '</div></div>';
  }

  function bindAdActions(root) {
    $$('[data-ad-act]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-id');
        var act = b.getAttribute('data-ad-act');
        if (act === 'edit') { location.hash = '#/edit-ad/' + id; return; }
        if (act === 'delete') {
          openDialog('Delete listing', '<p>This will permanently remove your listing. This cannot be undone.</p>', 'Delete', true, function () {
            api.del('/listings/' + id).then(function () { closeDialog(); toast('Listing deleted', 'success'); views.myAdsRemount(); });
          });
          return;
        }
        var statusMap = { pause: 'paused', resume: 'active', sold: 'sold', publish: 'active' };
        if (statusMap[act]) {
          api.patch('/listings/' + id, { status: statusMap[act] }).then(function () {
            toast('Listing ' + (act === 'sold' ? 'marked as sold' : act + 'd'), 'success');
            views.myAdsRemount();
          }).catch(function (e) { toast(e.message, 'error'); });
          return;
        }
        if (act === 'renew') {
          api.post('/listings/' + id + '/renew').then(function () { toast('Listing renewed for 30 days', 'success'); views.myAdsRemount(); });
          return;
        }
        if (act === 'promote') {
          openDialog('Promote listing', '<p>Promote this listing to the featured section on the homepage for more visibility.</p>', 'Promote', false, function () {
            api.post('/listings/' + id + '/promote').then(function () { closeDialog(); toast('Listing promoted', 'success'); views.myAdsRemount(); });
          });
          return;
        }
      });
    });
  }
  views.myAdsRemount = function () { var v = views.myAds(); if (v.mount) v.mount(); };

  views.favorites = function () {
    if (!requireAuth()) return { html: '' };
    var html = header('Favorites', { right: '<button class="icon-btn" data-nav="#/search">' + icon('search-outline') + '</button>' });
    html += '<div class="section"><div class="section-head"><h2>' + icon('heart-outline') + 'Saved Listings</h2></div></div>';
    html += '<div id="fav-list"><div class="spinner"></div></div>';
    return {
      html: html,
      mount: function () {
        api.get('/favorites').then(function (items) {
          var el = $('#fav-list');
          if (!items.length) {
            el.innerHTML = '<div class="empty"><div class="e-icon">' + icon('heart-outline') + '</div><h3>No favorites yet</h3><p>Tap the heart on any listing to save it here.</p><a class="btn btn-primary btn-sm" data-nav="#/browse" style="margin-top:12px">Browse listings</a></div>';
            return;
          }
          el.innerHTML = listingGrid(items);
        }).catch(function (e) { $('#fav-list').innerHTML = '<div class="empty"><p>' + esc(e.message) + '</p></div>'; });
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
        function load() {
          api.get('/chat/' + otherId).then(function (d) {
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
                (d.listing.image ? '<img src="' + esc(d.listing.image) + '" alt="">' : '<span class="ph">' + icon('camera-outline') + '</span>') +
                '<div class="tl-main"><b>' + esc(d.listing.title) + '</b><span>' + fmtLKR(d.listing.price) + '</span></div>' +
                icon('chevron-forward-outline') + '</div>';
            }
            if (d.blocked_by) hh += '<div class="thr-notice">' + icon('ban-outline') + 'This user has blocked messaging.</div>';
            else if (d.blocked) hh += '<div class="thr-notice">' + icon('ban-outline') + 'You blocked this user. <a id="thr-unblock">Unblock</a></div>';
            head.innerHTML = hh;
            var ub = $('#thr-unblock');
            if (ub) ub.addEventListener('click', function () { api.del('/chat/' + otherId + '/block').then(function () { load(); }); });
            var inp = $('#msg-input'), btn = $('#msg-send');
            if (inp) inp.disabled = blockedBy;
            if (btn) btn.disabled = blockedBy;
            window.scrollTo(0, document.body.scrollHeight);
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
                api.post('/chat/' + otherId + '/block').then(function () { closeDialog(); load(); });
              });
            } },
            { icon: 'flag-outline', label: 'Report user', danger: true, onClick: function () {
              var reasons = (state.meta && state.meta.report_reasons) || ['Scam', 'Fake product', 'Wrong information', 'Other'];
              openSheet('Report user', reasons.map(function (r) {
                return { icon: 'flag-outline', label: r, danger: true, onClick: function () {
                  api.post('/chat/' + otherId + '/report', { reason: r }).then(function () { toast('Reported — thanks', 'success'); });
                } };
              }));
            } }
          ]);
        });
        setInterval(load, 6000);
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
        api.get('/notifications').then(function (d) {
          var el = $('#notif-list');
          if (!d.items.length) { el.innerHTML = '<div class="empty"><div class="e-icon">' + icon('notifications-outline') + '</div><h3>No notifications</h3></div>'; return; }
          el.innerHTML = d.items.map(function (n) {
            var colors = { offer: '#C77D23', message: '#3A6FB0', listing: '#0E7C66', favorite: '#E5484D', promotion: '#F0A500', expiring: '#B04A3A', rating: '#9C4F96', info: '#74817C' };
            var ic = { offer: 'cash-outline', message: 'chatbubble-ellipses-outline', listing: 'camera-outline', favorite: 'heart-outline', promotion: 'flash-outline', expiring: 'hourglass-outline', rating: 'star-outline', info: 'notifications-outline' };
            return '<div class="notif-item' + (n.read ? '' : ' unread') + '"' + (n.link ? ' data-nav="' + esc(n.link) + '"' : '') + '>' +
              '<span class="ni-icon" style="background:' + (colors[n.type] || '#74817C') + '1a;color:' + (colors[n.type] || '#74817C') + '">' + icon(ic[n.type] || 'notifications-outline') + '</span>' +
              '<div class="ni-main"><b>' + esc(n.title) + '</b><p>' + esc(n.body) + '</p></div>' +
              '<span class="ni-time">' + timeAgo(n.created_at) + '</span></div>';
          }).join('');
        });
        $('#mark-read').addEventListener('click', function () {
          api.post('/notifications/read').then(function () {
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
    html += '<div class="divider-label">Account</div>';
    html += menuRow('duplicate-outline', '#0E7C66', 'My Ads', 'Manage your listings', '#/my-ads');
    html += menuRow('heart-outline', '#E5484D', 'Favorites', 'Saved listings', '#/favorites');
    html += menuRow('chatbubble-ellipses-outline', '#3A6FB0', 'Messages', 'Chat with buyers and sellers', '#/chat');
    html += menuRow('cash-outline', '#C77D23', 'My Offers', 'Offers made and received', '#/my-offers');
    html += menuRow('bar-chart-outline', '#0E7C66', 'Analytics', 'Views, calls & offers', '#/analytics');
    html += menuRow('briefcase-outline', '#3A6FB0', 'My Shop', 'Business page & hours', '#/my-shop');
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
        api.get('/me').then(function (d) {
          $('#p-l').textContent = d.counts.listings;
          $('#p-f').textContent = d.counts.favorites;
        });
        api.get('/me/offers').then(function (d) {
          $('#p-r').textContent = (d.received || []).length + (d.sent || []).length;
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
          $('#seller-root').innerHTML = header(s.name, {}) +
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
              api.post('/offers/' + b.getAttribute('data-accept'), { action: 'accept' }).then(function () { toast('Offer accepted', 'success'); views.myOffersRemount(); });
            });
          });
          $$('#offers-root [data-decline]').forEach(function (b) {
            b.addEventListener('click', function () {
              api.post('/offers/' + b.getAttribute('data-decline'), { action: 'decline' }).then(function () { toast('Offer declined'); views.myOffersRemount(); });
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
      '<div class="opt' + (u.seller_type === 'business' ? ' active' : '') + '" data-stype="business">Business</div></div></div>' +
      '<button class="btn btn-primary" type="submit">' + icon('checkmark-outline') + 'Save Changes</button></div></form>' +

      '<div class="form-card" style="margin-top:16px">' +
      '<div class="section-head" style="margin-bottom:4px"><h2>' + icon('briefcase-outline') + 'Business shop</h2></div>' +
      '<p class="form-hint" style="margin-bottom:10px">Business sellers get a public shop page with opening hours and contact details.</p>' +
      '<a class="btn btn-outline" data-nav="#/my-shop">' + icon('create-outline') + 'Manage my shop</a></div>' +

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
          fetch('/api/me/avatar', { method: 'POST', headers: { Authorization: 'Bearer ' + api.token }, body: fd })
            .then(function (r) { return r.json(); })
            .then(function (d) {
              if (!d.ok) throw new Error(d.error || 'Upload failed');
              state.user.avatar = d.data.url;
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
          api.post('/auth/resend-verification').then(function (d) {
            if (d.dev && d.dev.verify_email_token) {
              location.hash = '#/verify-email?token=' + encodeURIComponent(d.dev.verify_email_token);
            } else {
              toast('Verification link sent to your email', 'success');
            }
          }).catch(function (er) { toast(er.message, 'error'); });
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

  views.signin = function (query) {
    var html = header('Sign In', {});
    html += '<div class="auth-wrap"><div class="auth-hero">' + logoMark() + '<h1>Welcome back</h1><p>Sign in to manage your listings and chats.</p></div>' +
      '<form id="login-form"><div class="form-group"><label>Email</label><input class="input" type="email" name="email" required placeholder="you@example.com"></div>' +
      '<div class="form-group"><label>Password</label><input class="input" type="password" name="password" required placeholder="••••••••"></div>' +
      '<button class="btn btn-primary" type="submit">Sign In</button></form>' +
      '<div class="flex jcsb aic" style="margin-top:10px">' +
      '<a class="fs12 fw7" data-nav="#/forgot">Forgot password?</a></div>' +
      '<p class="form-hint" style="margin-top:10px;text-align:center">Demo: <b>demo@lankalens.lk</b> / <b>demo1234</b></p>' +
      '<div class="auth-alt">New to Lanka Lens? <a data-nav="#/sign-up">Create an account</a></div></div>';
    return {
      html: html,
      mount: function () {
        $('#login-form').addEventListener('submit', function (e) {
          e.preventDefault();
          api.post('/auth/login', { email: $('[name="email"]', this).value, password: $('[name="password"]', this).value }).then(function (d) {
            api.token = d.token; localStorage.setItem('ll_token', d.token);
            setUser(d.user);
            toast('Welcome back, ' + d.user.name.split(' ')[0] + '!', 'success');
            var next = query.get('next');
            location.hash = next && next !== '#/sign-in' ? next : '#/';
          }).catch(function (er) { toast(er.message, 'error'); });
        });
      }
    };
  };

  views.signup = function () {
    var html = header('Create Account', {});
    html += '<div class="auth-wrap"><div class="auth-hero">' + logoMark() + '<h1>Join Lanka Lens</h1><p>Create a free account to buy and sell camera gear.</p></div>' +
      '<form id="signup-form"><div class="form-group"><label>Full name</label><input class="input" name="name" required placeholder="Your name"></div>' +
      '<div class="form-group"><label>Email</label><input class="input" type="email" name="email" required placeholder="you@example.com"></div>' +
      '<div class="form-group"><label>Phone (optional)</label><input class="input" name="phone" placeholder="+94 77 123 4567"></div>' +
      '<div class="form-group"><label>Password</label><input class="input" type="password" name="password" required placeholder="At least 6 characters"></div>' +
      '<div class="form-group"><label>I am a…</label><div class="seg" id="stype-seg">' +
      '<div class="opt active" data-stype="individual">Individual</div>' +
      '<div class="opt" data-stype="business">Business</div></div></div>' +
      '<button class="btn btn-primary" type="submit">Create Account</button></form>' +
      '<div id="verify-banner"></div>' +
      '<div class="auth-alt">Already have an account? <a data-nav="#/sign-in">Sign in</a></div></div>';
    return {
      html: html,
      mount: function () {
        var stype = 'individual';
        $$('#stype-seg .opt').forEach(function (o) {
          o.addEventListener('click', function () {
            $$('#stype-seg .opt').forEach(function (x) { x.classList.remove('active'); });
            o.classList.add('active');
            stype = o.getAttribute('data-stype');
          });
        });
        $('#signup-form').addEventListener('submit', function (e) {
          e.preventDefault();
          var pw = $('[name="password"]', this).value;
          api.post('/auth/signup', {
            name: $('[name="name"]', this).value, email: $('[name="email"]', this).value,
            phone: $('[name="phone"]', this).value, password: pw, seller_type: stype
          }).then(function (d) {
            api.token = d.token; localStorage.setItem('ll_token', d.token);
            setUser(d.user);
            toast('Account created — welcome!', 'success');
            if (d.dev && d.dev.verify_email_token) {
              $('#verify-banner').innerHTML = '<div class="info-card mt16" style="padding:13px 14px">' +
                '<div class="fs13" style="color:var(--ink)"><b>Verify your email</b></div>' +
                '<p class="fs12 muted" style="margin:6px 0 10px">We sent a link to your inbox. In this dev build you can verify instantly:</p>' +
                '<a class="btn btn-primary btn-sm" data-nav="#/verify-email?token=' + encodeURIComponent(d.dev.verify_email_token) + '">Verify now</a></div>';
            } else {
              location.hash = '#/';
            }
          }).catch(function (er) { toast(er.message, 'error'); });
        });
      }
    };
  };

  views.signout = function () {
    api.post('/auth/logout').catch(function () {});
    api.token = ''; localStorage.removeItem('ll_token');
    state.user = null; state.favIds = [];
    renderDrawer(); renderTabbar();
    toast('Signed out');
    location.hash = '#/';
    return { html: '<div class="spinner" style="margin-top:80px"></div>', mount: function () {} };
  };

  views.contact = function () {
    var html = header('Contact', {});
    html += '<div class="hero-page"><h1>Get in touch</h1><p>Questions, feedback or a partnership idea — we’d love to hear from you.</p></div>';
    html += '<div class="detail-wrap"><form id="contact-form"><div class="form-card">' +
      '<div class="form-group"><label>Name</label><input class="input" name="name" required></div>' +
      '<div class="form-group"><label>Email</label><input class="input" type="email" name="email"></div>' +
      '<div class="form-group"><label>Subject</label><input class="input" name="subject"></div>' +
      '<div class="form-group"><label>Message</label><textarea class="textarea" name="message" required style="min-height:120px"></textarea></div>' +
      '<button class="btn btn-primary" type="submit">' + icon('send-outline') + 'Send Message</button></div></form>' +
      '<div class="form-card" style="margin-top:16px"><div class="section-head" style="margin-bottom:4px"><h2>' + icon('information-circle-outline') + 'Contact details</h2></div>' +
      '<div class="spec-row"><span class="k">Email</span><span class="v">hello@lankalens.lk</span></div>' +
      '<div class="spec-row"><span class="k">Phone</span><span class="v">+94 77 000 1111</span></div>' +
      '<div class="spec-row"><span class="k">Head office</span><span class="v">Colombo, Sri Lanka</span></div></div></div><div style="height:16px"></div>';
    return {
      html: html,
      mount: function () {
        $('#contact-form').addEventListener('submit', function (e) {
          e.preventDefault();
          api.post('/contact', {
            name: $('[name="name"]', this).value, email: $('[name="email"]', this).value,
            subject: $('[name="subject"]', this).value, message: $('[name="message"]', this).value
          }).then(function () { toast('Message sent — thank you!', 'success'); this.reset(); }.bind(this));
        });
      }
    };
  };

  views.blog = function () {
    var html = header('Buying Guides', {});
    html += '<div class="hero-page" style="padding:22px 20px"><h1 style="font-size:20px">Camera guides & tips</h1><p>Practical advice for buying, selling and shooting in Sri Lanka.</p></div>';
    html += '<div id="posts-list"><div class="spinner"></div></div>';
    return {
      html: html,
      mount: function () {
        api.get('/posts').then(function (posts) {
          var el = $('#posts-list');
          if (!posts.length) { el.innerHTML = '<div class="empty"><p>No posts yet.</p></div>'; return; }
          el.innerHTML = posts.map(function (p) {
            return '<div class="post-card" data-nav="#/blog/' + esc(p.slug) + '">' +
              (p.image ? '<img class="thumb" src="' + esc(p.image) + '" alt="">' : '') +
              '<div class="meta"><span class="cat">' + esc(p.category || 'Guide') + '</span><b>' + esc(p.title) + '</b>' +
              '<span class="excerpt">' + esc(p.excerpt) + '</span></div></div>';
          }).join('');
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
          $('#post-root').innerHTML = header('Guide', {}) +
            (p.image ? '<img src="' + esc(p.image) + '" style="width:100%;height:210px;object-fit:cover" alt="">' : '') +
            '<div class="detail-wrap"><span class="vbadge">' + esc(p.category || 'Guide') + '</span>' +
            '<h1 class="detail-title" style="margin-top:10px">' + esc(p.title) + '</h1>' +
            '<div class="detail-meta"><span>' + icon('person-outline') + esc(p.author || 'Lanka Lens') + '</span><span>' + icon('calendar-outline') + fmtDate(p.created_at) + '</span></div></div>' +
            '<div class="prose">' + (p.body || '') + '</div>';
        }).catch(function (e) {
          $('#post-root').innerHTML = header('Guide', {}) + '<div class="empty"><p>' + esc(e.message) + '</p></div>';
        });
      }
    };
  };

  views.shops = function () {
    var html = header('Camera Shops', {});
    html += '<div class="hero-page" style="padding:22px 20px"><h1 style="font-size:20px">Trusted camera shops</h1><p>Authorised dealers and specialist stores across Sri Lanka.</p></div>';
    html += '<div id="shops-list"><div class="spinner"></div></div>';
    return {
      html: html,
      mount: function () {
        api.get('/shops').then(function (shops) {
          var el = $('#shops-list');
          if (!shops.length) { el.innerHTML = '<div class="empty"><p>No shops listed yet.</p></div>'; return; }
          el.innerHTML = '<div class="detail-wrap" style="display:grid;gap:14px">' + shops.map(function (s) {
            return '<div class="shop-card">' +
              '<div class="cover">' + (s.image ? '<img src="' + esc(s.image) + '" alt="">' : '') + '</div>' +
              '<div class="body"><div class="name">' + esc(s.name) + (s.verified ? '<span class="vbadge">' + icon('shield-checkmark') + 'Verified</span>' : '') + '</div>' +
              '<div class="area">' + icon('location-outline') + esc([s.area, s.city, s.province].filter(Boolean).join(', ')) + '</div>' +
              '<p class="fs13 muted" style="margin-top:8px;line-height:1.5">' + esc(s.description) + '</p>' +
              '<div class="specs">' + (s.specialties || '').split(',').map(function (x) { return '<span class="chip">' + esc(x.trim()) + '</span>'; }).join('') + '</div>' +
              '<div class="flex gap8" style="margin-top:12px">' +
              '<button class="btn btn-primary btn-sm" data-call-shop="' + esc(s.phone) + '">' + icon('call-outline') + 'Call</button>' +
              '<button class="btn btn-wa btn-sm" data-wa-shop="' + esc(s.whatsapp || s.phone) + '">' + icon('logo-whatsapp') + 'WhatsApp</button></div></div></div>';
          }).join('') + '</div><div style="height:16px"></div>';
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
      title: 'Buying Guide', hero: 'Buying Guide', sub: 'How to inspect and buy used camera gear with confidence.',
      body: '<p class="lead">Follow this checklist before you hand over your money.</p>' +
        '<h3>1. Inspect the sensor</h3><p>Set the camera to its smallest aperture, shoot a plain white wall, and review the image for dark specks (dust) or streaks (scratches/oil).</p>' +
        '<h3>2. Check the shutter count</h3><p>Most shutters are rated for 150,000–200,000 actuations. Lower is better; factor a high count into your offer.</p>' +
        '<h3>3. Examine the lens</h3><p>Hold the lens up to light and look through it for fungus, haze and dust. Rotate focus and zoom rings — they should move smoothly with no grinding.</p>' +
        '<h3>4. Test every function</h3><p>Battery, memory card slot, flash, hotshoe, screen, and every dial and button. Bring your own memory card to test shooting.</p>' +
        '<h3>5. Check box, receipt and warranty</h3><p>Original packaging and a receipt usually mean a genuine, well-cared-for item. Ask about any remaining warranty.</p>'
    },
    'sell-your-camera': {
      title: 'Sell Your Camera', hero: 'Sell Your Camera', sub: 'Turn your unused gear into cash in three steps.',
      body: '<p class="lead">Listing on Lanka Lens is free and takes only a few minutes.</p>' +
        '<h3>1. Choose a category</h3><p>Pick the right category — the listing form shows fields that match your item (shutter count for cameras, mount for lenses, and so on).</p>' +
        '<h3>2. Add photos and details</h3><p>Listings with clear photos and complete specifications sell much faster. Add up to 15 photos and an honest description.</p>' +
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
        '<h3>Your choices</h3><p>You can update or delete your account information from Settings. Contact us at hello@lankalens.lk with any privacy questions.</p>'
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
        '<h3>Posting a listing</h3><ul><li>Tap the orange + button, choose a category and fill in the details.</li><li>Add up to 15 photos — your first photo is the cover image.</li><li>Set a price in Sri Lankan Rupees (LKR).</li></ul>' +
        '<h3>Buying</h3><ul><li>Use search or browse by category, brand and location.</li><li>Contact sellers by Call, WhatsApp or Chat from any listing.</li><li>Save listings with the heart icon to find them again in Favorites.</li></ul>' +
        '<h3>Account</h3><ul><li>Update your name, phone and location in Settings.</li><li>Manage your ads in My Ads — mark items as sold or delete them.</li><li>Track offers in My Offers.</li></ul>' +
        '<h3>Still stuck?</h3><p>Email hello@lankalens.lk or use the contact form.</p>'
    }
  };

  function staticPage(slug) {
    var cfg = STATIC_PAGES[slug];
    return function () {
      var html = header(cfg.title, {});
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
    var html = header('Forgot Password', {});
    html += '<div class="auth-wrap"><div class="auth-hero">' + logoMark() + '<h1>Reset your password</h1><p>Enter your email and we’ll send you a reset link.</p></div>' +
      '<form id="forgot-form"><div class="form-group"><label>Email</label><input class="input" type="email" name="email" required placeholder="you@example.com"></div>' +
      '<button class="btn btn-primary" type="submit">Send reset link</button></form>' +
      '<div id="reset-banner"></div>' +
      '<div class="auth-alt">Remembered it? <a data-nav="#/sign-in">Sign in</a></div></div>';
    return {
      html: html,
      mount: function () {
        $('#forgot-form').addEventListener('submit', function (e) {
          e.preventDefault();
          api.post('/auth/forgot', { email: $('[name="email"]', this).value }).then(function (d) {
            if (d.dev && d.dev.reset_token) {
              $('#reset-banner').innerHTML = '<div class="info-card mt16" style="padding:13px 14px"><div class="fs13" style="color:var(--ink)"><b>Reset link created</b></div><p class="fs12 muted" style="margin:6px 0 10px">We emailed you a link. In this dev build:</p><a class="btn btn-primary btn-sm" data-nav="#/reset-password?token=' + encodeURIComponent(d.dev.reset_token) + '">Open reset page</a></div>';
            } else {
              $('#reset-banner').innerHTML = '<div class="info-card mt16" style="padding:13px 14px"><p class="fs13">If that email exists, a reset link has been sent.</p></div>';
            }
          }).catch(function (er) { toast(er.message, 'error'); });
        });
      }
    };
  };

  views.resetPassword = function (q) {
    var token = q.get('token') || '';
    var html = header('Set New Password', {});
    html += '<div class="auth-wrap"><div class="auth-hero"><h1>Choose a new password</h1><p>Enter a new password for your account.</p></div>' +
      '<form id="reset-form"><div class="form-group"><label>New password</label><input class="input" type="password" name="password" required placeholder="At least 6 characters"></div>' +
      '<div class="form-group"><label>Confirm password</label><input class="input" type="password" name="confirm" required placeholder="Repeat it"></div>' +
      '<button class="btn btn-primary" type="submit">Reset password</button></form>' +
      '<div class="auth-alt"><a data-nav="#/sign-in">Back to sign in</a></div></div>';
    return {
      html: html,
      mount: function () {
        $('#reset-form').addEventListener('submit', function (e) {
          e.preventDefault();
          var pw = $('[name="password"]', this).value;
          var cf = $('[name="confirm"]', this).value;
          if (pw !== cf) return toast('Passwords do not match', 'error');
          api.post('/auth/reset', { token: token, password: pw }).then(function () {
            toast('Password reset — sign in with your new password', 'success');
            location.hash = '#/sign-in';
          }).catch(function (er) { toast(er.message, 'error'); });
        });
      }
    };
  };

  views.verifyEmail = function (q) {
    var token = q.get('token') || '';
    var html = header('Verify Email', {});
    html += '<div id="verify-root"><div class="spinner" style="margin-top:80px"></div></div>';
    return {
      html: html,
      mount: function () {
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
            return '<div class="row-item"><div class="an-thumb">' + (l.image ? '<img src="' + esc(l.image) + '" alt="">' : icon('camera-outline')) + '</div>' +
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
    var html = header('My Shop', {});
    html += '<div id="shop-root"><div class="spinner"></div></div>';
    return {
      html: html,
      mount: function () { load(); }
    };
    function load() {
      api.get('/me/business').then(function (biz) { render(biz || {}); })
        .catch(function (e) { $('#shop-root').innerHTML = '<div class="empty"><p>' + esc(e.message) + '</p></div>'; });
    }
    function render(biz) {
      var hours = biz.opening_hours || {};
      var days = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];
      var h = '';
      if ((state.user.seller_type || 'individual') !== 'business') {
        h += '<div class="detail-wrap" style="padding-bottom:0"><div class="info-card" style="padding:16px">' +
          '<div class="fs13 fw7">Switch to a business account</div>' +
          '<p class="fs12 muted" style="margin:6px 0 12px">Business sellers get a public shop page with opening hours and contact details.</p>' +
          '<button class="btn btn-primary" id="become-business">Become a business seller</button></div></div>';
      }
      h += '<div class="detail-wrap"><form id="shop-form"><div class="form-card">' +
        '<div class="section-head" style="margin-bottom:4px"><h2>' + icon('briefcase-outline') + 'Shop details</h2></div>' +
        '<div class="form-group"><label>Business name</label><input class="input" name="name" value="' + esc(biz.name || '') + '" placeholder="e.g. Colombo Camera House"></div>' +
        '<div class="form-group"><label>Logo</label><div class="flex aic gap8">' +
        (biz.logo ? '<img id="logo-prev" class="logo-prev" src="' + esc(biz.logo) + '" alt="">' : '<span id="logo-prev" class="logo-prev ph">' + icon('image-outline') + '</span>') +
        '<label class="btn btn-outline btn-sm" style="width:auto">Upload<input type="file" id="logo-input" accept="image/*" hidden></label></div></div>' +
        '<div class="form-group"><label>Description</label><textarea class="textarea" name="description" style="min-height:90px">' + esc(biz.description || '') + '</textarea></div>' +
        '<div class="form-group"><label>Area / Street</label><input class="input" name="area" value="' + esc(biz.area || '') + '" placeholder="e.g. Galle Road"></div>' +
        '<div class="form-group"><label>Phone</label><input class="input" name="phone" value="' + esc(biz.phone || '') + '" placeholder="+94 11 250 4400"></div>' +
        '<div class="form-group"><label>WhatsApp</label><input class="input" name="whatsapp" value="' + esc(biz.whatsapp || '') + '" placeholder="94112504400"></div></div>' +
        '<div class="form-card" style="margin-top:16px"><div class="section-head" style="margin-bottom:4px"><h2>' + icon('location-outline') + 'Location</h2></div>' +
        locationSelectsHtml() + '</div>' +
        '<div class="form-card" style="margin-top:16px"><div class="section-head" style="margin-bottom:4px"><h2>' + icon('time-outline') + 'Opening hours</h2></div>' +
        days.map(function (d) {
          return '<div class="form-group"><label>' + d[1] + '</label><input class="input" name="hours_' + d[0] + '" value="' + esc(hours[d[0]] || '') + '" placeholder="9:00 AM – 6:00 PM or Closed"></div>';
        }).join('') + '</div>' +
        '<button class="btn btn-primary" style="margin-top:16px" type="submit">' + icon('checkmark-outline') + 'Save shop</button>' +
        '</form></div><div style="height:16px"></div>';
      $('#shop-root').innerHTML = h;
      if ((state.user.seller_type || 'individual') === 'business' && biz.slug) {
        $('#shop-root').insertAdjacentHTML('afterbegin', '<div class="detail-wrap" style="padding-bottom:0"><div class="promo" data-nav="#/shop/' + esc(biz.slug) + '"><div class="p-icon">' + icon('eye-outline') + '</div><div><b>View your public shop page</b><span>Share this link with customers</span></div><div class="go">' + icon('chevron-forward-outline') + '</div></div></div>');
      }
      var bb = $('#become-business');
      if (bb) bb.addEventListener('click', function () {
        api.patch('/me', { seller_type: 'business' }).then(function (d) { state.user = d.user; renderDrawer(); render({}); });
      });
      bindLocationSelects($('#shop-root'), { province: biz.province, district: biz.district, city: biz.city });
      $('#logo-input').addEventListener('change', function () {
        var f = this.files[0];
        if (!f) return;
        var fd = new FormData(); fd.append('file', f);
        fetch('/api/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + api.token }, body: fd })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (!d.ok) throw new Error(d.error || 'Upload failed');
            biz.logo = d.data.items[0].url;
            var p = $('#logo-prev');
            if (p) p.outerHTML = '<img id="logo-prev" class="logo-prev" src="' + esc(biz.logo) + '" alt="">';
          }).catch(function (e) { toast(e.message, 'error'); });
      });
      $('#shop-form').addEventListener('submit', function (e) {
        e.preventDefault();
        var oh = {};
        days.forEach(function (d) { var v = $('[name="hours_' + d[0] + '"]', this).value.trim(); if (v) oh[d[0]] = v; }.bind(this));
        var prov = $('#shop-root').querySelector('[data-loc="province"]').value;
        var dist = $('#shop-root').querySelector('[data-loc="district"]').value;
        var city = $('#shop-root').querySelector('[data-loc="city"]').value;
        api.put('/me/business', {
          name: $('[name="name"]', this).value, logo: biz.logo || '', description: $('[name="description"]', this).value,
          area: $('[name="area"]', this).value, phone: $('[name="phone"]', this).value, whatsapp: $('[name="whatsapp"]', this).value,
          province: prov, district: dist, city: city, opening_hours: oh
        }).then(function (d) {
          state.user.seller_type = 'business';
          renderDrawer(); renderTabbar();
          toast('Shop saved', 'success');
          location.hash = '#/shop/' + d.slug;
        }).catch(function (er) { toast(er.message, 'error'); });
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
          var days = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
          var hoursHtml = days.map(function (dd) {
            return '<div class="spec-row"><span class="k">' + dd[1] + '</span><span class="v">' + esc((b.opening_hours || {})[dd[0]] || '—') + '</span></div>';
          }).join('');
          $('#shop-page').innerHTML = header(b.name, {}) +
            '<div class="hero-page" style="text-align:center">' +
            (b.logo ? '<img class="shop-logo" src="' + esc(b.logo) + '" alt="">' : '<div style="width:76px;height:76px;margin:0 auto;border-radius:18px;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:34px">' + icon('briefcase-outline') + '</div>') +
            '<h1>' + esc(b.name) + '</h1>' +
            '<p>' + (b.verified ? icon('shield-checkmark') + ' Verified business · ' : '') + esc([b.city, b.province].filter(Boolean).join(', ') || 'Sri Lanka') + '</p>' +
            '<p style="margin-top:8px">' + starsHtml(d.rating ? d.rating.avg : 0, d.rating ? d.rating.count : 0) + '</p></div>' +
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
          $('#shop-page').innerHTML = header('Shop', {}) + '<div class="empty"><p>' + esc(e.message) + '</p></div>';
        });
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
    { re: /^\/sign-up$/, handler: function () { return views.signup(); } },
    { re: /^\/forgot$/, handler: function () { return views.forgot(); } },
    { re: /^\/reset-password$/, handler: function (p, q) { return views.resetPassword(q); } },
    { re: /^\/verify-email$/, handler: function (p, q) { return views.verifyEmail(q); } },
    { re: /^\/sign-out$/, handler: function () { return views.signout(); } },
    { re: /^\/contact$/, handler: function () { return views.contact(); } },
    { re: /^\/blog$/, handler: function () { return views.blog(); } },
    { re: /^\/blog\/([^\/]+)$/, handler: function (p, q, m) { return views.post({ slug: m[1] }); } },
    { re: /^\/shops$/, handler: function () { return views.shops(); } },
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
  function render() {
    var h = parseHash();
    state.route = h;
    var route = currentRoute();
    var v = route.view;
    var page = $('#page');
    page.innerHTML = v.html;
    document.getElementById('app').classList.toggle('hide-tabbar', !!v.hideTabbar);
    window.scrollTo(0, 0);
    updateTabbar(h.path);
    renderDrawer();
    if (v.mount) {
      try { v.mount(); } catch (e) { console.error(e); }
    }
  }

  function updateTabbar(path) {
    $$('.app-tabbar a[data-tab]').forEach(function (a) {
      var key = a.getAttribute('data-tab');
      var active = (key === 'home' && (path === '/' || path === '/browse' || path === '/search')) ||
        (key === 'categories' && path.indexOf('/category') === 0) ||
        (key === 'favorites' && path === '/favorites') ||
        (key === 'profile' && (path === '/profile' || path === '/settings' || path === '/my-ads' || path === '/my-offers' || path === '/analytics' || path === '/my-shop' || path.indexOf('/edit-ad') === 0));
      a.classList.toggle('active', active);
    });
  }

  function renderTabbar() {
    var el = $('#tabbar');
    if (!el) return;
    el.innerHTML =
      '<a data-tab="home" data-nav="#/" class="active"><span>' + icon('home-outline') + '</span>Home</a>' +
      '<a data-tab="categories" data-nav="#/categories"><span>' + icon('grid-outline') + '</span>Categories</a>' +
      '<a class="sell-tab" data-nav="#/sell"><span class="sell-fab">' + icon('add-outline') + '</span><span>Sell</span></a>' +
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
      ['briefcase-outline', 'My Shop', '#/my-shop'],
      ['notifications-outline', 'Notifications', '#/notifications'],
      ['settings-outline', 'Settings', '#/settings']
    ] : [];
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
  function boot() {
    renderTabbar();
    renderDrawer();

    Promise.all([
      api.get('/meta').then(function (d) { state.meta = d; }),
      api.get('/locations').then(function (d) { state.locations = d; })
    ]).catch(function () {}).then(function () {
      render();
    });

    if (api.token) {
      api.get('/me').then(function (d) {
        state.user = d.user;
        renderDrawer(); renderTabbar();
      }).catch(function () {
        api.token = ''; localStorage.removeItem('ll_token');
      }).then(function () { refreshFavIds(); });
    }
    bindGlobal();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
