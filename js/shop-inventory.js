/* Business inventory management for LankaLens shop owners.
   Reuses existing listing statuses and APIs; no schema changes are required. */
(function () {
  'use strict';

  var STATUS = {
    active: { label: 'Available', tone: '#0E7C66', bg: '#E7F6F1' },
    paused: { label: 'Unavailable', tone: '#A15C00', bg: '#FFF4E5' },
    sold: { label: 'Sold', tone: '#3A6FB0', bg: '#EAF1FD' },
    expired: { label: 'Expired', tone: '#B04A3A', bg: '#FDECEC' },
    pending: { label: 'Pending', tone: '#8A6500', bg: '#FFF7D6' },
    draft: { label: 'Draft', tone: '#5F6B66', bg: '#EEF1F0' },
    rejected: { label: 'Rejected', tone: '#B42318', bg: '#FDECEC' }
  };

  var state = { items: [], filter: 'all', query: '', loading: false };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function apiBase() {
    var explicit = window.LL_API_BASE;
    if (!explicit) {
      var meta = document.querySelector('meta[name="ll-api-base"]');
      if (meta) explicit = meta.getAttribute('content');
    }
    if (!explicit) {
      try { explicit = window.sessionStorage.getItem('ll_api_base'); } catch (e) { /* ignore */ }
    }
    return String(explicit || '/api').replace(/\/+$/, '');
  }

  function authToken() {
    try {
      return (window.sessionStorage.getItem('ll_token') || window.localStorage.getItem('ll_token') || '').trim();
    } catch (e) {
      return '';
    }
  }

  function request(path, options) {
    options = options || {};
    var headers = options.headers || {};
    var token = authToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    options.headers = headers;
    return fetch(apiBase() + path, options).then(function (res) {
      return res.text().then(function (text) {
        var body = null;
        try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
        if (!res.ok || !body || body.ok === false) {
          throw new Error((body && (body.error || body.message)) || 'Could not update inventory.');
        }
        return body.data;
      });
    });
  }

  function currentPath() {
    return (window.location.hash || '#/').replace(/^#/, '').split('?')[0] || '/';
  }

  function fmtLkr(value) {
    return 'Rs. ' + Number(value || 0).toLocaleString('en-LK');
  }

  function statusMeta(status) {
    return STATUS[status] || { label: status || 'Unknown', tone: '#5F6B66', bg: '#EEF1F0' };
  }

  function cardHtml() {
    return '<div class="form-card" data-shop-inventory-card style="margin-top:16px">' +
      '<div class="section-head" style="margin-bottom:4px;align-items:center">' +
      '<h2><ion-icon name="cube-outline"></ion-icon>Inventory</h2>' +
      '<button class="btn btn-primary btn-sm" type="button" data-inventory-add style="width:auto"><ion-icon name="add-outline"></ion-icon>Add item</button>' +
      '</div>' +
      '<p class="form-hint" style="margin-bottom:12px">Manage the availability of your shop listings without deleting them.</p>' +
      '<div data-inventory-summary style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:12px"></div>' +
      '<div class="form-group" style="margin-bottom:10px"><input class="input" type="search" data-inventory-search placeholder="Search inventory…" autocomplete="off"></div>' +
      '<div data-inventory-tabs class="chips" style="padding:0;margin-bottom:12px;overflow-x:auto;flex-wrap:nowrap"></div>' +
      '<div data-inventory-status class="form-hint" style="margin-bottom:8px"></div>' +
      '<div data-inventory-list></div>' +
      '</div>';
  }

  function summaryHtml() {
    var counts = { active: 0, paused: 0, sold: 0, expired: 0, pending: 0 };
    state.items.forEach(function (item) {
      if (Object.prototype.hasOwnProperty.call(counts, item.status)) counts[item.status] += 1;
    });
    var boxes = [
      ['active', 'Available'], ['paused', 'Unavailable'], ['sold', 'Sold'],
      ['expired', 'Expired'], ['pending', 'Pending']
    ];
    return boxes.map(function (x) {
      var m = statusMeta(x[0]);
      return '<button type="button" data-inventory-summary-filter="' + x[0] + '" style="border:1px solid #e5e8e7;background:' + m.bg + ';border-radius:14px;padding:10px 12px;text-align:left;color:' + m.tone + '">' +
        '<strong style="display:block;font-size:20px;line-height:1.1">' + counts[x[0]] + '</strong>' +
        '<span style="font-size:12px;font-weight:700">' + x[1] + '</span></button>';
    }).join('');
  }

  function tabsHtml() {
    var tabs = [
      ['all', 'All'], ['active', 'Available'], ['paused', 'Unavailable'], ['sold', 'Sold'],
      ['expired', 'Expired'], ['pending', 'Pending'], ['draft', 'Draft'], ['rejected', 'Rejected']
    ];
    return tabs.map(function (x) {
      return '<button type="button" class="chip' + (state.filter === x[0] ? ' active' : '') + '" data-inventory-filter="' + x[0] + '" style="white-space:nowrap">' + x[1] + '</button>';
    }).join('');
  }

  function visibleItems() {
    var q = state.query.toLowerCase();
    return state.items.filter(function (item) {
      if (state.filter !== 'all' && item.status !== state.filter) return false;
      if (!q) return true;
      return [item.title, item.brand, item.model].some(function (v) {
        return String(v || '').toLowerCase().indexOf(q) !== -1;
      });
    });
  }

  function itemActions(item) {
    var buttons = [];
    buttons.push('<button class="btn btn-outline btn-sm" type="button" data-inventory-action="edit" data-id="' + item.id + '"><ion-icon name="create-outline"></ion-icon>Edit</button>');
    if (item.status === 'active') {
      buttons.push('<button class="btn btn-outline btn-sm" type="button" data-inventory-action="pause" data-id="' + item.id + '"><ion-icon name="pause-outline"></ion-icon>Unavailable</button>');
      buttons.push('<button class="btn btn-outline btn-sm" type="button" data-inventory-action="sold" data-id="' + item.id + '"><ion-icon name="checkmark-circle-outline"></ion-icon>Sold</button>');
    } else if (item.status === 'paused') {
      buttons.push('<button class="btn btn-primary btn-sm" type="button" data-inventory-action="available" data-id="' + item.id + '"><ion-icon name="play-outline"></ion-icon>Make available</button>');
    } else if (item.status === 'sold') {
      buttons.push('<button class="btn btn-primary btn-sm" type="button" data-inventory-action="restock" data-id="' + item.id + '"><ion-icon name="refresh-outline"></ion-icon>Restock</button>');
    } else if (item.status === 'expired') {
      buttons.push('<button class="btn btn-primary btn-sm" type="button" data-inventory-action="renew" data-id="' + item.id + '"><ion-icon name="refresh-outline"></ion-icon>Renew</button>');
    }
    return buttons.join('');
  }

  function itemHtml(item) {
    var m = statusMeta(item.status);
    var img = item.images && item.images.length ? item.images[0] : '';
    return '<div data-inventory-item="' + item.id + '" style="border:1px solid #e5e8e7;border-radius:16px;padding:10px;margin-bottom:10px;background:#fff">' +
      '<div style="display:flex;gap:10px;align-items:center">' +
      '<div style="width:68px;height:68px;border-radius:12px;overflow:hidden;background:#f1f3f2;flex:0 0 68px;display:flex;align-items:center;justify-content:center">' +
      (img ? '<img src="' + esc(img) + '" alt="" style="width:100%;height:100%;object-fit:cover">' : '<ion-icon name="camera-outline" style="font-size:28px;color:#7b8782"></ion-icon>') + '</div>' +
      '<div style="min-width:0;flex:1"><div style="font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(item.title) + '</div>' +
      '<div style="font-weight:800;color:var(--brand);margin-top:2px">' + fmtLkr(item.price) + '</div>' +
      '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:5px">' +
      '<span style="font-size:11px;font-weight:800;padding:4px 8px;border-radius:999px;background:' + m.bg + ';color:' + m.tone + '">' + esc(m.label) + '</span>' +
      '<span class="muted fs12"><ion-icon name="eye-outline"></ion-icon> ' + Number(item.views || 0).toLocaleString('en-LK') + ' views</span></div></div></div>' +
      '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:10px">' + itemActions(item) + '</div></div>';
  }

  function render() {
    var card = document.querySelector('[data-shop-inventory-card]');
    if (!card) return;
    var summary = card.querySelector('[data-inventory-summary]');
    var tabs = card.querySelector('[data-inventory-tabs]');
    var list = card.querySelector('[data-inventory-list]');
    var status = card.querySelector('[data-inventory-status]');
    if (summary) summary.innerHTML = summaryHtml();
    if (tabs) tabs.innerHTML = tabsHtml();
    if (!list) return;
    var items = visibleItems();
    if (!items.length) {
      list.innerHTML = '<div style="padding:18px 8px;text-align:center;color:#74817C"><ion-icon name="cube-outline" style="font-size:30px"></ion-icon><p style="margin:6px 0 0">No inventory items found.</p></div>';
    } else {
      list.innerHTML = items.map(itemHtml).join('');
    }
    if (status && !state.loading) status.textContent = state.items.length + ' total listing' + (state.items.length === 1 ? '' : 's');
  }

  function loadInventory() {
    var status = document.querySelector('[data-inventory-status]');
    state.loading = true;
    if (status) status.textContent = 'Loading inventory…';
    return request('/me/listings').then(function (items) {
      state.items = Array.isArray(items) ? items : [];
      state.loading = false;
      render();
    }).catch(function (err) {
      state.loading = false;
      if (status) {
        status.textContent = err.message;
        status.style.color = '#B42318';
      }
    });
  }

  function setBusy(button, busy) {
    if (!button) return;
    if (busy) {
      button.dataset.oldHtml = button.innerHTML;
      button.disabled = true;
      button.textContent = 'Updating…';
    } else {
      button.disabled = false;
      if (button.dataset.oldHtml) button.innerHTML = button.dataset.oldHtml;
    }
  }

  function patchStatus(id, status, button) {
    setBusy(button, true);
    return request('/listings/' + id, { method: 'PATCH', body: JSON.stringify({ status: status }) }).then(function () {
      setBusy(button, false);
      return loadInventory();
    }).catch(function (err) {
      setBusy(button, false);
      window.alert(err.message);
    });
  }

  function renew(id, button) {
    setBusy(button, true);
    return request('/listings/' + id + '/renew', { method: 'POST' }).then(function () {
      setBusy(button, false);
      return loadInventory();
    }).catch(function (err) {
      setBusy(button, false);
      window.alert(err.message);
    });
  }

  function handleAction(button) {
    var action = button.getAttribute('data-inventory-action');
    var id = button.getAttribute('data-id');
    var item = state.items.find(function (x) { return String(x.id) === String(id); });
    if (!item) return;
    if (action === 'edit') {
      window.location.hash = '#/edit-ad/' + id;
      return;
    }
    if (action === 'pause') { patchStatus(id, 'paused', button); return; }
    if (action === 'sold') { patchStatus(id, 'sold', button); return; }
    if (action === 'renew' || action === 'restock') { renew(id, button); return; }
    if (action === 'available') {
      var expiry = Number(item.expiry_at || 0);
      var now = Math.floor(Date.now() / 1000);
      if (expiry && expiry <= now) renew(id, button);
      else patchStatus(id, 'active', button);
    }
  }

  function bindCard(card) {
    card.addEventListener('click', function (event) {
      var add = event.target.closest && event.target.closest('[data-inventory-add]');
      if (add) { window.location.hash = '#/sell'; return; }
      var summary = event.target.closest && event.target.closest('[data-inventory-summary-filter]');
      if (summary) {
        state.filter = summary.getAttribute('data-inventory-summary-filter');
        render();
        return;
      }
      var tab = event.target.closest && event.target.closest('[data-inventory-filter]');
      if (tab) {
        state.filter = tab.getAttribute('data-inventory-filter');
        render();
        return;
      }
      var action = event.target.closest && event.target.closest('[data-inventory-action]');
      if (action) handleAction(action);
    });
    var search = card.querySelector('[data-inventory-search]');
    if (search) search.addEventListener('input', function () {
      state.query = search.value.trim();
      render();
    });
  }

  function enhanceMyShop() {
    if (currentPath() !== '/my-shop') return;
    var form = document.querySelector('#shop-form');
    if (!form || form.getAttribute('data-inventory-enhanced') === '1') return;
    form.setAttribute('data-inventory-enhanced', '1');
    var anchor = form.querySelector('[data-business-social-card]') || form.querySelector('.form-card');
    if (!anchor) return;
    anchor.insertAdjacentHTML('afterend', cardHtml());
    var card = form.querySelector('[data-shop-inventory-card]');
    if (!card) return;
    bindCard(card);
    loadInventory();
  }

  var scheduled = false;
  function scheduleEnhance() {
    if (scheduled) return;
    scheduled = true;
    window.setTimeout(function () {
      scheduled = false;
      enhanceMyShop();
    }, 0);
  }

  document.addEventListener('DOMContentLoaded', scheduleEnhance);
  window.addEventListener('hashchange', scheduleEnhance);
  new MutationObserver(scheduleEnhance).observe(document.documentElement, { childList: true, subtree: true });
  scheduleEnhance();
}());
