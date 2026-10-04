// ==UserScript==
// @name         V3 | BWU2 Sideline
// @name:en      V3 | BWU2 Sideline
// @namespace    https://github.com/1Sirkkris/-tampermonkey-v2/v3-relaunch
// @version      0.1.0
// @description  Native Poirot Sideline helper using the same engine as ISS Console.
// @match        https://aft-poirot-website-nrt.nrt.proxy.amazon.com/*
// @run-at       document-body
// @noframes
// @grant        GM_xmlhttpRequest
// @connect      aft-poirot-website-nrt.nrt.proxy.amazon.com
// @connect      pandash.amazon.com
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-relaunch/v3/dist/V3_Sideline.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-relaunch/v3/dist/V3_Sideline.user.js
// @v3-build     sideline-0.1.0-aa7f1935
// ==/UserScript==

(()=>{
'use strict';
const V3=Object.create(null);
V3.build=Object.freeze({"id":"sideline-0.1.0-aa7f1935","version":"0.1.0","suite":"sideline"});

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

// ---- src/services/sideline.js ----
V3.sideline=(()=>{
  const ORIGIN='https://aft-poirot-website-nrt.nrt.proxy.amazon.com',TOOL='V3';
  const API={bootstrap:'/api/get-bootstrap-data',source:'/api/scan-source-container',item:'/api/scanitem',move:'/api/move-items',close:'/api/close-container'};
  const requestId=()=> 'amzn1.fc.v1.common.request-id.v1.AFTPoirotWebsite.'+(crypto?.randomUUID?.()||Date.now()+'-'+Math.random().toString(16).slice(2));
  const sourcePayload=container=>({containerScannableId:container,requestId:requestId(),tool:TOOL});
  const itemPayload=(source,barcode)=>({containerScannableId:source,itemBarcode:barcode,isMasterpack:null,itemAndonContext:null,requestId:requestId(),tool:TOOL});
  const closePayload=(container,empty)=>({containerScannableId:container,containerEmpty:empty===true,directedLabel:false,processPath:'UNDETERMINED',requestId:requestId(),tool:TOOL});
  const problems=r=>(Array.isArray(r?.problems)?r.problems:[]).map(p=>V3.base.clean(p?.description||p?.message||p?.reason||p?.code||p?.['@type']||'')).filter(Boolean);
  const hazmatRejected=r=>{if(!r||typeof r!=='object')return false;const f=r.filterResult||{},reason=f.reason||{},rr=r.reason||{},ps=problems(r),labels=[r.message,r.description,r.errorMessage,r.errorCode,typeof r.reason==='string'?r.reason:'',rr.type,rr.description,rr.message,rr['@type'],reason.type,reason.description,reason.message,reason['@type'],f.filterType,...ps].map(V3.base.clean).filter(Boolean);return labels.some(x=>/hazmat|dangerous.?goods/i.test(x))&&(r.success===false||f.compatible===false||ps.length>0||r.errorMessage||r.errorCode||/error|reject|incompat|filter/i.test(V3.base.clean(r['@type'])));};
  const predicant=v=>{if(v==null)return false;if(typeof v==='string')return/predicant/i.test(v);if(Array.isArray(v))return v.some(predicant);if(typeof v!=='object')return false;return Object.entries(v).some(([k,x])=>(/predicant/i.test(k)&&(x===true||(typeof x==='string'&&x&&!/^false$/i.test(x))))||predicant(x));};
  const damaged=r=>r?.filterResult?.compatible===false&&(r.filterResult?.reason?.containerDamaged===true||V3.base.lower(r.filterResult?.reason?.['@type'])==='damageditemsfilterresultreason'||/damageditemsfilter/i.test(V3.base.clean(r.filterResult?.filterType)));
  const overageLabel=v=>/\boverage(?:s)?\b|\bitem\s+not\s+in\s+(?:source\s+)?container\b|\bnot\s+in\s+source\s+container\b/i.test(V3.base.clean(v));
  const allowedOverage=r=>{if(!r||typeof r!=='object')return false;const type=V3.base.clean(r['@type']);if(type==='InvalidBarcodeResponse'||type==='RequestMultipleBarcodesResponse'||hazmatRejected(r)||predicant(r)||damaged(r))return false;const f=r.filterResult,fr=V3.base.clean(f?.reason?.type||f?.reason?.description||f?.reason?.message||f?.reason?.['@type']||f?.filterType||''),ps=problems(r);if(f?.compatible===false&&!overageLabel(fr))return false;if(ps.some(x=>!overageLabel(x)))return false;const diag=[r.message,r.description,r.errorMessage,r.errorCode,fr,...ps].map(V3.base.clean).filter(Boolean);return(overageLabel(type)||diag.some(overageLabel))&&!/hazmat|dangerous.?goods|invalid\s+barcode|incompatib|damaged|predicant|customer\s*bound/i.test([type,...diag].join(' '));};
  const resolve=(r,barcode)=>{const type=V3.base.clean(r?.['@type']),overage=allowedOverage(r);if(!r||type==='InvalidBarcodeResponse'||(r.success===false&&!overage))return{ok:false,invalid:type==='InvalidBarcodeResponse',type:type||'Unknown'};const records=(Array.isArray(r.items)?r.items:[]).filter(x=>x?.skuDetail),item=records[0],sku=item?.skuDetail;if(!item||!sku)return{ok:false,invalid:false,type:type||'Unknown'};return{ok:true,type,barcode,item,records,sku,asin:V3.base.clean(sku.asin),fnsku:V3.base.clean(sku.fnSku),fcsku:V3.base.clean(sku.fcSku),dateType:V3.base.clean(sku.datelotDetail?.expirationPromptType),dateDetail:sku.datelotDetail||{},hazmat:sku.hazmat===true,permissionLevel:V3.base.upper(sku.itemDropzoneRecommendation?.permissionLevel),overage,notInSource:type==='ItemNotInContainerResponse'||records.every(x=>Number(x.quantity)===0)};};
  const classify=(r,code)=>{const ctx=resolve(r,code),text=[r?.['@type'],r?.message,r?.description,r?.errorMessage,r?.errorCode,r?.filterResult?.filterType,r?.filterResult?.reason?.type,...problems(r)].map(V3.base.clean).join(' ');if(/damaged/i.test(text))return{kind:'red',reason:'DAMAGED / INCOMPATIBLE',ctx};if(hazmatRejected(r))return{kind:'red',reason:'HAZMAT / DANGEROUS GOODS',ctx};if(!ctx.ok)return{kind:'red',reason:ctx.invalid?'INVALID BARCODE':ctx.type==='RequestMultipleBarcodesResponse'?'MULTIPLE BARCODE MATCHES':ctx.type,ctx};if(ctx.permissionLevel==='UNDER_REVIEW')return{kind:'red',reason:'ASIN UNDER REVIEW — RIVER REQUIRED',ctx};if(ctx.dateType==='EXPIRATION_DATE'||ctx.dateType==='PRODUCTION_DATE')return{kind:'yellow',reason:ctx.dateType==='PRODUCTION_DATE'?'PRODUCTION DATE':'EXPIRY DATE',ctx};return{kind:'green',reason:'GOOD TO GO',ctx};};
  const movePayload=(source,dest,meta,ctx,qty,expirationMs)=>({itemExternalId:null,sourceContainerScannableId:source,destinationContainerScannableId:dest,scannableId:V3.base.clean(ctx.item.scannableId||ctx.barcode),quantity:String(Math.max(1,Number(qty)||1)),itemDetails:(ctx.records?.length?ctx.records:[ctx.item]).map(record=>({fcsku:V3.base.clean((record.skuDetail||ctx.sku).fcSku),quantity:Number(record.quantity)||0,consumerType:record.consumer??null,disposition:record.disposition??null,referenceId:record.referenceId??null,fnsku:V3.base.clean((record.skuDetail||ctx.sku).fnSku)})),foundProblems:[null,null,null],scannedSourceContainerAsDestination:false,datelotDetail:ctx.sku.datelotDetail||null,userEnteredExpirationDate:expirationMs,mlcCaptureDetail:{mlcClass:ctx.sku.mlcDetail?.mlcClass??'UNKNOWN',userEnteredLotCode:null,mlcMissing:ctx.sku.mlcDetail?.mlcMissing??false,mlcNotEnteredReason:null,mlcCaptureMethod:null},itemMovedToISS:false,candidatePurchaseOrders:[],packHierarchyDetail:null,itemAndonContext:null,processPath:meta?.processPath??'UNDETERMINED',requestId:requestId(),tool:TOOL});
  const reason=r=>hazmatRejected(r)?'HAZMAT':allowedOverage(r)?'OVERAGE':damaged(r)?'DESTINATION DAMAGED':predicant(r)?'PREDICANT':r?.filterResult?.compatible===false?V3.base.upper(r.filterResult?.reason?.type)||'DESTINATION INCOMPATIBLE':problems(r).join(', ')||V3.base.clean(r?.['@type']||'MOVE REJECTED').replace(/Response$/,'');
  function create({telemetry,pandash}={}){
    let warehousePromise=null;
    const call=(path,options={})=>location.origin===ORIGIN?V3.transport.page(path,options):V3.transport.gm(ORIGIN+path,options);
    const request=(path,body,options={})=>call(path,{method:'POST',body:JSON.stringify(body),headers:{'content-type':'application/json'},timeout:options.timeout||15000,allowHttpError:options.allowHttpError===true});
    const warehouse=async()=>{if(warehousePromise)return warehousePromise;warehousePromise=(async()=>{try{const r=await call(API.bootstrap+'?tool='+encodeURIComponent(TOOL),{timeout:8000});const info=r.data?.warehouseInfo,c=V3.base.upper((typeof info==='string'?info:'')||info?.warehouseId||info?.id||info?.warehouse||info?.fc||r.data?.warehouseId);if(c)return c;}catch{}return V3.base.upper(V3.fcr?.warehouse?.()||'BWU2');})();return warehousePromise;};
    const haz= pandash||V3.pandash.create({telemetry,warehouse:()=> 'BWU2'});
    const validateSource=async source=>{source=V3.base.clean(source);if(!V3.base.container(source))throw new Error('Source must be tsX/csX');const r=await request(API.source,sourcePayload(source));if(/customer\s*bound\s*shipment/i.test(JSON.stringify(r.data||{})))throw new Error('CUSTOMER-BOUND SHIPMENT');if(V3.base.clean(r.data?.['@type'])!=='ScanSourceContainerResponse'||r.data?.success!==true)throw new Error(V3.base.clean(r.data?.message||r.data?.description||r.data?.errorMessage||r.data?.['@type'])||'SOURCE VALIDATION FAILED');return r.data;};
    const preflight=async(source,barcode)=>{barcode=V3.base.clean(barcode);const r=await request(API.item,itemPayload(source,barcode),{allowHttpError:true}),base=classify(r.data,barcode);if(base.ctx?.ok&&base.ctx.hazmat&&base.kind!=='red'){try{const h=await haz.check(base.ctx.asin);if(!h.allowed)return{kind:'red',reason:'HAZMAT L'+h.level+' — NOT PROCESSABLE',ctx:base.ctx,hazmat:h};return{...base,reason:base.kind==='yellow'?base.reason:'HAZMAT L'+h.level+' — OK TO PROCESS',hazmat:h};}catch(error){return{kind:'retry',reason:'HAZMAT CHECK FAILED — '+String(error.message||error),ctx:base.ctx};}}return base;};
    const move=async({source,destination,sourceMeta,preflightResult,qty=1,expirationMs=null})=>{const ctx=preflightResult?.ctx;if(!ctx?.ok)throw new Error('Item context not moveable');const op=V3.operation.create({kind:'sideline-move',ref:ctx.barcode,telemetry});op.submitted({qty});let r;try{r=await request(API.move,movePayload(source,destination,sourceMeta,ctx,qty,expirationMs),{allowHttpError:true});}catch(error){op.unknown({reason:'transport'});throw new V3.operation.UnknownError('Move submitted; confirmation lost',{cause:error});}if(r.status>=500){op.unknown({status:r.status});throw new V3.operation.UnknownError('Move HTTP '+r.status+'; verify before retry');}const payload=r.data;if(!payload||typeof payload!=='object'){op.unknown({reason:'unexpected-response'});throw new V3.operation.UnknownError('Unexpected move confirmation');}if(allowedOverage(payload)||(r.status>=200&&r.status<300&&payload.success===true&&payload.filterResult?.compatible!==false&&!hazmatRejected(payload)&&!predicant(payload))){op.confirmed({status:r.status});return payload;}const why=reason(payload);op.rejected({reason:why,status:r.status});throw new V3.operation.RejectedError(why,{data:payload,recoverable:predicant(payload)||damaged(payload)});};
    const close=async(container,empty=true)=>{container=V3.base.clean(container);if(!V3.base.container(container))throw new Error('Container must be tsX/csX');const op=V3.operation.create({kind:'sideline-close',ref:container,telemetry});op.submitted();let r;try{r=await request(API.close,closePayload(container,empty),{allowHttpError:true});}catch(error){op.unknown({reason:'transport'});throw new V3.operation.UnknownError('Close submitted; confirmation lost',{cause:error});}if(r.status>=200&&r.status<300&&V3.base.clean(r.data?.['@type'])==='CloseContainerResponse'&&r.data?.success===true){op.confirmed();return r.data;}if(r.status>=500||!r.data){op.unknown({status:r.status});throw new V3.operation.UnknownError('Close not confirmed — verify before retry');}op.rejected({status:r.status});throw new V3.operation.RejectedError(V3.base.clean(r.data?.message||r.data?.['@type'])||'Close rejected');};
    const expiration=(ctx,date)=>{const entered=new Date(String(date)+'T00:00:00').getTime();if(!Number.isFinite(entered))throw new Error('Invalid date');return{enteredMs:entered,finalExpirationMs:ctx.dateType==='PRODUCTION_DATE'?entered+Number(ctx.dateDetail?.shelfLife||0):entered};};
    return Object.freeze({warehouse,validateSource,preflight,move,close,expiration});
  }
  return Object.freeze({create,classify,resolve,allowedOverage,hazmatRejected});
})();

// ---- src/components/sideline-ui.js ----
V3.sidelineUi=(()=>{
  function mount(root,{engine,title='Sideline'}={}){
    const state={source:'',destination:'',items:'',lookups:new Map(),queue:[],active:0,generation:0,running:false,paused:false,stop:false,clearSource:true,delay:true,expiry:null,dates:new Map(),aside:new Map(),attention:'',done:false};
    root.innerHTML='<section class="section"><b>'+V3.base.esc(title)+'</b><div class="grid" style="margin-top:9px"><label class="field">Source<input data-source></label><label class="field">Destination<input data-dest></label></div><label class="field">Item barcodes<textarea data-items></textarea></label><div class="row"><span class="ok" data-good>0 GOOD</span><span class="warn" data-date>0 DATE</span><span class="bad" data-aside>0 ASIDE</span><span class="note" data-check>0 CHECKING</span></div><div class="row" style="margin-top:9px"><button class="btn" data-clear>CLEAR SOURCE: ON</button><button class="btn" data-delay>DELAY: ON</button><button class="btn" data-pause hidden>PAUSE</button></div><div class="row" style="margin-top:9px"><button class="btn primary" data-run>RUN</button><button class="btn danger" data-stop>STOP AFTER CURRENT</button></div><div class="note" data-msg style="margin-top:8px"></div><div class="bad" data-attention style="margin-top:8px"></div></section><section class="section"><b>Preflight</b><div data-list style="margin-top:8px"></div></section>';
    const q=s=>root.querySelector(s),source=q('[data-source]'),dest=q('[data-dest]'),items=q('[data-items]'),list=q('[data-list]'),msg=q('[data-msg]'),attention=q('[data-attention]');
    const parsed=()=>{const map=new Map();for(const line of String(state.items||'').split(/\r?\n/)){const code=V3.base.clean(line.split(/\s+/)[0]);if(!code)continue;const key=V3.base.upper(code),entry=map.get(key)||{code,qty:0};entry.qty++;map.set(key,entry);}return[...map.values()];};
    const key=code=>V3.base.upper(state.source)+'|'+V3.base.upper(code);
    const reset=()=>{state.generation++;state.lookups.clear();state.queue=[];state.active=0;state.expiry=null;state.dates.clear();state.aside.clear();state.done=false;};
    const status=(text,tone='')=>{msg.className='note '+tone;msg.textContent=text;};
    const schedule=()=>{if(state.running||!V3.base.container(state.source))return;for(const item of parsed()){const k=key(item.code);if(state.lookups.has(k))continue;const e={key:k,code:item.code,generation:state.generation,state:'queued',result:null,error:''};state.lookups.set(k,e);state.queue.push(e);}pump();paint();};
    const pump=()=>{while(!state.running&&state.active<5&&state.queue.length){const e=state.queue.shift();if(!e||e.generation!==state.generation)continue;state.active++;e.state='checking';paint();engine.preflight(state.source,e.code).then(result=>{if(e.generation!==state.generation)return;e.result=result;e.state=result.kind;if(result.kind==='red')state.aside.set(V3.base.upper(e.code),result.reason);if(result.kind==='retry')e.error=result.reason;}).catch(error=>{if(e.generation===state.generation){e.state='retry';e.error=String(error.message||error);}}).finally(()=>{state.active--;pump();paint();});}};
    const settle=async()=>{schedule();const start=Date.now();while(state.active||state.queue.length){if(Date.now()-start>30000)throw new Error('Preflight did not settle');await new Promise(r=>setTimeout(r,60));}for(const item of parsed()){const e=state.lookups.get(key(item.code));if(!e||['queued','checking','retry'].includes(e.state))throw new Error(e?.error||'Preflight incomplete: '+item.code);if(e.state==='yellow'&&!state.dates.has(V3.base.upper(item.code)))throw new Error('Date required: '+item.code);}return parsed();};
    const paint=()=>{
      let good=0,date=0,aside=0,checking=0;const rows=[];
      for(const item of parsed()){const e=state.lookups.get(key(item.code)),st=e?.state||'checking';if(st==='green')good+=item.qty;else if(st==='yellow')date+=item.qty;else if(st==='red')aside+=item.qty;else checking+=item.qty;
        let extra='';
        if(st==='yellow'&&!state.dates.has(V3.base.upper(item.code)))extra='<div class="row" style="margin-top:5px"><input class="input" type="date" data-exp="'+V3.base.esc(item.code)+'"><button class="btn" data-apply="'+V3.base.esc(item.code)+'">APPLY</button></div>';
        rows.push('<div style="padding:7px;border-bottom:1px solid #39475b"><div class="row"><b>'+V3.base.esc(item.code)+' ×'+item.qty+'</b><span class="'+(st==='green'?'ok':st==='yellow'?'warn':st==='red'?'bad':'note')+'">'+st.toUpperCase()+'</span></div><div class="note">'+V3.base.esc(e?.result?.reason||e?.error||'CHECKING')+'</div>'+extra+'</div>');
      }
      q('[data-good]').textContent=good+' GOOD';q('[data-date]').textContent=date+' DATE';q('[data-aside]').textContent=aside+' ASIDE';q('[data-check]').textContent=checking+' CHECKING';list.innerHTML=rows.join('')||'<div class="note">Enter source + items to preflight.</div>';
      for(const button of list.querySelectorAll('[data-apply]'))button.onclick=()=>{const code=button.dataset.apply,e=state.lookups.get(key(code)),input=list.querySelector('[data-exp="'+CSS.escape(code)+'"]');try{const chosen=engine.expiration(e.result.ctx,input.value);if(state.expiry!=null&&state.expiry!==chosen.finalExpirationMs){state.aside.set(V3.base.upper(code),'MIXED EXPIRY — NEXT WORKFLOW');e.state='red';e.result={...e.result,kind:'red',reason:'MIXED EXPIRY — NEXT WORKFLOW'};}else{if(state.expiry==null)state.expiry=chosen.finalExpirationMs;state.dates.set(V3.base.upper(code),chosen);}paint();}catch(error){status(String(error.message||error),'bad');}};
      attention.innerHTML=state.attention?'<b>'+V3.base.esc(state.attention)+'</b><br><button class="btn danger" data-ack style="margin-top:6px">I VERIFIED IT · CLEAR ATTENTION</button>':'';attention.querySelector('[data-ack]')?.addEventListener('click',()=>{state.attention='';reset();paint();status('Attention cleared after verification');});
      q('[data-run]').disabled=Boolean(state.attention);
    };
    source.oninput=()=>{const next=V3.base.clean(source.value);if(V3.base.upper(next)!==V3.base.upper(state.source)){state.source=next;reset();}else state.source=next;schedule();};
    dest.oninput=()=>{const next=V3.base.clean(dest.value);if(V3.base.upper(next)!==V3.base.upper(state.destination)){state.destination=next;reset();}else state.destination=next;};
    items.oninput=()=>{state.items=items.value;schedule();};
    q('[data-clear]').onclick=()=>{state.clearSource=!state.clearSource;q('[data-clear]').textContent='CLEAR SOURCE: '+(state.clearSource?'ON':'OFF');};
    q('[data-delay]').onclick=()=>{state.delay=!state.delay;q('[data-delay]').textContent='DELAY: '+(state.delay?'ON':'OFF');};
    q('[data-pause]').onclick=()=>{state.paused=!state.paused;q('[data-pause]').textContent=state.paused?'RESUME':'PAUSE';};
    q('[data-stop]').onclick=()=>{state.stop=true;state.paused=false;status('STOP REQUESTED','warn');};
    q('[data-run]').onclick=async()=>{
      if(state.running)return;if(state.done)reset();state.stop=false;
      try{if(!V3.base.container(state.source)||!V3.base.container(state.destination))throw new Error('Source and destination must be tsX/csX');if(V3.base.upper(state.source)===V3.base.upper(state.destination))throw new Error('Source and destination cannot match');const all=await settle(),movable=all.filter(x=>!state.aside.has(V3.base.upper(x.code)));if(!movable.length)throw new Error('Nothing moveable');state.running=true;q('[data-pause]').hidden=false;status('Validating source','warn');const meta=await engine.validateSource(state.source);let moved=0,failed=0;
        for(let i=0;i<movable.length;i++){if(state.stop)throw new Error('Stopped before next item');while(state.paused&&!state.stop)await new Promise(r=>setTimeout(r,80));if(i>0&&state.delay)await new Promise(r=>setTimeout(r,2000+Math.floor(Math.random()*6001)));const item=movable[i],e=state.lookups.get(key(item.code)),chosen=state.dates.get(V3.base.upper(item.code));status((i+1)+'/'+movable.length+' '+item.code+' ×'+item.qty,'warn');try{await engine.move({source:state.source,destination:state.destination,sourceMeta:meta,preflightResult:e.result,qty:item.qty,expirationMs:chosen?.finalExpirationMs??null});moved+=item.qty;}catch(error){if(error?.outcome==='unknown'){state.attention='OUTCOME UNKNOWN — VERIFY '+item.code+' BEFORE RETRY';throw error;}failed+=item.qty;state.aside.set(V3.base.upper(item.code),String(error.message||error));}}
        if(state.clearSource&&failed===0&&state.aside.size===0)await engine.close(state.source,true);state.done=true;status('COMPLETE · moved '+moved+(failed?' · failed '+failed:''),failed?'warn':'ok');
      }catch(error){status((error?.outcome==='unknown'?'OUTCOME UNKNOWN — VERIFY · ':'')+String(error.message||error),error?.outcome==='unknown'?'bad':'warn');}
      finally{state.running=false;state.paused=false;q('[data-pause]').hidden=true;paint();}
    };
    paint();return Object.freeze({dispose:()=>{state.stop=true;state.paused=false;}});
  }
  return Object.freeze({mount});
})();

// ---- src/apps/sideline/index.js ----
V3.boot=()=>{
  if(location.hash==='#iss-console')return;
  const life=V3.lifecycle.create('sideline-native'),telemetry=V3.telemetry.create('sideline',V3.build.version);let ui=null;
  const panel=V3.ui.panel({id:'bwu2-v3-sideline-panel',title:'V3 · Sideline',width:680,life});
  const mount=()=>{if(ui)return;const pandash=V3.pandash.create({telemetry,warehouse:'BWU2'}),engine=V3.sideline.create({telemetry,pandash});ui=V3.sidelineUi.mount(panel.body,{engine,title:'Sideline'});};
  V3.ui.dockButton({id:'sideline',label:'SIDELINE',title:'V3 Sideline',onClick:()=>{mount();panel.open();}});
  V3.ui.dockButton({id:'iss-console',label:'ISS',title:'Open V3 ISS Console',onClick:()=>{location.hash='#iss-console';location.reload();}});
};

if(typeof V3.boot!=='function')throw new Error('V3 boot missing');
V3.boot();
})();
