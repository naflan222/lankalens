/* Client state: session, catalog/location caches, badges. */
(function () {
  const LL = window.LL;
  const store = {
    me: null,
    settings: null,
    _categories: null,
    _locations: null,
    _brands: null,

    async loadMe() {
      try { this.me = (await LL.api.get('/auth/me')).user; } catch { this.me = null; }
      this._ready = Promise.resolve(this.me);
      LL.events && LL.events.emit('me', this.me);
      return this.me;
    },
    bootReady() { this._ready = this.loadMe(); return this._ready; },
    ready() { return this._ready || this.loadMe(); },
    async getSettings() {
      if (!this.settings) this.settings = (await LL.api.get('/settings')).settings;
      return this.settings;
    },
    async getCategories() {
      if (!this._categories) this._categories = (await LL.api.get('/categories')).categories;
      return this._categories;
    },
    async getCategory(slug) {
      const cats = await this.getCategories();
      for (const top of cats) {
        if (top.slug === slug) return top;
        const sub = top.children.find((c) => c.slug === slug);
        if (sub) return { ...sub, top };
      }
      return null;
    },
    async getLocations() {
      if (!this._locations) this._locations = (await LL.api.get('/locations')).locations;
      return this._locations;
    },
    async getBrands() {
      if (!this._brands) this._brands = (await LL.api.get('/brands')).brands;
      return this._brands;
    },
    resetCache() { this._categories = null; this._locations = null; this._brands = null; },

    requireLogin(redirect) {
      if (this.me) return true;
      LL.toast('Please sign in first', 'person-outline');
      LL.f7.views.main.router.navigate('/sign-in/' + (redirect ? `?next=${encodeURIComponent(redirect)}` : ''));
      return false;
    },

    async badges() {
      try {
        const b = await LL.api.get('/notifications/badge');
        LL.events.emit('badges', b);
        return b;
      } catch { return { notifications: 0, messages: 0, pending: 0 }; }
    },
  };

  // tiny event emitter
  const listeners = {};
  LL.events = {
    on(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    emit(name, data) { (listeners[name] || []).forEach((fn) => fn(data)); },
  };

  LL.store = store;
})();
