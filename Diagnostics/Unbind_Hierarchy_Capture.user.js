// ==UserScript==
// @name         DIAG v0.2.0 Unbind Hierarchy Backend Capture
// @namespace    BWU2
// @version      0.2.0
// @description  Passive capture of Unbind Hierarchy controls plus recursively redacted backend request/response schemas.
// @match        https://tx-b-hierarchy-nrt.nrt.proxy.amazon.com/unbindHierarchy*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Diagnostics/Unbind_Hierarchy_Capture.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Diagnostics/Unbind_Hierarchy_Capture.user.js
// ==/UserScript==

(() => {
  'use strict';

  if (window.__bwu2UnbindCapture) return;
  window.__bwu2UnbindCapture = true;

  const VERSION = '0.2.0';
  const MAX_EVENTS = 160;
  const TARGET_PATHS = new Set([
    '/validateContainer',
    '/getTransshipmentBindingSummary',
    '/unbindContainer'
  ]);
  const PANEL_ATTRIBUTE = 'data-bwu2-unbind-capture';
  const startedAt = performance.now();
  const events = [];
  let panel;
  let outputNode;
  let statusNode;
  let mutationTimer = 0;
  let lastSnapshotSignature = '';

  const elapsed = () => Math.round(performance.now() - startedAt);

  function clean(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function redact(value, maxLength = 160) {
    return clean(value)
      .replace(/\b(?:ts|cs)X[A-Za-z0-9]+\b/gi, '[CONTAINER]')
      .replace(/\b[A-Fa-f0-9]{24,}\b/g, '[HEX]')
      .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[TOKEN]')
      .replace(/[?&](?:token|csrf|auth|key|signature|session)=[^&\s]*/gi, '?[REDACTED]')
      .slice(0, maxLength);
  }

  function safePath(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ''), location.href);
      return `${url.pathname}${url.hash ? '#[HASH]' : ''}`;
    } catch (_) {
      return '[unparsed-url]';
    }
  }

  function interesting(rawUrl) {
    return TARGET_PATHS.has(safePath(rawUrl).split('#')[0]);
  }

  function sensitiveKey(key) {
    return /(?:auth|cookie|credential|csrf|key|pass|secret|session|signature|token)/i.test(String(key || ''));
  }

  function sanitizeData(value, key = '', depth = 0) {
    if (sensitiveKey(key)) return '[REDACTED]';
    if (depth > 7) return '[MAX_DEPTH]';
    if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;

    if (typeof value === 'string') {
      return redact(value, 500);
    }

    if (Array.isArray(value)) {
      const kept = value.slice(0, 40).map(item => sanitizeData(item, key, depth + 1));
      if (value.length > kept.length) kept.push(`[${value.length - kept.length} MORE]`);
      return kept;
    }

    if (value instanceof File) {
      return { file: '[NOT_CAPTURED]', type: redact(value.type, 80), size: value.size };
    }

    if (typeof value === 'object') {
      const output = {};
      const entries = Object.entries(value).slice(0, 80);
      for (const [childKey, childValue] of entries) {
        output[redact(childKey, 100)] = sanitizeData(childValue, childKey, depth + 1);
      }
      if (Object.keys(value).length > entries.length) output.__truncatedKeys = true;
      return output;
    }

    return redact(value, 160);
  }

  function parseCapturedBody(body) {
    if (body == null) return null;

    if (body instanceof URLSearchParams) {
      return { encoding: 'form', data: sanitizeData(Object.fromEntries(body.entries())) };
    }

    if (body instanceof FormData) {
      return { encoding: 'multipart-form', data: sanitizeData(Object.fromEntries(body.entries())) };
    }

    if (typeof body === 'string') {
      const trimmed = body.trim();
      if (!trimmed) return { encoding: 'text', data: '' };
      try {
        return { encoding: 'json', data: sanitizeData(JSON.parse(trimmed)) };
      } catch (_) {}

      if (trimmed.includes('=')) {
        try {
          return {
            encoding: 'form',
            data: sanitizeData(Object.fromEntries(new URLSearchParams(trimmed).entries()))
          };
        } catch (_) {}
      }

      return { encoding: 'text', data: sanitizeData(trimmed) };
    }

    if (body instanceof Blob) {
      return { encoding: 'blob', data: { type: redact(body.type, 80), size: body.size } };
    }

    return { encoding: body?.constructor?.name || typeof body, data: '[NOT_CAPTURED]' };
  }

  function parseResponseText(text) {
    const trimmed = String(text ?? '').trim();
    if (!trimmed) return null;
    try { return { encoding: 'json', data: sanitizeData(JSON.parse(trimmed)) }; }
    catch (_) { return { encoding: 'text', data: sanitizeData(trimmed) }; }
  }

  function isOwnNode(node) {
    return node instanceof Element && !!node.closest(`[${PANEL_ATTRIBUTE}]`);
  }

  function add(type, data = {}) {
    events.push({ ms: elapsed(), type, ...data });
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    render();
  }

  function describeControl(element) {
    if (!(element instanceof Element)) return null;

    const tag = element.tagName.toLowerCase();
    const type = redact(element.getAttribute('type') || '', 40);
    const role = redact(element.getAttribute('role') || '', 40);
    const textSource = ['input', 'textarea', 'select'].includes(tag)
      ? element.getAttribute('aria-label') || element.getAttribute('placeholder') || ''
      : element.getAttribute('aria-label') || element.textContent || '';

    return {
      tag,
      id: redact(element.id || '', 80),
      name: redact(element.getAttribute('name') || '', 80),
      type,
      role,
      text: redact(textSource, 120),
      disabled: !!element.disabled || element.getAttribute('aria-disabled') === 'true',
      hidden: !!element.hidden || element.getAttribute('aria-hidden') === 'true'
    };
  }

  function visible(element) {
    if (!(element instanceof Element) || isOwnNode(element)) return false;
    const style = getComputedStyle(element);
    return !element.hidden && style.display !== 'none' && style.visibility !== 'hidden';
  }

  function formSnapshot(form) {
    let action = '';
    try { action = safePath(form.action || location.href); } catch (_) {}
    return {
      id: redact(form.id || '', 80),
      name: redact(form.getAttribute('name') || '', 80),
      method: redact(form.method || 'get', 20).toUpperCase(),
      action
    };
  }

  function pageSnapshot() {
    const controls = Array.from(document.querySelectorAll(
      'button, input, select, textarea, [role="button"], [role="checkbox"], [role="radio"]'
    ))
      .filter(visible)
      .slice(0, 60)
      .map(describeControl)
      .filter(Boolean);

    const messages = Array.from(document.querySelectorAll(
      '[role="alert"], [role="status"], .alert, .error, .success, .notification, h1, h2, h3, legend'
    ))
      .filter(visible)
      .map(element => ({
        tag: element.tagName.toLowerCase(),
        role: redact(element.getAttribute('role') || '', 40),
        text: redact(element.textContent || '', 180)
      }))
      .filter(item => item.text)
      .slice(0, 30);

    const forms = Array.from(document.forms).filter(form => !isOwnNode(form)).slice(0, 12).map(formSnapshot);

    return {
      path: safePath(location.href),
      title: redact(document.title, 120),
      controls,
      messages,
      forms
    };
  }

  function captureSnapshot(reason) {
    if (!document.body) return;
    const snapshot = pageSnapshot();
    const signature = JSON.stringify(snapshot);
    if (signature === lastSnapshotSignature) return;
    lastSnapshotSignature = signature;
    add('dom.snapshot', { reason, snapshot });
  }

  function scheduleSnapshot(reason) {
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(() => captureSnapshot(reason), 140);
  }

  function exportText() {
    return [
      `BWU2 UNBIND HIERARCHY CAPTURE v${VERSION}`,
      'Privacy: container IDs, tokens, credentials, sensitive-key values, and headers are redacted/not captured.',
      'Backend bodies are included only as capped, recursively redacted JSON/form/text.',
      `Page: ${safePath(location.href)}`,
      `Events: ${events.length}`,
      '',
      JSON.stringify(events, null, 2)
    ].join('\n');
  }

  function render() {
    if (!outputNode) return;
    outputNode.textContent = exportText();
    statusNode.textContent = `${events.length} events — perform one Endless Mode unbind, then Copy`;
  }

  async function copyOutput(button) {
    const text = exportText();
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = 'Copy capture'; }, 1000);
  }

  function button(label, action) {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.style.cssText = 'padding:5px 9px;border:1px solid #64748b;border-radius:5px;background:#fff;color:#111827;font-weight:800;cursor:pointer';
    element.addEventListener('click', event => {
      event.stopPropagation();
      action(element);
    });
    return element;
  }

  function mount() {
    if (panel || !document.body) return;

    panel = document.createElement('section');
    panel.setAttribute(PANEL_ATTRIBUTE, 'true');
    panel.style.cssText = [
      'position:fixed', 'top:10px', 'right:10px', 'z-index:2147483647', 'width:460px',
      'max-height:52vh', 'padding:9px', 'border:3px solid #f59e0b', 'border-radius:8px',
      'background:#fff', 'color:#111827', 'box-shadow:0 8px 24px #0004', 'font:12px Arial,sans-serif'
    ].join(';');

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:5px';

    const title = document.createElement('strong');
    title.textContent = `UNBIND CAPTURE v${VERSION}`;

    const actions = document.createElement('div');
    const clearButton = button('Clear', () => {
      events.length = 0;
      lastSnapshotSignature = '';
      add('capture.cleared');
      captureSnapshot('clear');
    });
    const copyButton = button('Copy capture', copyOutput);
    const hideButton = button('Hide log', () => {
      const hidden = outputNode.style.display !== 'none';
      outputNode.style.display = hidden ? 'none' : 'block';
      hideButton.textContent = hidden ? 'Show log' : 'Hide log';
    });
    actions.style.cssText = 'display:flex;gap:4px';
    actions.append(clearButton, copyButton, hideButton);
    header.append(title, actions);

    statusNode = document.createElement('div');
    statusNode.style.cssText = 'margin-bottom:6px;color:#92400e;font-weight:700';

    outputNode = document.createElement('pre');
    outputNode.style.cssText = 'margin:0;max-height:39vh;overflow:auto;padding:7px;border-radius:5px;background:#f8fafc;white-space:pre-wrap;word-break:break-word;font:10px Consolas,monospace';

    panel.append(header, statusNode, outputNode);
    document.body.appendChild(panel);
    render();
    captureSnapshot('mount');
  }

  function instrumentInteractions() {
    document.addEventListener('click', event => {
      const control = event.target instanceof Element
        ? event.target.closest('button, input[type="button"], input[type="submit"], [role="button"]')
        : null;
      if (!control || isOwnNode(control)) return;
      add('ui.click', { control: describeControl(control) });
      scheduleSnapshot('after-click');
    }, true);

    document.addEventListener('change', event => {
      const control = event.target;
      if (!(control instanceof Element) || isOwnNode(control)) return;
      add('ui.change', { control: describeControl(control), valueCaptured: false });
      scheduleSnapshot('after-change');
    }, true);

    document.addEventListener('submit', event => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || isOwnNode(form)) return;
      add('ui.submit', { form: formSnapshot(form), valuesCaptured: false });
      scheduleSnapshot('after-submit');
    }, true);
  }

  function instrumentFetch() {
    const realFetch = window.fetch;
    if (typeof realFetch !== 'function') return;

    window.fetch = async function(input, init) {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (!interesting(url)) return realFetch.apply(this, arguments);
      const method = clean(init?.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();
      const request = {
        transport: 'fetch',
        method,
        path: safePath(url),
        requestBody: parseCapturedBody(init?.body),
        headersCaptured: false
      };
      const requestStarted = performance.now();
      add('net.request', request);
      try {
        const response = await realFetch.apply(this, arguments);
        response.clone().text().then(text => {
          add('net.response', {
            transport: request.transport,
            method: request.method,
            path: request.path,
            status: response.status,
            ok: response.ok,
            durationMs: Math.round(performance.now() - requestStarted),
            responseBody: parseResponseText(text),
            headersCaptured: false
          });
        }).catch(error => {
          add('net.response-read-error', {
            transport: request.transport,
            method: request.method,
            path: request.path,
            error: redact(error?.message || error, 120)
          });
        });
        scheduleSnapshot('after-fetch');
        return response;
      } catch (error) {
        add('net.error', {
          transport: request.transport,
          method: request.method,
          path: request.path,
          error: redact(error?.message || error, 120),
          durationMs: Math.round(performance.now() - requestStarted)
        });
        throw error;
      }
    };
  }

  function instrumentXhr() {
    const XHR = window.XMLHttpRequest;
    if (!XHR?.prototype) return;
    const realOpen = XHR.prototype.open;
    const realSend = XHR.prototype.send;

    XHR.prototype.open = function(method, url) {
      this.__bwu2UnbindRequest = interesting(url)
        ? {
            transport: 'xhr',
            method: clean(method || 'GET').toUpperCase(),
            path: safePath(url),
            headersCaptured: false
          }
        : null;
      return realOpen.apply(this, arguments);
    };

    XHR.prototype.send = function(body) {
      const request = this.__bwu2UnbindRequest;
      if (!request) return realSend.apply(this, arguments);

      request.requestBody = parseCapturedBody(body);
      const requestStarted = performance.now();
      add('net.request', request);
      this.addEventListener('loadend', () => {
        let responseBody = null;
        try { responseBody = parseResponseText(this.responseText); }
        catch (error) { responseBody = { error: redact(error?.message || error, 120) }; }
        add('net.response', {
          transport: request.transport,
          method: request.method,
          path: request.path,
          status: this.status,
          ok: this.status >= 200 && this.status < 300,
          durationMs: Math.round(performance.now() - requestStarted),
          responseBody,
          headersCaptured: false
        });
        scheduleSnapshot('after-xhr');
      }, { once: true });
      return realSend.apply(this, arguments);
    };
  }

  instrumentFetch();
  instrumentXhr();
  instrumentInteractions();

  const observer = new MutationObserver(mutations => {
    if (mutations.every(mutation => isOwnNode(mutation.target))) return;
    scheduleSnapshot('mutation');
  });

  function startDomCapture() {
    mount();
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'aria-disabled', 'aria-hidden', 'class', 'style']
    });
    captureSnapshot('ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startDomCapture, { once: true });
  } else {
    startDomCapture();
  }
})();
