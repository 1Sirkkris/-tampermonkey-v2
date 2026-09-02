// ==UserScript==
// @name         TEST v0.3.0 AFT Super Overlay
// @name:en      TEST v0.3.0 AFT Super Overlay
// @namespace    https://github.com/1Sirkkris
// @version      0.3.0
// @description  TEST: adaptive Edit/Move mode switcher using AFT's native selector. Mode buttons switch immediately; no inventory actions are submitted.
// @include      *://aft-qt-*.corp.amazon.com/*
// @include      /^https?:\/\/aft-moveapp-[^\/.]+(?:\.nrt)?\.proxy\.amazon\.com\/move-container(?:[\/?#]|$)/
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

  const VERSION = '0.3.0';
  const ROOT_ID = 'aft-super-test';
  const STYLE_ID = 'aft-super-test-style';
  const STORE_KEY = 'aft_super_overlay_test_v010';
  const PENDING_MAX_AGE_MS = 2 * 60 * 1000;
  const MOVE_CONTAINER_URL = 'https://aft-moveapp-nrt-nrt.nrt.proxy.amazon.com/move-container';
  const STATES = ['Sellable', 'Pending Research', 'Unsellable'];
  const DISPOSITIONS = ['Amazon Damage', 'Defective', 'Distributor Damage', 'Expired'];

  const DEFAULTS = {
    area: 'edit',
    editMode: 'each',
    moveMode: 'each',
    minimized: false,
    aftOrigin: '',
    pendingMode: '',
    pendingAt: 0,
    eachState: 'Unsellable',
    eachDisposition: 'Amazon Damage',
    skuCurrentState: 'Sellable',
    skuCurrentDisposition: 'Defective',
    skuDesiredState: 'Unsellable',
    skuDesiredDisposition: 'Defective',
    moveQtyMode: 'all',
    moveUserQty: ''
  };

  let state = loadState();
  let root = null;
  let statusEl = null;
  let nativeTimer = 0;
  let changeModeRequested = false;
  let selectorSubmitted = false;

  function norm(value) {
    return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function low(value) {
    return norm(value).toLowerCase();
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

  function isAftQt() {
    return /^aft-qt-/i.test(location.hostname) && /\.corp\.amazon\.com$/i.test(location.hostname);
  }

  function isMoveContainer() {
    return /^aft-moveapp-/i.test(location.hostname) && /\/move-container(?:\/|$)/i.test(location.pathname);
  }

  function rememberOrigin() {
    if (!isAftQt()) return;
    if (state.aftOrigin === location.origin) return;
    state.aftOrigin = location.origin;
    saveState();
  }

  function selectedMode() {
    return state.area === 'edit' ? state.editMode : state.moveMode;
  }

  function modeKey(area = state.area, mode = selectedMode()) {
    return `${area}:${mode}`;
  }

  function selectedDefinition() {
    return DEFINITIONS[modeKey()];
  }

  function routeFor(definition) {
    if (!definition) return '';
    if (definition.externalUrl) return definition.externalUrl;
    return state.aftOrigin ? `${state.aftOrigin}${definition.path}` : '';
  }

  function currentRouteMatches(definition) {
    if (!definition) return false;
    if (definition.externalUrl) return isMoveContainer();
    return isAftQt() && location.pathname.toLowerCase().startsWith(definition.path.toLowerCase());
  }

  function currentNativeMode() {
    if (!document.body) return '';
    const copy = document.body.cloneNode(true);
    copy.querySelectorAll(`#${ROOT_ID},.aftm`).forEach(el => el.remove());
    const text = norm(copy.textContent || '');
    const match = text.match(/\bMode\s*:\s*(Datelot|Container|Multi|Each|Sku|LPN)/i);
    return match ? low(match[1]) : '';
  }

  function activeModeKey() {
    if (isMoveContainer()) return 'move:moveapp';
    if (!isAftQt()) return '';
    if (location.pathname.toLowerCase().startsWith('/app/fcskuflip')) return 'edit:fcsku';
    const native = currentNativeMode();
    if (!native) return '';
    if (location.pathname.toLowerCase().startsWith('/app/edititems')) {
      return `edit:${native === 'datelot' ? 'date' : native}`;
    }
    if (location.pathname.toLowerCase().startsWith('/app/moveitems')) return `move:${native}`;
    return '';
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

  function dispatchValue(selector, value) {
    const el = document.querySelector(selector);
    if (!el || el.value === value) return;
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
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

    dispatchValue('#aftm-each [data-state]', state.eachState);
    dispatchValue('#aftm-each [data-disp]', state.eachDisposition);
    dispatchValue('#aftm-sku [data-cur-state]', state.skuCurrentState);
    dispatchValue('#aftm-sku [data-cur-dmg]', state.skuCurrentDisposition);
    dispatchValue('#aftm-sku [data-new-state]', state.skuDesiredState);
    dispatchValue('#aftm-sku [data-new-dmg]', state.skuDesiredDisposition);
  }

  const DEFINITIONS = {
    'edit:each': {
      title: 'Edit • Each', path: '/app/edititems', nativeMode: 'each',
      labels: ['Each', 'Edit Each']
    },
    'edit:sku': {
      title: 'Edit • SKU', path: '/app/edititems', nativeMode: 'sku',
      labels: ['Sku', 'SKU', 'Edit SKU']
    },
    'edit:date': {
      title: 'Edit • Date', path: '/app/edititems', nativeMode: 'datelot',
      labels: ['Datelot', 'Date Lot', 'Expiry', 'Expiration']
    },
    'edit:fcsku': {
      title: 'Edit • FCSKU', path: '/app/fcskuflip', nativeMode: '', labels: []
    },
    'move:each': {
      title: 'Move • Each', path: '/app/moveitems', nativeMode: 'each',
      labels: ['Each', 'Move Each']
    },
    'move:multi': {
      title: 'Move • Multi', path: '/app/moveitems', nativeMode: 'multi',
      labels: ['Multi', 'Move Multi']
    },
    'move:container': {
      title: 'Move • Container', path: '/app/moveitems', nativeMode: 'container',
      labels: ['Container', 'Move Container']
    },
    'move:lpn': {
      title: 'Move • LPN', path: '/app/moveitems', nativeMode: 'lpn',
      labels: ['LPN']
    },
    'move:moveapp': {
      title: 'Move • Separate App', externalUrl: MOVE_CONTAINER_URL, nativeMode: '', labels: []
    }
  };

  function isVisible(el) {
    if (!el || el.closest(`#${ROOT_ID}`) || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function findNativeModeControl(labels) {
    const wanted = new Set(labels.map(low));
    const candidates = document.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"]');
    return [...candidates].find(el => {
      if (!isVisible(el)) return false;
      const label = el.matches('input') ? el.value : el.textContent;
      return wanted.has(low(label));
    }) || null;
  }

  function findNativeModeRadio(labels) {
    const wanted = labels.map(low);
    return [...document.querySelectorAll('input[type="radio"][name="options"]')].find(radio => {
      if (!isVisible(radio)) return false;
      const pieces = [radio.value, radio.getAttribute('aria-label')];
      const label = radio.id ? document.querySelector(`label[for="${CSS.escape(radio.id)}"]`) : null;
      if (label) pieces.push(label.textContent);
      const row = radio.closest('label,.a-radio,.a-control-row');
      if (row) pieces.push(row.textContent);
      else if (radio.parentElement) pieces.push(radio.parentElement.textContent);
      const copy = low(pieces.join(' '));
      return wanted.some(value => copy === value || copy.includes(value));
    }) || null;
  }

  function submitNativeMode(radio, definition) {
    if (selectorSubmitted) return;
    selectorSubmitted = true;
    radio.click();
    setStatus(`Selecting ${definition.title}…`);
    setTimeout(() => {
      const form = radio.form || radio.closest('form');
      const submit = form?.querySelector('button[type="submit"],input[type="submit"]');
      if (form?.requestSubmit && submit) form.requestSubmit(submit);
      else if (form?.requestSubmit) form.requestSubmit();
      else if (submit) submit.click();
      else {
        selectorSubmitted = false;
        setStatus(`${definition.title} selected • press Continue`, 'warn');
      }
    }, 120);
  }

  function requestNativeChangeMode(definition) {
    if (changeModeRequested) {
      setStatus(`Press C once to switch to ${definition.title}`, 'warn');
      return;
    }
    changeModeRequested = true;

    const changeControl = [...document.querySelectorAll('button,a,[role="button"]')].find(el =>
      isVisible(el) && /\bchange\s+mode\b/i.test(norm(el.textContent || el.getAttribute('aria-label')))
    );
    if (changeControl) {
      setStatus(`Opening AFT mode selector…`);
      changeControl.click();
      return;
    }

    const init = { key: 'c', code: 'KeyC', keyCode: 67, which: 67, bubbles: true, cancelable: true };
    ['keydown', 'keypress', 'keyup'].forEach(type => document.dispatchEvent(new KeyboardEvent(type, init)));
    setStatus(`Switch requested • if AFT stays here, press C once`, 'warn');
  }

  function clearPending() {
    state.pendingMode = '';
    state.pendingAt = 0;
    saveState();
  }

  function confirmActiveMode(definition) {
    const [area, mode] = modeKeyForDefinition(definition).split(':');
    state.area = area;
    if (area === 'edit') state.editMode = mode;
    else state.moveMode = mode;
    clearPending();
    render();
    setStatus(`${definition.title} active`, 'ok');
  }

  function modeKeyForDefinition(definition) {
    return Object.keys(DEFINITIONS).find(key => DEFINITIONS[key] === definition) || '';
  }

  function attemptNativeMode(definition, attempt = 0) {
    clearTimeout(nativeTimer);

    if (!definition || !currentRouteMatches(definition)) return;
    if (!definition.nativeMode) {
      confirmActiveMode(definition);
      return;
    }

    const current = currentNativeMode();
    if (current === definition.nativeMode) {
      confirmActiveMode(definition);
      return;
    }

    if (current && current !== definition.nativeMode) {
      requestNativeChangeMode(definition);
      if (attempt < 24) nativeTimer = setTimeout(() => attemptNativeMode(definition, attempt + 1), 500);
      return;
    }

    const radio = findNativeModeRadio(definition.labels);
    if (radio) {
      submitNativeMode(radio, definition);
      return;
    }

    const control = findNativeModeControl(definition.labels);
    if (control) {
      setStatus(`Opening ${definition.title}…`);
      control.click();
      return;
    }

    if (attempt < 24) {
      nativeTimer = setTimeout(() => attemptNativeMode(definition, attempt + 1), 250);
      return;
    }

    clearPending();
    setStatus(`${definition.title} page ready • native selector not detected`, 'warn');
  }

  function openSelected() {
    const definition = selectedDefinition();
    const target = routeFor(definition);

    syncStableHelperSettings();

    if (!target) {
      setStatus('Open this test once on any AFT Edit/Move page first', 'warn');
      return;
    }

    state.pendingMode = modeKey();
    state.pendingAt = Date.now();
    saveState();
    render();

    if (currentRouteMatches(definition)) {
      attemptNativeMode(definition);
      return;
    }

    setStatus(`Switching to ${definition.title}…`);
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
    const active = activeModeKey();
    const pending = state.pendingMode;
    return values.map(value => {
      const key = `${area}:${value}`;
      const isActive = key === active;
      const isPending = key === pending && !isActive;
      const label = labelMap[value] || value;
      return `<button type="button" class="aso-choice" data-${area}-mode="${value}" data-active="${isActive ? '1' : '0'}" data-pending="${isPending ? '1' : '0'}" aria-pressed="${isActive ? 'true' : 'false'}">${isActive ? '✓ ' : isPending ? '… ' : ''}${label}</button>`;
    }).join('');
  }

  function adaptiveHtml() {
    const mode = modeKey();
    const active = activeModeKey();

    if (active !== mode) {
      const requested = DEFINITIONS[state.pendingMode];
      return `<div class="aso-note">${requested ? `SWITCHING TO ${requested.title.toUpperCase()}…` : 'Select a mode to switch AFT.'}</div>`;
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
      'edit:date': 'Date rows and per-item expiry options appear after this mode opens.',
      'edit:fcsku': 'OLD FCSKU, NEW FCSKU and locations appear after this mode opens.',
      'move:each': 'Source, destination and item queue appear after this mode opens.',
      'move:container': 'Native MoveItems Container options appear after this mode opens.',
      'move:lpn': 'Native MoveItems LPN options appear after this mode opens.',
      'move:moveapp': 'Separate MoveContainer app: dropzone, floor and container queue.'
    };
    return `<div class="aso-note">${messages[mode] || 'Select a mode.'}</div>`;
  }

  function escapeAttr(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function render() {
    if (!root) return;
    root.dataset.minimized = state.minimized ? '1' : '0';
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
            ? makeModeButtons('edit', ['each', 'sku', 'date', 'fcsku'], { each: 'EACH', sku: 'SKU', date: 'DATE', fcsku: 'FCSKU' })
            : makeModeButtons('move', ['each', 'multi', 'container', 'lpn', 'moveapp'], { each: 'EACH', multi: 'MULTI', container: 'CONTAINER', lpn: 'LPN', moveapp: 'MOVE APP' })}
        </div>
        <div class="aso-adaptive">${adaptiveHtml()}</div>
        <div class="aso-status" data-status>Selection ready</div>
        <div class="aso-safety">TEST controller only • existing helpers perform the work</div>
      </div>`;

    statusEl = root.querySelector('[data-status]');
    wireUi();
    paintCurrentStatus();
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
    openSelected();
  }

  function normalizeRules() {
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

  }

  function paintCurrentStatus() {
    const definition = selectedDefinition();
    if (!definition) return;

    if (!currentRouteMatches(definition)) {
      setStatus(`Current page: ${isMoveContainer() ? 'Move Container' : isAftQt() ? location.pathname.split('/').pop() : 'other AFT'}`);
      return;
    }

    if (!definition.nativeMode) {
      setStatus(`${definition.title} page ready`, 'ok');
      return;
    }

    const current = currentNativeMode();
    if (current === definition.nativeMode) setStatus(`${definition.title} active`, 'ok');
    else if (current) setStatus(`Current native mode: ${current.toUpperCase()}`, 'warn');
    else setStatus(`${definition.title} page ready`);
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
      #${ROOT_ID} .aso-main-tabs button,#${ROOT_ID} .aso-mode-tabs button,#${ROOT_ID} .aso-choice{min-width:0;padding:7px 5px;border:1px solid #91a1a8;border-radius:6px;background:#fff;color:#26343a}#${ROOT_ID} button:disabled{background:#e2e8ea;color:#87949a;border-color:#c4cdd1;cursor:not-allowed}
      #${ROOT_ID} button[data-active="1"]{background:#245e56;color:#fff;border-color:#17463f;box-shadow:inset 0 0 0 1px #fff6}
      #${ROOT_ID} .aso-mode-tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}#${ROOT_ID} .aso-mode-tabs:has([data-move-mode]){grid-template-columns:repeat(5,minmax(0,1fr))}
      #${ROOT_ID} .aso-adaptive{display:grid;gap:7px}#${ROOT_ID} .aso-group{display:grid;gap:5px;padding:7px;border:1px solid #c4d0d4;border-radius:7px;background:#fbfdfe}
      #${ROOT_ID} .aso-label{font-size:11px;font-weight:900;color:#3a4e56}#${ROOT_ID} .aso-grid{display:grid;gap:6px}#${ROOT_ID} .aso-grid-3{grid-template-columns:repeat(3,minmax(0,1fr))}#${ROOT_ID} .aso-grid-2{grid-template-columns:repeat(2,minmax(0,1fr))}
      #${ROOT_ID} .aso-qty-grid{grid-template-columns:72px 72px minmax(0,1fr)}#${ROOT_ID} input{width:100%;min-width:0;padding:7px;border:1px solid #91a1a8;border-radius:6px;background:#fff;color:#1e2b31;font-weight:800;text-align:center}
      #${ROOT_ID} .aso-note{padding:9px;border:1px solid #c4d0d4;border-radius:6px;background:#fff;color:#52636a}
      #${ROOT_ID} button[data-pending="1"]{background:#dce9f5;color:#174f7a;border-color:#4380ad}
      #${ROOT_ID} .aso-status{min-height:28px;padding:6px 8px;border:1px solid #c4d0d4;border-radius:6px;background:#e8f2f5;font-weight:800}#${ROOT_ID} .aso-status[data-kind="ok"]{border-color:#35836f;background:#dcefe8;color:#164d41}#${ROOT_ID} .aso-status[data-kind="warn"]{border-color:#d38a19;background:#fff0cf;color:#5c3a00}
      #${ROOT_ID} .aso-safety{text-align:center;color:#66767c;font-size:10px}
      @media(max-width:560px){#${ROOT_ID}{top:10px}#${ROOT_ID} .aso-grid-3{grid-template-columns:1fr}#${ROOT_ID} .aso-mode-tabs{grid-template-columns:repeat(2,minmax(0,1fr))}}
    `;
    document.documentElement.appendChild(style);
  }

  function start() {
    rememberOrigin();
    normalizeRules();
    saveState();
    syncStableHelperSettings();
    injectStyle();

    const pendingFresh = state.pendingMode && Date.now() - Number(state.pendingAt || 0) <= PENDING_MAX_AGE_MS;
    if (!pendingFresh) {
      const active = activeModeKey();
      if (active) {
        const [area, mode] = active.split(':');
        state.area = area;
        if (area === 'edit') state.editMode = mode;
        else state.moveMode = mode;
      }
    }

    root = document.createElement('section');
    root.id = ROOT_ID;
    document.body.appendChild(root);
    render();

    if (pendingFresh) {
      const definition = DEFINITIONS[state.pendingMode];
      if (definition && currentRouteMatches(definition)) attemptNativeMode(definition);
    } else if (state.pendingMode) {
      clearPending();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
