// ==UserScript==
// @name        MAIN v5.1.4 SIM Markdown Toolbar
// @namespace    http://tampermonkey.net/
// @version      5.1.4
// @description  SIM Markdown toolbar + table helper + snippets/import/export + open/download attachment images
// @match        https://t.corp.amazon.com/*
// @grant        GM_getValue
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/SIM_Markdown_Toolbar.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/SIM_Markdown_Toolbar.user.js
// ==/UserScript==

(function () {
    "use strict";

    const SNIPPET_KEY = "simMdSnippets_v1";
    const LEGACY_SNIPPET_KEY = "sim_md_snippets_v1";
    const LEGACY_MIGRATION_KEY = "simMdSnippetsLegacyMigrated_v1";
    const TOOLBAR_CLASS = "sim-md-toolbar";
    const IMAGE_BUTTON_CLASS = "sim-open-images-btn";
    const DOWNLOAD_BUTTON_CLASS = "sim-download-images-btn";
    const IMAGE_ACTIONS_CLASS = "sim-image-actions";
    const COLLAPSE_SECTIONS = ["Ticket synopsis", "Announcements"];
    const collapsedSections = new Set();

    function traceSim(type, data = {}) {
        try {
            if (typeof window.BWU2Trace === "function") window.BWU2Trace(type, data);
            else window.postMessage({ __BWU2_TRACE__: true, type, data }, "*");
        } catch (_) {}
    }

    let warnedBadStorage = false;

    function repairJsonControlChars(raw) {
        // Fix "bad control character in string literal" by escaping raw control chars
        // (\n, \r, \t, \b, \f) that appear *inside* JSON strings.
        // Leaves whitespace outside strings untouched.
        let out = "";
        let inStr = false;
        let esc = false;

        for (let i = 0; i < raw.length; i++) {
            const ch = raw[i];

            if (!inStr) {
                if (ch === '"') inStr = true;
                out += ch;
                continue;
            }

            // inStr == true
            if (esc) {
                out += ch;
                esc = false;
                continue;
            }

            if (ch === "\\") {
                out += ch;
                esc = true;
                continue;
            }

            if (ch === '"') {
                out += ch;
                inStr = false;
                continue;
            }

            // Escape raw control characters inside string
            if (ch === "\n") { out += "\\n"; continue; }
            if (ch === "\r") { out += "\\r"; continue; }
            if (ch === "\t") { out += "\\t"; continue; }
            if (ch === "\b") { out += "\\b"; continue; }
            if (ch === "\f") { out += "\\f"; continue; }
            if (ch.charCodeAt(0) < 0x20) {
                out += "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0");
                continue;
            }

            out += ch;
        }

        return out;
    }

    function normalizeImported(arr) {
        if (!Array.isArray(arr)) return [];
        const out = [];
        for (const x of arr) {
            if (!x || typeof x !== "object") continue;
            const name = String(x.name ?? "").trim();
            const text = String(x.text ?? "");
            if (!name) continue;
            out.push({ name, text });
        }
        return out;
    }

    function loadCurrentSnippets() {
        const raw = localStorage.getItem(SNIPPET_KEY);
        if (!raw) return [];
        try {
            return normalizeImported(JSON.parse(raw));
        } catch (_) {
            // Attempt repair for malformed JSON where newlines/tabs were pasted directly into string values
            try {
                const repaired = repairJsonControlChars(raw);
                const parsed = normalizeImported(JSON.parse(repaired));
                // Persist the repaired form so future loads are clean
                localStorage.setItem(SNIPPET_KEY, JSON.stringify(parsed));
                if (!warnedBadStorage) {
                    warnedBadStorage = true;
                    console.warn("[SIM MD] Repaired malformed snippet storage and re-saved.");
                }
                return parsed;
            } catch (e2) {
                if (!warnedBadStorage) {
                    warnedBadStorage = true;
                    console.warn("[SIM MD] Current snippet storage is malformed; legacy recovery will be attempted.");
                }
                return [];
            }
        }
    }

    function normalizeLegacySnippets(value) {
        let data = value;

        if (typeof data === "string") {
            const candidates = [data];
            if (data.startsWith("s{") || data.startsWith("s[")) candidates.push(data.slice(1));

            data = null;
            for (const candidate of candidates) {
                try {
                    data = JSON.parse(candidate);
                    break;
                } catch (_) {}
            }
        }

        if (Array.isArray(data)) return normalizeImported(data);
        if (!data || typeof data !== "object") return [];

        return normalizeImported(
            Object.entries(data).map(([name, text]) => ({ name, text }))
        );
    }

    function loadLegacySnippets() {
        const found = [];

        // Very old builds used the snake_case key. Check page storage too in case
        // a browser/profile migration placed the value there.
        try {
            const raw = localStorage.getItem(LEGACY_SNIPPET_KEY);
            if (raw) found.push(...normalizeLegacySnippets(raw));
        } catch (_) {}

        // Older Tampermonkey backups kept the same key in userscript storage.
        // Read-only migration: never overwrite or delete the legacy copy.
        try {
            if (typeof GM_getValue === "function") {
                const legacy = GM_getValue(LEGACY_SNIPPET_KEY, null);
                if (legacy != null) found.push(...normalizeLegacySnippets(legacy));
            }
        } catch (_) {}

        const unique = [];
        const names = new Set();
        for (const sn of found) {
            if (names.has(sn.name)) continue;
            names.add(sn.name);
            unique.push(sn);
        }
        return unique;
    }

    function legacyMigrationComplete() {
        try {
            return localStorage.getItem(LEGACY_MIGRATION_KEY) === "1";
        } catch (_) {
            return false;
        }
    }

    function markLegacyMigrationComplete() {
        try {
            localStorage.setItem(LEGACY_MIGRATION_KEY, "1");
        } catch (_) {}
    }

    function loadSnippets() {
        const current = loadCurrentSnippets();
        if (legacyMigrationComplete()) return current;

        const legacy = loadLegacySnippets();
        if (!legacy.length) return current;

        const merged = current.slice();
        const names = new Set(merged.map(sn => sn.name));

        for (const sn of legacy) {
            if (names.has(sn.name)) continue;
            names.add(sn.name);
            merged.push(sn);
        }

        if (merged.length !== current.length) {
            localStorage.setItem(SNIPPET_KEY, JSON.stringify(merged));
            console.info(`[SIM MD] Restored ${merged.length - current.length} legacy snippet(s).`);
        }

        // Legacy recovery is a one-time migration. Without this marker, deleting
        // a snippet makes the old legacy copy appear again on the next refresh.
        markLegacyMigrationComplete();
        return merged;
    }

    function saveSnippets(v) {
        const clean = normalizeImported(v || []);
        localStorage.setItem(SNIPPET_KEY, JSON.stringify(clean));
        // Any explicit add/edit/delete/import makes the current store authoritative.
        // Do not silently resurrect older legacy entries after the user's change.
        markLegacyMigrationComplete();
        snippets = clean;
        refreshAllSnippetSelects();
    }

    let snippets = loadSnippets();

    function injectStyles() {
        if (document.getElementById("sim-md-style")) return;
        const s = document.createElement("style");
        s.id = "sim-md-style";
        s.textContent = `
            .${TOOLBAR_CLASS} {
                display: flex;
                align-items: center;
                gap: 4px;
                margin-bottom: 6px;
                flex-wrap: nowrap;
            }
            .${TOOLBAR_CLASS} button {
                flex: 0 0 auto;
                width: auto;
                min-width: unset !important;
                max-width: unset !important;
                padding: 2px 6px;
                height: 24px;
                font-size: 11px;
                line-height: 20px;
                white-space: nowrap;
                box-sizing: border-box;
            }
            .${TOOLBAR_CLASS} select {
                flex: 0 0 auto;
                min-width: 180px;
                height: 24px;
            }
            .${IMAGE_ACTIONS_CLASS} {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                flex: 0 0 auto;
                margin-left: 8px;
                padding: 0;
                list-style: none;
            }

            .${IMAGE_BUTTON_CLASS},
            .${DOWNLOAD_BUTTON_CLASS} {
                margin: 0;
                padding: 2px 8px;
                height: 24px;
                font-size: 11px;
                line-height: 18px;
                white-space: nowrap;
                vertical-align: middle;
                cursor: pointer;
                border: 1px solid transparent;
                border-radius: 4px;
                font-weight: 600;
            }

            .${IMAGE_BUTTON_CLASS} {
                background: #dbeafe;
                border-color: #93c5fd;
                color: #1d4ed8;
            }

            .${IMAGE_BUTTON_CLASS}:hover {
                background: #bfdbfe;
            }

            .${DOWNLOAD_BUTTON_CLASS} {
                background: #dcfce7;
                border-color: #86efac;
                color: #166534;
            }

            .${DOWNLOAD_BUTTON_CLASS}:hover {
                background: #bbf7d0;
            }

            .${DOWNLOAD_BUTTON_CLASS}:disabled {
                opacity: 0.8;
                cursor: wait;
            }
        `;
        document.head.appendChild(s);
    }

    function setTextareaValue(ta, value) {
        // Use the native textarea setter so React notices the value change reliably.
        const setter = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            "value"
        )?.set;

        if (setter) setter.call(ta, value);
        else ta.value = value;

        ta.dispatchEvent(new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: null
        }));
    }

    function restoreSelection(ta, start, end) {
        const place = () => {
            if (!ta.isConnected) return;
            ta.focus();
            ta.setSelectionRange(start, end);
        };

        // SIM/React may render once after the input event. Restoring on the next
        // two animation frames keeps the caret/selection exactly where intended.
        requestAnimationFrame(() => {
            place();
            requestAnimationFrame(place);
        });
    }

    function apply(ta, fn) {
        const s = ta.selectionStart ?? 0;
        const e = ta.selectionEnd ?? s;
        const v = ta.value;
        const o = fn({ s, e, v, sel: v.slice(s, e) });
        if (!o) return;

        setTextareaValue(ta, o.v);
        restoreSelection(ta, o.ss, o.se);
    }

    function wrap(ta, open, close) {
        apply(ta, ({ s, e, v, sel }) => ({
            v: v.slice(0, s) + open + sel + close + v.slice(e),

            // No highlighted text: caret sits BETWEEN the markdown markers.
            // Highlighted text: keep the original text selected inside them.
            ss: s + open.length,
            se: s + open.length + sel.length
        }));
    }

    const insert = (ta,t)=>apply(ta,({s,v})=>({v:v.slice(0,s)+t+v.slice(s),ss:s+t.length,se:s+t.length}));


    function prefixLines(ta, prefixForIndex) {
        apply(ta, ({ s, e, v }) => {
            const lineStart = v.lastIndexOf("\n", Math.max(0, s - 1)) + 1;

            if (s === e) {
                const prefix = prefixForIndex(0);
                return {
                    v: v.slice(0, lineStart) + prefix + v.slice(lineStart),
                    ss: s + prefix.length,
                    se: s + prefix.length
                };
            }

            let selectionEnd = e;
            if (selectionEnd > s && v[selectionEnd - 1] === "\n") selectionEnd--;

            const nextBreak = v.indexOf("\n", selectionEnd);
            const lineEnd = nextBreak === -1 ? v.length : nextBreak;
            const block = v.slice(lineStart, lineEnd);
            const lines = block.split("\n");

            const changed = lines
                .map((line, index) => prefixForIndex(index) + line)
                .join("\n");

            return {
                v: v.slice(0, lineStart) + changed + v.slice(lineEnd),
                ss: lineStart,
                se: lineStart + changed.length
            };
        });
    }

    function insertCodeBlock(ta) {
        apply(ta, ({ s, e, v, sel }) => {
            const left = v.slice(0, s);
            const right = v.slice(e);

            const before = left.length && !left.endsWith("\n") ? "\n" : "";
            const after = right.length && !right.startsWith("\n") ? "\n" : "";

            const open = "```\n";
            const close = "\n```";
            const replacement = before + open + sel + close + after;
            const contentStart = s + before.length + open.length;

            return {
                v: left + replacement + right,
                ss: contentStart,
                se: contentStart + sel.length
            };
        });
    }

    function insertHorizontalRule(ta) {
        apply(ta, ({ s, e, v }) => {
            const left = v.slice(0, s);
            const right = v.slice(e);

            // Keep a blank line around the rule so "---" cannot be interpreted
            // as a setext heading underline for the preceding text.
            const before = !left.length
                ? ""
                : left.endsWith("\n\n")
                    ? ""
                    : left.endsWith("\n")
                        ? "\n"
                        : "\n\n";

            const after = !right.length
                ? ""
                : right.startsWith("\n\n")
                    ? ""
                    : right.startsWith("\n")
                        ? "\n"
                        : "\n\n";

            const replacement = before + "---" + after;
            const caret = s + replacement.length;

            return {
                v: left + replacement + right,
                ss: caret,
                se: caret
            };
        });
    }

    function escapeTableCell(value) {
        return String(value ?? "")
            .trim()
            .replace(/\|/g, "\\|")
            .replace(/\r?\n/g, " ");
    }

    function insertTable(ta) {
        apply(ta, ({ s, e, v, sel }) => {
            // If the user selected tab-separated data (for example copied from
            // Excel), turn it straight into a Markdown table using row 1 as headers.
            if (sel && sel.includes("\t")) {
                const rows = sel
                    .replace(/\r\n?/g, "\n")
                    .split("\n")
                    .filter((row, index, arr) => row.length || index < arr.length - 1)
                    .map(row => row.split("\t").map(escapeTableCell));

                while (rows.length && rows[rows.length - 1].every(cell => !cell)) {
                    rows.pop();
                }

                if (rows.length) {
                    const columnCount = Math.max(...rows.map(row => row.length));
                    rows.forEach(row => {
                        while (row.length < columnCount) row.push("");
                    });

                    const header = rows[0];
                    const body = rows.slice(1);
                    const tableLines = [
                        `| ${header.join(" | ")} |`,
                        `| ${Array(columnCount).fill("---").join(" | ")} |`,
                        ...body.map(row => `| ${row.join(" | ")} |`)
                    ];

                    const table = tableLines.join("\n");
                    return {
                        v: v.slice(0, s) + table + v.slice(e),
                        ss: s,
                        se: s + table.length
                    };
                }
            }

            // No selection: insert a useful 3-column starter and select Header 1.
            if (!sel) {
                const table =
                    "| HEADER 1 | HEADER 2 | HEADER 3 |\n" +
                    "| --- | --- | --- |\n" +
                    "| TEXT 1 | TEXT 2 | TEXT 3 |";

                const headerStart = s + 2;
                return {
                    v: v.slice(0, s) + table + v.slice(e),
                    ss: headerStart,
                    se: headerStart + "HEADER 1".length
                };
            }

            alert("Table: select tab-separated cells (for example copied from Excel), or use the button with nothing selected for a blank table.");
            return null;
        });
    }

    function fillSnippetOptions(sel) {
        // Always refresh from storage so console-set/imported changes show without a full reload
        snippets = loadSnippets();

        sel.innerHTML = "";
        const opt = (v,t,d)=>{
            const o=document.createElement("option");
            o.value=v; o.textContent=t;
            if (d) o.disabled=true;
            sel.appendChild(o);
        };
        opt("","Snippets\u2026");
        opt("","\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",true);
        snippets.forEach((s,i)=>opt("s:"+i,s.name));
        opt("","\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",true);
        opt("add","+ Add Snippet");
        opt("manage","Manage Snippets");
        sel.value="";
    }

    function refreshAllSnippetSelects() {
        document.querySelectorAll("." + TOOLBAR_CLASS + " select[data-role='snippets']").forEach(sel => {
            fillSnippetOptions(sel);
            sel.value = "";
        });
    }

    function handleSnippetSelect(sel, ta) {
        const v = sel.value;
        if (!v) return;
        if (v.startsWith("s:")) {
            const sn = snippets[parseInt(v.slice(2), 10)];
            if (sn) insert(ta, sn.text);
        } else if (v === "add") openSnippetEditor();
        else if (v === "manage") openSnippetManager();
        sel.value="";
    }

    function escapeHtml(str) {
        return String(str ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function openSnippetEditor(edit) {
        const isEdit = typeof edit === "number";
        snippets = loadSnippets();
        const sn = isEdit ? snippets[edit] : { name:"", text:"" };

        const bd=document.createElement("div");
        bd.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:9999";
        const m=document.createElement("div");
        m.style.cssText="background:#fff;padding:16px;border-radius:6px;width:640px";

        m.innerHTML=`
            <b>${isEdit?"Edit":"Add"} Snippet</b><br><br>
            Name<br><input id="n" style="width:100%" value="${escapeHtml(sn?.name || "")}"><br><br>
            Text<br><textarea id="t" style="width:100%;height:200px">${escapeHtml(sn?.text || "")}</textarea><br><br>
            <button id="save">Save</button>
            <button id="cancel">Cancel</button>
        `;

        bd.appendChild(m); document.body.appendChild(bd);

        m.querySelector("#cancel").onclick=()=>bd.remove();
        m.querySelector("#save").onclick=()=>{
            const name=m.querySelector("#n").value.trim();
            if (!name) return alert("Name required");
            const text=m.querySelector("#t").value;

            const fresh = loadSnippets();
            if (isEdit) fresh[edit] = { name, text };
            else fresh.push({ name, text });

            saveSnippets(fresh);
            bd.remove();
        };
    }

    function openSnippetManager() {
        snippets = loadSnippets();

        const bd=document.createElement("div");
        bd.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:9999";
        const m=document.createElement("div");
        m.style.cssText="background:#fff;padding:16px;border-radius:6px;width:520px";

        m.innerHTML = `<b>Manage Snippets</b><br><br>` +
            snippets.map((s,i)=>`
                <div style="display:flex;justify-content:space-between;margin-bottom:4px">
                    <span>${escapeHtml(s.name)}</span>
                    <span>
                        <button data-e="${i}">Edit</button>
                        <button data-d="${i}">Del</button>
                    </span>
                </div>`).join("") +
            `<br><button id="close">Close</button>`;

        bd.appendChild(m); document.body.appendChild(bd);

        m.querySelector("#close").onclick=()=>bd.remove();
        m.querySelectorAll("[data-e]").forEach(b=>b.onclick=()=>{bd.remove();openSnippetEditor(parseInt(b.dataset.e,10));});
        m.querySelectorAll("[data-d]").forEach(b=>b.onclick=()=>{
            const i=parseInt(b.dataset.d,10);
            if (!confirm("Delete snippet?")) return;

            const fresh = loadSnippets();
            fresh.splice(i,1);
            saveSnippets(fresh);

            bd.remove(); openSnippetManager();
        });
    }

    function downloadText(filename, text) {
        const blob = new Blob([text], { type: "application/json;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2500);
    }

    function tsForFilename() {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        return (
            d.getFullYear() +
            pad(d.getMonth() + 1) +
            pad(d.getDate()) + "-" +
            pad(d.getHours()) +
            pad(d.getMinutes()) +
            pad(d.getSeconds())
        );
    }

    function exportSnippets() {
        const payload = JSON.stringify(loadSnippets(), null, 2);
        downloadText(`sim-snippets-${tsForFilename()}.json`, payload);
    }

    function mergeSnippets(existing, incoming) {
        const out = (existing || []).slice();
        const names = new Set(out.map(s => s && s.name).filter(Boolean));

        for (const sn of incoming) {
            let name = sn.name;
            if (!names.has(name)) {
                out.push({ name, text: sn.text });
                names.add(name);
                continue;
            }
            let n = 2;
            while (names.has(`${name} (${n})`)) n++;
            const newName = `${name} (${n})`;
            out.push({ name: newName, text: sn.text });
            names.add(newName);
        }
        return out;
    }

    function importSnippetsFromFile(file) {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const raw = String(reader.result || "");
                const parsed = JSON.parse(raw);
                const incoming = normalizeImported(parsed);
                if (!incoming.length) return alert("Import failed: no valid snippets found.");

                const existing = loadSnippets();
                const hasExisting = existing.length > 0;

                if (hasExisting) {
                    const overwrite = confirm(
                        "Import snippets:\n\nOK = OVERWRITE existing snippets\nCancel = MERGE (keep existing; duplicates get a suffix)"
                    );
                    if (overwrite) {
                        saveSnippets(incoming);
                        alert(`Imported ${incoming.length} snippets (overwrote existing).`);
                    } else {
                        const merged = mergeSnippets(existing, incoming);
                        saveSnippets(merged);
                        alert(`Imported ${incoming.length} snippets (merged).`);
                    }
                } else {
                    saveSnippets(incoming);
                    alert(`Imported ${incoming.length} snippets.`);
                }
            } catch (e) {
                alert("Import failed: invalid JSON file.");
            }
        };
        reader.onerror = () => alert("Import failed: could not read file.");
        reader.readAsText(file);
    }


    function getImageAttachments() {
        const imageExt = /\.(?:jpe?g|png|gif|webp|bmp|avif)(?:$|[?#])/i;
        const seen = new Set();
        const out = [];

        // Keep detection inside the Attachments table/section where possible so an
        // unrelated .jpg link in the ticket body is not accidentally included.
        const label = findAttachmentsLabel();
        const scope =
            (label && label.closest("table")) ||
            (label && label.closest("section")) ||
            document;

        scope.querySelectorAll("a[href]").forEach(a => {
            const href = a.href;
            if (!href || href.startsWith("javascript:")) return;

            const label = (a.textContent || a.getAttribute("download") || "").trim();

            let path = "";
            try {
                path = decodeURIComponent(new URL(href, location.href).pathname);
            } catch (_) {
                path = href;
            }

            if (!imageExt.test(label) && !imageExt.test(path)) return;
            if (seen.has(href)) return;

            seen.add(href);
            out.push({
                url: href,
                name: label || path.split("/").pop() || `Image ${out.length + 1}`
            });
        });

        return out;
    }

    function findAttachmentsLabel() {
        const remembered = document.querySelector('[data-sim-attachments-label="1"]');
        if (remembered) return remembered;

        const candidates = document.querySelectorAll(
            "th,h1,h2,h3,h4,h5,h6,legend,summary,strong,b,span,div"
        );

        for (const el of candidates) {
            if ((el.textContent || "").trim() !== "Attachments") continue;

            // Prefer the smallest exact-text element so the buttons land beside
            // the label, not on a large parent container.
            const childHasExactText = Array.from(el.children).some(
                child => (child.textContent || "").trim() === "Attachments"
            );

            if (!childHasExactText) {
                el.dataset.simAttachmentsLabel = "1";
                return el;
            }
        }

        return null;
    }

    function findAuditTrailTab() {
        const tabs = document.querySelectorAll('[role="tab"]');

        for (const tab of tabs) {
            if ((tab.textContent || "").trim() === "Audit Trail") return tab;
        }

        return null;
    }

    function ensureImageActionsGroup() {
        let group = document.querySelector("." + IMAGE_ACTIONS_CLASS);
        const auditTab = findAuditTrailTab();

        if (!auditTab) return null;

        const tabList = auditTab.closest('[role="tablist"]');
        if (!tabList) return null;

        const auditItem = auditTab.closest('li,[role="presentation"]') || auditTab;

        if (!group) {
            group = document.createElement("li");
            group.className = IMAGE_ACTIONS_CLASS;
            group.setAttribute("role", "presentation");
        }

        if (group.parentElement !== tabList || group.previousElementSibling !== auditItem) {
            auditItem.insertAdjacentElement("afterend", group);
        }

        return group;
    }

    function styleGalleryWindow(win, images) {
        const d = win.document;

        d.open();
        d.write("<!doctype html><html><head><title>SIM Attachments</title></head><body></body></html>");
        d.close();

        d.documentElement.style.background = "#111";
        d.body.style.cssText =
            "margin:0;padding:16px;background:#111;color:#eee;" +
            "font:13px system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;";

        const header = d.createElement("div");
        header.style.cssText =
            "position:sticky;top:0;z-index:10;background:#111;padding:4px 0 12px;" +
            "font-weight:600;font-size:14px;";
        header.textContent = `SIM Attachments \u2014 ${images.length} image${images.length === 1 ? "" : "s"}`;
        d.body.appendChild(header);

        images.forEach((item, index) => {
            const card = d.createElement("section");
            card.style.cssText =
                "margin:0 0 18px;padding:10px;background:#1b1b1b;border:1px solid #333;" +
                "border-radius:8px;";

            const title = d.createElement("a");
            title.href = item.url;
            title.target = "_blank";
            title.rel = "noopener";
            title.textContent = `${index + 1}. ${item.name}`;
            title.title = "Click: open image \u2022 Ctrl+Click: copy displayed filename";
            title.style.cssText =
                "display:block;margin:0 0 8px;color:#8ab4f8;text-decoration:none;" +
                "font-weight:600;overflow-wrap:anywhere;";

            title.addEventListener("click", async (event) => {
                if (!event.ctrlKey) return;

                event.preventDefault();
                event.stopPropagation();

                const copyText = title.textContent;

                try {
                    await win.navigator.clipboard.writeText(copyText);
                } catch (_) {
                    // Clipboard API fallback for locked-down/internal Firefox setups.
                    const copyBox = d.createElement("textarea");
                    copyBox.value = copyText;
                    copyBox.style.cssText =
                        "position:fixed;left:-9999px;top:-9999px;opacity:0;";
                    d.body.appendChild(copyBox);
                    copyBox.focus();
                    copyBox.select();
                    d.execCommand("copy");
                    copyBox.remove();
                }

                const original = title.textContent;
                title.textContent = `\u2713 Copied: ${copyText}`;
                setTimeout(() => {
                    if (title.isConnected) title.textContent = original;
                }, 900);
            });

            const img = d.createElement("img");
            img.src = item.url;
            img.alt = item.name;
            img.loading = "eager";
            img.style.cssText =
                "display:block;max-width:100%;height:auto;margin:0 auto;background:#fff;";

            card.appendChild(title);
            card.appendChild(img);
            d.body.appendChild(card);
        });
    }

    function openImageGallery() {
        const images = getImageAttachments();
        if (!images.length) {
            alert("No image attachments found.");
            return;
        }

        // A single dedicated window is reliable from a userscript.
        // Forcing many tabs into one specific Firefox window requires extension APIs.
        const win = window.open(
            "",
            `sim-attachments-${Date.now()}`,
            "popup=yes,width=1500,height=950,resizable=yes,scrollbars=yes"
        );

        if (!win) {
            alert("Firefox blocked the attachment window. Allow pop-ups for t.corp.amazon.com and try again.");
            return;
        }

        styleGalleryWindow(win, images);
        win.focus();
    }


    async function downloadAllImages(event) {
        const images = getImageAttachments();
        if (!images.length) {
            alert("No image attachments found.");
            return;
        }

        const btn = event?.currentTarget;
        const normalLabel = `Download Images (${images.length})`;

        if (btn) {
            btn.disabled = true;
            btn.textContent = `Downloading 0/${images.length}`;
        }

        let completed = 0;

        for (const item of images) {
            try {
                // Fetching as a blob forces a real download instead of opening
                // the image viewer. Credentials are retained for internal links.
                const response = await fetch(item.url, {
                    credentials: "include",
                    cache: "no-store"
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);

                const blob = await response.blob();
                const blobUrl = URL.createObjectURL(blob);

                const a = document.createElement("a");
                a.href = blobUrl;
                a.download = item.name;
                a.style.display = "none";
                document.body.appendChild(a);
                a.click();
                a.remove();

                setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
            } catch (error) {
                console.warn("[SIM MD] Blob download failed; trying direct download:", item.url, error);

                // Same-origin direct-download fallback.
                const a = document.createElement("a");
                a.href = item.url;
                a.download = item.name;
                a.style.display = "none";
                document.body.appendChild(a);
                a.click();
                a.remove();
            }

            completed++;
            if (btn) btn.textContent = `Downloading ${completed}/${images.length}`;
        }

        if (btn) {
            btn.textContent = `\u2713 Downloaded (${images.length})`;
            setTimeout(() => {
                if (!btn.isConnected) return;
                btn.disabled = false;
                btn.textContent = normalLabel;
            }, 1200);
        }
    }

    function attachImageButton() {
        const images = getImageAttachments();
        let openBtn = document.querySelector("." + IMAGE_BUTTON_CLASS);
        let downloadBtn = document.querySelector("." + DOWNLOAD_BUTTON_CLASS);
        let group = document.querySelector("." + IMAGE_ACTIONS_CLASS);

        if (!images.length) {
            if (group) group.remove();
            return;
        }

        group = ensureImageActionsGroup();
        if (!group) return;

        if (!openBtn) {
            openBtn = document.createElement("button");
            openBtn.type = "button";
            openBtn.className = IMAGE_BUTTON_CLASS;
            openBtn.title = "Open all image attachments in one scrollable Firefox gallery window";
            openBtn.addEventListener("click", openImageGallery);
            group.appendChild(openBtn);
        } else if (openBtn.parentElement !== group) {
            group.appendChild(openBtn);
        }
        const openLabel = `Open Images (${images.length})`;
        if (openBtn.textContent !== openLabel) openBtn.textContent = openLabel;

        if (!downloadBtn) {
            downloadBtn = document.createElement("button");
            downloadBtn.type = "button";
            downloadBtn.className = DOWNLOAD_BUTTON_CLASS;
            downloadBtn.title = "Download all image attachments";
            downloadBtn.addEventListener("click", downloadAllImages);
            group.appendChild(downloadBtn);
        } else if (downloadBtn.parentElement !== group) {
            group.appendChild(downloadBtn);
        }

        if (!downloadBtn.disabled) {
            const downloadLabel = `Download Images (${images.length})`;
            if (downloadBtn.textContent !== downloadLabel) downloadBtn.textContent = downloadLabel;
        }
    }

    function buildToolbar(ta) {
        const bar=document.createElement("div");
        bar.className = TOOLBAR_CLASS;

        const B=(l,f,title)=>{
            const b=document.createElement("button");
            b.type="button";
            b.textContent=l;
            if (title) b.title = title;
            b.onclick=()=>f(ta);
            bar.appendChild(b);
        };

        B("Bold",    t=>wrap(t,"**","**"), "Bold");
        B("Italics", t=>wrap(t,"*","*"), "Italics");
        B("BoldIT",  t=>wrap(t,"***","***"), "Bold + italics");
        B("Code",    t=>wrap(t,"`","`"), "Inline code");
        B("CodeBlk", insertCodeBlock, "Fenced code block");
        B("Quote",   t=>prefixLines(t,()=>"> "), "Quote selected line(s)");
        B("\u2022",       t=>prefixLines(t,()=>"- "), "Bullet selected line(s)");
        B("1.",      t=>prefixLines(t,i=>`${i+1}. `), "Number selected line(s)");
        B("Table",   insertTable, "Blank table, or convert selected Excel/tab-separated cells");
        B("HR",      insertHorizontalRule, "Horizontal rule");
        B("Space",   t=>insert(t,"&nbsp;"), "Non-breaking space");
        B("Strike",  t=>wrap(t,"~~","~~"), "Strikethrough (SIM extension)");

        const sel=document.createElement("select");
        sel.dataset.role = "snippets";
        fillSnippetOptions(sel);
        sel.onchange=()=>handleSnippetSelect(sel,ta);
        bar.appendChild(sel);

        const exportBtn = document.createElement("button");
        exportBtn.type = "button";
        exportBtn.textContent = "Export";
        exportBtn.title = "Download your snippet templates as a .json file";
        exportBtn.onclick = () => exportSnippets();
        bar.appendChild(exportBtn);

        const importBtn = document.createElement("button");
        importBtn.type = "button";
        importBtn.textContent = "Import";
        importBtn.title = "Import snippet templates from a .json file";
        importBtn.onclick = () => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "application/json,.json";
            input.style.display = "none";
            input.onchange = () => {
                const f = input.files && input.files[0];
                if (f) importSnippetsFromFile(f);
                input.remove();
            };
            document.body.appendChild(input);
            input.click();
        };
        bar.appendChild(importBtn);

        return bar;
    }

    function collapseDefaultSections() {
        if (collapsedSections.size >= COLLAPSE_SECTIONS.length) return;

        const buttons = document.querySelectorAll('[class*="expand-button"][aria-expanded="true"]');
        for (const btn of buttons) {
            const text = String(btn.textContent || "").trim();
            const section = COLLAPSE_SECTIONS.find(name => !collapsedSections.has(name) && text.includes(name));
            if (!section) continue;
            btn.click();
            collapsedSections.add(section);
            traceSim("SIM_AUTO_COLLAPSE", { section });
        }
    }

    function attach() {
        let attached = 0;
        document.querySelectorAll('textarea[data-testid="sim-markdownEditor--textArea"]').forEach(ta=>{
            if (ta.dataset.simToolbar === "1") return;

            const parent = ta.parentNode;
            if (!parent) return;

            // SIM can re-render pieces of the editor while tagging/mentioning users.
            // Always clear any toolbar already living in this editor container before
            // attaching to a newly-rendered textarea. This prevents stacked duplicates.
            parent.querySelectorAll("." + TOOLBAR_CLASS).forEach(tb=>tb.remove());

            parent.insertBefore(buildToolbar(ta), ta);
            ta.dataset.simToolbar = "1";
            attached++;
        });
        if (attached) traceSim("SIM_MARKDOWN_ATTACH", { count: attached });
    }

    let attachQueued = false;
    function scheduleAttach() {
        if (attachQueued) return;
        attachQueued = true;

        requestAnimationFrame(() => {
            attachQueued = false;
            attach();
            attachImageButton();
            collapseDefaultSections();
        });
    }

    injectStyles();
    scheduleAttach();

    const mo = new MutationObserver(scheduleAttach);
    mo.observe(document.body, { childList:true, subtree:true });

    // One existing observer now owns toolbar/image/collapse reconciliation.
    // Bounded fallbacks cover late page hydration without a second observer.
    setTimeout(scheduleAttach, 1500);
    setTimeout(scheduleAttach, 5000);
    window.addEventListener("pageshow", scheduleAttach);
})();
