// ==UserScript==
// @name V4 Dropzone Selector Queue
// @namespace https://github.com/1Sirkkris/tampermonkey-v4
// @version 0.1.0
// @description Native dropzones, durable queue and exact native destination verification.
// @include /^https?:\/\/aft-moveapp-[^\/.]+(?:\.nrt)?\.proxy\.amazon\.com\/move-container(?:[\/?#]|$)/
// @grant unsafeWindow
// @grant GM_xmlhttpRequest
// @connect aft-moveapp-nrt-nrt.nrt.proxy.amazon.com
// @connect fcresearch-fe.aka.amazon.com
// @connect qi-fcresearch-fe.corp.amazon.com
// @connect qi-fcresearch-jp.corp.amazon.com
// @connect qifcr.fe.aftx.amazonoperations.app
// @run-at document-start
// @updateURL https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Dropzone_Selector_Queue.user.js
// @downloadURL https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Dropzone_Selector_Queue.user.js
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

  // native-json.mjs
  var NativeRequestError = class extends Error {
    constructor(message, { outcome = "REJECTED", status = 0 } = {}) {
      super(message);
      this.outcome = outcome;
      this.status = status;
    }
  };

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

  // drop-runtime.mjs
  function createDropzoneQueue({ window: window2, move, identity, version, onEvidence = () => {
  }, storage = window2.localStorage }) {
    const d = window2.document, key = "tm-v4.drop.rows", prefKey = "tm-v4.drop.preferences", listeners = new window2.AbortController();
    let journal, owner = false, running = false, processing = false, disposed = false, currentRow = null, controller = null, runPromise = null, observer = null, lastStep = false;
    let prefs = { floor: "", type: "PRIME", enabled: true, inputEnabled: true };
    try {
      Object.assign(prefs, JSON.parse(storage.getItem(prefKey) || "{}"));
    } catch {
    }
    const uuid = () => window2.crypto.randomUUID?.() || [...window2.crypto.getRandomValues(new Uint32Array(4))].join("-");
    const load = () => journal = createOperationJournal({ storage, key, normalize: normalizeHierarchyContainer, uuid });
    const root = d.createElement("aside");
    root.id = "tm-v4-drop";
    root.dataset.tmV4Script = "DROP";
    const style = d.createElement("style");
    style.dataset.tmV4Style = "DROP";
    style.textContent = `#tm-v4-drop{position:fixed;right:10px;bottom:10px;z-index:999999;width:360px;max-width:calc(100vw - 20px);background:rgba(28,28,28,.94);color:white;border:1px solid #ffffff38;border-radius:10px;box-shadow:0 3px 14px #0005;padding:9px;font:12px Arial,sans-serif;box-sizing:border-box}#tm-v4-drop[hidden]{display:none}#tm-v4-drop header{display:flex;justify-content:space-between;align-items:center;margin-bottom:7px}#tm-v4-drop button{cursor:pointer;border:1px solid #64748b;border-radius:5px;padding:5px;color:white;background:#435a77;font-weight:bold}#tm-v4-drop button:disabled{opacity:.5;cursor:default}#tm-v4-drop [data-selected=true]{outline:2px solid #fff}#tm-v4-drop .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin:7px 0}#tm-v4-drop .drops{grid-template-columns:repeat(3,1fr)}#tm-v4-drop textarea{width:100%;box-sizing:border-box;height:65px;background:#101010;color:white;border:1px solid #666;border-radius:6px;padding:6px;font:13px monospace}#tm-v4-drop .rows{max-height:155px;overflow:auto;background:#111;border-radius:6px;padding:4px}#tm-v4-drop [data-state=CONFIRMED]{color:#bfffcf}#tm-v4-drop [data-state=UNKNOWN],#tm-v4-drop [data-state=SUBMITTED]{color:#ffe08c}#tm-v4-drop [data-state=REJECTED]{color:#ffb3b3}#tm-v4-drop [data-action=run]{background:#176a3a}#tm-v4-drop [data-action=pause]{background:#a05b20}#tm-v4-drop [data-action=clear]{background:#6b3030}#tm-v4-drop .unable{background:#421b1b;color:#ffdada;padding:6px;border-radius:5px}#tm-v4-drop details{margin:7px 0}#tm-v4-drop select{max-width:100%}`;
    root.innerHTML = `<header><b>DZ Auto V4 ${escapeHtml(version)}</b><button data-action="enable"></button><b data-destination></b></header><button data-type="PRIME" style="width:100%;background:#6b55c9">PRIME • dz-P-PRIME</button><b>Floor</b><div class="grid">${["P1", "P2", "P3", "P4"].map((floor) => `<button data-floor="${floor}">${floor}</button>`).join("")}</div><b>Dropzone</b><div class="grid drops"></div><hr><b>Container Queue • API</b> <button data-action="input"></button><textarea autocomplete="off" spellcheck="false" placeholder="Scan/paste tsX / csX containers"></textarea><div class="unable" hidden></div><div class="grid" style="grid-template-columns:1fr 1fr"><button data-action="run">RUN</button><button data-action="pause">PAUSE</button></div><div data-counts></div><div role="status">Ready</div><div class="rows"></div><div class="grid" style="grid-template-columns:1fr 1fr"><button data-action="done">CLEAR DONE</button><button data-action="clear">CLEAR ALL</button></div><details><summary>Location verification</summary><label>Authenticated FCR host <select data-origin>${["https://fcresearch-fe.aka.amazon.com", "https://qi-fcresearch-fe.corp.amazon.com", "https://qi-fcresearch-jp.corp.amazon.com", "https://qifcr.fe.aftx.amazonoperations.app"].map((origin) => `<option value="${origin}">${origin}</option>`).join("")}</select></label></details>`;
    const input = root.querySelector("textarea"), status = (text2) => root.querySelector("[role=status]").textContent = text2;
    const origins = root.querySelector("[data-origin]");
    origins.value = storage.getItem("tm-v4.drop.fcr-origin") || "https://fcresearch-fe.aka.amazon.com";
    function render() {
      if (disposed || !journal) return;
      root.querySelector("[data-destination]").textContent = dropzone(prefs.floor, prefs.type) || "SELECT DZ";
      root.querySelector("[data-action=enable]").textContent = prefs.enabled ? "ON" : "OFF";
      root.querySelector("[data-action=input]").textContent = prefs.inputEnabled ? "INPUT ON" : "INPUT OFF";
      input.readOnly = !prefs.inputEnabled;
      root.querySelectorAll("[data-floor]").forEach((button) => {
        button.dataset.selected = String(button.dataset.floor === prefs.floor);
        button.disabled = processing;
      });
      root.querySelector("[data-type=PRIME]").disabled = processing;
      root.querySelector("[data-type=PRIME]").dataset.selected = String(prefs.type === "PRIME");
      root.querySelector(".drops").innerHTML = prefs.type === "PRIME" ? "PRIME selected (no DZ needed)" : (prefs.floor === "P1" ? DROPZONES.p1 : DROPZONES.upper).map(([type]) => `<button data-type="${escapeHtml(type)}" data-selected="${type === prefs.type}" ${processing ? "disabled" : ""}>${escapeHtml(type)}</button>`).join("");
      root.querySelector("[data-counts]").textContent = `${journal.rows.filter((row) => row.state === "QUEUED").length} queued • ${journal.rows.filter((row) => row.state === "CONFIRMED").length} done • ${journal.rows.filter((row) => ["SUBMITTED", "UNKNOWN"].includes(row.state)).length} unresolved`;
      root.querySelector(".rows").innerHTML = journal.rows.map((row) => `<div data-state="${row.state}"><b>${escapeHtml(row.container)}</b> → ${escapeHtml(row.destination)}<br>${row.state} ${escapeHtml(row.message)}</div>`).join("");
      root.querySelector("[data-action=run]").disabled = processing;
      origins.disabled = processing;
    }
    function persistPrefs() {
      storage.setItem(prefKey, JSON.stringify(prefs));
      render();
    }
    function transition(row, state, message) {
      journal.transition(row, state, message);
      render();
      if (["SUBMITTED", "CONFIRMED", "REJECTED", "UNKNOWN"].includes(state)) onEvidence({ type: "drop.operation", intent: "mutation", phase: state, operationId: row.operationId, data: { outcome: state, stage: row.phase || "move" } });
    }
    async function edit(work) {
      if (owner) return work();
      return withOperationLock(window2, "tm-v4.move-container.owner", async () => {
        load();
        return work();
      });
    }
    async function add() {
      const destination = dropzone(prefs.floor, prefs.type);
      if (!destination) throw new Error("Select exact floor/dropzone");
      const values = input.value.split(/[\s,;]+/).filter(Boolean), invalid = values.filter((value) => !normalizeHierarchyContainer(value) && upper(value) !== "123START");
      const valid = values.filter(normalizeHierarchyContainer);
      root.querySelector(".unable").hidden = !invalid.length;
      root.querySelector(".unable").textContent = "Unable: " + invalid.join(" • ");
      if (valid.length) await edit(() => journal.add(valid, { destination }));
      input.value = "";
      window2.sessionStorage.setItem("tm-v4.drop.draft", "");
      render();
    }
    function pause() {
      running = false;
      if (currentRow?.state === "READING") controller?.abort();
      status(currentRow?.state === "SUBMITTED" ? "PAUSED — submitted outcome still pending" : "Paused");
      render();
    }
    async function run() {
      if (processing || disposed) return;
      try {
        await add();
      } catch (error) {
        status(error.message);
        return;
      }
      processing = running = true;
      render();
      runPromise = withOperationLock(window2, "tm-v4.move-container.owner", async () => {
        owner = true;
        load();
        journal.save();
        identity();
        while (running && !disposed) {
          const row = journal.next();
          if (!row) break;
          currentRow = row;
          controller = new window2.AbortController();
          let submitted = false;
          transition(row, "READING", "Checking native location");
          try {
            await move(row, { signal: controller.signal, fcrOrigin: origins.value, checkRunning: () => {
              if (!running || disposed) throw new Error("Paused before movement");
            }, onPhase: (phase) => {
              row.phase = phase;
              journal.save();
              render();
            }, beforeMutation: () => {
              if (!running || disposed) throw new Error("Paused before movement");
              identity();
              row.operationId = uuid();
              transition(row, "SUBMITTED", "Submitted — verifying location");
              submitted = true;
            } });
            if (disposed) break;
            transition(row, "CONFIRMED", "Exact native destination verified");
            status("Moved ✓ " + row.container);
          } catch (error) {
            if (disposed) break;
            transition(row, submitted ? error.outcome === "REJECTED" ? "REJECTED" : "UNKNOWN" : !running || controller.signal.aborted ? "QUEUED" : "REJECTED", error.message);
            status(error.message);
            running = false;
          } finally {
            currentRow = null;
            controller = null;
          }
        }
      }).catch((error) => status(error.message)).finally(() => {
        owner = running = processing = false;
        runPromise = null;
        render();
      });
      await runPromise;
    }
    async function clear(doneOnly = false) {
      pause();
      if (runPromise) await runPromise;
      try {
        await edit(() => {
          if (doneOnly) journal.clearConfirmed();
          else journal.clear();
        });
        if (!doneOnly) input.value = "";
        render();
        status("Cleared safe rows; unresolved outcomes retained");
      } catch (error) {
        status(error.message);
      }
    }
    function autoDestination() {
      if (disposed || processing || !prefs.enabled) return;
      const host = d.querySelector("#root,#app,main") || d.body;
      if (!host) return;
      const text2 = [...host.childNodes].filter((node) => node !== root && !(node.nodeType === 1 && node.hasAttribute("data-tm-v4-script"))).map((node) => node.textContent).join(" ");
      const step = /scan destination container/i.test(text2);
      if (!step) {
        lastStep = false;
        return;
      }
      if (lastStep) return;
      const destination = dropzone(prefs.floor, prefs.type);
      if (!destination) {
        status("Select floor/dropzone");
        return;
      }
      const fields = [...host.querySelectorAll("input,textarea")].filter((node) => !node.closest("[data-tm-v4-script]") && !node.disabled && !node.readOnly && !node.hidden && window2.getComputedStyle(node).display !== "none");
      if (fields.length !== 1) {
        status("Native scan field missing/ambiguous");
        return;
      }
      lastStep = true;
      const target = fields[0], prototype = target.tagName === "TEXTAREA" ? window2.HTMLTextAreaElement.prototype : window2.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value").set.call(target, destination);
      target.dispatchEvent(new window2.Event("input", { bubbles: true }));
      target.dispatchEvent(new window2.Event("change", { bubbles: true }));
      target.focus();
      for (const type of ["keydown", "keypress", "keyup"]) {
        const event = new window2.KeyboardEvent(type, { key: "Enter", code: "Enter", bubbles: true, cancelable: true });
        for (const property of ["keyCode", "which"]) Object.defineProperty(event, property, { get: () => 13 });
        target.dispatchEvent(event);
      }
    }
    root.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      const action = button.dataset.action;
      if (button.dataset.floor && !processing) {
        prefs.floor = button.dataset.floor;
        prefs.type = "";
        lastStep = false;
        persistPrefs();
      }
      if (button.dataset.type && !processing) {
        prefs.type = button.dataset.type;
        lastStep = false;
        persistPrefs();
      }
      if (action === "enable") {
        prefs.enabled = !prefs.enabled;
        lastStep = false;
        persistPrefs();
      }
      if (action === "input") {
        prefs.inputEnabled = !prefs.inputEnabled;
        persistPrefs();
      }
      if (action === "run") void run();
      if (action === "pause") pause();
      if (action === "done") void clear(true);
      if (action === "clear") void clear(false);
      autoDestination();
    }, { signal: listeners.signal });
    input.addEventListener("input", () => window2.sessionStorage.setItem("tm-v4.drop.draft", input.value), { signal: listeners.signal });
    d.addEventListener("keydown", (event) => {
      if (event.altKey && ["=", "+"].includes(event.key)) {
        event.preventDefault();
        root.hidden = !root.hidden;
        return;
      }
      if (event.target !== input || !prefs.inputEnabled) return;
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (event.key === "Enter") {
        if (upper(input.value.split(/\r?\n/).at(-1)) === "123START") {
          event.preventDefault();
          input.value = input.value.replace(/123START\s*$/i, "");
          void run();
        } else if (running) {
          event.preventDefault();
          void add().catch((error) => status(error.message));
        }
      }
    }, { capture: true, signal: listeners.signal });
    for (const type of ["keypress", "keyup"]) d.addEventListener(type, (event) => {
      if (event.target === input && prefs.inputEnabled) {
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
    }, { capture: true, signal: listeners.signal });
    origins.addEventListener("change", () => storage.setItem("tm-v4.drop.fcr-origin", origins.value), { signal: listeners.signal });
    function ready() {
      const host = d.querySelector("#root,#app,main") || d.body;
      if (host) {
        observer = new window2.MutationObserver((records) => {
          if (records.every((record) => root.contains(record.target))) return;
          autoDestination();
        });
        observer.observe(host, { childList: true, subtree: true, characterData: true });
        autoDestination();
      }
    }
    try {
      load();
      input.value = window2.sessionStorage.getItem("tm-v4.drop.draft") || "";
      render();
    } catch (error) {
      status(error.message);
      root.querySelector("[data-action=run]").disabled = true;
    }
    d.documentElement.append(style, root);
    if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", ready, { once: true, signal: listeners.signal });
    else ready();
    return { root, run, pause, clear, getState: () => journal?.rows, dispose() {
      if (disposed) return;
      running = false;
      if (currentRow) {
        try {
          transition(currentRow, currentRow.state === "SUBMITTED" ? "UNKNOWN" : "QUEUED", "Page disposed — verify submitted outcome");
        } catch {
        }
      }
      disposed = true;
      controller?.abort();
      listeners.abort();
      observer?.disconnect();
      root.remove();
      style.remove();
    } };
  }

  // drop-entry.mjs
  var VERSION = "0.1.0";
  var page = typeof unsafeWindow === "object" ? unsafeWindow : window;
  var guard = Symbol.for("tampermonkey.v4.drop.installer");
  if (!page[guard]) {
    page[guard] = { version: VERSION };
    installRouteLifecycle(window, () => {
      if (!/^\/move-container(?:\/|$)/.test(location.pathname)) return;
      const release = registerWatermark(window, "DROP", VERSION), fetch = createGmFetch(window, GM_xmlhttpRequest), identity = () => resolveIdentity(window, page), emit = (data) => evidence(window, "DROP", VERSION, data);
      const move = (row, options) => {
        const reader = createFcrReader({ origin: options.fcrOrigin, warehouse: "BWU2", DOMParser: window.DOMParser, fetch, onEvidence: emit });
        return createMoveContainer({ window, fetch, reader, identity, onEvidence: emit })(row, options);
      };
      const queue = createDropzoneQueue({ window, move, identity, version: VERSION, onEvidence: emit });
      return () => {
        queue.dispose();
        release();
      };
    }, () => location.pathname);
  }
})();
