// ==UserScript==
// @name         DIAG v0.1.0 Drive Same-Origin Upload Probe
// @namespace    MONKIES
// @version      0.1.0
// @description  User-triggered disposable Drive upload using Drive's own same-origin browser session. No overwrite, rename, or delete.
// @match        https://drive.corp.amazon.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = '0.1.0';
  const PANEL_ID = 'bwu2-drive-same-origin-upload-probe';
  const STORE_KEY = 'bwu2DriveSameOriginTarget_v1';
  const DRIVE_ORIGIN = 'https://drive.corp.amazon.com';

  if (window.__BWU2_DRIVE_SAME_ORIGIN_UPLOAD_PROBE__) return;
  window.__BWU2_DRIVE_SAME_ORIGIN_UPLOAD_PROBE__ = true;

  function readTarget() {
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed.id === 'string' && parsed.id ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function saveTarget(id) {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify({ id, capturedAt: Date.now() }));
      updateStatus();
    } catch (_) {}
  }

  function clearTarget() {
    try { sessionStorage.removeItem(STORE_KEY); } catch (_) {}
    updateStatus();
  }

  function installCapture() {
    const NativeXHR = window.XMLHttpRequest;
    if (!NativeXHR || NativeXHR.prototype.__bwu2SameOriginCapture) return;

    const nativeOpen = NativeXHR.prototype.open;
    const nativeSend = NativeXHR.prototype.send;

    Object.defineProperty(NativeXHR.prototype, '__bwu2SameOriginCapture', {
      value: true,
      configurable: true,
    });

    NativeXHR.prototype.open = function(method, url) {
      this.__bwu2SameOriginMeta = {
        method: String(method || 'GET').toUpperCase(),
        url: String(url || ''),
      };
      return nativeOpen.apply(this, arguments);
    };

    NativeXHR.prototype.send = function(body) {
      try {
        const meta = this.__bwu2SameOriginMeta;
        const targetUrl = new URL(meta?.url || '', location.href);
        if (
          meta?.method === 'POST' &&
          targetUrl.origin === DRIVE_ORIGIN &&
          targetUrl.pathname === '/uploads/batch_create' &&
          typeof body === 'string'
        ) {
          const parsed = JSON.parse(body);
          if (parsed && typeof parsed.id === 'string' && parsed.id && Array.isArray(parsed.paths)) {
            saveTarget(parsed.id);
          }
        }
      } catch (_) {}

      return nativeSend.apply(this, arguments);
    };
  }

  function setStatus(text, kind = '') {
    const el = document.getElementById(`${PANEL_ID}-status`);
    if (!el) return;
    el.className = `status ${kind}`.trim();
    el.textContent = text;
  }

  function updateStatus() {
    const target = readTarget();
    setStatus(
      target
        ? 'TARGET CAPTURED\nReady to test a same-origin Drive upload.'
        : 'WAITING FOR TARGET\nDo one normal upload in this Drive folder.',
      target ? 'good' : 'warn'
    );
  }

  async function runSameOriginUpload() {
    const button = document.getElementById(`${PANEL_ID}-run`);
    if (button) button.disabled = true;

    try {
      const target = readTarget();
      if (!target?.id) throw new Error('No Drive target captured yet');

      const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
      const filename = `Drive_TM_SameOrigin_Test_${stamp}.json`;
      const payload = JSON.stringify({
        version: 1,
        marker: 'BWU2_DRIVE_SAME_ORIGIN_UPLOAD_OK',
        created_at: new Date().toISOString(),
        purpose: 'Disposable same-origin Drive upload validation',
      }, null, 2) + '\n';

      setStatus('1/3 Creating upload slot…', 'warn');

      const createResponse = await fetch('/uploads/batch_create', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json;charset=UTF-8' },
        body: JSON.stringify({ id: target.id, paths: [filename] }),
      });

      if (!createResponse.ok) {
        throw new Error(`batch_create returned HTTP ${createResponse.status}`);
      }

      const created = await createResponse.json();
      const upload = created?.[filename];
      if (!upload || typeof upload.url !== 'string' || !upload.fields || typeof upload.fields !== 'object') {
        throw new Error('batch_create response shape was not usable');
      }

      const uploadUrl = new URL(upload.url);
      if (uploadUrl.hostname !== 'document-versions-production.s3.us-west-2.amazonaws.com') {
        throw new Error(`Unexpected upload host: ${uploadUrl.hostname}`);
      }

      const key = upload.fields.key;
      if (typeof key !== 'string' || !key) throw new Error('Upload key missing');

      const form = new FormData();
      for (const [field, value] of Object.entries(upload.fields)) {
        form.append(field, String(value));
      }
      form.append('file', new File([payload], filename, { type: 'application/json' }));

      setStatus('2/3 Uploading disposable JSON…', 'warn');

      const s3Response = await fetch(upload.url, {
        method: 'POST',
        body: form,
      });

      if (s3Response.status !== 204) {
        throw new Error(`S3 upload returned HTTP ${s3Response.status}`);
      }

      setStatus('3/3 Completing Drive upload…', 'warn');

      const completeResponse = await fetch('/uploads/complete', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json;charset=UTF-8' },
        body: JSON.stringify({ keys: [key] }),
      });

      if (!completeResponse.ok) {
        throw new Error(`uploads/complete returned HTTP ${completeResponse.status}`);
      }

      const completed = await completeResponse.json();
      if (!Array.isArray(completed?.success) || completed.success.length < 1) {
        throw new Error('Drive did not report a successful upload');
      }

      setStatus(`SUCCESS\nCreated ${filename}\nDrive same-origin write path works.`, 'good');
    } catch (error) {
      setStatus(`FAILED\n${String(error?.message || error)}`, 'bad');
    } finally {
      if (button) button.disabled = false;
    }
  }

  function addStyles() {
    if (document.getElementById(`${PANEL_ID}-style`)) return;
    const style = document.createElement('style');
    style.id = `${PANEL_ID}-style`;
    style.textContent = `
      #${PANEL_ID}{position:fixed;right:12px;bottom:12px;z-index:2147483647;width:400px;max-width:calc(100vw - 24px);padding:10px;border:2px solid #232f3e;border-radius:10px;background:#fff;color:#232f3e;box-shadow:0 8px 28px rgba(0,0,0,.22);font:12px/1.4 Arial,sans-serif}
      #${PANEL_ID} *{box-sizing:border-box}
      #${PANEL_ID} .head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px}
      #${PANEL_ID} .head strong{font-size:14px}
      #${PANEL_ID} .tag{font-size:10px;color:#5f6b78;font-weight:800}
      #${PANEL_ID} .status{padding:8px;border-radius:6px;background:#f3f4f6;font-weight:800;white-space:pre-line}
      #${PANEL_ID} .good{background:#e8f5ea;color:#226536}
      #${PANEL_ID} .warn{background:#fff4d6;color:#7c5600}
      #${PANEL_ID} .bad{background:#fbe9e9;color:#8d2929}
      #${PANEL_ID} button{width:100%;margin-top:8px;border:0;border-radius:6px;padding:9px;background:#232f3e;color:#fff;font-weight:900;cursor:pointer}
      #${PANEL_ID} button:disabled{opacity:.55;cursor:wait}
      #${PANEL_ID} .foot{margin-top:7px;font-size:10px;color:#5f6b78;font-weight:700}
    `;
    document.head.appendChild(style);
  }

  function buildPanel() {
    if (!document.body || document.getElementById(PANEL_ID)) return;
    addStyles();

    const panel = document.createElement('div');
    panel.id = PANEL_ID;

    const head = document.createElement('div');
    head.className = 'head';

    const title = document.createElement('strong');
    title.textContent = 'Drive Same-Origin Upload Probe';

    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = `DIAG v${VERSION}`;

    head.append(title, tag);

    const status = document.createElement('div');
    status.id = `${PANEL_ID}-status`;
    status.className = 'status';

    const run = document.createElement('button');
    run.id = `${PANEL_ID}-run`;
    run.type = 'button';
    run.textContent = 'TEST SAME-ORIGIN DRIVE UPLOAD';
    run.addEventListener('click', runSameOriginUpload);

    const forget = document.createElement('button');
    forget.type = 'button';
    forget.textContent = 'Forget Captured Target';
    forget.addEventListener('click', clearTarget);

    const foot = document.createElement('div');
    foot.className = 'foot';
    foot.textContent = 'Creates one uniquely named JSON test file only. No overwrite, rename, delete, tokens, or secret headers are captured.';

    panel.append(head, status, run, forget, foot);
    document.body.appendChild(panel);
    updateStatus();
  }

  installCapture();
  if (document.body) buildPanel();
  else document.addEventListener('DOMContentLoaded', buildPanel, { once: true });
})();
