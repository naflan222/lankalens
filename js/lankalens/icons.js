/* Ionicons SVG sprite shim: keeps the template's <ion-icon name="..."> syntax
   while serving icons locally (no CDN). The sprite is inlined once and icons
   reference same-document symbols, which works in every browser. */
(function () {
  class LLIcon extends HTMLElement {
    static get observedAttributes() { return ['name']; }
    render() {
      const name = this.getAttribute('name');
      if (!name) return;
      this.innerHTML = `<svg viewBox="0 0 512 512" aria-hidden="true"><use href="#${name}"></use></svg>`;
    }
    connectedCallback() { this.render(); }
    attributeChangedCallback() { this.render(); }
  }
  if (!customElements.get('ion-icon')) customElements.define('ion-icon', LLIcon);

  function refreshAll() {
    document.querySelectorAll('ion-icon').forEach((el) => {
      const cls = LLIcon.prototype;
      cls.render.call(el);
    });
  }

  fetch('/images/sprite.svg').then((r) => r.text()).then((svg) => {
    const holder = document.createElement('div');
    holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    holder.setAttribute('aria-hidden', 'true');
    holder.innerHTML = svg;
    document.body.appendChild(holder);
    refreshAll();
    document.dispatchEvent(new CustomEvent('ll:icons-ready'));
  }).catch(() => {});
})();
