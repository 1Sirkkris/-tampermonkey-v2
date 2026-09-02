// ==UserScript==
// @name         TEST v0.2.13 FCR Data Core — Strict Bin + 30-Day MADCAT
// @namespace    https://github.com/1Sirkkris
// @version      0.2.13
// @description  Shared FCR engine with exact-item-only binDescription and fast authenticated 30-day MADCAT checks.
// @include      /^https?:\/\/.*fcresearch.*\//
// @include      /^https?:\/\/qifcr\.fe\.aftx\.amazonoperations\.app\//
// @include      /^https:\/\/jp\.item-measurement\.aft\.a2z\.com\//
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        unsafeWindow
// @connect      aft-poirot-website-nrt.nrt.proxy.amazon.com
// @connect      pandash.amazon.com
// @connect      o0avbo02yl.execute-api.ap-northeast-1.amazonaws.com
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/FCR_Data_Core.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/FCR_Data_Core.user.js
// ==/UserScript==

(() => {
  'use strict';

  const MEASUREMENT_SITE_HOST = 'jp.item-measurement.aft.a2z.com';
  const MEASUREMENT_API_HOST = 'o0avbo02yl.execute-api.ap-northeast-1.amazonaws.com';
  const MEASUREMENT_AUTH_KEY = 'fcr-data-core:measurement-auth-v1';

  if (location.hostname === MEASUREMENT_SITE_HOST) {
    installMeasurementAuthBridge();
    return;
  }

  if (window.__fcrDataCore_v0210test) return;
  window.__fcrDataCore_v0210test = true;

  const VERSION = '0.2.13';
  const REQUEST_EVENT = 'fcr-data-core:request';
  const RESPONSE_EVENT = 'fcr-data-core:response';
  const PROGRESS_EVENT = 'fcr-data-core:progress';
  const CANCEL_EVENT = 'fcr-data-core:cancel';
  const READY_EVENT = 'fcr-data-core:ready';
  const USAGE_EVENT = 'fcr-usage:event';
  const USAGE_KEY = 'fcr-usage-v1';
  const USAGE_FLUSH_MS = 1500;
  const CACHE_PREFIX = 'fcr-data-core-v4:';
  const PRODUCT_TTL = 5 * 60 * 1000;
  const BIN_TTL = 5 * 60 * 1000;
  const HISTORY_TTL = 2 * 60 * 1000;
  const HAZ_SUCCESS_TTL = 6 * 60 * 60 * 1000;
  const HAZ_FAILURE_TTL = 60 * 1000;
  const REQUEST_TIMEOUT_MS = 15000;
  const MEASUREMENT_TIMEOUT_MS = 6000;
  const MEASUREMENT_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
  const MEASUREMENT_MAX_PAGES = 10;
  const MEASUREMENT_API = `https://${MEASUREMENT_API_HOST}/prod/measurementEvents`;
  const INVENTORY_RETRY_DELAYS_MS = [250, 400, 650, 1000, 1500];
  const SIDELINE_API = 'https://aft-poirot-website-nrt.nrt.proxy.amazon.com/api/scanitem';
  const MARKETPLACE = 'AU';
  const SECTION_ENDPOINTS = new Set([
    'product',
    'inventory',
    'inventory-history',
    'container-history',
    'purchase-order-item',
    'purchase-order',
    'receive-history',
    'shipment',
    'container-hierarchy',
    'employee',
    'carton-general-info',
    'carton-contents',
    'sscc-info',
    'carton-ambiguities',
    'vision-tunnel',
    'problems',
    'problem',
    'event',
    'authenticity-item'
  ]);

  const productMemory = new Map();
  const binMemory = new Map();
  const historyMemory = new Map();
  const hazMemory = new Map();
  const inFlight = new Map();
  const requestGroupControllers = new Map();
  const stats = {
    startedAt: Date.now(),
    productNetwork: 0,
    productCacheHits: 0,
    inventoryNetwork: 0,
    historyNetwork: 0,
    historyCacheHits: 0,
    madcatNetwork: 0,
    madcatAuthRequired: 0,
    hazNetwork: 0,
    hazCacheHits: 0,
    binNetwork: 0,
    binCacheHits: 0,
    sectionNetwork: 0,
    dedupeHits: 0
  };

  const clean = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const upper = value => clean(value).toUpperCase();

  function decodeJwtPayload(token) {
    try {
      const part = String(token || '').split('.')[1];
      if (!part) return null;
      const padded = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
      return JSON.parse(atob(padded));
    } catch {
      return null;
    }
  }

  function normalizeMeasurementToken(value) {
    const token = String(value || '').trim().replace(/^Bearer\s+/i, '');
    const payload = decodeJwtPayload(token);
    if (!payload || payload.token_use !== 'id' || !Number(payload.exp)) return null;
    if (Number(payload.exp) * 1000 <= Date.now() + 10_000) return null;
    return { token, exp: Number(payload.exp) * 1000 };
  }

  function installMeasurementAuthBridge() {
    if (window.__fcrMeasurementAuthBridge_v1) return;
    window.__fcrMeasurementAuthBridge_v1 = true;

    const pageWindow = typeof unsafeWindow === 'object' && unsafeWindow ? unsafeWindow : window;
    const bridgeLaunch = new URLSearchParams(location.search).get('fcrMadcatBridge') === '1';
    let closeTimer = 0;

    const saveToken = raw => {
      const pack = normalizeMeasurementToken(raw);
      if (!pack) return false;
      try {
        GM_setValue(MEASUREMENT_AUTH_KEY, JSON.stringify({ ...pack, capturedAt: Date.now() }));
      } catch {
        return false;
      }
      if (bridgeLaunch && !closeTimer) {
        closeTimer = setTimeout(() => {
          try { pageWindow.close(); } catch {}
        }, 700);
      }
      return true;
    };

    const inspectText = value => {
      const matches = String(value || '').match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || [];
      return matches.some(saveToken);
    };

    for (const store of [pageWindow.localStorage, pageWindow.sessionStorage]) {
      try {
        for (let index = 0; index < store.length; index++) inspectText(store.getItem(store.key(index)));
      } catch {}
    }

    const authFromHeaders = headers => {
      if (!headers) return '';
      try {
        if (typeof headers.get === 'function') return headers.get('Authorization') || headers.get('authorization') || '';
        if (Array.isArray(headers)) {
          const pair = headers.find(entry => Array.isArray(entry) && /^authorization$/i.test(String(entry[0])));
          return pair?.[1] || '';
        }
        for (const [name, value] of Object.entries(headers)) {
          if (/^authorization$/i.test(name)) return value;
        }
      } catch {}
      return '';
    };

    try {
      const originalFetch = pageWindow.fetch;
      if (typeof originalFetch === 'function') {
        pageWindow.fetch = function(input, init) {
          try {
            const url = String(input?.url || input || '');
            if (url.includes(MEASUREMENT_API_HOST)) saveToken(authFromHeaders(init?.headers) || authFromHeaders(input?.headers));
          } catch {}
          return originalFetch.apply(this, arguments);
        };
      }
    } catch {}

    try {
      const XHR = pageWindow.XMLHttpRequest;
      const originalOpen = XHR?.prototype?.open;
      const originalSetHeader = XHR?.prototype?.setRequestHeader;
      const originalSend = XHR?.prototype?.send;
      if (originalOpen && originalSetHeader && originalSend) {
        XHR.prototype.open = function(method, url) {
          this.__fcrMeasurementUrl = String(url || '');
          this.__fcrMeasurementAuth = '';
          return originalOpen.apply(this, arguments);
        };
        XHR.prototype.setRequestHeader = function(name, value) {
          if (/^authorization$/i.test(String(name))) this.__fcrMeasurementAuth = String(value || '');
          return originalSetHeader.apply(this, arguments);
        };
        XHR.prototype.send = function() {
          try {
            if (this.__fcrMeasurementUrl?.includes(MEASUREMENT_API_HOST)) saveToken(this.__fcrMeasurementAuth);
          } catch {}
          return originalSend.apply(this, arguments);
        };
      }
    } catch {}
  }


  function requestGroupKey(client, group) {
    const safeClient = clean(client);
    const safeGroup = clean(group);
    return safeClient && safeGroup ? `${safeClient}:${safeGroup}` : '';
  }

  function registerGroupController(context, controller) {
    const key = requestGroupKey(context?.client, context?.group);
    if (!key || !controller) return '';
    let controllers = requestGroupControllers.get(key);
    if (!controllers) {
      controllers = new Set();
      requestGroupControllers.set(key, controllers);
    }
    controllers.add(controller);
    return key;
  }

  function unregisterGroupController(key, controller) {
    if (!key || !controller) return;
    const controllers = requestGroupControllers.get(key);
    if (!controllers) return;
    controllers.delete(controller);
    if (!controllers.size) requestGroupControllers.delete(key);
  }

  function cancelRequestGroup(client, group) {
    const key = requestGroupKey(client, group);
    const controllers = key ? requestGroupControllers.get(key) : null;
    if (!controllers?.size) return 0;
    const list = [...controllers];
    requestGroupControllers.delete(key);
    for (const controller of list) {
      try { controller.abort('fcr-data-core:cancelled'); } catch { try { controller.abort(); } catch {} }
    }
    return list.length;
  }

  function toFcrDate(value) {
    const text = clean(value);
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;
    return /^\d{2}\/\d{2}\/\d{4}$/.test(text) ? text : '';
  }


  let usage = loadUsage();
  let usageDirty = false;
  let usageTimer = 0;

  function loadUsage() {
    try {
      const raw = GM_getValue(USAGE_KEY, '');
      const data = raw ? JSON.parse(raw) : null;
      if (data?.startedAt && data?.counts && data?.timings) return data;
    } catch {}
    return { startedAt: Date.now(), updatedAt: Date.now(), counts: {}, timings: {} };
  }

  function flushUsage() {
    if (!usageDirty) return;
    usageDirty = false;
    usage.updatedAt = Date.now();
    try { GM_setValue(USAGE_KEY, JSON.stringify(usage)); } catch {}
  }

  function scheduleUsageFlush() {
    usageDirty = true;
    if (usageTimer) return;
    usageTimer = setTimeout(() => {
      usageTimer = 0;
      flushUsage();
    }, USAGE_FLUSH_MS);
  }

  function recordUsage(key, ms = 0, count = 1) {
    const name = clean(key).replace(/[^a-z0-9._-]+/gi, '_').slice(0, 100);
    if (!name) return;
    usage.counts[name] = (Number(usage.counts[name]) || 0) + (Number(count) || 1);
    const duration = Number(ms) || 0;
    if (duration > 0) {
      const timing = usage.timings[name] || { count: 0, totalMs: 0, maxMs: 0 };
      timing.count++;
      timing.totalMs += duration;
      timing.maxMs = Math.max(timing.maxMs, duration);
      usage.timings[name] = timing;
    }
    scheduleUsageFlush();
  }

  function usageText() {
    flushUsage();
    const now = Date.now();
    const days = Math.max(0, (now - Number(usage.startedAt || now)) / 86400000);
    const lines = [
      'BWU2 FCR USAGE',
      `Core: ${VERSION}`,
      `Started: ${new Date(usage.startedAt).toLocaleString()}`,
      `Elapsed: ${days.toFixed(1)} days`,
      '', 'COUNTS'
    ];
    for (const key of Object.keys(usage.counts).sort()) lines.push(`${key}: ${usage.counts[key]}`);
    const timingKeys = Object.keys(usage.timings).sort();
    if (timingKeys.length) {
      lines.push('', 'TIMINGS');
      for (const key of timingKeys) {
        const t = usage.timings[key];
        const avg = t.count ? Math.round(t.totalMs / t.count) : 0;
        lines.push(`${key}: n=${t.count} avg=${avg}ms max=${Math.round(t.maxMs)}ms`);
      }
    }
    return lines.join('\n');
  }

  function warehouseId() {
    const match = location.pathname.match(/^\/([^/]+)\/results(?:\/|$)/i);
    return match?.[1] || '';
  }


  function cacheKey(kind, key) {
    return `${CACHE_PREFIX}${kind}:${upper(key)}`;
  }

  function readStored(kind, key, ttl) {
    if (!key) return null;
    const storageKey = cacheKey(kind, key);
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return null;
      const pack = JSON.parse(raw);
      if (!pack?.ts || Date.now() - Number(pack.ts) > ttl) {
        sessionStorage.removeItem(storageKey);
        return null;
      }
      return pack.value ?? null;
    } catch {
      return null;
    }
  }

  function writeStored(kind, key, value) {
    if (!key || value == null) return;
    try {
      sessionStorage.setItem(cacheKey(kind, key), JSON.stringify({ ts: Date.now(), value }));
    } catch {}
  }

  function parseBool(value) {
    const text = clean(value).toLowerCase();
    if (/^(true|yes|1)$/.test(text)) return true;
    if (/^(false|no|0)$/.test(text)) return false;
    return null;
  }

  function suspiciousDimensions(value) {
    let parts = String(value || '').match(/\d+(?:\.\d+)?/g);
    if (!parts || parts.length < 3) return false;
    parts = parts.slice(0, 3);
    const values = parts.map(Number);
    const equal = (a, b) => Math.abs(a - b) < 0.001;
    const rounded = parts.filter(part => /\.00$/.test(part)).length;
    return equal(values[0], values[1])
      || equal(values[0], values[2])
      || equal(values[1], values[2])
      || rounded >= 3
      || (Math.min(...values) <= 2.001 && rounded >= 2);
  }

  function normalizeProduct(product = {}) {
    const sortableRaw = product.sortableText ?? product.sortable ?? '';
    const sortable = typeof sortableRaw === 'boolean' ? sortableRaw : parseBool(sortableRaw);
    const sortableText = sortable === null ? clean(sortableRaw).toLowerCase() : String(sortable);
    return {
      asin: clean(product.asin),
      isbn: clean(product.isbn),
      primary: clean(product.primary || product.asin || product.isbn),
      fnsku: clean(product.fnsku),
      fcsku: clean(product.fcsku),
      title: clean(product.title),
      dimensions: clean(product.dimensions),
      weight: clean(product.weight),
      img: clean(product.img),
      sortable,
      sortableText,
      suspicious: product.suspicious === true || suspiciousDimensions(product.dimensions)
    };
  }

  function mergeProduct(a = {}, b = {}) {
    const out = { ...a };
    for (const [key, value] of Object.entries(b)) {
      if (key === 'sortable') {
        if (value === true || value === false) out[key] = value;
      } else if (key === 'suspicious') {
        if (value === true) out[key] = true;
      } else if (clean(value)) {
        out[key] = value;
      }
    }
    if ((out.sortable === true || out.sortable === false) && !clean(out.sortableText)) out.sortableText = String(out.sortable);
    out.suspicious = out.suspicious === true || suspiciousDimensions(out.dimensions);
    return out;
  }

  function getCachedProduct(code) {
    const key = upper(code);
    if (!key) return null;
    const memory = productMemory.get(key);
    if (memory) {
      if (Date.now() - memory.ts < PRODUCT_TTL) return memory.value;
      productMemory.delete(key);
    }
    const stored = readStored('product', key, PRODUCT_TTL);
    if (stored) productMemory.set(key, { ts: Date.now(), value: stored });
    return stored;
  }

  // Exact query only
  function saveProductForKey(key, product) {
    const cacheCode = upper(key);
    if (!cacheCode) return normalizeProduct(product);
    const normalized = normalizeProduct(product);
    const merged = mergeProduct(getCachedProduct(cacheCode) || {}, normalized);
    productMemory.set(cacheCode, { ts: Date.now(), value: merged });
    writeStored('product', cacheCode, merged);
    return merged;
  }

  function hasRequired(product, required = []) {
    if (!product) return false;
    return required.every(field => {
      if (field === 'sortable') return product.sortable === true || product.sortable === false;
      if (field === 'suspicious') return typeof product.suspicious === 'boolean';
      return !!clean(product[field]);
    });
  }

  function parseProductHtml(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const table = doc.querySelector('.a-box-group .a-keyvalue')
      || [...doc.querySelectorAll('table')].find(t => {
        const labels = [...t.querySelectorAll('th')].map(th => clean(th.textContent).toLowerCase());
        return labels.includes('asin') || labels.includes('isbn') || labels.includes('fnsku');
      })
      || doc.querySelector('.a-keyvalue');

    if (!table) return null;
    const data = {};
    for (const row of table.querySelectorAll('tr')) {
      const th = row.querySelector('th');
      const td = row.querySelector('td');
      if (!th || !td) continue;
      const label = clean(th.textContent).toLowerCase();
      data[label] = clean(td.querySelector('a')?.textContent || td.textContent);
    }

    const image = doc.querySelector('.a-box-group img') || doc.querySelector('img');
    const product = normalizeProduct({
      asin: data.asin,
      isbn: data.isbn,
      primary: data.asin || data.isbn,
      fnsku: data.fnsku,
      fcsku: data.fcsku,
      title: data.title,
      dimensions: data.dimensions,
      weight: data.weight,
      img: image?.getAttribute('src') || '',
      sortableText: data.sortable
    });

    if (!product.primary && !product.fnsku && !product.fcsku) return null;
    return product;
  }


  function apiBase() {
    const fc = warehouseId();
    if (!fc) throw new Error('Warehouse not found in URL');
    return `${location.origin}/${encodeURIComponent(fc)}/results`;
  }

  function waitForRequestRetry(ms, context, endpoint) {
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const groupKey = registerGroupController(context, controller);
      const timer = setTimeout(finish, Math.max(0, Number(ms) || 0));

      function finish() {
        clearTimeout(timer);
        unregisterGroupController(groupKey, controller);
        resolve();
      }

      controller.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        unregisterGroupController(groupKey, controller);
        reject(new Error(`${endpoint}: cancelled`));
      }, { once: true });
    });
  }

  async function fcrPostForm(endpoint, fields, identity = '', context = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(fields || {})) params.set(key, String(value ?? ''));
    const dedupeId = identity || params.toString();
    const scope = requestGroupKey(context?.client, context?.group);
    const key = `fcr:${endpoint}:${dedupeId}${scope ? `:scope:${scope}` : ''}`;

    if (inFlight.has(key)) {
      stats.dedupeHits++;
      return inFlight.get(key);
    }

    const work = (async () => {
      const started = performance.now();
      const retryDelays = endpoint === 'inventory' || endpoint === 'inventory-more'
        ? INVENTORY_RETRY_DELAYS_MS
        : [];
      let retries = 0;

      while (true) {
        const controller = new AbortController();
        const groupKey = registerGroupController(context, controller);
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; controller.abort('fcr-data-core:timeout'); }, REQUEST_TIMEOUT_MS);
        try {
          const response = await fetch(`${apiBase()}/${endpoint}`, {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Accept': 'text/html, */*; q=0.01',
              'X-Requested-With': 'XMLHttpRequest'
            },
            body: params.toString(),
            signal: controller.signal
          });
          const text = await response.text();
          if (!response.ok) {
            const error = new Error(`${endpoint}: HTTP ${response.status}`);
            error.status = response.status;
            throw error;
          }
          const elapsedMs = Math.round(performance.now() - started);
          recordUsage(`network.${endpoint}`, elapsedMs);
          return { text, ms: elapsedMs, status: response.status, retries };
        } catch (error) {
          if (error?.name === 'AbortError') throw new Error(`${endpoint}: ${timedOut ? 'timed out' : 'cancelled'}`);
          const retryDelay = retryDelays[retries];
          if (!(Number(error?.status) >= 500 && Number(error?.status) < 600) || retryDelay == null) throw error;
          retries++;
          recordUsage(`network.${endpoint}.retry`);
          await waitForRequestRetry(retryDelay, context, endpoint);
        } finally {
          clearTimeout(timer);
          unregisterGroupController(groupKey, controller);
        }
      }
    })();

    inFlight.set(key, work);
    try {
      return await work;
    } finally {
      if (inFlight.get(key) === work) inFlight.delete(key);
    }
  }

  function fcrPost(endpoint, searchValue, context = {}) {
    const search = clean(searchValue);
    return fcrPostForm(endpoint, { s: search }, upper(search), context);
  }

  function parseHtml(html) {
    return new DOMParser().parseFromString(String(html || ''), 'text/html');
  }

  function inventoryIndexes(table) {
    const headers = [...table.querySelectorAll('thead th')].map(th => ({
      id: clean(th.id).toLowerCase(),
      text: clean(th.textContent).replace(/\(\d+\)/g, '').trim().toLowerCase()
    }));
    const find = (...names) => headers.findIndex(header => names.includes(header.id) || names.includes(header.text));
    return {
      container: find('inventory-container', 'container'),
      asin: find('inventory-asin', 'asin'),
      fnsku: find('inventory-fnsku', 'fnsku'),
      fcsku: find('inventory-fcsku', 'fcsku'),
      lpn: find('inventory-lpn', 'lpn'),
      qty: find('inventory-quantity', 'quantity'),
      disposition: find('inventory-disposition', 'disposition'),
      consumer: find('inventory-consumer', 'consumer'),
      consumerId: find('inventory-consumer-id', 'consumer id', 'consumerid'),
      outerLocation: find('inventory-outer-location', 'outer location'),
      outerLocationType: find('inventory-outer-location-type', 'outer location type'),
      title: find('inventory-title', 'title')
    };
  }

  function parseInventoryDocument(doc) {
    const table = doc.querySelector('#table-inventory');
    if (!table) throw new Error('Inventory table not returned');
    const idx = inventoryIndexes(table);
    const rows = [];
    for (const tr of table.tBodies?.[0]?.rows || []) {
      const cells = tr.cells;
      const value = index => index >= 0 ? clean(cells[index]?.textContent) : '';
      const row = {
        container: value(idx.container), asin: value(idx.asin), fnsku: value(idx.fnsku), fcsku: value(idx.fcsku),
        lpn: value(idx.lpn), qty: Number(value(idx.qty).replace(/[^\d.-]/g, '')) || 0,
        disposition: value(idx.disposition), consumer: value(idx.consumer), consumerId: value(idx.consumerId),
        outerLocation: value(idx.outerLocation), outerLocationType: value(idx.outerLocationType), title: value(idx.title)
      };
      if (row.asin || row.fnsku || row.fcsku) rows.push(row);
    }
    return rows;
  }

  function parseInventoryHtml(html) {
    return parseInventoryDocument(parseHtml(html));
  }

  function inventoryPreviewFromDocument(doc, startedAt, networkMs) {
    const rows = parseInventoryDocument(doc);
    const partialQuantity = rows.reduce((sum, row) => sum + (Number(row.qty) || 0), 0);
    const hasMore = Boolean(paginationToken(doc));
    const headerTotal = inventoryQuantityTotal(doc);
    const body = doc.body.cloneNode(true);
    const qtyHeader = body.querySelector('#inventory-quantity');
    if (qtyHeader && !hasMore) qtyHeader.textContent = `Quantity (${headerTotal ?? partialQuantity})`;
    body.querySelectorAll('.pagination-token').forEach(node => node.remove());

    return {
      rows,
      html: body.innerHTML,
      pages: 1,
      records: rows.length,
      totalQuantity: hasMore ? null : (headerTotal ?? partialQuantity),
      partialQuantity,
      complete: !hasMore,
      preview: hasMore,
      warning: hasMore ? 'Loading remaining inventory pages' : '',
      ms: Math.round(performance.now() - startedAt),
      networkMs
    };
  }

  function paginationToken(doc) {
    const raw = clean(doc?.querySelector('.pagination-token')?.textContent || '');
    if (!raw || /^(?:true|false|null|done)$/i.test(raw)) return '';
    return /^(?:\{|\[)/.test(raw) ? raw : '';
  }

  function inventoryQuantityTotal(doc) {
    const header = doc?.querySelector('#inventory-quantity');
    const match = clean(header?.textContent || '').match(/\(([\d,]+)\)/);
    return match ? Number(match[1].replace(/,/g, '')) : null;
  }

  function inventoryRowsFromPage(doc, expectedCells = 0) {
    const table = doc?.querySelector('#table-inventory') || doc?.querySelector('table');
    if (!table) return [];
    const candidates = [...table.querySelectorAll('tbody tr')];
    const rows = candidates.length ? candidates : [...table.querySelectorAll('tr')].filter(row => !row.closest('thead'));
    return rows.filter(row => !expectedCells || row.cells.length >= expectedCells);
  }

  function inventoryHistoryPage(html, expectedCells = 0) {
    const raw = String(html || '');
    const doc = parseHtml(raw);
    let rows = [...doc.querySelectorAll('#table-inventory-history tbody tr')];
    if (!rows.length) rows = [...doc.querySelectorAll('tbody tr')];

    let fallbackDoc = null;
    if (!rows.length && /<tr\b/i.test(raw)) {
      fallbackDoc = parseHtml(`<table><tbody>${raw}</tbody></table>`);
      rows = [...fallbackDoc.querySelectorAll('tbody tr')];
    }

    rows = rows.filter(row => !expectedCells || row.cells.length >= expectedCells);
    return { doc, fallbackDoc, rows, token: paginationToken(doc) || paginationToken(fallbackDoc) };
  }

  async function fetchFullInventoryHistory(searchValue, startValue, endValue, allowPartial = true, context = {}) {
    const search = clean(searchValue);
    const startDate = toFcrDate(startValue);
    const endDate = toFcrDate(endValue);
    if (!startDate || !endDate) throw new Error('Inventory History requires both valid dates');

    const started = performance.now();
    const first = await fcrPostForm('inventory-history', {
      s: search,
      startSearchDateString: startDate,
      endSearchDateString: endDate,
      dateStringFormat: 'MM/dd/yyyy'
    }, `${upper(search)}|${startDate}|${endDate}`, context);

    const doc = parseHtml(first.text);
    const table = doc.querySelector('#table-inventory-history');
    if (!table) throw new Error('Inventory History table not returned');

    const tbody = table.tBodies?.[0] || table.appendChild(doc.createElement('tbody'));
    const expectedCells = table.tHead?.rows?.[0]?.cells?.length || 0;
    const seenTokens = new Set();
    let token = paginationToken(doc);
    let pages = 1;
    let complete = true;
    let warning = '';

    while (token) {
      if (seenTokens.has(token)) {
        complete = false;
        warning = 'inventory-history pagination repeated token';
        break;
      }
      if (pages >= 200) {
        complete = false;
        warning = 'inventory-history pagination safety limit reached';
        break;
      }
      seenTokens.add(token);

      try {
        const more = await fcrPostForm('inventory-history-more', { token }, `token:${token}`, context);
        pages++;
        const page = inventoryHistoryPage(more.text, expectedCells);
        if (!page.rows.length && page.token) {
          complete = false;
          warning = 'inventory-history pagination returned no usable rows';
          break;
        }
        for (const row of page.rows) tbody.appendChild(doc.importNode(row, true));
        token = page.token;
      } catch (error) {
        complete = false;
        warning = clean(error?.message || error || 'inventory-history pagination failed');
        if (!allowPartial) throw new Error(`Inventory History incomplete: ${warning}`);
        break;
      }
    }

    doc.querySelectorAll('.pagination-token').forEach(node => node.remove());
    return {
      html: doc.body.innerHTML,
      pages,
      records: [...tbody.rows].length,
      complete,
      warning,
      ms: Math.round(performance.now() - started)
    };
  }

  async function fetchFullInventory(searchValue, allowPartial = false, context = {}, onPreview = null) {
    const search = clean(searchValue);
    const started = performance.now();
    const first = await fcrPost('inventory', search, context);
    const doc = parseHtml(first.text);
    const table = doc.querySelector('#table-inventory');
    if (!table) throw new Error('Inventory table not returned');

    const tbody = table.tBodies?.[0] || table.appendChild(doc.createElement('tbody'));
    const expectedCells = table.tHead?.rows?.[0]?.cells?.length || 0;
    const seenTokens = new Set();
    let token = paginationToken(doc);
    let pages = 1;
    let complete = true;
    let warning = '';
    let totalMs = first.ms;

    if (typeof onPreview === 'function') {
      onPreview(inventoryPreviewFromDocument(doc, started, first.ms));
    }

    while (token) {
      if (seenTokens.has(token)) {
        complete = false;
        warning = 'inventory pagination repeated token';
        break;
      }
      if (pages >= 200) {
        complete = false;
        warning = 'inventory pagination safety limit reached';
        break;
      }
      seenTokens.add(token);
      try {
        const more = await fcrPostForm('inventory-more', { token }, `token:${token}`, context);
        totalMs += more.ms;
        pages++;
        const moreDoc = parseHtml(more.text);
        for (const row of inventoryRowsFromPage(moreDoc, expectedCells)) tbody.appendChild(doc.importNode(row, true));
        token = paginationToken(moreDoc);
      } catch (error) {
        complete = false;
        warning = clean(error?.message || error || 'inventory pagination failed');
        if (!allowPartial) throw new Error(`Inventory incomplete: ${warning}`);
        break;
      }
    }

    const parsedRows = parseInventoryDocument(doc);
    const totalQuantity = parsedRows.reduce((sum, row) => sum + (Number(row.qty) || 0), 0);
    const headerTotal = inventoryQuantityTotal(doc);
    const qtyHeader = doc.querySelector('#inventory-quantity');
    if (qtyHeader && complete) qtyHeader.textContent = `Quantity (${headerTotal ?? totalQuantity})`;
    doc.querySelectorAll('.pagination-token').forEach(node => node.remove());

    return {
      rows: parsedRows,
      html: doc.body.innerHTML,
      pages,
      records: parsedRows.length,
      totalQuantity: complete ? (headerTotal ?? totalQuantity) : null,
      partialQuantity: totalQuantity,
      complete,
      warning,
      ms: Math.round(performance.now() - started),
      networkMs: totalMs
    };
  }


  async function fetchInventoryPreview(searchValue, context = {}) {
    const search = clean(searchValue);
    if (!search) throw new Error('Inventory search value required');
    const started = performance.now();
    const first = await fcrPost('inventory', search, context);
    const doc = parseHtml(first.text);
    return inventoryPreviewFromDocument(doc, started, first.ms);
  }

  function parseHistoryHtml(html) {
    const doc = parseHtml(html);
    const table = doc.querySelector('#table-inventory-history');
    if (!table) return { rows: 0, madcat: /\bmadcat\b/i.test(clean(doc.body?.textContent || '')) };
    let rows = 0;
    let madcat = false;
    for (const row of table.tBodies?.[0]?.rows || []) {
      rows++;
      if (!madcat && /\bmadcat\b/i.test(clean(row.textContent))) madcat = true;
    }
    return { rows, madcat };
  }

  async function fetchInventory(container, context = {}) {
    const search = clean(container);
    if (!search) return { rows: [], source: 'empty', ms: 0 };

    // Never cache tote inventory; incomplete inventory is unsafe for scan decisions.
    stats.inventoryNetwork++;
    const result = await fetchFullInventory(search, false, context);
    return {
      rows: result.rows,
      source: 'network',
      ms: result.ms,
      pages: result.pages,
      totalQuantity: result.totalQuantity,
      complete: true
    };
  }

  function getCachedHistory(code) {
    const key = upper(code);
    if (!key) return null;
    const memory = historyMemory.get(key);
    if (memory && Date.now() - memory.ts < HISTORY_TTL) return memory.value;

    const stored = readStored('history', key, HISTORY_TTL);
    if (stored) {
      historyMemory.set(key, { ts: Date.now(), value: stored });
      return stored;
    }
    return null;
  }

  function saveHistory(code, value) {
    const key = upper(code);
    if (!key || !value) return value;
    historyMemory.set(key, { ts: Date.now(), value });
    writeStored('history', key, value);
    return value;
  }

  async function fetchHistory(code, force = false) {
    const search = clean(code);
    if (!search) return { history: { rows: 0, madcat: false }, source: 'empty', ms: 0 };

    if (!force) {
      const cached = getCachedHistory(search);
      if (cached) {
        stats.historyCacheHits++;
        return { history: cached, source: 'cache', ms: 0 };
      }
    }

    const key = `history:${upper(search)}:${force ? 'force' : 'normal'}`;
    if (inFlight.has(key)) {
      stats.dedupeHits++;
      const result = await inFlight.get(key);
      return { ...result, source: 'dedupe' };
    }

    const work = (async () => {
      stats.historyNetwork++;
      const response = await fcrPost('inventory-history', search);
      const history = parseHistoryHtml(response.text);
      saveHistory(search, history);
      return { history, source: 'network', ms: response.ms };
    })();

    inFlight.set(key, work);
    try {
      return await work;
    } finally {
      if (inFlight.get(key) === work) inFlight.delete(key);
    }
  }

  const isAsin = value => /^[A-Z0-9]{10}$/i.test(upper(value));
  const hazKey = (fc, asin) => `${upper(fc)}:${upper(asin)}`;
  const hazStoreKey = (fc, asin) => `${CACHE_PREFIX}haz:${upper(fc)}:${upper(asin)}`;
  const hazLevelKey = fc => `${CACHE_PREFIX}hazlevel:${upper(fc)}`;

  function readHazStored(fc, asin) {
    try {
      const raw = GM_getValue(hazStoreKey(fc, asin), null);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function writeHazStored(fc, asin, pack) {
    try { GM_setValue(hazStoreKey(fc, asin), JSON.stringify(pack)); } catch {}
  }

  async function fetchHazmat(asinValue, force = false) {
    const asin = upper(asinValue);
    const fc = warehouseId();
    if (!isAsin(asin) || !fc) return { hazmat: null, source: 'empty' };

    const key = hazKey(fc, asin);
    const now = Date.now();

    if (!force) {
      const memory = hazMemory.get(key);
      if (memory && now - memory.ts < memory.ttl) {
        stats.hazCacheHits++;
        return { hazmat: memory.value, source: 'cache' };
      }

      const stored = readHazStored(fc, asin);
      if (stored?.ok && now - Number(stored.ts) < HAZ_SUCCESS_TTL) {
        hazMemory.set(key, { ts: Number(stored.ts), ttl: HAZ_SUCCESS_TTL, value: stored.value });
        stats.hazCacheHits++;
        return { hazmat: stored.value, source: 'cache' };
      }
    }

    const flightKey = `haz:${key}:${force ? 'force' : 'normal'}`;
    if (inFlight.has(flightKey)) {
      stats.dedupeHits++;
      try {
        const value = await inFlight.get(flightKey);
        return { hazmat: value, source: 'dedupe' };
      } catch {
        return { hazmat: null, source: 'error' };
      }
    }

    const work = (async () => {
      stats.hazNetwork++;

      let restriction = null;
      try { restriction = GM_getValue(hazLevelKey(fc), null); } catch {}
      if (!restriction) {
        try {
          const response = await gmRequest({
            method: 'GET',
            url: `https://pandash.amazon.com/GridServlet?fc=${encodeURIComponent(fc)}`,
            responseType: 'json'
          });
          restriction = response.response?.restriction || 'default';
          try { GM_setValue(hazLevelKey(fc), restriction); } catch {}
        } catch {
          restriction = 'default';
        }
      }

      const response = await gmRequest({
        method: 'POST',
        url: 'https://pandash.amazon.com/GridServlet',
        data: `language=default&source=${encodeURIComponent(restriction || 'default')}-hazmat-FC&marketPlaces=${MARKETPLACE}&asins=${encodeURIComponent(asin)}&rows=1&page=1&fc=${encodeURIComponent(fc)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        responseType: 'json'
      });

      const row = response.response?.rows?.find(item => upper(item?.asin) === asin);
      const value = row ? {
        level: Number(row.level || 0),
        message: String(row.message || '')
      } : null;

      const ttl = value ? HAZ_SUCCESS_TTL : HAZ_FAILURE_TTL;
      hazMemory.set(key, { ts: Date.now(), ttl, value });
      if (value) writeHazStored(fc, asin, { ts: Date.now(), ok: true, value });
      return value;
    })();

    inFlight.set(flightKey, work);
    try {
      const value = await work;
      return { hazmat: value, source: 'network' };
    } catch {
      hazMemory.set(key, { ts: Date.now(), ttl: HAZ_FAILURE_TTL, value: null });
      return { hazmat: null, source: 'error' };
    } finally {
      if (inFlight.get(flightKey) === work) inFlight.delete(flightKey);
    }
  }

  async function fetchProduct(code, required = [], context = {}) {
    const search = clean(code);
    if (!search) return { product: null, source: 'empty' };
    const cached = getCachedProduct(search);
    if (cached && hasRequired(cached, required)) {
      stats.productCacheHits++;
      return { product: cached, source: 'cache' };
    }
    const scope = requestGroupKey(context?.client, context?.group);
    const key = `product:${upper(search)}${scope ? `:scope:${scope}` : ''}`;
    if (inFlight.has(key)) {
      stats.dedupeHits++;
      return { product: await inFlight.get(key), source: 'dedupe' };
    }
    const work = (async () => {
      stats.productNetwork++;
      const response = await fcrPost('product', search, context);
      const parsed = parseProductHtml(response.text);
      return parsed ? saveProductForKey(search, parsed) : null;
    })();
    inFlight.set(key, work);
    try {
      return { product: await work, source: 'network' };
    } finally {
      if (inFlight.get(key) === work) inFlight.delete(key);
    }
  }

  function binKey(container, item) {
    return `${upper(container)}|${upper(item)}`;
  }

  function getCachedBin(container, item) {
    const key = binKey(container, item);
    if (!key || key === '|') return '';
    const memory = binMemory.get(key);
    if (memory) {
      if (Date.now() - memory.ts < BIN_TTL) return memory.value;
      binMemory.delete(key);
    }
    const stored = clean(readStored('bin', key, BIN_TTL) || '');
    if (stored) binMemory.set(key, { ts: Date.now(), value: stored });
    return stored;
  }

  function saveBin(container, item, size, aliases = []) {
    const value = clean(size);
    if (!value) return '';
    for (const alias of [...new Set([item, ...aliases].map(upper).filter(Boolean))]) {
      const key = binKey(container, alias);
      binMemory.set(key, { ts: Date.now(), value });
      writeStored('bin', key, value);
    }
    return value;
  }

  function makeSidelineRequestId() {
    const id = crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `amzn1.fc.v1.common.request-id.v1.AFTPoirotWebsite.${id}`;
  }

  function gmRequest(options) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        timeout: REQUEST_TIMEOUT_MS,
        ...options,
        onload: response => {
          if (response.status >= 200 && response.status < 300) resolve(response);
          else reject(new Error(`HTTP ${response.status}`));
        },
        onerror: () => reject(new Error('request failed')),
        ontimeout: () => reject(new Error('timed out'))
      });
    });
  }

  function clearMeasurementAuth() {
    try { GM_deleteValue(MEASUREMENT_AUTH_KEY); } catch {}
  }

  function readMeasurementAuth() {
    try {
      const raw = GM_getValue(MEASUREMENT_AUTH_KEY, '');
      const stored = raw ? JSON.parse(raw) : null;
      const pack = normalizeMeasurementToken(stored?.token || '');
      if (pack) return pack;
    } catch {}
    clearMeasurementAuth();
    return null;
  }

  function requestMeasurementPage(url, token) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: MEASUREMENT_TIMEOUT_MS,
        headers: {
          Accept: 'application/json',
          Authorization: token
        },
        onload: response => {
          if (response.status === 401 || response.status === 403) {
            clearMeasurementAuth();
            reject(new Error('Measurement login required'));
            return;
          }
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`Measurement HTTP ${response.status}`));
            return;
          }
          resolve(response);
        },
        onerror: () => reject(new Error('Measurement request failed')),
        ontimeout: () => reject(new Error('Measurement request timed out'))
      });
    });
  }

  async function fetchRecentMadcat(fnskuValue, force = false) {
    const fnsku = upper(fnskuValue);
    if (!fnsku) throw new Error('Measurement FNSKU unavailable');

    const auth = readMeasurementAuth();
    if (!auth) {
      stats.madcatAuthRequired++;
      throw new Error('Measurement login required');
    }

    const key = `madcat30:${fnsku}:${force ? 'force' : 'normal'}`;
    if (inFlight.has(key)) {
      stats.dedupeHits++;
      const data = await inFlight.get(key);
      return { ...data, source: 'dedupe' };
    }

    const work = (async () => {
      stats.madcatNetwork++;
      const before = new Date();
      const after = new Date(before.getTime() - MEASUREMENT_LOOKBACK_MS);
      const url = new URL(`${MEASUREMENT_API}/${encodeURIComponent(fnsku)}/FNSKU`);
      url.searchParams.set('effectiveAfter', after.toISOString());
      url.searchParams.set('effectiveBefore', before.toISOString());

      let pages = 0;
      let eventsChecked = 0;
      let nextToken = '';

      do {
        if (nextToken) url.searchParams.set('nextToken', nextToken);
        else url.searchParams.delete('nextToken');

        const response = await requestMeasurementPage(url.href, auth.token);
        let payload;
        try {
          payload = JSON.parse(response.responseText || '{}');
        } catch {
          throw new Error('Measurement response invalid');
        }

        pages++;
        const events = Array.isArray(payload.measurementEvents) ? payload.measurementEvents : [];
        eventsChecked += events.length;
        const hasRecentMadcat = events.some(event => {
          if (upper(event?.measurementSource) !== 'MADCAT') return false;
          const instant = Date.parse(event?.measurementInstant || '');
          return Number.isFinite(instant) && instant >= after.getTime() && instant <= before.getTime();
        });
        if (hasRecentMadcat) {
          return { madcat: true, eventsChecked, pages, source: 'network', windowDays: 30 };
        }

        nextToken = clean(payload.nextToken);
      } while (nextToken && pages < MEASUREMENT_MAX_PAGES);

      if (nextToken) throw new Error('Measurement history incomplete');
      return { madcat: false, eventsChecked, pages, source: 'network', windowDays: 30 };
    })();

    inFlight.set(key, work);
    try {
      return await work;
    } finally {
      if (inFlight.get(key) === work) inFlight.delete(key);
    }
  }

  async function fetchBinSize(container, item, aliases = []) {
    const source = clean(container);
    const code = clean(item);
    if (!source || !code) return { size: '', source: 'empty' };

    const cached = getCachedBin(source, code);
    if (cached) {
      stats.binCacheHits++;
      return { size: cached, source: 'cache' };
    }

    const key = `bin:${binKey(source, code)}`;
    if (inFlight.has(key)) {
      stats.dedupeHits++;
      const size = await inFlight.get(key);
      return { size, source: 'dedupe' };
    }

    const work = (async () => {
      stats.binNetwork++;
      const response = await gmRequest({
        method: 'POST',
        url: SIDELINE_API,
        headers: { Accept: '*/*', 'Content-Type': 'application/json' },
        data: JSON.stringify({
          containerScannableId: source,
          isMasterpack: null,
          itemAndonContext: null,
          itemBarcode: code,
          requestId: makeSidelineRequestId(),
          tool: 'V3'
        })
      });
      const payload = JSON.parse(response.responseText || '{}');
      const items = Array.isArray(payload.items) ? payload.items : [];
      const wanted = new Set([code, ...aliases].map(upper).filter(Boolean));
      const exact = items.find(entry => [
        entry?.scannableId,
        entry?.value,
        entry?.scannedBarcode,
        entry?.skuDetail?.fnSku,
        entry?.skuDetail?.asin,
        entry?.skuDetail?.fcSku
      ].map(upper).some(value => wanted.has(value)));
      const size = clean(exact?.binDescription || '');
      if (size) {
        const resultAliases = [
          exact?.scannableId,
          exact?.value,
          exact?.scannedBarcode,
          exact?.skuDetail?.fnSku,
          exact?.skuDetail?.asin,
          exact?.skuDetail?.fcSku,
          ...aliases
        ];
        saveBin(source, code, size, resultAliases);
      }
      return size;
    })();

    inFlight.set(key, work);
    try {
      const size = await work;
      return { size, source: 'network' };
    } finally {
      if (inFlight.get(key) === work) inFlight.delete(key);
    }
  }


  async function fetchSection(endpoint, code, options = {}, context = {}) {
    const name = clean(endpoint).toLowerCase();
    const search = clean(code);
    if (!SECTION_ENDPOINTS.has(name)) throw new Error(`Unsupported FCResearch section: ${name || 'blank'}`);
    if (!search) throw new Error('Section search value required');
    stats.sectionNetwork++;

    if (name === 'inventory') {
      const reportPreview = options.preview === true && typeof context.progress === 'function'
        ? preview => context.progress({
            endpoint: name,
            ...preview,
            status: 200,
            source: 'network'
          })
        : null;
      const result = await fetchFullInventory(search, true, context, reportPreview);
      return {
        endpoint: name,
        html: result.html,
        status: 200,
        ms: result.ms,
        source: 'network',
        pages: result.pages,
        records: result.records,
        totalQuantity: result.totalQuantity,
        partialQuantity: result.partialQuantity,
        complete: result.complete,
        warning: result.warning
      };
    }

    if (name === 'inventory-history' && (options.startDate || options.endDate)) {
      const result = await fetchFullInventoryHistory(search, options.startDate, options.endDate, true, context);
      return {
        endpoint: name,
        html: result.html,
        status: 200,
        ms: result.ms,
        source: 'network',
        pages: result.pages,
        records: result.records,
        complete: result.complete,
        warning: result.warning
      };
    }

    const result = await fcrPost(name, search, context);
    return {
      endpoint: name,
      html: result.text,
      status: result.status,
      ms: result.ms,
      source: 'network',
      complete: true
    };
  }

  function respond(id, ok, data = null, error = '') {
    window.dispatchEvent(new CustomEvent(RESPONSE_EVENT, {
      detail: JSON.stringify({ id, ok, data, error, version: VERSION })
    }));
  }

  function reportProgress(id, data) {
    window.dispatchEvent(new CustomEvent(PROGRESS_EVENT, {
      detail: JSON.stringify({ id, data, version: VERSION })
    }));
  }

  async function handleRequest(message) {
    const { id, type, payload = {}, client = 'unknown', group = '' } = message || {};
    const context = {
      client,
      group: clean(group),
      progress: data => reportProgress(id, data)
    };
    if (!id || !type) return;
    const tracked = !['ping', 'stats', 'usageStats', 'usageReset', 'rememberProduct'].includes(type);
    if (tracked) {
      recordUsage(`core.request.${type}`);
      recordUsage(`client.${client}.request.${type}`);
    }
    try {
      let data;
      if (type === 'ping') data = { version: VERSION, modules: ['product', 'inventory', 'inventoryPreview', 'history', 'madcatRecent', 'hazmat', 'binSize', 'section'], stats: { ...stats } };
      else if (type === 'inventory') data = await fetchInventory(payload.container || payload.code, context);
      else if (type === 'inventoryPreview') data = await fetchInventoryPreview(payload.container || payload.code || payload.search, context);
      else if (type === 'history') data = await fetchHistory(payload.code, payload.force === true);
      else if (type === 'madcatRecent') data = await fetchRecentMadcat(payload.fnsku || payload.code, payload.force === true);
      else if (type === 'hazmat') data = await fetchHazmat(payload.asin, payload.force === true);
      else if (type === 'product') data = await fetchProduct(payload.code, Array.isArray(payload.require) ? payload.require : [], context);
      else if (type === 'section') data = await fetchSection(payload.endpoint, payload.code || payload.search, payload, context);
      else if (type === 'rememberProduct') {
        const currentSearch = clean(new URLSearchParams(location.search).get('s'));
        const requestedKey = clean(payload.code || currentSearch);
        const product = requestedKey ? saveProductForKey(requestedKey, payload.product || {}) : normalizeProduct(payload.product || {});
        data = { product, source: requestedKey ? 'remembered' : 'uncached' };
      } else if (type === 'binSize') data = await fetchBinSize(payload.container, payload.item, Array.isArray(payload.aliases) ? payload.aliases : []);
      else if (type === 'stats') data = { version: VERSION, stats: { ...stats } };
      else if (type === 'usageStats') data = { version: VERSION, text: usageText() };
      else if (type === 'usageReset') {
        usage = { startedAt: Date.now(), updatedAt: Date.now(), counts: {}, timings: {} };
        usageDirty = true;
        flushUsage();
        data = { ok: true, text: usageText() };
      } else throw new Error(`Unknown request: ${type}`);

      if (tracked && data?.source) {
        recordUsage(`core.source.${type}.${data.source}`);
        recordUsage(`client.${client}.source.${type}.${data.source}`);
      }
      respond(id, true, data);
    } catch (error) {
      if (tracked) {
        recordUsage(`core.error.${type}`);
        recordUsage(`client.${client}.error.${type}`);
      }
      respond(id, false, null, clean(error?.message || error || 'request failed'));
    }
  }

  window.addEventListener(REQUEST_EVENT, event => {
    try {
      const message = JSON.parse(String(event.detail || ''));
      handleRequest(message);
    } catch {}
  });


  window.addEventListener(CANCEL_EVENT, event => {
    try {
      const message = JSON.parse(String(event.detail || ''));
      const cancelled = cancelRequestGroup(message?.client, message?.group);
      if (cancelled) recordUsage(`client.${clean(message?.client) || 'unknown'}.cancelled`, 0, cancelled);
    } catch {}
  });


  window.addEventListener(USAGE_EVENT, event => {
    try {
      const message = JSON.parse(String(event.detail || ''));
      recordUsage(message.key, message.ms, message.count);
    } catch {}
  });
  window.addEventListener('pagehide', flushUsage);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushUsage(); });

  const markReady = () => {
    if (document.documentElement) document.documentElement.dataset.fcrDataCoreVersion = VERSION;
    window.dispatchEvent(new CustomEvent(READY_EVENT, { detail: VERSION }));
  };
  if (document.documentElement) markReady();
  else document.addEventListener('DOMContentLoaded', markReady, { once: true });
})();
