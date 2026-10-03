// ==UserScript==
// @name         V3 | BWU2 Carton PrEditor
// @name:en      V3 | BWU2 Carton PrEditor
// @namespace    https://github.com/1Sirkkris/-tampermonkey-v2/v3
// @version      0.1.0
// @description  V3 Carton PrEditor auto-complete after barcode and count readiness.
// @match        https://aftcartonpreditorapp-tcp-nrt.nrt.proxy.amazon.com/wf*
// @run-at       document-body
// @grant        none
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-rebuild/v3/dist/BWU2_V3_Carton.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-rebuild/v3/dist/BWU2_V3_Carton.user.js
// @v3-build     carton-0.1.0-37fef107
// ==/UserScript==

(()=>{
'use strict';
const V3=Object.create(null);
V3.build=Object.freeze({"id":"carton-0.1.0-37fef107","version":"0.1.0","suite":"carton"});

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

// ---- src/suites/carton/index.js ----
V3.boot = () => {
  const VERSION=V3.build.version;
  const life=V3.lifecycle.create('carton');
  const telemetry=V3.telemetry.create('carton',VERSION);
  const settings=V3.storage.create('carton.settings');
  const BARCODE_ID='input-page-barcode-container-tertiary-text';
  const BUTTON_ID='input-page-button-container-button';
  const BARCODE_RE=/(csx[a-z0-9]{5,}|fba[a-z0-9]{8,}|amzn[a-z0-9]{8,}|\d{16,24}|[A-Z0-9]{7,12})/i;
  const COUNT_RE=/Barcodes scanned:\s*(\d+)/i;
  let enabled=settings.get('enabled',true)!==false;
  let completedIdentity='';
  let observer=null,observerTarget=null;

  const host=document.createElement('div');host.id='bwu2-v3-carton';host.dataset.bwu2V3Ui='1';
  const shadow=host.attachShadow({mode:'open'});
  document.body.appendChild(host);
  shadow.innerHTML='<style>:host{all:initial;position:fixed;z-index:2147482500;right:12px;bottom:12px;font:800 12px Arial}button{border:2px solid #66758a;border-radius:9px;padding:7px 10px;background:#151a22;color:#fff;cursor:pointer}button[data-on="1"]{border-color:#65f08f}button[data-on="0"]{border-color:#ff655d;color:#ffb5b1}</style><button data-toggle></button>';
  V3.screenshot.install({life,roots:[host]});
  const toggle=shadow.querySelector('[data-toggle]');
  const paint=()=>{toggle.dataset.on=enabled?'1':'0';toggle.textContent='Carton AutoComplete: '+(enabled?'ON':'OFF');};
  toggle.onclick=()=>{enabled=!enabled;settings.set('enabled',enabled);paint();inspect();};
  paint();

  const count=()=>{const m=String(document.body?.innerText||'').match(COUNT_RE);return m?Number(m[1]):0;};
  const click=button=>['pointerdown','mousedown','mouseup','click'].forEach(type=>button.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true})));
  const beep=()=>{
    try{
      const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;
      const ctx=new Audio();const base=ctx.currentTime+.01;
      for(const offset of [0,.22]){const o=ctx.createOscillator(),g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.frequency.value=850;g.gain.setValueAtTime(.08,base+offset);g.gain.exponentialRampToValueAtTime(.001,base+offset+.09);o.start(base+offset);o.stop(base+offset+.1);}
    }catch{}
  };
  function inspect(){
    if(!enabled)return;
    const barcodeEl=document.getElementById(BARCODE_ID);
    if(!barcodeEl)return;
    const barcode=V3.base.clean(barcodeEl.innerText||barcodeEl.textContent);
    const scanned=count();
    // Readiness dropping below 2 marks a new workflow. This deliberately
    // allows the same barcode to complete again in a later carton.
    if(scanned<2){completedIdentity='';return;}
    if(!barcode||!BARCODE_RE.test(barcode))return;
    const identity=barcode+'|'+scanned;
    if(identity===completedIdentity)return;
    const button=document.getElementById(BUTTON_ID);
    if(!button){telemetry.emit('ready-no-button',{barcode:V3.telemetry.mask(barcode),scanned});return;}
    click(button);beep();completedIdentity=identity;
    telemetry.emit('complete',{barcode:V3.telemetry.mask(barcode),scanned});
  }
  function attach(){
    const barcode=document.getElementById(BARCODE_ID);
    const target=barcode?.parentElement||document.body;
    if(!target||target===observerTarget)return;
    observer?.disconnect();observerTarget=target;
    observer=life.observe(target,inspect,{subtree:true,childList:true,characterData:true});
    inspect();
  }
  // One bounded/narrow observer owner; no interaction watchdog or polling loop.
  life.observe(document.body,records=>{
    if(records.some(r=>[...r.addedNodes,...r.removedNodes].some(n=>n?.id===BARCODE_ID||n?.querySelector?.('#'+BARCODE_ID))))attach();
    inspect();
  },{childList:true,subtree:true});
  attach();
  life.on(window,'pagehide',()=>observer?.disconnect(),{once:true});
};

if(typeof V3.boot!=='function') throw new Error('V3 suite boot function missing');
V3.boot();
})();
