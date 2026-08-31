// ==UserScript==
// @name       MAIN v1.3.6-test FNSKU mapping Lookup
// @version      1.3.6-test
// @description  Read-only regional FNSKU lookup with HOME merchant/MSKU details, JP fallback and matched JP/AU candidates.
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

  const VERSION = '1.3.6-test';
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
    const MAX_PAGES = 50;
    let nextUrl = buildGetUrl('jp', 'ASIN_MAPPINGS', { asin });
    let page = 0;
    let elapsedMs = 0;
    let truncated = false;
    const seenUrls = new Set();
    const allRows = [];

    while (nextUrl && page < MAX_PAGES) {
      if (seenUrls.has(nextUrl)) {
        truncated = true;
        debug('JP_PAGINATION_LOOP', { asin, page: page + 1, nextUrl });
        break;
      }
      seenUrls.add(nextUrl);

      page += 1;
      const response = await gmGet(nextUrl, `JP ASIN p${page}`);
      elapsedMs += response.elapsedMs;
      const pageRows = parseRows(response.text);

      if (!pageRows.length && looksLikeLoginHtml(response.text)) {
        throw new Error('JP: authentication response instead of results');
      }

      allRows.push(...pageRows);

      const pageInfo = nextPageInfo(response.text, response.finalUrl || nextUrl);
      if (!pageInfo.hasNext) {
        nextUrl = '';
        break;
      }
      if (!pageInfo.url) {
        truncated = true;
        debug('JP_PAGINATION_UNRESOLVED', { asin, page });
        nextUrl = '';
        break;
      }

      nextUrl = pageInfo.url;
    }

    if (nextUrl && page >= MAX_PAGES) {
      truncated = true;
      debug('JP_PAGINATION_LIMIT', { asin, page, maxPages: MAX_PAGES });
    }

    const exact = allRows.filter(r => r.asin === asin);
    const usable = uniqueRows(exact.length ? exact : allRows);
    const fnskus = unique(usable.map(r => r.fnsku));

    debug('JP_RESULT', { asin, pages: page, rows: usable.length, fnskus, truncated });
    return { region: 'jp', rows: usable, fnskus, hasNext: truncated, pages: page, elapsedMs };
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

    const body = rows.map(row => {
      const first = candidate
        ? `<td><span class="fnsku-match ${escapeHtml(row.match.key)}">${escapeHtml(row.match.label)}</span></td>`
        : `<td><b>${escapeHtml(row.region || '—')}</b></td>`;
      const matchClass = candidate && row.match.rank ? ` class="fnsku-match-row rank-${row.match.rank}"` : '';

      return `<tr${matchClass}>` +
        first +
        `<td>${tableValue(row.merchantId, 'Copy Merchant ID')}</td>` +
        `<td>${tableValue(row.msku, 'Copy MSKU')}</td>` +
        `<td>${tableValue(row.fnsku, 'Copy FNSKU')}</td>` +
        `<td>${tableValue(row.asin, 'Copy ASIN')}</td>` +
        `<td>${escapeHtml(rowState(row))}</td>` +
        '</tr>';
    }).join('');

    return `<div class="fnsku-table-wrap"><table class="fnsku-map-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  }

  function renderDirectAsin(result) {
    const { asin, jpMappings, jpHasNext, jpPages, totalMs } = result;
    const rows = uniqueRows(jpMappings.map(row => ({ ...row, region: 'JP' })));

    setStatus(
      `<div class="fnsku-line"><span>Source</span>${resultPill(asin)}</div>` +
      '<div class="fnsku-line"><span>Type</span><b>ASIN</b></div>' +
      '<div class="fnsku-line"><span>Found</span><b>JP / AU</b></div>' +
      `<div class="fnsku-section-title">JP / AU mappings (${rows.length})</div>` +
      mappingTable(rows) +
      (jpHasNext ? '<div class="fnsku-page-warning"><b>More JP/AU results exist but pagination could not be completed safely.</b> Results above may be incomplete.</div>' : '') +
      `<div class="fnsku-timing">Done in ${Math.round(totalMs)} ms · ${jpPages} page${jpPages === 1 ? '' : 's'} · click any ID to copy</div>`,
      rows.length ? 'success' : 'warn'
    );
  }

  function renderSuccess(result) {
    const { sourceFnsku, sourceRegions, asin, sourceMappings, jpMappings, jpHasNext, totalMs } = result;
    const regionText = sourceRegions.join(' + ');
    const candidates = candidateMappings(jpMappings, sourceMappings);
    const likelyCount = candidates.filter(row => row.match.rank > 0).length;
    const comparison = likelyCount
      ? `<b>${likelyCount} identifier match${likelyCount === 1 ? '' : 'es'} moved to the top.</b> Verify before using.`
      : '<b>No exact Merchant ID or MSKU match returned.</b> Review the candidates manually.';

    setStatus(
      '<div class="fnsku-section-title">HOME mapping</div>' +
      mappingTable(sourceMappings) +
      `<div class="fnsku-section-title">JP / AU candidates (${candidates.length})</div>` +
      `<div class="fnsku-match-note">${comparison}</div>` +
      mappingTable(candidates, { candidate: true }) +
      (jpHasNext ? '<div class="fnsku-page-warning"><b>More JP/AU results exist but pagination could not be completed safely.</b> Results above may be incomplete.</div>' : '') +
      `<div class="fnsku-timing">Done in ${Math.round(totalMs)} ms · click any ID to copy</div>`,
      candidates.length ? 'success' : 'warn'
    );
  }

  function renderJpHome(result) {
    const { sourceFnsku, asin, sourceMappings, totalMs } = result;
    setStatus(
      '<div class="fnsku-section-title">JP / AU mapping</div>' +
      mappingTable(sourceMappings) +
      `<div class="fnsku-timing">Done in ${Math.round(totalMs)} ms · source is already in the AU region · click any ID to copy</div>`,
      'success'
    );
  }

  function renderAmbiguous(sourceFnsku, regionResults, totalMs) {
    const rows = uniqueRows(regionResults.flatMap(result => result.rows
      .filter(row => row.fnsku === sourceFnsku)
      .map(row => ({ ...row, region: result.region.toUpperCase() }))));
    const body = rows.map(row => `<tr>` +
      `<td><b>${escapeHtml(row.region)}</b></td>` +
      `<td>${tableValue(row.asin, 'Copy ASIN')}</td>` +
      `<td>${tableValue(row.merchantId, 'Copy Merchant ID')}</td>` +
      `<td>${tableValue(row.msku, 'Copy MSKU')}</td>` +
      `<td>${escapeHtml(rowState(row))}</td>` +
      '</tr>').join('');
    const table = rows.length
      ? `<div class="fnsku-table-wrap"><table class="fnsku-map-table"><thead><tr><th>Region</th><th>ASIN</th><th>Merchant ID</th><th>MSKU</th><th>State</th></tr></thead><tbody>${body}</tbody></table></div>`
      : '<div class="fnsku-no-rows">No mapping details returned.</div>';

    setStatus(
      `<b>Different ASINs found — stopped instead of guessing.</b>` +
      `<div class="fnsku-line"><span>Source</span>${resultPill(sourceFnsku)}</div>` +
      table +
      `<div class="fnsku-timing">${Math.round(totalMs)} ms</div>`,
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

  function manualGo(region) {
    const url = new URL(location.href);
    url.host = HOSTS[region];
    location.assign(url.toString());
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

    const style = document.createElement('style');
    style.textContent = `
      #fnsku-direct-wrap {
        position: fixed; top: 12px; right: 12px; z-index: 999999;
        width: min(720px, calc(100vw - 24px)); box-sizing: border-box; padding: 12px;
        background: rgba(255,255,255,.96); border: 1px solid rgba(0,0,0,.15);
        border-radius: 14px; box-shadow: 0 8px 24px rgba(0,0,0,.16);
        font: 12px/1.3 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; color:#111;
      }
      #fnsku-direct-wrap * { box-sizing: border-box; }
      .fnsku-head { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; }
      .fnsku-title { font-weight:800; }
      .fnsku-region { font-weight:700; opacity:.65; }
      #fnsku-direct-input { width:100%; padding:10px; border:1px solid #bbb; border-radius:9px; font:13px system-ui; }
      .fnsku-row { display:flex; gap:7px; margin-top:8px; flex-wrap:wrap; }
      .fnsku-btn, .fnsku-result-pill {
        border:1px solid #bbb; background:#fff; border-radius:8px; padding:7px 9px; cursor:pointer; font:12px system-ui;
      }
      .fnsku-btn:hover, .fnsku-result-pill:hover { background:#f2f3f4; }
      .fnsku-btn.primary { font-weight:800; flex:1; background:#eef5ff; }
      .fnsku-btn:disabled { opacity:.55; cursor:wait; }
      #fnsku-direct-status { margin-top:9px; padding:9px; min-height:44px; max-height:calc(100vh - 235px); overflow:auto; border-radius:9px; background:#f4f5f6; overflow-wrap:anywhere; }
      #fnsku-direct-status[data-kind="success"] { background:#e9f4ff; border:1px solid #8bbce8; }
      #fnsku-direct-status[data-kind="warn"] { background:#fff4d8; border:1px solid #d9a62d; }
      #fnsku-direct-status[data-kind="error"] { background:#ffe8e8; border:1px solid #d88; }
      .fnsku-line { display:grid; grid-template-columns:64px 1fr; gap:7px; align-items:center; margin:5px 0; }
      .fnsku-line > span:first-child { font-weight:700; opacity:.65; }
      .fnsku-line.target { margin-top:8px; padding-top:7px; border-top:1px solid rgba(0,0,0,.12); }
      .fnsku-line.target .fnsku-result-pill { font-weight:900; font-size:14px; }
      .fnsku-result-pill { padding:4px 7px; font-family:ui-monospace,SFMono-Regular,Consolas,monospace; }
      .fnsku-section-title { margin-top:10px; padding-top:8px; border-top:1px solid rgba(0,0,0,.14); font-weight:900; font-size:13px; }
      .fnsku-match-note { margin:5px 0 7px; font-size:11px; }
      .fnsku-page-warning { margin-top:7px; padding:6px 8px; border:2px solid #8a5a00; border-radius:6px; background:#fff1c2; color:#3d2a00; }
      .fnsku-table-wrap { overflow:auto; border:1px solid rgba(0,0,0,.14); border-radius:8px; background:#fff; }
      .fnsku-map-table { width:100%; border-collapse:collapse; table-layout:auto; font-size:11px; }
      .fnsku-map-table th, .fnsku-map-table td { padding:5px 6px; border-bottom:1px solid #e1e4e8; text-align:left; vertical-align:middle; white-space:nowrap; }
      .fnsku-map-table th { position:sticky; top:0; z-index:1; background:#e9edf2; font-weight:800; }
      .fnsku-map-table tr:last-child td { border-bottom:0; }
      .fnsku-map-table tbody tr:nth-child(even) { background:#f6f8fa; }
      .fnsku-map-table .fnsku-result-pill { border:0; background:transparent; padding:2px 3px; text-align:left; }
      .fnsku-map-table .fnsku-result-pill:hover { background:#e6edf5; text-decoration:underline; }
      .fnsku-match-row { outline:2px solid #2463a8; outline-offset:-2px; font-weight:700; }
      .fnsku-match-row.rank-3 { background:#dbeafe !important; }
      .fnsku-match { display:inline-block; min-width:60px; padding:2px 4px; border:1px solid #7b8794; border-radius:4px; text-align:center; font-size:10px; font-weight:900; background:#fff; }
      .fnsku-match.both { color:#fff; background:#174f86; border-color:#174f86; }
      .fnsku-match.msku, .fnsku-match.merchant { color:#17324d; background:#dbeafe; border-color:#2463a8; }
      .fnsku-match.none { color:#68717a; border-color:transparent; background:transparent; }
      .fnsku-empty, .fnsku-no-rows { opacity:.6; }
      .fnsku-no-rows { padding:7px; }
      .fnsku-timing { margin-top:7px; font-size:11px; opacity:.6; }
      .fnsku-small { font-size:11px; opacity:.65; margin-top:7px; }
    `;
    document.documentElement.appendChild(style);

    const wrap = document.createElement('div');
    wrap.id = 'fnsku-direct-wrap';
    wrap.innerHTML = `
      <div class="fnsku-head">
        <div class="fnsku-title">FNSKU Direct Lookup v${VERSION}</div>
        <div class="fnsku-region">${currentRegion().toUpperCase()}</div>
      </div>
      <input id="fnsku-direct-input" autocomplete="off" placeholder="Scan / paste FNSKU or ASIN">
      <div class="fnsku-row">
        <button class="fnsku-btn primary" id="fnsku-direct-run" type="button">LOOKUP</button>
        <button class="fnsku-btn" id="fnsku-direct-clear" type="button">CLEAR</button>
        <button class="fnsku-btn" id="fnsku-direct-debug" type="button">COPY DEBUG</button>
      </div>
      <div class="fnsku-row">
        <button class="fnsku-btn" data-go="na" type="button">Go NA</button>
        <button class="fnsku-btn" data-go="eu" type="button">Go EU</button>
        <button class="fnsku-btn" data-go="jp" type="button">Go JP</button>
      </div>
      <div id="fnsku-direct-status">Ready. ASIN scans go direct to JP/AU; FNSKU scans check NA + EU first, then JP/AU.</div>
      <div class="fnsku-small">TEST build · read-only GET requests · no automatic region hopping</div>
    `;

    document.documentElement.appendChild(wrap);

    const input = document.getElementById('fnsku-direct-input');
    document.getElementById('fnsku-direct-run').addEventListener('click', runLookup);
    document.getElementById('fnsku-direct-clear').addEventListener('click', () => {
      state.runId += 1;
      state.running = false;
      state.lastResult = null;
      state.debug = [];
      input.value = '';
      setBusy(false);
      setStatus('Cleared. Ready.');
      input.focus();
    });
    document.getElementById('fnsku-direct-debug').addEventListener('click', copyDebug);

    wrap.querySelectorAll('[data-go]').forEach(btn => {
      btn.addEventListener('click', () => manualGo(btn.dataset.go));
    });

    wrap.addEventListener('click', e => {
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

    input.focus();
  }

  mount();
})();
