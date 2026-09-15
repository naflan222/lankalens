(function () {
  'use strict';

  // app.js renders sheets as a mask containing the sheet panel. Its delegated
  // click handler currently uses closest('[data-close-sheet]'), so a click on
  // any control inside the panel also matches the parent mask and closes before
  // sort/filter actions can run. Keep the close marker off the parent mask and
  // close only when the backdrop itself is tapped.
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
