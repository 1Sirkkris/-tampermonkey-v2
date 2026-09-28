// ==UserScript==
// @name         MAIN Screenshot Mode
// @name:en      MAIN Screenshot Mode
// @namespace    https://github.com/1Sirkkris/-tampermonkey-v2
// @version      0.2.2
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
// @require      https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/BWU2_Fleet_Core.lib.js
// ==/UserScript==

(() => {
  'use strict';

  if (window.top !== window.self) return;

  const VERSION = '0.2.2';
  const MODE_ATTR = 'data-bwu2-screenshot-mode';
  const UI_MARKER = 'data-bwu2-ui';
  const STYLE_ID = 'bwu2-screenshot-mode-style';

  const { registerRuntimeVersion } = globalThis.BWU2Fleet;
  // New UI uses one shared marker. The compact legacy groups keep older
  // fleet scripts hidden until they naturally migrate to data-bwu2-ui.
  const UI_SELECTORS = [
    `[${UI_MARKER}]`,
    '#bwu2-runtime-version-stamp',
    ':is([id^="fcrm-"],[id^="fcratc-"],[id^="vm-"],[id^="pLevel"],[id^="p-level-"],[id^="sh-"],[id^="aftm-"],[id^="fnsku-direct-"],[id^="moveapp-"],[id^="bwu2-"],[id^="aavf-"],[id^="aft-super-"],[id^="aft-ui-state-logger-"])',
    ':is([data-fcr-master-ui],[data-fcr-tool-ui="1"],.vm-drop-inline,.sh-panel,.aftm,.sim-md-toolbar,.sim-image-actions,#toolbox,.bwu2-river-capture-indicator)',
    ':is(.fcrlite-native-tools,.fcrlite-native-info,.fcrlite-history-tools,.fcrlite-inventory-search,.fcrlite-inventory-summary,.fcrlite-inventory-sticky-shell,.fcrlite-id-map,.fcrlite-thumb-head,.fcrlite-qty-head,.fcrlite-thumb-cell,.fcrlite-asin-total)'
  ];

  const SCRIPT_STYLE_ID_RE = /^(?:fcrm-|fcratc-|vm-|pLevel|p-level-|sim-md-|aftm-|bwu2-|aavf-|aft-super-|moveapp-|fnsku-direct-|sh-)/;
  const SCRIPT_STYLE_TEXT_RE = /(?:data-bwu2-ui|#(?:fcrm-|fcratc-|vm-|pLevel|p-level-|sh-|aftm-|fnsku-direct-|moveapp-|bwu2-|aavf-|aft-super-)|\.(?:sh-panel|aftm|sim-md-toolbar|vm-drop-inline|fcrlite-)|#body\s*>\s*#toolbox|fcrm-prop-true)/;

  const disabledStyleState = new Map();

  function isScriptStyle(node) {
    if (!(node instanceof HTMLStyleElement) || node.id === STYLE_ID) return false;
    if (SCRIPT_STYLE_ID_RE.test(node.id || '')) return true;
    return SCRIPT_STYLE_TEXT_RE.test(String(node.textContent || ''));
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

  let observer = null;
  let styleRefreshQueued = false;

  function queueScriptStyleRefresh() {
    if (styleRefreshQueued) return;
    styleRefreshQueued = true;
    requestAnimationFrame(() => {
      styleRefreshQueued = false;
      if (document.documentElement.getAttribute(MODE_ATTR) !== '1') return;
      disableScriptStyles();
    });
  }

  function setScreenshotMode(enabled) {
    installCss();
    if (enabled) {
      document.documentElement.setAttribute(MODE_ATTR, '1');
      disableScriptStyles();
      if (!observer) observer = new MutationObserver(queueScriptStyleRefresh);
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
