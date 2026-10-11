// ==UserScript==
// @name V4 PO Portal Lite
// @namespace https://github.com/1Sirkkris/tampermonkey-v4
// @version 0.1.1
// @description Native AU PO search, calendar and reversible Lite result columns.
// @match https://console.harmony.a2z.com/poportal*
// @match http://console.harmony.a2z.com/poportal*
// @grant none
// @run-at document-start
// @updateURL https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/PO_Portal_Lite.user.js
// @downloadURL https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/PO_Portal_Lite.user.js
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
  var escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
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

  // po-runtime.mjs
  var PO_CONDITIONS = ["Complete", "CompletelyConfirmed", "PartiallyConfirmed", "Submitted", "Reserved", "Confirmed"];
  var formatPoDate = (date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
  function monthsAgo(date, months) {
    const target = new Date(date.getFullYear(), date.getMonth() - months, 1);
    target.setDate(Math.min(date.getDate(), new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()));
    return target;
  }
  function poSearchUrl(origin, asin, start, end) {
    const valid = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && formatPoDate(/* @__PURE__ */ new Date(value + "T00:00:00")) === value;
    if (!/^[A-Za-z0-9]{10}$/.test(asin)) throw new Error("Enter a 10-character ASIN / FNSKU");
    if (!valid(start) || !valid(end) || start > end) throw new Error("Choose valid ordered-from/to dates");
    const url = new URL("/poportal/fe", origin);
    for (const [key, value] of Object.entries({ asin: asin.toUpperCase(), startDate: start, endDate: end, countries: "AU", distributorChecks: PO_CONDITIONS.join(","), removeZeroFilter: "false" })) url.searchParams.set(key, value);
    return url.href;
  }
  function createPoPortal({ window: window2, navigate = (url) => window2.location.assign(url) }) {
    const d = window2.document, events = new window2.AbortController(), changed = /* @__PURE__ */ new Set();
    let full = false, selectedDate = null, year, month, disposed = false;
    const root = d.createElement("section");
    root.id = "tm-v4-po";
    root.dataset.tmV4Script = "POP";
    const params = new window2.URLSearchParams(window2.location.search), today = /* @__PURE__ */ new Date();
    root.innerHTML = `<label>ASIN / FNSKu<input data-asin value="${escapeHtml(params.get("asin") || "")}"></label><label>Ordered From<input data-start class="date" value="${escapeHtml(params.get("startDate") || formatPoDate(monthsAgo(today, 6)))}"></label><label>To<input data-end class="date" value="${escapeHtml(params.get("endDate") || formatPoDate(today))}"></label><button data-range="6">6M</button><button data-range="12">12M</button><button data-today>Today</button><button data-search>Search</button><button data-full>Full Portal</button><span>AU • all PO conditions</span><div role="status"></div>`;
    const calendar = d.createElement("div");
    calendar.id = "tm-v4-po-calendar";
    calendar.dataset.tmV4Script = "POP";
    calendar.hidden = true;
    const style = d.createElement("style");
    style.dataset.tmV4Style = "POP";
    style.textContent = "#tm-v4-po{position:sticky;top:0;z-index:2147482000;display:flex;flex-wrap:wrap;align-items:end;gap:8px 10px;padding:10px 12px;margin-bottom:8px;background:#182638;color:white;border-bottom:2px solid #0ea5e9;box-shadow:0 2px 8px #0004;font:700 13px Arial}#tm-v4-po label{display:flex;flex-direction:column;gap:3px}#tm-v4-po input{width:132px;height:32px;box-sizing:border-box;padding:4px 8px;border:1px solid #94a3b8;border-radius:5px;background:white;color:#0f172a;font:700 14px Arial}#tm-v4-po [data-asin]{width:180px}#tm-v4-po button,#tm-v4-po-calendar button{height:32px;padding:0 11px;border:0;border-radius:5px;background:#e2e8f0;color:#0f172a;font:800 13px Arial;cursor:pointer}#tm-v4-po [data-search]{background:#0ea5e9;color:white;min-width:80px}#tm-v4-po [role=status]{width:100%;color:#ffbbbb}#tm-v4-po-calendar{position:fixed;z-index:2147482001;background:white;color:#0f172a;border:1px solid #64748b;box-shadow:0 3px 12px #0005;border-radius:7px;padding:9px;width:300px;font:13px Arial}#tm-v4-po-calendar[hidden]{display:none}#tm-v4-po-calendar header{display:flex;gap:6px;align-items:center;margin-bottom:8px}#tm-v4-po-calendar .grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;text-align:center}#tm-v4-po-calendar .grid button{padding:3px;height:31px}#tm-v4-po-calendar .grid button:hover{background:#0ea5e9;color:white}[data-tm-v4-po-hidden]{display:none}";
    const asin = root.querySelector("[data-asin]"), start = root.querySelector("[data-start]"), end = root.querySelector("[data-end]");
    function renderCalendar() {
      calendar.innerHTML = `<header><button data-step="-1">‹</button><select data-month>${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((name, i) => `<option value="${i}" ${i === month ? "selected" : ""}>${name}</option>`).join("")}</select><select data-year>${Array.from({ length: 16 }, (_, i) => today.getFullYear() - 10 + i).concat(year).filter((x, i, a) => a.indexOf(x) === i).sort((a, b) => a - b).map((y) => `<option ${y === year ? "selected" : ""}>${y}</option>`).join("")}</select><button data-step="1">›</button></header><div class="grid">${["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((x) => `<b>${x}</b>`).join("")}${"<span></span>".repeat(new Date(year, month, 1).getDay())}${Array.from({ length: new Date(year, month + 1, 0).getDate() }, (_, i) => `<button data-day="${i + 1}">${i + 1}</button>`).join("")}</div>`;
    }
    function open(input) {
      selectedDate = input;
      const value = /* @__PURE__ */ new Date(input.value + "T00:00:00"), date = Number.isFinite(value.getTime()) ? value : today;
      year = date.getFullYear();
      month = date.getMonth();
      renderCalendar();
      calendar.hidden = false;
      const rect = input.getBoundingClientRect();
      calendar.style.left = Math.max(5, Math.min(rect.left, window2.innerWidth - 310)) + "px";
      calendar.style.top = Math.min(rect.bottom + 5, window2.innerHeight - 300) + "px";
    }
    function hide(node, value) {
      if (value) {
        if (!node.hasAttribute("data-tm-v4-po-hidden")) node.setAttribute("data-tm-v4-po-hidden", "");
        changed.add(node);
      } else if (changed.has(node)) {
        node.removeAttribute("data-tm-v4-po-hidden");
        changed.delete(node);
      }
    }
    function apply() {
      if (disposed) return;
      for (const node of changed) if (!node.isConnected) {
        node.removeAttribute("data-tm-v4-po-hidden");
        changed.delete(node);
      }
      const native = d.getElementById("asin"), form = native?.closest("form");
      if (form && !form.querySelector('table[id*="purchase" i],table[id*="result" i]')) hide(form, !full);
      for (const table of d.querySelectorAll("table")) {
        const header = [...table.rows].find((row) => {
          const names = [...row.cells].map((cell) => clean(cell.textContent).replace(/[↑↓↕⇅]/g, ""));
          return names.some((x) => /^po id\b/i.test(x)) && names.some((x) => /^status\b/i.test(x)) && names.some((x) => /^fc\b/i.test(x));
        });
        if (!header) continue;
        const keep = [...header.cells].map((cell) => /^(?:po id\b|status\b|fc\b|ordered\b|shipped\b|first recv\b|last recv\b|exp\b|rec\b|disc\b)/i.test(clean(cell.textContent)));
        if (keep.filter(Boolean).length < 8) continue;
        for (const row of table.rows) if (row.cells.length === keep.length) [...row.cells].forEach((cell, i) => hide(cell, !full && !keep[i]));
      }
    }
    function search() {
      try {
        navigate(poSearchUrl(window2.location.origin, clean(asin.value), start.value, end.value));
      } catch (error) {
        root.querySelector("[role=status]").textContent = error.message;
      }
    }
    root.addEventListener("click", (event) => {
      const b = event.target.closest("button");
      if (event.target.matches(".date")) open(event.target);
      if (!b) return;
      if (b.dataset.range) {
        start.value = formatPoDate(monthsAgo(today, Number(b.dataset.range)));
        end.value = formatPoDate(today);
      }
      if (b.hasAttribute("data-today")) end.value = formatPoDate(today);
      if (b.hasAttribute("data-search")) search();
      if (b.hasAttribute("data-full")) {
        full = !full;
        b.textContent = full ? "Lite View" : "Full Portal";
        apply();
      }
    }, { signal: events.signal });
    root.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        search();
      }
    }, { signal: events.signal });
    calendar.addEventListener("click", (event) => {
      const b = event.target.closest("button");
      if (!b) return;
      if (b.dataset.step) {
        const next = new Date(year, month + Number(b.dataset.step), 1);
        year = next.getFullYear();
        month = next.getMonth();
        renderCalendar();
      }
      if (b.dataset.day) {
        selectedDate.value = formatPoDate(new Date(year, month, Number(b.dataset.day)));
        calendar.hidden = true;
        selectedDate.focus();
      }
    }, { signal: events.signal });
    calendar.addEventListener("change", () => {
      year = Number(calendar.querySelector("[data-year]").value);
      month = Number(calendar.querySelector("[data-month]").value);
      renderCalendar();
    }, { signal: events.signal });
    d.addEventListener("mousedown", (event) => {
      if (!calendar.contains(event.target) && !event.target.closest("#tm-v4-po .date")) calendar.hidden = true;
    }, { signal: events.signal });
    d.body.prepend(root);
    d.body.append(calendar);
    d.head.append(style);
    apply();
    const observer = new window2.MutationObserver((records) => {
      if (records.every((record) => root.contains(record.target) || calendar.contains(record.target))) return;
      apply();
    });
    observer.observe(d.body, { subtree: true, childList: true });
    return { root, calendar, apply, dispose() {
      disposed = true;
      observer.disconnect();
      events.abort();
      for (const node of changed) node.removeAttribute("data-tm-v4-po-hidden");
      changed.clear();
      root.remove();
      calendar.remove();
      style.remove();
    } };
  }

  // po-entry.mjs
  var VERSION = "0.1.1";
  var guard = Symbol.for("tampermonkey.v4.po.installer");
  if (!window[guard]) {
    window[guard] = { version: VERSION };
    if (/^\/poportal\/?$/i.test(location.pathname)) location.replace("/poportal/fe" + location.search + location.hash);
    else installRouteLifecycle(window, () => {
      if (window.top !== window.self || !/^\/poportal(?:\/|$)/i.test(location.pathname)) return;
      const release = registerWatermark(window, "POP", VERSION), helper = createPoPortal({ window });
      return () => {
        helper.dispose();
        release();
      };
    }, () => location.pathname, { waitForDom: true });
  }
})();
