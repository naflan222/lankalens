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
    return '<span class="avatar"><span class="circle" style="background:' + avColor(user.name) + ';width:' + c + 'px;height:' + c + 'px;font-size:' + Math.round(c / 2.6) + 'px">' + esc(initials(user.name)) + '</span></span>';
  }
  function phoneDigits(p) {
    var d = (p || '').replace(/\D/g, '');
    if (d.indexOf('0') === 0) d = '94' + d.slice(1);
    return d;
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
    var html = header('Browse', { back: false, right: '<button class="icon-btn" data-nav="#/search">' + icon('search-outline') + '</button>' });
    html += '<form class="search-hero" id="browse-search" style="margin-top:14px"><span>' + icon('search-outline') + '</span>' +
      '<input type="search" placeholder="Search cameras, lenses, GoPro, DJI, drones..." value="' + esc(q) + '">' +
      '<button type="submit">Search</button></form>';
    html += '<div class="filter-row" id="browse-filters">' +
      '<button class="chip" id="btn-sort">' + icon('swap-vertical-outline') + 'Sort</button>' +
      '<button class="chip" id="btn-cond">' + icon('filter-outline') + 'Condition</button>' +
      '<button class="chip" id="btn-loc">' + icon('location-outline') + 'Location</button></div>';
    html += '<div class="section" style="padding-top:8px"><div class="section-head"><h2>' + icon('search-outline') + 'Results</h2>' +
      '<span class="muted fs12" id="browse-count"></span></div></div>';
    html += '<div id="browse-results"><div class="spinner"></div></div>';
    html += '<div id="browse-more" style="text-align:center;padding:8px 16px 20px"></div>';
    return {
      html: html,
      mount: function () {
        var params = { q: q, sort: 'newest', page: 1 };
        var total = 0;
        function load() {
          var qs = new URLSearchParams();
          Object.keys(params).forEach(function (k) { if (params[k] !== '' && params[k] != null) qs.set(k, params[k]); });
          $('#browse-results').innerHTML = '<div class="spinner"></div>';
          api.get('/listings?' + qs.toString()).then(function (d) {
            total = d.total;
            var c = $('#browse-count'); if (c) c.textContent = d.total + ' found';
            var r = $('#browse-results');
            if (r) {
              if (params.page === 1) r.innerHTML = listingGrid(d.items);
              else r.querySelector('.listing-grid').insertAdjacentHTML('beforeend', d.items.map(lcard).join(''));
            }
            var m = $('#browse-more');
            if (m) m.innerHTML = (params.page < d.pages)
              ? '<button class="btn btn-outline btn-sm" id="load-more">Load more</button>' : '';
            var lm = $('#load-more');
            if (lm) lm.addEventListener('click', function () { params.page++; load(); });
          }).catch(function (e) { $('#browse-results').innerHTML = '<div class="empty"><p>' + esc(e.message) + '</p></div>'; });
        }
        load();
        var f = $('#browse-search');
        f.addEventListener('submit', function (e) { e.preventDefault(); params.q = $('input', f).value.trim(); params.page = 1; load(); });
        $('#btn-sort').addEventListener('click', function () {
          openSheet('Sort by', [
            { icon: 'time-outline', label: 'Newest first', onClick: function () { params.sort = 'newest'; params.page = 1; load(); } },
            { icon: 'eye-outline', label: 'Most viewed', onClick: function () { params.sort = 'popular'; params.page = 1; load(); } },
            { icon: 'arrow-up-outline', label: 'Price: low to high', onClick: function () { params.sort = 'price_asc'; params.page = 1; load(); } },
            { icon: 'arrow-down-outline', label: 'Price: high to low', onClick: function () { params.sort = 'price_desc'; params.page = 1; load(); } }
          ]);
        });
        $('#btn-cond').addEventListener('click', function () {
          var conds = state.meta ? state.meta.conditions : [];
          openSheet('Condition', conds.map(function (c) {
            return { label: c, onClick: function () { params.condition = (params.condition === c ? '' : c); params.page = 1; load(); } };
          }));
        });
        $('#btn-loc').addEventListener('click', function () {
          var provs = state.locations || [];
          openSheet('Province', provs.map(function (p) {
            return { icon: 'location-outline', label: p.name, onClick: function () {
              params.province = (params.province === p.name ? '' : p.name);
              params.district = ''; params.city = ''; params.page = 1; load();
            } };
          }));
        });
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
      '<div class="info"><div class="name">' + esc(s.name) + (s.verified ? '<span class="vbadge">' + icon('shield-checkmark') + 'Verified</span>' : '') + '</div>' +
      '<div class="loc">' + icon('location-outline') + esc([s.city, s.province].filter(Boolean).join(', ') || 'Sri Lanka') + '</div>' +
      '<div class="loc">' + icon('time-outline') + 'Member since ' + fmtDate(s.created_at) + '</div></div>' +
      '<div class="chev">' + icon('chevron-forward-outline') + '</div></div></div>';

    var related = (l.related || []).length ? '<div class="section"><div class="section-head"><h2>' + icon('albums-outline') + 'Related Listings</h2></div>' +
      '<div class="hscroll">' + l.related.map(lcard).join('') + '</div></div>' : '';

    var safe = '<div class="detail-wrap" style="padding-top:0">' +
      '<div class="info-card" style="display:flex;gap:10px;align-items:center;background:var(--brand-light);border-color:transparent;padding:13px 14px">' +
      '<span style="color:var(--brand);font-size:24px">' + icon('shield-checkmark') + '</span>' +
      '<div style="font-size:12.5px;color:var(--ink-2)"><b style="color:var(--ink)">Stay safe.</b> Meet in a public place, test before you pay, and never send money in advance. <a data-nav="#/safety" style="font-weight:700">Safety tips</a></div></div></div>';

    var actionBar = '<div class="action-bar">' +
      '<button class="icon-action" data-fav="' + l.id + '" id="ab-fav">' + icon(favOn ? 'heart' : 'heart-outline') + '</button>' +
      '<button class="btn btn-wa" id="btn-wa">' + icon('logo-whatsapp') + 'WhatsApp</button>' +
      '<button class="btn btn-primary" id="btn-call">' + icon('call-outline') + 'Call</button>' +
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

    $('#btn-wa').addEventListener('click', function () {
      var num = phoneDigits(s.whatsapp || s.phone);
      if (!num) return toast('Seller did not share a number', 'error');
      window.open('https://wa.me/' + num + '?text=' + encodeURIComponent('Hi, I\'m interested in your listing "' + l.title + '" on Lanka Lens.'), '_blank');
    });
    $('#btn-call').addEventListener('click', function () {
      if (!s.phone) return toast('Seller did not share a number', 'error');
      window.location.href = 'tel:' + phoneDigits(s.phone);
    });
    $('#btn-more').addEventListener('click', function () {
      openSheet(null, [
        { icon: 'chatbubble-ellipses-outline', label: 'Chat with seller', onClick: function () { if (requireAuth()) location.hash = '#/chat/' + s.id; } },
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
    var reasons = ['Scam or fraud', 'Wrong price', 'Duplicate listing', 'Prohibited item', 'Misleading description', 'Other'];
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

  views.sellForm = function (params) {
    if (!requireAuth()) return { html: '' };
    var slug = params.slug;
    var cats = (state.meta && state.meta.categories) || [];
    var found = null;
    cats.forEach(function (c) { (c.children || []).forEach(function (s) { if (s.slug === slug) found = { parent: c, sub: s }; }); });
    if (!found) { location.hash = '#/sell'; return { html: '' }; }
    var fields = found.sub.fields && found.sub.fields.length ? found.sub.fields : found.parent.fields;

    var html = header(found.sub.name, {});
    html += '<div class="detail-wrap"><form id="sell-form">';
    html += '<div class="form-card">';
    html += '<div class="form-group"><label>Listing title <span class="req">*</span></label>' +
      '<input class="input" name="title" placeholder="e.g. Sony A7 III body, excellent condition" required></div>';
    html += '<div class="form-group"><label>Price (LKR) <span class="req">*</span></label>' +
      '<input class="input" name="price" inputmode="numeric" placeholder="e.g. 325000" required></div>';
    html += '<div class="switch-row form-group"><div><label style="margin:0">Negotiable</label><div class="form-hint">Let buyers know you’re open to offers</div></div>' +
      '<label class="switch"><input type="checkbox" name="negotiable" checked><span class="slider"></span></label></div>';
    html += '</div>';

    // condition
    html += '<div class="form-group mt16"><label>Condition <span class="req">*</span></label><div class="seg" id="cond-seg">' +
      (state.meta ? state.meta.conditions : []).map(function (c, i) {
        return '<div class="opt' + (c === 'Good' ? ' active' : '') + '" data-cond="' + esc(c) + '">' + esc(c) + '</div>';
      }).join('') + '</div><input type="hidden" name="condition" value="Good"></div>';

    // dynamic fields
    html += '<div class="form-card" style="margin-top:16px"><div class="section-head" style="margin-bottom:4px"><h2>' + icon('list-outline') + esc(found.sub.name) + ' Details</h2></div>';
    (fields || []).forEach(function (f) {
      html += '<div class="form-group"><label>' + esc(f.label) + (f.required ? ' <span class="req">*</span>' : '') + '</label>';
      if (f.type === 'select') {
        html += '<select class="select" data-spec="' + esc(f.name) + '"' + (f.required ? ' required' : '') + '><option value="">Select…</option>' +
          (f.options || []).map(function (o) { return '<option value="' + esc(o) + '">' + esc(o) + '</option>'; }).join('') + '</select>';
      } else if (f.type === 'textarea') {
        html += '<textarea class="textarea" data-spec="' + esc(f.name) + '" placeholder="' + esc(f.label) + '"></textarea>';
      } else if (f.type === 'number') {
        html += '<input class="input" type="number" data-spec="' + esc(f.name) + '" placeholder="' + esc(f.label) + '">';
      } else {
        html += '<input class="input" data-spec="' + esc(f.name) + '" placeholder="' + esc(f.label) + '"' + (f.required ? ' required' : '') + '>';
      }
      html += '</div>';
    });
    html += '</div>';

    // location
    html += '<div class="form-card" style="margin-top:16px"><div class="section-head" style="margin-bottom:4px"><h2>' + icon('location-outline') + 'Location</h2></div>';
    html += '<div class="form-group"><label>Province <span class="req">*</span></label><select class="select" id="sel-prov" required><option value="">Select province…</option></select></div>';
    html += '<div class="form-group"><label>District <span class="req">*</span></label><select class="select" id="sel-dist" required><option value="">Select district…</option></select></div>';
    html += '<div class="form-group"><label>City / Town <span class="req">*</span></label><select class="select" id="sel-city" required><option value="">Select city…</option></select></div></div>';

    // description
    html += '<div class="form-card" style="margin-top:16px"><div class="section-head" style="margin-bottom:4px"><h2>' + icon('document-text-outline') + 'Description</h2></div>' +
      '<div class="form-group"><textarea class="textarea" name="description" placeholder="Describe condition, usage history, what’s included…"></textarea></div></div>';

    // images
    html += '<div class="form-card" style="margin-top:16px"><div class="section-head" style="margin-bottom:4px"><h2>' + icon('image-outline') + 'Photos</h2></div>' +
      '<p class="form-hint" style="margin-bottom:10px">Add up to 15 photos. First photo is the cover.</p>' +
      '<div class="upload-grid" id="upload-grid">' +
      '<label class="upload-tile" id="upload-add">' + icon('add-outline') + '<input type="file" id="upload-input" accept="image/*" multiple hidden></label>' +
      '</div></div>';

    html += '<button class="btn btn-primary" style="margin-top:18px" type="submit">' + icon('checkmark-circle-outline') + 'Publish Listing</button>';
    html += '</form></div><div style="height:16px"></div>';

    return {
      html: html,
      hideTabbar: false,
      mount: function () {
        // condition
        $$('#cond-seg .opt').forEach(function (o) {
          o.addEventListener('click', function () {
            $$('#cond-seg .opt').forEach(function (x) { x.classList.remove('active'); });
            o.classList.add('active');
            $('[name="condition"]').value = o.getAttribute('data-cond');
          });
        });
        // location selects
        var provs = state.locations || [];
        var selP = $('#sel-prov'), selD = $('#sel-dist'), selC = $('#sel-city');
        provs.forEach(function (p) {
          selP.insertAdjacentHTML('beforeend', '<option value="' + esc(p.name) + '">' + esc(p.name) + '</option>');
        });
        selP.addEventListener('change', function () {
          selD.innerHTML = '<option value="">Select district…</option>';
          selC.innerHTML = '<option value="">Select city…</option>';
          var p = provs.find(function (x) { return x.name === selP.value; });
          (p ? p.districts : []).forEach(function (d) {
            selD.insertAdjacentHTML('beforeend', '<option value="' + esc(d.name) + '">' + esc(d.name) + '</option>');
          });
        });
        selD.addEventListener('change', function () {
          selC.innerHTML = '<option value="">Select city…</option>';
          var p = provs.find(function (x) { return x.name === selP.value; });
          var d = p && p.districts.find(function (x) { return x.name === selD.value; });
          (d ? d.cities : []).forEach(function (c) {
            selC.insertAdjacentHTML('beforeend', '<option value="' + esc(c.name) + '">' + esc(c.name) + '</option>');
          });
        });
        // uploads
        var files = [];
        $('#upload-input').addEventListener('change', function () {
          var picked = Array.prototype.slice.call(this.files || []);
          picked.forEach(function (f) { if (files.length < 15) files.push(f); });
          renderUploads();
          this.value = '';
        });
        function renderUploads() {
          var grid = $('#upload-grid');
          var html = files.map(function (f, i) {
            var url = URL.createObjectURL(f);
            return '<div class="upload-tile" style="border-style:solid"><img src="' + url + '" alt="">' +
              '<span class="rm" data-rm="' + i + '">' + icon('close-outline') + '</span></div>';
          }).join('');
          grid.innerHTML = html + '<label class="upload-tile" id="upload-add">' + icon('add-outline') + '<input type="file" id="upload-input" accept="image/*" multiple hidden></label>';
          $$('#upload-grid [data-rm]').forEach(function (b) {
            b.addEventListener('click', function (e) {
              e.preventDefault(); e.stopPropagation();
              files.splice(parseInt(b.getAttribute('data-rm'), 10), 1); renderUploads();
            });
          });
          var inp = $('#upload-input');
          if (inp) inp.addEventListener('change', function () {
            var picked = Array.prototype.slice.call(this.files || []);
            picked.forEach(function (f) { if (files.length < 15) files.push(f); });
            renderUploads(); this.value = '';
          });
        }
        // submit
        $('#sell-form').addEventListener('submit', function (e) {
          e.preventDefault();
          var title = $('[name="title"]', this).value.trim();
          var price = parseInt($('[name="price"]', this).value.trim(), 10);
          if (!title) return toast('Please add a title', 'error');
          if (!price || price <= 0) return toast('Please add a valid price', 'error');
          if (!selP.value || !selD.value) return toast('Please choose a location', 'error');
          var specs = {};
          $$('[data-spec]', this).forEach(function (inp) { if (inp.value) specs[inp.getAttribute('data-spec')] = inp.value; });
          var payload = {
            category_id: found.sub.id,
            title: title,
            price: price,
            negotiable: $('[name="negotiable"]', this).checked,
            condition: $('[name="condition"]', this).value,
            description: $('[name="description"]', this).value.trim(),
            province: selP.value, district: selD.value, city: selC.value || selD.value,
            specs: specs, images: []
          };
          var btn = $('button[type="submit"]', this);
          btn.disabled = true; btn.textContent = 'Publishing…';
          function finish() {
            api.post('/listings', payload).then(function (r) {
              toast('Listing published!', 'success');
              location.hash = '#/ads/' + r.id;
            }).catch(function (er) { toast(er.message, 'error'); btn.disabled = false; btn.innerHTML = icon('checkmark-circle-outline') + 'Publish Listing'; });
          }
          if (files.length) {
            var fd = new FormData();
            files.forEach(function (f) { fd.append('files', f); });
            fetch('/api/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + api.token }, body: fd })
              .then(function (r) { return r.json(); })
              .then(function (d) { if (!d.ok) throw new Error(d.error || 'Upload failed'); payload.images = d.data.urls; finish(); })
              .catch(function (er) { toast(er.message, 'error'); btn.disabled = false; btn.innerHTML = icon('checkmark-circle-outline') + 'Publish Listing'; });
          } else finish();
        });
      }
    };
  };

  views.myAds = function () {
    if (!requireAuth()) return { html: '' };
    var html = header('My Ads', {});
    html += '<div class="stat-strip"><div class="stat-box"><b id="st-active">–</b><span>Active</span></div>' +
      '<div class="stat-box"><b id="st-sold">–</b><span>Sold</span></div>' +
      '<div class="stat-box"><b id="st-views">–</b><span>Total views</span></div></div>';
    html += '<div class="section"><div class="section-head"><h2>' + icon('duplicate-outline') + 'My Listings</h2></div></div>';
    html += '<div id="myads-list"><div class="spinner"></div></div>';
    return {
      html: html,
      mount: function () {
        api.get('/me/listings').then(function (items) {
          var active = items.filter(function (x) { return x.status === 'active'; });
          var sold = items.filter(function (x) { return x.status !== 'active'; });
          var views = items.reduce(function (a, b) { return a + (b.views || 0); }, 0);
          $('#st-active').textContent = active.length;
          $('#st-sold').textContent = sold.length;
          $('#st-views').textContent = views;
          var el = $('#myads-list');
          if (!items.length) {
            el.innerHTML = '<div class="empty"><div class="e-icon">' + icon('duplicate-outline') + '</div><h3>No listings yet</h3><p>Post your first camera or lens in minutes.</p><a class="btn btn-primary btn-sm" data-nav="#/sell" style="margin-top:12px">Sell an item</a></div>';
            return;
          }
          el.innerHTML = items.map(function (l) {
            return '<div class="row-item"><div style="width:64px;height:52px;border-radius:10px;overflow:hidden;flex-shrink:0;background:#eef1ef">' +
              (l.images && l.images[0] ? '<img src="' + esc(l.images[0]) + '" style="width:100%;height:100%;object-fit:cover">' : '') + '</div>' +
              '<div class="ri-main" data-nav="#/ads/' + l.id + '"><b>' + esc(l.title) + '</b>' +
              '<span>' + fmtLKR(l.price) + ' · ' + esc(l.status) + ' · ' + l.views + ' views</span></div>' +
              '<div style="display:flex;flex-direction:column;gap:6px">' +
              (l.status === 'active' ? '<button class="btn btn-outline btn-sm" data-mark-sold="' + l.id + '">Sold</button>' : '') +
              '<button class="btn btn-danger btn-sm" data-del-listing="' + l.id + '">' + icon('trash-outline') + '</button></div></div>';
          }).join('');
          $$('#myads-list [data-del-listing]').forEach(function (b) {
            b.addEventListener('click', function () {
              var id = b.getAttribute('data-del-listing');
              openDialog('Delete listing', '<p>This will permanently remove your listing. This cannot be undone.</p>', 'Delete', true, function () {
                api.del('/listings/' + id).then(function () { closeDialog(); toast('Listing deleted', 'success'); views.myAdsRemount(); });
              });
            });
          });
          $$('#myads-list [data-mark-sold]').forEach(function (b) {
            b.addEventListener('click', function () {
              var id = b.getAttribute('data-mark-sold');
              api.patch('/listings/' + id, { status: 'sold' }).then(function () { toast('Marked as sold', 'success'); views.myAdsRemount(); });
            });
          });
        }).catch(function (e) { $('#myads-list').innerHTML = '<div class="empty"><p>' + esc(e.message) + '</p></div>'; });
      }
    };
  };
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
            return '<div class="chat-list-item" data-nav="#/chat/' + r.other_id + '">' +
              avatarHtml({ name: r.other_name }, 'lg') +
              '<div class="meta"><b>' + esc(r.other_name) + '</b><p>' + (r.listing_title ? 'Re: ' + esc(r.listing_title) : esc(r.body)) + '</p></div>' +
              '<div class="time">' + timeAgo(r.created_at) + '</div></div>';
          }).join('');
        }).catch(function (e) { $('#conv-list').innerHTML = '<div class="empty"><p>' + esc(e.message) + '</p></div>'; });
      }
    };
  };

  views.chatThread = function (params) {
    if (!requireAuth()) return { html: '' };
    var otherId = params.id;
    var html = header('Chat', { right: '<span style="width:40px"></span>' });
    html += '<div class="chat-thread" id="thread"></div>';
    html += '<div class="chat-input"><input id="msg-input" placeholder="Type a message…"><button class="send" id="msg-send">' + icon('send-outline') + '</button></div>';
    return {
      html: html,
      hideTabbar: true,
      mount: function () {
        var threadEl = $('#thread');
        function load() {
          api.get('/chat/' + otherId).then(function (d) {
            var u = state.user;
            var h = (d.messages || []).map(function (m) {
              var mine = m.sender_id === u.id;
              return '<div class="bubble ' + (mine ? 'me' : 'other') + '">' + esc(m.body) + '<span class="t">' + timeAgo(m.created_at) + '</span></div>';
            }).join('');
            threadEl.innerHTML = h || '<div class="empty"><p>Say hello to start the conversation.</p></div>';
            window.scrollTo(0, document.body.scrollHeight);
          });
        }
        load();
        function send() {
          var inp = $('#msg-input'); var t = inp.value.trim();
          if (!t) return;
          api.post('/chat/' + otherId, { body: t }).then(function () { inp.value = ''; load(); });
        }
        $('#msg-send').addEventListener('click', send);
        $('#msg-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });
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
            var colors = { offer: '#C77D23', message: '#3A6FB0', listing: '#0E7C66', info: '#74817C' };
            var ic = { offer: 'cash-outline', message: 'chatbubble-ellipses-outline', listing: 'camera-outline', info: 'notifications-outline' };
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
          $('#seller-root').innerHTML = header(s.name, {}) +
            '<div class="hero-page" style="text-align:center"><div style="display:flex;justify-content:center;margin-bottom:10px">' + avatarHtml(s, 'lg') + '</div>' +
            '<h1>' + esc(s.name) + '</h1><p>' + (s.verified ? icon('shield-checkmark') + ' Verified seller · ' : '') + esc([s.city, s.province].filter(Boolean).join(', ') || 'Sri Lanka') + '</p>' +
            (s.bio ? '<p style="margin-top:8px;max-width:420px;margin-left:auto;margin-right:auto">' + esc(s.bio) + '</p>' : '') +
            '<div class="flex gap8" style="justify-content:center;margin-top:16px">' +
            '<button class="btn btn-wa btn-sm" data-wa-user="' + esc(s.phone) + '">' + icon('logo-whatsapp') + 'WhatsApp</button>' +
            '<button class="btn btn-outline btn-sm" data-nav="#/chat/' + s.id + '">' + icon('chatbubble-ellipses-outline') + 'Chat</button></div></div>' +
            '<div class="section"><div class="section-head"><h2>' + icon('camera-outline') + 'Listings (' + (d.listings || []).length + ')</h2></div></div>' +
            '<div>' + listingGrid(d.listings) + '</div><div style="height:16px"></div>';
        }).catch(function (e) {
          $('#seller-root').innerHTML = header('Seller', {}) + '<div class="empty"><p>' + esc(e.message) + '</p></div>';
        });
      }
    };
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
              api.post('/offers/' + b.getAttribute('data-accept'), { status: 'accepted' }).then(function () { toast('Offer accepted', 'success'); views.myOffersRemount(); });
            });
          });
          $$('#offers-root [data-decline]').forEach(function (b) {
            b.addEventListener('click', function () {
              api.post('/offers/' + b.getAttribute('data-decline'), { status: 'declined' }).then(function () { toast('Offer declined'); views.myOffersRemount(); });
            });
          });
        });
      }
    };
  };
  views.myOffersRemount = function () { var v = views.myOffers(); if (v.mount) v.mount(); };
  function offerRow(o, received) {
    var statusColor = { pending: '#C77D23', accepted: '#0E7C66', declined: '#E5484D' };
    return '<div class="row-item">' +
      '<span class="ri-icon" style="background:#f1f4f3;color:#0E7C66">' + icon('cash-outline') + '</span>' +
      '<div class="ri-main" data-nav="#/ads/' + o.listing_id + '"><b>' + fmtLKR(o.amount) + ' — ' + esc(o.listing_title || '') + '</b>' +
      '<span>' + (received ? 'From ' + esc(o.buyer_name) : 'To ' + esc(o.seller_name)) + ' · <b style="color:' + (statusColor[o.status] || '#74817C') + '">' + esc(o.status) + '</b>' + (o.message ? ' · "' + esc(o.message) + '"' : '') + '</span></div>' +
      (received && o.status === 'pending' ? '<div style="display:flex;gap:6px"><button class="btn btn-primary btn-sm" data-accept="' + o.id + '">Accept</button><button class="btn btn-outline btn-sm" data-decline="' + o.id + '">Decline</button></div>' : '') +
      '</div>';
  }

  views.settings = function () {
    if (!requireAuth()) return { html: '' };
    var u = state.user;
    var html = header('Settings', {});
    html += '<div class="detail-wrap"><form id="settings-form"><div class="form-card">' +
      '<div class="section-head" style="margin-bottom:4px"><h2>' + icon('person-outline') + 'Profile</h2></div>' +
      '<div class="form-group"><label>Full name</label><input class="input" name="name" value="' + esc(u.name) + '"></div>' +
      '<div class="form-group"><label>Phone</label><input class="input" name="phone" value="' + esc(u.phone) + '" placeholder="+94 77 123 4567"></div>' +
      '<div class="form-group"><label>WhatsApp number</label><input class="input" name="whatsapp" value="' + esc(u.whatsapp) + '" placeholder="+94 77 123 4567"></div>' +
      '<div class="form-group"><label>City / town</label><input class="input" name="city" value="' + esc(u.city) + '" placeholder="Colombo"></div>' +
      '<div class="form-group"><label>About you</label><textarea class="textarea" name="bio" style="min-height:80px">' + esc(u.bio) + '</textarea></div>' +
      '<button class="btn btn-primary" type="submit">' + icon('checkmark-outline') + 'Save Changes</button></div></form>' +
      '<div class="form-card" style="margin-top:16px"><div class="section-head" style="margin-bottom:4px"><h2>' + icon('key-outline') + 'Password</h2></div>' +
      '<form id="pw-form"><div class="form-group"><label>Current password</label><input class="input" type="password" name="old"></div>' +
      '<div class="form-group"><label>New password</label><input class="input" type="password" name="new"></div>' +
      '<button class="btn btn-outline" type="submit">Update password</button></form></div></div><div style="height:16px"></div>';
    return {
      html: html,
      mount: function () {
        $('#settings-form').addEventListener('submit', function (e) {
          e.preventDefault();
          var payload = {
            name: $('[name="name"]', this).value, phone: $('[name="phone"]', this).value,
            whatsapp: $('[name="whatsapp"]', this).value, city: $('[name="city"]', this).value,
            bio: $('[name="bio"]', this).value
          };
          api.patch('/me', payload).then(function (d) {
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
      }
    };
  };

  views.signin = function (query) {
    var html = header('Sign In', {});
    html += '<div class="auth-wrap"><div class="auth-hero">' + logoMark() + '<h1>Welcome back</h1><p>Sign in to manage your listings and chats.</p></div>' +
      '<form id="login-form"><div class="form-group"><label>Email</label><input class="input" type="email" name="email" required placeholder="you@example.com"></div>' +
      '<div class="form-group"><label>Password</label><input class="input" type="password" name="password" required placeholder="••••••••"></div>' +
      '<button class="btn btn-primary" type="submit">Sign In</button></form>' +
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
      '<button class="btn btn-primary" type="submit">Create Account</button></form>' +
      '<div class="auth-alt">Already have an account? <a data-nav="#/sign-in">Sign in</a></div></div>';
    return {
      html: html,
      mount: function () {
        $('#signup-form').addEventListener('submit', function (e) {
          e.preventDefault();
          var pw = $('[name="password"]', this).value;
          api.post('/auth/signup', {
            name: $('[name="name"]', this).value, email: $('[name="email"]', this).value,
            phone: $('[name="phone"]', this).value, password: pw
          }).then(function (d) {
            api.token = d.token; localStorage.setItem('ll_token', d.token);
            setUser(d.user);
            toast('Account created — welcome!', 'success');
            location.hash = '#/';
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
    { re: /^\/my-ads$/, handler: function () { return views.myAds(); } },
    { re: /^\/my-offers$/, handler: function () { return views.myOffers(); } },
    { re: /^\/favorites$/, handler: function () { return views.favorites(); } },
    { re: /^\/chat$/, handler: function () { return views.chat(); } },
    { re: /^\/chat\/(\d+)$/, handler: function (p, q, m) { return views.chatThread({ id: m[1] }); } },
    { re: /^\/notifications$/, handler: function () { return views.notifications(); } },
    { re: /^\/profile$/, handler: function () { return views.profile(); } },
    { re: /^\/seller\/(\d+)$/, handler: function (p, q, m) { return views.seller({ id: m[1] }); } },
    { re: /^\/settings$/, handler: function () { return views.settings(); } },
    { re: /^\/sign-in$/, handler: function (p, q) { return views.signin(q); } },
    { re: /^\/sign-up$/, handler: function () { return views.signup(); } },
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
        (key === 'profile' && (path === '/profile' || path === '/settings' || path === '/my-ads' || path === '/my-offers'));
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
