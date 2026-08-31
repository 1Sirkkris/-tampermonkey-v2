// ==UserScript==
// @name         TEST FCResearch → RIVER Ticket Assistant v0.3.3
// @namespace    https://github.com/1Sirkkris
// @version      0.3.3
// @description  Lightweight event-driven Hazmat/L0 RIVER capture and approved workflow automation.
// @include      /^https?:\/\/(?:[^\/]*fcresearch[^\/]*|qifcr\.fe\.aftx\.amazonoperations\.app)\//
// @match        https://river.amazon.com/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_openInTab
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/FCResearch_RIVER_Ticket_Assistant.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/FCResearch_RIVER_Ticket_Assistant.user.js
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = '0.3.3';
  const KEY = 'bwu2_ticket_assistant_payload_v3';
  const CORE_REQUEST_EVENT = 'fcr-data-core:request';
  const CORE_RESPONSE_EVENT = 'fcr-data-core:response';
  const CORE_CANCEL_EVENT = 'fcr-data-core:cancel';
  const CAPTURE_FIELDS = ['asin', 'fnsku', 'title', 'purchaseOrder', 'inventoryQuantity', 'inventoryCost', 'vendorCode'];
  const DOM_GRACE_MS = 6000;
  const CORE_TIMEOUT_MS = 12000;
  const NAV_TIMEOUT_MS = 12000;
  const DOM_DEBOUNCE_MS = 90;
  const RIVER_WORKFLOW_Q0 = '3654ec14-7232-4f65-84c3-87927cdb4d0c';
  const RIVER_WORKFLOW_ID = 'f2738dec-7f6f-4c2e-a85a-db7228de25f1';
  const RELEVANT_CAPTURE_SELECTOR = '#table-purchase-order-item,#table-inventory';

  const clean = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const norm = value => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const visible = element => !!element && element.isConnected && (() => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  })();

  function emit(type, data = {}) {
    try {
      window.dispatchEvent(new CustomEvent('bwu2-observability:event', {
        detail: JSON.stringify({ type: `river.${type}`, data })
      }));
    } catch {}
  }

  function warehouseId() {
    const match = location.pathname.match(/^\/([^/]+)\/results(?:\/|$)/i);
    const fc = clean(match?.[1] || 'BWU2').toUpperCase();
    return /^[A-Z0-9-]{2,12}$/.test(fc) ? fc : 'BWU2';
  }

  function riverUrl(fc = warehouseId()) {
    const url = new URL(`https://river.amazon.com/${encodeURIComponent(fc)}/workflows`);
    url.searchParams.set('buildingType', 'fc');
    url.searchParams.set('workflowId', 'undefined');
    url.searchParams.set('q0', RIVER_WORKFLOW_Q0);
    url.searchParams.set('q1', RIVER_WORKFLOW_ID);
    url.searchParams.set('id', RIVER_WORKFLOW_ID);
    return url.href;
  }

  function currentSearch() {
    return clean(new URLSearchParams(location.search).get('s') || document.querySelector('#search')?.value || '');
  }

  function parseDocument(html) {
    return new DOMParser().parseFromString(String(html || ''), 'text/html');
  }

  function labelValue(root, labels) {
    const wanted = new Set(labels.map(norm));
    for (const row of root.querySelectorAll('tr')) {
      const cells = [...row.children].filter(cell => cell.matches?.('th,td'));
      if (cells.length < 2 || !wanted.has(norm(cells[0].textContent))) continue;
      return clean(cells[1].querySelector('a')?.textContent || cells[1].textContent);
    }
    return '';
  }

  function formatCost(value) {
    const text = clean(value);
    if (!text) return '';
    if (/^N\/A$/i.test(text)) return 'N/A';
    if (/^AUD\b/i.test(text)) return text;
    const match = text.match(/\d+(?:,\d{3})*(?:\.\d+)?/);
    return match ? `AUD ${match[0].replace(/,/g, '')}` : text;
  }

  function productSnapshot(root = document) {
    const rawAsin = labelValue(root, ['ASIN', 'ISBN']);
    const rawFnsku = labelValue(root, ['FNSKU', 'FNSku']);
    return {
      asin: (rawAsin.match(/\b[A-Z0-9]{10}\b/i) || [])[0]?.toUpperCase() || '',
      fnsku: (rawFnsku.match(/\bX0[A-Z0-9]{8}\b/i) || [])[0]?.toUpperCase() || '',
      title: labelValue(root, ['Title']),
      inventoryCost: formatCost(labelValue(root, ['List Price', 'Price']))
    };
  }

  function tableHeaders(table) {
    const wrapper = table?.closest('.dataTables_wrapper,.dataTables_scroll') || table?.parentElement;
    const headerTable = wrapper?.querySelector('.dataTables_scrollHead table') || table;
    return [...headerTable?.querySelectorAll('thead th,thead td') || []].map(node => norm(node.textContent));
  }

  function columnIndex(headers, ...names) {
    return headers.findIndex(header => names.some(name => header === norm(name) || header.startsWith(`${norm(name)} `)));
  }

  function purchaseOrderSnapshot(root = document) {
    const table = root.querySelector('#table-purchase-order-item');
    if (!table) return { state: 'pending' };

    const headers = tableHeaders(table);
    const poIndex = columnIndex(headers, 'purchase order', 'po');
    const vendorIndex = columnIndex(headers, 'vendor code', 'seller id');
    const dateIndex = columnIndex(headers, 'order date', 'date');
    if (poIndex < 0 || vendorIndex < 0) return { state: 'unavailable', purchaseOrder: 'N/A', vendorCode: 'N/A' };

    const rows = [...table.querySelectorAll('tbody tr')].map((row, rowIndex) => {
      const cells = [...row.children].filter(cell => cell.matches?.('td,th'));
      const purchaseOrder = clean(cells[poIndex]?.textContent);
      const vendorCode = clean(cells[vendorIndex]?.textContent);
      const orderDate = dateIndex >= 0 ? clean(cells[dateIndex]?.textContent) : '';
      const timestamp = Date.parse(orderDate);
      return {
        purchaseOrder,
        vendorCode,
        orderDate,
        timestamp: Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY,
        rowIndex
      };
    }).filter(row => row.purchaseOrder && !/no matching records/i.test(row.purchaseOrder));

    if (!rows.length) return { state: 'unavailable', purchaseOrder: 'N/A', vendorCode: 'N/A' };
    rows.sort((a, b) => b.timestamp - a.timestamp || a.rowIndex - b.rowIndex);
    const latest = rows[0];
    return {
      state: 'available',
      purchaseOrder: latest.purchaseOrder,
      vendorCode: latest.vendorCode || 'N/A',
      orderDate: latest.orderDate
    };
  }

  function inventorySnapshot(root = document) {
    const table = root.querySelector('#table-inventory');
    if (!table) return { state: 'pending' };

    const wrapper = table.closest('.dataTables_wrapper,.dataTables_scroll') || table.parentElement;
    const headers = [
      ...table.querySelectorAll('thead th,thead td'),
      ...(wrapper ? [...wrapper.querySelectorAll('.dataTables_scrollHead th,.dataTables_scrollHead td')] : [])
    ];
    for (const header of headers) {
      const match = clean(header.textContent).match(/^quantity\s*\(([\d,]+)\)/i);
      if (match) return { state: 'available', inventoryQuantity: Number(match[1].replace(/,/g, '')) };
    }

    const names = tableHeaders(table);
    const quantityIndex = columnIndex(names, 'quantity');
    if (quantityIndex < 0) return { state: 'unavailable', inventoryQuantity: null };

    let total = 0;
    let found = false;
    for (const row of table.querySelectorAll('tbody tr')) {
      const cells = [...row.children].filter(cell => cell.matches?.('td,th'));
      const raw = clean(cells[quantityIndex]?.textContent);
      if (!raw || /no matching records/i.test(raw)) continue;
      const value = Number(raw.replace(/[^0-9.-]/g, ''));
      if (!Number.isFinite(value)) continue;
      total += value;
      found = true;
    }
    return { state: 'available', inventoryQuantity: found ? total : 0 };
  }

  const corePending = new Map();
  window.addEventListener(CORE_RESPONSE_EVENT, event => {
    let message;
    try { message = JSON.parse(String(event.detail || '')); } catch { return; }
    const pending = corePending.get(message?.id);
    if (!pending) return;
    corePending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.ok) pending.resolve(message.data);
    else pending.reject(new Error(message.error || 'FCR Data Core request failed'));
  }, true);

  function coreRequest(type, payload = {}) {
    const id = crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        corePending.delete(id);
        reject(new Error(`${type} timed out`));
      }, CORE_TIMEOUT_MS);
      corePending.set(id, { resolve, reject, timer });
      window.dispatchEvent(new CustomEvent(CORE_REQUEST_EVENT, {
        detail: JSON.stringify({ id, type, payload, client: 'river-assistant', group: 'river-capture' })
      }));
    });
  }

  function cancelCoreCapture() {
    try {
      window.dispatchEvent(new CustomEvent(CORE_CANCEL_EVENT, {
        detail: JSON.stringify({ client: 'river-assistant', group: 'river-capture' })
      }));
    } catch {}
  }

  function newCaptureState() {
    return Object.fromEntries(CAPTURE_FIELDS.map(field => [field, { state: 'pending', value: null }]));
  }

  function resolveField(state, field, value, unavailableValue = 'N/A') {
    if (!state[field] || state[field].state !== 'pending') return false;
    const available = field === 'inventoryQuantity'
      ? Number.isFinite(Number(value))
      : clean(value) !== '';
    state[field] = available
      ? { state: 'available', value: field === 'inventoryQuantity' ? Number(value) : clean(value) }
      : { state: 'unavailable', value: unavailableValue };
    return true;
  }

  function resolvedCount(state) {
    return CAPTURE_FIELDS.filter(field => state[field].state !== 'pending').length;
  }

  function fieldStates(state) {
    return Object.fromEntries(CAPTURE_FIELDS.map(field => [field, state[field].state]));
  }

  function unresolvedFields(state) {
    return CAPTURE_FIELDS.filter(field => state[field].state === 'pending');
  }

  function applyProduct(state, root = document) {
    const product = productSnapshot(root);
    resolveField(state, 'asin', product.asin);
    resolveField(state, 'fnsku', product.fnsku);
    resolveField(state, 'title', product.title);
    resolveField(state, 'inventoryCost', product.inventoryCost);
  }

  function applyPurchaseOrder(state, root = document) {
    if (state.purchaseOrder.state !== 'pending' && state.vendorCode.state !== 'pending') return false;
    const po = purchaseOrderSnapshot(root);
    if (po.state === 'pending') return false;
    resolveField(state, 'purchaseOrder', po.purchaseOrder);
    resolveField(state, 'vendorCode', po.vendorCode);
    return true;
  }

  function applyInventory(state, root = document) {
    if (state.inventoryQuantity.state !== 'pending') return false;
    const inventory = inventorySnapshot(root);
    if (inventory.state === 'pending') return false;
    resolveField(state, 'inventoryQuantity', inventory.inventoryQuantity, null);
    return true;
  }

  let activeCapture = null;

  function indicatorFor(badge) {
    let indicator = badge.nextElementSibling;
    if (!indicator?.classList?.contains('bwu2-river-capture-indicator')) {
      indicator = document.createElement('span');
      indicator.className = 'bwu2-river-capture-indicator';
      Object.assign(indicator.style, {
        display: 'inline-flex', alignItems: 'center', marginLeft: '7px', padding: '2px 7px', border: '1px solid #765900', borderRadius: '12px',
        background: '#fff3b0', color: '#111', font: '800 11px/1.35 Arial,sans-serif', whiteSpace: 'nowrap', verticalAlign: 'middle'
      });
      badge.insertAdjacentElement('afterend', indicator);
    }
    return indicator;
  }

  function renderCaptureState(badge, state, ready = false, detail = '') {
    const indicator = indicatorFor(badge);
    if (ready) {
      badge.dataset.riverCaptureState = 'ready';
      badge.style.pointerEvents = 'auto';
      badge.style.cursor = 'pointer';
      badge.setAttribute('role', 'button');
      badge.removeAttribute('aria-disabled');
      badge.tabIndex = 0;
      badge.title = detail || 'RIVER data captured. Click to open RIVER.';
      indicator.textContent = 'RIVER READY ✓';
      indicator.style.background = '#dff6ff';
      indicator.style.borderColor = '#005a78';
      indicator.title = badge.title;
      return;
    }
    badge.dataset.riverCaptureState = 'pending';
    badge.style.pointerEvents = 'none';
    badge.style.cursor = 'wait';
    badge.setAttribute('role', 'status');
    badge.setAttribute('aria-disabled', 'true');
    badge.tabIndex = -1;
    badge.title = detail || 'RIVER capture is resolving FCResearch data.';
    indicator.textContent = `RIVER CAPTURE ${resolvedCount(state)}/${CAPTURE_FIELDS.length}`;
    indicator.title = badge.title;
  }

  function payloadFromState(state, search) {
    return {
      asin: state.asin.value || 'N/A',
      fnsku: state.fnsku.value || 'N/A',
      title: state.title.value || 'N/A',
      purchaseOrder: state.purchaseOrder.value || 'N/A',
      inventoryQuantity: Number.isFinite(Number(state.inventoryQuantity.value)) ? Number(state.inventoryQuantity.value) : null,
      inventoryCost: state.inventoryCost.value || 'N/A',
      vendorCode: state.vendorCode.value || 'N/A',
      shipmentsImpacted: 0,
      physicalLocation: 'TBD',
      fieldStates: fieldStates(state),
      sourceSearch: search,
      sourceUrl: location.href,
      warehouseId: warehouseId(),
      riverUrl: riverUrl(warehouseId()),
      capturedAt: Date.now(),
      assistantVersion: VERSION
    };
  }

  function captureMutationRelevant(records) {
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target?.parentElement;
      if (target?.closest?.(RELEVANT_CAPTURE_SELECTOR)) return true;
      for (const node of record.addedNodes || []) {
        if (!(node instanceof Element)) continue;
        if (node.matches?.(RELEVANT_CAPTURE_SELECTOR) || node.querySelector?.(RELEVANT_CAPTURE_SELECTOR)) return true;
      }
    }
    return false;
  }

  function finishCapture(capture) {
    if (!capture || capture.done) return;
    capture.done = true;
    clearTimeout(capture.fallbackTimer);
    clearTimeout(capture.domTimer);
    capture.observer?.disconnect();
    cancelCoreCapture();

    const payload = payloadFromState(capture.state, capture.search);
    GM_setValue(KEY, payload);
    capture.payload = payload;
    const unavailable = Object.entries(payload.fieldStates).filter(([, value]) => value === 'unavailable').map(([key]) => key);
    const detail = unavailable.length
      ? `RIVER capture complete. Unavailable: ${unavailable.join(', ')}. Click to open RIVER.`
      : 'RIVER capture complete. Click to open RIVER.';
    renderCaptureState(capture.badge, capture.state, true, detail);
    emit('capture.ready', {
      resolved: CAPTURE_FIELDS.length,
      unavailable,
      elapsedMs: Math.round(performance.now() - capture.started),
      domPasses: capture.domPasses,
      fallbackRequests: capture.fallbackRequests
    });
    emit('payload.saved', {
      hasAsin: payload.asin !== 'N/A', hasFnsku: payload.fnsku !== 'N/A', hasPo: payload.purchaseOrder !== 'N/A', hasTitle: payload.title !== 'N/A',
      hasPrice: payload.inventoryCost !== 'N/A', hasVendor: payload.vendorCode !== 'N/A', quantityAvailable: Number.isFinite(payload.inventoryQuantity)
    });
  }

  function refreshCaptureFromDom(capture) {
    if (!capture || capture.done) return;
    capture.domPasses++;
    applyProduct(capture.state);
    applyPurchaseOrder(capture.state);
    applyInventory(capture.state);
    renderCaptureState(capture.badge, capture.state);
    if (!unresolvedFields(capture.state).length) finishCapture(capture);
  }

  async function fallbackCapture(capture) {
    if (!capture || capture.done) return;
    capture.observer?.disconnect();
    refreshCaptureFromDom(capture);
    if (capture.done) return;

    const jobs = [];
    if (capture.state.purchaseOrder.state === 'pending' || capture.state.vendorCode.state === 'pending') {
      capture.fallbackRequests++;
      jobs.push(coreRequest('section', { endpoint: 'purchase-order-item', code: capture.search }).then(result => {
        const snapshot = purchaseOrderSnapshot(parseDocument(result?.html || ''));
        if (snapshot.state === 'available') {
          resolveField(capture.state, 'purchaseOrder', snapshot.purchaseOrder);
          resolveField(capture.state, 'vendorCode', snapshot.vendorCode);
        } else {
          resolveField(capture.state, 'purchaseOrder', null);
          resolveField(capture.state, 'vendorCode', null);
        }
        emit('capture.fallback.result', { section: 'purchase-order-item', ok: true });
      }).catch(error => {
        resolveField(capture.state, 'purchaseOrder', null);
        resolveField(capture.state, 'vendorCode', null);
        emit('capture.fallback.result', { section: 'purchase-order-item', ok: false, error: clean(error?.message || error) });
      }));
    }

    if (capture.state.inventoryQuantity.state === 'pending') {
      capture.fallbackRequests++;
      jobs.push(coreRequest('section', { endpoint: 'inventory', code: capture.search }).then(result => {
        const total = result?.complete !== false && Number.isFinite(Number(result?.totalQuantity)) ? Number(result.totalQuantity) : null;
        resolveField(capture.state, 'inventoryQuantity', total, null);
        emit('capture.fallback.result', { section: 'inventory', ok: Number.isFinite(total) });
      }).catch(error => {
        resolveField(capture.state, 'inventoryQuantity', null, null);
        emit('capture.fallback.result', { section: 'inventory', ok: false, error: clean(error?.message || error) });
      }));
    }

    emit('capture.fallback', { sections: jobs.length, unresolved: unresolvedFields(capture.state) });
    if (jobs.length) await Promise.allSettled(jobs);
    for (const field of unresolvedFields(capture.state)) resolveField(capture.state, field, null, field === 'inventoryQuantity' ? null : 'N/A');
    finishCapture(capture);
  }

  function startCapture(badge) {
    if (!badge?.isConnected) return;
    const search = currentSearch();
    if (!search) return;
    if (activeCapture?.search === search && activeCapture.badge === badge && !activeCapture.done) return;

    const state = newCaptureState();
    const capture = {
      search, badge, state, started: performance.now(), domPasses: 0, fallbackRequests: 0,
      observer: null, domTimer: 0, fallbackTimer: 0, done: false, payload: null
    };
    activeCapture?.observer?.disconnect();
    clearTimeout(activeCapture?.fallbackTimer || 0);
    clearTimeout(activeCapture?.domTimer || 0);
    activeCapture = capture;
    GM_setValue(KEY, null);
    emit('capture.started', { fields: CAPTURE_FIELDS.length });

    refreshCaptureFromDom(capture);
    if (capture.done) return;

    const root = document.querySelector('#results-content') || document.body || document.documentElement;
    capture.observer = new MutationObserver(records => {
      if (!captureMutationRelevant(records) || capture.done || capture.domTimer) return;
      capture.domTimer = setTimeout(() => {
        capture.domTimer = 0;
        refreshCaptureFromDom(capture);
      }, DOM_DEBOUNCE_MS);
    });
    capture.observer.observe(root, { childList: true, subtree: true });
    capture.fallbackTimer = setTimeout(() => void fallbackCapture(capture), DOM_GRACE_MS);
  }

  function attachBadge(badge) {
    if (!badge || badge.dataset.riverAssistantV033 === '1') return;
    badge.dataset.riverAssistantV033 = '1';
    renderCaptureState(badge, newCaptureState());
    startCapture(badge);
  }

  function discoverRiverBadge() {
    const existing = document.querySelector('.fc-hazmat.fc-river-l0');
    if (existing) {
      attachBadge(existing);
      return;
    }

    const root = document.querySelector('#results-content') || document.documentElement;
    if (!root) return;
    const observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes || []) {
          if (!(node instanceof Element)) continue;
          const badge = node.matches?.('.fc-hazmat.fc-river-l0')
            ? node
            : node.querySelector?.('.fc-hazmat.fc-river-l0');
          if (!badge) continue;
          observer.disconnect();
          attachBadge(badge);
          return;
        }
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  }

  function installFcrBridge() {
    const start = () => discoverRiverBadge();
    if (document.documentElement) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });

    const openFromBadge = event => {
      if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
      const badge = event.target instanceof Element ? event.target.closest('.fc-hazmat.fc-river-l0') : null;
      if (!badge) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (badge.dataset.riverCaptureState !== 'ready' || !activeCapture?.payload) {
        emit('open.blocked', { reason: 'capture-not-ready' });
        return;
      }
      const payload = activeCapture.payload;
      GM_setValue(KEY, payload);
      emit('open', {
        unavailable: Object.values(payload.fieldStates || {}).filter(value => value === 'unavailable').length,
        quantityAvailable: Number.isFinite(payload.inventoryQuantity)
      });
      const target = payload.riverUrl || riverUrl(payload.warehouseId);
      const tab = GM_openInTab(target, { active: true, insert: true, setParent: true });
      if (!tab) location.assign(target);
    };

    document.addEventListener('click', openFromBadge, true);
    document.addEventListener('keydown', openFromBadge, true);
    window.addEventListener('pagehide', () => {
      activeCapture?.observer?.disconnect();
      clearTimeout(activeCapture?.fallbackTimer || 0);
      clearTimeout(activeCapture?.domTimer || 0);
      cancelCoreCapture();
    }, { once: true });
  }

  function panel() {
    if (document.getElementById('bwu2-river-assistant')) return document.getElementById('bwu2-river-assistant');
    const element = document.createElement('div');
    element.id = 'bwu2-river-assistant';
    element.innerHTML = `<b>RIVER v${VERSION}</b><span data-id></span><div data-status>READY</div><button data-run>RUN</button><button data-clear>STOP / CLEAR</button>`;
    Object.assign(element.style, {
      position: 'fixed', left: '14px', bottom: '14px', zIndex: 2147483647, width: '300px', padding: '10px', border: '2px solid #475569',
      borderRadius: '8px', background: '#fff', color: '#111', font: '12px Arial', boxShadow: '0 4px 16px #0004'
    });
    const style = document.createElement('style');
    style.textContent = '#bwu2-river-assistant span{float:right;max-width:145px;overflow:hidden;text-overflow:ellipsis}#bwu2-river-assistant [data-status]{clear:both;padding:8px 0;font-weight:700}#bwu2-river-assistant button{width:49%;min-height:30px;font-weight:800;cursor:pointer}';
    document.documentElement.append(style);
    (document.body || document.documentElement).append(element);
    return element;
  }

  function textOf(element) {
    return norm(element?.innerText || element?.textContent || element?.value || element?.getAttribute?.('aria-label') || '');
  }

  function field(aliases) {
    const wanted = aliases.map(norm);
    for (const element of document.querySelectorAll('input,textarea,select')) {
      if (!visible(element)) continue;
      const id = element.id;
      const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
      const context = norm([
        element.name, element.placeholder, element.getAttribute('aria-label'), label?.textContent,
        element.closest('fieldset')?.querySelector('legend')?.textContent,
        element.closest('div')?.querySelector(':scope > label')?.textContent
      ].filter(Boolean).join(' '));
      if (wanted.some(value => context.includes(value))) return element;
    }
    return null;
  }

  function setValue(element, value) {
    if (!element) return false;
    const nextValue = String(value ?? '');
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
    if (setter) setter.call(element, nextValue);
    else element.value = nextValue;
    for (const type of ['input', 'change', 'blur']) element.dispatchEvent(new Event(type, { bubbles: true }));
    return clean(element.value) === clean(nextValue);
  }

  function choiceCandidates() {
    const output = [];
    const seen = new Set();
    const add = (key, element) => {
      if (!key || !element || seen.has(key) || !visible(element)) return;
      seen.add(key);
      output.push(element);
    };
    for (const input of document.querySelectorAll('input[type="radio"]:not([disabled])')) {
      const label = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : input.closest('label');
      add(input, visible(label) ? label : input);
    }
    for (const element of document.querySelectorAll('[role="radio"]:not([aria-disabled="true"])')) {
      if (element.querySelector('input[type="radio"]')) continue;
      add(element, element);
    }
    return output;
  }

  function clickChoiceIndex(index, step) {
    const choices = choiceCandidates();
    const element = choices[index - 1];
    if (!element) throw new Error(`Option ${index} not found (${choices.length} choices visible).`);
    const input = element.matches?.('input[type="radio"]') ? element : element.querySelector?.('input[type="radio"]');
    emit('automation.action', { step, action: 'choice', option: index, choices: choices.length });
    (input || element).click();
  }

  function selectDropdownIndex(index, step) {
    const select = [...document.querySelectorAll('select')].find(visible);
    if (!select) throw new Error('Dropdown not found.');
    const options = [...select.options].filter(option => !option.disabled && !option.hidden);
    const option = options[index - 1];
    if (!option) throw new Error(`Dropdown Option ${index} not found (${options.length} options visible).`);
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    if (setter) setter.call(select, option.value);
    else select.value = option.value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    emit('automation.action', { step, action: 'dropdown', option: index, options: options.length });
    if (select.value !== option.value) throw new Error(`Dropdown Option ${index} did not retain.`);
  }

  function nextButton() {
    return [...document.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"]')]
      .filter(visible)
      .find(candidate => textOf(candidate) === 'next' || textOf(candidate).startsWith('next ')) || null;
  }

  function next(step) {
    const element = nextButton();
    if (!element) throw new Error('Next button not found.');
    emit('automation.action', { step, action: 'next' });
    element.click();
  }

  function pageKind() {
    const route = `${location.pathname} ${location.search} ${location.hash}`.toLowerCase();
    const root = document.querySelector('main,[role="main"],form') || document.body;
    const text = norm(String(root?.innerText || root?.textContent || '').slice(0, 24000));
    if (/create.?issue/.test(route) || text.includes('create issue')) return 'create';
    if (/related.?tt/.test(route) || text.includes('related tt')) return 'related';
    if (/sortab/.test(route) || text.includes('non sortable') || text.includes('non-sortable')) return 'sortability';
    if (/severity/.test(route) || text.includes('units impacted')) return 'severity';
    if (/image/.test(route) || text.includes('image')) return 'images';
    if (/information/.test(route) || text.includes('vendor code') || text.includes('seller id')) return 'information';
    if (/(^|\W)asin(\W|$)/.test(route) || text.includes('type asin here')) return 'asin';
    if (/issue.?at.?fc/.test(route) || text.includes('inbound issue')) return 'issue';
    if (/pandash|dangerous|dg review/.test(route) || text.includes('lacks dg information')) return 'pandash';
    return 'unknown';
  }

  function waitForPageChange(previous) {
    const immediate = pageKind();
    if (immediate !== 'unknown' && immediate !== previous) return Promise.resolve(immediate);

    return new Promise(resolve => {
      let settled = false;
      let debounce = 0;
      const root = document.body || document.documentElement;
      const observer = new MutationObserver(() => {
        if (debounce || settled) return;
        debounce = setTimeout(check, DOM_DEBOUNCE_MS);
      });
      const timeout = setTimeout(() => finish(pageKind()), NAV_TIMEOUT_MS);
      const routeCheck = () => check();

      function cleanup() {
        observer.disconnect();
        clearTimeout(debounce);
        clearTimeout(timeout);
        window.removeEventListener('popstate', routeCheck, true);
        window.removeEventListener('hashchange', routeCheck, true);
      }
      function finish(value) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      }
      function check() {
        clearTimeout(debounce);
        debounce = 0;
        const current = pageKind();
        if (current !== 'unknown' && current !== previous) finish(current);
      }

      observer.observe(root, { childList: true, subtree: true });
      window.addEventListener('popstate', routeCheck, true);
      window.addEventListener('hashchange', routeCheck, true);
    });
  }

  function payloadValue(payload, key, fallback = 'N/A') {
    const value = payload?.[key];
    return value === null || value === undefined || clean(value) === '' ? fallback : value;
  }

  let riverGeneration = 0;
  let riverBusy = false;

  async function advanceAndContinue(ui, step, generation) {
    next(step);
    const nextPage = await waitForPageChange(step);
    if (generation !== riverGeneration) return;
    if (nextPage === 'unknown' || nextPage === step) throw new Error(`RIVER did not advance from ${step}.`);
    await drive(ui, 'Page loaded', generation);
  }

  async function drive(ui, reason = 'RUN', generation = riverGeneration) {
    if (generation !== riverGeneration) return;
    const payload = GM_getValue(KEY, null);
    if (!payload) {
      ui.querySelector('[data-status]').textContent = 'No saved FCResearch payload.';
      return;
    }

    ui.querySelector('[data-id]').textContent = payload.fnsku !== 'N/A' ? payload.fnsku : payload.asin;
    const status = ui.querySelector('[data-status]');
    status.textContent = `${reason} • checking step…`;
    const page = pageKind();
    const stepNumber = { pandash: 1, issue: 2, asin: 3, related: 4, information: 5, sortability: 6, severity: 7, images: 8, create: 9 }[page] || 0;
    emit('step.detected', { step: page, stepNumber });

    if (page === 'pandash') {
      clickChoiceIndex(2, page);
      status.textContent = 'Option 2 selected • advancing…';
      await advanceAndContinue(ui, page, generation);
    } else if (page === 'issue') {
      clickChoiceIndex(1, page);
      status.textContent = 'Option 1 selected • advancing…';
      await advanceAndContinue(ui, page, generation);
    } else if (page === 'asin') {
      const asin = payloadValue(payload, 'asin');
      if (asin === 'N/A') throw new Error('Captured ASIN is unavailable; ASIN step remains manual.');
      if (!setValue(field(['type asin here', 'asin']), asin)) throw new Error('ASIN field not found/retained.');
      emit('automation.action', { step: page, action: 'fill', field: 'asin', available: true });
      status.textContent = 'ASIN entered • advancing…';
      await advanceAndContinue(ui, page, generation);
    } else if (page === 'related') {
      emit('manual.pause', { step: page });
      status.textContent = 'PAUSED • manual review required. Complete this step, then click Next.';
    } else if (page === 'information') {
      const values = [
        [['x00 asin / fnsku', 'x00 asin', 'fnsku', 'asin/fnsku'], payloadValue(payload, 'fnsku')],
        [['asin title', 'product title', 'title'], payloadValue(payload, 'title')],
        [['purchase order', 'po'], payloadValue(payload, 'purchaseOrder')],
        [['vendor code / seller id', 'vendor code', 'seller id'], payloadValue(payload, 'vendorCode')],
        [['inventory cost per unit', 'inventory cost', 'cost per unit'], payloadValue(payload, 'inventoryCost')],
        [['physical location of the units', 'physical location', 'location'], 'TBD']
      ];
      let filled = 0;
      for (const [aliases, value] of values) if (setValue(field(aliases), value)) filled++;
      emit('automation.action', { step: page, action: 'fill-information', filled, expected: values.length });
      if (filled !== values.length) throw new Error(`Information W1 filled ${filled}/${values.length}; not advancing.`);
      status.textContent = 'Information W1 filled • advancing…';
      await advanceAndContinue(ui, page, generation);
    } else if (page === 'sortability') {
      clickChoiceIndex(1, page);
      status.textContent = 'Option 1 selected • advancing…';
      await advanceAndContinue(ui, page, generation);
    } else if (page === 'severity') {
      if (!Number.isFinite(Number(payload.inventoryQuantity))) throw new Error('Captured quantity is unavailable; quantity step remains manual.');
      const units = field(['units impacted', 'number of units impacted']);
      const shipments = field(['shipments impacted', 'number of shipments impacted']);
      if (!setValue(units, Number(payload.inventoryQuantity)) || !setValue(shipments, 0)) throw new Error('Quantity fields not found/retained.');
      emit('automation.action', { step: page, action: 'fill-severity', quantityAvailable: true, shipments: 0 });
      status.textContent = 'Quantity + shipments filled • advancing…';
      await advanceAndContinue(ui, page, generation);
    } else if (page === 'images') {
      selectDropdownIndex(2, page);
      status.textContent = 'Dropdown Option 2 selected • advancing…';
      await advanceAndContinue(ui, page, generation);
    } else if (page === 'create') {
      emit('done', { finalSubmissionManual: true });
      status.textContent = 'DONE • final Create Issue submission remains manual.';
    } else {
      throw new Error('RIVER step not recognised.');
    }
  }

  function installRiver() {
    const start = () => {
      const ui = panel();
      const run = async reason => {
        if (riverBusy) return;
        riverBusy = true;
        const generation = riverGeneration;
        try {
          await drive(ui, reason, generation);
        } catch (error) {
          if (generation === riverGeneration) {
            ui.querySelector('[data-status]').textContent = `WAITING • ${clean(error?.message || error)}`;
            emit('error', { message: clean(error?.message || error), step: pageKind() });
          }
        } finally {
          riverBusy = false;
        }
      };

      ui.querySelector('[data-run]').onclick = () => void run('Manual RUN');
      ui.querySelector('[data-clear]').onclick = () => {
        riverGeneration++;
        GM_setValue(KEY, null);
        ui.querySelector('[data-id]').textContent = '';
        ui.querySelector('[data-status]').textContent = 'STOPPED / CLEARED';
      };

      document.addEventListener('click', event => {
        if (!event.isTrusted || pageKind() !== 'related') return;
        const button = event.target instanceof Element
          ? event.target.closest('button,a,[role="button"],input[type="button"],input[type="submit"]')
          : null;
        if (!button || button.closest('#bwu2-river-assistant') || button !== nextButton()) return;
        const generation = riverGeneration;
        void waitForPageChange('related').then(nextPage => {
          if (generation !== riverGeneration || nextPage === 'unknown' || nextPage === 'related') return;
          void run('Manual step completed');
        });
      }, true);

      if (GM_getValue(KEY, null)) void run('Page loaded');
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }

  if (location.hostname === 'river.amazon.com') installRiver();
  else installFcrBridge();
})();
