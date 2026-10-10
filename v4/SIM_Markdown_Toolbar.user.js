// ==UserScript==
// @name V4 SIM Markdown Toolbar
// @namespace https://github.com/1Sirkkris/tampermonkey-v4
// @version 0.1.1
// @description Native editor formatting, snippets and attachment gallery/download controls.
// @match https://t.corp.amazon.com/*
// @grant none
// @run-at document-start
// @updateURL https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/SIM_Markdown_Toolbar.user.js
// @downloadURL https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/SIM_Markdown_Toolbar.user.js
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

  // sim-markdown.mjs
  function markdownEdit(value, start, end, command, text = "") {
    const left = value.slice(0, start), selected = value.slice(start, end), right = value.slice(end), replace = (insert, a = start, b = start + insert.length) => ({ value: left + insert + right, start: a, end: b });
    const wraps = { Bold: "**", Italics: "*", BoldIT: "***", Code: "`", Strike: "~~" };
    if (wraps[command]) {
      const marker = wraps[command];
      return replace(marker + selected + marker, start + marker.length, start + marker.length + selected.length);
    }
    if (command === "Space" || command === "Snippet") {
      const insert = command === "Space" ? "&nbsp;" : text;
      return { value: left + insert + value.slice(start), start: start + insert.length, end: start + insert.length };
    }
    if (["Quote", "•", "1."].includes(command)) {
      const from = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1, to = start === end ? from : value.indexOf("\n", end > start && value[end - 1] === "\n" ? end - 1 : end), stop = to < 0 ? value.length : to;
      const prefix = (i) => command === "Quote" ? "> " : command === "•" ? "- " : `${i + 1}. `;
      if (start === end) {
        const insert = prefix(0);
        return { value: value.slice(0, from) + insert + value.slice(from), start: start + insert.length, end: start + insert.length };
      }
      const block = value.slice(from, stop).split("\n").map((line, i) => prefix(i) + line).join("\n");
      return { value: value.slice(0, from) + block + value.slice(stop), start: from, end: from + block.length };
    }
    if (command === "CodeBlk") {
      const before = left && !left.endsWith("\n") ? "\n" : "", after = right && !right.startsWith("\n") ? "\n" : "";
      return replace(before + "```\n" + selected + "\n```" + after, start + before.length + 4, start + before.length + 4 + selected.length);
    }
    if (command === "HR") {
      const before = !left || left.endsWith("\n\n") ? "" : left.endsWith("\n") ? "\n" : "\n\n", after = !right || right.startsWith("\n\n") ? "" : right.startsWith("\n") ? "\n" : "\n\n";
      const insert = before + "---" + after;
      return replace(insert, start + insert.length, start + insert.length);
    }
    if (command === "Table") {
      if (!selected) {
        const insert2 = "| HEADER 1 | HEADER 2 | HEADER 3 |\n| --- | --- | --- |\n| TEXT 1 | TEXT 2 | TEXT 3 |";
        return replace(insert2, start + 2, start + 10);
      }
      if (!selected.includes("	")) throw new Error("Table: select tab-separated cells or leave selection empty");
      const rows = selected.replace(/\r\n?/g, "\n").split("\n").map((row) => row.split("	").map((cell) => cell.trim().replace(/\|/g, "\\|")));
      while (rows.length && rows.at(-1).every((cell) => !cell)) rows.pop();
      const width = Math.max(...rows.map((row) => row.length));
      for (const row of rows) while (row.length < width) row.push("");
      const line = (row) => "| " + row.join(" | ") + " |";
      const insert = [line(rows[0]), line(Array(width).fill("---")), ...rows.slice(1).map(line)].join("\n");
      return replace(insert);
    }
    throw new Error("Unknown formatting command");
  }
  function normalizeSnippets(value) {
    if (!Array.isArray(value)) throw new Error("Snippet import must be a JSON array");
    if (value.length > 1e3) throw new Error("Snippet limit exceeded");
    return value.map((row) => {
      if (!row || typeof row.name !== "string" || !row.name.trim() || typeof row.text !== "string" || row.text.length > 1e6) throw new Error("Invalid snippet name/text");
      return { name: row.name.trim(), text: row.text };
    });
  }
  function mergeSnippets(existing, incoming) {
    const rows = existing.map((row) => ({ ...row })), names = new Set(rows.map((row) => row.name));
    for (const row of incoming) {
      let name = row.name, n = 2;
      while (names.has(name)) name = `${row.name} (${n++})`;
      rows.push({ name, text: row.text });
      names.add(name);
    }
    return rows;
  }

  // ui-tools.mjs
  var clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
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

  // sim-runtime.mjs
  function attachmentScope(d) {
    const label = [...d.querySelectorAll("th,h1,h2,h3,h4,legend,summary,strong,b,span,div")].find((node) => clean(node.textContent) === "Attachments" && ![...node.children].some((child) => clean(child.textContent) === "Attachments"));
    return label ? label.closest("table,section") || label.parentElement : null;
  }
  function imageAttachments(window2) {
    const scope = attachmentScope(window2.document), seen = /* @__PURE__ */ new Set(), rows = [];
    if (!scope) return rows;
    for (const link of scope.querySelectorAll("a[href]")) {
      let url;
      try {
        url = new window2.URL(link.href);
      } catch {
        continue;
      }
      if (!/^https?:$/.test(url.protocol) || seen.has(url.href)) continue;
      const name = clean(link.textContent || link.getAttribute("download"));
      let path;
      try {
        path = decodeURIComponent(url.pathname);
      } catch {
        continue;
      }
      if (!/\.(?:jpe?g|png|gif|webp|bmp|avif)(?:$|[?#])/i.test(name) && !/\.(?:jpe?g|png|gif|webp|bmp|avif)$/i.test(path)) continue;
      seen.add(url.href);
      rows.push({ url: url.href, name: name || path.split("/").at(-1) });
    }
    return rows;
  }
  function createSimToolbar({ window: window2, onEvidence = () => {
  } }) {
    const d = window2.document, events = new window2.AbortController(), key = "tm-v4.sim.snippets", bars = /* @__PURE__ */ new Map(), owned = /* @__PURE__ */ new Set(), urls = /* @__PURE__ */ new Set(), collapsed = /* @__PURE__ */ new Set();
    let disposed = false, downloadController = null, imageGroup = null, modal = null, scheduled = false, attachments = null;
    const style = d.createElement("style");
    style.dataset.tmV4Style = "SIMTt";
    style.textContent = ".tm-v4-sim-bar{display:flex;align-items:center;gap:4px;margin-bottom:6px;flex-wrap:nowrap}.tm-v4-sim-bar button,.tm-v4-sim-images button{flex:0 0 auto;width:auto;min-width:0;max-width:none;padding:2px 6px;height:24px;font:11px/20px Arial;white-space:nowrap;box-sizing:border-box;cursor:pointer}.tm-v4-sim-bar select{flex:0 0 auto;min-width:180px;height:24px}.tm-v4-sim-images{display:inline-flex;align-items:center;gap:4px;margin-left:8px;padding:0;list-style:none}.tm-v4-sim-images button:first-child{background:#dbeafe;border:1px solid #93c5fd;color:#1d4ed8;border-radius:4px}.tm-v4-sim-images button:last-child{background:#dcfce7;border:1px solid #86efac;color:#166534;border-radius:4px}.tm-v4-sim-modal{position:fixed;inset:0;background:#0006;display:flex;align-items:center;justify-content:center;z-index:999999;color:#111;font:13px Arial}.tm-v4-sim-modal>div{background:white;padding:16px;border-radius:6px;width:640px;max-width:95vw;max-height:90vh;overflow:auto}.tm-v4-sim-modal input,.tm-v4-sim-modal textarea{box-sizing:border-box;width:100%}.tm-v4-sim-modal textarea{height:200px}.tm-v4-sim-modal .row{display:flex;justify-content:space-between;margin-bottom:5px}.tm-v4-sim-status{font:11px Arial;color:#a33120}";
    d.head.append(style);
    const mark = (node) => {
      node.dataset.tmV4Script = "SIMTt";
      owned.add(node);
      return node;
    };
    function load() {
      const raw = window2.localStorage.getItem(key);
      return raw ? normalizeSnippets(JSON.parse(raw)) : [];
    }
    function save(rows) {
      const json = JSON.stringify(normalizeSnippets(rows));
      window2.localStorage.setItem(key, json);
      if (window2.localStorage.getItem(key) !== json) throw new Error("Snippet storage failed");
      refresh();
    }
    function report(text) {
      for (const bar of bars.values()) bar.querySelector("[role=status]").textContent = text;
    }
    function refresh() {
      let rows;
      try {
        rows = load();
      } catch (error) {
        report("Snippet storage corrupt — preserved. " + error.message);
        return;
      }
      for (const bar of bars.values()) {
        const select = bar.querySelector("select");
        select.innerHTML = '<option value="">Snippets…</option>' + rows.map((row, i) => `<option value="s:${i}">${escapeHtml(row.name)}</option>`).join("") + '<option value="add">+ Add Snippet</option><option value="manage">Manage Snippets</option>';
      }
    }
    function apply(ta, command, text) {
      if (disposed || !ta.isConnected) return;
      try {
        const result = markdownEdit(ta.value, ta.selectionStart ?? 0, ta.selectionEnd ?? 0, command, text);
        Object.getOwnPropertyDescriptor(window2.HTMLTextAreaElement.prototype, "value").set.call(ta, result.value);
        ta.dispatchEvent(new window2.Event("input", { bubbles: true }));
        ta.dispatchEvent(new window2.Event("change", { bubbles: true }));
        ta.focus();
        ta.setSelectionRange(result.start, result.end);
      } catch (error) {
        report(error.message);
      }
    }
    function show(content) {
      modal?.remove();
      modal = mark(d.createElement("div"));
      modal.className = "tm-v4-sim-modal";
      modal.innerHTML = "<div>" + content + "</div>";
      d.body.append(modal);
      return modal;
    }
    function editor(index) {
      let rows;
      try {
        rows = load();
      } catch (error) {
        return report(error.message);
      }
      const row = index == null ? { name: "", text: "" } : rows[index];
      const node = show(`<b>${index == null ? "Add" : "Edit"} Snippet</b><p>Name</p><input data-name value="${escapeHtml(row.name)}"><p>Text</p><textarea data-text>${escapeHtml(row.text)}</textarea><button data-save>Save</button> <button data-cancel>Cancel</button><p role="status"></p>`);
      node.querySelector("[data-cancel]").onclick = () => node.remove();
      node.querySelector("[data-save]").onclick = () => {
        try {
          const fresh = load(), entry = { name: node.querySelector("[data-name]").value.trim(), text: node.querySelector("[data-text]").value };
          normalizeSnippets([entry]);
          if (index == null) fresh.push(entry);
          else fresh[index] = entry;
          save(fresh);
          node.remove();
        } catch (error) {
          node.querySelector("[role=status]").textContent = error.message;
        }
      };
    }
    function manager() {
      let rows;
      try {
        rows = load();
      } catch (error) {
        return report(error.message);
      }
      const node = show("<b>Manage Snippets</b><p></p>" + rows.map((row, i) => `<div class="row"><span>${escapeHtml(row.name)}</span><span><button data-edit="${i}">Edit</button><button data-delete="${i}">Del</button></span></div>`).join("") + "<button data-close>Close</button>");
      node.onclick = (event) => {
        const b = event.target.closest("button");
        if (!b) return;
        if (b.hasAttribute("data-close")) node.remove();
        if (b.dataset.edit) editor(Number(b.dataset.edit));
        if (b.dataset.delete != null && window2.confirm("Delete snippet?")) {
          const fresh = load();
          fresh.splice(Number(b.dataset.delete), 1);
          save(fresh);
          manager();
        }
      };
    }
    function downloadBlob(blob, name) {
      const url = window2.URL.createObjectURL(blob);
      urls.add(url);
      const link = d.createElement("a");
      link.href = url;
      link.download = name;
      d.body.append(link);
      link.click();
      link.remove();
      window2.setTimeout(() => {
        window2.URL.revokeObjectURL(url);
        urls.delete(url);
      }, 5e3);
    }
    function exportSnippets() {
      try {
        downloadBlob(new window2.Blob([JSON.stringify(load(), null, 2)], { type: "application/json" }), "sim-snippets-" + (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-") + ".json");
      } catch (error) {
        report(error.message);
      }
    }
    function importSnippets() {
      const input = mark(d.createElement("input"));
      input.type = "file";
      input.accept = ".json,application/json";
      input.hidden = true;
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) {
          input.remove();
          return;
        }
        const reader = new window2.FileReader();
        reader.onload = () => {
          if (disposed) return;
          try {
            const incoming = normalizeSnippets(JSON.parse(String(reader.result)));
            if (!incoming.length) throw new Error("No snippets in import");
            const existing = load();
            save(!existing.length || window2.confirm("OK = OVERWRITE existing snippets; Cancel = MERGE with duplicate suffixes") ? incoming : mergeSnippets(existing, incoming));
            report("Imported " + incoming.length + " snippets");
          } catch (error) {
            report("Import failed — existing snippets preserved: " + error.message);
          }
          input.remove();
        };
        reader.onerror = () => {
          report("Import failed");
          input.remove();
        };
        reader.readAsText(file);
      };
      d.body.append(input);
      input.click();
    }
    function gallery() {
      const images = imageAttachments(window2);
      if (!images.length) return;
      const popup = window2.open("", "sim-attachments-" + Date.now(), "popup=yes,width=1500,height=950,resizable=yes,scrollbars=yes");
      if (!popup) return report("Allow pop-ups for t.corp.amazon.com");
      const doc = popup.document;
      doc.open();
      doc.write("<!doctype html><html><head><title>SIM Attachments</title></head><body></body></html>");
      doc.close();
      doc.body.style.cssText = "margin:0;padding:16px;background:#111;color:#eee;font:13px Arial";
      const heading = doc.createElement("h3");
      heading.textContent = "SIM Attachments — " + images.length + " images";
      doc.body.append(heading);
      for (const [item, index] of images.map((x, i) => [x, i])) {
        const card = doc.createElement("section");
        card.style.cssText = "margin:0 0 18px;padding:10px;background:#1b1b1b;border:1px solid #333;border-radius:8px";
        const link = doc.createElement("a");
        link.href = item.url;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = `${index + 1}. ${item.name}`;
        link.style.cssText = "display:block;margin-bottom:8px;color:#8ab4f8;font-weight:bold";
        link.onclick = async (event) => {
          if (!event.ctrlKey) return;
          event.preventDefault();
          const value = link.textContent;
          try {
            await popup.navigator.clipboard.writeText(value);
          } catch {
            const copy = doc.createElement("textarea");
            copy.value = value;
            doc.body.append(copy);
            copy.select();
            doc.execCommand("copy");
            copy.remove();
          }
          link.textContent = "✓ Copied: " + value;
          popup.setTimeout(() => link.textContent = value, 900);
        };
        const image = doc.createElement("img");
        image.src = item.url;
        image.alt = item.name;
        image.style.cssText = "display:block;max-width:100%;height:auto;margin:auto;background:white";
        card.append(link, image);
        doc.body.append(card);
      }
      popup.focus();
    }
    async function bulk(button) {
      if (downloadController) return;
      downloadController = new window2.AbortController();
      const controller = downloadController, images = imageAttachments(window2);
      button.disabled = true;
      let completed = 0, failed = 0, direct = 0;
      try {
        for (const item of images) {
          if (controller.signal.aborted) break;
          const itemController = new window2.AbortController(), cancel = () => itemController.abort();
          controller.signal.addEventListener("abort", cancel, { once: true });
          const timer = window2.setTimeout(cancel, 25e3);
          try {
            button.textContent = `Downloading ${completed}/${images.length}`;
            const response = await window2.fetch(item.url, { credentials: "include", cache: "no-store", signal: itemController.signal });
            if (!response.ok || response.redirected && !/^image\//i.test(response.headers.get("content-type") || "")) throw new Error("Attachment auth/HTTP failure");
            const blob = await response.blob();
            if (!blob.size || !/^image\//i.test(blob.type)) throw new Error("Attachment is not an image");
            if (controller.signal.aborted) break;
            downloadBlob(blob, item.name);
            completed++;
          } catch {
            failed++;
            if (!controller.signal.aborted && new window2.URL(item.url).origin === window2.location.origin) {
              const link = d.createElement("a");
              link.href = item.url;
              link.download = item.name;
              d.body.append(link);
              link.click();
              link.remove();
              direct++;
            }
          } finally {
            window2.clearTimeout(timer);
            controller.signal.removeEventListener("abort", cancel);
          }
        }
        report(`${completed} blob download(s) handed to browser • ${direct} direct handoff(s) • ${failed} fetch failure(s)`);
        onEvidence({ type: "sim.images", intent: "read", data: { completed, direct, failed } });
      } finally {
        downloadController = null;
        if (button.isConnected) {
          button.disabled = false;
          button.textContent = "Download Images (" + images.length + ")";
        }
      }
    }
    function attach() {
      scheduled = false;
      if (disposed) return;
      attachments = attachmentScope(d);
      for (const [ta, bar] of bars) if (!ta.isConnected) {
        bar.remove();
        owned.delete(bar);
        bars.delete(ta);
      }
      for (const ta of d.querySelectorAll('textarea[data-testid="sim-markdownEditor--textArea"]')) {
        if (bars.has(ta) && bars.get(ta).isConnected) continue;
        const bar = mark(d.createElement("div"));
        bar.className = "tm-v4-sim-bar";
        for (const command of ["Bold", "Italics", "BoldIT", "Code", "CodeBlk", "Quote", "•", "1.", "Table", "HR", "Space", "Strike"]) {
          const button = d.createElement("button");
          button.type = "button";
          button.textContent = command;
          button.onmousedown = (event) => event.preventDefault();
          button.onclick = () => apply(ta, command);
          bar.append(button);
        }
        const select = d.createElement("select");
        select.onchange = () => {
          try {
            if (select.value.startsWith("s:")) apply(ta, "Snippet", load()[Number(select.value.slice(2))].text);
            else if (select.value === "add") editor();
            else if (select.value === "manage") manager();
          } catch (error) {
            report(error.message);
          }
          select.value = "";
        };
        bar.append(select);
        for (const [label, handler] of [["Export", exportSnippets], ["Import", importSnippets]]) {
          const button = d.createElement("button");
          button.type = "button";
          button.textContent = label;
          button.onclick = handler;
          bar.append(button);
        }
        const status = d.createElement("span");
        status.className = "tm-v4-sim-status";
        status.setAttribute("role", "status");
        bar.append(status);
        ta.before(bar);
        bars.set(ta, bar);
      }
      refresh();
      const images = imageAttachments(window2), audit = [...d.querySelectorAll("[role=tab]")].find((node) => clean(node.textContent) === "Audit Trail"), tabs = audit?.closest("[role=tablist]");
      if (images.length && tabs) {
        if (!imageGroup?.isConnected) {
          imageGroup = mark(d.createElement("li"));
          imageGroup.className = "tm-v4-sim-images";
          imageGroup.setAttribute("role", "presentation");
          for (const [label, handler] of [["Open Images", gallery], ["Download Images", bulk]]) {
            const button = d.createElement("button");
            button.type = "button";
            button.textContent = label + " (" + images.length + ")";
            button.onclick = () => handler(button);
            imageGroup.append(button);
          }
          (audit.closest("li,[role=presentation]") || audit).after(imageGroup);
        } else for (const [index, button] of [...imageGroup.children].entries()) if (!button.disabled) {
          const label = (index ? "Download" : "Open") + " Images (" + images.length + ")";
          if (button.textContent !== label) button.textContent = label;
        }
      } else imageGroup?.remove();
      for (const button of d.querySelectorAll('[class*="expand-button"][aria-expanded=true]')) for (const title of ["Ticket synopsis", "Announcements"]) if (!collapsed.has(title) && clean(button.textContent).includes(title)) {
        collapsed.add(title);
        button.click();
      }
    }
    const nativeSelector = 'textarea[data-testid="sim-markdownEditor--textArea"],[role=tab],[class*="expand-button"]';
    function relevant(node) {
      if (node.nodeType !== 1) return false;
      if (node.closest('[data-tm-v4-script="SIMTt"]')) return false;
      if (node.matches(nativeSelector) || node.querySelector(nativeSelector)) return true;
      return [...node.querySelectorAll("th,h1,h2,h3,h4,legend,summary,strong,b,span,div"), node].some((label) => clean(label.textContent) === "Attachments");
    }
    const observer = new window2.MutationObserver((records) => {
      if (disposed) return;
      const changed = records.some((record) => {
        if (record.target.closest?.('[data-tm-v4-script="SIMTt"]')) return false;
        if (attachments?.contains(record.target) || record.target.closest?.("[role=tablist]")) return true;
        return [...record.addedNodes, ...record.removedNodes].some((node) => relevant(node) || node === attachments || node.contains?.(attachments));
      });
      if (!changed) return;
      if (!scheduled) {
        scheduled = true;
        window2.queueMicrotask(attach);
      }
    });
    observer.observe(d.body, { subtree: true, childList: true });
    attach();
    window2.addEventListener("storage", (event) => {
      if (event.key === key) refresh();
    }, { signal: events.signal });
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      downloadController?.abort();
      observer.disconnect();
      events.abort();
      for (const node of owned) node.remove();
      style.remove();
      for (const url of urls) window2.URL.revokeObjectURL(url);
      urls.clear();
    };
    window2.addEventListener("pagehide", dispose, { signal: events.signal });
    return { bars, apply, load, save, attach, dispose };
  }

  // sim-entry.mjs
  var VERSION = "0.1.1";
  var guard = Symbol.for("tampermonkey.v4.sim.installer");
  if (!window[guard]) {
    window[guard] = { version: VERSION };
    installRouteLifecycle(window, () => {
      if (window.top !== window.self) return;
      const release = registerWatermark(window, "SIMTt", VERSION), helper = createSimToolbar({ window, onEvidence: (data) => evidence(window, "SIMTt", VERSION, data) });
      return () => {
        helper.dispose();
        release();
      };
    }, () => location.pathname, { waitForDom: true });
  }
})();
