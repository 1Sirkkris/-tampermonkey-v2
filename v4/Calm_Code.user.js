// ==UserScript==
// @name V4 Calm Code
// @namespace https://github.com/1Sirkkris/tampermonkey-v4
// @version 0.1.0
// @description Native labor role toolbox and original form submission.
// @include /^https?:\/\/fcmenu-(?:iad|nrt)-regionalized\.corp\.amazon\.com\/.*(?:laborTrackingKiosk|calmCode)/
// @grant none
// @run-at document-start
// @updateURL https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Calm_Code.user.js
// @downloadURL https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Calm_Code.user.js
// ==/UserScript==
(() => {
  // watermark.mjs
  function registerWatermark(window2, label, version) {
    if (!/^[A-Za-z0-9]{1,5}$/.test(label) || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version)) throw new Error("Invalid V4 runtime identity");
    const document2 = window2.document, id = "tm-v4-runtime-watermark";
    const token = typeof window2.crypto.randomUUID === "function" ? window2.crypto.randomUUID() : [...window2.crypto.getRandomValues(new Uint32Array(4))].map((value) => value.toString(16)).join("-");
    let disposed = false;
    function render(host) {
      const entries = [...host.children].sort((a, b) => a.dataset.tmV4Runtime.localeCompare(b.dataset.tmV4Runtime));
      entries.forEach((entry, index) => {
        entry.textContent = (index ? " | " : "") + "V4 " + entry.dataset.tmV4Runtime + ": " + entry.dataset.tmV4Version;
        host.appendChild(entry);
      });
      if (!entries.length) host.remove();
    }
    function mount() {
      if (disposed) return;
      let host = document2.getElementById(id);
      if (!host) {
        host = document2.createElement("div");
        host.id = id;
        host.dataset.tmV4Script = "RUNTIME";
        host.setAttribute("aria-hidden", "true");
        host.style.cssText = "position:fixed;left:50%;bottom:2px;transform:translateX(-50%);z-index:2147483000;max-width:94vw;padding:2px 7px;border-radius:6px 6px 0 0;background:rgba(255,255,255,.34);color:rgba(15,23,42,.52);font:800 11px/1.25 Arial,sans-serif;letter-spacing:.2px;pointer-events:none;user-select:none;text-align:center;text-shadow:0 1px 1px rgba(255,255,255,.95)";
        document2.documentElement.appendChild(host);
      }
      let entry = [...host.children].find((node) => node.dataset.tmV4Runtime === label);
      if (!entry) {
        entry = document2.createElement("span");
        entry.dataset.tmV4Runtime = label;
        host.appendChild(entry);
      }
      entry.dataset.tmV4Version = version;
      entry.dataset.tmV4Owner = token;
      render(host);
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      document2.removeEventListener("DOMContentLoaded", mount);
      window2.removeEventListener("pagehide", dispose);
      const host = document2.getElementById(id);
      if (!host) return;
      const entry = [...host.children].find((node) => node.dataset.tmV4Runtime === label && node.dataset.tmV4Owner === token);
      entry?.remove();
      render(host);
    }
    mount();
    if (document2.readyState === "loading") document2.addEventListener("DOMContentLoaded", mount, { once: true });
    window2.addEventListener("pagehide", dispose, { once: true });
    return dispose;
  }

  // ui-tools.mjs
  var escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  function evidence(window2, script, version, data) {
    try {
      const record = { script, version, ...data };
      if (record.intent === "mutation" && ["SUBMITTED", "CONFIRMED", "REJECTED", "UNKNOWN"].includes(record.phase) && typeof record.operationId === "string") {
        record.data = { ...record.data, stage: record.type };
        record.type = "operation";
      }
      window2.dispatchEvent(new window2.CustomEvent("tampermonkey-v4:evidence", { detail: JSON.stringify(record) }));
    } catch {
    }
  }
  function installRouteLifecycle(window2, start, context = () => window2.location.pathname + window2.location.search + window2.location.hash, { waitForDom = false } = {}) {
    let dispose = () => {
    }, current = context(), hidden = false, ready = !waitForDom || window2.document.readyState !== "loading";
    const run = () => {
      dispose();
      dispose = ready && !hidden ? start() || (() => {
      }) : (() => {
      });
    };
    const domReady = () => {
      ready = true;
      if (!hidden) run();
    };
    if (!ready) window2.document.addEventListener("DOMContentLoaded", domReady, { once: true });
    run();
    const navigate = () => {
      const next = context();
      if (next !== current) {
        current = next;
        if (!hidden) run();
      }
    };
    const hide = () => {
      hidden = true;
      dispose();
      dispose = () => {
      };
    };
    const show = (event) => {
      if (event.persisted) {
        hidden = false;
        current = context();
        run();
      }
    };
    window2.addEventListener("hashchange", navigate);
    window2.addEventListener("popstate", navigate);
    window2.addEventListener("pagehide", hide);
    window2.addEventListener("pageshow", show);
    return () => {
      hide();
      window2.document.removeEventListener("DOMContentLoaded", domReady);
      window2.removeEventListener("hashchange", navigate);
      window2.removeEventListener("popstate", navigate);
      window2.removeEventListener("pagehide", hide);
      window2.removeEventListener("pageshow", show);
    };
  }

  // calm-runtime.mjs
  var CALM_CODES = Object.freeze([["ISS", [["IBPS", "IBPS"], ["RECON", "RECON"], ["PSBL", "PSBL"], ["ICVR", "ICVR"], ["LPSWEEP", "LPSWEEP"]]], ["Damages", [["ICQADMP", "ICQADMP"], ["DAMAGES", "DAMAGES"]]], ["Etc", [["HRACCOM", "HRACCOM"], ["IB Lead/PA", "LRSR"], ["Non-sort", "FCPRJ"], ["MSTOP", "MSTOP"]]]]);
  function createCalmToolbox({ window: window2, onEvidence = () => {
  } }) {
    const d = window2.document, host = d.getElementById("body"), field = d.getElementById("calmCode");
    if (!host || !field || field.tagName !== "INPUT" || !field.form) return null;
    const root = d.createElement("div");
    root.id = "tm-v4-calm";
    root.dataset.tmV4Script = "CALM";
    root.innerHTML = CALM_CODES.map(([title, roles]) => `<section><h1>${escapeHtml(title)}</h1><div>${roles.map(([name, code]) => `<button type="button" data-code="${code}">${escapeHtml(name)}</button>`).join("")}</div></section>`).join("") + '<p role="status"></p>';
    const style = d.createElement("style");
    style.dataset.tmV4Style = "CALM";
    style.textContent = "#body[data-tm-v4-calm-layout]{display:flex;flex-flow:row nowrap;align-content:space-around;justify-content:space-around}#body[data-tm-v4-calm-layout]>.login{margin:0;width:25%;max-width:300px}#tm-v4-calm{width:75%;flex-grow:2;font:150% Arial;box-sizing:border-box}#tm-v4-calm section{margin-bottom:8px}#tm-v4-calm h1{border-bottom:2px inset;margin:0 0 4px;padding:0 8px;background:#add8e680}#tm-v4-calm section>div{display:flex;flex-flow:row nowrap;justify-content:space-between;padding:0 8px;max-width:1000px}#tm-v4-calm button{max-width:25%;background:white;border-radius:13px;border:2px solid black;color:black;font-size:20px;padding:4px 12px;margin:0 8px;cursor:pointer}#tm-v4-calm button:hover{background:#3cb0fd}#tm-v4-calm button:disabled{opacity:.5;cursor:default}";
    let submitted = false;
    const had = host.hasAttribute("data-tm-v4-calm-layout");
    host.setAttribute("data-tm-v4-calm-layout", "");
    root.addEventListener("click", (event) => {
      const code = event.target.closest("[data-code]")?.dataset.code;
      if (!code || submitted || !field.isConnected || field.disabled || !field.form) return;
      const form = field.form, id = window2.crypto.randomUUID();
      try {
        Object.getOwnPropertyDescriptor(window2.HTMLInputElement.prototype, "value").set.call(field, code);
        for (const type of ["input", "change"]) field.dispatchEvent(new window2.Event(type, { bubbles: true }));
        submitted = true;
        root.querySelectorAll("button").forEach((button) => button.disabled = true);
        onEvidence({ type: "operation", intent: "mutation", operationId: id, phase: "SUBMITTED", data: { kind: "labor-role" } });
        window2.HTMLFormElement.prototype.submit.call(form);
        root.querySelector("[role=status]").textContent = "Submitted • native result pending";
        onEvidence({ type: "operation", intent: "mutation", operationId: id, phase: "UNKNOWN", data: { kind: "labor-role" } });
      } catch (error) {
        root.querySelector("[role=status]").textContent = error.message;
        onEvidence({ type: "operation", intent: "mutation", operationId: id, phase: "UNKNOWN", data: { kind: "labor-role" } });
      }
    });
    host.append(root);
    d.head.append(style);
    return { root, dispose() {
      root.remove();
      style.remove();
      if (!had) host.removeAttribute("data-tm-v4-calm-layout");
    } };
  }

  // calm-entry.mjs
  var VERSION = "0.1.0";
  var guard = Symbol.for("tampermonkey.v4.calm.installer");
  if (!window[guard]) {
    window[guard] = { version: VERSION };
    installRouteLifecycle(window, () => {
      if (window.top !== window.self || !/(?:laborTrackingKiosk|calmCode)/.test(location.pathname) || /^\/do\/laborTrackingKiosk/.test(location.pathname) && location.hostname.startsWith("fcmenu-iad")) return;
      let helper, release, observer;
      const start = () => {
        if (helper) return;
        helper = createCalmToolbox({ window, onEvidence: (data) => evidence(window, "CALM", VERSION, data) });
        if (helper) {
          release = registerWatermark(window, "CALM", VERSION);
          observer?.disconnect();
        }
      };
      start();
      if (!helper) {
        observer = new window.MutationObserver(start);
        observer.observe(document.body, { subtree: true, childList: true });
      }
      return () => {
        observer?.disconnect();
        helper?.dispose();
        release?.();
      };
    }, () => location.pathname, { waitForDom: true });
  }
})();
