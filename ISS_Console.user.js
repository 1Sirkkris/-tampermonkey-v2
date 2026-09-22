// ==UserScript==
// @name         MAIN ISS Console
// @name:en      MAIN ISS Console
// @namespace    https://github.com/1Sirkkris
// @version      0.1.27
// @description  Standalone OEM-style ISS console for EditItems, MoveItems and Sideline.
// @include      /^https?:\/\/.*fcresearch.*\//
// @include      /^https?:\/\/qifcr\.fe\.aftx\.amazonoperations\.app\//
// @run-at       document-start
// @grant        none
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/ISS_Console.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/ISS_Console.user.js
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = '0.1.27';
  const HASH = '#iss-console';
  if (!location.hash.startsWith(HASH)) return;
  if (window.__bwu2IssConsole) return;
  window.__bwu2IssConsole = true;

  const AFT_ORIGIN = 'https://aft-qt-jp.aka.nrt.corp.amazon.com';
  const SIDELINE_ORIGIN = 'https://aft-poirot-website-nrt.nrt.proxy.amazon.com';
  const AFT_WORKER_URL = AFT_ORIGIN + '/app/edititems?experience=Desktop#iss-console-worker';
  const SIDELINE_WORKER_URL = SIDELINE_ORIGIN + '/?tool=V3&issConsoleWorker=1#iss-console-worker';
  const STORE_PREFIX = 'issConsole.v1.';
  const DEFAULT_TIMEOUT = 20000;
  const LONG_TIMEOUT = 12 * 60 * 1000;
  const WORKER_HEALTH_TIMEOUT = 4000;
  const WORKER_READY_TIMEOUT = 15000;
  const WORKER_HEARTBEAT_MS = 2 * 60 * 1000;
  const SIDELINE_START_TRIGGER = '123START';

  try { window.stop(); } catch {}
  if (document.documentElement) {
    document.documentElement.style.visibility = 'hidden';
    document.documentElement.dataset.issConsole = '1';
  }

  const $ = (selector, root = document) => {
    try { return root.querySelector(selector); } catch { return null; }
  };
  const $$ = (selector, root = document) => {
    try { return [...root.querySelectorAll(selector)]; } catch { return []; }
  };
  const clean = value => String(value ?? '').replace(/\u00a0/g, ' ').trim();
  const upper = value => clean(value).toUpperCase();
  const validContainer = value => /^(?:ts|cs)x[0-9a-z_-]+$/i.test(clean(value));

  function requireContainerField(area, input, label) {
    const value = clean(input?.value);
    if (validContainer(value)) return value;

    panelStatus(area, label + ' must start with tsX or csX', 'error');
    observe('CONTAINER_INPUT_BLOCKED', {
      area,
      field:String(label || '').toLowerCase(),
      length:value.length
    });
    input?.focus();
    input?.select?.();
    return '';
  }

  const esc = value => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function storeGet(key, fallback = '') {
    try {
      const value = localStorage.getItem(STORE_PREFIX + key);
      return value == null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function storeSet(key, value) {
    try { localStorage.setItem(STORE_PREFIX + key, String(value)); } catch {}
  }

  function warehouseId() {
    const match = location.pathname.match(/^\/([^/]+)\/results(?:\/|$)/i);
    return upper(match?.[1] || 'BWU2');
  }

  const workers = {
    aft: {
      origin: AFT_ORIGIN,
      url: AFT_WORKER_URL,
      frame: null,
      ready: false,
      version: '',
      pending: new Map(),
      lastSeenAt: 0,
      lastHealthyAt: 0,
      healthPromise: null,
      restartPromise: null
    },
    sideline: {
      origin: location.origin,
      url: SIDELINE_WORKER_URL,
      frame: null,
      local: true,
      ready: false,
      version: '',
      pending: new Map()
    }
  };

  let rpcSeq = 0;
  let activePanel = storeGet('activePanel', 'edit');
  let editMode = ['each','sku'].includes(storeGet('editMode', 'sku')) ? storeGet('editMode', 'sku') : 'sku';
  let moveMode = ['all','each','qty'].includes(storeGet('moveMode', 'all')) ? storeGet('moveMode', 'all') : 'all';
  let sidelineMode = ['scrubber','queue','lazy','live'].includes(storeGet('sidelineMode', 'lazy'))
    ? storeGet('sidelineMode', 'lazy')
    : 'lazy';
  let sidelineRunBusy = false;
  let sidelineAttention = '';
  let sidelineItemsSignature = '';
  let sidelineCompletionStatus = '';
  let built = false;

  function nextRpcId(worker) {
    rpcSeq++;
    return worker + ':' + Date.now() + ':' + rpcSeq;
  }

  function workerFrame(worker) {
    const state = workers[worker];
    if (!state) return null;
    if (state.local) return window;
    return state.frame?.contentWindow || null;
  }

  function observe(type, data = {}) {
    try {
      window.dispatchEvent(new CustomEvent('bwu2-observability:event', {
        detail: JSON.stringify({
          type: 'ISS_CONSOLE_' + String(type || 'EVENT').toUpperCase(),
          data
        })
      }));
    } catch {}
  }

  function rpcRaw(worker, command, payload = {}, timeout = DEFAULT_TIMEOUT) {
    const state = workers[worker];
    if (!state) return Promise.reject(new Error('Unknown worker'));
    if (!state.ready || !workerFrame(worker)) {
      observe('RPC_BLOCKED', { worker, command, reason:'worker-not-ready' });
      return Promise.reject(new Error(worker + ' worker not ready'));
    }

    const id = nextRpcId(worker);
    observe('RPC_SEND', { worker, command });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        state.pending.delete(id);
        observe('RPC_TIMEOUT', { worker, command });
        reject(new Error(command + ' timed out'));
      }, timeout);

      state.pending.set(id, { resolve, reject, timer, command });
      workerFrame(worker).postMessage({
        type: 'ISS_CONSOLE_RPC',
        worker,
        id,
        command,
        payload
      }, state.local ? location.origin : state.origin);
    });
  }

  function waitForWorkerReady(worker, timeout = WORKER_READY_TIMEOUT) {
    const state = workers[worker];
    if (!state) return Promise.reject(new Error('Unknown worker'));

    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeout;
      const check = () => {
        if (state.ready && workerFrame(worker)) {
          resolve(true);
          return;
        }
        if (Date.now() >= deadline) {
          reject(new Error(worker + ' worker did not reconnect'));
          return;
        }
        setTimeout(check, 100);
      };
      check();
    });
  }

  async function restartWorker(worker, reason = 'health-check') {
    const state = workers[worker];
    if (!state || state.local) throw new Error(worker + ' worker cannot be restarted');
    if (state.restartPromise) return state.restartPromise;

    const active = [...state.pending.values()].filter(item => item?.command !== 'ping');
    if (active.length) throw new Error(worker + ' worker has an active command');

    state.restartPromise = (async () => {
      observe('WORKER_RESTART', { worker, reason });
      markWorker(worker, false);

      const oldFrame = state.frame;
      state.frame = null;
      try { oldFrame?.remove(); } catch {}

      spawnWorker(worker);
      await waitForWorkerReady(worker);

      const result = await rpcRaw(worker, 'ping', {}, WORKER_HEALTH_TIMEOUT);
      state.lastHealthyAt = Date.now();
      observe('WORKER_HEALTH', { worker, ok:true, repaired:true, reason });
      return result;
    })().finally(() => {
      state.restartPromise = null;
    });

    return state.restartPromise;
  }

  async function ensureWorkerHealthy(worker) {
    const state = workers[worker];
    if (!state) throw new Error('Unknown worker');
    if (state.local) return true;
    if (state.healthPromise) return state.healthPromise;

    state.healthPromise = (async () => {
      if (!state.ready || !workerFrame(worker)) {
        return restartWorker(worker, 'not-ready');
      }

      try {
        const result = await rpcRaw(worker, 'ping', {}, WORKER_HEALTH_TIMEOUT);
        state.lastHealthyAt = Date.now();
        observe('WORKER_HEALTH', { worker, ok:true, repaired:false });
        return result;
      } catch (error) {
        observe('WORKER_HEALTH', {
          worker,
          ok:false,
          error:clean(error?.message || error).slice(0, 180)
        });
        return restartWorker(worker, 'ping-failed');
      }
    })().finally(() => {
      state.healthPromise = null;
    });

    return state.healthPromise;
  }

  async function rpc(worker, command, payload = {}, timeout = DEFAULT_TIMEOUT) {
    if (worker === 'aft' && !['ping','stop'].includes(command)) {
      await ensureWorkerHealthy(worker);
    }
    return rpcRaw(worker, command, payload, timeout);
  }

  function startWorkerWatchdog() {
    setInterval(() => {
      const state = workers.aft;
      if (!state || state.restartPromise || state.healthPromise || state.pending.size) return;
      const age = Date.now() - Number(state.lastHealthyAt || state.lastSeenAt || 0);
      if (age < WORKER_HEARTBEAT_MS) return;

      ensureWorkerHealthy('aft').catch(error => {
        markWorker('aft', false);
        observe('WORKER_HEALTH', {
          worker:'aft',
          ok:false,
          watchdog:true,
          error:clean(error?.message || error).slice(0, 180)
        });
      });
    }, WORKER_HEARTBEAT_MS);
  }

  function markWorker(worker, ready, version = '') {
    const state = workers[worker];
    if (!state) return;
    const previousReady = !!state.ready;
    const previousVersion = state.version || '';
    state.ready = !!ready;
    if (ready) state.lastSeenAt = Date.now();
    if (version) state.version = version;

    const dot = $('[data-worker-dot="' + worker + '"]');
    const label = $('[data-worker-label="' + worker + '"]');
    if (dot) dot.dataset.ready = ready ? '1' : '0';
    if (label) label.textContent = worker === 'aft'
      ? 'AFT ' + (ready ? 'READY' : 'OFFLINE')
      : 'SIDELINE ' + (ready ? 'READY' : 'OFFLINE');

    if (ready && worker === 'aft') {
      for (const area of ['edit','move']) {
        const status = $('[data-status="' + area + '"]');
        if (status && /^Waiting for AFT worker/i.test(status.textContent || '')) {
          panelStatus(area, 'AFT ready', 'ok');
        }
      }
    } else if (ready && worker === 'sideline') {
      const status = $('[data-status="sideline"]');
      if (status && /^Waiting for Sideline worker/i.test(status.textContent || '')) {
        panelStatus('sideline', 'Sideline ready', 'ok');
      }
    }

    if (previousReady !== state.ready || previousVersion !== state.version) {
      observe('WORKER_STATE', { worker, ready:!!ready, version:version || state.version || '' });
    }
  }

  function panelStatus(area, message, kind = '') {
    const el = $('[data-status="' + area + '"]');
    if (!el) return;
    el.textContent = clean(message) || 'Ready';
    el.dataset.kind = kind;
  }

  function setPanelLoading(area, on, message = '', options = {}) {
    const panel = $('[data-panel="' + area + '"]');
    if (!panel) return;
    const lock = options.lock !== false;
    panel.dataset.loading = on ? '1' : '0';
    if (message) {
      const label = $('[data-loading-label]', panel);
      if (label) label.textContent = message;
    }
    if (!lock && on) return;
    for (const el of $$('input,select,textarea,button', panel)) {
      if (el.matches('[data-stop]')) continue;
      if (el.dataset.keepEnabled === '1') continue;
      if (on) {
        if (!el.disabled) el.dataset.issWasEnabled = '1';
        el.disabled = true;
      } else if (el.dataset.issWasEnabled === '1') {
        el.disabled = false;
        delete el.dataset.issWasEnabled;
      }
    }
  }

  function setActivePanel(area) {
    if (!['edit','move','sideline'].includes(area)) return;
    activePanel = area;
    storeSet('activePanel', area);
    const grid = $('#iss-grid');
    if (grid) grid.dataset.active = area;
    for (const panel of $$('[data-panel]')) {
      panel.dataset.active = panel.dataset.panel === area ? '1' : '0';
    }
  }

  function collectLines(text) {
    const seen = new Set();
    const out = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
      const value = clean(raw.split(/\s+/)[0]);
      if (!value) continue;
      const key = upper(value);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(value);
    }
    return out;
  }

  function collectLinesWithQuantity(text) {
    const out = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
      const value = clean(raw.split(/\s+/)[0]);
      if (value) out.push(value);
    }
    return out;
  }

  function collectLazyLines(text, source = '', dest = '') {
    const blocked = new Set(
      [source, dest, SIDELINE_START_TRIGGER]
        .map(value => upper(clean(value)))
        .filter(Boolean)
    );
    return collectLinesWithQuantity(text).filter(value => !blocked.has(upper(value)));
  }

  function lazyMetricsFromLines(lines = []) {
    const cleanLines = Array.isArray(lines) ? lines.filter(Boolean) : [];
    return {
      total: cleanLines.length,
      unique: new Set(cleanLines.map(upper)).size,
      moved: 0,
      remaining: cleanLines.length
    };
  }

  function lazyMetricsFromItems(items = []) {
    const rows = Array.isArray(items) ? items : [];
    let total = 0;
    let moved = 0;
    let remaining = 0;

    for (const item of rows) {
      const qty = Math.max(1, Number(item?.qty) || 1);
      const status = upper(item?.status || '');
      total += qty;
      if (status === 'MOVED') moved += qty;
      if (!['MOVED','FAILED','INVALID','SKIPPED'].includes(status)) remaining += qty;
    }

    return { total, unique: rows.length, moved, remaining };
  }

  function paintLazyMetrics(metrics = {}) {
    const host = $('[data-side-lazy-metrics]');
    if (!host) return;
    const values = {
      total: Number(metrics.total) || 0,
      unique: Number(metrics.unique) || 0,
      moved: Number(metrics.moved) || 0,
      remaining: Number(metrics.remaining) || 0
    };
    for (const [key, value] of Object.entries(values)) {
      const el = $('[data-side-metric="' + key + '"]');
      if (el) el.textContent = String(value);
    }
  }

  function paintLazyMetricsFromInput() {
    const source = clean($('[data-side-source]')?.value);
    const dest = clean($('[data-side-dest]')?.value);
    const lines = collectLazyLines($('[data-side-items]')?.value, source, dest);
    paintLazyMetrics(lazyMetricsFromLines(lines));
  }

  function sidelineItemStateLabel(item) {
    const status = upper(item?.status || '');
    if (status === 'READY') return '✓ READY';
    if (status === 'DATE') return '⚠ ' + (upper(item?.dateType || '') === 'PRODUCTION_DATE' ? 'PRODUCTION DATE' : 'EXPIRATION DATE') + ' REQUIRED';
    if (status === 'RESOLVING') return '… CHECKING';
    if (status === 'MOVING') return '→ MOVING';
    if (status === 'MOVED') return '✓ MOVED';
    if (status === 'INVALID' || status === 'FAILED' || status === 'SKIPPED') return '✕ NOT MOVED';
    if (status === 'DEST_RETRY') return '⚠ WAITING TO RETRY';
    return status || '• QUEUED';
  }

  function renderSidelineItems(items = [], finalOnly = false) {
    const host = $('[data-side-items-state]');
    if (!host) return;

    let rows = Array.isArray(items) ? items : [];
    if (finalOnly) rows = rows.filter(item => ['FAILED','INVALID','SKIPPED'].includes(upper(item?.status || '')));

    const signature = (finalOnly ? 'final|' : 'live|') + rows.map(item => [
      item?.code || '',
      item?.qty || 0,
      item?.status || '',
      item?.asin || '',
      item?.fnsku || '',
      item?.issue || '',
      item?.dateType || ''
    ].join('\u0000')).join('\u0001');

    if (signature === sidelineItemsSignature) return;
    sidelineItemsSignature = signature;

    if (!rows.length) {
      host.innerHTML = '';
      host.dataset.show = '0';
      return;
    }

    host.innerHTML = rows.map(item => {
      const status = upper(item?.status || '');
      const scan = clean(item?.code || '—');
      const asin = clean(item?.asin || '—');
      const fnsku = clean(item?.fnsku || '—');
      const issue = clean(item?.issue || '');
      const qty = Number(item?.qty) || 1;
      const issueRow = issue ? '<b>Issue:</b><span>' + esc(issue) + '</span>' : '';
      return '<div class="iss-side-item" data-state="' + esc(status) + '">' +
        '<div class="iss-side-item-top"><strong>' + esc(sidelineItemStateLabel(item)) + '</strong><code>' + esc(scan) + ' ×' + qty + '</code></div>' +
        '<div class="iss-side-item-meta">' +
          '<b>ASIN:</b><span>' + esc(asin) + '</span>' +
          '<b>FNSKU:</b><span>' + esc(fnsku) + '</span>' +
          issueRow +
        '</div>' +
      '</div>';
    }).join('');
    host.dataset.show = '1';
  }

  function resetSidelineLazyInputs() {
    for (const el of $$('[data-side-source],[data-side-dest],[data-side-items]')) el.value = '';
    $('[data-side-source]')?.focus();
  }

  function handleProgress(message) {
    const area = message.area;
    if (!['edit','move','sideline'].includes(area)) return;

    const attention = area === 'sideline' ? String(message.attention || '') : '';
    const needsUser = ['rescan-destination','live-destination'].includes(attention);
    const preserveLazyCompletion =
      area === 'sideline' &&
      sidelineMode === 'lazy' &&
      !!sidelineCompletionStatus &&
      message.mode === 'lazy' &&
      !message.running &&
      !attention;

    if (preserveLazyCompletion) {
      panelStatus('sideline', sidelineCompletionStatus, 'ok');
    } else {
      panelStatus(area, message.message || 'Working…', needsUser ? 'attention' : (message.error ? 'error' : 'working'));
    }

    if (area === 'sideline') {
      const previousAttention = sidelineAttention;
      sidelineAttention = attention;

      const panel = $('[data-panel="sideline"]');
      const alert = $('[data-side-alert]');
      const alertText = $('[data-side-alert-text]');
      const liveSkip = $('[data-side-live-skip]');
      const items = $('[data-side-items]');
      if (panel) panel.dataset.sideAttention = attention;
      if (alert) alert.dataset.show = ['rescan-destination','live-destination'].includes(attention) ? '1' : '0';
      if (liveSkip) liveSkip.hidden = attention !== 'live-destination';

      if (attention === 'rescan-destination') {
        const dest = clean($('[data-side-dest]')?.value);
        setPanelLoading('sideline', false);
        if (alertText) alertText.textContent = 'SCAN ' + (dest || 'DESTINATION') + ' AGAIN IN ITEM BARCODES TO CONTINUE';
        if (previousAttention !== attention) {
          items?.focus();
          items?.scrollIntoView?.({ block:'nearest', inline:'nearest' });
        }
      } else if (attention === 'predicant-recovery') {
        setPanelLoading('sideline', true, 'Destination confirmed • emptying destination…');
        panelStatus('sideline', message.message || 'Destination confirmed • emptying destination…', 'working');
      } else if (attention === 'live-destination') {
        const issue = message.issue || {};
        const destInput = $('[data-side-dest]');
        setPanelLoading('sideline', false);
        if (alertText) {
          const identity = [clean(issue.asin), clean(issue.fnsku)].filter(Boolean).join(' / ');
          alertText.textContent = 'SCAN A NEW DESTINATION' +
            (identity ? ' • ' + identity : '') +
            (clean(issue.reason) ? ' • ' + clean(issue.reason) : '');
        }
        if (previousAttention !== attention) {
          destInput?.focus();
          destInput?.select?.();
          destInput?.scrollIntoView?.({ block:'nearest', inline:'nearest' });
        }
      } else if (previousAttention === 'predicant-recovery' && sidelineRunBusy) {
        setPanelLoading('sideline', false);
        setPanelLoading('sideline', true, 'Running Lazy…', { lock:false });
      } else if (previousAttention === 'rescan-destination' && sidelineRunBusy) {
        setPanelLoading('sideline', true, 'Running Lazy…', { lock:false });
      }

      if (message.mode === 'lazy' && Array.isArray(message.items)) {
        renderSidelineItems(message.items, false);
        paintLazyMetrics(lazyMetricsFromItems(message.items));
      } else if (message.mode === 'live') {
        if (message.failure) {
          renderSidelineItems([{
            code:message.failure.scan || '',
            qty:message.failure.qty || 1,
            status:'FAILED',
            asin:message.failure.asin || '',
            fnsku:message.failure.fnsku || '',
            issue:message.failure.reason || message.failure.title || 'NOT MOVED'
          }], false);
        } else if (!message.issue) {
          renderSidelineItems([], false);
        }
      }

      const meta = $('[data-progress="sideline"]');
      if (meta) {
        const bits = [];
        if (Number.isFinite(Number(message.current)) && Number.isFinite(Number(message.total)) && Number(message.total) > 0) {
          bits.push(String(message.current) + '/' + String(message.total));
        }
        if (Number.isFinite(Number(message.moved))) bits.push('Moved ' + message.moved);
        if (Number.isFinite(Number(message.queued))) bits.push('Queue ' + message.queued);
        if (Number.isFinite(Number(message.expiryPending))) bits.push('Expiry ' + message.expiryPending);
        if (Number.isFinite(Number(message.skipped))) bits.push('Skipped ' + message.skipped);
        if (Number.isFinite(Number(message.cleared))) bits.push('Cleared ' + message.cleared);
        if (Number.isFinite(Number(message.pending))) bits.push('Pending ' + message.pending);
        meta.textContent = bits.join(' • ');
      }
    }
  }

  window.addEventListener('message', event => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    const worker = message.worker;
    const state = workers[worker];
    if (!state) return;
    const originOk = state.local ? event.origin === location.origin : event.origin === state.origin;
    const sourceOk = state.local ? true : event.source === workerFrame(worker);
    if (!originOk || !sourceOk) return;
    state.lastSeenAt = Date.now();

    if (message.type === 'ISS_CONSOLE_WORKER_READY') {
      observe('WORKER_READY_MESSAGE', { worker, version:message.version || '' });
      state.lastHealthyAt = Date.now();
      markWorker(worker, true, message.version || '');
      if (worker === 'sideline') {
        rpc('sideline', 'mode', { mode: sidelineMode }, 15000)
          .then(() => syncSidelineModeUi(false))
          .catch(error => panelStatus('sideline', error.message, 'error'));
      }
      return;
    }

    if (message.type === 'ISS_CONSOLE_PROGRESS') {
      observe('WORKER_PROGRESS', {
        worker,
        area:message.area || '',
        loading:!!message.loading,
        mode:message.mode || '',
        current:Number.isFinite(Number(message.current)) ? Number(message.current) : undefined,
        total:Number.isFinite(Number(message.total)) ? Number(message.total) : undefined,
        done:Number.isFinite(Number(message.done)) ? Number(message.done) : undefined
      });
      handleProgress(message);
      return;
    }

    if (message.type !== 'ISS_CONSOLE_RPC_RESULT') return;
    const pending = state.pending.get(String(message.id || ''));
    if (!pending) return;
    state.pending.delete(String(message.id || ''));
    clearTimeout(pending.timer);
    const resultSummary = message.ok && message.data && typeof message.data === 'object'
      ? {
          done:Number.isFinite(Number(message.data.done)) ? Number(message.data.done) : undefined,
          total:Number.isFinite(Number(message.data.total)) ? Number(message.data.total) : undefined,
          moved:Number.isFinite(Number(message.data.moved)) ? Number(message.data.moved) : undefined,
          failed:Number.isFinite(Number(message.data.failed)) ? Number(message.data.failed) : undefined,
          flipped:Number.isFinite(Number(message.data.flipped)) ? Number(message.data.flipped) : undefined,
          zero:Number.isFinite(Number(message.data.zero)) ? Number(message.data.zero) : undefined
        }
      : undefined;
    observe('RPC_RESULT', {
      worker,
      command:pending.command,
      ok:!!message.ok,
      error:message.ok ? '' : clean(message.error || pending.command + ' failed').slice(0, 180),
      result:resultSummary
    });
    if (message.ok) {
      pending.resolve(message.data);
    } else {
      const error = new Error(message.error || pending.command + ' failed');
      if (message.data && typeof message.data === 'object') error.data = message.data;
      pending.reject(error);
    }
  });

  function spawnWorker(worker) {
    const state = workers[worker];
    if (!state) return;

    if (state.local) {
      observe('WORKER_SPAWN', { worker, origin:location.origin, path:'local' });
      let attempts = 0;
      const ping = () => {
        if (state.ready || attempts >= 16) return;
        attempts++;
        try {
          window.postMessage({
            type:'ISS_CONSOLE_RPC',
            worker,
            id:nextRpcId(worker),
            command:'ping',
            payload:{}
          }, location.origin);
          observe('WORKER_PING', { worker, attempt:attempts });
        } catch {}
        if (!state.ready) setTimeout(ping, attempts === 1 ? 250 : 500);
      };
      setTimeout(ping, 150);
      return;
    }

    if (state.frame) return;
    const frame = document.createElement('iframe');
    frame.className = 'iss-worker-frame';
    frame.name = 'iss-console-' + worker + '-worker';
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.src = state.url;
    frame.addEventListener('load', () => {
      if (state.frame !== frame) return;
      markWorker(worker, false);
      setTimeout(() => {
        if (state.frame !== frame || state.ready) return;
        try {
          frame.contentWindow.postMessage({
            type: 'ISS_CONSOLE_RPC',
            worker,
            id: nextRpcId(worker),
            command: 'ping',
            payload: {}
          }, state.origin);
          observe('WORKER_PING', { worker, reason:'iframe-load' });
        } catch {}
      }, 1000);
    });
    state.frame = frame;
    observe('WORKER_SPAWN', {
      worker,
      origin:state.origin,
      path:(() => { try { return new URL(state.url).pathname; } catch { return ''; } })()
    });
    frame.addEventListener('load', () => {
      observe('WORKER_IFRAME_LOAD', { worker, ready:!!state.ready });
    });
    document.body.appendChild(frame);
  }

  function choiceButtons(attribute, values) {
    return values.map(value => {
      const label = value === 'Pending Research' ? 'Pending' : value;
      return '<button type="button" ' + attribute + '="' + esc(value) + '">' + esc(label) + '</button>';
    }).join('');
  }

  function appMarkup() {
    const states = ['Sellable','Pending Research','Unsellable'];
    const damages = ['Amazon Damage','Defective','Distributor Damage','Expired'];
    const stateSourceButtons = choiceButtons('data-edit-source-value', states);
    const stateDestButtons = choiceButtons('data-edit-dest-value', states);
    const damageSourceButtons = choiceButtons('data-edit-source-damage-value', damages);
    const damageDestButtons = choiceButtons('data-edit-dest-damage-value', damages);
    return [
      '<div id="iss-shell">',
      '  <header class="iss-topbar">',
      '    <div class="iss-brand-wrap">',
      '      <div class="iss-brand"><span class="iss-site">' + esc(warehouseId()) + '</span><span class="iss-title">ISS Console</span></div>',
      '      <div class="iss-subtitle">Inventory Support • Direct workflow console</div>',
      '    </div>',
      '    <div class="iss-worker-status">',
      '      <span class="iss-worker"><i data-worker-dot="aft"></i><span data-worker-label="aft">AFT CONNECTING</span></span>',
      '      <span class="iss-worker"><i data-worker-dot="sideline"></i><span data-worker-label="sideline">SIDELINE CONNECTING</span></span>',
      '      <button type="button" class="iss-exit" data-exit>FCResearch</button>',
      '    </div>',
      '  </header>',
      '  <div class="iss-accent"></div>',
      '  <main id="iss-grid" data-active="' + esc(activePanel) + '">',
      '    <section class="iss-panel" data-panel="edit" data-active="' + (activePanel === 'edit' ? '1' : '0') + '">',
      '      <div class="iss-panel-head"><div><strong class="iss-panel-title">EDIT</strong><span class="iss-panel-subtitle">Edit Items • Disposition</span></div><span class="iss-engine" data-edit-engine>' + esc(editMode.toUpperCase()) + '</span></div>',
      '      <div class="iss-panel-body">',
      '        <div class="iss-segment iss-segment-edit" data-edit-modes><button type="button" data-edit-mode="each">EACH</button><button type="button" data-edit-mode="sku">SKU</button></div>',
      '        <input type="hidden" data-edit-source value="Sellable">',
      '        <input type="hidden" data-edit-source-damage value="Defective">',
      '        <input type="hidden" data-edit-dest value="Pending Research">',
      '        <input type="hidden" data-edit-dest-damage value="Defective">',
      '        <div class="iss-choice-field" data-edit-source-wrap><span>SOURCE</span><div class="iss-choice-group iss-choice-state">' + stateSourceButtons + '</div></div>',
      '        <div class="iss-auto-source" data-edit-auto-source hidden><span>SOURCE</span><strong>AUTO-DETECT FROM ITEM</strong></div>',
      '        <div class="iss-choice-field iss-damage" data-edit-source-damage-wrap><span>SOURCE DISPOSITION</span><div class="iss-choice-group iss-choice-damage">' + damageSourceButtons + '</div></div>',
      '        <div class="iss-flow-arrow">↓</div>',
      '        <div class="iss-choice-field"><span>DESTINATION</span><div class="iss-choice-group iss-choice-state">' + stateDestButtons + '</div></div>',
      '        <div class="iss-choice-field iss-damage" data-edit-dest-damage-wrap><span>DESTINATION DISPOSITION</span><div class="iss-choice-group iss-choice-damage">' + damageDestButtons + '</div></div>',
      '        <div class="iss-flow-arrow">↓</div>',
      '        <label class="iss-field iss-grow"><span data-edit-items-label>ITEM BARCODES / ASIN / FNSKU</span><textarea data-edit-items spellcheck="false" placeholder="Scan or paste one per line"></textarea></label>',
      '        <div class="iss-actions"><button type="button" class="iss-primary" data-edit-run>RUN SKU</button><button type="button" data-stop="edit">STOP</button><button type="button" data-clear="edit">CLEAR</button></div>',
      '        <div class="iss-status" data-status="edit" data-kind="">Ready</div>',
      '      </div>',
      '      <div class="iss-loading"><span class="iss-spinner"></span><b data-loading-label>Working…</b></div>',
      '    </section>',
      '    <section class="iss-panel" data-panel="move" data-active="' + (activePanel === 'move' ? '1' : '0') + '">',
      '      <div class="iss-panel-head"><div><strong class="iss-panel-title">MOVE</strong><span class="iss-panel-subtitle">Move Items • Container move</span></div><span class="iss-engine" data-move-engine>' + esc(moveMode.toUpperCase()) + '</span></div>',
      '      <div class="iss-panel-body">',
      '        <div class="iss-segment iss-segment-move" data-move-modes><button type="button" data-move-mode="all">ALL</button><button type="button" data-move-mode="each">EACH</button><button type="button" data-move-mode="qty">QTY</button></div>',
      '        <label class="iss-inline-field" data-move-qty-wrap><span>QTY</span><input type="number" min="1" max="999999" data-move-qty></label>',
      '        <label class="iss-field"><span>SOURCE</span><input data-move-source autocomplete="off" spellcheck="false" placeholder="tsX / csX"></label>',
      '        <div class="iss-flow-arrow">↓</div>',
      '        <label class="iss-field"><span>DESTINATION</span><input data-move-dest autocomplete="off" spellcheck="false" placeholder="tsX / csX"></label>',
      '        <div class="iss-flow-arrow">↓</div>',
      '        <label class="iss-field iss-grow"><span>ITEM BARCODES</span><textarea data-move-items spellcheck="false" placeholder="Scan or paste one per line"></textarea></label>',
      '        <div class="iss-actions"><button type="button" class="iss-primary" data-move-run>RUN MOVE</button><button type="button" data-stop="move">STOP</button><button type="button" data-clear="move">CLEAR</button></div>',
      '        <div class="iss-status" data-status="move" data-kind="">Ready</div>',
      '      </div>',
      '      <div class="iss-loading"><span class="iss-spinner"></span><b data-loading-label>Switching mode…</b></div>',
      '    </section>',
      '    <section class="iss-panel" data-panel="sideline" data-active="' + (activePanel === 'sideline' ? '1' : '0') + '">',
      '      <div class="iss-panel-head"><div><strong class="iss-panel-title">SIDELINE</strong><span class="iss-panel-subtitle">Container workflow</span></div><span class="iss-engine" data-side-engine>' + esc(sidelineMode.toUpperCase()) + '</span></div>',
      '      <div class="iss-panel-body">',
      '        <div class="iss-segment iss-segment-side" data-side-modes><button type="button" data-side-mode="scrubber">SCRUBBER</button><button type="button" data-side-mode="queue">QUEUE</button><button type="button" data-side-mode="lazy">LAZY</button><button type="button" data-side-mode="live">LIVE</button></div>',
      '        <label class="iss-field"><span data-side-source-label>SOURCE</span><input data-side-source autocomplete="off" spellcheck="false" placeholder="tsX / csX"></label>',
      '        <div class="iss-flow-arrow">↓</div>',
      '        <label class="iss-field"><span>DESTINATION</span><input data-side-dest autocomplete="off" spellcheck="false" placeholder="tsX / csX"></label>',
      '        <div class="iss-flow-arrow">↓</div>',
      '        <label class="iss-field iss-grow"><span data-side-items-label>ITEM BARCODES</span><textarea data-side-items spellcheck="false" placeholder="Scan or paste one per line"></textarea></label>',
      '        <div class="iss-side-metrics" data-side-lazy-metrics><div class="iss-side-metric"><span>TOTAL UNITS</span><b data-side-metric="total">0</b></div><div class="iss-side-metric"><span>UNIQUE ITEMS</span><b data-side-metric="unique">0</b></div><div class="iss-side-metric"><span>MOVED</span><b data-side-metric="moved">0</b></div><div class="iss-side-metric"><span>REMAINING</span><b data-side-metric="remaining">0</b></div></div>',
      '        <div class="iss-side-alert" data-side-alert><strong>⚠ ACTION REQUIRED — RESCAN DESTINATION</strong><span data-side-alert-text>Scan the destination again in ITEM BARCODES to continue.</span><button type="button" class="iss-alert-action" data-side-live-skip hidden>SKIP ITEM</button></div>',
      '        <div class="iss-side-items" data-side-items-state></div>',
      '        <div class="iss-lazy-options" data-clear-source-wrap><button type="button" class="iss-toggle-button" data-clear-source-toggle>CLEAR SOURCE: OFF</button><button type="button" class="iss-toggle-button" data-lazy-delay-toggle>DELAY 2–8s: ON</button><button type="button" class="iss-toggle-button" data-live-delay-toggle>DELAY 5–11s: ON</button><input type="checkbox" data-clear-source hidden><input type="checkbox" data-lazy-delay hidden><input type="checkbox" data-live-delay hidden></div>',
      '        <div class="iss-actions"><button type="button" class="iss-primary" data-side-run>RUN SIDELINE</button><button type="button" data-stop="sideline">STOP</button><button type="button" data-clear="sideline">CLEAR</button></div>',
      '        <div class="iss-status-line"><div class="iss-status" data-status="sideline" data-kind="">Ready</div><span class="iss-progress" data-progress="sideline"></span></div>',
      '      </div>',
      '      <div class="iss-loading"><span class="iss-spinner"></span><b data-loading-label>Switching mode…</b></div>',
      '    </section>',
      '  </main>',
      '  <footer class="iss-footer"><span>ISS Console v' + VERSION + '</span><span>Source → Destination → Items</span></footer>',
      '</div>'
    ].join('');
  }

  function cssText() {
    return [
      ':root{font-family:Arial,Helvetica,sans-serif;color:#172033;background:#eaeded}',
      '*{box-sizing:border-box}',
      'html,body{margin:0;min-height:100%;background:#eaeded}',
      'body{min-width:1120px}',
      '#iss-shell{min-height:100vh;display:flex;flex-direction:column;background:#eaeded}',
      '.iss-topbar{height:72px;padding:0 24px;display:flex;align-items:center;justify-content:space-between;background:#fff;border-bottom:1px solid #c8d0d8;box-shadow:0 1px 2px rgba(0,0,0,.08)}',
      '.iss-brand-wrap{display:flex;align-items:center;gap:18px}.iss-brand{display:flex;align-items:baseline;gap:10px}.iss-site{font-size:18px;font-weight:900;color:#ff9900;letter-spacing:.5px}.iss-title{font-size:24px;font-weight:800;color:#17324d}.iss-subtitle{font-size:12px;color:#5f6b76;font-weight:700}',
      '.iss-worker-status{display:flex;align-items:center;gap:11px}.iss-worker{display:flex;align-items:center;gap:6px;font-size:10px;font-weight:800;color:#5b6875}.iss-worker i{width:8px;height:8px;border-radius:50%;background:#b8c0c8}.iss-worker i[data-ready="1"]{background:#2f8a46;box-shadow:0 0 0 2px rgba(47,138,70,.13)}',
      '.iss-exit{height:34px;padding:0 13px;border:1px solid #8796a5;border-radius:3px;background:#f7f8fa;color:#21364a;font-weight:800;cursor:pointer}.iss-exit:hover{background:#eef1f4}',
      '.iss-accent{height:3px;background:#ff9900}',
      '#iss-grid{flex:1;display:grid;gap:14px;padding:18px 20px 14px;align-items:stretch;transition:grid-template-columns .22s ease}',
      '#iss-grid[data-active="edit"]{grid-template-columns:1.85fr 1fr 1fr}#iss-grid[data-active="move"]{grid-template-columns:1fr 1.85fr 1fr}#iss-grid[data-active="sideline"]{grid-template-columns:1fr 1fr 1.85fr}',
      '.iss-panel{position:relative;min-width:0;display:flex;flex-direction:column;background:#fff;border:1px solid #b8c2cc;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,.09);overflow:hidden;transition:border-color .18s ease,box-shadow .18s ease}',
      '.iss-panel[data-active="1"]{border-color:#4b789f;box-shadow:0 2px 8px rgba(29,68,102,.18)}',
      '.iss-panel-head{min-height:68px;padding:10px 12px 10px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #cbd2d9;background:#f3f4f5;box-shadow:inset 4px 0 #8798a8}',
      '.iss-panel[data-active="1"] .iss-panel-head{box-shadow:inset 5px 0 #146eb4;background:#eef4f8}.iss-panel-head>div{display:grid;gap:1px}.iss-panel-title{font-size:23px;line-height:1;font-weight:900;letter-spacing:.3px;color:#17324d}.iss-panel-subtitle{font-size:10px;font-weight:800;letter-spacing:.25px;color:#667583}.iss-engine{padding:4px 8px;border:1px solid #aeb9c3;border-radius:3px;background:#fff;color:#33495d;font-size:10px;font-weight:900}',
      '.iss-panel-body{flex:1;display:flex;flex-direction:column;gap:8px;padding:12px}.iss-field,.iss-choice-field{display:grid;gap:5px}.iss-field>span,.iss-choice-field>span,.iss-inline-field>span,.iss-auto-source>span{font-size:10px;font-weight:900;letter-spacing:.35px;color:#536171}.iss-field input,.iss-field textarea,.iss-inline-field input{width:100%;border:1px solid #aeb9c3;border-radius:3px;background:#fff;color:#111827;font:700 13px Arial,sans-serif;outline:none}.iss-field input{height:38px;padding:0 9px}.iss-field textarea{min-height:150px;flex:1;padding:9px;resize:vertical;font-family:Consolas,monospace;line-height:1.45}.iss-field input:focus,.iss-field textarea:focus,.iss-inline-field input:focus{border-color:#146eb4;box-shadow:0 0 0 2px rgba(20,110,180,.13)}',
      '.iss-field input:disabled,.iss-field textarea:disabled{background:#eceff1;color:#8a949e;border-color:#c8ced4}.iss-grow{flex:1}.iss-flow-arrow{text-align:center;height:12px;color:#7b8793;font-weight:900;line-height:12px}',
      '.iss-damage{display:none}.iss-damage[data-show="1"]{display:grid}.iss-auto-source{display:grid;gap:5px}.iss-auto-source[hidden]{display:none!important}.iss-auto-source strong{height:36px;display:flex;align-items:center;padding:0 9px;border:1px solid #c4cbd1;border-radius:3px;background:#eef1f3;color:#65717c;font-size:11px;letter-spacing:.2px}',
      '.iss-choice-group{display:grid;gap:4px}.iss-choice-state{grid-template-columns:repeat(3,minmax(0,1fr))}.iss-choice-damage{grid-template-columns:repeat(2,minmax(0,1fr))}.iss-choice-group button{min-width:0;height:34px;padding:0 5px;border:1px solid #aeb8c2;border-radius:3px;background:#f7f8fa;color:#33475b;font-size:10px;font-weight:900;cursor:pointer}.iss-choice-group button[data-active="1"]{background:#365f7e;color:#fff;border-color:#294d69}.iss-choice-group button:hover:not(:disabled){background:#e7edf2}.iss-choice-group button[data-active="1"]:hover{background:#365f7e}',
      '.iss-segment{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-bottom:2px}.iss-segment-edit{grid-template-columns:repeat(2,1fr)}.iss-segment-move{grid-template-columns:repeat(3,1fr)}.iss-segment-side{grid-template-columns:repeat(4,1fr)}.iss-segment button{height:31px;border:1px solid #aeb8c2;border-radius:3px;background:#f7f8fa;color:#33475b;font-size:10px;font-weight:900;cursor:pointer}.iss-segment button[data-active="1"]{background:#365f7e;color:#fff;border-color:#294d69}.iss-segment button:hover:not(:disabled){background:#e7edf2}.iss-segment button[data-active="1"]:hover{background:#365f7e}',
      '.iss-inline-field{display:none;grid-template-columns:auto 90px;align-items:center;gap:8px;padding:7px 8px;background:#f7f8fa;border:1px solid #cbd2d9;border-radius:3px}.iss-inline-field[data-show="1"]{display:grid}.iss-inline-field input{height:32px;padding:0 7px;text-align:center}',
      '.iss-lazy-options{display:none}.iss-lazy-options[data-show="1"]{display:flex;gap:6px;flex-wrap:wrap}.iss-toggle-button{height:34px;padding:0 12px;border:1px solid #aeb8c2;border-radius:3px;background:#f7f8fa;color:#33475b;font-size:10px;font-weight:900;cursor:pointer}.iss-toggle-button[data-active="1"]{background:#365f7e;color:#fff;border-color:#294d69}.iss-side-metrics{display:none;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}.iss-side-metrics[data-show="1"]{display:grid}.iss-side-metric{padding:7px 4px;border:1px solid #c7d0dd;background:#f8fafc;text-align:center}.iss-side-metric span{display:block;font-size:9px;font-weight:900;letter-spacing:.2px;color:#536171}.iss-side-metric b{display:block;margin-top:2px;font-size:20px;line-height:1;color:#17324d}',
      '.iss-actions{display:grid;grid-template-columns:1.5fr .7fr .7fr;gap:6px;margin-top:2px}.iss-actions button{height:36px;border:1px solid #a9b3bd;border-radius:3px;background:#f5f6f7;color:#26384a;font-weight:900;cursor:pointer}.iss-actions .iss-primary{background:#146eb4;border-color:#0f5f9d;color:#fff}.iss-actions button:hover:not(:disabled){filter:brightness(.97)}.iss-actions button:disabled{opacity:.5;cursor:not-allowed}',
      '.iss-status{min-height:31px;padding:7px 8px;border:1px solid #c7d0d8;background:#f8f9fa;color:#38495a;font-size:11px;font-weight:800}.iss-status[data-kind="working"]{border-color:#8db3d0;background:#eef6fb;color:#174a70}.iss-status[data-kind="ok"]{border-color:#8fbea0;background:#f0f8f2;color:#1d5f32}.iss-status[data-kind="error"]{border-color:#d7a0a0;background:#fff3f3;color:#8c2525}.iss-status[data-kind="attention"]{border:3px solid #f59e0b;border-left:8px solid #dc2626;background:#fff7ed;color:#7c2d12;font-size:13px;font-weight:1000}.iss-status-line{display:grid;grid-template-columns:1fr auto;align-items:center;gap:8px}.iss-progress{font-size:10px;font-weight:800;color:#65727f;white-space:nowrap}.iss-side-alert{display:none;margin:7px 0;padding:10px 12px;border:3px solid #f59e0b;border-left:8px solid #dc2626;border-radius:5px;background:#fff7ed;color:#7c2d12;text-align:center;box-shadow:0 0 0 2px rgba(245,158,11,.12);animation:issSideAttention .85s ease-in-out infinite alternate}.iss-side-alert[data-show="1"]{display:grid;gap:4px}.iss-side-alert strong{font-size:15px;font-weight:1000}.iss-side-alert span{font-size:12px;font-weight:900}.iss-alert-action{justify-self:center;height:32px;padding:0 14px;border:2px solid #b91c1c;border-radius:4px;background:#fff;color:#991b1b;font-size:11px;font-weight:1000;cursor:pointer}.iss-panel[data-side-attention="rescan-destination"],.iss-panel[data-side-attention="live-destination"]{border-color:#f59e0b!important;box-shadow:0 0 0 3px rgba(245,158,11,.24),0 2px 8px rgba(0,0,0,.13)!important}.iss-panel[data-side-attention="rescan-destination"] [data-side-items],.iss-panel[data-side-attention="live-destination"] [data-side-dest]{outline:4px solid #f59e0b!important;box-shadow:0 0 0 5px rgba(245,158,11,.18)!important;background:#fff7ed!important}.iss-side-items{display:none;max-height:190px;overflow:auto;border:1px solid #c7d0d8;border-radius:4px;background:#f8fafc;padding:5px;gap:5px}.iss-side-items[data-show="1"]{display:grid}.iss-side-item{padding:7px 8px;border:1px solid #cbd5e1;border-left:5px solid #64748b;border-radius:3px;background:#fff;color:#334155}.iss-side-item[data-state="READY"]{border-left-color:#146eb4;background:#eff6ff;color:#0f3d73}.iss-side-item[data-state="DATE"]{border-left-color:#f59e0b;background:#fff7ed;color:#7c2d12}.iss-side-item[data-state="MOVED"]{border-left-color:#146eb4;background:#f0f8ff;color:#0f3d73}.iss-side-item[data-state="FAILED"],.iss-side-item[data-state="INVALID"],.iss-side-item[data-state="SKIPPED"]{border:2px solid #ef4444;border-left-width:7px;background:#fff1f2;color:#7f1d1d}.iss-side-item-top{display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:11px;font-weight:1000}.iss-side-item-top code{font:900 12px Consolas,monospace}.iss-side-item-meta{display:grid;grid-template-columns:auto 1fr;gap:2px 7px;margin-top:5px;font-size:11px;line-height:1.25}.iss-side-item-meta b{font-weight:1000}.iss-side-item[data-state="FAILED"] .iss-side-item-meta b,.iss-side-item[data-state="INVALID"] .iss-side-item-meta b,.iss-side-item[data-state="SKIPPED"] .iss-side-item-meta b{color:#991b1b}@keyframes issSideAttention{from{background:#fff7ed;box-shadow:0 0 0 2px rgba(245,158,11,.10)}to{background:#fef3c7;box-shadow:0 0 0 6px rgba(245,158,11,.22)}}',
      '.iss-loading{position:absolute;inset:68px 0 0;z-index:20;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:rgba(221,226,230,.76);backdrop-filter:grayscale(.45) saturate(.70) brightness(.93);opacity:0;pointer-events:none;transition:opacity .12s ease}.iss-panel[data-loading="1"] .iss-loading{opacity:1}.iss-loading b{padding:5px 9px;border:1px solid rgba(81,100,116,.30);border-radius:3px;background:rgba(255,255,255,.92);font-size:10px;color:#334a5e}.iss-spinner{width:46px;height:46px;border:5px solid rgba(255,255,255,.90);border-top-color:#146eb4;border-right-color:#146eb4;border-radius:50%;box-shadow:0 2px 11px rgba(0,0,0,.22);animation:issSpin .72s linear infinite}@keyframes issSpin{to{transform:rotate(360deg)}}',
      '.iss-footer{height:32px;padding:0 20px;display:flex;align-items:center;justify-content:space-between;border-top:1px solid #c8d0d8;background:#f7f8f9;color:#687683;font-size:10px;font-weight:800}',
      '.iss-worker-frame{position:fixed!important;width:2px!important;height:2px!important;left:-10000px!important;top:-10000px!important;opacity:0!important;pointer-events:none!important;border:0!important}',
      '@media(max-width:1380px){body{min-width:980px}#iss-grid{gap:9px;padding-left:10px;padding-right:10px}#iss-grid[data-active="edit"]{grid-template-columns:1.6fr 1fr 1fr}#iss-grid[data-active="move"]{grid-template-columns:1fr 1.6fr 1fr}#iss-grid[data-active="sideline"]{grid-template-columns:1fr 1fr 1.6fr}.iss-panel-body{padding:9px}.iss-topbar{padding:0 14px}}'
    ].join('\n');
  }

  function ensureDocument() {
    if (!document.documentElement) return false;
    let head = document.head;
    if (!head) {
      head = document.createElement('head');
      document.documentElement.insertBefore(head, document.documentElement.firstChild || null);
    }
    let body = document.body;
    if (!body) {
      body = document.createElement('body');
      document.documentElement.appendChild(body);
    }
    return true;
  }

  function paintEditChoices() {
    const groups = [
      ['[data-edit-source-value]', $('[data-edit-source]')?.value, 'editSourceValue'],
      ['[data-edit-source-damage-value]', $('[data-edit-source-damage]')?.value, 'editSourceDamageValue'],
      ['[data-edit-dest-value]', $('[data-edit-dest]')?.value, 'editDestValue'],
      ['[data-edit-dest-damage-value]', $('[data-edit-dest-damage]')?.value, 'editDestDamageValue']
    ];
    for (const [selector, selected, key] of groups) {
      for (const button of $$(selector)) {
        button.dataset.active = button.dataset[key] === selected ? '1' : '0';
      }
    }
    for (const button of $$('[data-edit-mode]')) button.dataset.active = button.dataset.editMode === editMode ? '1' : '0';
  }

  function syncEditUi(save = true) {
    const source = $('[data-edit-source]');
    const dest = $('[data-edit-dest]');
    const each = editMode === 'each';
    const sourceWrap = $('[data-edit-source-wrap]');
    const autoSource = $('[data-edit-auto-source]');
    const sourceDamage = $('[data-edit-source-damage-wrap]');
    const destDamage = $('[data-edit-dest-damage-wrap]');
    const itemLabel = $('[data-edit-items-label]');
    const items = $('[data-edit-items]');
    const run = $('[data-edit-run]');

    if (sourceWrap) sourceWrap.hidden = each;
    if (autoSource) autoSource.hidden = !each;
    sourceDamage?.setAttribute('data-show', !each && source?.value === 'Unsellable' ? '1' : '0');
    destDamage?.setAttribute('data-show', dest?.value === 'Unsellable' ? '1' : '0');

    if (itemLabel) itemLabel.textContent = each
      ? 'ITEM ROWS — TOTE ASIN [FNSKU]'
      : 'ITEM BARCODES / ASIN / FNSKU / FCSKU';
    if (items) items.placeholder = each
      ? 'tsX...  B0...  [X0...] — one row per item'
      : 'Scan or paste one per line';
    if (run) run.textContent = each ? 'RUN EACH' : 'RUN SKU';
    const engine = $('[data-edit-engine]');
    if (engine) engine.textContent = editMode.toUpperCase();

    paintEditChoices();
    if (save) storeSet('editMode', editMode);
  }

  function setEditChoice(kind, value) {
    const map = {
      source: ['[data-edit-source]', 'editSource'],
      sourceDamage: ['[data-edit-source-damage]', 'editSourceDamage'],
      dest: ['[data-edit-dest]', 'editDest'],
      destDamage: ['[data-edit-dest-damage]', 'editDestDamage']
    };
    const [selector, storeKey] = map[kind] || [];
    const input = selector ? $(selector) : null;
    if (!input) return;
    input.value = value;
    storeSet(storeKey, value);
    syncEditUi(false);
  }

  async function switchEditMode(mode) {
    if (!['each','sku'].includes(mode)) return;
    if (editMode === mode) {
      syncEditUi();
      return;
    }

    const previous = editMode;
    editMode = mode;
    syncEditUi();
    setActivePanel('edit');
    setPanelLoading('edit', true, 'Switching ' + mode.toUpperCase() + '…');
    panelStatus('edit', 'Switching EditItems mode…', 'working');

    try {
      await rpc('aft', 'mode', { key: 'edit:' + mode }, 30000);
      panelStatus('edit', mode.toUpperCase() + ' ready', 'ok');
    } catch (error) {
      editMode = previous;
      syncEditUi();
      panelStatus('edit', error.message, 'error');
    } finally {
      setPanelLoading('edit', false);
      syncEditUi(false);
    }
  }

  function paintMoveMode() {
    for (const button of $$('[data-move-mode]')) button.dataset.active = button.dataset.moveMode === moveMode ? '1' : '0';
    $('[data-move-engine]').textContent = moveMode.toUpperCase();
    $('[data-move-qty-wrap]')?.setAttribute('data-show', moveMode === 'qty' ? '1' : '0');
    storeSet('moveMode', moveMode);
  }

  async function switchMoveMode(mode) {
    if (!['all','each','qty'].includes(mode)) return;
    moveMode = mode;
    paintMoveMode();
    setActivePanel('move');
    const label = mode === 'qty' ? 'QTY mode selected' : mode === 'each' ? 'EACH selected • 1 unit per item' : 'ALL quantity selected';
    panelStatus('move', label, 'ok');
  }

  function paintClearSourceToggle() {
    const box = $('[data-clear-source]');
    const button = $('[data-clear-source-toggle]');
    if (box && button) {
      button.dataset.active = box.checked ? '1' : '0';
      button.textContent = 'CLEAR SOURCE: ' + (box.checked ? 'ON' : 'OFF');
    }

    const delayBox = $('[data-lazy-delay]');
    const delayButton = $('[data-lazy-delay-toggle]');
    if (delayBox && delayButton) {
      delayButton.dataset.active = delayBox.checked ? '1' : '0';
      delayButton.textContent = 'DELAY 2–8s: ' + (delayBox.checked ? 'ON' : 'OFF');
    }

    const liveDelayBox = $('[data-live-delay]');
    const liveDelayButton = $('[data-live-delay-toggle]');
    if (liveDelayBox && liveDelayButton) {
      liveDelayButton.dataset.active = liveDelayBox.checked ? '1' : '0';
      liveDelayButton.textContent = 'DELAY 5–11s: ' + (liveDelayBox.checked ? 'ON' : 'OFF');
    }
  }

  function syncSidelineModeUi(save = true) {
    for (const button of $$('[data-side-mode]')) button.dataset.active = button.dataset.sideMode === sidelineMode ? '1' : '0';
    $('[data-side-engine]').textContent = sidelineMode.toUpperCase();

    const source = $('[data-side-source]');
    const dest = $('[data-side-dest]');
    const items = $('[data-side-items]');
    const sourceLabel = $('[data-side-source-label]');
    const itemsLabel = $('[data-side-items-label]');
    const run = $('[data-side-run]');
    const clearWrap = $('[data-clear-source-wrap]');
    const clearSourceButton = $('[data-clear-source-toggle]');
    const lazyDelayButton = $('[data-lazy-delay-toggle]');
    const liveDelayButton = $('[data-live-delay-toggle]');
    const lazyMetrics = $('[data-side-lazy-metrics]');

    if (source) source.disabled = sidelineMode === 'queue';
    if (dest) dest.disabled = sidelineMode === 'queue' || sidelineMode === 'scrubber';
    if (items) items.disabled = sidelineMode === 'scrubber';

    if (sourceLabel) sourceLabel.textContent = sidelineMode === 'scrubber' ? 'TOTE' : 'SOURCE';
    if (itemsLabel) itemsLabel.textContent = sidelineMode === 'queue' ? 'CONTAINERS' : 'ITEM BARCODES';
    if (clearWrap) clearWrap.dataset.show = ['lazy','live'].includes(sidelineMode) ? '1' : '0';
    if (clearSourceButton) clearSourceButton.hidden = sidelineMode !== 'lazy';
    if (lazyDelayButton) lazyDelayButton.hidden = sidelineMode !== 'lazy';
    if (liveDelayButton) liveDelayButton.hidden = sidelineMode !== 'live';
    if (lazyMetrics) lazyMetrics.dataset.show = sidelineMode === 'lazy' ? '1' : '0';
    if (sidelineMode === 'lazy' && !sidelineRunBusy) paintLazyMetricsFromInput();
    paintClearSourceToggle();

    if (run) {
      run.disabled = sidelineMode === 'scrubber';
      run.textContent =
        sidelineMode === 'queue' ? 'RUN QUEUE' :
        sidelineMode === 'lazy' ? 'RUN LAZY' :
        sidelineMode === 'live' ? 'ARM LIVE' :
        'SCAN TOTE';
    }
    if (save) storeSet('sidelineMode', sidelineMode);
  }

  async function switchSidelineMode(mode) {
    if (!['scrubber','queue','lazy','live'].includes(mode)) return;
    if (sidelineMode === mode) {
      syncSidelineModeUi();
      return;
    }

    const previous = sidelineMode;
    sidelineMode = mode;
    sidelineCompletionStatus = '';
    syncSidelineModeUi();
    setActivePanel('sideline');
    setPanelLoading('sideline', true, 'Switching ' + mode.toUpperCase() + '…');
    panelStatus('sideline', 'Switching Sideline mode…', 'working');

    try {
      await rpc('sideline', 'mode', { mode }, 20000);
      panelStatus('sideline', mode.toUpperCase() + ' ready', 'ok');
    } catch (error) {
      sidelineMode = previous;
      syncSidelineModeUi();
      panelStatus('sideline', error.message, 'error');
    } finally {
      setPanelLoading('sideline', false);
      syncSidelineModeUi(false);
    }
  }

  async function runEdit() {
    const sourceState = $('[data-edit-source]')?.value || 'Sellable';
    const destState = $('[data-edit-dest]')?.value || 'Pending Research';
    const itemText = $('[data-edit-items]')?.value || '';
    if (!clean(itemText)) return panelStatus('edit', 'Scan/paste at least one item', 'error');

    setActivePanel('edit');
    setPanelLoading('edit', true, 'Running EditItems…');
    panelStatus('edit', 'Starting EditItems…', 'working');
    try {
      const result = await rpc('aft', 'edit.run', {
        mode:editMode,
        sourceState,
        sourceDamage:$('[data-edit-source-damage]')?.value || 'Defective',
        destState,
        destDamage:$('[data-edit-dest-damage]')?.value || 'Defective',
        items:itemText
      }, LONG_TIMEOUT);

      const editItems = $('[data-edit-items]');
      const failed = Array.isArray(result?.failed) ? result.failed : [];
      if (failed.length) {
        if (editItems) editItems.value = failed.map(item => clean(item?.sku || item?.code || '')).filter(Boolean).join('\n');
        panelStatus(
          'edit',
          'DONE • ' + (Number(result?.flipped) || 0) + ' flipped • ' +
            (Number(result?.zero) || 0) + ' zero • ' + failed.length + ' failed',
          'error'
        );
      } else {
        if (editItems) editItems.value = '';
        panelStatus('edit', 'SUCCESS ✓ → ' + destState + ' • ' + result.done + '/' + result.total, 'ok');
      }
      editItems?.focus();
    } catch (error) {
      const editItems = $('[data-edit-items]');
      const remaining = Array.isArray(error?.data?.remaining)
        ? error.data.remaining.map(value => clean(value)).filter(Boolean)
        : [];
      if (remaining.length && editItems) editItems.value = remaining.join('\n');
      panelStatus(
        'edit',
        error.message + (remaining.length ? ' • remaining queue kept' : ''),
        'error'
      );
      editItems?.focus();
    } finally {
      setPanelLoading('edit', false);
    }
  }

  async function runMove() {
    const source = clean($('[data-move-source]')?.value);
    const dest = clean($('[data-move-dest]')?.value);
    const items = collectLines($('[data-move-items]')?.value);
    const qty = Number($('[data-move-qty]')?.value);

    if (!validContainer(source)) return panelStatus('move', 'Invalid source container', 'error');
    if (!validContainer(dest)) return panelStatus('move', 'Invalid destination container', 'error');
    if (upper(source) === upper(dest)) return panelStatus('move', 'Source and destination cannot match', 'error');
    if (!items.length) return panelStatus('move', 'Scan/paste at least one item', 'error');
    if (moveMode === 'qty' && (!Number.isSafeInteger(qty) || qty < 1)) return panelStatus('move', 'Enter QTY', 'error');

    setActivePanel('move');
    setPanelLoading('move', true, 'Running MoveItems…');
    panelStatus('move', 'Starting MoveItems…', 'working');
    try {
      const workerMode = moveMode === 'each' ? 'qty' : moveMode;
      const workerQty = moveMode === 'each' ? 1 : qty;
      const result = await rpc('aft', 'move.run', { source, dest, items, mode: workerMode, qty: workerQty }, LONG_TIMEOUT);
      const moveSource = $('[data-move-source]');
      const moveDest = $('[data-move-dest]');
      const moveItems = $('[data-move-items]');
      const moveQty = $('[data-move-qty]');
      if (moveSource) moveSource.value = '';
      if (moveDest) moveDest.value = '';
      if (moveItems) moveItems.value = '';
      if (moveQty) moveQty.value = '';
      panelStatus('move', 'SUCCESS ✓ → ' + dest + ' • ' + result.done + '/' + result.total + ' moved', 'ok');
      (moveMode === 'qty' ? moveQty : moveSource)?.focus();
    } catch (error) {
      const moveItems = $('[data-move-items]');
      const partial = error?.data?.kind === 'move' ? error.data : null;
      const remaining = Array.isArray(partial?.remaining)
        ? partial.remaining.map(value => clean(value)).filter(Boolean)
        : [];

      if (partial && Number(partial.done) > 0) {
        if (remaining.length) {
          if (moveItems) moveItems.value = remaining.join('\n');
        } else if (Number(partial.done) >= Number(partial.total) && moveItems) {
          moveItems.value = '';
        }
      }

      panelStatus(
        'move',
        error.message + (
          partial && Number(partial.done) >= Number(partial.total) && Number(partial.total) > 0
            ? ' • VERIFY FINAL STATE — do not blindly rerun'
            : ''
        ),
        'error'
      );
      moveItems?.focus();
    } finally {
      setPanelLoading('move', false);
    }
  }

  async function configureLiveFromFields() {
    const source = clean($('[data-side-source]')?.value);
    const dest = clean($('[data-side-dest]')?.value);
    if (!validContainer(source)) throw new Error('Invalid source container');
    if (!validContainer(dest)) throw new Error('Invalid destination container');
    if (upper(source) === upper(dest)) throw new Error('Source and destination cannot match');

    setPanelLoading('sideline', true, 'Arming LIVE…');
    panelStatus('sideline', 'Validating Live source/destination…', 'working');
    try {
      await rpc('sideline', 'live.configure', { source, dest, delayEnabled:!!$('[data-live-delay]')?.checked }, 45000);
      panelStatus('sideline', 'LIVE ready • scan items', 'ok');
      $('[data-side-items]')?.focus();
    } finally {
      setPanelLoading('sideline', false);
    }
  }

  async function recoverLiveDestinationFromField() {
    const dest = clean($('[data-side-dest]')?.value);
    if (!validContainer(dest)) throw new Error('Invalid destination container');

    setActivePanel('sideline');
    setPanelLoading('sideline', true, 'Retrying destination…', { lock:false });
    panelStatus('sideline', 'Retrying blocked Live item…', 'working');
    try {
      await rpc('sideline', 'live.destination', { dest }, 30000);
      panelStatus('sideline', 'LIVE destination accepted • retrying item', 'ok');
      $('[data-side-items]')?.focus();
    } finally {
      setPanelLoading('sideline', false);
    }
  }

  async function runSideline() {
    const source = clean($('[data-side-source]')?.value);
    const dest = clean($('[data-side-dest]')?.value);
    const itemText = $('[data-side-items]')?.value || '';
    const items = sidelineMode === 'lazy'
      ? collectLazyLines(itemText, source, dest)
      : collectLines(itemText);

    setActivePanel('sideline');

    if (sidelineMode === 'live') {
      try { await configureLiveFromFields(); }
      catch (error) { panelStatus('sideline', error.message, 'error'); }
      return;
    }

    if (sidelineMode === 'queue') {
      if (!clean(itemText)) return panelStatus('sideline', 'Paste/scan containers into CONTAINERS', 'error');
      setPanelLoading('sideline', true, 'Running queue…');
      panelStatus('sideline', 'Starting queue…', 'working');
      try {
        const result = await rpc('sideline', 'queue.run', { items:itemText }, LONG_TIMEOUT);
        panelStatus('sideline', 'DONE ✓ ' + result.done + '/' + result.total + (result.failed?.length ? ' • ' + result.failed.length + ' failed' : ''), result.failed?.length ? 'error' : 'ok');
      } catch (error) {
        if (!error?.data?.cancelled) panelStatus('sideline', error.message, 'error');
      } finally {
        setPanelLoading('sideline', false);
      }
      return;
    }

    if (sidelineMode === 'lazy') {
      if (!validContainer(source)) return panelStatus('sideline', 'Invalid source container', 'error');
      if (!validContainer(dest)) return panelStatus('sideline', 'Invalid destination container', 'error');
      if (upper(source) === upper(dest)) return panelStatus('sideline', 'Source and destination cannot match', 'error');
      if (!items.length) return panelStatus('sideline', 'Scan/paste at least one item', 'error');

      sidelineRunBusy = true;
      sidelineCompletionStatus = '';
      sidelineItemsSignature = '';
      paintLazyMetrics(lazyMetricsFromLines(items));
      observe('LAZY_INPUT_COUNTS', {
        total:items.length,
        unique:new Set(items.map(upper)).size
      });
      renderSidelineItems([], false);
      setPanelLoading('sideline', true, 'Running Lazy…', { lock:false });
      panelStatus('sideline', 'Starting Lazy…', 'working');
      try {
        const result = await rpc('sideline', 'lazy.run', {
          source,
          dest,
          items,
          clearSource: !!$('[data-clear-source]')?.checked,
          processDelay: !!$('[data-lazy-delay]')?.checked
        }, LONG_TIMEOUT);
        const failures = Array.isArray(result.failures)
          ? result.failures
          : (Array.isArray(result.items)
              ? result.items.filter(item => ['FAILED','INVALID','SKIPPED'].includes(upper(item?.status || '')))
              : []);

        const expectedUnits = items.length;
        const movedUnits = Math.max(0, Number(result?.moved) || 0);
        const fullyMoved = !failures.length && expectedUnits > 0 && movedUnits === expectedUnits;

        sidelineItemsSignature = '';
        if (failures.length) {
          sidelineCompletionStatus = '';
          paintLazyMetrics(lazyMetricsFromItems(result.items || failures));
          renderSidelineItems(failures, true);
          panelStatus('sideline', 'INCOMPLETE • ' + movedUnits + '/' + expectedUnits + ' moved • ' + (result.failed || failures.length) + ' NOT MOVED', 'error');
        } else if (!fullyMoved) {
          sidelineCompletionStatus = '';
          paintLazyMetrics(lazyMetricsFromItems(result.items || []));
          renderSidelineItems(result.items || [], true);
          panelStatus('sideline', 'INCOMPLETE • ' + movedUnits + '/' + expectedUnits + ' moved — VERIFY BEFORE RETRY', 'error');
        } else {
          sidelineCompletionStatus = source + ' > ' + dest + ' = COMPLETE';
          resetSidelineLazyInputs();
          renderSidelineItems([], true);
          paintLazyMetrics({ total:0, unique:0, moved:0, remaining:0 });
          panelStatus('sideline', sidelineCompletionStatus, 'ok');
        }
      } catch (error) {
        if (!error?.data?.cancelled) panelStatus('sideline', error.message, 'error');
      } finally {
        sidelineRunBusy = false;
        setPanelLoading('sideline', false);
      }
    }
  }

  async function scrubScan(code) {
    const value = clean(code);
    if (!validContainer(value)) return panelStatus('sideline', 'Tote must start with tsX/csX', 'error');
    try {
      await rpc('sideline', 'scrub.scan', { item: value }, 15000);
      panelStatus('sideline', value + ' queued for scrub', 'working');
      const input = $('[data-side-source]');
      if (input) {
        input.value = '';
        input.focus();
      }
    } catch (error) {
      panelStatus('sideline', error.message, 'error');
    }
  }

  async function liveItemScan(code) {
    const value = clean(code);
    if (!value) return;
    try {
      await rpc('sideline', 'live.item', { item: value }, 15000);
      panelStatus('sideline', value + ' queued', 'working');
      const items = $('[data-side-items]');
      if (items) {
        items.value = '';
        items.focus();
      }
    } catch (error) {
      panelStatus('sideline', error.message, 'error');
    }
  }

  async function stopArea(area) {
    try {
      if (area === 'edit' || area === 'move') await rpc('aft', 'stop', {}, 8000);
      else await rpc('sideline', 'stop', {}, 8000);
      panelStatus(area, 'Stop requested', 'working');
    } catch (error) {
      panelStatus(area, error.message, 'error');
    }
  }

  async function clearArea(area) {
    if (area === 'edit') {
      const items = $('[data-edit-items]');
      if (items) items.value = '';
      panelStatus('edit', 'Cleared', '');
      items?.focus();
      return;
    }
    if (area === 'move') {
      for (const el of document.querySelectorAll('[data-move-source],[data-move-dest],[data-move-items],[data-move-qty]')) el.value = '';
      panelStatus('move', 'Cleared', '');
      (moveMode === 'qty' ? $('[data-move-qty]') : $('[data-move-source]'))?.focus();
      return;
    }

    try {
      await rpc('sideline', 'reset', { mode:sidelineMode }, 10000);
    } catch (error) {
      panelStatus('sideline', 'Reset failed • ' + error.message, 'error');
      return;
    }

    for (const el of document.querySelectorAll('[data-side-source],[data-side-dest],[data-side-items]')) el.value = '';
    sidelineRunBusy = false;
    sidelineAttention = '';
    sidelineItemsSignature = '';
    sidelineCompletionStatus = '';
    const panel = $('[data-panel="sideline"]');
    const alert = $('[data-side-alert]');
    if (panel) panel.dataset.sideAttention = '';
    if (alert) alert.dataset.show = '0';
    renderSidelineItems([], false);
    paintLazyMetrics({ total:0, unique:0, moved:0, remaining:0 });
    panelStatus('sideline', 'Cleared', '');
    $('[data-side-source]')?.focus();
  }

  function currentTextareaLine(el) {
    const value = el.value;
    const pos = el.selectionStart ?? value.length;
    const start = value.lastIndexOf('\n', Math.max(0, pos - 1)) + 1;
    const next = value.indexOf('\n', pos);
    const end = next < 0 ? value.length : next;
    return { value, start, end, code:clean(value.slice(start, end)) };
  }

  function removeTextareaLine(el, line) {
    let before = line.value.slice(0, line.start);
    let after = line.value.slice(line.end);
    if (before.endsWith('\n') && after.startsWith('\n')) after = after.slice(1);
    el.value = before + after;
    el.focus();
    el.setSelectionRange?.(el.value.length, el.value.length);
  }

  async function handleLazyTriggerScan(el, code) {
    const source = clean($('[data-side-source]')?.value);
    const dest = clean($('[data-side-dest]')?.value);
    const normalized = upper(code);
    const trigger =
      normalized === upper(source) ||
      normalized === upper(dest) ||
      normalized === upper(SIDELINE_START_TRIGGER);

    if (!trigger) return false;

    if (sidelineRunBusy) {
      const confirmingPredicant =
        sidelineAttention === 'rescan-destination' &&
        normalized === upper(dest);

      if (confirmingPredicant) {
        setPanelLoading('sideline', true, 'Confirming destination…');
        panelStatus('sideline', 'Destination scanned • confirming…', 'working');
      }

      try {
        const result = await rpc('sideline', 'lazy.scan', { code }, 15000);
        if (result?.recovery) {
          setPanelLoading('sideline', true, 'Destination confirmed • emptying destination…');
          panelStatus('sideline', 'Destination confirmed • emptying destination…', 'working');
        } else {
          panelStatus('sideline', code + ' accepted', 'working');
        }
      } catch (error) {
        if (confirmingPredicant) setPanelLoading('sideline', false);
        panelStatus('sideline', error.message, 'error');
      }
      return true;
    }

    const items = collectLazyLines(el.value, source, dest);
    if (!validContainer(source) || !validContainer(dest) || !items.length) return true;
    void runSideline();
    return true;
  }

  function textareaScannerHandler(event, area) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (area === 'sideline' && sidelineMode === 'live') {
      event.preventDefault();
      const value = clean(event.currentTarget.value);
      if (value) liveItemScan(value);
      return;
    }

    const el = event.currentTarget;
    if (area === 'move') {
      const line = currentTextareaLine(el);
      const dest = clean($('[data-move-dest]')?.value);
      if (line.code && validContainer(dest) && upper(line.code) === upper(dest)) {
        event.preventDefault();
        event.stopPropagation();
        removeTextareaLine(el, line);
        const items = collectLines(el.value);
        if (!items.length) {
          panelStatus('move', 'Scan item(s) before confirming destination', 'error');
          return;
        }
        panelStatus('move', 'Destination confirmed • starting MoveItems…', 'working');
        void runMove();
        return;
      }
    }

    if (area === 'sideline' && sidelineMode === 'lazy') {
      const line = currentTextareaLine(el);
      const source = clean($('[data-side-source]')?.value);
      const dest = clean($('[data-side-dest]')?.value);
      const isTrigger =
        upper(line.code) === upper(source) ||
        upper(line.code) === upper(dest) ||
        upper(line.code) === upper(SIDELINE_START_TRIGGER);
      if (line.code && isTrigger) {
        event.preventDefault();
        event.stopPropagation();
        removeTextareaLine(el, line);
        void handleLazyTriggerScan(el, line.code);
        return;
      }
    }

    // Scanner Enter becomes a newline, then focus stays here for the next scan.
    event.preventDefault();
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const before = el.value.slice(0, start).replace(/[\t ]+$/,'');
    const after = el.value.slice(end).replace(/^\r?\n+/,'');
    el.value = before + '\n' + after;
    const caret = before.length + 1;
    el.setSelectionRange?.(caret, caret);
  }

  function wireEvents() {
    for (const panel of $$('[data-panel]')) {
      panel.addEventListener('pointerdown', () => setActivePanel(panel.dataset.panel), true);
    }

    $('[data-exit]')?.addEventListener('click', () => {
      location.hash = '';
      location.reload();
    });

    for (const button of $$('[data-edit-mode]')) {
      button.addEventListener('click', () => switchEditMode(button.dataset.editMode));
    }
    for (const button of $$('[data-edit-source-value]')) {
      button.addEventListener('click', () => setEditChoice('source', button.dataset.editSourceValue));
    }
    for (const button of $$('[data-edit-source-damage-value]')) {
      button.addEventListener('click', () => setEditChoice('sourceDamage', button.dataset.editSourceDamageValue));
    }
    for (const button of $$('[data-edit-dest-value]')) {
      button.addEventListener('click', () => setEditChoice('dest', button.dataset.editDestValue));
    }
    for (const button of $$('[data-edit-dest-damage-value]')) {
      button.addEventListener('click', () => setEditChoice('destDamage', button.dataset.editDestDamageValue));
    }
    $('[data-edit-run]')?.addEventListener('click', runEdit);
    $('[data-edit-items]')?.addEventListener('keydown', event => textareaScannerHandler(event, 'edit'));

    for (const button of $$('[data-move-mode]')) {
      button.addEventListener('click', () => switchMoveMode(button.dataset.moveMode));
    }
    $('[data-move-qty]')?.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || moveMode !== 'qty') return;
      event.preventDefault();
      const qty = Number(event.currentTarget.value);
      if (!Number.isSafeInteger(qty) || qty < 1) {
        panelStatus('move', 'Enter QTY', 'error');
        event.currentTarget.focus();
        event.currentTarget.select();
        return;
      }
      $('[data-move-source]')?.focus();
      $('[data-move-source]')?.select();
    });
    $('[data-move-source]')?.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (!requireContainerField('move', event.currentTarget, 'SOURCE')) return;
      $('[data-move-dest]')?.focus();
      $('[data-move-dest]')?.select();
    });
    $('[data-move-dest]')?.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (!requireContainerField('move', event.currentTarget, 'DESTINATION')) return;
      $('[data-move-items]')?.focus();
      panelStatus('move', 'Scan item(s) • rescan destination to start', 'ok');
    });
    $('[data-move-items]')?.addEventListener('keydown', event => textareaScannerHandler(event, 'move'));
    $('[data-move-run]')?.addEventListener('click', runMove);

    for (const button of $$('[data-side-mode]')) {
      button.addEventListener('click', () => switchSidelineMode(button.dataset.sideMode));
    }
    $('[data-side-source]')?.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const source = requireContainerField('sideline', event.currentTarget, 'SOURCE');
      if (!source) return;
      if (sidelineMode === 'scrubber') {
        scrubScan(source);
        return;
      }
      $('[data-side-dest]')?.focus();
      $('[data-side-dest]')?.select();
    });
    $('[data-side-dest]')?.addEventListener('keydown', async event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (!requireContainerField('sideline', event.currentTarget, 'DESTINATION')) return;
      if (sidelineMode === 'live') {
        try {
          if (sidelineAttention === 'live-destination') await recoverLiveDestinationFromField();
          else await configureLiveFromFields();
        } catch (error) {
          panelStatus('sideline', error.message, 'error');
        }
        return;
      }
      $('[data-side-items]')?.focus();
    });
    $('[data-side-items]')?.addEventListener('keydown', event => textareaScannerHandler(event, 'sideline'));
    $('[data-side-run]')?.addEventListener('click', runSideline);

    for (const button of $$('[data-stop]')) button.addEventListener('click', () => stopArea(button.dataset.stop));
    for (const button of document.querySelectorAll('[data-clear]')) button.addEventListener('click', () => { void clearArea(button.dataset.clear); });
  }

  function hydrate() {
    $('[data-edit-source]').value = storeGet('editSource', 'Sellable');
    $('[data-edit-dest]').value = storeGet('editDest', 'Pending Research');
    $('[data-edit-source-damage]').value = storeGet('editSourceDamage', 'Defective');
    $('[data-edit-dest-damage]').value = storeGet('editDestDamage', 'Defective');
    $('[data-move-qty]').value = storeGet('moveQty', '');
    $('[data-clear-source]').checked = storeGet('sideClearSource', '0') === '1';
    $('[data-lazy-delay]').checked = storeGet('sideLazyDelay', '1') !== '0';
    $('[data-live-delay]').checked = storeGet('sideLiveDelay', '1') !== '0';

    $('[data-move-qty]').addEventListener('input', event => storeSet('moveQty', event.target.value));
    $('[data-clear-source]').addEventListener('change', event => {
      storeSet('sideClearSource', event.target.checked ? '1' : '0');
      paintClearSourceToggle();
    });
    $('[data-clear-source-toggle]')?.addEventListener('click', () => {
      const box = $('[data-clear-source]');
      if (!box) return;
      box.checked = !box.checked;
      box.dispatchEvent(new Event('change', { bubbles:true }));
    });
    $('[data-lazy-delay]').addEventListener('change', event => {
      storeSet('sideLazyDelay', event.target.checked ? '1' : '0');
      paintClearSourceToggle();
    });
    $('[data-lazy-delay-toggle]')?.addEventListener('click', () => {
      const box = $('[data-lazy-delay]');
      if (!box) return;
      box.checked = !box.checked;
      box.dispatchEvent(new Event('change', { bubbles:true }));
    });
    $('[data-live-delay]').addEventListener('change', event => {
      storeSet('sideLiveDelay', event.target.checked ? '1' : '0');
      paintClearSourceToggle();
      if (sidelineMode === 'live' && workers.sideline.ready) {
        rpc('sideline', 'live.delay', { enabled:event.target.checked }, 10000)
          .catch(error => panelStatus('sideline', error.message, 'error'));
      }
    });
    $('[data-live-delay-toggle]')?.addEventListener('click', () => {
      const box = $('[data-live-delay]');
      if (!box) return;
      box.checked = !box.checked;
      box.dispatchEvent(new Event('change', { bubbles:true }));
    });
    $('[data-side-live-skip]')?.addEventListener('click', () => {
      rpc('sideline', 'live.skip', {}, 15000)
        .then(() => panelStatus('sideline', 'Item skipped • Live continuing', 'working'))
        .catch(error => panelStatus('sideline', error.message, 'error'));
    });

    for (const el of document.querySelectorAll('[data-side-source],[data-side-dest],[data-side-items]')) {
      el.addEventListener('input', () => {
        if (sidelineMode === 'lazy' && !sidelineRunBusy) paintLazyMetricsFromInput();
      });
    }

    syncEditUi(false);
    paintMoveMode();
    syncSidelineModeUi(false);
    setActivePanel(activePanel);
  }

  function build() {
    if (built || !ensureDocument()) return;
    built = true;

    document.title = warehouseId() + ' ISS Console';
    const style = document.createElement('style');
    style.id = 'iss-console-style';
    style.textContent = cssText();

    document.head.replaceChildren();
    const title = document.createElement('title');
    title.textContent = document.title;
    document.head.append(title, style);

    document.body.replaceChildren();
    const root = document.createElement('div');
    root.innerHTML = appMarkup();
    document.body.append(...root.childNodes);
    document.documentElement.style.visibility = '';

    wireEvents();
    hydrate();
    spawnWorker('aft');
    spawnWorker('sideline');
    startWorkerWatchdog();

    panelStatus('edit', 'Waiting for AFT worker…', '');
    panelStatus('move', 'Waiting for AFT worker…', '');
    panelStatus('sideline', 'Waiting for Sideline worker…', '');
  }

  setTimeout(build, 0);
})();