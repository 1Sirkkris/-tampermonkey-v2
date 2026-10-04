// ==UserScript==
// @name         V3 | BWU2 PO Portal
// @name:en      V3 | BWU2 PO Portal
// @namespace    https://github.com/1Sirkkris/-tampermonkey-v2/v3-relaunch
// @version      0.1.0
// @description  Native PO Portal lite search and results view.
// @include      /^https?:\/\/console\.harmony\.a2z\.com\/poportal(?:[\/?#]|$)/
// @run-at       document-body
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-relaunch/v3/dist/V3_PO_Portal.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-relaunch/v3/dist/V3_PO_Portal.user.js
// @v3-build     poportal-0.1.0-c36aacd5
// ==/UserScript==

(()=>{
'use strict';
const V3=Object.create(null);
V3.build=Object.freeze({"id":"poportal-0.1.0-c36aacd5","version":"0.1.0","suite":"poportal"});

// ---- src/core/base.js ----
V3.base=(()=>{
  const clean=v=>String(v??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
  const upper=v=>clean(v).toUpperCase();
  const lower=v=>clean(v).toLowerCase();
  const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
  const id=prefix=>String(prefix||'v3')+'-'+(crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
  const container=v=>/^(?:ts|cs)x[0-9a-z_-]+$/i.test(clean(v));
  const lines=(v,{dedupe=true}={})=>{
    const out=[],seen=new Set();
    for(const raw of String(v??'').split(/\r?\n/)){
      const value=clean(raw.split(/\s+/)[0]);if(!value)continue;
      const key=upper(value);if(dedupe&&seen.has(key))continue;
      seen.add(key);out.push(value);
    }
    return out;
  };
  const json=raw=>{try{return JSON.parse(String(raw??''));}catch{return null;}};
  const html=raw=>new DOMParser().parseFromString(String(raw??''),'text/html');
  const clamp=(n,min,max)=>Math.min(max,Math.max(min,Number(n)||0));
  return Object.freeze({clean,upper,lower,esc,id,container,lines,json,html,clamp});
})();

// ---- src/core/lifecycle.js ----
V3.lifecycle=(()=>{
  function create(name='module'){
    const controller=new AbortController(),disposers=new Set();let dead=false;
    const own=fn=>{if(typeof fn==='function')disposers.add(fn);return fn;};
    const on=(target,type,listener,options={})=>{
      if(dead||!target?.addEventListener)return()=>{};
      const opts=typeof options==='boolean'?{capture:options,signal:controller.signal}:{...options,signal:controller.signal};
      target.addEventListener(type,listener,opts);
      return()=>target.removeEventListener(type,listener,opts);
    };
    const observe=(target,callback,options)=>{
      if(dead||!target||typeof MutationObserver==='undefined')return null;
      const observer=new MutationObserver(callback);observer.observe(target,options);own(()=>observer.disconnect());return observer;
    };
    const timeout=(fn,ms)=>{
      if(dead)return 0;
      const timer=setTimeout(()=>{if(!dead)fn();},Math.max(0,Number(ms)||0));own(()=>clearTimeout(timer));return timer;
    };
    const interval=(fn,ms)=>{
      if(dead)return 0;
      const timer=setInterval(()=>{if(!dead)fn();},Math.max(100,Number(ms)||0));own(()=>clearInterval(timer));return timer;
    };
    const sleep=ms=>new Promise((resolve,reject)=>{
      if(dead)return reject(new DOMException('Disposed','AbortError'));
      const timer=setTimeout(done,Math.max(0,Number(ms)||0));
      const abort=()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));};
      function done(){controller.signal.removeEventListener('abort',abort);resolve();}
      controller.signal.addEventListener('abort',abort,{once:true});
    });
    const dispose=()=>{if(dead)return;dead=true;controller.abort();for(const fn of [...disposers]){try{fn();}catch{}}disposers.clear();};
    return Object.freeze({name,signal:controller.signal,own,on,observe,timeout,interval,sleep,dispose,get disposed(){return dead;}});
  }
  return Object.freeze({create});
})();

// ---- src/core/telemetry.js ----
V3.telemetry=(()=>{
  const EVENT='bwu2:v3:obs';
  const secret=/token|secret|cookie|authorization|csrf|password|credential/i;
  const mask=value=>{const text=V3.base.clean(value);return !text||text.length<8?text:text.slice(0,3)+'…'+text.slice(-4)+'('+text.length+')';};
  const sanitize=(value,depth=0)=>{
    if(depth>4)return'[depth]';
    if(value==null||typeof value==='number'||typeof value==='boolean')return value;
    if(typeof value==='string')return value.length>500?value.slice(0,500)+'…':value;
    if(Array.isArray(value))return value.slice(0,30).map(v=>sanitize(v,depth+1));
    if(typeof value==='object'){const out={};for(const [k,v] of Object.entries(value).slice(0,50))out[k]=secret.test(k)?'[redacted]':sanitize(v,depth+1);return out;}
    return String(value);
  };
  function create(app,version){
    const emit=(type,data={})=>{
      const event={t:new Date().toISOString(),app,version,type,...sanitize(data)};
      try{window.dispatchEvent(new CustomEvent(EVENT,{detail:JSON.stringify(event)}));}catch{}
      return event;
    };
    return Object.freeze({emit});
  }
  return Object.freeze({EVENT,create,mask,sanitize});
})();

// ---- src/core/ui.js ----
V3.ui=(()=>{
  const DOCK='bwu2-v3-dock',OPEN='bwu2:v3:panel-open';
  const dockCss=`:host{all:initial;position:fixed;right:12px;bottom:12px;z-index:2147482000;font-family:Arial,sans-serif}.dock{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;max-width:min(760px,calc(100vw - 24px))}button{min-height:32px;padding:6px 9px;border:1px solid #68778d;border-radius:8px;background:#161c25;color:#fff;font:800 11px Arial;cursor:pointer;box-shadow:0 4px 14px #0005}button:focus-visible{outline:3px solid #ffd84d;outline-offset:2px}`;
  const panelCss=`:host{all:initial;position:fixed;right:12px;top:12px;z-index:2147483000;font-family:Arial,sans-serif;color:#f5f7fb}.panel{width:min(var(--w,520px),calc(100vw - 24px));max-height:calc(100vh - 24px);display:flex;flex-direction:column;border:1px solid #536178;border-radius:13px;background:#10151d;box-shadow:0 18px 50px #0008;overflow:hidden}.head{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:10px 12px;background:#1a2230;border-bottom:1px solid #536178}.head b{flex:1;font:900 15px Arial}.close{width:34px;height:32px;border:1px solid #68778d;border-radius:8px;background:#252f3e;color:#fff;font:900 16px Arial;cursor:pointer}.body{flex:1 1 auto;min-height:0;overflow:auto;padding:12px}.section{padding:11px;border:1px solid #465367;border-radius:10px;background:#171d27;margin-bottom:10px}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.field{display:grid;gap:4px;margin-bottom:8px;color:#c4cedd;font:800 10px Arial}.field input,.field textarea,.field select,input.input,textarea.input,select.input{width:100%;box-sizing:border-box;min-height:35px;padding:7px 9px;border:1px solid #607087;border-radius:8px;background:#0c1118;color:#fff;font:12px Arial}.field textarea,textarea.input{min-height:90px;resize:vertical;font-family:Consolas,monospace}.btn{min-height:34px;padding:7px 10px;border:1px solid #68778d;border-radius:8px;background:#263142;color:#fff;font:900 11px Arial;cursor:pointer}.btn.primary{background:#eaf1ff;color:#111827}.btn.danger{background:#8c2420}.note{color:#bcc7d7;font:11px/1.4 Arial}.ok{color:#65f08f}.warn{color:#ffd166}.bad{color:#ff7068}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:3px solid #ffd84d;outline-offset:2px}`;
  const ensureDock=()=>{
    let host=document.getElementById(DOCK);
    if(!host){host=document.createElement('div');host.id=DOCK;host.dataset.bwu2V3Ui='1';host.attachShadow({mode:'open'}).innerHTML='<style>'+dockCss+'</style><div class="dock"></div>';document.documentElement.appendChild(host);}
    return host.shadowRoot;
  };
  const dockButton=({id,label,title,onClick})=>{
    const shadow=ensureDock();let button=shadow.querySelector('[data-id="'+CSS.escape(id)+'"]');
    if(!button){button=document.createElement('button');button.dataset.id=id;button.textContent=label;button.title=title||label;shadow.querySelector('.dock').appendChild(button);}
    button.onclick=onClick;return button;
  };
  const panel=({id,title,width=520,life})=>{
    let host=document.getElementById(id);
    if(!host){host=document.createElement('div');host.id=id;host.dataset.bwu2V3Ui='1';host.style.display='none';const shadow=host.attachShadow({mode:'open'});shadow.innerHTML='<style>'+panelCss+'</style><section class="panel" style="--w:'+Number(width)+'px"><header class="head"><b></b><button class="close" type="button">×</button></header><main class="body"></main></section>';shadow.querySelector('.head b').textContent=title;document.documentElement.appendChild(host);}
    const body=host.shadowRoot.querySelector('.body');
    const close=()=>{host.style.display='none';};
    const open=()=>{window.dispatchEvent(new CustomEvent(OPEN,{detail:id}));host.style.display='block';};
    life?.on(window,OPEN,event=>{if(event.detail!==id)close();});
    host.shadowRoot.querySelector('.close').onclick=close;
    return Object.freeze({host,body,open,close,set(content){body.replaceChildren();if(content instanceof Node)body.appendChild(content);else body.innerHTML=String(content||'');}});
  };
  return Object.freeze({dockButton,panel,OPEN});
})();

// ---- src/apps/poportal/index.js ----
V3.boot=()=>{
  const life=V3.lifecycle.create('poportal'),telemetry=V3.telemetry.create('poportal',V3.build.version),panel=V3.ui.panel({id:'bwu2-v3-poportal',title:'V3 · PO Portal',width:560,life});
  if(/^\/poportal\/?$/i.test(location.pathname)){location.replace('/poportal/fe'+location.search+location.hash);return;}
  const conditions=['Complete','CompletelyConfirmed','PartiallyConfirmed','Submitted','Reserved','Confirmed'];let mounted=false,full=false,applyQueued=false;
  const apply=()=>{for(const table of document.querySelectorAll('table')){const row=[...table.rows].find(r=>[...r.cells].some(c=>/^po id\b/i.test(V3.base.clean(c.textContent)))&&[...r.cells].some(c=>/^status\b/i.test(V3.base.clean(c.textContent))));if(!row)continue;const keep=[...row.cells].map(c=>/^(po id|status|fc|ordered|shipped|first recv|last recv|exp|rec|disc)/i.test(V3.base.clean(c.textContent)));for(const r of table.rows)if(r.cells.length===row.cells.length)[...r.cells].forEach((c,i)=>c.style.display=full||keep[i]?'':'none');}};
  const mount=()=>{if(mounted)return;mounted=true;const root=document.createElement('div'),p=new URLSearchParams(location.search),today=new Date(),start=new Date(today);start.setMonth(start.getMonth()-6),fmt=d=>d.toISOString().slice(0,10);root.innerHTML='<section class="section"><label class="field">ASIN / FNSKU<input data-code value="'+V3.base.esc(p.get('asin')||'')+'"></label><div class="grid"><label class="field">Start<input data-start type="date" value="'+V3.base.esc(p.get('startDate')||fmt(start))+'"></label><label class="field">End<input data-end type="date" value="'+V3.base.esc(p.get('endDate')||fmt(today))+'"></label></div><div class="row"><button class="btn primary" data-search>SEARCH</button><button class="btn" data-view>LITE / FULL</button></div></section>';panel.set(root);root.querySelector('[data-search]').onclick=()=>{const code=V3.base.upper(root.querySelector('[data-code]').value),s=root.querySelector('[data-start]').value,e=root.querySelector('[data-end]').value;if(!code)return;const u=new URL('/poportal/fe',location.origin);u.searchParams.set('asin',code);u.searchParams.set('startDate',s);u.searchParams.set('endDate',e);u.searchParams.set('countries','AU');u.searchParams.set('distributorChecks',conditions.join(','));u.searchParams.set('removeZeroFilter','false');telemetry.emit('search',{code:V3.telemetry.mask(code)});location.assign(u.href);};root.querySelector('[data-view]').onclick=()=>{full=!full;apply();};};
  const scheduleApply=()=>{if(applyQueued)return;applyQueued=true;requestAnimationFrame(()=>{applyQueued=false;apply();});};
  life.observe(document.body,scheduleApply,{childList:true,subtree:true});apply();V3.ui.dockButton({id:'poportal',label:'PO LITE',title:'V3 PO Portal',onClick:()=>{mount();panel.open();}});
};

if(typeof V3.boot!=='function')throw new Error('V3 boot missing');
V3.boot();
})();
