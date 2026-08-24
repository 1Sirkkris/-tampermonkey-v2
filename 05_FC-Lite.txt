// ==UserScript==
// @name        TEST v0.1.50 FC-Lite
// @namespace    https://github.com/1Sirkkris
// @version      0.1.50
// @description  TEST: Clean modular FC-Lite front end; direct tote audit using FCR Data Core.
// @author       ChatGPT
// @include      /^https?:\/\/.*fcresearch.*\//
// @include      /^https?:\/\/qifcr\.fe\.aftx\.amazonoperations\.app\//
// @run-at       document-start
// @grant        none
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/FC_Lite.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/FC_Lite.user.js
// ==/UserScript==

(() => {
  'use strict';

  if (window.__fcrLite_v0150test) return;
  window.__fcrLite_v0150test = true;

  const TOTE_HASH = '#fcr-tote-checker';
  const SECTIONS_HASH = '#fcr-lite';
  const NATIVE_HASH = '#fcr-native';
  const RESULTS_PAGE = /\/results(?:\/|$)/i.test(location.pathname);
  const TOTE_MODE = location.hash.startsWith(TOTE_HASH);
  const SECTIONS_MODE = location.hash.startsWith(SECTIONS_HASH);

  // Native FCResearch remains the default. FC-Lite is entered only through its explicit hashes
  // (normally the hidden Dimensions launcher) so normal ASIN/FNSKU links keep native behaviour.
  const STANDALONE = TOTE_MODE || SECTIONS_MODE;

  // Stop native FCResearch fan-out before its normal sections start loading.
  if (STANDALONE) {
    try { window.stop(); } catch {}
    window.__FCR_TOTE_STANDALONE = true;
    document.documentElement.dataset.fcratcStandalone = '1';
    document.documentElement.style.visibility = 'hidden';
  }

  const VERSION = '0.1.50';

  const SECTION_PREFS_KEY = 'fcrlite:sections:v1';
  const SECTION_CONCURRENCY = 5;
  const SECTION_DEFS = [
    ['product', 'Product'],
    ['inventory', 'Inventory'],
    ['inventory-history', 'Inventory History'],
    ['container-history', 'Container history'],
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
  const SECTION_DEFAULTS = new Set(['product', 'inventory']);

  const STATE_WAIT = 'WAIT_CONTAINER';
  const STATE_SCAN = 'SCANNING';
  const STATE_DONE = 'DONE';

  let state = STATE_WAIT;
  let container = '';
  let containerRows = [];
  let containerLookup = new Map();
  let scanSeq = 0;
  let totalScans = 0;
  let completed = 0;
  let foundCount = 0;
  let missingCount = 0;
  let containerLoading = false;
  let inventoryLoadSerial = 0;
  let sessionSerial = 0;
  const pendingScans = [];
  let systemInventoryRows = [];

  const scanAliases = new Map();

  let root;
  let scanInput;
  let stateBadge;
  let statusText;
  let containerText;
  let summaryText;
  let tbody;
  let systemPanel;
  let systemSummary;
  let systemTbody;
  let systemRecheckButton;
  let hoverCard;
  let hoverSerial = 0;
  let liteContainerText;
  let systemSussyBadge;

  const clean = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const upper = value => clean(value).toUpperCase();
  const isContainer = value => /^(?:TSX|CSX)[A-Z0-9]+$/i.test(clean(value));

  function localIsoDate(date) {
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function historyDateBounds() {
    const max = new Date();
    max.setHours(0, 0, 0, 0);
    const min = new Date(max);
    min.setDate(min.getDate() - 180);
    return { min: localIsoDate(min), max: localIsoDate(max) };
  }

  function standaloneUrl() {
    const url = new URL(location.href);
    url.search = '';
    url.hash = TOTE_HASH;
    return url.href;
  }

  function sectionsUrl(searchValue = '') {
    const url = new URL(location.href);
    const wanted = clean(searchValue || new URLSearchParams(location.search).get('s'));
    url.search = '';
    if (wanted) url.searchParams.set('s', wanted);
    url.hash = SECTIONS_HASH;
    return url.href;
  }

  function forceStandaloneMode(url) {
    const next = String(url || '');
    if (!next) return;
    try {
      history.replaceState(null, '', next);
      location.reload();
    } catch {
      location.href = next;
    }
  }

  function openSectionsMode(searchValue = '') {
    forceStandaloneMode(sectionsUrl(searchValue));
  }

  function openToteMode() {
    forceStandaloneMode(standaloneUrl());
  }

  function loadSectionPrefs() {
    const prefs = Object.fromEntries(SECTION_DEFS.map(def => [def.endpoint, SECTION_DEFAULTS.has(def.endpoint)]));
    try {
      const saved = JSON.parse(localStorage.getItem(SECTION_PREFS_KEY) || '{}');
      for (const def of SECTION_DEFS) {
        if (typeof saved?.[def.endpoint] === 'boolean') prefs[def.endpoint] = saved[def.endpoint];
      }
    } catch {}
    return prefs;
  }

  function saveSectionPrefs(prefs) {
    try { localStorage.setItem(SECTION_PREFS_KEY, JSON.stringify(prefs)); } catch {}
  }

  async function mapLimit(items, limit, worker) {
    let next = 0;
    const results = new Array(items.length);
    async function run() {
      while (true) {
        const index = next++;
        if (index >= items.length) return;
        results[index] = await worker(items[index], index);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
    return results;
  }

  function fullFCResearchUrl(containerValue = container || new URLSearchParams(location.search).get('s')) {
    const fc = warehouseId();
    const url = new URL(`${location.origin}/${encodeURIComponent(fc || 'BWU2')}/results`);
    const wanted = clean(containerValue);
    if (wanted) url.searchParams.set('s', wanted);
    url.hash = NATIVE_HASH;
    return url.href;
  }

  function returnToFullFCResearch() {
    usage('full_fcresearch');
    location.href = fullFCResearchUrl();
  }

  function ensureStandaloneDocument() {
    if (!STANDALONE) return;
    try { window.stop(); } catch {}
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
    document.title = `${SECTIONS_MODE ? 'FC-Lite Sections' : 'FC-Lite Tote Audit'} • ${warehouseId() || 'FCResearch'}`;
    body.replaceChildren();
    document.documentElement.style.visibility = '';
  }


  function clearQueuedScans() { pendingScans.length = 0; }
  function queuedCount() { return pendingScans.length; }

  function queueCapturedScan(value) {
    const scan = clean(value);
    if (!scan || !container) return;
    pendingScans.push(scan);
    setStatus(`QUEUE ${pendingScans.length} • inventory loading`, 'working');
    updateHeader();
  }

  function takeQueuedScans() {
    return pendingScans.splice(0);
  }

  function beginContainerQueue(value) {
    const wanted = clean(value);
    if (!wanted) return;
    clearQueuedScans();
    sessionSerial++;
    inventoryLoadSerial++;
    containerLoading = false;
    container = wanted;
    containerRows = [];
    containerLookup = new Map();
    systemInventoryRows = [];
    scanSeq = totalScans = completed = foundCount = missingCount = 0;
    scanAliases.clear();
    if (tbody) tbody.innerHTML = '';
    setState(STATE_SCAN);
    setStatus('Loading system inventory • KEEP SCANNING', 'working');
    updateHeader();
    showSystemLoading(wanted);
    loadContainer(wanted);
  }

  const CORE_REQUEST_EVENT = 'fcr-data-core:request';
  const CORE_RESPONSE_EVENT = 'fcr-data-core:response';
  const CORE_CANCEL_EVENT = 'fcr-data-core:cancel';
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

  function coreRequest(type, payload = {}, timeout = CORE_TIMEOUT_MS, group = '') {
    const id = crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        corePending.delete(id);
        reject(new Error('FCR Data Core missing / timed out'));
      }, timeout);
      corePending.set(id, { resolve, reject, timer });
      window.dispatchEvent(new CustomEvent(CORE_REQUEST_EVENT, {
        detail: JSON.stringify({ id, type, payload, client: 'fclite', group: clean(group) })
      }));
    });
  }

  function cancelCoreGroup(group) {
    const value = clean(group);
    if (!value) return;
    window.dispatchEvent(new CustomEvent(CORE_CANCEL_EVENT, {
      detail: JSON.stringify({ client: 'fclite', group: value })
    }));
  }


  function usage(key, ms = 0, count = 1) {
    window.dispatchEvent(new CustomEvent('fcr-usage:event', {
      detail: JSON.stringify({ key: 'fclite.' + key, ms, count })
    }));
  }


  async function updateCoreStatus() {
    const badge = root?.querySelector('.fcratc-core-status');
    if (!badge) return;
    try {
      const info = await coreRequest('ping', {}, 3000);
      const modules = Array.isArray(info?.modules) ? info.modules : [];
      badge.textContent = `CORE ${info?.version || '?'} • ${modules.length}`;
      badge.classList.add('ok');
      badge.classList.remove('bad');
      badge.title = `FCR Data Core ${info?.version || '?'}\n${modules.join(', ')}`;
    } catch {
      badge.textContent = 'CORE MISSING';
      badge.classList.add('bad');
      badge.classList.remove('ok');
      badge.title = 'Install/enable FCR Data Core';
    }
  }

  function warehouseId() {
    const match = location.pathname.match(/^\/([^/]+)\/results(?:\/|$)/i);
    return match?.[1] || '';
  }

  async function requestBinSize(item, sourceContainer, aliases = []) {
    const code = clean(item);
    const source = clean(sourceContainer);
    if (!code || !source) return '';
    try {
      const result = await coreRequest('binSize', { container: source, item: code, aliases });
      return clean(result?.size || '');
    } catch {
      return '';
    }
  }

  async function resolveBinSize(rawScan, sourceContainer, productPromise) {
    let size = await requestBinSize(rawScan, sourceContainer);
    if (size) return size;
    const product = await productPromise.catch(() => null);
    const aliases = [product?.fnsku, product?.asin, product?.isbn, product?.primary, product?.fcsku].map(clean).filter(Boolean);
    const resolved = clean(product?.fnsku || product?.asin || product?.isbn || product?.primary || '');
    if (!resolved || upper(resolved) === upper(rawScan)) return '';
    size = await requestBinSize(resolved, sourceContainer, aliases);
    if (size) coreRequest('rememberBinSize', { container: sourceContainer, item: rawScan, size, aliases }).catch(() => {});
    return size;
  }

  function paintBinSize(row, size) {
    if (!row?.isConnected) return;
    const host = row.querySelector('.bin-size');
    if (!host) return;
    host.className = `bin-size ${size ? 'ready' : 'none'}`;
    host.textContent = size || '—';
    host.title = size ? `Sideline bin size: ${size}` : 'Sideline bin size unavailable';
  }

  function buildContainerLookup(rows) {
    const map = new Map();

    for (const row of rows) {
      for (const code of [row.asin, row.fnsku, row.fcsku]) {
        const key = upper(code);
        if (!key) continue;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(row);
      }
    }

    return map;
  }

  function matchContainer(product, rawScan) {
    const rawKey = upper(rawScan);
    const strictInternal = /^(?:X0|ZZ)[A-Z0-9]{8}$/.test(rawKey);

    // FNSKU/FCSKU scans must match THAT exact label.
    // Do not broaden an X0/ZZ scan to the ASIN because one ASIN can have multiple labels.
    const candidates = (strictInternal
      ? [rawKey]
      : [rawKey, product?.asin, product?.isbn, product?.primary, product?.fnsku, product?.fcsku]
    ).map(upper).filter(Boolean);

    const matches = [];
    const seen = new Set();

    for (const key of candidates) {
      for (const row of containerLookup.get(key) || []) {
        const id = `${upper(row.asin)}|${upper(row.fnsku)}|${upper(row.fcsku)}`;
        if (seen.has(id)) continue;
        seen.add(id);
        matches.push(row);
      }
    }

    return matches;
  }

  function sumQty(rows) {
    return rows.reduce((sum, row) => sum + (Number(row.qty) || 0), 0);
  }


  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setStatus(text, kind = '') {
    statusText.textContent = text;
    statusText.className = `fcratc-status ${kind}`.trim();
  }

  function coverageCode(row) {
    return upper(row?.fnsku || row?.fcsku || row?.asin || '');
  }

  function coverageStats() {
    const groups = new Map();
    for (const row of containerRows) {
      const key = coverageCode(row);
      if (!key) continue;
      let group = groups.get(key);
      if (!group) { group = { qty: 0, scanned: 0 }; groups.set(key, group); }
      const qty = Number(row.qty) || 0;
      group.qty += qty;
      group.scanned += Math.min(Number(row._fcratcScanned) || 0, qty);
    }
    let scannedSkus = 0, totalUnits = 0, scannedUnits = 0;
    for (const group of groups.values()) {
      if (group.scanned > 0) scannedSkus++;
      totalUnits += group.qty;
      scannedUnits += Math.min(group.scanned, group.qty);
    }
    return { totalSkus: groups.size, scannedSkus, totalUnits, scannedUnits };
  }

  function setState(next) {
    state = next;
    stateBadge.className = 'fcratc-state';

    if (state === STATE_WAIT) {
      stateBadge.textContent = 'CONTAINER';
      stateBadge.classList.add('wait');
      scanInput.placeholder = 'Scan tsX / csX';
    } else if (state === STATE_SCAN) {
      stateBadge.textContent = 'ITEMS';
      stateBadge.classList.add('scan');
      scanInput.placeholder = 'Scan item barcode';
    } else {
      stateBadge.textContent = 'DONE';
      stateBadge.classList.add('done');
      scanInput.placeholder = 'Scan new container';
    }

  }

  function updateHeader() {
    if (!containerText || !summaryText) return;
    containerText.textContent = container || '—';
    if (liteContainerText) liteContainerText.textContent = container || 'NO CONTAINER';

    if (!container) {
      summaryText.textContent = 'No container loaded';
        return;
    }

    if (containerLoading || !containerRows.length) {
      const count = queuedCount();
      summaryText.textContent = `QUEUE ${count} • waiting for inventory`;
        return;
    }

    const stats = coverageStats();
    const base = `${stats.scannedSkus}/${stats.totalSkus} SKU • ${stats.scannedUnits}/${stats.totalUnits}u`;
    const complete = stats.totalUnits > 0 && stats.scannedUnits >= stats.totalUnits;

    if (state === STATE_DONE) {
      summaryText.textContent = `${base}${complete ? ' • ✓ COMPLETE' : ''} • ${missingCount} out`;
    } else {
      summaryText.textContent = `${base}${complete ? ' • ✓ COMPLETE' : ''}`;
    }
  }

  function focusScanner() {
    if (!scanInput) return;
    scanInput.focus({ preventScroll: true });
    scanInput.select();
  }


  function allocatePhysicalScans(matches, amount = 1) {
    let remaining = Math.max(0, Number(amount) || 0);
    for (const match of matches || []) {
      if (remaining <= 0) break;
      const qty = Math.max(0, Number(match.qty) || 0);
      const current = Math.max(0, Number(match._fcratcScanned) || 0);
      const room = Math.max(0, qty - current);
      if (!room) continue;
      const add = Math.min(room, remaining);
      match._fcratcScanned = current + add;
      remaining -= add;
    }
  }

  function updateToteResultProgress(row) {
    if (!row || row.dataset.resultState !== 'found') return;
    const matches = row._fcratcMatches || [];
    const total = sumQty(matches);
    const scans = Math.max(1, Number(row.dataset.scanCount) || 1);
    const checked = total > 0 ? Math.min(scans, total) : scans;
    const result = row.querySelector('.result');
    if (!result) return;
    result.innerHTML = `<strong class="result-pill found">✓${total > 1 ? `${checked}/${total}` : checked}</strong>`;
    result.title = `Physically scanned ${checked} of ${total || '?'} unit${total === 1 ? '' : 's'} in tote`;
  }

  function clearSession(keepStatus = false) {
    sessionSerial++;
    inventoryLoadSerial++;
    containerLoading = false;
    container = '';
    containerRows = [];
    containerLookup = new Map();
    scanSeq = 0;
    totalScans = 0;
    completed = 0;
    foundCount = 0;
    missingCount = 0;
    scanAliases.clear();
    clearQueuedScans();
    systemInventoryRows = [];
    if (systemTbody) systemTbody.innerHTML = '';
    if (systemPanel) systemPanel.hidden = true;
    hideHoverCard();
    tbody.innerHTML = '';
    setState(STATE_WAIT);
    updateHeader();
    if (!keepStatus) setStatus('Scan container', 'ready');
    focusScanner();
  }

  async function loadContainer(value) {
    const wanted = clean(value);
    if (!wanted) return;
    const serial = ++inventoryLoadSerial;
    let loadedOk = false;
    containerLoading = true;
    container = wanted;
    setState(STATE_SCAN);
    setStatus('Loading system inventory • KEEP SCANNING', 'working');
    updateHeader();
    showSystemLoading(wanted);

    try {
      const result = await coreRequest('inventory', { container: wanted });
      if (serial !== inventoryLoadSerial || upper(container) !== upper(wanted)) return;

      const rows = Array.isArray(result?.rows) ? result.rows : [];
      rows.forEach(row => { row._fcratcScanned = 0; });

      containerRows = rows;
      systemInventoryRows = rows;
      containerLookup = buildContainerLookup(rows);
      renderSystemInventory(rows);

      annotateSystemHazmat(false).catch(() => {});
      annotateSystemSussy().catch(() => {});

      loadedOk = true;
      setStatus(`✓ ${wanted} ready — ${rows.length} row${rows.length === 1 ? '' : 's'} • keep scanning`, 'success');
    } catch (error) {
      if (serial !== inventoryLoadSerial) return;
      showSystemError(clean(error.message));
      setStatus(`✕ ${clean(error.message)}`, 'error');
    } finally {
      if (serial !== inventoryLoadSerial) return;
      containerLoading = false;
      updateHeader();

      if (loadedOk) {
        const queued = takeQueuedScans();
        if (queued.length) {
          setStatus(`Inventory ready • processing ${queued.length} queued scan${queued.length === 1 ? '' : 's'}`, 'working');
          setTimeout(() => queued.forEach(handleScan), 0);
        }
      } else if (queuedCount()) {
        setStatus(`Inventory failed • ${queuedCount()} scan${queuedCount() === 1 ? '' : 's'} kept in queue`, 'error');
      }
      focusScanner();
    }
  }

  function addPendingRow(rawScan) {
    const id = ++scanSeq;
    const tr = document.createElement('tr');
    tr.dataset.scanId = String(id);
    tr.dataset.scanCount = '1';
    tr.dataset.resultState = 'pending';
    tr.className = 'pending';
    tr.innerHTML = `
      <td class="scan" title="${esc(rawScan)}"><span class="scan-code">${esc(rawScan)}</span><span class="scan-count" hidden data-count=""></span></td>
      <td class="sortable">…</td>
      <td class="dimensions"><span class="dims-pill">…</span><span class="bin-size pending">BIN …</span></td>
      <td class="madcat">…</td>
      <td class="result"><strong class="result-pill checking">CHECKING</strong></td>
    `;
    tbody.prepend(tr);
    scanAliases.set(upper(rawScan), tr);
    return tr;
  }

  function registerRowAliases(row, rawScan, product) {
    const rawKey = upper(rawScan);
    const strictInternal = /^(?:X0|ZZ)[A-Z0-9]{8}$/.test(rawKey);
    const aliases = (strictInternal
      ? [rawKey]
      : [rawKey, product?.fnsku, product?.fcsku, product?.asin, product?.isbn, product?.primary]
    ).map(upper).filter(Boolean);
    for (const alias of aliases) scanAliases.set(alias, row);
  }

  function bumpDuplicate(row, rawScan) {
    const count = (Number(row.dataset.scanCount) || 1) + 1;
    row.dataset.scanCount = String(count);

    const badge = row.querySelector('.scan-count');
    if (badge) {
      badge.hidden = false;
      badge.dataset.count = `×${count}`;
    }

    row.classList.remove('rescan');
    void row.offsetWidth;
    row.classList.add('rescan');
    setTimeout(() => row?.classList.remove('rescan'), 420);

    const resultState = row.dataset.resultState || 'pending';
    if (resultState === 'found') {
      allocatePhysicalScans(row._fcratcMatches || [], 1);
      updateToteResultProgress(row);
      setStatus(`↻ ${rawScan} ×${count} — IN ${container}`, 'success');
      flash('found');
    } else if (resultState === 'missing') {
      setStatus(`↻ ${rawScan} ×${count} — NOT IN ${container}`, 'error');
      flash('missing');
    } else if (resultState === 'error') {
      setStatus(`↻ ${rawScan} ×${count} — previous check errored`, 'error');
      flash('error');
    } else {
      setStatus(`↻ ${rawScan} ×${count} — already checking`, 'working');
    }
    updateHeader();
    focusScanner();
  }

  function paintResult(row, rawScan, product, history, matches, error = '') {
    const primary = product?.asin || product?.isbn || product?.primary || '';
    const fnsku = product?.fnsku || '';
    const sort = product?.sortable === 'true' ? 'TRUE'
      : product?.sortable === 'false' ? 'FALSE'
      : '—';
    const dims = product?.dimensions || '—';
    const dimsSussy = product?.suspicious === true;
    const madcat = history ? (history.madcat ? 'YES' : 'NO') : '—';
    const found = matches.length > 0;
    const qty = found ? sumQty(matches) : 0;

    row.className = error ? 'unresolved' : found ? 'found' : 'missing';
    row.dataset.resultState = error ? 'error' : found ? 'found' : 'missing';

    const sortCell = row.querySelector('.sortable');
    sortCell.classList.toggle('yes', sort === 'TRUE');
    sortCell.classList.toggle('no', sort === 'FALSE');
    sortCell.innerHTML = sort === '—' ? '—' : `<span class="sort-pill ${sort === 'FALSE' ? 'no' : 'yes'}" title="Sortable: ${sort}">${sort === 'TRUE' ? '✓' : '✕'}</span>`;

    const dimsCell = row.querySelector('.dimensions');
    const dimsHost = dimsCell?.querySelector('.dims-pill');
    dimsCell?.classList.toggle('sussy', dimsSussy);
    if (dimsHost) {
      dimsHost.className = `dims-pill${dimsSussy ? ' sussy' : ''}`;
      dimsHost.textContent = `${dimsSussy ? '⚠ ' : ''}${dims}`;
      dimsHost.title = dimsSussy ? 'Suspicious dimensions — verify measurement data' : dims;
    }

    const madCell = row.querySelector('.madcat');
    madCell.classList.toggle('yes', madcat === 'YES');
    madCell.classList.toggle('no', madcat === 'NO');
    madCell.innerHTML = madcat === '—' ? '—' : `<span class="madcat-pill ${madcat === 'YES' ? 'yes' : 'no'}">${madcat}</span>`;

    const result = row.querySelector('.result');
    if (error) {
      result.innerHTML = `<strong class="result-pill error">⚠ ERROR</strong>`;
      result.title = error;
    } else if (found) {
      row._fcratcMatches = matches;
      updateToteResultProgress(row);
    } else {
      result.innerHTML = '<strong class="result-pill missing">✕</strong>';
      result.title = 'Not in tote';
    }

    row.title = product?.title || rawScan;
  }

  async function getProduct(rawScan) {
    const result = await coreRequest('product', {
      code: rawScan,
      require: ['dimensions', 'sortable']
    });
    const shared = result?.product;
    if (!shared) return null;
    const product = {
      asin: clean(shared.asin),
      isbn: clean(shared.isbn),
      primary: clean(shared.primary || shared.asin || shared.isbn),
      fnsku: clean(shared.fnsku),
      fcsku: clean(shared.fcsku),
      title: clean(shared.title),
      dimensions: clean(shared.dimensions),
      weight: clean(shared.weight),
      img: clean(shared.img),
      sortable: shared.sortable === true ? 'true' : shared.sortable === false ? 'false' : clean(shared.sortableText).toLowerCase(),
      suspicious: shared.suspicious === true
    };
    return product;
  }

  async function getHistory(rawScan, product, initialParsed = null) {
    const rawKey = upper(rawScan);
    let parsed = initialParsed;

    if (!parsed) {
      const result = await coreRequest('history', { code: rawScan });
      parsed = result?.history || { rows: 0, madcat: false };
    }

    // Keep the strict/flexible behaviour from the Tote Checker:
    // external UPC/EAN/ISBN may resolve to an internal code, so retry history once.
    if (parsed.rows === 0 && product) {
      const resolved = clean(product.fnsku || product.asin || product.isbn || product.primary);
      if (resolved && upper(resolved) !== rawKey) {
        const result = await coreRequest('history', { code: resolved });
        parsed = result?.history || parsed;
      }
    }

    return parsed;
  }

  async function processItem(rawScan) {
    usage('item.scan');
    const run = sessionSerial;
    const row = addPendingRow(rawScan);
    const sourceContainer = container;
    setStatus(`Checking ${rawScan}…`, 'working');

    try {
      // Raw scan preserves UPC/EAN/ISBN resolution
      const productPromise = getProduct(rawScan);
      const binSizePromise = resolveBinSize(rawScan, sourceContainer, productPromise);
      const rawHistoryPromise = coreRequest('history', { code: rawScan })
        .then(result => {
          const parsed = result?.history || { rows: 0, madcat: false };
          return parsed;
        })
        .catch(() => null);

      const product = await productPromise;
      let history = await rawHistoryPromise;
      if (run !== sessionSerial || upper(sourceContainer) !== upper(container)) return;

      if (!product) {
        throw new Error('Product not resolved');
      }

      registerRowAliases(row, rawScan, product);

      history = await getHistory(rawScan, product, history);
      if (run !== sessionSerial || upper(sourceContainer) !== upper(container)) return;

      const matches = matchContainer(product, rawScan);
      const found = matches.length > 0;
      usage(found ? 'item.in' : 'item.out');

      completed++;
      if (found) foundCount++;
      else missingCount++;

      paintResult(row, rawScan, product, history, matches);
      if (found) allocatePhysicalScans(matches, 1);
      updateToteResultProgress(row);
      binSizePromise.then(size => paintBinSize(row, size));

      if (found) {
        setStatus(`✓ IN ${container} — ${product.fnsku || product.primary}`, 'success');
        flash('found');
      } else {
        setStatus(`✕ NOT IN ${container} — ${product.fnsku || product.primary}`, 'error');
        flash('missing');
      }
    } catch (error) {
      if (run !== sessionSerial || upper(sourceContainer) !== upper(container)) return;
      completed++;
      paintResult(row, rawScan, null, null, [], clean(error.message));
      setStatus(`⚠ ${rawScan}: ${clean(error.message)}`, 'error');
      flash('error');
    } finally {
      if (run === sessionSerial && upper(sourceContainer) === upper(container)) {
        updateHeader();
        focusScanner();
      }
    }
  }

  function finishSession() {
    setState(STATE_DONE);
    updateHeader();
    setStatus(`DONE — ${totalScans} scan${totalScans === 1 ? '' : 's'} • ${completed} item${completed === 1 ? '' : 's'} • ${foundCount} in • ${missingCount} out`, missingCount ? 'error' : 'success');
    flash(missingCount ? 'missing' : 'found');
    focusScanner();
  }

  function handleScan(value) {
    const scan = clean(value);
    if (!scan) return;

    if (scanInput) scanInput.value = '';

    // Scanner never waits for inventory
    if (containerLoading && !isContainer(scan)) {
      queueCapturedScan(scan);
      focusScanner();
      return;
    }

    if (state === STATE_WAIT) {
      if (!isContainer(scan)) {
        setStatus('Scan container first', 'error');
        flash('error');
        focusScanner();
        return;
      }
      beginContainerQueue(scan);
      return;
    }

    if (state === STATE_SCAN) {
      if (isContainer(scan)) {
        if (upper(scan) === upper(container)) {
          // Same tote finishes run
          finishSession();
        } else {
          // New tote starts fresh
          clearSession(true);
          beginContainerQueue(scan);
        }
        return;
      }

      totalScans++;
      const existingRow = scanAliases.get(upper(scan));
      if (existingRow?.isConnected) {
        bumpDuplicate(existingRow, scan);
      } else {
        processItem(scan);
        focusScanner();
      }
      return;
    }

    if (isContainer(scan)) {
      clearSession(true);
      beginContainerQueue(scan);
    } else {
      setStatus('Session done — scan next container', 'error');
      focusScanner();
    }
  }

  const LEVEL_COLORS = ['rgb(153,153,153)','rgb(51,204,2)','rgb(255,225,3)','rgb(255,191,3)','rgb(255,128,2)','rgb(255,64,1)','rgb(237,7,0)','rgb(173,3,222)','rgb(51,51,255)'];
  const isAsin = value => /^[A-Z0-9]{10}$/i.test(upper(value));
  const clampLevel = value => Math.max(0, Math.min(8, Number(value) || 0));

  async function getHazmat(asinValue, force = false) {
    const result = await coreRequest('hazmat', { asin: asinValue, force });
    const haz = result?.hazmat;
    return haz ? [Number(haz.level || 0), String(haz.message || '')] : null;
  }

  function paintHazmatPills(pills, result) {
    for (const pill of pills) {
      if (!result) {
        pill.textContent = 'N/A'; pill.dataset.level = 'na';
        pill.style.background = LEVEL_COLORS[0]; pill.style.color = '#111';
        continue;
      }
      const level = clampLevel(result[0]);
      const message = String(result[1] || '');
      pill.textContent = `L${level}${message.includes('can be processed') ? ' ✓' : ''}`;
      pill.dataset.level = String(level);
      pill.style.background = LEVEL_COLORS[level];
      pill.style.color = level >= 5 ? '#fff' : '#111';
      pill.title = message;
    }
  }

  async function runWithConcurrency(items, limit, worker) {
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) await worker(items[index++]);
    }));
  }

  async function annotateSystemHazmat(failuresOnly = false) {
    if (!systemTbody) return;
    const pillsByAsin = new Map();
    for (const pill of systemTbody.querySelectorAll('.fcratc-haz')) {
      const asin = upper(pill.dataset.asin);
      if (!isAsin(asin)) continue;
      if (!pillsByAsin.has(asin)) pillsByAsin.set(asin, []);
      pillsByAsin.get(asin).push(pill);
    }
    const targets = [];
    for (const [asin, pills] of pillsByAsin) {
      if (!failuresOnly || pills.some(pill => pill.dataset.level === 'na' || pill.dataset.level === '0')) targets.push([asin, pills]);
    }
    await runWithConcurrency(targets, 8, async ([asin, pills]) => {
      const result = await getHazmat(asin, failuresOnly);
      if (pills.some(pill => pill.isConnected)) paintHazmatPills(pills, result);
    });
  }


  async function annotateSystemSussy() {
    if (!systemTbody || !systemInventoryRows.length) return;
    const domRows = [...systemTbody.querySelectorAll('tr[data-system-row]')];
    const groups = new Map();
    let total = 0;

    systemInventoryRows.forEach((row, index) => {
      const code = clean(row.fnsku || row.asin || row.fcsku);
      if (!code) return;
      total++;
      if (!groups.has(code)) groups.set(code, []);
      groups.get(code).push(index);
    });

    let checked = 0;
    let sussy = 0;
    if (systemSussyBadge) {
      systemSussyBadge.hidden = false;
      systemSussyBadge.textContent = 'DIMS …';
      systemSussyBadge.className = 'fcratc-system-sussy-badge loading';
    }

    await runWithConcurrency([...groups.entries()], 6, async ([code, indexes]) => {
      try {
        const result = await coreRequest('product', { code, require: ['dimensions'] });
        const flagged = result?.product?.suspicious === true;
        for (const index of indexes) {
          const tr = domRows[index];
          if (!tr?.isConnected) continue;
          tr.classList.toggle('fcratc-system-sussy', flagged);
          const cell = tr.querySelector('.fcratc-system-fnsku');
          if (cell) cell.classList.toggle('fcratc-system-sussy-cell', flagged);
          if (flagged) sussy++;
          checked++;
        }
      } catch {
        checked += indexes.length;
      }
      if (systemSussyBadge) systemSussyBadge.textContent = `DIMS ${sussy}/${checked}`;
    });

    if (!systemSussyBadge) return;
    systemSussyBadge.classList.remove('loading');
    systemSussyBadge.classList.toggle('clear', sussy === 0);
    systemSussyBadge.textContent = sussy ? `SUSSY DIMS ${sussy}/${total}` : `DIMS CLEAR ${total}/${total}`;
  }

  function showSystemLoading(wanted) { if(!systemPanel)return; systemPanel.hidden=false; systemSummary.textContent=`AMAZON RECORD • Loading ${wanted}…`; if(systemSussyBadge){systemSussyBadge.hidden=true;systemSussyBadge.textContent='DIMS …';systemSussyBadge.className='fcratc-system-sussy-badge loading';} systemTbody.innerHTML='<tr><td colspan="12" class="fcratc-system-message">Loading system inventory…</td></tr>'; }
  function showSystemError(message) { if(!systemPanel)return; systemPanel.hidden=false; systemSummary.textContent='AMAZON RECORD • Inventory error'; systemTbody.innerHTML=`<tr><td colspan="12" class="fcratc-system-message error">${esc(message)}</td></tr>`; }
  function renderSystemInventory(rows) {
    if(!systemPanel)return; systemPanel.hidden=false; systemSummary.textContent=`AMAZON RECORD • ${rows.length} row${rows.length===1?'':'s'} • ${sumQty(rows)}u`;
    if(!rows.length){systemTbody.innerHTML='<tr><td colspan="12" class="fcratc-system-message">No inventory returned</td></tr>';return;}
    systemTbody.innerHTML=rows.map((r,index)=>{const asin=upper(r.asin);return `<tr data-system-row="${index}"><td>${esc(r.container)}</td><td><span class="fcratc-asin" data-asin="${esc(asin)}">${esc(r.asin)}</span><span class="fcratc-haz" data-asin="${esc(asin)}" data-level="loading">…</span></td><td class="fcratc-system-fnsku">${esc(r.fnsku)}</td><td>${esc(r.fcsku)}</td><td>${esc(r.lpn)}</td><td class="num">${esc(r.qty)}</td><td>${esc(r.disposition)}</td><td>${esc(r.consumer)}</td><td>${esc(r.consumerId)}</td><td>${esc(r.outerLocation)}</td><td>${esc(r.outerLocationType)}</td><td class="title-cell" title="${esc(r.title)}">${esc(r.title)}</td></tr>`;}).join('');
  }

  function hideHoverCard(){hoverSerial++;if(hoverCard)hoverCard.hidden=true;}
  function positionHoverCard(anchor){if(!hoverCard||!anchor)return;const r=anchor.getBoundingClientRect(),w=STANDALONE?500:410,h=STANDALONE?215:185;hoverCard.style.left=`${Math.min(window.innerWidth-w-8,Math.max(8,r.left))}px`;let top=r.bottom+8;if(top+h>window.innerHeight)top=Math.max(8,r.top-h);hoverCard.style.top=`${top}px`;}
  async function showAsinHover(anchor){
    usage('asin.hover');
    const asin=upper(anchor?.dataset?.asin);if(!isAsin(asin)||!hoverCard)return;const serial=++hoverSerial;positionHoverCard(anchor);hoverCard.hidden=false;hoverCard.innerHTML=`<div class="fcratc-hover-loading">Loading ${esc(asin)}…</div>`;
    try { const result=await coreRequest('product',{code:asin,require:['dimensions','weight','sortable']});if(serial!==hoverSerial||hoverCard.hidden)return;const p=result?.product||{},sortable=p.sortable===true?'TRUE':p.sortable===false?'FALSE':clean(p.sortableText||'—').toUpperCase(),img=clean(p.img);hoverCard.innerHTML=`<div class="fcratc-hover-img">${img?`<img src="${esc(img)}" alt="">`:'<span>NO IMAGE</span>'}</div><div class="fcratc-hover-info"><div><span>DIMENSIONS</span><strong>${esc(p.dimensions||'—')}</strong></div><div><span>WEIGHT</span><strong>${esc(p.weight||'—')}</strong></div><div><span>SORTABLE</span><strong class="sortable-hover ${sortable==='FALSE'?'no':''}">${esc(sortable)}</strong></div></div>`;positionHoverCard(anchor);
    } catch(error){if(serial!==hoverSerial)return;hoverCard.innerHTML=`<div class="fcratc-hover-loading">⚠ ${esc(clean(error?.message||'Product lookup failed'))}</div>`;}
  }

  function flash(kind) {
    root.classList.remove('flash-found', 'flash-missing', 'flash-error');
    void root.offsetWidth;
    root.classList.add(`flash-${kind}`);
    setTimeout(() => root?.classList.remove(`flash-${kind}`), 650);
  }

  function injectStyles() {
    if (document.getElementById('fcratc-style')) return;

    const style = document.createElement('style');
    style.id = 'fcratc-style';
    style.textContent = `
      #fcratc-root {
        position:relative;
        width:100%;
        margin:4px 0 8px 0;
        z-index:2;
        font-family:Arial,Helvetica,sans-serif;
        color:#111827;
      }

      .fcratc-litebar { display:none; }
      #fcratc-root.fcratc-standalone .fcratc-litebar {
        display:flex;
        align-items:center;
        flex-wrap:wrap;
        gap:6px;
        width:100%;
        min-width:0;
        min-height:50px;
        margin:0 0 10px 0;
        padding:6px 8px;
        box-sizing:border-box;
        position:sticky;
        top:0;
        z-index:1000;
        overflow:hidden;
        border:2px solid #1e3a5f;
        border-radius:8px;
        background:#0f2744;
        color:#fff;
        box-shadow:0 3px 10px rgba(15,23,42,.18);
      }
      .fcratc-lite-brand {
        border:0;
        padding:0 4px;
        background:transparent;
        color:#fff;
        font:900 24px Arial,Helvetica,sans-serif;
        letter-spacing:.4px;
        cursor:pointer;
      }
      .fcratc-lite-brand:hover { text-decoration:underline; }
      .fcratc-lite-sub {
        padding-left:9px;
        border-left:1px solid rgba(255,255,255,.35);
        color:#b9c9dc;
        font-size:13px;
        font-weight:900;
        letter-spacing:.5px;
      }
      .fcratc-lite-container {
        margin-left:4px;
        padding:4px 8px;
        border-radius:999px;
        background:#e7eef8;
        color:#172033;
        font-size:12px;
        font-weight:900;
      }
      .fcratc-core-status {
        margin-left:0;
        padding:4px 7px;
        border-radius:999px;
        background:#5b6778;
        color:#fff;
        font-size:11.5px;
        font-weight:900;
        white-space:nowrap;
      }
      .fcratc-lite-container + .fcratc-core-status { margin-left:auto; }
      .fcratc-core-status.ok { background:#166534; }
      .fcratc-core-status.bad { background:#991b1b; }
      .fcratc-copy-stats { height:33px; padding:0 10px; border:1px solid #a8bdd5; border-radius:6px; background:#e8f1fb; color:#163a63; font-size:12.5px; font-weight:900; cursor:pointer; }
      .fcratc-copy-stats:hover { background:#d8e8f8; }
      .fcratc-full-fcr {
        margin-left:0;
        height:33px;
        padding:0 11px;
        border:1px solid #a8bdd5;
        border-radius:6px;
        background:#fff;
        color:#163a63;
        font-size:12.5px;
        font-weight:900;
        cursor:pointer;
      }
      .fcratc-full-fcr:hover { background:#edf4fc; }
      html[data-fcratc-standalone="1"],
      html[data-fcratc-standalone="1"] body {
        min-height:100%;
        margin:0!important;
        background:#e9eef5!important;
      }
      html[data-fcratc-standalone="1"] body > *:not(#fcratc-root):not([data-fcr-tool-ui="1"]) { display:none!important; }
      #fcratc-root.fcratc-standalone {
        --fcrlite-bar-height:62px;
        width:100%;
        max-width:100vw;
        box-sizing:border-box;
        overflow-x:hidden;
        margin:0;
        padding:12px;
        /* FC-Lite is the page layer, not a modal. Keep tool overlays above it. */
        z-index:10;
        color:#172536;
        font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;
        font-size:14px;
        line-height:1.35;
      }
      #fcratc-root.fcratc-standalone #fcratc-panel { width:100%; max-width:none; }
      #fcratc-root.fcratc-standalone .fcratc-min { display:none; }
      #fcratc-root.fcratc-booting {
        position:fixed!important;
        top:4px;
        left:12px;
        width:min(760px,calc(100vw - 24px));
        margin:0;
        z-index:2147483646;
      }
      #fcratc-root.fcratc-booting #fcratc-panel {
        box-shadow:0 4px 14px rgba(15,23,42,.28);
      }
      #fcratc-root * { box-sizing:border-box; }
      #fcratc-panel {
        width:min(760px,100%);
        background:#172033;
        border:1px solid #64748b;
        border-radius:7px;
        overflow:hidden;
        box-shadow:0 2px 6px rgba(15,23,42,.12);
      }

      .fcratc-top {
        height:33px;
        display:flex;
        align-items:center;
        gap:4px;
        padding:2px 3px;
      }
      .fcratc-state {
        flex:0 0 72px;
        height:27px;
        display:flex;
        align-items:center;
        justify-content:center;
        border-radius:5px;
        font-size:11px;
        font-weight:900;
        letter-spacing:.15px;
        cursor:text;
      }
      .fcratc-state.wait { background:#f59e0b; color:#111827; }
      .fcratc-state.scan { background:#2563eb; color:#fff; }
      .fcratc-state.done { background:#0f5fbf; color:#fff; }

      #fcratc-input {
        flex:1 1 auto;
        min-width:140px;
        height:27px;
        border:1.5px solid #94a3b8;
        border-radius:5px;
        padding:1px 7px;
        background:#fff;
        color:#111827;
        font-size:14px;
        font-weight:800;
        outline:none;
      }
      #fcratc-input:focus { border-color:#60a5fa; box-shadow:0 0 0 1px rgba(96,165,250,.28); }
      #fcratc-input:disabled { opacity:.6; cursor:wait; }

      .fcratc-btn {
        flex:0 0 auto;
        width:29px;
        height:27px;
        border:1px solid #64748b;
        border-radius:5px;
        padding:0;
        background:#f3f4f6;
        color:#111827;
        font-size:14px;
        font-weight:900;
        cursor:pointer;
      }
      .fcratc-btn:hover { background:#e5e7eb; }

      .fcratc-meta {
        height:23px;
        display:flex;
        align-items:center;
        gap:6px;
        padding:1px 6px;
        background:#f8fafc;
        border-top:1px solid #334155;
        border-bottom:1px solid #cbd5e1;
        font-size:11px;
      }
      .fcratc-container { font-weight:900; white-space:nowrap; }
      .fcratc-summary { color:#64748b; white-space:nowrap; }
      .fcratc-status {
        margin-left:auto;
        min-width:0;
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
        font-weight:900;
      }
      .fcratc-status.working { color:#92400e; }
      .fcratc-status.success { color:#0b5cad; }
      .fcratc-status.error { color:#9a3412; }
      .fcratc-status.ready { color:#475569; }

      .fcratc-tablewrap { overflow:visible; background:#fff; }
      #fcratc-table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:11px; }
      #fcratc-table td {
        height:27px;
        padding:2px 5px;
        border-bottom:1px solid #dce3ec;
        vertical-align:middle;
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
      }
      #fcratc-table tr:last-child td { border-bottom:0; }
      #fcratc-table td.scan { overflow:visible; }
      #fcratc-table td.sortable,
      #fcratc-table td.madcat,
      #fcratc-table td.result { text-align:center; }

      #fcratc-table tr.pending td { background:#fffdf3; }
      #fcratc-table tr.found td { background:#f5f8ff; }
      #fcratc-table tr.found td:first-child { box-shadow:inset 3px 0 0 #2563eb; }
      #fcratc-table tr.missing td { background:#fff9ea; }
      #fcratc-table tr.missing td:first-child { box-shadow:inset 3px 0 0 #d97706; }
      #fcratc-table tr.missing td.result { background:#fff0ca; }
      #fcratc-table tr.unresolved td { background:#f8fafc; }
      #fcratc-table tr.unresolved td:first-child { box-shadow:inset 3px 0 0 #64748b; }
      #fcratc-table tr.rescan td { animation:fcratcRescan .42s ease-out; }

      @keyframes fcratcRescan {
        0% { box-shadow:inset 0 0 0 999px rgba(250,204,21,.28); }
        100% { box-shadow:inset 0 0 0 999px rgba(250,204,21,0); }
      }

      .scan-code { font-weight:900; }
      .scan-count {
        display:inline-flex;
        align-items:center;
        justify-content:center;
        min-width:20px;
        height:16px;
        margin-left:4px;
        padding:0 4px;
        border-radius:999px;
        background:#111827;
        color:#fff;
        font-size:10px;
        font-weight:900;
        vertical-align:middle;
      }
      .scan-count::before { content:attr(data-count); }
      .scan-count[hidden] { display:none!important; }

      .result-pill,.sort-pill,.madcat-pill,.dims-pill,.bin-size {
        display:inline-flex;
        align-items:center;
        justify-content:center;
        font-weight:900;
        line-height:1;
      }
      .sort-pill {
        width:21px;
        height:18px;
        border-radius:5px;
        font-size:12px;
      }
      .sort-pill.yes { background:#e2e8f0; color:#334155; }
      .sort-pill.no { background:#fee2e2; color:#991b1b; border:1px solid #b91c1c; }

      #fcratc-table td.dimensions { overflow:visible; font-weight:800; }
      .dims-pill {
        max-width:215px;
        justify-content:flex-start;
        border-radius:4px;
        font-size:11px;
      }
      .dims-pill.sussy {
        background:#fff1c2;
        color:#5b2500;
        border:1px dashed #9a6700;
        padding:2px 4px;
      }
      .bin-size {
        margin-left:4px;
        max-width:130px;
        padding:3px 5px;
        border-radius:999px;
        background:#dbeafe;
        color:#1e3a8a;
        border:1px solid #93c5fd;
        font-size:9.5px;
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
        vertical-align:middle;
      }
      .bin-size.pending,.bin-size.none { background:#f1f5f9; color:#64748b; border-color:#cbd5e1; }

      .madcat-pill {
        min-width:29px;
        padding:3px 4px;
        border-radius:999px;
        font-size:9px;
      }
      .madcat-pill.yes { background:#e0e7ff; color:#3730a3; }
      .madcat-pill.no { background:#e5e7eb; color:#4b5563; }

      .result-pill {
        min-width:31px;
        padding:4px 5px;
        border-radius:999px;
        border:1px solid transparent;
        font-size:11px;
      }
      .result-pill.checking { background:#fff7d6; border-color:#eab308; color:#713f12; }
      .result-pill.found { background:#2563eb; border-color:#1d4ed8; color:#fff; }
      .result-pill.missing { background:#fff; border:1.5px dashed #b45309; color:#7c2d12; }
      .result-pill.error { background:#475569; border-color:#334155; color:#fff; }

      #fcratc-table td:nth-child(1) { width:120px; }
      #fcratc-table td:nth-child(2) { width:42px; }
      #fcratc-table td:nth-child(3) { width:auto; }
      #fcratc-table td:nth-child(4) { width:52px; }
      #fcratc-table td:nth-child(5) { width:55px; }

      #fcratc-root.flash-found #fcratc-panel { animation:fcratcFound .6s ease-out; }
      #fcratc-root.flash-missing #fcratc-panel,
      #fcratc-root.flash-error #fcratc-panel { animation:fcratcMissing .6s ease-out; }
      @keyframes fcratcFound {
        0% { box-shadow:0 0 0 3px rgba(11,95,255,.75); }
        100% { box-shadow:0 2px 6px rgba(15,23,42,.12); }
      }
      @keyframes fcratcMissing {
        0% { box-shadow:0 0 0 3px rgba(194,65,12,.78); }
        100% { box-shadow:0 2px 6px rgba(15,23,42,.12); }
      }

        display:none;
        width:34px;
        height:20px;
        padding:0;
        border:1px solid #64748b;
        border-radius:5px;
        box-shadow:none;
        font-size:9px;
        font-weight:900;
        cursor:pointer;
        white-space:nowrap;
      }

      .fcratc-system {
        width:100%;
        margin-top:8px;
        background:#fff;
        border:2px solid #334155;
        border-radius:8px;
        overflow:hidden;
        box-shadow:0 3px 10px rgba(15,23,42,.14);
      }
      .fcratc-system[hidden] { display:none!important; }
      .fcratc-system-head {
        min-height:38px;
        display:flex;
        align-items:center;
        gap:9px;
        padding:5px 8px;
        background:#172033;
        color:#fff;
        border-bottom:2px solid #334155;
        font-size:11px;
      }
      .fcratc-system-title { font-size:16px; font-weight:900; letter-spacing:.2px; }
      .fcratc-system-summary {
        display:inline-flex;
        align-items:center;
        min-height:22px;
        padding:0 7px;
        border:1px solid #64748b;
        border-radius:999px;
        background:#f8fafc;
        color:#334155;
        font-size:10px;
        font-weight:900;
        white-space:nowrap;
      }
      .fcratc-system-recheck {
        margin-left:auto;
        height:25px;
        padding:0 9px;
        border:1px solid #94a3b8;
        border-radius:5px;
        background:#fff;
        color:#111827;
        font-size:10px;
        font-weight:900;
        cursor:pointer;
      }
      .fcratc-system-recheck:disabled { opacity:.55; cursor:wait; }
      .fcratc-system-scroll { width:100%; overflow:auto; background:#fff; }
      #fcratc-system-table {
        width:100%;
        min-width:1260px;
        border-collapse:separate;
        border-spacing:0;
        font-size:10.5px;
        white-space:nowrap;
      }
      #fcratc-system-table th {
        position:sticky;
        top:0;
        z-index:1;
        padding:6px 7px;
        text-align:left;
        background:#dfe7f1;
        color:#172033;
        border-bottom:2px solid #94a3b8;
        font-size:10px;
        font-weight:900;
        letter-spacing:.12px;
      }
      #fcratc-system-table td {
        height:29px;
        padding:5px 7px;
        border-bottom:1px solid #dbe3ec;
        vertical-align:middle;
      }
      #fcratc-system-table tbody tr:nth-child(even) td { background:#f5f8fc; }
      #fcratc-system-table tbody tr:hover td { background:#e7f0fb; }
      #fcratc-system-table td.num { text-align:right; font-weight:900; }
      #fcratc-system-table .title-cell { max-width:330px; overflow:hidden; text-overflow:ellipsis; }
      .fcratc-asin { color:#075eb8; font-weight:900; cursor:help; user-select:text; }
      .fcratc-asin:hover { text-decoration:underline; }
      .fcratc-haz {
        display:inline-flex;
        align-items:center;
        justify-content:center;
        min-width:30px;
        height:19px;
        margin-left:6px;
        padding:0 5px;
        border:1px solid rgba(15,23,42,.28);
        border-radius:999px;
        background:#999;
        color:#111;
        font-size:10px;
        font-weight:900;
      }
      .fcratc-system-caption {
        color:#aebfd2;
        font-size:10px;
        font-weight:800;
        letter-spacing:.45px;
      }
      .fcratc-system-sussy-badge {
        display:inline-flex;
        align-items:center;
        min-height:22px;
        padding:0 7px;
        border:1px solid #f59e0b;
        border-radius:999px;
        background:#fff7ed;
        color:#7c2d12;
        font-size:10px;
        font-weight:900;
        white-space:nowrap;
      }
      .fcratc-system-sussy-badge[hidden] { display:none!important; }
      .fcratc-system-sussy-badge.loading { border-color:#94a3b8; background:#f8fafc; color:#475569; }
      .fcratc-system-sussy-badge.clear { border-color:#22c55e; background:#f0fdf4; color:#14532d; }

      #fcratc-system-table tbody tr.fcratc-system-sussy td {
        background:#fef9c3!important;
      }
      #fcratc-system-table tbody tr.fcratc-system-sussy:hover td {
        background:#fff4a8!important;
      }
      #fcratc-system-table td.fcratc-system-sussy-cell {
        outline:3px dashed rgba(37,99,235,.70);
        outline-offset:-4px;
        background:#fff7ed!important;
        font-weight:900;
      }

      .fcratc-system-message { padding:14px!important; color:#64748b; font-weight:900; text-align:center; }
      .fcratc-system-message.error { color:#9a3412; }

      #fcratc-root.fcratc-standalone {
        padding:10px 12px 24px;
        font-size:14px;
      }
      #fcratc-root.fcratc-standalone #fcratc-panel {
        width:100%;
        border-radius:8px;
      }
      #fcratc-root.fcratc-standalone .fcratc-top {
        min-height:42px;
      }
      #fcratc-root.fcratc-standalone .fcratc-state {
        min-width:92px;
        font-size:13px;
      }
      #fcratc-root.fcratc-standalone #fcratc-input {
        height:34px;
        font-size:17px;
        font-weight:800;
      }
      #fcratc-root.fcratc-standalone .fcratc-btn {
        width:35px;
        height:34px;
        font-size:15px;
      }
      #fcratc-root.fcratc-standalone .fcratc-meta {
        min-height:28px;
        font-size:12.5px;
      }
      #fcratc-root.fcratc-standalone #fcratc-table td {
        height:34px;
        padding:5px 8px;
        font-size:13.5px;
      }
      #fcratc-root.fcratc-standalone .scan-code { font-size:13.5px; }
      #fcratc-root.fcratc-standalone .scan-count,
      #fcratc-root.fcratc-standalone .sort-pill,
      #fcratc-root.fcratc-standalone .bin-size,
      #fcratc-root.fcratc-standalone .madcat-pill,
      #fcratc-root.fcratc-standalone .result-pill {
        font-size:11.5px;
      }

      #fcratc-root.fcratc-standalone .fcratc-system {
        margin-top:12px;
        border-width:2px;
      }
      #fcratc-root.fcratc-standalone .fcratc-system-head {
        min-height:48px;
        padding:7px 10px;
        gap:10px;
      }
      #fcratc-root.fcratc-standalone .fcratc-system-title { font-size:20px; }
      #fcratc-root.fcratc-standalone .fcratc-system-caption { font-size:11px; }
      #fcratc-root.fcratc-standalone .fcratc-system-summary,
      #fcratc-root.fcratc-standalone .fcratc-system-sussy-badge { min-height:25px; font-size:11px; }
      #fcratc-root.fcratc-standalone .fcratc-system-recheck {
        height:30px;
        padding:0 10px;
        font-size:11px;
      }
      #fcratc-root.fcratc-standalone #fcratc-system-table {
        min-width:1450px;
        font-size:13px;
      }
      #fcratc-root.fcratc-standalone #fcratc-system-table th {
        height:34px;
        padding:7px 9px;
        font-size:12px;
      }
      #fcratc-root.fcratc-standalone #fcratc-system-table td {
        height:38px;
        padding:7px 9px;
        font-size:13px;
      }
      #fcratc-root.fcratc-standalone .fcratc-haz {
        min-width:38px;
        height:23px;
        padding:0 7px;
        font-size:11px;
      }
      #fcratc-root.fcratc-standalone .fcratc-asin { font-size:13px; }

      #fcratc-hover-card{position:fixed;z-index:2147483647;width:410px;min-height:150px;padding:8px;display:flex;gap:10px;background:#222;color:#fff;border:1px solid #111;border-radius:5px;box-shadow:0 8px 24px rgba(0,0,0,.35);pointer-events:none;font-family:Arial,Helvetica,sans-serif}#fcratc-hover-card[hidden]{display:none!important}.fcratc-hover-img{flex:0 0 150px;width:150px;height:150px;display:flex;align-items:center;justify-content:center;background:#fff;color:#64748b;overflow:hidden}.fcratc-hover-img img{max-width:100%;max-height:100%;object-fit:contain}.fcratc-hover-info{flex:1;min-width:0;padding-top:3px}.fcratc-hover-info>div{display:grid;grid-template-columns:72px 1fr;align-items:center;gap:5px;margin-bottom:7px}.fcratc-hover-info span{color:#aeb6c2;font-size:9px}.fcratc-hover-info strong{width:max-content;max-width:100%;padding:3px 5px;border-radius:4px;background:#fff3c4;color:#111;font-size:11px;overflow:hidden;text-overflow:ellipsis}.fcratc-hover-info .sortable-hover{background:#ffe55c}.fcratc-hover-info .sortable-hover.no{background:#fecaca}.fcratc-hover-loading{padding:12px;font-weight:800}


      html[data-fcratc-standalone="1"] #fcratc-hover-card {
        width:500px;
        min-height:185px;
        padding:10px;
        gap:12px;
      }
      html[data-fcratc-standalone="1"] .fcratc-hover-img {
        flex-basis:185px;
        width:185px;
        height:185px;
      }
      html[data-fcratc-standalone="1"] .fcratc-hover-info > div {
        grid-template-columns:88px 1fr;
        margin-bottom:9px;
      }
      html[data-fcratc-standalone="1"] .fcratc-hover-info span { font-size:10.5px; }
      html[data-fcratc-standalone="1"] .fcratc-hover-info strong { font-size:13px; padding:4px 6px; }


      .fcratc-sections-open,.fcratc-tote-open,.fcratc-tote-toggle {
        height:33px;padding:0 10px;border:1px solid #a8bdd5;border-radius:6px;
        background:#e8f1fb;color:#163a63;font-size:12.5px;font-weight:900;cursor:pointer;
      }
      .fcratc-sections-open:hover,.fcratc-tote-open:hover,.fcratc-tote-toggle:hover { background:#d8e8f8; }
      @keyframes fcrlite-audit-pulse {
        0%,100% { box-shadow:0 0 0 0 rgba(34,197,94,.12); }
        50% { box-shadow:0 0 0 4px rgba(34,197,94,.22); }
      }
      .fcratc-tote-toggle.active {
        border-color:#22a447;background:#e7f7ec;color:#14532d;
        animation:fcrlite-audit-pulse 1.8s ease-in-out infinite;
      }
      @media (prefers-reduced-motion:reduce) { .fcratc-tote-toggle.active { animation:none; } }

      #fcrlite-sections-app { width:100%; }
      #fcrlite-search {
        flex:1 1 320px;min-width:160px;height:34px;border:1px solid #94a3b8;border-radius:5px;
        padding:0 10px;font-size:15px;font-weight:800;outline:none;
      }
      #fcratc-root.fcratc-standalone .fcratc-litebar > * { flex-shrink:0; }
      #fcratc-root.fcratc-standalone .fcratc-litebar > #fcrlite-search { flex-shrink:1; }
      @media (max-width:1500px) {
        #fcratc-root.fcratc-standalone .fcratc-litebar { gap:5px; }
        .fcratc-lite-sub { display:none; }
        .fcratc-lite-brand { font-size:20px; }
        .fcrlite-go,.fcrlite-toggle-btn,.fcratc-tote-toggle,.fcratc-full-fcr { padding-left:8px;padding-right:8px; }
        .fcrlite-status { max-width:145px;overflow:hidden;text-overflow:ellipsis; }
      }
      @media (max-width:1080px) {
        #fcratc-root.fcratc-standalone .fcratc-litebar { align-items:stretch; }
        #fcrlite-search { order:20;flex:1 1 calc(100% - 88px);min-width:0; }
        .fcrlite-go { order:21;flex:0 0 82px; }
        .fcrlite-status { max-width:110px; }
      }
      @media (max-width:760px) {
        .fcrlite-status { display:none; }
        .fcratc-lite-brand { font-size:18px; }
        .fcratc-core-status { font-size:10.5px;padding:4px 6px; }
        .fcrlite-go,.fcrlite-toggle-btn,.fcratc-tote-toggle,.fcratc-full-fcr { font-size:11px;padding-left:6px;padding-right:6px; }
      }
      .fcrlite-go,.fcrlite-toggle-btn {
        height:34px;border:1px solid #94a3b8;border-radius:5px;padding:0 12px;
        background:#fff;color:#172033;font-size:12.5px;font-weight:900;cursor:pointer;white-space:nowrap;
      }
      .fcrlite-go:disabled { opacity:.55;cursor:wait; }
      .fcrlite-toggle-btn { background:#dbeafe; }
      .fcrlite-status { color:#dbeafe;font-size:12px;font-weight:800;white-space:nowrap; }
      .fcrlite-toggles {
        display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:4px 10px;
        margin-top:7px;padding:9px;border:1px solid #a8bdd5;border-radius:7px;background:#fff;
      }
      .fcrlite-toggles[hidden] { display:none; }
      .fcrlite-toggle {
        display:flex;align-items:center;gap:7px;min-height:28px;padding:3px 6px;
        border-radius:5px;font-size:13.5px;font-weight:700;cursor:pointer;
      }
      .fcrlite-toggle:hover { background:#eef5fc; }
      .fcrlite-toggle input { width:16px;height:16px;accent-color:#0f5fbf; }
      .fcrlite-results { display:grid;gap:10px;margin-top:8px; }
      .fcrlite-card {
        overflow:visible;border:1px solid #c7d0da;border-radius:5px;background:#fff;
        box-shadow:0 1px 2px rgba(15,23,42,.05);
      }
      .fcrlite-card-head {
        display:flex;align-items:center;gap:8px;min-height:33px;padding:5px 10px;background:#dce6f0;
        border-bottom:1px solid #b8c6d5;color:#10243a;font-size:15px;font-weight:900;letter-spacing:.01em;
      }
      .fcrlite-card-head .meta { margin-left:auto;color:#52606d;font-size:11.5px;font-weight:700; }
      .fcrlite-card.partial { border-color:#d97706; }
      .fcrlite-card.partial .fcrlite-card-head { background:#fff7ed; }
      .fcrlite-card-body { overflow-x:auto;overflow-y:visible;max-height:none;padding:8px;color:#172536;font-size:13.5px; }
      .fcrlite-card.loading .fcrlite-card-body { color:#64748b;font-weight:800; }
      .fcrlite-card.error .fcrlite-card-body { color:#991b1b;font-weight:800; }
      .fcrlite-card-body table { width:100%;border-collapse:collapse;font-size:13.5px;line-height:1.34; }
      .fcrlite-card-body th,.fcrlite-card-body td {
        padding:6px 8px;border:0;border-right:1px solid #e0e6ec;border-bottom:1px solid #c9d3dd;text-align:left;vertical-align:top;white-space:nowrap;
      }
      .fcrlite-card-body th {
        background:#d7e1eb;color:#10243a;border-right:1px solid #c3ced8;border-bottom:2px solid #aebdca;font-weight:900;
      }
      .fcrlite-card:not([data-endpoint="product"]) .fcrlite-card-body tbody tr:nth-child(even) > td {
        background:#e7eff7;
      }
      .fcrlite-card:not([data-endpoint="product"]) .fcrlite-card-body tbody tr:hover > td {
        background:#d7e8f6;
      }
      .fcrlite-card-body a { color:#005ea8;text-decoration:none; }
      .fcrlite-card-body a:hover { text-decoration:underline; }
      .fcrlite-card:not([data-endpoint="product"]) .fcrlite-card-body tbody td { transition:background-color .08s linear; }
      .fcrlite-card:not([data-endpoint="product"]) .fcrlite-card-body tbody tr:nth-child(odd) > td { background:#fff; }
      .fcrlite-card[data-endpoint="inventory"] .fcrlite-card-body tbody tr:nth-child(even) > td,
      .fcrlite-card[data-endpoint="inventory-history"] .fcrlite-card-body tbody tr:nth-child(even) > td { background:#e2edf7; }
      .fcrlite-card[data-endpoint="inventory"] .fcrlite-card-body tbody tr:hover > td,
      .fcrlite-card[data-endpoint="inventory-history"] .fcrlite-card-body tbody tr:hover > td { background:#cfe3f4; }
      .fcrlite-card-body img { max-width:170px;max-height:230px;object-fit:contain; }
      .fcrlite-card-body .section-title { font-size:17px;font-weight:900; }
      .fcrlite-card-body .help,.fcrlite-card-body .filters-popover,.fcrlite-card-body .a-popover-preload,
      .fcrlite-card-body script,.fcrlite-card-body style { display:none!important; }
      .fcrlite-card[data-endpoint="product"] .fcrlite-card-body { overflow-x:auto;overflow-y:visible; }
      .fcrlite-card[data-endpoint="inventory"] .fcrlite-card-body,
      .fcrlite-card[data-endpoint="inventory-history"] .fcrlite-card-body {
        overflow:auto;
        max-height:min(72vh,780px);
        overscroll-behavior:contain;
        scrollbar-gutter:stable;
      }
      .fcrlite-card[data-endpoint="inventory"] #table-inventory,
      .fcrlite-card[data-endpoint="inventory-history"] table {
        width:max-content!important;
        min-width:100%!important;
      }
      .fcrlite-card[data-endpoint="inventory"] #table-inventory th#inventory-title,
      .fcrlite-card[data-endpoint="inventory"] #table-inventory td:last-child {
        width:360px;
        max-width:360px;
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
      }
      .fcrlite-card[data-endpoint="product"] .a-box-group,.fcrlite-card[data-endpoint="product"] .a-box,
      .fcrlite-card[data-endpoint="product"] .a-box-inner { margin:0!important;padding-top:0!important;padding-bottom:0!important; }
      .fcrlite-card[data-endpoint="product"] .fcrlite-card-body { padding:10px 14px; }
      .fcrlite-card[data-endpoint="product"] table { width:min(100%,1280px)!important;min-width:760px;max-width:1280px; }
      .fcrlite-card[data-endpoint="product"] td,.fcrlite-card[data-endpoint="product"] th { white-space:normal; }
      .fcrlite-card[data-endpoint="product"] img { max-width:375px;max-height:450px; }
      .fcrlite-card.fcrlite-product-single .a-box.a-last > .a-box-inner > .a-row {
        display:flex!important;align-items:flex-start;gap:18px;max-width:1500px;min-width:0;
      }
      .fcrlite-card.fcrlite-product-single .a-box.a-last > .a-box-inner > .a-row > .a-span4 {
        flex:0 0 395px!important;width:395px!important;min-width:320px;max-width:395px;
      }
      .fcrlite-card.fcrlite-product-single .a-box.a-last > .a-box-inner > .a-row > .a-span7 {
        flex:1 1 auto!important;width:auto!important;min-width:0;max-width:1085px;
      }
      .fcrlite-card.fcrlite-product-single .a-box.a-last > .a-box-inner > .a-row > .a-span7 > table {
        width:100%!important;min-width:0!important;max-width:none!important;
      }
      .fcrlite-card.fcrlite-product-single .a-box.a-last > .a-box-inner > .a-row > .a-span4 img {
        display:block;margin:0 auto;max-width:375px;max-height:450px;
      }
      @media (max-width:1180px) {
        .fcrlite-card.fcrlite-product-single .a-box.a-last > .a-box-inner > .a-row > .a-span4 {
          flex-basis:300px!important;width:300px!important;min-width:240px;max-width:300px;
        }
        .fcrlite-card.fcrlite-product-single .a-box.a-last > .a-box-inner > .a-row > .a-span4 img {
          max-width:285px;max-height:360px;
        }
      }
      .fcrlite-native-tools { display:flex;align-items:center;gap:8px;min-height:32px;padding:4px 8px;border-bottom:1px solid #d5dde6;background:#f7f9fb; }
      .fcrlite-native-info { padding:4px 8px;color:#52606d;font-size:11px;font-weight:700; }
      .fcrlite-inventory-search { margin-left:auto;display:flex;align-items:center;gap:6px; }
      .fcrlite-inventory-search::before { content:'⌕';color:#334155;font-size:17px;font-weight:900;line-height:1; }
      .fcrlite-inventory-filter { width:245px;height:29px;padding:0 9px;border:1px solid #8f9ead;border-radius:6px;background:#fff;color:#172536;font:700 12.5px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;outline:none; }
      .fcrlite-inventory-filter:focus { border-color:#4f83b7;box-shadow:0 0 0 2px rgba(79,131,183,.14); }
      .fcrlite-card[data-endpoint="inventory"] > .fcrlite-card-head .meta { margin-left:0; }
      .fcrlite-inventory-summary { display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-left:8px; }
      .fcrlite-summary-chip { display:inline-flex;align-items:center;height:23px;padding:0 8px;border:1px solid #b7c5d2;border-radius:10px;background:#eef4f9;color:#20364d;font:800 11.5px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;white-space:nowrap; }
      .fcrlite-sortable { cursor:pointer;user-select:none; }
      .fcrlite-sortable:hover { background:#e9eff5!important; }
      .fcrlite-sortable[data-fcrlite-sort="asc"]::after { content:' ▲';font-size:9px;color:#315d87; }
      .fcrlite-sortable[data-fcrlite-sort="desc"]::after { content:' ▼';font-size:9px;color:#315d87; }
      .fcrlite-card[data-endpoint="inventory"] > .fcrlite-card-head {
        position:sticky;top:var(--fcrlite-bar-height);z-index:32;
      }
      .fcrlite-inventory-sticky-shell {
        position:sticky;top:0;z-index:31;height:0;overflow:visible;pointer-events:none;
      }
      .fcrlite-inventory-sticky-inner {
        display:none;overflow:hidden;background:#d7e1eb;border-bottom:1px solid #aebdca;
        box-shadow:0 2px 4px rgba(15,23,42,.10);pointer-events:auto;
      }
      .fcrlite-inventory-sticky-shell.active .fcrlite-inventory-sticky-inner { display:block; }
      .fcrlite-inventory-sticky-table {
        width:max-content!important;min-width:100%;border-collapse:collapse;table-layout:fixed;
        margin:0!important;font-size:13.5px;line-height:1.34;background:#d7e1eb;
      }
      .fcrlite-inventory-sticky-table th {
        padding:6px 8px;border:0;border-right:1px solid #c3ced8;border-bottom:2px solid #aebdca;background:#d7e1eb;color:#10243a;
        text-align:left;vertical-align:top;white-space:nowrap;font-weight:900;
      }
      .fcrlite-id-map { display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:0 0 8px;padding:6px 9px;border:1px solid #c7d0d9;border-radius:5px;background:#f2f6fa;color:#1f2937;font:700 12px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif; }
      .fcrlite-id-map .label { color:#526273;font-weight:800; }
      .fcrlite-id-map .value { color:#0b4f8a;font-weight:900; }
      .fcrlite-id-map .sep { color:#9aa7b5;font-weight:900; }
      .fcrlite-multi-product { width:100%!important;min-width:1080px!important;max-width:none!important;table-layout:auto; }
      .fcrlite-multi-product .fcrlite-thumb-head { width:92px;min-width:92px; }
      .fcrlite-multi-product .fcrlite-qty-head { width:88px;min-width:88px;text-align:center; }
      .fcrlite-multi-product .fcrlite-thumb-cell { width:92px;min-width:92px;height:92px;text-align:center;vertical-align:middle;background:#fff; }
      .fcrlite-multi-product .fcrlite-thumb-cell img { width:82px;height:82px;max-width:82px!important;max-height:82px!important;object-fit:contain; }
      .fcrlite-multi-product .fcrlite-thumb-placeholder { display:inline-flex;width:82px;height:82px;align-items:center;justify-content:center;color:#7b8794;font-size:10px;font-weight:800;background:#f7f9fb;border:1px solid #dde3ea;border-radius:4px; }
      .fcrlite-multi-product .fcrlite-asin-total { text-align:center;font-size:15px;font-weight:900;white-space:nowrap; }
      .fcrlite-multi-product tbody tr { min-height:94px; }
      .fcrlite-card[data-endpoint="inventory-history"] > .fcrlite-card-head {
        position:sticky;top:var(--fcrlite-bar-height);z-index:30;
      }
      .fcrlite-history-tools {
        position:sticky;top:calc(var(--fcrlite-bar-height) + 39px);z-index:29;
        display:flex;align-items:center;gap:9px;min-height:52px;padding:7px 10px;
        background:#f3f5f7;border:1px solid #cbd5df;border-radius:4px;
        box-shadow:0 1px 2px rgba(15,23,42,.05);
      }
      .fcrlite-history-title { margin-right:8px;font-size:17px;font-weight:900;white-space:nowrap; }
      .fcrlite-history-tools label { display:flex;align-items:center;gap:5px;font-size:12.5px;font-weight:800;white-space:nowrap; }
      .fcrlite-history-tools input[type="date"] {
        height:34px;padding:0 8px;border:1px solid #9ca3af;border-radius:5px;background:#fff;
        color:#111827;font:800 13px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;cursor:pointer;
      }
      .fcrlite-history-search {
        height:34px;padding:0 12px;border:1px solid #9ca3af;border-radius:5px;background:#fff;
        color:#111827;font-size:12.5px;font-weight:900;cursor:pointer;
      }
      .fcrlite-history-search:disabled { opacity:.55;cursor:wait; }
      .fcrlite-history-note { color:#52606d;font-size:11.5px;font-weight:700;white-space:nowrap; }
      .fcrlite-card[data-endpoint="inventory-history"] #table-inventory-history thead th {
        position:sticky;top:calc(var(--fcrlite-bar-height) + 91px);z-index:28;background:#d7e1eb;
        border-color:#aebdca;
      }
      .fcrlite-empty { padding:18px;text-align:center;color:#64748b;font-weight:800; }
      @media (max-width:900px) {
        #fcratc-root { width:100%; }
        .fcratc-status { display:none; }
        .fcratc-summary { display:none; }
        #fcratc-table td:nth-child(1) { width:108px; }
        #fcratc-table td:nth-child(2) { width:38px; }
        #fcratc-table td:nth-child(4) { width:45px; }
        #fcratc-table td:nth-child(5) { width:49px; }
      }
    `;
    document.documentElement.appendChild(style);
  }

  function installDimensionsLauncher() {
    document.addEventListener('click', event => {
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      const cell = event.target.closest('th,td');
      if (!cell || clean(cell.textContent).toLowerCase() !== 'dimensions') return;
      if (!cell.closest('[data-section-type="product"]')) return;
      event.preventDefault();
      event.stopPropagation();
      const search = clean(new URLSearchParams(location.search).get('s'));
      openSectionsMode(search);
    }, true);
  }


  function cleanSectionMarkup(endpoint, html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    doc.querySelectorAll('script,style,.help,.filters-popover,.a-popover-preload').forEach(node => node.remove());
    const titleBox = doc.querySelector('.a-box-group > .a-box.a-first.a-box-title');
    if (titleBox) titleBox.remove();
    return doc.body.innerHTML.trim();
  }

  function installInventoryHistoryControls(card, selectedStart, selectedEnd, onSearch) {
    const body = card?.querySelector('.fcrlite-card-body');
    if (!body) return;
    body.querySelector('.fcrlite-history-tools')?.remove();

    const bounds = historyDateBounds();
    const controls = document.createElement('div');
    controls.className = 'fcrlite-history-tools';
    controls.innerHTML = `
      <span class="fcrlite-history-title">Inventory History</span>
      <label>Start <input class="fcrlite-history-start" type="date" min="${esc(bounds.min)}" max="${esc(bounds.max)}"></label>
      <label>End <input class="fcrlite-history-end" type="date" min="${esc(bounds.min)}" max="${esc(bounds.max)}"></label>
      <button type="button" class="fcrlite-history-search">SEARCH</button>
      <span class="fcrlite-history-note">Max 6 months</span>
    `;
    body.prepend(controls);

    const start = controls.querySelector('.fcrlite-history-start');
    const end = controls.querySelector('.fcrlite-history-end');
    const searchButton = controls.querySelector('.fcrlite-history-search');
    const note = controls.querySelector('.fcrlite-history-note');
    start.value = selectedStart || '';
    end.value = selectedEnd || '';

    const syncBounds = () => {
      start.max = end.value || bounds.max;
      end.min = start.value || bounds.min;
    };
    syncBounds();
    start.addEventListener('change', syncBounds);
    end.addEventListener('change', syncBounds);

    searchButton.addEventListener('click', async () => {
      const startDate = start.value;
      const endDate = end.value;
      if (!!startDate !== !!endDate) {
        note.textContent = 'Pick both dates';
        return;
      }
      if (startDate && (startDate < bounds.min || endDate > bounds.max || startDate > endDate)) {
        note.textContent = 'Invalid range';
        return;
      }
      searchButton.disabled = true;
      note.textContent = startDate ? 'Loading range…' : 'Loading default…';
      try {
        await onSearch(startDate, endDate);
      } finally {
        if (searchButton.isConnected) searchButton.disabled = false;
      }
    });
  }

  const PRODUCT_SINGLE_ALWAYS = new Set([
    'asin', 'fnsku', 'fcsku', 'title', 'vendor code', 'weight', 'dimensions',
    'list price', 'expiration date', 'pack quantity', 'sortable', 'conveyable'
  ]);
  const PRODUCT_SINGLE_IDENTIFIER_DETAIL = new Set(['provenance value', 'provenance iog']);
  const PRODUCT_MULTI_KEEP = new Set([
    'asin', 'fnsku', 'fcsku', 'title', 'vendor code', 'expiration date',
    'dimensions', 'weight', 'list price', 'sortable', 'conveyable'
  ]);

  function normaliseProductHeader(value) {
    return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function warehouseFromPath() {
    const match = location.pathname.match(/^\/([^/]+)\/results(?:\/|$)/i);
    return clean(match?.[1] || '').toUpperCase();
  }

  function firstTableWithHeaders(body, required = []) {
    for (const table of body?.querySelectorAll?.('table') || []) {
      const headRow = table.tHead?.rows?.[0] || [...table.rows].find(row => row.querySelector('th'));
      if (!headRow) continue;
      const headers = [...headRow.cells].map(cell => normaliseProductHeader(cell.textContent));
      if (required.every(label => headers.includes(label))) return { table, headRow, headers };
    }
    return null;
  }

  function trimVerticalProductTable(table) {
    const labels = [...table.querySelectorAll('tr')]
      .map(row => normaliseProductHeader(row.cells?.[0]?.textContent || ''))
      .filter(Boolean);
    const scopeRow = [...table.querySelectorAll('tr')].find(
      row => normaliseProductHeader(row.cells?.[0]?.textContent || '') === 'fcsku scope'
    );
    const scopeValue = clean(scopeRow?.cells?.[1]?.textContent || '').toUpperCase();
    const identifierDetail =
      labels.includes('fnsku') ||
      labels.includes('fcsku') ||
      scopeValue === 'FNSKU' ||
      scopeValue === 'LOT';

    for (const row of [...table.querySelectorAll('tr')]) {
      const cells = [...row.children].filter(cell => /^(?:TD|TH)$/.test(cell.tagName));
      if (cells.length < 2) continue;
      const label = normaliseProductHeader(cells[0].textContent);
      const keep =
        PRODUCT_SINGLE_ALWAYS.has(label) ||
        (identifierDetail && PRODUCT_SINGLE_IDENTIFIER_DETAIL.has(label));
      if (!keep) row.remove();
    }
  }

  function productAsinFromRow(row, asinIndex) {
    if (!row || asinIndex < 0) return '';
    return clean(row.cells?.[asinIndex]?.textContent || '').match(/\b[A-Z0-9]{10}\b/i)?.[0]?.toUpperCase() || '';
  }

  function prepareMultiAsinProductTable(table, headRow, headers) {
    if (table.dataset.fcrliteMultiReady === '1') return true;
    const asinIndex = headers.indexOf('asin');
    if (asinIndex < 0) return false;

    const keepIndexes = headers
      .map((label, index) => PRODUCT_MULTI_KEEP.has(label) ? index : -1)
      .filter(index => index >= 0);
    if (!keepIndexes.length) return false;

    for (const row of [...table.rows]) {
      for (let index = row.cells.length - 1; index >= 0; index--) {
        if (!keepIndexes.includes(index)) row.deleteCell(index);
      }
    }

    const keptHeaders = keepIndexes.map(index => headers[index]);
    const keptAsinIndex = keptHeaders.indexOf('asin');

    const imageHead = document.createElement('th');
    imageHead.className = 'fcrlite-thumb-head';
    imageHead.textContent = 'Image';
    headRow.insertBefore(imageHead, headRow.cells[0] || null);

    const qtyHead = document.createElement('th');
    qtyHead.className = 'fcrlite-qty-head';
    qtyHead.textContent = 'Total Qty';
    headRow.appendChild(qtyHead);

    const bodyRows = table.tBodies?.[0] ? [...table.tBodies[0].rows] : [...table.rows].filter(row => row !== headRow);
    for (const row of bodyRows) {
      const asin = productAsinFromRow(row, keptAsinIndex);
      const imageCell = row.insertCell(0);
      imageCell.className = 'fcrlite-thumb-cell';
      if (asin) {
        imageCell.dataset.fcrliteImageAsin = asin;
        imageCell.innerHTML = '<span class="fcrlite-thumb-placeholder">IMAGE…</span>';
      } else {
        imageCell.innerHTML = '<span class="fcrlite-thumb-placeholder">—</span>';
      }

      const qtyCell = row.insertCell(-1);
      qtyCell.className = 'fcrlite-asin-total';
      if (asin) qtyCell.dataset.fcrliteQtyAsin = asin;
      qtyCell.textContent = '—';
    }

    table.classList.add('fcrlite-multi-product');
    table.dataset.fcrliteMultiReady = '1';
    return true;
  }

  function shapeProductSection(card) {
    const body = card?.querySelector('.fcrlite-card-body');
    if (!body) return { multi: false, asins: [] };

    const horizontal = firstTableWithHeaders(body, ['asin', 'fnsku', 'fcsku', 'title']);
    card.classList.remove('fcrlite-product-single');
    if (horizontal && (horizontal.table.tBodies?.[0]?.rows?.length || 0) > 1) {
      const multi = prepareMultiAsinProductTable(horizontal.table, horizontal.headRow, horizontal.headers);
      const asins = [...horizontal.table.querySelectorAll('[data-fcrlite-image-asin]')]
        .map(cell => clean(cell.dataset.fcrliteImageAsin).toUpperCase()).filter(Boolean);
      return { multi, asins: [...new Set(asins)] };
    }

    const keyValue = body.querySelector('.a-keyvalue') || [...body.querySelectorAll('table')].find(table => {
      return [...table.querySelectorAll('tr')].some(row => normaliseProductHeader(row.cells?.[0]?.textContent) === 'asin');
    });
    if (keyValue) {
      trimVerticalProductTable(keyValue);
      card.classList.add('fcrlite-product-single');
    }
    return { multi: false, asins: [] };
  }

  function productIdentifierSets(card) {
    const body = card?.querySelector?.('.fcrlite-card-body');
    const asins = new Set();
    const fnskus = new Set();
    if (!body) return { asins: [], fnskus: [] };

    const horizontal = firstTableWithHeaders(body, ['asin', 'fnsku']);
    if (horizontal) {
      const asinIndex = horizontal.headers.indexOf('asin');
      const fnskuIndex = horizontal.headers.indexOf('fnsku');
      for (const row of horizontal.table.tBodies?.[0]?.rows || []) {
        const asin = clean(row.cells?.[asinIndex]?.textContent || '').match(/\b[A-Z0-9]{10}\b/i)?.[0]?.toUpperCase() || '';
        const fnsku = fnskuIndex >= 0 ? clean(row.cells?.[fnskuIndex]?.textContent || '').match(/\b[A-Z0-9]{10}\b/i)?.[0]?.toUpperCase() || '' : '';
        if (asin) asins.add(asin);
        if (fnsku) fnskus.add(fnsku);
      }
    } else {
      for (const row of body.querySelectorAll('tr')) {
        const label = normaliseProductHeader(row.cells?.[0]?.textContent || '');
        const value = clean(row.cells?.[1]?.textContent || '').match(/\b[A-Z0-9]{10}\b/i)?.[0]?.toUpperCase() || '';
        if (!value) continue;
        if (label === 'asin') asins.add(value);
        if (label === 'fnsku') fnskus.add(value);
      }
    }
    return { asins: [...asins], fnskus: [...fnskus] };
  }

  function renderIdentifierRelationship(card, rawInput) {
    const body = card?.querySelector?.('.fcrlite-card-body');
    if (!body) return;
    body.querySelector('.fcrlite-id-map')?.remove();
    const raw = String(rawInput ?? '').trim();
    const { asins, fnskus } = productIdentifierSets(card);
    if (!raw && !asins.length && !fnskus.length) return;

    const map = document.createElement('div');
    map.className = 'fcrlite-id-map';
    const add = (label, values) => {
      if (!values?.length) return;
      if (map.childElementCount) {
        const sep = document.createElement('span');
        sep.className = 'sep';
        sep.textContent = '→';
        map.appendChild(sep);
      }
      const labelNode = document.createElement('span');
      labelNode.className = 'label';
      labelNode.textContent = label;
      const valueNode = document.createElement('span');
      valueNode.className = 'value';
      valueNode.textContent = values.join(', ');
      map.append(labelNode, valueNode);
    };

    if (raw) add('INPUT', [raw]);
    const sameSets = asins.length === fnskus.length && asins.length > 0 && asins.every(value => fnskus.includes(value));
    if (sameSets) add('ASIN/FNSKU', asins);
    else {
      add(asins.length > 1 ? 'ASINS' : 'ASIN', asins);
      add(fnskus.length > 1 ? 'FNSKUS' : 'FNSKU', fnskus);
    }
    body.prepend(map);
  }

  async function loadMultiAsinImages(card, asins, requestGroup = '') {
    if (!card?.isConnected || !asins?.length) return;
    await mapLimit(asins, 3, async asin => {
      if (!card.isConnected) return;
      let img = '';
      try {
        const result = await coreRequest('product', { code: asin, require: ['img'] }, 30000, requestGroup);
        img = clean(result?.product?.img || '');
      } catch {}
      if (!card.isConnected) return;
      for (const cell of card.querySelectorAll(`[data-fcrlite-image-asin="${CSS.escape(asin)}"]`)) {
        cell.innerHTML = img
          ? `<img src="${esc(img)}" alt="${esc(asin)}">`
          : '<span class="fcrlite-thumb-placeholder">NO IMAGE</span>';
      }
    });
  }

  function inventoryTotalsByAsin(resultsRoot) {
    const table = resultsRoot?.querySelector?.('#table-inventory');
    if (!table) return null;
    const headRow = table.tHead?.rows?.[0] || [...table.rows].find(row => row.querySelector('th'));
    if (!headRow) return null;
    const headers = [...headRow.cells].map(cell => normaliseProductHeader(cell.textContent).replace(/\s*\(.*\)$/, ''));
    const asinIndex = headers.indexOf('asin');
    const qtyIndex = headers.findIndex(value => value === 'quantity' || value.startsWith('quantity '));
    if (asinIndex < 0 || qtyIndex < 0) return null;
    const totals = new Map();
    for (const row of table.tBodies?.[0]?.rows || []) {
      const asin = clean(row.cells?.[asinIndex]?.textContent || '').match(/\b[A-Z0-9]{10}\b/i)?.[0]?.toUpperCase() || '';
      if (!asin) continue;
      const qty = Number(clean(row.cells?.[qtyIndex]?.textContent || '').replace(/[^\d.-]/g, '')) || 0;
      totals.set(asin, (totals.get(asin) || 0) + qty);
    }
    return totals;
  }

  function refreshMultiAsinTotals(resultsRoot) {
    const totals = inventoryTotalsByAsin(resultsRoot);
    if (!totals) return;
    const inventoryCard = resultsRoot.querySelector('[data-endpoint="inventory"]');
    const partial = inventoryCard?.classList.contains('partial') === true;
    for (const cell of resultsRoot.querySelectorAll('[data-fcrlite-qty-asin]')) {
      const asin = clean(cell.dataset.fcrliteQtyAsin).toUpperCase();
      if (!totals.has(asin)) {
        cell.textContent = '0';
        continue;
      }
      const total = totals.get(asin);
      cell.textContent = partial ? `${total}+` : String(total);
      cell.title = partial ? 'Partial inventory result' : `Total inventory quantity for ${asin}`;
    }
  }

  function inventoryColumnIndexes(table) {
    const headRow = table?.tHead?.rows?.[0] || [...(table?.rows || [])].find(row => row.querySelector('th'));
    const headers = headRow ? [...headRow.cells].map(cell => normaliseProductHeader(cell.textContent).replace(/\s*\(.*\)$/, '')) : [];
    const find = name => headers.findIndex(value => value === name || value.startsWith(`${name} `));
    return { headRow, headers, qty: find('quantity'), disposition: find('disposition') };
  }

  function renderInventorySummary(card, data = {}) {
    const head = card?.querySelector?.('.fcrlite-card-head');
    const table = card?.querySelector?.('#table-inventory');
    if (!head || !table) return;
    const { qty, disposition } = inventoryColumnIndexes(table);
    const rows = [...(table.tBodies?.[0]?.rows || [])];
    const totals = new Map();
    for (const row of rows) {
      if (disposition >= 0) {
        const value = clean(row.cells?.[disposition]?.textContent || '').toUpperCase() || 'UNKNOWN';
        const amount = qty >= 0 ? Number(clean(row.cells?.[qty]?.textContent || '').replace(/[^\d.-]/g, '')) || 0 : 1;
        totals.set(value, (totals.get(value) || 0) + amount);
      }
    }

    let wrap = head.querySelector('.fcrlite-inventory-summary');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'fcrlite-inventory-summary';
      const search = head.querySelector('.fcrlite-inventory-search');
      if (search) head.insertBefore(wrap, search);
      else head.appendChild(wrap);
    }
    const partial = data?.preview === true || data?.complete === false;
    const suffix = partial ? '+' : '';
    const chips = [];
    for (const [name, amount] of totals.entries()) {
      chips.push(`<span class="fcrlite-summary-chip">${esc(name)} ${amount}${suffix}</span>`);
    }
    wrap.innerHTML = chips.join('');
  }

  function inventorySortValue(cell, numeric = false) {
    const text = clean(cell?.textContent || '');
    if (!numeric) return text.toLowerCase();
    const value = Number(text.replace(/[^\d.-]/g, ''));
    return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
  }

  function applyInventorySort(card) {
    const state = card?._fcrliteInventorySort;
    const table = card?.querySelector?.('#table-inventory');
    if (!state || !table?.tBodies?.[0]) return;
    const { headRow, headers } = inventoryColumnIndexes(table);
    if (!headRow || state.index < 0 || state.index >= headers.length) return;
    const numeric = headers[state.index] === 'quantity' || headers[state.index].startsWith('quantity ');
    const rows = [...table.tBodies[0].rows];
    rows.sort((a, b) => {
      const av = inventorySortValue(a.cells?.[state.index], numeric);
      const bv = inventorySortValue(b.cells?.[state.index], numeric);
      let result = numeric ? av - bv : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });
      if (state.direction === 'desc') result *= -1;
      return result;
    });
    for (const row of rows) table.tBodies[0].appendChild(row);
    for (const th of headRow.cells) delete th.dataset.fcrliteSort;
    headRow.cells[state.index].dataset.fcrliteSort = state.direction;
    applyInventoryLiveFilter(card);
  }

  function installInventorySorting(card) {
    const table = card?.querySelector?.('#table-inventory');
    if (!table) return;
    const { headRow } = inventoryColumnIndexes(table);
    if (!headRow) return;
    [...headRow.cells].forEach((th, index) => {
      th.classList.add('fcrlite-sortable');
      th.title = 'Click to sort';
      th.addEventListener('click', () => {
        const current = card._fcrliteInventorySort;
        card._fcrliteInventorySort = current?.index === index
          ? { index, direction: current.direction === 'asc' ? 'desc' : 'asc' }
          : { index, direction: 'asc' };
        applyInventorySort(card);
      });
    });
    if (card._fcrliteInventorySort) applyInventorySort(card);
  }

  function installStickyInventoryHeader(card) {
    card?._fcrliteStickyHeaderCleanup?.();
    if (!card) return;

    const body = card.querySelector('.fcrlite-card-body');
    const table = body?.querySelector('#table-inventory');
    const headRow = table?.tHead?.rows?.[0];
    const cardHead = card.querySelector(':scope > .fcrlite-card-head');
    if (!body || !table || !headRow || !cardHead) return;

    card.querySelector(':scope > .fcrlite-inventory-sticky-shell')?.remove();
    const shell = document.createElement('div');
    shell.className = 'fcrlite-inventory-sticky-shell';
    shell.setAttribute('aria-hidden', 'true');
    const inner = document.createElement('div');
    inner.className = 'fcrlite-inventory-sticky-inner';
    const cloneTable = document.createElement('table');
    cloneTable.className = 'fcrlite-inventory-sticky-table';
    const cloneHead = table.tHead.cloneNode(true);
    cloneTable.appendChild(cloneHead);
    inner.appendChild(cloneTable);
    shell.appendChild(inner);
    cardHead.insertAdjacentElement('afterend', shell);

    let frame = 0;
    const cloneCells = () => [...(cloneHead.rows?.[0]?.cells || [])];
    const originalCells = () => [...(headRow.cells || [])];
    const setStyle = (element, property, value) => {
      if (element.style[property] !== value) element.style[property] = value;
    };
    const setClassName = (element, value) => {
      if (element.className !== value) element.className = value;
    };
    const setTitle = (element, value) => {
      if (element.title !== value) element.title = value;
    };

    const syncGeometryAndState = () => {
      frame = 0;
      if (!card.isConnected || !table.isConnected) return;
      const originals = originalCells();
      const clones = cloneCells();
      if (!originals.length || originals.length !== clones.length) return;

      const width = Math.max(table.scrollWidth || 0, table.getBoundingClientRect().width || 0);
      setStyle(cloneTable, 'width', `${Math.ceil(width)}px`);
      clones.forEach((clone, index) => {
        const original = originals[index];
        const cellWidth = `${Math.ceil(Math.max(1, original.getBoundingClientRect().width || original.offsetWidth || 0))}px`;
        setStyle(clone, 'width', cellWidth);
        setStyle(clone, 'minWidth', cellWidth);
        setStyle(clone, 'maxWidth', cellWidth);
        setClassName(clone, original.className);
        setTitle(clone, original.title || '');
        const sort = original.dataset.fcrliteSort;
        if (sort) {
          if (clone.dataset.fcrliteSort !== sort) clone.dataset.fcrliteSort = sort;
        } else if (clone.dataset.fcrliteSort !== undefined) {
          delete clone.dataset.fcrliteSort;
        }
      });

      setStyle(cloneTable, 'transform', `translateX(${-Math.round(body.scrollLeft || 0)}px)`);
      const bodyRect = body.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const bodyStyle = getComputedStyle(body);
      const padLeft = parseFloat(bodyStyle.paddingLeft) || 0;
      const padRight = parseFloat(bodyStyle.paddingRight) || 0;
      setStyle(inner, 'marginLeft', `${Math.round(bodyRect.left - cardRect.left + padLeft)}px`);
      setStyle(inner, 'width', `${Math.max(0, Math.floor(body.clientWidth - padLeft - padRight))}px`);

      const rootStyle = getComputedStyle(root || document.documentElement);
      const barTop = parseFloat(rootStyle.getPropertyValue('--fcrlite-bar-height')) || 0;
      const sectionHeadHeight = Math.ceil(cardHead.getBoundingClientRect().height || 0);
      const stickyTop = Math.max(0, barTop + sectionHeadHeight);
      setStyle(shell, 'top', `${stickyTop}px`);

      const originalHeadRect = table.tHead.getBoundingClientRect();
      const stickyHeight = Math.ceil(inner.getBoundingClientRect().height || originalHeadRect.height || 0);
      const shouldShow = originalHeadRect.top < stickyTop && cardRect.bottom > stickyTop + stickyHeight;
      if (shell.classList.contains('active') !== shouldShow) shell.classList.toggle('active', shouldShow);
    };

    const scheduleSync = () => {
      if (frame) return;
      frame = requestAnimationFrame(syncGeometryAndState);
    };

    cloneCells().forEach((clone, index) => {
      clone.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const original = originalCells()[index];
        if (!original) return;
        original.click();
        requestAnimationFrame(scheduleSync);
      });
    });

    body.addEventListener('scroll', scheduleSync, { passive: true });
    window.addEventListener('scroll', scheduleSync, { passive: true });
    window.addEventListener('resize', scheduleSync, { passive: true });
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleSync) : null;
    resizeObserver?.observe(body);
    resizeObserver?.observe(table);
    resizeObserver?.observe(cardHead);

    card._fcrliteStickyHeaderCleanup = () => {
      if (frame) cancelAnimationFrame(frame);
      body.removeEventListener('scroll', scheduleSync);
      window.removeEventListener('scroll', scheduleSync);
      window.removeEventListener('resize', scheduleSync);
      resizeObserver?.disconnect();
      shell.remove();
      delete card._fcrliteStickyHeaderCleanup;
    };

    scheduleSync();
  }

  function inventoryFilterTerms(value) {
    return clean(value).toLowerCase().split(/\s+/).filter(Boolean);
  }

  function applyInventoryLiveFilter(card) {
    const table = card?.querySelector?.('#table-inventory');
    const input = card?.querySelector?.('.fcrlite-inventory-filter');
    if (!table || !input) return;

    const terms = inventoryFilterTerms(input.value);
    const rows = [...(table.tBodies?.[0]?.rows || [])];
    const { headRow, qty } = inventoryColumnIndexes(table);
    let visible = 0;
    let visibleUnits = 0;

    for (const row of rows) {
      const text = clean(row.textContent).toLowerCase();
      const match = !terms.length || terms.every(term => text.includes(term));
      row.hidden = !match;

      if (match) {
        visible++;
        if (qty >= 0) {
          visibleUnits += Number(clean(row.cells?.[qty]?.textContent || '').replace(/[^\d.-]/g, '')) || 0;
        }
      }
    }

    // Match native FCResearch behaviour: Quantity(...) reflects only the
    // currently visible rows. This is the single canonical quantity display.
    if (headRow && qty >= 0 && headRow.cells?.[qty]) {
      headRow.cells[qty].textContent = `Quantity (${visibleUnits})`;

      const stickyQty = card.querySelector(
        `.fcrlite-inventory-sticky-table thead tr th:nth-child(${qty + 1})`
      );
      if (stickyQty) stickyQty.textContent = `Quantity (${visibleUnits})`;
    }

    const info = card.querySelector('#table-inventory_info');
    if (!info) return;

    const total = rows.length;
    if (!total) {
      info.textContent = 'Showing 0 to 0 of 0 entries';
    } else if (!terms.length) {
      info.textContent = `Showing 1 to ${total} of ${total} entries`;
    } else if (!visible) {
      info.textContent = `Showing 0 to 0 of 0 entries (filtered from ${total} total entries)`;
    } else {
      info.textContent = `Showing 1 to ${visible} of ${visible} entries (filtered from ${total} total entries)`;
    }
  }

  function installInventoryLiveSearch(card) {
    const head = card?.querySelector?.('.fcrlite-card-head');
    if (!head) return;
    let input = head.querySelector('.fcrlite-inventory-filter');
    if (!input) {
      const wrap = document.createElement('label');
      wrap.className = 'fcrlite-inventory-search';
      wrap.title = 'Live inventory filter. Space-separated terms are ANDed; partial matches are allowed.';
      input = document.createElement('input');
      input.className = 'fcrlite-inventory-filter';
      input.type = 'search';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.placeholder = 'Search inventory…';
      input.setAttribute('aria-label', 'Search inventory rows');
      input.addEventListener('input', () => applyInventoryLiveFilter(card));
      wrap.appendChild(input);
      const meta = head.querySelector('.meta');
      if (meta) head.insertBefore(wrap, meta);
      else head.appendChild(wrap);
    }
    applyInventoryLiveFilter(card);
  }

  function installNativeCompatibility(def, card, data) {
    if (!card) return;
    card.dataset.sectionType = def.endpoint;

    if (def.endpoint !== 'inventory') return;
    installInventoryLiveSearch(card);
    renderInventorySummary(card, data);
    installInventorySorting(card);
    installStickyInventoryHeader(card);
    if (data?.preview === true) return;
    const body = card.querySelector('.fcrlite-card-body');
    const table = body?.querySelector('#table-inventory');
    if (!body || !table) return;

    let nav = body.querySelector('#inventory-nav');
    if (!nav) {
      nav = document.createElement('div');
      nav.id = 'inventory-nav';
      nav.className = 'fcrlite-native-tools';
      body.prepend(nav);
    }

    let info = body.querySelector('#table-inventory_info');
    if (!info) {
      info = document.createElement('div');
      info.id = 'table-inventory_info';
      info.className = 'fcrlite-native-info';
      table.insertAdjacentElement('afterend', info);
    }
    const records = Number(data?.records);
    if (Number.isFinite(records)) info.textContent = records ? `Showing 1 to ${records} of ${records} entries` : 'Showing 0 to 0 of 0 entries';
    applyInventoryLiveFilter(card);
  }

  function sectionMeta(def, data) {
    const ms = `${Number(data?.ms) || 0}ms`;
    if (def.endpoint === 'inventory-history' && Number.isFinite(Number(data?.records))) {
      const records = Number(data.records);
      const pages = Number(data?.pages);
      const bits = [`${records} rows`];
      if (Number.isFinite(pages) && pages > 0) bits.push(`${pages} page${pages === 1 ? '' : 's'}`);
      bits.push(ms);
      return `${data?.complete === false ? 'PARTIAL • ' : ''}${bits.join(' • ')}`;
    }
    if (def.endpoint !== 'inventory') return ms;
    const pages = Number(data?.pages);
    const bits = [];
    if (Number.isFinite(pages) && pages > 0) bits.push(`${pages} page${pages === 1 ? '' : 's'}`);
    bits.push(ms);
    const prefix = data?.preview === true ? 'LOADING MORE • ' : (data?.complete === false ? 'PARTIAL • ' : '');
    return `${prefix}${bits.join(' • ')}`;
  }

  function buildSectionsUi() {
    injectStyles();
    const prefs = loadSectionPrefs();
    let runSerial = 0;
    let activeSearchGroup = '';

    root = document.createElement('div');
    root.id = 'fcratc-root';
    root.dataset.fcrToolUi = '1';
    root.classList.add('fcratc-standalone');
    root.innerHTML = `
      <span class="warehouse-id" hidden>${esc(warehouseFromPath())}</span>
      <div class="fcratc-litebar">
        <button type="button" class="fcratc-lite-brand" title="Return to full FCResearch">FC-LITE</button>
        <span class="fcratc-lite-sub">BWU2 SECTIONS</span>
        <input id="fcrlite-search" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Search ASIN / FNSKU / container / PO / etc">
        <button type="button" class="fcrlite-go">SEARCH</button>
        <button type="button" class="fcrlite-toggle-btn">SECTIONS</button>
        <span class="fcrlite-status"></span>
        <span class="fcratc-core-status" title="Shared FCR Data Core status">CORE …</span>
        <button type="button" class="fcratc-tote-toggle" title="Enable Tote Audit scanner">TOTE AUDIT</button>
        <button type="button" class="fcratc-full-fcr">FULL FCRESEARCH ↗</button>
      </div>
      <div id="fcrlite-sections-app">
        <div class="fcrlite-toggles" hidden></div>
        <div class="fcrlite-results"><div class="fcrlite-empty">Search to load enabled sections</div></div>
      </div>
    `;
    document.body.prepend(root);

    const litebar = root.querySelector('.fcratc-litebar');
    const syncStickyOffsets = () => {
      const height = Math.ceil(litebar?.getBoundingClientRect().height || 52) + 8;
      root.style.setProperty('--fcrlite-bar-height', `${height}px`);
    };
    syncStickyOffsets();
    if (typeof ResizeObserver === 'function' && litebar) new ResizeObserver(syncStickyOffsets).observe(litebar);

    const searchInput = root.querySelector('#fcrlite-search');
    const goButton = root.querySelector('.fcrlite-go');
    const toggleButton = root.querySelector('.fcrlite-toggle-btn');
    const togglePanel = root.querySelector('.fcrlite-toggles');
    const status = root.querySelector('.fcrlite-status');
    const results = root.querySelector('.fcrlite-results');

    function enabledDefs() {
      return SECTION_DEFS.filter(def => prefs[def.endpoint] === true);
    }

    function updateToggleButton() {
      toggleButton.textContent = `SECTIONS ${enabledDefs().length}/${SECTION_DEFS.length}`;
    }

    togglePanel.innerHTML = SECTION_DEFS.map(def => `
      <label class="fcrlite-toggle">
        <input type="checkbox" data-endpoint="${esc(def.endpoint)}" ${prefs[def.endpoint] ? 'checked' : ''}>
        <span>${esc(def.label)}</span>
      </label>
    `).join('');
    updateToggleButton();

    togglePanel.addEventListener('change', event => {
      const input = event.target instanceof HTMLInputElement ? event.target : null;
      const endpoint = input?.dataset?.endpoint;
      if (!endpoint || !SECTION_DEFS.some(def => def.endpoint === endpoint)) return;
      prefs[endpoint] = input.checked;
      saveSectionPrefs(prefs);
      updateToggleButton();
      status.textContent = 'saved • search again';
    });

    toggleButton.addEventListener('click', () => {
      togglePanel.hidden = !togglePanel.hidden;
    });

    root.querySelector('.fcratc-lite-brand').addEventListener('click', returnToFullFCResearch);
    root.querySelector('.fcratc-full-fcr').addEventListener('click', returnToFullFCResearch);
    root.querySelector('.fcratc-tote-toggle').addEventListener('click', openToteMode);

    function renderSectionCard(def, card, data, search, rawInput, serial, requestGroup, range = {}) {
      if (serial !== runSerial || !card) return;
      card.classList.remove('loading', 'error', 'partial', 'loading-more');
      if (data?.complete === false) card.classList.add('partial');
      if (data?.preview === true) card.classList.add('loading-more');
      const html = cleanSectionMarkup(def.endpoint, data?.html || '');
      card.querySelector('.fcrlite-card-body').innerHTML = html || '<div class="fcrlite-empty">No data returned</div>';
      card.querySelector('.meta').textContent = sectionMeta(def, data);
      if (data?.complete === false && data?.warning) card.querySelector('.meta').title = clean(data.warning);
      installNativeCompatibility(def, card, data);
      if (def.endpoint === 'product') {
        const shaped = shapeProductSection(card);
        renderIdentifierRelationship(card, rawInput);
        if (shaped.multi) loadMultiAsinImages(card, shaped.asins, requestGroup);
      }
      refreshMultiAsinTotals(results);
      if (def.endpoint === 'inventory-history') {
        installInventoryHistoryControls(card, range.startDate || '', range.endDate || '', async (startDate, endDate) => {
          await reloadInventoryHistory(card, search, serial, requestGroup, startDate, endDate);
        });
      }
    }

    async function reloadInventoryHistory(card, search, serial, requestGroup, startDate, endDate) {
      if (serial !== runSerial || !card?.isConnected) return;
      const def = SECTION_DEFS.find(item => item.endpoint === 'inventory-history');
      if (!def) return;
      card.classList.add('loading');
      card.querySelector('.meta').textContent = 'loading…';
      try {
        const data = await coreRequest('section', {
          endpoint: 'inventory-history',
          code: search,
          startDate,
          endDate
        }, 180000, requestGroup);
        renderSectionCard(def, card, data, search, search, serial, requestGroup, { startDate, endDate });
      } catch (error) {
        if (serial !== runSerial) return;
        card.classList.remove('loading');
        card.classList.add('error');
        card.querySelector('.meta').textContent = 'failed';
        const note = card.querySelector('.fcrlite-history-note');
        if (note) note.textContent = clean(error?.message || error || 'Request failed');
      }
    }

    async function runSearch({ historyMode = 'push' } = {}) {
      const rawInput = String(searchInput.value ?? '').trim();
      const search = clean(rawInput);
      const defs = enabledDefs();
      if (!search) {
        status.textContent = 'enter search';
        searchInput.focus();
        return;
      }
      if (!defs.length) {
        status.textContent = 'enable ≥1 section';
        togglePanel.hidden = false;
        return;
      }

      if (activeSearchGroup) cancelCoreGroup(activeSearchGroup);
      const serial = ++runSerial;
      const requestGroup = `sections:${serial}`;
      activeSearchGroup = requestGroup;
      status.textContent = `loading ${defs.length}…`;
      results.innerHTML = defs.map(def => `
        <section class="fcrlite-card loading" data-endpoint="${esc(def.endpoint)}" data-section-type="${esc(def.endpoint)}">
          <div class="fcrlite-card-head"><span>${esc(def.label)}</span><span class="meta">loading…</span></div>
          <div class="fcrlite-card-body">Loading…</div>
        </section>
      `).join('');

      const url = new URL(location.href);
      url.searchParams.set('s', search);
      if (historyMode === 'push') {
        const currentSearch = clean(new URLSearchParams(location.search).get('s'));
        if (currentSearch !== search) history.pushState({ fcrLiteSearch: search }, '', url.href);
      } else if (historyMode === 'replace') {
        history.replaceState({ fcrLiteSearch: search }, '', url.href);
      }

      let done = 0;
      await mapLimit(defs, SECTION_CONCURRENCY, async def => {
        if (serial !== runSerial) return;
        try {
          const timeout = def.endpoint === 'inventory' ? 180000 : 30000;
          const card = results.querySelector(`[data-endpoint="${CSS.escape(def.endpoint)}"]`);
          if (!card) return;

          if (def.endpoint === 'inventory') {
            const previewPromise = coreRequest('inventoryPreview', { code: search }, 30000, requestGroup).catch(() => null);
            // Attach the full-request rejection handler immediately. A superseding search can
            // cancel this request while we're still awaiting preview; delaying the handler until
            // after preview allowed the browser to report a transient unhandled rejection.
            const fullPromise = coreRequest('section', { endpoint: def.endpoint, code: search }, timeout, requestGroup)
              .then(data => ({ ok: true, data }), error => ({ ok: false, error }));
            const preview = await previewPromise;
            if (serial !== runSerial) return;
            if (preview?.html && preview?.preview === true) renderSectionCard(def, card, preview, search, rawInput, serial, requestGroup);
            const full = await fullPromise;
            if (serial !== runSerial) return;
            if (!full.ok) throw full.error;
            renderSectionCard(def, card, full.data, search, rawInput, serial, requestGroup);
          } else {
            const data = await coreRequest('section', { endpoint: def.endpoint, code: search }, timeout, requestGroup);
            if (serial !== runSerial) return;
            renderSectionCard(def, card, data, search, rawInput, serial, requestGroup);
          }
        } catch (error) {
          if (serial !== runSerial) return;
          const card = results.querySelector(`[data-endpoint="${CSS.escape(def.endpoint)}"]`);
          if (!card) return;
          card.classList.remove('loading');
          card.classList.add('error');
          card.querySelector('.fcrlite-card-body').textContent = clean(error?.message || error || 'Request failed');
          card.querySelector('.meta').textContent = 'failed';
        } finally {
          if (serial === runSerial) {
            done++;
            status.textContent = `${done}/${defs.length}`;
          }
        }
      });
      if (serial === runSerial) {
        status.textContent = `done • ${defs.length} section${defs.length === 1 ? '' : 's'}`;
        searchInput.focus();
        searchInput.select();
      }
    }

    goButton.addEventListener('click', runSearch);
    searchInput.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      runSearch();
    });

    window.addEventListener('popstate', () => {
      if (!location.hash.startsWith(SECTIONS_HASH)) return;
      const restored = clean(new URLSearchParams(location.search).get('s'));
      if (!restored) {
        if (activeSearchGroup) cancelCoreGroup(activeSearchGroup);
        activeSearchGroup = '';
        runSerial++;
        searchInput.value = '';
        results.innerHTML = '';
        status.textContent = 'enter search';
        searchInput.focus();
        return;
      }
      searchInput.value = restored;
      runSearch({ historyMode: 'none' });
    });

    updateCoreStatus();
    const initial = clean(new URLSearchParams(location.search).get('s'));
    if (initial) {
      searchInput.value = initial;
      runSearch({ historyMode: 'none' });
    } else {
      searchInput.focus();
    }
  }

  function buildToteUi() {
    injectStyles();

    root = document.createElement('div');
    root.id = 'fcratc-root';
    root.dataset.fcrToolUi = '1';
    root.innerHTML = `
      <div class="fcratc-litebar">
        <button type="button" class="fcratc-lite-brand" title="Return to full FCResearch for this container">FC-LITE</button>
        <span class="fcratc-lite-sub">BWU2 TOTE AUDIT</span>
        <span class="fcratc-lite-container">NO CONTAINER</span>
        <span class="fcratc-core-status" title="Shared FCR Data Core status">CORE …</span>
        <button type="button" class="fcratc-tote-toggle active" title="Tote Audit active — click to return to FC-Lite sections">TOTE AUDIT ON</button>
        <button type="button" class="fcratc-copy-stats" title="Copy temporary local usage stats">COPY STATS</button>
        <button type="button" class="fcratc-full-fcr" title="Open this container in normal FCResearch">FULL FCRESEARCH ↗</button>
      </div>
      <div id="fcratc-panel">
        <div class="fcratc-top">
          <div class="fcratc-state wait">CONTAINER</div>
          <input id="fcratc-input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Scan tsX / csX">
          <button class="fcratc-btn fcratc-reset reset" type="button" title="Reset">↺</button>
        </div>
        <div class="fcratc-meta">
          <span class="fcratc-container">—</span>
          <span class="fcratc-summary">No container loaded</span>
          <span class="fcratc-status ready">Scan container</span>
        </div>
        <div class="fcratc-tablewrap"><table id="fcratc-table"><tbody></tbody></table></div>
      </div>
      <div class="fcratc-system" hidden>
        <div class="fcratc-system-head"><span class="fcratc-system-title">SYSTEM INVENTORY</span><span class="fcratc-system-caption">WHAT AMAZON SAYS IS HERE</span><span class="fcratc-system-summary">AMAZON RECORD • —</span><span class="fcratc-system-sussy-badge loading" hidden>DIMS …</span><button type="button" class="fcratc-system-recheck">Recheck N/A + L0</button></div>
        <div class="fcratc-system-scroll"><table id="fcratc-system-table"><thead><tr><th>Container</th><th>ASIN / Haz</th><th>FNSKU</th><th>FcSku</th><th>LPN</th><th>Qty</th><th>Disposition</th><th>Consumer</th><th>Consumer ID</th><th>Outer location</th><th>Outer location type</th><th>Title</th></tr></thead><tbody></tbody></table></div>
      </div>
    `;

    scanInput = root.querySelector('#fcratc-input');
    stateBadge = root.querySelector('.fcratc-state');
    statusText = root.querySelector('.fcratc-status');
    containerText = root.querySelector('.fcratc-container');
    summaryText = root.querySelector('.fcratc-summary');
    tbody = root.querySelector('#fcratc-table tbody');
    systemPanel = root.querySelector('.fcratc-system');
    systemSummary = root.querySelector('.fcratc-system-summary');
    systemTbody = root.querySelector('#fcratc-system-table tbody');
    systemRecheckButton = root.querySelector('.fcratc-system-recheck');
    liteContainerText = root.querySelector('.fcratc-lite-container');
    systemSussyBadge = root.querySelector('.fcratc-system-sussy-badge');
    hoverCard = document.createElement('div');
    hoverCard.id = 'fcratc-hover-card';
    hoverCard.hidden = true;
    document.documentElement.appendChild(hoverCard);

    root.classList.add('fcratc-standalone');
    document.body.prepend(root);

    scanInput.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      event.stopPropagation();
      const value = clean(scanInput.value);
      if (!value) return;
      handleScan(value);
    }, true);

    root.querySelector('.reset').addEventListener('click', () => clearSession());
    root.querySelector('.fcratc-lite-brand').addEventListener('click', returnToFullFCResearch);
    root.querySelector('.fcratc-full-fcr').addEventListener('click', returnToFullFCResearch);
    root.querySelector('.fcratc-tote-toggle').addEventListener('click', () => openSectionsMode(container));
    root.querySelector('.fcratc-copy-stats').addEventListener('click', async event => {
      const button = event.currentTarget;
      const old = button.textContent;
      try {
        const result = await coreRequest('usageStats', {});
        await navigator.clipboard.writeText(result?.text || 'No usage stats');
        button.textContent = 'COPIED ✓';
      } catch {
        button.textContent = 'COPY FAILED';
      }
      setTimeout(() => { if (button.isConnected) button.textContent = old; }, 1200);
    });
    stateBadge.addEventListener('click', focusScanner);
    updateCoreStatus();
    systemTbody.addEventListener('mouseover', event => { const a=event.target instanceof Element?event.target.closest('.fcratc-asin'):null; if(a)showAsinHover(a); });
    systemTbody.addEventListener('mouseout', event => { const a=event.target instanceof Element?event.target.closest('.fcratc-asin'):null; if(a && !(event.relatedTarget instanceof Node && a.contains(event.relatedTarget))) hideHoverCard(); });
    systemRecheckButton.addEventListener('click', async()=>{ usage('hazmat.recheck'); systemRecheckButton.disabled=true; const old=systemRecheckButton.textContent; systemRecheckButton.textContent='Rechecking…'; try{await annotateSystemHazmat(true);}finally{systemRecheckButton.disabled=false;systemRecheckButton.textContent=old;} });

    setState(STATE_WAIT);
    updateHeader();

  }

  if (!RESULTS_PAGE) return;
  if (!STANDALONE) {
    injectStyles();
    installDimensionsLauncher();
    return;
  }

  ensureStandaloneDocument();
  if (SECTIONS_MODE) buildSectionsUi();
  else buildToteUi();
})();
