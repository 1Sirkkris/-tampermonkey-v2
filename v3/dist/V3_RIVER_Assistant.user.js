// ==UserScript==
// @name         V3 | BWU2 RIVER Assistant
// @name:en      V3 | BWU2 RIVER Assistant
// @namespace    https://github.com/1Sirkkris/-tampermonkey-v2/v3-groundup
// @version      0.2.0
// @description  FCResearch capture plus cancellable native RIVER assistant.
// @include      /^https?:\/\/.*fcresearch.*\//
// @include      /^https?:\/\/qifcr\.fe\.aftx\.amazonoperations\.app\//
// @match        https://river.amazon.com/*
// @run-at       document-body
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_openInTab
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-groundup/v3/dist/V3_RIVER_Assistant.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-groundup/v3/dist/V3_RIVER_Assistant.user.js
// @v3-build     river-0.2.0-c152eb63
// ==/UserScript==

(()=>{
'use strict';
const V3=Object.create(null);
V3.build=Object.freeze({"id":"river-0.2.0-c152eb63","version":"0.2.0"});

// ---- src/core.js ----
V3.core=(()=>{
  const clean=v=>String(v??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
  const upper=v=>clean(v).toUpperCase(),lower=v=>clean(v).toLowerCase();
  const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
  const container=v=>/^(?:ts|cs)x[0-9a-z_-]+$/i.test(clean(v));
  const lines=(v,{dedupe=true}={})=>{const out=[],seen=new Set();for(const raw of String(v??'').split(/[\r\n,]+/)){const x=clean(raw.split(/\s+/)[0]);if(!x)continue;const k=upper(x);if(dedupe&&seen.has(k))continue;seen.add(k);out.push(x);}return out;};
  const id=prefix=>String(prefix||'v3')+'-'+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
  const sleep=(ms,signal)=>new Promise((resolve,reject)=>{if(signal?.aborted)return reject(new DOMException('Aborted','AbortError'));const t=setTimeout(done,Math.max(0,Number(ms)||0));function abort(){clearTimeout(t);reject(new DOMException('Aborted','AbortError'));}function done(){signal?.removeEventListener('abort',abort);resolve();}signal?.addEventListener('abort',abort,{once:true});});
  const html=raw=>new DOMParser().parseFromString(String(raw??''),'text/html');

  function lifecycle(name='module'){
    const controller=new AbortController(),disposers=new Set();let dead=false;
    const own=fn=>{if(typeof fn==='function')disposers.add(fn);return fn;};
    const on=(target,type,fn,options={})=>{if(dead||!target?.addEventListener)return()=>{};const o=typeof options==='boolean'?{capture:options,signal:controller.signal}:{...options,signal:controller.signal};target.addEventListener(type,fn,o);return()=>target.removeEventListener(type,fn,o);};
    const observe=(target,fn,options)=>{if(dead||!target||typeof MutationObserver==='undefined')return null;const observer=new MutationObserver(fn);observer.observe(target,options);own(()=>observer.disconnect());return observer;};
    const timeout=(fn,ms)=>{if(dead)return 0;const cancel=()=>clearTimeout(t);const t=setTimeout(()=>{disposers.delete(cancel);if(!dead)fn();},Math.max(0,Number(ms)||0));own(cancel);return t;};
    const dispose=()=>{if(dead)return;dead=true;controller.abort();for(const fn of [...disposers])try{fn();}catch{}disposers.clear();};
    if(typeof window.addEventListener==='function')on(window,'pagehide',dispose,{once:true});
    return Object.freeze({name,signal:controller.signal,own,on,observe,timeout,sleep:ms=>sleep(ms,controller.signal),dispose,get disposed(){return dead;}});
  }

  const gmGet=async(k,d)=>{if(typeof GM==='object'&&GM?.getValue)return await GM.getValue(k,d);if(typeof GM_getValue==='function')return GM_getValue(k,d);throw new Error('Userscript storage unavailable');};
  const gmSet=async(k,v)=>{if(typeof GM==='object'&&GM?.setValue)return await GM.setValue(k,v);if(typeof GM_setValue==='function')return GM_setValue(k,v);throw new Error('Userscript storage unavailable');};
  function store(namespace,version=1){
    const prefix='bwu2.v3.'+namespace+'.v'+version+'.';
    return Object.freeze({get:(k,d)=>gmGet(prefix+k,d),set:(k,v)=>gmSet(prefix+k,v),key:k=>prefix+k});
  }

  const mask=value=>{const s=clean(value);if(!s)return'';let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return'#'+(h>>>0).toString(16).padStart(8,'0');};
  const sanitize=(value,depth=0)=>{
    if(depth>6)return '[depth limit]';
    if(value==null||typeof value==='boolean'||typeof value==='number')return value;
    if(typeof value==='string')return value.replace(/(?:Bearer\s+)[^\s]+|(?:token|csrf|password|cookie|authorization)[=:]\s*[^\s&]+/gi,'[redacted]').slice(0,280);
    if(Array.isArray(value))return value.slice(0,20).map(item=>sanitize(item,depth+1));
    if(typeof value==='object'){const out={};for(const [k,v] of Object.entries(value)){if(/cookie|authorization|csrf|token|password|secret|header/i.test(k))continue;out[k]=sanitize(v,depth+1);}return out;}
    return String(value);
  };
  function telemetry(tool,version){
    const emit=(event,data={})=>{try{window.dispatchEvent(new CustomEvent('bwu2-v3:event',{detail:{ts:Date.now(),tool,version,event,href:location.origin+location.pathname,data:sanitize(data)}}));}catch{}};
    return Object.freeze({tool,emit,mask});
  }

  class UnknownError extends Error{constructor(message,details={}){super(message);this.name='UnknownError';this.outcome='unknown';Object.assign(this,details);}}
  class RejectedError extends Error{constructor(message,details={}){super(message);this.name='RejectedError';this.outcome='rejected';Object.assign(this,details);}}
  const operation=options=>V3.state.operation(options);
  const queue=options=>V3.state.queue(options);
  const request=(url,options)=>V3.transport.request(url,options);
  const authLike=(...args)=>V3.transport.authLike(...args);

  const LOGIN=/^[a-z][a-z0-9-]{2,31}$/i,RESERVED=/^(?:login|logout|signin|signout|username|employee|alias|user|account|profile|settings|help|admin)$/i;
  const normLogin=value=>{const v=clean(value);return LOGIN.test(v)&&!RESERVED.test(v)?v:'';};
  const identity=options=>V3.identity.resolve(options);

  const STYLE_ID='bwu2-v3-core-style';
  const ensureStyle=()=>{if(document.getElementById(STYLE_ID)||!document.head)return;const s=document.createElement('style');s.id=STYLE_ID;s.dataset.bwu2Ui='1';s.textContent=`
[data-bwu2-v3-dock]{position:fixed;right:12px;bottom:12px;z-index:2147483000;display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;max-width:min(90vw,900px);font:700 12px/1.2 Arial,sans-serif}
[data-bwu2-v3-dock] button,.v3-btn{border:1px solid #526174;border-radius:8px;background:#202936;color:#f4f7fb;padding:7px 10px;font:700 12px Arial;cursor:pointer}
[data-bwu2-v3-dock] button:hover,.v3-btn:hover{background:#2d394a}.v3-btn.primary{background:#284f75;border-color:#7ca6d3}.v3-btn.danger{background:#643532;border-color:#d98a82}
.v3-panel{position:fixed;right:12px;top:12px;z-index:2147482999;width:min(560px,calc(100vw - 24px));max-height:calc(100vh - 70px);display:flex;flex-direction:column;background:#111720;color:#eef3f8;border:1px solid #526174;border-radius:12px;box-shadow:0 16px 45px rgba(0,0,0,.45);font:13px/1.35 Arial,sans-serif}
.v3-panel[hidden]{display:none}.v3-expiry{position:fixed;inset:0;z-index:2147483647;background:#0008;display:grid;place-items:start center;padding:24px}.v3-expiry-card{width:min(850px,95vw);max-height:90vh;overflow:auto;background:#111720;color:#fff;border:2px solid #77879b;border-radius:12px;padding:14px;font:13px Arial}.v3-date-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin:12px 0}.v3-date-grid section>div{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-top:8px}.v3-date-grid .v3-btn{padding:8px 3px}.v3-head{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #334154}.v3-head b{font-size:15px}.v3-head .spacer{flex:1}.v3-body{min-height:0;overflow:auto;padding:11px}
.v3-section{padding:10px;margin-bottom:9px;border:1px solid #334154;border-radius:9px;background:#18202b}.v3-row{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.v3-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.v3-field{display:block;font-weight:700;margin-bottom:8px}.v3-field input,.v3-field textarea,.v3-field select,.v3-input{box-sizing:border-box;width:100%;margin-top:4px;padding:7px 8px;border-radius:7px;border:1px solid #53647a;background:#0d131b;color:#fff;font:13px Arial}.v3-field textarea{min-height:80px;resize:vertical}.v3-note{color:#aebbc9}.v3-ok{color:#70d6a0}.v3-warn{color:#ffd166}.v3-bad{color:#ff827a}.v3-list-row{padding:6px 0;border-bottom:1px solid #2d3948}.v3-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:9px}.v3-tabs .active{background:#284f75;border-color:#7ca6d3}
@media(max-width:650px){.v3-panel{right:6px;top:6px;width:calc(100vw - 12px);max-height:calc(100vh - 58px)}}
`;document.head.appendChild(s);};
  const panels=new Map();
  const closeAll=except=>{for(const [id,p] of panels)if(id!==except)p.hidden=true;};
  function panel({id,title,width=560,life}={}){
    ensureStyle();let el=document.querySelector('[data-bwu2-v3-panel="'+CSS.escape(id)+'"]');
    if(!el){el=document.createElement('section');el.className='v3-panel';el.hidden=true;el.dataset.bwu2V3Panel=id;el.dataset.bwu2Ui='1';el.style.width='min('+width+'px,calc(100vw - 24px))';el.innerHTML='<div class="v3-head"><b>'+esc(title)+' · '+esc(V3.build.version)+'</b><span class="spacer"></span><button class="v3-btn" data-close>×</button></div><div class="v3-body"></div>';document.body.appendChild(el);el.querySelector('[data-close]').onclick=()=>{el.hidden=true;};}
    panels.set(id,el);life?.own(()=>{panels.delete(id);el.remove();});
    const body=el.querySelector('.v3-body');
    return Object.freeze({el,body,open(){closeAll(id);el.hidden=false;},close(){el.hidden=true;},set(node){body.replaceChildren(node);}});
  }
  function dockButton({id,label,title,onClick}={}){
    ensureStyle();let dock=document.querySelector('[data-bwu2-v3-dock]');if(!dock){dock=document.createElement('div');dock.dataset.bwu2V3Dock='1';dock.dataset.bwu2Ui='1';document.body.appendChild(dock);}
    let b=dock.querySelector('[data-v3-button="'+CSS.escape(id)+'"]');if(!b){b=document.createElement('button');b.dataset.v3Button=id;dock.appendChild(b);}b.textContent=label;b.title=(title||label)+' · '+V3.build.version;b.onclick=onClick;return b;
  }

  return Object.freeze({clean,upper,lower,esc,container,lines,id,sleep,html,lifecycle,store,telemetry,mask,sanitize,operation,UnknownError,RejectedError,queue,request,authLike,normLogin,identity,panel,dockButton});
})();

// ---- src/state.js ----
V3.state = (() => {
  const C = V3.core;
  const read = (key, initial) => {
    const raw = localStorage.getItem(key);
    if (raw == null) return initial;
    try { return JSON.parse(raw); }
    catch { throw new Error('Saved workflow data is unreadable — kept for inspection'); }
  };
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const keyFor = name => 'bwu2.v3.state.' + name;
  const attention = name => read(keyFor('mutation.' + name), null);
  const assertClear = name => {
    const pending = attention(name);
    if (pending) throw new C.UnknownError('VERIFY PREVIOUS ' + pending.kind + ' · ' + pending.ref, {pending});
  };

  // Browser-owned locks have no lease to expire in a throttled/background tab.
  async function acquire(name) {
    if (!navigator.locks) throw new Error('Open this tool over HTTPS for safe workflow ownership');
    let release;
    const held = new Promise(resolve => { release = resolve; });
    let accept, reject;
    const acquired = new Promise((resolve, fail) => { accept = resolve; reject = fail; });
    const completed=navigator.locks.request('bwu2.v3.' + name, {ifAvailable: true}, async lock => {
      if (!lock) { reject(new Error('Workflow active in another tab')); return; }
      accept(async()=>{release();await completed;});
      await held;
    }).catch(reject);
    return acquired;
  }
  async function exclusive(name, work) {
    const release = await acquire(name);
    try { return await work(); } finally { await release(); }
  }
  const resolveAttention = name => exclusive(name, () => {
    localStorage.removeItem(keyFor('mutation.' + name));
  });

  function operation({kind, ref, scope, telemetry} = {}) {
    const name = scope || telemetry?.tool || kind;
    const key = keyFor('mutation.' + name), id = C.id('op');
    let state = 'PREPARED';
    const transition = (next, data = {}) => {
      const allowed = {PREPARED: ['SUBMITTED', 'REJECTED'], SUBMITTED: ['CONFIRMED', 'REJECTED', 'UNKNOWN']};
      if (!(allowed[state] || []).includes(next)) throw new Error('Illegal or terminal operation transition ' + state + ' -> ' + next);
      if (next === 'SUBMITTED') {
        assertClear(name);
        // Persist before sending, so reload cannot turn an in-flight action into retryable work.
        write(key, {id, kind, ref: C.clean(ref), state: next, at: Date.now()});
      } else if (state === 'SUBMITTED') {
        const saved = read(key, null);
        if (saved?.id !== id) throw new C.UnknownError('Mutation ownership changed — verify before retry');
        if (next === 'UNKNOWN') write(key, {...saved, state: next});
        else localStorage.removeItem(key);
      }
      state = next;
      telemetry?.emit('operation', {id, kind, ref: C.mask(ref), state, ...data});
      return state;
    };
    return Object.freeze({id, kind, scope: name, get state() { return state; },
      submitted: data => transition('SUBMITTED', data), confirmed: data => transition('CONFIRMED', data),
      rejected: data => transition('REJECTED', data), unknown: data => transition('UNKNOWN', data)});
  }

  function queue({name, life, validate = C.container} = {}) {
    const key = keyFor('queue.' + name);
    let release = null, loaded = false;
    let state = {running: false, current: '', phase: 'idle', message: 'Ready', items: []};
    const save = async () => write(key, state);
    const load = async () => {
      if (loaded) return state;
      const saved = read(key, null);
      if (saved) {
        if (!Array.isArray(saved.items)) throw new Error('Saved queue is unreadable — kept for inspection');
        if(saved.items.some(row=>!validate(row?.id)||!['queued','active','attention','rejected','done'].includes(row.status)))throw new Error('Saved queue contains invalid rows — kept for inspection');
        state = {...state, ...saved, items: saved.items};
        for (const row of state.items) if (row.status === 'active' || row.id === state.current) {
          row.status = 'attention'; row.error = 'Previous session ended during work — verify before retry';
        }
      }
      state.running = false; state.current = ''; state.phase = 'idle'; loaded = true;
      return state;
    };
    const acquireQueue = async () => {
      if (release) return true;
      try{release=await acquire('queue.'+name);loaded=false;await load();return true;}catch(error){const held=release;release=null;await held?.();if(/active in another tab/.test(error.message))return false;throw error;}
    };
    const releaseQueue = async () => {const held=release;release=null;await held?.();};
    life?.own(releaseQueue);
    const edit = work => exclusive('queue.' + name, async () => {
      // Never overwrite another tab's queue with a stale in-memory copy.
      const latest = read(key, null);
      if (latest) { state = {...latest, running: false}; for(const row of state.items) if(row.status==='active'||row.id===state.current){row.status='attention';row.error='Previous session ended during work — verify before retry';} state.current=''; }
      await work(); await save();
    });
    const add = async values => { await load(); await edit(() => {
      const used = new Set(state.items.map(row => C.upper(row.id)));
      for (const value of values) { const id = C.clean(value), k = C.upper(id);
        if (validate(id) && !used.has(k)) { used.add(k); state.items.push({id, status: 'queued', phase: '', error: ''}); }
      }
    }); return state.items; };
    const set = async patch => { Object.assign(state, patch); await save(); };
    const item = async (row, patch) => { Object.assign(row, patch); await save(); };
    const resolve = async () => {
      if (state.running) throw new Error('Pause before resolving attention');
      await edit(() => { for (const row of state.items) if (row.status === 'attention' || row.status === 'rejected') {
        row.status = 'queued'; row.error = ''; row.phase = '';
      } });
    };
    return Object.freeze({load, save, add, set, item, resolve,
      next: () => state.items.find(row => row.status === 'queued') || null,
      acquire: acquireQueue, release: releaseQueue,
      clearDone: () => edit(() => { state.items = state.items.filter(row => row.status !== 'done'); }),
      get state() { return state; }});
  }
  return Object.freeze({read, write, keyFor, attention, assertClear, acquire, exclusive, resolveAttention, operation, queue});
})();

// ---- src/transport.js ----
V3.transport = (() => {
  const C = V3.core;
  function authLike(status, contentType, finalUrl, raw) {
    const html = /text\/html|application\/xhtml/i.test(contentType || '') || /^\s*(?:<!doctype\s+html|<html\b)/i.test(raw || '');
    let redirected = false;
    try { const url = new URL(finalUrl, location.href);
      redirected = /(?:^|\.)(?:midway|sso|signin|login)\./i.test(url.hostname) || /\/(?:login|signin|sign-in|authenticate)(?:\/|$)/i.test(url.pathname);
    } catch {}
    const auth = [401, 403, 419].includes(Number(status)) || redirected ||
      (html && /(?:midway|single\s+sign[- ]?on|authentication required|sign\s*in to|log\s*in to)/i.test(raw || ''));
    return {html, auth};
  }
  function classify(result, options) {
    const flags = authLike(result.status, result.contentType, result.finalUrl, result.raw);
    let data; try { data = result.raw ? JSON.parse(result.raw) : null; } catch { data = result.raw; }
    if (flags.auth || (flags.html && !options.allowHtml)) throw Object.assign(new Error('Authentication/HTML response instead of expected API response'), {status: result.status, flags, responseReceived: true});
    const httpError = result.status < 200 || result.status >= 300;
    if (httpError && !options.allowHttpError) throw Object.assign(new Error('HTTP ' + result.status), {status: result.status, body: data, responseReceived: true});
    return {...result, data, flags, httpError};
  }
  async function request(url, options = {}) {
    const target = new URL(url, location.href).href;
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const timeout = options.timeout ?? 15000;
    if (new URL(target).origin === location.origin) {
      const controller = new AbortController();
      const cancel = () => controller.abort(options.signal?.reason);
      options.signal?.addEventListener('abort', cancel, {once: true});
      const timer = setTimeout(() => controller.abort(new Error('Request timeout')), timeout);
      try {
        const response = await fetch(target, {method: options.method || 'GET', body: options.body,
          headers: options.headers || {}, credentials: 'same-origin', cache: 'no-store', redirect: 'follow', signal: controller.signal});
        const raw = await response.text();
        return classify({status: response.status, raw, finalUrl: response.url || target,
          contentType: response.headers.get('content-type') || ''}, options);
      } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); }
    }
    const gm = typeof GM === 'object' && typeof GM.xmlHttpRequest === 'function' ? GM.xmlHttpRequest.bind(GM) :
      typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : null;
    if (!gm) throw new Error('Cross-origin request unavailable');
    return new Promise((resolve, reject) => {
      let handle, done = false;
      const finish = (error, value) => {
        if (done) return; done = true; options.signal?.removeEventListener('abort', cancel);
        if (error) reject(error); else resolve(value);
      };
      const cancel = () => { handle?.abort?.(); finish(new DOMException('Aborted', 'AbortError')); };
      options.signal?.addEventListener('abort', cancel, {once: true});
      try { handle = gm({method: options.method || 'GET', url: target, data: options.body,
        headers: options.headers || {}, timeout, redirect: 'follow',
        onload: response => { try { finish(null, classify({status: response.status, raw: String(response.responseText ?? ''),
          finalUrl: response.finalUrl || target, contentType: String(response.responseHeaders || '').match(/content-type:\s*([^\r\n]+)/i)?.[1] || ''}, options)); }
          catch (error) { finish(error); } },
        ontimeout: () => finish(new Error('Request timeout')), onerror: () => finish(new Error('Network error')),
        onabort: () => finish(new DOMException('Aborted', 'AbortError'))});
        handle?.catch?.(error => finish(error));
      } catch (error) { finish(error); }
    });
  }
  return Object.freeze({request, authLike});
})();

// ---- src/identity.js ----
V3.identity = (() => {
  const C = V3.core;
  const FIELDS = ['employeeLogin', 'userLogin', 'username', 'login', 'alias', 'autoId', 'autoID'];
  const MUTABLE = 'input,textarea,[contenteditable="true"],[data-bwu2-ui]';
  function resolve({pageWindow = typeof unsafeWindow === 'object' ? unsafeWindow : window, doc = document} = {}) {
    const candidates = [];
    const add = (value, source, score) => { const login = C.normLogin(value);
      if (login) candidates.push({login: login.toLowerCase(), source, score}); };
    for (const field of FIELDS) add(pageWindow?.[field], 'global:' + field, 100);
    for (const name of ['user', 'currentUser', 'employee', 'identity', 'bootstrapData', '__INITIAL_STATE__']) {
      const value = pageWindow?.[name];
      if (typeof value === 'string') add(value, 'global:' + name, 100);
      else for (const object of [value, value?.user, value?.employee, value?.identity]) {
        if (!object || typeof object !== 'object') continue;
        for (const field of FIELDS) add(object[field], 'global:' + name + '.' + field, 100);
      }
    }
    for (const selector of ['.app-user-name', '[data-test-id="user-name"]', '.nav-user', '.user-name',
      '[data-employee-login]', '[data-user-login]', '[data-username]', '[data-autoid]',
      'meta[name="employeeLogin"]', 'meta[name="username"]', 'meta[name="autoid"]']) {
      for (const element of doc.querySelectorAll(selector)) {
        if (element.closest(MUTABLE)) continue;
        if (element.tagName !== 'META') { const rect = element.getBoundingClientRect();
          const style = pageWindow.getComputedStyle(element);
          if (!rect.width || !rect.height || style.display === 'none' || style.visibility === 'hidden') continue; }
        add(element.dataset?.employeeLogin || element.dataset?.userLogin || element.dataset?.username ||
          element.dataset?.autoid || element.content || element.textContent, 'dom:' + selector, 80);
      }
    }
    for (const row of doc.querySelectorAll('.aui-nav-row')) {
      if (row.closest(MUTABLE)) continue;
      const match = C.clean(row.textContent).match(/\bSearch\s+([a-z][a-z0-9-]{2,31})\s*(?:$|Logout|Sign out)/i);
      add(match?.[1], 'dom:authenticated-navigation', 70);
    }
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (!best || candidates.some(row => row.score === best.score && row.login !== best.login)) return {login: '', source: best ? 'conflicting-authenticated-identities' : 'none', score: 0};
    return best;
  }
  return Object.freeze({resolve});
})();

// ---- src/native.js ----
V3.native = (() => {
  const C = V3.core;
  const visible = element => {
    if (!element?.isConnected || element.closest('[data-bwu2-ui]') || element.hidden) return false;
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  };
  const root = () => document.querySelector('#root,#app,#application,main') || document.body;
  const inputs = () => [...document.querySelectorAll('input,textarea,select')].filter(visible);
  const descriptor = input => C.lower([input.name,input.id,input.placeholder,input.getAttribute('aria-label'),
    [...(input.labels || [])].map(label => label.textContent).join(' ')].filter(Boolean).join(' '));
  const findInput = (wanted, forbidden) => inputs().map(input => ({input, score: (wanted.test(descriptor(input)) ? 1 : 0) - (forbidden?.test(descriptor(input)) ? 2 : 0)}))
    .filter(row => row.score > 0).sort((a,b) => b.score-a.score)[0]?.input || null;
  function setValue(input, value) {
    if (!input || input.disabled || input.readOnly) throw new Error('Native input unavailable');
    let proto=input, setter;
    while ((proto=Object.getPrototypeOf(proto))&&!setter) setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;
    if (setter) setter.call(input,String(value)); else input.value=String(value);
    input.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
    input.dispatchEvent(new Event('change',{bubbles:true,composed:true}));
    return input;
  }
  const enter = input => { for (const type of ['keydown','keypress','keyup']) {
    const event=new KeyboardEvent(type,{key:'Enter',code:'Enter',bubbles:true,cancelable:true});
    Object.defineProperty(event,'keyCode',{get:()=>13});Object.defineProperty(event,'which',{get:()=>13});input.dispatchEvent(event);
  } };
  const text = () => C.clean([...root().querySelectorAll('h1,h2,h3,h4,label,legend,[role="heading"],[role="alert"],[role="status"]')].filter(visible).map(element=>element.textContent).join(' '));
  const status = () => [...document.querySelectorAll('[role="alert"],[role="status"],.alert,.error,.success')].filter(visible).map(element=>C.clean(element.textContent)).join(' | ');
  function waitFor(predicate,{life,signal=life?.signal,timeout=10000,target=root(),events=[]}={}) {
    return new Promise((resolve,reject)=>{
      let observer,timer,finished=false;
      const finish=(error,value)=>{if(finished)return;finished=true;observer?.disconnect();clearTimeout(timer);signal?.removeEventListener('abort',abort);for(const event of events)window.removeEventListener(event,check);if(error)reject(error);else resolve(value);};
      const check=()=>{try{const value=predicate();if(value)finish(null,value);}catch(error){finish(error);}};
      const abort=()=>finish(new DOMException('Aborted','AbortError'));
      if(signal?.aborted)return abort();
      observer=new MutationObserver(check);observer.observe(target,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['disabled','hidden','aria-hidden','value']});
      timer=setTimeout(()=>finish(new Error('Native page did not confirm the action')),timeout);
      signal?.addEventListener('abort',abort,{once:true});for(const event of events)window.addEventListener(event,check);check();
    });
  }
  return Object.freeze({visible,root,inputs,descriptor,findInput,setValue,enter,text,status,waitFor});
})();

// ---- src/pandash.js ----
V3.pandash = (() => {
  const C=V3.core;
  function create({life}={}) {
    const results=new Map(),restrictions=new Map(),pending=new Map();
    async function lookup(asinValue,warehouseValue) {
      const asin=C.upper(asinValue),warehouse=C.upper(warehouseValue),key=warehouse+'|'+asin;
      if(!/^[A-Z0-9]{10}$/.test(asin)||!/^\w{3,8}$/.test(warehouse))throw new Error('Pandash requires exact ASIN + warehouse');
      const cached=results.get(key);if(cached&&Date.now()-cached.at<6*3600000)return cached.value;
      if(pending.has(key))return pending.get(key);
      const task=(async()=>{
        let restriction=restrictions.get(warehouse);
        if(!restriction){const boot=await C.request('https://pandash.amazon.com/GridServlet?fc='+encodeURIComponent(warehouse),{timeout:8000,signal:life?.signal});
          restriction=C.clean(boot.data?.restriction||'default');restrictions.set(warehouse,restriction);}
        const body=new URLSearchParams({language:'default',source:restriction+'-hazmat-FC',marketPlaces:'AU',asins:asin,rows:'1',page:'1',fc:warehouse});
        const response=await C.request('https://pandash.amazon.com/GridServlet',{method:'POST',body:body.toString(),headers:{'Content-Type':'application/x-www-form-urlencoded'},timeout:8000,signal:life?.signal});
        const rows=response.data?.rows,row=Array.isArray(rows)?rows.find(item=>C.upper(item?.asin)===asin):null;
        if(!row)throw new Error('No exact Pandash result');
        const value={asin,level:Number(row.level||0),message:C.clean(row.message),allowed:/can be processed/i.test(C.clean(row.message))};
        results.set(key,{value,at:Date.now()});return value;
      })();pending.set(key,task);try{return await task;}finally{pending.delete(key);}
    }
    return Object.freeze({lookup});
  }
  return Object.freeze({create});
})();

// ---- src/fcr.js ----
V3.fcr=(()=>{
  const C=V3.core;
  const warehouse=()=>location.pathname.match(/^\/([^/]+)\/results(?:\/|$)/i)?.[1]||'';
  const base=()=>{const fc=warehouse();if(!fc)throw new Error('Warehouse not found in FCResearch URL');return location.origin+'/'+encodeURIComponent(fc)+'/results';};
  const FORM_HEADERS={'Content-Type':'application/x-www-form-urlencoded','Accept':'text/html, */*; q=0.01','X-Requested-With':'XMLHttpRequest'};
  const parseBool=v=>/^(?:true|yes|1)$/i.test(C.clean(v))?true:/^(?:false|no|0)$/i.test(C.clean(v))?false:null;
  const suspicious=value=>{const p=String(value||'').match(/\d+(?:\.\d+)?/g);if(!p||p.length<3)return false;const raw=p.slice(0,3),n=raw.map(Number),eq=(a,b)=>Math.abs(a-b)<.001,rounded=raw.filter(x=>/\.00$/.test(x)).length;return eq(n[0],n[1])||eq(n[0],n[2])||eq(n[1],n[2])||rounded>=3||(Math.min(...n)<=2.001&&rounded>=2);};

  const product=raw=>{
    const doc=C.html(raw),table=doc.querySelector('.a-box-group .a-keyvalue')||[...doc.querySelectorAll('table')].find(t=>[...t.querySelectorAll('th')].some(th=>/^(asin|isbn|fnsku)$/i.test(C.clean(th.textContent))))||doc.querySelector('.a-keyvalue');
    if(!table)return null;
    const data={};
    for(const row of table.querySelectorAll('tr')){const th=row.querySelector('th'),td=row.querySelector('td');if(th&&td)data[C.lower(th.textContent)]=C.clean(td.querySelector('a')?.textContent||td.textContent);}
    const sortable=parseBool(data.sortable),out={asin:C.clean(data.asin),isbn:C.clean(data.isbn),fnsku:C.clean(data.fnsku),fcsku:C.clean(data.fcsku),title:C.clean(data.title),dimensions:C.clean(data.dimensions),weight:C.clean(data.weight),inventoryCost:C.clean(data['list price']||data.price||data['inventory cost']||''),sortable,sortableText:sortable==null?C.clean(data.sortable):String(sortable),suspicious:suspicious(data.dimensions)};
    out.img=C.clean(doc.querySelector('img')?.src||'');out.primary=out.asin||out.isbn;return out.primary||out.fnsku||out.fcsku?out:null;
  };

  const inventoryIndexes=table=>{
    const hs=[...table.querySelectorAll('thead th')].map(th=>({id:C.lower(th.id),text:C.lower(String(th.textContent||'').replace(/\(\d+\)/g,''))}));
    const find=(...names)=>hs.findIndex(h=>names.includes(h.id)||names.includes(h.text));
    return{container:find('inventory-container','container'),asin:find('inventory-asin','asin'),fnsku:find('inventory-fnsku','fnsku'),fcsku:find('inventory-fcsku','fcsku'),lpn:find('inventory-lpn','lpn'),qty:find('inventory-quantity','quantity'),disposition:find('inventory-disposition','disposition'),consumer:find('inventory-consumer','consumer'),consumerId:find('inventory-consumer-id','consumer id','consumerid'),outerLocation:find('inventory-outer-location','outer location'),outerLocationType:find('inventory-outer-location-type','outer location type'),title:find('inventory-title','title')};
  };
  const inventoryRows=doc=>{
    const table=doc.querySelector('#table-inventory');if(!table)throw new Error('Inventory table not returned');
    const idx=inventoryIndexes(table),rows=[];if(idx.qty<0||[idx.asin,idx.fnsku,idx.fcsku].every(index=>index<0))throw new Error('Inventory schema missing item / quantity columns');
    for(const tr of table.tBodies?.[0]?.rows||[]){
      const value=i=>i>=0?C.clean(tr.cells[i]?.textContent):'';
      const row={container:value(idx.container),asin:value(idx.asin),fnsku:value(idx.fnsku),fcsku:value(idx.fcsku),lpn:value(idx.lpn),qty:Number(value(idx.qty).replace(/,/g,'')),disposition:value(idx.disposition),consumer:value(idx.consumer),consumerId:value(idx.consumerId),outerLocation:value(idx.outerLocation),outerLocationType:value(idx.outerLocationType),title:value(idx.title)};
      if(row.container||row.asin||row.fnsku||row.fcsku){if(!value(idx.qty)||!Number.isSafeInteger(row.qty)||row.qty<0)throw new Error('Inventory row has invalid quantity');rows.push(row);}
    }
    return rows;
  };
  const paginationToken=doc=>{const raw=C.clean(doc.querySelector('.pagination-token')?.textContent);if(!raw)return '';try{const token=JSON.parse(raw);if(!token||typeof token!=='object')throw new Error();return raw;}catch{throw new Error('Inventory incomplete: malformed pagination token');}};
  const podOf=value=>C.clean(value).match(/\bP-\d-(?:[A-Z]\d{3}){2}\b/i)?.[0]||'';
  const floorFromHtml=raw=>{const doc=C.html(raw),cell=doc.querySelector('div.a-span6:nth-child(1) > table:nth-child(1) > tbody:nth-child(1) > tr:nth-child(4) > td:nth-child(2)'),n=C.clean(cell?.textContent).split(',')[0].match(/\b(\d+)\b/)?.[1]||'';return n?'P'+n:'PX';};

  function create({life,telemetry}={}){
    const inFlight=new Map(),floorCache=new Map();
    const post=async(endpoint,fields)=>{
      const params=new URLSearchParams();for(const [k,v] of Object.entries(fields||{}))params.set(k,String(v??''));
      const key=endpoint+'|'+params.toString();if(inFlight.has(key))return inFlight.get(key);
      const work=(async()=>{let attempt=0;for(;;){try{return(await C.request(base()+'/'+endpoint,{method:'POST',body:params.toString(),headers:FORM_HEADERS,allowHtml:true,signal:life?.signal})).raw;}catch(error){if(!(error.status>=500&&error.status<600)||attempt>=2)throw error;await C.sleep([150,400][attempt++]||400,life?.signal);}}})();
      inFlight.set(key,work);try{return await work;}finally{if(inFlight.get(key)===work)inFlight.delete(key);}
    };
    const products=new Map();const getProduct=async code=>{const key=C.upper(code),cached=products.get(key);if(cached&&Date.now()-cached.at<300000)return cached.value;const value=product(await post('product',{s:C.clean(code)}));if(value){products.set(key,{value,at:Date.now()});if(products.size>300)products.delete(products.keys().next().value);}return value;};

    const fullInventory=async(code,{onPreview}={})=>{
      const started=performance.now(),first=await post('inventory',{s:C.clean(code)}),doc=C.html(first),table=doc.querySelector('#table-inventory');
      if(!table)throw new Error('Inventory table not returned');
      const tbody=table.tBodies?.[0]||table.appendChild(doc.createElement('tbody')),expected=table.tHead?.rows?.[0]?.cells?.length||0,seen=new Set();
      let next=paginationToken(doc),pages=1;
      onPreview?.({rows:inventoryRows(doc),complete:!next,pages});
      while(next){
        if(seen.has(next))throw new Error('Inventory incomplete: repeated pagination token');
        if(pages>=200)throw new Error('Inventory incomplete: pagination safety limit');
        seen.add(next);
        const moreRaw=await post('inventory-more',{token:next}),moreDoc=C.html(moreRaw);pages++;
        const moreTable=moreDoc.querySelector('#table-inventory')||moreDoc.querySelector('table');
        const fragment=moreTable?moreDoc:C.html('<table><tbody>'+moreRaw+'</tbody></table>');
        const candidates=[...fragment.querySelectorAll('tbody tr')];
        const rows=candidates.filter(r=>!expected||r.cells.length===expected);
        if(candidates.length!==rows.length)throw new Error('Inventory incomplete: malformed continuation rows');
        const following=paginationToken(moreDoc);
        if(!rows.length)throw new Error('Inventory incomplete: pagination returned no usable rows');
        for(const row of rows)tbody.appendChild(doc.importNode(row,true));
        next=following;
      }
      const rows=inventoryRows(doc),totalQuantity=rows.reduce((sum,row)=>sum+(Number(row.qty)||0),0);
      const headerTotal=Number(table.querySelector('#inventory-quantity')?.textContent?.match(/\(([\d,]+)\)/)?.[1]?.replace(/,/g,''));if(Number.isFinite(headerTotal)&&headerTotal!==totalQuantity)throw new Error('Inventory incomplete: quantity header does not match returned rows');
      telemetry?.emit('fcr.inventory',{search:C.mask(code),pages,rows:rows.length,complete:true,ms:Math.round(performance.now()-started)});
      return{rows,pages,complete:true,totalQuantity};
    };

    const floor=async pod=>{
      const key=C.upper(pod),cached=floorCache.get(key);if(cached&&Date.now()-cached.at<10*60*60*1000)return cached.floor;
      const url=new URL(location.href);url.search='';url.hash='';url.pathname='/'+encodeURIComponent(warehouse())+'/results/container-hierarchy';url.searchParams.set('s',pod);
      let last;
      for(let attempt=0;attempt<2;attempt++){
        try{
          const r=await C.request(url.href,{allowHtml:true,timeout:8000,signal:life?.signal}),value=floorFromHtml(r.raw);
          if(value!=='PX'){floorCache.set(key,{floor:value,at:Date.now()});return value;}
          last=new Error('Floor not resolved');
        }catch(error){last=error;}
        if(attempt===0)await C.sleep(250,life?.signal);
      }
      telemetry?.emit('fcr.floor.error',{pod:C.mask(pod),message:C.clean(last?.message)});
      return'PX';
    };

    const pandashService=V3.pandash.create({life});
    const pandash=asin=>pandashService.lookup(asin,warehouse());

    return Object.freeze({post,product:getProduct,inventory:fullInventory,floor,pandash});
  }

  return Object.freeze({create,warehouse,base,product,inventoryIndexes,inventoryRows,paginationToken,podOf,floorFromHtml});
})();

// ---- src/apps/river.js ----
V3.boot=()=>{
  const C=V3.core,life=C.lifecycle('river'),telemetry=C.telemetry('river',V3.build.version),store=C.store('river',1);
  const WORKFLOW_Q0='3654ec14-7232-4f65-84c3-87927cdb4d0c',WORKFLOW_ID='0dbb253e-c43a-4a8b-a316-e32b8ab9be21';
  const norm=v=>C.lower(v).replace(/[^a-z0-9]+/g,' ').trim(),code=v=>C.upper(v).replace(/[^A-Z0-9]/g,'');

  const tableHeaders=table=>{const wrapper=table?.closest('.dataTables_wrapper,.dataTables_scroll')||table?.parentElement,head=wrapper?.querySelector('.dataTables_scrollHead table')||table;return[...head?.querySelectorAll('thead th,thead td')||[]].map(x=>norm(x.textContent));};
  const column=(headers,...names)=>headers.findIndex(h=>names.some(n=>h===norm(n)||h.startsWith(norm(n)+' ')));
  const number=value=>{const text=C.clean(value).replace(/,/g,'');if(!/^-?\d+(?:\.\d+)?$/.test(text))return null;const n=Number(text);return Number.isFinite(n)&&n>=0?n:null;};
  const stamp=value=>{const n=Date.parse(C.clean(value));return Number.isFinite(n)?n:Number.NEGATIVE_INFINITY;};
  const vendor=value=>{const tokens=(C.clean(value).match(/[A-Z0-9]+/gi)||[]).map(x=>x.toUpperCase());return tokens.find(x=>x.length>=2&&x.length<=8&&x!=='FBA')||'';};
  const detailMap=doc=>{const table=doc.querySelector('#table-purchase-order'),map=new Map();if(!table)return map;const h=tableHeaders(table),pi=column(h,'purchase order','po'),di=column(h,'placed','confirmed','order date','date');if(pi<0)return map;[...table.querySelectorAll('tbody tr')].forEach((row,index)=>{const cells=[...row.children].filter(x=>x.matches?.('td,th')),po=C.clean(cells[pi]?.textContent);if(!po)return;const time=di>=0?stamp(cells[di]?.textContent):Number.NEGATIVE_INFINITY,old=map.get(code(po));if(!old||time>old.time)map.set(code(po),{po,time,index});});return map;};
  const itemRows=doc=>{const table=doc.querySelector('#table-purchase-order-item');if(!table)return[];const h=tableHeaders(table),i={po:column(h,'purchase order','po'),sku:column(h,'sku','fnsku','asin'),vendor:column(h,'vendor code','seller id'),unfilled:column(h,'unfilled'),cancelled:column(h,'canceled','cancelled'),received:column(h,'received'),title:column(h,'title'),date:column(h,'order date','placed','date')};if(i.po<0||i.sku<0)return[];return[...table.querySelectorAll('tbody tr')].map((row,index)=>{const cells=[...row.children].filter(x=>x.matches?.('td,th')),po=C.clean(cells[i.po]?.textContent);if(!po)return null;return{po,sku:C.clean(cells[i.sku]?.textContent),vendorRaw:i.vendor>=0?C.clean(cells[i.vendor]?.textContent):'',unfilled:i.unfilled>=0?number(cells[i.unfilled]?.textContent):null,cancelled:i.cancelled>=0?number(cells[i.cancelled]?.textContent):null,received:i.received>=0?number(cells[i.received]?.textContent):null,title:i.title>=0?C.clean(cells[i.title]?.textContent):'',time:i.date>=0?stamp(cells[i.date]?.textContent):Number.NEGATIVE_INFINITY,index,rowText:C.clean(row.textContent)};}).filter(Boolean);};
  const selectPo=(itemDoc,detailDoc,identity)=>{
    const rows=itemRows(itemDoc),details=detailMap(detailDoc),wanted=[identity.search,identity.asin,identity.fnsku].map(code).filter(Boolean),candidates=[];
    for(const row of rows){const sku=code(row.sku);let strength=0,matchBy='';if(sku&&wanted.includes(sku)){strength=3;matchBy=sku===code(identity.fnsku)?'fnsku':sku===code(identity.asin)?'asin':'search';}if(!strength)continue;const time=Math.max(row.time,details.get(code(row.po))?.time??Number.NEGATIVE_INFINITY);candidates.push({...row,strength,matchBy,time});}
    if(!candidates.length)return null;candidates.sort((a,b)=>b.time-a.time||b.strength-a.strength||a.index-b.index);const row=candidates[0],parts=[row.unfilled,row.cancelled,row.received],known=parts.every(value=>typeof value==='number'&&Number.isFinite(value)),quantity=known?parts.reduce((sum,v)=>sum+v,0):null;return{purchaseOrder:row.po,vendorCode:vendor(row.vendorRaw)||'N/A',quantity:Number.isFinite(quantity)&&quantity>0?quantity:null,matchBy:row.matchBy,candidateCount:candidates.length};
  };
  const riverUrl=warehouse=>{const u=new URL('https://river.amazon.com/'+encodeURIComponent(warehouse)+'/workflows');u.searchParams.set('buildingType','fc');u.searchParams.set('q0',WORKFLOW_Q0);u.searchParams.set('q1',WORKFLOW_ID);u.searchParams.set('id',WORKFLOW_ID);return u.href;};

  if(location.hostname!=='river.amazon.com'){
    const fcr=V3.fcr.create({life,telemetry}),panel=C.panel({id:'river-capture',title:'V3 · RIVER Capture',width:540,life});let mounted=false,payload=null;
    C.dockButton({id:'river-capture',label:'RIVER',title:'Capture item for RIVER',onClick:()=>{if(!mounted){mounted=true;const root=document.createElement('div');root.innerHTML='<section class="v3-section"><label class="v3-field">Current item<input data-code></label><div class="v3-row"><button class="v3-btn primary" data-cap>CAPTURE</button><button class="v3-btn" data-open>OPEN RIVER</button></div><div class="v3-note" data-msg></div><div data-out></div></section>';panel.set(root);const input=root.querySelector('[data-code]'),msg=root.querySelector('[data-msg]'),out=root.querySelector('[data-out]');input.value=C.clean(new URLSearchParams(location.search).get('s'));const paint=()=>{out.innerHTML=payload?'<div class="v3-grid" style="margin-top:10px"><div><b>FNSKU</b><br>'+C.esc(payload.fnsku)+'</div><div><b>PO</b><br>'+C.esc(payload.purchaseOrder)+'</div><div><b>PO qty</b><br>'+(payload.poLineQuantity??'N/A')+'</div><div><b>LIVE qty</b><br>'+(payload.liveInventoryQuantity??'N/A')+'</div></div>':'';};root.querySelector('[data-cap]').onclick=async()=>{try{const search=C.clean(input.value);if(!search)throw new Error('Search item required');msg.className='v3-note v3-warn';msg.textContent='CAPTURING…';const [product,inventory,itemHtml,poHtml]=await Promise.all([fcr.product(search),fcr.inventory(search),fcr.post('purchase-order-item',{s:search}),fcr.post('purchase-order',{s:search})]);if(!product)throw new Error('Product unavailable');const po=selectPo(C.html(itemHtml),C.html(poHtml),{search,asin:product.asin,fnsku:product.fnsku,title:product.title}),warehouse=V3.fcr.warehouse()||'BWU2';payload={asin:product.asin||'N/A',fnsku:product.fnsku||'N/A',title:product.title||'N/A',purchaseOrder:po?.purchaseOrder||'N/A',vendorCode:po?.vendorCode||'N/A',poLineQuantity:po?.quantity??null,liveInventoryQuantity:inventory.totalQuantity,inventoryCost:product.inventoryCost||'N/A',physicalLocation:'TBD',warehouseId:warehouse,riverUrl:riverUrl(warehouse),capturedAt:Date.now()};payload.quantityDisagreement=Number.isFinite(payload.poLineQuantity)&&Number.isFinite(payload.liveInventoryQuantity)&&payload.poLineQuantity!==payload.liveInventoryQuantity;await store.set('payload',payload);telemetry.emit('river.capture',{po:payload.poLineQuantity,live:payload.liveInventoryQuantity,disagreement:payload.quantityDisagreement,matchBy:po?.matchBy||''});msg.className='v3-note '+(payload.quantityDisagreement?'v3-warn':'v3-ok');msg.textContent=payload.quantityDisagreement?'QTY DISAGREEMENT':'READY';paint();}catch(error){msg.className='v3-note v3-bad';msg.textContent=C.clean(error.message||error);}};root.querySelector('[data-open]').onclick=async()=>{payload=payload||await store.get('payload',null);if(!payload?.riverUrl)return;if(typeof GM_openInTab==='function')GM_openInTab(payload.riverUrl,{active:true,insert:true});else window.open(payload.riverUrl,'_blank','noopener');};}panel.open();}});
    return;
  }

  const panel=C.panel({id:'river-assistant',title:'V3 · RIVER Assistant',width:620,life});let generation=0,watcher=null,severity=null;
  const visible=V3.native.visible;
  const field=aliases=>{const wanted=aliases.map(norm);for(const el of document.querySelectorAll('input,textarea,select')){if(!visible(el))continue;const label=C.clean(el.getAttribute('aria-label')||el.placeholder||el.name||el.id||el.closest('label')?.textContent||'');if(wanted.some(x=>norm(label)===x||norm(label).startsWith(x+' ')))return el;}return null;};
  const nextButton=()=>[...document.querySelectorAll('button,a,[role="button"],input[type="submit"],input[type="button"]')].filter(visible).find(el=>norm(el.innerText||el.textContent||el.value||'')==='next');
  const label=()=>C.clean(document.querySelector('page-info[label]')?.getAttribute('label')||[...document.querySelectorAll('h1,h2,h3,h4,[role="heading"],legend')].find(visible)?.textContent||'');
  const page=()=>{const text=norm(label()),route=(location.pathname+' '+location.search+' '+location.hash).toLowerCase();if(text.includes('information')||field(['physical location of the units','inventory cost per unit']))return'information';if(text.includes('severity')||field(['units impacted']))return'severity';if(text==='asin'||text.includes('enter asin')||field(['type asin here']))return'asin';if(text.includes('pandash')||/pandash|dangerous/.test(route))return'pandash';if(text.includes('sortab')||/sortab/.test(route))return'sortability';if(text.includes('related')||/related.?tt/.test(route))return'related';if(text.includes('image'))return'images';if(text.includes('create issue'))return'create';if(text.includes('issue')&&text.includes('fc'))return'issue';return'unknown';};
  const setValue=async(el,value,run)=>{if(run!==generation||!el||!visible(el)||el.disabled||el.readOnly)return false;let proto=el,setter=null;while((proto=Object.getPrototypeOf(proto))&&!setter)setter=Object.getOwnPropertyDescriptor(proto,'value')?.set||null;if(setter)setter.call(el,String(value??''));else el.value=String(value??'');el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>requestAnimationFrame(resolve));return run===generation&&C.clean(el.value)===C.clean(value);};
  const choose=payload=>{const po=payload?.poLineQuantity,live=payload?.liveInventoryQuantity,poOk=Number.isFinite(po)&&po>0,liveOk=Number.isFinite(live)&&live>0;if(poOk&&liveOk&&po!==live)return{value:null,reason:'PO qty '+po+' ≠ live inventory '+live,po,live};if(poOk&&liveOk)return{value:po,reason:'PO/live agree'};if(liveOk)return{value:live,reason:'live inventory only'};if(poOk)return{value:po,reason:'PO only'};return{value:null,reason:'No positive quantity',po:poOk?po:null,live:liveOk?live:null};};
  const arm=previous=>{const runId=generation;watcher?.disconnect();let queued=false;watcher=life.observe(V3.native.root(),records=>{if(runId!==generation)return;if(records.every(record=>record.target.closest?.('[data-bwu2-ui]')))return;if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;if(runId!==generation)return;const current=page();if(current&&current!=='unknown'&&current!==previous){watcher?.disconnect();watcher=null;void run();}});},{childList:true,subtree:true,attributes:true,attributeFilter:['label','disabled','aria-label','data-step']});};

  const render=async(message='')=>{
    const renderId=generation,payload=await store.get('payload',null);if(renderId!==generation)return;const root=document.createElement('div');let chooser='';
    if(severity)chooser='<section class="v3-section"><b>⚠ QUANTITY DISAGREEMENT</b><div class="v3-note v3-warn">'+C.esc(severity.reason)+'</div><div class="v3-grid" style="margin-top:8px">'+(severity.po!=null?'<button class="v3-btn" data-po><b style="font-size:22px">'+severity.po+'</b><br>PO LINE</button>':'')+(severity.live!=null?'<button class="v3-btn" data-live><b style="font-size:22px">'+severity.live+'</b><br>LIVE INVENTORY</button>':'')+'</div><div class="v3-row" style="margin-top:8px"><input class="v3-input" type="number" min="0" data-manual placeholder="Manual qty"><button class="v3-btn" data-apply>APPLY MANUAL</button></div>'+(severity.selected!=null?'<div class="v3-note v3-ok" style="margin-top:8px"><b>FILLED: '+severity.selected+' · '+C.esc(severity.source)+'</b><br>Review RIVER, then click native Next.</div>':'')+'</section>';
    root.innerHTML='<section class="v3-section"><b>RIVER Assistant</b><div class="v3-note">Item: '+C.esc(payload?.fnsku||payload?.asin||'NO CAPTURE')+'</div><div class="v3-note">'+C.esc(message||('Current: '+(label()||page())))+'</div><div class="v3-row" style="margin-top:8px"><button class="v3-btn primary" data-run>RUN</button><button class="v3-btn danger" data-clear>CLEAR</button></div></section>'+chooser;panel.set(root);
    root.querySelector('[data-run]').onclick=run;root.querySelector('[data-clear]').onclick=async()=>{generation++;severity=null;watcher?.disconnect();watcher=null;await store.set('payload',null);render('CLEARED');};
    const apply=async(value,source)=>{const runId=generation,qty=Number(value),units=field(['units impacted','number of units impacted']),shipments=field(['shipments impacted','number of shipments impacted']);if(!Number.isInteger(qty)||qty<0)return render('Enter whole quantity 0+');if(!await setValue(units,qty,runId)||!await setValue(shipments,0,runId)){if(runId===generation)return render('RIVER did not retain quantity');return;}if(runId!==generation)return;severity={...severity,selected:qty,source};telemetry.emit('river.severity.choice',{value:qty,source});await render('Units impacted = '+qty+' ('+source+'). Review RIVER, then click Next.');arm('severity');};
    root.querySelector('[data-po]')?.addEventListener('click',()=>apply(severity.po,'PO'));root.querySelector('[data-live]')?.addEventListener('click',()=>apply(severity.live,'LIVE'));root.querySelector('[data-apply]')?.addEventListener('click',()=>apply(root.querySelector('[data-manual]').value,'MANUAL'));root.querySelector('[data-manual]')?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void apply(event.currentTarget.value,'MANUAL');}});
  };

  async function run(){
    const runId=++generation;watcher?.disconnect();watcher=null;const payload=await store.get('payload',null);if(runId!==generation)return;if(!payload)return render('No FCR capture');const current=page();telemetry.emit('river.step',{page:current,label:label()});
    if(['pandash','sortability','related','images','issue','create','unknown'].includes(current))return render(current.toUpperCase()+' stays manual — complete/review it, then native Next or RUN');
    if(current==='asin'){if(!await setValue(field(['type asin here','asin']),payload.asin,runId))return render('ASIN field not ready');if(runId!==generation)return;nextButton()?.click();arm('asin');return;}
    if(current==='information'){
      const pairs=[[['x0 asin','fnsku','asin/fnsku'],payload.fnsku],[['purchase order','po'],payload.purchaseOrder],[['vendor code / seller id','vendor code','seller id'],payload.vendorCode],[['inventory cost per unit','inventory cost'],payload.inventoryCost],[['physical location of the units','physical location'],payload.physicalLocation],[['asin title','product title','title'],payload.title]];
      for(const [aliases,value] of pairs){if(runId!==generation)return;const input=field(aliases);if(!input||!await setValue(input,value||'N/A',runId))return render('Information field not ready: '+aliases[0]);}
      if(runId!==generation)return;const next=nextButton();if(!next)return render('Information filled — review and click Next');next.click();arm('information');return;
    }
    if(current==='severity'){
      const choice=choose(payload),shipments=field(['shipments impacted','number of shipments impacted']);
      if(!choice.value){if(shipments)await setValue(shipments,0,runId);if(runId!==generation)return;severity={...choice,selected:null,source:''};return render('Choose Units impacted');}
      severity=null;const units=field(['units impacted','number of units impacted']);if(!await setValue(units,choice.value,runId)||!await setValue(shipments,0,runId))return render('Severity fields not ready');if(runId!==generation)return;const next=nextButton();if(next){next.click();arm('severity');}else render('Severity filled — review and click Next');
    }
  }

  C.dockButton({id:'river',label:'RIVER',title:'V3 RIVER Assistant',onClick:()=>{void render().then(()=>panel.open());}});
};

if(typeof V3.boot!=='function')throw new Error('V3 boot missing');
V3.boot();
})();
