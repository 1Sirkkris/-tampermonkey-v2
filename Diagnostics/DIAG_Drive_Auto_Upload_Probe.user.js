// ==UserScript==
// @name         DIAG v0.1.0 Drive Auto Upload Probe
// @namespace    MONKIES
// @version      0.1.0
// @description  Captures the current Drive folder target from one normal upload, then performs one user-triggered disposable JSON upload from SIM via GM_xmlhttpRequest.
// @match        https://drive.corp.amazon.com/*
// @match        https://t.corp.amazon.com/*
// @match        https://sim.amazon.com/*
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @connect      drive.corp.amazon.com
// @connect      document-versions-production.s3.us-west-2.amazonaws.com
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = '0.1.0';
  const STORE_KEY = 'bwu2DriveAutoUploadTarget_v1';
  const PANEL_ID = 'bwu2-drive-auto-upload-probe';
  const DRIVE_ORIGIN = 'https://drive.corp.amazon.com';

  if (window.__BWU2_DRIVE_AUTO_UPLOAD_PROBE__) return;
  window.__BWU2_DRIVE_AUTO_UPLOAD_PROBE__ = true;

  function gmRequest(options) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        timeout: 20000,
        anonymous: false,
        ...options,
        onload: response => resolve(response),
        onerror: () => reject(new Error('Network error')),
        ontimeout: () => reject(new Error('Request timed out')),
        onabort: () => reject(new Error('Request aborted')),
      });
    });
  }

  function parseJson(text) {
    try {
      return JSON.parse(text || '');
    } catch (_) {
      return null;
    }
  }

  function isDrivePage() {
    return location.hostname === 'drive.corp.amazon.com';
  }

  function isSimPage() {
    return location.hostname === 'sim.amazon.com' || location.hostname === 't.corp.amazon.com';
  }

  function installDriveCapture() {
    const w = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const NativeXHR = w.XMLHttpRequest;
    if (!NativeXHR || NativeXHR.prototype.__bwu2DriveAutoUploadWrapped) return;

    const nativeOpen = NativeXHR.prototype.open;
    const nativeSend = NativeXHR.prototype.send;

    Object.defineProperty(NativeXHR.prototype, '__bwu2DriveAutoUploadWrapped', {
      value: true,
      configurable: true,
    });

    NativeXHR.prototype.open = function(method, url) {
      this.__bwu2DriveAutoUploadMeta = {
        method: String(method || 'GET').toUpperCase(),
        url: String(url || ''),
      };
      return nativeOpen.apply(this, arguments);
    };

    NativeXHR.prototype.send = function(body) {
      try {
        const meta = this.__bwu2DriveAutoUploadMeta;
        const targetUrl = new URL(meta?.url || '', w.location.href);
        if (
          meta?.method === 'POST' &&
          targetUrl.origin === DRIVE_ORIGIN &&
          targetUrl.pathname === '/uploads/batch_create' &&
          typeof body === 'string'
        ) {
          const parsed = JSON.parse(body);
          if (parsed && typeof parsed.id === 'string' && parsed.id && Array.isArray(parsed.paths)) {
            GM_setValue(STORE_KEY, {
              id: parsed.id,
              capturedAt: Date.now(),
            }).then(() => updateDriveStatus(true)).catch(() => {});
          }
        }
      } catch (_) {}

      return nativeSend.apply(this, arguments);
    };
  }

  function addStyles() {
    if (document.getElementById(`${PANEL_ID}-style`)) return;
    const style = document.createElement('style');
    style.id = `${PANEL_ID}-style`;
    style.textContent = `
      #${PANEL_ID}{position:fixed;right:12px;bottom:12px;z-index:2147483647;width:390px;max-width:calc(100vw - 24px);padding:10px;border:2px solid #232f3e;border-radius:10px;background:#fff;color:#232f3e;box-shadow:0 8px 28px rgba(0,0,0,.22);font:12px/1.4 Arial,sans-serif}
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
    title.textContent = 'Drive Auto Upload Probe';

    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = `DIAG v${VERSION}`;

    head.append(title, tag);

    const status = document.createElement('div');
    status.id = `${PANEL_ID}-status`;
    status.className = 'status';

    panel.append(head, status);

    if (isDrivePage()) {
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.textContent = 'Forget Captured Target';
      clear.addEventListener('click', async () => {
        await GM_deleteValue(STORE_KEY);
        updateDriveStatus(false);
      });
      panel.appendChild(clear);

      const foot = document.createElement('div');
      foot.className = 'foot';
      foot.textContent = 'Do one normal Drive upload in this folder. The folder target is stored only inside Tampermonkey and is never displayed or copied.';
      panel.appendChild(foot);
    }

    if (isSimPage()) {
      const button = document.createElement('button');
      button.id = `${PANEL_ID}-run`;
      button.type = 'button';
      button.textContent = 'TEST DISPOSABLE DRIVE UPLOAD';
      button.addEventListener('click', runUploadProbe);
      panel.appendChild(button);

      const foot = document.createElement('div');
      foot.className = 'foot';
      foot.textContent = 'Creates one uniquely named JSON test file only. No overwrite, rename, or delete.';
      panel.appendChild(foot);
    }

    document.body.appendChild(panel);
    refreshStatus();
  }

  function setStatus(text, kind = '') {
    const el = document.getElementById(`${PANEL_ID}-status`);
    if (!el) return;
    el.className = `status ${kind}`.trim();
    el.textContent = text;
  }

  async function updateDriveStatus(captured = null) {
    const target = await GM_getValue(STORE_KEY, null);
    const hasTarget = captured == null ? !!target?.id : captured;
    setStatus(
      hasTarget
        ? 'TARGET CAPTURED\nYou can now open SIM and run the upload test.'
        : 'WAITING FOR TARGET\nDo one normal upload in this Drive folder.',
      hasTarget ? 'good' : 'warn'
    );
  }

  async function refreshStatus() {
    const target = await GM_getValue(STORE_KEY, null);
    if (isDrivePage()) {
      updateDriveStatus(!!target?.id);
      return;
    }
    if (isSimPage()) {
      setStatus(
        target?.id
          ? 'READY\nDrive target is captured.'
          : 'NOT READY\nOpen Drive and do one normal upload first.',
        target?.id ? 'good' : 'warn'
      );
    }
  }

  async function runUploadProbe() {
    const button = document.getElementById(`${PANEL_ID}-run`);
    if (button) button.disabled = true;

    try {
      const target = await GM_getValue(STORE_KEY, null);
      if (!target?.id) {
        setStatus('STOPPED\nNo Drive target captured yet.', 'bad');
        return;
      }

      const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
      const filename = `Drive_TM_Auto_Test_${stamp}.json`;
      const payload = JSON.stringify({
        version: 1,
        marker: 'BWU2_DRIVE_GM_AUTO_UPLOAD_OK',
        created_at: new Date().toISOString(),
        purpose: 'Disposable Drive upload bridge validation',
      }, null, 2) + '\n';

      setStatus('1/3 Creating upload slot…', 'warn');

      const createResponse = await gmRequest({
        method: 'POST',
        url: `${DRIVE_ORIGIN}/uploads/batch_create`,
        headers: { 'Content-Type': 'application/json;charset=UTF-8' },
        data: JSON.stringify({ id: target.id, paths: [filename] }),
      });

      if (createResponse.status !== 200) {
        throw new Error(`batch_create returned HTTP ${createResponse.status}`);
      }

      const created = parseJson(createResponse.responseText);
      const upload = created && created[filename];
      if (!upload || typeof upload.url !== 'string' || !upload.fields || typeof upload.fields !== 'object') {
        throw new Error('batch_create response shape was not usable');
      }

      const uploadUrl = new URL(upload.url);
      if (uploadUrl.hostname !== 'document-versions-production.s3.us-west-2.amazonaws.com') {
        throw new Error(`Unexpected upload host: ${uploadUrl.hostname}`);
      }

      const form = new FormData();
      for (const [key, value] of Object.entries(upload.fields)) {
        form.append(key, String(value));
      }
      form.append('file', new File([payload], filename, { type: 'application/json' }));

      setStatus('2/3 Uploading disposable JSON…', 'warn');

      const s3Response = await gmRequest({
        method: 'POST',
        url: upload.url,
        data: form,
        anonymous: true,
      });

      if (s3Response.status !== 204) {
        throw new Error(`S3 upload returned HTTP ${s3Response.status}`);
      }

      const key = upload.fields.key;
      if (typeof key !== 'string' || !key) {
        throw new Error('Upload key missing from batch_create response');
      }

      setStatus('3/3 Completing Drive upload…', 'warn');

      const completeResponse = await gmRequest({
        method: 'POST',
        url: `${DRIVE_ORIGIN}/uploads/complete`,
        headers: { 'Content-Type': 'application/json;charset=UTF-8' },
        data: JSON.stringify({ keys: [key] }),
      });

      if (completeResponse.status !== 200) {
        throw new Error(`uploads/complete returned HTTP ${completeResponse.status}`);
      }

      const completed = parseJson(completeResponse.responseText);
      if (!completed || !Array.isArray(completed.success) || completed.success.length < 1) {
        throw new Error('Drive did not report a successful completed upload');
      }

      setStatus(`SUCCESS\nCreated ${filename}\nTampermonkey can write a new Drive file from SIM.`, 'good');
    } catch (error) {
      setStatus(`FAILED\n${String(error?.message || error)}`, 'bad');
    } finally {
      if (button) button.disabled = false;
    }
  }

  function boot() {
    if (isDrivePage()) installDriveCapture();
    if (document.body) buildPanel();
    else document.addEventListener('DOMContentLoaded', buildPanel, { once: true });
  }

  boot();
})();
