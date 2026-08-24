// ==UserScript==
// @name         TEST v5.5.1 Stow Andons Helper — FCSKU Conflict Alert
// @namespace    Violentmonkey Scripts
// @include      /^https?:\/\/.*fcresearch.*\//
// @include      /^https?:\/\/qifcr\.fe\.aftx\.amazonoperations\.app\//
// @grant        GM_xmlhttpRequest
// @connect      aft-moveapp-nrt-nrt.nrt.proxy.amazon.com
// @connect      localhost
// @version      5.5.1
// @description  TEST: Dual-surface FCResearch/FC-Lite helper with duplicate-FNSKU/FCSKU conflict alerts.
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Stow_Andons_Helper.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Stow_Andons_Helper.user.js
// ==/UserScript==

(() => {
  'use strict';
  if (window.__stowAndonsCore548test || location.hash.startsWith('#fcr-tote-checker')) return;
  window.__stowAndonsCore548test = true;

  const MOVE_URL = 'https://aft-moveapp-nrt-nrt.nrt.proxy.amazon.com/api/move-container';

  const COOKIE = {
    floor: 'vm_fc_floor',
    print: 'vm_fc_print_dropzone',
    printQty: 'vm_fc_print_dz_qty',
    showImg: 'vm_fc_show_img_hover',
    imgWidth: 'vm_fc_img_width',
    showTitle: 'vm_fc_show_title_hover',
    showDims: 'vm_fc_show_dims_hover',
    showWeight: 'vm_fc_show_weight_hover',
    showSortable: 'vm_fc_show_sortable_hover'
  };

  const FLOORS = ['P1', 'P2', 'P3', 'P4'];
  const UPPER_DROPS = [
    { key: 'Cubiscan', label: 'Cubiscan', pattern: 'dz-Pcubiscan-{floor}' },
    { key: 'Damages', label: 'Damages', pattern: 'dz-P-Damages-{floor}' },
    { key: 'Hazmat', label: 'Hazmat', pattern: 'dz-P-Hazmat-{floor}' },
    { key: 'ISS', label: 'ISS', pattern: 'dz-P-ISS-{floor}' },
    { key: 'Non-Sort', label: 'Non-Sort', pattern: 'dz-Pnonsort-{floor}' },
    { key: 'Prep', label: 'Prep', pattern: 'dz-P-Prep-{floor}' }
  ];
  const P1_DROPS = [
    { key: 'P1-Hazmat', label: 'Hazmat', dest: 'dz-P-HAZMAT_OUT' },
    { key: 'P1-Ticketland', label: 'Ticketland', dest: 'dz-P-Ticketland' },
    { key: 'P1-Consolidation', label: 'Consolidation', dest: 'dz-P-issconsol' },
    { key: 'P1-ISS-WIP', label: 'ISS WIP', dest: 'dz-S-ISSWIP1' },
    { key: 'P1-Nonsort', label: 'Nonsort', dest: 'dz-P-IB-nonsort' },
    { key: 'P1-Shipdock', label: 'Shipdock', dest: 'dz-P-ISS-Shipdock' },
    { key: 'P1-Damageland', label: 'Damageland', dest: 'dz-Pdamageland' },
    { key: 'P1-Receive-Damages', label: 'Receive Damages', dest: 'dz-P-rcv-Damages' }
  ];

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const canonical = value => clean(value).toUpperCase();


  const CORE_REQUEST_EVENT = 'fcr-data-core:request';
  const CORE_RESPONSE_EVENT = 'fcr-data-core:response';
  const CORE_TIMEOUT_MS = 17000;
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
  });

  function coreRequest(type, payload = {}, timeout = CORE_TIMEOUT_MS) {
    const id = crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        corePending.delete(id);
        reject(new Error('FCR Data Core missing / timed out'));
      }, timeout);
      corePending.set(id, { resolve, reject, timer });
      window.dispatchEvent(new CustomEvent(CORE_REQUEST_EVENT, { detail: JSON.stringify({ id, type, payload, client: 'stow' }) }));
    });
  }


  function usage(key, ms = 0, count = 1) {
    window.dispatchEvent(new CustomEvent('fcr-usage:event', {
      detail: JSON.stringify({ key: 'stow.' + key, ms, count })
    }));
  }


  let hoverCode = '';
  let hoverX = 0;
  let hoverY = 0;
  let hoverTable = null;
  let toastTimer = 0;
  let refreshTimer = 0;
  let sussyRun = 0;
  let lastSussySignature = '';
  let lastSussyTable = null;
  let lastUrl = location.href;
  const moveButtonFeedback = new WeakMap();

  function setCookie(name, value) {
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${new Date(Date.now() + 31536000000).toUTCString()}; path=/`;
  }

  function getCookie(name) {
    for (let part of document.cookie.split(';')) {
      part = part.trim();
      if (part.startsWith(`${name}=`)) return decodeURIComponent(part.slice(name.length + 1));
    }
    return null;
  }

  function cookieBool(name, fallback = true) {
    const value = getCookie(name);
    return value === null ? fallback : value === '1';
  }

  function isContainerPage() {
    try {
      const url = new URL(location.href);
      return /\/BWU2\/results\/?$/i.test(url.pathname) && /^(ts|cs)X/i.test(url.searchParams.get('s') || '');
    } catch {
      return false;
    }
  }

  function currentContainer() {
    try { return new URL(location.href).searchParams.get('s') || ''; }
    catch { return ''; }
  }

  function topSearchInput() {
    return $$('input[type="search"],input[type="text"],input:not([type])').find(input => {
      const rect = input.getBoundingClientRect();
      return rect.width >= 250 && rect.height > 0 && rect.top >= 0 && rect.top < 90 && !input.disabled;
    }) || null;
  }

  function refocusSearch(delay = 80) {
    setTimeout(() => {
      const input = topSearchInput();
      if (!input) return;
      input.focus({ preventScroll: true });
      try { input.select(); } catch {}
    }, delay);
  }

  function getFloor() {
    return $('.vm-floor-btn.active')?.dataset.floor || getCookie(COOKIE.floor) || 'P2';
  }

  function activeDrops() {
    return getFloor() === 'P1' ? P1_DROPS : UPPER_DROPS;
  }

  function destination(key) {
    if (key === 'Prime') return 'dz-P-PRIME';
    const floor = getFloor();
    const entry = (floor === 'P1' ? P1_DROPS : UPPER_DROPS).find(item => item.key === key);
    if (!entry) return '';
    return floor === 'P1' ? entry.dest : entry.pattern.replace('{floor}', floor);
  }

  function settingBool(id, cookie, fallback) {
    const input = document.getElementById(id);
    return input ? input.checked : cookieBool(cookie, fallback);
  }

  function printEnabled() {
    return settingBool('vm-set-print', COOKIE.print, false);
  }

  function printQty() {
    const input = document.getElementById('vm-set-qty');
    const value = Number.parseInt(input?.value || getCookie(COOKIE.printQty) || '2', 10);
    return Number.isFinite(value) && value > 0 ? Math.min(value, 99) : 2;
  }

  function showImage() { return settingBool('vm-set-img', COOKIE.showImg, true); }
  function showTitle() { return settingBool('vm-set-title', COOKIE.showTitle, true); }
  function showDims() { return settingBool('vm-set-dims', COOKIE.showDims, true); }
  function showWeight() { return settingBool('vm-set-weight', COOKIE.showWeight, true); }
  function showSortable() { return settingBool('vm-set-sortable', COOKIE.showSortable, true); }

  function imageWidth() {
    const input = document.getElementById('vm-set-imgw');
    const value = Number.parseInt(input?.value || getCookie(COOKIE.imgWidth) || '150', 10);
    return Number.isFinite(value) ? Math.max(50, Math.min(value, 180)) : 150;
  }

  function injectStyles() {
    if (document.getElementById('vm-safe-trim-css')) return;
    const style = document.createElement('style');
    style.id = 'vm-safe-trim-css';
    style.dataset.vmSafeUi = '1'; style.dataset.fcrToolUi = '1';
    style.textContent = `
      #vm-safe-toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:1000010;opacity:0;padding:8px 14px;border-radius:6px;color:#fff;background:#2b8a3e;font:13px Arial,sans-serif;box-shadow:0 4px 16px #0003;pointer-events:none;transition:opacity .35s}
      #vm-safe-toast.error{background:#c92a2a}
      #vm-safe-gear{position:fixed;left:16px;bottom:16px;z-index:999998;width:34px;height:34px;border:1px solid #ccd2d8;border-radius:50%;background:#fff;cursor:pointer;font-size:17px}
      #vm-safe-gear.active{background:#1971c2;color:#fff}
      #vm-safe-settings{position:fixed;left:58px;bottom:56px;z-index:1000001;width:260px;padding:10px 14px;background:#fff;border:1px solid #d9dde1;border-radius:9px;box-shadow:0 8px 25px #0002;font:12px Arial,sans-serif}
      #vm-safe-settings.hidden{display:none}
      #vm-safe-settings b{display:block;margin:8px 0 5px}
      #vm-safe-settings label{display:flex;align-items:center;gap:6px;margin:5px 0}
      #vm-safe-settings input[type=number]{width:58px}
      #vm-safe-hover{position:absolute;z-index:999997;display:none;pointer-events:none;max-width:540px;padding:8px 10px;background:#161616f0;border-radius:6px;color:#f1f3f5;font:11px Arial,sans-serif}
      #vm-safe-hover .content{display:flex;gap:10px}
      #vm-safe-hover img{display:none;max-width:180px;max-height:220px;object-fit:contain}
      #vm-safe-hover .title{max-width:340px;font-size:12px;line-height:1.35;margin-bottom:5px}
      #vm-safe-hover .detail{margin:3px 0}.vm-detail-label{display:inline-block;min-width:68px;color:#9ca3af;font-size:10px;text-transform:uppercase}.vm-dims-sussy{padding:2px 5px;border:2px solid #f59e0b;border-radius:4px;background:#fff7ed;color:#111;font-weight:800}.vm-sort-pill{padding:2px 6px;border-radius:20px;font-weight:800}.vm-sort-yes{background:#fde047;color:#111}.vm-sort-no{background:#dc2626;color:#fff}
      .vm-drop-inline{margin-left:8px;display:inline-flex;align-items:center;flex-wrap:wrap;gap:5px;font-family:Arial,sans-serif}.vm-floor-btn,.vm-tag-btn{min-height:24px;padding:4px 8px;border:1px solid #94a3b8;border-radius:7px;background:#fff;cursor:pointer;font:700 12px Arial,sans-serif}.vm-floor-btn.active{background:#0b74d1;color:#fff}.vm-tag-btn:disabled{opacity:.55;cursor:wait}.vm-drop-divider{margin:0 3px;color:#475569;font-weight:800}
      .vm-suspicious-dims-summary{display:inline-flex;align-items:center;margin-left:8px;padding:3px 8px;border:1px solid #f59e0b;border-radius:999px;background:#fff7ed;color:#7c2d12;font:800 11px Arial,sans-serif}.vm-suspicious-dims-summary.vm-loading{border-color:#94a3b8;background:#f8fafc;color:#475569}.vm-suspicious-dims-summary.vm-clear{border-color:#22c55e;background:#f0fdf4;color:#14532d}.vm-suspicious-dims-row td,.vm-suspicious-dims-row td a{background:#fef9c3!important}.vm-suspicious-dims-cell{outline:3px dashed rgba(37,99,235,.70)!important;outline-offset:-4px!important;background:#fff7ed!important}
      .vm-fcsku-conflict-summary{display:inline-flex;align-items:center;margin-left:8px;padding:3px 8px;border:2px solid #7f1d1d;border-radius:999px;background:#fff;color:#7f1d1d;font:900 11px Arial,sans-serif;letter-spacing:.2px}.vm-fcsku-conflict-row td{background-image:repeating-linear-gradient(135deg,rgba(127,29,29,.18) 0 8px,rgba(245,158,11,.10) 8px 16px)!important;box-shadow:inset 0 2px #7f1d1d,inset 0 -2px #7f1d1d}.vm-fcsku-conflict-row td a{font-weight:900!important}.vm-fcsku-conflict-cell{outline:3px solid #7f1d1d!important;outline-offset:-3px!important}
    `;
    document.head.appendChild(style);
  }

  function ensureUi() {
    injectStyles();
    if (!document.getElementById('vm-safe-toast')) {
      const toast = document.createElement('div');
      toast.id = 'vm-safe-toast';
      toast.dataset.vmSafeUi = '1'; toast.dataset.fcrToolUi = '1';
      document.body.appendChild(toast);
    }
    if (!document.getElementById('vm-safe-hover')) {
      const hover = document.createElement('div');
      hover.id = 'vm-safe-hover';
      hover.dataset.vmSafeUi = '1'; hover.dataset.fcrToolUi = '1';
      hover.innerHTML = '<div class="content"><img><section><div class="title"></div><div class="details"></div></section></div>';
      document.body.appendChild(hover);
    }
    if (document.getElementById('vm-safe-gear')) return;

    const gear = document.createElement('button');
    const panel = document.createElement('div');
    gear.id = 'vm-safe-gear';
    gear.dataset.vmSafeUi = '1'; gear.dataset.fcrToolUi = '1';
    gear.type = 'button';
    gear.textContent = '⚙';
    gear.title = 'Stow Andons settings';
    panel.id = 'vm-safe-settings';
    panel.dataset.vmSafeUi = '1'; panel.dataset.fcrToolUi = '1';
    panel.className = 'hidden';
    panel.innerHTML = `
      <b>Print</b>
      <label><input type="checkbox" id="vm-set-print">Print Dropzone Label</label>
      <label>Quantity <input type="number" id="vm-set-qty" min="1" max="99"></label>
      <b>Hover Preview</b>
      <label><input type="checkbox" id="vm-set-img">Show Image</label>
      <label>Image Width <input type="number" id="vm-set-imgw" min="50" max="180"></label>
      <label><input type="checkbox" id="vm-set-title">Show Title</label>
      <label><input type="checkbox" id="vm-set-dims">Show Dimensions</label>
      <label><input type="checkbox" id="vm-set-weight">Show Weight</label>
      <label><input type="checkbox" id="vm-set-sortable">Show Sortable</label>`;
    document.body.append(gear, panel);

    const bindCheck = (id, cookie, fallback) => {
      const input = document.getElementById(id);
      input.checked = cookieBool(cookie, fallback);
      input.addEventListener('change', () => setCookie(cookie, input.checked ? '1' : '0'));
    };
    const bindNumber = (id, cookie, fallback, min, max) => {
      const input = document.getElementById(id);
      const saved = Number.parseInt(getCookie(cookie) || String(fallback), 10);
      input.value = String(Number.isFinite(saved) ? Math.max(min, Math.min(saved, max)) : fallback);
      input.addEventListener('change', () => {
        const value = Math.max(min, Math.min(Number.parseInt(input.value, 10) || fallback, max));
        input.value = String(value);
        setCookie(cookie, value);
      });
    };

    bindCheck('vm-set-print', COOKIE.print, false);
    bindNumber('vm-set-qty', COOKIE.printQty, 2, 1, 99);
    bindCheck('vm-set-img', COOKIE.showImg, true);
    bindNumber('vm-set-imgw', COOKIE.imgWidth, 150, 50, 180);
    bindCheck('vm-set-title', COOKIE.showTitle, true);
    bindCheck('vm-set-dims', COOKIE.showDims, true);
    bindCheck('vm-set-weight', COOKIE.showWeight, true);
    bindCheck('vm-set-sortable', COOKIE.showSortable, true);

    gear.addEventListener('click', event => {
      usage('settings.open');
      event.stopPropagation();
      panel.classList.toggle('hidden');
      gear.classList.toggle('active', !panel.classList.contains('hidden'));
    });
    panel.addEventListener('mousedown', event => event.stopPropagation());
    document.addEventListener('mousedown', () => {
      panel.classList.add('hidden');
      gear.classList.remove('active');
    });
  }

  function toast(message, error = false) {
    ensureUi();
    const element = document.getElementById('vm-safe-toast');
    clearTimeout(toastTimer);
    element.textContent = message;
    element.classList.toggle('error', error);
    element.style.opacity = '1';
    toastTimer = setTimeout(() => { element.style.opacity = '0'; }, 2200);
  }

  function toHex(value) {
    return [...new TextEncoder().encode(String(value))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function printLabel(destinationId) {
    usage('print');
    const encoded = toHex(destinationId);
    const url = new URL('http://localhost:5965/printer');
    const params = {
      action: 'print', type: 'barcode', data: encoded, text: encoded,
      quantity: String(printQty()), desc: '', seq: String(Math.floor(Math.random() * 9e9) + 1e9)
    };
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    return new Promise((resolve, reject) => GM_xmlhttpRequest({
      method: 'GET', url: url.toString(), timeout: 15000,
      onload: response => response.status < 300 ? resolve() : reject(new Error(`HTTP ${response.status}`)),
      onerror: () => reject(new Error('Network')),
      ontimeout: () => reject(new Error('Timeout'))
    }));
  }

  function moveContainer(key, button) {
    usage(`move.${clean(key).toLowerCase() || 'unknown'}`);
    if (button?.disabled) return;
    const container = currentContainer();
    const dest = destination(key);
    if (!container) return toast('No container in URL', true);
    if (!dest) return toast(`Bad destination for ${key}`, true);

    const feedback = button ? moveButtonFeedback.get(button) : null;
    const original = feedback?.original ?? button?.textContent ?? '';
    if (button) {
      clearTimeout(feedback?.timer);
      button.disabled = true;
      button.textContent = 'Moving…';
    }
    const finish = (text, failed = false) => {
      if (button) {
        button.disabled = false;
        button.textContent = text;
        const timer = setTimeout(() => {
          if (button.isConnected) button.textContent = original;
          moveButtonFeedback.delete(button);
        }, 1200);
        moveButtonFeedback.set(button, { original, timer });
      }
      if (failed) toast(text, true);
      refocusSearch(80);
      refocusSearch(400);
    };

    GM_xmlhttpRequest({
      method: 'POST', url: MOVE_URL, timeout: 15000,
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ sourceScannableId: null, destinationScannableId: dest, containerScannableId: container, confirmed: 'true' }),
      onload: response => {
        if (response.status >= 300) return finish(`Failed ${response.status}`, true);
        finish('Moved ✓');
        toast(`Moved to ${dest}`);
        if (printEnabled()) printLabel(dest).catch(error => toast(`Print failed: ${error.message}`, true));
      },
      onerror: () => finish('Move failed', true),
      ontimeout: () => finish('Timed out', true)
    });
  }

  function renderDropButtons() {
    const buttons = activeDrops().map(item => `<button type="button" class="vm-tag-btn" data-drop="${item.key}" title="${item.dest || item.pattern}">${item.label}</button>`).join('');
    return `${buttons}<button type="button" class="vm-tag-btn" data-drop="Prime" title="dz-P-PRIME">Prime</button>`;
  }

  function wireDropButtons(root) {
    $$('.vm-tag-btn', root).forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        moveContainer(button.dataset.drop, button);
      });
    });
  }

  function refreshDropButtons() {
    const box = document.getElementById('vm-drop-buttons-wrap');
    if (!box) return;
    box.innerHTML = renderDropButtons();
    wireDropButtons(box);
  }

  function setFloor(floor) {
    usage('floor.change');
    if (!FLOORS.includes(floor)) return;
    setCookie(COOKIE.floor, floor);
    $$('.vm-floor-btn').forEach(button => button.classList.toggle('active', button.dataset.floor === floor));
    refreshDropButtons();
    toast(`Floor set to ${floor}`);
    refocusSearch();
  }

  function isFcliteSurface() {
    return location.hash.startsWith('#fcr-lite') || !!document.getElementById('fcrlite-sections-app');
  }

  function fcliteInventoryCard() {
    return document.querySelector('#fcrlite-sections-app .fcrlite-card[data-endpoint="inventory"]');
  }

  function findInventoryHeading() {
    const liteCard = fcliteInventoryCard();
    const liteHeading = liteCard?.querySelector(':scope > .fcrlite-card-head') || null;
    const liteInventory = liteHeading
      ? $$(':scope > span', liteHeading).find(span => clean(span.textContent) === 'Inventory')
      : null;
    if (liteInventory) return { column: liteHeading, inventory: liteInventory };
    if (isFcliteSurface()) return null;

    for (const column of $$('.a-box-inner .a-row .a-column.a-span8')) {
      const inventory = $$('span', column).find(span => clean(span.textContent) === 'Inventory');
      if (inventory) return { column, inventory };
    }
    return null;
  }

  function injectInlineControls(containerPage) {
    if (!containerPage || document.querySelector('.vm-drop-inline')) return;
    const found = findInventoryHeading();
    if (!found) return;
    let floor = getCookie(COOKIE.floor);
    if (!FLOORS.includes(floor)) floor = 'P2';
    setCookie(COOKIE.floor, floor);

    const wrap = document.createElement('span');
    wrap.className = 'vm-drop-inline';
    wrap.dataset.vmSafeUi = '1'; wrap.dataset.fcrToolUi = '1';
    wrap.innerHTML = `<b>Floor:</b>${FLOORS.map(item => `<button type="button" class="vm-floor-btn ${item === floor ? 'active' : ''}" data-floor="${item}">${item}</button>`).join('')}<span class="vm-drop-divider">|</span><b>Drop:</b><span id="vm-drop-buttons-wrap">${renderDropButtons()}</span>`;
    (found.column.querySelector('span.help') || found.inventory).after(wrap);
    $$('.vm-floor-btn', wrap).forEach(button => button.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation(); setFloor(button.dataset.floor);
    }));
    wireDropButtons(wrap);
    ensureSussyBadge();
  }

  function inventoryTable() {
    const liteCard = fcliteInventoryCard();
    if (liteCard) return liteCard.querySelector('.fcrlite-card-body #table-inventory');
    if (isFcliteSurface()) return null;
    return document.getElementById('table-inventory');
  }

  function inventoryColumns(table = inventoryTable()) {
    const result = { container: -1, fnsku: -1, fcsku: -1, qty: -1 };
    if (!table) return result;
    $$('thead th', table).forEach((header, index) => {
      const id = clean(header.id).toLowerCase();
      const text = clean(header.textContent).replace(/\(.*?\)/g, '').toLowerCase();
      if (id === 'inventory-container' || text === 'container') result.container = index;
      if (id === 'inventory-fnsku' || text === 'fnsku') result.fnsku = index;
      if (id === 'inventory-fcsku' || text === 'fcsku') result.fcsku = index;
      if (id === 'inventory-quantity' || text.startsWith('quantity')) result.qty = index;
    });
    return result;
  }

  function cellCode(cell) {
    return clean(cell?.querySelector?.('a')?.textContent || cell?.textContent);
  }

  function fcskuConflictGroups(entries) {
    const groups = new Map();
    for (const entry of entries) {
      const container = canonical(entry.container);
      const fnsku = canonical(entry.fnsku);
      const fcsku = canonical(entry.fcsku);
      if (!container || !fnsku || !fcsku) continue;
      const key = `${container}\u0000${fnsku}`;
      if (!groups.has(key)) groups.set(key, { container, fnsku, fcskus: new Set(), entries: [] });
      const group = groups.get(key);
      group.fcskus.add(fcsku);
      group.entries.push(entry);
    }
    return [...groups.values()].filter(group => group.fcskus.size > 1);
  }

  function ensureFcskuConflictBadge(conflicts) {
    let badge = document.getElementById('vm-fcsku-conflict-summary');
    if (!conflicts.length) {
      badge?.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.id = 'vm-fcsku-conflict-summary';
      badge.dataset.vmSafeUi = '1'; badge.dataset.fcrToolUi = '1';
      badge.className = 'vm-fcsku-conflict-summary';
      (document.getElementById('vm-suspicious-dims-summary') || document.querySelector('.vm-drop-inline'))?.after(badge);
    }
    const rowCount = conflicts.reduce((sum, group) => sum + group.entries.length, 0);
    badge.textContent = `FCSKU CONFLICT: ${conflicts.length}`;
    badge.title = conflicts.map(group => `${group.fnsku}: ${[...group.fcskus].join(' + ')}`).join('\n');
    badge.setAttribute('aria-label', `${conflicts.length} FNSKU conflict${conflicts.length === 1 ? '' : 's'} across ${rowCount} rows`);
  }

  function scanFcskuConflicts(containerPage) {
    const table = inventoryTable();
    if (!containerPage || !table) {
      ensureFcskuConflictBadge([]);
      return;
    }

    const { container, fnsku, fcsku } = inventoryColumns(table);
    const tableRows = $$('tbody tr', table);
    for (const row of tableRows) {
      row.classList.remove('vm-fcsku-conflict-row');
      row.querySelectorAll('.vm-fcsku-conflict-cell').forEach(cell => cell.classList.remove('vm-fcsku-conflict-cell'));
    }
    if (fnsku < 0 || fcsku < 0) {
      ensureFcskuConflictBadge([]);
      return;
    }

    const fallbackContainer = currentContainer();
    const entries = tableRows.map(row => ({
      row,
      container: container >= 0 ? cellCode(row.cells?.[container]) : fallbackContainer,
      fnsku: cellCode(row.cells?.[fnsku]),
      fcsku: cellCode(row.cells?.[fcsku])
    }));
    const conflicts = fcskuConflictGroups(entries);

    for (const group of conflicts) {
      for (const entry of group.entries) {
        entry.row.classList.add('vm-fcsku-conflict-row');
        entry.row.cells?.[fnsku]?.classList.add('vm-fcsku-conflict-cell');
        entry.row.cells?.[fcsku]?.classList.add('vm-fcsku-conflict-cell');
      }
    }
    ensureFcskuConflictBadge(conflicts);
  }


  function emptyProduct() {
    return { asin: '', isbn: '', primary: '', fnsku: '', fcsku: '', img: '', title: '', dimensions: '', weight: '', sortable: null, suspicious: false };
  }

  let coreWarningShown = false;
  async function fetchProduct(fnsku) {
    const code = clean(fnsku);
    if (!code) return emptyProduct();
    try {
      const result = await coreRequest('product', {
        code,
        require: ['img', 'title', 'dimensions', 'weight', 'sortable']
      });
      const product = result?.product;
      if (!product) return emptyProduct();
      return {
        asin: clean(product.asin),
        isbn: clean(product.isbn),
        primary: clean(product.primary || product.asin || product.isbn),
        fnsku: clean(product.fnsku),
        fcsku: clean(product.fcsku),
        img: clean(product.img),
        title: clean(product.title),
        dimensions: clean(product.dimensions),
        weight: clean(product.weight),
        sortable: product.sortable === true ? true : product.sortable === false ? false : null,
        suspicious: product.suspicious === true
      };
    } catch (error) {
      if (!coreWarningShown) {
        coreWarningShown = true;
        toast(error?.message || 'FCR Data Core missing', true);
      }
      return emptyProduct();
    }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function positionHover() {
    const hover = document.getElementById('vm-safe-hover');
    if (!hover) return;
    hover.style.left = `${hoverX + 18}px`;
    hover.style.top = `${hoverY + 18}px`;
  }

  function showProductHover(info) {
    const hover = document.getElementById('vm-safe-hover');
    if (!hover) return;
    const image = hover.querySelector('img');
    const title = hover.querySelector('.title');
    const details = hover.querySelector('.details');

    image.style.display = showImage() && info.img ? 'block' : 'none';
    if (image.style.display === 'block') { image.src = info.img; image.style.width = `${imageWidth()}px`; }
    title.textContent = showTitle() ? info.title : '';

    let html = '';
    if (showDims() && info.dimensions) html += `<div class="detail"><span class="vm-detail-label">Dimensions</span><span class="${info.suspicious ? 'vm-dims-sussy' : ''}">${escapeHtml(info.dimensions)}</span></div>`;
    if (showWeight() && info.weight) html += `<div class="detail"><span class="vm-detail-label">Weight</span>${escapeHtml(info.weight)}</div>`;
    if (showSortable() && typeof info.sortable === 'boolean') html += `<div class="detail"><span class="vm-detail-label">Sortable</span><span class="vm-sort-pill ${info.sortable ? 'vm-sort-yes' : 'vm-sort-no'}">${info.sortable ? 'TRUE' : 'FALSE'}</span></div>`;
    details.innerHTML = html;

    if (image.style.display === 'none' && !title.textContent && !html) return hideProductHover();
    hover.style.display = 'block';
    positionHover();
  }

  function hideProductHover() {
    const hover = document.getElementById('vm-safe-hover');
    if (hover) hover.style.display = 'none';
  }

  function attachHovers(containerPage) {
    if (!containerPage) return;
    const table = inventoryTable();
    if (!table || table === hoverTable) return;
    hoverTable = table;
    hoverCode = '';
    hideProductHover();

    const hoverLink = target => {
      if (!(target instanceof Element)) return null;
      const link = target.closest('a[href*="/results?s="]');
      if (!link || !table.contains(link)) return null;
      const { fnsku } = inventoryColumns(table);
      return fnsku >= 0 && link.closest('td')?.cellIndex === fnsku ? link : null;
    };

    table.addEventListener('mouseover', event => {
      const link = hoverLink(event.target);
      if (!link || link.contains(event.relatedTarget)) return;
      const code = clean(link.textContent);
      if (!code) return;
      hoverCode = code;
      usage('product.hover');
      fetchProduct(code).then(info => { if (hoverCode === code) showProductHover(info); });
    });
    table.addEventListener('mouseout', event => {
      const link = hoverLink(event.target);
      if (!link || link.contains(event.relatedTarget)) return;
      hoverCode = '';
      hideProductHover();
    });
    table.addEventListener('mousemove', event => {
      if (!hoverCode) return;
      hoverX = event.pageX;
      hoverY = event.pageY;
      positionHover();
    });
  }

  function ensureSussyBadge() {
    let badge = document.getElementById('vm-suspicious-dims-summary');
    const controls = document.querySelector('.vm-drop-inline');
    if (!controls) return null;
    if (!badge) {
      badge = document.createElement('span');
      badge.id = 'vm-suspicious-dims-summary';
      badge.dataset.vmSafeUi = '1'; badge.dataset.fcrToolUi = '1';
      badge.className = 'vm-suspicious-dims-summary vm-loading';
      badge.textContent = 'Sussy: checking…';
      controls.after(badge);
    }
    return badge;
  }

  function quantity(cell) {
    const value = Number(String(cell?.textContent || '').replace(/[^0-9.]/g, ''));
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  async function runWithConcurrency(items, limit, worker) {
    let next = 0;
    async function run() {
      while (true) {
        const index = next++;
        if (index >= items.length) return;
        await worker(items[index], index);
      }
    }
    await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, run));
  }

  async function scanSussy(containerPage) {
    if (!containerPage) {
      lastSussySignature = '';
      lastSussyTable = null;
      return;
    }
    const table = inventoryTable();
    if (table !== lastSussyTable) {
      lastSussyTable = table;
      lastSussySignature = '';
      sussyRun++;
    }
    if (!table) return;
    const { fnsku, qty } = inventoryColumns(table);
    if (fnsku < 0) return;
    const rows = [];
    const signatureParts = [];
    for (const row of $$('tbody tr', table)) {
      if (row.cells?.length <= fnsku) continue;
      const fnskuCell = row.cells[fnsku];
      const quantityValue = qty >= 0 ? quantity(row.cells?.[qty]) : 1;
      rows.push({ row, fnskuCell, units: quantityValue || 1 });
      signatureParts.push(`${clean(fnskuCell.textContent)}:${quantityValue}`);
    }
    if (!rows.length) return;

    const signature = `${currentContainer()}|${signatureParts.join('|')}`;
    if (signature === lastSussySignature) return;
    lastSussySignature = signature;
    const run = ++sussyRun;
    const badge = ensureSussyBadge();
    if (badge) { badge.className = 'vm-suspicious-dims-summary vm-loading'; badge.textContent = 'Sussy: checking…'; }

    let suspiciousCount = 0;
    let suspiciousUnits = 0;
    let totalUnits = 0;
    const groups = new Map();

    rows.forEach(({ row, fnskuCell, units }) => {
      row.classList.remove('vm-suspicious-dims-row');
      fnskuCell.classList.remove('vm-suspicious-dims-cell');
      totalUnits += units;
      const code = clean(fnskuCell.querySelector('a')?.textContent || fnskuCell.textContent);
      if (!code) return;
      if (!groups.has(code)) groups.set(code, []);
      groups.get(code).push({ row, units });
    });

    await runWithConcurrency([...groups.entries()], 5, async ([code, entries]) => {
      const info = await fetchProduct(code);
      if (run !== sussyRun || !info.suspicious) return;
      for (const { row, units } of entries) {
        if (!row.isConnected) continue;
        suspiciousCount++;
        suspiciousUnits += units;
        row.classList.add('vm-suspicious-dims-row');
        row.cells?.[fnsku]?.classList.add('vm-suspicious-dims-cell');
      }
    });

    if (run !== sussyRun) return;
    const currentBadge = ensureSussyBadge();
    if (!currentBadge) return;
    const pct = Math.round((suspiciousCount / rows.length) * 100);
    const unitPct = totalUnits ? Math.round((suspiciousUnits / totalUnits) * 100) : 0;
    currentBadge.className = `vm-suspicious-dims-summary${suspiciousCount ? '' : ' vm-clear'}`;
    currentBadge.textContent = `Sussy: ${suspiciousCount}/${rows.length} (${pct}%)`;
    currentBadge.title = `${suspiciousUnits}/${totalUnits} units (${unitPct}%) from FNSKU-only checks`;
  }

  function refresh() {
    ensureUi();
    const containerPage = isContainerPage();
    injectInlineControls(containerPage);
    attachHovers(containerPage);
    scanFcskuConflicts(containerPage);
    scanSussy(containerPage);
  }

  function scheduleRefresh() {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => { refreshTimer = 0; refresh(); }, 120);
  }

  function elementForNode(node) {
    return node instanceof Element ? node : node?.parentElement || null;
  }

  function isStowUiElement(element) {
    return !!element && (
      element.matches?.('[data-vm-safe-ui="1"]')
      || !!element.closest?.('[data-vm-safe-ui="1"]')
    );
  }

  function mutationIsOnlyStowUi(record) {
    const target = elementForNode(record.target);
    const changed = [...record.addedNodes, ...record.removedNodes];
    if (!changed.length) return isStowUiElement(target);
    return changed.every(node => isStowUiElement(elementForNode(node)));
  }

  function mutationTouchesFcliteInventory(record) {
    const selector = '.fcrlite-card[data-endpoint="inventory"]';
    const touches = element => !!element && (
      element.matches?.(selector)
      || !!element.closest?.(selector)
      || !!element.querySelector?.(selector)
    );
    if (touches(elementForNode(record.target))) return true;
    return [...record.addedNodes, ...record.removedNodes].some(node => touches(elementForNode(node)));
  }

  function mutationNeedsRefresh(records) {
    const lite = isFcliteSurface();
    for (const record of records) {
      if (mutationIsOnlyStowUi(record)) continue;
      if (lite) {
        if (mutationTouchesFcliteInventory(record)) return true;
        continue;
      }

      const target = record.target instanceof Element ? record.target : record.target?.parentElement;
      if (target?.closest?.('[data-fcr-tool-ui="1"]')) continue;
      if (!record.addedNodes.length && !record.removedNodes.length) return true;
      for (const nodes of [record.addedNodes, record.removedNodes]) {
        for (const node of nodes) {
          const element = node instanceof Element ? node : node.parentElement;
          if (!element?.closest?.('[data-fcr-tool-ui="1"]')) return true;
        }
      }
    }
    return false;
  }

  const start = () => {
    usage('open');
    refresh();
    const observer = new MutationObserver(records => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        lastSussySignature = '';
        lastSussyTable = null;
        sussyRun++;
        scheduleRefresh();
        return;
      }
      if (mutationNeedsRefresh(records)) scheduleRefresh();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
