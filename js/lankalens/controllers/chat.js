/* Chat: conversation list + thread with offers */
(function () {
  const LL = window.LL;
  const { esc, money, timeAgo, emptyState, avatarHtml } = LL;

  LL.controllers = LL.controllers || {};

  LL.controllers.chat = async function (page) {
    const el = page.el;
    const c = el.querySelector('[data-container]');
    await LL.store.ready();
    const router = LL.f7.views.main.router;
    const me = LL.store.me;
    if (!me) { LL.store.requireLogin('/chat'); c.innerHTML = ''; return; }
    const openId = page.route.query?.c ? Number(page.route.query.c) : null;
    if (openId) return thread(page, openId);

    c.innerHTML = `<div class="ll-wrap" style="padding:12px 0 40px">
      <h1 class="page-title">Messages</h1>
      <div id="chat-list">${LL.skeletonRows(4)}</div></div>`;
    LL.setNavTitle('Messages');

    async function loadList() {
      try {
        const { conversations } = await LL.api.get('/chat/conversations');
        const wrap = c.querySelector('#chat-list');
        if (!conversations.length) {
          wrap.innerHTML = emptyState({ icon: 'chatbubble-ellipses-outline', title: 'No messages yet', text: 'Start a chat from any listing by tapping Chat.' });
          return;
        }
        wrap.innerHTML = `<div class="chat-list ll-card" style="padding:0">${conversations.map((conv) => `
          <a class="chat-list-item ll-listing-link" href="/chat?c=${conv.id}" data-role="link">
            ${avatarHtml(conv.other, 'cl-avatar')}
            <div class="cl-main">
              <div class="cl-row"><span class="cl-name">${esc(conv.other?.name || 'User')}</span><span class="cl-time">${timeAgo(conv.updated_at)}</span></div>
              <div class="cl-row"><span class="cl-msg ${conv.unread ? 'unread' : ''}">${conv.unread ? `<b>${conv.unread} new · </b>` : ''}${esc(conv.last_message?.body || (conv.last_message?.image_url ? '📷 Photo' : 'Start the conversation'))}</span>${conv.unread ? '<span class="cl-badge"></span>' : ''}</div>
              <div class="cl-listing"><img src="${esc(conv.listing?.cover || '')}" alt=""><span>${esc(conv.listing?.title || 'Listing')} · ${conv.listing?.price_formatted || ''}</span></div>
            </div>
          </a>`).join('')}</div>`;
      } catch (e) { c.querySelector('#chat-list').innerHTML = LL.errorState(); }
    }
    loadList();
    LL.events.on('me', function h() { if (!LL.store.me) router.navigate('/', { reloadCurrent: true }); LL.events.off?.('me', h); });
  };

  async function thread(page, convId) {
    const el = page.el;
    const c = el.querySelector('[data-container]');
    await LL.store.ready();
    const router = LL.f7.views.main.router;
    let data;
    c.innerHTML = `<div class="chat-thread">
      <div class="chat-listing ll-card" style="border-radius:0">${LL.skeletonRows(1)}</div>
      <div class="chat-messages" style="padding:14px">${LL.skeletonRows(3)}</div>
    </div>`;

    try {
      data = await LL.api.get(`/chat/conversations/${convId}`);
    } catch (e) {
      c.innerHTML = `<div class="ll-wrap" style="padding:30px 0">${emptyState({ icon: 'alert-circle-outline', title: 'Conversation unavailable', text: e.message, actionHtml: '<a class="button" href="/chat" data-role="link">Back to messages</a>' })}</div>`;
      return;
    }
    const conv = data.conversation;
    let pollTimer = null;
    LL.setNavTitle(conv.other?.name || 'Chat');
    const navLeft = document.querySelector('.navbar-current .left') || el.querySelector('.navbar .left');
    if (navLeft) navLeft.innerHTML = '<a class="link back" href="/chat" data-role="link"><ion-icon name="chevron-back"></ion-icon></a>';
    el.dataset.footer = '0';
    el.querySelector('.page-content')?.classList.add('chat-page-content');

    function offerBubble(m) {
      const offer = conv.offers.find((o) => o.id === m.offer_id);
      const status = m.offer_status || offer?.status;
      const counter = m.offer_counter || offer?.counter_amount;
      const statusLabel = { pending: 'Awaiting reply', accepted: 'Accepted', rejected: 'Declined', countered: 'Countered' }[status] || status;
      const canAct = conv.i_am_seller && (status === 'pending' || status === 'countered');
      return `<div class="offer-bubble">
        <div class="ob-label"><ion-icon name="pricetag-outline"></ion-icon> Offer</div>
        <div class="ob-amount">${money(m.offer_amount)}</div>
        ${counter ? `<div class="ll-tiny ll-muted">Counter: ${money(counter)}</div>` : ''}
        <div class="ob-status os-${esc(status)}">${esc(statusLabel)}</div>
        ${canAct ? `<div class="ob-actions">
          <button class="button button-sm" data-offer-act="accept" data-oid="${offer.id}">Accept</button>
          <button class="button button-sm button-outline" data-offer-act="counter" data-oid="${offer.id}">Counter</button>
          <button class="button button-sm button-outline" data-offer-act="reject" data-oid="${offer.id}">Decline</button>
        </div>` : ''}
      </div>`;
    }

    function messagesHtml(messages) {
      return messages.map((m) => {
        const mine = m.sender_id === LL.store.me.id;
        if (m.offer_id) {
          return `<div class="message-row ${mine ? 'me' : 'them'}"><div class="bubble bubble-offer">${offerBubble(m)}</div></div>`;
        }
        const body = m.image_url
          ? `<a href="${m.image_url}" target="_blank"><img src="${m.image_url}" class="chat-image" loading="lazy"></a>${m.body ? `<p>${esc(m.body)}</p>` : ''}`
          : `<p>${esc(m.body || '')}</p><span class="msg-time">${new Date(m.created_at).toLocaleTimeString('en-LK', { hour: '2-digit', minute: '2-digit' })}</span>`;
        return `<div class="message-row ${mine ? 'me' : 'them'}"><div class="bubble">${body}</div></div>`;
      }).join('');
    }

    function render() {
      c.innerHTML = `<div class="chat-thread">
        <a class="chat-listing ll-listing-link ll-card" href="/listing/${conv.listing?.slug}" data-role="link">
          <img src="${esc(conv.listing?.cover || '')}" alt="">
          <div class="cl-info"><b>${esc(conv.listing?.title || 'Listing')}</b><span>${conv.listing?.price_formatted || ''} · ${esc(conv.listing?.status)}</span></div>
          <ion-icon name="chevron-forward"></ion-icon>
        </a>
        <div class="chat-messages" id="msgs">${messagesHtml(data.messages)}</div>
        <div class="chat-composer">
          <label class="cc-attach"><input type="file" id="cc-file" accept="image/*" hidden><ion-icon name="image-outline"></ion-icon></label>
          <textarea id="cc-text" rows="1" placeholder="Message…"></textarea>
          <button id="cc-send"><ion-icon name="send"></ion-icon></button>
        </div>
      </div>`;
      const box = c.querySelector('#msgs');
      box.scrollTop = box.scrollHeight;
      wireComposer();
    }

    async function wireComposer() {
      const text = c.querySelector('#cc-text');
      const send = async () => {
        const body = text.value.trim();
        if (!body) return;
        text.value = '';
        text.style.height = 'auto';
        try {
          await LL.api.post(`/chat/conversations/${convId}/messages`, { body });
          await refresh(false);
        } catch (e) { LL.toastError(e); text.value = body; }
      };
      c.querySelector('#cc-send').addEventListener('click', send);
      text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
      c.querySelector('#cc-file').addEventListener('change', async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        const fd = new FormData();
        fd.append('image', f);
        LL.toast('Sending image…', 'image-outline');
        try { await LL.api.upload(`/chat/conversations/${convId}/messages`, fd); await refresh(false); }
        catch (err) { LL.toastError(err); }
        e.target.value = '';
      });
      wireOfferButtons();
    }

    let refreshing = false, refreshQueued = false;
    async function refresh(refreshPage) {
      if (refreshing) { refreshQueued = true; return; } // trailing refresh so sends are never dropped by an in-flight poll
      refreshing = true;
      try {
        const r = await LL.api.get(`/chat/conversations/${convId}`);
        data = r;
        const prevLen = c.querySelectorAll('.message-row').length;
        const box = c.querySelector('#msgs');
        const atBottom = box && (box.scrollHeight - box.scrollTop - box.clientHeight < 120);
        if (box) {
          box.innerHTML = messagesHtml(data.messages);
          if (atBottom || data.messages.length !== prevLen) box.scrollTop = box.scrollHeight;
          wireOfferButtons();
        }
        LL.paintBadges();
      } finally {
        refreshing = false;
        if (refreshQueued) { refreshQueued = false; refresh(false); }
      }
    }
    function wireOfferButtons() {
      c.querySelectorAll('[data-offer-act]').forEach((b) => b.addEventListener('click', async () => {
        const act = b.dataset.offerAct, oid = b.dataset.oid;
        let amount = null;
        if (act === 'counter') {
          amount = await new Promise((resolve) => LL.f7.dialog.prompt('Your counter amount (Rs.)', 'Counter offer', (v) => resolve(Number(v)), () => resolve(null)));
          if (!amount) return;
        }
        try {
          await LL.api.post(`/chat/offers/${oid}/respond`, act === 'counter' ? { action: 'counter', amount } : { action: act });
          LL.toast('Reply sent');
          refresh(true);
        } catch (e) { LL.toastError(e); }
      }));
    }

    render();
    pollTimer = setInterval(() => { if (document.visibilityState === 'visible') refresh(false); }, 4000);
    page.el.addEventListener('pageBeforeOut', () => clearInterval(pollTimer), { once: true });
  }
})();
