// ==UserScript==
// @name         MAIN v0.3.6 Sideline API Move TEST
// @namespace    https://github.com/1Sirkkris
// @version      0.3.6
// @description  Sideline helper: Tote, Scrub, QTY, Lazy and Live workflows.
// @match        https://aft-poirot-website-nrt.nrt.proxy.amazon.com/*
// @run-at       document-end
// @grant        none
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Sideline_API_Move.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Sideline_API_Move.user.js
// ==/UserScript==

(() => {
  'use strict';
  if (window.__sidelineApiMoveTest_v0201) return;
  window.__sidelineApiMoveTest_v0201 = true;

  const VERSION = '0.3.6';
  const TOOL = 'V3';
  const START_TRIGGER = '123START';
  const LOOKUP_CONCURRENCY = 3;
  const LIVE_LOOKUP_CONCURRENCY = 3;
  const LIVE_MOVE_DELAY_MIN_MS = 5000;
  const LIVE_MOVE_DELAY_MAX_MS = 11000;
  const PANEL_STATE_KEY = 'sidelineClean.panelStates.v1';
  const CLEAR_SOURCE_KEY = 'sidelineApiLazy.clearSource';
  const API_SCAN_SOURCE = '/api/scan-source-container';
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

  const helperSelector = '#sh-dock,#sh-queue,#sh-scrub,#sh-qty,#sh-lazy,#sh-live,#sh-scrub-warning,#sh-og-expiry,#sh-invalid-toast,#sh-lazy-running-indicator,#sh-move-corner';
  const shared = { owner:'', scrubBusy:false, queueBusy:false, expiryBusy:false };
  let escapeEpoch = 0;
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

  function customerBoundSourceMessage() {
    const text = nativePageText();
    return (
      text.includes('cannot be used due to customer bound shipment') ||
      text.includes('customer bound shipment')
    );
  }

  async function waitForNativeSourceScan(timeout=12000) {
    return !!await waitFor(() => screen() === 'SOURCE' && scanInput(), timeout, 50);
  }

  async function waitForNativeLoadedSource(code, timeout=12000) {
    const expected = norm(code);
    return !!await waitFor(() =>
      norm(loadedSourceContainer()) === expected &&
      screen() !== 'SOURCE' &&
      !!changeButton(),
      timeout,
      50
    );
  }

  async function nativeOpenSourceContainer(code, label) {
    if (!await waitForNativeSourceScan(12000)) {
      throw new Error(`Scan source was not ready for ${label}.`);
    }

    if (!await fillAndConfirm(code, 'SOURCE')) {
      throw new Error(`Could not scan ${label} ${code}.`);
    }

    if (!await waitForNativeLoadedSource(code, 12000)) {
      throw new Error(`${label} ${code} did not open as source.`);
    }
  }

  async function nativeCloseLoadedContainer(label, emptyChoice) {
    const wanted = emptyChoice ? 'yes' : 'no';
    const change = await waitFor(changeButton, 5000, 40);
    if (!change) throw new Error(`Could not find Change container for ${label}.`);

    click(change);

    let outcome = await waitFor(() => {
      if (screen() === 'SOURCE' && scanInput()) return { type:'closed' };
      const choice = modalButton(wanted);
      if (choice) return { type:'choice', choice };
      return null;
    }, 2200, 45);

    if (!outcome) {
      const retryChange = changeButton();
      if (retryChange) {
        click(retryChange);
        outcome = await waitFor(() => {
          if (screen() === 'SOURCE' && scanInput()) return { type:'closed' };
          const choice = modalButton(wanted);
          if (choice) return { type:'choice', choice };
          return null;
        }, 2200, 45);
      }
    }

    if (!outcome) {
      throw new Error(`Could not close ${label}: no ${emptyChoice ? 'YES/NO prompt' : 'NO prompt'} and did not return to Scan Source.`);
    }

    if (outcome.type === 'closed') return;

    click(outcome.choice);

    if (!await waitForNativeSourceScan(12000)) {
      throw new Error(`Timed out after closing ${label} with ${emptyChoice ? 'YES' : 'NO'}.`);
    }
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

  async function normalizeNativeToSourceScan(status) {
    if (await waitForNativeSourceScan(700)) return true;

    const back = backToSourceButton();
    if (back) {
      status('Predicant recovery — returning to source screen...');
      click(back);
      await sleep(120);

      if (await waitForNativeSourceScan(900)) return true;
    }

    const change = changeButton();
    if (change) {
      status('Predicant recovery — closing current native container with NO...');
      click(change);

      const no = await waitFor(() => modalButton('no'), 5000, 35);
      if (!no) throw new Error('Could not find NO while resetting native Sideline screen.');

      click(no);

      if (await waitForNativeSourceScan(12000)) return true;
    }

    if (await waitForNativeSourceScan(2500)) return true;

    return false;
  }

  async function runExactPredicantRecovery(sourceCode, destinationCode, status) {

    status('Predicant recovery 1/4 — preparing native Sideline...');

    let sourceOpen = await nativeReturnToOriginalSource(sourceCode);

    if (!sourceOpen) {
      const ready = await normalizeNativeToSourceScan(status);
      if (!ready) {
        throw new Error('Could not return native Sideline to Scan Source.');
      }

      status(`Predicant recovery 1/4 — opening source ${sourceCode}...`);
      await nativeOpenSourceContainer(sourceCode, 'original source');
      sourceOpen = true;
    }

    status('Predicant recovery 2/4 — closing original source with NO...');
    await nativeCloseLoadedContainer('original source', false);

    status(`Predicant recovery 3/4 — opening destination ${destinationCode}...`);
    await nativeOpenSourceContainer(destinationCode, 'destination');

    status(`Predicant recovery 4/4 — emptying destination ${destinationCode} with YES...`);
    await nativeCloseLoadedContainer('destination', true);

    return true;
  }

  // UI
  const style = document.createElement('style');
  style.textContent = `
#sh-dock{position:fixed;right:14px;bottom:12px;z-index:2147483647;display:grid;grid-template-columns:repeat(5,1fr);gap:6px;width:382px;padding:6px;background:#fff;border:1px solid #c7d0dd;box-shadow:0 2px 8px #0003;font:12px Arial,sans-serif}
#sh-dock button,.sh-btn{border:1px solid #aeb8c5;border-radius:3px;padding:8px 6px;font-weight:700;cursor:pointer;background:#f5f7fa;color:#1f2937}.sh-on{background:#146eb4!important;color:#fff!important;border-color:#0f5c99!important}
.sh-panel{position:fixed;right:14px;bottom:58px;z-index:2147483646;width:460px;max-width:calc(100vw - 28px);box-sizing:border-box;padding:10px;background:#fff;border:1px solid #c7d0dd;box-shadow:0 2px 8px #0003;font:12px Arial,sans-serif;color:#111827}.sh-title{font-weight:800;margin:-10px -10px 8px;padding:9px 10px;background:#f3f5f8;border-bottom:1px solid #d5dbe3}
.sh-return-source{width:100%;margin:0 0 8px;padding:8px 10px!important;border:2px solid #146eb4!important;background:#eff6ff!important;color:#0f3d73!important;font-weight:1000!important}.sh-return-source:hover{background:#dbeafe!important}.sh-return-source-inline{margin-top:8px;width:100%;border:2px solid #146eb4!important;background:#eff6ff!important;color:#0f3d73!important;font-weight:1000!important}
#sh-lazy,#sh-live{max-height:calc(100vh - 76px);overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-gutter:stable}
.sh-grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.sh-grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.sh-input{width:100%;box-sizing:border-box;border:1px solid #b8c2cf;border-radius:3px;padding:8px;font:12px Arial,sans-serif}.sh-input.good{border-color:#16a34a}.sh-input.bad{border-color:#dc2626}.sh-area{height:88px;resize:vertical}.sh-status{margin-top:7px;font-weight:700;line-height:1.35}.sh-error{margin-top:4px;color:#b91c1c;font-weight:700}.sh-row{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:7px}
#sh-qty{left:14px;right:auto;width:332px}.sh-qty-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}.sh-qty-grid button{min-height:48px;font-size:17px}.sh-clear-tote{width:100%;margin-top:8px;background:#fff1f2!important;color:#991b1b!important;border-color:#fecaca!important}.sh-stop{background:#fff7ed!important;color:#9a3412!important;border-color:#fed7aa!important}
#sh-scrub-warning{position:fixed;left:0;right:0;bottom:0;z-index:2147483645;padding:11px 16px;text-align:center;font:900 15px Arial,sans-serif;letter-spacing:.4px;background:#b91c1c;color:#fff;border-top:3px solid #fff;animation:shWarn 1.2s steps(2,end) infinite;pointer-events:none}@keyframes shWarn{0%,100%{background:#b91c1c;color:#fff}50%{background:#fde047;color:#111}}
.sh-metrics{display:grid;grid-template-columns:repeat(2,1fr);gap:7px;margin:8px 0 4px}.sh-metric{border:1px solid #c7d0dd;background:#f8fafc;padding:8px 4px;text-align:center;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.2px}.sh-metric b{display:block;font-size:22px;line-height:1.05;margin-top:3px}.sh-notmoved-line{display:none;font-size:11px;color:#475569;text-align:right;margin:2px 1px 7px}.sh-notmoved-line.show{display:block}.sh-notmoved-line b{font-size:13px;color:#991b1b}.sh-lazy-input-summary{display:none;align-items:center;justify-content:space-between;gap:8px;margin:6px 0;padding:8px 10px;border:1px solid #cbd5e1;border-left:5px solid #146eb4;background:#f8fafc;border-radius:4px;font-weight:850;color:#334155}.sh-lazy-input-summary.show{display:flex}.sh-lazy-input-summary.auto{border-left-color:#16a34a;background:#f0fdf4;box-shadow:0 0 0 2px rgba(22,163,74,.10)}.sh-lazy-input-summary button{padding:5px 9px;border:1px solid #94a3b8;border-radius:4px;background:#fff;font-weight:800;cursor:pointer}.sh-lazy-collapsed{display:none!important}.sh-result-summary{display:none;margin:7px 0;border:1px solid #cbd5e1;border-radius:4px;background:#f8fafc;overflow:hidden}.sh-result-summary.show{display:block}.sh-result-ok{padding:8px 9px;background:#eff6ff;color:#0f3d73;font-weight:900}.sh-result-bad{padding:8px 9px;background:#fff7f7;color:#991b1b;font-weight:900;font-size:13px;line-height:1.35;border-top:1px solid #fecaca;border-left:6px solid #dc2626}.sh-result-bad-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}.sh-result-bad-title{font-size:13px;font-weight:1000}.sh-result-bad code{font:900 13px Consolas,monospace;color:#7f1d1d}.sh-failed-actions{display:flex;gap:6px}.sh-failed-actions button{padding:6px 9px;border:1px solid #ef4444;background:#fff;color:#991b1b;border-radius:3px;font-weight:900;cursor:pointer}.sh-failed-list{margin-top:8px;border-top:1px solid #fecaca;padding-top:8px;display:grid;gap:8px}.sh-failed-card{padding:7px 8px;background:#fff;border:1px solid #fecaca;border-left:4px solid #ef4444;border-radius:4px}.sh-failed-top{font:1000 13px/1.2 Consolas,monospace;color:#7f1d1d;margin-bottom:5px}.sh-failed-grid{display:grid;grid-template-columns:auto 1fr;column-gap:7px;row-gap:3px;font-size:12px;line-height:1.25}.sh-failed-grid b{color:#7f1d1d}.sh-predicant-card{display:none;margin:8px 0;padding:10px 12px;border:3px solid #f59e0b;border-left:8px solid #dc2626;border-radius:6px;background:#fff7ed;color:#7c2d12;text-align:center;box-shadow:0 0 0 2px rgba(245,158,11,.12);animation:shPredicantPulse .85s ease-in-out infinite alternate}.sh-predicant-card.show{display:block}.sh-predicant-title{font-size:17px;font-weight:1000;line-height:1.15}.sh-predicant-dest{margin:6px 0 4px;padding:7px 8px;background:#fff;border:2px solid #dc2626;border-radius:4px;font:1000 18px Consolas,monospace;color:#7f1d1d;letter-spacing:.4px}.sh-predicant-help{font-size:12px;font-weight:900;line-height:1.35}.sh-predicant-help strong{font-size:13px}.sh-predicant-scan{outline:4px solid #f59e0b!important;box-shadow:0 0 0 5px rgba(245,158,11,.18)!important}@keyframes shPredicantPulse{from{background:#fff7ed;box-shadow:0 0 0 2px rgba(245,158,11,.10)}to{background:#fef3c7;box-shadow:0 0 0 6px rgba(245,158,11,.22)}}.sh-failure-pill{display:none;margin:6px 0 2px;padding:7px 9px;border:1px solid #ef4444;border-left:5px solid #dc2626;border-radius:4px;background:#fff1f2;color:#991b1b;font-weight:900;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sh-failure-pill.show{display:block}.sh-failure-pill:hover{background:#ffe4e6}.sh-progress{max-height:210px;overflow:auto;border-top:1px solid #d5dbe3;margin-top:8px;padding-top:6px;font-family:Consolas,monospace}.sh-item{padding:6px 7px;border-radius:3px;margin-bottom:3px;border:1px solid transparent}.sh-item.current{background:#fff3bf;border-color:#f59e0b;font-weight:900}.sh-item.moved{background:#eff6ff;color:#0f3d73;border-color:#bfdbfe;font-weight:800}.sh-item.failed{background:#fff1f2;color:#991b1b;border:2px solid #ef4444;border-left-width:6px;font-weight:900}.sh-item.parked{background:#fff7ed;color:#9a3412;border-color:#fed7aa;font-weight:800}.sh-item.retry{background:#fff7ed;color:#9a3412;border:2px solid #f59e0b;border-left-width:6px;font-weight:900}
#sh-lazy-footer{display:flex;justify-content:flex-end;align-items:center;margin-top:10px;padding-top:8px;border-top:1px solid #d5dbe3}#sh-lazy-footer label{display:flex;align-items:center;gap:5px;padding:7px 8px;border:1px solid #fed7aa;background:#fff7ed;color:#9a3412;border-radius:3px;font-weight:700}
#sh-invalid-toast{position:fixed;left:50%;top:88px;transform:translateX(-50%);z-index:2147483647;min-width:280px;max-width:min(520px,calc(100vw - 32px));padding:12px 48px 12px 14px;border:2px solid #ef4444;border-radius:5px;background:#fef2f2;color:#7f1d1d;box-shadow:0 4px 16px #0004;font:13px Arial,sans-serif}#sh-invalid-toast .title{font-weight:900;font-size:15px;margin-bottom:6px}#sh-invalid-toast .close{position:absolute;right:7px;top:7px;width:32px;height:32px;border:1px solid #ef4444;border-radius:4px;background:#fff;color:#991b1b;font-size:22px;font-weight:900;line-height:28px;cursor:pointer}
#sh-damage-alert{position:fixed;inset:0;z-index:2147483647;pointer-events:none;border:10px solid #dc2626;box-sizing:border-box;background:rgba(220,38,38,.08);animation:shDamageFlash .42s steps(2,end) 10}
#sh-damage-alert .sh-damage-box{position:absolute;left:50%;top:72px;transform:translateX(-50%);min-width:520px;max-width:calc(100vw - 40px);padding:16px 22px;text-align:center;background:#7f1d1d;color:#fff;border:5px solid #facc15;border-radius:8px;box-shadow:0 8px 28px #0008;font:900 22px/1.25 Arial,sans-serif;letter-spacing:.3px}
#sh-damage-alert .sh-damage-box small{display:block;margin-top:7px;font-size:14px;letter-spacing:0}
@keyframes shDamageFlash{0%,100%{background:rgba(220,38,38,.08);border-color:#dc2626}50%{background:rgba(250,204,21,.20);border-color:#facc15}}

#sh-live .sh-live-scan{font:900 18px Consolas,monospace;padding:12px;border:2px solid #146eb4}
#sh-live .sh-live-scan:disabled{background:#f3f4f6;border-color:#cbd5e1;color:#64748b}
#sh-live .sh-live-ready{margin:7px 0;padding:7px 9px;border:1px solid #bfdbfe;border-left:5px solid #146eb4;background:#eff6ff;color:#0f3d73;font-weight:900}
#sh-dock button.sh-live-one-mode{background:#fde047!important;color:#111827!important;border:3px solid #111827!important;padding:6px 4px!important;animation:shLiveOneFlash .52s steps(2,end) infinite}
@keyframes shLiveOneFlash{0%,100%{background:#fde047;color:#111827;box-shadow:0 0 0 2px #111827}50%{background:#111827;color:#fff;box-shadow:0 0 0 4px #fde047}}
#sh-live .sh-live-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin:8px 0}
#sh-live .sh-live-metric{border:1px solid #c7d0dd;background:#f8fafc;padding:7px 4px;text-align:center}
#sh-live .sh-live-metric b{display:block;font-size:22px;line-height:1}
#sh-live .sh-live-issue{display:none;margin:8px 0;padding:10px;border:3px solid #ef4444;border-left-width:8px;border-radius:5px;background:#fff1f2;color:#7f1d1d}
#sh-live .sh-live-issue.show{display:block}
#sh-live .sh-live-issue-title{font-size:16px;font-weight:1000;margin-bottom:6px}
#sh-live .sh-live-issue-grid{display:grid;grid-template-columns:auto 1fr;gap:3px 7px;font-size:12px;line-height:1.3}
#sh-live .sh-live-issue-grid b{font-weight:1000}
#sh-live .sh-live-failure-body{display:grid;grid-template-columns:86px minmax(0,1fr);gap:10px;align-items:start}
#sh-live .sh-live-failure-body.no-image{grid-template-columns:1fr}
#sh-live .sh-live-failure-img{width:86px;height:86px;object-fit:contain;background:#fff;border:1px solid #fecaca;border-radius:4px}
#sh-live .sh-live-failure-title{margin:0 0 6px;font-size:13px;font-weight:1000;line-height:1.25;color:#7f1d1d}
#sh-live .sh-live-action{margin-top:8px;padding:8px;background:#fff;border:1px solid #fecaca;border-radius:4px;font-weight:900;text-align:center}
#sh-live .sh-live-issue-buttons{display:flex;gap:7px;margin-top:8px}
#sh-live .sh-live-issue-buttons button{flex:1}
#sh-live .sh-live-history{max-height:230px;overflow:auto;border-top:1px solid #d5dbe3;margin-top:8px;padding-top:6px;font-family:Consolas,monospace}
#sh-live .sh-live-history-row{padding:5px 7px;margin-bottom:3px;border:1px solid #bfdbfe;border-left:5px solid #146eb4;border-radius:3px;background:#eff6ff;color:#0f3d73;font-weight:800}
#sh-live .sh-live-current{padding:6px 8px;margin-top:7px;border:2px solid #f59e0b;background:#fff7ed;color:#9a3412;border-radius:4px;font-weight:900}
#sh-live .sh-live-blocked{animation:shLiveBlocked .65s ease-in-out infinite alternate}
@keyframes shLiveBlocked{from{box-shadow:0 0 0 0 rgba(239,68,68,.12)}to{box-shadow:0 0 0 6px rgba(239,68,68,.18)}}
#sh-live .sh-live-one-result{display:none;margin:8px 0;padding:10px;border:3px solid;border-left-width:8px;border-radius:5px;font-weight:900}
#sh-live .sh-live-one-result.show{display:block}
#sh-live .sh-live-one-result.ok{border-color:#16a34a;background:#dcfce7;color:#14532d}
#sh-live .sh-live-one-result.bad{border-color:#dc2626;background:#fff1f2;color:#7f1d1d}
#sh-live .sh-live-one-result-title{font-size:16px;font-weight:1000;margin-bottom:6px}
#sh-live .sh-live-one-result-grid{display:grid;grid-template-columns:auto 1fr;gap:3px 7px;font-size:12px;line-height:1.3}
#sh-live .sh-live-one-result-grid b{font-weight:1000}
#sh-live .sh-live-idle-pulse{border-width:3px!important;animation:shLiveIdlePulse .8s steps(2,end) infinite!important}
@keyframes shLiveIdlePulse{
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
#sh-og-expiry .og-footer{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:7px}.og-footer button{width:100%;height:48px!important;background:#7c3aed!important;color:#fff!important;border-color:#6d28d9!important;font-size:15px!important}.og-footer .production-confirm{background:#146eb4!important;border-color:#0f5c99!important}.og-footer .og-return-source{background:#eff6ff!important;color:#0f3d73!important;border:2px solid #146eb4!important}
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

  const feature = { queue:false, scrub:false, qty:false, lazy:false, live:false };
  const panels = {};
  const dockButtons = [];

  function panel(id, title, key) {
    const root = document.createElement('div');
    root.id = id;
    root.className = 'sh-panel';
    root.innerHTML = `<div class="sh-title">${title}</div><button type="button" class="sh-btn sh-return-source" data-return-source>↩ Return to Source</button>`;
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
      for (const key of ['queue','scrub','lazy','live','qty']) feature[key] = saved[key] === true;
    } catch {}
  }

  function mountDock() {
    if ($('#sh-dock')) return;
    restorePanelStates();
    const dock = document.createElement('div');
    dock.id = 'sh-dock';
    for (const [key,label] of [['queue','Tote'],['scrub','Scrub'],['lazy','Lazy'],['live','Live'],['qty','QTY']]) {
      const b = document.createElement('button');
      b.textContent = label;
      b.dataset.key = key;
      if (key === 'live') b.title = 'Click: show/hide Live | Ctrl+click: toggle immediate 1×1 mode';
      b.onclick = event => {
        if (key === 'live') {
          if (event.ctrlKey) {
            stopLazyForModeSwitch('switched to 1×1');
            feature.lazy = false;
            const nextMode = toggleLiveOneByOneMode();
            feature.live = !!nextMode;
            savePanelStates();
            applyPanels();
            if (nextMode) setTimeout(() => liveSrc.focus(), 0);
            return;
          }

          if (live.oneByOne) {
            toggleLiveOneByOneMode();
            stopLazyForModeSwitch('switched to Live');
            feature.lazy = false;
            feature.live = true;
            savePanelStates();
            applyPanels();
            setTimeout(() => liveSrc.focus(), 0);
            return;
          }

          const opening = !feature.live;
          if (opening) {
            stopLazyForModeSwitch('switched to Live');
            feature.lazy = false;
          }
          feature.live = opening;
          savePanelStates();
          applyPanels();
          if (opening) setTimeout(() => live.sourceReady ? liveScan.focus() : liveSrc.focus(), 0);
          return;
        }

        if (key === 'lazy' && !feature.lazy) {
          deactivateLiveForModeSwitch('switched to Lazy');
          feature.live = false;
        }

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
    for (const key of ['live','lazy','scrub','queue']) {
      const p = panels[key];
      if (!p || !feature[key]) continue;
      const position = `${bottom}px`;
      if (p.style.bottom !== position) p.style.bottom = position;
      bottom += Math.max(80, p.offsetHeight) + 10;
    }
    renderScrub();
  }

  let panelLayoutRaf = 0;
  function requestPanelLayout() {
    if (panelLayoutRaf) return;
    panelLayoutRaf = requestAnimationFrame(() => {
      panelLayoutRaf = 0;
      applyPanels();
    });
  }

  const scrubPanel = panel('sh-scrub', `Tote Scrubber v${VERSION}`, 'scrub');
  const scrubStatus = document.createElement('div');
  scrubStatus.className = 'sh-status';
  scrubPanel.appendChild(scrubStatus);

  let scrubTimer = 0;

  function syncScrubTimer() {
    if (feature.scrub) {
      if (!scrubTimer) {
        scrubTimer = setInterval(scrubTick, 120);
        scrubTick();
      }
      return;
    }
    if (scrubTimer) clearInterval(scrubTimer);
    scrubTimer = 0;
  }

  function renderScrub() {
    setTextIfChanged(scrubStatus, feature.scrub ? 'ACTIVE — Change container → Yes' : 'OFF');
    let w = $('#sh-scrub-warning');
    if (feature.scrub && !w) {
      w = document.createElement('div');
      w.id = 'sh-scrub-warning';
      w.textContent = '⚠ TOTE SCRUBBER ACTIVE — OPENED CONTAINERS WILL BE EMPTIED ⚠';
      document.body.appendChild(w);
    }
    if (!feature.scrub && w) w.remove();
    syncScrubTimer();
  }

  async function scrubTick() {
    if (!feature.scrub || shared.scrubBusy || shared.owner === 'queue' || shared.owner === 'lazy' || shared.owner === 'live') return;
    const epoch = escapeEpoch;
    const change = changeButton();
    if (!change) return;
    shared.scrubBusy = true;
    shared.owner = 'scrub';
    try {
      if (epoch !== escapeEpoch || !feature.scrub) return;
      click(change);
      const yes = await waitFor(() => epoch === escapeEpoch && feature.scrub && modalButton('yes'), 3000, 20);
      if (yes && epoch === escapeEpoch && feature.scrub) click(yes);
    } finally {
      shared.scrubBusy = false;
      if (shared.owner === 'scrub') shared.owner = '';
    }
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
      shared.owner = '';
      renderQueue('done');
      return;
    }

    shared.queueBusy = true;
    shared.owner = 'queue';
    const code = q.list[q.index];

    try {
      if (screen() !== 'SOURCE' && changeButton()) {
        const r = await closeOpenContainer('yes', active);
        if (!active()) return;
        if (r !== 'closed') throw new Error(r);
      }
      renderQueue('scanning source');
      if (!await fillAndConfirm(code, 'SOURCE', active)) {
        if (!active()) return;
        throw new Error('scan timeout');
      }

      const openedOrBlocked = await waitFor(() => {
        if (!active()) return 'cancelled';
        if (customerBoundSourceMessage()) return 'customer-bound';
        if (changeButton()) return 'opened';
        return null;
      }, 4500, 40);

      if (!active() || openedOrBlocked === 'cancelled') return;

      if (openedOrBlocked === 'customer-bound') {
        q.index++;
        renderQueue('customer-bound — skipped');
        return;
      }

      if (openedOrBlocked !== 'opened') {
        throw new Error('source did not open');
      }

      const result = await closeOpenContainer('yes', active);
      if (!active()) return;
      if (result !== 'closed') throw new Error(result);
      q.index++;
      renderQueue('cleared');
    } catch (e) {
      q.failed.push(`${code} (${e.message})`);
      q.index++;
      renderQueue(e.message);
    } finally {
      shared.queueBusy = false;
      if (shared.owner === 'queue') shared.owner = '';
      if (active() && !q.paused) setTimeout(() => queuePump(run), 40);
    }
  }

  queuePanel.onclick = e => {
    const a = e.target.dataset.a;
    if (!a) return;
    if (a === 'start') {
      if (live.running || live.sourceReady) {
        qError.textContent = 'Live Lazy is active — stop/reset Live first.';
        return;
      }
      q.runSeq++;
      q.list = parseContainers(qText.value);
      q.index = 0;
      q.failed = [];
      q.running = !!q.list.length;
      q.paused = false;
      renderQueue(q.running ? 'starting' : 'no containers');
      queuePump(q.runSeq);
    }
    if (a === 'pause') {
      q.paused = !q.paused;
      e.target.textContent = q.paused ? 'Resume' : 'Pause';
      renderQueue();
      if (!q.paused) queuePump();
    }
    if (a === 'stop') {
      q.runSeq++;
      q.running = false;
      q.paused = false;
      shared.owner = '';
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

  // Live
  const live = {
    oneByOne:false,
    oneInFlight:new Map(),
    oneResult:null,
    oneErrorToken:0,
    oneErrorTimer:0,
    failureNotice:null,
    failureToken:0,
    failureTimer:0,
    running:false,
    sourceReady:false,
    processing:false,
    src:'',
    dest:'',
    sourceMeta:null,
    queue:[],
    current:null,
    history:[],
    moved:0,
    skipped:0,
    issue:null,
    error:'',
    note:'',
    runSeq:0,
    activeRun:null,
    dateResolve:null,
    lookupActive:0,
    lookupWait:[],
    nextMoveAt:0,
    datePending:[],
    activeDateItem:null
  };

  const livePanel = panel('sh-live', `Live Lazy QTY 1 v${VERSION}`, 'live');
  livePanel.insertAdjacentHTML('beforeend',
    '<div class="sh-row">' +
      '<input class="sh-input" data-f="live-src" placeholder="1. Scan SOURCE (csX / tsX)">' +
      '<input class="sh-input" data-f="live-dest" placeholder="2. Scan DESTINATION" disabled>' +
    '</div>' +
    '<input class="sh-input sh-live-scan" data-f="live-scan" placeholder="3. Scan item barcode — QTY always 1" disabled>' +
    '<div class="sh-live-ready">QTY = 1 PER SCAN — PRECHECK snoops queued items immediately; duplicates merge; moves pace 5–11s apart.</div>' +
    '<div class="sh-grid4">' +
      '<button class="sh-btn sh-stop" data-live-a="stop">Stop</button>' +
      '<button class="sh-btn" data-live-a="reset">Reset</button>' +
      '<button class="sh-btn" data-live-a="focus">Focus scan</button>' +
      '<button class="sh-btn sh-clear-tote" data-live-a="clear-source">Clear source</button>' +
    '</div>' +
    '<div class="sh-live-metrics">' +
      '<div class="sh-live-metric">Moved<b data-live-m="moved">0</b></div>' +
      '<div class="sh-live-metric"><span data-live-queue-label>Queued</span><b data-live-m="queued">0</b></div>' +
      '<div class="sh-live-metric">Expiry<b data-live-m="expiry">0</b></div>' +
      '<div class="sh-live-metric">Skipped<b data-live-m="skipped">0</b></div>' +
    '</div>' +
    '<div class="sh-live-issue"></div>' +
    '<div class="sh-status" data-live-status></div>' +
    '<div class="sh-error" data-live-error></div>' +
    '<div class="sh-live-one-result" data-live-one-result></div>' +
    '<div class="sh-live-current" data-live-current style="display:none"></div>' +
    '<div class="sh-live-history"></div>'
  );

  const liveSrc = $('[data-f="live-src"]', livePanel);
  const liveDest = $('[data-f="live-dest"]', livePanel);
  const liveScan = $('[data-f="live-scan"]', livePanel);
  const liveStatus = $('[data-live-status]', livePanel);
  const liveError = $('[data-live-error]', livePanel);
  const liveOneResult = $('[data-live-one-result]', livePanel);
  const liveReady = $('.sh-live-ready', livePanel);
  const liveQueueLabel = $('[data-live-queue-label]', livePanel);
  const liveIssue = $('.sh-live-issue', livePanel);
  const liveCurrent = $('[data-live-current]', livePanel);
  const liveHistory = $('.sh-live-history', livePanel);
  const liveMoved = $('[data-live-m="moved"]', livePanel);
  const liveQueued = $('[data-live-m="queued"]', livePanel);
  const liveExpiry = $('[data-live-m="expiry"]', livePanel);
  const liveSkipped = $('[data-live-m="skipped"]', livePanel);

  function syncLiveModeUi() {
    const dockButton = dockButtons.find(button => button.dataset.key === 'live');
    const title = $('.sh-title', livePanel);

    dockButton?.classList.toggle('sh-live-one-mode', live.oneByOne);
    if (dockButton) dockButton.textContent = live.oneByOne ? '1×1' : 'Live';
    if (title) title.textContent = live.oneByOne
      ? `Live 1×1 Immediate v${VERSION}`
      : `Live Lazy QTY 1 v${VERSION}`;
    setTextIfChanged(liveQueueLabel, live.oneByOne ? 'Active' : 'Queued');
    setTextIfChanged(
      liveReady,
      live.oneByOne
        ? 'NO QUEUE — EVERY SCAN SENDS ITS OWN QTY 1 MOVE IMMEDIATELY. Item errors clear after 5 seconds; expiry uses the date panel.'
        : 'QTY = 1 PER SCAN — PRECHECK snoops queued items immediately; duplicates merge; moves pace 5–11s apart.'
    );
  }

  function deactivateLiveForModeSwitch(note='mode switched') {
    live.oneByOne = false;
    resetLive(note, false);
  }

  function toggleLiveOneByOneMode() {
    if (live.oneByOne) {
      deactivateLiveForModeSwitch('1×1 off');
      return false;
    }

    // Switching policy: abort/reset any normal Live session first. Lazy state is handled
    // separately and is never reset here.
    resetLive('switching to 1×1', false);
    live.oneByOne = true;
    live.error = '';
    live.note = '1×1 selected — scan source';
    syncLiveModeUi();
    renderLive();
    return true;
  }

  function beginLiveRun() {
    live.lookupWait = [];
    live.oneInFlight.clear();
    live.oneResult = null;
    clearTimeout(live.oneErrorTimer);
    live.oneErrorTimer = 0;
    live.oneErrorToken++;
    clearTimeout(live.failureTimer);
    live.failureTimer = 0;
    live.failureToken++;
    live.failureNotice = null;
    resetLiveLookupPool();
    live.nextMoveAt = 0;
    return beginRun(live);
  }

  function cancelLiveRun() {
    live.lookupWait = [];
    cancelRun(live);
  }

  function currentLiveRun(run=live.activeRun) {
    return currentRun(live, run);
  }

  function liveApi(path, body, run=live.activeRun) {
    return postJson(path, body, live, run, 'Live session cancelled');
  }

  function randomLiveMoveDelayMs() {
    return LIVE_MOVE_DELAY_MIN_MS +
      Math.floor(Math.random() * (LIVE_MOVE_DELAY_MAX_MS - LIVE_MOVE_DELAY_MIN_MS + 1));
  }

  function waitLiveMs(ms, run=live.activeRun) {
    if (ms <= 0) return Promise.resolve(currentLiveRun(run));

    return new Promise(resolve => {
      if (!currentLiveRun(run)) {
        resolve(false);
        return;
      }

      let done = false;
      let timer = 0;

      const finish = value => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        run?.controller?.signal?.removeEventListener?.('abort', onAbort);
        resolve(value);
      };

      const onAbort = () => finish(false);
      timer = setTimeout(() => finish(currentLiveRun(run)), ms);

      run?.controller?.signal?.addEventListener?.('abort', onAbort, { once:true });
    });
  }

  async function waitForLiveMovePace(item, run=live.activeRun) {
    if (!currentLiveRun(run) || !live.running) return false;

    const waitMs = Math.max(0, live.nextMoveAt - Date.now());
    if (!waitMs) return true;

    live.note = `paced wait ${(waitMs / 1000).toFixed(1)}s | ${item.code} ready`;
    renderLive();

    return await waitLiveMs(waitMs, run);
  }

  function resetLiveLookupPool() {
    live.lookupActive = 0;
    live.lookupWait = [];
  }

  function liveQueuedPreflightIssues() {
    return live.queue.filter(item => !!item.preflightIssue);
  }

  let liveRenderRaf = 0;
  function requestLiveRender() {
    if (liveRenderRaf) return;
    liveRenderRaf = requestAnimationFrame(() => {
      liveRenderRaf = 0;
      renderLive();
    });
  }

  function preflightLiveLookup(item, result, run=live.activeRun) {
    if (!item || !currentLiveRun(run) || !live.running) return;

    if (item.status === 'MOVED' || item.status === 'SKIPPED') return;

    if (!result || result.kind === 'aborted') return;

    if (result.kind === 'error') {
      const reason = result.error?.message || 'SCAN API ERROR';
      if (!autoSkipQueuedLiveItem(item, 'SCAN API ERROR', reason)) {
        item.preflightStatus = 'ISSUE';
        item.preflightIssue = { kind:'generic', title:'SCAN API ERROR', reason };
        renderLive();
      }
      return;
    }

    const ctx = resolveItem(result.response, item.code);
    if (!ctx.ok) {
      const title = ctx.invalid
        ? 'INVALID BARCODE'
        : ctx.type === 'RequestMultipleBarcodesResponse'
          ? 'MULTIPLE BARCODE MATCHES'
          : 'BARCODE NOT RESOLVED';
      const reason = ctx.invalid
        ? 'INVALID BARCODE'
        : ctx.type === 'RequestMultipleBarcodesResponse'
          ? 'SCAN A MORE SPECIFIC BARCODE / FNSKU'
          : ctx.type || 'NO ITEM DETAILS';

      if (!autoSkipQueuedLiveItem(item, title, reason)) {
        item.preflightStatus = 'ISSUE';
        item.preflightIssue = { kind:'barcode', title, reason };
        renderLive();
      }
      return;
    }

    item.ctx = ctx;
    item.preflightIssue = null;

    // Live lookups run ahead of processing. Hazmat must be rejected here before an
    // item can ever be labelled READY and take the fast prechecked move path.
    if (hasHazmat(result.response)) {
      item.preflightStatus = 'ISSUE';
      item.preflightIssue = { kind:'hazmat', title:'HAZMAT — ITEM NOT MOVED', reason:'HAZMAT' };

      if (!autoSkipQueuedLiveItem(item, 'HAZMAT — ITEM NOT MOVED', 'HAZMAT')) {
        renderLive();
      }
      return;
    }

    if (ctx.dateType === 'EXPIRATION_DATE' || ctx.dateType === 'PRODUCTION_DATE') {
      item.preflightStatus = 'DATE';

      if (live.current !== item) {
        const idx = live.queue.indexOf(item);
        if (idx >= 0) {
          live.queue.splice(idx, 1);
          parkLiveDateItem(item, ctx);
          setTimeout(pumpLive, 0);
          return;
        }
      }

      renderLive();
      return;
    }

    item.preflightStatus = 'READY';
    requestLiveRender();
  }

  function scheduleLiveLookup(item) {
    if (!item || item.resolvePromise || !live.activeRun) return;

    let settle;
    item.resolvePromise = new Promise(resolve => { settle = resolve; });
    item.resolveSettle = settle;
    item.lookupQueued = true;
    live.lookupWait.push(item);
    drainLiveLookups();
  }

  function drainLiveLookups() {
    const run = live.activeRun;
    if (!currentLiveRun(run) || !live.running) return;

    while (
      live.lookupActive < LIVE_LOOKUP_CONCURRENCY &&
      live.lookupWait.length &&
      currentLiveRun(run) &&
      live.running
    ) {
      const item = live.lookupWait.shift();
      if (!item || !item.resolveSettle) continue;

      item.lookupQueued = false;
      item.lookupStarted = true;
      live.lookupActive++;

      (async () => {
        let result;

        try {
          const response = await liveApi(API_SCAN_ITEM, scanItemPayload(live.src, item.code), run);

          result = { kind:'response', response };
        } catch (error) {
          result = error?.name === 'AbortError'
            ? { kind:'aborted' }
            : isAllowedOverageResponse(error?.payload)
              ? { kind:'response', response:error.payload, overage:true }
              : { kind:'error', error };
        } finally {
          if (currentLiveRun(run)) {
            live.lookupActive = Math.max(0, live.lookupActive - 1);
          }

          const settle = item.resolveSettle;
          item.resolveSettle = null;
          item.lookupStarted = false;

          preflightLiveLookup(item, result, run);
          settle?.(result);

          drainLiveLookups();
        }
      })();
    }
  }

  function restartLiveLookup(item) {
    if (!item) return;

    item.resolvePromise = null;
    item.resolveSettle = null;
    item.lookupQueued = false;
    item.lookupStarted = false;
    item.ctx = null;
    item.retryCtx = null;
    item.retryExpirationMs = null;
    item.preflightStatus = '';
    item.preflightIssue = null;

    scheduleLiveLookup(item);
  }

  function scanSourcePayload(container) {
    return { containerScannableId:container, requestId:requestId(), tool:TOOL };
  }

  function scanItemPayload(source, barcode) {
    return {
      containerScannableId:source,
      itemBarcode:barcode,
      isMasterpack:null,
      itemAndonContext:null,
      requestId:requestId(),
      tool:TOOL
    };
  }

  function buildMovePayload(source, destination, sourceMeta, ctx, qty=1, expirationMs=null) {
    const item = ctx.item;
    const sku = ctx.sku;
    const records = ctx.records?.length ? ctx.records : [item];

    return {
      itemExternalId:null,
      sourceContainerScannableId:source,
      destinationContainerScannableId:destination,
      scannableId:clean(item.scannableId || ctx.barcode),
      quantity:String(Math.max(1, Number(qty) || 1)),
      itemDetails:records.map(record => {
        const recordSku = record.skuDetail || sku;
        return {
          fcsku:clean(recordSku.fcSku),
          quantity:Number.isFinite(Number(record.quantity)) ? Number(record.quantity) : 0,
          consumerType:record.consumer ?? null,
          disposition:record.disposition ?? null,
          referenceId:record.referenceId ?? null,
          fnsku:clean(recordSku.fnSku)
        };
      }),
      foundProblems:[null,null,null],
      scannedSourceContainerAsDestination:false,
      datelotDetail:sku.datelotDetail || null,
      userEnteredExpirationDate:expirationMs,
      mlcCaptureDetail:{
        mlcClass:sku.mlcDetail?.mlcClass ?? 'UNKNOWN',
        userEnteredLotCode:null,
        mlcMissing:sku.mlcDetail?.mlcMissing ?? false,
        mlcNotEnteredReason:null,
        mlcCaptureMethod:null
      },
      itemMovedToISS:false,
      candidatePurchaseOrders:[],
      packHierarchyDetail:null,
      itemAndonContext:null,
      processPath:sourceMeta?.processPath ?? 'UNDETERMINED',
      requestId:requestId(),
      tool:TOOL
    };
  }

  function liveItemMeta(item=live.current) {
    const ctx = item?.ctx;
    return {
      scan:clean(item?.code || '—'),
      asin:clean(ctx?.asin || '—'),
      fnsku:clean(ctx?.fnsku || '—')
    };
  }

  function liveProductMeta(item=live.current) {
    const ctx = item?.ctx;
    return {
      title:clean(ctx?.sku?.title || ctx?.sku?.normalizedTitle || ''),
      imageUrl:productImageUrl(ctx)
    };
  }

  function setLiveFailureNotice(item, title, reason, mode=live.oneByOne ? '1x1' : 'live') {
    const meta = liveItemMeta(item);
    const product = liveProductMeta(item);
    const token = ++live.failureToken;
    clearTimeout(live.failureTimer);
    live.failureNotice = {
      mode,
      title:clean(title) || 'ITEM NOT MOVED',
      reason:clean(reason) || 'NOT MOVED',
      scan:meta.scan,
      asin:meta.asin,
      fnsku:meta.fnsku,
      qty:itemQty(item),
      productTitle:product.title,
      imageUrl:product.imageUrl
    };

    live.failureTimer = setTimeout(() => {
      if (live.failureToken !== token) return;
      live.failureTimer = 0;
      live.failureNotice = null;
      renderLive();
    }, mode === '1x1' ? 8000 : 12000);
  }

  function liveFailureHtml() {
    const notice = live.failureNotice;
    if (!notice) return '';

    const image = notice.imageUrl
      ? `<img class="sh-live-failure-img" src="${esc(notice.imageUrl)}" alt="">`
      : '';
    const productTitle = notice.productTitle
      ? `<div class="sh-live-failure-title">${esc(notice.productTitle)}</div>`
      : '';
    const action = notice.mode === '1x1'
      ? '<b>AUTO-SKIPPED — NOTHING WAS FORCED.</b><br>Scan the next item.'
      : '<b>AUTO-SKIPPED — NOTHING WAS FORCED.</b><br>Live queue continues automatically.';

    return (
      `<div class="sh-live-issue-title">⚠ ${esc(notice.title)}</div>` +
      `<div class="sh-live-failure-body${image ? '' : ' no-image'}">` +
        image +
        `<div>${productTitle}<div class="sh-live-issue-grid">` +
          `<b>SCAN:</b><span>${esc(notice.scan)}</span>` +
          `<b>ASIN:</b><span>${esc(notice.asin)}</span>` +
          `<b>FNSKU:</b><span>${esc(notice.fnsku)}</span>` +
          `<b>Qty:</b><span>${esc(String(notice.qty || 1))}</span>` +
          `<b>Issue:</b><span>${esc(notice.reason)}</span>` +
        `</div></div>` +
      `</div>` +
      `<div class="sh-live-action">${action}</div>`
    );
  }

  function liveIssueHtml() {
    if (!live.issue || !live.current || live.issue.kind !== 'destination') return '';

    const meta = liveItemMeta();
    const issue = live.issue;
    return (
      `<div class="sh-live-issue-title">⚠ ${esc(issue.title || 'DESTINATION ACTION REQUIRED')}</div>` +
      `<div class="sh-live-issue-grid">` +
        `<b>SCAN:</b><span>${esc(meta.scan)}</span>` +
        `<b>ASIN:</b><span>${esc(meta.asin)}</span>` +
        `<b>FNSKU:</b><span>${esc(meta.fnsku)}</span>` +
        `<b>Qty:</b><span>${esc(String(live.current?.qty || 1))}</span>` +
        `<b>Issue:</b><span>${esc(issue.reason || issue.title || 'BLOCKED')}</span>` +
      `</div>` +
      `<div class="sh-live-action"><b>SCAN A NEW DESTINATION ABOVE</b><br>Current item stays blocked and retries first.</div>` +
      `<div class="sh-live-issue-buttons"><button class="sh-btn sh-return-source-inline" data-return-source>↩ Return to Source</button><button class="sh-btn sh-stop" data-live-a="skip">Skip item</button></div>`
    );
  }

  function livePreflightIssueHtml(issues=liveQueuedPreflightIssues()) {
    if (!issues.length) return '';

    const first = issues[0];
    const meta = liveItemMeta(first);
    const issue = first.preflightIssue || {};
    const totalUnits = sumQty(issues);

    const extra = issues.slice(1, 4).map(item => {
      const m = liveItemMeta(item);
      return `<div style="margin-top:4px;font-weight:900">• ${esc(m.scan)} — ${esc(item.preflightIssue?.reason || 'ISSUE')}</div>`;
    }).join('');

    return (
      `<div class="sh-live-issue-title">⚠ PREFLIGHT ISSUE AHEAD${totalUnits > 1 ? ` — ${totalUnits}` : ''}</div>` +
      `<div class="sh-live-issue-grid">` +
        `<b>SCAN:</b><span>${esc(meta.scan)}</span>` +
        `<b>ASIN:</b><span>${esc(meta.asin)}</span>` +
        `<b>FNSKU:</b><span>${esc(meta.fnsku)}</span>` +
        `<b>Qty:</b><span>${esc(String(first.qty || 1))}</span>` +
        `<b>Issue:</b><span>${esc(issue.reason || issue.title || 'CHECK REQUIRED')}</span>` +
      `</div>` +
      `<div class="sh-live-action"><b>EARLY WARNING — NO MOVE HAS BEEN SENT FOR THIS ITEM.</b><br>` +
      `Live will auto-skip this barcode if it reaches processing unchanged; other queued items continue.</div>` +
      extra
    );
  }

  let liveHistoryToken = '';

  function renderLive() {
    syncLiveModeUi();

    const queuedUnits = live.oneByOne ? live.oneInFlight.size : sumQty(live.queue);
    const expiryUnits = sumQty(live.datePending);
    const currentUnits = live.current && !['MOVED','SKIPPED'].includes(live.current.status)
      ? itemQty(live.current)
      : 0;

    setTextIfChanged(liveMoved, live.moved);
    setTextIfChanged(liveQueued, queuedUnits + currentUnits);
    setTextIfChanged(liveExpiry, expiryUnits);
    setTextIfChanged(liveSkipped, live.skipped);

    const precheckedQueuedUnits = live.oneByOne ? 0 : live.queue.reduce(
      (sum, item) => sum + (item.preflightStatus ? itemQty(item) : 0),
      0
    );
    const precheckedCurrentUnits = !live.oneByOne && live.current?.preflightStatus ? itemQty(live.current) : 0;
    const precheckedUnits = precheckedQueuedUnits + precheckedCurrentUnits + expiryUnits;
    const precheckTotalUnits = live.oneByOne ? 0 : queuedUnits + currentUnits + expiryUnits;
    const preflightIssues = live.oneByOne ? [] : liveQueuedPreflightIssues();
    const issueAheadUnits = sumQty(preflightIssues);

    const liveIdle = !!(
      live.running &&
      live.sourceReady &&
      live.dest &&
      !live.processing &&
      !live.issue &&
      !live.current &&
      live.queue.length === 0 &&
      live.oneInFlight.size === 0 &&
      live.datePending.length === 0
    );
    liveSrc.classList.toggle('sh-live-idle-pulse', liveIdle);
    liveDest.classList.toggle('sh-live-idle-pulse', liveIdle);

    const state = live.issue
      ? 'BLOCKED — ACTION REQUIRED'
      : live.oneByOne && live.oneInFlight.size
        ? `1×1 SENDING ${live.oneInFlight.size}`
        : live.processing
          ? 'PROCESSING'
          : live.running
            ? live.oneByOne ? '1×1 READY — SCAN ITEM' : 'READY — SCAN ITEM'
            : live.sourceReady
              ? 'SOURCE READY — SCAN DESTINATION'
              : live.oneByOne ? '1×1 — SCAN SOURCE' : 'SCAN SOURCE';

    const expirySuffix = live.datePending.length
      ? ` | EXPIRY PENDING ${live.datePending.length}`
      : '';
    const precheckSuffix = precheckTotalUnits
      ? ` | PRECHECK ${precheckedUnits}/${precheckTotalUnits}`
      : '';
    const issueAheadSuffix = issueAheadUnits
      ? ` | ⚠ ISSUE AHEAD ${issueAheadUnits}`
      : '';
    setTextIfChanged(liveStatus, `${state}${live.note ? ` | ${live.note}` : ''}${precheckSuffix}${expirySuffix}${issueAheadSuffix}`);
    setTextIfChanged(liveError, live.error || '');

    const oneResult = live.oneByOne ? live.oneResult : null;
    if (oneResult) {
      const resultHtml =
        `<div class="sh-live-one-result-title">${oneResult.ok ? '✓ MOVED — QTY 1' : '⚠ NOT MOVED — AUTO-SKIPPED'}</div>` +
        `<div class="sh-live-one-result-grid">` +
          `<b>SCAN:</b><span>${esc(oneResult.scan || '—')}</span>` +
          `<b>ASIN:</b><span>${esc(oneResult.asin || '—')}</span>` +
          `<b>FNSKU:</b><span>${esc(oneResult.fnsku || '—')}</span>` +
          (!oneResult.ok ? `<b>Issue:</b><span>${esc(oneResult.reason || 'NOT MOVED')}</span>` : '') +
        `</div>`;
      if (liveOneResult.dataset.html !== resultHtml) {
        liveOneResult.dataset.html = resultHtml;
        liveOneResult.innerHTML = resultHtml;
      }
      liveOneResult.classList.toggle('ok', !!oneResult.ok);
      liveOneResult.classList.toggle('bad', !oneResult.ok);
      liveOneResult.classList.add('show');
    } else {
      if (liveOneResult.dataset.html !== '') liveOneResult.dataset.html = '';
      if (liveOneResult.innerHTML) liveOneResult.innerHTML = '';
      liveOneResult.classList.remove('show','ok','bad');
    }

    const hardIssueHtml = liveIssueHtml();
    const failureHtml = liveFailureHtml();
    const issueHtml = hardIssueHtml || failureHtml || livePreflightIssueHtml(preflightIssues);
    if (issueHtml) {
      if (liveIssue.dataset.html !== issueHtml) {
        liveIssue.dataset.html = issueHtml;
        liveIssue.innerHTML = issueHtml;
      }
    } else {
      if (liveIssue.dataset.html !== '') liveIssue.dataset.html = '';
      if (liveIssue.innerHTML) liveIssue.innerHTML = '';
    }
    liveIssue.classList.toggle('show', !!issueHtml);
    liveIssue.classList.toggle('sh-live-blocked', !!hardIssueHtml);

    if (live.current) {
      const meta = liveItemMeta();
      const html =
        `${esc(live.current.status || 'CURRENT')} &nbsp; | &nbsp; ${esc(meta.scan)} &nbsp; | &nbsp; QTY ${esc(String(live.current.qty || 1))}` +
        (meta.fnsku !== '—' ? ` &nbsp; | &nbsp; ${esc(meta.fnsku)}` : '');
      if (liveCurrent.style.display !== 'block') liveCurrent.style.display = 'block';
      if (liveCurrent.innerHTML !== html) liveCurrent.innerHTML = html;
    } else {
      if (liveCurrent.style.display !== 'none') liveCurrent.style.display = 'none';
      if (liveCurrent.innerHTML) liveCurrent.innerHTML = '';
    }

    if (live.oneByOne) {
      if (liveHistory.style.display !== 'none') liveHistory.style.display = 'none';
      if (liveHistory.innerHTML) liveHistory.innerHTML = '';
      liveHistoryToken = '';
    } else {
      if (liveHistory.style.display !== '') liveHistory.style.display = '';
      const historyToken = `${live.history.length}:${live.history[0]?.id || ''}`;
      if (historyToken !== liveHistoryToken) {
        liveHistoryToken = historyToken;
        liveHistory.innerHTML = live.history.slice(0, 14).map(item => {
          const ctx = item.ctx;
          return `<div class="sh-live-history-row">✓ ${esc(item.code)} ×${esc(String(item.qty || 1))}` +
            (ctx?.fnsku ? ` &nbsp; | &nbsp; ${esc(ctx.fnsku)}` : '') +
            ` → ${esc(item.destination || live.dest)}</div>`;
        }).join('');
      }
    }

    const liveWorking = !!(
      live.running &&
      (live.processing || live.current || live.queue.length || live.oneInFlight.size)
    );
    const liveWaiting = !!(
      live.running &&
      (
        live.issue ||
        (!liveWorking && (live.activeDateItem || live.datePending.length))
      )
    );
    setMoveCorner('live', liveWaiting ? 'waiting' : liveWorking ? 'active' : 'idle');

    requestPanelLayout();
  }

  function resetLive(note='reset', focusSource=true) {
    cancelLiveRun();
    clearMoveCorner('live');
    live.dateResolve?.(null);
    live.dateResolve = null;
    $('#sh-og-expiry')?.remove();
    clearLiveDateScanBuffer();
    clearTimeout(live.oneErrorTimer);
    live.oneErrorTimer = 0;
    live.oneErrorToken++;
    live.oneResult = null;
    clearTimeout(live.failureTimer);
    live.failureTimer = 0;
    live.failureToken++;
    live.failureNotice = null;
    live.oneInFlight.clear();

    live.running = false;
    live.sourceReady = false;
    live.processing = false;
    live.src = '';
    live.dest = '';
    live.sourceMeta = null;
    live.queue = [];
    live.current = null;
    live.datePending = [];
    live.activeDateItem = null;
    resetLiveLookupPool();
    live.history = [];
    liveHistoryToken = '';
    live.moved = 0;
    live.skipped = 0;
    live.issue = null;
    live.error = '';
    live.note = note;
    live.nextMoveAt = 0;

    if (shared.owner === 'live') shared.owner = '';

    liveSrc.disabled = false;
    liveDest.disabled = true;
    liveScan.disabled = true;
    liveSrc.value = '';
    liveDest.value = '';
    liveScan.value = '';
    liveSrc.classList.remove('good','bad','sh-live-idle-pulse');
    liveDest.classList.remove('good','bad','sh-live-idle-pulse');

    renderLive();
    if (focusSource) setTimeout(() => liveSrc.focus(), 0);
  }

  function stopLive() {
    cancelLiveRun();
    clearMoveCorner('live');
    live.dateResolve?.(null);
    live.dateResolve = null;
    $('#sh-og-expiry')?.remove();
    clearLiveDateScanBuffer();
    clearTimeout(live.oneErrorTimer);
    live.oneErrorTimer = 0;
    live.oneErrorToken++;
    live.oneResult = null;
    clearTimeout(live.failureTimer);
    live.failureTimer = 0;
    live.failureToken++;
    live.failureNotice = null;
    live.oneInFlight.clear();

    live.running = false;
    live.processing = false;
    live.activeDateItem = null;
    live.issue = null;
    live.error = '';
    live.note = 'stopped';
    liveScan.disabled = true;
    liveDest.disabled = true;
    if (shared.owner === 'live') shared.owner = '';
    renderLive();
  }

  async function clearLiveSource() {
    if (!live.sourceReady || !live.src) {
      live.error = 'No Live source container to clear.';
      live.note = '';
      renderLive();
      setTimeout(() => liveSrc.focus(), 0);
      return;
    }

    const pending =
      sumQty(live.queue) +
      live.oneInFlight.size +
      (live.current ? itemQty(live.current) : 0) +
      sumQty(live.datePending);
    if (live.processing || live.issue || pending) {
      live.error = `CANNOT CLEAR SOURCE — ${pending || 1} item${(pending || 1) === 1 ? '' : 's'} still processing/blocked/queued.`;
      live.note = live.datePending.length
        ? `finish ${live.datePending.length} pending expiry/production item${live.datePending.length === 1 ? '' : 's'} first`
        : 'finish or skip current work first';
      renderLive();
      return;
    }

    const sourceCode = live.src;
    const wasRunning = live.running;

    live.running = false;
    liveScan.disabled = true;
    live.error = '';
    live.note = `clearing source ${sourceCode}`;
    renderLive();

    shared.owner = 'live';

    try {
      const sourceLoaded = () =>
        norm(loadedSourceContainer()) === norm(sourceCode) && !!changeButton();

      if (sourceLoaded()) {
        await nativeCloseLoadedContainer('live source', true);
      }
      else if (await waitForNativeSourceScan(2500)) {
        await nativeOpenSourceContainer(sourceCode, 'live source');
        await nativeCloseLoadedContainer('live source', true);
      }
      else {
        const returned = await nativeReturnToOriginalSource(sourceCode);
        if (returned === true || sourceLoaded()) {
          await nativeCloseLoadedContainer('live source', true);
        } else {
          throw new Error('Could not safely reach the Live source container.');
        }
      }

      resetLive(`SOURCE CLEARED — ${sourceCode} — scan next source`);
    } catch (error) {
      live.running = wasRunning;
      live.error = `SOURCE CLEAR FAILED — ${error?.message || error}`;
      live.note = 'retry Clear source or handle manually';
      liveScan.disabled = !wasRunning;
      liveDest.disabled = true;
      shared.owner = 'live';
      renderLive();
      if (wasRunning) setTimeout(() => liveScan.focus(), 0);
    }
  }

  async function acceptLiveSource() {
    if (live.running || live.sourceReady) return;

    if (lazy.running || q.running || (shared.owner && shared.owner !== 'live')) {
      live.error = 'Another Sideline helper is busy.';
      renderLive();
      return;
    }

    const code = clean(liveSrc.value);
    if (!validContainer(code)) {
      live.error = 'SOURCE must start with csX or tsX.';
      liveSrc.classList.add('bad');
      renderLive();
      return;
    }

    const run = beginLiveRun();
    shared.owner = 'live';
    live.error = '';
    live.note = `validating ${code}`;
    liveSrc.classList.remove('bad');
    renderLive();

    try {
      const response = await liveApi(API_SCAN_SOURCE, scanSourcePayload(code), run);

      if (!currentLiveRun(run)) return;

      const type = clean(response?.['@type']);

      if (response?.success !== true) {
        cancelLiveRun();
        shared.owner = '';

        if (/customerboundshipment/i.test(type)) {
          live.error = 'SOURCE BLOCKED — CUSTOMER BOUND SHIPMENT';
        } else {
          live.error = `SOURCE BLOCKED — ${type || 'SOURCE VALIDATION FAILED'}`;
        }

        live.note = 'scan a different source';
        liveSrc.value = '';
        liveSrc.classList.remove('good');
        liveSrc.classList.add('bad');
        renderLive();
        setTimeout(() => liveSrc.focus(), 0);
        return;
      }

      live.src = code;
      live.sourceMeta = response;
      live.sourceReady = true;
      live.note = 'source ready — scan destination';
      liveSrc.classList.remove('bad');
      liveSrc.classList.add('good');
      liveSrc.disabled = true;
      liveDest.disabled = false;
      renderLive();
      setTimeout(() => liveDest.focus(), 0);
    } catch (error) {
      if (error?.name === 'AbortError') return;
      cancelLiveRun();
      shared.owner = '';
      live.error = `SOURCE ERROR — ${error?.message || error}`;
      live.note = 'scan source again';
      liveSrc.disabled = false;
      liveSrc.classList.add('bad');
      renderLive();
    }
  }

  function acceptLiveDestination() {
    if (!live.sourceReady) {
      live.error = 'Scan source first.';
      renderLive();
      return;
    }

    const code = clean(liveDest.value);
    if (!validContainer(code) || norm(code) === norm(live.src)) {
      live.error = 'DESTINATION must be a different csX / tsX.';
      liveDest.classList.add('bad');
      renderLive();
      return;
    }

    if (live.issue?.kind === 'destination' && live.current) {
      if (norm(code) === norm(live.dest)) {
        live.error = 'Use a DIFFERENT destination for this blocked item.';
        liveDest.classList.add('bad');
        renderLive();
        return;
      }

      live.dest = code;
      liveDest.classList.remove('bad');
      liveDest.classList.add('good');
      liveDest.disabled = true;
      live.error = '';
      live.note = `destination changed → retrying ${live.current.code}`;
      live.issue = null;
      renderLive();
      if (live.oneByOne) retryOneByOneBlockedMove(live.current);
      else retryLiveCurrentMove();
      return;
    }

    live.dest = code;
    live.running = true;
    live.error = '';
    live.note = live.oneByOne ? '1×1 immediate ready' : 'ready';
    liveDest.classList.remove('bad');
    liveDest.classList.add('good');
    liveDest.disabled = true;
    liveScan.disabled = false;
    renderLive();
    setTimeout(() => liveScan.focus(), 0);
  }

  function failLiveItem(item, title, reason, ctx=null) {
    if (!item || item.status === 'SKIPPED' || item.status === 'MOVED') return;
    if (ctx && !item.ctx) item.ctx = ctx;
    item.status = 'SKIPPED';
    item.failReason = clean(reason) || clean(title) || 'NOT MOVED';
    live.skipped += itemQty(item);
    if (live.current === item) live.current = null;
    live.error = '';
    live.note = 'item not moved — queue continuing';
    setLiveFailureNotice(item, title, item.failReason, 'live');
    renderLive();
    setTimeout(() => {
      if (!live.running || live.oneByOne || live.issue) return;
      liveScan.disabled = false;
      liveScan.focus();
      pumpLive();
    }, 0);
  }

  function autoSkipQueuedLiveItem(item, title, reason) {
    if (!item || live.oneByOne || live.current === item) return false;
    const index = live.queue.indexOf(item);
    if (index < 0) return false;
    live.queue.splice(index, 1);
    failLiveItem(item, title, reason, item.ctx || null);
    return true;
  }

  function blockLiveDestination(item, title, reason, ctx, expirationMs) {
    clearTimeout(live.failureTimer);
    live.failureTimer = 0;
    live.failureToken++;
    live.failureNotice = null;
    item.status = 'BLOCKED';
    item.retryCtx = ctx;
    item.retryExpirationMs = expirationMs;
    live.issue = { kind:'destination', title, reason };
    live.error = '';
    live.note = 'waiting for new destination';
    liveDest.disabled = false;
    liveDest.classList.remove('good');
    liveDest.classList.add('bad');
    renderLive();
    setTimeout(() => {
      liveDest.focus();
      liveDest.select?.();
    }, 0);
  }

  function setOneByOneResult(item, ok, reason='') {
    const meta = liveItemMeta(item);
    const token = ++live.oneErrorToken;
    clearTimeout(live.oneErrorTimer);
    if (ok) {
      clearTimeout(live.failureTimer);
      live.failureTimer = 0;
      live.failureToken++;
      live.failureNotice = null;
    }
    live.oneResult = {
      ok:!!ok,
      scan:meta.scan,
      asin:meta.asin,
      fnsku:meta.fnsku,
      reason:clean(reason)
    };

    live.oneErrorTimer = setTimeout(() => {
      if (live.oneErrorToken !== token) return;
      live.oneErrorTimer = 0;
      live.oneResult = null;
      renderLive();
    }, 5000);
  }

  function finishOneByOneMoved(item) {
    live.oneInFlight.delete(item.id);
    item.status = 'MOVED';
    item.destination = item.destination || live.dest;
    live.moved += 1;
    setOneByOneResult(item, true);
    if (live.current === item) {
      live.current = null;
      live.issue = null;
    }
    if (!live.issue) live.note = 'moved QTY 1 — ready for next scan';
    if (!live.issue && !live.datePending.length) liveScan.disabled = false;
    renderLive();
    if (!live.issue && !live.datePending.length) setTimeout(() => liveScan.focus(), 0);
    if (!live.oneInFlight.size && !live.datePending.length && !live.issue) {
      finishMoveCorner('live', true);
    }
  }

  function showOneByOneError(item, reason, title='ITEM NOT MOVED') {
    live.oneInFlight.delete(item.id);
    item.status = 'SKIPPED';
    item.failReason = clean(reason) || 'NOT MOVED';
    live.skipped += 1;
    live.oneResult = null;
    live.note = 'item not moved — scan next item';
    setLiveFailureNotice(item, title, item.failReason, '1x1');
    liveScan.disabled = false;
    renderLive();
    finishMoveCorner('live', false);
    setTimeout(() => {
      if (live.running && live.oneByOne && !live.issue && !live.datePending.length) liveScan.focus();
    }, 0);
  }

  function blockOneByOneDestination(item, title, reason, ctx, expirationMs) {
    live.oneInFlight.delete(item.id);
    item.status = 'BLOCKED';
    item.retryCtx = ctx;
    item.retryExpirationMs = expirationMs;
    live.current = item;
    live.issue = { kind:'destination', title, reason };
    live.error = '';
    live.note = '1×1 stopped — scan a new destination';
    liveScan.disabled = true;
    liveDest.disabled = false;
    liveDest.classList.remove('good');
    liveDest.classList.add('bad');
    renderLive();
    setTimeout(() => {
      liveDest.focus();
      liveDest.select?.();
    }, 0);
  }

  async function moveOneByOneResolved(item, ctx, expirationMs=null, run=live.activeRun) {
    if (!currentLiveRun(run) || !live.running || !live.oneByOne) return;

    if (live.issue?.kind === 'destination' && live.current !== item) {
      showOneByOneError(item, 'DESTINATION BLOCKED — RESCAN AFTER FIX');
      return;
    }

    if (norm(item.destination) !== norm(live.dest)) {
      showOneByOneError(item, 'DESTINATION CHANGED — RESCAN ITEM');
      return;
    }

    item.ctx = ctx;
    item.status = 'MOVING';
    item.retryCtx = ctx;
    item.retryExpirationMs = expirationMs;
    renderLive();

    let response;
    try {
      response = await liveApi(
        API_MOVE_ITEMS,
        buildMovePayload(live.src, item.destination, live.sourceMeta, ctx, 1, expirationMs),
        run
      );
    } catch (error) {
      if (error?.name === 'AbortError') return;
      if (isAllowedOverageResponse(error?.payload)) {
        response = error.payload;
      } else {
        const payloadReason = moveReason(error?.payload);
        const reason = payloadReason !== 'EMPTY MOVE RESPONSE'
          ? payloadReason
          : (error?.message || 'MOVE API ERROR');
        showOneByOneError(
          item,
          reason,
          hasHazmat(error?.payload) ? 'HAZMAT — ITEM NOT MOVED' : 'MOVE API ERROR'
        );
        return;
      }
    }

    if (!currentLiveRun(run)) return;

    const reason = moveReason(response);
    if (live.issue?.kind === 'destination' && live.current !== item) {
      showOneByOneError(item, 'DESTINATION BLOCKED — RESCAN AFTER FIX');
      return;
    }

    if (isDamagedDestinationResponse(response)) {
      blockOneByOneDestination(item, 'DESTINATION BLOCKED', 'DESTINATION DAMAGED', ctx, expirationMs);
      return;
    }

    if (reason === 'HAZMAT' || hasHazmat(response) || /destination incompatible/i.test(reason)) {
      showOneByOneError(
        item,
        reason === 'HAZMAT' || hasHazmat(response) ? 'HAZMAT' : (reason || 'DESTINATION INCOMPATIBLE'),
        reason === 'HAZMAT' || hasHazmat(response) ? 'HAZMAT — ITEM NOT MOVED' : 'ITEM / DESTINATION INCOMPATIBLE'
      );
      return;
    }

    if (hasPredicant(response)) {
      blockOneByOneDestination(item, 'DESTINATION NEEDS ATTENTION', 'PREDICANT — USE/RESET A DIFFERENT DESTINATION', ctx, expirationMs);
      return;
    }

    if (moveOk(response)) {
      item.acceptedOverage = isAllowedOverageResponse(response);
      finishOneByOneMoved(item);
      if (item.acceptedOverage) live.note = 'OVERAGE OK — moved QTY 1 — ready for next scan';
      renderLive();
      return;
    }

    showOneByOneError(item, reason || 'MOVE REJECTED', 'MOVE REJECTED');
  }

  async function processOneByOneBarcode(item) {
    const run = live.activeRun;
    if (!currentLiveRun(run) || !live.running || !live.oneByOne) return;

    item.status = 'CHECKING';
    renderLive();

    let response;
    try {
      response = await liveApi(API_SCAN_ITEM, scanItemPayload(live.src, item.code), run);
    } catch (error) {
      if (error?.name === 'AbortError') return;
      if (isAllowedOverageResponse(error?.payload)) {
        response = error.payload;
      } else {
        showOneByOneError(item, error?.message || 'SCAN API ERROR', 'SCAN API ERROR');
        return;
      }
    }

    if (!currentLiveRun(run)) return;

    const ctx = resolveItem(response, item.code);
    if (!ctx.ok) {
      const reason = ctx.invalid
        ? 'INVALID BARCODE'
        : ctx.type === 'RequestMultipleBarcodesResponse'
          ? 'MULTIPLE BARCODE MATCHES'
          : ctx.type || 'BARCODE NOT RESOLVED';
      showOneByOneError(item, reason, ctx.invalid ? 'INVALID BARCODE' : ctx.type === 'RequestMultipleBarcodesResponse' ? 'MULTIPLE BARCODE MATCHES' : 'BARCODE NOT RESOLVED');
      return;
    }

    item.ctx = ctx;

    // Fail closed before any state-changing move request when scan metadata already
    // identifies the item as Hazmat / dangerous goods.
    if (hasHazmat(response)) {
      showOneByOneError(item, 'HAZMAT', 'HAZMAT — ITEM NOT MOVED');
      return;
    }

    if (ctx.dateType === 'EXPIRATION_DATE' || ctx.dateType === 'PRODUCTION_DATE') {
      live.oneInFlight.delete(item.id);
      parkLiveDateItem(item, ctx);
      return;
    }

    await moveOneByOneResolved(item, ctx, null, run);
  }

  function enqueueOneByOneBarcode(code) {
    if (live.oneInFlight.size || live.current || live.datePending.length || live.activeDateItem) {
      live.error = live.datePending.length || live.activeDateItem
        ? 'EXPIRY REQUIRED — finish the current 1×1 item before scanning another.'
        : '1×1 BUSY — wait for the current item result, then rescan.';
      renderLive();
      return;
    }

    const item = {
      id:`live-one-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      code,
      qty:1,
      destination:live.dest,
      status:'SCANNED',
      ctx:null
    };

    live.oneInFlight.set(item.id, item);
    liveScan.disabled = true;
    live.error = '';
    live.note = `sent ${code} ×1`;
    renderLive();
    processOneByOneBarcode(item);
  }

  function retryOneByOneBlockedMove(item) {
    if (!item?.retryCtx || !live.running || !live.oneByOne) return;
    item.destination = live.dest;
    live.current = null;
    live.oneInFlight.set(item.id, item);
    liveScan.disabled = true;
    renderLive();
    moveOneByOneResolved(item, item.retryCtx, item.retryExpirationMs ?? null);
    setTimeout(() => liveScan.focus(), 0);
  }

  function finishLiveMoved(item) {
    item.status = 'MOVED';
    item.destination = live.dest;
    live.moved += itemQty(item);
    live.history.unshift(item);
    if (live.history.length > 100) live.history.length = 100;
    live.current = null;
    live.issue = null;
    live.error = '';
    live.note = 'moved — ready for next scan';
    renderLive();
    if (!live.queue.length && !live.datePending.length) finishMoveCorner('live', true);
  }

  function skipLiveCurrent() {
    if (!live.current) return;
    live.current.status = 'SKIPPED';
    live.skipped += itemQty(live.current);
    live.current = null;
    live.issue = null;
    live.error = '';
    live.note = live.oneByOne ? 'item skipped — 1×1 ready' : 'item skipped — queue continuing';
    liveDest.disabled = !!live.running;
    liveScan.disabled = !live.running;
    renderLive();
    setTimeout(() => {
      liveScan.focus();
      if (!live.oneByOne) pumpLive();
    }, 0);
  }

  async function liveMoveCurrent(item, ctx, expirationMs=null) {
    const run = live.activeRun;
    if (!currentLiveRun(run) || !live.running) return false;

    item.ctx = ctx;
    item.status = 'MOVING';
    item.retryCtx = ctx;
    item.retryExpirationMs = expirationMs;
    const moveQty = itemQty(item);
    live.note = `${ctx.asin || item.code} / ${ctx.fnsku || item.code} | QTY ${moveQty}`;
    renderLive();

    if (!await waitForLiveMovePace(item, run)) return false;

    let response;
    try {
      response = await liveApi(API_MOVE_ITEMS, buildMovePayload(live.src, live.dest, live.sourceMeta, ctx, moveQty, expirationMs), run);
    } catch (error) {
      if (error?.name === 'AbortError') return false;

      live.nextMoveAt = Date.now() + randomLiveMoveDelayMs();

      if (isAllowedOverageResponse(error?.payload)) {
        response = error.payload;
      } else {
        const payloadReason = moveReason(error?.payload);
        const reason = payloadReason !== 'EMPTY MOVE RESPONSE'
          ? payloadReason
          : (error?.message || 'MOVE API ERROR');
        failLiveItem(
          item,
          hasHazmat(error?.payload) ? 'HAZMAT — ITEM NOT MOVED' : 'MOVE API ERROR — ITEM NOT MOVED',
          reason,
          ctx
        );
        return false;
      }
    }

    if (!currentLiveRun(run)) return false;

    live.nextMoveAt = Date.now() + randomLiveMoveDelayMs();

    const reason = moveReason(response);

    if (isDamagedDestinationResponse(response)) {
      blockLiveDestination(item, 'DESTINATION BLOCKED', 'DESTINATION DAMAGED', ctx, expirationMs);
      return false;
    }

    if (reason === 'HAZMAT' || hasHazmat(response) || /destination incompatible/i.test(reason)) {
      failLiveItem(
        item,
        reason === 'HAZMAT' || hasHazmat(response) ? 'HAZMAT — ITEM NOT MOVED' : 'ITEM / DESTINATION INCOMPATIBLE',
        reason === 'HAZMAT' || hasHazmat(response) ? 'HAZMAT' : (reason || 'DESTINATION INCOMPATIBLE'),
        ctx
      );
      return false;
    }

    if (hasPredicant(response)) {
      blockLiveDestination(item, 'DESTINATION NEEDS ATTENTION', 'PREDICANT — USE/RESET A DIFFERENT DESTINATION', ctx, expirationMs);
      return false;
    }

    if (moveOk(response)) {
      item.acceptedOverage = isAllowedOverageResponse(response);
      finishLiveMoved(item);
      if (item.acceptedOverage) {
        live.note = `OVERAGE OK — moved ${itemQty(item)} unit${itemQty(item) === 1 ? '' : 's'} — ready for next scan`;
        renderLive();
      }
      return true;
    }

    failLiveItem(item, 'MOVE REJECTED — ITEM NOT MOVED', reason || 'MOVE REJECTED', ctx);
    return false;
  }

  async function retryLiveCurrentMove() {
    if (!live.current || live.processing || live.issue) return;

    const item = live.current;
    const ctx = item.retryCtx || item.ctx;
    if (!ctx) {
      retryLiveCurrentFromScan();
      return;
    }

    live.processing = true;
    liveScan.disabled = false;

    try {
      const moved = await liveMoveCurrent(item, ctx, item.retryExpirationMs ?? null);
      if (moved) {
        live.processing = false;
        renderLive();
        setTimeout(() => {
          liveScan.focus();
          pumpLive();
        }, 0);
        return;
      }
    } finally {
      live.processing = false;
      renderLive();
    }
  }

  async function retryLiveCurrentFromScan() {
    if (!live.current || live.processing || live.issue) return;
    live.processing = true;

    try {
      await processLiveCurrent();
    } finally {
      live.processing = false;
      renderLive();
      if (!live.issue && live.running) {
        setTimeout(() => {
          liveScan.focus();
          pumpLive();
        }, 0);
      }
    }
  }

  function parkLiveDateItem(item, ctx) {
    const unitCount = itemQty(item);
    const parkedUnits = [];

    for (let i = 0; i < unitCount; i++) {
      const unit = i === 0
        ? item
        : {
            ...item,
            id:`live-date-${Date.now()}-${i}-${Math.random().toString(16).slice(2)}`,
            resolvePromise:null,
            resolveSettle:null,
            lookupQueued:false,
            lookupStarted:false
          };

      unit.qty = 1;
      unit.ctx = ctx;
      unit.status = 'DATE_PENDING';
      unit.dateResolved = false;
      unit.resolvedExpirationMs = null;
      unit.retryCtx = ctx;
      unit.retryExpirationMs = null;

      parkedUnits.push(unit);
    }

    live.datePending.push(...parkedUnits);

    if (live.current === item) live.current = null;

    live.error = '';
    live.note = unitCount > 1
      ? `parked ${ctx.asin || item.code} ×${unitCount} — date required; split to individual units`
      : live.oneByOne
        ? `expiry required for ${ctx.asin || item.code} — finish this item first`
        : `parked ${ctx.asin || item.code} — date required; continuing queue`;
    if (live.oneByOne) liveScan.disabled = true;
    renderLive();

    if (live.oneByOne) openNextLiveDatePicker();
    else setTimeout(openNextLiveDatePicker, 0);
  }

  function openNextLiveDatePicker() {
    if (!live.running || live.activeDateItem || $('#sh-og-expiry')) return;
    if (!live.oneByOne && (live.processing || live.current || live.queue.length)) return;

    const item = live.datePending.find(candidate => candidate.status === 'DATE_PENDING');
    if (!item?.ctx) return;

    live.activeDateItem = item;
    renderLive();

    showApiDatePicker(item, live).then(chosen => {
      if (live.activeDateItem === item) live.activeDateItem = null;

      if (!chosen || !live.running || !currentLiveRun()) {
        renderLive();
        if (live.oneByOne && live.running && currentLiveRun()) setTimeout(openNextLiveDatePicker, 0);
        return;
      }

      const idx = live.datePending.indexOf(item);
      if (idx >= 0) live.datePending.splice(idx, 1);

      item.dateResolved = true;
      item.resolvedExpirationMs = chosen.finalExpirationMs;
      item.retryExpirationMs = chosen.finalExpirationMs;
      live.error = '';

      if (live.oneByOne) {
        item.status = 'MOVING_DATE';
        live.oneInFlight.set(item.id, item);
        live.note = `date saved for ${item.ctx.asin || item.code} — sending QTY 1`;
        renderLive();
        moveOneByOneResolved(item, item.ctx, chosen.finalExpirationMs);
      } else {
        item.status = 'QUEUED_DATE';
        live.queue.push(item);
        live.note = `date saved for ${item.ctx.asin || item.code} — queued after normal work`;
        renderLive();
        pumpLive();
      }

      setTimeout(openNextLiveDatePicker, 0);
    });
  }

  async function processLiveCurrent() {
    const item = live.current;
    const run = live.activeRun;
    if (!item || !currentLiveRun(run) || !live.running) return;

    if (item.dateResolved && item.ctx) {
      await liveMoveCurrent(item, item.ctx, item.resolvedExpirationMs);
      return;
    }

    if (item.preflightStatus === 'READY' && item.ctx) {
      await liveMoveCurrent(item, item.ctx, null);
      return;
    }

    item.status = 'RESOLVING';
    item.retryCtx = null;
    item.retryExpirationMs = null;

    if (!item.resolvePromise) scheduleLiveLookup(item);

    live.note = item.lookupStarted || item.lookupQueued
      ? `checking ${item.code}`
      : `ready ${item.code}`;
    renderLive();

    const lookup = await item.resolvePromise;
    if (!currentLiveRun(run)) return;

    if (!lookup || lookup.kind === 'aborted') return;

    if (lookup.kind === 'error') {
      failLiveItem(item, 'SCAN API ERROR — ITEM NOT MOVED', lookup.error?.message || 'SCAN API ERROR');
      return;
    }

    const response = lookup.response;
    const ctx = resolveItem(response, item.code);

    if (!ctx.ok) {
      if (ctx.invalid) {
        failLiveItem(item, 'INVALID BARCODE — ITEM NOT MOVED', 'INVALID BARCODE');
        return;
      }

      if (ctx.type === 'RequestMultipleBarcodesResponse') {
        failLiveItem(item, 'MULTIPLE BARCODE MATCHES — ITEM NOT MOVED', 'SCAN A MORE SPECIFIC BARCODE / FNSKU');
        return;
      }

      failLiveItem(item, 'BARCODE NOT RESOLVED — ITEM NOT MOVED', ctx.type || 'NO ITEM DETAILS');
      return;
    }

    item.ctx = ctx;

    // Normal Live also fails closed before /api/move-items when scan metadata says
    // Hazmat. The failed barcode is surfaced while the rest of Live can continue.
    if (hasHazmat(response)) {
      failLiveItem(item, 'HAZMAT — ITEM NOT MOVED', 'HAZMAT', ctx);
      return;
    }

    if (ctx.dateType === 'EXPIRATION_DATE' || ctx.dateType === 'PRODUCTION_DATE') {
      parkLiveDateItem(item, ctx);
      return;
    }

    await liveMoveCurrent(item, ctx, null);
  }

  async function pumpLive() {
    if (!live.running || live.processing || live.issue || live.current) return;
    if (!live.queue.length) {
      live.note = live.datePending.length
        ? `normal queue clear — ${live.datePending.length} expiry item${live.datePending.length === 1 ? '' : 's'} waiting`
        : 'ready — scan next item';
      renderLive();
      if (live.datePending.length) setTimeout(openNextLiveDatePicker, 0);
      liveScan.disabled = false;
      liveScan.focus();
      return;
    }

    live.current = live.queue.shift();
    live.processing = true;
    renderLive();

    try {
      await processLiveCurrent();
    } finally {
      live.processing = false;
      renderLive();

      if (!live.issue && !live.current && live.running) {
        setTimeout(pumpLive, 0);
      } else if (!live.issue && live.current?.status === 'MOVED') {
        live.current = null;
        setTimeout(pumpLive, 0);
      }

      if (!live.issue && live.running) {
        setTimeout(() => liveScan.focus(), 0);
      }
    }
  }

  function enqueueLiveBarcode(code) {
    if (!live.running || !live.sourceReady || !live.dest) {
      live.error = 'Scan SOURCE then DESTINATION first.';
      renderLive();
      return;
    }

    if (live.oneByOne) {
      if (live.issue) {
        live.error = '1×1 is BLOCKED — resolve the destination before scanning another item.';
        renderLive();
        return;
      }
      if (live.datePending.length || live.activeDateItem) {
        live.error = 'EXPIRY REQUIRED — finish the current 1×1 item before scanning another.';
        renderLive();
        return;
      }
      enqueueOneByOneBarcode(code);
      return;
    }

    if (live.issue) {
      live.error = 'DESTINATION ACTION REQUIRED — resolve it before scanning more items.';
      renderLive();
      return;
    }

    const duplicate = live.queue.find(item =>
      item.status === 'QUEUED' &&
      !item.dateResolved &&
      norm(item.code) === norm(code)
    );

    if (duplicate) {
      duplicate.qty = itemQty(duplicate) + 1;

      live.error = '';
      live.note = `merged ${code} → QTY ${duplicate.qty}`;
      renderLive();
      pumpLive();
      return;
    }

    const queuedItem = {
      id:`live-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      code,
      qty:1,
      status:'QUEUED',
      ctx:null,
      resolvePromise:null,
      resolveSettle:null,
      lookupQueued:false,
      lookupStarted:false,
      preflightStatus:'',
      preflightIssue:null
    };

    live.queue.push(queuedItem);

    scheduleLiveLookup(queuedItem);

    live.error = '';
    live.note = `queued ${code} ×1`;
    renderLive();
    pumpLive();
  }

  let liveDateScanBuffer = '';
  let liveDateScanClearTimer = 0;

  function clearLiveDateScanBuffer() {
    liveDateScanBuffer = '';
    if (liveDateScanClearTimer) {
      clearTimeout(liveDateScanClearTimer);
      liveDateScanClearTimer = 0;
    }
  }

  document.addEventListener('keydown', e => {
    if (
      !live.running ||
      !live.activeDateItem ||
      !$('#sh-og-expiry') ||
      e.ctrlKey || e.altKey || e.metaKey
    ) return;

    if (e.target === liveScan) return;

    if (typeof e.key === 'string' && e.key.length === 1) {
      liveDateScanBuffer += e.key;

      if (liveDateScanClearTimer) clearTimeout(liveDateScanClearTimer);
      liveDateScanClearTimer = setTimeout(clearLiveDateScanBuffer, 1200);

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return;
    }

    if (e.key === 'Enter' && liveDateScanBuffer) {
      const code = clean(liveDateScanBuffer);
      clearLiveDateScanBuffer();

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (code) enqueueLiveBarcode(code);
    }
  }, true);

  liveSrc.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== 'Tab') return;
    e.preventDefault();
    acceptLiveSource();
  });

  liveDest.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== 'Tab') return;
    e.preventDefault();
    acceptLiveDestination();
  });

  liveScan.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();

    const code = clean(liveScan.value);
    liveScan.value = '';

    if (!code) return;
    enqueueLiveBarcode(code);

    if (!live.issue && live.running) {
      setTimeout(() => liveScan.focus(), 0);
    }
  });

  livePanel.addEventListener('click', e => {
    const action = e.target.closest?.('[data-live-a]')?.dataset.liveA;
    if (!action) return;

    if (action === 'stop') {
      stopLive();
      return;
    }

    if (action === 'reset') {
      resetLive();
      return;
    }

    if (action === 'focus') {
      if (live.running && !live.issue && !(live.oneByOne && live.datePending.length)) liveScan.focus();
      else if (live.issue?.kind === 'destination') liveDest.focus();
      else if (!live.sourceReady) liveSrc.focus();
      else liveDest.focus();
      return;
    }

    if (action === 'clear-source') {
      clearLiveSource();
      return;
    }

    if (action === 'skip') {
      skipLiveCurrent();
      return;
    }

  });

  renderLive();

  // Lazy
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
    inputCollapsed:false
  };

  const lazyPanel = panel('sh-lazy', `Lazy Sideline v${VERSION}`, 'lazy');
  lazyPanel.insertAdjacentHTML('beforeend',
    '<div class="sh-row">' +
      '<input class="sh-input" data-f="src" placeholder="Source container (csX / tsX)">' +
      '<input class="sh-input" data-f="dest" placeholder="Destination container (csX / tsX)">' +
    '</div>' +
    '<textarea class="sh-input sh-area" data-f="items" placeholder="Scan item barcodes — one per line"></textarea>' +
    '<div class="sh-lazy-input-summary"><span data-lazy-input-summary>0 unique / 0 units</span><button type="button" data-a="toggle-items">Expand</button></div>' +
    '<div class="sh-grid4">' +
      '<button class="sh-btn sh-on" data-a="start">Start</button>' +
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
    '<div class="sh-status"></div><div class="sh-error"></div><div class="sh-result-summary"></div><div class="sh-progress"></div>' +
    '<div id="sh-lazy-footer"><label><input type="checkbox" data-f="clear"> Clear source when done</label></div>'
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

  function refreshItems() {
    if (!lazy.running) {
      lazy.items = parseItems(lItems.value);
      lazy.index = 0;
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
      }
    }

    const remainingUnits = Math.max(0, total - movedUnits - failedUnits);

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
    if (hasHazmat(response) || hasPredicant(response) || isDamagedDestinationResponse(response)) return false;

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

    const itemNotInSource = type === 'ItemNotInContainerResponse';
    const explicitOverage = itemNotInSource || isOverageLabel(type) || diagnosticLabels.some(isOverageLabel);
    if (!explicitOverage) return false;

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
      overage:allowedOverage,
      notInSource:type === 'ItemNotInContainerResponse' || records.every(record => Number(record.quantity) === 0)
    };
  }

  function hasHazmat(value) {
    const seen = new Set();
    const hazardKey = key => /hazmat|dangerous.?goods/i.test(clean(key));
    const negative = /^(?:false|no|none|null|unknown|not[_ -]?hazmat|non[_ -]?hazmat|not[_ -]?dangerous(?:[_ -]?goods)?|non[_ -]?dangerous(?:[_ -]?goods)?)$/i;

    const walk = (node, key='') => {
      if (node == null) return false;

      if (typeof node === 'boolean') return hazardKey(key) && node === true;
      if (typeof node === 'number') return hazardKey(key) && node > 0;

      if (typeof node === 'string') {
        const valueText = clean(node);
        if (!valueText || negative.test(valueText)) return false;
        if (/\bHAZMAT\b/i.test(valueText) && !/\b(?:NOT|NON)[ _-]?HAZMAT\b/i.test(valueText)) return true;
        if (/\bDANGEROUS[ _-]?GOODS\b/i.test(valueText) && !/\b(?:NOT|NON)[ _-]?DANGEROUS[ _-]?GOODS\b/i.test(valueText)) return true;
        return hazardKey(key);
      }

      if (typeof node !== 'object') return false;
      if (seen.has(node)) return false;
      seen.add(node);

      if (Array.isArray(node)) return node.some(child => walk(child, key));
      return Object.entries(node).some(([childKey, child]) => walk(child, childKey));
    };

    return walk(value);
  }

  function hasMoveProblems(response) {
    return Array.isArray(response?.problems) && response.problems.some(Boolean);
  }

  function moveOk(response) {
    if (isAllowedOverageResponse(response)) return true;
    if (!response || response.success !== true) return false;
    if (response.filterResult?.compatible === false) return false;
    if (hasHazmat(response)) return false;
    if (hasMoveProblems(response)) return false;
    if (hasPredicant(response)) return false;

    return true;
  }

  function moveReason(response) {
    if (!response) return 'EMPTY MOVE RESPONSE';
    if (hasHazmat(response)) return 'HAZMAT';
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
      await runExactPredicantRecovery(lazy.src, lazy.dest, setRecovery);

      setRecovery(`Destination reset — revalidating ${lazy.src}...`);

      const sourceResponse = await api(API_SCAN_SOURCE, scanSourcePayload(lazy.src), run);

      if (!currentLazyRun(run) || !sourceResponse || sourceResponse.success !== true) {
        throw new Error('Source revalidation failed after Predicant recovery.');
      }

      lazy.sourceMeta = sourceResponse;
      lazy.predicant = false;
      lazy.paused = false;
      lazy.error = '';
      lazy.note = `Destination reset — retrying ${item.code} ×${item.qty}`;
      shared.owner = 'lazy';
      renderLazy();
      await sleep(180);
      return true;
    } catch (error) {
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

  async function moveResolved(item, ctx, expirationMs=null, run=lazy.activeRun) {
    const totalQty = itemQty(item);

    item.status = 'MOVING';
    lazy.note = `${ctx.asin || ctx.barcode} / ${ctx.fnsku || ctx.barcode} | QTY ${totalQty}`;
    renderLazy();

    const payload = buildMovePayload(lazy.src, lazy.dest, lazy.sourceMeta, ctx, totalQty, expirationMs);

    while (lazy.running && currentLazyRun(run)) {
      let response;

      try {
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
      item.acceptedOverage = isAllowedOverageResponse(response);
      lazy.error = '';
      if (item.acceptedOverage) lazy.note = `OVERAGE OK — moved ${totalQty} unit${totalQty === 1 ? '' : 's'} — continuing`;
      renderLazy();
      return true;
    }

    return false;
  }

  async function resolveOnly(item, run=lazy.activeRun) {
    item.status = 'RESOLVING';
    renderLazy();

    let response;
    try {
      response = await api(API_SCAN_ITEM, scanItemPayload(lazy.src, item.code), run);
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

  function showApiDatePicker(item, owner=lazy) {
    return new Promise(resolve => {
      const ctx = item.ctx;
      const production = ctx.dateType === 'PRODUCTION_DATE';
      const selection = { month:null, day:1, year:null };
      const root = document.createElement('div');
      root.id = 'sh-og-expiry';
      root.dataset.owner = owner === live ? 'live' : 'lazy';
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

        const liveBlitzBanner = owner === live
          ? `<div style="margin-top:7px;padding:7px 9px;background:#dcfce7;border:2px solid #16a34a;border-radius:6px;color:#14532d;font-size:14px;font-weight:1000">ITEM PARKED — KEEP SCANNING; Live continues with later barcodes</div>`
          : '';

        wrap.innerHTML =
          `<div class="og-id"><div>${esc(ctx.asin || '?')} / ${esc(ctx.fnsku || ctx.barcode)}</div><div>REQUIRES ${production?'PRODUCTION':'EXPIRATION'} DATE</div>${liveBlitzBanner}</div>` +
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
        `<div class="og-footer"><button data-a="pao">PAO +900 DAYS &nbsp; ${dateLabel(paoDateMs())}</button><button type="button" class="og-return-source" data-return-source>↩ RETURN TO SOURCE</button></div>`;

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
    if (Date.now() < nativeExpirySuppressedUntil || lazy.running || live.running) return;

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
    lazy.note = `clearing source ${lazy.src}`;
    lazy.error = '';
    renderLazy();

    try {
      const sourceLoaded = () =>
        norm(loadedSourceContainer()) === norm(lazy.src) && !!changeButton();

      if (sourceLoaded()) {
        await nativeCloseLoadedContainer('source', true);
        return true;
      }

      if (await waitForNativeSourceScan(2500)) {
        await nativeOpenSourceContainer(lazy.src, 'source');
        await nativeCloseLoadedContainer('source', true);
        return true;
      }

      const returned = await nativeReturnToOriginalSource(lazy.src);
      if (returned === true || sourceLoaded()) {
        await nativeCloseLoadedContainer('source', true);
        return true;
      }

      throw new Error('Could not safely reach original source in native Sideline.');
    } catch (error) {
      lazy.error = `Moves complete — source clear failed: ${error?.message || error}`;
      return false;
    } finally {
      shared.owner = previousOwner;
    }
  }

  async function startLazy() {
    if (lazy.running) return;
    if (live.running || live.sourceReady) {
      lazy.error = 'Live Lazy is active — stop/reset Live first.';
      renderLazy();
      return;
    }

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

    const run = beginLazyRun();

    lazy.running = true;
    lazy.paused = false;
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

    if (lazy.errors) {
      const movedUnits = lazy.items
        .filter(item => item.status === 'MOVED')
        .reduce((sum,item) => sum + item.qty, 0);

      lazy.error = '';
      lazy.note = `complete | moved ${movedUnits} qty to ${lazy.dest}`;
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

        lazy.dest = nextDest;
        lazy.damagePaused = false;
        lazy.damagedDest = '';
        lazy.paused = false;
        lazy.error = '';
        lazy.note = `resumed with new destination ${lazy.dest}`;
        lDest.classList.remove('bad');
        lDest.classList.add('good');
        actionTarget.textContent = 'Pause';
        stopDamageAttention();
        setLazyRunningIndicator(true);
        renderLazy();
        return;
      }

      lazy.paused = !lazy.paused;
      actionTarget.textContent = lazy.paused ? 'Resume' : 'Pause';
      lazy.note = lazy.paused ? 'paused' : 'resumed';
      if (!lazy.paused) setLazyRunningIndicator(true);
      renderLazy();
    }

    if (a === 'stop') {
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
      shared.owner = '';
      lazy.note = 'stopped';
      renderLazy();
    }

    if (a === 'reset') resetLazy('reset');
  };

  function abandonLiveForReturn() {
    const seen = new Set();
    let abandoned = 0;
    const mark = item => {
      if (!item || seen.has(item) || ['MOVED','SKIPPED'].includes(item.status)) return;
      seen.add(item);
      item.status = 'SKIPPED';
      item.failReason = 'RETURN TO SOURCE — ABANDONED';
      abandoned += itemQty(item);
    };

    mark(live.current);
    mark(live.activeDateItem);
    for (const item of live.oneInFlight.values()) mark(item);
    for (const item of live.datePending) mark(item);

    live.skipped += abandoned;
    return abandoned;
  }

  function stopLiveForReturn(note) {
    cancelLiveRun();
    clearMoveCorner('live');
    live.dateResolve?.(null);
    live.dateResolve = null;
    clearLiveDateScanBuffer();
    clearTimeout(live.oneErrorTimer);
    live.oneErrorTimer = 0;
    live.oneErrorToken++;
    live.oneResult = null;
    clearTimeout(live.failureTimer);
    live.failureTimer = 0;
    live.failureToken++;
    live.failureNotice = null;

    const abandoned = abandonLiveForReturn();
    live.oneInFlight.clear();
    live.running = false;
    live.sourceReady = false;
    live.processing = false;
    live.src = '';
    live.dest = '';
    live.sourceMeta = null;
    live.queue = [];
    live.current = null;
    live.datePending = [];
    live.activeDateItem = null;
    resetLiveLookupPool();
    live.issue = null;
    live.error = '';
    live.note = `${note}${abandoned ? ` — abandoned ${abandoned} active unit${abandoned === 1 ? '' : 's'}` : ''}`;
    live.nextMoveAt = 0;

    liveSrc.disabled = false;
    liveDest.disabled = true;
    liveScan.disabled = true;
    liveSrc.value = '';
    liveDest.value = '';
    liveScan.value = '';
    liveSrc.classList.remove('good','bad','sh-live-idle-pulse');
    liveDest.classList.remove('good','bad','sh-live-idle-pulse');
    renderLive();
  }

  function stopLazyForReturn(note) {
    const wasActive = !!(lazy.running || lazy.activeRun || lazy.predicant || lazy.damagePaused || lazy.dateResolve);
    const current = wasActive ? lazy.items[lazy.index] : null;
    if (current && !['MOVED','FAILED','INVALID'].includes(current.status)) {
      current.status = 'ABANDONED';
      current.failReason = 'RETURN TO SOURCE — ABANDONED';
    }

    cancelLazyRun();
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
      if (expiryRoot.dataset.owner === 'live' || expiryRoot.dataset.owner === 'lazy') return expiryRoot.dataset.owner;
      if (live.running || live.sourceReady || live.current || live.datePending.length || live.issue || live.oneInFlight.size) return 'live';
      if (lazy.running || lazy.activeRun || lazy.predicant || lazy.damagePaused || lazy.dateResolve) return 'lazy';
      if (shared.owner === 'qty' || shared.owner === 'qty-clear') return 'qty';
      return 'native';
    }

    if (button.closest?.('#sh-live')) return 'live';
    if (button.closest?.('#sh-lazy')) return 'lazy';
    if (button.closest?.('#sh-queue')) return 'queue';
    if (button.closest?.('#sh-scrub')) return 'scrub';
    if (button.closest?.('#sh-qty')) return 'qty';
    return 'native';
  }

  function returnSourceCodeForMode(mode) {
    if (mode === 'live') return clean(live.src || loadedSourceContainer());
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
    } else if (mode === 'scrub') {
      escapeEpoch++;
      feature.scrub = false;
      shared.scrubBusy = false;
      renderScrub();
    } else if (mode === 'qty') {
      qtyRequestSeq++;
      qtyClear.disabled = false;
      qtyStatus.textContent = 'Returning to source — quantity action cancelled';
    } else if (mode === 'live') {
      stopLiveForReturn('returned to source');
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

      if (mode === 'live') {
        live.note = message;
        renderLive();
      } else if (mode === 'lazy') {
        lazy.note = `${message} — queue/history preserved`;
        renderLazy();
      } else if (mode === 'queue') {
        renderQueue(message);
      } else if (mode === 'qty') {
        qtyStatus.textContent = message;
      } else if (mode === 'scrub') {
        scrubStatus.textContent = `OFF | ${message}`;
      }
    } catch (error) {
      const message = `RETURN TO SOURCE FAILED — ${error?.message || error}`;
      if (mode === 'live') {
        live.error = message;
        renderLive();
      } else if (mode === 'lazy') {
        lazy.error = message;
        renderLazy();
      } else if (mode === 'queue') {
        qError.textContent = message;
      } else if (mode === 'qty') {
        qtyStatus.textContent = message;
      } else if (mode === 'scrub') {
        scrubStatus.textContent = `OFF | ${message}`;
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

  // Boot
  function boot() {
    document.addEventListener('click', handleUniversalReturnClick, true);
    mountDock();
    applyPanels();
    renderScrub();
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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
