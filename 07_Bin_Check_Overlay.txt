// ==UserScript==
// @name         TEST v7.4.3 Bin check Overlay — Filter Snapshot
// @namespace    https://github.com/1Sirkkris
// @version      7.4.3
// @description  Snapshots the current filtered FCResearch Inventory view and resolves floor locations for matching P-level containers.
// @include      /^https?:\/\/.*fcresearch.*\//
// @include      /^https?:\/\/qifcr\.fe\.aftx\.amazonoperations\.app\//
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Bin_Check_Overlay.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Bin_Check_Overlay.user.js
// ==/UserScript==

(() => {
  'use strict';

  if (window.__binOverlay_v743test || location.hash.startsWith('#fcr-tote-checker')) return;
  window.__binOverlay_v743test = true;

  const VERSION = '7.4.3';
  const POD_REGEX = /\bP-\d-(?:[A-Z]\d{3}){2}\b/i;
  const FLOORS = ['P2', 'P3', 'P4'];
  const RETRY_DELAY_MS = 2500;
  const MAX_RETRIES = 1;
  const MAX_CONCURRENT_REQUESTS = 12;
  const FLOOR_CACHE_TTL = 30 * 60 * 1000;

  function clean(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function usage(key, ms = 0, count = 1) {
    window.dispatchEvent(new CustomEvent('fcr-usage:event', {
      detail: JSON.stringify({ key: 'overlay.' + key, ms, count })
    }));
  }

  function trace(type, data = {}) {
    try {
      if (typeof window.BWU2Trace === 'function') window.BWU2Trace(type, data);
      else window.postMessage({ __BWU2_TRACE__: true, type, data }, '*');
    } catch {}
  }

  const state = {
    rows: [],
    podBuckets: new Map(),
    podCache: new Map(),
    attempts: new Map(),
    queue: [],
    queued: new Set(),
    activeRequests: 0,
    processedPods: 0,
    totalPods: 0,
    totalRows: 0,
    filter: 'ALL',
    sort: 'DEFAULT',
    paused: false,
    overlayBuilt: false,
    refreshTimer: null,
    runId: 0,
    controllers: new Set(),
    retryTimers: new Set(),
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
        if (cached) {
          state.podCache.set(pod, cached);
          applyPodResult(pod, cached);
          state.processedPods++;
        } else {
          enqueuePod(pod);
        }
      }

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
      floorLabel: '',
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

    for (const timer of state.retryTimers) clearTimeout(timer);
    state.retryTimers.clear();

    state.rows.length = 0;
    state.podBuckets.clear();
    state.attempts.clear();
    state.queue.length = 0;
    state.queued.clear();
    state.activeRequests = 0;
    state.processedPods = 0;
    state.totalPods = 0;
    state.totalRows = 0;
    state.filter = 'ALL';
    state.sort = 'DEFAULT';
    state.paused = false;
    state.inventoryMs = 0;
    state.hierarchyStartedAt = 0;
    state.snapshotRows = 0;
    state.snapshotSource = '';

    updateControlStates();
    updatePauseButton();
    refreshOverlay();
  }

  function enqueuePod(pod) {
    if (!pod || state.queued.has(pod)) return;
    state.queued.add(pod);
    state.queue.push(pod);
  }

  function pumpQueue() {
    if (state.paused) {
      updateStatus();
      return;
    }

    while (state.activeRequests < MAX_CONCURRENT_REQUESTS && state.queue.length) {
      const pod = state.queue.shift();
      state.queued.delete(pod);
      fetchPodFloor(pod);
    }

    if (!state.queue.length && state.activeRequests === 0 && state.totalPods && state.processedPods >= state.totalPods) {
      const hierarchyMs = state.hierarchyStartedAt
        ? Math.round(performance.now() - state.hierarchyStartedAt)
        : 0;

      usage('hierarchy.complete', hierarchyMs);
      trace('BIN_OVERLAY_READY', {
        inventoryMs: state.inventoryMs,
        hierarchyMs,
        rows: state.totalRows,
        pods: state.totalPods,
        snapshotRows: state.snapshotRows,
        snapshotSource: state.snapshotSource
      });
    }
  }

  function fetchPodFloor(pod) {
    const runId = state.runId;
    const controller = new AbortController();

    state.controllers.add(controller);
    state.activeRequests++;

    fetch(hierarchyUrl(pod), {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal
    })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then(html => {
        if (runId !== state.runId) return;
        const result = parseFloor(html);

        if (!result.num && scheduleRetry(pod, runId)) return;
        finalizePod(pod, result, runId);
      })
      .catch(error => {
        if (runId !== state.runId || error?.name === 'AbortError') return;
        if (scheduleRetry(pod, runId)) return;
        finalizePod(pod, unknownFloor(), runId);
      })
      .finally(() => {
        state.controllers.delete(controller);
        if (runId !== state.runId) return;
        state.activeRequests = Math.max(0, state.activeRequests - 1);
        pumpQueue();
      });
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

  function scheduleRetry(pod, runId = state.runId) {
    const attempts = state.attempts.get(pod) || 0;
    if (attempts >= MAX_RETRIES) return false;

    state.attempts.set(pod, attempts + 1);

    const timer = setTimeout(() => {
      state.retryTimers.delete(timer);
      if (runId !== state.runId) return;
      enqueuePod(pod);
      pumpQueue();
    }, RETRY_DELAY_MS);

    state.retryTimers.add(timer);
    return true;
  }

  function parseFloor(html) {
    const documentCopy = new DOMParser().parseFromString(html, 'text/html');

    const cell = documentCopy.querySelector(
      'div.a-span6:nth-child(1) > table:nth-child(1) > tbody:nth-child(1) > tr:nth-child(4) > td:nth-child(2)'
    );

    const raw = (cell?.textContent || '').split(',')[0];
    const num = raw.match(/\b(\d+)\b/)?.[1] || '';

    return num
      ? { num, label: `P${num}`, cls: `p${num}`, floorNum: Number(num) }
      : unknownFloor();
  }

  function unknownFloor() {
    return { num: '', label: 'P-', cls: 'px', floorNum: 99 };
  }

  function floorCacheKey(pod) {
    return `bwu2-bin-floor-v1:${pod}`;
  }

  function readFloorCache(pod) {
    if (state.podCache.has(pod)) return state.podCache.get(pod);

    try {
      const raw = sessionStorage.getItem(floorCacheKey(pod));
      if (!raw) return null;
      const packed = JSON.parse(raw);

      if (!packed?.ts || Date.now() - packed.ts > FLOOR_CACHE_TTL) {
        sessionStorage.removeItem(floorCacheKey(pod));
        return null;
      }

      return packed.value || null;
    } catch {
      return null;
    }
  }

  function writeFloorCache(pod, value) {
    if (!value?.num) return;
    try {
      sessionStorage.setItem(floorCacheKey(pod), JSON.stringify({ ts: Date.now(), value }));
    } catch {}
  }

  function finalizePod(pod, result, runId = state.runId) {
    if (runId !== state.runId) return;

    state.podCache.set(pod, result);
    writeFloorCache(pod, result);
    applyPodResult(pod, result);
    state.processedPods++;

    scheduleRefresh();
    updateStatus();
  }

  function applyPodResult(pod, result) {
    for (const record of state.podBuckets.get(pod) || []) {
      record.floorLabel = result.label;
      record.floorClass = result.cls;
      record.floorNum = result.floorNum;
      state.rows.push(record);
    }
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
        <div id="pLevelOverlaySummary">
          <span id="pLevelOverlayTitle">Overlay v${VERSION}</span>
          <span id="pLevelOverlayStatus">Snapshot ready</span>
        </div>
        <div id="pLevelOverlayActions">
          <button type="button" id="pLevelPauseBtn">Pause</button>
          <button type="button" id="pLevelCloseBtn">Hide</button>
        </div>
      </div>
      <div id="pLevelOverlayBody">
        <div id="pLevelOverlayControls">
          <button type="button" data-filter="ALL" class="active">All</button>
          <button type="button" data-filter="P2" class="p2btn">P2</button>
          <button type="button" data-filter="P3" class="p3btn">P3</button>
          <button type="button" data-filter="P4" class="p4btn">P4</button>
          <button type="button" data-filter="P1" class="p1btn">P1</button>
          <span class="p-level-divider" aria-hidden="true"></span>
          <button type="button" data-sort="DEFAULT" class="active">Floor</button>
          <button type="button" data-sort="QTY_DESC">Qty ↓</button>
          <button type="button" data-sort="QTY_ASC">Qty ↑</button>
          <span class="p-level-divider" aria-hidden="true"></span>
          <button type="button" id="pLevelLazyBtn">Lazy bin check</button>
        </div>
        <div class="p-level-muted" id="pLevelOverlayHint">Uses the Inventory rows matching your current filter at click • P-level location bins only.</div>
        <table id="pLevelOverlayTable">
          <thead><tr><th>Floor</th><th>Container</th><th>Qty</th><th>FNSKU</th><th>FcSku</th></tr></thead>
          <tbody></tbody>
        </table>
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

    document.getElementById('pLevelPauseBtn').addEventListener('click', () => {
      state.paused = !state.paused;
      updatePauseButton();
      updateStatus();
      if (!state.paused) pumpQueue();
    });

    document.getElementById('pLevelOverlayControls').addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button) return;

      if (button.dataset.filter) state.filter = button.dataset.filter;
      if (button.dataset.sort) state.sort = button.dataset.sort;
      if (button.id === 'pLevelLazyBtn') copyLazyBinCheck();

      updateControlStates();
      refreshOverlay();
    });

    refreshOverlay();
  }

  function updateControlStates() {
    document.querySelectorAll('#pLevelOverlayControls [data-filter]').forEach(button => {
      button.classList.toggle('active', button.dataset.filter === state.filter);
    });

    document.querySelectorAll('#pLevelOverlayControls [data-sort]').forEach(button => {
      button.classList.toggle('active', button.dataset.sort === state.sort);
    });
  }

  function visibleRows() {
    const rows = state.filter === 'ALL'
      ? state.rows.slice()
      : state.rows.filter(row => row.floorLabel === state.filter);

    return rows.sort((a, b) => {
      if (state.sort !== 'DEFAULT') {
        const direction = state.sort === 'QTY_ASC' ? 1 : -1;
        const quantityDifference = (a.quantityValue - b.quantityValue) * direction;
        if (quantityDifference) return quantityDifference;
      }

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
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.className = 'p-level-muted';
      cell.textContent = state.totalPods ? 'Loading floors…' : 'No rows yet.';
      row.appendChild(cell);
      tbody.appendChild(row);
      updateStatus();
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const record of rows) fragment.appendChild(renderRow(record));
    tbody.appendChild(fragment);
    updateStatus();
  }

  function renderRow(record) {
    const row = document.createElement('tr');

    const floorCell = document.createElement('td');
    const floorPill = document.createElement('span');
    floorPill.className = `p-sort-pill ${record.floorClass}`;
    floorPill.textContent = record.floorLabel;
    floorCell.appendChild(floorPill);

    const containerCell = document.createElement('td');
    const container = document.createElement(record.containerHref ? 'a' : 'span');
    container.className = 'p-level-copy';
    container.textContent = record.containerText;

    if (record.containerHref) {
      container.href = record.containerHref;
      container.target = '_blank';
      container.rel = 'noopener';
    }

    containerCell.appendChild(container);

    row.append(
      floorCell,
      containerCell,
      textCell(record.quantity),
      textCell(record.fnsku),
      textCell(record.fcsku)
    );

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
    const status = document.getElementById('pLevelOverlayStatus');
    if (!status) return;

    const loaded = state.processedPods;
    const total = state.totalPods;
    const remaining = Math.max(total - loaded, 0);

    if (!total && state.snapshotSource) {
      status.textContent = `Snapshot ${state.snapshotRows} rows • no P-level bins`;
      return;
    }

    status.textContent = `Snapshot ${state.snapshotRows || '-'} rows • ${loaded}/${total} pods • ${remaining} left`;
  }

  function copyLazyBinCheck() {
    usage('copy');

    if (!state.rows.length) return flashButton('pLevelLazyBtn', 'No bins');

    if (state.totalPods && state.processedPods < state.totalPods) {
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
    if (document.getElementById('p-level-overlay-style-v743')) return;

    const style = document.createElement('style');
    style.id = 'p-level-overlay-style-v743';
    style.textContent = `
      #pLevelOverlay{position:fixed;right:14px;bottom:14px;width:660px;max-width:calc(100vw - 28px);max-height:78vh;z-index:999999;background:#fff;border:2px solid #111827;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.35);font-family:Arial,Helvetica,sans-serif;color:#111827;overflow:hidden}
      #pLevelOverlay[hidden]{display:none}
      #pLevelOverlayHeader{display:flex;justify-content:space-between;align-items:center;gap:8px;background:#111827;color:#fff;padding:8px 10px;font-weight:800}
      #pLevelOverlaySummary{display:flex;align-items:center;gap:6px;min-width:0;white-space:nowrap}
      #pLevelOverlayTitle{font-size:14px;line-height:1.15}
      #pLevelOverlayStatus{font-size:12px;font-weight:700;opacity:.95}
      #pLevelOverlayActions{display:flex;align-items:center;gap:6px;flex-shrink:0}
      #pLevelOverlayControls{display:flex;flex-wrap:nowrap;align-items:center;gap:4px;white-space:nowrap;overflow-x:auto;scrollbar-width:thin}
      #pLevelOverlay button{cursor:pointer;border:1px solid #374151;border-radius:6px;padding:5px 8px;font-size:12px;font-weight:800;background:#f3f4f6;color:#111827}
      #pLevelOverlayControls button{padding:4px 7px;flex:0 0 auto}
      #pLevelOverlay button:hover{background:#e5e7eb}
      #pLevelOverlay button.active{outline:3px solid #111827;outline-offset:1px}
      #pLevelOverlayBody{padding:9px;overflow:auto;max-height:calc(78vh - 46px)}
      #pLevelOverlayControls{margin-bottom:8px;padding-bottom:2px}
      #pLevelOverlayControls .p-level-divider{width:1px;height:22px;background:#cbd5e1;margin:0 2px;flex:0 0 1px}
      #pLevelOverlayControls .p1btn{background:#F0E442;color:#111}
      #pLevelOverlayControls .p2btn{background:#009E73;color:#fff}
      #pLevelOverlayControls .p3btn{background:#E69F00;color:#111}
      #pLevelOverlayControls .p4btn{background:#0072B2;color:#fff}
      #pLevelPauseBtn.paused{background:#F59E0B;color:#111827;border-color:#92400E}
      #pLevelOverlayHint{margin-bottom:7px}
      #pLevelOverlayTable{width:100%;border-collapse:collapse;font-size:12px}
      #pLevelOverlayTable th,#pLevelOverlayTable td{border-bottom:1px solid #e5e7eb;padding:6px 5px;text-align:left;vertical-align:middle;white-space:nowrap}
      #pLevelOverlayTable th{position:sticky;top:0;background:#f9fafb;z-index:1;font-weight:900}
      #pLevelOverlayTable tr:hover{background:#f3f4f6}
      .p-sort-pill{display:inline-block;min-width:28px;text-align:center;border-radius:7px;padding:3px 7px;font-weight:900;box-shadow:0 0 0 1.5px rgba(0,0,0,.25) inset}
      .p-sort-pill.p1{background:#F0E442;color:#111}.p-sort-pill.p2{background:#009E73;color:#fff}.p-sort-pill.p3{background:#E69F00;color:#111}.p-sort-pill.p4{background:#0072B2;color:#fff}
      .p-sort-pill.px{background:repeating-linear-gradient(135deg,#E5E7EB 0 8px,#CBD5E1 8px 16px);color:#111}
      .p-level-copy{color:#005eb8;font-weight:800;text-decoration:none;cursor:pointer}
      .p-level-muted{color:#6b7280;font-size:12px;font-weight:700}
    `;

    document.head.appendChild(style);
  }

  start();
})();
