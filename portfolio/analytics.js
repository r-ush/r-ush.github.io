/* Portfolio-only measurement. No cookies, persistent IDs, public counters or fingerprinting. */
(() => {
  'use strict';
  if (window.top !== window.self || location.hostname !== 'r-ush.github.io') return;
  const root = new URL('./', document.currentScript.src);
  const preference = 'rush-analytics-disabled';
  const path = location.pathname.replace(/index\.html$/, '').replace(/\/?$/, '/');
  const bundle = JSON.parse(document.getElementById('deck-data').textContent);
  let config, visit, current = '', language = '', stopped = false, queue = [];
  let activeAt = performance.now(), lastInput = performance.now(), pendingSeconds = 0;
  const sourceSeen = new Set(), videos = new WeakMap();
  const visible = () => document.visibilityState === 'visible' && document.hasFocus();
  const excluded = () => {
    if (stopped || navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || window.doNotTrack === '1') return true;
    try { return localStorage.getItem(preference) === '1'; } catch { return false; }
  };
  const en = () => window.PortfolioLanguage === 'en';
  const notice = document.createElement('div'); notice.className = 'portfolio-privacy';
  const policy = document.createElement('a'); policy.href = new URL('privacy.html', root).href; policy.target = '_blank'; policy.rel = 'noopener';
  const optout = document.createElement('button'); optout.type = 'button';
  notice.append(policy, optout); document.querySelector('.toolbar').append(notice);
  function noticeText() {
    policy.textContent = en() ? 'IP & usage · 30 days' : 'IP·이용기록 · 30일';
    optout.textContent = excluded() ? (en() ? 'Excluded' : '수집 제외됨') : (en() ? 'Exclude me' : '수집 제외');
    optout.disabled = excluded();
  }
  function stop() { stopped = true; queue = []; pendingSeconds = 0; noticeText(); }
  optout.addEventListener('click', () => {
    try { localStorage.setItem(preference, '1'); } catch {}
    stop(); window.dispatchEvent(new Event('rush-analytics-preference'));
  });
  window.addEventListener('storage', event => { if (event.key === preference && event.newValue === '1') stop(); });
  window.addEventListener('rush-analytics-preference', () => { if (excluded()) stop(); });
  noticeText();
  if (excluded() || navigator.webdriver || /bot|crawler|spider|headless|lighthouse|preview/i.test(navigator.userAgent)) return;
  function flush() {
    if (excluded() || !config || !visit || !queue.length) { if (excluded()) queue = []; return; }
    const events = queue.splice(0, 20);
    fetch(config.endpoint, { method: 'POST', credentials: 'omit', mode: 'cors', keepalive: true,
      referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ v: 1, visit, path, events }) }).catch(() => {});
  }
  function emit(type, target, seconds) {
    if (!config || excluded() || !visit) return;
    queue.push(seconds === undefined ? { type, target } : { type, target, seconds });
    if (queue.length >= 20) flush();
  }
  function account() {
    const now = performance.now(), elapsed = Math.min(5, Math.max(0, (now - activeAt) / 1000));
    if (current && visible() && now - lastInput < 60000 && !excluded()) pendingSeconds += elapsed;
    activeAt = now;
  }
  function saveReading() {
    const seconds = Math.min(60, Math.floor(pendingSeconds));
    if (seconds && current) { emit('read', current, seconds); pendingSeconds -= seconds; }
  }
  function syncPage() {
    if (!config) return;
    account();
    const number = parseInt(document.getElementById('page-count').textContent, 10);
    const next = bundle.pages[number - 1]?.id;
    if (next && next !== current && visible()) {
      saveReading(); pendingSeconds = 0; current = next;
      emit('view', current); flush();
    }
    const nextLanguage = en() ? 'en' : 'ko';
    if (language !== nextLanguage && visible()) { language = nextLanguage; emit('language', language); noticeText(); }
  }
  const videoId = video => {
    const url = new URL(video.dataset.src, location.href).href;
    return Object.keys(config.videos).find(key => new URL(config.videos[key].replace(/^\//, ''), root).href === url);
  };
  function attachVideos() {
    document.querySelectorAll('video').forEach(video => {
      if (videos.has(video)) return;
      const state = { manual: false, watched: 0, time: 0, complete: false }; videos.set(video, state);
      video.addEventListener('timeupdate', () => {
        const delta = video.currentTime - state.time; state.time = video.currentTime;
        if (state.manual && !video.paused && visible() && !video.seeking && delta > 0 && delta < 1.5) state.watched += delta;
        if (state.manual && !state.complete && Number.isFinite(video.duration) && video.duration > 0 && state.watched >= video.duration * .9) {
          const id = videoId(video); if (id) emit('video-complete', id); state.complete = true;
        }
      });
      video.addEventListener('seeking', () => { state.time = video.currentTime; });
    });
  }
  let sourceTimer;
  function sourcePreview() {
    clearTimeout(sourceTimer);
    const title = document.getElementById('evidence-title')?.textContent;
    const evidence = [...bundle.pages.flatMap(p => p.evidence), ...bundle.translations.en.pages.flatMap(p => p.evidence)];
    const source = evidence.find(item => item.title === title);
    if (!source) return;
    sourceTimer = setTimeout(() => {
      if (visible() && !document.getElementById('evidence-panel').hidden && !sourceSeen.has(source.id)) {
        sourceSeen.add(source.id); emit('source', source.id);
      }
    }, 2000);
  }
  document.addEventListener('click', event => {
    if (!config || excluded()) return;
    const target = event.target.closest('a,button'); if (!target) return;
    const downloads = { 'cv-download-ko': 'cv-ko', 'cv-download-en': 'cv-en', 'pdf-download': en() ? 'portfolio-en' : 'portfolio-ko' };
    if (downloads[target.id]) { emit('download', downloads[target.id]); flush(); }
    if (target.matches('.media-toggle,.media-expand')) {
      const video = target.closest('.research-player')?.querySelector('video'), state = video && videos.get(video);
      const openingFullscreen = target.matches('.media-expand') && document.fullscreenElement !== video?.closest('.research-player');
      if (state && (target.matches('.media-toggle') && video.paused || openingFullscreen)) {
        const id = videoId(video); state.manual = true; if (id) emit('video-play', id);
      }
    }
    if (target.tagName === 'A' && !downloads[target.id]) {
      const href = target.getAttribute('href') || '';
      if (target.matches('.evidence-source')) emit('outbound', 'paper');
      else if (href.startsWith('mailto:')) emit('outbound', 'email');
      else if (/^https?:/.test(href) && !href.startsWith(root.href)) emit('outbound', href === 'https://r-ush.github.io/' ? 'research-homepage' : 'external');
      flush();
    }
  }, true);
  document.addEventListener('change', event => {
    if (!config || !event.target.matches('.media-seek')) return;
    const video = event.target.closest('.research-player')?.querySelector('video');
    if (video) { const id = videoId(video); if (id) emit('video-seek', id); }
  }, true);
  ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel'].forEach(type =>
    document.addEventListener(type, () => { lastInput = performance.now(); }, { passive: true }));
  window.addEventListener('blur', () => { account(); saveReading(); flush(); });
  window.addEventListener('focus', () => { activeAt = lastInput = performance.now(); syncPage(); });
  document.addEventListener('visibilitychange', () => { account(); saveReading(); flush(); activeAt = performance.now(); syncPage(); });
  window.addEventListener('pagehide', () => { account(); saveReading(); flush(); });
  fetch(new URL('analytics-config.json', root), { credentials: 'omit', referrerPolicy: 'no-referrer' })
    .then(response => { if (!response.ok) throw Error(); return response.json(); })
    .then(value => {
      if (!value.paths.includes(path) || excluded()) return;
      config = value;
      visit = Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
      // An in-memory key for this document load; a reload starts a separate record.
      syncPage(); attachVideos();
      new MutationObserver(() => { syncPage(); attachVideos(); }).observe(document.getElementById('page-frame'), { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
      new MutationObserver(syncPage).observe(document.getElementById('page-title'), { childList: true });
      new MutationObserver(sourcePreview).observe(document.getElementById('evidence-body'), { childList: true });
      setInterval(account, 1000);
      setInterval(() => { account(); saveReading(); flush(); }, 10000);
    }).catch(() => {});
})();
