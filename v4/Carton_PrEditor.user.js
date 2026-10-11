// ==UserScript==
// @name V4 Carton PrEditor
// @namespace https://github.com/1Sirkkris/tampermonkey-v4
// @version 0.1.2
// @description Ready barcode/count Complete helper with durable no-repeat evidence.
// @match https://aftcartonpreditorapp-tcp-nrt.nrt.proxy.amazon.com/wf*
// @grant none
// @run-at document-start
// @updateURL https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Carton_PrEditor.user.js
// @downloadURL https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Carton_PrEditor.user.js
// ==/UserScript==
(() => {
  // watermark.mjs
  function registerWatermark(window2, label, version) {
    if (!/^[A-Za-z0-9]{1,5}$/.test(label) || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version)) throw new Error("Invalid V4 runtime identity");
    const document = window2.document, id = "tm-v4-runtime-watermark";
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
      let host = document.getElementById(id);
      if (!host) {
        host = document.createElement("div");
        host.id = id;
        host.dataset.tmV4Script = "RUNTIME";
        host.setAttribute("aria-hidden", "true");
        host.style.cssText = "position:fixed;left:50%;bottom:2px;transform:translateX(-50%);z-index:2147483000;max-width:94vw;padding:2px 7px;border-radius:6px 6px 0 0;background:rgba(255,255,255,.34);color:rgba(15,23,42,.52);font:800 11px/1.25 Arial,sans-serif;letter-spacing:.2px;pointer-events:none;user-select:none;text-align:center;text-shadow:0 1px 1px rgba(255,255,255,.95)";
        document.documentElement.appendChild(host);
      }
      let entry = [...host.children].find((node) => node.dataset.tmV4Runtime === label);
      if (!entry) {
        entry = document.createElement("span");
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
      document.removeEventListener("DOMContentLoaded", mount);
      window2.removeEventListener("pagehide", dispose);
      const host = document.getElementById(id);
      if (!host) return;
      const entry = [...host.children].find((node) => node.dataset.tmV4Runtime === label && node.dataset.tmV4Owner === token);
      entry?.remove();
      render(host);
    }
    mount();
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
    window2.addEventListener("pagehide", dispose, { once: true });
    return dispose;
  }

  // ui-tools.mjs
  var clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  var upper = (value) => clean(value).toUpperCase();
  function isRendered(window2, node) {
    if (!node?.isConnected || node.closest("[hidden]")) return false;
    const style = window2.getComputedStyle(node), rect = node.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && rect.width > 0 && rect.height > 0;
  }
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

  // operation-journal.mjs
  var phases = /* @__PURE__ */ new Set(["QUEUED", "READING", "SUBMITTED", "CONFIRMED", "REJECTED", "UNKNOWN"]);
  function createOperationJournal({ storage, key, normalize = (value) => clean(value), uuid = () => crypto.randomUUID() }) {
    let rows = [], draft = "";
    const saved = storage.getItem(key);
    if (saved) {
      let parsed;
      try {
        parsed = JSON.parse(saved);
      } catch {
        throw new Error("Recovery data is corrupt — preserve it before repair");
      }
      if (parsed.schema !== 1 || !Array.isArray(parsed.rows)) throw new Error("Recovery schema unsupported — no work discarded");
      rows = parsed.rows.map((row) => {
        if (!row || !normalize(row.container) || !phases.has(row.state) || typeof row.id !== "string") throw new Error("Recovery row invalid — no work discarded");
        return { ...row, state: row.state === "SUBMITTED" ? "UNKNOWN" : row.state === "READING" ? "QUEUED" : row.state, message: row.state === "SUBMITTED" ? "Reload interrupted submitted operation — verify native result" : row.message || "" };
      });
      draft = typeof parsed.draft === "string" ? parsed.draft : "";
    }
    function save() {
      const json = JSON.stringify({ schema: 1, rows, draft });
      storage.setItem(key, json);
      if (storage.getItem(key) !== json) throw new Error("Recovery storage did not persist — submission blocked");
    }
    function add(values, details = {}) {
      const added = [];
      for (const value of values) {
        const container = normalize(value);
        if (!container) throw new Error("Invalid container: " + clean(value));
        if (rows.some((row2) => upper(row2.container) === upper(container) && !["CONFIRMED", "REJECTED"].includes(row2.state))) continue;
        const row = { ...details, id: uuid(), container, state: "QUEUED", message: "Queued" };
        rows.push(row);
        added.push(row);
      }
      save();
      return added;
    }
    function transition(row, state, message = "", details = {}) {
      if (!phases.has(state) || !rows.includes(row)) throw new Error("Invalid operation state");
      if (row.state === "UNKNOWN" && state !== "UNKNOWN") throw new Error("UNKNOWN cannot be automatically replayed");
      if (row.state === "SUBMITTED" && !["SUBMITTED", "CONFIRMED", "REJECTED", "UNKNOWN"].includes(state)) throw new Error("Submitted work cannot become runnable");
      const old = { ...row };
      Object.assign(row, details, { state, message });
      try {
        save();
      } catch (error) {
        Object.assign(row, old);
        throw error;
      }
      return row;
    }
    function clearKnown() {
      rows = rows.filter((row) => !["CONFIRMED", "REJECTED"].includes(row.state));
      save();
    }
    function clearConfirmed() {
      rows = rows.filter((row) => row.state !== "CONFIRMED");
      save();
    }
    function clear() {
      rows = rows.filter((row) => ["SUBMITTED", "UNKNOWN"].includes(row.state));
      draft = "";
      save();
    }
    return { get rows() {
      return rows;
    }, get draft() {
      return draft;
    }, setDraft(value) {
      draft = String(value);
      save();
    }, add, transition, clear, clearConfirmed, clearKnown, save, next: () => rows.find((row) => row.state === "QUEUED") };
  }
  async function withOperationLock(window2, name, work) {
    if (typeof window2.navigator.locks?.request !== "function") throw new Error("Browser Web Locks unavailable — operation blocked");
    return window2.navigator.locks.request(name, { mode: "exclusive", ifAvailable: true }, async (lock) => {
      if (!lock) throw new Error("Another V4 tab owns this workflow");
      return work();
    });
  }

  // carton-runtime.mjs
  function createCartonHelper({ window: window2, onEvidence = () => {
  } }) {
    const d = window2.document, events = new window2.AbortController(), storage = window2.localStorage, key = "tm-v4.carton.rows";
    let disposed = false, busy = false, audio, enabled = storage.getItem("tm-v4.carton.enabled") !== "false";
    const root = d.createElement("button");
    root.id = "tm-v4-carton";
    root.dataset.tmV4Script = "CART";
    root.type = "button";
    const style = d.createElement("style");
    style.dataset.tmV4Style = "CART";
    style.textContent = '#tm-v4-carton{position:fixed;right:12px;bottom:12px;z-index:999999;background:#222;color:white;padding:6px 10px;border:0;border-radius:8px;box-shadow:0 2px 5px #0005;font:12px Arial;cursor:pointer}#tm-v4-carton[data-enabled=false]{opacity:.7}#tm-v4-carton::before{content:"";display:inline-block;width:11px;height:11px;border:2px solid #b9e0ff;border-radius:50%;background:#1677c8;margin-right:6px;vertical-align:middle}#tm-v4-carton[data-enabled=false]::before{background:#8b1e6b;border-color:#ffd0ef}';
    function paint(message = "") {
      root.dataset.enabled = String(enabled);
      root.textContent = "AutoComplete: " + (enabled ? "✓ ON" : "× OFF") + (message ? " • " + message : "");
    }
    function beep() {
      try {
        const Audio = window2.AudioContext || window2.webkitAudioContext;
        if (!Audio) return;
        if (!audio || audio.state === "closed") audio = new Audio();
        if (audio.state === "suspended") void audio.resume().catch(() => {
        });
        const base = audio.currentTime + 0.01;
        for (const offset of [0, 0.25]) {
          const oscillator = audio.createOscillator(), gain = audio.createGain();
          oscillator.frequency.value = 880;
          oscillator.connect(gain);
          gain.connect(audio.destination);
          gain.gain.setValueAtTime(0.25, base + offset);
          oscillator.addEventListener("ended", () => {
            oscillator.disconnect();
            gain.disconnect();
          }, { once: true });
          oscillator.start(base + offset);
          oscillator.stop(base + offset + 0.12);
        }
      } catch {
      }
    }
    function readyCarton() {
      const barcode = clean(d.getElementById("input-page-barcode-container-tertiary-text")?.textContent), counts = [...clean(d.body.textContent).matchAll(/Barcodes scanned:\s*(\d+)/gi)].map((match) => Number(match[1])), button = d.getElementById("input-page-button-container-button");
      if (!/^(?:csx[a-z0-9]{5,}|fba[a-z0-9]{8,}|amzn[a-z0-9]{8,}|\d{16,24}|[A-Z0-9]{7,12})$/i.test(barcode) || counts.length !== 1 || counts[0] < 2 || !button || !isRendered(window2, button) || button.disabled || button.getAttribute("aria-disabled") === "true" || button.closest("[hidden],[aria-hidden=true]") || !/^complete\b/i.test(clean(button.textContent))) return null;
      return { barcode, count: counts[0], button };
    }
    async function inspect() {
      if (disposed || busy || !enabled) return;
      const snapshot = readyCarton();
      if (!snapshot) return;
      busy = true;
      let changed = false;
      try {
        await withOperationLock(window2, "tm-v4.carton.owner", async () => {
          if (disposed || !enabled) return;
          const current = readyCarton();
          if (!current || current.barcode !== snapshot.barcode || current.count !== snapshot.count || current.button !== snapshot.button) {
            changed = true;
            paint("Native readiness changed — checking current carton");
            return;
          }
          const { barcode, count, button } = current, journal = createOperationJournal({ storage, key, uuid: () => window2.crypto.randomUUID() });
          if (journal.rows.some((row2) => row2.container.toUpperCase() === barcode.toUpperCase())) {
            paint("Already submitted — verify native result");
            return;
          }
          const row = journal.add([barcode], { count, kind: "carton-complete" })[0];
          journal.transition(row, "SUBMITTED", "Complete control submitted", { operationId: row.id });
          onEvidence({ type: "operation", intent: "mutation", operationId: row.id, phase: "SUBMITTED", data: { kind: "carton-complete" } });
          for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) button.dispatchEvent(new window2.MouseEvent(type, { bubbles: true, cancelable: true }));
          beep();
          journal.transition(row, "UNKNOWN", "Native Complete clicked; physical/backend confirmation unavailable");
          onEvidence({ type: "operation", intent: "mutation", operationId: row.id, phase: "UNKNOWN", data: { kind: "carton-complete" } });
          paint("Submitted • verify native result");
        });
      } catch (error) {
        paint(error.message);
      } finally {
        busy = false;
        if (changed && !disposed) window2.queueMicrotask(() => void inspect());
      }
    }
    root.addEventListener("click", () => {
      enabled = !enabled;
      storage.setItem("tm-v4.carton.enabled", String(enabled));
      paint();
      void inspect();
    }, { signal: events.signal });
    d.body.append(style, root);
    paint();
    let scheduled = false;
    const observer = new window2.MutationObserver((records) => {
      if (records.every((record) => root.contains(record.target))) return;
      if (scheduled) return;
      scheduled = true;
      window2.queueMicrotask(() => {
        scheduled = false;
        void inspect();
      });
    });
    observer.observe(d.querySelector("#root,#app,main") || d.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["disabled", "aria-disabled", "style", "class", "hidden", "aria-hidden"] });
    for (const type of ["input", "change", "keydown"]) d.addEventListener(type, () => void inspect(), { capture: true, signal: events.signal });
    void inspect();
    return { root, inspect, dispose() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      events.abort();
      void audio?.close().catch(() => {
      });
      root.remove();
      style.remove();
    } };
  }

  // carton-entry.mjs
  var VERSION = "0.1.2";
  var guard = Symbol.for("tampermonkey.v4.carton.installer");
  if (!window[guard]) {
    window[guard] = { version: VERSION };
    installRouteLifecycle(window, () => {
      if (window.top !== window.self || !/^\/wf/.test(location.pathname)) return;
      const release = registerWatermark(window, "CART", VERSION), helper = createCartonHelper({ window, onEvidence: (data) => evidence(window, "CART", VERSION, data) });
      return () => {
        helper.dispose();
        release();
      };
    }, () => location.pathname, { waitForDom: true });
  }
})();
