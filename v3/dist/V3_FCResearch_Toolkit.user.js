// ==UserScript==
// @name         V3 | BWU2 FCResearch Toolkit
// @name:en      V3 | BWU2 FCResearch Toolkit
// @namespace    https://github.com/1Sirkkris/-tampermonkey-v2/v3-relaunch
// @version      0.1.0
// @description  Lightweight FCResearch tools: Tote Audit, Bin Check, Pandash, MoveContainer and Unbind.
// @include      /^https?:\/\/.*fcresearch.*\//
// @include      /^https?:\/\/qifcr\.fe\.aftx\.amazonoperations\.app\//
// @run-at       document-body
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @grant        GM_openInTab
// @connect      pandash.amazon.com
// @connect      aft-moveapp-nrt-nrt.nrt.proxy.amazon.com
// @connect      tx-b-hierarchy-nrt.nrt.proxy.amazon.com
// @connect      localhost
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-relaunch/v3/dist/V3_FCResearch_Toolkit.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-relaunch/v3/dist/V3_FCResearch_Toolkit.user.js
// @v3-build     fcr-0.1.0-401d8516
// ==/UserScript==

(()=>{
'use strict';
const V3=Object.create(null);
V3.build=Object.freeze({"id":"fcr-0.1.0-401d8516","version":"0.1.0","suite":"fcr"});

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

// ---- src/core/storage.js ----
V3.storage=(()=>{
  const hasModern=()=>typeof GM==='object'&&typeof GM.getValues==='function'&&typeof GM.setValues==='function';
  async function getMany(defaults){
    if(hasModern())return GM.getValues(defaults);
    const out={};for(const [key,fallback] of Object.entries(defaults))out[key]=typeof GM_getValue==='function'?GM_getValue(key,fallback):fallback;
    return out;
  }
  async function setMany(values){
    if(hasModern())return GM.setValues(values);
    for(const [key,value] of Object.entries(values))if(typeof GM_setValue==='function')GM_setValue(key,value);
  }
  function create(namespace,schema=1){
    const prefix='bwu2.v3.'+namespace+'.s'+schema+'.';
    const key=name=>prefix+name;
    const get=async(name,fallback=null)=>(await getMany({[key(name)]:fallback}))[key(name)];
    const set=async(name,value)=>{await setMany({[key(name)]:value});return value;};
    const getAll=async defaults=>{
      const mapped={};for(const [name,value] of Object.entries(defaults))mapped[key(name)]=value;
      const raw=await getMany(mapped),out={};for(const name of Object.keys(defaults))out[name]=raw[key(name)];
      return out;
    };
    const setAll=async values=>{const mapped={};for(const [name,value] of Object.entries(values))mapped[key(name)]=value;await setMany(mapped);};
    return Object.freeze({namespace,schema,prefix,key,get,set,getAll,setAll});
  }
  return Object.freeze({create,getMany,setMany});
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

// ---- src/core/operation.js ----
V3.operation=(()=>{
  class UnknownError extends Error{constructor(message='Outcome unknown',meta={}){super(message);this.name='UnknownError';this.outcome='unknown';Object.assign(this,meta);}}
  class RejectedError extends Error{constructor(message='Rejected',meta={}){super(message);this.name='RejectedError';this.outcome='rejected';Object.assign(this,meta);}}
  const legal={prepared:new Set(['submitted','rejected']),submitted:new Set(['confirmed','rejected','unknown']),confirmed:new Set(),rejected:new Set(),unknown:new Set()};
  function create({kind='operation',ref='',telemetry}={}){
    const data={id:V3.base.id(kind),kind,ref:V3.telemetry?.mask?.(ref)||V3.base.clean(ref),phase:'prepared',outcome:'pending',started:performance.now()};
    telemetry?.emit('operation',{...data});
    const move=(phase,extra={})=>{
      if(!legal[data.phase]?.has(phase))throw new Error('Illegal operation transition '+data.phase+' → '+phase);
      data.phase=phase;
      if(phase==='confirmed')data.outcome='confirmed';
      if(phase==='rejected')data.outcome='rejected';
      if(phase==='unknown')data.outcome='unknown';
      telemetry?.emit('operation',{...data,ms:Math.round(performance.now()-data.started),...extra});
      return data;
    };
    return Object.freeze({data,submitted:x=>move('submitted',x),confirmed:x=>move('confirmed',x),rejected:x=>move('rejected',x),unknown:x=>move('unknown',x)});
  }
  return Object.freeze({create,UnknownError,RejectedError});
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

// ---- src/core/identity.js ----
V3.identity=(()=>{
  const LOGIN=/^[a-z][a-z0-9-]{2,31}$/i;
  const BAD=/^(?:login|username|user|employee|alias|logout|signin|profile|account|settings|search)$/i;
  const normalize=value=>{const v=V3.base.lower(value);return LOGIN.test(v)&&!BAD.test(v)?v:'';};
  const cookie=(doc,name)=>{
    try{for(const part of String(doc.cookie||'').split(';')){const i=part.indexOf('=');if(i<1||part.slice(0,i).trim().toLowerCase()!==name.toLowerCase())continue;let v=part.slice(i+1).trim();try{v=decodeURIComponent(v);}catch{}return v;}}catch{}
    return'';
  };
  function resolve({doc=document,pageWindow=window}={}){
    for(const key of ['employeeLogin','userLogin','autoId','autoID']){
      const value=normalize(pageWindow?.[key]);if(value)return{login:value,source:'global:'+key};
    }
    for(const selector of ['[data-employee-login]','[data-user-login]','[data-autoid]','meta[name="employeeLogin"]','meta[name="autoid"]']){
      const el=doc.querySelector(selector);if(!el)continue;
      const value=normalize(el.dataset?.employeeLogin||el.dataset?.userLogin||el.dataset?.autoid||el.content);if(value)return{login:value,source:'dom:'+selector};
    }
    for(const name of ['employeeLogin','userLogin','autoid']){
      const value=normalize(cookie(doc,name));if(value)return{login:value,source:'cookie:'+name};
    }
    const fc=normalize(cookie(doc,'fcmenu-employeeId'));if(fc)return{login:fc,source:'cookie:fcmenu-employeeId'};
    return{login:'',source:''};
  }
  return Object.freeze({normalize,resolve});
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

// ---- src/core/print.js ----
V3.print=(()=>{
  const hex=value=>Array.from(new TextEncoder().encode(String(value??''))).map(b=>b.toString(16).padStart(2,'0')).join('');
  async function barcode(code,{description='',quantity=1,telemetry}={}){
    const value=V3.base.clean(code);if(!value)throw new Error('Barcode required');
    const url='http://localhost:5965/printer?action=print&type=barcode&data='+hex(value)+'&text='+hex(value)+'&quantity='+V3.base.clamp(quantity,1,999)+'&desc='+hex(V3.base.clean(description))+'&seq='+Date.now();
    const result=await V3.transport.gm(url,{timeout:5000});
    telemetry?.emit('print',{code:V3.telemetry.mask(value),status:result.status,hasDescription:Boolean(description)});
    return result;
  }
  return Object.freeze({barcode});
})();

// ---- src/services/fcr.js ----
V3.fcr=(()=>{
  const warehouse=()=>location.pathname.match(/^\/([^/]+)\/results(?:\/|$)/i)?.[1]||'';
  const base=()=>{const fc=warehouse();if(!fc)throw new Error('Warehouse not found in URL');return location.origin+'/'+encodeURIComponent(fc)+'/results';};
  const headers={'Content-Type':'application/x-www-form-urlencoded','Accept':'text/html, */*; q=0.01','X-Requested-With':'XMLHttpRequest'};
  const parseBool=v=>/^(true|yes|1)$/i.test(V3.base.clean(v))?true:/^(false|no|0)$/i.test(V3.base.clean(v))?false:null;
  const suspicious=value=>{
    let p=String(value||'').match(/\d+(?:\.\d+)?/g);if(!p||p.length<3)return false;p=p.slice(0,3);
    const n=p.map(Number),eq=(a,b)=>Math.abs(a-b)<.001,rounded=p.filter(x=>/\.00$/.test(x)).length;
    return eq(n[0],n[1])||eq(n[0],n[2])||eq(n[1],n[2])||rounded>=3||(Math.min(...n)<=2.001&&rounded>=2);
  };
  const parseProduct=raw=>{
    const doc=V3.base.html(raw);
    const table=doc.querySelector('.a-box-group .a-keyvalue')||[...doc.querySelectorAll('table')].find(t=>[...t.querySelectorAll('th')].some(th=>/^(asin|isbn|fnsku)$/i.test(V3.base.clean(th.textContent))))||doc.querySelector('.a-keyvalue');
    if(!table)return null;
    const data={};
    for(const row of table.querySelectorAll('tr')){const th=row.querySelector('th'),td=row.querySelector('td');if(th&&td)data[V3.base.lower(th.textContent)]=V3.base.clean(td.querySelector('a')?.textContent||td.textContent);}
    const sortable=parseBool(data.sortable);
    const product={asin:V3.base.clean(data.asin),isbn:V3.base.clean(data.isbn),fnsku:V3.base.clean(data.fnsku),fcsku:V3.base.clean(data.fcsku),title:V3.base.clean(data.title),dimensions:V3.base.clean(data.dimensions),weight:V3.base.clean(data.weight),inventoryCost:V3.base.clean(data['list price']||data.price||data['inventory cost']||''),sortable,sortableText:sortable==null?V3.base.clean(data.sortable):String(sortable),suspicious:suspicious(data.dimensions)};
    product.primary=product.asin||product.isbn;
    return product.primary||product.fnsku||product.fcsku?product:null;
  };
  const indexes=table=>{
    const hs=[...table.querySelectorAll('thead th')].map(th=>({id:V3.base.lower(th.id),text:V3.base.lower(String(th.textContent||'').replace(/\(\d+\)/g,''))}));
    const find=(...names)=>hs.findIndex(h=>names.includes(h.id)||names.includes(h.text));
    return{container:find('inventory-container','container'),asin:find('inventory-asin','asin'),fnsku:find('inventory-fnsku','fnsku'),fcsku:find('inventory-fcsku','fcsku'),lpn:find('inventory-lpn','lpn'),qty:find('inventory-quantity','quantity'),disposition:find('inventory-disposition','disposition'),consumer:find('inventory-consumer','consumer'),consumerId:find('inventory-consumer-id','consumer id','consumerid'),outerLocation:find('inventory-outer-location','outer location'),outerLocationType:find('inventory-outer-location-type','outer location type'),title:find('inventory-title','title')};
  };
  const parseInventory=doc=>{
    const table=doc.querySelector('#table-inventory');if(!table)throw new Error('Inventory table not returned');
    const idx=indexes(table),rows=[];
    for(const tr of table.tBodies?.[0]?.rows||[]){
      const val=i=>i>=0?V3.base.clean(tr.cells[i]?.textContent):'';
      const row={container:val(idx.container),asin:val(idx.asin),fnsku:val(idx.fnsku),fcsku:val(idx.fcsku),lpn:val(idx.lpn),qty:Number(val(idx.qty).replace(/[^\d.-]/g,''))||0,disposition:val(idx.disposition),consumer:val(idx.consumer),consumerId:val(idx.consumerId),outerLocation:val(idx.outerLocation),outerLocationType:val(idx.outerLocationType),title:val(idx.title)};
      if(row.asin||row.fnsku||row.fcsku)rows.push(row);
    }
    return rows;
  };
  const token=doc=>{const raw=V3.base.clean(doc.querySelector('.pagination-token')?.textContent);return raw&&/^(?:\{|\[)/.test(raw)?raw:'';};
  function create({telemetry,life}={}){
    const inFlight=new Map();
    const post=async(endpoint,fields)=>{
      const params=new URLSearchParams();for(const [k,v] of Object.entries(fields||{}))params.set(k,String(v??''));
      const key=endpoint+'|'+params.toString();if(inFlight.has(key))return inFlight.get(key);
      const work=(async()=>{let retry=0;for(;;){try{return(await V3.transport.page(base()+'/'+endpoint,{method:'POST',body:params.toString(),headers,allowHtml:true,signal:life?.signal})).raw;}catch(error){if(!(error.status>=500&&error.status<600)||retry>=2)throw error;await life.sleep([120,350][retry++]||350);}}})();
      inFlight.set(key,work);try{return await work;}finally{if(inFlight.get(key)===work)inFlight.delete(key);}
    };
    const product=async code=>parseProduct(await post('product',{s:V3.base.clean(code)}));
    const inventory=async(code,{allowPartial=false,onPreview}={})=>{
      const started=performance.now(),first=await post('inventory',{s:V3.base.clean(code)}),doc=V3.base.html(first),table=doc.querySelector('#table-inventory');
      if(!table)throw new Error('Inventory table not returned');
      const tbody=table.tBodies?.[0]||table.appendChild(doc.createElement('tbody')),expected=table.tHead?.rows?.[0]?.cells?.length||0,seen=new Set();
      let next=token(doc),pages=1,complete=true,warning='';
      onPreview?.({rows:parseInventory(doc),complete:!next,pages});
      while(next){
        if(seen.has(next)){complete=false;warning='repeated pagination token';if(!allowPartial)throw new Error('Inventory incomplete: '+warning);break;}
        if(pages>=200){complete=false;warning='pagination safety limit';if(!allowPartial)throw new Error('Inventory incomplete: '+warning);break;}
        seen.add(next);
        try{
          const moreDoc=V3.base.html(await post('inventory-more',{token:next}));pages++;
          const moreTable=moreDoc.querySelector('#table-inventory')||moreDoc.querySelector('table');
          const rows=moreTable?[...moreTable.querySelectorAll('tbody tr')].filter(r=>!expected||r.cells.length>=expected):[];
          if(!rows.length&&token(moreDoc)){complete=false;warning='pagination returned no usable rows';if(!allowPartial)throw new Error('Inventory incomplete: '+warning);break;}
          for(const row of rows)tbody.appendChild(doc.importNode(row,true));
          next=token(moreDoc);
        }catch(error){complete=false;warning=String(error.message||error);if(!allowPartial)throw new Error('Inventory incomplete: '+warning);break;}
      }
      const rows=parseInventory(doc),partialQuantity=rows.reduce((sum,row)=>sum+(Number(row.qty)||0),0);
      telemetry?.emit('fcr.inventory',{search:V3.telemetry.mask(code),pages,rows:rows.length,complete,ms:Math.round(performance.now()-started)});
      return{rows,pages,complete,warning,totalQuantity:complete?partialQuantity:null,partialQuantity};
    };
    return Object.freeze({post,product,inventory});
  }
  return Object.freeze({create,warehouse,base,parseProduct,parseInventory});
})();

// ---- src/services/pandash.js ----
V3.pandash=(()=>{
  function create({telemetry,warehouse}={}){
    const cache=new Map();
    const fc=()=>V3.base.upper(typeof warehouse==='function'?warehouse():warehouse||V3.fcr?.warehouse?.()||'BWU2');
    async function check(asinValue){
      const asin=V3.base.upper(asinValue),site=fc();if(!/^B[A-Z0-9]{9}$/.test(asin))throw new Error('ASIN required');if(!site)throw new Error('Warehouse unavailable');
      const key=site+'|'+asin;if(cache.has(key))return cache.get(key);
      const boot=await V3.transport.gm('https://pandash.amazon.com/GridServlet?fc='+encodeURIComponent(site),{timeout:8000});
      const restriction=V3.base.clean(boot.data?.restriction||'default')||'default';
      const body='language=default&source='+encodeURIComponent(restriction)+'-hazmat-FC&marketPlaces=AU&asins='+encodeURIComponent(asin)+'&rows=1&page=1&fc='+encodeURIComponent(site);
      const result=await V3.transport.gm('https://pandash.amazon.com/GridServlet',{method:'POST',body,headers:{'Content-Type':'application/x-www-form-urlencoded'},timeout:8000});
      const row=Array.isArray(result.data?.rows)?result.data.rows.find(x=>V3.base.upper(x?.asin)===asin):null;if(!row)throw new Error('No Pandash result');
      const value={asin,warehouse:site,level:Number(row.level||0),message:V3.base.clean(row.message),allowed:/can be processed/i.test(V3.base.clean(row.message))};
      cache.set(key,value);telemetry?.emit('pandash',{asin:V3.telemetry.mask(asin),level:value.level,allowed:value.allowed});return value;
    }
    return Object.freeze({check,clear:()=>cache.clear()});
  }
  return Object.freeze({create});
})();

// ---- src/services/movecontainer.js ----
V3.moveContainer=(()=>{
  const URL='https://aft-moveapp-nrt-nrt.nrt.proxy.amazon.com/api/move-container';
  const FLOORS=['P1','P2','P3','P4'];
  const UPPER=[['Cubiscan','dz-Pcubiscan-{floor}'],['Prep','dz-P-Prep-{floor}'],['ISS','dz-P-ISS-{floor}'],['Damages','dz-P-Damages-{floor}'],['Hazmat','dz-P-Hazmat-{floor}'],['Nonsort','dz-Pnonsort-{floor}']];
  const P1=[['Hazmat','dz-P-HAZMAT_OUT'],['Ticketland','dz-P-Ticketland'],['Consolidation','dz-P-issconsol'],['ISS WIP','dz-S-ISSWIP1'],['Nonsort','dz-P-IB-nonsort'],['Shipdock','dz-P-ISS-Shipdock'],['OB IOL','dz-P-OBIOL'],['Damageland','dz-Pdamageland'],['Receive Damages','dz-P-rcv-Damages']];
  const destination=(floor,type)=>{if(type==='PRIME')return'dz-P-PRIME';const found=(floor==='P1'?P1:UPPER).find(([name])=>name===type);return !found?'':floor==='P1'?found[1]:found[1].replace('{floor}',floor);};
  const choices=floor=>[['PRIME','dz-P-PRIME'],...(floor==='P1'?P1:UPPER.map(([name,tpl])=>[name,tpl.replace('{floor}',floor)]))];
  async function move(container,dest,{telemetry}={}){
    const code=V3.base.clean(container),target=V3.base.clean(dest);if(!V3.base.container(code))throw new Error('Container must be tsX/csX');if(!target)throw new Error('Destination required');
    const op=V3.operation.create({kind:'move-container',ref:code,telemetry});op.submitted({destination:target});
    let result;
    try{result=await V3.transport.gm(URL,{method:'POST',body:JSON.stringify({sourceScannableId:null,destinationScannableId:target,containerScannableId:code,confirmed:'true'}),headers:{'Content-Type':'application/json'},timeout:15000,allowHttpError:true});}
    catch(error){op.unknown({reason:'transport'});throw new V3.operation.UnknownError('Move submitted; confirmation lost',{cause:error});}
    if(result.status>=500){op.unknown({status:result.status});throw new V3.operation.UnknownError('Move HTTP '+result.status+'; verify before retry');}
    if(result.status<200||result.status>=300){op.rejected({status:result.status});throw new V3.operation.RejectedError('Move rejected HTTP '+result.status,{status:result.status,data:result.data});}
    try{if(result.finalUrl&&new URL(result.finalUrl).pathname.replace(/\/+$/,'')!==new URL(URL).pathname.replace(/\/+$/,'')){op.unknown({reason:'redirect'});throw new V3.operation.UnknownError('Move confirmation redirected unexpectedly');}}catch(error){if(error?.outcome==='unknown')throw error;}
    op.confirmed({status:result.status,destination:target});return result;
  }
  return Object.freeze({URL,FLOORS,UPPER,P1,destination,choices,move});
})();

// ---- src/services/hierarchy.js ----
V3.hierarchy=(()=>{
  const WAREHOUSE='BWU2',ORIGIN='https://tx-b-hierarchy-nrt.nrt.proxy.amazon.com';
  const API={validate:'/validateContainer',summary:'/getTransshipmentBindingSummary',unbind:'/unbindContainer'};
  async function post(path,body,options={}){
    const request={method:'POST',body:JSON.stringify(body),headers:{'content-type':'application/json'},timeout:options.timeout||15000,allowHttpError:options.allowHttpError===true};
    return location.hostname==='tx-b-hierarchy-nrt.nrt.proxy.amazon.com'
      ? V3.transport.page(path,request)
      : V3.transport.gm(ORIGIN+path,request);
  }
  async function validate(id){
    const code=V3.base.clean(id),r=await post(API.validate,{warehouseId:WAREHOUSE,scannableId:code});
    if(!r.data||V3.base.upper(r.data.warehouseId)!==WAREHOUSE)throw new Error('Container is not validated in '+WAREHOUSE);
    if(r.data.scannableId&&V3.base.lower(r.data.scannableId)!==V3.base.lower(code))throw new Error('Validation returned another container');
    return r.data;
  }
  async function summary(id){
    const r=await post(API.summary,{warehouseId:WAREHOUSE,scannableId:V3.base.clean(id)});
    if(!Array.isArray(r.data?.transferBindingSummaryList))throw new Error('Unexpected binding summary');
    return r.data;
  }
  async function unbind(id,employeeLogin,{telemetry}={}){
    const code=V3.base.clean(id),login=V3.identity.normalize(employeeLogin);
    if(!V3.base.container(code))throw new Error('Container must be tsX/csX');
    if(!login)throw new Error('Authenticated employee unavailable');
    await validate(code);await summary(code);
    const op=V3.operation.create({kind:'hierarchy-unbind',ref:code,telemetry});op.submitted();
    let r;
    try{r=await post(API.unbind,{sourceWarehouseId:WAREHOUSE,scannableId:code,employeeLogin:login},{timeout:20000,allowHttpError:true});}
    catch(error){op.unknown({reason:'transport'});throw new V3.operation.UnknownError('Unbind submitted; confirmation lost',{cause:error});}
    if(r.status>=500){op.unknown({status:r.status});throw new V3.operation.UnknownError('Unbind HTTP '+r.status+'; verify before retry');}
    if(r.status<200||r.status>=300){op.rejected({status:r.status});throw new V3.operation.RejectedError('Unbind rejected HTTP '+r.status);}
    if(!V3.base.clean(r.data?.hostName)){op.unknown({reason:'unexpected-response'});throw new V3.operation.UnknownError('Unbind response ambiguous; verify container');}
    op.confirmed();return r.data;
  }
  return Object.freeze({WAREHOUSE,ORIGIN,API,validate,summary,unbind});
})();

// ---- src/services/bincheck.js ----
V3.bincheck=(()=>{
  const POD=/\bP-\d-(?:[A-Z]\d{3}){2}\b/i;
  const shiftExpiry=()=>{const now=new Date(),end=new Date(now);end.setHours(18,0,0,0);if(end<=now)end.setDate(end.getDate()+1);return end.getTime();};
  function create({telemetry,life}={}){
    const store=V3.storage.create('bincheck',1),memory=new Map();
    const hierarchyUrl=pod=>{const u=new URL(location.href);u.hash='';u.search='';u.pathname=u.pathname.replace(/\/$/,'')+'/container-hierarchy';u.searchParams.set('s',pod);return u.href;};
    const parse=raw=>{const doc=V3.base.html(raw),cell=doc.querySelector('div.a-span6:nth-child(1) > table:nth-child(1) > tbody:nth-child(1) > tr:nth-child(4) > td:nth-child(2)');const value=V3.base.clean(cell?.textContent).split(',')[0],n=value.match(/\b(\d+)\b/)?.[1];return n?'P'+n:'PX';};
    async function floor(podValue){
      const pod=V3.base.upper(podValue.match?.(POD)?.[0]||podValue);if(!pod)return'PX';
      const mem=memory.get(pod);if(mem&&mem.expires>Date.now())return mem.floor;
      const saved=await store.get('floor.'+pod,null);if(saved?.expires>Date.now()){memory.set(pod,saved);return saved.floor;}
      let result='PX';for(let attempt=0;attempt<2;attempt++){try{result=parse((await V3.transport.page(hierarchyUrl(pod),{allowHtml:true,signal:life?.signal})).raw);if(result!=='PX')break;}catch(error){telemetry?.emit('bin.floor.error',{pod:V3.telemetry.mask(pod),attempt,message:String(error.message||error)});}if(attempt===0)await life.sleep(300);}
      const entry={floor:result,expires:shiftExpiry()};memory.set(pod,entry);await store.set('floor.'+pod,entry);return result;
    }
    return Object.freeze({floor,podOf:value=>V3.base.clean(value).match(POD)?.[0]?.toUpperCase()||''});
  }
  return Object.freeze({create});
})();

// ---- src/components/fcr-tote.js ----
V3.fcrTote=(()=>{
  function create({life,telemetry,client}={}){
    const panel=V3.ui.panel({id:'bwu2-v3-tote-panel',title:'V3 · Tote Audit',width:700,life});
    let mounted=false;
    const open=()=>{mount();panel.open();};

    function mount(){
      if(mounted)return;mounted=true;
      const state={container:'',loading:false,rows:[],lookup:new Map(),pending:[],scans:new Map(),seq:0,message:'Scan source container'};
      const root=document.createElement('div');
      root.innerHTML='<section class="section"><div class="note" data-summary>Scan tsX/csX to begin.</div><label class="field" style="margin-top:8px">Scanner<input data-scan autocomplete="off"></label><div class="row"><button class="btn" data-reset>NEW TOTE</button></div><div class="note" data-msg style="margin-top:8px"></div></section><section class="section"><b>Physical scans</b><div data-scans style="margin-top:7px"></div></section><section class="section"><b>System inventory</b><div data-system style="margin-top:7px"></div></section>';
      panel.set(root);
      const q=s=>root.querySelector(s),scan=q('[data-scan]');

      const buildLookup=rows=>{
        const map=new Map();
        for(const row of rows){
          row._scan=0;
          for(const value of [row.asin,row.fnsku,row.fcsku]){
            const key=V3.base.upper(value);if(!key)continue;
            if(!map.has(key))map.set(key,[]);
            map.get(key).push(row);
          }
        }
        return map;
      };
      const allocate=(rows,count=1)=>{
        let remaining=count;
        for(const row of rows){
          if(remaining<=0)break;
          const available=Math.max(0,Number(row.qty||0)-Number(row._scan||0));
          const add=Math.min(available,remaining);
          row._scan+=add;remaining-=add;
        }
      };
      const matches=(product,raw)=>{
        const strict=/^(?:X0|ZZ)[A-Z0-9]{8}$/i.test(raw);
        const keys=(strict?[raw]:[raw,product?.asin,product?.isbn,product?.fnsku,product?.fcsku]).map(V3.base.upper).filter(Boolean);
        const out=[],seen=new Set();
        for(const key of keys){
          for(const row of state.lookup.get(key)||[]){
            const id=[row.container,row.asin,row.fnsku,row.fcsku,row.disposition].join('|');
            if(seen.has(id))continue;
            seen.add(id);out.push(row);
          }
        }
        return out;
      };

      const paint=()=>{
        const total=state.rows.reduce((sum,row)=>sum+Number(row.qty||0),0);
        const scanned=state.rows.reduce((sum,row)=>sum+Number(row._scan||0),0);
        q('[data-summary]').textContent=(state.container||'NO CONTAINER')+' · '+scanned+'/'+total+' units';
        q('[data-msg]').textContent=state.message;
        q('[data-scans]').innerHTML=[...state.scans.values()].reverse().map(rec=>
          '<div style="padding:6px;border-bottom:1px solid #39475b"><button class="btn" data-print="'+V3.base.esc(rec.raw)+'">'+V3.base.esc(rec.raw)+(rec.count>1?' ×'+rec.count:'')+'</button> · <span class="'+(rec.state==='found'?'ok':rec.state==='missing'?'bad':'warn')+'">'+rec.state.toUpperCase()+'</span></div>'
        ).join('')||'<div class="note">No scans.</div>';
        q('[data-system]').innerHTML=state.rows.map(row=>
          '<div style="padding:5px;border-bottom:1px solid #39475b"><b>'+V3.base.esc(row.fnsku||row.fcsku||row.asin||'—')+'</b> · '+Number(row._scan||0)+'/'+Number(row.qty||0)+' · '+V3.base.esc(row.title||row.asin||'')+'</div>'
        ).join('')||'<div class="note">No inventory loaded.</div>';
        for(const button of q('[data-scans]').querySelectorAll('[data-print]')){
          button.onclick=async()=>{
            const rec=state.scans.get(V3.base.upper(button.dataset.print));
            try{await V3.print.barcode(rec.raw,{description:rec.product?.title||'',telemetry});state.message='Printed '+rec.raw;}
            catch(error){state.message='Print failed: '+error.message;}
            paint();
          };
        }
      };

      const load=async code=>{
        const seq=++state.seq;
        state.container=code;state.loading=true;state.rows=[];state.lookup=new Map();state.pending=[];state.scans.clear();state.message='Loading full inventory…';paint();
        try{
          const result=await client.inventory(code,{allowPartial:false,onPreview:preview=>{if(seq===state.seq){state.message='Loading inventory page '+preview.pages;paint();}}});
          if(seq!==state.seq)return;
          state.rows=result.rows;state.lookup=buildLookup(result.rows);state.loading=false;state.message='Ready';
          const queued=state.pending.splice(0);paint();
          for(const value of queued)await handle(value);
        }catch(error){
          if(seq===state.seq){state.loading=false;state.message='Inventory failed: '+error.message;paint();}
        }
      };

      const handle=async value=>{
        const raw=V3.base.clean(value);if(!raw)return;
        if(!state.container){
          if(!V3.base.container(raw)){state.message='SCAN SOURCE CONTAINER FIRST';paint();return;}
          return load(raw);
        }
        if(V3.base.container(raw)&&V3.base.upper(raw)!==V3.base.upper(state.container))return load(raw);
        if(state.loading){state.pending.push(raw);state.message='Queued '+state.pending.length+' scan(s)';paint();return;}

        const key=V3.base.upper(raw),existing=state.scans.get(key);
        if(existing){existing.count++;allocate(existing.matches);state.message=raw+' ×'+existing.count;paint();return;}

        const rec={raw,count:1,state:'checking',matches:[],product:null};
        state.scans.set(key,rec);paint();
        try{
          let product=null;try{product=await client.product(raw);}catch{}
          rec.product=product;rec.matches=matches(product,raw);rec.state=rec.matches.length?'found':'missing';
          if(rec.matches.length)allocate(rec.matches);
          state.message=rec.matches.length?'IN '+state.container:'NOT IN '+state.container;
          telemetry?.emit('tote.scan',{code:V3.telemetry.mask(raw),found:Boolean(rec.matches.length)});
        }catch(error){rec.state='error';state.message=error.message;}
        paint();
      };

      scan.onkeydown=async event=>{
        if(event.key!=='Enter')return;
        event.preventDefault();
        const value=scan.value;scan.value='';
        await handle(value);
        scan.focus({preventScroll:true});
      };
      q('[data-reset]').onclick=()=>{
        state.seq++;
        Object.assign(state,{container:'',loading:false,rows:[],lookup:new Map(),pending:[],scans:new Map(),message:'Scan source container'});
        paint();scan.focus();
      };
      paint();
    }

    return Object.freeze({open});
  }
  return Object.freeze({create});
})();

// ---- src/components/fcr-bin.js ----
V3.fcrBin=(()=>{
  function create({life,telemetry,client,bin,current}={}){
    const panel=V3.ui.panel({id:'bwu2-v3-bin-panel',title:'V3 · Bin Check',width:760,life});
    const state={rows:[],floors:new Map(),filter:new Set(['P2','P3','P4']),message:''};
    let mounted=false;

    const open=()=>{mount();panel.open();};

    function mount(){
      if(mounted)return;mounted=true;
      const root=document.createElement('div');
      root.innerHTML='<section class="section"><div class="row"><button class="btn primary" data-snapshot>LOAD FULL INVENTORY</button><button class="btn" data-copy>COPY VISIBLE TSV</button><button class="btn" data-f="P2">P2</button><button class="btn" data-f="P3">P3</button><button class="btn" data-f="P4">P4</button></div><div class="note" data-msg style="margin-top:8px">No inventory loaded.</div></section><section class="section"><div data-list></div></section>';
      panel.set(root);
      const q=s=>root.querySelector(s);

      const conflictKeys=()=>{
        const groups=new Map();
        for(const row of state.rows){
          const key=V3.base.upper(row.container)+'|'+V3.base.upper(row.fnsku);
          if(!groups.has(key))groups.set(key,new Set());
          if(row.fcsku)groups.get(key).add(V3.base.upper(row.fcsku));
        }
        return new Set([...groups].filter(([,values])=>values.size>1).map(([key])=>key));
      };
      const visibleRows=()=>state.rows.filter(row=>{
        const pod=bin.podOf(row.container),floor=pod?state.floors.get(pod)||'PX':'PX';
        return !/^P[234]$/.test(floor)||state.filter.has(floor);
      });

      const paint=()=>{
        q('[data-msg]').textContent=state.message||state.rows.length+' row(s)';
        for(const button of root.querySelectorAll('[data-f]'))button.classList.toggle('primary',state.filter.has(button.dataset.f));
        const conflicts=conflictKeys();
        q('[data-list]').innerHTML=visibleRows().map(row=>{
          const pod=bin.podOf(row.container),floor=pod?state.floors.get(pod)||'…':'—';
          const conflict=conflicts.has(V3.base.upper(row.container)+'|'+V3.base.upper(row.fnsku));
          return '<div style="padding:7px;border-bottom:1px solid #39475b;'+(conflict?'border-left:5px solid #ff7068;padding-left:8px':'')+'"><span class="note">'+V3.base.esc(floor)+'</span> · <button class="btn" data-print="'+V3.base.esc(row.container)+'">'+V3.base.esc(row.container||'—')+'</button> · <button class="btn" data-print="'+V3.base.esc(row.fnsku)+'">'+V3.base.esc(row.fnsku||'—')+'</button> · '+V3.base.esc(row.fcsku||'—')+' · Q'+Number(row.qty||0)+'</div>';
        }).join('')||'<div class="note">No matching rows.</div>';
        for(const button of q('[data-list]').querySelectorAll('[data-print]')){
          button.onclick=async event=>{
            if(!event.altKey)return;
            try{await V3.print.barcode(button.dataset.print,{telemetry});state.message='Printed '+button.dataset.print;}
            catch(error){state.message='Print failed: '+error.message;}
            paint();
          };
        }
      };

      q('[data-snapshot]').onclick=async()=>{
        try{
          const search=current();if(!search)throw new Error('Search something in FCResearch first');
          state.message='Loading full inventory…';paint();
          const inventory=await client.inventory(search,{allowPartial:false});
          state.rows=inventory.rows;state.floors.clear();state.message='Resolving floors…';paint();
          const pods=[...new Set(state.rows.map(row=>bin.podOf(row.container)).filter(Boolean))];
          let cursor=0;
          const worker=async()=>{while(cursor<pods.length){const pod=pods[cursor++];state.floors.set(pod,await bin.floor(pod));paint();}};
          await Promise.all(Array.from({length:Math.min(8,pods.length)},worker));
          state.message='Ready · Alt-click container/FNSKU to print';paint();
          telemetry?.emit('bin.ready',{rows:state.rows.length,pods:pods.length});
        }catch(error){state.message='Bin Check failed: '+error.message;paint();}
      };
      for(const button of root.querySelectorAll('[data-f]'))button.onclick=()=>{state.filter.has(button.dataset.f)?state.filter.delete(button.dataset.f):state.filter.add(button.dataset.f);paint();};
      q('[data-copy]').onclick=()=>{
        const rows=visibleRows();
        const text=['Floor\tContainer\tASIN\tFNSKU\tFCSKU\tQty',...rows.map(row=>{
          const pod=bin.podOf(row.container),floor=pod?state.floors.get(pod)||'PX':'';
          return[floor,row.container,row.asin,row.fnsku,row.fcsku,row.qty].join('\t');
        })].join('\n');
        if(typeof GM_setClipboard==='function')GM_setClipboard(text,'text');else navigator.clipboard?.writeText(text);
        state.message='Copied '+rows.length+' visible row(s)';paint();
      };
      paint();
    }

    return Object.freeze({open});
  }
  return Object.freeze({create});
})();

// ---- src/components/fcr-pandash.js ----
V3.fcrPandash=(()=>{
  function create({life,client,pandash,current}={}){
    const panel=V3.ui.panel({id:'bwu2-v3-pandash-panel',title:'V3 · Pandash',width:500,life});
    let mounted=false;
    const open=()=>{mount();panel.open();};

    function mount(){
      if(mounted)return;mounted=true;
      const root=document.createElement('div');
      root.innerHTML='<section class="section"><label class="field">ASIN<input data-asin></label><button class="btn primary" data-run>CHECK</button><div class="note" data-result style="margin-top:9px"></div></section>';
      panel.set(root);
      const input=root.querySelector('[data-asin]'),result=root.querySelector('[data-result]');
      input.value=/^B[A-Z0-9]{9}$/i.test(current())?current():'';
      root.querySelector('[data-run]').onclick=async()=>{
        try{
          let asin=V3.base.upper(input.value);
          if(!asin){
            const product=await client.product(current());
            asin=V3.base.upper(product?.asin);input.value=asin;
          }
          if(!/^B[A-Z0-9]{9}$/.test(asin))throw new Error('Valid ASIN required');
          const check=await pandash.check(asin);
          result.className='note '+(check.allowed?'ok':'bad');
          result.textContent='L'+check.level+' · '+check.message;
        }catch(error){result.className='note bad';result.textContent=error.message;}
      };
    }

    return Object.freeze({open});
  }
  return Object.freeze({create});
})();

// ---- src/components/fcr-move.js ----
V3.fcrMove=(()=>{
  function create({life,telemetry,current}={}){
    const panel=V3.ui.panel({id:'bwu2-v3-fcr-move-panel',title:'V3 · MoveContainer',width:500,life});
    let mounted=false;
    const open=()=>{mount();panel.open();};

    function mount(){
      if(mounted)return;mounted=true;
      const root=document.createElement('div');
      root.innerHTML='<section class="section"><label class="field">Container<input data-container></label><div class="grid"><label class="field">Floor<select data-floor>'+V3.moveContainer.FLOORS.map(x=>'<option>'+x+'</option>').join('')+'</select></label><label class="field">Drop<select data-drop></select></label></div><button class="btn primary" data-run>MOVE</button><div class="note" data-msg style="margin-top:8px"></div></section>';
      panel.set(root);
      const container=root.querySelector('[data-container]'),floor=root.querySelector('[data-floor]'),drop=root.querySelector('[data-drop]'),message=root.querySelector('[data-msg]');
      container.value=V3.base.container(current())?current():'';
      floor.value='P2';
      const paintDrops=()=>{drop.innerHTML=V3.moveContainer.choices(floor.value).map(([name])=>'<option>'+V3.base.esc(name)+'</option>').join('');};
      floor.onchange=paintDrops;paintDrops();
      root.querySelector('[data-run]').onclick=async()=>{
        try{
          message.className='note warn';message.textContent='MOVING…';
          await V3.moveContainer.move(container.value,V3.moveContainer.destination(floor.value,drop.value),{telemetry});
          message.className='note ok';message.textContent='MOVED';
        }catch(error){
          message.className='note '+(error?.outcome==='unknown'?'bad':'warn');
          message.textContent=(error?.outcome==='unknown'?'OUTCOME UNKNOWN — VERIFY · ':'')+error.message;
        }
      };
    }

    return Object.freeze({open});
  }
  return Object.freeze({create});
})();

// ---- src/components/fcr-unbind.js ----
V3.fcrUnbind=(()=>{
  function create({life,telemetry,current}={}){
    const panel=V3.ui.panel({id:'bwu2-v3-fcr-unbind-panel',title:'V3 · Unbind',width:500,life});
    let mounted=false;
    const open=()=>{mount();panel.open();};

    function mount(){
      if(mounted)return;mounted=true;
      const root=document.createElement('div');
      root.innerHTML='<section class="section"><label class="field">Container<input data-container></label><button class="btn primary" data-run>UNBIND</button><div class="note" data-msg style="margin-top:8px"></div></section>';
      panel.set(root);
      const container=root.querySelector('[data-container]'),message=root.querySelector('[data-msg]');
      container.value=V3.base.container(current())?current():'';
      root.querySelector('[data-run]').onclick=async()=>{
        try{
          const pageWindow=typeof unsafeWindow==='object'&&unsafeWindow?unsafeWindow:window;
          const login=V3.identity.resolve({pageWindow}).login;
          if(!login)throw new Error('Authenticated employee identity unavailable');
          message.className='note warn';message.textContent='UNBINDING…';
          await V3.hierarchy.unbind(container.value,login,{telemetry});
          message.className='note ok';message.textContent='UNBOUND';
        }catch(error){
          message.className='note '+(error?.outcome==='unknown'?'bad':'warn');
          message.textContent=(error?.outcome==='unknown'?'OUTCOME UNKNOWN — VERIFY · ':'')+error.message;
        }
      };
    }

    return Object.freeze({open});
  }
  return Object.freeze({create});
})();

// ---- src/apps/fcr/index.js ----
V3.boot=()=>{
  const life=V3.lifecycle.create('fcr-toolkit');
  const telemetry=V3.telemetry.create('fcr',V3.build.version);
  const client=V3.fcr.create({telemetry,life});
  const bin=V3.bincheck.create({telemetry,life});
  const pandash=V3.pandash.create({telemetry,warehouse:()=>V3.fcr.warehouse()||'BWU2'});
  const current=()=>V3.base.clean(new URLSearchParams(location.search).get('s'));

  const tools=[
    ['fcr-tote','TOTE','Tote Audit',V3.fcrTote.create({life,telemetry,client})],
    ['fcr-bin','BIN','Bin Check',V3.fcrBin.create({life,telemetry,client,bin,current})],
    ['fcr-pandash','PANDASH','Pandash',V3.fcrPandash.create({life,client,pandash,current})],
    ['fcr-move','MOVE CONTAINER','MoveContainer',V3.fcrMove.create({life,telemetry,current})],
    ['fcr-unbind','UNBIND','Unbind container',V3.fcrUnbind.create({life,telemetry,current})]
  ];

  for(const [id,label,title,tool] of tools)V3.ui.dockButton({id,label,title,onClick:tool.open});

  V3.ui.dockButton({
    id:'fcr-iss',
    label:'ISS',
    title:'Open standalone V3 ISS Console',
    onClick:()=>{
      const url='https://aft-poirot-website-nrt.nrt.proxy.amazon.com/#iss-console';
      if(typeof GM_openInTab==='function')GM_openInTab(url,{active:true,insert:true});
      else window.open(url,'_blank','noopener');
    }
  });
};

if(typeof V3.boot!=='function')throw new Error('V3 boot missing');
V3.boot();
})();
