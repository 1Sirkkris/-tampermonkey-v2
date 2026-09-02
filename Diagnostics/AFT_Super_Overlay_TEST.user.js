// ==UserScript==
// @name         TEST v0.4.0 AFT Super Overlay
// @name:en      TEST v0.4.0 AFT Super Overlay
// @namespace    https://github.com/1Sirkkris
// @version      0.4.0
// @description  TEST: API-first AFT Edit/Move mode controller. Switches workflow through /action, /status and /end without waiting for native page rendering; native page may remain stale until SYNC PAGE.
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

  const VERSION = '0.4.0';
  const ROOT_ID = 'aft-super-test';
  const STYLE_ID = 'aft-super-test-style';
  const STORE_KEY = 'aft_super_overlay_test_v010';
  const POLL_MS = 100;
  const STATUS_TIMEOUT_MS = 8000;
  const BOOTSTRAP_TIMEOUT_MS = 5000;
  const STATES = ['Sellable', 'Pending Research', 'Unsellable'];
  const DISPOSITIONS = ['Amazon Damage', 'Defective', 'Distributor Damage', 'Expired'];
  const VALID_EDIT_MODES = ['each', 'sku', 'date', 'fcsku'];
  const VALID_MOVE_MODES = ['each', 'multi', 'container'];

  const DEFAULTS = {
    area: 'edit',
    editMode: 'each',
    moveMode: 'each',
    minimized: false,
    aftOrigin: '',
    backendMode: '',
    backendConfirmedAt: 0,
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
      title: 'Edit • Each',
      area: 'edit', mode: 'each', path: '/app/edititems',
      instructionId: 'EditItems', tool: 'edititems', input: 'EACH', nativeMode: 'each',
      needsSelectMode: true
    },
    'edit:sku': {
      title: 'Edit • SKU',
      area: 'edit', mode: 'sku', path: '/app/edititems',
      instructionId: 'EditItems', tool: 'edititems', input: 'SKU', nativeMode: 'sku',
      needsSelectMode: true
    },
    'edit:date': {
      title: 'Edit • Date',
      area: 'edit', mode: 'date', path: '/app/edititems',
      instructionId: 'EditItems', tool: 'edititems', input: 'DATELOT', nativeMode: 'datelot',
      needsSelectMode: true
    },
    'edit:fcsku': {
      title: 'Edit • FCSKU',
      area: 'edit', mode: 'fcsku', path: '/app/fcskuflip',
      instructionId: 'FcSkuFlip', tool: 'fcskuflip', input: 'SKU', nativeMode: 'sku',
      needsSelectMode: false
    },
    'move:each': {
      title: 'Move • Each',
      area: 'move', mode: 'each', path: '/app/moveitems',
      instructionId: 'MoveItems', tool: 'moveitems', input: 'EACH', nativeMode: 'each',
      needsSelectMode: true
    },
    'move:multi': {
      title: 'Move • Multi',
      area: 'move', mode: 'multi', path: '/app/moveitems',
      instructionId: 'MoveItems', tool: 'moveitems', input: 'MULTI', nativeMode: 'multi',
      needsSelectMode: true
    },
    'move:container': {
      title: 'Move • Container',
      area: 'move', mode: 'container', path: '/app/moveitems',
      instructionId: 'MoveItems', tool: 'moveitems', input: 'CONTAINER', nativeMode: 'container',
      needsSelectMode: true
    }
  };

  let state = loadState();
  let root = null;
  let statusEl = null;
  let switchBusy = false;
  let queuedModeKey = '';
  let switchSerial = 0;

  function norm(value) {
    return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function low(value) {
    return norm(value).toLowerCase();
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function loadState() {
    try {
      const saved = GM_getValue(STORE_KEY, {});
      return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function saveState() {
    try { GM_setValue(STORE_KEY, state); } catch {}
  }

  function normalizeRules() {
    if (!['edit', 'move'].includes(state.area)) state.area = 'edit';
    if (!VALID_EDIT_MODES.includes(state.editMode)) state.editMode = 'each';
    if (!VALID_MOVE_MODES.includes(state.moveMode)) state.moveMode = 'each';
    if (state.backendMode && !DEFINITIONS[state.backendMode]) state.backendMode = '';

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

  function isAftQt() {
    return /^aft-qt-/i.test(location.hostname) && /\.corp\.amazon\.com$/i.test(location.hostname);
  }

  function rememberOrigin() {
    if (!isAftQt()) return;
    if (state.aftOrigin === location.origin) return;
    state.aftOrigin = location.origin;
    saveState();
  }

  function routeFor(definition) {
    if (!definition || !state.aftOrigin) return '';
    return `${state.aftOrigin}${definition.path}?experience=Desktop`;
  }

  function modeKey(area = state.area, mode = area === 'edit' ? state.editMode : state.moveMode) {
    return `${area}:${mode}`;
  }

  function selectedDefinition() {
    return DEFINITIONS[modeKey()];
  }

  function setStatus(message, kind = '') {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.dataset.kind = kind;
  }

  function writeLocalSetting(key, value) {
    if (!isAftQt()) return;
    try { localStorage.setItem(key, String(value)); } catch {}
  }

  function syncStableHelperSettings() {
    if (!isAftQt()) return;
    writeLocalSetting('aftm_each_state', state.eachState);
    writeLocalSetting('aftm_each_disp', state.eachDisposition);
    writeLocalSetting('aftm_sku_current_state', state.skuCurrentState);
    writeLocalSetting('aftm_sku_current_damage', state.skuCurrentDisposition);
    writeLocalSetting('aftm_sku_desired_state', state.skuDesiredState);
    writeLocalSetting('aftm_sku_desired_damage', state.skuDesiredDisposition);
    writeLocalSetting('aftm_move_qty_mode', state.moveQtyMode);
    writeLocalSetting('aftm_move_user_qty', state.moveUserQty);
  }

  function escapeAttr(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function currentNativeModeKey() {
    if (!document.body || !isAftQt()) return '';
    const path = location.pathname.toLowerCase();
    const copy = document.body.cloneNode(true);
    copy.querySelectorAll(`#${ROOT_ID},.aftm`).forEach(el => el.remove());
    const text = norm(copy.textContent || '');
    const match = text.match(/\bMode\s*:\s*(Datelot|Container|Multi|Each|Sku|LPN)/i);
    const native = match ? low(match[1]) : '';

    if (path.startsWith('/app/fcskuflip') && native === 'sku') return 'edit:fcsku';
    if (path.startsWith('/app/edititems')) {
      if (native === 'datelot') return 'edit:date';
      if (native === 'each' || native === 'sku') return `edit:${native}`;
    }
    if (path.startsWith('/app/moveitems') && ['each', 'multi', 'container'].includes(native)) return `move:${native}`;
    return '';
  }

  function pageHints(html) {
    try {
      const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
      doc.querySelectorAll('script,style,noscript').forEach(node => node.remove());
      const text = norm(doc.body?.textContent || '');
      const match = text.match(/\bMode\s*:\s*(Datelot|Container|Multi|Each|Sku|LPN)/i);
      return {
        pageMode: match ? low(match[1]) : '',
        selector: /\bSelect\s+mode\b/i.test(text)
      };
    } catch {
      return { pageMode: '', selector: false };
    }
  }

  function extractWorkflow(html, fallbackDefinition = null) {
    const source = String(html || '')
      .replace(/&quot;/gi, '"')
      .replace(/&#34;/gi, '"')
      .replace(/&#x22;/gi, '"')
      .replace(/\\"/g, '"')
      .replace(/&amp;/gi, '&');

    let scope = source;
    if (fallbackDefinition?.instructionId) {
      const anchorRx = new RegExp(`"instructionId"\\s*:\\s*"${fallbackDefinition.instructionId}"`, 'i');
      const match = anchorRx.exec(source);
      if (match) scope = source.slice(match.index, match.index + 2400);
    }

    const grab = name => {
      const rx = new RegExp(`"${name}"\\s*:\\s*"([^"]+)"`, 'i');
      return scope.match(rx)?.[1] || '';
    };

    const hints = pageHints(html);
    const workflow = {
      instructionId: grab('instructionId'),
      tool: low(grab('tool')),
      objectId: grab('objectId'),
      status: grab('status').toUpperCase(),
      pageMode: hints.pageMode,
      selector: hints.selector
    };

    if (!workflow.instructionId && fallbackDefinition) workflow.instructionId = fallbackDefinition.instructionId;
    if (!workflow.tool && fallbackDefinition) workflow.tool = fallbackDefinition.tool;

    if (!workflow.objectId) return null;
    if (fallbackDefinition && workflow.instructionId !== fallbackDefinition.instructionId) return null;
    if (fallbackDefinition && workflow.tool && workflow.tool !== fallbackDefinition.tool) return null;
    return workflow;
  }

  async function readTextResponse(response) {
    try { return await response.text(); }
    catch { return ''; }
  }

  async function bootstrapWorkflow(definition) {
    const route = routeFor(definition);
    if (!route) throw new Error('AFT origin unavailable');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BOOTSTRAP_TIMEOUT_MS);
    try {
      const response = await fetch(route, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        redirect: 'follow',
        signal: controller.signal
      });
      const text = await readTextResponse(response);
      if (!response.ok) throw new Error(`AFT page ${response.status}`);
      const workflow = extractWorkflow(text, definition);
      if (!workflow) throw new Error('AFT workflow not found in page response');
      return workflow;
    } finally {
      clearTimeout(timer);
    }
  }

  async function workflowPost(path, payload) {
    const response = await fetch(`${state.aftOrigin}${path}`, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload)
    });
    const text = await readTextResponse(response);
    if (!response.ok) throw new Error(`${path} ${response.status}`);
    return text;
  }

  function workflowId(workflow, definition) {
    return {
      instructionId: workflow.instructionId || definition.instructionId,
      objectId: workflow.objectId
    };
  }

  async function getStatus(workflow, definition) {
    const text = await workflowPost('/status', { id: workflowId(workflow, definition) });
    try {
      const parsed = JSON.parse(text || '{}');
      return String(parsed.status || '').toUpperCase();
    } catch {
      return '';
    }
  }

  async function waitForStatus(workflow, definition, accepted, timeoutMs = STATUS_TIMEOUT_MS) {
    const wanted = new Set(accepted);
    const started = Date.now();
    let last = workflow.status || '';

    while (Date.now() - started < timeoutMs) {
      last = await getStatus(workflow, definition);
      if (wanted.has(last)) return last;
      if (['ERROR', 'FAILED', 'CLOSED'].includes(last)) throw new Error(`AFT workflow ${last}`);
      await sleep(POLL_MS);
    }
    throw new Error(`AFT workflow timeout (${last || 'unknown'})`);
  }

  async function endWorkflow(workflow, definition) {
    await workflowPost('/end', {
      id: workflowId(workflow, definition),
      tool: definition.tool
    });
  }

  async function bootstrapAfterEnd(definition, endedObjectId) {
    const started = Date.now();
    let workflow = null;
    while (Date.now() - started < 1500) {
      workflow = await bootstrapWorkflow(definition);
      if (workflow.objectId !== endedObjectId || workflow.status !== 'COMPLETE') return workflow;
      await sleep(50);
    }
    throw new Error('AFT did not create a fresh workflow');
  }

  async function getReadyWorkflow(definition) {
    let workflow = await bootstrapWorkflow(definition);

    for (let pass = 0; pass < 4; pass += 1) {
      if (workflow.status === 'READY') return workflow;

      if (workflow.status === 'PROCESSING') {
        const status = await waitForStatus(workflow, definition, ['READY', 'COMPLETE']);
        workflow.status = status;
        if (status === 'READY') {
          await sleep(25);
          const refreshed = await bootstrapWorkflow(definition);
          if (refreshed.objectId === workflow.objectId) return refreshed;
          workflow = refreshed;
          continue;
        }
      }

      if (workflow.status === 'COMPLETE') {
        const endedObjectId = workflow.objectId;
        await endWorkflow(workflow, definition);
        workflow = await bootstrapAfterEnd(definition, endedObjectId);
        continue;
      }

      if (!workflow.status) {
        workflow.status = await getStatus(workflow, definition);
        continue;
      }

      throw new Error(`Unexpected AFT state ${workflow.status}`);
    }

    throw new Error('Could not obtain READY workflow');
  }

  async function sendAction(workflow, definition, action, input) {
    await workflowPost('/action', {
      id: workflowId(workflow, definition),
      action,
      input
    });
  }

  async function finalizeModeChange(workflow, definition) {
    const status = await waitForStatus(workflow, definition, ['COMPLETE', 'READY']);
    if (status === 'READY') {
      await sleep(25);
      return bootstrapWorkflow(definition);
    }

    const endedObjectId = workflow.objectId;
    await endWorkflow(workflow, definition);
    const fresh = await bootstrapAfterEnd(definition, endedObjectId);
    if (fresh.status === 'READY') return fresh;
    return getReadyWorkflow(definition);
  }

  function workflowAlreadyInMode(workflow, definition) {
    return workflow.status === 'READY' && workflow.pageMode === definition.nativeMode;
  }

  async function directSwitch(definition) {
    let workflow = await getReadyWorkflow(definition);

    if (workflowAlreadyInMode(workflow, definition)) return workflow;

    if (!workflow.selector) {
      if (!workflow.pageMode && definition.tool === 'fcskuflip') {
        throw new Error('FCSKU workflow state unclear');
      }
      setStatus(`${definition.title} • opening mode…`);
      await sendAction(workflow, definition, 'SelectMode', 'SelectMode');
      const selectorState = await waitForStatus(workflow, definition, ['READY']);
      workflow.status = selectorState;
      workflow.selector = true;
      workflow.pageMode = '';
    }

    setStatus(`${definition.title} • selecting…`);
    await sendAction(workflow, definition, 'Input', definition.input);
    workflow = await finalizeModeChange(workflow, definition);

    if (!workflowAlreadyInMode(workflow, definition)) {
      throw new Error(`AFT did not confirm ${definition.title}`);
    }

    return workflow;
  }

  async function performSwitch(key) {
    const definition = DEFINITIONS[key];
    if (!definition) return;

    syncStableHelperSettings();

    if (switchBusy) {
      queuedModeKey = key;
      setStatus(`${definition.title} queued…`, 'warn');
      return;
    }

    switchBusy = true;
    queuedModeKey = '';
    const serial = ++switchSerial;
    render();
    setStatus(`${definition.title} • backend switch…`);

    let finalMessage = '';
    let finalKind = '';
    try {
      await directSwitch(definition);
      if (serial !== switchSerial) return;
      state.backendMode = key;
      state.backendConfirmedAt = Date.now();
      state.area = definition.area;
      if (definition.area === 'edit') state.editMode = definition.mode;
      else state.moveMode = definition.mode;
      saveState();
      finalMessage = `${definition.title} active • page may be stale`;
      finalKind = 'ok';
    } catch (error) {
      console.error('[AFT SUPER]', error);
      state.backendMode = '';
      state.backendConfirmedAt = 0;
      saveState();
      const message = String(error?.message || error || 'unknown error');
      finalMessage = `Backend switch failed • ${message} • SYNC PAGE`;
      finalKind = 'warn';
    } finally {
      switchBusy = false;
      render();
      if (finalMessage) setStatus(finalMessage, finalKind);
      const next = queuedModeKey;
      queuedModeKey = '';
      if (next && next !== key) setTimeout(() => performSwitch(next), 0);
    }
  }

  function syncPage() {
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
    const active = state.backendMode || currentNativeModeKey();
    return values.map(value => {
      const key = `${area}:${value}`;
      const isActive = key === active;
      const isPending = switchBusy && modeKey() === key && !isActive;
      const label = labelMap[value] || value;
      return `<button type="button" class="aso-choice" data-${area}-mode="${value}" data-active="${isActive ? '1' : '0'}" data-pending="${isPending ? '1' : '0'}" aria-pressed="${isActive ? 'true' : 'false'}">${isActive ? '✓ ' : isPending ? '… ' : ''}${label}</button>`;
    }).join('');
  }

  function adaptiveHtml() {
    const mode = modeKey();
    const active = state.backendMode || currentNativeModeKey();

    if (switchBusy && active !== mode) {
      return `<div class="aso-note">BACKEND SWITCH IN PROGRESS… native page does not need to catch up.</div>`;
    }

    if (mode === 'edit:each') {
      const showDisposition = state.eachState === 'Unsellable';
      return `
        <div class="aso-group">
          <div class="aso-label">Inventory state</div>
          <div class="aso-grid aso-grid-3">${makeChoiceButtons(STATES, state.eachState, 'each-state', { 'Pending Research': 'Pending' })}</div>
        </div>
        <div class="aso-group" data-adaptive ${showDisposition ? '' : 'hidden'}>
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
        <div class="aso-group" data-adaptive ${currentUnsellable ? '' : 'hidden'}>
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
        <div class="aso-group" data-adaptive ${desiredUnsellable ? '' : 'hidden'}>
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
      'edit:date': 'Date workflow selected in backend. SYNC PAGE only if you need native/manual controls.',
      'edit:fcsku': 'FCSKU automatically selects the inner SKU workflow; LPN is never selected.',
      'move:each': 'Move Each selected in backend. Existing helper settings are preserved.',
      'move:container': 'Move Container selected in backend. No separate Move App is used.'
    };
    return `<div class="aso-note">${messages[mode] || 'Select a mode.'}</div>`;
  }

  function choose(key, value) {
    state[key] = value;
    normalizeRules();
    saveState();
    syncStableHelperSettings();
    render();
  }

  function chooseMode(area, mode) {
    state.area = area;
    if (area === 'edit') state.editMode = mode;
    else state.moveMode = mode;
    saveState();
    render();
    performSwitch(`${area}:${mode}`);
  }

  function render() {
    if (!root) return;
    root.dataset.minimized = state.minimized ? '1' : '0';
    root.dataset.busy = switchBusy ? '1' : '0';

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
            ? makeModeButtons('edit', VALID_EDIT_MODES, { each: 'EACH', sku: 'SKU', date: 'DATE', fcsku: 'FCSKU' })
            : makeModeButtons('move', VALID_MOVE_MODES, { each: 'EACH', multi: 'MULTI', container: 'CONTAINER' })}
        </div>
        <div class="aso-adaptive">${adaptiveHtml()}</div>
        <div class="aso-status" data-status>Backend controller ready</div>
        <div class="aso-actions"><button type="button" data-sync>SYNC PAGE</button></div>
        <div class="aso-safety">API-FIRST TEST • native page may intentionally stay stale</div>
      </div>`;

    statusEl = root.querySelector('[data-status]');
    wireUi();
    paintCurrentStatus();
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
      button.onclick = () => chooseMode('edit', button.dataset.editMode);
    });
    root.querySelectorAll('[data-move-mode]').forEach(button => {
      button.onclick = () => chooseMode('move', button.dataset.moveMode);
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
        writeLocalSetting('aftm_move_user_qty', state.moveUserQty);
      };
    }

    root.querySelector('[data-sync]').onclick = syncPage;
  }

  function paintCurrentStatus() {
    const definition = selectedDefinition();
    if (!definition) return;
    if (switchBusy) {
      setStatus(`${definition.title} • backend switch…`);
      return;
    }

    const active = state.backendMode || currentNativeModeKey();
    if (active === modeKey()) {
      const stale = currentNativeModeKey() !== active;
      setStatus(`${definition.title} active${stale ? ' • page stale' : ''}`, 'ok');
      return;
    }

    if (active && DEFINITIONS[active]) {
      setStatus(`Backend active: ${DEFINITIONS[active].title}`);
      return;
    }

    setStatus('Backend controller ready');
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID}{position:fixed;z-index:2147483647;top:76px;left:50%;transform:translateX(-50%);width:430px;max-width:calc(100vw - 24px);overflow:hidden;border:2px solid #b85c00;border-radius:9px;background:#f4f7f8;color:#1e2b31;box-shadow:0 8px 24px #0005;font:13px/1.35 Arial,sans-serif}
      #${ROOT_ID} *{box-sizing:border-box}#${ROOT_ID} button{font:inherit;font-weight:800;cursor:pointer}#${ROOT_ID} [hidden]{display:none!important}
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
    rememberOrigin();
    normalizeRules();
    syncStableHelperSettings();

    const native = currentNativeModeKey();
    if (native) {
      state.backendMode = native;
      state.backendConfirmedAt = Date.now();
      const definition = DEFINITIONS[native];
      if (definition) {
        state.area = definition.area;
        if (definition.area === 'edit') state.editMode = definition.mode;
        else state.moveMode = definition.mode;
      }
    }
    saveState();

    injectStyle();
    root = document.createElement('section');
    root.id = ROOT_ID;
    document.body.appendChild(root);
    render();
  }

  function startWhenReady() {
    if (!document.body) return setTimeout(startWhenReady, 20);
    start();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startWhenReady, { once: true });
  else startWhenReady();
})();
