// ==UserScript==
// @name         V4 FCR Native Capture
// @namespace    https://github.com/1Sirkkris/tampermonkey-v4
// @version      0.1.0
// @description  Manual read-only capture of native FCR markup and page scripts for renderer integration.
// @match        http://fcresearch-fe.aka.amazon.com/*
// @match        https://fcresearch-fe.aka.amazon.com/*
// @match        http://qi-fcresearch-fe.corp.amazon.com/*
// @match        https://qi-fcresearch-fe.corp.amazon.com/*
// @match        http://qi-fcresearch-jp.corp.amazon.com/*
// @match        https://qi-fcresearch-jp.corp.amazon.com/*
// @match        http://qifcr.fe.aftx.amazonoperations.app/*
// @match        https://qifcr.fe.aftx.amazonoperations.app/*
// @run-at       document-idle
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/diagnostics/FCR_Native_Capture.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/diagnostics/FCR_Native_Capture.user.js
// ==/UserScript==

(() => {
  'use strict';
  const VERSION = '0.1.0';
  let running = false, controller = null, objectUrl = null, release = null;
  const redact = value => String(value)
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED JWT]')
    .replace(/(["']?(?:authorization|access[_-]?token|id[_-]?token|refresh[_-]?token|password|csrf[_-]?token|csrf|cookie)["']?\s*[:=]\s*)(["'])[^\r\n]*?\2/gi, '$1$2[REDACTED]$2');
  function safeUrl(raw) {
    const url = new URL(raw, location.href); url.username = ''; url.password = '';
    for (const key of [...url.searchParams.keys()]) if (/auth|token|csrf|secret|pass|cookie/i.test(key)) url.searchParams.set(key, '[REDACTED]');
    return url.href;
  }
  const revoke = () => { clearTimeout(release); if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null; };
  window.addEventListener('pagehide', () => { controller?.abort('pagehide'); revoke(); });
  GM_registerMenuCommand('Capture native FCR (read-only) ' + VERSION, async () => {
    if (running) return;
    running = true; controller = new AbortController(); const signal = controller.signal;
    const deadline = setTimeout(() => controller.abort('timeout'), 30000);
    try {
      const clone = document.documentElement.cloneNode(true);
      clone.querySelectorAll('[data-tm-v4-master],iframe').forEach(node => node.remove());
      clone.querySelectorAll('input').forEach(node => { if (/pass|token|secret|csrf|auth|cookie/i.test(node.name + ' ' + node.id)) node.setAttribute('value', '[REDACTED]'); });
      const scripts = [...document.scripts].slice(0, 80), records = new Array(scripts.length);
      const evidence = { diagnostic: 'FCR native renderer capture', version: VERSION, capturedAt: new Date().toISOString(),
        page: safeUrl(location.href), html: redact(clone.outerHTML), scripts: records,
        limits: ['No cookies, request headers or browser storage are collected.', 'Inline and GET-loaded page scripts only; missing/CORS-blocked assets are explicit.'] };
      let next = 0, bytes = evidence.html.length;
      async function worker() {
        while (!signal.aborted && next < scripts.length) {
          const index = next++, script = scripts[index];
          const record = { index, type: script.type || 'text/javascript', url: script.src ? safeUrl(script.src) : null, source: '' }; records[index] = record;
          try {
            let source = script.textContent;
            if (script.src) {
              const url = new URL(script.src); if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error('Unsupported script URL');
              const response = await fetch(url.href, { method: 'GET', credentials: 'same-origin', signal });
              if (!response.ok || (response.url && new URL(response.url).origin !== url.origin)) throw new Error('Asset HTTP/auth redirect');
              const mime = response.headers.get('Content-Type') || '';
              if (/text\/html/i.test(mime)) throw new Error('Asset returned HTML instead of source');
              source = await response.text();
            }
            if (source.length > 4000000 || bytes + source.length > 16000000) throw new Error('Capture source limit reached');
            bytes += source.length; record.source = redact(source);
          } catch (error) { record.error = String(error.message || error); }
        }
      }
      await Promise.all([worker(), worker()]);
      if (signal.aborted) throw new Error('Capture cancelled or timed out — no file downloaded');
      revoke(); objectUrl = URL.createObjectURL(new Blob([JSON.stringify(evidence, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = objectUrl; link.download = 'FCR_native_capture_' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
      document.body.append(link); link.click(); link.remove(); release = setTimeout(revoke, 1000);
    } catch (error) { if (signal.reason !== 'pagehide') alert('FCR capture failed: ' + String(error.message || error)); }
    finally { clearTimeout(deadline); running = false; controller = null; }
  });
})();
