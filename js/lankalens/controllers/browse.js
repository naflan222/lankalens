/* Browse / search / category / brand listing pages with filters. */
(function () {
  const LL = window.LL;
  const { esc, skeletonCards, listingCard, emptyState } = LL;
  const SORTS = [
    { k: 'newest', label: 'Newest first' },
    { k: 'recommended', label: 'Recommended' },
    { k: 'price_asc', label: 'Price: low to high' },
    { k: 'price_desc', label: 'Price: high to low' },
    { k: 'most_viewed', label: 'Most viewed' },
  ];
  const SCOPES = { cameras: 'camera', lenses: 'lens', 'action-cameras': 'action', drones: 'drone', accessories: 'accessory' };

  function buildState(page) {
    const p = page.route.params || {};
    const q = page.route.query || {};
    const seg = (page.route.path || '').split('/').filter(Boolean)[0];
    const topSlugs = Object.keys(SCOPES);
    const state = {
      top: topSlugs.includes(seg) ? seg : null,
      sub: p.sub || null,
      brand: p.brand || q.brand || null,
      q: q.q || '',
      sort: SORTS.some((s) => s.k === q.sort) ? q.sort : 'newest',
      conditions: (q.condition || '').split(',').filter(Boolean),
      price_min: q.price_min || '',
      price_max: q.price_max || '',
      location: q.location || '',
      seller_type: q.seller_type || '',
      mount: q.mount || '',
      focal: q.focal || '',
      resolution: q.resolution || '',
      shutter_max: q.shutter_max || '',
      megapixels_min: q.megapixels_min || '',
      flight_min: q.flight_min || '',
      batteries_min: q.batteries_min || '',
      featured: q.featured === '1',
      model: q.model || '',
      page: 1,
    };
    return state;
  }

  function stateQuery(s, page2) {
    const o = new URLSearchParams();
    if (s.q) o.set('q', s.q);
    if (s.sort !== 'newest') o.set('sort', s.sort);
    if (s.conditions.length) o.set('condition', s.conditions.join(','));
    if (s.price_min) o.set('price_min', s.price_min);
    if (s.price_max) o.set('price_max', s.price_max);
    if (s.location) o.set('location', s.location);
    if (s.seller_type) o.set('seller_type', s.seller_type);
    if (s.mount) o.set('mount', s.mount);
    if (s.focal) o.set('focal', s.focal);
    if (s.resolution) o.set('resolution', s.resolution);
    if (s.shutter_max) o.set('shutter_max', s.shutter_max);
    if (s.megapixels_min) o.set('megapixels_min', s.megapixels_min);
    if (s.flight_min) o.set('flight_min', s.flight_min);
    if (s.batteries_min) o.set('batteries_min', s.batteries_min);
    if (s.featured) o.set('featured', '1');
    if (s.model) o.set('model', s.model);
    if (s.brand && !page2) o.set('brand', s.brand);
    const qs = o.toString();
    return qs ? '?' + qs : '';
  }

  function statePath(s) {
    if (s.brand && !s.sub) return `/brand/${s.brand}`;
    if (s.sub) return `/${s.top}/${s.sub}`;
    if (s.top) return `/${s.top}`;
    return '/search';
  }

  function listingsQuery(s) {
    const o = new URLSearchParams();
    if (s.sub) o.set('leaf', s.sub);
    else if (s.top) o.set('cat', s.top);
    if (s.brand) o.set('brand', s.brand);
    if (s.q) o.set('q', s.q);
    if (s.conditions.length) o.set('condition', s.conditions.join(','));
    if (s.price_min) o.set('price_min', s.price_min);
    if (s.price_max) o.set('price_max', s.price_max);
    if (s.location) o.set('location', s.location);
    if (s.seller_type) o.set('seller_type', s.seller_type);
    if (s.mount) o.set('mount', s.mount);
    if (s.focal) o.set('focal', s.focal);
    if (s.resolution) o.set('resolution', s.resolution);
    if (s.shutter_max) o.set('shutter_max', s.shutter_max);
    if (s.megapixels_min) o.set('megapixels_min', s.megapixels_min);
    if (s.flight_min) o.set('flight_min', s.flight_min);
    if (s.batteries_min) o.set('batteries_min', s.batteries_min);
    if (s.featured) o.set('featured', '1');
    if (s.model) o.set('model', s.model);
    o.set('sort', s.sort);
    o.set('limit', '24');
    o.set('page', String(s.page));
    return '/listings?' + o.toString();
  }

  function activeChips(s) {
    const chips = [];
    s.conditions.forEach((c) => chips.push({ key: 'condition', val: c, label: LL.CONDITION_LABELS[c] || c }));
    if (s.price_min || s.price_max) chips.push({ key: 'price', label: `${LL.money(s.price_min || 0)} – ${s.price_max ? LL.money(s.price_max) : 'any'}` });
    if (s.seller_type) chips.push({ key: 'seller_type', label: s.seller_type === 'business' ? 'Camera shops' : 'Individual sellers' });
    if (s.mount) chips.push({ key: 'mount', label: s.mount + ' mount' });
    if (s.focal) chips.push({ key: 'focal', label: s.focal === 'prime' ? 'Prime lenses' : 'Zoom lenses' });
    if (s.resolution) chips.push({ key: 'resolution', label: s.resolution });
    if (s.shutter_max) chips.push({ key: 'shutter_max', label: `≤ ${LL.num(s.shutter_max)} shots` });
    if (s.megapixels_min) chips.push({ key: 'megapixels_min', label: `≥ ${s.megapixels_min} MP` });
    if (s.flight_min) chips.push({ key: 'flight_min', label: `≥ ${s.flight_min} min flight` });
    if (s.batteries_min) chips.push({ key: 'batteries_min', label: `≥ ${s.batteries_min} batteries` });
    if (s.model) chips.push({ key: 'model', label: s.model });
    if (s.location) chips.push({ key: 'location', val: s.location, label: 'Location' });
    if (s.featured) chips.push({ key: 'featured', label: 'Featured' });
    if (!chips.length) return '';
    return `<div class="ll-chips">${chips.map((c) => `<button class="chip chip-active" data-clear="${c.key}" data-val="${esc(c.val || '')}">${esc(c.label)} <ion-icon name="close-circle"></ion-icon></button>`).join('')}</div>`;
  }

  LL.controllers = LL.controllers || {};
  LL.controllers.browse = async function (page) {
    const el = page.el;
    const c = el.querySelector('[data-container]');
    const s = buildState(page);
    const router = LL.f7.views.main.router;
    let catDetail = null;
    let locations = [];

    const title = s.sub ? (catDetail?.category?.name || 'Browse')
      : s.brand ? s.brand
      : s.featured ? 'Featured cameras'
      : s.top ? { cameras: 'Cameras', lenses: 'Lenses', 'action-cameras': 'Action Cameras', drones: 'Drones', accessories: 'Accessories' }[s.top]
      : s.q ? `Results for “${s.q}”` : 'Browse listings';

    c.innerHTML = `
      <div class="ll-wrap" style="padding-top:12px">
        <nav class="ll-breadcrumb" id="crumb"></nav>
        <div class="browse-head">
          <h1 class="page-title" id="b-title">${esc(title)}</h1>
          <p class="ll-muted" id="b-count" style="margin:2px 0 0">Loading listings…</p>
        </div>
        <form class="browse-toolbar" id="b-toolbar">
          <div class="bt-search">
            <ion-icon name="search-outline"></ion-icon>
            <input id="bt-q" type="search" value="${esc(s.q)}" placeholder="Search this category…">
          </div>
          <select id="bt-sort" aria-label="Sort">${SORTS.map((o) => `<option value="${o.k}" ${o.k === s.sort ? 'selected' : ''}>${o.label}</option>`).join('')}</select>
          <button type="button" class="button button-outline button-sm" id="bt-filter" style="white-space:nowrap"><ion-icon name="options-outline"></ion-icon> Filters</button>
        </form>
        <div id="b-subs"></div>
        <div id="b-activechips">${activeChips(s)}</div>
        <div id="b-grid">${skeletonCards(8)}</div>
        <div class="load-more-wrap" id="b-load" hidden><button class="button button-ghost">Load more</button></div>
      </div>
      <div class="sheet-modal sheet-bottom" id="filter-sheet" style="height:auto;max-height:88vh">
        <div class="sheet-toolbar">
          <div class="left"></div>
          <div class="sheet-toolbar-title">Filters</div>
          <div class="right"><a class="link sheet-close" id="fs-cancel">Cancel</a></div>
        </div>
        <div class="sheet-modal-swipe-step" style="display:none"></div>
        <div class="sheet-content">
          <div id="fs-body" style="padding:16px 16px 8px"></div>
          <div class="sheet-actions">
            <button class="button button-outline" id="fs-clear" type="button">Clear all</button>
            <button class="button" id="fs-apply" type="button">Show results</button>
          </div>
        </div>
      </div>`;

    LL.setNavTitle(title);

    async function loadListings() {
      const grid = c.querySelector('#b-grid');
      const load = c.querySelector('#b-load');
      if (s.page === 1) { grid.innerHTML = skeletonCards(8); load.hidden = true; }
      try {
        const r = await LL.api.get(listingsQuery(s));
        if (s.page === 1) grid.innerHTML = r.items.length
          ? `<div class="ll-grid">${r.items.map(listingCard).join('')}</div>`
          : emptyState({ icon: 'camera-outline', title: 'No listings match', text: 'Try widening your filters or search terms — new gear is posted every day.',
              actionHtml: `<a class="button button-gold" href="/post" data-role="link">Post what you need? <span class="ll-tiny" style="opacity:.85"> — sell yours instead</span></a>` });
        else grid.querySelector('.ll-grid').insertAdjacentHTML('beforeend', r.items.map(listingCard).join(''));
        c.querySelector('#b-count').textContent = `${LL.num(r.total)} listing${r.total === 1 ? '' : 's'} found`;
        load.hidden = s.page >= r.pages;
      } catch (e) {
        if (s.page === 1) grid.innerHTML = LL.errorState();
        c.querySelector('#b-count').textContent = '';
      }
    }

    function navigate(next) {
      const merged = Object.assign({}, s, next, { page: 1 });
      const path = statePath(merged) + stateQuery(merged);
      router.navigate(path, { reloadCurrent: true, ignoreCache: true });
    }

    // category data (subcategories, brands, products)
    async function loadCategoryUI() {
      const subsEl = c.querySelector('#b-subs');
      if (!s.top) { subsEl.innerHTML = ''; return; }
      const slug = s.sub || s.top;
      try { catDetail = await LL.api.get(`/categories/${slug}`); } catch { catDetail = null; }
      // top page: show subcategories
      let chipsHtml = '';
      if (!s.sub && catDetail?.subcategories?.length) {
        chipsHtml = `<div class="ll-chips" style="margin:10px 0">
          <button class="chip ${!s.sub ? 'chip-active' : ''}" data-sub="">All ${esc(title)}</button>
          ${catDetail.subcategories.map((sub) => `<button class="chip ${s.sub === sub.slug ? 'chip-active' : ''}" data-sub="${sub.slug}">${esc(sub.name)}</button>`).join('')}
        </div>`;
      }
      subsEl.innerHTML = chipsHtml;
      if (s.sub && catDetail) {
        c.querySelector('#b-title').textContent = catDetail.category.name;
        LL.setNavTitle(catDetail.category.name);
        document.title = `${catDetail.category.name} | Lanka Lens`;
      }
    }

    function crumbs() {
      const parts = ['<a href="/" data-role="link">Home</a>'];
      if (s.top) {
        const names = { cameras: 'Cameras', lenses: 'Lenses', 'action-cameras': 'Action Cameras', drones: 'Drones', accessories: 'Accessories' };
        parts.push(`<a href="/${s.top}" data-role="link">${names[s.top]}</a>`);
      }
      if (s.sub) parts.push(`<span>${esc(catDetail?.category?.name || s.sub)}</span>`);
      if (s.brand) parts.push(`<span>${esc(s.brand)}</span>`);
      if (s.q) parts.push(`<span>Search: ${esc(s.q)}</span>`);
      c.querySelector('#crumb').innerHTML = parts.join('<ion-icon name="chevron-forward-outline" class="crumb-sep"></ion-icon>');
    }

    /* ---------------- filter sheet ---------------- */
    const sheet = LL.f7.sheet.create({ el: c.querySelector('#filter-sheet') });

    async function locationOptions() {
      if (!locations.length) locations = await LL.store.getLocations();
      return locations;
    }

    async function renderSheet() {
      const fs = document.getElementById('filter-sheet');
      const body = fs.querySelector('#fs-body');
      body.innerHTML = '<div class="skeleton skeleton-line"></div>';
      const brands = [];
      let products = [];
      if (s.top) {
        try {
          const d = await LL.api.get(`/categories/${s.sub || s.top}`);
          (d.brands || []).forEach((b) => brands.push(b));
          if (s.sub) catDetail = d;
        } catch { /* noop */ }
      }
      if (!brands.length && s.top) {
        try {
          const d = await LL.api.get(`/brands?scope=${SCOPES[s.top]}`);
          d.brands.forEach((b) => brands.push(b));
        } catch { /* noop */ }
      }
      if (s.brand) {
        try {
          const d = await LL.api.get(`/products?category=${s.sub || s.top}${s.brand ? `&brand=${s.brand}` : ''}`);
          products = d.products || [];
        } catch { /* noop */ }
      }
      const prov = await locationOptions();
      const selectedBrands = s.brand ? s.brand.split(',').filter(Boolean) : [];

      const chipToggle = (label, items, selected) => `
        <div class="filter-group"><h5>${label}</h5>
        <div class="ll-chips">${items.map((i) => {
          const k = typeof i === 'string' ? i : i.slug;
          const n = typeof i === 'string' ? i : i.name;
          return `<button type="button" class="chip ${selected.includes(k) ? 'chip-active' : ''}" data-multi="${label}" data-key="${esc(k)}">${esc(n)}</button>`;
        }).join('')}</div></div>`;

      let html = '';
      // condition
      html += chipToggle('Condition', LL.CONDITIONS.map((x) => ({ slug: x.key, name: x.label })), s.conditions);

      // price
      html += `<div class="filter-group"><h5>Price (Rs.)</h5>
        <div class="ll-flex" style="gap:10px">
          <input class="ll-input" type="number" inputmode="numeric" id="fs-pmin" placeholder="From" value="${esc(s.price_min)}">
          <input class="ll-input" type="number" inputmode="numeric" id="fs-pmax" placeholder="To" value="${esc(s.price_max)}">
        </div></div>`;

      if (brands.length) {
        html += chipToggle('Brand', brands.map((b) => ({ slug: b.slug, name: b.name })), selectedBrands);
      }
      if (products.length) {
        html += `<div class="filter-group"><h5>Model</h5>
          <div class="ll-chips">${products.slice(0, 40).map((p) => `<button type="button" class="chip ${s.model === p.slug ? 'chip-active' : ''}" data-single="model" data-key="${esc(p.slug)}">${esc(p.name)}</button>`).join('')}</div></div>`;
      }

      // group-specific
      if (s.top === 'cameras') {
        html += `<div class="filter-group"><h5>Shutter count ≤</h5>
          <input class="ll-input" type="number" id="fs-shutter" placeholder="e.g. 30000" value="${esc(s.shutter_max)}"></div>
          <div class="filter-group"><h5>Megapixels ≥</h5>
          <input class="ll-input" type="number" step="0.1" id="fs-mp" placeholder="e.g. 24" value="${esc(s.megapixels_min)}"></div>`;
      }
      if (s.top === 'lenses') {
        const mounts = ['Canon EF', 'Canon RF', 'Nikon F', 'Nikon Z', 'Sony E', 'Fujifilm X', 'Fujifilm G', 'Micro Four Thirds', 'Pentax K', 'L-Mount'];
        html += chipToggle('Mount', mounts, s.mount ? [s.mount] : []).replace('data-multi="Mount"', 'data-single="mount"');
        html += chipToggle('Lens type', [{ slug: 'prime', name: 'Prime' }, { slug: 'zoom', name: 'Zoom' }], s.focal ? [s.focal] : []).replace('data-multi="Lens type"', 'data-single="focal"');
      }
      if (s.top === 'action-cameras') {
        html += chipToggle('Max video resolution', LL.RESOLUTIONS.map((r) => ({ slug: r.key, name: r.label })), s.resolution ? [s.resolution] : []).replace('data-multi="Max video resolution"', 'data-single="resolution"');
      }
      if (s.top === 'drones') {
        html += `<div class="filter-group"><h5>Minimum flight time (min)</h5>
          <input class="ll-input" type="number" id="fs-flight" placeholder="e.g. 30" value="${esc(s.flight_min)}"></div>
          <div class="filter-group"><h5>Minimum batteries</h5>
          <input class="ll-input" type="number" id="fs-batt" placeholder="e.g. 2" value="${esc(s.batteries_min)}"></div>`;
      }

      // seller type
      html += chipToggle('Seller', [{ slug: 'individual', name: 'Individuals' }, { slug: 'business', name: 'Camera shops' }], s.seller_type ? [s.seller_type] : []).replace('data-multi="Seller"', 'data-single="seller_type"');

      // location
      html += `<div class="filter-group"><h5>Location</h5>
        <select class="ll-input" id="fs-prov"><option value="">Province — any</option>${prov.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
        <select class="ll-input" id="fs-dist" style="margin-top:8px" ${s.location ? '' : 'disabled'}><option value="">District — any</option></select>
        <select class="ll-input" id="fs-city" style="margin-top:8px" disabled><option value="">City — any</option></select>
      </div>`;

      body.innerHTML = html;

      // brand multi toggling
      let brandSel = [...selectedBrands];
      body.querySelectorAll('[data-multi="Brand"]').forEach((btn) => btn.addEventListener('click', () => {
        const k = btn.dataset.key;
        if (brandSel.includes(k)) brandSel = brandSel.filter((x) => x !== k); else brandSel.push(k);
        btn.classList.toggle('chip-active');
      }));
      // Condition multi
      const condSel = [...s.conditions];
      body.querySelectorAll('[data-multi="Condition"]').forEach((btn) => btn.addEventListener('click', () => {
        const k = btn.dataset.key;
        const i = condSel.indexOf(k);
        if (i >= 0) condSel.splice(i, 1); else condSel.push(k);
        btn.classList.toggle('chip-active');
      }));
      // single-select chips
      body.querySelectorAll('[data-single]').forEach((btn) => btn.addEventListener('click', () => {
        const group = btn.dataset.single;
        const was = btn.classList.contains('chip-active');
        body.querySelectorAll(`[data-single="${group}"]`).forEach((b) => b.classList.remove('chip-active'));
        if (!was) btn.classList.add('chip-active');
      }));

      // location cascade
      const pSel = body.querySelector('#fs-prov');
      const dSel = body.querySelector('#fs-dist');
      const cSel = body.querySelector('#fs-city');
      const fillDistricts = (pid, chosenDist) => {
        const p = prov.find((x) => x.id === Number(pid));
        dSel.innerHTML = '<option value="">District — any</option>' + ((p?.children || []).map((d) => `<option value="${d.id}" ${String(d.id) === String(chosenDist || '') ? 'selected' : ''}>${esc(d.name)}</option>`).join(''));
        dSel.disabled = !p;
      };
      const fillCities = (did, chosenCity) => {
        let cities = [];
        for (const p of prov) for (const d of p.children || []) if (d.id === Number(did)) cities = d.children || [];
        cSel.innerHTML = '<option value="">City — any</option>' + cities.map((x) => `<option value="${x.id}" ${String(x.id) === String(String(chosenCity || '')) ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
        cSel.disabled = !cities.length;
      };
      // preselect from state.location
      if (s.location) {
        const lid = Number(s.location);
        const findL = () => {
          for (const p of prov) {
            if (p.id === lid) return { p: p.id };
            for (const d of p.children || []) {
              if (d.id === lid) return { p: p.id, d: d.id };
              for (const ct of d.children || []) if (ct.id === lid) return { p: p.id, d: d.id, c: ct.id };
            }
          }
          return null;
        };
        const pre = findL();
        if (pre) {
          pSel.value = pre.p;
          fillDistricts(pre.p, pre.d);
          if (pre.d) { fillCities(pre.d, pre.c); }
        }
      }
      pSel.addEventListener('change', () => { fillDistricts(pSel.value); cSel.innerHTML = '<option value="">City — any</option>'; cSel.disabled = true; });
      dSel.addEventListener('change', () => fillCities(dSel.value));

      const fsApply = fs.querySelector('#fs-apply');
      const fsClear = fs.querySelector('#fs-clear');
      const fsCancel = fs.querySelector('#fs-cancel');
      fsCancel.onclick = () => sheet.close();

      // store interim on apply
      fsApply.onclick = () => {
        const single = (g) => body.querySelector(`[data-single="${g}"].chip-active`)?.dataset.key || '';
        const next = {
          conditions: condSel,
          price_min: body.querySelector('#fs-pmin').value.trim(),
          price_max: body.querySelector('#fs-pmax').value.trim(),
          brand: brandSel.join(','),
          model: single('model'),
          seller_type: single('seller_type'),
          mount: single('mount'),
          focal: single('focal'),
          resolution: single('resolution'),
          shutter_max: body.querySelector('#fs-shutter')?.value.trim() || '',
          megapixels_min: body.querySelector('#fs-mp')?.value.trim() || '',
          flight_min: body.querySelector('#fs-flight')?.value.trim() || '',
          batteries_min: body.querySelector('#fs-batt')?.value.trim() || '',
          location: cSel.value || dSel.value || pSel.value,
        };
        sheet.close();
        navigate(next);
      };
      fsClear.onclick = () => {
        sheet.close();
        navigate({ conditions: [], price_min: '', price_max: '', brand: '', model: '', seller_type: '', mount: '', focal: '', resolution: '', shutter_max: '', megapixels_min: '', flight_min: '', batteries_min: '', location: '', featured: false });
      };

      sheet.open();
    }

    /* ---------------- wire up ---------------- */
    c.querySelector('#bt-sort').addEventListener('change', (e) => navigate({ sort: e.target.value }));
    c.querySelector('#bt-filter').addEventListener('click', renderSheet);
    c.querySelector('#b-toolbar').addEventListener('submit', (e) => {
      e.preventDefault();
      navigate({ q: c.querySelector('#bt-q').value.trim() });
    });
    c.querySelector('#b-subs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-sub]');
      if (b) navigate({ sub: b.dataset.sub || null, model: '', brand: '' });
    });
    c.addEventListener('click', (e) => {
      const x = e.target.closest('[data-clear]');
      if (!x) return;
      const key = x.dataset.clear;
      const val = x.dataset.val;
      const next = {};
      if (key === 'condition') next.conditions = s.conditions.filter((v) => v !== val);
      else if (key === 'price') { next.price_min = ''; next.price_max = ''; }
      else next[key] = '';
      navigate(next);
    });
    c.querySelector('#b-load button').addEventListener('click', async (e) => {
      e.target.classList.add('button-loading');
      s.page++;
      try {
        const r = await LL.api.get(listingsQuery(s));
        c.querySelector('#b-grid .ll-grid').insertAdjacentHTML('beforeend', r.items.map(listingCard).join(''));
        c.querySelector('#b-load').hidden = s.page >= r.pages;
      } finally { e.target.classList.remove('button-loading'); }
    });

    await loadCategoryUI();
    crumbs();
    await loadListings();
    LL.setMeta({ title: title === 'Browse listings' ? null : title, description: `Buy & sell ${title.toLowerCase()} on Lanka Lens, Sri Lanka's camera marketplace.` });
  };
})();
