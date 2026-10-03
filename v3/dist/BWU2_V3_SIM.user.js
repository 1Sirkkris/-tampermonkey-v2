// ==UserScript==
// @name         V3 | BWU2 SIM Toolbar
// @name:en      V3 | BWU2 SIM Toolbar
// @namespace    https://github.com/1Sirkkris/-tampermonkey-v2/v3
// @version      0.1.0
// @description  V3 SIM Markdown toolbar, snippets and image helpers.
// @match        https://t.corp.amazon.com/*
// @run-at       document-body
// @grant        none
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-rebuild/v3/dist/BWU2_V3_SIM.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-rebuild/v3/dist/BWU2_V3_SIM.user.js
// @v3-build     sim-0.1.0-e5609a75
// ==/UserScript==

(()=>{
'use strict';
const V3=Object.create(null);
V3.build=Object.freeze({"id":"sim-0.1.0-e5609a75","version":"0.1.0","suite":"sim"});

// ---- src/core/base.js ----
V3.base = (() => {
  const clean = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const upper = value => clean(value).toUpperCase();
  const lower = value => clean(value).toLowerCase();
  const esc = value => String(value ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  const id = prefix => String(prefix || 'op') + '-' + (crypto?.randomUUID?.() || (Date.now() + '-' + Math.random().toString(16).slice(2)));
  const validContainer = value => /^(?:ts|cs)x[0-9a-z_-]+$/i.test(clean(value));
  const lines = (value, options = {}) => {
    const dedupe = options.dedupe !== false;
    const out = [], seen = new Set();
    for (const raw of String(value ?? '').split(/\r?\n/)) {
      const v = clean(raw.split(/\s+/)[0]);
      if (!v) continue;
      const key = upper(v);
      if (dedupe && seen.has(key)) continue;
      seen.add(key); out.push(v);
    }
    return out;
  };
  const sleep = (ms, signal) => new Promise((resolve,reject) => {
    if (signal?.aborted) return reject(signal.reason || new DOMException('Aborted','AbortError'));
    const timer = setTimeout(done, Math.max(0, Number(ms) || 0));
    const abort = () => { clearTimeout(timer); reject(signal.reason || new DOMException('Aborted','AbortError')); };
    function done() { signal?.removeEventListener?.('abort', abort); resolve(); }
    signal?.addEventListener?.('abort', abort, { once:true });
  });
  const safeJson = raw => { try { return JSON.parse(String(raw || '')); } catch { return null; } };
  const parseHtml = html => new DOMParser().parseFromString(String(html || ''), 'text/html');
  return Object.freeze({ clean, upper, lower, esc, id, validContainer, lines, sleep, safeJson, parseHtml });
})();

// ---- src/core/lifecycle.js ----
V3.lifecycle = (() => {
  function create(name = 'module') {
    const controller = new AbortController();
    const disposers = new Set();
    let disposed = false;

    const own = fn => { if (typeof fn === 'function') disposers.add(fn); return fn; };
    const on = (target, type, listener, options = {}) => {
      if (disposed || !target?.addEventListener) return () => {};
      const opts = typeof options === 'boolean'
        ? { capture: options, signal: controller.signal }
        : { ...options, signal: controller.signal };
      target.addEventListener(type, listener, opts);
      return () => target.removeEventListener(type, listener, opts);
    };
    const observe = (target, callback, options) => {
      if (disposed || !target || typeof MutationObserver === 'undefined') return null;
      const observer = new MutationObserver(callback);
      observer.observe(target, options);
      own(() => observer.disconnect());
      return observer;
    };
    const timeout = (fn, ms) => {
      if (disposed) return 0;
      let cancel = null;
      const timer = setTimeout(() => {
        if (cancel) disposers.delete(cancel);
        if (!disposed) fn();
      }, Math.max(0, Number(ms) || 0));
      cancel = () => clearTimeout(timer);
      own(cancel);
      return timer;
    };
    const interval = (fn, ms) => {
      if (disposed) return 0;
      const timer = setInterval(() => { if (!disposed) fn(); }, Math.max(50, Number(ms) || 0));
      own(() => clearInterval(timer));
      return timer;
    };
    const sleep = ms => V3.base.sleep(ms, controller.signal);
    const child = label => {
      const nested = create(name + ':' + label);
      own(() => nested.dispose());
      return nested;
    };
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      controller.abort(name + ' disposed');
      for (const fn of [...disposers]) { try { fn(); } catch {} }
      disposers.clear();
    };

    return Object.freeze({
      name, signal: controller.signal, own, on, observe, timeout, interval, sleep, child, dispose,
      get disposed() { return disposed; }
    });
  }
  return Object.freeze({ create });
})();

// ---- src/core/storage.js ----
V3.storage = (() => {
  function create(namespace, options = {}) {
    const schema = Number(options.schema || 1);
    const area = options.area || localStorage;
    const prefix = 'bwu2.v3.' + namespace + '.s' + schema + '.';
    const key = name => prefix + name;
    const read = (name, fallback = null) => {
      const raw = area.getItem(key(name));
      if (raw == null) return { ok:true, value:fallback, missing:true };
      try {
        const envelope = JSON.parse(raw);
        if (!envelope || envelope.schema !== schema || !Object.prototype.hasOwnProperty.call(envelope,'value')) {
          return { ok:false, value:fallback, error:'schema' };
        }
        return { ok:true, value:envelope.value, at:Number(envelope.at) || 0 };
      } catch {
        return { ok:false, value:fallback, error:'corrupt' };
      }
    };
    const get = (name, fallback = null) => read(name, fallback).value;
    const set = (name, value) => {
      area.setItem(key(name), JSON.stringify({ schema, at:Date.now(), value }));
      return value;
    };
    const remove = name => area.removeItem(key(name));
    return Object.freeze({ namespace, schema, prefix, key, read, get, set, remove });
  }
  return Object.freeze({ create });
})();

// ---- src/core/telemetry.js ----
V3.telemetry = (() => {
  const FORBIDDEN = /token|secret|cookie|authorization|csrf|password/i;
  const mask = value => {
    const text = V3.base.clean(value);
    if (!text || text.length <= 7) return text;
    return text.slice(0,3) + '…' + text.slice(-4) + '(' + text.length + ')';
  };
  const sanitize = (value, depth = 0) => {
    if (depth > 4) return '[depth]';
    if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.length > 600 ? value.slice(0,600) + '…' : value;
    if (Array.isArray(value)) return value.slice(0,30).map(item => sanitize(item, depth + 1));
    if (typeof value === 'object') {
      const out = {};
      for (const [key,item] of Object.entries(value).slice(0,50)) {
        out[key] = FORBIDDEN.test(key) ? '[redacted]' : sanitize(item, depth + 1);
      }
      return out;
    }
    return String(value);
  };

  function create(suite, version, options = {}) {
    const limit = Number(options.limit || 600);
    const store = V3.storage.create('telemetry.' + suite);
    let events = store.get('events', []);
    if (!Array.isArray(events)) events = [];

    const emit = (type, data = {}) => {
      const event = Object.assign({
        t:new Date().toISOString(), suite, version, type
      }, sanitize(data));
      events.push(event);
      if (events.length > limit) events.splice(0, events.length - limit);
      try { store.set('events', events); } catch {}
      return event;
    };

    const op = (operation, phase, data = {}) => emit('operation', Object.assign({
      opId:operation.id, kind:operation.kind, ref:operation.ref, phase
    }, data));

    const list = () => events.slice();
    const clear = () => { events = []; store.set('events', events); };
    const exportText = () => JSON.stringify({
      format:'BWU2-V3-OBS', suite, version,
      exportedAt:new Date().toISOString(), events:list()
    }, null, 2);

    return Object.freeze({ emit, op, list, clear, exportText, mask });
  }

  return Object.freeze({ create, mask, sanitize });
})();

// ---- src/core/screenshot.js ----
V3.screenshot = (() => {
  function install(options = {}) {
    const life = options.life;
    const roots = options.roots || [];
    const state = { hidden:false };
    const apply = () => {
      for (const root of roots) {
        if (!root?.style) continue;
        if (state.hidden) root.style.setProperty('display','none','important');
        else root.style.removeProperty('display');
      }
    };
    life.on(document,'keydown',event => {
      if (!(event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && String(event.key).toLowerCase() === 'q')) return;
      event.preventDefault();
      state.hidden = !state.hidden;
      apply();
    }, true);
    return Object.freeze({
      get hidden() { return state.hidden; },
      toggle() { state.hidden = !state.hidden; apply(); return state.hidden; }
    });
  }
  return Object.freeze({ install });
})();

// ---- src/suites/sim/index.js ----
V3.boot = () => {
  const VERSION=V3.build.version;
  const life=V3.lifecycle.create('sim');
  const telemetry=V3.telemetry.create('sim',VERSION);
  const store=V3.storage.create('sim');
  let snippets=store.get('snippets',[]);
  if(!Array.isArray(snippets))snippets=[];

  const host=document.createElement('div');host.id='bwu2-v3-sim';host.dataset.bwu2V3Ui='1';
  const shadow=host.attachShadow({mode:'open'});
  document.body.appendChild(host);
  V3.screenshot.install({life,roots:[host]});
  shadow.innerHTML='<style>:host{all:initial;position:fixed;right:12px;bottom:12px;z-index:2147482500;font:800 11px Arial;color:#fff}.bar{max-width:760px;display:flex;gap:5px;flex-wrap:wrap;padding:7px;border:1px solid #526076;border-radius:10px;background:#131922;box-shadow:0 10px 28px #0007}button{min-height:28px;padding:4px 7px;border:1px solid #5b6a80;border-radius:7px;background:#222b38;color:#fff;cursor:pointer}button:focus-visible{outline:3px solid #ffd84d}.snips{display:none;width:100%;gap:5px;flex-wrap:wrap}.snips[data-open="1"]{display:flex}</style><div class="bar">'+
    '<button data-wrap="**|**">B</button><button data-wrap="_|_">I</button><button data-wrap="`|`">CODE</button>'+
    '<button data-prefix="> ">QUOTE</button><button data-prefix="- ">LIST</button><button data-table>TABLE</button>'+
    '<button data-snips>SNIPS</button><button data-save>+ SNIP</button><button data-export>EXPORT</button><button data-import>IMPORT</button>'+
    '<button data-open-images>OPEN IMG</button><button data-download-images>DL IMG</button><div class="snips" data-snips-list></div></div>';
  const bar=shadow.querySelector('.bar'),snipList=shadow.querySelector('[data-snips-list]');

  const editor=()=>{
    const candidates=[
      'textarea[placeholder*="markdown" i]','textarea[name*="description" i]','textarea',
      '[contenteditable="true"][role="textbox"]','[contenteditable="true"]'
    ];
    for(const selector of candidates){
      const el=document.querySelector(selector);
      if(el&&el.offsetParent!==null)return el;
    }
    return null;
  };
  const insert=(before,after='',prefix='')=>{
    const el=editor();if(!el)return;
    if(el instanceof HTMLTextAreaElement||el instanceof HTMLInputElement){
      const start=el.selectionStart??el.value.length,end=el.selectionEnd??start;
      const selected=el.value.slice(start,end);
      const body=prefix?selected.split(/\r?\n/).map(line=>prefix+line).join('\n'):before+selected+after;
      el.setRangeText(body,start,end,'end');el.dispatchEvent(new Event('input',{bubbles:true}));el.focus();
    }else{
      el.focus();document.execCommand('insertText',false,prefix||before+(after?'text'+after:''));
    }
  };
  const renderSnips=()=>{
    snipList.replaceChildren();
    snippets.forEach((snip,index)=>{
      const b=document.createElement('button');b.textContent=snip.name||('Snippet '+(index+1));b.title=snip.text||'';
      b.onclick=()=>insert(String(snip.text||''));snipList.appendChild(b);
    });
  };
  const imageUrls=()=>[...new Set([
    ...[...document.querySelectorAll('img')].map(img=>img.currentSrc||img.src),
    ...[...document.querySelectorAll('a[href]')].map(a=>a.href).filter(href=>/\.(?:png|jpe?g|gif|webp)(?:[?#]|$)/i.test(href))
  ].filter(url=>/^https?:/i.test(url)))];

  for(const button of shadow.querySelectorAll('[data-wrap]')){
    button.onclick=()=>{const [a,b]=button.dataset.wrap.split('|');insert(a,b);};
  }
  for(const button of shadow.querySelectorAll('[data-prefix]'))button.onclick=()=>insert('','',button.dataset.prefix);
  shadow.querySelector('[data-table]').onclick=()=>insert('| Header | Header |\n| --- | --- |\n|  |  |');
  shadow.querySelector('[data-snips]').onclick=()=>{snipList.dataset.open=snipList.dataset.open==='1'?'0':'1';renderSnips();};
  shadow.querySelector('[data-save]').onclick=()=>{
    const el=editor();const selected=el&&'selectionStart'in el?String(el.value||'').slice(el.selectionStart,el.selectionEnd):'';
    const text=selected||prompt('Snippet text?')||'';if(!text)return;
    const name=prompt('Snippet name?','Snippet '+(snippets.length+1))||'Snippet '+(snippets.length+1);
    snippets.push({name,text});store.set('snippets',snippets);renderSnips();
  };
  shadow.querySelector('[data-export]').onclick=()=>{
    const blob=new Blob([JSON.stringify(snippets,null,2)],{type:'application/json'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='BWU2_V3_SIM_snippets.json';a.click();URL.revokeObjectURL(a.href);
  };
  shadow.querySelector('[data-import]').onclick=()=>{
    const input=document.createElement('input');input.type='file';input.accept='.json,application/json';
    input.onchange=async()=>{try{const parsed=JSON.parse(await input.files[0].text());if(!Array.isArray(parsed))throw new Error('Expected array');snippets=parsed.filter(x=>x&&typeof x.text==='string').slice(0,200);store.set('snippets',snippets);renderSnips();}catch(error){alert('Import failed: '+error.message);}};
    input.click();
  };
  shadow.querySelector('[data-open-images]').onclick=()=>{const urls=imageUrls();for(const url of urls)window.open(url,'_blank','noopener');telemetry.emit('images.open',{count:urls.length});};
  shadow.querySelector('[data-download-images]').onclick=async()=>{
    const urls=imageUrls();let started=0,fallback=0,failed=0;
    for(let i=0;i<urls.length;i++){
      const url=urls[i];
      try{
        const response=await fetch(url,{credentials:'include'});
        if(!response.ok)throw new Error('HTTP '+response.status);
        const blob=await response.blob();
        const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='SIM-image-'+(i+1);a.click();URL.revokeObjectURL(a.href);started++;
      }catch{
        try{const a=document.createElement('a');a.href=url;a.download='';a.target='_blank';a.click();fallback++;}catch{failed++;}
      }
    }
    telemetry.emit('images.download',{count:urls.length,started,fallback,failed});
    alert('Images: '+started+' download started, '+fallback+' browser fallback, '+failed+' failed.');
  };
  renderSnips();
};

if(typeof V3.boot!=='function') throw new Error('V3 suite boot function missing');
V3.boot();
})();
