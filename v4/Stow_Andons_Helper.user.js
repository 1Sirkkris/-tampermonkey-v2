// ==UserScript==
// @name V4 Stow Andons Helper
// @namespace https://github.com/1Sirkkris/tampermonkey-v4
// @version 0.1.0
// @description Native inline drop controls, product warnings and origin-owned operation workers.
// @match http://fcresearch-fe.aka.amazon.com/*
// @match https://fcresearch-fe.aka.amazon.com/*
// @match http://qi-fcresearch-fe.corp.amazon.com/*
// @match https://qi-fcresearch-fe.corp.amazon.com/*
// @match http://qi-fcresearch-jp.corp.amazon.com/*
// @match https://qi-fcresearch-jp.corp.amazon.com/*
// @match http://qifcr.fe.aftx.amazonoperations.app/*
// @match https://qifcr.fe.aftx.amazonoperations.app/*
// @match https://aft-moveapp-nrt-nrt.nrt.proxy.amazon.com/move-container*
// @match https://tx-b-hierarchy-nrt.nrt.proxy.amazon.com/unbindHierarchy*
// @grant unsafeWindow
// @grant GM_xmlhttpRequest
// @connect localhost
// @connect aft-moveapp-nrt-nrt.nrt.proxy.amazon.com
// @connect fcresearch-fe.aka.amazon.com
// @connect qi-fcresearch-fe.corp.amazon.com
// @connect qi-fcresearch-jp.corp.amazon.com
// @connect qifcr.fe.aftx.amazonoperations.app
// @run-at document-start
// @updateURL https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Stow_Andons_Helper.user.js
// @downloadURL https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Stow_Andons_Helper.user.js
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
  function suspiciousDimensions(value) {
    const parts = String(value || "").match(/\d+(?:\.\d+)?/g)?.slice(0, 3);
    if (parts?.length !== 3) return false;
    const sizes = parts.map(Number), rounded = parts.filter((part) => /\.00$/.test(part)).length;
    return sizes.some((size, i) => sizes.some((other, j) => i !== j && Math.abs(size - other) < 1e-3)) || rounded === 3 || Math.min(...sizes) <= 2.001 && rounded >= 2;
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

  // move-container.mjs
  var MOVE_CONTAINER_URL = "https://aft-moveapp-nrt-nrt.nrt.proxy.amazon.com/api/move-container";
  var DROPZONES = Object.freeze({ upper: [["Cubiscan", "dz-Pcubiscan-{floor}"], ["Prep", "dz-P-Prep-{floor}"], ["ISS", "dz-P-ISS-{floor}"], ["Damages", "dz-P-Damages-{floor}"], ["Hazmat", "dz-P-Hazmat-{floor}"], ["Nonsort", "dz-Pnonsort-{floor}"]], p1: [["Hazmat", "dz-P-HAZMAT_OUT"], ["Ticketland", "dz-P-Ticketland"], ["Consolidation", "dz-P-issconsol"], ["ISS WIP", "dz-S-ISSWIP1"], ["Nonsort", "dz-P-IB-nonsort"], ["Shipdock", "dz-P-ISS-Shipdock"], ["OB IOL", "dz-P-OBIOL"], ["Damageland", "dz-Pdamageland"], ["Receive Damages", "dz-P-rcv-Damages"]] });
  function dropzone(floor, type) {
    if (type === "PRIME") return "dz-P-PRIME";
    if (!["P1", "P2", "P3", "P4"].includes(floor)) return "";
    const row = (floor === "P1" ? DROPZONES.p1 : DROPZONES.upper).find((row2) => row2[0] === type);
    return row ? row[1].replace("{floor}", floor) : "";
  }
  function validateLocation(result, container, destination = null) {
    if (!result?.complete || !Array.isArray(result.rows) || !result.rows.length || result.rows.some((row) => upper(row.container) !== upper(container) || !clean(row.outerLocation))) throw new NativeRequestError("Complete exact container location unavailable", { outcome: destination ? "UNKNOWN" : "REJECTED" });
    if (destination && result.rows.some((row) => upper(row.outerLocation) !== upper(destination))) throw new NativeRequestError("Requested destination not confirmed by native location readback", { outcome: "UNKNOWN" });
    return result;
  }
  function createMoveContainer({ window: window2, fetch, reader, identity, onEvidence = () => {
  } }) {
    return async (row, { signal, beforeMutation, checkRunning, onPhase = () => {
    } }) => {
      const container = clean(row.container), destination = clean(row.destination);
      if (!/^(?:tsX|csX)[A-Z0-9_-]+$/i.test(container) || !/^dz-[A-Za-z0-9_-]+$/.test(destination)) throw new NativeRequestError("Invalid exact container/destination");
      identity();
      onPhase("location-preflight");
      validateLocation(await reader.inventory(container, { signal }), container);
      checkRunning();
      identity();
      beforeMutation();
      onPhase("move");
      let response;
      try {
        response = await fetch(MOVE_CONTAINER_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceScannableId: null, destinationScannableId: destination, containerScannableId: container, confirmed: "true" }), signal });
      } catch {
        throw new NativeRequestError("Move submission outcome unknown", { outcome: "UNKNOWN" });
      }
      const raw = await response.text();
      const content = response.headers.get("content-type") || "";
      if (!response.ok || response.redirected || /html/i.test(content) || /^\s*</.test(raw)) throw new NativeRequestError("Move response does not prove a native outcome", { outcome: "UNKNOWN", status: response.status });
      let data;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = null;
      }
      if (data && (data.success === false || data.error || data.errorMessage)) throw new NativeRequestError("Move explicitly rejected", { outcome: "REJECTED", status: response.status });
      if (data && /^(?:pending|submitted|queued|processing)$/i.test(String(data.status || data.state || ""))) throw new NativeRequestError("Move remains pending — verify before retry", { outcome: "UNKNOWN" });
      onPhase("location-verification");
      let verified;
      try {
        verified = validateLocation(await reader.inventory(container, { signal }), container, destination);
      } catch (error) {
        throw new NativeRequestError(error.message, { outcome: "UNKNOWN" });
      }
      onEvidence({ type: "move.location", intent: "read", data: { outcome: "exact-destination", rows: verified.rows.length } });
      return { status: response.status, verifiedBy: "native-inventory-outerLocation" };
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

  // operation-bridge.mjs
  var FCR = /^(?:fcresearch-fe\.aka\.amazon\.com|qi-fcresearch-(?:fe|jp)\.corp\.amazon\.com|qifcr\.fe\.aftx\.amazonoperations\.app)$/;
  function workerContext(window2) {
    const nonce = /^#tm-v4-worker=([a-f0-9-]{20,80})$/.exec(window2.location.hash)?.[1];
    let parentOrigin;
    try {
      parentOrigin = new window2.URL(window2.location.href).searchParams.get("tmV4ParentOrigin");
      const url = new window2.URL(parentOrigin);
      if (!FCR.test(url.hostname) || !/^https?:$/.test(url.protocol) || url.origin !== parentOrigin) return null;
    } catch {
      return null;
    }
    return nonce && window2.parent !== window2 ? { nonce, parentOrigin } : null;
  }
  function serveOperationBridge({ window: window2, mode, driver, identity, onEvidence = () => {
  } }) {
    const context = workerContext(window2);
    if (!context) return null;
    const controller = new window2.AbortController();
    let disposed = false, busy = false, journal, row;
    const lockName = mode === "move" ? "tm-v4.move-container.owner" : "tm-v4.hierarchy.owner";
    const key = mode === "move" ? "tm-v4.drop.rows" : "tm-v4.hierarchy.rows";
    const reply = (type, data = {}) => {
      if (!disposed) window2.parent.postMessage({ protocol: "tm-v4.operation", nonce: context.nonce, type, ...data }, context.parentOrigin);
    };
    const handle = async (event) => {
      const data = event.data;
      if (event.source !== window2.parent || event.origin !== context.parentOrigin || data?.protocol !== "tm-v4.operation" || data.nonce !== context.nonce) return;
      if (data.type === "hello") {
        reply("ready");
        return;
      }
      if (data.type !== "run" || busy || disposed) return;
      busy = true;
      try {
        await withOperationLock(window2, lockName, async () => {
          const input = data.row;
          if (!input || typeof input.id !== "string" || !/^(?:tsX|csX)[A-Z0-9_-]+$/i.test(clean(input.container))) throw new Error("Invalid operation request");
          identity();
          journal = createOperationJournal({ storage: window2.localStorage, key, uuid: () => window2.crypto.randomUUID() });
          if (journal.rows.some((r) => r.requestId === input.id || upper(r.container) === upper(input.container) && ["SUBMITTED", "UNKNOWN", "QUEUED", "READING"].includes(r.state))) throw new Error("Native recovery ledger already owns this container — verify unresolved work");
          row = journal.add([input.container], { mode: mode === "move" ? "drop" : "unbind", destination: clean(input.destination), requestId: input.id })[0];
          journal.transition(row, "READING", "Native preflight");
          const result = await driver(row, { mode: "unbind", signal: controller.signal, checkRunning: () => {
            if (disposed || controller.signal.aborted) throw new Error("Native preflight cancelled");
          }, beforeMutation: () => {
            if (disposed || controller.signal.aborted) throw new Error("Native preflight cancelled");
            identity();
            journal.transition(row, "SUBMITTED", "Submitted — native outcome pending");
            reply("submitted");
          }, onPhase: (phase) => reply("phase", { phase }) });
          journal.transition(row, "CONFIRMED", "Native result confirmed");
          reply("result", { outcome: "CONFIRMED", verifiedBy: result?.verifiedBy || "native-hierarchy-acknowledgement" });
        });
      } catch (error) {
        let outcome = row?.state === "SUBMITTED" || row?.state === "UNKNOWN" ? "UNKNOWN" : "REJECTED";
        if (row?.state === "SUBMITTED" && error.outcome === "REJECTED") outcome = "REJECTED";
        try {
          if (row) journal.transition(row, outcome, error.message);
        } catch {
          outcome = "UNKNOWN";
        }
        reply("result", { outcome, message: clean(error.message) });
      } finally {
        onEvidence({ type: "operation.worker", intent: "mutation", data: { mode, state: row?.state || "blocked" } });
      }
    };
    window2.addEventListener("message", handle);
    reply("ready");
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      try {
        if (row?.state === "SUBMITTED") journal.transition(row, "UNKNOWN", "Native worker disposed after submission");
        else if (row?.state === "READING") journal.transition(row, "REJECTED", "Native preflight disposed");
      } catch {
      }
      controller.abort();
      window2.removeEventListener("message", handle);
    };
    window2.addEventListener("pagehide", dispose, { once: true });
    return dispose;
  }
  function createOperationBridge({ window: window2, timeoutMs = 12e4, readyMs = 25e3 }) {
    return (row, { mode, signal, beforeMutation, onPhase = () => {
    }, checkRunning = () => {
    } }) => new Promise((resolve, reject) => {
      const origin = mode === "move" ? "https://aft-moveapp-nrt-nrt.nrt.proxy.amazon.com" : "https://tx-b-hierarchy-nrt.nrt.proxy.amazon.com";
      const nonce = window2.crypto.randomUUID(), url = new window2.URL(mode === "move" ? "/move-container" : "/unbindHierarchy", origin);
      url.searchParams.set("tmV4ParentOrigin", window2.location.origin);
      url.hash = "tm-v4-worker=" + nonce;
      const frame = window2.document.createElement("iframe");
      frame.hidden = true;
      frame.dataset.tmV4Script = "STOW";
      let sent = false, done = false, timer;
      function finish(error, result) {
        if (done) return;
        done = true;
        window2.clearTimeout(timer);
        window2.removeEventListener("message", message);
        signal?.removeEventListener("abort", cancel);
        frame.remove();
        error ? reject(error) : resolve(result);
      }
      const fail = (message2, outcome) => Object.assign(new Error(message2), { outcome });
      const cancel = () => finish(fail(sent ? "Native operation outcome unknown after disposal" : "Native preflight cancelled", sent ? "UNKNOWN" : "REJECTED"));
      const message = (event) => {
        const data = event.data;
        if (event.source !== frame.contentWindow || event.origin !== origin || data?.protocol !== "tm-v4.operation" || data.nonce !== nonce) return;
        if (data.type === "ready" && !sent) {
          try {
            checkRunning();
            beforeMutation();
            sent = true;
            window2.clearTimeout(timer);
            timer = window2.setTimeout(() => finish(fail("Native worker outcome timed out — verify before retry", "UNKNOWN")), timeoutMs);
            frame.contentWindow.postMessage({ protocol: "tm-v4.operation", nonce, type: "run", row: { id: row.id, container: row.container, destination: row.destination } }, origin);
          } catch (error) {
            finish(error);
          }
          return;
        }
        if (!sent) return;
        if (data.type === "phase") onPhase(data.phase);
        else if (data.type === "submitted") onPhase("SUBMITTED");
        else if (data.type === "result") {
          if (data.outcome === "CONFIRMED") finish(null, { verifiedBy: data.verifiedBy });
          else finish(fail(clean(data.message) || "Native outcome requires review", data.outcome === "REJECTED" ? "REJECTED" : "UNKNOWN"));
        }
      };
      window2.addEventListener("message", message);
      signal?.addEventListener("abort", cancel, { once: true });
      timer = window2.setTimeout(() => finish(fail("Authenticated native worker unavailable — no operation sent", "REJECTED")), readyMs);
      frame.addEventListener("load", () => {
        if (!done) frame.contentWindow?.postMessage({ protocol: "tm-v4.operation", nonce, type: "hello" }, origin);
      });
      frame.src = url.href;
      window2.document.body.append(frame);
      if (signal?.aborted) cancel();
    });
  }

  // stow-runtime.mjs
  function fcskuConflicts(entries) {
    const groups = /* @__PURE__ */ new Map();
    for (const e of entries) {
      if (!e.container || !e.fnsku || !e.fcsku) continue;
      const key = upper(e.container) + "\0" + upper(e.fnsku);
      if (!groups.has(key)) groups.set(key, { fnsku: e.fnsku, fcskus: /* @__PURE__ */ new Set(), entries: [] });
      const g = groups.get(key);
      g.fcskus.add(upper(e.fcsku));
      g.entries.push(e);
    }
    return [...groups.values()].filter((g) => g.fcskus.size > 1);
  }
  function stowInventory(window2) {
    const table = window2.document?.querySelector("#table-inventory");
    if (!table) return [];
    const cols = {};
    for (const [i, th] of [...table.querySelectorAll("thead th")].entries()) {
      const name = clean(th.textContent).replace(/\(.*?\)/g, "").toLowerCase();
      for (const field of ["container", "fnsku", "fcsku", "quantity"]) if (name === field || field === "quantity" && name.startsWith("quantity")) cols[field] = i;
    }
    if (cols.fnsku === void 0 || cols.fcsku === void 0) return [];
    return [...table.querySelectorAll("tbody tr")].filter((row) => row.cells.length >= Math.max(...Object.values(cols)) + 1).map((row) => ({ row, container: clean(row.cells[cols.container]?.textContent) || new window2.URL(window2.location.href).searchParams.get("s") || "", fnsku: clean(row.cells[cols.fnsku]?.textContent), fcsku: clean(row.cells[cols.fcsku]?.textContent), units: Number(clean(row.cells[cols.quantity]?.textContent).replace(/,/g, "")) || 0, fnskuCell: row.cells[cols.fnsku], fcskuCell: row.cells[cols.fcsku] }));
  }
  function createStowHelper({ window: window2, reader, operate, print, version, onEvidence = () => {
  } }) {
    const d = window2.document, controller = new window2.AbortController(), pool = createReadPool(4);
    let dataController = new window2.AbortController(), lastRows = [];
    let disposed = false, busy = false, operationController, journal, storageError = "", container = "", signature = "", generation = 0, cache = /* @__PURE__ */ new Map(), hoverSerial = 0;
    let prefs = { floor: "P2", print: false, qty: 2, img: true, imgw: 150, title: true, dims: true, weight: true, sortable: true };
    try {
      prefs = { ...prefs, ...JSON.parse(window2.localStorage.getItem("tm-v4.stow.settings") || "{}") };
      journal = createOperationJournal({ storage: window2.localStorage, key: "tm-v4.stow.rows", uuid: () => window2.crypto.randomUUID() });
    } catch (error) {
      storageError = error.message;
    }
    if (!["P1", "P2", "P3", "P4"].includes(prefs.floor)) prefs.floor = "P2";
    const own = (tag, id) => {
      const el = d.createElement(tag);
      el.id = id;
      el.dataset.tmV4Script = "STOW";
      return el;
    };
    const style = own("style", "tm-v4-stow-style");
    style.textContent = `#tm-v4-stow-controls{display:inline-flex;align-items:center;flex-wrap:wrap;gap:5px;margin-left:8px;color:#172033;font:12px Arial}#tm-v4-stow-controls button{min-height:24px;padding:4px 8px;border:1px solid #94a3b8;border-radius:7px;background:#fff;font-weight:700;cursor:pointer}#tm-v4-stow-controls button.active{background:#0b74d1;color:#fff}#tm-v4-stow-controls button:disabled{opacity:.55;cursor:wait}#tm-v4-stow-controls.tote{display:flex;margin:0;padding:6px 10px;background:#eef3f8;border-bottom:1px solid #cbd5e1}#tm-v4-stow-controls.tote button{min-height:32px;font-size:13px}#tm-v4-stow-gear{position:fixed;left:16px;bottom:16px;z-index:999998;width:34px;height:34px;border:1px solid #ccd2d8;border-radius:50%;background:white;cursor:pointer}#tm-v4-stow-settings{position:fixed;left:58px;bottom:56px;z-index:1000001;width:260px;padding:10px 14px;background:white;color:#172033;border:1px solid #d9dde1;border-radius:9px;box-shadow:0 8px 25px #0002;font:12px Arial}#tm-v4-stow-settings label{display:flex;align-items:center;gap:6px;margin:5px 0}#tm-v4-stow-settings input[type=number]{width:58px}#tm-v4-stow-status{position:fixed;bottom:55px;left:16px;z-index:1000002;max-width:500px;white-space:pre-wrap;padding:8px;background:#eef3f8;color:#172033;border:1px solid #ccd2d8;border-radius:6px;font:12px Arial}#tm-v4-stow-hover{position:absolute;z-index:999997;pointer-events:none;max-width:540px;padding:8px 10px;background:#161616f0;border-radius:6px;color:#f1f3f5;font:11px Arial}#tm-v4-stow-hover .content{display:flex;gap:10px}#tm-v4-stow-hover img{max-width:180px;max-height:220px;object-fit:contain}#tm-v4-stow-hover .title{max-width:340px;font-size:12px;margin-bottom:5px}#tm-v4-stow-controls .warning{border:2px solid #7f1d1d;border-radius:8px;padding:3px;background:#fff7ed;color:#7f1d1d}#table-inventory tr.tm-v4-stow-suspicious td{background-color:#fef9c3}#table-inventory tr.tm-v4-stow-conflict td{background-image:repeating-linear-gradient(135deg,#7f1d1d2d 0 8px,#f59e0b19 8px 16px);box-shadow:inset 0 2px #7f1d1d,inset 0 -2px #7f1d1d}#table-inventory .tm-v4-stow-conflict-cell{outline:3px solid #7f1d1d;outline-offset:-3px}#tm-v4-stow-hover .suspicious{padding:2px 5px;border:2px solid #f59e0b;background:#fff7ed;color:#111}#tm-v4-stow-hover .sort{padding:2px 6px;border-radius:20px;background:#fde047;color:#111}#tm-v4-stow-hover .sort.no{background:#dc2626;color:#fff}`;
    d.head.append(style);
    const controls = own("span", "tm-v4-stow-controls"), gear = own("button", "tm-v4-stow-gear"), settings = own("div", "tm-v4-stow-settings"), status = own("div", "tm-v4-stow-status"), hover = own("div", "tm-v4-stow-hover");
    gear.type = "button";
    gear.textContent = "⚙";
    gear.title = "Stow Andons settings";
    settings.hidden = true;
    hover.hidden = true;
    status.hidden = true;
    settings.innerHTML = "<b>Print</b>" + [["print", "Print Dropzone Label"], ["qty", "Quantity"], ["img", "Show Image"], ["imgw", "Image Width"], ["title", "Show Title"], ["dims", "Show Dimensions"], ["weight", "Show Weight"], ["sortable", "Show Sortable"]].map(([key, label]) => `<label>${label}<input data-setting="${key}" type="${["qty", "imgw"].includes(key) ? "number" : "checkbox"}" ${key === "qty" ? 'min="1" max="99"' : key === "imgw" ? 'min="50" max="180"' : ""}></label>`).join("");
    for (const input of settings.querySelectorAll("input")) {
      const key = input.dataset.setting;
      if (input.type === "checkbox") input.checked = !!prefs[key];
      else input.value = String(prefs[key]);
    }
    d.body.append(gear, settings, status, hover);
    function say(message) {
      if (disposed) return;
      status.textContent = message;
      status.hidden = !message;
    }
    function savePrefs() {
      try {
        window2.localStorage.setItem("tm-v4.stow.settings", JSON.stringify(prefs));
      } catch {
        say("Settings could not be saved");
      }
    }
    function currentContainer() {
      const tote = d.querySelector("#tm-v4-tote [data-container]");
      const raw = tote ? clean(tote.textContent) : new window2.URL(window2.location.href).searchParams.get("s");
      return /^(?:tsX|csX)[A-Z0-9_-]+$/i.test(raw || "") ? raw : "";
    }
    function focus() {
      const input = d.querySelector("#tm-v4-tote input") || d.querySelector("#search-input,#searchInput,input[name=s]");
      if (input && !input.disabled) {
        input.focus({ preventScroll: true });
        input.select?.();
      }
    }
    function renderControls() {
      const tote = !!d.querySelector("#tm-v4-tote");
      controls.classList.toggle("tote", tote);
      controls.innerHTML = `${tote ? "<b>MOVE</b>" : ""}<b>Floor:</b>${["P1", "P2", "P3", "P4"].map((f) => `<button data-floor="${f}" class="${prefs.floor === f ? "active" : ""}">${f}</button>`).join("")} | <b>Drop:</b>${(prefs.floor === "P1" ? DROPZONES.p1.filter((x) => x[0] !== "OB IOL") : DROPZONES.upper).map(([label]) => `<button data-drop="${escapeHtml(label)}" title="${escapeHtml(dropzone(prefs.floor, label))}">${escapeHtml(label)}</button>`).join("")}<button data-drop="PRIME">Prime</button> | <button data-unbind>Unbind</button><span data-warning></span>`;
      for (const b of controls.querySelectorAll("button")) b.disabled = busy || !!storageError;
    }
    function unresolved() {
      return journal?.rows.filter((r) => ["SUBMITTED", "UNKNOWN"].includes(r.state)) || [];
    }
    async function act(mode, destination) {
      if (busy || storageError || !container) return;
      say("");
      busy = true;
      renderControls();
      operationController = new window2.AbortController();
      let row;
      try {
        await withOperationLock(window2, "tm-v4.stow.owner", async () => {
          journal = createOperationJournal({ storage: window2.localStorage, key: "tm-v4.stow.rows", uuid: () => window2.crypto.randomUUID() });
          if (journal.rows.some((r) => upper(r.container) === upper(container) && ["SUBMITTED", "UNKNOWN", "QUEUED", "READING"].includes(r.state))) throw new Error("Unresolved operation exists for this container — verify native result");
          row = journal.add([container], { mode, destination })[0];
          journal.transition(row, "READING", "Authenticating native worker");
          say("READING • " + row.container);
          const result = await operate(row, { mode, signal: operationController.signal, checkRunning: () => {
            if (disposed) throw new Error("Disposed before submission");
          }, beforeMutation: () => {
            if (disposed) throw new Error("Disposed before submission");
            journal.transition(row, "SUBMITTED", "Handed to native worker — verify result");
            say("SUBMITTED • " + row.container);
          }, onPhase: (phase) => say(row.state + " • " + phase) });
          journal.transition(row, "CONFIRMED", "Confirmed by " + result.verifiedBy);
          say("CONFIRMED • " + (mode === "move" ? destination : "Unbound") + " • " + row.container);
          if (mode === "move" && prefs.print) {
            try {
              await print(destination, prefs.qty);
              say("CONFIRMED move • Print SUBMITTED; physical output unverified");
            } catch (error) {
              say("CONFIRMED move • Print UNKNOWN: " + error.message);
            }
          }
        });
      } catch (error) {
        let outcome = row?.state === "SUBMITTED" ? "UNKNOWN" : "REJECTED";
        if (error.outcome === "REJECTED") outcome = "REJECTED";
        try {
          if (row) journal.transition(row, outcome, error.message);
        } catch {
        }
        say(outcome + " • " + error.message);
      } finally {
        busy = false;
        renderControls();
        onEvidence({ type: "stow.operation", intent: "mutation", data: { mode, state: row?.state || "blocked" } });
        focus();
      }
    }
    function product(code) {
      if (!cache.has(code)) {
        const run = generation;
        const promise = pool(() => reader.product(code, { signal: dataController.signal }), dataController.signal).then((r) => {
          if (run !== generation) throw new Error("Stale product result");
          return r.product;
        });
        promise.catch(() => {
        });
        cache.set(code, promise);
      }
      return cache.get(code);
    }
    async function warnings(entries, run) {
      const conflicts = fcskuConflicts(entries);
      for (const e of entries) {
        e.row.classList.remove("tm-v4-stow-conflict", "tm-v4-stow-suspicious");
        e.fnskuCell.classList.remove("tm-v4-stow-conflict-cell");
        e.fcskuCell.classList.remove("tm-v4-stow-conflict-cell");
      }
      for (const g of conflicts) for (const e of g.entries) {
        e.row.classList.add("tm-v4-stow-conflict");
        e.fnskuCell.classList.add("tm-v4-stow-conflict-cell");
        e.fcskuCell.classList.add("tm-v4-stow-conflict-cell");
      }
      const badge = controls.querySelector("[data-warning]");
      if (badge) {
        badge.textContent = (conflicts.length ? "FCSKU CONFLICT: " + conflicts.length + " • " : "") + "Sussy: checking…";
        badge.classList.toggle("warning", !!conflicts.length);
        badge.title = conflicts.map((g) => g.fnsku + ": " + [...g.fcskus].join(" + ")).join("\n");
      }
      let suspect = 0, units = 0, errors = 0;
      await Promise.all([...new Set(entries.map((e) => e.fnsku))].map(async (code) => {
        try {
          const p = await product(code);
          if (run !== generation || disposed) return;
          if (p && suspiciousDimensions(p.dimensions)) for (const e of entries.filter((e2) => e2.fnsku === code)) {
            if (e.row.isConnected) {
              e.row.classList.add("tm-v4-stow-suspicious");
              suspect++;
              units += e.units;
            }
          }
        } catch {
          errors++;
        }
      }));
      if (run !== generation || disposed) return;
      const b = controls.querySelector("[data-warning]");
      if (b) {
        b.textContent = (conflicts.length ? "FCSKU CONFLICT: " + conflicts.length + " • " : "") + `Sussy: ${suspect}/${entries.length}${errors ? " • " + errors + " UNKNOWN" : ""}`;
        b.title += (b.title ? "\n" : "") + units + " suspicious units; " + errors + " unread products";
      }
    }
    function refresh() {
      if (disposed) return;
      const next = currentContainer();
      if (next !== container) {
        container = next;
        generation++;
        cache = /* @__PURE__ */ new Map();
        signature = "";
        lastRows = [];
        dataController.abort();
        dataController = new window2.AbortController();
        hoverSerial++;
        hover.hidden = true;
      }
      if (!container) {
        controls.remove();
        return;
      }
      const tote = d.querySelector("#tm-v4-tote [data-system]");
      const section = d.querySelector("[data-section-type=inventory]");
      const heading = section ? [...section.querySelectorAll("span,b,h2,h3")].find((el) => clean(el.textContent) === "Inventory") : null;
      if (!controls.isConnected) {
        renderControls();
        if (tote) tote.prepend(controls);
        else if (heading) heading.after(controls);
      }
      if (tote) return;
      const entries = stowInventory(window2), sig = container + "|" + entries.map((e) => e.fnsku + ":" + e.fcsku + ":" + e.units).join("|");
      if (sig === signature && entries.length === lastRows.length && entries.every((e, i) => e.row === lastRows[i])) return;
      signature = sig;
      lastRows = entries.map((e) => e.row);
      dataController.abort();
      dataController = new window2.AbortController();
      cache = /* @__PURE__ */ new Map();
      warnings(entries, ++generation);
    }
    controls.addEventListener("click", (event) => {
      const b = event.target.closest("button");
      if (!b || b.disabled) return;
      event.preventDefault();
      event.stopPropagation();
      if (b.dataset.floor) {
        prefs.floor = b.dataset.floor;
        savePrefs();
        renderControls();
        signature = "";
        refresh();
        focus();
      } else if (b.dataset.drop) act("move", dropzone(prefs.floor, b.dataset.drop));
      else if (b.hasAttribute("data-unbind")) act("unbind", "");
    }, { signal: controller.signal });
    gear.addEventListener("click", () => settings.hidden = !settings.hidden, { signal: controller.signal });
    settings.addEventListener("change", (event) => {
      const input = event.target, key = input.dataset.setting;
      if (!key) return;
      prefs[key] = input.type === "checkbox" ? input.checked : Math.max(key === "qty" ? 1 : 50, Math.min(key === "qty" ? 99 : 180, Number(input.value) || (key === "qty" ? 2 : 150)));
      input.value = String(prefs[key]);
      savePrefs();
    }, { signal: controller.signal });
    d.addEventListener("mousedown", (event) => {
      if (event.target !== gear && !settings.contains(event.target)) settings.hidden = true;
    }, { signal: controller.signal });
    const hoverLink = (target2) => {
      const link = target2.closest?.("#table-inventory a");
      const entry = stowInventory(window2).find((e) => e.fnskuCell.contains(link));
      return entry && link ? { entry, link } : null;
    };
    d.addEventListener("mouseover", (event) => {
      const hit = hoverLink(event.target);
      if (!hit || hit.link.contains(event.relatedTarget)) return;
      const serial = ++hoverSerial;
      hover.style.left = event.pageX + 18 + "px";
      hover.style.top = event.pageY + 18 + "px";
      product(hit.entry.fnsku).then((p) => {
        if (disposed || serial !== hoverSerial || !p) return;
        const img = /^https?:\/\//i.test(p.img) ? p.img : "";
        hover.innerHTML = `<div class="content">${prefs.img && img ? `<img src="${escapeHtml(img)}" style="width:${Math.max(50, Math.min(180, prefs.imgw))}px">` : ""}<section>${prefs.title ? `<div class="title">${escapeHtml(p.title)}</div>` : ""}${prefs.dims ? `<div class="${suspiciousDimensions(p.dimensions) ? "suspicious" : ""}">Dimensions: ${escapeHtml(p.dimensions)}</div>` : ""}${prefs.weight ? `<div>Weight: ${escapeHtml(p.weight)}</div>` : ""}${prefs.sortable && typeof p.sortable === "boolean" ? `<div>Sortable: <b class="sort ${p.sortable ? "" : "no"}">${p.sortable ? "TRUE" : "FALSE"}</b></div>` : ""}</section></div>`;
        hover.hidden = false;
      }).catch((error) => {
        if (serial === hoverSerial) say("Product UNKNOWN • " + error.message);
      });
    }, { signal: controller.signal });
    d.addEventListener("mouseout", (event) => {
      const hit = hoverLink(event.target);
      if (hit && !hit.link.contains(event.relatedTarget)) {
        hoverSerial++;
        hover.hidden = true;
      }
    }, { signal: controller.signal });
    d.addEventListener("mousemove", (event) => {
      if (!hover.hidden) {
        hover.style.left = event.pageX + 18 + "px";
        hover.style.top = event.pageY + 18 + "px";
      }
    }, { signal: controller.signal });
    const target = d.querySelector("#tm-v4-tote,#results-content") || d.querySelector("[data-section-type=inventory]") || d.body;
    const observer = new window2.MutationObserver((records) => {
      if (records.some((r) => {
        const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
        if (el?.closest?.("[data-tm-v4-script=STOW]")) return false;
        const nodes = [...r.addedNodes, ...r.removedNodes];
        return !nodes.length || nodes.some((n) => !(n.nodeType === 1 && n.matches("[data-tm-v4-script=STOW]")));
      })) refresh();
    });
    observer.observe(target, { childList: true, subtree: true, characterData: true });
    renderControls();
    refresh();
    if (storageError) say("Recovery blocked: " + storageError);
    else if (unresolved().length) say("UNKNOWN • " + unresolved().map((r) => r.container + " " + r.mode).join(", ") + " — verify native results before reuse");
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      try {
        const r = journal?.rows.find((r2) => r2.state === "SUBMITTED");
        if (r) journal.transition(r, "UNKNOWN", "Stow disposed after native handoff");
      } catch {
      }
      operationController?.abort();
      dataController.abort();
      controller.abort();
      observer.disconnect();
      for (const e of [style, controls, gear, settings, status, hover]) e.remove();
      for (const e of stowInventory(window2)) {
        e.row.classList.remove("tm-v4-stow-conflict", "tm-v4-stow-suspicious");
        e.fnskuCell.classList.remove("tm-v4-stow-conflict-cell");
        e.fcskuCell.classList.remove("tm-v4-stow-conflict-cell");
      }
    };
    return { dispose, controls, refresh, getRows: () => journal?.rows || [], act };
  }

  // stow-entry.mjs
  var VERSION = "0.1.0";
  var page = typeof unsafeWindow === "object" ? unsafeWindow : window;
  var guard = Symbol.for("tampermonkey.v4.stow.installer");
  if (!page[guard]) {
    page[guard] = { version: VERSION };
    const emit = (data) => evidence(window, "STOW", VERSION, data);
    installRouteLifecycle(window, () => {
      const context = workerContext(window);
      if (context) {
        const mode = location.hostname === "tx-b-hierarchy-nrt.nrt.proxy.amazon.com" ? "unbind" : location.hostname === "aft-moveapp-nrt-nrt.nrt.proxy.amazon.com" ? "move" : null;
        if (!mode) return;
        const identity = () => resolveIdentity(window, page);
        let driver;
        if (mode === "unbind") driver = createHierarchyDriver({ request: createNativeJson({ window, fetch: page.fetch.bind(page), onEvidence: emit }), identity });
        else {
          const fetch = createGmFetch(window, GM_xmlhttpRequest), reader2 = createFcrReader({ origin: context.parentOrigin, warehouse: "BWU2", fetch, DOMParser: window.DOMParser, onEvidence: emit });
          driver = createMoveContainer({ window, fetch, reader: reader2, identity, onEvidence: emit });
        }
        const release2 = registerWatermark(window, "STOW", VERSION), stop = serveOperationBridge({ window, mode, driver, identity, onEvidence: emit });
        return () => {
          stop?.();
          release2();
        };
      }
      const warehouse = location.pathname.match(/^\/([A-Z0-9-]{2,12})\/results(?:\/|$)/)?.[1];
      if (!warehouse || location.hash.startsWith("#iss-console")) return;
      const reader = createFcrReader({ origin: location.origin, warehouse, DOMParser: window.DOMParser, fetch: page.fetch.bind(page), onEvidence: emit });
      const print = (code, qty) => new Promise((resolve, reject) => {
        const hex = [...new TextEncoder().encode(code)].map((b) => b.toString(16).padStart(2, "0")).join("");
        const url = new URL("http://localhost:5965/printer");
        const count = Math.min(99, Math.max(1, Math.trunc(qty) || 2));
        for (const [k, v] of Object.entries({ action: "print", type: "barcode", data: hex, text: hex, quantity: String(count), desc: "", seq: window.crypto.randomUUID() })) url.searchParams.set(k, v);
        emit({ type: "stow.print", intent: "print", data: { state: "SUBMITTED", quantity: count } });
        GM_xmlhttpRequest({ method: "GET", url: url.href, timeout: 15e3, onload: (r) => r.status >= 200 && r.status < 300 ? resolve({ outcome: "UNKNOWN" }) : reject(new Error("Printer HTTP " + r.status)), onerror: () => reject(new Error("Printer network outcome unknown")), ontimeout: () => reject(new Error("Printer timeout outcome unknown")) });
      });
      const release = registerWatermark(window, "STOW", VERSION), helper = createStowHelper({ window, reader, operate: createOperationBridge({ window }), print, version: VERSION, onEvidence: emit });
      return () => {
        helper.dispose();
        release();
      };
    }, () => location.pathname + "|" + (location.hash.startsWith("#iss-console") ? "iss" : location.hash.startsWith("#fcr-tote-checker") ? "tote" : location.hash.startsWith("#tm-v4-worker=") ? "worker" : "native"));
  }
})();
