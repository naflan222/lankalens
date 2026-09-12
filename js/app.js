'use strict';
/* Lanka Lens — Framework7 bootstrap, page-controller dispatch, global chrome. */
(function () {
  const $ = Dom7;
  window.$ = $;

  const app = new Framework7({
    root: '#app',
    theme: 'ios',
    routes,
    stackPages: true,
    view: {
      pushState: true,
      pushStateSeparator: '',
      pushStateRoot: window.location.origin,
      iosSwipeBack: true,
    },
  });
  window.f7 = app;
  LL.f7 = app;
  LL.$ = $;

  // persistent mobile tab bar
  const shellTab = document.getElementById('shell-tabbar');
  if (shellTab) shellTab.outerHTML = LL.mobileTabbarHtml();

  const mainView = app.views.create('.view-main', {
    url: window.location.pathname + window.location.search,
    pushState: true,
    pushStateSeparator: '',
    pushStateRoot: window.location.origin,
    iosSwipeBack: true,
  });

  /* ---------------- page chrome (header/footer) ---------------- */
  function addChrome(page) {
    const el = page.el;
    const content = el.querySelector('.page-content');
    if (!content) return;
    // desktop header (hidden on mobile via CSS)
    if (!content.querySelector('.ll-site-header')) {
      content.insertAdjacentHTML('afterbegin', LL.desktopHeaderHtml());
      const form = content.querySelector('#hdr-search');
      if (form) form.addEventListener('submit', (e) => {
        e.preventDefault();
        const q = form.querySelector('input').value.trim();
        mainView.router.navigate(q ? `/search?q=${encodeURIComponent(q)}` : '/search');
      });
    }
    // footer
    if (el.dataset.footer !== '0' && !content.querySelector('.ll-footer')) {
      content.insertAdjacentHTML('beforeend', LL.footerHtml());
    }
  }

  /* ---------------- controllers ---------------- */
  app.on('pageInit', (page) => {
    addChrome(page);
  });
  app.on('pageAfterIn', (page) => {
    const name = page.el.dataset.controller;
    LL.setActiveNav(page.route.path || location.pathname);
    LL.renderHeaderActions();
    paintBadges();
    if (name && LL.controllers && LL.controllers[name]) {
      try {
        Promise.resolve(LL.controllers[name](page)).catch((e) => {
          console.error('page error', name, e?.message, e?.stack);
          const c = page.el.querySelector('[data-container]');
          if (c && !c.children.length) c.innerHTML = LL.errorState();
        });
      } catch (e) { console.error('page controller failed:', name, e?.message, e?.stack); }
    }
    window.scrollTo(0, 0);
  });

  /* ---------------- global favourite toggling ---------------- */
  async function toggleFav(btn) {
    if (!LL.store.requireLogin()) return;
    const id = btn.dataset.fav;
    btn.style.pointerEvents = 'none';
    try {
      const r = await LL.api.post(`/listings/${id}/favorite`);
      btn.classList.toggle('is-fav', r.favorited);
      btn.innerHTML = `<ion-icon name="${r.favorited ? 'heart' : 'heart-outline'}"></ion-icon>`;
      LL.toast(r.favorited ? 'Saved to favourites' : 'Removed from favourites', r.favorited ? 'heart' : 'heart-outline');
    } catch (e) { LL.toastError(e); }
    btn.style.pointerEvents = '';
  }
  document.addEventListener('click', (e) => {
    const fav = e.target.closest?.('[data-fav]');
    if (fav) { e.preventDefault(); e.stopPropagation(); toggleFav(fav); }
  });

  // retry button on error states
  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('.ll-retry');
    if (btn) { const page = btn.closest('.page'); page?.querySelector('[data-container]')?.dispatchEvent(new CustomEvent('ll:retry', { bubbles: true })); }
  });

  /* ---------------- badges ---------------- */
  function paintBadges() {
    LL.store.badges().then((b) => {
      document.querySelectorAll('[data-badge]').forEach((el) => {
        const key = el.dataset.badge;
        const n = b[key] || 0;
        el.hidden = n < 1;
        el.textContent = n > 9 ? '9+' : n;
      });
      LL.renderHeaderActions();
    });
  }
  LL.paintBadges = paintBadges;
  setInterval(paintBadges, 25000);

  LL.events.on('me', () => LL.renderHeaderActions());

  /* ---------------- boot ---------------- */
  LL.store.bootReady().then(() => {
    LL.renderHeaderActions();
    paintBadges();
  });
  LL.store.getSettings().catch(() => {});
})();
