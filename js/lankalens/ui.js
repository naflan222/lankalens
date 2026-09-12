/* UI helpers: formatting, toasts, dialogs, skeletons, SEO meta. */
(function () {
  const LL = window.LL;

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const money = (n) => 'Rs. ' + Math.round(Number(n || 0)).toLocaleString('en-US');
  const num = (n) => Number(n || 0).toLocaleString('en-US');

  function timeAgo(tsMs) {
    if (!tsMs) return '';
    const s = Math.max(1, Math.floor((Date.now() - tsMs) / 1000));
    const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
    for (const [name, size] of units) {
      const v = Math.floor(s / size);
      if (v >= 1) return `${v} ${name}${v > 1 ? 's' : ''} ago`;
    }
    return 'just now';
  }
  const dateLong = (tsMs) => tsMs ? new Date(tsMs).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const localSL = (p) => {
    if (!p) return '';
    const d = String(p).replace(/[^\d+]/g, '');
    if (d.startsWith('+94')) return '0' + d.slice(3);
    if (d.startsWith('94')) return '0' + d.slice(2);
    return d;
  };
  const initials = (name) => String(name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  function conditionPill(c) {
    const label = LL.CONDITION_LABELS[c] || c;
    return `<span class="pill pill-condition-${c}">${esc(label)}</span>`;
  }

  function toast(message, icon = 'checkmark-circle-outline') {
    if (!LL.f7) return;
    LL.f7.toast.create({ text: message, icon: `<ion-icon name="${icon}"></ion-icon>`, closeTimeout: 2600 }).open();
  }
  function toastError(err) {
    toast(err?.message || 'Something went wrong', 'alert-circle-outline');
  }
  function confirmDialog(title, text) {
    return new Promise((resolve) => {
      LL.f7.dialog.confirm(text, title, () => resolve(true), () => resolve(false));
    });
  }
  function alertDialog(title, text) {
    return new Promise((resolve) => LL.f7.dialog.alert(text, title, () => resolve(true)));
  }

  function withLoading(btn, fn) {
    if (!btn) return fn();
    btn.classList.add('button-loading');
    btn.disabled = true;
    return Promise.resolve()
      .then(fn)
      .finally(() => { btn.classList.remove('button-loading'); btn.disabled = false; });
  }

  function skeletonCards(n = 6) {
    let html = '<div class="ll-grid">';
    for (let i = 0; i < n; i++) {
      html += `<div class="listing-card skeleton-card">
        <div class="lc-img skeleton"></div>
        <div class="lc-body">
          <div class="skeleton skeleton-line" style="width:55%"></div>
          <div class="skeleton skeleton-line" style="width:88%"></div>
          <div class="skeleton skeleton-line" style="width:60%"></div>
        </div></div>`;
    }
    return html + '</div>';
  }

  function skeletonRows(n = 4) {
    let html = '';
    for (let i = 0; i < n; i++) {
      html += `<div class="chat-list-item">
        <div class="skeleton" style="width:48px;height:48px;border-radius:50%"></div>
        <div class="cl-main" style="flex:1">
          <div class="skeleton skeleton-line" style="width:45%;margin:2px 0"></div>
          <div class="skeleton skeleton-line" style="width:85%"></div>
        </div></div>`;
    }
    return html;
  }

  function avatarHtml(user, sizeCls = '') {
    if (user?.avatar) return `<img class="${sizeCls}" src="${esc(user.avatar)}" alt="${esc(user.name || '')}">`;
    return `<span class="cl-avatar ${sizeCls}">${esc(initials(user?.name))}</span>`;
  }

  // SEO: rewrite document metadata on each page (section 54)
  function setMeta({ title, description, image, canonical, jsonLD }) {
    document.title = title ? `${title} | Lanka Lens` : 'Lanka Lens — Buy & Sell Cameras in Sri Lanka';
    const set = (sel, attr, val) => {
      let el = document.head.querySelector(sel);
      if (!el) { el = document.createElement(attr === 'href' ? 'link' : 'meta'); const [, k, v] = sel.match(/\[(.+?)="?(.+?)"?\]$/) || []; el.setAttribute(k, v); document.head.appendChild(el); }
      el.setAttribute(attr, val);
    };
    if (description) {
      set('meta[name="description"]', 'content', description);
      set('meta[property="og:description"]', 'content', description);
    }
    set('meta[property="og:title"]', 'content', document.title);
    if (image) set('meta[property="og:image"]', 'content', image);
    if (canonical) set('link[rel="canonical"]', 'href', canonical);
    let ld = document.getElementById('ll-jsonld');
    if (jsonLD) {
      if (!ld) { ld = document.createElement('script'); ld.id = 'll-jsonld'; ld.type = 'application/ld+json'; document.head.appendChild(ld); }
      ld.textContent = JSON.stringify(jsonLD);
    } else if (ld) ld.remove();
  }

  function setNavTitle(t) {
    const el = document.querySelector('.navbar-current .title') || document.querySelector('.navbar .title');
    if (el) el.textContent = t;
  }

  function debounce(fn, ms = 350) {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function emptyState({ icon = 'camera-outline', title, text, actionHtml = '' }) {
    return `<div class="ll-empty">
      <div class="ee-icon"><ion-icon name="${icon}"></ion-icon></div>
      <h3>${esc(title)}</h3>
      <p>${esc(text)}</p>${actionHtml}
    </div>`;
  }

  function errorState(text = 'We could not load this content. Check your connection and try again.') {
    return emptyState({ icon: 'cloud-offline-outline', title: 'Network error', text,
      actionHtml: '<button class="button button-ghost button-sm ll-retry" style="width:auto;display:inline-flex">Try again</button>' });
  }

  Object.assign(LL, {
    esc, money, num, timeAgo, dateLong, initials, conditionPill,
    toast, toastError, confirmDialog, alertDialog, withLoading, localSL, setNavTitle,
    skeletonCards, skeletonRows, avatarHtml, setMeta, debounce, emptyState, errorState,
  });
})();
