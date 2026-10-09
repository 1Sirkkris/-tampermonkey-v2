// ==UserScript==
// @name V4 AFT Edit SKU Move
// @namespace https://github.com/1Sirkkris/tampermonkey-v4
// @version 0.1.1
// @description Native AFT EACH/SKU/Date/Move/Flip with durable unresolved action barriers.
// @include /^https?:\/\/aft-qt-[^\/]+\.corp\.amazon\.com\/app\/(?:edititems|moveitems|fcskuflip)/
// @grant unsafeWindow
// @grant GM_xmlhttpRequest
// @connect fcresearch-fe.aka.amazon.com
// @connect qi-fcresearch-fe.corp.amazon.com
// @connect qi-fcresearch-jp.corp.amazon.com
// @connect qifcr.fe.aftx.amazonoperations.app
// @run-at document-start
// @updateURL https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/AFT_Edit_SKU_Move.user.js
// @downloadURL https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/AFT_Edit_SKU_Move.user.js
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
    async function wait(definition, objectId, { signal, complete = false, timeout = 12e4 } = {}) {
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
      return wait(definition, objectId, options);
    }
    async function end(definition, objectId, signal) {
      await request("/end", { ...id(definition, objectId), tool: definition.tool }, { signal });
    }
    async function fresh(definition, previous = "", signal) {
      const deadline = Date.now() + 8e3;
      while (Date.now() < deadline) {
        const snap = await page2(definition, "", signal);
        if (snap.objectId !== previous) {
          await wait(definition, snap.objectId, { signal, timeout: 8e3 });
          return snap;
        }
        await delay(100, signal);
      }
      throw new Error("Fresh native workflow unavailable");
    }
    return { page: page2, wait, action, end, fresh, delay, id };
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
        if (upper(code) === "123START") continue;
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
    let journal = createOperationJournal({ storage: window2.localStorage, key: AFT_KEY, uuid: () => window2.crypto.randomUUID() }), busy = false, stopped = false, disposed = false, active2 = null, controller = null, promise = null;
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
      return client.page(definition, id, active2?.state === "SUBMITTED" ? void 0 : controller.signal);
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
        onInventory(choices);
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
          active2 = row;
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
            active2 = null;
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
          active2 = row;
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
        active2 = null;
        controller = null;
        busy = false;
        changed("Mode switch settled");
      }
    }
    function stop() {
      stopped = true;
      if (active2?.state !== "SUBMITTED") controller?.abort();
      changed(active2?.state === "SUBMITTED" ? "Stop requested — settling submitted outcome" : "Stopped before next submission");
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
      if (active2) {
        try {
          state(active2, active2.state === "SUBMITTED" || active2.prepared ? "UNKNOWN" : "REJECTED", "Page disposed — native outcome requires review");
          if (active2.operationId) emit(active2, active2.state);
        } catch {
        }
      }
      controller?.abort();
    } };
  }

  // aft-runtime.mjs
  function detectAftMode(window2) {
    const text2 = clean(window2.document.querySelector("main,#aft-tool,#aft-tool-sub-main")?.textContent || [...window2.document.body.children].filter((node) => !node.dataset.tmV4Script).map((node) => node.textContent).join(" "));
    if (/\/fcskuflip/.test(window2.location.pathname)) return "flip";
    if (/\/moveitems/.test(window2.location.pathname)) return /Mode\s*:\s*Each/i.test(text2) ? "moveEach" : /Mode\s*:\s*Multi/i.test(text2) ? "moveAll" : /Mode\s*:\s*Container/i.test(text2) ? "moveContainer" : "";
    return /Mode\s*:\s*Sku/i.test(text2) ? "sku" : /Mode\s*:\s*Datelot/i.test(text2) ? "date" : /Mode\s*:\s*Each/i.test(text2) ? "each" : "";
  }
  function createAftUi({ window: window2, runner, version, onError = () => {
  } }) {
    const d = window2.document, mode = detectAftMode(window2), events = new window2.AbortController();
    let minimized = false;
    const root = d.createElement("section");
    root.id = "tm-v4-aft";
    root.dataset.tmV4Script = "AFT";
    const control = d.createElement("aside");
    control.id = "tm-v4-aft-control";
    control.dataset.tmV4Script = "AFT";
    const style = d.createElement("style");
    style.dataset.tmV4Style = "AFT";
    style.textContent = `#tm-v4-aft{position:fixed;top:125px;left:15px;width:368px;max-height:calc(100vh - 145px);overflow:auto;z-index:999990;background:#eff7fb;border:2px solid #52758e;border-radius:6px;box-shadow:0 2px 6px #0003;color:#152a3c;font:12px Arial}#tm-v4-aft[data-mode^=move]{width:318px}#tm-v4-aft[data-mode=flip]{top:86px;left:10px;width:320px}#tm-v4-aft[data-mode=date]{top:auto;left:auto;right:14px;bottom:14px;width:420px}#tm-v4-aft header{display:flex;align-items:center;justify-content:space-between;background:#294f6b;color:white;padding:7px;font-weight:bold}#tm-v4-aft[data-mode^=move] header{background:#256845}#tm-v4-aft .body{padding:9px}#tm-v4-aft input,#tm-v4-aft textarea,#tm-v4-aft select{box-sizing:border-box;max-width:100%;border:1px solid #9caec0;border-radius:4px;padding:5px;background:white;color:#152a3c}#tm-v4-aft input:not([type=checkbox]),#tm-v4-aft textarea{width:100%}#tm-v4-aft textarea{height:120px;resize:vertical;font:12px monospace}#tm-v4-aft button,#tm-v4-aft-control button{padding:6px;border:1px solid #8ba0af;border-radius:4px;cursor:pointer;font-weight:700;background:#ddeaf2;color:#173b56}#tm-v4-aft button:disabled,#tm-v4-aft-control button:disabled{opacity:.45;cursor:default}#tm-v4-aft .grid{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:7px 0}#tm-v4-aft [data-run]{background:#247045;color:white}#tm-v4-aft [data-stop]{background:#a33d2c;color:white}#tm-v4-aft .rows{max-height:170px;overflow:auto;margin-top:7px;font:11px monospace;white-space:pre-wrap;overflow-wrap:anywhere}#tm-v4-aft [data-state=UNKNOWN],#tm-v4-aft [data-state=SUBMITTED]{background:#fff2be}#tm-v4-aft [data-state=REJECTED]{background:#ffe2de}#tm-v4-aft [data-state=CONFIRMED]{background:#d9f5df}#tm-v4-aft-control{position:fixed;top:76px;right:10px;width:278px;padding:8px;z-index:999991;border:1px solid #7593a9;border-radius:7px;background:#f5fafc;color:#234154;font:12px Arial}#tm-v4-aft-control .modes{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin:7px 0}#tm-v4-aft-control [data-current=true]{outline:2px solid #1d6fa8}#tm-v4-aft .choices{display:flex;gap:4px;flex-wrap:wrap}#tm-v4-aft .choices button{flex:1;font-size:11px}#tm-v4-aft .choices [data-selected=true]{background:#176c96;color:white}#tm-v4-aft .date-row{display:grid;grid-template-columns:1.25fr 1fr;gap:6px;margin:6px 0}#tm-v4-aft .date-head{font-weight:bold;padding:7px 0}#tm-v4-aft label{display:block;margin:6px 0}#tm-v4-aft .qty{display:flex;gap:8px;font-weight:bold}`;
    root.dataset.mode = mode;
    root.innerHTML = `<header><span>AFT V4 ${escapeHtml(version)} • ${escapeHtml(AFT_MODES[mode]?.title || "Select native mode")}</span><button data-min>−</button></header><div class="body"><div role="status">Ready • native mode required</div><div class="entry"></div><div class="grid"><button data-run>RUN</button><button data-stop>STOP AFTER CURRENT ITEM</button></div><button data-clear>CLEAR</button><div class="rows"></div></div>`;
    control.innerHTML = `<b>AFT CONTROL</b><div class="modes">${Object.entries(AFT_MODES).map(([key, def]) => `<button data-mode="${key}" data-current="${mode === key}">${escapeHtml(def.title)}</button>`).join("")}</div><label><input type="checkbox" data-enable checked> ${mode.startsWith("move") ? "MoveItems" : "EditItems"} helper</label>${mode === "sku" ? '<label><input type="checkbox" data-batch> SKU batch queue</label>' : ""}<div data-mode-status>Native workflow modes</div>`;
    const stateOptions = ["INVENTORY", "PENDING_RESEARCH", "UNSELLABLE"], damageOptions = ["AMAZON_DAMAGE", "DEFECTIVE", "DISTRIBUTOR_DAMAGE", "EXPIRED"], select = (name, options) => `<select data-field="${name}">${options.map((value) => `<option>${value}</option>`).join("")}</select>`;
    const stateFields = (source) => `${source ? "<label>Current state " + select("currentState", stateOptions) + "</label><label>Current disposition " + select("currentDamage", damageOptions) + "</label>" : ""}<label>New state ${select("desiredState", stateOptions)}</label><label>New disposition ${select("desiredDamage", damageOptions)}</label>`;
    let content = "";
    if (mode === "each") content = `<label>TOTE ASIN [FNSKU]<textarea data-field="text" placeholder="tsX… B0… X0…"></textarea></label>${stateFields(false)}`;
    if (mode === "sku") content = `<div class="qty"><span data-qty="SELLABLE">S: —</span><span data-qty="PENDING_RESEARCH">P: —</span><span data-qty="UNSELLABLE">U: —</span></div><label data-single>SKU / ASIN / FNSKU / FCSKU<input data-field="code"></label><label data-batch-wrap hidden>One SKU per line<textarea data-field="text"></textarea></label>${stateFields(true)}`;
    if (mode === "date") content = '<label>Tote<input data-field="location"></label><div class="date-head">ASIN / FNSKU / UPC / EAN • Desired date</div><div data-date-rows></div><button data-add-row>+ ADD ROW</button>';
    if (mode === "flip") content = '<label>OLD FCSKU<input data-field="old"></label><label>NEW FCSKU<input data-field="newCode"></label><label>LOCATIONS / CONTAINERS<textarea data-field="text"></textarea></label>';
    if (mode.startsWith("move")) content = `<label>SOURCE<input data-field="source"></label><label>DESTINATION<input data-field="destination"></label>${mode === "moveAll" ? '<div class="grid"><label>Quantity<select data-field="quantityMode"><option value="all">ALL</option><option value="user">USER QTY</option></select></label><label>QTY<input type="number" min="1" step="1" data-field="quantity" value="1"></label></div>' : ""}<label>ITEM BARCODES<textarea data-field="text"></textarea></label>${mode === "moveContainer" ? "<p>Container mode uses the native form. V4 observes no container transfer proof here; helper Run is disabled.</p>" : ""}`;
    root.querySelector(".entry").innerHTML = content;
    function addDateRow(code = "", date = "") {
      const row = d.createElement("div");
      row.className = "date-row";
      row.innerHTML = '<input data-date-code autocomplete="off" placeholder="ASIN / FNSKU / UPC / EAN"><input data-date-value type="date">';
      row.querySelector("[data-date-code]").value = code;
      row.querySelector("[data-date-value]").value = date;
      root.querySelector("[data-date-rows]").append(row);
      return row;
    }
    if (mode === "date") for (let i = 0; i < 4; i++) addDateRow();
    const draftKey = "tm-v4.aft.draft." + mode;
    try {
      const saved = JSON.parse(window2.localStorage.getItem(draftKey) || "{}");
      for (const node of root.querySelectorAll("[data-field]")) if (saved[node.dataset.field] != null) node.value = saved[node.dataset.field];
      minimized = saved.minimized === true;
      if (mode === "date" && Array.isArray(saved.dateRows)) {
        root.querySelector("[data-date-rows]").replaceChildren();
        for (const row of saved.dateRows) addDateRow(row.code, row.date);
        if (!saved.dateRows.length) for (let i = 0; i < 4; i++) addDateRow();
      }
    } catch {
    }
    const message = (text2) => root.querySelector("[role=status]").textContent = text2;
    function save() {
      const data = { minimized };
      if (mode === "date") data.dateRows = [...root.querySelectorAll(".date-row")].map((row) => ({ code: row.querySelector("[data-date-code]").value, date: row.querySelector("[data-date-value]").value }));
      for (const node of root.querySelectorAll("[data-field]")) data[node.dataset.field] = node.value;
      window2.localStorage.setItem(draftKey, JSON.stringify(data));
    }
    function drawChoices() {
      if (!["each", "sku"].includes(mode)) return;
      const current = root.querySelector("[data-field=currentState]"), desired = root.querySelector("[data-field=desiredState]"), sourceDamage = root.querySelector("[data-field=currentDamage]"), targetDamage = root.querySelector("[data-field=desiredDamage]");
      if (current) {
        for (const option of desired.options) option.disabled = current.value !== "UNSELLABLE" && option.value === current.value;
        if (desired.selectedOptions[0]?.disabled) desired.value = [...desired.options].find((option) => !option.disabled).value;
      }
      for (const option of targetDamage.options) option.disabled = current?.value === "UNSELLABLE" && desired.value === "UNSELLABLE" && option.value === sourceDamage.value;
      if (targetDamage.selectedOptions[0]?.disabled) targetDamage.value = [...targetDamage.options].find((option) => !option.disabled).value;
      for (const name of ["currentDamage", "desiredDamage"]) {
        const field = root.querySelector("[data-field=" + name + "]");
        if (field) field.closest("label").hidden = (name === "currentDamage" ? current?.value : desired.value) !== "UNSELLABLE";
      }
      for (const button of root.querySelectorAll("[data-choice]")) {
        const field = root.querySelector("[data-field=" + button.dataset.choice + "]"), option = [...field.options].find((option2) => option2.value === button.dataset.value);
        button.disabled = runner.busy || option?.disabled;
        button.dataset.selected = String(field.value === button.dataset.value);
        button.setAttribute("aria-pressed", String(field.value === button.dataset.value));
      }
    }
    function paint(text2, rows = runner.rows) {
      if (text2) message(text2);
      root.querySelector(".body").hidden = minimized;
      drawChoices();
      root.querySelector("[data-min]").textContent = minimized ? "+" : "−";
      root.querySelector("[data-run]").disabled = runner.busy || !mode || mode === "moveContainer";
      root.querySelectorAll("[data-field]").forEach((node) => node.disabled = runner.busy);
      control.querySelectorAll("[data-mode]").forEach((node) => node.disabled = runner.busy);
      root.querySelector(".rows").innerHTML = rows.map((row) => `<div data-state="${escapeHtml(row.state)}">${escapeHtml(row.code || row.container)} • ${escapeHtml(row.state)}<br>${escapeHtml(row.message)}</div>`).join("");
    }
    async function run() {
      try {
        const meta = {};
        for (const node of root.querySelectorAll("[data-field]")) meta[node.dataset.field] = clean(node.value);
        const batch = control.querySelector("[data-batch]")?.checked;
        const text2 = mode === "date" ? [...root.querySelectorAll(".date-row")].map((row) => ({ code: clean(row.querySelector("[data-date-code]").value), date: row.querySelector("[data-date-value]").value })).filter((row) => row.code || row.date).map((row) => row.code + " " + row.date).join("\n") : mode === "sku" && !batch ? meta.code : root.querySelector("[data-field=text]")?.value || "";
        save();
        const task = runner.run(parseAftRows(mode, text2, meta));
        paint();
        await task;
        paint();
        if (runner.rows.length && runner.rows.every((row) => ["CONFIRMED", "REJECTED"].includes(row.state)) && mode.startsWith("move")) {
          for (const node of root.querySelectorAll("[data-field=source],[data-field=destination],[data-field=text]")) node.value = "";
          save();
          root.querySelector("[data-field=source]").focus();
        }
      } catch (error) {
        message(error.message);
        onError(error);
      }
    }
    root.addEventListener("input", (event) => {
      if (mode === "date" && event.target.matches("[data-date-code]") && event.target.value && event.target.closest(".date-row") === root.querySelector("[data-date-rows]").lastElementChild) addDateRow();
      save();
    }, { signal: events.signal });
    root.addEventListener("click", (event) => {
      const target = event.target.closest("button");
      if (!target) return;
      if (target.hasAttribute("data-add-row")) addDateRow().querySelector("input").focus();
      if (target.hasAttribute("data-choice")) {
        const field = root.querySelector('[data-field="' + target.dataset.choice + '"]');
        field.value = target.dataset.value;
        field.dispatchEvent(new window2.Event("change", { bubbles: true }));
        save();
        drawChoices();
      }
      if (target.hasAttribute("data-run")) void run();
      if (target.hasAttribute("data-stop")) {
        runner.stop();
      }
      if (target.hasAttribute("data-clear")) {
        void runner.clear().then(() => {
          for (const node of root.querySelectorAll("input:not([type=number]),textarea")) node.value = "";
          save();
          paint();
        }).catch((error) => message(error.message));
      }
      if (target.hasAttribute("data-min")) {
        minimized = !minimized;
        save();
        paint();
      }
    }, { signal: events.signal });
    control.addEventListener("click", (event) => {
      const key = event.target.closest("[data-mode]")?.dataset.mode;
      if (key) void runner.switchMode(key).catch((error) => {
        control.querySelector("[data-mode-status]").textContent = error.message;
      });
    }, { signal: events.signal });
    control.addEventListener("change", (event) => {
      if (event.target.matches("[data-enable]")) root.hidden = !event.target.checked;
      if (event.target.matches("[data-batch]")) {
        root.querySelector("[data-single]").hidden = event.target.checked;
        root.querySelector("[data-batch-wrap]").hidden = !event.target.checked;
      }
    }, { signal: events.signal });
    d.addEventListener("keydown", (event) => {
      if (!root.contains(event.target) || event.key !== "Enter") return;
      const field = event.target;
      if (field.matches("[data-field=source],[data-field=old]")) {
        event.preventDefault();
        root.querySelector(mode === "flip" ? "[data-field=newCode]" : "[data-field=destination]")?.focus();
      } else if (field.matches("[data-field=destination],[data-field=newCode],[data-field=location]")) {
        event.preventDefault();
        root.querySelector("[data-field=text]")?.focus();
      } else if (field.tagName === "TEXTAREA" && upper(field.value.trim().split(/\r?\n/).at(-1)) === "123START") {
        event.preventDefault();
        field.value = field.value.replace(/123START\s*$/i, "");
        void run();
      } else if (mode === "sku" && field.matches("[data-field=code]")) {
        event.preventDefault();
        void run();
      }
      event.stopImmediatePropagation();
    }, { capture: true, signal: events.signal });
    if (["each", "sku"].includes(mode)) {
      const labels = { INVENTORY: "Sellable", PENDING_RESEARCH: "Pending", UNSELLABLE: "Unsellable", AMAZON_DAMAGE: "Amazon Damage", DEFECTIVE: "Defective", DISTRIBUTOR_DAMAGE: "Distributor Damage", EXPIRED: "Expired" };
      for (const select2 of root.querySelectorAll(".entry select[data-field]")) {
        select2.hidden = true;
        const group = d.createElement("span");
        group.className = "choices";
        for (const option of select2.options) {
          const button = d.createElement("button");
          button.type = "button";
          button.dataset.choice = select2.dataset.field;
          button.dataset.value = option.value;
          button.textContent = labels[option.value] || option.value;
          group.append(button);
        }
        select2.after(group);
      }
      const saved = window2.localStorage.getItem(draftKey);
      if (!saved) {
        root.querySelector("[data-field=desiredState]").value = "UNSELLABLE";
        root.querySelector("[data-field=desiredDamage]").value = mode === "sku" ? "DEFECTIVE" : "AMAZON_DAMAGE";
        if (mode === "sku") root.querySelector("[data-field=currentDamage]").value = "DEFECTIVE";
      }
      root.addEventListener("change", () => {
        drawChoices();
        save();
      }, { signal: events.signal });
    }
    d.body.append(style, root, control);
    paint();
    return { root, control, paint, inventory: (choices) => {
      for (const state of stateOptions) {
        const node = root.querySelector(`[data-qty="${state === "INVENTORY" ? "SELLABLE" : state}"]`);
        if (node) {
          const matches = choices.filter((row) => row.state === (state === "INVENTORY" ? "SELLABLE" : state));
          node.textContent = (state === "INVENTORY" ? "S" : state === "PENDING_RESEARCH" ? "P" : "U") + ": " + (matches.length === 1 ? matches[0].qty : "—");
        }
      }
    }, dispose() {
      events.abort();
      root.remove();
      control.remove();
      style.remove();
    } };
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
    function wait(ms, signal) {
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
        if (retry) await wait(retryDelays[attempt], signal);
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

  // aft-entry.mjs
  var VERSION = "0.1.1";
  var page = typeof unsafeWindow === "object" ? unsafeWindow : window;
  var guard = Symbol.for("tampermonkey.v4.aft.installer");
  if (!page[guard]) {
    page[guard] = { version: VERSION };
    installRouteLifecycle(window, () => {
      if (window.top !== window.self || !/^\/app\/(?:edititems|moveitems|fcskuflip)(?:\/|$)/.test(location.pathname)) return;
      const release = registerWatermark(window, "AFT", VERSION), emit = (data) => evidence(window, "AFT", VERSION, data), gm = createGmFetch(window, GM_xmlhttpRequest);
      let ui;
      const client = createAftClient({ window, fetch: page.fetch.bind(page), onStage: (stage) => ui?.paint(stage) }), runner = createAftRunner({ window, client, identity: () => resolveIdentity(window, page), reader: () => createFcrReader({ origin: localStorage.getItem("tm-v4.aft.fcr-origin") || "https://fcresearch-fe.aka.amazon.com", warehouse: "BWU2", DOMParser: window.DOMParser, fetch: gm, onEvidence: emit }), onChange: (message, rows) => ui?.paint(message, rows), onInventory: (choices) => ui?.inventory(choices), onEvidence: emit });
      ui = createAftUi({ window, runner, version: VERSION });
      return () => {
        runner.dispose();
        ui.dispose();
        release();
      };
    }, () => location.pathname, { waitForDom: true });
  }
})();
