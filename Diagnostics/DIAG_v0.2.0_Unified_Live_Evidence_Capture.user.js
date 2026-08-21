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
  const DETAIL_STORE_KEY = '__bwu2_live_evidence_detail_v020';
  const MAX_EVENTS = 600;
  const MAX_DEPTH = 6;
  const MAX_BODY_CHARS = 12000;
  const MAX_RESPONSE_READ_BYTES = 65536;
  const MAX_INVENTORY_INSPECT_BYTES = 65536;
  const MAX_INVENTORY_INSPECT_NODES = 500;
  const FLUSH_MS = 300;
  const MUTATION_REPORT_MS = 5000;
  const SENSITIVE_KEY = /auth|authorization|cookie|credential|csrf|jwt|password|secret|session|signature|token|x-amz/i;
  const IDENTIFIER_KEY = /asin|barcode|code|container|customer|destination|fcsku|fnsku|(?:^|_)id(?:$|_)|item|lpn|object|pod|scannable|sku|source/i;
  const CAMEL_IDENTIFIER_KEY = /(?:Id|ID)$/;
  const FINGERPRINT_VALUE = /^<[^<>#]+#[a-z0-9]{7}:\d+>$/;
  const SAFE_QUERY_KEY = /^(?:action|mode|page|sort|state|tab|type|view)$/i;
  const SAFE_ROUTE_PART = /^(?:api|action|status|end|results|inventory|inventory-more|container-hierarchy|scan-source-container|scanitem|move-items|close-container|move-container|edititems|fcskuflip|moveitems|v\d{1,2})$/i;
  const INTERESTING_PATH = /(?:\/api\/|\/action|\/status|\/end|\/results\/inventory|\/inventory-more|container-hierarchy|edititems|fcskuflip|moveitems|move-container)/i;
  const INVENTORY_PATH = '/results/inventory';
  const INVENTORY_MORE_PATH = '/inventory-more';
  const DETAIL_PATHS = Object.freeze([
    '/api/scan-source-container',
    '/api/scanitem',
    '/api/move-items',
    '/api/close-container',
    '/status',
    '/action',
    '/end',
    '/api/move-container',
    '/container-hierarchy'
  ]);

  let active = true;
  let detailed = loadDetailed();
  let mounted = false;
  let host;
  let statusNode;
  let detailButton;
  let privacyNote;
  let flushTimer = 0;
  let mutationObserver;
  let inventoryAwaitingMore = false;
  let mutationStarted = performance.now();
  let mutationStats = emptyMutationStats();
  const startedAt = new Date().toISOString();
  const events = loadEvents();
  if (!detailed) events.splice(0, events.length, ...events.map(eventForExport));

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
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer <redacted>')
      .replace(/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '<jwt:redacted>')
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

  function sanitizeRoutePart(value, kind) {
    let decoded = String(value ?? '');
    try { decoded = decodeURIComponent(decoded); } catch {}
    if (!decoded) return '';
    const scrubbed = scrubText(decoded);
    if (scrubbed !== decoded) return scrubbed;
    if (SAFE_ROUTE_PART.test(decoded)) return decoded;
    return fingerprint(decoded, kind);
  }

  function sanitizeUrl(value) {
    try {
      const url = new URL(String(value ?? ''), location.href);
      url.pathname = url.pathname.split('/').map((part, index) => sanitizeRoutePart(part, `path:${index}`)).join('/');
      for (const [key, raw] of [...url.searchParams.entries()]) {
        url.searchParams.set(key, SAFE_QUERY_KEY.test(key) ? scrubText(raw) : fingerprint(raw, `query:${key}`));
      }
      if (url.hash) url.hash = sanitizeRoutePart(url.hash.slice(1), 'fragment');
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
      if (FINGERPRINT_VALUE.test(value)) return value;
      if (IDENTIFIER_KEY.test(key) || CAMEL_IDENTIFIER_KEY.test(key)) return fingerprint(value, key || 'id');
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
      output[scrubText(childKey)] = sanitize(childValue, childKey, depth + 1, seen);
    }
    return output;
  }

  function parseBody(body) {
    if (body == null) return null;
    try {
      if (typeof body === 'string') {
        try { return capBody(sanitize(JSON.parse(body))); } catch { return scrubText(body); }
      }
      if (body instanceof URLSearchParams) return capBody(sanitize(Object.fromEntries(body.entries())));
      if (body instanceof FormData) return capBody(sanitize(Object.fromEntries(body.entries())));
      if (body instanceof Blob) return `<Blob:${body.type || 'unknown'}:${body.size}>`;
      if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return `<binary:${body.byteLength}>`;
      return capBody(sanitize(body));
    } catch (error) {
      return `<body-read-failed:${scrubText(error?.message || error)}>`;
    }
  }

  function capBody(value) {
    if (typeof value === 'string') return scrubText(value);
    try {
      const serialized = JSON.stringify(value);
      return serialized.length > MAX_BODY_CHARS ? scrubText(serialized) : value;
    } catch {
      return '<body-cap-failed>';
    }
  }

  function parseResponseText(text, contentType = '') {
    const raw = String(text ?? '');
    if (/json/i.test(contentType) || /^[\s]*[\[{]/.test(raw)) {
      try { return capBody(sanitize(JSON.parse(raw))); } catch {}
    }
    return scrubText(raw);
  }

  function safeContentType(value) {
    const type = String(value || '').split(';', 1)[0].trim().toLowerCase();
    return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(type) ? type.slice(0, 100) : '';
  }

  function loadDetailed() {
    try { return sessionStorage.getItem(DETAIL_STORE_KEY) === '1'; } catch { return false; }
  }

  function detailAllowed(value) {
    if (!detailed) return false;
    try {
      const path = new URL(String(value ?? ''), location.href).pathname.replace(/\/+$/, '') || '/';
      return DETAIL_PATHS.includes(path);
    } catch {
      return false;
    }
  }

  function inventoryPathKind(value) {
    try {
      const path = new URL(String(value ?? ''), location.href).pathname.replace(/\/+$/, '') || '/';
      if (path === INVENTORY_PATH) return 'inventory';
      if (path === INVENTORY_MORE_PATH) return 'inventory-more';
    } catch {}
    return '';
  }

  function beginInventoryInspection(kind) {
    if (kind === 'inventory') {
      inventoryAwaitingMore = true;
      return false;
    }
    if (kind === 'inventory-more') {
      const followsInventory = inventoryAwaitingMore;
      inventoryAwaitingMore = false;
      return followsInventory;
    }
    return false;
  }

  function boundedInspectionText(value) {
    const raw = String(value ?? '');
    const truncated = raw.length > MAX_INVENTORY_INSPECT_BYTES;
    return {
      text:truncated ? raw.slice(0, MAX_INVENTORY_INSPECT_BYTES) : raw,
      truncated,
      readFailed:false,
      inspectedCount:Math.min(raw.length, MAX_INVENTORY_INSPECT_BYTES),
      inspectionUnit:'chars'
    };
  }

  async function readBoundedResponseText(response) {
    if (!response?.body) return { text:'', truncated:false, readFailed:false, inspectedCount:0, inspectionUnit:'bytes' };
    let reader;
    try {
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let text = '';
      let inspectedCount = 0;
      let truncated = false;
      while (inspectedCount < MAX_INVENTORY_INSPECT_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        const remaining = MAX_INVENTORY_INSPECT_BYTES - inspectedCount;
        const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
        text += decoder.decode(chunk, { stream:true });
        inspectedCount += chunk.byteLength;
        if (value.byteLength > remaining || inspectedCount === MAX_INVENTORY_INSPECT_BYTES) {
          truncated = true;
          try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch {}
          break;
        }
      }
      text += decoder.decode();
      return { text, truncated, readFailed:false, inspectedCount, inspectionUnit:'bytes' };
    } catch {
      try { void Promise.resolve(reader?.cancel()).catch(() => {}); } catch {}
      return { text:'', truncated:false, readFailed:true, inspectedCount:0, inspectionUnit:'bytes' };
    } finally {
      try { reader?.releaseLock(); } catch {}
    }
  }

  function singleSafeFact(values) {
    const unique = [...new Set(values)];
    return { value:unique.length === 1 ? unique[0] : null, conflict:unique.length > 1 };
  }

  function inspectInventoryResponse(text, options = {}) {
    const raw = String(text ?? '');
    const quantityValues = [...raw.matchAll(/\bQuantity\s*\(\s*(\d{1,9})\s*\)/gi)]
      .map(match => Number(match[1]))
      .filter(Number.isSafeInteger);
    const rowValues = [];
    const hasNextValues = [];
    const continuationValues = [];
    let inspectionFailure = Boolean(options.readFailed);
    let nodeLimitReached = false;

    const tableBodies = [...raw.matchAll(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/gi)];
    if (tableBodies.length) {
      rowValues.push(tableBodies.reduce((count, match) => count + (match[1].match(/<tr\b/gi)?.length || 0), 0));
    } else if (/<(?:table|tr)\b/i.test(raw)) {
      rowValues.push(raw.match(/<tr\b/gi)?.length || 0);
    }

    for (const tag of raw.match(/<input\b[^>]*>/gi) || []) {
      if (!/\bname\s*=\s*(['"])continuationToken\1/i.test(tag)) continue;
      const value = tag.match(/\bvalue\s*=\s*(['"])(.*?)\1/i)?.[2] || '';
      continuationValues.push(Boolean(value));
    }

    const looksJson = /json/i.test(options.contentType || '') || /^[\s]*[\[{]/.test(raw);
    if (looksJson && !options.readFailed) {
      try {
        const parsed = JSON.parse(raw);
        const stack = [{ value:parsed, key:'', depth:0 }];
        let visited = 0;
        while (stack.length) {
          if (++visited > MAX_INVENTORY_INSPECT_NODES) { nodeLimitReached = true; break; }
          const { value, key, depth } = stack.pop();
          if (Array.isArray(value)) {
            if (key === 'rows') rowValues.push(value.length);
            if (depth >= MAX_DEPTH) { nodeLimitReached = true; continue; }
            const limit = Math.min(value.length, 100);
            if (value.length > limit) nodeLimitReached = true;
            for (let index = limit - 1; index >= 0; index--) stack.push({ value:value[index], key:'', depth:depth + 1 });
            continue;
          }
          if (!value || typeof value !== 'object') continue;
          const entries = Object.entries(value);
          const limit = Math.min(entries.length, 100);
          if (entries.length > limit) nodeLimitReached = true;
          for (let index = 0; index < limit; index++) {
            const [childKey, childValue] = entries[index];
            if (childKey === 'hasNext') {
              if (typeof childValue === 'boolean') hasNextValues.push(childValue);
              else inspectionFailure = true;
            }
            if (/^continuationToken$/i.test(childKey)) {
              if (childValue == null || childValue === '') continuationValues.push(false);
              else if (typeof childValue === 'string') continuationValues.push(true);
              else inspectionFailure = true;
            }
            if (childKey === 'rows' && Array.isArray(childValue)) rowValues.push(childValue.length);
            if (depth < MAX_DEPTH) stack.push({ value:childValue, key:childKey, depth:depth + 1 });
            else if (childValue && typeof childValue === 'object') nodeLimitReached = true;
          }
        }
      } catch {
        inspectionFailure = true;
      }
    }

    const quantity = singleSafeFact(quantityValues);
    const rows = singleSafeFact(rowValues);
    const hasNext = singleSafeFact(hasNextValues);
    const continuation = singleSafeFact(continuationValues);
    inspectionFailure ||= quantity.conflict || rows.conflict || hasNext.conflict || continuation.conflict;
    const inspectionTruncated = Boolean(options.truncated);
    const inspectionIncomplete = inspectionTruncated || nodeLimitReached || inspectionFailure ||
      [quantity.value, rows.value, hasNext.value, continuation.value].some(value => value == null);
    return {
      quantityLabel:quantity.value == null ? null : `Quantity (${quantity.value})`,
      quantity:quantity.value,
      rowCount:rows.value,
      hasNext:hasNext.value,
      continuationPresent:continuation.value,
      inspectionTruncated,
      inspectionIncomplete,
      inspectionFailure,
      nodeLimitReached,
      inspectedCount:Number(options.inspectedCount || 0),
      inspectionUnit:options.inspectionUnit === 'bytes' ? 'bytes' : 'chars'
    };
  }

  function inspectInventoryMoreResponse(text, options = {}) {
    const raw = String(text ?? '');
    let parseFailure = false;
    if (!options.readFailed && !options.truncated && /json/i.test(options.contentType || '') && raw.trim()) {
      try { JSON.parse(raw); } catch { parseFailure = true; }
    }
    return {
      readFailure:Boolean(options.readFailed),
      parseFailure,
      inspectionTruncated:Boolean(options.truncated),
      inspectionIncomplete:Boolean(options.truncated || options.readFailed || parseFailure),
      inspectedCount:Number(options.inspectedCount || 0),
      inspectionUnit:options.inspectionUnit === 'bytes' ? 'bytes' : 'chars'
    };
  }

  function inventoryNetworkData(base, kind, inspection, followsInventory = false) {
    if (kind === 'inventory') return { ...base, inventoryFacts:inspection };
    if (kind !== 'inventory-more') return base;
    const networkFailure = Boolean(base.error || base.status === 0);
    const non2xx = base.ok === false && !networkFailure;
    return {
      ...base,
      inventoryFollowUp:{
        followsInventory:Boolean(followsInventory),
        failed:Boolean(non2xx || networkFailure || inspection.readFailure || inspection.parseFailure),
        non2xx,
        networkFailure,
        ...inspection
      }
    };
  }

  function bodySize(body) {
    try {
      if (typeof body === 'string') return { value:body.length, unit:'chars' };
      if (body instanceof URLSearchParams) return { value:body.toString().length, unit:'chars' };
      if (body instanceof Blob) return { value:body.size, unit:'bytes' };
      if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return { value:body.byteLength, unit:'bytes' };
    } catch {}
    return null;
  }

  function attachDetailedBodies(base, allowed, requestBody, responseBody) {
    if (!allowed) return base;
    const output = { ...base };
    if (requestBody !== undefined) output.requestBody = requestBody;
    if (responseBody !== undefined) output.responseBody = responseBody;
    return output;
  }

  function eventForExport(event) {
    const output = sanitize(event);
    if (detailed || output?.type !== 'network' || !output.data) return output;
    const { requestBody, responseBody, ...metadata } = output.data;
    return { ...output, data:metadata };
  }

  function setDetailed(value) {
    detailed = Boolean(value);
    try {
      if (detailed) sessionStorage.setItem(DETAIL_STORE_KEY, '1');
      else sessionStorage.removeItem(DETAIL_STORE_KEY);
    } catch {}
    if (!detailed) {
      events.splice(0, events.length, ...events.map(eventForExport));
      persistNow();
    }
    renderStatus();
  }

  function loadEvents() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(STORE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.slice(-MAX_EVENTS).map(event => sanitize(event)) : [];
    } catch {
      return [];
    }
  }

  function persistNow() {
    clearTimeout(flushTimer);
    flushTimer = 0;
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(events)); } catch {}
  }

  function schedulePersist() {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(persistNow, FLUSH_MS);
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
      id: element.id ? fingerprint(element.id, 'dom-id') : '',
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

  function responseBodySkip(contentType, length = 0) {
    const bytes = Number(length || 0);
    if (Number.isFinite(bytes) && bytes > MAX_RESPONSE_READ_BYTES) return `<response-body-skipped:${bytes}-bytes>`;
    const type = String(contentType || '').split(';', 1)[0].trim().toLowerCase();
    if (type && !/(?:json|javascript|xml|text|x-www-form-urlencoded)/i.test(type)) {
      return `<response-body-skipped:${scrubText(type)}>`;
    }
    return '';
  }

  function installFetchCapture() {
    const original = window.fetch;
    if (typeof original !== 'function') return;

    window.fetch = async function(input, init) {
      const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input?.url || '';
      const method = String(init?.method || input?.method || 'GET').toUpperCase();
      const captureDetail = detailAllowed(rawUrl);
      const inventoryKind = inventoryPathKind(rawUrl);
      const followsInventory = beginInventoryInspection(inventoryKind);
      const requestBody = captureDetail ? bodyFromRequest(input, init) : undefined;
      const requestSize = bodySize(init?.body);
      const started = performance.now();
      try {
        const response = await original.apply(this, arguments);
        const base = {
          transport:'fetch', method, url:sanitizeUrl(rawUrl),
          status:response.status, ok:response.ok, ms:Math.round(performance.now() - started),
          contentType:safeContentType(response.headers.get('content-type')),
          requestSize,
          responseSize:null
        };
        if (inventoryKind) {
          let inspectionResponse;
          try { inspectionResponse = response.clone(); } catch {}
          if (!inspectionResponse) {
            const result = { readFailed:true, truncated:false, inspectedCount:0, inspectionUnit:'bytes' };
            const inspection = inventoryKind === 'inventory'
              ? inspectInventoryResponse('', result)
              : inspectInventoryMoreResponse('', result);
            const sizedBase = !result.readFailed && !result.truncated
              ? { ...base, responseSize:{ value:result.inspectedCount, unit:result.inspectionUnit } }
              : base;
            add('network', inventoryNetworkData(sizedBase, inventoryKind, inspection, followsInventory));
            return response;
          }
          void readBoundedResponseText(inspectionResponse).then(result => {
            const inspection = inventoryKind === 'inventory'
              ? inspectInventoryResponse(result.text, { ...result, contentType:base.contentType })
              : inspectInventoryMoreResponse(result.text, { ...result, contentType:base.contentType });
            add('network', inventoryNetworkData(base, inventoryKind, inspection, followsInventory));
          });
          return response;
        }
        if (!captureDetail) {
          add('network', base);
          return response;
        }
        const skipped = responseBodySkip(base.contentType);
        if (skipped) add('network', attachDetailedBodies(base, true, requestBody, skipped));
        else {
          void response.clone().text()
            .then(text => add('network', attachDetailedBodies(
              { ...base, responseSize:base.responseSize || { value:text.length, unit:'chars' } },
              true,
              requestBody,
              parseResponseText(text, base.contentType)
            )))
            .catch(error => add('network', attachDetailedBodies(
              { ...base, responseReadError:scrubText(error?.message || error) },
              true,
              requestBody
            )));
        }
        return response;
      } catch (error) {
        const base = {
          transport:'fetch', method, url:sanitizeUrl(rawUrl), requestSize,
          error:inventoryKind ? 'network-failure' : scrubText(error?.message || error),
          ms:Math.round(performance.now() - started),
          ...(inventoryKind ? { status:0, ok:false } : {})
        };
        if (inventoryKind) {
          const result = { readFailed:true, truncated:false, inspectedCount:0, inspectionUnit:'bytes' };
          const inspection = inventoryKind === 'inventory'
            ? inspectInventoryResponse('', result)
            : inspectInventoryMoreResponse('', result);
          add('network', inventoryNetworkData(base, inventoryKind, inspection, followsInventory));
        } else {
          add('network', attachDetailedBodies(base, captureDetail, requestBody));
        }
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
      const captureDetail = detailAllowed(meta.url);
      const inventoryKind = inventoryPathKind(meta.url);
      const followsInventory = beginInventoryInspection(inventoryKind);
      const requestBody = captureDetail ? parseBody(body) : undefined;
      const requestSize = bodySize(body);
      const started = performance.now();
      this.addEventListener('loadend', () => {
        let contentType = '';
        let responseSize = null;
        let responseBody;
        let inventoryRead = null;
        try {
          contentType = safeContentType(this.getResponseHeader('content-type'));
          if (this.responseType && this.responseType !== 'text') {
            responseSize = bodySize(this.response);
          }
          if (!responseSize && (!this.responseType || this.responseType === 'text')) {
            responseSize = { value:String(this.responseText || '').length, unit:'chars' };
          }
          if (inventoryKind) {
            inventoryRead = !this.responseType || this.responseType === 'text'
              ? boundedInspectionText(this.responseText)
              : { text:'', truncated:false, readFailed:true, inspectedCount:0, inspectionUnit:'chars' };
          } else if (captureDetail) {
            const length = responseSize?.value || 0;
            responseBody = responseBodySkip(contentType, length) || (
              this.responseType && this.responseType !== 'text'
                ? sanitize(this.response)
                : parseResponseText(this.responseText, contentType)
            );
          }
        } catch (error) {
          if (inventoryKind) inventoryRead = { text:'', truncated:false, readFailed:true, inspectedCount:0, inspectionUnit:'chars' };
          else if (captureDetail) responseBody = `<response-read-failed:${scrubText(error?.message || error)}>`;
        }
        const base = {
          transport:'xhr', method:meta.method, url:sanitizeUrl(meta.url), requestSize,
          status:this.status, ok:this.status >= 200 && this.status < 300,
          ms:Math.round(performance.now() - started), contentType, responseSize
        };
        if (inventoryKind) {
          const result = inventoryRead || { text:'', truncated:false, readFailed:true, inspectedCount:0, inspectionUnit:'chars' };
          const inspection = inventoryKind === 'inventory'
            ? inspectInventoryResponse(result.text, { ...result, contentType })
            : inspectInventoryMoreResponse(result.text, { ...result, contentType });
          add('network', inventoryNetworkData(base, inventoryKind, inspection, followsInventory));
        } else {
          add('network', attachDetailedBodies(base, captureDetail, requestBody, responseBody));
        }
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
      window.addEventListener(name, () => {
        add(`page.${name}`, { visibility:document.visibilityState });
        if (name === 'pagehide') persistNow();
      }, true);
    }
    document.addEventListener('visibilitychange', () => add('page.visibility', { visibility:document.visibilityState }), true);
  }

  function mutationTargetName(target) {
    const element = target?.nodeType === 1 ? target : target?.parentElement;
    if (!element) return 'unknown';
    if (host?.contains(element)) return 'diagnostic';
    return `${element.tagName?.toLowerCase() || 'node'}${element.id ? `#${fingerprint(element.id, 'dom-id')}` : ''}`.slice(0, 100);
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

  function inventorySummary() {
    const inventoryRows = events.filter(event => event.type === 'network' && event.data?.inventoryFacts);
    const followUps = events.filter(event => event.type === 'network' && event.data?.inventoryFollowUp);
    return {
      requests:inventoryRows.length,
      followUps:followUps.length,
      followed:followUps.filter(event => event.data.inventoryFollowUp.followsInventory).length,
      failures:followUps.filter(event => event.data.inventoryFollowUp.failed).length,
      followedFailures:followUps.filter(event => event.data.inventoryFollowUp.followsInventory && event.data.inventoryFollowUp.failed).length,
      incomplete:inventoryRows.filter(event => event.data.inventoryFacts.inspectionIncomplete).length
    };
  }

  function report() {
    const exportedEvents = events.map(eventForExport);
    return {
      capture:{
        name:'BWU2 Unified Live Evidence', version:VERSION, startedAt, exportedAt:new Date().toISOString(),
        detailedCapture:detailed, detailAllowlist:[...DETAIL_PATHS]
      },
      privacy:{
        headers:'only response content-type captured', cookies:'not captured', credentials:'not captured',
        identifiers:'fingerprinted', networkBodies:detailed ? 'allowlisted opt-in' : 'not captured'
      },
      environment:{ host:location.host, path:new URL(sanitizeUrl(location.href)).pathname, userAgent:navigator.userAgent, viewport:`${innerWidth}x${innerHeight}` },
      summary:{
        events:exportedEvents.length,
        networks:exportedEvents.filter(event => event.type === 'network').length,
        requests:networkSummary(),
        inventory:inventorySummary()
      },
      events:exportedEvents
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
    statusNode.textContent = `${active ? 'CAPTURING' : 'PAUSED'} • ${detailed ? 'DETAIL ON' : 'METADATA ONLY'} • ${events.length} events • ${networks} network`;
    statusNode.style.color = active ? '#166534' : '#9a3412';
    if (detailButton) detailButton.textContent = detailed ? 'Disable detail' : 'Enable detail';
    if (privacyNote) {
      privacyNote.textContent = detailed
        ? 'Detail ON for allowlisted workflow endpoints only. Bodies redacted and capped.'
        : 'Metadata only. No request or response bodies captured.';
    }
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
    detailButton = button('Enable detail', () => {
      if (!detailed && !confirm('Enable sanitized body capture for allowlisted workflow endpoints in this tab session?')) return;
      setDetailed(!detailed);
    });
    actions.append(
      button('Mark', () => add('manual.mark', { note:scrubText(prompt('Short marker (no IDs):', '') || '') })),
      button('Copy', copyOutput),
      button('Download', downloadOutput),
      button('Clear', () => { events.length = 0; try { sessionStorage.removeItem(STORE_KEY); } catch {} renderStatus(); }),
      pause,
      detailButton
    );
    privacyNote = document.createElement('div');
    privacyNote.style.cssText = 'margin-top:6px;color:#475569;font:10px/1.25 Arial';
    panel.append(title, statusNode, actions, privacyNote);
    shadow.append(panel);
    document.documentElement.appendChild(host);
    renderStatus();
  }

  window.__bwu2LiveEvidence = Object.freeze({
    version:VERSION,
    mark:note => add('manual.mark', { note:scrubText(note) }),
    pause:() => { active = false; renderStatus(); },
    resume:() => { active = true; renderStatus(); },
    detailed:() => detailed,
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
  add('capture.start', { version:VERSION, host:location.host, page:sanitizeUrl(location.href) });
})();
