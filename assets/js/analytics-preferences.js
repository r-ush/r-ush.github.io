(function () {
  'use strict';
  var key = 'rush-analytics-disabled';
  var status = document.getElementById('analytics-preference-status');
  var toggle = document.getElementById('analytics-preference-toggle');
  var disabled = false;
  var signal = navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || window.doNotTrack === '1';
  try { disabled = localStorage.getItem(key) === '1'; } catch (_) {}
  function render() {
    status.textContent = signal ? '브라우저의 추적 거부 신호에 따라 통계 수집에서 제외됩니다. Your browser privacy signal is respected.' : disabled ? '이 브라우저는 통계 수집에서 제외됩니다. Analytics are disabled for this browser.' : '통계 수집이 활성화된 경우 이 브라우저의 이용도 합계에 포함됩니다. You can exclude this browser below.';
    toggle.textContent = disabled ? '통계 수집 제외 해제 / Enable analytics' : '이 브라우저 수집 제외 / Disable analytics';
    toggle.disabled = signal;
  }
  toggle.addEventListener('click', function () {
    try {
      if (disabled) localStorage.removeItem(key); else localStorage.setItem(key, '1');
      disabled = !disabled;
      window.dispatchEvent(new Event('rush-analytics-preference'));
      render();
    } catch (_) { status.textContent = '설정을 저장할 수 없습니다. 브라우저의 Do Not Track 또는 Global Privacy Control 설정을 사용할 수 있습니다.'; }
  });
  render();
}());
