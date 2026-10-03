// ==UserScript==
// @name         V3 | BWU2 MoveApp
// @name:en      V3 | BWU2 MoveApp
// @namespace    https://github.com/1Sirkkris/-tampermonkey-v2/v3
// @version      0.1.0
// @description  V3 direct sequential MoveContainer / Dropzone queue.
// @include      /^https?:\/\/aft-moveapp-[^\/.]+(?:\.nrt)?\.proxy\.amazon\.com\/move-container(?:[\/?#]|$)/
// @run-at       document-body
// @grant        GM_xmlhttpRequest
// @connect      aft-moveapp-nrt-nrt.nrt.proxy.amazon.com
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-rebuild/v3/dist/BWU2_V3_MoveApp.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-rebuild/v3/dist/BWU2_V3_MoveApp.user.js
// @v3-build     moveapp-0.1.0-4b3c3945
// ==/UserScript==

(()=>{
'use strict';
const V3=Object.create(null);
V3.build=Object.freeze({"id":"moveapp-0.1.0-4b3c3945","version":"0.1.0","suite":"moveapp"});

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

// ---- src/services/movecontainer.js ----
V3.moveContainer = (() => {
  const URL='https://aft-moveapp-nrt-nrt.nrt.proxy.amazon.com/api/move-container';
  const FLOORS=['P1','P2','P3','P4'];
  const UPPER=[
    ['Cubiscan','dz-Pcubiscan-{floor}'],['Prep','dz-P-Prep-{floor}'],['ISS','dz-P-ISS-{floor}'],
    ['Damages','dz-P-Damages-{floor}'],['Hazmat','dz-P-Hazmat-{floor}'],['Nonsort','dz-Pnonsort-{floor}']
  ];
  const P1=[
    ['Hazmat','dz-P-HAZMAT_OUT'],['Ticketland','dz-P-Ticketland'],['Consolidation','dz-P-issconsol'],
    ['ISS WIP','dz-S-ISSWIP1'],['Nonsort','dz-P-IB-nonsort'],['Shipdock','dz-P-ISS-Shipdock'],
    ['OB IOL','dz-P-OBIOL'],['Damageland','dz-Pdamageland'],['Receive Damages','dz-P-rcv-Damages']
  ];
  const destination=(floor,type)=>{
    if(type==='PRIME')return'dz-P-PRIME';
    const found=(floor==='P1'?P1:UPPER).find(([name])=>name===type);
    return !found?'':floor==='P1'?found[1]:found[1].replace('{floor}',floor);
  };
  const choices=floor=>[['PRIME','dz-P-PRIME'],...(floor==='P1'?P1:UPPER.map(([name,tpl])=>[name,tpl.replace('{floor}',floor)]))];
  async function move(container,destinationScannableId,{telemetry}={}){
    const code=V3.base.clean(container),dest=V3.base.clean(destinationScannableId);
    if(!V3.base.validContainer(code))throw new Error('Container must be tsX/csX');
    if(!dest)throw new Error('Destination required');
    const operation=V3.operation.create({kind:'move-container',ref:code,telemetry});
    const payload={sourceScannableId:null,destinationScannableId:dest,containerScannableId:code,confirmed:'true'};
    const result=await V3.api.gmRequest(URL,{
      method:'POST',data:JSON.stringify(payload),headers:{'Content-Type':'application/json'},
      timeout:15000,mutation:true,operation,telemetry
    });
    const finalUrl=V3.base.clean(result.finalUrl||'');
    if(finalUrl){
      try{
        if(new URL(finalUrl).pathname.replace(/\/+$/,'')!==new URL(URL).pathname.replace(/\/+$/,'')){
          operation.unknown({reason:'redirect'});
          throw new V3.operation.OutcomeUnknownError('Move confirmation redirected unexpectedly');
        }
      }catch(error){if(error?.outcome==='unknown')throw error;}
    }
    operation.confirmed({status:result.status,destination:dest});
    return result;
  }
  return Object.freeze({URL,FLOORS,UPPER,P1,destination,choices,move});
})();

// ---- src/suites/moveapp/index.js ----
V3.boot = () => {
  const VERSION=V3.build.version;
  const life=V3.lifecycle.create('moveapp');
  const telemetry=V3.telemetry.create('moveapp',VERSION);
  const queue=V3.queue.create({name:'moveapp',life,telemetry});
  const settings=V3.storage.create('moveapp.settings');
  const shell=V3.ui.createShell({id:'bwu2-v3-moveapp',title:'BWU2 V3 MoveApp',subtitle:'Dropzone Queue',version:VERSION,life,tabs:[]});
  V3.screenshot.install({life,roots:[shell.host]});
  const FLOORS=V3.moveContainer.FLOORS;
  let busy=false;
  let floor=settings.get('floor','P2');
  if(!FLOORS.includes(floor))floor='P2';
  let type=settings.get('type','PRIME');

  function destination(){ return V3.moveContainer.destination(floor,type); }
  async function moveOne(item,dz){
    queue.itemSet(item,{status:'active',phase:'move',error:''});
    queue.set({currentId:item.id,phase:'move',message:'Moving '+item.id+' → '+dz});
    await V3.moveContainer.move(item.id,dz,{telemetry});
    queue.itemSet(item,{status:'done',phase:'done',error:''});
    queue.set({currentId:'',phase:'idle',message:'MOVED '+item.id+' → '+dz});
  }
  async function pump(){
    if(busy||!queue.state.running)return;
    if(!queue.acquire()){queue.set({running:false,message:'Move queue is active in another tab'});render();return;}
    const item=queue.next();
    if(!item){queue.set({running:false,currentId:'',phase:'idle',message:'Queue complete',lockedDestination:''});queue.release();render();return;}
    const dz=queue.state.lockedDestination||destination();
    if(!dz){queue.set({running:false,message:'Select a destination'});queue.release();render();return;}
    busy=true;render();
    try{await moveOne(item,dz);}
    catch(error){
      const unknown=error?.outcome==='unknown'||error instanceof V3.operation.OutcomeUnknownError;
      queue.itemSet(item,{status:unknown?'attention':'rejected',phase:unknown?'unknown':'rejected',error:unknown?'OUTCOME UNKNOWN — VERIFY BEFORE RETRY':String(error?.message||error)});
      queue.set({running:false,currentId:'',phase:'idle',message:unknown?item.id+' outcome UNKNOWN':String(error?.message||error)});
      telemetry.emit('queue.error',{item:V3.telemetry.mask(item.id),message:String(error?.message||error),unknown});
    }finally{busy=false;if(!queue.state.running)queue.release();render();}
    if(queue.state.running)life.timeout(pump,180);
  }
  function render(){
    const s=queue.state,dz=s.lockedDestination||destination();
    shell.setStatus(s.running?'RUNNING':(s.items.some(i=>i.status==='attention')?'ATTENTION':'READY'),s.items.some(i=>i.status==='attention')?'bad':s.running?'work':'');
    const root=document.createElement('div');
    const options=V3.moveContainer.choices(floor).filter(([name])=>name!=='PRIME').map(([name])=>'<option'+(name===type?' selected':'')+'>'+V3.base.esc(name)+'</option>').join('');
    root.innerHTML=
      '<section class="v3-section"><h3>MoveContainer</h3><div class="v3-note">Destination locks when RUN starts. PRIME is always dz-P-PRIME.</div></section>'+
      '<section class="v3-section"><div class="v3-grid">'+
        '<label class="v3-field">Floor<select data-floor>'+FLOORS.map(f=>'<option'+(f===floor?' selected':'')+'>'+f+'</option>').join('')+'</select></label>'+
        '<label class="v3-field">Drop<select data-type><option'+(type==='PRIME'?' selected':'')+'>PRIME</option>'+options+'</select></label>'+
      '</div><div class="v3-note">Selected: <b>'+V3.base.esc(dz||'NONE')+'</b></div></section>'+
      '<section class="v3-section"><label class="v3-field">Containers<textarea class="v3-input" data-input placeholder="tsX...&#10;csX..."></textarea></label>'+
        '<div class="v3-row"><button class="v3-btn" data-add>ADD</button><button class="v3-btn primary" data-run>RUN</button><button class="v3-btn" data-pause>PAUSE</button><button class="v3-btn" data-done>CLEAR DONE</button></div></section>'+
      '<section class="v3-section"><h3>'+V3.base.esc(s.message||'Ready')+'</h3><div class="v3-list" data-list></div></section>';
    const list=root.querySelector('[data-list]');
    for(const item of s.items){const row=document.createElement('div');row.className='v3-item';row.dataset.state=item.status;row.innerHTML='<span>'+V3.base.esc(item.id)+(item.error?'<br><small>'+V3.base.esc(item.error)+'</small>':'')+'</span><b>'+item.status.toUpperCase()+'</b>';list.appendChild(row);}
    shell.setContent(root);
    shell.body.querySelector('[data-floor]').onchange=e=>{if(s.running)return;floor=e.target.value;settings.set('floor',floor);type='PRIME';settings.set('type',type);s.lockedDestination='';queue.save();render();};
    shell.body.querySelector('[data-type]').onchange=e=>{if(s.running)return;type=e.target.value;settings.set('type',type);s.lockedDestination='';queue.save();render();};
    shell.body.querySelector('[data-add]').onclick=()=>{const input=shell.body.querySelector('[data-input]');queue.addMany(String(input.value||'').split(/[\n,]+/).map(V3.base.clean));input.value='';render();};
    shell.body.querySelector('[data-run]').onclick=()=>{
      if(s.items.some(i=>i.status==='attention')){queue.set({message:'Resolve ATTENTION rows before RUN'});render();return;}
      const selected=destination();if(!selected){queue.set({message:'Select a destination'});render();return;}
      s.lockedDestination=selected;queue.save();queue.set({running:true,message:'Starting → '+selected});render();pump();
    };
    shell.body.querySelector('[data-pause]').onclick=()=>{queue.set({running:false,message:'Paused — current submitted move may finish'});render();};
    shell.body.querySelector('[data-done]').onclick=()=>{queue.clearDone();render();};
  }
  render();
};

if(typeof V3.boot!=='function') throw new Error('V3 suite boot function missing');
V3.boot();
})();
