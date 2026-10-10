// ==UserScript==
// @name V4 Sideline Queue + Lazy
// @namespace https://github.com/1Sirkkris/tampermonkey-v4
// @version 0.1.4
// @description Native Queue/Lazy/QTY scanners, preflight, expiry and durable outcome recovery.
// @match https://aft-poirot-website-nrt.nrt.proxy.amazon.com/*
// @grant unsafeWindow
// @grant GM_xmlhttpRequest
// @connect pandash.amazon.com
// @run-at document-start
// @updateURL https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Sideline_Queue_Lazy.user.js
// @downloadURL https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Sideline_Queue_Lazy.user.js
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
  function createReadPool(limit = 4) {
    let running = 0;
    const jobs = [];
    function drain() {
      while (running < limit && jobs.length) {
        const job = jobs.shift();
        if (job.signal?.aborted) {
          job.reject(job.signal.reason);
          continue;
        }
        running++;
        Promise.resolve().then(job.work).then(job.resolve, job.reject).finally(() => {
          running--;
          drain();
        });
      }
    }
    return (work, signal) => new Promise((resolve, reject) => {
      jobs.push({ work, signal, resolve, reject });
      drain();
    });
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
    const type = clean(data?.["@type"]), text = labels(data).join(" "), red = (reason) => ({ kind: "red", reason, ctx: null });
    if (customerBound(data)) return red("CUSTOMER-BOUND SHIPMENT");
    if (/InvalidBarcode/.test(type)) return red("INVALID BARCODE");
    if (/RequestMultipleBarcodes/.test(type)) return red("MULTIPLE BARCODE MATCHES");
    if (/damaged/i.test(text)) return red("DAMAGED / INCOMPATIBLE");
    const overage = allowedOverage(data);
    if (data?.success !== true && !overage) return red(text || "NO POSITIVE ITEM DETAILS");
    if (data?.filterResult?.compatible === false && !overage) return red(text || "INCOMPATIBLE");
    const records = Array.isArray(data?.items) ? data.items : [];
    if (!records.length || records.some((r) => !r?.skuDetail || !clean(r.skuDetail.asin) || !clean(r.skuDetail.fnSku) || !clean(r.skuDetail.fcSku) || !Number.isFinite(Number(r.quantity)) || Number(r.quantity) < 0)) return red("ITEM DETAILS INCOMPLETE");
    const keys = new Set(records.map((r) => upper(r.skuDetail.asin) + "|" + upper(r.skuDetail.fnSku)));
    if (keys.size !== 1) return red("MULTIPLE DISTINCT ITEM IDENTITIES");
    const sku = records[0].skuDetail;
    if (clean(sku.itemDropzoneRecommendation?.permissionLevel).toUpperCase() === "UNDER_REVIEW") return red("ASIN UNDER REVIEW — RIVER REQUIRED");
    if (/hazmat|dangerous.?goods/i.test(text) && (data.success === false || data.filterResult?.compatible === false || (data.problems || []).filter(Boolean).length)) return red("HAZMAT / DANGEROUS GOODS");
    const dateType = clean(sku.datelotDetail?.expirationPromptType);
    if (dateType && !["EXPIRATION_DATE", "PRODUCTION_DATE", "NONE", "NO_PROMPT"].includes(dateType)) return red("UNKNOWN DATE REQUIREMENT");
    const ctx = { barcode, records, sku, item: records[0], asin: clean(sku.asin), fnsku: clean(sku.fnSku), fcsku: clean(sku.fcSku), dateType, dateDetail: sku.datelotDetail || {}, hazmat: sku.hazmat === true, overage };
    return { kind: ["EXPIRATION_DATE", "PRODUCTION_DATE"].includes(dateType) ? "yellow" : "green", reason: dateType === "PRODUCTION_DATE" ? "PRODUCTION DATE" : dateType === "EXPIRATION_DATE" ? "EXPIRY DATE" : "GOOD TO GO", ctx };
  }
  function sidelineMovePayload({ source, destination, sourceMeta, ctx, quantity, expiration = null, uuid }) {
    return { itemExternalId: null, sourceContainerScannableId: source, destinationContainerScannableId: destination, scannableId: clean(ctx.item.scannableId || ctx.barcode), quantity: String(quantity), itemDetails: ctx.records.map((r) => ({ fcsku: clean(r.skuDetail.fcSku), quantity: Number(r.quantity), consumerType: r.consumer ?? null, disposition: r.disposition ?? null, referenceId: r.referenceId ?? null, fnsku: clean(r.skuDetail.fnSku) })), foundProblems: [null, null, null], scannedSourceContainerAsDestination: false, datelotDetail: ctx.sku.datelotDetail || null, userEnteredExpirationDate: expiration, mlcCaptureDetail: { mlcClass: ctx.sku.mlcDetail?.mlcClass ?? "UNKNOWN", userEnteredLotCode: null, mlcMissing: ctx.sku.mlcDetail?.mlcMissing ?? false, mlcNotEnteredReason: null, mlcCaptureMethod: null }, itemMovedToISS: false, candidatePurchaseOrders: [], packHierarchyDetail: null, itemAndonContext: null, processPath: sourceMeta?.processPath ?? "UNDETERMINED", requestId: sidelineRequestId(uuid), tool: SIDELINE_TOOL };
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

  // sideline-workflow.mjs
  var validSidelineContainer = (value) => /^(?:csX|tsX)[A-Za-z0-9_-]+$/i.test(clean(value));
  function parseSidelineItems(text, source, destination) {
    const map = /* @__PURE__ */ new Map();
    for (const raw of String(text).split(/\r?\n/)) {
      const value = clean(raw), key = upper(value);
      if (!value || ["123START", upper(source), upper(destination)].includes(key)) continue;
      if (validSidelineContainer(value)) continue;
      const row = map.get(key);
      if (row) row.quantity++;
      else map.set(key, { code: value, quantity: 1 });
    }
    return [...map.values()];
  }
  function sidelineDateKey(source, code, ctx) {
    return JSON.stringify([upper(source), upper(code), upper(ctx.asin), upper(ctx.fnsku), upper(ctx.fcsku), ctx.dateType, ctx.dateDetail?.shelfLife ?? null]);
  }
  function createSidelineWorkflow({ window: window2, client, preflight, pickDate, onChange = () => {
  }, onEvidence = () => {
  } }) {
    const key = "tm-v4.sideline.rows", uuid = () => window2.crypto.randomUUID();
    let journal = createOperationJournal({ storage: window2.localStorage, key, uuid }), running = false, busy = false, owns = false, clearAfterSettled = false, paused = false, disposed = false, active2 = null, attentionRow = null, readController, wake, scanResolve, attention = "", message = "", stopStage = 0, dates = /* @__PURE__ */ new Map(), sourceMeta = null;
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
    function terminal(row, phase, reason) {
      journal.transition(row, phase, reason);
      onEvidence({ type: "sideline.result", intent: "mutation", phase, operationId: row.requestId, data: { kind: row.kind, state: phase } });
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
      active2 = row;
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
        active2 = row;
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
              if (active2?.state === "SUBMITTED") {
                terminal(active2, "UNKNOWN", error.message);
                running = false;
                message = "UNKNOWN close — verify destination; item NOT retried";
                notify();
                return;
              }
              if (active2?.state === "READING") journal.transition(active2, "REJECTED", error.message);
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
          active2 = row;
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
          owns = true;
          try {
            if (stopStage > 0 || disposed) return;
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
              active2 = row;
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
                  const dateKey = sidelineDateKey(row.source, row.container, result.ctx);
                  let date = result.kind === "yellow" ? dates.get(dateKey) ?? null : null;
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
                    dates.set(dateKey, date);
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
                const target = active2 || row;
                if (target.state === "SUBMITTED") {
                  terminal(target, error.outcome === "REJECTED" ? "REJECTED" : "UNKNOWN", error.message);
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
                  if (active2?.state === "SUBMITTED") terminal(active2, "UNKNOWN", error.message);
                  else if (active2?.state === "READING") journal.transition(active2, "REJECTED", error.message);
                  message = error.message;
                }
              } else message = "Source retained: some items were not confirmed";
            }
          } finally {
            try {
              if (clearAfterSettled) {
                journal.clear();
                clearAfterSettled = false;
              }
            } finally {
              owns = false;
            }
          }
        });
      } catch (error) {
        message = error.message;
      } finally {
        if (active2?.state === "READING") try {
          journal.transition(active2, "QUEUED", "Stopped before submission");
        } catch {
        }
        running = false;
        busy = false;
        paused = false;
        attention = "";
        active2 = null;
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
      if (paused && active2?.state !== "SUBMITTED") readController?.abort();
      if (!paused) wake?.();
      notify();
    }
    function stop() {
      stopStage++;
      if (running) {
        running = false;
        paused = false;
        attention = "";
        if (active2?.state !== "SUBMITTED") readController?.abort();
        wake?.();
        scanResolve?.(null);
        message = "Stopped — submitted request settles; recovery rows retained";
        notify();
        return;
      }
      if (stopStage >= 2) {
        if (owns) {
          if (active2?.state === "READING") clearAfterSettled = true;
          else try {
            journal.clear();
          } catch (error) {
            message = error.message;
            notify();
            return;
          }
          dates.clear();
          message = "Reset safe rows; submitted/UNKNOWN retained";
          notify();
          return;
        }
        if (busy) {
          message = "Stopped before ownership; recovery retained";
          notify();
          return;
        }
        return reset();
      }
    }
    async function reset() {
      if (busy) {
        stop();
        return false;
      }
      try {
        await withOperationLock(window2, "tm-v4.sideline.owner", () => {
          journal = createOperationJournal({ storage: window2.localStorage, key, uuid });
          journal.clear();
          dates.clear();
          stopStage = 0;
          message = "Reset — UNKNOWN retained";
        });
        notify();
        return true;
      } catch (error) {
        message = error.message;
        notify();
        return false;
      }
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      running = false;
      paused = false;
      try {
        if (active2?.state === "SUBMITTED") terminal(active2, "UNKNOWN", "Page disposed after submission");
        else if (active2?.state === "READING") journal.transition(active2, "QUEUED", "Page disposed before submission");
      } catch {
      }
      readController?.abort();
      wake?.();
      scanResolve?.(null);
    }
    return { run, scan, pause, stop, reset, dispose, getRows: () => journal.rows, getState: () => ({ running, busy, paused, attention, message, stopStage }), hasDate: (source, code, ctx) => dates.has(sidelineDateKey(source, code, ctx)), setDate: (source, code, ctx, value) => {
      if (!Number.isFinite(value)) throw new Error("Invalid date answer");
      dates.set(sidelineDateKey(source, code, ctx), value);
    } };
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
  function paoExpiration(now = /* @__PURE__ */ new Date()) {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 900);
    return date.getTime();
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
      style.textContent = `#tm-v4-date-picker{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:#0008;font:14px Arial;color:#172033}#tm-v4-date-picker .wrap{max-width:1100px;width:96vw;padding:12px;background:#f8fafc;border:2px solid #334155;border-radius:8px}#tm-v4-date-picker .preview{display:flex;gap:12px;align-items:center;padding:8px;background:white;margin-bottom:10px}#tm-v4-date-picker img{width:90px;max-height:105px;object-fit:contain}#tm-v4-date-picker .panels{display:grid;grid-template-columns:1fr 2fr 1.5fr;gap:10px}#tm-v4-date-picker section{border:1px solid #94a3b8;border-radius:5px;overflow:hidden}#tm-v4-date-picker h3{margin:0;background:#e2e8f0;padding:8px;display:flex;justify-content:space-between}#tm-v4-date-picker .grid{display:grid;gap:5px;padding:7px;grid-template-columns:repeat(4,1fr)}#tm-v4-date-picker .days{grid-template-columns:repeat(7,1fr)}#tm-v4-date-picker button{padding:9px;border:1px solid #94a3b8;border-radius:4px;background:white;font-weight:800;cursor:pointer}#tm-v4-date-picker button.selected{background:#146eb4;color:white}#tm-v4-date-picker button:disabled{opacity:.35;cursor:default}#tm-v4-date-picker footer{display:flex;gap:10px;margin-top:10px}#tm-v4-date-picker [data-error]{color:#b91c1c;font-weight:bold}`;
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
          finish(paoExpiration(today));
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

  // sideline-runtime.mjs
  function createSidelineUi({ window: window2, client, preflight, version, native, onEvidence = () => {
  } }) {
    const d = window2.document, controller = new window2.AbortController(), picker = createDatePicker(window2), pool = createReadPool(5);
    let dateQueued = /* @__PURE__ */ new Set(), wasBusy = false;
    let disposed = false, lookupController = new window2.AbortController(), lookupCache = /* @__PURE__ */ new Map(), lookupSource = "", scanBuffer = "", scanTimer, collapsed = false, dateChain = Promise.resolve(), preflightDateController = new window2.AbortController(), workflow, activeDateCode = "", dateEpoch = 0;
    let prefs = { queue: false, lazy: true, qty: false, delay: true, clearSource: false }, draft = { source: "", destination: "", items: "", containers: "" };
    try {
      prefs = { ...prefs, ...JSON.parse(window2.localStorage.getItem("tm-v4.sideline.settings") || "{}") };
      draft = { ...draft, ...JSON.parse(window2.localStorage.getItem("tm-v4.sideline.draft") || "{}") };
    } catch {
    }
    const own = (tag, id) => {
      const node = d.createElement(tag);
      node.id = id;
      node.dataset.tmV4Script = "SIDE";
      return node;
    };
    const style = own("style", "tm-v4-side-style");
    style.textContent = `#tm-v4-side-dock{position:fixed;right:14px;bottom:12px;width:510px;max-width:calc(100vw - 28px);box-sizing:border-box;display:grid;grid-template-columns:repeat(3,1fr);gap:5px;padding:6px;background:#f2f4f6;border:1px solid #aab7c6;border-radius:0 0 4px 4px;z-index:2147483646;font:11px Arial}#tm-v4-side-dock button,.tm-v4-side-panel button{border:1px solid #9faec0;border-radius:3px;padding:7px 6px;background:#f5f7fa;color:#122b49;font-weight:800;cursor:pointer}#tm-v4-side-dock button.on,.tm-v4-side-panel button.on{background:#315f7f;color:white;border-color:#315f7f}.tm-v4-side-panel{position:fixed;right:14px;bottom:58px;width:510px;max-width:calc(100vw - 28px);padding:12px;box-sizing:border-box;background:#fff;border:1px solid #aab7c6;border-radius:4px 4px 0 0;box-shadow:0 3px 9px #0002;z-index:2147483645;font:11px Arial;color:#122b49}.tm-v4-side-panel header{margin:-12px -12px 11px;padding:9px 11px;background:#f1f3f5;border-left:3px solid #7894ad;border-bottom:1px solid #c4ced8;font-weight:900}.tm-v4-side-panel input,.tm-v4-side-panel textarea{width:100%;box-sizing:border-box;padding:9px;border:1px solid #aab7c6;border-radius:3px;color:#1b2e43;background:white;font:12px Arial}.tm-v4-side-panel input:focus,.tm-v4-side-panel textarea:focus{outline:2px solid #315f7f29;border-color:#315f7f}.tm-v4-side-panel textarea{height:96px;resize:vertical}.tm-v4-side-panel .fields,.tm-v4-side-panel .settings,.tm-v4-side-panel .metrics{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:7px 0}.tm-v4-side-panel label{font-weight:900;display:block}.tm-v4-side-panel .actions{display:flex;gap:5px;margin-top:6px}.tm-v4-side-panel .actions button{flex:1}.tm-v4-side-panel .stop{background:#fff7ed;color:#9a3412}.tm-v4-side-panel [data-status]{margin-top:7px;padding:7px 9px;border:1px solid #9eb8cd;background:#eef8ff;color:#153d5f;white-space:pre-wrap}.tm-v4-side-panel [data-preflight]{margin:7px 0;padding:8px 9px;border:2px solid #94a3b8;border-left-width:7px;border-radius:3px;background:#f8fafc;font-weight:800}.tm-v4-side-panel [data-preflight].green{border-color:#18794e;background:#ecfdf5;color:#14532d}.tm-v4-side-panel [data-preflight].yellow{border-color:#b7791f;background:#fffbeb;color:#78350f}.tm-v4-side-panel [data-preflight].red{border:4px solid #7a0000;border-left-width:12px;background:#b00020;color:white;font-size:15px;padding:12px}.tm-v4-side-panel [data-attention]{padding:10px;border:3px solid #f59e0b;background:#fff7ed;color:#7c2d12;font-weight:900}.tm-v4-side-panel .metric{border:1px solid #b8c5d2;background:#f5f7f9;padding:7px;text-align:center;font-weight:800}.tm-v4-side-panel .metric b{display:block;font-size:20px}.tm-v4-side-panel [data-rows]{max-height:150px;overflow:auto;white-space:pre-wrap;font:11px Consolas,monospace}.tm-v4-side-panel [data-rows] .UNKNOWN{background:#fff1f2;color:#991b1b;font-weight:bold}.tm-v4-side-panel [data-rows] .CONFIRMED{color:#166534}.tm-v4-side-panel [data-rows] .REJECTED{color:#991b1b}#tm-v4-side-qty{left:14px;right:auto;width:300px}#tm-v4-side-qty .grid{display:grid;grid-template-columns:repeat(5,1fr);gap:5px}#tm-v4-side-qty .grid button{min-height:38px;font-size:14px}#tm-v4-side-aside{position:fixed;left:14px;top:72px;max-width:340px;max-height:50vh;overflow:auto;z-index:2147483644;background:#fff1f2;border:2px solid #b00020;color:#7f1d1d;padding:10px;font:12px Arial}#tm-v4-side-aside div{padding:6px;border-bottom:1px solid #fecaca}.tm-v4-side-panel button:disabled{opacity:.5;cursor:wait}`;
    d.head.append(style);
    const dock = own("div", "tm-v4-side-dock"), lazy = own("section", "tm-v4-side-lazy"), queue = own("section", "tm-v4-side-queue"), qty = own("section", "tm-v4-side-qty"), aside = own("section", "tm-v4-side-aside");
    for (const node of [lazy, queue, qty]) node.className = "tm-v4-side-panel";
    dock.innerHTML = ["queue", "lazy", "qty"].map((key) => `<button data-panel="${key}">${key.toUpperCase()}</button>`).join("");
    lazy.innerHTML = `<header><strong>SIDELINE</strong> • LAZY v${escapeHtml(version)}</header><button data-action="return">↩ RETURN TO SOURCE</button><div class="fields"><label>SOURCE<input data-field="source" placeholder="csX / tsX" autocomplete="off"></label><label>DESTINATION<input data-field="destination" placeholder="csX / tsX" autocomplete="off"></label></div><textarea data-field="items" placeholder="Scan or paste one per line"></textarea><button data-action="collapse">Collapse / Expand items</button><div data-preflight>PREFLIGHT READY</div><div class="settings"><button data-action="clear-source"></button><button data-action="delay"></button></div><div class="actions"><button class="on" data-action="run">RUN LAZY</button><button data-action="pause">Pause</button><button class="stop" data-action="stop">Stop</button><button data-action="reset">Reset</button></div><div class="metrics"></div><div data-attention hidden></div><div data-status>Ready</div><button data-action="copy">Copy failed barcodes</button><div data-rows></div>`;
    queue.innerHTML = '<header>Tote Queue</header><textarea data-field="containers" placeholder="Paste tsX/csX list"></textarea><div class="actions"><button data-action="run">Start</button><button data-action="pause">Pause</button><button data-action="stop">Stop</button></div><div data-status>Ready</div><div data-rows></div>';
    qty.innerHTML = '<header>Qty quick select</header><div class="grid">' + Array.from({ length: 10 }, (_, i) => `<button data-qty="${i + 1}">${i + 1}</button>`).join("") + "</div><button data-clear>double click = clear</button><div data-status>Ready</div>";
    d.body.append(dock, lazy, queue, qty, aside);
    aside.hidden = true;
    const fields = {};
    for (const input of [...lazy.querySelectorAll("[data-field]"), ...queue.querySelectorAll("[data-field]")]) {
      fields[input.dataset.field] = input;
      input.value = String(draft[input.dataset.field] || "");
    }
    function persist() {
      try {
        window2.localStorage.setItem("tm-v4.sideline.settings", JSON.stringify(prefs));
        window2.localStorage.setItem("tm-v4.sideline.draft", JSON.stringify(Object.fromEntries(Object.entries(fields).map(([k, e]) => [k, e.value]))));
      } catch (error) {
        lazy.querySelector("[data-status]").textContent = "Draft storage failed: " + error.message;
      }
    }
    function layout() {
      lazy.hidden = !prefs.lazy;
      queue.hidden = !prefs.queue;
      qty.hidden = !prefs.qty;
      let bottom = 58;
      for (const p of [lazy, queue]) if (!p.hidden) {
        p.style.bottom = bottom + "px";
        bottom += p.offsetHeight + 10;
      }
      for (const b of dock.querySelectorAll("button")) b.classList.toggle("on", !!prefs[b.dataset.panel]);
      lazy.querySelector("[data-action=clear-source]").textContent = "CLEAR SOURCE: " + (prefs.clearSource ? "ON" : "OFF");
      lazy.querySelector("[data-action=delay]").textContent = "DELAY 2–8s: " + (prefs.delay ? "ON" : "OFF");
      fields.items.hidden = collapsed;
    }
    function status(text) {
      if (!disposed) lazy.querySelector("[data-status]").textContent = text;
    }
    function change(state) {
      if (disposed) return;
      if (!wasBusy && state.busy) native?.cancelExpiry?.();
      if (wasBusy && !state.busy) {
        dateQueued.clear();
        lookupController.abort();
        lookupController = new window2.AbortController();
        lookupCache = /* @__PURE__ */ new Map();
        const moved2 = state.rows.filter((r) => r.mode === "lazy");
        if (moved2.length && moved2.every((r) => r.state === "CONFIRMED") && !state.rows.some((r) => ["SUBMITTED", "UNKNOWN"].includes(r.state))) {
          fields.source.value = "";
          fields.destination.value = "";
          fields.items.value = "";
          collapsed = false;
          aside.hidden = true;
          persist();
          fields.source.focus();
        }
      }
      wasBusy = state.busy;
      layout();
      for (const p of [lazy, queue]) {
        p.querySelector("[data-status]").textContent = state.message || (state.running ? state.paused ? "PAUSED" : "RUNNING" : "Ready");
        const rows2 = state.rows.filter((r) => p === queue ? r.mode === "queue" : r.mode !== "queue");
        p.querySelector("[data-rows]").innerHTML = rows2.map((r) => `<div class="${r.state}">${escapeHtml(r.container)} ×${r.quantity || 0} • ${r.state} • ${escapeHtml(r.message)}</div>`).join("");
        p.querySelector("[data-action=pause]").textContent = state.paused ? "Resume" : "Pause";
        p.querySelector("[data-action=run]").disabled = state.busy;
      }
      const rows = state.rows.filter((r) => r.mode === "lazy"), total = rows.reduce((s, r) => s + r.quantity, 0), moved = rows.filter((r) => r.state === "CONFIRMED").reduce((s, r) => s + r.quantity, 0);
      lazy.querySelector(".metrics").innerHTML = [["Total units", total], ["Unique items", rows.length], ["Moved", moved], ["Remaining", total - moved]].map(([label, value]) => `<div class="metric">${label}<b>${value}</b></div>`).join("");
      const att = lazy.querySelector("[data-attention]");
      att.hidden = !state.attention;
      att.textContent = state.attention === "predicant" ? "RESCAN DESTINATION — known rejected move; destination must be confirmed cleared" : state.attention === "damaged" ? "DAMAGED DESTINATION — scan a different destination" : state.attention;
    }
    try {
      workflow = createSidelineWorkflow({ window: window2, client, preflight: lookup, pickDate: picker.pick, onChange: change, onEvidence });
    } catch (error) {
      status("Recovery BLOCKED: " + error.message);
    }
    function lookup(source, code, { signal } = {}) {
      if (upper(source) !== lookupSource) {
        lookupController.abort();
        lookupController = new window2.AbortController();
        lookupSource = upper(source);
        lookupCache = /* @__PURE__ */ new Map();
      }
      const key = upper(code);
      if (!lookupCache.has(key)) {
        const ownSignal = lookupController.signal;
        const promise = pool(() => preflight(source, code, { signal: ownSignal }), ownSignal);
        const ownCache = lookupCache;
        promise.then((result) => {
          if (result.kind === "retry" && ownCache.get(key) === promise) ownCache.delete(key);
        }, () => {
          if (ownCache.get(key) === promise) ownCache.delete(key);
        });
        lookupCache.set(key, promise);
      }
      const pending = lookupCache.get(key);
      if (!signal) return pending;
      if (signal.aborted) return Promise.reject(new Error("Preflight cancelled"));
      return new Promise((resolve, reject) => {
        const cancel = () => reject(new Error("Preflight cancelled"));
        signal.addEventListener("abort", cancel, { once: true });
        pending.then((result) => {
          signal.removeEventListener("abort", cancel);
          if (signal.aborted) cancel();
          else resolve(result);
        }, (error) => {
          signal.removeEventListener("abort", cancel);
          reject(error);
        });
      });
    }
    function cancelPreflightDate() {
      dateEpoch++;
      preflightDateController.abort();
      preflightDateController = new window2.AbortController();
      picker.dispose();
      dateQueued.clear();
      activeDateCode = "";
    }
    async function checkItems() {
      persist();
      if (!workflow || workflow.getState().busy || !validSidelineContainer(fields.source.value)) return;
      const src = clean(fields.source.value), items = parseSidelineItems(fields.items.value, src, fields.destination.value), epoch = dateEpoch, dateSignal = preflightDateController.signal;
      const results = await Promise.all(items.map(async (item) => {
        try {
          return { ...item, result: await lookup(src, item.code) };
        } catch (error) {
          return { ...item, result: { kind: "retry", reason: error.message } };
        }
      }));
      if (disposed || epoch !== dateEpoch || upper(fields.source.value) !== upper(src) || workflow.getState().busy) return;
      const bad = results.filter((r) => r.result.kind === "red");
      aside.hidden = !bad.length;
      aside.innerHTML = "<b>ASIDE / NOT PROCESSING</b>" + bad.map((r) => `<div><b>${escapeHtml(r.code)}</b> ×${r.quantity}<br>${escapeHtml(r.result.reason)}</div>`).join("");
      const last = results.at(-1), box = lazy.querySelector("[data-preflight]");
      box.className = last?.result.kind || "";
      box.textContent = last ? `${last.result.kind === "red" ? "✕ PUT ASIDE" : last.result.kind === "yellow" ? "⚠ EXPIRY" : last.result.kind === "green" ? "✓ GOOD" : "UNKNOWN — RETRY"} • ${last.code} • ${last.result.reason}` : "PREFLIGHT READY";
      for (const r of results.filter((r2) => r2.result.kind === "yellow" && !dateQueued.has(sidelineDateKey(src, r2.code, r2.result.ctx)) && !workflow.hasDate(src, r2.code, r2.result.ctx))) {
        const dateKey = sidelineDateKey(src, r.code, r.result.ctx);
        dateQueued.add(dateKey);
        dateChain = dateChain.then(async () => {
          if (disposed || epoch !== dateEpoch || workflow.getState().busy || upper(fields.source.value) !== upper(src) || !parseSidelineItems(fields.items.value, src, fields.destination.value).some((i) => upper(i.code) === upper(r.code))) return;
          activeDateCode = upper(r.code);
          const date = await picker.pick({ code: r.code, ctx: r.result.ctx, signal: dateSignal });
          if (activeDateCode === upper(r.code)) activeDateCode = "";
          if (date !== null && !disposed && epoch === dateEpoch && !workflow.getState().busy && upper(fields.source.value) === upper(src) && parseSidelineItems(fields.items.value, src, fields.destination.value).some((item) => upper(item.code) === upper(r.code))) {
            workflow.setDate(src, r.code, r.result.ctx, date);
          }
          dateQueued.delete(dateKey);
        }).catch((error) => status(error.message)).finally(() => dateQueued.delete(dateKey));
      }
      dateChain.catch((error) => status(error.message));
    }
    function run(mode) {
      if (!workflow) return;
      preflightDateController.abort();
      preflightDateController = new window2.AbortController();
      picker.dispose();
      persist();
      if (mode === "lazy") {
        collapsed = true;
        layout();
        return workflow.run("lazy", { source: clean(fields.source.value), destination: clean(fields.destination.value), items: parseSidelineItems(fields.items.value, fields.source.value, fields.destination.value), delay: prefs.delay, clearSource: prefs.clearSource });
      }
      return workflow.run("queue", { containers: fields.containers.value.match(/\b(?:tsX|csX)[A-Za-z0-9_-]+\b/gi) || [] });
    }
    function consumeScan(code) {
      const value = clean(code);
      if (workflow?.scan(value)) return true;
      if (upper(value) === "123START") {
        run("lazy");
        return true;
      }
      if (upper(value) === upper(fields.source.value)) {
        if (workflow?.getState().busy) {
          workflow.stop();
          native?.stop?.();
        } else {
          fields.destination.focus();
          fields.destination.select();
        }
        return true;
      }
      if (upper(value) === upper(fields.destination.value)) {
        if (!workflow?.getState().busy) {
          fields.items.focus();
        }
        return true;
      }
      if (validSidelineContainer(value)) {
        status("Container scan is a control — not an item");
        return true;
      }
      return false;
    }
    for (const [name, input] of Object.entries(fields)) {
      input.addEventListener("input", () => {
        if (name === "source") {
          cancelPreflightDate();
          lookupController.abort();
          lookupController = new window2.AbortController();
          lookupCache = /* @__PURE__ */ new Map();
          lookupSource = upper(input.value);
        } else if (name === "items" && activeDateCode && !parseSidelineItems(input.value, fields.source.value, fields.destination.value).some((item) => upper(item.code) === activeDateCode)) cancelPreflightDate();
        persist();
      }, { signal: controller.signal });
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== "Tab") return;
        event.stopPropagation();
        if (name === "source" || name === "destination") {
          event.preventDefault();
          if (!validSidelineContainer(input.value)) {
            status("Source/destination must start csX or tsX");
            return;
          }
          (name === "source" ? fields.destination : fields.items).focus();
          return;
        }
        if (name === "items" && event.key === "Enter") {
          const lines = input.value.split(/\r?\n/), last = lines.at(-1);
          if (consumeScan(last)) {
            event.preventDefault();
            lines.pop();
            input.value = lines.join("\n");
            persist();
          } else checkItems();
        }
      }, { signal: controller.signal });
      input.addEventListener("paste", () => window2.queueMicrotask(() => {
        if (!disposed) checkItems();
      }), { signal: controller.signal });
    }
    dock.addEventListener("click", (event) => {
      const key = event.target.dataset.panel;
      if (key) {
        prefs[key] = !prefs[key];
        persist();
        layout();
      }
    }, { signal: controller.signal });
    for (const [mode, panel] of [["lazy", lazy], ["queue", queue]]) panel.addEventListener("click", async (event) => {
      const action = event.target.closest("button")?.dataset.action;
      if (!action) return;
      if (action === "run") run(mode);
      else if (action === "pause") workflow?.pause();
      else if (action === "stop") {
        const secondStop = (workflow?.getState().stopStage || 0) >= 1, stopped = await workflow?.stop();
        native?.stop?.();
        picker.dispose();
        preflightDateController.abort();
        preflightDateController = new window2.AbortController();
        lookupController.abort();
        lookupController = new window2.AbortController();
        lookupCache = /* @__PURE__ */ new Map();
        if (secondStop && stopped !== false && !workflow?.getState().busy) {
          fields.source.value = "";
          fields.destination.value = "";
          fields.items.value = "";
          lookupController.abort();
          lookupCache = /* @__PURE__ */ new Map();
          persist();
        }
      } else if (action === "reset") {
        const cleared = await workflow?.reset();
        native?.stop?.();
        picker.dispose();
        if (cleared && !workflow?.getState().busy) {
          for (const input of Object.values(fields)) input.value = "";
          lookupController.abort();
          lookupCache = /* @__PURE__ */ new Map();
          persist();
        }
      } else if (action === "delay" || action === "clear-source") {
        prefs[action === "delay" ? "delay" : "clearSource"] = !prefs[action === "delay" ? "delay" : "clearSource"];
        persist();
        layout();
      } else if (action === "collapse") {
        collapsed = !collapsed;
        layout();
        if (!collapsed) fields.items.focus();
      } else if (action === "copy") {
        const text = workflow?.getRows().filter((r) => r.mode === "lazy" && ["REJECTED", "UNKNOWN"].includes(r.state)).map((r) => r.container + "	" + r.quantity + "	" + r.message).join("\n");
        Promise.resolve(window2.navigator.clipboard?.writeText(text || "")).catch((error) => status(error.message));
      } else if (action === "return") {
        workflow?.stop();
        picker.dispose();
        try {
          Promise.resolve(native?.returnSource?.()).catch((error) => status(error.message));
        } catch (error) {
          status(error.message);
        }
      }
    }, { signal: controller.signal });
    d.addEventListener("keydown", (event) => {
      if (!prefs.lazy || !collapsed && !workflow?.getState().attention || event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.target.closest?.("input,textarea,[contenteditable=true]") && event.target !== fields.items) return;
      if (event.key.length === 1) {
        event.preventDefault();
        event.stopImmediatePropagation();
        scanBuffer += event.key;
        window2.clearTimeout(scanTimer);
        scanTimer = window2.setTimeout(() => scanBuffer = "", 1200);
      } else if (event.key === "Enter" && scanBuffer) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const value = scanBuffer;
        scanBuffer = "";
        window2.clearTimeout(scanTimer);
        if (!consumeScan(value) && !workflow?.getState().busy) {
          fields.items.value += (fields.items.value ? "\n" : "") + value;
          checkItems();
        }
      }
    }, { capture: true, signal: controller.signal });
    qty.addEventListener("click", (event) => {
      const number = Number(event.target.dataset.qty);
      if (number && native) {
        native.quantity(number).then((message) => qty.querySelector("[data-status]").textContent = message).catch((error) => qty.querySelector("[data-status]").textContent = error.message);
      }
    }, { signal: controller.signal });
    qty.querySelector("[data-clear]").addEventListener("dblclick", () => {
      native?.clear().then((message) => qty.querySelector("[data-status]").textContent = message).catch((error) => qty.querySelector("[data-status]").textContent = error.message);
    }, { signal: controller.signal });
    const resize = typeof window2.ResizeObserver === "function" ? new window2.ResizeObserver(layout) : null;
    resize?.observe(lazy);
    resize?.observe(queue);
    layout();
    if (workflow) change({ ...workflow.getState(), rows: workflow.getRows() });
    return { workflow, fields, run, consumeScan, dispose() {
      if (disposed) return;
      disposed = true;
      workflow?.dispose();
      native?.dispose();
      picker.dispose();
      preflightDateController.abort();
      lookupController.abort();
      controller.abort();
      resize?.disconnect();
      window2.clearTimeout(scanTimer);
      for (const node of [style, dock, lazy, queue, qty, aside]) node.remove();
    } };
  }

  // native-hook.mjs
  var FORWARD = Symbol.for("tampermonkey.v4.native.forward");
  function forwardHook(wrapper, original) {
    Object.defineProperty(wrapper, FORWARD, { value: original });
    return wrapper;
  }
  function containsHook(current, expected) {
    const seen = /* @__PURE__ */ new Set();
    while (typeof current === "function" && !seen.has(current)) {
      if (current === expected) return true;
      seen.add(current);
      current = current[FORWARD];
    }
    return false;
  }

  // native-operation-tap.mjs
  function createNativeOperationTap({ window: window2, page: page2 = window2, paths, onBefore, onResult }) {
    const details = /* @__PURE__ */ new WeakMap();
    let disposed = false;
    const selected = new Set(paths), timers = /* @__PURE__ */ new Set();
    function begin(url, body, method) {
      if (disposed || String(method).toUpperCase() !== "POST") return null;
      let target;
      try {
        target = new window2.URL(url, window2.location.href);
      } catch {
        return null;
      }
      if (target.origin !== window2.location.origin || !selected.has(target.pathname)) return null;
      let payload;
      try {
        payload = typeof body === "string" ? JSON.parse(body) : null;
      } catch {
        payload = null;
      }
      const context = onBefore({ path: target.pathname, payload });
      if (!context) return null;
      let done = false;
      const timer = window2.setTimeout(() => finish(0, "", target.href, true), 25e3);
      timers.add(timer);
      const finish = (status, raw, finalUrl, timeout = false) => {
        if (done || disposed) return;
        done = true;
        timers.delete(timer);
        window2.clearTimeout(timer);
        let data;
        try {
          data = JSON.parse(raw);
        } catch {
          data = null;
        }
        let exact = false;
        try {
          exact = !timeout && new window2.URL(finalUrl || target.href).href === target.href;
        } catch {
        }
        onResult({ path: target.pathname, payload, context, status, data, exact, timeout });
      };
      return { finish };
    }
    const originalFetch = page2.fetch;
    const wrapper = function(input, init = {}) {
      const url = typeof input === "string" || input instanceof window2.URL ? String(input) : input?.url;
      const record = begin(url, init.body, init.method || input?.method || "GET");
      const promise = originalFetch.apply(this, arguments);
      if (record) void promise.then(async (response) => {
        try {
          record.finish(response.status, await response.clone().text(), response.url || url, response.redirected);
        } catch {
          record.finish(0, "", url);
        }
      }, () => record.finish(0, "", url));
      return promise;
    };
    page2.fetch = wrapper;
    const proto = page2.XMLHttpRequest?.prototype, open = proto?.open, send = proto?.send;
    function wrappedOpen(method, url) {
      details.set(this, { method, url });
      return open.apply(this, arguments);
    }
    function wrappedSend(body) {
      const metadata = details.get(this), record = metadata ? begin(metadata.url, body, metadata.method) : null;
      if (record) this.addEventListener("loadend", () => {
        let raw;
        try {
          raw = this.responseType === "json" ? JSON.stringify(this.response) : this.responseText;
        } catch {
          raw = "";
        }
        record.finish(this.status, raw, this.responseURL || metadata.url);
      }, { once: true });
      return send.apply(this, arguments);
    }
    forwardHook(wrapper, originalFetch);
    forwardHook(wrappedOpen, open);
    forwardHook(wrappedSend, send);
    if (proto) {
      proto.open = wrappedOpen;
      proto.send = wrappedSend;
    }
    return { owns: () => !disposed && containsHook(page2.fetch, wrapper) && (!proto || containsHook(proto.open, wrappedOpen) && containsHook(proto.send, wrappedSend)), dispose() {
      if (disposed) return;
      disposed = true;
      for (const timer of timers) window2.clearTimeout(timer);
      timers.clear();
      if (page2.fetch === wrapper) page2.fetch = originalFetch;
      if (proto?.open === wrappedOpen) proto.open = open;
      if (proto?.send === wrappedSend) proto.send = send;
    } };
  }

  // sideline-native.mjs
  function setNativeField(window2, input, value) {
    const old = input.value, proto = input.tagName === "TEXTAREA" ? window2.HTMLTextAreaElement.prototype : window2.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(input, String(value));
    input._valueTracker?.setValue?.(old);
    input.dispatchEvent(new window2.Event("input", { bubbles: true }));
    input.dispatchEvent(new window2.Event("change", { bubbles: true }));
  }
  function createSidelineNative({ window: window2, page: page2 = window2, client, identity, canAssist = () => true, onEvidence = () => {
  } }) {
    const d = window2.document, picker = createDatePicker(window2), key = "tm-v4.sideline.rows";
    const waits = /* @__PURE__ */ new Set();
    const status = d.createElement("div");
    status.dataset.tmV4Script = "SIDE";
    status.id = "tm-v4-side-native-status";
    status.setAttribute("role", "status");
    status.style.cssText = "position:fixed;left:14px;bottom:14px;z-index:2147483645;max-width:450px;padding:7px;background:#eef8ff;color:#153d5f;border:1px solid #9eb8cd;font:12px Arial;white-space:pre-wrap";
    status.hidden = true;
    d.body.append(status);
    const say = (message) => {
      if (!disposed) {
        status.hidden = !message;
        status.textContent = message;
      }
    };
    let disposed = false, owner = null, expiryActive = false, expirySeen = null, expiryController = null;
    const native = (node) => node && !node.closest?.("[data-tm-v4-script]") && !node.hidden && !node.disabled && window2.getComputedStyle(node).display !== "none" && window2.getComputedStyle(node).visibility !== "hidden";
    const text = () => [...d.body.children].filter(native).map((n) => n.textContent || "").join(" ").toLowerCase();
    const roots = () => {
      const result = [d];
      for (let i = 0; i < result.length && i < 200; i++) for (const node of result[i].querySelectorAll("*")) if (node.shadowRoot && !node.closest("[data-tm-v4-script]")) result.push(node.shadowRoot);
      return result;
    };
    const all = (selector) => roots().flatMap((root) => [...root.querySelectorAll(selector)]);
    const buttons = () => all("button,[role=button],input[type=submit],alchemy-button,mdw-button").filter(native);
    const button = (re) => buttons().find((b) => re.test(clean(b.textContent || b.value)));
    const click = (node) => {
      const target = node?.shadowRoot?.querySelector("button,[role=button],input[type=submit]") || node;
      for (const type of ["mouseover", "mousedown", "mouseup"]) target.dispatchEvent(new window2.MouseEvent(type, { bubbles: true, composed: true }));
      target.click();
    };
    const confirm = () => native(d.querySelector("#confirm-button")) ? d.querySelector("#confirm-button") : button(/^(confirm|item match|continue|submit|enter)\b/i);
    function fields() {
      const inputs = all("input,textarea").filter(native);
      return inputs.filter((input) => /^(text|search|tel|number|)$/.test(input.type || ""));
    }
    function dateFields() {
      const list = fields(), find = (re) => {
        const found = list.filter((input) => re.test([input.id, input.name, input.placeholder, input.getAttribute("aria-label")].join(" ").toLowerCase()));
        return found.length === 1 ? found[0] : null;
      };
      const month = find(/\b(mm|month)\b/), day = find(/\b(dd|day)\b/), year = find(/\b(yyyy|year)\b/);
      return month && day && year ? { month, day, year } : null;
    }
    function journal() {
      return createOperationJournal({ storage: window2.localStorage, key, uuid: () => window2.crypto.randomUUID() });
    }
    function finish(result) {
      if (!owner || owner.done) return;
      owner.done = true;
      if (owner.row) {
        try {
          owner.journal.transition(owner.row, result.outcome, result.reason || "Typed native outcome");
        } catch {
          result = { outcome: "UNKNOWN", reason: "Recovery result could not be saved" };
        }
      }
      say(result.outcome + " • " + (result.reason || "Typed native response"));
      owner.resolve(result);
      onEvidence(owner.submittedRequest ? { type: "sideline.native-result", intent: "mutation", phase: result.outcome, operationId: owner.submittedRequest, data: { state: result.outcome } } : { type: "sideline.native-form", intent: "workflow", data: { kind: owner.kind, state: result.outcome } });
    }
    const tap = createNativeOperationTap({ window: window2, page: page2, paths: ["/api/move-items", "/api/close-container"], onBefore: ({ path, payload }) => {
      if (!owner) return null;
      if (owner.done) throw new Error("Native helper operation already settled");
      identity();
      if (!payload || typeof payload.requestId !== "string") throw new Error("Native mutation request identity missing");
      const kind = path === "/api/move-items" ? "move" : "close";
      if (owner.kind !== kind && owner.kind !== "date") throw new Error("Unexpected native mutation blocked");
      if (kind === "move" && (!validSidelineContainer(payload.sourceContainerScannableId) || !validSidelineContainer(payload.destinationContainerScannableId) || upper(payload.sourceContainerScannableId) === upper(payload.destinationContainerScannableId) || !clean(payload.scannableId) || !Number.isInteger(Number(payload.quantity)) || Number(payload.quantity) < 1 || owner.quantity && Number(payload.quantity) !== owner.quantity)) throw new Error("Native move container/quantity context invalid");
      if (kind === "close" && !validSidelineContainer(payload.containerScannableId)) throw new Error("Native close container missing");
      if (owner.submittedRequest) throw new Error("Duplicate native mutation blocked");
      if (owner.journal.rows.some((r) => r !== owner.row && r.requestId === payload.requestId)) throw new Error("Native request ID already used — replay blocked");
      owner.submittedRequest = payload.requestId;
      owner.journal.transition(owner.row, "SUBMITTED", "Native request submitted", { container: clean(kind === "move" ? payload.scannableId : payload.containerScannableId), kind: kind === "move" ? "native-qty" : "native-close", source: payload.sourceContainerScannableId || payload.containerScannableId, destination: payload.destinationContainerScannableId || "", quantity: Number(payload.quantity) || 0, requestId: payload.requestId });
      onEvidence({ type: "sideline.native-submit", intent: "mutation", phase: "SUBMITTED", operationId: payload.requestId, data: { kind } });
      return { owner, kind };
    }, onResult: (record) => {
      if (record.context.owner !== owner || disposed) return;
      let result = { outcome: "UNKNOWN", reason: "Native response/session/timeout unknown" };
      if (record.exact && record.data && (record.status >= 200 && record.status < 300 || [400, 409, 422].includes(record.status))) result = classifySidelineMutation(record.data, record.context.kind);
      finish(result);
    } });
    async function perform(kind, quantity, action, { timeout = 3e5 } = {}) {
      if (disposed || owner) throw new Error("Native helper busy");
      return withOperationLock(window2, "tm-v4.sideline.owner", async () => {
        const ledger = journal();
        if (ledger.rows.some((r) => ["SUBMITTED", "UNKNOWN", "QUEUED", "READING"].includes(r.state))) throw new Error("Recovery rows require native verification or explicit Reset of unsubmitted work");
        await client.bootstrap();
        if (disposed) throw new Error("Native helper disposed before action");
        identity();
        if (!tap.owns()) throw new Error("Native request observation unavailable — action blocked");
        const row = ledger.add(["native-" + kind + "-" + window2.crypto.randomUUID()], { mode: "native", kind: "native-" + kind, quantity: quantity || 0 })[0];
        ledger.transition(row, "READING", "Awaiting native " + kind + " step");
        let timer;
        const response = new Promise((resolve) => owner = { kind, quantity, journal: ledger, row, resolve, done: false, submittedRequest: null });
        const cancel = () => {
          if (owner && !owner.done) finish({ outcome: owner.row.state === "SUBMITTED" ? "UNKNOWN" : "REJECTED", reason: "Native helper cancelled/timed out" });
        };
        timer = window2.setTimeout(cancel, timeout);
        try {
          await action(owner);
          const result = await response;
          if (result.outcome !== "CONFIRMED") throw Object.assign(new Error(result.outcome + " — " + result.reason), { outcome: result.outcome });
          return result.reason || "CONFIRMED by typed native response";
        } catch (error) {
          if (owner && !owner.done) finish({ outcome: owner.row.state === "SUBMITTED" ? "UNKNOWN" : "REJECTED", reason: error.message });
          throw error;
        } finally {
          window2.clearTimeout(timer);
          owner = null;
          expiryController?.abort();
        }
      });
    }
    function tryQuantity() {
      if (!owner || owner.kind !== "move" || owner.done || owner.stopRequested) return;
      const t = text();
      if (t.includes("verify item")) {
        const b2 = confirm();
        if (b2 && owner.verifyButton !== b2) {
          owner.verifyButton = b2;
          click(b2);
        }
        return;
      }
      if (!t.includes("enter quantity") || owner.quantitySent) return;
      const direct = d.querySelector("#scan-text-input"), list = fields();
      const input = native(direct) ? direct : list.length === 1 ? list[0] : null, b = confirm();
      if (!input || !b) return;
      owner.quantitySent = true;
      setNativeField(window2, input, owner.quantity);
      owner.journal.transition(owner.row, "SUBMITTED", "Native quantity confirm intent — request pending");
      click(b);
    }
    async function nativeExpiry() {
      if (disposed || expiryActive || !owner && !canAssist() || !text().match(/(?:expiration|expiry|production) date/)) return;
      const dates = dateFields();
      if (!dates || expirySeen === dates.year) return;
      expirySeen = dates.year;
      expiryActive = true;
      expiryController = new window2.AbortController();
      const production = /production date/.test(text()), ctx = { dateType: production ? "PRODUCTION_DATE" : "EXPIRATION_DATE", dateDetail: {}, sku: { title: [...d.querySelectorAll("h1,h2,h3,strong")].filter(native).map((n) => clean(n.textContent)).find((s) => s.length > 18) || "" } };
      try {
        const entered = await picker.pick({ code: "NATIVE DATE", ctx, native: true, signal: expiryController.signal });
        if (entered === null || disposed || !dates.year.isConnected) return;
        const apply = async () => {
          if (owner?.stopRequested || !dateFields() || !dates.year.isConnected) throw new Error("Native date fields changed");
          const value = new Date(entered);
          for (const [input, part] of [[dates.month, String(value.getMonth() + 1).padStart(2, "0")], [dates.day, String(value.getDate()).padStart(2, "0")], [dates.year, String(value.getFullYear())]]) {
            setNativeField(window2, input, part);
            input.dispatchEvent(new window2.Event("blur", { bubbles: true }));
          }
          const b = confirm();
          if (!b) throw new Error("Native date confirm unavailable");
          owner.journal.transition(owner.row, "SUBMITTED", "Native date confirm intent — result pending");
          owner.dateConfirm = true;
          click(b);
        };
        if (owner) await apply();
        else await perform("date", null, apply, { timeout: 25e3 });
      } catch (error) {
        say((error.outcome || "BLOCKED") + " • " + error.message);
        onEvidence({ type: "sideline.native-date", intent: "mutation", data: { state: error.outcome || "blocked" } });
      } finally {
        expiryActive = false;
      }
    }
    function waitFor(test, timeout = 5e3) {
      return new Promise((resolve, reject) => {
        let timer;
        const obs = new window2.MutationObserver(check), cancel = () => done(new Error("Native action disposed"));
        function done(error, value) {
          obs.disconnect();
          window2.clearTimeout(timer);
          waits.delete(cancel);
          error ? reject(error) : resolve(value);
        }
        function check() {
          if (disposed || !owner || owner.done || owner.stopRequested) {
            done(new Error("Native action cancelled"));
            return;
          }
          const value = test();
          if (value) done(null, value);
        }
        waits.add(cancel);
        obs.observe(d.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "disabled", "aria-hidden"] });
        timer = window2.setTimeout(() => done(new Error("Native confirmation unavailable")), timeout);
        check();
      });
    }
    function yesButton() {
      const dialogs = all("#modal-root,[role=dialog],dialog,.modal,.Dialog,.dialog,.ReactModal__Content,[aria-modal=true]").filter(native);
      return dialogs.flatMap((dialog) => [...dialog.querySelectorAll("button,[role=button],alchemy-button,mdw-button")]).find((b) => native(b) && /^(yes|empty)\b/i.test(clean(b.textContent || b.getAttribute("aria-label"))));
    }
    function refresh() {
      if (disposed) return;
      if (!text().match(/(?:expiration|expiry|production) date/)) {
        expirySeen = null;
        if (expiryActive) expiryController?.abort();
      }
      if (owner?.kind === "date" && owner.dateConfirm && !owner.submittedRequest && /enter quantity|verify item/.test(text())) finish({ outcome: "CONFIRMED", reason: "Native date accepted at quantity/verify step; inventory not submitted" });
      tryQuantity();
      void nativeExpiry();
    }
    const observer = new window2.MutationObserver((records) => {
      if (records.some((r) => !(r.target.nodeType === 1 ? r.target : r.target.parentElement)?.closest?.("[data-tm-v4-script]") && [...r.addedNodes, ...r.removedNodes].some((n) => !(n.nodeType === 1 && n.matches("[data-tm-v4-script]"))) || records.some((r2) => r2.type !== "childList" && !(r2.target.nodeType === 1 ? r2.target : r2.target.parentElement)?.closest?.("[data-tm-v4-script]")))) refresh();
    });
    observer.observe(d.querySelector("#root,#app") || d.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["disabled", "hidden", "aria-hidden"] });
    function stop() {
      expiryController?.abort();
      picker.dispose();
      if (owner) {
        owner.stopRequested = true;
        if (owner.row.state === "READING") finish({ outcome: "REJECTED", reason: "Stopped before native submission" });
        else say("SUBMITTED — waiting for native result; no further form writes");
      }
      for (const cancel of [...waits]) cancel();
    }
    return { stop, cancelExpiry: () => {
      expiryController?.abort();
      picker.dispose();
    }, quantity: (number) => perform("move", number, async () => refresh()), clear: () => perform("close", null, async () => {
      const change = d.querySelector("#change-container-button") || button(/change container/i);
      if (!native(change)) throw new Error("No current native container");
      click(change);
      const yes = await waitFor(yesButton);
      owner.journal.transition(owner.row, "SUBMITTED", "Native clear intent — request pending");
      click(yes);
    }), returnSource: async () => {
      stop();
      await Promise.resolve();
      if (owner || journal().rows.some((r) => ["SUBMITTED", "UNKNOWN"].includes(r.state))) throw new Error("Native unresolved operation — verify before returning to source");
      const b = button(/^(back to source|return to source)/i);
      if (b) click(b);
      else throw new Error("Native return-to-source unavailable");
    }, refresh, dispose() {
      if (disposed) return;
      disposed = true;
      if (owner && !owner.done) finish({ outcome: owner.row.state === "SUBMITTED" ? "UNKNOWN" : "REJECTED", reason: "Native helper disposed" });
      expiryController?.abort();
      picker.dispose();
      for (const cancel of [...waits]) cancel();
      observer.disconnect();
      tap.dispose();
      status.remove();
    } };
  }

  // fcr-read.mjs
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

  // fcr-enrichment.mjs
  var FCR_ENRICHMENT_VERSION = "0.1.2";
  var MEASUREMENT_ORIGIN = "https://o0avbo02yl.execute-api.ap-northeast-1.amazonaws.com";
  var BIN_URL = "https://aft-poirot-website-nrt.nrt.proxy.amazon.com/api/scanitem";
  var PANDASH_URL = "https://pandash.amazon.com/GridServlet";
  var clean2 = (value) => String(value ?? "").trim();
  var upper2 = (value) => clean2(value).toUpperCase();
  var fail = (code, message, options) => new FcrReadError(code, message, options);
  function active(signal) {
    if (signal?.aborted) throw fail("CANCELLED", "Enrichment read cancelled", { cause: signal.reason });
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
      active(signal);
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
                active(signal);
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
    async function read(options, { retries = pandashRetryDelays.length, reportFailure = true } = {}) {
      const parsed = new URL(options.url), pandash = parsed.origin + parsed.pathname === PANDASH_URL;
      const endpoint = parsed.pathname.startsWith("/prod/measurementEvents/") ? "measurementEvents" : parsed.pathname.split("/").at(-1);
      for (let attempt = 0; ; attempt++) {
        active(options.signal);
        try {
          const result = await readJson(options);
          active(options.signal);
          return result;
        } catch (error) {
          active(options.signal);
          const retry = pandash && attempt < retries && (["NETWORK", "TIMEOUT"].includes(error.code) || error.code === "HTTP" && (error.status === 429 || error.status >= 500 && error.status < 600));
          if (reportFailure) evidence2(endpoint, {
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
      active(signal);
      if (restrictionCache?.expiresAt > now()) return restrictionCache.value;
      const pending = signal ? restrictionFlights.get(signal) : unscopedRestrictionFlight;
      if (pending) return pending;
      const work = (async () => {
        const settings = await read({ url: PANDASH_URL + "?fc=" + encodeURIComponent(warehouse), signal, stage: "restriction" });
        if (typeof settings.restriction !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(settings.restriction)) throw fail("SCHEMA", "Native restriction is invalid");
        active(signal);
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
        active(signal);
        if (error.code === "AUTH_REQUIRED") throw error;
        restrictionWarning = "Restriction lookup failed; default restriction used";
      }
      const request = {
        url: PANDASH_URL,
        method: "POST",
        stage: "hazmat",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ language: "default", source: sourceRestriction + "-hazmat-FC", marketPlaces: "AU", asins: asin, rows: "1", page: "1", fc: warehouse }).toString(),
        signal
      };
      for (let attempt = 0; ; attempt++) {
        let warning = "";
        try {
          const payload = await read(request, { retries: 0, reportFailure: false });
          if (payload.rows != null && !Array.isArray(payload.rows)) throw fail("SCHEMA", "Hazmat rows are invalid");
          const matches = (payload.rows || []).filter((row) => upper2(row?.asin) === asin);
          const mapped = matches.map((row) => {
            if (row.level == null || row.level === "") return null;
            const level = Number(row.level);
            if (!["number", "string"].includes(typeof row.level) || !/^\d+$/.test(clean2(row.level)) || !Number.isSafeInteger(level) || level < 0 || row.message != null && typeof row.message !== "string") throw fail("SCHEMA", "Hazmat level/message is invalid");
            return { level, message: row.message ?? "" };
          });
          if (new Set(mapped.map((row) => JSON.stringify(row))).size > 1) throw fail("IDENTITY", "Conflicting exact ASIN hazmat rows");
          if (matches.length && mapped[0] && mapped[0].message.trim() && !restrictionWarning) {
            active(signal);
            evidence2("hazmat", { outcome: "complete", level: mapped[0].level });
            return { hazmat: mapped[0], complete: true, warning: "", source: "network" };
          }
          warning = restrictionWarning || (!matches.length ? "No exact ASIN hazmat result" : "Hazmat level or message is missing");
        } catch (error) {
          active(signal);
          const retryable = ["NETWORK", "TIMEOUT"].includes(error.code) || error.code === "HTTP" && (error.status === 429 || error.status >= 500 && error.status < 600);
          const retry2 = retryable && attempt < pandashRetryDelays.length;
          evidence2("hazmat", { outcome: "failed", code: error.code, status: error.status, stage: "hazmat", method: "POST", attempt: attempt + 1, retry: retry2 });
          if (!retry2) throw error;
        }
        const retry = !restrictionWarning && attempt < pandashRetryDelays.length;
        if (warning) evidence2("hazmat", { outcome: "incomplete", stage: "hazmat", attempt: attempt + 1, retry });
        if (warning && !retry) return { hazmat: null, complete: false, warning, source: "network" };
        await wait(pandashRetryDelays[attempt], signal);
      }
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
      active(signal);
      evidence2("scanitem", { outcome: "complete" });
      return { ...matches[0], complete: true, source: "network" };
    }
    async function fallback(identifier, reason, signal, authRequired) {
      active(signal);
      const result = historyFallback ? await historyFallback(identifier, { signal }) : null;
      active(signal);
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
      const identifier = upper2(fnsku || asin), identifierType = fnsku ? "FNSKU" : "ASIN";
      if (!/^[A-Z0-9]{10}$/.test(identifier)) throw fail("INPUT", "Measurement identifier is invalid");
      const before = now(), after = before - 30 * 24 * 60 * 60 * 1e3;
      let auth = await getMeasurementAuth(identifier, { signal, force: forceAuth });
      active(signal);
      const validAuth = (value) => value && typeof value.token === "string" && value.token && Number.isFinite(value.expiresAt) && value.expiresAt > now() + 1e4;
      if (!validAuth(auth)) return fallback(identifier, "measurement-login-required", signal, true);
      const url = new URL(MEASUREMENT_ORIGIN + "/prod/measurementEvents/" + identifier + "/" + identifierType);
      url.searchParams.set("effectiveAfter", new Date(after).toISOString());
      url.searchParams.set("effectiveBefore", new Date(before).toISOString());
      const seen = /* @__PURE__ */ new Set();
      let next = "", pages = 0, eventsChecked = 0, renewed = false;
      do {
        active(signal);
        if (pages >= maxMeasurementPages || next && seen.has(next)) throw fail("PAGINATION", "Measurement history incomplete or repeated");
        if (next) {
          seen.add(next);
          url.searchParams.set("nextToken", next);
        } else url.searchParams.delete("nextToken");
        let payload;
        try {
          payload = await read({ url: url.href, headers: { Accept: "application/json", Authorization: auth.token }, signal });
        } catch (error) {
          active(signal);
          if (error.code === "AUTH_REQUIRED" && !renewed) {
            renewed = true;
            const fresh = await getMeasurementAuth(identifier, { signal, force: true, previousToken: auth.token });
            active(signal);
            if (!validAuth(fresh) || fresh.token === auth.token) return fallback(identifier, "measurement-token-expired", signal, true);
            auth = fresh;
            try {
              payload = await read({ url: url.href, headers: { Accept: "application/json", Authorization: auth.token }, signal });
            } catch (retryError) {
              active(signal);
              if (retryError.code === "AUTH_REQUIRED") return fallback(identifier, "measurement-token-expired", signal, true);
              if (retryError.status === 400) return fallback(identifier, "measurement-http-400", signal, false);
              throw retryError;
            }
          } else if (error.code === "AUTH_REQUIRED") return fallback(identifier, "measurement-token-expired", signal, true);
          else if (error.status === 400) return fallback(identifier, "measurement-http-400", signal, false);
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
          active(signal);
          evidence2("measurementEvents", { outcome: "positive", pages, eventsChecked });
          return { madcat: true, madcatSource: "raw", windowDays: 30, complete: true, pages, eventsChecked, identifierType, source: "network" };
        }
      } while (next);
      active(signal);
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
        const hazard = await enrichment.hazmat(result.ctx.asin, { signal }), data = hazard.complete === true ? hazard.hazmat : null;
        if (!data || !Number.isSafeInteger(data.level) || data.level < 0 || !data.message?.trim()) return { kind: "retry", reason: "HAZMAT CHECK UNKNOWN — missing validated processing decision", ctx: result.ctx };
        const blocked = /cannot|can't|not be processed/i.test(data.message), allowed2 = /can be processed/i.test(data.message) && !blocked;
        if (allowed2) return { ...result, reason: result.kind === "yellow" ? result.reason : "HAZMAT L" + data.level + " — OK TO PROCESS" };
        if (blocked) return { kind: "red", reason: "HAZMAT L" + data.level + " — NOT PROCESSABLE", ctx: result.ctx };
        return { kind: "retry", reason: "HAZMAT CHECK UNKNOWN — unrecognised processing decision", ctx: result.ctx };
      } catch (error) {
        return { kind: "retry", reason: "HAZMAT CHECK UNKNOWN — " + error.message, ctx: result.ctx };
      }
    };
  }

  // sideline-entry.mjs
  var VERSION = "0.1.4";
  var page = typeof unsafeWindow === "object" ? unsafeWindow : window;
  var guard = Symbol.for("tampermonkey.v4.sideline.installer");
  if (!page[guard]) {
    page[guard] = { version: VERSION };
    installRouteLifecycle(window, () => {
      if (window.top !== window.self || location.hostname !== "aft-poirot-website-nrt.nrt.proxy.amazon.com") return;
      const emit = (data) => evidence(window, "SIDE", VERSION, data), identity = () => resolveIdentity(window, page), client = createSidelineClient({ window, fetch: page.fetch.bind(page), identity, onEvidence: emit });
      let ui;
      const preflight = createSidelinePreflight({ window, client, gmRequest: GM_xmlhttpRequest, onEvidence: emit });
      const native = createSidelineNative({ window, page, client, identity, canAssist: () => !ui?.workflow?.getState().busy, onEvidence: emit });
      const release = registerWatermark(window, "SIDE", VERSION);
      ui = createSidelineUi({ window, client, preflight, native, version: VERSION, onEvidence: emit });
      native.refresh();
      return () => {
        ui.dispose();
        release();
      };
    }, () => location.pathname, { waitForDom: true });
  }
})();
