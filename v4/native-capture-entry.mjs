import { registerWatermark } from './watermark.mjs';
import { installRouteLifecycle } from './ui-tools.mjs';
import { createCaptureRedactor } from './native-capture-redact.mjs';
import { createNativeContractTrace } from './native-contract-trace.mjs';

const VERSION = '0.1.3';
const guard = Symbol.for('tampermonkey.v4.native-capture');

function scope(location) {
  if (/^(?:fcresearch-fe\.aka\.amazon\.com|qi-fcresearch-(?:fe|jp)\.corp\.amazon\.com|qifcr\.fe\.aftx\.amazonoperations\.app)$/.test(location.hostname)) return 'FCR';
  if (/^aft-qt-[^.]+(?:\.[^.]+)*\.corp\.amazon\.com$/.test(location.hostname) && /^\/app\/(?:edititems|moveitems|fcskuflip)(?:\/|$)/.test(location.pathname)) return 'AFT';
  if (/^aft-moveapp-[^.]+(?:\.nrt)?\.proxy\.amazon\.com$/.test(location.hostname) && /^\/move-container(?:\/|$)/.test(location.pathname)) return 'MoveContainer';
  return null;
}


if (!window[guard]) {
  window[guard] = { version: VERSION };
  let running = false, controller = null, objectUrl = null, releaseTimer = null, trace = null;
  const pageWindow = typeof unsafeWindow === 'object' ? unsafeWindow : window;
  const revoke = () => { clearTimeout(releaseTimer); if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null; };
  const cancel = reason => { controller?.abort(reason); trace?.dispose(); trace = null; revoke(); };
  installRouteLifecycle(window, () => {
    if (!scope(location)) return;
    const releaseFooter = registerWatermark(window, 'FCAP', VERSION);
    return () => { cancel('navigation'); releaseFooter(); };
  }, () => location.hostname + location.pathname + location.search);

  GM_registerMenuCommand('Capture native contract (read-only) ' + VERSION, async () => {
    if (running) return;
    const workflow = scope(location);
    if (!workflow) { alert('Native capture is unavailable on this route'); return; }
    running = true; controller = new AbortController(); const signal = controller.signal;
    const context = location.origin + location.pathname + location.search;
    const deadline = setTimeout(() => controller.abort('timeout'), 30000);
    try {
      const redactor = createCaptureRedactor(window), redact = redactor.text, page = redactor.url(location.href);
      const clone = document.documentElement.cloneNode(true);
      clone.querySelectorAll('[data-tm-v4-master],[data-tm-v4-script],[data-tm-v4-style],iframe').forEach(node => node.remove());
      redactor.scrubDocument(clone);
      const html = redact(clone.outerHTML);
      if (html.length > 16000000) throw new Error('Capture document limit reached');
      const scripts = [...document.scripts].filter(node => !node.closest('[data-tm-v4-script],[data-tm-v4-master]')).slice(0, 80);
      const records = new Array(scripts.length);
      const evidence = {
        diagnostic: workflow + ' native contract capture', workflow, version: VERSION,
        capturedAt: new Date().toISOString(), page, html, scripts: records,
        limits: [
          'Manual page/source snapshot only; not operation or authentication proof. No native workflow action is invoked.',
          'No cookies, request headers or browser storage are collected. Page script assets use GET only.',
          'Missing/CORS-blocked assets are explicit; no API endpoint capture or automatic operation replay.',
          'Container scans are pseudonymized consistently within this file; mappings are not exported. Review remaining text before sharing.'
        ]
      };
      let next = 0, bytes = html.length;
      async function worker() {
        while (!signal.aborted && next < scripts.length) {
          const index = next++, script = scripts[index];
          const record = { index, type: script.type || 'text/javascript', url: script.src ? redactor.url(script.src) : null, source: '' };
          records[index] = record;
          try {
            let source = script.textContent;
            if (script.src) {
              const url = new URL(script.src);
              if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error('Unsupported script URL');
              const response = await fetch(url.href, { method: 'GET', credentials: 'same-origin', signal });
              if (!response.ok || response.redirected || (response.url && new URL(response.url).origin !== url.origin)) throw new Error('Asset HTTP/auth redirect');
              if (/text\/html/i.test(response.headers.get('Content-Type') || '')) throw new Error('Asset returned HTML instead of source');
              source = await response.text();
            }
            if (source.length > 4000000 || bytes + source.length > 16000000) throw new Error('Capture source limit reached');
            bytes += source.length; record.source = redact(source);
          } catch (error) { record.error = redact(String(error.message || error)); }
        }
      }
      await Promise.all([worker(), worker()]);
      if (signal.aborted || context !== location.origin + location.pathname + location.search) throw new Error('Capture cancelled or timed out — no file downloaded');
      revoke(); objectUrl = URL.createObjectURL(new Blob([JSON.stringify(evidence, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = objectUrl;
      link.download = workflow + '_native_capture_' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
      document.body.append(link); link.click(); link.remove(); releaseTimer = setTimeout(revoke, 1000);
    } catch (error) {
      if (signal.reason !== 'navigation') alert('Native capture failed: ' + String(error.message || error));
    } finally { clearTimeout(deadline); running = false; controller = null; }
  });

  GM_registerMenuCommand('Start passive native response trace ' + VERSION, () => {
    const workflow = scope(location);
    if (!workflow) { alert('Native trace is unavailable on this route'); return; }
    if (trace?.active) { alert('A native trace is already active; use Stop and export'); return; }
    trace?.dispose(); trace = null;
    try {
      trace = createNativeContractTrace({ window, page: pageWindow, workflow, version: VERSION });
      alert('Passive native trace started for up to 3 minutes. No native action is initiated. Use Stop and export before navigation. Live operational actions still require an explicitly approved test case.');
    } catch (error) { alert('Native trace failed: ' + String(error.message || error)); }
  });
  GM_registerMenuCommand('Stop and export native response trace ' + VERSION, () => {
    if (!trace) { alert('No native trace available on this route'); return; }
    const evidence = trace.stop();
    revoke(); objectUrl = URL.createObjectURL(new Blob([JSON.stringify(evidence, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = objectUrl;
    link.download = evidence.workflow + '_native_trace_' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    document.body.append(link); link.click(); link.remove(); releaseTimer = setTimeout(revoke, 1000);
    trace.dispose(); trace = null;
  });

}
