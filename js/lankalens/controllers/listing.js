/* Listing detail page */
(function () {
  const LL = window.LL;
  const { esc, money, num, timeAgo, dateLong, conditionPill, listingCard, emptyState, skeletonCards, avatarHtml } = LL;

  const ATTR_LABELS = {
    year: 'Year', shutter_count: 'Shutter count', sensor: 'Sensor', megapixels: 'Megapixels',
    video_resolution: 'Video resolution', iso_range: 'ISO range', kit: 'Body / kit',
    lens_included: 'Lens included', battery_included: 'Battery', charger_included: 'Charger',
    mount: 'Mount', focal_length: 'Focal length', max_aperture: 'Maximum aperture',
    image_stabilization: 'Image stabilization', autofocus: 'Focus',
    resolution: 'Max video resolution', camera_resolution: 'Camera resolution',
    flight_time: 'Flight time / battery', battery_count: 'Batteries included',
    controller_included: 'Controller', accessories: 'Accessories included',
    accessories_included: 'Accessories included', registration_info: 'Registration',
    brand: 'Brand', model: 'Model', compatibility: 'Compatibility',
    original_box: 'Original box', warranty: 'Warranty', receipt_available: 'Receipt',
  };
  const UNITS = { shutter_count: ' shots', flight_time: ' min', megapixels: ' MP' };

  function specRows(item) {
    const attrs = item.attributes || {};
    const order = ['brand', 'model', 'year', 'mount', 'sensor', 'megapixels', 'shutter_count', 'kit', 'lens_included',
      'focal_length', 'max_aperture', 'image_stabilization', 'autofocus', 'resolution', 'video_resolution',
      'iso_range', 'flight_time', 'camera_resolution', 'battery_count', 'controller_included',
      'accessories', 'accessories_included', 'compatibility', 'registration_info',
      'battery_included', 'charger_included', 'original_box', 'warranty'];
    const keys = order.filter((k) => attrs[k] != null && attrs[k] !== '');
    return keys.map((k) => {
      let v = esc(attrs[k]);
      if (k === 'shutter_count' && /^\d+$/.test(attrs[k])) v = num(attrs[k]) + ' shots';
      if (k === 'flight_time') v = esc(attrs[k]) + ' min';
      if (k === 'megapixels') v = esc(attrs[k]) + ' MP';
      if (k === 'warranty' && item.warranty) v = esc(item.warranty);
      return `<div class="spec-row"><span>${esc(ATTR_LABELS[k] || k)}</span><b>${v}</b></div>`;
    }).join('');
  }

  function statusBanner(item, isOwner) {
    if (item.status === 'active') return '';
    const map = {
      sold: ['checkmark-done-circle-outline', 'This item is marked as sold'],
      expired: ['alarm-outline', 'This listing has expired'],
      pending: ['time-outline', 'Your listing is pending approval and only visible to you'],
      rejected: ['close-circle-outline', `Your listing was rejected${item.rejection_reason ? ': ' + esc(item.rejection_reason) : ''}`],
      suspended: ['pause-circle-outline', 'This listing is paused'],
      draft: 'create-outline, This is a saved draft',
    };
    const [icon, text] = map[item.status] || ['alert-circle-outline', 'This listing is not active'];
    if ((item.status === 'pending' || item.status === 'draft' || item.status === 'rejected' || item.status === 'expired') && !isOwner) return '';
    return `<div class="alert-banner ${item.status === 'sold' ? 'sold' : 'pending'}"><ion-icon name="${icon}"></ion-icon><span>${text}</span></div>`;
  }

  LL.controllers = LL.controllers || {};
  LL.controllers.listing = async function (page) {
    const c = page.el.querySelector('[data-container]');
    const slug = page.route.params.slug;
    const router = LL.f7.views.main.router;
    const me = LL.store.me;

    c.innerHTML = `<div class="ll-wrap" style="padding:12px 0 110px">
      <nav class="ll-breadcrumb ll-wrap" style="padding:0 0 8px"><div class="skeleton skeleton-line" style="width:40%"></div></nav>
      <div class="detail-grid">
        <div>
          <div class="gallery skeleton" style="height:340px"></div>
        </div>
        <div>
          <div class="ll-card ll-card-pad"><div class="skeleton skeleton-line" style="height:28px"></div><div class="skeleton skeleton-line" style="width:60%"></div><div class="skeleton skeleton-line" style="width:80%"></div></div>
        </div>
      </div></div>`;

    let data;
    try {
      data = await LL.api.get(`/listings/${encodeURIComponent(slug)}`);
    } catch (e) {
      if (e.status === 404) { c.innerHTML = emptyState({ icon: 'camera-outline', title: 'Listing not found', text: 'It may have been sold or removed.', actionHtml: '<a class="button" href="/search" data-role="link">Browse listings</a>' }); return; }
      c.innerHTML = LL.errorState();
      c.addEventListener('ll:retry', () => router.reload(), { once: true });
      return;
    }
    const item = data.listing;
    const isOwner = me && me.id === item.seller.id;
    const imgs = item.images || (item.cover ? [{ url: item.cover }] : []);
    const priceHtml = `<div class="dp-price">${money(item.price)}${item.price > 0 ? '' : ''}
        ${item.negotiable && item.price > 0 ? '<span class="negotiable">Negotiable</span>' : ''}</div>`;

    const breadcrumb = `<a href="/" data-role="link">Home</a>
      <ion-icon name="chevron-forward-outline" class="crumb-sep"></ion-icon><a href="/${item.category.top}" data-role="link">${esc(item.category.top_name)}</a>
      <ion-icon name="chevron-forward-outline" class="crumb-sep"></ion-icon><a href="/${item.category.top}/${item.category.slug}" data-role="link">${esc(item.category.name)}</a>`;

    const contact = item.contact;
    const channels = [];
    if (contact.chat_enabled) channels.push('chat');
    if (contact.whatsapp_url) channels.push('whatsapp');
    if (contact.tel_url) channels.push('call');

    const sellerBadges = (s) => {
      const out = [];
      if (item.shop && item.shop.verified) out.push('<span class="verified-badge verified-business"><ion-icon name="shield-checkmark"></ion-icon> Verified business</span>');
      else {
        if (s.verified_phone) out.push('<span class="verified-badge verified-phone"><ion-icon name="call"></ion-icon> Phone verified</span>');
        if (s.verified_email) out.push('<span class="verified-badge verified-email"><ion-icon name="mail"></ion-icon> Email verified</span>');
      }
      return out.join('');
    };

    c.innerHTML = `<div class="ll-wrap" style="padding-bottom:120px">
      <nav class="ll-breadcrumb ll-wrap" style="padding:8px 0">${breadcrumb}</nav>
      ${statusBanner(item, isOwner)}
      <div class="detail-grid">
        <div>
          <div class="gallery">
            <div class="swiper gallery-swiper">
              <div class="swiper-wrapper">
                ${imgs.length ? imgs.map((im) => `<div class="swiper-slide"><img src="${esc(im.url)}" alt="${esc(item.title)}" loading="lazy"></div>`).join('')
                  : `<div class="swiper-slide"><div class="gallery-noimg"><ion-icon name="image-outline"></ion-icon></div></div>`}
              </div>
              ${imgs.length > 1 ? '<div class="swiper-pagination gallery-pag"></div><div class="gallery-nav gallery-prev"><ion-icon name="chevron-back"></ion-icon></div><div class="gallery-nav gallery-next"><ion-icon name="chevron-forward"></ion-icon></div>' : ''}
            </div>
            ${imgs.length > 1 ? `<div class="thumbs">${imgs.map((im, i) => `<img src="${esc(im.thumb_url || im.url)}" data-thumb="${i}" class="${i === 0 ? 'active' : ''}" alt="" loading="lazy">`).join('')}</div>` : ''}
          </div>

          <div class="ll-card ll-card-pad dp-panel">
            <h3>Description</h3>
            <div class="dp-desc">${esc(item.description).split(/\n+/).map((p) => `<p>${p}</p>`).join('')}</div>
          </div>

          <div class="ll-card ll-card-pad dp-panel" id="dp-specs">
            <h3>Specifications</h3>
            <div class="spec-list">${specRows(item) || '<p class="ll-muted">No specifications provided.</p>'}</div>
            <div class="ll-tags">
              <a href="/${item.category.top}/${item.category.slug}" class="tag" data-role="link">${esc(item.category.name)}</a>
              ${item.brand ? `<a href="/brand/${item.brand.slug}" class="tag" data-role="link">${esc(item.brand.name)}</a>` : ''}
              ${item.product ? `<span class="tag">${esc(item.product.name)}</span>` : ''}
              ${item.receipt_available ? '<span class="tag tag-green"><ion-icon name="receipt-outline"></ion-icon> Receipt available</span>' : ''}
            </div>
          </div>

          <div class="ll-card ll-card-pad dp-panel safety-card">
            <h3><ion-icon name="shield-checkmark-outline"></ion-icon> Safety tips</h3>
            <ul>
              <li>Meet the seller in a safe public place and inspect the gear yourself.</li>
              <li>Test shutter, sensor, autofocus, lens glass and drone flight before paying.</li>
              <li>Check the serial number and ask for the purchase receipt — never share photos of serial numbers publicly.</li>
              <li>Never pay deposits or transfer money in advance.</li>
            </ul>
            <a href="/safety" data-role="link" class="ll-link">Full safety guide →</a>
          </div>
        </div>

        <div>
          <div class="ll-card ll-card-pad dp-summary">
            <div class="ll-flex" style="gap:6px;flex-wrap:wrap">
              ${conditionPill(item.condition)}
              ${item.is_featured ? '<span class="pill pill-gold"><ion-icon name="flash"></ion-icon> Featured</span>' : ''}
              ${item.shop && item.shop.verified ? '<span class="pill pill-teal"><ion-icon name="shield-checkmark"></ion-icon> Shop</span>' : ''}
            </div>
            <h1 class="dp-title">${esc(item.title)}</h1>
            ${priceHtml}
            <div class="dp-meta">
              <span><ion-icon name="location-outline"></ion-icon> ${esc(item.location.city)}</span>
              <span><ion-icon name="time-outline"></ion-icon> ${timeAgo(item.created_at)}</span>
              <span><ion-icon name="eye-outline"></ion-icon> ${num(item.views)} views</span>
              <span><ion-icon name="heart-outline"></ion-icon> ${num(item.favorite_count)} saved</span>
            </div>
            <div class="dp-id ll-tiny ll-muted">Ad ID: LL-${String(item.id).padStart(6, '0')} · Listed ${dateLong(item.created_at)}</div>
          </div>

          <div class="ll-card ll-card-pad seller-card">
            <div class="seller-head">
              ${item.shop
                ? `<a href="/shop/${item.shop.slug}" data-role="link"><img class="seller-logo" src="${esc(item.shop.logo)}" alt=""></a>`
                : `<a href="/user/${item.seller.id}" data-role="link">${avatarHtml({ name: item.seller.name, avatar: item.seller.avatar }, 'seller-logo')}</a>`}
              <div style="min-width:0;flex:1">
                <a class="seller-name" href="${item.shop ? '/shop/' + item.shop.slug : '/user/' + item.seller.id}" data-role="link">${esc(item.shop ? item.shop.name : item.seller.name)}</a>
                <div class="ll-tiny ll-muted">${item.shop ? 'Camera shop' : 'Individual seller'} · ${item.seller.listings_count} active listings · joined ${dateLong(item.seller.member_since)}</div>
                <div style="margin-top:5px">${sellerBadges(item.seller)}</div>
              </div>
            </div>
            <p class="ll-tiny ll-muted" style="margin:10px 0 0">Lanka Lens verifies contact details when badges are shown, but does not inspect or guarantee listed items. Please test before paying.</p>
            ${!isOwner && item.status === 'active' ? `
            <div class="seller-actions">
              ${contact.chat_enabled ? '<button class="button" id="ct-chat"><ion-icon name="chatbubble-ellipses-outline"></ion-icon> Chat</button>' : ''}
              ${contact.whatsapp_url ? `<a class="button button-wa" id="ct-wa" target="_blank" rel="noopener"><ion-icon name="logo-whatsapp"></ion-icon> WhatsApp</a>` : ''}
              ${contact.tel_url ? `<a class="button button-outline" id="ct-call"><ion-icon name="call-outline"></ion-icon> Call</a>` : ''}
            </div>
            <button class="button button-outline button-sm" id="ct-offer" style="width:100%;margin-top:8px"><ion-icon name="pricetag-outline"></ion-icon> Make an offer</button>`
            : isOwner ? '<a class="button button-outline" style="width:100%;margin-top:10px" href="/my-listings" data-role="link"><ion-icon name="create-outline"></ion-icon> Manage this listing</a>' : ''}
            <button class="seller-fav ${item.is_favorite ? 'is-fav' : ''}" id="ct-fav"><ion-icon name="${item.is_favorite ? 'heart' : 'heart-outline'}"></ion-icon> ${item.is_favorite ? 'Saved' : 'Save to favourites'}</button>
            <button class="report-link" id="ct-report"><ion-icon name="flag-outline"></ion-icon> Report this listing</button>
          </div>

          ${!isOwner && item.status === 'active' ? `<div class="sticky-contact">
            <a class="sc-fav ${item.is_favorite ? 'is-fav' : ''}" id="sc-fav"><ion-icon name="${item.is_favorite ? 'heart' : 'heart-outline'}"></ion-icon></a>
            <button class="button button-outline sc-offer" id="sc-offer"><ion-icon name="pricetag-outline"></ion-icon> Offer</button>
            ${contact.chat_enabled ? '<button class="button sc-chat" id="sc-chat"><ion-icon name="chatbubble-ellipses-outline"></ion-icon> Chat</button>' : ''}
            ${contact.whatsapp_url ? '<a class="button button-wa sc-wa" id="sc-wa" target="_blank"><ion-icon name="logo-whatsapp"></ion-icon> WhatsApp</a>' : ''}
            ${contact.tel_url ? '<a class="button button-outline sc-call" id="sc-call"><ion-icon name="call-outline"></ion-icon> Call</a>' : ''}
          </div>` : ''}
        </div>
      </div>

      <div class="ll-wrap" style="padding:22px 0 0">
        <div class="section-head"><h2>Similar listings</h2></div>
        <div id="dp-related">${skeletonCards(3)}</div>
      </div>
    </div>

    <div class="sheet-modal sheet-bottom" id="offer-sheet" style="max-height:70vh">
      <div class="sheet-toolbar"><div class="left"></div><div class="sheet-toolbar-title">Make an offer</div><div class="right"><a class="link sheet-close">Close</a></div></div>
      <div class="sheet-content" style="padding:18px">
        <p class="ll-muted ll-tiny" style="margin-top:0">Listed price: <b>${money(item.price)}</b>. Your offer is sent to the seller inside chat; they can accept, decline or counter.</p>
        <label class="ll-label">Your offer (Rs.)</label>
        <input class="ll-input" id="of-amount" type="number" inputmode="numeric" min="100" placeholder="${String(Math.round(item.price * 0.9))}">
        <label class="ll-label" style="margin-top:12px">Message (optional)</label>
        <textarea class="ll-textarea" id="of-msg" rows="3" placeholder="Hi, would you take…"></textarea>
        <button class="button" id="of-send" style="width:100%;margin-top:14px">Send offer</button>
      </div>
    </div>

    <div class="sheet-modal sheet-bottom" id="report-sheet" style="max-height:78vh">
      <div class="sheet-toolbar"><div class="left"></div><div class="sheet-toolbar-title">Report this listing</div><div class="right"><a class="link sheet-close">Close</a></div></div>
      <div class="sheet-content" style="padding:18px 18px 110px">
        <p class="ll-muted ll-tiny" style="margin-top:0">Tell us what's wrong — our moderation team reviews reports promptly.</p>
        <div id="rp-reasons">${LL.REPORT_REASONS.map((r) => `<label class="report-radio"><input type="radio" name="rp" value="${r.key}"><span>${esc(r.label)}</span></label>`).join('')}</div>
        <textarea class="ll-textarea" id="rp-details" rows="3" placeholder="Additional details (optional)"></textarea>
        <button class="button" id="rp-send" style="width:100%;margin-top:12px">Submit report</button>
      </div>
    </div>`;

    // gallery
    const swiper = LL.f7.swiper.create(c.querySelector('.gallery-swiper'), {
      pagination: { el: c.querySelector('.gallery-pag'), clickable: true },
      navigation: imgs.length > 1 ? { nextEl: c.querySelector('.gallery-next'), prevEl: c.querySelector('.gallery-prev') } : undefined,
    });
    // swiper can be created before the page finishes animating in, when its
    // measured width is wrong; recompute once visible and on viewport changes
    const updateGallery = () => swiper.update();
    page.el.addEventListener('pageAfterIn', updateGallery, { once: true });
    setTimeout(updateGallery, 400);
    window.addEventListener('resize', updateGallery);
    page.el.addEventListener('pageBeforeOut', () => window.removeEventListener('resize', updateGallery), { once: true });
    c.querySelectorAll('[data-thumb]').forEach((t) => t.addEventListener('click', () => {
      swiper.slideTo(Number(t.dataset.thumb));
      c.querySelectorAll('.thumbs img').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
    }));
    swiper.on('slideChange', () => {
      c.querySelectorAll('.thumbs img').forEach((x, i) => x.classList.toggle('active', i === swiper.activeIndex));
    });
    c.querySelectorAll('.gallery-swiper .swiper-slide img').forEach((img) => img.addEventListener('click', () => {
      LL.f7.photoBrowser.create({ photos: imgs.map((i) => i.url), theme: 'dark', type: 'popup', swipeToClose: true }).open(swiper.activeIndex);
    }));

    // related
    c.querySelector('#dp-related').innerHTML = (item.related || []).length
      ? `<div class="ll-grid">${item.related.map(listingCard).join('')}</div>`
      : '<p class="ll-muted ll-tiny">No similar listings right now.</p>';

    // favorite (detail-local buttons)
    const setFav = (on) => {
      ['#ct-fav', '#sc-fav'].forEach((sel) => {
        const b = c.querySelector(sel);
        if (!b) return;
        b.classList.toggle('is-fav', on);
        b.innerHTML = sel === '#sc-fav'
          ? `<ion-icon name="${on ? 'heart' : 'heart-outline'}"></ion-icon>`
          : `<ion-icon name="${on ? 'heart' : 'heart-outline'}"></ion-icon> ${on ? 'Saved' : 'Save to favourites'}`;
      });
    };
    const favAction = async () => {
      if (!LL.store.requireLogin()) return;
      const r = await LL.api.post(`/listings/${item.id}/favorite`);
      setFav(r.favorited);
      LL.toast(r.favorited ? 'Saved to favourites' : 'Removed from favourites', r.favorited ? 'heart' : 'heart-outline');
    };
    c.querySelector('#ct-fav')?.addEventListener('click', favAction);
    c.querySelector('#sc-fav')?.addEventListener('click', favAction);

    // contact actions
    async function startChat() {
      if (!LL.store.requireLogin()) return;
      try {
        const r = await LL.api.post('/chat/conversations', { listing_id: item.id });
        router.navigate(`/chat?c=${r.conversation.id}`);
      } catch (e) { LL.toastError(e); }
    }
    c.querySelector('#ct-chat')?.addEventListener('click', startChat);
    c.querySelector('#sc-chat')?.addEventListener('click', startChat);

    async function contactWa() {
      try {
        const r = await LL.api.post(`/listings/${item.id}/contact`, { type: 'whatsapp' });
        if (r.url) window.open(r.url, '_blank', 'noopener');
      } catch (e) { LL.toastError(e); }
    }
    c.querySelector('#ct-wa')?.addEventListener('click', contactWa);
    c.querySelector('#sc-wa')?.addEventListener('click', contactWa);
    async function contactCall() {
      try {
        const r = await LL.api.post(`/listings/${item.id}/contact`, { type: 'call' });
        if (r.url) window.location.href = r.url;
      } catch (e) { LL.toastError(e); }
    }
    c.querySelector('#ct-call')?.addEventListener('click', contactCall);
    c.querySelector('#sc-call')?.addEventListener('click', contactCall);

    // offer
    const offerSheet = LL.f7.sheet.create({ el: c.querySelector('#offer-sheet') });
    const openOffer = () => {
      if (!LL.store.requireLogin()) return;
      if (isOwner) return;
      offerSheet.open();
    };
    c.querySelector('#ct-offer')?.addEventListener('click', openOffer);
    c.querySelector('#sc-offer')?.addEventListener('click', openOffer);
    c.querySelector('#of-send').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const amount = Number(c.querySelector('#of-amount').value);
      if (!amount || amount < 100) return LL.toast('Enter a valid offer amount', 'alert-circle-outline');
      await LL.withLoading(btn, async () => {
        try {
          const r = await LL.api.post(`/listings/${item.id}/offer`, { amount, message: c.querySelector('#of-msg').value.trim() });
          offerSheet.close();
          LL.toast('Offer sent — track it in Chat', 'pricetag');
          router.navigate(`/chat?c=${r.conversation_id}`);
        } catch (err) { LL.toastError(err); }
      });
    });

    // report
    const reportSheet = LL.f7.sheet.create({ el: c.querySelector('#report-sheet') });
    c.querySelector('#ct-report').addEventListener('click', () => {
      if (!me) { LL.store.requireLogin(); return; }
      reportSheet.open();
    });
    c.querySelector('#rp-send').addEventListener('click', async (e) => {
      const reason = c.querySelector('input[name="rp"]:checked')?.value;
      if (!reason) return LL.toast('Choose a reason', 'alert-circle-outline');
      await LL.withLoading(e.currentTarget, async () => {
        try {
          await LL.api.post(`/listings/${item.id}/report`, { reason, details: c.querySelector('#rp-details').value.trim() });
          reportSheet.close();
          LL.toast('Thanks — our team will review this report.');
        } catch (err) { LL.toastError(err); }
      });
    });

    // SEO (section 54)
    const condMap = { brand_new: 'https://schema.org/NewCondition', like_new: 'https://schema.org/OpenBoxCondition', excellent: 'https://schema.org/UsedCondition', good: 'https://schema.org/UsedCondition', fair: 'https://schema.org/UsedCondition', parts: 'https://schema.org/ForPartsCondition' };
    LL.setMeta({
      title: item.title,
      description: (item.description || '').slice(0, 155),
      image: imgs[0]?.url ? location.origin + imgs[0].url : undefined,
      canonical: location.origin + '/listing/' + item.slug,
      jsonLD: {
        '@context': 'https://schema.org', '@type': 'Product',
        name: item.title, description: (item.description || '').slice(0, 5000),
        image: imgs.map((i) => location.origin + i.url),
        category: item.category.name,
        brand: item.brand ? { '@type': 'Brand', name: item.brand.name } : undefined,
        offers: { '@type': 'Offer', price: item.price, priceCurrency: 'LKR', availability: item.status === 'active' ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock', url: location.origin + '/listing/' + item.slug, itemCondition: condMap[item.condition] },
      },
    });
    LL.setNavTitle(item.title);
  };
})();
