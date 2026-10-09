// ==UserScript==
// @name V4 Screenshot Mode
// @namespace https://github.com/1Sirkkris/tampermonkey-v4
// @version 0.1.0
// @description Ctrl+Q temporarily hides V4 UI and styles across supported pages.
// @include /^https?:\/\/(?:aft-poirot-website-nrt\.nrt\.proxy\.amazon\.com|aft-qt-[^/]+\.corp\.amazon\.com|aft-moveapp-[^/]+\.proxy\.amazon\.com|[^/]*fcresearch[^/]*|qifcr\.fe\.aftx\.amazonoperations\.app|t\.corp\.amazon\.com|aftcartonpreditorapp-tcp-nrt\.nrt\.proxy\.amazon\.com|fba-fnsku-commingling-console-(?:eu|na|jp)\.aka\.amazon\.com|river\.amazon\.com|tx-b-hierarchy-nrt\.nrt\.proxy\.amazon\.com|jp\.item-measurement\.aft\.a2z\.com|fcmenu-(?:iad|nrt)-regionalized\.corp\.amazon\.com|console\.harmony\.a2z\.com)\//
// @grant none
// @run-at document-start
// @updateURL https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Screenshot_Mode.user.js
// @downloadURL https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Screenshot_Mode.user.js
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

  // screenshot-runtime.mjs
  function createScreenshotMode(window2) {
    const d = window2.document, events = new window2.AbortController(), attribute = "data-tm-v4-screenshot", owned = "[data-tm-v4-script],[data-tm-v4-master]", styles = /* @__PURE__ */ new Map();
    let enabled = false, disposed = false, observer = null;
    const style = d.createElement("style");
    style.dataset.tmV4Style = "SRCS";
    style.id = "tm-v4-screenshot-style";
    style.textContent = `html[${attribute}] ${owned.split(",").join(`,html[${attribute}] `)}{display:none!important;visibility:hidden!important}`;
    d.documentElement.append(style);
    function disable(node) {
      if (node.tagName !== "STYLE" || node === style || styles.has(node) || !node.matches("[data-tm-v4-style],[data-tm-v4-script],[data-tm-v4-master]")) return;
      styles.set(node, { had: node.hasAttribute("media"), media: node.getAttribute("media") });
      node.setAttribute("media", "not all");
    }
    function inspect(node) {
      if (node.nodeType !== 1) return;
      disable(node);
      node.querySelectorAll("style[data-tm-v4-style],style[data-tm-v4-script],style[data-tm-v4-master]").forEach(disable);
    }
    function set(value) {
      if (disposed || enabled === value) return;
      enabled = value;
      if (value) {
        d.documentElement.setAttribute(attribute, "");
        inspect(d.documentElement);
        observer = new window2.MutationObserver((records) => {
          for (const record of records) for (const node of record.addedNodes) inspect(node);
        });
        observer.observe(d.documentElement, { childList: true, subtree: true });
      } else {
        d.documentElement.removeAttribute(attribute);
        observer?.disconnect();
        observer = null;
        for (const [node, state] of styles) if (node.isConnected) {
          if (state.had) node.setAttribute("media", state.media);
          else node.removeAttribute("media");
        }
        styles.clear();
      }
      window2.dispatchEvent(new window2.CustomEvent("tm-v4:screenshot-mode", { detail: { enabled: value } }));
    }
    d.addEventListener("keydown", (event) => {
      if (event.key.toLowerCase() !== "q" || !event.ctrlKey || event.shiftKey || event.altKey || event.metaKey || event.repeat) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      set(!enabled);
    }, { capture: true, signal: events.signal });
    return { set, get enabled() {
      return enabled;
    }, dispose() {
      if (disposed) return;
      set(false);
      disposed = true;
      events.abort();
      observer?.disconnect();
      style.remove();
    } };
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

  // screenshot-entry.mjs
  var VERSION = "0.1.0";
  var guard = Symbol.for("tampermonkey.v4.screenshot.installer");
  if (!window[guard]) {
    window[guard] = { version: VERSION };
    installRouteLifecycle(window, () => {
      if (window.top !== window.self) return;
      const release = registerWatermark(window, "SRCS", VERSION), helper = createScreenshotMode(window);
      return () => {
        helper.dispose();
        release();
      };
    }, () => location.pathname);
  }
})();
