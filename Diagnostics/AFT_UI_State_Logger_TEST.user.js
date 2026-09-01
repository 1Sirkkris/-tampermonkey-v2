// ==UserScript==
// @name         TEST v0.1.1 AFT UI State Logger
// @name:en      TEST v0.1.1 AFT UI State Logger
// @namespace    https://github.com/1Sirkkris
// @version      0.1.1
// @description  Read-only logger for AFT same-tab mode switches, UI states, form actions, XHR/fetch results and errors. Never records request bodies or headers.
// @include      *://aft-qt-*.corp.amazon.com/*
// @include      /^https?:\/\/aft-moveapp-[^\/.]+(?:\.nrt)?\.proxy\.amazon\.com\/(?:move-container)?(?:[\/?#]|$)/
// @include      *://*.amazonoperations.app/*
// @include      *://*.aka.amazon.com/*
// @run-at       document-start
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Diagnostics/AFT_UI_State_Logger_TEST.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Diagnostics/AFT_UI_State_Logger_TEST.user.js
// ==/UserScript==

(() => {
  'use strict';

  if (window.top !== window.self) return;

  const VERSION = '0.1.1';
  const ROOT_ID = 'aft-ui-state-logger-panel';
  const STORE_KEY = 'aft_ui_state_trace_v011';
  const MAX_ROWS = 600;
  const MAX_STORE_CHARS = 3500000;
  const MAX_TEXT = 1800;
  const startedAt = performance.now();

  if (document.documentElement?.hasAttribute('data-aft-ui-state-logger')) return;
  document.documentElement?.setAttribute('data-aft-ui-state-logger', VERSION);

  let panel = null;
  let countNode = null;
  let snapshotTimer = 0;
  let lastSnapshot = '';

  const now = () => new Date().toISOString();
  const elapsed = () => Math.round(performance.now() - startedAt);
  const norm = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const clip = (value, max = 260) => {
    const text = norm(value);
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };

  function safeJson(value) {
    try { return JSON.stringify(value); }
    catch { return '"[unserializable]"'; }
  }

  function readRows() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeRows(rows) {
    try {
      let kept = rows.slice(-MAX_ROWS);
      let encoded = JSON.stringify(kept);
      while (encoded.length > MAX_STORE_CHARS && kept.length > 20) {
        kept = kept.slice(Math.max(1, Math.floor(kept.length * 0.15)));
        encoded = JSON.stringify(kept);
      }
      localStorage.setItem(STORE_KEY, encoded);
    } catch {}
  }

  function log(type, details = {}) {
    const rows = readRows();
    rows.push({ at: now(), ms: elapsed(), type, url: location.href, details });
    writeRows(rows);
    if (countNode) countNode.textContent = String(Math.min(rows.length, MAX_ROWS));
  }

  function describeElement(node) {
    if (!node || node.nodeType !== 1) return { tag: String(node?.nodeName || 'unknown') };
    const attrs = {};
    for (const name of ['id', 'class', 'name', 'type', 'role', 'aria-label', 'data-testid']) {
      const value = node.getAttribute?.(name);
      if (value) attrs[name] = clip(value, 100);
    }
    return {
      tag: node.tagName,
      attrs,
      text: clip(node.innerText || node.textContent || '', 180)
    };
  }

  function nativeBodyText() {
    if (!document.body) return '';
    const copy = document.body.cloneNode(true);
    copy.querySelectorAll(`#${ROOT_ID},#aft-super-test,.aftm`).forEach(node => node.remove());
    return clip(copy.innerText || copy.textContent || '', MAX_TEXT);
  }

  function interactiveSummary() {
    return [...document.querySelectorAll('button,a,input,select,textarea,[role="button"]')]
      .filter(node => !node.closest(`#${ROOT_ID}`))
      .slice(0, 50)
      .map(node => describeElement(node));
  }

  function captureState(reason) {
    const text = nativeBodyText();
    const signature = `${location.href}\n${document.title}\n${text}`;
    if (reason === 'DOM_SETTLED' && signature === lastSnapshot) return;
    lastSnapshot = signature;
    log('UI_STATE', {
      reason,
      title: document.title,
      readyState: document.readyState,
      text,
      controls: interactiveSummary()
    });
  }

  function queueSnapshot(reason = 'DOM_SETTLED') {
    clearTimeout(snapshotTimer);
    snapshotTimer = setTimeout(() => captureState(reason), 350);
  }

  function installUiTrace() {
    document.addEventListener('pointerdown', event => {
      if (panel?.contains(event.target)) return;
      log('POINTER_DOWN', {
        button: event.button,
        x: event.clientX,
        y: event.clientY,
        target: describeElement(event.target)
      });
    }, true);

    document.addEventListener('click', event => {
      if (panel?.contains(event.target)) return;
      log('CLICK', {
        defaultPrevented: event.defaultPrevented,
        target: describeElement(event.target)
      });
      queueSnapshot('AFTER_CLICK');
    }, true);

    document.addEventListener('submit', event => {
      log('FORM_SUBMIT', {
        defaultPrevented: event.defaultPrevented,
        action: clip(event.target?.action || '', 500),
        method: String(event.target?.method || '').toUpperCase(),
        form: describeElement(event.target)
      });
      queueSnapshot('AFTER_SUBMIT');
    }, true);
  }

  function installFetchTrace() {
    if (typeof window.fetch !== 'function') return;
    const original = window.fetch;
    window.fetch = async function (...args) {
      const request = args[0];
      const options = args[1] || {};
      const url = clip(typeof request === 'string' ? request : request?.url, 700);
      const method = String(options.method || request?.method || 'GET').toUpperCase();
      const began = performance.now();
      log('FETCH_START', { method, url });
      try {
        const response = await original.apply(this, args);
        log('FETCH_END', {
          method,
          url,
          status: response.status,
          ok: response.ok,
          durationMs: Math.round(performance.now() - began)
        });
        queueSnapshot('AFTER_FETCH');
        return response;
      } catch (error) {
        log('FETCH_ERROR', {
          method,
          url,
          durationMs: Math.round(performance.now() - began),
          error: clip(error?.stack || error?.message || error, 700)
        });
        throw error;
      }
    };
  }

  function installXhrTrace() {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__aftUiTrace = {
        method: String(method || 'GET').toUpperCase(),
        url: clip(url, 700)
      };
      return originalOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      const meta = this.__aftUiTrace || { method: 'UNKNOWN', url: 'UNKNOWN' };
      const began = performance.now();
      log('XHR_START', meta);
      this.addEventListener('loadend', () => {
        log('XHR_END', {
          ...meta,
          status: this.status,
          durationMs: Math.round(performance.now() - began)
        });
        queueSnapshot('AFTER_XHR');
      }, { once: true });
      this.addEventListener('error', () => {
        log('XHR_ERROR', { ...meta, durationMs: Math.round(performance.now() - began) });
      }, { once: true });
      return originalSend.apply(this, args);
    };
  }

  function installMutationTrace() {
    const begin = () => {
      if (!document.documentElement) return setTimeout(begin, 20);
      new MutationObserver(records => {
        const external = records.some(record => {
          if (panel && (panel === record.target || panel.contains(record.target))) return false;
          return [...record.addedNodes, ...record.removedNodes].some(node => {
            const element = node.nodeType === 1 ? node : node.parentElement;
            return element && !element.closest?.(`#${ROOT_ID}`);
          });
        });
        if (external) queueSnapshot();
      }).observe(document.documentElement, { childList: true, subtree: true });
    };
    begin();
  }

  function installNavigationTrace() {
    for (const method of ['pushState', 'replaceState']) {
      const original = history[method];
      history[method] = function (...args) {
        const result = original.apply(this, args);
        log(`HISTORY_${method.toUpperCase()}`, {
          state: clip(safeJson(args[0]), 600),
          target: clip(args[2], 600)
        });
        queueSnapshot(`AFTER_${method.toUpperCase()}`);
        return result;
      };
    }

    addEventListener('beforeunload', () => log('BEFORE_UNLOAD'), true);
    addEventListener('pagehide', event => log('PAGE_HIDE', { persisted: event.persisted }), true);
    addEventListener('pageshow', event => {
      log('PAGE_SHOW', { persisted: event.persisted });
      queueSnapshot('PAGE_SHOW');
    }, true);
    addEventListener('hashchange', event => {
      log('HASH_CHANGE', { oldURL: event.oldURL, newURL: event.newURL });
      queueSnapshot('HASH_CHANGE');
    }, true);
    addEventListener('popstate', event => {
      log('POP_STATE', { state: clip(safeJson(event.state), 600) });
      queueSnapshot('POP_STATE');
    }, true);
  }

  function installErrorTrace() {
    addEventListener('error', event => {
      log('JS_ERROR', {
        message: clip(event.message, 700),
        source: clip(event.filename, 500),
        line: event.lineno,
        column: event.colno,
        error: clip(event.error?.stack || '', 900)
      });
    }, true);

    addEventListener('unhandledrejection', event => {
      log('UNHANDLED_REJECTION', { reason: clip(event.reason?.stack || event.reason, 900) });
    }, true);
  }

  function exportText() {
    const header = [
      `AFT UI State Logger TEST v${VERSION}`,
      `Exported: ${now()}`,
      `Current URL: ${location.href}`,
      `User agent: ${navigator.userAgent}`,
      `Rows: ${readRows().length}`,
      ''
    ].join('\n');
    return header + readRows().map(row => safeJson(row)).join('\n');
  }

  function copyFallback(text) {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    if (!copied) throw new Error('Browser rejected clipboard copy');
  }

  async function copyLog() {
    const output = exportText();
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(output);
      else copyFallback(output);
      setPanelMessage('COPIED ✓');
    } catch {
      try {
        copyFallback(output);
        setPanelMessage('COPIED ✓');
      } catch (error) {
        alert(`Copy failed: ${error?.message || error}`);
      }
    }
  }

  function downloadLog() {
    const blob = new Blob([exportText()], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `AFT_UI_TRACE_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    setPanelMessage('DOWNLOADED ✓');
  }

  function setPanelMessage(message) {
    const label = panel?.querySelector('[data-label]');
    if (!label) return;
    label.textContent = message;
    setTimeout(() => {
      if (label.isConnected) label.textContent = '● RECORDING';
    }, 1400);
  }

  function addButton(parent, label, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.style.cssText = 'border:1px solid #73838a;background:#263238;color:#fff;padding:5px 8px;border-radius:5px;cursor:pointer;font:700 11px Arial';
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      action();
    });
    parent.appendChild(button);
    return button;
  }

  function mountPanel() {
    if (!document.body) return setTimeout(mountPanel, 30);
    if (document.getElementById(ROOT_ID)) return;

    panel = document.createElement('section');
    panel.id = ROOT_ID;
    panel.style.cssText = 'position:fixed;top:8px;right:8px;z-index:2147483647;display:flex;gap:6px;align-items:center;padding:7px 8px;border:2px solid #e09a20;border-radius:7px;background:#111;color:#fff;box-shadow:0 3px 10px #0009;font:11px Arial';

    const title = document.createElement('strong');
    title.textContent = `AFT TRACE v${VERSION}`;
    panel.appendChild(title);

    const recording = document.createElement('span');
    recording.dataset.label = '1';
    recording.textContent = '● RECORDING';
    recording.style.cssText = 'color:#5ee28d;font-weight:800';
    panel.appendChild(recording);

    countNode = document.createElement('span');
    countNode.textContent = String(readRows().length);
    countNode.style.cssText = 'min-width:30px;text-align:center;color:#ffd166;font-weight:800';
    panel.appendChild(countNode);

    addButton(panel, 'MARK', () => {
      const note = prompt('What are you about to test?', 'BEFORE MOVE MODE SWITCH');
      if (note !== null) {
        log('USER_MARK', { note: clip(note, 600) });
        captureState('USER_MARK');
        setPanelMessage('MARKED ✓');
      }
    });
    addButton(panel, 'COPY LOG', copyLog);
    addButton(panel, 'DOWNLOAD', downloadLog);
    addButton(panel, 'CLEAR', () => {
      if (!confirm('Clear the saved AFT trace?')) return;
      localStorage.removeItem(STORE_KEY);
      log('TRACE_CLEARED');
      setPanelMessage('CLEARED ✓');
    });
    addButton(panel, '−', () => {
      [...panel.children].forEach((child, index) => {
        if (index > 2) child.hidden = !child.hidden;
      });
    });

    document.body.appendChild(panel);
    log('LOGGER_PANEL_READY', { title: document.title });
    captureState('PANEL_READY');
  }

  log('LOGGER_START', { version: VERSION, title: document.title, referrer: document.referrer });
  installUiTrace();
  installFetchTrace();
  installXhrTrace();
  installMutationTrace();
  installNavigationTrace();
  installErrorTrace();
  mountPanel();
})();
