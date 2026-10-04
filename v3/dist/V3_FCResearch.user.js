// ==UserScript==
// @name         V3 | BWU2 FCResearch
// @name:en      V3 | BWU2 FCResearch
// @namespace    https://github.com/1Sirkkris/-tampermonkey-v2/v3-groundup
// @version      0.2.0
// @description  FCResearch-native BWU2 tools: Tote Audit, Bin Check, Pandash, MoveContainer, Unbind and exact print.
// @include      /^https?:\/\/.*fcresearch.*\//
// @include      /^https?:\/\/qifcr\.fe\.aftx\.amazonoperations\.app\//
// @include      /^https:\/\/jp\.item-measurement\.aft\.a2z\.com\//
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @grant        GM_openInTab
// @grant        unsafeWindow
// @connect      pandash.amazon.com
// @connect      aft-moveapp-nrt-nrt.nrt.proxy.amazon.com
// @connect      tx-b-hierarchy-nrt.nrt.proxy.amazon.com
// @connect      localhost
// @connect      aft-poirot-website-nrt.nrt.proxy.amazon.com
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-groundup/v3/dist/V3_FCResearch.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-groundup/v3/dist/V3_FCResearch.user.js
// @v3-build     fcr-0.2.0-c69ae18c
// ==/UserScript==

(()=>{
'use strict';
const V3=Object.create(null);
V3.build=Object.freeze({"id":"fcr-0.2.0-c69ae18c","version":"0.2.0"});

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

// ---- src/actions.js ----
V3.actions=(()=>{
  const C=V3.core;
  const MOVE_ORIGIN='https://aft-moveapp-nrt-nrt.nrt.proxy.amazon.com';
  const HIERARCHY_ORIGIN='https://tx-b-hierarchy-nrt.nrt.proxy.amazon.com';
  const WAREHOUSE='BWU2';
  const MOVE_PATH='/api/move-container';
  const HIERARCHY={validate:'/validateContainer',summary:'/getTransshipmentBindingSummary',unbind:'/unbindContainer',destination:'/validateDestination'};
  const FLOORS=['P1','P2','P3','P4'];
  const UPPER=[
    {key:'Cubiscan',label:'Cubiscan',pattern:'dz-Pcubiscan-{floor}'},
    {key:'Damages',label:'Damages',pattern:'dz-P-Damages-{floor}'},
    {key:'Hazmat',label:'Hazmat',pattern:'dz-P-Hazmat-{floor}'},
    {key:'ISS',label:'ISS',pattern:'dz-P-ISS-{floor}'},
    {key:'Non-Sort',label:'Non-Sort',pattern:'dz-Pnonsort-{floor}'},
    {key:'Prep',label:'Prep',pattern:'dz-P-Prep-{floor}'}
  ];
  const P1=[
    {key:'P1-Hazmat',label:'Hazmat',dest:'dz-P-HAZMAT_OUT'},
    {key:'P1-Ticketland',label:'Ticketland',dest:'dz-P-Ticketland'},
    {key:'P1-Consolidation',label:'Consolidation',dest:'dz-P-issconsol'},
    {key:'P1-ISS-WIP',label:'ISS WIP',dest:'dz-S-ISSWIP1'},
    {key:'P1-Nonsort',label:'Nonsort',dest:'dz-P-IB-nonsort'},
    {key:'P1-Shipdock',label:'Shipdock',dest:'dz-P-ISS-Shipdock'},
    {key:'P1-OBIOL',label:'OB IOL',dest:'dz-P-OBIOL'},
    {key:'P1-Damageland',label:'Damageland',dest:'dz-Pdamageland'},
    {key:'P1-Receive-Damages',label:'Receive Damages',dest:'dz-P-rcv-Damages'}
  ];

  const dropChoices=floor=>floor==='P1'?P1:UPPER;
  const destination=(floor,key)=>{
    if(key==='PRIME'||key==='Prime')return'dz-P-PRIME';
    if(!FLOORS.includes(floor))return'';
    const row=dropChoices(floor).find(x=>x.key===key||x.label===key);
    return row?(floor==='P1'?row.dest:row.pattern.replace('{floor}',floor)):'';
  };

  const movePayload=(container,dest)=>({sourceScannableId:null,destinationScannableId:C.clean(dest),containerScannableId:C.clean(container),confirmed:'true'});
  const strictMoveConfirmation=result=>{
    if(!result||!Number.isInteger(Number(result.status))||Number(result.status)<=0||Number(result.status)>=500||Number(result.status)===408)throw new C.UnknownError('MoveContainer outcome unknown HTTP '+Number(result?.status||0));
    if(Number(result.status)<200||Number(result.status)>=300)throw new C.RejectedError('MoveContainer rejected HTTP '+Number(result.status));
    if(result.flags?.auth||result.flags?.html)throw new C.UnknownError('MoveContainer confirmation was an authentication/HTML response');
    const expected=new URL(MOVE_ORIGIN+MOVE_PATH);
    const actual=new URL(result.finalUrl||expected.href,expected.href);
    if(actual.origin!==expected.origin||actual.pathname.replace(/\/+$/,'')!==expected.pathname.replace(/\/+$/,''))throw new C.UnknownError('MoveContainer confirmation redirected unexpectedly');
    if(result.data?.success===false||result.data?.error||result.data?.errorMessage)throw new C.RejectedError(C.clean(result.data.message||result.data.errorMessage||'MoveContainer rejected'));
    if(C.clean(result.raw)&&!(result.data?.success===true||result.data?.status==='SUCCESS'))throw new C.UnknownError('MoveContainer response not recognized — verify before retry');
    return result;
  };
  async function moveContainer(container,dest,{telemetry,maySubmit=()=>true}={}){
    const code=C.clean(container),target=C.clean(dest);
    if(!C.container(code))throw new Error('Container must be tsX/csX');
    if(!target)throw new Error('Destination required');
    if(!maySubmit())throw Object.assign(new Error('Paused before Move submission'),{outcome:'cancelled'});
    const op=C.operation({kind:'move-container',ref:code,scope:'movecontainer',telemetry});op.submitted({destination:target});
    let result;
    try{
      result=await C.request(MOVE_ORIGIN+MOVE_PATH,{method:'POST',body:JSON.stringify(movePayload(code,target)),headers:{'Content-Type':'application/json'},timeout:15000,allowHttpError:true});
    }catch(error){op.unknown({reason:'transport'});throw new C.UnknownError('Move submitted; confirmation lost — verify before retry',{cause:error});}
    try{
      strictMoveConfirmation(result);
      op.confirmed({status:result.status,destination:target});
      return result;
    }catch(error){
      if(error instanceof C.RejectedError){op.rejected({status:result.status});throw error;}
      op.unknown({status:result.status,reason:C.clean(error.message)});throw error;
    }
  }

  async function hierarchyPost(path,body,{timeout=15000,allowHttpError=false}={}){
    return C.request(HIERARCHY_ORIGIN+path,{method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json'},timeout,allowHttpError});
  }
  async function validateContainer(container){
    const code=C.clean(container),r=await hierarchyPost(HIERARCHY.validate,{warehouseId:WAREHOUSE,scannableId:code});
    if(!r.data||typeof r.data!=='object')throw new Error('Unexpected hierarchy validation response');
    if(C.upper(r.data.warehouseId)!==WAREHOUSE)throw new Error('Container is not validated in '+WAREHOUSE);
    if(C.lower(r.data.scannableId)!==C.lower(code))throw new Error('Validation returned another container');
    return r.data;
  }
  async function bindingSummary(container){
    const code=C.clean(container),r=await hierarchyPost(HIERARCHY.summary,{warehouseId:WAREHOUSE,scannableId:code});
    if(!Array.isArray(r.data?.transferBindingSummaryList))throw new Error('Unexpected binding summary');
    return r.data;
  }
  async function unbind(container,login,{telemetry,maySubmit=()=>true}={}){
    const code=C.clean(container),employee=C.normLogin(login);
    if(!C.container(code))throw new Error('Container must be tsX/csX');
    if(!employee)throw new Error('Authenticated employee identity unavailable');
    await validateContainer(code);await bindingSummary(code);
    if(!maySubmit())throw Object.assign(new Error('Paused before Unbind submission'),{outcome:'cancelled'});
    const op=C.operation({kind:'hierarchy-unbind',ref:code,scope:'hierarchy',telemetry});op.submitted();
    let r;
    try{r=await hierarchyPost(HIERARCHY.unbind,{sourceWarehouseId:WAREHOUSE,scannableId:code,employeeLogin:employee},{timeout:20000,allowHttpError:true});}
    catch(error){op.unknown({reason:'transport'});throw new C.UnknownError('Unbind submitted; confirmation lost — verify before retry',{cause:error});}
    if(r.status>=500||r.status===408){op.unknown({status:r.status});throw new C.UnknownError('Unbind HTTP '+r.status+' — verify before retry');}
    if(r.status<200||r.status>=300){op.rejected({status:r.status});throw new C.RejectedError('Unbind rejected HTTP '+r.status);}
    if(!C.clean(r.data?.hostName)){op.unknown({reason:'unexpected-response'});throw new C.UnknownError('Unbind response ambiguous — verify container');}
    op.confirmed({status:r.status});return r.data;
  }

  // Bind deliberately uses the native page. The only native network traffic observed
  // is /validateDestination, solely to map the user's typed FC to Amazon's opaque ID.
  const FACILITY=/^[A-Z0-9]{3,8}$/;
  const normalizeFacility=value=>{const fc=C.upper(value);return FACILITY.test(fc)?fc:'';};
  let destinationSeq=0,destinationRevision=0;
  const destinationProofs=[];
  const endpointPath=value=>{try{const url=new URL(String(value||''),location.href);return url.origin===HIERARCHY_ORIGIN?url.pathname:'';}catch{return'';}};
  const tokenFromBody=body=>{
    if(body==null)return'';
    if(typeof body==='object'){
      try{
        if(typeof FormData!=='undefined'&&body instanceof FormData)return C.clean(body.get('destinationWarehouseId'));
        if(typeof URLSearchParams!=='undefined'&&body instanceof URLSearchParams)return C.clean(body.get('destinationWarehouseId'));
        return C.clean(body.destinationWarehouseId);
      }catch{return'';}
    }
    const raw=String(body);
    try{return C.clean(JSON.parse(raw)?.destinationWarehouseId);}catch{}
    const match=raw.match(/(?:^|&)destinationWarehouseId=([^&]*)/);
    if(!match)return'';
    try{return C.clean(decodeURIComponent(match[1].replace(/\+/g,' ')));}catch{return C.clean(match[1]);}
  };
  const facilityFromResponse=raw=>{
    let value=raw;
    if(typeof raw==='string'){try{value=JSON.parse(raw);}catch{}}
    if(typeof value==='string')return normalizeFacility(value);
    if(value&&typeof value==='object')return normalizeFacility(value.warehouseId||value.destination||value.facility||value.fc||'');
    return'';
  };
  const recordDestination=(token,facility,status)=>{if(!token||!facility)return;destinationProofs.push({seq:++destinationSeq,token,facility,status:Number(status)||0,at:Date.now()});if(destinationProofs.length>12)destinationProofs.splice(0,destinationProofs.length-12);window.dispatchEvent(new Event('bwu2-v3:destination-validation'));};
  function installDestinationTap(){
    const page=typeof unsafeWindow==='object'&&unsafeWindow?unsafeWindow:window;
    try{
      const XHR=page.XMLHttpRequest;
      if(XHR?.prototype&&!XHR.prototype.__bwu2V3GroundDestinationTap){
        const nativeOpen=XHR.prototype.open,nativeSend=XHR.prototype.send;
        XHR.prototype.open=function(method,url){this.__bwu2V3GroundDestinationPath=endpointPath(url);return nativeOpen.apply(this,arguments);};
        XHR.prototype.send=function(body){
          if(this.__bwu2V3GroundDestinationPath!==HIERARCHY.destination)return nativeSend.apply(this,arguments);
          const token=tokenFromBody(body);
          this.addEventListener('loadend',()=>{let raw='';try{if(!this.responseType||this.responseType==='text')raw=this.responseText||'';else if(this.responseType==='json')raw=JSON.stringify(this.response??null);}catch{}recordDestination(token,facilityFromResponse(raw),this.status);},{once:true});
          return nativeSend.apply(this,arguments);
        };
        Object.defineProperty(XHR.prototype,'__bwu2V3GroundDestinationTap',{value:true,configurable:true});
      }
    }catch{}
    try{
      const nativeFetch=page.fetch;
      if(typeof nativeFetch==='function'&&!nativeFetch.__bwu2V3GroundDestinationTap){
        const wrapped=async function(input,init={}){
          const rawUrl=typeof input==='string'||input instanceof URL?String(input):String(input?.url||'');
          if(endpointPath(rawUrl)!==HIERARCHY.destination)return nativeFetch.apply(this,arguments);
          const token=tokenFromBody(init?.body),response=await nativeFetch.apply(this,arguments);
          let raw='';try{raw=await response.clone().text();}catch{}
          recordDestination(token,facilityFromResponse(raw),response.status);return response;
        };
        Object.defineProperty(wrapped,'__bwu2V3GroundDestinationTap',{value:true});
        page.fetch=wrapped;
      }
    }catch{}
  }

  const visible=element=>V3.native.visible(element);
  const findDestinationInput=()=>V3.native.findInput(/destination|warehouse|facility|\bfc\b/,/container|scannable|tote/);
  const findContainerInput=()=>V3.native.findInput(/container|scannable|scan|tote/,/destination|warehouse|facility|\bfc\b/);
  const setNative=(input,value)=>{V3.native.setValue(input,value);return true;};
  const pressEnter=async(input)=>V3.native.enter(input);
  const statusText=()=>V3.native.status();
  const errorText=()=>{const text=statusText();return /error|invalid|failed|cannot|unable|reject|not found/i.test(text)?text:'';};
  const pageText=()=>V3.native.text();
  const waitFor=(predicate,options)=>V3.native.waitFor(predicate,options);

  async function validateDestinationNative(destination,{life,telemetry}={}){
    const fc=normalizeFacility(destination);if(!fc)throw new Error('Enter destination FC, e.g. BWU1 or AVV2');
    installDestinationTap();const marker=destinationSeq,previousStatus=statusText(),input=findDestinationInput();if(!input)throw new Error('Native destination field not found');
    if(!input.dataset.v3DestinationRevision){input.dataset.v3DestinationRevision='1';input.addEventListener('input',()=>{destinationRevision++;});input.addEventListener('change',()=>{destinationRevision++;});}
    if(!setNative(input,fc))throw new Error('Could not enter destination FC');try{input.focus({preventScroll:true});}catch{}await pressEnter(input,life);
    telemetry?.emit('hierarchy.destination.submit',{destination:fc});
    const proof=await waitFor(()=>{const error=errorText();if(error&&error!==previousStatus)throw new Error(error);return destinationProofs.find(x=>x.seq>marker&&x.facility===fc&&x.status>=200&&x.status<300&&x.token);},{life,timeout:10000,events:['bwu2-v3:destination-validation']});
    telemetry?.emit('hierarchy.destination.validated',{destination:fc});
    return Object.freeze({facility:fc,destinationWarehouseId:proof.token,proofSeq:proof.seq,revision:destinationRevision});
  }

  const nativeScan=async(container,life)=>{const input=findContainerInput();if(!input)throw new Error('Native container scan field not found');if(!setNative(input,container))throw new Error('Could not enter container');try{input.focus({preventScroll:true});}catch{}const before=pageText();await pressEnter(input,life);return before;};
  async function bindNative(container,context,{life,telemetry,maySubmit=()=>true}={}){
    const code=C.clean(container),fc=normalizeFacility(context?.facility);if(!C.container(code))throw new Error('Container must be tsX/csX');if(!fc||!C.clean(context?.destinationWarehouseId))throw new Error('Destination must be validated before Bind');
    const latest=destinationProofs.at(-1);if(context.revision!==destinationRevision||latest?.seq!==context.proofSeq||latest?.facility!==fc||latest?.token!==context.destinationWarehouseId)throw new Error('Destination changed — fresh native validation required');
    const before1=await nativeScan(code,life);
    await waitFor(()=>{const error=errorText();if(error)throw new C.RejectedError(error);const text=pageText(),input=findContainerInput();return text!==before1&&input&&visible(input)&&!input.disabled&&C.clean(input.value)!==code;},{life,timeout:12000,});
    if(!maySubmit())throw Object.assign(new Error('Paused before Bind submission'),{outcome:'cancelled'});
    if(context.revision!==destinationRevision)throw new Error('Destination changed before Bind — validate again');
    const op=C.operation({kind:'hierarchy-bind',ref:code,scope:'hierarchy',telemetry});op.submitted({destination:fc});
    const previousStatus=statusText();
    try{await nativeScan(code,life);
      const proof=await waitFor(()=>{const error=errorText();if(error)throw new C.RejectedError(error);const status=statusText();return status!==previousStatus&&/(?:successfully|container.*bound|binding.*complete)/i.test(status)?status:'';},{life,timeout:15000,});
      op.confirmed({destination:fc,proof:C.clean(proof).slice(0,100)});return{container:code,destination:fc};
    }catch(error){
      if(error instanceof C.RejectedError){op.rejected({reason:C.clean(error.message)});throw error;}
      op.unknown({reason:'native-confirmation-missing'});throw new C.UnknownError('Bind submitted but native page did not prove success — verify container',{cause:error});
    }
  }

  const ownedMove=(...args)=>V3.state.exclusive('movecontainer',()=>{V3.state.assertClear('movecontainer');return moveContainer(...args);});
  const ownedUnbind=(...args)=>V3.state.exclusive('hierarchy',()=>{V3.state.assertClear('hierarchy');return unbind(...args);});
  const ownedBind=(...args)=>V3.state.exclusive('hierarchy',()=>{V3.state.assertClear('hierarchy');return bindNative(...args);});
  return Object.freeze({MOVE_ORIGIN,HIERARCHY_ORIGIN,WAREHOUSE,FLOORS,UPPER,P1,dropChoices,destination,movePayload,strictMoveConfirmation,moveContainer:ownedMove,validateContainer,bindingSummary,unbind:ownedUnbind,normalizeFacility,tokenFromBody,facilityFromResponse,validateDestinationNative,bindNative:ownedBind});
})();

// ---- src/bridge.js ----
V3.bridge = (() => {
  const C = V3.core, PROTOCOL = 'bwu2.v3.bridge';
  function client({origin, path, family, life, onEvent} = {}) {
    let frame, ready = false, waiting = null;
    const pending = new Map();
    const post = message => frame.contentWindow.postMessage({protocol: PROTOCOL, family, ...message}, origin);
    const ensureReady = () => {
      if (ready) return Promise.resolve();
      if (waiting) return waiting.promise;
      let resolve, reject;
      const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
      const timer = setTimeout(() => { waiting = null; reject(new Error(family + ' worker not ready — open its native page and sign in')); }, 20000);
      waiting = {promise, reject:()=>{clearTimeout(timer);reject(new Error('Worker startup cancelled'));},resolve: () => { clearTimeout(timer); waiting = null; resolve(); }};
      if (!frame?.isConnected) {
        frame = document.createElement('iframe'); frame.hidden = true; frame.tabIndex = -1;
        frame.setAttribute('aria-hidden', 'true'); frame.src = origin + path + '#v3-' + family + '-worker';
        life.on(frame, 'load', () => { ready = false; post({type: 'ping'}); });
        document.body.appendChild(frame);
      } else post({type: 'ping'});
      return promise;
    };
    const arm = (id, job) => { clearTimeout(job.timer); job.timer = setTimeout(() => {
      pending.delete(id); job.reject(new C.UnknownError(family + ' worker confirmation lost — verify before retry', {aftPartial: job.partial}));
    }, 210000); };
    life.on(window, 'message', event => {
      if (event.origin !== origin || event.source !== frame?.contentWindow) return;
      const msg = event.data; if (msg?.protocol !== PROTOCOL || msg.family !== family) return;
      if (msg.type === 'ready') { ready = true; waiting?.resolve(); return; }
      if (msg.type === 'event') { onEvent?.(msg.detail); return; }
      const job = pending.get(msg.id); if (!job) return;
      if (msg.type === 'progress') { arm(msg.id, job); job.partial = msg.progress; job.onProgress?.(msg.progress); return; }
      if (msg.type !== 'result') return;
      pending.delete(msg.id); clearTimeout(job.timer);
      if (msg.ok) job.resolve(msg.data);
      else { const Type = msg.outcome === 'unknown' ? C.UnknownError : msg.outcome === 'rejected' ? C.RejectedError : Error;
        const error = new Type(msg.error || family + ' worker failed'); error.aftPartial = msg.partial; job.reject(error); }
    });
    life.own(() => {waiting?.reject();waiting=null; for (const job of pending.values()) {
      clearTimeout(job.timer); job.reject(new C.UnknownError('Worker page closed — verify active workflow'));
    } pending.clear(); frame?.remove(); });
    return Object.freeze({async run(command, input = {}) {
      const {onProgress, ...payload} = input;
      const clone = structuredClone(payload); await ensureReady(); const id = C.id('rpc');
      return new Promise((resolve, reject) => { const job = {resolve, reject, onProgress, partial: null}; pending.set(id, job); arm(id, job);
        try { post({type: 'run', id, command, payload: clone}); }
        catch (error) { pending.delete(id); clearTimeout(job.timer); reject(error); }
      });
    }, stop() { if (ready) post({type: 'stop'}); }});
  }
  function server({family, life, commands, stop, allowed} = {}) {
    let busy = false, parentOrigin = '';
    const send = (source, origin, message) => source.postMessage({protocol: PROTOCOL, family, ...message}, origin);
    life.on(window, 'message', async event => {
      if (event.source !== window.parent || !allowed(event.origin)) return;
      const msg = event.data; if (msg?.protocol !== PROTOCOL || msg.family !== family) return;
      if (msg.type === 'ping') { parentOrigin = event.origin; send(event.source, event.origin, {type: 'ready'}); return; }
      if (msg.type === 'stop') { stop?.(); return; }
      if (msg.type !== 'run' || !msg.id) return;
      const answer = result => send(event.source, event.origin, {type: 'result', id: msg.id, ...result});
      if (busy) { answer({ok: false, error: 'Worker busy'}); return; }
      const run = commands[msg.command]; if (!run) { answer({ok: false, error: 'Unsupported command'}); return; }
      busy = true;
      try { const data = await run({...msg.payload, onProgress: progress => send(event.source, event.origin, {type: 'progress', id: msg.id, progress})}); answer({ok: true, data}); }
      catch (error) { answer({ok: false, error: C.clean(error.message || error), outcome: error.outcome || '', partial: error.aftPartial || null}); }
      finally { busy = false; }
    });
    life.on(window, 'bwu2-v3:event', event => { if (parentOrigin) send(window.parent, parentOrigin, {type: 'event', detail: event.detail}); });
  }
  const isFCR=origin=>{try{return ['fcresearch-fe.aka.amazon.com','qi-fcresearch-fe.corp.amazon.com','qi-fcresearch-jp.corp.amazon.com','qifcr.fe.aftx.amazonoperations.app'].includes(new URL(origin).hostname);}catch{return false;}};
  return Object.freeze({client, server,isFCR});
})();

// ---- src/measurement.js ----
V3.measurement = (() => {
  const C=V3.core,SITE='https://jp.item-measurement.aft.a2z.com',API='o0avbo02yl.execute-api.ap-northeast-1.amazonaws.com',WINDOW=30*86400000;
  const route=value=>{try{const url=new URL(value,location.href),match=url.pathname.match(/^\/prod\/measurementEvents\/([^/]+)\/(FNSKU|ASIN)$/i);return url.hostname===API&&match?{url,identifier:C.upper(decodeURIComponent(match[1])),type:C.upper(match[2])}:null;}catch{return null;}};
  const classify=(payload,request,now=Date.now())=>{
    if(!Array.isArray(payload?.measurementEvents))throw new Error('Measurement history response missing events');
    const events=payload.measurementEvents,yes=events.some(event=>C.upper(event.measurementSource)==='MADCAT'&&Date.parse(event.measurementInstant)>=now-WINDOW&&Date.parse(event.measurementInstant)<=now);
    const after=Date.parse(request.url.searchParams.get('effectiveAfter')),before=Date.parse(request.url.searchParams.get('effectiveBefore'));
    const complete=!C.clean(payload.nextToken)&&!request.url.searchParams.get('nextToken')&&after<=now-WINDOW&&before>=now-60000;
    return {identifier:request.identifier,madcat:yes?true:complete?false:null,source:'raw',at:now};
  };
  function native({life}={}){
    const page=typeof unsafeWindow==='object'?unsafeWindow:window,store=C.store('measurement',1),cache=new Map();
    const accept=async(url,payload,status)=>{const request=route(url);if(!request||status<200||status>=300)return;try{const value=classify(payload,request);cache.set(value.identifier,value);await store.set(value.identifier,value);window.dispatchEvent(new Event('bwu2-v3:measurement'));}catch(error){C.telemetry('measurement',V3.build.version).emit('read.error',{message:error.message});}};
    // Observe only the native measurement response. Never inspect request headers, cookies or auth tokens.
    const original=page.fetch;if(typeof original==='function'){const wrapped=async function(input,options){const url=typeof input==='string'?input:input?.url||String(input);const response=await original.apply(this,arguments);if(route(url))void response.clone().json().then(payload=>accept(url,payload,response.status)).catch(()=>{});return response;};page.fetch=wrapped;life.own(()=>{if(page.fetch===wrapped)page.fetch=original;});}
    const prototype=page.XMLHttpRequest?.prototype;if(prototype){const open=prototype.open,send=prototype.send,requests=new WeakMap();const wrappedOpen=function(method,url){requests.set(this,route(url)?String(url):'');return open.apply(this,arguments);};const wrappedSend=function(){const url=requests.get(this);if(url)this.addEventListener('load',()=>{try{const payload=this.responseType==='json'?this.response:JSON.parse(this.responseText);void accept(url,payload,this.status);}catch{}},{once:true});return send.apply(this,arguments);};prototype.open=wrappedOpen;prototype.send=wrappedSend;life.own(()=>{if(prototype.open===wrappedOpen)prototype.open=open;if(prototype.send===wrappedSend)prototype.send=send;});}
    V3.bridge.server({family:'measurement',life,allowed:V3.bridge.isFCR,commands:{lookup:async({identifier})=>{
      const code=C.upper(identifier);return V3.native.waitFor(()=>cache.get(code)||false,{life,target:document.documentElement,events:['bwu2-v3:measurement'],timeout:12000});
    }}});
  }
  function create({life}={}) {
    const store=C.store('measurement',1),clients=new Map();
    const lookup=async(identifier,force=false)=>{const code=C.upper(identifier);if(!/^[A-Z0-9]{10}$/.test(code))throw new Error('Exact measurement identifier required');const saved=await store.get(code,null);if(!force&&saved&&Date.now()-saved.at<300000&&saved.madcat!=null)return saved;
      let client=clients.get(code);if(!client){client=V3.bridge.client({origin:SITE,path:'/item/'+encodeURIComponent(code),family:'measurement',life});clients.set(code,client);}const value=await client.run('lookup',{identifier:code});if(value.madcat==null)throw new Error('Native measurement history incomplete — open Measurement and review');return value;};
    return Object.freeze({lookup,open:identifier=>{const url=SITE+'/item/'+encodeURIComponent(identifier);if(typeof GM_openInTab==='function')GM_openInTab(url,{active:true,insert:true});else window.open(url,'_blank','noopener');}});
  }
  return Object.freeze({SITE,route,classify,native,create});
})();

// ---- src/fcr-native.js ----
V3.fcrNative = (() => {
  const C=V3.core;
  const exactBin=(payload,aliases)=>{
    const wanted=new Set(aliases.map(C.upper).filter(Boolean)),matches=(payload?.items||[]).filter(item=>[item.scannableId,item.value,item.scannedBarcode,item.skuDetail?.fnSku,item.skuDetail?.asin,item.skuDetail?.fcSku].map(C.upper).some(code=>wanted.has(code)));
    const sizes=[...new Set(matches.map(item=>C.clean(item.binDescription)).filter(Boolean))];if(sizes.length!==1)throw new Error(sizes.length?'Conflicting exact-item bin descriptions':'No exact-item bin description');return sizes[0];
  };
  function mount({life,telemetry,fcr,print,move,unbind}={}) {
    const measurement=V3.measurement.create({life}),mounted=new WeakSet();let hoverGeneration=0;
    const message=document.createElement('div');message.dataset.bwu2Ui='1';message.className='v3-note';
    const readBin=async(product,inventory)=>{const aliases=[product.asin,product.isbn,product.fnsku,product.fcsku],wanted=new Set(aliases.map(C.upper).filter(Boolean));
      const row=V3.fcr.inventoryRows({querySelector:()=>inventory}).find(row=>[row.asin,row.fnsku,row.fcsku].map(C.upper).some(code=>wanted.has(code))&&C.container(row.container));
      if(!row)throw new Error('No exact-item native inventory container');
      const response=await C.request('https://aft-poirot-website-nrt.nrt.proxy.amazon.com/api/scanitem',{method:'POST',body:JSON.stringify({containerScannableId:row.container,itemBarcode:product.fnsku||product.asin,isMasterpack:null,itemAndonContext:null,requestId:'amzn1.fc.v1.common.request-id.v1.AFTPoirotWebsite.'+crypto.randomUUID(),tool:'V3'}),headers:{'Content-Type':'application/json'},signal:life.signal});return exactBin(response.data,aliases);
    };
    const decorateProduct=async table=>{if(mounted.has(table))return;mounted.add(table);const product=V3.fcr.product(table.outerHTML);if(!product)return;
      const strip=document.createElement('div');strip.dataset.bwu2Ui='1';strip.className='v3-row';strip.innerHTML='<b>V3 '+C.esc(V3.build.version)+'</b><span>Sortable: '+C.esc(product.sortableText||'UNKNOWN')+'</span><span>'+C.esc(product.dimensions)+(product.suspicious?' · CHECK DIMENSIONS':'')+'</span><button class="v3-btn" data-size>Size: CHECK…</button><button class="v3-btn" data-madcat>Madcat: CHECK…</button><span data-msg></span>';table.after(strip);
      const size=strip.querySelector('[data-size]'),madcat=strip.querySelector('[data-madcat]'),msg=strip.querySelector('[data-msg]'),code=product.fnsku||product.asin;let sizeBusy=false,madcatBusy=false;
      const bin=async()=>{if(sizeBusy)return;sizeBusy=true;size.textContent='Size: CHECK…';try{const inventory=await V3.native.waitFor(()=>document.querySelector('#table-inventory'),{life,timeout:12000});const value=await readBin(product,inventory);if(strip.isConnected)size.textContent='Size: '+value;}catch(error){size.textContent='Size: ERROR ↻';size.title=error.message;}finally{sizeBusy=false;}};
      const check=async(force=false)=>{if(madcatBusy)return;madcatBusy=true;madcat.textContent='Madcat: CHECK…';try{const value=await measurement.lookup(code,force);if(strip.isConnected){madcat.textContent='Madcat: '+(value.madcat?'YES':'NO');madcat.title='Raw native measurement events · rolling 30 days';}}catch(error){madcat.textContent='Madcat: AUTH / RETRY';madcat.title=error.message+' · click to open native Measurement, then retry';}finally{madcatBusy=false;}};
      size.onclick=()=>void bin();madcat.onclick=()=>{if(madcat.textContent.includes('AUTH'))measurement.open(code);void check(true);};
      void bin();void check();
      for(const row of table.querySelectorAll('tr'))if(/^(ASIN|ISBN|FNSKU|FCSKU)$/i.test(C.clean(row.querySelector('th')?.textContent)))row.querySelector('td')?.setAttribute('data-v3-exact-code',C.clean(row.querySelector('td')?.textContent));
      msg.textContent='';
    };
    const decorateInventory=table=>{if(mounted.has(table))return;mounted.add(table);const current=C.clean(new URL(location.href).searchParams.get('s'));
      const indexes=V3.fcr.inventoryIndexes(table),groups=new Map();for(const row of table.tBodies?.[0]?.rows||[]){const code=index=>C.upper(row.cells[index]?.textContent),container=code(indexes.container)||C.upper(current),fnsku=code(indexes.fnsku),fcsku=code(indexes.fcsku);if(!container||!fnsku||!fcsku)continue;const key=container+'|'+fnsku;if(!groups.has(key))groups.set(key,{rows:[],fcskus:new Set()});groups.get(key).rows.push(row);groups.get(key).fcskus.add(fcsku);}
      const conflicts=[...groups.values()].filter(group=>group.fcskus.size>1);for(const group of conflicts)for(const row of group.rows){row.style.outline='3px solid #8b1d1d';row.style.outlineOffset='-3px';row.title='FCSKU CONFLICT · '+[...group.fcskus].join(' + ');}if(conflicts.length){const badge=document.createElement('b');badge.dataset.bwu2Ui='1';badge.className='v3-bad';badge.textContent='FCSKU CONFLICT: '+conflicts.length;table.before(badge);}
      if(C.container(current)){const strip=document.createElement('div');strip.dataset.bwu2Ui='1';strip.className='v3-row';let floor=localStorage.getItem('bwu2.v3.fcr.floor')||'P2';
        const paint=()=>{strip.innerHTML='<b>MOVE '+C.esc(current)+'</b>'+V3.actions.FLOORS.map(value=>'<button class="v3-btn'+(value===floor?' primary':'')+'" data-floor="'+value+'">'+value+'</button>').join('')+'<span>|</span>'+[{key:'PRIME',label:'PRIME'},...V3.actions.dropChoices(floor)].map(row=>'<button class="v3-btn" data-drop="'+row.key+'">'+C.esc(row.label)+'</button>').join('')+'<button class="v3-btn danger" data-unbind>UNBIND</button>';
          for(const btn of strip.querySelectorAll('[data-floor]'))btn.onclick=()=>{floor=btn.dataset.floor;localStorage.setItem('bwu2.v3.fcr.floor',floor);paint();};
          for(const btn of strip.querySelectorAll('[data-drop]'))btn.onclick=()=>void move.runContext({container:current,destination:V3.actions.destination(floor,btn.dataset.drop)});strip.querySelector('[data-unbind]').onclick=()=>void unbind.runContext({container:current});};paint();table.before(strip,message);
      }
      const hover=document.createElement('div');hover.dataset.bwu2Ui='1';hover.hidden=true;hover.className='v3-section';hover.style.cssText='position:fixed;left:12px;bottom:60px;z-index:2147482998;max-width:460px;pointer-events:none';document.body.appendChild(hover);life.own(()=>hover.remove());
      life.on(table,'mouseover',event=>{const link=event.target.closest('a');if(!link||link.contains(event.relatedTarget))return;const code=C.clean(link.textContent);if(!/^[A-Z0-9]{10}$/i.test(code))return;const generation=++hoverGeneration;
        void fcr.product(code).then(product=>{if(generation!==hoverGeneration||!product)return;hover.innerHTML=(product.img?'<img width="100" src="'+C.esc(product.img)+'" alt="">':'')+'<b>'+C.esc(product.title)+'</b><div>'+C.esc(product.dimensions)+' · '+C.esc(product.weight)+' · Sortable '+C.esc(product.sortableText)+'</div>';hover.hidden=false;}).catch(error=>{if(generation===hoverGeneration)message.textContent=error.message;});});
      life.on(table,'mouseout',event=>{if(event.target.closest('a')&&!event.target.closest('a').contains(event.relatedTarget)){hoverGeneration++;hover.hidden=true;}});
    };
    life.on(document,'click',event=>{if(!event.altKey)return;const cell=event.target.closest('td[data-v3-exact-code],#table-inventory td,#table-product td,.a-keyvalue td');if(!cell||cell.closest('[data-bwu2-ui]'))return;
      const code=C.clean(cell.dataset.v3ExactCode||event.target.closest('a')?.textContent||cell.textContent);if(!/^(?:[A-Z0-9]{10}|(?:ts|cs)x[0-9a-z_-]+|dz-[0-9a-z_-]+)$/i.test(code))return;event.preventDefault();event.stopPropagation();void(async()=>{let title='';if(/^[A-Z0-9]{10}$/i.test(code)){const product=await fcr.product(code);if(product&&[product.asin,product.isbn,product.fnsku,product.fcsku].map(C.upper).includes(C.upper(code)))title=product.title;}await print(code,title);})().then(()=>{message.textContent='Printed '+code;}).catch(error=>{message.textContent='Print failed · '+error.message;});},true);
    life.on(document,'copy',event=>{const selection=window.getSelection();if(!selection||selection.isCollapsed)return;const node=selection.anchorNode?.parentElement,cell=node?.closest('td[data-v3-exact-code]');if(!cell||cell!==selection.focusNode?.parentElement?.closest('td[data-v3-exact-code]'))return;event.clipboardData?.setData('text/plain',cell.dataset.v3ExactCode);event.preventDefault();});
    const sections=[...document.querySelectorAll('[data-section-type]')];for(const section of sections){const endpoint=section.dataset.sectionType;if(!endpoint||endpoint==='product'||endpoint==='inventory')continue;const heading=section.querySelector('h2,h3,.a-box-inner .a-row')||section.firstElementChild;if(!heading)continue;const toggle=document.createElement('button');toggle.className='v3-btn';toggle.dataset.bwu2Ui='1';toggle.textContent='HIDE';heading.appendChild(toggle);toggle.onclick=event=>{event.stopPropagation();const content=section.querySelector('table');if(!content)return;content.hidden=!content.hidden;toggle.textContent=content.hidden?'SHOW':'HIDE';};}
    for(const [selector,decorate] of [['[data-section-type="product"] .a-keyvalue,#table-product,.a-box-group .a-keyvalue',decorateProduct],['#table-inventory',decorateInventory]]){
      const existing=document.querySelector(selector);if(existing)void decorate(existing);else void V3.native.waitFor(()=>document.querySelector(selector),{life,timeout:15000}).then(decorate).catch(error=>{if(error.name!=='AbortError')telemetry.emit('native.section.unavailable',{selector});});
    }
  }
  return Object.freeze({mount,exactBin});
})();

// ---- src/apps/fcr.js ----
V3.boot=()=>{
  const C=V3.core,life=C.lifecycle('fcr'),telemetry=C.telemetry('fcr',V3.build.version),fcr=V3.fcr.create({life,telemetry});
  if(location.origin===V3.measurement.SITE){V3.measurement.native({life});return;}
  if(window.parent!==window)return;
  if(!document.body){life.on(document,'DOMContentLoaded',()=>{life.dispose();V3.boot();},{once:true});return;}
  const current=()=>C.clean(new URL(location.href).searchParams.get('s')||'');
  const print=async(code,title='')=>{
    const value=C.clean(code);if(!value)throw new Error('Barcode required');
    const hex=v=>Array.from(new TextEncoder().encode(String(v??''))).map(b=>b.toString(16).padStart(2,'0')).join('');
    return C.request('http://localhost:5965/printer?action=print&type=barcode&data='+hex(value)+'&text='+hex(value)+'&quantity=1&desc='+hex(C.clean(title))+'&seq='+Date.now(),{timeout:5000,allowHtml:true});
  };

  const currentContainer=()=>C.container(current())?current():'';

  function itemPanel(){
    const panel=C.panel({id:'fcr-item',title:'V3 · FCR Item',width:560,life});let mounted=false;
    return{open(){if(!mounted){mounted=true;const root=document.createElement('div');root.innerHTML='<section class="v3-section"><label class="v3-field">Search code<input data-code></label><div class="v3-row"><button class="v3-btn primary" data-run>LOOKUP</button><button class="v3-btn" data-print>PRINT CODE</button></div><div class="v3-note" data-msg style="margin-top:8px"></div></section><section class="v3-section"><div data-out></div></section>';panel.set(root);const input=root.querySelector('[data-code]'),msg=root.querySelector('[data-msg]'),out=root.querySelector('[data-out]');input.value=current();let last=null;root.querySelector('[data-run]').onclick=async()=>{const code=C.clean(input.value);if(!code)return;msg.textContent='Loading…';try{last=await fcr.product(code);if(!last)throw new Error('Product not found');out.innerHTML='<div class="v3-grid"><div><b>ASIN</b><br>'+C.esc(last.asin||'—')+'</div><div><b>FNSKU</b><br>'+C.esc(last.fnsku||'—')+'</div><div><b>FCSKU</b><br>'+C.esc(last.fcsku||'—')+'</div><div><b>Sortable</b><br>'+C.esc(last.sortableText||'—')+'</div><div><b>Dimensions</b><br>'+C.esc(last.dimensions||'—')+(last.suspicious?' <span class="v3-warn"><b>CHECK</b></span>':'')+'</div><div><b>Weight</b><br>'+C.esc(last.weight||'—')+'</div></div><div style="margin-top:9px"><b>'+C.esc(last.title||'')+'</b></div>';msg.className='v3-note v3-ok';msg.textContent='Ready';}catch(e){msg.className='v3-note v3-bad';msg.textContent=e.message;}};root.querySelector('[data-print]').onclick=async()=>{try{const code=C.clean(input.value),title=last&&[last.asin,last.fnsku,last.fcsku].some(x=>C.upper(x)===C.upper(code))?last.title:'';await print(code,title);msg.textContent='Printed '+code;}catch(e){msg.textContent=e.message;}};}panel.open();}};
  }

  function totePanel(){
    const panel=C.panel({id:'fcr-tote',title:'V3 · Tote Audit',width:760,life});let mounted=false;
    return{open(){if(!mounted){mounted=true;const state={container:'',loading:false,rows:[],lookup:new Map(),pending:[],scans:new Map(),seq:0,message:'Scan source container'};const root=document.createElement('div');root.innerHTML='<section class="v3-section"><div class="v3-note" data-summary>Scan tsX/csX to begin.</div><label class="v3-field">Scanner<input data-scan autocomplete="off"></label><div class="v3-row"><button class="v3-btn" data-reset>NEW TOTE</button></div><div class="v3-note" data-msg></div></section><section class="v3-section"><b>Physical scans</b><div data-scans></div></section><section class="v3-section"><b>System inventory</b><div data-system></div></section>';panel.set(root);const q=s=>root.querySelector(s),scan=q('[data-scan]');
      const lookup=rows=>{const map=new Map();for(const row of rows){row._scan=0;for(const v of [row.asin,row.fnsku,row.fcsku]){const k=C.upper(v);if(!k)continue;if(!map.has(k))map.set(k,[]);map.get(k).push(row);}}return map;};
      const allocate=(rows,n=1)=>{let left=n;for(const row of rows){if(left<=0)break;const room=Math.max(0,Number(row.qty||0)-Number(row._scan||0)),add=Math.min(room,left);row._scan+=add;left-=add;}return left;};
      const match=(product,raw)=>{const keys=[raw,product?.asin,product?.isbn,product?.fnsku,product?.fcsku].map(C.upper).filter(Boolean),seen=new Set(),out=[];for(const key of keys)for(const row of state.lookup.get(key)||[]){const id=[row.container,row.asin,row.fnsku,row.fcsku,row.disposition].join('|');if(!seen.has(id)){seen.add(id);out.push(row);}}return out;};
      const paint=()=>{const total=state.rows.reduce((s,r)=>s+Number(r.qty||0),0),scanned=state.rows.reduce((s,r)=>s+Number(r._scan||0),0);q('[data-summary]').textContent=(state.container||'NO CONTAINER')+' · '+scanned+'/'+total+' units';q('[data-msg]').textContent=state.message;q('[data-scans]').innerHTML=[...state.scans.values()].reverse().map(r=>'<div class="v3-list-row"><button class="v3-btn" data-print="'+C.esc(r.raw)+'">'+C.esc(r.raw)+(r.count>1?' ×'+r.count:'')+'</button> · <b class="'+(r.state==='found'?'v3-ok':r.state==='missing'?'v3-bad':'v3-warn')+'">'+r.state.toUpperCase()+'</b></div>').join('')||'<div class="v3-note">No scans.</div>';q('[data-system]').innerHTML=state.rows.map(r=>'<div class="v3-list-row"><b>'+C.esc(r.fnsku||r.fcsku||r.asin||'—')+'</b> · '+Number(r._scan||0)+'/'+Number(r.qty||0)+' · '+C.esc(r.title||r.asin||'')+'</div>').join('')||'<div class="v3-note">No inventory loaded.</div>';for(const b of q('[data-scans]').querySelectorAll('[data-print]'))b.onclick=async()=>{const rec=state.scans.get(C.upper(b.dataset.print));try{await print(rec.raw,rec.product?.title||'');state.message='Printed '+rec.raw;}catch(e){state.message='Print failed: '+e.message;}paint();};};
      const load=async code=>{const seq=++state.seq;state.container=code;state.loading=true;state.rows=[];state.lookup=new Map();state.pending=[];state.scans.clear();state.message='Loading full inventory…';paint();try{const result=await fcr.inventory(code,{onPreview:p=>{if(seq===state.seq){state.message='Loading inventory page '+p.pages+'…';paint();}}});if(seq!==state.seq)return;state.rows=result.rows;state.lookup=lookup(result.rows);state.loading=false;state.message='Ready';const queued=state.pending.splice(0);paint();for(const v of queued)await handle(v);}catch(e){if(seq===state.seq){state.loading=false;state.message='Inventory failed: '+e.message;paint();}}};
      const handle=async value=>{const raw=C.clean(value);if(!raw)return;if(!state.container){if(!C.container(raw)){state.message='SCAN SOURCE CONTAINER FIRST';paint();return;}return load(raw);}if(C.container(raw)&&C.upper(raw)!==C.upper(state.container))return load(raw);if(state.loading){state.pending.push(raw);state.message='Queued '+state.pending.length+' scan(s)';paint();return;}const key=C.upper(raw),old=state.scans.get(key);if(old){old.count++;allocate(old.matches);state.message=raw+' ×'+old.count;paint();return;}const seq=state.seq;const rec={raw,count:1,state:'checking',matches:[],product:null};state.scans.set(key,rec);paint();try{try{rec.product=await fcr.product(raw);}catch(error){if(!state.lookup.has(key))throw error;}if(seq!==state.seq)return;rec.matches=match(rec.product,raw);rec.state=rec.matches.length?'found':'missing';if(rec.matches.length)allocate(rec.matches);state.message=rec.matches.length?'IN '+state.container:'NOT IN '+state.container;telemetry.emit('tote.scan',{code:C.mask(raw),found:Boolean(rec.matches.length)});}catch(e){if(seq!==state.seq)return;rec.state='error';state.message=e.message;}paint();};
      scan.onkeydown=async e=>{if(e.key!=='Enter')return;e.preventDefault();const v=scan.value;scan.value='';await handle(v);scan.focus({preventScroll:true});};q('[data-reset]').onclick=()=>{state.seq++;Object.assign(state,{container:'',loading:false,rows:[],lookup:new Map(),pending:[],scans:new Map(),message:'Scan source container'});paint();scan.focus();};paint();}panel.open();}};
  }

  function binPanel(){
    const panel=C.panel({id:'fcr-bin',title:'V3 · Bin Check',width:800,life});let mounted=false;
    return{open(){if(!mounted){mounted=true;const state={rows:[],floors:new Map(),filter:new Set(['P2','P3','P4']),message:'Snapshot native inventory when ready.'};const root=document.createElement('div');root.innerHTML='<section class="v3-section"><div class="v3-row"><button class="v3-btn primary" data-load>SNAPSHOT VISIBLE/FILTERED</button><button class="v3-btn" data-copy>COPY VISIBLE TSV</button><button class="v3-btn primary" data-floor="P2">P2</button><button class="v3-btn primary" data-floor="P3">P3</button><button class="v3-btn primary" data-floor="P4">P4</button></div><div class="v3-note" data-msg style="margin-top:8px"></div></section><section class="v3-section"><div data-list></div></section>';panel.set(root);const q=s=>root.querySelector(s);
      const snapshot=()=>{const table=document.querySelector('#table-inventory');if(!table)throw new Error('Native inventory table not ready');const heads=[...table.querySelectorAll('thead th')].map(x=>C.lower(String(x.textContent||'').replace(/\(\d+\)/g,''))),find=(...n)=>heads.findIndex(h=>n.includes(h)),idx={container:find('container'),asin:find('asin'),fnsku:find('fnsku'),fcsku:find('fcsku'),qty:find('quantity','qty')};if(idx.container<0)throw new Error('Container column not found');let nodes=null;try{const jq=globalThis.jQuery||unsafeWindow?.jQuery,dt=jq&&jq.fn?.dataTable?.isDataTable?.(table)?jq(table).DataTable():null;if(dt)nodes=dt.rows({search:'applied'}).nodes().toArray();}catch{}if(!nodes)nodes=[...(table.tBodies?.[0]?.rows||[])].filter(row=>{const r=row.getBoundingClientRect(),s=getComputedStyle(row);return r.height>0&&s.display!=='none'&&s.visibility!=='hidden';});return nodes.map(row=>{const v=i=>i>=0?C.clean(row.cells[i]?.textContent):'';return{container:v(idx.container),asin:v(idx.asin),fnsku:v(idx.fnsku),fcsku:v(idx.fcsku),qty:Number(v(idx.qty).replace(/[^\d.-]/g,''))||0};}).filter(x=>x.container);};
      const visibleRows=()=>state.rows.filter(r=>{const pod=V3.fcr.podOf(r.container),floor=pod?state.floors.get(pod)||'PX':'PX';return !/^P[234]$/.test(floor)||state.filter.has(floor);});
      const paint=()=>{q('[data-msg]').textContent=state.message;for(const b of root.querySelectorAll('[data-floor]'))b.classList.toggle('primary',state.filter.has(b.dataset.floor));q('[data-list]').innerHTML=visibleRows().map((r,i)=>{const pod=V3.fcr.podOf(r.container),floor=pod?state.floors.get(pod)||'…':'—';return'<div class="v3-list-row">'+(i+1)+'. <b>'+C.esc(floor)+'</b> · <button class="v3-btn" data-print="'+C.esc(r.container)+'">'+C.esc(r.container)+'</button> · <button class="v3-btn" data-print="'+C.esc(r.fnsku)+'">'+C.esc(r.fnsku||'—')+'</button> · '+C.esc(r.fcsku||'—')+' · Q'+r.qty+'</div>';}).join('')||'<div class="v3-note">No rows.</div>';for(const b of q('[data-list]').querySelectorAll('[data-print]'))b.onclick=async e=>{if(!e.altKey)return;try{await print(b.dataset.print);state.message='Printed '+b.dataset.print;}catch(err){state.message=err.message;}paint();};};
      q('[data-load]').onclick=async()=>{try{state.rows=snapshot();state.floors.clear();state.message='Resolving '+state.rows.length+' filtered row(s)…';paint();const pods=[...new Set(state.rows.map(r=>V3.fcr.podOf(r.container)).filter(Boolean))];let cursor=0;const worker=async()=>{while(cursor<pods.length){const pod=pods[cursor++];state.floors.set(pod,await fcr.floor(pod));paint();}};await Promise.all(Array.from({length:Math.min(8,pods.length)},worker));state.message='Ready · Alt-click Container/FNSKU to print';paint();}catch(e){state.message=e.message;paint();}};
      for(const b of root.querySelectorAll('[data-floor]'))b.onclick=()=>{state.filter.has(b.dataset.floor)?state.filter.delete(b.dataset.floor):state.filter.add(b.dataset.floor);paint();};
      q('[data-copy]').onclick=()=>{const rows=visibleRows(),text=['Floor\tContainer\tASIN\tFNSKU\tFCSKU\tQty',...rows.map(r=>{const pod=V3.fcr.podOf(r.container),floor=pod?state.floors.get(pod)||'PX':'';return[floor,r.container,r.asin,r.fnsku,r.fcsku,r.qty].join('\t');})].join('\n');if(typeof GM_setClipboard==='function')GM_setClipboard(text,'text');else navigator.clipboard?.writeText(text);state.message='Copied '+rows.length+' visible row(s)';paint();};paint();}panel.open();}};
  }

  function pandashPanel(){
    const panel=C.panel({id:'fcr-pandash',title:'V3 · Pandash',width:480,life});let mounted=false;
    return{open(){if(!mounted){mounted=true;const root=document.createElement('div');root.innerHTML='<section class="v3-section"><label class="v3-field">ASIN<input data-asin></label><button class="v3-btn primary" data-run>CHECK</button><div class="v3-note" data-msg></div></section>';panel.set(root);const input=root.querySelector('[data-asin]'),msg=root.querySelector('[data-msg]');input.value=/^B[A-Z0-9]{9}$/i.test(current())?current():'';root.querySelector('[data-run]').onclick=async()=>{try{let asin=C.upper(input.value);if(!asin){const p=await fcr.product(current());asin=C.upper(p?.asin);input.value=asin;}const x=await fcr.pandash(asin);msg.className='v3-note '+(x.allowed?'v3-ok':'v3-bad');msg.textContent='L'+x.level+' · '+x.message;}catch(e){msg.className='v3-note v3-bad';msg.textContent=e.message;}};}panel.open();}};
  }

  function actionPanel({family,id,title,path,origin,button,fields,prepare}) {
    const panel=C.panel({id,title,width:560,life});let mounted=false,external=null,runContext=null;
    const worker=V3.bridge.client({origin,path,family,life,onEvent:detail=>window.dispatchEvent(new CustomEvent('bwu2-v3:event',{detail}))});
    return{open(){if(!mounted){mounted=true;const root=document.createElement('div');
      root.innerHTML='<section class="v3-section"><label class="v3-field">Container<input data-container></label>'+fields+'<div class="v3-row"><button class="v3-btn primary" data-run>'+button+'</button><button class="v3-btn danger" data-verify hidden>I VERIFIED IT · CLEAR ATTENTION</button></div><div class="v3-note" data-msg></div></section>';
      panel.set(root);const input=root.querySelector('[data-container]'),run=root.querySelector('[data-run]'),verify=root.querySelector('[data-verify]'),msg=root.querySelector('[data-msg]');input.value=currentContainer();
      const key='bwu2.v3.form.fcr.'+family;let busy=false,blocked=localStorage.getItem(key)||'';
      const paint=()=>{run.disabled=busy||Boolean(blocked);verify.hidden=!blocked;for(const field of root.querySelectorAll('input,select'))field.disabled=busy;};
      const payload=prepare?.(root)||(()=>({container:input.value}));
      run.onclick=async()=>{if(busy||blocked)return;let sent=false;busy=true;paint();try{const data=external||payload();external=null;if(!C.container(data.container))throw new Error('Valid container required');
        localStorage.setItem(key,'Unfinished '+button+' · verify '+data.container);sent=true;msg.textContent=button+'…';await worker.run('run',data);msg.textContent=button+' CONFIRMED';localStorage.removeItem(key);
      }catch(error){if(error.outcome==='unknown'){blocked=error.message;localStorage.setItem(key,blocked);}else if(sent)localStorage.removeItem(key);msg.textContent=error.message;}finally{busy=false;paint();}};
      verify.onclick=async()=>{if(busy)return;try{await worker.run('resolve');blocked='';localStorage.removeItem(key);msg.textContent='Attention cleared';paint();}catch(error){msg.textContent=error.message;}};
      runContext=async data=>{if(busy||blocked)return;external=data;await run.onclick();};msg.textContent=blocked?'VERIFY PREVIOUS ACTION · '+blocked:'Ready';paint();}panel.open();},async runContext(data){this.open();await runContext(data);}};
  }
  function movePanel(){return actionPanel({family:'movecontainer',id:'fcr-move',title:'V3 · MoveContainer',path:'/move-container',origin:V3.actions.MOVE_ORIGIN,button:'MOVE',
    fields:'<div class="v3-grid"><label class="v3-field">Floor<select data-floor>'+V3.actions.FLOORS.map(x=>'<option>'+x+'</option>').join('')+'</select></label><label class="v3-field">Destination<select data-drop></select></label></div>',
    prepare:root=>{const floor=root.querySelector('[data-floor]'),drop=root.querySelector('[data-drop]');floor.value='P2';const fill=()=>{drop.innerHTML='<option value="PRIME">PRIME</option>'+V3.actions.dropChoices(floor.value).map(x=>'<option value="'+C.esc(x.key)+'">'+C.esc(x.label)+'</option>').join('');};floor.onchange=fill;fill();return()=>({container:root.querySelector('[data-container]').value,destination:V3.actions.destination(floor.value,drop.value)});}});}
  function unbindPanel(){return actionPanel({family:'hierarchy',id:'fcr-unbind',title:'V3 · Unbind',path:'/unbindHierarchy',origin:V3.actions.HIERARCHY_ORIGIN,button:'UNBIND',fields:''});}

  const tools=[
    ['fcr-item','ITEM','Product / exact print',itemPanel()],
    ['fcr-tote','TOTE','Tote Audit',totePanel()],
    ['fcr-bin','BIN','Bin Check',binPanel()],
    ['fcr-pandash','PANDASH','Pandash',pandashPanel()],
    ['fcr-move','MOVE','MoveContainer',movePanel()],
    ['fcr-unbind','UNBIND','Unbind',unbindPanel()]
  ];
  V3.fcrNative.mount({life,telemetry,fcr,print,move:tools.find(row=>row[0]==='fcr-move')[3],unbind:tools.find(row=>row[0]==='fcr-unbind')[3]});
  for(const [id,label,title,tool] of tools)C.dockButton({id,label,title,onClick:tool.open});
  C.dockButton({id:'fcr-iss',label:'ISS',title:'Open standalone V3 ISS Console',onClick:()=>{const url='https://aft-poirot-website-nrt.nrt.proxy.amazon.com/#iss-console';if(typeof GM_openInTab==='function')GM_openInTab(url,{active:true,insert:true});else window.open(url,'_blank','noopener');}});
};

if(typeof V3.boot!=='function')throw new Error('V3 boot missing');
V3.boot();
})();
