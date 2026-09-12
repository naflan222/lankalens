/* Shared renderers: listing/shop/blog cards, global header/tabbar, footer. */
(function () {
  const LL = window.LL;
  const { esc, money, timeAgo, conditionPill, avatarHtml } = LL;

  function favBtn(item) {
    const fav = item.is_favorite ? 'is-fav' : '';
    const filled = item.is_favorite ? 'heart' : 'heart-outline';
    return `<button class="lc-fav ${fav}" data-fav="${item.id}" aria-label="Save to favourites"><ion-icon name="${filled}"></ion-icon></button>`;
  }

  function sellerTag(item) {
    if (item.shop) {
      return `<span class="lc-seller"><span class="shop-tag"><ion-icon name="shield-checkmark-outline" style="width:10px;height:10px"></ion-icon> ${item.shop.verified ? 'Verified Shop' : 'Shop'}</span></span>`;
    }
    if (item.seller?.verified_phone) {
      return `<span class="lc-seller verified-mark"><ion-icon name="checkmark-circle"></ion-icon> Verified</span>`;
    }
    return `<span class="lc-seller ll-tiny ll-muted">Individual seller</span>`;
  }

  function listingCard(item) {
    const featured = item.is_featured ? `<span class="lc-featured"><ion-icon name="flash"></ion-icon> FEATURED</span>` : '';
    return `<a class="listing-card ll-listing-link" href="/listing/${esc(item.slug)}" data-role="link">
      <div class="lc-img">
        ${featured}
        <div class="lc-badges">${conditionPill(item.condition)}</div>
        ${favBtn(item)}
        <img src="${esc(item.cover || '')}" alt="${esc(item.title)}" loading="lazy" onerror="this.style.opacity=.2">
      </div>
      <div class="lc-body">
        <div class="lc-price">${money(item.price)}</div>
        <div class="lc-title">${esc(item.title)}</div>
        <div class="lc-meta">
          <ion-icon name="location-outline"></ion-icon><span class="ll-ellipsis">${esc(item.location?.city || 'Sri Lanka')}</span>
        </div>
        <div class="lc-meta">
          ${sellerTag(item)}
          <span style="margin-left:auto" class="ll-tiny">${timeAgo(item.created_at)}</span>
        </div>
      </div>
    </a>`;
  }

  function gridHtml(items) {
    return `<div class="ll-grid">${items.map(listingCard).join('')}</div>`;
  }

  function shopCard(s) {
    return `<a class="shop-card ll-listing-link" href="/shop/${esc(s.slug)}" data-role="link">
      <img src="${esc(s.logo)}" alt="${esc(s.name)}" loading="lazy">
      <div style="min-width:0">
        <div class="sc-name">${esc(s.name)} ${s.verified ? '<ion-icon name="shield-checkmark" style="color:var(--ll-teal);width:16px;height:16px"></ion-icon>' : ''}</div>
        <div class="sc-meta">
          <span><ion-icon name="location-outline" style="width:12px;height:12px"></ion-icon> ${esc(s.city || 'Sri Lanka')}</span>
          <span>${s.listings_count} listings</span>
        </div>
      </div>
      <span class="button button-sm button-outline">View Shop</span>
    </a>`;
  }

  function blogCard(p) {
    return `<a class="blog-card ll-listing-link" href="/blog/${esc(p.slug)}" data-role="link">
      <img src="${esc(p.cover_url || '')}" alt="${esc(p.title)}" loading="lazy">
      <div class="bc-body">
        <span class="pill pill-gold">${esc(p.category || 'Guides')}</span>
        <h4 style="margin-top:8px">${esc(p.title)}</h4>
        <p>${esc(p.excerpt || '')}</p>
        <div class="bc-meta"><span>${esc(p.author || 'Lanka Lens')}</span><span>${timeAgo(p.created_at)}</span></div>
      </div>
    </a>`;
  }

  function footerHtml() {
    return `<footer class="ll-footer">
      <div class="ll-wrap">
        <div class="footer-grid">
          <div class="footer-brand">
            <a class="ll-logo" href="/" data-role="link">
              <img class="logo-mark" src="/images/logo.svg" alt="Lanka Lens" width="38" height="38">
              <span class="logo-word"><b>LANKA LENS</b><small>Buy &amp; Sell Cameras in Sri Lanka</small></span>
            </a>
            <p>Sri Lanka's dedicated marketplace for used DSLR and mirrorless cameras, lenses, GoPro, DJI Action cameras, drones and accessories — plus verified camera shops.</p>
            <div class="footer-social">
              <a href="#" aria-label="Facebook"><ion-icon name="logo-facebook"></ion-icon></a>
              <a href="#" aria-label="Instagram"><ion-icon name="logo-instagram"></ion-icon></a>
              <a href="#" aria-label="YouTube"><ion-icon name="logo-youtube"></ion-icon></a>
              <a href="#" aria-label="WhatsApp"><ion-icon name="logo-whatsapp"></ion-icon></a>
            </div>
            <div class="footer-safety"><ion-icon name="shield-checkmark-outline" style="width:15px;height:15px;vertical-align:-2px"></ion-icon> Meet in public, test before you pay, never send deposits. <a href="/safety" data-role="link" style="color:#e5cfa6;font-weight:700">Read the Safety Guide</a>.</div>
          </div>
          <div><h5>Marketplace</h5>
            <a href="/cameras" data-role="link">DSLR &amp; Mirrorless</a>
            <a href="/lenses" data-role="link">Lenses</a>
            <a href="/action-cameras" data-role="link">GoPro / DJI Action</a>
            <a href="/drones" data-role="link">Drones</a>
            <a href="/accessories" data-role="link">Accessories</a>
          </div>
          <div><h5>Sell &amp; Shops</h5>
            <a href="/sell" data-role="link">Sell Your Camera</a>
            <a href="/shops" data-role="link">Camera Shops</a>
            <a href="/post" data-role="link">Post an Ad</a>
            <a href="/my-listings" data-role="link">My Listings</a>
            <a href="/dashboard" data-role="link">Seller Dashboard</a>
          </div>
          <div><h5>Guides</h5>
            <a href="/buying-guide" data-role="link">Buying Guide</a>
            <a href="/safety" data-role="link">Safety &amp; Scam Prevention</a>
            <a href="/blog" data-role="link">Camera Guides Blog</a>
            <a href="/faq" data-role="link">FAQ</a>
            <a href="/help" data-role="link">Help Center</a>
          </div>
          <div><h5>Lanka Lens</h5>
            <a href="/about" data-role="link">About</a>
            <a href="/contact" data-role="link">Contact</a>
            <a href="/privacy" data-role="link">Privacy Policy</a>
            <a href="/terms" data-role="link">Terms &amp; Conditions</a>
            <a href="/report" data-role="link">Report a Problem</a>
          </div>
          <div class="footer-bottom">
            <span>© ${new Date().getFullYear()} Lanka Lens · Sri Lanka. All listings are user-provided.</span>
            <span>Prices in Sri Lankan Rupees (Rs.)</span>
          </div>
        </div>
      </div>
    </footer>`;
  }

  function desktopHeaderHtml() {
    return `<header class="ll-site-header">
      <div class="hdr-top"><div class="ll-wrap">
        <span><ion-icon name="shield-checkmark-outline" style="width:13px;height:13px;vertical-align:-2px"></ion-icon> Sri Lanka's camera marketplace — meet in public, test before you pay</span>
        <span class="ll-flex" style="gap:14px"><a href="/safety" data-role="link">Safety</a><a href="/buying-guide" data-role="link">Buying Guide</a><a href="/help" data-role="link">Help</a></span>
      </div></div>
      <div class="hdr-main"><div class="ll-wrap">
        <a class="ll-logo" href="/" data-role="link">
          <img class="logo-mark" src="/images/logo.svg" alt="Lanka Lens" width="38" height="38">
          <span class="logo-word"><b>LANKA LENS</b><small>Cameras · Lenses · Drones</small></span>
        </a>
        <nav class="hdr-nav">
          <a href="/cameras" data-nav="cameras" data-role="link">Cameras</a>
          <a href="/lenses" data-nav="lenses" data-role="link">Lenses</a>
          <a href="/action-cameras" data-nav="action-cameras" data-role="link">Action Cams</a>
          <a href="/drones" data-nav="drones" data-role="link">Drones</a>
          <a href="/accessories" data-nav="accessories" data-role="link">Accessories</a>
          <a href="/shops" data-nav="shops" data-role="link">Shops</a>
        </nav>
        <form class="hdr-search" id="hdr-search">
          <ion-icon name="search-outline"></ion-icon>
          <input type="search" placeholder="Sony A7 III, GoPro 12, Sigma 24-70…" aria-label="Search">
        </form>
        <div class="hdr-actions" id="hdr-actions"></div>
      </div></div>
    </header>`;
  }

  function mobileTabbarHtml() {
    return `<nav class="ll-tabbar">
      <a href="/" data-tab="home" data-role="link"><ion-icon name="home-outline"></ion-icon><span>Home</span></a>
      <a href="/search" data-tab="search" data-role="link"><ion-icon name="search-outline"></ion-icon><span>Search</span></a>
      <a href="/post" class="tab-post" data-tab="post" data-role="link"><span class="post-fab"><ion-icon name="add"></ion-icon></span><span>Sell</span></a>
      <a href="/favorites" data-tab="favorites" data-role="link"><ion-icon name="heart-outline"></ion-icon><span>Saved</span><span class="tab-badge" data-badge="fav" hidden></span></a>
      <a href="/profile" data-tab="profile" data-role="link"><ion-icon name="person-outline"></ion-icon><span>Account</span></a>
    </nav>`;
  }

  function renderHeaderActions() {
    const el = document.getElementById('hdr-actions');
    if (!el) return;
    const me = LL.store.me;
    const favCount = el.dataset.fav || '';
    el.innerHTML = `
      <a class="hdr-icon-btn hdr-search-link" href="/search" data-role="link" aria-label="Search"><ion-icon name="search-outline"></ion-icon></a>
      <a class="hdr-icon-btn" href="/favorites" data-role="link" aria-label="Favourites"><ion-icon name="heart-outline"></ion-icon></a>
      <a class="hdr-icon-btn" href="/chat" data-role="link" aria-label="Messages"><ion-icon name="chatbox-ellipses-outline"></ion-icon><span class="badge-dot" data-badge="messages" hidden></span></a>
      <a class="hdr-icon-btn" href="/notifications" data-role="link" aria-label="Notifications"><ion-icon name="notifications-outline"></ion-icon><span class="badge-dot" data-badge="notifications" hidden></span></a>
      ${me
        ? `<a href="/post" class="button button-gold button-sm" data-role="link" style="margin:0 4px"><ion-icon name="add-circle"></ion-icon>Post Ad</a>
           <a href="/profile" data-role="link">${me.avatar ? `<img class="hdr-avatar" src="${esc(me.avatar)}" alt="">` : `<span class="hdr-avatar" style="display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:14px">${esc(LL.initials(me.name))}</span>`}</a>`
        : `<a href="/sign-in" class="button button-sm" data-role="link">Sign in</a>
           <a href="/sign-up" class="button button-gold button-sm join-btn" data-role="link">Join free</a>`}`;
    if (me?.role === 'admin') {
      el.insertAdjacentHTML('beforeend', '<a class="hdr-icon-btn" href="/admin" data-role="link" aria-label="Admin"><ion-icon name="shield-outline"></ion-icon><span class="badge-dot" data-badge="pending" hidden style="background:var(--ll-gold);color:#20170a"></span></a>');
    }
  }

  function setActiveNav(path) {
    const seg = path.replace(/^\//, '').split('/')[0];
    document.querySelectorAll('[data-nav]').forEach((a) => {
      a.classList.toggle('router-link-active', a.dataset.nav === seg);
    });
    const tabMap = { '': 'home', 'search': 'search', 'post': 'post', 'favorites': 'favorites', 'profile': 'profile' };
    document.querySelectorAll('.ll-tabbar a').forEach((a) => {
      a.classList.toggle('active', a.dataset.tab === (tabMap[seg] || (seg.startsWith('listing') ? 'search' : '')));
    });
  }

  Object.assign(LL, {
    listingCard, gridHtml, shopCard, blogCard,
    footerHtml, desktopHeaderHtml, mobileTabbarHtml,
    renderHeaderActions, setActiveNav,
  });
})();
