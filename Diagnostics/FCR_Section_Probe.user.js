// ==UserScript==
// @name         DIAG v0.2.0 FCResearch Section Probe
// @namespace    https://github.com/1Sirkkris
// @version      0.2.0
// @description  Temporary FCResearch section/request mapper with one explicit, reversible Product request suppression test.
// @include      /^https?:\/\/.*fcresearch.*\//
// @include      /^https?:\/\/qifcr\.fe\.aftx\.amazonoperations\.app\//
// @run-at       document-start
// @grant        none
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Diagnostics/FCR_Section_Probe.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Diagnostics/FCR_Section_Probe.user.js
// ==/UserScript==

(() => {
  'use strict';

  if (window.__BWU2_FCR_SECTION_PROBE_V020__) return;
  window.__BWU2_FCR_SECTION_PROBE_V020__ = true;

  const VERSION = '0.2.0';
  const PREFIX = 'bwu2:fcr-section-probe:v1:';
  const EVENTS_KEY = `${PREFIX}events`;
  const ARM_KEY = `${PREFIX}block-arm`;
  const LEGACY_ARM_KEY = `${PREFIX}delay-arm`;
  const PHASE_KEY = `${PREFIX}phase`;
  const MAX_EVENTS = 500;
  const BLOCK_ENDPOINT = 'product';
  const PAGE_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const PAGE_STARTED_AT = Date.now();
  const XHR_INFO = Symbol('bwu2FcrSectionProbe');

  const SECTION_DEFS = [
    ['product', 'Product'],
    ['inventory', 'Inventory'],
    ['inventory-history', 'Inventory History'],
    ['container-history', 'Container History'],
    ['purchase-order-item', 'Purchase Order Items'],
    ['purchase-order', 'Purchase Order'],
    ['receive-history', 'Receive History'],
    ['shipment', 'Shipment'],
    ['container-hierarchy', 'Container Details'],
    ['employee', 'Employee'],
    ['carton-general-info', 'Carton General Information'],
    ['carton-contents', 'Carton Contents'],
    ['sscc-info', 'SSCC Information'],
    ['carton-ambiguities', 'Items in Multiple Cartons'],
    ['vision-tunnel', 'Vision Tunnel'],
    ['problems', 'Problems'],
    ['problem', 'Problem'],
    ['event', 'Events'],
    ['authenticity-item', 'Authenticity Item']
  ].map(([endpoint, label]) => ({ endpoint, label }));

  const SECTION_ENDPOINTS = new Set(SECTION_DEFS.map(def => def.endpoint));
  const HEADING_SELECTOR = 'h1,h2,h3,h4,h5,.section-title,.a-section-title,[data-section-title]';
  const mountedSections = new Set();
  let events = readJson(EVENTS_KEY, []);
  let requestSeq = 0;
  let uiRoot;
  let uiStatus;
  let uiArm;
  let uiCount;
  let mutationObserver;
  let scanFrame = 0;
  const pendingScanRoots = new Set();

  function clean(value) {
    return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function normalized(value) {
    return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function readJson(key, fallback) {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(key) || 'null');
      return parsed == null ? fallback : parsed;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function phase() {
    try { return sessionStorage.getItem(PHASE_KEY) || 'baseline'; }
    catch { return 'baseline'; }
  }

  function setPhase(value) {
    try { sessionStorage.setItem(PHASE_KEY, value); } catch {}
  }

  function armState() {
    const arm = readJson(ARM_KEY, null);
    return arm?.armed === true && arm.endpoint === BLOCK_ENDPOINT ? arm : null;
  }

  function setArm(armed) {
    if (armed) {
      mountedSections.clear();
      writeJson(ARM_KEY, {
        armed: true,
        endpoint: BLOCK_ENDPOINT,
        mode: 'suppress-once',
        armedAt: new Date().toISOString()
      });
      try { sessionStorage.removeItem(LEGACY_ARM_KEY); } catch {}
      setPhase('block-test');
      add('test.armed', { endpoint: BLOCK_ENDPOINT, mode: 'suppress-once' });
    } else {
      try { sessionStorage.removeItem(ARM_KEY); } catch {}
      add('test.disarmed', { endpoint: BLOCK_ENDPOINT });
    }
    renderUi();
  }

  function consumeArm(endpoint) {
    const arm = armState();
    if (!arm || endpoint !== arm.endpoint) return false;
    try { sessionStorage.removeItem(ARM_KEY); } catch {}
    renderUi();
    return true;
  }

  function add(type, data = {}) {
    const entry = {
      at: new Date().toISOString(),
      pageId: PAGE_ID,
      pageMs: Math.max(0, Date.now() - PAGE_STARTED_AT),
      phase: phase(),
      type,
      ...data
    };
    events.push(entry);
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    writeJson(EVENTS_KEY, events);
    renderUi();
    return entry;
  }

  function clearCapture() {
    events = [];
    mountedSections.clear();
    try {
      sessionStorage.removeItem(EVENTS_KEY);
      sessionStorage.removeItem(ARM_KEY);
      sessionStorage.removeItem(LEGACY_ARM_KEY);
    } catch {}
    setPhase('baseline');
    add('capture.cleared', {});
    snapshotPage('clear');
    renderUi('Cleared • refresh for baseline');
  }

  function parsedUrl(rawUrl) {
    try { return new URL(String(rawUrl || ''), location.href); }
    catch { return null; }
  }

  function endpointFromUrl(rawUrl) {
    const url = parsedUrl(rawUrl);
    if (!url) return '';
    const host = url.hostname.toLowerCase();
    if (!host.includes('fcresearch') && host !== 'qifcr.fe.aftx.amazonoperations.app') return '';
    const match = url.pathname.match(/\/results\/([^/?#]+)/i);
    if (!match) return '';
    const endpoint = clean(decodeURIComponent(match[1])).toLowerCase();
    return SECTION_ENDPOINTS.has(endpoint) || /^[a-z0-9-]{1,60}$/.test(endpoint) ? endpoint : '';
  }

  function classifySearch(value) {
    const text = clean(value);
    if (!text) return 'empty';
    if (/^(?:ts|cs)x[A-Za-z0-9_-]+$/i.test(text)) return 'container';
    if (/^(?:B0|X0|ZZ)[A-Z0-9]{8}$/i.test(text)) return 'item';
    if (/^P-\d-(?:[A-Z]\d{3}){2}$/i.test(text)) return 'pod';
    if (/^\d{8,14}$/.test(text)) return 'numeric';
    return 'text';
  }

  function requestShape(body) {
    let value = body;
    try {
      if (typeof body === 'string') value = Object.fromEntries(new URLSearchParams(body).entries());
      else if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) value = Object.fromEntries(body.entries());
      else if (typeof FormData !== 'undefined' && body instanceof FormData) value = Object.fromEntries(body.entries());
    } catch {}

    if (!value || typeof value !== 'object' || Array.isArray(value)) return { kind: typeof value };
    const keys = Object.keys(value).slice(0, 30).sort();
    const shape = { kind: 'object', keys };
    if (Object.prototype.hasOwnProperty.call(value, 's')) shape.searchKind = classifySearch(value.s);
    return shape;
  }

  function installXhrProbe() {
    const XHR = window.XMLHttpRequest;
    if (!XHR?.prototype || XHR.prototype.__bwu2FcrSectionProbeV1) return;

    const originalOpen = XHR.prototype.open;
    const originalSend = XHR.prototype.send;
    const originalAbort = XHR.prototype.abort;

    XHR.prototype.open = function(method, url) {
      const endpoint = endpointFromUrl(url);
      this[XHR_INFO] = endpoint ? {
        id: `${PAGE_ID}-x${++requestSeq}`,
        endpoint,
        method: String(method || 'GET').toUpperCase(),
        transport: 'xhr',
        startedAt: 0,
        sent: false,
        blocked: false
      } : null;
      return originalOpen.apply(this, arguments);
    };

    XHR.prototype.send = function(body) {
      const xhr = this;
      const info = xhr[XHR_INFO];
      if (!info) return originalSend.apply(xhr, arguments);

      const sendArgs = [...arguments];
      info.startedAt = performance.now();
      add('request.start', {
        requestId: info.id,
        endpoint: info.endpoint,
        method: info.method,
        transport: info.transport,
        request: requestShape(body)
      });

      xhr.addEventListener('loadend', () => {
        const ms = Math.max(0, Math.round(performance.now() - info.startedAt));
        let text = '';
        let contentType = '';
        try {
          if (!xhr.responseType || xhr.responseType === 'text') text = xhr.responseText || '';
          contentType = xhr.getResponseHeader('content-type') || '';
        } catch {}
        add('request.end', {
          requestId: info.id,
          endpoint: info.endpoint,
          method: info.method,
          transport: info.transport,
          status: Number(xhr.status || 0),
          ok: xhr.status >= 200 && xhr.status < 300,
          ms,
          blocked: info.blocked === true,
          responseChars: text.length,
          contentType: clean(contentType).split(';')[0].slice(0, 80)
        });
        scheduleDocumentScan();
      }, { once: true });

      if (consumeArm(info.endpoint)) {
        info.blocked = true;
        add('block.prevented', {
          requestId: info.id,
          endpoint: info.endpoint,
          transport: info.transport
        });
        window.setTimeout(() => add('block.checkpoint', {
          endpoint: info.endpoint,
          mounted: [...mountedSections].sort()
        }), 2500);
        renderUi('Product blocked • inspect, COPY, refresh');
        return undefined;
      }

      info.sent = true;
      try {
        return originalSend.apply(xhr, sendArgs);
      } catch (error) {
        add('request.throw', {
          requestId: info.id,
          endpoint: info.endpoint,
          transport: info.transport,
          error: clean(error?.name || 'Error').slice(0, 80)
        });
        throw error;
      }
    };

    XHR.prototype.abort = function() {
      const info = this[XHR_INFO];
      if (info?.blocked && !info.sent) {
        add('block.native-abort', {
          requestId: info.id,
          endpoint: info.endpoint,
          transport: info.transport
        });
      }
      return originalAbort.apply(this, arguments);
    };

    XHR.prototype.__bwu2FcrSectionProbeV1 = true;
  }

  function endpointForHeading(text) {
    const value = normalized(text);
    if (!value || value.length > 100) return '';
    for (const def of [...SECTION_DEFS].sort((a, b) => b.label.length - a.label.length)) {
      const label = normalized(def.label);
      if (value === label || value.startsWith(`${label} `)) return def.endpoint;
    }
    return '';
  }

  function isSidebarNode(node) {
    try {
      if (node.closest('aside,#sidebar,.sidebar,[class*="sidebar"],[class*="side-nav"],[class*="sidenav"]')) return true;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.left > window.innerWidth * 0.76 && rect.width < window.innerWidth * 0.30;
    } catch {
      return false;
    }
  }

  function inspectHeading(node) {
    if (!(node instanceof Element) || isSidebarNode(node)) return;
    const endpoint = endpointForHeading(node.textContent);
    if (!endpoint || mountedSections.has(endpoint)) return;
    mountedSections.add(endpoint);
    add('dom.mount', {
      endpoint,
      tag: node.tagName.toLowerCase(),
      requestActive: events.some(event => event.pageId === PAGE_ID && event.endpoint === endpoint && event.type === 'request.start')
        && !events.some(event => event.pageId === PAGE_ID && event.endpoint === endpoint && event.type === 'request.end')
    });
  }

  function scanRoot(root) {
    if (!(root instanceof Element) && root !== document) return;
    if (root instanceof Element && root.matches(HEADING_SELECTOR)) inspectHeading(root);
    try { root.querySelectorAll(HEADING_SELECTOR).forEach(inspectHeading); } catch {}
  }

  function flushScanQueue() {
    scanFrame = 0;
    const roots = [...pendingScanRoots];
    pendingScanRoots.clear();
    roots.forEach(scanRoot);
  }

  function queueScan(root) {
    if (root instanceof Element) pendingScanRoots.add(root);
    if (!scanFrame) scanFrame = requestAnimationFrame(flushScanQueue);
  }

  function scheduleDocumentScan() {
    if (document.documentElement) queueScan(document.documentElement);
  }

  function installDomProbe() {
    const start = () => {
      scheduleDocumentScan();
      if (mutationObserver || !document.documentElement) return;
      mutationObserver = new MutationObserver(records => {
        for (const record of records) {
          for (const node of record.addedNodes) if (node instanceof Element) queueScan(node);
        }
      });
      mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
    };

    if (document.documentElement) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  }

  function warehouseId() {
    const match = location.pathname.match(/^\/([^/]+)\/results(?:\/|$)/i);
    return match ? clean(match[1]).slice(0, 12) : '';
  }

  function snapshotPage(reason) {
    const params = new URLSearchParams(location.search);
    add('page.snapshot', {
      reason,
      path: location.pathname,
      warehouse: warehouseId(),
      hasSearch: params.has('s'),
      searchKind: params.has('s') ? classifySearch(params.get('s')) : 'empty',
      hasProfile: params.has('profile'),
      hashMode: location.hash.startsWith('#fcr-') ? location.hash.slice(1, 40) : ''
    });
  }

  function phaseSummary() {
    const summaries = {};
    for (const event of events) {
      const key = event.phase || 'unknown';
      const summary = summaries[key] ||= { requests: {}, mounted: [], interventions: [] };
      if (event.type === 'request.end') {
        const stat = summary.requests[event.endpoint] ||= {
          count: 0,
          ok: 0,
          failed: 0,
          delayed: 0,
          blocked: 0,
          totalMs: 0,
          maxMs: 0,
          transports: []
        };
        stat.count++;
        if (event.ok) stat.ok++;
        else stat.failed++;
        if (event.delayed) stat.delayed++;
        if (event.blocked) stat.blocked++;
        stat.totalMs += Number(event.ms || 0);
        stat.maxMs = Math.max(stat.maxMs, Number(event.ms || 0));
        if (event.transport && !stat.transports.includes(event.transport)) stat.transports.push(event.transport);
      } else if (event.type === 'dom.mount' && !summary.mounted.includes(event.endpoint)) {
        summary.mounted.push(event.endpoint);
      } else if (event.type.startsWith('delay.') || event.type.startsWith('block.')) {
        summary.interventions.push({ type: event.type, endpoint: event.endpoint, at: event.at });
      }
    }

    for (const summary of Object.values(summaries)) {
      for (const stat of Object.values(summary.requests)) {
        stat.averageMs = stat.count ? Math.round(stat.totalMs / stat.count) : 0;
        delete stat.totalMs;
        stat.transports.sort();
      }
      summary.mounted.sort();
    }
    return summaries;
  }

  function output() {
    return [
      `BWU2 FCResearch Section Probe v${VERSION}`,
      `Exported: ${new Date().toISOString()}`,
      `Events: ${events.length}`,
      `Test target: ${BLOCK_ENDPOINT} (one-shot request suppression; arm auto-consumed)`,
      'Privacy: search/profile values and response bodies are excluded.',
      '',
      'SUMMARY',
      JSON.stringify(phaseSummary(), null, 2),
      '',
      'EVENTS',
      JSON.stringify(events, null, 2)
    ].join('\n');
  }

  async function copyOutput() {
    const text = output();
    try {
      await navigator.clipboard.writeText(text);
      renderUi(`Copied ${events.length} events`);
      return;
    } catch {}

    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
      renderUi(`Copied ${events.length} events`);
    } catch {
      renderUi('Copy failed');
    }
    area.remove();
  }

  function renderUi(message = '') {
    if (!uiRoot) return;
    const arm = armState();
    uiArm.textContent = arm ? 'DISARM' : 'ARM BLOCK PRODUCT';
    uiArm.dataset.armed = arm ? '1' : '0';
    uiCount.textContent = `${events.length}`;
    uiStatus.textContent = message || (arm
      ? 'Armed • refresh this result'
      : phase() === 'block-test' ? 'Block test recorded • refresh restores normal' : 'Passive baseline');
  }

  function mountUi() {
    if (uiRoot || !document.body) return;
    uiRoot = document.createElement('div');
    uiRoot.id = 'bwu2-fcr-section-probe';
    uiRoot.innerHTML = `
      <style>
        #bwu2-fcr-section-probe {
          all: initial; position:fixed; left:50%; bottom:10px; transform:translateX(-50%);
          z-index:2147483647; display:flex; align-items:center; gap:6px; padding:6px 8px;
          border:1px solid #334155; border-radius:8px; background:#0f172a; color:#e2e8f0;
          box-shadow:0 4px 18px rgba(0,0,0,.35); font:700 12px/1.2 Arial,sans-serif;
        }
        #bwu2-fcr-section-probe * { box-sizing:border-box; font:inherit; }
        #bwu2-fcr-section-probe .title { color:#93c5fd; white-space:nowrap; }
        #bwu2-fcr-section-probe .status { min-width:120px; color:#cbd5e1; font-weight:600; }
        #bwu2-fcr-section-probe .count { min-width:24px; text-align:center; color:#f8fafc; }
        #bwu2-fcr-section-probe button {
          border:1px solid #475569; border-radius:5px; padding:4px 7px; background:#1e293b;
          color:#f8fafc; cursor:pointer;
        }
        #bwu2-fcr-section-probe button:hover { background:#334155; }
        #bwu2-fcr-section-probe button[data-armed="1"] { border-color:#f59e0b; background:#78350f; }
      </style>
      <span class="title">FCR PROBE v${VERSION}</span>
      <span class="status"></span>
      <span class="count" title="Captured events"></span>
      <button type="button" class="arm"></button>
      <button type="button" class="copy">COPY</button>
      <button type="button" class="clear">CLEAR</button>
    `;
    document.body.appendChild(uiRoot);
    uiStatus = uiRoot.querySelector('.status');
    uiArm = uiRoot.querySelector('.arm');
    uiCount = uiRoot.querySelector('.count');
    uiArm.addEventListener('click', () => setArm(!armState()));
    uiRoot.querySelector('.copy').addEventListener('click', copyOutput);
    uiRoot.querySelector('.clear').addEventListener('click', clearCapture);
    renderUi();
  }

  function startUi() {
    if (document.body) mountUi();
    else document.addEventListener('DOMContentLoaded', mountUi, { once: true });
  }

  add('probe.start', { version: VERSION });
  snapshotPage('script-start');
  installXhrProbe();
  installDomProbe();
  startUi();
  document.addEventListener('DOMContentLoaded', () => add('page.dom-ready', {}), { once: true });
  window.addEventListener('load', () => {
    add('page.load', {});
    scheduleDocumentScan();
  }, { once: true });
})();
