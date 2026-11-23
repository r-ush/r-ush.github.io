(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DeckCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clamp = (n, total) => Math.max(0, Math.min(total - 1, Number.isFinite(n) ? Math.trunc(n) : 0));
  function indexFromHash(hash, pages) {
    const match = /^#page[=-](\d+)$/.exec(hash);
    if (match) return clamp(Number(match[1]) - 1, pages.length);
    const aliases = {work:'overview',grasping:'sim-to-real',grippers:'rec-gripper',interaction:'human-corrections',results:'results',experience:'experience',hardware:'rec-gripper',control:'teleoperation-control',imitation:'scooping-imitation',reinforcement:'sim-to-real'};
    const id = hash.replace(/^#/, '');
    const index = pages.findIndex(p => p.id === (aliases[id] || id));
    return index < 0 ? 0 : index;
  }
  function keyDestination(key, index, total) {
    if (['ArrowRight','PageDown',' '].includes(key)) return clamp(index + 1, total);
    if (['ArrowLeft','PageUp'].includes(key)) return clamp(index - 1, total);
    if (key === 'Home') return 0;
    if (key === 'End') return total - 1;
    return null;
  }
  function localPath(url,prefix='') { return url.startsWith('/') && !url.startsWith('//') ? prefix+url.slice(1) : url; }
  function routeLink(href, pages, siteURL) {
    let u;
    try { u = new URL(href, siteURL); } catch { return {type:'external',href}; }
    const base=new URL(siteURL);
    if (u.origin !== base.origin) return {type:'external',href};
    const basePath=base.pathname.replace(/\/$/,'');
    const path=basePath && u.pathname.startsWith(basePath+'/') ? u.pathname.slice(basePath.length) : u.pathname;
    const match = /^\/projects\/([^/]+)\/?$/.exec(path);
    if (match) {
      const slug = match[1] === 'gripper-design' ? 'rec-gripper' : match[1];
      const index = pages.findIndex(p => p.id === slug);
      if (index >= 0) return {type:'page',index};
    }
    if(path==='/'||path==='')return {type:'page',index:1};
    return {type:'external',href};
  }
  function overlaps(a,b) {return a[0]<b[0]+b[2] && a[0]+a[2]>b[0] && a[1]<b[1]+b[3] && a[1]+a[3]>b[1];}
  return {clamp,indexFromHash,keyDestination,localPath,routeLink,overlaps};
});
