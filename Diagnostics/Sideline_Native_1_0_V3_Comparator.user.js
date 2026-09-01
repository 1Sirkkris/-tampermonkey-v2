// ==UserScript==
// @name         DIAG v0.1.0 Sideline Native 1.0 vs V3 Comparator
// @namespace    BWU2
// @version      0.1.0
// @description  Read-only native Sideline capture for comparing a successful 1.0 cycle with a V3 failure.
// @match        https://aft-qt-jp.aka.nrt.corp.amazon.com/*
// @match        https://aft-poirot-website-nrt.nrt.proxy.amazon.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';
  if (window.__bwu2SidelineNativeComparator) return;
  window.__bwu2SidelineNativeComparator = true;

  const VERSION = '0.1.0';
  const MAX = 900;
  const SAVE = 'bwu2.sidelineNativeComparator.v1';
  const SENSITIVE = /(authorization|cookie|token|secret|password|passwd|session|csrf|xsrf|credential)/i;
  const MODE = /aft-qt-jp\.aka\.nrt\.corp\.amazon\.com$/i.test(location.hostname) ? 'SIDELINE_1_0' : 'SIDELINE_V3';

  let rows = [], seq = 0, netSeq = 0, cycle = '', recording = true;
  let box, title, body, toggle, collapsed = true;

  const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
  const clip = (v, n=18000) => {
    const s = String(v ?? '');
    return s.length <= n ? s : `${s.slice(0,n)}…[truncated ${s.length-n}]`;
  };
  const cycleId = () => `${MODE}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;

  function redact(v, depth=0) {
    if (depth > 7) return '[depth-limit]';
    if (v == null || typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v === 'string') return clip(v);
    if (Array.isArray(v)) return v.slice(0,150).map(x => redact(x, depth+1));
    if (typeof v === 'object') {
      const out = {}; let count = 0;
      for (const [k,x] of Object.entries(v)) {
        if (++count > 160) { out.__truncatedKeys = true; break; }
        out[k] = SENSITIVE.test(k) ? '[REDACTED]' : redact(x, depth+1);
      }
      return out;
    }
    return clip(v);
  }

  function parseBody(v) {
    if (v == null) return null;
    try {
      if (typeof v === 'string') { try { return redact(JSON.parse(v)); } catch { return clip(v); } }
      if (v instanceof URLSearchParams) return redact(Object.fromEntries(v.entries()));
      if (v instanceof FormData) {
        const out = {};
        for (const [k,x] of v.entries()) out[k] = typeof x === 'string' ? x : `[File ${x?.name || ''}]`;
        return redact(out);
      }
      if (v instanceof Blob) return `[Blob ${v.type || 'unknown'} ${v.size} bytes]`;
      if (v instanceof ArrayBuffer) return `[ArrayBuffer ${v.byteLength} bytes]`;
      if (ArrayBuffer.isView(v)) return `[${v.constructor?.name || 'TypedArray'} ${v.byteLength} bytes]`;
      return redact(v);
    } catch (e) { return `[body parse failed: ${e?.message || e}]`; }
  }

  function parseText(text) {
    const s = String(text ?? '');
    if (!s) return null;
    try { return redact(JSON.parse(s)); } catch { return clip(s); }
  }

  function uMeta(raw) {
    try {
      const u = new URL(String(raw || ''), location.href);
      return { url:clip(u.href,5000), host:u.host, path:`${u.pathname}${u.search}` };
    } catch { return { url:clip(raw,5000), host:'', path:clip(raw,3000) }; }
  }

  function save() {
    try { sessionStorage.setItem(SAVE, JSON.stringify({version:VERSION,mode:MODE,rows,seq,cycle,recording})); } catch {}
  }
  function restore() {
    try {
      const s = JSON.parse(sessionStorage.getItem(SAVE) || 'null');
      if (!s || s.version !== VERSION || s.mode !== MODE || !Array.isArray(s.rows)) return;
      rows = s.rows.slice(-MAX); seq = Number(s.seq)||0; cycle = s.cycle||''; recording = s.recording !== false;
    } catch {}
  }

  function add(kind, data={}, force=false) {
    if (!recording && !force) return;
    rows.push({ n:++seq, at:new Date().toISOString(), t:Math.round(performance.now()), mode:MODE, cycle, kind, ...redact(data) });
    if (rows.length > MAX) rows.splice(0, rows.length-MAX);
    save(); render();
  }

  function visible(el) {
    if (!(el instanceof Element) || !el.isConnected || el.hidden) return false;
    try { const s=getComputedStyle(el), r=el.getBoundingClientRect(); return s.display!=='none' && s.visibility!=='hidden' && r.width>0 && r.height>0; } catch { return false; }
  }
  function elMeta(el, value=false) {
    if (!(el instanceof Element)) return null;
    const type=clean(el.getAttribute('type')||el.tagName).toLowerCase();
    const out={tag:el.tagName,type,id:clip(el.id,200),name:clip(el.getAttribute('name')||'',200),placeholder:clip(el.getAttribute('placeholder')||'',300),aria:clip(el.getAttribute('aria-label')||'',300),text:clip(clean(el.innerText||el.textContent||''),500)};
    if (value) out.value = type === 'password' ? '[REDACTED]' : clip(el.value ?? el.textContent ?? '',2500);
    return out;
  }

  function snapshot(reason, extra={}) {
    if (!recording || !document.body) return;
    const root=document.querySelector('main,[role="main"],#root,#app')||document.body;
    const inputs=[...document.querySelectorAll('input,textarea,[contenteditable="true"]')].filter(visible).slice(0,25).map(x=>elMeta(x,true));
    const buttons=[...document.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"]')].filter(visible).slice(0,30).map(x=>elMeta(x,false));
    add('SCREEN',{reason,href:location.href,text:clip(clean(root.innerText||root.textContent||''),3000),inputs,buttons,...extra});
  }

  function start() {
    rows=[]; seq=0; cycle=cycleId(); recording=true;
    add('CYCLE_START',{href:location.href,userAgent:navigator.userAgent},true);
    setTimeout(()=>snapshot('start'),50); setCollapsed(true);
  }
  function stop() {
    if (recording) { snapshot('stop'); add('CYCLE_END',{href:location.href},true); }
    recording=false; save(); render(); setCollapsed(true);
  }
  function clear() { rows=[]; seq=0; cycle=''; recording=false; save(); render(); }

  function responseBody(id) { return rows.find(x=>x.kind==='NET_BODY' && x.id===id)?.body ?? null; }
  function summary() {
    const starts=new Map(), out=[];
    for (const r of rows) {
      if (r.kind==='NET_START') starts.set(r.id,r);
      if (r.kind==='NET_END') {
        const s=starts.get(r.id), req=s?.requestBody, keys=req&&typeof req==='object'&&!Array.isArray(req)?Object.keys(req).slice(0,18).join(','):'';
        const b=responseBody(r.id), sig=b==null?'':clip(clean(typeof b==='string'?b:JSON.stringify(b)),240);
        out.push(`${String(out.length+1).padStart(2,'0')} ${r.transport||'?'} ${r.method||s?.method||'?'} ${r.status??'ERR'} ${r.ms??'?'}ms ${r.host||s?.host||''}${r.path||s?.path||''}${keys?` | req:${keys}`:''}${sig?` | resp:${sig}`:''}`);
      }
    }
    return out;
  }
  function output() {
    return [`BWU2 SIDELINE NATIVE COMPARATOR v${VERSION}`,`Mode: ${MODE}`,`Cycle: ${cycle||'NONE'}`,`Page: ${location.href}`,`Recording: ${recording?'YES':'NO'}`,`Events: ${rows.length}`,'','NETWORK SEQUENCE',...summary(),'','FULL EVENT LOG',JSON.stringify(rows,null,2)].join('\n');
  }

  function button(label, fn) {
    const b=document.createElement('button'); b.textContent=label;
    b.style.cssText='padding:5px 8px;font:800 11px Arial;border:1px solid #94a3b8;border-radius:4px;background:#fff;color:#111827;cursor:pointer';
    b.onclick=e=>{e.stopPropagation();fn();}; return b;
  }
  function setCollapsed(v){collapsed=!!v;if(body)body.style.display=collapsed?'none':'block';if(toggle)toggle.textContent=collapsed?'+':'−';render();}
  function render(){if(!box)return;title.textContent=`SIDECMP ${MODE==='SIDELINE_1_0'?'1.0':'V3'} • ${recording?'REC':'STOP'} • ${rows.length}`;box.style.borderColor=recording?'#16a34a':'#64748b';}
  function mount(){
    if(box||!document.body)return;
    box=document.createElement('div'); box.id='bwu2-sidecmp'; box.style.cssText='position:fixed;right:8px;top:8px;z-index:2147483647;background:#fff;color:#111827;border:2px solid #16a34a;border-radius:6px;box-shadow:0 3px 12px #0004;padding:5px;font:11px Arial;max-width:390px';
    const h=document.createElement('div');h.style.cssText='display:flex;align-items:center;gap:5px';title=document.createElement('b');toggle=button('+',()=>setCollapsed(!collapsed));toggle.style.marginLeft='auto';h.append(title,toggle);
    body=document.createElement('div');body.style.cssText='display:none;margin-top:5px;border-top:1px solid #d1d5db;padding-top:5px';
    const c=document.createElement('div');c.style.cssText='display:flex;gap:4px;flex-wrap:wrap';
    const copy=button('Copy',async()=>{try{await navigator.clipboard.writeText(output());copy.textContent='Copied';setTimeout(()=>copy.textContent='Copy',900);}catch(e){add('DIAG_ERROR',{where:'clipboard',message:e?.message||String(e)},true);}});
    c.append(button('New Cycle',start),button('Stop',stop),copy,button('Snapshot',()=>snapshot('manual')),button('Clear',clear));
    const help=document.createElement('div');help.textContent='New Cycle before source scan → run native flow → Stop after SUCCESS/FAIL → Copy.';help.style.cssText='margin-top:5px;font-weight:700;color:#334155';
    body.append(c,help);box.append(h,body);document.body.appendChild(box);render();
  }

  const realFetch=window.fetch;
  if(typeof realFetch==='function') window.fetch=function(input,init){
    if(!recording)return realFetch.apply(this,arguments);
    const m=uMeta(typeof input==='string'?input:input?.url||''), method=clean(init?.method||(typeof input!=='string'?input?.method:'')||'GET').toUpperCase(), id=`f${++netSeq}`, captureCycle=cycle, started=performance.now();
    add('NET_START',{id,cycle:captureCycle,transport:'fetch',method,...m,requestBody:parseBody(init?.body)});
    if(init?.body==null && typeof Request!=='undefined' && input instanceof Request){try{input.clone().text().then(t=>add('NET_REQUEST_BODY',{id,cycle:captureCycle,body:parseText(t)},true)).catch(e=>add('NET_REQUEST_BODY',{id,cycle:captureCycle,body:`[read failed: ${e?.message||e}]`},true));}catch(e){add('NET_REQUEST_BODY',{id,cycle:captureCycle,body:`[clone failed: ${e?.message||e}]`},true);}}
    let p;try{p=realFetch.apply(this,arguments);}catch(e){add('NET_END',{id,cycle:captureCycle,transport:'fetch',method,...m,error:e?.message||String(e),ms:Math.round(performance.now()-started)},true);throw e;}
    return Promise.resolve(p).then(r=>{
      add('NET_END',{id,cycle:captureCycle,transport:'fetch',method,...m,status:r.status,ok:r.ok,ms:Math.round(performance.now()-started)},true);setTimeout(()=>snapshot('network-end',{id,path:m.path,status:r.status}),20);
      try{r.clone().text().then(t=>add('NET_BODY',{id,cycle:captureCycle,body:parseText(t)},true)).catch(e=>add('NET_BODY',{id,cycle:captureCycle,body:`[read failed: ${e?.message||e}]`},true));}catch(e){add('NET_BODY',{id,cycle:captureCycle,body:`[clone failed: ${e?.message||e}]`},true);}return r;
    },e=>{add('NET_END',{id,cycle:captureCycle,transport:'fetch',method,...m,error:e?.message||String(e),ms:Math.round(performance.now()-started)},true);setTimeout(()=>snapshot('network-error',{id,path:m.path,error:e?.message||String(e)}),20);throw e;});
  };

  const XHR=window.XMLHttpRequest;
  if(XHR?.prototype){const open=XHR.prototype.open,send=XHR.prototype.send,setHeader=XHR.prototype.setRequestHeader;
    XHR.prototype.open=function(method,url){this.__sidecmp=recording?{id:`x${++netSeq}`,cycle,method:clean(method).toUpperCase(),...uMeta(url),started:0,headers:{}}:null;return open.apply(this,arguments);};
    XHR.prototype.setRequestHeader=function(name,value){if(this.__sidecmp&&!SENSITIVE.test(name))this.__sidecmp.headers[clean(name).toLowerCase()]=clip(value,700);return setHeader.apply(this,arguments);};
    XHR.prototype.send=function(payload){const m=this.__sidecmp;if(!m||!recording)return send.apply(this,arguments);m.started=performance.now();add('NET_START',{id:m.id,cycle:m.cycle,transport:'xhr',method:m.method,url:m.url,host:m.host,path:m.path,requestHeaders:redact(m.headers),requestBody:parseBody(payload)});
      this.addEventListener('loadend',()=>{add('NET_END',{id:m.id,cycle:m.cycle,transport:'xhr',method:m.method,url:m.url,host:m.host,path:m.path,status:this.status,ok:this.status>=200&&this.status<300,ms:Math.round(performance.now()-m.started),responseType:this.responseType||'',responseURL:clip(this.responseURL||'',5000)},true);setTimeout(()=>{let b;try{b=!this.responseType||this.responseType==='text'?parseText(this.responseText):this.responseType==='json'?redact(this.response):`[${this.responseType} response]`;}catch(e){b=`[read failed: ${e?.message||e}]`;}add('NET_BODY',{id:m.id,cycle:m.cycle,body:b},true);snapshot('network-end',{id:m.id,path:m.path,status:this.status});},0);},{once:true});return send.apply(this,arguments);};
  }

  document.addEventListener('keydown',e=>{if(recording&&e.key==='Enter'){add('ENTER',{target:elMeta(e.target,true)});setTimeout(()=>snapshot('enter'),30);}},true);
  document.addEventListener('click',e=>{if(!recording)return;const t=e.target?.closest?.('button,[role="button"],a,input[type="button"],input[type="submit"]')||e.target;if(t?.closest?.('#bwu2-sidecmp'))return;add('CLICK',{target:elMeta(t,false)});setTimeout(()=>snapshot('click'),30);},true);
  window.addEventListener('error',e=>add('JS_ERROR',{message:e.message||e.error?.message||'error',source:clip(e.filename||'',3000),line:e.lineno||0,column:e.colno||0,stack:clip(e.error?.stack||'',8000)},true));
  window.addEventListener('unhandledrejection',e=>add('PROMISE_REJECTION',{message:e.reason?.message||String(e.reason),stack:clip(e.reason?.stack||'',8000)},true));

  function boot(){restore();if(!cycle)start();else add('PAGE_LOAD',{href:location.href},true);mount();setTimeout(()=>snapshot('page-load'),80);setTimeout(()=>{if(window.__sidelineApiMoveTest_v0201)add('ENV_WARNING',{message:'Custom Sideline helper detected. Disable it for a pure native comparison.'},true);},1200);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
