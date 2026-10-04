// ==UserScript==
// @name         V3 | BWU2 FNSKU Mapping
// @name:en      V3 | BWU2 FNSKU Mapping
// @namespace    https://github.com/1Sirkkris/-tampermonkey-v2/v3-relaunch
// @version      0.1.0
// @description  Exact regional FNSKU to ASIN to JP/AU mapping helper.
// @match        https://fba-fnsku-commingling-console-eu.aka.amazon.com/tool/fnsku-mappings-tool*
// @match        https://fba-fnsku-commingling-console-na.aka.amazon.com/tool/fnsku-mappings-tool*
// @match        https://fba-fnsku-commingling-console-jp.aka.amazon.com/tool/fnsku-mappings-tool*
// @run-at       document-body
// @noframes
// @grant        GM_xmlhttpRequest
// @connect      fba-fnsku-commingling-console-eu.aka.amazon.com
// @connect      fba-fnsku-commingling-console-na.aka.amazon.com
// @connect      fba-fnsku-commingling-console-jp.aka.amazon.com
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-relaunch/v3/dist/V3_FNSKU_Mapping.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-relaunch/v3/dist/V3_FNSKU_Mapping.user.js
// @v3-build     fnsku-0.1.0-dacf2515
// ==/UserScript==

(()=>{
'use strict';
const V3=Object.create(null);
V3.build=Object.freeze({"id":"fnsku-0.1.0-dacf2515","version":"0.1.0","suite":"fnsku"});

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

// ---- src/core/transport.js ----
V3.transport=(()=>{
  const authLike=(status,contentType,finalUrl,raw)=>{
    const html=/text\/html|application\/xhtml/i.test(contentType||'')||/^\s*(?:<!doctype\s+html|<html\b)/i.test(raw||'');
    const auth=[401,403,419].includes(Number(status))||/(?:^|[\/?#._-])(?:login|signin|sign-in|midway|sso|auth|authenticate|federat)(?:[\/?#._-]|$)/i.test(finalUrl||'')||(html&&/\b(?:sign\s*in|log\s*in|authentication|midway|single\s+sign[- ]?on)\b/i.test(raw||''));
    return{html,auth};
  };
  const data=raw=>{try{return raw?JSON.parse(raw):null;}catch{return raw;}};
  async function gm(url,options={}){
    const request=typeof GM==='object'&&typeof GM.xmlHttpRequest==='function'?GM.xmlHttpRequest:null;
    if(request){
      let response;
      try{response=await request({method:options.method||'GET',url,data:options.body,headers:options.headers||{},timeout:options.timeout||15000,redirect:'follow'});}
      catch(error){throw error;}
      const raw=String(response.responseText??(typeof response.response==='string'?response.response:''));
      const contentType=String(response.responseHeaders||'').split(/\r?\n/).find(x=>/^content-type:/i.test(x))?.split(':').slice(1).join(':').trim()||'';
      return classify({status:response.status,raw,finalUrl:response.finalUrl||url,contentType,response},options);
    }
    if(typeof GM_xmlhttpRequest!=='function')throw new Error('GM request unavailable');
    return new Promise((resolve,reject)=>GM_xmlhttpRequest({
      method:options.method||'GET',url,data:options.body,headers:options.headers||{},timeout:options.timeout||15000,
      onload:r=>{try{resolve(classify({status:r.status,raw:String(r.responseText||''),finalUrl:r.finalUrl||url,contentType:String(r.responseHeaders||'').match(/content-type:\s*([^\r\n]+)/i)?.[1]||'',response:r},options));}catch(e){reject(e);}},
      ontimeout:()=>reject(new Error('Request timeout')),onerror:()=>reject(new Error('Network error')),onabort:()=>reject(new DOMException('Aborted','AbortError'))
    }));
  }
  async function page(url,options={}){
    const response=await fetch(url,{method:options.method||'GET',body:options.body,headers:options.headers||{},credentials:'same-origin',cache:'no-store',redirect:'follow',signal:options.signal});
    const raw=await response.text();
    return classify({status:response.status,raw,finalUrl:response.url||url,contentType:response.headers.get('content-type')||'',response},options);
  }
  function classify(result,options){
    const flags=authLike(result.status,result.contentType,result.finalUrl,result.raw);
    if(flags.auth||(flags.html&&options.allowHtml!==true))throw Object.assign(new Error('Authentication/HTML response instead of expected API response'),{status:result.status,flags});
    if((result.status<200||result.status>=300)&&options.allowHttpError!==true)throw Object.assign(new Error('HTTP '+result.status),{status:result.status,body:data(result.raw)});
    return{...result,data:data(result.raw),flags,httpError:result.status<200||result.status>=300};
  }
  return Object.freeze({gm,page,authLike});
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

// ---- src/apps/fnsku/index.js ----
V3.boot=()=>{
  const life=V3.lifecycle.create('fnsku'),telemetry=V3.telemetry.create('fnsku',V3.build.version),panel=V3.ui.panel({id:'bwu2-v3-fnsku',title:'V3 · FNSKU Mapping',width:760,life});
  const HOSTS={na:'fba-fnsku-commingling-console-na.aka.amazon.com',eu:'fba-fnsku-commingling-console-eu.aka.amazon.com',jp:'fba-fnsku-commingling-console-jp.aka.amazon.com'};
  const token=()=>new URL(location.href).searchParams.get('anti-csrftoken-a2z')||document.querySelector('input[name="anti-csrftoken-a2z"]')?.value||'';
  const url=(region,type,{fnsku='',asin=''}={})=>{const u=new URL('/tool/fnsku-mappings-tool/get','https://'+HOSTS[region]);for(const [k,v] of Object.entries({getMappingsType:type,FNSku:'',FNSkus:fnsku?fnsku+'\r\n':'',merchantId:'',MSkus:'',ASIN:asin,includeInactive:'true',includeInternalMerchants:'false',submit:'get',paginationToken:''}))u.searchParams.set(k,v);if(token())u.searchParams.set('anti-csrftoken-a2z',token());return u.toString();};
  const parse=raw=>{const doc=V3.base.html(raw),table=doc.querySelector('#fnsku-table')||doc.querySelector('table.table');if(!table)return[];const trs=[...table.querySelectorAll('tr')];if(trs.length<2)return[];const hs=[...trs[0].querySelectorAll('th,td')].map(x=>V3.base.lower(x.textContent)),idx={merchant:hs.findIndex(x=>/merchant\s*id/.test(x)),msku:hs.findIndex(x=>/msku/.test(x)),fnsku:hs.findIndex(x=>/fnsku/.test(x)),asin:hs.findIndex(x=>/^asin$/.test(x)),condition:hs.findIndex(x=>/condition/.test(x)),status:hs.findIndex(x=>/status/.test(x))};return trs.slice(1).map(tr=>{const c=[...tr.querySelectorAll('td')].map(x=>V3.base.clean(x.textContent)),get=i=>i>=0?c[i]||'':'';return{merchantId:get(idx.merchant),msku:get(idx.msku),fnsku:V3.base.upper(get(idx.fnsku)),asin:V3.base.upper(get(idx.asin)),condition:get(idx.condition),status:get(idx.status)};}).filter(x=>x.fnsku||x.asin);};
  const get=async u=>(await V3.transport.gm(u,{headers:{Accept:'text/html, */*; q=0.01','X-Requested-With':'XMLHttpRequest'},timeout:10000,allowHtml:true})).raw;
  const exactFnsku=async(region,code)=>parse(await get(url(region,'FNSKU_MAPPINGS',{fnsku:code}))).filter(r=>r.fnsku===code);
  const exactAsin=async asin=>parse(await get(url('jp','ASIN_MAPPINGS',{asin}))).filter(r=>r.asin===asin);
  let mounted=false;
  const mount=()=>{if(mounted)return;mounted=true;const root=document.createElement('div');root.innerHTML='<section class="section"><label class="field">FNSKU / ASIN<input data-code></label><button class="btn primary" data-run>LOOKUP</button><div class="note" data-msg style="margin-top:8px"></div></section><section class="section"><div data-result></div></section>';panel.set(root);const input=root.querySelector('[data-code]'),msg=root.querySelector('[data-msg]'),out=root.querySelector('[data-result]');root.querySelector('[data-run]').onclick=async()=>{const code=V3.base.upper(input.value);if(!code)return;msg.textContent='LOOKING…';out.innerHTML='';try{let rows=[],asin='';if(/^B0[A-Z0-9]{8}$/.test(code)){asin=code;rows=await exactAsin(asin);}else{const found=(await Promise.all([exactFnsku('na',code),exactFnsku('eu',code),exactFnsku('jp',code)])).flat();const asins=[...new Set(found.map(x=>x.asin).filter(x=>/^B0[A-Z0-9]{8}$/.test(x)))];if(asins.length!==1)throw new Error(asins.length?'Multiple exact ASINs: '+asins.join(', '):'No exact mapping');asin=asins[0];rows=await exactAsin(asin);}msg.className='note ok';msg.textContent='ASIN '+asin+' · '+rows.length+' JP/AU exact row(s)';out.innerHTML=rows.map(r=>'<div style="padding:6px;border-bottom:1px solid #39475b"><b>'+V3.base.esc(r.fnsku||'—')+'</b> · '+V3.base.esc(r.msku||'—')+' · '+V3.base.esc(r.merchantId||'—')+' · '+V3.base.esc(r.status||'')+'</div>').join('')||'<div class="note">No exact JP/AU rows.</div>';telemetry.emit('lookup',{input:V3.telemetry.mask(code),asin:V3.telemetry.mask(asin),rows:rows.length});}catch(e){msg.className='note bad';msg.textContent=e.message;}};};
  V3.ui.dockButton({id:'fnsku',label:'FNSKU',title:'V3 FNSKU Mapping',onClick:()=>{mount();panel.open();}});
};

if(typeof V3.boot!=='function')throw new Error('V3 boot missing');
V3.boot();
})();
