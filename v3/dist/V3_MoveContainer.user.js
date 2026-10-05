// ==UserScript==
// @name         V3 | BWU2 MoveContainer
// @name:en      V3 | BWU2 MoveContainer
// @namespace    https://github.com/1Sirkkris/-tampermonkey-v2/v3-groundup
// @version      0.2.1
// @description  Native MoveContainer floor/dropzone helper and sequential queue.
// @include      /^https?:\/\/aft-moveapp-[^\/.]+(?:\.nrt)?\.proxy\.amazon\.com\/move-container(?:[\/?#]|$)/
// @run-at       document-body
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      aft-moveapp-nrt-nrt.nrt.proxy.amazon.com
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-groundup/v3/dist/V3_MoveContainer.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-groundup/v3/dist/V3_MoveContainer.user.js
// @v3-build     movecontainer-0.2.1-b2759d8d
// ==/UserScript==

(()=>{
'use strict';
const V3=Object.create(null);
V3.build=Object.freeze({"id":"movecontainer-0.2.1-b2759d8d","version":"0.2.1"});

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

// ---- src/actions.js ----
V3.actions=(()=>{
  const C=V3.core;
  const MOVE_ORIGIN='https://aft-moveapp-nrt-nrt.nrt.proxy.amazon.com';
  const HIERARCHY_ORIGIN='https://tx-b-hierarchy-nrt.nrt.proxy.amazon.com';
  const MOVE_PATH='/api/move-container';
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

  const dropChoices=floor=>FLOORS.includes(floor)?floor==='P1'?P1:UPPER:[];
  const destination=(floor,key)=>{
    if(!FLOORS.includes(floor))return'';
    if(key==='PRIME'||key==='Prime')return'dz-P-PRIME';
    const row=dropChoices(floor).find(x=>x.key===key||x.label===key);
    return row?(floor==='P1'?row.dest:row.pattern.replace('{floor}',floor)):'';
  };

  const movePayload=(container,dest)=>({sourceScannableId:null,destinationScannableId:C.clean(dest),containerScannableId:C.clean(container),confirmed:'true'});
  const strictMoveConfirmation=(result,{container,destination}={})=>{
    const status=Number(result?.status);
    if(!Number.isInteger(status)||status<=0||status>=500||status===408||status===202)throw new C.UnknownError('MoveContainer outcome unknown HTTP '+(status||0));
    if(result.flags?.auth||result.flags?.html)throw new C.UnknownError('MoveContainer confirmation was an authentication/HTML response');
    const expected=new URL(MOVE_ORIGIN+MOVE_PATH);let actual;
    try{actual=new URL(result.finalUrl||expected.href,expected.href);}catch{throw new C.UnknownError('MoveContainer confirmation URL is invalid');}
    if(actual.origin!==expected.origin||actual.pathname.replace(/\/+$/,'')!==expected.pathname)throw new C.UnknownError('MoveContainer confirmation redirected unexpectedly');
    if(status<200||status>=300)throw new C.RejectedError('MoveContainer rejected HTTP '+status);
    const data=result.data,positive=data?.success===true||data?.status==='SUCCESS',negative=data?.success===false||data?.error||data?.errorMessage;
    if(positive&&negative)throw new C.UnknownError('MoveContainer confirmation is contradictory — verify before retry');
    if(negative)throw new C.RejectedError(C.clean(data.message||data.errorMessage||'MoveContainer rejected'));
    if((container&&data?.containerScannableId!=null&&C.upper(data.containerScannableId)!==C.upper(container))||
      (destination&&data?.destinationScannableId!=null&&C.upper(data.destinationScannableId)!==C.upper(destination)))
      throw new C.UnknownError('MoveContainer response identifies another container/destination');
    // V2's native API permits an empty synchronous response. An accepted/pending response is not completion.
    const empty=!C.clean(result.raw)&&data==null;
    if(!positive&&!(empty&&[200,204].includes(status)))throw new C.UnknownError('MoveContainer response not recognized — verify before retry');
    return result;
  };
  async function moveContainer(container,dest,{telemetry,maySubmit=()=>true}={}){
    const code=C.clean(container),target=C.clean(dest);
    if(!C.container(code))throw new Error('Container must be tsX/csX');
    if(!target)throw new Error('Destination required');
    if(C.upper(code)===C.upper(target))throw new Error('Source and destination are the same');
    if(!maySubmit())throw Object.assign(new Error('Paused before Move submission'),{outcome:'cancelled'});
    const op=C.operation({kind:'move-container',ref:code,scope:'movecontainer',telemetry});op.submitted({destination:target});
    let result;
    try{
      result=await C.request(MOVE_ORIGIN+MOVE_PATH,{method:'POST',body:JSON.stringify(movePayload(code,target)),headers:{'Content-Type':'application/json'},timeout:15000,allowHttpError:true});
    }catch(error){op.unknown({reason:'transport'});throw new C.UnknownError('Move submitted; confirmation lost — verify before retry',{cause:error});}
    try{
      strictMoveConfirmation(result,{container:code,destination:target});
      op.confirmed({status:result.status,destination:target});
      return result;
    }catch(error){
      if(error instanceof C.RejectedError){op.rejected({status:result.status});throw error;}
      op.unknown({status:result.status,reason:C.clean(error.message)});throw error;
    }
  }

  const ownedMove=(...args)=>V3.state.exclusive('movecontainer',()=>{V3.state.assertClear('movecontainer');return moveContainer(...args);});
  return Object.freeze({MOVE_ORIGIN,HIERARCHY_ORIGIN,FLOORS,UPPER,P1,dropChoices,destination,movePayload,strictMoveConfirmation,moveContainer:ownedMove});
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

// ---- src/queue-ui.js ----
V3.queueUI = (() => {
  const C = V3.core;
  function mount(root,{name,scope,life,fields='',prepare=async()=>null,action,onSettings=()=>{},values=()=>({})}={}) {
    const queue=C.queue({name,life});let busy=false,paused=false,context=null;
    root.innerHTML='<section class="v3-section">'+fields+'<label class="v3-field">Containers<textarea data-input placeholder="tsX...\ncsX..."></textarea></label>'+
      '<div class="v3-row"><button class="v3-btn" data-add>ADD</button><button class="v3-btn primary" data-run>RUN</button><button class="v3-btn" data-pause>PAUSE</button><button class="v3-btn" data-done>CLEAR DONE</button><button class="v3-btn danger" data-verify hidden>I VERIFIED IT · RETRY ATTENTION</button></div><div class="v3-note" data-msg></div></section><section class="v3-section"><div data-list></div></section>';
    const q=selector=>root.querySelector(selector),draftKey='bwu2.v3.form.'+name+'.draft';
    q('[data-input]').value=localStorage.getItem(draftKey)||'';q('[data-input]').oninput=()=>localStorage.setItem(draftKey,q('[data-input]').value);
    const message=(value,kind='')=>{q('[data-msg]').textContent=value;q('[data-msg]').className='v3-note '+(kind?'v3-'+kind:'');};
    const paint=()=>{
      q('[data-list]').innerHTML=queue.state.items.map(row=>'<div class="v3-list-row"><b>'+C.esc(row.id)+'</b> · '+C.esc(row.status.toUpperCase())+(row.error?' · <span class="v3-bad">'+C.esc(row.error)+'</span>':'')+'</div>').join('')||'<div class="v3-note">Queue empty.</div>';
      q('[data-run]').disabled=busy;q('[data-verify]').hidden=!queue.state.items.some(row=>['attention','rejected'].includes(row.status))&&!V3.state.attention(scope);
      for(const element of root.querySelectorAll('[data-setting]'))element.disabled=busy;
    };
    for(const element of root.querySelectorAll('[data-setting]'))element.onchange=()=>onSettings(root);
    const add=async()=>{if(busy)throw new Error('Pause before adding containers');await queue.add(C.lines(q('[data-input]').value));q('[data-input]').value='';localStorage.removeItem(draftKey);paint();};
    q('[data-add]').onclick=()=>void add().catch(error=>message(error.message,'bad'));
    q('[data-run]').onclick=async()=>{
      if(busy)return;
      busy=true;paused=false;let owns=false;paint();
      try{
        if(!await queue.acquire())throw new Error('Queue active in another tab');
        owns=true;
        if(queue.state.items.some(row=>row.status==='attention'))throw new C.UnknownError('Verify ATTENTION rows before RUN');
        V3.state.assertClear(scope);
        if(!queue.next())throw new Error('Add containers first');
        context=await prepare(values());if(paused)return;
        await queue.set({running:true,message:'Running'});
        for(let row=queue.next();row&&!paused;row=queue.next()){
          await queue.item(row,{status:'active',error:'',phase:'validating'});await queue.set({current:row.id,phase:'validating'});message('Processing '+row.id,'warn');paint();
          try{await action(row.id,context,()=>!paused);await queue.item(row,{status:'done',phase:'done'});message('DONE '+row.id,'ok');}
          catch(error){const cancelled=error.outcome==='cancelled',unknown=error.outcome==='unknown';
            await queue.item(row,{status:cancelled?'queued':unknown?'attention':'rejected',phase:'',error:cancelled?'':C.clean(error.message)});
            if(unknown||cancelled){paused=true;message(error.message,unknown?'bad':'warn');}
            else message('REJECTED '+row.id+' · '+error.message,'warn');
          }
          await queue.set({current:'',phase:'idle'});paint();
        }
        if(!paused)message('Queue complete','ok');
      }catch(error){message(error.message,error.outcome==='unknown'?'bad':'warn');}
      finally{busy=false;context=null;try{if(owns)await queue.set({running:false,current:'',phase:'idle'});}catch(error){message('Recovery save failed · '+error.message,'bad');}finally{await queue.release();paint();}}
    };
    q('[data-pause]').onclick=()=>{paused=true;message('Pause requested — finishing submitted action','warn');};
    q('[data-done]').onclick=async()=>{if(busy)return;try{await queue.clearDone();paint();}catch(error){message(error.message,'bad');}};
    q('[data-verify]').onclick=async()=>{if(busy)return;try{await V3.state.resolveAttention(scope);await queue.resolve();message('Verified rows returned to queue');paint();}catch(error){message(error.message,'bad');}};
    void queue.load().then(()=>{message(queue.state.items.some(row=>row.status==='attention')?'VERIFY PREVIOUS WORK':'Ready');paint();}).catch(error=>message(error.message,'bad'));
    life.own(()=>{paused=true;});
    return Object.freeze({get isBusy(){return busy;},dispose(){paused=true;}});
  }
  return Object.freeze({mount});
})();

// ---- src/apps/movecontainer.js ----
V3.boot=()=>{
  const C=V3.core,life=C.lifecycle('movecontainer'),telemetry=C.telemetry('movecontainer',V3.build.version);
  if(location.hash==='#v3-movecontainer-worker'&&window.parent!==window){
    V3.bridge.server({family:'movecontainer',life,commands:{run:input=>V3.actions.moveContainer(input.container,input.destination,{telemetry}),resolve:()=>V3.state.resolveAttention('movecontainer')},allowed:V3.bridge.isFCR});return;
  }
  const panel=C.panel({id:'movecontainer',title:'V3 · MoveContainer',width:620,life});let mounted=false;
  const mount=()=>{if(mounted)return;mounted=true;const root=document.createElement('div');panel.set(root);
    const settings=()=>{const floor=root.querySelector('[data-floor]'),drop=root.querySelector('[data-drop]'),old=drop.value||localStorage.getItem('bwu2.v3.move.drop')||'PRIME';
      drop.innerHTML='<option value="PRIME">PRIME</option>'+V3.actions.dropChoices(floor.value).map(row=>'<option value="'+C.esc(row.key)+'">'+C.esc(row.label)+'</option>').join('');
      drop.value=[...drop.options].some(option=>option.value===old)?old:'PRIME';localStorage.setItem('bwu2.v3.move.floor',floor.value);localStorage.setItem('bwu2.v3.move.drop',drop.value);};
    V3.queueUI.mount(root,{name:'movecontainer',scope:'movecontainer',life,
      fields:'<div class="v3-grid"><label class="v3-field">Floor<select data-setting data-floor>'+V3.actions.FLOORS.map(floor=>'<option>'+floor+'</option>').join('')+'</select></label><label class="v3-field">Dropzone<select data-setting data-drop></select></label></div>',
      onSettings:settings,values:()=>({destination:V3.actions.destination(root.querySelector('[data-floor]').value,root.querySelector('[data-drop]').value)}),
      prepare:input=>{if(!input.destination)throw new Error('Select destination first');return input.destination;},
      action:(container,destination,maySubmit)=>V3.actions.moveContainer(container,destination,{telemetry,maySubmit})});
    const savedFloor=localStorage.getItem('bwu2.v3.move.floor');root.querySelector('[data-floor]').value=V3.actions.FLOORS.includes(savedFloor)?savedFloor:'P2';settings();
  };
  C.dockButton({id:'movecontainer',label:'MOVE',title:'V3 MoveContainer',onClick:()=>{mount();panel.open();}});
};

if(typeof V3.boot!=='function')throw new Error('V3 boot missing');
V3.boot();
})();
