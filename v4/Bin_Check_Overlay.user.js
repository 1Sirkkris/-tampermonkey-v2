// ==UserScript==
// @name V4 Bin Check Overlay
// @namespace https://github.com/1Sirkkris/tampermonkey-v4
// @version 0.1.0
// @description Native filtered inventory snapshot and P-level floor overlay.
// @match http://fcresearch-fe.aka.amazon.com/*
// @match https://fcresearch-fe.aka.amazon.com/*
// @match http://qi-fcresearch-fe.corp.amazon.com/*
// @match https://qi-fcresearch-fe.corp.amazon.com/*
// @match http://qi-fcresearch-jp.corp.amazon.com/*
// @match https://qi-fcresearch-jp.corp.amazon.com/*
// @match http://qifcr.fe.aftx.amazonoperations.app/*
// @match https://qifcr.fe.aftx.amazonoperations.app/*
// @grant unsafeWindow
// @run-at document-start
// @updateURL https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Bin_Check_Overlay.user.js
// @downloadURL https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Bin_Check_Overlay.user.js
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
  function printBarcode(window2, fetch, code, title, script, version) {
    const raw = clean(code).replace(/[\s-]/g, "");
    if (!/^[A-Za-z0-9]+$/.test(raw)) return Promise.reject(new Error("Invalid printable code"));
    const hex = (value) => [...String(value)].map((char) => char.charCodeAt(0).toString(16)).join("");
    const badge = window2.document.cookie.split("; ").find((row) => row.startsWith("fcmenu-employeeId="))?.slice(18) || "";
    const params = new URLSearchParams({ action: "print", type: "barcode", data: hex(raw), text: hex(raw), quantity: "1", desc: hex(title || ""), badgeid: badge, seq: String(Date.now()) });
    evidence(window2, script, version, { type: "print.submit", intent: "print", phase: "SUBMITTED", data: { quantity: 1 } });
    return fetch("http://localhost:5965/printer?" + params).then((response) => {
      if (!response.ok) throw new Error("Printmon rejected request");
      evidence(window2, script, version, { type: "print.response", intent: "print", phase: "UNKNOWN", data: { status: response.status, physicalOutput: "unverified" } });
      return "Print request sent — verify output";
    }, (error) => {
      evidence(window2, script, version, { type: "print.response", intent: "print", phase: "UNKNOWN", data: { outcome: "network-error" } });
      throw error;
    });
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

  // bin-runtime.mjs
  function snapshotInventory(window2, page2 = window2) {
    const table = window2.document.getElementById("table-inventory");
    if (!table) throw new Error("Inventory table not ready");
    const names = [...table.querySelectorAll("thead th")].map((node) => clean(node.id || node.textContent).toLowerCase().replace(/^inventory-/, "").replace(/\([\d,]+\)/g, "").replaceAll("-", " ").trim());
    const index = (field) => names.indexOf(field);
    if (index("container") < 0 || index("quantity") < 0) throw new Error("Native Container/Quantity columns missing");
    let nodes, source = "visible DOM only";
    const jq = page2.jQuery || page2.$;
    try {
      if (jq?.fn?.dataTable?.isDataTable?.(table)) {
        const native = jq(table);
        if (typeof native.DataTable === "function") {
          nodes = native.DataTable().rows({ search: "applied" }).nodes().toArray();
          source = "DataTables applied filter";
        } else if (typeof native.dataTable === "function") {
          const settings = native.dataTable().fnSettings();
          nodes = settings.aiDisplay.map((i) => settings.aoData[i].nTr);
          source = "DataTables applied filter";
        }
      }
    } catch {
      nodes = null;
    }
    if (!nodes) nodes = [...table.tBodies[0]?.rows || []].filter((row) => !row.hidden && row.getAttribute("aria-hidden") !== "true" && row.style.display !== "none" && !row.classList.contains("filtered-out") && window2.getComputedStyle(row).display !== "none");
    const rows = [];
    for (const node of nodes) {
      if (!node || node.querySelector(".dataTables_empty")) continue;
      const field = (name) => clean(node.cells[index(name)]?.textContent);
      const container = field("container"), pod = container.match(/\bP-\d-(?:[A-Z]\d{3}){2}\b/i)?.[0];
      if (!pod) continue;
      const raw = field("quantity").replaceAll(",", "");
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error("Snapshot quantity is invalid");
      rows.push({ container, pod: upper(pod), qty: Number(raw), fnsku: field("fnsku"), fcsku: field("fcsku"), title: field("title"), floor: null, error: "" });
    }
    return { rows, source };
  }
  function parseFloor(window2, html) {
    const d = new window2.DOMParser().parseFromString(html, "text/html");
    if (d.querySelector("input[type=password],form[action*=login],form[action*=signin]")) throw new Error("Hierarchy authentication required");
    const values = [];
    for (const row of d.querySelectorAll("table tr")) {
      const label = clean(row.querySelector("th")?.textContent || row.cells[0]?.textContent).toLowerCase();
      if (/^(?:floor|floor number|level|location level)$/.test(label)) values.push(clean(row.cells[1]?.textContent));
    }
    if (!values.length) {
      const cell = d.querySelector("div.a-span6:nth-child(1) > table:nth-child(1) > tbody:nth-child(1) > tr:nth-child(4) > td:nth-child(2)");
      if (cell) values.push(clean(cell.textContent).split(",")[0]);
    }
    const floors = values.map((value) => value.match(/^(?:P\s*)?([1-4])(?:\b|$)/i)?.[1]).filter(Boolean);
    if (new Set(floors).size > 1) throw new Error("Hierarchy contains conflicting floors");
    if (!floors.length) throw new Error("Native floor field not returned");
    return Number(floors[0]);
  }
  function createBinOverlay({ window: window2, page: page2 = window2, reader, version, onEvidence = () => {
  }, fetch = window2.fetch?.bind(window2) }) {
    const d = window2.document, controller = new window2.AbortController(), cache = /* @__PURE__ */ new Map();
    let run = null, observer = null, disposed = false, button = null;
    const style = d.createElement("style");
    style.dataset.tmV4Style = "BINC";
    style.textContent = `#tm-v4-bin{position:fixed;right:14px;bottom:14px;width:660px;max-width:calc(100vw - 28px);max-height:78vh;z-index:999999;background:#fff;border:2px solid #111827;border-radius:10px;box-shadow:0 10px 30px #0005;font:12px Arial,sans-serif;color:#111827;overflow:hidden}#tm-v4-bin[hidden]{display:none}#tm-v4-bin header{display:flex;align-items:center;gap:8px;background:#111827;color:#fff;padding:8px 10px;font-weight:800}#tm-v4-bin header span{flex:1}#tm-v4-bin .body{padding:9px;overflow:auto;max-height:calc(78vh - 46px)}#tm-v4-bin .controls{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px}#tm-v4-bin button{cursor:pointer;border:1px solid #374151;border-radius:6px;padding:5px 8px;font-size:12px;font-weight:800;background:#f3f4f6;color:#111827}#tm-v4-bin button[data-active=true]{outline:2px solid #111827}#tm-v4-bin table{width:100%;border-collapse:collapse}#tm-v4-bin th,#tm-v4-bin td{border-bottom:1px solid #e5e7eb;padding:6px 5px;text-align:left;white-space:nowrap}#tm-v4-bin [data-floor]{border-radius:7px;padding:3px 7px;font-weight:900}#tm-v4-bin [data-floor="1"]{background:#f0e442}#tm-v4-bin [data-floor="2"]{background:#009e73;color:white}#tm-v4-bin [data-floor="3"]{background:#e69f00}#tm-v4-bin [data-floor="4"]{background:#0072b2;color:white}#tm-v4-bin [data-floor="?"]{background:#cbd5e1}#tm-v4-bin a{color:#005eb8;font-weight:800}`;
    const root = d.createElement("section");
    root.id = "tm-v4-bin";
    root.dataset.tmV4Script = "BINC";
    root.hidden = true;
    root.innerHTML = `<header><b>Overlay v${escapeHtml(version)}</b><span role="status"></span><button data-action="pause">Pause</button><button data-action="hide">Hide</button></header><div class="body"><div class="controls">${["ALL", "P2", "P3", "P4", "P1"].map((floor) => `<button data-filter="${floor}">${floor === "ALL" ? "All" : floor}</button>`).join("")}<button data-sort="FLOOR">Floor</button><button data-sort="DESC">Qty ↓</button><button data-sort="ASC">Qty ↑</button><button data-action="lazy">Lazy bin check</button><button data-action="copy">Copy visible TSV</button></div><p data-source></p><table><thead><tr><th>Floor</th><th>Container</th><th>Qty</th><th>FNSKU</th><th>FcSku</th></tr></thead><tbody></tbody></table></div>`;
    const status = (text2) => {
      root.querySelector("[role=status]").textContent = text2;
    };
    function visible() {
      if (!run) return [];
      return run.rows.filter((row) => run.filter === "ALL" || "P" + row.floor === run.filter).sort((a, b) => (run.sort === "ASC" ? a.qty - b.qty : run.sort === "DESC" ? b.qty - a.qty : 0) || (a.floor ?? 99) - (b.floor ?? 99) || a.container.localeCompare(b.container));
    }
    function render() {
      if (!run || disposed) return;
      root.querySelectorAll("[data-filter]").forEach((node) => node.dataset.active = String(node.dataset.filter === run.filter));
      root.querySelectorAll("[data-sort]").forEach((node) => node.dataset.active = String(node.dataset.sort === run.sort));
      root.querySelector("[data-action=pause]").textContent = run.paused ? "Resume" : "Pause";
      root.querySelector("[data-source]").textContent = `${run.source} • ${run.rows.length} P-level rows • snapshot at click`;
      root.querySelector("tbody").innerHTML = visible().map((row, i) => {
        const url = new window2.URL(window2.location.href);
        url.search = "";
        url.hash = "";
        url.searchParams.set("s", row.container);
        return `<tr><td><span data-floor="${row.floor ?? "?"}" title="${escapeHtml(row.error)}">P${row.floor ?? "-"}</span></td><td><a href="${escapeHtml(url.href)}" target="_blank" rel="noopener" data-print="${escapeHtml(row.container)}" data-title="">${escapeHtml(row.container)}</a></td><td>${row.qty}</td><td><span data-print="${escapeHtml(row.fnsku)}" data-title="${escapeHtml(row.title)}" tabindex="0">${escapeHtml(row.fnsku)}</span></td><td>${escapeHtml(row.fcsku)}</td></tr>`;
      }).join("");
      status(`${run.finished}/${run.pods.length} floors • ${run.paused ? "PAUSED" : run.finished === run.pods.length ? "ready" : "loading"}${run.errors ? " • " + run.errors + " unknown" : ""}`);
    }
    function pump(s) {
      if (disposed || s !== run || s.paused || s.controller.signal.aborted) return;
      while (s.active < 4 && s.pending.length) {
        const pod = s.pending.shift();
        s.active++;
        let cached = cache.get(pod);
        if (cached && Date.now() - cached.at > 18e5) cached = null;
        Promise.resolve().then(() => cached ? { html: null, floor: cached.floor } : reader.section("container-hierarchy", pod, { signal: s.controller.signal })).then((result) => {
          if (s !== run) return;
          const floor = result.floor ?? parseFloor(window2, result.html);
          cache.set(pod, { floor, at: Date.now() });
          s.rows.filter((row) => row.pod === pod).forEach((row) => row.floor = floor);
        }, (error) => {
          if (s !== run || s.controller.signal.aborted) return;
          s.errors++;
          s.rows.filter((row) => row.pod === pod).forEach((row) => row.error = error.message);
        }).catch((error) => {
          if (s !== run) return;
          s.errors++;
          s.rows.filter((row) => row.pod === pod).forEach((row) => row.error = error.message);
        }).finally(() => {
          if (s !== run) return;
          s.active--;
          s.finished++;
          render();
          pump(s);
        });
      }
    }
    function open() {
      if (disposed) return;
      run?.controller.abort();
      root.hidden = false;
      try {
        const snap = snapshotInventory(window2, page2);
        const pods = [...new Set(snap.rows.map((row) => row.pod))];
        run = { ...snap, pods, pending: pods.slice(), active: 0, finished: 0, errors: 0, filter: "ALL", sort: "FLOOR", paused: false, controller: new window2.AbortController() };
        render();
        pump(run);
        onEvidence({ type: "bin.snapshot", intent: "read", data: { rows: snap.rows.length, pods: pods.length, source: snap.source } });
      } catch (error) {
        run = null;
        root.querySelector("tbody").replaceChildren();
        status(error.message);
      }
    }
    async function copy(lazy) {
      if (!run) return;
      if (lazy && run.finished < run.pods.length) {
        status("Wait for floor scan");
        return;
      }
      let text2;
      if (lazy) {
        const groups = /* @__PURE__ */ new Map();
        for (const row of run.rows) {
          const code = row.fnsku || row.fcsku;
          if (!code) continue;
          if (!groups.has(code)) groups.set(code, []);
          groups.get(code).push(row);
        }
        text2 = [...groups].map(([code, rows]) => [code, ...[2, 3, 4].map((floor) => rows.filter((row) => row.floor === floor).sort((a, b) => b.qty - a.qty || a.container.localeCompare(b.container))[0]?.container || "")].join("	")).join("\n");
      } else text2 = ["Floor	Container	Qty	FNSKU	FcSku", ...visible().map((row) => ["P" + (row.floor ?? "-"), row.container, row.qty, row.fnsku, row.fcsku].map((value) => clean(value).replaceAll("	", " ")).join("	"))].join("\n");
      try {
        await window2.navigator.clipboard.writeText(text2);
        status("COPIED ✓");
      } catch {
        status("COPY FAILED");
      }
    }
    root.addEventListener("click", (event) => {
      const target = event.target.closest("button,[data-print]");
      if (!target) return;
      if (event.altKey && target.dataset.print) {
        event.preventDefault();
        event.stopPropagation();
        if (!/^(?:P-\d-(?:[A-Z]\d{3}){2}|[A-Z0-9]{10})$/i.test(target.dataset.print)) return;
        void printBarcode(window2, fetch, target.dataset.print, target.dataset.title, "BINC", version).then(status, (error) => status(error.message));
        return;
      }
      if (!run) return;
      if (target.dataset.filter) run.filter = target.dataset.filter;
      if (target.dataset.sort) run.sort = target.dataset.sort;
      if (target.dataset.action === "pause") {
        run.paused = !run.paused;
        if (!run.paused) pump(run);
      }
      if (target.dataset.action === "hide") root.hidden = true;
      if (target.dataset.action === "copy") void copy(false);
      if (target.dataset.action === "lazy") void copy(true);
      render();
    }, { signal: controller.signal });
    function mount() {
      if (disposed) return;
      const nav = d.getElementById("inventory-nav") || d.getElementById("inventory-status");
      if (!nav) return;
      if (!button) {
        button = d.createElement("button");
        button.type = "button";
        button.dataset.tmV4Script = "BINC";
        button.textContent = "P-level overlay sorter";
        button.style.cssText = "background:orange;color:#111;font-weight:bold;border-radius:6px;margin-left:8px;padding:4px 10px;cursor:pointer";
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          open();
        }, { signal: controller.signal });
      }
      if (!button.isConnected) (nav.tagName === "A" ? nav.parentElement : nav).append(button);
    }
    function ready() {
      if (!d.head || !d.body) return;
      d.head.append(style);
      d.body.append(root);
      mount();
      const nav = d.getElementById("inventory-status") || d.querySelector('[data-section-type="inventory"]');
      if (nav) {
        observer = new window2.MutationObserver(mount);
        observer.observe(nav, { childList: true, subtree: true });
      }
    }
    if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", ready, { once: true, signal: controller.signal });
    else ready();
    return { open, root, visible, getState: () => run, dispose() {
      disposed = true;
      run?.controller.abort();
      controller.abort();
      observer?.disconnect();
      button?.remove();
      root.remove();
      style.remove();
    } };
  }

  // bin-entry.mjs
  var VERSION = "0.1.0";
  var page = typeof unsafeWindow === "object" ? unsafeWindow : window;
  var guard = Symbol.for("tampermonkey.v4.bin.installer");
  if (!page[guard]) {
    page[guard] = { version: VERSION };
    installRouteLifecycle(window, () => {
      const warehouse = location.pathname.match(/^\/([A-Z0-9-]{2,12})\/results(?:\/|$)/)?.[1];
      if (!warehouse || /^#(?:fcr-tote-checker|iss-console)/.test(location.hash)) return;
      const release = registerWatermark(window, "BINC", VERSION), emit = (data) => evidence(window, "BINC", VERSION, data);
      const native = { jQuery: page.jQuery, $: page.$ };
      const reader = createFcrReader({ origin: location.origin, warehouse, DOMParser: window.DOMParser, fetch: page.fetch.bind(page), onEvidence: emit });
      const overlay = createBinOverlay({ window, page: native, reader, version: VERSION, onEvidence: emit, fetch: page.fetch.bind(page) });
      try {
        page.P?.now("jQuery").execute((jq) => {
          native.jQuery = jq;
        });
      } catch {
      }
      return () => {
        overlay.dispose();
        release();
      };
    }, () => location.pathname + location.search + (location.hash.match(/^#(?:fcr-tote-checker|iss-console)/)?.[0] || ""));
  }
})();
