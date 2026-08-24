// ==UserScript==
// @name         TEST v0.2.17 Dropzone Selector Queue
// @namespace    MONKIES
// @version      0.2.17
// @description  TEST: Dropzone Selector + direct sequential MoveContainer API queue; stable queue rendering and throttled page detection.
// @match        aft-moveapp-nrt-nrt.nrt.proxy.amazon.com/move-container*
// @match        aft-moveapp-*.proxy.amazon.com/move-container*
// @grant        GM_xmlhttpRequest
// @connect      aft-moveapp-nrt-nrt.nrt.proxy.amazon.com
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Dropzone_Selector_Queue.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Dropzone_Selector_Queue.user.js
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = '0.2.17';

  const STORAGE_DZ = 'moveapp_dz_selector_type_v021';
  const STORAGE_FLOOR = 'moveapp_dz_selector_floor_v021';
  const STORAGE_ENABLED = 'moveapp_dz_selector_enabled_v021';


  const STORAGE_QUEUE = 'moveapp_dz_selector_queue_v2';
  const STORAGE_QUEUE_DRAFT = 'moveapp_dz_selector_queue_draft_v1';
  const STORAGE_QUEUE_INPUT_ENABLED = 'moveapp_dz_selector_queue_input_enabled_v1';
  const MOVE_URL = 'https://aft-moveapp-nrt-nrt.nrt.proxy.amazon.com/api/move-container';
  const QUEUE_REQUEST_TIMEOUT_MS = 15000;
  const QUEUE_NEXT_GAP_MS = 180;

  let queueRequestActive = false;
  let queueState = loadQueueState();

  function defaultQueueState() {
    return {
      running: false,
      lockedDz: '',
      currentId: '',
      phase: 'idle',
      message: '',
      invalidInputs: [],
      items: []
    };
  }

  function loadQueueState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_QUEUE) || 'null');
      if (!parsed || !Array.isArray(parsed.items)) return defaultQueueState();
      return {
        running: !!parsed.running,
        lockedDz: String(parsed.lockedDz || ''),
        currentId: String(parsed.currentId || ''),
        phase: String(parsed.phase || 'idle'),
        message: String(parsed.message || ''),
        invalidInputs: Array.isArray(parsed.invalidInputs)
          ? parsed.invalidInputs.map(x => String(x || '').trim()).filter(Boolean).slice(-50)
          : [],
        items: parsed.items
          .filter(x => x && /^(?:tsX|csX)[A-Za-z0-9]+$/i.test(String(x.id || '')))
          .map(x => ({
            id: String(x.id),
            status: ['queued', 'active', 'done', 'attention'].includes(x.status) ? x.status : 'queued',
            error: String(x.error || '')
          }))
      };
    } catch (_) {
      return defaultQueueState();
    }
  }

  function saveQueueState() {
    try { localStorage.setItem(STORAGE_QUEUE, JSON.stringify(queueState)); } catch (_) {}
  }

  function traceQueue(event, data = {}) {
    try {
      if (typeof window.BWU2Trace === 'function') {
        window.BWU2Trace(event, data);
      } else {
        window.postMessage({ __BWU2_TRACE__: true, type: event, data }, '*');
      }
    } catch (_) {}
  }

  function queueItem(id = queueState.currentId) {
    const key = String(id || '').toLowerCase();
    return queueState.items.find(x => String(x.id).toLowerCase() === key) || null;
  }

  function nextQueuedItem() {
    return queueState.items.find(x => x.status === 'queued') || null;
  }

  function queueCounts() {
    const out = { total: queueState.items.length, queued: 0, active: 0, done: 0, attention: 0 };
    for (const item of queueState.items) {
      if (Object.prototype.hasOwnProperty.call(out, item.status)) out[item.status]++;
    }
    return out;
  }

  function normalizeContainer(raw) {
    const value = String(raw || '').trim();
    return /^(?:tsX|csX)[A-Za-z0-9]+$/i.test(value) ? value : '';
  }

  function getQueueDraft() {
    try { return localStorage.getItem(STORAGE_QUEUE_DRAFT) || ''; }
    catch (_) { return ''; }
  }

  function setQueueDraft(value) {
    try { localStorage.setItem(STORAGE_QUEUE_DRAFT, String(value || '')); }
    catch (_) {}
  }


  function queueInputEnabled() {
    try { return localStorage.getItem(STORAGE_QUEUE_INPUT_ENABLED) !== '0'; }
    catch (_) { return true; }
  }

  function setQueueInputEnabled(value) {
    try { localStorage.setItem(STORAGE_QUEUE_INPUT_ENABLED, value ? '1' : '0'); }
    catch (_) {}
    renderQueueState();
  }

  function rememberUnable(values) {
    if (!Array.isArray(queueState.invalidInputs)) queueState.invalidInputs = [];
    const seen = new Set(queueState.invalidInputs.map(x => String(x).toLowerCase()));

    for (const raw of values || []) {
      const value = String(raw || '').trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      queueState.invalidInputs.push(value);
    }

    queueState.invalidInputs = queueState.invalidInputs.slice(-50);
    saveQueueState();
  }

  function renderUnableBox() {
    const box = document.getElementById('moveapp-queue-unable');
    if (!box) return;
    const values = Array.isArray(queueState.invalidInputs) ? queueState.invalidInputs : [];

    if (!values.length) {
      box.style.display = 'none';
      box.textContent = '';
      return;
    }

    box.style.display = 'block';
    box.replaceChildren();

    const head = document.createElement('div');
    head.textContent = `Unable to dropzone (${values.length}) — not tsX/csX`;
    head.style.cssText = 'font-weight:900;margin-bottom:4px;';
    box.appendChild(head);

    const list = document.createElement('div');
    list.textContent = values.join('\n');
    list.style.cssText = 'white-space:pre-wrap;font:11px Consolas,monospace;max-height:78px;overflow:auto;';
    box.appendChild(list);
  }

  function sanitizeQueueTextarea(textarea, finalize = false) {
    if (!textarea) return { valid: [], invalid: [] };

    const raw = String(textarea.value || '').replace(/\r/g, '');
    const lines = raw.split('\n');
    const trailingNewline = raw.endsWith('\n');
    const keep = [];
    const invalid = [];

    for (let i = 0; i < lines.length; i++) {
      const original = lines[i];
      const value = original.trim();
      const last = i === lines.length - 1;

      // Current unfinished scan/typed line: leave it completely alone until
      // scanner Enter creates the newline (or RUN finalizes it).
      if (last && !trailingNewline && !finalize) {
        keep.push(original);
        continue;
      }

      if (!value) continue;
      const container = normalizeContainer(value);
      if (container) keep.push(container);
      else invalid.push(value);
    }

    if (invalid.length) rememberUnable(invalid);

    let cleaned = keep.join('\n');
    if (trailingNewline && cleaned) cleaned += '\n';

    if (cleaned !== textarea.value) {
      textarea.value = cleaned;
      try { textarea.setSelectionRange(cleaned.length, cleaned.length); } catch (_) {}
    }

    setQueueDraft(cleaned);
    renderUnableBox();

    const seen = new Set();
    const valid = [];
    for (const line of cleaned.split(/\n/)) {
      const container = normalizeContainer(line);
      if (!container) continue;
      const key = container.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      valid.push(container);
    }

    return { valid, invalid };
  }

  function prepareQueueFromTextarea() {
    const textarea = document.getElementById('moveapp-queue-input');
    if (!textarea) return false;

    const parsed = sanitizeQueueTextarea(textarea, true);
    if (!parsed.valid.length) {
      queueState.message = parsed.invalid.length ? 'No dropzone-compatible containers' : 'Queue is empty';
      saveQueueState();
      renderQueueState();
      return false;
    }

    queueState.items = parsed.valid.map(id => ({ id, status: 'queued', error: '' }));
    queueState.currentId = '';
    queueState.phase = 'idle';
    queueState.message = `${parsed.valid.length} ready`;
    saveQueueState();

    traceQueue('MOVECONTAINER_QUEUE_PREPARE', {
      queued: parsed.valid.length,
      invalid: parsed.invalid.length
    });
    return true;
  }

  function clearQueueDone() {
    if (queueState.running) return;
    queueState.items = queueState.items.filter(x => x.status !== 'done');
    if (queueState.currentId && !queueItem(queueState.currentId)) queueState.currentId = '';
    queueState.message = 'Completed rows cleared';
    saveQueueState();
    renderQueueState();
  }

  function clearQueueAll() {
    if (queueState.running) return;
    queueState = defaultQueueState();
    setQueueDraft('');
    saveQueueState();
    traceQueue('MOVECONTAINER_QUEUE_CLEAR', {});
    renderQueueState();
  }

  function pauseQueue(reason = 'Paused') {
    if (!queueState.running) return;
    queueState.running = false;
    queueState.message = reason;
    saveQueueState();
    traceQueue('MOVECONTAINER_QUEUE_PAUSE', {
      reason,
      currentId: queueState.currentId,
      phase: queueState.phase,
      destination: queueState.lockedDz
    });
    renderQueueState();
  }

  function markCurrentAttention(reason, pause = false) {
    const current = queueItem();
    if (current) {
      current.status = 'attention';
      current.error = String(reason || 'Needs attention');
    }

    const failedId = current?.id || '';
    queueState.currentId = '';
    queueState.phase = 'idle';

    if (pause) {
      queueState.running = false;
      queueState.message = `Paused: ${reason}`;
    } else {
      queueState.message = `Skipped ${failedId}: ${reason}`;
    }

    saveQueueState();
    traceQueue('MOVECONTAINER_QUEUE_ATTENTION', {
      container: failedId,
      reason,
      paused: pause,
      destination: queueState.lockedDz
    });
    renderQueueState();
  }

  function activateNextQueueItem() {
    const next = nextQueuedItem();
    if (!next) return null;

    next.status = 'active';
    next.error = '';
    queueState.currentId = next.id;
    queueState.phase = 'api_move';
    queueState.message = `Moving ${next.id} → ${queueState.lockedDz}`;
    saveQueueState();

    traceQueue('MOVECONTAINER_QUEUE_ITEM_START', {
      container: next.id,
      destination: queueState.lockedDz,
      engine: 'direct-api'
    });

    renderQueueState();
    return next;
  }

  function finishQueue() {
    const counts = queueCounts();
    queueState.running = false;
    queueState.currentId = '';
    queueState.phase = 'idle';
    queueState.message =
      `Done: ${counts.done} moved` +
      (counts.attention ? ` | ${counts.attention} unable` : '');

    saveQueueState();
    traceQueue('MOVECONTAINER_QUEUE_FINISH', {
      destination: queueState.lockedDz,
      engine: 'direct-api',
      ...counts
    });
    renderQueueState();
  }

  function directMoveRequest(container, destinationId) {
    return new Promise((resolve, reject) => {
      const started = performance.now();

      traceQueue('MOVECONTAINER_API_REQUEST', {
        container,
        destination: destinationId
      });

      try {
        GM_xmlhttpRequest({
          method: 'POST',
          url: MOVE_URL,
          timeout: QUEUE_REQUEST_TIMEOUT_MS,
          headers: { 'Content-Type': 'application/json' },
          data: JSON.stringify({
            sourceScannableId: null,
            destinationScannableId: destinationId,
            containerScannableId: container,
            confirmed: 'true'
          }),
          onload: response => {
            const ms = Math.round(performance.now() - started);
            traceQueue('MOVECONTAINER_API_RESPONSE', {
              container,
              destination: destinationId,
              status: response.status,
              ms
            });

            if (response.status >= 200 && response.status < 300) {
              resolve({ status: response.status, ms });
            } else {
              const err = new Error(`HTTP ${response.status}`);
              err.status = response.status;
              err.ms = ms;
              reject(err);
            }
          },
          onerror: () => {
            const err = new Error('Network error');
            err.status = 0;
            reject(err);
          },
          ontimeout: () => {
            const err = new Error('Timed out');
            err.status = 0;
            reject(err);
          },
          onabort: () => {
            const err = new Error('Aborted');
            err.status = 0;
            reject(err);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async function runQueueDirect() {
    if (!queueState.running || queueRequestActive) return;

    let current = queueItem();
    if (!current) {
      current = activateNextQueueItem();
      if (!current) {
        finishQueue();
        return;
      }
    }

    queueRequestActive = true;
    renderQueueState();

    try {
      const result = await directMoveRequest(current.id, queueState.lockedDz);

      // API confirmed the move. Even if user hit PAUSE while the request was
      // in-flight, this completed row is safe to mark done; we simply do not
      // advance until RUN is pressed again.
      current.status = 'done';
      current.error = '';
      queueState.currentId = '';
      queueState.phase = 'idle';
      queueState.message = `✓ ${current.id} moved (${result.ms}ms)`;
      saveQueueState();

      traceQueue('MOVECONTAINER_QUEUE_ITEM_DONE', {
        container: current.id,
        destination: queueState.lockedDz,
        status: result.status,
        ms: result.ms,
        engine: 'direct-api'
      });
    } catch (error) {
      const status = Number(error?.status || 0);
      const reason = error?.message || 'Move failed';

      // Item-specific 4xx errors can be skipped so one bad tote does not kill
      // a long queue. Auth/rate-limit/server/network failures pause the queue
      // so we do not machine-gun the same systemic failure through every tote.
      const fatal =
        status === 0 ||
        status === 401 ||
        status === 403 ||
        status === 429 ||
        status >= 500;

      markCurrentAttention(reason, fatal);
    } finally {
      queueRequestActive = false;
      renderQueueState();
    }

    if (!queueState.running) return;

    if (!nextQueuedItem()) {
      finishQueue();
      return;
    }

    setTimeout(runQueueDirect, QUEUE_NEXT_GAP_MS);
  }

  function startQueue() {
    if (!isEnabled()) {
      showError('Turn DZ Auto ON first');
      return;
    }

    if (queueRequestActive) {
      showError('Current move still finishing');
      return;
    }

    // Resume an existing paused queue if it still has queued work.
    const hasExistingWork =
      queueState.items.some(x => x.status === 'queued') ||
      !!queueState.currentId;

    if (!hasExistingWork) {
      if (!prepareQueueFromTextarea()) {
        showError('Queue is empty');
        return;
      }

      // The active list below now owns these IDs. Clearing the raw input makes
      // accidental duplicate re-runs much harder.
      setQueueDraft('');
      const textarea = document.getElementById('moveapp-queue-input');
      if (textarea) textarea.value = '';
    }

    if (!queueState.lockedDz || !hasExistingWork) {
      const dz = selectedDropzone();
      if (!dz) {
        showError('Select a destination first');
        return;
      }
      queueState.lockedDz = dz;
    }

    queueState.running = true;
    queueState.phase = queueState.currentId ? 'api_move' : 'idle';
    queueState.message = `Running API queue → ${queueState.lockedDz}`;
    saveQueueState();

    traceQueue('MOVECONTAINER_QUEUE_START', {
      destination: queueState.lockedDz,
      queued: queueState.items.filter(x => x.status === 'queued').length,
      currentId: queueState.currentId || null,
      engine: 'direct-api'
    });

    renderQueueState();
    setTimeout(runQueueDirect, 0);
  }

  // A refresh while a move is mid-flight is deliberately NOT auto-resubmitted.
  // The list survives, but the uncertain active row is marked for attention.
  function recoverQueueAfterReload() {
    if (!queueState.running) return;
    const current = queueItem();
    if (current && current.status === 'active') {
      current.status = 'attention';
      current.error = 'Page refreshed during API move — verify before retry';
    }
    queueState.running = false;
    queueState.currentId = '';
    queueState.phase = 'idle';
    queueState.message = 'Queue preserved after refresh — verify red row, then RUN';
    saveQueueState();
  }

  recoverQueueAfterReload();

  const DEFAULT_DZ_TYPE = 'PRIME';

  const DZ_TYPES_UPPER = [
    { key: 'Cubiscan', label: 'Cubiscan', pattern: 'dz-Pcubiscan-{floor}' },
    { key: 'Prep', label: 'Prep', pattern: 'dz-P-Prep-{floor}' },
    { key: 'ISS', label: 'ISS', pattern: 'dz-P-ISS-{floor}' },
    { key: 'Damages', label: 'Damages', pattern: 'dz-P-Damages-{floor}' },
    { key: 'Hazmat', label: 'Hazmat', pattern: 'dz-P-Hazmat-{floor}' },
    { key: 'Nonsort', label: 'Nonsort', pattern: 'dz-Pnonsort-{floor}' }
  ];

  const DZ_TYPES_P1 = [
    { key: 'dz-P-HAZMAT_OUT', label: 'Hazmat' },
    { key: 'dz-P-Ticketland', label: 'Ticketland' },
    { key: 'dz-P-issconsol', label: 'Consolidation' },
    { key: 'dz-S-ISSWIP1', label: 'ISS WIP' },
    { key: 'dz-P-IB-nonsort', label: 'Nonsort' },
    { key: 'dz-P-ISS-Shipdock', label: 'Shipdock' },
    { key: 'dz-P-OBIOL', label: 'OB IOL' },
    { key: 'dz-Pdamageland', label: 'Damageland' },
    { key: 'dz-P-rcv-Damages', label: 'Receive Damages' }
  ];

  const FLOORS = ['P1', 'P2', 'P3', 'P4'];

  let lastScanAt = 0;
  let lastErrorAt = 0;
  let wasDestinationStep = false;

  function isEnabled() {
    const val = localStorage.getItem(STORAGE_ENABLED);
    return val === null || val === 'true';
  }

  function setEnabled(value) {
    localStorage.setItem(STORAGE_ENABLED, value ? 'true' : 'false');
    renderUi();
  }

  function getDzType() {
    return localStorage.getItem(STORAGE_DZ) ?? DEFAULT_DZ_TYPE;
  }

  function setDzType(value) {
    localStorage.setItem(STORAGE_DZ, value);
    if (value === 'PRIME') {
      localStorage.removeItem(STORAGE_FLOOR);
    }
    renderUi();
  }

  function getFloor() {
    return localStorage.getItem(STORAGE_FLOOR) || '';
  }

  function setFloor(value) {
    localStorage.setItem(STORAGE_FLOOR, value);
    const dz = getDzType();
    if (dz === 'PRIME' || dz === '') {
      localStorage.setItem(STORAGE_DZ, '');
    }
    if (value === 'P1') {
      const validP1Keys = DZ_TYPES_P1.map(x => x.key);
      if (dz && dz !== 'PRIME' && !validP1Keys.includes(dz)) {
        localStorage.setItem(STORAGE_DZ, '');
      }
    } else {
      const validUpperKeys = DZ_TYPES_UPPER.map(x => x.key);
      if (dz && dz !== 'PRIME' && !validUpperKeys.includes(dz)) {
        localStorage.setItem(STORAGE_DZ, '');
      }
    }
    renderUi();
  }

  function isP1() {
    return getFloor() === 'P1';
  }

  function activeDzTypes() {
    return isP1() ? DZ_TYPES_P1 : DZ_TYPES_UPPER;
  }

  function selectedDropzone() {
    const dzType = getDzType();
    const floor = getFloor();

    if (dzType === 'PRIME') return 'dz-P-PRIME';
    if (!dzType || !floor) return '';

    if (floor === 'P1') {
      const p1Match = DZ_TYPES_P1.find(x => x.key === dzType);
      if (p1Match) return p1Match.key;
      return '';
    }

    const upperMatch = DZ_TYPES_UPPER.find(x => x.key === dzType);
    if (upperMatch) return upperMatch.pattern.replace('{floor}', floor);
    return '';
  }

  function pageText() {
    return (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
  }

  function isDestinationStep() {
    return /scan destination container/i.test(pageText());
  }



  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
  }

  function inputs() {
    return [...document.querySelectorAll('input, textarea')]
      .filter(el =>
        visible(el) &&
        !el.disabled &&
        !el.readOnly &&
        !el.closest('#moveapp-dz-selector')
      );
  }

  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter ? setter.call(el, value) : (el.value = value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function key(target, type, ch) {
    const isEnter = ch === 'Enter';
    const ev = new KeyboardEvent(type, {
      key: ch,
      code: isEnter ? 'Enter' : `Key${String(ch).toUpperCase()}`,
      keyCode: isEnter ? 13 : ch.charCodeAt(0),
      which: isEnter ? 13 : ch.charCodeAt(0),
      charCode: isEnter ? 0 : ch.charCodeAt(0),
      bubbles: true,
      cancelable: true,
      composed: true
    });
    try { target.dispatchEvent(ev); } catch (_) {}
  }

  function typeLikeScanner(value) {
    // SAFETY: target ONE native MoveApp scan field only.
    // MoveApp has global keyboard hotkeys, so never spray synthetic keys at body/document/window.
    const target = inputs()[0];
    if (!target) {
      showError('MoveApp scan field not found');
      return false;
    }

    try {
      target.focus();
      setNativeValue(target, value);
      key(target, 'keydown', 'Enter');
      key(target, 'keypress', 'Enter');
      key(target, 'keyup', 'Enter');
      return true;
    } catch (_) {
      return false;
    }
  }

  function showError(msg) {
    const now = Date.now();
    if (now - lastErrorAt < 1000) return;
    lastErrorAt = now;
    const box = document.getElementById('moveapp-dz-error');
    if (!box) return;
    box.textContent = msg;
    box.style.display = 'block';
    setTimeout(() => { box.style.display = 'none'; }, 2500);
  }

  function fireDropzone() {
    if (!isEnabled()) return;

    const now = Date.now();
    if (now - lastScanAt < 250) return;

    const dzType = getDzType();
    const floor = getFloor();

    if (dzType === 'PRIME') {
      lastScanAt = now;
      setTimeout(() => {
        if (!isDestinationStep()) return;
        typeLikeScanner('dz-P-PRIME');
      }, 80);
      return;
    }

    if (!floor) {
      showError('Select floor first');
      return;
    }

    if (!dzType) {
      showError('Select a dropzone');
      return;
    }

    const dz = selectedDropzone();
    if (!dz) {
      showError('Select a dropzone');
      return;
    }

    lastScanAt = now;

    setTimeout(() => {
      if (!isDestinationStep()) return;
      typeLikeScanner(dz);
    }, 80);
  }


  function tick() {
    if (queueState.running || queueRequestActive) {
      wasDestinationStep = isDestinationStep();
      return;
    }

    const dest = isDestinationStep();

    if (dest && !wasDestinationStep) {
      wasDestinationStep = true;
      fireDropzone();
      return;
    }

    if (dest) {
      wasDestinationStep = true;
      return;
    }

    wasDestinationStep = false;

  }

  function colorForFloor(floor) {
    if (floor === 'P1') return '#7a5b9e';
    if (floor === 'P2') return '#2f5d9f';
    if (floor === 'P3') return '#2f7d46';
    if (floor === 'P4') return '#a03535';
    return '#555';
  }

  function mkBtn(text, active, color, disabled = false) {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.style.cssText = [
      'border:0',
      'border-radius:7px',
      'padding:8px 9px',
      'font:800 12px Arial,sans-serif',
      `cursor:${disabled ? 'not-allowed' : 'pointer'}`,
      'color:white',
      `background:${disabled ? '#3e3e3e' : active ? color : '#666'}`,
      `opacity:${disabled ? '.45' : '1'}`,
      `box-shadow:${active ? '0 0 0 2px rgba(255,255,255,.52) inset' : 'none'}`,
      'min-width:58px'
    ].join(';');
    btn.disabled = !!disabled;
    return btn;
  }

  function toggleUi() {
    const root = document.getElementById('moveapp-dz-selector');
    if (!root) return;
    root.style.display = root.style.display === 'none' ? '' : 'none';
  }

  function renderQueueState() {
    const root = document.getElementById('moveapp-dz-selector');
    if (!root) return;

    const qInput = root.querySelector('#moveapp-queue-input');
    const qInputToggle = root.querySelector('#moveapp-queue-input-toggle');
    const qRun = root.querySelector('#moveapp-queue-run');
    const qPause = root.querySelector('#moveapp-queue-pause');
    const qClearDone = root.querySelector('#moveapp-queue-clear-done');
    const qClearAll = root.querySelector('#moveapp-queue-clear-all');
    const qSummary = root.querySelector('#moveapp-queue-summary');
    const qMessage = root.querySelector('#moveapp-queue-message');
    const qList = root.querySelector('#moveapp-queue-list');
    const qLock = root.querySelector('#moveapp-queue-lock');
    if (!qInput || !qInputToggle || !qRun || !qPause || !qClearDone || !qClearAll || !qSummary || !qMessage || !qList || !qLock) return;

    const inputEnabled = queueInputEnabled();
    const draft = getQueueDraft();
    if (qInput.value !== draft && document.activeElement !== qInput) qInput.value = draft;
    qInput.readOnly = !inputEnabled || queueState.running || queueRequestActive;
    qInput.style.opacity = qInput.readOnly ? '.55' : '1';
    qInput.style.cursor = qInput.readOnly ? 'not-allowed' : 'text';
    qInputToggle.textContent = inputEnabled ? 'INPUT ON' : 'INPUT OFF';
    qInputToggle.style.background = inputEnabled ? '#2e7d32' : '#8b3030';

    const counts = queueCounts();
    qLock.textContent = queueState.lockedDz
      ? `${queueState.running || queueRequestActive ? 'API →' : 'Last:'} ${queueState.lockedDz}`
      : `Selected: ${selectedDropzone() || 'NONE'}`;
    qSummary.textContent =
      `Total ${counts.total} | Queued ${counts.queued} | Done ${counts.done}` +
      (counts.attention ? ` | Attention ${counts.attention}` : '');
    qMessage.textContent = queueState.message || '';

    qRun.textContent = queueState.running ? 'RUNNING' : (queueRequestActive ? 'FINISHING' : 'RUN');
    qRun.disabled = queueState.running || queueRequestActive;
    qRun.style.opacity = qRun.disabled ? '.45' : '1';
    qPause.disabled = !queueState.running;
    qPause.style.opacity = queueState.running ? '1' : '.45';

    const clearDisabled = queueState.running || queueRequestActive;
    qClearDone.disabled = clearDisabled;
    qClearAll.disabled = clearDisabled;
    qClearDone.style.opacity = clearDisabled ? '.45' : '1';
    qClearAll.style.opacity = clearDisabled ? '.45' : '1';

    qList.replaceChildren();
    const statusMeta = {
      queued: { symbol: '•', bg: '#262626', fg: '#e5e5e5' },
      active: { symbol: '→', bg: '#17354f', fg: '#d8efff' },
      done: { symbol: '✓', bg: '#173d24', fg: '#d8ffe1' },
      attention: { symbol: '!', bg: '#5a2020', fg: '#ffd8d8' }
    };

    for (const item of queueState.items) {
      const meta = statusMeta[item.status] || statusMeta.queued;
      const row = document.createElement('div');
      row.style.cssText =
        `display:flex;align-items:center;gap:6px;padding:4px 5px;margin:2px 0;border-radius:4px;background:${meta.bg};color:${meta.fg};font:11px Consolas,monospace;`;
      const symbol = document.createElement('span');
      symbol.textContent = meta.symbol;
      symbol.style.cssText = 'width:12px;font-weight:900;text-align:center;';
      const id = document.createElement('span');
      id.textContent = item.id;
      id.style.cssText = 'font-weight:800;flex:0 0 auto;';
      const detail = document.createElement('span');
      detail.textContent = item.error || item.status;
      detail.title = item.error || item.status;
      detail.style.cssText = 'opacity:.8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';
      row.append(symbol, id, detail);
      qList.appendChild(row);
    }

    if (!queueState.items.length) {
      const empty = document.createElement('div');
      empty.textContent = 'Queue empty';
      empty.style.cssText = 'text-align:center;color:#777;padding:8px;font-style:italic;';
      qList.appendChild(empty);
    }

    renderUnableBox();
  }

  function renderUi() {
    let root = document.getElementById('moveapp-dz-selector');
    if (!root) {
      root = document.createElement('div');
      root.id = 'moveapp-dz-selector';
      document.documentElement.appendChild(root);
    }

    const dzType = getDzType();
    const floor = getFloor();
    const dz = selectedDropzone();
    const isPrime = dzType === 'PRIME';
    const hasFloor = !!floor;
    const enabled = isEnabled();
    const current = dz || 'SELECT DZ';
    const needsSelection = !dz && !isPrime;
    const queueSelectionLocked = queueState.running || queueRequestActive || !!queueState.currentId;

    root.style.cssText = [
      'position:fixed',
      'right:10px',
      'bottom:10px',
      'z-index:999999',
      'width:360px',
      'background:rgba(28,28,28,.94)',
      'color:white',
      'border:1px solid rgba(255,255,255,.22)',
      'border-radius:10px',
      'box-shadow:0 3px 14px rgba(0,0,0,.35)',
      'padding:9px',
      'font:12px Arial,sans-serif',
      'display:block'
    ].join(';');

    root.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-weight:900;">DZ Auto v${VERSION}</span>
          <button id="moveapp-dz-enable-btn" style="
            border:0;
            border-radius:5px;
            padding:3px 7px;
            font:700 10px Arial,sans-serif;
            cursor:pointer;
            color:white;
            background:${enabled ? '#2e7d32' : '#b53131'};
          ">${enabled ? 'ON' : 'OFF'}</button>
        </div>
        <div style="font-weight:900;color:${needsSelection ? '#ffb3b3' : '#bfffcf'};">${current}</div>
      </div>

      <div id="moveapp-dz-error" style="display:none;background:#b53131;color:white;font-weight:900;text-align:center;border-radius:7px;padding:6px;margin-bottom:7px;"></div>

      <div id="moveapp-prime-wrap" style="margin-bottom:6px;"></div>

      <div style="font-weight:800;margin:3px 0 4px;color:#d9d9d9;">Floor</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-bottom:7px;" id="moveapp-floor-buttons"></div>

      <div style="font-weight:800;margin:3px 0 4px;color:#d9d9d9;">Dropzone</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px;" id="moveapp-dz-buttons"></div>

      <div style="border-top:1px solid rgba(255,255,255,.18);margin-top:9px;padding-top:8px;">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:5px;">
          <div style="display:flex;align-items:center;gap:6px;">
            <div style="font-weight:900;">Container Queue <span style="color:#86d9ff;font-size:10px;">API</span></div>
            <button id="moveapp-queue-input-toggle" type="button" style="border:0;border-radius:5px;padding:3px 7px;color:#fff;font:800 10px Arial,sans-serif;cursor:pointer;"></button>
          </div>
          <div id="moveapp-queue-lock" style="font:800 10px Arial,sans-serif;color:#c9bfff;text-align:right;"></div>
        </div>

        <textarea id="moveapp-queue-input" rows="3" spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="Scan/paste tsX / csX containers"
          style="width:100%;resize:vertical;min-height:48px;max-height:110px;background:#101010;color:#fff;border:1px solid #666;border-radius:6px;padding:6px;font:12px Consolas,monospace;outline:none;"></textarea>

        <div id="moveapp-queue-unable" style="display:none;margin-top:5px;padding:6px 7px;border:1px solid #d9534f;border-left:5px solid #d9534f;border-radius:5px;background:#421b1b;color:#ffdada;"></div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:5px;">
          <button id="moveapp-queue-run" style="border:0;border-radius:6px;padding:7px;background:#2e7d32;color:#fff;font-weight:900;cursor:pointer;">RUN</button>
          <button id="moveapp-queue-pause" style="border:0;border-radius:6px;padding:7px;background:#a05b20;color:#fff;font-weight:900;cursor:pointer;">PAUSE</button>
        </div>

        <div id="moveapp-queue-summary" style="margin-top:6px;font:11px Consolas,monospace;color:#d9d9d9;"></div>
        <div id="moveapp-queue-message" style="margin-top:4px;font-weight:800;color:#cfe8ff;min-height:15px;"></div>
        <div id="moveapp-queue-list" style="margin-top:5px;max-height:155px;overflow:auto;background:#111;border-radius:6px;padding:4px;"></div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:5px;">
          <button id="moveapp-queue-clear-done" style="border:0;border-radius:6px;padding:6px;background:#444;color:#fff;font-weight:800;cursor:pointer;">CLEAR DONE</button>
          <button id="moveapp-queue-clear-all" style="border:0;border-radius:6px;padding:6px;background:#6b3030;color:#fff;font-weight:800;cursor:pointer;">CLEAR ALL</button>
        </div>
      </div>

    `;

    root.querySelector('#moveapp-dz-enable-btn').addEventListener('click', () => setEnabled(!enabled));

    const primeWrap = root.querySelector('#moveapp-prime-wrap');
    const prime = mkBtn('PRIME  •  dz-P-PRIME', isPrime, '#6b55c9', queueSelectionLocked);
    prime.style.width = '100%';
    prime.addEventListener('click', () => setDzType('PRIME'));
    primeWrap.appendChild(prime);

    const floorWrap = root.querySelector('#moveapp-floor-buttons');
    for (const f of FLOORS) {
      const btn = mkBtn(f, f === floor && !isPrime, colorForFloor(f), queueSelectionLocked);
      btn.addEventListener('click', () => setFloor(f));
      floorWrap.appendChild(btn);
    }

    const dzWrap = root.querySelector('#moveapp-dz-buttons');

    if (isPrime) {
      const placeholder = document.createElement('div');
      placeholder.style.cssText = 'grid-column:1/-1;text-align:center;color:#888;padding:6px;font-style:italic;';
      placeholder.textContent = 'PRIME selected (no DZ needed)';
      dzWrap.appendChild(placeholder);
    } else if (!hasFloor) {
      const placeholder = document.createElement('div');
      placeholder.style.cssText = 'grid-column:1/-1;text-align:center;color:#888;padding:6px;font-style:italic;';
      placeholder.textContent = 'Select a floor first';
      dzWrap.appendChild(placeholder);
    } else {
      const dzList = activeDzTypes();
      for (const item of dzList) {
        const isActive = item.key === dzType;
        const btn = mkBtn(item.label, isActive, floor === 'P1' ? '#7a5b9e' : '#4c7ed9', queueSelectionLocked);
        btn.title = item.key;
        btn.addEventListener('click', () => setDzType(item.key));
        dzWrap.appendChild(btn);
      }
    }

    const qInput = root.querySelector('#moveapp-queue-input');
    const qInputToggle = root.querySelector('#moveapp-queue-input-toggle');
    const qRun = root.querySelector('#moveapp-queue-run');
    const qPause = root.querySelector('#moveapp-queue-pause');
    const qClearDone = root.querySelector('#moveapp-queue-clear-done');
    const qClearAll = root.querySelector('#moveapp-queue-clear-all');

    qInput.value = getQueueDraft();
    qInputToggle.addEventListener('click', () => setQueueInputEnabled(!queueInputEnabled()));

    for (const eventType of ['keydown', 'keypress', 'keyup']) {
      qInput.addEventListener(eventType, event => {
        if (!queueInputEnabled() || qInput.readOnly) return;
        event.stopPropagation();
        event.stopImmediatePropagation();
      });
    }

    qInput.addEventListener('input', () => {
      if (!queueInputEnabled() || qInput.readOnly) return;
      setQueueDraft(qInput.value);
      sanitizeQueueTextarea(qInput, false);
    });
    qInput.addEventListener('blur', () => setQueueDraft(qInput.value));

    qRun.addEventListener('click', startQueue);
    qPause.addEventListener('click', () => pauseQueue('Paused by user'));
    qClearDone.addEventListener('click', clearQueueDone);
    qClearAll.addEventListener('click', clearQueueAll);

    renderQueueState();
  }

  document.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      toggleUi();
    }
  });

  renderUi();

  let tickTimer = 0;
  const scheduleTick = () => {
    if (tickTimer) return;
    tickTimer = setTimeout(() => {
      tickTimer = 0;
      tick();
    }, 60);
  };

  const moveObserver = new MutationObserver(scheduleTick);
  moveObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });

  const fallbackTick = setInterval(tick, 1000);
  window.addEventListener('pageshow', scheduleTick);
  document.addEventListener('DOMContentLoaded', scheduleTick, { once: true });
  window.addEventListener('pagehide', () => {
    moveObserver.disconnect();
    clearTimeout(tickTimer);
    clearInterval(fallbackTick);
  }, { once: true });

  scheduleTick();

})();
