// ==UserScript==
// @name         TEST v0.1.0 Amazon AU ASIN Variation Finder
// @namespace    https://github.com/1Sirkkris/-tampermonkey-v2
// @version      0.1.0
// @description  Right-click an Amazon product variation and choose Find ASIN to reveal matching child ASINs, including unavailable options when Amazon exposes them in page data.
// @author       Kris + ChatGPT
// @match        https://www.amazon.com.au/*/dp/*
// @match        https://www.amazon.com.au/dp/*
// @match        https://www.amazon.com.au/gp/product/*
// @run-at       document-idle
// @grant        GM_setClipboard
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Diagnostics/Amazon_ASIN_Variation_Finder_TEST.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Diagnostics/Amazon_ASIN_Variation_Finder_TEST.user.js
// ==/UserScript==

(() => {
  'use strict';

  const GUARD_ATTR = 'data-amazon-asin-variation-finder';
  if (document.documentElement.hasAttribute(GUARD_ATTR)) return;
  document.documentElement.setAttribute(GUARD_ATTR, '0.1.0');

  const SCRIPT_VERSION = '0.1.0';
  const ASIN_RE = /^[A-Z0-9]{10}$/i;
  const ASIN_IN_URL_RE = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?=[/?#]|$)/i;
  const MENU_ID = 'aavf-context-menu';
  const PANEL_ID = 'aavf-panel';
  const TOAST_ID = 'aavf-toast';

  let activeContext = null;

  function norm(value) {
    return String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function cleanLabel(value) {
    return String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function titleCaseDimension(key) {
    const known = {
      color_name: 'Colour',
      colour_name: 'Colour',
      size_name: 'Size',
      style_name: 'Style',
      pattern_name: 'Pattern',
      item_package_quantity: 'Pack',
      configuration: 'Configuration',
    };
    if (known[key]) return known[key];
    return String(key || 'Variation')
      .replace(/^variation_/, '')
      .replace(/_name$/, '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (m) => m.toUpperCase());
  }

  function getAsinFromUrl(value) {
    const match = String(value || '').match(ASIN_IN_URL_RE);
    return match ? match[1].toUpperCase() : null;
  }

  function collectAsinsFromElement(element) {
    if (!element) return [];
    const found = new Set();
    const keys = [
      'data-asin',
      'data-defaultasin',
      'data-default-asin',
      'data-selected-asin',
      'data-csa-c-item-id',
      'data-dp-url',
      'href',
    ];

    const add = (raw) => {
      const value = cleanLabel(raw);
      if (!value) return;
      if (ASIN_RE.test(value)) found.add(value.toUpperCase());
      const fromUrl = getAsinFromUrl(value);
      if (fromUrl) found.add(fromUrl);
    };

    let node = element;
    for (let depth = 0; node && depth < 7; depth += 1, node = node.parentElement) {
      for (const key of keys) add(node.getAttribute?.(key));
    }

    const descendants = element.querySelectorAll?.('[data-asin], [data-defaultasin], [data-default-asin], [data-selected-asin], [data-dp-url], a[href*="/dp/"], a[href*="/gp/product/"]') || [];
    for (const child of descendants) {
      for (const key of keys) add(child.getAttribute?.(key));
    }

    return [...found];
  }

  function findDimensionRoot(target) {
    let node = target instanceof Element ? target : null;
    while (node && node !== document.documentElement) {
      if (node.id && /^variation_[\w-]+$/i.test(node.id)) return node;
      node = node.parentElement;
    }
    return null;
  }

  function findVariationItem(target, dimensionRoot) {
    if (!(target instanceof Element) || !dimensionRoot) return null;
    let item = target.closest('li, .a-button-toggle, [role="radio"], [data-asin], [data-defaultasin], [data-default-asin]');
    if (item && dimensionRoot.contains(item)) return item;
    item = target.closest('span.a-button, a, button, input');
    return item && dimensionRoot.contains(item) ? item : target;
  }

  function isLikelyVariationDimension(root) {
    if (!root) return false;
    return root.matches('[id^="variation_"]') && (
      root.querySelector('li, .a-button-toggle, [role="radio"], input[type="radio"], img') ||
      root.textContent.trim()
    );
  }

  function getDimensionKey(root) {
    return root?.id?.replace(/^variation_/, '') || null;
  }

  function getLabelFromAnnounce(item) {
    const labelled = item?.querySelector?.('[aria-labelledby]') || (item?.matches?.('[aria-labelledby]') ? item : null);
    const id = labelled?.getAttribute('aria-labelledby')?.split(/\s+/)[0];
    if (!id) return '';
    return cleanLabel(document.getElementById(id)?.textContent);
  }

  function getVariationIndex(item, dimensionKey) {
    if (!item) return null;
    const candidates = [item, ...(item.querySelectorAll?.('input[name], [aria-labelledby], [id]') || [])];
    for (const el of candidates) {
      const name = el.getAttribute?.('name');
      if (/^\d+$/.test(name || '')) return Number(name);

      for (const raw of [el.id, el.getAttribute?.('aria-labelledby')]) {
        const text = String(raw || '');
        const specific = dimensionKey && text.match(new RegExp(`${dimensionKey}_(\\d+)(?:_announce)?`, 'i'));
        if (specific) return Number(specific[1]);
        const generic = text.match(/_(\d+)_announce(?:\s|$)/);
        if (generic) return Number(generic[1]);
      }
    }
    return null;
  }

  function getItemLabel(item, dimensionKey) {
    if (!item) return '';

    const candidates = [];
    const push = (value) => {
      const cleaned = cleanLabel(value);
      if (cleaned) candidates.push(cleaned);
    };

    push(item.getAttribute?.('aria-label'));
    push(item.getAttribute?.('title'));
    push(item.getAttribute?.('data-a-button-inner'));
    push(getLabelFromAnnounce(item));

    for (const img of item.querySelectorAll?.('img') || []) {
      push(img.alt);
      push(img.title);
    }

    for (const el of item.querySelectorAll?.('[aria-label], [title]') || []) {
      push(el.getAttribute('aria-label'));
      push(el.getAttribute('title'));
    }

    const text = cleanLabel(item.innerText || item.textContent);
    push(text);

    const junk = [
      'see available options',
      'currently unavailable',
      'unavailable',
      'select',
      'click to select',
    ];

    const useful = candidates.find((candidate) => {
      const n = norm(candidate);
      return n && !junk.some((phrase) => n === phrase || n.startsWith(`${phrase} `));
    });

    if (useful) return useful;
    return text || titleCaseDimension(dimensionKey);
  }

  function readSelectedValue(root) {
    if (!root) return '';
    const selection = root.querySelector('.selection, .a-color-secondary.selection, [id$="_selection"]');
    if (selection) {
      const text = cleanLabel(selection.textContent).replace(/^[:\-\s]+/, '');
      if (text) return text;
    }

    const selected = root.querySelector('.a-button-selected, [aria-checked="true"], input:checked');
    if (selected) return getItemLabel(selected.closest('li, .a-button-toggle, [role="radio"]') || selected, getDimensionKey(root));
    return '';
  }

  function getSelectedDimensions() {
    const selected = {};
    for (const root of document.querySelectorAll('[id^="variation_"]')) {
      if (!isLikelyVariationDimension(root)) continue;
      const key = getDimensionKey(root);
      const value = readSelectedValue(root);
      if (key && value) selected[key] = value;
    }
    return selected;
  }

  function extractBalancedJson(text, key) {
    if (!text || !key) return null;
    const patterns = [`"${key}"`, `'${key}'`];
    let keyIndex = -1;
    let keyToken = '';
    for (const pattern of patterns) {
      const idx = text.indexOf(pattern);
      if (idx !== -1 && (keyIndex === -1 || idx < keyIndex)) {
        keyIndex = idx;
        keyToken = pattern;
      }
    }
    if (keyIndex === -1) return null;

    const colon = text.indexOf(':', keyIndex + keyToken.length);
    if (colon === -1) return null;

    let start = colon + 1;
    while (start < text.length && /\s/.test(text[start])) start += 1;
    if (text[start] !== '{' && text[start] !== '[') return null;

    const open = text[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let quote = null;
    let escaped = false;

    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === quote) {
          quote = null;
        }
        continue;
      }

      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === open) depth += 1;
      else if (ch === close) {
        depth -= 1;
        if (depth === 0) {
          const raw = text.slice(start, i + 1);
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }

  function parseTwisterData() {
    const keys = [
      'variationValues',
      'asinVariationValues',
      'dimensionValuesDisplayData',
      'variationDisplayLabels',
      'dimensionToAsinMap',
    ];
    const data = Object.fromEntries(keys.map((key) => [key, null]));

    const scripts = [...document.scripts]
      .map((script) => script.textContent || '')
      .filter((text) => /asinVariationValues|dimensionValuesDisplayData|dimensionToAsinMap|variationValues/.test(text));

    for (const text of scripts) {
      for (const key of keys) {
        if (data[key]) continue;
        const parsed = extractBalancedJson(text, key);
        if (parsed && typeof parsed === 'object') data[key] = parsed;
      }
      if (data.asinVariationValues && data.variationValues) break;
    }

    return data;
  }

  function resolveVariationValue(rawValue, dimensionKey, variationValues) {
    if (rawValue == null) return '';
    const values = variationValues?.[dimensionKey];
    if (Array.isArray(values)) {
      const index = Number(rawValue);
      if (Number.isInteger(index) && index >= 0 && index < values.length) {
        return cleanLabel(values[index]);
      }
    }
    return cleanLabel(rawValue);
  }

  function buildRowsFromTwister(data) {
    const rows = [];
    const seen = new Set();
    const maps = data.asinVariationValues;

    if (maps && typeof maps === 'object') {
      for (const [asinRaw, dimensionMap] of Object.entries(maps)) {
        const asin = String(asinRaw).toUpperCase();
        if (!ASIN_RE.test(asin) || !dimensionMap || typeof dimensionMap !== 'object') continue;
        const dimensions = {};
        for (const [key, rawValue] of Object.entries(dimensionMap)) {
          if (key === 'ASIN') continue;
          dimensions[key] = resolveVariationValue(rawValue, key, data.variationValues);
        }
        const display = Array.isArray(data.dimensionValuesDisplayData?.[asin])
          ? data.dimensionValuesDisplayData[asin].map(cleanLabel).filter(Boolean)
          : [];
        rows.push({ asin, dimensions, display, source: 'twister' });
        seen.add(asin);
      }
    }

    if (data.dimensionValuesDisplayData && typeof data.dimensionValuesDisplayData === 'object') {
      for (const [asinRaw, displayRaw] of Object.entries(data.dimensionValuesDisplayData)) {
        const asin = String(asinRaw).toUpperCase();
        if (!ASIN_RE.test(asin) || seen.has(asin)) continue;
        const display = Array.isArray(displayRaw)
          ? displayRaw.map(cleanLabel).filter(Boolean)
          : [cleanLabel(displayRaw)].filter(Boolean);
        rows.push({ asin, dimensions: {}, display, source: 'display-data' });
        seen.add(asin);
      }
    }

    return rows;
  }

  function labelMatches(row, dimensionKey, clickedLabel) {
    const needle = norm(clickedLabel);
    if (!needle) return false;

    const direct = norm(row.dimensions?.[dimensionKey]);
    if (direct && (direct === needle || direct.includes(needle) || needle.includes(direct))) return true;

    return row.display.some((value) => {
      const n = norm(value);
      return n === needle || n.includes(needle) || needle.includes(n);
    });
  }

  function exactSelectionMatches(row, expected) {
    const entries = Object.entries(expected).filter(([, value]) => cleanLabel(value));
    if (!entries.length) return false;
    let comparable = 0;
    for (const [key, expectedValue] of entries) {
      const actual = row.dimensions?.[key];
      if (!actual) continue;
      comparable += 1;
      const a = norm(actual);
      const b = norm(expectedValue);
      if (!(a === b || a.includes(b) || b.includes(a))) return false;
    }
    return comparable > 0;
  }

  function formatDimensions(row) {
    const parts = Object.entries(row.dimensions || {})
      .filter(([, value]) => cleanLabel(value))
      .map(([key, value]) => `${titleCaseDimension(key)}: ${value}`);
    if (parts.length) return parts.join(' · ');
    return row.display.join(' · ');
  }

  function getContext(target) {
    const root = findDimensionRoot(target);
    if (!isLikelyVariationDimension(root)) return null;
    const item = findVariationItem(target, root);
    const dimensionKey = getDimensionKey(root);
    const data = parseTwisterData();
    const variationIndex = getVariationIndex(item, dimensionKey);
    const indexedLabel = Number.isInteger(variationIndex)
      ? cleanLabel(data.variationValues?.[dimensionKey]?.[variationIndex])
      : '';
    const label = indexedLabel || getItemLabel(item, dimensionKey);
    return {
      root,
      item,
      dimensionKey,
      dimensionLabel: titleCaseDimension(dimensionKey),
      variationIndex,
      label,
      directAsins: collectAsinsFromElement(item),
      selectedDimensions: getSelectedDimensions(),
      twisterData: data,
    };
  }

  function findAsins(context) {
    const data = context.twisterData || parseTwisterData();
    const allRows = buildRowsFromTwister(data);
    const expected = { ...context.selectedDimensions, [context.dimensionKey]: context.label };

    let matches = allRows.filter((row) => labelMatches(row, context.dimensionKey, context.label));
    const directSet = new Set(context.directAsins);

    if (!matches.length && directSet.size) {
      matches = allRows.filter((row) => directSet.has(row.asin));
    }

    for (const asin of context.directAsins) {
      if (!matches.some((row) => row.asin === asin)) {
        matches.push({ asin, dimensions: {}, display: [], source: 'tile' });
      }
    }

    matches = matches.map((row) => ({
      ...row,
      exact: exactSelectionMatches(row, expected),
      direct: directSet.has(row.asin),
    }));

    matches.sort((a, b) => Number(b.exact) - Number(a.exact) || Number(b.direct) - Number(a.direct) || a.asin.localeCompare(b.asin));

    return {
      rows: matches,
      allRows,
      expected,
      parsed: Boolean(data.asinVariationValues || data.dimensionValuesDisplayData || data.dimensionToAsinMap),
    };
  }

  function ensureStyles() {
    if (document.getElementById('aavf-styles')) return;
    const style = document.createElement('style');
    style.id = 'aavf-styles';
    style.textContent = `
      #${MENU_ID}, #${PANEL_ID}, #${TOAST_ID} { font-family: Arial, Helvetica, sans-serif; box-sizing: border-box; }
      #${MENU_ID} { position: fixed; z-index: 2147483646; min-width: 180px; padding: 6px; background: #111827; color: #fff; border: 1px solid #6b7280; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.35); }
      #${MENU_ID} button { width: 100%; border: 0; border-radius: 6px; padding: 10px 12px; text-align: left; font-size: 14px; font-weight: 700; color: #fff; background: #1f2937; cursor: pointer; }
      #${MENU_ID} button:hover, #${MENU_ID} button:focus { outline: 2px solid #f59e0b; background: #374151; }
      #${MENU_ID} .aavf-sub { display: block; margin-top: 3px; font-size: 11px; font-weight: 400; color: #d1d5db; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #${PANEL_ID} { position: fixed; z-index: 2147483646; width: min(520px, calc(100vw - 24px)); max-height: min(70vh, 560px); overflow: auto; padding: 14px; background: #fff; color: #111827; border: 2px solid #111827; border-radius: 10px; box-shadow: 0 12px 34px rgba(0,0,0,.35); }
      #${PANEL_ID} * { box-sizing: border-box; }
      #${PANEL_ID} .aavf-head { display: flex; gap: 10px; align-items: flex-start; justify-content: space-between; margin-bottom: 10px; }
      #${PANEL_ID} .aavf-title { font-size: 16px; font-weight: 800; line-height: 1.25; }
      #${PANEL_ID} .aavf-meta { margin-top: 3px; color: #4b5563; font-size: 12px; }
      #${PANEL_ID} .aavf-close { flex: 0 0 auto; border: 1px solid #9ca3af; background: #f3f4f6; color: #111827; border-radius: 6px; width: 30px; height: 30px; cursor: pointer; font-size: 18px; line-height: 1; }
      #${PANEL_ID} .aavf-note { margin: 8px 0 10px; padding: 8px 10px; border-left: 4px solid #2563eb; background: #eff6ff; color: #1e3a8a; font-size: 12px; }
      #${PANEL_ID} .aavf-empty { padding: 12px; background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 7px; font-size: 13px; }
      #${PANEL_ID} .aavf-row { display: grid; grid-template-columns: minmax(110px, auto) 1fr auto; gap: 10px; align-items: center; padding: 9px 0; border-top: 1px solid #e5e7eb; }
      #${PANEL_ID} .aavf-row:first-of-type { border-top: 0; }
      #${PANEL_ID} .aavf-asin { font-family: Consolas, 'Courier New', monospace; font-size: 15px; font-weight: 800; color: #111827; }
      #${PANEL_ID} .aavf-dims { min-width: 0; color: #374151; font-size: 12px; line-height: 1.35; }
      #${PANEL_ID} .aavf-badges { margin-top: 3px; display: flex; gap: 4px; flex-wrap: wrap; }
      #${PANEL_ID} .aavf-badge { display: inline-block; padding: 1px 6px; border-radius: 999px; font-size: 10px; font-weight: 800; border: 1px solid #111827; background: #fff7ed; color: #7c2d12; }
      #${PANEL_ID} .aavf-badge.direct { background: #ecfeff; color: #164e63; }
      #${PANEL_ID} .aavf-copy { border: 1px solid #111827; background: #111827; color: #fff; border-radius: 6px; padding: 7px 10px; cursor: pointer; font-weight: 800; }
      #${PANEL_ID} .aavf-copy:hover, #${PANEL_ID} .aavf-copy:focus { outline: 2px solid #f59e0b; outline-offset: 1px; }
      #${PANEL_ID} .aavf-footer { margin-top: 10px; color: #6b7280; font-size: 10px; }
      #${TOAST_ID} { position: fixed; z-index: 2147483647; left: 50%; bottom: 24px; transform: translateX(-50%); padding: 10px 14px; background: #111827; color: #fff; border: 2px solid #f59e0b; border-radius: 8px; font-size: 13px; font-weight: 800; box-shadow: 0 8px 24px rgba(0,0,0,.35); }
      @media (max-width: 560px) {
        #${PANEL_ID} .aavf-row { grid-template-columns: 1fr auto; }
        #${PANEL_ID} .aavf-dims { grid-column: 1 / -1; }
      }
    `;
    document.documentElement.appendChild(style);
  }

  function removeMenu() {
    document.getElementById(MENU_ID)?.remove();
  }

  function removePanel() {
    document.getElementById(PANEL_ID)?.remove();
  }

  function placeFixed(el, x, y, margin = 8) {
    document.body.appendChild(el);
    const rect = el.getBoundingClientRect();
    const left = Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin));
    const top = Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  function showToast(message) {
    ensureStyles();
    document.getElementById(TOAST_ID)?.remove();
    const toast = document.createElement('div');
    toast.id = TOAST_ID;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2200);
  }

  async function copyText(text) {
    const value = cleanLabel(text);
    if (!value) return false;
    try {
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(value, 'text');
        return true;
      }
    } catch {
      // Fallback below.
    }
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      return false;
    }
  }

  function showResults(context, x, y) {
    removeMenu();
    removePanel();
    ensureStyles();

    const result = findAsins(context);
    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'ASIN variation results');

    const exactCount = result.rows.filter((row) => row.exact).length;
    const title = `${context.dimensionLabel}: ${context.label || 'Selected option'}`;

    let note = '';
    if (result.rows.length > 1) {
      note = exactCount
        ? 'Exact selected combination is first. Other rows are sibling child ASINs for this variation.'
        : 'No exact selected combination was exposed, so these are the child ASINs Amazon links to this variation.';
    } else if (result.rows.length === 1 && !result.rows[0].exact) {
      note = 'Amazon exposed this child ASIN for the variation tile, but the exact selected combination could not be proven from page data.';
    }

    const rowsHtml = result.rows.length
      ? result.rows.map((row) => {
          const badges = [
            row.exact ? '<span class="aavf-badge">EXACT</span>' : '',
            row.direct ? '<span class="aavf-badge direct">TILE</span>' : '',
          ].join('');
          const dims = formatDimensions(row) || 'Variation details not exposed';
          return `
            <div class="aavf-row">
              <div>
                <div class="aavf-asin">${escapeHtml(row.asin)}</div>
                <div class="aavf-badges">${badges}</div>
              </div>
              <div class="aavf-dims">${escapeHtml(dims)}</div>
              <button type="button" class="aavf-copy" data-asin="${escapeHtml(row.asin)}">Copy</button>
            </div>`;
        }).join('')
      : `<div class="aavf-empty">No child ASIN was exposed for this tile in the loaded page. Try another variation tile or reload the product page once.</div>`;

    panel.innerHTML = `
      <div class="aavf-head">
        <div>
          <div class="aavf-title">${escapeHtml(title)}</div>
          <div class="aavf-meta">${result.rows.length} ASIN${result.rows.length === 1 ? '' : 's'} found</div>
        </div>
        <button type="button" class="aavf-close" aria-label="Close">×</button>
      </div>
      ${note ? `<div class="aavf-note">${escapeHtml(note)}</div>` : ''}
      <div>${rowsHtml}</div>
      <div class="aavf-footer">Amazon AU ASIN Variation Finder v${SCRIPT_VERSION} · Reads the current product page only; no network requests.</div>
    `;

    panel.querySelector('.aavf-close')?.addEventListener('click', removePanel);
    for (const button of panel.querySelectorAll('.aavf-copy')) {
      button.addEventListener('click', async () => {
        const asin = button.getAttribute('data-asin');
        const ok = await copyText(asin);
        showToast(ok ? `Copied ${asin}` : `ASIN: ${asin}`);
      });
    }

    placeFixed(panel, x, y);
  }

  function showMenu(context, x, y) {
    removeMenu();
    removePanel();
    ensureStyles();
    activeContext = context;

    const menu = document.createElement('div');
    menu.id = MENU_ID;
    menu.setAttribute('role', 'menu');
    menu.innerHTML = `
      <button type="button" role="menuitem">
        Find ASIN
        <span class="aavf-sub">${escapeHtml(`${context.dimensionLabel}: ${context.label || 'variation'}`)}</span>
      </button>
    `;
    menu.querySelector('button').addEventListener('click', () => showResults(activeContext, x, y));
    placeFixed(menu, x, y);
    menu.querySelector('button')?.focus({ preventScroll: true });
  }

  document.addEventListener('contextmenu', (event) => {
    if (event.shiftKey) return;
    const context = getContext(event.target);
    if (!context) return;
    event.preventDefault();
    event.stopPropagation();
    showMenu(context, event.clientX, event.clientY);
  }, true);

  document.addEventListener('pointerdown', (event) => {
    const menu = document.getElementById(MENU_ID);
    if (menu && !menu.contains(event.target)) removeMenu();
    const panel = document.getElementById(PANEL_ID);
    if (panel && !panel.contains(event.target) && !findDimensionRoot(event.target)) removePanel();
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    removeMenu();
    removePanel();
  }, true);
})();
