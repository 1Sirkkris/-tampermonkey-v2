// ==UserScript==
// @name         V3 | BWU2 FCResearch Suite
// @namespace    https://github.com/1Sirkkris/-tampermonkey-v2/v3
// @version      0.1.2
// @description  V3 FCResearch suite: FCR, Tote Audit, ISS, direct Sideline, RIVER and integrated OBS.
// @include      /^https?:\/\/.*fcresearch.*\//
// @include      /^https?:\/\/qifcr\.fe\.aftx\.amazonoperations\.app\//
// @match        https://river.amazon.com/*
// @run-at       document-body
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_openInTab
// @connect      aft-poirot-website-nrt.nrt.proxy.amazon.com
// @connect      pandash.amazon.com
// @connect      aft-qt-jp.aka.nrt.corp.amazon.com
// @connect      aft-moveapp-nrt-nrt.nrt.proxy.amazon.com
// @connect      localhost
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-rebuild/v3/dist/BWU2_V3_FCResearch.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-rebuild/v3/dist/BWU2_V3_FCResearch.user.js
// @v3-build     fcr-0.1.2-5b5303cf
// ==/UserScript==

(()=>{
'use strict';
const V3=Object.create(null);
V3.build=Object.freeze({"id":"fcr-0.1.2-5b5303cf","version":"0.1.2","suite":"fcr"});

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
    '.v3-shell{width:470px;max-height:calc(100vh - 28px);display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--v3-line);border-radius:14px;background:var(--v3-bg);box-shadow:0 16px 44px rgba(0,0,0,.42)}',
    '.v3-head{flex:0 0 auto;display:flex;align-items:center;gap:9px;min-height:54px;padding:10px 11px 10px 14px;border-bottom:1px solid var(--v3-line);background:#181e28}',
    '.v3-brand{min-width:0;flex:1}.v3-brand b{display:block;font-size:16px;letter-spacing:.25px}.v3-brand small{display:block;margin-top:3px;color:var(--v3-muted);font-size:10px;font-weight:700}',
    '.v3-status{max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid var(--v3-line);border-radius:999px;padding:5px 8px;color:var(--v3-ok);background:#13231a;font-size:10px;font-weight:900}',
    '.v3-status[data-tone="warn"]{color:#17120a;background:var(--v3-warn)}.v3-status[data-tone="bad"]{color:#fff;background:#8f211c}.v3-status[data-tone="work"]{color:#17120a;background:#ffd84d}',
    '.v3-icon,.v3-tab,.v3-btn{border:1px solid var(--v3-line);border-radius:8px;background:var(--v3-panel2);color:var(--v3-text);cursor:pointer;font-weight:900}',
    '.v3-icon{width:32px;height:32px}.v3-btn{min-height:34px;padding:7px 10px}.v3-btn.primary{background:#eef4ff;color:#111827}.v3-btn.danger{background:#8f211c;color:#fff}',
    '.v3-icon:focus-visible,.v3-tab:focus-visible,.v3-btn:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:3px solid var(--v3-focus);outline-offset:2px}',
    '.v3-tabs{flex:0 0 auto;display:flex;gap:7px;padding:9px 10px;border-bottom:1px solid var(--v3-line);overflow-x:auto;overflow-y:hidden;background:#121721}.v3-tab{flex:1 0 auto;min-height:36px;padding:7px 11px;color:var(--v3-muted);white-space:nowrap}.v3-tab[data-active="1"]{color:#fff;background:#303a49;border-color:#9aa8ba}',
    '.v3-body{flex:1 1 auto;min-height:0;overflow:auto;padding:12px}.v3-section{padding:11px;border:1px solid var(--v3-line);border-radius:10px;background:var(--v3-panel);margin-bottom:10px}',
    '.v3-section h3{margin:0 0 7px;font-size:13px}.v3-note{color:var(--v3-muted);font-size:11px;line-height:1.4}',
    '.v3-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.v3-row{display:flex;gap:7px;align-items:center}.v3-row>*{min-width:0}',
    'label.v3-field{display:grid;gap:4px;color:var(--v3-muted);font-size:10px;font-weight:800;margin-bottom:8px}',
    '.v3-field input,.v3-field textarea,.v3-field select,input.v3-input,textarea.v3-input{width:100%;border:1px solid #56657a;border-radius:8px;background:#0d1117;color:#fff;padding:8px 9px;min-height:35px}',
    'textarea.v3-input,.v3-field textarea{min-height:92px;resize:vertical;font-family:Consolas,monospace;font-size:12px}',
    '.v3-list{display:grid;gap:5px}.v3-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;padding:6px 8px;border:1px solid #3b4658;border-left:5px solid #748096;border-radius:7px;background:#11161e;font:700 11px/1.25 Consolas,monospace}',
    '.v3-item[data-state="done"]{border-left-color:#68e690}.v3-item[data-state="attention"],.v3-item[data-state="rejected"]{border-left-color:#ff655d}.v3-item[data-state="active"]{border-left-color:#ffd84d}',
    '.v3-log{width:100%;min-height:90px;max-height:180px;overflow:auto;white-space:pre-wrap;border:1px solid #39465a;border-radius:8px;background:#0b0f14;padding:8px;color:#d9e2ef;font:11px/1.35 Consolas,monospace}',
    '.v3-footer{flex:0 0 auto;display:flex;justify-content:space-between;gap:8px;padding:7px 11px;border-top:1px solid var(--v3-line);color:var(--v3-muted);font-size:9px;font-weight:800}',
    '.v3-shell[data-collapsed="1"]{width:190px}.v3-shell[data-collapsed="1"] .v3-tabs,.v3-shell[data-collapsed="1"] .v3-body,.v3-shell[data-collapsed="1"] .v3-footer{display:none}',
    '@media(max-width:700px){:host{right:6px;top:6px}.v3-shell{width:min(470px,calc(100vw - 12px));max-height:calc(100vh - 12px)}}'
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

// ---- src/core/print.js ----
V3.print = (() => {
  const hex = value => Array.from(new TextEncoder().encode(String(value ?? '')))
    .map(byte => byte.toString(16).padStart(2,'0')).join('');
  const cookie = name => {
    try {
      for (const raw of String(document.cookie || '').split(';')) {
        const part = raw.trim();
        const split = part.indexOf('=');
        if (split < 1 || part.slice(0,split).trim() !== name) continue;
        let value = part.slice(split + 1);
        try { value = decodeURIComponent(value); } catch {}
        return value;
      }
    } catch {}
    return '';
  };

  async function barcode(code, options = {}) {
    const value = V3.base.clean(code);
    if (!value) throw new Error('Barcode required');
    const quantity = Math.max(1, Math.min(999, Number(options.quantity) || 1));
    const description = V3.base.clean(options.description || '');
    const badge = V3.base.clean(cookie('fcmenu-employeeId'));
    const url = 'http://localhost:5965/printer?action=print&type=barcode' +
      '&data=' + hex(value) +
      '&text=' + hex(value) +
      '&quantity=' + quantity +
      '&desc=' + hex(description) +
      '&badgeid=' + encodeURIComponent(badge) +
      '&seq=' + Date.now();

    const result = await V3.api.gmRequest(url, { timeout:5000, telemetry:options.telemetry });
    options.telemetry?.emit('print', {
      code:V3.telemetry.mask(value),
      quantity,
      descriptionBound:Boolean(description),
      status:result.status
    });
    return result;
  }

  return Object.freeze({ barcode });
})();

// ---- src/services/fcr.js ----
V3.fcr = (() => {
  const warehouse=()=>location.pathname.match(/^\/([^/]+)\/results(?:\/|$)/i)?.[1]||'';
  const apiBase=()=>{const fc=warehouse();if(!fc)throw new Error('Warehouse not found in URL');return location.origin+'/'+encodeURIComponent(fc)+'/results';};
  const headers={'Content-Type':'application/x-www-form-urlencoded','Accept':'text/html, */*; q=0.01','X-Requested-With':'XMLHttpRequest'};
  const parseBool=value=>/^(true|yes|1)$/i.test(V3.base.clean(value))?true:/^(false|no|0)$/i.test(V3.base.clean(value))?false:null;
  const suspiciousDimensions=value=>{
    let parts=String(value||'').match(/\d+(?:\.\d+)?/g);if(!parts||parts.length<3)return false;parts=parts.slice(0,3);
    const values=parts.map(Number),eq=(a,b)=>Math.abs(a-b)<.001,rounded=parts.filter(x=>/\.00$/.test(x)).length;
    return eq(values[0],values[1])||eq(values[0],values[2])||eq(values[1],values[2])||rounded>=3||(Math.min(...values)<=2.001&&rounded>=2);
  };
  const normalizeProduct=data=>{
    const sortable=parseBool(data.sortable);
    return{
      asin:V3.base.clean(data.asin),isbn:V3.base.clean(data.isbn),primary:V3.base.clean(data.asin||data.isbn),
      fnsku:V3.base.clean(data.fnsku),fcsku:V3.base.clean(data.fcsku),title:V3.base.clean(data.title),
      dimensions:V3.base.clean(data.dimensions),weight:V3.base.clean(data.weight),img:V3.base.clean(data.img),
      inventoryCost:V3.base.clean(data['list price']||data.price||data['inventory cost']||''),
      sortable,sortableText:sortable==null?V3.base.clean(data.sortable):String(sortable),
      suspicious:suspiciousDimensions(data.dimensions)
    };
  };
  const parseProduct=html=>{
    const doc=V3.base.parseHtml(html);
    const table=doc.querySelector('.a-box-group .a-keyvalue')||
      [...doc.querySelectorAll('table')].find(t=>{const labels=[...t.querySelectorAll('th')].map(th=>V3.base.lower(th.textContent));return labels.includes('asin')||labels.includes('isbn')||labels.includes('fnsku');})||
      doc.querySelector('.a-keyvalue');
    if(!table)return null;
    const data={};
    for(const row of table.querySelectorAll('tr')){
      const th=row.querySelector('th'),td=row.querySelector('td');if(!th||!td)continue;
      data[V3.base.lower(th.textContent)]=V3.base.clean(td.querySelector('a')?.textContent||td.textContent);
    }
    data.img=(doc.querySelector('.a-box-group img')||doc.querySelector('img'))?.getAttribute('src')||'';
    const product=normalizeProduct(data);
    return product.primary||product.fnsku||product.fcsku?product:null;
  };
  const indexes=table=>{
    const headers=[...table.querySelectorAll('thead th')].map(th=>({id:V3.base.lower(th.id),text:V3.base.lower(String(th.textContent||'').replace(/\(\d+\)/g,''))}));
    const find=(...names)=>headers.findIndex(h=>names.includes(h.id)||names.includes(h.text));
    return{container:find('inventory-container','container'),asin:find('inventory-asin','asin'),fnsku:find('inventory-fnsku','fnsku'),fcsku:find('inventory-fcsku','fcsku'),lpn:find('inventory-lpn','lpn'),qty:find('inventory-quantity','quantity'),disposition:find('inventory-disposition','disposition'),consumer:find('inventory-consumer','consumer'),consumerId:find('inventory-consumer-id','consumer id','consumerid'),outerLocation:find('inventory-outer-location','outer location'),outerLocationType:find('inventory-outer-location-type','outer location type'),title:find('inventory-title','title')};
  };
  const parseInventory=doc=>{
    const table=doc.querySelector('#table-inventory');if(!table)throw new Error('Inventory table not returned');
    const idx=indexes(table),rows=[];
    for(const tr of table.tBodies?.[0]?.rows||[]){
      const val=i=>i>=0?V3.base.clean(tr.cells[i]?.textContent):'';
      const row={container:val(idx.container),asin:val(idx.asin),fnsku:val(idx.fnsku),fcsku:val(idx.fcsku),lpn:val(idx.lpn),qty:Number(val(idx.qty).replace(/[^\d.-]/g,''))||0,disposition:val(idx.disposition),consumer:val(idx.consumer),consumerId:val(idx.consumerId),outerLocation:val(idx.outerLocation),outerLocationType:val(idx.outerLocationType),title:val(idx.title)};
      if(row.asin||row.fnsku||row.fcsku)rows.push(row);
    }
    return rows;
  };
  const token=doc=>{const raw=V3.base.clean(doc?.querySelector('.pagination-token')?.textContent);return raw&&/^(?:\{|\[)/.test(raw)?raw:'';};

  function create({telemetry,life}={}){
    const inFlight=new Map();
    const post=async(endpoint,fields)=>{
      const params=new URLSearchParams();for(const [k,v] of Object.entries(fields||{}))params.set(k,String(v??''));
      const key=endpoint+'|'+params.toString();
      if(inFlight.has(key))return inFlight.get(key);
      const work=(async()=>{
        let retry=0;
        while(true){
          try{
            const r=await V3.api.fetchRequest(apiBase()+'/'+endpoint,{method:'POST',body:params.toString(),headers,timeout:15000,allowHtml:true,telemetry,signal:life?.signal});
            return r.raw;
          }catch(error){
            const status=Number(error?.status||0);
            if(!(status>=500&&status<600)||retry>=2)throw error;
            await life.sleep([120,350][retry++]||350);
          }
        }
      })();
      inFlight.set(key,work);try{return await work;}finally{if(inFlight.get(key)===work)inFlight.delete(key);}
    };
    const product=async code=>parseProduct(await post('product',{s:V3.base.clean(code)}));
    const inventory=async(code,{allowPartial=false,onPreview}={})=>{
      const started=performance.now();
      const first=await post('inventory',{s:V3.base.clean(code)});
      const doc=V3.base.parseHtml(first),table=doc.querySelector('#table-inventory');
      if(!table)throw new Error('Inventory table not returned');
      const tbody=table.tBodies?.[0]||table.appendChild(doc.createElement('tbody'));
      const expected=table.tHead?.rows?.[0]?.cells?.length||0;
      const seen=new Set();let next=token(doc),pages=1,complete=true,warning='';
      if(onPreview)onPreview({rows:parseInventory(doc),complete:!next,pages:1});
      while(next){
        if(seen.has(next)){complete=false;warning='inventory pagination repeated token';if(!allowPartial)throw new Error('Inventory incomplete: '+warning);break;}
        if(pages>=200){complete=false;warning='inventory pagination safety limit reached';if(!allowPartial)throw new Error('Inventory incomplete: '+warning);break;}
        seen.add(next);
        try{
          const html=await post('inventory-more',{token:next});pages++;
          const more=V3.base.parseHtml(html);
          const tableMore=more.querySelector('#table-inventory')||more.querySelector('table');
          const rows=tableMore?[...tableMore.querySelectorAll('tbody tr')].filter(row=>!expected||row.cells.length>=expected):[];
          if(!rows.length&&token(more)){complete=false;warning='pagination returned no usable rows';if(!allowPartial)throw new Error('Inventory incomplete: '+warning);break;}
          for(const row of rows)tbody.appendChild(doc.importNode(row,true));
          next=token(more);
        }catch(error){
          complete=false;warning=String(error?.message||error);if(!allowPartial)throw new Error('Inventory incomplete: '+warning);break;
        }
      }
      const rows=parseInventory(doc),partialQuantity=rows.reduce((sum,row)=>sum+(Number(row.qty)||0),0);
      telemetry?.emit('fcr.inventory',{search:V3.telemetry.mask(code),pages,rows:rows.length,complete,ms:Math.round(performance.now()-started)});
      return{rows,pages,complete,warning,totalQuantity:complete?partialQuantity:null,partialQuantity};
    };
    return Object.freeze({post,product,inventory});
  }
  return Object.freeze({create,warehouse,apiBase,parseProduct,parseInventory});
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

// ---- src/services/sideline.js ----
V3.sideline = (() => {
  const ORIGIN='https://aft-poirot-website-nrt.nrt.proxy.amazon.com';
  const TOOL='V3';
  const API={
    bootstrap:'/api/get-bootstrap-data',
    source:'/api/scan-source-container',
    item:'/api/scanitem',
    move:'/api/move-items',
    close:'/api/close-container'
  };
  const requestId=()=>{
    const id=crypto.randomUUID?.()||(Date.now()+'-'+Math.random().toString(16).slice(2));
    return 'amzn1.fc.v1.common.request-id.v1.AFTPoirotWebsite.'+id;
  };
  const sourcePayload=container=>({containerScannableId:container,requestId:requestId(),tool:TOOL});
  const itemPayload=(source,barcode)=>({
    containerScannableId:source,itemBarcode:barcode,isMasterpack:null,itemAndonContext:null,
    requestId:requestId(),tool:TOOL
  });
  const closePayload=(container,empty)=>({
    containerScannableId:container,containerEmpty:empty===true,directedLabel:false,
    processPath:'UNDETERMINED',requestId:requestId(),tool:TOOL
  });

  const problemLabels=response=>(Array.isArray(response?.problems)?response.problems:[])
    .filter(Boolean).map(problem=>V3.base.clean(
      problem?.description||problem?.message||problem?.reason||problem?.code||problem?.['@type']||''
    )).filter(Boolean);
  const hazmatRejected=response=>{
    if(!response||typeof response!=='object')return false;
    const filter=response.filterResult||{},reason=filter.reason||{},responseReason=response.reason||{},problems=(response.problems||[]).filter(Boolean);
    const labels=[
      response.message,response.description,response.errorMessage,response.errorCode,
      typeof response.reason==='string'?response.reason:'',
      responseReason.type,responseReason.description,responseReason.message,responseReason['@type'],
      reason.type,reason.description,reason.message,reason['@type'],filter.filterType,
      ...problems.flatMap(p=>[p?.description,p?.message,p?.reason,p?.code,p?.['@type']])
    ].map(V3.base.clean).filter(Boolean);
    if(!labels.some(label=>/hazmat|dangerous.?goods/i.test(label)))return false;
    return response.success===false||filter.compatible===false||problems.length>0||
      Boolean(response.errorMessage||response.errorCode)||/error|reject|incompat|filter/i.test(V3.base.clean(response?.['@type']));
  };
  const hasPredicant=value=>{
    if(value==null)return false;
    if(typeof value==='string')return /predicant/i.test(value);
    if(Array.isArray(value))return value.some(hasPredicant);
    if(typeof value!=='object')return false;
    return Object.entries(value).some(([key,child])=>{
      if(/predicant/i.test(key)){
        if(child===true)return true;
        if(typeof child==='string'&&child&&!/^false$/i.test(child))return true;
      }
      return hasPredicant(child);
    });
  };
  const damagedDestination=response=>{
    const filter=response?.filterResult,reason=filter?.reason;
    if(filter?.compatible!==false)return false;
    return reason?.containerDamaged===true||
      V3.base.lower(reason?.['@type'])==='damageditemsfilterresultreason'||
      /damageditemsfilter/i.test(V3.base.clean(filter?.filterType));
  };
  const overageLabel=value=>/\boverage(?:s)?\b|\bitem\s+not\s+in\s+(?:source\s+)?container\b|\bnot\s+in\s+source\s+container\b/i.test(V3.base.clean(value));
  const benignOverage=value=>{
    const label=V3.base.clean(value);
    return !label||overageLabel(label)||/^(?:bad request|conflict|request failed|http\s*[45]\d\d|[45]\d\d)$/i.test(label);
  };
  const allowedOverage=response=>{
    if(!response||typeof response!=='object')return false;
    const type=V3.base.clean(response?.['@type']);
    if(type==='InvalidBarcodeResponse'||type==='RequestMultipleBarcodesResponse')return false;
    if(hazmatRejected(response)||hasPredicant(response)||damagedDestination(response))return false;
    const filter=response.filterResult;
    const filterReason=V3.base.clean(filter?.reason?.type||filter?.reason?.description||filter?.reason?.message||filter?.reason?.['@type']||filter?.filterType||'');
    if(filter?.compatible===false&&!overageLabel(filterReason))return false;
    const problems=problemLabels(response);
    if(problems.some(label=>!overageLabel(label)))return false;
    const diagnostics=[response.message,response.description,response.errorMessage,response.errorCode,filterReason,...problems].map(V3.base.clean).filter(Boolean);
    if(!(overageLabel(type)||diagnostics.some(overageLabel)))return false;
    if(diagnostics.some(label=>!benignOverage(label)))return false;
    return !/hazmat|dangerous.?goods|invalid\s+barcode|incompatib|damaged|predicant|customer\s*bound/i.test([type,...diagnostics].join(' '));
  };
  const resolveItem=(response,barcode)=>{
    const type=V3.base.clean(response?.['@type']),overage=allowedOverage(response);
    if(!response||type==='InvalidBarcodeResponse'||(response.success===false&&!overage)){
      return{ok:false,invalid:type==='InvalidBarcodeResponse',type:type||'Unknown'};
    }
    const records=(Array.isArray(response.items)?response.items:[]).filter(record=>record?.skuDetail);
    const item=records[0]||null,sku=item?.skuDetail;
    if(!item||!sku)return{ok:false,invalid:false,type:type||'Unknown'};
    return{
      ok:true,type,barcode,item,records,sku,
      asin:V3.base.clean(sku.asin),fnsku:V3.base.clean(sku.fnSku),fcsku:V3.base.clean(sku.fcSku),
      dateType:V3.base.clean(sku.datelotDetail?.expirationPromptType),dateDetail:sku.datelotDetail||{},
      hazmat:sku.hazmat===true,
      permissionLevel:V3.base.upper(sku.itemDropzoneRecommendation?.permissionLevel),
      overage,
      notInSource:type==='ItemNotInContainerResponse'||records.every(record=>Number(record.quantity)===0)
    };
  };
  const responseText=response=>[
    response?.['@type'],response?.message,response?.description,response?.errorMessage,response?.errorCode,
    response?.filterResult?.filterType,response?.filterResult?.reason?.type,response?.filterResult?.reason?.description,
    response?.filterResult?.reason?.message,...problemLabels(response)
  ].map(V3.base.clean).filter(Boolean).join(' ');
  const classify=(response,code)=>{
    const ctx=resolveItem(response,code),text=responseText(response);
    if(/damaged/i.test(text))return{kind:'red',reason:'DAMAGED / INCOMPATIBLE',ctx};
    if(hazmatRejected(response))return{kind:'red',reason:'HAZMAT / DANGEROUS GOODS',ctx};
    if(!ctx.ok){
      const type=V3.base.clean(ctx.type);
      const reason=ctx.invalid?'INVALID BARCODE':type==='RequestMultipleBarcodesResponse'?'MULTIPLE BARCODE MATCHES':(type&&type!=='Unknown'?type:'NO ITEM DETAILS');
      return{kind:'red',reason,ctx};
    }
    if(ctx.permissionLevel==='UNDER_REVIEW')return{kind:'red',reason:'ASIN UNDER REVIEW — RIVER REQUIRED',ctx};
    if(ctx.dateType==='EXPIRATION_DATE'||ctx.dateType==='PRODUCTION_DATE'){
      return{kind:'yellow',reason:ctx.dateType==='PRODUCTION_DATE'?'PRODUCTION DATE':'EXPIRY DATE',ctx};
    }
    return{kind:'green',reason:'GOOD TO GO',ctx};
  };
  const movePayload=(source,destination,sourceMeta,ctx,qty=1,expirationMs=null)=>({
    itemExternalId:null,
    sourceContainerScannableId:source,
    destinationContainerScannableId:destination,
    scannableId:V3.base.clean(ctx.item.scannableId||ctx.barcode),
    quantity:String(Math.max(1,Number(qty)||1)),
    itemDetails:(ctx.records?.length?ctx.records:[ctx.item]).map(record=>{
      const sku=record.skuDetail||ctx.sku;
      return{
        fcsku:V3.base.clean(sku.fcSku),
        quantity:Number.isFinite(Number(record.quantity))?Number(record.quantity):0,
        consumerType:record.consumer??null,disposition:record.disposition??null,
        referenceId:record.referenceId??null,fnsku:V3.base.clean(sku.fnSku)
      };
    }),
    foundProblems:[null,null,null],
    scannedSourceContainerAsDestination:false,
    datelotDetail:ctx.sku.datelotDetail||null,
    userEnteredExpirationDate:expirationMs,
    mlcCaptureDetail:{
      mlcClass:ctx.sku.mlcDetail?.mlcClass??'UNKNOWN',userEnteredLotCode:null,
      mlcMissing:ctx.sku.mlcDetail?.mlcMissing??false,mlcNotEnteredReason:null,mlcCaptureMethod:null
    },
    itemMovedToISS:false,candidatePurchaseOrders:[],packHierarchyDetail:null,itemAndonContext:null,
    processPath:sourceMeta?.processPath??'UNDETERMINED',requestId:requestId(),tool:TOOL
  });
  const moveReason=response=>{
    if(!response)return'EMPTY MOVE RESPONSE';
    if(hazmatRejected(response))return'HAZMAT';
    if(allowedOverage(response))return'OVERAGE';
    if(damagedDestination(response))return'DESTINATION DAMAGED';
    if(hasPredicant(response))return'PREDICANT';
    const reason=response.filterResult?.reason;
    if(response.filterResult?.compatible===false)return V3.base.upper(reason?.type)||'DESTINATION INCOMPATIBLE';
    const problems=problemLabels(response);if(problems.length)return problems.join(', ');
    const type=V3.base.clean(response?.['@type']);
    return type&&type!=='MoveItemsResponse'?type.replace(/Response$/,''):'MOVE REJECTED';
  };

  function create(options={}){
    const telemetry=options.telemetry;
    const life=options.life;
    const hazmatCache=new Map();
    let warehousePromise=null;
    const request=async(path,body,opts={})=>{
      const operation=opts.operation;
      return V3.api.gmRequest(ORIGIN+path,{
        method:'POST',data:JSON.stringify(body),headers:{'content-type':'application/json'},
        timeout:opts.timeout||15000,mutation:Boolean(operation),operation,telemetry,
        allowHttpError:opts.allowHttpError===true
      });
    };
    const warehouse=async()=>{
      if(warehousePromise)return warehousePromise;
      warehousePromise=(async()=>{
        try{
          const result=await V3.api.gmRequest(ORIGIN+API.bootstrap+'?tool='+encodeURIComponent(TOOL),{timeout:8000,telemetry});
          const info=result.data?.warehouseInfo;
          const candidate=V3.base.upper((typeof info==='string'?info:'')||info?.warehouseId||info?.id||info?.warehouse||info?.fc||info?.code||result.data?.warehouseId);
          if(candidate)return candidate;
        }catch{}
        const fromPath=V3.fcr?.warehouse?.()||'';
        return V3.base.upper(fromPath||'BWU2');
      })();
      return warehousePromise;
    };
    const pandash=async asinValue=>{
      const asin=V3.base.upper(asinValue),fc=await warehouse();
      if(!/^B[A-Z0-9]{9}$/.test(asin)||!fc)throw new Error('HAZMAT LOOKUP CONTEXT MISSING');
      const key=fc+'|'+asin;if(hazmatCache.has(key))return hazmatCache.get(key);
      const boot=await V3.api.gmRequest('https://pandash.amazon.com/GridServlet?fc='+encodeURIComponent(fc),{timeout:8000,telemetry});
      const restriction=V3.base.clean(boot.data?.restriction||'default')||'default';
      const body='language=default&source='+encodeURIComponent(restriction)+'-hazmat-FC&marketPlaces=AU&asins='+encodeURIComponent(asin)+'&rows=1&page=1&fc='+encodeURIComponent(fc);
      const result=await V3.api.gmRequest('https://pandash.amazon.com/GridServlet',{
        method:'POST',data:body,headers:{'Content-Type':'application/x-www-form-urlencoded'},timeout:8000,telemetry
      });
      const row=Array.isArray(result.data?.rows)?result.data.rows.find(item=>V3.base.upper(item?.asin)===asin):null;
      if(!row)throw new Error('NO PANDASH RESULT');
      const answer={asin,level:Number(row.level||0),message:V3.base.clean(row.message),allowed:/can be processed/i.test(V3.base.clean(row.message))};
      hazmatCache.set(key,answer);return answer;
    };
    const validateSource=async container=>{
      const code=V3.base.clean(container);if(!V3.base.validContainer(code))throw new Error('Source must be tsX/csX');
      const result=await request(API.source,sourcePayload(code));
      const payload=result.data;
      const customer=/customer\s*bound\s*shipment/i.test(JSON.stringify(payload||{}));
      if(customer)throw new Error('CUSTOMER-BOUND SHIPMENT');
      if(V3.base.clean(payload?.['@type'])!=='ScanSourceContainerResponse'||payload?.success!==true){
        throw new Error(V3.base.clean(payload?.message||payload?.description||payload?.errorMessage||payload?.['@type'])||'SOURCE VALIDATION FAILED');
      }
      return payload;
    };
    const preflight=async(source,barcode)=>{
      const code=V3.base.clean(barcode);
      const result=await request(API.item,itemPayload(source,code),{allowHttpError:true});
      const base=classify(result.data,code);
      if(base.ctx?.ok&&base.ctx.hazmat===true&&base.kind!=='red'){
        try{
          const haz=await pandash(base.ctx.asin);
          if(!haz.allowed)return{kind:'red',reason:'HAZMAT L'+haz.level+' — NOT PROCESSABLE',ctx:base.ctx,hazmat:haz};
          return{...base,reason:base.kind==='yellow'?base.reason:'HAZMAT L'+haz.level+' — OK TO PROCESS',hazmat:haz};
        }catch(error){
          return{kind:'retry',reason:'HAZMAT CHECK FAILED — '+V3.base.clean(error?.message||error),ctx:base.ctx};
        }
      }
      return base;
    };
    const move=async({source,destination,sourceMeta,preflightResult,qty=1,expirationMs=null})=>{
      const ctx=preflightResult?.ctx;if(!ctx?.ok)throw new Error('Item context is not moveable');
      const operation=V3.operation.create({kind:'sideline-move',ref:ctx.barcode,telemetry});
      const result=await request(API.move,movePayload(source,destination,sourceMeta,ctx,qty,expirationMs),{operation,allowHttpError:true,timeout:15000});
      const payload=result.data;
      if(!payload||typeof payload!=='object'){
        operation.unknown({reason:'unexpected-confirmation'});
        throw new V3.operation.OutcomeUnknownError('Unexpected move confirmation');
      }
      if(allowedOverage(payload)||(payload.success===true&&payload.filterResult?.compatible!==false&&!hazmatRejected(payload)&&!hasPredicant(payload))){
        operation.confirmed({status:result.status,qty});return payload;
      }
      const reason=moveReason(payload);
      operation.rejected({reason,status:result.status});
      const error=new V3.operation.RejectedError(reason,{data:payload});
      if(hasPredicant(payload)||damagedDestination(payload))error.recoverable=true;
      throw error;
    };
    const close=async(container,empty=true)=>{
      const code=V3.base.clean(container);if(!V3.base.validContainer(code))throw new Error('Container must be tsX/csX');
      const operation=V3.operation.create({kind:'sideline-close',ref:code,telemetry});
      const result=await request(API.close,closePayload(code,empty),{operation,allowHttpError:true,timeout:15000});
      const payload=result.data;
      if(result.status>=200&&result.status<300&&V3.base.clean(payload?.['@type'])==='CloseContainerResponse'&&payload?.success===true){
        operation.confirmed();return payload;
      }
      operation.unknown({status:result.status,reason:'not-confirmed'});
      throw new V3.operation.OutcomeUnknownError('Close NOT CONFIRMED — verify container before retry');
    };
    const expirationFromDate=(ctx,dateValue)=>{
      const entered=new Date(String(dateValue)+'T00:00:00').getTime();
      if(!Number.isFinite(entered))throw new Error('Invalid date');
      if(ctx.dateType==='PRODUCTION_DATE')return{enteredMs:entered,finalExpirationMs:entered+Number(ctx.dateDetail?.shelfLife||0)};
      return{enteredMs:entered,finalExpirationMs:entered};
    };
    return Object.freeze({validateSource,preflight,move,close,warehouse,pandash,expirationFromDate});
  }
  return Object.freeze({create,resolveItem,classify,allowedOverage,hazmatRejected,hasPredicant,damagedDestination,moveReason});
})();

// ---- src/suites/fcr/native.js ----
V3.fcrNative = (() => {
  function create(options){
    const life=options.life,client=options.client,telemetry=options.telemetry,shell=options.shell;
    const settings=V3.storage.create('fcr.native');
    const floorCache=V3.storage.create('fcr.floorCache');
    const state={code:new URLSearchParams(location.search).get('s')||'',loading:false,product:null,inventory:null,error:'',message:'Ready',floors:new Map(),floorRunning:false};

    const conflicts=rows=>{
      const groups=new Map();
      for(const row of rows||[]){
        const container=V3.base.upper(row.container),fnsku=V3.base.upper(row.fnsku),fcsku=V3.base.upper(row.fcsku);
        if(!container||!fnsku||!fcsku)continue;
        const key=container+'\u0000'+fnsku;
        if(!groups.has(key))groups.set(key,{container,fnsku,fcskus:new Set(),rows:[]});
        const group=groups.get(key);group.fcskus.add(fcsku);group.rows.push(row);
      }
      return [...groups.values()].filter(group=>group.fcskus.size>1);
    };
    const hierarchyUrl=pod=>{
      const url=new URL(location.href);url.search='';url.hash='';
      url.pathname=url.pathname.replace(/\/$/,'')+'/container-hierarchy';
      url.searchParams.set('s',pod);return url.href;
    };
    const parseFloor=html=>{
      const doc=V3.base.parseHtml(html);
      const cell=doc.querySelector('div.a-span6:nth-child(1) > table:nth-child(1) > tbody:nth-child(1) > tr:nth-child(4) > td:nth-child(2)');
      const raw=V3.base.clean(cell?.textContent).split(',')[0];
      const num=raw.match(/\b(\d+)\b/)?.[1]||'';
      return num?'P'+num:'PX';
    };
    const resolveFloor=async pod=>{
      const cached=floorCache.read(V3.base.upper(pod),null);
      if(cached.ok&&cached.value&&Date.now()-Number(cached.at||0)<30*60*1000)return cached.value;
      let last='PX';
      for(let attempt=0;attempt<2;attempt++){
        try{
          const result=await V3.api.fetchRequest(hierarchyUrl(pod),{timeout:8000,allowHtml:true,telemetry,signal:life.signal});
          last=parseFloor(result.raw);if(last!=='PX')break;
        }catch(error){telemetry.emit('bin.floor.error',{pod:V3.telemetry.mask(pod),attempt,message:String(error?.message||error)});}
        if(attempt===0)await life.sleep(350);
      }
      floorCache.set(V3.base.upper(pod),last);return last;
    };
    async function resolveFloors(){
      if(state.floorRunning||!state.inventory)return;
      state.floorRunning=true;state.floors.clear();render();
      const pods=[...new Set((state.inventory.rows||[]).map(row=>V3.base.clean(row.container).match(/\bP-\d-(?:[A-Z]\d{3}){2}\b/i)?.[0]?.toUpperCase()).filter(Boolean))];
      let cursor=0;
      const worker=async()=>{
        while(cursor<pods.length){
          const pod=pods[cursor++],floor=await resolveFloor(pod);state.floors.set(pod,floor);render();
        }
      };
      await Promise.all(Array.from({length:Math.min(6,pods.length)},worker));
      state.floorRunning=false;telemetry.emit('bin.floor.done',{pods:pods.length});render();
    }
    async function load(){
      const code=V3.base.clean(shell.body.querySelector('[data-code]')?.value||state.code);
      if(!code)return;
      state.code=code;state.loading=true;state.error='';state.message='Loading…';state.product=null;state.inventory=null;state.floors.clear();render();
      const [productResult,inventoryResult]=await Promise.allSettled([client.product(code),client.inventory(code,{allowPartial:false})]);
      if(productResult.status==='fulfilled')state.product=productResult.value;
      else telemetry.emit('fcr.product.error',{search:V3.telemetry.mask(code),message:String(productResult.reason?.message||productResult.reason)});
      if(inventoryResult.status==='fulfilled')state.inventory=inventoryResult.value;
      else telemetry.emit('fcr.inventory.error',{search:V3.telemetry.mask(code),message:String(inventoryResult.reason?.message||inventoryResult.reason)});
      state.loading=false;
      if(!state.product&&!state.inventory){
        state.error='No usable product/inventory data';state.message='Unavailable';
      }else state.message='Loaded';
      render();
    }
    const print=async(code,title='')=>{
      try{await V3.print.barcode(code,{description:title,telemetry});state.message='Printed '+code;}
      catch(error){state.error='Print failed: '+String(error?.message||error);}render();
    };
    async function moveContainer(){
      if(!V3.base.validContainer(state.code))throw new Error('Current search is not a tsX/csX container');
      const floor=shell.body.querySelector('[data-floor]')?.value||'P2';
      const type=shell.body.querySelector('[data-drop]')?.value||'PRIME';
      const dest=V3.moveContainer.destination(floor,type);if(!dest)throw new Error('No destination');
      state.message='Moving '+state.code+' → '+dest;render();
      try{await V3.moveContainer.move(state.code,dest,{telemetry});state.message='MOVED → '+dest;}
      catch(error){state.error=(error?.outcome==='unknown'?'OUTCOME UNKNOWN — VERIFY · ':'')+String(error?.message||error);}
      render();
    };
    function render(){
      const root=document.createElement('div'),product=state.product,rows=state.inventory?.rows||[],dupes=conflicts(rows);
      root.innerHTML=
        '<section class="v3-section"><h3>FCResearch</h3>'+
          '<label class="v3-field">Search<input data-code value="'+V3.base.esc(state.code)+'" autocomplete="off"></label>'+
          '<div class="v3-row"><button class="v3-btn primary" data-load>'+(state.loading?'LOADING…':'LOAD')+'</button>'+
          (rows.length?'<button class="v3-btn" data-floors>'+(state.floorRunning?'RESOLVING…':'P-LEVELS')+'</button>':'')+'</div>'+
          '<div class="v3-note" style="margin-top:7px">'+V3.base.esc(state.message)+(state.error?' · '+V3.base.esc(state.error):'')+'</div>'+
        '</section>'+
        (product?'<section class="v3-section"><h3>'+V3.base.esc(product.title||product.primary||'Product')+'</h3>'+
          '<div class="v3-grid">'+
            [['ASIN',product.asin],['FNSKU',product.fnsku],['FCSKU',product.fcsku],['Sortable',product.sortableText],['Dimensions',product.dimensions],['Weight',product.weight]].map(([label,value])=>
              '<div class="v3-note"><b>'+label+'</b><br>'+(value?'<button class="v3-btn" data-print="'+V3.base.esc(value)+'">'+V3.base.esc(value)+'</button>':'—')+'</div>'
            ).join('')+
          '</div>'+(product.suspicious?'<div class="v3-note" style="color:var(--v3-warn);margin-top:8px"><b>SUSPICIOUS DIMENSIONS</b></div>':'')+
        '</section>':'')+
        (V3.base.validContainer(state.code)?'<section class="v3-section"><h3>Move container</h3><div class="v3-grid">'+
          '<label class="v3-field">Floor<select data-floor>'+V3.moveContainer.FLOORS.map(f=>'<option>'+f+'</option>').join('')+'</select></label>'+
          '<label class="v3-field">Drop<select data-drop></select></label></div><button class="v3-btn" data-move>MOVE '+V3.base.esc(state.code)+'</button></section>':'')+
        (dupes.length?'<section class="v3-section"><h3 style="color:var(--v3-bad)">FCSKU CONFLICTS · '+dupes.length+'</h3>'+
          '<div class="v3-list">'+dupes.map(group=>'<div class="v3-item" data-state="attention"><span>'+V3.base.esc(group.container)+'<br><small>'+V3.base.esc(group.fnsku)+'</small></span><b>'+V3.base.esc([...group.fcskus].join(' + '))+'</b></div>').join('')+'</div></section>':'')+
        (rows.length?'<section class="v3-section"><h3>Inventory · '+rows.length+' rows · '+(state.inventory?.totalQuantity??'?')+' units</h3><div class="v3-list">'+rows.map(row=>{
          const pod=V3.base.clean(row.container).match(/\bP-\d-(?:[A-Z]\d{3}){2}\b/i)?.[0]?.toUpperCase()||'';
          const floor=pod?(state.floors.get(pod)||'…'):'';
          return'<div class="v3-item"><span>'+V3.base.esc(row.container||'—')+(floor?' · '+floor:'')+'<br><small>'+V3.base.esc(row.fnsku||row.fcsku||row.asin||'')+'</small></span><b>'+Number(row.qty||0)+'</b></div>';
        }).join('')+'</div></section>':'');
      shell.setContent(root);
      const input=shell.body.querySelector('[data-code]');
      input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();load();}};
      shell.body.querySelector('[data-load]').onclick=load;
      shell.body.querySelector('[data-floors]')?.addEventListener('click',resolveFloors);
      for(const button of shell.body.querySelectorAll('[data-print]')){
        const code=button.dataset.print;
        if(!/^(?:B0[A-Z0-9]{8}|X0[A-Z0-9]{8}|ZZ[A-Z0-9]{8})$/i.test(code))button.disabled=true;
        else button.onclick=()=>print(code,product?.title||'');
      }
      const floor=shell.body.querySelector('[data-floor]'),drop=shell.body.querySelector('[data-drop]');
      const paintDrops=()=>{
        if(!drop||!floor)return;
        drop.innerHTML=V3.moveContainer.choices(floor.value).map(([name])=>'<option>'+V3.base.esc(name)+'</option>').join('');
      };
      if(floor){floor.value=settings.get('floor','P2');floor.onchange=()=>{settings.set('floor',floor.value);paintDrops();};paintDrops();}
      shell.body.querySelector('[data-move]')?.addEventListener('click',moveContainer);
    }
    return Object.freeze({render,load,state});
  }
  return Object.freeze({create});
})();

// ---- src/suites/fcr/tote.js ----
V3.fcrTote = (() => {
  function create(options){
    const life=options.life,client=options.client,telemetry=options.telemetry,shell=options.shell;
    const state={
      container:'',loading:false,rows:[],lookup:new Map(),pending:[],
      scans:new Map(),error:'',message:'Scan container',loadSeq:0
    };

    const buildLookup=rows=>{
      const map=new Map();
      for(const row of rows){
        row._v3Scanned=0;
        for(const code of [row.asin,row.fnsku,row.fcsku]){
          const key=V3.base.upper(code);if(!key)continue;
          if(!map.has(key))map.set(key,[]);
          map.get(key).push(row);
        }
      }
      return map;
    };
    const matchesFor=(product,raw)=>{
      const rawKey=V3.base.upper(raw);
      const strict=/^(?:X0|ZZ)[A-Z0-9]{8}$/.test(rawKey);
      const keys=(strict?[rawKey]:[
        rawKey,product?.asin,product?.isbn,product?.primary,product?.fnsku,product?.fcsku
      ]).map(V3.base.upper).filter(Boolean);
      const out=[],seen=new Set();
      for(const key of keys){
        for(const row of state.lookup.get(key)||[]){
          const id=[row.asin,row.fnsku,row.fcsku,row.disposition,row.consumer].map(V3.base.upper).join('|');
          if(seen.has(id))continue;seen.add(id);out.push(row);
        }
      }
      return out;
    };
    const allocate=(rows,amount=1)=>{
      let remaining=Math.max(0,Number(amount)||0);
      for(const row of rows||[]){
        if(remaining<=0)break;
        const qty=Math.max(0,Number(row.qty)||0),current=Math.max(0,Number(row._v3Scanned)||0);
        const add=Math.min(Math.max(0,qty-current),remaining);
        row._v3Scanned=current+add;remaining-=add;
      }
    };
    const coverage=()=>{
      const totalUnits=state.rows.reduce((sum,row)=>sum+(Number(row.qty)||0),0);
      const scannedUnits=state.rows.reduce((sum,row)=>sum+(Number(row._v3Scanned)||0),0);
      const keys=new Set(state.rows.map(row=>V3.base.upper(row.fnsku||row.fcsku||row.asin)).filter(Boolean));
      const scannedKeys=new Set(state.rows.filter(row=>Number(row._v3Scanned)>0).map(row=>V3.base.upper(row.fnsku||row.fcsku||row.asin)).filter(Boolean));
      return{totalUnits,scannedUnits,totalSkus:keys.size,scannedSkus:scannedKeys.size};
    };
    async function loadContainer(code){
      const container=V3.base.clean(code);
      if(!V3.base.validContainer(container))throw new Error('Container must be tsX/csX');
      const seq=++state.loadSeq;
      state.container=container;state.loading=true;state.rows=[];state.lookup=new Map();state.pending=[];state.scans.clear();
      state.error='';state.message='Loading full inventory · scans may queue';render();
      try{
        const result=await client.inventory(container,{
          allowPartial:false,
          onPreview:preview=>{if(seq===state.loadSeq){state.message='Inventory page '+preview.pages+' loading…';render();}}
        });
        if(seq!==state.loadSeq)return;
        if(!result.complete)throw new Error('Inventory incomplete');
        state.rows=result.rows;state.lookup=buildLookup(result.rows);state.loading=false;
        state.message=container+' ready · '+result.rows.length+' rows';
        telemetry.emit('tote.loaded',{container:V3.telemetry.mask(container),rows:result.rows.length,total:result.totalQuantity});
        const queued=state.pending.splice(0);
        render();
        for(const scan of queued)await handleScan(scan);
      }catch(error){
        if(seq!==state.loadSeq)return;
        state.loading=false;state.error=String(error?.message||error);state.message='Inventory failed';render();
      }
    }
    async function handleScan(value){
      const raw=V3.base.clean(value);if(!raw)return;
      if(!state.container){await loadContainer(raw);return;}
      if(V3.base.validContainer(raw)&&V3.base.upper(raw)!==V3.base.upper(state.container)){
        await loadContainer(raw);return;
      }
      if(state.loading){state.pending.push(raw);state.message='Queued '+state.pending.length+' scan'+(state.pending.length===1?'':'s');render();return;}

      const key=V3.base.upper(raw);
      const existing=state.scans.get(key);
      if(existing){
        existing.count++;allocate(existing.matches,1);state.message=raw+' ×'+existing.count+' rescanned';render();return;
      }

      const record={raw,count:1,state:'checking',matches:[],product:null,error:''};
      state.scans.set(key,record);state.message='Checking '+raw;render();
      try{
        let product=null;
        try{product=await client.product(raw);}catch(error){telemetry.emit('tote.product.error',{code:V3.telemetry.mask(raw),message:String(error?.message||error)});}
        const matches=matchesFor(product,raw);
        record.product=product;record.matches=matches;
        if(matches.length){
          record.state='found';allocate(matches,1);state.message='✓ '+raw+' IN '+state.container;
        }else{
          record.state='missing';state.message='✕ '+raw+' NOT IN '+state.container;
        }
        telemetry.emit('tote.scan',{code:V3.telemetry.mask(raw),found:Boolean(matches.length),matches:matches.length});
      }catch(error){
        record.state='error';record.error=String(error?.message||error);state.message='Check failed '+raw;
      }
      render();
    }
    const reset=()=>{
      state.loadSeq++;state.container='';state.loading=false;state.rows=[];state.lookup=new Map();state.pending=[];state.scans.clear();state.error='';state.message='Scan container';render();
    };
    function render(){
      const stats=coverage(),root=document.createElement('div');
      root.innerHTML=
        '<section class="v3-section"><h3>Tote Audit</h3>'+
          '<div class="v3-note">'+V3.base.esc(state.container||'NO CONTAINER')+' · '+stats.scannedSkus+'/'+stats.totalSkus+' SKU · '+stats.scannedUnits+'/'+stats.totalUnits+' units</div>'+
          '<label class="v3-field">Scanner<input data-scan autocomplete="off" placeholder="'+(state.container?'Scan item barcode':'Scan tsX / csX')+'"></label>'+
          '<div class="v3-row"><button class="v3-btn" data-reset>NEW TOTE</button></div>'+
          '<div class="v3-note" style="margin-top:7px">'+V3.base.esc(state.message)+(state.error?' · '+V3.base.esc(state.error):'')+'</div>'+
        '</section>'+
        '<section class="v3-section"><h3>Physical scans</h3><div class="v3-list" data-scans></div></section>'+
        '<section class="v3-section"><h3>System inventory</h3><div class="v3-list" data-system></div></section>';
      const scans=root.querySelector('[data-scans]');
      for(const record of [...state.scans.values()].reverse()){
        const row=document.createElement('div');row.className='v3-item';
        row.dataset.state=record.state==='found'?'done':record.state==='checking'?'active':record.state==='missing'||record.state==='error'?'attention':'';
        const qty=record.matches.reduce((sum,r)=>sum+(Number(r.qty)||0),0);
        const checked=Math.min(record.count,qty||record.count);
        row.innerHTML='<button class="v3-btn" data-print style="text-align:left">'+V3.base.esc(record.raw)+(record.count>1?' ×'+record.count:'')+'</button>'+
          '<b>'+(record.state==='found'?'IN '+state.container+(qty>1?' '+checked+'/'+qty:''):record.state.toUpperCase())+'</b>';
        row.querySelector('[data-print]').onclick=async()=>{
          try{
            await V3.print.barcode(record.raw,{description:record.product?.title||'',quantity:1,telemetry});
            state.message='Printed '+record.raw;render();
          }catch(error){state.message='Print failed: '+String(error?.message||error);render();}
        };
        scans.appendChild(row);
      }
      const sys=root.querySelector('[data-system]');
      for(const row of state.rows){
        const item=document.createElement('div');item.className='v3-item';item.dataset.state=Number(row._v3Scanned)>0?'done':'';
        item.innerHTML='<span>'+V3.base.esc(row.fnsku||row.fcsku||row.asin||'—')+
          '<br><small>'+V3.base.esc(row.title||row.asin||'')+'</small></span>'+
          '<b>'+Number(row._v3Scanned||0)+'/'+Number(row.qty||0)+'</b>';
        sys.appendChild(item);
      }
      shell.setContent(root);
      const scan=shell.body.querySelector('[data-scan]');
      scan.onkeydown=async event=>{
        if(event.key!=='Enter')return;event.preventDefault();
        const value=scan.value;scan.value='';await handleScan(value);scan.focus({preventScroll:true});
      };
      shell.body.querySelector('[data-reset]').onclick=reset;
    }
    return Object.freeze({render,handleScan,reset,state});
  }
  return Object.freeze({create});
})();

// ---- src/suites/fcr/iss.js ----
V3.fcrIss = (() => {
  function create(options){
    const life=options.life,shell=options.shell,telemetry=options.telemetry;
    const settings=V3.storage.create('fcr.iss');
    let tab=settings.get('tab','sideline');
    if(!['sideline','move','edit','fcsku'].includes(tab))tab='sideline';
    let busy=false,stopRequested=false,lastMessage='';
    const qtyHistory=[];
    const aft=V3.aft.create({
      origin:'https://aft-qt-jp.aka.nrt.corp.amazon.com',
      telemetry,life,stopped:()=>stopRequested
    });
    const workflows=V3.aftWorkflows.create({
      client:aft,telemetry,stopped:()=>stopRequested,
      onProgress:(message,data)=>{setStatus(message,'work');telemetry.emit('iss.progress',{tab,message,...data});},
      onQuantity:value=>{
        qtyHistory.push({...value,at:Date.now()});
        if(qtyHistory.length>12)qtyHistory.shift();
        render();
      }
    });
    const sideline=V3.sideline.create({telemetry,life});
    const side={
      source:'',destination:'',text:'',lookups:new Map(),generation:0,active:0,queue:[],
      running:false,paused:false,clearSource:settings.get('side.clearSource',true)!==false,
      delay:settings.get('side.delay',true)!==false,message:'',lastOutcome:'',dateCache:new Map(),skipped:new Map(),
      workflowExpirationMs:null,workflowDone:false,attention:''
    };
    let preflightTimer=0;

    const setStatus=(text,tone='')=>{shell.setStatus(text,tone);lastMessage=String(text||'');};
    const parseSideItems=()=>{
      const counts=new Map();
      for(const line of String(side.text||'').split(/\r?\n/)){
        const code=V3.base.clean(line.split(/\s+/)[0]);if(!code)continue;
        const key=V3.base.upper(code),entry=counts.get(key)||{code,qty:0};entry.qty++;counts.set(key,entry);
      }
      return [...counts.values()];
    };
    const lookupKey=(source,code)=>V3.base.upper(source)+'|'+V3.base.upper(code);
    const resetPreflight=()=>{
      side.generation++;side.lookups.clear();side.queue=[];side.active=0;
      side.dateCache.clear();side.skipped.clear();side.workflowExpirationMs=null;
    };
    const setSource=value=>{
      const next=V3.base.clean(value);
      if(V3.base.upper(next)!==V3.base.upper(side.source)){side.source=next;side.workflowDone=false;resetPreflight();}
      else side.source=next;
    };
    const queuePreflight=()=>{
      if(side.running||!V3.base.validContainer(side.source))return;
      const gen=side.generation;
      for(const item of parseSideItems()){
        const key=lookupKey(side.source,item.code);
        if(side.lookups.has(key))continue;
        const entry={key,code:item.code,generation:gen,state:'queued',result:null,error:''};
        side.lookups.set(key,entry);side.queue.push(entry);
      }
      pumpPreflight();
    };
    const pumpPreflight=()=>{
      while(!side.running&&side.active<5&&side.queue.length){
        const entry=side.queue.shift();
        if(!entry||entry.generation!==side.generation||side.lookups.get(entry.key)!==entry)continue;
        side.active++;entry.state='checking';render();
        sideline.preflight(side.source,entry.code).then(result=>{
          if(entry.generation!==side.generation||side.lookups.get(entry.key)!==entry)return;
          entry.result=result;entry.state=result?.kind||'retry';
          if(result?.kind==='red')side.skipped.set(V3.base.upper(entry.code),result.reason||'NOT PROCESSING');
          if(result?.kind==='retry')entry.error=result.reason||'LOOKUP FAILED — RETRY';
        }).catch(error=>{
          if(entry.generation!==side.generation)return;
          entry.state='retry';entry.error='LOOKUP FAILED — '+String(error?.message||error);
        }).finally(()=>{
          side.active=Math.max(0,side.active-1);pumpPreflight();render();
        });
      }
    };
    const schedulePreflight=()=>{
      if(preflightTimer)clearTimeout(preflightTimer);
      preflightTimer=setTimeout(()=>{preflightTimer=0;queuePreflight();},80);
    };
    const settlePreflight=async()=>{
      queuePreflight();
      const started=Date.now();
      while(side.active||side.queue.length){
        if(Date.now()-started>30000)throw new Error('Preflight did not settle');
        await life.sleep(60);
      }
      const items=parseSideItems();
      for(const item of items){
        const entry=side.lookups.get(lookupKey(side.source,item.code));
        if(!entry||entry.state==='checking'||entry.state==='queued')throw new Error('Preflight incomplete: '+item.code);
        if(entry.state==='retry')throw new Error(entry.error||'Preflight retry required: '+item.code);
        if(entry.state==='yellow'&&!side.dateCache.has(V3.base.upper(item.code)))throw new Error('Date required: '+item.code);
      }
      return items;
    };
    const randomDelay=()=>2000+Math.floor(Math.random()*6001);

    async function runSideline(){
      if(side.attention)throw new Error('ATTENTION BLOCKED — verify the unknown move, then clear attention');
      if(side.workflowDone){resetPreflight();side.workflowDone=false;}
      if(!V3.base.validContainer(side.source)||!V3.base.validContainer(side.destination))throw new Error('Source and destination must be tsX/csX');
      if(V3.base.upper(side.source)===V3.base.upper(side.destination))throw new Error('Source and destination cannot match');
      const items=await settlePreflight();
      const movable=items.filter(item=>!side.skipped.has(V3.base.upper(item.code)));
      if(!movable.length)throw new Error('All scanned items are ASIDE — nothing will move');
      side.running=true;side.paused=false;render();
      setStatus('Validating source','work');
      const sourceMeta=await sideline.validateSource(side.source);
      let moved=0,failed=0;
      for(let i=0;i<movable.length;i++){
        if(stopRequested)throw new Error('Stopped before next move');
        while(side.paused&&!stopRequested)await life.sleep(80);
        if(stopRequested)throw new Error('Stopped before next move');
        const item=movable[i],entry=side.lookups.get(lookupKey(side.source,item.code));
        if(i>0&&side.delay){
          const ms=randomDelay(),until=Date.now()+ms;
          while(Date.now()<until&&!stopRequested){
            setStatus('Pacing '+Math.max(1,Math.ceil((until-Date.now())/1000))+'s','work');
            await life.sleep(Math.min(150,Math.max(25,until-Date.now())));
          }
        }
        const chosen=side.dateCache.get(V3.base.upper(item.code));
        setStatus((i+1)+'/'+movable.length+' '+item.code+' ×'+item.qty,'work');
        try{
          await sideline.move({
            source:side.source,destination:side.destination,sourceMeta,
            preflightResult:entry.result,qty:item.qty,expirationMs:chosen?.finalExpirationMs??null
          });
          moved+=item.qty;
        }catch(error){
          if(error?.outcome==='unknown'){
            side.lastOutcome='OUTCOME UNKNOWN · '+item.code+' · VERIFY BEFORE RETRY';
            throw error;
          }
          failed+=item.qty;
          side.skipped.set(V3.base.upper(item.code),String(error?.message||error));
          if(error?.recoverable){
            side.lastOutcome='RUN PAUSED/STOPPED · '+String(error?.message||error)+' · change/verify destination manually';
            throw error;
          }
          telemetry.emit('sideline.rejected',{item:V3.telemetry.mask(item.code),reason:String(error?.message||error)});
        }
      }
      const skipped=items.reduce((sum,item)=>sum+(side.skipped.has(V3.base.upper(item.code))?item.qty:0),0);
      if(side.clearSource&&failed===0&&skipped===0){
        setStatus('Clearing source','work');
        await sideline.close(side.source,true);
      }
      side.lastOutcome='COMPLETE · moved '+moved+(failed?' · failed '+failed:'')+(skipped?' · aside '+skipped:'');
      side.workflowDone=true;
      setStatus(side.lastOutcome,failed||skipped?'warn':'');
      telemetry.emit('sideline.done',{moved,failed,skipped,clearSource:side.clearSource});
      return{moved,failed,skipped};
    }

    const runTask=task=>{
      if(busy)return;
      busy=true;stopRequested=false;setStatus('RUNNING','work');render();
      Promise.resolve().then(task).then(result=>{
        if(tab!=='sideline')setStatus('DONE','');
        lastMessage=tab==='sideline'?(side.lastOutcome||'DONE'):'DONE';
      }).catch(error=>{
        const unknown=error?.outcome==='unknown';
        if(tab==='sideline'&&unknown)side.attention='OUTCOME UNKNOWN — VERIFY BEFORE RETRY';
        lastMessage=(unknown?'OUTCOME UNKNOWN — VERIFY BEFORE RETRY · ':'')+String(error?.message||error);
        setStatus(unknown?'UNKNOWN':'STOPPED',unknown?'bad':'warn');
        telemetry.emit('iss.run.error',{tab,message:String(error?.message||error),unknown});
      }).finally(()=>{busy=false;side.running=false;side.paused=false;render();});
    };
    const stop=()=>{
      stopRequested=true;
      if(side.running)side.paused=false;
      setStatus('STOP REQUESTED','warn');
    };
    const stateOptions=selected=>['Sellable','Pending Research','Unsellable'].map(v=>'<option'+(v===selected?' selected':'')+'>'+v+'</option>').join('');
    const damageOptions=selected=>['Amazon Damage','Defective','Distributor Damage','Expired'].map(v=>'<option'+(v===selected?' selected':'')+'>'+v+'</option>').join('');

    function render(){
      const root=document.createElement('div');
      root.innerHTML='<section class="v3-section"><h3>ISS Console</h3><div class="v3-note" style="margin-bottom:8px">Sideline · MoveItems · EditItems · FCSKU Flip</div><div class="v3-row" style="flex-wrap:wrap">'+
        [['sideline','SIDELINE'],['move','MOVE'],['edit','EDIT'],['fcsku','FCSKU']].map(([id,label])=>
          '<button class="v3-btn'+(id===tab?' primary':'')+'" data-iss-tab="'+id+'">'+label+'</button>'
        ).join('')+'</div></section><div data-module></div>';
      shell.setContent(root);
      for(const button of shell.body.querySelectorAll('[data-iss-tab]'))button.onclick=()=>{
        if(busy)return;tab=button.dataset.issTab;settings.set('tab',tab);render();
      };
      const module=root.querySelector('[data-module]');
      if(tab==='sideline')renderSideline(module);
      else if(tab==='move')renderMove(module);
      else if(tab==='edit')renderEdit(module);
      else renderFcsku(module);
    }
    function commonControls(task){
      return'<div class="v3-row"><button class="v3-btn primary" data-run '+(busy?'disabled':'')+'>RUN</button>'+
        '<button class="v3-btn danger" data-stop>STOP AFTER CURRENT</button></div>'+
        (lastMessage?'<div class="v3-note" style="margin-top:7px;white-space:pre-wrap">'+V3.base.esc(lastMessage)+'</div>':'');
    }
    function wireCommon(host,task){
      host.querySelector('[data-run]').onclick=()=>runTask(task);
      host.querySelector('[data-stop]').onclick=stop;
    }
    function renderSideline(host){
      const items=parseSideItems(),counts={green:0,yellow:0,red:0,retry:0,checking:0};
      for(const item of items){
        const e=side.lookups.get(lookupKey(side.source,item.code));
        if(!e)counts.checking+=item.qty;
        else if(e.state in counts)counts[e.state]+=item.qty;
        else counts.checking+=item.qty;
      }
      host.innerHTML=
        '<section class="v3-section"><h3>Sideline</h3>'+
          '<div class="v3-grid"><label class="v3-field">Source<input data-side-source value="'+V3.base.esc(side.source)+'"></label>'+
          '<label class="v3-field">Destination<input data-side-dest value="'+V3.base.esc(side.destination)+'"></label></div>'+
          '<label class="v3-field">Item barcodes<textarea class="v3-input" data-side-items>'+V3.base.esc(side.text)+'</textarea></label>'+
          '<div class="v3-row" style="flex-wrap:wrap"><b style="color:var(--v3-ok)">'+counts.green+' GOOD</b><b style="color:var(--v3-warn)">'+counts.yellow+' DATE</b><b style="color:var(--v3-bad)">'+counts.red+' ASIDE</b><b>'+counts.retry+' RETRY</b><span>'+counts.checking+' CHECKING</span></div>'+
          '<div class="v3-row" style="margin-top:8px"><button class="v3-btn" data-clear-source>CLEAR SOURCE: '+(side.clearSource?'ON':'OFF')+'</button>'+
          '<button class="v3-btn" data-delay>DELAY 2–8s: '+(side.delay?'ON':'OFF')+'</button>'+
          (side.running?'<button class="v3-btn" data-pause>'+(side.paused?'RESUME':'PAUSE')+'</button>':'')+'</div>'+
          (side.attention?'<div class="v3-note" style="color:var(--v3-bad);margin-top:8px"><b>'+V3.base.esc(side.attention)+'</b><br><button class="v3-btn danger" data-ack style="margin-top:6px">I VERIFIED IT · CLEAR ATTENTION</button></div>':'')+
          commonControls(runSideline)+
        '</section>'+
        '<section class="v3-section"><h3>Preflight</h3><div class="v3-list" data-preflight></div></section>';
      const list=host.querySelector('[data-preflight]');
      for(const item of items){
        const key=V3.base.upper(item.code),entry=side.lookups.get(lookupKey(side.source,item.code));
        const row=document.createElement('div');row.className='v3-item';
        const stateName=entry?.state||'checking';
        row.dataset.state=stateName==='green'?'done':stateName==='yellow'?'active':stateName==='red'||stateName==='retry'?'attention':'active';
        const reason=entry?.result?.reason||entry?.error||(entry?'CHECKING':'QUEUED');
        row.innerHTML='<span>'+V3.base.esc(item.code)+' ×'+item.qty+'<br><small>'+V3.base.esc(reason)+'</small></span><b>'+stateName.toUpperCase()+'</b>';
        if(entry?.state==='yellow'){
          const date=side.dateCache.get(key);
          const controls=document.createElement('div');controls.style.gridColumn='1/-1';
          controls.innerHTML=date
            ? '<div class="v3-note">DATE '+new Date(date.enteredMs).toLocaleDateString()+' READY</div>'
            : '<div class="v3-row"><input type="date" data-date class="v3-input"><button class="v3-btn" data-apply>APPLY</button><button class="v3-btn danger" data-aside>MIXED DATE → ASIDE</button></div>';
          if(!date){
            controls.querySelector('[data-apply]').onclick=()=>{
              try{
                const value=controls.querySelector('[data-date]').value;
                const chosen=sideline.expirationFromDate(entry.result.ctx,value);
                if(side.workflowExpirationMs!=null&&side.workflowExpirationMs!==chosen.finalExpirationMs){
                  side.skipped.set(key,'MIXED EXPIRY — NEXT WORKFLOW');
                  entry.state='red';
                  entry.result={...entry.result,kind:'red',reason:'MIXED EXPIRY — NEXT WORKFLOW'};
                  render();return;
                }
                if(side.workflowExpirationMs==null)side.workflowExpirationMs=chosen.finalExpirationMs;
                side.dateCache.set(key,chosen);render();
              }catch(error){lastMessage=String(error.message||error);render();}
            };
            controls.querySelector('[data-aside]').onclick=()=>{side.skipped.set(key,'MIXED EXPIRY — NEXT WORKFLOW');entry.state='red';entry.result={...entry.result,kind:'red',reason:'MIXED EXPIRY — NEXT WORKFLOW'};render();};
          }
          row.appendChild(controls);
        }
        list.appendChild(row);
      }
      const src=host.querySelector('[data-side-source]'),dest=host.querySelector('[data-side-dest]'),text=host.querySelector('[data-side-items]');
      src.oninput=()=>{setSource(src.value);schedulePreflight();};
      dest.oninput=()=>{
        const next=V3.base.clean(dest.value);
        if(V3.base.upper(next)!==V3.base.upper(side.destination)){side.destination=next;side.workflowDone=false;resetPreflight();}
        else side.destination=next;
      };
      text.oninput=()=>{side.text=text.value;schedulePreflight();};
      host.querySelector('[data-clear-source]').onclick=()=>{side.clearSource=!side.clearSource;settings.set('side.clearSource',side.clearSource);render();};
      host.querySelector('[data-delay]').onclick=()=>{side.delay=!side.delay;settings.set('side.delay',side.delay);render();};
      host.querySelector('[data-pause]')?.addEventListener('click',()=>{side.paused=!side.paused;render();});
      host.querySelector('[data-ack]')?.addEventListener('click',()=>{side.attention='';side.workflowDone=false;resetPreflight();lastMessage='Attention cleared after verification';render();});
      const runButton=host.querySelector('[data-run]');if(runButton&&side.attention)runButton.disabled=true;
      wireCommon(host,runSideline);
      schedulePreflight();
    }
    function renderMove(host){
      host.innerHTML='<section class="v3-section"><h3>MoveItems</h3>'+
        '<label class="v3-field">Mode<select data-mode><option>ALL</option><option>EACH</option><option>QTY</option></select></label>'+
        '<label class="v3-field">QTY<input data-qty type="number" min="1" value="1"></label>'+
        '<label class="v3-field">Source<input data-source></label><label class="v3-field">Destination<input data-dest></label>'+
        '<label class="v3-field">Items<textarea class="v3-input" data-items></textarea></label>'+commonControls(()=>{})+'</section>';
      wireCommon(host,()=>workflows.move({
        source:host.querySelector('[data-source]').value,destination:host.querySelector('[data-dest]').value,
        items:V3.base.lines(host.querySelector('[data-items]').value,{dedupe:false}),
        qtyMode:host.querySelector('[data-mode]').value,quantity:Number(host.querySelector('[data-qty]').value)
      }));
    }
    function renderEdit(host){
      const mode=settings.get('editMode','sku');
      host.innerHTML='<section class="v3-section"><div class="v3-row"><button class="v3-btn '+(mode==='each'?'primary':'')+'" data-mode="each">EACH</button><button class="v3-btn '+(mode==='sku'?'primary':'')+'" data-mode="sku">SKU</button></div></section>'+
      (mode==='each'
        ? '<section class="v3-section"><h3>Edit EACH</h3><label class="v3-field">Location ASIN FNSKU rows<textarea class="v3-input" data-rows></textarea></label><div class="v3-grid"><label class="v3-field">Target<select data-target>'+stateOptions('Unsellable')+'</select></label><label class="v3-field">Disposition<select data-damage>'+damageOptions('Defective')+'</select></label></div>'+commonControls(()=>{})+'</section>'
        : '<section class="v3-section"><h3>Edit SKU</h3>'+
          '<div class="v3-row" style="margin-bottom:8px">'+(qtyHistory.slice(-3).map(q=>'<span class="v3-note">S '+(q.sellable??'—')+' · P '+(q.pending??'—')+' · U '+(q.unsellable??'—')+'</span>').join('')||'<span class="v3-note">Quantity history appears here.</span>')+'</div>'+
          '<label class="v3-field">SKU<input data-sku></label><div class="v3-grid"><label class="v3-field">Current<select data-current>'+stateOptions('Sellable')+'</select></label><label class="v3-field">Current disposition<select data-current-damage>'+damageOptions('Defective')+'</select></label><label class="v3-field">Desired<select data-desired>'+stateOptions('Unsellable')+'</select></label><label class="v3-field">Desired disposition<select data-desired-damage>'+damageOptions('Defective')+'</select></label></div>'+commonControls(()=>{})+'</section>');
      for(const b of host.querySelectorAll('[data-mode]'))b.onclick=()=>{if(busy)return;settings.set('editMode',b.dataset.mode);render();};
      if(mode==='each')wireCommon(host,()=>{
        const rows=String(host.querySelector('[data-rows]').value||'').split(/\r?\n/).map(V3.base.clean).filter(Boolean).map(line=>{const [location='',asin='',fnsku='']=line.split(/\s+/);return{location,asin,fnsku:fnsku||asin};});
        return workflows.editEach({rows,desiredState:host.querySelector('[data-target]').value,desiredDamage:host.querySelector('[data-damage]').value});
      });
      else wireCommon(host,()=>workflows.editSku({
        sku:host.querySelector('[data-sku]').value,currentState:host.querySelector('[data-current]').value,
        currentDamage:host.querySelector('[data-current-damage]').value,desiredState:host.querySelector('[data-desired]').value,
        desiredDamage:host.querySelector('[data-desired-damage]').value
      }));
    }
    function renderFcsku(host){
      host.innerHTML='<section class="v3-section"><h3>FCSKU Flip</h3><label class="v3-field">OLD<input data-old></label><label class="v3-field">NEW<input data-new></label><label class="v3-field">Locations<textarea class="v3-input" data-locations></textarea></label>'+commonControls(()=>{})+'</section>';
      wireCommon(host,()=>workflows.fcsku({
        oldCode:host.querySelector('[data-old]').value,newCode:host.querySelector('[data-new]').value,
        locations:V3.base.lines(host.querySelector('[data-locations]').value)
      }));
    }
    return Object.freeze({render,state:side});
  }
  return Object.freeze({create});
})();

// ---- src/suites/fcr/river.js ----
V3.fcrRiver = (() => {
  const KEY='bwu2.v3.river.payload.v1';
  const WORKFLOW_Q0='3654ec14-7232-4f65-84c3-87927cdb4d0c';
  const WORKFLOW_ID='0dbb253e-c43a-4a8b-a316-e32b8ab9be21';

  const norm=value=>V3.base.lower(value).replace(/[^a-z0-9]+/g,' ').trim();
  const code=value=>V3.base.upper(value).replace(/[^A-Z0-9]/g,'');
  const visible=element=>{
    if(!element?.isConnected)return false;
    const rect=element.getBoundingClientRect(),style=getComputedStyle(element);
    return rect.width>0&&rect.height>0&&style.display!=='none'&&style.visibility!=='hidden';
  };
  const tableHeaders=table=>{
    const wrapper=table?.closest('.dataTables_wrapper,.dataTables_scroll')||table?.parentElement;
    const headerTable=wrapper?.querySelector('.dataTables_scrollHead table')||table;
    return [...headerTable?.querySelectorAll('thead th,thead td')||[]].map(node=>norm(node.textContent));
  };
  const columnIndex=(headers,...names)=>headers.findIndex(header=>names.some(name=>header===norm(name)||header.startsWith(norm(name)+' ')));
  const numericCell=value=>{
    const text=V3.base.clean(value).replace(/,/g,'');
    if(!/^-?\d+(?:\.\d+)?$/.test(text))return null;
    const number=Number(text);return Number.isFinite(number)&&number>=0?number:null;
  };
  const parseDate=value=>{
    const text=V3.base.clean(value);if(!text)return Number.NEGATIVE_INFINITY;
    const iso=text.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if(iso){const[,y,m,d,h='0',mm='0',s='0']=iso;return Date.UTC(+y,+m-1,+d,+h,+mm,+s);}
    const dmy=text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if(dmy){const[,d,m,y,h='0',mm='0',s='0']=dmy;return Date.UTC(+y,+m-1,+d,+h,+mm,+s);}
    const parsed=Date.parse(text);return Number.isFinite(parsed)?parsed:Number.NEGATIVE_INFINITY;
  };
  const shortVendor=value=>{
    const tokens=(V3.base.clean(value).match(/[A-Z0-9]+/gi)||[]).map(x=>x.toUpperCase());
    return tokens.find(x=>x.length>=2&&x.length<=5&&x!=='FBA')||tokens.find(x=>x.length===6&&x!=='FBA')||'';
  };
  const purchaseOrderDetails=doc=>{
    const table=doc.querySelector('#table-purchase-order');if(!table)return new Map();
    const headers=tableHeaders(table),poIndex=columnIndex(headers,'purchase order','po'),dateIndex=columnIndex(headers,'placed','confirmed','order date','date');
    const details=new Map();if(poIndex<0)return details;
    [...table.querySelectorAll('tbody tr')].forEach((row,rowIndex)=>{
      const cells=[...row.children].filter(cell=>cell.matches?.('td,th'));
      const purchaseOrder=V3.base.clean(cells[poIndex]?.textContent);if(!purchaseOrder||/no matching records/i.test(purchaseOrder))return;
      const placed=dateIndex>=0?V3.base.clean(cells[dateIndex]?.textContent):'',timestamp=parseDate(placed),key=code(purchaseOrder),previous=details.get(key);
      if(!previous||timestamp>previous.timestamp)details.set(key,{purchaseOrder,placed,timestamp,rowIndex});
    });
    return details;
  };
  const purchaseOrderRows=doc=>{
    const table=doc.querySelector('#table-purchase-order-item');if(!table)return[];
    const headers=tableHeaders(table),idx={
      po:columnIndex(headers,'purchase order','po'),sku:columnIndex(headers,'sku','fnsku','asin'),
      vendor:columnIndex(headers,'vendor code','seller id'),unfilled:columnIndex(headers,'unfilled'),
      cancelled:columnIndex(headers,'canceled','cancelled'),received:columnIndex(headers,'received'),
      title:columnIndex(headers,'title'),date:columnIndex(headers,'order date','placed','date')
    };
    if(idx.po<0||idx.sku<0)return[];
    return [...table.querySelectorAll('tbody tr')].map((row,rowIndex)=>{
      const cells=[...row.children].filter(cell=>cell.matches?.('td,th')),po=V3.base.clean(cells[idx.po]?.textContent);
      if(!po||/no matching records/i.test(po))return null;
      return{
        purchaseOrder:po,sku:V3.base.clean(cells[idx.sku]?.textContent),
        vendorRaw:idx.vendor>=0?V3.base.clean(cells[idx.vendor]?.textContent):'',
        unfilled:idx.unfilled>=0?numericCell(cells[idx.unfilled]?.textContent):null,
        cancelled:idx.cancelled>=0?numericCell(cells[idx.cancelled]?.textContent):null,
        received:idx.received>=0?numericCell(cells[idx.received]?.textContent):null,
        title:idx.title>=0?V3.base.clean(cells[idx.title]?.textContent):'',
        timestamp:idx.date>=0?parseDate(cells[idx.date]?.textContent):Number.NEGATIVE_INFINITY,
        rowIndex,rowText:V3.base.clean(row.textContent)
      };
    }).filter(Boolean);
  };
  const selectPo=(itemDoc,detailDoc,identity)=>{
    const rows=purchaseOrderRows(itemDoc),details=purchaseOrderDetails(detailDoc),wanted=[identity.search,identity.asin,identity.fnsku].map(code).filter(Boolean),candidates=[];
    for(const row of rows){
      const sku=code(row.sku),rowText=code(row.rowText);let strength=0,by='';
      if(sku&&wanted.includes(sku)){strength=3;by=sku===code(identity.fnsku)?'fnsku':sku===code(identity.asin)?'asin':'search';}
      else{
        const embedded=wanted.find(value=>value.length>=8&&rowText.includes(value));
        if(embedded){strength=2;by=embedded===code(identity.fnsku)?'fnsku-row':embedded===code(identity.asin)?'asin-row':'search-row';}
        else if(identity.title&&row.title&&norm(identity.title)===norm(row.title)){strength=1;by='title-exact';}
      }
      if(!strength)continue;
      const detail=details.get(code(row.purchaseOrder)),detailTime=detail?.timestamp??Number.NEGATIVE_INFINITY;
      const timestamp=Math.max(row.timestamp,detailTime);
      candidates.push({...row,strength,by,timestamp});
    }
    if(!candidates.length)return{state:'unavailable',reason:'no-matching-po-line'};
    const dated=candidates.filter(x=>Number.isFinite(x.timestamp)&&x.timestamp!==Number.NEGATIVE_INFINITY);
    if(!dated.length&&candidates.length>1)return{state:'ambiguous',reason:'multiple-matching-po-lines-without-dates',candidates:candidates.length};
    const pool=dated.length?dated:candidates;pool.sort((a,b)=>b.timestamp-a.timestamp||b.strength-a.strength||a.rowIndex-b.rowIndex);
    const selected=pool[0],parts=[selected.unfilled,selected.cancelled,selected.received],known=parts.every(Number.isFinite),quantity=known?parts.reduce((a,b)=>a+b,0):null;
    return{
      state:'available',purchaseOrder:selected.purchaseOrder,vendorCode:shortVendor(selected.vendorRaw)||'N/A',
      quantity:Number.isFinite(quantity)&&quantity>0?quantity:null,
      quantityMode:Number.isFinite(quantity)&&quantity>0?'po-line-total':known?'zero-po-total':'missing-po-components',
      matchBy:selected.by,candidateCount:candidates.length
    };
  };
  const riverUrl=warehouse=>{
    const url=new URL('https://river.amazon.com/'+encodeURIComponent(warehouse)+'/workflows');
    url.searchParams.set('buildingType','fc');url.searchParams.set('q0',WORKFLOW_Q0);url.searchParams.set('q1',WORKFLOW_ID);url.searchParams.set('id',WORKFLOW_ID);
    return url.href;
  };

  function createCapture(options){
    const shell=options.shell,client=options.client,telemetry=options.telemetry;
    let busy=false,last=typeof GM_getValue==='function'?GM_getValue(KEY,null):null;

    async function capture(){
      if(busy)return;busy=true;shell.setStatus('CAPTURING','work');render();
      try{
        const search=V3.base.clean(new URLSearchParams(location.search).get('s')||shell.body.querySelector('[data-river-code]')?.value);
        if(!search)throw new Error('Search an item in FCResearch first');
        const [product,inventory,itemHtml,poHtml]=await Promise.all([
          client.product(search),
          client.inventory(search,{allowPartial:false}),
          client.post('purchase-order-item',{s:search}),
          client.post('purchase-order',{s:search})
        ]);
        if(!product)throw new Error('Product details unavailable');
        const itemDoc=V3.base.parseHtml(itemHtml),poDoc=V3.base.parseHtml(poHtml);
        const po=selectPo(itemDoc,poDoc,{search,asin:product.asin,fnsku:product.fnsku,title:product.title});
        const warehouse=V3.fcr.warehouse()||'BWU2';
        last={
          asin:product.asin||'N/A',fnsku:product.fnsku||'N/A',title:product.title||'N/A',
          purchaseOrder:po.state==='available'?po.purchaseOrder:'N/A',
          vendorCode:po.state==='available'?po.vendorCode:'N/A',
          poLineQuantity:po.state==='available'?po.quantity:null,
          poQuantityMode:po.state==='available'?po.quantityMode:po.reason,
          liveInventoryQuantity:inventory.totalQuantity,
          inventoryCost:product.inventoryCost||'N/A',physicalLocation:'TBD',shipmentsImpacted:0,
          sourceSearch:search,sourceUrl:location.href,warehouseId:warehouse,riverUrl:riverUrl(warehouse),
          capturedAt:Date.now(),build:V3.build.id
        };
        last.quantityDisagreement=Number.isFinite(last.poLineQuantity)&&Number.isFinite(last.liveInventoryQuantity)&&last.poLineQuantity!==last.liveInventoryQuantity;
        if(typeof GM_setValue==='function')GM_setValue(KEY,last);
        telemetry.emit('river.capture',{
          search:V3.telemetry.mask(search),poQuantity:last.poLineQuantity,liveQuantity:last.liveInventoryQuantity,
          disagreement:last.quantityDisagreement,poMode:last.poQuantityMode
        });
        shell.setStatus(last.quantityDisagreement?'QTY DISAGREES':'READY',last.quantityDisagreement?'warn':'');
      }catch(error){
        shell.setStatus('CAPTURE ERROR','bad');telemetry.emit('river.capture.error',{message:String(error?.message||error)});last={error:String(error?.message||error)};
      }finally{busy=false;render();}
    }
    function openRiver(){
      if(!last?.riverUrl)return;
      if(typeof GM_openInTab==='function')GM_openInTab(last.riverUrl,{active:true,insert:true,setParent:true});
      else window.open(last.riverUrl,'_blank','noopener');
    }
    function render(){
      const root=document.createElement('div'),po=last?.poLineQuantity,live=last?.liveInventoryQuantity;
      root.innerHTML='<section class="v3-section"><h3>RIVER Capture</h3>'+
        '<label class="v3-field">Current item<input data-river-code value="'+V3.base.esc(last?.sourceSearch||new URLSearchParams(location.search).get('s')||'')+'"></label>'+
        '<div class="v3-row"><button class="v3-btn primary" data-capture>'+(busy?'CAPTURING…':'CAPTURE')+'</button><button class="v3-btn" data-open '+(!last?.riverUrl?'disabled':'')+'>OPEN RIVER</button></div>'+
        (last?.error?'<div class="v3-note" style="color:var(--v3-bad);margin-top:8px">'+V3.base.esc(last.error)+'</div>':'')+
        (last&&!last.error?'<div class="v3-grid" style="margin-top:9px">'+
          '<div class="v3-note"><b>FNSKU</b><br>'+V3.base.esc(last.fnsku)+'</div>'+
          '<div class="v3-note"><b>PO</b><br>'+V3.base.esc(last.purchaseOrder)+'</div>'+
          '<div class="v3-note"><b>PO qty</b><br>'+(po??'N/A')+'</div>'+
          '<div class="v3-note"><b>Live inventory</b><br>'+(live??'N/A')+'</div></div>'+
          (last.quantityDisagreement?'<div class="v3-note" style="color:var(--v3-warn);margin-top:8px"><b>QUANTITY DISAGREEMENT — RIVER will pause on Severity.</b></div>':''):'')+
        '</section>';
      shell.setContent(root);
      root.querySelector('[data-capture]').onclick=capture;
      root.querySelector('[data-open]').onclick=openRiver;
    }
    return Object.freeze({render,capture});
  }

  function bootRiverHost(options){
    const life=options.life,telemetry=options.telemetry;
    const shell=V3.ui.createShell({id:'bwu2-v3-river',title:'BWU2 V3 RIVER',subtitle:'Manual-assisted',version:V3.build.version,life,tabs:[]});
    V3.screenshot.install({life,roots:[shell.host]});
    let generation=0,busy=false,watcher=null,lastPage='',severityChoice=null;
    const payload=()=>typeof GM_getValue==='function'?GM_getValue(KEY,null):null;
    const associatedLabel=element=>{
      if(!(element instanceof Element))return'';
      const explicit=V3.base.clean(element.getAttribute('aria-label')||element.getAttribute('title')||'');if(explicit)return explicit;
      if(element.id){try{const label=document.querySelector('label[for="'+CSS.escape(element.id)+'"]');if(label)return V3.base.clean(label.textContent);}catch{}}
      return V3.base.clean(element.closest('label')?.textContent||element.closest('fieldset')?.querySelector('legend')?.textContent||'');
    };
    const field=aliases=>{
      const wanted=aliases.map(norm);
      for(const element of document.querySelectorAll('input,textarea,select')){
        if(!visible(element))continue;
        const context=norm([element.name,element.id,element.placeholder,element.getAttribute('aria-label'),associatedLabel(element)].filter(Boolean).join(' '));
        if(wanted.some(value=>context.includes(value)))return element;
      }
      return null;
    };
    const setter=element=>{
      let proto=element;while((proto=Object.getPrototypeOf(proto))){const d=Object.getOwnPropertyDescriptor(proto,'value');if(d?.set)return d.set;}return null;
    };
    const setValue=async(element,value)=>{
      if(!element||!visible(element)||element.matches?.(':disabled')||element.readOnly)return false;
      const next=String(value??'');element.focus({preventScroll:true});await new Promise(r=>requestAnimationFrame(r));
      const set=setter(element);if(set)set.call(element,next);else element.value=next;
      const inputEvent=typeof InputEvent==='function'?new InputEvent('input',{bubbles:true,composed:true,data:next,inputType:'insertText'}):new Event('input',{bubbles:true,composed:true});
      element.dispatchEvent(inputEvent);element.dispatchEvent(new Event('change',{bubbles:true,composed:true}));element.blur();
      await new Promise(r=>requestAnimationFrame(r));return V3.base.clean(element.value)===V3.base.clean(next);
    };
    const nextButton=()=>[...document.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"]')]
      .filter(visible).find(candidate=>norm(candidate.innerText||candidate.textContent||candidate.value||candidate.getAttribute('aria-label')||'')==='next')||null;
    const label=()=>V3.base.clean(document.querySelector('page-info[label]')?.getAttribute('label')||[...document.querySelectorAll('h1,h2,h3,h4,[role="heading"],legend')].find(visible)?.textContent||'');
    const pageKind=()=>{
      const text=norm(label()),route=(location.pathname+' '+location.search+' '+location.hash).toLowerCase();
      if(text.includes('pandash')||/pandash|dangerous|dg review/.test(route))return'pandash';
      if(text.includes('related')&&(text.includes('tt')||text.includes('ticket'))||/related.?tt/.test(route))return'related';
      if(text.includes('information')||field(['physical location of the units','inventory cost per unit','vendor code / seller id']))return'information';
      if(text.includes('sortab')||/sortab/.test(route))return'sortability';
      if(text.includes('severity')||field(['units impacted','shipments impacted']))return'severity';
      if(text.includes('image')||/image/.test(route))return'images';
      if(text.includes('create issue')||/create.?issue/.test(route))return'create';
      if(text==='asin'||text.includes('asin check')||text.includes('enter asin')||field(['type asin here']))return'asin';
      if(text.includes('issue')&&text.includes('fc')||/issue.?at.?fc/.test(route))return'issue';
      return'unknown';
    };
    const waitFields=async(aliasesList,timeout=8000)=>{
      const started=Date.now();
      while(Date.now()-started<timeout){
        const fields=aliasesList.map(aliases=>field(aliases));
        if(fields.every(el=>el&&visible(el)&&!el.matches?.(':disabled')&&!el.readOnly))return fields;
        await life.sleep(100);
      }
      throw new Error('RIVER fields did not become ready');
    };
    const chooseUnits=p=>{
      const po=Number(p?.poLineQuantity),live=Number(p?.liveInventoryQuantity),poOk=Number.isFinite(po)&&po>0,liveOk=Number.isFinite(live)&&live>0;
      if(poOk&&liveOk&&po!==live)return{value:null,reason:'PO qty '+po+' ≠ live inventory '+live};
      if(poOk&&liveOk)return{value:po,reason:'PO and live agree'};
      if(liveOk)return{value:live,reason:'live inventory only'};
      if(poOk)return{value:po,reason:'PO quantity only'};
      return{value:null,reason:'No positive quantity available'};
    };
    const manual=message=>{shell.setStatus('MANUAL','warn');render(message);return{wait:false};};

    async function applySeverityChoice(value,source){
      const qty=Number(value);
      if(!Number.isInteger(qty)||qty<0){
        severityChoice={...(severityChoice||{}),error:'Enter a whole number 0 or greater'};
        render('SEVERITY quantity needs review');
        return false;
      }
      const units=field(['units impacted','number of units impacted']);
      const shipments=field(['shipments impacted','number of shipments impacted']);
      if(!units||!shipments){
        severityChoice={...(severityChoice||{}),error:'RIVER Severity fields are not ready'};
        render('SEVERITY quantity needs review');
        return false;
      }
      const unitsOk=await setValue(units,qty);
      const shipmentsOk=await setValue(shipments,0);
      if(!unitsOk||!shipmentsOk){
        severityChoice={...(severityChoice||{}),error:'RIVER did not retain the selected quantity'};
        render('SEVERITY quantity needs review');
        return false;
      }
      severityChoice={...(severityChoice||{}),selected:qty,source,error:''};
      shell.setStatus('FILLED · REVIEW + NEXT','');
      telemetry.emit('river.severity.choice',{value:qty,source});
      render('Units impacted = '+qty+' ('+source+'). Review it, then click RIVER Next.');
      armWatch('severity');
      return true;
    }
    async function drive(reason='RUN',gen=generation){
      if(gen!==generation)return;
      const p=payload();if(!p)return manual('No V3 FCResearch capture. Capture the item first.');
      const page=pageKind();lastPage=page;telemetry.emit('river.step',{page,label:label(),reason});
      shell.setStatus(page.toUpperCase(),'work');render(reason+' · '+(label()||page));
      if(page==='unknown')return manual('Workflow step not recognised yet. Wait for the page, then RUN again.');
      if(['pandash','issue','sortability','images'].includes(page)){
        return manual(page.toUpperCase()+' choice stays manual in preliminary V3. Select the correct option, click Next, and V3 will resume.');
      }
      if(page==='related')return manual('Related TT review stays manual. Complete the step and click Next.');
      if(page==='create')return manual('DONE · final Create Issue submission remains manual.');
      if(page==='asin'){
        const asin=p.asin&&p.asin!=='N/A'?p.asin:'';
        if(!asin)return manual('Captured ASIN unavailable — enter manually.');
        const el=field(['type asin here','asin']);if(!el||!await setValue(el,asin))throw new Error('ASIN field did not retain');
        nextButton()?.click();return{wait:true};
      }
      if(page==='information'){
        const values=[
          [['x0 asin','x00 asin / fnsku','x00 asin','fnsku','asin/fnsku'],p.fnsku||'N/A'],
          [['purchase order','po'],p.purchaseOrder||'N/A'],
          [['vendor code / seller id','vendor code','seller id'],p.vendorCode||'N/A'],
          [['inventory cost per unit','inventory cost','cost per unit'],p.inventoryCost||'N/A'],
          [['physical location of the units','physical location','location'],p.physicalLocation||'TBD'],
          [['asin title','product title','title'],p.title||'N/A']
        ];
        const fields=await waitFields(values.map(x=>x[0]));
        for(let i=0;i<values.length;i++){
          if(gen!==generation)return;
          if(!await setValue(fields[i],values[i][1]))throw new Error('Information field did not retain: '+values[i][0][0]);
        }
        const next=nextButton();
        if(!next||next.matches?.(':disabled')||next.getAttribute('aria-disabled')==='true')return manual('Information values entered, but Next is not enabled. Review fields manually.');
        next.click();return{wait:true};
      }
      if(page==='severity'){
        const selected=chooseUnits(p);
        const shipments=field(['shipments impacted','number of shipments impacted']);
        if(!selected.value){
          if(shipments)await setValue(shipments,0);
          severityChoice={
            po:Number.isFinite(Number(p?.poLineQuantity))?Number(p.poLineQuantity):null,
            live:Number.isFinite(Number(p?.liveInventoryQuantity))?Number(p.liveInventoryQuantity):null,
            reason:selected.reason,
            selected:null,
            source:'',
            error:''
          };
          return manual('SEVERITY quantity needs review · '+selected.reason);
        }
        severityChoice=null;
        const units=field(['units impacted','number of units impacted']);
        if(!await setValue(units,selected.value)||!await setValue(shipments,0))throw new Error('Severity fields did not retain');
        const next=nextButton();if(!next)return manual('Severity filled ('+selected.reason+'), but Next not found.');
        next.click();return{wait:true};
      }
      return manual('Unhandled RIVER step: '+page);
    }
    const clearWatch=()=>{watcher?.disconnect();watcher=null;};
    const armWatch=previous=>{
      clearWatch();const gen=generation,root=document.body||document.documentElement;
      if(!root)return;
      let timer=0;
      watcher=life.observe(root,()=>{
        clearTimeout(timer);timer=setTimeout(()=>{
          if(gen!==generation)return clearWatch();
          const current=pageKind();if(current==='unknown'||current===previous)return;
          clearWatch();void run('Step changed');
        },120);
      },{childList:true,subtree:true,attributes:true,attributeFilter:['label','id','name','role','aria-label','data-step','data-state','disabled']});
    };
    async function run(reason='RUN'){
      if(busy)return;busy=true;const gen=generation;
      try{
        const before=pageKind(),result=await drive(reason,gen);
        if(gen===generation&&result?.wait)armWatch(before);else clearWatch();
      }catch(error){
        clearWatch();shell.setStatus('WAITING','warn');render(String(error?.message||error));
        telemetry.emit('river.error',{page:pageKind(),message:String(error?.message||error)});
      }finally{busy=false;}
    }
    function render(message=''){
      const p=payload(),units=chooseUnits(p);
      const root=document.createElement('div');
      const severityHtml=severityChoice
        ? '<section class="v3-section"><h3>Units impacted</h3>'+
          '<div class="v3-note"><b>'+V3.base.esc(severityChoice.reason||'Choose quantity')+'</b></div>'+
          '<div class="v3-grid" style="margin-top:9px">'+
            (severityChoice.po!=null?'<button class="v3-btn'+(severityChoice.source==='PO'?' primary':'')+'" data-severity-po style="min-height:58px"><b style="font-size:20px">'+severityChoice.po+'</b><br><small>PO LINE</small></button>':'')+
            (severityChoice.live!=null?'<button class="v3-btn'+(severityChoice.source==='LIVE'?' primary':'')+'" data-severity-live style="min-height:58px"><b style="font-size:20px">'+severityChoice.live+'</b><br><small>LIVE INVENTORY</small></button>':'')+
          '</div>'+
          '<div class="v3-row" style="margin-top:9px"><input class="v3-input" data-severity-manual type="number" min="0" step="1" placeholder="Manual qty"><button class="v3-btn" data-severity-apply>APPLY MANUAL</button></div>'+
          (severityChoice.selected!=null?'<div class="v3-note" style="color:var(--v3-ok);margin-top:8px"><b>FILLED: '+severityChoice.selected+' · '+V3.base.esc(severityChoice.source)+'</b><br>Review RIVER, then click Next.</div>':'')+
          (severityChoice.error?'<div class="v3-note" style="color:var(--v3-bad);margin-top:8px"><b>'+V3.base.esc(severityChoice.error)+'</b></div>':'')+
        '</section>'
        : '';
      root.innerHTML='<section class="v3-section"><h3>RIVER Assistant</h3>'+
        '<div class="v3-note">Item: <b>'+V3.base.esc(p?.fnsku||p?.asin||'NO CAPTURE')+'</b></div>'+
        (p?'<div class="v3-grid" style="margin-top:8px"><div class="v3-note"><b>PO qty</b><br>'+(p.poLineQuantity??'N/A')+'</div><div class="v3-note"><b>Live qty</b><br>'+(p.liveInventoryQuantity??'N/A')+'</div></div>':'')+
        '<div class="v3-note" style="margin-top:8px">'+V3.base.esc(message||('Current: '+(label()||pageKind())))+'</div>'+
        (p&&p.quantityDisagreement?'<div class="v3-note" style="color:var(--v3-warn);margin-top:6px"><b>QUANTITY DISAGREEMENT — choose below.</b></div>':'')+
        '<div class="v3-row" style="margin-top:9px"><button class="v3-btn primary" data-run>RUN</button><button class="v3-btn danger" data-clear>CLEAR</button></div></section>'+
        severityHtml;
      shell.setContent(root);
      root.querySelector('[data-run]').onclick=()=>run('Manual RUN');
      root.querySelector('[data-clear]').onclick=()=>{generation++;severityChoice=null;clearWatch();if(typeof GM_setValue==='function')GM_setValue(KEY,null);shell.setStatus('CLEARED','');render('STOPPED / CLEARED');};
      root.querySelector('[data-severity-po]')?.addEventListener('click',()=>applySeverityChoice(severityChoice.po,'PO'));
      root.querySelector('[data-severity-live]')?.addEventListener('click',()=>applySeverityChoice(severityChoice.live,'LIVE'));
      root.querySelector('[data-severity-apply]')?.addEventListener('click',()=>applySeverityChoice(root.querySelector('[data-severity-manual]')?.value,'MANUAL'));
      root.querySelector('[data-severity-manual]')?.addEventListener('keydown',event=>{
        if(event.key!=='Enter')return;
        event.preventDefault();
        void applySeverityChoice(event.currentTarget.value,'MANUAL');
      });
    }
    render();
    return Object.freeze({run,render});
  }

  return Object.freeze({createCapture,bootRiverHost,selectPo,riverUrl});
})();

// ---- src/suites/fcr/index.js ----
V3.boot = () => {
  const VERSION=V3.build.version;
  const life=V3.lifecycle.create('fcr-suite');
  const telemetry=V3.telemetry.create('fcr',VERSION);

  if(location.hostname==='river.amazon.com'){
    V3.fcrRiver.bootRiverHost({life,telemetry});
    return;
  }

  const client=V3.fcr.create({telemetry,life});
  const settings=V3.storage.create('fcr.shell');
  const tabs=[
    {id:'fcr',label:'FCR'},
    {id:'tote',label:'TOTE'},
    {id:'iss',label:'ISS CONSOLE'},
    {id:'river',label:'RIVER'},
    {id:'obs',label:'OBS'}
  ];
  let active=settings.get('tab','fcr');
  if(!tabs.some(tab=>tab.id===active))active='fcr';

  const shell=V3.ui.createShell({
    id:'bwu2-v3-fcr',
    title:'BWU2 V3 FCResearch',
    subtitle:'FCR · Tote · ISS Console · RIVER',
    version:VERSION,
    life,
    tabs,
    onTab:tab=>{
      active=tab;
      settings.set('tab',tab);
      render();
    }
  });
  V3.screenshot.install({life,roots:[shell.host]});

  const modules=Object.create(null);
  let nativeAutoloaded=false;

  function getModule(name){
    if(modules[name])return modules[name];
    if(name==='fcr')modules[name]=V3.fcrNative.create({life,client,telemetry,shell});
    else if(name==='tote')modules[name]=V3.fcrTote.create({life,client,telemetry,shell});
    else if(name==='iss')modules[name]=V3.fcrIss.create({life,telemetry,shell});
    else if(name==='river')modules[name]=V3.fcrRiver.createCapture({life,client,telemetry,shell});
    return modules[name];
  }

  function renderObs(){
    const events=telemetry.list();
    const root=document.createElement('div');
    root.innerHTML=
      '<section class="v3-section"><h3>OBS / Diagnostics</h3>'+
        '<div class="v3-note"><b>Build</b><br>'+V3.base.esc(V3.build.id)+'</div>'+
        '<div class="v3-note" style="margin-top:5px"><b>Events</b> '+events.length+'</div>'+
        '<div class="v3-row" style="margin-top:8px"><button class="v3-btn" data-export>EXPORT</button><button class="v3-btn danger" data-clear>CLEAR</button></div>'+
      '</section>'+
      '<section class="v3-section"><pre class="v3-log">'+V3.base.esc(JSON.stringify(events.slice(-80),null,2))+'</pre></section>';
    shell.setContent(root);
    root.querySelector('[data-export]').onclick=()=>{
      const blob=new Blob([telemetry.exportText()],{type:'application/json'});
      const a=document.createElement('a');
      a.href=URL.createObjectURL(blob);
      a.download='BWU2_V3_FCR_OBS_'+Date.now()+'.json';
      a.click();
      URL.revokeObjectURL(a.href);
    };
    root.querySelector('[data-clear]').onclick=()=>{telemetry.clear();renderObs();};
  }

  function render(){
    if(shell.tab!==active){
      shell.select(active);
      return;
    }
    if(active==='obs'){renderObs();return;}
    const module=getModule(active);
    module.render();
    if(active==='fcr'&&!nativeAutoloaded){
      nativeAutoloaded=true;
      const code=V3.base.clean(new URLSearchParams(location.search).get('s'));
      if(code)life.timeout(()=>module.load(),0);
    }
  }

  const syncUrl=()=>{
    const module=modules.fcr;
    if(!module)return;
    const next=V3.base.clean(new URLSearchParams(location.search).get('s'));
    if(next&&next!==module.state.code){
      module.state.code=next;
      nativeAutoloaded=false;
      if(active==='fcr')render();
    }
  };
  life.on(window,'hashchange',syncUrl);
  life.on(window,'popstate',syncUrl);
  try{life.on(window,'urlchange',syncUrl);}catch{}

  shell.select(active);
  render();
};

if(typeof V3.boot!=='function') throw new Error('V3 suite boot function missing');
V3.boot();
})();
