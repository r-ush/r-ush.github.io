(() => {
  'use strict';
  const bundle = JSON.parse(document.getElementById('deck-data').textContent);
  let language='ko';
  try {if(localStorage.getItem('portfolio-language')==='en'&&bundle.translations?.en)language='en';} catch {}
  let data=language==='en'?bundle.translations.en:bundle;
  let {pages,width,height}=data;
  window.PortfolioLanguage=language;
  const t=(ko,en)=>language==='en'?en:ko;
  const core = window.DeckCore, byId = id => document.getElementById(id);
  const stage = byId('page-stage'), frame = byId('page-frame');
  const mediaPlayer=window.PortfolioMedia;
  const dialogs = [...document.querySelectorAll('dialog')];
  const siteURL = document.querySelector('link[rel="canonical"]').href;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let current = -1, autoplay = !reducedMotion.matches, zoom = 1;
  const slides = [], videoGroups = [], scriptPaused = new WeakSet(), manuallyPaused = new WeakSet();
  let galleryVideo = null;
  const anyDialog = () => dialogs.some(d => d.open);
  const allVideos = () => videoGroups.flat().concat(galleryVideo ? [galleryVideo] : []);
  const position = rect => `left:${rect[0]/width*100}%;top:${rect[1]/height*100}%;width:${rect[2]/width*100}%;height:${rect[3]/height*100}%`;
  const pageImage=page=>core.localPath(page.svg)+'?v='+data.pdf_sha256.slice(0,10);
  const evidence=window.PortfolioEvidence({data,byId,localPath:path=>core.localPath(path,data.asset_prefix||''),onResize:fit});
  function stop(video) {
    if (!video.paused) {scriptPaused.add(video);video.pause();}
  }
  function play(video) {
    if (!video || !video.paused || manuallyPaused.has(video)) return;
    mediaPlayer.prepare(video).then(()=>{
      if(document.hidden||!autoplay||manuallyPaused.has(video)||!video.paused)return;
      const eligible=byId('videos-dialog').open?video===galleryVideo:!anyDialog()&&(videoGroups[current]||[]).includes(video);
      if(eligible){video.muted=true;video.play().catch(()=>{});}
    });
  }
  function syncMedia() {
    let active = [];
    if (!document.hidden && autoplay) {
      if (byId('videos-dialog').open && galleryVideo) active = [galleryVideo];
      else if (!anyDialog()) active = videoGroups[current] || [];
    }
    allVideos().forEach(v => {if (!active.includes(v)) stop(v);});
    active.forEach(play);
  }
  function makeVideo(media) {
    const video = document.createElement('video');
    video.controls = true; video.muted = true; video.defaultMuted = true;
    video.loop = true; video.playsInline = true; video.preload = 'none';
    video.setAttribute('playsinline',''); video.setAttribute('muted','');
    video.dataset.src = core.localPath(media.video,data.asset_prefix||'');
    if(media.poster)video.poster = core.localPath(media.poster,data.asset_prefix||'');
    video.setAttribute('aria-label',media.caption || t('연구 실험 영상','Research experiment video'));
    video.addEventListener('play', () => {
      manuallyPaused.delete(video);
      if (document.hidden || (!byId('videos-dialog').open && !(videoGroups[current] || []).includes(video))) stop(video);
    });
    video.addEventListener('pause', () => {
      if (scriptPaused.has(video)) scriptPaused.delete(video);
      else manuallyPaused.add(video);
    });
    video.addEventListener('error', () => {
      if (!video.parentElement || video.parentElement.querySelector('.media-fallback')) return;
      const message = document.createElement('div');message.className='media-fallback';
      const link = document.createElement('a');link.href=video.dataset.src;link.target='_blank';link.rel='noopener';link.textContent=t('영상 원본 열기','Open original video');
      message.append(link);video.after(message);
    });
    mediaPlayer.attach(video,()=>!document.hidden&&(byId('videos-dialog').open?video===galleryVideo:(videoGroups[current]||[]).includes(video)));
    return video;
  }
  function buildSlides(){
  pages.forEach((page,index) => {
    const slide = document.createElement('section');slide.className='slide';slide.hidden=true;slide.inert=true;
    slide.setAttribute('aria-label',`${t('페이지','Page')} ${page.number} · ${page.title}`);
    const img=document.createElement('img');img.className='page-image';img.src=pageImage(page);img.alt='';img.draggable=false;img.loading=index===0?'eager':'lazy';
    slide.append(img);
    const text=document.createElement('p');text.className='sr-only';text.textContent=page.text;slide.append(text);
    const pageLinks=new Map();
    page.links.forEach((item,linkIndex) => {
      if (page.media.some(m => core.overlaps(m.rect,item.rect))) return;
      const link=document.createElement('a');link.className='page-link';link.style.cssText=position(item.rect);
      const route=core.routeLink(item.href,pages,siteURL);
      link.setAttribute('aria-label',item.label || (route.type==='page'?t('관련 연구 페이지 열기','Open related project'):t('관련 자료 열기','Open related source')));
      if (route.type==='page') {
        link.href=`#page=${route.index+1}`;
        link.addEventListener('click',event => {event.preventDefault();if(route.index===current && page.extras.length) openGallery();else go(route.index);});
      } else {link.href=item.href;link.target='_blank';link.rel='noopener';}
      const proof=(page.evidence||[]).find(e=>e.url===item.href);
      if(proof){link.className+=' evidence-trigger';link.setAttribute('aria-label',proof.label+t(' 미리보기',' preview'));evidence.wire(link,proof.id);}
      slide.append(link);
      pageLinks.set(linkIndex,link);
    });
    (page.evidence_hotspots||[]).forEach(item=>{
      if(page.links.some(l=>core.overlaps(l.rect,item.rect)))return;
      const b=document.createElement('button');b.type='button';b.className='evidence-trigger evidence-hotspot';b.style.cssText=position(item.rect);b.setAttribute('aria-label',item.label+t(' 미리보기',' preview'));evidence.wire(b,item.id);slide.append(b);
    });
    if(page.text_runs?.length)slide.append(window.PortfolioText.create(page,width,height,(element,linkIndex)=>{
      const link=pageLinks.get(linkIndex);if(!link)return;
      const proof=(page.evidence||[]).find(item=>item.url===page.links[linkIndex].href);
      if(proof)evidence.wire(element,proof.id);
      else element.addEventListener('click',event=>{if(!window.PortfolioText.hasSelection()){event.preventDefault();link.click();}});
    }));
    const videos=page.media.map(media => {
      const box=document.createElement('div');box.className='media-slot';box.style.cssText=position(media.rect);
      const video=makeVideo(media);box.append(video.playerElement);slide.append(box);return video;
    });
    videoGroups.push(videos);slides.push(slide);frame.append(slide);
    const item=document.createElement('button');item.type='button';item.className='contents-item';
    const thumb=document.createElement('img');thumb.src=pageImage(page);thumb.alt='';thumb.loading='lazy';
    const label=document.createElement('span');const number=document.createElement('b');number.textContent=String(index+1).padStart(2,'0');
    label.append(number,document.createTextNode(page.title));item.append(thumb,label);
    item.addEventListener('click',()=>{byId('contents-dialog').close();go(index);stage.focus({preventScroll:true});});
    byId('contents-list').append(item);
  });
  }
  function fit() {
    const style=getComputedStyle(stage);
    const availableW=stage.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);
    const availableH=stage.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom);
    const side=evidence?.isOpen()&&availableW>=920;
    const panelWidth=side?Math.min(420,Math.max(290,availableW*.28)):0;
    const gap=side?18:0;
    const scale=Math.max(.1,Math.min((availableW-panelWidth-gap)/width,availableH/height))*zoom;
    frame.style.width=`${width*scale}px`;frame.style.height=`${height*scale}px`;
    frame.style.setProperty('--page-scale',String(scale));
    byId('page-desk').style.width=`${width*scale+panelWidth+gap}px`;
    byId('page-desk').style.height=`${height*scale}px`;
    if(panelWidth)byId('page-desk').style.setProperty('--evidence-width',`${panelWidth}px`);
    if(evidence?.isOpen())byId('evidence-panel').classList.toggle('evidence-overlay',!side);
  }
  function go(index,updateHash=true) {
    const next=core.clamp(index,pages.length);if(next===current)return;
    const old=current;window.PortfolioText?.clear();allVideos().forEach(stop);
    if(old>=0){slides[old].hidden=true;slides[old].inert=true;videoGroups[old].forEach(v=>manuallyPaused.delete(v));}
    current=next;const page=pages[current],slide=slides[current];
    evidence.setPage(page);
    slide.hidden=false;slide.inert=false;
    slide.className=`slide ${current<old?'enter-backward':'enter-forward'}`;
    slide.querySelector('img').loading='eager';
    if(slides[current+1])slides[current+1].querySelector('img').loading='eager';
    byId('previous').disabled=current===0;byId('next').disabled=current===pages.length-1;
    byId('page-count').textContent=`${String(current+1).padStart(2,'0')} / ${pages.length}`;
    byId('page-title').textContent=page.title;
    byId('videos-button').hidden=!page.extras.length;
    byId('videos-button').textContent=t(`영상 ${page.extras.length}개`,`${page.extras.length} videos`);
    byId('announcement').textContent=`${t('페이지','Page')} ${current+1} / ${pages.length}, ${page.title}`;
    document.title=`${page.title} · ${t('엄승환 포트폴리오','Seunghwan Um Portfolio')}${data.variant?t(' · 하드웨어 중심',' · Hardware First'):''}`;
    [...byId('contents-list').children].forEach((el,i)=>{if(i===current)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
    if(updateHash){try{history.replaceState(null,'',`#page=${current+1}`);}catch{location.hash=`page=${current+1}`;}}
    videoGroups[current].forEach(v=>mediaPlayer.prepare(v));
    stage.scrollTop=0;stage.scrollLeft=0;fit();syncMedia();
  }
  function openDialog(dialog) {evidence.close();if(!dialog.open)dialog.showModal();syncMedia();}
  function showNotes() {
    const page=pages[current],project=data.projects[page.id],body=byId('notes-body');body.replaceChildren();
    byId('notes-title').textContent=`${t('페이지','Page')} ${current+1} · ${page.title}`;
    function paragraph(text,tag='p'){const el=document.createElement(tag);el.textContent=text;body.append(el);}
    if(project){
      paragraph(project.summary);paragraph(t('연구 배경','Research context'),'h3');paragraph(project.problem);
      paragraph(t('담당 역할','My contribution'),'h3');paragraph(project.role);
      const list=document.createElement('ul');project.implementation.forEach(t=>{const item=document.createElement('li');item.textContent=t;list.append(item);});body.append(list);
      paragraph(t('주요 성과','Results'),'h3');paragraph(project.result);paragraph(t('실험 범위','Experiment scope'),'h3');paragraph(project.conditions);
      const sources=document.createElement('p');sources.className='source-links';
      const links=[{url:project.source,label:t('관련 연구 자료','Project materials')},...(project.links||[])];
      [...new Map(links.map(l=>[l.url,l])).values()].forEach(l=>{const a=document.createElement('a');a.href=l.url;a.textContent=l.label+' ↗';a.target='_blank';a.rel='noopener';sources.append(a);});body.append(sources);
    }else{const p=document.createElement('p');p.className='transcript';p.textContent=page.text;body.append(p);}
    openDialog(byId('notes-dialog'));
  }
  function selectClip(index) {
    if(galleryVideo)stop(galleryVideo);
    const media=pages[current].extras[index];
    galleryVideo=makeVideo(media);mediaPlayer.prepare(galleryVideo);
    byId('gallery-player').replaceChildren(galleryVideo.playerElement);
    byId('gallery-caption').textContent=media.caption || '';
    [...byId('video-tabs').children].forEach((b,i)=>b.setAttribute('aria-pressed',String(i===index)));
    syncMedia();
  }
  function openGallery() {
    if(!pages[current].extras.length)return;
    byId('videos-title').textContent=pages[current].title+t(' · 영상',' · Videos');
    const tabs=byId('video-tabs');tabs.replaceChildren();
    pages[current].extras.forEach((m,i)=>{const b=document.createElement('button');b.type='button';b.textContent=t(`영상 ${i+1}`,`Video ${i+1}`);b.setAttribute('aria-label',m.caption||b.textContent);b.addEventListener('click',()=>selectClip(i));tabs.append(b);});
    openDialog(byId('videos-dialog'));selectClip(0);
  }
  byId('previous').addEventListener('click',()=>go(current-1));byId('next').addEventListener('click',()=>go(current+1));
  [byId('contents-button'),byId('page-status')].forEach(b=>b.addEventListener('click',()=>openDialog(byId('contents-dialog'))));
  byId('notes-button').addEventListener('click',showNotes);byId('videos-button').addEventListener('click',openGallery);
  dialogs.forEach(dialog=>{
    dialog.querySelector('[data-close]').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
    dialog.addEventListener('close',()=>{if(dialog.id==='videos-dialog' && galleryVideo){stop(galleryVideo);galleryVideo=null;byId('gallery-player').replaceChildren();}syncMedia();});
  });
  function autoplayLabel(){byId('autoplay').textContent=autoplay?t('자동 재생 켜짐','Autoplay on'):t('자동 재생 꺼짐','Autoplay off');byId('autoplay').setAttribute('aria-pressed',String(autoplay));}
  byId('autoplay').addEventListener('click',()=>{autoplay=!autoplay;allVideos().forEach(v=>manuallyPaused.delete(v));autoplayLabel();syncMedia();});
  reducedMotion.addEventListener('change',event=>{if(event.matches){autoplay=false;autoplayLabel();syncMedia();}});
  byId('zoom').addEventListener('change',event=>{zoom=Number(event.target.value);fit();});
  byId('fullscreen').hidden=!document.fullscreenEnabled;
  byId('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{byId('announcement').textContent=t('이 브라우저에서는 전체 화면을 사용할 수 없습니다.','Fullscreen is unavailable in this browser.');}});
  document.addEventListener('fullscreenchange',()=>{byId('fullscreen').textContent=document.fullscreenElement?t('전체 화면 종료','Exit fullscreen'):t('전체 화면','Fullscreen');fit();});
  document.addEventListener('visibilitychange',syncMedia);
  const settings=byId('viewer-settings');
  document.addEventListener('pointerdown',event=>{if(settings?.open&&!event.target.closest('#viewer-settings'))settings.open=false;});
  document.addEventListener('keydown',event=>{
    if(settings?.open){if(event.key==='Escape'){settings.open=false;settings.querySelector('summary').focus();}return;}
    if(anyDialog()||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||event.target.closest('input,textarea,select,video,[contenteditable="true"]'))return;
    if(event.key===' '&&event.target.closest('button,a,summary'))return;
    const next=core.keyDestination(event.key,current,pages.length);
    if(next!==null){event.preventDefault();go(next);}
  });
  let swipe=null;
  stage.addEventListener('pointerdown',event=>{if(event.pointerType==='touch'&&zoom===1&&!event.target.closest('video,button,a,input,.selectable-text'))swipe={x:event.clientX,y:event.clientY};});
  stage.addEventListener('pointerup',event=>{if(!swipe)return;const dx=event.clientX-swipe.x,dy=event.clientY-swipe.y;swipe=null;if(Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)*1.5)go(current+(dx<0?1:-1));});
  stage.addEventListener('pointercancel',()=>{swipe=null;});
  window.addEventListener('hashchange',()=>{dialogs.forEach(d=>{if(d.open)d.close();});go(core.indexFromHash(location.hash,pages),false);});
  if('ResizeObserver' in window)new ResizeObserver(fit).observe(stage);else window.addEventListener('resize',fit);
  function applyLocale(){
    document.documentElement.lang=language;
    document.querySelectorAll('[data-ko][data-en]').forEach(el=>{el.textContent=el.getAttribute('data-'+language);});
    document.querySelectorAll('[data-ko-label][data-en-label]').forEach(el=>el.setAttribute('aria-label',el.getAttribute('data-'+language+'-label')));
    byId('brand-name').textContent=t('엄승환','Seunghwan Um');
    const pdf=byId('pdf-download');pdf.href=data.pdf_file+'?v='+data.pdf_sha256.slice(0,10);pdf.download=data.download_name;
    pdf.setAttribute('aria-label',t('국문 PDF 다운로드','Download English PDF'));
    ['ko','en'].forEach(lang=>byId('language-'+lang).setAttribute('aria-pressed',String(lang===language)));
    autoplayLabel();
    byId('fullscreen').textContent=document.fullscreenElement?t('전체 화면 종료','Exit fullscreen'):t('전체 화면','Fullscreen');
  }
  function setLanguage(next){
    if(next===language||next==='en'&&!bundle.translations?.en)return;
    const pageId=pages[current].id;
    allVideos().forEach(stop);dialogs.forEach(d=>{if(d.open)d.close();});evidence.close(true);
    language=next;window.PortfolioLanguage=language;
    data=language==='en'?bundle.translations.en:bundle;
    ({pages,width,height}=data);
    try{localStorage.setItem('portfolio-language',language);}catch{}
    frame.replaceChildren();byId('contents-list').replaceChildren();slides.length=0;videoGroups.length=0;galleryVideo=null;current=-1;
    applyLocale();buildSlides();go(pages.findIndex(p=>p.id===pageId));
  }
  byId('language-ko').addEventListener('click',()=>setLanguage('ko'));
  byId('language-en').addEventListener('click',()=>setLanguage('en'));
  applyLocale();buildSlides();go(core.indexFromHash(location.hash,pages));
})();
