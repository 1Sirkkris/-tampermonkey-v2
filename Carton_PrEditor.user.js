// ==UserScript==
// @name       MAIN  v7.2 Carton PrEditor
// @namespace    http://tampermonkey.net/
// @version      7.2
// @description  Auto-click Complete when a valid barcode appears AND count ≥ 2; beeps + toggle
// @match        https://aftcartonpreditorapp-tcp-nrt.nrt.proxy.amazon.com/wf*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Carton_PrEditor.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Carton_PrEditor.user.js
// ==/UserScript==

(() => {
  'use strict';
  console.log("📦 Carton PrEditor Auto Complete v7.2 (2+ required, no skip) active");

  const BARCODE_ID = "input-page-barcode-container-tertiary-text";
  const BUTTON_ID  = "input-page-button-container-button";

  // Accept: csX..., FBA..., AMZN..., 16–24 digits, and short 7–12 char uppercase/numeric (e.g., 8TS9NWOJ)
  const BARCODE_RE = /(csx[a-z0-9]{5,}|fba[a-z0-9]{8,}|amzn[a-z0-9]{8,}|\d{16,24}|[A-Z0-9]{7,12})/i;
  const COUNT_RE   = /Barcodes scanned:\s*(\d+)/i;

  let enabled = true;
  let lastVal = "";

  // 🔊 two short beeps
  const beepTwice = () => {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const p = t => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = 880;
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.25, ctx.currentTime + t);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.12);
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

  // One observer to detect barcode text updates / element recreation
  new MutationObserver(() => {
    if (!enabled) return;
    const el = document.getElementById(BARCODE_ID);
    if (!el) return;
    const val = el.innerText.trim();
    if (val && val !== lastVal && BARCODE_RE.test(val)) {
      lastVal = val;
      console.log("📠 Detected barcode:", val);
      tryComplete();
    }
  }).observe(document.body, { subtree:true, childList:true, characterData:true });

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
    dot.style.cssText = "width:10px;height:10px;border-radius:50%;background:limegreen;";
    const label = document.createElement("span");
    label.textContent = "AutoComplete: ON";
    div.onclick = () => {
      enabled = !enabled;
      dot.style.background = enabled ? "limegreen" : "red";
      label.textContent    = enabled ? "AutoComplete: ON" : "AutoComplete: OFF";
      div.style.opacity    = enabled ? "1" : "0.7";
    };
    div.append(dot, label);
    document.body.appendChild(div);
  };

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", makeToggle)
    : makeToggle();
})();
