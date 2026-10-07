(function () {
  'use strict';

  // One MapMyVisitors site ID for the homepage and all project pages.
  // Statistics: https://mapmyvisitors.com/web/1c8q7
  var siteId = 'fGQkHeJjD2q20QiECdFcDFPfH3JNP_cewlyjRrwjAf4';

  // Local previews must not add visits to the public counter.
  if (!siteId || window.location.hostname !== 'r-ush.github.io' || window.rushVisitorMapLoaded) {
    return;
  }
  window.rushVisitorMapLoaded = true;

  var isHomepage = window.location.pathname === '/' || window.location.pathname === '/index.html';
  var section = document.getElementById('visitor-map');
  var mount = document.getElementById('visitor-map-widget');

  if (isHomepage && section && mount) {
    // The visible widget records the homepage visit; do not also send a pixel.
    var widget = document.createElement('script');
    widget.id = 'mapmyvisitors';
    widget.async = true;
    widget.src = 'https://mapmyvisitors.com/map.js?' + new URLSearchParams({
      d: siteId,
      cl: 'ffffff',
      w: 'a'
    });
    widget.onerror = function () {
      // Keep the historical Search Console view available if the provider fails.
      mount.hidden = true;
      var status = document.getElementById('visitor-map-status');
      if (status) status.hidden = false;
    };
    section.hidden = false;
    mount.appendChild(widget);
    return;
  }

  // The homepage currently shows only the historical map, so it uses the same
  // image counter as the project pages. Keep this outside the collapsed toggle:
  // visits must be recorded immediately, whether or not the map is opened.
  var pixel = document.createElement('img');
  pixel.width = 1;
  pixel.height = 1;
  pixel.alt = '';
  pixel.setAttribute('aria-hidden', 'true');
  pixel.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;';
  pixel.src = 'https://mapmyvisitors.com/map.png?' + new URLSearchParams({
    d: siteId,
    cl: 'ffffff'
  });
  document.body.appendChild(pixel);
}());
