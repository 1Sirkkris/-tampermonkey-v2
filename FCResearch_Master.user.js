// ==UserScript==
// @name         TEST v0.1.16 FCResearch Master — Saved Section Toggles
// @namespace    https://github.com/1Sirkkris
// @version      0.1.16
// @description  TEST: Clean FCResearch Master using shared FCR Data Core with saved inline native section request controls.
// @include      /^https?:\/\/.*fcresearch.*\//
// @include      /^https?:\/\/qifcr\.fe\.aftx\.amazonoperations\.app\//
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/FCResearch_Master.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/FCResearch_Master.user.js
// ==/UserScript==

(() => {
  'use strict';

  if (window.__fcrMasterCore_v018test || location.hash.startsWith('#fcr-tote-checker')) return;
  window.__fcrMasterCore_v018test = true;

  const VERSION = '0.1.16';
  const PAGE_WINDOW = typeof unsafeWindow === 'object' && unsafeWindow ? unsafeWindow : window;
  const FCRLITE_SECTION_RENDERED_EVENT = 'fcrlite:section-rendered';
  const UI_ATTR = 'data-fcr-master-ui';
  const UI_SELECTOR = `[${UI_ATTR}]`;
  const MAX_PARALLEL = 8;
  const SIDELINE_CONTAINER_KEY = 'fcr_sideline_container';
  const SIDELINE_CONTAINER_TIME_KEY = 'fcr_sideline_container_saved_at';
  const SIDELINE_CONTAINER_MAX_AGE = 24 * 60 * 60 * 1000;
  const SECTION_LOAD_PREFS_KEY = 'fcrm_native_section_load_v1';
  const SECTION_LOAD_PREF_KEY_PREFIX = 'fcrm_native_section_load_v2.';
  const SECTION_LOAD_RECORD_KEY_PREFIX = 'fcrm_native_section_load_v3.';
  const SECTION_LOAD_STYLE_ID = 'fcrm-section-load-visibility';
  const SECTION_LOAD_TOGGLE_ATTR = 'data-fcrm-section-toggle';
  const SECTION_LOAD_ROW_ATTR = 'data-fcrm-section-row';
  const SECTION_LOAD_XHR = new WeakMap();
  const SECTION_DEFS = [
    ['product', 'Product'],
    ['inventory', 'Inventory'],
    ['inventory-history', 'Inventory History'],
    ['container-history', 'Container History'],
    ['purchase-order-item', 'Purchase Order Items'],
    ['purchase-order', 'Purchase Order'],
    ['receive-history', 'Receive History'],
    ['shipment', 'Shipment'],
    ['container-hierarchy', 'Container Details'],
    ['employee', 'Employee'],
    ['carton-general-info', 'Carton General Information'],
    ['carton-contents', 'Carton Contents'],
    ['sscc-info', 'SSCC Information'],
    ['carton-ambiguities', 'Items in Multiple Cartons'],
    ['vision-tunnel', 'Vision Tunnel'],
    ['problems', 'Problems'],
    ['problem', 'Problem'],
    ['event', 'Events'],
    ['authenticity-item', 'Authenticity Item']
  ].map(([endpoint, label]) => ({ endpoint, label }));
  const SECTION_ENDPOINTS = new Set(SECTION_DEFS.map(def => def.endpoint));

  const LEVEL_COLORS = [
    'rgb(153,153,153)',
    'rgb(51,204,2)',
    'rgb(255,225,3)',
    'rgb(255,191,3)',
    'rgb(255,128,2)',
    'rgb(255,64,1)',
    'rgb(237,7,0)',
    'rgb(173,3,222)',
    'rgb(51,51,255)'
  ];

  const $ = (selector, root = document) => {
    try { return root.querySelector(selector); } catch { return null; }
  };
  const $$ = (selector, root = document) => {
    try { return [...root.querySelectorAll(selector)]; } catch { return []; }
  };
  const clean = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const norm = value => clean(value).toLowerCase();

  function nativeSectionMode() {
    return /\/results(?:\/|$)/i.test(location.pathname)
      && !location.hash.startsWith('#fcr-lite')
      && !location.hash.startsWith('#fcr-tote-checker');
  }

  function loadSectionLoadPrefs() {
    const prefs = Object.fromEntries(SECTION_DEFS.map(def => [def.endpoint, true]));
    let legacy = null;
    try {
      legacy = GM_getValue(SECTION_LOAD_PREFS_KEY, null);
      if (typeof legacy === 'string') legacy = JSON.parse(legacy);
    } catch {}
    for (const def of SECTION_DEFS) {
      const recordKey = `${SECTION_LOAD_RECORD_KEY_PREFIX}${def.endpoint}`;
      let localRecord = null;
      let gmRecord = null;
      let saved = null;
      try { localRecord = parseSectionLoadRecord(localStorage.getItem(recordKey)); } catch {}
      try { gmRecord = parseSectionLoadRecord(GM_getValue(recordKey, null)); } catch {}
      const record = !localRecord ? gmRecord
        : !gmRecord ? localRecord
          : localRecord.savedAt >= gmRecord.savedAt ? localRecord : gmRecord;
      try { saved = GM_getValue(`${SECTION_LOAD_PREF_KEY_PREFIX}${def.endpoint}`, null); } catch {}
      if (record) prefs[def.endpoint] = record.enabled;
      else if (typeof saved === 'boolean') prefs[def.endpoint] = saved;
      else if (typeof legacy?.[def.endpoint] === 'boolean') prefs[def.endpoint] = legacy[def.endpoint];
    }
    return prefs;
  }

  function parseSectionLoadRecord(value) {
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch { return null; }
    }
    if (!value || typeof value !== 'object' || typeof value.enabled !== 'boolean') return null;
    return {
      enabled: value.enabled,
      savedAt: Number.isFinite(Number(value.savedAt)) ? Number(value.savedAt) : 0
    };
  }

  let sectionLoadSaveStamp = Date.now();

  function saveSectionLoadPref(endpoint, enabled) {
    if (!SECTION_ENDPOINTS.has(endpoint)) return false;
    sectionLoadSaveStamp = Math.max(Date.now(), sectionLoadSaveStamp + 1);
    const key = `${SECTION_LOAD_RECORD_KEY_PREFIX}${endpoint}`;
    const record = { enabled: enabled !== false, savedAt: sectionLoadSaveStamp };
    let localSaved = false;
    let gmSaved = false;
    try {
      localStorage.setItem(key, JSON.stringify(record));
      const stored = parseSectionLoadRecord(localStorage.getItem(key));
      localSaved = stored?.enabled === record.enabled && stored.savedAt === record.savedAt;
    } catch {}
    try {
      GM_setValue(key, record);
      const stored = parseSectionLoadRecord(GM_getValue(key, null));
      gmSaved = stored?.enabled === record.enabled && stored.savedAt === record.savedAt;
    } catch {}
    return localSaved || gmSaved;
  }

  function sectionLoadEnabled(endpoint) {
    return sectionLoadPrefs[endpoint] !== false;
  }

  function sectionEndpointFromUrl(rawUrl) {
    let url;
    try { url = new URL(String(rawUrl || ''), location.href); } catch { return ''; }
    const host = url.hostname.toLowerCase();
    if (!host.includes('fcresearch') && host !== 'qifcr.fe.aftx.amazonoperations.app') return '';
    const match = url.pathname.match(/\/results\/([^/?#]+)/i);
    if (!match) return '';
    const endpoint = clean(decodeURIComponent(match[1])).toLowerCase();
    return SECTION_ENDPOINTS.has(endpoint) ? endpoint : '';
  }

  function installNativeSectionBlocker() {
    const XHR = PAGE_WINDOW.XMLHttpRequest;
    if (!XHR?.prototype || XHR.prototype.__fcrmNativeSectionBlockerV1) return;
    const originalOpen = XHR.prototype.open;
    const originalSend = XHR.prototype.send;

    XHR.prototype.open = function(method, url) {
      const endpoint = sectionEndpointFromUrl(url);
      SECTION_LOAD_XHR.set(this, endpoint ? {
        endpoint,
        method: String(method || 'GET').toUpperCase()
      } : null);
      return originalOpen.apply(this, arguments);
    };

    XHR.prototype.send = function() {
      const info = SECTION_LOAD_XHR.get(this);
      if (info && nativeSectionMode() && !sectionLoadEnabled(info.endpoint)) {
        usage(`section.blocked.${info.endpoint}`);
        try {
          window.dispatchEvent(new CustomEvent('fcrm:section-blocked', {
            detail: JSON.stringify({ endpoint: info.endpoint, method: info.method })
          }));
        } catch {}
        return undefined;
      }
      return originalSend.apply(this, arguments);
    };

    Object.defineProperty(XHR.prototype, '__fcrmNativeSectionBlockerV1', {
      value: true,
      configurable: true
    });
  }

  let sectionLoadPrefs = loadSectionLoadPrefs();
  let sectionLoadDraft = { ...sectionLoadPrefs };
  const sectionLoadSaveStatus = Object.create(null);
  installNativeSectionBlocker();

  window.addEventListener('storage', event => {
    if (!event.key?.startsWith(SECTION_LOAD_RECORD_KEY_PREFIX)) return;
    const endpoint = event.key.slice(SECTION_LOAD_RECORD_KEY_PREFIX.length);
    const record = parseSectionLoadRecord(event.newValue);
    if (!SECTION_ENDPOINTS.has(endpoint) || !record) return;
    sectionLoadDraft[endpoint] = record.enabled;
    sectionLoadSaveStatus[endpoint] = 'saved';
    renderSectionLoadControls();
  });


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
      window.dispatchEvent(new CustomEvent(CORE_REQUEST_EVENT, { detail: JSON.stringify({ id, type, payload, client: 'master' }) }));
    });
  }


  function usage(key, ms = 0, count = 1) {
    window.dispatchEvent(new CustomEvent('fcr-usage:event', {
      detail: JSON.stringify({ key: 'master.' + key, ms, count })
    }));
  }


  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const debounce = (fn, ms) => {
    let timer = 0;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  };
  const escapeHtml = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const stripDelimiters = value => String(value ?? '').replace(/[\s-]/g, '').trim();
  const normalisePrintCode = value => stripDelimiters(value);
  const normaliseAsin = value => stripDelimiters(value).toUpperCase();
  const upperForCompare = value => normalisePrintCode(value).toUpperCase();
  const isAsin = value => /^[A-Z0-9]{10}$/i.test(clean(value));
  const clampLevel = value => Math.max(0, Math.min(8, Number(value) || 0));
  const getCookie = name => (document.cookie.split('; ').find(row => row.startsWith(`${name}=`)) || '').split('=')[1] || '';
  const asciiHex = value => Array.from(String(value ?? '')).map(char => char.charCodeAt(0).toString(16)).join('');

  function markUi(element) {
    if (element) { element.setAttribute(UI_ATTR, ''); element.dataset.fcrToolUi = '1'; }
    return element;
  }


  function selectionTouchesNode(selection, node) {
    if (!selection || !node) return false;
    for (let index = 0; index < selection.rangeCount; index++) {
      try {
        if (selection.getRangeAt(index).intersectsNode(node)) return true;
      } catch {}
    }
    return false;
  }

  function setBusyButton(button, busy, busyText = 'Working…') {
    if (!button) return;
    if (busy) {
      if (!button.dataset.fcrmOriginalText) button.dataset.fcrmOriginalText = button.textContent || '';
      button.disabled = true;
      button.textContent = busyText;
    } else {
      button.disabled = false;
      button.textContent = button.dataset.fcrmOriginalText || button.textContent;
      delete button.dataset.fcrmOriginalText;
    }
  }

  function injectStyles() {
    if ($('#fcrm-clean-style')) return;
    const style = document.createElement('style');
    style.id = 'fcrm-clean-style';
    style.textContent = `
      [${UI_ATTR}], [${UI_ATTR}] * { box-sizing:border-box; }
      td.poch__unfilled { background:rgba(255,193,7,.28)!important; box-shadow:inset 0 0 0 2px rgba(255,180,0,.50); font-weight:600; }
      td.poch__cancelled { background:rgba(220,53,69,.24)!important; box-shadow:inset 0 0 0 2px rgba(220,53,69,.45); font-weight:600; }
      td.poch__band { background:rgba(255,0,0,.14)!important; box-shadow:inset 0 0 0 1px rgba(255,0,0,.22); color:#5a0000; }
      td.poch__dateold { background:rgba(255,0,0,.22)!important; box-shadow:inset 0 0 0 1px rgba(255,0,0,.38)!important; font-weight:700; color:#6a0000; }
      .fcrm-inline { display:inline-flex; align-items:center; gap:7px; margin-left:8px; vertical-align:middle; }
      .fcrm-qty { width:3.35ch; min-width:30px; height:17px; padding:0 2px; text-align:center; border:1px solid transparent; border-radius:4px; background:transparent; color:transparent; caret-color:transparent; font:12px Arial,sans-serif; opacity:.20; appearance:textfield; }
      .fcrm-qty:hover { opacity:.28; }
      .fcrm-qty:focus { color:#111827; caret-color:#111827; opacity:1; outline:none; background:rgba(120,138,160,.04); border-color:rgba(60,72,88,.12); }
      .fcrm-qty::-webkit-outer-spin-button,.fcrm-qty::-webkit-inner-spin-button { -webkit-appearance:none; margin:0; }
      .fcrm-stealth-trigger { display:inline; padding:0; margin:0; border:0; background:transparent; color:rgba(0,0,0,.72); font:inherit; font-weight:inherit; cursor:pointer; white-space:nowrap; user-select:text; }
      .fcrm-stealth-trigger:hover { text-decoration:underline; }
      .fc-hazmat,.fc-badge,.fc-madcat-badge,.fc-size-badge { display:inline-flex; align-items:center; padding:2px 8px; border-radius:12px; font:800 12px/1.4 Arial,sans-serif; color:#000; vertical-align:middle; }
      .fc-hazmat { margin-left:9px; user-select:none; pointer-events:none; }
      .fc-hazmat.fc-river-l0 { pointer-events:auto; cursor:pointer; }
      .fc-hazmat.fc-river-l0:hover { text-decoration:underline; }
      .fc-hazmat.fc-river-l0[aria-busy="true"] { cursor:wait; opacity:.72; }
      .fc-badge { margin-left:6px; user-select:none; pointer-events:none; }
      .fc-madcat-badge { margin-left:8px; user-select:none; }
      .fcrm-madcat-yes { background:#ffff00; }
      .fcrm-madcat-no { background:#ff0000; }
      .fcrm-madcat-loading { background:#d9d9d9; }
      .fcrm-madcat-hit { background:#ffcc00!important; color:#000!important; font-weight:700!important; }
      .fc-size-badge { gap:5px; margin-left:6px; background:#e5e7eb; color:#111827; user-select:none; }
      .fcrm-size-error { background:#fee2e2; color:#991b1b; }
      .fcrm-size-change { border:0; padding:0 2px; background:transparent; color:#4b5563; font:700 11px Arial; cursor:pointer; }
      .fcrm-size-change:hover { color:#111827; text-decoration:underline; }
      .fcrm-haz-refresh { margin-left:8px; padding:4px 9px; cursor:pointer; border-radius:3px; border:1px solid #888; background:#eee; font:12px Arial,sans-serif; }
      .fcrm-haz-refresh:hover { background:#ddd; }
      .fcrm-prop-label { background:#3f5973!important; color:#fff!important; }
      .fcrm-prop-true { background:#359933!important; }
      .fcrm-prop-false { background:#a73225!important; }
      #fcrlite-sections-app .fcrm-prop-true { background:#e2f2e4!important; color:#14532d!important; box-shadow:inset 4px 0 #2f7d32; }
      #fcrlite-sections-app .fcrm-prop-false { background:#f7e2de!important; color:#7f1d1d!important; box-shadow:inset 4px 0 #a73225; }
      [${SECTION_LOAD_ROW_ATTR}] { position:relative!important; padding-right:29px!important; min-height:20px; }
      [${SECTION_LOAD_TOGGLE_ATTR}] { position:absolute; top:50%; right:4px; z-index:3; width:20px; min-width:20px; height:18px; padding:0; transform:translateY(-50%); border:1px solid #64748b; border-radius:4px; background:#e5e7eb; color:#111827; font:800 11px/16px Arial,sans-serif; text-align:center; cursor:pointer; }
      [${SECTION_LOAD_TOGGLE_ATTR}][aria-pressed="true"] { border-color:#2563eb; background:#dbeafe; color:#1e3a8a; }
      [${SECTION_LOAD_TOGGLE_ATTR}][data-save-state="error"] { border-color:#b91c1c!important; background:#fee2e2!important; color:#991b1b!important; }
      [${SECTION_LOAD_TOGGLE_ATTR}]:hover { filter:brightness(.95); }
      [${UI_ATTR}], [${UI_ATTR}] * { -webkit-user-select:none!important; -moz-user-select:none!important; user-select:none!important; }
      [${UI_ATTR}]::selection, [${UI_ATTR}] *::selection { background:transparent!important; color:inherit!important; }
    `;
    document.documentElement.appendChild(style);
  }

  function syncNativeSectionVisibility() {
    const html = document.documentElement;
    if (!html) return;
    if (nativeSectionMode()) html.dataset.fcrmNativeSections = '1';
    else delete html.dataset.fcrmNativeSections;

    let style = document.getElementById(SECTION_LOAD_STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = SECTION_LOAD_STYLE_ID;
      document.documentElement.appendChild(style);
    }
    const disabled = SECTION_DEFS.filter(def => !sectionLoadEnabled(def.endpoint));
    style.textContent = disabled.map(def =>
      `html[data-fcrm-native-sections="1"] [data-section-type="${def.endpoint}"]{display:none!important;}`
    ).join('\n');
  }

  function visibleRect(element) {
    try {
      const rect = element?.getBoundingClientRect?.();
      return rect && rect.width > 0 && rect.height > 0 ? rect : null;
    } catch { return null; }
  }

  function findNativeSectionsHeading() {
    return $$('h1,h2,h3,h4,h5,h6,strong,span,div')
      .filter(element => !element.closest(UI_SELECTOR) && norm(element.textContent) === 'sections')
      .map(element => ({ element, rect: visibleRect(element) }))
      .filter(item => item.rect && item.rect.left > window.innerWidth * 0.55)
      .sort((a, b) => b.rect.left - a.rect.left || a.rect.width - b.rect.width)[0]?.element || null;
  }

  function exactSectionTextNodes(root, label) {
    const wanted = norm(label);
    return $$('a,button,[role="button"],li,span,div,p', root).filter(element => {
      if (element.closest(UI_SELECTOR) || norm(element.textContent) !== wanted) return false;
      return !$$(':scope > a,:scope > button,:scope > [role="button"],:scope > li,:scope > span,:scope > div,:scope > p', element)
        .some(child => norm(child.textContent) === wanted);
    });
  }

  function findNativeSectionsHost(heading) {
    for (let host = heading?.parentElement; host && host !== document.body; host = host.parentElement) {
      const matches = SECTION_DEFS.reduce((count, def) => count + (exactSectionTextNodes(host, def.label).length ? 1 : 0), 0);
      if (matches >= 8) return host;
    }
    return null;
  }

  function sectionLabelNode(host, def) {
    return exactSectionTextNodes(host, def.label)
      .map(element => ({ element, rect: visibleRect(element) }))
      .filter(item => item.rect)
      .sort((a, b) => b.rect.left - a.rect.left || a.rect.width - b.rect.width)[0]?.element || null;
  }

  function sectionRowNode(labelNode, host) {
    if (!labelNode) return null;
    const wanted = norm(labelNode.textContent);
    let row = labelNode;
    while (row.parentElement && row.parentElement !== host && norm(row.parentElement.textContent) === wanted) {
      const rect = visibleRect(row.parentElement);
      if (!rect || rect.height > 64) break;
      row = row.parentElement;
    }
    if (/^(A|BUTTON)$/.test(row.tagName) && row.parentElement && row.parentElement !== host) row = row.parentElement;
    return row;
  }

  function renderSectionLoadControls() {
    $$(`[${SECTION_LOAD_TOGGLE_ATTR}]`).forEach(button => {
      const endpoint = button.dataset.endpoint;
      if (!SECTION_ENDPOINTS.has(endpoint)) return;
      const enabled = sectionLoadDraft[endpoint] !== false;
      const saveError = sectionLoadSaveStatus[endpoint] === 'error';
      button.textContent = saveError ? '!' : enabled ? '✓' : '×';
      button.setAttribute('aria-pressed', String(enabled));
      button.dataset.saveState = saveError ? 'error' : 'saved';
      button.title = saveError
        ? `${button.dataset.label}: SAVE FAILED — selection unchanged`
        : `${button.dataset.label}: ${enabled ? 'ON' : 'OFF'} — saved; refresh FCResearch to apply`;
      button.setAttribute('aria-label', button.title);
    });
  }

  function ensureInlineSectionToggles(host) {
    for (const def of SECTION_DEFS) {
      const label = sectionLabelNode(host, def);
      const row = sectionRowNode(label, host);
      if (!row) continue;
      row.setAttribute(SECTION_LOAD_ROW_ATTR, def.endpoint);
      let button = $(`:scope > [${SECTION_LOAD_TOGGLE_ATTR}]`, row);
      if (!button) {
        button = markUi(document.createElement('button'));
        button.type = 'button';
        button.setAttribute(SECTION_LOAD_TOGGLE_ATTR, '');
        button.dataset.endpoint = def.endpoint;
        button.dataset.label = def.label;
        button.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          const previous = sectionLoadDraft[def.endpoint] !== false;
          const enabled = sectionLoadDraft[def.endpoint] === false;
          const saved = saveSectionLoadPref(def.endpoint, enabled);
          sectionLoadDraft[def.endpoint] = saved ? enabled : previous;
          sectionLoadSaveStatus[def.endpoint] = saved ? 'saved' : 'error';
          renderSectionLoadControls();
          button.blur();
        });
        row.appendChild(button);
      }
    }
  }

  function ensureSectionLoadControls() {
    syncNativeSectionVisibility();
    if (!nativeSectionMode()) {
      $$(`[${SECTION_LOAD_TOGGLE_ATTR}]`).forEach(button => button.remove());
      $$(`[${SECTION_LOAD_ROW_ATTR}]`).forEach(row => row.removeAttribute(SECTION_LOAD_ROW_ATTR));
      return;
    }
    if (!document.body) return;
    const heading = findNativeSectionsHeading();
    const host = findNativeSectionsHost(heading);
    if (heading && host) ensureInlineSectionToggles(host);
    renderSectionLoadControls();
  }

  function poIntFrom(cell) {
    const raw = cell?.querySelector?.("input,[contenteditable='true']")?.value ?? cell?.textContent ?? '';
    const match = String(raw).replace(/[, ]+/g, '').match(/-?\d+/);
    return match ? parseInt(match[0], 10) : 0;
  }

  function poDateFromCell(cell) {
    const raw = clean(cell?.textContent || '');
    const match = raw.match(/(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/);
    if (!match) return null;
    return new Date(+match[1], +match[2] - 1, +match[3], +(match[4] || 0), +(match[5] || 0), +(match[6] || 0));
  }

  function poIndexes(head) {
    const headers = $$(':scope > thead th, :scope > thead td, :scope > tr th', head)
      .map(cell => norm(cell.textContent).replace(/\(.*?\)/g, '').trim());
    return {
      idxU: headers.findIndex(value => value.includes('unfilled')),
      idxC: headers.findIndex(value => value.includes('canceled') || value.includes('cancelled')),
      idxDate: headers.findIndex(value => value.includes('order date') || value === 'date')
    };
  }

  function paintPurchaseOrders(body, idxU, idxC, idxDate) {
    if (!body?.isConnected) return;
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const sevenMonthsAgo = new Date();
    sevenMonthsAgo.setMonth(sevenMonthsAgo.getMonth() - 7);
    const tableBody = body.tBodies[0] || body;

    for (const row of tableBody.rows) {
      const cells = row.cells;
      for (const cell of cells) cell.classList?.remove('poch__unfilled', 'poch__cancelled', 'poch__dateold', 'poch__band');

      const dateCell = idxDate >= 0 ? cells[idxDate] : null;
      const date = dateCell ? poDateFromCell(dateCell) : null;
      if (date && date < sixMonthsAgo) {
        for (let offset = 0; offset <= 2; offset++) cells[idxDate - offset]?.classList.add('poch__band');
      }
      if (dateCell && date && date < sevenMonthsAgo) dateCell.classList.add('poch__dateold');

      const unfilledCell = idxU >= 0 ? cells[idxU] : null;
      if (unfilledCell?.tagName === 'TD' && poIntFrom(unfilledCell) > 0) unfilledCell.classList.add('poch__unfilled');

      const cancelledCell = idxC >= 0 ? cells[idxC] : null;
      if (cancelledCell?.tagName === 'TD' && poIntFrom(cancelledCell) > 0) cancelledCell.classList.add('poch__cancelled');
    }
  }

  function refreshPurchaseOrderHighlighter() {
    const body = $('table#table-purchase-order-item');
    if (!body) return;
    const wrap = body.closest('div.dataTables_scroll');
    const head = wrap?.querySelector('.dataTables_scrollHead thead')?.closest('table') || body;
    const { idxU, idxC, idxDate } = poIndexes(head);
    if (idxU < 0 && idxC < 0 && idxDate < 0) return;
    paintPurchaseOrders(body, idxU, idxC, idxDate);
  }

  function findProductTable() {
    return $('[data-section-type="product"] table') || $('div [data-section-type="product"] .a-keyvalue');
  }

  function cleanProductCell(cell) {
    if (!cell) return { text: '', href: '' };
    const anchor = $('a', cell);
    const href = anchor?.href || anchor?.getAttribute('href') || '';
    const anchorText = clean(anchor?.textContent || anchor?.innerText || '');
    const clone = cell.cloneNode(true);
    $$(UI_SELECTOR, clone).forEach(node => node.remove());
    $$('.fc-inline,.fc-print-controls,.fc-qty,.fc-hazmat,.fc-haz-refresh,.fc-pill,.fc-badge,.fc-madcat-badge,.fc-size-badge,.fc-bin-btn', clone).forEach(node => node.remove());
    $$('button,input', clone).forEach(node => node.remove());
    return { text: clean(anchorText || clone.textContent || cell.textContent || ''), href };
  }

  function readProductPanel() {
    const table = findProductTable();
    if (!table) return null;
    const rows = new Map();
    for (const row of $$('tr', table)) {
      const labelCell = $('th', row) || row.cells?.[0];
      const valueCell = $('td', row) || row.cells?.[1] || row.lastElementChild;
      if (!labelCell || !valueCell) continue;
      const label = clean(labelCell.textContent || labelCell.innerText || '');
      if (!label) continue;
      rows.set(norm(label), { row, labelCell, valueCell, label, ...cleanProductCell(valueCell) });
    }
    const get = (...labels) => {
      for (const label of labels) {
        const entry = rows.get(norm(label));
        if (entry) return entry;
      }
      return null;
    };
    const asin = get('ASIN');
    const isbn = get('ISBN');
    const fnsku = get('FNSku', 'FNSKU');
    const fcsku = get('FcSku', 'FCSKU');
    const title = get('Title');
    const dimensions = get('Dimensions');
    const primary = asin || isbn;
    const primaryId = normaliseAsin(primary?.text || '');
    const fnskuId = clean(fnsku?.text || '').match(/\b(?:X0|ZZ)[A-Z0-9]{8}\b/i)?.[0] || '';
    const signature = `${primaryId}|${fnskuId.toUpperCase()}|${clean(title?.text || '')}`;
    return { table, rows, get, asin, isbn, fnsku, fcsku, title, dimensions, primary, primaryId, fnskuId, signature };
  }

  function getInventoryTable() {
    return $('.dataTables_scrollBody table#table-inventory') || $('table#table-inventory');
  }

  function getInventoryRows(table = getInventoryTable()) {
    if (!table?.tBodies?.[0]) return [];
    return $$('tr[data-row-id]', table.tBodies[0]);
  }

  function getWarehouseId() {
    return clean($('.warehouse-id')?.textContent || '');
  }

  function normaliseHeader(value) {
    return norm(String(value ?? '').replace(/\(\d+\)/g, ''));
  }

  function findColumnIndex(table, patterns) {
    if (!table) return -1;
    const wrapper = table.closest('.dataTables_scroll,.dataTables_wrapper') || table.parentElement;
    const headerTable = $('.dataTables_scrollHead table', wrapper) || table;
    const headers = $$('thead th', headerTable);
    return headers.findIndex(header => {
      const text = normaliseHeader(header.textContent || header.innerText || '');
      return text && patterns.some(pattern => pattern.test(text));
    });
  }

  function cleanCodeForLabel(label, value) {
    const text = clean(value);
    if (/^(ASIN|ISBN)$/i.test(label)) return text.match(/\b[A-Z0-9]{10}\b/i)?.[0]?.toUpperCase() || text;
    if (/^(FNSku|FcSku)$/i.test(label)) return text.match(/\b(?:X0|ZZ)[A-Z0-9]{8}\b/i)?.[0]?.toUpperCase() || text.match(/\b[A-Z0-9]{10}\b/i)?.[0]?.toUpperCase() || text;
    return text;
  }

  function htmlValue(value) {
    const text = escapeHtml(value?.text || '');
    return value?.href ? `<a href="${escapeHtml(value.href)}">${text}</a>` : text;
  }

  function directCodeFromDirtySelection(rawText) {
    const text = clean(rawText);
    if (!text || /^(ASIN|ISBN|FNSku|FcSku|Title)\b/i.test(text)) return '';
    const match = text.match(/^([A-Z0-9]{10}|(?:X0|ZZ)[A-Z0-9]{8})(?=\s*(?:Madcat:|Size:|Pandash|L\d+|✅|🚫|☑|✔|✘|❌))/i);
    return match?.[1]?.toUpperCase() || '';
  }

  function installCopyCleaner() {
    document.addEventListener('copy', event => {
      const selection = window.getSelection?.();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
      const panel = readProductPanel();
      if (!panel || !selectionTouchesNode(selection, panel.table)) return;
      const raw = String(selection.toString() || '');
      const hasInjectedText = /(madcat:|size:|pandash|\bL\d+\b|✅|🚫)/i.test(clean(raw));
      const selectedUi = $$(UI_SELECTOR, panel.table).some(node => selectionTouchesNode(selection, node));
      const directCode = directCodeFromDirtySelection(raw);
      if (directCode) {
        const anchor = $$('a', panel.table).find(link => clean(link.textContent).toUpperCase() === directCode && selectionTouchesNode(selection, link));
        const value = { text: directCode, href: anchor?.href || anchor?.getAttribute('href') || '' };
        event.preventDefault();
        event.stopPropagation();
        event.clipboardData.setData('text/plain', value.text);
        event.clipboardData.setData('text/html', htmlValue(value));
        return;
      }
      const output = [];
      for (const entry of panel.rows.values()) {
        if (!/^(ASIN|ISBN|FNSku|FcSku|Title)$/i.test(entry.label)) continue;
        const labelTouched = selectionTouchesNode(selection, entry.labelCell);
        const valueTouched = selectionTouchesNode(selection, entry.valueCell);
        if (!labelTouched && !valueTouched) continue;
        if (/^Title$/i.test(entry.label) && valueTouched && !labelTouched && !hasInjectedText && !selectedUi) return;
        if (!/^(ASIN|ISBN|FNSku|FcSku)$/i.test(entry.label) && !labelTouched && !hasInjectedText && !selectedUi) continue;
        const rawValue = cleanProductCell(entry.valueCell);
        const value = { text: cleanCodeForLabel(entry.label, rawValue.text), href: rawValue.href };
        output.push({ mode: labelTouched && valueTouched ? 'row' : labelTouched ? 'label' : 'value', label: entry.label, value });
      }
      if (!output.length) return;
      const onlyValues = output.every(item => item.mode === 'value');
      const onlyLabels = output.every(item => item.mode === 'label');
      let text;
      let html;
      if (onlyValues) {
        text = output.map(item => item.value.text).join('\n');
        html = output.map(item => htmlValue(item.value)).join('<br>');
      } else if (onlyLabels) {
        text = output.map(item => item.label).join('\n');
        html = output.map(item => escapeHtml(item.label)).join('<br>');
      } else {
        text = output.map(item => item.mode === 'row' ? `${item.label} \t${item.value.text}` : item.mode === 'value' ? item.value.text : item.label).join('\n');
        html = `<table><tbody>${output.map(item => item.mode === 'row' ? `<tr><td>${escapeHtml(item.label)}&nbsp;</td><td>${htmlValue(item.value)}</td></tr>` : item.mode === 'value' ? `<tr><td>${htmlValue(item.value)}</td></tr>` : `<tr><td>${escapeHtml(item.label)}</td></tr>`).join('')}</tbody></table>`;
      }
      event.preventDefault();
      event.stopPropagation();
      event.clipboardData.setData('text/plain', text);
      event.clipboardData.setData('text/html', html);
    }, true);
  }

  const PROPERTY_LABELS = ['Sortable', 'Very High Value', 'Conveyable', 'Master Case'];

  function applyProductHighlights(panel) {
    if (!panel) return;
    for (const label of PROPERTY_LABELS) {
      const entry = panel.get(label);
      if (!entry) continue;
      entry.labelCell.classList.add('fcrm-prop-label');
      entry.valueCell.classList.remove('fcrm-prop-true', 'fcrm-prop-false');
      entry.valueCell.classList.add(norm(entry.text) === 'true' ? 'fcrm-prop-true' : 'fcrm-prop-false');
    }
  }

  function badgeHost(panel) {
    return panel?.dimensions?.valueCell || panel?.primary?.valueCell || null;
  }

  function ensureMadcatBadge(panel) {
    const host = badgeHost(panel);
    if (!host) return null;
    let badge = $('.fc-madcat-badge', host);
    if (!sectionLoadEnabled('inventory-history')) {
      badge?.remove();
      return null;
    }
    if (!badge) {
      badge = markUi(document.createElement('span'));
      badge.className = 'fc-madcat-badge fcrm-madcat-loading';
      badge.textContent = 'Madcat: Loading…';
      host.appendChild(badge);
    }
    return badge;
  }

  function findInventoryHistoryContainer() {
    for (const selector of ['[data-section-type="inventory-history"]','[data-test-id*="inventory-history"]','[id*="inventory-history"]']) {
      const match = $(selector);
      if (match) return match;
    }
    for (const heading of $$('h1,h2,h3,h4,h5,h6')) {
      if (!/inventory history/i.test(clean(heading.textContent))) continue;
      return heading.closest('[data-section-type],.a-box,section') || heading.parentElement;
    }
    for (const table of $$('table')) {
      const text = clean(table.textContent);
      if (/inventory history/i.test(text) && /madcat|date|event|action/i.test(text)) return table.closest('[data-section-type],.a-box,section') || table;
    }
    return null;
  }

  function updateMadcat(panel) {
    if (!sectionLoadEnabled('inventory-history')) {
      $('.fc-madcat-badge', badgeHost(panel))?.remove();
      return;
    }
    const badge = ensureMadcatBadge(panel);
    if (!badge) return;
    const container = findInventoryHistoryContainer();
    if (!container) {
      badge.className = 'fc-madcat-badge fcrm-madcat-loading';
      badge.textContent = 'Madcat: Loading…';
      return;
    }
    const found = /madcat/i.test(clean(container.textContent));
    badge.className = `fc-madcat-badge ${found ? 'fcrm-madcat-yes' : 'fcrm-madcat-no'}`;
    badge.textContent = `Madcat: ${found ? 'Yes' : 'No'}`;
    $$('.fcrm-madcat-hit', container).forEach(row => row.classList.remove('fcrm-madcat-hit'));
    if (found) $$('tr', container).filter(row => /madcat/i.test(clean(row.textContent))).forEach(row => row.classList.add('fcrm-madcat-hit'));
  }

  const sizeState = { item: '', lastGood: '', busy: false, serial: 0 };

  function isValidSidelineContainer(value) { return /^(?:csX|tsX)[A-Za-z0-9]+$/i.test(clean(value)); }
  function isValidSidelineItem(value) { return /^(?:B[A-Z0-9]{9}|X[A-Z0-9]{9}|\d{8,14})$/i.test(clean(value)); }
  function clearSavedSidelineContainer() { GM_setValue(SIDELINE_CONTAINER_KEY, ''); GM_setValue(SIDELINE_CONTAINER_TIME_KEY, 0); }

  function getSavedSidelineContainer() {
    const value = clean(GM_getValue(SIDELINE_CONTAINER_KEY, ''));
    const savedAt = Number(GM_getValue(SIDELINE_CONTAINER_TIME_KEY, 0));
    if (!isValidSidelineContainer(value) || !savedAt || Date.now() - savedAt > SIDELINE_CONTAINER_MAX_AGE) {
      clearSavedSidelineContainer();
      return '';
    }
    return value;
  }

  function askSidelineContainer(current = '') {
    const entered = prompt('Enter valid Sideline source container (csX / tsX).\nSaved for 24 hours.', current);
    if (entered === null) return '';
    const value = clean(entered);
    if (!isValidSidelineContainer(value)) { alert('Invalid container. Must begin with csX or tsX.'); return ''; }
    GM_setValue(SIDELINE_CONTAINER_KEY, value);
    GM_setValue(SIDELINE_CONTAINER_TIME_KEY, Date.now());
    return value;
  }

  function currentSidelineItem(panel) {
    const queryValue = clean(new URLSearchParams(location.search).get('s'));
    if (isValidSidelineItem(queryValue)) return queryValue.toUpperCase();
    for (const input of $$('input')) if (isValidSidelineItem(input.value)) return clean(input.value).toUpperCase();
    return [panel?.asin?.text, panel?.isbn?.text, panel?.fnsku?.text, panel?.fcsku?.text].map(clean).find(isValidSidelineItem)?.toUpperCase() || '';
  }


  function ensureSizeBadge(panel) {
    const host = badgeHost(panel);
    if (!host) return null;
    let badge = $('.fc-size-badge', host);
    if (!badge) {
      badge = markUi(document.createElement('span'));
      badge.className = 'fc-size-badge';
      badge.innerHTML = '<span class="fc-size-value">Size: Loading…</span><button type="button" class="fcrm-size-change">Change</button>';
      const change = $('.fcrm-size-change', badge);
      markUi(change);
      change.title = 'Change Sideline source container';
      change.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (askSidelineContainer(getSavedSidelineContainer())) runSizeLookup(readProductPanel(), true);
      });
      host.appendChild(badge);
    }
    return badge;
  }

  function setSizeText(panel, text, error = false) {
    const badge = ensureSizeBadge(panel);
    if (!badge) return;
    const value = $('.fc-size-value', badge);
    if (error && sizeState.lastGood) {
      badge.classList.remove('fcrm-size-error');
      if (value) value.textContent = `Size: ${sizeState.lastGood}`;
      badge.title = `Latest refresh failed: ${text}. Keeping last successful size.`;
      return;
    }
    badge.classList.toggle('fcrm-size-error', error);
    badge.title = '';
    if (value) value.textContent = `Size: ${text}`;
  }


  async function fetchSidelineSize(panel, item, container, force = false) {
    const serial = ++sizeState.serial;
    sizeState.busy = true;
    setSizeText(panel, 'Checking…');
    try {
      const result = await coreRequest('binSize', { container, item });
      if (serial !== sizeState.serial) return;
      const size = clean(result?.size || '');
      if (size) {
        sizeState.lastGood = size;
        setSizeText(panel, sizeState.lastGood, false);
        window.dispatchEvent(new CustomEvent('fcrm:size-resolved', { detail: { item, container, size: sizeState.lastGood, cache: result?.source || 'core' } }));
        return;
      }
      setSizeText(panel, 'No size returned', true);
    } catch (error) {
      if (serial !== sizeState.serial) return;
      const message = error?.message || 'Request failed';
      if (/container|source/i.test(message)) clearSavedSidelineContainer();
      setSizeText(panel, message, true);
    } finally {
      if (serial === sizeState.serial) sizeState.busy = false;
    }
  }

  function runSizeLookup(panel, force = false) {
    if (!panel) return;
    ensureSizeBadge(panel);
    const item = currentSidelineItem(panel);
    if (!item) return;
    if (item !== sizeState.item) {
      sizeState.serial++;
      sizeState.busy = false;
      sizeState.item = item;
      sizeState.lastGood = '';
    } else if (sizeState.busy) return;
    else if (!force) { if (sizeState.lastGood) setSizeText(panel, sizeState.lastGood, false); return; }
    const container = getSavedSidelineContainer();
    if (!container) { setSizeText(panel, 'Set container', true); return; }
    fetchSidelineSize(panel, item, container, force);
  }

  let inventoryRunId = 0;
  let productRunId = 0;

  async function getHazmat(id, force = false) {
    if (!isAsin(id)) return null;
    try {
      const result = await coreRequest('hazmat', { asin: normaliseAsin(id), force });
      const hazmat = result?.hazmat;
      return hazmat ? [Number(hazmat.level || 0), String(hazmat.message || '')] : null;
    } catch {
      return null;
    }
  }

  function renderHazmatBadge(badge, result, { river = false, inventory = false } = {}) {
    if (!badge) return;
    if (!result) {
      badge.style.background = LEVEL_COLORS[0];
      badge.textContent = 'Hazmat N/A';
      badge.classList.remove('fc-river-l0');
      badge.setAttribute('role', 'status');
      badge.removeAttribute('tabindex');
      badge.title = '';
      return;
    }
    const level = clampLevel(result[0]);
    const message = String(result[1] || '');
    badge.style.background = LEVEL_COLORS[level] || LEVEL_COLORS[0];
    badge.textContent = inventory ? `L${level}${message.includes('can be processed') ? ' ✅' : ''}` : `L${level}${message.includes('can be processed') ? ' ✅' : ' 🚫'}`;
    const clickable = river && level === 0;
    badge.classList.toggle('fc-river-l0', clickable);
    badge.setAttribute('role', clickable ? 'button' : 'status');
    if (clickable) { badge.tabIndex = 0; badge.title = 'Create Hazmat RIVER ticket'; }
    else { badge.removeAttribute('tabindex'); badge.title = ''; }
  }

  function ensureProductHazmatUi(panel) {
    const host = panel?.primary?.valueCell;
    if (!host) return null;
    let badge = $('.fc-hazmat', host);
    if (!badge) { badge = markUi(document.createElement('span')); badge.className = 'fc-hazmat'; badge.textContent = 'Loading…'; host.appendChild(badge); }
    let button = $('.fcrm-top-recheck', host);
    if (!button) { button = markUi(document.createElement('button')); button.type = 'button'; button.className = 'fcrm-haz-refresh fcrm-top-recheck'; button.textContent = 'Pandash'; host.appendChild(button); }
    return { badge, button };
  }

  async function updateProductHazmat(panel, force = false) {
    if (!panel?.primaryId) return;
    const ui = ensureProductHazmatUi(panel);
    if (!ui) return;
    const runId = ++productRunId;
    if (!getWarehouseId()) return;
    if (force) setBusyButton(ui.button, true, 'Rechecking…');
    try {
      const result = await getHazmat(panel.primaryId, force);
      if (runId !== productRunId || readProductPanel()?.signature !== panel.signature) return;
      renderHazmatBadge(ui.badge, result, { river: true });
      ui.button.onclick = async () => { const current = readProductPanel(); if (current) await Promise.all([updateProductHazmat(current, true), annotateInventory(true)]); };
    } finally { if (force) setBusyButton(ui.button, false); }
  }

  function findAsinInInventoryRow(row, asinIndex = -1) {
    const cell = asinIndex >= 0 ? row.cells?.[asinIndex] : null;
    const links = cell ? $$('a', cell) : $$('a', row);
    for (const link of links) {
      const match = clean(link.textContent).match(/\b[A-Z0-9]{10}\b/i);
      if (!match) continue;
      const asin = normaliseAsin(match[0]);
      if (isAsin(asin)) return { asin, link };
    }
    return null;
  }

  function ensureInventoryPill(cell) {
    let pill = $('.fcrm-haz-pill', cell);
    if (!pill) {
      pill = markUi(document.createElement('span'));
      pill.className = 'fcrm-haz-pill fcrm-inline';
      const link = $('a', cell);
      if (link) link.after(pill); else cell.appendChild(pill);
    }
    return pill;
  }

  async function runWithConcurrency(items, limit, worker) {
    if (!items.length) return;
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) await worker(items[index++]);
    }));
  }

  function inventoryBadgeNeedsRecheck(badge) {
    const text = clean(badge?.textContent || '');
    return /hazmat\s*n\/a/i.test(text) || /^L0\b/i.test(text);
  }

  function collectInventoryHazmatWork({ force = false, failuresOnly = false } = {}) {
    const table = getInventoryTable();
    if (!table || !getWarehouseId()) return [];
    const rows = getInventoryRows(table);
    if (!rows.length) return [];
    const asinIndex = findColumnIndex(table, [/^asin$/]);
    const grouped = new Map();
    for (const row of rows) {
      const hit = findAsinInInventoryRow(row, asinIndex);
      if (!hit) continue;
      const cell = hit.link.closest('td') || row.cells?.[0];
      if (!cell) continue;
      const pill = failuresOnly ? $('.fcrm-haz-pill', cell) : ensureInventoryPill(cell);
      if (!pill) continue;
      const badge = $('.fc-badge', pill);
      if (failuresOnly && (!badge || !inventoryBadgeNeedsRecheck(badge))) continue;
      if (!force && badge) continue;
      if (!grouped.has(hit.asin)) grouped.set(hit.asin, []);
      grouped.get(hit.asin).push(pill);
    }
    return [...grouped.entries()].map(([asin, pills]) => ({ asin, pills }));
  }

  async function runInventoryHazmat(work, force) {
    const runId = ++inventoryRunId;
    if (!work.length) return 0;
    await runWithConcurrency(work, MAX_PARALLEL, async ({ asin, pills }) => {
      if (runId !== inventoryRunId) return;
      const result = await getHazmat(asin, force);
      if (runId !== inventoryRunId) return;
      for (const pill of pills) {
        if (!pill.isConnected) continue;
        let badge = $('.fc-badge', pill);
        if (!badge) {
          badge = markUi(document.createElement('span'));
          badge.className = 'fc-badge';
          pill.appendChild(badge);
        }
        renderHazmatBadge(badge, result, { inventory: true });
      }
    });
    return work.length;
  }

  async function annotateInventory(force = false) {
    return runInventoryHazmat(collectInventoryHazmatWork({ force }), force);
  }

  async function recheckInventoryFailures() {
    return runInventoryHazmat(collectInventoryHazmatWork({ force: true, failuresOnly: true }), true);
  }

  function ensureInventoryRefreshButton() {
    const table = getInventoryTable();
    if (!table) return;

    let button = $('.fcrm-grid-recheck');
    if (!button) {
      button = markUi(document.createElement('button'));
      button.type = 'button';
      button.className = 'fcrm-haz-refresh fcrm-grid-recheck';
      button.textContent = 'Recheck N/A + L0';
      button.title = 'Force-recheck only inventory rows currently showing Hazmat N/A or L0';
      button.addEventListener('click', async () => {
        usage('hazmat.recheck');
        setBusyButton(button, true, 'Rechecking…');
        try { await recheckInventoryFailures(); }
        finally { setBusyButton(button, false); }
      });
    }
    if (button.isConnected) return;

    const candidates = $$('button,span,a,input[type="button"]');
    const reference = candidates.find(element => /show pod p-levels/i.test(element.textContent || element.value || ''))
      || candidates.find(element => /analyze container/i.test(element.textContent || element.value || ''));
    if (reference?.parentNode) {
      reference.parentNode.insertBefore(button, reference.nextSibling);
      return;
    }

    const heading = $$('h1,h2,h3,h4,h5,h6').find(element => /^inventory\b/i.test(clean(element.textContent || '')));
    if (heading) {
      heading.appendChild(button);
      return;
    }

    const wrapper = table.closest('.dataTables_wrapper,.dataTables_scroll,.a-box') || table.parentElement;
    if (wrapper?.parentNode) wrapper.parentNode.insertBefore(button, wrapper);
  }

  function updateQtyWidth(input) {
    const length = Math.max(1, String(input?.value || '').length);
    if (input) input.style.width = `${Math.max(3.35, Math.min(4.6, length + 1.15))}ch`;
  }

  function sanitiseQty(input, requireValue = false) {
    if (!input) return null;
    let value = String(input.value || '').replace(/\D+/g, '').slice(0, 4).replace(/^0+/, '');
    if (!value) { input.value = ''; updateQtyWidth(input); if (requireValue) { input.focus(); input.select?.(); } return null; }
    const quantity = Math.max(1, parseInt(value, 10) || 1);
    input.value = String(quantity);
    updateQtyWidth(input);
    return quantity;
  }

  function makeQtyInput() {
    const input = markUi(document.createElement('input'));
    input.type = 'text'; input.inputMode = 'numeric'; input.autocomplete = 'off'; input.spellcheck = false; input.maxLength = 4; input.className = 'fcrm-qty'; input.setAttribute('aria-label', 'Print quantity');
    input.addEventListener('input', () => { input.value = String(input.value || '').replace(/\D+/g, '').slice(0, 4); updateQtyWidth(input); });
    input.addEventListener('blur', () => sanitiseQty(input));
    input.addEventListener('keydown', event => { if (event.key !== 'Enter') return; event.preventDefault(); event.stopPropagation(); const quantity = sanitiseQty(input, true); if (quantity && typeof input._fcrmPrint === 'function') input._fcrmPrint(quantity); });
    updateQtyWidth(input);
    return input;
  }

  function quickPrint(code, quantity = 1, description = '', type = 'ASIN') {
    usage(`print.${String(type).toLowerCase()}`);
    const cleanCode = normalisePrintCode(code);
    if (!cleanCode) return;
    const qty = Math.max(1, parseInt(String(quantity).replace(/\D+/g, ''), 10) || 1);
    const badgeId = getCookie('fcmenu-employeeId');
    const sequence = Math.floor(Math.random() * 1e10);
    const url = `http://localhost:5965/printer?action=print&type=barcode&data=${asciiHex(cleanCode)}&text=${asciiHex(cleanCode)}&quantity=${qty}&desc=${asciiHex(description)}&badgeid=${badgeId}&seq=${sequence}`;
    fetch(url).catch(() => alert('Printmon not running or printer not connected.'));
  }

  function attachPrintTrigger(entry, key, label, callback) {
    if (!entry?.labelCell) return;
    let trigger = $(`.fcrm-stealth-trigger[data-key="${key}"]`, entry.labelCell);
    if (!trigger) {
      const text = clean(entry.labelCell.textContent || label) || label;
      entry.labelCell.textContent = '';
      trigger = document.createElement('span');
      trigger.className = 'fcrm-stealth-trigger'; trigger.dataset.key = key; trigger.setAttribute('role', 'button'); trigger.tabIndex = 0; trigger.textContent = text; trigger.title = `Click to print ${label}`;
      entry.labelCell.appendChild(trigger);
    }
    trigger.onclick = event => { event.preventDefault(); event.stopPropagation(); callback(); };
    trigger.onkeydown = event => { if (event.key !== 'Enter' && event.key !== ' ') return; event.preventDefault(); callback(); };
  }

  function ensurePrintControls(panel) {
    if (!panel?.title) return;
    const title = clean(panel.title.text);
    const primary = panel.primary;
    const primaryCode = panel.primaryId;
    if (primary?.valueCell && primaryCode) {
      let group = $('.fcrm-primary-print', primary.valueCell);
      if (!group) { group = markUi(document.createElement('span')); group.className = 'fcrm-inline fcrm-primary-print'; group.appendChild(makeQtyInput()); primary.valueCell.appendChild(group); }
      const input = $('.fcrm-qty', group);
      input._fcrmPrint = quantity => quickPrint(primaryCode, quantity, title, panel.asin ? 'ASIN' : 'ISBN');
      attachPrintTrigger(primary, 'primary-print', panel.asin ? 'ASIN' : 'ISBN', () => quickPrint(primaryCode, 1, title, panel.asin ? 'ASIN' : 'ISBN'));
    }
    if (panel.fnsku?.valueCell && panel.fnskuId) {
      let group = $('.fcrm-fnsku-print', panel.fnsku.valueCell);
      if (!group) { group = markUi(document.createElement('span')); group.className = 'fcrm-inline fcrm-fnsku-print'; group.appendChild(makeQtyInput()); panel.fnsku.valueCell.appendChild(group); }
      const input = $('.fcrm-qty', group);
      input._fcrmPrint = quantity => quickPrint(panel.fnskuId, quantity, title, 'FNSku');
      attachPrintTrigger(panel.fnsku, 'fnsku-print', 'FNSku', () => quickPrint(panel.fnskuId, 1, title, 'FNSku'));
    }
  }

  const PRINT_PATTERNS = [/\b(FBA[A-Za-z0-9]{6,})\b/,/\b(X0[A-Za-z0-9]{8})\b/,/\b(ZZ[A-Za-z0-9]{8})\b/,/\b(LPN[A-Za-z0-9-]{4,})\b/i,/\b([A-Za-z0-9]{10})\b/];
  function extractPrintableCodeFromText(value) { const text = clean(value); for (const pattern of PRINT_PATTERNS) { const match = text.match(pattern); if (match?.[1]) return normalisePrintCode(match[1]); } return ''; }

  function extractPrintableCodeFromTarget(target) {
    if (!(target instanceof Element)) return '';
    const candidates = [];
    const add = value => { if (value) candidates.push(value); };
    const anchor = target.closest('a');
    if (anchor) { add(anchor.textContent); add(anchor.innerText); add(anchor.title); add(anchor.getAttribute('aria-label')); }
    const cell = target.closest('td,th');
    if (cell) { add(cell.textContent); add(cell.innerText); }
    add(target.textContent); add(target.innerText);
    for (const value of candidates) { const code = extractPrintableCodeFromText(value); if (code) return code; }
    return clean(target.textContent || '');
  }

  function inferPrintType(code) {
    const value = upperForCompare(code);
    if (/^FBA[A-Z0-9]{6,}$/.test(value)) return 'FBA';
    if (/^X0[A-Z0-9]{8}$/.test(value)) return 'FNSku';
    if (/^ZZ[A-Z0-9]{8}$/.test(value)) return 'FCSKU';
    if (/^[A-Z0-9]{10}$/.test(value)) return 'ASIN';
    return 'GENERIC';
  }

  function productTitle() { return clean(readProductPanel()?.title?.text || ''); }
  function titleFromRow(row) { const table = row?.closest('table'); const index = findColumnIndex(table, [/(^|\b)title(\b|$)/,/(^|\b)product(\b|$)/,/(^|\b)description(\b|$)/,/(^|\b)item\s*name(\b|$)/]); return index >= 0 ? clean($$('td', row)[index]?.textContent || '') : ''; }
  function skuAnchorFromRow(row) { const table = row?.closest('table'); const index = findColumnIndex(table, [/(^|\b)sku(\b|$)/,/(^|\b)fnsku(\b|$)/,/(^|\b)fcsku(\b|$)/,/(^|\b)asin(\b|$)/,/(^|\b)isbn(\b|$)/]); return index >= 0 ? $('a', $$('td', row)[index]) : $('a', row); }

  async function waitForProductTitle(targetUpper, timeout = 2500) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const panel = readProductPanel(); if (panel?.title?.text && panel.primaryId === targetUpper) return clean(panel.title.text); await sleep(80); }
    return '';
  }

  function installAltPrint() {
    for (const eventName of ['pointerdown', 'mousedown', 'auxclick']) document.addEventListener(eventName, event => { if (!event.altKey || !extractPrintableCodeFromTarget(event.target)) return; event.preventDefault(); event.stopPropagation(); }, true);
    document.addEventListener('click', async event => {
      if (!event.altKey) return;
      const code = extractPrintableCodeFromTarget(event.target);
      if (!code) return;
      event.preventDefault(); event.stopPropagation();
      if (/\bLPN\b/i.test(code)) { if (!confirm(`Barcode: ${code}\n\nLPNs are unique and should not be printed.\nPress OK to continue, or Cancel to stop.`)) return; quickPrint(code, 1, '', 'LPN'); return; }
      const type = inferPrintType(code);
      if (type === 'FBA' || type === 'GENERIC') { quickPrint(code, 1, '', type); return; }
      const row = event.target instanceof Element ? event.target.closest('tr') : null;
      let title = titleFromRow(row);
      if (!title && row) { const anchor = skuAnchorFromRow(row); if (anchor) { const target = upperForCompare(code); anchor.click(); title = await waitForProductTitle(target, 2500); } }
      if (!title) title = productTitle();
      quickPrint(code, 1, title, type);
    }, true);
  }

  let lastProductSignature = '';
  let refreshBusy = false;
  let refreshPending = false;

  async function refreshPage() {
    if (refreshBusy) { refreshPending = true; return; }
    refreshBusy = true;
    try {
      ensureSectionLoadControls();
      const jobs = [];
      const panel = readProductPanel();
      if (panel) {
        const changed = panel.signature !== lastProductSignature;
        lastProductSignature = panel.signature;
        if (changed) {
          coreRequest('rememberProduct', {
            product: {
              asin: clean(panel.asin?.text),
              isbn: clean(panel.isbn?.text),
              primary: clean(panel.primary?.text),
              fnsku: clean(panel.fnsku?.text),
              fcsku: clean(panel.fcsku?.text),
              title: clean(panel.title?.text),
              dimensions: clean(panel.dimensions?.text),
              weight: clean(panel.get?.('Weight')?.text),
              sortableText: clean(panel.get?.('Sortable')?.text),
              img: clean($('[data-section-type="product"] img')?.getAttribute('src') || '')
            }
          }).catch(() => {});
        }
        applyProductHighlights(panel);
        ensureMadcatBadge(panel);
        ensureSizeBadge(panel);
        ensurePrintControls(panel);
        ensureProductHazmatUi(panel);
        updateMadcat(panel);
        runSizeLookup(panel, false);
        if (changed || $('.fc-hazmat', panel.primary?.valueCell)?.textContent === 'Loading…') jobs.push(updateProductHazmat(panel, false));
      }
      refreshPurchaseOrderHighlighter();
      ensureInventoryRefreshButton();
      jobs.push(annotateInventory(false));
      await Promise.allSettled(jobs);
    } catch (error) {
      console.error(`[FCRM ${VERSION}] refresh failed`, error);
    } finally {
      refreshBusy = false;
      if (refreshPending) { refreshPending = false; queueMicrotask(refreshPage); }
    }
  }

  const scheduleRefresh = debounce(refreshPage, 120);

  function fcrLiteMutationNeedsRefresh(record) {
    const target = record.target instanceof Element ? record.target : record.target?.parentElement;
    if (!target?.closest?.('#fcrlite-sections-app')) return false;
    if (!record.addedNodes.length && !record.removedNodes.length) return true;
    for (const nodes of [record.addedNodes, record.removedNodes]) {
      for (const node of nodes) {
        const element = node instanceof Element ? node : node.parentElement;
        if (element && !element.closest?.(UI_SELECTOR)) return true;
      }
    }
    return false;
  }

  function mutationNeedsRefresh(records) {
    for (const record of records) {
      for (const node of record.removedNodes) {
        const element = node instanceof Element ? node : node.parentElement;
        if (element?.matches?.(`[${SECTION_LOAD_TOGGLE_ATTR}]`) || element?.querySelector?.(`[${SECTION_LOAD_TOGGLE_ATTR}]`)) return true;
      }
      if (fcrLiteMutationNeedsRefresh(record)) return true;
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

  function startObserver() {
    const observer = new MutationObserver(records => { if (mutationNeedsRefresh(records)) scheduleRefresh(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
    document.addEventListener('click', event => { if (event.target instanceof Element && event.target.closest('#table-inventory thead th')) setTimeout(scheduleRefresh, 150); }, true);
    window.addEventListener(FCRLITE_SECTION_RENDERED_EVENT, scheduleRefresh, true);
    window.addEventListener('hashchange', scheduleRefresh, true);
    window.addEventListener('popstate', scheduleRefresh, true);
  }

  let masterStarted = false;
  function startMaster() {
    if (masterStarted || !document.documentElement || !document.body) return;
    masterStarted = true;
    injectStyles();
    installCopyCleaner();
    installAltPrint();
    startObserver();
    ensureSectionLoadControls();
    usage('open');
    refreshPage();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startMaster, { once: true });
  else startMaster();
})();
