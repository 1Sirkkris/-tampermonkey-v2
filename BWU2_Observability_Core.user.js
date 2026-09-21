// ==UserScript==
// @name         CORE v0.1.11 BWU2 Observability Core
// @name:en      CORE BWU2 Observability Core
// @namespace    https://github.com/1Sirkkris
// @version      0.1.23
// @description  Signal-focused cross-tool observability with deduped worker state, compact scan/usage summaries, and bounded diagnostics.
// @include      /^https?:\/\/aft-poirot-website-nrt\.nrt\.proxy\.amazon\.com\//
// @include      /^https?:\/\/aft-qt-[^\/]+(?:\.aka\.[^\/]+)?\.corp\.amazon\.com\//
// @include      /^https?:\/\/(?:[^\/]*fcresearch[^\/]*|qifcr\.fe\.aftx\.amazonoperations\.app)\//
// @include      /^https?:\/\/aft-moveapp-[^\/]+(?:\.nrt)?\.proxy\.amazon\.com\//
// @include      /^https?:\/\/t\.corp\.amazon\.com\//
// @include      /^https?:\/\/aftcartonpreditorapp-tcp-nrt\.nrt\.proxy\.amazon\.com\//
// @include      /^https?:\/\/fba-fnsku-commingling-console-(?:eu|na|jp)\.aka\.amazon\.com\//
// @include      /^https?:\/\/river\.amazon\.com\//
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
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = '0.1.23';
  function registerRuntimeVersion(label, version) {
    const mount = () => {
      const root = document.body || document.documentElement;
      if (!root) return;
      let host = document.getElementById('bwu2-runtime-version-stamp');
      if (!host) {
        host = document.createElement('div');
        host.id = 'bwu2-runtime-version-stamp';
        host.setAttribute('aria-hidden', 'true');
        host.style.cssText = 'position:fixed;left:50%;bottom:2px;transform:translateX(-50%);z-index:2147483000;display:flex;flex-wrap:wrap;justify-content:center;gap:2px 10px;max-width:94vw;padding:2px 7px;border-radius:6px 6px 0 0;background:rgba(255,255,255,.34);color:rgba(15,23,42,.52);box-shadow:0 0 0 1px rgba(15,23,42,.05);backdrop-filter:blur(1.5px);font:800 11px/1.25 Arial,sans-serif;letter-spacing:.2px;pointer-events:none;user-select:none;text-shadow:0 1px 1px rgba(255,255,255,.95),0 0 3px rgba(255,255,255,.75)';
        root.appendChild(host);
      }
      let item = Array.from(host.children).find(node => node.dataset?.bwu2RuntimeKey === label);
      if (!item) { item = document.createElement('span'); item.dataset.bwu2RuntimeKey = label; host.appendChild(item); }
      item.textContent = `${label} · v${version}`;
      Array.from(host.children).sort((a,b) => String(a.dataset?.bwu2RuntimeKey || '').localeCompare(String(b.dataset?.bwu2RuntimeKey || ''))).forEach(node => host.appendChild(node));
    };
    mount();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once:true });
  }
  registerRuntimeVersion('OBS', VERSION);

  const PREFIX = 'bwu2:observability:v1:';
  const META_KEY = `${PREFIX}meta`;
  const PAGE_PREFIX = `${PREFIX}page:`;
  const COUNT_PREFIX = `${PREFIX}count:`;
  const REVISION_KEY = `${PREFIX}revision`;
  const MAX_EVENTS = 6000;
  const WARN_AT = Math.floor(MAX_EVENTS * 0.80);
  const FLUSH_MS = 300;
  const MAX_BODY_CHARS = 5000;
  const MUTATION_REPORT_MS = 10000;
  const EVENT_LOOP_WARN_MS = 500;
  const EVENT_LOOP_MIN_GAP_MS = 10000;
  const FCR_NETWORK_QUIET_MS = 1200;
  const FCR_CORE_QUIET_MS = 10000;
  const WORKER_PROGRESS_HEARTBEAT_MS = 60000;
  const FCLITE_USAGE_SUMMARY_MS = 30000;
  const UI_ENTER_BURST_GAP_MS = 5000;
  const SLOW_NETWORK_MS = 1500;
  const VISIBILITY_DEBOUNCE_MS = 750;
  const VIEWPORT_DEBOUNCE_MS = 500;
  const ROUTINE_NETWORK_REPORT_MS = 60000;
  const VISIBILITY_REPORT_MS = 60000;
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

  const pageId = randomId('p_');
  let meta = loadMeta();
  let activeSessionId = meta.sessionId;
  let pageEvents = [];
  let pageStoreKey = pageKey(activeSessionId);
  let pageCountKey = countKey(activeSessionId);
  let flushTimer = 0;
  let eventSeq = 0;
  let lastHref = location.href;
  let lastGlobalCount = 0;
  let full = false;
  let mutationObserver = null;
  let mutationStats = emptyMutationStats();
  let mutationTimer = 0;
  let uiObserver = null;
  let uiRoot = null;
  let uiCount = null;
  let uiClear = null;
  let countSyncTimer = 0;
  let countListenerId = null;
  let lastEventLoopLogAt = 0;
  let visibilityTimer = 0;
  let visibilityReportTimer = 0;
  let visibilityStats = emptyVisibilityStats();
  let viewportTimer = 0;
  let lastViewport = '';
  let performanceObserver = null;
  let eventLoopTimer = 0;
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
  let uiEnterBatches = new Map();
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

  function emptyVisibilityStats() {
    return { transitions: 0, hidden: 0, visible: 0, firstAt: '', lastAt: '', last: '' };
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
    mutationStats = emptyMutationStats();
    fcrNetworkStats = new Map();
    clearTimeout(fcrNetworkTimer);
    fcrNetworkTimer = 0;
    pollNetworkStats = new Map();
    clearTimeout(pollNetworkTimer);
    pollNetworkTimer = 0;
    routineNetworkStats = new Map();
    clearTimeout(routineNetworkTimer);
    routineNetworkTimer = 0;
    clearTimeout(visibilityReportTimer);
    visibilityReportTimer = 0;
    visibilityStats = emptyVisibilityStats();
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
    uiEnterBatches = new Map();
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

  function rememberResearchAction(kind, info = {}) {
    lastResearchAction = {
      at: performance.now(),
      kind: scrubText(kind || 'ui'),
      tag: scrubText(info.tag || ''),
      role: scrubText(info.role || ''),
      type: scrubText(info.type || ''),
      label: scrubText(info.label || '').slice(0, 80)
    };
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

  function researchRuntimeSnapshot(reason = 'settled') {
    const nameRx = /(?:api|client|service|workflow|state|store|model|controller|action|inventory|move|edit|unbind|sideline|dropzone|mapping|fcr|river|stow|bin|container)/i;
    const globals = [];

    try {
      for (const name of Object.getOwnPropertyNames(W)) {
        if (!nameRx.test(name) || SENSITIVE_KEY.test(name)) continue;
        const descriptor = Object.getOwnPropertyDescriptor(W, name);
        if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) continue;
        const value = descriptor.value;
        const item = { name: scrubText(name), type: Array.isArray(value) ? 'array' : typeof value };

        if (typeof value === 'function') {
          item.arity = Math.max(0, Number(value.length) || 0);
        } else if (value && typeof value === 'object') {
          try {
            item.ctor = scrubText(value.constructor?.name || '');
            item.keys = Object.keys(value).filter(key => !SENSITIVE_KEY.test(key)).slice(0, 40).map(key => scrubText(key));
          } catch {}
        }

        globals.push(item);
        if (globals.length >= 60) break;
      }
    } catch {}

    const stateScripts = [];
    try {
      for (const script of [...document.querySelectorAll('script[type="a-state"],script[type="application/json"],script[id*="state" i],script[id*="data" i]')].slice(0, 30)) {
        const raw = String(script.textContent || '').trim();
        if (!raw) continue;
        const item = {
          type: scrubText(script.type || ''),
          id: scrubText(script.id || ''),
          chars: raw.length
        };
        try {
          const parsed = JSON.parse(raw);
          item.kind = Array.isArray(parsed) ? 'array' : typeof parsed;
          if (parsed && typeof parsed === 'object') {
            item.keys = Object.keys(parsed).filter(key => !SENSITIVE_KEY.test(key)).slice(0, 50).map(key => scrubText(key));
          }
        } catch {
          item.kind = 'text';
        }
        stateScripts.push(item);
      }
    } catch {}

    const framework = { reactFiber: 0, reactProps: 0, vue: 0, angular: 0, scanned: 0 };
    try {
      for (const el of [...document.querySelectorAll('*')].slice(0, 250)) {
        framework.scanned++;
        const keys = Object.getOwnPropertyNames(el);
        if (keys.some(key => key.startsWith('__reactFiber$'))) framework.reactFiber++;
        if (keys.some(key => key.startsWith('__reactProps$'))) framework.reactProps++;
        if (keys.some(key => key === '__vue__' || key.startsWith('__vue'))) framework.vue++;
        if (keys.some(key => key === '__ngContext__')) framework.angular++;
      }
    } catch {}

    add('research.runtime-surface', {
      reason,
      globals,
      stateScripts,
      framework,
      runtimeScripts: collectRuntimeVersions(),
      forms: document.forms?.length || 0,
      scripts: document.scripts?.length || 0
    });
  }

  function bootResearchProbe() {
    const capture = () => {
      queueMicrotask(() => researchRuntimeSnapshot('dom-ready'));
      setTimeout(() => researchRuntimeSnapshot('settled-1000ms'), 1000);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', capture, { once: true });
    else capture();
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

  function aftSafeControlValue(element) {
    let raw = '';
    try { raw = String(element?.value ?? '').trim(); } catch {}
    if (!raw) return { kind: 'empty', length: 0 };
    if (/^\d{1,7}$/.test(raw)) return { kind: 'numeric', length: raw.length, number: Number(raw) };
    if (/^(?:INVENTORY|SELLABLE|PENDING_RESEARCH|UNSELLABLE|PENDING_REPAIR|PENDING_WORKORDER|IN_QUARANTINE|Confirm|Done|Continue|Start over)$/i.test(raw)) {
      return { kind: 'enum', length: raw.length, value: scrubText(raw) };
    }
    return {
      kind: classifySearchValue(raw),
      length: raw.length,
      fingerprint: fingerprint(raw, 'aft-control')
    };
  }

  function aftControlLabel(element) {
    const parts = [];
    try {
      for (const label of element?.labels || []) parts.push(label.textContent || '');
    } catch {}
    if (!parts.length) {
      try { parts.push(element?.closest?.('label')?.textContent || element?.parentElement?.textContent || ''); } catch {}
    }
    return scrubText(cleanText(parts.join(' ')).slice(0, 220));
  }

  function aftInterestingStateScripts() {
    const out = [];
    const scripts = [...document.querySelectorAll('script[type="a-state"], script[type="application/json"]')].slice(0, 40);
    for (const script of scripts) {
      const raw = String(script.textContent || '').trim();
      if (!raw || !/(?:quantity|qty|inventory|pending|unsellable|objectId|instruction|workflow|state|option|disposition|owner)/i.test(raw)) continue;

      const item = {
        type: scrubText(script.getAttribute('type') || ''),
        id: scrubText(script.id || ''),
        dataState: scrubText(script.getAttribute('data-a-state') || ''),
        chars: raw.length
      };
      try {
        item.value = boundedRiverValue(JSON.parse(raw));
      } catch {
        item.tokens = [...new Set(
          (raw.match(/\b(?:quantity|qty|inventory|pending_research|unsellable|objectId|instructionId|workflow|state|option|disposition|owner)\b/gi) || [])
            .map(value => value.toLowerCase())
        )].slice(0, 30);
      }
      out.push(item);
      if (out.length >= 16) break;
    }
    return out;
  }

  function aftPageStateSnapshot(reason = 'page-ready') {
    if (!AFT_QT_HOST.test(location.hostname) || !/^\/app\/edititems\/?$/i.test(location.pathname)) return;

    const headings = [...document.querySelectorAll('h1,h2,h3,[role="heading"]')]
      .map(node => scrubText(cleanText(node.textContent || '').slice(0, 180)))
      .filter(Boolean)
      .slice(0, 16);

    const radios = [...document.querySelectorAll('input[type="radio"]')].slice(0, 30).map(radio => ({
      name: scrubText(radio.name || ''),
      checked: !!radio.checked,
      disabled: !!radio.disabled,
      label: aftControlLabel(radio),
      value: aftSafeControlValue(radio)
    }));

    const forms = [...document.forms].slice(0, 12).map(form => ({
      method: scrubText(form.method || ''),
      action: form.action ? sanitizeUrl(form.action) : '',
      controls: [...form.elements].slice(0, 40).map(control => ({
        tag: String(control.tagName || '').toLowerCase(),
        type: scrubText(control.getAttribute?.('type') || ''),
        name: scrubText(control.getAttribute?.('name') || ''),
        id: scrubText(control.id || ''),
        checked: 'checked' in control ? !!control.checked : undefined,
        disabled: !!control.disabled,
        label: aftControlLabel(control),
        value: aftSafeControlValue(control)
      }))
    }));

    const quantityLabels = [...new Set(
      [...document.querySelectorAll('label,li,tr,div')]
        .map(node => cleanText(node.textContent || ''))
        .filter(text => /\bQuantity\s*:\s*\d{1,7}\b/i.test(text))
        .map(text => scrubText(text.slice(0, 240)))
    )].slice(0, 20);

    const globals = [];
    try {
      for (const name of Object.getOwnPropertyNames(window)) {
        if (!/(?:initial.*state|bootstrap.*data|workflow|instruction|inventory|edititems|quantity|(?:^|[_$])aft(?:[_$]|$))/i.test(name)) continue;
        const descriptor = Object.getOwnPropertyDescriptor(window, name);
        if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) continue;
        const value = descriptor.value;
        if (typeof value === 'function') continue;
        const entry = { name: scrubText(name), type: Array.isArray(value) ? 'array' : typeof value };
        if (value && typeof value === 'object') {
          const proto = Object.getPrototypeOf(value);
          if (Array.isArray(value) || proto === Object.prototype || proto === null) {
            entry.value = boundedRiverValue(value);
          } else {
            entry.keys = Object.keys(value).slice(0, 40).map(key => scrubText(key));
          }
        } else if (['string','number','boolean'].includes(typeof value)) {
          entry.value = boundedRiverValue(value, name);
        }
        globals.push(entry);
        if (globals.length >= 20) break;
      }
    } catch {}

    let navigation = null;
    try {
      const nav = performance.getEntriesByType?.('navigation')?.[0];
      if (nav) {
        navigation = {
          transferSize: Number(nav.transferSize) || 0,
          encodedBodySize: Number(nav.encodedBodySize) || 0,
          decodedBodySize: Number(nav.decodedBodySize) || 0,
          durationMs: Math.round(Number(nav.duration) || 0)
        };
      }
    } catch {}

    add('aft.edit.page-state', {
      reason,
      readyState: document.readyState,
      title: sanitizeTitle(document.title || ''),
      headings,
      quantityLabels,
      radios,
      forms,
      stateScripts: aftInterestingStateScripts(),
      globals,
      navigation
    });
  }

  function bootAftEditPageStateProbe() {
    if (!AFT_QT_HOST.test(location.hostname) || !/^\/app\/edititems\/?$/i.test(location.pathname)) return;
    const capture = () => {
      queueMicrotask(() => aftPageStateSnapshot('dom-ready'));
      setTimeout(() => aftPageStateSnapshot('settled-250ms'), 250);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', capture, { once: true });
    else capture();
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

  function recordUiEnter(data = {}) {
    const safe = sanitize(data);
    if (!['item','container'].includes(String(safe?.inputKind || ''))) return add('ui.enter', safe);

    const key = JSON.stringify([
      safe?.tag || '',
      safe?.id || '',
      safe?.name || '',
      safe?.label || '',
      safe?.inputKind || ''
    ]);
    const now = Date.now();
    const previous = uiEnterBatches.get(key);

    if (
      previous?.event?.data &&
      now - previous.lastTs <= UI_ENTER_BURST_GAP_MS
    ) {
      const gap = Math.max(0, now - previous.lastTs);
      previous.lastTs = now;
      previous.event.data.count = (Number(previous.event.data.count) || 1) + 1;
      previous.event.data.lastAt = new Date(now).toISOString();
      previous.event.data.spanMs = Math.max(0, now - previous.firstTs);
      previous.event.data.minGapMs = previous.event.data.minGapMs == null
        ? gap
        : Math.min(Number(previous.event.data.minGapMs) || gap, gap);
      previous.event.data.maxGapMs = Math.max(Number(previous.event.data.maxGapMs) || 0, gap);
      scheduleFlush();
      return true;
    }

    if (!add('ui.enter', { ...safe, count:1, spanMs:0 })) return false;
    const event = pageEvents[pageEvents.length - 1];
    if (event?.data) event.data.lastAt = event.at;
    uiEnterBatches.set(key, { event, firstTs:now, lastTs:now });
    return true;
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
    mutationStats = emptyMutationStats();
    fcrNetworkStats = new Map();
    clearTimeout(fcrNetworkTimer);
    fcrNetworkTimer = 0;
    pollNetworkStats = new Map();
    clearTimeout(pollNetworkTimer);
    pollNetworkTimer = 0;
    routineNetworkStats = new Map();
    clearTimeout(routineNetworkTimer);
    routineNetworkTimer = 0;
    clearTimeout(visibilityReportTimer);
    visibilityReportTimer = 0;
    visibilityStats = emptyVisibilityStats();
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
    uiEnterBatches = new Map();
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
        const aftMoveProbe = !noise && !fcr && isAftMoveProbe(rawUrl);
        const detailed = !noise && !fcr && !aftMoveProbe && isDetailedApi(rawUrl);
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
              request: aborted ? null : (aftMoveProbe ? summarizeAftMoveRequest(init?.body) : (detailed ? summarizeRequestShape(init?.body) : null)),
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
        const aftMoveProbe = !fcr && isAftMoveProbe(info.url);
        const detailed = !fcr && !aftMoveProbe && isDetailedApi(info.url);
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

  function shouldLogChange(target) {
    const element = target instanceof Element ? target : target?.parentElement;
    if (!element) return false;
    const tag = element.tagName?.toLowerCase() || '';
    const type = String(element.getAttribute?.('type') || '').toLowerCase();
    if (RIVER_HOST.test(location.hostname)) {
      return tag === 'select' || tag === 'textarea' || (tag === 'input' && !['password', 'file', 'hidden'].includes(type));
    }
    return tag === 'select' || (tag === 'input' && ['checkbox', 'radio'].includes(type));
  }

  function installActionTrace() {
    document.addEventListener('click', event => {
      const river = RIVER_HOST.test(location.hostname);
      if (!event.isTrusted && !river) return;
      const action = clickTarget(event.target);
      if (!action) return;
      const info = targetInfo(action, true);
      if (info) {
        add('ui.click', { ...info, trusted: !!event.isTrusted });
        if (event.isTrusted) rememberResearchAction('click', info);
      }
    }, true);

    document.addEventListener('submit', event => {
      const river = RIVER_HOST.test(location.hostname);
      if (!event.isTrusted && !river) return;
      const info = targetInfo(event.target);
      if (!info) return;
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      add('ui.submit', {
        ...info,
        trusted: !!event.isTrusted,
        method: scrubText(form?.method || ''),
        action: form?.action ? sanitizeUrl(form.action) : '',
        controls: form?.elements?.length || 0
      });
      if (event.isTrusted) rememberResearchAction('submit', info);
    }, true);

    document.addEventListener('change', event => {
      const river = RIVER_HOST.test(location.hostname);
      if ((!event.isTrusted && !river) || !shouldLogChange(event.target)) return;
      const info = targetInfo(event.target);
      if (!info) return;

      if (!river) {
        add('ui.change', info);
        if (event.isTrusted) rememberResearchAction('change', info);
        return;
      }

      const element = event.target instanceof Element ? event.target : null;
      let value = '';
      try {
        value = element?.tagName === 'SELECT'
          ? element.options?.[element.selectedIndex]?.text || element.value || ''
          : element?.value || '';
      } catch {}

      const detail = {
        ...info,
        trusted: !!event.isTrusted,
        inputKind: classifySearchValue(value),
        inputLength: String(value || '').length
      };
      if (element?.tagName === 'SELECT') {
        detail.selected = scrubText(value);
        detail.selectedValue = boundedRiverValue(element.value || '', element.name || element.id || 'option');
      }
      if (element && 'checked' in element && ['checkbox', 'radio'].includes(String(element.type || '').toLowerCase())) detail.checked = !!element.checked;
      add('ui.change', detail);
      if (event.isTrusted) rememberResearchAction('change', info);
    }, true);

    document.addEventListener('keydown', event => {
      if (!event.isTrusted || event.key !== 'Enter') return;
      const info = targetInfo(event.target);
      if (!info) return;

      let value = '';
      try { value = event.target?.value || ''; } catch {}

      recordUiEnter({ ...info, inputKind: classifySearchValue(value), inputLength: String(value || '').length });
      rememberResearchAction('enter', info);
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
        if (name === 'pagehide') {
          flushCoreSuccessSummary();
          flushFcliteUsageSummary();
        }
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
        if (document.visibilityState !== visibility) return;
        const now = new Date().toISOString();
        visibilityStats.transitions++;
        visibilityStats[visibility] = (Number(visibilityStats[visibility]) || 0) + 1;
        visibilityStats.firstAt ||= now;
        visibilityStats.lastAt = now;
        visibilityStats.last = visibility;
        if (!visibilityReportTimer) visibilityReportTimer = setTimeout(flushVisibilitySummary, VISIBILITY_REPORT_MS);
      }, VISIBILITY_DEBOUNCE_MS);
    }, true);
  }

  function flushVisibilitySummary() {
    clearTimeout(visibilityReportTimer);
    visibilityReportTimer = 0;
    if (!visibilityStats.transitions) return;
    const summary = visibilityStats;
    visibilityStats = emptyVisibilityStats();
    add('page.visibility.summary', summary);
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
    if (!isFCResearch()) return;
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

  function recordMadcatAuthDiagnostic(message) {
    const data = message?.data;
    if (!data || typeof data !== 'object') return;

    const available = !!data.available;
    const issuedAt = Math.max(0, Number(data.issuedAt) || 0);
    const expiresAt = Math.max(0, Number(data.expiresAt) || 0);
    const capturedAt = Math.max(0, Number(data.capturedAt) || 0);
    const lifetimeMs = Math.max(0, Number(data.lifetimeMs) || (issuedAt && expiresAt ? expiresAt - issuedAt : 0));
    const remainingMs = Math.max(0, Number(data.expiresInMs) || 0);
    const captureAgeMs = Math.max(0, Number(data.captureAgeMs) || (capturedAt ? Date.now() - capturedAt : 0));
    const signature = JSON.stringify([available, issuedAt, expiresAt, !!data.renewSoon, !!data.bridgeRecent]);
    const stateKey = `${SAMPLE_PREFIX}${activeSessionId}:madcat-auth-state`;
    if (gmGet(stateKey, '') === signature) return;
    gmSet(stateKey, signature);

    add('fcr.madcat.auth-status', {
      available,
      issuedAt,
      expiresAt,
      capturedAt,
      lifetimeMs,
      remainingMs,
      captureAgeMs,
      renewSoon: !!data.renewSoon,
      bridgeRecent: !!data.bridgeRecent,
      coreVersion: scrubText(message.version || '')
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

      if (pending.type === 'madcatAuthStatus' && message.ok) recordMadcatAuthDiagnostic(message);

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
    if (!isFCResearch() || location.hash.startsWith('#iss-console')) return true;
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
      '<button type="button" id="bwu2-observability-count" title="Download current observability log and start a fresh session">OBS 0/6000</button>' +
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
    if (!isFCResearch() || location.hash.startsWith('#iss-console')) return;
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
    if (!isFCResearch() || location.hash.startsWith('#iss-console')) return;

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
    viewport: viewportSnapshot()
  });

  installFetchTrace();
  installXhrTrace();
  installScriptBus();
  bootRuntimeVersionTrace();
  installFcrDataCoreTrace();
  installRouteTrace();
  installErrorTrace();
  installActionTrace();
  installViewportTrace();
  installMutationHealth();
  installPerformanceHealth();
  bootAftEditPageStateProbe();
  bootResearchProbe();
  bootUi();

  window.addEventListener('pagehide', () => {
    clearTimeout(visibilityTimer);
    clearTimeout(viewportTimer);
    clearTimeout(fcrNetworkTimer);
    clearTimeout(pollNetworkTimer);
    clearTimeout(routineNetworkTimer);
    clearTimeout(visibilityReportTimer);
    clearTimeout(blockedSectionsTimer);
    flushFcrNetworkSummary();
    flushPollNetworkSummary();
    flushRoutineNetworkSummary();
    flushVisibilitySummary();
    flushBlockedSectionsSummary();
    flushCoreSuccessSummary();
    flushPage();
    if (mutationObserver) mutationObserver.disconnect();
    if (uiObserver) uiObserver.disconnect();
    if (runtimeVersionObserver) runtimeVersionObserver.disconnect();
    if (performanceObserver) performanceObserver.disconnect();
    if (mutationTimer) clearInterval(mutationTimer);
    if (eventLoopTimer) clearInterval(eventLoopTimer);
    clearTimeout(countSyncTimer);
    clearTimeout(runtimeVersionTimer);
    gmUnlisten(countListenerId);
  }, { once: true });
})();
