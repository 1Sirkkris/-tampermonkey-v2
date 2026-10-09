// ==UserScript==
// @name V4 FCR Native Capture
// @namespace https://github.com/1Sirkkris/tampermonkey-v4
// @version 0.1.1
// @description Manual read-only native markup/source capture; sanitized and bounded.
// @match http://fcresearch-fe.aka.amazon.com/*
// @match https://fcresearch-fe.aka.amazon.com/*
// @match http://qi-fcresearch-fe.corp.amazon.com/*
// @match https://qi-fcresearch-fe.corp.amazon.com/*
// @match http://qi-fcresearch-jp.corp.amazon.com/*
// @match https://qi-fcresearch-jp.corp.amazon.com/*
// @match http://qifcr.fe.aftx.amazonoperations.app/*
// @match https://qifcr.fe.aftx.amazonoperations.app/*
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

  // native-capture-entry.mjs
  (() => {
    "use strict";
    const VERSION = "0.1.1";
    const guard = Symbol.for("tampermonkey.v4.native-capture");
    if (window[guard]) return;
    window[guard] = { version: VERSION };
    let footerActive = true, footerRelease = registerWatermark(window, "FCAP", VERSION);
    window.addEventListener("pageshow", (event) => {
      if (event.persisted && !footerActive) {
        footerRelease = registerWatermark(window, "FCAP", VERSION);
        footerActive = true;
      }
    });
    let running = false, controller = null, objectUrl = null, release = null;
    const redact = (value) => String(value).replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED JWT]").replace(/(["']?(?:authorization|access[_-]?token|id[_-]?token|refresh[_-]?token|password|csrf[_-]?token|csrf|cookie)["']?\s*[:=]\s*)(["'])[^\r\n]*?\2/gi, "$1$2[REDACTED]$2");
    function safeUrl(raw) {
      const url = new URL(raw, location.href);
      url.username = "";
      url.password = "";
      for (const key of [...url.searchParams.keys()]) if (/auth|token|csrf|secret|pass|cookie/i.test(key)) url.searchParams.set(key, "[REDACTED]");
      return url.href;
    }
    const revoke = () => {
      clearTimeout(release);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    };
    window.addEventListener("pagehide", () => {
      controller?.abort("pagehide");
      revoke();
      footerRelease();
      footerActive = false;
    });
    GM_registerMenuCommand("Capture native FCR (read-only) " + VERSION, async () => {
      if (running) return;
      running = true;
      controller = new AbortController();
      const signal = controller.signal;
      const deadline = setTimeout(() => controller.abort("timeout"), 3e4);
      try {
        const clone = document.documentElement.cloneNode(true);
        clone.querySelectorAll("[data-tm-v4-master],[data-tm-v4-script],[data-tm-v4-style],iframe").forEach((node) => node.remove());
        clone.querySelectorAll("input").forEach((node) => {
          if (/pass|token|secret|csrf|auth|cookie/i.test(node.name + " " + node.id)) node.setAttribute("value", "[REDACTED]");
        });
        const scripts = [...document.scripts].slice(0, 80), records = new Array(scripts.length);
        const evidence = {
          diagnostic: "FCR native renderer capture",
          version: VERSION,
          capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
          page: safeUrl(location.href),
          html: redact(clone.outerHTML),
          scripts: records,
          limits: ["No cookies, request headers or browser storage are collected.", "Inline and GET-loaded page scripts only; missing/CORS-blocked assets are explicit."]
        };
        let next = 0, bytes = evidence.html.length;
        async function worker() {
          while (!signal.aborted && next < scripts.length) {
            const index = next++, script = scripts[index];
            const record = { index, type: script.type || "text/javascript", url: script.src ? safeUrl(script.src) : null, source: "" };
            records[index] = record;
            try {
              let source = script.textContent;
              if (script.src) {
                const url = new URL(script.src);
                if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error("Unsupported script URL");
                const response = await fetch(url.href, { method: "GET", credentials: "same-origin", signal });
                if (!response.ok || response.url && new URL(response.url).origin !== url.origin) throw new Error("Asset HTTP/auth redirect");
                const mime = response.headers.get("Content-Type") || "";
                if (/text\/html/i.test(mime)) throw new Error("Asset returned HTML instead of source");
                source = await response.text();
              }
              if (source.length > 4e6 || bytes + source.length > 16e6) throw new Error("Capture source limit reached");
              bytes += source.length;
              record.source = redact(source);
            } catch (error) {
              record.error = String(error.message || error);
            }
          }
        }
        await Promise.all([worker(), worker()]);
        if (signal.aborted) throw new Error("Capture cancelled or timed out — no file downloaded");
        revoke();
        objectUrl = URL.createObjectURL(new Blob([JSON.stringify(evidence, null, 2)], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = "FCR_native_capture_" + (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-") + ".json";
        document.body.append(link);
        link.click();
        link.remove();
        release = setTimeout(revoke, 1e3);
      } catch (error) {
        if (signal.reason !== "pagehide") alert("FCR capture failed: " + String(error.message || error));
      } finally {
        clearTimeout(deadline);
        running = false;
        controller = null;
      }
    });
  })();
})();
