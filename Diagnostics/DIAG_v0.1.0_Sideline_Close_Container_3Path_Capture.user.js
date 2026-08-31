// ==UserScript==
// @name         DIAG v0.1.1 Sideline Close Container 3-Path Capture
// @namespace    BWU2
// @version      0.1.1
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
  let pre;
  let activeCase = 'UNSET';

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

  function parseBody(body) {
    if (body == null) return null;
    if (typeof body === 'string') {
      try { return JSON.parse(body); } catch { return body; }
    }
    if (body instanceof URLSearchParams) return Object.fromEntries(body.entries());
    if (body instanceof FormData) return Object.fromEntries(body.entries());
    return `[${body?.constructor?.name || typeof body}]`;
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
  }

  function stopCase() {
    if (activeCase !== 'UNSET') add({ kind:'CASE_END' }, activeCase);
    activeCase = 'UNSET';
    render();
  }

  function output() {
    return [
      'BWU2 SIDELINE CLOSE CONTAINER 3-PATH CAPTURE v0.1.1',
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
    b.style.cssText = 'padding:5px 8px;font-weight:800;border:1px solid #9ca3af;border-radius:5px;background:#fff;cursor:pointer';
    b.onclick = onClick;
    return b;
  }

  function render() {
    if (!pre || !box) return;
    pre.textContent = output();
    box.style.borderColor = rows.some(r => r.path === '/api/close-container') ? '#16a34a' : '#f59e0b';
  }

  function mount() {
    if (box || !document.body) return;

    box = document.createElement('div');
    box.style.cssText = [
      'position:fixed','top:10px','right:10px','z-index:2147483647','width:540px','max-height:60vh',
      'background:#fff','color:#111827','border:3px solid #f59e0b','border-radius:8px','box-shadow:0 8px 24px #0004',
      'font:12px Arial,sans-serif','padding:8px'
    ].join(';');

    const title = document.createElement('div');
    title.textContent = 'SIDELINE CLOSE — 3 PATH CAPTURE';
    title.style.cssText = 'font-weight:900;margin-bottom:6px';

    const cases = document.createElement('div');
    cases.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap;margin-bottom:6px';
    cases.append(
      makeButton('1 — Inventory / NO', () => markCase('1_INVENTORY_EMPTY_NO')),
      makeButton('2 — Inventory / YES', () => markCase('2_INVENTORY_EMPTY_YES')),
      makeButton('3 — No inventory', () => markCase('3_NO_INVENTORY_DIRECT_CLOSE')),
      makeButton('Stop case', stopCase)
    );

    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;gap:5px;margin-bottom:6px';

    const copy = makeButton('Copy', async () => {
      await navigator.clipboard.writeText(output());
      copy.textContent = 'Copied';
      setTimeout(() => copy.textContent = 'Copy', 900);
    });

    const clear = makeButton('Clear', () => {
      rows.length = 0;
      activeCase = 'UNSET';
      render();
    });

    controls.append(clear, copy);

    const help = document.createElement('div');
    help.style.cssText = 'margin-bottom:6px;line-height:1.35';
    help.innerHTML = '<b>Use:</b> load the container, click the matching case, perform Close container normally, then click Stop case. Captures same-origin /api/ traffic only while a case is armed. It never sends or changes a request.';

    pre = document.createElement('pre');
    pre.style.cssText = 'margin:0;max-height:40vh;overflow:auto;white-space:pre-wrap;word-break:break-word;background:#f8fafc;padding:7px;border-radius:5px';

    box.append(title, cases, controls, help, pre);
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

  XHR.prototype.send = function(body) {
    const meta = this.__bwu2Close3PathCapture;
    if (!meta) return send.apply(this, arguments);

    const requestBody = parseBody(body);
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
