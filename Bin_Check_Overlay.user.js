// ==UserScript==
// @name         v2 TEST v7.4.3 Bin check Overlay — Filter Snapshot
// @name:en      v2 TEST Bin check Overlay — Filter Snapshot
// @namespace    https://github.com/1Sirkkris
// @version      7.4.15
// @description  Snapshots the current filtered FCResearch Inventory view and resolves floor locations for matching P-level containers.
// @include      /^https?:\/\/.*fcresearch.*\//
// @include      /^https?:\/\/qifcr\.fe\.aftx\.amazonoperations\.app\//
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Bin_Check_Overlay.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Bin_Check_Overlay.user.js
// @require      https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/BWU2_Fleet_Core.lib.js
// ==/UserScript==

(() => {
  'use strict';

  if (window.__bwu2BinCheckOverlay || location.hash.startsWith('#fcr-tote-checker') || location.hash.startsWith('#iss-console')) return;
  window.__bwu2BinCheckOverlay = true;

  const VERSION = '7.4.15';
  const { registerRuntimeVersion } = globalThis.BWU2Fleet;
  registerRuntimeVersion('BIN', VERSION);

  const POD_REGEX = /\bP-\d-(?:[A-Z]\d{3}){2}\b/i;
  const FLOORS = ['P2', 'P3', 'P4'];
  const FLOOR_FILTERS = ['P1', 'P2', 'P3', 'P4', 'OTHER'];
  const SORTS = ['FLOOR_DESC', 'FLOOR_ASC', 'QTY_DESC', 'QTY_ASC', 'SIZE_ASC', 'SIZE_DESC'];
  const PREFERENCES_KEY = 'bwu2-bin-overlay-preferences-v1';
  const MAX_ATTEMPTS = 3;
  const REQUEST_GAP_MS = 400;
  const MIN_REQUEST_GAP_MS = 250; // At most four starts/second; still one request in flight.
  const MAX_REQUEST_GAP_MS = 5000;
  const CLEAN_WINDOW = 20;
  const PACE_KEY = 'bwu2-bin-overlay-pace-v1';
  const PACE_TTL_MS = 24 * 60 * 60 * 1000;
  const REQUEST_TIMEOUT_MS = 25000;
  const FLOOR_CACHE_TTL = 30 * 60 * 1000;

  const { clean } = globalThis.BWU2Fleet;

  const usage = (key, ms = 0, count = 1) => globalThis.BWU2Fleet.usage('overlay', key, ms, count);

  const fleetTrace = globalThis.BWU2Fleet.trace;
  const trace = (type, data = {}) => fleetTrace(type,
    { script: 'BIN_OVERLAY', version: VERSION, run: state.runId, ...data });

  const preferences = readPreferences();
  const rememberedPace = readPace();

  const state = {
    rows: [],
    rowSequence: 0,
    openDetails: new Set(),
    podBuckets: new Map(),
    podCache: new Map(),
    jobs: new Map(),
    queue: [],
    queued: new Set(),
    activeRequests: 0,
    totalPods: 0,
    totalRows: 0,
    selectedFloors: new Set(preferences.floors),
    sort: preferences.sort,
    paused: false,
    overlayBuilt: false,
    refreshTimer: null,
    runId: 0,
    controllers: new Set(),
    pumpTimer: null,
    cooldownUntil: rememberedPace.cooldownUntil,
    nextRequestAt: 0,
    requestGapMs: rememberedPace.gapMs,
    holdSpeedUntil: rememberedPace.holdUntil,
    cleanStreak: 0,
    accelerationBlocked: Date.now() < rememberedPace.holdUntil,
    stats: makeStats(),
    throttleCount: 0,
    readyReported: false,
    inventoryMs: 0,
    hierarchyStartedAt: 0,
    snapshotRows: 0,
    snapshotSource: ''
  };

  function currentSearch() {
    try { return clean(new URL(location.href).searchParams.get('s') || ''); }
    catch { return ''; }
  }

  function searchUrl(value) {
    try {
      const url = new URL(location.href);
      url.search = '';
      url.hash = '';
      url.searchParams.set('s', value);
      return url.href;
    } catch {
      return '';
    }
  }

  function installStartButton() {
    const nav = getInventoryNav();
    if (!nav || !currentSearch()) return false;

    let button = document.getElementById('p-level-overlay-start-btn');
    if (button) {
      if (button.parentElement !== nav) nav.appendChild(button);
      return true;
    }

    injectStyles();

    button = document.createElement('button');
    button.id = 'p-level-overlay-start-btn';
    button.dataset.fcrToolUi = '1';
    button.type = 'button';
    button.textContent = 'P-level overlay sorter';
    Object.assign(button.style, {
      order: '5',
      backgroundColor: 'orange',
      color: 'black',
      marginLeft: '8px',
      padding: '6px 10px',
      borderRadius: '6px',
      fontWeight: '700',
      cursor: 'pointer',
      border: '1px solid #92400E'
    });

    const overlay = document.getElementById('pLevelOverlay');
    if (overlay) {
      button.hidden = !overlay.hidden;
      if (overlay.hidden) button.textContent = 'Show P-level overlay';
    }

    button.addEventListener('click', () => {
      usage('open');
      button.hidden = true;
      buildOverlay();
      void loadSnapshot();
    });

    nav.appendChild(button);
    return true;
  }

  function start() {
    const liteMode = location.hash.startsWith('#fcr-lite');

    if (!liteMode) {
      if (installStartButton()) return;

      const observer = new MutationObserver(() => {
        if (!installStartButton()) return;
        observer.disconnect();
      });

      observer.observe(document.documentElement, { childList: true, subtree: true });
      window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
      return;
    }

    let observer = null;
    let scheduled = false;

    const reconcile = () => {
      scheduled = false;
      installStartButton();
    };

    const scheduleReconcile = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(reconcile);
    };

    const attach = () => {
      const liteRoot = document.getElementById('fcratc-root');
      if (!liteRoot) return false;

      installStartButton();

      observer = new MutationObserver(records => {
        if (!records.some(record => record.type === 'childList')) return;
        scheduleReconcile();
      });

      observer.observe(liteRoot, { childList: true, subtree: true });
      return true;
    };

    if (!attach()) {
      const bootstrap = new MutationObserver(() => {
        if (!attach()) return;
        bootstrap.disconnect();
      });
      bootstrap.observe(document.documentElement, { childList: true, subtree: true });
      window.addEventListener('pagehide', () => bootstrap.disconnect(), { once: true });
    }

    window.addEventListener('pagehide', () => {
      observer?.disconnect();
      observer = null;
    }, { once: true });
  }

  function getInventoryNav() {
    let nav = document.getElementById('inventory-nav');
    if (!nav || nav.tagName !== 'A') return nav;

    const replacement = document.createElement('span');
    for (const attribute of nav.attributes) replacement.setAttribute(attribute.name, attribute.value);
    replacement.append(...nav.childNodes);
    nav.replaceWith(replacement);
    return replacement;
  }

  function inventoryIndexes(table) {
    const headers = [...table.querySelectorAll('thead th')].map(th => ({
      id: clean(th.id).toLowerCase(),
      text: clean(th.textContent).replace(/\([\d,]+\)/g, '').trim().toLowerCase()
    }));
    const find = (...names) => headers.findIndex(header => names.includes(header.id) || names.includes(header.text));
    return {
      container: find('inventory-container', 'container'),
      fnsku: find('inventory-fnsku', 'fnsku'),
      fcsku: find('inventory-fcsku', 'fcsku'),
      qty: find('inventory-quantity', 'quantity')
    };
  }

  function rowIsVisible(row) {
    if (!row || row.hidden || row.getAttribute('aria-hidden') === 'true') return false;
    if (row.style?.display === 'none' || row.classList?.contains('filtered-out')) return false;
    if (row.isConnected) {
      try { if (getComputedStyle(row).display === 'none') return false; } catch {}
    }
    return true;
  }

  function dataTableAppliedRows(table) {
    const jq = window.jQuery || window.$;
    try {
      if (!jq?.fn?.dataTable?.isDataTable?.(table)) return null;
      const api = jq(table).DataTable();
      const nodes = api.rows({ search: 'applied' }).nodes().toArray().filter(Boolean);
      return nodes;
    } catch {
      return null;
    }
  }

  function snapshotInventoryRows() {
    const table = document.getElementById('table-inventory');
    if (!table) return { rows: [], source: 'missing-table' };

    const indexes = inventoryIndexes(table);
    if (indexes.container < 0) return { rows: [], source: 'missing-container-column' };

    let source = 'visible-dom';
    let rowNodes = dataTableAppliedRows(table);
    if (rowNodes) source = 'datatable-filter';
    else rowNodes = [...(table.tBodies?.[0]?.rows || [])].filter(rowIsVisible);

    const rows = [];
    for (const row of rowNodes) {
      if (!row?.cells?.length) continue;
      const value = index => index >= 0 ? clean(row.cells[index]?.textContent) : '';
      const container = value(indexes.container);
      if (!container) continue;
      rows.push({
        container,
        fnsku: value(indexes.fnsku),
        fcsku: value(indexes.fcsku),
        qty: Number(value(indexes.qty).replace(/[^\d.-]/g, '')) || 0
      });
    }

    return { rows, source };
  }

  async function loadSnapshot() {
    resetRun();
    const runId = state.runId;
    setStatusText('Snapshot inventory…');
    const started = performance.now();

    try {
      const snapshot = snapshotInventoryRows();
      if (runId !== state.runId) return;

      state.inventoryMs = Math.max(1, Math.round(performance.now() - started));
      state.snapshotRows = snapshot.rows.length;
      state.snapshotSource = snapshot.source;

      if (snapshot.source === 'missing-table') {
        setStatusText('Inventory table not ready');
        trace('BIN_OVERLAY_ERROR', { stage: 'snapshot', message: 'Inventory table not ready' });
        return;
      }
      if (snapshot.source === 'missing-container-column') {
        setStatusText('Inventory Container column not found');
        trace('BIN_OVERLAY_ERROR', { stage: 'snapshot', message: 'Inventory Container column not found' });
        return;
      }

      for (const row of snapshot.rows) {
        const record = makeInventoryRecord(row);
        if (!record) continue;

        state.totalRows++;
        state.rows.push(record);
        if (!state.podBuckets.has(record.pod)) state.podBuckets.set(record.pod, []);
        state.podBuckets.get(record.pod).push(record);
      }

      state.totalPods = state.podBuckets.size;
      usage('inventory.snapshot', state.inventoryMs);
      trace('BIN_OVERLAY_INVENTORY', {
        source: snapshot.source,
        ms: state.inventoryMs,
        inventoryRows: snapshot.rows.length,
        podRows: state.totalRows,
        pods: state.totalPods,
        scope: 'filtered-inventory'
      });

      refreshOverlay();

      if (!state.totalPods) {
        setStatusText(`Snapshot ${state.snapshotRows} rows • no P-level bins`);
        return;
      }

      state.hierarchyStartedAt = performance.now();

      for (const pod of state.podBuckets.keys()) {
        const cached = readFloorCache(pod);
        state.jobs.set(pod, { status: cached ? 'ready' : 'pending', attempts: 0,
          nextAt: 0, error: '', result: cached || unknownFloor() });
        if (cached) { applyPodResult(pod, cached); state.stats.cacheHits++; }
        else enqueuePod(pod);
      }

      trace('BIN_OVERLAY_SCAN_START', { total: state.totalPods, cacheHits: state.stats.cacheHits,
        networkNeeded: state.totalPods - state.stats.cacheHits,
        gapMs: state.requestGapMs, minGapMs: MIN_REQUEST_GAP_MS,
        maxInFlight: 1, cleanWindow: CLEAN_WINDOW });
      scheduleRefresh();
      pumpQueue();
      updateStatus();
    } catch (error) {
      if (runId !== state.runId) return;
      const message = clean(error?.message || error);
      setStatusText(`ERROR • ${message}`);
      trace('BIN_OVERLAY_ERROR', { stage: 'snapshot', message });
    }
  }

  function makeInventoryRecord(row) {
    const containerText = clean(row?.container);
    const pod = containerText.match(POD_REGEX)?.[0]?.toUpperCase();
    if (!pod) return null;

    const quantityValue = Number(row?.qty) || 0;

    return {
      pod,
      rowId: ++state.rowSequence,
      binType: '',
      binSize: '',
      floorLabel: 'P-',
      floorClass: 'px',
      floorNum: 99,
      containerText,
      containerHref: searchUrl(containerText),
      quantity: String(quantityValue),
      quantityValue,
      fnsku: clean(row?.fnsku),
      fcsku: clean(row?.fcsku)
    };
  }

  function resetRun() {
    state.runId++;
    for (const controller of state.controllers) controller.abort();
    state.controllers.clear();
    clearTimeout(state.pumpTimer);
    clearTimeout(state.refreshTimer);
    state.pumpTimer = null;
    state.refreshTimer = null;
    state.rows.length = 0;
    state.rowSequence = 0;
    state.openDetails.clear();
    state.podBuckets.clear();
    state.jobs.clear();
    state.queue.length = 0;
    state.queued.clear();
    state.activeRequests = 0;
    state.totalPods = 0;
    state.totalRows = 0;
    state.paused = false;
    state.readyReported = false;
    state.cleanStreak = 0;
    state.accelerationBlocked = Date.now() < state.holdSpeedUntil;
    state.stats = makeStats();
    state.inventoryMs = 0;
    state.hierarchyStartedAt = 0;
    state.snapshotRows = 0;
    state.snapshotSource = '';
    // Keep preferences and the shared rate-limit cooldown across snapshots.
    updateControlStates();
    updatePauseButton();
    refreshOverlay();
  }

  function isComplete(result) {
    return Boolean(result?.num && result?.binSize);
  }

  function enqueuePod(pod) {
    if (!pod || state.queued.has(pod)) return;
    state.queued.add(pod);
    state.queue.push(pod);
  }

  function schedulePump(delay) {
    clearTimeout(state.pumpTimer);
    const runId = state.runId;
    state.pumpTimer = setTimeout(() => {
      state.pumpTimer = null;
      if (runId === state.runId) pumpQueue();
    }, Math.max(1, Math.min(delay, 1000)));
  }

  function pumpQueue() {
    clearTimeout(state.pumpTimer);
    state.pumpTimer = null;
    updateStatus();
    if (state.paused || state.activeRequests) return;
    if (!state.queue.length) {
      if (state.totalPods && !state.readyReported) {
        state.readyReported = true;
        const counts = lookupCounts();
        const hierarchyMs = Math.round(performance.now() - state.hierarchyStartedAt);
        usage('hierarchy.complete', hierarchyMs);
        trace('BIN_OVERLAY_READY', { inventoryMs: state.inventoryMs, hierarchyMs,
          rows: state.totalRows, pods: state.totalPods, ...counts });
        trace('BIN_OVERLAY_SCAN_SUMMARY', statsSnapshot());
      }
      return;
    }
    const now = Date.now();
    const allowedAt = Math.max(state.cooldownUntil, state.nextRequestAt);
    if (now < allowedAt) return schedulePump(allowedAt - now);
    // Initial lookups take priority over delayed retries, without blocking the queue.
    let index = state.queue.findIndex(pod => state.jobs.get(pod)?.status === 'pending');
    if (index < 0) index = state.queue.findIndex(pod => state.jobs.get(pod)?.nextAt <= now);
    if (index < 0) {
      const nextAt = Math.min(...state.queue.map(pod => state.jobs.get(pod).nextAt));
      return schedulePump(nextAt - now);
    }
    const [pod] = state.queue.splice(index, 1);
    state.queued.delete(pod);
    void fetchPodFloor(pod);
  }

  function retryAfterMs(value) {
    if (!value) return 0;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : 0;
  }

  async function fetchPodFloor(pod) {
    const runId = state.runId;
    const job = state.jobs.get(pod);
    if (!job) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    state.controllers.add(controller);
    state.activeRequests++;
    job.status = 'loading';
    job.attempts++;
    const startedAt = performance.now();
    const stats = state.stats;
    const sequence = ++stats.requests;
    if (job.attempts > 1) stats.retries++;
    stats.peakInFlight = Math.max(stats.peakInFlight, state.activeRequests);
    trace('BIN_OVERLAY_REQUEST', { pod, sequence, attempt: job.attempts,
      gapMs: state.requestGapMs, inFlight: state.activeRequests,
      startOffsetMs: Math.round(startedAt - state.hierarchyStartedAt) });
    state.nextRequestAt = Date.now() + state.requestGapMs;
    scheduleRefresh();
    let result = job.result;
    let errorMessage = '';
    let httpStatus = 0, responseChars = 0, errorKind = '';
    let parsed = unknownFloor();
    try {
      const response = await fetch(hierarchyUrl(pod), {
        credentials: 'same-origin', cache: 'no-store', signal: controller.signal
      });
      if (runId !== state.runId) return;
      httpStatus = response.status;
      stats.httpStatusCounts[httpStatus] = (stats.httpStatusCounts[httpStatus] || 0) + 1;
      if (response.status === 429) {
        state.throttleCount++;
        stats.throttles++;
        state.cleanStreak = 0;
        state.accelerationBlocked = true;
        state.holdSpeedUntil = Date.now() + 10 * 60 * 1000;
        const previousGapMs = state.requestGapMs;
        state.requestGapMs = Math.min(MAX_REQUEST_GAP_MS, state.requestGapMs * 2);
        const waitMs = Math.max(retryAfterMs(response.headers?.get('Retry-After')),
          Math.min(60000, 10000 * (2 ** Math.min(state.throttleCount - 1, 3))));
        state.cooldownUntil = Math.max(state.cooldownUntil, Date.now() + waitMs);
        savePace(state.requestGapMs);
        trace('BIN_OVERLAY_THROTTLED', { pod, status: 429, waitMs,
          retryAfterMs: retryAfterMs(response.headers?.get('Retry-After')),
          previousGapMs, gapMs: state.requestGapMs, attempt: job.attempts });
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      if (runId !== state.runId) return;
      responseChars = html.length;
      parsed = parseFloor(html);
      // A failed refresh must not erase a previously confirmed field.
      result = {
        ...(parsed.num ? parsed : result),
        binType: parsed.binType || result.binType,
        binSize: parsed.binSize || result.binSize
      };
      if (!isComplete(result)) {
        errorKind = 'incomplete';
        stats.incomplete++;
        errorMessage = !result.num ? 'Floor missing from response'
          : !result.binType ? 'Bin type missing from response'
          : `Size not recognised: ${result.binType}`;
      }
    } catch (error) {
      if (runId !== state.runId) return;
      errorKind = error?.name === 'AbortError' ? 'timeout' : httpStatus >= 400 ? 'http' : 'network';
      errorMessage = error?.name === 'AbortError' ? 'Request timed out' : clean(error?.message || error);
      if (errorKind === 'timeout') stats.timeouts++;
      if (errorKind === 'network') stats.networkErrors++;
    } finally {
      clearTimeout(timeout);
      state.controllers.delete(controller);
      if (runId === state.runId) {
        const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
        stats.completed++;
        stats.durationTotalMs += durationMs;
        if (stats.durations.length < 512) stats.durations.push(durationMs);
        if (!errorMessage) stats.successes++;
        adjustPace(!errorMessage, errorKind, httpStatus);
        finalizePod(pod, result, errorMessage, runId);
        trace('BIN_OVERLAY_RESULT', { pod, sequence, attempt: job.attempts,
          httpStatus, durationMs, responseChars, errorKind,
          floorFound: Boolean(parsed.num), sizeFound: Boolean(parsed.binSize),
          outcome: job.status, willRetry: job.status === 'retry',
          retryInMs: job.status === 'retry' ? Math.max(0, job.nextAt - Date.now()) : 0,
          gapMs: state.requestGapMs });
        if (stats.completed % CLEAN_WINDOW === 0 || Date.now() - stats.lastProgressAt >= 10000) {
          stats.lastProgressAt = Date.now();
          trace('BIN_OVERLAY_SCAN_PROGRESS', statsSnapshot());
        }
        state.activeRequests = Math.max(0, state.activeRequests - 1);
        pumpQueue();
      }
    }
  }

  function makeStats() {
    return { startedAt: Date.now(), lastProgressAt: Date.now(), requests: 0, completed: 0,
      cacheHits: 0, successes: 0, retries: 0, throttles: 0, timeouts: 0,
      networkErrors: 0, incomplete: 0, peakInFlight: 0, durationTotalMs: 0,
      durations: [], httpStatusCounts: {}, pausedMs: 0, pauseStartedAt: 0 };
  }

  function statsSnapshot() {
    const stats = state.stats;
    const durations = stats.durations.slice().sort((a, b) => a - b);
    const elapsedMs = Math.max(0, Date.now() - stats.startedAt);
    return { total: state.totalPods, ...lookupCounts(), requests: stats.requests,
      completed: stats.completed, cacheHits: stats.cacheHits, successes: stats.successes,
      retries: stats.retries, throttles: stats.throttles, timeouts: stats.timeouts,
      networkErrors: stats.networkErrors, incomplete: stats.incomplete,
      httpStatusCounts: { ...stats.httpStatusCounts }, elapsedMs,
      pausedMs: stats.pausedMs + (stats.pauseStartedAt ? Date.now() - stats.pauseStartedAt : 0),
      averageMs: stats.completed ? Math.round(stats.durationTotalMs / stats.completed) : 0,
      p95Ms: durations[Math.max(0, Math.ceil(durations.length * .95) - 1)] || 0,
      requestsPerSecond: elapsedMs ? Math.round(stats.requests * 100000 / elapsedMs) / 100 : 0,
      gapMs: state.requestGapMs, minGapMs: MIN_REQUEST_GAP_MS,
      peakInFlight: stats.peakInFlight, accelerationBlocked: state.accelerationBlocked,
      cooldownMs: Math.max(0, state.cooldownUntil - Date.now()) };
  }

  function readPace() {
    const fallback = { gapMs: REQUEST_GAP_MS, cooldownUntil: 0, holdUntil: 0 };
    try {
      const value = JSON.parse(localStorage.getItem(PACE_KEY) || 'null');
      if (!value || !Number.isFinite(value.ts) || Date.now() < value.ts || Date.now() - value.ts > PACE_TTL_MS
        || !Number.isFinite(value.gapMs) || value.gapMs < MIN_REQUEST_GAP_MS || value.gapMs > MAX_REQUEST_GAP_MS) return fallback;
      return { gapMs: Math.min(MAX_REQUEST_GAP_MS, value.gapMs + 25),
        cooldownUntil: Number.isFinite(value.cooldownUntil) ? value.cooldownUntil : 0,
        holdUntil: Number.isFinite(value.holdUntil) ? value.holdUntil : 0 };
    } catch { return fallback; }
  }

  function savePace(gapMs) {
    try { localStorage.setItem(PACE_KEY, JSON.stringify({ ts: Date.now(), gapMs,
      cooldownUntil: state.cooldownUntil, holdUntil: state.holdSpeedUntil })); } catch {}
  }

  function adjustPace(success, errorKind, httpStatus) {
    if (!success) {
      state.cleanStreak = 0;
      state.accelerationBlocked = true;
      if (httpStatus !== 429) {
        const before = state.requestGapMs;
        state.requestGapMs = Math.min(MAX_REQUEST_GAP_MS, Math.max(REQUEST_GAP_MS, Math.ceil(before * 1.25)));
        state.nextRequestAt = Math.max(state.nextRequestAt, Date.now() + state.requestGapMs);
        savePace(state.requestGapMs);
        trace('BIN_OVERLAY_RATE_CHANGE', { reason: errorKind || 'error', previousGapMs: before,
          gapMs: state.requestGapMs, cleanLookups: 0 });
      }
      return;
    }
    if (++state.cleanStreak < CLEAN_WINDOW) return;
    state.cleanStreak = 0;
    // Save the proven interval before trying a slightly faster one.
    savePace(state.requestGapMs);
    if (state.accelerationBlocked || Date.now() < state.holdSpeedUntil) return;
    const before = state.requestGapMs;
    state.requestGapMs = Math.max(MIN_REQUEST_GAP_MS, before - 25);
    if (before !== state.requestGapMs) trace('BIN_OVERLAY_RATE_CHANGE', {
      reason: 'clean-window', previousGapMs: before, gapMs: state.requestGapMs,
      cleanLookups: CLEAN_WINDOW });
  }

  function lookupCounts() {
    let ready = 0, failed = 0, pending = 0;
    for (const job of state.jobs.values()) {
      if (job.status === 'ready') ready++;
      else if (job.status === 'failed') failed++;
      else pending++;
    }
    return { ready, failed, pending };
  }

  function unresolvedPods() {
    return [...state.jobs].filter(([, job]) => !isComplete(job.result));
  }

  function recheckUnresolved() {
    // Leave in-flight and automatically queued jobs alone; never duplicate a request.
    let count = 0;
    for (const [key, job] of unresolvedPods()) {
      if (job.status !== 'failed' && job.status !== 'ready') continue;
      job.status = 'retry';
      job.attempts = 0;
      job.nextAt = Date.now();
      job.error = '';
      state.podCache.delete(key);
      try { sessionStorage.removeItem(floorCacheKey(key)); } catch {}
      enqueuePod(key);
      count++;
    }
    if (!count) return;
    state.readyReported = false;
    trace('BIN_OVERLAY_RECHECK', { count, scope: 'unresolved' });
    scheduleRefresh();
    pumpQueue();
  }

  function hierarchyUrl(pod) {
    try {
      const url = new URL(location.href);
      url.search = '';
      url.hash = '';
      url.pathname = url.pathname.replace(/\/$/, '') + '/container-hierarchy';
      url.searchParams.set('s', pod);
      return url.href;
    } catch {
      const base = location.href.split('?')[0].replace(/\/$/, '');
      return `${base}/container-hierarchy?s=${encodeURIComponent(pod)}`;
    }
  }

  function parseFloor(html) {
    const documentCopy = new DOMParser().parseFromString(html, 'text/html');

    // Read native field labels so another row cannot shift the values.
    const fields = new Map();
    for (const row of documentCopy.querySelectorAll('tr')) {
      const cells = [...row.children].filter(cell => /^(TH|TD)$/.test(cell.tagName));
      if (cells.length !== 2) continue;
      const label = clean(cells[0].textContent).replace(/:$/, '').toLowerCase();
      if ((label === 'location' || label === 'bin type') && !fields.has(label)) {
        fields.set(label, clean(cells[1].textContent));
      }
    }

    const num = fields.get('location')?.match(/\bfloor\s*:\s*(\d+)\b/i)?.[1] || '';
    const binType = fields.get('bin type') || '';
    const size = binType.match(/^(\d+(?:\.\d+)?)-KIVA(?:-|$)/i)?.[1] || '';
    const binSize = size ? `${Number(size)}"` : '';

    return {
      ...(num ? { num, label: `P${num}`, cls: `p${num}`, floorNum: Number(num) } : unknownFloor()),
      binType,
      binSize
    };
  }

  function unknownFloor() {
    return { num: '', label: 'P-', cls: 'px', floorNum: 99, binType: '', binSize: '' };
  }

  function floorCacheKey(pod) {
    return `bwu2-bin-floor-v2:${pod}`;
  }

  function readFloorCache(pod) {
    // Timestamped successes only; failed or partial lookups never poison the cache.
    let packed = state.podCache.get(pod);
    if (!packed) {
      try { packed = JSON.parse(sessionStorage.getItem(floorCacheKey(pod)) || 'null'); }
      catch { return null; }
    }
    if (!packed?.ts || Date.now() - packed.ts > FLOOR_CACHE_TTL || !isComplete(packed.value)) {
      state.podCache.delete(pod);
      try { sessionStorage.removeItem(floorCacheKey(pod)); } catch {}
      return null;
    }
    state.podCache.set(pod, packed);
    return packed.value;
  }

  function writeFloorCache(pod, value) {
    if (!isComplete(value)) return;
    const packed = { ts: Date.now(), value };
    state.podCache.set(pod, packed);
    try { sessionStorage.setItem(floorCacheKey(pod), JSON.stringify(packed)); } catch {}
  }

  function finalizePod(pod, result, error = '', runId = state.runId) {
    if (runId !== state.runId) return;
    const job = state.jobs.get(pod);
    if (!job) return;
    job.result = result;
    job.error = error;
    if (!error && isComplete(result)) {
      job.status = 'ready';
      writeFloorCache(pod, result);
    } else if (job.attempts < MAX_ATTEMPTS) {
      job.status = 'retry';
      job.nextAt = Math.max(state.cooldownUntil, Date.now() + 10000 * (2 ** (job.attempts - 1)));
      enqueuePod(pod);
    } else {
      job.status = 'failed';
    }
    if (error) trace('BIN_OVERLAY_LOOKUP_FAILED', { pod, error,
      attempt: job.attempts, willRetry: job.status === 'retry' });
    applyPodResult(pod, result);
    scheduleRefresh();
    updateStatus();
  }

  function applyPodResult(pod, result) {
    for (const record of state.podBuckets.get(pod) || []) {
      record.binType = result.binType || '';
      record.binSize = result.binSize || '';
      record.floorLabel = result.label;
      record.floorClass = result.cls;
      record.floorNum = result.floorNum;
    }
  }

  function readPreferences() {
    try {
      const value = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || 'null');
      if (value && Array.isArray(value.floors) && value.floors.every(floor => FLOOR_FILTERS.includes(floor))) {
        return { floors: value.floors, sort: value.sort === 'DEFAULT' ? 'FLOOR_ASC'
          : SORTS.includes(value.sort) ? value.sort : 'FLOOR_DESC' };
      }
    } catch {}
    return { floors: FLOOR_FILTERS.slice(), sort: 'FLOOR_DESC' };
  }

  function savePreferences() {
    try { localStorage.setItem(PREFERENCES_KEY,
      JSON.stringify({ floors: [...state.selectedFloors], sort: state.sort })); } catch {}
  }

  function toggleFloor(floor) {
    if (floor === 'ALL') state.selectedFloors = new Set(FLOOR_FILTERS);
    else if (FLOOR_FILTERS.includes(floor)) {
      if (state.selectedFloors.has(floor)) state.selectedFloors.delete(floor);
      else state.selectedFloors.add(floor);
    }
    savePreferences();
    updateControlStates();
    refreshOverlay();
  }

  function buildOverlay() {
    const existing = document.getElementById('pLevelOverlay');
    if (existing) {
      existing.hidden = false;
      return;
    }

    state.overlayBuilt = true;

    const overlay = document.createElement('div');
    overlay.id = 'pLevelOverlay';
    overlay.dataset.fcrToolUi = '1';

    overlay.innerHTML = `
      <div id="pLevelOverlayHeader">
        <div id="pLevelOverlaySummary"><span id="pLevelOverlayTitle">Bin check</span><span class="p-level-version">v${VERSION}</span></div>
        <div id="pLevelOverlayActions">
          <button type="button" id="pLevelPauseBtn">Pause</button>
          <button type="button" id="pLevelCloseBtn">Hide</button>
        </div>
      </div>
      <div id="pLevelOverlayBody">
        <div id="pLevelOverlayStatus" role="status" aria-live="polite">Snapshot ready</div>
        <div id="pLevelProgress" role="progressbar" aria-label="Bins with floor and size loaded" aria-valuemin="0" aria-valuemax="1" aria-valuenow="0"><span></span></div>
        <div id="pLevelOverlayControls" aria-label="Visible floors">
          <button type="button" data-filter="ALL">All</button>
          <button type="button" data-filter="P4">P4</button>
          <button type="button" data-filter="P3">P3</button>
          <button type="button" data-filter="P2">P2</button>
          <button type="button" data-filter="P1">P1</button>
          <button type="button" data-filter="OTHER" title="Unknown locations and other floors">Other / ?</button>
        </div>
        <div id="pLevelSizeLegend" aria-label="Bin size shades from smallest to largest"><span>Small → large</span>${['6', '9', '11', '14', '18.5'].map(size => `<span class="p-size-badge ${sizeBadgeClass(size)}">${size}&quot;</span>`).join('')}</div>
        <div class="p-level-table-wrap"><table id="pLevelOverlayTable">
          <thead><tr>
            <th scope="col" data-sort-column="FLOOR" aria-sort="none"><button type="button" data-sort-key="FLOOR">Floor ↕</button></th>
            <th scope="col">Container</th>
            <th scope="col" data-sort-column="SIZE" aria-sort="none"><button type="button" data-sort-key="SIZE">Size ↕</button></th>
            <th scope="col">FcSKU</th>
            <th scope="col" data-sort-column="QTY" aria-sort="none"><button type="button" data-sort-key="QTY">Qty ↕</button></th>
          </tr></thead><tbody></tbody>
        </table></div>
      </div>
      <div id="pLevelOverlayFooter">
        <span class="p-level-muted" id="pLevelOverlayHint">Details shows FNSKU</span>
        <div class="p-level-footer-actions">
          <button type="button" id="pLevelRecheckBtn" disabled>Recheck unresolved (0)</button>
          <button type="button" id="pLevelLazyBtn" title="Copies all scanned floors regardless of display filters; unresolved floors are omitted">Lazy copy</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    document.getElementById('pLevelCloseBtn').addEventListener('click', () => {
      overlay.hidden = true;
      const startButton = document.getElementById('p-level-overlay-start-btn');
      if (startButton) {
        startButton.hidden = false;
        startButton.textContent = 'Show P-level overlay';
      }
    });

    document.getElementById('pLevelRecheckBtn').addEventListener('click', () => recheckUnresolved());

    document.getElementById('pLevelPauseBtn').addEventListener('click', () => {
      state.paused = !state.paused;
      if (state.paused) state.stats.pauseStartedAt = Date.now();
      else if (state.stats.pauseStartedAt) {
        state.stats.pausedMs += Date.now() - state.stats.pauseStartedAt;
        state.stats.pauseStartedAt = 0;
      }
      trace('BIN_OVERLAY_PAUSE', { paused: state.paused });
      updatePauseButton();
      updateStatus();
      if (!state.paused) pumpQueue();
    });

    document.getElementById('pLevelOverlayControls').addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button) return;

      if (button.dataset.filter) toggleFloor(button.dataset.filter);

      updateControlStates();
      refreshOverlay();
    });

    document.getElementById('pLevelLazyBtn').addEventListener('click', copyLazyBinCheck);
    document.querySelector('#pLevelOverlayTable thead').addEventListener('click', event => {
      const button = event.target.closest('button[data-sort-key]');
      if (button) sortByHeader(button.dataset.sortKey);
    });
    updateControlStates();
    refreshOverlay();
  }

  function sortByHeader(key) {
    if (!['FLOOR', 'SIZE', 'QTY'].includes(key)) return;
    state.sort = state.sort === `${key}_DESC` ? `${key}_ASC` : `${key}_DESC`;
    savePreferences();
    updateControlStates();
    refreshOverlay();
  }

  function updateControlStates() {
    document.querySelectorAll('#pLevelOverlayControls [data-filter]').forEach(button => {
      const active = button.dataset.filter === 'ALL'
        ? FLOOR_FILTERS.every(floor => state.selectedFloors.has(floor))
        : state.selectedFloors.has(button.dataset.filter);
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    document.querySelectorAll('#pLevelOverlayTable [data-sort-column]').forEach(header => {
      const key = header.dataset.sortColumn;
      const active = state.sort.startsWith(`${key}_`);
      const descending = state.sort.endsWith('_DESC');
      header.setAttribute('aria-sort', active ? descending ? 'descending' : 'ascending' : 'none');
      const button = header.querySelector('button');
      button.classList.toggle('active-sort', active);
      const label = { FLOOR: 'Floor', SIZE: 'Size', QTY: 'Qty' }[key];
      button.textContent = `${label} ${active ? descending ? '↓' : '↑' : '↕'}`;
      button.setAttribute('aria-label', `Sort ${label}: ${active && descending ? 'smallest to largest' : 'largest to smallest'}`);
    });
  }

  function visibleRows() {
    const rows = state.rows.filter(row => state.selectedFloors.has(
      FLOOR_FILTERS.includes(row.floorLabel) ? row.floorLabel : 'OTHER'));
    const key = state.sort.split('_')[0];
    const direction = state.sort.endsWith('_DESC') ? -1 : 1;
    const numberFor = row => key === 'SIZE' ? Number.parseFloat(row.binSize)
      : key === 'QTY' ? row.quantityValue : row.floorNum === 99 ? NaN : row.floorNum;
    return rows.sort((a, b) => {
      const av = numberFor(a), bv = numberFor(b);
      const aKnown = Number.isFinite(av), bKnown = Number.isFinite(bv);
      if (aKnown !== bKnown) return aKnown ? -1 : 1;
      if (aKnown && av !== bv) return (av - bv) * direction;
      return (a.floorNum - b.floorNum) || a.containerText.localeCompare(b.containerText);
    });
  }

  function scheduleRefresh() {
    if (state.refreshTimer) return;

    state.refreshTimer = setTimeout(() => {
      state.refreshTimer = null;
      refreshOverlay();
    }, 120);
  }

  function refreshOverlay() {
    if (!state.overlayBuilt) return;
    const tbody = document.querySelector('#pLevelOverlayTable tbody');
    if (!tbody) return;

    const rows = visibleRows();
    tbody.replaceChildren();

    if (!rows.length) {
      const hint = document.getElementById('pLevelOverlayHint');
      if (hint) hint.textContent = '0 shown • Lazy copy uses all scanned floors';
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.className = 'p-level-muted';
      cell.textContent = state.rows.length ? 'No bins match your floor toggles.' : 'No rows yet.';
      row.appendChild(cell);
      tbody.appendChild(row);
      updateStatus();
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const record of rows) {
      fragment.appendChild(renderRow(record));
      if (state.openDetails.has(record.rowId)) fragment.appendChild(renderDetailsRow(record));
    }
    const hint = document.getElementById('pLevelOverlayHint');
    if (hint) hint.textContent = `${rows.length} shown • Bin: FNSKU details • ↗: FCResearch`;
    tbody.appendChild(fragment);
    updateStatus();
  }

  function sizeBadgeClass(value) {
    const size = String(value || '').replace(/"/g, '');
    return ['6', '9', '11', '14', '18.5'].includes(size) ? `p-size-${size.replace('.', '-')}` : 'p-size-unknown';
  }

  function renderRow(record) {
    const row = document.createElement('tr');
    const floorCell = document.createElement('td');
    const floorPill = document.createElement('span');
    floorPill.className = `p-sort-pill ${record.floorClass}`;
    floorPill.textContent = record.floorLabel;
    floorCell.appendChild(floorPill);
    const containerCell = document.createElement('td');
    const container = document.createElement('button');
    container.type = 'button';
    container.className = 'p-level-copy';
    container.id = `p-bin-toggle-${state.runId}-${record.rowId}`;
    container.textContent = record.containerText;
    container.setAttribute('aria-expanded', String(state.openDetails.has(record.rowId)));
    container.setAttribute('aria-controls', `p-bin-detail-${state.runId}-${record.rowId}`);
    container.addEventListener('click', () => {
      if (state.openDetails.has(record.rowId)) state.openDetails.delete(record.rowId);
      else state.openDetails.add(record.rowId);
      refreshOverlay();
      document.getElementById(container.id)?.focus({ preventScroll: true });
    });
    containerCell.appendChild(container);
    if (record.containerHref) {
      const link = document.createElement('a');
      link.className = 'p-level-open';
      link.textContent = '↗';
      link.href = record.containerHref;
      link.target = '_blank';
      link.rel = 'noopener';
      link.setAttribute('aria-label', `Open ${record.containerText} in FCResearch`);
      link.title = 'Open in FCResearch';
      containerCell.appendChild(link);
    }
    const job = state.jobs.get(record.pod);
    if (job && job.status !== 'ready') {
      const note = document.createElement('span');
      note.className = 'p-level-issue';
      note.textContent = job.status === 'failed' ? '⚠ Unresolved'
        : job.status === 'retry' ? '… Auto retry queued' : '… Loading';
      note.title = job.error || 'Waiting for floor and size';
      containerCell.appendChild(note);
      if (job.status === 'failed') row.className = 'p-level-unresolved';
    }
    const sizeCell = document.createElement('td');
    const sizeBadge = document.createElement('span');
    sizeBadge.className = `p-size-badge ${sizeBadgeClass(record.binSize)}`;
    sizeBadge.textContent = record.binSize || '—';
    sizeCell.title = record.binType || 'Bin size unavailable';
    sizeCell.appendChild(sizeBadge);
    row.append(floorCell, containerCell, sizeCell, textCell(record.fcsku || '—'), textCell(record.quantity));
    return row;
  }

  function renderDetailsRow(record) {
    const row = document.createElement('tr');
    row.id = `p-bin-detail-${state.runId}-${record.rowId}`;
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.className = 'p-level-detail';
    cell.textContent = `FNSKU: ${record.fnsku || 'Unavailable'}${record.binType ? ` • ${record.binType}` : ''}`;
    row.appendChild(cell);
    return row;
  }

  function textCell(value) {
    const cell = document.createElement('td');
    cell.textContent = value;
    return cell;
  }

  function updatePauseButton() {
    const button = document.getElementById('pLevelPauseBtn');
    if (!button) return;

    button.textContent = state.paused ? 'Resume' : 'Pause';
    button.classList.toggle('paused', state.paused);
  }

  function setStatusText(text) {
    const status = document.getElementById('pLevelOverlayStatus');
    if (status) status.textContent = text;
  }

  function updateStatus() {
    const counts = lookupCounts();
    const unresolved = unresolvedPods().length;
    const recheck = document.getElementById('pLevelRecheckBtn');
    if (recheck) {
      recheck.disabled = !unresolved || Boolean(counts.pending) || state.paused;
      recheck.textContent = `Recheck unresolved (${unresolved})`;
      recheck.title = counts.pending ? 'Automatic checks are still running; pending jobs are not duplicated'
        : 'Recheck every bin missing its floor or size, including hidden floors';
    }
    const progress = document.getElementById('pLevelProgress');
    if (progress) {
      progress.setAttribute('aria-valuemax', String(state.totalPods || 1));
      progress.setAttribute('aria-valuenow', String(counts.ready));
      progress.querySelector('span').style.width = `${state.totalPods ? counts.ready / state.totalPods * 100 : 0}%`;
    }
    if (!state.totalPods && state.snapshotSource) {
      setStatusText(`Snapshot ${state.snapshotRows} rows • no P-level bins`);
      return;
    }
    const cooldown = Math.ceil((state.cooldownUntil - Date.now()) / 1000);
    const phase = state.paused ? ' • Paused'
      : cooldown > 0 && counts.pending ? ` • Rate limit: ${cooldown}s` : '';
    setStatusText(`${counts.ready}/${state.totalPods} loaded • ${counts.pending} pending • ${counts.failed} unresolved${phase}`);
  }

  function copyLazyBinCheck() {
    usage('copy');

    if (!state.rows.length) return flashButton('pLevelLazyBtn', 'No bins');

    if (lookupCounts().pending) {
      return flashButton('pLevelLazyBtn', 'Wait for scan');
    }

    const rowsByFnsku = new Map();

    for (const row of state.rows) {
      const fnsku = cleanCopyField(row.fnsku || row.fcsku);
      if (!fnsku) continue;

      if (!rowsByFnsku.has(fnsku)) rowsByFnsku.set(fnsku, []);
      rowsByFnsku.get(fnsku).push(row);
    }

    if (!rowsByFnsku.size) return flashButton('pLevelLazyBtn', 'No FNSKU');

    const lines = [];

    for (const [fnsku, rows] of rowsByFnsku) {
      const bins = FLOORS.map(floor => highestQuantityBin(rows, floor));
      lines.push([fnsku, ...bins].map(cleanCopyField).join('\t'));
    }

    copyText(lines.join('\n'), 'pLevelLazyBtn');
  }

  function highestQuantityBin(rows, floor) {
    return rows
      .filter(row => row.floorLabel === floor && row.containerText)
      .sort((a, b) => (b.quantityValue - a.quantityValue) || a.containerText.localeCompare(b.containerText))[0]
      ?.containerText || '';
  }

  function copyText(text, buttonId) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.readOnly = true;

    Object.assign(textarea.style, {
      position: 'fixed',
      left: '-9999px',
      top: '0',
      opacity: '0'
    });

    document.body.appendChild(textarea);
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    let copied = false;
    try { copied = document.execCommand('copy'); } catch {}
    textarea.remove();

    if (copied) return flashButton(buttonId, 'Copied');

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => flashButton(buttonId, 'Copied'))
        .catch(() => window.prompt('Copy rows:', text));
      return;
    }

    window.prompt('Copy rows:', text);
  }

  function flashButton(id, message) {
    const button = document.getElementById(id);
    if (!button) return;

    const original = button.textContent;
    button.textContent = message;
    setTimeout(() => { button.textContent = original; }, 1000);
  }

  function cleanCopyField(value) {
    return String(value || '')
      .replace(/\r?\n|\t/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function injectStyles() {
    if (document.getElementById('p-level-overlay-style')) return;

    const style = document.createElement('style');
    style.id = 'p-level-overlay-style';
    style.textContent = `
      #pLevelOverlay{position:fixed;right:14px;bottom:14px;width:670px;max-width:calc(100vw - 28px);max-height:78vh;z-index:999999;background:#fff;color:#172033;border:1px solid #cbd5e1;border-radius:12px;box-shadow:0 12px 35px #16233a35;font:13px/1.45 Arial,Helvetica,sans-serif;display:flex;flex-direction:column;overflow:hidden}
      #pLevelOverlay *{box-sizing:border-box}
      #pLevelOverlay[hidden]{display:none}
      #pLevelOverlayHeader{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-shrink:0;background:#152033;color:#f3f6fc;padding:12px 16px}
      #pLevelOverlaySummary,#pLevelOverlayActions,.p-level-footer-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
      #pLevelOverlayTitle{font-size:17px;font-weight:600}.p-level-version{font-size:11px;color:#b6c4d7}
      #pLevelOverlay button{font:inherit;font-weight:500;cursor:pointer;border:1px solid #d3dbe5;border-radius:6px;padding:7px 10px;background:#fff;color:#172033}
      #pLevelOverlay button:hover{background:#f1f5f9}
      #pLevelOverlay button:disabled{cursor:default;opacity:.5}
      #pLevelOverlayHeader button{background:#ffffff12;color:#f3f6fc;border-color:#ffffff3a;padding:6px 10px}
      #pLevelOverlayHeader button:hover{background:#ffffff25}
      #pLevelOverlayBody{padding:14px 16px 0;overflow:auto;min-height:0;flex:1}
      #pLevelOverlayStatus{font-size:12px;margin-bottom:8px;font-weight:500;overflow-wrap:anywhere}
      #pLevelProgress{height:4px;background:#eef2f7;border-radius:8px;overflow:hidden;margin-bottom:15px}
      #pLevelProgress span{height:100%;display:block;background:#1766ae;border-radius:8px;transition:width .15s}
      #pLevelOverlayControls{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
      #pLevelOverlayControls button{padding:5px 9px;font-size:12px;background:#f1f5f9;color:#586579}
      #pLevelOverlayControls button.active{background:#172033;border-color:#172033;color:#fff}
      #pLevelSizeLegend{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:13px;font-size:11px;color:#5d697c}
      #pLevelSizeLegend>span:first-child{margin-right:4px}
      #pLevelSizeLegend .p-size-badge{min-width:38px;padding:3px 7px}
      .p-level-table-wrap{overflow-x:auto}
      #pLevelOverlayTable{width:100%;border-collapse:collapse;font-size:12px}
      #pLevelOverlayTable th,#pLevelOverlayTable td{padding:10px 6px;text-align:left;vertical-align:middle;white-space:nowrap;border-bottom:1px solid #e0e6ee}
      #pLevelOverlayTable th{position:sticky;top:0;background:#f4f7fb;z-index:1;padding:0 6px;height:39px;font-size:11px;color:#5d697c;font-weight:500}
      #pLevelOverlayTable th button{padding:10px 0;background:transparent;border:0;border-radius:0;color:#5d697c;font-size:12px;white-space:nowrap}
      #pLevelOverlayTable th button.active-sort{color:#172033;font-weight:600}
      #pLevelOverlayTable th button:hover{background:transparent;color:#172033}
      #pLevelOverlayTable th:last-child,#pLevelOverlayTable td:last-child{text-align:right;font-variant-numeric:tabular-nums}
      #pLevelOverlayTable td:nth-child(4){font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace}
      #pLevelOverlayTable tr:hover{background:#f8fafc}
      .p-sort-pill{display:inline-flex;align-items:center;justify-content:center;padding:3px 8px;border-radius:5px;background:#f1f5f9;color:#172033;box-shadow:inset 0 0 0 1px #dce3ec;font-weight:600;font-size:12px;min-width:32px}
      .p-sort-pill.px{color:#5d697c}
      .p-size-badge{display:inline-flex;align-items:center;justify-content:center;padding:5px 8px;border-radius:5px;min-width:48px;font-size:12px;font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums}
      .p-size-6{background:#e7f1ff;color:#17365f}.p-size-9{background:#bdd7f5;color:#16355c}.p-size-11{background:#82afe2;color:#102e50}.p-size-14{background:#386fae;color:#fff}.p-size-18-5{background:#16457a;color:#fff}.p-size-unknown{background:#f1f5f9;color:#5d697c}
      #pLevelOverlay .p-level-copy{font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;border:0;background:transparent;color:#1766ae;padding:0;font-weight:600}
      #pLevelOverlay .p-level-copy:hover{text-decoration:underline;background:transparent}
      .p-level-open{margin-left:5px;color:#5d697c;text-decoration:none;font-size:14px}
      .p-level-issue{display:block;font-size:11px;color:#735113;margin-top:3px;white-space:normal}
      #pLevelOverlayTable .p-level-unresolved{background:#fff5df}
      #pLevelOverlayTable .p-level-detail{white-space:normal;overflow-wrap:anywhere;background:#f4f7fb;color:#5d697c;font:12px/1.45 Arial,Helvetica,sans-serif}
      #pLevelOverlayFooter{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px;background:#f4f7fb;border-top:1px solid #e0e6ee;flex-shrink:0}
      #pLevelLazyBtn{background:#172033!important;color:#fff!important;border-color:#172033!important}
      .p-level-muted{color:#5d697c;font-size:11px}
      @media(max-width:480px){#pLevelOverlayBody{padding:12px 10px 0}#pLevelOverlayHeader,#pLevelOverlayFooter{padding:12px 10px}#pLevelOverlayTable th,#pLevelOverlayTable td{padding-left:4px;padding-right:4px}}
      @media(pointer:coarse){#pLevelOverlay button{min-height:44px}#pLevelOverlay .p-level-copy{min-height:40px}.p-level-open{display:inline-flex;align-items:center;justify-content:center;min-height:40px;min-width:30px}}
      @media(prefers-reduced-motion:reduce){#pLevelProgress span{transition:none}}
    `;

    document.head.appendChild(style);
  }

  start();
})();

