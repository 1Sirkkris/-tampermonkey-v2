// ==UserScript==
// @name         CORE v0.1.4 BWU2 Observability Core
// @namespace    https://github.com/1Sirkkris
// @version      0.1.4
// @description  Lightweight cross-tool observability core. Silent except tiny FCResearch counter/export/clear control.
// @include      /^https?:\/\/aft-poirot-website-nrt\.nrt\.proxy\.amazon\.com\//
// @include      /^https?:\/\/aft-qt-[^\/]+(?:\.aka\.[^\/]+)?\.corp\.amazon\.com\//
// @include      /^https?:\/\/(?:[^\/]*fcresearch[^\/]*|qifcr\.fe\.aftx\.amazonoperations\.app)\//
// @include      /^https?:\/\/aft-moveapp-[^\/]+(?:\.nrt)?\.proxy\.amazon\.com\//
// @include      /^https?:\/\/t\.corp\.amazon\.com\//
// @include      /^https?:\/\/aftcartonpreditorapp-tcp-nrt\.nrt\.proxy\.amazon\.com\//
// @include      /^https?:\/\/fba-fnsku-commingling-console-(?:eu|na|jp)\.aka\.amazon\.com\//
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/BWU2_Observability_Core.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/BWU2_Observability_Core.user.js
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = '0.1.4';
  const PREFIX = 'bwu2:observability:v1:';
  const META_KEY = `${PREFIX}meta`;
  const PAGE_PREFIX = `${PREFIX}page:`;
  const COUNT_PREFIX = `${PREFIX}count:`;
  const MAX_EVENTS = 3000;
  const WARN_AT = Math.floor(MAX_EVENTS * 0.80);
  const FLUSH_MS = 300;
  const COUNT_REFRESH_MS = 500;
  const MAX_BODY_CHARS = 5000;
  const MUTATION_REPORT_MS = 10000;
  const EVENT_LOOP_WARN_MS = 500;
  const EVENT_LOOP_MIN_GAP_MS = 10000;
  const FCR_NETWORK_QUIET_MS = 1200;
  const FCR_CORE_QUIET_MS = 1200;
  const SLOW_NETWORK_MS = 1500;
  const VISIBILITY_DEBOUNCE_MS = 750;
  const VIEWPORT_DEBOUNCE_MS = 500;
  const POLL_NETWORK_QUIET_MS = 1200;
  const SAMPLE_PREFIX = `${PREFIX}sample:`;
  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  if (W.__BWU2_OBSERVABILITY_CORE_V1__) return;
  W.__BWU2_OBSERVABILITY_CORE_V1__ = true;

  const SENSITIVE_KEY = /authorization|cookie|credential|csrf|jwt|password|passwd|secret|session.?token|signature|token|x-amz|api.?key/i;
  const IDENTIFIER_KEY = /asin|barcode|container|correlation.?id|destination|fcsku|fnsku|item|lpn|object|pod|request.?id|scannable|sku|source|trace.?id/i;
  const SAFE_SOURCE_VALUE = /^(?:cache|network|dedupe|empty|error|remembered|uncached|unknown|other)$/i;
  const SAFE_QUERY_KEY = /^(?:action|mode|page|sort|state|tab|type|view)$/i;
  const DETAILED_PATH = /(?:\/api\/|edititems|fcskuflip|moveitems|move-container|close-container|scan-source-container|scanitem|sideline|dropzone|print)/i;
  const NOISE_HOST = /(?:^|\.)(?:data\.pendo\.aft\.amazon\.dev|api\.pendo\.aft\.amazon\.dev)$/i;
  const NOISE_PATH = /(?:^|\/)logger(?:$|[/?#])/i;
  const FCR_HOST = /(?:fcresearch|qifcr\.fe\.aftx\.amazonoperations\.app)/i;
  const SIM_HOST = /^t\.corp\.amazon\.com$/i;

  const pageId = randomId('p_');
  let meta = loadMeta();
  let activeSessionId = meta.sessionId;
  let pageEvents = [];
  let pageStoreKey = pageKey(activeSessionId);
  let pageCountKey = countKey(activeSessionId);
  let flushTimer = 0;
  let eventSeq = 0;
  let lastHref = location.href;
  let lastCountReadAt = 0;
  let lastGlobalCount = 0;
  let full = false;
  let mutationObserver = null;
  let mutationStats = emptyMutationStats();
  let mutationTimer = 0;
  let uiObserver = null;
  let uiRoot = null;
  let uiCount = null;
  let uiClear = null;
  let uiTimer = 0;
  let lastEventLoopLogAt = 0;
  let visibilityTimer = 0;
  let viewportTimer = 0;
  let lastViewport = '';
  let performanceObserver = null;
  let eventLoopTimer = 0;
  let fcrNetworkTimer = 0;
  let fcrNetworkStats = new Map();
  let pollNetworkTimer = 0;
  let pollNetworkStats = new Map();
  const corePending = new Map();
  let coreSuccessTimer = 0;
  let coreSuccessStats = new Map();
  let lastRejection = null;

  function gmGet(key, fallback) { try { return GM_getValue(key, fallback); } catch { return fallback; } }
  function gmSet(key, value) { try { GM_setValue(key, value); return true; } catch { return false; } }
  function gmDelete(key) { try { GM_deleteValue(key); } catch {} }
  function gmKeys() { try { return GM_listValues() || []; } catch { return []; } }

  function randomId(prefix = '') {
    try {
      const a = new Uint32Array(2);
      crypto.getRandomValues(a);
      return `${prefix}${a[0].toString(36)}${a[1].toString(36)}`;
    } catch {
      return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
    }
  }

  function defaultMeta() {
    return { sessionId: randomId('s_'), startedAt: Date.now(), createdBy: VERSION, resets: 0 };
  }

  function loadMeta() {
    try {
      const raw = gmGet(META_KEY, '');
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.sessionId) return parsed;
    } catch {}
    const fresh = defaultMeta();
    gmSet(META_KEY, JSON.stringify(fresh));
    return fresh;
  }

  function saveMeta(value) {
    meta = value;
    gmSet(META_KEY, JSON.stringify(value));
  }

  function pageKey(sessionId) { return `${PAGE_PREFIX}${sessionId}:${pageId}`; }
  function countKey(sessionId) { return `${COUNT_PREFIX}${sessionId}:${pageId}`; }

  function syncSession() {
    const latest = loadMeta();
    if (latest.sessionId === activeSessionId) {
      meta = latest;
      return false;
    }

    clearTimeout(flushTimer);
    flushTimer = 0;
    activeSessionId = latest.sessionId;
    meta = latest;
    pageEvents = [];
    eventSeq = 0;
    pageStoreKey = pageKey(activeSessionId);
    pageCountKey = countKey(activeSessionId);
    lastCountReadAt = 0;
    lastGlobalCount = 0;
    full = false;
    mutationStats = emptyMutationStats();
    fcrNetworkStats = new Map();
    clearTimeout(fcrNetworkTimer);
    fcrNetworkTimer = 0;
    pollNetworkStats = new Map();
    clearTimeout(pollNetworkTimer);
    pollNetworkTimer = 0;
    corePending.clear();
    clearTimeout(coreSuccessTimer);
    coreSuccessTimer = 0;
    coreSuccessStats = new Map();
    gmSet(pageCountKey, 0);
    return true;
  }

  function sessionCount(force = false) {
    syncSession();
    const now = Date.now();
    if (!force && now - lastCountReadAt < COUNT_REFRESH_MS) return lastGlobalCount;

    let total = 0;
    const prefix = `${COUNT_PREFIX}${activeSessionId}:`;
    for (const key of gmKeys()) {
      if (key.startsWith(prefix)) total += Math.max(0, Number(gmGet(key, 0)) || 0);
    }

    lastCountReadAt = now;
    lastGlobalCount = total;
    full = total >= MAX_EVENTS;
    return total;
  }

  function sessionPageKeys(sessionId = activeSessionId) {
    const prefix = `${PAGE_PREFIX}${sessionId}:`;
    return gmKeys().filter(key => key.startsWith(prefix));
  }

  function clip(value, max = MAX_BODY_CHARS) {
    const text = String(value ?? '');
    return text.length > max ? `${text.slice(0, max)}…<truncated:${text.length}>` : text;
  }

  function hash(value) {
    let out = 2166136261;
    for (const char of String(value ?? '')) {
      out ^= char.charCodeAt(0);
      out = Math.imul(out, 16777619);
    }
    return (out >>> 0).toString(36);
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
    return clip(text);
  }

  function sanitizePath(value) {
    return String(value ?? '').split('/').map(segment => {
      if (/^P\d{8,14}$/i.test(segment)) return fingerprint(segment, 'ticket');
      return scrubText(segment);
    }).join('/');
  }

  function sanitizeUrl(value) {
    try {
      const url = new URL(String(value ?? ''), location.href);
      url.username = '';
      url.password = '';
      url.pathname = sanitizePath(url.pathname);
      for (const [key, raw] of [...url.searchParams.entries()]) {
        url.searchParams.set(key, SAFE_QUERY_KEY.test(key) ? scrubText(raw) : fingerprint(raw, `query:${key}`));
      }
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
      if (/^source$/i.test(key) && SAFE_SOURCE_VALUE.test(value)) return value.toLowerCase();
      if (IDENTIFIER_KEY.test(key)) return fingerprint(value, key || 'id');
      if (/url|uri|href/i.test(key) || /^https?:\/\//i.test(value)) return sanitizeUrl(value);
      return scrubText(value);
    }

    if (depth >= 6) return `<max-depth:${Object.prototype.toString.call(value).slice(8, -1)}>`;
    if (typeof value !== 'object') return `<${typeof value}>`;
    if (seen.has(value)) return '<circular>';

    seen.add(value);

    if (Array.isArray(value)) return value.slice(0, 80).map(item => sanitize(item, key, depth + 1, seen));

    const output = {};
    let count = 0;
    for (const [childKey, childValue] of Object.entries(value)) {
      if (++count > 140) {
        output.__truncated = true;
        break;
      }
      output[childKey] = sanitize(childValue, childKey, depth + 1, seen);
    }
    return output;
  }

  function parsedUrl(rawUrl) {
    try { return new URL(String(rawUrl || ''), location.href); }
    catch { return null; }
  }

  function isNoise(rawUrl) {
    const url = parsedUrl(rawUrl);
    return !!url && (NOISE_HOST.test(url.hostname) || NOISE_PATH.test(url.pathname));
  }

  function isPollNetwork(rawUrl) {
    const url = parsedUrl(rawUrl);
    return !!url && /\/status$/i.test(url.pathname);
  }

  function isFcrNetwork(rawUrl) {
    const url = parsedUrl(rawUrl);
    return !!url && FCR_HOST.test(url.hostname) && /\/results\//i.test(url.pathname);
  }

  function isDetailedApi(rawUrl) {
    const url = parsedUrl(rawUrl);
    if (SIM_HOST.test(location.hostname)) return false;
    if (url && FCR_HOST.test(url.hostname)) return false;
    if (url) return DETAILED_PATH.test(url.pathname);
    return DETAILED_PATH.test(String(rawUrl || ''));
  }

  function endpointKey(method, rawUrl) {
    const url = parsedUrl(rawUrl);
    return `${String(method || 'GET').toUpperCase()} ${url?.hostname || ''}${url?.pathname || String(rawUrl || '')}`;
  }

  function claimFcrShapeSample(method, rawUrl) {
    syncSession();
    const key = `${SAMPLE_PREFIX}${activeSessionId}:${hash(endpointKey(method, rawUrl))}`;
    if (gmGet(key, false)) return false;
    gmSet(key, true);
    return true;
  }

  function classifySearchValue(value) {
    const text = String(value ?? '').trim();
    if (!text) return 'empty';
    if (/^(?:ts|cs)x[A-Za-z0-9_-]+$/i.test(text)) return 'container';
    if (/^(?:B0|X0|ZZ)[A-Z0-9]{8}$/i.test(text)) return 'item';
    if (/^P-\d-(?:[A-Z]\d{3}){2}$/i.test(text)) return 'pod';
    if (/^\d{8,14}$/.test(text)) return 'numeric';
    return 'text';
  }

  function summarizeRequestShape(body) {
    let value = body;
    try {
      if (typeof body === 'string') {
        try { value = JSON.parse(body); }
        catch { value = Object.fromEntries(new URLSearchParams(body).entries()); }
      } else if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
        value = Object.fromEntries(body.entries());
      } else if (typeof FormData !== 'undefined' && body instanceof FormData) {
        value = Object.fromEntries(body.entries());
      }
    } catch {}

    if (!value || typeof value !== 'object' || Array.isArray(value)) return { kind: typeof value };
    const keys = Object.keys(value).slice(0, 30);
    const out = { kind: 'object', keys };
    if (Object.prototype.hasOwnProperty.call(value, 's')) out.searchKind = classifySearchValue(value.s);
    return out;
  }

  function summarizeFcrResponse(text, contentType = '') {
    const raw = String(text ?? '');
    const base = { chars: raw.length };

    if (/json/i.test(contentType) || /^\s*[\[{]/.test(raw)) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return { ...base, kind: 'json-array', length: parsed.length };
        return { ...base, kind: 'json-object', keys: Object.keys(parsed || {}).slice(0, 30) };
      } catch {}
    }

    try {
      const doc = new DOMParser().parseFromString(raw, 'text/html');
      const sectionTitles = [...doc.querySelectorAll('.section-title')]
        .map(node => scrubText(String(node.textContent || '').replace(/\s+/g, ' ').trim()))
        .filter(Boolean)
        .slice(0, 8);
      const tables = [...doc.querySelectorAll('table')].slice(0, 8).map(table => ({
        id: scrubText(table.id || ''),
        headers: [...table.querySelectorAll('thead th')].map(th => scrubText(String(th.textContent || '').replace(/\s+/g, ' ').trim())).filter(Boolean).slice(0, 24),
        rows: table.querySelectorAll('tbody tr').length
      }));
      const pagination = [...doc.querySelectorAll('.pagination-token')];
      return {
        ...base,
        kind: 'html',
        sectionTitles,
        tables,
        paginationPresent: pagination.length > 0,
        paginationHasMore: pagination.some(node => /true/i.test(String(node.textContent || '').trim()))
      };
    } catch {
      return { ...base, kind: 'text' };
    }
  }

  function recordFcrNetwork(base, rawUrl, body, responseText = '', contentType = '') {
    const url = parsedUrl(rawUrl);
    const path = url?.pathname || '';
    const key = `${base.method} ${path}`;
    const stat = fcrNetworkStats.get(key) || { method: base.method, path, count: 0, failures: 0, totalMs: 0, maxMs: 0 };
    stat.count++;
    if (!base.ok) stat.failures++;
    stat.totalMs += Number(base.ms || 0);
    stat.maxMs = Math.max(stat.maxMs, Number(base.ms || 0));
    fcrNetworkStats.set(key, stat);

    clearTimeout(fcrNetworkTimer);
    fcrNetworkTimer = setTimeout(flushFcrNetworkSummary, FCR_NETWORK_QUIET_MS);

    if (Number(base.ms || 0) >= SLOW_NETWORK_MS) {
      add('network.slow', { ...base, path });
    }

    if (!base.ok) {
      add('network.http-error', { ...base, path });
    }

    if (claimFcrShapeSample(base.method, rawUrl)) {
      add('fcr.response.shape', {
        method: base.method,
        path,
        status: base.status,
        ms: base.ms,
        request: summarizeRequestShape(body),
        response: summarizeFcrResponse(responseText, contentType)
      });
    }
  }

  function flushFcrNetworkSummary() {
    clearTimeout(fcrNetworkTimer);
    fcrNetworkTimer = 0;
    if (!fcrNetworkStats.size) return;
    const endpoints = [...fcrNetworkStats.values()].map(stat => ({
      method: stat.method,
      path: stat.path,
      count: stat.count,
      failures: stat.failures,
      averageMs: stat.count ? Math.round(stat.totalMs / stat.count) : 0,
      maxMs: Math.round(stat.maxMs)
    })).sort((a, b) => a.path.localeCompare(b.path));
    fcrNetworkStats = new Map();
    add('fcr.network.summary', { endpoints });
  }

  function recordPollNetwork(base, rawUrl) {
    const url = parsedUrl(rawUrl);
    const key = `${base.method} ${url?.hostname || ''}${url?.pathname || ''}`;
    const stat = pollNetworkStats.get(key) || {
      method: base.method, host: url?.hostname || '', path: url?.pathname || '',
      count: 0, failures: 0, totalMs: 0, maxMs: 0
    };
    stat.count++;
    if (!base.ok) stat.failures++;
    stat.totalMs += Number(base.ms || 0);
    stat.maxMs = Math.max(stat.maxMs, Number(base.ms || 0));
    pollNetworkStats.set(key, stat);
    clearTimeout(pollNetworkTimer);
    pollNetworkTimer = setTimeout(flushPollNetworkSummary, POLL_NETWORK_QUIET_MS);
  }

  function flushPollNetworkSummary() {
    clearTimeout(pollNetworkTimer);
    pollNetworkTimer = 0;
    if (!pollNetworkStats.size) return;
    const endpoints = [...pollNetworkStats.values()].map(stat => ({
      method: stat.method, host: stat.host, path: stat.path, count: stat.count,
      failures: stat.failures, averageMs: stat.count ? Math.round(stat.totalMs / stat.count) : 0,
      maxMs: Math.round(stat.maxMs)
    }));
    pollNetworkStats = new Map();
    add('network.poll.summary', { endpoints });
  }

  function flushPage() {
    syncSession();
    clearTimeout(flushTimer);
    flushTimer = 0;

    try {
      gmSet(pageStoreKey, JSON.stringify({
        sessionId: activeSessionId,
        pageId,
        href: sanitizeUrl(location.href),
        updatedAt: Date.now(),
        version: VERSION,
        events: pageEvents
      }));
      gmSet(pageCountKey, pageEvents.length);
    } catch {}
  }

  function scheduleFlush() {
    if (!flushTimer) flushTimer = setTimeout(flushPage, FLUSH_MS);
  }

  function add(type, data = {}) {
    syncSession();

    if (full || sessionCount() >= MAX_EVENTS) {
      full = true;
      renderUi();
      return false;
    }

    pageEvents.push({
      at: new Date().toISOString(),
      ts: Date.now(),
      p: Math.round(performance.now?.() || 0),
      id: `${pageId}:${++eventSeq}`,
      pageId,
      type: String(type || 'event').slice(0, 100),
      page: sanitizeUrl(location.href),
      data: sanitize(data)
    });

    lastGlobalCount++;
    scheduleFlush();
    return true;
  }

  function collectSession(sessionId = activeSessionId) {
    flushCoreSuccessSummary();
    flushPage();
    const events = [];

    for (const key of sessionPageKeys(sessionId)) {
      try {
        const parsed = JSON.parse(gmGet(key, '') || '{}');
        if (Array.isArray(parsed.events)) events.push(...parsed.events);
      } catch {}
    }

    events.sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));
    return events.slice(0, MAX_EVENTS);
  }

  function exportText(events) {
    const lines = [
      'BWU2 OBSERVABILITY CORE',
      `Version: ${VERSION}`,
      `Session: ${activeSessionId}`,
      `Started: ${new Date(meta.startedAt || Date.now()).toISOString()}`,
      `Exported: ${new Date().toISOString()}`,
      `Events: ${events.length}/${MAX_EVENTS}`,
      '',
      'EVENTS'
    ];

    for (const event of events) lines.push(JSON.stringify(event));
    return lines.join('\n');
  }

  function downloadAndReset() {
    const events = collectSession();
    const blob = new Blob([exportText(events)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = `BWU2_Observability_${stamp}_${events.length}events.txt`;
    anchor.style.display = 'none';
    (document.body || document.documentElement).appendChild(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1500);
    resetSession('download');
  }

  function resetSession(reason = 'clear') {
    const oldSession = activeSessionId;

    clearTimeout(flushTimer);
    flushTimer = 0;

    for (const key of gmKeys()) {
      if (
        key.startsWith(`${PAGE_PREFIX}${oldSession}:`) ||
        key.startsWith(`${COUNT_PREFIX}${oldSession}:`) ||
        key.startsWith(`${SAMPLE_PREFIX}${oldSession}:`)
      ) gmDelete(key);
    }

    const fresh = defaultMeta();
    fresh.resets = (Number(meta.resets) || 0) + 1;
    fresh.previousReason = reason;
    saveMeta(fresh);

    activeSessionId = fresh.sessionId;
    pageEvents = [];
    eventSeq = 0;
    pageStoreKey = pageKey(activeSessionId);
    pageCountKey = countKey(activeSessionId);
    gmSet(pageCountKey, 0);
    lastGlobalCount = 0;
    lastCountReadAt = Date.now();
    full = false;
    mutationStats = emptyMutationStats();
    fcrNetworkStats = new Map();
    clearTimeout(fcrNetworkTimer);
    fcrNetworkTimer = 0;
    pollNetworkStats = new Map();
    clearTimeout(pollNetworkTimer);
    pollNetworkTimer = 0;
    corePending.clear();
    clearTimeout(coreSuccessTimer);
    coreSuccessTimer = 0;
    coreSuccessStats = new Map();
    renderUi(true);
    add('session.start', { reason });
  }

  function installFetchTrace() {
    try {
      const nativeFetch = W.fetch;
      if (typeof nativeFetch !== 'function' || nativeFetch.__bwu2ObsV1) return;

      const wrapped = async function(input, init = {}) {
        const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input?.url || '';
        const method = String(init?.method || input?.method || 'GET').toUpperCase();
        const noise = isNoise(rawUrl);
        const fcr = !noise && isFcrNetwork(rawUrl);
        const detailed = !noise && !fcr && isDetailedApi(rawUrl);
        const started = performance.now();

        try {
          const response = await nativeFetch.apply(this, arguments);
          if (noise) return response;

          const base = {
            transport: 'fetch',
            method,
            url: sanitizeUrl(rawUrl),
            status: response.status,
            ok: response.ok,
            ms: Math.round(performance.now() - started),
            redirected: !!response.redirected,
            finalUrl: response.url ? sanitizeUrl(response.url) : null
          };

          if (fcr) {
            void response.clone().text()
              .then(text => recordFcrNetwork(base, rawUrl, init?.body, text, response.headers.get('content-type') || ''))
              .catch(() => recordFcrNetwork(base, rawUrl, init?.body));
          } else if (detailed) {
            void response.clone().text()
              .then(text => add('network.detail', {
                ...base,
                request: summarizeRequestShape(init?.body),
                response: summarizeFcrResponse(text, response.headers.get('content-type') || '')
              }))
              .catch(error => add('network.detail', {
                ...base,
                request: summarizeRequestShape(init?.body),
                responseReadError: scrubText(error?.message || error)
              }));
          } else if (isPollNetwork(rawUrl)) {
            recordPollNetwork(base, rawUrl);
          } else {
            add('network.meta', base);
          }

          return response;
        } catch (error) {
          if (!noise) {
            const message = scrubText(error?.message || error);
            const aborted = error?.name === 'AbortError' || /\babort(?:ed|ing)?\b/i.test(message);
            add(aborted ? 'network.abort' : 'network.error', {
              transport: 'fetch',
              method,
              url: sanitizeUrl(rawUrl),
              request: aborted ? null : (detailed ? summarizeRequestShape(init?.body) : null),
              ms: Math.round(performance.now() - started),
              error: message
            });
          }
          throw error;
        }
      };

      try { Object.defineProperty(wrapped, 'name', { value: nativeFetch.name || 'fetch' }); } catch {}
      wrapped.__bwu2ObsV1 = true;
      W.fetch = wrapped;
    } catch (error) {
      add('core.error', { area: 'fetch-hook', error: scrubText(error?.message || error) });
    }
  }

  function installXhrTrace() {
    try {
      const XHR = W.XMLHttpRequest;
      if (!XHR?.prototype || XHR.prototype.__bwu2ObsV1) return;

      const originalOpen = XHR.prototype.open;
      const originalSend = XHR.prototype.send;

      XHR.prototype.open = function(method, url) {
        this.__bwu2Obs = {
          method: String(method || 'GET').toUpperCase(),
          url: String(url || '')
        };
        return originalOpen.apply(this, arguments);
      };

      XHR.prototype.send = function(body) {
        const info = this.__bwu2Obs || { method: 'GET', url: '' };
        const noise = isNoise(info.url);
        if (noise) return originalSend.apply(this, arguments);

        const fcr = isFcrNetwork(info.url);
        const detailed = !fcr && isDetailedApi(info.url);
        const started = performance.now();

        this.addEventListener('loadend', () => {
          const base = {
            transport: 'xhr',
            method: info.method,
            url: sanitizeUrl(info.url),
            status: this.status,
            ok: this.status >= 200 && this.status < 300,
            ms: Math.round(performance.now() - started),
            finalUrl: this.responseURL ? sanitizeUrl(this.responseURL) : null
          };

          if (fcr) {
            let text = '';
            let contentType = '';
            try {
              if (!this.responseType || this.responseType === 'text') text = this.responseText || '';
              contentType = this.getResponseHeader('content-type') || '';
            } catch {}
            recordFcrNetwork(base, info.url, body, text, contentType);
          } else if (detailed) {
            const detail = { ...base, request: summarizeRequestShape(body) };
            try {
              if (!this.responseType || this.responseType === 'text') {
                detail.response = summarizeFcrResponse(
                  this.responseText || '',
                  this.getResponseHeader('content-type') || ''
                );
              } else {
                detail.response = { kind: this.responseType || 'non-text' };
              }
            } catch (error) {
              detail.responseReadError = scrubText(error?.message || error);
            }
            add('network.detail', detail);
          } else if (isPollNetwork(info.url)) {
            recordPollNetwork(base, info.url);
          } else {
            add('network.meta', base);
          }
        }, { once: true });

        return originalSend.apply(this, arguments);
      };

      XHR.prototype.__bwu2ObsV1 = true;
    } catch (error) {
      add('core.error', { area: 'xhr-hook', error: scrubText(error?.message || error) });
    }
  }

  function targetInfo(target) {
    const element = target instanceof Element ? target : target?.parentElement;
    if (!element || uiRoot?.contains(element)) return null;

    const label =
      element.getAttribute('aria-label') ||
      element.getAttribute('title') ||
      element.innerText ||
      element.textContent ||
      '';

    return {
      tag: element.tagName?.toLowerCase() || 'unknown',
      id: scrubText(element.id || ''),
      role: element.getAttribute('role') || '',
      type: element.getAttribute('type') || '',
      name: element.getAttribute('name') || '',
      label: scrubText(String(label).replace(/\s+/g, ' ').trim().slice(0, 100))
    };
  }

  function shouldLogClick(target) {
    const element = target instanceof Element ? target : target?.parentElement;
    if (!element) return false;
    const tag = element.tagName?.toLowerCase() || '';
    const type = String(element.getAttribute?.('type') || '').toLowerCase();
    if (tag === 'textarea') return false;
    if (tag === 'input' && ['text', 'search', 'date', 'datetime-local', 'number', 'email', 'password', 'submit', 'reset', 'file', ''].includes(type)) return false;
    return true;
  }

  function shouldLogChange(target) {
    const element = target instanceof Element ? target : target?.parentElement;
    if (!element) return false;
    const tag = element.tagName?.toLowerCase() || '';
    const type = String(element.getAttribute?.('type') || '').toLowerCase();
    return tag === 'select' || (tag === 'input' && ['checkbox', 'radio'].includes(type));
  }

  function installActionTrace() {
    document.addEventListener('click', event => {
      if (!event.isTrusted || !shouldLogClick(event.target)) return;
      const info = targetInfo(event.target);
      if (info) add('ui.click', info);
    }, true);

    document.addEventListener('submit', event => {
      if (!event.isTrusted) return;
      const info = targetInfo(event.target);
      if (info) add('ui.submit', info);
    }, true);

    document.addEventListener('change', event => {
      if (!event.isTrusted || !shouldLogChange(event.target)) return;
      const info = targetInfo(event.target);
      if (info) add('ui.change', info);
    }, true);

    document.addEventListener('keydown', event => {
      if (!event.isTrusted || event.key !== 'Enter') return;
      const info = targetInfo(event.target);
      if (!info) return;

      let value = '';
      try { value = event.target?.value || ''; } catch {}

      add('ui.enter', { ...info, inputKind: classifySearchValue(value), inputLength: String(value || '').length });
    }, true);
  }

  function installRouteTrace() {
    const wrap = name => {
      try {
        const original = W.history?.[name];
        if (typeof original !== 'function') return;

        W.history[name] = function() {
          const before = location.href;
          const result = original.apply(this, arguments);
          const after = location.href;

          if (after !== before) add(`route.${name}`, {
            from: sanitizeUrl(before),
            to: sanitizeUrl(after)
          });

          lastHref = after;
          return result;
        };
      } catch {}
    };

    wrap('pushState');
    wrap('replaceState');

    for (const name of ['hashchange', 'popstate', 'pagehide']) {
      window.addEventListener(name, () => {
        const now = location.href;
        add(`page.${name}`, {
          from: sanitizeUrl(lastHref),
          to: sanitizeUrl(now),
          visibility: document.visibilityState
        });
        lastHref = now;
      }, true);
    }

    window.addEventListener('pageshow', event => {
      if (!event.persisted) return;
      const now = location.href;
      add('page.pageshow', {
        from: sanitizeUrl(lastHref),
        to: sanitizeUrl(now),
        visibility: document.visibilityState,
        persisted: true
      });
      lastHref = now;
    }, true);

    document.addEventListener('visibilitychange', () => {
      clearTimeout(visibilityTimer);
      const visibility = document.visibilityState;
      visibilityTimer = setTimeout(() => {
        visibilityTimer = 0;
        if (document.visibilityState === visibility) add('page.visibility', { visibility });
      }, VISIBILITY_DEBOUNCE_MS);
    }, true);
  }

  function recordRejection(reason) {
    const text = scrubText(reason || 'unhandled rejection');
    const now = Date.now();
    if (lastRejection && lastRejection.reason === text && now - lastRejection.ts <= 1000 && lastRejection.event?.data) {
      lastRejection.ts = now;
      lastRejection.event.data.count = (Number(lastRejection.event.data.count) || 1) + 1;
      lastRejection.event.data.lastAt = new Date(now).toISOString();
      scheduleFlush();
      return;
    }
    add('promise.rejection', { reason: text, count: 1 });
    lastRejection = { reason: text, ts: now, event: pageEvents[pageEvents.length - 1] || null };
  }

  function installErrorTrace() {
    window.addEventListener('error', event => {
      add('error', {
        message: scrubText(event.message || event.error?.message || 'error'),
        filename: sanitizeUrl(event.filename || ''),
        line: event.lineno || 0,
        column: event.colno || 0
      });
    }, true);

    window.addEventListener('unhandledrejection', event => {
      recordRejection(event.reason?.message || event.reason || 'unhandled rejection');
    }, true);
  }

  function emptyMutationStats() {
    return {
      batches: 0, records: 0, added: 0, removed: 0, attributes: 0, text: 0, maxBatch: 0,
      attributeNames: Object.create(null), targets: Object.create(null)
    };
  }

  function bumpCount(bucket, key) {
    const name = scrubText(String(key || 'unknown').slice(0, 100));
    bucket[name] = (Number(bucket[name]) || 0) + 1;
  }

  function mutationTargetKey(target) {
    const element = target instanceof Element ? target : target?.parentElement;
    if (!element) return 'unknown';
    if (element.closest?.('#fcratc-root')) return '#fcratc-root';
    if (element.closest?.('[data-fcr-tool-ui="1"]')) return '[data-fcr-tool-ui]';
    const table = element.closest?.('table[id]');
    if (table?.id) return `table#${table.id}`;
    const identified = element.closest?.('[id]');
    if (identified?.id) return `${identified.tagName?.toLowerCase() || 'element'}#${identified.id}`;
    return element.tagName?.toLowerCase() || 'unknown';
  }

  function topCounts(bucket, limit = 6) {
    return Object.entries(bucket || {}).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name, count]) => ({ name, count }));
  }

  function installMutationHealth() {
    const start = () => {
      if (!document.documentElement || mutationObserver) return;

      mutationObserver = new MutationObserver(records => {
        if (document.visibilityState !== 'visible') return;

        const filtered = records.filter(record => !uiRoot?.contains(record.target));
        if (!filtered.length) return;

        mutationStats.batches++;
        mutationStats.records += filtered.length;
        mutationStats.maxBatch = Math.max(mutationStats.maxBatch, filtered.length);

        for (const record of filtered) {
          mutationStats.added += record.addedNodes?.length || 0;
          mutationStats.removed += record.removedNodes?.length || 0;
          bumpCount(mutationStats.targets, mutationTargetKey(record.target));
          if (record.type === 'attributes') {
            mutationStats.attributes++;
            bumpCount(mutationStats.attributeNames, record.attributeName || 'unknown');
          }
          if (record.type === 'characterData') mutationStats.text++;
        }
      });

      mutationObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
      });

      mutationTimer = setInterval(() => {
        const snapshot = mutationStats;
        mutationStats = emptyMutationStats();

        if (document.visibilityState !== 'visible') return;

        if (
          snapshot.records >= 500 ||
          snapshot.maxBatch >= 150 ||
          snapshot.added + snapshot.removed >= 300
        ) {
          const { attributeNames, targets, ...totals } = snapshot;
          add('health.mutations', {
            ...totals,
            topAttributes: topCounts(attributeNames),
            topTargets: topCounts(targets)
          });
        }
      }, MUTATION_REPORT_MS);
    };

    if (document.documentElement) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  }

  function installPerformanceHealth() {
    try {
      if (typeof PerformanceObserver !== 'undefined') {
        performanceObserver = new PerformanceObserver(list => {
          if (document.visibilityState !== 'visible') return;

          for (const entry of list.getEntries()) {
            if (entry.duration >= 250) {
              add('health.longtask', {
                durationMs: Math.round(entry.duration),
                startMs: Math.round(entry.startTime)
              });
            }
          }
        });

        performanceObserver.observe({ type: 'longtask', buffered: true });
      }
    } catch {}

    let expected = performance.now() + 1000;

    eventLoopTimer = setInterval(() => {
      const now = performance.now();
      const lag = now - expected;
      expected = now + 1000;

      if (document.visibilityState !== 'visible') return;
      if (lag < EVENT_LOOP_WARN_MS) return;

      const wallNow = Date.now();
      if (wallNow - lastEventLoopLogAt < EVENT_LOOP_MIN_GAP_MS) return;

      lastEventLoopLogAt = wallNow;
      add('health.eventloop', { lagMs: Math.round(lag) });
    }, 1000);
  }

  function trackedCoreType(type) {
    return !['ping', 'stats', 'usageStats', 'usageReset', 'rememberProduct', 'rememberBinSize'].includes(String(type || ''));
  }

  function parseEventDetail(detail) {
    let value = detail;
    try { if (typeof value === 'string') value = JSON.parse(value); } catch { return null; }
    return value && typeof value === 'object' ? value : null;
  }

  function coreResponseSummary(data) {
    if (!data || typeof data !== 'object') return {};
    const out = {};
    for (const key of ['source', 'endpoint', 'pages', 'records', 'totalQuantity', 'partialQuantity', 'complete', 'warning', 'status', 'ms']) {
      if (data[key] !== undefined && data[key] !== null && data[key] !== '') out[key] = data[key];
    }
    return out;
  }

  function normalizedCoreSource(data) {
    const source = String(data?.source || 'unknown').trim().toLowerCase();
    return SAFE_SOURCE_VALUE.test(source) ? source : 'other';
  }

  function recordCoreSuccess(pending, message, elapsedMs) {
    const response = coreResponseSummary(message.data);
    const source = normalizedCoreSource(message.data);
    const endpoint = scrubText(response.endpoint || '');
    const key = JSON.stringify([pending.type, pending.client, pending.group, source, endpoint]);
    const stat = coreSuccessStats.get(key) || {
      type: pending.type,
      client: pending.client,
      group: pending.group,
      source,
      endpoint,
      count: 0,
      totalElapsedMs: 0,
      maxElapsedMs: 0,
      coreVersion: scrubText(message.version || '')
    };

    stat.count++;
    stat.totalElapsedMs += elapsedMs;
    stat.maxElapsedMs = Math.max(stat.maxElapsedMs, elapsedMs);
    coreSuccessStats.set(key, stat);

    clearTimeout(coreSuccessTimer);
    coreSuccessTimer = setTimeout(flushCoreSuccessSummary, FCR_CORE_QUIET_MS);
  }

  function flushCoreSuccessSummary() {
    clearTimeout(coreSuccessTimer);
    coreSuccessTimer = 0;
    if (!coreSuccessStats.size) return;

    const sources = { cache: 0, network: 0, dedupe: 0, other: 0 };
    const otherSources = {};
    let successes = 0;
    const operations = [...coreSuccessStats.values()].map(stat => {
      successes += stat.count;
      if (Object.prototype.hasOwnProperty.call(sources, stat.source) && stat.source !== 'other') {
        sources[stat.source] += stat.count;
      } else {
        sources.other += stat.count;
        otherSources[stat.source] = (otherSources[stat.source] || 0) + stat.count;
      }

      const operation = {
        type: stat.type,
        client: stat.client,
        group: stat.group,
        source: stat.source,
        count: stat.count,
        averageElapsedMs: Math.round(stat.totalElapsedMs / stat.count),
        maxElapsedMs: Math.round(stat.maxElapsedMs),
        coreVersion: stat.coreVersion
      };
      if (stat.endpoint) operation.endpoint = stat.endpoint;
      return operation;
    }).sort((a, b) =>
      a.type.localeCompare(b.type) ||
      a.client.localeCompare(b.client) ||
      a.source.localeCompare(b.source) ||
      a.endpoint?.localeCompare(b.endpoint || '') || 0
    );

    coreSuccessStats = new Map();
    add('fcr.core.success.summary', {
      successes,
      sources,
      ...(sources.other ? { otherSources } : {}),
      operations
    });
  }

  function installFcrDataCoreTrace() {
    window.addEventListener('fcr-data-core:request', event => {
      const message = parseEventDetail(event.detail);
      if (!message?.id || !trackedCoreType(message.type)) return;
      corePending.set(String(message.id), {
        type: String(message.type || ''),
        client: scrubText(message.client || 'unknown'),
        group: scrubText(message.group || ''),
        started: performance.now()
      });
    }, true);

    window.addEventListener('fcr-data-core:response', event => {
      const message = parseEventDetail(event.detail);
      if (!message?.id) return;
      const pending = corePending.get(String(message.id));
      if (!pending) return;
      corePending.delete(String(message.id));
      const error = scrubText(message.error || '');
      const elapsedMs = Math.round(performance.now() - pending.started);
      const response = {
        type: pending.type,
        client: pending.client,
        group: pending.group,
        ok: !!message.ok,
        elapsedMs,
        coreVersion: scrubText(message.version || ''),
        error,
        ...coreResponseSummary(message.data)
      };

      if (error === 'fcr-data-core:cancelled') {
        add('fcr.core.cancelled', response);
      } else if (!message.ok || normalizedCoreSource(message.data) === 'error' || message.data?.complete === false) {
        add('fcr.core.failure', response);
      } else {
        recordCoreSuccess(pending, message, elapsedMs);
      }
    }, true);

    window.addEventListener('fcr-data-core:cancel', event => {
      const message = parseEventDetail(event.detail);
      if (!message) return;
      add('fcr.core.cancel', { client: scrubText(message.client || 'unknown'), group: scrubText(message.group || '') });
    }, true);
  }

  function installScriptBus() {
    const emit = (type, data = {}) => add(`script.${String(type || 'event').slice(0, 80)}`, data);

    try { W.BWU2Observe = emit; } catch {}
    try {
      if (typeof W.BWU2Trace !== 'function') W.BWU2Trace = emit;
    } catch {}

    window.addEventListener('message', event => {
      if (event.source !== window) return;

      const message = event.data;
      if (!message || typeof message !== 'object') return;

      if (message.__BWU2_OBS__ === true || message.__BWU2_TRACE__ === true) {
        emit(message.type || 'message', message.data || {});
      }
    }, true);

    window.addEventListener('bwu2-observability:event', event => {
      let detail = event.detail;
      try { if (typeof detail === 'string') detail = JSON.parse(detail); } catch {}
      if (detail && typeof detail === 'object') emit(detail.type || 'event', detail.data || detail);
    }, true);

    window.addEventListener('fcr-usage:event', event => {
      let detail = event.detail;
      try { if (typeof detail === 'string') detail = JSON.parse(detail); } catch {}
      if (!detail || typeof detail !== 'object') return;
      if (['master.open', 'stow.open'].includes(String(detail.key || ''))) return;
      add('fcr.usage', detail);
    }, true);
  }

  function viewportSnapshot() {
    return {
      width: Math.max(0, Math.round(window.innerWidth || 0)),
      height: Math.max(0, Math.round(window.innerHeight || 0)),
      dpr: Number((window.devicePixelRatio || 1).toFixed(2))
    };
  }

  function installViewportTrace() {
    lastViewport = JSON.stringify(viewportSnapshot());
    window.addEventListener('resize', () => {
      clearTimeout(viewportTimer);
      viewportTimer = setTimeout(() => {
        viewportTimer = 0;
        const snapshot = viewportSnapshot();
        const key = JSON.stringify(snapshot);
        if (key === lastViewport) return;
        lastViewport = key;
        add('page.viewport', snapshot);
      }, VIEWPORT_DEBOUNCE_MS);
    }, true);
  }

  function isFCResearch() {
    return FCR_HOST.test(location.hostname);
  }

  function injectUiStyles() {
    if (document.getElementById('bwu2-observability-style')) return;

    const style = document.createElement('style');
    style.id = 'bwu2-observability-style';
    style.textContent = `
      #bwu2-observability-inline{display:inline-flex;align-items:center;gap:5px;margin-left:9px;vertical-align:middle;font:700 11px/1.2 Arial,sans-serif;white-space:nowrap;color:#374151}
      #bwu2-observability-inline button{appearance:none;border:0;background:transparent;padding:1px 3px;margin:0;color:inherit;font:inherit;cursor:pointer;border-radius:3px}
      #bwu2-observability-inline button:hover{text-decoration:underline;background:rgba(0,0,0,.05)}
      #bwu2-observability-count{font-variant-numeric:tabular-nums}
      #bwu2-observability-inline.warn #bwu2-observability-count{animation:bwu2ObsFlash .32s steps(1,end) infinite;background:#ffea00;color:#7f1d1d;box-shadow:0 0 0 1px #dc2626}
      #bwu2-observability-inline.full #bwu2-observability-count{animation-duration:.16s;background:#ff2d2d;color:#fff;box-shadow:0 0 0 1px #7f1d1d}
      @keyframes bwu2ObsFlash{0%,49%{opacity:1}50%,100%{opacity:.12}}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function mountUi() {
    if (!isFCResearch()) return true;
    if (!document.documentElement) return false;

    injectUiStyles();

    if (document.getElementById('bwu2-observability-inline')) {
      uiRoot = document.getElementById('bwu2-observability-inline');
      uiCount = document.getElementById('bwu2-observability-count');
      uiClear = document.getElementById('bwu2-observability-clear');
      return true;
    }

    const logoResearch = document.querySelector('.logo-research');
    const warehouse = document.querySelector('.warehouse-id');
    const anchor = warehouse || logoResearch;

    if (!anchor?.parentElement) return false;

    const host = document.createElement('span');
    host.id = 'bwu2-observability-inline';
    host.dataset.fcrToolUi = '1';
    host.innerHTML =
      '<button type="button" id="bwu2-observability-count" title="Download current observability log and start a fresh session">OBS 0/3000</button>' +
      '<span aria-hidden="true">·</span>' +
      '<button type="button" id="bwu2-observability-clear" title="Delete current observability log and start fresh">Clear</button>';

    anchor.insertAdjacentElement('afterend', host);

    uiRoot = host;
    uiCount = host.querySelector('#bwu2-observability-count');
    uiClear = host.querySelector('#bwu2-observability-clear');

    uiCount.addEventListener('click', downloadAndReset);
    uiClear.addEventListener('click', () => resetSession('clear'));

    renderUi(true);
    return true;
  }

  function renderUi(force = false) {
    if (!isFCResearch()) return;
    if (!uiRoot?.isConnected && !mountUi()) return;

    const count = sessionCount(force);

    uiCount.textContent = `OBS ${Math.min(count, MAX_EVENTS)}/${MAX_EVENTS}`;
    uiRoot.classList.toggle('warn', count >= WARN_AT && count < MAX_EVENTS);
    uiRoot.classList.toggle('full', count >= MAX_EVENTS);

    uiCount.title =
      count >= MAX_EVENTS
        ? 'FULL — click to download and start fresh'
        : count >= WARN_AT
          ? '80%+ — click to download and start fresh'
          : 'Click to download current log and start fresh';
  }

  function bootUi() {
    if (!isFCResearch()) return;

    const start = () => {
      if (mountUi()) return;
      if (uiObserver) return;

      uiObserver = new MutationObserver(() => {
        if (mountUi()) {
          uiObserver.disconnect();
          uiObserver = null;
        }
      });

      uiObserver.observe(document.documentElement, { childList: true, subtree: true });
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }

    uiTimer = setInterval(() => renderUi(true), 1000);
  }

  add('page.start', {
    version: VERSION,
    host: location.hostname,
    path: sanitizePath(location.pathname),
    title: document.title || '',
    viewport: viewportSnapshot()
  });

  installFetchTrace();
  installXhrTrace();
  installScriptBus();
  installFcrDataCoreTrace();
  installRouteTrace();
  installErrorTrace();
  installActionTrace();
  installViewportTrace();
  installMutationHealth();
  installPerformanceHealth();
  bootUi();

  window.addEventListener('pagehide', () => {
    clearTimeout(visibilityTimer);
    clearTimeout(viewportTimer);
    clearTimeout(fcrNetworkTimer);
    clearTimeout(pollNetworkTimer);
    flushFcrNetworkSummary();
    flushPollNetworkSummary();
    flushCoreSuccessSummary();
    flushPage();
    if (mutationObserver) mutationObserver.disconnect();
    if (uiObserver) uiObserver.disconnect();
    if (performanceObserver) performanceObserver.disconnect();
    if (mutationTimer) clearInterval(mutationTimer);
    if (eventLoopTimer) clearInterval(eventLoopTimer);
    if (uiTimer) clearInterval(uiTimer);
  }, { once: true });
})();
