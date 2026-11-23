/* Small local MP4s are buffered as blobs: the static host ignores HTTP Range.
   A shared cache gives every instance a fully seekable source without refetching. */
(() => {
  'use strict';
  const t=(ko,en)=>window.PortfolioLanguage==='en'?en:ko;
  const sources=new Map();
  function sourceURL(path){
    if(location.protocol==='file:' || /^(https?:|blob:|data:)/.test(path))return Promise.resolve(path);
    if(!sources.has(path))sources.set(path,fetch(path).then(r=>{if(!r.ok)throw Error(r.status);return r.blob();}).then(blob=>URL.createObjectURL(blob)).catch(()=>{sources.delete(path);return path;}));
    return sources.get(path);
  }
  function prepare(video){
    if(!video.sourceReady)video.sourceReady=sourceURL(video.dataset.src).then(src=>{video.preload='metadata';video.src=src;return video;});
    return video.sourceReady;
  }
  function clock(seconds){const s=Math.max(0,Math.floor(Number(seconds)||0));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;}
  function attach(video,canPlay){
    const wrap=document.createElement('div');wrap.className='research-player';
    const controls=document.createElement('div');controls.className='media-controls';
    const toggle=document.createElement('button');toggle.type='button';toggle.className='media-toggle';toggle.textContent=t('재생','Play');toggle.setAttribute('aria-label',t('영상 재생','Play video'));
    const seek=document.createElement('input');seek.type='range';seek.className='media-seek';seek.min='0';seek.max='100';seek.step='.05';seek.value='0';seek.disabled=true;seek.setAttribute('aria-label',t('영상 재생 위치','Video position'));
    const time=document.createElement('output');time.className='media-time';time.textContent='0:00 / 0:00';
    const expand=document.createElement('button');expand.type='button';expand.className='media-expand';expand.textContent=t('확대','Expand');expand.setAttribute('aria-label',t('영상 전체 화면','Fullscreen video'));
    let dragging=false;
    function update(){
      const duration=Number.isFinite(video.duration)?video.duration:0;
      seek.disabled=duration<=0;seek.max=String(duration||100);
      if(!dragging)seek.value=String(video.currentTime||0);
      const position=Number(seek.value)||0;
      time.textContent=`${clock(position)} / ${clock(duration)}`;
      seek.style.setProperty('--progress',`${duration?position/duration*100:0}%`);
      seek.setAttribute('aria-valuetext',`${clock(position)} / ${clock(duration)}`);
      toggle.textContent=video.paused?t('재생','Play'):t('정지','Pause');toggle.setAttribute('aria-label',video.paused?t('영상 재생','Play video'):t('영상 일시 정지','Pause video'));
    }
    toggle.addEventListener('click',()=>{if(!video.paused)video.pause();else prepare(video).then(()=>{if(canPlay())video.play().catch(()=>{});});});
    seek.addEventListener('pointerdown',()=>{dragging=true;});
    function finish(){dragging=false;update();}
    seek.addEventListener('pointerup',finish);seek.addEventListener('pointercancel',finish);seek.addEventListener('change',finish);seek.addEventListener('blur',finish);
    seek.addEventListener('input',()=>{if(Number.isFinite(video.duration)&&video.duration>0){video.currentTime=Math.min(video.duration,Math.max(0,Number(seek.value)));time.textContent=`${clock(video.currentTime)} / ${clock(video.duration)}`;seek.style.setProperty('--progress',`${video.currentTime/video.duration*100}%`);seek.setAttribute('aria-valuetext',time.textContent);}});
    expand.hidden=!document.fullscreenEnabled;
    expand.addEventListener('click',()=>{if(document.fullscreenElement===wrap)document.exitFullscreen();else wrap.requestFullscreen?.();});
    ['loadedmetadata','durationchange','timeupdate','seeked','play','pause','ended'].forEach(name=>video.addEventListener(name,update));
    controls.append(toggle,seek,time,expand);wrap.append(video,controls);video.controls=false;video.playerElement=wrap;
    return wrap;
  }
  window.PortfolioMedia={prepare,attach,clock};
  window.addEventListener('pagehide',event=>{if(event.persisted)return;sources.forEach(p=>p.then(url=>{if(url.startsWith('blob:'))URL.revokeObjectURL(url);}));sources.clear();});
})();
