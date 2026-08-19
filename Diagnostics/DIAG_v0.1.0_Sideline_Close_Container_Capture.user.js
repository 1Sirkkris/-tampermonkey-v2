// ==UserScript==
// @name         DIAG v0.1.0 Sideline Close Container Capture
// @namespace    BWU2
// @version      0.1.0
// @description  Temporary local-only capture for Sideline close-container request/response.
// @match        https://aft-poirot-website-nrt.nrt.proxy.amazon.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';

  if (window.__bwu2CloseCapture) return;
  window.__bwu2CloseCapture = true;

  const TARGETS = ['/api/close-container', '/api/scan-source-container'];
  const rows = [];
  const MAX = 30;
  let box;
  let pre;

  const clean = v => String(v ?? '').trim();
  const interesting = url => TARGETS.some(path => clean(url).includes(path));

  function parseBody(body) {
    if (body == null) return null;
    if (typeof body === 'string') {
      try { return JSON.parse(body); } catch { return body; }
    }
    if (body instanceof URLSearchParams) return Object.fromEntries(body.entries());
    if (body instanceof FormData) return Object.fromEntries(body.entries());
    return `[${body?.constructor?.name || typeof body}]`;
  }

  function add(entry) {
    rows.push({ time:new Date().toISOString(), ...entry });
    if (rows.length > MAX) rows.splice(0, rows.length - MAX);
    render();
  }

  function output() {
    return [
      'BWU2 CLOSE CONTAINER CAPTURE v0.1.0',
      `Captured: ${rows.length}`,
      '',
      JSON.stringify(rows, null, 2)
    ].join('\n');
  }

  function render() {
    if (!pre) return;
    pre.textContent = output();
    box.style.borderColor = rows.some(r => clean(r.url).includes('/api/close-container')) ? '#16a34a' : '#f59e0b';
  }

  function mount() {
    if (box || !document.body) return;

    box = document.createElement('div');
    box.style.cssText = [
      'position:fixed','top:10px','right:10px','z-index:2147483647','width:430px','max-height:46vh',
      'background:#fff','color:#111827','border:3px solid #f59e0b','border-radius:8px','box-shadow:0 8px 24px #0004',
      'font:12px Arial,sans-serif','padding:8px'
    ].join(';');

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;font-weight:900';
    head.innerHTML = '<span>CLOSE CAPTURE — waiting</span>';

    const buttons = document.createElement('div');
    const copy = document.createElement('button');
    copy.textContent = 'Copy';
    copy.style.cssText = 'margin-left:4px;padding:4px 8px;font-weight:800';
    copy.onclick = async () => {
      await navigator.clipboard.writeText(output());
      copy.textContent = 'Copied';
      setTimeout(() => copy.textContent = 'Copy', 900);
    };

    const clear = document.createElement('button');
    clear.textContent = 'Clear';
    clear.style.cssText = 'margin-left:4px;padding:4px 8px;font-weight:800';
    clear.onclick = () => { rows.length = 0; render(); };

    buttons.append(clear, copy);
    head.appendChild(buttons);

    pre = document.createElement('pre');
    pre.style.cssText = 'margin:0;max-height:38vh;overflow:auto;white-space:pre-wrap;word-break:break-word;background:#f8fafc;padding:7px;border-radius:5px';

    box.append(head, pre);
    document.body.appendChild(box);
    render();
  }

  const realFetch = window.fetch;
  window.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (!interesting(url)) return realFetch.apply(this, arguments);

    const method = clean(init?.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();
    const requestBody = parseBody(init?.body);
    const started = performance.now();

    try {
      const response = await realFetch.apply(this, arguments);
      let responseBody = null;
      try {
        const clone = response.clone();
        const txt = await clone.text();
        try { responseBody = JSON.parse(txt); } catch { responseBody = txt; }
      } catch (e) {
        responseBody = `[response read failed: ${e?.message || e}]`;
      }

      add({
        transport:'fetch', method, url,
        requestBody,
        status:response.status,
        ok:response.ok,
        ms:Math.round(performance.now() - started),
        responseBody
      });
      return response;
    } catch (error) {
      add({
        transport:'fetch', method, url,
        requestBody,
        error:error?.message || String(error),
        ms:Math.round(performance.now() - started)
      });
      throw error;
    }
  };

  const XHR = window.XMLHttpRequest;
  const open = XHR.prototype.open;
  const send = XHR.prototype.send;

  XHR.prototype.open = function(method, url) {
    this.__bwu2Capture = interesting(url) ? { method:clean(method).toUpperCase(), url:String(url) } : null;
    return open.apply(this, arguments);
  };

  XHR.prototype.send = function(body) {
    const meta = this.__bwu2Capture;
    if (!meta) return send.apply(this, arguments);

    const requestBody = parseBody(body);
    const started = performance.now();
    this.addEventListener('loadend', () => {
      let responseBody = this.responseText;
      try { responseBody = JSON.parse(responseBody); } catch {}
      add({
        transport:'xhr', method:meta.method, url:meta.url,
        requestBody,
        status:this.status,
        ok:this.status >= 200 && this.status < 300,
        ms:Math.round(performance.now() - started),
        responseBody
      });
    }, { once:true });

    return send.apply(this, arguments);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once:true });
  } else {
    mount();
  }
})();
