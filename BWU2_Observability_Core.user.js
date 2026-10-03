// ==UserScript==
// @name         V2 | CORE BWU2 Observability Core
// @namespace    https://github.com/1Sirkkris
// @version      0.1.37
// @description  High-signal cross-tool observability for errors, runtime versions, API/network evidence, workflow traces, and performance failures.
// @include      /^https?:\/\/aft-poirot-website-nrt\.nrt\.proxy\.amazon\.com\//
// @include      /^https?:\/\/aft-qt-[^\/]+(?:\.aka\.[^\/]+)?\.corp\.amazon\.com\//
// @include      /^https?:\/\/(?:[^\/]*fcresearch[^\/]*|qifcr\.fe\.aftx\.amazonoperations\.app)\//
// @include      /^https?:\/\/aft-moveapp-[^\/]+(?:\.nrt)?\.proxy\.amazon\.com\//
// @include      /^https?:\/\/t\.corp\.amazon\.com\//
// @include      /^https?:\/\/aftcartonpreditorapp-tcp-nrt\.nrt\.proxy\.amazon\.com\//
// @include      /^https?:\/\/fba-fnsku-commingling-console-(?:eu|na|jp)\.aka\.amazon\.com\//
// @include      /^https?:\/\/river\.amazon\.com\//
// @include      /^https?:\/\/console\.harmony\.a2z\.com\/poportal\/fe(?:[/?#]|$)/
// @include      /^https?:\/\/tx-b-hierarchy-nrt\.nrt\.proxy\.amazon\.com\/(?:bindHierarchy|unbindHierarchy)(?:[/?#]|$)/
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/BWU2_Observability_Core.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/BWU2_Observability_Core.user.js
// @require      https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/BWU2_Fleet_Core.lib.js
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = '0.1.37';
  const { registerRuntimeVersion } = globalThis.BWU2Fleet;
  registerRuntimeVersion('OBS', VERSION);

  const PREFIX = 'bwu2:observability:v1:';
  const META_KEY = `${PREFIX}meta`;
  const PAGE_PREFIX = `${PREFIX}page:`;
  const COUNT_PREFIX = `${PREFIX}count:`;
  const REVISION_KEY = `${PREFIX}revision`;
  const NORMAL_MAX_EVENTS = 6000;
  const FULL_FAT_MAX_EVENTS = 50000;
  const FULL_FAT_KEY = 'bwu2.obs.fullFat.v1';
  let fullFatMode = false;
  try { fullFatMode = GM_getValue(FULL_FAT_KEY, false) === true; } catch {}
  const MAX_EVENTS = fullFatMode ? FULL_FAT_MAX_EVENTS : NORMAL_MAX_EVENTS;
  const WARN_AT = Math.floor(MAX_EVENTS * 0.80);
  const FLUSH_MS = 300;
  const MAX_BODY_CHARS = 5000;
  const FCR_NETWORK_QUIET_MS = 1200;
  const FCR_CORE_QUIET_MS = 10000;
  const WORKER_PROGRESS_HEARTBEAT_MS = 60000;
  const FCLITE_USAGE_SUMMARY_MS = 30000;
  const SLOW_NETWORK_MS = 1500;
  const ROUTINE_NETWORK_REPORT_MS = 60000;
  const BLOCKED_SECTIONS_QUIET_MS = 1200;
  const RESEARCH_ACTION_WINDOW_MS = 2000;
  const RESEARCH_CHAIN_MAX = 120;
  const SAMPLE_PREFIX = `${PREFIX}sample:`;
  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  if (W.__BWU2_OBSERVABILITY_CORE_V1__) return;
  W.__BWU2_OBSERVABILITY_CORE_V1__ = true;

  const SENSITIVE_KEY = /authorization|cookie|credential|csrf|jwt|password|passwd|secret|session.?token|signature|token|x-amz|api.?key/i;
  const IDENTIFIER_KEY = /asin|barcode|container|correlation.?id|destination|fcsku|fnsku|item|lpn|object|pod|request.?id|scannable|sku|source|trace.?id/i;
  const SAFE_SOURCE_VALUE = /^(?:cache|network|dedupe|empty|error|remembered|uncached|unknown|other)$/i;
  const SAFE_QUERY_KEY = /^(?:action|mode|page|sort|state|tab|type|view)$/i;
  const DETAILED_PATH = /(?:\/api\/|edititems|fcskuflip|moveitems|move-container|close-container|scan-source-container|scanitem|sideline|dropzone|print)/i;
  const AFT_QT_HOST = /^aft-qt-[^.]+(?:\.aka\.[^.]+)?\.corp\.amazon\.com$/i;
  const AFT_MOVE_PROBE_MAX = 250;
  const NOISE_HOST = /(?:^|\.)(?:data\.pendo\.aft\.amazon\.dev|api\.pendo\.aft\.amazon\.dev)$/i;
  const NOISE_PATH = /(?:^|\/)logger(?:$|[/?#])/i;
  const FCR_HOST = /(?:fcresearch|qifcr\.fe\.aftx\.amazonoperations\.app)/i;
  const SIM_HOST = /^t\.corp\.amazon\.com$/i;
  const CARTON_HOST = /^aftcartonpreditorapp-tcp-nrt\.nrt\.proxy\.amazon\.com$/i;
  const RIVER_HOST = /^river\.amazon\.com$/i;
  const PO_PORTAL_HOST = /^console\.harmony\.a2z\.com$/i;
  const HIERARCHY_HOST = /^tx-b-hierarchy-nrt\.nrt\.proxy\.amazon\.com$/i;
  const PO_PORTAL_API_HOST = /(?:^|\.)execute-api\.(?:us-east-1|us-west-2)\.amazonaws\.com$/i;
  const PO_PORTAL_API_PATH = /^\/beta\/(?:getPoHeaders|getEmidFromPolReadService|getInboundRecordsForShipmentByFnsku|getShipmentItems)\/?$/i;

  const pageId = randomId('p_');
  let meta = loadMeta();
  let activeSessionId = meta.sessionId;
  let pageEvents = [];
  let pageStoreKey = pageKey(activeSessionId);
  let pageCountKey = countKey(activeSessionId);
  let flushTimer = 0;
  let eventSeq = 0;
  let lastGlobalCount = 0;
  let full = false;
  let uiObserver = null;
  let uiRoot = null;
  let uiCount = null;
  let uiClear = null;
  let countSyncTimer = 0;
  let countListenerId = null;
  let performanceObserver = null;
  let fcrNetworkTimer = 0;
  let fcrNetworkStats = new Map();
  let pollNetworkTimer = 0;
  let pollNetworkStats = new Map();
  let routineNetworkTimer = 0;
  let routineNetworkStats = new Map();
  let blockedSectionsTimer = 0;
  let blockedSections = new Set();
  const corePending = new Map();
  let coreSuccessTimer = 0;
  let coreSuccessStats = new Map();
  let workerProgressStates = new Map();
  let fcliteUsageTimer = 0;
  let fcliteUsageStats = new Map();
  let aftMoveProbeAction = 0;
  let aftMoveProbeStatus = '';
  let aftMoveProbeCount = 0;
  let lastRejection = null;
  let lastResearchAction = null;
  let researchChainCount = 0;
  let runtimeVersionObserver = null;
  let runtimeVersionTimer = 0;
  let lastRuntimeVersionSignature = '';
  const runtimeVersions = new Map([['OBS', { name:'OBS', version:VERSION, source:'self' }]]);

  function gmGet(key, fallback) { try { return GM_getValue(key, fallback); } catch { return fallback; } }
  function gmSet(key, value) { try { GM_setValue(key, value); return true; } catch { return false; } }
  function gmDelete(key) { try { GM_deleteValue(key); } catch {} }
  function gmKeys() { try { return GM_listValues() || []; } catch { return []; } }
  function gmListen(key, callback) {
    try { return typeof GM_addValueChangeListener === 'function' ? GM_addValueChangeListener(key, callback) : null; }
    catch { return null; }
  }
  function gmUnlisten(id) {
    try { if (id != null && typeof GM_removeValueChangeListener === 'function') GM_removeValueChangeListener(id); }
    catch {}
  }

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
    lastGlobalCount = 0;
    full = false;
    fcrNetworkStats = new Map();
    clearTimeout(fcrNetworkTimer);
    fcrNetworkTimer = 0;
    pollNetworkStats = new Map();
    clearTimeout(pollNetworkTimer);
    pollNetworkTimer = 0;
    routineNetworkStats = new Map();
    clearTimeout(routineNetworkTimer);
    routineNetworkTimer = 0;
    clearTimeout(blockedSectionsTimer);
    blockedSectionsTimer = 0;
    blockedSections = new Set();
    corePending.clear();
    clearTimeout(coreSuccessTimer);
    coreSuccessTimer = 0;
    coreSuccessStats = new Map();
    workerProgressStates = new Map();
    clearTimeout(fcliteUsageTimer);
    fcliteUsageTimer = 0;
    fcliteUsageStats = new Map();
    aftMoveProbeAction = 0;
    aftMoveProbeStatus = '';
    aftMoveProbeCount = 0;
    lastRuntimeVersionSignature = '';
    gmSet(pageCountKey, 0);
    return true;
  }

  function sessionCount(force = false) {
    syncSession();
    if (!force) return lastGlobalCount;

    let total = 0;
    const prefix = `${COUNT_PREFIX}${activeSessionId}:`;
    for (const key of gmKeys()) {
      if (key.startsWith(prefix)) total += Math.max(0, Number(gmGet(key, 0)) || 0);
    }

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

  function workflowTool() {
    const host = String(location.hostname || '').toLowerCase();
    const path = String(location.pathname || '').toLowerCase();
    const hashValue = String(location.hash || '').toLowerCase();

    if (hashValue.startsWith('#fcr-tote-checker')) return 'tote-audit';
    if (hashValue.startsWith('#iss-console')) return 'iss-console';
    if (/aft-poirot-website/.test(host)) return 'sideline';
    if (/aft-moveapp/.test(host)) return 'move-app';
    if (/aft-qt-/.test(host) && /moveitems/.test(path)) return 'aft-moveitems';
    if (/aft-qt-/.test(host) && /edititems/.test(path)) return 'aft-edititems';
    if (HIERARCHY_HOST.test(host) && /bindhierarchy/i.test(path)) return 'bind-hierarchy';
    if (/unbind/i.test(host + path)) return 'unbind';
    if (/dropzone/i.test(host + path)) return 'dropzone';
    if (FCR_HOST.test(host)) return 'fcresearch';
    if (PO_PORTAL_HOST.test(host)) return 'po-portal';
    if (RIVER_HOST.test(host)) return 'river';
    return scrubText(host || 'unknown');
  }

  function workflowIdentity(element, info = {}) {
    if (!fullFatMode || !(element instanceof Element)) return null;
    const input = element.matches?.('input,textarea,select') ? element : element.closest?.('input,textarea,select');
    if (!input) return null;

    const type = String(input.getAttribute('type') || '').toLowerCase();
    const descriptor = [
      info.id, info.name, info.label,
      input.getAttribute('placeholder'),
      input.getAttribute('aria-label')
    ].filter(Boolean).join(' ').toLowerCase();

    if (type === 'password' || SENSITIVE_KEY.test(descriptor)) return null;

    const raw = String(input.value ?? '').trim();
    if (!raw) return null;

    if (/^(?:ts|cs)x[a-z0-9_-]+$/i.test(raw)) return { kind:'container', id:fingerprint(raw.toUpperCase(), 'container') };
    if (/^(?:B0|X0|ZZ)[A-Z0-9]{8}$/i.test(raw)) return { kind:'item', id:fingerprint(raw.toUpperCase(), 'item') };
    if (/^LPN[A-Z0-9_-]+$/i.test(raw)) return { kind:'lpn', id:fingerprint(raw.toUpperCase(), 'lpn') };

    if (/(?:asin|barcode|container|destination|fcsku|fnsku|item|lpn|scannable|sku|source|tote)/i.test(descriptor)) {
      return { kind:'field-value', id:fingerprint(raw.toUpperCase(), 'workflow') };
    }
    return null;
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
      if (/^[A-Z]\d{8,14}$/i.test(segment)) return fingerprint(segment, 'ticket');
      return scrubText(segment);
    }).join('/');
  }

  function sanitizeTitle(value) {
    const text = String(value ?? '');
    const fcrTitle = text.match(/^\s*(.*?)\s*\|\s*FCResearch\s*$/i);
    if (!fcrTitle) return scrubText(text);

    const subject = fcrTitle[1].trim();
    if (!subject) return '| FCResearch';

    const scrubbed = scrubText(subject);
    const safeSubject = scrubbed === subject ? fingerprint(subject, 'search') : scrubbed;
    return `${safeSubject} | FCResearch`;
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

  function rememberResearchAction(kind, info = {}, element = null) {
    lastResearchAction = {
      at: performance.now(),
      kind: scrubText(kind || 'ui'),
      tag: scrubText(info.tag || ''),
      role: scrubText(info.role || ''),
      type: scrubText(info.type || ''),
      label: scrubText(info.label || '').slice(0, 80)
    };
    if (fullFatMode) {
      const { at, ...safe } = lastResearchAction;
      add('workflow.action', {
        ...safe,
        tool: workflowTool(),
        identity: workflowIdentity(element, info)
      });
    }
  }

  function recentResearchAction() {
    if (!lastResearchAction) return null;
    const ageMs = Math.round(performance.now() - lastResearchAction.at);
    if (ageMs < 0 || ageMs > RESEARCH_ACTION_WINDOW_MS) return null;
    const { at, ...safe } = lastResearchAction;
    return { ...safe, ageMs };
  }

  function recordResearchChain(base, rawUrl, cause) {
    if (!cause || researchChainCount >= RESEARCH_CHAIN_MAX || isPollNetwork(rawUrl)) return;
    const url = parsedUrl(rawUrl);
    if (!url) return;
    if (/\.(?:css|gif|ico|jpe?g|js|map|png|svg|webp|woff2?)(?:$|[?#])/i.test(url.pathname)) return;
    researchChainCount++;
    add('research.request-chain', {
      cause,
      request: {
        transport: base.transport,
        method: base.method,
        host: scrubText(url.hostname),
        path: sanitizePath(url.pathname),
        status: base.status,
        ok: base.ok,
        ms: base.ms
      }
    });
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
    if (!url) return false;
    return /\/status$/i.test(url.pathname) ||
      (/^sim-ticketing-graphql-fleet\.corp\.amazon\.com$/i.test(url.hostname) && /^\/graphql\/?$/i.test(url.pathname)) ||
      (/^dataplane\.rum\.[^.]+\.amazonaws\.com$/i.test(url.hostname) && /^\/appmonitors\//i.test(url.pathname));
  }

  function isFcrNetwork(rawUrl) {
    const url = parsedUrl(rawUrl);
    return !!url && FCR_HOST.test(url.hostname) && /\/results\//i.test(url.pathname);
  }

  function isDetailedApi(rawUrl) {
    const url = parsedUrl(rawUrl);
    if (SIM_HOST.test(location.hostname)) return false;
    if (url && FCR_HOST.test(url.hostname)) return false;
    const isStatic = !!url && /\.(?:css|gif|ico|jpe?g|js|map|png|svg|webp|woff2?)(?:$|[?#])/i.test(url.pathname);
    if (RIVER_HOST.test(location.hostname) && url && !isStatic) return true;
    if (CARTON_HOST.test(location.hostname) && url?.origin === location.origin && !isStatic) return true;
    if (url) return DETAILED_PATH.test(url.pathname);
    return DETAILED_PATH.test(String(rawUrl || ''));
  }

  function isHierarchyNetwork(rawUrl) {
    if (!HIERARCHY_HOST.test(location.hostname)) return false;
    const url = parsedUrl(rawUrl);
    if (!url || url.origin !== location.origin) return false;
    return !/\.(?:css|gif|ico|jpe?g|js|map|png|svg|webp|woff2?)(?:$|[?#])/i.test(url.pathname);
  }

  function hierarchyBodySummary(body) {
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

    if (value == null) return { kind:'empty' };
    if (typeof value === 'object') return { kind:Array.isArray(value) ? 'array' : 'object', body:sanitize(value) };
    return { kind:typeof value, chars:String(value).length };
  }

  function hierarchyResponseSummary(text, contentType = '') {
    const raw = String(text ?? '');
    const base = { chars:raw.length };
    if (/json/i.test(contentType) || /^\s*[\[{]/.test(raw)) {
      try {
        const parsed = JSON.parse(raw);
        return {
          ...base,
          kind:Array.isArray(parsed) ? 'json-array' : 'json-object',
          body:sanitize(parsed)
        };
      } catch {}
    }
    return { ...base, ...summarizeFcrResponse(raw, contentType) };
  }

  function recordHierarchyNetwork(base, rawUrl, body, responseText = '', contentType = '') {
    const url = parsedUrl(rawUrl);
    add('hierarchy.network', {
      ...base,
      path:sanitizePath(url?.pathname || ''),
      request:hierarchyBodySummary(body),
      response:hierarchyResponseSummary(responseText, contentType)
    });
  }

  function isPoPortalPage() {
    return PO_PORTAL_HOST.test(location.hostname) && /^\/poportal\/fe\/?$/i.test(location.pathname);
  }

  function isPoPortalNetwork(rawUrl) {
    if (!isPoPortalPage()) return false;
    const url = parsedUrl(rawUrl);
    if (!url) return false;
    if (url.origin === location.origin) {
      return !/\.(?:css|gif|ico|jpe?g|js|map|png|svg|webp|woff2?)(?:$|[?#])/i.test(url.pathname);
    }
    return PO_PORTAL_API_HOST.test(url.hostname) && PO_PORTAL_API_PATH.test(url.pathname);
  }

  function poPortalQuerySummary(rawUrl) {
    const url = parsedUrl(rawUrl);
    if (!url) return {};
    const out = {};
    for (const key of ['asin', 'startDate', 'endDate', 'countries', 'distributorChecks', 'removeZeroFilter']) {
      if (!url.searchParams.has(key)) continue;
      const value = url.searchParams.get(key) || '';
      out[key] = key === 'asin' ? fingerprint(value, 'asin') : scrubText(value).slice(0, 500);
    }
    return out;
  }

  function poPortalRequestSummary(body) {
    const out = summarizeRequestShape(body);
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

    if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
    const filters = {};
    for (const [key, raw] of Object.entries(value)) {
      if (!/^(?:asin|fnsku|startDate|endDate|countries|country|distributorChecks|removeZeroFilter|vendorIds?|iogs?)$/i.test(key)) continue;
      const text = Array.isArray(raw) ? raw.join(',') : String(raw ?? '');
      filters[key] = /^(?:asin|fnsku)$/i.test(key) ? fingerprint(text, key.toLowerCase()) : scrubText(text).slice(0, 500);
    }
    if (Object.keys(filters).length) out.filters = filters;
    return out;
  }

  function poPortalJsonShape(value, depth = 0) {
    if (value == null) return { kind: value === null ? 'null' : typeof value };
    if (Array.isArray(value)) {
      return {
        kind: 'array',
        length: value.length,
        ...(value.length && depth < 2 ? { item: poPortalJsonShape(value[0], depth + 1) } : {})
      };
    }
    if (typeof value !== 'object') return { kind: typeof value };
    const keys = Object.keys(value).slice(0, 60);
    const children = {};
    if (depth < 2) {
      for (const key of keys.slice(0, 20)) {
        const child = value[key];
        if (child && typeof child === 'object') children[key] = poPortalJsonShape(child, depth + 1);
      }
    }
    return { kind: 'object', keys, ...(Object.keys(children).length ? { children } : {}) };
  }

  function poPortalResponseSummary(text, contentType = '') {
    const raw = String(text ?? '');
    const base = { chars: raw.length };
    if (/json/i.test(contentType) || /^\s*[\[{]/.test(raw)) {
      try { return { ...base, ...poPortalJsonShape(JSON.parse(raw)) }; } catch {}
    }
    return summarizeFcrResponse(raw, contentType);
  }

  function recordPoPortalNetwork(base, rawUrl, body, responseText = '', contentType = '') {
    const url = parsedUrl(rawUrl);
    add('poportal.network', {
      ...base,
      path: sanitizePath(url?.pathname || ''),
      query: poPortalQuerySummary(rawUrl),
      request: poPortalRequestSummary(body),
      response: poPortalResponseSummary(responseText, contentType)
    });
  }

  function isAftMoveProbe(rawUrl) {
    if (!AFT_QT_HOST.test(location.hostname) || !/^\/app\/(?:moveitems|edititems)\/?$/i.test(location.pathname)) return false;
    const url = parsedUrl(rawUrl);
    return !!url && url.origin === location.origin &&
      (/^\/(?:action|status|end)\/?$/i.test(url.pathname) || /^\/app\/(?:moveitems|edititems)\/?$/i.test(url.pathname));
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
    if (/^\d{1,7}$/.test(text)) return 'numeric';
    if (/^\d{8,14}$/.test(text)) return 'numeric-id';
    return 'text';
  }

  function boundedRiverValue(value, key = '', depth = 0, seen = new WeakSet()) {
    if (SENSITIVE_KEY.test(key)) return '<redacted>';
    if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value === 'bigint') return String(value);
    if (typeof value === 'string') {
      const safe = sanitize(value, key);
      return typeof safe === 'string' ? clip(safe, 240) : safe;
    }
    if (depth >= 4) return `<max-depth:${Object.prototype.toString.call(value).slice(8, -1)}>`;
    if (typeof value !== 'object') return `<${typeof value}>`;
    if (seen.has(value)) return '<circular>';
    seen.add(value);

    if (Array.isArray(value)) {
      const out = value.slice(0, 20).map(item => boundedRiverValue(item, key, depth + 1, seen));
      if (value.length > 20) out.push(`<truncated-items:${value.length - 20}>`);
      return out;
    }

    const output = {};
    let count = 0;
    for (const [childKey, childValue] of Object.entries(value)) {
      if (++count > 60) {
        output.__truncated = true;
        break;
      }
      output[childKey] = boundedRiverValue(childValue, childKey, depth + 1, seen);
    }
    return output;
  }

  function riverStateHints(value) {
    const out = {};
    let count = 0;
    const seen = new WeakSet();

    const visit = (node, path = '', depth = 0) => {
      if (count >= 50 || depth > 6 || node == null) return;
      if (typeof node !== 'object') return;
      if (seen.has(node)) return;
      seen.add(node);

      const entries = Array.isArray(node) ? node.entries() : Object.entries(node);
      for (const [rawKey, child] of entries) {
        if (count >= 50) break;
        const key = Array.isArray(node) ? String(rawKey) : String(rawKey || '');
        const nextPath = path ? `${path}.${key}` : key;
        const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
        if (/^(?:workflow|step|question|option|answer|node|state|screen|page|prompt|transition)(?:id|key|name|type|value|code)?$/.test(normalizedKey)
          && (child == null || ['string', 'number', 'boolean'].includes(typeof child))) {
          out[nextPath] = boundedRiverValue(child, key);
          count++;
        }
        if (child && typeof child === 'object') visit(child, nextPath, depth + 1);
      }
    };

    visit(value);
    return out;
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

    if (RIVER_HOST.test(location.hostname)) {
      out.fields = {};
      for (const [key, raw] of Object.entries(value).slice(0, 30)) {
        if (SENSITIVE_KEY.test(key)) {
          out.fields[key] = { kind: 'redacted' };
          continue;
        }
        const text = String(raw ?? '');
        const field = { kind: classifySearchValue(text), length: text.length };
        if (/^(?:quantity|count|units|shipments|page)$/i.test(key) && /^\d+$/.test(text)) field.value = Number(text);
        out.fields[key] = field;
      }
      out.body = boundedRiverValue(value);
      const hints = riverStateHints(value);
      if (Object.keys(hints).length) out.stateHints = hints;
    }

    return out;
  }

  function summarizeRiverHtml(raw) {
    try {
      const doc = new DOMParser().parseFromString(raw, 'text/html');
      const headings = [...doc.querySelectorAll('h1,h2,h3,h4,[role="heading"],legend')]
        .map(node => scrubText(cleanText(node.textContent)))
        .filter(Boolean)
        .slice(0, 16);
      const forms = [...doc.forms].slice(0, 8).map(form => ({
        id: scrubText(form.id || ''),
        name: scrubText(form.getAttribute('name') || ''),
        method: scrubText(form.getAttribute('method') || 'GET'),
        action: form.getAttribute('action') ? sanitizeUrl(form.getAttribute('action')) : '',
        controls: form.querySelectorAll('input,textarea,select,button').length
      }));
      const stateAttrs = [];
      for (const element of [...doc.querySelectorAll('[data-step],[data-step-id],[data-question],[data-question-id],[data-workflow],[data-workflow-id],[data-option],[data-option-id],[data-state],[data-screen]')].slice(0, 30)) {
        const attrs = {};
        for (const attr of element.attributes || []) {
          if (/^(?:data-)?(?:workflow|step|question|option|state|screen)(?:-|$)/i.test(attr.name)) attrs[attr.name] = boundedRiverValue(attr.value, attr.name);
        }
        if (Object.keys(attrs).length) stateAttrs.push({ tag: element.tagName?.toLowerCase() || '', id: scrubText(element.id || ''), attrs });
      }
      const hiddenState = [...doc.querySelectorAll('input[type="hidden"]')].slice(0, 40).map(input => ({
        name: scrubText(input.name || ''),
        value: /(?:workflow|step|question|option|state|screen)/i.test(input.name || '') ? boundedRiverValue(input.value, input.name) : `<hidden:${String(input.value || '').length}>`
      }));
      return {
        headings,
        forms,
        stateAttrs,
        hiddenState,
        controls: doc.querySelectorAll('input,textarea,select,button,[role="radio"],[role="option"]').length
      };
    } catch {
      return {};
    }
  }

  function cleanText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function summarizeRiverResponse(text, contentType = '') {
    const raw = String(text ?? '');
    const base = { chars: raw.length };
    if (/json/i.test(contentType) || /^\s*[\[{]/.test(raw)) {
      try {
        const parsed = JSON.parse(raw);
        const hints = riverStateHints(parsed);
        return {
          ...base,
          kind: Array.isArray(parsed) ? 'json-array' : 'json-object',
          ...(Array.isArray(parsed) ? { length: parsed.length } : { keys: Object.keys(parsed || {}).slice(0, 40) }),
          body: boundedRiverValue(parsed),
          ...(Object.keys(hints).length ? { stateHints: hints } : {})
        };
      } catch {}
    }

    if (/html/i.test(contentType) || /<\/?(?:html|body|form|main|div|section)\b/i.test(raw)) {
      return { ...base, kind: 'html', ...summarizeRiverHtml(raw) };
    }

    return { ...base, kind: 'text', text: scrubText(raw.slice(0, 1800)) };
  }

  function aftMoveProbeSummary(text, contentType = '') {
    const raw = String(text ?? '');
    const out = {
      chars: raw.length,
      kind: raw ? (/json/i.test(contentType) || /^\s*[\[{]/.test(raw) ? 'json' : /<\/?(?:html|body|form|main|div|section)\b/i.test(raw) ? 'html' : 'text') : 'empty'
    };

    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        out.keys = Object.keys(parsed).slice(0, 40);
        if (typeof parsed.status === 'string') out.status = cleanText(parsed.status).slice(0, 40);
      }
    } catch {}

    const found = new Set();
    const patterns = [
      /(?:["']|&quot;)[A-Za-z0-9_.-]*(?:quantity|qty|count|units|available|remaining|max|min)[A-Za-z0-9_.-]*(?:["']|&quot;)\s*[:=]\s*(?:["']|&quot;)?([0-9]{1,7})\b/gi,
      /\bQuantity\b(?:<[^>]+>|\s|&nbsp;|&#160;|:|-){0,20}([0-9]{1,7})\b/gi
    ];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(raw)) && found.size < 20) found.add(Number(match[1]));
    }
    if (found.size) out.quantityNumbers = [...found];

    if (out.kind === 'html' && raw) {
      const lower = raw.toLowerCase();
      out.markerPositions = {
        objectId: lower.indexOf('objectid'),
        quantity: lower.indexOf('quantity'),
        form: lower.indexOf('<form'),
        input: lower.indexOf('<input'),
        verifyItem: lower.indexOf('verify item'),
        sourceContainer: lower.indexOf('source container'),
        destinationContainer: lower.indexOf('destination container'),
        selectSourceState: lower.indexOf('select source inventory state'),
        selectNewState: lower.indexOf('select new inventory state'),
        confirmChange: lower.indexOf('confirm change')
      };
    }

    return out;
  }

  function summarizeAftMoveRequest(body) {
    const out = summarizeRequestShape(body);
    try {
      const parsed = typeof body === 'string' ? JSON.parse(body) : body;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        if (typeof parsed.action === 'string') out.action = cleanText(parsed.action).slice(0, 40);
        if (typeof parsed.id?.instructionId === 'string') out.instructionId = cleanText(parsed.id.instructionId).slice(0, 40);
        if (Object.prototype.hasOwnProperty.call(parsed, 'input')) {
          const input = String(parsed.input ?? '');
          out.inputKind = classifySearchValue(input);
          out.inputLength = input.length;
          if (/^\d{1,7}$/.test(input.trim())) out.inputNumber = Number(input.trim());
        }
      }
    } catch {}
    return out;
  }

  function recordAftMoveProbe(base, rawUrl, body, responseText = '', contentType = '') {
    if (aftMoveProbeCount >= AFT_MOVE_PROBE_MAX) return;
    const path = parsedUrl(rawUrl)?.pathname || '';
    const response = aftMoveProbeSummary(responseText, contentType);

    if (/^\/action\/?$/i.test(path)) {
      aftMoveProbeAction++;
      aftMoveProbeStatus = '';
    }

    if (/^\/status\/?$/i.test(path)) {
      const signature = `${aftMoveProbeAction}|${response.status || ''}|${JSON.stringify(response.quantityNumbers || [])}`;
      if (signature === aftMoveProbeStatus) return;
      aftMoveProbeStatus = signature;

      const status = Number(base?.status) || 0;
      if (status >= 200 && status < 300) return;
    }

    aftMoveProbeCount++;
    add('aft.move.probe', {
      ...base,
      path,
      actionSeq: aftMoveProbeAction,
      request: summarizeAftMoveRequest(body),
      response
    });
  }

  function summarizeFcrResponse(text, contentType = '') {
    const raw = String(text ?? '');
    const base = { chars: raw.length };

    if (RIVER_HOST.test(location.hostname)) return summarizeRiverResponse(raw, contentType);

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
    const cancelled = Number(base.status) === 0;
    const stat = fcrNetworkStats.get(key) || { method: base.method, path, count: 0, failures: 0, cancelled: 0, totalMs: 0, maxMs: 0 };
    stat.count++;
    if (cancelled) stat.cancelled = (stat.cancelled || 0) + 1;
    else {
      if (!base.ok) stat.failures++;
      stat.totalMs += Number(base.ms || 0);
      stat.maxMs = Math.max(stat.maxMs, Number(base.ms || 0));
    }
    fcrNetworkStats.set(key, stat);

    clearTimeout(fcrNetworkTimer);
    fcrNetworkTimer = setTimeout(flushFcrNetworkSummary, FCR_NETWORK_QUIET_MS);

    if (cancelled) {
      add('network.cancelled', { ...base, path, reason: 'status-0' });
    } else if (Number(base.ms || 0) >= SLOW_NETWORK_MS) {
      add('network.slow', { ...base, path });
    }

    if (!cancelled && !base.ok) {
      add('network.http-error', { ...base, path });
    }

    if (!cancelled && claimFcrShapeSample(base.method, rawUrl)) {
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
    const endpoints = [...fcrNetworkStats.values()].map(stat => {
      const cancelled = stat.cancelled || 0;
      const completed = Math.max(0, stat.count - cancelled);
      return {
        method: stat.method,
        path: stat.path,
        count: stat.count,
        failures: stat.failures,
        ...(cancelled ? { cancelled } : {}),
        averageMs: completed ? Math.round(stat.totalMs / completed) : 0,
        maxMs: Math.round(stat.maxMs)
      };
    }).sort((a, b) => a.path.localeCompare(b.path));
    fcrNetworkStats = new Map();
    add('fcr.network.summary', { endpoints });
  }

  function recordPollNetwork(base, rawUrl) {
    const url = parsedUrl(rawUrl);
    if (fullFatMode) {
      add('network.poll', {
        ...base,
        host: scrubText(url?.hostname || ''),
        path: sanitizePath(url?.pathname || '')
      });
    }
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
    if (!pollNetworkTimer) pollNetworkTimer = setTimeout(flushPollNetworkSummary, ROUTINE_NETWORK_REPORT_MS);
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

  function recordRoutineNetwork(base, rawUrl) {
    const url = parsedUrl(rawUrl);
    if (fullFatMode) {
      add('network.routine', {
        ...base,
        host: scrubText(url?.hostname || ''),
        path: sanitizePath(url?.pathname || '')
      });
    }
    const key = `${base.method} ${url?.hostname || ''}${url?.pathname || ''}`;
    const stat = routineNetworkStats.get(key) || {
      method: base.method, host: url?.hostname || '', path: sanitizePath(url?.pathname || ''),
      count: 0, failures: 0, totalMs: 0, maxMs: 0
    };
    stat.count++;
    if (!base.ok) stat.failures++;
    stat.totalMs += Number(base.ms || 0);
    stat.maxMs = Math.max(stat.maxMs, Number(base.ms || 0));
    routineNetworkStats.set(key, stat);
    if (!routineNetworkTimer) routineNetworkTimer = setTimeout(flushRoutineNetworkSummary, ROUTINE_NETWORK_REPORT_MS);

    if (!base.ok) add('network.http-error', base);
  }

  function flushRoutineNetworkSummary() {
    clearTimeout(routineNetworkTimer);
    routineNetworkTimer = 0;
    if (!routineNetworkStats.size) return;
    const endpoints = [...routineNetworkStats.values()].map(stat => ({
      method: stat.method, host: stat.host, path: stat.path, count: stat.count,
      failures: stat.failures, averageMs: stat.count ? Math.round(stat.totalMs / stat.count) : 0,
      maxMs: Math.round(stat.maxMs)
    }));
    routineNetworkStats = new Map();
    add('network.routine.summary', { endpoints });
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
      gmSet(REVISION_KEY, `${activeSessionId}:${pageId}:${eventSeq}:${Date.now()}`);
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

  function recordWorkerProgress(data = {}) {
    const safe = sanitize(data);
    const key = [safe?.worker || '', safe?.area || ''].join('|');
    const signature = JSON.stringify(safe || {});
    const now = Date.now();
    const previous = workerProgressStates.get(key);

    if (previous?.signature === signature) {
      previous.suppressed++;
      previous.lastSeen = now;
      if (now - previous.lastLogged < WORKER_PROGRESS_HEARTBEAT_MS) return false;

      const heartbeat = {
        ...safe,
        heartbeat:true,
        suppressedRepeats:previous.suppressed,
        stableMs:Math.max(0, now - previous.stateSince)
      };
      previous.suppressed = 0;
      previous.lastLogged = now;
      return add('script.ISS_CONSOLE_WORKER_PROGRESS', heartbeat);
    }

    const payload = { ...safe };
    if (previous?.suppressed) {
      payload.previousSuppressedRepeats = previous.suppressed;
      payload.previousStableMs = Math.max(0, now - previous.stateSince);
    }

    workerProgressStates.set(key, {
      signature,
      stateSince:now,
      lastSeen:now,
      lastLogged:now,
      suppressed:0
    });
    return add('script.ISS_CONSOLE_WORKER_PROGRESS', payload);
  }

  function recordFcrUsage(detail = {}) {
    const key = String(detail?.key || '');
    if (!/^fclite\.item\.(?:scan|in|out)$/i.test(key)) return add('fcr.usage', detail);

    const safeKey = scrubText(key).slice(0, 100);
    const stat = fcliteUsageStats.get(safeKey) || {
      key:safeKey,
      count:0,
      totalMs:0,
      maxMs:0,
      firstAt:Date.now(),
      lastAt:0
    };
    const count = Math.max(1, Number(detail?.count) || 1);
    const ms = Math.max(0, Number(detail?.ms) || 0);
    stat.count += count;
    stat.totalMs += ms;
    stat.maxMs = Math.max(stat.maxMs, ms);
    stat.lastAt = Date.now();
    fcliteUsageStats.set(safeKey, stat);

    if (!fcliteUsageTimer) {
      fcliteUsageTimer = setTimeout(flushFcliteUsageSummary, FCLITE_USAGE_SUMMARY_MS);
    }
    return true;
  }

  function flushFcliteUsageSummary() {
    clearTimeout(fcliteUsageTimer);
    fcliteUsageTimer = 0;
    if (!fcliteUsageStats.size) return;

    const now = Date.now();
    const operations = [...fcliteUsageStats.values()]
      .map(stat => ({
        key:stat.key,
        count:stat.count,
        averageMs:stat.count ? Math.round(stat.totalMs / stat.count) : 0,
        maxMs:Math.round(stat.maxMs),
        spanMs:Math.max(0, (stat.lastAt || now) - stat.firstAt)
      }))
      .sort((a,b) => a.key.localeCompare(b.key));

    fcliteUsageStats = new Map();
    add('fcr.usage.summary', {
      windowMs:FCLITE_USAGE_SUMMARY_MS,
      operations
    });
  }

  function rememberRuntimeVersion(name, version, source = 'event') {
    const safeName = scrubText(name || '').trim().slice(0, 60);
    const safeVersion = scrubText(version || '').trim().slice(0, 60);
    if (!safeName || !safeVersion) return false;

    const key = safeName.toUpperCase();
    const previous = runtimeVersions.get(key);
    if (previous?.version === safeVersion) return false;

    runtimeVersions.set(key, { name:safeName, version:safeVersion, source:scrubText(source || 'event').slice(0, 30) });
    return true;
  }

  function collectRuntimeVersions() {
    try {
      const host = document.getElementById('bwu2-runtime-version-stamp');
      for (const node of host?.children || []) {
        const name = String(node.dataset?.bwu2RuntimeKey || '').trim();
        const text = String(node.textContent || '');
        const match = text.match(/(?:^|\s)v([0-9][A-Za-z0-9._+-]*)\b/i);
        if (name && match?.[1]) rememberRuntimeVersion(name, match[1], 'stamp');
      }
    } catch {}

    try {
      const footer = String(document.querySelector('.iss-footer')?.textContent || '');
      const match = footer.match(/ISS\s+Console\s+v([0-9]+(?:\.[0-9]+){1,3}(?:[-+][A-Za-z0-9._-]+)?)/i);
      if (match?.[1]) rememberRuntimeVersion('ISS Console', match[1], 'ui');
    } catch {}

    return [...runtimeVersions.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(item => ({ name:item.name, version:item.version, source:item.source }));
  }

  function flushRuntimeVersions(reason = 'change') {
    runtimeVersionTimer = 0;
    const scripts = collectRuntimeVersions();
    const signature = scripts.map(item => item.name + '@' + item.version).join('|');
    if (signature === lastRuntimeVersionSignature) return;
    lastRuntimeVersionSignature = signature;
    add('runtime.scripts', { reason, scripts });
  }

  function scheduleRuntimeVersions(reason = 'change') {
    clearTimeout(runtimeVersionTimer);
    runtimeVersionTimer = setTimeout(() => flushRuntimeVersions(reason), 40);
  }

  function runtimeVersionMutationRelevant(record) {
    const target = record.target?.nodeType === 1 ? record.target : record.target?.parentElement;
    if (target?.closest?.('#bwu2-runtime-version-stamp,.iss-footer')) return true;

    for (const node of record.addedNodes || []) {
      if (node?.nodeType !== 1) continue;
      if (node.matches?.('#bwu2-runtime-version-stamp,.iss-footer')) return true;
      if (node.querySelector?.('#bwu2-runtime-version-stamp,.iss-footer')) return true;
    }
    return false;
  }

  function bootRuntimeVersionTrace() {
    const start = () => {
      if (!document.documentElement) {
        setTimeout(start, 25);
        return;
      }

      flushRuntimeVersions('boot');
      if (runtimeVersionObserver) return;

      runtimeVersionObserver = new MutationObserver(records => {
        if (records.some(runtimeVersionMutationRelevant)) scheduleRuntimeVersions('dom-change');
      });
      runtimeVersionObserver.observe(document.documentElement, {
        childList:true,
        subtree:true,
        characterData:true
      });

      setTimeout(() => flushRuntimeVersions('settled-1000ms'), 1000);
    };

    start();
  }

  function collectSession(sessionId = activeSessionId) {
    flushCoreSuccessSummary();
    flushFcliteUsageSummary();
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
      `Mode: ${fullFatMode ? 'FULL FAT' : 'NORMAL'}`,
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
    full = false;
    fcrNetworkStats = new Map();
    clearTimeout(fcrNetworkTimer);
    fcrNetworkTimer = 0;
    pollNetworkStats = new Map();
    clearTimeout(pollNetworkTimer);
    pollNetworkTimer = 0;
    routineNetworkStats = new Map();
    clearTimeout(routineNetworkTimer);
    routineNetworkTimer = 0;
    clearTimeout(blockedSectionsTimer);
    blockedSectionsTimer = 0;
    blockedSections = new Set();
    corePending.clear();
    clearTimeout(coreSuccessTimer);
    coreSuccessTimer = 0;
    coreSuccessStats = new Map();
    workerProgressStates = new Map();
    clearTimeout(fcliteUsageTimer);
    fcliteUsageTimer = 0;
    fcliteUsageStats = new Map();
    aftMoveProbeAction = 0;
    aftMoveProbeStatus = '';
    aftMoveProbeCount = 0;
    lastResearchAction = null;
    researchChainCount = 0;
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
        const hierarchy = !noise && !fcr && isHierarchyNetwork(rawUrl);
        const poPortal = !noise && !fcr && !hierarchy && isPoPortalNetwork(rawUrl);
        const aftMoveProbe = !noise && !fcr && !hierarchy && !poPortal && isAftMoveProbe(rawUrl);
        const detailed = !noise && !fcr && !hierarchy && !poPortal && !aftMoveProbe && isDetailedApi(rawUrl);
        const researchCause = recentResearchAction();
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
          recordResearchChain(base, rawUrl, researchCause);

          if (fcr) {
            void response.clone().text()
              .then(text => recordFcrNetwork(base, rawUrl, init?.body, text, response.headers.get('content-type') || ''))
              .catch(() => recordFcrNetwork(base, rawUrl, init?.body));
          } else if (hierarchy) {
            void response.clone().text()
              .then(text => recordHierarchyNetwork(base, rawUrl, init?.body, text, response.headers.get('content-type') || ''))
              .catch(error => add('hierarchy.network', {
                ...base,
                path:sanitizePath(parsedUrl(rawUrl)?.pathname || ''),
                request:hierarchyBodySummary(init?.body),
                responseReadError:scrubText(error?.message || error)
              }));
          } else if (poPortal) {
            void response.clone().text()
              .then(text => recordPoPortalNetwork(base, rawUrl, init?.body, text, response.headers.get('content-type') || ''))
              .catch(error => add('poportal.network', {
                ...base,
                path: parsedUrl(rawUrl)?.pathname || '',
                query: poPortalQuerySummary(rawUrl),
                request: poPortalRequestSummary(init?.body),
                responseReadError: scrubText(error?.message || error)
              }));
          } else if (aftMoveProbe) {
            void response.clone().text()
              .then(text => recordAftMoveProbe(base, rawUrl, init?.body, text, response.headers.get('content-type') || ''))
              .catch(error => add('aft.move.probe', {
                ...base,
                path: parsedUrl(rawUrl)?.pathname || '',
                actionSeq: aftMoveProbeAction,
                request: summarizeAftMoveRequest(init?.body),
                responseReadError: scrubText(error?.message || error)
              }));
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
            recordRoutineNetwork(base, rawUrl);
          }

          return response;
        } catch (error) {
          if (!noise) {
            const aborted = isAbortLikeError(error);
            const message = scrubText(error?.message || error);
            add(aborted ? 'network.abort' : 'network.error', {
              transport: 'fetch',
              method,
              url: sanitizeUrl(rawUrl),
              request: aborted ? null : (hierarchy ? hierarchyBodySummary(init?.body) : (aftMoveProbe ? summarizeAftMoveRequest(init?.body) : (detailed ? summarizeRequestShape(init?.body) : null))),
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

  function isAbortLikeError(error) {
    const name = String(error?.name || '').trim().toLowerCase();
    const message = String(error?.message || error || '');
    return name === 'aborterror' || Number(error?.code) === 20 || /\b(?:abort|cancel)(?:ed|ing|led|ling)?\b/i.test(message);
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
        const hierarchy = !fcr && isHierarchyNetwork(info.url);
        const poPortal = !fcr && !hierarchy && isPoPortalNetwork(info.url);
        const aftMoveProbe = !fcr && !hierarchy && !poPortal && isAftMoveProbe(info.url);
        const detailed = !fcr && !hierarchy && !poPortal && !aftMoveProbe && isDetailedApi(info.url);
        const researchCause = recentResearchAction();
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
          recordResearchChain(base, info.url, researchCause);
          const cancelled = Number(base.status) === 0;

          if (fcr) {
            let text = '';
            let contentType = '';
            try {
              if (!this.responseType || this.responseType === 'text') text = this.responseText || '';
              contentType = this.getResponseHeader('content-type') || '';
            } catch {}
            recordFcrNetwork(base, info.url, body, text, contentType);
          } else if (hierarchy) {
            let text = '';
            let contentType = '';
            try {
              if (!this.responseType || this.responseType === 'text') text = this.responseText || '';
              contentType = this.getResponseHeader('content-type') || '';
            } catch {}
            recordHierarchyNetwork(base, info.url, body, text, contentType);
          } else if (poPortal) {
            let text = '';
            let contentType = '';
            try {
              if (!this.responseType || this.responseType === 'text') text = this.responseText || '';
              contentType = this.getResponseHeader('content-type') || '';
            } catch {}
            recordPoPortalNetwork(base, info.url, body, text, contentType);
          } else if (cancelled) {
            add('network.cancelled', { ...base, reason: 'status-0' });
          } else if (aftMoveProbe) {
            let text = '';
            let contentType = '';
            try {
              if (!this.responseType || this.responseType === 'text') text = this.responseText || '';
              contentType = this.getResponseHeader('content-type') || '';
            } catch {}
            recordAftMoveProbe(base, info.url, body, text, contentType);
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
            recordRoutineNetwork(base, info.url);
          }
        }, { once: true });

        return originalSend.apply(this, arguments);
      };

      XHR.prototype.__bwu2ObsV1 = true;
    } catch (error) {
      add('core.error', { area: 'xhr-hook', error: scrubText(error?.message || error) });
    }
  }

  function targetInfo(target, allowTextLabel = false) {
    const element = target instanceof Element ? target : target?.parentElement;
    if (!element || uiRoot?.contains(element)) return null;

    let associated = '';
    try {
      const label = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`) : element.closest('label');
      associated = cleanText(label?.textContent || element.closest('fieldset')?.querySelector('legend')?.textContent || '');
    } catch {}

    const explicitLabel =
      element.getAttribute('aria-label') ||
      element.getAttribute('title') ||
      associated ||
      '';
    const tag = element.tagName?.toLowerCase() || 'unknown';
    const role = element.getAttribute('role') || '';
    const textLabel = allowTextLabel && (
      ['button', 'a', 'label'].includes(tag) ||
      ['button', 'menuitem', 'tab', 'radio', 'option'].includes(role)
    )
      ? String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)
      : '';

    return {
      tag,
      id: scrubText(element.id || ''),
      role,
      type: element.getAttribute('type') || '',
      name: element.getAttribute('name') || '',
      label: scrubText(String(explicitLabel || textLabel).replace(/\s+/g, ' ').trim().slice(0, 60))
    };
  }

  function clickTarget(target) {
    const element = target instanceof Element ? target : target?.parentElement;
    if (!element) return null;
    return element.closest('button, a[href], [role="button"], [role="menuitem"], [role="tab"], [role="radio"], [role="option"], input[type="button"], input[type="submit"], input[type="checkbox"], input[type="radio"]');
  }

  function installActionContext() {
    document.addEventListener('click', event => {
      if (!event.isTrusted) return;
      const action = clickTarget(event.target);
      const info = action ? targetInfo(action, true) : null;
      if (info) rememberResearchAction('click', info, action);
    }, true);

    document.addEventListener('submit', event => {
      if (!event.isTrusted) return;
      const info = targetInfo(event.target);
      if (info) rememberResearchAction('submit', info, event.target);
    }, true);

    document.addEventListener('change', event => {
      if (!event.isTrusted) return;
      const info = targetInfo(event.target);
      if (info) rememberResearchAction('change', info, event.target);
    }, true);

    document.addEventListener('keydown', event => {
      if (!event.isTrusted || event.key !== 'Enter') return;
      const info = targetInfo(event.target);
      if (info) rememberResearchAction('enter', info, event.target);
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
      } else if (!message.ok || normalizedCoreSource(message.data) === 'error') {
        add('fcr.core.failure', response);
      } else if (message.data?.complete === false) {
        add('fcr.core.partial', response);
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
    const emit = (type, data = {}) => {
      const version = data && typeof data === 'object' ? scrubText(data.version || '') : '';
      const scriptName = data && typeof data === 'object'
        ? (typeof data.script === 'string'
            ? data.script
            : (typeof data.worker === 'string' ? data.worker.toUpperCase() : ''))
        : '';

      if (version && scriptName && rememberRuntimeVersion(scriptName, version, 'script-event')) {
        scheduleRuntimeVersions('script-event');
      }

      const eventType = String(type || 'event').slice(0, 80);
      if (eventType === 'ISS_CONSOLE_WORKER_PROGRESS') return recordWorkerProgress(data);
      return add(`script.${eventType}`, data);
    };

    try { W.BWU2Observe = emit; } catch {}
    try {
      if (typeof W.BWU2Trace !== 'function') W.BWU2Trace = emit;
    } catch {}

    window.addEventListener('message', event => {
      const message = event.data;
      if (!message || typeof message !== 'object') return;

      if (event.source !== window) {
        const workerOrigin =
          event.origin === 'https://aft-qt-jp.aka.nrt.corp.amazon.com' ||
          event.origin === 'https://aft-poirot-website-nrt.nrt.proxy.amazon.com';
        if (!workerOrigin || !/^ISS_CONSOLE_/.test(String(message.type || ''))) return;

        if (message.type === 'ISS_CONSOLE_PROGRESS') return;

        const safe = {
          messageType: scrubText(message.type || ''),
          worker: scrubText(message.worker || ''),
          version: scrubText(message.version || ''),
          ok: typeof message.ok === 'boolean' ? message.ok : undefined,
          area: scrubText(message.area || ''),
          mode: scrubText(message.mode || ''),
          loading: typeof message.loading === 'boolean' ? message.loading : undefined,
          current: Number.isFinite(Number(message.current)) ? Number(message.current) : undefined,
          total: Number.isFinite(Number(message.total)) ? Number(message.total) : undefined,
          done: Number.isFinite(Number(message.done)) ? Number(message.done) : undefined,
          error: message.error ? scrubText(message.error).slice(0, 180) : ''
        };
        emit('ISS_CONSOLE_WORKER_MESSAGE', safe);
        return;
      }

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
      const key = String(detail.key || '');
      if (['master.open', 'stow.open'].includes(key)) return;
      if (key.startsWith('master.section.blocked.')) {
        blockedSections.add(scrubText(key.slice('master.section.blocked.'.length)));
        clearTimeout(blockedSectionsTimer);
        blockedSectionsTimer = setTimeout(flushBlockedSectionsSummary, BLOCKED_SECTIONS_QUIET_MS);
        return;
      }
      recordFcrUsage(detail);
    }, true);
  }

  function flushBlockedSectionsSummary() {
    clearTimeout(blockedSectionsTimer);
    blockedSectionsTimer = 0;
    if (!blockedSections.size) return;
    const sections = [...blockedSections].filter(Boolean).sort();
    blockedSections = new Set();
    add('fcr.usage', { key: 'master.sections.blocked', count: sections.length, sections });
  }

  function viewportSnapshot() {
    return {
      width: Math.max(0, Math.round(window.innerWidth || 0)),
      height: Math.max(0, Math.round(window.innerHeight || 0)),
      dpr: Number((window.devicePixelRatio || 1).toFixed(2))
    };
  }

  function isFCResearch() {
    return FCR_HOST.test(location.hostname);
  }

  function injectUiStyles() {
    if (document.getElementById('bwu2-observability-style')) return;

    const style = document.createElement('style');
    style.id = 'bwu2-observability-style';
    style.textContent = `
      #bwu2-observability-inline{display:inline-flex;align-items:center;gap:5px;margin-left:8px;vertical-align:baseline;font:700 11px/1.2 Arial,sans-serif;white-space:nowrap;color:#374151}
      #bwu2-observability-inline button{appearance:none;border:0;background:transparent;padding:1px 3px;margin:0;color:inherit;font:inherit;cursor:pointer;border-radius:3px}
      #bwu2-observability-inline button:hover{text-decoration:underline;background:rgba(0,0,0,.05)}
      #bwu2-observability-count{font-variant-numeric:tabular-nums}
      #bwu2-observability-fat[data-on="1"]{background:#7f1d1d!important;color:#fff!important;box-shadow:0 0 0 1px #450a0a;font-weight:900}
      #bwu2-observability-inline.warn #bwu2-observability-count{animation:bwu2ObsFlash .32s steps(1,end) infinite;background:#ffea00;color:#7f1d1d;box-shadow:0 0 0 1px #dc2626}
      #bwu2-observability-inline.full #bwu2-observability-count{animation-duration:.16s;background:#ff2d2d;color:#fff;box-shadow:0 0 0 1px #7f1d1d}
      @keyframes bwu2ObsFlash{0%,49%{opacity:1}50%,100%{opacity:.12}}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function resolveHeaderRow() {
    const warehouse = document.querySelector('.warehouse-id');
    if (!warehouse) return null;

    let row = warehouse.closest('.a-row');
    if (!row) row = warehouse.parentElement?.parentElement || warehouse.parentElement || null;
    if (!(row instanceof HTMLElement)) return null;

    const search = row.querySelector('input[type="search"], input[placeholder*="search" i], input[name*="search" i]');
    if (!search) {
      const nearby = row.parentElement?.querySelector('input[type="search"], input[placeholder*="search" i], input[name*="search" i]');
      if (nearby) row = nearby.closest('.a-row') || row;
    }
    return row instanceof HTMLElement ? row : null;
  }

  function anchorUiToHeader(host) {
    if (!(host instanceof HTMLElement)) return false;
    const warehouse = document.querySelector('.warehouse-id');
    const row = resolveHeaderRow();
    if (!warehouse || !row) return false;

    if (getComputedStyle(row).position === 'static') row.style.position = 'relative';

    const rowRect = row.getBoundingClientRect();
    const warehouseRect = warehouse.getBoundingClientRect();

    host.style.position = 'absolute';
    host.style.left = Math.max(0, Math.round(warehouseRect.right - rowRect.left + 8)) + 'px';
    host.style.top = Math.max(0, Math.round(warehouseRect.top - rowRect.top)) + 'px';
    host.style.zIndex = '20';

    if (host.parentElement !== row) row.appendChild(host);
    return true;
  }

  function mountUi() {
    if (!isFCResearch() || location.hash.startsWith('#iss-console')) return true;
    if (!document.documentElement) return false;

    injectUiStyles();

    if (document.getElementById('bwu2-observability-inline')) {
      uiRoot = document.getElementById('bwu2-observability-inline');
      uiCount = document.getElementById('bwu2-observability-count');
      uiClear = document.getElementById('bwu2-observability-clear');
      const fat = document.getElementById('bwu2-observability-fat');
      if (fat) { fat.dataset.on = fullFatMode ? '1' : '0'; fat.textContent = `FAT ${fullFatMode ? 'ON' : 'OFF'}`; }
      anchorUiToHeader(uiRoot);
      return true;
    }

    const warehouse = document.querySelector('.warehouse-id');
    const headerRow = resolveHeaderRow();

    if (!warehouse || !headerRow) return false;

    const host = document.createElement('span');
    host.id = 'bwu2-observability-inline';
    host.dataset.fcrToolUi = '1';
    host.innerHTML =
      `<button type="button" id="bwu2-observability-count" title="Download current observability log and start a fresh session">OBS 0/${MAX_EVENTS}</button>` +
      '<span aria-hidden="true">·</span>' +
      `<button type="button" id="bwu2-observability-fat" data-on="${fullFatMode ? '1' : '0'}" title="Toggle one-hour high-detail audit logging">FAT ${fullFatMode ? 'ON' : 'OFF'}</button>` +
      '<span aria-hidden="true">·</span>' +
      '<button type="button" id="bwu2-observability-clear" title="Delete current observability log and start fresh">Clear</button>';

    headerRow.appendChild(host);
    anchorUiToHeader(host);

    uiRoot = host;
    uiCount = host.querySelector('#bwu2-observability-count');
    uiClear = host.querySelector('#bwu2-observability-clear');

    uiCount.addEventListener('click', downloadAndReset);
    host.querySelector('#bwu2-observability-fat')?.addEventListener('click', () => {
      const next = !fullFatMode;
      try { GM_setValue(FULL_FAT_KEY, next); } catch {}
      resetSession(next ? 'full-fat-on' : 'full-fat-off');
      location.reload();
    });
    uiClear.addEventListener('click', () => resetSession('clear'));

    renderUi(true);
    return true;
  }

  function renderUi(force = false) {
    if (!isFCResearch() || location.hash.startsWith('#iss-console')) return;
    if (!uiRoot?.isConnected && !mountUi()) return;

    const count = sessionCount(force);

    uiCount.textContent = `OBS ${Math.min(count, MAX_EVENTS)}/${MAX_EVENTS}`;
    uiRoot.classList.toggle('warn', count >= WARN_AT && count < MAX_EVENTS);
    uiRoot.classList.toggle('full', count >= MAX_EVENTS);

    anchorUiToHeader(uiRoot);

    uiCount.title =
      count >= MAX_EVENTS
        ? 'FULL — click to download and start fresh'
        : count >= WARN_AT
          ? '80%+ — click to download and start fresh'
          : 'Click to download current log and start fresh';
  }

  function bootUi() {
    if (!isFCResearch() || location.hash.startsWith('#iss-console')) return;

    window.addEventListener('load', () => {
      setTimeout(() => {
        if (uiRoot?.isConnected) anchorUiToHeader(uiRoot);
        else mountUi();
      }, 250);
      setTimeout(() => {
        if (uiRoot?.isConnected) anchorUiToHeader(uiRoot);
      }, 1200);
    }, { once:true });

    window.addEventListener('resize', () => {
      if (uiRoot?.isConnected) anchorUiToHeader(uiRoot);
    }, { passive:true });

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

  }

  function bootCountSync() {
    sessionCount(true);
    countListenerId = gmListen(REVISION_KEY, () => {
      clearTimeout(countSyncTimer);
      countSyncTimer = setTimeout(() => {
        countSyncTimer = 0;
        sessionCount(true);
        renderUi();
      }, 80);
    });
  }

  bootCountSync();

  add('page.start', {
    version: VERSION,
    host: location.hostname,
    path: sanitizePath(location.pathname),
    title: sanitizeTitle(document.title || ''),
    tool: workflowTool(),
    viewport: viewportSnapshot()
  });
  if (fullFatMode) {
    add('workflow.tool-entry', {
      tool: workflowTool(),
      host: scrubText(location.hostname),
      path: sanitizePath(location.pathname),
      hash: scrubText(location.hash || '')
    });
  }

  installFetchTrace();
  installXhrTrace();
  installScriptBus();
  bootRuntimeVersionTrace();
  installFcrDataCoreTrace();
  installErrorTrace();
  installActionContext();
  installPerformanceHealth();
  bootUi();

  window.addEventListener('pagehide', () => {
    clearTimeout(fcrNetworkTimer);
    clearTimeout(pollNetworkTimer);
    clearTimeout(routineNetworkTimer);
    clearTimeout(blockedSectionsTimer);
    flushFcrNetworkSummary();
    flushPollNetworkSummary();
    flushRoutineNetworkSummary();
    flushBlockedSectionsSummary();
    flushCoreSuccessSummary();
    flushPage();
    if (uiObserver) uiObserver.disconnect();
    if (runtimeVersionObserver) runtimeVersionObserver.disconnect();
    if (performanceObserver) performanceObserver.disconnect();
    clearTimeout(countSyncTimer);
    clearTimeout(runtimeVersionTimer);
    gmUnlisten(countListenerId);
  }, { once: true });
})();
