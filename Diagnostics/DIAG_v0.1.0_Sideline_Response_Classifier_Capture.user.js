// ==UserScript==
// @name         DIAG v0.1.0 Sideline Response Classifier Capture
// @namespace    BWU2
// @version      0.1.0
// @description  Temporary read-only capture of Sideline scanitem/move-items response semantics for Normal, Expiry, Hazmat and Overage classification.
// @match        https://aft-poirot-website-nrt.nrt.proxy.amazon.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';

  if (window.__bwu2SidelineResponseClassifierCapture) return;
  window.__bwu2SidelineResponseClassifierCapture = true;

  const VERSION = '0.1.0';
  const TARGETS = ['/api/scanitem', '/api/move-items'];
  const rows = [];
  const MAX = 40;
  let box;
  let pre;

  const clean = value => String(value ?? '').trim();
  const interesting = url => TARGETS.some(path => clean(url).includes(path));

  function parseBody(body) {
    if (body == null) return null;
    if (typeof body === 'string') {
      try { return JSON.parse(body); } catch { return null; }
    }
    if (body instanceof URLSearchParams) return Object.fromEntries(body.entries());
    if (body instanceof FormData) return Object.fromEntries(body.entries());
    return body && typeof body === 'object' ? body : null;
  }

  function requestSummary(url, body) {
    const parsed = parseBody(body) || {};
    if (clean(url).includes('/api/scanitem')) {
      return {
        itemBarcode: clean(parsed.itemBarcode),
        tool: clean(parsed.tool)
      };
    }

    if (clean(url).includes('/api/move-items')) {
      return {
        scannableId: clean(parsed.scannableId),
        quantity: clean(parsed.quantity),
        userEnteredExpirationDate: parsed.userEnteredExpirationDate ?? null,
        datelotDetail: summarizeDate(parsed.datelotDetail)
      };
    }

    return {};
  }

  function summarizeDate(detail) {
    if (!detail || typeof detail !== 'object') return null;
    return {
      expirationPromptType: detail.expirationPromptType ?? null,
      productExpirationType: detail.productExpirationType ?? null,
      expirableItem: detail.expirableItem ?? null,
      userExpirationDateRequired: detail.userExpirationDateRequired ?? null,
      expirationDateMissing: detail.expirationDateMissing ?? null,
      sensitiveItem: detail.sensitiveItem ?? null
    };
  }

  function problemSummary(problems) {
    if (!Array.isArray(problems)) return [];
    return problems.filter(Boolean).slice(0, 10).map(problem => ({
      type: clean(problem?.['@type']),
      description: clean(problem?.description),
      quantity: problem?.quantity ?? null
    }));
  }

  function reasonSummary(reason) {
    if (!reason || typeof reason !== 'object') return reason ?? null;
    return {
      typeTag: clean(reason?.['@type']),
      type: clean(reason?.type),
      requestDamaged: reason?.requestDamaged ?? null,
      containerDamaged: reason?.containerDamaged ?? null,
      itemDropzone: reason?.itemDropzone ?? null,
      containerDropzone: reason?.containerDropzone ?? null,
      itemPermissionLevel: reason?.itemPermissionLevel ?? null,
      containerPermissionLevel: reason?.containerPermissionLevel ?? null
    };
  }

  function responseSummary(url, body) {
    if (!body || typeof body !== 'object') return { rawType: typeof body };

    if (clean(url).includes('/api/scanitem')) {
      const records = Array.isArray(body.items) ? body.items.filter(Boolean) : [];
      const first = records[0] || null;
      const sku = first?.skuDetail || null;
      return {
        responseType: clean(body['@type']),
        success: body.success ?? null,
        itemCount: records.length,
        scannableId: clean(first?.scannableId),
        asin: clean(sku?.asin),
        fnsku: clean(sku?.fnSku),
        hazmatMetadata: sku?.hazmat ?? null,
        expirationDateNeeded: sku?.expirationDateNeeded ?? null,
        datelotDetail: summarizeDate(sku?.datelotDetail),
        dropzoneRecommendation: sku?.itemDropzoneRecommendation ? {
          dropzone: sku.itemDropzoneRecommendation.dropzone ?? null,
          permissionLevel: sku.itemDropzoneRecommendation.permissionLevel ?? null,
          hazmatMAQ: sku.itemDropzoneRecommendation.hazmatMAQ ?? null
        } : null
      };
    }

    if (clean(url).includes('/api/move-items')) {
      return {
        responseType: clean(body['@type']),
        success: body.success ?? null,
        problems: problemSummary(body.problems),
        filterResult: body.filterResult ? {
          compatible: body.filterResult.compatible ?? null,
          reason: reasonSummary(body.filterResult.reason),
          priority: body.filterResult.priority ?? null,
          filterType: clean(body.filterResult.filterType)
        } : null
      };
    }

    return {};
  }

  function parseResponseText(text) {
    try { return JSON.parse(text); } catch { return null; }
  }

  function add(entry) {
    rows.push({ at:new Date().toISOString(), ...entry });
    if (rows.length > MAX) rows.splice(0, rows.length - MAX);
    render();
  }

  function output() {
    return [
      `BWU2 SIDELINE RESPONSE CLASSIFIER CAPTURE v${VERSION}`,
      'Read-only: records only /api/scanitem and /api/move-items summaries.',
      `Captured: ${rows.length}`,
      '',
      JSON.stringify(rows, null, 2)
    ].join('\n');
  }

  function render() {
    if (!pre || !box) return;
    pre.textContent = output();
    const hazmat = rows.some(row => row?.response?.filterResult?.reason?.type === 'HAZMAT');
    box.style.borderColor = hazmat ? '#7c3aed' : rows.length ? '#2563eb' : '#6b7280';
  }

  function mount() {
    if (box || !document.body) return;

    box = document.createElement('div');
    box.style.cssText = [
      'position:fixed','top:10px','right:10px','z-index:2147483647','width:460px','max-height:46vh',
      'background:#fff','color:#111827','border:3px solid #6b7280','border-radius:8px','box-shadow:0 8px 24px #0004',
      'font:12px Arial,sans-serif','padding:8px'
    ].join(';');

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;font-weight:900';
    head.innerHTML = '<span>SIDELINE RESPONSE CAPTURE</span>';

    const buttons = document.createElement('div');
    const copy = document.createElement('button');
    copy.textContent = 'Copy';
    copy.style.cssText = 'margin-left:4px;padding:4px 8px;font-weight:800';
    copy.onclick = async () => {
      await navigator.clipboard.writeText(output());
      copy.textContent = 'Copied';
      setTimeout(() => copy.textContent = 'Copy', 900);
    };

    const clear = document.createElement('button');
    clear.textContent = 'Clear';
    clear.style.cssText = 'margin-left:4px;padding:4px 8px;font-weight:800';
    clear.onclick = () => { rows.length = 0; render(); };

    buttons.append(clear, copy);
    head.appendChild(buttons);

    pre = document.createElement('pre');
    pre.style.cssText = 'margin:0;max-height:38vh;overflow:auto;white-space:pre-wrap;word-break:break-word;background:#f8fafc;padding:7px;border-radius:5px';

    box.append(head, pre);
    document.body.appendChild(box);
    render();
  }

  const nativeFetch = window.fetch;
  window.fetch = async function(input, init = {}) {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input?.url || '';
    if (!interesting(url)) return nativeFetch.apply(this, arguments);

    const method = clean(init?.method || input?.method || 'GET').toUpperCase();
    const request = requestSummary(url, init?.body);
    const started = performance.now();

    try {
      const response = await nativeFetch.apply(this, arguments);
      let responseBody = null;
      try { responseBody = parseResponseText(await response.clone().text()); } catch {}
      add({
        transport:'fetch',
        method,
        path:new URL(url, location.href).pathname,
        status:response.status,
        ok:response.ok,
        ms:Math.round(performance.now() - started),
        request,
        response:responseSummary(url, responseBody)
      });
      return response;
    } catch (error) {
      add({
        transport:'fetch', method,
        path:new URL(url, location.href).pathname,
        ms:Math.round(performance.now() - started),
        request,
        error:clean(error?.message || error)
      });
      throw error;
    }
  };

  const XHR = window.XMLHttpRequest;
  const nativeOpen = XHR.prototype.open;
  const nativeSend = XHR.prototype.send;

  XHR.prototype.open = function(method, url) {
    this.__bwu2SidelineClassifier = interesting(url) ? { method:clean(method).toUpperCase(), url:String(url) } : null;
    return nativeOpen.apply(this, arguments);
  };

  XHR.prototype.send = function(body) {
    const meta = this.__bwu2SidelineClassifier;
    if (!meta) return nativeSend.apply(this, arguments);

    const request = requestSummary(meta.url, body);
    const started = performance.now();
    this.addEventListener('loadend', () => {
      let responseBody = null;
      try { responseBody = parseResponseText(this.responseText); } catch {}
      add({
        transport:'xhr',
        method:meta.method,
        path:new URL(meta.url, location.href).pathname,
        status:this.status,
        ok:this.status >= 200 && this.status < 300,
        ms:Math.round(performance.now() - started),
        request,
        response:responseSummary(meta.url, responseBody)
      });
    }, { once:true });

    return nativeSend.apply(this, arguments);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once:true });
  } else {
    mount();
  }
})();
