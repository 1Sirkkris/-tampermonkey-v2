// ==UserScript==
// @name V4 ISS Console
// @namespace https://github.com/1Sirkkris/tampermonkey-v4
// @version 0.1.0
// @description Familiar FCR Edit/Move/Sideline with bundled native-origin workers.
// @match http://fcresearch-fe.aka.amazon.com/*
// @match https://fcresearch-fe.aka.amazon.com/*
// @match http://qi-fcresearch-fe.corp.amazon.com/*
// @match https://qi-fcresearch-fe.corp.amazon.com/*
// @match http://qi-fcresearch-jp.corp.amazon.com/*
// @match https://qi-fcresearch-jp.corp.amazon.com/*
// @match http://qifcr.fe.aftx.amazonoperations.app/*
// @match https://qifcr.fe.aftx.amazonoperations.app/*
// @include /^https?:\/\/aft-qt-[^/]+\.corp\.amazon\.com\/app\/(?:edititems|moveitems|fcskuflip)/
// @match https://aft-poirot-website-nrt.nrt.proxy.amazon.com/*
// @grant unsafeWindow
// @grant GM_xmlhttpRequest
// @connect pandash.amazon.com
// @connect fcresearch-fe.aka.amazon.com
// @connect qi-fcresearch-fe.corp.amazon.com
// @connect qi-fcresearch-jp.corp.amazon.com
// @connect qifcr.fe.aftx.amazonoperations.app
// @run-at document-start
// @updateURL https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/ISS_Console.user.js
// @downloadURL https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/ISS_Console.user.js
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

  // aft-client.mjs
  var AFT_MODES = Object.freeze({ each: { title: "Edit • Each", instructionId: "EditItems", tool: "edititems", path: "/app/edititems", input: "EACH" }, sku: { title: "Edit • SKU", instructionId: "EditItems", tool: "edititems", path: "/app/edititems", input: "SKU" }, date: { title: "Edit • Date", instructionId: "EditItems", tool: "edititems", path: "/app/edititems", input: "DATELOT" }, flip: { title: "Edit • FCSKU", instructionId: "FcSkuFlip", tool: "fcskuflip", path: "/app/fcskuflip", input: "SKU" }, moveEach: { title: "Move • Each", instructionId: "MoveItems", tool: "moveitems", path: "/app/moveitems", input: "EACH" }, moveAll: { title: "Move • Multi", instructionId: "MoveItems", tool: "moveitems", path: "/app/moveitems", input: "MULTI" }, moveContainer: { title: "Move • Container", instructionId: "MoveItems", tool: "moveitems", path: "/app/moveitems", input: "CONTAINER" } });
  var editSteps = [["location", /scan location|scan container|input location|enter location|enter container/i], ["item", /input fnsku or fcsku|input item|scan item|enter the sku|enter item/i], ["sourceState", /select source inventory state/i], ["sourceDisp", /select source disposition/i], ["newState", /select new inventory state/i], ["newDisp", /select new disposition/i], ["dateRemove", /confirm expiry date removal|remove expiry date/i], ["dateEntry", /enter expiry date|enter expiration date/i], ["dateConfirm", /confirm new expiry date|save expiry date/i], ["confirm", /confirm change|confirm to continue/i], ["success", /success items changed|items changed from|current expiry date:/i], ["error", /work is errored|service failed|failed to change consumer type/i]];
  function classifyAft(text2, tool) {
    if (tool === "fcskuflip") {
      if (/success/i.test(text2)) return "success";
      if (/confirm flip/i.test(text2)) return "confirm";
      if (/enter new (?:fnsku|fcsku)/i.test(text2)) return "new";
      if (/input item/i.test(text2) && /fnskus/i.test(text2)) return "old";
      if (/scan container/i.test(text2)) return "location";
      return "unknown";
    }
    if (tool === "moveitems") {
      if (/verify item/i.test(text2)) return "verify";
      if (/success|items moved|moved items/i.test(text2)) return "success";
      if (/scan destination|destination container/i.test(text2)) return "destination";
      if (/quantity/i.test(text2)) return "quantity";
      if (/scan item|input item/i.test(text2)) return "item";
      if (/scan (?:source )?container/i.test(text2)) return "location";
      return "unknown";
    }
    let found = ["unknown", Infinity];
    for (const [state, rx] of editSteps) {
      const m = rx.exec(text2);
      if (m && m.index < found[1]) found = [state, m.index];
    }
    return found[0];
  }
  function parseAftPage(window2, html, definition) {
    const doc = new window2.DOMParser().parseFromString(html, "text/html");
    let objectId = "", instructionId = "";
    for (const node of doc.querySelectorAll('script[type="a-state"]')) {
      let data;
      try {
        data = JSON.parse(node.textContent);
      } catch {
        continue;
      }
      const walk = (value) => {
        if (!value || typeof value !== "object") return;
        if (value.objectId) {
          if (objectId && objectId !== value.objectId) throw new Error("Conflicting native workflow IDs");
          objectId = String(value.objectId);
          instructionId = value.instructionId || instructionId;
        }
        for (const v of Object.values(value)) if (v && typeof v === "object") walk(v);
      };
      walk(data);
    }
    if (!objectId) {
      const source = html.replace(/&quot;|&#34;|&#x22;/gi, '"');
      const match = source.match(/"objectId"\s*:\s*"([^"<]+)"/);
      objectId = match?.[1] || "";
      instructionId = source.match(/"instructionId"\s*:\s*"([^"]+)"/)?.[1] || "";
    }
    if (!objectId || instructionId && instructionId !== definition.instructionId) throw new Error("Exact native workflow identity unavailable");
    for (const node of doc.querySelectorAll('script,style,noscript,template,[hidden],[aria-hidden=true],.aok-hidden,.a-hidden,[style*="display:none"],[style*="display: none"],[data-tm-v4-script]')) node.remove();
    const text2 = clean(doc.body.textContent);
    return { objectId, doc, text: text2, raw: html, state: classifyAft(text2, definition.tool), selector: !!doc.querySelector("input[name=options]") };
  }
  function aftSourceChoices(snapshot) {
    const rows = [];
    for (const radio of snapshot.doc.querySelectorAll("input[type=radio]")) {
      const label = clean([...radio.labels || []].map((node) => node.textContent).join(" ") || radio.closest("label")?.textContent);
      if (!/Owner\s*:/i.test(label) || !/Quantity\s*:/i.test(label)) continue;
      const state = /pending research|PENDING_RESEARCH/i.test(label) ? "PENDING_RESEARCH" : /unsellable/i.test(label) ? "UNSELLABLE" : /inventory|sellable/i.test(label) ? "SELLABLE" : "";
      const qty = Number(label.match(/Quantity\s*:\s*(\d{1,7})/i)?.[1]);
      if (state && Number.isInteger(qty)) rows.push({ state, qty, value: clean(radio.value), disabled: radio.disabled });
    }
    return rows;
  }
  function aftQuantity(snapshot) {
    if (snapshot.state === "verify") throw new Error("Native Verify Item requires manual review");
    const rawValues = [...(snapshot.raw || "").matchAll(/(?:"|&quot;)quantity(?:"|&quot;)\s*:\s*(?:"|&quot;)?(\d{1,7})\b/gi)].map((m) => Number(m[1]));
    if (rawValues.length && new Set(rawValues).size === 1 && rawValues[0] > 0) return rawValues[0];
    const values = [...snapshot.text.matchAll(/\bQuantity\s*[:=-]?\s*(\d{1,7})\b/gi)].map((m) => Number(m[1]));
    const unique = [...new Set(values)];
    if (unique.length !== 1 || unique[0] < 1) throw new Error("Exact native quantity unavailable/ambiguous");
    return unique[0];
  }
  function createAftClient({ window: window2, fetch = window2.fetch.bind(window2), onStage = () => {
  } }) {
    async function request(path, payload, { signal, timeout = 25e3 } = {}) {
      const controller = new window2.AbortController(), cancel = () => controller.abort();
      if (signal?.aborted) cancel();
      signal?.addEventListener("abort", cancel, { once: true });
      const timer = window2.setTimeout(cancel, timeout);
      try {
        const response = await fetch(path, { method: payload ? "POST" : "GET", credentials: "same-origin", cache: "no-store", headers: payload ? { "Content-Type": "application/json; charset=utf-8", "Accept": "application/json, text/javascript, */*; q=0.01", "X-Requested-With": "XMLHttpRequest" } : void 0, body: payload ? JSON.stringify(payload) : void 0, signal: controller.signal });
        const target = new window2.URL(response.url || path, window2.location.origin);
        if (response.redirected || target.origin !== window2.location.origin || target.pathname !== new window2.URL(path, window2.location.origin).pathname) throw new Error("Native AFT redirected/auth response");
        const raw = await response.text();
        if (!response.ok) throw Object.assign(new Error("Native AFT HTTP " + response.status), { outcome: response.status >= 400 && response.status < 500 ? "REJECTED" : "UNKNOWN" });
        return raw;
      } finally {
        window2.clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
      }
    }
    const id = (definition, objectId) => ({ id: { instructionId: definition.instructionId, objectId } });
    async function page2(definition, expected = "", signal) {
      const html = await request(definition.path + "?experience=Desktop", null, { signal });
      if (!/<html|<body|a-state/i.test(html)) throw new Error("Native AFT page is not HTML");
      const snap = parseAftPage(window2, html, definition);
      if (expected && snap.objectId !== expected) throw new Error("Native AFT workflow changed");
      return snap;
    }
    async function wait2(definition, objectId, { signal, complete = false, timeout = 12e4 } = {}) {
      const deadline = Date.now() + timeout;
      let polls = 0;
      while (Date.now() < deadline) {
        const raw = await request("/status", id(definition, objectId), { signal });
        let data;
        try {
          data = JSON.parse(raw);
        } catch {
          throw new Error("Invalid native status JSON");
        }
        const state = String(data?.status || "").toUpperCase();
        onStage("status " + state);
        if (state === "ERRORED") throw Object.assign(new Error("Native backend ERRORED"), { outcome: "REJECTED" });
        if (state === (complete ? "COMPLETE" : "READY")) return state;
        if (state !== "PROCESSING") throw new Error("Unexpected native status " + state);
        await delay(Math.min(300, 60 + ++polls * 35), signal);
      }
      throw new Error("Native AFT status timeout");
    }
    function delay(ms, signal) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new Error("Cancelled"));
        const cancel = () => {
          window2.clearTimeout(timer);
          reject(new Error("Cancelled"));
        };
        const timer = window2.setTimeout(() => {
          signal?.removeEventListener("abort", cancel);
          resolve();
        }, ms);
        signal?.addEventListener("abort", cancel, { once: true });
      });
    }
    async function action(definition, objectId, action2, input, options = {}) {
      onStage(action2);
      await request("/action", { ...id(definition, objectId), action: action2, input }, options);
      return wait2(definition, objectId, options);
    }
    async function end(definition, objectId, signal) {
      await request("/end", { ...id(definition, objectId), tool: definition.tool }, { signal });
    }
    async function fresh(definition, previous = "", signal) {
      const deadline = Date.now() + 8e3;
      while (Date.now() < deadline) {
        const snap = await page2(definition, "", signal);
        if (snap.objectId !== previous) {
          await wait2(definition, snap.objectId, { signal, timeout: 8e3 });
          return snap;
        }
        await delay(100, signal);
      }
      throw new Error("Fresh native workflow unavailable");
    }
    return { page: page2, wait: wait2, action, end, fresh, delay, id };
  }
  function renderedAftQuantity(window2, definition, expected, { signal, timeout = 3500 } = {}) {
    return new Promise((resolve, reject) => {
      const d = window2.document, frame = d.createElement("iframe");
      frame.dataset.tmV4Script = "AFT";
      frame.setAttribute("aria-hidden", "true");
      frame.tabIndex = -1;
      frame.style.cssText = "position:fixed;left:-12000px;top:0;width:1280px;height:900px;opacity:0;pointer-events:none;border:0";
      let done = false, observer = null;
      const finish = (value, error) => {
        if (done) return;
        done = true;
        observer?.disconnect();
        window2.clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
        frame.remove();
        if (error) reject(error);
        else resolve(value);
      }, cancel = () => finish(null, new Error("Quantity read cancelled"));
      function assess() {
        if (done) return;
        try {
          const doc = frame.contentDocument;
          if (!doc?.body) return;
          const snap = parseAftPage(window2, doc.documentElement.outerHTML, definition);
          if (snap.objectId !== expected) return finish(null, new Error("Rendered native workflow changed"));
          if (snap.state === "verify") return finish(null, new Error("Native Verify Item requires manual review"));
          try {
            finish(aftQuantity(snap));
          } catch {
          }
        } catch {
        }
      }
      const timer = window2.setTimeout(() => finish(null, new Error("Rendered native quantity unavailable")), timeout);
      signal?.addEventListener("abort", cancel, { once: true });
      frame.addEventListener("load", () => {
        if (done) return;
        try {
          const doc = frame.contentDocument;
          if (doc?.body) {
            observer?.disconnect();
            observer = new window2.MutationObserver(assess);
            observer.observe(doc.body, { subtree: true, childList: true, characterData: true });
          }
        } catch {
        }
        assess();
      });
      const url = new window2.URL(definition.path + "?experience=Desktop", window2.location.origin);
      url.hash = "tm-v4-aft-quantity";
      frame.src = url.href;
      d.documentElement.append(frame);
      if (signal?.aborted) cancel();
    });
  }

  // aft-workflow.mjs
  var AFT_KEY = "tm-v4.aft.rows";
  function parseAftRows(mode, text2, meta = {}) {
    const lines = String(text2).split(/\r?\n/).map(clean).filter(Boolean), rows = [];
    if (mode === "each") {
      for (const line of lines) {
        const [location2, asin, fnsku, ...extra] = line.split(/\s+/);
        if (!location2 || !asin || extra.length) throw new Error("EACH rows require TOTE ASIN [FNSKU]");
        rows.push({ location: location2, code: fnsku || asin, asin });
      }
    } else if (mode === "date") {
      const seen = /* @__PURE__ */ new Map();
      for (const line of lines) {
        const [code, date, ...extra] = line.split(/\s+/);
        if (!code || extra.length || !/^\d{4}-\d{2}-\d{2}$/.test(date || "")) throw new Error("Date rows require CODE YYYY-MM-DD");
        const [y, m, d] = date.split("-").map(Number), actual = new Date(y, m - 1, d);
        if (actual.getFullYear() !== y || actual.getMonth() !== m - 1 || actual.getDate() !== d) throw new Error("Invalid calendar date");
        if (seen.has(upper(code)) && seen.get(upper(code)) !== date) throw new Error("Duplicate code has different dates");
        if (!seen.has(upper(code))) rows.push({ location: clean(meta.location), code, date });
        seen.set(upper(code), date);
      }
    } else {
      const values = String(text2).split(/[\s,;]+/).map(clean).filter(Boolean), seen = /* @__PURE__ */ new Set();
      for (const code of values) {
        if (upper(code) === "123START" || mode.startsWith("move") && /^(?:ts|cs)x[A-Za-z0-9_-]+$/i.test(code)) continue;
        if (mode === "sku" || mode === "flip") {
          if (seen.has(upper(code))) continue;
          seen.add(upper(code));
        }
        rows.push(mode === "flip" ? { location: code, code: clean(meta.old), newCode: clean(meta.newCode) } : { code });
      }
    }
    if (!rows.length) throw new Error("Enter at least one valid row");
    for (const row of rows) {
      if (!row.code || upper(row.code) === "123START") throw new Error("Control scan cannot be an item");
      if (["each", "date", "flip"].includes(mode) && !row.location) throw new Error("Container/location required");
    }
    return rows.map((row) => ({ ...meta, ...row, mode }));
  }
  function exactInventoryQuantity(result, container, aliases) {
    if (!result?.complete || !Array.isArray(result.rows)) throw new Error("Complete inventory readback unavailable");
    let qty = 0;
    for (const row of result.rows) {
      if (upper(row.container) !== upper(container)) throw new Error("Readback contains another container");
      if (!Number.isInteger(row.qty) || row.qty < 0) throw new Error("Readback quantity invalid");
      if (["fcsku", "fnsku", "asin"].some((field) => row[field] && aliases.includes(upper(row[field])))) qty += row.qty;
    }
    return qty;
  }
  function createAftRunner({ window: window2, client, identity, reader, onChange = () => {
  }, onEvidence = () => {
  }, onInventory = () => {
  } }) {
    let journal = createOperationJournal({ storage: window2.localStorage, key: AFT_KEY, uuid: () => window2.crypto.randomUUID() }), busy = false, stopped = false, disposed = false, active3 = null, controller = null, promise = null;
    const changed = (message) => onChange(message, journal.rows);
    const emit = (row, phase) => onEvidence({ type: "operation", intent: "mutation", operationId: row.operationId, phase, data: { kind: "aft-" + row.mode, stage: row.stage || "" } });
    function state(row, next, message, details = {}) {
      journal.transition(row, next, message, details);
      changed(message);
    }
    function check() {
      if (disposed) throw new Error("Page disposed");
      if (stopped) throw new Error("Stopped before next submission");
      identity();
    }
    async function action(row, definition, id, name, input, { mutation = false, complete = false, settle = false } = {}) {
      if (!settle) check();
      state(row, mutation ? "SUBMITTED" : row.state, "Native " + name, { objectId: id, stage: name, prepared: true, ...mutation ? { operationId: window2.crypto.randomUUID() } : {} });
      if (mutation) emit(row, "SUBMITTED");
      return client.action(definition, id, name, input, { signal: mutation || settle ? void 0 : controller.signal, complete, timeout: complete ? 18e4 : 12e4 });
    }
    async function snapshot(definition, id) {
      return client.page(definition, id, active3?.state === "SUBMITTED" ? void 0 : controller.signal);
    }
    function expect(snap, state2) {
      if (snap.state !== state2) {
        const error = new Error("Expected native " + state2 + ", got " + snap.state);
        if (snap.state === "error" && /failed to change consumer type/i.test(snap.text || "")) error.outcome = "REJECTED";
        throw error;
      }
    }
    async function finish(row, message) {
      if (disposed || row.state === "UNKNOWN") throw new Error("Disposed submitted outcome remains UNKNOWN");
      const operationId = row.operationId;
      state(row, "CONFIRMED", message, { completedOperations: operationId ? [...row.completedOperations || [], { operationId, phase: "CONFIRMED" }] : row.completedOperations || [], operationId: null });
      if (operationId) emit({ ...row, operationId }, "CONFIRMED");
    }
    async function target(row, definition, id) {
      const wanted = row.desiredState || "INVENTORY";
      if (!["INVENTORY", "PENDING_RESEARCH", "UNSELLABLE"].includes(wanted)) throw new Error("Invalid target inventory state");
      await action(row, definition, id, "Input", wanted);
      let snap = await snapshot(definition, id);
      if (wanted === "UNSELLABLE") {
        expect(snap, "newDisp");
        if (!["AMAZON_DAMAGE", "DEFECTIVE", "DISTRIBUTOR_DAMAGE", "EXPIRED"].includes(row.desiredDamage)) throw new Error("Invalid target disposition");
        await action(row, definition, id, "Input", row.desiredDamage);
        snap = await snapshot(definition, id);
      }
      expect(snap, "confirm");
      return snap;
    }
    async function confirm(row, definition, id) {
      let snap;
      for (let n = 0; n < 10; n++) {
        await action(row, definition, id, "Confirm", "Confirm", { mutation: true });
        snap = await snapshot(definition, id);
        if (snap.state !== "confirm") return snap;
        if (stopped) throw new Error("Additional confirmation remains after Stop — verify native outcome");
      }
      throw new Error("Native confirmation limit reached");
    }
    async function closeKnown(definition, id) {
      await client.end(definition, id);
    }
    async function prepare(row, definition, first) {
      let snap = await client.fresh(definition, "", controller.signal);
      await client.wait(definition, snap.objectId, { signal: controller.signal });
      expect(snap, first);
      return snap;
    }
    async function editEach(row) {
      const def = AFT_MODES.each, snap = await prepare(row, def, "location"), id = snap.objectId;
      await action(row, def, id, "Input", row.location);
      expect(await snapshot(def, id), "item");
      await action(row, def, id, "Input", row.code);
      expect(await snapshot(def, id), "newState");
      await target(row, def, id);
      const result = await confirm(row, def, id);
      if (!["success", "item"].includes(result.state)) throw new Error("Native EACH change not confirmed");
      await finish(row, "Native EACH change confirmed");
      if (result.state === "success") await action(row, def, id, "Done", "Done", { complete: true, settle: true });
      await closeKnown(def, id);
    }
    async function editSku(row) {
      const def = AFT_MODES.sku;
      let previous = "", lastQty = null;
      for (let round = 0; round < 50; round++) {
        check();
        const snap = await client.fresh(def, previous, controller.signal), id = snap.objectId;
        expect(snap, "item");
        state(row, "READING", "SKU lookup / quantity");
        await action(row, def, id, "Input", row.code);
        const source = await snapshot(def, id);
        expect(source, "sourceState");
        const choices = aftSourceChoices(source);
        onInventory(choices, row);
        const wanted = row.currentState === "INVENTORY" ? "SELLABLE" : row.currentState, matches = choices.filter((x) => x.state === wanted && !x.disabled);
        if (matches.length !== 1) throw new Error("Exact source owner/state missing or ambiguous");
        const choice = matches[0];
        if (lastQty !== null && choice.qty >= lastQty) throw new Error("Confirmed SKU change made no verified quantity progress");
        if (choice.qty === 0) {
          await closeKnown(def, id);
          await finish(row, "Native source quantity zero");
          return;
        }
        lastQty = choice.qty;
        await action(row, def, id, "Input", choice.value || row.currentState);
        if (wanted === "UNSELLABLE") {
          expect(await snapshot(def, id), "sourceDisp");
          await action(row, def, id, "Input", row.currentDamage);
        }
        expect(await snapshot(def, id), "newState");
        await target(row, def, id);
        expect(await confirm(row, def, id), "success");
        await finish(row, "Native SKU change confirmed; rechecking source");
        await action(row, def, id, "Done", "Done", { complete: true, settle: true });
        await closeKnown(def, id);
        previous = id;
        if (stopped) return;
      }
      throw new Error("SKU iteration limit — remaining source quantity requires review");
    }
    async function skuWithRecovery(row) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await editSku(row);
        } catch (error) {
          if (error.outcome !== "REJECTED" || stopped || disposed || !row.objectId || attempt === 2) throw error;
          state(row, "REJECTED", "Known native rejection — bounded fresh-workflow recovery");
          if (row.operationId) emit(row, "REJECTED");
          await closeKnown(AFT_MODES.sku, row.objectId);
          await client.fresh(AFT_MODES.sku, row.objectId, controller.signal);
          state(row, "READING", "Fresh workflow; rechecking native source quantity", { prepared: false, operationId: null });
        }
      }
    }
    async function flip(row) {
      const def = AFT_MODES.flip;
      if (!row.newCode || upper(row.code) === upper(row.newCode)) throw new Error("OLD and NEW must differ");
      const snap = await prepare(row, def, "location"), id = snap.objectId;
      await action(row, def, id, "Input", row.location);
      expect(await snapshot(def, id), "old");
      await action(row, def, id, "Input", row.code);
      expect(await snapshot(def, id), "new");
      await action(row, def, id, "Input", row.newCode);
      expect(await snapshot(def, id), "confirm");
      await action(row, def, id, "Confirm", "Confirm", { mutation: true });
      expect(await snapshot(def, id), "success");
      await finish(row, "Native FCSKU Flip success confirmed");
      await closeKnown(def, id);
    }
    async function date(row) {
      const def = AFT_MODES.date;
      let snap = await prepare(row, def, "location"), id = snap.objectId;
      const lookup = async () => {
        await action(row, def, id, "Input", row.location);
        expect(await snapshot(def, id), "item");
        await action(row, def, id, "Input", row.code);
        return snapshot(def, id);
      };
      snap = await lookup();
      if (snap.state === "dateRemove") {
        await action(row, def, id, "Confirm", "Confirm", { mutation: true });
        expect(await snapshot(def, id), "success");
        await finish(row, "Native old-date removal confirmed; replacement pending");
        await closeKnown(def, id);
        check();
        snap = await client.fresh(def, id, controller.signal);
        id = snap.objectId;
        expect(snap, "location");
        state(row, "READING", "Replacing removed date", { removedDate: true });
        snap = await lookup();
      }
      expect(snap, "dateEntry");
      const [y, m, d] = row.date.split("-");
      await action(row, def, id, "Input", JSON.stringify({ "year-input": y, "month-input": m, "day-input": d, "": "" }));
      expect(await snapshot(def, id), "dateConfirm");
      await action(row, def, id, "Confirm", "Confirm", { mutation: true });
      expect(await snapshot(def, id), "success");
      await finish(row, "Native new expiry date confirmed");
      await closeKnown(def, id);
    }
    async function move(row) {
      const def = AFT_MODES[row.mode];
      if (!/^(?:ts|cs)x[A-Za-z0-9_-]+$/i.test(row.source || "") || !/^(?:ts|cs)x[A-Za-z0-9_-]+$/i.test(row.destination || "") || upper(row.source) === upper(row.destination)) throw new Error("Distinct valid source/destination required");
      const cap = typeof reader === "function" ? reader() : reader;
      if (!cap) throw new Error("Authenticated FCR readback capability required");
      const product = await cap.product(row.code, { signal: controller.signal, resolveBarcode: true });
      if (!product.complete || !product.product) throw new Error("Exact item identity unavailable");
      const aliases = [upper(product.product.fcsku || product.product.fnsku || product.product.asin)], beforeSource = exactInventoryQuantity(await cap.inventory(row.source, { signal: controller.signal }), row.source, aliases), beforeDest = exactInventoryQuantity(await cap.inventory(row.destination, { signal: controller.signal }), row.destination, aliases);
      const snap = await prepare(row, def, "location"), id = snap.objectId;
      await action(row, def, id, "Input", row.source);
      expect(await snapshot(def, id), "item");
      await action(row, def, id, "Input", row.code);
      let qty = 1;
      if (row.mode === "moveAll") {
        const native = await snapshot(def, id);
        expect(native, "quantity");
        let available;
        try {
          available = aftQuantity(native);
        } catch (error) {
          if (native.state === "verify") throw error;
          available = await renderedAftQuantity(window2, def, id, { signal: controller.signal });
        }
        qty = row.quantityMode === "user" ? Number(row.quantity) : available;
        if (!Number.isInteger(qty) || qty < 1 || qty > available || qty > beforeSource) throw new Error("Requested native quantity unavailable");
        await action(row, def, id, "Input", String(qty));
      }
      expect(await snapshot(def, id), "destination");
      await action(row, def, id, "Input", row.destination, { mutation: true });
      const after = await snapshot(def, id);
      if (!["item", "success"].includes(after.state)) throw new Error("Native destination did not advance");
      const afterSource = exactInventoryQuantity(await cap.inventory(row.source), row.source, aliases), afterDest = exactInventoryQuantity(await cap.inventory(row.destination), row.destination, aliases);
      if (beforeSource - afterSource !== qty || afterDest - beforeDest !== qty) throw new Error("Exact source/destination quantity readback not confirmed");
      await finish(row, "Exact native quantity movement confirmed • " + qty);
      await action(row, def, id, "Done", "Done", { complete: true, settle: true });
      await closeKnown(def, id);
    }
    async function run(items) {
      if (busy || disposed) return;
      busy = true;
      stopped = false;
      promise = withOperationLock(window2, "tm-v4.aft.owner", async () => {
        journal = createOperationJournal({ storage: window2.localStorage, key: AFT_KEY, uuid: () => window2.crypto.randomUUID() });
        if (journal.rows.some((x) => ["UNKNOWN", "SUBMITTED"].includes(x.state))) throw new Error("Unresolved AFT submission blocks replay/mode change");
        journal.save();
        const queued = journal.rows.filter((row) => row.state === "QUEUED");
        if (queued.length && items.some((item) => !journal.rows.some((row) => ["mode", "code", "location", "source", "destination", "desiredState", "desiredDamage", "currentState", "currentDamage", "date", "newCode", "quantity", "quantityMode"].every((key) => row[key] === item[key])))) throw new Error("Saved queued work has different inputs — Clear safe rows first");
        const added = queued.length ? queued : items.map((item) => journal.add([item.mode + " " + (item.location || item.source || "") + " " + item.code + " " + window2.crypto.randomUUID()], item)[0]);
        changed("Starting");
        for (const row of added) {
          if (stopped || disposed) break;
          active3 = row;
          controller = new window2.AbortController();
          state(row, "READING", "Native preflight");
          try {
            await { each: editEach, sku: skuWithRecovery, date, flip, moveEach: move, moveAll: move }[row.mode](row);
          } catch (error) {
            if (row.state !== "UNKNOWN") {
              const phase = row.state === "SUBMITTED" || row.prepared || row.removedDate ? "UNKNOWN" : "REJECTED";
              state(row, error.outcome === "REJECTED" ? "REJECTED" : phase, error.message);
              if (row.operationId) emit(row, row.state);
            }
            stopped = true;
          } finally {
            active3 = null;
            controller = null;
          }
        }
      }).catch((error) => changed(error.message)).finally(() => {
        busy = false;
        promise = null;
        changed(stopped ? "Stopped; recovery rows retained" : "Run settled");
      });
      await promise;
    }
    async function switchMode(mode, { navigate = true } = {}) {
      if (busy || disposed) return;
      const definition = AFT_MODES[mode];
      if (!definition) throw new Error("Unsupported mode");
      await runModeSwitch(definition, mode, navigate);
    }
    async function runModeSwitch(definition, mode, navigate) {
      busy = true;
      try {
        await withOperationLock(window2, "tm-v4.aft.owner", async () => {
          journal = createOperationJournal({ storage: window2.localStorage, key: AFT_KEY, uuid: () => window2.crypto.randomUUID() });
          if (journal.rows.some((x) => ["UNKNOWN", "SUBMITTED", "QUEUED"].includes(x.state))) throw new Error("Resolve/clear queued AFT work before mode change");
          const row = journal.add(["Mode " + mode + " " + window2.crypto.randomUUID()], { mode: "mode", kind: "native-mode" })[0];
          active3 = row;
          controller = new window2.AbortController();
          state(row, "READING", "Native mode switch");
          try {
            let snap = await client.page(definition);
            await client.wait(definition, snap.objectId);
            const selected = snap.text?.match(/Mode\s*:\s*(Each|Sku|Datelot|Multi|Container)/i)?.[1]?.toUpperCase();
            if (!snap.selector && (mode === "flip" || selected === definition.input)) {
              state(row, "CONFIRMED", "Native mode already selected");
              return;
            }
            if (!snap.selector) {
              await action(row, definition, snap.objectId, "SelectMode", "SelectMode");
              snap = await client.page(definition, snap.objectId);
              if (!snap.selector) throw new Error("Native mode selector unavailable");
            }
            await action(row, definition, snap.objectId, "Input", definition.input, { complete: true });
            await closeKnown(definition, snap.objectId);
            await client.fresh(definition, snap.objectId);
            state(row, "CONFIRMED", "Native mode selected");
            if (navigate) window2.location.assign(definition.path + "?experience=Desktop");
          } catch (error) {
            state(row, row.prepared ? "UNKNOWN" : "REJECTED", error.message);
            throw error;
          }
        });
      } finally {
        active3 = null;
        controller = null;
        busy = false;
        changed("Mode switch settled");
      }
    }
    function stop() {
      stopped = true;
      if (active3?.state !== "SUBMITTED") controller?.abort();
      changed(active3?.state === "SUBMITTED" ? "Stop requested — settling submitted outcome" : "Stopped before next submission");
    }
    async function clear() {
      stop();
      if (promise) await promise;
      await withOperationLock(window2, "tm-v4.aft.owner", async () => {
        journal = createOperationJournal({ storage: window2.localStorage, key: AFT_KEY, uuid: () => window2.crypto.randomUUID() });
        journal.clear();
        changed("Cleared safe rows; UNKNOWN retained");
      });
    }
    return { run, switchMode, stop, clear, get busy() {
      return busy;
    }, get rows() {
      return journal.rows;
    }, dispose() {
      if (disposed) return;
      stopped = disposed = true;
      if (active3) {
        try {
          state(active3, active3.state === "SUBMITTED" || active3.prepared ? "UNKNOWN" : "REJECTED", "Page disposed — native outcome requires review");
          if (active3.operationId) emit(active3, active3.state);
        } catch {
        }
      }
      controller?.abort();
    } };
  }

  // sideline-workflow.mjs
  var validSidelineContainer = (value) => /^(?:csX|tsX)[A-Za-z0-9_-]+$/i.test(clean(value));
  function parseSidelineItems(text2, source, destination) {
    const map = /* @__PURE__ */ new Map();
    for (const raw of String(text2).split(/\r?\n/)) {
      const value = clean(raw), key = upper(value);
      if (!value || ["123START", upper(source), upper(destination)].includes(key)) continue;
      if (validSidelineContainer(value)) continue;
      const row = map.get(key);
      if (row) row.quantity++;
      else map.set(key, { code: value, quantity: 1 });
    }
    return [...map.values()];
  }
  function createSidelineWorkflow({ window: window2, client, preflight, pickDate, onChange = () => {
  }, onEvidence = () => {
  } }) {
    const key = "tm-v4.sideline.rows", uuid = () => window2.crypto.randomUUID();
    let journal = createOperationJournal({ storage: window2.localStorage, key, uuid }), running = false, busy = false, paused = false, disposed = false, active3 = null, attentionRow = null, readController, wake, scanResolve, attention = "", message = "", stopStage = 0, dates = /* @__PURE__ */ new Map(), sourceMeta = null;
    const notify = () => onChange({ running, busy, paused, attention, message, rows: journal.rows, stopStage });
    const signal = () => {
      readController = new window2.AbortController();
      return readController.signal;
    };
    function check() {
      if (disposed || !running || paused) throw new Error("Workflow halted before submission");
    }
    async function control() {
      if (!running || disposed) return false;
      if (!paused) return true;
      await new Promise((r) => wake = r);
      wake = null;
      return running && !disposed;
    }
    async function waitScan(kind, row) {
      attentionRow = row;
      attention = kind;
      paused = true;
      message = kind === "predicant" ? "RESCAN DESTINATION " + row.destination + " — known rejected move" : "DESTINATION DAMAGED — scan a different destination";
      notify();
      const dest = await new Promise((r) => scanResolve = r);
      scanResolve = null;
      return running && !disposed ? dest : null;
    }
    function submit(row, id) {
      check();
      journal.transition(row, "SUBMITTED", "Submitted — awaiting native result", { requestId: id, attempts: (row.attempts || 0) + 1 });
      notify();
      onEvidence({ type: "sideline.submit", intent: "mutation", phase: "SUBMITTED", operationId: id, data: { kind: row.kind, state: "SUBMITTED" } });
    }
    function settle(row, result) {
      journal.transition(row, result.outcome, result.reason || "Confirmed by typed native response");
      notify();
      if (result.outcome === "UNKNOWN") {
        running = false;
        paused = false;
        message = "UNKNOWN — verify native outcome before any retry";
        notify();
      }
      onEvidence({ type: "sideline.result", intent: "mutation", phase: result.outcome, operationId: row.requestId, data: { kind: row.kind, state: result.outcome } });
    }
    async function close(container, kind) {
      check();
      const existing = journal.rows.find((r) => upper(r.container) === upper(container) && ["UNKNOWN", "SUBMITTED", "QUEUED", "READING"].includes(r.state));
      if (existing) throw new Error("Unresolved native close exists for " + container);
      const row = journal.add([container], { mode: "close", kind, quantity: 0 })[0];
      active3 = row;
      journal.transition(row, "READING", "Validating close source");
      notify();
      await client.source(container, { signal: signal() });
      check();
      const result = await client.close(container, { signal: readController.signal, beforeMutation: (id) => submit(row, id) });
      settle(row, result);
      return result;
    }
    async function move(row, meta, ctx, date) {
      while (running && !disposed) {
        if (!await control()) return;
        journal.transition(row, "READING", "Ready to move");
        active3 = row;
        const result = await client.move({ source: row.source, destination: row.destination, sourceMeta: meta, ctx, quantity: row.quantity, expiration: date }, { signal: signal(), beforeMutation: (id) => submit(row, id) });
        settle(row, result);
        if (result.outcome === "UNKNOWN") return;
        if (result.outcome === "CONFIRMED") return;
        if (!running) return;
        if (result.predicant) {
          while (running) {
            const dest = await waitScan("predicant", row);
            if (!dest) return;
            attention = "recovery";
            paused = false;
            notify();
            let cleared;
            try {
              cleared = await close(dest, "predicant-close");
            } catch (error) {
              if (active3?.state === "SUBMITTED") {
                journal.transition(active3, "UNKNOWN", error.message);
                running = false;
                message = "UNKNOWN close — verify destination; item NOT retried";
                notify();
                return;
              }
              if (active3?.state === "READING") journal.transition(active3, "REJECTED", error.message);
              message = "Destination clear failed — rescan deliberately to retry";
              notify();
              continue;
            }
            if (cleared.outcome === "UNKNOWN") return;
            if (cleared.outcome === "CONFIRMED") {
              attention = "";
              paused = false;
              break;
            }
            message = "Destination clear rejected — rescan deliberately to retry";
            notify();
          }
          if (!running) return;
          active3 = row;
          continue;
        }
        if (result.damaged) {
          const dest = await waitScan("damaged", row);
          if (!dest) return;
          for (const pending of journal.rows.filter((r) => r.mode === "lazy" && ["QUEUED", "READING"].includes(r.state))) journal.transition(pending, pending.state, pending.message, { destination: dest });
          journal.transition(row, "READING", "New destination chosen", { destination: dest });
          paused = false;
          attention = "";
          continue;
        }
        return;
      }
    }
    async function run(mode, options = {}) {
      if (busy || disposed) return;
      busy = true;
      stopStage = 0;
      message = "";
      try {
        await withOperationLock(window2, "tm-v4.sideline.owner", async () => {
          journal = createOperationJournal({ storage: window2.localStorage, key, uuid });
          if (journal.rows.some((r) => ["SUBMITTED", "UNKNOWN"].includes(r.state))) throw new Error("UNKNOWN recovery rows require native verification before another run");
          journal.clearKnown();
          if (mode === "lazy" && (!validSidelineContainer(options.source) || !validSidelineContainer(options.destination) || upper(options.source) === upper(options.destination))) throw new Error("Valid different source and destination required");
          if (mode === "lazy" && journal.rows.some((r) => r.mode === "lazy" && r.state === "QUEUED" && (upper(r.source) !== upper(options.source) || upper(r.destination) !== upper(options.destination)))) throw new Error("Saved unsubmitted batch uses another source/destination — Reset explicitly before changing it");
          let list = mode === "queue" ? [...new Set((options.containers || []).filter(validSidelineContainer))].map((code) => ({ code, quantity: 0 })) : options.items || [];
          if (!list.length && !journal.rows.some((r) => r.mode === mode && r.state === "QUEUED")) throw new Error(mode === "queue" ? "No containers" : "No item barcodes");
          for (const item of list) {
            if (!item.code || !Number.isInteger(item.quantity) || item.quantity < 0) throw new Error("Invalid queue item");
            journal.add([item.code], { mode, kind: mode === "queue" ? "queue-close" : "move", source: options.source || "", destination: options.destination || "", quantity: item.quantity });
          }
          running = true;
          paused = false;
          attention = "";
          notify();
          await client.bootstrap({ signal: signal() });
          if (!await control()) return;
          if (mode === "lazy") {
            sourceMeta = await client.source(options.source, { signal: signal() });
            if (!await control()) return;
          }
          while (running && !disposed) {
            if (!await control()) break;
            const row = journal.rows.find((r) => r.mode === mode && r.state === "QUEUED");
            if (!row) break;
            active3 = row;
            journal.transition(row, "READING", "Preflight");
            notify();
            try {
              if (mode === "queue") {
                await client.source(row.container, { signal: signal() });
                if (!await control()) break;
                const result = await client.close(row.container, { signal: readController.signal, beforeMutation: (id) => submit(row, id) });
                settle(row, result);
              } else {
                const result = await preflight(row.source, row.container, { signal: signal() });
                if (!await control()) break;
                if (result.kind === "red") {
                  journal.transition(row, "REJECTED", "ASIDE • " + result.reason);
                  notify();
                  continue;
                }
                if (result.kind === "retry" || !result.ctx) throw new Error(result.reason || "Preflight failed");
                let date = dates.get(upper(row.container)) ?? null;
                if (result.kind === "yellow" && date === null) {
                  attention = "date";
                  notify();
                  date = await pickDate({ code: row.container, ctx: result.ctx, signal: readController.signal });
                  if (date === null || !running) {
                    journal.transition(row, "QUEUED", "Date cancelled — not submitted");
                    if (paused) continue;
                    running = false;
                    break;
                  }
                  dates.set(upper(row.container), date);
                  attention = "";
                }
                if (!await control()) break;
                await move(row, sourceMeta, result.ctx, date);
                if (running && row.state === "CONFIRMED" && options.delay) {
                  const ms = 2e3 + window2.crypto.getRandomValues(new Uint32Array(1))[0] % 6001;
                  message = "Delay " + Math.ceil(ms / 1e3) + "s";
                  notify();
                  await new Promise((resolve) => {
                    const timer = window2.setTimeout(resolve, ms);
                    readController = new window2.AbortController();
                    readController.signal.addEventListener("abort", () => {
                      window2.clearTimeout(timer);
                      resolve();
                    }, { once: true });
                  });
                }
              }
            } catch (error) {
              const target = active3 || row;
              if (target.state === "SUBMITTED") {
                journal.transition(target, error.outcome === "REJECTED" ? "REJECTED" : "UNKNOWN", error.message);
                if (target.state === "UNKNOWN") {
                  running = false;
                  message = "UNKNOWN — verify before retry";
                }
              } else if (target.state === "READING") {
                if (!running || paused) {
                  journal.transition(target, "QUEUED", "Stopped before submission");
                } else journal.transition(target, "REJECTED", error.message);
              }
              notify();
            }
          }
          if (running && mode === "lazy" && options.clearSource) {
            const batch = journal.rows.filter((r) => r.mode === "lazy" && r.source === options.source);
            if (batch.length && batch.every((r) => r.state === "CONFIRMED")) {
              try {
                await close(options.source, "source-clear");
              } catch (error) {
                if (active3?.state === "SUBMITTED") journal.transition(active3, "UNKNOWN", error.message);
                else if (active3?.state === "READING") journal.transition(active3, "REJECTED", error.message);
                message = error.message;
              }
            } else message = "Source retained: some items were not confirmed";
          }
        });
      } catch (error) {
        message = error.message;
      } finally {
        if (active3?.state === "READING") try {
          journal.transition(active3, "QUEUED", "Stopped before submission");
        } catch {
        }
        running = false;
        busy = false;
        paused = false;
        attention = "";
        active3 = null;
        readController = null;
        dates.clear();
        notify();
      }
    }
    function scan(code) {
      const value = clean(code);
      if (attention === "predicant") {
        if (upper(value) === upper(attentionRow?.destination) && scanResolve) {
          const resolve = scanResolve;
          scanResolve = null;
          resolve(value);
          return true;
        }
        return validSidelineContainer(value);
      }
      if (attention === "damaged") {
        if (validSidelineContainer(value) && upper(value) !== upper(attentionRow?.source) && upper(value) !== upper(attentionRow?.destination) && scanResolve) {
          const resolve = scanResolve;
          scanResolve = null;
          resolve(value);
          return true;
        }
        return validSidelineContainer(value);
      }
      return false;
    }
    function pause() {
      if (!running || attention === "predicant" || attention === "damaged" || attention === "recovery") return;
      paused = !paused;
      if (paused && active3?.state !== "SUBMITTED") readController?.abort();
      if (!paused) wake?.();
      notify();
    }
    function stop() {
      stopStage++;
      if (running) {
        running = false;
        paused = false;
        attention = "";
        if (active3?.state !== "SUBMITTED") readController?.abort();
        wake?.();
        scanResolve?.(null);
        message = "Stopped — submitted request settles; recovery rows retained";
        notify();
        return;
      }
      if (stopStage >= 2) {
        try {
          journal.clear();
        } catch (error) {
          message = error.message;
        }
        dates.clear();
        message = "Reset unsubmitted/known rows; UNKNOWN retained";
        notify();
      }
    }
    function reset() {
      if (running) {
        stop();
        return;
      }
      journal.clear();
      dates.clear();
      stopStage = 0;
      message = "Reset — UNKNOWN retained";
      notify();
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      running = false;
      paused = false;
      try {
        if (active3?.state === "SUBMITTED") journal.transition(active3, "UNKNOWN", "Page disposed after submission");
        else if (active3?.state === "READING") journal.transition(active3, "QUEUED", "Page disposed before submission");
      } catch {
      }
      readController?.abort();
      wake?.();
      scanResolve?.(null);
    }
    return { run, scan, pause, stop, reset, dispose, getRows: () => journal.rows, getState: () => ({ running, busy, paused, attention, message, stopStage }), setDate: (code, value) => dates.set(upper(code), value) };
  }

  // date-picker.mjs
  function localDate(month, day, year) {
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date.getTime() : null;
  }
  function chosenExpiration(ctx, entered, { native = false, now = Date.now() } = {}) {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    if (!Number.isFinite(entered)) throw new Error("Invalid date");
    if (ctx.dateType === "PRODUCTION_DATE") {
      if (entered > today.getTime()) throw new Error("Production date must be today or earlier");
      if (native) return entered;
      const shelf = Number(ctx.dateDetail?.shelfLife);
      if (!Number.isFinite(shelf) || shelf < 0 || ctx.dateDetail?.shelfLife === null || ctx.dateDetail?.shelfLife === void 0) throw new Error("Native shelf life missing — no guessed expiration");
      const expires = entered + shelf;
      return expires;
    }
    if (entered < today.getTime()) throw new Error("Expiration must be today or later");
    return entered;
  }
  function createDatePicker(window2, { owner = "SIDE" } = {}) {
    let cancelCurrent = () => {
    };
    const pick = ({ code, ctx, signal, native = false }) => new Promise((resolve) => {
      const existing = window2.document.getElementById("tm-v4-date-picker");
      existing?.dispatchEvent(new window2.Event("tm-v4-date:replace"));
      cancelCurrent();
      const d = window2.document, root = d.createElement("div"), style = d.createElement("style");
      root.id = "tm-v4-date-picker";
      root.dataset.tmV4Script = owner;
      style.dataset.tmV4Script = owner;
      style.textContent = `#tm-v4-date-picker{position:fixed;inset:0;z-index:1000010;display:flex;align-items:center;justify-content:center;background:#0008;font:14px Arial;color:#172033}#tm-v4-date-picker .wrap{max-width:1100px;width:96vw;padding:12px;background:#f8fafc;border:2px solid #334155;border-radius:8px}#tm-v4-date-picker .preview{display:flex;gap:12px;align-items:center;padding:8px;background:white;margin-bottom:10px}#tm-v4-date-picker img{width:90px;max-height:105px;object-fit:contain}#tm-v4-date-picker .panels{display:grid;grid-template-columns:1fr 2fr 1.5fr;gap:10px}#tm-v4-date-picker section{border:1px solid #94a3b8;border-radius:5px;overflow:hidden}#tm-v4-date-picker h3{margin:0;background:#e2e8f0;padding:8px;display:flex;justify-content:space-between}#tm-v4-date-picker .grid{display:grid;gap:5px;padding:7px;grid-template-columns:repeat(4,1fr)}#tm-v4-date-picker .days{grid-template-columns:repeat(7,1fr)}#tm-v4-date-picker button{padding:9px;border:1px solid #94a3b8;border-radius:4px;background:white;font-weight:800;cursor:pointer}#tm-v4-date-picker button.selected{background:#146eb4;color:white}#tm-v4-date-picker button:disabled{opacity:.35;cursor:default}#tm-v4-date-picker footer{display:flex;gap:10px;margin-top:10px}#tm-v4-date-picker [data-error]{color:#b91c1c;font-weight:bold}`;
      d.head.append(style);
      d.body.append(root);
      let month = null, day = 1, year = null, done = false;
      const production = ctx.dateType === "PRODUCTION_DATE", today = /* @__PURE__ */ new Date();
      today.setHours(0, 0, 0, 0);
      function finish(value) {
        if (done) return;
        done = true;
        signal?.removeEventListener("abort", abort);
        root.remove();
        style.remove();
        cancelCurrent = () => {
        };
        resolve(value);
      }
      const abort = () => finish(null);
      cancelCurrent = abort;
      root.addEventListener("tm-v4-date:replace", abort, { once: true });
      signal?.addEventListener("abort", abort, { once: true });
      const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
      function permitted(m, d2, y) {
        const entered = localDate(m, d2, y);
        if (entered === null) return false;
        try {
          chosenExpiration(ctx, entered, { native });
          return true;
        } catch {
          return false;
        }
      }
      function render(error = "") {
        const image = clean(ctx.sku?.imageUrl || ctx.sku?.img || ctx.sku?.image);
        const safeImage = /^https?:\/\//i.test(image) ? image : "";
        root.innerHTML = `<div class="wrap"><b>${escapeHtml(ctx.asin || "")} / ${escapeHtml(ctx.fnsku || code)} • REQUIRES ${production ? "PRODUCTION" : "EXPIRATION"} DATE</b><div class="preview">${safeImage ? `<img src="${escapeHtml(safeImage)}" alt="">` : ""}<section><strong>${escapeHtml(ctx.sku?.title || ctx.sku?.normalizedTitle || "Item title unavailable")}</strong><div>SCAN: ${escapeHtml(code)}</div></section></div><div class="panels"><section><h3>MONTH <b>${month ? months[month - 1] : "—"}</b></h3><div class="grid">${months.map((m, i) => `<button data-month="${i + 1}" class="${month === i + 1 ? "selected" : ""}">${m}</button>`).join("")}</div></section><section><h3>DAY <b>${day}</b></h3><div class="grid days">${Array.from({ length: 31 }, (_, i) => i + 1).map((v) => `<button data-day="${v}" class="${day === v ? "selected" : ""}" ${!month || v > new Date(2e3, month, 0).getDate() ? "disabled" : ""}>${v}</button>`).join("")}</div></section><section><h3>YEAR <b>${year || "—"}</b></h3><div class="grid">${Array.from({ length: 16 }, (_, i) => today.getFullYear() + (production ? -i : i)).map((v) => `<button data-year="${v}" class="${year === v ? "selected" : ""}" ${!month || !permitted(month, day, v) ? "disabled" : ""}>${v}</button>`).join("")}</div></section></div><footer>${production ? `<button data-apply ${year ? "" : "disabled"}>USE PRODUCTION DATE</button>` : "<button data-pao>PAO +900 DAYS</button>"}<button data-cancel>↩ RETURN TO SOURCE / CANCEL</button><span data-error>${escapeHtml(error)}</span></footer></div>`;
      }
      root.addEventListener("click", (event) => {
        const b = event.target.closest("button");
        if (!b || b.disabled) return;
        if (b.dataset.month) {
          month = Number(b.dataset.month);
          day = 1;
          year = null;
          render();
          return;
        }
        if (b.dataset.day) {
          day = Number(b.dataset.day);
          year = null;
          render();
          return;
        }
        if (b.dataset.year) {
          year = Number(b.dataset.year);
          if (production) {
            render();
            return;
          }
        } else if (b.hasAttribute("data-pao")) {
          const date = new Date(today);
          date.setDate(date.getDate() + 900);
          finish(date.getTime());
          return;
        } else if (b.hasAttribute("data-cancel")) {
          finish(null);
          return;
        } else if (!b.hasAttribute("data-apply")) return;
        try {
          finish(chosenExpiration(ctx, localDate(month, day, year), { native }));
        } catch (error) {
          render(error.message);
        }
      });
      render();
      if (signal?.aborted) abort();
    });
    return { pick, dispose: () => cancelCurrent() };
  }

  // iss-runtime.mjs
  function createIssConsole({ window: window2, bridgeFactory, version, onEvidence = () => {
  } }) {
    const d = window2.document, events = new window2.AbortController(), picker = createDatePicker(window2, { owner: "ISSC" }), journals = {}, activeRows = {}, promises = {}, busy = {}, stopStages = {}, liveRows = {}, quantityRows = {};
    let disposed = false, active3 = "edit", dateController = null, sideAttention = "", sideNativeMessage = "";
    const root = d.createElement("section");
    root.id = "tm-v4-iss";
    root.dataset.tmV4Script = "ISSC";
    const style = d.createElement("style");
    style.dataset.tmV4Style = "ISSC";
    style.textContent = "#tm-v4-iss{position:fixed;inset:0;overflow:auto;z-index:999990;background:#eaeded;color:#172033;font:13px Arial;box-sizing:border-box}#tm-v4-iss *{box-sizing:border-box}#tm-v4-iss header{height:72px;padding:0 24px;display:flex;align-items:center;justify-content:space-between;background:white;border-bottom:1px solid #c8d0d8;box-shadow:0 1px 2px #0002}#tm-v4-iss .brand{font-size:24px;font-weight:800;color:#17324d}#tm-v4-iss .site{font-size:18px;color:#ff9900;margin-right:10px}#tm-v4-iss .accent{height:3px;background:#ff9900}#tm-v4-iss .workers{display:flex;align-items:center;gap:9px;font-size:10px;font-weight:bold}#tm-v4-iss .grid{display:grid;grid-template-columns:1.85fr 1fr 1fr;gap:14px;padding:18px 20px;min-height:calc(100vh - 75px)}#tm-v4-iss .grid[data-active=move]{grid-template-columns:1fr 1.85fr 1fr}#tm-v4-iss .grid[data-active=sideline]{grid-template-columns:1fr 1fr 1.85fr}#tm-v4-iss .panel{min-width:0;display:flex;flex-direction:column;background:white;border:1px solid #b8c2cc;border-radius:4px;box-shadow:0 1px 3px #0002}#tm-v4-iss .panel[data-active=true]{border-color:#4b789f;box-shadow:0 2px 8px #1d44662e}#tm-v4-iss h2{margin:0;min-height:68px;padding:18px 14px;background:#f3f4f5;border-bottom:1px solid #cbd2d9;font-size:23px;color:#17324d}#tm-v4-iss .body{padding:12px;display:flex;flex-direction:column;gap:9px;flex:1}#tm-v4-iss .modes,#tm-v4-iss .choices,#tm-v4-iss .actions{display:flex;gap:5px;flex-wrap:wrap}#tm-v4-iss button{border:1px solid #8796a5;border-radius:3px;padding:7px;background:#f7f8fa;color:#21364a;font:800 12px Arial;cursor:pointer}#tm-v4-iss .modes button,#tm-v4-iss .choices button{flex:1}#tm-v4-iss button[data-selected=true]{background:#17324d;color:white}#tm-v4-iss button:disabled{opacity:.45;cursor:default}#tm-v4-iss label{display:flex;flex-direction:column;gap:5px;font-weight:bold}#tm-v4-iss input,#tm-v4-iss textarea{padding:8px;border:1px solid #8f9eac;border-radius:3px;width:100%;font:14px Arial;color:#172033;background:white}#tm-v4-iss textarea{height:180px;min-height:120px;resize:vertical;font:13px monospace}#tm-v4-iss .arrow{text-align:center;font-weight:bold;color:#81909f}#tm-v4-iss .actions button{flex:1}#tm-v4-iss [data-action=run]{background:#146eb4;border-color:#0f5f9d;color:white}#tm-v4-iss [role=status]{padding:7px 0;font-weight:700;overflow-wrap:anywhere}#tm-v4-iss .rows{max-height:190px;overflow:auto;font:11px monospace;overflow-wrap:anywhere}#tm-v4-iss [data-state=CONFIRMED]{color:#176b35}#tm-v4-iss [data-state=REJECTED]{color:#a63520}#tm-v4-iss [data-state=UNKNOWN],#tm-v4-iss [data-state=SUBMITTED]{background:#fff0b3;color:#664b0a}#tm-v4-iss .metrics{display:flex;gap:8px;font-size:11px;font-weight:bold}#tm-v4-iss .aside{background:#fff0b3;padding:7px;border:1px solid #d3a753;font-weight:bold}#tm-v4-iss .qty-cards{display:grid;gap:5px;background:#f0f5f8;padding:7px;font-weight:bold;font-size:10px}#tm-v4-iss [data-qty-list]{display:grid;gap:4px;max-height:91px;overflow:auto}#tm-v4-iss .qty-row{display:grid;grid-template-columns:1.25fr repeat(3,1fr);gap:5px;background:white;padding:6px;border:1px solid #c5cfd6}#tm-v4-iss .qty-row code{overflow:hidden;text-overflow:ellipsis}#tm-v4-iss .qty-row b{text-align:center;font:800 17px monospace;color:#17324d}#tm-v4-iss [hidden]{display:none}@media(max-width:1100px){#tm-v4-iss .grid{padding:10px;gap:9px}#tm-v4-iss .body{padding:8px}#tm-v4-iss button{font-size:11px;padding:5px}}";
    const choices = (field, values) => `<input type="hidden" data-field="${field}" value="${values[0][0]}"><div class="choices">${values.map(([value2, label]) => `<button data-choice="${field}" data-value="${value2}">${label}</button>`).join("")}</div>`, states = [["INVENTORY", "Sellable"], ["PENDING_RESEARCH", "Pending"], ["UNSELLABLE", "Unsellable"]], damages = [["AMAZON_DAMAGE", "Amazon Damage"], ["DEFECTIVE", "Defective"], ["DISTRIBUTOR_DAMAGE", "Distributor Damage"], ["EXPIRED", "Expired"]], modes = (area, values) => `<div class="modes">${values.map((value2) => `<button data-mode="${value2}" data-area="${area}">${value2.toUpperCase()}</button>`).join("")}</div>`;
    const edit = `${modes("edit", ["each", "sku"])}<div class="qty-cards" data-qty hidden><b>INVENTORY QTY • SELLABLE / PENDING / UNSELLABLE</b><div data-qty-list></div></div><label data-source-state>SOURCE ${choices("currentState", states)}</label><label data-source-damage>SOURCE DISPOSITION ${choices("currentDamage", damages)}</label><p data-auto-source hidden>AUTO-DETECT SOURCE FROM ITEM</p><div class="arrow">↓</div><label>DESTINATION ${choices("desiredState", states)}</label><label data-target-damage>DESTINATION DISPOSITION ${choices("desiredDamage", damages)}</label><div class="arrow">↓</div><label><span data-items-label>ITEM BARCODES / ASIN / FNSKU</span><textarea data-field="text" spellcheck="false"></textarea></label>`;
    const move = `${modes("move", ["all", "each", "qty"])}<label data-quantity>QTY<input data-field="quantity" type="number" min="1" step="1"></label><label>SOURCE<input data-field="source" autocomplete="off"></label><div class="arrow">↓</div><label>DESTINATION<input data-field="destination" autocomplete="off"></label><div class="arrow">↓</div><label>ITEM BARCODES<textarea data-field="text" spellcheck="false"></textarea></label>`;
    const side = `${modes("sideline", ["queue", "lazy"])}<label>SOURCE<input data-field="source" autocomplete="off"></label><div class="arrow">↓</div><label>DESTINATION<input data-field="destination" autocomplete="off"></label><div class="arrow">↓</div><label><span data-items-label>CONTAINERS</span><textarea data-field="text" spellcheck="false"></textarea></label><div class="metrics"></div><div class="aside" hidden></div><div class="modes" data-lazy-options><button data-option="clearSource">CLEAR SOURCE: ON</button><button data-option="delay">DELAY: OFF</button></div>`;
    const warehouse = window2.location.pathname.match(/^\/([^/]+)\/results/)?.[1] || "BWU2";
    root.innerHTML = `<header><div class="brand"><span class="site">${escapeHtml(warehouse)}</span>ISS Console</div><div class="workers"><span data-worker=aft>AFT NOT CONNECTED</span><button data-reconnect=aft>Reconnect</button><span data-worker=sideline>SIDELINE NOT CONNECTED</span><button data-reconnect=sideline>Reconnect</button><button data-exit>FCResearch</button></div></header><div class="accent"></div><main class="grid" data-active="edit">${Object.entries({ edit, move, sideline: side }).map(([area, content]) => `<section class="panel" data-panel="${area}" data-mode="${area === "edit" ? "sku" : area === "move" ? "all" : "queue"}"><h2>${area.toUpperCase()}</h2><div class="body">${content}<div class="actions"><button data-action="run">RUN ${area.toUpperCase()}</button><button data-action="stop">STOP</button><button data-action="clear">CLEAR</button>${area === "sideline" ? '<button data-action="pause">PAUSE</button>' : ""}</div><div role="status">Ready</div><div class="rows"></div></div></section>`).join("")}</main>`;
    d.body.append(root);
    d.head.append(style);
    const panels = Object.fromEntries(["edit", "move", "sideline"].map((area) => [area, root.querySelector(`[data-panel=${area}]`)])), value = (area, name) => panels[area].querySelector(`[data-field=${name}]`), message = (area, text2) => panels[area].querySelector("[role=status]").textContent = text2, key = (area) => "tm-v4.iss." + area + ".rows", kind = (area) => area === "sideline" ? "sideline" : "aft";
    for (const area of Object.keys(panels)) {
      const panel = panels[area];
      if (area === "edit") {
        value(area, "desiredState").value = "PENDING_RESEARCH";
        value(area, "currentDamage").value = value(area, "desiredDamage").value = "DEFECTIVE";
      }
      panel.dataset.clearSource = "false";
      panel.dataset.delay = "true";
      try {
        const saved = JSON.parse(window2.localStorage.getItem("tm-v4.iss.draft." + area) || "{}");
        for (const input of panel.querySelectorAll("[data-field]")) if (saved[input.dataset.field] != null) input.value = saved[input.dataset.field];
        if (saved.mode) panel.dataset.mode = saved.mode;
        panel.dataset.clearSource = String(saved.clearSource === true);
        panel.dataset.delay = String(saved.delay !== false);
      } catch {
      }
      try {
        journals[area] = createOperationJournal({ storage: window2.localStorage, key: key(area), uuid: () => window2.crypto.randomUUID() });
      } catch (error) {
        message(area, error.message);
      }
    }
    function save(area) {
      const data = { mode: panels[area].dataset.mode, clearSource: panels[area].dataset.clearSource === "true", delay: panels[area].dataset.delay === "true" };
      for (const input of panels[area].querySelectorAll("[data-field]")) data[input.dataset.field] = input.value;
      window2.localStorage.setItem("tm-v4.iss.draft." + area, JSON.stringify(data));
    }
    function paint(area) {
      const panel = panels[area], mode = panel.dataset.mode, blocked = busy[area] || kind(area) === "aft" && (busy.edit || busy.move);
      panel.dataset.active = String(active3 === area);
      for (const button of panel.querySelectorAll("[data-mode]")) {
        button.dataset.selected = String(button.dataset.mode === mode);
        button.disabled = blocked;
      }
      panel.querySelector("[data-action=run]").disabled = !!blocked;
      for (const button of panel.querySelectorAll("[data-choice]")) {
        button.dataset.selected = String(value(area, button.dataset.choice).value === button.dataset.value);
        button.disabled = blocked || area === "edit" && button.dataset.choice === "desiredState" && mode === "sku" && value(area, "currentState").value !== "UNSELLABLE" && button.dataset.value === value(area, "currentState").value || area === "edit" && button.dataset.choice === "desiredDamage" && mode === "sku" && value(area, "currentState").value === "UNSELLABLE" && value(area, "desiredState").value === "UNSELLABLE" && button.dataset.value === value(area, "currentDamage").value;
      }
      if (area === "edit") {
        panel.querySelector("[data-qty]").hidden = mode !== "sku";
        const codes = [...new Set(value(area, "text").value.split(/[\s,;]+/).map(upper).filter((code) => code && code !== "123START"))];
        panel.querySelector("[data-qty-list]").innerHTML = codes.map((code) => '<div class="qty-row"><code>' + escapeHtml(code) + "</code>" + ["SELLABLE", "PENDING_RESEARCH", "UNSELLABLE"].map((state) => "<b>" + escapeHtml(quantityRows[code]?.[state] ?? "—") + "</b>").join("") + "</div>").join("");
        panel.querySelector("[data-source-state]").hidden = mode !== "sku";
        panel.querySelector("[data-source-damage]").hidden = mode !== "sku" || value(area, "currentState").value !== "UNSELLABLE";
        panel.querySelector("[data-auto-source]").hidden = mode !== "each";
        panel.querySelector("[data-target-damage]").hidden = value(area, "desiredState").value !== "UNSELLABLE";
        panel.querySelector("[data-items-label]").textContent = mode === "each" ? "TOTE ASIN [FNSKU]" : "ITEM BARCODES / ASIN / FNSKU";
      }
      if (area === "move") panel.querySelector("[data-quantity]").hidden = mode !== "qty";
      if (area === "sideline") {
        value(area, "source").disabled = value(area, "destination").disabled = mode === "queue" || !!busy[area];
        panel.querySelector("[data-items-label]").textContent = mode === "queue" ? "CONTAINERS" : "ITEM BARCODES";
        panel.querySelector("[data-lazy-options]").hidden = mode !== "lazy";
        const parsed = parseSidelineItems(value(area, "text").value, value(area, "source").value, value(area, "destination").value), rows2 = liveRows[area] || [];
        panel.querySelector(".metrics").textContent = `${parsed.reduce((sum, row) => sum + row.quantity, 0)} units • ${parsed.length} unique • ${rows2.filter((row) => row.state === "CONFIRMED" && row.kind === "move").reduce((sum, row) => sum + (row.quantity || 0), 0)} moved • ${rows2.filter((row) => ["QUEUED", "READING", "SUBMITTED", "UNKNOWN"].includes(row.state) && row.kind === "move").reduce((sum, row) => sum + (row.quantity || 0), 0)} remaining`;
        for (const button of panel.querySelectorAll("[data-option]")) button.textContent = (button.dataset.option === "clearSource" ? "CLEAR SOURCE" : "DELAY") + ": " + (panel.dataset[button.dataset.option] === "true" ? "ON" : "OFF");
        const alert = panel.querySelector(".aside");
        alert.hidden = !sideAttention;
        alert.textContent = sideAttention ? sideNativeMessage || "RESCAN DESTINATION in ITEM BARCODES" : "";
      }
      const rows = [...(journals[area]?.rows || []).map((row) => ({ ...row, code: "Console handoff" })), ...liveRows[area] || []];
      panel.querySelector(".rows").innerHTML = rows.map((row) => `<div data-state="${escapeHtml(row.state)}"><b>${escapeHtml(row.code || row.container)}</b> ${escapeHtml(row.state)} • ${escapeHtml(row.message || "")}</div>`).join("");
      root.querySelector(".grid").dataset.active = active3;
      root.querySelector("[data-reconnect=" + kind(area) + "]").disabled = kind(area) === "aft" ? !!(busy.edit || busy.move) : !!busy.sideline;
    }
    const bridge = bridgeFactory({ onProgress: (data) => {
      if (disposed) return;
      if (data.stage === "connected") root.querySelector(`[data-worker=${data.kind}]`).textContent = data.kind.toUpperCase() + " CONNECTED";
      const area = data.area;
      if (data.stage === "date-cancel") {
        dateController?.abort();
        picker.dispose();
        return;
      }
      if (!panels[area]) return;
      if (data.rows) liveRows[area] = data.rows;
      if (data.message) message(area, data.message);
      if (data.choices && data.code) {
        quantityRows[upper(data.code)] = {};
        for (const state of ["SELLABLE", "PENDING_RESEARCH", "UNSELLABLE"]) {
          const matches = data.choices.filter((row) => row.state === state);
          quantityRows[upper(data.code)][state] = matches.length === 1 ? matches[0].qty : "—";
        }
      }
      if (area === "sideline") {
        sideAttention = data.attention || "";
        sideNativeMessage = data.message || "";
      }
      paint(area);
    }, onEvidence: (record) => {
      if (!disposed) onEvidence({ ...record, data: { ...record.data, ownerOrigin: "native", stage: record.type }, type: record.type, intent: record.intent });
    }, onDate: async (data) => {
      dateController?.abort();
      dateController = new window2.AbortController();
      return picker.pick({ code: data.code, ctx: data.ctx, signal: dateController.signal });
    } });
    function payload(area) {
      const panel = panels[area], mode = panel.dataset.mode, meta = {};
      for (const field of panel.querySelectorAll("[data-field]")) meta[field.dataset.field] = clean(field.value);
      if (area === "edit") return { area, mode, items: parseAftRows(mode, value(area, "text").value, meta) };
      if (area === "move") {
        const nativeMode = mode === "each" ? "moveEach" : "moveAll";
        return { area, mode: nativeMode, items: parseAftRows(nativeMode, value(area, "text").value, { ...meta, quantityMode: mode === "all" ? "all" : "user", quantity: mode === "each" ? "1" : meta.quantity }) };
      }
      if (mode === "queue") {
        const containers = value(area, "text").value.split(/[\s,;]+/).map(clean).filter(Boolean).filter((code) => upper(code) !== "123START");
        if (containers.some((code) => !validSidelineContainer(code))) throw new Error("Queue requires valid tsX/csX containers");
        return { area, mode, options: { containers } };
      }
      if (!validSidelineContainer(meta.source) || !validSidelineContainer(meta.destination) || upper(meta.source) === upper(meta.destination)) throw new Error("Valid distinct source/destination required");
      return { area, mode, options: { source: meta.source, destination: meta.destination, items: parseSidelineItems(value(area, "text").value, meta.source, meta.destination), clearSource: panel.dataset.clearSource === "true", delay: panel.dataset.delay === "true" } };
    }
    async function run(area) {
      if (disposed || busy[area] || kind(area) === "aft" && (busy.edit || busy.move)) return;
      let input;
      try {
        input = payload(area);
        save(area);
      } catch (error) {
        message(area, error.message);
        return;
      }
      busy[area] = true;
      stopStages[area] = 0;
      active3 = area;
      paint(area);
      promises[area] = withOperationLock(window2, "tm-v4.iss." + area + ".owner", async () => {
        const journal = createOperationJournal({ storage: window2.localStorage, key: key(area), uuid: () => window2.crypto.randomUUID() });
        journals[area] = journal;
        if (journal.rows.some((row2) => ["UNKNOWN", "SUBMITTED"].includes(row2.state))) throw new Error("UNKNOWN console handoff retained — verify native outcome before retry");
        await bridge.ready(kind(area));
        if (disposed || stopStages[area] > 0) throw new Error("Stopped before native handoff");
        const row = journal.add([area + " " + window2.crypto.randomUUID()], { area, kind: "native-handoff", payload: input })[0];
        activeRows[area] = row;
        journal.transition(row, "SUBMITTED", "Native workflow handoff pending", { requestId: row.id });
        paint(area);
        onEvidence({ type: "iss.handoff", intent: "workflow", data: { area, phase: "SUBMITTED" } });
        try {
          const result = await bridge.run(kind(area), input, { requestId: row.id });
          liveRows[area] = result.rows || [];
          if (row.state === "UNKNOWN") {
            message(area, "Late native evidence received • UNKNOWN handoff retained for review");
            return;
          }
          if (!["CONFIRMED", "REJECTED", "UNKNOWN"].includes(result.outcome)) throw new Error("Invalid native worker outcome");
          journal.transition(row, result.outcome, result.message || "Native " + result.outcome);
          message(area, "Native " + result.outcome + " • " + (result.rows || []).filter((item) => item.state === "CONFIRMED").length + " confirmed row(s)");
          if (result.outcome === "CONFIRMED") {
            value(area, "text").value = "";
            if (area === "move" || area === "sideline" && input.mode === "lazy") {
              value(area, "source").value = "";
              value(area, "destination").value = "";
              value(area, "source").focus();
            }
            save(area);
          }
        } catch (error) {
          if (row.state !== "UNKNOWN") journal.transition(row, error.outcome === "REJECTED" ? "REJECTED" : "UNKNOWN", error.message);
          if (error.rows) liveRows[area] = error.rows;
          throw error;
        }
      }).catch((error) => message(area, error.message)).finally(() => {
        busy[area] = false;
        activeRows[area] = null;
        promises[area] = null;
        paint(area);
        if (kind(area) === "aft") paint(area === "edit" ? "move" : "edit");
      });
      await promises[area];
    }
    function stop(area) {
      stopStages[area] = (stopStages[area] || 0) + 1;
      bridge.control(kind(area), "stop", { area });
      if (area === "sideline") {
        dateController?.abort();
        picker.dispose();
      }
      message(area, busy[area] ? "Stop requested — native submitted result settles" : "Stopped; recovery retained");
      if (stopStages[area] >= 2 && !busy[area]) void clear(area);
    }
    async function clear(area) {
      stop(area);
      if (area === "sideline") {
        dateController?.abort();
        picker.dispose();
      }
      if (promises[area]) await promises[area];
      try {
        await withOperationLock(window2, "tm-v4.iss." + area + ".owner", async () => {
          const journal = createOperationJournal({ storage: window2.localStorage, key: key(area), uuid: () => window2.crypto.randomUUID() });
          journal.clear();
          journals[area] = journal;
        });
        bridge.control(kind(area), "clear", { area });
        value(area, "text").value = "";
        save(area);
        message(area, "Cleared safe rows • unresolved handoffs retained");
        paint(area);
      } catch (error) {
        message(area, error.message);
      }
    }
    root.addEventListener("input", (event) => {
      const area = event.target.closest("[data-panel]")?.dataset.panel;
      if (area) {
        save(area);
        if (area === "sideline" || area === "edit") paint(area);
      }
    }, { signal: events.signal });
    root.addEventListener("focusin", (event) => {
      const area = event.target.closest("[data-panel]")?.dataset.panel;
      if (area) {
        active3 = area;
        for (const key2 of Object.keys(panels)) paint(key2);
      }
    }, { signal: events.signal });
    root.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      if (button.hasAttribute("data-exit")) {
        window2.location.hash = "";
        return;
      }
      if (button.dataset.reconnect) {
        void bridge.reconnect(button.dataset.reconnect).catch((error) => root.querySelector(`[data-worker=${button.dataset.reconnect}]`).textContent = error.message);
        return;
      }
      const area = button.closest("[data-panel]")?.dataset.panel;
      if (!area) return;
      active3 = area;
      if (button.dataset.mode && !busy[area]) {
        panels[area].dataset.mode = button.dataset.mode;
        save(area);
        paint(area);
      }
      if (button.dataset.choice && !busy[area]) {
        value(area, button.dataset.choice).value = button.dataset.value;
        save(area);
        paint(area);
      }
      if (button.dataset.option) {
        panels[area].dataset[button.dataset.option] = String(panels[area].dataset[button.dataset.option] !== "true");
        save(area);
        paint(area);
      }
      if (button.dataset.action === "run") void run(area);
      if (button.dataset.action === "stop") stop(area);
      if (button.dataset.action === "clear") void clear(area);
      if (button.dataset.action === "pause") bridge.control(kind(area), "pause", { area });
    }, { signal: events.signal });
    d.addEventListener("keydown", (event) => {
      const area = event.target.closest?.("[data-panel]")?.dataset.panel;
      if (!area || event.key !== "Enter" || event.shiftKey) return;
      const input = event.target;
      if (input.matches("[data-field=quantity]")) {
        event.preventDefault();
        if (!Number.isSafeInteger(Number(input.value)) || Number(input.value) < 1) {
          message(area, "Enter valid QTY");
          input.select();
        } else value(area, "source").focus();
      } else if (input.matches("[data-field=source],[data-field=destination]")) {
        event.preventDefault();
        if (!validSidelineContainer(input.value)) {
          message(area, "Valid tsX/csX container required");
          input.select();
          return;
        }
        value(area, input.dataset.field === "source" ? "destination" : "text").focus();
      } else if (input.tagName === "TEXTAREA") {
        const pos = input.selectionStart ?? input.value.length, start = input.value.lastIndexOf("\n", Math.max(0, pos - 1)) + 1, next = input.value.indexOf("\n", pos), end = next < 0 ? input.value.length : next, code = clean(input.value.slice(start, end)), isStart = upper(code) === "123START", source = value(area, "source"), dest = value(area, "destination"), isSource = source && upper(code) === upper(source.value), isDest = dest && upper(code) === upper(dest.value);
        const control = isStart || area === "sideline" && panels[area].dataset.mode === "lazy" && validSidelineContainer(code) || area === "move" && validSidelineContainer(code);
        if (control) {
          event.preventDefault();
          input.value = input.value.slice(0, start) + input.value.slice(end).replace(/^\r?\n/, "");
          input.setSelectionRange(input.value.length, input.value.length);
          save(area);
          if (area === "sideline" && busy[area]) {
            bridge.control("sideline", "scan", { area, code });
            if (isSource && !["predicant", "damaged", "recovery"].includes(sideAttention)) stop(area);
          } else if (isStart || area === "move" && isDest || area === "sideline" && (isSource || isDest)) void run(area);
          else message(area, "Container scan is a control — not an item");
        } else {
          event.preventDefault();
          const endSelection = input.selectionEnd ?? pos, before = input.value.slice(0, pos).replace(/[\t ]+$/, ""), after = input.value.slice(endSelection).replace(/^\r?\n+/, "");
          input.value = before + "\n" + after;
          input.setSelectionRange(before.length + 1, before.length + 1);
          save(area);
        }
      }
      event.stopImmediatePropagation();
    }, { capture: true, signal: events.signal });
    for (const area of Object.keys(panels)) paint(area);
    return { root, bridge, run, stop, clear, getRows: (area) => journals[area]?.rows, dispose() {
      if (disposed) return;
      disposed = true;
      for (const area of Object.keys(activeRows)) {
        const row = activeRows[area];
        if (row?.state === "SUBMITTED") try {
          journals[area].transition(row, "UNKNOWN", "ISS disposed after native handoff — verify outcome");
        } catch {
        }
      }
      dateController?.abort();
      picker.dispose();
      bridge.dispose();
      events.abort();
      root.remove();
      style.remove();
    } };
  }

  // iss-bridge.mjs
  var PROTOCOL = "tm-v4.iss";
  var FCR = /^(?:fcresearch-fe\.aka\.amazon\.com|qi-fcresearch-(?:fe|jp)\.corp\.amazon\.com|qifcr\.fe\.aftx\.amazonoperations\.app)$/;
  var ISS_TARGETS = Object.freeze({ aft: "https://aft-qt-jp.aka.nrt.corp.amazon.com/app/edititems?experience=Desktop", sideline: "https://aft-poirot-website-nrt.nrt.proxy.amazon.com/" });
  function issWorkerContext(window2) {
    const nonce = /^#tm-v4-iss-worker=([a-f0-9-]{20,80})$/.exec(window2.location.hash)?.[1];
    if (!nonce || window2.parent === window2) return null;
    try {
      const origin = new window2.URL(window2.location.href).searchParams.get("tmV4ParentOrigin"), url = new window2.URL(origin);
      if (url.origin !== origin || !FCR.test(url.hostname) || !/^https?:$/.test(url.protocol)) return null;
      return { nonce, parentOrigin: origin };
    } catch {
      return null;
    }
  }
  function createIssBridge({ window: window2, onProgress = () => {
  }, onEvidence = () => {
  }, onDate = async () => null, healthTimeout = 15e3, runTimeout = 12 * 60 * 1e3 }) {
    const d = window2.document, events = new window2.AbortController(), peers = /* @__PURE__ */ new Map();
    let disposed = false;
    function peer(kind) {
      if (!ISS_TARGETS[kind]) throw new Error("Unknown ISS worker");
      let item = peers.get(kind);
      if (item) return item;
      const nonce = window2.crypto.randomUUID(), frame = d.createElement("iframe"), url = new window2.URL(ISS_TARGETS[kind]);
      url.searchParams.set("tmV4ParentOrigin", window2.location.origin);
      url.hash = "tm-v4-iss-worker=" + nonce;
      frame.dataset.tmV4Script = "ISSC";
      frame.title = "ISS native " + kind + " worker";
      frame.tabIndex = -1;
      frame.setAttribute("aria-hidden", "true");
      frame.style.cssText = "position:fixed;left:-12000px;top:0;width:1280px;height:900px;opacity:0;pointer-events:none;border:0";
      let readyResolve, readyReject;
      const ready = new Promise((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
      });
      item = { kind, nonce, origin: url.origin, frame, ready, readyResolve, readyReject, pending: /* @__PURE__ */ new Map(), readyState: false };
      item.timer = window2.setTimeout(() => {
        item.readyReject(Object.assign(new Error(kind.toUpperCase() + " native worker unavailable — authenticate/open native application, then reconnect"), { outcome: "REJECTED" }));
        item.unavailable = true;
      }, healthTimeout);
      peers.set(kind, item);
      frame.addEventListener("load", () => {
        try {
          send(item, "hello");
        } catch (error) {
          onProgress({ kind, stage: "error", message: error.message });
        }
      });
      frame.src = url.href;
      d.documentElement.append(frame);
      return item;
    }
    function send(item, type, data = {}) {
      if (disposed) throw new Error("ISS bridge disposed");
      item.frame.contentWindow.postMessage({ protocol: PROTOCOL, nonce: item.nonce, type, ...data }, item.origin);
    }
    async function run(kind, payload, { requestId = window2.crypto.randomUUID() } = {}) {
      const item = peer(kind);
      await item.ready;
      if (disposed) throw new Error("ISS disposed");
      return new Promise((resolve, reject) => {
        const timer = window2.setTimeout(() => {
          item.pending.delete(requestId);
          try {
            send(item, "control", { action: "stop", area: payload.area });
          } catch {
          }
          reject(Object.assign(new Error("Native workflow timed out after handoff — UNKNOWN; verify before retry"), { outcome: "UNKNOWN" }));
        }, runTimeout);
        item.pending.set(requestId, { resolve, reject, timer });
        try {
          send(item, "run", { requestId, payload });
        } catch (error) {
          window2.clearTimeout(timer);
          item.pending.delete(requestId);
          reject(Object.assign(error, { outcome: "UNKNOWN" }));
        }
      });
    }
    function control(kind, action, data = {}) {
      const item = peers.get(kind);
      if (item?.readyState) send(item, "control", { action, ...data });
    }
    async function message(event) {
      const data = event.data;
      if (data?.protocol !== PROTOCOL) return;
      const item = [...peers.values()].find((peer2) => event.source === peer2.frame.contentWindow && event.origin === peer2.origin && data.nonce === peer2.nonce);
      if (!item || disposed) return;
      if (data.type === "ready") {
        if (item.unavailable) return;
        window2.clearTimeout(item.timer);
        item.readyState = true;
        item.readyResolve();
        onProgress({ kind: item.kind, stage: "connected" });
        return;
      }
      const pending = item.pending.get(data.requestId);
      if (!pending) return;
      if (data.type === "progress") {
        onProgress({ kind: item.kind, ...data.data });
        return;
      }
      if (data.type === "evidence") {
        onEvidence(data.record);
        return;
      }
      if (data.type === "date") {
        const value = await onDate({ kind: item.kind, requestId: data.requestId, dateId: data.dateId, code: data.code, ctx: data.ctx });
        if (!disposed && item.pending.has(data.requestId)) send(item, "date-result", { requestId: data.requestId, dateId: data.dateId, value });
        return;
      }
      if (data.type === "date-cancel") {
        onProgress({ kind: item.kind, stage: "date-cancel" });
        return;
      }
      if (data.type === "result") {
        window2.clearTimeout(pending.timer);
        item.pending.delete(data.requestId);
        if (data.error) pending.reject(Object.assign(new Error(data.error.message), { outcome: data.error.outcome || "UNKNOWN", rows: data.rows || [] }));
        else pending.resolve(data.result);
      }
    }
    window2.addEventListener("message", (event) => void message(event).catch((error) => onProgress({ stage: "error", message: error.message })), { signal: events.signal });
    function reconnect(kind) {
      const item = peers.get(kind);
      if (item && (item.pending.size || !item.readyState && !item.unavailable)) throw new Error("Native workflow pending — reconnect would erase uncertainty");
      if (item) {
        window2.clearTimeout(item.timer);
        item.frame.remove();
        peers.delete(kind);
      }
      return peer(kind).ready;
    }
    return { run, control, reconnect, ready: (kind) => peer(kind).ready, getPeer: (kind) => peers.get(kind), dispose() {
      if (disposed) return;
      for (const item of peers.values()) {
        if (item.readyState) {
          try {
            send(item, "control", { action: "stop" });
          } catch {
          }
        }
        window2.clearTimeout(item.timer);
        item.readyReject(new Error("ISS disposed before worker ready"));
        for (const pending of item.pending.values()) {
          window2.clearTimeout(pending.timer);
          pending.reject(Object.assign(new Error("ISS disposed after native handoff — verify outcome"), { outcome: "UNKNOWN" }));
        }
        item.frame.remove();
      }
      disposed = true;
      events.abort();
      peers.clear();
    } };
  }
  function serveIssWorker({ window: window2, kind, engine, onDispose = () => {
  } }) {
    const context = issWorkerContext(window2);
    if (!context) return null;
    const events = new window2.AbortController(), seen = /* @__PURE__ */ new Set(), dates = /* @__PURE__ */ new Map();
    let busy = false, disposed = false, requestId = "", area = "";
    const send = (type, data = {}) => {
      if (!disposed) window2.parent.postMessage({ protocol: PROTOCOL, nonce: context.nonce, type, requestId, ...data }, context.parentOrigin);
    };
    function progress(data) {
      send("progress", { data: { kind, area, ...data } });
    }
    function evidence2(record) {
      send("evidence", { record });
    }
    function pickDate({ code, ctx, signal }) {
      const dateId = window2.crypto.randomUUID();
      return new Promise((resolve) => {
        const finish = (value) => {
          dates.delete(dateId);
          signal?.removeEventListener("abort", cancel);
          resolve(value);
        }, cancel = () => {
          send("date-cancel", { dateId });
          finish(null);
        };
        dates.set(dateId, finish);
        signal?.addEventListener("abort", cancel, { once: true });
        if (signal?.aborted) return cancel();
        send("date", { dateId, code, ctx: { asin: ctx.asin, fnsku: ctx.fnsku, dateType: ctx.dateType, dateDetail: ctx.dateDetail, sku: { title: ctx.sku?.title || ctx.sku?.normalizedTitle, imageUrl: ctx.sku?.imageUrl } } });
      });
    }
    const api = engine({ progress, evidence: evidence2, pickDate });
    async function message(event) {
      const data = event.data;
      if (event.source !== window2.parent || event.origin !== context.parentOrigin || data?.protocol !== PROTOCOL || data.nonce !== context.nonce || disposed) return;
      if (data.type === "hello") {
        send("ready", { kind });
        return;
      }
      if (data.type === "date-result") {
        if (data.requestId === requestId && (data.value === null || Number.isFinite(data.value))) dates.get(data.dateId)?.(data.value);
        return;
      }
      if (data.type === "control") {
        if (["stop", "clear", "pause", "scan"].includes(data.action)) api[data.action]?.(data);
        return;
      }
      if (data.type !== "run") return;
      if (busy || seen.has(data.requestId) || typeof data.requestId !== "string" || !data.payload) {
        send("result", { requestId: data.requestId, error: { message: "Native owner busy or command already handled", outcome: "REJECTED" } });
        return;
      }
      seen.add(data.requestId);
      requestId = data.requestId;
      area = data.payload.area;
      busy = true;
      try {
        const result = await api.run(data.payload);
        send("result", { result });
      } catch (error) {
        send("result", { error: { message: error.message, outcome: error.outcome || "UNKNOWN" }, rows: api.rows?.() || [] });
      } finally {
        busy = false;
        requestId = "";
        area = "";
      }
    }
    window2.addEventListener("message", (event) => void message(event).catch((error) => progress({ stage: "error", message: error.message })), { signal: events.signal });
    send("ready", { kind });
    return { dispose() {
      if (disposed) return;
      api.stop?.({});
      api.dispose?.();
      for (const resolve of dates.values()) resolve(null);
      dates.clear();
      disposed = true;
      events.abort();
      onDispose();
    } };
  }

  // native-json.mjs
  var NativeRequestError = class extends Error {
    constructor(message, { outcome = "REJECTED", status = 0 } = {}) {
      super(message);
      this.outcome = outcome;
      this.status = status;
    }
  };

  // sideline-client.mjs
  var SIDELINE_TOOL = "V3";
  function sidelineRequestId(uuid) {
    return "amzn1.fc.v1.common.request-id.v1.AFTPoirotWebsite." + uuid();
  }
  var labels = (data) => [data?.["@type"], data?.message, data?.description, data?.errorMessage, data?.errorCode, data?.filterResult?.filterType, ...Object.values(data?.filterResult?.reason || {}), ...Array.isArray(data?.problems) ? data.problems.filter(Boolean).map((p) => typeof p === "string" ? p : p.description || p.message || p.code || p["@type"]) : []].filter((v) => typeof v === "string").map(clean);
  function hasPredicant(data) {
    if (data === null || data === void 0) return false;
    if (typeof data === "string") return /predicant/i.test(data);
    if (typeof data !== "object") return false;
    return Object.entries(data).some(([k, v]) => /predicant/i.test(k) && v !== false && v !== null && v !== "" && v !== "false" || hasPredicant(v));
  }
  function customerBound(data) {
    return /customer\s*bound\s*shipment/i.test(JSON.stringify(data || {}));
  }
  function allowedOverage(data) {
    const list = labels(data), type = clean(data?.["@type"]);
    if (/InvalidBarcode|RequestMultipleBarcodes/.test(type) || hasPredicant(data)) return false;
    const overage = /\boverage\b|item\s+not\s+in\s+(?:source\s+)?container/i;
    const diagnostics = list.filter((v) => v !== type);
    return (type === "ItemNotInContainerResponse" || list.some((v) => overage.test(v))) && diagnostics.every((v) => overage.test(v) || /^(?:bad request|conflict|http [45]\d\d|[45]\d\d)$/i.test(v)) && !(data?.filterResult?.compatible === false && !overage.test(JSON.stringify(data.filterResult.reason || {})));
  }
  function resolveSidelineItem(data, barcode) {
    const type = clean(data?.["@type"]), text2 = labels(data).join(" "), red = (reason) => ({ kind: "red", reason, ctx: null });
    if (customerBound(data)) return red("CUSTOMER-BOUND SHIPMENT");
    if (/InvalidBarcode/.test(type)) return red("INVALID BARCODE");
    if (/RequestMultipleBarcodes/.test(type)) return red("MULTIPLE BARCODE MATCHES");
    if (/damaged/i.test(text2)) return red("DAMAGED / INCOMPATIBLE");
    const overage = allowedOverage(data);
    if (data?.success !== true && !overage) return red(text2 || "NO POSITIVE ITEM DETAILS");
    if (data?.filterResult?.compatible === false && !overage) return red(text2 || "INCOMPATIBLE");
    const records = Array.isArray(data?.items) ? data.items : [];
    if (!records.length || records.some((r) => !r?.skuDetail || !clean(r.skuDetail.asin) || !clean(r.skuDetail.fnSku) || !clean(r.skuDetail.fcSku) || !Number.isFinite(Number(r.quantity)) || Number(r.quantity) < 0)) return red("ITEM DETAILS INCOMPLETE");
    const keys = new Set(records.map((r) => upper(r.skuDetail.asin) + "|" + upper(r.skuDetail.fnSku)));
    if (keys.size !== 1) return red("MULTIPLE DISTINCT ITEM IDENTITIES");
    const sku = records[0].skuDetail;
    if (clean(sku.itemDropzoneRecommendation?.permissionLevel).toUpperCase() === "UNDER_REVIEW") return red("ASIN UNDER REVIEW — RIVER REQUIRED");
    if (/hazmat|dangerous.?goods/i.test(text2) && (data.success === false || data.filterResult?.compatible === false || (data.problems || []).filter(Boolean).length)) return red("HAZMAT / DANGEROUS GOODS");
    const dateType = clean(sku.datelotDetail?.expirationPromptType);
    if (dateType && !["EXPIRATION_DATE", "PRODUCTION_DATE", "NONE", "NO_PROMPT"].includes(dateType)) return red("UNKNOWN DATE REQUIREMENT");
    const ctx = { barcode, records, sku, item: records[0], asin: clean(sku.asin), fnsku: clean(sku.fnSku), fcsku: clean(sku.fcSku), dateType, dateDetail: sku.datelotDetail || {}, hazmat: sku.hazmat === true, overage };
    return { kind: ["EXPIRATION_DATE", "PRODUCTION_DATE"].includes(dateType) ? "yellow" : "green", reason: dateType === "PRODUCTION_DATE" ? "PRODUCTION DATE" : dateType === "EXPIRATION_DATE" ? "EXPIRY DATE" : "GOOD TO GO", ctx };
  }
  function sidelineMovePayload({ source, destination, sourceMeta, ctx, quantity: quantity2, expiration = null, uuid }) {
    return { itemExternalId: null, sourceContainerScannableId: source, destinationContainerScannableId: destination, scannableId: clean(ctx.item.scannableId || ctx.barcode), quantity: String(quantity2), itemDetails: ctx.records.map((r) => ({ fcsku: clean(r.skuDetail.fcSku), quantity: Number(r.quantity), consumerType: r.consumer ?? null, disposition: r.disposition ?? null, referenceId: r.referenceId ?? null, fnsku: clean(r.skuDetail.fnSku) })), foundProblems: [null, null, null], scannedSourceContainerAsDestination: false, datelotDetail: ctx.sku.datelotDetail || null, userEnteredExpirationDate: expiration, mlcCaptureDetail: { mlcClass: ctx.sku.mlcDetail?.mlcClass ?? "UNKNOWN", userEnteredLotCode: null, mlcMissing: ctx.sku.mlcDetail?.mlcMissing ?? false, mlcNotEnteredReason: null, mlcCaptureMethod: null }, itemMovedToISS: false, candidatePurchaseOrders: [], packHierarchyDetail: null, itemAndonContext: null, processPath: sourceMeta?.processPath ?? "UNDETERMINED", requestId: sidelineRequestId(uuid), tool: SIDELINE_TOOL };
  }
  function classifySidelineMutation(data, kind) {
    const expected = kind === "move" ? "MoveItemsResponse" : "CloseContainerResponse", type = data?.["@type"];
    const contradictory = data?.filterResult?.compatible === false || Array.isArray(data?.problems) && data.problems.some(Boolean) || data?.error || data?.errorCode || data?.exception || data?.errorMessage || data?.problems != null && !Array.isArray(data.problems) || data?.filterResult?.reason?.containerDamaged === true || hasPredicant(data) || /^(pending|submitted|queued|processing)$/i.test(String(data?.status || data?.state || ""));
    if (type === expected && data.success === true && !contradictory) return { outcome: "CONFIRMED" };
    if (type === expected && data && typeof data === "object" && (data.success === false || data.filterResult?.compatible === false)) return { outcome: "REJECTED", reason: labels(data).join(" ") || "Native operation rejected", predicant: kind === "move" && hasPredicant(data), damaged: kind === "move" && /damaged/i.test(labels(data).join(" ")) };
    return { outcome: "UNKNOWN", reason: "Native " + kind + " result not positively confirmed" };
  }
  function createSidelineClient({ window: window2, fetch = window2.fetch.bind(window2), identity, warehouse, uuid = () => window2.crypto.randomUUID(), timeoutMs = 25e3, onEvidence = () => {
  } }) {
    async function request(path, body, { signal, mutation = false, allowItem = false } = {}) {
      if (signal?.aborted) throw new NativeRequestError("Cancelled before request");
      const controller = new window2.AbortController();
      const cancel = () => controller.abort();
      signal?.addEventListener("abort", cancel, { once: true });
      const timer = window2.setTimeout(() => controller.abort(), timeoutMs);
      try {
        const url = new window2.URL(path, window2.location.origin);
        const response = await fetch(url.href, { method: body === null ? "GET" : "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...body === null ? {} : { body: JSON.stringify(body) }, signal: controller.signal });
        const raw = await response.text();
        let data;
        try {
          data = JSON.parse(raw);
        } catch {
          data = null;
        }
        const knownRejection = mutation && [400, 409, 422].includes(response.status) && data?.success === false && data?.["@type"] === (path === "/api/move-items" ? "MoveItemsResponse" : "CloseContainerResponse");
        const knownOverage = allowItem && [400, 409].includes(response.status) && allowedOverage(data);
        if (response.redirected || response.url && response.url !== url.href || !response.ok && !knownRejection && !knownOverage || /html/i.test(response.headers?.get?.("content-type") || "") || data === null || raw.length > 8e6) throw new NativeRequestError("Native Poirot response/session invalid", { outcome: mutation ? "UNKNOWN" : "REJECTED", status: response.status });
        onEvidence({ type: "sideline.response", intent: mutation ? "mutation" : "read", data: { endpoint: url.pathname, status: response.status, responseType: clean(data?.["@type"]) } });
        return data;
      } catch (error) {
        if (error instanceof NativeRequestError) throw error;
        throw new NativeRequestError("Native Poirot request failed/cancelled", { outcome: mutation ? "UNKNOWN" : "REJECTED" });
      } finally {
        window2.clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
      }
    }
    function validContainer(value) {
      if (!/^(?:csX|tsX)[A-Za-z0-9_-]+$/i.test(clean(value))) throw new NativeRequestError("Valid csX/tsX container required");
    }
    return {
      async bootstrap({ signal } = {}) {
        const data = await request("/api/get-bootstrap-data?tool=" + SIDELINE_TOOL, null, { signal });
        const info = data?.warehouseInfo, id = typeof info === "string" ? info : info?.warehouseId || info?.id || data?.warehouseId;
        if (!/^[A-Z0-9]{3}\d$/.test(id || "") || warehouse && id !== warehouse) throw new NativeRequestError("Native warehouse identity unavailable/mismatched");
        identity();
        return { warehouse: id };
      },
      async source(container, { signal } = {}) {
        validContainer(container);
        const data = await request("/api/scan-source-container", { containerScannableId: container, requestId: sidelineRequestId(uuid), tool: SIDELINE_TOOL }, { signal });
        if (customerBound(data)) throw new NativeRequestError("CUSTOMER-BOUND SHIPMENT");
        if (data?.["@type"] !== "ScanSourceContainerResponse" || data.success !== true) throw new NativeRequestError(labels(data).join(" ") || "Source not validated");
        return data;
      },
      async item(source, barcode, { signal } = {}) {
        validContainer(source);
        return resolveSidelineItem(await request("/api/scanitem", { containerScannableId: source, itemBarcode: barcode, isMasterpack: null, itemAndonContext: null, requestId: sidelineRequestId(uuid), tool: SIDELINE_TOOL }, { signal, allowItem: true }), barcode);
      },
      async close(container, { signal, beforeMutation } = {}) {
        validContainer(container);
        identity();
        const body = { containerScannableId: container, containerEmpty: true, directedLabel: false, processPath: "UNDETERMINED", requestId: sidelineRequestId(uuid), tool: SIDELINE_TOOL };
        beforeMutation(body.requestId);
        return classifySidelineMutation(await request("/api/close-container", body, { signal, mutation: true }), "close");
      },
      async move(data, { signal, beforeMutation } = {}) {
        validContainer(data.source);
        validContainer(data.destination);
        if (upper(data.source) === upper(data.destination) || !Number.isInteger(data.quantity) || data.quantity < 1) throw new NativeRequestError("Invalid source/destination/quantity");
        identity();
        const body = sidelineMovePayload({ ...data, uuid });
        beforeMutation(body.requestId);
        return classifySidelineMutation(await request("/api/move-items", body, { signal, mutation: true }), "move");
      }
    };
  }

  // identity.mjs
  function resolveIdentity(window2, page2 = window2) {
    const normalize = (value) => {
      const raw = clean(value).toLowerCase();
      return /^[a-z][a-z0-9-]{2,31}$/.test(raw) && !/^(?:login|username|user|employee|alias|autoid|logout|logoff|signout|signin|profile|account|settings|search)$/.test(raw) ? raw : "";
    };
    const candidates = [];
    const add = (value, source) => {
      const login = normalize(value);
      if (login) candidates.push({ login, source });
    };
    for (const key of ["employeeLogin", "userLogin", "autoId", "autoID"]) add(page2[key], "native-global:" + key);
    for (const name of ["currentUser", "employee", "bootstrapData", "__INITIAL_STATE__"]) {
      const value = page2[name];
      if (!value || typeof value !== "object") continue;
      for (const key of ["employeeLogin", "userLogin", "username", "login", "alias", "autoId", "autoID"]) add(value[key], "native-state:" + name + "." + key);
      for (const child of ["currentUser", "user", "employee", "identity"]) if (value[child] && typeof value[child] === "object") for (const key of ["employeeLogin", "userLogin", "username", "login", "alias"]) add(value[child][key], "native-state:" + name + "." + child + "." + key);
    }
    for (const node of window2.document.querySelectorAll('[data-employee-login],[data-user-login],[data-username],[data-autoid],meta[name=employeeLogin],meta[name=username],meta[name=autoid],.app-user-name,.nav-user,.user-name,[data-test-id="user-name"]')) add(node.dataset.employeeLogin || node.dataset.userLogin || node.dataset.username || node.dataset.autoid || node.content || node.value || node.textContent, "native-dom");
    for (const raw of window2.document.cookie.split(";")) {
      const [key, ...values] = raw.trim().split("=");
      if (["employeeLogin", "userLogin", "username", "autoid"].includes(key)) {
        let value = values.join("=");
        try {
          value = decodeURIComponent(value);
        } catch {
        }
        add(value, "native-cookie:" + key);
      }
    }
    const distinct = [...new Set(candidates.map((row) => row.login))];
    if (distinct.length !== 1) throw new Error(distinct.length ? "Authenticated identities conflict — refresh native session" : "Authenticated employee identity unavailable");
    return { login: distinct[0], source: candidates.find((row) => row.login === distinct[0]).source };
  }

  // fcr-read.mjs
  var FCR_READ_VERSION = "0.1.3";
  var FcrReadError = class extends Error {
    constructor(code, message, { status, cause, partial } = {}) {
      super(message, cause ? { cause } : void 0);
      this.name = "FcrReadError";
      this.code = code;
      if (status != null) this.status = status;
      if (partial) this.partial = partial;
    }
  };
  var FCR_SECTIONS = Object.freeze([
    "product",
    "inventory",
    "inventory-history",
    "container-history",
    "purchase-order-item",
    "purchase-order",
    "receive-history",
    "shipment",
    "container-hierarchy",
    "employee",
    "carton-general-info",
    "carton-contents",
    "sscc-info",
    "carton-ambiguities",
    "vision-tunnel",
    "problem",
    "problems",
    "event",
    "authenticity-item"
  ]);
  var text = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  var identifier = (value) => text(value).toUpperCase();
  var failure = (code, message, options) => new FcrReadError(code, message, options);
  var columns = Object.freeze({
    container: ["container"],
    asin: ["asin"],
    fnsku: ["fnsku"],
    fcsku: ["fcsku"],
    lpn: ["lpn"],
    qty: ["quantity"],
    disposition: ["disposition"],
    consumer: ["consumer"],
    consumerId: ["consumer id", "consumerid"],
    outerLocation: ["outer location"],
    outerLocationType: ["outer location type"],
    title: ["title"]
  });
  function active(signal) {
    if (signal?.aborted) throw failure("CANCELLED", "FCR read cancelled", { cause: signal.reason });
  }
  function searchValue(value) {
    const query = text(value);
    if (!query || query.length > 256 || /[\u0000-\u001f]/.test(String(value))) throw failure("INPUT", "A valid FCR search is required");
    return query;
  }
  function quantity(value) {
    const raw = text(value);
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(raw)) throw failure("SCHEMA", "Inventory quantity is invalid");
    const number = Number(raw.replaceAll(",", ""));
    if (!Number.isSafeInteger(number)) throw failure("SCHEMA", "Inventory quantity exceeds the safe range");
    return number;
  }
  function pagination(document) {
    const markers = [...document.querySelectorAll(".pagination-token")].map((node) => node.textContent.trim());
    const terminal = (value) => /^(?:true|false|null|done)$/i.test(value);
    const tokens = markers.filter((value) => value && !terminal(value));
    if (!tokens.length) return "";
    if (markers.some(terminal)) throw failure("PAGINATION", "Contradictory pagination markers");
    if (new Set(tokens).size !== 1 || tokens[0].length > 16384) throw failure("PAGINATION", "Ambiguous pagination token");
    try {
      const parsed = JSON.parse(tokens[0]);
      if (!parsed || typeof parsed !== "object") throw new Error("Not an object/array");
    } catch (cause) {
      throw failure("PAGINATION", "Unrecognized pagination token", { cause });
    }
    return tokens[0];
  }
  function schema(table) {
    const headers = [...table.querySelectorAll("thead th")];
    if (!headers.length) throw failure("SCHEMA", "Inventory column headers are missing");
    const names = headers.map((node) => text(node.id || node.textContent).toLowerCase().replace(/^inventory-/, "").replace(/\([\d,]+\)/g, "").replaceAll("-", " ").trim());
    const positions = Object.fromEntries(Object.entries(columns).map(([field, aliases]) => {
      const matches = names.flatMap((name, index) => aliases.includes(name) ? [index] : []);
      if (matches.length > 1) throw failure("SCHEMA", "Duplicate inventory column: " + field);
      return [field, matches[0] ?? -1];
    }));
    if (positions.container < 0 || positions.qty < 0 || ["asin", "fnsku", "fcsku"].every((field) => positions[field] < 0)) {
      throw failure("SCHEMA", "Inventory identity/container/quantity columns are missing");
    }
    return { positions, names, width: headers.length };
  }
  function parseInventoryRows(table, format) {
    const rows = [], nodes = [];
    for (const node of table.tBodies[0]?.rows || []) {
      if (node.cells.length === 1 && node.querySelector("td.dataTables_empty")) continue;
      if (node.cells.length !== format.width) throw failure("SCHEMA", "Inventory row has unexpected columns");
      const row = Object.fromEntries(Object.entries(format.positions).map(([field, index]) => [field, index < 0 ? "" : text(node.cells[index].textContent)]));
      row.qty = quantity(row.qty);
      if (!row.container || ![row.asin, row.fnsku, row.fcsku].some(Boolean)) throw failure("IDENTITY", "Inventory row has no container/item identity");
      rows.push(row);
      nodes.push(node);
    }
    return { rows, nodes };
  }
  function dateField(value) {
    const raw = text(value), iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw), native = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
    const [year, month, day] = iso ? iso.slice(1).map(Number) : native ? [Number(native[3]), Number(native[1]), Number(native[2])] : [];
    const date = new Date(Date.UTC(year, month - 1, day));
    if (!year || date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
      throw failure("INPUT", "A valid Inventory History date is required");
    }
    return { native: `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}/${year}`, time: date.getTime() };
  }
  function createFcrReader({
    origin,
    warehouse,
    fetch: nativeFetch = globalThis.fetch,
    DOMParser: Parser = globalThis.DOMParser,
    timeoutMs = 15e3,
    maxPages = 200,
    maxRows = 1e5,
    retryDelays = [250, 750],
    onEvidence = () => {
    }
  }) {
    let site;
    try {
      site = new URL(origin);
    } catch {
      throw failure("INPUT", "FCR origin is invalid");
    }
    const allowedHost = /^(?:fcresearch-fe\.aka\.amazon\.com|qi-fcresearch-(?:fe|jp)\.corp\.amazon\.com|qifcr\.fe\.aftx\.amazonoperations\.app)$/i;
    if (!/^https?:$/.test(site.protocol) || !allowedHost.test(site.hostname) || site.username || site.password || !/^[A-Z0-9-]{2,12}$/.test(warehouse) || typeof nativeFetch !== "function" || typeof Parser !== "function" || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 200 || !Number.isInteger(maxRows) || maxRows < 1 || maxRows > 1e5 || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 3e4 || !Array.isArray(retryDelays) || retryDelays.length > 3 || retryDelays.some((ms) => !Number.isFinite(ms) || ms < 0 || ms > 5e3)) throw failure("INPUT", "FCR reader configuration is invalid");
    const base = `${site.origin}/${encodeURIComponent(warehouse)}/results/`;
    const endpoints = /* @__PURE__ */ new Set([...FCR_SECTIONS, ...FCR_SECTIONS.map((endpoint) => endpoint + "-more")]);
    function evidence2(data) {
      try {
        onEvidence({ type: "fcr.read", script: "FCR READ", version: FCR_READ_VERSION, intent: "read", data });
      } catch {
      }
    }
    function documentFrom(html, fragment = false) {
      const document = new Parser().parseFromString(html, "text/html");
      if (document.querySelector('input[type="password"], form[action*="signin"], form[action*="login"]')) {
        throw failure("AUTH_REQUIRED", "FCR authentication is required");
      }
      if (fragment && !document.querySelector("table") && /<tr\b/i.test(html)) {
        return new Parser().parseFromString("<table><tbody>" + html + "</tbody></table>", "text/html");
      }
      return document;
    }
    function wait2(ms, signal) {
      active(signal);
      return new Promise((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", cancelled);
        };
        const cancelled = () => {
          cleanup();
          reject(failure("CANCELLED", "FCR retry cancelled", { cause: signal.reason }));
        };
        const timer = setTimeout(() => {
          cleanup();
          resolve();
        }, ms);
        signal?.addEventListener("abort", cancelled, { once: true });
      });
    }
    async function request(endpoint, fields, signal) {
      if (!endpoints.has(endpoint)) throw failure("INPUT", "Unsupported FCR read endpoint");
      const url = base + endpoint;
      for (let attempt = 0; ; attempt++) {
        active(signal);
        const controller = new AbortController();
        const cancelled = () => controller.abort(signal.reason);
        signal?.addEventListener("abort", cancelled, { once: true });
        let timedOut = false, retry = false;
        const timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs);
        try {
          const response = await nativeFetch(url, {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "text/html, */*; q=0.01", "X-Requested-With": "XMLHttpRequest" },
            body: new URLSearchParams(fields).toString(),
            signal: controller.signal
          });
          active(signal);
          if (timedOut) throw failure("TIMEOUT", endpoint + ": timed out");
          if ([401, 403].includes(response.status) || response.url && response.url.replace(/\/$/, "") !== url) {
            throw failure("AUTH_REQUIRED", endpoint + ": authentication/redirect requires review", { status: response.status });
          }
          if (!response.ok) throw failure("HTTP", endpoint + ": HTTP " + response.status, { status: response.status });
          const html = await response.text();
          active(signal);
          if (timedOut) throw failure("TIMEOUT", endpoint + ": timed out");
          if (typeof html !== "string" || html.length > 8e6) throw failure("SCHEMA", endpoint + ": response exceeds the read limit");
          evidence2({ endpoint, status: response.status, outcome: "received", attempt: attempt + 1 });
          return documentFrom(html, endpoint.endsWith("-more"));
        } catch (cause) {
          active(signal);
          const error = timedOut ? failure("TIMEOUT", endpoint + ": timed out", { cause }) : cause instanceof FcrReadError ? cause : failure("NETWORK", endpoint + ": request failed", { cause });
          evidence2({ endpoint, status: error.status, outcome: "failed", code: error.code, attempt: attempt + 1 });
          retry = error.code === "HTTP" && error.status >= 500 && error.status < 600 && attempt < retryDelays.length;
          if (!retry) throw error;
        } finally {
          clearTimeout(timer);
          signal?.removeEventListener("abort", cancelled);
        }
        if (retry) await wait2(retryDelays[attempt], signal);
      }
    }
    async function readProduct(queryValue, { signal, resolveBarcode = false } = {}, allowEmpty = false) {
      const query = searchValue(queryValue), document = await request("product", { s: query }, signal);
      active(signal);
      let recognized = false;
      const matches = [];
      for (const table of document.querySelectorAll("table")) {
        const fields = {};
        for (const node of table.rows) {
          const label = node.querySelector("th"), value = node.querySelector("td");
          if (label && value) {
            const key = text(label.textContent).toLowerCase(), content = text(value.querySelector("a")?.textContent || value.textContent);
            if (fields[key] != null && fields[key] !== content) throw failure("SCHEMA", "Product contains conflicting native fields");
            fields[key] = content;
          }
        }
        const aliases = ["asin", "isbn", "fnsku", "fcsku"].map((field) => identifier(fields[field])).filter(Boolean);
        if (!aliases.length) continue;
        recognized = true;
        if (!aliases.includes(identifier(query)) && !(resolveBarcode && /^\d{8,14}$/.test(query))) continue;
        const sortable = /^(?:true|yes|1)$/i.test(fields.sortable) ? true : /^(?:false|no|0)$/i.test(fields.sortable) ? false : null;
        matches.push({
          asin: fields.asin || "",
          isbn: fields.isbn || "",
          fnsku: fields.fnsku || "",
          fcsku: fields.fcsku || "",
          primary: fields.asin || fields.isbn || "",
          title: fields.title || "",
          dimensions: fields.dimensions || "",
          weight: fields.weight || "",
          sortable,
          sortableText: fields.sortable || "",
          aliases: [...new Set(aliases)],
          img: (table.closest('[data-section-type="product"], .a-box-group') || table).querySelector("img")?.getAttribute("src") || ""
        });
      }
      if (matches.length) {
        if (new Set(matches.map((match) => JSON.stringify(match))).size > 1) throw failure("IDENTITY", "Product response contains conflicting exact records");
        active(signal);
        return { query, product: matches[0], html: document.body.innerHTML, complete: true, source: "network" };
      }
      if (allowEmpty && !recognized && !text(document.body.textContent) && !document.body.querySelector("table,img,form,input,iframe")) {
        evidence2({ endpoint: "product", outcome: "empty" });
        return { query, product: null, html: document.body.innerHTML, complete: true, source: "network" };
      }
      throw failure(recognized ? "IDENTITY" : "SCHEMA", recognized ? "Product does not match the requested identifier" : "Product table was not returned");
    }
    const product = (query, options) => readProduct(query, options);
    async function barcodeProduct(query, { signal } = {}) {
      if (!/^\d{8,14}$/.test(text(query))) throw failure("INPUT", "A numeric UPC/EAN/ISBN barcode is required");
      const resolved = await readProduct(query, { signal, resolveBarcode: true });
      const canonical = resolved.product.fnsku || resolved.product.asin || resolved.product.isbn || resolved.product.fcsku;
      const checked = await product(canonical, { signal });
      if (resolved.product.aliases.some((alias) => !checked.product.aliases.includes(alias))) throw failure("IDENTITY", "Barcode resolution changed canonical product");
      return { ...checked, query, resolvedFrom: "native-barcode-search", barcodeAlias: identifier(query) };
    }
    async function inventory(queryValue, { signal, allowPartial = false, onPreview } = {}) {
      const query = searchValue(queryValue);
      const document = await request("inventory", { s: query }, signal);
      active(signal);
      const table = document.querySelector("#table-inventory");
      if (!table) throw failure("SCHEMA", "Inventory table was not returned");
      const format = schema(table), body = table.tBodies[0];
      if (!body) throw failure("SCHEMA", "Inventory table body is missing");
      let rows = parseInventoryRows(table, format).rows, pages = 1, complete = false, error = null;
      const header = table.querySelector("#inventory-quantity") || [...table.querySelectorAll("th")][format.positions.qty];
      const headerMatch = text(header?.textContent).match(/\(([\d,]+)\)/);
      const advertised = headerMatch ? quantity(headerMatch[1]) : null;
      const seen = /* @__PURE__ */ new Set();
      const result = (warning = "", code = "") => {
        const copy = document.body.cloneNode(true);
        copy.querySelectorAll(".pagination-token").forEach((node) => node.remove());
        const partialQuantity = rows.reduce((sum, row) => sum + row.qty, 0);
        return {
          query,
          rows: rows.map((row) => ({ ...row })),
          html: copy.innerHTML,
          pages,
          records: rows.length,
          partialQuantity,
          totalQuantity: complete ? partialQuantity : null,
          complete,
          warning,
          ...code ? { code } : {},
          source: "network"
        };
      };
      try {
        let token = pagination(document);
        if (rows.length > maxRows) throw failure("LIMIT", "Inventory row limit reached");
        if (token && !rows.length) throw failure("PAGINATION", "Empty nonterminal inventory page");
        if (onPreview) {
          active(signal);
          onPreview(result(token ? "Loading remaining inventory pages" : "Validating inventory completeness"));
          active(signal);
        }
        while (token) {
          if (seen.has(token)) throw failure("PAGINATION", "Inventory continuation repeated a token");
          if (pages >= maxPages) throw failure("LIMIT", "Inventory page limit reached");
          seen.add(token);
          const page2 = await request("inventory-more", { token }, signal);
          active(signal);
          const nextTable = page2.querySelector("#table-inventory") || page2.querySelector("table:not([id])");
          if (!nextTable) throw failure("SCHEMA", "Inventory continuation table was not returned");
          if (!nextTable.tBodies[0]) throw failure("SCHEMA", "Inventory continuation table body is missing");
          if (nextTable.querySelector("thead th") && JSON.stringify(schema(nextTable).names) !== JSON.stringify(format.names)) {
            throw failure("SCHEMA", "Inventory continuation changed its column schema");
          }
          const parsed = parseInventoryRows(nextTable, format), next = pagination(page2);
          if (!parsed.rows.length && next) throw failure("PAGINATION", "Empty nonterminal inventory page");
          if (rows.length + parsed.rows.length > maxRows) throw failure("LIMIT", "Inventory row limit reached");
          for (const node of parsed.nodes) body.appendChild(document.importNode(node, true));
          rows.push(...parsed.rows);
          pages++;
          token = next;
        }
        const sum = rows.reduce((sum2, row) => sum2 + row.qty, 0);
        if (!Number.isSafeInteger(sum)) throw failure("SCHEMA", "Inventory total exceeds the safe range");
        if (advertised !== null && sum !== advertised) throw failure("TOTAL", "Inventory quantity does not match the advertised total");
        complete = true;
        active(signal);
        evidence2({ endpoint: "inventory", outcome: "complete", pages, records: rows.length });
      } catch (cause) {
        active(signal);
        if (!(cause instanceof FcrReadError) || cause.code === "CANCELLED") throw cause;
        error = cause;
        evidence2({ endpoint: "inventory", outcome: "incomplete", code: error.code, pages, records: rows.length });
        if (!allowPartial) throw failure(error.code, "Inventory incomplete: " + error.message, { cause: error, partial: result(error.message, error.code) });
      }
      active(signal);
      return result(error?.message, error?.code);
    }
    async function history(queryValue, { signal, startDate, endDate, allowPartial = false } = {}) {
      const query = searchValue(queryValue), start = dateField(startDate), end = dateField(endDate);
      if (start.time > end.time) throw failure("INPUT", "Inventory History start date is after its end date");
      const document = await request("inventory-history", {
        s: query,
        startSearchDateString: start.native,
        endSearchDateString: end.native,
        dateStringFormat: "MM/dd/yyyy"
      }, signal);
      active(signal);
      const table = document.querySelector("#table-inventory-history");
      if (!table) throw failure("SCHEMA", "Inventory History table was not returned");
      const width = table.tHead?.rows[0]?.cells.length;
      if (!width) throw failure("SCHEMA", "Inventory History column headers are missing");
      const body = table.tBodies[0];
      if (!body) throw failure("SCHEMA", "Inventory History table body is missing");
      const validateRows = (candidate) => [...candidate.tBodies[0]?.rows || []].filter((node) => !node.querySelector("td.dataTables_empty")).map((node) => {
        if (node.cells.length !== width) throw failure("SCHEMA", "Inventory History row has unexpected columns");
        return node;
      });
      validateRows(table);
      let pages = 1, records = validateRows(table).length, complete = false, error;
      const seen = /* @__PURE__ */ new Set();
      try {
        let token = pagination(document);
        if (records > maxRows || token && !records) throw failure("PAGINATION", "Inventory History page is empty or exceeds the row limit");
        while (token) {
          if (seen.has(token) || pages >= maxPages) throw failure("PAGINATION", "Inventory History continuation cycle/limit");
          seen.add(token);
          const page2 = await request("inventory-history-more", { token }, signal);
          active(signal);
          const nextTable = page2.querySelector("#table-inventory-history") || page2.querySelector("table:not([id])");
          if (!nextTable) throw failure("SCHEMA", "Inventory History continuation table was not returned");
          if (!nextTable.tBodies[0]) throw failure("SCHEMA", "Inventory History continuation table body is missing");
          const nodes = validateRows(nextTable), next = pagination(page2);
          if (!nodes.length && next || records + nodes.length > maxRows) throw failure("PAGINATION", "Inventory History continuation is empty or exceeds the row limit");
          for (const node of nodes) body.appendChild(document.importNode(node, true));
          records += nodes.length;
          pages++;
          token = next;
        }
        complete = true;
      } catch (cause) {
        active(signal);
        if (!(cause instanceof FcrReadError) || cause.code === "CANCELLED" || !allowPartial) throw cause;
        error = cause;
      }
      document.querySelectorAll(".pagination-token").forEach((node) => node.remove());
      active(signal);
      evidence2({ endpoint: "inventory-history", outcome: complete ? "complete" : "incomplete", pages, records, code: error?.code });
      active(signal);
      return { query, html: document.body.innerHTML, pages, records, complete, warning: error?.message || "", ...error ? { code: error.code } : {}, source: "network" };
    }
    async function section(endpoint, query, options = {}) {
      if (!FCR_SECTIONS.includes(endpoint)) throw failure("INPUT", "Unsupported native FCR section");
      if (endpoint === "inventory") return inventory(query, options);
      if (endpoint === "product") return readProduct(query, options, true);
      if (endpoint === "inventory-history" && (options.startDate || options.endDate)) return history(query, options);
      const search = searchValue(query), document = await request(endpoint, { s: search }, options.signal);
      active(options.signal);
      const recognized = document.querySelector('table, [data-section-type="' + endpoint + '"]');
      if (!recognized) throw failure("SCHEMA", "Native section markup was not returned");
      let pages = 1, records = 0, paginationComplete = false, error;
      const table = document.getElementById("table-" + endpoint), body = table?.tBodies[0], width = table?.tHead?.rows[0]?.cells.length;
      const validate = (candidate) => [...candidate?.tBodies[0]?.rows || []].filter((node) => !node.querySelector("td.dataTables_empty")).map((node) => {
        if (node.cells.length !== width) throw failure("SCHEMA", endpoint + ": continuation row has unexpected columns");
        return node;
      });
      if (body && width) records = validate(table).length;
      if (records > maxRows) throw failure("LIMIT", endpoint + ": native row limit reached");
      try {
        let token = pagination(document);
        if (token && (!body || !width)) throw failure("SCHEMA", endpoint + ": paginated native table was not returned");
        const seen = /* @__PURE__ */ new Set();
        if (records > maxRows || token && !records) throw failure("PAGINATION", endpoint + ": nonterminal page is empty or exceeds the row limit");
        while (token) {
          if (seen.has(token) || pages >= maxPages) throw failure("PAGINATION", endpoint + ": continuation cycle/limit");
          seen.add(token);
          const page2 = await request(endpoint + "-more", { token }, options.signal);
          active(options.signal);
          const nextTable = page2.getElementById("table-" + endpoint) || page2.querySelector("table:not([id])");
          if (!nextTable?.tBodies[0]) throw failure("SCHEMA", endpoint + ": continuation table was not returned");
          const headers = [...nextTable.tHead?.rows[0]?.cells || []];
          if (headers.length && (headers.length !== width || headers.some((header, index) => text(header.textContent) !== text(table.tHead.rows[0].cells[index].textContent)))) {
            throw failure("SCHEMA", endpoint + ": continuation columns changed");
          }
          const nodes = validate(nextTable), next = pagination(page2);
          if (!nodes.length && next || records + nodes.length > maxRows) throw failure("PAGINATION", endpoint + ": continuation is empty or exceeds the row limit");
          for (const marker of page2.querySelectorAll(".show-message")) document.getElementById(text(marker.textContent))?.classList.remove("aok-hidden");
          for (const node of nodes) body.appendChild(document.importNode(node, true));
          records += nodes.length;
          pages++;
          token = next;
        }
        paginationComplete = true;
      } catch (cause) {
        active(options.signal);
        if (!(cause instanceof FcrReadError) || cause.code === "CANCELLED" || !options.allowPartial) throw cause;
        error = cause;
      }
      document.querySelectorAll(".pagination-token").forEach((node) => node.remove());
      active(options.signal);
      return {
        endpoint,
        query: search,
        html: document.body.innerHTML,
        complete: false,
        paginationComplete,
        pages,
        records,
        warning: error?.message || "Native section completeness has not been validated",
        ...error ? { code: error.code } : {},
        source: "network"
      };
    }
    return Object.freeze({ product, barcodeProduct, inventory, history, section });
  }

  // gm-fetch.mjs
  function createGmFetch(window2, request) {
    return (url, init = {}) => new Promise((resolve, reject) => {
      let handle, settled = false;
      const signal = init.signal;
      function finish(error, value) {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", cancel);
        error ? reject(error) : resolve(value);
      }
      function cancel() {
        finish(new Error("Native request cancelled"));
        handle?.abort();
      }
      if (signal?.aborted) {
        cancel();
        return;
      }
      signal?.addEventListener("abort", cancel, { once: true });
      try {
        handle = request({ method: init.method || "GET", url: String(url), headers: init.headers || {}, data: init.body, timeout: 25e3, anonymous: false, onload: (response) => {
          if (typeof response.responseText !== "string" || response.responseText.length > 8e6) {
            finish(new Error("Native response invalid/oversized"));
            return;
          }
          const headers = /* @__PURE__ */ new Map();
          for (const line of String(response.responseHeaders || "").split(/\r?\n/)) {
            const index = line.indexOf(":");
            if (index > 0) headers.set(line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim());
          }
          const final = response.finalUrl || String(url);
          let redirected;
          try {
            redirected = new window2.URL(final).href !== new window2.URL(url).href;
          } catch {
            finish(new Error("Native redirect URL invalid"));
            return;
          }
          finish(null, { status: response.status, ok: response.status >= 200 && response.status < 300, url: final, redirected, headers: { get: (name) => headers.get(name.toLowerCase()) || null }, text: async () => response.responseText });
        }, onerror: () => finish(new Error("Native network error")), ontimeout: () => finish(new Error("Native request timed out")), onabort: () => finish(new Error("Native request cancelled")) });
      } catch {
        finish(new Error("Native transport unavailable"));
      }
    });
  }

  // fcr-enrichment.mjs
  var FCR_ENRICHMENT_VERSION = "0.1.1";
  var MEASUREMENT_ORIGIN = "https://o0avbo02yl.execute-api.ap-northeast-1.amazonaws.com";
  var BIN_URL = "https://aft-poirot-website-nrt.nrt.proxy.amazon.com/api/scanitem";
  var PANDASH_URL = "https://pandash.amazon.com/GridServlet";
  var clean2 = (value) => String(value ?? "").trim();
  var upper2 = (value) => clean2(value).toUpperCase();
  var fail = (code, message, options) => new FcrReadError(code, message, options);
  function active2(signal) {
    if (signal?.aborted) throw fail("CANCELLED", "Enrichment read cancelled", { cause: signal.reason });
  }
  function wait(ms, signal) {
    active2(signal);
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancelled);
      };
      const cancelled = () => {
        cleanup();
        reject(fail("CANCELLED", "Enrichment retry cancelled", { cause: signal.reason }));
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, ms);
      signal?.addEventListener("abort", cancelled, { once: true });
    });
  }
  function allowed(url, method) {
    const value = new URL(url);
    return !value.username && !value.password && (value.origin + value.pathname === PANDASH_URL && ["GET", "POST"].includes(method) || value.origin + value.pathname === BIN_URL && method === "POST" || value.origin === MEASUREMENT_ORIGIN && /^\/prod\/measurementEvents\/[A-Z0-9]{10}\/(?:FNSKU|ASIN)$/.test(value.pathname) && method === "GET");
  }
  function createGmJsonReader(gmRequest, { timeoutMs = 15e3 } = {}) {
    if (typeof gmRequest !== "function" || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 3e4) throw fail("INPUT", "GM read transport configuration is invalid");
    return function read({ url, method = "GET", headers = {}, body, signal }) {
      active2(signal);
      try {
        if (!allowed(url, method)) throw new Error();
      } catch {
        throw fail("INPUT", "Unsupported external read endpoint");
      }
      return new Promise((resolve, reject) => {
        let handle, settled = false;
        const finish = (error, value) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener("abort", cancelled);
          if (error) reject(error);
          else resolve(value);
        };
        const cancelled = () => {
          finish(fail("CANCELLED", "External read cancelled", { cause: signal.reason }));
          try {
            handle?.abort();
          } catch {
          }
        };
        signal?.addEventListener("abort", cancelled, { once: true });
        try {
          handle = gmRequest({
            url,
            method,
            headers,
            ...body == null ? {} : { data: body },
            responseType: "text",
            timeout: timeoutMs,
            onload: (response) => {
              if (settled) return;
              try {
                active2(signal);
                if ([401, 403].includes(response.status)) throw fail("AUTH_REQUIRED", "External read authentication required", { status: response.status });
                const final = response.finalUrl ? new URL(response.finalUrl) : new URL(url), requested = new URL(url);
                if (final.origin !== requested.origin || final.pathname !== requested.pathname) throw fail("AUTH_REQUIRED", "External read redirected to another resource");
                if (response.status < 200 || response.status >= 300) throw fail("HTTP", "External read HTTP " + response.status, { status: response.status });
                if (typeof response.responseText !== "string" || response.responseText.length > 1e6) throw fail("SCHEMA", "External read body is invalid or too large");
                let value;
                try {
                  value = JSON.parse(response.responseText);
                } catch {
                  throw fail("SCHEMA", "External read did not return JSON");
                }
                if (!value || typeof value !== "object" || Array.isArray(value)) throw fail("SCHEMA", "External read JSON object is missing");
                finish(null, value);
              } catch (error) {
                finish(error);
              }
            },
            onerror: () => finish(fail("NETWORK", "External read request failed")),
            ontimeout: () => finish(fail("TIMEOUT", "External read timed out")),
            onabort: () => finish(fail("CANCELLED", "External read aborted"))
          });
          if (signal?.aborted) cancelled();
        } catch (cause) {
          finish(fail("NETWORK", "External read could not start", { cause }));
        }
      });
    };
  }
  function createFcrEnrichment({
    warehouse,
    readJson,
    getMeasurementAuth = async () => null,
    historyFallback,
    now = Date.now,
    uuid = () => crypto.randomUUID(),
    maxMeasurementPages = 10,
    pandashRetryDelays = [500, 1500],
    onEvidence = () => {
    }
  }) {
    if (!/^[A-Z0-9-]{2,12}$/.test(warehouse) || typeof readJson !== "function" || !Number.isInteger(maxMeasurementPages) || maxMeasurementPages < 1 || maxMeasurementPages > 100 || !Array.isArray(pandashRetryDelays) || pandashRetryDelays.length > 2 || pandashRetryDelays.some((ms) => !Number.isFinite(ms) || ms < 0 || ms > 5e3)) throw fail("INPUT", "Enrichment configuration is invalid");
    const restrictionFlights = /* @__PURE__ */ new WeakMap();
    let restrictionCache, unscopedRestrictionFlight;
    function evidence2(endpoint, data) {
      try {
        onEvidence({ type: "fcr.read", script: "FCR ENRICHMENT", version: FCR_ENRICHMENT_VERSION, intent: "read", data: { endpoint, ...data } });
      } catch {
      }
    }
    async function read(options) {
      const parsed = new URL(options.url), pandash = parsed.origin + parsed.pathname === PANDASH_URL;
      const endpoint = parsed.pathname.startsWith("/prod/measurementEvents/") ? "measurementEvents" : parsed.pathname.split("/").at(-1);
      for (let attempt = 0; ; attempt++) {
        active2(options.signal);
        try {
          const result = await readJson(options);
          active2(options.signal);
          return result;
        } catch (error) {
          active2(options.signal);
          const retry = pandash && attempt < pandashRetryDelays.length && (["NETWORK", "TIMEOUT"].includes(error.code) || error.code === "HTTP" && (error.status === 429 || error.status >= 500 && error.status < 600));
          evidence2(endpoint, {
            outcome: "failed",
            code: error.code || "NETWORK",
            status: error.status,
            method: options.method || "GET",
            stage: options.stage,
            attempt: attempt + 1,
            retry
          });
          if (!retry) throw error;
        }
        await wait(pandashRetryDelays[attempt], options.signal);
      }
    }
    async function restriction(signal) {
      active2(signal);
      if (restrictionCache?.expiresAt > now()) return restrictionCache.value;
      const pending = signal ? restrictionFlights.get(signal) : unscopedRestrictionFlight;
      if (pending) return pending;
      const work = (async () => {
        const settings = await read({ url: PANDASH_URL + "?fc=" + encodeURIComponent(warehouse), signal, stage: "restriction" });
        if (typeof settings.restriction !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(settings.restriction)) throw fail("SCHEMA", "Native restriction is invalid");
        active2(signal);
        restrictionCache = { value: settings.restriction, expiresAt: now() + 18e5 };
        return settings.restriction;
      })();
      if (signal) restrictionFlights.set(signal, work);
      else unscopedRestrictionFlight = work;
      try {
        return await work;
      } finally {
        if (signal) restrictionFlights.delete(signal);
        else unscopedRestrictionFlight = null;
      }
    }
    async function hazmat(asinValue, { signal } = {}) {
      const asin = upper2(asinValue);
      if (!/^B[A-Z0-9]{9}$/.test(asin)) throw fail("INPUT", "An exact ASIN is required");
      let sourceRestriction = "default", restrictionWarning = "";
      try {
        sourceRestriction = await restriction(signal);
      } catch (error) {
        active2(signal);
        if (error.code === "AUTH_REQUIRED") throw error;
        restrictionWarning = "Restriction lookup failed; default restriction used";
      }
      const payload = await read({
        url: PANDASH_URL,
        method: "POST",
        stage: "hazmat",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ language: "default", source: sourceRestriction + "-hazmat-FC", marketPlaces: "AU", asins: asin, rows: "1", page: "1", fc: warehouse }).toString(),
        signal
      });
      if (!Array.isArray(payload.rows)) throw fail("SCHEMA", "Hazmat rows are missing");
      const matches = payload.rows.filter((row) => upper2(row?.asin) === asin);
      if (!matches.length) return { hazmat: null, complete: false, warning: "No exact ASIN hazmat result", source: "network" };
      const mapped = matches.map((row) => {
        const level = Number(row.level);
        if (!["number", "string"].includes(typeof row.level) || !/^\d+$/.test(clean2(row.level)) || !Number.isSafeInteger(level) || level < 0 || row.message != null && typeof row.message !== "string") throw fail("SCHEMA", "Hazmat level/message is invalid");
        return { level, message: row.message ?? "" };
      });
      if (new Set(mapped.map((row) => JSON.stringify(row))).size > 1) throw fail("IDENTITY", "Conflicting exact ASIN hazmat rows");
      active2(signal);
      evidence2("hazmat", { outcome: "complete", level: mapped[0].level });
      return { hazmat: mapped[0], complete: true, warning: restrictionWarning, source: "network" };
    }
    async function binDescription(containerValue, itemValue, { signal, verifiedAliases = [] } = {}) {
      const container = clean2(containerValue), item = upper2(itemValue);
      if (!container || container.length > 128 || !item || item.length > 128 || !Array.isArray(verifiedAliases)) throw fail("INPUT", "Bin read identities are invalid");
      const payload = await read({
        url: BIN_URL,
        method: "POST",
        headers: { Accept: "*/*", "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
          containerScannableId: container,
          isMasterpack: null,
          itemAndonContext: null,
          itemBarcode: item,
          requestId: "amzn1.fc.v1.common.request-id.v1.AFTPoirotWebsite." + uuid(),
          tool: "V3"
        })
      });
      if (!Array.isArray(payload.items)) throw fail("SCHEMA", "Native bin item rows are missing");
      const wanted = /* @__PURE__ */ new Set([item, ...verifiedAliases.map(upper2)]), matches = [];
      for (const row of payload.items) {
        if (!row || typeof row !== "object") throw fail("SCHEMA", "Native bin item row is invalid");
        if (/^X[A-Z0-9]{9}$/.test(item) && row.skuDetail?.fnSku && upper2(row.skuDetail.fnSku) !== item) continue;
        const codes = [row.scannableId, row.value, row.scannedBarcode, row.skuDetail?.fnSku, row.skuDetail?.asin, row.skuDetail?.fcSku].map(upper2).filter(Boolean);
        const matched = codes.find((code) => wanted.has(code));
        if (matched && typeof row.binDescription === "string" && clean2(row.binDescription)) matches.push({ size: clean2(row.binDescription), matched });
      }
      if (!matches.length) return { size: "", complete: false, warning: "No exact-item binDescription returned", source: "network" };
      if (new Set(matches.map((row) => row.size)).size > 1) throw fail("IDENTITY", "Conflicting exact-item binDescription");
      active2(signal);
      evidence2("scanitem", { outcome: "complete" });
      return { ...matches[0], complete: true, source: "network" };
    }
    async function fallback(identifier2, reason, signal, authRequired) {
      active2(signal);
      const result = historyFallback ? await historyFallback(identifier2, { signal }) : null;
      active2(signal);
      if (result && typeof result.madcat !== "boolean") throw fail("SCHEMA", "History fallback result is invalid");
      return {
        madcat: result?.madcat === true ? true : result?.complete === true ? false : null,
        source: "history-fallback",
        madcatSource: "history",
        complete: result?.complete === true,
        windowDays: null,
        authRequired,
        fallbackReason: reason,
        historyRows: result?.rows || 0
      };
    }
    async function recentMadcat({ fnsku, asin }, { signal, forceAuth = false } = {}) {
      const identifier2 = upper2(fnsku || asin), identifierType = fnsku ? "FNSKU" : "ASIN";
      if (!/^[A-Z0-9]{10}$/.test(identifier2)) throw fail("INPUT", "Measurement identifier is invalid");
      const before = now(), after = before - 30 * 24 * 60 * 60 * 1e3;
      let auth = await getMeasurementAuth(identifier2, { signal, force: forceAuth });
      active2(signal);
      const validAuth = (value) => value && typeof value.token === "string" && value.token && Number.isFinite(value.expiresAt) && value.expiresAt > now() + 1e4;
      if (!validAuth(auth)) return fallback(identifier2, "measurement-login-required", signal, true);
      const url = new URL(MEASUREMENT_ORIGIN + "/prod/measurementEvents/" + identifier2 + "/" + identifierType);
      url.searchParams.set("effectiveAfter", new Date(after).toISOString());
      url.searchParams.set("effectiveBefore", new Date(before).toISOString());
      const seen = /* @__PURE__ */ new Set();
      let next = "", pages = 0, eventsChecked = 0, renewed = false;
      do {
        active2(signal);
        if (pages >= maxMeasurementPages || next && seen.has(next)) throw fail("PAGINATION", "Measurement history incomplete or repeated");
        if (next) {
          seen.add(next);
          url.searchParams.set("nextToken", next);
        } else url.searchParams.delete("nextToken");
        let payload;
        try {
          payload = await read({ url: url.href, headers: { Accept: "application/json", Authorization: auth.token }, signal });
        } catch (error) {
          active2(signal);
          if (error.code === "AUTH_REQUIRED" && !renewed) {
            renewed = true;
            const fresh = await getMeasurementAuth(identifier2, { signal, force: true, previousToken: auth.token });
            active2(signal);
            if (!validAuth(fresh) || fresh.token === auth.token) return fallback(identifier2, "measurement-token-expired", signal, true);
            auth = fresh;
            try {
              payload = await read({ url: url.href, headers: { Accept: "application/json", Authorization: auth.token }, signal });
            } catch (retryError) {
              active2(signal);
              if (retryError.code === "AUTH_REQUIRED") return fallback(identifier2, "measurement-token-expired", signal, true);
              if (retryError.status === 400) return fallback(identifier2, "measurement-http-400", signal, false);
              throw retryError;
            }
          } else if (error.code === "AUTH_REQUIRED") return fallback(identifier2, "measurement-token-expired", signal, true);
          else if (error.status === 400) return fallback(identifier2, "measurement-http-400", signal, false);
          else throw error;
        }
        if (!Array.isArray(payload.measurementEvents) || payload.measurementEvents.length > 1e4) throw fail("SCHEMA", "Measurement events are missing or oversized");
        let positive = false;
        for (const event of payload.measurementEvents) {
          if (!event || typeof event.measurementSource !== "string" || !event.measurementSource || !Number.isFinite(Date.parse(event.measurementInstant))) {
            throw fail("SCHEMA", "Measurement event source/time is invalid");
          }
          const instant = Date.parse(event.measurementInstant);
          if (upper2(event.measurementSource) === "MADCAT" && instant >= after && instant <= before) positive = true;
        }
        pages++;
        eventsChecked += payload.measurementEvents.length;
        if (payload.nextToken != null && typeof payload.nextToken !== "string") throw fail("PAGINATION", "Measurement continuation token is invalid");
        next = clean2(payload.nextToken);
        if (next.length > 16384) throw fail("PAGINATION", "Measurement continuation token is oversized");
        if (positive) {
          active2(signal);
          evidence2("measurementEvents", { outcome: "positive", pages, eventsChecked });
          return { madcat: true, madcatSource: "raw", windowDays: 30, complete: true, pages, eventsChecked, identifierType, source: "network" };
        }
      } while (next);
      active2(signal);
      evidence2("measurementEvents", { outcome: "negative", pages, eventsChecked });
      return { madcat: false, madcatSource: "raw", windowDays: 30, complete: true, pages, eventsChecked, identifierType, source: "network" };
    }
    return Object.freeze({ hazmat, binDescription, recentMadcat });
  }

  // sideline-preflight.mjs
  function createSidelinePreflight({ window: window2, client, gmRequest, onEvidence = () => {
  } }) {
    let enrichment;
    return async (source, code, { signal } = {}) => {
      const result = await client.item(source, code, { signal });
      if (result.kind === "red" || !result.ctx?.hazmat) return result;
      try {
        const context = await client.bootstrap({ signal });
        enrichment ||= createFcrEnrichment({ warehouse: context.warehouse, readJson: createGmJsonReader(gmRequest), onEvidence, uuid: () => window2.crypto.randomUUID() });
        const hazard = await enrichment.hazmat(result.ctx.asin, { signal });
        if (/can be processed/i.test(hazard.message) && !/cannot|can't|not be processed/i.test(hazard.message)) return { ...result, reason: result.kind === "yellow" ? result.reason : "HAZMAT L" + hazard.level + " — OK TO PROCESS" };
        return { kind: "red", reason: "HAZMAT L" + hazard.level + " — NOT PROCESSABLE", ctx: result.ctx };
      } catch (error) {
        return { kind: "retry", reason: "HAZMAT CHECK UNKNOWN — " + error.message, ctx: result.ctx };
      }
    };
  }

  // iss-worker.mjs
  function installIssWorker({ window: window2, page: page2, gmRequest }) {
    const context = issWorkerContext(window2);
    if (!context) return null;
    const identity = () => resolveIdentity(window2, page2), gm = createGmFetch(window2, gmRequest), fcrOrigin = context.parentOrigin, reader = () => createFcrReader({ origin: fcrOrigin, warehouse: "BWU2", DOMParser: window2.DOMParser, fetch: gm });
    const aft = /^aft-qt-.*\.corp\.amazon\.com$/.test(window2.location.hostname);
    if (!aft && window2.location.hostname !== "aft-poirot-website-nrt.nrt.proxy.amazon.com") return null;
    return serveIssWorker({ window: window2, kind: aft ? "aft" : "sideline", engine: ({ progress, evidence: evidence2, pickDate }) => {
      if (aft) {
        let cancelled = false;
        const client2 = createAftClient({ window: window2, fetch: page2.fetch.bind(page2), onStage: (stage) => progress({ stage }) }), runner = createAftRunner({ window: window2, client: client2, identity, reader, onChange: (message, rows) => progress({ message, rows }), onInventory: (choices, row) => progress({ choices, code: row.code }), onEvidence: evidence2 });
        return { async run(payload) {
          cancelled = false;
          if (!["edit", "move"].includes(payload.area) || !Array.isArray(payload.items)) throw Object.assign(new Error("Invalid AFT worker command"), { outcome: "REJECTED" });
          const mode = payload.mode;
          if (!AFT_MODES[mode] || payload.items.some((row) => row.mode !== mode)) throw Object.assign(new Error("Invalid AFT mode/rows"), { outcome: "REJECTED" });
          await runner.switchMode(mode, { navigate: false });
          if (cancelled) throw Object.assign(new Error("Stopped before AFT item submission"), { outcome: "REJECTED" });
          const before = new Set(runner.rows.map((row) => row.id));
          await runner.run(payload.items);
          const rows = runner.rows.filter((row) => !before.has(row.id) || row.state === "QUEUED" || row.state === "UNKNOWN");
          if (!rows.length) throw Object.assign(new Error("Native workflow did not create any item rows"), { outcome: "REJECTED" });
          return { rows, outcome: rows.some((row) => ["UNKNOWN", "SUBMITTED"].includes(row.state)) ? "UNKNOWN" : rows.every((row) => row.state === "CONFIRMED") ? "CONFIRMED" : "REJECTED" };
        }, stop: () => {
          cancelled = true;
          runner.stop();
        }, clear: () => {
          if (!runner.busy) void runner.clear().catch((error) => progress({ message: error.message }));
        }, rows: () => runner.rows, dispose: () => runner.dispose() };
      }
      const client = createSidelineClient({ window: window2, fetch: page2.fetch.bind(page2), identity, onEvidence: evidence2 });
      const preflight = createSidelinePreflight({ window: window2, client, gmRequest, onEvidence: evidence2 });
      const workflow = createSidelineWorkflow({ window: window2, client, preflight, pickDate, onChange: (state) => progress(state), onEvidence: evidence2 });
      return { async run(payload) {
        if (payload.area !== "sideline" || !["queue", "lazy"].includes(payload.mode)) throw Object.assign(new Error("Invalid Sideline worker command"), { outcome: "REJECTED" });
        await workflow.run(payload.mode, payload.options);
        const rows = workflow.getRows(), state = workflow.getState();
        if (!rows.length) throw Object.assign(new Error(state.message || "No native Sideline rows"), { outcome: "REJECTED" });
        return { rows, outcome: rows.some((row) => ["UNKNOWN", "SUBMITTED"].includes(row.state)) ? "UNKNOWN" : rows.every((row) => row.state === "CONFIRMED") ? "CONFIRMED" : "REJECTED", message: state.message };
      }, scan: (data) => workflow.scan(data.code), pause: () => workflow.pause(), stop: () => workflow.stop(), clear: () => {
        if (!workflow.getState().busy) workflow.reset();
      }, rows: () => workflow.getRows(), dispose: () => workflow.dispose() };
    } });
  }

  // iss-entry.mjs
  var VERSION = "0.1.0";
  var page = typeof unsafeWindow === "object" ? unsafeWindow : window;
  var guard = Symbol.for("tampermonkey.v4.iss.installer");
  if (!page[guard]) {
    page[guard] = { version: VERSION };
    installRouteLifecycle(window, () => {
      if (issWorkerContext(window)) {
        const worker = installIssWorker({ window, page, gmRequest: GM_xmlhttpRequest });
        return () => worker?.dispose();
      }
      if (window.top !== window.self || location.hash !== "#iss-console") return;
      const release = registerWatermark(window, "ISSC", VERSION), emit = (data) => evidence(window, "ISSC", VERSION, data), ui = createIssConsole({ window, version: VERSION, onEvidence: emit, bridgeFactory: (options) => createIssBridge({ window, ...options }) });
      return () => {
        ui.dispose();
        release();
      };
    }, () => location.pathname + location.hash, { waitForDom: true });
  }
})();
