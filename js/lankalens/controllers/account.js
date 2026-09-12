/* My listings, favourites, profile, settings, seller dashboard */
(function () {
  const LL = window.LL;
  const { esc, money, num, timeAgo, listingCard, emptyState, avatarHtml, dateLong } = LL;

  const STATUS_META = {
    active: { label: 'Active', cls: 'active' }, pending: { label: 'Pending review', cls: 'pending' },
    sold: { label: 'Sold', cls: 'sold' }, expired: { label: 'Expired', cls: 'expired' },
    draft: { label: 'Draft', cls: 'draft' }, rejected: { label: 'Rejected', cls: 'rejected' },
    suspended: { label: 'Paused', cls: 'suspended' },
  };

  function mineCard(i) {
    const st = STATUS_META[i.status] || { label: i.status, cls: 'draft' };
    const actions = [];
    const act = (label, a, cls = 'button-outline button-sm') => `<button class="button ${cls}" data-act="${a}" data-id="${i.id}">${label}</button>`;
    actions.push(`<a class="button button-outline button-sm" href="/listing/${i.slug}" data-role="link">View</a>`);
    if (['active', 'pending', 'sold', 'expired', 'draft', 'rejected', 'suspended'].includes(i.status)) actions.push(act('Edit', 'edit'));
    if (i.status === 'active') { actions.push(act('Mark sold', 'sold', 'button-sm')); actions.push(act('Pause', 'pause', 'button-outline button-sm')); actions.push(act('Promote', 'promote', 'button-gold button-sm')); }
    if (i.status === 'sold') actions.push(act('Republish', 'republish'));
    if (i.status === 'expired') actions.push(act('Renew', 'renew'));
    if (i.status === 'draft' || i.status === 'rejected') actions.push(act('Submit', 'submit', 'button-sm'));
    if (i.status === 'suspended') actions.push(act('Reactivate', 'activate', 'button-sm'));
    actions.push(act('Delete', 'delete', 'button-outline button-sm'));
    return `<div class="ml-row ll-card">
      <a href="/listing/${i.slug}" data-role="link" class="ml-thumb"><img src="${esc(i.cover || '')}" alt=""></a>
      <div class="ml-info">
        <div class="ll-flex" style="gap:8px;align-items:center;flex-wrap:wrap">
          <span class="listing-status status-${st.cls}">${st.label}</span>
          ${i.is_featured ? '<span class="pill pill-gold ll-tiny">Featured</span>' : ''}
        </div>
        <a class="ml-title" href="/listing/${i.slug}" data-role="link">${esc(i.title)}</a>
        <div class="ml-price">${money(i.price)}</div>
        <div class="ll-tiny ll-muted">${num(i.views)} views · ${num(i.favorite_count)} saves · ${timeAgo(i.created_at)}</div>
        ${i.status === 'rejected' && i.rejection_reason ? `<div class="ll-tiny" style="color:var(--ll-red);margin-top:4px">Reason: ${esc(i.rejection_reason)}</div>` : ''}
        <div class="ml-actions">${actions.join('')}</div>
      </div>
    </div>`;
  }

  async function myListings(page) {
    const c = page.el.querySelector('[data-container]');
    await LL.store.ready();
    const tabs = [['active', 'Active'], ['pending', 'Pending'], ['sold', 'Sold'], ['expired', 'Expired'], ['draft', 'Drafts'], ['rejected', 'Rejected']];
    let current = page.route.query?.tab || 'active';
    if (!tabs.some(([k]) => k === current)) current = 'active';

    c.innerHTML = `<div class="ll-wrap" style="padding:12px 0 40px">
      <h1 class="page-title">My listings</h1>
      <div class="ml-tabs" id="ml-tabs">${tabs.map(([k, label]) => `<button class="chip ${k === current ? 'chip-active' : ''}" data-tab="${k}">${label} <span class="ml-count" data-count="${k}"></span></button>`).join('')}</div>
      <div class="ll-flex" style="gap:8px;margin:6px 2px 14px">
        <a class="button button-gold" href="/post" data-role="link"><ion-icon name="add-circle"></ion-icon> Post new ad</a>
      </div>
      <div id="ml-list">${LL.skeletonRows(3)}</div>
    </div>`;
    LL.setNavTitle('My listings');

    async function load(tab) {
      const list = c.querySelector('#ml-list');
      list.innerHTML = LL.skeletonRows(3);
      try {
        const r = await LL.api.get(`/listings/mine?status=${tab}`);
        c.querySelectorAll('[data-count]').forEach((el) => { el.textContent = r.counts[el.dataset.count] ? `(${r.counts[el.dataset.count]})` : ''; });
        list.innerHTML = r.items.length
          ? r.items.map(mineCard).join('')
          : emptyState({ icon: 'camera-outline', title: `No ${tab} listings`, text: tab === 'draft' ? 'Drafts you save will appear here.' : 'Listings in this state will appear here.', actionHtml: '<a class="button button-gold" href="/post" data-role="link">Post an Ad</a>' });
      } catch (e) { list.innerHTML = LL.errorState(); }
    }
    c.querySelector('#ml-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (!b) return;
      current = b.dataset.tab;
      c.querySelectorAll('#ml-tabs .chip').forEach((x) => x.classList.toggle('chip-active', x === b));
      load(current);
    });
    c.querySelector('#ml-list').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const id = b.dataset.id;
      const act = b.dataset.act;
      if (act === 'edit') return LL.f7.views.main.router.navigate(`/post?edit=${id}`);
      if (act === 'delete') {
        if (!await LL.confirmDialog('Delete listing?', 'This permanently removes the listing and its photos.')) return;
        await LL.api.del(`/listings/${id}`); LL.toast('Listing deleted', 'trash');
        return load(current);
      }
      if (act === 'promote') {
        try {
          const r = await LL.api.get('/packages');
          const pkgs = (r.packages || []);
          LL.f7.dialog.alert(pkgs.length
            ? pkgs.map((p) => `${p.name} — ${money(p.price)} · ${p.duration_days} days`).join('<br>') + '<br><br>Online payments are not activated in v1 — please use <b>Contact us</b> to feature this ad.'
            : 'Promotion packages will appear here soon.', 'Promote your listing');
        } catch { /* noop */ }
        return;
      }
      b.classList.add('button-loading');
      try {
        const r = await LL.api.post(`/listings/${id}/actions`, { action: act });
        LL.toast(r.message || 'Done');
        load(current);
      } catch (err) { LL.toastError(err); b.classList.remove('button-loading'); }
    });
    load(current);
  }

  async function favorites(page) {
    const c = page.el.querySelector('[data-container]');
    await LL.store.ready();
    c.innerHTML = `<div class="ll-wrap" style="padding:12px 0 40px">
      <h1 class="page-title">Saved listings</h1>
      <div id="fav-list">${LL.skeletonCards(4)}</div></div>`;
    LL.setNavTitle('Favourites');
    try {
      const r = await LL.api.get('/account/favorites');
      c.querySelector('#fav-list').innerHTML = r.items.length
        ? `<div class="ll-grid">${r.items.map(listingCard).join('')}</div>`
        : emptyState({ icon: 'heart-outline', title: 'No saved listings yet', text: 'Tap the heart on any listing to keep it here for later.', actionHtml: '<a class="button" href="/search" data-role="link">Browse cameras</a>' });
    } catch (e) {
      if (e.status === 401 || /auth/i.test(e.message)) c.querySelector('#fav-list').innerHTML = emptyState({ icon: 'lock-closed-outline', title: 'Sign in to see saved listings', text: 'Your favourites are tied to your account.', actionHtml: '<a class="button" href="/sign-in?next=%2Ffavorites" data-role="link">Sign in</a>' });
      else c.querySelector('#fav-list').innerHTML = LL.errorState();
    }
  }

  function profileHeader(p, own) {
    const badges = [];
    if (p.shop && p.shop.verified) badges.push('<span class="verified-badge verified-business"><ion-icon name="shield-checkmark"></ion-icon> Verified camera shop</span>');
    if (p.verified_phone) badges.push('<span class="verified-badge verified-phone"><ion-icon name="call"></ion-icon> Phone verified</span>');
    if (p.verified_email) badges.push('<span class="verified-badge verified-email"><ion-icon name="mail"></ion-icon> Email verified</span>');
    return `<div class="ll-card ll-card-pad profile-head">
      <div class="seller-head">
        <span class="seller-logo" style="border-radius:50%;overflow:hidden">${avatarHtml({ name: p.name, avatar: p.avatar }, 'seller-logo')}</span>
        <div style="flex:1;min-width:0">
          <h2 class="profile-name">${esc(p.name)}</h2>
          <div class="ll-tiny ll-muted"><ion-icon name="time-outline"></ion-icon> Member since ${dateLong(p.member_since)} · <ion-icon name="location-outline"></ion-icon> ${esc(p.location || 'Sri Lanka')}</div>
          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">${badges.join('')}</div>
        </div>
        ${own ? '<a class="button button-outline button-sm" href="/settings" data-role="link">Edit profile</a>' : ''}
      </div>
      ${p.bio ? `<p style="margin:12px 0 0">${esc(p.bio)}</p>` : ''}
      <div class="profile-stats">
        <div><b>${num(p.active_count ?? 0)}</b><span>Active listings</span></div>
        <div><b>${num(p.sold_count ?? 0)}</b><span>Sold</span></div>
        ${p.shop ? `<a href="/shop/${p.shop.slug}" data-role="link" class="button button-teal button-sm" style="grid-column:span 2;align-self:center"><ion-icon name="storefront-outline"></ion-icon> View ${esc(p.shop.name)}</a>` : ''}
      </div>
    </div>`;
  }

  async function profile(page) {
    const c = page.el.querySelector('[data-container]');
    await LL.store.ready();
    const me = LL.store.me;
    const userId = page.route.params.id ? Number(page.route.params.id) : me?.id;
    const own = !page.route.params.id;
    c.innerHTML = `<div class="ll-wrap" style="padding:12px 0 40px"><div id="p-body">${LL.skeletonCards(3)}</div></div>`;
    LL.setNavTitle('Profile');

    if (own && !me) { c.querySelector('#p-body').innerHTML = emptyState({ icon: 'person-outline', title: 'You are not signed in', text: 'Sign in to view your profile.', actionHtml: `<a class="button" href="/sign-in?next=%2Fprofile" data-role="link">Sign in</a>` }); return; }

    try {
      let p, listings;
      if (own) {
        const r = await LL.api.get(`/account/users/${me.id}`);
        p = r.profile; listings = r.listings;
      } else {
        const r = await LL.api.get(`/account/users/${userId}`);
        p = r.profile; listings = r.listings;
      }
      const body = c.querySelector('#p-body');
      body.innerHTML = profileHeader(p, own) + (own ? `
        <div class="profile-menu ll-card">
          <a href="/my-listings" data-role="link"><ion-icon name="camera-outline"></ion-icon> My listings <ion-icon name="chevron-forward" class="pm-arrow"></ion-icon></a>
          <a href="/dashboard" data-role="link"><ion-icon name="bar-chart-outline"></ion-icon> Seller dashboard <ion-icon name="chevron-forward" class="pm-arrow"></ion-icon></a>
          <a href="/favorites" data-role="link"><ion-icon name="heart-outline"></ion-icon> Saved listings <ion-icon name="chevron-forward" class="pm-arrow"></ion-icon></a>
          <a href="/chat" data-role="link"><ion-icon name="chatbubble-ellipses-outline"></ion-icon> Messages <ion-icon name="chevron-forward" class="pm-arrow"></ion-icon></a>
          <a href="/notifications" data-role="link"><ion-icon name="notifications-outline"></ion-icon> Notifications <ion-icon name="chevron-forward" class="pm-arrow"></ion-icon></a>
          <a href="/settings" data-role="link"><ion-icon name="settings-outline"></ion-icon> Settings <ion-icon name="chevron-forward" class="pm-arrow"></ion-icon></a>
          ${me.role === 'admin' ? '<a href="/admin" data-role="link"><ion-icon name="shield-outline"></ion-icon> Admin panel <ion-icon name="chevron-forward" class="pm-arrow"></ion-icon></a>' : ''}
        </div>` : '') + `
        <div class="section-head"><h2>${own ? 'Your active listings' : 'Listings'}</h2></div>
        ${listings.length ? `<div class="ll-grid">${listings.map(listingCard).join('')}</div>` : emptyState({ icon: 'camera-outline', title: 'No active listings', text: own ? 'Post your first ad in minutes.' : 'This seller has no active listings right now.' })}`;
    } catch (e) {
      if (e.status === 404) c.querySelector('#p-body').innerHTML = emptyState({ icon: 'person-outline', title: 'User not found', text: 'This profile is not available.' });
      else c.querySelector('#p-body').innerHTML = LL.errorState();
    }
  }

  async function settings(page) {
    const c = page.el.querySelector('[data-container]');
    await LL.store.ready();
    const me = LL.store.me;
    if (!me) { LL.store.requireLogin('/settings'); c.innerHTML = ''; return; }
    const locations = await LL.store.getLocations();
    const myShop = (await LL.api.get('/account/me/shop').catch(() => ({ shop: null }))).shop;

    const locOptions = (selected) => {
      let html = '<option value="">Select city/town</option>';
      for (const p of locations) for (const d of p.children || []) for (const ct of d.children || []) {
        html += `<option value="${ct.id}" ${String(ct.id) === String(selected || '') ? 'selected' : ''}>${esc(ct.name)}, ${esc(d.name)}</option>`;
      }
      return html;
    };

    c.innerHTML = `<div class="ll-wrap" style="padding:12px 0 60px">
      <h1 class="page-title">Settings</h1>
      <div class="ll-card ll-card-pad">
        <h3>Profile</h3>
        <div class="ll-flex" style="gap:14px;align-items:center;margin-bottom:10px">
          <span id="av-preview" style="width:64px;height:64px;border-radius:50%;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;background:var(--ll-navy);color:#fff;font-weight:800;font-size:20px">${esc(LL.initials(me.name))}</span>
          <div><label class="button button-outline button-sm" for="av-input">Change photo<input type="file" id="av-input" accept="image/*" hidden></label><div class="ll-tiny ll-muted">Square photo works best.</div></div>
        </div>
        <div class="ll-field"><label>Display name</label><input class="ll-input" id="s-name" value="${esc(me.name)}"></div>
        <div class="ll-field"><label>Bio / about you</label><textarea class="ll-textarea" id="s-bio" rows="3" placeholder="Tell buyers about the gear you sell">${esc(me.bio || '')}</textarea></div>
        <div class="ll-field"><label>City / town</label><select class="ll-input" id="s-loc">${locOptions(me.location_id)}</select></div>
      </div>

      <div class="ll-card ll-card-pad" style="margin-top:14px">
        <h3>Contact defaults</h3>
        <div class="ll-field"><label>Phone</label><input class="ll-input" id="s-phone" type="tel" value="${esc((me.contact_phone || me.phone || '').replace('+94', '0'))}" placeholder="077 123 4567"></div>
        <div class="ll-field"><label>WhatsApp (if different)</label><input class="ll-input" id="s-wa" type="tel" value="${esc(LL.localSL(me.whatsapp || ''))}" placeholder="077 123 4567"></div>
        <label class="ll-switch"><input type="checkbox" id="s-call" ${me.calls_enabled === false ? '' : 'checked'}><span>Allow calls by default</span></label>
        <label class="ll-switch"><input type="checkbox" id="s-waen" ${me.whatsapp_enabled === false ? '' : 'checked'}><span>Allow WhatsApp by default</span></label>
        <label class="ll-switch"><input type="checkbox" id="s-chat" ${me.chat_enabled === false ? '' : 'checked'}><span>Allow in-app chat by default</span></label>
      </div>

      <div class="ll-card ll-card-pad" style="margin-top:14px">
        <h3>Verifications</h3>
        <div class="verify-row"><span><ion-icon name="${me.email_verified ? 'checkmark-circle' : 'ellipse-outline'}" style="color:${me.email_verified ? 'var(--ll-teal)' : 'var(--ll-muted)'}"></ion-icon> Email address ${me.email_verified ? 'verified' : 'not verified'}</span>
          ${me.email_verified ? '' : '<button class="button button-outline button-sm" id="v-email">Send link</button>'}</div>
        <div class="verify-row"><span><ion-icon name="${me.phone_verified ? 'checkmark-circle' : 'ellipse-outline'}" style="color:${me.phone_verified ? 'var(--ll-teal)' : 'var(--ll-muted)'}"></ion-icon> Phone number ${me.phone_verified ? 'verified' : 'not verified'}</span>
          ${me.phone_verified ? '' : '<button class="button button-outline button-sm" id="v-phone">Verify</button>'}</div>
      </div>

      <div class="ll-card ll-card-pad" style="margin-top:14px">
        <h3>Camera shop (business seller)</h3>
        ${myShop
          ? `<div class="ll-tiny">Status: <b>${esc(myShop.status)}</b>${myShop.verified_at ? ' · verified' : ''}</div>
             <a class="button button-outline button-sm" style="margin-top:8px" href="/shop/${esc(myShop.slug)}" data-role="link">View shop page</a>
             <button class="button button-outline button-sm" id="shop-edit" style="margin-top:8px">Edit application</button>`
          : `<p class="ll-tiny ll-muted">Camera shops get a business profile page, shop badge and shop-branded listings. Verification is free in v1.</p>
             <button class="button button-teal" id="shop-apply">Apply for a shop profile</button>`}
      </div>

      <div style="display:flex;gap:10px;margin-top:16px">
        <button class="button" id="s-save" style="flex:1">Save settings</button>
        <button class="button button-outline" id="s-logout">Sign out</button>
      </div>
    </div>

    <div class="sheet-modal sheet-bottom" id="shop-sheet" style="max-height:86vh">
      <div class="sheet-toolbar"><div class="left"></div><div class="sheet-toolbar-title">Camera shop profile</div><div class="right"><a class="link sheet-close">Close</a></div></div>
      <div class="sheet-content" style="padding:16px 16px 100px">
        <div class="ll-field"><label>Shop name</label><input class="ll-input" id="sh-name" value="${esc(myShop?.shop_name || '')}" placeholder="e.g. Pixel Hub Camera Store"></div>
        <div class="ll-field"><label>Description</label><textarea class="ll-textarea" id="sh-desc" rows="3" placeholder="What your shop sells, years in business…">${esc(myShop?.description || '')}</textarea></div>
        <div class="ll-field"><label>City</label><select class="ll-input" id="sh-loc">${locOptions(myShop?.location_id)}</select></div>
        <div class="ll-field"><label>Address</label><input class="ll-input" id="sh-addr" value="${esc(myShop?.address || '')}"></div>
        <div class="ll-field"><label>Shop phone</label><input class="ll-input" id="sh-phone" type="tel" value="${esc((myShop?.phone || '').replace('+94', '0'))}"></div>
        <div class="ll-field"><label>Opening hours</label><input class="ll-input" id="sh-hours" value="${esc(myShop?.opening_hours || '')}" placeholder="Mon–Sat 9am–6pm"></div>
        <button class="button button-teal" id="sh-send" style="width:100%">${myShop ? 'Update application' : 'Submit for verification'}</button>
      </div>
    </div>

    <div class="popup tablet-fullscreen" id="otp-popup">
      <div class="view"><div class="page"><div class="page-content ll-wrap" style="padding:24px">
        <div class="navbar"><div class="navbar-inner"><div class="title">Verify phone</div><div class="right"><a class="link popup-close">Close</a></div></div></div>
        <h2>Enter the 6-digit code</h2>
        <p class="ll-tiny ll-muted">Codes are delivered via the developer email outbox in v1 (SMS gateway not yet configured).</p>
        <input class="ll-input" id="otp-code" inputmode="numeric" maxlength="6" placeholder="123456">
        <button class="button" id="otp-go" style="width:100%;margin-top:10px">Verify</button>
      </div></div></div>
    </div>`;
    LL.setNavTitle('Settings');

    const sheet = LL.f7.sheet.create({ el: c.querySelector('#shop-sheet') });
    const otpPopup = LL.f7.popup.create({ el: c.querySelector('#otp-popup') });

    // avatar
    c.querySelector('#av-input').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas');
        const size = Math.min(img.width, img.height);
        cv.width = cv.height = 400;
        const sx = (img.width - size) / 2, sy = (img.height - size) / 2;
        cv.getContext('2d').drawImage(img, sx, sy, size, size, 0, 0, 400, 400);
        const dataUrl = cv.toDataURL('image/jpeg', 0.85);
        c.querySelector('#av-preview').innerHTML = `<img src="${dataUrl}" style="width:64px;height:64px;object-fit:cover">`;
        c.querySelector('#av-preview').dataset.data = dataUrl;
      };
      img.src = URL.createObjectURL(f);
    });

    c.querySelector('#s-save').addEventListener('click', async (e) => {
      const body = {
        name: c.querySelector('#s-name').value.trim(),
        bio: c.querySelector('#s-bio').value.trim(),
        phone: c.querySelector('#s-phone').value.trim(),
        whatsapp: c.querySelector('#s-wa').value.trim(),
        location_id: c.querySelector('#s-loc').value || undefined,
        calls_enabled: c.querySelector('#s-call').checked,
        whatsapp_enabled: c.querySelector('#s-waen').checked,
        chat_enabled: c.querySelector('#s-chat').checked,
      };
      const av = c.querySelector('#av-preview').dataset.data;
      if (av) body.avatar = av;
      await LL.withLoading(e.currentTarget, async () => {
        try { const r = await LL.api.patch('/account/me', body); LL.store.me = r.user; await LL.store.loadMe(); LL.toast('Settings saved'); }
        catch (err) { LL.toastError(err); }
      });
    });
    c.querySelector('#s-logout').addEventListener('click', async () => {
      await LL.api.post('/auth/logout');
      LL.store.me = null;
      LL.toast('Signed out');
      LL.f7.views.main.router.navigate('/', { reloadCurrent: true, ignoreCache: true });
    });
    c.querySelector('#v-email')?.addEventListener('click', async () => {
      try { await LL.api.post('/auth/resend-verification'); LL.toast('Verification email sent'); }
      catch (e) { LL.toastError(e); }
    });
    c.querySelector('#v-phone')?.addEventListener('click', async () => {
      try { await LL.api.post('/auth/phone/request-code', { phone: c.querySelector('#s-phone').value.trim() }); otpPopup.open(); }
      catch (e) { LL.toastError(e); }
    });
    c.querySelector('#otp-go').addEventListener('click', async () => {
      try {
        await LL.api.post('/auth/phone/verify', { code: c.querySelector('#otp-code').value.trim() });
        LL.toast('Phone verified'); otpPopup.close(); await LL.store.loadMe(); LL.f7.views.main.router.reload();
      } catch (e) { LL.toastError(e); }
    });
    const openShop = () => sheet.open();
    c.querySelector('#shop-apply')?.addEventListener('click', openShop);
    c.querySelector('#shop-edit')?.addEventListener('click', openShop);
    c.querySelector('#sh-send').addEventListener('click', async (e) => {
      await LL.withLoading(e.currentTarget, async () => {
        try {
          await LL.api.post('/account/shops/apply', {
            shop_name: c.querySelector('#sh-name').value.trim(),
            description: c.querySelector('#sh-desc').value.trim(),
            location_id: c.querySelector('#sh-loc').value || undefined,
            address: c.querySelector('#sh-addr').value.trim(),
            phone: c.querySelector('#sh-phone').value.trim(),
            opening_hours: c.querySelector('#sh-hours').value.trim(),
          });
          sheet.close(); LL.toast('Shop application submitted');
        } catch (err) { LL.toastError(err); }
      });
    });
  }

  async function dashboard(page) {
    const c = page.el.querySelector('[data-container]');
    await LL.store.ready();
    if (!LL.store.me) { LL.store.requireLogin('/dashboard'); c.innerHTML = ''; return; }
    c.innerHTML = `<div class="ll-wrap" style="padding:12px 0 40px">
      <h1 class="page-title">Seller dashboard</h1>
      <div id="d-body">${LL.skeletonCards(2)}</div></div>`;
    LL.setNavTitle('Dashboard');
    try {
      const s = await LL.api.get('/account/me/stats');
      const maxBar = Math.max(1, ...s.series.map((x) => x.n));
      const bars = s.series.length ? s.series.map((x) =>
        `<div class="chart-col" title="${x.d}: ${x.n} views"><div class="chart-bar" style="height:${Math.round((x.n / maxBar) * 100)}%"></div><small>${x.d.slice(5)}</small></div>`).join('')
        : '<p class="ll-muted ll-tiny">No views in the last 14 days yet.</p>';
      const stat = (label, n, icon) => `<div class="dash-stat ll-card ll-card-pad"><ion-icon name="${icon}"></ion-icon><b>${num(n)}</b><span>${label}</span></div>`;
      c.querySelector('#d-body').innerHTML = `
        <div class="dash-grid">
          ${stat('Total views', s.totals.views, 'eye-outline')}
          ${stat('Times saved', s.totals.favorites, 'heart-outline')}
          ${stat('Active ads', s.totals.active, 'camera-outline')}
          ${stat('Messages', s.totals.messages, 'chatbubble-ellipses-outline')}
          ${stat('Offers', s.totals.offers, 'pricetag-outline')}
          ${stat('Call clicks', s.totals.calls, 'call-outline')}
          ${stat('WhatsApp clicks', s.totals.whatsapp_clicks, 'logo-whatsapp')}
          ${stat('Sold', s.counts.sold, 'checkmark-done-circle-outline')}
        </div>
        <div class="ll-card ll-card-pad" style="margin-top:14px">
          <h3>Views — last 14 days</h3>
          <div class="chart">${bars}</div>
        </div>
        <div class="ll-card ll-card-pad" style="margin-top:14px">
          <h3>Listing statuses</h3>
          <div class="ll-chips">
            ${Object.entries(s.counts).map(([k, v]) => `<a class="chip" href="/my-listings?tab=${k}" data-role="link">${k} (${v})</a>`).join('')}
          </div>
        </div>
        ${s.shop ? `<div class="ll-card ll-card-pad" style="margin-top:14px">
          <h3>Your camera shop</h3>
          <p class="ll-tiny">${esc(s.shop.name)} — status <b>${esc(s.shop.status)}</b>${s.shop.verified ? ' · verified' : ''}</p>
          <a class="button button-teal button-sm" href="/shop/${s.shop.slug}" data-role="link">View shop page</a>
        </div>` : ''}
        <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">
          <a class="button button-gold" href="/post" data-role="link"><ion-icon name="add-circle"></ion-icon> Post new ad</a>
          <a class="button button-outline" href="/my-listings" data-role="link">Manage listings</a>
        </div>`;
    } catch (e) { c.querySelector('#d-body').innerHTML = LL.errorState(); }
  }

  Object.assign(LL.controllers, { myListings, favorites, profile, settings, dashboard });
})();
