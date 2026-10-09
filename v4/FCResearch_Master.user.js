// ==UserScript==
// @name         V4 FCResearch Master
// @namespace    https://github.com/1Sirkkris/tampermonkey-v4
// @version      0.1.5
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

  // master-runtime.mjs
  var MASTER_VERSION = "0.1.3";
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
      registry.watch();
      return registry;
    }
    registry = { getRuntime, attached: /* @__PURE__ */ new WeakSet(), loaders: /* @__PURE__ */ new WeakSet(), restorers: /* @__PURE__ */ new Set(), renderers: /* @__PURE__ */ new Map() };
    page2[registryKey] = registry;
    const identify = (options) => registry.getRuntime()?.nativeRequest(options);
    function attach(jq) {
      if (typeof jq?.ajaxTransport !== "function" || typeof jq.ajaxPrefilter !== "function") return false;
      if (registry.attached.has(jq)) return true;
      registry.attached.add(jq);
      registry.jq = jq;
      jq.ajaxPrefilter((options, original, xhr) => {
        const request = identify(options);
        if (!request) return;
        registry.getRuntime().captureRenderer(request, jq, xhr, original);
        if (!registry.getRuntime().automatic(request.endpoint, request.query)) {
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
      registry.restore();
      return true;
    }
    function attachLoader(loader) {
      if (typeof loader?.when !== "function") return false;
      if (typeof loader.now === "function") loader.now("jQuery").execute(attach);
      if (!registry.loaders.has(loader)) {
        registry.loaders.add(loader);
        loader.when("jQuery").execute("tampermonkey-v4-master-native", attach);
      }
      return true;
    }
    function watchProperty(key, accept) {
      if (accept(page2[key])) return;
      const descriptor = Object.getOwnPropertyDescriptor(page2, key);
      if (!descriptor || descriptor.configurable && "value" in descriptor) {
        let value = descriptor?.value;
        const getter = () => value;
        const setter = (next) => {
          value = next;
          accept(next);
        };
        Object.defineProperty(page2, key, { configurable: true, enumerable: descriptor?.enumerable ?? true, get: getter, set: setter });
        const restore = () => {
          if (Object.getOwnPropertyDescriptor(page2, key)?.get === getter) {
            if (!descriptor && value === void 0) delete page2[key];
            else Object.defineProperty(page2, key, { configurable: true, enumerable: descriptor?.enumerable ?? true, writable: descriptor?.writable ?? true, value });
          }
          registry.restorers.delete(restore);
        };
        registry.restorers.add(restore);
      }
    }
    registry.restore = () => {
      for (const restore of [...registry.restorers]) restore();
      if (registry.domReady) page2.document.removeEventListener("DOMContentLoaded", registry.domReady);
      registry.domReady = null;
    };
    registry.watch = () => {
      if (attach(page2.jQuery || registry.jq)) {
        registry.restore();
        return;
      }
      watchProperty("jQuery", attach);
      attachLoader(page2.AmazonUIPageJS || page2.P);
      if (registry.jq) {
        registry.restore();
        return;
      }
      if (!registry.domReady && !registry.jq) {
        registry.domReady = () => attachLoader(page2.AmazonUIPageJS || page2.P);
        if (page2.document.readyState === "loading") page2.document.addEventListener("DOMContentLoaded", registry.domReady, { once: true });
        else registry.domReady();
      }
    };
    registry.watch();
    return registry;
  }
  function createMasterRuntime({ window: window2, page: page2 = window2, storage: storage2, fetch, onRender = () => {
  }, onRefresh = () => {
  }, onReset = () => {
  }, onDispose = () => {
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
    function active3(gen) {
      return life && !life.signal.aborted && generation === gen && !gen.controller.signal.aborted && route();
    }
    function preferred(endpoint) {
      return prefs.get(endpoint) ?? ["product", "inventory"].includes(endpoint);
    }
    function automatic(endpoint, query = generation?.query) {
      return generation && generation.query === query ? generation.automatic.get(endpoint) : preferred(endpoint);
    }
    function begin(query) {
      if (generation?.query === query && !generation.controller.signal.aborted) return generation;
      if (generation) {
        generation.controller.abort();
        for (const section of generation.sections.values()) for (const waiter of [...section.waiters]) waiter.finish(0, "abort");
        onReset();
      }
      generation = { query, controller: new window2.AbortController(), sections: /* @__PURE__ */ new Map(), automatic: new Map(FCR_SECTIONS.map((endpoint) => [endpoint, preferred(endpoint)])) };
      const templates = page2[registryKey]?.renderers;
      for (const [endpoint, record] of templates || []) {
        if (record.request.query !== query || !record.node.isConnected || placeholder(endpoint) !== record.node) {
          templates.delete(endpoint);
          continue;
        }
        const section = state(endpoint, generation);
        section.options = record.request.options;
        section.renderer = bindRenderer(record, section, generation);
        generation.recovered = true;
      }
      return generation;
    }
    function state(endpoint, gen = generation) {
      if (!gen.sections.has(endpoint)) gen.sections.set(endpoint, { endpoint, visible: false, status: "idle", result: null, error: null, promise: null, waiters: /* @__PURE__ */ new Set(), options: {} });
      return gen.sections.get(endpoint);
    }
    const placeholder = (endpoint) => document.querySelector('.section-placeholder[data-section-type="' + endpoint + '"]') || document.querySelector('[data-section-type="' + endpoint + '"]');
    const nativeStatus = (endpoint) => document.querySelector("#sections-list > #" + endpoint + "-status");
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
      const allowed2 = match[1] === "inventory-history" ? ["s", "startSearchDateString", "endSearchDateString", "dateStringFormat"] : ["s"];
      if (!query || [...fields.keys()].some((key) => !allowed2.includes(key))) return null;
      if (fields.has("dateStringFormat") && fields.get("dateStringFormat") !== "MM/dd/yyyy") return null;
      const optionsForRead = fields.has("startSearchDateString") || fields.has("endSearchDateString") ? { startDate: fields.get("startSearchDateString"), endDate: fields.get("endSearchDateString") } : {};
      return { endpoint: match[1], query, options: optionsForRead };
    }
    function captureRenderer(request, jq, xhr, original) {
      const node = placeholder(request.endpoint);
      const keys = Object.keys(original || {}).sort().join(",");
      if (keys !== "data,dataType,type,url" || original.type !== "POST" || original.dataType !== "html" || !node?.matches(".section-placeholder") || !nativeStatus(request.endpoint) || typeof xhr.done !== "function") return;
      const gen = begin(request.query), section = state(request.endpoint, gen), done = xhr.done;
      const signature = JSON.stringify(request.options);
      const restore = () => {
        if (xhr.done === capture) xhr.done = done;
      };
      function capture(...callbacks) {
        if (!callbacks.some((callback2) => typeof callback2 === "function" || Array.isArray(callback2))) return done.apply(this, callbacks);
        restore();
        if (callbacks.length !== 1 || typeof callbacks[0] !== "function") return done.apply(this, callbacks);
        const callback = callbacks[0];
        const record = { request, jq, node, callback, context: original, signature };
        page2[registryKey]?.renderers.set(request.endpoint, record);
        const renderer = bindRenderer(record, section, gen);
        section.renderer = renderer;
        return done.call(this, function(...args) {
          if (renderer.valid()) callback.apply(this, args);
        });
      }
      xhr.done = capture;
      window2.queueMicrotask(restore);
    }
    function bindRenderer({ request, jq, node, callback, context, signature }, section, gen) {
      const renderer = {
        valid: () => active3(gen) && section.renderer === renderer && JSON.stringify(section.options) === signature && placeholder(request.endpoint) === node && node.isConnected,
        render(html) {
          if (!renderer.valid()) throw new Error("Native section changed — repeat the native search");
          for (const table of node.querySelectorAll("table[id]")) {
            if (jq.fn.dataTable?.fnIsDataTable?.(table)) jq(table).dataTable().fnDestroy();
          }
          const status = nativeStatus(request.endpoint);
          for (const link of [...status?.querySelectorAll("a") || []].reverse()) {
            if (link.getAttribute("href") === "#" + request.endpoint + "-nav") link.replaceWith(...link.childNodes);
          }
          callback.call(context, html);
        }
      };
      return renderer;
    }
    function subscribe(request, complete) {
      const gen = begin(request.query), section = state(request.endpoint, gen);
      if (JSON.stringify(section.options) !== JSON.stringify(request.options)) {
        section.controller?.abort();
        section.result = null;
        section.status = "idle";
        section.promise = null;
        section.renderer = null;
        section.renderedResult = null;
        page2[registryKey]?.renderers.delete(request.endpoint);
        for (const waiter2 of [...section.waiters]) waiter2.finish(0, "abort");
      }
      section.options = request.options;
      const waiter = { finish(status, statusText, responses) {
        if (!section.waiters.delete(waiter)) return;
        try {
          complete(status, statusText, responses, "Content-Type: text/html; charset=UTF-8\r\n");
        } catch (error) {
          if (active3(gen)) {
            section.status = "error";
            section.error = error;
            notify("Native " + MASTER_LABELS[FCR_SECTIONS.indexOf(request.endpoint)] + " rendering failed: " + clean(error.message));
          }
        }
      } };
      section.waiters.add(waiter);
      if (automatic(request.endpoint) || section.visible) void load(request.endpoint, { gen });
      schedule();
      return () => {
        if (section.waiters.delete(waiter) && !section.waiters.size && active3(gen)) {
          section.nativeAborted = true;
          section.status = "error";
          section.error = new Error("Native read cancelled — retry this section");
          schedule();
        }
      };
    }
    async function load(endpoint, { gen = generation, force = false, render = true } = {}) {
      if (!gen || !active3(gen)) return null;
      const section = state(endpoint, gen);
      if (render) {
        section.visible = true;
        section.nativeAborted = false;
      }
      if (section.promise) return section.promise;
      if (!force && section.result) {
        if (section.visible && !section.nativeAborted) {
          deliver(section, section.result);
          if (section.status !== "error") onRender({ endpoint, result: section.result, generation: gen, signal: gen.controller.signal, reader, runtime: api });
          schedule();
        }
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
          if (!active3(gen) || controller.signal.aborted) return null;
          section.result = result;
          section.status = result.complete ? "ready" : "partial";
          if (section.visible && !section.nativeAborted) {
            deliver(section, result);
            if (section.status !== "error") onRender({ endpoint, result, generation: gen, signal: controller.signal, reader, runtime: api });
          } else if (section.nativeAborted) {
            section.status = "error";
            section.error = new Error("Native read cancelled — retry this section");
          }
          return result;
        } catch (error) {
          if (!active3(gen) || controller.signal.aborted || error.code === "CANCELLED") return null;
          section.error = error;
          section.status = "error";
          for (const waiter of [...section.waiters]) waiter.finish(error.status || 502, error.code || "error");
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
    function deliver(section, result) {
      section.status = result.complete ? "ready" : "partial";
      section.error = null;
      if (section.waiters.size) {
        for (const waiter of [...section.waiters]) waiter.finish(200, "success", { text: result.html });
      } else if (section.renderedResult !== result) paint(section.endpoint, section);
      if (section.status !== "error") section.renderedResult = result;
    }
    function paint(endpoint, section) {
      try {
        if (!section.renderer) throw new Error("Native rendering callback unavailable — repeat the native search");
        section.renderer.render(section.result.html);
      } catch (error) {
        section.status = "error";
        section.error = error;
        notify("Native " + MASTER_LABELS[FCR_SECTIONS.indexOf(endpoint)] + ": " + clean(error.message));
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
      const native = document.querySelector("#sections-list");
      if (native) return native;
      const heading = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6,strong,span")].find((node) => clean(node.textContent).toLowerCase() === "sections");
      for (let host = heading?.parentElement; host && host !== document.body; host = host.parentElement) {
        const texts = [...host.querySelectorAll("a,button,li,span")].filter((node) => !node.closest(UI)).map((node) => clean(node.textContent));
        if (MASTER_LABELS.filter((label) => texts.some((text2) => text2.toLowerCase() === label.toLowerCase())).length >= 8) return host;
      }
      return null;
    }
    function refresh() {
      if (!ready || !route()) return;
      for (const node of owned) if (!node.isConnected) owned.delete(node);
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
          const labels = [...nav.querySelectorAll("a,li,span,button")].filter((node) => !node.closest(UI) && clean(node.textContent).toLowerCase() === label.toLowerCase());
          const row = nativeStatus(endpoint);
          const anchor = row || labels.find((node) => ![...node.children].some((child) => clean(child.textContent).toLowerCase() === label.toLowerCase()));
          if (!anchor) {
            problem = "Native section label missing: " + label;
            continue;
          }
          toggle = button("", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const previous = preferred(endpoint), next = !previous;
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
          if (row) row.append(toggle);
          else anchor.insertAdjacentElement("afterend", toggle);
          anchor.addEventListener("click", (event) => {
            if (!event.target.closest(UI) && generation) void load(endpoint);
          }, { signal: life.signal });
        }
        const failed = saveErrors.has(endpoint);
        toggle.textContent = failed ? "!" : preferred(endpoint) ? "A" : "L";
        toggle.setAttribute("aria-pressed", String(preferred(endpoint)));
        toggle.title = label + ": " + (failed ? "SAVE FAILED — selection unchanged" : preferred(endpoint) ? "AUTO — loads every search" : "LAZY — click section to load");
        toggle.setAttribute("aria-label", toggle.title);
        const container = placeholder(endpoint);
        const section = generation?.sections.get(endpoint);
        if (!container) continue;
        if (!hidden.has(container)) hidden.set(container, container.hidden);
        container.hidden = !automatic(endpoint) && !section?.visible;
        const native = nativeStatus(endpoint);
        if (native && section) {
          native.classList.toggle("loading", section.status === "loading" && section.visible);
          native.classList.toggle("failure", section.status === "error");
        }
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
      onRefresh(api);
    }
    function observeNative() {
      const roots = new Set([findNavigation(), ...FCR_SECTIONS.map(placeholder)].filter(Boolean));
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
      document.addEventListener("submit", (event) => {
        const input = event.target.querySelector?.('#search,input[name="s"]');
        if (input) {
          begin(clean(input.value));
          schedule();
        }
      }, { capture: true, signal: life.signal });
      document.addEventListener("input", (event) => {
        if (event.target.matches?.('#search,input[name="s"]') && !clean(event.target.value)) {
          begin("");
          schedule();
        }
      }, { signal: life.signal });
      const mount = () => {
        if (!life || life.signal.aborted || ready) return;
        ready = true;
        refresh();
        observeNative();
        if (generation?.recovered) {
          for (const endpoint of generation.sections.keys()) if (automatic(endpoint)) void load(endpoint);
        }
      };
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true, signal: life.signal });
      else mount();
    }
    function dispose() {
      if (!life || life.signal.aborted) return;
      life.abort();
      generation?.controller.abort();
      onDispose();
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
      captureRenderer,
      subscribe,
      load,
      mark,
      notify,
      current: () => generation,
      active: active3,
      refresh,
      reader,
      warehouse,
      schedule
    });
    return api;
  }

  // fcr-enrichment.mjs
  var FCR_ENRICHMENT_VERSION = "0.1.1";
  var MEASUREMENT_ORIGIN = "https://o0avbo02yl.execute-api.ap-northeast-1.amazonaws.com";
  var BIN_URL = "https://aft-poirot-website-nrt.nrt.proxy.amazon.com/api/scanitem";
  var PANDASH_URL = "https://pandash.amazon.com/GridServlet";
  var clean2 = (value) => String(value ?? "").trim();
  var upper = (value) => clean2(value).toUpperCase();
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
    uuid: uuid2 = () => crypto.randomUUID(),
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
      const asin = upper(asinValue);
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
      const matches = payload.rows.filter((row) => upper(row?.asin) === asin);
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
      const container = clean2(containerValue), item = upper(itemValue);
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
          requestId: "amzn1.fc.v1.common.request-id.v1.AFTPoirotWebsite." + uuid2(),
          tool: "V3"
        })
      });
      if (!Array.isArray(payload.items)) throw fail("SCHEMA", "Native bin item rows are missing");
      const wanted = /* @__PURE__ */ new Set([item, ...verifiedAliases.map(upper)]), matches = [];
      for (const row of payload.items) {
        if (!row || typeof row !== "object") throw fail("SCHEMA", "Native bin item row is invalid");
        if (/^X[A-Z0-9]{9}$/.test(item) && row.skuDetail?.fnSku && upper(row.skuDetail.fnSku) !== item) continue;
        const codes = [row.scannableId, row.value, row.scannedBarcode, row.skuDetail?.fnSku, row.skuDetail?.asin, row.skuDetail?.fcSku].map(upper).filter(Boolean);
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
      const identifier2 = upper(fnsku || asin), identifierType = fnsku ? "FNSKU" : "ASIN";
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
          if (upper(event.measurementSource) === "MADCAT" && instant >= after && instant <= before) positive = true;
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

  // measurement-auth.mjs
  var MEASUREMENT_AUTH_VERSION = "0.1.1";
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
      return url.origin === MEASUREMENT_ORIGIN && /^\/prod\/measurementEvents\/[A-Z0-9]{10}\/(?:FNSKU|ASIN)$/.test(url.pathname);
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
      observe(() => save(raw));
      return result;
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
      const result = Reflect.apply(originalSend, this, args);
      if (detail?.wanted) observe(() => save(detail.token));
      return result;
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
  function createMeasurementAuth({ window: window2, storage: storage2, now = Date.now, timeoutMs = 1e4, onEvidence = () => {
  } }) {
    if (!window2?.document || !storage2 || !["get", "listen", "remove"].every((key) => typeof storage2[key] === "function") || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 3e4) throw failure2("INPUT", "Measurement auth configuration is invalid");
    function evidence2(data) {
      try {
        onEvidence({ type: "fcr.auth", script: "MEASUREMENT AUTH", version: MEASUREMENT_AUTH_VERSION, intent: "read", data: { endpoint: "measurement-auth", ...data } });
      } catch {
      }
    }
    function read() {
      try {
        const raw = storage2.get(MEASUREMENT_AUTH_KEY, "null");
        const stored = JSON.parse(raw);
        return stored ? normalizeMeasurementToken(stored.token, now()) : null;
      } catch (cause) {
        throw failure2("STORAGE", "Measurement auth storage cannot be read", cause);
      }
    }
    function loginUrl(identifier2) {
      const code = String(identifier2 ?? "").trim().toUpperCase();
      if (!/^[A-Z0-9]{10}$/.test(code)) throw failure2("INPUT", "Measurement login identifier is invalid");
      const url = new URL(SITE + "/item/" + code);
      url.searchParams.set("tmV4MeasurementAuth", "1");
      return url.href;
    }
    async function acquire(identifier2, { signal, force = false, previousToken } = {}) {
      const url = loginUrl(identifier2);
      if (signal?.aborted) throw failure2("CANCELLED", "Measurement acquisition cancelled", signal.reason);
      const cached = read();
      if (!force && cached && cached.token !== previousToken) {
        evidence2({ outcome: "cached" });
        return cached;
      }
      let baseline;
      try {
        baseline = force ? storage2.get(MEASUREMENT_AUTH_KEY, "null") : null;
      } catch (cause) {
        throw failure2("STORAGE", "Measurement auth storage cannot be read", cause);
      }
      return new Promise((resolve, reject) => {
        let listener = null, frame = null, timer = null, settled = false;
        const cleanup = () => {
          if (timer != null) window2.clearTimeout(timer);
          if (listener != null) {
            try {
              storage2.remove(listener);
            } catch {
            }
          }
          signal?.removeEventListener("abort", cancelled);
          frame?.remove();
        };
        const finish = (error, value = null) => {
          if (settled) return;
          settled = true;
          cleanup();
          evidence2({ outcome: error ? "failed" : value ? "acquired" : "unavailable", code: error?.code, stage: "native-frame", elapsedMs: Math.max(0, now() - started) });
          if (error) reject(error);
          else resolve(value);
        };
        const cancelled = () => finish(failure2("CANCELLED", "Measurement acquisition cancelled", signal.reason));
        const changed = () => {
          if (settled) return;
          try {
            if (force && storage2.get(MEASUREMENT_AUTH_KEY, "null") === baseline) return;
            const value = read();
            if (value && value.token !== previousToken) finish(null, value);
          } catch (error) {
            finish(error);
          }
        };
        const started = now();
        signal?.addEventListener("abort", cancelled, { once: true });
        try {
          listener = storage2.listen(MEASUREMENT_AUTH_KEY, changed);
          if (settled) {
            cleanup();
            return;
          }
          if (signal?.aborted) {
            cancelled();
            return;
          }
          if (!force) changed();
          if (settled) return;
          timer = window2.setTimeout(() => finish(null), timeoutMs);
          frame = window2.document.createElement("iframe");
          frame.dataset.tmV4Auth = "measurement";
          frame.tabIndex = -1;
          frame.setAttribute("aria-hidden", "true");
          frame.setAttribute("inert", "");
          frame.style.cssText = "position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;opacity:0;pointer-events:none;border:0";
          frame.src = url;
          if (force) frame.src = url + "&tmV4MeasurementRefresh=" + encodeURIComponent(now());
          evidence2({ outcome: "started", stage: "native-frame", renewal: force });
          (window2.document.body || window2.document.documentElement).append(frame);
        } catch (cause) {
          finish(cause instanceof FcrReadError ? cause : failure2("AUTH_REQUIRED", "Measurement acquisition could not start", cause));
        }
      });
    }
    function watch(callback, { signal } = {}) {
      if (typeof callback !== "function") throw failure2("INPUT", "Measurement auth callback is invalid");
      if (signal?.aborted) return () => {
      };
      let listener = null, stopped = false;
      const stop = () => {
        stopped = true;
        if (listener != null) {
          try {
            storage2.remove(listener);
          } catch {
          }
        }
        signal?.removeEventListener("abort", stop);
      };
      signal?.addEventListener("abort", stop, { once: true });
      try {
        listener = storage2.listen(MEASUREMENT_AUTH_KEY, () => {
          if (stopped) return;
          try {
            if (!read()) return;
            stop();
            callback();
          } catch {
            stop();
          }
        });
        if (stopped || signal?.aborted) stop();
      } catch {
        stop();
      }
      return stop;
    }
    return Object.freeze({ read, acquire, loginUrl, watch });
  }

  // master-features.mjs
  var clean3 = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  var upper2 = (value) => clean3(value).toUpperCase();
  var UI2 = "[data-tm-v4-master]";
  var STYLE = `
[data-tm-v4-section]{margin-left:5px;padding:0 4px;font-weight:bold}
[data-tm-v4-master-status]{display:block;font-size:11px;margin:4px 0}
[data-tm-v4-badge]{display:inline-block;margin-left:6px;padding:2px 6px;border:1px solid #666;border-radius:5px;background:#fff;color:#111;font-weight:bold;font-size:12px}
[data-tm-v4-badge][data-state="yes"],[data-tm-v4-property="true"]{background:#00875a;color:#fff}
[data-tm-v4-badge][data-state="no"],[data-tm-v4-property="false"]{background:#bb1637;color:#fff}
[data-tm-v4-badge][data-state="history"],[data-tm-v4-badge][data-state="error"],[data-tm-v4-property="unknown"]{background:#ffe299;color:#111}
[data-tm-v4-property]{font-weight:bold}
[data-tm-v4-po~="unfilled"]{background:#ffe299;font-weight:bold}
[data-tm-v4-po~="cancelled"]{background:#bb1637;color:#fff;font-weight:bold}
[data-tm-v4-po~="band"]{box-shadow:inset 0 0 0 2px #bb1637}
[data-tm-v4-po~="old"]{background:#f6b6c2;color:#111;font-weight:bold}
[data-tm-v4-label-action]{cursor:pointer;text-decoration:underline dotted}
[data-tm-v4-quantity]{margin-left:6px;width:4.5em;font-size:12px}
`;
  var sydney = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  function nextSydneyCutoff(now) {
    const day = new Date(now);
    const midnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
    const candidates = [];
    for (let offset = 0; offset < 3; offset++) for (const hour of [7, 8]) {
      const candidate = midnight + offset * 864e5 + hour * 36e5;
      if (candidate <= now) continue;
      const parts = Object.fromEntries(sydney.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]));
      if (parts.hour === "18" && parts.minute === "00") candidates.push(candidate);
    }
    if (!candidates.length) throw new Error("Sydney cache cutoff unavailable");
    return Math.min(...candidates);
  }
  function sizeCandidates(rows, item, aliases = []) {
    const wanted = new Set([item, ...aliases].map(upper2));
    const rank = (value) => /^(?:tsX|csX)[A-Za-z0-9]+$/i.test(value) ? 0 : /^P-\d-/i.test(value) ? 1 : 2;
    const sorted = rows.filter((row) => row.container && (!/^X[A-Z0-9]{9}$/.test(upper2(item)) || !row.fnsku || upper2(row.fnsku) === upper2(item)) && [row.asin, row.fnsku, row.fcsku, row.lpn].some((code) => wanted.has(upper2(code)))).sort((a, b) => rank(a.container) - rank(b.container) || b.qty - a.qty);
    return [...new Map(sorted.map((row) => [upper2(row.container), row.container])).values()].slice(0, 3);
  }
  function createMadcatCache({ storage: storage2, now = Date.now }) {
    const key = "tm-v4.master.madcat.cache", entries = /* @__PURE__ */ new Map();
    function valid([identity, entry]) {
      return /^(?:ASIN|FNSKU):[A-Z0-9]{10}$/.test(identity) && entry && Number.isFinite(entry.expiresAt) && entry.expiresAt > now() && entry.expiresAt <= (entry.value?.madcat ? nextSydneyCutoff(now()) : now() + 3e5) && typeof entry.value?.madcat === "boolean" && entry.value.madcatSource === "raw" && entry.value.complete === true && entry.value.windowDays === 30;
    }
    try {
      const stored = storage2.get(key, []);
      if (Array.isArray(stored)) {
        for (const pair of stored.slice(-200)) if (Array.isArray(pair) && pair.length === 2 && valid(pair)) entries.set(...pair);
      }
    } catch {
    }
    function get(identity) {
      const entry = entries.get(identity);
      if (entry && valid([identity, entry])) return { ...entry.value, source: "cache" };
      entries.delete(identity);
      return null;
    }
    function put(identity, value) {
      if (value.madcatSource !== "raw" || !value.complete || value.windowDays !== 30 || typeof value.madcat !== "boolean") return;
      const entry = {
        expiresAt: value.madcat ? nextSydneyCutoff(now()) : now() + 3e5,
        value: { madcat: value.madcat, madcatSource: "raw", complete: true, windowDays: 30 }
      };
      if (!valid([identity, entry])) return;
      entries.delete(identity);
      entries.set(identity, entry);
      for (const pair of entries) if (!valid(pair)) entries.delete(pair[0]);
      while (entries.size > 200) entries.delete(entries.keys().next().value);
      try {
        storage2.set(key, [...entries]);
      } catch {
      }
    }
    return Object.freeze({ get, put });
  }
  function productPanel(document, verified) {
    if (!verified) return null;
    const table = document.querySelector('[data-section-type="product"] table');
    if (!table) return null;
    const entries = /* @__PURE__ */ new Map();
    for (const row of table.rows) {
      const label = row.querySelector("th"), value = row.querySelector("td");
      if (!label || !value) continue;
      const clone = value.cloneNode(true);
      clone.querySelectorAll(UI2).forEach((node) => node.remove());
      entries.set(upper2(label.textContent), { label, value, text: clean3(clone.textContent) });
    }
    const declared = ["ASIN", "ISBN", "FNSKU", "FCSKU"].map((field) => upper2(entries.get(field)?.text)).filter(Boolean);
    if (!declared.length || declared.some((code) => !verified.aliases.includes(code))) return null;
    if (clean3(entries.get("TITLE")?.text) !== clean3(verified.title)) return null;
    return { table, entries, product: verified };
  }
  function createMasterFeatures({ window: window2, page: page2 = window2, runtime, enrichment, auth, storage: storage2, now = Date.now, onEvidence = () => {
  } }) {
    const document = window2.document, lifetime = new window2.AbortController();
    const cache = createMadcatCache({ storage: storage2, now });
    const hazCache = /* @__PURE__ */ new Map(), states = /* @__PURE__ */ new WeakMap(), modified = /* @__PURE__ */ new Map(), nodes = /* @__PURE__ */ new Set();
    let style;
    const isCurrent = (gen) => !lifetime.signal.aborted && runtime.active(gen);
    const mark = (node) => {
      runtime.mark(node);
      nodes.add(node);
      return node;
    };
    function setAttribute(node, name, value) {
      if (!modified.has(node)) modified.set(node, /* @__PURE__ */ new Map());
      const attributes = modified.get(node);
      if (!attributes.has(name)) attributes.set(name, node.getAttribute(name));
      node.setAttribute(name, value);
    }
    function state(gen) {
      if (!states.has(gen)) states.set(gen, { size: { status: "idle", serial: 0 }, madcat: { status: "idle", serial: 0 }, haz: /* @__PURE__ */ new Map(), jobs: [], workers: 0 });
      return states.get(gen);
    }
    function ownButton(host, name, label, action) {
      let node = host.querySelector(':scope > [data-tm-v4-badge="' + name + '"]');
      if (!node) {
        node = mark(document.createElement("button"));
        node.type = "button";
        node.setAttribute("data-tm-v4-badge", name);
        host.append(node);
      }
      if (node.textContent !== label) node.textContent = label;
      node.onclick = action;
      return node;
    }
    async function size(gen, force = false) {
      const product = gen.sections.get("product")?.result?.product;
      if (!product || !isCurrent(gen)) return;
      const current = state(gen).size;
      if (current.status === "loading" || !force && current.status !== "idle") return;
      const serial = ++current.serial;
      current.status = "loading";
      current.value = "";
      current.error = "";
      runtime.schedule();
      try {
        const inventory = await runtime.load("inventory", { gen, render: false });
        if (!isCurrent(gen) || current.serial !== serial) return;
        if (!inventory) throw new Error("Inventory read unavailable");
        const item = product.fnsku || product.asin || product.isbn, candidates = sizeCandidates(inventory.rows, item, product.aliases);
        let lastError;
        for (const container of candidates) {
          let result;
          try {
            result = await enrichment.binDescription(container, item, { signal: gen.controller.signal, verifiedAliases: product.aliases });
          } catch (error) {
            if (error.code === "CANCELLED" || error.code === "AUTH_REQUIRED") throw error;
            lastError = error;
            continue;
          }
          if (!isCurrent(gen) || current.serial !== serial) return;
          if (result.complete && result.size) {
            current.value = result.size;
            break;
          }
        }
        if (!current.value && lastError) throw lastError;
        current.status = current.value ? "ready" : "unavailable";
      } catch (error) {
        if (!isCurrent(gen) || current.serial !== serial) return;
        current.status = "error";
        current.error = clean3(error.message);
      }
      if (isCurrent(gen)) runtime.schedule();
    }
    async function madcat(gen, force = false) {
      const product = gen.sections.get("product")?.result?.product;
      if (!product || !isCurrent(gen)) return;
      const current = state(gen).madcat;
      if (current.status === "loading" || !force && current.status !== "idle") return;
      current.stopAuth?.();
      current.stopAuth = null;
      const code = upper2(product.fnsku || product.asin || product.isbn), identity = (product.fnsku ? "FNSKU:" : "ASIN:") + code;
      const serial = ++current.serial;
      current.status = "loading";
      current.error = "";
      runtime.schedule();
      try {
        const cached = !force && cache.get(identity);
        current.authPending = !cached && typeof auth.read === "function" && !auth.read();
        const result = cached || await enrichment.recentMadcat({ fnsku: product.fnsku, asin: product.asin || product.isbn }, { signal: gen.controller.signal });
        if (!isCurrent(gen) || current.serial !== serial) return;
        if (result.madcatSource === "raw" && (result.complete !== true || result.windowDays !== 30 || typeof result.madcat !== "boolean")) throw new Error("Incomplete raw Measurement result");
        if (!["raw", "history"].includes(result.madcatSource) || result.madcatSource === "history" && result.madcat !== null && typeof result.madcat !== "boolean") throw new Error("Unrecognized Measurement provenance");
        current.result = result;
        current.status = "ready";
        cache.put(identity, result);
        if (result.madcatSource === "history" && result.authRequired && !current.autoAuthRetried) {
          const recover = () => {
            if (!isCurrent(gen) || current.serial !== serial || current.autoAuthRetried) return;
            current.autoAuthRetried = true;
            current.stopAuth?.();
            current.stopAuth = null;
            void madcat(gen, true);
          };
          current.stopAuth = auth.watch?.(recover, { signal: gen.controller.signal });
          if (result.fallbackReason === "measurement-login-required" && auth.read?.()) recover();
        }
      } catch (error) {
        if (!isCurrent(gen) || current.serial !== serial) return;
        current.status = "error";
        current.error = clean3(error.message);
      }
      if (isCurrent(gen)) runtime.schedule();
    }
    function queueHaz(gen, asin, force = false) {
      if (!/^B[A-Z0-9]{9}$/.test(asin) || !isCurrent(gen)) return;
      const group = state(gen), previous = group.haz.get(asin);
      if (previous?.status === "loading" || !force && previous) return;
      const cached = hazCache.get(asin);
      if (!force && cached && cached.expiresAt > now()) {
        group.haz.set(asin, { ...cached.value });
        return;
      }
      group.haz.set(asin, { status: "loading" });
      group.jobs.push(asin);
      pump(gen);
    }
    function pump(gen) {
      const group = state(gen);
      while (isCurrent(gen) && group.jobs.length && group.workers < 4) {
        const asin = group.jobs.shift();
        group.workers++;
        (async () => {
          let value;
          try {
            const result = await enrichment.hazmat(asin, { signal: gen.controller.signal });
            value = { status: "ready", result };
          } catch (error) {
            value = { status: "error", error: clean3(error.message) };
          } finally {
            group.workers--;
          }
          if (!isCurrent(gen)) return;
          group.haz.set(asin, value);
          hazCache.delete(asin);
          hazCache.set(asin, { value, expiresAt: now() + (value.result?.complete ? 216e5 : 6e4) });
          while (hazCache.size > 500) hazCache.delete(hazCache.keys().next().value);
          pump(gen);
          runtime.schedule();
        })();
      }
    }
    function river(gen) {
      if (!isCurrent(gen)) return;
      const url = new URL("https://river.amazon.com/" + runtime.warehouse + "/workflows");
      for (const [key, value] of Object.entries({ buildingType: "fc", workflowId: "undefined", q0: "3654ec14-7232-4f65-84c3-87927cdb4d0c", q1: "f2738dec-7f6f-4c2e-a85a-db7228de25f1", id: "f2738dec-7f6f-4c2e-a85a-db7228de25f1" })) url.searchParams.set(key, value);
      const tab = window2.open(url.href, "_blank");
      if (tab) tab.opener = null;
      else runtime.notify("RIVER popup blocked — allow popups and retry");
      try {
        onEvidence({ type: "fcr.handoff", script: "FCR MASTER", version: MASTER_VERSION, intent: "read", data: { action: "river.open", warehouse: runtime.warehouse } });
      } catch {
      }
    }
    function paintHaz(host, asin, gen, product = false) {
      queueHaz(gen, asin);
      const status = state(gen).haz.get(asin);
      if (!status) return;
      const hazmat = status.result?.complete ? status.result.hazmat : null;
      const label = status.status === "loading" ? "CHECK…" : status.status === "error" ? "ERROR" : hazmat ? "L" + hazmat.level : "N/A";
      const canRiver = product && status.status === "ready" && (!hazmat || hazmat.level === 0);
      const badge = ownButton(host, "hazmat", label, () => canRiver ? river(gen) : (queueHaz(gen, asin, true), runtime.schedule()));
      badge.disabled = status.status === "loading";
      badge.dataset.state = status.status === "error" ? "error" : "hazmat";
      badge.title = canRiver ? "Create Hazmat RIVER ticket" : status.error || hazmat?.message || "No exact ASIN hazmat result; recheck";
      const colours = ["#999", "#33cc02", "#ffe103", "#ffbf03", "#ff8002", "#ff4001", "#ed0700", "#ad03de", "#3333ff"];
      badge.style.background = hazmat && hazmat.level < colours.length ? colours[hazmat.level] : "#fff";
      badge.style.color = hazmat && hazmat.level >= 6 ? "#fff" : "#111";
      if (product) {
        const recheck = ownButton(host, "pandash", "Pandash", () => {
          queueHaz(gen, asin, true);
          runtime.schedule();
        });
        recheck.disabled = status.status === "loading";
      }
    }
    function highlightProperties(panel) {
      for (const label of ["SORTABLE", "VERY HIGH VALUE", "CONVEYABLE", "MASTER CASE"]) {
        const entry = panel.entries.get(label);
        if (!entry) continue;
        const value = /^(?:true|yes|1)$/i.test(entry.text) ? "true" : /^(?:false|no|0)$/i.test(entry.text) ? "false" : "unknown";
        setAttribute(entry.value, "data-tm-v4-property", value);
      }
    }
    function poHighlights() {
      const table = document.querySelector("#table-purchase-order-item");
      if (!table?.tBodies[0]) return;
      const wrapper = table.closest(".dataTables_scroll"), head = wrapper?.querySelector(".dataTables_scrollHead table") || table;
      const headers = [...head.querySelectorAll("thead th")].map((node) => clean3(node.textContent).toLowerCase());
      const unfilled = headers.findIndex((value) => value.includes("unfilled")), cancelled = headers.findIndex((value) => /cancelled|canceled/.test(value)), dateIndex = headers.findIndex((value) => /order date|^date$/.test(value));
      const six = new Date(now());
      six.setMonth(six.getMonth() - 6);
      const seven = new Date(now());
      seven.setMonth(seven.getMonth() - 7);
      for (const row of table.tBodies[0].rows) {
        const flags = row.cells ? [...row.cells].map(() => []) : [];
        const readNumber = (index) => Number(clean3(row.cells[index]?.querySelector("input")?.value ?? row.cells[index]?.textContent).replace(/[ ,]/g, ""));
        if (unfilled >= 0 && readNumber(unfilled) > 0) flags[unfilled]?.push("unfilled");
        if (cancelled >= 0 && readNumber(cancelled) > 0) flags[cancelled]?.push("cancelled");
        const raw = clean3(row.cells[dateIndex]?.textContent), match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
        if (match) {
          const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
          if (date.getFullYear() === Number(match[1]) && date.getMonth() + 1 === Number(match[2]) && date.getDate() === Number(match[3])) {
            if (date < six) for (let delta = 0; delta <= 2; delta++) flags[dateIndex - delta]?.push("band");
            if (date < seven) flags[dateIndex]?.push("old");
          }
        }
        [...row.cells].forEach((cell, index) => {
          if (flags[index].length || modified.get(cell)?.has("data-tm-v4-po")) setAttribute(cell, "data-tm-v4-po", flags[index].join(" "));
        });
      }
    }
    function refresh() {
      const gen = runtime.current();
      if (!gen || !isCurrent(gen)) return;
      for (const node of nodes) if (!node.isConnected) nodes.delete(node);
      for (const node of modified.keys()) if (!node.isConnected) modified.delete(node);
      if (!style?.isConnected) {
        style = runtime.mark(document.createElement("style"));
        style.textContent = STYLE;
        (document.head || document.documentElement).append(style);
      }
      const group = state(gen), product = gen.sections.get("product")?.result?.product, panel = productPanel(document, product);
      if (panel) {
        highlightProperties(panel);
        const host = (panel.entries.get("DIMENSIONS") || panel.entries.get("ASIN") || panel.entries.get("ISBN"))?.value;
        if (host) {
          const sizeLabel = "Size: " + (group.size.status === "loading" || group.size.status === "idle" ? "CHECK…" : group.size.status === "error" ? "ERROR ↻" : group.size.value || "Unavailable");
          const badge = ownButton(host, "size", sizeLabel, () => void size(gen, true));
          badge.disabled = group.size.status === "loading";
          badge.title = group.size.error || "Exact native binDescription — click to recheck";
          const result = group.madcat.result, history = result?.madcatSource === "history";
          const label = group.madcat.status === "error" ? "Madcat: ERROR ↻" : group.madcat.status !== "ready" ? group.madcat.authPending ? "Madcat: AUTH…" : "Madcat: CHECK…" : result.madcat === true ? "Madcat: YES" : history ? "Madcat: NO?" : "Madcat: NO";
          const mad = ownButton(host, "madcat", label, () => {
            if (group.madcat.status === "ready" && history && result.authRequired) {
              if (result.fallbackReason === "measurement-token-expired" || !auth.read?.()) {
                const tab = window2.open(auth.loginUrl(product.fnsku || product.asin || product.isbn), "tm-v4-measurement-login");
                if (tab) tab.opener = null;
                else {
                  runtime.notify("Measurement login popup blocked — allow popups and retry");
                  return;
                }
              }
            }
            void madcat(gen, true);
          });
          mad.dataset.state = group.madcat.status === "error" ? "error" : history ? "history" : result ? result.madcat ? "yes" : "no" : "checking";
          mad.disabled = group.madcat.status === "loading" || group.madcat.status === "ready" && !history;
          mad.title = group.madcat.error || (history ? "Inventory History fallback only; click to renew RAW auth and retry" : "RAW Item Measurement: rolling 30-day check");
        }
        const primary = (panel.entries.get("ASIN") || panel.entries.get("ISBN"))?.value;
        if (primary && /^B[A-Z0-9]{9}$/.test(upper2(product.asin))) paintHaz(primary, upper2(product.asin), gen, true);
        void size(gen);
        void madcat(gen);
      }
      const inventory = gen.sections.get("inventory")?.result;
      const table = inventory && document.querySelector("#table-inventory");
      if (table) {
        const head = table.closest(".dataTables_scroll")?.querySelector(".dataTables_scrollHead table") || table;
        const asinIndex = [...head.querySelectorAll("thead th")].findIndex((node) => /^ASIN$/i.test(clean3(node.textContent)));
        const permitted = new Set(inventory.rows.map((row) => upper2(row.asin)));
        for (const row of table.tBodies[0]?.rows || []) {
          const cell = row.cells[asinIndex];
          if (!cell) continue;
          const clone = cell.cloneNode(true);
          clone.querySelectorAll(UI2).forEach((node) => node.remove());
          const asin = upper2(clone.textContent);
          if (permitted.has(asin)) paintHaz(cell, asin, gen);
        }
        let recheck = table.closest('[data-section-type="inventory"]')?.querySelector(':scope > [data-tm-v4-badge="recheck-hazmat"]');
        if (!recheck) recheck = ownButton(table.closest('[data-section-type="inventory"]') || table.parentElement, "recheck-hazmat", "Recheck N/A + L0", () => {
          for (const [asin, value] of group.haz) if (permitted.has(asin) && value.status !== "loading" && (!value.result?.hazmat || value.result.hazmat.level === 0)) queueHaz(gen, asin, true);
          runtime.schedule();
        });
      }
      poHighlights();
    }
    function reset() {
      for (const node of nodes) node.remove();
      nodes.clear();
      for (const [node, attributes] of modified) for (const [name, original] of attributes) original == null ? node.removeAttribute(name) : node.setAttribute(name, original);
      modified.clear();
    }
    function dispose() {
      lifetime.abort();
      reset();
    }
    return Object.freeze({ refresh, reset, dispose, size, madcat });
  }

  // master-actions.mjs
  var clean4 = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  var upper3 = (value) => clean4(value).toUpperCase();
  var UI3 = "[data-tm-v4-master]";
  var hex = (value) => Array.from(String(value)).map((character) => character.charCodeAt(0).toString(16)).join("");
  function printableCode(value) {
    const match = clean4(value).match(/\b(?:LPN[A-Za-z0-9-]{4,}|FBA[A-Za-z0-9]{6,}|[A-Za-z0-9]{10})\b/);
    return match?.[0] || "";
  }
  function printmonUrl({ code, quantity: quantity2, description = "", badge = "", sequence }) {
    if (!code || !/^[A-Za-z0-9-]{1,128}$/.test(code) || !Number.isInteger(quantity2) || quantity2 < 1 || quantity2 > 9999) throw new Error("Invalid print code or quantity");
    const url = new URL("http://localhost:5965/printer");
    for (const [key, value] of Object.entries({ action: "print", type: "barcode", data: hex(code), text: hex(code), quantity: quantity2, desc: hex(description), badgeid: badge, seq: sequence })) url.searchParams.set(key, String(value));
    return url.href;
  }
  function plainText(fragment) {
    const walk = (node) => {
      if (node.nodeType === 3) return node.textContent;
      if (node.nodeType !== 1 && node.nodeType !== 11) return "";
      if (node.tagName === "BR") return "\n";
      const values = [...node.childNodes].map(walk);
      if (node.tagName === "TR") return [...node.children].map(walk).join("	") + "\n";
      return values.join("") + (/^(?:TABLE|P|DIV)$/.test(node.tagName) ? "\n" : "");
    };
    return walk(fragment).trim();
  }
  function cleanProductSelection({ document, selection, table }) {
    if (!selection || !table || selection.isCollapsed || !selection.rangeCount) return null;
    const ranges = Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index));
    if (!ranges.some((range) => {
      try {
        return range.intersectsNode(table);
      } catch {
        return false;
      }
    })) return null;
    const touchedUi = [...table.querySelectorAll(UI3)].some((node) => ranges.some((range) => {
      try {
        return range.intersectsNode(node);
      } catch {
        return false;
      }
    }));
    if (!touchedUi) return null;
    const text2 = [], html = [];
    for (const range of ranges) {
      const ancestor = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
      if (ancestor?.closest(UI3)) continue;
      const fragment = range.cloneContents();
      fragment.querySelectorAll(UI3).forEach((node) => node.remove());
      fragment.querySelectorAll("[data-tm-v4-label-action], [data-tm-v4-property]").forEach((node) => {
        node.removeAttribute("data-tm-v4-label-action");
        node.removeAttribute("data-tm-v4-property");
        node.removeAttribute("role");
        node.removeAttribute("tabindex");
      });
      for (const anchor of fragment.querySelectorAll("a[href]")) anchor.setAttribute("href", anchor.href);
      const wrapper = document.createElement("div");
      wrapper.append(fragment);
      text2.push(plainText(wrapper));
      html.push(wrapper.innerHTML);
    }
    return { text: text2.filter(Boolean).join("\n"), html: html.join("<br>") };
  }
  function createMasterActions({ window: window2, runtime, fetch = window2.fetch.bind(window2), onEvidence = () => {
  }, uuid: uuid2 = () => window2.crypto.randomUUID(), timeoutMs = 15e3 }) {
    const document = window2.document, lifetime = new window2.AbortController();
    const modified = /* @__PURE__ */ new Map(), nodes = /* @__PURE__ */ new Set(), prints = /* @__PURE__ */ new Set();
    const mark = (node) => {
      runtime.mark(node);
      nodes.add(node);
      return node;
    };
    function attr(node, name, value) {
      if (!modified.has(node)) modified.set(node, /* @__PURE__ */ new Map());
      if (!modified.get(node).has(name)) modified.get(node).set(name, node.getAttribute(name));
      node.setAttribute(name, value);
    }
    function panel() {
      return productPanel(document, runtime.current()?.sections.get("product")?.result?.product);
    }
    function emit(operationId, phase, data) {
      try {
        onEvidence({ type: "operation", script: "FCR MASTER", version: MASTER_VERSION, intent: "mutation", operationId, phase, data: { kind: "label-print", endpoint: "Printmon", ...data } });
      } catch {
      }
    }
    function clickedDescription(code, target, currentPanel) {
      const row = target?.closest("tr"), table = row?.closest("table");
      if (row && table) {
        const head = table.closest(".dataTables_scroll")?.querySelector(".dataTables_scrollHead table") || table;
        const index = [...head.querySelectorAll("thead th")].findIndex((node) => /^(?:title|product|description|item name)$/i.test(clean4(node.textContent)));
        if (index >= 0) return clean4(row.cells[index]?.textContent);
      }
      return currentPanel?.product.aliases.includes(upper3(code)) ? currentPanel.product.title : "";
    }
    async function print(code, quantity2 = 1, target) {
      const gen = runtime.current();
      if (!gen || !runtime.active(gen) || lifetime.signal.aborted) return;
      if (/^LPN/i.test(code) && !window2.confirm("Barcode: " + code + "\n\nLPNs are unique. Print this LPN?")) return;
      let description = /^LPN|^FBA/i.test(code) ? "" : clickedDescription(code, target, panel());
      if (!description && /^[A-Z0-9]{10}$/i.test(code)) {
        try {
          const result = await runtime.reader.product(code, { signal: gen.controller.signal });
          description = result.product.title;
        } catch {
        }
      }
      if (!runtime.active(gen) || lifetime.signal.aborted) return;
      const operationId = "print." + uuid2(), controller = new window2.AbortController();
      const job = { controller, settled: false, timer: null, finish: null };
      const badge = document.cookie.split(";").map((value) => value.trim()).find((value) => value.startsWith("fcmenu-employeeId="))?.slice("fcmenu-employeeId=".length) || "";
      let url;
      try {
        url = printmonUrl({ code, quantity: quantity2, description, badge, sequence: window2.crypto.getRandomValues(new Uint32Array(1))[0] });
      } catch (error) {
        runtime.notify(error.message);
        return;
      }
      const finished = (outcome, message) => {
        if (job.settled) return;
        job.settled = true;
        window2.clearTimeout(job.timer);
        prints.delete(job);
        emit(operationId, "UNKNOWN", { quantity: quantity2, outcome, acknowledgement: "unverified" });
        if (runtime.active(gen) && !lifetime.signal.aborted) runtime.notify(message);
      };
      job.finish = finished;
      prints.add(job);
      emit(operationId, "SUBMITTED", { quantity: quantity2 });
      job.timer = window2.setTimeout(() => {
        finished("timeout", "Printmon timed out — check the printer before printing again");
        controller.abort();
      }, timeoutMs);
      try {
        const response = await fetch(url, { method: "GET", signal: controller.signal });
        if (response.ok) finished("response-received", "Print request sent; label output unverified");
        else finished("http-" + response.status, "Printmon HTTP " + response.status + " — check the printer before printing again");
      } catch {
        finished("transport-failed", "Printmon request failed — check the printer before printing again");
      }
    }
    function targetCode(target) {
      if (!(target instanceof window2.Element) || target.closest(UI3)) return "";
      const context = target.closest('[data-section-type],table[id^="table-"]');
      if (!context) return "";
      const node = target.closest("a,td,th") || target;
      const clone = node.cloneNode(true);
      clone.querySelectorAll(UI3).forEach((child) => child.remove());
      return printableCode(clone.textContent);
    }
    const activate = (event) => {
      if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
      const target = event.target instanceof window2.Element ? event.target : event.target?.parentElement;
      if (!target) return;
      const quantity2 = target.closest("[data-tm-v4-quantity]");
      if (quantity2 && event.type === "keydown" && event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        const code = quantity2.dataset.code, count = Number(quantity2.value);
        if (/^\d{1,4}$/.test(quantity2.value) && count > 0) void print(code, count, quantity2);
        return;
      }
      if (event.type === "click" && event.altKey) {
        const code = targetCode(target);
        if (!code) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void print(code, 1, target);
        return;
      }
      const label = target.closest("[data-tm-v4-label-action]");
      if (!label) return;
      event.preventDefault();
      event.stopPropagation();
      if (label.dataset.tmV4LabelAction === "ISS") {
        window2.location.hash = "#iss-console";
        return;
      }
      const current = panel(), entry = current?.entries.get(label.dataset.tmV4LabelAction);
      if (entry) void print(entry.text, 1, label);
    };
    document.addEventListener("click", activate, { capture: true, signal: lifetime.signal });
    document.addEventListener("keydown", activate, { capture: true, signal: lifetime.signal });
    for (const type of ["pointerdown", "mousedown", "auxclick"]) document.addEventListener(type, (event) => {
      if (event.altKey && targetCode(event.target)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, { capture: true, signal: lifetime.signal });
    document.addEventListener("input", (event) => {
      if (event.target.matches?.("[data-tm-v4-quantity]")) event.target.value = event.target.value.replace(/\D/g, "").slice(0, 4);
    }, { signal: lifetime.signal });
    document.addEventListener("copy", (event) => {
      const current = panel();
      if (!current || !event.clipboardData) return;
      const output = cleanProductSelection({ document, selection: window2.getSelection(), table: current.table });
      if (!output) return;
      event.preventDefault();
      event.clipboardData.setData("text/plain", output.text);
      event.clipboardData.setData("text/html", output.html);
    }, { capture: true, signal: lifetime.signal });
    function refresh() {
      for (const node of nodes) if (!node.isConnected) nodes.delete(node);
      for (const node of modified.keys()) if (!node.isConnected) modified.delete(node);
      const current = panel();
      if (!current) return;
      for (const field of ["ASIN", "ISBN", "FNSKU", "WEIGHT"]) {
        const entry = current.entries.get(field);
        if (!entry) continue;
        attr(entry.label, "data-tm-v4-label-action", field === "WEIGHT" ? "ISS" : field);
        attr(entry.label, "role", "button");
        attr(entry.label, "tabindex", "0");
        attr(entry.label, "title", field === "WEIGHT" ? "Open ISS Console" : "Click to print " + field);
        if (field === "WEIGHT" || entry.value.querySelector("[data-tm-v4-quantity]")) continue;
        const input = mark(document.createElement("input"));
        input.type = "text";
        input.inputMode = "numeric";
        input.maxLength = 4;
        input.value = "1";
        input.setAttribute("data-tm-v4-quantity", field);
        input.dataset.code = entry.text;
        input.setAttribute("aria-label", field + " print quantity");
        entry.value.append(input);
      }
    }
    function reset() {
      for (const node of nodes) node.remove();
      nodes.clear();
      for (const [node, attributes] of modified) for (const [name, value] of attributes) value == null ? node.removeAttribute(name) : node.setAttribute(name, value);
      modified.clear();
    }
    function dispose() {
      lifetime.abort();
      reset();
      for (const job of [...prints]) {
        job.finish("page-disposed", "");
        job.controller.abort();
      }
    }
    return Object.freeze({ refresh, reset, dispose, print });
  }

  // master-entry.mjs
  var VERSION = "0.1.5";
  var page = typeof unsafeWindow === "object" ? unsafeWindow : window;
  var storage = {
    get: (key, fallback) => GM_getValue(key, fallback),
    set: (key, value) => GM_setValue(key, value),
    listen: (key, callback) => GM_addValueChangeListener(key, callback),
    remove: (id) => GM_removeValueChangeListener(id)
  };
  var evidence = (value) => {
    try {
      window.dispatchEvent(new window.CustomEvent("tampermonkey-v4:evidence", { detail: JSON.stringify(value) }));
    } catch {
    }
  };
  var uuid = () => typeof window.crypto.randomUUID === "function" ? window.crypto.randomUUID() : [...window.crypto.getRandomValues(new Uint32Array(4))].map((value) => value.toString(16).padStart(8, "0")).join("-");
  var guard = Symbol.for("tampermonkey.v4.master.installer");
  if (!page[guard]) {
    let start = function() {
      if (location.origin === "https://jp.item-measurement.aft.a2z.com") {
        const release2 = registerWatermark(window, "FCRM", VERSION);
        const capture = installMeasurementCapture({ page, storage });
        stop = () => {
          capture();
          release2();
        };
        evidence({ type: "script.start", script: "FCR MASTER", version: VERSION, intent: "read", data: { context: "measurement-auth" } });
        return;
      }
      if (!/\/[A-Z0-9-]{2,12}\/results(?:\/|$)/.test(location.pathname) || /^#(?:fcr-tote-checker|iss-console)/.test(location.hash)) return;
      let features, actions;
      const runtime = createMasterRuntime({
        window,
        page,
        storage,
        fetch: page.fetch.bind(page),
        onEvidence: evidence,
        onRefresh: () => {
          features?.refresh();
          actions?.refresh();
        },
        onReset: () => {
          features?.reset();
          actions?.reset();
        },
        onDispose: () => {
          features?.dispose();
          actions?.dispose();
        }
      });
      const auth = createMeasurementAuth({ window, storage, onEvidence: evidence });
      const enrichment = createFcrEnrichment({
        warehouse: runtime.warehouse,
        readJson: createGmJsonReader(GM_xmlhttpRequest),
        getMeasurementAuth: auth.acquire,
        onEvidence: evidence,
        uuid,
        historyFallback: async (code, { signal }) => {
          const end = /* @__PURE__ */ new Date(), start2 = new Date(end.getTime() - 30 * 864e5);
          const result = await runtime.reader.history(code, { signal, startDate: start2.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10), allowPartial: true });
          const doc = new window.DOMParser().parseFromString(result.html, "text/html");
          const rows = [...doc.querySelectorAll("#table-inventory-history tbody tr")].filter((row) => !row.querySelector(".dataTables_empty"));
          return { madcat: rows.some((row) => /\bMADCAT\b/i.test(row.textContent)), complete: result.complete, rows: rows.length };
        }
      });
      features = createMasterFeatures({ window, page, runtime, enrichment, auth, storage, onEvidence: evidence });
      actions = createMasterActions({ window, runtime, fetch: page.fetch.bind(page), onEvidence: evidence, uuid });
      const release = registerWatermark(window, "FCRM", VERSION);
      runtime.start();
      const bridge = watchNativeAjax(page, () => runtime);
      evidence({ type: "script.start", script: "FCR MASTER", version: VERSION, intent: "read", data: { context: "native-fcr" } });
      stop = () => {
        runtime.dispose();
        bridge.restore?.();
        release();
      };
    };
    page[guard] = { version: VERSION };
    let stop = () => {
    };
    start();
    window.addEventListener("pagehide", () => stop());
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) start();
    });
    const context = () => location.origin + location.pathname + location.search + (location.hash.match(/^#(?:fcr-tote-checker|iss-console)/)?.[0] || "");
    let currentContext = context();
    const navigate = () => {
      const next = context();
      if (next === currentContext) return;
      currentContext = next;
      stop();
      start();
    };
    window.addEventListener("hashchange", navigate);
    window.addEventListener("popstate", navigate);
  }
})();
