// ==UserScript==
// @name         V4 OBS
// @namespace    https://github.com/1Sirkkris/-tampermonkey-v2/v4
// @version      0.1.4
// @description  Independent native-page evidence and explicit V4 operation transcripts.
// @include      /^https?:\/\/(?:[^\/]*fcresearch[^\/]*|qifcr\.fe\.aftx\.amazonoperations\.app)\//
// @include      /^https?:\/\/aft-poirot-website-nrt\.nrt\.proxy\.amazon\.com\//
// @include      /^https?:\/\/aft-qt-[^\/]+\.corp\.amazon\.com\//
// @include      /^https?:\/\/aft-moveapp-[^\/]+\.proxy\.amazon\.com\//
// @include      /^https?:\/\/tx-b-hierarchy-nrt\.nrt\.proxy\.amazon\.com\//
// @include      /^https?:\/\/fba-fnsku-commingling-console-(?:eu|na|jp)\.aka\.amazon\.com\//
// @include      /^https?:\/\/(?:t\.corp\.amazon\.com|river\.amazon\.com|aftcartonpreditorapp-tcp-nrt\.nrt\.proxy\.amazon\.com|jp\.item-measurement\.aft\.a2z\.com)\//
// @include      /^https?:\/\/console\.harmony\.a2z\.com\/poportal(?:[/?#]|$)/
// @include      /^https?:\/\/fcmenu-(?:iad|nrt)-regionalized\.corp\.amazon\.com\//
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/OBS.user.js
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/OBS.user.js
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

  // native-hook.mjs
  var FORWARD = Symbol.for("tampermonkey.v4.native.forward");
  function forwardHook(wrapper, original) {
    Object.defineProperty(wrapper, FORWARD, { value: original });
    return wrapper;
  }

  // obs-entry.mjs
  (() => {
    "use strict";
    const VERSION = "0.1.4";
    const PAGE = typeof unsafeWindow === "object" && unsafeWindow ? unsafeWindow : window;
    const GUARD = Symbol.for("tampermonkey.v4.obs.document");
    if (PAGE[GUARD]) return;
    PAGE[GUARD] = true;
    const PREFIX = "tm-v4.obs.";
    const META = PREFIX + "session";
    const REVISION = PREFIX + "revision";
    const SHARDS = PREFIX + "page.";
    const BUS = "tampermonkey-v4:evidence";
    const PHASES = /* @__PURE__ */ new Set(["SUBMITTED", "CONFIRMED", "REJECTED", "UNKNOWN"]);
    const SECRET = /authorization|cookie|credential|csrf|password|passwd|secret|signature|token|api.?key|x-amz/i;
    const RAW = /^(?:headers|body|requestBody|responseBody|responseText|raw)$/i;
    const IDENTIFIER = /^(?:asin|fnsku|fcsku|barcode|container|employee|login|lpn|scannable|source|destination)$/i;
    const uid = () => typeof crypto.randomUUID === "function" ? crypto.randomUUID() : [...crypto.getRandomValues(new Uint32Array(4))].map((n) => n.toString(16).padStart(8, "0")).join("-");
    const pageId = uid();
    const shardKey = () => SHARDS + epoch + "." + pageId;
    const timers = /* @__PURE__ */ new Set();
    const readers = /* @__PURE__ */ new Set();
    const objectUrls = /* @__PURE__ */ new Set();
    const storageErrors = /* @__PURE__ */ new Map();
    const xhrDetails = /* @__PURE__ */ new WeakMap();
    const routine = /* @__PURE__ */ new Map();
    let events = [];
    let keys = /* @__PURE__ */ new Set();
    let epoch = "initial";
    let trustedSession = { id: "initial", startedAt: 0, mode: "normal" };
    let running = false;
    let releaseWatermark = () => {
    };
    let sequence = 0;
    let dirty = false;
    let exportError = "";
    let total = 0;
    let pendingCount = 0;
    let flushTimer = null;
    let routineTimer = null;
    let controller = null;
    let headerObserver = null;
    let headerParent = null;
    let headerRow = null;
    let ui = null;
    let ownedStyle = null;
    let metaListener = null;
    let revisionListener = null;
    let restoreFetch = () => {
    };
    let restoreXhr = () => {
    };
    const storeError = () => storageErrors.values().next().value || "";
    function later(fn, ms) {
      const id = setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
      return id;
    }
    function cancel(id) {
      if (id != null) {
        clearTimeout(id);
        timers.delete(id);
      }
    }
    function get(key, fallback) {
      try {
        const value = GM_getValue(key, fallback);
        storageErrors.delete("get:" + key);
        return value;
      } catch (error) {
        storageErrors.set("get:" + key, "Storage read failed");
        return fallback;
      }
    }
    function set(key, value) {
      try {
        GM_setValue(key, value);
        storageErrors.delete("set:" + key);
        return true;
      } catch (error) {
        storageErrors.set("set:" + key, "Storage write failed");
        return false;
      }
    }
    function list() {
      try {
        const values = GM_listValues();
        storageErrors.delete("list");
        return values;
      } catch (error) {
        storageErrors.set("list", "Storage list failed");
        return [];
      }
    }
    function readSession() {
      try {
        const value = JSON.parse(get(META, "null"));
        if (storageErrors.has("get:" + META)) return trustedSession;
        if (value !== null && !(value && typeof value.id === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(value.id) && Number.isFinite(value.startedAt) && ["normal", "fat"].includes(value.mode))) throw new Error("Invalid session");
        storageErrors.delete("parse:session");
        trustedSession = value || { id: "initial", startedAt: 0, mode: "normal" };
        return trustedSession;
      } catch (error) {
        storageErrors.set("parse:session", "Invalid session metadata");
      }
      return trustedSession;
    }
    function sync() {
      const current = readSession();
      if (current.id !== epoch) {
        epoch = current.id;
        events = [];
        keys.clear();
        routine.clear();
        total = pendingCount = 0;
        dirty = false;
        cancel(flushTimer);
        flushTimer = null;
        cancel(routineTimer);
        routineTimer = null;
        for (const reader of readers) {
          void reader.cancel().catch(() => {
          });
        }
        readers.clear();
      }
      return current;
    }
    const fat = () => readSession().mode === "fat";
    const limit = () => fat() ? 5e4 : 6e3;
    function fingerprint(value) {
      let h = 2166136261;
      for (const char of String(value)) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
      return "id:" + (h >>> 0).toString(16);
    }
    function safeUrl(value) {
      try {
        const url = new URL(String(value), location.href);
        const path = url.pathname.split("/").map(
          (part) => /^(?:[a-f0-9-]{20,}|B0[A-Z0-9]{8}|X0[A-Z0-9]{8}|(?:tsX|csX)[a-zA-Z0-9]+)$/i.test(part) ? fingerprint(part) : part.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 80)
        ).join("/");
        return url.origin + path;
      } catch (error) {
        return "[invalid URL]";
      }
    }
    function safeText(value) {
      return String(value).replace(/https?:\/\/[^\s"'<>]+/gi, safeUrl).replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]").replace(/\b(?:authorization|cookie)\s*:\s*[^\r\n]*/gi, "[REDACTED]").replace(/\b(?:password|secret|token|csrf|api[_-]?key)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "[REDACTED]").replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?\b/g, "[REDACTED]").slice(0, 800);
    }
    function sanitize(value, key = "", depth = 0, seen = /* @__PURE__ */ new WeakSet()) {
      if (SECRET.test(key) || RAW.test(key)) return "[REDACTED]";
      if (value == null || typeof value === "boolean") return value;
      if (typeof value === "number") return Number.isFinite(value) ? value : null;
      if (typeof value === "string") {
        if (IDENTIFIER.test(key)) return fingerprint(value);
        return /url|href/i.test(key) ? safeUrl(value) : safeText(value);
      }
      if (typeof value !== "object") return "[unsupported]";
      if (depth >= 4 || seen.has(value)) return "[bounded]";
      seen.add(value);
      const out = Array.isArray(value) ? value.slice(0, 30).map((x) => sanitize(x, key, depth + 1, seen)) : Object.fromEntries(Object.entries(value).slice(0, 40).map(([k, v]) => [safeText(k), sanitize(v, k, depth + 1, seen)]));
      seen.delete(value);
      return out;
    }
    function eventKey(event) {
      return event.intent === "mutation" && event.operationId && event.phase ? "operation:" + event.operationId + ":" + event.phase : "event:" + event.eventId;
    }
    function snapshot() {
      sync();
      const merged = [];
      for (const key of list()) {
        if (!key.startsWith(SHARDS + epoch + ".") || key === shardKey()) continue;
        try {
          const shard = JSON.parse(get(key, "null"));
          if (!shard || typeof shard.epoch !== "string" || !Array.isArray(shard.events)) throw new Error("Invalid shard");
          if (shard.events.some((event) => !event || typeof event.eventId !== "string" || !Number.isFinite(event.ts))) throw new Error("Invalid stored event");
          storageErrors.delete("parse:" + key);
          if (shard.epoch === epoch) merged.push(...shard.events.slice(0, 5e4));
        } catch (error) {
          storageErrors.set("parse:" + key, "Invalid evidence shard");
        }
      }
      merged.push(...events);
      const phaseOrder = { SUBMITTED: 0, REJECTED: 1, UNKNOWN: 2, CONFIRMED: 3 };
      merged.sort((a, b) => a.ts - b.ts || (a.operationId && a.operationId === b.operationId ? phaseOrder[a.phase] - phaseOrder[b.phase] : 0) || String(a.pageId).localeCompare(String(b.pageId)) || a.sequence - b.sequence);
      const unique = /* @__PURE__ */ new Map();
      for (const event of merged) {
        if (!event || typeof event.eventId !== "string" || !Number.isFinite(event.ts)) continue;
        const key = eventKey(event);
        if (!unique.has(key)) unique.set(key, event);
      }
      total = unique.size;
      pendingCount = 0;
      return [...unique.values()].slice(0, limit());
    }
    function flush() {
      cancel(flushTimer);
      flushTimer = null;
      sync();
      if (!dirty) return true;
      if (!set(shardKey(), JSON.stringify({ epoch, events }))) {
        render();
        return false;
      }
      dirty = false;
      set(REVISION, uid());
      render();
      return true;
    }
    function record(type, data = {}, owner = {}) {
      if (!running) return;
      sync();
      const seq = ++sequence;
      const event = {
        eventId: owner.eventId || pageId + ":" + seq,
        sequence: seq,
        ts: Date.now(),
        pageId,
        type,
        script: owner.script || "OBS",
        version: owner.version || VERSION,
        route: safeUrl(location.href),
        data: sanitize(data)
      };
      if (owner.intent === "mutation") {
        event.intent = "mutation";
        event.operationId = owner.operationId;
        event.phase = owner.phase;
        event.evidenceSource = "workflow-owner";
      }
      const key = eventKey(event);
      if (keys.has(key) || events.length >= limit() || total + pendingCount >= limit()) return;
      keys.add(key);
      events.push(event);
      pendingCount++;
      dirty = true;
      if (flushTimer == null) flushTimer = later(flush, 300);
    }
    function receive(event) {
      if (typeof event.detail !== "string" || event.detail.length > 4e4) return;
      let owner;
      try {
        owner = JSON.parse(event.detail);
      } catch (error) {
        return;
      }
      if (!owner || typeof owner.type !== "string" || typeof owner.script !== "string" || typeof owner.version !== "string" || !/^[a-zA-Z0-9_.-]{1,80}$/.test(owner.type) || !/^[a-zA-Z0-9_. -]{1,64}$/.test(owner.script) || !/^[a-zA-Z0-9_.-]{1,40}$/.test(owner.version)) return;
      if (owner.eventId != null && (typeof owner.eventId !== "string" || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(owner.eventId))) return;
      if (owner.phase != null || owner.intent === "mutation") {
        if (owner.type !== "operation" || owner.intent !== "mutation" || !PHASES.has(owner.phase) || typeof owner.operationId !== "string" || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(owner.operationId)) return;
      }
      record(owner.type, owner.data || {}, owner);
    }
    function shape(value, depth = 0) {
      if (value == null) return "null";
      if (typeof value === "boolean" || typeof value === "number") return value;
      if (typeof value === "string") return { type: "string", length: value.length };
      if (depth >= 3) return Array.isArray(value) ? "array" : typeof value;
      if (Array.isArray(value)) return { length: value.length, sample: value.slice(0, 3).map((x) => shape(x, depth + 1)) };
      if (typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, child]) => [SECRET.test(key) ? "[REDACTED FIELD]" : safeText(key), SECRET.test(key) ? "[REDACTED]" : shape(child, depth + 1)]));
      return typeof value;
    }
    function bodyShape(body) {
      if (typeof body !== "string") return { type: typeof body };
      if (body.length > 32768) return { type: "large", length: body.length };
      try {
        return shape(JSON.parse(body));
      } catch (error) {
        return { type: "text", length: body.length };
      }
    }
    function networkInterest(url) {
      try {
        const parsed = new URL(url, location.href);
        const poRead = /\.execute-api\.(?:us-east-1|us-west-2)\.amazonaws\.com$/i.test(parsed.hostname) && /^\/beta\/(?:getPoHeaders|getEmidFromPolReadService|getInboundRecordsForShipmentByFnsku|getShipmentItems)\/?$/i.test(parsed.pathname);
        return (parsed.origin === location.origin || poRead) && !/(?:pendo|telemetry|analytics|logger)(?:[/.]|$)/i.test(parsed.href);
      } catch (error) {
        return false;
      }
    }
    function network(data) {
      if (!running) return;
      if (fat() || data.error || data.status >= 400 || data.durationMs >= 1500) {
        record(data.error ? "network.error" : "network.response", { ...data, evidenceSource: "native-network" });
        return;
      }
      const key = data.method + " " + data.url;
      if (routine.size >= 100 && !routine.has(key)) return;
      const previous = routine.get(key) || { method: data.method, url: data.url, count: 0, maxDurationMs: 0 };
      previous.count++;
      previous.maxDurationMs = Math.max(previous.maxDurationMs, data.durationMs);
      routine.set(key, previous);
      cancel(routineTimer);
      routineTimer = later(flushRoutine, 1e3);
    }
    function flushRoutine() {
      cancel(routineTimer);
      routineTimer = null;
      sync();
      if (!routine.size) return;
      record("network.summary", { evidenceSource: "native-network", endpoints: [...routine.values()] });
      routine.clear();
    }
    function observationContext() {
      sync();
      return storageErrors.has("get:" + META) || storageErrors.has("parse:session") ? null : { epoch, signal: controller.signal };
    }
    function currentObservation(context) {
      if (!running || !context || context.signal.aborted) return false;
      const current = sync();
      return !storageErrors.has("get:" + META) && !storageErrors.has("parse:session") && current.id === context.epoch;
    }
    function observe(fn) {
      try {
        fn();
      } catch (error) {
      }
    }
    async function sampleResponse(response, url, context) {
      if (!fat() || !currentObservation(context)) return;
      let reader;
      try {
        const contentType = response.headers?.get("content-type") || "";
        if (!/json/i.test(contentType) || !response.clone) return;
        const copy = response.clone();
        if (!copy.body?.getReader) return;
        reader = copy.body.getReader();
        readers.add(reader);
        const parts = [];
        let bytes = 0;
        while (currentObservation(context)) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 32768) {
            void reader.cancel().catch(() => {
            });
            return;
          }
          parts.push(part.value);
        }
        if (!currentObservation(context)) return;
        const body = new Uint8Array(bytes);
        let cursor = 0;
        for (const part of parts) {
          body.set(part, cursor);
          cursor += part.byteLength;
        }
        const text = new TextDecoder().decode(body);
        record("network.shape", { url, responseShape: bodyShape(text) });
      } catch (error) {
        if (currentObservation(context)) record("network.shape", { url, responseShape: "unavailable" });
      } finally {
        if (reader) readers.delete(reader);
      }
    }
    function hookFetch() {
      const original = PAGE.fetch;
      if (typeof original !== "function") return;
      const wrapped = function(...args) {
        const request = args[0];
        const rawUrl = typeof request === "string" || request instanceof PAGE.URL ? String(request) : request?.url;
        if (!networkInterest(rawUrl)) return Reflect.apply(original, this, args);
        const started = performance.now();
        const context = observationContext();
        const method = String(args[1]?.method || request?.method || "GET").toUpperCase();
        const url = safeUrl(rawUrl);
        let result;
        try {
          result = Reflect.apply(original, this, args);
        } catch (error) {
          observe(() => {
            if (currentObservation(context)) network({ url, method, error: safeText(error?.message || error), durationMs: Math.round(performance.now() - started) });
          });
          throw error;
        }
        return result.then((response) => {
          observe(() => {
            if (!currentObservation(context)) return;
            network({
              url,
              method,
              status: response.status,
              finalUrl: safeUrl(response.url || rawUrl),
              durationMs: Math.round(performance.now() - started),
              ...fat() ? { requestShape: bodyShape(args[1]?.body) } : {}
            });
            void sampleResponse(response, url, context);
          });
          return response;
        }, (error) => {
          observe(() => {
            if (currentObservation(context)) network({ url, method, error: safeText(error?.message || error), durationMs: Math.round(performance.now() - started) });
          });
          throw error;
        });
      };
      PAGE.fetch = forwardHook(wrapped, original);
      restoreFetch = () => {
        if (PAGE.fetch === wrapped) PAGE.fetch = original;
      };
    }
    function hookXhr() {
      const proto = PAGE.XMLHttpRequest?.prototype;
      if (!proto) return;
      const open = proto.open, send = proto.send;
      const wrappedOpen = function(method, url, ...rest) {
        const result = Reflect.apply(open, this, [method, url, ...rest]);
        xhrDetails.set(this, { rawUrl: url, url: safeUrl(url), method: String(method).toUpperCase() });
        return result;
      };
      const wrappedSend = function(body) {
        const detail = xhrDetails.get(this);
        if (!detail || !networkInterest(detail.rawUrl)) return Reflect.apply(send, this, [body]);
        const started = performance.now();
        const context = observationContext();
        const done = () => {
          if (!currentObservation(context)) return;
          const data = {
            url: detail.url,
            method: detail.method,
            status: this.status,
            finalUrl: safeUrl(this.responseURL || detail.rawUrl),
            durationMs: Math.round(performance.now() - started)
          };
          if (this.status === 0) data.error = "No HTTP response";
          if (fat()) {
            data.requestShape = bodyShape(body);
            try {
              data.responseShape = this.responseType === "json" ? shape(this.response) : bodyShape(this.responseText);
            } catch (error) {
              data.responseShape = "unavailable";
            }
          }
          observe(() => network(data));
        };
        this.addEventListener("loadend", done, { once: true, signal: controller.signal });
        try {
          return Reflect.apply(send, this, [body]);
        } catch (error) {
          this.removeEventListener("loadend", done);
          observe(() => {
            if (currentObservation(context)) network({ url: detail.url, method: detail.method, error: safeText(error?.message || error), durationMs: Math.round(performance.now() - started) });
          });
          throw error;
        }
      };
      proto.open = forwardHook(wrappedOpen, open);
      proto.send = forwardHook(wrappedSend, send);
      restoreXhr = () => {
        if (proto.open === wrappedOpen) proto.open = open;
        if (proto.send === wrappedSend) proto.send = send;
      };
    }
    function exportSession() {
      flushRoutine();
      if (!flush()) {
        exportError = "Evidence has not been persisted";
        render();
        return;
      }
      const current = readSession();
      const transcript = snapshot();
      if ([...storageErrors.keys()].some((key) => key === "list" || key.startsWith("get:") || key.startsWith("parse:"))) {
        exportError = "Evidence could not be read";
        render();
        return;
      }
      const text = [
        "TAMPERMONKEY V4 OBS",
        "Version: " + VERSION,
        "Session: " + epoch,
        "Started: " + new Date(current.startedAt || transcript[0]?.ts || Date.now()).toISOString(),
        "Exported: " + (/* @__PURE__ */ new Date()).toISOString(),
        "Events: " + transcript.length + "/" + limit(),
        "Mode: " + (fat() ? "FULL FAT" : "NORMAL"),
        "Native network is observation only. Operational phases are workflow-owner assertions.",
        "",
        "EVENTS",
        ...transcript.map((event) => JSON.stringify(event))
      ].join("\n");
      let url;
      try {
        url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
        objectUrls.add(url);
        const anchor2 = document.createElement("a");
        anchor2.href = url;
        anchor2.download = "V4_OBS_" + (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-") + "_" + transcript.length + "events.txt";
        anchor2.hidden = true;
        document.body.append(anchor2);
        try {
          anchor2.click();
        } finally {
          anchor2.remove();
        }
        later(() => {
          URL.revokeObjectURL(url);
          objectUrls.delete(url);
        }, 1500);
        reset("download");
      } catch (error) {
        if (url) {
          URL.revokeObjectURL(url);
          objectUrls.delete(url);
        }
        exportError = "Browser download could not be initiated";
        render();
      }
    }
    function reset(reason, mode = readSession().mode) {
      const fresh = { id: uid(), startedAt: Date.now(), mode };
      if (!set(META, JSON.stringify(fresh))) {
        render();
        return false;
      }
      sync();
      for (const key of list()) {
        if (!key.startsWith(SHARDS) || key.startsWith(SHARDS + fresh.id + ".")) continue;
        try {
          GM_deleteValue(key);
          storageErrors.delete("parse:" + key);
          storageErrors.delete("get:" + key);
          storageErrors.delete("delete:" + key);
        } catch (error) {
          storageErrors.set("delete:" + key, "Obsolete evidence could not be deleted");
        }
      }
      exportError = "";
      record("session.start", { reason });
      flush();
      return true;
    }
    function anchor() {
      const warehouse = document.querySelector(".warehouse-id");
      const row = warehouse?.closest(".a-row") || warehouse?.parentElement;
      if (!row || !warehouse || !ui) return false;
      if (headerRow && headerRow !== row) headerRow.removeAttribute("data-tm-v4-obs-header");
      headerRow = row;
      row.setAttribute("data-tm-v4-obs-header", "");
      if (ui.parentElement !== row) row.append(ui);
      const r = row.getBoundingClientRect(), w = warehouse.getBoundingClientRect();
      ui.style.left = Math.max(0, Math.round(w.right - r.left + 8)) + "px";
      ui.style.top = Math.max(0, Math.round(w.top - r.top)) + "px";
      if (row.parentElement !== headerParent) {
        headerObserver?.disconnect();
        headerParent = row.parentElement;
        headerObserver = new MutationObserver(() => {
          if (running) render();
        });
        if (headerParent) headerObserver.observe(headerParent, { childList: true });
      }
      return true;
    }
    function mount() {
      if (PAGE.top !== PAGE.self || !/fcresearch|qifcr\.fe\.aftx\.amazonoperations\.app/i.test(location.hostname) || location.hash.startsWith("#iss-console") || !document.querySelector(".warehouse-id")) return;
      if (!ownedStyle) {
        ownedStyle = document.createElement("style");
        ownedStyle.dataset.tmV4Style = "OBS";
        ownedStyle.textContent = `
        [data-tm-v4-obs-header] { position:relative }
        [data-tm-v4-script="OBS"] { position:absolute; z-index:20; display:inline-flex; gap:5px;
          align-items:center; white-space:nowrap; font:700 11px Arial; color:#374151 }
        [data-tm-v4-script="OBS"] button { border:0; background:transparent; color:inherit;
          font:inherit; cursor:pointer; padding:1px 3px }
        [data-tm-v4-script="OBS"] button:hover { text-decoration:underline }
        [data-tm-v4-script="OBS"][data-level="warn"] button:first-child {
          background:#ffea00; color:#7f1d1d; animation:tmV4ObsAttention .32s steps(1,end) infinite }
        [data-tm-v4-script="OBS"][data-level="full"] button:first-child {
          background:#b91c1c; color:#fff; animation:tmV4ObsAttention .16s steps(1,end) infinite }
        [data-tm-v4-script="OBS"][data-level="error"] button:first-child,
        [data-tm-v4-script="OBS"] [data-action="fat"][data-on="true"] { background:#7f1d1d; color:#fff }
        @keyframes tmV4ObsAttention { 0%,49% { opacity:1 } 50%,100% { opacity:.12 } }
      `;
        (document.head || document.documentElement).append(ownedStyle);
      }
      if (!ui) {
        ui = document.createElement("span");
        ui.dataset.tmV4Ui = "OBS";
        ui.dataset.tmV4Script = "OBS";
        ui.dataset.tmV4Version = VERSION;
        ui.innerHTML = '<button type="button" data-action="export"></button><span>·</span><button type="button" data-action="fat"></button><span>·</span><button type="button" data-action="clear">Clear</button><small>V4 ' + VERSION + "</small>";
        ui.querySelector('[data-action="export"]').addEventListener("click", exportSession, { signal: controller.signal });
        ui.querySelector('[data-action="clear"]').addEventListener("click", () => reset("clear"), { signal: controller.signal });
        ui.querySelector('[data-action="fat"]').addEventListener("click", () => {
          const next = !fat();
          if (reset(next ? "fat-on" : "fat-off", next ? "fat" : "normal")) location.reload();
        }, { signal: controller.signal });
      }
    }
    function render() {
      if (!running) return;
      mount();
      if (!ui) return;
      if (location.hash.startsWith("#iss-console")) {
        ui.hidden = true;
        return;
      }
      ui.hidden = false;
      snapshot();
      const max = limit();
      const button = ui.querySelector('[data-action="export"]');
      button.textContent = storeError() ? "OBS STORAGE ERROR" : exportError ? "OBS EXPORT ERROR" : "OBS " + Math.min(total, max) + "/" + max;
      button.title = [storeError(), exportError].filter(Boolean).join("; ") || (total >= max ? "FULL — click to download and start fresh" : total >= max * 0.8 ? "80%+ — click to download and start fresh" : "Click to download current log and start fresh");
      ui.dataset.level = storeError() || exportError ? "error" : total >= max ? "full" : total >= max * 0.8 ? "warn" : "normal";
      const toggle = ui.querySelector('[data-action="fat"]');
      toggle.dataset.on = String(fat());
      toggle.textContent = "FAT " + (fat() ? "ON" : "OFF");
      toggle.title = "Toggle high-detail logging; start a fresh session and reload";
      anchor();
    }
    function start(restored = false) {
      if (running) return;
      running = true;
      releaseWatermark = registerWatermark(window, "OBS", VERSION);
      controller = new AbortController();
      sync();
      window.addEventListener(BUS, receive, { signal: controller.signal });
      window.addEventListener("error", (event) => record("error", { message: event.message, filename: safeUrl(event.filename || location.href), line: event.lineno }), { signal: controller.signal });
      window.addEventListener("unhandledrejection", (event) => record("error.promise", { message: safeText(event.reason?.message || event.reason) }), { signal: controller.signal });
      window.addEventListener("resize", anchor, { passive: true, signal: controller.signal });
      window.addEventListener("hashchange", render, { signal: controller.signal });
      document.addEventListener("DOMContentLoaded", render, { once: true, signal: controller.signal });
      window.addEventListener("load", render, { once: true, signal: controller.signal });
      const changed = () => {
        if (running) {
          sync();
          render();
        }
      };
      try {
        metaListener = GM_addValueChangeListener(META, changed);
        revisionListener = GM_addValueChangeListener(REVISION, changed);
        storageErrors.delete("notification");
      } catch (error) {
        storageErrors.set("notification", "Cross-page storage notifications unavailable");
      }
      hookFetch();
      hookXhr();
      record(restored ? "page.restore" : "page.start", { version: VERSION, url: safeUrl(location.href) });
      render();
    }
    function stop() {
      if (!running) return;
      flushRoutine();
      flush();
      running = false;
      releaseWatermark();
      controller.abort();
      restoreFetch();
      restoreXhr();
      for (const id of timers) clearTimeout(id);
      timers.clear();
      flushTimer = routineTimer = null;
      for (const reader of readers) {
        void reader.cancel().catch(() => {
        });
      }
      readers.clear();
      for (const url of objectUrls) URL.revokeObjectURL(url);
      objectUrls.clear();
      headerObserver?.disconnect();
      headerObserver = null;
      headerParent = null;
      headerRow?.removeAttribute("data-tm-v4-obs-header");
      headerRow = null;
      ui?.remove();
      ui = null;
      ownedStyle?.remove();
      ownedStyle = null;
      for (const id of [metaListener, revisionListener]) {
        if (id != null) {
          try {
            GM_removeValueChangeListener(id);
          } catch (error) {
          }
        }
      }
      metaListener = revisionListener = null;
    }
    window.addEventListener("pagehide", stop);
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) start(true);
    });
    start();
  })();
})();
