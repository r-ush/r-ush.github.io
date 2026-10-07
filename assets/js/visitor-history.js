(function () {
  'use strict';

  var section = document.getElementById('visitor-map');
  if (!section) return;

  var isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  var previewHistory = isLocal && new URLSearchParams(window.location.search).get('visitors') === 'history';
  if (!previewHistory) return;

  // Jump to the footer in the local preview without opening the default-closed map.
  var popup = document.getElementById('cv-popup-overlay');
  if (popup) popup.classList.add('cv-popup-hidden');
  section.scrollIntoView({ block: 'start' });
}());
