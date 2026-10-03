// ==UserScript==
// @name         V3 | BWU2 AFT Suite
// @namespace    https://github.com/1Sirkkris/-tampermonkey-v2/v3
// @version      0.1.0
// @description  V3 AFT EditItems, MoveItems and FCSKU workflows.
// @include      *://aft-qt-*.corp.amazon.com/app/edititems*
// @include      *://aft-qt-*.corp.amazon.com/app/fcskuflip*
// @include      *://aft-qt-*.corp.amazon.com/app/moveitems*
// @run-at       document-body
// @grant        none
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-rebuild/v3/dist/BWU2_V3_AFT.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-rebuild/v3/dist/BWU2_V3_AFT.user.js
// @v3-build     aft-0.1.0-6ec3ae1c
// ==/UserScript==

(()=>{
'use strict';
const V3=Object.create(null);
V3.build=Object.freeze({"id":"aft-0.1.0-6ec3ae1c","version":"0.1.0","suite":"aft"});

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

// ---- src/services/aft.js ----
V3.aft = (() => {
  const DEFINITIONS={
    'edit:each':{title:'Edit • Each',path:'/app/edititems',instructionId:'EditItems',tool:'edititems',input:'EACH'},
    'edit:sku':{title:'Edit • SKU',path:'/app/edititems',instructionId:'EditItems',tool:'edititems',input:'SKU'},
    'edit:date':{title:'Edit • Date',path:'/app/edititems',instructionId:'EditItems',tool:'edititems',input:'DATELOT'},
    'edit:fcsku':{title:'Edit • FCSKU',path:'/app/fcskuflip',instructionId:'FcSkuFlip',tool:'fcskuflip',input:'SKU'},
    'move:each':{title:'Move • Each',path:'/app/moveitems',instructionId:'MoveItems',tool:'moveitems',input:'EACH'},
    'move:multi':{title:'Move • Multi',path:'/app/moveitems',instructionId:'MoveItems',tool:'moveitems',input:'MULTI'},
    'move:container':{title:'Move • Container',path:'/app/moveitems',instructionId:'MoveItems',tool:'moveitems',input:'CONTAINER'}
  };
  const EDIT_STATES=[
    ['location',['scan location','scan container','input location','enter location','enter container']],
    ['item',['input fnsku or fcsku','input item','scan item','enter the sku','enter item']],
    ['sourceState',['select source inventory state']],
    ['sourceDisp',['select source disposition','select source disposition type']],
    ['newState',['select new inventory state']],
    ['newDisp',['select new disposition','select disposition type']],
    ['confirm',['confirm change','confirm to continue']],
    ['success',['success items changed','items changed from','current expiry date:']],
    ['retryError',['failed to change consumer type. please try again','failed to change consumer type']],
    ['error',['work is errored','the service failed to process your request','service failed']],
    ['loading',['loading']]
  ];
  const HEADERS={'Content-Type':'application/json; charset=utf-8','Accept':'application/json, text/javascript, */*; q=0.01','X-Requested-With':'XMLHttpRequest'};

  const classifyEdit=text=>{
    const value=V3.base.lower(text);let state='unknown',best=Infinity;
    for(const [name,phrases] of EDIT_STATES)for(const phrase of phrases){const i=value.indexOf(phrase);if(i>=0&&i<best){best=i;state=name;}}
    return state;
  };
  const objectId=html=>{
    const raw=String(html||'');
    return raw.match(/(?:&quot;|")objectId(?:&quot;|")\s*:\s*(?:&quot;|")([^"&<]+)(?:&quot;|")/i)?.[1] ||
      raw.match(/\b[A-Z0-9]{2,12}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i)?.[0] || '';
  };
  const bodySnapshot=html=>{
    const doc=V3.base.parseHtml(html);
    for(const el of doc.querySelectorAll('script,style,noscript,template,svg,[hidden],[aria-hidden="true"],[style*="display:none"],[style*="display: none"],[style*="visibility:hidden"],[style*="visibility: hidden"]'))el.remove();
    let headings='';for(const el of doc.querySelectorAll('h1,h2,h3,[role="heading"]'))headings+=' '+(el.textContent||'');
    return{doc,text:V3.base.clean((doc.body?.textContent||'')),headings:V3.base.clean(headings)};
  };
  const extractWorkflow=(html,definition)=>{
    const source=String(html||'').replace(/&quot;/gi,'"').replace(/&#34;/gi,'"').replace(/&#x22;/gi,'"').replace(/\\\"/g,'"').replace(/&amp;/gi,'&');
    const anchor=new RegExp('"instructionId"\\s*:\\s*"'+definition.instructionId+'"','i').exec(source);
    if(!anchor)return null;
    const scope=source.slice(anchor.index,anchor.index+2600);
    const grab=name=>scope.match(new RegExp('"'+name+'"\\s*:\\s*"([^"]+)"','i'))?.[1]||'';
    const workflow={instructionId:grab('instructionId'),tool:grab('tool').toLowerCase(),objectId:grab('objectId'),status:grab('status').toUpperCase(),selector:/<input\b[^>]*\bname\s*=\s*["']options["']/i.test(source)};
    if(!workflow.objectId||workflow.instructionId!==definition.instructionId)return null;
    if(workflow.tool&&workflow.tool!==definition.tool)return null;
    return workflow;
  };

  function create(options={}){
    const origin=String(options.origin||location.origin).replace(/\/$/,'');
    const telemetry=options.telemetry;
    const life=options.life;
    const crossOrigin=origin!==location.origin;
    const stopped=()=>Boolean(options.stopped?.());

    const url=path=>origin+path;
    const get=async(path,label='GET')=>{
      const result=crossOrigin
        ? await V3.api.gmRequest(url(path),{timeout:15000,allowHtml:true,telemetry})
        : await V3.api.fetchRequest(path,{timeout:15000,allowHtml:true,telemetry});
      telemetry?.emit('aft.page',{label,path,chars:String(result.raw||'').length});
      return result.raw;
    };
    const post=async(path,payload,opts={})=>{
      const body=JSON.stringify(payload);
      return crossOrigin
        ? V3.api.gmRequest(url(path),{method:'POST',data:body,headers:HEADERS,timeout:opts.timeout||20000,mutation:opts.mutation===true,operation:opts.operation,telemetry})
        : V3.api.fetchRequest(path,{method:'POST',body,headers:HEADERS,timeout:opts.timeout||20000,mutation:opts.mutation===true,operation:opts.operation,telemetry});
    };
    const id=(definition,object)=>({id:{instructionId:definition.instructionId,objectId:object}});

    const routePath=definition=>definition.path+'?experience=Desktop';
    const bootstrap=async definition=>{
      const html=await get(routePath(definition),definition.title+' bootstrap');
      const workflow=extractWorkflow(html,definition);
      if(!workflow)throw new Error(definition.title+': workflow not found');
      return workflow;
    };
    const getStatus=async(workflow,definition)=>{
      const result=await post('/status',id(definition,workflow.objectId));
      const state=String(result.data?.status||'').toUpperCase();
      if(!state)throw new Error('AFT status missing');
      return state;
    };
    const waitStatus=async(workflow,definition,accepted,opts={})=>{
      const wanted=new Set(accepted),started=performance.now();let polls=0,last=workflow.status||'';
      while(performance.now()-started<(opts.timeout||20000)){
        if(stopped()&&!opts.ignoreStop)throw new Error('Stopped by user');
        try{last=await getStatus(workflow,definition);}
        catch(error){
          if(opts.operation){
            opts.operation.unknown({reason:'status-transport'});
            throw new V3.operation.OutcomeUnknownError(opts.label+': status confirmation lost',{cause:error});
          }
          throw error;
        }
        polls++;
        if(wanted.has(last)){telemetry?.emit('aft.status',{label:opts.label||'',state:last,polls,ms:Math.round(performance.now()-started)});return last;}
        if(last==='ERRORED'){
          opts.operation?.rejected({reason:'backend-errored'});
          throw new V3.operation.RejectedError((opts.label||'AFT')+': backend ERRORED');
        }
        if(!['READY','PROCESSING','COMPLETE'].includes(last)){
          if(opts.operation){opts.operation.unknown({reason:'unexpected-status',state:last});throw new V3.operation.OutcomeUnknownError((opts.label||'AFT')+': unexpected status '+last);}
          throw new Error((opts.label||'AFT')+': status '+(last||'blank'));
        }
        await life.sleep(opts.pollMs??Math.min(300,60+polls*35));
      }
      if(opts.operation){opts.operation.unknown({reason:'status-timeout'});throw new V3.operation.OutcomeUnknownError((opts.label||'AFT')+': status timeout');}
      throw new Error((opts.label||'AFT')+': status timeout');
    };
    const action=async(workflow,definition,actionName,input,label,opts={})=>{
      if(stopped()&&!opts.ignoreStop)throw new Error('Stopped by user');
      const operation=opts.operation||null;
      try{
        await post('/action',{...id(definition,workflow.objectId),action:actionName,input},{timeout:opts.timeout||20000,mutation:Boolean(operation),operation});
      }catch(error){throw error;}
      const state=await waitStatus(workflow,definition,opts.complete?['COMPLETE']:['READY'],{timeout:opts.timeout||20000,pollMs:opts.pollMs,ignoreStop:opts.ignoreStop,operation,label});
      return{state};
    };
    const input=(workflow,definition,value,label,opts={})=>action(workflow,definition,'Input',value,label,opts);
    const confirm=(workflow,definition,opts={})=>action(workflow,definition,'Confirm','Confirm','Confirm',opts);
    const done=(workflow,definition)=>action(workflow,definition,'Done','Done','Done',{complete:true,timeout:180000,pollMs:300,ignoreStop:true});
    const end=(workflow,definition)=>post('/end',{...id(definition,workflow.objectId),tool:definition.tool},{timeout:20000});

    const waitFresh=async(definition,oldId,timeout=5000)=>{
      const started=performance.now();
      while(performance.now()-started<timeout){
        const next=await bootstrap(definition);
        if(next.objectId!==oldId)return next;
        await life.sleep(100);
      }
      throw new Error('Fresh AFT workflow not created');
    };
    const ensureReady=async(definition,workflow=null)=>{
      let current=workflow||await bootstrap(definition);
      for(let pass=0;pass<4;pass++){
        if(current.status==='READY')return current;
        if(current.status==='PROCESSING'){
          current.status=await waitStatus(current,definition,['READY','COMPLETE'],{label:'Ready'});
          if(current.status==='READY'){current=await bootstrap(definition);continue;}
        }
        if(current.status==='COMPLETE'){
          const old=current.objectId;await end(current,definition);current=await waitFresh(definition,old);continue;
        }
        throw new Error('Unexpected AFT state '+(current.status||'unknown'));
      }
      throw new Error('Could not obtain READY workflow');
    };
    const ensureMode=async key=>{
      const definition=DEFINITIONS[key];if(!definition)throw new Error('Unknown AFT mode '+key);
      let workflow=await ensureReady(definition);
      if(definition===DEFINITIONS['edit:fcsku']&&!workflow.selector)return workflow;
      if(!workflow.selector){
        await action(workflow,definition,'SelectMode','SelectMode','Select mode',{timeout:20000});
        workflow=await bootstrap(definition);
        if(!workflow.selector)throw new Error(definition.title+': mode selector unavailable');
      }
      await action(workflow,definition,'Input',definition.input,'Choose '+definition.input,{complete:true,timeout:20000});
      const old=workflow.objectId;await end(workflow,definition);
      workflow=await waitFresh(definition,old);
      return ensureReady(definition,workflow);
    };
    const page=async(definition,label,classifier)=>{
      const html=await get(routePath(definition),label);
      const view=bodySnapshot(html);
      return{html,doc:view.doc,text:view.text,state:classifier?classifier(view.headings+' '+view.text):'unknown',objectId:objectId(html)};
    };
    const snapshot=async(workflow,definition,label,classifier)=>{
      const snap=await page(definition,label,classifier);
      if(!snap.objectId)throw new Error(label+': objectId missing');
      if(snap.objectId!==workflow.objectId)throw new Error(label+': objectId changed');
      return snap;
    };

    return Object.freeze({origin,crossOrigin,definitions:DEFINITIONS,bootstrap,ensureMode,ensureReady,waitStatus,action,input,confirm,done,end,page,snapshot,classifyEdit});
  }

  const mapState=value=>{
    const v=V3.base.lower(value);
    if(v==='sellable'||v==='inventory')return'INVENTORY';
    if(v==='pending research'||v==='pending')return'PENDING_RESEARCH';
    if(v==='unsellable')return'UNSELLABLE';
    throw new Error('Unsupported inventory state '+value);
  };
  const mapDamage=value=>{
    const v=V3.base.lower(value);
    if(v==='amazon damage'||v==='warehouse damage')return'AMAZON_DAMAGE';
    if(v==='defective')return'DEFECTIVE';
    if(v==='distributor damage')return'DISTRIBUTOR_DAMAGE';
    if(v==='expired')return'EXPIRED';
    throw new Error('Unsupported disposition '+value);
  };
  const readMoveQuantity=html=>{
    const raw=String(html||'');
    for(const pattern of [
      /(?:["']|&quot;)quantity(?:["']|&quot;)\s*[:=]\s*(?:["']|&quot;)?([0-9]{1,6})\b/i,
      /\bQuantity\b(?:<[^>]+>|\s|&nbsp;|&#160;|:|-){0,20}([0-9]{1,6})\b/i
    ]){
      const qty=Number(raw.match(pattern)?.[1]);if(Number.isInteger(qty)&&qty>0)return{qty,verify:false};
    }
    return{qty:null,verify:/\bVerify item\b/i.test(raw)};
  };
  const readSourceChoices=doc=>{
    const out=[];
    for(const radio of doc?.querySelectorAll?.('input[type="radio"]')||[]){
      let label='';try{label=[...(radio.labels||[])].map(x=>x.textContent||'').join(' ');}catch{}
      if(!label)label=radio.closest('label')?.textContent||radio.parentElement?.textContent||'';
      label=V3.base.clean(label);
      if(!/Quantity\s*:/i.test(label)||!/Owner\s*:/i.test(label))continue;
      let state='';
      if(/Pending Research|PENDING_RESEARCH/i.test(label))state='PENDING_RESEARCH';
      else if(/Unsellable|UNSELLABLE/i.test(label))state='UNSELLABLE';
      else if(/(?:Inventory|Sellable)|\bSELLABLE\b/i.test(label))state='SELLABLE';
      if(!state)continue;
      const qty=Number(label.match(/\bQuantity\s*:\s*(\d{1,7})\b/i)?.[1]);
      out.push({state,label,value:radio.getAttribute('value')||'',qty:Number.isInteger(qty)?qty:null,disabled:Boolean(radio.disabled)});
    }
    return out;
  };

  return Object.freeze({create,DEFINITIONS,classifyEdit,mapState,mapDamage,readMoveQuantity,readSourceChoices});
})();

// ---- src/services/aft-workflows.js ----
V3.aftWorkflows = (() => {
  function create(options){
    const client=options.client;
    const telemetry=options.telemetry;
    const stopped=()=>Boolean(options.stopped?.());
    const progress=(message,data={})=>options.onProgress?.(message,data);
    const qtyUpdate=value=>options.onQuantity?.(value);

    const readyWorkflow=async key=>{
      const def=V3.aft.DEFINITIONS[key];
      let workflow=await client.bootstrap(def);
      if(workflow.selector)return client.ensureMode(key);
      return client.ensureReady(def,workflow);
    };
    const confirmLoop=async(workflow,def,ref)=>{
      for(let round=1;round<=10;round++){
        progress('Confirm '+round,{round});
        const op=V3.operation.create({kind:'aft-confirm',ref,telemetry});
        await client.confirm(workflow,def,{operation:op,timeout:300000});
        op.confirmed({round});
        const snap=await client.snapshot(workflow,def,'After confirm '+round,V3.aft.classifyEdit);
        if(snap.state==='error')throw new Error('EditItems returned error after confirm');
        if(snap.state!=='confirm')return snap;
      }
      throw new Error('Too many confirmation rounds');
    };
    const targetState=async(workflow,def,state,damage)=>{
      const mapped=V3.aft.mapState(state);
      await client.input(workflow,def,mapped,'Target state',{timeout:120000});
      if(mapped==='UNSELLABLE')await client.input(workflow,def,V3.aft.mapDamage(damage),'Target disposition',{timeout:120000});
    };

    async function move(params){
      const source=V3.base.clean(params.source),dest=V3.base.clean(params.destination);
      const items=(params.items||[]).map(V3.base.clean).filter(Boolean);
      const qtyMode=String(params.qtyMode||'ALL').toUpperCase();
      const userQty=Number(params.quantity);
      if(!V3.base.validContainer(source)||!V3.base.validContainer(dest))throw new Error('Source and destination must be tsX/csX');
      if(V3.base.upper(source)===V3.base.upper(dest))throw new Error('Source and destination cannot match');
      if(!items.length)throw new Error('Need item barcodes');
      if(qtyMode==='QTY'&&(!Number.isInteger(userQty)||userQty<1))throw new Error('Enter QTY 1+');

      const def=V3.aft.DEFINITIONS['move:multi'];
      const workflow=await client.ensureMode('move:multi');
      progress('Source '+source,{stage:'source'});
      await client.input(workflow,def,source,'Source');

      const results=[];
      for(let i=0;i<items.length;i++){
        if(stopped())throw new Error('Stopped before next item');
        const code=items[i];
        progress((i+1)+'/'+items.length+' Item '+code,{stage:'item',index:i,total:items.length,code});
        await client.input(workflow,def,code,'Item '+(i+1));

        const page=await client.page(def,'Quantity page '+(i+1));
        if(page.objectId!==workflow.objectId)throw new Error('Quantity page workflow changed');
        const info=V3.aft.readMoveQuantity(page.html);
        if(!Number.isInteger(info.qty)){
          telemetry?.emit('aft.quantity.missing',{
            item:V3.telemetry.mask(code),verify:info.verify,
            markers:{quantity:/\bquantity\b/i.test(page.text),source:/scan source/i.test(page.text),destination:/destination/i.test(page.text)},
            text:V3.base.clean(page.text).slice(0,300)
          });
          throw new Error('Quantity unavailable for '+code+(info.verify?' — VERIFY ITEM screen':''));
        }

        const qty=qtyMode==='EACH'?1:qtyMode==='QTY'?userQty:info.qty;
        if(qty>info.qty)throw new Error('QTY UNAVAILABLE · '+code+' · requested '+qty+' · available '+info.qty);
        progress((i+1)+'/'+items.length+' Qty '+qty+'/'+info.qty,{stage:'quantity',available:info.qty,quantity:qty});
        await client.input(workflow,def,String(qty),'Quantity '+(i+1));

        if(stopped())throw new Error('Stopped safely before destination mutation');
        progress((i+1)+'/'+items.length+' Destination '+dest,{stage:'destination'});
        const op=V3.operation.create({kind:'aft-move-destination',ref:code,telemetry});
        await client.input(workflow,def,dest,'Destination '+(i+1),{operation:op,timeout:30000});
        op.confirmed({qty,available:info.qty});
        results.push({code,qty,available:info.qty,state:'done'});
        progress((i+1)+'/'+items.length+' moved ✓',{stage:'moved',done:i+1,total:items.length});
      }

      await client.done(workflow,def);
      await client.end(workflow,def);
      telemetry?.emit('move.done',{count:results.length});
      return results;
    }

    async function editEach(params){
      const rows=(params.rows||[]).filter(row=>row?.location&&row?.fnsku);
      if(!rows.length)throw new Error('Need Location + FNSKU rows');
      const def=V3.aft.DEFINITIONS['edit:each'];
      let workflow=await client.ensureMode('edit:each');
      const results=[];
      for(let i=0;i<rows.length;i++){
        if(stopped())throw new Error('Stopped before next row');
        if(i>0)workflow=await readyWorkflow('edit:each');
        const item=rows[i];
        progress((i+1)+'/'+rows.length+' Location '+item.location,{stage:'location',index:i,total:rows.length});
        await client.input(workflow,def,item.location,'Location');
        progress((i+1)+'/'+rows.length+' Item '+item.fnsku,{stage:'item'});
        await client.input(workflow,def,item.fnsku,'Item');
        const afterItem=await client.snapshot(workflow,def,'After item',V3.aft.classifyEdit);
        if(afterItem.state==='sourceState')throw new Error(item.fnsku+': source state could not be inferred');
        if(afterItem.state!=='newState')throw new Error(item.fnsku+': expected new state, got '+afterItem.state);
        await targetState(workflow,def,params.desiredState||'Unsellable',params.desiredDamage||'Defective');
        const final=await confirmLoop(workflow,def,item.fnsku);
        if(final.state==='success')await client.done(workflow,def);
        else if(final.state!=='item')throw new Error(item.fnsku+': expected success/item, got '+final.state);
        await client.end(workflow,def);
        results.push({...item,state:'done'});
        telemetry?.emit('edit.each.done',{item:V3.telemetry.mask(item.fnsku),location:V3.telemetry.mask(item.location)});
      }
      return results;
    }

    async function editSku(params){
      const sku=V3.base.clean(params.sku);
      if(!sku)throw new Error('Enter SKU / ASIN / FNSKU / FCSKU');
      const currentState=params.currentState||'Sellable';
      const currentDamage=params.currentDamage||'Defective';
      const desiredState=params.desiredState||'Unsellable';
      const desiredDamage=params.desiredDamage||'Defective';
      const wanted=V3.aft.mapState(currentState);
      const wantedChoice=wanted==='INVENTORY'?'SELLABLE':wanted;
      const def=V3.aft.DEFINITIONS['edit:sku'];
      let workflow=await client.ensureMode('edit:sku');
      let flips=0;

      for(let attempt=1;attempt<=50;attempt++){
        if(stopped())throw new Error('Stopped before next attempt');
        if(attempt>1)workflow=await readyWorkflow('edit:sku');
        progress('Attempt '+attempt+' · SKU lookup',{stage:'lookup',attempt});
        await client.input(workflow,def,sku,'SKU');
        const source=await client.snapshot(workflow,def,'Source state',V3.aft.classifyEdit);
        if(source.state==='retryError')throw new Error('AFT consumer-type retry error');
        if(source.state!=='sourceState')throw new Error('Expected sourceState, got '+source.state);

        const choices=V3.aft.readSourceChoices(source.doc);
        const quantities={sellable:null,pending:null,unsellable:null};
        for(const choice of choices){
          if(choice.state==='SELLABLE')quantities.sellable=choice.qty;
          else if(choice.state==='PENDING_RESEARCH')quantities.pending=choice.qty;
          else if(choice.state==='UNSELLABLE')quantities.unsellable=choice.qty;
        }
        qtyUpdate(quantities);

        const matches=choices.filter(choice=>choice.state===wantedChoice&&!choice.disabled);
        if(matches.length!==1){
          const available=choices.map(x=>x.state+':'+(x.qty??'?')).join(', ');
          throw new Error('Source '+wanted+' ambiguous/unavailable · '+available);
        }
        const selected=matches[0];
        if(selected.qty===0){
          await client.end(workflow,def);
          progress('DONE · 0 '+currentState+' remaining',{stage:'done',flips});
          return{flips,quantities};
        }
        if(!Number.isInteger(selected.qty))throw new Error('Could not read '+currentState+' quantity');

        progress('Attempt '+attempt+' · Source '+currentState+' ('+selected.qty+')',{stage:'source'});
        await client.input(workflow,def,selected.value||wanted,'Source state',{timeout:120000});
        if(wanted==='UNSELLABLE')await client.input(workflow,def,V3.aft.mapDamage(currentDamage),'Source disposition',{timeout:120000});

        const afterSource=await client.snapshot(workflow,def,'After source',V3.aft.classifyEdit);
        if(afterSource.state==='retryError'||afterSource.state==='sourceState')throw new Error('Source state did not advance');
        if(afterSource.state!=='newState')throw new Error('Expected newState, got '+afterSource.state);

        await targetState(workflow,def,desiredState,desiredDamage);
        const final=await confirmLoop(workflow,def,sku);
        if(final.state==='retryError')throw new Error('AFT consumer-type retry error');
        if(final.state!=='success')throw new Error('Expected success, got '+final.state);
        await client.done(workflow,def);
        await client.end(workflow,def);
        flips++;
        telemetry?.emit('edit.sku.flip',{sku:V3.telemetry.mask(sku),attempt,startQty:selected.qty});
      }
      throw new Error('Stopped after 50 SKU attempts');
    }

    async function fcsku(params){
      const oldCode=V3.base.clean(params.oldCode),newCode=V3.base.clean(params.newCode);
      const locations=(params.locations||[]).map(V3.base.clean).filter(Boolean);
      if(!oldCode||!newCode)throw new Error('Need OLD + NEW FCSKU');
      if(!locations.length)throw new Error('Need locations/containers');
      const def=V3.aft.DEFINITIONS['edit:fcsku'];
      let workflow=await client.ensureMode('edit:fcsku');
      const results=[];
      for(let i=0;i<locations.length;i++){
        if(stopped())throw new Error('Stopped before next location');
        if(i>0)workflow=await readyWorkflow('edit:fcsku');
        const location=locations[i];
        progress((i+1)+'/'+locations.length+' Container '+location,{stage:'container',index:i,total:locations.length});
        await client.input(workflow,def,location,'Container');
        await client.input(workflow,def,oldCode,'OLD');
        await client.input(workflow,def,newCode,'NEW');
        if(stopped())throw new Error('Stopped safely before confirm');
        const op=V3.operation.create({kind:'aft-fcsku-confirm',ref:location,telemetry});
        await client.confirm(workflow,def,{operation:op,timeout:30000});
        op.confirmed();
        await client.end(workflow,def);
        results.push({location,state:'done'});
        telemetry?.emit('fcsku.done',{location:V3.telemetry.mask(location),old:V3.telemetry.mask(oldCode),neu:V3.telemetry.mask(newCode)});
      }
      return results;
    }

    return Object.freeze({move,editEach,editSku,fcsku});
  }
  return Object.freeze({create});
})();

// ---- src/suites/aft/index.js ----
V3.boot = () => {
  const VERSION=V3.build.version;
  const life=V3.lifecycle.create('aft-suite');
  const telemetry=V3.telemetry.create('aft',VERSION);
  const settings=V3.storage.create('aft.settings');
  let busy=false,stopRequested=false,lastMessage='';
  let tab=/\/moveitems/i.test(location.pathname)?'move':/\/fcskuflip/i.test(location.pathname)?'fcsku':settings.get('tab','edit');
  if(!['move','edit','fcsku','obs'].includes(tab))tab='edit';
  const qtyHistory=[];

  const client=V3.aft.create({origin:location.origin,telemetry,life,stopped:()=>stopRequested});
  const workflows=V3.aftWorkflows.create({
    client,telemetry,stopped:()=>stopRequested,
    onProgress:(message,data)=>{shell.setStatus(message,'work');telemetry.emit('aft.ui.progress',{tab,message,...data});},
    onQuantity:value=>{qtyHistory.push({...value,at:Date.now()});if(qtyHistory.length>12)qtyHistory.shift();if(tab==='edit')render();}
  });

  const shell=V3.ui.createShell({
    id:'bwu2-v3-aft',title:'BWU2 V3 AFT',subtitle:'Edit · Move · FCSKU',version:VERSION,life,
    tabs:[{id:'move',label:'MOVE'},{id:'edit',label:'EDIT'},{id:'fcsku',label:'FCSKU'},{id:'obs',label:'OBS'}],
    onTab:next=>{if(busy){shell.select(tab);return;}tab=next;settings.set('tab',tab);render();}
  });
  V3.screenshot.install({life,roots:[shell.host]});

  const stateOptions=selected=>['Sellable','Pending Research','Unsellable'].map(v=>'<option'+(v===selected?' selected':'')+'>'+v+'</option>').join('');
  const damageOptions=selected=>['Amazon Damage','Defective','Distributor Damage','Expired'].map(v=>'<option'+(v===selected?' selected':'')+'>'+v+'</option>').join('');
  const controls=()=>'<div class="v3-row"><button class="v3-btn primary" data-run '+(busy?'disabled':'')+'>RUN</button><button class="v3-btn danger" data-stop>STOP AFTER CURRENT</button></div>'+
    (lastMessage?'<div class="v3-note" style="margin-top:7px;white-space:pre-wrap">'+V3.base.esc(lastMessage)+'</div>':'');

  function wire(host,task){
    host.querySelector('[data-run]').onclick=()=>runTask(task);
    host.querySelector('[data-stop]').onclick=()=>{stopRequested=true;shell.setStatus('STOP REQUESTED','warn');};
  }
  function runTask(task){
    if(busy)return;
    busy=true;stopRequested=false;lastMessage='';shell.setStatus('RUNNING','work');render();
    Promise.resolve().then(task).then(result=>{
      lastMessage='DONE';shell.setStatus('DONE','');telemetry.emit('aft.ui.done',{tab,result:V3.telemetry.sanitize(result)});
    }).catch(error=>{
      const unknown=error?.outcome==='unknown';
      lastMessage=(unknown?'OUTCOME UNKNOWN — VERIFY BEFORE RETRY · ':'')+String(error?.message||error);
      shell.setStatus(unknown?'UNKNOWN':'STOPPED',unknown?'bad':'warn');
      telemetry.emit('aft.ui.error',{tab,message:String(error?.message||error),unknown});
    }).finally(()=>{busy=false;render();});
  }

  function renderMove(){
    const root=document.createElement('div');
    root.innerHTML='<section class="v3-section"><h3>MoveItems</h3>'+
      '<label class="v3-field">Mode<select data-mode><option>ALL</option><option>EACH</option><option>QTY</option></select></label>'+
      '<label class="v3-field">QTY<input data-qty type="number" min="1" value="1"></label>'+
      '<label class="v3-field">Source<input data-source autocomplete="off"></label>'+
      '<label class="v3-field">Destination<input data-dest autocomplete="off"></label>'+
      '<label class="v3-field">Items<textarea class="v3-input" data-items></textarea></label>'+controls()+'</section>';
    shell.setContent(root);
    wire(root,()=>workflows.move({
      source:root.querySelector('[data-source]').value,destination:root.querySelector('[data-dest]').value,
      items:V3.base.lines(root.querySelector('[data-items]').value,{dedupe:false}),
      qtyMode:root.querySelector('[data-mode]').value,quantity:Number(root.querySelector('[data-qty]').value)
    }));
  }

  function renderEdit(){
    const mode=settings.get('editMode','sku');
    const root=document.createElement('div');
    root.innerHTML='<section class="v3-section"><div class="v3-row"><button class="v3-btn '+(mode==='each'?'primary':'')+'" data-edit-mode="each">EACH</button><button class="v3-btn '+(mode==='sku'?'primary':'')+'" data-edit-mode="sku">SKU</button></div></section>'+
      (mode==='each'
        ? '<section class="v3-section"><h3>Edit EACH</h3><label class="v3-field">Location ASIN FNSKU rows<textarea class="v3-input" data-rows></textarea></label>'+
          '<div class="v3-grid"><label class="v3-field">Target<select data-target>'+stateOptions('Unsellable')+'</select></label><label class="v3-field">Disposition<select data-damage>'+damageOptions('Defective')+'</select></label></div>'+controls()+'</section>'
        : '<section class="v3-section"><h3>Edit SKU</h3>'+
          '<div class="v3-row" style="margin-bottom:8px">'+(qtyHistory.slice(-3).map(q=>'<span class="v3-note">S '+(q.sellable??'—')+' · P '+(q.pending??'—')+' · U '+(q.unsellable??'—')+'</span>').join('')||'<span class="v3-note">Quantity history appears here.</span>')+'</div>'+
          '<label class="v3-field">SKU<input data-sku autocomplete="off"></label>'+
          '<div class="v3-grid"><label class="v3-field">Current<select data-current>'+stateOptions('Sellable')+'</select></label><label class="v3-field">Current disposition<select data-current-damage>'+damageOptions('Defective')+'</select></label>'+
          '<label class="v3-field">Desired<select data-desired>'+stateOptions('Unsellable')+'</select></label><label class="v3-field">Desired disposition<select data-desired-damage>'+damageOptions('Defective')+'</select></label></div>'+controls()+'</section>');
    shell.setContent(root);
    for(const button of root.querySelectorAll('[data-edit-mode]'))button.onclick=()=>{if(busy)return;settings.set('editMode',button.dataset.editMode);render();};
    if(mode==='each')wire(root,()=>{
      const rows=String(root.querySelector('[data-rows]').value||'').split(/\r?\n/).map(V3.base.clean).filter(Boolean).map(line=>{
        const [location='',asin='',fnsku='']=line.split(/\s+/);return{location,asin,fnsku:fnsku||asin};
      });
      return workflows.editEach({rows,desiredState:root.querySelector('[data-target]').value,desiredDamage:root.querySelector('[data-damage]').value});
    });
    else wire(root,()=>workflows.editSku({
      sku:root.querySelector('[data-sku]').value,currentState:root.querySelector('[data-current]').value,
      currentDamage:root.querySelector('[data-current-damage]').value,desiredState:root.querySelector('[data-desired]').value,
      desiredDamage:root.querySelector('[data-desired-damage]').value
    }));
  }

  function renderFcsku(){
    const root=document.createElement('div');
    root.innerHTML='<section class="v3-section"><h3>FCSKU Flip</h3>'+
      '<label class="v3-field">OLD FCSKU<input data-old autocomplete="off"></label>'+
      '<label class="v3-field">NEW FCSKU<input data-new autocomplete="off"></label>'+
      '<label class="v3-field">Locations / containers<textarea class="v3-input" data-locations></textarea></label>'+controls()+'</section>';
    shell.setContent(root);
    wire(root,()=>workflows.fcsku({
      oldCode:root.querySelector('[data-old]').value,newCode:root.querySelector('[data-new]').value,
      locations:V3.base.lines(root.querySelector('[data-locations]').value)
    }));
  }

  function renderObs(){
    const events=telemetry.list(),root=document.createElement('div');
    root.innerHTML='<section class="v3-section"><h3>AFT OBS</h3><div class="v3-note">'+V3.base.esc(V3.build.id)+' · '+events.length+' events</div>'+
      '<div class="v3-row" style="margin-top:8px"><button class="v3-btn" data-export>EXPORT</button><button class="v3-btn danger" data-clear>CLEAR</button></div></section>'+
      '<section class="v3-section"><pre class="v3-log">'+V3.base.esc(JSON.stringify(events.slice(-80),null,2))+'</pre></section>';
    shell.setContent(root);
    root.querySelector('[data-export]').onclick=()=>{
      const blob=new Blob([telemetry.exportText()],{type:'application/json'}),a=document.createElement('a');
      a.href=URL.createObjectURL(blob);a.download='BWU2_V3_AFT_OBS_'+Date.now()+'.json';a.click();URL.revokeObjectURL(a.href);
    };
    root.querySelector('[data-clear]').onclick=()=>{telemetry.clear();renderObs();};
  }

  function render(){
    if(shell.tab!==tab){shell.select(tab);return;}
    if(tab==='move')renderMove();
    else if(tab==='edit')renderEdit();
    else if(tab==='fcsku')renderFcsku();
    else renderObs();
  }

  shell.select(tab);
  render();
};

if(typeof V3.boot!=='function') throw new Error('V3 suite boot function missing');
V3.boot();
})();
