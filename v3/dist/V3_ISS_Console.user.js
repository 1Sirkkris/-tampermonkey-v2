// ==UserScript==
// @name         V3 | BWU2 ISS Console
// @name:en      V3 | BWU2 ISS Console
// @namespace    https://github.com/1Sirkkris/-tampermonkey-v2/v3-groundup
// @version      0.2.1
// @description  Dedicated ISS Console for Edit, Move, Sideline and FCSKU.
// @match        https://aft-poirot-website-nrt.nrt.proxy.amazon.com/*
// @run-at       document-body
// @noframes
// @grant        GM_xmlhttpRequest
// @connect      aft-qt-jp.aka.nrt.corp.amazon.com
// @connect      pandash.amazon.com
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-groundup/v3/dist/V3_ISS_Console.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-groundup/v3/dist/V3_ISS_Console.user.js
// @v3-build     iss-0.2.1-4ac21fea
// ==/UserScript==

(()=>{
'use strict';
const V3=Object.create(null);
V3.build=Object.freeze({"id":"iss-0.2.1-4ac21fea","version":"0.2.1"});

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

// ---- src/aft.js ----
V3.aft=(()=>{
  const C=V3.core;
  const DEFAULT_ORIGIN='https://aft-qt-jp.aka.nrt.corp.amazon.com';
  const DEFINITIONS={
    'edit:each':{title:'Edit EACH',area:'edit',mode:'each',path:'/app/edititems',instructionId:'EditItems',tool:'edititems',input:'EACH'},
    'edit:sku':{title:'Edit SKU',area:'edit',mode:'sku',path:'/app/edititems',instructionId:'EditItems',tool:'edititems',input:'SKU'},
    'edit:date':{title:'Edit DATE',area:'edit',mode:'date',path:'/app/edititems',instructionId:'EditItems',tool:'edititems',input:'DATELOT'},
    'edit:fcsku':{title:'FCSKU Flip',area:'edit',mode:'fcsku',path:'/app/fcskuflip',instructionId:'FcSkuFlip',tool:'fcskuflip',input:'SKU'},
    'move:multi':{title:'Move Multi',area:'move',mode:'multi',path:'/app/moveitems',instructionId:'MoveItems',tool:'moveitems',input:'MULTI'}
  };
  const EDIT_STATES=[
    ['location',['scan location','scan container','input location','enter location','enter container']],
    ['item',['input fnsku or fcsku','input item','scan item','enter the sku','enter item']],
    ['sourceState',['select source inventory state']],
    ['sourceDisp',['select source disposition','select source disposition type']],
    ['newState',['select new inventory state']],
    ['newDisp',['select new disposition','select disposition type']],
    ['dateRemove',['confirm expiry date removal','remove expiry date']],
    ['dateEntry',['enter expiry date','enter expiration date']],
    ['dateConfirm',['confirm new expiry date','save expiry date']],
    ['confirm',['confirm change','confirm to continue']],
    ['success',['success items changed','items changed from','current expiry date:']],
    ['retryError',['failed to change consumer type. please try again','failed to change consumer type']],
    ['error',['work is errored','the service failed to process your request','service failed']],
    ['loading',['loading']]
  ];
  const HEADERS={'Content-Type':'application/json; charset=utf-8','Accept':'application/json, text/javascript, */*; q=0.01','X-Requested-With':'XMLHttpRequest'};
  const classifyEdit=text=>{const value=C.lower(text);let state='unknown',best=Infinity;for(const [name,phrases] of EDIT_STATES)for(const phrase of phrases){const i=value.indexOf(phrase);if(i>=0&&i<best){best=i;state=name;}}return state;};
  const classifyFcsku=text=>{const v=C.lower(text);if(v.includes('success'))return'success';if(v.includes('confirm flip'))return'confirm';if(v.includes('enter new fnsku')||v.includes('enter new fcsku'))return'new';if(v.includes('input item')&&v.includes('fnskus'))return'old';if(v.includes('scan container'))return'container';return'unknown';};
  const objectId=raw=>String(raw||'').match(/(?:&quot;|")objectId(?:&quot;|")\s*:\s*(?:&quot;|")([^"&<]+)(?:&quot;|")/i)?.[1]||String(raw||'').match(/\b[A-Z0-9]{2,12}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i)?.[0]||'';
  const snapshotView=raw=>{const doc=C.html(raw);for(const el of doc.querySelectorAll('script,style,noscript,template,svg,[hidden],[aria-hidden="true"],.aft-tool-hide,.aok-hidden,.a-hidden,[style*="display:none"],[style*="visibility:hidden"]'))el.remove();const headings=C.clean([...doc.querySelectorAll('h1,h2,h3,[role="heading"]')].map(x=>x.textContent||'').join(' '));return{doc,text:C.clean(doc.body?.textContent||''),headings};};
  const extractWorkflow=(raw,def)=>{
    const source=String(raw||'').replace(/&quot;/gi,'"').replace(/&#34;/gi,'"').replace(/&#x22;/gi,'"').replace(/\\"/g,'"').replace(/&amp;/gi,'&');
    const anchor=new RegExp('"instructionId"\\s*:\\s*"'+def.instructionId+'"','i').exec(source);if(!anchor)return null;
    const remaining=source.slice(anchor.index),next=remaining.slice(anchor[0].length).search(/"instructionId"/),scope=remaining.slice(0,Math.min(3000,next<0?remaining.length:anchor[0].length+next)),grab=name=>scope.match(new RegExp('"'+name+'"\\s*:\\s*"([^"]+)"','i'))?.[1]||'';
    const wf={instructionId:grab('instructionId'),tool:C.lower(grab('tool')),objectId:grab('objectId'),status:C.upper(grab('status')),selector:/<input\b[^>]*\bname\s*=\s*["']options["']/i.test(source)};
    if(!wf.objectId||!wf.status||wf.instructionId!==def.instructionId)return null;if(wf.tool&&wf.tool!==def.tool)return null;return wf;
  };
  const mapState=value=>{const v=C.lower(value);if(v==='sellable'||v==='inventory')return'INVENTORY';if(v==='pending research'||v==='pending')return'PENDING_RESEARCH';if(v==='unsellable')return'UNSELLABLE';throw new Error('Unsupported inventory state '+value);};
  const mapDamage=value=>{const v=C.lower(value);if(v==='amazon damage'||v==='warehouse damage')return'AMAZON_DAMAGE';if(v==='defective')return'DEFECTIVE';if(v==='distributor damage')return'DISTRIBUTOR_DAMAGE';if(v==='expired')return'EXPIRED';throw new Error('Unsupported disposition '+value);};
  const readMoveQuantity=raw=>{const view=snapshotView(raw),match=view.text.match(/\bQuantity\s*[:\-]?\s*(\d{1,6})\b/i),qty=Number(match?.[1]);return{qty:Number.isSafeInteger(qty)&&qty>0?qty:null,verify:/\bVerify item\b/i.test(view.headings+' '+view.text)};};
  const sourceChoices=doc=>{
    const out=[];for(const radio of doc?.querySelectorAll?.('input[type="radio"]')||[]){let label='';try{label=[...(radio.labels||[])].map(x=>x.textContent||'').join(' ');}catch{}if(!label)label=radio.closest('label')?.textContent||radio.parentElement?.textContent||'';label=C.clean(label);if(!/Quantity\s*:/i.test(label)||!/Owner\s*:/i.test(label))continue;let state='';if(/Pending Research|PENDING_RESEARCH/i.test(label))state='PENDING_RESEARCH';else if(/Unsellable|UNSELLABLE/i.test(label))state='UNSELLABLE';else if(/(?:Inventory|Sellable)|\bSELLABLE\b/i.test(label))state='SELLABLE';if(!state)continue;const qty=Number(label.match(/\bQuantity\s*:\s*(\d{1,7})\b/i)?.[1]);out.push({state,label,value:radio.value||'',qty:Number.isInteger(qty)?qty:null,disabled:Boolean(radio.disabled)});}return out;
  };
  const parseEach=text=>String(text||'').split(/\r?\n/).map(C.clean).filter(Boolean).map(line=>{const [location='',asin='',fnsku='']=line.split(/\s+/);return location&&asin?{location,asin,fnsku:fnsku||asin}:null;}).filter(Boolean);
  const parseItems=text=>{const seen=new Set(),out=[];for(const line of String(text||'').split(/\r?\n/)){const value=C.clean(line.split(/\s+/)[0]);if(!value)continue;const key=C.upper(value);if(seen.has(key))continue;seen.add(key);out.push(value);}return out;};
  const datePayload=date=>{const m=String(date||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m||new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]))).toISOString().slice(0,10)!==date)throw new Error('Invalid date '+date);return JSON.stringify({'year-input':m[1],'month-input':m[2],'day-input':m[3],'':''});};

  function create({origin,life,telemetry,stopped=()=>false}={}){
    origin=String(origin||(/^aft-qt-/i.test(location.hostname)?location.origin:DEFAULT_ORIGIN)).replace(/\/$/,'');
    const url=path=>origin+path;
    const req=async(path,options={})=>C.request(url(path),{...options,signal:options.signal||life?.signal});
    const get=async path=>(await req(path,{allowHtml:true,timeout:15000})).raw;
    const post=async(path,payload,{timeout=20000,allowHttpError=false}={})=>req(path,{method:'POST',body:JSON.stringify(payload),headers:HEADERS,timeout,allowHttpError});
    const route=def=>def.path+'?experience=Desktop';
    const pageRaw=def=>get(route(def));
    const page=async(def,classifier)=>{const raw=await pageRaw(def),view=snapshotView(raw);return{raw,doc:view.doc,text:view.text,state:classifier?classifier(view.headings+' '+view.text):'unknown',objectId:objectId(raw)};};
    const workflow=async def=>{const wf=extractWorkflow(await pageRaw(def),def);if(!wf)throw new Error(def.title+': workflow not found');return wf;};
    const ids=(def,wf)=>({id:{instructionId:def.instructionId,objectId:wf.objectId}});
    const status=async(def,wf)=>{const r=await post('/status',ids(def,wf));const value=C.upper(r.data?.status);if(!value)throw new Error('AFT status missing');return value;};
    const waitStatus=async(def,wf,accepted,{timeout=20000,pollMs,operation:op,label='AFT',ignoreStop=false}={})=>{
      const wanted=new Set(accepted),started=performance.now();let polls=0,last=wf.status||'';
      while(performance.now()-started<timeout){
        if(stopped()&&!ignoreStop)throw new Error('Stopped by user');
        try{last=await status(def,wf);}catch(error){if(op){op.unknown({reason:'status-transport'});throw new C.UnknownError(label+': confirmation lost',{cause:error});}throw error;}
        polls++;if(wanted.has(last)){telemetry?.emit('aft.status',{label,state:last,polls,ms:Math.round(performance.now()-started)});return last;}
        if(last==='ERRORED'){if(op){op.unknown({reason:'backend-errored'});throw new C.UnknownError(label+': backend ERRORED after submission — verify resulting inventory');}throw new C.RejectedError(label+': backend ERRORED');}
        if(!['READY','PROCESSING','COMPLETE'].includes(last)){if(op){op.unknown({reason:'unexpected-status',state:last});throw new C.UnknownError(label+': unexpected status '+last);}throw new Error(label+': status '+last);}
        await life.sleep(pollMs??Math.min(300,60+polls*35));
      }
      if(op){op.unknown({reason:'status-timeout'});throw new C.UnknownError(label+': status timeout');}
      throw new Error(label+': status timeout');
    };
    const action=async(def,wf,actionName,input,label,{complete=false,timeout=20000,pollMs,operation:op,ignoreStop=false}={})=>{
      if(stopped()&&!ignoreStop)throw new Error('Stopped by user');
      if(op)op.submitted({label});
      let r;
      try{r=await post('/action',{...ids(def,wf),action:actionName,input},{timeout,allowHttpError:Boolean(op)});}
      catch(error){if(op){op.unknown({reason:'action-transport'});throw new C.UnknownError(label+': submission confirmation lost',{cause:error});}throw error;}
      if(op&&r.httpError){if(r.status>=500||r.status===408){op.unknown({status:r.status});throw new C.UnknownError(label+': HTTP '+r.status+' outcome unknown');}op.rejected({status:r.status});throw new C.RejectedError(label+': rejected HTTP '+r.status);}
      const settled=await waitStatus(def,wf,complete?['COMPLETE']:['READY'],{timeout,pollMs,operation:op,label,ignoreStop:ignoreStop||Boolean(op)});
      if(op){
        try{
          const after=await page(def,def.tool==='fcskuflip'?classifyFcsku:classifyEdit);
          if(after.objectId!==wf.objectId)throw new Error('Workflow changed during confirmation');
          const proved=op.kind==='aft-date-remove'?['success','dateEntry','item'].includes(after.state):def.tool==='moveitems'?/input item|scan item|enter item/i.test(after.text)&&!/verify item|work is errored/i.test(after.text):['success','item'].includes(after.state);
          if(!proved)throw new Error('Application did not prove the mutation result');
          op.confirmed({state:after.state});return after;
        }catch(error){op.unknown({reason:'application-confirmation-missing'});throw new C.UnknownError(label+': result not proven — verify before retry',{cause:error});}
      }
      return settled;
    };
    const input=(def,wf,value,label,opts)=>action(def,wf,'Input',value,label,opts);
    const confirm=(def,wf,opts)=>action(def,wf,'Confirm','Confirm','Confirm',opts);
    const done=(def,wf)=>action(def,wf,'Done','Done','Done',{complete:true,timeout:180000,pollMs:300,ignoreStop:true});
    const end=(def,wf)=>post('/end',{...ids(def,wf),tool:def.tool},{timeout:20000});
    const fresh=async(def,oldId,timeout=6000)=>{const start=performance.now();while(performance.now()-start<timeout){const next=await workflow(def);if(next.objectId!==oldId)return next;await life.sleep(100);}throw new Error('Fresh AFT workflow not created');};
    const ensureReady=async(def,wf=null)=>{let current=wf||await workflow(def);for(let i=0;i<5;i++){if(current.status==='READY')return current;if(current.status==='PROCESSING'){current.status=await waitStatus(def,current,['READY','COMPLETE'],{label:'Ready'});if(current.status==='READY')return current;}if(current.status==='COMPLETE'){const old=current.objectId;await end(def,current);current=await fresh(def,old);continue;}throw new Error('Unexpected AFT state '+current.status);}throw new Error('Could not obtain READY workflow');};
    const ensureMode=async key=>{
      const def=DEFINITIONS[key];if(!def)throw new Error('Unknown AFT mode '+key);let wf=await ensureReady(def);
      if(key==='edit:fcsku'&&!wf.selector)return{def,wf};
      if(!wf.selector){await action(def,wf,'SelectMode','SelectMode','Select mode');wf=await workflow(def);if(!wf.selector)throw new Error(def.title+': mode selector unavailable');}
      await action(def,wf,'Input',def.input,'Choose '+def.input,{complete:true});const old=wf.objectId;await end(def,wf);wf=await fresh(def,old);return{def,wf:await ensureReady(def,wf)};
    };
    const snap=async(def,wf,classifier)=>{const s=await page(def,classifier);if(!s.objectId||s.objectId!==wf.objectId)throw new Error('AFT workflow changed');return s;};
    const exactSource=(doc,state)=>{
      const wanted=state==='INVENTORY'?'SELLABLE':state,matches=sourceChoices(doc).filter(x=>x.state===wanted&&!x.disabled);
      if(matches.length!==1)throw new Error(matches.length?'Multiple '+state+' source options — manual review required':'Requested source '+state+' not available');
      return matches[0];
    };
    const applyTarget=async(def,wf,state,damage)=>{
      await input(def,wf,state,'Target state');
      if(state==='UNSELLABLE')await input(def,wf,mapDamage(damage),'Target disposition');
    };
    async function runMove({source,destination,items,mode='all',qty=1,onProgress=()=>{}}={}){
      source=C.clean(source);destination=C.clean(destination);items=parseItems(Array.isArray(items)?items.join('\n'):items);
      if(!C.container(source)||!C.container(destination)||C.lower(source)===C.lower(destination))throw new Error('Valid different source/destination containers required');
      if(!items.length)throw new Error('No Move items');
      const userQty=Number(qty);if(mode==='qty'&&(!Number.isSafeInteger(userQty)||userQty<1))throw new Error('Invalid quantity');
      const {def,wf}=await ensureMode('move:multi');let confirmed=0;
      try{
        onProgress({stage:'source',confirmed,total:items.length});await input(def,wf,source,'Source');
        for(let i=0;i<items.length;i++){
          if(stopped())throw new Error('Stopped by user');
          const barcode=items[i];onProgress({stage:'item',barcode,current:i+1,total:items.length,confirmed});
          await input(def,wf,barcode,'Item '+(i+1));
          const raw=await pageRaw(def),idNow=objectId(raw);if(idNow!==wf.objectId)throw new Error('AFT workflow changed while reading quantity');
          const info=readMoveQuantity(raw);if(info.verify)throw new Error('Verify Item screen detected');if(!info.qty)throw new Error('Quantity not found for '+barcode);
          const wanted=mode==='each'?1:mode==='qty'?userQty:info.qty;if(wanted>info.qty)throw new Error('QTY UNAVAILABLE • '+barcode+' • requested '+wanted+' • available '+info.qty);
          onProgress({stage:'quantity',barcode,qty:wanted,available:info.qty,current:i+1,total:items.length,confirmed});
          await input(def,wf,String(wanted),'Quantity '+(i+1));
          const op=C.operation({kind:'aft-move',ref:barcode,telemetry});
          onProgress({stage:'destination',barcode,current:i+1,total:items.length,confirmed});
          try{await input(def,wf,destination,'Destination '+(i+1),{operation:op});}
          catch(error){
            error.aftPartial={kind:'move',confirmed,total:items.length,uncertain:error?.outcome==='unknown'?[barcode]:[],remaining:items.slice(i+(error?.outcome==='unknown'?1:0)),source,destination};
            throw error;
          }
          confirmed++;onProgress({stage:'confirmed',barcode,current:i+1,total:items.length,confirmed});
        }
        onProgress({stage:'finish',confirmed,total:items.length});await done(def,wf);
        try{await end(def,wf);}catch(error){const e=new C.UnknownError('Items confirmed moved, but AFT finalization was not confirmed',{cause:error});e.aftPartial={kind:'move-finalize',confirmed,total:items.length,uncertain:[],remaining:[]};throw e;}
        return{confirmed,total:items.length};
      }catch(error){
        if(error?.outcome!=='unknown')try{await end(def,wf);}catch{}
        if(!error.aftPartial)error.aftPartial={kind:'move',confirmed,total:items.length,uncertain:[],remaining:items.slice(confirmed),source,destination};
        throw error;
      }
    }

    async function runEditEach({items,destState='Pending Research',destDamage='Defective',onProgress=()=>{}}={}){
      const rows=Array.isArray(items)?items:parseEach(items);if(!rows.length)throw new Error('EACH needs: TOTE ASIN [FNSKU]');
      const desired=mapState(destState),{def}=await ensureMode('edit:each');let wf=await ensureReady(def),confirmed=0,currentLocation='',needsFresh=false;
      try{
        for(let i=0;i<rows.length;i++){
          if(stopped())throw new Error('Stopped by user');const row=rows[i];if(needsFresh){await end(def,wf);wf=await fresh(def,wf.objectId);wf=await ensureReady(def,wf);currentLocation='';needsFresh=false;}
          if(C.lower(row.location)!==C.lower(currentLocation)){if(currentLocation){try{await end(def,wf);}catch{}wf=await fresh(def,wf.objectId);wf=await ensureReady(def,wf);}onProgress({stage:'location',current:i+1,total:rows.length,row});await input(def,wf,row.location,'Location');currentLocation=row.location;}
          onProgress({stage:'item',current:i+1,total:rows.length,row});await input(def,wf,row.fnsku||row.asin,'Item');
          const afterItem=await snap(def,wf,classifyEdit);if(afterItem.state==='sourceState')throw new Error('EditItems could not infer source state; stopped before mutation');if(afterItem.state!=='newState')throw new Error('After item expected newState, got '+afterItem.state);
          await applyTarget(def,wf,desired,destDamage);
          const before=await snap(def,wf,classifyEdit);if(before.state!=='confirm')throw new Error('Expected confirm, got '+before.state);
          const op=C.operation({kind:'aft-edit-each',ref:row.fnsku||row.asin,telemetry});
          const result=await confirm(def,wf,{timeout:180000,operation:op});
          confirmed++;if(result.state==='success'){await done(def,wf);needsFresh=true;}onProgress({stage:'confirmed',confirmed,total:rows.length,row});
        }
        try{await end(def,wf);}catch{}
        return{confirmed,total:rows.length};
      }catch(error){if(error?.outcome!=='unknown')try{await end(def,wf);}catch{}error.aftPartial={kind:'edit-each',confirmed,total:rows.length,uncertain:error?.outcome==='unknown'?[rows[confirmed]]:[],remaining:rows.slice(confirmed+(error?.outcome==='unknown'?1:0))};throw error;}
    }

    async function runEditSku({items,sourceState='Sellable',sourceDamage='Defective',destState='Pending Research',destDamage='Defective',onProgress=()=>{}}={}){
      const list=parseItems(Array.isArray(items)?items.join('\n'):items);if(!list.length)throw new Error('No Edit items');
      const from=mapState(sourceState),to=mapState(destState);if(from===to&&from!=='UNSELLABLE')throw new Error('Source and destination state cannot match');
      const def=DEFINITIONS['edit:sku'];let flipped=0,zero=0;const failed=[];
      await ensureMode('edit:sku');
      for(let index=0;index<list.length;index++){
        const sku=list[index];let attempts=0,lastQty=Infinity;
        try{
          while(attempts++<50){
            if(stopped())throw new Error('Stopped by user');
            let wf=await ensureReady(def);onProgress({stage:'lookup',sku,current:index+1,total:list.length,attempt:attempts});
            await input(def,wf,sku,'SKU');
            const sourcePage=await snap(def,wf,classifyEdit);if(sourcePage.state!=='sourceState')throw new Error('Expected sourceState after lookup, got '+sourcePage.state);
            const choice=exactSource(sourcePage.doc,from),qty=choice.qty;
            onProgress({stage:'quantity',sku,qty,current:index+1,total:list.length,attempt:attempts,inventory:Object.fromEntries(sourceChoices(sourcePage.doc).map(x=>[x.state,x.qty]))});
            if(qty===0){zero++;try{await end(def,wf);}catch{}break;}
            if(!Number.isInteger(qty))throw new Error('Could not read '+sourceState+' quantity');
            if(qty>=lastQty)throw new Error('No inventory progress after confirmed change — stopped before another edit');
            lastQty=qty;
            await input(def,wf,choice.value||from,'Source state',{timeout:120000});
            if(from==='UNSELLABLE')await input(def,wf,mapDamage(sourceDamage),'Source disposition',{timeout:120000});
            const afterSource=await snap(def,wf,classifyEdit);if(afterSource.state!=='newState')throw new Error('Expected newState after source selection, got '+afterSource.state);
            await applyTarget(def,wf,to,destDamage);
            const before=await snap(def,wf,classifyEdit);if(before.state!=='confirm')throw new Error('Expected confirm, got '+before.state);
            const op=C.operation({kind:'aft-edit-sku',ref:sku,telemetry});const result=await confirm(def,wf,{timeout:180000,operation:op});
            flipped++;
            if(result.state==='success')await done(def,wf);
            try{await end(def,wf);}catch{}
            onProgress({stage:'confirmed',sku,current:index+1,total:list.length,attempt:attempts});
          }
          if(attempts>50)throw new Error('Stopped after 50 SKU attempts');
        }catch(error){
          if(error?.outcome==='unknown'){error.aftPartial={kind:'edit-sku',confirmed:flipped,total:list.length,uncertain:[sku],remaining:list.slice(index+1),failed};throw error;}
          if(stopped()){error.aftPartial={kind:'edit-sku',confirmed:flipped,total:list.length,uncertain:[],remaining:list.slice(index),failed};throw error;}
          failed.push({sku,message:C.clean(error.message||error)});onProgress({stage:'failed',sku,current:index+1,total:list.length,message:C.clean(error.message||error)});
          try{const current=await workflow(def);await end(def,current);}catch{}
        }
      }
      return{flipped,zero,failed,total:list.length};
    }

    async function runFcsku({oldCode,newCode,locations,onProgress=()=>{}}={}){
      oldCode=C.clean(oldCode);newCode=C.clean(newCode);const list=parseItems(Array.isArray(locations)?locations.join('\n'):locations);
      if(!oldCode||!newCode||!list.length)throw new Error('Need OLD + NEW FCSKU and at least one location');
      const def=DEFINITIONS['edit:fcsku'];let confirmed=0,failed=[],remaining=[];
      let wf=(await ensureMode('edit:fcsku')).wf;
      for(let i=0;i<list.length;i++){
        const location=list[i];if(stopped()){remaining=list.slice(i);break;}
        try{
          if(i>0){wf=await fresh(def,wf.objectId);wf=await ensureReady(def,wf);}
          onProgress({stage:'container',current:i+1,total:list.length,location});await input(def,wf,location,'Container');
          await input(def,wf,oldCode,'Old FCSKU');await input(def,wf,newCode,'New FCSKU');
          const op=C.operation({kind:'aft-fcsku',ref:location,telemetry});await confirm(def,wf,{operation:op,timeout:120000});confirmed++;try{await end(def,wf);}catch(error){error.aftPartial={kind:'fcsku-finalize',confirmed,total:list.length,uncertain:[],remaining:list.slice(i+1),failed};throw error;}
        }catch(error){
          if(error?.outcome==='unknown'){error.aftPartial={kind:'fcsku',confirmed,total:list.length,uncertain:[location],remaining:list.slice(i+1),failed};throw error;}
          if(error.aftPartial)throw error;
          failed.push({location,message:C.clean(error.message||error)});try{await end(def,wf);}catch{}
        }
      }
      return{confirmed,total:list.length,failed,remaining};
    }

    async function runDate({rows,onProgress=()=>{}}={}){
      const list=(Array.isArray(rows)?rows:[]).filter(x=>C.clean(x?.location)&&C.clean(x?.asin)&&C.clean(x?.date));if(!list.length)throw new Error('No expiry rows');
      const def=DEFINITIONS['edit:date'];let confirmed=0,remaining=[],wf=(await ensureMode('edit:date')).wf;
      for(let i=0;i<list.length;i++){
        const row=list[i];if(stopped()){remaining=list.slice(i);break;}
        try{
          if(i>0){wf=await fresh(def,wf.objectId);wf=await ensureReady(def,wf);}
          await input(def,wf,row.location,'Container',{timeout:120000});await input(def,wf,row.asin,'Item',{timeout:120000});
          let s=await snap(def,wf,classifyEdit);
          if(s.state==='dateRemove'){const remove=C.operation({kind:'aft-date-remove',ref:row.asin,telemetry});await confirm(def,wf,{timeout:180000,operation:remove});await end(def,wf);wf=await fresh(def,wf.objectId);wf=await ensureReady(def,wf);await input(def,wf,row.location,'Container restart',{timeout:120000});await input(def,wf,row.asin,'Item restart',{timeout:120000});s=await snap(def,wf,classifyEdit);}
          if(s.state!=='dateEntry')throw new Error('Expected expiry date entry, got '+s.state);
          await input(def,wf,datePayload(row.date),'Expiry date',{timeout:120000});const before=await snap(def,wf,classifyEdit);if(before.state!=='dateConfirm'&&before.state!=='confirm')throw new Error('Expected expiry confirmation, got '+before.state);
          const op=C.operation({kind:'aft-edit-date',ref:row.asin,telemetry});await confirm(def,wf,{timeout:180000,operation:op});confirmed++;onProgress({stage:'confirmed',confirmed,total:list.length,row});
          try{await end(def,wf);}catch{}
        }catch(error){if(error?.outcome==='unknown'){error.aftPartial={kind:'edit-date',confirmed,total:list.length,uncertain:[row],remaining:list.slice(i+1)};throw error;}throw error;}
      }
      return{confirmed,total:list.length,remaining};
    }

    return Object.freeze({origin,route,page,workflow,status,waitStatus,action,input,confirm,done,end,ensureReady,ensureMode,runMove,runEditEach,runEditSku,runFcsku,runDate});
  }

  return Object.freeze({DEFAULT_ORIGIN,DEFINITIONS,classifyEdit,classifyFcsku,extractWorkflow,mapState,mapDamage,readMoveQuantity,sourceChoices,parseEach,parseItems,datePayload,create});
})();

// ---- src/sideline.js ----
V3.sideline=(()=>{
  const C=V3.core,ORIGIN='https://aft-poirot-website-nrt.nrt.proxy.amazon.com',TOOL='V3';
  const PATH={bootstrap:'/api/get-bootstrap-data',source:'/api/scan-source-container',close:'/api/close-container',item:'/api/scanitem',move:'/api/move-items'};
  const requestId=()=>C.id('sideline');
  const scanSourcePayload=container=>({containerScannableId:container,requestId:requestId(),tool:TOOL});
  const scanItemPayload=(source,barcode)=>({containerScannableId:source,itemBarcode:barcode,isMasterpack:null,itemAndonContext:null,requestId:requestId(),tool:TOOL});
  const closePayload=(container,empty)=>({containerScannableId:container,containerEmpty:empty===true,directedLabel:false,processPath:'UNDETERMINED',requestId:requestId(),tool:TOOL});

  const problems=response=>(Array.isArray(response?.problems)?response.problems:[]).map(x=>C.clean(x?.description||x?.message||x?.reason||x?.code||x?.['@type']||'')).filter(Boolean);
  const deepHas=(value,re,seen=new Set())=>{if(value==null)return false;if(typeof value==='string')return re.test(value);if(typeof value!=='object'||seen.has(value))return false;seen.add(value);if(Array.isArray(value))return value.some(x=>deepHas(x,re,seen));return Object.entries(value).some(([k,v])=>re.test(k)||deepHas(v,re,seen));};
  const hasPredicant=value=>deepHas(value,/predicant/i);
  const payloadHasCustomerBound=value=>deepHas(value,/customer\s*bound\s*shipment/i);
  const hazmatRejected=response=>{
    if(!response||typeof response!=='object')return false;
    const filter=response.filterResult||{},reason=filter.reason||{};
    const labels=[response.message,response.description,response.errorMessage,response.errorCode,typeof response.reason==='string'?response.reason:'',response.reason?.type,response.reason?.description,response.reason?.message,reason.type,reason.description,reason.message,reason['@type'],filter.filterType,...problems(response)].map(C.clean).filter(Boolean);
    if(!labels.some(x=>/hazmat|dangerous.?goods/i.test(x)))return false;
    return response.success===false||filter.compatible===false||problems(response).length>0||Boolean(response.errorMessage||response.errorCode)||/error|reject|incompat|filter/i.test(C.clean(response['@type']));
  };
  const damagedDestination=response=>{const r=response?.filterResult?.reason;return response?.filterResult?.compatible===false&&/damag/i.test([r?.type,r?.description,r?.message,r?.['@type']].map(C.clean).join(' '));};
  const overageLabel=value=>/item\s*not\s*in\s*(?:source\s*)?container|not\s*in\s*container|overage/i.test(C.clean(value));
  const benignCompanion=value=>!/hazmat|dangerous.?goods|invalid\s+barcode|incompatib|damaged|predicant|customer\s*bound/i.test(C.clean(value));
  const allowedOverage=response=>{
    const type=C.clean(response?.['@type']),labels=[response?.message,response?.description,response?.errorMessage,response?.errorCode,response?.filterResult?.reason?.type,response?.filterResult?.reason?.description,response?.filterResult?.reason?.message,...problems(response)].map(C.clean).filter(Boolean);
    const explicit=overageLabel(type)||labels.some(overageLabel);
    if(!explicit||labels.some(x=>!benignCompanion(x)))return false;
    return !/hazmat|dangerous.?goods|invalid\s+barcode|incompatib|damaged|predicant|customer\s*bound/i.test([type,...labels].join(' '));
  };
  const resolveItem=(response,barcode)=>{
    const type=C.clean(response?.['@type']),overage=allowedOverage(response);
    if(!response||type==='RequestMultipleBarcodesResponse'||type==='InvalidBarcodeResponse'||(response.success===false&&!overage))return{ok:false,invalid:type==='InvalidBarcodeResponse',type:type||'Unknown'};
    const records=(Array.isArray(response.items)?response.items:[]).filter(x=>x?.skuDetail);
    const identities=new Set(records.map(x=>[x.skuDetail.asin,x.skuDetail.fnSku,x.skuDetail.fcSku].map(C.upper).join('|')));
    if(identities.size>1)return{ok:false,invalid:false,type:'RequestMultipleBarcodesResponse'};
    const item=records[0]||null,sku=item?.skuDetail;
    if(!item||!sku)return{ok:false,invalid:false,type:type||'Unknown'};
    return{ok:true,type,barcode,item,records,sku,asin:C.clean(sku.asin),fnsku:C.clean(sku.fnSku),fcsku:C.clean(sku.fcSku),dateType:C.clean(sku.datelotDetail?.expirationPromptType),dateDetail:sku.datelotDetail||{},hazmat:sku.hazmat===true,permissionLevel:C.upper(sku.itemDropzoneRecommendation?.permissionLevel),overage};
  };
  const responseText=response=>[response?.['@type'],response?.message,response?.description,response?.errorMessage,response?.errorCode,response?.filterResult?.filterType,response?.filterResult?.reason?.type,response?.filterResult?.reason?.description,response?.filterResult?.reason?.message,...problems(response)].map(C.clean).filter(Boolean).join(' ');
  const baseClassify=(response,barcode)=>{
    const ctx=resolveItem(response,barcode),text=responseText(response);
    if(/damaged/i.test(text))return{kind:'red',reason:'DAMAGED / INCOMPATIBLE',ctx};
    if(hazmatRejected(response))return{kind:'red',reason:'HAZMAT / DANGEROUS GOODS',ctx};
    if(!ctx.ok)return{kind:'red',reason:ctx.invalid?'INVALID BARCODE':ctx.type==='RequestMultipleBarcodesResponse'?'MULTIPLE BARCODE MATCHES':(ctx.type&&ctx.type!=='Unknown'?ctx.type:'NO ITEM DETAILS'),ctx};
    if(ctx.permissionLevel==='UNDER_REVIEW')return{kind:'red',reason:ctx.hazmat?'HAZMAT / UNDER REVIEW — RIVER REQUIRED':'ASIN UNDER REVIEW — RIVER REQUIRED',ctx};
    if(ctx.dateType==='EXPIRATION_DATE'||ctx.dateType==='PRODUCTION_DATE')return{kind:'yellow',reason:ctx.dateType==='PRODUCTION_DATE'?'PRODUCTION DATE':'EXPIRY DATE',ctx};
    return{kind:'green',reason:'GOOD TO GO',ctx};
  };
  const moveOk=response=>allowedOverage(response)||Boolean(response&&response.success===true&&response.filterResult?.compatible!==false&&!hazmatRejected(response)&&!hasPredicant(response));
  const moveReason=response=>{
    if(!response)return'EMPTY MOVE RESPONSE';if(hazmatRejected(response))return'HAZMAT';if(allowedOverage(response))return'OVERAGE';if(damagedDestination(response))return'DESTINATION DAMAGED';
    const reason=response.filterResult?.reason;if(response.filterResult?.compatible===false)return C.upper(reason?.type)||'DESTINATION INCOMPATIBLE';
    const p=problems(response);return p.length?p.join(', '):C.clean(response?.['@type']).replace(/Response$/,'')||'MOVE REJECTED';
  };
  const maxDay=(year,month)=>new Date(year,month,0).getDate();
  const validDate=(day,month,year)=>{const d=Number(day),m=Number(month),y=Number(year);if(!Number.isInteger(d)||!Number.isInteger(m)||!Number.isInteger(y)||y<1900||y>2200||m<1||m>12||d<1||d>maxDay(y,m))return null;return new Date(y,m-1,d).getTime();};

  function create({life,telemetry}={}){
    let warehousePromise=null,preflightInflight=new Map();
    const api=async(path,{method='GET',body,signal,allowHttpError=false,fullResponse=false}={})=>{
      const r=await C.request(ORIGIN+path,{method,body:body==null?undefined:JSON.stringify(body),headers:body==null?{}:{'Content-Type':'application/json'},timeout:15000,allowHttpError,signal:signal||life?.signal});
      return fullResponse?r:r.data;
    };
    const warehouse=async()=>{if(!warehousePromise)warehousePromise=(async()=>{try{const p=await api(PATH.bootstrap+'?tool='+encodeURIComponent(TOOL));const info=p?.warehouseInfo;return C.upper((typeof info==='string'?info:'')||info?.warehouseId||info?.id||info?.warehouse||info?.fc||info?.code||p?.warehouseId||'');}catch(error){warehousePromise=null;throw error;}})();return warehousePromise;};
    const source=async container=>{
      const code=C.clean(container);if(!C.container(code))throw new Error('Invalid source container');
      const payload=await api(PATH.source,{method:'POST',body:scanSourcePayload(code)});
      if(payloadHasCustomerBound(payload))throw new Error('CUSTOMER-BOUND SHIPMENT');
      if(C.clean(payload?.['@type'])!=='ScanSourceContainerResponse'||payload?.success!==true)throw new Error(C.clean(payload?.message||payload?.description||payload?.errorMessage||payload?.['@type']||'SOURCE VALIDATION FAILED'));
      return payload;
    };
    const close=async(container,empty=false)=>{
      const code=C.clean(container);if(!C.container(code))throw new Error('Invalid container');
      const op=C.operation({kind:'sideline-close',ref:code,telemetry});op.submitted();
      let response;try{response=await api(PATH.close,{method:'POST',body:closePayload(code,empty),allowHttpError:true,fullResponse:true});}catch(error){op.unknown({reason:'transport'});throw new C.UnknownError('CLOSE OUTCOME UNKNOWN — '+code+' — VERIFY BEFORE RETRY',{cause:error});}
      const payload=response.data;
      if(response.status>=500||response.status===408||!payload||typeof payload!=='object'){op.unknown({reason:'ambiguous-response'});throw new C.UnknownError('CLOSE OUTCOME UNKNOWN — verify '+code);}
      if(C.clean(payload?.['@type'])!=='CloseContainerResponse'||payload?.success!==true){if(payload.success!==false){op.unknown({reason:'unexpected-response'});throw new C.UnknownError('CLOSE response ambiguous — verify '+code);}op.rejected({reason:moveReason(payload)});throw new C.RejectedError(C.clean(payload?.message||payload?.description||payload?.['@type']||'CLOSE REJECTED'));}
      op.confirmed();return payload;
    };
    const rawItem=(sourceContainer,barcode,signal)=>api(PATH.item,{method:'POST',body:scanItemPayload(sourceContainer,barcode),signal});
    const pandashService=V3.pandash.create({life});
    const hazmat=async asin=>pandashService.lookup(asin,await warehouse());
    const classify=async(response,barcode)=>{
      let result=baseClassify(response,barcode);
      if(result.kind==='red'||!result.ctx?.hazmat)return result;
      try{
        const h=await hazmat(result.ctx.asin);
        if(!h.allowed)return{kind:'red',reason:'HAZMAT L'+h.level+' — NOT PROCESSABLE',ctx:result.ctx,hazmat:h};
        return{...result,reason:result.kind==='yellow'?result.reason:'HAZMAT L'+h.level+' — OK TO PROCESS',hazmat:h};
      }catch(error){return{kind:'retry',reason:'HAZMAT CHECK FAILED — '+C.clean(error.message||error),ctx:result.ctx};}
    };
    const preflight=async(sourceContainer,barcode,{signal}={})=>{
      const key=C.upper(sourceContainer)+'|'+C.upper(barcode);
      if(preflightInflight.has(key))return preflightInflight.get(key);
      const work=(async()=>{const response=await rawItem(sourceContainer,barcode,signal);const result=await classify(response,barcode);telemetry?.emit('sideline.preflight',{item:C.mask(barcode),kind:result.kind,reason:result.reason});return{response,result};})();
      preflightInflight.set(key,work);try{return await work;}finally{preflightInflight.delete(key);}
    };
    const movePayload=(sourceContainer,destination,sourceMeta,ctx,qty,expirationMs)=>{
      const item=ctx.item,sku=ctx.sku,records=ctx.records?.length?ctx.records:[item];
      return{itemExternalId:null,sourceContainerScannableId:sourceContainer,destinationContainerScannableId:destination,scannableId:C.clean(item.scannableId||ctx.barcode),quantity:String(Math.max(1,Number(qty)||1)),itemDetails:records.map(record=>{const s=record.skuDetail||sku;return{fcsku:C.clean(s.fcSku),quantity:Number.isFinite(Number(record.quantity))?Number(record.quantity):0,consumerType:record.consumer??null,disposition:record.disposition??null,referenceId:record.referenceId??null,fnsku:C.clean(s.fnSku)};}),foundProblems:[null,null,null],scannedSourceContainerAsDestination:false,datelotDetail:sku.datelotDetail||null,userEnteredExpirationDate:expirationMs??null,mlcCaptureDetail:{mlcClass:sku.mlcDetail?.mlcClass??'UNKNOWN',userEnteredLotCode:null,mlcMissing:sku.mlcDetail?.mlcMissing??false,mlcNotEnteredReason:null,mlcCaptureMethod:null},itemMovedToISS:false,candidatePurchaseOrders:[],packHierarchyDetail:null,itemAndonContext:null,processPath:sourceMeta?.processPath??'UNDETERMINED',requestId:requestId(),tool:TOOL};
    };
    const move=async({sourceContainer,destination,sourceMeta,preflightResult,qty=1,expirationMs=null})=>{
      if(!C.container(sourceContainer)||!C.container(destination)||C.upper(sourceContainer)===C.upper(destination))throw new Error('Valid different containers required');
      if(!Number.isSafeInteger(Number(qty))||Number(qty)<1)throw new Error('Whole positive quantity required');
      const ctx=preflightResult?.result?.ctx||preflightResult?.ctx;if(!ctx?.ok)throw new Error('Item was not safely preflighted');
      const payload=movePayload(sourceContainer,destination,sourceMeta,ctx,qty,expirationMs),ref=ctx.barcode||ctx.fnsku||ctx.asin;
      const op=C.operation({kind:'sideline-move',ref,telemetry});op.submitted({qty:Number(qty)||1});
      let response;
      try{response=await api(PATH.move,{method:'POST',body:payload,allowHttpError:true,fullResponse:true});}
      catch(error){op.unknown({reason:'transport'});throw new C.UnknownError('MOVE OUTCOME UNKNOWN — '+C.clean(ref)+' — VERIFY BEFORE RETRY',{cause:error});}
      const result=response.data;
      if(response.status>=500||response.status===408||!result||typeof result!=='object'){op.unknown({reason:'ambiguous-response'});throw new C.UnknownError('MOVE OUTCOME UNKNOWN — '+C.clean(ref)+' — VERIFY BEFORE RETRY');}
      if(!response.httpError&&moveOk(result)){op.confirmed({reason:allowedOverage(result)?'overage':'success'});return result;}
      if(result.success!==false&&result.filterResult?.compatible!==false&&!hasPredicant(result)&&!hazmatRejected(result)){op.unknown({reason:'unrecognized-response'});throw new C.UnknownError('MOVE response ambiguous — verify '+C.clean(ref));}
      const reason=moveReason(result);op.rejected({reason});const e=new C.RejectedError(reason);e.predicant=hasPredicant(result);e.recoverable=damagedDestination(result)||/DESTINATION INCOMPATIBLE/i.test(reason);throw e;
    };
    return Object.freeze({warehouse,source,close,preflight,hazmat,move,movePayload});
  }

  return Object.freeze({ORIGIN,PATH,scanSourcePayload,scanItemPayload,closePayload,resolveItem,baseClassify,allowedOverage,hazmatRejected,damagedDestination,hasPredicant,moveOk,moveReason,validDate,create});
})();

// ---- src/workflow-ui.js ----
V3.workflowUI = (() => {
  const C = V3.core;
  const formKey = key => 'bwu2.v3.form.' + key;
  const read = (key, fallback = '') => localStorage.getItem(formKey(key)) ?? fallback;
  const write = (key, value) => localStorage.setItem(formKey(key), String(value ?? ''));
  const buttonRow = '<div class="v3-row"><button class="v3-btn primary" data-run>RUN</button><button class="v3-btn" data-stop disabled>STOP AFTER CURRENT</button><button class="v3-btn danger" data-attn hidden>I VERIFIED IT · CLEAR ATTENTION</button></div><div class="v3-note" data-status>Ready</div><div data-progress></div>';
  const field = (label, key, type = 'input', extra = '') => '<label class="v3-field">' + label + '<' + type + ' data-field="' + key + '" ' + extra + '></' + type + '></label>';
  const select = (label, key, values) => field(label, key, 'select').replace('</select>', values.map(value => '<option>' + C.esc(value) + '</option>').join('') + '</select>');
  const modes = values => '<div class="v3-tabs">' + values.map(([key, label]) => '<button class="v3-btn" data-mode="' + key + '">' + label + '</button>').join('') + '</div>';
  function mount(root, {prefix, html, defaults, defaultMode, run, stop, resolveAttention, paintMode, quantity} = {}) {
    let busy = false, disposed = false, mode = read(prefix + '.mode', defaultMode || '');
    let attention = read('aft.attention', '') || read(prefix + '.running', '');let runInfo=null;try{runInfo=JSON.parse(read(prefix+'.journal','null'));}catch{attention='Saved progress unreadable — verify previous work';}
    root.innerHTML = '<section class="v3-section">' + html + buttonRow + '</section>';
    const q = selector => root.querySelector(selector), values = {};
    for (const element of root.querySelectorAll('[data-field]')) {
      const key = element.dataset.field; element.value = read(prefix + '.' + key, defaults?.[key] || '');
      values[key] = element;
      element.addEventListener(element.tagName === 'SELECT' ? 'change' : 'input', () => write(prefix + '.' + key, element.value));
    }
    const status = (message, kind = '') => { if (disposed) return; q('[data-status]').className = 'v3-note ' + (kind ? 'v3-' + kind : ''); q('[data-status]').textContent = message; };
    const controls = () => {
      for (const element of root.querySelectorAll('input,textarea,select,[data-mode]')) element.disabled = busy;
      q('[data-run]').disabled = busy || Boolean(attention); q('[data-stop]').disabled = !busy;
      q('[data-attn]').hidden = !attention;
    };
    const paint = () => { for (const button of root.querySelectorAll('[data-mode]')) button.classList.toggle('active', button.dataset.mode === mode); paintMode?.(root, mode); };
    for (const button of root.querySelectorAll('[data-mode]')) button.onclick = () => { if (busy) return; mode = button.dataset.mode; write(prefix + '.mode', mode); paint(); };
    const progress = info => {
      write(prefix+'.journal',JSON.stringify({info,items:(values.items||values.locations||values.rows)?.value||''}));
      if (disposed) return;
      status((info.current ? info.current + '/' + info.total + ' · ' : '') + info.stage + (info.sku || info.barcode ? ' · ' + (info.sku || info.barcode) : ''), 'warn');
      q('[data-progress]').textContent = info.confirmed != null ? 'Confirmed: ' + info.confirmed + (info.total != null ? ' / ' + info.total : '') : '';
      quantity?.(root, info);
    };
    const replaceItems = rows => {
      const element = values.items || values.locations || values.rows;
      if (!element) return;
      element.value = rows.map(row => typeof row === 'string' ? row : [row.location, row.asin, row.fnsku || row.date].filter(Boolean).join(' ')).join('\n');
      write(prefix + '.' + element.dataset.field, element.value);
    };
    q('[data-run]').onclick = async () => {
      if (busy || attention || disposed) return;
      busy = true; write(prefix + '.running', 'Previous run ended without confirmation'); controls(); status('Starting…', 'warn');
      try {
        const input = Object.fromEntries(Object.entries(values).map(([key, element]) => [key, element.value]));
        const result = await run({...input, mode, onProgress: progress});
        const failed = result.failed || [];
        replaceItems([...(result.remaining||[]),...failed.map(row=>row.sku||row.location).filter(Boolean)]);
        status((result.stopped||result.remaining?.length ? 'STOPPED · ' : 'DONE ✓ ') + (result.confirmed ?? result.flipped ?? 0) +
          (result.total != null ? '/' + result.total : '') + (result.zero ? ' · ' + result.zero + ' zero' : '') +
          (failed.length ? ' · ' + failed.length + ' rejected' : ''), failed.length || result.stopped ? 'warn' : 'ok');
      } catch (error) {
        if(error.aftPartial?.remaining)replaceItems(error.aftPartial.remaining);else if(error.outcome==='unknown'){const input=values.items||values.locations||values.rows;if(input){write(prefix+'.uncertain',input.value);replaceItems([]);}}
        if (error.outcome === 'unknown') { attention = C.clean(error.message || error); write('aft.attention', attention); }
        status((attention ? 'OUTCOME UNKNOWN — VERIFY BEFORE RETRY · ' : 'STOPPED · ') + C.clean(error.message || error), attention ? 'bad' : 'warn');
      } finally { busy = false; localStorage.removeItem(formKey(prefix + '.running'));localStorage.removeItem(formKey(prefix+'.journal')); controls(); }
    };
    q('[data-stop]').onclick = () => { stop?.(); status('Stop requested — finishing current action', 'warn'); };
    q('[data-attn]').onclick = async () => {
      if (busy) return;
      try { await resolveAttention?.(); attention = ''; localStorage.removeItem(formKey('aft.attention')); localStorage.removeItem(formKey(prefix + '.running'));localStorage.removeItem(formKey(prefix+'.journal')); controls(); status('Attention cleared'); }
      catch (error) { status(error.message, 'bad'); }
    };
    if(attention&&runInfo){const lines=String(runInfo.items||'').split(/\r?\n/).filter(Boolean),skip=Number(runInfo.info?.current||runInfo.info?.confirmed||0);write(prefix+'.uncertain',lines.slice(0,skip).join('\n'));replaceItems(lines.slice(skip));}
    paint(); controls(); if (attention) status('VERIFY PREVIOUS RUN · ' + attention, 'bad');
    return Object.freeze({get isBusy() { return busy; }, dispose() { disposed = true; stop?.(); }});
  }
  function mountMove(root, {run, stop, resolveAttention, prefix = 'move'} = {}) {
    return mount(root, {prefix, stop, resolveAttention, defaultMode: 'all', defaults: {qty: '1'},
      html: modes([['all','ALL'],['each','EACH = 1'],['qty','QTY']]) +
        '<div data-qty-wrap hidden>' + field('Quantity', 'qty', 'input', 'type="number" min="1"') + '</div>' +
        field('Source','source') + field('Destination','destination') + field('Items','items','textarea'),
      paintMode: (node, mode) => { node.querySelector('[data-qty-wrap]').hidden = mode !== 'qty'; },
      run: input => run({...input, qty: Number(input.qty)})});
  }
  function mountEdit(root, {runEach, runSku, stop, resolveAttention, prefix = 'edit'} = {}) {
    const states = ['Sellable','Pending Research','Unsellable'], dispositions = ['Defective','Amazon Damage','Distributor Damage','Expired'];
    return mount(root, {prefix, stop, resolveAttention, defaultMode: 'sku',
      defaults: {sourceState: 'Sellable', sourceDamage: 'Defective', destState: 'Pending Research', destDamage: 'Defective'},
      html: modes([['each','EACH'],['sku','SKU']]) + '<div data-source-wrap>' +
        select('Source state','sourceState',states) + select('Source disposition','sourceDamage',dispositions) + '</div>' +
        select('Target state','destState',states) + select('Target disposition','destDamage',dispositions) +
        field('<span data-items-label>Items</span>','items','textarea') + '<div data-qty></div>',
      paintMode: (node, mode) => { node.querySelector('[data-source-wrap]').hidden = mode === 'each';
        node.querySelector('[data-items-label]').textContent = mode === 'each' ? 'TOTE  ASIN  [FNSKU] — one row per item' : 'SKU / ASIN / FNSKU / FCSKU — one per line'; },
      quantity: (node, info) => { if (info.inventory) node.querySelector('[data-qty]').textContent = 'Qty: S ' + (info.inventory.SELLABLE ?? '—') + ' · P ' + (info.inventory.PENDING_RESEARCH ?? '—') + ' · U ' + (info.inventory.UNSELLABLE ?? '—'); },
      run: input => input.mode === 'each' ? runEach(input) : runSku(input)});
  }
  const mountFcsku = (root, {run, stop, resolveAttention, prefix = 'fcsku'} = {}) => mount(root, {prefix, run, stop, resolveAttention,
    html: field('OLD FCSKU','oldCode') + field('NEW FCSKU','newCode') + field('Locations / Containers','locations','textarea')});
  const mountDate = (root, {run, stop, resolveAttention, prefix = 'date'} = {}) => mount(root, {prefix, stop, resolveAttention,
    html: field('LOCATION  ASIN  YYYY-MM-DD','rows','textarea'), run: input => run({...input, rows: input.rows.split(/\r?\n/).map(C.clean).filter(Boolean).map(line => {
      const [location, asin, date] = line.split(/\s+/); return {location, asin, date}; })})});
  return Object.freeze({mountMove, mountEdit, mountFcsku, mountDate});
})();

// ---- src/sideline-ui.js ----
V3.sidelineUI = (() => {
  const C = V3.core, globalDates = new Map();
  let activeDate = null;
  const parseItems = (text, source = '', dest = '') => {
    const rows = new Map();
    for (const line of String(text || '').split(/\r?\n/)) {
      const code = C.clean(line.split(/\s+/)[0]);
      if (!code || [source,dest].some(value => C.upper(value) === C.upper(code))) continue;
      const key = C.upper(code), row = rows.get(key) || {code, qty: 0}; row.qty++; rows.set(key,row);
    }
    return [...rows.values()];
  };
  const dateLabel = ms => new Date(ms).toLocaleDateString('en-AU');
  const today = () => { const date = new Date(); date.setHours(0,0,0,0); return date; };
  const pao900 = () => { const date = today(); date.setDate(date.getDate()+900); return date.getTime(); };
  const dateKey = ctx => [C.upper(ctx?.fnsku || ctx?.asin || ctx?.barcode),ctx?.dateType,ctx?.dateDetail?.shelfLife || 0].join('|');
  function pickDate({ctx, life, signal = life?.signal, requireShelfLife = true} = {}) {
    if (activeDate) return Promise.resolve(null);
    return new Promise(resolve => {
      const production = ctx?.dateType === 'PRODUCTION_DATE', currentYear = today().getFullYear();
      const selection = {month: 0, day: 1, year: 0};
      const overlay = document.createElement('div'); overlay.dataset.bwu2Ui = '1';
      overlay.className = 'v3-expiry'; overlay.innerHTML = '<div class="v3-expiry-card"></div>';
      document.body.appendChild(overlay); const card = overlay.firstElementChild;
      const close = value => { signal?.removeEventListener('abort', cancel); overlay.remove(); activeDate = null; resolve(value); };
      const cancel = () => close(null); activeDate = {close: cancel}; signal?.addEventListener('abort', cancel, {once:true});
      const allowed = ms => ms != null && (production ? ms <= Date.now() : ms >= today().getTime());
      const render = () => {
        const image = C.clean(ctx?.sku?.imageUrls?.[0]).replace(/^http:/,'https:');
        const title = ctx?.sku?.title || ctx?.sku?.normalizedTitle || ctx?.asin || ctx?.barcode || 'Item';
        const buttons = (name, values) => values.map(([value,label]) => {
          const ms = name === 'year' ? V3.sideline.validDate(selection.day,selection.month,value) : null;
          const disabled = name === 'day' && (!selection.month || value > new Date(selection.year || 2000,selection.month,0).getDate()) || name === 'year' && !allowed(ms);
          return '<button class="v3-btn'+(selection[name]===value?' primary':'')+'" data-part="'+name+'" data-value="'+value+'"'+(disabled?' disabled':'')+'>'+label+'</button>';
        }).join('');
        card.innerHTML = '<h2>REQUIRES '+(production?'PRODUCTION':'EXPIRATION')+' DATE</h2><div class="v3-row">'+
          (image?'<img width="90" height="90" style="object-fit:contain" src="'+C.esc(image)+'" alt="">':'')+
          '<div><b>'+C.esc(title)+'</b><div>ASIN '+C.esc(ctx?.asin)+' · FNSKU '+C.esc(ctx?.fnsku)+'</div></div></div>'+
          '<div class="v3-date-grid"><section><b>MONTH</b><div>'+buttons('month',Array.from({length:12},(_,i)=>[i+1,new Date(2026,i,1).toLocaleString('en-AU',{month:'short'})]))+'</div></section>'+
          '<section><b>DAY</b><div>'+buttons('day',Array.from({length:31},(_,i)=>[i+1,i+1]))+'</div></section>'+
          '<section><b>YEAR</b><div>'+buttons('year',Array.from({length:16},(_,i)=>[currentYear+(production?-i:i),currentYear+(production?-i:i)]))+'</div></section></div>'+
          '<div class="v3-row">'+(!production?'<button class="v3-btn" data-pao>PAO +900 DAYS · '+dateLabel(pao900())+'</button>':'')+
          '<button class="v3-btn primary" data-use '+(!selection.year?'disabled':'')+'>USE DATE</button><button class="v3-btn" data-cancel>CANCEL</button></div>';
        for (const button of card.querySelectorAll('[data-part]')) button.onclick=()=>{
          selection[button.dataset.part]=Number(button.dataset.value); if(button.dataset.part!=='year')selection.year=0;
          if(button.dataset.part==='month')selection.day=1;
          if(button.dataset.part==='year')useDate();else render();
        };
        card.querySelector('[data-cancel]').onclick=cancel;
        card.querySelector('[data-pao]')?.addEventListener('click',()=>{const ms=pao900();close({enteredMs:ms,finalExpirationMs:ms});});
        card.querySelector('[data-use]').onclick=useDate;
      };
      const useDate=()=>{
          const enteredMs=V3.sideline.validDate(selection.day,selection.month,selection.year);if(!allowed(enteredMs))return;
          const shelfLife=Number(ctx?.dateDetail?.shelfLife);
          if(production&&requireShelfLife&&(!Number.isFinite(shelfLife)||shelfLife<=0))return;
          close({enteredMs,finalExpirationMs:production?(Number.isFinite(shelfLife)&&shelfLife>0?enteredMs+shelfLife:null):enteredMs});
      };
      render(); if(signal?.aborted)cancel();
    });
  }
  function mount(root,{engine,life,title='Sideline',prefix='sideline'}={}) {
    const key='bwu2.v3.form.'+prefix+'.',get=(name,fallback='')=>localStorage.getItem(key+name)??fallback;
    let running=false,stop=false,paused=false,attention=get('attention'),generation=0,controller=new AbortController(),debounce=0,waiter=null;
    const lookup=new Map(),inflight=new Map(),dates=new Map(); let rows=[];
    root.innerHTML='<section class="v3-section"><b>'+C.esc(title)+'</b><div class="v3-grid">'+
      '<label class="v3-field">Source<input data-source autocomplete="off"></label><label class="v3-field">Destination<input data-dest autocomplete="off"></label></div>'+
      '<label class="v3-field">Items<textarea data-items placeholder="scan / paste one barcode per line"></textarea></label>'+
      '<div class="v3-row"><button class="v3-btn primary" data-clear>CLEAR SOURCE: ON</button><button class="v3-btn primary" data-delay>DELAY 2–8s: ON</button></div>'+
      '<div class="v3-row"><button class="v3-btn primary" data-run>RUN LAZY</button><button class="v3-btn" data-pause>PAUSE</button><button class="v3-btn" data-resume hidden>RESUME</button><button class="v3-btn danger" data-stop>STOP</button><button class="v3-btn" data-reset>RESET</button><button class="v3-btn danger" data-attn hidden>I VERIFIED IT · CLEAR ATTENTION</button></div><div class="v3-note" data-status></div></section>'+
      '<section class="v3-section"><div data-metrics></div><div data-list></div></section>';
    const q=selector=>root.querySelector(selector),source=q('[data-source]'),dest=q('[data-dest]'),items=q('[data-items]');
    source.value=get('source');dest.value=get('dest');items.value=get('items');
    let clear=get('clear','1')==='1',delay=get('delay','1')==='1';
    const status=(message,kind='')=>{q('[data-status]').className='v3-note '+(kind?'v3-'+kind:'');q('[data-status]').textContent=message;};
    const save=()=>{for(const [name,element] of [['source',source],['dest',dest],['items',items]])localStorage.setItem(key+name,element.value);};
    const paint=()=>{
      const list=running?rows:parseItems(items.value,source.value,dest.value),counts={moved:0,aside:0,good:0,date:0,retry:0,total:0};
      q('[data-list]').innerHTML=list.map(row=>{const record=lookup.get(C.upper(row.code)),kind=row.status||record?.result?.kind||'waiting',reason=row.reason||record?.result?.reason||'WAITING';
        counts.total+=row.qty;if(kind==='done')counts.moved+=row.qty;else if(kind==='red'||kind==='rejected')counts.aside+=row.qty;else if(kind==='green')counts.good+=row.qty;else if(kind==='yellow')counts.date+=row.qty;else if(kind==='retry')counts.retry+=row.qty;
        return '<div class="v3-list-row"><b>'+C.esc(row.code)+'</b> ×'+row.qty+' · <b class="'+(['red','unknown','rejected'].includes(kind)?'v3-bad':kind==='yellow'||kind==='retry'?'v3-warn':'v3-ok')+'">'+C.esc(kind==='done'?'MOVED':reason)+'</b></div>';
      }).join('')||'<div class="v3-note">No items.</div>';
      q('[data-metrics]').textContent='TOTAL '+counts.total+' · MOVED '+counts.moved+' · GOOD '+counts.good+' · DATE '+counts.date+' · ASIDE '+counts.aside+' · RETRY '+counts.retry;
      source.disabled=items.disabled=running;dest.disabled=running&&!paused;
      q('[data-run]').disabled=running||Boolean(attention);q('[data-reset]').disabled=running;
      q('[data-attn]').hidden=!attention;q('[data-resume]').hidden=!paused;
      for(const [name,value] of [['clear',clear],['delay',delay]]){q('[data-'+name+']').textContent=(name==='clear'?'CLEAR SOURCE: ':'DELAY 2–8s: ')+(value?'ON':'OFF');q('[data-'+name+']').classList.toggle('primary',value);}
    };
    const resetLookups=()=>{generation++;controller.abort();controller=new AbortController();lookup.clear();inflight.clear();dates.clear();};
    const preflight=async()=>{
      const src=C.clean(source.value),list=parseItems(items.value,src,dest.value),run=generation;if(!C.container(src))return;
      let cursor=0;const worker=async()=>{while(cursor<list.length&&run===generation&&!controller.signal.aborted&&!stop){
        const row=list[cursor++],code=C.upper(row.code);if(lookup.has(code))continue;
        if(inflight.has(code)){await inflight.get(code);continue;}
        const request=(async()=>{try{const rec=await engine.preflight(src,row.code,{signal:controller.signal});if(run===generation)lookup.set(code,rec);}
          catch(error){if(run===generation)lookup.set(code,{result:{kind:'retry',reason:'LOOKUP FAILED · '+C.clean(error.message)}});}finally{if(run===generation){inflight.delete(code);paint();}}})();
        inflight.set(code,request);await request;
      }};await Promise.all(Array.from({length:Math.min(5,list.length)},worker));
    };
    const schedule=()=>{clearTimeout(debounce);debounce=setTimeout(()=>void preflight(),120);};
    source.oninput=()=>{save();resetLookups();schedule();};dest.oninput=save;items.oninput=()=>{save();paint();schedule();};
    source.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();dest.focus();dest.select();}};
    dest.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();if(paused)q('[data-resume]').click();else items.focus();}};
    for(const name of ['clear','delay'])q('[data-'+name+']').onclick=()=>{if(name==='clear')clear=!clear;else delay=!delay;localStorage.setItem(key+name,(name==='clear'?clear:delay)?'1':'0');paint();};
    const wait=message=>new Promise(resolve=>{paused=true;waiter=resolve;status(message,'warn');paint();});
    q('[data-resume]').onclick=()=>{if(!paused)return;paused=false;const resolve=waiter;waiter=null;resolve?.();paint();};
    q('[data-pause]').onclick=()=>{if(running){paused=true;status('Pause requested — finishing current action','warn');paint();}};
    const requestStop=()=>{stop=true;controller.abort();paused=false;waiter?.();waiter=null;activeDate?.close();status('Stop requested — finishing current action','warn');paint();};
    q('[data-stop]').onclick=()=>{if(running)requestStop();else q('[data-reset]').click();};
    q('[data-reset]').onclick=()=>{if(running||attention)return;resetLookups();source.value=dest.value=items.value='';save();rows=[];status('Ready');paint();};
    q('[data-attn]').onclick=async()=>{try{await V3.state.resolveAttention('sideline');attention='';localStorage.removeItem(key+'attention');status('Attention cleared');paint();}catch(error){status(error.message,'bad');}};
    q('[data-run]').onclick=async()=>{
      if(running||attention)return;
      if(controller.signal.aborted)resetLookups();running=true;stop=false;rows=parseItems(items.value,source.value,dest.value);paint();
      const journal=()=>localStorage.setItem(key+'run',JSON.stringify({source:source.value,dest:dest.value,rows}));
      try{await V3.state.exclusive('sideline',async()=>{
        V3.state.assertClear('sideline');
        if(!C.container(source.value)||!C.container(dest.value)||C.upper(source.value)===C.upper(dest.value))throw new Error('Valid different source/destination containers required');
        if(!rows.length)throw new Error('No items');journal();status('Preflight…','warn');await preflight();if(stop){status('STOPPED · no move sent','warn');return;}
        if(rows.some(row=>!lookup.has(C.upper(row.code))||lookup.get(C.upper(row.code)).result.kind==='retry'))throw new Error('PREFLIGHT FAILED — no moves sent');
        const sourceMeta=await engine.source(source.value);let establishedExpiry=null;
        for(const row of rows){if(stop)break;const rec=lookup.get(C.upper(row.code));row.status=rec.result.kind;
          if(rec.result.kind==='red')continue;
          if(rec.result.kind==='yellow'){
            const dkey=dateKey(rec.result.ctx),cached=globalDates.get(dkey);let chosen=dates.get(dkey)||(cached&&Date.now()-cached.at<8*60*60*1000?cached.value:null);
            if(!chosen)chosen=await pickDate({ctx:rec.result.ctx,life});if(!chosen)throw new Error('Date entry cancelled — no move sent for '+row.code);
            dates.set(dkey,chosen);globalDates.set(dkey,{value:chosen,at:Date.now()});
            if(globalDates.size>300)globalDates.delete(globalDates.keys().next().value);
            if(establishedExpiry!=null&&establishedExpiry!==chosen.finalExpirationMs){row.status='red';row.reason='MIXED EXPIRY — PROCESS IN NEXT WORKFLOW';continue;}
            establishedExpiry=chosen.finalExpirationMs;row.date=chosen;
          }
        }
        let moved=0;
        for(const row of rows){
          if(stop)break;if(paused)await wait('PAUSED — RESUME when ready');if(stop)break;
          if(row.status==='red')continue;
          if(moved&&delay)await C.sleep(2000+Math.floor(Math.random()*6001),life.signal);if(stop)break;
          let recovery=false;
          for(;;){if(stop)break;
            const target=C.clean(dest.value);if(!C.container(target)||C.upper(target)===C.upper(source.value))throw new Error('Invalid destination');
            row.status='moving';journal();paint();status('MOVING '+row.code+' ×'+row.qty,'warn');
            try{await engine.move({sourceContainer:source.value,destination:target,sourceMeta,preflightResult:lookup.get(C.upper(row.code)),qty:row.qty,expirationMs:row.date?.enteredMs??null});row.status='done';moved+=row.qty;journal();break;}
            catch(error){if(error.outcome==='unknown'){row.status='unknown';journal();throw error;}
              if(!recovery&&(error.predicant||error.recoverable)){recovery=true;row.status='rejected';journal();
                await wait(error.predicant?'PREDICANT — rescan SAME destination then RESUME':'DESTINATION REJECTED — enter NEW destination then RESUME');if(stop)break;
                if(error.predicant){if(C.upper(dest.value)!==C.upper(target))throw new Error('Rescan the same destination');await engine.close(target,true);}
                else if(!C.container(dest.value)||C.upper(dest.value)===C.upper(target))throw new Error('Choose a new valid destination');
                continue;
              }
              row.status='rejected';row.reason=C.clean(error.message);journal();break;
            }
          }paint();
        }
        const clean=rows.every(row=>row.status==='done');
        if(clean&&clear&&!stop){status('Clearing source…','warn');await engine.close(source.value,true);}
        items.value=rows.filter(row=>row.status!=='done').flatMap(row=>Array(row.qty).fill(row.code)).join('\n');save();
        status((stop?'STOPPED':clean?'DONE ✓':'DONE · source left open')+' · '+moved+' moved',clean?'ok':'warn');
      });}catch(error){items.value=rows.filter(row=>!['done','unknown','moving'].includes(row.status)).flatMap(row=>Array(row.qty).fill(row.code)).join('\n');save();if(error.outcome==='unknown'){attention=C.clean(error.message);localStorage.setItem(key+'attention',attention);}
        status((attention?'OUTCOME UNKNOWN — VERIFY BEFORE RETRY · ':'STOPPED · ')+C.clean(error.message),attention?'bad':'warn');
      }finally{running=false;paused=false;waiter=null;localStorage.setItem(key+'lastRun',JSON.stringify(rows));localStorage.removeItem(key+'run');paint();}
    };
    const previous=get('run');if(previous){try{const saved=JSON.parse(previous);rows=saved.rows||[];items.value=rows.filter(row=>!['done','unknown','moving'].includes(row.status)).flatMap(row=>Array(row.qty).fill(row.code)).join('\n');save();localStorage.setItem(key+'lastRun',JSON.stringify(rows));}catch{}attention='Previous session ended during work — verify before retry';localStorage.setItem(key+'attention',attention);}
    if(attention)status('VERIFY PREVIOUS RUN · '+attention,'bad');else status('Scan source → destination → items.');paint();schedule();
    life.own(()=>{clearTimeout(debounce);controller.abort();requestStop();});
    return Object.freeze({get isBusy(){return running;},dispose(){clearTimeout(debounce);controller.abort();requestStop();}});
  }
  return Object.freeze({parseItems,pickDate,mount});
})();

// ---- src/sideline-native.js ----
V3.sidelineNative = (() => {
  const C=V3.core,N=V3.native;
  const step=()=>{
    const labels=[...N.root().querySelectorAll('h1,h2,h3,h4,label,legend,span,div,p,strong,b,[role="heading"]')].filter(N.visible).map(el=>C.lower(el.textContent));
    for(const [name,re] of [['quantity',/^enter quantity$/],['verify',/^verify item$/],['production',/^enter production date/],['expiry',/^enter (expiry|expiration) date/],['destination',/^scan destination container$/],['source',/^scan source container$/],['item',/^scan item$/]])if(labels.some(value=>re.test(value)))return name;
    return '';
  };
  const input=()=>{const direct=document.getElementById('scan-text-input');return N.visible(direct)?direct:N.inputs().find(el=>['text','search','tel','number',''].includes(el.type));};
  const button=re=>[...document.querySelectorAll('button,[role="button"],input[type="submit"],input[type="button"]')].filter(N.visible).find(el=>!el.disabled&&re.test(C.lower(el.innerText||el.textContent||el.value)));
  const confirm=()=>{const direct=document.getElementById('confirm-button');return N.visible(direct)&&!direct.disabled?direct:button(/^(confirm|item match|continue|submit|enter)\b/);};
  function mountQueue(root,{engine,life,prefix='sideline.queue'}={}) {
    const queue=C.queue({name:prefix,life}),draftKey='bwu2.v3.form.'+prefix+'.draft';
    let busy=false,stopped=false,disposed=false,ready=false;
    root.innerHTML='<section class="v3-section"><label class="v3-field">Containers<textarea data-input placeholder="tsX...\ncsX..."></textarea></label><div class="v3-row"><button class="v3-btn" data-add>ADD</button><button class="v3-btn primary" data-run>RUN</button><button class="v3-btn" data-pause>PAUSE</button><button class="v3-btn danger" data-stop>STOP</button><button class="v3-btn danger" data-verify hidden>I VERIFIED IT · RETRY ATTENTION</button></div><div class="v3-note" data-msg></div></section><section class="v3-section"><div data-list></div></section>';
    const q=selector=>root.querySelector(selector),input=q('[data-input]');input.value=localStorage.getItem(draftKey)||'';
    input.oninput=()=>localStorage.setItem(draftKey,input.value);
    const message=value=>{if(!disposed)q('[data-msg]').textContent=value;};
    const paint=()=>{if(disposed)return;
      q('[data-list]').innerHTML=queue.state.items.map(row=>'<div class="v3-list-row"><b>'+C.esc(row.id)+'</b> · '+C.esc(row.status.toUpperCase())+(row.error?' · '+C.esc(row.error):'')+'</div>').join('')||'<div class="v3-note">Queue empty.</div>';
      input.disabled=q('[data-add]').disabled=busy||!ready;q('[data-run]').disabled=busy||!ready;
      q('[data-stop]').disabled=!ready;q('[data-verify]').hidden=!queue.state.items.some(row=>['attention','rejected'].includes(row.status))&&!V3.state.attention('sideline');
    };
    const add=async()=>{await queue.add(C.lines(input.value));input.value='';localStorage.removeItem(draftKey);paint();};
    q('[data-add]').onclick=async()=>{if(busy||!ready)return;try{await add();}catch(error){message(error.message);}};
    q('[data-run]').onclick=async()=>{
      if(busy||!ready||disposed)return;busy=true;stopped=false;let owns=false;paint();
      try{
        if(input.value.trim())await add();
        if(!await queue.acquire())throw new Error('Queue active in another tab');owns=true;
        V3.state.assertClear('sideline');if(queue.state.items.some(row=>row.status==='attention'))throw new C.UnknownError('Verify ATTENTION before RUN');
        if(!queue.next())throw new Error('Add containers first');
        await queue.set({running:true});
        for(let row=queue.next();row&&!stopped;row=queue.next()){
          await queue.item(row,{status:'active',error:''});await queue.set({current:row.id});paint();message('Validating '+row.id);
          try{await V3.state.exclusive('sideline',async()=>{
            V3.state.assertClear('sideline');await engine.source(row.id);
            if(stopped)throw Object.assign(new Error('Stopped before close'),{outcome:'cancelled'});
            message('Closing '+row.id);await engine.close(row.id,true);
          });await queue.item(row,{status:'done'});}
          catch(error){const unknown=error.outcome==='unknown',cancelled=error.outcome==='cancelled';
            await queue.item(row,{status:unknown?'attention':cancelled?'queued':'rejected',error:cancelled?'':C.clean(error.message)});
            message(error.message);if(unknown||cancelled)stopped=true;
          }
          await queue.set({current:''});paint();
        }
        message(stopped?'STOPPED · press STOP again to clear fields':'Queue complete');
      }catch(error){message(error.message);}
      finally{try{if(owns)await queue.set({running:false,current:''});}catch(error){message('Recovery save failed · '+error.message);}finally{await queue.release();busy=false;paint();}}
    };
    q('[data-pause]').onclick=()=>{stopped=true;message('Pause requested — finishing submitted action');};
    q('[data-stop]').onclick=async()=>{
      if(!ready||disposed)return;
      if(busy){stopped=true;message('Stop requested — finishing submitted action');return;}
      busy=true;paint();let owns=false;
      try{
        if(!await queue.acquire())throw new Error('Queue active in another tab');owns=true;
        // Clearing ordinary rows must never erase an uncertain mutation.
        await queue.set({items:queue.state.items.filter(row=>row.status==='attention'),running:false,current:'',phase:'idle'});
        input.value='';localStorage.removeItem(draftKey);
        message(queue.state.items.length||V3.state.attention('sideline')?'Fields cleared · VERIFY uncertain work':'Fields cleared');
      }catch(error){message(error.message);}finally{if(owns)await queue.release();busy=false;paint();}
    };
    q('[data-verify]').onclick=async()=>{if(busy)return;try{await V3.state.resolveAttention('sideline');await queue.resolve();message('Verified rows returned to queue');paint();}catch(error){message(error.message);}};
    paint();void queue.load().then(()=>{ready=true;message('Ready');paint();}).catch(error=>message(error.message));
    life.own(()=>{stopped=true;disposed=true;});
    return Object.freeze({get isBusy(){return busy;},dispose(){stopped=true;disposed=true;}});
  }
  function mountQuantity(root,{life}={}) {
    let busy=false;const controller=new AbortController();life.own(()=>controller.abort());
    root.innerHTML='<section class="v3-section"><div class="v3-row">'+Array.from({length:10},(_,i)=>i+1).map(qty=>'<button class="v3-btn" data-qty="'+qty+'">'+qty+'</button>').join('')+'</div><label class="v3-field">Quantity<input data-number type="number" min="1" value="1"></label><div class="v3-row"><button class="v3-btn primary" data-send>SEND QTY</button><button class="v3-btn danger" data-clear>DOUBLE CLICK · CLEAR CURRENT</button><button class="v3-btn" data-cancel>CANCEL WAIT</button></div><div class="v3-note" data-status></div></section>';
    let waitController=null;const message=value=>root.querySelector('[data-status]').textContent=value;
    const run=async qty=>{if(busy)return;if(!Number.isSafeInteger(qty)||qty<1){message('Whole positive quantity required');return;}busy=true;waitController=new AbortController();const cancel=()=>waitController.abort();controller.signal.addEventListener('abort',cancel,{once:true});
      try{await V3.state.exclusive('sideline',async()=>{V3.state.assertClear('sideline');if(step()==='verify'){const btn=confirm();if(!btn)throw new Error('Native Verify button unavailable');btn.click();}
        message('Waiting for native Enter Quantity · '+qty);const el=await N.waitFor(()=>step()==='quantity'&&input(),{life,signal:waitController.signal,timeout:300000});N.setValue(el,qty);const btn=confirm();if(!btn)throw new Error('Native quantity confirmation unavailable');btn.click();message('QTY '+qty+' sent');});
      }catch(error){message(error.name==='AbortError'?'Waiting cancelled':error.message);}finally{controller.signal.removeEventListener('abort',cancel);waitController=null;busy=false;}
    };
    for(const btn of root.querySelectorAll('[data-qty]'))btn.onclick=()=>void run(Number(btn.dataset.qty));root.querySelector('[data-send]').onclick=()=>void run(Number(root.querySelector('[data-number]').value));
    root.querySelector('[data-cancel]').onclick=()=>waitController?.abort();root.querySelector('[data-clear]').ondblclick=async()=>{if(busy)return;busy=true;try{await V3.state.exclusive('sideline',async()=>{
      V3.state.assertClear('sideline');const change=document.getElementById('change-container-button')||button(/^change container/);if(!N.visible(change)||change.disabled)throw new Error('No open native container');change.click();
      const yes=await N.waitFor(()=>button(/^(yes|yes close|yes, close|empty|empty container)\b/),{life,timeout:5000});const op=C.operation({kind:'sideline-native-close',ref:'current native container',scope:'sideline'});op.submitted();yes.click();
      try{await N.waitFor(()=>step()==='source'&&!N.visible(yes),{life,timeout:15000});op.confirmed();message('Container cleared');}catch(error){op.unknown();throw new C.UnknownError('Native close outcome unknown — verify before retry',{cause:error});}
    });}catch(error){message(error.message);}finally{busy=false;}};
    message('Select QTY, then scan using the native page.');return Object.freeze({get isBusy(){return busy;},dispose(){controller.abort();waitController?.abort();}});
  }
  function dateHelper({life}={}) {
    let lastStep='',active=null;
    const check=()=>{
      const current=step();
      if(current===lastStep)return;
      lastStep=current;active?.abort();active=null;
      if(!['expiry','production'].includes(current))return;
      const fields={month:N.findInput(/\b(mm|month)\b/),day:N.findInput(/\b(dd|day)\b/),year:N.findInput(/\b(yyyy|year)\b/)};
      if(Object.values(fields).some(el=>!el)){lastStep='';return;}
      const controller=new AbortController();active=controller;
      const nativeText=C.clean(N.root().textContent);
      const ctx={dateType:current==='production'?'PRODUCTION_DATE':'EXPIRATION_DATE',
        asin:nativeText.match(/\bB[A-Z0-9]{9}\b/)?.[0]||'',fnsku:nativeText.match(/\bX[A-Z0-9]{9}\b/)?.[0]||''};
      void(async()=>{
        try{
          const chosen=await V3.sidelineUI.pickDate({ctx,life,signal:controller.signal,requireShelfLife:false});
          if(!chosen||controller.signal.aborted||step()!==current)return;
          const date=new Date(chosen.enteredMs);
          for(const [el,value] of [[fields.month,date.getMonth()+1],[fields.day,date.getDate()],[fields.year,date.getFullYear()]]){
            if(!N.visible(el))throw new Error('Native date screen changed — enter date manually');
            N.setValue(el,String(value).padStart(2,'0'));el.dispatchEvent(new Event('blur',{bubbles:true}));
          }
          const submit=confirm();if(!submit)throw new Error('Native date confirmation unavailable');submit.click();
        }catch(error){if(error.name!=='AbortError')C.telemetry('sideline',V3.build.version).emit('native.date.error',{message:error.message});}
        finally{if(active===controller)active=null;}
      })();
    };
    // Native application transitions also cover reloads and click-based scans.
    // Own panels live outside this root and do not drive date discovery.
    const target=N.root();
    const observer=new MutationObserver(check);observer.observe(target,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['hidden','aria-hidden','disabled']});
    life.own(()=>{observer.disconnect();active?.abort();});check();
  }
  function mountModes(root,{engine,life,prefix,title='Sideline'}={}) {
    let mode='lazy',active=null;const render=()=>{if(active?.isBusy)return;active?.dispose?.();root.innerHTML='<section class="v3-section"><div class="v3-row"><button class="v3-btn" data-lazy>LAZY</button><button class="v3-btn" data-queue>TOTE QUEUE</button></div></section><div data-work></div>';
      root.querySelector('[data-lazy]').onclick=()=>{mode='lazy';render();};root.querySelector('[data-queue]').onclick=()=>{mode='queue';render();};const work=root.querySelector('[data-work]');
      active=mode==='lazy'?V3.sidelineUI.mount(work,{engine,life,title,prefix}):mountQueue(work,{engine,life,prefix:prefix+'.queue'});
    };render();return Object.freeze({get isBusy(){return active?.isBusy;},dispose(){active?.dispose?.();}});
  }
  return Object.freeze({step,mountQueue,mountQuantity,dateHelper,mountModes});
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

// ---- src/apps/iss.js ----
V3.boot = () => {
  const C = V3.core, life = C.lifecycle('iss');
  const panel = C.panel({id: 'iss-console', title: 'V3 · ISS Console', width: 720, life});
  let worker=null,workerLife=null,workerRunning=false,workerProgress=false;
  const ensureWorker=()=>{
    if(!worker){
      workerLife=C.lifecycle('iss-aft-worker');
      worker=V3.bridge.client({origin:V3.aft.DEFAULT_ORIGIN,path:'/app/edititems?experience=Desktop',family:'aft',life:workerLife,
        onEvent:detail=>window.dispatchEvent(new CustomEvent('bwu2-v3:event',{detail}))});
    }
    return worker;
  };
  const runWorker=async(command,input={})=>{
    if(workerRunning)throw new Error('ISS AFT workflow already running');
    workerRunning=true;workerProgress=false;
    try{return await ensureWorker().run(command,{...input,onProgress:info=>{workerProgress=true;input.onProgress?.(info);}});}
    finally{workerRunning=false;}
  };
  const stopWorker=()=>{
    if(!workerRunning)return;
    worker.stop();
    // Before the first progress event, cancellation must also stop startup.
    // The canonical bridge rejects unsent work as cancelled and dispatched work
    // as UNKNOWN, preserving the verification barrier if delivery is uncertain.
    if(!workerProgress){workerLife.dispose();worker=null;workerLife=null;}
  };
  life.own(()=>workerLife?.dispose());
  const engine = V3.sideline.create({life, telemetry: C.telemetry('sideline', V3.build.version)});
  let tab = 'sideline', active = null, mounted = false;
  const render = () => {
    if (active?.isBusy) return;
    active?.dispose?.();
    const root = document.createElement('div');
    root.innerHTML = '<section class="v3-section"><b>ISS Console</b><div class="v3-tabs">' +
      [['edit','EDIT'],['move','MOVE'],['sideline','SIDELINE'],['fcsku','FCSKU']].map(([key,label]) =>
        '<button class="v3-btn' + (key === tab ? ' active' : '') + '" data-tab="' + key + '">' + label + '</button>').join('') +
      '</div></section><div data-work></div>';
    panel.set(root); const work = root.querySelector('[data-work]');
    for (const button of root.querySelectorAll('[data-tab]')) button.onclick = () => {
      if (active?.isBusy) return; tab = button.dataset.tab; render();
    };
    const options = {stop: stopWorker, resolveAttention: () => runWorker('resolve')};
    if (tab === 'edit') active = V3.workflowUI.mountEdit(work, {...options, prefix: 'iss.edit',
      runEach: input => runWorker('edit.each', input), runSku: input => runWorker('edit.sku', input)});
    else if (tab === 'move') active = V3.workflowUI.mountMove(work, {...options, prefix: 'iss.move', run: input => runWorker('move.run', input)});
    else if (tab === 'fcsku') active = V3.workflowUI.mountFcsku(work, {...options, prefix: 'iss.fcsku', run: input => runWorker('fcsku.run', input)});
    else active = V3.sidelineNative.mountModes(work, {engine, life, title: 'ISS Sideline', prefix: 'iss.sideline'});
    mounted = true;
  };
  C.dockButton({id: 'iss-console', label: 'ISS', title: 'V3 ISS Console', onClick: () => { if (!mounted) render(); panel.open(); }});
  life.own(() => active?.dispose?.());
  if (location.hash === '#iss-console') { render(); panel.open(); }
};

if(typeof V3.boot!=='function')throw new Error('V3 boot missing');
V3.boot();
})();
