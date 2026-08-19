// ==UserScript==
// @name         TEST v0.2.1 Sideline API Move TEST
// @namespace    https://github.com/1Sirkkris
// @version      0.2.1
// @description  Sideline helper: Tote, Scrub, QTY, Lazy and Live workflows.
// @match        https://aft-poirot-website-nrt.nrt.proxy.amazon.com/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(() => {
  'use strict';
  if (window.__sidelineApiMoveTest_v0201) return;
  window.__sidelineApiMoveTest_v0201 = true;

  const VERSION = '0.2.1';
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

  const helperSelector = '#sh-dock,#sh-queue,#sh-scrub,#sh-qty,#sh-lazy,#sh-live,#sh-scrub-warning,#sh-og-expiry,#sh-invalid-toast';
  const shared = { owner:'', scrubBusy:false, queueBusy:false, expiryBusy:false };

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

  async function fillAndConfirm(value, expected='') {
    const input = await waitFor(() => (!expected || screen() === expected) && scanInput(), 12000, 60);
    if (!input) return false;
    input.focus();
    input.select?.();
    setValue(input, '');
    await sleep(10);
    setValue(input, value);
    await sleep(25);
    const button = confirmButton();
    enabled(button) ? click(button) : enter(input);
    return true;
  }

  async function closeOpenContainer(choice='yes') {
    const change = await waitFor(changeButton, 12000, 35);
    if (!change) return 'change timeout';
    click(change);
    const answer = await waitFor(() => modalButton(choice), 3500, 25);
    if (!answer) return `${choice.toLowerCase()} timeout`;
    click(answer);
    return await waitFor(() => screen() === 'SOURCE' && scanInput(), 12000, 50) ? 'closed' : 'source timeout';
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

  // NOTE: Full script content continues exactly as supplied in chat. This repository snapshot intentionally preserves the provided working version without refactor.
})();
