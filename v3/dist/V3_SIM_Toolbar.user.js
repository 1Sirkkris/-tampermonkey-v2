// ==UserScript==
// @name         V3 | BWU2 SIM Toolbar
// @name:en      V3 | BWU2 SIM Toolbar
// @namespace    https://github.com/1Sirkkris/-tampermonkey-v2/v3-groundup
// @version      0.2.9
// @description  SIM Markdown toolbar, snippets, attachments and fast native-checkbox ticket range selection.
// @match        https://t.corp.amazon.com/*
// @run-at       document-body
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_openInTab
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-groundup/v3/dist/V3_SIM_Toolbar.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-groundup/v3/dist/V3_SIM_Toolbar.user.js
// @v3-build     sim-0.2.9-a87e65f5
// ==/UserScript==

(()=>{
'use strict';
const V3=Object.create(null);
V3.build=Object.freeze({"id":"sim-0.2.9-a87e65f5","version":"0.2.9"});

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

// ---- src/apps/sim.js ----
V3.boot=()=>{
  const C=V3.core,life=C.lifecycle('sim'),telemetry=C.telemetry('sim',V3.build.version),store=C.store('sim',1),panel=C.panel({id:'sim',title:'V3 · SIM Toolbar',width:680,life});
  let snippets=[],mounted=false,navStarted=false;

  let focusedEditor=null;
  const editable=el=>el&&V3.native.visible(el)&&!el.disabled&&!el.readOnly&&!el.closest('[data-bwu2-ui]')&&el.matches('textarea,[contenteditable="true"]');
  life.on(document,'focusin',event=>{const candidate=event.target.closest?.('textarea,[contenteditable="true"]');if(editable(candidate))focusedEditor=candidate;});
  const editor=()=>{
    if(editable(focusedEditor)&&focusedEditor.isConnected)return focusedEditor;
    const marked=[...document.querySelectorAll('textarea[placeholder*="markdown" i],[contenteditable="true"][role="textbox"]')].filter(editable);
    if(marked.length===1)return marked[0];
    const all=[...document.querySelectorAll('textarea,[contenteditable="true"]')].filter(editable);return all.length===1?all[0]:null;
  };
  const insert=(before,after='',prefix='',replace=false)=>{
    const el=editor();if(!el){telemetry.emit('editor.unavailable');return;}
    const body=selected=>prefix?selected.split(/\r?\n/).map(line=>prefix+line).join('\n'):before+(replace?'':selected)+after;
    if('selectionStart'in el){const start=el.selectionStart??el.value.length,end=el.selectionEnd??start;el.setRangeText(body(el.value.slice(start,end)),start,end,'end');}
    else{
      const selection=window.getSelection();if(!selection?.rangeCount)return;
      const range=selection.getRangeAt(0);if(!el.contains(range.commonAncestorContainer))return;
      const text=body(range.toString());el.focus();
      if(typeof document.execCommand==='function')document.execCommand('insertText',false,text);
      else{range.deleteContents();const node=document.createTextNode(text);range.insertNode(node);range.setStartAfter(node);range.collapse(true);selection.removeAllRanges();selection.addRange(range);}
    }
    el.dispatchEvent(new Event('input',{bubbles:true}));el.focus();
  };
  const download=(name,text)=>{const a=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type:'application/json'}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),0);};
  const merge=(oldRows,newRows)=>{const out=[...oldRows],used=new Set(out.map(x=>x.name));for(const row of newRows){let name=C.clean(row?.name),text=String(row?.text??'');if(!name||!text)continue;let n=name,i=2;while(used.has(n))n=name+' ('+(i++)+')';used.add(n);out.push({name:n,text});}return out;};

  const ticketLink=anchor=>{
    if(!anchor?.href||!V3.native.visible(anchor))return null;
    const shortId=C.clean(anchor.textContent);
    if(!/^[PV]\d{7,14}$/i.test(shortId))return null;
    let url;
    try{url=new URL(anchor.href,location.href);}catch{return null;}
    if(url.origin!==location.origin)return null;
    url.hash='';
    return {shortId,url:url.href};
  };

  const ticketRow=anchor=>{
    const direct=anchor.closest('tr,[role="row"],li');
    if(direct&&V3.native.visible(direct))return direct;
    let node=anchor.parentElement;
    for(let depth=0;node&&depth<6;depth++,node=node.parentElement){
      if(!V3.native.visible(node))continue;
      const rect=node.getBoundingClientRect();
      if(rect.height>=28&&rect.height<=180&&rect.width>500)return node;
    }
    return null;
  };

  const startTicketNavigator=()=>{
    if(navStarted||!/^\/issues(?:\/|$)/.test(location.pathname))return;
    navStarted=true;

    let rows=[],lastIndex=-1,scanQueued=false,syncing=false,busy=false,drag=null,suppressShiftClick=false;

    const checked=box=>box?.matches?.('input[type="checkbox"]')
      ? !!box.checked
      : box?.getAttribute?.('aria-checked')==='true';

    const nativeToggle=(box,on)=>{
      if(!box||box.disabled||box.getAttribute('aria-disabled')==='true'||checked(box)===on)return false;
      syncing=true;
      try{box.click();}finally{syncing=false;}
      return true;
    };

    const style=document.createElement('style');
    style.dataset.bwu2Ui='1';
    style.dataset.v3SimNav='1';
    style.textContent=`
[data-v3-sim-check-cell]{position:relative}
[data-v3-sim-check-cell]::after{content:attr(data-v3-sim-row-number);position:absolute;right:2px;top:50%;transform:translateY(-50%);min-width:10px;text-align:center;color:#6b7785;font:800 9px/1 Arial,sans-serif;pointer-events:none}
[data-v3-sim-check-cell][data-v3-sim-checked="1"]::after{color:#245b86}
[data-v3-sim-preview="on"]{background:rgba(35,110,170,.10)!important}
[data-v3-sim-preview="off"]{background:rgba(176,0,32,.07)!important}
#v3-sim-nav-bar{position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:2147482998;display:flex;align-items:center;gap:5px;padding:5px 6px;border:1px solid #b7c1cc;border-radius:7px;background:#fff;color:#27384b;box-shadow:0 3px 10px #0002;font:800 11px Arial,sans-serif}
#v3-sim-nav-bar[hidden]{display:none!important}
#v3-sim-nav-bar strong{min-width:70px;padding:0 4px;text-align:center;white-space:nowrap}
#v3-sim-nav-bar .v3-btn{height:28px;padding:4px 9px;border:1px solid #9da9b6;border-radius:5px;background:#fff;color:#27384b;font:800 11px Arial;box-shadow:none}
#v3-sim-nav-bar .v3-btn:hover{background:#f3f6f8}
#v3-sim-nav-bar .v3-btn.primary{background:#2f5f88;color:#fff;border-color:#2f5f88}
#v3-sim-nav-bar[data-busy="1"]{opacity:.72;pointer-events:none}
`;
    document.head.appendChild(style);
    life.own(()=>style.remove());

    const bar=document.createElement('div');
    bar.id='v3-sim-nav-bar';
    bar.dataset.bwu2Ui='1';
    bar.dataset.v3SimNav='1';
    bar.hidden=true;
    bar.innerHTML='<strong data-count>Selected 0</strong><button class="v3-btn primary" data-open>OPEN TABS</button><button class="v3-btn" data-clear>CLEAR</button>';
    document.body.appendChild(bar);
    life.own(()=>bar.remove());

    const count=bar.querySelector('[data-count]');
    const open=bar.querySelector('[data-open]');
    const clear=bar.querySelector('[data-clear]');

    const paint=()=>{
      let total=0;
      rows.forEach((record,index)=>{
        const on=checked(record.checkbox);
        if(on)total++;
        if(record.cell){
          record.cell.dataset.v3SimRowNumber=String(index+1);
          record.cell.dataset.v3SimChecked=on?'1':'0';
        }
      });
      count.textContent=(busy?'Working · ':'Selected ')+total;
      bar.hidden=total===0&&!busy;
      bar.dataset.busy=busy?'1':'0';
    };

    const clearPreview=()=>{
      for(const record of rows)delete record.row.dataset.v3SimPreview;
    };

    const preview=(from,to,on)=>{
      clearPreview();
      const a=Math.min(from,to),b=Math.max(from,to);
      for(let index=a;index<=b;index++)rows[index].row.dataset.v3SimPreview=on?'on':'off';
    };

    const eventRecord=event=>{
      const path=event.composedPath?.()||[];
      const pathBox=path.find(node=>node?.matches?.('input[type="checkbox"],[role="checkbox"]'));
      if(pathBox){
        const direct=rows.find(record=>record.checkbox===pathBox);
        if(direct)return direct;
      }
      const row=path.find(node=>rows.some(record=>record.row===node))
        || event.target?.closest?.('tr,[role="row"],li');
      return row?rows.find(record=>record.row===row)||null:null;
    };

    const checkboxHit=(event,record)=>{
      if(!record)return false;
      const path=event.composedPath?.()||[];
      return path.includes(record.checkbox)||path.includes(record.cell)
        || record.cell?.contains?.(event.target);
    };

    const scan=()=>{
      scanQueued=false;
      if(!/^\/issues(?:\/|$)/.test(location.pathname)){
        rows=[];lastIndex=-1;bar.hidden=true;clearPreview();
        for(const cell of document.querySelectorAll('[data-v3-sim-check-cell]')){
          delete cell.dataset.v3SimCheckCell;
          delete cell.dataset.v3SimRowNumber;
          delete cell.dataset.v3SimChecked;
        }
        return;
      }

      const found=[],seen=new Set();
      for(const anchor of document.querySelectorAll('a[href]')){
        const ticket=ticketLink(anchor);
        if(!ticket||seen.has(ticket.url))continue;
        const row=ticketRow(anchor);
        if(!row)continue;
        const checkbox=[...row.querySelectorAll('input[type="checkbox"],[role="checkbox"]')].find(V3.native.visible);
        if(!checkbox)continue;
        const cell=checkbox.closest('td,[role="cell"]')||checkbox.parentElement;
        if(!cell)continue;
        seen.add(ticket.url);
        found.push({url:ticket.url,shortId:ticket.shortId,row,anchor,checkbox,cell});
      }

      const activeCells=new Set(found.map(record=>record.cell));
      for(const cell of document.querySelectorAll('[data-v3-sim-check-cell]')){
        if(activeCells.has(cell))continue;
        delete cell.dataset.v3SimCheckCell;
        delete cell.dataset.v3SimRowNumber;
        delete cell.dataset.v3SimChecked;
      }

      rows=found;
      rows.forEach((record,index)=>{
        record.cell.dataset.v3SimCheckCell='1';
        record.cell.dataset.v3SimRowNumber=String(index+1);
      });
      paint();
    };

    const changeSelection=(urls,on)=>{
      if(busy||life.disposed)return;busy=true;paint();
      try{for(const url of urls){scan();const current=rows.find(record=>record.url===url);nativeToggle(current?.checkbox,on);}}
      finally{busy=false;scan();clearPreview();paint();}
    };
    const applyRange=(from,to,on)=>changeSelection(rows.slice(Math.min(from,to),Math.max(from,to)+1).map(record=>record.url),on);
    const clearAll=()=>{changeSelection(rows.filter(record=>checked(record.checkbox)).map(record=>record.url),false);lastIndex=-1;};

    const schedule=()=>{
      if(scanQueued)return;
      scanQueued=true;
      life.timeout(scan,60);
    };

    const recordAtPoint=(x,y)=>{
      const hit=document.elementFromPoint?.(x,y);
      const row=hit?.closest?.('tr,[role="row"],li');
      return row?rows.find(record=>record.row===row)||null:null;
    };

    life.on(window,'pointerdown',event=>{
      if(syncing||busy||!event.shiftKey||event.button!==0)return;
      scan();const record=recordAtPoint(event.clientX,event.clientY)||eventRecord(event);
      if(!checkboxHit(event,record))return;
      const index=rows.indexOf(record);
      if(index<0)return;

      event.preventDefault();
      event.stopImmediatePropagation();

      const from=lastIndex>=0?lastIndex:index;
      const on=lastIndex>=0?checked(rows[from].checkbox):!checked(record.checkbox);
      drag={from,to:index,on};
      suppressShiftClick=true;
      preview(from,index,on);

    },true);

    life.on(window,'pointermove',event=>{
      if(!drag||busy||!(event.buttons&1))return;
      const record=recordAtPoint(event.clientX,event.clientY);
      if(!record)return;
      const index=rows.indexOf(record);
      if(index<0||index===drag.to)return;
      drag.to=index;
      preview(drag.from,drag.to,drag.on);
    },true);

    life.on(window,'pointerup',event=>{
      if(!drag)return;
      const finalRecord=recordAtPoint(event.clientX,event.clientY);if(finalRecord){const finalIndex=rows.indexOf(finalRecord);if(finalIndex>=0)drag.to=finalIndex;}
      event.preventDefault();
      event.stopImmediatePropagation();
      const work=drag;
      drag=null;
      lastIndex=work.to;
      void applyRange(work.from,work.to,work.on);
      setTimeout(()=>{suppressShiftClick=false;},0);
    },true);

    life.on(document,'click',event=>{
      if(syncing)return;
      const record=eventRecord(event);
      if(!record)return;

      if(event.shiftKey&&suppressShiftClick){
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      if(!checkboxHit(event,record))return;
      lastIndex=rows.indexOf(record);
      queueMicrotask(paint);
    },true);

    life.on(document,'change',event=>{
      const record=eventRecord(event);
      if(record)queueMicrotask(paint);
    },true);

    life.on(window,'blur',()=>{
      if(!drag)return;
      drag=null;
      suppressShiftClick=false;
      clearPreview();
    });

    life.observe(document.body,records=>{
      const nativeChange=records.some(record=>{
        const target=record.target?.nodeType===1?record.target:record.target?.parentElement;
        if(target?.closest?.('[data-v3-sim-nav]'))return false;
        return true;
      });
      if(nativeChange)schedule();
    },{childList:true,subtree:true});

    clear.addEventListener('click',()=>{void clearAll();});

    open.addEventListener('click',()=>{
      const urls=rows.filter(record=>checked(record.checkbox)).map(record=>record.url);
      if(!urls.length)return;
      for(const url of urls){
        if(typeof GM_openInTab==='function')GM_openInTab(url,{active:false,insert:true,setParent:true});
        else window.open(url,'_blank','noopener,noreferrer');
      }
      telemetry.emit('ticketNav.open',{count:urls.length});
    });

    scan();
  };
  const mount=async()=>{if(mounted)return;mounted=true;snippets=await store.get('snippets',[]);if(!Array.isArray(snippets))snippets=[];snippets=snippets.filter(row=>row&&typeof row.name==='string'&&typeof row.text==='string').map(row=>({name:C.clean(row.name),text:row.text}));if(life.disposed)return;const root=document.createElement('div');
    root.innerHTML='<section class="v3-section"><div class="v3-row"><button class="v3-btn" data-wrap="**|**">B</button><button class="v3-btn" data-wrap="_|_">I</button><button class="v3-btn" data-wrap="`|`">CODE</button><button class="v3-btn" data-prefix="> ">QUOTE</button><button class="v3-btn" data-prefix="- ">LIST</button><button class="v3-btn" data-prefix="1. ">NUMBERED</button><button class="v3-btn" data-link>LINK</button><button class="v3-btn" data-table>TABLE</button><button class="v3-btn" data-save>+ SNIP</button><button class="v3-btn" data-export>EXPORT</button><label class="v3-btn">IMPORT<input data-import type="file" accept="application/json" hidden></label></div></section><section class="v3-section"><b>Snippets</b><div class="v3-row" data-snips style="margin-top:8px"></div></section><section class="v3-section"><b>Image attachments</b><div data-images class="v3-row" style="margin-top:8px"></div></section>';panel.set(root);
    const paint=()=>{const box=root.querySelector('[data-snips]');box.innerHTML='';snippets.forEach((s,i)=>{const b=document.createElement('button');b.className='v3-btn';b.textContent=s.name||('Snippet '+(i+1));b.onclick=()=>insert(s.text||'');box.appendChild(b);});const images=[...document.querySelectorAll('a[href]')].filter(a=>/\.(?:jpe?g|png|gif|webp|bmp|avif)(?:$|[?#])/i.test(a.href));root.querySelector('[data-images]').innerHTML=images.slice(0,20).map((a,i)=>'<a class="v3-btn" target="_blank" rel="noopener" href="'+C.esc(a.href)+'">IMAGE '+(i+1)+'</a>').join('')||'<span class="v3-note">No image attachments found.</span>';};
    for(const b of root.querySelectorAll('[data-wrap]'))b.onclick=()=>{const [a,z]=b.dataset.wrap.split('|');insert(a,z);};
    for(const b of root.querySelectorAll('[data-prefix]'))b.onclick=()=>insert('','',b.dataset.prefix);
    root.querySelector('[data-table]').onclick=()=>{const el=editor(),selected=el&&'selectionStart'in el?String(el.value||'').slice(el.selectionStart,el.selectionEnd):'';if(selected.includes('\t')){const rows=selected.split(/\r?\n/).filter(Boolean).map(r=>r.split('\t'));const width=Math.max(...rows.map(r=>r.length)),head=rows[0],body=rows.slice(1),line=r=>'| '+Array.from({length:width},(_,i)=>C.clean(r[i]||'').replace(/\|/g,'\\|')).join(' | ')+' |';insert(line(head)+'\n| '+Array(width).fill('---').join(' | ')+' |\n'+body.map(line).join('\n'),'','',true);}else insert('| Header | Header |\n| --- | --- |\n|  |  |');};
    root.querySelector('[data-link]').onclick=()=>{const url=prompt('Link URL?','https://');if(url&&/^https?:\/\//i.test(url))insert('[',']('+url+')');};
    root.querySelector('[data-save]').onclick=async()=>{const el=editor(),selected=el&&'selectionStart'in el?String(el.value||'').slice(el.selectionStart,el.selectionEnd):'';const text=selected||prompt('Snippet text?')||'';if(!text)return;const name=prompt('Snippet name?','Snippet '+(snippets.length+1))||'Snippet';snippets.push({name,text});await store.set('snippets',snippets);paint();};
    root.querySelector('[data-export]').onclick=()=>download('sim-snippets-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json',JSON.stringify(snippets,null,2));
    root.querySelector('[data-import]').onchange=event=>{const file=event.target.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=async()=>{try{const incoming=JSON.parse(String(reader.result||'[]'));if(!Array.isArray(incoming))throw new Error('Expected snippet array');snippets=merge(snippets,incoming);await store.set('snippets',snippets);paint();telemetry.emit('snippets.import',{count:incoming.length});}catch(e){alert('Import failed: '+e.message);}};reader.readAsText(file);};
    paint();
  };

  startTicketNavigator();
  C.dockButton({id:'sim',label:'SIM',title:'V3 SIM Toolbar',onClick:()=>{void mount().then(()=>{if(!life.disposed)panel.open();}).catch(error=>{mounted=false;telemetry.emit('snippets.load.failed',{message:error.message});});}});
};

if(typeof V3.boot!=='function')throw new Error('V3 boot missing');
V3.boot();
})();
