// ==UserScript==
// @name         V4 FCResearch Master
// @namespace    https://github.com/1Sirkkris/tampermonkey-v4
// @version      0.1.0
// @description  Independent native FCR sections; development checkpoint, full Master parity pending.
// @match        http://fcresearch-fe.aka.amazon.com/*
// @match        https://fcresearch-fe.aka.amazon.com/*
// @match        http://qi-fcresearch-fe.corp.amazon.com/*
// @match        https://qi-fcresearch-fe.corp.amazon.com/*
// @match        http://qi-fcresearch-jp.corp.amazon.com/*
// @match        https://qi-fcresearch-jp.corp.amazon.com/*
// @match        http://qifcr.fe.aftx.amazonoperations.app/*
// @match        https://qifcr.fe.aftx.amazonoperations.app/*
// @match        https://jp.item-measurement.aft.a2z.com/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_xmlhttpRequest
// @connect      aft-poirot-website-nrt.nrt.proxy.amazon.com
// @connect      pandash.amazon.com
// @connect      o0avbo02yl.execute-api.ap-northeast-1.amazonaws.com
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/FCResearch_Master.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/FCResearch_Master.user.js
// ==/UserScript==
(() => {
  // fcr-read.mjs
  var FCR_READ_VERSION = "0.1.0";
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
    "problems",
    "problem",
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
    const tokens = markers.filter((value) => value && !/^(?:false|null|done)$/i.test(value));
    if (!tokens.length) return "";
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
    const endpoints = /* @__PURE__ */ new Set([...FCR_SECTIONS, "inventory-more", "inventory-history-more"]);
    function evidence(data) {
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
          evidence({ endpoint, status: response.status, outcome: "received", attempt: attempt + 1 });
          return documentFrom(html, endpoint.endsWith("-more"));
        } catch (cause) {
          active(signal);
          const error = timedOut ? failure("TIMEOUT", endpoint + ": timed out", { cause }) : cause instanceof FcrReadError ? cause : failure("NETWORK", endpoint + ": request failed", { cause });
          evidence({ endpoint, status: error.status, outcome: "failed", code: error.code, attempt: attempt + 1 });
          retry = error.code === "HTTP" && error.status >= 500 && error.status < 600 && attempt < retryDelays.length;
          if (!retry) throw error;
        } finally {
          clearTimeout(timer);
          signal?.removeEventListener("abort", cancelled);
        }
        if (retry) await wait(retryDelays[attempt], signal);
      }
    }
    async function product(queryValue, { signal } = {}) {
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
        if (!aliases.includes(identifier(query))) continue;
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
      throw failure(recognized ? "IDENTITY" : "SCHEMA", recognized ? "Product does not match the requested identifier" : "Product table was not returned");
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
        evidence({ endpoint: "inventory", outcome: "complete", pages, records: rows.length });
      } catch (cause) {
        active(signal);
        if (!(cause instanceof FcrReadError) || cause.code === "CANCELLED") throw cause;
        error = cause;
        evidence({ endpoint: "inventory", outcome: "incomplete", code: error.code, pages, records: rows.length });
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
      evidence({ endpoint: "inventory-history", outcome: complete ? "complete" : "incomplete", pages, records, code: error?.code });
      active(signal);
      return { query, html: document.body.innerHTML, pages, records, complete, warning: error?.message || "", ...error ? { code: error.code } : {}, source: "network" };
    }
    async function section(endpoint, query, options = {}) {
      if (!FCR_SECTIONS.includes(endpoint)) throw failure("INPUT", "Unsupported native FCR section");
      if (endpoint === "inventory") return inventory(query, options);
      if (endpoint === "product") return product(query, options);
      if (endpoint === "inventory-history" && (options.startDate || options.endDate)) return history(query, options);
      const search = searchValue(query), document = await request(endpoint, { s: search }, options.signal);
      active(options.signal);
      const recognized = document.querySelector('table, [data-section-type="' + endpoint + '"]');
      if (!recognized) throw failure("SCHEMA", "Native section markup was not returned");
      const token = pagination(document);
      return {
        endpoint,
        query: search,
        html: document.body.innerHTML,
        complete: false,
        warning: token ? "More native section pages remain" : "Native section completeness has not been validated",
        source: "network"
      };
    }
    return Object.freeze({ product, inventory, history, section });
  }

  // master-runtime.mjs
  var MASTER_VERSION = "0.1.0";
  var MASTER_LABELS = Object.freeze([
    "Product",
    "Inventory",
    "Inventory History",
    "Container History",
    "Purchase Order Items",
    "Purchase Order",
    "Receive History",
    "Shipment",
    "Container Details",
    "Employee",
    "Carton General Information",
    "Carton Contents",
    "SSCC Information",
    "Items in Multiple Cartons",
    "Vision Tunnel",
    "Problems",
    "Problem",
    "Events",
    "Authenticity Item"
  ]);
  var UI = "[data-tm-v4-master]";
  var PREFIX = "tm-v4.master.section.";
  var clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  var registryKey = Symbol.for("tampermonkey.v4.master.native-transport");
  function watchNativeAjax(page2, getRuntime) {
    let registry = page2[registryKey];
    if (registry) {
      registry.getRuntime = getRuntime;
      return registry;
    }
    registry = { getRuntime, attached: /* @__PURE__ */ new WeakSet(), restore: null };
    page2[registryKey] = registry;
    const identify = (options) => registry.getRuntime()?.nativeRequest(options);
    function attach(jq) {
      if (typeof jq?.ajaxTransport !== "function" || typeof jq.ajaxPrefilter !== "function" || registry.attached.has(jq)) return false;
      registry.attached.add(jq);
      jq.ajaxPrefilter((options) => {
        const request = identify(options);
        if (request && !registry.getRuntime().automatic(request.endpoint)) {
          options.global = false;
          options.timeout = 0;
        }
      });
      jq.ajaxTransport("+*", (options) => {
        const runtime = registry.getRuntime(), request = runtime?.nativeRequest(options);
        if (!request) return;
        let unsubscribe = () => {
        };
        return {
          send(_headers, complete) {
            unsubscribe = runtime.subscribe(request, complete);
          },
          abort() {
            unsubscribe();
          }
        };
      });
      registry.restore?.();
      return true;
    }
    if (!attach(page2.jQuery)) {
      const descriptor = Object.getOwnPropertyDescriptor(page2, "jQuery");
      if (!descriptor || descriptor.configurable && "value" in descriptor) {
        let value = descriptor?.value;
        const getter = () => value;
        const setter = (next) => {
          value = next;
          attach(next);
        };
        Object.defineProperty(page2, "jQuery", { configurable: true, enumerable: descriptor?.enumerable ?? true, get: getter, set: setter });
        registry.restore = () => {
          if (Object.getOwnPropertyDescriptor(page2, "jQuery")?.get === getter) {
            Object.defineProperty(page2, "jQuery", { configurable: true, enumerable: descriptor?.enumerable ?? true, writable: descriptor?.writable ?? true, value });
          }
          registry.restore = null;
        };
      }
    }
    return registry;
  }
  function createMasterRuntime({ window: window2, page: page2 = window2, storage: storage2, fetch, onRender = () => {
  }, onEvidence = () => {
  } }) {
    const document = window2.document;
    let life = null, generation = null, ready = false, observers = [], scheduled = false;
    const owned = /* @__PURE__ */ new Set(), hidden = /* @__PURE__ */ new Map(), prefs = /* @__PURE__ */ new Map(), saveErrors = /* @__PURE__ */ new Set();
    let problem = "";
    const route = () => !/^#(?:fcr-tote-checker|iss-console)/.test(window2.location.hash) && /\/[A-Z0-9-]{2,12}\/results(?:\/|$)/.test(window2.location.pathname);
    const warehouse = window2.location.pathname.split("/").filter(Boolean)[0];
    const currentQuery = () => clean(new URL(window2.location.href).searchParams.get("s") || document.querySelector("#search")?.value);
    const reader = createFcrReader({ origin: window2.location.origin, warehouse, fetch, DOMParser: window2.DOMParser, onEvidence });
    function mark(node) {
      node.setAttribute("data-tm-v4-master", "");
      owned.add(node);
      return node;
    }
    function button(label, action) {
      const node = mark(document.createElement("button"));
      node.type = "button";
      node.textContent = label;
      node.addEventListener("click", action, { signal: life.signal });
      return node;
    }
    function notify(message) {
      problem = message;
      refresh();
    }
    function active2(gen) {
      return life && !life.signal.aborted && generation === gen && !gen.controller.signal.aborted && route();
    }
    function automatic(endpoint) {
      return prefs.get(endpoint) ?? ["product", "inventory"].includes(endpoint);
    }
    function begin(query) {
      if (generation?.query === query && !generation.controller.signal.aborted) return generation;
      if (generation) {
        generation.controller.abort();
        for (const section of generation.sections.values()) for (const waiter of [...section.waiters]) waiter.finish(0, "abort");
      }
      generation = { query, controller: new window2.AbortController(), sections: /* @__PURE__ */ new Map() };
      return generation;
    }
    function state(endpoint, gen = generation) {
      if (!gen.sections.has(endpoint)) gen.sections.set(endpoint, { endpoint, status: "idle", result: null, error: null, promise: null, waiters: /* @__PURE__ */ new Set(), options: {} });
      return gen.sections.get(endpoint);
    }
    function nativeRequest(options) {
      if (!life || life.signal.aborted || !route() || String(options.type || options.method || "GET").toUpperCase() !== "POST" || options.async === false) return null;
      let url;
      try {
        url = new URL(options.url, window2.location.href);
      } catch {
        return null;
      }
      const match = url.pathname.match(new RegExp("^/" + warehouse + "/results/([^/]+)$"));
      if (url.origin !== window2.location.origin || !match || !FCR_SECTIONS.includes(match[1])) return null;
      const fields = new URLSearchParams(typeof options.data === "string" ? options.data : options.data || {});
      const query = clean(fields.get("s"));
      const allowed = match[1] === "inventory-history" ? ["s", "startSearchDateString", "endSearchDateString", "dateStringFormat"] : ["s"];
      if (!query || [...fields.keys()].some((key) => !allowed.includes(key))) return null;
      if (fields.has("dateStringFormat") && fields.get("dateStringFormat") !== "MM/dd/yyyy") return null;
      const optionsForRead = fields.has("startSearchDateString") || fields.has("endSearchDateString") ? { startDate: fields.get("startSearchDateString"), endDate: fields.get("endSearchDateString") } : {};
      return { endpoint: match[1], query, options: optionsForRead };
    }
    function subscribe(request, complete) {
      const gen = begin(request.query), section = state(request.endpoint, gen);
      if (JSON.stringify(section.options) !== JSON.stringify(request.options)) {
        section.controller?.abort();
        section.result = null;
        section.status = "idle";
        section.promise = null;
        for (const waiter2 of [...section.waiters]) waiter2.finish(0, "abort");
      }
      section.options = request.options;
      const waiter = { finish(status, statusText, responses) {
        if (!section.waiters.delete(waiter)) return;
        try {
          complete(status, statusText, responses, "Content-Type: text/html; charset=UTF-8\r\n");
        } catch (error) {
          if (active2(gen)) notify("Native " + MASTER_LABELS[FCR_SECTIONS.indexOf(request.endpoint)] + " rendering failed: " + clean(error.message));
        }
      } };
      section.waiters.add(waiter);
      if (automatic(request.endpoint) || section.status !== "idle") void load(request.endpoint, { gen });
      schedule();
      return () => {
        section.waiters.delete(waiter);
      };
    }
    async function load(endpoint, { gen = generation, force = false } = {}) {
      if (!gen || !active2(gen)) return null;
      const section = state(endpoint, gen);
      if (section.promise) return section.promise;
      if (!force && section.result) {
        for (const waiter of [...section.waiters]) waiter.finish(200, "success", { text: section.result.html });
        return section.result;
      }
      const controller = new window2.AbortController();
      const cancel = () => controller.abort();
      gen.controller.signal.addEventListener("abort", cancel, { once: true });
      section.controller = controller;
      section.status = "loading";
      section.error = null;
      schedule();
      const work = (async () => {
        try {
          const result = await reader.section(endpoint, gen.query, { ...section.options, signal: controller.signal, allowPartial: true });
          if (!active2(gen) || controller.signal.aborted) return null;
          section.result = result;
          section.status = result.complete ? "ready" : "partial";
          if (section.waiters.size) for (const waiter of [...section.waiters]) waiter.finish(200, "success", { text: result.html });
          else paint(endpoint, result);
          onRender({ endpoint, result, generation: gen, signal: controller.signal, reader, runtime: api });
          return result;
        } catch (error) {
          if (!active2(gen) || controller.signal.aborted || error.code === "CANCELLED") return null;
          section.error = error;
          section.status = "error";
          return null;
        } finally {
          gen.controller.signal.removeEventListener("abort", cancel);
          if (section.controller === controller) {
            section.promise = null;
            schedule();
          }
        }
      })();
      section.promise = work;
      return work;
    }
    function paint(endpoint, result) {
      const container = document.querySelector('[data-section-type="' + endpoint + '"]');
      if (!container) {
        notify("Native " + MASTER_LABELS[FCR_SECTIONS.indexOf(endpoint)] + " container is missing");
        return;
      }
      const parsed = new window2.DOMParser().parseFromString(result.html, "text/html");
      parsed.querySelectorAll("script").forEach((node) => node.remove());
      const content = parsed.querySelector('[data-section-type="' + endpoint + '"]') || parsed.body;
      container.replaceChildren(...[...content.childNodes].map((node) => document.importNode(node, true)));
      if (page2.jQuery?.fn?.DataTable) {
        for (const table of container.querySelectorAll('table[id^="table-"]')) {
          if (!page2.jQuery.fn.dataTable?.isDataTable(table)) page2.jQuery(table).DataTable();
        }
      }
    }
    function schedule() {
      if (!life || life.signal.aborted || !ready || scheduled) return;
      scheduled = true;
      window2.queueMicrotask(() => {
        scheduled = false;
        if (life && !life.signal.aborted) refresh();
      });
    }
    function findNavigation() {
      const heading = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6,strong,span")].find((node) => clean(node.textContent).toLowerCase() === "sections");
      for (let host = heading?.parentElement; host && host !== document.body; host = host.parentElement) {
        const texts = [...host.querySelectorAll("a,button,li,span")].filter((node) => !node.closest(UI)).map((node) => clean(node.textContent));
        if (MASTER_LABELS.filter((label) => texts.includes(label)).length >= 8) return host;
      }
      return null;
    }
    function refresh() {
      if (!ready || !route()) return;
      const nav = findNavigation();
      let status = document.querySelector("[data-tm-v4-master-status]");
      if (!status) {
        status = mark(document.createElement("span"));
        status.setAttribute("data-tm-v4-master-status", "");
        status.setAttribute("role", "status");
        (nav || document.querySelector("#search")?.parentElement || document.body).append(status);
      }
      status.textContent = "V4 FCR Master " + MASTER_VERSION + (problem ? " — " + problem : !nav ? " — Native Sections navigation unavailable" : "");
      if (!nav) return;
      for (const [index, label] of MASTER_LABELS.entries()) {
        const endpoint = FCR_SECTIONS[index];
        let toggle = nav.querySelector('[data-tm-v4-section="' + endpoint + '"]');
        if (!toggle) {
          const labels = [...nav.querySelectorAll("a,li,span,button")].filter((node) => !node.closest(UI) && clean(node.textContent) === label);
          const anchor = labels.find((node) => ![...node.children].some((child) => clean(child.textContent) === label));
          if (!anchor) {
            problem = "Native section label missing: " + label;
            continue;
          }
          toggle = button("", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const previous = automatic(endpoint), next = !previous;
            try {
              storage2.set(PREFIX + endpoint, next);
              if (storage2.get(PREFIX + endpoint) !== next) throw new Error("Readback failed");
              prefs.set(endpoint, next);
              saveErrors.delete(endpoint);
            } catch {
              saveErrors.add(endpoint);
            }
            refresh();
          });
          toggle.setAttribute("data-tm-v4-section", endpoint);
          anchor.insertAdjacentElement("afterend", toggle);
          anchor.addEventListener("click", () => {
            if (generation) void load(endpoint);
          }, { signal: life.signal });
        }
        const failed = saveErrors.has(endpoint);
        toggle.textContent = failed ? "!" : automatic(endpoint) ? "A" : "L";
        toggle.setAttribute("aria-pressed", String(automatic(endpoint)));
        toggle.title = label + ": " + (failed ? "SAVE FAILED — selection unchanged" : automatic(endpoint) ? "AUTO — loads every search" : "LAZY — click section to load");
        toggle.setAttribute("aria-label", toggle.title);
        const container = document.querySelector('[data-section-type="' + endpoint + '"]');
        const section = generation?.sections.get(endpoint);
        if (!container) continue;
        if (!hidden.has(container)) hidden.set(container, container.hidden);
        container.hidden = !automatic(endpoint) && (!section || section.status === "idle");
        let note = container.querySelector(":scope > [data-tm-v4-read-status]");
        if (!note && section) {
          note = mark(document.createElement("div"));
          note.setAttribute("data-tm-v4-read-status", "");
          note.setAttribute("role", "status");
          container.prepend(note);
        }
        if (note && section) {
          note.replaceChildren();
          if (section.status === "loading") note.textContent = "Loading " + label + "…";
          if (section.status === "partial") note.textContent = section.result.warning || "Partial " + label;
          if (section.status === "error" || endpoint === "inventory" && section.status === "partial") {
            const retry = button(endpoint === "inventory" ? "Retry Inventory" : "Retry " + label, () => void load(endpoint, { force: true }));
            note.append(retry, document.createTextNode(" " + (section.error?.message || section.result.warning)));
          }
        }
      }
    }
    function observeNative() {
      const roots = new Set([findNavigation(), ...document.querySelectorAll("[data-section-type]")].filter(Boolean));
      const replacementRoots = new Set([...roots].map((node) => node.parentElement).filter(Boolean));
      const meaningful = (records) => records.some((record) => !record.target.closest?.(UI) && [...record.addedNodes, ...record.removedNodes].some((node) => !node.matches?.(UI)));
      for (const root of roots) {
        const observer = new window2.MutationObserver((records) => {
          if (meaningful(records)) schedule();
        });
        observer.observe(root, { childList: true, subtree: true });
        observers.push(observer);
      }
      for (const root of replacementRoots) {
        const observer = new window2.MutationObserver((records) => {
          if (meaningful(records)) {
            observers.forEach((item) => item.disconnect());
            observers = [];
            observeNative();
            schedule();
          }
        });
        observer.observe(root, { childList: true });
        observers.push(observer);
      }
    }
    function start() {
      if (life && !life.signal.aborted) return;
      life = new window2.AbortController();
      ready = false;
      problem = "";
      prefs.clear();
      for (const endpoint of FCR_SECTIONS) {
        try {
          const value = storage2.get(PREFIX + endpoint);
          if (typeof value === "boolean") prefs.set(endpoint, value);
        } catch {
          problem = "Section preferences unavailable";
        }
      }
      begin(currentQuery());
      const mount = () => {
        if (!life || life.signal.aborted || ready) return;
        ready = true;
        refresh();
        observeNative();
      };
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true, signal: life.signal });
      else mount();
    }
    function dispose() {
      if (!life || life.signal.aborted) return;
      life.abort();
      generation?.controller.abort();
      for (const section of generation?.sections.values() || []) for (const waiter of [...section.waiters]) waiter.finish(0, "abort");
      observers.forEach((observer) => observer.disconnect());
      observers = [];
      scheduled = false;
      for (const node of owned) node.remove();
      owned.clear();
      for (const [node, previous] of hidden) node.hidden = previous;
      hidden.clear();
      ready = false;
      generation = null;
    }
    const api = Object.freeze({
      start,
      dispose,
      automatic,
      nativeRequest,
      subscribe,
      load,
      mark,
      notify,
      current: () => generation,
      active: active2,
      refresh,
      reader,
      warehouse,
      schedule
    });
    return api;
  }

  // fcr-enrichment.mjs
  var MEASUREMENT_ORIGIN = "https://o0avbo02yl.execute-api.ap-northeast-1.amazonaws.com";

  // measurement-auth.mjs
  var MEASUREMENT_AUTH_KEY = "tm-v4.measurement.auth";
  var SITE = "https://jp.item-measurement.aft.a2z.com";
  var GUARD = Symbol.for("tampermonkey.v4.measurement.capture");
  var failure2 = (code, message, cause) => new FcrReadError(code, message, { cause });
  function normalizeMeasurementToken(value, now = Date.now()) {
    const token = String(value ?? "").trim().replace(/^Bearer\s+/i, "");
    if (token.length > 16384 || token.split(".").length !== 3) return null;
    try {
      const middle = token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
      const binary = atob(middle.padEnd(Math.ceil(middle.length / 4) * 4, "="));
      const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0))));
      const expiresAt = payload.exp * 1e3;
      if (payload.token_use !== "id" || typeof payload.exp !== "number" || !Number.isInteger(payload.exp) || !Number.isFinite(expiresAt) || expiresAt <= now + 1e4) return null;
      return { token, expiresAt };
    } catch {
      return null;
    }
  }
  function authHeader(headers) {
    if (!headers) return "";
    if (typeof headers.get === "function") return headers.get("Authorization") || "";
    const entries = Array.isArray(headers) ? headers : Object.entries(headers);
    return entries.find((entry) => Array.isArray(entry) && /^authorization$/i.test(String(entry[0])))?.[1] || "";
  }
  function nativeMeasurementUrl(value, page2) {
    try {
      const url = new URL(value, page2.location.href);
      return url.origin === MEASUREMENT_ORIGIN && /^\/prod\/measurementEvents\//.test(url.pathname);
    } catch {
      return false;
    }
  }
  function installMeasurementCapture({ page: page2, storage: storage2, now = Date.now }) {
    if (page2.location.origin !== SITE) throw failure2("INPUT", "Measurement capture requires the native Measurement page");
    if (page2[GUARD]) return page2[GUARD];
    const controller = new page2.AbortController(), details = /* @__PURE__ */ new WeakMap();
    const originalFetch = page2.fetch, proto = page2.XMLHttpRequest?.prototype;
    const originalOpen = proto?.open, originalHeader = proto?.setRequestHeader, originalSend = proto?.send;
    const observe = (fn) => {
      try {
        fn();
      } catch {
      }
    };
    function save(raw) {
      if (controller.signal.aborted) return;
      const value = normalizeMeasurementToken(raw, now());
      if (value) storage2.set(MEASUREMENT_AUTH_KEY, JSON.stringify({ ...value, capturedAt: now(), captureId: page2.crypto.randomUUID() }));
    }
    const wrappedFetch = function(...args) {
      const result = Reflect.apply(originalFetch, this, args);
      let raw = "";
      observe(() => {
        const input = args[0], url = typeof input === "string" || input instanceof page2.URL ? String(input) : input?.url;
        if (nativeMeasurementUrl(url, page2)) raw = args[1]?.headers !== void 0 ? authHeader(args[1].headers) : authHeader(input?.headers);
      });
      return result.then((response) => {
        observe(() => {
          if (response.status >= 200 && response.status < 300) save(raw);
        });
        return response;
      });
    };
    const wrappedOpen = function(...args) {
      const result = Reflect.apply(originalOpen, this, args);
      observe(() => details.set(this, { wanted: nativeMeasurementUrl(args[1], page2), token: "" }));
      return result;
    };
    const wrappedHeader = function(...args) {
      const result = Reflect.apply(originalHeader, this, args);
      observe(() => {
        const detail = details.get(this);
        if (detail?.wanted && /^authorization$/i.test(String(args[0]))) detail.token = String(args[1]);
      });
      return result;
    };
    const wrappedSend = function(...args) {
      const detail = details.get(this);
      const done = () => observe(() => {
        if (this.status >= 200 && this.status < 300) save(detail.token);
      });
      if (detail?.wanted) this.addEventListener("loadend", done, { once: true, signal: controller.signal });
      try {
        return Reflect.apply(originalSend, this, args);
      } catch (error) {
        this.removeEventListener("loadend", done);
        throw error;
      }
    };
    function dispose() {
      if (controller.signal.aborted) return;
      controller.abort();
      if (page2.fetch === wrappedFetch) page2.fetch = originalFetch;
      if (proto?.open === wrappedOpen) proto.open = originalOpen;
      if (proto?.setRequestHeader === wrappedHeader) proto.setRequestHeader = originalHeader;
      if (proto?.send === wrappedSend) proto.send = originalSend;
      if (page2[GUARD] === dispose) delete page2[GUARD];
    }
    if (typeof originalFetch === "function") page2.fetch = wrappedFetch;
    if (typeof originalOpen === "function" && typeof originalHeader === "function" && typeof originalSend === "function") {
      proto.open = wrappedOpen;
      proto.setRequestHeader = wrappedHeader;
      proto.send = wrappedSend;
    }
    page2[GUARD] = dispose;
    return dispose;
  }

  // master-entry.mjs
  var VERSION = "0.1.0";
  var page = typeof unsafeWindow === "object" ? unsafeWindow : window;
  var storage = { get: (key, fallback) => GM_getValue(key, fallback), set: (key, value) => GM_setValue(key, value) };
  var guard = Symbol.for("tampermonkey.v4.master.installer");
  if (!page[guard]) {
    let start = function() {
      if (location.origin === "https://jp.item-measurement.aft.a2z.com") {
        stop = installMeasurementCapture({ page, storage });
        return;
      }
      if (!/\/[A-Z0-9-]{2,12}\/results(?:\/|$)/.test(location.pathname) || /^#(?:fcr-tote-checker|iss-console)/.test(location.hash)) return;
      const runtime = createMasterRuntime({ window, page, storage, fetch: page.fetch.bind(page) });
      runtime.start();
      watchNativeAjax(page, () => runtime);
      stop = () => runtime.dispose();
    };
    page[guard] = { version: VERSION };
    let stop = () => {
    };
    start();
    window.addEventListener("pagehide", () => stop());
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) start();
    });
    window.addEventListener("hashchange", () => {
      stop();
      start();
    });
    window.addEventListener("popstate", () => {
      stop();
      start();
    });
  }
})();
