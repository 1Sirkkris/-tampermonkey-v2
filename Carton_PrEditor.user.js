// ==UserScript==
// @name       MAIN v7.3 Carton PrEditor
// @namespace    http://tampermonkey.net/
// @version      7.3
// @description  Auto-click Complete when a valid barcode appears AND count ≥ 2; beeps + toggle
// @match        https://aftcartonpreditorapp-tcp-nrt.nrt.proxy.amazon.com/wf*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Carton_PrEditor.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Carton_PrEditor.user.js
// ==/UserScript==

(() => {
  'use strict';
  const VERSION = '7.3';
  const GUARD_ATTR = 'data-bwu2-carton-preditor';
  if (document.documentElement.hasAttribute(GUARD_ATTR)) return;
  document.documentElement.setAttribute(GUARD_ATTR, VERSION);
  console.log(`📦 Carton PrEditor Auto Complete v${VERSION} (2+ required, no skip) active`);

  const BARCODE_ID = "input-page-barcode-container-tertiary-text";
  const BUTTON_ID  = "input-page-button-container-button";

  // Accept: csX..., FBA..., AMZN..., 16–24 digits, and short 7–12 char uppercase/numeric (e.g., 8TS9NWOJ)
  const BARCODE_RE = /(csx[a-z0-9]{5,}|fba[a-z0-9]{8,}|amzn[a-z0-9]{8,}|\d{16,24}|[A-Z0-9]{7,12})/i;
  const COUNT_RE   = /Barcodes scanned:\s*(\d+)/i;

  let enabled = true;
  let lastVal = "";
  let audioContext = null;

  // 🔊 two short beeps
  const beepTwice = () => {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    if (!audioContext || audioContext.state === 'closed') audioContext = new Audio();
    const ctx = audioContext;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    const base = ctx.currentTime + 0.01;
    const p = t => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = 880;
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.25, base + t);
      o.addEventListener('ended', () => { o.disconnect(); g.disconnect(); }, { once:true });
      o.start(base + t); o.stop(base + t + 0.12);
    };
    p(0); p(0.25);
  };

  // 🖱️ full click sequence for React handlers
  const clickButton = (btn) => ["pointerdown","mousedown","mouseup","click"]
    .forEach(e => btn.dispatchEvent(new MouseEvent(e, { bubbles:true, cancelable:true })));

  const getScannedCount = () => {
    const m = document.body.innerText.match(COUNT_RE);
    return m ? parseInt(m[1], 10) : 0;
  };

  const tryComplete = () => {
    const count = getScannedCount();
    if (count < 2) {
      console.log(`⏸️ Count is ${count} (<2) — not clicking.`);
      return;
    }
    const btn = document.getElementById(BUTTON_ID);
    beepTwice();
    if (btn) {
      console.log("🎯 Clicking Complete (count ≥ 2)");
      clickButton(btn);
    } else {
      console.log("⚠️ Button not found, sending key 'c'");
      document.dispatchEvent(new KeyboardEvent("keydown", { key:"c", code:"KeyC", keyCode:67, bubbles:true }));
    }
  };

  const inspectBarcode = () => {
    if (!enabled) return;
    const el = document.getElementById(BARCODE_ID);
    if (!el) return;
    const val = String(el.innerText || el.textContent || '').trim();
    if (val && val !== lastVal && BARCODE_RE.test(val)) {
      lastVal = val;
      console.log("📠 Detected barcode:", val);
      tryComplete();
    }
  };

  // Observe the barcode's local React area after hydration. A short interaction
  // watchdog reacquires it if React replaces the parent without a document mutation.
  let barcodeObserver = null;
  let observerTarget = null;
  let recoveryTimer = 0;
  let recoveryUntil = 0;

  const attachBarcodeObserver = () => {
    const barcode = document.getElementById(BARCODE_ID);
    const target = barcode?.parentElement || document.body;
    if (!target) return;
    if (target !== observerTarget) {
      barcodeObserver?.disconnect();
      observerTarget = target;
      barcodeObserver = new MutationObserver(() => {
        attachBarcodeObserver();
        inspectBarcode();
      });
      barcodeObserver.observe(target, { subtree:true, childList:true, characterData:true });
    }
    inspectBarcode();
  };

  const armRecoveryWatchdog = (durationMs = 5000) => {
    recoveryUntil = Math.max(recoveryUntil, Date.now() + durationMs);
    if (recoveryTimer) return;
    const poll = () => {
      recoveryTimer = 0;
      attachBarcodeObserver();
      if (Date.now() < recoveryUntil) recoveryTimer = setTimeout(poll, 250);
    };
    recoveryTimer = setTimeout(poll, 250);
  };

  for (const type of ['keydown', 'input', 'change']) {
    document.addEventListener(type, () => armRecoveryWatchdog(), true);
  }

  // ON/OFF toggle
  const makeToggle = () => {
    const div = document.createElement("div");
    div.style.cssText = `
      position:fixed;bottom:12px;right:12px;z-index:999999;
      display:flex;align-items:center;gap:6px;
      background:#222;color:#fff;font:12px Arial;padding:6px 10px;
      border-radius:8px;box-shadow:0 2px 5px rgba(0,0,0,.3);
      cursor:pointer;user-select:none;`;
    const dot = document.createElement("div");
    dot.style.cssText = "width:11px;height:11px;border-radius:50%;background:#1677c8;border:2px solid #b9e0ff;";
    const label = document.createElement("span");
    label.textContent = "AutoComplete: ✓ ON";
    div.onclick = () => {
      enabled = !enabled;
      dot.style.background = enabled ? "#1677c8" : "#8b1e6b";
      dot.style.borderColor = enabled ? "#b9e0ff" : "#ffd0ef";
      label.textContent    = enabled ? "AutoComplete: ✓ ON" : "AutoComplete: × OFF";
      div.style.opacity    = enabled ? "1" : "0.7";
      if (enabled) armRecoveryWatchdog(2000);
    };
    div.append(dot, label);
    document.body.appendChild(div);
  };

  const start = () => {
    makeToggle();
    attachBarcodeObserver();
    armRecoveryWatchdog(12000);
  };

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", start, { once:true })
    : start();

  window.addEventListener('pagehide', () => {
    barcodeObserver?.disconnect();
    clearTimeout(recoveryTimer);
  }, { once:true });
})();
