/* Shops directory, shop profile, blog, CMS info pages, contact & report */
(function () {
  const LL = window.LL;
  const { esc, listingCard, blogCard, emptyState, skeletonCards, dateLong } = LL;

  /* ---------------- shops list ---------------- */
  LL.controllers = LL.controllers || {};
  LL.controllers.shops = async function (page) {
    const c = page.el.querySelector('[data-container]');
    c.innerHTML = `<div class="ll-wrap" style="padding:12px 0 40px">
      <div class="sub-hero">
        <h1 class="page-title" style="color:#fff">Verified camera shops</h1>
        <p style="color:rgba(255,255,255,.85)">Camera stores across Sri Lanka with business-verified profiles and shop-backed listings.</p>
      </div>
      <div id="shop-list" class="shop-grid" style="margin-top:16px">${'<div class="ll-card ll-card-pad"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line" style="width:60%"></div></div>'.repeat(3)}</div>
    </div>`;
    LL.setNavTitle('Camera shops');
    try {
      const { shops } = await LL.api.get('/shops');
      c.querySelector('#shop-list').innerHTML = shops.length
        ? shops.map((s) => `
        <a class="shop-card ll-listing-link" href="/shop/${s.slug}" data-role="link">
          <img src="${esc(s.logo)}" alt="" onerror="this.style.opacity:.15">
          <div style="min-width:0">
            <div class="sc-name">${esc(s.name)} ${s.verified ? '<ion-icon name="shield-checkmark" style="color:var(--ll-teal);width:16px;height:16px"></ion-icon>' : ''}</div>
            <p class="sc-desc ll-ellipsis-2">${esc(s.description || 'Camera equipment specialist')}</p>
            <div class="sc-meta">
              <span><ion-icon name="location-outline" style="width:12px;height:12px"></ion-icon> ${esc(s.city || 'Sri Lanka')}</span>
              <span>${s.listings_count} listings</span>
            </div>
          </div>
          <span class="button button-sm button-outline">View Shop</span>
        </a>`).join('')
        : emptyState({ icon: 'storefront-outline', title: 'No verified shops yet', text: 'Shop profiles will appear here after verification.' });
    } catch (e) { c.querySelector('#shop-list').innerHTML = LL.errorState(); }
  };

  /* ---------------- shop profile ---------------- */
  LL.controllers.shop = async function (page) {
    const c = page.el.querySelector('[data-container]');
    const slug = page.route.params.slug;
    c.innerHTML = `<div class="ll-wrap" style="padding:12px 0 40px">${skeletonCards(3)}</div>`;
    try {
      const { shop, listings } = await LL.api.get(`/shops/${slug}`);
      LL.setNavTitle(shop.name);
      c.innerHTML = `<div class="ll-wrap" style="padding-bottom:20px">
        <div class="shop-header ll-card">
          <img class="shop-header-logo" src="${esc(shop.logo)}" alt="" onerror="this.style.opacity:.15">
          <div class="sh-info">
            <h1>${esc(shop.name)}</h1>
            ${shop.verified ? '<span class="verified-badge verified-business"><ion-icon name="shield-checkmark"></ion-icon> Verified business</span>' : ''}
            <p>${(esc(shop.description || '')).replace(/\n/g, '<br>')}</p>
            <div class="shop-info-row">
              ${shop.city ? `<span><ion-icon name="location-outline"></ion-icon> ${esc([shop.city, shop.district].filter(Boolean).join(', '))}</span>` : ''}
              ${shop.address ? `<span><ion-icon name="navigate-outline"></ion-icon> ${esc(shop.address)}</span>` : ''}
              ${shop.opening_hours ? `<span><ion-icon name="time-outline"></ion-icon> ${esc(shop.opening_hours)}</span>` : ''}
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
              ${shop.whatsapp_url ? `<a class="button button-wa button-sm" target="_blank" href="${shop.whatsapp_url}"><ion-icon name="logo-whatsapp"></ion-icon> WhatsApp shop</a>` : ''}
              ${shop.phone ? `<a class="button button-outline button-sm" href="tel:${shop.phone}"><ion-icon name="call-outline"></ion-icon> Call</a>` : ''}
            </div>
          </div>
        </div>
        <div class="section-head" style="margin-top:18px"><h2>Listings (${listings.length})</h2></div>
        ${listings.length ? `<div class="ll-grid">${listings.map(listingCard).join('')}</div>`
          : emptyState({ icon: 'camera-outline', title: 'No active listings', text: 'This shop has no active listings right now.' })}
      </div>`;
      LL.setMeta({ title: shop.name, description: (shop.description || '').slice(0, 155) || undefined });
    } catch (e) {
      c.innerHTML = emptyState({ icon: 'storefront-outline', title: 'Shop not found', text: 'This shop profile is unavailable.', actionHtml: '<a class="button" href="/shops" data-role="link">All shops</a>' });
    }
  };

  /* ---------------- blog list ---------------- */
  LL.controllers.blog = async function (page) {
    const c = page.el.querySelector('[data-container]');
    c.innerHTML = `<div class="ll-wrap" style="padding:12px 0 40px">
      <div class="sub-hero"><h1 class="page-title" style="color:#fff">Camera guides &amp; articles</h1>
        <p style="color:rgba(255,255,255,.85)">Practical Sri-Lanka-focused advice for buying and selling used camera gear.</p></div>
      <div id="blog-list" class="blog-grid" style="margin-top:16px"></div></div>`;
    LL.setNavTitle('Guides & blog');
    const { posts, categories } = await LL.api.get('/blog');
    const cat = page.route.query?.category || '';
    const shown = cat ? posts.filter((p) => p.category === cat) : posts;
    c.querySelector('#blog-list').innerHTML = shown.length
      ? shown.map(blogCard).join('')
      : emptyState({ icon: 'book-outline', title: 'No articles yet', text: 'Guides are on the way.' });
  };

  /* ---------------- blog article ---------------- */
  LL.controllers.article = async function (page) {
    const c = page.el.querySelector('[data-container]');
    const slug = page.route.params.slug;
    c.innerHTML = `<div class="ll-wrap" style="padding:12px 0 40px"><div class="ll-card ll-card-pad">${'<div class="skeleton skeleton-line"></div>'.repeat(4)}</div></div>`;
    try {
      const { post, related } = await LL.api.get(`/blog/${slug}`);
      LL.setNavTitle(post.title);
      c.innerHTML = `<article class="ll-wrap article-page">
        <nav class="ll-breadcrumb" style="padding:4px 0"><a href="/" data-role="link">Home</a><ion-icon name="chevron-forward-outline" class="crumb-sep"></ion-icon><a href="/blog" data-role="link">Guides</a></nav>
        <span class="pill pill-gold">${esc(post.category || 'Guides')}</span>
        <h1 class="article-title">${esc(post.title)}</h1>
        <div class="article-meta ll-tiny ll-muted">${esc(post.author || 'Lanka Lens')} · ${dateLong(post.created_at)}</div>
        ${post.cover_url ? `<img class="article-cover" src="${esc(post.cover_url)}" alt="">` : ''}
        <div class="article-body cms-html">${post.body_html || ''}</div>
        <div class="safety-band" style="margin-top:24px">
          <span class="sb-icon"><ion-icon name="shield-checkmark-outline" class="icon-lg"></ion-icon></span>
          <div><h4>Stay safe while trading</h4><p>Meet in public, test the gear thoroughly, and never pay in advance.</p></div>
          <a class="button button-sm button-ghost" style="color:var(--ll-navy)" href="/safety" data-role="link">Safety guide</a>
        </div>
        <h3 style="margin-top:26px">More guides</h3>
        <div class="blog-grid">${related.map(blogCard).join('')}</div>
      </article>`;
      LL.setMeta({ title: post.title, description: (post.excerpt || '').slice(0, 155) || undefined, canonical: location.origin + '/blog/' + post.slug });
    } catch {
      c.innerHTML = emptyState({ icon: 'book-outline', title: 'Article not found', text: 'It may have been moved.', actionHtml: '<a class="button" href="/blog" data-role="link">All guides</a>' });
    }
  };

  /* ---------------- generic CMS pages ---------------- */
  const PAGE_TITLES = { about: 'About Lanka Lens', safety: 'Safety & scam prevention', 'buying-guide': 'Buying guide', sell: 'Sell your camera gear', privacy: 'Privacy policy', terms: 'Terms & conditions', faq: 'FAQ', help: 'Help center', contact: 'Contact' };
  LL.controllers.cms = async function (page) {
    const c = page.el.querySelector('[data-container]');
    const slug = page.route.path.split('/')[1];
    c.innerHTML = `<div class="ll-wrap" style="padding:12px 0 40px"><div class="ll-card ll-card-pad">${'<div class="skeleton skeleton-line"></div>'.repeat(5)}</div></div>`;
    try {
      const { page: p } = await LL.api.get(`/pages/${slug}`);
      LL.setNavTitle(p.title);
      c.innerHTML = `<article class="ll-wrap cms-page">
        <nav class="ll-breadcrumb" style="padding:4px 0"><a href="/" data-role="link">Home</a><ion-icon name="chevron-forward-outline" class="crumb-sep"></ion-icon><span>${esc(p.title)}</span></nav>
        <h1 class="article-title">${esc(p.title)}</h1>
        <div class="cms-html">${p.body_html || ''}</div>
      </article>`;
      LL.setMeta({ title: p.title, description: `${p.title} — Lanka Lens, Sri Lanka's camera marketplace.` });
    } catch {
      c.innerHTML = emptyState({ icon: 'document-outline', title: 'Page not found', text: '' });
    }
  };

  /* ---------------- contact ---------------- */
  LL.controllers.contact = async function (page) {
    const c = page.el.querySelector('[data-container]');
    LL.setNavTitle('Contact');
    c.innerHTML = `<div class="ll-wrap" style="padding:12px 0 40px">
      <h1 class="page-title">Contact us</h1>
      <div class="contact-grid">
        <div class="ll-card ll-card-pad">
          <h3>Send a message</h3>
          <div class="ll-field"><label>Your name</label><input class="ll-input" id="ct-name"></div>
          <div class="ll-field"><label>Email</label><input class="ll-input" id="ct-email" type="email"></div>
          <div class="ll-field"><label>Message</label><textarea class="ll-textarea" id="ct-msg" rows="6"></textarea></div>
          <button class="button" id="ct-send" style="width:100%">Send message</button>
        </div>
        <div class="ll-card ll-card-pad">
          <h3>Other ways to reach us</h3>
          <p><ion-icon name="mail-outline"></ion-icon> support@lankalens.lk</p>
          <p><ion-icon name="storefront-outline"></ion-icon> shops@lankalens.lk (business verification)</p>
          <p><ion-icon name="flag-outline"></ion-icon> safety@lankalens.lk (reports &amp; scams)</p>
          <p class="ll-tiny ll-muted">Monday–Saturday, 9:00–18:00. Lanka Lens staff will never ask for your password or OTP.</p>
        </div>
      </div></div>`;
    c.querySelector('#ct-send').addEventListener('click', async (e) => {
      await LL.withLoading(e.currentTarget, async () => {
        try {
          const r = await LL.api.post('/contact', {
            name: c.querySelector('#ct-name').value.trim(),
            email: c.querySelector('#ct-email').value.trim(),
            message: c.querySelector('#ct-msg').value.trim(),
          });
          LL.toast(r.message || 'Message sent');
          c.querySelector('#ct-name').value = c.querySelector('#ct-email').value = c.querySelector('#ct-msg').value = '';
        } catch (err) { LL.toastError(err); }
      });
    });
  };

  /* ---------------- generic report form ---------------- */
  LL.controllers.report = async function (page) {
    const c = page.el.querySelector('[data-container]');
    LL.setNavTitle('Report a problem');
    c.innerHTML = `<div class="ll-wrap" style="padding:12px 0 40px">
      <h1 class="page-title">Report a problem</h1>
      <div class="ll-card ll-card-pad">
        <p class="ll-muted ll-tiny">For a specific listing, use the "Report this listing" button on its page. Use this form for accounts, messages or other issues.</p>
        <div class="ll-field"><label>Reason</label>
          <select class="ll-input" id="rp-type">${LL.REPORT_REASONS.map((r) => `<option value="${r.key}">${r.label}</option>`).join('')}<option value="account">Report a user account</option></select></div>
        <div class="ll-field"><label>Details</label><textarea class="ll-textarea" id="rp-detail" rows="6" placeholder="Include links or listing IDs where possible"></textarea></div>
        <div class="ll-field"><label>Your email (optional)</label><input class="ll-input" id="rp-email" type="email"></div>
        <button class="button" id="rp-go" style="width:100%">Submit report</button>
      </div></div>`;
    c.querySelector('#rp-go').addEventListener('click', async (e) => {
      const details = c.querySelector('#rp-detail').value.trim();
      if (details.length < 10) return LL.toast('Add a few more details (at least 10 characters)', 'alert-circle-outline');
      await LL.withLoading(e.currentTarget, async () => {
        try {
          await LL.api.post('/contact', {
            name: 'Report: ' + (c.querySelector('#rp-type').selectedOptions[0].textContent),
            email: c.querySelector('#rp-email').value.trim() || (LL.store.me?.email || 'anonymous@report.local'),
            message: details,
          });
          LL.toast('Thanks — our moderation team will review this.');
          LL.f7.views.main.router.back();
        } catch (err) { LL.toastError(err); }
      });
    });
  };
})();
