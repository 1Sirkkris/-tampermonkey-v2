// ==UserScript==
// @name         DIAG v0.1.0 RIVER Workflow Observability
// @namespace    https://github.com/1Sirkkris
// @version      0.1.0
// @description  Temporary RIVER workflow capture for inputs, navigation and fetch/XHR shape; secrets and identifiers are redacted/fingerprinted.
// @include      /^https?:\/\/(?:[^\/]*fcresearch[^\/]*|qifcr\.fe\.aftx\.amazonoperations\.app)\//
// @match        https://river.amazon.com/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Diagnostics/RIVER_Observability_Capture.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Diagnostics/RIVER_Observability_Capture.user.js
// ==/UserScript==

(() => {
  'use strict';
  const VERSION='0.1.0', KEY='bwu2:river-observability:v1', MAX=1200;
  const W=typeof unsafeWindow==='object'&&unsafeWindow?unsafeWindow:window;
  if(W.__BWU2_RIVER_OBS_V1__) return; W.__BWU2_RIVER_OBS_V1__=true;
  const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
  function hash(v){let h=2166136261;for(const c of String(v??'')){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return(h>>>0).toString(36);}
  const fp=(v,k='id')=>`<${k}#${hash(v)}:${String(v??'').length}>`;
  const secret=/authorization|cookie|credential|csrf|jwt|password|secret|session.?token|signature|token|x-amz|api.?key/i;
  function scrub(v,key=''){
    if(secret.test(key))return'<redacted>'; let s=clean(v);
    s=s.replace(/\b(?:ts|cs)x[A-Za-z0-9_-]+\b/gi,m=>fp(m,'container')).replace(/\b(?:B0|X0|ZZ)[A-Z0-9]{8}\b/gi,m=>fp(m,'item')).replace(/\b\d{8,14}\b/g,m=>fp(m,'numeric-id')).replace(/\bLPN[A-Z0-9_-]+\b/gi,m=>fp(m,'lpn'));
    return s.length>600?s.slice(0,600)+`…<${s.length}>`:s;
  }
  function safeUrl(raw){try{const u=new URL(String(raw||''),location.href);u.username='';u.password='';for(const[k,v]of[...u.searchParams])u.searchParams.set(k,/^(?:action|mode|page|sort|state|tab|type|view)$/i.test(k)?scrub(v,k):fp(v,`query:${k}`));return u.href;}catch{return scrub(raw);}}
  function sanitize(v,key='',depth=0){if(secret.test(key))return'<redacted>';if(v==null||typeof v==='boolean'||typeof v==='number')return v;if(typeof v==='string')return /url|href|uri/i.test(key)?safeUrl(v):scrub(v,key);if(depth>4)return'<max-depth>';if(Array.isArray(v))return v.slice(0,40).map(x=>sanitize(x,key,depth+1));if(typeof v==='object'){const o={};for(const[k,x]of Object.entries(v).slice(0,80))o[k]=sanitize(x,k,depth+1);return o;}return String(v);}
  function load(){try{return JSON.parse(GM_getValue(KEY,'[]'))||[];}catch{return[];}}
  function add(type,data={}){const list=load();list.push({at:new Date().toISOString(),type,page:safeUrl(location.href),data:sanitize(data)});if(list.length>MAX)list.splice(0,list.length-MAX);GM_setValue(KEY,JSON.stringify(list));render();}
  function classify(v){const s=clean(v);if(!s)return'empty';if(/^(?:B0|X0|ZZ)[A-Z0-9]{8}$/i.test(s))return'item';if(/^\d{1,7}$/.test(s))return'numeric';if(/^\d{8,14}$/.test(s))return'numeric-id';return'text';}
  function labelFor(el){if(!el)return'';const id=el.id;const label=id?document.querySelector(`label[for="${CSS.escape(id)}"]`):null;return scrub(el.getAttribute('aria-label')||el.getAttribute('title')||el.placeholder||label?.textContent||el.closest('label')?.textContent||'');}
  function bodyShape(body){let v=body;try{if(typeof body==='string'){try{v=JSON.parse(body);}catch{v=Object.fromEntries(new URLSearchParams(body));}}else if(body instanceof URLSearchParams)v=Object.fromEntries(body);else if(typeof FormData!=='undefined'&&body instanceof FormData)v=Object.fromEntries(body);}catch{}if(!v||typeof v!=='object'||Array.isArray(v))return{kind:typeof v};const out={kind:'object',keys:Object.keys(v).slice(0,40)};for(const[k,x]of Object.entries(v).slice(0,40)){if(secret.test(k))continue;const s=String(x??'');out[k]={kind:classify(s),length:s.length,value:/^(?:quantity|count|units|shipments|page)$/i.test(k)&&/^\d+$/.test(s)?Number(s):undefined};}return out;}
  function responseShape(text,ct=''){const raw=String(text??'');if(/json/i.test(ct)||/^\s*[\[{]/.test(raw)){try{const x=JSON.parse(raw);return Array.isArray(x)?{kind:'json-array',length:x.length}:{kind:'json-object',keys:Object.keys(x||{}).slice(0,40)};}catch{}}return{kind:'text',chars:raw.length};}

  function installNetwork(){
    try{const native=W.fetch;if(typeof native==='function'&&!native.__riverObs){const wrapped=async function(input,init={}){const url=typeof input==='string'||input instanceof URL?String(input):input?.url||'',method=String(init.method||input?.method||'GET').toUpperCase(),t=performance.now();try{const r=await native.apply(this,arguments),base={transport:'fetch',method,url:safeUrl(url),status:r.status,ok:r.ok,ms:Math.round(performance.now()-t),request:bodyShape(init.body)};void r.clone().text().then(x=>add('network',{...base,response:responseShape(x,r.headers.get('content-type')||'')})).catch(()=>add('network',base));return r;}catch(e){add('network.error',{transport:'fetch',method,url:safeUrl(url),ms:Math.round(performance.now()-t),error:scrub(e?.message||e)});throw e;}};wrapped.__riverObs=true;W.fetch=wrapped;}}
    catch(e){add('core.error',{area:'fetch',error:scrub(e?.message||e)});}
    try{const X=W.XMLHttpRequest;if(X?.prototype&&!X.prototype.__riverObs){const op=X.prototype.open,send=X.prototype.send;X.prototype.open=function(m,u){this.__river={method:String(m||'GET').toUpperCase(),url:String(u||'')};return op.apply(this,arguments)};X.prototype.send=function(body){const i=this.__river||{method:'GET',url:''},t=performance.now();this.addEventListener('loadend',()=>{const base={transport:'xhr',method:i.method,url:safeUrl(i.url),status:this.status,ok:this.status>=200&&this.status<300,ms:Math.round(performance.now()-t),request:bodyShape(body)};try{base.response=responseShape((!this.responseType||this.responseType==='text')?this.responseText:'',this.getResponseHeader('content-type')||'');}catch{}add('network',base);},{once:true});return send.apply(this,arguments)};X.prototype.__riverObs=true;}}
    catch(e){add('core.error',{area:'xhr',error:scrub(e?.message||e)});}
  }

  function actionInfo(el){return{tag:el?.tagName?.toLowerCase()||'',id:scrub(el?.id||''),name:scrub(el?.getAttribute?.('name')||''),role:el?.getAttribute?.('role')||'',type:el?.getAttribute?.('type')||'',label:labelFor(el)}}
  function installActions(){
    document.addEventListener('click',e=>{const el=e.target instanceof Element?e.target.closest('button,a[href],[role="button"],[role="radio"],[role="option"],input[type="button"],input[type="submit"]'):null;if(el)add('ui.click',{trusted:e.isTrusted,...actionInfo(el),text:scrub(clean(el.innerText||el.value||el.textContent).slice(0,100))});},true);
    document.addEventListener('change',e=>{const el=e.target;if(!(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement||el instanceof HTMLSelectElement))return;const v=el instanceof HTMLSelectElement?el.options[el.selectedIndex]?.text:el.value;add('ui.change',{trusted:e.isTrusted,...actionInfo(el),inputKind:classify(v),length:String(v??'').length,selected:el instanceof HTMLSelectElement?scrub(v):undefined,checked:'checked'in el?!!el.checked:undefined});},true);
    document.addEventListener('keydown',e=>{if(e.key!=='Enter')return;const el=e.target;if(!(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement))return;add('ui.enter',{trusted:e.isTrusted,...actionInfo(el),inputKind:classify(el.value),length:String(el.value||'').length});},true);
    window.addEventListener('bwu2-observability:event',e=>{let d=e.detail;try{if(typeof d==='string')d=JSON.parse(d);}catch{}if(d&&typeof d==='object')add('assistant',{event:d.type,data:d.data||{}});},true);
  }
  function installRoutes(){let last=location.href;for(const n of['pushState','replaceState']){try{const f=W.history[n];W.history[n]=function(){const b=location.href,r=f.apply(this,arguments),a=location.href;if(a!==b)add(`route.${n}`,{from:safeUrl(b),to:safeUrl(a)});last=a;return r;};}catch{}}for(const n of['hashchange','popstate','pagehide'])window.addEventListener(n,()=>{add(`page.${n}`,{from:safeUrl(last),to:safeUrl(location.href)});last=location.href;},true);}

  let ui;function download(){const events=load(),blob=new Blob([JSON.stringify({version:VERSION,exportedAt:new Date().toISOString(),events},null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`RIVER_Observability_${new Date().toISOString().replace(/[:.]/g,'-')}_${events.length}events.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
  function render(){if(!ui)return;ui.querySelector('[data-count]').textContent=`RIVER OBS ${load().length}/${MAX}`;}
  function mount(){if(document.getElementById('bwu2-river-obs'))return;ui=document.createElement('div');ui.id='bwu2-river-obs';ui.innerHTML='<button data-count>RIVER OBS 0/1200</button><button data-clear>Clear</button>';Object.assign(ui.style,{position:'fixed',right:'12px',bottom:'12px',zIndex:2147483646,padding:'5px',background:'#e2e8f0',border:'1px solid #64748b',borderRadius:'6px',font:'700 11px Arial'});ui.querySelectorAll('button').forEach(b=>Object.assign(b.style,{cursor:'pointer',margin:'2px'}));ui.querySelector('[data-count]').onclick=download;ui.querySelector('[data-clear]').onclick=()=>{GM_deleteValue(KEY);render();};(document.body||document.documentElement).append(ui);render();}

  add('page.start',{version:VERSION,host:location.hostname,path:location.pathname});installNetwork();installActions();installRoutes();if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
