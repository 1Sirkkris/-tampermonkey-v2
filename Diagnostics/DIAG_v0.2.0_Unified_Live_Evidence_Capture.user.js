// ==UserScript==
// @name         DIAG v0.2.0 Unified Live Evidence Capture
// @namespace    BWU2
// @version      0.2.0
// @description  Sanitized local capture for Sideline, AFT, Dropzone, Bin hierarchy and performance evidence.
// @match        https://aft-poirot-website-nrt.nrt.proxy.amazon.com/*
// @match        *://aft-qt-*.corp.amazon.com/*
// @match        *://aft-moveapp-*.proxy.amazon.com/*
// @match        *://aft-moveapp-*.nrt.proxy.amazon.com/*
// @include      /^https?:\/\/.*fcresearch.*\//
// @include      /^https?:\/\/qifcr\.fe\.aftx\.amazonoperations\.app\//
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  if (window.__bwu2UnifiedEvidence_v020) return;
  window.__bwu2UnifiedEvidence_v020 = true;

  const VERSION = '0.2.0';
  const STORE_KEY = '__bwu2_live_evidence_v020';
  const MAX_EVENTS = 600;
  const MAX_DEPTH = 6;
  const MAX_BODY_CHARS = 12000;
  const FLUSH_MS = 300;
  const MUTATION_REPORT_MS = 5000;
  const SENSITIVE_KEY = /auth|authorization|cookie|credential|csrf|jwt|password|secret|session|signature|token|x-amz/i;
  const IDENTIFIER_KEY = /(?:^|_)(?:asin|barcode|code|container|customer|destination|fcsku|fnsku|id|item|lpn|object|pod|scannable|sku|source)(?:$|_)/i;
  const SAFE_QUERY_KEY = /^(?:action|mode|page|sort|state|tab|type|view)$/i;
  const INTERESTING_PATH = /(?:\/api\/|\/action|\/status|\/end|container-hierarchy|edititems|fcskuflip|moveitems|move-container)/i;

  let active = true;
  let mounted = false;
  let host;
  let statusNode;
  let flushTimer = 0;
  let mutationObserver;
  let mutationStarted = performance.now();
  let mutationStats = emptyMutationStats();
  const startedAt = new Date().toISOString();
  const events = loadEvents();

  function emptyMutationStats() {
    return { batches:0, records:0, added:0, removed:0, attributes:0, text:0, maxBatch:0, targets:{} };
  }

  function hash(value) {
    let out = 2166136261;
    for (const char of String(value ?? '')) {
      out ^= char.charCodeAt(0);
      out = Math.imul(out, 16777619);
    }
    return (out >>> 0).toString(36).padStart(7, '0').slice(0, 7);
  }

  function fingerprint(value, kind = 'id') {
    const text = String(value ?? '');
    return `<${kind}#${hash(text)}:${text.length}>`;
  }

  function scrubText(value) {
    let text = String(value ?? '');
    text = text
      .replace(/(["']?(?:authorization|cookie|csrf|jwt|password|secret|session|signature|token)["']?\s*[:=]\s*)["']?[^,"'\s}]+/gi, '$1<redacted>')
      .replace(/\b(?:ts|cs)x[A-Za-z0-9_-]+\b/gi, match => fingerprint(match, 'container'))
      .replace(/\bP-\d-(?:[A-Z]\d{3}){2}\b/g, match => fingerprint(match, 'pod'))
      .replace(/\b(?:B0|X0|ZZ)[A-Z0-9]{8}\b/gi, match => fingerprint(match, 'item'))
      .replace(/\bLPN[A-Z0-9_-]+\b/gi, match => fingerprint(match, 'lpn'))
      .replace(/\b\d{8,14}\b/g, match => fingerprint(match, 'numeric-id'))
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, match => fingerprint(match, 'email'));
    return text.length > MAX_BODY_CHARS
      ? `${text.slice(0, MAX_BODY_CHARS)}…<truncated:${text.length}>`
      : text;
  }

  function sanitizeUrl(value) {
    try {
      const url = new URL(String(value ?? ''), location.href);
      for (const [key, raw] of [...url.searchParams.entries()]) {
        url.searchParams.set(key, SAFE_QUERY_KEY.test(key) ? scrubText(raw) : fingerprint(raw, `query:${key}`));
      }
      url.username = '';
      url.password = '';
      return url.href;
    } catch {
      return scrubText(value);
    }
  }

  function sanitize(value, key = '', depth = 0, seen = new WeakSet()) {
    if (SENSITIVE_KEY.test(key)) return '<redacted>';
    if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value === 'bigint') return String(value);
    if (typeof value === 'string') {
      if (IDENTIFIER_KEY.test(key)) return fingerprint(value, key || 'id');
      if (/url|uri|href/i.test(key) || /^https?:\/\//i.test(value)) return sanitizeUrl(value);
      return scrubText(value);
    }
    if (depth >= MAX_DEPTH) return `<max-depth:${Object.prototype.toString.call(value).slice(8, -1)}>`;
    if (typeof value !== 'object') return `<${typeof value}>`;
    if (seen.has(value)) return '<circular>';
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 50).map(item => sanitize(item, key, depth + 1, seen));
    const output = {};
    for (const [childKey, childValue] of Object.entries(value).slice(0, 100)) {
      output[childKey] = sanitize(childValue, childKey, depth + 1, seen);
    }
    return output;
  }

  function parseBody(body) {
    if (body == null) return null;
    try {
      if (typeof body === 'string') {
        try { return sanitize(JSON.parse(body)); } catch { return scrubText(body); }
      }
      if (body instanceof URLSearchParams) return sanitize(Object.fromEntries(body.entries()));
      if (body instanceof FormData) return sanitize(Object.fromEntries(body.entries()));
      if (body instanceof Blob) return `<Blob:${body.type || 'unknown'}:${body.size}>`;
      if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return `<binary:${body.byteLength}>`;
      return sanitize(body);
    } catch (error) {
      return `<body-read-failed:${scrubText(error?.message || error)}>`;
    }
  }

  function parseResponseText(text, contentType = '') {
    const raw = String(text ?? '');
    if (/json/i.test(contentType) || /^[\s]*[\[{]/.test(raw)) {
      try { return sanitize(JSON.parse(raw)); } catch {}
    }
    return scrubText(raw);
  }

  function loadEvents() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(STORE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.slice(-MAX_EVENTS) : [];
    } catch {
      return [];
    }
  }

  function schedulePersist() {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushTimer = 0;
      try { sessionStorage.setItem(STORE_KEY, JSON.stringify(events)); } catch {}
    }, FLUSH_MS);
  }

  function add(type, data = {}) {
    if (!active) return;
    events.push({
      at: new Date().toISOString(),
      sinceStartMs: Math.round(performance.now()),
      type,
      page: sanitizeUrl(location.href),
      data: sanitize(data)
    });
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    schedulePersist();
    renderStatus();
  }

  function targetInfo(target) {
    const element = target instanceof Element ? target : target?.parentElement;
    if (!element) return { tag:'unknown' };
    const label = element.getAttribute('aria-label') || element.getAttribute('title') || element.innerText || element.textContent || '';
    return {
      tag: element.tagName?.toLowerCase() || 'unknown',
      id: element.id ? scrubText(element.id) : '',
      classes: [...element.classList].slice(0, 8).map(scrubText),
      role: element.getAttribute('role') || '',
      name: element.getAttribute('name') || '',
      type: element.getAttribute('type') || '',
      label: scrubText(String(label).replace(/\s+/g, ' ').trim().slice(0, 120))
    };
  }

  function bodyFromRequest(input, init) {
    if (init?.body != null) return parseBody(init.body);
    if (typeof Request !== 'undefined' && input instanceof Request) return '<Request body unavailable without consumption>';
    return null;
  }

  function installFetchCapture() {
    const original = window.fetch;
    if (typeof original !== 'function') return;

    window.fetch = async function(input, init) {
      const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input?.url || '';
      const method = String(init?.method || input?.method || 'GET').toUpperCase();
      const requestBody = bodyFromRequest(input, init);
      const started = performance.now();
      try {
        const response = await original.apply(this, arguments);
        const base = {
          transport:'fetch', method, url:sanitizeUrl(rawUrl), requestBody,
          status:response.status, ok:response.ok, ms:Math.round(performance.now() - started),
          contentType:response.headers.get('content-type') || ''
        };
        void response.clone().text()
          .then(text => add('network', { ...base, responseBody:parseResponseText(text, base.contentType) }))
          .catch(error => add('network', { ...base, responseReadError:scrubText(error?.message || error) }));
        return response;
      } catch (error) {
        add('network', {
          transport:'fetch', method, url:sanitizeUrl(rawUrl), requestBody,
          error:scrubText(error?.message || error), ms:Math.round(performance.now() - started)
        });
        throw error;
      }
    };
  }

  function installXhrCapture() {
    const XHR = window.XMLHttpRequest;
    if (!XHR?.prototype) return;
    const originalOpen = XHR.prototype.open;
    const originalSend = XHR.prototype.send;

    XHR.prototype.open = function(method, url) {
      this.__bwu2Evidence = { method:String(method || 'GET').toUpperCase(), url:String(url || '') };
      return originalOpen.apply(this, arguments);
    };

    XHR.prototype.send = function(body) {
      const meta = this.__bwu2Evidence || { method:'GET', url:'' };
      const started = performance.now();
      this.addEventListener('loadend', () => {
        let responseBody = null;
        try {
          responseBody = this.responseType && this.responseType !== 'text'
            ? sanitize(this.response)
            : parseResponseText(this.responseText, this.getResponseHeader('content-type') || '');
        } catch (error) {
          responseBody = `<response-read-failed:${scrubText(error?.message || error)}>`;
        }
        add('network', {
          transport:'xhr', method:meta.method, url:sanitizeUrl(meta.url), requestBody:parseBody(body),
          status:this.status, ok:this.status >= 200 && this.status < 300,
          ms:Math.round(performance.now() - started), responseBody
        });
      }, { once:true });
      return originalSend.apply(this, arguments);
    };
  }

  function installActionCapture() {
    document.addEventListener('click', event => {
      if (host?.contains(event.target)) return;
      add('ui.click', targetInfo(event.target));
    }, true);
    document.addEventListener('submit', event => add('ui.submit', targetInfo(event.target)), true);
    document.addEventListener('keydown', event => {
      if (!['Enter','Escape','Tab'].includes(event.key) && !event.altKey && !event.ctrlKey && !event.metaKey) return;
      add('ui.key', {
        key:event.key, alt:event.altKey, ctrl:event.ctrlKey, meta:event.metaKey, shift:event.shiftKey,
        target:targetInfo(event.target), valueLength:String(event.target?.value || '').length
      });
    }, true);
    for (const name of ['hashchange','popstate','pageshow','pagehide']) {
      window.addEventListener(name, () => add(`page.${name}`, { visibility:document.visibilityState }), true);
    }
    document.addEventListener('visibilitychange', () => add('page.visibility', { visibility:document.visibilityState }), true);
  }

  function mutationTargetName(target) {
    const element = target?.nodeType === 1 ? target : target?.parentElement;
    if (!element) return 'unknown';
    if (host?.contains(element)) return 'diagnostic';
    return `${element.tagName?.toLowerCase() || 'node'}${element.id ? `#${element.id}` : ''}`.slice(0, 100);
  }

  function installMutationCapture() {
    mutationObserver = new MutationObserver(records => {
      const filtered = records.filter(record => !host?.contains(record.target));
      if (!filtered.length) return;
      mutationStats.batches++;
      mutationStats.records += filtered.length;
      mutationStats.maxBatch = Math.max(mutationStats.maxBatch, filtered.length);
      for (const record of filtered) {
        mutationStats.added += record.addedNodes?.length || 0;
        mutationStats.removed += record.removedNodes?.length || 0;
        if (record.type === 'attributes') mutationStats.attributes++;
        if (record.type === 'characterData') mutationStats.text++;
        const name = mutationTargetName(record.target);
        mutationStats.targets[name] = (mutationStats.targets[name] || 0) + 1;
      }
    });
    const begin = () => {
      if (!document.documentElement) return;
      mutationObserver.observe(document.documentElement, { subtree:true, childList:true, attributes:true, characterData:true });
    };
    document.documentElement ? begin() : document.addEventListener('DOMContentLoaded', begin, { once:true });
    setInterval(() => {
      if (!active || !mutationStats.records) return;
      const elapsedMs = Math.round(performance.now() - mutationStarted);
      const targets = Object.entries(mutationStats.targets).sort((a,b) => b[1] - a[1]).slice(0, 10);
      add('performance.mutations', { elapsedMs, ...mutationStats, targets });
      mutationStats = emptyMutationStats();
      mutationStarted = performance.now();
    }, MUTATION_REPORT_MS);
  }

  function installPerformanceCapture() {
    if (typeof PerformanceObserver !== 'function') return;
    for (const type of ['longtask','resource']) {
      try {
        const observer = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            if (type === 'resource' && !INTERESTING_PATH.test(entry.name)) continue;
            add(`performance.${type}`, {
              name:type === 'resource' ? sanitizeUrl(entry.name) : entry.name,
              initiatorType:entry.initiatorType || '',
              durationMs:Math.round(entry.duration),
              startMs:Math.round(entry.startTime),
              transferSize:Number(entry.transferSize || 0),
              decodedBodySize:Number(entry.decodedBodySize || 0)
            });
          }
        });
        observer.observe({ type, buffered:true });
      } catch {}
    }
  }

  function networkSummary() {
    const rows = events.filter(event => event.type === 'network');
    const signatures = {};
    for (const row of rows) {
      const url = row.data?.url || '';
      let path = url;
      try { path = new URL(url).pathname; } catch {}
      const key = `${row.data?.method || 'GET'} ${path}`;
      const item = signatures[key] || { count:0, failures:0, totalMs:0, maxMs:0 };
      item.count++;
      if (row.data?.ok === false || row.data?.error) item.failures++;
      item.totalMs += Number(row.data?.ms || 0);
      item.maxMs = Math.max(item.maxMs, Number(row.data?.ms || 0));
      signatures[key] = item;
    }
    for (const item of Object.values(signatures)) item.averageMs = item.count ? Math.round(item.totalMs / item.count) : 0;
    return signatures;
  }

  function report() {
    return {
      capture:{ name:'BWU2 Unified Live Evidence', version:VERSION, startedAt, exportedAt:new Date().toISOString() },
      privacy:{ headers:'only response content-type captured', cookies:'not captured', credentials:'not captured', identifiers:'fingerprinted' },
      environment:{ host:location.host, path:location.pathname, userAgent:navigator.userAgent, viewport:`${innerWidth}x${innerHeight}` },
      summary:{ events:events.length, networks:events.filter(event => event.type === 'network').length, requests:networkSummary() },
      events
    };
  }

  function output() {
    return `BWU2 UNIFIED LIVE EVIDENCE v${VERSION}\n` +
      `Safe to share internally after a quick visual check: sensitive headers/cookies/tokens are omitted; IDs are fingerprinted.\n\n` +
      JSON.stringify(report(), null, 2);
  }

  async function copyOutput(button) {
    await navigator.clipboard.writeText(output());
    const old = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => { if (button.isConnected) button.textContent = old; }, 900);
  }

  function downloadOutput() {
    const blob = new Blob([output()], { type:'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `bwu2-live-evidence-${location.hostname}-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function renderStatus() {
    if (!statusNode) return;
    const networks = events.filter(event => event.type === 'network').length;
    statusNode.textContent = `${active ? 'CAPTURING' : 'PAUSED'} • ${events.length} events • ${networks} network`;
    statusNode.style.color = active ? '#166534' : '#9a3412';
  }

  function button(label, onClick) {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = label;
    node.style.cssText = 'border:1px solid #94a3b8;border-radius:4px;background:#fff;color:#0f172a;padding:4px 7px;font:800 11px Arial;cursor:pointer';
    node.addEventListener('click', event => onClick(event.currentTarget));
    return node;
  }

  function mount() {
    if (mounted || !document.documentElement) return;
    mounted = true;
    host = document.createElement('div');
    host.id = 'bwu2-live-evidence';
    host.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:2147483647;font-family:Arial,sans-serif';
    const shadow = host.attachShadow({ mode:'closed' });
    const panel = document.createElement('div');
    panel.style.cssText = 'width:330px;background:#f8fafc;color:#0f172a;border:2px solid #2563eb;border-radius:8px;box-shadow:0 8px 24px #0004;padding:8px';
    const title = document.createElement('div');
    title.textContent = 'LIVE EVIDENCE PACK';
    title.style.cssText = 'font:900 12px Arial;margin-bottom:4px';
    statusNode = document.createElement('div');
    statusNode.style.cssText = 'font:800 11px Arial;margin-bottom:7px';
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap';
    const pause = button('Pause', node => {
      active = !active;
      node.textContent = active ? 'Pause' : 'Resume';
      renderStatus();
    });
    actions.append(
      button('Mark', () => add('manual.mark', { note:scrubText(prompt('Short marker (no IDs):', '') || '') })),
      button('Copy', copyOutput),
      button('Download', downloadOutput),
      button('Clear', () => { events.length = 0; try { sessionStorage.removeItem(STORE_KEY); } catch {} renderStatus(); }),
      pause
    );
    const note = document.createElement('div');
    note.textContent = 'Only Content-Type retained. IDs fingerprinted. Review before sharing.';
    note.style.cssText = 'margin-top:6px;color:#475569;font:10px/1.25 Arial';
    panel.append(title, statusNode, actions, note);
    shadow.append(panel);
    document.documentElement.appendChild(host);
    renderStatus();
  }

  window.__bwu2LiveEvidence = Object.freeze({
    version:VERSION,
    mark:note => add('manual.mark', { note:scrubText(note) }),
    pause:() => { active = false; renderStatus(); },
    resume:() => { active = true; renderStatus(); },
    clear:() => { events.length = 0; try { sessionStorage.removeItem(STORE_KEY); } catch {} renderStatus(); },
    report,
    output
  });

  installFetchCapture();
  installXhrCapture();
  installActionCapture();
  installMutationCapture();
  installPerformanceCapture();
  document.documentElement ? mount() : document.addEventListener('DOMContentLoaded', mount, { once:true });
  add('capture.start', { version:VERSION, host:location.host, path:location.pathname });
})();
