/* A slower version of the homepage's scale/fade, with stable evidence tabs. */
(() => {
  'use strict';
  const t=(ko,en)=>window.PortfolioLanguage==='en'?en:ko;
  window.PortfolioEvidence=function({data,byId,localPath,onResize}){
    const desk=byId('page-desk'),panel=byId('evidence-panel'),tabs=byId('evidence-tabs');
    const body=byId('evidence-body'),button=byId('evidence-button');
    let page=null,active=null,opened=false,pinned=false,timer=null,closeTimer=null,hoverTimer=null;
    const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
    const entries=()=>page?.evidence||[];
    function cancel(){if(timer){clearTimeout(timer);timer=null;}clearTimeout(hoverTimer);hoverTimer=null;}
    function buttonState(){
      button.setAttribute('aria-expanded',String(opened));
      byId('evidence-button-label').textContent=opened?t('자료 닫기','Close'):t('자료 보기','Sources');
      byId('evidence-count').textContent=String(entries().length);
      button.setAttribute('aria-label',t(`${page?.title||'현재 페이지'} 관련 자료 ${entries().length}개 ${opened?'닫기':'보기'}`,`${opened?'Close':'View'} ${entries().length} sources for ${page?.title||'this page'}`));
      button.setAttribute('title',entries().map(e=>e.label).join(' · '));
    }
    function close(immediate=false){
      cancel();clearTimeout(closeTimer);const wasOpen=opened;
      opened=false;pinned=false;active=null;panel.inert=true;panel.setAttribute('aria-hidden','true');
      panel.classList.remove('is-open');desk.classList.remove('has-evidence');buttonState();
      const finish=()=>{panel.hidden=true;panel.classList.remove('is-closing');desk.classList.remove('is-evidence-closing');closeTimer=null;};
      if(immediate||reducedMotion.matches||!wasOpen){finish();onResize();return;}
      panel.classList.add('is-closing');desk.classList.add('is-evidence-closing');onResize();
      closeTimer=setTimeout(finish,300);
    }
    function buildTabs(){
      tabs.replaceChildren();
      for(const entry of entries()){
        const b=document.createElement('button');b.type='button';b.textContent=entry.label;b.setAttribute('aria-pressed','false');b.addEventListener('click',()=>{pinned=true;render(entry.id);});tabs.append(b);
      }
    }
    function render(id){
      const item=entries().find(x=>x.id===id)||entries()[0];if(!item)return;
      active=item.id;body.replaceChildren();body.scrollTop=0;
      [...tabs.children].forEach((b,i)=>b.setAttribute('aria-pressed',String(entries()[i].id===active)));
      const kind=document.createElement('p');kind.className='evidence-kind';kind.textContent=item.kind;body.append(kind);
      const title=document.createElement('h2');title.id='evidence-title';title.textContent=item.title;body.append(title);
      if(item.image){
        const link=document.createElement('a');link.className='evidence-image-link';link.href=localPath(item.image);link.target='_blank';link.rel='noopener';link.setAttribute('aria-label',item.title+t(' 이미지 크게 보기',' full-size preview'));
        const image=document.createElement('img');image.src=localPath(item.image);image.alt=item.alt||item.title;image.loading='eager';link.append(image);body.append(link);
      }
      if(item.description){const text=document.createElement('p');text.className='evidence-description';text.textContent=item.description;body.append(text);}
      const link=document.createElement('a');link.className='evidence-source';link.href=item.url;link.target='_blank';link.rel='noopener';link.textContent=item.link_label||t('자료 원문 열기','Open source');body.append(link);
    }
    function open(id,keep=false){
      if(!entries().length)return;cancel();clearTimeout(closeTimer);closeTimer=null;
      pinned=pinned||keep;
      if(!opened||id&&id!==active)render(id||active);
      opened=true;panel.hidden=false;panel.inert=false;panel.setAttribute('aria-hidden','false');
      panel.classList.remove('is-closing');desk.classList.remove('is-evidence-closing');desk.classList.add('has-evidence');buttonState();onResize();
      void panel.offsetWidth;
      panel.classList.add('is-open');
    }
    function wire(element,id){
      element.setAttribute('aria-controls','evidence-panel');
      element.addEventListener('pointerenter',event=>{if(event.pointerType!=='touch'&&!pinned){clearTimeout(hoverTimer);hoverTimer=setTimeout(()=>open(id),180);}});
      element.addEventListener('pointerleave',()=>{clearTimeout(hoverTimer);hoverTimer=null;});
      if(element!==button)element.addEventListener('focus',()=>{if(!pinned)open(id);});
      element.addEventListener('click',event=>{event.preventDefault();open(id,true);});
    }
    button.addEventListener('click',()=>{if(opened)close();else open(null,true);});
    byId('evidence-close').addEventListener('click',()=>{close();button.focus({preventScroll:true});});
    desk.addEventListener('pointerenter',cancel);
    desk.addEventListener('pointerleave',()=>{if(opened&&!pinned)timer=setTimeout(close,550);});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&opened){event.preventDefault();close();}});
    return {wire,close,isOpen:()=>opened,setPage(next){close(true);page=next;buildTabs();button.hidden=!entries().length;buttonState();}};
  };
})();
