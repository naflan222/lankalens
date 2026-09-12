/* Home page controller — section order per spec §49 */
(function () {
  const LL = window.LL;
  const { esc, money, skeletonCards, listingCard, shopCard, blogCard, conditionPill } = LL;

  const HOME_CATS = [
    { label: 'DSLR', icon: 'camera-outline', cls: 'ct-blue', href: '/cameras/dslr' },
    { label: 'Mirrorless', icon: 'camera-reverse-outline', cls: 'ct-blue', href: '/cameras/mirrorless' },
    { label: 'Lenses', icon: 'scan-outline', cls: 'ct-purple', href: '/lenses' },
    { label: 'GoPro', icon: 'videocam-outline', cls: 'ct-orange', href: '/action-cameras/gopro' },
    { label: 'DJI Action', icon: 'recording-outline', cls: 'ct-orange', href: '/action-cameras/dji-action' },
    { label: 'Drones', icon: 'rocket-outline', cls: 'ct-green', href: '/drones' },
    { label: 'Accessories', icon: 'bag-handle-outline', cls: 'ct-brown', href: '/accessories' },
  ];
  const QUICK = ['Sony A7 III', 'Canon 90D', 'GoPro 12', 'DJI Mini 3', 'Sigma 24-70', 'Nikon Z6 II'];

  function categoryTiles(categories) {
    const counts = {};
    for (const top of categories || []) {
      counts[top.slug] = top.listings_count;
      for (const sub of top.children) counts[sub.slug] = sub.listings_count;
    }
    return `<div class="cat-grid">${HOME_CATS.map((c) => `
      <a class="cat-tile ll-listing-link" href="${c.href}" data-role="link">
        <span class="ct-icon ${c.cls}"><ion-icon name="${c.icon}"></ion-icon></span>
        <h6>${c.label}</h6>
        <span class="ct-count">${counts[c.href.split('/').pop()] ? counts[c.href.split('/').pop()] + ' listed' : 'Browse'}</span>
      </a>`).join('')}</div>`;
  }

  function railHtml(items) {
    return `<div class="swiper ll-h-rail"><div class="swiper-wrapper">
      ${items.map((i) => `<div class="swiper-slide listing-h-card">${listingCard(i)}</div>`).join('')}
    </div><div class="swiper-pagination ll-rail-pag"></div></div>`;
  }

  function brandsHtml(brands) {
    const groups = [
      { title: 'Cameras', names: ['Canon', 'Sony', 'Nikon', 'Fujifilm', 'Panasonic', 'OM System', 'Pentax', 'Leica'] },
      { title: 'Action cams', names: ['GoPro', 'DJI', 'Insta360'] },
      { title: 'Drones', names: ['DJI', 'Autel'] },
      { title: 'Lenses', names: ['Canon', 'Nikon', 'Sony', 'Sigma', 'Tamron', 'Fujifilm', 'Samyang', 'Tokina'] },
    ];
    const find = (n) => brands.find((b) => b.name.toLowerCase() === n.toLowerCase());
    return groups.map((g) => `
      <div style="margin-bottom:12px">
        <div class="ll-tiny ll-muted" style="font-weight:800;letter-spacing:.08em;text-transform:uppercase;margin:0 2px 7px">${g.title}</div>
        <div class="brand-strip">${g.names.map((n) => {
          const b = find(n);
          return b ? `<a class="brand-pill ll-listing-link" href="/brand/${b.slug}" data-role="link">${esc(n)}</a>` : '';
        }).join('')}</div>
      </div>`).join('');
  }

  const GUIDES = [
    { icon: 'camera-outline', title: 'Check a used DSLR', text: 'Shutter count, sensor, AF — full checklist', href: '/blog/how-to-check-a-used-dslr' },
    { icon: 'scan-outline', title: 'Inspect a used lens', text: 'Fungus, haze, aperture blades and focus', href: '/blog/how-to-check-a-used-lens' },
    { icon: 'rocket-outline', title: 'Inspect a used drone', text: 'Always fly-test before buying', href: '/blog/inspecting-a-used-drone' },
    { icon: 'shield-checkmark-outline', title: 'Avoid camera scams', text: 'Safe meetings, payments and serial numbers', href: '/safety' },
  ];

  LL.controllers = LL.controllers || {};
  LL.controllers.home = async function (page) {
    const c = page.el.querySelector('[data-container]');
    c.innerHTML = `
      <section class="hero">
        <div class="ll-wrap">
          <h1>Buy &amp; Sell Cameras in Sri Lanka</h1>
          <p class="hero-sub">Used DSLR &amp; mirrorless bodies, lenses, GoPro &amp; DJI Action cameras, drones and accessories — from individuals and verified camera shops.</p>
          <form class="hero-search" id="hero-search">
            <div class="hs-field">
              <ion-icon name="search-outline"></ion-icon>
              <input type="search" placeholder="Search cameras, lenses, GoPro, DJI, drones…" aria-label="Search listings">
            </div>
            <button class="button button-gold" type="submit">Search</button>
          </form>
          <div class="hero-quick">
            ${QUICK.map((q) => `<a href="/search?q=${encodeURIComponent(q)}" data-role="link">${esc(q)}</a>`).join('')}
          </div>
        </div>
      </section>
      <div class="ll-wrap" style="padding-bottom:10px">
        <div class="section-head"><h2>Browse categories</h2><a class="see-all" href="/cameras" data-role="link">All categories <ion-icon name="chevron-forward"></ion-icon></a></div>
        <div id="home-cats">${'<div class=\'skeleton skeleton-line\'></div>'.repeat(3)}</div>

        <div class="section-head"><h2>Featured cameras</h2><a class="see-all" href="/search?featured=1" data-role="link">See all <ion-icon name="chevron-forward"></ion-icon></a></div>
        <div id="home-featured">${skeletonCards(4)}</div>

        <a href="/safety" data-role="link" style="display:block;margin-top:24px">
          <div class="safety-band">
            <span class="sb-icon"><ion-icon name="shield-checkmark-outline" class="icon-lg"></ion-icon></span>
            <div><h4>Safe trading, every time</h4><p>Meet in public, test the gear, check serial numbers — never pay deposits in advance.</p></div>
            <span class="button button-sm button-ghost" style="color:var(--ll-navy)">Read more</span>
          </div>
        </a>

        <div class="section-head"><h2>Latest camera listings</h2><a class="see-all" href="/search?sort=newest" data-role="link">See all <ion-icon name="chevron-forward"></ion-icon></a></div>
        <div id="home-latest">${skeletonCards(6)}</div>
        <div class="load-more-wrap" id="home-load" hidden><button class="button button-ghost">Load more listings</button></div>

        <div class="section-head"><h2>Popular brands</h2></div>
        <div id="home-brands" class="ll-card ll-card-pad"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line" style="width:70%"></div></div>

        <div class="section-head"><h2>Camera shops</h2><a class="see-all" href="/shops" data-role="link">All shops <ion-icon name="chevron-forward"></ion-icon></a></div>
        <div id="home-shops" class="shop-grid"></div>

        <div class="section-head"><h2>Buying guides &amp; safety</h2><a class="see-all" href="/buying-guide" data-role="link">Buying guide <ion-icon name="chevron-forward"></ion-icon></a></div>
        <div class="guide-grid">
          ${GUIDES.map((g) => `<a class="guide-card ll-listing-link" href="${g.href}" data-role="link">
            <span class="gd-icon"><ion-icon name="${g.icon}"></ion-icon></span>
            <div><h6>${esc(g.title)}</h6><p>${esc(g.text)}</p></div></a>`).join('')}
        </div>

        <div class="section-head"><h2>Guides &amp; articles</h2><a class="see-all" href="/blog" data-role="link">All articles <ion-icon name="chevron-forward"></ion-icon></a></div>
        <div id="home-blog" class="blog-grid"></div>

        <section style="margin:30px 0 0">
          <a href="/post" data-role="link"><div class="safety-band" style="background:linear-gradient(135deg,#7c5316,#c98a2e)">
            <span class="sb-icon" style="background:rgba(0,0,0,.18);color:#fff"><ion-icon name="camera"></ion-icon></span>
            <div><h4>Sell your camera gear</h4><p>Free listings with category-specific fields. Most listings are reviewed within hours.</p></div>
            <span class="button button-sm" style="background:#11202f;color:#fff;width:auto">Post an Ad</span>
          </div></a>
        </section>
      </div>`;

    c.querySelector('#hero-search').addEventListener('submit', (e) => {
      e.preventDefault();
      const q = c.querySelector('.hero-search input').value.trim();
      LL.f7.views.main.router.navigate(q ? `/search?q=${encodeURIComponent(q)}` : '/search');
    });

    let latestPage = 1;
    const [categories, featured, latest, shops, blog, brands] = await Promise.all([
      LL.api.get('/categories').catch(() => ({ categories: [] })),
      LL.api.get('/listings?featured=1&sort=recommended&limit=12').catch(() => ({ items: [] })),
      LL.api.get('/listings?sort=newest&limit=10').catch(() => ({ items: [] })),
      LL.api.get('/shops').catch(() => ({ shops: [] })),
      LL.api.get('/blog').catch(() => ({ posts: [] })),
      LL.api.get('/brands').catch(() => ({ brands: [] })),
    ]);

    c.querySelector('#home-cats').innerHTML = categoryTiles(categories?.categories || []);
    c.querySelector('#home-featured').innerHTML = (featured?.items || []).length
      ? railHtml(featured.items)
      : LL.emptyState({ icon: 'flash-outline', title: 'No featured listings yet', text: 'Featured listings appear here.' });
    LL.f7.swiper.create(c.querySelector('.ll-h-rail'), { slidesPerView: 'auto', spaceBetween: 12, freeMode: true });

    const latestWrap = c.querySelector('#home-latest');
    const loadBtn = c.querySelector('#home-load button');
    function appendLatest(items) {
      if (latestPage === 1) latestWrap.innerHTML = '<div class="ll-grid"></div>';
      const grid = latestWrap.querySelector('.ll-grid');
      grid.insertAdjacentHTML('beforeend', items.map(listingCard).join(''));
    }
    appendLatest(latest?.items || []);
    if ((latest?.pages || 1) > 1) {
      c.querySelector('#home-load').hidden = false;
      loadBtn.addEventListener('click', async () => {
        loadBtn.classList.add('button-loading');
        latestPage++;
        const r = await LL.api.get(`/listings?sort=newest&limit=10&page=${latestPage}`);
        appendLatest(r.items);
        if (latestPage >= r.pages) c.querySelector('#home-load').hidden = true;
        loadBtn.classList.remove('button-loading');
      });
    }

    c.querySelector('#home-brands').innerHTML = brandsHtml(brands.brands || []);
    c.querySelector('#home-shops').innerHTML = (shops.shops || []).slice(0, 3).map(shopCard).join('')
      || LL.emptyState({ icon: 'storefront-outline', title: 'No shops yet', text: 'Verified camera shops will appear here.' });
    c.querySelector('#home-blog').innerHTML = (blog.posts || []).slice(0, 3).map(blogCard).join('');

    LL.setMeta({
      title: null,
      description: 'Buy and sell used DSLR & mirrorless cameras, lenses, GoPro, DJI Action cameras, drones and accessories across Sri Lanka. Verified sellers, safe trading.',
    });
  };
})();
