// ==UserScript==
// @name V4 FCR Native Capture
// @namespace https://github.com/1Sirkkris/tampermonkey-v4
// @version 0.1.2
// @description Manual read-only FCR/AFT/MoveContainer contract capture; sanitized and bounded.
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

  // native-capture-entry.mjs
  var VERSION = "0.1.2";
  var guard = Symbol.for("tampermonkey.v4.native-capture");
  var privateField = /pass|token|secret|csrf|auth|cookie|session|employee|associate|login|user(?:id|name)/i;
  function scope(location2) {
    if (/^(?:fcresearch-fe\.aka\.amazon\.com|qi-fcresearch-(?:fe|jp)\.corp\.amazon\.com|qifcr\.fe\.aftx\.amazonoperations\.app)$/.test(location2.hostname)) return "FCR";
    if (/^aft-qt-[^.]+(?:\.[^.]+)*\.corp\.amazon\.com$/.test(location2.hostname) && /^\/app\/(?:edititems|moveitems|fcskuflip)(?:\/|$)/.test(location2.pathname)) return "AFT";
    if (/^aft-moveapp-[^.]+(?:\.nrt)?\.proxy\.amazon\.com$/.test(location2.hostname) && /^\/move-container(?:\/|$)/.test(location2.pathname)) return "MoveContainer";
    return null;
  }
  function createRedactor() {
    const containers = /* @__PURE__ */ new Map();
    return (value) => String(value).replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED JWT]").replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]").replace(/(["']?(?:authorization|access[_-]?token|id[_-]?token|refresh[_-]?token|password|secret|csrf[_-]?token|csrf|cookie|session(?:[_-]?id|[_-]?token)?|employee(?:Login|Id)|associate(?:Login|Id)|user(?:Login|Id|Name))["']?\s*[:=]\s*)(["'])[^\r\n]*?\2/gi, "$1$2[REDACTED]$2").replace(/\b(?:tsX|csX)[A-Za-z0-9_-]+\b/gi, (code) => {
      const key = code.toUpperCase();
      if (!containers.has(key)) containers.set(key, code.slice(0, 3) + "CAPTURE" + String(containers.size + 1).padStart(4, "0"));
      return containers.get(key);
    });
  }
  function safeUrl(raw, redact) {
    const url = new URL(raw, location.href);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) if (privateField.test(key)) url.searchParams.set(key, "[REDACTED]");
    return redact(url.href);
  }
  if (!window[guard]) {
    window[guard] = { version: VERSION };
    let running = false, controller = null, objectUrl = null, releaseTimer = null;
    const revoke = () => {
      clearTimeout(releaseTimer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    };
    const cancel = (reason) => {
      controller?.abort(reason);
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
        const redact = createRedactor(), page = safeUrl(location.href, redact);
        const clone = document.documentElement.cloneNode(true);
        clone.querySelectorAll("[data-tm-v4-master],[data-tm-v4-script],[data-tm-v4-style],iframe").forEach((node) => node.remove());
        clone.querySelectorAll("input,textarea,select").forEach((node) => {
          if (!privateField.test(node.name + " " + node.id + " " + node.type)) return;
          node.setAttribute("value", "[REDACTED]");
          if (node.tagName !== "INPUT") node.textContent = "[REDACTED]";
        });
        clone.querySelectorAll("meta[name]").forEach((node) => {
          if (privateField.test(node.name)) node.setAttribute("content", "[REDACTED]");
        });
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
            const record = { index, type: script.type || "text/javascript", url: script.src ? safeUrl(script.src, redact) : null, source: "" };
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
  }
})();
