// ==UserScript==
// @name         V3 | BWU2 Hierarchy
// @name:en      V3 | BWU2 Hierarchy
// @namespace    https://github.com/1Sirkkris/-tampermonkey-v2/v3
// @version      0.1.0
// @description  V3 canonical Bind/Unbind hierarchy queue.
// @match        https://tx-b-hierarchy-nrt.nrt.proxy.amazon.com/unbindHierarchy*
// @match        https://tx-b-hierarchy-nrt.nrt.proxy.amazon.com/bindHierarchy*
// @run-at       document-body
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      w.amazon.com
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-rebuild/v3/dist/BWU2_V3_Hierarchy.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-rebuild/v3/dist/BWU2_V3_Hierarchy.user.js
// @v3-build     hierarchy-0.1.0-217ed2dc
// ==/UserScript==

(()=>{
'use strict';
const V3=Object.create(null);
V3.build=Object.freeze({"id":"hierarchy-0.1.0-217ed2dc","version":"0.1.0","suite":"hierarchy"});

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

// ---- src/core/operation.js ----
V3.operation = (() => {
  class OutcomeUnknownError extends Error {
    constructor(message = 'Outcome unknown', meta = {}) {
      super(message);
      this.name = 'OutcomeUnknownError';
      this.outcome = 'unknown';
      Object.assign(this, meta);
    }
  }
  class RejectedError extends Error {
    constructor(message = 'Rejected', meta = {}) {
      super(message);
      this.name = 'RejectedError';
      this.outcome = 'rejected';
      Object.assign(this, meta);
    }
  }

  function create(options = {}) {
    const telemetry = options.telemetry;
    const operation = {
      id:V3.base.id(options.kind || 'op'),
      kind:options.kind || 'operation',
      ref:V3.telemetry.mask(options.ref || ''),
      phase:'prepared',
      outcome:'pending',
      startedAt:performance.now()
    };
    const transition = (phase, data = {}) => {
      operation.phase = phase;
      telemetry?.op(operation, phase, data);
      return operation;
    };
    transition('prepared');

    return Object.freeze({
      data:operation,
      submitted:data => transition('submitted', data),
      confirmed:data => {
        operation.outcome = 'confirmed';
        return transition('confirmed', Object.assign({ms:Math.round(performance.now()-operation.startedAt)}, data));
      },
      rejected:data => {
        operation.outcome = 'rejected';
        return transition('rejected', Object.assign({ms:Math.round(performance.now()-operation.startedAt)}, data));
      },
      unknown:data => {
        operation.outcome = 'unknown';
        return transition('unknown', Object.assign({ms:Math.round(performance.now()-operation.startedAt)}, data));
      }
    });
  }

  return Object.freeze({ create, OutcomeUnknownError, RejectedError });
})();

// ---- src/core/api.js ----
V3.api = (() => {
  const OutcomeUnknownError = V3.operation.OutcomeUnknownError;
  const RejectedError = V3.operation.RejectedError;

  const authLike = (status, contentType, finalUrl, raw) => {
    const html = /text\/html|application\/xhtml/i.test(contentType || '') ||
      /^\s*(?:<!doctype\s+html|<html\b)/i.test(raw || '');
    const auth = [401,403,419].includes(Number(status)) ||
      /(?:^|[\/?#._-])(?:login|signin|sign-in|midway|sso|auth|authenticate|federat)(?:[\/?#._-]|$)/i.test(finalUrl || '') ||
      (html && /\b(?:sign\s*in|log\s*in|authentication|midway|single\s+sign[- ]?on)\b/i.test(raw || ''));
    return { html, auth };
  };
  const parseRaw = raw => { try { return raw ? JSON.parse(raw) : null; } catch { return raw; } };

  async function fetchRequest(url, options = {}) {
    const method = options.method || 'GET';
    const timeout = Number(options.timeout || 15000);
    const mutation = options.mutation === true;
    const operation = options.operation;
    const telemetry = options.telemetry;
    const externalSignal = options.signal;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('timeout'), timeout);
    const forward = () => controller.abort(externalSignal.reason || 'aborted');
    externalSignal?.addEventListener?.('abort', forward, { once:true });
    const started = performance.now();

    if (mutation) operation?.submitted({ url:String(url).split('?')[0] });

    try {
      let response;
      try {
        response = await fetch(url, {
          method,
          body:options.body,
          headers:options.headers || {},
          credentials:options.credentials || 'same-origin',
          cache:'no-store',
          redirect:'follow',
          signal:controller.signal
        });
      } catch (error) {
        if (mutation) {
          operation?.unknown({ reason:'transport', message:String(error?.message || error) });
          throw new OutcomeUnknownError('Request submitted; confirmation was lost', { cause:error });
        }
        throw error;
      }

      const raw = await response.text();
      const finalUrl = response.url || String(url);
      const contentType = response.headers.get('content-type') || '';
      const auth = authLike(response.status, contentType, finalUrl, raw);
      telemetry?.emit('transport', {
        method, url:String(url).split('?')[0], status:response.status,
        ms:Math.round(performance.now()-started), auth:auth.auth, html:auth.html, mutation
      });

      const htmlRejected = auth.html && options.allowHtml !== true;
      if (auth.auth || htmlRejected) {
        if (mutation) {
          operation?.unknown({ status:response.status, reason:'auth-or-html' });
          throw new OutcomeUnknownError('Mutation confirmation was not an API response', { status:response.status });
        }
        throw new Error('Authentication/HTML response instead of API data');
      }

      if (!response.ok) {
        if (mutation && response.status >= 500) {
          operation?.unknown({ status:response.status, reason:'server' });
          throw new OutcomeUnknownError('HTTP ' + response.status + '; mutation outcome unknown', { status:response.status });
        }
        if (options.allowHttpError === true) {
          return {
            status:response.status, raw, data:parseRaw(raw), finalUrl, contentType,
            ms:Math.round(performance.now()-started), response, httpError:true
          };
        }
        operation?.rejected({ status:response.status });
        throw new RejectedError('HTTP ' + response.status, { status:response.status, data:parseRaw(raw) });
      }

      return {
        status:response.status, raw, data:parseRaw(raw), finalUrl, contentType,
        ms:Math.round(performance.now()-started), response
      };
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener?.('abort', forward);
    }
  }

  function gmRequest(url, options = {}) {
    if (typeof GM_xmlhttpRequest !== 'function') return Promise.reject(new Error('GM_xmlhttpRequest unavailable'));
    const method = options.method || 'GET';
    const mutation = options.mutation === true;
    const operation = options.operation;
    const telemetry = options.telemetry;
    const started = performance.now();

    if (mutation) operation?.submitted({ url:String(url).split('?')[0] });

    return new Promise((resolve,reject) => {
      let settled = false;
      const unknown = (message, meta = {}) => {
        if (settled) return;
        settled = true;
        operation?.unknown(meta);
        reject(new OutcomeUnknownError(message, meta));
      };
      try {
        GM_xmlhttpRequest({
          method,
          url,
          data:options.data,
          headers:options.headers || {},
          timeout:Number(options.timeout || 15000),
          anonymous:options.anonymous === true,
          onload:response => {
            if (settled) return;
            settled = true;
            const raw = String(response.responseText ?? (typeof response.response === 'string' ? response.response : ''));
            const contentType = String(response.responseHeaders || '').split(/\r?\n/)
              .find(line => /^content-type:/i.test(line))?.split(':').slice(1).join(':').trim() || '';
            const finalUrl = response.finalUrl || response.responseURL || url;
            const auth = authLike(response.status, contentType, finalUrl, raw);
            telemetry?.emit('transport', {
              method, url:String(url).split('?')[0], status:response.status,
              ms:Math.round(performance.now()-started), auth:auth.auth, html:auth.html, mutation
            });

            const htmlRejected = auth.html && options.allowHtml !== true;
            if (auth.auth || htmlRejected) {
              if (mutation) {
                operation?.unknown({ status:response.status, reason:'auth-or-html' });
                reject(new OutcomeUnknownError('Mutation confirmation was not an API response', { status:response.status }));
              } else reject(new Error('Authentication/HTML response instead of API data'));
              return;
            }

            if (response.status < 200 || response.status >= 300) {
              if (mutation && response.status >= 500) {
                operation?.unknown({ status:response.status, reason:'server' });
                reject(new OutcomeUnknownError('HTTP ' + response.status + '; mutation outcome unknown', { status:response.status }));
                return;
              }
              if (options.allowHttpError === true) {
                resolve({
                  status:response.status, raw, data:parseRaw(raw), finalUrl, contentType,
                  ms:Math.round(performance.now()-started), response, httpError:true
                });
                return;
              }
              operation?.rejected({ status:response.status });
              reject(new RejectedError('HTTP ' + response.status, { status:response.status, data:parseRaw(raw) }));
              return;
            }

            resolve({
              status:response.status, raw, data:parseRaw(raw), finalUrl, contentType,
              ms:Math.round(performance.now()-started), response
            });
          },
          ontimeout:() => mutation ? unknown('Request timed out after submission', {reason:'timeout'}) : reject(new Error('Request timed out')),
          onerror:() => mutation ? unknown('Network error after submission', {reason:'network'}) : reject(new Error('Network error')),
          onabort:() => mutation ? unknown('Request aborted after submission', {reason:'abort'}) : reject(new DOMException('Aborted','AbortError'))
        });
      } catch (error) {
        mutation ? unknown('Request failed after submission', {reason:'throw'}) : reject(error);
      }
    });
  }

  return Object.freeze({ fetchRequest, gmRequest, authLike, parseRaw });
})();

// ---- src/core/identity.js ----
V3.identity = (() => {
  const LOGIN_RE = /^[a-z][a-z0-9-]{2,31}$/i;
  const RESERVED = /^(?:login|username|user|employee|alias|autoid|logout|logoff|signout|signin|sign-in|profile|account|settings|search|inventory|product|history)$/i;
  const normalize = value => {
    const login = V3.base.lower(value);
    return LOGIN_RE.test(login) && !RESERVED.test(login) ? login : '';
  };
  const readCookie = (doc,name) => {
    try {
      for (const raw of String(doc?.cookie || '').split(';')) {
        const part = raw.trim();
        const split = part.indexOf('=');
        if (split < 1 || part.slice(0,split).trim().toLowerCase() !== name.toLowerCase()) continue;
        let value = part.slice(split + 1).trim();
        try { value = decodeURIComponent(value); } catch {}
        return value;
      }
    } catch {}
    return '';
  };
  const fromObject = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 1) return '';
    for (const key of ['employeeLogin','userLogin','username','login','alias','autoId','autoID']) {
      const found = normalize(value[key]);
      if (found) return found;
    }
    for (const [key,child] of Object.entries(value).slice(0,24)) {
      if (!/(?:current|employee|user|profile|identity|operator)/i.test(key)) continue;
      if (/(?:token|secret|cookie|auth|csrf|session)/i.test(key)) continue;
      const found = fromObject(child, depth + 1);
      if (found) return found;
    }
    return '';
  };

  function resolve(options = {}) {
    const doc = options.doc || document;
    const pageWindow = options.pageWindow || window;
    const globals = [
      ['employeeLogin',pageWindow?.employeeLogin],
      ['userLogin',pageWindow?.userLogin],
      ['autoId',pageWindow?.autoId],
      ['autoID',pageWindow?.autoID],
      ['currentUser',pageWindow?.currentUser],
      ['user',pageWindow?.user],
      ['employee',pageWindow?.employee],
      ['bootstrapData',pageWindow?.bootstrapData],
      ['__INITIAL_STATE__',pageWindow?.__INITIAL_STATE__]
    ];
    for (const [source,value] of globals) {
      const login = typeof value === 'string' ? normalize(value) : fromObject(value);
      if (login) return { login, source:'global:' + source };
    }

    const selectors = [
      '.app-user-name','[data-test-id="user-name"]','.nav-user','.user-name',
      '[data-employee-login]','[data-user-login]','[data-username]','[data-autoid]',
      'meta[name="employeeLogin"]','meta[name="username"]','meta[name="autoid"]'
    ];
    for (const selector of selectors) {
      const element = doc?.querySelector?.(selector);
      if (!element) continue;
      const login = normalize(
        element.dataset?.employeeLogin || element.dataset?.userLogin ||
        element.dataset?.username || element.dataset?.autoid ||
        element.content || element.textContent
      );
      if (login) return { login, source:'dom:' + selector };
    }

    for (const name of ['employeeLogin','userLogin','username','autoid']) {
      const login = normalize(readCookie(doc,name));
      if (login) return { login, source:'cookie:' + name };
    }
    const fcMenu = readCookie(doc,'fcmenu-employeeId');
    if (/[a-z]/i.test(fcMenu)) {
      const login = normalize(fcMenu);
      if (login) return { login, source:'cookie:fcmenu-employeeId' };
    }
    return { login:'', source:'' };
  }

  async function resolveWiki(gm = V3.api.gmRequest) {
    try {
      const response = await gm('https://w.amazon.com/bin/view/Main/', { timeout:10000 });
      const raw = String(response.raw || '');
      const candidates = [
        raw.match(/[?&]userAlias=([a-z][a-z0-9-]{2,31})/i)?.[1],
        raw.match(/\b(?:currentUser|userAlias|employeeLogin)\s*[:=]\s*["']([a-z][a-z0-9-]{2,31})/i)?.[1],
        raw.match(/data-(?:user|employee)-(?:alias|login)=["']([a-z][a-z0-9-]{2,31})/i)?.[1]
      ];
      for (const candidate of candidates) {
        const login = normalize(candidate);
        if (login) return { login, source:'wiki-current-user' };
      }
    } catch {}
    return { login:'', source:'' };
  }

  return Object.freeze({ normalize, resolve, resolveWiki });
})();

// ---- src/core/ui.js ----
V3.ui = (() => {
  const BASE_CSS = [
    ':host{all:initial;--v3-bg:#101319;--v3-panel:#171c24;--v3-panel2:#202733;--v3-line:#465367;--v3-text:#f5f7fb;--v3-muted:#b8c2d1;--v3-focus:#ffd84d;--v3-ok:#65f08f;--v3-warn:#ffd166;--v3-bad:#ff655d;position:fixed;z-index:2147482500;right:14px;top:14px;font-family:Arial,Helvetica,sans-serif;color:var(--v3-text)}',
    '*{box-sizing:border-box}button,input,textarea,select{font:inherit}',
    '.v3-shell{width:410px;max-height:calc(100vh - 28px);display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--v3-line);border-radius:14px;background:var(--v3-bg);box-shadow:0 16px 44px rgba(0,0,0,.42)}',
    '.v3-head{display:flex;align-items:center;gap:9px;min-height:50px;padding:9px 10px 9px 13px;border-bottom:1px solid var(--v3-line);background:#181e28}',
    '.v3-brand{min-width:0;flex:1}.v3-brand b{display:block;font-size:15px;letter-spacing:.25px}.v3-brand small{display:block;margin-top:2px;color:var(--v3-muted);font-size:10px;font-weight:700}',
    '.v3-status{max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid var(--v3-line);border-radius:999px;padding:5px 8px;color:var(--v3-ok);background:#13231a;font-size:10px;font-weight:900}',
    '.v3-status[data-tone="warn"]{color:#17120a;background:var(--v3-warn)}.v3-status[data-tone="bad"]{color:#fff;background:#8f211c}.v3-status[data-tone="work"]{color:#17120a;background:#ffd84d}',
    '.v3-icon,.v3-tab,.v3-btn{border:1px solid var(--v3-line);border-radius:8px;background:var(--v3-panel2);color:var(--v3-text);cursor:pointer;font-weight:900}',
    '.v3-icon{width:32px;height:32px}.v3-btn{min-height:34px;padding:7px 10px}.v3-btn.primary{background:#eef4ff;color:#111827}.v3-btn.danger{background:#8f211c;color:#fff}',
    '.v3-icon:focus-visible,.v3-tab:focus-visible,.v3-btn:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:3px solid var(--v3-focus);outline-offset:2px}',
    '.v3-tabs{display:flex;gap:6px;padding:8px;border-bottom:1px solid var(--v3-line);overflow:auto}.v3-tab{min-height:32px;padding:6px 10px;color:var(--v3-muted);white-space:nowrap}.v3-tab[data-active="1"]{color:#fff;background:#303a49;border-color:#78889f}',
    '.v3-body{overflow:auto;padding:11px}.v3-section{padding:10px;border:1px solid var(--v3-line);border-radius:10px;background:var(--v3-panel);margin-bottom:9px}',
    '.v3-section h3{margin:0 0 7px;font-size:13px}.v3-note{color:var(--v3-muted);font-size:11px;line-height:1.4}',
    '.v3-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.v3-row{display:flex;gap:7px;align-items:center}.v3-row>*{min-width:0}',
    'label.v3-field{display:grid;gap:4px;color:var(--v3-muted);font-size:10px;font-weight:800;margin-bottom:8px}',
    '.v3-field input,.v3-field textarea,.v3-field select,input.v3-input,textarea.v3-input{width:100%;border:1px solid #56657a;border-radius:8px;background:#0d1117;color:#fff;padding:8px 9px;min-height:35px}',
    'textarea.v3-input,.v3-field textarea{min-height:92px;resize:vertical;font-family:Consolas,monospace;font-size:12px}',
    '.v3-list{display:grid;gap:5px}.v3-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;padding:6px 8px;border:1px solid #3b4658;border-left:5px solid #748096;border-radius:7px;background:#11161e;font:700 11px/1.25 Consolas,monospace}',
    '.v3-item[data-state="done"]{border-left-color:#68e690}.v3-item[data-state="attention"],.v3-item[data-state="rejected"]{border-left-color:#ff655d}.v3-item[data-state="active"]{border-left-color:#ffd84d}',
    '.v3-log{width:100%;min-height:90px;max-height:180px;overflow:auto;white-space:pre-wrap;border:1px solid #39465a;border-radius:8px;background:#0b0f14;padding:8px;color:#d9e2ef;font:11px/1.35 Consolas,monospace}',
    '.v3-footer{display:flex;justify-content:space-between;gap:8px;padding:7px 11px;border-top:1px solid var(--v3-line);color:var(--v3-muted);font-size:9px;font-weight:800}',
    '.v3-shell[data-collapsed="1"]{width:190px}.v3-shell[data-collapsed="1"] .v3-tabs,.v3-shell[data-collapsed="1"] .v3-body,.v3-shell[data-collapsed="1"] .v3-footer{display:none}',
    '@media(max-width:700px){:host{right:6px;top:6px}.v3-shell{width:min(410px,calc(100vw - 12px));max-height:calc(100vh - 12px)}}'
  ].join('');

  function createShell(options) {
    if (!document.body) throw new Error('V3 UI requires document.body');
    const id = options.id;
    const existing = document.getElementById(id);
    if (existing) {
      if (!existing.shadowRoot || existing.dataset.bwu2V3Ui !== '1') throw new Error('V3 root collision: ' + id);
      return existing.__v3ShellApi;
    }

    const host = document.createElement('div');
    host.id = id;
    host.dataset.bwu2V3Ui = '1';
    host.dataset.bwu2Owner = options.title || 'BWU2 V3';
    const shadow = host.attachShadow({mode:'open'});
    document.body.appendChild(host);

    const tabs = Array.isArray(options.tabs) ? options.tabs : [];
    shadow.innerHTML =
      '<style>' + BASE_CSS + (options.css || '') + '</style>' +
      '<section class="v3-shell" data-shell>' +
        '<header class="v3-head">' +
          '<div class="v3-brand"><b>' + V3.base.esc(options.title || 'BWU2 V3') + '</b><small>' +
            V3.base.esc(options.subtitle || '') + ' · v' + V3.base.esc(options.version || V3.build.version) +
          '</small></div>' +
          '<span class="v3-status" data-status data-tone="">READY</span>' +
          '<button type="button" class="v3-icon" data-collapse title="Minimise">−</button>' +
        '</header>' +
        (tabs.length ? '<nav class="v3-tabs">' + tabs.map(tab =>
          '<button type="button" class="v3-tab" data-tab="' + V3.base.esc(tab.id) + '">' + V3.base.esc(tab.label || tab.id) + '</button>'
        ).join('') + '</nav>' : '') +
        '<main class="v3-body" data-body></main>' +
        '<footer class="v3-footer"><span>BWU2 V3</span><span data-build>' + V3.base.esc(V3.build.id) + '</span></footer>' +
      '</section>';

    const shell = shadow.querySelector('[data-shell]');
    const body = shadow.querySelector('[data-body]');
    const status = shadow.querySelector('[data-status]');
    let selected = tabs[0]?.id || '';

    const paintTabs = () => {
      for (const button of shadow.querySelectorAll('[data-tab]')) {
        button.dataset.active = button.dataset.tab === selected ? '1' : '0';
      }
    };

    const api = {
      host, shadow, shell, body,
      get tab(){ return selected; },
      select(tab){ selected=tab; paintTabs(); options.onTab?.(tab); },
      setStatus(text,tone=''){ status.textContent=String(text||''); status.dataset.tone=tone; },
      setContent(content){
        body.replaceChildren();
        if (content instanceof Node) body.appendChild(content);
        else body.innerHTML=String(content||'');
      },
      collapse(value){
        const next=value == null ? shell.dataset.collapsed !== '1' : Boolean(value);
        shell.dataset.collapsed=next?'1':'0';
        const button=shadow.querySelector('[data-collapse]');
        button.textContent=next?'+':'−';
      }
    };

    options.life.on(shadow,'click',event => {
      const tab = event.target.closest?.('[data-tab]');
      if (tab) { api.select(tab.dataset.tab); return; }
      if (event.target.closest?.('[data-collapse]')) api.collapse();
    });

    host.__v3ShellApi=api;
    paintTabs();
    return api;
  }

  return Object.freeze({ createShell, BASE_CSS });
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

// ---- src/core/queue.js ----
V3.queue = (() => {
  function create(options) {
    const name = options.name;
    const life = options.life;
    const telemetry = options.telemetry;
    const validator = options.validator || V3.base.validContainer;
    const store = V3.storage.create('queue.' + name);
    const owner = V3.base.id('tab');
    const lockKey = 'bwu2.v3.lock.' + name + '.v1';
    let corrupt = false;

    const loaded = store.read('state', null);
    corrupt = !loaded.ok;
    let state = loaded.ok && loaded.value && Array.isArray(loaded.value.items)
      ? loaded.value
      : { running:false, currentId:'', phase:'idle', message:'', items:[] };

    state.items = state.items
      .filter(item => item && validator(item.id))
      .map(item => ({
        id:V3.base.clean(item.id),
        status:['queued','active','done','rejected','attention'].includes(item.status) ? item.status : 'queued',
        error:V3.base.clean(item.error),
        phase:V3.base.clean(item.phase || 'idle')
      }));

    const active = state.items.find(item => item.status === 'active' || item.id === state.currentId);
    if (active) {
      active.status = 'attention';
      active.error = 'Previous session ended while this item was active — verify before retry';
    }
    if (active || /submit|mutation|move|bind|unbind/i.test(state.phase || '')) {
      state.running = false;
      state.currentId = '';
      state.phase = 'idle';
      state.message = 'Recovered with UNKNOWN/attention work';
    }

    const save = () => {
      if (corrupt) {
        telemetry?.emit('queue.corrupt', { name });
        corrupt = false;
      }
      store.set('state', state);
    };
    save();

    const readLock = () => { try { return JSON.parse(localStorage.getItem(lockKey) || 'null'); } catch { return null; } };
    const acquire = () => {
      const now = Date.now();
      const lock = readLock();
      if (lock && lock.owner !== owner && Number(lock.expires) > now) return false;
      localStorage.setItem(lockKey, JSON.stringify({ owner, expires:now + 8000 }));
      return true;
    };
    const renew = () => {
      const lock = readLock();
      if (lock?.owner === owner) localStorage.setItem(lockKey, JSON.stringify({ owner, expires:Date.now() + 8000 }));
    };
    const release = () => {
      const lock = readLock();
      if (lock?.owner === owner) localStorage.removeItem(lockKey);
    };

    life.interval(() => { if (state.running) renew(); }, 2500);
    life.own(release);

    const addMany = values => {
      const seen = new Set(state.items.map(item => V3.base.upper(item.id)));
      for (const raw of values) {
        const value = V3.base.clean(raw);
        const key = V3.base.upper(value);
        if (!validator(value) || seen.has(key)) continue;
        seen.add(key);
        state.items.push({ id:value, status:'queued', error:'', phase:'idle' });
      }
      save();
      return state.items;
    };
    const next = () => state.items.find(item => item.status === 'queued') || null;
    const set = patch => { Object.assign(state, patch); save(); };
    const itemSet = (item,patch) => { Object.assign(item, patch); save(); };
    const clearDone = () => { state.items = state.items.filter(item => item.status !== 'done'); save(); };
    const clearAll = () => {
      if (state.running) throw new Error('Stop queue before clearing');
      state.running=false;state.currentId='';state.phase='idle';state.message='';state.items=[];
      save();
    };

    return Object.freeze({
      state, owner, addMany, next, set, itemSet, save, acquire, release, clearDone, clearAll
    });
  }
  return Object.freeze({ create });
})();

// ---- src/suites/hierarchy/index.js ----
V3.boot = () => {
  const VERSION=V3.build.version;
  const life=V3.lifecycle.create('hierarchy');
  const telemetry=V3.telemetry.create('hierarchy',VERSION);
  const mode=/\/bindHierarchy(?:\/|$)/i.test(location.pathname)?'bind':'unbind';
  const queue=V3.queue.create({name:'hierarchy-'+mode,life,telemetry});
  const bindStore=V3.storage.create('hierarchy.bind');
  const shell=V3.ui.createShell({
    id:'bwu2-v3-hierarchy',title:'BWU2 V3 Hierarchy',
    subtitle:mode.toUpperCase()+' · BWU2',version:VERSION,life,tabs:[]
  });
  V3.screenshot.install({life,roots:[shell.host]});

  const WAREHOUSE='BWU2',DEST='BWU1';
  const endpoints={validate:'/validateContainer',destination:'/validateDestination',summary:'/getTransshipmentBindingSummary',bind:'/forceBind',unbind:'/unbindContainer'};
  let busy=false;

  const setStatus=(text,tone='')=>shell.setStatus(text,tone);
  const json=body=>JSON.stringify(body);
  const pathOf=url=>{try{return new URL(String(url||''),location.href).pathname;}catch{return'';}};
  const parseBody=raw=>{if(raw==null)return null;if(typeof raw==='object')return raw;try{return JSON.parse(String(raw));}catch{return String(raw);}};
  const template=()=>{
    const value=bindStore.get('template',null);
    return value&&V3.base.clean(value.sourceWarehouseId)&&V3.base.clean(value.destinationWarehouseId)?value:null;
  };
  const clearTemplate=()=>{bindStore.remove('template');bindStore.remove('destinationToken');};

  function learnNative(path,request,response,status){
    if(mode!=='bind'||status<200||status>=300)return;
    const data=parseBody(response);
    if(path===endpoints.destination&&V3.base.upper(typeof data==='string'?data:'')===DEST){
      const token=V3.base.clean(request?.destinationWarehouseId);
      if(token){bindStore.set('destinationToken',token);telemetry.emit('bind.learn.destination',{ok:true});render();}
      return;
    }
    if(path===endpoints.bind&&data&&typeof data==='object'&&V3.base.clean(data.hostName)){
      const sourceWarehouseId=V3.base.clean(request?.sourceWarehouseId);
      const destinationWarehouseId=V3.base.clean(request?.destinationWarehouseId);
      const learnedDestination=V3.base.clean(bindStore.get('destinationToken',''));
      if(sourceWarehouseId&&destinationWarehouseId&&(!learnedDestination||destinationWarehouseId===learnedDestination)){
        bindStore.set('template',{sourceWarehouseId,destinationWarehouseId,learnedAt:Date.now()});
        telemetry.emit('bind.learn.template',{ok:true});
        render();
      }
    }
  }

  function installNativeLearning(){
    if(mode!=='bind')return;
    const page=typeof unsafeWindow==='object'&&unsafeWindow?unsafeWindow:window;
    try{
      const nativeFetch=page.fetch;
      if(typeof nativeFetch==='function'&&!nativeFetch.__bwu2V3HierarchyLearn){
        const wrapped=async function(input,init={}){
          const rawUrl=typeof input==='string'||input instanceof URL?String(input):String(input?.url||'');
          const path=pathOf(rawUrl);
          const watched=[endpoints.destination,endpoints.bind].includes(path);
          let request=null;if(watched)request=parseBody(init?.body);
          const response=await nativeFetch.apply(this,arguments);
          if(watched){
            try{const raw=await response.clone().text();learnNative(path,request,raw,Number(response.status)||0);}catch{}
          }
          return response;
        };
        wrapped.__bwu2V3HierarchyLearn=true;
        page.fetch=wrapped;
      }
    }catch(error){telemetry.emit('bind.learn.tap.error',{transport:'fetch',message:String(error?.message||error)});}

    try{
      const XHR=page.XMLHttpRequest;
      if(XHR?.prototype&&!XHR.prototype.__bwu2V3HierarchyLearn){
        const open=XHR.prototype.open,send=XHR.prototype.send;
        XHR.prototype.open=function(method,url){
          this.__bwu2V3Learn={method:String(method||'GET'),path:pathOf(url)};
          return open.apply(this,arguments);
        };
        XHR.prototype.send=function(body){
          const info=this.__bwu2V3Learn||{},watched=[endpoints.destination,endpoints.bind].includes(info.path);
          const request=watched?parseBody(body):null;
          if(watched)this.addEventListener('loadend',()=>{
            let raw='';try{raw=!this.responseType||this.responseType==='text'?this.responseText||'':this.responseType==='json'?JSON.stringify(this.response??null):'';}catch{}
            learnNative(info.path,request,raw,Number(this.status)||0);
          },{once:true});
          return send.apply(this,arguments);
        };
        XHR.prototype.__bwu2V3HierarchyLearn=true;
      }
    }catch(error){telemetry.emit('bind.learn.tap.error',{transport:'xhr',message:String(error?.message||error)});}
  }

  const request=async(path,body,{mutation=false,kind='read',ref=''}={})=>{
    const operation=mutation?V3.operation.create({kind,ref,telemetry}):null;
    const response=await V3.api.fetchRequest(path,{
      method:'POST',body:json(body),headers:{'content-type':'application/json'},
      timeout:mutation?25000:12000,mutation,operation,telemetry
    });
    return{response,operation};
  };
  const assertValidate=(data,id)=>{
    if(!data||typeof data!=='object')throw new Error('Unexpected validation response');
    if(V3.base.upper(data.warehouseId)!==WAREHOUSE)throw new Error('Container is not validated in '+WAREHOUSE);
    if(data.scannableId&&V3.base.lower(data.scannableId)!==V3.base.lower(id))throw new Error('Validation returned another container');
  };
  const assertSummary=data=>{if(!data||!Array.isArray(data.transferBindingSummaryList))throw new Error('Unexpected binding summary');};
  const assertMutation=(data,operation,label)=>{
    if(!data||typeof data!=='object'||!V3.base.clean(data.hostName)){
      operation?.unknown({reason:'unexpected-response'});
      throw new V3.operation.OutcomeUnknownError(label+' response was ambiguous — verify container');
    }
    operation?.confirmed();
  };

  async function login(){
    const pageWindow=typeof unsafeWindow==='object'&&unsafeWindow?unsafeWindow:window;
    let identity=V3.identity.resolve({doc:document,pageWindow});
    if(!identity.login)identity=await V3.identity.resolveWiki();
    if(!identity.login)throw new Error('Current authenticated employee could not be determined');
    telemetry.emit('identity',{source:identity.source});
    return identity.login;
  }

  async function bindTemplate(){
    const learned=template();
    if(!learned)throw new Error('BIND TEMPLATE NOT LEARNED — do one normal native Bind to BWU1 while V3 is enabled');
    const check=await request(endpoints.destination,{destinationWarehouseId:learned.destinationWarehouseId});
    if(V3.base.upper(check.response.data)!==DEST){
      clearTemplate();render();
      throw new Error('Saved Bind destination no longer validates as BWU1 — learn again with one native Bind');
    }
    return learned;
  }

  async function processItem(item){
    const id=item.id;
    queue.itemSet(item,{status:'active',phase:'validate',error:''});
    queue.set({currentId:id,phase:'validate',message:'Validating '+id});
    const validated=await request(endpoints.validate,{warehouseId:WAREHOUSE,scannableId:id});
    assertValidate(validated.response.data,id);

    queue.itemSet(item,{phase:'summary'});
    queue.set({phase:'summary',message:'Checking bindings '+id});
    const summary=await request(endpoints.summary,{warehouseId:WAREHOUSE,scannableId:id});
    assertSummary(summary.response.data);

    if(!queue.state.running)return'paused';
    const employeeLogin=await login();

    if(mode==='unbind'){
      queue.itemSet(item,{phase:'unbind'});
      queue.set({phase:'unbind',message:'Unbinding '+id});
      const result=await request(endpoints.unbind,{
        sourceWarehouseId:WAREHOUSE,scannableId:id,employeeLogin
      },{mutation:true,kind:'hierarchy-unbind',ref:id});
      assertMutation(result.response.data,result.operation,'Unbind');
    }else{
      const learned=await bindTemplate();
      if(!queue.state.running)return'paused';
      queue.itemSet(item,{phase:'bind'});
      queue.set({phase:'bind',message:'Binding '+id+' → '+DEST});
      const result=await request(endpoints.bind,{
        sourceWarehouseId:learned.sourceWarehouseId,destinationWarehouseId:learned.destinationWarehouseId,
        scannableId:id,employeeLogin
      },{mutation:true,kind:'hierarchy-bind',ref:id});
      assertMutation(result.response.data,result.operation,'Bind');
    }

    queue.itemSet(item,{status:'done',phase:'done',error:''});
    queue.set({currentId:'',phase:'idle',message:(mode==='bind'?'BOUND ':'UNBOUND ')+id});
    return'done';
  }

  async function pump(){
    if(busy||!queue.state.running)return;
    if(!queue.acquire()){queue.set({running:false,message:'Hierarchy queue is active in another tab'});render();return;}
    const item=queue.next();
    if(!item){queue.set({running:false,currentId:'',phase:'idle',message:'Queue complete'});queue.release();render();return;}
    busy=true;render();
    try{
      const outcome=await processItem(item);
      if(outcome==='paused'){queue.itemSet(item,{status:'queued',phase:'idle'});queue.set({currentId:'',phase:'idle',message:'Paused safely before mutation'});}
    }catch(error){
      const unknown=error?.outcome==='unknown'||error instanceof V3.operation.OutcomeUnknownError;
      if(unknown){
        queue.itemSet(item,{status:'attention',phase:'unknown',error:'OUTCOME UNKNOWN — VERIFY BEFORE RETRY'});
        queue.set({running:false,currentId:'',phase:'idle',message:item.id+' outcome UNKNOWN'});
      }else if(error?.outcome==='rejected'||error instanceof V3.operation.RejectedError){
        queue.itemSet(item,{status:'rejected',phase:'rejected',error:String(error.message||error)});
        queue.set({running:false,currentId:'',phase:'idle',message:'Rejected: '+item.id});
      }else{
        queue.itemSet(item,{status:'rejected',phase:'error',error:String(error.message||error)});
        queue.set({running:false,currentId:'',phase:'idle',message:String(error.message||error)});
      }
      telemetry.emit('queue.error',{mode,item:V3.telemetry.mask(item.id),message:String(error?.message||error),unknown});
    }finally{
      busy=false;if(!queue.state.running)queue.release();render();
    }
    if(queue.state.running)life.timeout(pump,180);
  }

  function render(){
    const s=queue.state,attention=s.items.some(i=>i.status==='attention'),learned=template();
    setStatus(s.running?'RUNNING':attention?'ATTENTION':'READY',attention?'bad':s.running?'work':'');
    const root=document.createElement('div');
    root.innerHTML=
      '<section class="v3-section"><h3>'+(mode==='bind'?'Bind → BWU1':'Unbind')+'</h3>'+
      '<div class="v3-note">One canonical V3 queue · tsX/csX only · uncertain mutations stop.</div>'+
      (mode==='bind'?'<div class="v3-note" style="margin-top:7px;color:'+(learned?'var(--v3-ok)':'var(--v3-warn)')+'"><b>BIND TEMPLATE: '+(learned?'READY':'NEEDS ONE NATIVE BIND')+'</b><br>'+(learned?'Destination token re-validates as BWU1 before each V3 bind.':'Use the native page once to Bind any container to BWU1. V3 passively learns the opaque source/destination tokens.')+'</div>':'')+
      '</section>'+
      '<section class="v3-section"><label class="v3-field">Containers<textarea class="v3-input" data-input placeholder="tsX...&#10;csX..."></textarea></label>'+
      '<div class="v3-row"><button class="v3-btn" data-add>ADD</button><button class="v3-btn primary" data-run>RUN</button><button class="v3-btn" data-pause>PAUSE</button><button class="v3-btn" data-clear-done>CLEAR DONE</button>'+
      (mode==='bind'&&learned?'<button class="v3-btn danger" data-forget>FORGET TEMPLATE</button>':'')+'</div></section>'+
      '<section class="v3-section"><h3>'+V3.base.esc(s.message||'Ready')+'</h3><div class="v3-list" data-list></div></section>'+
      '<section class="v3-section"><button class="v3-btn" data-export>EXPORT OBS</button></section>';
    const list=root.querySelector('[data-list]');
    for(const item of s.items){
      const row=document.createElement('div');row.className='v3-item';row.dataset.state=item.status;
      row.innerHTML='<span>'+V3.base.esc(item.id)+(item.error?'<br><small>'+V3.base.esc(item.error)+'</small>':'')+'</span><b>'+V3.base.esc(item.status.toUpperCase())+'</b>';
      list.appendChild(row);
    }
    shell.setContent(root);
    shell.body.querySelector('[data-add]').onclick=()=>{
      const input=shell.body.querySelector('[data-input]');
      queue.addMany(String(input.value||'').split(/[\n,]+/).map(V3.base.clean).filter(Boolean));input.value='';render();
    };
    shell.body.querySelector('[data-run]').onclick=()=>{
      if(attention){queue.set({message:'Resolve ATTENTION rows before RUN'});render();return;}
      if(mode==='bind'&&!template()){queue.set({message:'Do one native Bind to BWU1 first so V3 can learn the opaque tokens'});render();return;}
      queue.set({running:true,message:'Starting…'});render();pump();
    };
    shell.body.querySelector('[data-pause]').onclick=()=>{queue.set({running:false,message:'Pause requested — no new mutation will start'});render();};
    shell.body.querySelector('[data-clear-done]').onclick=()=>{queue.clearDone();render();};
    shell.body.querySelector('[data-forget]')?.addEventListener('click',()=>{clearTemplate();queue.set({message:'Bind template forgotten'});render();});
    shell.body.querySelector('[data-export]').onclick=()=>{
      const blob=new Blob([telemetry.exportText()],{type:'application/json'}),a=document.createElement('a');
      a.href=URL.createObjectURL(blob);a.download='BWU2_V3_Hierarchy_OBS_'+Date.now()+'.json';a.click();URL.revokeObjectURL(a.href);
    };
  }

  installNativeLearning();
  life.on(window,'pagehide',()=>queue.release(),{once:true});
  render();
};

if(typeof V3.boot!=='function') throw new Error('V3 suite boot function missing');
V3.boot();
})();
