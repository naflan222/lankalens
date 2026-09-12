/* Admin panel — moderation, reports, users, catalog, settings, audit */
(function () {
  const LL = window.LL;
  const { esc, money, num, timeAgo, conditionPill, emptyState } = LL;

  LL.controllers = LL.controllers || {};
  LL.controllers.admin = async function (page) {
    const c = page.el.querySelector('[data-container]');
    await LL.store.ready();
    const me = LL.store.me;
    if (!me) { LL.store.requireLogin('/admin'); c.innerHTML = ''; return; }
    if (me.role !== 'admin') {
      c.innerHTML = `<div class="ll-wrap" style="padding:30px 0">${emptyState({ icon: 'lock-closed-outline', title: 'Admins only', text: 'You do not have permission to view this page.', actionHtml: '<a class="button" href="/" data-role="link">Go home</a>' })}</div>`;
      return;
    }
    const tabs = [['dash', 'Dashboard'], ['queue', 'Moderation'], ['reports', 'Reports'], ['users', 'Users'], ['catalog', 'Catalog'], ['content', 'Settings'], ['audit', 'Audit']];
    c.innerHTML = `<div class="admin-shell">
      <div class="admin-head">
        <h1 class="page-title" style="margin:0">Admin panel</h1>
        <span class="ll-tiny ll-muted">Lanka Lens moderation console</span>
      </div>
      <div class="admin-tabs">${tabs.map(([k, l], i) => `<button class="chip ${i === 0 ? 'chip-active' : ''}" data-atab="${k}">${l}</button>`).join('')}</div>
      <div id="admin-body"></div>
    </div>`;
    LL.setNavTitle('Admin');
    const body = c.querySelector('#admin-body');
    let curTab = 'dash';

    // Single delegated handler for moderation buttons on the Dashboard "Latest listings" feed.
    // (Queue-tab buttons have their own scoped handler inside T.queue.)
    body.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-mod]');
      if (!b || b.closest('#q-list')) return;
      const id = b.dataset.id, dec = b.dataset.mod;
      let reason = '';
      if (['reject', 'changes', 'suspend'].includes(dec)) {
        reason = await new Promise((res) => LL.f7.dialog.prompt(dec === 'changes' ? 'What should the seller change?' : 'Reason (shown to seller)', dec, (v) => res(v), () => res(null)));
        if (!reason) return;
      }
      if (dec === 'delete' && !await LL.confirmDialog('Delete this listing?', 'This cannot be undone.')) return;
      b.classList.add('button-loading');
      try {
        const r = await LL.api.post(`/admin/listings/${id}/moderate`, { decision: dec, reason });
        LL.toast(r.message);
        T[curTab]();
      } catch (err) { LL.toastError(err); b.classList.remove('button-loading'); }
    });

    const T = {};
    T.dash = async () => {
      body.innerHTML = LL.skeletonCards(4);
      const { stats, latest_listings } = await LL.api.get('/admin/stats');
      const stat = (n, label, icon) => `<div class="dash-stat ll-card ll-card-pad"><ion-icon name="${icon}"></ion-icon><b>${num(n)}</b><span>${label}</span></div>`;
      body.innerHTML = `
        <div class="dash-grid">
          ${stat(stats.users, 'Users (' + stats.signups_7d + ' this week)', 'people-outline')}
          ${stat(stats.sellers, 'Individual sellers', 'person-outline')}
          ${stat(stats.businesses, 'Approved shops', 'storefront-outline')}
          ${stat(stats.shops_pending, 'Shop applications', 'time-outline')}
          ${stat(stats.listings_active, 'Active listings', 'checkmark-circle-outline')}
          ${stat(stats.listings_pending, 'Pending review', 'hourglass-outline')}
          ${stat(stats.listings_sold, 'Sold', 'checkmark-done-circle-outline')}
          ${stat(stats.reports_open, 'Open reports', 'flag-outline')}
          ${stat(stats.views, 'Total views', 'eye-outline')}
          ${stat(stats.messages, 'Messages', 'chatbubble-ellipses-outline')}
          ${stat(money(stats.revenue), 'Revenue (dormant)', 'cash-outline')}
          ${stat(stats.listings_7d, 'Ads this week', 'trending-up-outline')}
        </div>
        <h3 style="margin-top:18px">Latest listings</h3>
        <div class="admin-queue">${latest_listings.map(modRow).join('')}</div>`;
    };

    function modRow(r) {
      return `<div class="admin-listing ll-card">
        <img src="${esc(r.cover || r.images?.[0]?.url || '')}" alt="">
        <div class="al-info">
          <div class="ll-flex" style="gap:6px;flex-wrap:wrap"><span class="listing-status status-${r.status}">${r.status}</span>${conditionPill(r.condition)}${r.is_featured ? '<span class="pill pill-gold ll-tiny">Featured</span>' : ''}</div>
          <a href="/listing/${r.slug}" target="_blank" class="al-title">${esc(r.title)}</a>
          <div class="ll-tiny ll-muted">${money(r.price)} · ${esc(r.category_name || '')} · ${esc(r.seller_name || '')} · ${timeAgo(r.created_at)}</div>
          <div class="al-actions">
            ${r.status === 'pending' ? `
              <button class="button button-sm" data-mod="approve" data-id="${r.id}">Approve</button>
              <button class="button button-sm button-outline" data-mod="changes" data-id="${r.id}">Request changes</button>
              <button class="button button-sm button-outline" data-mod="reject" data-id="${r.id}">Reject</button>` : ''}
            ${r.status === 'active' ? `
              <button class="button button-sm button-gold" data-mod="${r.is_featured ? 'unfeature' : 'feature'}" data-id="${r.id}">${r.is_featured ? 'Unfeature' : 'Feature 7d'}</button>
              <button class="button button-sm button-outline" data-mod="suspend" data-id="${r.id}">Suspend</button>
              <button class="button button-sm button-outline" data-mod="sold" data-id="${r.id}">Mark sold</button>` : ''}
            ${['rejected', 'suspended'].includes(r.status) ? '<button class="button button-sm" data-mod="approve" data-id="' + r.id + '">Reinstate</button>' : ''}
            <button class="button button-sm button-outline" data-mod="delete" data-id="${r.id}" style="color:var(--ll-red)"><ion-icon name="trash-outline"></ion-icon></button>
          </div>
        </div>
      </div>`;
    }

    T.queue = async () => {
      const statuses = [['pending', 'Pending'], ['active', 'Active'], ['rejected', 'Rejected'], ['suspended', 'Suspended'], ['sold', 'Sold'], ['expired', 'Expired'], ['all', 'All']];
      let cur = 'pending';
      body.innerHTML = `<div class="ll-chips" id="q-tabs">${statuses.map(([k, l]) => `<button class="chip ${k === cur ? 'chip-active' : ''}" data-q="${k}">${l}</button>`).join('')}</div><div id="q-list" class="admin-queue" style="margin-top:12px"></div>`;
      const load = async () => {
        body.querySelector('#q-list').innerHTML = LL.skeletonCards(3);
        const r = await LL.api.get(`/admin/listings?status=${cur}`);
        body.querySelector('#q-list').innerHTML = r.items.length ? r.items.map(modRow).join('')
          : emptyState({ icon: 'checkmark-done-circle-outline', title: 'Nothing here', text: 'No listings in this state.' });
      };
      body.querySelector('#q-tabs').addEventListener('click', (e) => {
        const b = e.target.closest('[data-q]');
        if (!b) return;
        cur = b.dataset.q;
        body.querySelectorAll('#q-tabs .chip').forEach((x) => x.classList.toggle('chip-active', x === b));
        load();
      });
      // scoped to #q-list so the listener is discarded with the rendered markup (no accumulation across tab switches)
      body.querySelector('#q-list').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-mod]');
        if (!b) return;
        const id = b.dataset.id, dec = b.dataset.mod;
        let reason = '';
        if (['reject', 'changes', 'suspend'].includes(dec)) {
          reason = await new Promise((res) => LL.f7.dialog.prompt(dec === 'changes' ? 'What should the seller change?' : 'Reason (shown to seller)', dec, (v) => res(v), () => res(null)));
          if (!reason) return;
        }
        if (dec === 'delete' && !await LL.confirmDialog('Delete this listing?', 'This cannot be undone.')) return;
        b.classList.add('button-loading');
        try {
          const r = await LL.api.post(`/admin/listings/${id}/moderate`, { decision: dec, reason });
          LL.toast(r.message);
          load();
        } catch (err) { LL.toastError(err); b.classList.remove('button-loading'); }
      });
      load();
    };

    T.reports = async () => {
      let cur = 'open';
      body.innerHTML = `<div class="ll-chips" id="r-tabs">${['open', 'resolved', 'dismissed', 'all'].map((k) => `<button class="chip ${k === cur ? 'chip-active' : ''}" data-r="${k}">${k}</button>`).join('')}</div><div id="r-list" style="margin-top:12px"></div>`;
      const load = async () => {
        body.querySelector('#r-list').innerHTML = LL.skeletonCards(2);
        const { reports } = await LL.api.get(`/admin/reports?status=${cur}`);
        body.querySelector('#r-list').innerHTML = reports.length ? `<div class="ll-card" style="padding:0">${reports.map((r) => `
          <div class="report-row" style="padding:12px 14px;border-bottom:1px solid var(--ll-border)">
            <div class="ll-flex" style="justify-content:space-between;gap:8px">
              <b>${esc(r.reason.replace(/_/g, ' '))}</b><span class="listing-status status-${r.status === 'open' ? 'pending' : 'expired'}">${r.status}</span>
            </div>
            <p class="ll-tiny" style="margin:4px 0">${esc(r.details || '')}</p>
            <div class="ll-tiny ll-muted">${esc(r.target_type)}: ${esc(r.target_title || '#' + r.target_id)} · by ${esc(r.reporter_name || 'guest')} · ${timeAgo(r.created_at)}</div>
            ${r.status === 'open' ? `<div class="ll-flex" style="gap:6px;margin-top:8px">
              <button class="button button-sm" data-rp="resolved" data-id="${r.id}">Resolve</button>
              <button class="button button-sm button-outline" data-rp="dismissed" data-id="${r.id}">Dismiss</button>
              ${r.target_type === 'listing' ? `<button class="button button-sm button-outline" data-rp="remove" data-id="${r.id}" data-target="${r.target_id}" style="color:var(--ll-red)">Delete listing</button>` : ''}
            </div>` : ''}
          </div>`).join('')}</div>`
          : emptyState({ icon: 'shield-checkmark-outline', title: 'No reports', text: 'Nothing in this state.' });
      };
      body.querySelector('#r-tabs').addEventListener('click', (e) => {
        const b = e.target.closest('[data-r]');
        if (!b) return;
        cur = b.dataset.r;
        body.querySelectorAll('#r-tabs .chip').forEach((x) => x.classList.toggle('chip-active', x === b));
        load();
      });
      body.querySelector('#r-list').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-rp]');
        if (!b) return;
        if (b.dataset.rp === 'remove') {
          if (!await LL.confirmDialog('Delete the reported listing?', 'This cannot be undone and resolves the report.')) return;
          await LL.api.post(`/admin/reports/${b.dataset.id}`, { decision: 'resolved', remove: true, note: 'Listing deleted per report' });
        } else {
          await LL.api.post(`/admin/reports/${b.dataset.id}`, { decision: b.dataset.rp === 'resolved' ? 'resolve' : 'dismiss' });
        }
        LL.toast('Report updated'); load();
      });
      load();
    };

    T.users = async () => {
      body.innerHTML = `<div class="ll-flex" style="gap:8px;margin-bottom:10px"><input class="ll-input" id="u-q" placeholder="Search name or email…" style="flex:1"><button class="button button-sm" id="u-go">Search</button></div><div id="u-list"></div>`;
      const load = async (q = '') => {
        const { users } = await LL.api.get('/admin/users' + (q ? '?q=' + encodeURIComponent(q) : ''));
        body.querySelector('#u-list').innerHTML = `<div class="ll-card" style="padding:0">${users.map((u) => `
          <div class="ll-flex" style="padding:10px 14px;border-bottom:1px solid var(--ll-border);gap:10px;align-items:center">
            <div style="flex:1;min-width:0">
              <b>${esc(u.name)}</b> <span class="ll-tiny ll-muted">${esc(u.email)} · ${esc(u.role)} · ${esc(u.seller_type || '')}</span>
              <div class="ll-tiny ll-muted">${u.listings_count} listings · ${u.verified_business ? 'business verified · ' : ''}${u.email_verified_at ? 'email verified' : 'email unverified'}</div>
            </div>
            <span class="listing-status status-${u.status === 'active' ? 'active' : 'rejected'}">${u.status}</span>
            <div class="ll-flex" style="gap:4px">
              ${u.status === 'active' ? `<button class="button button-sm button-outline" data-u="suspend" data-id="${u.id}">Suspend</button>` : `<button class="button button-sm" data-u="activate" data-id="${u.id}">Activate</button>`}
              ${u.role !== 'admin' ? `<button class="button button-sm button-outline" data-u="make_admin" data-id="${u.id}">Make admin</button>` : ''}
              ${!u.verified_business ? `<button class="button button-sm button-teal" data-u="verify_business" data-id="${u.id}">Verify shop</button>` : ''}
            </div>
          </div>`).join('')}</div>`;
      };
      body.querySelector('#u-go').addEventListener('click', () => load(body.querySelector('#u-q').value.trim()));
      body.querySelector('#u-list').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-u]');
        if (!b) return;
        await LL.api.post(`/admin/users/${b.dataset.id}`, { action: b.dataset.u });
        LL.toast('User updated'); load(body.querySelector('#u-q').value.trim());
      });
      load();
    };

    T.catalog = async () => {
      const cats = await LL.store.getCategories();
      const scopes = ['camera', 'lens', 'action', 'drone', 'accessory'];
      body.innerHTML = `<div class="admin-catalog-grid">
        <div class="ll-card ll-card-pad">
          <h3>Categories</h3>
          <div id="cat-tree">${cats.map((t) => `<div class="ll-tiny" style="margin-top:8px"><b>${esc(t.name)}</b>
            ${t.children.map((s) => `<div class="ll-flex" style="justify-content:space-between;padding:3px 0 3px 12px"><span>${esc(s.name)}</span><button class="link ll-tiny" data-delcat="${s.id}">delete</button></div>`).join('')}</div>`).join('')}</div>
          <h4 style="margin-top:14px">Add category</h4>
          <input class="ll-input" id="nc-name" placeholder="Category name">
          <select class="ll-input" id="nc-parent"><option value="">Top-level (accessory group)</option>${cats.flatMap((t) => t.children.map((s) => `<option value="${s.slug}">${esc(t.name)} → ${esc(s.name)}</option>`))}</select>
          <button class="button button-sm" id="nc-go" style="margin-top:8px">Add category</button>
        </div>
        <div class="ll-card ll-card-pad">
          <h3>Brand</h3>
          <input class="ll-input" id="nb-name" placeholder="Brand name">
          <select class="ll-input" id="nb-scope">${scopes.map((s) => `<option>${s}</option>`).join('')}</select>
          <button class="button button-sm" id="nb-go" style="margin-top:8px">Add brand</button>
          <h3 style="margin-top:18px">Model</h3>
          <input class="ll-input" id="np-cat" placeholder="Subcategory slug, e.g. mirrorless">
          <input class="ll-input" id="np-brand" placeholder="Brand slug, e.g. sony">
          <input class="ll-input" id="np-name" placeholder="Model name, e.g. Alpha A7 IV">
          <button class="button button-sm" id="np-go" style="margin-top:8px">Add model</button>
          <h3 style="margin-top:18px">Location</h3>
          <input class="ll-input" id="nl-name" placeholder="Place name">
          <select class="ll-input" id="nl-level"><option value="province">Province</option><option value="district">District</option><option value="city">City</option></select>
          <input class="ll-input" id="nl-parent" type="number" placeholder="Parent location ID (district/city)">
          <button class="button button-sm" id="nl-go" style="margin-top:8px">Add location</button>
        </div>
      </div>`;
      const act = async (id, fn) => { try { await fn(); LL.toast('Saved'); } catch (e) { LL.toastError(e); } };
      body.querySelector('#nc-go').addEventListener('click', async (b) => act(b, async () => {
        await LL.api.post('/admin/categories', { name: body.querySelector('#nc-name').value.trim(), parent_slug: body.querySelector('#nc-parent').value || undefined });
        LL.store.resetCache(); T.catalog();
      }));
      body.querySelector('#cat-tree').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-delcat]');
        if (!b) return;
        if (!await LL.confirmDialog('Delete empty category?', 'Categories with listings cannot be deleted.')) return;
        await LL.api.del('/admin/categories/' + b.dataset.delcat); LL.toast('Deleted'); LL.store.resetCache(); T.catalog();
      });
      body.querySelector('#nb-go').addEventListener('click', () => LL.api.post('/admin/brands', { name: body.querySelector('#nb-name').value.trim(), scope: body.querySelector('#nb-scope').value }).then(() => LL.toast('Brand added')));
      body.querySelector('#np-go').addEventListener('click', () => LL.api.post('/admin/products', { category: body.querySelector('#np-cat').value.trim(), brand: body.querySelector('#np-brand').value.trim(), name: body.querySelector('#np-name').value.trim() }).then(() => LL.toast('Model added')));
      body.querySelector('#nl-go').addEventListener('click', () => LL.api.post('/admin/locations', { name: body.querySelector('#nl-name').value.trim(), level: body.querySelector('#nl-level').value, parent_id: body.querySelector('#nl-parent').value || undefined }).then(() => { LL.store.resetCache(); LL.toast('Location added'); }));
    };

    T.content = async () => {
      const { settings, packages } = await LL.api.get('/admin/settings');
      const input = (k, v) => {
        if (typeof v === 'boolean') return `<label class="ll-switch"><input type="checkbox" data-k="${k}" ${v ? 'checked' : ''}><span>${k}</span></label>`;
        if (typeof v === 'number') return `<div class="ll-field"><label>${k}</label><input class="ll-input" type="number" data-k="${k}" value="${v}"></div>`;
        return `<div class="ll-field"><label>${k}</label><input class="ll-input" data-k="${k}" value="${esc(String(v))}"></div>`;
      };
      body.innerHTML = `<div class="ll-card ll-card-pad">
        <h3>Site settings</h3>
        ${Object.entries(settings).map(([k, v]) => input(k, v)).join('')}
        <button class="button" id="set-go" style="margin-top:10px">Save settings</button>
      </div>
      <div class="ll-card ll-card-pad" style="margin-top:14px">
        <h3>Promotion packages (payments dormant in v1)</h3>
        ${packages.map((p) => `<div class="ll-tiny" style="padding:4px 0">${esc(p.name)} · ${money(p.price_lkr)} · ${p.days}d · ${p.active ? 'active' : 'hidden'}</div>`).join('')}
        <div class="ll-flex" style="gap:6px;margin-top:8px"><input class="ll-input" id="pk-name" placeholder="Package name"><input class="ll-input" id="pk-price" type="number" placeholder="Rs."><input class="ll-input" id="pk-days" type="number" placeholder="days" style="max-width:90px"><button class="button button-sm" id="pk-go">Add</button></div>
      </div>
      <div class="ll-card ll-card-pad" style="margin-top:14px">
        <h3>Developer email outbox</h3>
        <div id="outbox"><p class="ll-tiny ll-muted">Loading…</p></div>
      </div>`;
      body.querySelector('#set-go').addEventListener('click', async () => {
        const patch = {};
        body.querySelectorAll('[data-k]').forEach((el) => {
          patch[el.dataset.k] = el.type === 'checkbox' ? el.checked : (el.type === 'number' ? Number(el.value) : el.value);
        });
        await LL.api.put('/admin/settings', { settings: patch });
        LL.toast('Settings saved');
      });
      body.querySelector('#pk-go').addEventListener('click', () => LL.api.post('/admin/packages', { name: body.querySelector('#pk-name').value, price_lkr: body.querySelector('#pk-price').value, days: body.querySelector('#pk-days').value }).then(() => { LL.toast('Package added'); T.content(); }));
      LL.api.get('/admin/outbox').then(({ emails }) => {
        body.querySelector('#outbox').innerHTML = emails.length ? emails.map((m) => `<div class="ll-flex" style="justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--ll-border)"><span class="ll-tiny"><b>${esc(m.subject)}</b> → ${esc(m.to_email)}<br>${timeAgo(m.created_at)}</span><button class="button button-sm button-outline" data-mail="${m.id}">View</button></div>`).join('')
          : '<p class="ll-tiny ll-muted">No emails (production disables this view).</p>';
        body.querySelector('#outbox').addEventListener('click', (e) => {
          const b = e.target.closest('[data-mail]');
          if (!b) return;
          const m = emails.find((x) => x.id === Number(b.dataset.mail));
          const w = window.open();
          w.document.write(m.html);
        });
      }).catch(() => { body.querySelector('#outbox').innerHTML = '<p class="ll-tiny">Disabled.</p>'; });
    };

    T.audit = async () => {
      body.innerHTML = LL.skeletonCards(2);
      const { logs } = await LL.api.get('/admin/audit');
      body.innerHTML = `<div class="ll-card" style="padding:0;overflow-x:auto"><table class="audit-table">
        <tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Details</th></tr>
        ${logs.map((l) => `<tr><td class="ll-tiny">${timeAgo(l.created_at)}</td><td class="ll-tiny">${esc(l.admin_name || '#' + (l.admin_id || ''))}</td><td class="ll-tiny">${esc(l.action)}</td><td class="ll-tiny">${esc(l.target_type || '')} ${l.target_id || ''}</td><td class="ll-tiny">${esc((l.details_json || '').slice(0, 120))}</td></tr>`).join('')}
      </table></div>`;
    };

    c.querySelector('.admin-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-atab]');
      if (!b) return;
      curTab = b.dataset.atab;
      c.querySelectorAll('.admin-tabs .chip').forEach((x) => x.classList.toggle('chip-active', x === b));
      T[b.dataset.atab]().catch((err) => { body.innerHTML = LL.errorState(); console.error(err); });
    });
    T.dash();
  };
})();
