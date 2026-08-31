// ==UserScript==
// @name         TEST FCResearch → RIVER Ticket Assistant v0.3.6
// @namespace    https://github.com/1Sirkkris
// @version      0.3.6
// @description  Event-driven Hazmat/L0 RIVER capture plus bounded step recognition/tracing; no inventory-wide quantity hunt.
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

  if (window.__bwu2RiverAssistantV036) return;
  window.__bwu2RiverAssistantV036 = true;

  const VERSION = '0.3.6';
  const KEY = 'bwu2_ticket_assistant_payload_v3';
  const CORE_REQUEST_EVENT = 'fcr-data-core:request';
  const CORE_RESPONSE_EVENT = 'fcr-data-core:response';
  const CORE_CANCEL_EVENT = 'fcr-data-core:cancel';
  const CAPTURE_FIELDS = ['asin', 'fnsku', 'title', 'purchaseOrder', 'quantity', 'inventoryCost', 'vendorCode'];
  const DOM_GRACE_MS = 6000;
  const CORE_TIMEOUT_MS = 12000;
  const NAV_TIMEOUT_MS = 12000;
  const DOM_DEBOUNCE_MS = 150;
  const RIVER_WORKFLOW_Q0 = '3654ec14-7232-4f65-84c3-87927cdb4d0c';
  const RIVER_WORKFLOW_ID = 'f2738dec-7f6f-4c2e-a85a-db7228de25f1';
  const RELEVANT_CAPTURE_SELECTOR = '#table-purchase-order-item,#table-purchase-order';

  const clean = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const norm = value => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const code = value => clean(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
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

  function productSnapshot(root = document, search = currentSearch()) {
    const rawAsin = labelValue(root, ['ASIN', 'ISBN']);
    const rawFnsku = labelValue(root, ['FNSKU', 'FNSku']);
    const searchCode = code(search);
    const asin = (rawAsin.match(/\b[A-Z0-9]{10}\b/i) || [])[0]?.toUpperCase()
      || (/^[A-Z0-9]{10}$/.test(searchCode) && !searchCode.startsWith('X0') ? searchCode : '');
    const fnsku = (rawFnsku.match(/\bX0[A-Z0-9]{8}\b/i) || [])[0]?.toUpperCase()
      || (/^X0[A-Z0-9]{8}$/.test(searchCode) ? searchCode : '');
    return {
      asin,
      fnsku,
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

  function parseFcrDate(value) {
    const text = clean(value);
    if (!text) return Number.NEGATIVE_INFINITY;

    const iso = text.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (iso) {
      const [, y, m, d, hh = '0', mm = '0', ss = '0'] = iso;
      const timestamp = Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
      return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
    }

    const dmy = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (dmy) {
      const [, d, m, y, hh = '0', mm = '0', ss = '0'] = dmy;
      const timestamp = Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
      return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
    }

    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
  }

  function numericCell(value) {
    const text = clean(value).replace(/,/g, '');
    if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;
    const number = Number(text);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function shortVendorCode(value) {
    const text = clean(value);
    if (!text) return '';
    const tokens = (text.match(/[A-Z0-9]+/gi) || []).map(token => token.toUpperCase());
    const preferred = tokens.find(token => token.length >= 2 && token.length <= 5 && token !== 'FBA');
    if (preferred) return preferred;
    const six = tokens.find(token => token.length === 6 && token !== 'FBA');
    return six || '';
  }

  function purchaseOrderDetails(root = document) {
    const table = root.querySelector('#table-purchase-order');
    if (!table) return new Map();
    const headers = tableHeaders(table);
    const poIndex = columnIndex(headers, 'purchase order', 'po');
    const placedIndex = columnIndex(headers, 'placed', 'confirmed', 'order date', 'date');
    if (poIndex < 0) return new Map();

    const details = new Map();
    for (const [rowIndex, row] of [...table.querySelectorAll('tbody tr')].entries()) {
      const cells = [...row.children].filter(cell => cell.matches?.('td,th'));
      const purchaseOrder = clean(cells[poIndex]?.textContent);
      if (!purchaseOrder || /no matching records/i.test(purchaseOrder)) continue;
      const placed = placedIndex >= 0 ? clean(cells[placedIndex]?.textContent) : '';
      const timestamp = parseFcrDate(placed);
      const previous = details.get(code(purchaseOrder));
      if (!previous || timestamp > previous.timestamp) {
        details.set(code(purchaseOrder), { purchaseOrder, placed, timestamp, rowIndex });
      }
    }
    return details;
  }

  function purchaseOrderItemRows(root = document) {
    const table = root.querySelector('#table-purchase-order-item');
    if (!table) return { state: 'pending', rows: [] };

    const headers = tableHeaders(table);
    const indexes = {
      po: columnIndex(headers, 'purchase order', 'po'),
      sku: columnIndex(headers, 'sku', 'fnsku', 'asin'),
      vendor: columnIndex(headers, 'vendor code', 'seller id'),
      unfilled: columnIndex(headers, 'unfilled'),
      cancelled: columnIndex(headers, 'canceled', 'cancelled'),
      received: columnIndex(headers, 'received'),
      title: columnIndex(headers, 'title'),
      date: columnIndex(headers, 'order date', 'placed', 'date')
    };
    if (indexes.po < 0 || indexes.sku < 0) return { state: 'invalid', rows: [] };

    const rows = [];
    for (const [rowIndex, row] of [...table.querySelectorAll('tbody tr')].entries()) {
      const cells = [...row.children].filter(cell => cell.matches?.('td,th'));
      const purchaseOrder = clean(cells[indexes.po]?.textContent);
      if (!purchaseOrder || /no matching records/i.test(purchaseOrder)) continue;
      rows.push({
        purchaseOrder,
        sku: clean(cells[indexes.sku]?.textContent),
        vendorRaw: indexes.vendor >= 0 ? clean(cells[indexes.vendor]?.textContent) : '',
        unfilled: indexes.unfilled >= 0 ? numericCell(cells[indexes.unfilled]?.textContent) : null,
        cancelled: indexes.cancelled >= 0 ? numericCell(cells[indexes.cancelled]?.textContent) : null,
        received: indexes.received >= 0 ? numericCell(cells[indexes.received]?.textContent) : null,
        title: indexes.title >= 0 ? clean(cells[indexes.title]?.textContent) : '',
        orderDate: indexes.date >= 0 ? clean(cells[indexes.date]?.textContent) : '',
        timestamp: indexes.date >= 0 ? parseFcrDate(cells[indexes.date]?.textContent) : Number.NEGATIVE_INFINITY,
        rowIndex,
        rowText: clean(row.textContent)
      });
    }
    return { state: rows.length ? 'available' : 'empty', rows };
  }

  function rowMatchStrength(row, identity) {
    const wanted = [identity.search, identity.asin, identity.fnsku].map(code).filter(Boolean);
    const sku = code(row.sku);
    if (sku && wanted.includes(sku)) return { matched: true, by: sku === code(identity.fnsku) ? 'fnsku' : sku === code(identity.asin) ? 'asin' : 'search', strength: 3 };

    const rowText = code(row.rowText);
    const embedded = wanted.find(value => value.length >= 8 && rowText.includes(value));
    if (embedded) return { matched: true, by: embedded === code(identity.fnsku) ? 'fnsku-row' : embedded === code(identity.asin) ? 'asin-row' : 'search-row', strength: 2 };

    if (identity.title && row.title && norm(row.title) === norm(identity.title)) return { matched: true, by: 'title-exact', strength: 1 };
    return { matched: false, by: '', strength: 0 };
  }

  function selectLatestPoLine(itemRoot, detailRoot, identity) {
    const parsed = purchaseOrderItemRows(itemRoot);
    if (parsed.state === 'pending') return { state: 'pending', reason: 'po-items-not-loaded' };
    if (parsed.state !== 'available') return { state: 'unavailable', reason: 'po-items-empty' };

    const details = purchaseOrderDetails(detailRoot);
    const candidates = [];
    for (const row of parsed.rows) {
      const match = rowMatchStrength(row, identity);
      if (!match.matched) continue;
      const detail = details.get(code(row.purchaseOrder));
      const rowTimestamp = row.timestamp;
      const detailTimestamp = detail?.timestamp ?? Number.NEGATIVE_INFINITY;
      const timestamp = Math.max(rowTimestamp, detailTimestamp);
      const dateSource = rowTimestamp >= detailTimestamp && Number.isFinite(rowTimestamp) ? 'po-item-order-date'
        : Number.isFinite(detailTimestamp) ? 'po-placed-date' : 'none';
      candidates.push({ ...row, ...match, timestamp, dateSource });
    }

    if (!candidates.length) return { state: 'unavailable', reason: 'no-matching-item-line' };

    const dated = candidates.filter(candidate => Number.isFinite(candidate.timestamp) && candidate.timestamp !== Number.NEGATIVE_INFINITY);
    if (!dated.length && candidates.length > 1) {
      return { state: 'needs-po-dates', reason: 'multiple-matching-lines-without-date', candidates: candidates.length };
    }

    const pool = dated.length ? dated : candidates;
    pool.sort((a, b) => b.timestamp - a.timestamp || b.strength - a.strength || a.rowIndex - b.rowIndex);
    const selected = pool[0];
    const vendorCode = shortVendorCode(selected.vendorRaw);
    const quantityParts = [selected.unfilled, selected.cancelled, selected.received];
    const quantityKnown = quantityParts.every(Number.isFinite);
    const quantityTotal = quantityKnown ? quantityParts.reduce((sum, value) => sum + value, 0) : null;

    return {
      state: 'available',
      purchaseOrder: selected.purchaseOrder,
      vendorCode: vendorCode || 'N/A',
      quantity: quantityKnown && quantityTotal > 0 ? quantityTotal : null,
      quantityMode: quantityKnown && quantityTotal > 0 ? 'po-line-total' : quantityKnown ? 'manual-zero-total' : 'manual-missing-components',
      unfilled: selected.unfilled,
      cancelled: selected.cancelled,
      received: selected.received,
      matchBy: selected.by,
      dateSource: selected.dateSource,
      candidateCount: candidates.length,
      vendorShort: !!vendorCode
    };
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
      const started = performance.now();
      const timer = setTimeout(() => {
        corePending.delete(id);
        reject(new Error(`${type} timed out`));
      }, CORE_TIMEOUT_MS);
      corePending.set(id, {
        timer,
        resolve: data => {
          emit('capture.fallback.response', { endpoint: clean(payload.endpoint || type), ms: Math.round(performance.now() - started), ok: true });
          resolve(data);
        },
        reject: error => {
          emit('capture.fallback.response', { endpoint: clean(payload.endpoint || type), ms: Math.round(performance.now() - started), ok: false });
          reject(error);
        }
      });
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
    const numeric = field === 'quantity';
    const available = numeric ? Number.isFinite(Number(value)) && Number(value) > 0 : clean(value) !== '';
    state[field] = available
      ? { state: 'available', value: numeric ? Number(value) : clean(value) }
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

  function applyProduct(capture, root = document) {
    const product = productSnapshot(root, capture.search);
    resolveField(capture.state, 'asin', product.asin);
    resolveField(capture.state, 'fnsku', product.fnsku);
    resolveField(capture.state, 'title', product.title);
    resolveField(capture.state, 'inventoryCost', product.inventoryCost);
    capture.identity = {
      search: capture.search,
      asin: capture.state.asin.state === 'available' ? capture.state.asin.value : product.asin,
      fnsku: capture.state.fnsku.state === 'available' ? capture.state.fnsku.value : product.fnsku,
      title: capture.state.title.state === 'available' ? capture.state.title.value : product.title
    };
  }

  function applyPoSelection(capture, itemRoot = document, detailRoot = document) {
    if (capture.state.purchaseOrder.state !== 'pending' && capture.state.vendorCode.state !== 'pending' && capture.state.quantity.state !== 'pending') return true;
    const selected = selectLatestPoLine(itemRoot, detailRoot, capture.identity || {});
    capture.lastPoSelection = selected;
    if (selected.state !== 'available') return false;

    resolveField(capture.state, 'purchaseOrder', selected.purchaseOrder);
    resolveField(capture.state, 'vendorCode', selected.vendorCode);
    resolveField(capture.state, 'quantity', selected.quantity, null);
    capture.quantityMode = selected.quantityMode;
    emit('capture.po.selected', {
      matchBy: selected.matchBy,
      dateSource: selected.dateSource,
      candidateCount: selected.candidateCount,
      vendorShort: selected.vendorShort,
      quantityMode: selected.quantityMode,
      quantityTotal: selected.quantity,
      componentsKnown: [selected.unfilled, selected.cancelled, selected.received].every(Number.isFinite)
    });
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

  function payloadFromState(capture) {
    const { state, search } = capture;
    return {
      asin: state.asin.value || 'N/A',
      fnsku: state.fnsku.value || 'N/A',
      title: state.title.value || 'N/A',
      purchaseOrder: state.purchaseOrder.value || 'N/A',
      inventoryQuantity: state.quantity.state === 'available' ? Number(state.quantity.value) : null,
      inventoryCost: state.inventoryCost.value || 'N/A',
      vendorCode: state.vendorCode.value || 'N/A',
      shipmentsImpacted: 0,
      physicalLocation: 'TBD',
      quantityMode: capture.quantityMode || 'manual-unavailable',
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

    const payload = payloadFromState(capture);
    GM_setValue(KEY, payload);
    capture.payload = payload;
    const unavailable = Object.entries(payload.fieldStates).filter(([, value]) => value === 'unavailable').map(([key]) => key);
    const detail = unavailable.length
      ? `RIVER capture complete. Unavailable/manual: ${unavailable.join(', ')}. Click to open RIVER.`
      : 'RIVER capture complete. Click to open RIVER.';
    renderCaptureState(capture.badge, capture.state, true, detail);
    emit('capture.ready', {
      resolved: CAPTURE_FIELDS.length,
      unavailable,
      elapsedMs: Math.round(performance.now() - capture.started),
      domPasses: capture.domPasses,
      fallbackRequests: capture.fallbackRequests,
      quantityMode: payload.quantityMode
    });
    emit('payload.saved', {
      hasAsin: payload.asin !== 'N/A', hasFnsku: payload.fnsku !== 'N/A', hasPo: payload.purchaseOrder !== 'N/A', hasTitle: payload.title !== 'N/A',
      hasPrice: payload.inventoryCost !== 'N/A', hasVendor: payload.vendorCode !== 'N/A', quantityAvailable: Number.isFinite(payload.inventoryQuantity)
    });
  }

  function refreshCaptureFromDom(capture) {
    if (!capture || capture.done) return;
    capture.domPasses++;
    applyProduct(capture);
    applyPoSelection(capture);
    renderCaptureState(capture.badge, capture.state);
    if (!unresolvedFields(capture.state).length) finishCapture(capture);
  }

  async function fetchSectionOnce(capture, endpoint) {
    if (capture.requestedSections.has(endpoint)) return null;
    capture.requestedSections.add(endpoint);
    capture.fallbackRequests++;
    emit('capture.fallback.request', { endpoint });
    try {
      return await coreRequest('section', { endpoint, code: capture.search });
    } catch (error) {
      emit('capture.fallback.error', { endpoint, error: clean(error?.message || error) });
      return null;
    }
  }

  async function fallbackCapture(capture) {
    if (!capture || capture.done || capture.fallbackStarted) return;
    capture.fallbackStarted = true;
    capture.observer?.disconnect();
    refreshCaptureFromDom(capture);
    if (capture.done) return;

    let itemRoot = document;
    let detailRoot = document;
    const needsPo = ['purchaseOrder', 'vendorCode', 'quantity'].some(field => capture.state[field].state === 'pending');

    if (needsPo) {
      const itemResult = await fetchSectionOnce(capture, 'purchase-order-item');
      if (capture.done) return;
      if (itemResult?.html) itemRoot = parseDocument(itemResult.html);
      applyPoSelection(capture, itemRoot, detailRoot);
    }

    if (['purchaseOrder', 'vendorCode', 'quantity'].some(field => capture.state[field].state === 'pending')
      && capture.lastPoSelection?.state === 'needs-po-dates') {
      const poResult = await fetchSectionOnce(capture, 'purchase-order');
      if (capture.done) return;
      if (poResult?.html) detailRoot = parseDocument(poResult.html);
      applyPoSelection(capture, itemRoot, detailRoot);
    }

    for (const field of unresolvedFields(capture.state)) {
      resolveField(capture.state, field, null, field === 'quantity' ? null : 'N/A');
    }
    finishCapture(capture);
  }

  function startCapture(badge) {
    if (!badge?.isConnected) return;
    const search = currentSearch();
    if (!search) return;
    if (activeCapture?.search === search && activeCapture.badge === badge && !activeCapture.done) return;

    const state = newCaptureState();
    const capture = {
      search,
      badge,
      state,
      identity: { search, asin: '', fnsku: '', title: '' },
      started: performance.now(),
      domPasses: 0,
      fallbackRequests: 0,
      fallbackStarted: false,
      requestedSections: new Set(),
      observer: null,
      domTimer: 0,
      fallbackTimer: 0,
      done: false,
      payload: null,
      lastPoSelection: null,
      quantityMode: ''
    };
    activeCapture?.observer?.disconnect();
    clearTimeout(activeCapture?.fallbackTimer || 0);
    clearTimeout(activeCapture?.domTimer || 0);
    cancelCoreCapture();
    activeCapture = capture;
    GM_setValue(KEY, null);
    emit('capture.started', { fields: CAPTURE_FIELDS.length, quantitySource: 'latest-po-matching-line' });

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
    if (!badge || badge.dataset.riverAssistantV036 === '1') return;
    badge.dataset.riverAssistantV036 = '1';
    renderCaptureState(badge, newCaptureState());
    emit('capture.badge.attached', { source: clean(badge.textContent) || 'hazmat' });
    startCapture(badge);
  }

  function riverBadgeFromNode(node) {
    if (!(node instanceof Element)) return null;
    if (node.matches?.('.fc-hazmat.fc-river-l0')) return node;
    return node.querySelector?.('.fc-hazmat.fc-river-l0') || null;
  }

  function discoverRiverBadge() {
    const attachExisting = () => {
      const badge = document.querySelector('.fc-hazmat.fc-river-l0');
      if (badge) attachBadge(badge);
    };
    attachExisting();

    const root = document.querySelector('#results-content') || document.documentElement;
    if (!root) return;
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'attributes') {
          const badge = riverBadgeFromNode(record.target);
          if (badge) attachBadge(badge);
          continue;
        }
        for (const node of record.addedNodes || []) {
          const badge = riverBadgeFromNode(node);
          if (badge) attachBadge(badge);
        }
      }
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
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
        quantityAvailable: Number.isFinite(payload.inventoryQuantity),
        quantityMode: payload.quantityMode
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

  function associatedLabel(element) {
    if (!(element instanceof Element)) return '';
    const explicit = clean(element.getAttribute('aria-label') || element.getAttribute('title') || '');
    if (explicit) return explicit;
    if (element.id) {
      try {
        const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
        if (label) return clean(label.textContent);
      } catch {}
    }
    const wrapping = element.closest('label');
    if (wrapping) return clean(wrapping.textContent);
    const fieldset = element.closest('fieldset');
    if (fieldset) return clean(fieldset.querySelector('legend')?.textContent || '');
    return '';
  }

  function field(aliases) {
    const wanted = aliases.map(norm);
    for (const element of document.querySelectorAll('input,textarea,select')) {
      if (!visible(element)) continue;
      const context = norm([
        element.name,
        element.id,
        element.placeholder,
        element.getAttribute('aria-label'),
        associatedLabel(element)
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

  function controlSnapshot(element) {
    const tag = element.tagName?.toLowerCase() || '';
    const type = clean(element.getAttribute?.('type') || '');
    const item = {
      tag,
      type,
      id: clean(element.id || ''),
      name: clean(element.getAttribute?.('name') || ''),
      role: clean(element.getAttribute?.('role') || ''),
      label: associatedLabel(element),
      placeholder: clean(element.getAttribute?.('placeholder') || '')
    };
    if (tag === 'select') {
      item.options = [...element.options].slice(0, 12).map(option => ({
        text: clean(option.textContent),
        value: clean(option.value),
        disabled: !!option.disabled
      }));
    }
    return item;
  }

  function riverDomSnapshot() {
    const root = document.querySelector('main,[role="main"],form') || document.body || document.documentElement;
    const headings = root
      ? [...root.querySelectorAll('h1,h2,h3,h4,[role="heading"],legend')].filter(visible).slice(0, 16).map(node => clean(node.textContent)).filter(Boolean)
      : [];
    const controls = root
      ? [...root.querySelectorAll('input:not([type="password"]):not([type="file"]),textarea,select,button,[role="button"],[role="radio"],[role="option"]')]
        .filter(visible).slice(0, 40).map(controlSnapshot)
      : [];
    const stateAttrs = [];
    if (root) {
      for (const element of [root, ...root.querySelectorAll('[data-step],[data-step-id],[data-question],[data-question-id],[data-workflow],[data-workflow-id],[data-state],[data-screen]')].slice(0, 24)]) {
        const attrs = {};
        for (const attr of element.attributes || []) {
          if (/^(?:data-)?(?:workflow|step|question|option|state|screen)(?:-|$)/i.test(attr.name)) attrs[attr.name] = clean(attr.value);
        }
        if (Object.keys(attrs).length) stateAttrs.push({ tag: element.tagName?.toLowerCase() || '', id: clean(element.id || ''), attrs });
      }
    }
    return {
      route: `${location.pathname}${location.search}${location.hash}`,
      title: clean(document.title),
      headings,
      controls,
      stateAttrs,
      formCount: document.forms?.length || 0,
      nextVisible: !!nextButton()
    };
  }

  function recognitionText(snapshot = riverDomSnapshot()) {
    const parts = [...snapshot.headings];
    for (const control of snapshot.controls) {
      parts.push(control.label, control.name, control.id, control.placeholder, control.role);
      for (const option of control.options || []) parts.push(option.text, option.value);
    }
    return norm(parts.filter(Boolean).join(' ')).slice(0, 7000);
  }

  function pageKind(snapshot = null) {
    const route = `${location.pathname} ${location.search} ${location.hash}`.toLowerCase();
    if (/create.?issue/.test(route)) return 'create';
    if (/related.?tt/.test(route)) return 'related';
    if (/sortab/.test(route)) return 'sortability';
    if (/severity/.test(route)) return 'severity';
    if (/image/.test(route)) return 'images';
    if (/information/.test(route)) return 'information';
    if (/(^|\W)asin(\W|$)/.test(route)) return 'asin';
    if (/issue.?at.?fc/.test(route)) return 'issue';
    if (/pandash|dangerous|dg review/.test(route)) return 'pandash';

    const state = snapshot || riverDomSnapshot();
    const text = recognitionText(state);
    if (text.includes('create issue')) return 'create';
    if (text.includes('related tt') || text.includes('related ticket')) return 'related';
    if (text.includes('units impacted') || text.includes('shipments impacted')) return 'severity';
    if (text.includes('physical location of the units') || text.includes('inventory cost per unit') || text.includes('vendor code seller id')) return 'information';
    if (text.includes('type asin here') || state.controls.some(control => norm(`${control.label} ${control.name} ${control.placeholder}`) === 'asin')) return 'asin';
    if (text.includes('non sortable') || text.includes('non-sortable')) return 'sortability';
    if (text.includes('lacks dg information') || text.includes('dangerous goods')) return 'pandash';
    if (text.includes('fc inbound issue') || text.includes('inbound issue')) return 'issue';
    if (state.controls.some(control => control.tag === 'select' && (control.options || []).length >= 2) && /image/.test(text)) return 'images';
    return 'unknown';
  }

  function waitForPageChange(previous) {
    const immediate = pageKind();
    if (immediate !== 'unknown' && immediate !== previous) return Promise.resolve(immediate);

    return new Promise(resolve => {
      let settled = false;
      let debounce = 0;
      const root = document.querySelector('main,[role="main"],form') || document.body || document.documentElement;
      if (!root) return resolve('unknown');
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

      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['id', 'name', 'role', 'aria-label', 'data-step', 'data-step-id', 'data-question', 'data-question-id', 'data-workflow', 'data-workflow-id', 'data-state', 'data-screen']
      });
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
  let unknownObserver = null;
  let unknownTimer = 0;
  let unknownDebounce = 0;

  function clearUnknownRecognition() {
    unknownObserver?.disconnect();
    unknownObserver = null;
    clearTimeout(unknownTimer);
    clearTimeout(unknownDebounce);
    unknownTimer = 0;
    unknownDebounce = 0;
  }

  async function advanceAndContinue(ui, step, generation) {
    next(step);
    const nextPage = await waitForPageChange(step);
    if (generation !== riverGeneration) return null;
    if (nextPage === 'unknown' || nextPage === step) {
      const snapshot = riverDomSnapshot();
      emit('transition.unresolved', { from: step, detected: nextPage, snapshot });
      ui.querySelector('[data-status]').textContent = 'WAITING • transition not identified yet; tracing active.';
      return { waitForRecognition: true };
    }
    return drive(ui, 'Page loaded', generation);
  }

  async function drive(ui, reason = 'RUN', generation = riverGeneration) {
    if (generation !== riverGeneration) return null;
    const payload = GM_getValue(KEY, null);
    if (!payload) {
      ui.querySelector('[data-status]').textContent = 'No saved FCResearch payload.';
      return null;
    }

    ui.querySelector('[data-id]').textContent = payload.fnsku !== 'N/A' ? payload.fnsku : payload.asin;
    const status = ui.querySelector('[data-status]');
    status.textContent = `${reason} • checking step…`;
    const snapshot = riverDomSnapshot();
    const page = pageKind(snapshot);
    const stepNumber = { pandash: 1, issue: 2, asin: 3, related: 4, information: 5, sortability: 6, severity: 7, images: 8, create: 9 }[page] || 0;
    emit('step.detected', { step: page, stepNumber });

    if (page === 'pandash') {
      clickChoiceIndex(2, page);
      status.textContent = 'Option 2 selected • advancing…';
      return advanceAndContinue(ui, page, generation);
    }
    if (page === 'issue') {
      clickChoiceIndex(1, page);
      status.textContent = 'Option 1 selected • advancing…';
      return advanceAndContinue(ui, page, generation);
    }
    if (page === 'asin') {
      const asin = payloadValue(payload, 'asin');
      if (asin === 'N/A') throw new Error('Captured ASIN is unavailable; ASIN step remains manual.');
      if (!setValue(field(['type asin here', 'asin']), asin)) throw new Error('ASIN field not found/retained.');
      emit('automation.action', { step: page, action: 'fill', field: 'asin', available: true });
      status.textContent = 'ASIN entered • advancing…';
      return advanceAndContinue(ui, page, generation);
    }
    if (page === 'related') {
      emit('manual.pause', { step: page });
      status.textContent = 'PAUSED • manual review required. Complete this step, then click Next.';
      return null;
    }
    if (page === 'information') {
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
      return advanceAndContinue(ui, page, generation);
    }
    if (page === 'sortability') {
      clickChoiceIndex(1, page);
      status.textContent = 'Option 1 selected • advancing…';
      return advanceAndContinue(ui, page, generation);
    }
    if (page === 'severity') {
      const shipments = field(['shipments impacted', 'number of shipments impacted']);
      if (!Number.isFinite(Number(payload.inventoryQuantity)) || Number(payload.inventoryQuantity) <= 0) {
        if (shipments) setValue(shipments, 0);
        emit('manual.pause', { step: page, reason: payload.quantityMode || 'quantity-unavailable' });
        status.textContent = 'PAUSED • PO quantity is unavailable/0. Enter Units impacted manually, then click Next.';
        return null;
      }
      const units = field(['units impacted', 'number of units impacted']);
      if (!setValue(units, Number(payload.inventoryQuantity)) || !setValue(shipments, 0)) throw new Error('Quantity fields not found/retained.');
      emit('automation.action', { step: page, action: 'fill-severity', quantityAvailable: true, shipments: 0, source: 'latest-po-matching-line' });
      status.textContent = 'PO-line quantity + shipments filled • advancing…';
      return advanceAndContinue(ui, page, generation);
    }
    if (page === 'images') {
      selectDropdownIndex(2, page);
      status.textContent = 'Dropdown Option 2 selected • advancing…';
      return advanceAndContinue(ui, page, generation);
    }
    if (page === 'create') {
      emit('done', { finalSubmissionManual: true });
      status.textContent = 'DONE • final Create Issue submission remains manual.';
      return null;
    }

    emit('step.unknown', { snapshot });
    status.textContent = 'WAITING • RIVER step not recognised yet; tracing active.';
    return { waitForRecognition: true };
  }

  function installRiver() {
    const start = () => {
      const ui = panel();

      const armUnknownRecognition = generation => {
        if (generation !== riverGeneration || unknownObserver) return;
        const root = document.querySelector('main,[role="main"],form') || document.body || document.documentElement;
        if (!root) return;

        const check = () => {
          clearTimeout(unknownDebounce);
          unknownDebounce = 0;
          if (generation !== riverGeneration) {
            clearUnknownRecognition();
            return;
          }
          const snapshot = riverDomSnapshot();
          const detected = pageKind(snapshot);
          if (detected === 'unknown') return;
          clearUnknownRecognition();
          emit('step.recognised.after-wait', { step: detected });
          void run('Step became available');
        };

        unknownObserver = new MutationObserver(() => {
          if (unknownDebounce) return;
          unknownDebounce = setTimeout(check, DOM_DEBOUNCE_MS);
        });
        unknownObserver.observe(root, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['id', 'name', 'role', 'aria-label', 'data-step', 'data-step-id', 'data-question', 'data-question-id', 'data-workflow', 'data-workflow-id', 'data-state', 'data-screen']
        });
        unknownTimer = setTimeout(() => {
          clearUnknownRecognition();
          emit('step.wait.timeout', { snapshot: riverDomSnapshot() });
          ui.querySelector('[data-status]').textContent = 'WAITING • step still unknown; trace captured. Use RUN after the page changes.';
        }, NAV_TIMEOUT_MS);
      };

      const run = async reason => {
        if (riverBusy) return;
        riverBusy = true;
        const generation = riverGeneration;
        try {
          const outcome = await drive(ui, reason, generation);
          if (outcome?.waitForRecognition) armUnknownRecognition(generation);
          else clearUnknownRecognition();
        } catch (error) {
          if (generation === riverGeneration) {
            clearUnknownRecognition();
            ui.querySelector('[data-status]').textContent = `WAITING • ${clean(error?.message || error)}`;
            emit('error', { message: clean(error?.message || error), step: pageKind(), snapshot: riverDomSnapshot() });
          }
        } finally {
          riverBusy = false;
        }
      };

      ui.querySelector('[data-run]').onclick = () => void run('Manual RUN');
      ui.querySelector('[data-clear]').onclick = () => {
        riverGeneration++;
        clearUnknownRecognition();
        GM_setValue(KEY, null);
        ui.querySelector('[data-id]').textContent = '';
        ui.querySelector('[data-status]').textContent = 'STOPPED / CLEARED';
      };

      document.addEventListener('click', event => {
        if (!event.isTrusted) return;
        const currentPage = pageKind();
        const payload = GM_getValue(KEY, null);
        const manualSeverity = currentPage === 'severity' && (!Number.isFinite(Number(payload?.inventoryQuantity)) || Number(payload?.inventoryQuantity) <= 0);
        if (currentPage !== 'related' && !manualSeverity) return;
        const button = event.target instanceof Element
          ? event.target.closest('button,a,[role="button"],input[type="button"],input[type="submit"]')
          : null;
        if (!button || button.closest('#bwu2-river-assistant') || button !== nextButton()) return;
        const generation = riverGeneration;
        void waitForPageChange(currentPage).then(nextPage => {
          if (generation !== riverGeneration) return;
          if (nextPage === 'unknown' || nextPage === currentPage) {
            emit('transition.unresolved', { from: currentPage, detected: nextPage, snapshot: riverDomSnapshot() });
            armUnknownRecognition(generation);
            return;
          }
          void run('Manual step completed');
        });
      }, true);

      window.addEventListener('popstate', () => void run('Route changed'), true);
      window.addEventListener('hashchange', () => void run('Route changed'), true);
      window.addEventListener('pagehide', clearUnknownRecognition, { once: true });

      if (GM_getValue(KEY, null)) void run('Page loaded');
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }

  if (location.hostname === 'river.amazon.com') installRiver();
  else installFcrBridge();
})();