// ==UserScript==
// @name         TEST FCResearch → RIVER Ticket Assistant v0.3.2
// @namespace    https://github.com/1Sirkkris
// @version      0.3.2
// @description  Gate Hazmat/L0 RIVER links until FCResearch ticket data is resolved, then drive the approved RIVER workflow.
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

  const VERSION = '0.3.2';
  const KEY = 'bwu2_ticket_assistant_payload_v3';
  const CORE_REQUEST_EVENT = 'fcr-data-core:request';
  const CORE_RESPONSE_EVENT = 'fcr-data-core:response';
  const CAPTURE_FIELDS = ['asin', 'fnsku', 'title', 'purchaseOrder', 'inventoryQuantity', 'inventoryCost', 'vendorCode'];
  const CORE_PING_TIMEOUT_MS = 1800;
  const CORE_SECTION_TIMEOUT_MS = 30000;
  const DOM_FALLBACK_SETTLE_MS = 2500;
  const PAGE_WAIT_MS = 12000;
  const RIVER_WORKFLOW_Q0 = '3654ec14-7232-4f65-84c3-87927cdb4d0c';
  const RIVER_WORKFLOW_ID = 'f2738dec-7f6f-4c2e-a85a-db7228de25f1';

  const clean = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const norm = value => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = element => !!element && element.isConnected && (() => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  })();
  const emit = (type, data = {}) => {
    try {
      window.dispatchEvent(new CustomEvent('bwu2-observability:event', {
        detail: JSON.stringify({ type: `river.${type}`, data })
      }));
    } catch {}
  };

  function warehouseId() {
    const match = location.pathname.match(/^\/([^/]+)\/results(?:\/|$)/i);
    return clean(match?.[1] || 'BWU2').toUpperCase();
  }

  function riverUrl(fc = warehouseId()) {
    const safeFc = /^[A-Z0-9-]{2,12}$/.test(fc) ? fc : 'BWU2';
    const url = new URL(`https://river.amazon.com/${encodeURIComponent(safeFc)}/workflows`);
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
    const wanted = labels.map(norm);
    for (const row of root.querySelectorAll('tr')) {
      const cells = [...row.children].filter(cell => cell.matches?.('th,td'));
      if (cells.length < 2 || !wanted.includes(norm(cells[0].textContent))) continue;
      return clean(cells[1].querySelector('a')?.textContent || cells[1].textContent);
    }
    return '';
  }

  function tableWith(root, ...headers) {
    return [...root.querySelectorAll('table')].find(table => {
      const text = norm([...table.querySelectorAll('thead th,thead td')].map(node => node.textContent).join(' | '));
      return headers.every(header => text.includes(norm(header)));
    }) || null;
  }

  function columns(table) {
    const wrapper = table?.closest('.dataTables_scroll,.dataTables_wrapper') || table?.parentElement;
    const headerTable = wrapper?.querySelector('.dataTables_scrollHead table') || table;
    const headers = [...headerTable?.querySelectorAll('thead th,thead td') || []].map(node => norm(node.textContent));
    const find = (...names) => headers.findIndex(header => names.some(name => header === norm(name) || header.startsWith(`${norm(name)} `)));
    return {
      po: find('purchase order', 'po'),
      vendor: find('vendor code', 'seller id'),
      date: find('order date', 'date'),
      qty: find('quantity'),
      asin: find('asin')
    };
  }

  function latestPo(root) {
    const table = root.querySelector('table#table-purchase-order-item') || tableWith(root, 'purchase order');
    if (!table) return {};
    const index = columns(table);
    const values = [...table.querySelectorAll('tbody tr')].map((row, rowIndex) => {
      const cells = [...row.children].filter(cell => cell.matches?.('td,th'));
      const dateText = index.date >= 0 ? clean(cells[index.date]?.textContent) : '';
      const parsedDate = Date.parse(dateText);
      return {
        purchaseOrder: index.po >= 0 ? clean(cells[index.po]?.textContent) : '',
        vendorCode: index.vendor >= 0 ? clean(cells[index.vendor]?.textContent) : '',
        orderDate: dateText,
        date: Number.isFinite(parsedDate) ? parsedDate : 0,
        rowIndex
      };
    }).filter(value => value.purchaseOrder || value.vendorCode);
    values.sort((a, b) => b.date - a.date || a.rowIndex - b.rowIndex);
    return values[0] || {};
  }

  function visibleInventoryQuantity(root, asin = '') {
    const table = root.querySelector('table#table-inventory') || tableWith(root, 'quantity');
    if (!table) return null;
    const index = columns(table);
    if (index.qty < 0) return null;
    let sum = 0;
    let found = false;
    for (const row of table.querySelectorAll('tbody tr')) {
      const cells = [...row.children].filter(cell => cell.matches?.('td,th'));
      if (index.asin >= 0 && asin && !clean(cells[index.asin]?.textContent).includes(asin)) continue;
      const raw = clean(cells[index.qty]?.textContent);
      const number = Number(raw.replace(/[^0-9.-]/g, ''));
      if (!Number.isFinite(number)) continue;
      sum += number;
      found = true;
    }
    return found ? sum : null;
  }

  function formatCost(value) {
    const text = clean(value);
    if (!text) return 'N/A';
    if (/^N\/A$/i.test(text)) return 'N/A';
    if (/^AUD\b/i.test(text)) return text;
    const match = text.match(/\d+(?:,\d{3})*(?:\.\d+)?/);
    return match ? `AUD ${match[0].replace(/,/g, '')}` : text;
  }

  function productFields(root) {
    const asin = (labelValue(root, ['ASIN', 'ISBN']).match(/\b[A-Z0-9]{10}\b/i) || [])[0]?.toUpperCase() || '';
    const fnsku = (labelValue(root, ['FNSKU', 'FNSku']).match(/\bX0[A-Z0-9]{8}\b/i) || [])[0]?.toUpperCase() || '';
    const title = labelValue(root, ['Title']);
    const rawPrice = labelValue(root, ['List Price', 'Price']);
    return { asin, fnsku, title, inventoryCost: rawPrice ? formatCost(rawPrice) : '' };
  }

  function domSnapshot() {
    const product = productFields(document);
    const po = latestPo(document);
    const quantity = visibleInventoryQuantity(document, product.asin);
    return {
      ...product,
      purchaseOrder: po.purchaseOrder || '',
      vendorCode: po.vendorCode || '',
      inventoryQuantity: quantity
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

  function coreRequest(type, payload = {}, timeout = CORE_SECTION_TIMEOUT_MS) {
    const id = crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        corePending.delete(id);
        reject(new Error(`FCR Data Core ${type} timed out`));
      }, timeout);
      corePending.set(id, { resolve, reject, timer });
      window.dispatchEvent(new CustomEvent(CORE_REQUEST_EVENT, {
        detail: JSON.stringify({ id, type, payload, client: 'river-assistant', group: 'river-capture' })
      }));
    });
  }

  function captureStateTemplate() {
    return Object.fromEntries(CAPTURE_FIELDS.map(field => [field, { state: 'pending', value: null }]));
  }

  function resolveField(state, field, value, unavailableValue = 'N/A') {
    if (!state[field]) return;
    const present = value !== null && value !== undefined && clean(value) !== '';
    if (present) {
      state[field] = { state: 'available', value };
      return;
    }
    if (state[field].state === 'pending') state[field] = { state: 'unavailable', value: unavailableValue };
  }

  function resolvedCount(state) {
    return CAPTURE_FIELDS.filter(field => state[field]?.state !== 'pending').length;
  }

  function fieldStates(state) {
    return Object.fromEntries(CAPTURE_FIELDS.map(field => [field, state[field]?.state || 'pending']));
  }

  function unavailableFields(state) {
    return CAPTURE_FIELDS.filter(field => state[field]?.state === 'unavailable');
  }

  let activeCapture = null;
  const managedBadges = new Set();

  function captureIndicator(badge) {
    let indicator = badge.nextElementSibling;
    if (!indicator?.classList?.contains('bwu2-river-capture-indicator')) {
      indicator = document.createElement('span');
      indicator.className = 'bwu2-river-capture-indicator';
      Object.assign(indicator.style, {
        display: 'inline-flex', alignItems: 'center', marginLeft: '6px', padding: '2px 7px', border: '1px solid #765900',
        borderRadius: '10px', background: '#fff3b0', color: '#111', font: '800 11px/1.4 Arial,sans-serif', verticalAlign: 'middle', whiteSpace: 'nowrap'
      });
      badge.insertAdjacentElement('afterend', indicator);
    }
    return indicator;
  }

  function setBadgeState(badge, state, detail = '') {
    if (!badge?.isConnected) return;
    managedBadges.add(badge);
    const indicator = captureIndicator(badge);
    badge.dataset.riverCaptureState = state;

    if (state === 'ready') {
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

    badge.style.pointerEvents = 'none';
    badge.style.cursor = 'wait';
    badge.setAttribute('role', 'status');
    badge.setAttribute('aria-disabled', 'true');
    badge.tabIndex = -1;
    badge.title = detail || 'RIVER capture is still resolving FCResearch data.';
    indicator.textContent = detail || 'RIVER CAPTURE…';
    indicator.style.background = '#fff3b0';
    indicator.style.borderColor = '#765900';
    indicator.title = badge.title;
  }

  function updatePendingBadges(count = 0) {
    for (const badge of [...managedBadges]) {
      if (!badge.isConnected) {
        managedBadges.delete(badge);
        continue;
      }
      setBadgeState(badge, 'pending', `RIVER CAPTURE ${count}/${CAPTURE_FIELDS.length}`);
    }
  }

  function markBadgesReady(payload) {
    const missing = Object.entries(payload.fieldStates || {}).filter(([, value]) => value === 'unavailable').map(([key]) => key);
    const title = missing.length
      ? `RIVER capture complete. Unavailable: ${missing.join(', ')}. Click to open RIVER.`
      : 'RIVER capture complete. Click to open RIVER.';
    for (const badge of [...managedBadges]) {
      if (!badge.isConnected) {
        managedBadges.delete(badge);
        continue;
      }
      setBadgeState(badge, 'ready', title);
    }
  }

  function applyDomFallback(state, snapshot = domSnapshot()) {
    resolveField(state, 'asin', snapshot.asin);
    resolveField(state, 'fnsku', snapshot.fnsku);
    resolveField(state, 'title', snapshot.title);
    resolveField(state, 'purchaseOrder', snapshot.purchaseOrder);
    resolveField(state, 'inventoryCost', snapshot.inventoryCost);
    resolveField(state, 'vendorCode', snapshot.vendorCode);
    resolveField(state, 'inventoryQuantity', Number.isFinite(snapshot.inventoryQuantity) ? snapshot.inventoryQuantity : null, null);
  }

  async function captureViaCore(search, state) {
    const ping = await coreRequest('ping', {}, CORE_PING_TIMEOUT_MS);
    emit('capture.core.ready', { version: clean(ping?.version || '') });

    const settle = async (name, fields, work) => {
      const started = performance.now();
      try {
        const result = await work;
        fields(result);
        emit('capture.section', { section: name, ok: true, resolved: resolvedCount(state), ms: Math.round(performance.now() - started) });
      } catch (error) {
        emit('capture.section', { section: name, ok: false, resolved: resolvedCount(state), ms: Math.round(performance.now() - started), error: clean(error?.message || error) });
      } finally {
        updatePendingBadges(resolvedCount(state));
      }
    };

    await Promise.all([
      settle('product', result => {
        const product = productFields(parseDocument(result?.html || ''));
        resolveField(state, 'asin', product.asin);
        resolveField(state, 'fnsku', product.fnsku);
        resolveField(state, 'title', product.title);
        resolveField(state, 'inventoryCost', product.inventoryCost);
      }, coreRequest('section', { endpoint: 'product', code: search }, CORE_SECTION_TIMEOUT_MS)),
      settle('purchase-order-item', result => {
        const po = latestPo(parseDocument(result?.html || ''));
        resolveField(state, 'purchaseOrder', po.purchaseOrder);
        resolveField(state, 'vendorCode', po.vendorCode);
      }, coreRequest('section', { endpoint: 'purchase-order-item', code: search }, CORE_SECTION_TIMEOUT_MS)),
      settle('inventory', result => {
        const complete = result?.complete !== false;
        const total = complete && Number.isFinite(Number(result?.totalQuantity)) ? Number(result.totalQuantity) : null;
        resolveField(state, 'inventoryQuantity', total, null);
      }, coreRequest('section', { endpoint: 'inventory', code: search }, CORE_SECTION_TIMEOUT_MS))
    ]);
  }

  async function buildCapture(search) {
    const state = captureStateTemplate();
    updatePendingBadges(0);
    emit('capture.started', { fields: CAPTURE_FIELDS.length });

    try {
      await captureViaCore(search, state);
    } catch (error) {
      emit('capture.core.unavailable', { error: clean(error?.message || error) });
      await sleep(DOM_FALLBACK_SETTLE_MS);
    }

    applyDomFallback(state);
    for (const field of CAPTURE_FIELDS) {
      if (state[field].state === 'pending') resolveField(state, field, null, field === 'inventoryQuantity' ? null : 'N/A');
    }

    const payload = {
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

    GM_setValue(KEY, payload);
    emit('capture.ready', {
      available: CAPTURE_FIELDS.length - unavailableFields(state).length,
      unavailable: unavailableFields(state),
      quantityAvailable: Number.isFinite(payload.inventoryQuantity)
    });
    emit('payload.saved', {
      hasAsin: payload.asin !== 'N/A', hasFnsku: payload.fnsku !== 'N/A', hasPo: payload.purchaseOrder !== 'N/A', hasTitle: payload.title !== 'N/A',
      hasPrice: payload.inventoryCost !== 'N/A', hasVendor: payload.vendorCode !== 'N/A', quantityAvailable: Number.isFinite(payload.inventoryQuantity)
    });
    return payload;
  }

  function ensureCapture() {
    const search = currentSearch();
    if (!search) return null;
    if (activeCapture?.search === search) return activeCapture.promise;

    const saved = GM_getValue(KEY, null);
    if (saved?.sourceSearch && saved.sourceSearch !== search) GM_setValue(KEY, null);

    const promise = buildCapture(search)
      .then(payload => {
        if (activeCapture?.search === search) {
          activeCapture.payload = payload;
          markBadgesReady(payload);
        }
        return payload;
      })
      .catch(error => {
        emit('capture.error', { error: clean(error?.message || error) });
        throw error;
      });

    activeCapture = { search, promise, payload: null };
    return promise;
  }

  function prepareBadge(badge) {
    if (!badge?.isConnected) return;
    managedBadges.add(badge);
    const search = currentSearch();
    if (activeCapture?.search === search && activeCapture.payload) {
      markBadgesReady(activeCapture.payload);
      return;
    }
    if (activeCapture?.search === search && badge.dataset.riverCaptureState === 'pending') return;
    setBadgeState(badge, 'pending', `RIVER CAPTURE 0/${CAPTURE_FIELDS.length}`);
    ensureCapture();
  }

  function installFcrBridge() {
    const inspect = () => {
      for (const badge of [...managedBadges]) {
        if (badge.isConnected && badge.matches('.fc-hazmat.fc-river-l0')) continue;
        if (badge.nextElementSibling?.classList?.contains('bwu2-river-capture-indicator')) badge.nextElementSibling.remove();
        badge.style.pointerEvents = '';
        badge.style.cursor = '';
        delete badge.dataset.riverCaptureState;
        managedBadges.delete(badge);
      }
      for (const badge of document.querySelectorAll('.fc-hazmat.fc-river-l0')) prepareBadge(badge);
    };

    const startObserver = () => {
      inspect();
      const observer = new MutationObserver(() => inspect());
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
      window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
    };

    if (document.documentElement) startObserver();
    else document.addEventListener('DOMContentLoaded', startObserver, { once: true });

    const openFromBadge = event => {
      if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
      const badge = event.target instanceof Element ? event.target.closest('.fc-hazmat.fc-river-l0') : null;
      if (!badge) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (badge.dataset.riverCaptureState !== 'ready' || !activeCapture?.payload) {
        emit('open.blocked', { reason: 'capture-not-ready' });
        prepareBadge(badge);
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
      if (wanted.some(wantedLabel => context.includes(wantedLabel))) return element;
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
    const candidates = [];
    const seen = new Set();
    const push = (key, element) => {
      if (!key || !element || seen.has(key) || !visible(element)) return;
      seen.add(key);
      candidates.push(element);
    };
    for (const input of document.querySelectorAll('input[type="radio"]:not([disabled])')) {
      const label = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : input.closest('label');
      push(input, visible(label) ? label : input);
    }
    for (const element of document.querySelectorAll('[role="radio"]:not([aria-disabled="true"])')) {
      if (element.querySelector('input[type="radio"]')) continue;
      push(element, element);
    }
    return candidates;
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

  function next(step) {
    const element = [...document.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"]')]
      .filter(visible)
      .find(candidate => textOf(candidate) === 'next' || textOf(candidate).startsWith('next '));
    if (!element) throw new Error('Next button not found.');
    emit('automation.action', { step, action: 'next' });
    element.click();
  }

  function pageKind() {
    const route = `${location.pathname} ${location.search} ${location.hash}`.toLowerCase();
    const body = norm(document.body?.innerText || '');
    if (/create.?issue/.test(route) || body.includes('create issue')) return 'create';
    if (/related.?tt/.test(route) || body.includes('related tt')) return 'related';
    if (/sortab/.test(route) || body.includes('non sortable') || body.includes('non-sortable')) return 'sortability';
    if (/severity/.test(route) || body.includes('units impacted')) return 'severity';
    if (/image/.test(route) || body.includes('image')) return 'images';
    if (/information/.test(route) || body.includes('vendor code') || body.includes('seller id')) return 'information';
    if (/(^|\W)asin(\W|$)/.test(route) || body.includes('type asin here')) return 'asin';
    if (/issue.?at.?fc/.test(route) || body.includes('inbound issue')) return 'issue';
    if (/pandash|dangerous|dg review/.test(route) || body.includes('lacks dg information')) return 'pandash';
    return 'unknown';
  }

  async function waitPage(previous = '') {
    const end = Date.now() + PAGE_WAIT_MS;
    while (Date.now() < end) {
      const page = pageKind();
      if (page !== 'unknown' && page !== previous) return page;
      await sleep(150);
    }
    return pageKind();
  }

  function payloadValue(payload, key, fallback = 'N/A') {
    const value = payload?.[key];
    if (value === null || value === undefined || clean(value) === '') return fallback;
    return value;
  }

  async function drive(ui, reason = 'RUN') {
    const payload = GM_getValue(KEY, null);
    if (!payload) {
      ui.querySelector('[data-status]').textContent = 'No saved FCResearch payload.';
      return;
    }

    ui.querySelector('[data-id]').textContent = payload.fnsku !== 'N/A' ? payload.fnsku : payload.asin;
    const status = ui.querySelector('[data-status]');
    status.textContent = `${reason} • checking step…`;
    const page = await waitPage();
    const stepNumber = { pandash: 1, issue: 2, asin: 3, related: 4, information: 5, sortability: 6, severity: 7, images: 8, create: 9 }[page] || 0;
    emit('step.detected', { step: page, stepNumber });

    if (page === 'pandash') {
      clickChoiceIndex(2, page);
      next(page);
      status.textContent = 'Option 2 selected • advancing…';
    } else if (page === 'issue') {
      clickChoiceIndex(1, page);
      next(page);
      status.textContent = 'Option 1 selected • advancing…';
    } else if (page === 'asin') {
      const asin = payloadValue(payload, 'asin');
      if (asin === 'N/A') throw new Error('Captured ASIN is unavailable; ASIN step was not submitted.');
      const input = field(['type asin here', 'asin']);
      if (!setValue(input, asin)) throw new Error('ASIN field not found/retained.');
      emit('automation.action', { step: page, action: 'fill', field: 'asin', available: true });
      next(page);
      status.textContent = 'ASIN entered • advancing…';
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
      for (const [aliases, value] of values) {
        const input = field(aliases);
        if (input && setValue(input, value)) filled++;
      }
      emit('automation.action', { step: page, action: 'fill-information', filled, expected: values.length });
      if (filled !== values.length) {
        emit('information.partial', { filled, expected: values.length });
        throw new Error(`Information W1 filled ${filled}/${values.length}; not advancing.`);
      }
      next(page);
      status.textContent = 'Information W1 filled • advancing…';
    } else if (page === 'sortability') {
      clickChoiceIndex(1, page);
      next(page);
      status.textContent = 'Option 1 selected • advancing…';
    } else if (page === 'severity') {
      if (!Number.isFinite(Number(payload.inventoryQuantity))) throw new Error('Captured quantity is unavailable; severity was not submitted.');
      const units = field(['sort unit impacts', 'units impacted', 'number of units impacted']);
      const shipments = field(['shipment cases', 'shipments impacted', 'number of shipments impacted']);
      if (!setValue(units, Number(payload.inventoryQuantity)) || !setValue(shipments, 0)) throw new Error('Quantity fields not found/retained.');
      emit('automation.action', { step: page, action: 'fill-severity', quantity: Number(payload.inventoryQuantity), shipments: 0 });
      next(page);
      status.textContent = 'Quantity entered • advancing…';
    } else if (page === 'images') {
      selectDropdownIndex(2, page);
      next(page);
      status.textContent = 'Dropdown Option 2 selected • advancing…';
    } else if (page === 'create') {
      emit('done', { step: page });
      status.textContent = 'DONE • final RIVER page reached. No submission performed.';
    } else {
      throw new Error('RIVER step not recognised.');
    }
  }

  function installRiver() {
    const start = () => {
      const ui = panel();
      let busy = false;
      let token = 0;
      const run = async (reason = 'RUN') => {
        if (busy) return;
        busy = true;
        try { await drive(ui, reason); }
        catch (error) {
          ui.querySelector('[data-status]').textContent = `WAITING • ${error.message}`;
          emit('error', { message: error.message, step: pageKind() });
        } finally { busy = false; }
      };

      ui.querySelector('[data-run]').onclick = () => void run('Manual RUN');
      ui.querySelector('[data-clear]').onclick = () => {
        token++;
        GM_setValue(KEY, null);
        ui.querySelector('[data-id]').textContent = '';
        ui.querySelector('[data-status]').textContent = 'STOPPED / CLEARED';
        emit('payload.cleared');
      };

      document.addEventListener('click', event => {
        const element = event.target instanceof Element
          ? event.target.closest('button,a,[role="button"],input[type="button"],input[type="submit"]')
          : null;
        if (!element || element.closest('#bwu2-river-assistant') || !['next', 'previous'].includes(textOf(element))) return;
        const previous = pageKind();
        const currentToken = ++token;
        setTimeout(async () => {
          const page = await waitPage(previous);
          if (currentToken === token && page !== previous) void run('Page loaded');
        }, 80);
      }, true);

      if (GM_getValue(KEY, null)) setTimeout(() => void run('Page loaded'), 150);
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }

  if (location.hostname === 'river.amazon.com') installRiver();
  else installFcrBridge();
})();
