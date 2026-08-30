// ==UserScript==
// @name         DIAG v0.1.0 Drive Write Observer
// @namespace    MONKIES
// @version      0.1.0
// @description  Passive Drive UI write observer. Captures only method + sanitized endpoint + status; no payloads, headers, cookies or tokens.
// @match        https://drive.corp.amazon.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = '0.1.0';
  const PANEL_ID = 'bwu2-drive-write-observer';
  const MAX_ROWS = 40;
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
    return upper !== 'GET' && upper !== 'HEAD' && upper !== 'OPTIONS';
  }

  function addRow(source, method, rawUrl, status, ms) {
    const upper = String(method || 'GET').toUpperCase();
    if (!shouldKeep(upper)) return;

    const row = {
      t: new Date().toLocaleTimeString(),
      source: String(source || ''),
      method: upper,
      url: sanitizeUrl(rawUrl),
      status: status == null ? '?' : String(status),
      ms: Number.isFinite(ms) ? Math.round(ms) : null,
    };

    rows.push(row);
    if (rows.length > MAX_ROWS) rows.splice(0, rows.length - MAX_ROWS);
    renderRows();
  }

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function(input, init) {
      const method = String(init?.method || input?.method || 'GET').toUpperCase();
      const url = typeof input === 'string' ? input : (input?.url || '');
      const started = performance.now();

      let result;
      try {
        result = nativeFetch.apply(this, arguments);
      } catch (error) {
        addRow('fetch', method, url, 'THREW', performance.now() - started);
        throw error;
      }

      if (!shouldKeep(method)) return result;

      return Promise.resolve(result).then(
        response => {
          addRow('fetch', method, response?.url || url, response?.status, performance.now() - started);
          return response;
        },
        error => {
          addRow('fetch', method, url, 'ERROR', performance.now() - started);
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
      this.__bwu2DriveObserver = {
        method: String(method || 'GET').toUpperCase(),
        url: String(url || ''),
      };
      return nativeOpen.apply(this, arguments);
    };

    NativeXHR.prototype.send = function() {
      const meta = this.__bwu2DriveObserver;
      if (meta && shouldKeep(meta.method)) {
        const started = performance.now();
        this.addEventListener('loadend', () => {
          addRow(
            'xhr',
            meta.method,
            this.responseURL || meta.url,
            this.status,
            performance.now() - started
          );
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

    addRow('form', method, form.action || location.href, 'SUBMIT', null);
  }, true);

  function ensureUi() {
    if (!document.body || document.getElementById(PANEL_ID)) return;
    const style = document.createElement('style');
    style.textContent = `
      #${PANEL_ID}{
        position:fixed; right:12px; bottom:12px; z-index:2147483647;
        width:520px; max-width:calc(100vw - 24px);
        background:#fff; color:#232f3e; border:2px solid #232f3e;
        border-radius:10px; box-shadow:0 8px 28px rgba(0,0,0,.22);
        padding:10px; font:12px/1.35 Arial,sans-serif;
      }
      #${PANEL_ID} *{box-sizing:border-box}
      #${PANEL_ID} .head{display:flex;justify-content:space-between;align-items:center;gap:8px}
      #${PANEL_ID} .head strong{font-size:14px}
      #${PANEL_ID} .tag{font-size:10px;color:#5f6b78;font-weight:800}
      #${PANEL_ID} .help{margin:7px 0;color:#5f6b78;font-size:11px;font-weight:700}
      #${PANEL_ID} .buttons{display:flex;gap:6px;margin-bottom:7px}
      #${PANEL_ID} button{
        border:0;border-radius:6px;padding:7px 10px;background:#232f3e;
        color:white;font-weight:900;cursor:pointer;
      }
      #${PANEL_ID} .rows{
        max-height:220px;overflow:auto;border:1px solid #c7ced7;border-radius:6px;
        background:#f8fafb;
      }
      #${PANEL_ID} .empty{padding:12px;color:#5f6b78;font-weight:800}
      #${PANEL_ID} .row{
        display:grid;grid-template-columns:68px 42px 54px minmax(0,1fr) 52px 52px;
        gap:5px;padding:5px 7px;border-top:1px solid #e0e4e9;
        font:10px/1.25 Consolas,monospace;
      }
      #${PANEL_ID} .row:first-child{border-top:0}
      #${PANEL_ID} .method{font-weight:900}
      #${PANEL_ID} .url{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #${PANEL_ID} .foot{margin-top:6px;font-size:10px;color:#5f6b78;font-weight:700}
    `;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = PANEL_ID;

    const head = document.createElement('div');
    head.className = 'head';

    const title = document.createElement('strong');
    title.textContent = 'Drive Write Observer';

    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = `DIAG v${VERSION}`;

    head.append(title, tag);

    const help = document.createElement('div');
    help.className = 'help';
    help.textContent = 'Passive only. Do ONE normal Drive write action. Captures method + sanitized endpoint + status only.';

    const buttons = document.createElement('div');
    buttons.className = 'buttons';

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.textContent = 'Clear';
    clear.addEventListener('click', () => {
      rows.length = 0;
      renderRows();
    });

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = 'Copy Results';
    copy.addEventListener('click', async () => {
      const text = rows.length
        ? rows.map(r => `${r.t}\t${r.source}\t${r.method}\t${r.url}\t${r.status}\t${r.ms == null ? '' : r.ms + 'ms'}`).join('\n')
        : 'NO WRITE REQUESTS CAPTURED';

      try {
        await navigator.clipboard.writeText(text);
        copy.textContent = 'Copied';
      } catch (_) {
        const area = document.createElement('textarea');
        area.value = text;
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
        copy.textContent = 'Copied';
      }
      setTimeout(() => { copy.textContent = 'Copy Results'; }, 1200);
    });

    buttons.append(clear, copy);

    const list = document.createElement('div');
    list.className = 'rows';
    list.id = 'bwu2-drive-write-observer-rows';

    const foot = document.createElement('div');
    foot.className = 'foot';
    foot.textContent = 'No request bodies, query strings, headers, cookies, auth tokens, or file contents are collected.';

    panel.append(head, help, buttons, list, foot);
    document.body.appendChild(panel);
    renderRows();
  }

  function renderRows() {
    const list = document.getElementById('bwu2-drive-write-observer-rows');
    if (!list) return;

    list.replaceChildren();

    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No write requests captured yet.';
      list.appendChild(empty);
      return;
    }

    for (const item of rows.slice().reverse()) {
      const row = document.createElement('div');
      row.className = 'row';

      const cells = [
        [item.t, ''],
        [item.source, ''],
        [item.method, 'method'],
        [item.url, 'url'],
        [item.status, ''],
        [item.ms == null ? '' : `${item.ms}ms`, ''],
      ];

      for (const [text, className] of cells) {
        const cell = document.createElement('div');
        if (className) cell.className = className;
        cell.textContent = text;
        if (className === 'url') cell.title = text;
        row.appendChild(cell);
      }

      list.appendChild(row);
    }
  }

  function bootUi() {
    if (document.body) ensureUi();
    else document.addEventListener('DOMContentLoaded', ensureUi, { once: true });
  }

  bootUi();
})();
