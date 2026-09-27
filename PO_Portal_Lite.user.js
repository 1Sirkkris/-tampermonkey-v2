// ==UserScript==
// @name         PO Portal Lite
// @name:en      PO Portal Lite
// @namespace    https://github.com/1Sirkkris
// @version      0.1.0
// @description  Lightweight PO Portal controls and results view for AU ISS workflow.
// @include      /^https?:\/\/console\.harmony\.a2z\.com\/poportal(?:[/?#]|$)/
// @run-at       document-start
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/PO_Portal_Lite.user.js
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/PO_Portal_Lite.user.js
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = '0.1.0';
  const GUARD = 'data-bwu2-po-portal-lite';
  const ALL_CONDITIONS = [
    'Complete',
    'CompletelyConfirmed',
    'PartiallyConfirmed',
    'Submitted',
    'Reserved',
    'Confirmed'
  ];
  const KEEP_HEADERS = [
    /^po id\b/i,
    /^status\b/i,
    /^fc\b/i,
    /^ordered\b/i,
    /^shipped\b/i,
    /^first recv\b/i,
    /^last recv\b/i,
    /^exp(?:\b|\W)/i,
    /^rec(?:\b|\W)/i,
    /^disc(?:\b|\W)/i
  ];

  if (document.documentElement.hasAttribute(GUARD)) return;
  document.documentElement.setAttribute(GUARD, VERSION);

  // Base route is only a shell; go straight to the actual PO Portal page.
  if (/^\/poportal\/?$/i.test(location.pathname)) {
    location.replace('/poportal/fe' + location.search + location.hash);
    return;
  }

  let fullView = false;
  let observer = null;
  let applyQueued = false;

  const pad = n => String(n).padStart(2, '0');

  function formatDate(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function monthsAgo(date, months) {
    const out = new Date(date.getFullYear(), date.getMonth(), 1);
    const day = date.getDate();
    out.setMonth(out.getMonth() - months);
    const maxDay = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate();
    out.setDate(Math.min(day, maxDay));
    return out;
  }

  function validDateText(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00');
    return !Number.isNaN(date.getTime()) && formatDate(date) === value;
  }

  function registerRuntimeVersion(label, version) {
    const mount = () => {
      const root = document.body || document.documentElement;
      if (!root) return;
      let host = document.getElementById('bwu2-runtime-version-stamp');
      if (!host) {
        host = document.createElement('div');
        host.id = 'bwu2-runtime-version-stamp';
        host.setAttribute('aria-hidden', 'true');
        host.style.cssText = 'position:fixed;left:50%;bottom:2px;transform:translateX(-50%);z-index:2147483000;display:flex;flex-wrap:wrap;justify-content:center;gap:2px 10px;max-width:94vw;padding:2px 7px;border-radius:6px 6px 0 0;background:rgba(255,255,255,.34);color:rgba(15,23,42,.52);box-shadow:0 0 0 1px rgba(15,23,42,.05);backdrop-filter:blur(1.5px);font:800 11px/1.25 Arial,sans-serif;letter-spacing:.2px;pointer-events:none;user-select:none;text-shadow:0 1px 1px rgba(255,255,255,.95),0 0 3px rgba(255,255,255,.75)';
        root.appendChild(host);
      }
      let item = [...host.children].find(node => node.dataset?.bwu2RuntimeKey === label);
      if (!item) {
        item = document.createElement('span');
        item.dataset.bwu2RuntimeKey = label;
        host.appendChild(item);
      }
      item.textContent = `${label} · v${version}`;
      [...host.children]
        .sort((a, b) => String(a.dataset?.bwu2RuntimeKey || '').localeCompare(String(b.dataset?.bwu2RuntimeKey || '')))
        .forEach(node => host.appendChild(node));
    };
    mount();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  }

  function installStyle() {
    if (document.getElementById('bwu2-po-lite-style')) return;
    const style = document.createElement('style');
    style.id = 'bwu2-po-lite-style';
    style.textContent = `
      #bwu2-po-lite-panel {
        position: sticky;
        top: 0;
        z-index: 2147482000;
        display: flex;
        flex-wrap: wrap;
        align-items: end;
        gap: 8px 10px;
        padding: 10px 12px;
        margin: 0 0 8px;
        background: #182638;
        color: #fff;
        border-bottom: 2px solid #0ea5e9;
        box-shadow: 0 2px 8px rgba(0,0,0,.25);
        font: 700 13px/1.25 Arial,sans-serif;
      }
      #bwu2-po-lite-panel label { display:flex; flex-direction:column; gap:3px; }
      #bwu2-po-lite-panel input {
        min-width: 132px;
        height: 32px;
        padding: 4px 8px;
        border: 1px solid #94a3b8;
        border-radius: 5px;
        background: #fff;
        color: #0f172a;
        font: 700 14px Arial,sans-serif;
      }
      #bwu2-po-lite-panel #bwu2-po-lite-asin { min-width: 180px; }
      #bwu2-po-lite-panel button {
        height: 32px;
        padding: 0 11px;
        border: 0;
        border-radius: 5px;
        background: #e2e8f0;
        color: #0f172a;
        font: 800 13px Arial,sans-serif;
        cursor: pointer;
      }
      #bwu2-po-lite-panel button:hover { filter: brightness(.96); }
      #bwu2-po-lite-panel .primary { background:#0ea5e9; color:#fff; min-width:80px; }
      #bwu2-po-lite-panel .active { background:#f59e0b; color:#111827; }
      #bwu2-po-lite-panel .meta {
        align-self:center;
        color:#cbd5e1;
        font-weight:700;
        white-space:nowrap;
      }
      #bwu2-po-lite-error {
        display:none;
        width:100%;
        padding:5px 8px;
        border-radius:4px;
        background:#7f1d1d;
        color:#fff;
      }
      .bwu2-po-lite-stock-search-hidden { display:none !important; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function currentDefaults() {
    const params = new URLSearchParams(location.search);
    const today = new Date();
    return {
      asin: params.get('asin') || '',
      start: params.get('startDate') || formatDate(monthsAgo(today, 6)),
      end: params.get('endDate') || formatDate(today)
    };
  }

  function buildPanel() {
    if (document.getElementById('bwu2-po-lite-panel')) return;

    const d = currentDefaults();
    const panel = document.createElement('div');
    panel.id = 'bwu2-po-lite-panel';
    panel.innerHTML = `
      <label>ASIN / FNSKU
        <input id="bwu2-po-lite-asin" type="text" autocomplete="off" spellcheck="false">
      </label>
      <label>From
        <input id="bwu2-po-lite-start" type="text" inputmode="numeric" placeholder="YYYY-MM-DD">
      </label>
      <label>To
        <input id="bwu2-po-lite-end" type="text" inputmode="numeric" placeholder="YYYY-MM-DD">
      </label>
      <button type="button" data-range="6">6M</button>
      <button type="button" data-range="12">12M</button>
      <button type="button" id="bwu2-po-lite-today">To Today</button>
      <button type="button" class="primary" id="bwu2-po-lite-search">Search</button>
      <button type="button" id="bwu2-po-lite-full">Full Portal</button>
      <span class="meta">AU · All PO conditions</span>
      <div id="bwu2-po-lite-error"></div>
    `;

    const root = document.body || document.documentElement;
    root.prepend(panel);

    const asin = panel.querySelector('#bwu2-po-lite-asin');
    const start = panel.querySelector('#bwu2-po-lite-start');
    const end = panel.querySelector('#bwu2-po-lite-end');
    asin.value = d.asin;
    start.value = d.start;
    end.value = d.end;

    const setRange = months => {
      const endDate = validDateText(end.value) ? new Date(end.value + 'T00:00:00') : new Date();
      start.value = formatDate(monthsAgo(endDate, months));
    };

    panel.querySelectorAll('[data-range]').forEach(button => {
      button.addEventListener('click', () => setRange(Number(button.dataset.range)));
    });

    panel.querySelector('#bwu2-po-lite-today').addEventListener('click', () => {
      end.value = formatDate(new Date());
    });

    const runSearch = () => {
      const error = panel.querySelector('#bwu2-po-lite-error');
      const asinValue = asin.value.trim();
      const startValue = start.value.trim();
      const endValue = end.value.trim();

      let message = '';
      if (!asinValue) message = 'Scan or enter ASIN / FNSKU.';
      else if (!validDateText(startValue) || !validDateText(endValue)) message = 'Dates must be YYYY-MM-DD.';
      else if (startValue > endValue) message = 'From date must be before To date.';

      if (message) {
        error.textContent = message;
        error.style.display = 'block';
        return;
      }

      error.style.display = 'none';
      const url = new URL('/poportal/fe', location.origin);
      url.searchParams.set('asin', asinValue);
      url.searchParams.set('startDate', startValue);
      url.searchParams.set('endDate', endValue);
      url.searchParams.set('countries', 'AU');
      url.searchParams.set('distributorChecks', ALL_CONDITIONS.join(','));
      url.searchParams.set('removeZeroFilter', 'false');
      location.assign(url.href);
    };

    panel.querySelector('#bwu2-po-lite-search').addEventListener('click', runSearch);
    asin.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        runSearch();
      }
    });

    panel.querySelector('#bwu2-po-lite-full').addEventListener('click', event => {
      fullView = !fullView;
      event.currentTarget.classList.toggle('active', fullView);
      event.currentTarget.textContent = fullView ? 'Lite View' : 'Full Portal';
      queueApply();
    });
  }

  function findStockSearchBlock() {
    const asin = document.getElementById('asin');
    if (!asin) return null;

    const form = asin.closest('form');
    if (form && !form.querySelector('table[id*="purchase" i], table[id*="result" i]')) return form;

    let node = asin.parentElement;
    for (let i = 0; node && i < 6; i += 1, node = node.parentElement) {
      const text = String(node.textContent || '').replace(/\s+/g, ' ').trim();
      if (/ASIN \/ FNSKu/i.test(text) && /Ordered From/i.test(text) && /PO Condition/i.test(text)) return node;
    }
    return null;
  }

  function normalizedHeader(text) {
    return String(text || '')
      .replace(/[↑↓↕⇅]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isKeptHeader(text) {
    const normalized = normalizedHeader(text);
    return KEEP_HEADERS.some(pattern => pattern.test(normalized));
  }

  function findResultHeaderRow(table) {
    return [...table.rows].find(row => {
      const texts = [...row.cells].map(cell => normalizedHeader(cell.textContent));
      return texts.some(text => /^po id\b/i.test(text))
        && texts.some(text => /^status\b/i.test(text))
        && texts.some(text => /^fc\b/i.test(text));
    }) || null;
  }

  function applyLiteColumns() {
    const tables = [...document.querySelectorAll('table')];
    for (const table of tables) {
      const headerRow = findResultHeaderRow(table);
      if (!headerRow) continue;

      const headerCount = headerRow.cells.length;
      const keep = [...headerRow.cells].map(cell => isKeptHeader(cell.textContent));
      if (keep.filter(Boolean).length < 8) continue;

      for (const row of table.rows) {
        if (row.cells.length !== headerCount) continue;
        [...row.cells].forEach((cell, index) => {
          cell.style.display = fullView || keep[index] ? '' : 'none';
        });
      }

      table.dataset.bwu2PoLite = '1';
    }
  }

  function applyView() {
    applyQueued = false;
    buildPanel();

    const stockSearch = findStockSearchBlock();
    if (stockSearch) {
      stockSearch.classList.toggle('bwu2-po-lite-stock-search-hidden', !fullView);
    }

    applyLiteColumns();
  }

  function queueApply() {
    if (applyQueued) return;
    applyQueued = true;
    requestAnimationFrame(applyView);
  }

  function boot() {
    installStyle();
    registerRuntimeVersion('PO-LITE', VERSION);
    buildPanel();
    applyView();

    observer = new MutationObserver(queueApply);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
