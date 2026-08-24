// ==UserScript==
// @name       MAIN  v1.3.0 FNSKU mapping Lookup
// @version      1.3.0-test
// @description  Read-only direct FNSKU lookup. Queries NA + EU in background, extracts ASIN, then queries JP ASIN mappings without region page hopping.
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

  const VERSION = '1.3.0-test';
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

  function looksLikeLoginHtml(html) {
    return /sign\s*in|sso\/login|is_authenticated/i.test(html) && !/fnsku-table/i.test(html);
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
    const usable = exact.length ? exact : rows;
    const fnskus = unique(usable.map(r => r.fnsku));

    debug('JP_RESULT', { asin, rows: usable.length, fnskus });
    return { region: 'jp', rows: usable, fnskus, elapsedMs: response.elapsedMs };
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

  function renderSuccess(result) {
    const { sourceFnsku, sourceRegions, asin, jpFnskus, totalMs } = result;
    const regionText = sourceRegions.join(' + ');
    const targetHtml = jpFnskus.length
      ? jpFnskus.map(x => resultPill(x)).join(' ')
      : '<b>NO JP FNSKU RETURNED</b>';

    setStatus(
      `<div class="fnsku-line"><span>Source</span>${resultPill(sourceFnsku)}</div>` +
      `<div class="fnsku-line"><span>Found</span><b>${escapeHtml(regionText)}</b></div>` +
      `<div class="fnsku-line"><span>ASIN</span>${resultPill(asin)}</div>` +
      `<div class="fnsku-line target"><span>JP FNSKU</span><div>${targetHtml}</div></div>` +
      `<div class="fnsku-timing">Done in ${Math.round(totalMs)} ms · click barcode to copy</div>`,
      jpFnskus.length ? 'success' : 'warn'
    );
  }

  function renderAmbiguous(sourceFnsku, regionResults, totalMs) {
    const chunks = [];
    for (const r of regionResults) {
      if (!r.asins.length) continue;
      chunks.push(`<div class="fnsku-line"><span>${r.region.toUpperCase()}</span><div>${r.asins.map(a => resultPill(a, 'Click ASIN to copy')).join(' ')}</div></div>`);
    }

    setStatus(
      `<b>Different ASINs found — stopped instead of guessing.</b>` +
      `<div class="fnsku-line"><span>Source</span>${resultPill(sourceFnsku)}</div>` +
      chunks.join('') +
      `<div class="fnsku-timing">${Math.round(totalMs)} ms</div>`,
      'warn'
    );
  }

  async function runLookup() {
    const input = document.getElementById('fnsku-direct-input');
    if (!input || state.running) return;

    const sourceFnsku = input.value.trim().toUpperCase();
    if (!sourceFnsku) {
      setStatus('Scan / paste source FNSKU first.', 'warn');
      input.focus();
      return;
    }

    if (!/^[A-Z0-9]{10,}$/.test(sourceFnsku)) {
      setStatus(`Suspicious barcode: <b>${escapeHtml(sourceFnsku)}</b>`, 'warn');
      input.focus();
      return;
    }

    const token = getToken();
    if (!token) {
      setStatus('<b>No anti-CSRF token found on this page.</b><br>Reload the console normally, then try again.', 'error');
      return;
    }

    state.running = true;
    state.runId += 1;
    const myRun = state.runId;
    state.debug = [];
    const started = performance.now();
    debug('RUN_START', { sourceFnsku, pageRegion: currentRegion(), tokenPresent: true });

    setBusy(true);
    setStatus(`Looking up <b>${escapeHtml(sourceFnsku)}</b> in NA + EU simultaneously...`);

    try {
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

      if (!regionResults.length) {
        throw new Error(`Both NA and EU requests failed. ${failures.join(' | ')}`);
      }

      const found = regionResults.filter(r => r.asins.length);
      if (!found.length) {
        const extra = failures.length ? `<br><small>${escapeHtml(failures.join(' | '))}</small>` : '';
        setStatus(`<b>No ASIN found in NA or EU for ${escapeHtml(sourceFnsku)}.</b>${extra}`, 'warn');
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
      const totalMs = performance.now() - started;

      state.lastResult = { sourceFnsku, sourceRegions, asin, jpFnskus, totalMs };
      debug('RUN_SUCCESS', state.lastResult);
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
        width: 340px; box-sizing: border-box; padding: 12px;
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
      #fnsku-direct-status { margin-top:9px; padding:9px; min-height:44px; border-radius:9px; background:#f4f5f6; overflow-wrap:anywhere; }
      #fnsku-direct-status[data-kind="success"] { background:#e9f4ff; border:1px solid #8bbce8; }
      #fnsku-direct-status[data-kind="warn"] { background:#fff4d8; border:1px solid #d9a62d; }
      #fnsku-direct-status[data-kind="error"] { background:#ffe8e8; border:1px solid #d88; }
      .fnsku-line { display:grid; grid-template-columns:64px 1fr; gap:7px; align-items:center; margin:5px 0; }
      .fnsku-line > span:first-child { font-weight:700; opacity:.65; }
      .fnsku-line.target { margin-top:8px; padding-top:7px; border-top:1px solid rgba(0,0,0,.12); }
      .fnsku-line.target .fnsku-result-pill { font-weight:900; font-size:14px; }
      .fnsku-result-pill { padding:4px 7px; font-family:ui-monospace,SFMono-Regular,Consolas,monospace; }
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
      <input id="fnsku-direct-input" autocomplete="off" placeholder="Scan / paste source FNSKU">
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
      <div id="fnsku-direct-status">Ready. NA + EU will be queried in background; JP is queried only after one ASIN is found.</div>
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
