// ==UserScript==
// @name         DIAG v0.1.0 Drive Bridge Probe
// @namespace    MONKIES
// @version      0.1.0
// @description  Disposable read/write probe for a Drive-hosted JSON file. No production data touched.
// @match        https://t.corp.amazon.com/*
// @grant        GM_xmlhttpRequest
// @connect      drive-render.corp.amazon.com
// @run-at       document-end
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = '0.1.0';
  const TARGET_URL = 'https://drive-render.corp.amazon.com/view/krmclenn@/Drive_TM_Bridge_Test.json';
  const EXPECTED_READ_MARKER = 'BWU2_DRIVE_BRIDGE_READ_OK';
  const PANEL_ID = 'bwu2-drive-bridge-probe';

  if (document.getElementById(PANEL_ID)) return;

  const state = {
    lastGoodJson: null,
    busy: false,
  };

  function safeText(value) {
    return String(value == null ? '' : value);
  }

  function gmRequest({ method = 'GET', url = TARGET_URL, data = null, headers = {} }) {
    return new Promise((resolve, reject) => {
      const started = performance.now();

      GM_xmlhttpRequest({
        method,
        url,
        data,
        headers,
        timeout: 15000,
        anonymous: false,
        onload: response => {
          resolve({
            ok: response.status >= 200 && response.status < 300,
            status: response.status,
            statusText: response.statusText || '',
            text: response.responseText || '',
            finalUrl: response.finalUrl || url,
            ms: Math.round(performance.now() - started),
            allow: response.responseHeaders?.match(/^allow:\s*(.+)$/im)?.[1]?.trim() || '',
            etag: response.responseHeaders?.match(/^etag:\s*(.+)$/im)?.[1]?.trim() || '',
          });
        },
        onerror: () => reject(new Error('GM request network error')),
        ontimeout: () => reject(new Error('GM request timed out')),
        onabort: () => reject(new Error('GM request aborted')),
      });
    });
  }

  async function pageRequest({ method = 'GET', body = null }) {
    const started = performance.now();
    const response = await fetch(TARGET_URL, {
      method,
      body,
      cache: 'no-store',
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json;charset=UTF-8' } : undefined,
    });

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText || '',
      text: await response.text(),
      finalUrl: response.url || TARGET_URL,
      ms: Math.round(performance.now() - started),
      allow: response.headers.get('Allow') || '',
      etag: response.headers.get('ETag') || '',
    };
  }

  function parseJson(text) {
    try {
      return JSON.parse(text);
    } catch (_) {
      return null;
    }
  }

  function setBusy(value) {
    state.busy = !!value;
    document.querySelectorAll(`#${PANEL_ID} button`).forEach(button => {
      button.disabled = state.busy;
    });
  }

  function resultNode() {
    return document.getElementById('bwu2-drive-probe-result');
  }

  function show(title, lines, kind = '') {
    const box = resultNode();
    if (!box) return;

    box.className = `bwu2-drive-probe-result ${kind}`.trim();
    box.replaceChildren();

    const strong = document.createElement('strong');
    strong.textContent = title;
    box.appendChild(strong);

    for (const line of lines || []) {
      const div = document.createElement('div');
      div.textContent = line;
      box.appendChild(div);
    }
  }

  async function readViaGM() {
    setBusy(true);
    show('GM READ — testing...', []);

    try {
      const response = await gmRequest({ method: 'GET' });
      const parsed = parseJson(response.text);

      if (!response.ok) {
        show('GM READ — FAILED', [
          `HTTP ${response.status} ${response.statusText}`.trim(),
          response.allow ? `Allow: ${response.allow}` : '',
        ].filter(Boolean), 'bad');
        return;
      }

      if (!parsed) {
        show('GM READ — HTTP OK, JSON FAILED', [
          `HTTP ${response.status} in ${response.ms}ms`,
          `Returned ${response.text.length} bytes but not valid JSON.`,
        ], 'warn');
        return;
      }

      state.lastGoodJson = parsed;
      const markerOk = parsed.read_marker === EXPECTED_READ_MARKER;

      show(markerOk ? 'GM READ — SUCCESS' : 'GM READ — JSON LOADED', [
        `HTTP ${response.status} in ${response.ms}ms`,
        `Marker: ${safeText(parsed.read_marker) || '(missing)'}`,
        markerOk ? 'Tampermonkey can read the Drive JSON cross-site.' : 'JSON loaded, but marker did not match.',
      ], markerOk ? 'good' : 'warn');
    } catch (error) {
      show('GM READ — FAILED', [safeText(error.message || error)], 'bad');
    } finally {
      setBusy(false);
    }
  }

  async function readViaPage() {
    setBusy(true);
    show('PAGE READ — testing...', []);

    try {
      const response = await pageRequest({ method: 'GET' });
      const parsed = parseJson(response.text);

      show(response.ok && parsed ? 'PAGE READ — SUCCESS' : 'PAGE READ — FAILED', [
        `HTTP ${response.status} ${response.statusText}`.trim(),
        `Valid JSON: ${parsed ? 'YES' : 'NO'}`,
        `Time: ${response.ms}ms`,
      ], response.ok && parsed ? 'good' : 'bad');
    } catch (error) {
      show('PAGE READ — FAILED', [
        safeText(error.message || error),
        'This usually means normal browser CORS/auth blocked the cross-site request.',
      ], 'bad');
    } finally {
      setBusy(false);
    }
  }

  function buildWritePayload(source) {
    const next = source && typeof source === 'object'
      ? JSON.parse(JSON.stringify(source))
      : {
          version: 1,
          purpose: 'Disposable Tampermonkey <-> Drive bridge probe',
          read_marker: EXPECTED_READ_MARKER,
        };

    next.write_test = {
      marker: `tm-write-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      saved_at: new Date().toISOString(),
      writer: 'DIAG_Drive_Bridge_Probe',
    };

    return next;
  }

  async function verifyWrite(expectedMarker) {
    const response = await gmRequest({ method: 'GET' });
    const parsed = parseJson(response.text);

    return {
      response,
      parsed,
      matched: !!(
        response.ok &&
        parsed &&
        parsed.write_test &&
        parsed.write_test.marker === expectedMarker
      ),
    };
  }

  async function writeViaGM() {
    setBusy(true);
    show('GM WRITE — reading disposable file first...', []);

    try {
      let source = state.lastGoodJson;

      if (!source) {
        const firstRead = await gmRequest({ method: 'GET' });
        source = parseJson(firstRead.text);
        if (!firstRead.ok || !source) {
          show('GM WRITE — STOPPED', [
            'Could not safely read the disposable JSON before attempting the write.',
          ], 'bad');
          return;
        }
      }

      const next = buildWritePayload(source);
      const marker = next.write_test.marker;

      show('GM WRITE — attempting PUT...', [
        'Only Drive_TM_Bridge_Test.json is targeted.',
      ], 'warn');

      const response = await gmRequest({
        method: 'PUT',
        data: JSON.stringify(next, null, 2),
        headers: { 'Content-Type': 'application/json;charset=UTF-8' },
      });

      if (!response.ok) {
        show('GM WRITE — REJECTED', [
          `HTTP ${response.status} ${response.statusText}`.trim(),
          response.allow ? `Allow: ${response.allow}` : 'No Allow header returned.',
          'Nothing else was touched.',
        ], 'bad');
        return;
      }

      const verify = await verifyWrite(marker);

      show(
        verify.matched ? 'GM WRITE — SUCCESS' : 'GM WRITE — NOT PROVEN',
        [
          `PUT returned HTTP ${response.status} in ${response.ms}ms`,
          verify.matched
            ? 'Re-read matched the saved marker. Tampermonkey can write this Drive file.'
            : 'PUT looked successful, but re-read did not contain the marker.',
        ],
        verify.matched ? 'good' : 'warn'
      );
    } catch (error) {
      show('GM WRITE — FAILED', [
        safeText(error.message || error),
        'Nothing else was touched.',
      ], 'bad');
    } finally {
      setBusy(false);
    }
  }

  async function writeViaPage() {
    setBusy(true);
    show('PAGE WRITE — reading disposable file first...', []);

    try {
      let source = state.lastGoodJson;

      if (!source) {
        const firstRead = await pageRequest({ method: 'GET' });
        source = parseJson(firstRead.text);
        if (!firstRead.ok || !source) {
          show('PAGE WRITE — STOPPED', [
            'Normal page request could not safely read the disposable JSON first.',
          ], 'bad');
          return;
        }
      }

      const next = buildWritePayload(source);
      const marker = next.write_test.marker;

      const response = await pageRequest({
        method: 'PUT',
        body: JSON.stringify(next, null, 2),
      });

      const verify = response.ok ? await verifyWrite(marker) : { matched: false };

      show(
        response.ok && verify.matched ? 'PAGE WRITE — SUCCESS' : 'PAGE WRITE — FAILED',
        [
          `HTTP ${response.status} ${response.statusText}`.trim(),
          response.allow ? `Allow: ${response.allow}` : '',
          response.ok
            ? (verify.matched ? 'Re-read matched the saved marker.' : 'PUT returned success but persistence was not proven.')
            : 'Normal browser request was rejected.',
        ].filter(Boolean),
        response.ok && verify.matched ? 'good' : 'bad'
      );
    } catch (error) {
      show('PAGE WRITE — FAILED', [
        safeText(error.message || error),
        'Likely normal browser CORS/auth rejection.',
      ], 'bad');
    } finally {
      setBusy(false);
    }
  }

  function buildUi() {
    const style = document.createElement('style');
    style.textContent = `
      #${PANEL_ID}{
        position:fixed;
        right:14px;
        bottom:14px;
        z-index:2147483647;
        width:360px;
        max-width:calc(100vw - 28px);
        padding:12px;
        border:2px solid #232f3e;
        border-radius:10px;
        background:#fff;
        color:#232f3e;
        box-shadow:0 8px 26px rgba(0,0,0,.22);
        font:12px/1.4 Arial,sans-serif;
      }
      #${PANEL_ID} *{box-sizing:border-box}
      #${PANEL_ID} .head{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:8px;
        margin-bottom:8px;
      }
      #${PANEL_ID} .head strong{font-size:14px}
      #${PANEL_ID} .tag{font-size:10px;color:#5f6b78;font-weight:800}
      #${PANEL_ID} .buttons{
        display:grid;
        grid-template-columns:1fr 1fr;
        gap:6px;
      }
      #${PANEL_ID} button{
        border:0;
        border-radius:6px;
        padding:8px;
        background:#232f3e;
        color:#fff;
        font-weight:900;
        cursor:pointer;
      }
      #${PANEL_ID} button.write{background:#a23b3b}
      #${PANEL_ID} button:disabled{opacity:.55;cursor:wait}
      #${PANEL_ID} .target{
        margin:8px 0;
        padding:6px;
        border-radius:6px;
        background:#f3f4f6;
        font:10px/1.35 Consolas,monospace;
        overflow-wrap:anywhere;
      }
      #${PANEL_ID} .bwu2-drive-probe-result{
        margin-top:8px;
        padding:8px;
        border-radius:6px;
        background:#f3f4f6;
        min-height:54px;
      }
      #${PANEL_ID} .bwu2-drive-probe-result.good{background:#e8f5ea;color:#226536}
      #${PANEL_ID} .bwu2-drive-probe-result.warn{background:#fff4d6;color:#7c5600}
      #${PANEL_ID} .bwu2-drive-probe-result.bad{background:#fbe9e9;color:#8d2929}
      #${PANEL_ID} .bwu2-drive-probe-result strong{display:block;margin-bottom:3px}
      #${PANEL_ID} .foot{margin-top:7px;font-size:10px;color:#5f6b78;font-weight:700}
    `;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = PANEL_ID;

    const head = document.createElement('div');
    head.className = 'head';

    const title = document.createElement('strong');
    title.textContent = 'Drive Bridge Probe';

    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = `DIAG v${VERSION}`;

    head.append(title, tag);

    const target = document.createElement('div');
    target.className = 'target';
    target.textContent = TARGET_URL;

    const buttons = document.createElement('div');
    buttons.className = 'buttons';

    const actions = [
      ['GM READ', readViaGM, false],
      ['PAGE READ', readViaPage, false],
      ['GM WRITE TEST', writeViaGM, true],
      ['PAGE WRITE TEST', writeViaPage, true],
    ];

    for (const [label, fn, write] of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      if (write) button.className = 'write';
      button.addEventListener('click', fn);
      buttons.appendChild(button);
    }

    const result = document.createElement('div');
    result.id = 'bwu2-drive-probe-result';
    result.className = 'bwu2-drive-probe-result';
    result.innerHTML = '<strong>Ready</strong><div>Run GM READ first.</div>';

    const foot = document.createElement('div');
    foot.className = 'foot';
    foot.textContent = 'WRITE buttons target only the disposable Drive_TM_Bridge_Test.json file. No cookies/tokens are displayed or stored.';

    panel.append(head, target, buttons, result, foot);
    document.body.appendChild(panel);
  }

  buildUi();
})();
