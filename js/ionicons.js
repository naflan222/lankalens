/* Lanka Lens — local ionicons loader.
 * Fetches icons/icons.svg (an SVG sprite) and upgrades every <ion-icon name="x">
 * into an inline <svg><use href="#x"/></svg> so icons work without a CDN and
 * inherit the surrounding text colour. Handles dynamically added icons too.
 */
(function () {
  'use strict';

  var SPRITE_URL = 'icons/icons.svg';
  var ready = false;
  var waiters = [];

  function buildSvg(name, className) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ionicon' + (className ? ' ' + className : ''));
    svg.setAttribute('viewBox', '0 0 512 512');
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#' + name);
    svg.appendChild(use);
    return svg;
  }

  function replaceIcon(el) {
    if (!el || el.__upgraded) return;
    el.__upgraded = true;
    var name = el.getAttribute('name') || el.getAttribute('icon') || '';
    if (!name) return;
    var svg = buildSvg(name, el.getAttribute('class'));
    if (el.parentNode) el.parentNode.replaceChild(svg, el);
  }

  function upgrade(root) {
    if (!ready || !root) return;
    if (root.tagName === 'ION-ICON') { replaceIcon(root); return; }
    var icons = root.querySelectorAll ? root.querySelectorAll('ion-icon') : [];
    for (var i = 0; i < icons.length; i++) replaceIcon(icons[i]);
  }

  function onReady(fn) {
    if (ready) { fn(); return; }
    waiters.push(fn);
  }

  fetch(SPRITE_URL)
    .then(function (r) { if (!r.ok) throw new Error('sprite'); return r.text(); })
    .then(function (text) {
      var wrap = document.createElement('div');
      wrap.style.display = 'none';
      wrap.innerHTML = text;
      document.body.appendChild(wrap);
      ready = true;
      upgrade(document.body);
      var obs = new MutationObserver(function (muts) {
        muts.forEach(function (m) {
          if (m.addedNodes && m.addedNodes.length) {
            for (var i = 0; i < m.addedNodes.length; i++) {
              var n = m.addedNodes[i];
              if (n.nodeType !== 1) continue;
              if (n.tagName === 'ION-ICON') replaceIcon(n);
              else upgrade(n);
            }
          }
        });
      });
      obs.observe(document.body, { childList: true, subtree: true });
      waiters.forEach(function (fn) { fn(); });
      waiters = [];
    })
    .catch(function () {
      /* icons unavailable — leave <ion-icon> elements as-is */
      ready = true;
      waiters.forEach(function (fn) { fn(); });
      waiters = [];
    });

  window.iconsReady = onReady;
})();
