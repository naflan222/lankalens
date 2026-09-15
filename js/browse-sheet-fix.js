(function () {
  'use strict';

  // app.js renders a sheet panel inside a backdrop carrying data-close-sheet.
  // Its delegated click handler uses closest('[data-close-sheet]'), which means
  // every click inside the panel is mistaken for a backdrop click. Remove that
  // marker from the parent mask so sort/filter controls can receive their click,
  // then close only when the user taps the backdrop itself.
  function repairSheetMask(mask) {
    if (!mask || mask.dataset.browseSheetFixed === '1') return;
    if (!mask.matches('.sheet-mask[data-close-sheet]')) return;

    mask.removeAttribute('data-close-sheet');
    mask.dataset.browseSheetFixed = '1';

    mask.addEventListener('click', function (event) {
      if (event.target !== mask) return;
      var host = document.getElementById('sheet-host');
      var panel = mask.querySelector('.sheet');
      mask.classList.remove('open');
      if (panel) panel.classList.remove('open');
      window.setTimeout(function () {
        if (host && host.contains(mask)) host.innerHTML = '';
      }, 240);
    });
  }

  function repairCurrentSheet() {
    var host = document.getElementById('sheet-host');
    if (!host) return;
    repairSheetMask(host.querySelector('.sheet-mask[data-close-sheet]'));
  }

  var host = document.getElementById('sheet-host');
  if (!host) return;

  repairCurrentSheet();
  new MutationObserver(repairCurrentSheet).observe(host, { childList: true, subtree: true });
}());
