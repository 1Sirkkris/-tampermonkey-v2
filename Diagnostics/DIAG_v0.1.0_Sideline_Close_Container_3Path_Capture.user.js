// ==UserScript==
// @name         DIAG v0.1.2 Sideline Close Container 3-Path Capture
// @namespace    BWU2
// @version      0.1.2
// @description  Read-only Sideline V3 close-container capture for inventory/NO, inventory/YES, and no-inventory direct-close paths.
// @match        https://aft-poirot-website-nrt.nrt.proxy.amazon.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';

  if (window.__bwu2SidelineClose3PathCapture) return;
  window.__bwu2SidelineClose3PathCapture = true;

  const MAX = 100;
  const rows = [];
  let box;
  let titleText;
  let body;
  let toggle;
  let activeCase = 'UNSET';
  let collapsed = true;

  const clean = v => String(v ?? '').trim();

  function apiPath(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ''), location.href);
      if (url.origin !== location.origin) return '';
      return url.pathname.startsWith('/api/') ? url.pathname : '';
    } catch {
      return '';
    }
  }

  function parseBody(bodyValue) {
    if (bodyValue == null) return null;
    if (typeof bodyValue === 'string') {
      try { return JSON.parse(bodyValue); } catch { return bodyValue; }
    }
    if (bodyValue instanceof URLSearchParams) return Object.fromEntries(bodyValue.entries());
    if (bodyValue instanceof FormData) return Object.fromEntries(bodyValue.entries());
    return `[${bodyValue?.constructor?.name || typeof bodyValue}]`;
  }

  function add(entry, caseName=activeCase) {
    rows.push({ time:new Date().toISOString(), case:caseName, ...entry });
    if (rows.length > MAX) rows.splice(0, rows.length - MAX);
    render();
  }

  function markCase(value) {
    if (activeCase !== 'UNSET') add({ kind:'CASE_END' }, activeCase);
    activeCase = value;
    add({ kind:'CASE_START' }, activeCase);
    setCollapsed(true);
  }

  function stopCase() {
    if (activeCase !== 'UNSET') add({ kind:'CASE_END' }, activeCase);
    activeCase = 'UNSET';
    render();
    setCollapsed(true);
  }

  function caseShort() {
    if (activeCase === '1_INVENTORY_EMPTY_NO') return '1 NO';
    if (activeCase === '2_INVENTORY_EMPTY_YES') return '2 YES';
    if (activeCase === '3_NO_INVENTORY_DIRECT_CLOSE') return '3 EMPTY';
    return 'OFF';
  }

  function output() {
    return [
      'BWU2 SIDELINE CLOSE CONTAINER 3-PATH CAPTURE v0.1.2',
      '',
      '1 = INVENTORY + EMPTY NO',
      '2 = INVENTORY + EMPTY YES',
      '3 = NO INVENTORY + DIRECT CLOSE',
      '',
      `Active case: ${activeCase}`,
      `Captured rows: ${rows.length}`,
      '',
      JSON.stringify(rows, null, 2)
    ].join('\n');
  }

  function makeButton(label, onClick) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'padding:4px 7px;font:700 11px Arial,sans-serif;border:1px solid #9ca3af;border-radius:4px;background:#fff;color:#111827;cursor:pointer;white-space:nowrap';
    b.onclick = onClick;
    return b;
  }

  function setCollapsed(value) {
    collapsed = !!value;
    if (body) body.style.display = collapsed ? 'none' : 'block';
    if (toggle) toggle.textContent = collapsed ? '+' : '−';
    render();
  }

  function render() {
    if (!box) return;
    if (titleText) titleText.textContent = `3P CLOSE • ${caseShort()} • ${rows.length}`;
    box.style.borderColor = activeCase === 'UNSET' ? '#6b7280' : '#16a34a';
  }

  function mount() {
    if (box || !document.body) return;

    box = document.createElement('div');
    box.style.cssText = [
      'position:fixed','top:8px','right:8px','z-index:2147483647','background:#fff','color:#111827',
      'border:2px solid #6b7280','border-radius:6px','box-shadow:0 3px 10px #0003','font:11px Arial,sans-serif',
      'width:auto','max-width:360px','padding:4px'
    ].join(';');

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:5px;min-width:118px';

    titleText = document.createElement('span');
    titleText.style.cssText = 'font-weight:900;white-space:nowrap;line-height:20px';

    toggle = makeButton('+', () => setCollapsed(!collapsed));
    toggle.title = 'Expand / minimise';
    toggle.style.cssText += ';margin-left:auto;padding:1px 6px;font-size:14px;line-height:18px';

    header.append(titleText, toggle);

    body = document.createElement('div');
    body.style.cssText = 'display:none;margin-top:4px;border-top:1px solid #d1d5db;padding-top:4px';

    const cases = document.createElement('div');
    cases.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap';
    cases.append(
      makeButton('1 — Inv / NO', () => markCase('1_INVENTORY_EMPTY_NO')),
      makeButton('2 — Inv / YES', () => markCase('2_INVENTORY_EMPTY_YES')),
      makeButton('3 — Empty', () => markCase('3_NO_INVENTORY_DIRECT_CLOSE'))
    );

    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;margin-top:4px';

    const stop = makeButton('Stop', stopCase);
    const clear = makeButton('Clear', () => {
      rows.length = 0;
      activeCase = 'UNSET';
      render();
    });
    const copy = makeButton('Copy', async () => {
      await navigator.clipboard.writeText(output());
      copy.textContent = 'Copied';
      setTimeout(() => copy.textContent = 'Copy', 900);
    });

    controls.append(stop, clear, copy);

    const help = document.createElement('div');
    help.textContent = 'Arm case → close normally → Stop → Copy.';
    help.style.cssText = 'margin-top:4px;color:#374151;white-space:nowrap';

    body.append(cases, controls, help);
    box.append(header, body);
    document.body.appendChild(box);
    render();
  }

  const realFetch = window.fetch;
  window.fetch = async function(input, init) {
    const rawUrl = typeof input === 'string' ? input : input?.url || '';
    const path = apiPath(rawUrl);
    const captureCase = activeCase;
    if (captureCase === 'UNSET' || !path) return realFetch.apply(this, arguments);

    const method = clean(init?.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();
    const requestBody = parseBody(init?.body);
    const started = performance.now();

    try {
      const response = await realFetch.apply(this, arguments);
      let responseBody = null;
      try {
        const txt = await response.clone().text();
        try { responseBody = JSON.parse(txt); } catch { responseBody = txt; }
      } catch (e) {
        responseBody = `[response read failed: ${e?.message || e}]`;
      }

      add({
        kind:'NETWORK', transport:'fetch', method, path, url:String(rawUrl), requestBody,
        status:response.status, ok:response.ok,
        ms:Math.round(performance.now() - started), responseBody
      }, captureCase);
      return response;
    } catch (error) {
      add({
        kind:'NETWORK', transport:'fetch', method, path, url:String(rawUrl), requestBody,
        error:error?.message || String(error), ms:Math.round(performance.now() - started)
      }, captureCase);
      throw error;
    }
  };

  const XHR = window.XMLHttpRequest;
  const open = XHR.prototype.open;
  const send = XHR.prototype.send;

  XHR.prototype.open = function(method, url) {
    const path = apiPath(url);
    this.__bwu2Close3PathCapture = activeCase !== 'UNSET' && path
      ? { method:clean(method).toUpperCase(), url:String(url), path, captureCase:activeCase }
      : null;
    return open.apply(this, arguments);
  };

  XHR.prototype.send = function(bodyValue) {
    const meta = this.__bwu2Close3PathCapture;
    if (!meta) return send.apply(this, arguments);

    const requestBody = parseBody(bodyValue);
    const started = performance.now();

    this.addEventListener('loadend', () => {
      let responseBody = this.responseText;
      try { responseBody = JSON.parse(responseBody); } catch {}

      add({
        kind:'NETWORK', transport:'xhr', method:meta.method, path:meta.path, url:meta.url, requestBody,
        status:this.status, ok:this.status >= 200 && this.status < 300,
        ms:Math.round(performance.now() - started), responseBody
      }, meta.captureCase);
    }, { once:true });

    return send.apply(this, arguments);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once:true });
  } else {
    mount();
  }
})();
