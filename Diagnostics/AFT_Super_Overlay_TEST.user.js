// ==UserScript==
// @name         TEST v0.4.1 AFT Super Overlay
// @name:en      TEST v0.4.1 AFT Super Overlay
// @namespace    https://github.com/1Sirkkris
// @version      0.4.1
// @description  TEST: API-first AFT Edit/Move mode controller. Backend workflow is authoritative; native page may stay stale until SYNC PAGE.
// @include      *://aft-qt-*.corp.amazon.com/*
// @run-at       document-start
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Diagnostics/AFT_Super_Overlay_TEST.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Diagnostics/AFT_Super_Overlay_TEST.user.js
// ==/UserScript==

(() => {
  'use strict';

  if (window.top !== window.self) return;

  const VERSION = '0.4.1';
  const ROOT_ID = 'aft-super-test';
  const STYLE_ID = 'aft-super-test-style';
  const STORE_KEY = 'aft_super_overlay_test_v010';
  const POLL_MS = 100;
  const REQUEST_TIMEOUT_MS = 6000;
  const STATUS_TIMEOUT_MS = 8000;
  const FRESH_WORKFLOW_TIMEOUT_MS = 2500;

  const STATES = ['Sellable', 'Pending Research', 'Unsellable'];
  const DISPOSITIONS = ['Amazon Damage', 'Defective', 'Distributor Damage', 'Expired'];
  const EDIT_MODES = ['each', 'sku', 'date', 'fcsku'];
  const MOVE_MODES = ['each', 'multi', 'container'];

  const HELPER_KEYS = {
    eachState: 'aftm_each_state',
    eachDisposition: 'aftm_each_disp',
    skuCurrentState: 'aftm_sku_current_state',
    skuCurrentDisposition: 'aftm_sku_current_damage',
    skuDesiredState: 'aftm_sku_desired_state',
    skuDesiredDisposition: 'aftm_sku_desired_damage',
    moveQtyMode: 'aftm_move_qty_mode',
    moveUserQty: 'aftm_move_user_qty'
  };

  const DEFAULTS = {
    area: 'edit',
    editMode: 'each',
    moveMode: 'each',
    minimized: false,
    eachState: 'Unsellable',
    eachDisposition: 'Amazon Damage',
    skuCurrentState: 'Sellable',
    skuCurrentDisposition: 'Defective',
    skuDesiredState: 'Unsellable',
    skuDesiredDisposition: 'Defective',
    moveQtyMode: 'all',
    moveUserQty: ''
  };

  const DEFINITIONS = {
    'edit:each': {
      title: 'Edit • Each', area: 'edit', mode: 'each', path: '/app/edititems',
      instructionId: 'EditItems', tool: 'edititems', input: 'EACH'
    },
    'edit:sku': {
      title: 'Edit • SKU', area: 'edit', mode: 'sku', path: '/app/edititems',
      instructionId: 'EditItems', tool: 'edititems', input: 'SKU'
    },
    'edit:date': {
      title: 'Edit • Date', area: 'edit', mode: 'date', path: '/app/edititems',
      instructionId: 'EditItems', tool: 'edititems', input: 'DATELOT'
    },
    'edit:fcsku': {
      title: 'Edit • FCSKU', area: 'edit', mode: 'fcsku', path: '/app/fcskuflip',
      instructionId: 'FcSkuFlip', tool: 'fcskuflip', input: 'SKU'
    },
    'move:each': {
      title: 'Move • Each', area: 'move', mode: 'each', path: '/app/moveitems',
      instructionId: 'MoveItems', tool: 'moveitems', input: 'EACH'
    },
    'move:multi': {
      title: 'Move • Multi', area: 'move', mode: 'multi', path: '/app/moveitems',
      instructionId: 'MoveItems', tool: 'moveitems', input: 'MULTI'
    },
    'move:container': {
      title: 'Move • Container', area: 'move', mode: 'container', path: '/app/moveitems',
      instructionId: 'MoveItems', tool: 'moveitems', input: 'CONTAINER'
    }
  };

  let state = loadState();
  let root = null;
  let statusEl = null;
  let statusMessage = 'Backend controller ready';
  let statusKind = '';
  let activeModeKey = '';
  let switchingKey = '';
  let queuedModeKey = '';
  let switchRunnerActive = false;

  function loadState() {
    let saved = {};
    try { saved = GM_getValue(STORE_KEY, {}) || {}; } catch {}

    const clean = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS)) {
      if (Object.prototype.hasOwnProperty.call(saved, key)) clean[key] = saved[key];
    }
    return clean;
  }

  function saveState() {
    try { GM_setValue(STORE_KEY, state); } catch {}
  }

  function normalizeRules() {
    if (!['edit', 'move'].includes(state.area)) state.area = 'edit';
    if (!EDIT_MODES.includes(state.editMode)) state.editMode = 'each';
    if (!MOVE_MODES.includes(state.moveMode)) state.moveMode = 'each';
    if (!STATES.includes(state.eachState)) state.eachState = 'Unsellable';
    if (!DISPOSITIONS.includes(state.eachDisposition)) state.eachDisposition = 'Amazon Damage';
    if (!STATES.includes(state.skuCurrentState)) state.skuCurrentState = 'Sellable';
    if (!STATES.includes(state.skuDesiredState)) state.skuDesiredState = 'Unsellable';
    if (!DISPOSITIONS.includes(state.skuCurrentDisposition)) state.skuCurrentDisposition = 'Defective';
    if (!DISPOSITIONS.includes(state.skuDesiredDisposition)) state.skuDesiredDisposition = 'Defective';
    if (!['all', 'user'].includes(state.moveQtyMode)) state.moveQtyMode = 'all';

    if (state.skuCurrentState !== 'Unsellable' && state.skuDesiredState === state.skuCurrentState) {
      state.skuDesiredState = state.skuCurrentState === 'Sellable' ? 'Unsellable' : 'Sellable';
    }
    if (
      state.skuCurrentState === 'Unsellable' &&
      state.skuDesiredState === 'Unsellable' &&
      state.skuCurrentDisposition === state.skuDesiredDisposition
    ) {
      state.skuDesiredDisposition = DISPOSITIONS.find(value => value !== state.skuCurrentDisposition) || 'Defective';
    }
  }

  function modeKey(area = state.area, mode = area === 'edit' ? state.editMode : state.moveMode) {
    return `${area}:${mode}`;
  }

  function selectedDefinition() {
    return DEFINITIONS[modeKey()];
  }

  function routeFor(definition) {
    return definition ? `${location.origin}${definition.path}?experience=Desktop` : '';
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function setStatus(message, kind = '') {
    statusMessage = message;
    statusKind = kind;
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.dataset.kind = kind;
  }

  function writeHelperSetting(stateKey) {
    const storageKey = HELPER_KEYS[stateKey];
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, String(state[stateKey] ?? '')); } catch {}
  }

  function syncAllHelperSettings() {
    for (const stateKey of Object.keys(HELPER_KEYS)) writeHelperSetting(stateKey);
  }

  function syncChangedHelperSettings(before) {
    for (const stateKey of Object.keys(HELPER_KEYS)) {
      if (before[stateKey] !== state[stateKey]) writeHelperSetting(stateKey);
    }
  }

  function escapeAttr(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  async function requestText(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        credentials: 'include',
        cache: 'no-store',
        ...options,
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`${new URL(url).pathname} ${response.status}`);
      return text;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error(`${new URL(url).pathname} timeout`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function extractWorkflow(html, definition) {
    const source = String(html || '')
      .replace(/&quot;/gi, '"')
      .replace(/&#34;/gi, '"')
      .replace(/&#x22;/gi, '"')
      .replace(/\\"/g, '"')
      .replace(/&amp;/gi, '&');

    const anchorRx = new RegExp(`"instructionId"\\s*:\\s*"${definition.instructionId}"`, 'i');
    const anchor = anchorRx.exec(source);
    if (!anchor) return null;
    const scope = source.slice(anchor.index, anchor.index + 2400);

    const grab = name => {
      const match = scope.match(new RegExp(`"${name}"\\s*:\\s*"([^"]+)"`, 'i'));
      return match?.[1] || '';
    };

    const workflow = {
      instructionId: grab('instructionId'),
      tool: grab('tool').toLowerCase(),
      objectId: grab('objectId'),
      status: grab('status').toUpperCase(),
      selector: /<input\b[^>]*\bname\s*=\s*["']options["']/i.test(source)
    };

    if (!workflow.objectId || workflow.instructionId !== definition.instructionId) return null;
    if (workflow.tool && workflow.tool !== definition.tool) return null;
    return workflow;
  }

  async function bootstrapWorkflow(definition) {
    const html = await requestText(routeFor(definition), { method: 'GET', redirect: 'follow' });
    const workflow = extractWorkflow(html, definition);
    if (!workflow) throw new Error('AFT workflow not found');
    return workflow;
  }

  async function workflowPost(path, payload) {
    return requestText(`${location.origin}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload)
    });
  }

  function workflowId(workflow, definition) {
    return {
      instructionId: workflow.instructionId || definition.instructionId,
      objectId: workflow.objectId
    };
  }

  async function getStatus(workflow, definition) {
    const text = await workflowPost('/status', { id: workflowId(workflow, definition) });
    let parsed;
    try { parsed = JSON.parse(text); }
    catch { throw new Error('Invalid /status response'); }

    const status = String(parsed?.status || '').toUpperCase();
    if (!status) throw new Error('Missing AFT status');
    return status;
  }

  async function waitForStatus(workflow, definition, accepted, timeoutMs = STATUS_TIMEOUT_MS) {
    const wanted = new Set(accepted);
    const deadline = Date.now() + timeoutMs;
    let last = workflow.status || '';

    while (Date.now() < deadline) {
      last = await getStatus(workflow, definition);
      if (wanted.has(last)) return last;
      if (!['READY', 'PROCESSING', 'COMPLETE'].includes(last)) throw new Error(`AFT workflow ${last}`);
      await sleep(POLL_MS);
    }
    throw new Error(`AFT workflow timeout (${last || 'unknown'})`);
  }

  async function waitForSelectorReady(workflow, definition) {
    const deadline = Date.now() + STATUS_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const status = await getStatus(workflow, definition);
      if (status === 'READY') {
        const refreshed = await bootstrapWorkflow(definition);
        if (refreshed.objectId === workflow.objectId && refreshed.selector) return refreshed;
      } else if (status !== 'PROCESSING') {
        throw new Error(`AFT workflow ${status}`);
      }
      await sleep(POLL_MS);
    }
    throw new Error('AFT mode selector timeout');
  }

  async function sendAction(workflow, definition, action, input) {
    await workflowPost('/action', {
      id: workflowId(workflow, definition),
      action,
      input
    });
  }

  async function endWorkflow(workflow, definition) {
    await workflowPost('/end', {
      id: workflowId(workflow, definition),
      tool: definition.tool
    });
  }

  async function waitForFreshWorkflow(definition, endedObjectId) {
    const deadline = Date.now() + FRESH_WORKFLOW_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const workflow = await bootstrapWorkflow(definition);
      if (workflow.objectId !== endedObjectId) return workflow;
      await sleep(POLL_MS);
    }
    throw new Error('Fresh AFT workflow not created');
  }

  async function ensureReadyWorkflow(definition, workflow = null) {
    let current = workflow || await bootstrapWorkflow(definition);

    for (let pass = 0; pass < 4; pass += 1) {
      if (current.status === 'READY') return current;

      if (current.status === 'PROCESSING') {
        current.status = await waitForStatus(current, definition, ['READY', 'COMPLETE']);
        if (current.status === 'READY') {
          current = await bootstrapWorkflow(definition);
          continue;
        }
      }

      if (current.status === 'COMPLETE') {
        const endedObjectId = current.objectId;
        await endWorkflow(current, definition);
        current = await waitForFreshWorkflow(definition, endedObjectId);
        continue;
      }

      throw new Error(`Unexpected AFT state ${current.status || 'unknown'}`);
    }

    throw new Error('Could not obtain READY workflow');
  }

  // API state is authoritative. Native AFT can remain visually stale.
  async function directSwitch(definition) {
    let workflow = await ensureReadyWorkflow(definition);

    if (definition.mode === 'fcsku' && !workflow.selector) return;

    if (!workflow.selector) {
      setStatus(`${definition.title} • opening mode…`);
      await sendAction(workflow, definition, 'SelectMode', 'SelectMode');
      workflow = await waitForSelectorReady(workflow, definition);
    }

    setStatus(`${definition.title} • selecting…`);
    await sendAction(workflow, definition, 'Input', definition.input);
    workflow.status = await waitForStatus(workflow, definition, ['COMPLETE']);

    const endedObjectId = workflow.objectId;
    await endWorkflow(workflow, definition);
    workflow = await waitForFreshWorkflow(definition, endedObjectId);
    await ensureReadyWorkflow(definition, workflow);
  }

  async function runSwitchQueue() {
    if (switchRunnerActive) return;
    switchRunnerActive = true;

    try {
      while (queuedModeKey) {
        const key = queuedModeKey;
        queuedModeKey = '';
        switchingKey = key;
        const definition = DEFINITIONS[key];
        if (!definition) continue;

        render();
        setStatus(`${definition.title} • backend switch…`);

        try {
          await directSwitch(definition);
          activeModeKey = key;
          if (!queuedModeKey) setStatus(`${definition.title} active • page may be stale`, 'ok');
        } catch (error) {
          activeModeKey = '';
          const message = String(error?.message || error || 'unknown error');
          if (!queuedModeKey) setStatus(`Backend switch failed • ${message} • SYNC PAGE`, 'warn');
        } finally {
          switchingKey = '';
          render();
        }
      }
    } finally {
      switchingKey = '';
      switchRunnerActive = false;
      render();
    }
  }

  function requestModeSwitch(area, mode) {
    state.area = area;
    if (area === 'edit') state.editMode = mode;
    else state.moveMode = mode;
    saveState();

    const key = `${area}:${mode}`;
    if (switchRunnerActive && switchingKey === key) {
      queuedModeKey = '';
      render();
      setStatus(`${DEFINITIONS[key].title} • backend switch…`);
      return;
    }

    queuedModeKey = key;
    render();
    if (switchRunnerActive) {
      setStatus(`${DEFINITIONS[key].title} queued…`, 'warn');
      return;
    }
    runSwitchQueue();
  }

  function syncPage() {
    if (switchRunnerActive) {
      setStatus('Backend switch in progress • wait before SYNC PAGE', 'warn');
      return;
    }
    const definition = selectedDefinition();
    const target = routeFor(definition);
    if (!target) return;
    setStatus(`Syncing native page to ${definition.title}…`);
    location.assign(target);
  }

  function makeChoiceButtons(values, selected, dataName, labelMap = {}, disabledValues = []) {
    const disabled = new Set(disabledValues);
    return values.map(value => {
      const active = value === selected;
      const label = labelMap[value] || value;
      return `<button type="button" class="aso-choice" data-${dataName}="${value}" data-active="${active ? '1' : '0'}" aria-pressed="${active ? 'true' : 'false'}" ${disabled.has(value) ? 'disabled' : ''}>${active ? '✓ ' : ''}${label}</button>`;
    }).join('');
  }

  function makeModeButtons(area, values, labelMap) {
    return values.map(value => {
      const key = `${area}:${value}`;
      const active = key === activeModeKey;
      const pending = !active && (key === switchingKey || key === queuedModeKey);
      const label = labelMap[value] || value;
      return `<button type="button" class="aso-choice" data-${area}-mode="${value}" data-active="${active ? '1' : '0'}" data-pending="${pending ? '1' : '0'}" aria-pressed="${active ? 'true' : 'false'}">${active ? '✓ ' : pending ? '… ' : ''}${label}</button>`;
    }).join('');
  }

  function adaptiveHtml() {
    const mode = modeKey();

    if (switchingKey && activeModeKey !== mode) {
      return '<div class="aso-note">BACKEND SWITCH IN PROGRESS… native page does not need to catch up.</div>';
    }

    if (mode === 'edit:each') {
      const showDisposition = state.eachState === 'Unsellable';
      return `
        <div class="aso-group">
          <div class="aso-label">Inventory state</div>
          <div class="aso-grid aso-grid-3">${makeChoiceButtons(STATES, state.eachState, 'each-state', { 'Pending Research': 'Pending' })}</div>
        </div>
        <div class="aso-group" ${showDisposition ? '' : 'hidden'}>
          <div class="aso-label">Disposition</div>
          <div class="aso-grid aso-grid-2">${makeChoiceButtons(DISPOSITIONS, state.eachDisposition, 'each-disposition')}</div>
        </div>`;
    }

    if (mode === 'edit:sku') {
      const currentUnsellable = state.skuCurrentState === 'Unsellable';
      const desiredUnsellable = state.skuDesiredState === 'Unsellable';
      return `
        <div class="aso-group">
          <div class="aso-label">Current state</div>
          <div class="aso-grid aso-grid-3">${makeChoiceButtons(STATES, state.skuCurrentState, 'sku-current-state', { 'Pending Research': 'Pending' })}</div>
        </div>
        <div class="aso-group" ${currentUnsellable ? '' : 'hidden'}>
          <div class="aso-label">Current disposition</div>
          <div class="aso-grid aso-grid-2">${makeChoiceButtons(DISPOSITIONS, state.skuCurrentDisposition, 'sku-current-disposition')}</div>
        </div>
        <div class="aso-group">
          <div class="aso-label">Desired state</div>
          <div class="aso-grid aso-grid-3">${makeChoiceButtons(
            STATES,
            state.skuDesiredState,
            'sku-desired-state',
            { 'Pending Research': 'Pending' },
            currentUnsellable ? [] : [state.skuCurrentState]
          )}</div>
        </div>
        <div class="aso-group" ${desiredUnsellable ? '' : 'hidden'}>
          <div class="aso-label">Desired disposition</div>
          <div class="aso-grid aso-grid-2">${makeChoiceButtons(
            DISPOSITIONS,
            state.skuDesiredDisposition,
            'sku-desired-disposition',
            {},
            currentUnsellable && desiredUnsellable ? [state.skuCurrentDisposition] : []
          )}</div>
        </div>`;
    }

    if (mode === 'move:multi') {
      const userQty = state.moveQtyMode === 'user';
      return `
        <div class="aso-group">
          <div class="aso-label">Quantity</div>
          <div class="aso-grid aso-qty-grid">
            ${makeChoiceButtons(['all', 'user'], state.moveQtyMode, 'qty-mode', { all: 'ALL', user: 'USER' })}
            <input data-user-qty type="number" min="1" max="999999" step="1" inputmode="numeric" placeholder="Qty" value="${escapeAttr(state.moveUserQty)}" ${userQty ? '' : 'hidden'}>
          </div>
        </div>`;
    }

    const messages = {
      'edit:date': 'Date workflow selected in backend. SYNC PAGE only for native/manual controls.',
      'edit:fcsku': 'FCSKU uses SKU only. LPN is not used.',
      'move:each': 'Move Each selected in backend. Existing helper settings are preserved.',
      'move:container': 'Move Container selected in backend.'
    };
    return `<div class="aso-note">${messages[mode] || 'Select a mode.'}</div>`;
  }

  function choose(key, value) {
    const before = { ...state };
    state[key] = value;
    normalizeRules();
    saveState();
    syncChangedHelperSettings(before);
    render();
  }

  function wireUi() {
    root.querySelector('[data-min]').onclick = () => {
      state.minimized = !state.minimized;
      saveState();
      render();
    };

    root.querySelectorAll('[data-area]').forEach(button => {
      button.onclick = () => choose('area', button.dataset.area);
    });
    root.querySelectorAll('[data-edit-mode]').forEach(button => {
      button.onclick = () => requestModeSwitch('edit', button.dataset.editMode);
    });
    root.querySelectorAll('[data-move-mode]').forEach(button => {
      button.onclick = () => requestModeSwitch('move', button.dataset.moveMode);
    });
    root.querySelectorAll('[data-each-state]').forEach(button => {
      button.onclick = () => choose('eachState', button.dataset.eachState);
    });
    root.querySelectorAll('[data-each-disposition]').forEach(button => {
      button.onclick = () => choose('eachDisposition', button.dataset.eachDisposition);
    });
    root.querySelectorAll('[data-sku-current-state]').forEach(button => {
      button.onclick = () => choose('skuCurrentState', button.dataset.skuCurrentState);
    });
    root.querySelectorAll('[data-sku-current-disposition]').forEach(button => {
      button.onclick = () => choose('skuCurrentDisposition', button.dataset.skuCurrentDisposition);
    });
    root.querySelectorAll('[data-sku-desired-state]').forEach(button => {
      button.onclick = () => choose('skuDesiredState', button.dataset.skuDesiredState);
    });
    root.querySelectorAll('[data-sku-desired-disposition]').forEach(button => {
      button.onclick = () => choose('skuDesiredDisposition', button.dataset.skuDesiredDisposition);
    });
    root.querySelectorAll('[data-qty-mode]').forEach(button => {
      button.onclick = () => choose('moveQtyMode', button.dataset.qtyMode);
    });

    const qty = root.querySelector('[data-user-qty]');
    if (qty) {
      qty.oninput = () => {
        state.moveUserQty = qty.value.replace(/[^0-9]/g, '').slice(0, 6);
        saveState();
        writeHelperSetting('moveUserQty');
      };
    }

    root.querySelector('[data-sync]').onclick = syncPage;
  }

  function render() {
    if (!root) return;
    root.dataset.minimized = state.minimized ? '1' : '0';
    root.dataset.busy = switchRunnerActive ? '1' : '0';
    root.innerHTML = `
      <div class="aso-head">
        <div><span class="aso-test">TEST</span> AFT SUPER <span class="aso-version">v${VERSION}</span></div>
        <button type="button" class="aso-min" data-min aria-label="${state.minimized ? 'Expand' : 'Minimize'}">${state.minimized ? '+' : '−'}</button>
      </div>
      <div class="aso-body">
        <div class="aso-main-tabs">
          <button type="button" data-area="edit" data-active="${state.area === 'edit' ? '1' : '0'}">EDIT</button>
          <button type="button" data-area="move" data-active="${state.area === 'move' ? '1' : '0'}">MOVE</button>
        </div>
        <div class="aso-mode-tabs">
          ${state.area === 'edit'
            ? makeModeButtons('edit', EDIT_MODES, { each: 'EACH', sku: 'SKU', date: 'DATE', fcsku: 'FCSKU' })
            : makeModeButtons('move', MOVE_MODES, { each: 'EACH', multi: 'MULTI', container: 'CONTAINER' })}
        </div>
        <div class="aso-adaptive">${adaptiveHtml()}</div>
        <div class="aso-status" data-status data-kind="${statusKind}">${statusMessage}</div>
        <div class="aso-actions"><button type="button" data-sync ${switchRunnerActive ? 'disabled' : ''}>SYNC PAGE</button></div>
        <div class="aso-safety">API-FIRST TEST • native page may intentionally stay stale</div>
      </div>`;

    statusEl = root.querySelector('[data-status]');
    wireUi();
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID}{position:fixed;z-index:2147483647;top:76px;left:50%;transform:translateX(-50%);width:430px;max-width:calc(100vw - 24px);overflow:hidden;border:2px solid #b85c00;border-radius:9px;background:#f4f7f8;color:#1e2b31;box-shadow:0 8px 24px #0005;font:13px/1.35 Arial,sans-serif}
      #${ROOT_ID} *{box-sizing:border-box}#${ROOT_ID} button{font:inherit;font-weight:800;cursor:pointer}#${ROOT_ID} button:disabled{cursor:not-allowed;opacity:.55}#${ROOT_ID} [hidden]{display:none!important}
      #${ROOT_ID} .aso-head{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:#263f47;color:#fff;font-weight:900;letter-spacing:.25px}
      #${ROOT_ID} .aso-test{display:inline-block;margin-right:5px;padding:2px 5px;border-radius:4px;background:#f59e0b;color:#1b2529;font-size:10px}#${ROOT_ID} .aso-version{color:#cdd9dd;font-size:10px}
      #${ROOT_ID} .aso-min{width:29px;height:24px;padding:0;border:1px solid #9bb0b7;border-radius:5px;background:#1d333a;color:#fff}
      #${ROOT_ID}[data-minimized="1"]{width:auto;min-width:190px}#${ROOT_ID}[data-minimized="1"] .aso-body{display:none}
      #${ROOT_ID} .aso-body{display:grid;gap:8px;padding:9px;background:#f1f6f7}
      #${ROOT_ID} .aso-main-tabs{display:grid;grid-template-columns:1fr 1fr;gap:7px}
      #${ROOT_ID} .aso-main-tabs button,#${ROOT_ID} .aso-mode-tabs button,#${ROOT_ID} .aso-choice,#${ROOT_ID} .aso-actions button{min-width:0;padding:7px 5px;border:1px solid #91a1a8;border-radius:6px;background:#fff;color:#26343a}
      #${ROOT_ID} button[data-active="1"]{background:#245e56;color:#fff;border-color:#17463f;box-shadow:inset 0 0 0 1px #fff6}
      #${ROOT_ID} .aso-mode-tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}#${ROOT_ID} .aso-mode-tabs:has([data-move-mode]){grid-template-columns:repeat(3,minmax(0,1fr))}
      #${ROOT_ID} .aso-adaptive{display:grid;gap:7px}#${ROOT_ID} .aso-group{display:grid;gap:5px;padding:7px;border:1px solid #c4d0d4;border-radius:7px;background:#fbfdfe}
      #${ROOT_ID} .aso-label{font-size:11px;font-weight:900;color:#3a4e56}#${ROOT_ID} .aso-grid{display:grid;gap:6px}#${ROOT_ID} .aso-grid-3{grid-template-columns:repeat(3,minmax(0,1fr))}#${ROOT_ID} .aso-grid-2{grid-template-columns:repeat(2,minmax(0,1fr))}
      #${ROOT_ID} .aso-qty-grid{grid-template-columns:72px 72px minmax(0,1fr)}#${ROOT_ID} input{width:100%;min-width:0;padding:7px;border:1px solid #91a1a8;border-radius:6px;background:#fff;color:#1e2b31;font-weight:800;text-align:center}
      #${ROOT_ID} .aso-note{padding:9px;border:1px solid #c4d0d4;border-radius:6px;background:#fff;color:#52636a}
      #${ROOT_ID} button[data-pending="1"]{background:#dce9f5;color:#174f7a;border-color:#4380ad}
      #${ROOT_ID} .aso-status{min-height:28px;padding:6px 8px;border:1px solid #c4d0d4;border-radius:6px;background:#e8f2f5;font-weight:800}#${ROOT_ID} .aso-status[data-kind="ok"]{border-color:#35836f;background:#dcefe8;color:#164d41}#${ROOT_ID} .aso-status[data-kind="warn"]{border-color:#d38a19;background:#fff0cf;color:#5c3a00}
      #${ROOT_ID} .aso-actions{display:flex;justify-content:flex-end}#${ROOT_ID} .aso-actions button{padding:5px 9px;font-size:11px}
      #${ROOT_ID} .aso-safety{text-align:center;color:#66767c;font-size:10px}
      @media(max-width:560px){#${ROOT_ID}{top:10px}#${ROOT_ID} .aso-grid-3{grid-template-columns:1fr}#${ROOT_ID} .aso-mode-tabs{grid-template-columns:repeat(2,minmax(0,1fr))}#${ROOT_ID} .aso-mode-tabs:has([data-move-mode]){grid-template-columns:repeat(3,minmax(0,1fr))}}
    `;
    document.documentElement.appendChild(style);
  }

  function start() {
    if (document.getElementById(ROOT_ID)) return;
    normalizeRules();
    saveState();
    syncAllHelperSettings();
    injectStyle();

    root = document.createElement('section');
    root.id = ROOT_ID;
    document.body.appendChild(root);
    render();
  }

  function startWhenReady() {
    if (!document.body) {
      setTimeout(startWhenReady, 20);
      return;
    }
    start();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startWhenReady, { once: true });
  else startWhenReady();
})();