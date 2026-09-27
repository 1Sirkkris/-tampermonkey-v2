// ==UserScript==
// @name         Sideline REBUILD TEST v0.0.4
// @namespace    https://github.com/1Sirkkris
// @version      0.0.4
// @description  CLEAN REBUILD TEST: Tote Queue + Lazy Sideline + QTY quick select. Live/Scrub removed.
// @match        https://aft-poirot-website-nrt.nrt.proxy.amazon.com/*
// @match        https://fcresearch-fe.aka.amazon.com/*
// @match        https://qi-fcresearch-fe.corp.amazon.com/*
// @match        https://qi-fcresearch-jp.corp.amazon.com/*
// @match        https://qifcr.fe.aftx.amazonoperations.app/*
// @run-at       document-end
// @grant        none
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Sideline_REBUILD_TEST.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Sideline_REBUILD_TEST.user.js
// ==/UserScript==

(() => {
  'use strict';
  if (window.__sidelineRebuildTest_v004) return;
  window.__sidelineRebuildTest_v004 = true;

  const VERSION = '0.0.4-REBUILD';
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
      let item = Array.from(host.children).find(node => node.dataset?.bwu2RuntimeKey === label);
      if (!item) { item = document.createElement('span'); item.dataset.bwu2RuntimeKey = label; host.appendChild(item); }
      item.textContent = `${label} · v${version}`;
      Array.from(host.children).sort((a,b) => String(a.dataset?.bwu2RuntimeKey || '').localeCompare(String(b.dataset?.bwu2RuntimeKey || ''))).forEach(node => host.appendChild(node));
    };
    mount();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once:true });
  }
  registerRuntimeVersion('SIDELINE-REBUILD', VERSION);

  const SIDELINE_ORIGIN = 'https://aft-poirot-website-nrt.nrt.proxy.amazon.com';
  const IS_SIDELINE_HOST = location.origin === SIDELINE_ORIGIN;
  const IS_WORKER_FRAME = IS_SIDELINE_HOST && location.hash.includes('sideline-rebuild-worker');

  if (!IS_SIDELINE_HOST) {
    bootConsoleBridge();
    return;
  }

  if (IS_WORKER_FRAME) {
    document.documentElement.dataset.sidelineRebuildWorker = '1';
  }

  const TOOL = 'V3';
  const START_TRIGGER = '123START';
  const LOOKUP_CONCURRENCY = 5;
  const PANEL_STATE_KEY = 'sidelineRebuild.panelStates.v1';
  const LAZY_DELAY_KEY = 'sidelineRebuild.lazyDelay.v1';
  const LAZY_DELAY_MIN_MS = 2000;
  const LAZY_DELAY_MAX_MS = 8000;
  const CLEAR_SOURCE_KEY = 'sidelineApiLazy.clearSource';
  const API_SCAN_SOURCE = '/api/scan-source-container';
  const API_CLOSE_CONTAINER = '/api/close-container';
  const API_SCAN_ITEM = '/api/scanitem';
  const API_MOVE_ITEMS = '/api/move-items';

  const itemQty = item => Math.max(1, Number(item?.qty) || 1);
  const sumQty = items => items.reduce((sum, item) => sum + itemQty(item), 0);

  const $ = (s, r = document) => { try { return r.querySelector(s); } catch { return null; } };
  const $$ = (s, r = document) => { try { return [...r.querySelectorAll(s)]; } catch { return []; } };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const norm = v => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const clean = v => String(v ?? '').trim();
  const esc = v => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function setTextIfChanged(el, value) {
    const text = String(value);
    if (el.textContent !== text) el.textContent = text;
  }

  function makeAbortError(message='Run cancelled') {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
  }

  function cancelRun(state) {
    const run = state.activeRun;
    state.activeRun = null;
    if (run?.controller && !run.controller.signal.aborted) run.controller.abort();
  }

  function beginRun(state) {
    cancelRun(state);
    const run = { id:++state.runSeq, controller:new AbortController() };
    state.activeRun = run;
    return run;
  }

  function currentRun(state, run=state.activeRun) {
    return !!run && state.activeRun === run && !run.controller.signal.aborted;
  }

  function finishRun(state, run) {
    if (state.activeRun === run) state.activeRun = null;
  }

  async function postJson(path, body, state, run=state.activeRun, cancelMessage='Run cancelled') {
    if (!currentRun(state, run)) throw makeAbortError(cancelMessage);

    const response = await fetch(path, {
      method:'POST',
      credentials:'same-origin',
      headers:{'content-type':'application/json'},
      body:JSON.stringify(body),
      signal:run.controller.signal
    });

    if (!currentRun(state, run)) throw makeAbortError(cancelMessage);
    const raw = await response.text();
    if (!currentRun(state, run)) throw makeAbortError(cancelMessage);

    let payload = raw;
    try { payload = raw ? JSON.parse(raw) : null; } catch {}

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  const helperSelector = '#sh-dock,#sh-queue,#sh-qty,#sh-lazy,#sh-og-expiry,#sh-invalid-toast,#sh-lazy-running-indicator,#sh-move-corner';
  const shared = { owner:'', queueBusy:false, expiryBusy:false };
  let returnSourceBusy = false;
  let expiryRequestSeq = 0;
  let nativeExpirySuppressedUntil = 0;

  // Native
  function visible(el) {
    if (!(el instanceof Element) || !el.isConnected || el.hidden) return false;
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' && r.width > 0 && r.height > 0;
  }

  function enabled(el) {
    return visible(el) && !el.disabled && !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true';
  }

  function appElements(selector) {
    return $$(selector).filter(el => !el.closest(helperSelector));
  }

  let screenDirty = true, screenCache = 'UNKNOWN';

  function nativePageText() {
    const parts = [];

    for (const child of document.body?.children || []) {
      if (child.matches?.(helperSelector)) continue;
      parts.push(child.innerText || child.textContent || '');
    }

    return norm(parts.join(' '));
  }

  function detectScreen() {
    const t = nativePageText();
    if (t.includes('enter quantity')) return 'QTY';
    if (t.includes('verify item')) return 'VERIFY';
    if (t.includes('scan destination container')) return 'DEST';
    if (t.includes('scan source container')) return 'SOURCE';
    if (t.includes('scan item')) return 'ITEM';
    if (t.includes('expiration date') || t.includes('expiry date')) return 'EXPIRY';
    if (t.includes('predicant')) return 'PREDICANT';
    if (t.includes('successfully')) return 'SUCCESS';
    return 'UNKNOWN';
  }

  function screen() {
    if (screenDirty) {
      screenCache = detectScreen();
      screenDirty = false;
    }
    return screenCache;
  }

  function scanInput() {
    const direct = $('#scan-text-input');
    if (enabled(direct) && !direct.closest(helperSelector)) return direct;
    return appElements('input,textarea,[role="textbox"],[contenteditable="true"]').find(el => {
      if (!enabled(el)) return false;
      const type = norm(el.type);
      return !type || ['text','search','tel','number'].includes(type) || el.tagName === 'TEXTAREA' || el.isContentEditable;
    }) || null;
  }

  function buttonByText(re) {
    return appElements('button,[role="button"],a,alchemy-button,mdw-button,input[type="button"],input[type="submit"]')
      .find(el => enabled(el) && re.test(norm(el.innerText || el.textContent || el.value || ''))) || null;
  }

  function confirmButton() {
    const direct = $('#confirm-button');
    return enabled(direct) && !direct.closest(helperSelector) ? direct : buttonByText(/^(confirm|item match|continue|submit|enter)\b/);
  }

  function changeButton() {
    const direct = $('#change-container-button');
    return enabled(direct) && !direct.closest(helperSelector) ? direct : buttonByText(/change container/);
  }

  function deepRoots(start=document) {
    const roots = [start];
    const stack = [start];

    while (stack.length) {
      const root = stack.pop();
      const elements = root.querySelectorAll?.('*') || [];

      for (const el of elements) {
        if (!el.shadowRoot) continue;
        roots.push(el.shadowRoot);
        stack.push(el.shadowRoot);
      }
    }

    return roots;
  }

  function buttonLabel(el) {
    if (!el) return '';

    const direct = [
      el.innerText,
      el.textContent,
      el.value,
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('title')
    ].filter(Boolean).join(' ');

    const shadow = el.shadowRoot
      ? [
          el.shadowRoot.innerText,
          el.shadowRoot.textContent,
          el.shadowRoot.querySelector?.('button,[role="button"],input')?.innerText,
          el.shadowRoot.querySelector?.('button,[role="button"],input')?.textContent,
          el.shadowRoot.querySelector?.('button,[role="button"],input')?.value
        ].filter(Boolean).join(' ')
      : '';

    return norm(`${direct} ${shadow}`);
  }

  function modalButton(choice) {
    const wanted = norm(choice);
    const selectors = 'button,[role="button"],input[type="button"],input[type="submit"],alchemy-button,mdw-button';

    const matchesChoice = el => {
      if (!enabled(el)) return false;
      const label = buttonLabel(el);

      if (wanted === 'no') {
        return label === 'no' || /^no\b/.test(label);
      }

      if (wanted === 'yes') {
        return (
          ['yes', 'yes close', 'yes, close', 'empty', 'empty container'].includes(label) ||
          /^(yes|empty)\b/.test(label)
        );
      }

      return label === wanted;
    };

    const normalScopes = [
      $('#modal-root'),
      ...$$('[role="dialog"],dialog,.modal,.Dialog,.dialog,.ReactModal__Content,[aria-modal="true"]')
    ].filter(Boolean);

    for (const scope of normalScopes) {
      const hit = $$(selectors, scope).find(matchesChoice);
      if (hit) return hit;

      for (const root of deepRoots(scope)) {
        const deepHit = $$(selectors, root).find(matchesChoice);
        if (deepHit) return deepHit;
      }
    }

    const documentRoots = deepRoots(document);
    for (const root of documentRoots) {
      const dialogs = $$('[role="dialog"],dialog,.modal,.Dialog,.dialog,.ReactModal__Content,[aria-modal="true"]', root);

      for (const dialog of dialogs) {
        const hit = $$(selectors, dialog).find(matchesChoice);
        if (hit) return hit;

        for (const dialogRoot of deepRoots(dialog)) {
          const deepHit = $$(selectors, dialogRoot).find(matchesChoice);
          if (deepHit) return deepHit;
        }
      }
    }

    for (const root of documentRoots) {
      const hit = $$(selectors, root)
        .filter(el => !el.closest?.(helperSelector))
        .find(matchesChoice);
      if (hit) return hit;
    }

    return null;
  }

  function setValue(input, value) {
    if (!input) return false;
    if (input.isContentEditable) input.textContent = String(value);
    else {
      const proto = Object.getPrototypeOf(input);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value')
        || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
        || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
      const old = input.value;
      if (desc?.set) desc.set.call(input, String(value));
      else input.value = String(value);
      input._valueTracker?.setValue?.(old);
    }
    input.dispatchEvent(new Event('input', { bubbles:true }));
    input.dispatchEvent(new Event('change', { bubbles:true }));
    screenDirty = true;
    return true;
  }

  function enter(el) {
    for (const type of ['keydown','keypress','keyup']) {
      el?.dispatchEvent(new KeyboardEvent(type, {
        key:'Enter', code:'Enter', keyCode:13, which:13,
        bubbles:true, cancelable:true, composed:true
      }));
    }
    screenDirty = true;
  }

  function click(el) {
    if (!el) return false;
    const target = el.shadowRoot?.querySelector('button,[role="button"],input[type="button"],input[type="submit"]') || el;
    for (const type of ['mouseover','mousedown','mouseup']) {
      target.dispatchEvent(new MouseEvent(type, { bubbles:true, composed:true }));
    }
    target.click();
    screenDirty = true;
    return true;
  }

  async function waitFor(test, timeout=10000, gap=50) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const value = test();
      if (value) return value;
      await sleep(gap);
    }
    return null;
  }

  async function fillAndConfirm(value, expected='', active=()=>true) {
    const input = await waitFor(() => active() && (!expected || screen() === expected) && scanInput(), 12000, 60);
    if (!input || !active()) return false;
    input.focus();
    input.select?.();
    setValue(input, '');
    await sleep(10);
    if (!active()) return false;
    setValue(input, value);
    await sleep(25);
    if (!active()) return false;
    const button = confirmButton();
    enabled(button) ? click(button) : enter(input);
    return active();
  }

  async function closeOpenContainer(choice='yes', active=()=>true) {
    const change = await waitFor(() => active() && changeButton(), 12000, 35);
    if (!change || !active()) return 'cancelled';
    click(change);
    const answer = await waitFor(() => active() && modalButton(choice), 3500, 25);
    if (!answer || !active()) return 'cancelled';
    click(answer);
    if (!active()) return 'cancelled';
    return await waitFor(() => active() && screen() === 'SOURCE' && scanInput(), 12000, 50) ? 'closed' : 'source timeout';
  }

  function backToSourceButton() {
    return buttonByText(/back to source container/);
  }

  function loadedSourceContainer() {
    const text = nativePageText();
    const match = text.match(/source\s+container[\s:]*((?:ts|cs)x[0-9a-z_-]+)/i);
    return match ? match[1] : '';
  }

  async function waitForNativeSourceScan(timeout=12000) {
    return !!await waitFor(() => screen() === 'SOURCE' && scanInput(), timeout, 50);
  }

  async function nativeReturnToOriginalSource(sourceCode) {
    const alreadyBack =
      norm(loadedSourceContainer()) === norm(sourceCode) &&
      screen() === 'ITEM' &&
      !!changeButton();

    if (alreadyBack) return true;

    const back = await waitFor(backToSourceButton, 1800, 40);
    if (!back) return false;

    click(back);

    const ready = await waitFor(() =>
      norm(loadedSourceContainer()) === norm(sourceCode) &&
      screen() === 'ITEM' &&
      !!changeButton(),
      10000,
      50
    );

    if (!ready) return false;
    return true;
  }

  // UI
  const style = document.createElement('style');
  style.textContent = `
html[data-sideline-rebuild-worker="1"] #sh-dock,html[data-sideline-rebuild-worker="1"] .sh-panel,html[data-sideline-rebuild-worker="1"] #sh-move-corner,html[data-sideline-rebuild-worker="1"] #sh-lazy-running-indicator{display:none!important}
#sh-dock{position:fixed;right:14px;bottom:12px;z-index:2147483647;display:grid;grid-template-columns:repeat(3,1fr);gap:5px;width:278px;padding:5px;background:#fff;border:1px solid #c7d0dd;border-radius:5px;box-shadow:0 2px 8px #0003;font:12px Arial,sans-serif}
#sh-dock button,.sh-btn{border:1px solid #aeb8c5;border-radius:4px;padding:7px 6px;font-weight:800;cursor:pointer;background:#f5f7fa;color:#1f2937}.sh-on{background:#146eb4!important;color:#fff!important;border-color:#0f5c99!important}
.sh-panel{position:fixed;right:14px;bottom:56px;z-index:2147483646;width:430px;max-width:calc(100vw - 28px);box-sizing:border-box;padding:8px;background:#fff;border:1px solid #c7d0dd;border-radius:5px;box-shadow:0 2px 8px #0003;font:12px Arial,sans-serif;color:#111827}.sh-title{font-weight:900;margin:-8px -8px 7px;padding:7px 9px;background:#f3f5f8;border-bottom:1px solid #d5dbe3;border-radius:5px 5px 0 0}
.sh-return-source{width:auto;display:block;margin:0 0 6px auto;padding:5px 9px!important;border:1px solid #146eb4!important;background:#eff6ff!important;color:#0f3d73!important;font-weight:900!important;font-size:11px}.sh-return-source:hover{background:#dbeafe!important}.sh-return-source-inline{margin-top:8px;width:100%;border:2px solid #146eb4!important;background:#eff6ff!important;color:#0f3d73!important;font-weight:1000!important}
.sh-grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}.sh-grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}.sh-input{width:100%;box-sizing:border-box;border:1px solid #b8c2cf;border-radius:4px;padding:7px;font:12px Arial,sans-serif}.sh-input.good{border-color:#16a34a}.sh-input.bad{border-color:#dc2626}.sh-area{height:76px;resize:vertical}.sh-status{margin-top:5px;font-weight:700;line-height:1.3}.sh-error{margin-top:3px;color:#b91c1c;font-weight:700}.sh-row{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px}#sh-lazy-settings{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:6px 0}#sh-lazy-settings .sh-btn{min-height:34px;font-size:11px;font-weight:900;letter-spacing:.1px}#sh-lazy-settings .sh-setting-off{background:#f5f7fa!important;color:#475569!important;border-color:#b8c2cf!important}
#sh-qty{left:14px;right:auto;width:306px}.sh-qty-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}.sh-qty-grid button{min-height:42px;font-size:16px}.sh-clear-tote{width:100%;margin-top:8px;background:#fff1f2!important;color:#991b1b!important;border-color:#fecaca!important}.sh-stop{background:#fff7ed!important;color:#9a3412!important;border-color:#fed7aa!important}
.sh-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin:6px 0 3px}.sh-metric{border:1px solid #c7d0dd;background:#f8fafc;padding:6px 3px;text-align:center;font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.15px}.sh-metric b{display:block;font-size:19px;line-height:1.05;margin-top:2px}.sh-notmoved-line{display:none;font-size:11px;color:#475569;text-align:right;margin:2px 1px 7px}.sh-notmoved-line.show{display:block}.sh-notmoved-line b{font-size:13px;color:#991b1b}.sh-lazy-input-summary{display:none;align-items:center;justify-content:space-between;gap:8px;margin:6px 0;padding:8px 10px;border:1px solid #cbd5e1;border-left:5px solid #146eb4;background:#f8fafc;border-radius:4px;font-weight:850;color:#334155}.sh-lazy-input-summary.show{display:flex}.sh-lazy-input-summary.auto{border-left-color:#16a34a;background:#f0fdf4;box-shadow:0 0 0 2px rgba(22,163,74,.10)}.sh-lazy-input-summary button{padding:5px 9px;border:1px solid #94a3b8;border-radius:4px;background:#fff;font-weight:800;cursor:pointer}.sh-lazy-collapsed{display:none!important}.sh-result-summary{display:none;margin:7px 0;border:1px solid #cbd5e1;border-radius:4px;background:#f8fafc;overflow:hidden}.sh-result-summary.show{display:block}.sh-result-ok{padding:8px 9px;background:#eff6ff;color:#0f3d73;font-weight:900}.sh-result-bad{padding:8px 9px;background:#fff7f7;color:#991b1b;font-weight:900;font-size:13px;line-height:1.35;border-top:1px solid #fecaca;border-left:6px solid #dc2626}.sh-result-bad-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}.sh-result-bad-title{font-size:13px;font-weight:1000}.sh-result-bad code{font:900 13px Consolas,monospace;color:#7f1d1d}.sh-failed-actions{display:flex;gap:6px}.sh-failed-actions button{padding:6px 9px;border:1px solid #ef4444;background:#fff;color:#991b1b;border-radius:3px;font-weight:900;cursor:pointer}.sh-failed-list{margin-top:8px;border-top:1px solid #fecaca;padding-top:8px;display:grid;gap:8px}.sh-failed-card{padding:7px 8px;background:#fff;border:1px solid #fecaca;border-left:4px solid #ef4444;border-radius:4px}.sh-failed-top{font:1000 13px/1.2 Consolas,monospace;color:#7f1d1d;margin-bottom:5px}.sh-failed-grid{display:grid;grid-template-columns:auto 1fr;column-gap:7px;row-gap:3px;font-size:12px;line-height:1.25}.sh-failed-grid b{color:#7f1d1d}.sh-predicant-card{display:none;margin:8px 0;padding:10px 12px;border:3px solid #f59e0b;border-left:8px solid #dc2626;border-radius:6px;background:#fff7ed;color:#7c2d12;text-align:center;box-shadow:0 0 0 2px rgba(245,158,11,.12);animation:shPredicantPulse .85s ease-in-out infinite alternate}.sh-predicant-card.show{display:block}.sh-predicant-title{font-size:17px;font-weight:1000;line-height:1.15}.sh-predicant-dest{margin:6px 0 4px;padding:7px 8px;background:#fff;border:2px solid #dc2626;border-radius:4px;font:1000 18px Consolas,monospace;color:#7f1d1d;letter-spacing:.4px}.sh-predicant-help{font-size:12px;font-weight:900;line-height:1.35}.sh-predicant-help strong{font-size:13px}.sh-predicant-scan{outline:4px solid #f59e0b!important;box-shadow:0 0 0 5px rgba(245,158,11,.18)!important}@keyframes shPredicantPulse{from{background:#fff7ed;box-shadow:0 0 0 2px rgba(245,158,11,.10)}to{background:#fef3c7;box-shadow:0 0 0 6px rgba(245,158,11,.22)}}.sh-failure-pill{display:none;margin:6px 0 2px;padding:7px 9px;border:1px solid #ef4444;border-left:5px solid #dc2626;border-radius:4px;background:#fff1f2;color:#991b1b;font-weight:900;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sh-failure-pill.show{display:block}.sh-failure-pill:hover{background:#ffe4e6}.sh-progress{max-height:210px;overflow:auto;border-top:1px solid #d5dbe3;margin-top:8px;padding-top:6px;font-family:Consolas,monospace}.sh-item{padding:6px 7px;border-radius:3px;margin-bottom:3px;border:1px solid transparent}.sh-item.current{background:#fff3bf;border-color:#f59e0b;font-weight:900}.sh-item.moved{background:#eff6ff;color:#0f3d73;border-color:#bfdbfe;font-weight:800}.sh-item.failed{background:#fff1f2;color:#991b1b;border:2px solid #ef4444;border-left-width:6px;font-weight:900}.sh-item.parked{background:#fff7ed;color:#9a3412;border-color:#fed7aa;font-weight:800}.sh-item.retry{background:#fff7ed;color:#9a3412;border:2px solid #f59e0b;border-left-width:6px;font-weight:900}
#sh-lazy-footer{display:none}
#sh-invalid-toast{position:fixed;left:50%;top:88px;transform:translateX(-50%);z-index:2147483647;min-width:280px;max-width:min(520px,calc(100vw - 32px));padding:12px 48px 12px 14px;border:2px solid #ef4444;border-radius:5px;background:#fef2f2;color:#7f1d1d;box-shadow:0 4px 16px #0004;font:13px Arial,sans-serif}#sh-invalid-toast .title{font-weight:900;font-size:15px;margin-bottom:6px}#sh-invalid-toast .close{position:absolute;right:7px;top:7px;width:32px;height:32px;border:1px solid #ef4444;border-radius:4px;background:#fff;color:#991b1b;font-size:22px;font-weight:900;line-height:28px;cursor:pointer}
#sh-damage-alert{position:fixed;inset:0;z-index:2147483647;pointer-events:none;border:10px solid #dc2626;box-sizing:border-box;background:rgba(220,38,38,.08);animation:shDamageFlash .42s steps(2,end) 10}
#sh-damage-alert .sh-damage-box{position:absolute;left:50%;top:72px;transform:translateX(-50%);min-width:520px;max-width:calc(100vw - 40px);padding:16px 22px;text-align:center;background:#7f1d1d;color:#fff;border:5px solid #facc15;border-radius:8px;box-shadow:0 8px 28px #0008;font:900 22px/1.25 Arial,sans-serif;letter-spacing:.3px}
#sh-damage-alert .sh-damage-box small{display:block;margin-top:7px;font-size:14px;letter-spacing:0}
@keyframes shDamageFlash{0%,100%{background:rgba(220,38,38,.08);border-color:#dc2626}50%{background:rgba(250,204,21,.20);border-color:#facc15}}

  0%,100%{border-color:#146eb4!important;box-shadow:0 0 0 3px rgba(20,110,180,.24)}
  50%{border-color:#f59e0b!important;box-shadow:0 0 0 5px rgba(245,158,11,.28)}
}

#sh-lazy-running-indicator{position:fixed;inset:0;z-index:2147483644;pointer-events:none;background:rgba(15,23,42,.09);box-shadow:inset 0 0 0 4px rgba(20,110,180,.34);animation:shLazyPulse 1.2s ease-in-out infinite}
#sh-lazy-running-indicator .sh-lazy-spinner{position:absolute;left:50%;top:46%;width:42px;height:42px;margin:-21px 0 0 -21px;border-radius:50%;border:5px solid rgba(255,255,255,.48);border-top-color:#146eb4;border-right-color:#146eb4;box-shadow:0 2px 10px rgba(0,0,0,.22);animation:shLazySpin .72s linear infinite}
@keyframes shLazySpin{to{transform:rotate(360deg)}}
@keyframes shLazyPulse{0%,100%{box-shadow:inset 0 0 0 4px rgba(20,110,180,.28)}50%{box-shadow:inset 0 0 0 5px rgba(20,110,180,.48)}}
#sh-move-corner{position:fixed;right:416px;bottom:12px;z-index:2147483647;width:68px;height:34px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:6px;border:2px solid #146eb4;border-radius:8px;background:#eff6ff;color:#0f3d73;box-shadow:0 2px 9px #0005;font:900 10px Arial,sans-serif;letter-spacing:.3px;pointer-events:none}
@media(max-width:500px){#sh-move-corner{right:3px;top:3px;bottom:auto}}
#sh-move-corner .sh-move-wheel{width:14px;height:14px;box-sizing:border-box;border:3px solid #bfdbfe;border-top-color:#146eb4;border-right-color:#146eb4;border-radius:50%;animation:shMoveCornerSpin .7s linear infinite}
#sh-move-corner .sh-move-mark{font:1000 18px/1 Arial,sans-serif}
#sh-move-corner.waiting{border-color:#f59e0b;background:#fff7ed;color:#9a3412}
#sh-move-corner.done{border-color:#16a34a;background:#f0fdf4;color:#166534}
#sh-move-corner.check{border-color:#dc2626;background:#fff1f2;color:#991b1b}
@keyframes shMoveCornerSpin{to{transform:rotate(360deg)}}
#sh-og-expiry{position:fixed;inset:0;z-index:2147483647;background:rgba(31,41,55,.35);font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;pointer-events:none}
#sh-og-expiry .og-wrap{position:absolute;left:50%;top:38px;transform:translateX(-50%);width:920px;max-width:calc(100vw - 24px);background:#4b5563;border:7px solid #4b5563;border-radius:14px;box-shadow:0 12px 30px rgba(0,0,0,.38);pointer-events:auto}
#sh-og-expiry .og-id{background:#fff;padding:10px 12px;border-radius:7px 7px 0 0;font-size:16px;font-weight:900;text-align:center;color:#111827}
#sh-og-expiry .og-item-preview{display:grid;grid-template-columns:170px 1fr;gap:18px;align-items:center;background:#fff;margin-top:8px;padding:12px;border-radius:9px;border:2px solid #d7dee8}
#sh-og-expiry .og-item-img{width:170px;height:170px;object-fit:contain;background:#fff;border:1px solid #d7dee8;border-radius:7px}
#sh-og-expiry .og-item-title{font-size:28px;line-height:1.18;font-weight:900;color:#111827;margin-bottom:10px}
#sh-og-expiry .og-item-meta{font-size:15px;line-height:1.4;color:#475569;font-weight:700}#sh-og-expiry .og-meta-row{display:flex;gap:8px;align-items:baseline;margin:2px 0}#sh-og-expiry .og-meta-label{min-width:58px;color:#334155;font-weight:900}#sh-og-expiry .og-scan-code{display:inline-block;margin-top:5px;padding:6px 9px;border:2px solid #146eb4;border-radius:5px;background:#eff6ff;color:#0f3d73;font:900 19px Consolas,monospace;letter-spacing:.2px}
#sh-og-expiry .og-grid-wrap{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;margin-top:7px}
#sh-og-expiry .og-panel{box-sizing:border-box;background:#fff;border:2px solid #f97316;border-radius:11px;padding:9px}
#sh-og-expiry .og-head{display:flex;align-items:center;justify-content:space-between;margin:0 0 8px;font-size:13px;font-weight:900;color:#9a3412}#sh-og-expiry .og-head strong{color:#111827}
#sh-og-expiry .og-grid{display:grid;gap:5px}.og-month{grid-template-columns:repeat(4,minmax(0,1fr))}.og-day{grid-template-columns:repeat(7,minmax(0,1fr))}.og-year{grid-template-columns:repeat(4,minmax(0,1fr))}
#sh-og-expiry button{min-width:0;height:35px;border:1px solid #c7d2fe;border-radius:7px;background:#f5f7ff;color:#1e3a8a;font-size:13px;font-weight:850;cursor:pointer}#sh-og-expiry button:hover:not(:disabled){background:#e0e7ff}#sh-og-expiry button.selected{background:#2563eb;color:#fff;border-color:#1d4ed8}#sh-og-expiry button:disabled{opacity:.35;cursor:not-allowed}
#sh-og-expiry .og-footer{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:7px}.og-footer.og-footer-single{grid-template-columns:1fr}.og-footer button{width:100%;height:48px!important;background:#7c3aed!important;color:#fff!important;border-color:#6d28d9!important;font-size:15px!important}.og-footer .production-confirm{background:#146eb4!important;border-color:#0f5c99!important}.og-footer .og-return-source{background:#eff6ff!important;color:#0f3d73!important;border:2px solid #146eb4!important}

/* v0.0.4 — ISS Console visual alignment; UI only */
#sh-dock{
  width:430px;box-sizing:border-box;padding:6px;
  background:#f2f4f6;border-color:#aab7c6;border-top:0;
  border-radius:0 0 4px 4px;box-shadow:0 3px 9px #0002;
  font:700 11px Arial,sans-serif
}
#sh-dock button,.sh-btn{
  border-color:#9faec0;border-radius:3px;
  font-weight:800;color:#122b49
}
#sh-dock button.sh-on,.sh-on{
  background:#315f7f!important;color:#fff!important;border-color:#315f7f!important
}
.sh-panel{
  width:430px;padding:12px;border-color:#aab7c6;
  border-radius:4px 4px 0 0;box-shadow:0 3px 9px #0002;
  font:11px Arial,sans-serif;color:#122b49
}
.sh-title{
  margin:-12px -12px 11px;padding:9px 11px;
  background:#f1f3f5;border-left:3px solid #7894ad;
  border-bottom:1px solid #c4ced8;border-radius:0;
  color:#0f2d4c
}
.sh-title-brand{display:flex;align-items:center;justify-content:space-between;padding:10px 11px}
.sh-title-brand div{display:flex;flex-direction:column;gap:1px}
.sh-title-brand strong{font-size:22px;line-height:1;color:#0b2c4b;letter-spacing:.5px}
.sh-title-brand span{font-size:10px;font-weight:700;color:#60758c}
.sh-title-brand b{
  padding:5px 10px;border:1px solid #9fb0c0;border-radius:3px;
  background:#fff;color:#173c5d;font-size:10px;letter-spacing:.4px
}
.sh-return-source{
  margin:-2px 0 8px auto;padding:5px 8px!important;
  border:1px solid #315f7f!important;background:#fff!important;
  color:#17466b!important;font-size:10px!important
}
.sh-field-label{
  display:block;margin:7px 0 4px;font-size:10px;font-weight:900;
  color:#385674;letter-spacing:.45px
}
.sh-flow-arrow{text-align:center;color:#7894ad;font-size:18px;line-height:14px;margin:4px 0}
.sh-input{
  border-color:#aab7c6;border-radius:3px;padding:9px;
  background:#fff;color:#1b2e43
}
.sh-input:focus{outline:2px solid rgba(49,95,127,.16);border-color:#315f7f}
#sh-lazy .sh-area{height:106px}
#sh-lazy-settings{margin:9px 0 7px}
#sh-lazy-settings .sh-btn{min-height:34px}
.sh-grid4{grid-template-columns:1.45fr .9fr .9fr .9fr}
.sh-metric{
  border-color:#b8c5d2;background:#f5f7f9;
  color:#28445f
}
.sh-metric b{color:#0e2f4f}
#sh-lazy>.sh-status{
  margin-top:7px;padding:7px 9px;border:1px solid #9eb8cd;
  background:#eef8ff;color:#153d5f
}
#sh-qty{width:300px}
#sh-qty .sh-qty-grid{gap:5px}
#sh-qty .sh-qty-grid button{min-height:38px;font-size:14px}
#sh-queue .sh-area{height:66px}
`;
  document.documentElement.appendChild(style);

  const moveCorner = { mode:'', state:'idle', holdUntil:0, timer:0 };

  function renderMoveCorner() {
    let root = $('#sh-move-corner');

    if (moveCorner.state === 'idle') {
      root?.remove();
      return;
    }

    if (!root) {
      root = document.createElement('div');
      root.id = 'sh-move-corner';
      document.body.appendChild(root);
    }

    root.className = moveCorner.state;
    if (moveCorner.state === 'active') {
      root.innerHTML = `<span class="sh-move-wheel"></span><b>${moveCorner.mode.toUpperCase()}</b>`;
      return;
    }

    const mark = moveCorner.state === 'waiting' ? '!' : moveCorner.state === 'done' ? '✓' : '×';
    const label = moveCorner.state === 'waiting'
      ? moveCorner.mode.toUpperCase()
      : moveCorner.state === 'done' ? 'DONE' : 'CHECK';
    root.innerHTML = `<span class="sh-move-mark">${mark}</span><b>${label}</b>`;
  }

  function setMoveCorner(mode, state) {
    const now = Date.now();
    if (state === 'idle' && moveCorner.mode && moveCorner.mode !== mode && moveCorner.state !== 'idle') {
      return;
    }
    if (
      state === 'idle' &&
      moveCorner.mode === mode &&
      (moveCorner.state === 'done' || moveCorner.state === 'check') &&
      moveCorner.holdUntil > now
    ) return;

    if (state === 'active' || state === 'waiting') {
      moveCorner.holdUntil = 0;
      if (moveCorner.timer) clearTimeout(moveCorner.timer);
      moveCorner.timer = 0;
    }

    moveCorner.mode = mode;
    moveCorner.state = state;
    renderMoveCorner();
  }

  function finishMoveCorner(mode, ok=true) {
    if (moveCorner.timer) clearTimeout(moveCorner.timer);
    moveCorner.mode = mode;
    moveCorner.state = ok ? 'done' : 'check';
    moveCorner.holdUntil = Date.now() + 5000;
    renderMoveCorner();
    moveCorner.timer = setTimeout(() => {
      if (moveCorner.mode !== mode || moveCorner.holdUntil > Date.now()) return;
      moveCorner.timer = 0;
      moveCorner.state = 'idle';
      renderMoveCorner();
    }, 5050);
  }

  function clearMoveCorner(mode) {
    if (moveCorner.mode !== mode) return;
    if (moveCorner.timer) clearTimeout(moveCorner.timer);
    moveCorner.timer = 0;
    moveCorner.mode = '';
    moveCorner.state = 'idle';
    moveCorner.holdUntil = 0;
    renderMoveCorner();
  }

  const feature = { queue:false, qty:false, lazy:false };
  const panels = {};
  const dockButtons = [];

  function panel(id, title, key) {
    const root = document.createElement('div');
    root.id = id;
    root.className = 'sh-panel';
    const returnSource = key === 'lazy'
      ? '<button type="button" class="sh-btn sh-return-source" data-return-source>↩ Return to Source</button>'
      : '';
    const header = key === 'lazy'
      ? '<div class="sh-title sh-title-brand"><div><strong>SIDELINE</strong><span>Container workflow</span></div><b>LAZY</b></div>'
      : `<div class="sh-title">${title}</div>`;
    root.innerHTML = header + returnSource;
    root.style.display = 'none';
    document.body.appendChild(root);
    panels[key] = root;
    return root;
  }

  function savePanelStates() {
    try { localStorage.setItem(PANEL_STATE_KEY, JSON.stringify(feature)); } catch {}
  }

  function restorePanelStates() {
    try {
      const saved = JSON.parse(localStorage.getItem(PANEL_STATE_KEY) || '{}');
      for (const key of ['queue','lazy','qty']) feature[key] = saved[key] === true;
    } catch {}
  }

  function mountDock() {
    if ($('#sh-dock')) return;
    restorePanelStates();
    const dock = document.createElement('div');
    dock.id = 'sh-dock';
    for (const [key,label] of [['queue','QUEUE'],['lazy','LAZY'],['qty','QTY']]) {
      const b = document.createElement('button');
      b.textContent = label;
      b.dataset.key = key;
      b.onclick = () => {
        feature[key] = !feature[key];
        savePanelStates();
        applyPanels();
      };
      dockButtons.push(b);
      dock.appendChild(b);
    }
    document.body.appendChild(dock);
  }

  function applyPanels() {
    for (const b of dockButtons) b.classList.toggle('sh-on', feature[b.dataset.key]);
    for (const [key,p] of Object.entries(panels)) {
      const display = feature[key] ? 'block' : 'none';
      if (p.style.display !== display) p.style.display = display;
    }
    let bottom = 58;
    for (const key of ['lazy','queue']) {
      const p = panels[key];
      if (!p || !feature[key]) continue;
      const position = `${bottom}px`;
      if (p.style.bottom !== position) p.style.bottom = position;
      bottom += Math.max(80, p.offsetHeight) + 10;
    }
  }

  let panelLayoutRaf = 0;
  function requestPanelLayout() {
    if (panelLayoutRaf) return;
    panelLayoutRaf = requestAnimationFrame(() => {
      panelLayoutRaf = 0;
      applyPanels();
    });
  }

  const q = { running:false, paused:false, index:0, list:[], failed:[], runSeq:0 };
  const queuePanel = panel('sh-queue', `Tote Queue v${VERSION}`, 'queue');
  queuePanel.insertAdjacentHTML('beforeend',
    '<textarea class="sh-input sh-area" placeholder="Paste tsX/csX list"></textarea>' +
    '<div class="sh-grid3"><button class="sh-btn sh-on" data-a="start">Start</button><button class="sh-btn" data-a="pause">Pause</button><button class="sh-btn sh-stop" data-a="stop">Stop</button></div>' +
    '<div class="sh-status"></div><div class="sh-error"></div>'
  );

  const qText = $('textarea', queuePanel), qStatus = $('.sh-status', queuePanel), qError = $('.sh-error', queuePanel);

  function parseContainers(text) {
    const seen = new Set();
    return (String(text).match(/\b(?:tsX|csX)[A-Za-z0-9_-]+\b/gi) || []).filter(v => {
      const k = v.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function renderQueue(note='') {
    const cur = q.list[q.index] || '—';
    setTextIfChanged(qStatus, `${q.running ? (q.paused ? 'PAUSED' : 'RUNNING') : 'STOPPED'} | ${Math.min(q.index,q.list.length)}/${q.list.length} | Current: ${cur}${note ? ' | '+note : ''}`);
    setTextIfChanged(qError, q.failed.length ? `Errors: ${q.failed.join(', ')}` : '');
  }

  async function queuePump(run=q.runSeq) {
    const active = () => run === q.runSeq && q.running;
    if (!active() || q.paused || shared.queueBusy) return;
    if (q.index >= q.list.length) {
      q.running = false;
      if (shared.owner === 'queue') shared.owner = '';
      renderQueue('done');
      return;
    }

    shared.queueBusy = true;
    shared.owner = 'queue';
    const code = q.list[q.index];

    try {
      renderQueue('validating by API');
      try {
        await scanSourceDirect(code);
      } catch (error) {
        if (!active()) return;
        if (error?.customerBound) {
          q.index++;
          renderQueue('customer-bound — skipped');
          return;
        }
        throw error;
      }

      if (!active()) return;
      renderQueue('emptying by API');
      await closeContainerDirect(code, true);
      if (!active()) return;

      q.index++;
      renderQueue('cleared');
    } catch (error) {
      if (!active()) return;

      if (error?.outcomeUnknown) {
        q.failed.push(`${code} (CLOSE UNKNOWN — VERIFY)`);
        q.running = false;
        q.paused = false;
        qError.textContent = `CLOSE UNKNOWN — ${code} — VERIFY TOTE STATE MANUALLY`;
        renderQueue('STOPPED — no automatic retry');
        return;
      }

      q.failed.push(`${code} (${error?.message || error})`);
      q.index++;
      renderQueue(error?.message || String(error));
    } finally {
      shared.queueBusy = false;
      if (!q.running && shared.owner === 'queue') shared.owner = '';
      if (active() && !q.paused) queueMicrotask(() => queuePump(run));
    }
  }

  queuePanel.onclick = event => {
    const action = event.target.dataset.a;
    if (!action) return;

    if (action === 'start') {

      q.runSeq++;
      q.list = parseContainers(qText.value);
      q.index = 0;
      q.failed = [];
      q.running = !!q.list.length;
      q.paused = false;
      renderQueue(q.running ? 'starting API queue' : 'no containers');
      queuePump(q.runSeq);
      return;
    }

    if (action === 'pause') {
      q.paused = !q.paused;
      event.target.textContent = q.paused ? 'Resume' : 'Pause';
      renderQueue();
      if (!q.paused) queuePump(q.runSeq);
      return;
    }

    if (action === 'stop') {
      q.runSeq++;
      q.running = false;
      q.paused = false;
      if (shared.owner === 'queue') shared.owner = '';
      renderQueue('stopped');
    }
  };
  renderQueue();

  const qtyPanel = panel('sh-qty', `Qty quick select v${VERSION}`, 'qty');
  qtyPanel.innerHTML += '<div class="sh-qty-grid"></div><button class="sh-btn sh-clear-tote" data-clear-tote>double click = clear</button><div class="sh-status"></div>';
  const qtyGrid = $('.sh-qty-grid', qtyPanel), qtyStatus = $('.sh-status', qtyPanel), qtyClear = $('[data-clear-tote]', qtyPanel);

  for (let i=1; i<=10; i++) {
    const b = document.createElement('button');
    b.className = 'sh-btn';
    b.textContent = i;
    b.onclick = () => runQty(i);
    qtyGrid.appendChild(b);
  }

  let qtyRequestSeq = 0;

  async function runQty(qty) {
    if (shared.owner) return;

    const token = ++qtyRequestSeq;
    shared.owner = 'qty';
    qtyStatus.textContent = `QTY ${qty} selected`;

    try {
      if (screen() === 'VERIFY') {
        const b = confirmButton();
        if (b) click(b);
      }

      const end = Date.now() + 300000; // 5 minutes for manual date entry.
      let input = null;
      let lastScreen = '';

      while (Date.now() < end && token === qtyRequestSeq) {
        const current = screen();

        if (current !== lastScreen) {
          lastScreen = current;

          if (current === 'EXPIRY') {
            qtyStatus.textContent = `QTY ${qty} saved — enter date`;
          } else if (current === 'VERIFY') {
            qtyStatus.textContent = `QTY ${qty} saved — verifying item`;
          } else if (current === 'QTY') {
            qtyStatus.textContent = `QTY ${qty} — entering now`;
          } else {
            qtyStatus.textContent = `QTY ${qty} saved — waiting`;
          }
        }

        if (current === 'QTY') {
          input = scanInput();
          if (input) break;
        }

        await sleep(50);
      }

      if (token !== qtyRequestSeq) return;
      if (!input) throw new Error(`QTY ${qty} timed out waiting for quantity screen`);

      if (token !== qtyRequestSeq) return;
      input.focus();
      input.select?.();
      setValue(input, '');
      await sleep(10);
      if (token !== qtyRequestSeq) return;
      setValue(input, qty);
      await sleep(25);
      if (token !== qtyRequestSeq) return;

      const b = confirmButton();
      enabled(b) ? click(b) : enter(input);

      qtyStatus.textContent = `QTY ${qty} sent`;
    } catch (e) {
      qtyStatus.textContent = e?.message || String(e);
    } finally {
      if (token === qtyRequestSeq) {
        setTimeout(() => {
          if (token === qtyRequestSeq && shared.owner === 'qty') shared.owner = '';
        }, 150);
      }
    }
  }

  qtyClear.addEventListener('dblclick', async e => {
    e.preventDefault();
    if (shared.owner) {
      qtyStatus.textContent = 'Busy — try again';
      return;
    }
    shared.owner = 'qty-clear';
    qtyClear.disabled = true;
    qtyStatus.textContent = 'Clearing current tote…';
    try {
      if (!changeButton()) throw new Error('No open container');
      const result = await closeOpenContainer('yes');
      if (result !== 'closed') throw new Error(result);
      qtyStatus.textContent = 'Current tote cleared';
    } catch (err) {
      qtyStatus.textContent = `Clear failed: ${err.message}`;
    } finally {
      qtyClear.disabled = false;
      shared.owner = '';
    }
  });

  const lazy = {
    running:false,
    paused:false,
    predicant:false,
    index:0,
    items:[],
    deferred:[],
    invalid:[],
    errors:0,
    src:'',
    dest:'',
    sourceMeta:null,
    error:'',
    note:'',
    runSeq:0,
    activeRun:null,
    predicantResolve:null,
    dateResolve:null,
    damagePaused:false,
    damagedDest:'',
    inputCollapsed:false,
    delayEnabled: localStorage.getItem(LAZY_DELAY_KEY) !== '0',
    nextMoveAt:0
  };


  // Lazy pre-resolve: scan-item only. This cache never calls move-items or close-container.
  // It uses otherwise-idle time while the operator is scanning barcodes, then Start reuses
  // completed/in-flight scan-item responses. Movement still begins only inside startLazy().
  const lazyPreResolve = {
    sourceKey:'',
    generation:0,
    queue:[],
    entries:new Map(),
    controllers:new Set(),
    active:0
  };

  function lazyPreResolveKey(source, barcode) {
    return `${norm(source)}\u0000${clean(barcode).toUpperCase()}`;
  }

  function resetLazyPreResolve(source='') {
    lazyPreResolve.generation++;
    for (const controller of lazyPreResolve.controllers) {
      try { controller.abort(); } catch {}
    }
    lazyPreResolve.controllers.clear();
    lazyPreResolve.queue.length = 0;
    for (const entry of lazyPreResolve.entries.values()) {
      if (!entry.settled) {
        entry.settled = true;
        entry.resolve(null);
      }
    }
    lazyPreResolve.entries.clear();

    const code = validContainer(source) ? clean(source) : '';
    lazyPreResolve.sourceKey = code ? norm(code) : '';
  }

  function syncLazyPreResolveSource() {
    const source = validContainer(lSrc.value) ? clean(lSrc.value) : '';
    const key = source ? norm(source) : '';

    if (key !== lazyPreResolve.sourceKey) resetLazyPreResolve(source);
    return source;
  }

  function finishLazyPreResolveEntry(entry, value) {
    if (entry.settled) return;
    entry.settled = true;
    entry.resolve(value);
  }

  function pumpLazyPreResolve() {
    while (lazyPreResolve.active < LOOKUP_CONCURRENCY && lazyPreResolve.queue.length) {
      const entry = lazyPreResolve.queue.shift();
      if (!entry || entry.generation !== lazyPreResolve.generation || lazyPreResolve.entries.get(entry.key) !== entry) {
        finishLazyPreResolveEntry(entry, null);
        continue;
      }

      lazyPreResolve.active++;
      entry.state = 'pending';
      const controller = new AbortController();
      entry.controller = controller;
      lazyPreResolve.controllers.add(controller);

      fetch(API_SCAN_ITEM, {
        method:'POST',
        credentials:'same-origin',
        headers:{'content-type':'application/json'},
        body:JSON.stringify(scanItemPayload(entry.source, entry.code)),
        signal:controller.signal
      }).then(async response => {
        const raw = await response.text();
        let payload = raw;
        try { payload = raw ? JSON.parse(raw) : null; } catch {}

        if (
          response.ok &&
          entry.generation === lazyPreResolve.generation &&
          lazyPreResolve.entries.get(entry.key) === entry
        ) {
          entry.state = 'done';
          entry.response = payload;
          finishLazyPreResolveEntry(entry, payload);
          return;
        }

        finishLazyPreResolveEntry(entry, null);
      }).catch(() => {
        finishLazyPreResolveEntry(entry, null);
      }).finally(() => {
        lazyPreResolve.controllers.delete(controller);
        lazyPreResolve.active = Math.max(0, lazyPreResolve.active - 1);

        if (entry.state !== 'done' && lazyPreResolve.entries.get(entry.key) === entry) {
          lazyPreResolve.entries.delete(entry.key);
        }

        pumpLazyPreResolve();
      });
    }
  }

  function queueLazyPreResolve(items=parseItems(lItems.value)) {
    if (lazy.running) return;
    const source = syncLazyPreResolveSource();
    if (!source) return;

    const generation = lazyPreResolve.generation;
    for (const item of items) {
      const key = lazyPreResolveKey(source, item.code);
      if (lazyPreResolve.entries.has(key)) continue;

      let resolve;      const promise = new Promise(r => { resolve = r; });
      const entry = {
        key,
        source,
        code:item.code,
        generation,
        state:'queued',
        response:null,
        promise,
        resolve,
        settled:false,
        controller:null
      };

      lazyPreResolve.entries.set(key, entry);
      lazyPreResolve.queue.push(entry);
    }

    pumpLazyPreResolve();
  }

  async function getLazyPreResolvedResponse(source, barcode) {
    const key = lazyPreResolveKey(source, barcode);
    const entry = lazyPreResolve.entries.get(key);
    if (!entry || entry.generation !== lazyPreResolve.generation) return null;

    const response = entry.state === 'done' ? entry.response : await entry.promise;
    return response == null ? null : response;
  }

  const lazyPanel = panel('sh-lazy', `Lazy Sideline v${VERSION}`, 'lazy');
  lazyPanel.insertAdjacentHTML('beforeend',
    '<label class="sh-field-label">SOURCE</label>' +
    '<input class="sh-input" data-f="src" placeholder="tsX / csX">' +
    '<div class="sh-flow-arrow">↓</div>' +
    '<label class="sh-field-label">DESTINATION</label>' +
    '<input class="sh-input" data-f="dest" placeholder="tsX / csX">' +
    '<div class="sh-flow-arrow">↓</div>' +
    '<label class="sh-field-label">ITEM BARCODES</label>' +
    '<textarea class="sh-input sh-area" data-f="items" placeholder="Scan or paste one per line"></textarea>' +
    '<div class="sh-lazy-input-summary"><span data-lazy-input-summary>0 unique / 0 units</span><button type="button" data-a="toggle-items">Expand</button></div>' +
    '<div id="sh-lazy-settings">' +
      '<button class="sh-btn sh-on" data-a="clear-source">CLEAR SOURCE: ON</button>' +
      '<button class="sh-btn sh-on" data-a="delay">DELAY 2–8s: ON</button>' +
      '<input type="checkbox" data-f="clear" hidden>' +
    '</div>' +
    '<div class="sh-grid4">' +
      '<button class="sh-btn sh-on" data-a="start">RUN LAZY</button>' +
      '<button class="sh-btn" data-a="pause">Pause</button>' +
      '<button class="sh-btn sh-stop" data-a="stop">Stop</button>' +
      '<button class="sh-btn" data-a="reset">Reset</button>' +
    '</div>' +
    '<div class="sh-metrics">' +
      '<div class="sh-metric">Total units<b data-m="total">0</b></div>' +
      '<div class="sh-metric">Unique items<b data-m="unique">0</b></div>' +
      '<div class="sh-metric">Moved<b data-m="moved">0</b></div>' +
      '<div class="sh-metric">Remaining<b data-m="remaining">0</b></div>' +
    '</div>' +
    '<div class="sh-notmoved-line">Errors: <b data-m="failed">0</b></div>' +
    '<div class="sh-predicant-card"></div>' +
    '<div class="sh-failure-pill" data-a="copy-failed" title="Current run only — clears on Start, Reset, or page reload"></div>' +
    '<div class="sh-status"></div><div class="sh-error"></div><div class="sh-result-summary"></div><div class="sh-progress"></div>'
  );

  const lSrc = $('[data-f="src"]', lazyPanel);
  const lDest = $('[data-f="dest"]', lazyPanel);
  const lItems = $('[data-f="items"]', lazyPanel);
  const lClear = $('[data-f="clear"]', lazyPanel);
  const lStatus = $('.sh-status', lazyPanel);
  const lError = $('.sh-error', lazyPanel);
  const lResultSummary = $('.sh-result-summary', lazyPanel);
  const lPredicantCard = $('.sh-predicant-card', lazyPanel);
  const lFailurePill = $('.sh-failure-pill', lazyPanel);
  const lProgress = $('.sh-progress', lazyPanel);
  const lPause = $('[data-a="pause"]', lazyPanel);
  const lDelay = $('[data-a="delay"]', lazyPanel);
  const lClearToggle = $('[data-a="clear-source"]', lazyPanel);
  const lInputSummary = $('.sh-lazy-input-summary', lazyPanel);
  const lInputSummaryText = $('[data-lazy-input-summary]', lazyPanel);
  const lInputToggle = $('[data-a="toggle-items"]', lazyPanel);
  const lErrorCountLine = $('.sh-notmoved-line', lazyPanel);
  const mTotal = $('[data-m="total"]', lazyPanel);
  const mUnique = $('[data-m="unique"]', lazyPanel);
  const mMoved = $('[data-m="moved"]', lazyPanel);
  const mFailed = $('[data-m="failed"]', lazyPanel);
  const mRemaining = $('[data-m="remaining"]', lazyPanel);

  lClear.checked = localStorage.getItem(CLEAR_SOURCE_KEY) === '1';
  lClear.addEventListener('change', () => localStorage.setItem(CLEAR_SOURCE_KEY, lClear.checked ? '1' : '0'));

  function validContainer(v) {
    return /^(?:cs|ts)x[0-9a-z_-]+$/i.test(clean(v));
  }

  function partialContainer(v) {
    return /^(?:|c|t|cs|ts|csx|tsx|csx[0-9a-z_-]*|tsx[0-9a-z_-]*)$/i.test(clean(v));
  }

  function parseItems(text) {
    const map = new Map();
    const src = norm(lSrc.value);
    const dest = norm(lDest.value);
    const trigger = norm(START_TRIGGER);

    for (const raw of String(text).split(/\r?\n/)) {
      const value = clean(raw);
      if (!value) continue;
      const normalized = norm(value);
      if (normalized === src || normalized === dest || normalized === trigger) continue;

      const key = value.toUpperCase();
      const item = map.get(key);
      if (item) item.qty++;
      else map.set(key, { code:value, qty:1, status:'', ctx:null });
    }
    return [...map.values()];
  }

  function markLazyRemovedItemsOnResume() {
    const wanted = new Set(parseItems(lItems.value).map(item => clean(item.code).toUpperCase()));
    let skippedUnits = 0;

    for (const item of lazy.items) {
      if (['MOVED','FAILED','INVALID','SKIPPED'].includes(item.status)) continue;
      if (wanted.has(clean(item.code).toUpperCase())) continue;

      skippedUnits += itemQty(item);
      item.skipRequested = true;
      item.status = 'SKIPPED';
      item.failReason = 'REMOVED WHILE PAUSED — NOT MOVED';
    }

    if (skippedUnits) renderLazy();
    return skippedUnits;
  }

  function lazyItemShouldSkip(item) {
    return !!(item?.skipRequested || item?.status === 'SKIPPED');
  }

  function markLazyItemSkipped(item) {
    if (!item) return;
    item.skipRequested = true;
    item.status = 'SKIPPED';
    item.failReason = item.failReason || 'REMOVED WHILE PAUSED — NOT MOVED';
    renderLazy();
  }

  function refreshItems() {
    if (!lazy.running) {
      lazy.items = parseItems(lItems.value);
      lazy.index = 0;
      queueLazyPreResolve(lazy.items);
    }
    renderLazy();
  }

  let lazyProgressShape = '';

  function lazyRowView(it, i) {
    const cls = it.status === 'MOVED' ? 'moved'
      : it.status === 'INVALID' || it.status === 'FAILED' ? 'failed'
      : it.status === 'DEST_RETRY' ? 'retry'
      : it.status === 'DATE' ? 'parked'
      : (i === lazy.index && lazy.running ? 'current' : '');

    if (it.status === 'MOVED') {
      return {
        cls,
        html:`✓ MOVED → ${esc(lazy.dest || lDest.value || 'DEST')} &nbsp; | &nbsp; ${esc(it.code)} ×${it.qty}`
      };
    }

    if (it.status === 'INVALID' || it.status === 'FAILED') {
      return {
        cls,
        html:`✕ NOT MOVED &nbsp; | &nbsp; ${esc(it.code)} ×${it.qty}${it.failReason ? ` &nbsp; | &nbsp; ${esc(it.failReason)}` : ''}`
      };
    }

    if (it.status === 'DEST_RETRY') {
      return {
        cls,
        html:`⚠ WAITING TO RETRY &nbsp; | &nbsp; ${esc(it.code)} ×${it.qty}` +
          (it.ctx?.fnsku ? ` &nbsp; | &nbsp; FNSKU ${esc(it.ctx.fnsku)}` : '')
      };
    }

    if (it.status === 'DATE') {
      const label = it.ctx?.dateType === 'PRODUCTION_DATE' ? 'PRODUCTION DATE' : 'EXPIRATION DATE';
      return {
        cls,
        html:`⚠ DATE REQUIRED &nbsp; | &nbsp; ${esc(it.code)} ×${it.qty} &nbsp; | &nbsp; ${label}`
      };
    }

    const icon = i === lazy.index && lazy.running ? '▶ ' : '• ';
    const status = it.status ? ` — ${esc(it.status)}` : '';
    return { cls, html:`${icon}${esc(it.code)} ×${it.qty}${status}` };
  }

  function renderLazyProgress() {
    const shape = lazy.items.map(it => `${it.code}\u0000${it.qty}`).join('\u0001');

    if (shape !== lazyProgressShape || lProgress.children.length !== lazy.items.length) {
      lazyProgressShape = shape;
      lProgress.innerHTML = lazy.items
        .map((_, i) => `<div class="sh-item" data-i="${i}"></div>`)
        .join('');
    }

    for (let i = 0; i < lazy.items.length; i++) {
      const row = lProgress.children[i];
      if (!row) continue;

      const view = lazyRowView(lazy.items[i], i);
      const signature = `${view.cls}|${view.html}`;

      if (row.dataset.sig === signature) continue;
      row.dataset.sig = signature;
      row.className = `sh-item ${view.cls}`;
      row.innerHTML = view.html;
    }
  }

  function setSummaryHtml(html) {
    if (lResultSummary.dataset.html === html) return;
    lResultSummary.dataset.html = html;
    lResultSummary.innerHTML = html;
    lResultSummary.classList.toggle('show', !!html);
  }

  function renderLazy(note='') {
    let total = 0;
    let movedUnits = 0;
    let failedUnits = 0;
    let skippedUnits = 0;
    const movedItems = [];
    const failedItems = [];

    for (const item of lazy.items) {
      const qty = itemQty(item);
      total += qty;

      if (item.status === 'MOVED') {
        movedUnits += qty;
        movedItems.push(item);
      } else if (item.status === 'INVALID' || item.status === 'FAILED') {
        failedUnits += qty;
        failedItems.push(item);
      } else if (item.status === 'SKIPPED') {
        skippedUnits += qty;
      }
    }

    const remainingUnits = Math.max(0, total - movedUnits - failedUnits - skippedUnits);

    const uniqueItems = lazy.items.length;
    setTextIfChanged(mTotal, total);
    setTextIfChanged(mUnique, uniqueItems);
    setTextIfChanged(mMoved, movedUnits);
    setTextIfChanged(mFailed, failedUnits);
    setTextIfChanged(mRemaining, remainingUnits);

    const compactInput = !!lazy.inputCollapsed;
    const autoCapture = !!(
      compactInput &&
      (
        lazy.predicant ||
        (!lazy.running && validContainer(lSrc.value) && validContainer(lDest.value))
      )
    );

    setTextIfChanged(lInputSummaryText, autoCapture
      ? `AUTO SCAN ON • ${uniqueItems} unique / ${total} units`
      : `${uniqueItems} unique / ${total} units`);

    lItems.classList.toggle('sh-lazy-collapsed', compactInput);
    lInputSummary.classList.toggle('show', compactInput);
    lInputSummary.classList.toggle('auto', autoCapture);
    setTextIfChanged(lInputToggle, compactInput ? 'Expand' : 'Collapse');

    lErrorCountLine.classList.toggle('show', failedUnits > 0);

    if (lazy.predicant) {
      const predicantHtml =
        `<div class="sh-predicant-title">⚠ ACTION REQUIRED — RESCAN DESTINATION</div>` +
        `<div class="sh-predicant-dest">${esc(lazy.dest || 'DESTINATION')}</div>` +
        `<div class="sh-predicant-help"><strong>SCAN THAT DESTINATION AGAIN NOW</strong><br>` +
        `Lazy is paused and waiting. Recovery starts automatically after the scan.</div>` +
        `<button type="button" class="sh-btn sh-return-source-inline" data-return-source>↩ Return to Source</button>`;
      if (lPredicantCard.dataset.html !== predicantHtml) {
        lPredicantCard.dataset.html = predicantHtml;
        lPredicantCard.innerHTML = predicantHtml;
      }
    } else {
      if (lPredicantCard.dataset.html) {
        lPredicantCard.dataset.html = '';
        lPredicantCard.innerHTML = '';
      }
    }
    lPredicantCard.classList.toggle('show', lazy.predicant);
    lItems.classList.toggle('sh-predicant-scan', lazy.predicant);

    const showFailures = !!(failedItems.length && lazy.running);
    if (showFailures) {
      const preview = failedItems.slice(0, 2).map(it => it.code).join(', ');
      const extra = failedItems.length > 2 ? ` +${failedItems.length - 2} more` : '';
      setTextIfChanged(lFailurePill, `Failures: ${failedUnits} — ${preview}${extra} [click to copy]`);
    } else {
      setTextIfChanged(lFailurePill, '');
    }
    lFailurePill.classList.toggle('show', showFailures);

    const mode = lazy.predicant ? 'PREDICANT' : lazy.running ? (lazy.paused ? 'PAUSED' : 'RUNNING') : 'IDLE';
    setTextIfChanged(lStatus, `${mode}${lazy.note ? ` | ${lazy.note}` : ''}${note ? ' | '+note : ''}`);
    setTextIfChanged(lError, lazy.error);

    let summaryHtml = '';
    if (!lazy.running && (movedItems.length || failedItems.length)) {
      const movedLine = movedUnits
        ? `<div class="sh-result-ok">✓ ${movedUnits} MOVED → ${esc(lazy.dest || lDest.value || 'DESTINATION')}</div>`
        : '';

      const failedLine = failedItems.length
        ? `<div class="sh-result-bad">` +
            `<div class="sh-result-bad-head">` +
              `<div class="sh-result-bad-title">✕ ${failedUnits} NOT MOVED</div>` +
              `<div class="sh-failed-actions"><button type="button" data-a="copy-failed">Copy failed barcodes</button></div>` +
            `</div>` +
            `<div class="sh-failed-list">${
              failedItems.map(it => {
                const asin = clean(it.ctx?.asin || it.code || '—');
                const fnsku = clean(it.ctx?.fnsku || '—');
                const issue = clean(it.failReason || (it.status === 'INVALID' ? 'INVALID BARCODE' : 'MOVE FAILED')) || 'MOVE FAILED';
                const scan = clean(it.code || '—');
                return `<div class="sh-failed-card">` +
                  `<div class="sh-failed-top">${esc(scan)}</div>` +
                  `<div class="sh-failed-grid">` +
                    `<b>ASIN:</b><span>${esc(asin)}</span>` +
                    `<b>FNSKU:</b><span>${esc(fnsku)}</span>` +
                    `<b>Qty:</b><span>${esc(String(it.qty))}</span>` +
                    `<b>Issue:</b><span>${esc(issue)}</span>` +
                  `</div>` +
                `</div>`;
              }).join('')
            }</div>` +
          `</div>`
        : '';

      summaryHtml = movedLine + failedLine;
    }

    setSummaryHtml(summaryHtml);
    renderLazyProgress();

    const lazyWaiting = !!(
      lazy.running &&
      (lazy.paused || lazy.predicant || lazy.damagePaused || lazy.dateResolve)
    );
    setMoveCorner('lazy', lazyWaiting ? 'waiting' : lazy.running ? 'active' : 'idle');
    if (lDelay) {
      lDelay.textContent = `DELAY 2–8s: ${lazy.delayEnabled ? 'ON' : 'OFF'}`;
      lDelay.classList.toggle('sh-on', lazy.delayEnabled);
      lDelay.classList.toggle('sh-setting-off', !lazy.delayEnabled);
      lDelay.title = lazy.delayEnabled ? 'Artificial Lazy move pacing is ON (2–8 seconds between confirmed moves).' : 'Artificial Lazy move pacing is OFF.';
    }
    if (lClearToggle) {
      lClearToggle.textContent = `CLEAR SOURCE: ${lClear.checked ? 'ON' : 'OFF'}`;
      lClearToggle.classList.toggle('sh-on', lClear.checked);
      lClearToggle.classList.toggle('sh-setting-off', !lClear.checked);
      lClearToggle.title = lClear.checked ? 'Clear source container when Lazy finishes.' : 'Leave source container open when Lazy finishes.';
    }
    requestPanelLayout();
  }

  let damageTitleTimer = 0;
  let damageOriginalTitle = '';

  function stopDamageAttention() {
    if (damageTitleTimer) {
      clearInterval(damageTitleTimer);
      damageTitleTimer = 0;
    }

    if (damageOriginalTitle) {
      document.title = damageOriginalTitle;
      damageOriginalTitle = '';
    }

    $('#sh-damage-alert')?.remove();
  }

  function startDamageAttention(destination) {
    stopDamageAttention();

    damageOriginalTitle = document.title || 'SidelineApp';

    const alert = document.createElement('div');
    alert.id = 'sh-damage-alert';
    alert.innerHTML =
      `<div class="sh-damage-box">⚠ DESTINATION CONTAINER DAMAGED — LAZY PAUSED` +
      `<small>${esc(destination)} — use a different destination before resuming</small></div>`;

    document.body.appendChild(alert);

    let flashes = 0;
    let warningTitle = false;

    damageTitleTimer = setInterval(() => {
      warningTitle = !warningTitle;
      document.title = warningTitle
        ? '⚠ DAMAGED DESTINATION — LAZY PAUSED ⚠'
        : damageOriginalTitle;

      flashes++;
      if (flashes >= 12) {
        clearInterval(damageTitleTimer);
        damageTitleTimer = 0;
        document.title = damageOriginalTitle;
      }
    }, 420);
  }

  function isDamagedDestinationResponse(response) {
    const result = response?.filterResult;
    const reason = result?.reason;

    if (result?.compatible !== false) return false;

    return (
      reason?.containerDamaged === true ||
      clean(reason?.['@type']).toLowerCase() === 'damageditemsfilterresultreason' ||
      /damageditemsfilter/i.test(clean(result?.filterType))
    );
  }

  function pauseForDamagedDestination(item, ctx, response) {
    item.status = 'DEST_RETRY';
    item.failReason = `DESTINATION DAMAGED — ${lazy.dest} — WAITING TO RETRY`;

    lazy.damagePaused = true;
    lazy.damagedDest = lazy.dest;
    lazy.paused = true;
    lazy.error = `DESTINATION DAMAGED — ${lazy.dest} — RUN PAUSED`;
    lazy.note = `${ctx.barcode}${ctx.fnsku ? ` / ${ctx.fnsku}` : ''} NOT MOVED YET — change destination, then Resume to retry it`;

    lDest.classList.remove('good');
    lDest.classList.add('bad');
    if (lPause) lPause.textContent = 'Resume';

    setLazyRunningIndicator(false);
    startDamageAttention(lazy.dest);
    renderLazy();
  }

  function stopLazyForModeSwitch(note='mode switched') {
    const hadLazyWork = !!(lazy.running || lazy.activeRun || lazy.predicant || lazy.damagePaused || lazy.dateResolve);
    resetLazyPreResolve();
    if (!hadLazyWork) return;

    cancelLazyRun();
    clearMoveCorner('lazy');
    lazy.running = false;
    lazy.paused = false;
    lazy.predicant = false;
    lazy.damagePaused = false;
    lazy.damagedDest = '';
    stopDamageAttention();
    if (lPause) lPause.textContent = 'Pause';
    lazy.predicantResolve?.();
    lazy.predicantResolve = null;
    lazy.dateResolve?.(null);
    lazy.dateResolve = null;
    $('#sh-og-expiry')?.remove();
    setLazyRunningIndicator(false);
    if (shared.owner === 'lazy') shared.owner = '';
    lazy.note = note;
    renderLazy();
  }

  function resetLazy(note='reset') {
    cancelLazyRun();
    resetLazyPreResolve();
    clearMoveCorner('lazy');
    lazyProgressShape = '';
    lazy.running = false;
    lazy.paused = false;
    lazy.predicant = false;
    lazy.damagePaused = false;
    lazy.damagedDest = '';
    lazy.inputCollapsed = false;
    clearLazyCollapsedScanBuffer();
    stopDamageAttention();
    if (lPause) lPause.textContent = 'Pause';
    lazy.index = 0;
    lazy.items = [];
    lazy.deferred = [];
    lazy.invalid = [];
    lazy.errors = 0;
    lazy.src = '';
    lazy.dest = '';
    lazy.sourceMeta = null;
    lazy.error = '';
    lazy.note = note;
    lazy.predicantResolve?.();
    lazy.predicantResolve = null;
    lazy.dateResolve?.(null);
    lazy.dateResolve = null;
    shared.owner = '';
    lSrc.value = '';
    lDest.value = '';
    lItems.value = '';
    lSrc.classList.remove('good','bad');
    lDest.classList.remove('good','bad');
    $('#sh-og-expiry')?.remove();
    $('#sh-invalid-toast')?.remove();
    setLazyRunningIndicator(false);
    renderLazy();
    setTimeout(() => lSrc.focus(), 0);
  }

  function setLazyInputCollapsed(collapsed, { focusItems = false } = {}) {
    lazy.inputCollapsed = !!collapsed;
    if (!lazy.inputCollapsed) clearLazyCollapsedScanBuffer();
    renderLazy();

    if (focusItems && !lazy.inputCollapsed) {
      setTimeout(() => lItems.focus(), 0);
    }
  }

  let lazySourceRevealTimer = 0;
  function revealLazyItemsForSource() {
    clearTimeout(lazySourceRevealTimer);
    lazySourceRevealTimer = 0;

    if (lazy.running || !validContainer(lSrc.value)) return false;
    setLazyInputCollapsed(false);
    return true;
  }

  function scheduleLazySourceReveal() {
    clearTimeout(lazySourceRevealTimer);
    if (!validContainer(lSrc.value)) return;
    lazySourceRevealTimer = setTimeout(revealLazyItemsForSource, 90);
  }

  function installContainerAdvance(input, next, { revealItems = false } = {}) {
    input.addEventListener('input', () => {
      if (!partialContainer(input.value)) {
        input.value = '';
        input.classList.remove('good');
        input.classList.add('bad');
        lazy.error = 'Container must start with csX or tsX.';
      } else {
        const ok = validContainer(input.value);
        input.classList.toggle('good', ok);
        input.classList.toggle('bad', !!input.value && !ok);
        if (ok) lazy.error = '';
      }
      refreshItems();
      if (revealItems) scheduleLazySourceReveal();
    });

    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== 'Tab') return;
      e.preventDefault();
      const v = clean(input.value);
      if (!validContainer(v)) {
        lazy.error = 'Container must start with csX or tsX.';
        input.value = '';
        input.classList.remove('good');
        input.classList.add('bad');
        renderLazy();
        return;
      }
      lazy.error = '';
      input.classList.add('good');
      if (revealItems) revealLazyItemsForSource();
      setTimeout(() => next.focus(), 0);
      renderLazy();
    });

    input.addEventListener('paste', () => setTimeout(() => {
      if (validContainer(input.value)) {
        lazy.error = '';
        input.classList.add('good');
        input.classList.remove('bad');
        if (revealItems) revealLazyItemsForSource();
        next.focus();
      } else {
        lazy.error = 'Container must start with csX or tsX.';
        input.value = '';
        input.classList.remove('good');
        input.classList.add('bad');
      }
      renderLazy();
    }, 0));
  }

  installContainerAdvance(lSrc, lDest, { revealItems: true });
  installContainerAdvance(lDest, lItems);

  let itemRefreshTimer = 0;
  function scheduleItemRefresh(delay=100) {
    clearTimeout(itemRefreshTimer);
    itemRefreshTimer = setTimeout(refreshItems, delay);
  }

  lItems.addEventListener('input', () => scheduleItemRefresh(80));
  lItems.addEventListener('paste', () => scheduleItemRefresh(0));

  function currentTextareaLine() {
    const value = lItems.value;
    const pos = lItems.selectionStart ?? value.length;
    const start = value.lastIndexOf('\n', Math.max(0, pos - 1)) + 1;
    const next = value.indexOf('\n', pos);
    const end = next < 0 ? value.length : next;
    return { value, start, end, code:clean(value.slice(start,end)) };
  }

  function removeTextareaLine(line) {
    let before = line.value.slice(0,line.start);
    let after = line.value.slice(line.end);
    if (before.endsWith('\n') && after.startsWith('\n')) after = after.slice(1);
    lItems.value = before + after;
    lItems.focus();
    lItems.setSelectionRange?.(lItems.value.length,lItems.value.length);
    refreshItems();
  }

  function acceptCollapsedLazyScan(rawCode) {
    const code = clean(rawCode);
    if (!code) return false;

    const sameSrc = norm(code) === norm(lSrc.value);
    const sameDest = norm(code) === norm(lDest.value);
    const startTrigger = norm(code) === norm(START_TRIGGER);

    if (lazy.predicant && sameDest && lazy.predicantResolve) {
      const done = lazy.predicantResolve;
      lazy.predicantResolve = null;
      lazy.predicant = false;
      lazy.paused = false;
      lazy.error = '';
      lazy.note = 'destination rescanned — recovery starting';
      lItems.classList.remove('sh-predicant-scan');
      done();
      return true;
    }

    if (!lazy.running && validContainer(lSrc.value) && validContainer(lDest.value)) {
      if (sameSrc || sameDest) return true;

      if (startTrigger) {
        refreshItems();
        if (lazy.items.length) startLazy();
        return true;
      }

      const current = lItems.value.trimEnd();
      lItems.value = current ? `${current}\n${code}` : code;
      refreshItems();
      lazy.inputCollapsed = true;
      lazy.note = `auto-captured ${code}`;
      renderLazy();
      return true;
    }

    return false;
  }

  let lazyCollapsedScanBuffer = '';
  let lazyCollapsedScanTimer = 0;

  function clearLazyCollapsedScanBuffer() {
    lazyCollapsedScanBuffer = '';
    if (lazyCollapsedScanTimer) {
      clearTimeout(lazyCollapsedScanTimer);
      lazyCollapsedScanTimer = 0;
    }
  }

  document.addEventListener('keydown', e => {
    if (!lazy.inputCollapsed || e.ctrlKey || e.altKey || e.metaKey) return;

    const shouldCapture =
      lazy.predicant ||
      (!lazy.running && validContainer(lSrc.value) && validContainer(lDest.value));

    if (!shouldCapture) return;

    const target = e.target;
    const typingElsewhere =
      target &&
      target !== document.body &&
      target !== document.documentElement &&
      target !== lItems &&
      (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      );

    if (typingElsewhere) return;

    if (typeof e.key === 'string' && e.key.length === 1) {
      lazyCollapsedScanBuffer += e.key;

      if (lazyCollapsedScanTimer) clearTimeout(lazyCollapsedScanTimer);
      lazyCollapsedScanTimer = setTimeout(clearLazyCollapsedScanBuffer, 1200);

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return;
    }

    if (e.key === 'Enter' && lazyCollapsedScanBuffer) {
      const code = clean(lazyCollapsedScanBuffer);
      clearLazyCollapsedScanBuffer();

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      acceptCollapsedLazyScan(code);
    }
  }, true);

  lItems.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;

    const line = currentTextareaLine();
    const sameSrc = line.code && norm(line.code) === norm(lSrc.value);
    const sameDest = line.code && norm(line.code) === norm(lDest.value);
    const startTrigger = line.code && norm(line.code) === norm(START_TRIGGER);

    if (sameSrc || sameDest || startTrigger) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      removeTextareaLine(line);

      if (lazy.predicant && sameDest && lazy.predicantResolve) {
        const done = lazy.predicantResolve;
        lazy.predicantResolve = null;
        lazy.predicant = false;
        lazy.paused = false;
        lazy.error = '';
        lazy.note = 'destination rescanned — recovery starting';
        lItems.classList.remove('sh-predicant-scan');
        done();
        return;
      }

      if (!lazy.running && lazy.items.length) startLazy();
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const start = lItems.selectionStart ?? lItems.value.length;
    const end = lItems.selectionEnd ?? start;
    const before = lItems.value.slice(0,start).replace(/[\t ]+$/,'');
    const after = lItems.value.slice(end).replace(/^\r?\n+/,'');
    lItems.value = `${before}\n${after}`;
    const caret = before.length + 1;
    lItems.setSelectionRange?.(caret,caret);
    scheduleItemRefresh(0);
  }, true);

  function setLazyRunningIndicator(on) {
    let el = $('#sh-lazy-running-indicator');

    if (on) {
      if (!el) {
        el = document.createElement('div');
        el.id = 'sh-lazy-running-indicator';
        el.innerHTML = '<div class="sh-lazy-spinner"></div>';
        document.body.appendChild(el);
      }
      return;
    }

    el?.remove();
  }

  function requestId() {
    const id = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `amzn1.fc.v1.common.request-id.v1.AFTPoirotWebsite.${id}`;
  }

  function payloadHasCustomerBound(value, seen=new Set()) {
    if (value == null) return false;
    if (typeof value === 'string') return /customer\s*bound\s*shipment/i.test(value);
    if (typeof value !== 'object') return false;
    if (seen.has(value)) return false;
    seen.add(value);

    if (Array.isArray(value)) return value.some(child => payloadHasCustomerBound(child, seen));
    return Object.entries(value).some(([key, child]) =>
      /customer\s*bound\s*shipment/i.test(key) || payloadHasCustomerBound(child, seen)
    );
  }

  async function scanSourceDirect(container) {
    const code = clean(container);
    if (!validContainer(code)) throw new Error('Source scan requires a valid csX/tsX container.');

    let response;
    try {
      response = await fetch(API_SCAN_SOURCE, {
        method:'POST',
        credentials:'same-origin',
        headers:{'content-type':'application/json'},
        body:JSON.stringify(scanSourcePayload(code))
      });
    } catch (cause) {
      const error = new Error(`Source scan failed for ${code}: ${cause?.message || cause}`);
      error.cause = cause;
      throw error;
    }

    let raw = '';
    try {
      raw = await response.text();
    } catch (cause) {
      const error = new Error(`Source response could not be read for ${code}.`);
      error.cause = cause;
      throw error;
    }

    let payload = raw;
    try { payload = raw ? JSON.parse(raw) : null; } catch {}

    if (payloadHasCustomerBound(payload)) {
      const error = new Error('CUSTOMER-BOUND SHIPMENT');
      error.customerBound = true;
      error.payload = payload;
      throw error;
    }

    if (
      !response.ok ||
      clean(payload?.['@type']) !== 'ScanSourceContainerResponse' ||
      payload?.success !== true
    ) {
      const reason = clean(
        payload?.message ||
        payload?.description ||
        payload?.errorMessage ||
        payload?.['@type'] ||
        (response.ok ? 'SOURCE VALIDATION FAILED' : `HTTP ${response.status}`)
      );
      const error = new Error(reason || 'SOURCE VALIDATION FAILED');
      error.payload = payload;
      throw error;
    }

    return payload;
  }

  function closeContainerPayload(container, containerEmpty) {
    return {
      containerScannableId:container,
      containerEmpty:containerEmpty === true,
      directedLabel:false,
      processPath:'UNDETERMINED',
      requestId:requestId(),
      tool:TOOL
    };
  }

  async function closeContainerDirect(container, containerEmpty) {
    const code = clean(container);
    if (!validContainer(code)) throw new Error('Direct close requires a valid csX/tsX container.');

    let response;
    try {
      response = await fetch(API_CLOSE_CONTAINER, {
        method:'POST',
        credentials:'same-origin',
        headers:{'content-type':'application/json'},
        body:JSON.stringify(closeContainerPayload(code, containerEmpty))
      });
    } catch (cause) {
      const error = new Error(`Close outcome UNKNOWN for ${code} — verify container state manually before retrying.`);
      error.name = 'CloseOutcomeUnknownError';
      error.outcomeUnknown = true;
      error.cause = cause;
      throw error;
    }

    let raw = '';
    try {
      raw = await response.text();
    } catch (cause) {
      const error = new Error(`Close outcome UNKNOWN for ${code} — response could not be read. Verify container state manually before retrying.`);
      error.name = 'CloseOutcomeUnknownError';
      error.outcomeUnknown = true;
      error.cause = cause;
      throw error;
    }

    let payload = raw;
    try { payload = raw ? JSON.parse(raw) : null; } catch {}

    if (
      !response.ok ||
      clean(payload?.['@type']) !== 'CloseContainerResponse' ||
      payload?.success !== true
    ) {
      const error = new Error(`Close NOT CONFIRMED for ${code}${response.ok ? '' : ` — HTTP ${response.status}`} — verify state before retrying.`);
      error.name = 'CloseNotConfirmedError';
      error.outcomeUnknown = true;
      error.payload = payload;
      throw error;
    }

    return payload;
  }

  function beginLazyRun() {
    return beginRun(lazy);
  }

  function cancelLazyRun() {
    cancelRun(lazy);
  }

  function finishLazyRun(run) {
    finishRun(lazy, run);
  }

  function currentLazyRun(run=lazy.activeRun) {
    return currentRun(lazy, run);
  }

  function runWasCancelled(error, run) {
    return error?.name === 'AbortError' || !currentLazyRun(run);
  }

  function api(path, body, run=lazy.activeRun) {
    return postJson(path, body, lazy, run);
  }

  function isOverageLabel(value) {
    return /\boverage(?:s)?\b|\bitem\s+not\s+in\s+(?:source\s+)?container\b|\bnot\s+in\s+source\s+container\b/i.test(clean(value));
  }

  function isBenignOverageCompanion(value) {
    const label = clean(value);
    return !label || isOverageLabel(label) || /^(?:bad request|conflict|request failed|http\s*[45]\d\d|[45]\d\d)$/i.test(label);
  }

  function responseProblemLabels(response) {
    return (Array.isArray(response?.problems) ? response.problems : [])
      .filter(Boolean)
      .map(problem => clean(
        problem?.description ||
        problem?.message ||
        problem?.reason ||
        problem?.code ||
        problem?.['@type'] ||
        ''
      ))
      .filter(Boolean);
  }

  function isAllowedOverageResponse(response) {
    if (!response || typeof response !== 'object') return false;

    const type = clean(response?.['@type']);
    if (type === 'InvalidBarcodeResponse' || type === 'RequestMultipleBarcodesResponse') return false;
    if (isHazmatRejectionResponse(response) || hasPredicant(response) || isDamagedDestinationResponse(response)) return false;

    const filter = response?.filterResult;
    const filterReason = clean(
      filter?.reason?.type ||
      filter?.reason?.description ||
      filter?.reason?.message ||
      filter?.reason?.['@type'] ||
      filter?.filterType ||
      ''
    );
    if (filter?.compatible === false && !isOverageLabel(filterReason)) return false;

    const problems = responseProblemLabels(response);
    if (problems.some(label => !isOverageLabel(label))) return false;

    const diagnosticLabels = [
      response?.message,
      response?.description,
      response?.errorMessage,
      response?.errorCode,
      filterReason,
      ...problems
    ].map(clean).filter(Boolean);

    const explicitOverage = isOverageLabel(type) || diagnosticLabels.some(isOverageLabel);    if (!explicitOverage) return false;

    // Overage is the ONLY exception. A response that also carries another
    // substantive problem stays fail-closed even if the word Overage appears.
    if (diagnosticLabels.some(label => !isBenignOverageCompanion(label))) return false;

    const fatalText = [type, ...diagnosticLabels].join(' ');
    if (/hazmat|dangerous.?goods|invalid\s+barcode|incompatib|damaged|predicant|customer\s*bound/i.test(fatalText)) {
      return false;
    }

    return true;
  }

  function resolveItem(response, barcode) {
    const type = clean(response?.['@type']);
    const allowedOverage = isAllowedOverageResponse(response);
    if (!response || type === 'InvalidBarcodeResponse' || (response.success === false && !allowedOverage)) {
      return { ok:false, invalid:type === 'InvalidBarcodeResponse', type:type || 'Unknown' };
    }

    const records = (Array.isArray(response.items) ? response.items : [])
      .filter(record => record?.skuDetail);

    const primary = records[0] || null;
    const sku = primary?.skuDetail;

    if (!primary || !sku) {
      return { ok:false, invalid:false, type:type || 'Unknown' };
    }

    return {
      ok:true,
      type,
      barcode,
      item:primary,
      records,
      sku,
      asin:clean(sku.asin),
      fnsku:clean(sku.fnSku),
      fcsku:clean(sku.fcSku),
      dateType:clean(sku.datelotDetail?.expirationPromptType),
      dateDetail:sku.datelotDetail || {},
      hazmat:sku.hazmat === true,
      permissionLevel:clean(sku.itemDropzoneRecommendation?.permissionLevel).toUpperCase(),
      overage:allowedOverage,
      notInSource:type === 'ItemNotInContainerResponse' || records.every(record => Number(record.quantity) === 0)
    };
  }

  function scanStageIssue(ctx) {
    const permissionLevel = clean(ctx?.permissionLevel).toUpperCase();
    if (permissionLevel !== 'UNDER_REVIEW') return null;

    const hazmat = ctx?.hazmat === true;
    return {
      kind:hazmat ? 'hazmat' : 'under-review',
      title:hazmat ? 'HAZMAT — ITEM NOT MOVED' : 'ASIN UNDER REVIEW — ITEM NOT MOVED',
      reason:hazmat ? 'HAZMAT / UNDER REVIEW — RIVER REQUIRED' : 'ASIN UNDER REVIEW — RIVER REQUIRED'
    };
  }

  function isHazmatRejectionResponse(response) {
    if (!response || typeof response !== 'object') return false;

    const filter = response.filterResult || {};
    const filterReason = filter.reason || {};
    const responseReason = response.reason || {};
    const problems = (Array.isArray(response.problems) ? response.problems : []).filter(Boolean);
    const labels = [
      response.message,
      response.description,
      response.errorMessage,
      response.errorCode,
      typeof response.reason === 'string' ? response.reason : '',
      responseReason.type,
      responseReason.description,
      responseReason.message,
      responseReason['@type'],
      filterReason.type,
      filterReason.description,
      filterReason.message,
      filterReason['@type'],
      filter.filterType,
      ...problems.flatMap(problem => [
        problem?.description,
        problem?.message,
        problem?.reason,
        problem?.code,
        problem?.['@type']
      ])
    ].map(clean).filter(Boolean);

    if (!labels.some(label => /hazmat|dangerous.?goods/i.test(label))) return false;

    const responseType = clean(response?.['@type']);
    return !!(
      response.success === false ||
      filter.compatible === false ||
      problems.length ||
      response.errorMessage ||
      response.errorCode ||
      /error|reject|incompat|filter/i.test(responseType)
    );
  }

  function moveOk(response) {
    if (isAllowedOverageResponse(response)) return true;
    if (!response || response.success !== true) return false;
    if (response.filterResult?.compatible === false) return false;
    if (isHazmatRejectionResponse(response)) return false;
    if (hasPredicant(response)) return false;

    return true;
  }

  function moveReason(response) {
    if (!response) return 'EMPTY MOVE RESPONSE';
    if (isHazmatRejectionResponse(response)) return 'HAZMAT';
    if (isAllowedOverageResponse(response)) return 'OVERAGE';

    const reason = response.filterResult?.reason;
    const reasonType = clean(reason?.['@type']).toLowerCase();
    const responseType = clean(response?.['@type']);

    if (
      reason?.containerDamaged === true ||
      reasonType === 'damageditemsfilterresultreason' ||
      /damageditemsfilter/i.test(clean(response.filterResult?.filterType))
    ) {
      return 'DESTINATION DAMAGED';
    }

    if (reasonType === 'rafilterresultreason') {
      const type = clean(reason?.type).toUpperCase();
      if (type === 'HAZMAT') return 'HAZMAT';
      if (type) return type;
      return 'DESTINATION INCOMPATIBLE';
    }

    if (response.filterResult?.compatible === false) {
      if (reason?.type) return clean(reason.type).toUpperCase();
      return 'DESTINATION INCOMPATIBLE';
    }

    const problems = (response.problems || []).filter(Boolean);
    if (problems.length) {
      const labels = problems.map(problem =>
        clean(problem?.description || problem?.['@type'] || '')
      ).filter(Boolean);
      if (labels.length) return labels.join(', ');
    }

    if (response.success === false) {
      return responseType && responseType !== 'MoveItemsResponse'
        ? responseType.replace(/Response$/,'')
        : 'MOVE REJECTED';
    }

    return responseType || 'MOVE REJECTED';
  }

  function hasPredicant(value) {
    if (value == null) return false;
    if (typeof value === 'string') return /predicant/i.test(value);
    if (Array.isArray(value)) return value.some(hasPredicant);
    if (typeof value !== 'object') return false;
    return Object.entries(value).some(([k,v]) => {
      if (/predicant/i.test(k)) {
        if (v === true) return true;
        if (typeof v === 'string' && v && !/^false$/i.test(v)) return true;
      }
      return hasPredicant(v);
    });
  }

  function showInvalidToast() {
    const codes = [...new Set(lazy.invalid)];
    if (!codes.length) return;
    $('#sh-invalid-toast')?.remove();
    const toast = document.createElement('div');
    toast.id = 'sh-invalid-toast';
    toast.innerHTML = `<button class="close">×</button><div class="title">INVALID BARCODE${codes.length===1?'':'S'}</div>${codes.map(c=>`<div><b>${esc(c)}</b></div>`).join('')}`;
    $('.close',toast).onclick = () => toast.remove();
    document.body.appendChild(toast);
  }

  async function waitWhilePaused(run=lazy.activeRun) {
    while (currentLazyRun(run) && lazy.running && lazy.paused && !lazy.predicant) await sleep(80);
    return currentLazyRun(run) && lazy.running;
  }

  async function waitPredicant(item, run) {
    lazy.predicant = true;
    lazy.paused = true;
    lazy.error = `WAITING FOR YOU — RESCAN DESTINATION ${lazy.dest} TO CONTINUE`;
    lazy.note = `${item.code} paused — no more moves will run until destination is rescanned`;
    renderLazy();

    if (!lazy.inputCollapsed) lItems.focus();
    lPredicantCard?.scrollIntoView?.({block:'nearest', inline:'nearest'});

    await new Promise(resolve => { lazy.predicantResolve = resolve; });
    if (!currentLazyRun(run) || !lazy.running) return false;

    lazy.predicant = true;
    lazy.paused = true;
    shared.owner = 'lazy-recovery';

    const setRecovery = message => {
      lazy.error = '';
      lazy.note = message;
      renderLazy();
    };

    try {
      setRecovery(`Predicant — emptying destination ${lazy.dest} by API...`);
      await closeContainerDirect(lazy.dest, true);

      if (!currentLazyRun(run) || !lazy.running) return false;

      lazy.predicant = false;
      lazy.paused = false;
      lazy.error = '';
      lazy.note = `Destination emptied — retrying ${item.code} ×${item.qty}`;
      shared.owner = 'lazy';
      renderLazy();
      return true;
    } catch (error) {
      if (error?.outcomeUnknown) {
        cancelLazyRun();
        lazy.running = false;
        lazy.predicant = false;
        lazy.paused = false;
        lazy.error = `Predicant recovery stopped — ${error?.message || error}`;
        lazy.note = 'VERIFY DESTINATION STATE MANUALLY — no automatic close retry was sent';
        shared.owner = '';
        setLazyRunningIndicator(false);
        renderLazy();
        return false;
      }

      if (runWasCancelled(error, run)) return false;

      lazy.predicant = true;
      lazy.paused = true;
      lazy.error = `Predicant recovery stopped: ${error?.message || error}`;
      lazy.note = 'scan destination again to retry recovery';
      shared.owner = 'lazy';
      renderLazy();
      return false;
    }
  }

  function randomLazyMoveDelayMs() {
    return LAZY_DELAY_MIN_MS + Math.floor(Math.random() * (LAZY_DELAY_MAX_MS - LAZY_DELAY_MIN_MS + 1));
  }

  async function waitLazyMovePacing(run=lazy.activeRun) {
    while (lazy.delayEnabled && lazy.nextMoveAt > Date.now()) {
      if (!currentLazyRun(run) || !lazy.running) return false;
      if (lazy.paused || lazy.predicant || lazy.damagePaused) {
        if (!await waitWhilePaused(run)) return false;
      }
      const left = lazy.nextMoveAt - Date.now();
      lazy.note = `artificial pacing ${Math.max(1, Math.ceil(left / 1000))}s`;
      renderLazy();
      await sleep(Math.min(150, Math.max(20, left)));
    }
    return currentLazyRun(run) && lazy.running;
  }

  async function moveResolved(item, ctx, expirationMs=null, run=lazy.activeRun) {
    if (lazyItemShouldSkip(item)) {
      markLazyItemSkipped(item);
      return false;
    }

    const totalQty = itemQty(item);

    item.status = 'MOVING';
    lazy.note = `${ctx.asin || ctx.barcode} / ${ctx.fnsku || ctx.barcode} | QTY ${totalQty}`;
    renderLazy();

    const payload = buildMovePayload(lazy.src, lazy.dest, lazy.sourceMeta, ctx, totalQty, expirationMs);

    while (lazy.running && currentLazyRun(run)) {
      if (lazyItemShouldSkip(item)) {
        markLazyItemSkipped(item);
        return false;
      }

      let response;

      try {
        if (!await waitLazyMovePacing(run)) return false;
        response = await api(API_MOVE_ITEMS, payload, run);
      } catch (error) {
        if (runWasCancelled(error, run)) return false;
        if (isAllowedOverageResponse(error?.payload)) {
          response = error.payload;
        } else {
          item.status = 'FAILED';
          item.failReason = `MOVE API ERROR: ${error?.message || error}`;
          lazy.errors++;
          lazy.error = `${ctx.barcode} — ${item.failReason} — NOT MOVED`;
          renderLazy();
          return false;
        }
      }

      if (hasPredicant(response) && !moveOk(response)) {
        while (lazy.running) {
          const recovered = await waitPredicant(item, run);
          if (recovered) break;

          if (!lazy.running || !currentLazyRun(run)) return false;

          await new Promise(resolve => { lazy.predicantResolve = resolve; });
          if (!lazy.running || !currentLazyRun(run)) return false;
        }

        continue;
      }

      if (isDamagedDestinationResponse(response)) {
        pauseForDamagedDestination(item, ctx, response);

        if (!await waitWhilePaused(run)) return false;

        payload.destinationContainerScannableId = lazy.dest;
        item.status = 'MOVING';
        item.failReason = '';
        lazy.note = `retrying ${ctx.barcode} ×${totalQty} → ${lazy.dest}`;
        renderLazy();
        continue;
      }

      if (!moveOk(response)) {
        item.status = 'FAILED';
        item.failReason = moveReason(response) || 'MOVE REJECTED';
        lazy.errors++;
        lazy.error = `${ctx.barcode} — ${item.failReason} — NOT MOVED`;
        renderLazy();
        return false;
      }

      item.status = 'MOVED';
      lazy.nextMoveAt = lazy.delayEnabled ? Date.now() + randomLazyMoveDelayMs() : 0;
      lazy.error = '';
      renderLazy();
      return true;
    }

    return false;
  }

  async function resolveOnly(item, run=lazy.activeRun) {
    if (lazyItemShouldSkip(item)) {
      markLazyItemSkipped(item);
      return { kind:'skipped' };
    }

    item.status = 'RESOLVING';
    renderLazy();

    let response;
    try {
      response = await getLazyPreResolvedResponse(lazy.src, item.code);
      if (!currentLazyRun(run)) return { kind:'aborted' };
      if (response == null) {
        response = await api(API_SCAN_ITEM, scanItemPayload(lazy.src, item.code), run);
      }
    } catch (error) {
      if (runWasCancelled(error, run)) return { kind:'aborted' };
      if (isAllowedOverageResponse(error?.payload)) {
        response = error.payload;
      } else {
        item.status = 'FAILED';
        item.failReason = 'SCAN API ERROR';
        lazy.errors++;
        lazy.error = `${item.code} — SCAN API ERROR — NOT MOVED`;
        renderLazy();
        return { kind:'failed' };
      }
    }

    if (!currentLazyRun(run)) return { kind:'aborted' };
    if (lazyItemShouldSkip(item)) {
      markLazyItemSkipped(item);
      return { kind:'skipped' };
    }

    const ctx = resolveItem(response,item.code);

    if (!ctx.ok) {
      if (ctx.invalid) {
        item.status = 'INVALID';
        item.failReason = 'INVALID BARCODE';
        lazy.invalid.push(item.code);
        lazy.errors++;
        lazy.error = `INVALID BARCODE — NOT MOVED: ${item.code}`;
        showInvalidToast();
        renderLazy();
        return { kind:'invalid' };
      }

      item.status = 'FAILED';
      item.failReason = ctx.type === 'RequestMultipleBarcodesResponse'
        ? 'MULTIPLE BARCODE MATCHES'
        : (ctx.type && ctx.type !== 'Unknown' ? ctx.type : 'NO ITEM DETAILS');
      lazy.errors++;
      lazy.error = `${item.code} — ${item.failReason} — NOT MOVED`;
      renderLazy();
      return { kind:'failed' };
    }

    item.ctx = ctx;

    if (ctx.dateType === 'EXPIRATION_DATE' || ctx.dateType === 'PRODUCTION_DATE') {
      item.status = 'DATE';
      renderLazy();
      return { kind:'date', ctx };
    }

    const scanIssue = scanStageIssue(ctx);
    if (scanIssue) {
      item.status = 'FAILED';
      item.failReason = scanIssue.reason;
      lazy.errors++;
      lazy.error = `${item.code} — ${scanIssue.reason} — NOT MOVED`;
      renderLazy();
      return { kind:'failed' };
    }

    item.status = 'READY';
    renderLazy();
    return { kind:'ready', ctx };
  }

  function parkDeferredDate(item, ctx) {
    lazy.deferred.push(item);
    renderLazy();
  }

  // Dates
  const MONTHS = [['JAN',1],['FEB',2],['MAR',3],['APR',4],['MAY',5],['JUN',6],['JUL',7],['AUG',8],['SEP',9],['OCT',10],['NOV',11],['DEC',12]];

  function maxDay(month) {
    if (month === 2) return 29;
    return [4,6,9,11].includes(month) ? 30 : 31;
  }

  function validDate(month,day,year) {
    const d = new Date(year,month-1,day,0,0,0,0);
    return d.getFullYear() === year && d.getMonth() === month-1 && d.getDate() === day ? d.getTime() : 0;
  }

  function futureOrToday(ms) {
    const t = new Date();
    t.setHours(0,0,0,0);
    return ms >= t.getTime();
  }

  function pastOrToday(ms) {
    const t = new Date();
    t.setHours(23,59,59,999);
    return ms <= t.getTime();
  }

  function paoDateMs() {
    const d = new Date();
    d.setHours(0,0,0,0);
    d.setDate(d.getDate()+900);
    return d.getTime();
  }

  function dateLabel(ms) {
    const d = new Date(ms);
    return `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}/${d.getFullYear()}`;
  }

  function normalizeImageUrl(raw) {
    const url = clean(raw);
    if (!url) return '';
    return url
      .replace(/^http:\/\/ecx\.images-amazon\.com\/images\/I\//i, 'https://m.media-amazon.com/images/I/')
      .replace(/^http:\/\//i, 'https://');
  }

  function productImageUrl(ctx) {
    return normalizeImageUrl(ctx?.sku?.imageUrls?.[0]);
  }

  function showApiDatePicker(item) {
    const owner = lazy;
    return new Promise(resolve => {
      const ctx = item.ctx;
      const production = ctx.dateType === 'PRODUCTION_DATE';
      const selection = { month:null, day:1, year:null };
      const root = document.createElement('div');
      root.id = 'sh-og-expiry';
      root.dataset.owner = 'lazy';
      root.innerHTML = '<div class="og-wrap"></div>';
      document.body.appendChild(root);
      const wrap = $('.og-wrap',root);

      owner.dateResolve = value => {
        owner.dateResolve = null;
        root.remove();
        resolve(value);
      };

      if (owner === lazy) setMoveCorner('lazy', 'waiting');

      function makePanel(name,strong,cls,buttons) {
        return `<section class="og-panel"><div class="og-head"><span>${name}</span><strong>${strong || '—'}</strong></div><div class="og-grid ${cls}">${buttons}</div></section>`;
      }

      function renderPicker() {
        const currentYear = new Date().getFullYear();
        const years = production
          ? Array.from({length:16},(_,i)=>currentYear-i)
          : Array.from({length:16},(_,i)=>currentYear+i);
        const monthName = MONTHS.find(([,v])=>v===selection.month)?.[0] || '—';
        const monthButtons = MONTHS.map(([label,v])=>`<button data-a="month" data-v="${v}" class="${selection.month===v?'selected':''}">${label}</button>`).join('');
        const dayButtons = Array.from({length:31},(_,i)=>i+1).map(v=>`<button data-a="day" data-v="${v}" class="${selection.day===v?'selected':''}" ${!selection.month||v>maxDay(selection.month)?'disabled':''}>${v}</button>`).join('');
        const yearButtons = years.map(v=>{
          const ms = validDate(selection.month,selection.day,v);
          const disabled = !selection.month || !selection.day || !ms ||
            (production ? !pastOrToday(ms) : !futureOrToday(ms));
          return `<button data-a="year" data-v="${v}" class="${selection.year===v?'selected':''}" ${disabled?'disabled':''}>${v}</button>`;
        }).join('');

        const itemTitle = clean(ctx?.sku?.title || ctx?.sku?.normalizedTitle || '');
        const imageUrl = productImageUrl(ctx);
        wrap.innerHTML =
          `<div class="og-id"><div>${esc(ctx.asin || '?')} / ${esc(ctx.fnsku || ctx.barcode)}</div><div>REQUIRES ${production?'PRODUCTION':'EXPIRATION'} DATE</div></div>` +
          `<div class="og-item-preview">` +
            (imageUrl
              ? `<img class="og-item-img" src="${esc(imageUrl)}" alt="">`
              : `<div class="og-item-img"></div>`) +
            `<div>` +
              `<div class="og-item-title">${esc(itemTitle || 'Item title unavailable')}</div>` +
              `<div class="og-item-meta">` +
                `<div class="og-meta-row"><span class="og-meta-label">ASIN</span><span>${esc(ctx.asin || '—')}</span></div>` +
                `<div class="og-meta-row"><span class="og-meta-label">FNSKU</span><span>${esc(ctx.fnsku || '—')}</span></div>` +
                `<div class="og-meta-row"><span class="og-meta-label">SCAN</span><span class="og-scan-code">${esc(item.code || ctx.barcode || '—')}</span></div>` +
              `</div>` +
            `</div>` +
          `</div>` +
          `<div class="og-grid-wrap">` +
            makePanel('MONTH',monthName,'og-month',monthButtons) +
            makePanel('DAY',selection.day ? String(selection.day).padStart(2,'0') : '—','og-day',dayButtons) +
            makePanel('YEAR',selection.year || '—','og-year',yearButtons) +
          `</div>` +
          `<div class="og-footer">${
            production
              ? `<button class="production-confirm" data-a="apply" ${selection.month&&selection.day&&selection.year?'':'disabled'}>USE PRODUCTION DATE</button>`
              : `<button data-a="pao">PAO +900 DAYS &nbsp; ${dateLabel(paoDateMs())}</button>`
          }<button type="button" class="og-return-source" data-return-source>↩ RETURN TO SOURCE</button></div>`;
      }

      root.addEventListener('click',e=>{
        const b=e.target.closest('button[data-a]');
        if(!b||b.disabled)return;
        const a=b.dataset.a,v=Number(b.dataset.v);

        if(a==='month'){selection.month=v;selection.day=1;selection.year=null;renderPicker();return;}
        if(a==='day'){selection.day=v;selection.year=null;renderPicker();return;}
        if(a==='year'){
          selection.year=v;
          if(!production){
            const entered=validDate(selection.month,selection.day,selection.year);
            if(!entered||!futureOrToday(entered))return;
            owner.dateResolve?.({enteredMs:entered,finalExpirationMs:entered});
            return;
          }
          renderPicker();
          return;
        }
        if(a==='apply'){
          const entered=validDate(selection.month,selection.day,selection.year);
          if(!entered || !pastOrToday(entered))return;
          const finalExpirationMs=entered+Number(ctx.dateDetail?.shelfLife||0);
          owner.dateResolve?.({enteredMs:entered,finalExpirationMs});
          return;
        }
        if(a==='pao'){
          const entered=paoDateMs();
          owner.dateResolve?.({enteredMs:entered,finalExpirationMs:entered});
        }
      });

      renderPicker();
    });
  }

  function nativeExpiryInputs() {
    const inputs = appElements('input,textarea').filter(el => {
      if (!enabled(el)) return false;
      const type = norm(el.type || 'text');
      return !type || ['text','tel','number','search'].includes(type);
    });

    const hint = el => norm(
      `${el.name || ''} ${el.id || ''} ${el.placeholder || ''} ${el.getAttribute('aria-label') || ''}`
    );

    const month = inputs.find(el => /\b(mm|month)\b/.test(hint(el)));
    const day = inputs.find(el => /\b(dd|day)\b/.test(hint(el)));
    const year = inputs.find(el => /\b(yyyy|year)\b/.test(hint(el)));

    if (month && day && year) return { month, day, year };

    if (inputs.length >= 3) return { month:inputs[0], day:inputs[1], year:inputs[2] };
    return null;
  }

  function nativeExpiryProductInfo() {
    const ignored = /^(menu|change container|back to source|source container|item issue|expiry date missing|production date missing|confirm|enter expiry|enter expiration|enter production)/i;

    const textCandidates = appElements('a,h1,h2,h3,h4,strong')
      .filter(visible)
      .map(el => clean(el.innerText || el.textContent))
      .filter(v => v.length >= 18 && !ignored.test(v))
      .sort((a,b) => b.length - a.length);

    const title = textCandidates[0] || '';

    const imageUrls = [];
    const seen = new Set();

    const pushImage = raw => {
      const url = normalizeImageUrl(raw);
      if (!url || seen.has(url)) return;
      seen.add(url);
      imageUrls.push(url);
    };

    const images = appElements('img')
      .map(img => ({ img, rect:img.getBoundingClientRect() }))
      .filter(x => visible(x.img) || x.rect.width >= 25 || x.rect.height >= 25)
      .sort((a,b) => (b.rect.width*b.rect.height) - (a.rect.width*a.rect.height));

    for (const {img} of images) {
      pushImage(img.currentSrc);
      pushImage(img.src);
      pushImage(img.getAttribute('src'));
      pushImage(img.getAttribute('data-src'));
      pushImage(img.getAttribute('data-original'));

      const srcset = clean(img.getAttribute('srcset'));
      if (srcset) {
        for (const candidate of srcset.split(',')) {
          pushImage(candidate.trim().split(/\s+/)[0]);
        }
      }
    }

    const pageText = nativePageText();
    let asin = (pageText.match(/\basin\s*:?\s*([a-z0-9]{10})\b/i) || [])[1]?.toUpperCase() || '';
    let fnsku = (pageText.match(/\bfnsku\s*:?\s*([a-z0-9]{10})\b/i) || [])[1]?.toUpperCase() || '';
    let barcode = (pageText.match(/\b(?:barcode|scan(?:ned)?)\s*:?\s*([a-z0-9_-]{8,24})\b/i) || [])[1]?.toUpperCase() || '';

    if (!asin) {
      for (const link of appElements('a[href]')) {
        const href = clean(link.getAttribute('href'));
        const match = href.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?#]|$)/i);
        if (match) {
          asin = match[1].toUpperCase();
          break;
        }
      }
    }

    return {
      title,
      imageUrls,
      imageUrl:imageUrls[0] || '',
      asin,
      fnsku,
      barcode
    };
  }

  function mergeNativeExpiryProductInfo(oldInfo, freshInfo) {
    const imageUrls = [...new Set([
      ...(oldInfo?.imageUrls || []),
      ...(freshInfo?.imageUrls || [])
    ].filter(Boolean))];

    return {
      title:freshInfo?.title || oldInfo?.title || '',
      asin:freshInfo?.asin || oldInfo?.asin || '',
      fnsku:freshInfo?.fnsku || oldInfo?.fnsku || '',
      barcode:freshInfo?.barcode || oldInfo?.barcode || '',
      imageUrls,
      imageUrl:imageUrls[0] || ''
    };
  }

  function nativeExpiryDateParts(ms) {
    const d = new Date(ms);
    return {
      mm:String(d.getMonth()+1).padStart(2,'0'),
      dd:String(d.getDate()).padStart(2,'0'),
      yyyy:String(d.getFullYear())
    };
  }

  async function submitNativeExpiryDate(ms) {
    if (shared.expiryBusy) return false;
    const token = ++expiryRequestSeq;
    shared.expiryBusy = true;

    try {
      const inputs = await waitFor(() => token === expiryRequestSeq && screen() === 'EXPIRY' && nativeExpiryInputs(), 4500, 40);
      if (!inputs || token !== expiryRequestSeq) return false;

      const parts = nativeExpiryDateParts(ms);

      for (const [input,value] of [
        [inputs.month,parts.mm],
        [inputs.day,parts.dd],
        [inputs.year,parts.yyyy]
      ]) {
        if (token !== expiryRequestSeq) return false;
        input.focus();
        input.select?.();
        setValue(input,'');
        await sleep(18);
        if (token !== expiryRequestSeq) return false;
        setValue(input,value);
        input.dispatchEvent(new Event('blur',{bubbles:true}));
        await sleep(28);
      }

      await sleep(60);
      if (token !== expiryRequestSeq) return false;

      const confirm = confirmButton();
      if (enabled(confirm)) click(confirm);
      else enter(inputs.year);

      return true;
    } finally {
      if (token === expiryRequestSeq) setTimeout(() => { shared.expiryBusy = false; }, 250);
    }
  }

  function showNativeExpiryPicker() {
    if (Date.now() < nativeExpirySuppressedUntil || lazy.running || shared.expiryBusy || $('#sh-og-expiry') || screen() !== 'EXPIRY') return;

    const selection = { month:null, day:1, year:null };
    let info = nativeExpiryProductInfo();

    const root = document.createElement('div');
    root.id = 'sh-og-expiry';
    root.dataset.mode = 'native';
    root.innerHTML = '<div class="og-wrap"></div>';
    document.body.appendChild(root);
    const wrap = $('.og-wrap',root);

    const makePanel = (name,strong,cls,buttons) =>
      `<section class="og-panel"><div class="og-head"><span>${name}</span><strong>${strong || '—'}</strong></div><div class="og-grid ${cls}">${buttons}</div></section>`;

    function renderPicker() {
      const currentYear = new Date().getFullYear();
      const years = Array.from({length:16},(_,i)=>currentYear+i);
      const monthName = MONTHS.find(([,v])=>v===selection.month)?.[0] || '—';

      const monthButtons = MONTHS.map(([label,v]) =>
        `<button data-a="month" data-v="${v}" class="${selection.month===v?'selected':''}">${label}</button>`
      ).join('');

      const dayButtons = Array.from({length:31},(_,i)=>i+1).map(v =>
        `<button data-a="day" data-v="${v}" class="${selection.day===v?'selected':''}" ${!selection.month||v>maxDay(selection.month)?'disabled':''}>${v}</button>`
      ).join('');

      const yearButtons = years.map(v => {
        const ms = validDate(selection.month,selection.day,v);
        const disabled = !selection.month || !selection.day || !ms || !futureOrToday(ms);
        return `<button data-a="year" data-v="${v}" class="${selection.year===v?'selected':''}" ${disabled?'disabled':''}>${v}</button>`;
      }).join('');

      const meta =
        `<div class="og-meta-row"><span class="og-meta-label">ASIN</span><span>${esc(info.asin || '—')}</span></div>` +
        `<div class="og-meta-row"><span class="og-meta-label">FNSKU</span><span>${esc(info.fnsku || '—')}</span></div>` +
        (info.barcode
          ? `<div class="og-meta-row"><span class="og-meta-label">SCAN</span><span class="og-scan-code">${esc(info.barcode)}</span></div>`
          : `<div class="og-meta-row"><span class="og-meta-label">SCAN</span><span>Not exposed by native Sideline</span></div>`);

      wrap.innerHTML =
        `<div class="og-id"><div>REQUIRES EXPIRATION DATE</div></div>` +
        `<div class="og-item-preview">` +
          `<img class="og-item-img" data-role="native-product-image" ${info.imageUrl ? `src="${esc(info.imageUrl)}"` : ''} alt="" style="${info.imageUrl ? '' : 'visibility:hidden'}">` +
          `<div>` +
            `<div class="og-item-title">${esc(info.title || 'Loading item details…')}</div>` +
            `<div class="og-item-meta">${meta}</div>` +
          `</div>` +
        `</div>` +
        `<div class="og-grid-wrap">` +
          makePanel('MONTH',monthName,'og-month',monthButtons) +
          makePanel('DAY',selection.day ? String(selection.day).padStart(2,'0') : '—','og-day',dayButtons) +
          makePanel('YEAR',selection.year || '—','og-year',yearButtons) +
        `</div>` +
        `<div class="og-footer og-footer-single"><button data-a="pao">PAO +900 DAYS &nbsp; ${dateLabel(paoDateMs())}</button></div>`;

      const image = $('[data-role="native-product-image"]', root);
      if (image) {
        let imageIndex = Math.max(0, info.imageUrls.indexOf(image.getAttribute('src')));

        image.addEventListener('load', () => {
          image.style.visibility = 'visible';
        }, { once:true });

        image.addEventListener('error', () => {
          imageIndex++;
          if (imageIndex < info.imageUrls.length) {
            image.src = info.imageUrls[imageIndex];
          } else {
            image.style.visibility = 'hidden';
          }
        });
      }
    }

    root.addEventListener('click', async e => {
      const b = e.target.closest('button[data-a]');
      if (!b || b.disabled) return;

      e.preventDefault();
      e.stopPropagation();

      const a = b.dataset.a;
      const v = Number(b.dataset.v);

      if (a === 'month') {
        selection.month = v;
        selection.day = 1;
        selection.year = null;
        renderPicker();
        return;
      }

      if (a === 'day') {
        selection.day = v;
        selection.year = null;
        renderPicker();
        return;
      }

      if (a === 'year') {
        selection.year = v;
        const entered = validDate(selection.month,selection.day,selection.year);
        if (!entered || !futureOrToday(entered)) return;

        root.remove();
        await submitNativeExpiryDate(entered);
        return;
      }

      if (a === 'pao') {
        const entered = paoDateMs();
        root.remove();
        await submitNativeExpiryDate(entered);
      }
    }, true);

    renderPicker();

    for (const delay of [150, 400, 900, 1800, 3200]) {
      setTimeout(() => {
        if (!root.isConnected || screen() !== 'EXPIRY') return;

        const fresh = nativeExpiryProductInfo();
        const merged = mergeNativeExpiryProductInfo(info, fresh);

        const changed =
          merged.title !== info.title ||
          merged.asin !== info.asin ||
          merged.fnsku !== info.fnsku ||
          merged.barcode !== info.barcode ||
          merged.imageUrls.join('|') !== info.imageUrls.join('|');

        if (changed) {
          info = merged;
          renderPicker();
        }
      }, delay);
    }
  }

  function nativeExpiryTick() {
    if (Date.now() < nativeExpirySuppressedUntil || lazy.running) return;

    const root = $('#sh-og-expiry');
    const nativeRoot = root?.dataset?.mode === 'native';

    if (screen() === 'EXPIRY') {
      if (!root) showNativeExpiryPicker();
      return;
    }

    if (nativeRoot) root.remove();
  }

  async function safeClearSourceWhenDone() {
    if (!lClear.checked) return true;

    const previousOwner = shared.owner;
    shared.owner = 'lazy-clear';
    lazy.note = `clearing source ${lazy.src} by API`;
    lazy.error = '';
    renderLazy();

    try {
      await closeContainerDirect(lazy.src, true);
      return true;
    } catch (error) {
      lazy.error = error?.outcomeUnknown
        ? `Moves complete — source clear UNKNOWN: ${error?.message || error}`
        : `Moves complete — source clear failed: ${error?.message || error}`;
      return false;
    } finally {
      shared.owner = previousOwner;
    }
  }

  async function startLazy() {
    if (lazy.running) return;

    lazy.src = clean(lSrc.value);
    lazy.dest = clean(lDest.value);
    lazy.items = parseItems(lItems.value);
    lazy.index = 0;
    lazy.deferred = [];
    lazy.invalid = [];
    lazy.errors = 0;
    lazy.error = '';
    $('#sh-invalid-toast')?.remove();
    lazy.note = '';
    lazy.predicant = false;
    lazy.damagePaused = false;
    lazy.damagedDest = '';
    stopDamageAttention();
    if (lPause) lPause.textContent = 'Pause';

    if (!validContainer(lazy.src) || !validContainer(lazy.dest)) {
      lazy.error = 'SRC and DEST must start with csX or tsX.';
      renderLazy();
      return;
    }
    if (norm(lazy.src) === norm(lazy.dest)) {
      lazy.error = 'SRC and DEST cannot match.';
      renderLazy();
      return;
    }
    if (!lazy.items.length) {
      lazy.error = 'No item barcodes.';
      renderLazy();
      return;
    }

    // Ensure every current item is queued for scan-item pre-resolve before the run begins.
    // This still performs no movement; move-items remains gated below by explicit Start.
    queueLazyPreResolve(lazy.items);

    const run = beginLazyRun();

    lazy.running = true;
    lazy.paused = false;
    lazy.nextMoveAt = 0;
    lazy.inputCollapsed = true;
    shared.owner = 'lazy';
    setLazyRunningIndicator(true);
    lazy.note = 'validating source';
    renderLazy();

    try {
      const sourceResponse = await api(API_SCAN_SOURCE, scanSourcePayload(lazy.src), run);

      if (!currentLazyRun(run)) return;
      if (!sourceResponse || sourceResponse.success !== true) throw new Error('Source validation failed');

      lazy.sourceMeta = sourceResponse;
    } catch (error) {
      if (runWasCancelled(error, run)) return;

      resetLazyPreResolve();
      lazy.running = false;
      shared.owner = '';
      setLazyRunningIndicator(false);
      finishLazyRun(run);
      lazy.error = `Source error: ${error?.message || error}`;
      renderLazy();
      return;
    }
    const slots = lazy.items.map(() => {
      let resolve;
      const promise = new Promise(r => { resolve = r; });
      return { promise, resolve };
    });

    let nextLookupIndex = 0;

    const lookupWorker = async () => {
      while (currentLazyRun(run) && lazy.running) {
        while (
          currentLazyRun(run) &&
          lazy.running &&
          (lazy.paused || lazy.predicant || lazy.damagePaused)
        ) {
          await sleep(80);
        }

        if (!currentLazyRun(run) || !lazy.running) return;

        const index = nextLookupIndex++;
        if (index >= lazy.items.length) return;

        const result = await resolveOnly(lazy.items[index], run);
        slots[index].resolve(result);

        if (result?.kind === 'aborted') return;
      }
    };

    const workerCount = Math.min(LOOKUP_CONCURRENCY, lazy.items.length);
    const workers = Array.from({length:workerCount}, () => lookupWorker());

    for (let index=0; index<lazy.items.length && lazy.running && currentLazyRun(run); index++) {
      if (!await waitWhilePaused(run)) break;

      lazy.index = index;
      const item = lazy.items[index];
      lazy.note = `processing ${index + 1}/${lazy.items.length} | ${item.code}`;
      renderLazy();

      const result = await slots[index].promise;
      if (!currentLazyRun(run) || !lazy.running) break;

      if (result?.kind === 'date') {
        parkDeferredDate(item, result.ctx);
        continue;
      }

      if (result?.kind !== 'ready') continue;

      await moveResolved(item, result.ctx, null, run);
    }

    await Promise.allSettled(workers);

    if (!currentLazyRun(run) || !lazy.running) return;

    for (let i=0; i<lazy.deferred.length && lazy.running && currentLazyRun(run); i++) {
      if (!await waitWhilePaused(run)) break;

      const item = lazy.deferred[i];
      const ctx = item.ctx;
      lazy.note = `DATE ${i+1}/${lazy.deferred.length} | ${ctx.asin || item.code}`;
      renderLazy();

      const chosen = await showApiDatePicker(item);
      if (!chosen || !lazy.running || !currentLazyRun(run)) break;

      await moveResolved(item, ctx, chosen.finalExpirationMs, run);
    }

    if (!currentLazyRun(run) || !lazy.running) return;

    lazy.running = false;
    lazy.paused = false;
    shared.owner = '';
    setLazyRunningIndicator(false);

    const skippedUnits = lazy.items
      .filter(item => item.status === 'SKIPPED')
      .reduce((sum,item) => sum + itemQty(item), 0);

    if (lazy.errors || skippedUnits) {
      const movedUnits = lazy.items
        .filter(item => item.status === 'MOVED')
        .reduce((sum,item) => sum + item.qty, 0);

      lazy.error = '';
      lazy.note = skippedUnits
        ? `complete | moved ${movedUnits} qty | skipped ${skippedUnits} removed qty | source left open`
        : `complete | moved ${movedUnits} qty to ${lazy.dest}`;
      finishLazyRun(run);
      finishMoveCorner('lazy', false);
      renderLazy();
      return;
    }

    const clearOk = await safeClearSourceWhenDone();
    if (lClear.checked && !clearOk) {
      lazy.note = 'complete';
      finishLazyRun(run);
      finishMoveCorner('lazy', false);
      renderLazy();
      return;
    }

    lazy.note = 'complete';
    finishLazyRun(run);
    finishMoveCorner('lazy', true);
    renderLazy();

    const finalNote = lazy.note;
    setTimeout(() => {
      if (lazy.running || lazy.activeRun) return;
      lazy.src = '';
      lazy.dest = '';
      lazy.sourceMeta = null;
      lazy.items = [];
      lazy.deferred = [];
      lazy.index = 0;
      lazyProgressShape = '';
      lSrc.value = '';
      lDest.value = '';
      lItems.value = '';
      lSrc.classList.remove('good','bad');
      lDest.classList.remove('good','bad');
      lazy.note = finalNote;
      renderLazy();
      lSrc.focus();
    }, 180);
  }

  lazyPanel.onclick = e => {
    const actionTarget = e.target.closest?.('[data-a]');
    if (!actionTarget || !lazyPanel.contains(actionTarget)) return;
    const a = actionTarget.dataset.a;
    if (!a) return;

    if (a === 'toggle-items') {
      setLazyInputCollapsed(!lazy.inputCollapsed, { focusItems: lazy.inputCollapsed });
      return;
    }

    if (a === 'start') startLazy();

    if (a === 'copy-failed') {
      const failed = lazy.items.filter(item => item.status === 'INVALID' || item.status === 'FAILED');
      const lines = [];
      for (const item of failed) {
        for (let i = 0; i < itemQty(item); i++) lines.push(item.code);
      }

      if (!lines.length) {
        lazy.note = 'no failed barcodes to copy';
        renderLazy();
        return;
      }

      const payload = lines.join('\n');

      navigator.clipboard.writeText(payload).then(() => {
        lazy.note = `copied ${lines.length} failed barcode${lines.length===1?'':'s'}`;
        renderLazy();
      }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = payload;
        ta.style.position = 'fixed';
        ta.style.left = '-99999px';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
          lazy.note = `copied ${lines.length} failed barcode${lines.length===1?'':'s'}`;
        } catch {
          lazy.error = 'Could not copy failed barcodes.';
        }
        ta.remove();
        renderLazy();
      });
      return;
    }

    if (a === 'pause') {
      if (!lazy.running || lazy.predicant) return;

      if (lazy.damagePaused && lazy.paused) {
        const nextDest = clean(lDest.value);

        if (!validContainer(nextDest) || norm(nextDest) === norm(lazy.src)) {
          lazy.error = 'DAMAGED DESTINATION PAUSE — enter a valid NEW destination before Resume.';
          lDest.classList.add('bad');
          startDamageAttention(lazy.damagedDest || lazy.dest);
          renderLazy();
          return;
        }

        if (norm(nextDest) === norm(lazy.damagedDest)) {
          lazy.error = `DESTINATION ${nextDest} is damaged — use a different destination before Resume.`;
          lDest.classList.add('bad');
          startDamageAttention(nextDest);
          renderLazy();
          return;
        }

        const skippedUnits = markLazyRemovedItemsOnResume();
        lazy.dest = nextDest;
        lazy.damagePaused = false;
        lazy.damagedDest = '';
        lazy.paused = false;
        lazy.error = '';
        lazy.note = skippedUnits
          ? `resumed with new destination ${lazy.dest} | skipped ${skippedUnits} removed qty`
          : `resumed with new destination ${lazy.dest}`;
        lDest.classList.remove('bad');
        lDest.classList.add('good');
        actionTarget.textContent = 'Pause';
        stopDamageAttention();
        setLazyRunningIndicator(true);
        renderLazy();
        return;
      }

      if (lazy.paused) {
        const skippedUnits = markLazyRemovedItemsOnResume();
        lazy.paused = false;
        actionTarget.textContent = 'Pause';
        lazy.note = skippedUnits ? `resumed | skipped ${skippedUnits} removed qty` : 'resumed';
        setLazyRunningIndicator(true);
      } else {
        lazy.paused = true;
        actionTarget.textContent = 'Resume';
        lazy.note = 'paused';
      }
      renderLazy();
    }

    if (a === 'stop') {
      cancelLazyRun();
      resetLazyPreResolve();
      clearMoveCorner('lazy');
      lazy.running = false;
      lazy.paused = false;
      lazy.predicant = false;
      lazy.damagePaused = false;
      lazy.damagedDest = '';
      stopDamageAttention();
      if (lPause) lPause.textContent = 'Pause';
      lazy.predicantResolve?.();
      lazy.predicantResolve = null;
      lazy.dateResolve?.(null);
      lazy.dateResolve = null;
      $('#sh-og-expiry')?.remove();
      setLazyRunningIndicator(false);
      shared.owner = '';
      lazy.note = 'stopped';
      renderLazy();
    }

    if (a === 'clear-source') {
      lClear.checked = !lClear.checked;
      localStorage.setItem(CLEAR_SOURCE_KEY, lClear.checked ? '1' : '0');
      lazy.note = lClear.checked ? 'clear source ON' : 'clear source OFF';
      renderLazy();
      return;
    }

    if (a === 'delay') {
      lazy.delayEnabled = !lazy.delayEnabled;
      if (!lazy.delayEnabled) lazy.nextMoveAt = 0;
      localStorage.setItem(LAZY_DELAY_KEY, lazy.delayEnabled ? '1' : '0');
      lazy.note = lazy.delayEnabled ? 'artificial delay ON — 2–8s' : 'artificial delay OFF';
      renderLazy();
      return;
    }

    if (a === 'reset') resetLazy('reset');
  };

  function stopLazyForReturn(note) {
    const wasActive = !!(lazy.running || lazy.activeRun || lazy.predicant || lazy.damagePaused || lazy.dateResolve);
    const current = wasActive ? lazy.items[lazy.index] : null;
    if (current && !['MOVED','FAILED','INVALID'].includes(current.status)) {
      current.status = 'ABANDONED';
      current.failReason = 'RETURN TO SOURCE — ABANDONED';
    }

    cancelLazyRun();
    resetLazyPreResolve();
    clearMoveCorner('lazy');
    lazy.running = false;
    lazy.paused = false;
    lazy.predicant = false;
    lazy.damagePaused = false;
    lazy.damagedDest = '';
    lazy.inputCollapsed = false;
    clearLazyCollapsedScanBuffer();
    stopDamageAttention();
    if (lPause) lPause.textContent = 'Pause';
    lazy.predicantResolve?.();
    lazy.predicantResolve = null;
    lazy.dateResolve?.(null);
    lazy.dateResolve = null;
    lazy.error = '';
    lazy.note = note;
    setLazyRunningIndicator(false);
    renderLazy();
  }

  async function returnNativeToSourceContainer(sourceCode) {
    screenDirty = true;

    if (sourceCode) {
      const returned = await nativeReturnToOriginalSource(sourceCode);
      if (returned) return 'original source';
    }

    if (screen() === 'SOURCE' && scanInput()) return 'source scan';

    const back = backToSourceButton();
    if (back) {
      click(back);
      const outcome = await waitFor(() => {
        screenDirty = true;
        if (sourceCode && norm(loadedSourceContainer()) === norm(sourceCode) && screen() === 'ITEM') return 'original source';
        if (screen() === 'SOURCE' && scanInput()) return 'source scan';
        return null;
      }, 10000, 50);
      if (outcome) return outcome;
    }

    const change = changeButton();
    if (change) {
      click(change);
      const no = await waitFor(() => modalButton('no'), 4000, 35);
      if (no) {
        click(no);
        if (await waitForNativeSourceScan(10000)) return 'source scan';
      }
    }

    return await waitForNativeSourceScan(1800) ? 'source scan' : '';
  }

  function returnModeFromButton(button) {
    const expiryRoot = button.closest?.('#sh-og-expiry');
    if (expiryRoot) {
      if (lazy.running || lazy.activeRun || lazy.predicant || lazy.damagePaused || lazy.dateResolve) return 'lazy';
      if (shared.owner === 'qty' || shared.owner === 'qty-clear') return 'qty';
      return 'native';
    }
    if (button.closest?.('#sh-lazy')) return 'lazy';
    if (button.closest?.('#sh-queue')) return 'queue';
    if (button.closest?.('#sh-qty')) return 'qty';
    return 'native';
  }

  function returnSourceCodeForMode(mode) {
    if (mode === 'lazy') return clean(lazy.src || loadedSourceContainer());
    return clean(loadedSourceContainer());
  }

  async function universalReturnToSource(mode='native') {
    if (returnSourceBusy) return;
    returnSourceBusy = true;

    const sourceCode = returnSourceCodeForMode(mode);
    const previousOwner = shared.owner;
    const dateOpen = !!$('#sh-og-expiry') || screen() === 'EXPIRY';

    if (dateOpen) {
      expiryRequestSeq++;
      nativeExpirySuppressedUntil = Date.now() + 5000;
    }

    if (mode === 'queue') {
      q.runSeq++;
      q.running = false;
      q.paused = false;
      renderQueue('returned to source');
    } else if (mode === 'qty') {
      qtyRequestSeq++;
      qtyClear.disabled = false;
      qtyStatus.textContent = 'Returning to source — quantity action cancelled';
    } else if (mode === 'lazy') {
      stopLazyForReturn('returned to source — current item abandoned');
    }

    $('#sh-og-expiry')?.remove();
    $('#sh-invalid-toast')?.remove();
    shared.expiryBusy = dateOpen;
    shared.owner = 'return-source';

    savePanelStates();
    applyPanels();

    try {
      const outcome = await returnNativeToSourceContainer(sourceCode);
      const message = outcome
        ? `returned to ${outcome}`
        : 'helper escaped — native source control not found';
      if (mode === 'lazy') {
        lazy.note = `${message} — queue/history preserved`;
        renderLazy();
      } else if (mode === 'queue') {
        renderQueue(message);
      } else if (mode === 'qty') {
        qtyStatus.textContent = message;
      }
    } catch (error) {
      const message = `RETURN TO SOURCE FAILED — ${error?.message || error}`;
      if (mode === 'lazy') {
        lazy.error = message;
        renderLazy();
      } else if (mode === 'queue') {
        qError.textContent = message;
      } else if (mode === 'qty') {
        qtyStatus.textContent = message;
      }
    } finally {
      if (dateOpen) shared.expiryBusy = false;
      if (shared.owner === 'return-source') {
        const ownerWasTarget =
          previousOwner === mode ||
          (mode === 'lazy' && /^lazy(?:-|$)/.test(previousOwner)) ||
          (mode === 'qty' && (previousOwner === 'qty' || previousOwner === 'qty-clear'));
        shared.owner = previousOwner && !ownerWasTarget ? previousOwner : '';
      }
      returnSourceBusy = false;
      screenDirty = true;
      requestPanelLayout();
      if (dateOpen) setTimeout(nativeExpiryTick, 5500);
    }
  }

  function handleUniversalReturnClick(event) {
    const button = event.target?.closest?.('[data-return-source]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    universalReturnToSource(returnModeFromButton(button));
  }

  function rpcPayload(data) {
    const payload = data?.payload ?? data?.args ?? data?.data ?? {};
    return payload && typeof payload === 'object' ? payload : {};
  }

  function pick(obj, keys, fallback='') {
    for (const key of keys) {
      const value = obj?.[key];
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return fallback;
  }

  function normalizeRpcItems(payload) {
    const raw = pick(payload, ['items','barcodes','itemBarcodes','codes','scans'], []);
    if (Array.isArray(raw)) return raw.map(value => typeof value === 'object' ? pick(value,['code','barcode','value'],'') : value).filter(Boolean);
    return String(raw || '').split(/[\r\n,\t ]+/).map(clean).filter(Boolean);
  }

  function setLazyFromRpc(payload) {
    const src = clean(pick(payload, ['source','src','sourceContainer','sourceContainerScannableId'], lSrc.value));
    const dest = clean(pick(payload, ['destination','dest','destinationContainer','destinationContainerScannableId'], lDest.value));
    const items = normalizeRpcItems(payload);
    const clearSource = pick(payload, ['clearSource','clearSourceWhenDone','emptySource'], undefined);
    const delay = pick(payload, ['delayEnabled','artificialDelay','useDelay','delay'], undefined);

    if (src) lSrc.value = src;
    if (dest) lDest.value = dest;
    if (items.length) lItems.value = items.join('\n');
    if (clearSource !== undefined) {
      lClear.checked = !!clearSource;
      localStorage.setItem(CLEAR_SOURCE_KEY, lClear.checked ? '1' : '0');
    }
    if (typeof delay === 'boolean') {
      lazy.delayEnabled = delay;
      if (!delay) lazy.nextMoveAt = 0;
      localStorage.setItem(LAZY_DELAY_KEY, delay ? '1' : '0');
    }
    refreshItems();
  }

  function lazyResult() {
    let moved = 0, failed = 0;
    for (const item of lazy.items) {
      const qty = itemQty(item);
      if (item.status === 'MOVED') moved += qty;
      else if (['FAILED','INVALID'].includes(item.status)) failed += qty;
    }
    return { moved, failed };
  }

  function queueResult() {
    return { processed:Math.min(q.index,q.list.length), total:q.list.length, failed:q.failed.length, errors:[...q.failed] };
  }

  async function waitForIdle(kind, timeout=20*60*1000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (kind === 'lazy' && !lazy.running && !lazy.activeRun && !lazy.predicant && !lazy.dateResolve && !lazy.damagePaused) return;
      if (kind === 'queue' && !q.running && !shared.queueBusy) return;
      await sleep(100);
    }
    throw new Error(`${kind} timed out`);
  }

  async function handleWorkerCommand(command, payload={}) {
    const cmd = String(command || '').toLowerCase();

    if (cmd === 'ping') return { version:VERSION };
    if (cmd === 'mode') return { mode:'lazy', delayEnabled:lazy.delayEnabled, queueRunning:q.running, lazyRunning:lazy.running };

    if (['reset','lazy.reset'].includes(cmd)) {
      q.runSeq++;
      q.running = false;
      q.paused = false;
      resetLazy('console reset');
      return {};
    }

    if (['lazy.delay','delay','settings.delay'].includes(cmd)) {
      const next = pick(payload, ['enabled','delayEnabled','artificialDelay','value'], !lazy.delayEnabled);
      lazy.delayEnabled = !!next;
      if (!lazy.delayEnabled) lazy.nextMoveAt = 0;
      localStorage.setItem(LAZY_DELAY_KEY, lazy.delayEnabled ? '1' : '0');
      renderLazy();
      return { delayEnabled:lazy.delayEnabled };
    }

    if (cmd === 'lazy.scan') {
      setLazyFromRpc(payload);
      const barcode = clean(pick(payload, ['barcode','item','code','scan'], ''));
      if (barcode) {
        const existing = lItems.value.trim();
        lItems.value = existing ? `${existing}\n${barcode}` : barcode;
        refreshItems();
      }
      queueLazyPreResolve(parseItems(lItems.value));
      return {};
    }

    if (cmd === 'lazy.run') {
      if (lazy.running) throw new Error('Lazy already running');
      setLazyFromRpc(payload);
      const before = lazy.runSeq;
      await startLazy();
      if (lazy.runSeq === before && !lazy.running) {
        if (lazy.error) throw new Error(lazy.error);
      }
      await waitForIdle('lazy');
      if (lazy.error && !lazyResult().moved) throw new Error(lazy.error);
      return lazyResult();
    }

    if (['queue.run','tote.run','totequeue.run'].includes(cmd)) {
      const raw = pick(payload, ['containers','totes','items','codes','value','text'], '');
      const list = Array.isArray(raw) ? raw : parseContainers(String(raw));
      q.runSeq++;
      q.list = Array.isArray(list) ? list.map(clean).filter(validContainer) : [];
      qText.value = q.list.join('\n');
      q.index = 0;
      q.failed = [];
      q.running = !!q.list.length;
      q.paused = false;
      renderQueue(q.running ? 'console start' : 'no containers');
      if (q.running) queuePump(q.runSeq);
      await waitForIdle('queue');
      return queueResult();
    }

    if (['queue.pause','tote.pause','totequeue.pause'].includes(cmd)) {
      q.paused = true;
      renderQueue('paused by console');
      return queueResult();
    }
    if (['queue.resume','tote.resume','totequeue.resume'].includes(cmd)) {
      q.paused = false;
      renderQueue('resumed by console');
      if (q.running) queuePump(q.runSeq);
      return queueResult();
    }
    if (['queue.stop','tote.stop','totequeue.stop'].includes(cmd)) {
      q.runSeq++;
      q.running = false;
      q.paused = false;
      if (shared.owner === 'queue') shared.owner = '';
      renderQueue('stopped by console');
      return queueResult();
    }

    throw new Error(`Unsupported Sideline command: ${command}`);
  }

  function postWorkerProgress(force=false) {
    if (!IS_WORKER_FRAME || window.parent === window) return;
    const total = lazy.items.reduce((sum,item)=>sum+itemQty(item),0);
    const done = lazy.items.reduce((sum,item)=>sum+(['MOVED','FAILED','INVALID','SKIPPED'].includes(item.status)?itemQty(item):0),0);
    const payload = {
      __sidelineRebuild:true,
      kind:'progress',
      data:{worker:'sideline',area:'sideline',loading:false,mode:lazy.running?'lazy':(q.running?'queue':'lazy'),current:Math.min(done,total),total}
    };
    const sig = JSON.stringify(payload.data);
    if (!force && postWorkerProgress.last === sig) return;
    postWorkerProgress.last = sig;
    window.parent.postMessage(payload, '*');
  }

  function bootWorkerFrame() {
    // UI nodes exist because the same engine is used, but are hidden in worker mode.
    refreshItems();
    window.addEventListener('message', async event => {
      const data = event.data;
      if (!data || data.__sidelineRebuild !== true || data.kind !== 'rpc') return;
      const id = data.id;
      try {
        const result = await handleWorkerCommand(data.command, data.payload || {});
        window.parent.postMessage({__sidelineRebuild:true,kind:'result',id,command:data.command,ok:true,result,error:'',version:VERSION}, '*');
      } catch (error) {
        window.parent.postMessage({__sidelineRebuild:true,kind:'result',id,command:data.command,ok:false,result:{},error:error?.message||String(error),version:VERSION}, '*');
      } finally {
        postWorkerProgress(true);
      }
    });
    setInterval(()=>postWorkerProgress(false), 250);
    window.parent.postMessage({__sidelineRebuild:true,kind:'ready',version:VERSION}, '*');
  }

  function bootConsoleBridge() {
    if (!location.hash.includes('iss-console')) return;
    const frame = document.createElement('iframe');
    frame.id = 'sideline-rebuild-worker-frame';
    frame.src = `${SIDELINE_ORIGIN}/#sideline-rebuild-worker`;
    frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-10000px;top:-10000px;border:0;opacity:0;pointer-events:none';
    document.documentElement.appendChild(frame);

    let seq = 0;
    const pending = new Map();
    const emit = message => window.postMessage(message, '*');
    const ready = () => emit({messageType:'ISS_CONSOLE_WORKER_READY',type:'ISS_CONSOLE_WORKER_READY',worker:'sideline',version:VERSION});

    function requestShape(data) {
      if (!data || typeof data !== 'object') return null;
      const worker = data.worker || data.targetWorker || data.data?.worker;
      if (worker !== 'sideline') return null;
      const command = data.command || data.data?.command;
      if (!command) return null;
      const type = String(data.messageType || data.type || '').toUpperCase();
      if (type.includes('RESULT') || type.includes('PROGRESS') || type.includes('READY')) return null;
      if (!(type.includes('RPC') || type.includes('COMMAND') || type.includes('REQUEST'))) return null;
      return { command, payload:rpcPayload(data), requestId:data.requestId ?? data.rpcId ?? data.id ?? data.data?.requestId ?? null };
    }

    window.addEventListener('message', event => {
      const data = event.data;
      if (event.source === frame.contentWindow && data?.__sidelineRebuild) {
        if (data.kind === 'ready') { ready(); return; }
        if (data.kind === 'progress') {
          emit({messageType:'ISS_CONSOLE_WORKER_PROGRESS',type:'ISS_CONSOLE_WORKER_PROGRESS',...data.data,version:VERSION});
          return;
        }
        if (data.kind === 'result') {
          const meta = pending.get(data.id) || {};
          pending.delete(data.id);
          emit({
            messageType:'ISS_CONSOLE_RPC_RESULT', type:'ISS_CONSOLE_RPC_RESULT', worker:'sideline', version:VERSION,
            requestId:meta.requestId, rpcId:meta.requestId, id:meta.requestId,
            command:data.command, ok:!!data.ok, result:data.result || {}, error:data.error || ''
          });
          return;
        }
      }

      if (event.source !== window) return;
      const req = requestShape(data);
      if (!req) return;
      const id = ++seq;
      pending.set(id, req);
      frame.contentWindow?.postMessage({__sidelineRebuild:true,kind:'rpc',id,command:req.command,payload:req.payload}, SIDELINE_ORIGIN);
    });

    frame.addEventListener('load', () => setTimeout(ready, 200));
  }

  // Boot
  function boot() {
    document.addEventListener('click', handleUniversalReturnClick, true);
    mountDock();
    applyPanels();
    refreshItems();

    const isHelperMutationTarget = node => {
      const el = node?.nodeType === 1 ? node : node?.parentElement;
      return !!el?.closest?.(helperSelector);
    };

    let expiryRaf = 0;
    let recoveryTimer = 0;
    let recoveryUntil = 0;
    const scheduleNativeExpiry = () => {
      if (expiryRaf) return;
      expiryRaf = requestAnimationFrame(() => {
        expiryRaf = 0;
        nativeExpiryTick();
      });
    };

    const armRecoveryWatchdog = (durationMs = 12000) => {
      recoveryUntil = Math.max(recoveryUntil, Date.now() + durationMs);
      if (recoveryTimer) return;
      const poll = () => {
        recoveryTimer = 0;
        screenDirty = true;
        nativeExpiryTick();
        if (Date.now() < recoveryUntil) recoveryTimer = setTimeout(poll, 500);
      };
      recoveryTimer = setTimeout(poll, 500);
    };

    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (isHelperMutationTarget(mutation.target)) continue;
        if (mutation.type === 'childList' && mutation.addedNodes.length) {
          const nativeAdded = [...mutation.addedNodes].some(node => !isHelperMutationTarget(node));
          if (!nativeAdded) continue;
        }
        screenDirty = true;
        scheduleNativeExpiry();
        break;
      }
    });

    observer.observe(document.body,{
      subtree:true,
      childList:true,
      characterData:true,
      attributes:true,
      attributeFilter:['hidden','aria-hidden']
    });

    const recoverAfterInteraction = event => {
      const target = event.target;
      if (target instanceof Element && target.closest(helperSelector)) return;
      armRecoveryWatchdog();
    };
    for (const type of ['keydown', 'input', 'change', 'click']) {
      document.addEventListener(type, recoverAfterInteraction, true);
    }
    window.addEventListener('pageshow', () => armRecoveryWatchdog(15000));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) armRecoveryWatchdog(8000);
    });
    window.addEventListener('pagehide', () => {
      observer.disconnect();
      if (expiryRaf) cancelAnimationFrame(expiryRaf);
      clearTimeout(recoveryTimer);
    }, { once:true });

    armRecoveryWatchdog(15000);
  }

  const launch = () => IS_WORKER_FRAME ? bootWorkerFrame() : boot();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',launch,{once:true});
  else launch();
})();