import { createMasterRuntime, watchNativeAjax } from './master-runtime.mjs';
import { installMeasurementCapture } from './measurement-auth.mjs';
import { createMeasurementAuth } from './measurement-auth.mjs';
import { createFcrEnrichment, createGmJsonReader } from './fcr-enrichment.mjs';
import { createMasterFeatures } from './master-features.mjs';
import { createMasterActions } from './master-actions.mjs';

const VERSION = '0.1.3';
const page = typeof unsafeWindow === 'object' ? unsafeWindow : window;
const storage = { get: (key, fallback) => GM_getValue(key, fallback), set: (key, value) => GM_setValue(key, value),
  listen: (key, callback) => GM_addValueChangeListener(key, callback), remove: id => GM_removeValueChangeListener(id) };
const evidence = value => {
  try { window.dispatchEvent(new window.CustomEvent('tampermonkey-v4:evidence', { detail: JSON.stringify(value) })); } catch {}
};
const uuid = () => typeof window.crypto.randomUUID === 'function' ? window.crypto.randomUUID() :
  [...window.crypto.getRandomValues(new Uint32Array(4))].map(value => value.toString(16).padStart(8, '0')).join('-');
const guard = Symbol.for('tampermonkey.v4.master.installer');
if (!page[guard]) {
  page[guard] = { version: VERSION };
  let stop = () => {};
  function start() {
    if (location.origin === 'https://jp.item-measurement.aft.a2z.com') {
      stop = installMeasurementCapture({ page, storage });
      evidence({ type: 'script.start', script: 'FCR MASTER', version: VERSION, intent: 'read', data: { context: 'measurement-auth' } });
      return;
    }
    if (!/\/[A-Z0-9-]{2,12}\/results(?:\/|$)/.test(location.pathname) || /^#(?:fcr-tote-checker|iss-console)/.test(location.hash)) return;
    let features, actions;
    const runtime = createMasterRuntime({ window, page, storage, fetch: page.fetch.bind(page), onEvidence: evidence,
      onRefresh: () => { features?.refresh(); actions?.refresh(); }, onReset: () => { features?.reset(); actions?.reset(); }, onDispose: () => { features?.dispose(); actions?.dispose(); } });
    const auth = createMeasurementAuth({ window, storage, onEvidence: evidence });
    const enrichment = createFcrEnrichment({ warehouse: runtime.warehouse, readJson: createGmJsonReader(GM_xmlhttpRequest),
      getMeasurementAuth: auth.acquire, onEvidence: evidence,
      uuid,
      historyFallback: async (code, { signal }) => {
        const end = new Date(), start = new Date(end.getTime() - 30 * 86400000);
        const result = await runtime.reader.history(code, { signal, startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10), allowPartial: true });
        const doc = new window.DOMParser().parseFromString(result.html, 'text/html');
        const rows = [...doc.querySelectorAll('#table-inventory-history tbody tr')].filter(row => !row.querySelector('.dataTables_empty'));
        return { madcat: rows.some(row => /\bMADCAT\b/i.test(row.textContent)), complete: result.complete, rows: rows.length };
      }
    });
    features = createMasterFeatures({ window, page, runtime, enrichment, auth, storage, onEvidence: evidence });
    actions = createMasterActions({ window, runtime, fetch: page.fetch.bind(page), onEvidence: evidence, uuid });
    runtime.start(); const bridge = watchNativeAjax(page, () => runtime);
    evidence({ type: 'script.start', script: 'FCR MASTER', version: VERSION, intent: 'read', data: { context: 'native-fcr' } });
    stop = () => { runtime.dispose(); bridge.restore?.(); };
  }
  start();
  window.addEventListener('pagehide', () => stop());
  window.addEventListener('pageshow', event => { if (event.persisted) start(); });
  const context = () => location.origin + location.pathname + location.search +
    (location.hash.match(/^#(?:fcr-tote-checker|iss-console)/)?.[0] || '');
  let currentContext = context();
  const navigate = () => {
    const next = context(); if (next === currentContext) return;
    currentContext = next; stop(); start();
  };
  window.addEventListener('hashchange', navigate);
  window.addEventListener('popstate', navigate);
}
