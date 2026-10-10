// ==UserScript==
// @name V4 RIVER Ticket Assistant
// @namespace https://github.com/1Sirkkris/tampermonkey-v4
// @version 0.1.1
// @description Exact FCR handoff and native RIVER assistant with manual final gates.
// @match http://fcresearch-fe.aka.amazon.com/*
// @match https://fcresearch-fe.aka.amazon.com/*
// @match http://qi-fcresearch-fe.corp.amazon.com/*
// @match https://qi-fcresearch-fe.corp.amazon.com/*
// @match http://qi-fcresearch-jp.corp.amazon.com/*
// @match https://qi-fcresearch-jp.corp.amazon.com/*
// @match http://qifcr.fe.aftx.amazonoperations.app/*
// @match https://qifcr.fe.aftx.amazonoperations.app/*
// @match https://river.amazon.com/*
// @grant GM_getValue
// @grant GM_setValue
// @grant GM_openInTab
// @run-at document-start
// @updateURL https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/FCResearch_RIVER_Ticket_Assistant.user.js
// @downloadURL https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/FCResearch_RIVER_Ticket_Assistant.user.js
// ==/UserScript==
(() => {
  // watermark.mjs
  function registerWatermark(window2, label, version) {
    if (!/^[A-Za-z0-9]{1,5}$/.test(label) || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version)) throw new Error("Invalid V4 runtime identity");
    const document = window2.document, id = "tm-v4-runtime-watermark";
    const token = typeof window2.crypto.randomUUID === "function" ? window2.crypto.randomUUID() : [...window2.crypto.getRandomValues(new Uint32Array(4))].map((value2) => value2.toString(16)).join("-");
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
  var clean = (value2) => String(value2 ?? "").replace(/\s+/g, " ").trim();
  var upper = (value2) => clean(value2).toUpperCase();
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

  // river-runtime.mjs
  var norm = (value2) => clean(value2).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  function riverStep(window2) {
    const d = window2.document, label = d.querySelector("page-info[label]")?.getAttribute("label") || [...d.querySelectorAll("h1,h2,h3,h4,[role=heading],legend")].find((node) => !node.closest("[data-tm-v4-script]") && !node.hidden)?.textContent || "", text2 = norm(label);
    for (const [key, rx] of [["pandash", /pandash/], ["related", /related.*(?:tt|ticket)/], ["information", /information/], ["sortability", /sortab|sort.*non sort/], ["severity", /severity/], ["images", /image/], ["create", /create (?:issue|ticket)/], ["asin", /^(?:asin)$|asin check|enter asin/], ["issue", /issue.*fc/]]) if (rx.test(text2)) return key;
    return "unknown";
  }
  function createRiverAssistant({ window: window2, getPayload, clearPayload, onEvidence = () => {
  } }) {
    const d = window2.document, events = new window2.AbortController();
    let active2 = false, disposed = false, busy = false, controller = null, lastSubmitted = "", manual = false, watcher = null, deadline = 0;
    const root = d.createElement("aside");
    root.id = "tm-v4-river";
    root.dataset.tmV4Script = "RIVR";
    root.innerHTML = '<b>RIVER V4</b><span data-id></span><div role="status">READY</div><button data-run>RUN</button><button data-clear>STOP / CLEAR</button>';
    const style = d.createElement("style");
    style.dataset.tmV4Style = "RIVR";
    style.textContent = "#tm-v4-river{position:fixed;left:14px;bottom:14px;z-index:2147483647;width:300px;padding:10px;border:2px solid #475569;border-radius:8px;background:white;color:#111;font:12px Arial;box-shadow:0 4px 16px #0004}#tm-v4-river span{float:right;max-width:145px;overflow:hidden;text-overflow:ellipsis}#tm-v4-river [role=status]{clear:both;padding:8px 0;font-weight:700}#tm-v4-river button{width:49%;min-height:30px;font-weight:800;cursor:pointer}";
    d.body.append(root);
    d.head.append(style);
    const status = (text2) => root.querySelector("[role=status]").textContent = text2;
    const visible = (node) => node && !node.hidden && !node.closest("[data-tm-v4-script],[hidden]") && window2.getComputedStyle(node).display !== "none" && window2.getComputedStyle(node).visibility !== "hidden", enabled = (node) => visible(node) && !node.disabled && !node.readOnly && node.getAttribute("aria-disabled") !== "true";
    function check(step, signal) {
      if (disposed || !active2 || signal?.aborted || step !== riverStep(window2)) throw new Error("Stopped or native step changed");
    }
    function field(aliases) {
      const wanted = aliases.map(norm), matches = [...d.querySelectorAll("input,textarea,select")].filter(visible).filter((node) => {
        const label = norm([node.name, node.id, node.placeholder, node.getAttribute("aria-label"), ...node.labels || []].map((value2) => value2?.textContent || value2 || "").join(" "));
        return wanted.some((value2) => value2.length <= 3 ? label.split(" ").includes(value2) : label.includes(value2));
      });
      if (matches.length !== 1) throw new Error("Native field missing/ambiguous: " + aliases[0]);
      return matches[0];
    }
    function nextButton() {
      const matches = [...d.querySelectorAll("button,a,[role=button],input[type=button],input[type=submit]")].filter((node) => visible(node) && norm(node.textContent || node.value || node.getAttribute("aria-label")) === "next");
      return matches.length === 1 ? matches[0] : null;
    }
    function wait(checkReady, signal, timeout = 8e3) {
      return new Promise((resolve, reject) => {
        let done = false;
        const finish = (value2, error) => {
          if (done) return;
          done = true;
          observer.disconnect();
          window2.clearTimeout(timer);
          signal?.removeEventListener("abort", cancel);
          if (error) reject(error);
          else resolve(value2);
        }, cancel = () => finish(null, new Error("Stopped")), assess = () => {
          if (done) return;
          try {
            const value2 = checkReady();
            if (value2) finish(value2);
          } catch {
          }
        };
        const observer = new window2.MutationObserver(assess);
        observer.observe(d.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled", "readonly", "aria-disabled", "label"] });
        const timer = window2.setTimeout(() => finish(null, new Error("Native form readiness timeout")), timeout);
        signal?.addEventListener("abort", cancel, { once: true });
        if (signal?.aborted) cancel();
        else assess();
      });
    }
    async function frame(signal) {
      await new Promise((resolve) => window2.requestAnimationFrame ? window2.requestAnimationFrame(resolve) : window2.queueMicrotask(resolve));
      if (signal.aborted) throw new Error("Stopped");
    }
    async function set(node, value2, step, signal) {
      check(step, signal);
      if (!enabled(node)) throw new Error("Native field is disabled");
      node.focus({ preventScroll: true });
      await frame(signal);
      check(step, signal);
      if (!node.isConnected || !enabled(node)) throw new Error("Native field replaced/disabled");
      const proto = node.tagName === "TEXTAREA" ? window2.HTMLTextAreaElement.prototype : node.tagName === "SELECT" ? window2.HTMLSelectElement.prototype : window2.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(node, String(value2));
      node.dispatchEvent(new window2.Event("input", { bubbles: true, composed: true }));
      node.dispatchEvent(new window2.Event("change", { bubbles: true, composed: true }));
      await frame(signal);
      check(step, signal);
      node.blur();
      await frame(signal);
      check(step, signal);
      if (clean(node.value) !== clean(value2)) throw new Error("Native field did not retain value");
    }
    function choice(index, step, signal) {
      check(step, signal);
      const radios = [...d.querySelectorAll("input[type=radio],[role=radio]")].filter(enabled).filter((node) => !node.querySelector("input[type=radio]"));
      if (!radios[index - 1]) throw new Error("Expected native choice " + index + " unavailable");
      radios[index - 1].click();
    }
    async function advance(step, signal) {
      check(step, signal);
      const button = await wait(() => {
        const node = nextButton();
        return enabled(node) ? node : null;
      }, signal, 4e3);
      check(step, signal);
      if (lastSubmitted === step) throw new Error("Next already submitted for this step — wait for native transition");
      lastSubmitted = step;
      onEvidence({ type: "river.step", intent: "workflow", data: { step, stage: "next-submitted" } });
      button.click();
      status("Next submitted • waiting for native step");
      deadline = window2.setTimeout(() => {
        if (active2 && lastSubmitted === step && riverStep(window2) === step) {
          status("UNKNOWN • native step did not advance; no automatic repeat");
          stopWatch();
        }
      }, 12e3);
    }
    function stopWatch() {
      watcher?.disconnect();
      watcher = null;
      window2.clearTimeout(deadline);
      deadline = 0;
    }
    function watch() {
      if (watcher || !active2) return;
      watcher = new window2.MutationObserver((records) => {
        if (records.every((record) => root.contains(record.target))) return;
        if (!busy && active2) {
          const step = riverStep(window2);
          if (step !== "unknown" && step !== lastSubmitted) {
            window2.clearTimeout(deadline);
            deadline = 0;
            void drive();
          }
        }
      });
      watcher.observe(d.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["label", "disabled", "readonly", "aria-disabled"] });
    }
    async function drive() {
      if (busy || !active2 || disposed) return;
      const payload = getPayload();
      if (!payload || payload.schema !== 1) {
        status("No V4 FCResearch payload");
        return;
      }
      busy = true;
      controller = new window2.AbortController();
      const signal = controller.signal, step = riverStep(window2);
      try {
        root.querySelector("[data-id]").textContent = payload.fnsku !== "N/A" ? payload.fnsku : payload.asin;
        status("RUN • " + step);
        if (step === "unknown") {
          status("WAITING • native workflow state unavailable");
          watch();
          return;
        }
        if (step === "related" || step === "create") {
          manual = true;
          stopWatch();
          status(step === "create" ? "DONE • final Create Issue stays manual" : "PAUSED • review related tickets, then native Next");
          return;
        }
        if (lastSubmitted === step) {
          status("UNKNOWN • Next already submitted; wait for native transition");
          return;
        }
        manual = false;
        if (["pandash", "issue", "sortability"].includes(step)) choice(step === "pandash" ? 2 : 1, step, signal);
        else if (step === "asin") {
          if (payload.asin === "N/A") throw new Error("ASIN unavailable — manual step");
          await set(field(["type asin here", "asin"]), payload.asin, step, signal);
        } else if (step === "information") {
          const entries = [[["fnsku", "x0 asin", "x00 asin"], payload.fnsku], [["purchase order", "po"], payload.purchaseOrder], [["vendor code", "seller id"], payload.vendorCode], [["inventory cost", "cost per unit"], payload.inventoryCost], [["physical location"], "TBD"], [["asin title", "product title", "title"], payload.title]];
          await wait(() => entries.map(([aliases]) => field(aliases)).every(enabled), signal);
          check(step, signal);
          for (const [aliases, value2] of entries) {
            await set(field(aliases), value2 || "N/A", step, signal);
            if (aliases[0] === "asin title") await set(field(aliases), (value2 || "N/A") + " ", step, signal);
          }
        } else if (step === "severity") {
          await set(field(["shipments impacted"]), 0, step, signal);
          if (!Number.isFinite(payload.inventoryQuantity) || payload.inventoryQuantity <= 0) {
            manual = true;
            stopWatch();
            status("PAUSED • PO quantity unavailable/0; enter Units impacted, then native Next");
            return;
          }
          await set(field(["units impacted"]), payload.inventoryQuantity, step, signal);
        } else if (step === "images") {
          const selects = [...d.querySelectorAll("select")].filter(enabled);
          if (selects.length !== 1) throw new Error("Native image dropdown missing/ambiguous");
          const options = [...selects[0].options].filter((option) => !option.disabled && !option.hidden);
          if (!options[1]) throw new Error("Native image option 2 missing");
          await set(selects[0], options[1].value, step, signal);
        } else throw new Error("Native step unsupported");
        await advance(step, signal);
        watch();
      } catch (error) {
        if (active2 && !disposed && !signal.aborted) {
          status("WAITING • " + error.message);
          stopWatch();
          onEvidence({ type: "river.error", intent: "workflow", data: { step, message: error.message } });
        }
      } finally {
        busy = false;
        controller = null;
        if (active2 && lastSubmitted === step && riverStep(window2) !== "unknown" && riverStep(window2) !== lastSubmitted && !manual) window2.queueMicrotask(() => void drive());
      }
    }
    function stop(clear = true) {
      active2 = false;
      manual = false;
      controller?.abort();
      stopWatch();
      status("STOPPED / CLEARED");
      root.querySelector("[data-id]").textContent = "";
      if (clear) clearPayload();
    }
    root.querySelector("[data-run]").onclick = () => {
      active2 = true;
      watch();
      void drive();
    };
    root.querySelector("[data-clear]").onclick = stop;
    d.addEventListener("click", (event) => {
      if (!active2 || !manual || event.target.closest("#tm-v4-river") || event.target.closest("button,a,[role=button]") !== nextButton()) return;
      manual = false;
      lastSubmitted = riverStep(window2);
      watch();
    }, { capture: true, signal: events.signal });
    return { root, drive, stop, dispose() {
      if (disposed) return;
      stop(false);
      disposed = true;
      events.abort();
      root.remove();
      style.remove();
    } };
  }

  // river-capture.mjs
  var RIVER_KEY = "tm-v4.river.payload";
  function riverUrl(warehouse) {
    if (!/^[A-Z0-9-]{2,12}$/.test(warehouse)) throw new Error("Valid warehouse required");
    const url = new URL("https://river.amazon.com/" + warehouse + "/workflows");
    for (const [key, value2] of Object.entries({ buildingType: "fc", q0: "3654ec14-7232-4f65-84c3-87927cdb4d0c", q1: "0dbb253e-c43a-4a8b-a316-e32b8ab9be21", id: "0dbb253e-c43a-4a8b-a316-e32b8ab9be21" })) url.searchParams.set(key, value2);
    return url.href;
  }
  var normalize = (text2) => clean(text2).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  function nativeDate(text2) {
    const value2 = clean(text2), iso = value2.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/), dmy = value2.match(/\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2})/);
    if (iso || dmy) {
      const [y, m, d] = iso ? iso.slice(1).map(Number) : [Number(dmy[3]), Number(dmy[2]), Number(dmy[1])], date = new Date(y, m - 1, d);
      return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date.getTime() : NaN;
    }
    return Date.parse(value2);
  }
  function tableRows(doc, id) {
    const table = doc.getElementById(id);
    if (!table) return [];
    const headers = [...(table.tHead?.rows[0] || table.rows[0]).cells].map((cell) => normalize(cell.textContent)), rows = [];
    for (const row of table.tBodies[0]?.rows || []) {
      if (row.cells.length !== headers.length) continue;
      const data = {};
      headers.forEach((key, i) => data[key] = clean(row.cells[i].textContent));
      rows.push(data);
    }
    return rows;
  }
  var value = (row, names) => {
    for (const name of names) if (row[name] != null) return row[name];
    return "";
  };
  function selectRiverPo(itemDoc, detailDoc, aliases) {
    const details = /* @__PURE__ */ new Map();
    for (const row of tableRows(detailDoc, "table-purchase-order")) {
      const po = value(row, ["purchase order", "po"]), date = nativeDate(value(row, ["placed", "confirmed", "order date", "date"]));
      if (po && Number.isFinite(date) && (!details.has(upper(po)) || date > details.get(upper(po)))) details.set(upper(po), date);
    }
    const candidates = [];
    for (const row of tableRows(itemDoc, "table-purchase-order-item")) {
      const sku = upper(value(row, ["sku", "fnsku", "asin"]));
      if (!aliases.includes(sku)) continue;
      const po = value(row, ["purchase order", "po"]);
      if (!po) continue;
      const ownDate = nativeDate(value(row, ["order date", "placed", "date"])), date = Math.max(Number.isFinite(ownDate) ? ownDate : -Infinity, details.get(upper(po)) ?? -Infinity);
      const parts = ["unfilled", "cancelled", "received"].map((name) => {
        const raw = value(row, name === "cancelled" ? ["cancelled", "canceled"] : [name]).replace(/,/g, "");
        return /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : null;
      });
      const vendor = value(row, ["vendor code", "seller id"]).match(/\b[A-Za-z0-9]{2,5}\b/g)?.find((code) => upper(code) !== "FBA") || "";
      candidates.push({ purchaseOrder: po, vendorCode: vendor || "N/A", inventoryQuantity: parts.every(Number.isFinite) && parts.reduce((a, b) => a + b, 0) > 0 ? parts.reduce((a, b) => a + b, 0) : null, date, quantityMode: parts.every(Number.isFinite) ? "po-line-total" : "manual-missing-components" });
    }
    if (!candidates.length) return { purchaseOrder: "N/A", vendorCode: "N/A", inventoryQuantity: null, quantityMode: "manual-no-exact-line" };
    if (candidates.length > 1 && candidates.some((row) => !Number.isFinite(row.date))) return { purchaseOrder: "N/A", vendorCode: "N/A", inventoryQuantity: null, quantityMode: "manual-date-ambiguity" };
    candidates.sort((a, b) => b.date - a.date);
    if (candidates.length > 1 && candidates[0].date === candidates[1].date && candidates[0].purchaseOrder !== candidates[1].purchaseOrder) return { purchaseOrder: "N/A", vendorCode: "N/A", inventoryQuantity: null, quantityMode: "manual-date-tie" };
    return candidates[0];
  }
  async function captureRiver({ window: window2, reader, query, warehouse, signal, version }) {
    if (signal?.aborted) throw new Error("Capture cancelled");
    const product = await reader.product(query, { signal });
    if (!product.complete || !product.product) throw new Error("Exact FCR product identity required");
    const item = product.product, parse = (html) => new window2.DOMParser().parseFromString(html, "text/html");
    let po = { purchaseOrder: "N/A", vendorCode: "N/A", inventoryQuantity: null, quantityMode: "manual-unavailable" }, warning = "";
    try {
      const itemResult = await reader.section("purchase-order-item", query, { signal }), detailResult = await reader.section("purchase-order", query, { signal });
      if (!itemResult.paginationComplete || !detailResult.paginationComplete) throw new Error("PO pagination incomplete");
      po = selectRiverPo(parse(itemResult.html), parse(detailResult.html), item.aliases.map(upper));
      warning = "PO global completeness unverified; quantity is exact selected native line total";
    } catch (error) {
      if (signal?.aborted) throw new Error("Capture cancelled", { cause: error });
      warning = error.message;
    }
    if (signal?.aborted) throw new Error("Capture cancelled");
    const doc = parse(product.html);
    let cost = "N/A";
    for (const row of doc.querySelectorAll("tr")) {
      const name = normalize(row.querySelector("th")?.textContent || "");
      if (["price", "list price"].includes(name)) {
        const amount = clean(row.querySelector("td")?.textContent).match(/\d+(?:,\d{3})*(?:\.\d+)?/);
        if (amount) cost = amount[0].replace(/,/g, "");
      }
    }
    return { schema: 1, asin: item.asin || "N/A", fnsku: item.fnsku || "N/A", title: item.title || "N/A", inventoryCost: cost, ...po, warning, warehouseId: warehouse, sourceSearch: query, capturedAt: Date.now(), assistantVersion: version, riverUrl: riverUrl(warehouse) };
  }

  // river-fcr.mjs
  function createRiverCapture({ window: window2, reader, setValue, open, onEvidence = () => {
  }, version, warehouse }) {
    const d = window2.document, events = new window2.AbortController(), style = d.createElement("style");
    style.dataset.tmV4Style = "RIVR";
    style.textContent = ".tm-v4-river-capture{display:inline-flex;align-items:center;margin-left:7px;padding:2px 7px;border:1px solid #765900;border-radius:12px;background:#fff3b0;color:#111;font:800 11px Arial;cursor:pointer}.tm-v4-river-capture[data-ready=true]{background:#dff6ff;border-color:#005a78}";
    d.head.append(style);
    let controller = null, payload = null, current = "", disposed = false, button = null, label = "RIVER CAPTURE…", ready = false;
    const query = () => clean(new window2.URLSearchParams(window2.location.search).get("s") || d.getElementById("search")?.value);
    function paint(text2, isReady = false) {
      label = text2;
      ready = isReady;
      if (!button) return;
      if (button.textContent !== text2) button.textContent = text2;
      button.dataset.ready = String(ready);
      button.title = payload?.warning || "Exact FCR product + latest native PO line capture";
    }
    async function capture() {
      const search = query();
      if (!search || search === current) return;
      controller?.abort();
      payload = null;
      current = search;
      if (!/^[A-Za-z0-9]{10}$/.test(search)) {
        paint("RIVER • exact item required");
        return;
      }
      controller = new window2.AbortController();
      const signal = controller.signal;
      paint("RIVER CAPTURE…");
      try {
        const data = await captureRiver({ window: window2, reader, query: search, warehouse, signal, version });
        if (disposed || signal.aborted || search !== query()) return;
        payload = data;
        setValue(RIVER_KEY, data);
        paint("RIVER READY ✓", true);
        onEvidence({ type: "river.capture", intent: "read", data: { quantityAvailable: data.inventoryQuantity !== null, quantityMode: data.quantityMode } });
      } catch (error) {
        if (!disposed && !signal.aborted) paint("RIVER • " + error.message);
      }
    }
    function launch() {
      if (disposed) return;
      if (payload && upper(query()) === upper(payload.sourceSearch)) {
        setValue(RIVER_KEY, payload);
        open(payload.riverUrl);
      } else {
        current = "";
        void capture();
        paint("RIVER capture pending — click when ready");
      }
    }
    function handoff(event) {
      let data;
      try {
        data = JSON.parse(event.detail);
      } catch {
        return;
      }
      if (data.warehouse !== warehouse || upper(data.query) !== upper(query())) return;
      event.preventDefault();
      launch();
    }
    function reconcile() {
      if (disposed) return;
      const product = d.querySelector("[data-section-type=product]"), target = product?.querySelector("[data-tm-v4-badge=hazmat]") || product?.querySelector("table") || d.getElementById("table-product");
      if (!target) {
        button?.remove();
        return;
      }
      if (!button) {
        button = d.createElement("button");
        button.type = "button";
        button.className = "tm-v4-river-capture";
        button.dataset.tmV4Script = "RIVR";
        button.addEventListener("click", launch, { signal: events.signal });
      }
      if (target.nextElementSibling !== button) target.after(button);
      paint(label, ready);
      void capture();
    }
    const observer = new window2.MutationObserver((records) => {
      if (records.every((record) => button?.contains(record.target))) return;
      reconcile();
    });
    observer.observe(d.querySelector("#results-content") || d.body, { childList: true, subtree: true });
    d.addEventListener("tampermonkey-v4:river-handoff", handoff, { signal: events.signal });
    reconcile();
    return { capture, dispose() {
      disposed = true;
      controller?.abort();
      observer.disconnect();
      events.abort();
      button?.remove();
      style.remove();
    } };
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
  var text = (value2) => String(value2 ?? "").replace(/\s+/g, " ").trim();
  var identifier = (value2) => text(value2).toUpperCase();
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
  function searchValue(value2) {
    const query = text(value2);
    if (!query || query.length > 256 || /[\u0000-\u001f]/.test(String(value2))) throw failure("INPUT", "A valid FCR search is required");
    return query;
  }
  function quantity(value2) {
    const raw = text(value2);
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(raw)) throw failure("SCHEMA", "Inventory quantity is invalid");
    const number = Number(raw.replaceAll(",", ""));
    if (!Number.isSafeInteger(number)) throw failure("SCHEMA", "Inventory quantity exceeds the safe range");
    return number;
  }
  function pagination(document) {
    const markers = [...document.querySelectorAll(".pagination-token")].map((node) => node.textContent.trim());
    const terminal = (value2) => /^(?:true|false|null|done)$/i.test(value2);
    const tokens = markers.filter((value2) => value2 && !terminal(value2));
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
  function dateField(value2) {
    const raw = text(value2), iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw), native = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
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
          const label = node.querySelector("th"), value2 = node.querySelector("td");
          if (label && value2) {
            const key = text(label.textContent).toLowerCase(), content = text(value2.querySelector("a")?.textContent || value2.textContent);
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
          const page = await request("inventory-more", { token }, signal);
          active(signal);
          const nextTable = page.querySelector("#table-inventory") || page.querySelector("table:not([id])");
          if (!nextTable) throw failure("SCHEMA", "Inventory continuation table was not returned");
          if (!nextTable.tBodies[0]) throw failure("SCHEMA", "Inventory continuation table body is missing");
          if (nextTable.querySelector("thead th") && JSON.stringify(schema(nextTable).names) !== JSON.stringify(format.names)) {
            throw failure("SCHEMA", "Inventory continuation changed its column schema");
          }
          const parsed = parseInventoryRows(nextTable, format), next = pagination(page);
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
          const page = await request("inventory-history-more", { token }, signal);
          active(signal);
          const nextTable = page.querySelector("#table-inventory-history") || page.querySelector("table:not([id])");
          if (!nextTable) throw failure("SCHEMA", "Inventory History continuation table was not returned");
          if (!nextTable.tBodies[0]) throw failure("SCHEMA", "Inventory History continuation table body is missing");
          const nodes = validateRows(nextTable), next = pagination(page);
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
          const page = await request(endpoint + "-more", { token }, options.signal);
          active(options.signal);
          const nextTable = page.getElementById("table-" + endpoint) || page.querySelector("table:not([id])");
          if (!nextTable?.tBodies[0]) throw failure("SCHEMA", endpoint + ": continuation table was not returned");
          const headers = [...nextTable.tHead?.rows[0]?.cells || []];
          if (headers.length && (headers.length !== width || headers.some((header, index) => text(header.textContent) !== text(table.tHead.rows[0].cells[index].textContent)))) {
            throw failure("SCHEMA", endpoint + ": continuation columns changed");
          }
          const nodes = validate(nextTable), next = pagination(page);
          if (!nodes.length && next || records + nodes.length > maxRows) throw failure("PAGINATION", endpoint + ": continuation is empty or exceeds the row limit");
          for (const marker of page.querySelectorAll(".show-message")) document.getElementById(text(marker.textContent))?.classList.remove("aok-hidden");
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

  // river-entry.mjs
  var VERSION = "0.1.1";
  var guard = Symbol.for("tampermonkey.v4.river.installer");
  if (!window[guard]) {
    window[guard] = { version: VERSION };
    installRouteLifecycle(window, () => {
      if (window.top !== window.self || location.hash.startsWith("#iss-console")) return;
      let helper;
      const emit = (data) => evidence(window, "RIVR", VERSION, data);
      if (location.hostname === "river.amazon.com") helper = createRiverAssistant({ window, getPayload: () => GM_getValue(RIVER_KEY, null), clearPayload: () => GM_setValue(RIVER_KEY, null), onEvidence: emit });
      else {
        const match = location.pathname.match(/^\/([A-Z0-9-]{2,12})\/results(?:\/|$)/i);
        if (!match) return;
        const warehouse = match[1].toUpperCase(), reader = createFcrReader({ origin: location.origin, warehouse, fetch: window.fetch.bind(window), DOMParser: window.DOMParser, onEvidence: emit });
        helper = createRiverCapture({ window, reader, warehouse, version: VERSION, setValue: GM_setValue, open: (url) => {
          const tab = GM_openInTab(url, { active: true, insert: true, setParent: true });
          if (!tab) location.assign(url);
        }, onEvidence: emit });
      }
      const release = registerWatermark(window, "RIVR", VERSION);
      return () => {
        helper.dispose();
        release();
      };
    }, () => location.pathname + location.search + (location.hash.startsWith("#iss-console") ? "iss" : ""), { waitForDom: true });
  }
})();
