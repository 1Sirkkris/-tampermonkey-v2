// ==UserScript==
// @name V4 Tote Audit
// @namespace https://github.com/1Sirkkris/tampermonkey-v4
// @version 0.1.2
// @description Independent FC-Lite Tote Audit; complete inventory and physical scans.
// @match http://fcresearch-fe.aka.amazon.com/*
// @match https://fcresearch-fe.aka.amazon.com/*
// @match http://qi-fcresearch-fe.corp.amazon.com/*
// @match https://qi-fcresearch-fe.corp.amazon.com/*
// @match http://qi-fcresearch-jp.corp.amazon.com/*
// @match https://qi-fcresearch-jp.corp.amazon.com/*
// @match http://qifcr.fe.aftx.amazonoperations.app/*
// @match https://qifcr.fe.aftx.amazonoperations.app/*
// @match https://jp.item-measurement.aft.a2z.com/*
// @grant unsafeWindow
// @grant GM_getValue
// @grant GM_setValue
// @grant GM_addValueChangeListener
// @grant GM_removeValueChangeListener
// @grant GM_xmlhttpRequest
// @connect aft-poirot-website-nrt.nrt.proxy.amazon.com
// @connect pandash.amazon.com
// @connect o0avbo02yl.execute-api.ap-northeast-1.amazonaws.com
// @run-at document-start
// @updateURL https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/FC_Lite.user.js
// @downloadURL https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/FC_Lite.user.js
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
  function pagination(document2) {
    const markers = [...document2.querySelectorAll(".pagination-token")].map((node) => node.textContent.trim());
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
      const document2 = new Parser().parseFromString(html, "text/html");
      if (document2.querySelector('input[type="password"], form[action*="signin"], form[action*="login"]')) {
        throw failure("AUTH_REQUIRED", "FCR authentication is required");
      }
      if (fragment && !document2.querySelector("table") && /<tr\b/i.test(html)) {
        return new Parser().parseFromString("<table><tbody>" + html + "</tbody></table>", "text/html");
      }
      return document2;
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
      const query = searchValue(queryValue), document2 = await request("product", { s: query }, signal);
      active(signal);
      let recognized = false;
      const matches = [];
      for (const table of document2.querySelectorAll("table")) {
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
        return { query, product: matches[0], html: document2.body.innerHTML, complete: true, source: "network" };
      }
      if (allowEmpty && !recognized && !text(document2.body.textContent) && !document2.body.querySelector("table,img,form,input,iframe")) {
        evidence2({ endpoint: "product", outcome: "empty" });
        return { query, product: null, html: document2.body.innerHTML, complete: true, source: "network" };
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
      const document2 = await request("inventory", { s: query }, signal);
      active(signal);
      const table = document2.querySelector("#table-inventory");
      if (!table) throw failure("SCHEMA", "Inventory table was not returned");
      const format = schema(table), body = table.tBodies[0];
      if (!body) throw failure("SCHEMA", "Inventory table body is missing");
      let rows = parseInventoryRows(table, format).rows, pages = 1, complete = false, error = null;
      const header = table.querySelector("#inventory-quantity") || [...table.querySelectorAll("th")][format.positions.qty];
      const headerMatch = text(header?.textContent).match(/\(([\d,]+)\)/);
      const advertised = headerMatch ? quantity(headerMatch[1]) : null;
      const seen = /* @__PURE__ */ new Set();
      const result = (warning = "", code = "") => {
        const copy = document2.body.cloneNode(true);
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
        let token = pagination(document2);
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
          for (const node of parsed.nodes) body.appendChild(document2.importNode(node, true));
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
      const document2 = await request("inventory-history", {
        s: query,
        startSearchDateString: start.native,
        endSearchDateString: end.native,
        dateStringFormat: "MM/dd/yyyy"
      }, signal);
      active(signal);
      const table = document2.querySelector("#table-inventory-history");
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
        let token = pagination(document2);
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
          for (const node of nodes) body.appendChild(document2.importNode(node, true));
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
      document2.querySelectorAll(".pagination-token").forEach((node) => node.remove());
      active(signal);
      evidence2({ endpoint: "inventory-history", outcome: complete ? "complete" : "incomplete", pages, records, code: error?.code });
      active(signal);
      return { query, html: document2.body.innerHTML, pages, records, complete, warning: error?.message || "", ...error ? { code: error.code } : {}, source: "network" };
    }
    async function section(endpoint, query, options = {}) {
      if (!FCR_SECTIONS.includes(endpoint)) throw failure("INPUT", "Unsupported native FCR section");
      if (endpoint === "inventory") return inventory(query, options);
      if (endpoint === "product") return readProduct(query, options, true);
      if (endpoint === "inventory-history" && (options.startDate || options.endDate)) return history(query, options);
      const search = searchValue(query), document2 = await request(endpoint, { s: search }, options.signal);
      active(options.signal);
      const recognized = document2.querySelector('table, [data-section-type="' + endpoint + '"]');
      if (!recognized) throw failure("SCHEMA", "Native section markup was not returned");
      let pages = 1, records = 0, paginationComplete = false, error;
      const table = document2.getElementById("table-" + endpoint), body = table?.tBodies[0], width = table?.tHead?.rows[0]?.cells.length;
      const validate = (candidate) => [...candidate?.tBodies[0]?.rows || []].filter((node) => !node.querySelector("td.dataTables_empty")).map((node) => {
        if (node.cells.length !== width) throw failure("SCHEMA", endpoint + ": continuation row has unexpected columns");
        return node;
      });
      if (body && width) records = validate(table).length;
      if (records > maxRows) throw failure("LIMIT", endpoint + ": native row limit reached");
      try {
        let token = pagination(document2);
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
          for (const marker of page2.querySelectorAll(".show-message")) document2.getElementById(text(marker.textContent))?.classList.remove("aok-hidden");
          for (const node of nodes) body.appendChild(document2.importNode(node, true));
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
      document2.querySelectorAll(".pagination-token").forEach((node) => node.remove());
      active(options.signal);
      return {
        endpoint,
        query: search,
        html: document2.body.innerHTML,
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

  // fcr-enrichment.mjs
  var FCR_ENRICHMENT_VERSION = "0.1.2";
  var MEASUREMENT_ORIGIN = "https://o0avbo02yl.execute-api.ap-northeast-1.amazonaws.com";
  var BIN_URL = "https://aft-poirot-website-nrt.nrt.proxy.amazon.com/api/scanitem";
  var PANDASH_URL = "https://pandash.amazon.com/GridServlet";
  var clean = (value) => String(value ?? "").trim();
  var upper = (value) => clean(value).toUpperCase();
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
    async function read(options, { retries = pandashRetryDelays.length, reportFailure = true } = {}) {
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
          const matches = (payload.rows || []).filter((row) => upper(row?.asin) === asin);
          const mapped = matches.map((row) => {
            if (row.level == null || row.level === "") return null;
            const level = Number(row.level);
            if (!["number", "string"].includes(typeof row.level) || !/^\d+$/.test(clean(row.level)) || !Number.isSafeInteger(level) || level < 0 || row.message != null && typeof row.message !== "string") throw fail("SCHEMA", "Hazmat level/message is invalid");
            return { level, message: row.message ?? "" };
          });
          if (new Set(mapped.map((row) => JSON.stringify(row))).size > 1) throw fail("IDENTITY", "Conflicting exact ASIN hazmat rows");
          if (matches.length && mapped[0] && mapped[0].message.trim() && !restrictionWarning) {
            active2(signal);
            evidence2("hazmat", { outcome: "complete", level: mapped[0].level });
            return { hazmat: mapped[0], complete: true, warning: "", source: "network" };
          }
          warning = restrictionWarning || (!matches.length ? "No exact ASIN hazmat result" : "Hazmat level or message is missing");
        } catch (error) {
          active2(signal);
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
      const container = clean(containerValue), item = upper(itemValue);
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
      const wanted = /* @__PURE__ */ new Set([item, ...verifiedAliases.map(upper)]), matches = [];
      for (const row of payload.items) {
        if (!row || typeof row !== "object") throw fail("SCHEMA", "Native bin item row is invalid");
        if (/^X[A-Z0-9]{9}$/.test(item) && row.skuDetail?.fnSku && upper(row.skuDetail.fnSku) !== item) continue;
        const codes = [row.scannableId, row.value, row.scannedBarcode, row.skuDetail?.fnSku, row.skuDetail?.asin, row.skuDetail?.fcSku].map(upper).filter(Boolean);
        const matched = codes.find((code) => wanted.has(code));
        if (matched && typeof row.binDescription === "string" && clean(row.binDescription)) matches.push({ size: clean(row.binDescription), matched });
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
        next = clean(payload.nextToken);
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
  var MEASUREMENT_AUTH_VERSION = "0.1.2";
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
  function installMeasurementCapture({ page: page2, storage, now = Date.now }) {
    if (page2.location.origin !== SITE) throw failure2("INPUT", "Measurement capture requires the native Measurement page");
    if (page2[GUARD]) return page2[GUARD].subscribe(storage, now);
    const controller = new page2.AbortController(), details = /* @__PURE__ */ new WeakMap();
    const subscribers = /* @__PURE__ */ new Map();
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
      for (const [target, subscriber] of subscribers) observe(() => {
        const capturedAt = subscriber.now(), value = normalizeMeasurementToken(raw, capturedAt);
        if (value) target.set(MEASUREMENT_AUTH_KEY, JSON.stringify({ ...value, capturedAt, captureId: page2.crypto.randomUUID() }));
      });
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
      if (page2[GUARD] === capture) delete page2[GUARD];
    }
    if (typeof originalFetch === "function") page2.fetch = wrappedFetch;
    if (typeof originalOpen === "function" && typeof originalHeader === "function" && typeof originalSend === "function") {
      proto.open = wrappedOpen;
      proto.setRequestHeader = wrappedHeader;
      proto.send = wrappedSend;
    }
    function subscribe(target, clock) {
      const existing = subscribers.get(target);
      if (existing) return existing.dispose;
      let stopped = false;
      const release = () => {
        if (stopped) return;
        stopped = true;
        subscribers.delete(target);
        if (!subscribers.size) dispose();
      };
      subscribers.set(target, { now: clock, dispose: release });
      return release;
    }
    const capture = { subscribe };
    page2[GUARD] = capture;
    return subscribe(storage, now);
  }
  function createMeasurementAuth({ window: window2, storage, now = Date.now, timeoutMs = 1e4, onEvidence = () => {
  } }) {
    if (!window2?.document || !storage || !["get", "listen", "remove"].every((key) => typeof storage[key] === "function") || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 3e4) throw failure2("INPUT", "Measurement auth configuration is invalid");
    function evidence2(data) {
      try {
        onEvidence({ type: "fcr.auth", script: "MEASUREMENT AUTH", version: MEASUREMENT_AUTH_VERSION, intent: "read", data: { endpoint: "measurement-auth", ...data } });
      } catch {
      }
    }
    function read() {
      try {
        const raw = storage.get(MEASUREMENT_AUTH_KEY, "null");
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
        baseline = force ? storage.get(MEASUREMENT_AUTH_KEY, "null") : null;
      } catch (cause) {
        throw failure2("STORAGE", "Measurement auth storage cannot be read", cause);
      }
      return new Promise((resolve, reject) => {
        let listener = null, frame = null, timer = null, settled = false;
        const cleanup = () => {
          if (timer != null) window2.clearTimeout(timer);
          if (listener != null) {
            try {
              storage.remove(listener);
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
            if (force && storage.get(MEASUREMENT_AUTH_KEY, "null") === baseline) return;
            const value = read();
            if (value && value.token !== previousToken) finish(null, value);
          } catch (error) {
            finish(error);
          }
        };
        const started = now();
        signal?.addEventListener("abort", cancelled, { once: true });
        try {
          listener = storage.listen(MEASUREMENT_AUTH_KEY, changed);
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
            storage.remove(listener);
          } catch {
          }
        }
        signal?.removeEventListener("abort", stop);
      };
      signal?.addEventListener("abort", stop, { once: true });
      try {
        listener = storage.listen(MEASUREMENT_AUTH_KEY, () => {
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

  // ui-tools.mjs
  var clean2 = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  var upper2 = (value) => clean2(value).toUpperCase();
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
  function suspiciousDimensions(value) {
    const parts = String(value || "").match(/\d+(?:\.\d+)?/g)?.slice(0, 3);
    if (parts?.length !== 3) return false;
    const sizes = parts.map(Number), rounded = parts.filter((part) => /\.00$/.test(part)).length;
    return sizes.some((size, i) => sizes.some((other, j) => i !== j && Math.abs(size - other) < 1e-3)) || rounded === 3 || Math.min(...sizes) <= 2.001 && rounded >= 2;
  }
  function printBarcode(window2, fetch, code, title, script, version) {
    const raw = clean2(code).replace(/\s/g, "");
    if (!/^[A-Za-z0-9_-]+$/.test(raw)) return Promise.reject(new Error("Invalid printable code"));
    const hex = (value) => [...String(value)].map((char) => char.charCodeAt(0).toString(16)).join("");
    const badge = window2.document.cookie.split("; ").find((row) => row.startsWith("fcmenu-employeeId="))?.slice(18) || "";
    const params = new URLSearchParams({ action: "print", type: "barcode", data: hex(raw), text: hex(raw), quantity: "1", desc: hex(title || ""), badgeid: badge, seq: String(Date.now()) });
    const operationId = window2.crypto.randomUUID();
    evidence(window2, script, version, { type: "operation", intent: "mutation", operationId, phase: "SUBMITTED", data: { kind: "print", quantity: 1 } });
    return fetch("http://localhost:5965/printer?" + params).then((response) => {
      evidence(window2, script, version, { type: "operation", intent: "mutation", operationId, phase: "UNKNOWN", data: { status: response.status, physicalOutput: "unverified" } });
      if (!response.ok) throw new Error("Printmon rejected request");
      return "Print request sent — verify output";
    }, (error) => {
      evidence(window2, script, version, { type: "operation", intent: "mutation", operationId, phase: "UNKNOWN", data: { outcome: "network-error" } });
      throw error;
    });
  }

  // tote-runtime.mjs
  function createToteAudit({ window: window2, reader, enrichment, warehouse, version, onEvidence = () => {
  }, fetch = window2.fetch?.bind(window2) }) {
    const d = window2.document, pool = createReadPool(4);
    let session, serial = 0, hoverSerial = 0, disposed = false;
    const root = d.createElement("main");
    root.id = "tm-v4-tote";
    root.dataset.tmV4Script = "TOTE";
    const style = d.createElement("style");
    style.dataset.tmV4Style = "TOTE";
    style.textContent = `#tm-v4-tote{font:14px Arial,sans-serif;color:#172033;background:#e7edf3;padding:12px;min-height:96vh;box-sizing:border-box}#tm-v4-tote *{box-sizing:border-box}#tm-v4-tote header{background:#0f2744;color:white;border-radius:8px;padding:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}#tm-v4-tote header strong{font-size:24px}#tm-v4-tote button{cursor:pointer;border:1px solid #a8bdd5;border-radius:6px;padding:7px 11px;background:#fff;color:#163a63;font-weight:700}#tm-v4-tote button:disabled{opacity:.6;cursor:default}#tm-v4-tote .scanner{display:flex;gap:10px;margin-top:12px;align-items:center}#tm-v4-tote input{flex:1;max-width:700px;font:700 24px Arial;padding:12px;border:2px solid #7993b4;border-radius:8px}#tm-v4-tote .meta{display:flex;gap:16px;margin:12px 0;flex-wrap:wrap}#tm-v4-tote .scroll{overflow:auto;background:white;border-radius:8px;margin:12px 0}#tm-v4-tote table{width:100%;border-collapse:collapse}#tm-v4-tote td,#tm-v4-tote th{padding:9px;border-bottom:1px solid #cbd5e1;text-align:left}#tm-v4-tote th{background:#dce8f4;white-space:nowrap}#tm-v4-tote tr[data-state=IN]{background:#d4f8d7}#tm-v4-tote tr[data-state=OUT],#tm-v4-tote tr[data-state=ERROR]{background:#ffe1e1}#tm-v4-tote .suspicious{background:#ffe08c}#tm-v4-tote [data-haz]{display:inline-block;padding:3px;margin-left:4px;border-radius:4px;border:1px solid #94a3b8}#tm-v4-tote [data-haz=HIGH]{background:#ffcf66;color:#111}#tm-v4-tote [data-hover]{cursor:help;text-decoration:underline}#tm-v4-tote .hover{position:fixed;background:white;border:2px solid #244e7c;border-radius:8px;padding:12px;z-index:1200;width:430px;box-shadow:0 3px 14px #33415555}#tm-v4-tote .hover img{max-width:100px;max-height:160px;float:left;margin-right:12px}#tm-v4-tote .hover[hidden]{display:none}`;
    root.innerHTML = `<header><button data-action="full" title="Return to full FCResearch"><strong>FC-LITE</strong></button><b>${escapeHtml(warehouse)} TOTE AUDIT</b><span data-container>NO CONTAINER</span><span data-core>V4 READ READY</span><button data-action="stats">COPY STATS</button><button data-action="full">FULL FCRESEARCH ↗</button></header><div class="scanner"><button data-action="focus" data-phase>CONTAINER</button><input autocomplete="off" spellcheck="false" placeholder="Scan tsX / csX"><button data-action="reset" title="Reset">↺</button><button data-action="retry" hidden>Retry inventory</button></div><div class="meta"><b data-summary>No container loaded</b><span role="status" data-status>Scan container</span></div><div class="scroll"><table data-physical><thead><tr><th>Scanned code / count</th><th>Sortable</th><th>Dimensions / Bin</th><th>MADCAT</th><th>Result</th></tr></thead><tbody></tbody></table></div><section data-system hidden><b>SYSTEM INVENTORY — WHAT AMAZON SAYS IS HERE</b> <span data-dims>DIMS …</span> <button data-action="haz">Recheck N/A + L0</button><div class="scroll"><table><thead><tr>${["Container", "ASIN / Haz", "FNSKU", "FcSku", "LPN", "Qty", "Disposition", "Consumer", "Consumer ID", "Outer location", "Outer location type", "Title"].map((label) => "<th>" + label + "</th>").join("")}</tr></thead><tbody data-inventory></tbody></table></div></section><div class="hover" hidden></div>`;
    const input = root.querySelector("input"), physical = root.querySelector("[data-physical] tbody"), systemBody = root.querySelector("[data-inventory]"), hover = root.querySelector(".hover");
    const status = (text2) => {
      root.querySelector("[data-status]").textContent = text2;
    };
    const current = (s) => !disposed && session === s && !s.controller.signal.aborted;
    const focus = () => {
      if (!disposed) input.focus({ preventScroll: true });
    };
    const containerCode = (code) => /^(?:TSX|CSX)[A-Z0-9]+$/i.test(code);
    function product(s, code) {
      const key = upper2(code);
      if (!s.products.has(key)) s.products.set(key, pool(() => /^\d{8,14}$/.test(key) ? reader.barcodeProduct(code, { signal: s.controller.signal }) : reader.product(code, { signal: s.controller.signal }), s.controller.signal).then((result) => result.product).catch((error) => {
        s.products.delete(key);
        throw error;
      }));
      return s.products.get(key);
    }
    function matches(s, entry) {
      if (!entry.product || s.inventoryState !== "READY") return [];
      const strict = /^(?:X0|ZZ)[A-Z0-9]{8}$/.test(upper2(entry.raw));
      const aliases = strict ? [upper2(entry.raw)] : [upper2(entry.raw), ...entry.product.aliases.map(upper2)];
      return s.inventory.filter((row) => [row.asin, row.fnsku, row.fcsku].map(upper2).some((code) => aliases.includes(code)));
    }
    function redraw(s) {
      if (!current(s)) return;
      s.inventory.forEach((row) => {
        row.physical = 0;
      });
      for (const entry of s.entries) {
        const rows = matches(s, entry);
        let units2 = entry.count;
        for (const row of rows) {
          const allocated = Math.min(units2, row.qty - row.physical);
          row.physical += allocated;
          units2 -= allocated;
        }
        if (entry.product) entry.state = rows.length ? "IN" : "OUT";
      }
      root.querySelector("[data-container]").textContent = s.container;
      root.querySelector("[data-phase]").textContent = s.done ? "DONE" : "ITEMS";
      const units = s.inventory.reduce((sum, row) => sum + row.qty, 0), checked = s.inventory.reduce((sum, row) => sum + row.physical, 0);
      const skus = new Set(s.inventory.map((row) => upper2(row.fnsku || row.fcsku || row.asin))).size;
      const scannedSkus = new Set(s.inventory.filter((row) => row.physical > 0).map((row) => upper2(row.fnsku || row.fcsku || row.asin))).size;
      root.querySelector("[data-summary]").textContent = s.inventoryState === "READY" ? `${scannedSkus}/${skus} SKU • ${checked}/${units}u${checked === units && units > 0 ? " • ✓ COMPLETE" : ""}${s.done ? " • DONE" : ""}` : `QUEUE ${s.pending.length} • inventory ${s.inventoryState.toLowerCase()}`;
      root.querySelector('[data-action="retry"]').hidden = s.inventoryState !== "ERROR";
      physical.replaceChildren();
      for (const entry of [...s.entries].reverse()) {
        const tr = d.createElement("tr");
        tr.dataset.state = entry.state;
        const rows = matches(s, entry), total = rows.reduce((sum, row) => sum + row.qty, 0);
        tr.innerHTML = `<td><button data-print="${entry.id}">${escapeHtml(entry.raw)}</button> ×${entry.count}</td><td>${entry.product?.sortable === true ? "TRUE" : entry.product?.sortable === false ? "FALSE" : "…"}</td><td class="${entry.product && suspiciousDimensions(entry.product.dimensions) ? "suspicious" : ""}">${escapeHtml(entry.product?.dimensions || "…")}<br>BIN ${escapeHtml(entry.bin || "…")}</td><td><button data-madcat="${entry.id}">${escapeHtml(entry.madcat || "CHECK…")}</button></td><td title="${escapeHtml(entry.error || "")}">${entry.state === "IN" ? `✓ IN TOTE ${Math.min(entry.count, total)}/${total}${entry.count > total ? " • EXTRA " + (entry.count - total) : ""}` : entry.state === "OUT" ? "✕ NOT IN TOTE" : entry.state === "ERROR" ? "ERROR ↻" : "CHECKING"}</td>`;
        tr.querySelector("[data-print]").disabled = !entry.product;
        if (entry.state === "ERROR") {
          tr.lastElementChild.tabIndex = 0;
          tr.lastElementChild.onclick = () => resolveItem(s, entry);
        }
        physical.append(tr);
      }
    }
    function mergeAliases(s, entry) {
      if (/^(?:X0|ZZ)[A-Z0-9]{8}$/.test(upper2(entry.raw))) return entry;
      const other = s.entries.find((row) => row !== entry && row.product && !/^(?:X0|ZZ)[A-Z0-9]{8}$/.test(upper2(row.raw)) && row.product.aliases.some((alias) => entry.product.aliases.includes(alias)));
      if (other) {
        other.count += entry.count;
        s.entries = s.entries.filter((row) => row !== entry);
        for (const [key, value] of s.aliases) if (value === entry) s.aliases.set(key, other);
        return other;
      }
      for (const alias of entry.product.aliases) if (!/^(?:X0|ZZ)[A-Z0-9]{8}$/.test(alias)) s.aliases.set(upper2(alias), entry);
      return entry;
    }
    async function madcat(s, entry, force = false) {
      const run = ++entry.measurementSerial;
      entry.madcat = force ? "AUTH…" : "CHECK…";
      redraw(s);
      try {
        const match = matches(s, entry).find((row) => row.fnsku);
        const result = await pool(() => enrichment.recentMadcat({ fnsku: match?.fnsku || entry.product.fnsku, asin: entry.product.asin || entry.product.isbn }, { signal: s.controller.signal, forceAuth: force }), s.controller.signal);
        if (!current(s) || entry.measurementSerial !== run) return;
        entry.madcat = result.madcat === null ? "UNKNOWN" : result.madcat ? "YES" : result.madcatSource === "history" ? "NO?" : "NO";
        entry.measurement = result;
      } catch (error) {
        if (current(s) && entry.measurementSerial === run) {
          entry.madcat = "ERROR ↻";
          entry.error = error.message;
        }
      }
      redraw(s);
    }
    async function resolveItem(s, original) {
      original.state = "PENDING";
      original.error = "";
      redraw(s);
      try {
        original.product = await product(s, original.raw);
        if (!current(s)) return;
        const entry = mergeAliases(s, original);
        redraw(s);
        status(`${matches(s, entry).length ? "✓ IN" : "✕ NOT IN"} ${s.container} — ${entry.raw}`);
        if (entry !== original) return;
        void madcat(s, entry);
        pool(() => enrichment.binDescription(s.container, entry.raw, { signal: s.controller.signal, verifiedAliases: entry.product.aliases }), s.controller.signal).then((result) => {
          if (current(s)) {
            entry.bin = result.size || "N/A";
            redraw(s);
          }
        }, (error) => {
          if (current(s)) {
            entry.bin = "ERROR";
            entry.error = error.message;
            redraw(s);
          }
        });
        onEvidence({ type: "tote.scan", intent: "read", data: { outcome: entry.state, count: entry.count } });
      } catch (error) {
        if (current(s)) {
          original.state = "ERROR";
          original.error = error.message;
          status(error.message);
          redraw(s);
        }
      }
    }
    function item(s, raw) {
      const existing = s.aliases.get(upper2(raw));
      if (existing) {
        existing.count++;
        redraw(s);
        return;
      }
      const entry = { id: ++serial, raw, count: 1, state: "PENDING", measurementSerial: 0 };
      s.entries.push(entry);
      s.aliases.set(upper2(raw), entry);
      void resolveItem(s, entry);
    }
    async function systemEnrich(s, failuresOnly = false) {
      const groups = [...new Set(s.inventory.map((row) => upper2(row.asin)).filter(Boolean))];
      await Promise.all(groups.map((asin) => pool(async () => {
        if (failuresOnly && s.haz.get(asin)?.level > 0) return;
        try {
          const result = await enrichment.hazmat(asin, { signal: s.controller.signal });
          if (current(s)) s.haz.set(asin, result.hazmat || { level: null });
        } catch (error) {
          if (current(s)) s.haz.set(asin, { level: null, error: error.message });
        }
        if (current(s)) systemRender(s);
      }, s.controller.signal).catch(() => {
      })));
      if (failuresOnly) return;
      await Promise.all([...new Set(s.inventory.map((row) => row.fnsku || row.asin || row.fcsku))].map((code) => product(s, code).then((p) => {
        if (current(s)) {
          s.dims.set(upper2(code), suspiciousDimensions(p.dimensions));
          systemRender(s);
        }
      }, () => {
        if (current(s)) {
          s.dims.set(upper2(code), null);
          systemRender(s);
        }
      })));
    }
    function systemRender(s) {
      if (!current(s)) return;
      systemBody.innerHTML = s.inventory.map((row) => {
        const haz = s.haz.get(upper2(row.asin)), flag = s.dims.get(upper2(row.fnsku || row.asin || row.fcsku));
        return `<tr class="${flag ? "suspicious" : ""}">${["container", "asin", "fnsku", "fcsku", "lpn", "qty", "disposition", "consumer", "consumerId", "outerLocation", "outerLocationType", "title"].map((field) => "<td>" + (field === "asin" ? `<span data-hover="${escapeHtml(row.asin)}">${escapeHtml(row.asin)}</span><span data-haz="${haz?.level > 0 ? "HIGH" : "OTHER"}" title="${escapeHtml(haz?.message || haz?.error || "")}">${haz ? haz.level === null ? "N/A" : "L" + haz.level : "…"}</span>` : escapeHtml(row[field])) + "</td>").join("")}</tr>`;
      }).join("") || '<tr><td colspan="12">No inventory returned</td></tr>';
      const values = [...s.dims.values()];
      root.querySelector("[data-dims]").textContent = `DIMS ${values.filter(Boolean).length} suspicious / ${values.length} checked${values.some((value) => value === null) ? " • errors" : ""}`;
    }
    async function load(s) {
      s.inventoryState = "LOADING";
      redraw(s);
      status("Loading system inventory • KEEP SCANNING");
      root.querySelector("[data-system]").hidden = false;
      try {
        const result = await reader.inventory(s.container, { signal: s.controller.signal });
        if (!current(s)) return;
        if (!result.complete) throw new Error("Incomplete inventory — audit blocked");
        if (result.rows.some((row) => upper2(row.container) !== upper2(s.container))) throw new Error("Inventory contains another container — audit blocked");
        s.inventory = result.rows.map((row) => ({ ...row, physical: 0 }));
        s.inventoryState = "READY";
        systemRender(s);
        const queued = s.pending.splice(0);
        queued.forEach((raw) => item(s, raw));
        redraw(s);
        status(`✓ ${s.container} ready — ${s.inventory.length} rows${s.done ? " • DONE" : " • keep scanning"}`);
        void systemEnrich(s);
      } catch (error) {
        if (current(s)) {
          s.inventoryState = "ERROR";
          systemBody.innerHTML = '<tr><td colspan="12">' + escapeHtml(error.message) + "</td></tr>";
          status(`${error.message} • ${s.pending.length} scans retained`);
          redraw(s);
        }
      }
    }
    function reset() {
      session?.controller.abort();
      session = null;
      hoverSerial++;
      hover.hidden = true;
      physical.replaceChildren();
      systemBody.replaceChildren();
      root.querySelector("[data-system]").hidden = true;
      root.querySelector("[data-container]").textContent = "NO CONTAINER";
      root.querySelector("[data-phase]").textContent = "CONTAINER";
      root.querySelector("[data-summary]").textContent = "No container loaded";
      root.querySelector('[data-action="retry"]').hidden = true;
      input.value = "";
      input.placeholder = "Scan tsX / csX";
      status("Scan container");
      focus();
    }
    function scan(value) {
      if (disposed) return;
      const code = clean2(value);
      if (!code) return;
      input.value = "";
      if (containerCode(code)) {
        if (session && upper2(code) === upper2(session.container)) {
          session.done = true;
          redraw(session);
          status("DONE — scan next container");
        } else {
          reset();
          session = { container: code, inventory: [], entries: [], pending: [], aliases: /* @__PURE__ */ new Map(), products: /* @__PURE__ */ new Map(), haz: /* @__PURE__ */ new Map(), dims: /* @__PURE__ */ new Map(), controller: new window2.AbortController(), inventoryState: "LOADING", done: false };
          input.placeholder = "Scan item barcode";
          void load(session);
        }
      } else if (!session) status("Scan container first");
      else if (session.done) status("Session done — scan next container");
      else if (session.inventoryState !== "READY") {
        session.pending.push(code);
        redraw(session);
        status(`QUEUE ${session.pending.length} • inventory ${session.inventoryState.toLowerCase()}`);
      } else item(session, code);
      focus();
    }
    const listeners = new window2.AbortController();
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        scan(input.value);
      }
    }, { signal: listeners.signal });
    root.addEventListener("click", async (event) => {
      const target = event.target.closest("button");
      if (!target) return;
      const s = session, action = target.dataset.action;
      if (action === "reset") reset();
      if (action === "focus") focus();
      if (action === "retry" && s && s.inventoryState === "ERROR") void load(s);
      if (action === "full") {
        const url = new window2.URL(`${window2.location.origin}/${warehouse}/results`);
        if (s) url.searchParams.set("s", s.container);
        url.hash = "#fcr-native";
        window2.location.assign(url.href);
      }
      if (action === "stats") {
        try {
          await window2.navigator.clipboard.writeText(JSON.stringify({ container: s?.container, scans: s?.entries.reduce((sum, row) => sum + row.count, 0) || 0, queued: s?.pending.length || 0, inventoryState: s?.inventoryState || "WAIT_CONTAINER" }, null, 2));
          status("COPIED ✓");
        } catch {
          status("COPY FAILED");
        }
      }
      if (action === "haz" && s) {
        target.disabled = true;
        try {
          await systemEnrich(s, true);
        } finally {
          if (current(s)) target.disabled = false;
        }
      }
      const entry = s?.entries.find((row) => String(row.id) === (target.dataset.madcat || target.dataset.print));
      if (entry?.product && target.dataset.madcat) void madcat(s, entry, entry.measurement?.authRequired === true);
      if (entry?.product && target.dataset.print) {
        try {
          const message = await printBarcode(window2, fetch, entry.raw, entry.product.title, "TOTE", version);
          if (current(s)) status(message);
        } catch (error) {
          if (current(s)) status(error.message);
        }
        focus();
      }
    }, { signal: listeners.signal });
    root.addEventListener("mouseover", async (event) => {
      const target = event.target.closest("[data-hover]");
      if (!target || !session) return;
      const s = session, run = ++hoverSerial;
      hover.hidden = false;
      hover.textContent = "Loading…";
      const rect = target.getBoundingClientRect();
      hover.style.left = Math.max(8, Math.min(rect.left, window2.innerWidth - 440)) + "px";
      hover.style.top = Math.max(8, Math.min(rect.bottom + 8, window2.innerHeight - 230)) + "px";
      try {
        const p = await product(s, target.dataset.hover);
        if (!current(s) || run !== hoverSerial) return;
        const image = /^https?:|^\//i.test(p.img || "") ? `<img src="${escapeHtml(p.img)}" alt="">` : "";
        hover.innerHTML = image + `<b>${escapeHtml(p.title)}</b><p>DIMENSIONS ${escapeHtml(p.dimensions)}</p><p>WEIGHT ${escapeHtml(p.weight)}</p><p>SORTABLE ${p.sortable === true ? "TRUE" : p.sortable === false ? "FALSE" : "UNKNOWN"}</p>`;
      } catch (error) {
        if (current(s) && run === hoverSerial) hover.textContent = error.message;
      }
    }, { signal: listeners.signal });
    root.addEventListener("mouseout", (event) => {
      if (event.target.closest("[data-hover]")) {
        hoverSerial++;
        hover.hidden = true;
      }
    }, { signal: listeners.signal });
    d.head.append(style);
    d.body.prepend(root);
    focus();
    return { scan, reset, root, getState: () => session, dispose() {
      disposed = true;
      session?.controller.abort();
      listeners.abort();
      root.remove();
      style.remove();
    } };
  }

  // tote-entry.mjs
  var VERSION = "0.1.2";
  var page = typeof unsafeWindow === "object" ? unsafeWindow : window;
  var guard = Symbol.for("tampermonkey.v4.tote.installer");
  if (!page[guard]) {
    let start = function() {
      if (location.origin === "https://jp.item-measurement.aft.a2z.com") {
        const release2 = registerWatermark(window, "TOTE", VERSION), capture = installMeasurementCapture({ page, storage });
        stop = () => {
          capture();
          release2();
        };
        return;
      }
      const warehouse = location.pathname.match(/^\/([A-Z0-9-]{2,12})\/results(?:\/|$)/)?.[1];
      if (!warehouse || location.hash.startsWith("#iss-console")) return;
      const release = registerWatermark(window, "TOTE", VERSION);
      if (!location.hash.startsWith("#fcr-tote-checker")) {
        const controller = new window.AbortController();
        document.addEventListener("click", (event) => {
          const cell = event.target.closest?.("th,td");
          if (event.button !== 0 || !cell || clean2(cell.textContent).toLowerCase() !== "dimensions" || !cell.closest('[data-section-type="product"]')) return;
          event.preventDefault();
          event.stopPropagation();
          const url = new URL(location.href);
          url.search = "";
          url.searchParams.set("fcrMode", "tote-audit");
          url.hash = "#fcr-tote-checker";
          location.assign(url.href);
        }, { capture: true, signal: controller.signal });
        stop = () => {
          controller.abort();
          release();
        };
        return;
      }
      window.stop();
      if (!document.head) document.documentElement.prepend(document.createElement("head"));
      if (!document.body) document.documentElement.append(document.createElement("body"));
      document.body.replaceChildren();
      document.title = "FC-Lite Tote Audit • " + warehouse;
      const reader = createFcrReader({ origin: location.origin, warehouse, fetch: page.fetch.bind(page), DOMParser: window.DOMParser, onEvidence: emit });
      const auth = createMeasurementAuth({ window, storage, onEvidence: emit });
      const enrichment = createFcrEnrichment({
        warehouse,
        readJson: createGmJsonReader(GM_xmlhttpRequest),
        getMeasurementAuth: auth.acquire,
        onEvidence: emit,
        uuid: () => window.crypto.randomUUID?.() || [...window.crypto.getRandomValues(new Uint32Array(4))].join("-"),
        historyFallback: async (code, { signal }) => {
          const end = /* @__PURE__ */ new Date(), start2 = new Date(end.getTime() - 30 * 864e5);
          const result = await reader.history(code, { signal, startDate: start2.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10), allowPartial: true });
          const doc = new DOMParser().parseFromString(result.html, "text/html");
          return { madcat: /\bMADCAT\b/i.test(doc.querySelector("#table-inventory-history")?.textContent || ""), complete: result.complete, rows: doc.querySelectorAll("tbody tr").length };
        }
      });
      const audit = createToteAudit({ window, reader, enrichment, warehouse, version: VERSION, onEvidence: emit, fetch: page.fetch.bind(page) });
      stop = () => {
        audit.dispose();
        release();
      };
      emit({ type: "script.start", intent: "read", data: { context: "tote-audit" } });
    };
    page[guard] = { version: VERSION };
    const storage = { get: (key, fallback) => GM_getValue(key, fallback), set: (key, value) => GM_setValue(key, value), listen: (key, callback) => GM_addValueChangeListener(key, callback), remove: (id) => GM_removeValueChangeListener(id) };
    let stop = () => {
    };
    const emit = (data) => evidence(window, "TOTE", VERSION, data);
    start();
    window.addEventListener("pagehide", () => stop());
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) start();
    });
    let context = location.pathname + location.hash.match(/^#(?:fcr-tote-checker|iss-console)/)?.[0];
    const navigate = () => {
      const next = location.pathname + location.hash.match(/^#(?:fcr-tote-checker|iss-console)/)?.[0];
      if (next !== context) {
        context = next;
        stop();
        start();
      }
    };
    window.addEventListener("hashchange", navigate);
    window.addEventListener("popstate", navigate);
  }
})();
