/* Notifications list */
(function () {
  const LL = window.LL;
  const { esc, timeAgo, emptyState } = LL;

  const ICONS = {
    message: 'chatbubble-ellipses-outline', offer: 'pricetag-outline',
    moderation: 'shield-checkmark-outline', listing_approved: 'checkmark-circle-outline',
    listing_rejected: 'close-circle-outline', listing_sold: 'checkmark-done-circle-outline',
    report: 'flag-outline', business_verify: 'storefront-outline', welcome: 'hand-right-outline',
    favorite: 'heart-outline', system: 'notifications-outline',
  };

  LL.controllers = LL.controllers || {};
  LL.controllers.notifications = async function (page) {
    const c = page.el.querySelector('[data-container]');
    await LL.store.ready();
    if (!LL.store.me) { LL.store.requireLogin('/notifications'); c.innerHTML = ''; return; }
    c.innerHTML = `<div class="ll-wrap" style="padding:12px 0 40px">
      <div class="ll-flex" style="justify-content:space-between;align-items:center">
        <h1 class="page-title" style="margin:0">Notifications</h1>
        <button class="button button-ghost button-sm" id="n-readall">Mark all read</button>
      </div>
      <div id="n-list">${LL.skeletonRows(4)}</div></div>`;
    LL.setNavTitle('Notifications');

    async function load() {
      try {
        const { notifications } = await LL.api.get('/notifications');
        const wrap = c.querySelector('#n-list');
        if (!notifications.length) {
          wrap.innerHTML = emptyState({ icon: 'notifications-off-outline', title: 'No notifications', text: 'Updates about your listings, offers and messages show up here.' });
          return;
        }
        wrap.innerHTML = `<div class="notif-list ll-card" style="padding:0">${notifications.map((n) => `
          <a class="notif-item ${n.read ? '' : 'unread'} ll-listing-link" href="${esc(n.link || '/notifications')}" data-id="${n.id}" data-link="${esc(n.link || '')}">
            <span class="ni-icon"><ion-icon name="${ICONS[n.type] || ICONS.system}"></ion-icon></span>
            <div class="ni-body">
              <div class="ni-title">${esc(n.title)}</div>
              ${n.body ? `<p>${esc(n.body)}</p>` : ''}
              <div class="ll-tiny ll-muted">${timeAgo(n.created_at)}</div>
            </div>
            ${n.read ? '' : '<span class="ni-dot"></span>'}
          </a>`).join('')}</div>`;
        LL.paintBadges();
      } catch (e) { c.querySelector('#n-list').innerHTML = LL.errorState(); }
    }
    c.querySelector('#n-readall').addEventListener('click', async () => {
      await LL.api.post('/notifications/read', {});
      load();
    });
    c.querySelector('#n-list').addEventListener('click', async (e) => {
      const item = e.target.closest('.notif-item');
      if (!item) return;
      if (item.dataset.link) {
        e.preventDefault();
        await LL.api.post('/notifications/read', { id: item.dataset.id }).catch(() => {});
        LL.f7.views.main.router.navigate(item.dataset.link);
      }
    });
    load();
  };
})();
