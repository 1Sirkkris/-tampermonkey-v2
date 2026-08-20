// ==UserScript==
// @name        TEST v0.1.29 FC-Lite
// @namespace    https://github.com/1Sirkkris
// @version      0.1.29
// @description  TEST: Clean modular FC-Lite front end; direct tote audit using FCR Data Core.
// @author       ChatGPT
// @include      /^https?:\/\/.*fcresearch.*\//
// @include      /^https?:\/\/qifcr\.fe\.aftx\.amazonoperations\.app\//
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  if (window.__fcrLite_v0129test) return;
  window.__fcrLite_v0129test = true;

  const STANDALONE_HASH = '#fcr-tote-checker';
  const STANDALONE = location.hash.startsWith(STANDALONE_HASH);

  // Stop native FCResearch fan-out
  if (STANDALONE) {
    try { window.stop(); } catch {}
    window.__FCR_TOTE_STANDALONE = true;
    document.documentElement.dataset.fcratcStandalone = '1';
  }

  const VERSION = '0.1.29';

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
  let systemAnnotationSerial = 0;
  const pendingScans = [];
  let systemInventoryRows = [];

  const scanAliases = new Map();
  const rescanTimers = new WeakMap();

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
  let flashTimer = 0;
  let liteContainerText;
  let systemSussyBadge;

  const clean = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const upper = value => clean(value).toUpperCase();
  const isContainer = value => /^(?:TSX|CSX)[A-Z0-9]+$/i.test(clean(value));

  function standaloneUrl() {
    const url = new URL(location.href);
    url.search = '';
    url.hash = STANDALONE_HASH;
    return url.href;
  }

  function openStandaloneTab() {
    const tab = window.open(standaloneUrl(), '_blank');
    if (tab) {
      try { tab.opener = null; } catch {}
    } else if (statusText) {
      setStatus('Pop-up blocked — allow pop-ups for FCResearch', 'error');
    }
  }

  function fullFCResearchUrl(containerValue = container) {
    const fc = warehouseId();
    const url = new URL(`${location.origin}/${encodeURIComponent(fc || 'BWU2')}/results`);
    const wanted = clean(containerValue);
    if (wanted) url.searchParams.set('s', wanted);
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
    document.title = `FC-Lite • ${warehouseId() || 'FCResearch'}`;
    body.replaceChildren();
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
      window.dispatchEvent(new CustomEvent(CORE_REQUEST_EVENT, {
        detail: JSON.stringify({ id, type, payload, client: 'fclite' })
      }));
    });
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
      badge.title = 'Install/enable TEST v0.2.3 FCR Data Core';
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
    systemAnnotationSerial++;
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
    const annotationSerial = ++systemAnnotationSerial;
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
      annotateSystemSussy(annotationSerial).catch(() => {});

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
    clearTimeout(rescanTimers.get(row));
    rescanTimers.set(row, setTimeout(() => {
      row?.classList.remove('rescan');
      rescanTimers.delete(row);
    }, 420));

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


  async function annotateSystemSussy(serial) {
    if (serial !== systemAnnotationSerial || !systemTbody || !systemInventoryRows.length) return;
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
        if (serial !== systemAnnotationSerial) return;
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
        if (serial !== systemAnnotationSerial) return;
        checked += indexes.length;
      }
      if (serial === systemAnnotationSerial && systemSussyBadge) systemSussyBadge.textContent = `DIMS ${sussy}/${checked}`;
    });

    if (serial !== systemAnnotationSerial || !systemSussyBadge) return;
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
    clearTimeout(flashTimer);
    root.classList.remove('flash-found', 'flash-missing', 'flash-error');
    void root.offsetWidth;
    root.classList.add(`flash-${kind}`);
    flashTimer = setTimeout(() => {
      root?.classList.remove(`flash-${kind}`);
      flashTimer = 0;
    }, 650);
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
        gap:10px;
        width:100%;
        min-height:48px;
        margin:0 0 10px 0;
        padding:6px 8px;
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
        font:900 22px Arial,Helvetica,sans-serif;
        letter-spacing:.4px;
        cursor:pointer;
      }
      .fcratc-lite-brand:hover { text-decoration:underline; }
      .fcratc-lite-sub {
        padding-left:9px;
        border-left:1px solid rgba(255,255,255,.35);
        color:#b9c9dc;
        font-size:12px;
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
        margin-left:auto;
        padding:4px 7px;
        border-radius:999px;
        background:#5b6778;
        color:#fff;
        font-size:10px;
        font-weight:900;
        white-space:nowrap;
      }
      .fcratc-core-status.ok { background:#166534; }
      .fcratc-core-status.bad { background:#991b1b; }
      .fcratc-copy-stats { height:31px; padding:0 10px; border:1px solid #a8bdd5; border-radius:6px; background:#e8f1fb; color:#163a63; font-size:11px; font-weight:900; cursor:pointer; }
      .fcratc-copy-stats:hover { background:#d8e8f8; }
      .fcratc-full-fcr {
        margin-left:0;
        height:31px;
        padding:0 11px;
        border:1px solid #a8bdd5;
        border-radius:6px;
        background:#fff;
        color:#163a63;
        font-size:11px;
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
      html[data-fcratc-standalone="1"] body > *:not(#fcratc-root) { display:none!important; }
      #fcratc-root.fcratc-standalone {
        width:100%;
        max-width:none;
        margin:0;
        padding:12px;
        z-index:2147483646;
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
      openStandaloneTab();
    }, true);
  }

  function buildUi() {
    injectStyles();

    root = document.createElement('div');
    root.id = 'fcratc-root';
    root.dataset.fcrToolUi = '1';
    root.innerHTML = `
      <div class="fcratc-litebar">
        <button type="button" class="fcratc-lite-brand" title="Return to full FCResearch for this container">FC-LITE</button>
        <span class="fcratc-lite-sub">BWU2 TOTE AUDIT</span>
        <span class="fcratc-lite-container">NO CONTAINER</span>
        <span class="fcratc-core-status" title="Shared FCR Data Core status">CORE …</span><button type="button" class="fcratc-copy-stats" title="Copy temporary local usage stats">COPY STATS</button>
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
    const copyStatsButton = root.querySelector('.fcratc-copy-stats');
    const copyStatsLabel = copyStatsButton.textContent;
    let copyStatsRun = 0;
    let copyStatsRestoreTimer = 0;
    copyStatsButton.addEventListener('click', async event => {
      const button = event.currentTarget;
      const run = ++copyStatsRun;
      clearTimeout(copyStatsRestoreTimer);
      try {
        const result = await coreRequest('usageStats', {});
        await navigator.clipboard.writeText(result?.text || 'No usage stats');
        if (run !== copyStatsRun) return;
        button.textContent = 'COPIED ✓';
      } catch {
        if (run !== copyStatsRun) return;
        button.textContent = 'COPY FAILED';
      }
      copyStatsRestoreTimer = setTimeout(() => {
        if (button.isConnected && run === copyStatsRun) button.textContent = copyStatsLabel;
      }, 1200);
    });
    stateBadge.addEventListener('click', focusScanner);
    updateCoreStatus();
    systemTbody.addEventListener('mouseover', event => { const a=event.target instanceof Element?event.target.closest('.fcratc-asin'):null; if(a)showAsinHover(a); });
    systemTbody.addEventListener('mouseout', event => { const a=event.target instanceof Element?event.target.closest('.fcratc-asin'):null; if(a && !(event.relatedTarget instanceof Node && a.contains(event.relatedTarget))) hideHoverCard(); });
    systemRecheckButton.addEventListener('click', async()=>{ usage('hazmat.recheck'); systemRecheckButton.disabled=true; const old=systemRecheckButton.textContent; systemRecheckButton.textContent='Rechecking…'; try{await annotateSystemHazmat(true);}finally{systemRecheckButton.disabled=false;systemRecheckButton.textContent=old;} });

    setState(STATE_WAIT);
    updateHeader();

  }

  if (!/\/results(?:\/|$)/i.test(location.pathname)) return;
  if (!STANDALONE) {
    installDimensionsLauncher();
    return;
  }

  ensureStandaloneDocument();
  buildUi();
})();
