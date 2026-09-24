// ==UserScript==
// @name         MAIN Screenshot Mode
// @name:en      MAIN Screenshot Mode
// @namespace    https://github.com/1Sirkkris/-tampermonkey-v2
// @version      0.1.4
// @description  Ctrl+Q hides/shows visible UI added by the BWU2 userscript fleet for clean screenshots.
// @author       Kris + ChatGPT
// @include      /^https?:\/\/aft-poirot-website-nrt\.nrt\.proxy\.amazon\.com\//
// @include      *://aft-qt-*.corp.amazon.com/*
// @include      /^https?:\/\/aft-moveapp-[^\/.]+(?:\.nrt)?\.proxy\.amazon\.com\//
// @include      /^https?:\/\/(?:[^\/]*fcresearch[^\/]*|qifcr\.fe\.aftx\.amazonoperations\.app)\//
// @include      /^https?:\/\/t\.corp\.amazon\.com\//
// @include      /^https?:\/\/aftcartonpreditorapp-tcp-nrt\.nrt\.proxy\.amazon\.com\//
// @include      /^https?:\/\/fba-fnsku-commingling-console-(?:eu|na|jp)\.aka\.amazon\.com\//
// @include      /^https?:\/\/river\.amazon\.com\//
// @include      /^https?:\/\/tx-b-hierarchy-nrt\.nrt\.proxy\.amazon\.com\//
// @include      /^https?:\/\/jp\.item-measurement\.aft\.a2z\.com\//
// @include      /^https?:\/\/fcmenu-(?:iad|nrt)-regionalized\.corp\.amazon\.com\//
// @match        https://aft-poirot-website-nrt.nrt.proxy.amazon.com/*
// @match        https://fcmenu-iad-regionalized.corp.amazon.com/*
// @match        http://fcmenu-iad-regionalized.corp.amazon.com/*
// @match        https://fcmenu-nrt-regionalized.corp.amazon.com/*
// @match        http://fcmenu-nrt-regionalized.corp.amazon.com/*
// @match        https://fba-fnsku-commingling-console-eu.aka.amazon.com/tool/fnsku-mappings-tool*
// @match        https://fba-fnsku-commingling-console-na.aka.amazon.com/tool/fnsku-mappings-tool*
// @match        https://fba-fnsku-commingling-console-jp.aka.amazon.com/tool/fnsku-mappings-tool*
// @match        https://fcresearch-fe.aka.amazon.com/*
// @match        https://qi-fcresearch-fe.corp.amazon.com/*
// @match        https://qi-fcresearch-jp.corp.amazon.com/*
// @match        https://qifcr.fe.aftx.amazonoperations.app/*
// @match        https://t.corp.amazon.com/*
// @match        https://river.amazon.com/*
// @match        https://tx-b-hierarchy-nrt.nrt.proxy.amazon.com/*
// @match        https://jp.item-measurement.aft.a2z.com/*
// @match        https://aftcartonpreditorapp-tcp-nrt.nrt.proxy.amazon.com/*
// @match        https://www.amazon.com.au/*
// @match        https://amazon.com.au/*
// @run-at       document-start
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Screenshot_Mode.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Screenshot_Mode.user.js
// ==/UserScript==

(() => {
  'use strict';

  if (window.top !== window.self) return;

  const VERSION = '0.1.4';
  const MODE_ATTR = 'data-bwu2-screenshot-mode';
  const LEGACY_ATTR = 'data-bwu2-screenshot-owned';
  const STYLE_ID = 'bwu2-screenshot-mode-style';

  function registerRuntimeVersion(label, version) {
    const mount = () => {
      const root = document.body || document.documentElement; if (!root) return;
      let host = document.getElementById('bwu2-runtime-version-stamp');
      if (!host) {
        host = document.createElement('div'); host.id = 'bwu2-runtime-version-stamp'; host.setAttribute('aria-hidden', 'true');
        host.style.cssText = 'position:fixed;left:50%;bottom:2px;transform:translateX(-50%);z-index:2147483000;display:flex;flex-wrap:wrap;justify-content:center;gap:2px 10px;max-width:94vw;padding:2px 7px;border-radius:6px 6px 0 0;background:rgba(255,255,255,.34);color:rgba(15,23,42,.52);box-shadow:0 0 0 1px rgba(15,23,42,.05);backdrop-filter:blur(1.5px);font:800 11px/1.25 Arial,sans-serif;letter-spacing:.2px;pointer-events:none;user-select:none;text-shadow:0 1px 1px rgba(255,255,255,.95),0 0 3px rgba(255,255,255,.75)'; root.appendChild(host);
      }
      let item = [...host.children].find(node => node.dataset?.bwu2RuntimeKey === label);
      if (!item) { item = document.createElement('span'); item.dataset.bwu2RuntimeKey = label; host.appendChild(item); }
      item.textContent = `${label} · v${version}`;
      [...host.children].sort((a,b) => String(a.dataset?.bwu2RuntimeKey || '').localeCompare(String(b.dataset?.bwu2RuntimeKey || ''))).forEach(node => host.appendChild(node));
    };
    mount();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once:true });
  }

  const UI_SELECTORS = [
    '#bwu2-runtime-version-stamp',
    `[${LEGACY_ATTR}]`,

    // Prefix catch-alls for script-owned UI ids. This is intentionally broader
    // than the individual selectors below so new panels/toasts from the same
    // fleet stay invisible without needing another screenshot-mode update.
    '[id^="fcrm-"]',
    '[id^="fcratc-"]',
    '[id^="vm-"]',
    '[id^="pLevel"]',
    '[id^="p-level-"]',
    '[id^="sh-"]',
    '[id^="aftm-"]',
    '[id^="fnsku-direct-"]',
    '[id^="moveapp-"]',
    '[id^="bwu2-"]',
    '[id^="aavf-"]',
    '[id^="aft-super-"]',
    '[id^="aft-ui-state-logger-"]',

    // FCResearch Master / FC-Lite / helpers.
    '[data-fcr-master-ui]',
    '[data-fcr-tool-ui="1"]',
    '#fcratc-root',
    '#fcratc-hover-card',
    '#vm-safe-gear',
    '#vm-safe-settings',
    '#vm-safe-toast',
    '#vm-safe-hover',
    '.vm-drop-inline',
    '#vm-fcsku-conflict-summary',
    '#vm-suspicious-dims-summary',
    '#p-level-overlay-start-btn',
    '#pLevelOverlay',

    // Sideline / AFT Edit-SKU-Move.
    '.sh-panel',
    '#sh-dock',
    '#sh-move-corner',
    '#sh-scrub-warning',
    '#sh-invalid-toast',
    '#sh-damage-alert',
    '#sh-lazy-running-indicator',
    '#sh-og-expiry',
    '.aftm',

    // FNSKU mapping / MoveContainer / Observability.
    '#fnsku-direct-wrap',
    '#moveapp-dz-selector',
    '#bwu2-observability-inline',

    // SIM ticket helper.
    '.sim-md-toolbar',
    '.sim-image-actions',

    // Calm Code / Unbind / RIVER.
    '#toolbox',
    '#bwu2-unbind-queue',
    'button[aria-label="Open Unbind Queue"]',
    '#bwu2-river-assistant',
    '.bwu2-river-capture-indicator',

    // Amazon AU variation helper.
    '#aavf-context-menu',
    '#aavf-panel',
    '#aavf-toast',

    // Temporary diagnostics still present in the repo.
    '#aft-super-test',
    '#aft-ui-state-logger-panel',

    // FC-Lite can enhance native FCResearch DOM outside #fcratc-root.
    // These are elements FC-Lite itself creates; native rows/tables that merely
    // receive an fcrlite-* class are left in place and lose their script CSS below.
    '.fcrlite-native-tools',
    '.fcrlite-native-info',
    '.fcrlite-history-tools',
    '.fcrlite-inventory-search',
    '.fcrlite-inventory-summary',
    '.fcrlite-inventory-sticky-shell',
    '.fcrlite-id-map',
    '.fcrlite-thumb-head',
    '.fcrlite-qty-head',
    '.fcrlite-thumb-cell',
    '.fcrlite-asin-total'
  ];

  const SCRIPT_STYLE_IDS = new Set([
    'fcrm-clean-style',
    'fcrm-section-load-visibility',
    'vm-safe-trim-css',
    'fcratc-style',
    'p-level-overlay-style',
    'sim-md-style',
    'aftm-style',
    'bwu2-observability-style',
    'aavf-styles',
    'aft-super-test-style'
  ]);

  const SCRIPT_STYLE_SIGNATURES = [
    '#fnsku-direct-wrap',
    '.sh-panel',
    '#body > #toolbox',
    '#bwu2-river-assistant',
    'fcrm-prop-true',
    '#fcratc-root',
    '#vm-safe-gear',
    '#pLevelOverlay',
    '.sim-md-toolbar',
    '.aftm{',
    '#bwu2-observability-inline',
    '#aavf-context-menu',
    '#aft-super-test'
  ];

  const disabledStyleState = new Map();

  function isScriptStyle(node) {
    if (!(node instanceof HTMLStyleElement) || node.id === STYLE_ID) return false;
    if (SCRIPT_STYLE_IDS.has(node.id)) return true;
    const text = String(node.textContent || '');
    return SCRIPT_STYLE_SIGNATURES.some(signature => text.includes(signature));
  }

  function disableScriptStyle(node) {
    if (!isScriptStyle(node) || disabledStyleState.has(node)) return;
    disabledStyleState.set(node, {
      hadMedia: node.hasAttribute('media'),
      media: node.getAttribute('media')
    });
    node.setAttribute('media', 'not all');
  }

  function disableScriptStyles(root = document) {
    if (root instanceof HTMLStyleElement) disableScriptStyle(root);
    root.querySelectorAll?.('style').forEach(disableScriptStyle);
  }

  function restoreScriptStyles() {
    for (const [node, state] of disabledStyleState) {
      if (!node?.isConnected) continue;
      if (state.hadMedia) node.setAttribute('media', state.media ?? '');
      else node.removeAttribute('media');
    }
    disabledStyleState.clear();
  }

  function installCss() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    const prefix = `html[${MODE_ATTR}="1"]`;
    style.textContent = UI_SELECTORS
      .map(selector => `${prefix} ${selector}`)
      .join(',\n') + ' { display:none !important; visibility:hidden !important; }\n' +
      `${prefix} #body > .login { width:auto !important; max-width:none !important; }\n` +
      `${prefix} #body { display:block !important; }`;
    (document.head || document.documentElement).appendChild(style);
  }

  function markLegacyUi() {
    const body = document.body;
    if (!body) return;

    // Carton PrEditor toggle predates the shared UI marker and has no id/class.
    for (const span of body.querySelectorAll('span')) {
      if (!String(span.textContent || '').startsWith('AutoComplete:')) continue;
      const box = span.parentElement;
      if (!(box instanceof HTMLElement)) continue;
      if (box.style.position !== 'fixed') continue;
      box.setAttribute(LEGACY_ATTR, 'carton-preditor');
    }

    // SIM snippet editor/manager backdrops also predate a stable UI id/class.
    for (const box of body.children) {
      if (!(box instanceof HTMLElement) || box.hasAttribute(LEGACY_ATTR)) continue;
      if (box.style.position !== 'fixed') continue;
      const text = String(box.textContent || '');
      const snippetUi = /(?:Add|Edit|Manage) Snippet/i.test(text)
        && Boolean(box.querySelector('#save, #cancel, #close, [data-e], [data-d]'));
      if (snippetUi) box.setAttribute(LEGACY_ATTR, 'sim-snippets');
    }
  }

  let observer = null;
  let markQueued = false;

  function queueLegacyMark() {
    if (markQueued) return;
    markQueued = true;
    requestAnimationFrame(() => {
      markQueued = false;
      if (document.documentElement.getAttribute(MODE_ATTR) !== '1') return;
      markLegacyUi();
      disableScriptStyles();
    });
  }

  function setScreenshotMode(enabled) {
    installCss();
    if (enabled) {
      document.documentElement.setAttribute(MODE_ATTR, '1');
      markLegacyUi();
      disableScriptStyles();
      if (!observer) observer = new MutationObserver(queueLegacyMark);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      window.dispatchEvent(new CustomEvent('bwu2:screenshot-mode', { detail: { enabled: true } }));
      return;
    }

    document.documentElement.removeAttribute(MODE_ATTR);
    observer?.disconnect();
    restoreScriptStyles();
    window.dispatchEvent(new CustomEvent('bwu2:screenshot-mode', { detail: { enabled: false } }));
  }

  function toggleScreenshotMode() {
    setScreenshotMode(document.documentElement.getAttribute(MODE_ATTR) !== '1');
  }

  function onKeyDown(event) {
    if (event.key.toLowerCase() !== 'q' || !event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;
    if (event.repeat) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    toggleScreenshotMode();
  }

  installCss();
  registerRuntimeVersion('SHOT', VERSION);
  document.addEventListener('keydown', onKeyDown, true);
})();
