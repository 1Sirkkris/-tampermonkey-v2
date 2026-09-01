// ==UserScript==
// @name       MAIN v1.4.0-test FNSKU mapping Lookup
// @version      1.4.0-test
// @description  Read-only regional FNSKU lookup with polished HOME/JP comparison, native JP handoff and compact minimize mode.
// @author       (USER)
// @match        https://fba-fnsku-commingling-console-eu.aka.amazon.com/tool/fnsku-mappings-tool*
// @match        https://fba-fnsku-commingling-console-na.aka.amazon.com/tool/fnsku-mappings-tool*
// @match        https://fba-fnsku-commingling-console-jp.aka.amazon.com/tool/fnsku-mappings-tool*
// @run-at       document-end
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @connect      fba-fnsku-commingling-console-eu.aka.amazon.com
// @connect      fba-fnsku-commingling-console-na.aka.amazon.com
// @connect      fba-fnsku-commingling-console-jp.aka.amazon.com
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/FNSKU_Mapping_Lookup.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/FNSKU_Mapping_Lookup.user.js
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '1.4.0-test';
  const GUARD_ATTR = 'data-bwu2-fnsku-mapping-lookup';
  if (document.documentElement.hasAttribute(GUARD_ATTR)) return;
  document.documentElement.setAttribute(GUARD_ATTR, VERSION);
  const HOSTS = {
    na: 'fba-fnsku-commingling-console-na.aka.amazon.com',
    eu: 'fba-fnsku-commingling-console-eu.aka.amazon.com',
    jp: 'fba-fnsku-commingling-console-jp.aka.amazon.com',
  };

  const state = {
    running: false,
    runId: 0,
    debug: [],
    lastResult: null,
    minimized: false,
  };

  function nowStamp() {
    return new Date().toISOString();
  }

  function debug(type, data = {}) {
    const entry = { t: nowStamp(), type, ...data };
    state.debug.push(entry);
    if (state.debug.length > 120) state.debug.shift();
    console.log('[FNSKU Direct]', type, data);
  }

  function currentRegion() {
    const host = location.host.toLowerCase();
    return Object.keys(HOSTS).find(k => HOSTS[k] === host) || '?';
  }

  function getToken() {
    const fromUrl = new URL(location.href).searchParams.get('anti-csrftoken-a2z');
    if (fromUrl) return fromUrl;

    const input = document.querySelector('input[name="anti-csrftoken-a2z"], textarea[name="anti-csrftoken-a2z"]');
    if (input && input.value) return input.value;

    return '';
  }

  function buildGetUrl(region, mappingType, { fnsku = '', asin = '' } = {}) {
    const token = getToken();
    const url = new URL('/tool/fnsku-mappings-tool/get', 'https://' + HOSTS[region]);

    url.searchParams.set('getMappingsType', mappingType);
    url.searchParams.set('FNSku', '');
    url.searchParams.set('FNSkus', fnsku ? `${fnsku}\r\n` : '');
    url.searchParams.set('merchantId', '');
    url.searchParams.set('MSkus', '');
    url.searchParams.set('ASIN', asin || '');
    url.searchParams.set('includeInactive', 'true');
    url.searchParams.set('includeInternalMerchants', 'false');
    if (token) url.searchParams.set('anti-csrftoken-a2z', token);
    url.searchParams.set('submit', 'get');
    url.searchParams.set('paginationToken', '');

    return url.toString();
  }

  function buildNativeJpSearchUrl(asin) {
    const token = getToken();
    const url = new URL('/tool/fnsku-mappings-tool', 'https://' + HOSTS.jp);

    url.searchParams.set('getMappingsType', 'ASIN_MAPPINGS');
    url.searchParams.set('FNSku', '');
    url.searchParams.set('FNSkus', '');
    url.searchParams.set('merchantId', '');
    url.searchParams.set('MSkus', '');
    url.searchParams.set('ASIN', asin || '');
    url.searchParams.set('includeInactive', 'true');
    url.searchParams.set('includeInternalMerchants', 'false');
    if (token) url.searchParams.set('anti-csrftoken-a2z', token);
    url.searchParams.set('submit', 'get');
    url.searchParams.set('paginationToken', '');
    url.hash = 'fnsku-direct-min';

    return url.toString();
  }

  function gmGet(url, label) {
    return new Promise((resolve, reject) => {
      const started = performance.now();

      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: {
          Accept: 'text/html, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
        },
        timeout: 10000,
        anonymous: false,
        onload: response => {
          const elapsedMs = Math.round(performance.now() - started);
          debug('HTTP_OK', {
            label,
            status: response.status,
            elapsedMs,
            finalUrl: response.finalUrl || url,
            bytes: (response.responseText || '').length,
          });

          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`${label}: HTTP ${response.status}`));
            return;
          }

          resolve({
            text: response.responseText || '',
            status: response.status,
            elapsedMs,
            finalUrl: response.finalUrl || url,
          });
        },
        onerror: err => {
          debug('HTTP_ERROR', { label, error: String(err && (err.error || err.statusText || err)) });
          reject(new Error(`${label}: request failed`));
        },
        ontimeout: () => {
          debug('HTTP_TIMEOUT', { label });
          reject(new Error(`${label}: timed out`));
        },
      });
    });
  }

  function parseRows(html) {
    if (!html) return [];
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.querySelector('#fnsku-table') || doc.querySelector('table.table');
    if (!table) return [];

    const rows = Array.from(table.querySelectorAll('tr'));
    if (rows.length < 2) return [];

    const headers = Array.from(rows[0].querySelectorAll('th,td'))
      .map(x => x.textContent.replace(/\s+/g, ' ').trim().toLowerCase());

    const idx = {
      merchantId: headers.findIndex(h => /merchant\s*id/.test(h)),
      msku: headers.findIndex(h => /msku/.test(h)),
      fnsku: headers.findIndex(h => /fnsku/.test(h)),
      asin: headers.findIndex(h => /^asin$/.test(h)),
      condition: headers.findIndex(h => /condition/.test(h)),
      status: headers.findIndex(h => /status/.test(h)),
    };

    return rows.slice(1).map(row => {
      const cells = Array.from(row.querySelectorAll('td')).map(x => x.textContent.replace(/\s+/g, ' ').trim());
      const get = i => (i >= 0 && i < cells.length ? cells[i] : '');
      return {
        merchantId: get(idx.merchantId),
        msku: get(idx.msku),
        fnsku: get(idx.fnsku).toUpperCase(),
        asin: get(idx.asin).toUpperCase(),
        condition: get(idx.condition),
        status: get(idx.status),
      };
    }).filter(r => r.fnsku || r.asin);
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function uniqueRows(rows) {
    const seen = new Set();
    return rows.filter(row => {
      const key = [
        row.region,
        row.merchantId,
        row.msku,
        row.fnsku,
        row.asin,
        row.condition,
        row.status,
      ].map(value => String(value || '').trim().toUpperCase()).join('\u0001');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function looksLikeLoginHtml(html) {
    return /sign\s*in|sso\/login|is_authenticated/i.test(html) && !/fnsku-table/i.test(html);
  }

  function nextPageInfo(html, currentUrl) {
    if (!html) return { hasNext: false, url: '' };
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const controls = Array.from(doc.querySelectorAll('a,button,input[type="button"],input[type="submit"]'));
    const next = controls.find(element => {
      const label = String(element.textContent || element.value || '').replace(/\s+/g, ' ').trim();
      const disabled = element.disabled || element.getAttribute('aria-disabled') === 'true' || element.classList.contains('disabled');
      return !disabled && /^next\s*>?$/i.test(label);
    });

    if (!next) return { hasNext: false, url: '' };

    const href = next.getAttribute('href');
    if (href && !/^javascript:/i.test(href)) {
      try {
        return { hasNext: true, url: new URL(href, currentUrl).toString() };
      } catch (_) {}
    }

    const form = next.closest('form') || (next.getAttribute('form') ? doc.getElementById(next.getAttribute('form')) : null);
    if (form && String(form.getAttribute('method') || 'get').toLowerCase() === 'get') {
      try {
        const url = new URL(next.getAttribute('formaction') || form.getAttribute('action') || currentUrl, currentUrl);
        const params = new URLSearchParams();

        Array.from(form.querySelectorAll('input,select,textarea,button')).forEach(control => {
          if (!control.name || control.disabled) return;
          const tag = control.tagName.toLowerCase();
          const type = String(control.getAttribute('type') || '').toLowerCase();

          if (control === next) {
            params.append(control.name, control.value || control.textContent || '');
            return;
          }
          if (tag === 'button' || type === 'submit' || type === 'button' || type === 'reset' || type === 'file') return;
          if ((type === 'checkbox' || type === 'radio') && !control.checked) return;

          if (tag === 'select') {
            Array.from(control.options || []).filter(option => option.selected).forEach(option => params.append(control.name, option.value));
          } else {
            params.append(control.name, control.value || '');
          }
        });

        url.search = params.toString();
        return { hasNext: true, url: url.toString() };
      } catch (_) {}
    }

    const tokenInput = doc.querySelector('input[name="paginationToken"], textarea[name="paginationToken"]');
    if (tokenInput && tokenInput.value) {
      try {
        const url = new URL(currentUrl);
        url.searchParams.set('paginationToken', tokenInput.value);
        return { hasNext: true, url: url.toString() };
      } catch (_) {}
    }

    return { hasNext: true, url: '' };
  }

  async function lookupFnsku(region, fnsku) {
    const url = buildGetUrl(region, 'FNSKU_MAPPINGS', { fnsku });
    const response = await gmGet(url, `${region.toUpperCase()} FNSKU`);
    const rows = parseRows(response.text);

    if (!rows.length && looksLikeLoginHtml(response.text)) {
      throw new Error(`${region.toUpperCase()}: authentication response instead of results`);
    }

    const exact = rows.filter(r => r.fnsku === fnsku);
    const usable = exact.length ? exact : rows;
    const asins = unique(usable.map(r => r.asin).filter(x => /^B0[A-Z0-9]{8}$/.test(x)));

    debug('FNSKU_RESULT', { region, fnsku, rows: usable.length, asins });
    return { region, rows: usable, asins, elapsedMs: response.elapsedMs };
  }

  async function lookupJpAsin(asin) {
    const url = buildGetUrl('jp', 'ASIN_MAPPINGS', { asin });
    const response = await gmGet(url, 'JP ASIN');
    const rows = parseRows(response.text);

    if (!rows.length && looksLikeLoginHtml(response.text)) {
      throw new Error('JP: authentication response instead of results');
    }

    const exact = rows.filter(r => r.asin === asin);
    const usable = uniqueRows(exact.length ? exact : rows);
    const fnskus = unique(usable.map(r => r.fnsku));
    const pageInfo = nextPageInfo(response.text, response.finalUrl || url);
    const hasMore = pageInfo.hasNext;

    debug('JP_RESULT', { asin, pages: 1, rows: usable.length, fnskus, hasMore });
    return { region: 'jp', rows: usable, fnskus, hasNext: hasMore, pages: 1, elapsedMs: response.elapsedMs };
  }

  function setStatus(html, kind = 'normal') {
    const el = document.getElementById('fnsku-direct-status');
    if (!el) return;
    el.dataset.kind = kind;
    el.innerHTML = html;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function copyText(text) {
    if (!text) return;
    try {
      GM_setClipboard(String(text), 'text');
    } catch (_) {
      navigator.clipboard?.writeText(String(text)).catch(() => {});
    }
  }

  function resultPill(text, title = 'Click to copy') {
    const safe = escapeHtml(text);
    return `<button type="button" class="fnsku-result-pill" data-copy="${safe}" title="${escapeHtml(title)}">${safe}</button>`;
  }

  function tableValue(value, title) {
    return value
      ? resultPill(value, title)
      : '<span class="fnsku-empty">—</span>';
  }

  function rowState(row) {
    return [row.condition, row.status].filter(Boolean).join(' · ') || '—';
  }

  function homeMappings(regionResults, sourceFnsku, asin = '') {
    return uniqueRows(regionResults.flatMap(result => result.rows
      .filter(row => row.fnsku === sourceFnsku && (!asin || row.asin === asin))
      .map(row => ({ ...row, region: result.region.toUpperCase() }))));
  }

  function matchCandidate(row, sourceRows) {
    const merchantId = String(row.merchantId || '').trim().toUpperCase();
    const msku = String(row.msku || '').trim().toUpperCase();
    const merchant = !!merchantId && sourceRows.some(source => String(source.merchantId || '').trim().toUpperCase() === merchantId);
    const sku = !!msku && sourceRows.some(source => String(source.msku || '').trim().toUpperCase() === msku);
    const both = merchant && sku && sourceRows.some(source =>
      String(source.merchantId || '').trim().toUpperCase() === merchantId &&
      String(source.msku || '').trim().toUpperCase() === msku
    );

    if (both) return { rank: 3, key: 'both', label: 'BOTH' };
    if (sku) return { rank: 2, key: 'msku', label: 'MSKU' };
    if (merchant) return { rank: 1, key: 'merchant', label: 'MERCHANT' };
    return { rank: 0, key: 'none', label: '—' };
  }

  function statusRank(status) {
    return /^active$/i.test(String(status || '').trim()) ? 0 : 1;
  }

  function candidateMappings(rows, sourceRows) {
    return uniqueRows(rows.map(row => ({ ...row, region: 'JP' })))
      .map(row => ({ ...row, match: matchCandidate(row, sourceRows) }))
      .sort((a, b) =>
        b.match.rank - a.match.rank ||
        statusRank(a.status) - statusRank(b.status) ||
        a.merchantId.localeCompare(b.merchantId) ||
        a.msku.localeCompare(b.msku) ||
        a.fnsku.localeCompare(b.fnsku)
      );
  }

  function mappingTable(rows, { candidate = false } = {}) {
    if (!rows.length) return '<div class="fnsku-no-rows">No mappings returned.</div>';

    const head = candidate
      ? '<tr><th>Match</th><th>Merchant ID</th><th>MSKU</th><th>FNSKU</th><th>ASIN</th><th>State</th></tr>'
      : '<tr><th>Region</th><th>Merchant ID</th><th>MSKU</th><th>FNSKU</th><th>ASIN</th><th>State</th></tr>';
    const colgroup = '<colgroup><col class="c-region"><col class="c-merchant"><col class="c-msku"><col class="c-fnsku"><col class="c-asin"><col class="c-state"></colgroup>';

    const body = rows.map(row => {
      const first = candidate
        ? `<td><span class="fnsku-match ${escapeHtml(row.match.key)}">${escapeHtml(row.match.label)}</span></td>`
        : `<td><span class="fnsku-region-cell">${escapeHtml(row.region || '—')}</span></td>`;
      const matchClass = candidate && row.match.rank ? ` class="fnsku-match-row rank-${row.match.rank}"` : '';

      return `<tr${matchClass}>` +
        first +
        `<td>${tableValue(row.merchantId, 'Copy Merchant ID')}</td>` +
        `<td>${tableValue(row.msku, 'Copy MSKU')}</td>` +
        `<td>${tableValue(row.fnsku, 'Copy FNSKU')}</td>` +
        `<td>${tableValue(row.asin, 'Copy ASIN')}</td>` +
        `<td><span class="fnsku-state">${escapeHtml(rowState(row))}</span></td>` +
        '</tr>';
    }).join('');

    return `<div class="fnsku-table-wrap"><table class="fnsku-map-table">${colgroup}<thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  }

  function resultCard(kind, title, rows, { candidate = false, note = '' } = {}) {
    const count = rows.length;
    return `<section class="fnsku-card ${escapeHtml(kind)}">` +
      `<div class="fnsku-card-head"><span>${escapeHtml(title)}</span><span class="fnsku-count">${count} row${count === 1 ? '' : 's'}</span></div>` +
      (note ? `<div class="fnsku-card-note">${note}</div>` : '') +
      mappingTable(rows, { candidate }) +
      '</section>';
  }

  function moreResultsButton(asin, hasMore) {
    if (!hasMore || !asin) return '';
    return `<button type="button" class="fnsku-more-results" data-open-jp="${escapeHtml(asin)}">` +
      '<span class="fnsku-more-copy"><b>More FNSKUs available</b><small>Use the native JP search for the full list</small></span>' +
      '<span class="fnsku-more-cta">VIEW ALL IN JP →</span>' +
      '</button>';
  }

  function renderDirectAsin(result) {
    const { asin, jpMappings, jpHasNext, jpPages, totalMs } = result;
    const rows = uniqueRows(jpMappings.map(row => ({ ...row, region: 'JP' })));
    const note = `ASIN ${resultPill(asin, 'Copy ASIN')}`;

    setStatus(
      resultCard('candidate', 'JP / AU MAPPINGS', rows, { note }) +
      moreResultsButton(asin, jpHasNext) +
      `<div class="fnsku-timing">Done · ${(totalMs / 1000).toFixed(1)} s${jpPages ? ` · ${jpPages} page${jpPages === 1 ? '' : 's'} sampled` : ''}</div>`,
      rows.length ? 'success' : 'warn'
    );
  }

  function renderSuccess(result) {
    const { sourceMappings, jpMappings, jpHasNext, asin, totalMs } = result;
    const candidates = candidateMappings(jpMappings, sourceMappings);
    const likelyCount = candidates.filter(row => row.match.rank > 0).length;
    const comparison = likelyCount
      ? `<b>${likelyCount} identifier match${likelyCount === 1 ? '' : 'es'} moved to the top.</b> Verify before using.`
      : '<b>No exact Merchant ID or MSKU match returned.</b> Review the candidates manually.';

    setStatus(
      resultCard('home', 'HOME MAPPINGS', sourceMappings) +
      resultCard('candidate', 'JP / AU CANDIDATES', candidates, { candidate: true, note: comparison }) +
      moreResultsButton(asin, jpHasNext) +
      `<div class="fnsku-timing">Done · ${(totalMs / 1000).toFixed(1)} s · click any ID to copy</div>`,
      'success'
    );
  }

  function renderJpHome(result) {
    const { asin, sourceMappings, totalMs } = result;
    const note = `ASIN ${resultPill(asin, 'Copy ASIN')}`;
    setStatus(
      resultCard('candidate', 'JP / AU MAPPING', sourceMappings, { note }) +
      `<div class="fnsku-timing">Done · ${(totalMs / 1000).toFixed(1)} s · source is already in JP / AU</div>`,
      'success'
    );
  }

  function renderAmbiguous(sourceFnsku, regionResults, totalMs) {
    const rows = uniqueRows(regionResults.flatMap(result => result.rows
      .filter(row => row.fnsku === sourceFnsku)
      .map(row => ({ ...row, region: result.region.toUpperCase() }))));
    const note = `<b>Different ASINs found — stopped instead of guessing.</b> Source ${resultPill(sourceFnsku, 'Copy source FNSKU')}`;

    setStatus(
      resultCard('warning', 'MULTIPLE ASINS FOUND', rows, { note }) +
      `<div class="fnsku-timing">Done · ${(totalMs / 1000).toFixed(1)} s</div>`,
      'warn'
    );
  }

  async function runLookup() {
    const input = document.getElementById('fnsku-direct-input');
    if (!input || state.running) return;

    const sourceCode = input.value.trim().toUpperCase();
    if (!sourceCode) {
      setStatus('Scan / paste source FNSKU or ASIN first.', 'warn');
      input.focus();
      return;
    }

    if (!/^[A-Z0-9]{10,}$/.test(sourceCode)) {
      setStatus(`Suspicious barcode: <b>${escapeHtml(sourceCode)}</b>`, 'warn');
      input.focus();
      return;
    }

    const token = getToken();
    if (!token) {
      setStatus('<b>No anti-CSRF token found on this page.</b><br>Reload the console normally, then try again.', 'error');
      return;
    }

    const directAsin = /^B0[A-Z0-9]{8}$/.test(sourceCode);
    state.running = true;
    state.runId += 1;
    const myRun = state.runId;
    state.debug = [];
    const started = performance.now();
    debug('RUN_START', {
      sourceCode,
      inputType: directAsin ? 'ASIN' : 'FNSKU',
      pageRegion: currentRegion(),
      tokenPresent: true,
    });

    setBusy(true);

    try {
      if (directAsin) {
        setStatus(`ASIN detected: <b>${escapeHtml(sourceCode)}</b>.<br>Querying JP / AU mappings directly...`);

        const jp = await lookupJpAsin(sourceCode);
        if (myRun !== state.runId) return;

        const totalMs = performance.now() - started;
        state.lastResult = {
          mode: 'asin-direct',
          asin: sourceCode,
          jpMappings: jp.rows,
          jpFnskus: jp.fnskus,
          jpHasNext: jp.hasNext,
          jpPages: jp.pages,
          totalMs,
        };

        debug('RUN_SUCCESS_ASIN_DIRECT', {
          asin: sourceCode,
          jpMappings: jp.rows.length,
          jpFnskus: jp.fnskus.length,
          jpPages: jp.pages,
          jpHasNext: jp.hasNext,
          totalMs,
        });

        if (!jp.rows.length) {
          setStatus(`<b>No JP / AU mappings found for ASIN ${escapeHtml(sourceCode)}.</b>`, 'warn');
          return;
        }

        renderDirectAsin(state.lastResult);
        return;
      }

      const sourceFnsku = sourceCode;
      setStatus(`Looking up <b>${escapeHtml(sourceFnsku)}</b> in NA + EU simultaneously...`);

      const settled = await Promise.allSettled([
        lookupFnsku('na', sourceFnsku),
        lookupFnsku('eu', sourceFnsku),
      ]);

      if (myRun !== state.runId) return;

      const regionResults = settled
        .filter(x => x.status === 'fulfilled')
        .map(x => x.value);
      const failures = settled
        .filter(x => x.status === 'rejected')
        .map(x => x.reason?.message || String(x.reason));

      if (failures.length) debug('REGION_FAILURES', { failures });

      const found = regionResults.filter(r => r.asins.length);
      if (!found.length) {
        setStatus(
          `<b>No mapping found in NA or EU for ${escapeHtml(sourceFnsku)}.</b><br>` +
          'Checking JP / AU...'
        );

        let jpSource;
        try {
          jpSource = await lookupFnsku('jp', sourceFnsku);
        } catch (jpError) {
          const earlier = failures.length ? ` ${failures.join(' | ')} |` : '';
          throw new Error(`NA/EU returned no usable mapping.${earlier} ${jpError?.message || String(jpError)}`);
        }

        if (myRun !== state.runId) return;

        if (!jpSource.asins.length) {
          const extra = failures.length ? `<br><small>${escapeHtml(failures.join(' | '))}</small>` : '';
          setStatus(`<b>No ASIN found in NA, EU or JP/AU for ${escapeHtml(sourceFnsku)}.</b>${extra}`, 'warn');
          return;
        }

        if (jpSource.asins.length !== 1) {
          renderAmbiguous(sourceFnsku, [jpSource], performance.now() - started);
          return;
        }

        const asin = jpSource.asins[0];
        const sourceMappings = homeMappings([jpSource], sourceFnsku, asin);
        const totalMs = performance.now() - started;
        state.lastResult = {
          mode: 'jp-source',
          sourceFnsku,
          sourceRegions: ['JP'],
          asin,
          sourceMappings,
          jpMappings: [],
          jpFnskus: unique(sourceMappings.map(row => row.fnsku)),
          totalMs,
        };
        debug('RUN_SUCCESS_JP_SOURCE', {
          sourceFnsku,
          asin,
          homeMappings: sourceMappings.length,
          totalMs,
        });
        renderJpHome(state.lastResult);
        return;
      }

      const allAsins = unique(found.flatMap(r => r.asins));
      if (allAsins.length !== 1) {
        renderAmbiguous(sourceFnsku, found, performance.now() - started);
        return;
      }

      const asin = allAsins[0];
      const sourceRegions = found.filter(r => r.asins.includes(asin)).map(r => r.region.toUpperCase());

      setStatus(
        `Found <b>${escapeHtml(asin)}</b> in ${escapeHtml(sourceRegions.join(' + '))}.<br>` +
        'Querying JP ASIN mappings...'
      );

      const jp = await lookupJpAsin(asin);
      if (myRun !== state.runId) return;

      const jpFnskus = jp.fnskus;
      const sourceMappings = homeMappings(found, sourceFnsku, asin);
      const totalMs = performance.now() - started;

      state.lastResult = {
        sourceFnsku,
        sourceRegions,
        asin,
        sourceMappings,
        jpMappings: jp.rows,
        jpFnskus,
        jpHasNext: jp.hasNext,
        jpPages: jp.pages,
        totalMs,
      };
      debug('RUN_SUCCESS', {
        sourceFnsku,
        sourceRegions,
        asin,
        homeMappings: sourceMappings.length,
        jpMappings: jp.rows.length,
        jpFnskus: jpFnskus.length,
        jpPages: jp.pages,
        jpHasNext: jp.hasNext,
        totalMs,
      });
      renderSuccess(state.lastResult);
    } catch (err) {
      debug('RUN_ERROR', { message: err?.message || String(err), stack: err?.stack || '' });
      setStatus(
        `<b>Direct lookup failed.</b><br>${escapeHtml(err?.message || String(err))}` +
        '<br><small>Click COPY DEBUG and send it back.</small>',
        'error'
      );
    } finally {
      if (myRun === state.runId) {
        state.running = false;
        setBusy(false);
        input.focus();
        input.select();
      }
    }
  }

  function setBusy(busy) {
    const btn = document.getElementById('fnsku-direct-run');
    if (!btn) return;
    btn.disabled = busy;
    btn.textContent = busy ? 'RUNNING…' : 'LOOKUP';
  }

  function setMinimized(minimized) {
    const wrap = document.getElementById('fnsku-direct-wrap');
    const btn = document.getElementById('fnsku-direct-minimize');
    if (!wrap || !btn) return;
    state.minimized = !!minimized;
    wrap.classList.toggle('is-minimized', state.minimized);
    btn.textContent = '-';
    btn.title = state.minimized ? 'Restore FNSKU lookup' : 'Minimize';
    btn.setAttribute('aria-label', btn.title);
  }

  function manualGo(region) {
    const url = new URL(location.href);
    url.host = HOSTS[region];
    location.assign(url.toString());
  }

  function openNativeJpSearch(asin) {
    if (!asin) return;
    location.assign(buildNativeJpSearchUrl(asin));
  }

  function copyDebug() {
    const payload = {
      version: VERSION,
      page: location.href.replace(/anti-csrftoken-a2z=[^&]+/i, 'anti-csrftoken-a2z=<REDACTED>'),
      region: currentRegion(),
      lastResult: state.lastResult,
      debug: state.debug,
    };
    copyText(JSON.stringify(payload, null, 2));
    const btn = document.getElementById('fnsku-direct-debug');
    if (btn) {
      const old = btn.textContent;
      btn.textContent = 'COPIED';
      setTimeout(() => { btn.textContent = old; }, 900);
    }
  }

  function mount() {
    if (document.getElementById('fnsku-direct-wrap')) return;

    const launchMinimized = location.hash === '#fnsku-direct-min';
    if (launchMinimized) {
      try {
        history.replaceState(null, '', location.pathname + location.search);
      } catch (_) {}
    }

    const style = document.createElement('style');
    style.textContent = `
      #fnsku-direct-wrap {
        position:fixed; top:16px; right:16px; z-index:999999;
        width:min(860px, calc(100vw - 32px)); box-sizing:border-box; padding:14px;
        background:rgba(248,250,252,.97); border:1px solid #d7deea;
        border-radius:18px; box-shadow:0 18px 48px rgba(15,23,42,.18), 0 2px 8px rgba(15,23,42,.08);
        backdrop-filter:blur(10px); font:12px/1.35 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; color:#0f172a;
      }
      #fnsku-direct-wrap * { box-sizing:border-box; }
      #fnsku-direct-wrap.is-minimized {
        width:30px; height:30px; padding:0; border-radius:9px; background:#0f172a; border-color:#0f172a;
        box-shadow:0 6px 18px rgba(15,23,42,.22); overflow:hidden;
      }
      #fnsku-direct-wrap.is-minimized .fnsku-shell { display:none; }
      .fnsku-minimize {
        position:absolute; top:10px; right:10px; z-index:3; width:28px; height:28px; display:flex; align-items:center; justify-content:center;
        border:1px solid #cbd5e1; border-radius:8px; background:#fff; color:#475569; cursor:pointer; font:800 15px/1 system-ui;
      }
      .fnsku-minimize:hover { background:#f1f5f9; color:#0f172a; }
      #fnsku-direct-wrap.is-minimized .fnsku-minimize {
        inset:0; width:30px; height:30px; border:0; border-radius:9px; background:#0f172a; color:#fff; font-size:16px;
      }
      .fnsku-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:1px 38px 10px 1px; }
      .fnsku-title { font-size:14px; line-height:1.15; font-weight:900; letter-spacing:.01em; }
      .fnsku-subtitle { margin-top:3px; color:#64748b; font-size:10.5px; }
      .fnsku-meta { display:flex; align-items:center; gap:6px; white-space:nowrap; }
      .fnsku-version { padding:3px 6px; border-radius:999px; background:#e2e8f0; color:#475569; font-size:10px; font-weight:800; }
      .fnsku-region-pill { padding:4px 8px; border-radius:999px; color:#fff; font-size:10px; font-weight:900; letter-spacing:.04em; }
      .fnsku-region-pill.na { background:#0f766e; }
      .fnsku-region-pill.eu { background:#2563eb; }
      .fnsku-region-pill.jp { background:#7c3aed; }
      .fnsku-search-card { padding:10px; border:1px solid #dbe3ee; border-radius:13px; background:#fff; box-shadow:0 1px 2px rgba(15,23,42,.04); }
      .fnsku-search-label, .fnsku-toolbar-label { color:#64748b; font-size:9px; font-weight:900; letter-spacing:.09em; text-transform:uppercase; }
      .fnsku-search-row { display:flex; gap:8px; margin-top:5px; }
      #fnsku-direct-input {
        flex:1; min-width:0; padding:10px 11px; border:1px solid #cbd5e1; border-radius:9px; outline:none;
        background:#fff; color:#0f172a; font:13px ui-monospace,SFMono-Regular,Consolas,monospace;
      }
      #fnsku-direct-input:focus { border-color:#2563eb; box-shadow:0 0 0 3px rgba(37,99,235,.14); }
      .fnsku-btn { border:1px solid #cbd5e1; border-radius:9px; background:#fff; color:#334155; padding:7px 10px; cursor:pointer; font:800 11px system-ui; }
      .fnsku-btn:hover { filter:brightness(.98); transform:translateY(-1px); }
      .fnsku-btn:active { transform:translateY(0); }
      .fnsku-btn:disabled { opacity:.55; cursor:wait; transform:none; }
      .fnsku-btn.primary { min-width:116px; border-color:#1d4ed8; background:#2563eb; color:#fff; letter-spacing:.02em; }
      .fnsku-toolbar { display:flex; align-items:flex-end; justify-content:space-between; gap:10px; margin-top:9px; }
      .fnsku-region-group, .fnsku-tool-group { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
      .fnsku-toolbar-label { margin-right:2px; }
      .fnsku-region-btn { min-width:48px; border-width:1px; }
      .fnsku-region-btn.na { border-color:#99f6e4; background:#ccfbf1; color:#115e59; }
      .fnsku-region-btn.eu { border-color:#bfdbfe; background:#dbeafe; color:#1d4ed8; }
      .fnsku-region-btn.jp { border-color:#ddd6fe; background:#ede9fe; color:#6d28d9; }
      .fnsku-region-btn.na.is-current { border-color:#0f766e; background:#0f766e; color:#fff; }
      .fnsku-region-btn.eu.is-current { border-color:#2563eb; background:#2563eb; color:#fff; }
      .fnsku-region-btn.jp.is-current { border-color:#7c3aed; background:#7c3aed; color:#fff; }
      .fnsku-tool-btn { background:#f8fafc; color:#64748b; font-weight:700; }
      #fnsku-direct-status { margin-top:10px; max-height:calc(100vh - 245px); overflow:auto; border-radius:12px; overflow-wrap:anywhere; }
      #fnsku-direct-status[data-kind="normal"] { padding:8px 10px; border:1px dashed #cbd5e1; background:#f8fafc; color:#64748b; }
      #fnsku-direct-status[data-kind="warn"]:not(:has(.fnsku-card)) { padding:9px 10px; border:1px solid #f59e0b; background:#fffbeb; color:#78350f; }
      #fnsku-direct-status[data-kind="error"] { padding:9px 10px; border:1px solid #fda4af; background:#fff1f2; color:#881337; }
      .fnsku-card { padding:10px; border:1px solid; border-radius:13px; margin-bottom:9px; }
      .fnsku-card.home { background:#eff6ff; border-color:#93c5fd; }
      .fnsku-card.candidate { background:#f5f3ff; border-color:#c4b5fd; }
      .fnsku-card.warning { background:#fffbeb; border-color:#fbbf24; }
      .fnsku-card-head { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:7px; font-size:12px; font-weight:950; letter-spacing:.025em; }
      .fnsku-count { padding:2px 7px; border-radius:999px; background:rgba(255,255,255,.72); color:#475569; font-size:9.5px; font-weight:850; white-space:nowrap; }
      .fnsku-card-note { margin:-1px 0 7px; color:#475569; font-size:10.5px; }
      .fnsku-table-wrap { overflow:auto; border:1px solid rgba(148,163,184,.45); border-radius:9px; background:#fff; }
      .fnsku-map-table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:10.5px; }
      .fnsku-map-table col.c-region { width:9%; }
      .fnsku-map-table col.c-merchant { width:16%; }
      .fnsku-map-table col.c-msku { width:31%; }
      .fnsku-map-table col.c-fnsku { width:15%; }
      .fnsku-map-table col.c-asin { width:14%; }
      .fnsku-map-table col.c-state { width:15%; }
      .fnsku-map-table th, .fnsku-map-table td { padding:6px 7px; border-bottom:1px solid #e2e8f0; text-align:left; vertical-align:middle; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .fnsku-map-table th { position:sticky; top:0; z-index:1; color:#334155; font-size:9.5px; font-weight:900; }
      .fnsku-card.home .fnsku-map-table th { background:#dbeafe; }
      .fnsku-card.candidate .fnsku-map-table th { background:#ede9fe; }
      .fnsku-card.warning .fnsku-map-table th { background:#fef3c7; }
      .fnsku-map-table tr:last-child td { border-bottom:0; }
      .fnsku-map-table tbody tr:nth-child(even) { background:#f8fafc; }
      .fnsku-map-table tbody tr:hover { background:#eef2ff; }
      .fnsku-result-pill { max-width:100%; border:0; border-radius:5px; background:transparent; padding:2px 3px; color:#0f172a; cursor:pointer; font:10.5px ui-monospace,SFMono-Regular,Consolas,monospace; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:left; }
      .fnsku-result-pill:hover { background:#e2e8f0; text-decoration:underline; }
      .fnsku-region-cell { display:inline-flex; min-width:30px; justify-content:center; padding:2px 5px; border-radius:999px; background:#e2e8f0; color:#334155; font-size:9.5px; font-weight:900; }
      .fnsku-state { color:#475569; font-size:10px; }
      .fnsku-match-row { outline:2px solid #6366f1; outline-offset:-2px; font-weight:700; }
      .fnsku-match-row.rank-3 { background:#e0e7ff !important; }
      .fnsku-match { display:inline-flex; min-width:54px; justify-content:center; padding:2px 5px; border-radius:999px; text-align:center; font-size:9px; font-weight:950; }
      .fnsku-match.both { color:#fff; background:#3730a3; }
      .fnsku-match.msku { color:#1e3a8a; background:#dbeafe; border:1px solid #93c5fd; }
      .fnsku-match.merchant { color:#5b21b6; background:#ede9fe; border:1px solid #c4b5fd; }
      .fnsku-match.none { color:#64748b; background:#e2e8f0; }
      .fnsku-more-results {
        width:100%; display:flex; align-items:center; justify-content:space-between; gap:12px; margin:2px 0 9px; padding:9px 11px;
        border:1px solid #c4b5fd; border-radius:11px; background:linear-gradient(90deg,#faf5ff,#eef2ff); color:#4c1d95; cursor:pointer; text-align:left;
      }
      .fnsku-more-results:hover { border-color:#8b5cf6; box-shadow:0 3px 10px rgba(124,58,237,.12); }
      .fnsku-more-copy { display:flex; flex-direction:column; gap:1px; }
      .fnsku-more-copy b { font-size:11px; }
      .fnsku-more-copy small { color:#6b7280; font-size:9.5px; }
      .fnsku-more-cta { padding:5px 8px; border-radius:7px; background:#7c3aed; color:#fff; font-size:9.5px; font-weight:950; white-space:nowrap; }
      .fnsku-no-rows { padding:9px; color:#64748b; }
      .fnsku-timing { margin:6px 2px 0; color:#64748b; font-size:9.5px; }
      .fnsku-footer { margin-top:8px; color:#94a3b8; font-size:9px; text-align:right; }
      @media (max-width:720px) {
        #fnsku-direct-wrap { right:8px; top:8px; width:calc(100vw - 16px); }
        .fnsku-toolbar { align-items:flex-start; flex-direction:column; }
        .fnsku-search-row { flex-direction:column; }
        .fnsku-btn.primary { width:100%; }
        .fnsku-map-table { min-width:700px; }
      }
    `;
    document.documentElement.appendChild(style);

    const region = currentRegion();
    const wrap = document.createElement('div');
    wrap.id = 'fnsku-direct-wrap';
    wrap.innerHTML = `
      <button class="fnsku-minimize" id="fnsku-direct-minimize" type="button" title="Minimize" aria-label="Minimize">-</button>
      <div class="fnsku-shell">
        <div class="fnsku-head">
          <div>
            <div class="fnsku-title">FNSKU Direct Lookup</div>
            <div class="fnsku-subtitle">Regional mapping viewer</div>
          </div>
          <div class="fnsku-meta">
            <span class="fnsku-version">v${VERSION}</span>
            <span class="fnsku-region-pill ${escapeHtml(region)}">${escapeHtml(region.toUpperCase())}</span>
          </div>
        </div>
        <div class="fnsku-search-card">
          <div class="fnsku-search-label">Search</div>
          <div class="fnsku-search-row">
            <input id="fnsku-direct-input" autocomplete="off" placeholder="Scan / paste FNSKU or ASIN">
            <button class="fnsku-btn primary" id="fnsku-direct-run" type="button">LOOKUP</button>
          </div>
          <div class="fnsku-toolbar">
            <div class="fnsku-region-group">
              <span class="fnsku-toolbar-label">Region</span>
              <button class="fnsku-btn fnsku-region-btn na" data-go="na" type="button">NA</button>
              <button class="fnsku-btn fnsku-region-btn eu" data-go="eu" type="button">EU</button>
              <button class="fnsku-btn fnsku-region-btn jp" data-go="jp" type="button">JP</button>
            </div>
            <div class="fnsku-tool-group">
              <button class="fnsku-btn fnsku-tool-btn" id="fnsku-direct-clear" type="button">CLEAR</button>
              <button class="fnsku-btn fnsku-tool-btn" id="fnsku-direct-debug" type="button">COPY DEBUG</button>
            </div>
          </div>
        </div>
        <div id="fnsku-direct-status">Ready for FNSKU or ASIN.</div>
        <div class="fnsku-footer">TEST • read-only GET requests</div>
      </div>
    `;

    document.documentElement.appendChild(wrap);

    const input = document.getElementById('fnsku-direct-input');
    const minimizeBtn = document.getElementById('fnsku-direct-minimize');
    document.getElementById('fnsku-direct-run').addEventListener('click', runLookup);
    minimizeBtn.addEventListener('click', () => setMinimized(!state.minimized));
    document.getElementById('fnsku-direct-clear').addEventListener('click', () => {
      state.runId += 1;
      state.running = false;
      state.lastResult = null;
      state.debug = [];
      input.value = '';
      setBusy(false);
      setStatus('Ready for FNSKU or ASIN.');
      input.focus();
    });
    document.getElementById('fnsku-direct-debug').addEventListener('click', copyDebug);

    wrap.querySelectorAll('[data-go]').forEach(btn => {
      if (btn.dataset.go === region) btn.classList.add('is-current');
      btn.addEventListener('click', () => manualGo(btn.dataset.go));
    });

    wrap.addEventListener('click', e => {
      const nativeJp = e.target.closest('[data-open-jp]');
      if (nativeJp) {
        openNativeJpSearch(nativeJp.dataset.openJp);
        return;
      }

      const pill = e.target.closest('[data-copy]');
      if (!pill) return;
      copyText(pill.dataset.copy);
      const old = pill.textContent;
      pill.textContent = 'COPIED';
      setTimeout(() => { pill.textContent = old; }, 700);
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runLookup();
      }
    });

    if (launchMinimized) {
      setMinimized(true);
    } else {
      input.focus();
    }
  }

  mount();
})();
