// ==UserScript==
// @name         DIAG v0.1.1 Drive Write Observer
// @namespace    MONKIES
// @version      0.1.1
// @description  Passive Drive write observer. Persists across refresh and records only sanitized request/response structure.
// @match        https://drive.corp.amazon.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = '0.1.1';
  const PANEL_ID = 'bwu2-drive-write-observer';
  const STORE_KEY = 'bwu2-drive-write-observer-v2';
  const MAX_ROWS = 50;
  const rows = [];

  if (window.__BWU2_DRIVE_WRITE_OBSERVER__) return;
  window.__BWU2_DRIVE_WRITE_OBSERVER__ = true;

  function sanitizeUrl(raw) {
    try {
      const url = new URL(String(raw || ''), location.href);
      const parts = url.pathname.split('/').map(part => {
        if (!part) return part;
        if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(part)) return ':id';
        if (/^[A-Za-z0-9_-]{36,}$/.test(part)) return ':id';
        if (/^\d{6,}$/.test(part)) return ':id';
        return part;
      });
      return url.origin + parts.join('/');
    } catch (_) {
      return '(unresolved URL)';
    }
  }

  function shouldKeep(method) {
    const upper = String(method || 'GET').toUpperCase();
    return !['GET', 'HEAD', 'OPTIONS'].includes(upper);
  }

  function shapeOf(value, depth = 0) {
    if (depth > 5) return '…';
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';

    if (value instanceof File) return { type: 'File', size: value.size, mime: value.type || '' };
    if (value instanceof Blob) return { type: 'Blob', size: value.size, mime: value.type || '' };
    if (value instanceof FormData) {
      const fields = {};
      for (const [key, item] of value.entries()) {
        const shaped = shapeOf(item, depth + 1);
        if (Object.prototype.hasOwnProperty.call(fields, key)) {
          if (!Array.isArray(fields[key])) fields[key] = [fields[key]];
          fields[key].push(shaped);
        } else fields[key] = shaped;
      }
      return { type: 'FormData', fields };
    }
    if (value instanceof URLSearchParams) {
      const fields = {};
      for (const [key] of value.entries()) fields[key] = 'string';
      return { type: 'URLSearchParams', fields };
    }
    if (Array.isArray(value)) return value.length ? [shapeOf(value[0], depth + 1)] : [];

    const type = typeof value;
    if (type === 'string') return 'string';
    if (type === 'number') return 'number';
    if (type === 'boolean') return 'boolean';
    if (type !== 'object') return type;

    const out = {};
    for (const key of Object.keys(value).slice(0, 80)) {
      try { out[key] = shapeOf(value[key], depth + 1); }
      catch (_) { out[key] = '?'; }
    }
    return out;
  }

  function bodyShape(body) {
    if (body == null) return null;
    if (typeof body === 'string') {
      try { return { type: 'JSON', body: shapeOf(JSON.parse(body)) }; }
      catch (_) { return { type: 'string', length: body.length }; }
    }
    try { return shapeOf(body); }
    catch (_) { return { type: Object.prototype.toString.call(body) }; }
  }

  function responseShape(text) {
    if (!text) return null;
    try { return { type: 'JSON', body: shapeOf(JSON.parse(text)) }; }
    catch (_) { return { type: 'text', length: String(text).length }; }
  }

  function loadRows() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || '[]');
      if (Array.isArray(saved)) rows.push(...saved.slice(-MAX_ROWS));
    } catch (_) {}
  }

  function saveRows() {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(rows.slice(-MAX_ROWS))); }
    catch (_) {}
  }

  function addRow({ source, method, url, status, ms, request, response }) {
    const upper = String(method || 'GET').toUpperCase();
    if (!shouldKeep(upper)) return;
    rows.push({
      t: new Date().toLocaleTimeString(),
      source: String(source || ''),
      method: upper,
      url: sanitizeUrl(url),
      status: status == null ? '?' : String(status),
      ms: Number.isFinite(ms) ? Math.round(ms) : null,
      request: request || null,
      response: response || null,
    });
    if (rows.length > MAX_ROWS) rows.splice(0, rows.length - MAX_ROWS);
    saveRows();
    renderRows();
  }

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function(input, init) {
      const method = String(init?.method || input?.method || 'GET').toUpperCase();
      const url = typeof input === 'string' ? input : (input?.url || '');
      const request = shouldKeep(method) ? bodyShape(init?.body) : null;
      const started = performance.now();
      let result;
      try { result = nativeFetch.apply(this, arguments); }
      catch (error) {
        addRow({ source: 'fetch', method, url, status: 'THREW', ms: performance.now() - started, request });
        throw error;
      }
      if (!shouldKeep(method)) return result;
      return Promise.resolve(result).then(
        response => {
          const clone = response.clone();
          clone.text().then(text => addRow({
            source: 'fetch', method, url: response?.url || url, status: response?.status,
            ms: performance.now() - started, request, response: responseShape(text),
          }), () => addRow({
            source: 'fetch', method, url: response?.url || url, status: response?.status,
            ms: performance.now() - started, request, response: null,
          }));
          return response;
        },
        error => {
          addRow({ source: 'fetch', method, url, status: 'ERROR', ms: performance.now() - started, request });
          throw error;
        }
      );
    };
  }

  const NativeXHR = window.XMLHttpRequest;
  if (typeof NativeXHR === 'function') {
    const nativeOpen = NativeXHR.prototype.open;
    const nativeSend = NativeXHR.prototype.send;
    NativeXHR.prototype.open = function(method, url) {
      this.__bwu2DriveObserver = { method: String(method || 'GET').toUpperCase(), url: String(url || '') };
      return nativeOpen.apply(this, arguments);
    };
    NativeXHR.prototype.send = function(body) {
      const meta = this.__bwu2DriveObserver;
      if (meta && shouldKeep(meta.method)) {
        const started = performance.now();
        const request = bodyShape(body);
        this.addEventListener('loadend', () => {
          let text = '';
          try { if (!this.responseType || this.responseType === 'text') text = this.responseText || ''; }
          catch (_) {}
          addRow({
            source: 'xhr', method: meta.method, url: this.responseURL || meta.url, status: this.status,
            ms: performance.now() - started, request, response: responseShape(text),
          });
        }, { once: true });
      }
      return nativeSend.apply(this, arguments);
    };
  }

  document.addEventListener('submit', event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const method = String(form.method || 'GET').toUpperCase();
    if (!shouldKeep(method)) return;
    let request = null;
    try { request = bodyShape(new FormData(form)); } catch (_) {}
    addRow({ source: 'form', method, url: form.action || location.href, status: 'SUBMIT', ms: null, request, response: null });
  }, true);

  function copiedText() {
    if (!rows.length) return 'NO WRITE REQUESTS CAPTURED';
    return rows.map(row => {
      const parts = [row.t, row.source, row.method, row.url, row.status, row.ms == null ? '' : `${row.ms}ms`];
      if (row.request) parts.push(`REQ=${JSON.stringify(row.request)}`);
      if (row.response) parts.push(`RESP=${JSON.stringify(row.response)}`);
      return parts.join('\t');
    }).join('\n');
  }

  async function copyResults(button) {
    const text = copiedText();
    try { await navigator.clipboard.writeText(text); }
    catch (_) {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.focus();
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = 'Copy Results'; }, 1200);
  }

  function ensureUi() {
    if (!document.body || document.getElementById(PANEL_ID)) return;
    const style = document.createElement('style');
    style.textContent = `
      #${PANEL_ID}{position:fixed;right:12px;bottom:12px;z-index:2147483647;width:540px;max-width:calc(100vw - 24px);background:#fff;color:#232f3e;border:2px solid #232f3e;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.22);padding:10px;font:12px/1.35 Arial,sans-serif}
      #${PANEL_ID} *{box-sizing:border-box} #${PANEL_ID} .head{display:flex;justify-content:space-between;align-items:center;gap:8px}
      #${PANEL_ID} .head strong{font-size:14px} #${PANEL_ID} .tag{font-size:10px;color:#5f6b78;font-weight:800}
      #${PANEL_ID} .help{margin:7px 0;color:#5f6b78;font-size:11px;font-weight:700} #${PANEL_ID} .buttons{display:flex;gap:6px;margin-bottom:7px}
      #${PANEL_ID} button{border:0;border-radius:6px;padding:7px 10px;background:#232f3e;color:#fff;font-weight:900;cursor:pointer}
      #${PANEL_ID} .rows{max-height:240px;overflow:auto;border:1px solid #c7ced7;border-radius:6px;background:#f8fafb}
      #${PANEL_ID} .empty{padding:12px;color:#5f6b78;font-weight:800} #${PANEL_ID} .row{display:grid;grid-template-columns:68px 42px 54px minmax(0,1fr) 52px 52px;gap:5px;padding:5px 7px;border-top:1px solid #e0e4e9;font:10px/1.25 Consolas,monospace}
      #${PANEL_ID} .row:first-child{border-top:0} #${PANEL_ID} .method{font-weight:900} #${PANEL_ID} .url{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #${PANEL_ID} .foot{margin-top:6px;font-size:10px;color:#5f6b78;font-weight:700}`;
    document.head.appendChild(style);

    const panel = document.createElement('div'); panel.id = PANEL_ID;
    const head = document.createElement('div'); head.className = 'head';
    const title = document.createElement('strong'); title.textContent = 'Drive Write Observer';
    const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = `DIAG v${VERSION}`;
    head.append(title, tag);
    const help = document.createElement('div'); help.className = 'help';
    help.textContent = 'Results survive Drive refreshes. Copy Results shows field names/types/sizes only — never payload values or auth data.';
    const buttons = document.createElement('div'); buttons.className = 'buttons';
    const clear = document.createElement('button'); clear.type = 'button'; clear.textContent = 'Clear';
    clear.addEventListener('click', () => { rows.length = 0; try { sessionStorage.removeItem(STORE_KEY); } catch (_) {} renderRows(); });
    const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copy Results'; copy.addEventListener('click', () => copyResults(copy));
    buttons.append(clear, copy);
    const list = document.createElement('div'); list.className = 'rows'; list.id = 'bwu2-drive-write-observer-rows';
    const foot = document.createElement('div'); foot.className = 'foot';
    foot.textContent = 'No query strings, request values, response values, headers, cookies, auth tokens or file contents are collected.';
    panel.append(head, help, buttons, list, foot); document.body.appendChild(panel); renderRows();
  }

  function renderRows() {
    const list = document.getElementById('bwu2-drive-write-observer-rows');
    if (!list) return;
    list.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'No write requests captured yet.'; list.appendChild(empty); return;
    }
    for (const item of rows.slice().reverse()) {
      const row = document.createElement('div'); row.className = 'row';
      const cells = [item.t, item.source, item.method, item.url, item.status, item.ms == null ? '' : `${item.ms}ms`];
      for (let i = 0; i < cells.length; i++) {
        const cell = document.createElement('div'); if (i === 2) cell.className = 'method'; if (i === 3) cell.className = 'url';
        cell.textContent = cells[i]; if (i === 3) cell.title = cells[i]; row.appendChild(cell);
      }
      list.appendChild(row);
    }
  }

  function bootUi() {
    if (document.body) ensureUi();
    else document.addEventListener('DOMContentLoaded', ensureUi, { once: true });
  }

  loadRows();
  bootUi();
})();
