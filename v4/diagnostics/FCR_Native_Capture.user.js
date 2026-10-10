// ==UserScript==
// @name V4 FCR Native Capture
// @namespace https://github.com/1Sirkkris/tampermonkey-v4
// @version 0.1.3
// @description Manual native snapshots and opt-in passive response tracing; bounded/redacted; no actions.
// @match http://fcresearch-fe.aka.amazon.com/*
// @match https://fcresearch-fe.aka.amazon.com/*
// @match http://qi-fcresearch-fe.corp.amazon.com/*
// @match https://qi-fcresearch-fe.corp.amazon.com/*
// @match http://qi-fcresearch-jp.corp.amazon.com/*
// @match https://qi-fcresearch-jp.corp.amazon.com/*
// @match http://qifcr.fe.aftx.amazonoperations.app/*
// @match https://qifcr.fe.aftx.amazonoperations.app/*
// @include /^https?:\/\/aft-qt-[^/]+\.corp\.amazon\.com\/app\/(?:edititems|moveitems|fcskuflip)/
// @include /^https?:\/\/aft-moveapp-[^\/.]+(?:\.nrt)?\.proxy\.amazon\.com\/move-container(?:[\/?#]|$)/
// @grant GM_registerMenuCommand
// @grant unsafeWindow
// @run-at document-start
// @updateURL https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/diagnostics/FCR_Native_Capture.user.js
// @downloadURL https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/diagnostics/FCR_Native_Capture.user.js
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

  // ui-tools.mjs
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

  // native-capture-redact.mjs
  var privateField = /pass|token|secret|csrf|auth|cookie|session|employee|associate|login|user(?:id|name)|email/i;
  var correlatedField = /^(?:object|workflow|request|transaction|correlation)[_-]?id$/i;
  function createCaptureRedactor(window2) {
    const containers = /* @__PURE__ */ new Map(), identifiers = /* @__PURE__ */ new Map();
    function alias(map, value, prefix) {
      if (!map.has(value)) map.set(value, prefix + String(map.size + 1).padStart(4, "0"));
      return map.get(value);
    }
    function text(value) {
      return String(value).replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED JWT]").replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]").replace(/(["']?(?:authorization|access[_-]?token|id[_-]?token|refresh[_-]?token|password|secret|csrf[_-]?token|csrf|cookie|session(?:[_-]?id|[_-]?token)?|employee(?:Login|Id)|associate(?:Login|Id)|user(?:Login|Id|Name)|email)["']?\s*[:=]\s*)(["'])[^\r\n]*?\2/gi, "$1$2[REDACTED]$2").replace(/(["']?(?:employee(?:Login|Id)|associate(?:Login|Id)|user(?:Login|Id|Name)|session(?:[_-]?id)?|csrf|password|secret)["']?\s*[:=]\s*)(?:-?\d+(?:\.\d+)?|true|false|null)(?=[\s,;}])/gi, '$1"[REDACTED]"').replace(
        /(["']?(?:object|workflow|request|transaction|correlation)[_-]?id["']?\s*[:=]\s*)(["'])([^\r\n]*?)\2/gi,
        (_match, key, quote, value2) => key + quote + alias(identifiers, value2, "IDCAPTURE") + quote
      ).replace(/\b(?:tsX|csX)[A-Za-z0-9_-]+\b/gi, (code) => alias(containers, code.toUpperCase(), code.slice(0, 3) + "CAPTURE"));
    }
    function url(raw) {
      const parsed = new window2.URL(raw, window2.location.href);
      parsed.username = "";
      parsed.password = "";
      for (const [key, value] of [...parsed.searchParams]) {
        if (privateField.test(key)) parsed.searchParams.set(key, "[REDACTED]");
        else if (correlatedField.test(key)) parsed.searchParams.set(key, alias(identifiers, value, "IDCAPTURE"));
        else parsed.searchParams.set(key, text(value));
      }
      parsed.pathname = text(parsed.pathname);
      parsed.hash = privateField.test(parsed.hash) ? "[REDACTED]" : text(parsed.hash);
      return parsed.href;
    }
    function scrubDocument(doc) {
      doc.querySelectorAll("input,textarea,select").forEach((node) => {
        if (!privateField.test(node.name + " " + node.id + " " + node.type)) {
          if (correlatedField.test(node.name) || correlatedField.test(node.id)) {
            node.setAttribute("value", alias(identifiers, node.value, "IDCAPTURE"));
            if (node.tagName !== "INPUT") node.textContent = node.getAttribute("value");
          }
          return;
        }
        node.setAttribute("value", "[REDACTED]");
        if (node.tagName !== "INPUT") node.textContent = "[REDACTED]";
      });
      doc.querySelectorAll("meta[name]").forEach((node) => {
        if (privateField.test(node.name)) node.setAttribute("content", "[REDACTED]");
      });
    }
    function body(raw) {
      const value = String(raw);
      let parsed;
      try {
        parsed = JSON.parse(value);
      } catch {
      }
      if (parsed !== void 0) {
        let walk = function(value2, depth = 0) {
          if (++nodes > 1e4 || depth > 32) throw new Error("Redaction structure limit reached");
          if (Array.isArray(value2)) return value2.map((item) => walk(item, depth + 1));
          if (value2 && typeof value2 === "object") return Object.fromEntries(Object.entries(value2).map(([key, item]) => [
            key,
            privateField.test(key) ? "[REDACTED]" : correlatedField.test(key) && (typeof item === "string" || typeof item === "number") ? alias(identifiers, String(item), "IDCAPTURE") : walk(item, depth + 1)
          ]));
          return typeof value2 === "string" ? text(value2) : value2;
        };
        let nodes = 0;
        return JSON.stringify(walk(parsed));
      }
      if (/^\s*</.test(value)) {
        const doc = new window2.DOMParser().parseFromString(value, "text/html");
        scrubDocument(doc);
        return text(doc.documentElement.outerHTML);
      }
      if (/^[\w.%+-]+=[^\r\n]*$/.test(value)) {
        const form = new window2.URLSearchParams(value);
        for (const [key, item] of [...form]) {
          form.set(key, privateField.test(key) ? "[REDACTED]" : correlatedField.test(key) ? alias(identifiers, item, "IDCAPTURE") : text(item));
        }
        return form.toString();
      }
      return text(value);
    }
    return { text, url, body, scrubDocument };
  }

  // native-contract-trace.mjs
  function selected(window2, workflow, raw, method) {
    if (!/^(?:GET|POST)$/i.test(method)) return false;
    try {
      const url = new window2.URL(raw, window2.location.href);
      if (url.origin !== window2.location.origin || url.username || url.password) return false;
      if (workflow === "FCR") return /^\/[A-Z0-9-]+\/results\/(?:container-hierarchy(?:-up)?|inventory)$/.test(url.pathname);
      if (workflow === "AFT") return /^\/(?:instruction|status|action|end)$/.test(url.pathname) || method.toUpperCase() === "GET" && /^\/app\/(?:edititems|moveitems|fcskuflip)$/.test(url.pathname);
      return workflow === "MoveContainer" && url.pathname === "/api/move-container";
    } catch {
      return false;
    }
  }
  function createNativeContractTrace({
    window: window2,
    page = window2,
    workflow,
    version,
    maxRecords = 100,
    maxBytes = 4e6,
    maxBody = 25e4,
    durationMs = 18e4,
    onStop = () => {
    }
  }) {
    const redact = createCaptureRedactor(window2), records = [], readers = /* @__PURE__ */ new Set(), listeners = /* @__PURE__ */ new Set(), xhrDetails = /* @__PURE__ */ new WeakMap();
    const startedAt = (/* @__PURE__ */ new Date()).toISOString(), pageUrl = redact.url(window2.location.href);
    const originalFetch = page.fetch, proto = page.XMLHttpRequest?.prototype, originalOpen = proto?.open, originalSend = proto?.send;
    let active = true, reason = null, stoppedAt = null, bytes = 0, timer;
    const size = (text) => new window2.Blob([text]).size;
    const errorName = (error) => /^[A-Za-z]*Error$/.test(error?.name) ? error.name : "Error";
    function capturedBody(raw) {
      if (typeof raw !== "string") return { state: "UNAVAILABLE", reason: "Nontext body not collected" };
      if (size(raw) > maxBody) return { state: "OMITTED_LIMIT", reason: "Body size limit" };
      try {
        const body = redact.body(raw), length = size(body);
        if (length > maxBody || bytes + length > maxBytes) return { state: "OMITTED_LIMIT", reason: "Body/total size limit" };
        bytes += length;
        return { state: "CAPTURED", body };
      } catch {
        return { state: "UNAVAILABLE", reason: "Body redaction failed or exceeded structural limit" };
      }
    }
    function begin(rawUrl, method, body, transport, requestObject = false) {
      if (!active || !selected(window2, workflow, rawUrl, method)) return null;
      if (records.length >= maxRecords) {
        stop("record-limit");
        return null;
      }
      let request;
      if (body == null) request = requestObject && method.toUpperCase() !== "GET" ? { state: "UNAVAILABLE", reason: "Request body not synchronously supplied; original Request untouched" } : { state: "ABSENT" };
      else if (typeof body === "string") request = capturedBody(body);
      else if (body instanceof window2.URLSearchParams) request = capturedBody(body.toString());
      else request = { state: "UNAVAILABLE", reason: "Nontext request body not collected" };
      const record = {
        id: "CAPTURE" + String(records.length + 1).padStart(4, "0"),
        transport,
        method: String(method).toUpperCase(),
        url: redact.url(rawUrl),
        startedAt: (/* @__PURE__ */ new Date()).toISOString(),
        request,
        response: { state: "PENDING" }
      };
      records.push(record);
      return record;
    }
    function finish(record, response) {
      if (!active || record.response.state !== "PENDING") return;
      record.response = { ...response, finishedAt: (/* @__PURE__ */ new Date()).toISOString() };
      if (bytes >= maxBytes) stop("byte-limit");
    }
    function responseMetadata(response, fallback) {
      let url;
      let finalUrlMatchesRequest = false;
      try {
        const raw = response.responseURL || response.url || fallback;
        finalUrlMatchesRequest = new window2.URL(raw, window2.location.href).href === new window2.URL(fallback, window2.location.href).href;
        url = redact.url(raw);
      } catch {
        url = "[INVALID URL]";
      }
      return { status: Number(response.status) || 0, url, redirected: !!response.redirected, finalUrlMatchesRequest };
    }
    async function readClone(clone) {
      if (clone.body === null) return { state: "CAPTURED", body: "" };
      if (typeof clone.body?.getReader !== "function") return { state: "UNAVAILABLE", reason: "Bounded response stream unavailable" };
      const decoder = new window2.TextDecoder(), reader = clone.body.getReader();
      readers.add(reader);
      let raw = "", length = 0;
      try {
        while (active) {
          const { done, value } = await reader.read();
          if (!active) return null;
          if (done) return capturedBody(raw + decoder.decode());
          length += value.byteLength;
          if (length > maxBody || bytes + length > maxBytes) {
            void reader.cancel().catch(() => {
            });
            return { state: "OMITTED_LIMIT", reason: "Body/total stream size limit" };
          }
          raw += decoder.decode(value, { stream: true });
        }
        return null;
      } finally {
        readers.delete(reader);
      }
    }
    const fetchWrapper = function(input, init) {
      const options = init || {}, rawUrl = typeof input === "string" || input instanceof window2.URL ? String(input) : input?.url;
      let record;
      try {
        record = begin(rawUrl, options.method || input?.method || "GET", options.body, "fetch", !!input?.url);
      } catch {
      }
      let promise;
      try {
        promise = originalFetch.apply(this, arguments);
      } catch (error) {
        if (record) finish(record, { state: "FAILED", reason: "Native fetch threw " + errorName(error) });
        throw error;
      }
      if (record) {
        try {
          void promise.then((response) => {
            if (!active) return;
            let clone, metadata;
            try {
              metadata = responseMetadata(response, rawUrl);
              clone = response.clone();
            } catch {
              finish(record, { state: "UNAVAILABLE", reason: "Native response clone unavailable" });
              return;
            }
            void readClone(clone).then(
              (body) => {
                if (body) finish(record, { ...metadata, ...body });
              },
              (error) => finish(record, { ...metadata, state: "FAILED", reason: "Clone read failed " + errorName(error) })
            );
          }, (error) => finish(record, { state: "FAILED", reason: "Native fetch rejected " + errorName(error) }));
        } catch {
          finish(record, { state: "UNAVAILABLE", reason: "Native fetch is not observable as a Promise" });
        }
      }
      return promise;
    };
    function openWrapper(method, url) {
      const result = originalOpen.apply(this, arguments);
      try {
        if (active) xhrDetails.set(this, { method: String(method), url: String(url) });
      } catch {
      }
      return result;
    }
    function sendWrapper(body) {
      const details = xhrDetails.get(this);
      let record;
      try {
        if (details) record = begin(details.url, details.method, body, "xhr");
      } catch {
      }
      if (!record) return originalSend.apply(this, arguments);
      const xhr = this;
      let failure = null;
      const error = (event) => {
        failure = event.type;
      };
      const cleanup = () => {
        xhr.removeEventListener("loadend", ended);
        for (const type of ["error", "abort", "timeout"]) xhr.removeEventListener(type, error);
        listeners.delete(cleanup);
      };
      const ended = () => {
        cleanup();
        if (!active) return;
        try {
          const metadata = responseMetadata(xhr, details.url);
          const raw = xhr.responseType === "json" ? JSON.stringify(xhr.response) : !xhr.responseType || xhr.responseType === "text" ? xhr.responseText : null;
          finish(record, { ...metadata, ...failure ? { state: "FAILED", reason: "Native XHR " + failure } : capturedBody(raw) });
        } catch {
          finish(record, { state: "UNAVAILABLE", reason: "Native XHR response inaccessible" });
        }
      };
      listeners.add(cleanup);
      xhr.addEventListener("loadend", ended, { once: true });
      for (const type of ["error", "abort", "timeout"]) xhr.addEventListener(type, error);
      try {
        return originalSend.apply(this, arguments);
      } catch (error2) {
        cleanup();
        finish(record, { state: "FAILED", reason: "Native XHR send threw " + errorName(error2) });
        throw error2;
      }
    }
    function stop(why = "manual") {
      if (!active) return snapshot();
      active = false;
      reason = why;
      stoppedAt = (/* @__PURE__ */ new Date()).toISOString();
      window2.clearTimeout(timer);
      if (page.fetch === fetchWrapper) page.fetch = originalFetch;
      if (proto?.open === openWrapper) proto.open = originalOpen;
      if (proto?.send === sendWrapper) proto.send = originalSend;
      for (const cleanup of [...listeners]) cleanup();
      for (const reader of readers) {
        try {
          void reader.cancel().catch(() => {
          });
        } catch {
        }
      }
      readers.clear();
      for (const record of records) if (record.response.state === "PENDING") record.response = {
        state: "INTERRUPTED",
        reason: "Trace stopped before native response was captured",
        finishedAt: stoppedAt
      };
      try {
        onStop(why);
      } catch {
      }
      return snapshot();
    }
    function snapshot() {
      return {
        diagnostic: workflow + " passive native response trace",
        workflow,
        version,
        page: pageUrl,
        startedAt,
        stoppedAt,
        reason,
        records,
        limits: { maxRecords, maxBytes, maxBody, durationMs, capturedBodyBytes: bytes },
        warnings: [
          "Passive observation only: no native request, input or workflow action is initiated.",
          "Native status/body are evidence, never automatic confirmation of an operation or authentication.",
          "No cookies, browser storage or request/response headers collected. Review remaining text before sharing.",
          "Container and workflow/request aliases correlate only within this file; originals/mappings are not exported.",
          "Pending, failed, omitted and unavailable responses are explicit; late results after Stop are not collected."
        ]
      };
    }
    try {
      if (typeof originalFetch === "function") page.fetch = fetchWrapper;
      if (typeof originalOpen === "function" && typeof originalSend === "function") {
        proto.open = openWrapper;
        proto.send = sendWrapper;
      }
    } catch {
      stop("transport-unavailable");
      throw new Error("Native trace transport is unavailable; no request sent");
    }
    timer = window2.setTimeout(() => stop("duration-limit"), durationMs);
    return { stop, get active() {
      return active;
    }, dispose() {
      stop("navigation/disposal");
      records.length = 0;
    } };
  }

  // native-capture-entry.mjs
  var VERSION = "0.1.3";
  var guard = Symbol.for("tampermonkey.v4.native-capture");
  function scope(location2) {
    if (/^(?:fcresearch-fe\.aka\.amazon\.com|qi-fcresearch-(?:fe|jp)\.corp\.amazon\.com|qifcr\.fe\.aftx\.amazonoperations\.app)$/.test(location2.hostname)) return "FCR";
    if (/^aft-qt-[^.]+(?:\.[^.]+)*\.corp\.amazon\.com$/.test(location2.hostname) && /^\/app\/(?:edititems|moveitems|fcskuflip)(?:\/|$)/.test(location2.pathname)) return "AFT";
    if (/^aft-moveapp-[^.]+(?:\.nrt)?\.proxy\.amazon\.com$/.test(location2.hostname) && /^\/move-container(?:\/|$)/.test(location2.pathname)) return "MoveContainer";
    return null;
  }
  if (!window[guard]) {
    window[guard] = { version: VERSION };
    let running = false, controller = null, objectUrl = null, releaseTimer = null, trace = null;
    const pageWindow = typeof unsafeWindow === "object" ? unsafeWindow : window;
    const revoke = () => {
      clearTimeout(releaseTimer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    };
    const cancel = (reason) => {
      controller?.abort(reason);
      trace?.dispose();
      trace = null;
      revoke();
    };
    installRouteLifecycle(window, () => {
      if (!scope(location)) return;
      const releaseFooter = registerWatermark(window, "FCAP", VERSION);
      return () => {
        cancel("navigation");
        releaseFooter();
      };
    }, () => location.hostname + location.pathname + location.search);
    GM_registerMenuCommand("Capture native contract (read-only) " + VERSION, async () => {
      if (running) return;
      const workflow = scope(location);
      if (!workflow) {
        alert("Native capture is unavailable on this route");
        return;
      }
      running = true;
      controller = new AbortController();
      const signal = controller.signal;
      const context = location.origin + location.pathname + location.search;
      const deadline = setTimeout(() => controller.abort("timeout"), 3e4);
      try {
        const redactor = createCaptureRedactor(window), redact = redactor.text, page = redactor.url(location.href);
        const clone = document.documentElement.cloneNode(true);
        clone.querySelectorAll("[data-tm-v4-master],[data-tm-v4-script],[data-tm-v4-style],iframe").forEach((node) => node.remove());
        redactor.scrubDocument(clone);
        const html = redact(clone.outerHTML);
        if (html.length > 16e6) throw new Error("Capture document limit reached");
        const scripts = [...document.scripts].filter((node) => !node.closest("[data-tm-v4-script],[data-tm-v4-master]")).slice(0, 80);
        const records = new Array(scripts.length);
        const evidence = {
          diagnostic: workflow + " native contract capture",
          workflow,
          version: VERSION,
          capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
          page,
          html,
          scripts: records,
          limits: [
            "Manual page/source snapshot only; not operation or authentication proof. No native workflow action is invoked.",
            "No cookies, request headers or browser storage are collected. Page script assets use GET only.",
            "Missing/CORS-blocked assets are explicit; no API endpoint capture or automatic operation replay.",
            "Container scans are pseudonymized consistently within this file; mappings are not exported. Review remaining text before sharing."
          ]
        };
        let next = 0, bytes = html.length;
        async function worker() {
          while (!signal.aborted && next < scripts.length) {
            const index = next++, script = scripts[index];
            const record = { index, type: script.type || "text/javascript", url: script.src ? redactor.url(script.src) : null, source: "" };
            records[index] = record;
            try {
              let source = script.textContent;
              if (script.src) {
                const url = new URL(script.src);
                if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error("Unsupported script URL");
                const response = await fetch(url.href, { method: "GET", credentials: "same-origin", signal });
                if (!response.ok || response.redirected || response.url && new URL(response.url).origin !== url.origin) throw new Error("Asset HTTP/auth redirect");
                if (/text\/html/i.test(response.headers.get("Content-Type") || "")) throw new Error("Asset returned HTML instead of source");
                source = await response.text();
              }
              if (source.length > 4e6 || bytes + source.length > 16e6) throw new Error("Capture source limit reached");
              bytes += source.length;
              record.source = redact(source);
            } catch (error) {
              record.error = redact(String(error.message || error));
            }
          }
        }
        await Promise.all([worker(), worker()]);
        if (signal.aborted || context !== location.origin + location.pathname + location.search) throw new Error("Capture cancelled or timed out — no file downloaded");
        revoke();
        objectUrl = URL.createObjectURL(new Blob([JSON.stringify(evidence, null, 2)], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = workflow + "_native_capture_" + (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-") + ".json";
        document.body.append(link);
        link.click();
        link.remove();
        releaseTimer = setTimeout(revoke, 1e3);
      } catch (error) {
        if (signal.reason !== "navigation") alert("Native capture failed: " + String(error.message || error));
      } finally {
        clearTimeout(deadline);
        running = false;
        controller = null;
      }
    });
    GM_registerMenuCommand("Start passive native response trace " + VERSION, () => {
      const workflow = scope(location);
      if (!workflow) {
        alert("Native trace is unavailable on this route");
        return;
      }
      if (trace?.active) {
        alert("A native trace is already active; use Stop and export");
        return;
      }
      trace?.dispose();
      trace = null;
      try {
        trace = createNativeContractTrace({ window, page: pageWindow, workflow, version: VERSION });
        alert("Passive native trace started for up to 3 minutes. No native action is initiated. Use Stop and export before navigation. Live operational actions still require an explicitly approved test case.");
      } catch (error) {
        alert("Native trace failed: " + String(error.message || error));
      }
    });
    GM_registerMenuCommand("Stop and export native response trace " + VERSION, () => {
      if (!trace) {
        alert("No native trace available on this route");
        return;
      }
      const evidence = trace.stop();
      revoke();
      objectUrl = URL.createObjectURL(new Blob([JSON.stringify(evidence, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = evidence.workflow + "_native_trace_" + (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-") + ".json";
      document.body.append(link);
      link.click();
      link.remove();
      releaseTimer = setTimeout(revoke, 1e3);
      trace.dispose();
      trace = null;
    });
  }
})();
