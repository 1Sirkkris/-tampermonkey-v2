// ==UserScript==
// @name         TEST v0.1.1 Amazon AU ASIN Variation Finder
// @namespace    https://github.com/1Sirkkris/-tampermonkey-v2
// @version      0.1.1
// @description  Right-click an Amazon product variation and choose Find ASIN to reveal child ASINs, including unavailable options when Amazon exposes them in the loaded page.
// @author       Kris + ChatGPT
// @match        https://www.amazon.com.au/*
// @match        https://amazon.com.au/*
// @run-at       document-idle
// @grant        GM_setClipboard
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Diagnostics/Amazon_ASIN_Variation_Finder_TEST.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Diagnostics/Amazon_ASIN_Variation_Finder_TEST.user.js
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = '0.1.1';
  const GUARD = 'data-amazon-asin-variation-finder';
  const MENU_ID = 'aavf-context-menu';
  const PANEL_ID = 'aavf-panel';
  const TOAST_ID = 'aavf-toast';
  const ASIN_RE = /^[A-Z0-9]{10}$/i;
  const ASIN_URL_RE = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?=[/?#]|$)/i;

  if (document.documentElement.hasAttribute(GUARD)) return;
  document.documentElement.setAttribute(GUARD, VERSION);

  let activeContext = null;

  const clean = (value) => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const norm = (value) => clean(value).toLowerCase();

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function dimensionTitle(key) {
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
    return clean(key || 'Variation')
      .replace(/^variation_/, '')
      .replace(/_name$/, '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (m) => m.toUpperCase());
  }

  function asinFromUrl(value) {
    const match = String(value || '').match(ASIN_URL_RE);
    return match ? match[1].toUpperCase() : null;
  }

  function extractBalancedJson(text, key) {
    if (!text || !key) return null;
    const quotedKeys = [`"${key}"`, `'${key}'`];
    let keyIndex = -1;
    let tokenLength = 0;

    for (const quoted of quotedKeys) {
      const index = text.indexOf(quoted);
      if (index !== -1 && (keyIndex === -1 || index < keyIndex)) {
        keyIndex = index;
        tokenLength = quoted.length;
      }
    }
    if (keyIndex === -1) return null;

    const colon = text.indexOf(':', keyIndex + tokenLength);
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
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === quote) quote = null;
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
          try {
            return JSON.parse(text.slice(start, i + 1));
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

    for (const script of document.scripts) {
      const text = script.textContent || '';
      if (!/variationValues|asinVariationValues|dimensionValuesDisplayData|dimensionToAsinMap/.test(text)) continue;
      for (const key of keys) {
        if (data[key]) continue;
        const value = extractBalancedJson(text, key);
        if (value && typeof value === 'object') data[key] = value;
      }
    }
    return data;
  }

  function parseDimensionSignal(element) {
    if (!(element instanceof Element)) return null;
    const candidates = [element, ...element.querySelectorAll('[id], [aria-labelledby], input[name]')];

    for (const candidate of candidates) {
      const values = [candidate.id, candidate.getAttribute?.('aria-labelledby')];
      for (const raw of values) {
        const text = String(raw || '');
        const match = text.match(/(?:^|\s)([a-z][\w-]*(?:_name)?|item_package_quantity|configuration)_(\d+)(?:_announce)?(?:\s|$)/i);
        if (match) return { dimensionKey: match[1], index: Number(match[2]) };
      }
    }

    for (const candidate of candidates) {
      const name = candidate.getAttribute?.('name');
      if (/^\d+$/.test(name || '')) return { dimensionKey: null, index: Number(name) };
    }
    return null;
  }

  function findTile(target) {
    if (!(target instanceof Element)) return null;
    return target.closest(
      'li.dimension-value-list-item-square-image, li.dimension-value-list-item, li[class*="dimension-value"], li, span.a-button-toggle, span.a-button'
    );
  }

  function findClassicDimensionRoot(target) {
    if (!(target instanceof Element)) return null;
    let node = target;
    while (node && node !== document.documentElement) {
      if (node.id && /^variation_[\w-]+$/i.test(node.id)) return node;
      node = node.parentElement;
    }
    return null;
  }

  function isInsideTwister(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest('#twister, [id*="twister"], [class*="twister"]'));
  }

  function resolveLabelFromElement(item) {
    if (!item) return '';
    const values = [];
    const add = (value) => {
      const v = clean(value);
      if (v) values.push(v);
    };

    add(item.getAttribute?.('aria-label'));
    add(item.getAttribute?.('title'));

    for (const child of item.querySelectorAll?.('[aria-label], [title], img, [aria-labelledby]') || []) {
      add(child.getAttribute?.('aria-label'));
      add(child.getAttribute?.('title'));
      if (child.tagName === 'IMG') add(child.alt);
      const labelledBy = child.getAttribute?.('aria-labelledby');
      if (labelledBy) {
        for (const id of labelledBy.split(/\s+/)) add(document.getElementById(id)?.textContent);
      }
    }

    const junk = /^(see available options|currently unavailable|unavailable|select|click to select)$/i;
    const useful = values.find((value) => !junk.test(value));
    return useful || clean(item.innerText || item.textContent);
  }

  function collectDirectAsins(item) {
    if (!item) return [];
    const found = new Set();
    const keys = ['data-asin', 'data-defaultasin', 'data-default-asin', 'data-selected-asin', 'data-dp-url', 'href'];

    const add = (value) => {
      const raw = clean(value);
      if (!raw) return;
      if (ASIN_RE.test(raw)) found.add(raw.toUpperCase());
      const fromUrl = asinFromUrl(raw);
      if (fromUrl) found.add(fromUrl);
    };

    let node = item;
    for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
      for (const key of keys) add(node.getAttribute?.(key));
    }

    for (const child of item.querySelectorAll?.('[data-asin], [data-defaultasin], [data-default-asin], [data-selected-asin], [data-dp-url], a[href]') || []) {
      for (const key of keys) add(child.getAttribute?.(key));
    }
    return [...found];
  }

  function resolveVariationValue(rawValue, key, variationValues) {
    if (rawValue == null) return '';
    const values = variationValues?.[key];
    const index = Number(rawValue);
    if (Array.isArray(values) && Number.isInteger(index) && index >= 0 && index < values.length) {
      return clean(values[index]);
    }
    return clean(rawValue);
  }

  function buildRows(data) {
    const rows = [];
    const seen = new Set();

    if (data.asinVariationValues && typeof data.asinVariationValues === 'object') {
      for (const [asinRaw, map] of Object.entries(data.asinVariationValues)) {
        const asin = String(asinRaw).toUpperCase();
        if (!ASIN_RE.test(asin) || !map || typeof map !== 'object') continue;
        const dimensions = {};
        for (const [key, rawValue] of Object.entries(map)) {
          if (key === 'ASIN') continue;
          dimensions[key] = resolveVariationValue(rawValue, key, data.variationValues);
        }
        const display = Array.isArray(data.dimensionValuesDisplayData?.[asin])
          ? data.dimensionValuesDisplayData[asin].map(clean).filter(Boolean)
          : [];
        rows.push({ asin, dimensions, display });
        seen.add(asin);
      }
    }

    if (data.dimensionValuesDisplayData && typeof data.dimensionValuesDisplayData === 'object') {
      for (const [asinRaw, displayRaw] of Object.entries(data.dimensionValuesDisplayData)) {
        const asin = String(asinRaw).toUpperCase();
        if (!ASIN_RE.test(asin) || seen.has(asin)) continue;
        const display = Array.isArray(displayRaw) ? displayRaw.map(clean).filter(Boolean) : [clean(displayRaw)].filter(Boolean);
        rows.push({ asin, dimensions: {}, display });
        seen.add(asin);
      }
    }

    return rows;
  }

  function readSelectedDimensions(data) {
    const selected = {};
    const selectedNodes = document.querySelectorAll(
      '#twister .a-button-selected, [id*="twister"] .a-button-selected, [id^="variation_"] .a-button-selected, [aria-checked="true"]'
    );

    for (const node of selectedNodes) {
      const tile = node.closest('li, span.a-button') || node;
      const signal = parseDimensionSignal(tile);
      if (!signal?.dimensionKey) continue;
      const indexed = Number.isInteger(signal.index) ? clean(data.variationValues?.[signal.dimensionKey]?.[signal.index]) : '';
      selected[signal.dimensionKey] = indexed || resolveLabelFromElement(tile);
    }

    for (const root of document.querySelectorAll('[id^="variation_"]')) {
      const key = root.id.replace(/^variation_/, '');
      if (selected[key]) continue;
      const selectedNode = root.querySelector('.a-button-selected, [aria-checked="true"], input:checked');
      if (selectedNode) selected[key] = resolveLabelFromElement(selectedNode.closest('li, span.a-button') || selectedNode);
    }
    return selected;
  }

  function makeContext(target) {
    const tile = findTile(target);
    if (!tile) return null;

    const classicRoot = findClassicDimensionRoot(target);
    if (!classicRoot && !isInsideTwister(target)) return null;

    const data = parseTwisterData();
    const tileSignal = parseDimensionSignal(tile);
    const rootKey = classicRoot?.id?.replace(/^variation_/, '') || null;
    const dimensionKey = tileSignal?.dimensionKey || rootKey;
    const index = tileSignal?.index;
    const indexedLabel = dimensionKey && Number.isInteger(index)
      ? clean(data.variationValues?.[dimensionKey]?.[index])
      : '';
    const label = indexedLabel || resolveLabelFromElement(tile);
    const directAsins = collectDirectAsins(tile);

    if (!dimensionKey && !directAsins.length) return null;

    return {
      tile,
      dimensionKey,
      dimensionLabel: dimensionTitle(dimensionKey),
      index,
      label,
      directAsins,
      selectedDimensions: readSelectedDimensions(data),
      data,
    };
  }

  function rowMatchesClicked(row, context) {
    const needle = norm(context.label);
    if (!needle) return context.directAsins.includes(row.asin);

    const directValue = norm(row.dimensions?.[context.dimensionKey]);
    if (directValue && (directValue === needle || directValue.includes(needle) || needle.includes(directValue))) return true;

    return row.display.some((value) => {
      const candidate = norm(value);
      return candidate === needle || candidate.includes(needle) || needle.includes(candidate);
    });
  }

  function rowMatchesSelection(row, expected) {
    let compared = 0;
    for (const [key, expectedValue] of Object.entries(expected)) {
      if (!expectedValue) continue;
      const actual = row.dimensions?.[key];
      if (!actual) continue;
      compared += 1;
      const a = norm(actual);
      const b = norm(expectedValue);
      if (!(a === b || a.includes(b) || b.includes(a))) return false;
    }
    return compared > 0;
  }

  function findResults(context) {
    const allRows = buildRows(context.data);
    const direct = new Set(context.directAsins);
    const expected = { ...context.selectedDimensions };
    if (context.dimensionKey && context.label) expected[context.dimensionKey] = context.label;

    let rows = allRows.filter((row) => rowMatchesClicked(row, context));
    if (!rows.length && direct.size) rows = allRows.filter((row) => direct.has(row.asin));

    for (const asin of direct) {
      if (!rows.some((row) => row.asin === asin)) rows.push({ asin, dimensions: {}, display: [] });
    }

    rows = rows.map((row) => ({
      ...row,
      direct: direct.has(row.asin),
      exact: rowMatchesSelection(row, expected),
    }));

    rows.sort((a, b) => Number(b.exact) - Number(a.exact) || Number(b.direct) - Number(a.direct) || a.asin.localeCompare(b.asin));
    return rows;
  }

  function ensureStyles() {
    if (document.getElementById('aavf-styles')) return;
    const style = document.createElement('style');
    style.id = 'aavf-styles';
    style.textContent = `
      #${MENU_ID}, #${PANEL_ID}, #${TOAST_ID} { font-family: Arial, Helvetica, sans-serif; box-sizing: border-box; }
      #${MENU_ID} { position: fixed; z-index: 2147483646; min-width: 190px; padding: 6px; background: #111827; color: #fff; border: 2px solid #f59e0b; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.35); }
      #${MENU_ID} button { width: 100%; border: 0; border-radius: 6px; padding: 10px 12px; text-align: left; font-size: 14px; font-weight: 800; color: #fff; background: #1f2937; cursor: pointer; }
      #${MENU_ID} button:hover, #${MENU_ID} button:focus { outline: 2px solid #fff; background: #374151; }
      #${MENU_ID} .aavf-sub { display: block; margin-top: 3px; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #d1d5db; font-size: 11px; font-weight: 400; }
      #${PANEL_ID} { position: fixed; z-index: 2147483646; width: min(540px, calc(100vw - 24px)); max-height: min(70vh, 580px); overflow: auto; padding: 14px; background: #fff; color: #111827; border: 2px solid #111827; border-radius: 10px; box-shadow: 0 12px 34px rgba(0,0,0,.35); }
      #${PANEL_ID} * { box-sizing: border-box; }
      #${PANEL_ID} .aavf-head { display: flex; gap: 10px; align-items: flex-start; justify-content: space-between; margin-bottom: 8px; }
      #${PANEL_ID} .aavf-title { font-size: 16px; font-weight: 800; }
      #${PANEL_ID} .aavf-meta { margin-top: 3px; color: #4b5563; font-size: 12px; }
      #${PANEL_ID} .aavf-close { width: 30px; height: 30px; border: 1px solid #9ca3af; border-radius: 6px; background: #f3f4f6; color: #111827; cursor: pointer; font-size: 18px; }
      #${PANEL_ID} .aavf-note { margin: 8px 0 10px; padding: 8px 10px; border-left: 4px solid #2563eb; background: #eff6ff; color: #1e3a8a; font-size: 12px; }
      #${PANEL_ID} .aavf-empty { padding: 12px; border: 1px solid #d1d5db; border-radius: 7px; background: #f3f4f6; font-size: 13px; }
      #${PANEL_ID} .aavf-row { display: grid; grid-template-columns: minmax(112px, auto) 1fr auto; gap: 10px; align-items: center; padding: 9px 0; border-top: 1px solid #e5e7eb; }
      #${PANEL_ID} .aavf-asin { font-family: Consolas, 'Courier New', monospace; font-size: 15px; font-weight: 800; }
      #${PANEL_ID} .aavf-dims { min-width: 0; color: #374151; font-size: 12px; line-height: 1.35; }
      #${PANEL_ID} .aavf-badges { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 3px; }
      #${PANEL_ID} .aavf-badge { display: inline-block; padding: 1px 6px; border: 1px solid #111827; border-radius: 999px; background: #fff7ed; color: #7c2d12; font-size: 10px; font-weight: 800; }
      #${PANEL_ID} .aavf-badge.direct { background: #ecfeff; color: #164e63; }
      #${PANEL_ID} .aavf-copy { border: 1px solid #111827; border-radius: 6px; padding: 7px 10px; background: #111827; color: #fff; cursor: pointer; font-weight: 800; }
      #${PANEL_ID} .aavf-footer { margin-top: 10px; color: #6b7280; font-size: 10px; }
      #${TOAST_ID} { position: fixed; z-index: 2147483647; left: 50%; bottom: 24px; transform: translateX(-50%); padding: 10px 14px; border: 2px solid #f59e0b; border-radius: 8px; background: #111827; color: #fff; font-size: 13px; font-weight: 800; }
      @media (max-width: 560px) {
        #${PANEL_ID} .aavf-row { grid-template-columns: 1fr auto; }
        #${PANEL_ID} .aavf-dims { grid-column: 1 / -1; }
      }
    `;
    document.documentElement.appendChild(style);
  }

  function removeMenu() { document.getElementById(MENU_ID)?.remove(); }
  function removePanel() { document.getElementById(PANEL_ID)?.remove(); }

  function placeFixed(element, x, y, margin = 8) {
    document.body.appendChild(element);
    const rect = element.getBoundingClientRect();
    element.style.left = `${Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin))}px`;
    element.style.top = `${Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin))}px`;
  }

  function toast(message) {
    ensureStyles();
    document.getElementById(TOAST_ID)?.remove();
    const element = document.createElement('div');
    element.id = TOAST_ID;
    element.textContent = message;
    document.body.appendChild(element);
    setTimeout(() => element.remove(), 2200);
  }

  async function copyAsin(asin) {
    try {
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(asin, 'text');
        return true;
      }
    } catch {}
    try {
      await navigator.clipboard.writeText(asin);
      return true;
    } catch {
      return false;
    }
  }

  function formatRow(row) {
    const dimensions = Object.entries(row.dimensions || {})
      .filter(([, value]) => clean(value))
      .map(([key, value]) => `${dimensionTitle(key)}: ${value}`);
    return dimensions.length ? dimensions.join(' · ') : row.display.join(' · ');
  }

  function showResults(context, x, y) {
    removeMenu();
    removePanel();
    ensureStyles();

    const rows = findResults(context);
    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'ASIN variation results');

    const rowsHtml = rows.length
      ? rows.map((row) => `
          <div class="aavf-row">
            <div>
              <div class="aavf-asin">${escapeHtml(row.asin)}</div>
              <div class="aavf-badges">
                ${row.exact ? '<span class="aavf-badge">EXACT</span>' : ''}
                ${row.direct ? '<span class="aavf-badge direct">TILE</span>' : ''}
              </div>
            </div>
            <div class="aavf-dims">${escapeHtml(formatRow(row) || 'Variation details not exposed')}</div>
            <button type="button" class="aavf-copy" data-asin="${escapeHtml(row.asin)}">Copy</button>
          </div>`).join('')
      : '<div class="aavf-empty">Amazon did not expose a child ASIN for this tile in the loaded page.</div>';

    panel.innerHTML = `
      <div class="aavf-head">
        <div>
          <div class="aavf-title">${escapeHtml(`${context.dimensionLabel}: ${context.label || 'variation'}`)}</div>
          <div class="aavf-meta">${rows.length} ASIN${rows.length === 1 ? '' : 's'} found</div>
        </div>
        <button type="button" class="aavf-close" aria-label="Close">×</button>
      </div>
      ${rows.length > 1 ? '<div class="aavf-note">Exact selected combination is shown first when Amazon exposes enough data to prove it.</div>' : ''}
      ${rowsHtml}
      <div class="aavf-footer">Amazon AU ASIN Variation Finder v${VERSION} · reads the loaded product page only.</div>
    `;

    panel.querySelector('.aavf-close')?.addEventListener('click', removePanel);
    for (const button of panel.querySelectorAll('.aavf-copy')) {
      button.addEventListener('click', async () => {
        const asin = button.getAttribute('data-asin');
        const copied = await copyAsin(asin);
        toast(copied ? `Copied ${asin}` : `ASIN: ${asin}`);
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
      </button>`;
    menu.querySelector('button')?.addEventListener('click', () => showResults(activeContext, x, y));
    placeFixed(menu, x, y);
    menu.querySelector('button')?.focus({ preventScroll: true });
  }

  function onContextMenu(event) {
    if (event.shiftKey) return;
    const context = makeContext(event.target);
    if (!context) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showMenu(context, event.clientX, event.clientY);
  }

  window.addEventListener('contextmenu', onContextMenu, true);

  document.addEventListener('pointerdown', (event) => {
    const menu = document.getElementById(MENU_ID);
    if (menu && !menu.contains(event.target)) removeMenu();
    const panel = document.getElementById(PANEL_ID);
    if (panel && !panel.contains(event.target) && !isInsideTwister(event.target)) removePanel();
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    removeMenu();
    removePanel();
  }, true);
})();
