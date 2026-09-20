// ==UserScript==
// @name         MAIN ISS Console
// @name:en      MAIN ISS Console
// @namespace    https://github.com/1Sirkkris
// @version      0.1.1
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

  const VERSION = '0.1.1';
  const HASH = '#iss-console';
  if (!location.hash.startsWith(HASH)) return;
  if (window.__ISS_CONSOLE_V011__) return;
  window.__ISS_CONSOLE_V011__ = true;

  const AFT_ORIGIN = 'https://aft-qt-jp.aka.nrt.corp.amazon.com';
  const SIDELINE_ORIGIN = 'https://aft-poirot-website-nrt.nrt.proxy.amazon.com';
  const AFT_WORKER_URL = AFT_ORIGIN + '/app/edititems?experience=Desktop#iss-console-worker';
  const SIDELINE_WORKER_URL = SIDELINE_ORIGIN + '/#iss-console-worker';
  const STORE_PREFIX = 'issConsole.v1.';
  const DEFAULT_TIMEOUT = 20000;
  const LONG_TIMEOUT = 12 * 60 * 1000;

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
      pending: new Map()
    },
    sideline: {
      origin: SIDELINE_ORIGIN,
      url: SIDELINE_WORKER_URL,
      frame: null,
      ready: false,
      version: '',
      pending: new Map()
    }
  };

  let rpcSeq = 0;
  let activePanel = storeGet('activePanel', 'edit');
  let moveMode = storeGet('moveMode', 'all');
  let sidelineMode = storeGet('sidelineMode', 'lazy');
  let built = false;

  function nextRpcId(worker) {
    rpcSeq++;
    return worker + ':' + Date.now() + ':' + rpcSeq;
  }

  function workerFrame(worker) {
    return workers[worker]?.frame?.contentWindow || null;
  }

  function rpc(worker, command, payload = {}, timeout = DEFAULT_TIMEOUT) {
    const state = workers[worker];
    if (!state) return Promise.reject(new Error('Unknown worker'));
    if (!state.ready || !workerFrame(worker)) return Promise.reject(new Error(worker + ' worker not ready'));

    const id = nextRpcId(worker);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        state.pending.delete(id);
        reject(new Error(command + ' timed out'));
      }, timeout);

      state.pending.set(id, { resolve, reject, timer, command });
      workerFrame(worker).postMessage({
        type: 'ISS_CONSOLE_RPC',
        worker,
        id,
        command,
        payload
      }, state.origin);
    });
  }

  function markWorker(worker, ready, version = '') {
    const state = workers[worker];
    if (!state) return;
    state.ready = !!ready;
    if (version) state.version = version;

    const dot = $('[data-worker-dot="' + worker + '"]');
    const label = $('[data-worker-label="' + worker + '"]');
    if (dot) dot.dataset.ready = ready ? '1' : '0';
    if (label) label.textContent = worker === 'aft'
      ? 'AFT ' + (ready ? 'READY' : 'OFFLINE')
      : 'SIDELINE ' + (ready ? 'READY' : 'OFFLINE');
  }

  function panelStatus(area, message, kind = '') {
    const el = $('[data-status="' + area + '"]');
    if (!el) return;
    el.textContent = clean(message) || 'Ready';
    el.dataset.kind = kind;
  }

  function setPanelLoading(area, on, message = '') {
    const panel = $('[data-panel="' + area + '"]');
    if (!panel) return;
    panel.dataset.loading = on ? '1' : '0';
    if (message) {
      const label = $('[data-loading-label]', panel);
      if (label) label.textContent = message;
    }
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

  function workerStateLine(worker) {
    const state = workers[worker];
    return state.ready ? ('v' + state.version) : 'connecting…';
  }

  function handleProgress(message) {
    const area = message.area;
    if (!['edit','move','sideline'].includes(area)) return;
    panelStatus(area, message.message || 'Working…', message.error ? 'error' : 'working');

    if (area === 'sideline') {
      const meta = $('[data-progress="sideline"]');
      if (meta) {
        const bits = [];
        if (Number.isFinite(Number(message.current)) && Number.isFinite(Number(message.total)) && Number(message.total) > 0) {
          bits.push(String(message.current) + '/' + String(message.total));
        }
        if (Number.isFinite(Number(message.moved))) bits.push('Moved ' + message.moved);
        if (Number.isFinite(Number(message.queued))) bits.push('Queue ' + message.queued);
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
    if (!state || event.origin !== state.origin || event.source !== workerFrame(worker)) return;

    if (message.type === 'ISS_CONSOLE_WORKER_READY') {
      markWorker(worker, true, message.version || '');
      if (worker === 'sideline') {
        rpc('sideline', 'mode', { mode: sidelineMode }, 15000)
          .then(() => syncSidelineModeUi(false))
          .catch(error => panelStatus('sideline', error.message, 'error'));
      }
      return;
    }

    if (message.type === 'ISS_CONSOLE_PROGRESS') {
      handleProgress(message);
      return;
    }

    if (message.type !== 'ISS_CONSOLE_RPC_RESULT') return;
    const pending = state.pending.get(String(message.id || ''));
    if (!pending) return;
    state.pending.delete(String(message.id || ''));
    clearTimeout(pending.timer);
    if (message.ok) pending.resolve(message.data);
    else pending.reject(new Error(message.error || pending.command + ' failed'));
  });

  function spawnWorker(worker) {
    const state = workers[worker];
    if (!state || state.frame) return;
    const frame = document.createElement('iframe');
    frame.className = 'iss-worker-frame';
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.src = state.url;
    frame.addEventListener('load', () => {
      setTimeout(() => {
        if (!state.ready) {
          try {
            frame.contentWindow.postMessage({
              type: 'ISS_CONSOLE_RPC',
              worker,
              id: nextRpcId(worker),
              command: 'ping',
              payload: {}
            }, state.origin);
          } catch {}
        }
      }, 1000);
    });
    state.frame = frame;
    document.body.appendChild(frame);
  }

  function createSelectOptions(values) {
    return values.map(value => '<option value="' + esc(value) + '">' + esc(value) + '</option>').join('');
  }

  function appMarkup() {
    const states = ['Sellable','Pending Research','Unsellable'];
    const damages = ['Amazon Damage','Defective','Distributor Damage','Expired'];
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
      '      <div class="iss-panel-head"><div><span class="iss-kicker">EDIT ITEMS</span><strong>Disposition</strong></div><span class="iss-engine">SKU</span></div>',
      '      <div class="iss-panel-body">',
      '        <label class="iss-field"><span>SOURCE</span><select data-edit-source>' + createSelectOptions(states) + '</select></label>',
      '        <label class="iss-field iss-damage" data-edit-source-damage-wrap><span>SOURCE DISPOSITION</span><select data-edit-source-damage>' + createSelectOptions(damages) + '</select></label>',
      '        <div class="iss-flow-arrow">↓</div>',
      '        <label class="iss-field"><span>DESTINATION</span><select data-edit-dest>' + createSelectOptions(states) + '</select></label>',
      '        <label class="iss-field iss-damage" data-edit-dest-damage-wrap><span>DESTINATION DISPOSITION</span><select data-edit-dest-damage>' + createSelectOptions(damages) + '</select></label>',
      '        <div class="iss-flow-arrow">↓</div>',
      '        <label class="iss-field iss-grow"><span>ITEM BARCODES / ASIN / FNSKU</span><textarea data-edit-items spellcheck="false" placeholder="Scan or paste one per line"></textarea></label>',
      '        <div class="iss-actions"><button type="button" class="iss-primary" data-edit-run>RUN EDIT</button><button type="button" data-stop="edit">STOP</button><button type="button" data-clear="edit">CLEAR</button></div>',
      '        <div class="iss-status" data-status="edit" data-kind="">Ready</div>',
      '      </div>',
      '      <div class="iss-loading"><span class="iss-spinner"></span><b data-loading-label>Working…</b></div>',
      '    </section>',
      '    <section class="iss-panel" data-panel="move" data-active="' + (activePanel === 'move' ? '1' : '0') + '">',
      '      <div class="iss-panel-head"><div><span class="iss-kicker">MOVE ITEMS</span><strong>Container move</strong></div><span class="iss-engine" data-move-engine>' + esc(moveMode.toUpperCase()) + '</span></div>',
      '      <div class="iss-panel-body">',
      '        <div class="iss-segment" data-move-modes><button type="button" data-move-mode="all">ALL</button><button type="button" data-move-mode="qty">QTY</button><button type="button" data-move-mode="each">EACH</button></div>',
      '        <label class="iss-field"><span>SOURCE</span><input data-move-source autocomplete="off" spellcheck="false" placeholder="tsX / csX"></label>',
      '        <div class="iss-flow-arrow">↓</div>',
      '        <label class="iss-field"><span>DESTINATION</span><input data-move-dest autocomplete="off" spellcheck="false" placeholder="tsX / csX"></label>',
      '        <div class="iss-flow-arrow">↓</div>',
      '        <label class="iss-field iss-grow"><span>ITEM BARCODES</span><textarea data-move-items spellcheck="false" placeholder="Scan or paste one per line"></textarea></label>',
      '        <label class="iss-inline-field" data-move-qty-wrap><span>QTY</span><input type="number" min="1" max="999999" data-move-qty></label>',
      '        <div class="iss-actions"><button type="button" class="iss-primary" data-move-run>RUN MOVE</button><button type="button" data-stop="move">STOP</button><button type="button" data-clear="move">CLEAR</button></div>',
      '        <div class="iss-status" data-status="move" data-kind="">Ready</div>',
      '      </div>',
      '      <div class="iss-loading"><span class="iss-spinner"></span><b data-loading-label>Switching mode…</b></div>',
      '    </section>',
      '    <section class="iss-panel" data-panel="sideline" data-active="' + (activePanel === 'sideline' ? '1' : '0') + '">',
      '      <div class="iss-panel-head"><div><span class="iss-kicker">SIDELINE</span><strong>Container workflow</strong></div><span class="iss-engine" data-side-engine>' + esc(sidelineMode.toUpperCase()) + '</span></div>',
      '      <div class="iss-panel-body">',
      '        <div class="iss-segment iss-segment-side" data-side-modes><button type="button" data-side-mode="scrubber">SCRUBBER</button><button type="button" data-side-mode="queue">QUEUE</button><button type="button" data-side-mode="lazy">LAZY</button><button type="button" data-side-mode="live">LIVE</button></div>',
      '        <label class="iss-field"><span data-side-source-label>SOURCE</span><input data-side-source autocomplete="off" spellcheck="false" placeholder="tsX / csX"></label>',
      '        <div class="iss-flow-arrow">↓</div>',
      '        <label class="iss-field"><span>DESTINATION</span><input data-side-dest autocomplete="off" spellcheck="false" placeholder="tsX / csX"></label>',
      '        <div class="iss-flow-arrow">↓</div>',
      '        <label class="iss-field iss-grow"><span data-side-items-label>ITEM BARCODES</span><textarea data-side-items spellcheck="false" placeholder="Scan or paste one per line"></textarea></label>',
      '        <label class="iss-check" data-clear-source-wrap><input type="checkbox" data-clear-source><span>Clear source after successful Lazy run</span></label>',
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
      '.iss-panel-head{min-height:58px;padding:9px 11px 9px 13px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #cbd2d9;background:#f3f4f5;box-shadow:inset 4px 0 #8798a8}',
      '.iss-panel[data-active="1"] .iss-panel-head{box-shadow:inset 4px 0 #146eb4;background:#eef4f8}.iss-panel-head>div{display:grid;gap:2px}.iss-kicker{font-size:10px;font-weight:900;letter-spacing:.6px;color:#6d7882}.iss-panel-head strong{font-size:15px;color:#20364a}.iss-engine{padding:3px 7px;border:1px solid #b4bec8;border-radius:3px;background:#fff;color:#425365;font-size:10px;font-weight:900}',
      '.iss-panel-body{flex:1;display:flex;flex-direction:column;gap:8px;padding:12px}.iss-field{display:grid;gap:5px}.iss-field>span,.iss-inline-field>span{font-size:10px;font-weight:900;letter-spacing:.35px;color:#536171}.iss-field input,.iss-field select,.iss-field textarea,.iss-inline-field input{width:100%;border:1px solid #aeb9c3;border-radius:3px;background:#fff;color:#111827;font:700 13px Arial,sans-serif;outline:none}.iss-field input,.iss-field select{height:38px;padding:0 9px}.iss-field textarea{min-height:150px;flex:1;padding:9px;resize:vertical;font-family:Consolas,monospace;line-height:1.45}.iss-field input:focus,.iss-field select:focus,.iss-field textarea:focus,.iss-inline-field input:focus{border-color:#146eb4;box-shadow:0 0 0 2px rgba(20,110,180,.13)}',
      '.iss-field input:disabled,.iss-field textarea:disabled,.iss-field select:disabled{background:#eceff1;color:#8a949e;border-color:#c8ced4}.iss-grow{flex:1}.iss-flow-arrow{text-align:center;height:12px;color:#7b8793;font-weight:900;line-height:12px}',
      '.iss-damage{display:none}.iss-damage[data-show="1"]{display:grid}',
      '.iss-segment{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-bottom:2px}.iss-segment-side{grid-template-columns:repeat(4,1fr)}.iss-segment button{height:31px;border:1px solid #aeb8c2;border-radius:3px;background:#f7f8fa;color:#33475b;font-size:10px;font-weight:900;cursor:pointer}.iss-segment button[data-active="1"]{background:#365f7e;color:#fff;border-color:#294d69}.iss-segment button:hover:not(:disabled){background:#e7edf2}.iss-segment button[data-active="1"]:hover{background:#365f7e}',
      '.iss-inline-field{display:none;grid-template-columns:auto 90px;align-items:center;gap:8px;padding:7px 8px;background:#f7f8fa;border:1px solid #cbd2d9;border-radius:3px}.iss-inline-field[data-show="1"]{display:grid}.iss-inline-field input{height:32px;padding:0 7px;text-align:center}',
      '.iss-check{display:none;align-items:center;gap:7px;font-size:11px;font-weight:700;color:#495868}.iss-check[data-show="1"]{display:flex}.iss-check input{width:16px;height:16px}',
      '.iss-actions{display:grid;grid-template-columns:1.5fr .7fr .7fr;gap:6px;margin-top:2px}.iss-actions button{height:36px;border:1px solid #a9b3bd;border-radius:3px;background:#f5f6f7;color:#26384a;font-weight:900;cursor:pointer}.iss-actions .iss-primary{background:#146eb4;border-color:#0f5f9d;color:#fff}.iss-actions button:hover:not(:disabled){filter:brightness(.97)}.iss-actions button:disabled{opacity:.5;cursor:not-allowed}',
      '.iss-status{min-height:31px;padding:7px 8px;border:1px solid #c7d0d8;background:#f8f9fa;color:#38495a;font-size:11px;font-weight:800}.iss-status[data-kind="working"]{border-color:#8db3d0;background:#eef6fb;color:#174a70}.iss-status[data-kind="ok"]{border-color:#8fbea0;background:#f0f8f2;color:#1d5f32}.iss-status[data-kind="error"]{border-color:#d7a0a0;background:#fff3f3;color:#8c2525}.iss-status-line{display:grid;grid-template-columns:1fr auto;align-items:center;gap:8px}.iss-progress{font-size:10px;font-weight:800;color:#65727f;white-space:nowrap}',
      '.iss-loading{position:absolute;inset:58px 0 0;z-index:20;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:rgba(229,233,236,.68);backdrop-filter:grayscale(.38) saturate(.75) brightness(.96);opacity:0;pointer-events:none;transition:opacity .12s ease}.iss-panel[data-loading="1"] .iss-loading{opacity:1}.iss-loading b{padding:4px 8px;border:1px solid rgba(81,100,116,.28);border-radius:3px;background:rgba(255,255,255,.88);font-size:10px;color:#3f5366}.iss-spinner{width:42px;height:42px;border:5px solid rgba(255,255,255,.85);border-top-color:#146eb4;border-right-color:#146eb4;border-radius:50%;box-shadow:0 2px 9px rgba(0,0,0,.17);animation:issSpin .72s linear infinite}@keyframes issSpin{to{transform:rotate(360deg)}}',
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

  function syncEditDamageUi() {
    const source = $('[data-edit-source]');
    const dest = $('[data-edit-dest]');
    $('[data-edit-source-damage-wrap]')?.setAttribute('data-show', source?.value === 'Unsellable' ? '1' : '0');
    $('[data-edit-dest-damage-wrap]')?.setAttribute('data-show', dest?.value === 'Unsellable' ? '1' : '0');
  }

  function paintMoveMode() {
    for (const button of $$('[data-move-mode]')) button.dataset.active = button.dataset.moveMode === moveMode ? '1' : '0';
    $('[data-move-engine]').textContent = moveMode.toUpperCase();
    $('[data-move-qty-wrap]')?.setAttribute('data-show', moveMode === 'qty' ? '1' : '0');
    storeSet('moveMode', moveMode);
  }

  async function switchMoveMode(mode) {
    if (!['all','qty','each'].includes(mode) || moveMode === mode) {
      moveMode = mode;
      paintMoveMode();
      return;
    }
    const previous = moveMode;
    const previousBackend = previous === 'each' ? 'move:each' : 'move:multi';
    const nextBackend = mode === 'each' ? 'move:each' : 'move:multi';

    setActivePanel('move');
    if (previousBackend === nextBackend) {
      moveMode = mode;
      paintMoveMode();
      panelStatus('move', mode.toUpperCase() + ' selected', 'ok');
      return;
    }

    setPanelLoading('move', true, 'Switching ' + mode.toUpperCase() + '…');
    panelStatus('move', 'Switching backend mode…', 'working');
    try {
      await rpc('aft', 'mode', { key: nextBackend }, 30000);
      moveMode = mode;
      paintMoveMode();
      panelStatus('move', mode.toUpperCase() + ' ready', 'ok');
    } catch (error) {
      moveMode = previous;
      paintMoveMode();
      panelStatus('move', error.message, 'error');
    } finally {
      setPanelLoading('move', false);
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

    if (source) source.disabled = sidelineMode === 'queue';
    if (dest) dest.disabled = sidelineMode === 'queue' || sidelineMode === 'scrubber';
    if (items) items.disabled = sidelineMode === 'scrubber';

    if (sourceLabel) sourceLabel.textContent = sidelineMode === 'scrubber' ? 'TOTE' : 'SOURCE';
    if (itemsLabel) itemsLabel.textContent = sidelineMode === 'queue' ? 'CONTAINERS' : 'ITEM BARCODES';
    if (clearWrap) clearWrap.dataset.show = sidelineMode === 'lazy' ? '1' : '0';

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
    if (!['scrubber','queue','lazy','live'].includes(mode) || sidelineMode === mode) {
      sidelineMode = mode;
      syncSidelineModeUi();
      return;
    }
    const previous = sidelineMode;
    setActivePanel('sideline');
    setPanelLoading('sideline', true, 'Switching ' + mode.toUpperCase() + '…');
    panelStatus('sideline', 'Switching Sideline mode…', 'working');
    try {
      await rpc('sideline', 'mode', { mode }, 20000);
      sidelineMode = mode;
      syncSidelineModeUi();
      panelStatus('sideline', mode.toUpperCase() + ' ready', 'ok');
    } catch (error) {
      sidelineMode = previous;
      syncSidelineModeUi();
      panelStatus('sideline', error.message, 'error');
    } finally {
      setPanelLoading('sideline', false);
    }
  }

  async function runEdit() {
    const sourceState = $('[data-edit-source]')?.value || 'Sellable';
    const destState = $('[data-edit-dest]')?.value || 'Pending Research';
    const items = collectLines($('[data-edit-items]')?.value);
    if (!items.length) return panelStatus('edit', 'Scan/paste at least one item', 'error');

    setActivePanel('edit');
    setPanelLoading('edit', true, 'Running EditItems…');
    panelStatus('edit', 'Starting EditItems…', 'working');
    try {
      const result = await rpc('aft', 'edit.run', {
        sourceState,
        sourceDamage: $('[data-edit-source-damage]')?.value || 'Defective',
        destState,
        destDamage: $('[data-edit-dest-damage]')?.value || 'Defective',
        items
      }, LONG_TIMEOUT);
      panelStatus('edit', 'DONE ✓ ' + result.done + '/' + result.total, 'ok');
    } catch (error) {
      panelStatus('edit', error.message, 'error');
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
      const result = await rpc('aft', 'move.run', { source, dest, items, mode: moveMode, qty }, LONG_TIMEOUT);
      panelStatus('move', 'DONE ✓ ' + result.done + '/' + result.total, 'ok');
    } catch (error) {
      panelStatus('move', error.message, 'error');
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
      await rpc('sideline', 'live.configure', { source, dest }, 45000);
      panelStatus('sideline', 'LIVE ready • scan items', 'ok');
      $('[data-side-items]')?.focus();
    } finally {
      setPanelLoading('sideline', false);
    }
  }

  async function runSideline() {
    const source = clean($('[data-side-source]')?.value);
    const dest = clean($('[data-side-dest]')?.value);
    const items = collectLines($('[data-side-items]')?.value);

    setActivePanel('sideline');

    if (sidelineMode === 'live') {
      try { await configureLiveFromFields(); }
      catch (error) { panelStatus('sideline', error.message, 'error'); }
      return;
    }

    if (sidelineMode === 'queue') {
      if (!items.length) return panelStatus('sideline', 'Paste/scan containers into CONTAINERS', 'error');
      setPanelLoading('sideline', true, 'Running queue…');
      panelStatus('sideline', 'Starting queue…', 'working');
      try {
        const result = await rpc('sideline', 'queue.run', { items }, LONG_TIMEOUT);
        panelStatus('sideline', 'DONE ✓ ' + result.done + '/' + result.total + (result.failed?.length ? ' • ' + result.failed.length + ' failed' : ''), result.failed?.length ? 'error' : 'ok');
      } catch (error) {
        panelStatus('sideline', error.message, 'error');
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

      setPanelLoading('sideline', true, 'Running Lazy…');
      panelStatus('sideline', 'Starting Lazy…', 'working');
      try {
        const result = await rpc('sideline', 'lazy.run', {
          source,
          dest,
          items,
          clearSource: !!$('[data-clear-source]')?.checked
        }, LONG_TIMEOUT);
        panelStatus('sideline', result.message || ('DONE ✓ moved ' + result.moved), result.failed ? 'error' : 'ok');
      } catch (error) {
        panelStatus('sideline', error.message, 'error');
      } finally {
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

  function clearArea(area) {
    if (area === 'edit') {
      const items = $('[data-edit-items]');
      if (items) items.value = '';
      panelStatus('edit', 'Cleared', '');
      items?.focus();
      return;
    }
    if (area === 'move') {
      for (const el of $$('[data-move-source],[data-move-dest],[data-move-items],[data-move-qty]')) el.value = '';
      panelStatus('move', 'Cleared', '');
      $('[data-move-source]')?.focus();
      return;
    }
    for (const el of $$('[data-side-source],[data-side-dest],[data-side-items]')) el.value = '';
    panelStatus('sideline', 'Cleared', '');
    $('[data-side-source]')?.focus();
  }

  function textareaScannerHandler(event, area) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (area === 'sideline' && sidelineMode === 'live') {
      event.preventDefault();
      const value = clean(event.currentTarget.value);
      if (value) liveItemScan(value);
      return;
    }
    // Scanner Enter becomes a newline, then focus stays here for the next scan.
    event.preventDefault();
    const el = event.currentTarget;
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

    $('[data-edit-source]')?.addEventListener('change', syncEditDamageUi);
    $('[data-edit-dest]')?.addEventListener('change', syncEditDamageUi);
    $('[data-edit-run]')?.addEventListener('click', runEdit);
    $('[data-edit-items]')?.addEventListener('keydown', event => textareaScannerHandler(event, 'edit'));

    for (const button of $$('[data-move-mode]')) {
      button.addEventListener('click', () => switchMoveMode(button.dataset.moveMode));
    }
    $('[data-move-source]')?.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      $('[data-move-dest]')?.focus();
      $('[data-move-dest]')?.select();
    });
    $('[data-move-dest]')?.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      $('[data-move-items]')?.focus();
    });
    $('[data-move-items]')?.addEventListener('keydown', event => textareaScannerHandler(event, 'move'));
    $('[data-move-run]')?.addEventListener('click', runMove);

    for (const button of $$('[data-side-mode]')) {
      button.addEventListener('click', () => switchSidelineMode(button.dataset.sideMode));
    }
    $('[data-side-source]')?.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const source = clean(event.currentTarget.value);
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
      if (sidelineMode === 'live') {
        try { await configureLiveFromFields(); }
        catch (error) { panelStatus('sideline', error.message, 'error'); }
        return;
      }
      $('[data-side-items]')?.focus();
    });
    $('[data-side-items]')?.addEventListener('keydown', event => textareaScannerHandler(event, 'sideline'));
    $('[data-side-run]')?.addEventListener('click', runSideline);

    for (const button of $$('[data-stop]')) button.addEventListener('click', () => stopArea(button.dataset.stop));
    for (const button of $$('[data-clear]')) button.addEventListener('click', () => clearArea(button.dataset.clear));
  }

  function hydrate() {
    $('[data-edit-source]').value = storeGet('editSource', 'Sellable');
    $('[data-edit-dest]').value = storeGet('editDest', 'Pending Research');
    $('[data-edit-source-damage]').value = storeGet('editSourceDamage', 'Defective');
    $('[data-edit-dest-damage]').value = storeGet('editDestDamage', 'Defective');
    $('[data-move-qty]').value = storeGet('moveQty', '');
    $('[data-clear-source]').checked = storeGet('sideClearSource', '0') === '1';

    $('[data-edit-source]').addEventListener('change', event => storeSet('editSource', event.target.value));
    $('[data-edit-dest]').addEventListener('change', event => storeSet('editDest', event.target.value));
    $('[data-edit-source-damage]').addEventListener('change', event => storeSet('editSourceDamage', event.target.value));
    $('[data-edit-dest-damage]').addEventListener('change', event => storeSet('editDestDamage', event.target.value));
    $('[data-move-qty]').addEventListener('input', event => storeSet('moveQty', event.target.value));
    $('[data-clear-source]').addEventListener('change', event => storeSet('sideClearSource', event.target.checked ? '1' : '0'));

    syncEditDamageUi();
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

    panelStatus('edit', 'Waiting for AFT worker…', '');
    panelStatus('move', 'Waiting for AFT worker…', '');
    panelStatus('sideline', 'Waiting for Sideline worker…', '');
  }

  setTimeout(build, 0);
})();