// ==UserScript==
// @name V4 Bind Hierarchy
// @namespace https://github.com/1Sirkkris/tampermonkey-v4
// @version 0.1.0
// @description Native hierarchy queue with durable submission barriers and one batch owner.
// @match https://tx-b-hierarchy-nrt.nrt.proxy.amazon.com/bindHierarchy*
// @grant unsafeWindow
// @run-at document-start
// @updateURL https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Bind_Hierarchy_Queue.user.js
// @downloadURL https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Bind_Hierarchy_Queue.user.js
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
      window2.dispatchEvent(new window2.CustomEvent("tampermonkey-v4:evidence", { detail: JSON.stringify({ script, version, ...data }) }));
    } catch {
    }
  }
  function installRouteLifecycle(window2, start, context = () => window2.location.pathname + window2.location.search + window2.location.hash) {
    let dispose = () => {
    }, current = context(), hidden = false;
    const run = () => {
      dispose();
      dispose = start() || (() => {
      });
    };
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
      window2.removeEventListener("hashchange", navigate);
      window2.removeEventListener("popstate", navigate);
      window2.removeEventListener("pagehide", hide);
      window2.removeEventListener("pageshow", show);
    };
  }

  // identity.mjs
  function resolveIdentity(window2, page = window2) {
    const normalize = (value) => {
      const raw = clean(value).toLowerCase();
      return /^[a-z][a-z0-9-]{2,31}$/.test(raw) && !/^(?:login|username|user|employee|alias|autoid|logout|logoff|signout|signin|profile|account|settings|search)$/.test(raw) ? raw : "";
    };
    const candidates = [];
    const add = (value, source) => {
      const login = normalize(value);
      if (login) candidates.push({ login, source });
    };
    for (const key of ["employeeLogin", "userLogin", "autoId", "autoID"]) add(page[key], "native-global:" + key);
    for (const name of ["currentUser", "employee", "bootstrapData", "__INITIAL_STATE__"]) {
      const value = page[name];
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
  function createNativeJson({ window: window2, fetch = window2.fetch.bind(window2), timeoutMs = 25e3, onEvidence = () => {
  } }) {
    return async (path, body, { signal, mutation = false } = {}) => {
      const url = new window2.URL(path, window2.location.href);
      if (url.origin !== window2.location.origin) throw new NativeRequestError("Native request origin mismatch");
      if (signal?.aborted) throw new NativeRequestError("Preflight cancelled");
      const controller = new window2.AbortController();
      let timeout = false;
      const cancel = () => controller.abort();
      signal?.addEventListener("abort", cancel, { once: true });
      const timer = window2.setTimeout(() => {
        timeout = true;
        controller.abort();
      }, timeoutMs);
      try {
        const response = await fetch(url.href, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
        const raw = await response.text();
        let data;
        try {
          data = JSON.parse(raw);
        } catch {
          data = null;
        }
        const redirect = response.redirected || response.url && new window2.URL(response.url).pathname !== url.pathname;
        if (redirect || /text\/html/i.test(response.headers.get("content-type") || "") || /^[\s]*</.test(raw) || [401, 403, 419].includes(response.status)) throw new NativeRequestError("Native session/authentication response", { outcome: mutation ? "UNKNOWN" : "REJECTED", status: response.status });
        if (!response.ok) throw new NativeRequestError("Native HTTP " + response.status, { outcome: mutation ? "UNKNOWN" : "REJECTED", status: response.status });
        if (data === null || raw.length > 8e6) throw new NativeRequestError("Native JSON response invalid", { outcome: mutation ? "UNKNOWN" : "REJECTED", status: response.status });
        if (typeof data === "object" && (data.success === false || data.error || data.errorMessage || data.exception)) throw new NativeRequestError("Native operation explicitly rejected", { outcome: "REJECTED", status: response.status });
        onEvidence({ type: "native.response", intent: mutation ? "mutation" : "read", data: { endpoint: url.pathname, status: response.status } });
        return { data, status: response.status };
      } catch (error) {
        if (error instanceof NativeRequestError) throw error;
        throw new NativeRequestError(timeout ? "Native request timed out" : controller.signal.aborted ? "Native request cancelled" : "Native request failed", { outcome: mutation ? "UNKNOWN" : "REJECTED" });
      } finally {
        window2.clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
      }
    };
  }

  // hierarchy-driver.mjs
  function validateHierarchy(data, container) {
    if (!data || typeof data !== "object" || upper(data.warehouseId) !== "BWU2" || upper(data.scannableId) !== upper(container)) throw new NativeRequestError("Validation did not prove exact BWU2 container");
  }
  function validateSummary(data) {
    if (!data || !Array.isArray(data.transferBindingSummaryList)) throw new NativeRequestError("Native hierarchy summary invalid");
  }
  function validateHierarchyAcknowledgement(data) {
    if (!data || typeof data.hostName !== "string" || !clean(data.hostName) || data.success === false || data.error || data.errorMessage || data.exception) throw new NativeRequestError("Hierarchy result not positively acknowledged", { outcome: "UNKNOWN" });
  }
  function createHierarchyDriver({ request, identity, seedBind, getTemplate, setTemplate }) {
    return async (row, { mode, signal, beforeMutation, checkRunning, onPhase = () => {
    } }) => {
      const container = row.container;
      if (mode === "bind") {
        let template2 = getTemplate();
        if (template2) {
          const dest = await request("/validateDestination", { destinationWarehouseId: template2.destinationWarehouseId }, { signal });
          if (upper(dest.data) !== "BWU1") {
            setTemplate(null);
            template2 = null;
          }
        }
        if (!template2) {
          if (!seedBind) throw new NativeRequestError("Native Bind scanner/template capability unavailable");
          return seedBind(row, { signal, beforeMutation, checkRunning, onPhase });
        }
      }
      onPhase("validate");
      const validated = await request("/validateContainer", { warehouseId: "BWU2", scannableId: container }, { signal });
      validateHierarchy(validated.data, container);
      onPhase("summary");
      const summary = await request("/getTransshipmentBindingSummary", { warehouseId: "BWU2", scannableId: container }, { signal });
      validateSummary(summary.data);
      checkRunning();
      const login = identity().login;
      const template = mode === "bind" ? getTemplate() : null;
      const body = { sourceWarehouseId: template?.sourceWarehouseId || "BWU2", scannableId: container, employeeLogin: login };
      if (mode === "bind") body.destinationWarehouseId = template.destinationWarehouseId;
      beforeMutation();
      onPhase(mode);
      const result = await request(mode === "bind" ? "/forceBind" : "/unbindContainer", body, { signal, mutation: true });
      validateHierarchyAcknowledgement(result.data);
      return result;
    };
  }

  // hierarchy-native.mjs
  var endpoints = /* @__PURE__ */ new Set(["/validateDestination", "/validateContainer", "/getTransshipmentBindingSummary", "/forceBind"]);
  function createHierarchyNative({ window: window2, page = window2, onMutation = () => {
  }, onTemplate = () => {
  } }) {
    let sequence = 0, records = [], waiters = /* @__PURE__ */ new Set(), disposed = false, seed = null;
    const details = /* @__PURE__ */ new WeakMap();
    function begin(url, body) {
      let path, payload;
      try {
        const target = new window2.URL(url, window2.location.href);
        if (target.origin !== window2.location.origin || !endpoints.has(target.pathname)) return;
        path = target.pathname;
        payload = typeof body === "string" ? JSON.parse(body) : null;
      } catch {
        return;
      }
      const record = { seq: ++sequence, path, request: payload };
      if (path === "/forceBind" && seed) {
        if (!seed.allow || upper(payload?.scannableId) !== upper(seed.container) || payload?.destinationWarehouseId !== seed.destination) throw new Error("V4 blocked unexpected native Bind submission");
        seed.beforeMutation();
        onMutation(record);
      }
      return record;
    }
    function finish(record, status, raw, finalUrl = "") {
      if (!record || disposed) return;
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        data = raw;
      }
      let redirected = false;
      try {
        redirected = !!finalUrl && new window2.URL(finalUrl, window2.location.href).pathname !== record.path;
      } catch {
        redirected = true;
      }
      const entry = { ...record, status, data, redirected };
      records.push(entry);
      records = records.slice(-40);
      for (const waiter of [...waiters]) waiter.check(entry);
      if (record.path === "/forceBind" && status === 200 && !redirected && typeof data?.hostName === "string" && data.hostName && record.request?.sourceWarehouseId && record.request?.destinationWarehouseId) {
        onTemplate({ sourceWarehouseId: record.request.sourceWarehouseId, destinationWarehouseId: record.request.destinationWarehouseId });
      }
    }
    const originalFetch = page.fetch;
    const wrappedFetch = function(input, init = {}) {
      const url = typeof input === "string" || input instanceof window2.URL ? String(input) : input?.url;
      const record = begin(url, init.body);
      const promise = originalFetch.apply(this, arguments);
      if (record) void promise.then(async (response) => {
        try {
          finish(record, response.status, await response.clone().text(), response.url);
        } catch {
          finish(record, 0, "");
        }
      }, () => finish(record, 0, ""));
      return promise;
    };
    page.fetch = wrappedFetch;
    const prototype = page.XMLHttpRequest?.prototype, originalOpen = prototype?.open, originalSend = prototype?.send;
    function open(method, url) {
      details.set(this, { url, method });
      return originalOpen.apply(this, arguments);
    }
    function send(body) {
      const detail = details.get(this), record = detail?.method?.toUpperCase() === "POST" ? begin(detail.url, body) : null;
      if (record) this.addEventListener("loadend", () => {
        let raw = "";
        try {
          raw = this.responseType === "json" ? JSON.stringify(this.response) : this.responseText;
        } catch {
        }
        finish(record, this.status, raw, this.responseURL);
      }, { once: true });
      return originalSend.apply(this, arguments);
    }
    if (prototype) {
      prototype.open = open;
      prototype.send = send;
    }
    function wait(path, after, predicate, signal) {
      const promise = new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(new NativeRequestError("Native scan cancelled"));
          return;
        }
        let timer;
        const cancel = () => done(new NativeRequestError("Native scan cancelled"));
        function done(error, entry) {
          window2.clearTimeout(timer);
          signal?.removeEventListener("abort", cancel);
          waiters.delete(job);
          error ? reject(error) : resolve(entry);
        }
        const job = { check(entry) {
          if (entry.seq > after && entry.path === path && predicate(entry)) {
            if (entry.status !== 200 || entry.redirected) {
              done(new NativeRequestError("Native scan response unverified", { outcome: path === "/forceBind" ? "UNKNOWN" : "REJECTED" }));
              return;
            }
            done(null, entry);
          }
        }, cancel };
        waiters.add(job);
        signal?.addEventListener("abort", cancel, { once: true });
        timer = window2.setTimeout(() => done(new NativeRequestError("Native scan response timed out", { outcome: path === "/forceBind" ? "UNKNOWN" : "REJECTED" })), 25e3);
        for (const entry of records) job.check(entry);
      });
      void promise.catch(() => {
      });
      return promise;
    }
    function key(target, type, value) {
      const event = new window2.KeyboardEvent(type, { key: value, code: value === "Enter" ? "Enter" : "", bubbles: true, cancelable: true, shiftKey: /^[A-Z]$/.test(value) });
      const number = value === "Enter" ? 13 : type === "keypress" ? value.charCodeAt(0) : value.toUpperCase().charCodeAt(0);
      for (const property of ["keyCode", "which", "charCode"]) Object.defineProperty(event, property, { get: () => number });
      target.dispatchEvent(event);
    }
    function fields(kind) {
      return [...window2.document.querySelectorAll("input[type=text],input:not([type]),textarea,[role=combobox]")].filter((node) => !node.closest("[data-tm-v4-script]") && !node.hidden && window2.getComputedStyle(node).display !== "none").map((node) => {
        const descriptor = [node.id, node.name, node.placeholder, node.getAttribute("aria-label"), node.closest("label")?.textContent, node.id ? [...window2.document.querySelectorAll("label")].find((label) => label.htmlFor === node.id)?.textContent : ""].join(" ").toLowerCase();
        return { node, descriptor };
      }).filter((row) => kind === "destination" ? /destination/.test(row.descriptor) : /container|scannable|scan|tote/.test(row.descriptor) && !/destination/.test(row.descriptor));
    }
    async function scanner(value, kind, signal) {
      const candidates = fields(kind);
      if (candidates.length > 1) throw new NativeRequestError("Native " + kind + " fields are ambiguous");
      const field = candidates[0]?.node;
      if (field) {
        const prototype2 = field.tagName === "TEXTAREA" ? window2.HTMLTextAreaElement.prototype : window2.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype2, "value").set.call(field, value);
        field.dispatchEvent(new window2.Event("input", { bubbles: true }));
        field.dispatchEvent(new window2.Event("change", { bubbles: true }));
        field.focus();
        for (const type of ["keydown", "keypress", "keyup"]) key(field, type, "Enter");
        return;
      }
      if (kind === "destination") throw new NativeRequestError("Native BWU1 destination field unavailable");
      const body = window2.document.body;
      for (const char of value) {
        if (signal.aborted) throw new NativeRequestError("Native scan cancelled");
        for (const type of ["keydown", "keypress", "keyup"]) key(body, type, char);
        await new Promise((resolve) => window2.setTimeout(resolve, 2));
      }
      for (const type of ["keydown", "keypress", "keyup"]) key(body, type, "Enter");
    }
    async function seedBind(row, { signal, beforeMutation, checkRunning, onPhase }) {
      seed = { container: row.container, beforeMutation, allow: false, destination: "" };
      try {
        onPhase("destination");
        let mark = sequence;
        const destination = wait("/validateDestination", mark, (record) => upper(record.data) === "BWU1", signal);
        await scanner("BWU1", "destination", signal);
        const dest = await destination;
        seed.destination = clean(dest.request?.destinationWarehouseId);
        if (!seed.destination) throw new NativeRequestError("Native destination token not captured");
        onPhase("native-validate");
        mark = sequence;
        const match = (record) => upper(record.request?.scannableId) === upper(row.container);
        const valid = wait("/validateContainer", mark, match, signal), summary = wait("/getTransshipmentBindingSummary", mark, match, signal);
        await scanner(row.container, "container", signal);
        const [v, s] = await Promise.all([valid, summary]);
        validateHierarchy(v.data, row.container);
        validateSummary(s.data);
        checkRunning();
        onPhase("native-bind");
        seed.allow = true;
        mark = sequence;
        const bound = wait("/forceBind", mark, match, signal);
        await scanner(row.container, "container", signal);
        const result = await bound;
        validateHierarchyAcknowledgement(result.data);
        if (result.request?.destinationWarehouseId !== seed.destination || !result.request.sourceWarehouseId) throw new NativeRequestError("Native Bind destination/source tokens unverified", { outcome: "UNKNOWN" });
        onTemplate({ sourceWarehouseId: result.request.sourceWarehouseId, destinationWarehouseId: seed.destination });
        return result;
      } finally {
        seed = null;
      }
    }
    return { seedBind, dispose() {
      disposed = true;
      for (const job of [...waiters]) job.cancel();
      if (page.fetch === wrappedFetch) page.fetch = originalFetch;
      if (prototype?.open === open) prototype.open = originalOpen;
      if (prototype?.send === send) prototype.send = originalSend;
    } };
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
      if (row.state === "SUBMITTED" && !["CONFIRMED", "REJECTED", "UNKNOWN"].includes(state)) throw new Error("Submitted work cannot become runnable");
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
    }, add, transition, clear, clearConfirmed, save, next: () => rows.find((row) => row.state === "QUEUED") };
  }
  async function withOperationLock(window2, name, work) {
    if (typeof window2.navigator.locks?.request !== "function") throw new Error("Browser Web Locks unavailable — operation blocked");
    return window2.navigator.locks.request(name, { mode: "exclusive", ifAvailable: true }, async (lock) => {
      if (!lock) throw new Error("Another V4 tab owns this workflow");
      return work();
    });
  }

  // hierarchy-runtime.mjs
  function normalizeHierarchyContainer(value) {
    const raw = clean(value);
    if (!/^(?:tsx|csx)[A-Za-z0-9_-]+$/i.test(raw)) return "";
    return (/^tsx/i.test(raw) ? "tsX" : "csX") + raw.slice(3);
  }
  function createHierarchyQueue({ window: window2, mode, driver, identity, version, onEvidence = () => {
  }, storage = window2.localStorage }) {
    const d = window2.document, key = "tm-v4.hierarchy.rows", lock = "tm-v4.hierarchy.owner", prefix = "tm-v4.hierarchy." + mode + ".";
    let journal, processing = false, running = false, disposed = false, controller = null, currentRow = null, owned = false, runPromise = null, generation = 0;
    const uuid = () => window2.crypto.randomUUID?.() || [...window2.crypto.getRandomValues(new Uint32Array(4))].join("-");
    const load = () => {
      journal = createOperationJournal({ storage, key, normalize: normalizeHierarchyContainer, uuid });
    };
    const root = d.createElement("aside");
    root.id = "tm-v4-hierarchy";
    root.dataset.tmV4Script = mode === "bind" ? "BIND" : "UNBD";
    const style = d.createElement("style");
    style.dataset.tmV4Style = root.dataset.tmV4Script;
    style.textContent = `#tm-v4-hierarchy{position:fixed;right:12px;top:12px;width:400px;max-width:calc(100vw - 24px);z-index:999990;border:2px solid #123455;border-radius:9px;background:#fff;box-shadow:0 4px 20px #0004;color:#172033;font:13px Arial,sans-serif}#tm-v4-hierarchy header{display:flex;align-items:center;gap:8px;background:#123455;color:white;padding:9px;font-weight:bold}#tm-v4-hierarchy header strong{flex:1}#tm-v4-hierarchy .body{padding:10px}#tm-v4-hierarchy textarea{width:100%;height:115px;resize:vertical;box-sizing:border-box;font:16px monospace;padding:7px}#tm-v4-hierarchy button{cursor:pointer;border:1px solid #9aaec5;border-radius:5px;padding:6px 10px;background:#edf4fc;color:#123455;font-weight:bold}#tm-v4-hierarchy .controls{display:flex;gap:5px;margin:8px 0;flex-wrap:wrap}#tm-v4-hierarchy [data-action=start]{background:#176a3a;color:white}#tm-v4-hierarchy [data-action=pause]{background:#f5aa25;color:#111}#tm-v4-hierarchy .rows{max-height:40vh;overflow:auto}#tm-v4-hierarchy table{width:100%;border-collapse:collapse}#tm-v4-hierarchy td{padding:5px;border-bottom:1px solid #d5dfe9;word-break:break-word}#tm-v4-hierarchy tr[data-state=CONFIRMED]{background:#d4f8d7}#tm-v4-hierarchy tr[data-state=UNKNOWN],#tm-v4-hierarchy tr[data-state=SUBMITTED]{background:#ffe08c}#tm-v4-hierarchy tr[data-state=REJECTED]{background:#ffe1e1}#tm-v4-hierarchy[data-minimized=true] .body{display:none}#tm-v4-hierarchy[hidden]{display:none}`;
    root.innerHTML = `<header><strong>${mode === "bind" ? "Bind → BWU1" : "Unbind"} Queue • V4 ${escapeHtml(version)}</strong><button data-action="minimize">−</button><button data-action="hide">Hide</button></header><div class="body"><div data-identity></div><textarea placeholder="Scan / paste tsX or csX containers"></textarea><div class="controls"><button data-action="add">ADD</button><button data-action="start">START</button><button data-action="pause">PAUSE</button><button data-action="clear">CLEAR</button></div><div role="status">Ready</div><div data-counts></div><div class="rows"><table><tbody></tbody></table></div></div>`;
    const mini = d.createElement("button");
    mini.type = "button";
    mini.dataset.tmV4Script = root.dataset.tmV4Script;
    mini.textContent = "Show " + mode + " queue";
    mini.style.cssText = "position:fixed;right:12px;top:12px;z-index:999990";
    mini.hidden = true;
    const input = root.querySelector("textarea"), status = (text) => {
      root.querySelector("[role=status]").textContent = text;
    };
    const listeners = new window2.AbortController();
    function render() {
      if (disposed || !journal) return;
      root.querySelector("[data-counts]").textContent = `${journal.rows.filter((row) => row.state === "QUEUED" && row.mode === mode).length} queued • ${journal.rows.filter((row) => row.state === "CONFIRMED").length} done • ${journal.rows.filter((row) => ["UNKNOWN", "SUBMITTED"].includes(row.state)).length} unresolved`;
      root.querySelector("tbody").innerHTML = journal.rows.map((row) => `<tr data-state="${row.state}"><td><b>${escapeHtml(row.container)}</b><br>${escapeHtml(row.mode || mode)}</td><td>${row.state}<br>${escapeHtml(row.message)}</td></tr>`).join("");
      root.querySelector("[data-action=start]").disabled = processing;
      try {
        root.querySelector("[data-identity]").textContent = "AUTO ID: " + identity().login;
      } catch (error) {
        root.querySelector("[data-identity]").textContent = error.message;
      }
    }
    function transition(row, state, message, extra = {}) {
      journal.transition(row, state, message, extra);
      render();
      if (["SUBMITTED", "CONFIRMED", "REJECTED", "UNKNOWN"].includes(state)) onEvidence({ type: "hierarchy.operation", intent: "mutation", phase: state, operationId: row.operationId, data: { mode, stage: row.phase || mode, outcome: state } });
    }
    async function edit(work) {
      if (owned) return work();
      return withOperationLock(window2, lock, async () => {
        load();
        return work();
      });
    }
    async function add(text = input.value) {
      const values = String(text).split(/[\s,;]+/).filter(Boolean);
      if (!values.length) return;
      await edit(() => journal.add(values, { mode }));
      input.value = "";
      window2.sessionStorage.setItem(prefix + "draft", "");
      status("Queued " + values.length + " containers");
      render();
      input.focus();
    }
    function pause() {
      running = false;
      status(currentRow?.state === "SUBMITTED" ? "PAUSED — waiting for submitted result" : "Paused safely");
      if (currentRow && currentRow.state === "READING") controller?.abort();
      render();
    }
    async function start() {
      if (processing || disposed) return;
      try {
        await add();
      } catch (error) {
        status(error.message);
        return;
      }
      const run = ++generation;
      running = true;
      processing = true;
      render();
      runPromise = withOperationLock(window2, lock, async () => {
        owned = true;
        load();
        journal.save();
        identity();
        while (running && !disposed && run === generation) {
          const row = journal.rows.find((row2) => row2.mode === mode && row2.state === "QUEUED");
          if (!row) break;
          currentRow = row;
          controller = new window2.AbortController();
          transition(row, "READING", "Validating native session");
          let submitted = false;
          try {
            await driver(row, { mode, signal: controller.signal, checkRunning: () => {
              if (!running || disposed || run !== generation) throw new Error("Paused before mutation");
            }, onPhase: (phase) => {
              if (disposed) return;
              row.phase = phase;
              row.message = "Processing " + phase;
              journal.save();
              render();
            }, beforeMutation: () => {
              if (!running || disposed || run !== generation) throw new Error("Paused before mutation");
              identity();
              if (submitted) throw new Error("Duplicate submission blocked");
              row.operationId = uuid();
              transition(row, "SUBMITTED", "Submitted — waiting for native acknowledgement");
              submitted = true;
            } });
            if (disposed || run !== generation) break;
            transition(row, "CONFIRMED", "Native hierarchy acknowledged");
            status("DONE " + row.container + " — scan next");
          } catch (error) {
            if (disposed || run !== generation) break;
            const state = submitted ? error.outcome === "REJECTED" ? "REJECTED" : "UNKNOWN" : !running || controller.signal.aborted ? "QUEUED" : "REJECTED";
            transition(row, state, error.message);
            status(error.message);
            running = false;
          } finally {
            currentRow = null;
            controller = null;
          }
        }
      }).catch((error) => status(error.message)).finally(() => {
        owned = false;
        running = false;
        processing = false;
        runPromise = null;
        render();
        if (!disposed) input.focus();
      });
      await runPromise;
    }
    async function clear() {
      pause();
      if (runPromise) await runPromise;
      try {
        await edit(() => journal.clear());
        input.value = "";
        window2.sessionStorage.setItem(prefix + "draft", "");
        status(journal.rows.length ? "Unresolved submissions retained — verify native result" : "Cleared — next batch");
        render();
      } catch (error) {
        status(error.message);
      }
    }
    input.addEventListener("input", () => window2.sessionStorage.setItem(prefix + "draft", input.value), { signal: listeners.signal });
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      const lines = input.value.split(/\r?\n/), last = clean(lines.at(-1));
      if (upper(last) === "123START") {
        event.preventDefault();
        lines.pop();
        input.value = lines.join("\n");
        void start();
        return;
      }
      if (running && last) {
        event.preventDefault();
        void add().catch((error) => status(error.message));
      }
    }, { signal: listeners.signal });
    root.addEventListener("click", (event) => {
      const action = event.target.closest("button")?.dataset.action;
      if (action === "add") void add().catch((error) => status(error.message));
      if (action === "start") void start();
      if (action === "pause") pause();
      if (action === "clear") void clear();
      if (action === "minimize") {
        root.dataset.minimized = String(root.dataset.minimized !== "true");
        window2.sessionStorage.setItem(prefix + "minimized", root.dataset.minimized);
      }
      if (action === "hide") {
        root.hidden = true;
        mini.hidden = false;
      }
    }, { signal: listeners.signal });
    mini.addEventListener("click", () => {
      root.hidden = false;
      mini.hidden = true;
      input.focus();
    }, { signal: listeners.signal });
    window2.addEventListener("storage", (event) => {
      if (event.key === key && !processing) {
        try {
          load();
          render();
        } catch (error) {
          status(error.message);
        }
      }
    }, { signal: listeners.signal });
    try {
      load();
      input.value = window2.sessionStorage.getItem(prefix + "draft") || "";
      root.dataset.minimized = window2.sessionStorage.getItem(prefix + "minimized") || "false";
      render();
    } catch (error) {
      status(error.message);
      root.querySelectorAll("[data-action=start],[data-action=add],[data-action=clear]").forEach((node) => node.disabled = true);
    }
    d.documentElement.append(style, root, mini);
    return { root, add, start, pause, clear, getState: () => journal?.rows, dispose() {
      if (disposed) return;
      running = false;
      generation++;
      if (currentRow) {
        try {
          transition(currentRow, currentRow.state === "SUBMITTED" ? "UNKNOWN" : "QUEUED", currentRow.state === "SUBMITTED" ? "Page disposed during submission — verify native result" : "Preflight interrupted before submission");
        } catch {
        }
      }
      disposed = true;
      controller?.abort();
      listeners.abort();
      root.remove();
      mini.remove();
      style.remove();
    } };
  }

  // hierarchy-entry.mjs
  function installHierarchy(window2, page, mode, version) {
    const guard = Symbol.for("tampermonkey.v4.hierarchy.installer");
    if (page[guard]) return;
    page[guard] = { version };
    installRouteLifecycle(window2, () => {
      if (!new RegExp("^/" + mode + "Hierarchy(?:/|$)").test(window2.location.pathname)) return;
      const label = mode === "bind" ? "BIND" : "UNBD", release = registerWatermark(window2, label, version), emit = (data) => evidence(window2, label, version, data), identity = () => resolveIdentity(window2, page);
      let template = null;
      try {
        template = JSON.parse(window2.sessionStorage.getItem("tm-v4.hierarchy.template") || "null");
      } catch {
      }
      function save(value) {
        template = value;
        try {
          window2.sessionStorage.setItem("tm-v4.hierarchy.template", JSON.stringify(value));
        } catch {
        }
      }
      let native = mode === "bind" ? createHierarchyNative({ window: window2, page, onTemplate: save, onMutation: (record) => {
        if (record.request?.employeeLogin !== identity().login) throw new Error("Native Bind employee identity disagrees with authenticated user");
      } }) : null;
      const request = createNativeJson({ window: window2, fetch: page.fetch.bind(page), onEvidence: emit });
      const driver = createHierarchyDriver({ request, identity, seedBind: native?.seedBind, getTemplate: () => template, setTemplate: save });
      const queue = createHierarchyQueue({ window: window2, mode, driver, identity, version, onEvidence: emit });
      return () => {
        queue.dispose();
        native?.dispose();
        release();
      };
    }, () => window2.location.pathname);
  }

  // bind-entry.mjs
  var VERSION = "0.1.0";
  installHierarchy(window, typeof unsafeWindow === "object" ? unsafeWindow : window, "bind", VERSION);
})();
