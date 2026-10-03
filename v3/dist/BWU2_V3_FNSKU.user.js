// ==UserScript==
// @name         BWU2 V3 FNSKU Mapping
// @name:en      BWU2 V3 FNSKU Mapping
// @namespace    https://github.com/1Sirkkris/-tampermonkey-v2/v3
// @version      0.1.0
// @description  V3 exact regional FNSKU to ASIN to JP/AU mapping lookup.
// @match        https://fba-fnsku-commingling-console-eu.aka.amazon.com/tool/fnsku-mappings-tool*
// @match        https://fba-fnsku-commingling-console-na.aka.amazon.com/tool/fnsku-mappings-tool*
// @match        https://fba-fnsku-commingling-console-jp.aka.amazon.com/tool/fnsku-mappings-tool*
// @run-at       document-body
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @connect      fba-fnsku-commingling-console-eu.aka.amazon.com
// @connect      fba-fnsku-commingling-console-na.aka.amazon.com
// @connect      fba-fnsku-commingling-console-jp.aka.amazon.com
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-rebuild/v3/dist/BWU2_V3_FNSKU.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-rebuild/v3/dist/BWU2_V3_FNSKU.user.js
// @v3-build     fnsku-0.1.0-2a8544f1
// ==/UserScript==

(()=>{
'use strict';
const V3=Object.create(null);
V3.build=Object.freeze({"id":"fnsku-0.1.0-2a8544f1","version":"0.1.0","suite":"fnsku"});

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

// ---- src/suites/fnsku/index.js ----
V3.boot = () => {
  const VERSION=V3.build.version;
  const life=V3.lifecycle.create('fnsku');
  const telemetry=V3.telemetry.create('fnsku',VERSION);
  const shell=V3.ui.createShell({
    id:'bwu2-v3-fnsku',title:'BWU2 V3 FNSKU Mapping',subtitle:'Exact regional mapping',version:VERSION,life,tabs:[]
  });
  V3.screenshot.install({life,roots:[shell.host]});

  const HOSTS={
    na:'fba-fnsku-commingling-console-na.aka.amazon.com',
    eu:'fba-fnsku-commingling-console-eu.aka.amazon.com',
    jp:'fba-fnsku-commingling-console-jp.aka.amazon.com'
  };
  let running=false,last=null;

  const token=()=>{
    try{
      const fromUrl=new URL(location.href).searchParams.get('anti-csrftoken-a2z');
      if(fromUrl)return fromUrl;
    }catch{}
    return document.querySelector('input[name="anti-csrftoken-a2z"],textarea[name="anti-csrftoken-a2z"]')?.value||'';
  };
  const buildUrl=(region,type,{fnsku='',asin=''}={})=>{
    const url=new URL('/tool/fnsku-mappings-tool/get','https://'+HOSTS[region]);
    url.searchParams.set('getMappingsType',type);
    url.searchParams.set('FNSku','');
    url.searchParams.set('FNSkus',fnsku?fnsku+'\r\n':'');
    url.searchParams.set('merchantId','');
    url.searchParams.set('MSkus','');
    url.searchParams.set('ASIN',asin);
    url.searchParams.set('includeInactive','true');
    url.searchParams.set('includeInternalMerchants','false');
    if(token())url.searchParams.set('anti-csrftoken-a2z',token());
    url.searchParams.set('submit','get');
    url.searchParams.set('paginationToken','');
    return url.toString();
  };
  const parseRows=html=>{
    const doc=V3.base.parseHtml(html);
    const table=doc.querySelector('#fnsku-table')||doc.querySelector('table.table');
    if(!table)return[];
    const rows=[...table.querySelectorAll('tr')];
    if(rows.length<2)return[];
    const headers=[...rows[0].querySelectorAll('th,td')].map(x=>V3.base.lower(x.textContent));
    const index={
      merchant:headers.findIndex(h=>/merchant\s*id/.test(h)),
      msku:headers.findIndex(h=>/msku/.test(h)),
      fnsku:headers.findIndex(h=>/fnsku/.test(h)),
      asin:headers.findIndex(h=>/^asin$/.test(h)),
      condition:headers.findIndex(h=>/condition/.test(h)),
      status:headers.findIndex(h=>/status/.test(h))
    };
    return rows.slice(1).map(row=>{
      const cells=[...row.querySelectorAll('td')].map(x=>V3.base.clean(x.textContent));
      const get=i=>i>=0&&i<cells.length?cells[i]:'';
      return{
        merchantId:get(index.merchant),msku:get(index.msku),
        fnsku:V3.base.upper(get(index.fnsku)),asin:V3.base.upper(get(index.asin)),
        condition:get(index.condition),status:get(index.status)
      };
    }).filter(row=>row.fnsku||row.asin);
  };
  const uniqueRows=rows=>{
    const seen=new Set();
    return rows.filter(row=>{
      const key=[row.merchantId,row.msku,row.fnsku,row.asin,row.condition,row.status].map(V3.base.upper).join('|');
      if(seen.has(key))return false;seen.add(key);return true;
    });
  };
  const get=async(url,label)=>{
    const result=await V3.api.gmRequest(url,{
      headers:{Accept:'text/html, */*; q=0.01','X-Requested-With':'XMLHttpRequest'},
      timeout:10000,telemetry,allowHtml:true
    });
    if(/sign\s*in|sso\/login|is_authenticated/i.test(result.raw)&&!/fnsku-table/i.test(result.raw)){
      throw new Error(label+': authentication required');
    }
    return result;
  };
  const lookupFnsku=async(region,code)=>{
    const result=await get(buildUrl(region,'FNSKU_MAPPINGS',{fnsku:code}),region.toUpperCase());
    const rows=parseRows(result.raw).filter(row=>row.fnsku===code);
    return{region,rows,asins:[...new Set(rows.map(row=>row.asin).filter(x=>/^B0[A-Z0-9]{8}$/.test(x)))]};
  };
  const lookupAsin=async asin=>{
    const result=await get(buildUrl('jp','ASIN_MAPPINGS',{asin}),'JP/AU');
    const rows=uniqueRows(parseRows(result.raw).filter(row=>row.asin===asin));
    return{region:'JP',rows,fnskus:[...new Set(rows.map(row=>row.fnsku).filter(Boolean))]};
  };

  const matchRank=(row,sourceRows)=>{
    const merchant=V3.base.upper(row.merchantId);
    const msku=V3.base.upper(row.msku);
    const both=merchant&&msku&&sourceRows.some(x=>V3.base.upper(x.merchantId)===merchant&&V3.base.upper(x.msku)===msku);
    if(both)return{rank:3,label:'BOTH'};
    if(msku&&sourceRows.some(x=>V3.base.upper(x.msku)===msku))return{rank:2,label:'MSKU'};
    if(merchant&&sourceRows.some(x=>V3.base.upper(x.merchantId)===merchant))return{rank:1,label:'MERCHANT'};
    return{rank:0,label:'—'};
  };
  const copy=text=>{try{GM_setClipboard(String(text),'text');}catch{navigator.clipboard?.writeText(String(text)).catch(()=>{});}};

  function table(rows,candidates=false){
    if(!rows.length)return'<div class="v3-note">No exact rows returned.</div>';
    return'<div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font:10px Consolas,monospace"><thead><tr>'+
      (candidates?'<th>Match</th>':'')+'<th>Merchant</th><th>MSKU</th><th>FNSKU</th><th>ASIN</th><th>State</th></tr></thead><tbody>'+
      rows.map(row=>'<tr>'+
        (candidates?'<td>'+V3.base.esc(row.match?.label||'—')+'</td>':'')+
        [row.merchantId,row.msku,row.fnsku,row.asin,[row.condition,row.status].filter(Boolean).join(' · ')].map(value=>
          '<td style="border-top:1px solid #384559;padding:5px">'+(value?'<button class="v3-btn" style="min-height:24px;padding:3px 5px" data-copy="'+V3.base.esc(value)+'">'+V3.base.esc(value)+'</button>':'—')+'</td>'
        ).join('')+'</tr>').join('')+
      '</tbody></table></div>';
  }
  function render(){
    const root=document.createElement('div');
    root.innerHTML='<section class="v3-section"><h3>FNSKU / ASIN</h3>'+
      '<label class="v3-field">Barcode<input data-code autocomplete="off" placeholder="X004... or B0..."></label>'+
      '<button class="v3-btn primary" data-run>'+(running?'RUNNING…':'LOOKUP')+'</button>'+
      '<div class="v3-note" style="margin-top:7px">Exact attribution only. Foreign FNSKU → ASIN → JP/AU candidates.</div></section>'+
      (last?.html||'');
    shell.setContent(root);
    const input=shell.body.querySelector('[data-code]');
    if(last?.code)input.value=last.code;
    input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();run();}};
    shell.body.querySelector('[data-run]').onclick=run;
    for(const button of shell.body.querySelectorAll('[data-copy]'))button.onclick=()=>copy(button.dataset.copy);
  }
  async function run(){
    if(running)return;
    const input=shell.body.querySelector('[data-code]');
    const code=V3.base.upper(input?.value);
    if(!code)return;
    running=true;shell.setStatus('LOOKING','work');last={code,html:''};render();
    try{
      if(/^B0[A-Z0-9]{8}$/.test(code)){
        const jp=await lookupAsin(code);
        last.html='<section class="v3-section"><h3>JP / AU mappings · '+V3.base.esc(code)+'</h3>'+table(jp.rows,false)+'</section>';
        shell.setStatus(jp.rows.length?'FOUND':'NO EXACT','');
      }else{
        const settled=await Promise.allSettled([lookupFnsku('na',code),lookupFnsku('eu',code)]);
        const found=settled.filter(x=>x.status==='fulfilled').map(x=>x.value).filter(x=>x.asins.length);
        const asins=[...new Set(found.flatMap(x=>x.asins))];
        if(!asins.length){
          const jpSource=await lookupFnsku('jp',code);
          for(const asin of jpSource.asins)asins.push(asin);
          if(!asins.length)throw new Error('No exact FNSKU mapping found in NA, EU or JP/AU');
          found.push(jpSource);
        }
        if(asins.length!==1)throw new Error('Multiple exact ASINs returned — stopped instead of guessing: '+asins.join(', '));
        const asin=asins[0];
        const sourceRows=uniqueRows(found.flatMap(x=>x.rows).filter(x=>x.asin===asin));
        const jp=await lookupAsin(asin);
        const candidates=jp.rows.map(row=>({...row,match:matchRank(row,sourceRows)}))
          .sort((a,b)=>b.match.rank-a.match.rank||String(a.fnsku).localeCompare(String(b.fnsku)));
        last.html='<section class="v3-section"><h3>ASIN · '+V3.base.esc(asin)+'</h3>'+table(sourceRows,false)+'</section>'+
          '<section class="v3-section"><h3>JP / AU candidates</h3><div class="v3-note">Merchant/MSKU matches are ranking hints only.</div>'+table(candidates,true)+'</section>';
        shell.setStatus('FOUND','');
      }
      telemetry.emit('lookup',{input:V3.telemetry.mask(code),ok:true});
    }catch(error){
      last.html='<section class="v3-section"><h3>Lookup stopped</h3><div class="v3-note">'+V3.base.esc(error?.message||error)+'</div></section>';
      shell.setStatus('ERROR','bad');
      telemetry.emit('lookup',{input:V3.telemetry.mask(code),ok:false,message:String(error?.message||error)});
    }finally{running=false;render();}
  }
  render();
};

if(typeof V3.boot!=='function') throw new Error('V3 suite boot function missing');
V3.boot();
})();
