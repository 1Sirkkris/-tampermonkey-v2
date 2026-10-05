import { createMasterRuntime, watchNativeAjax } from './master-runtime.mjs';
import { installMeasurementCapture } from './measurement-auth.mjs';

const VERSION = '0.1.0';
const page = typeof unsafeWindow === 'object' ? unsafeWindow : window;
const storage = { get: (key, fallback) => GM_getValue(key, fallback), set: (key, value) => GM_setValue(key, value) };
const guard = Symbol.for('tampermonkey.v4.master.installer');
if (!page[guard]) {
  page[guard] = { version: VERSION };
  let stop = () => {};
  function start() {
    if (location.origin === 'https://jp.item-measurement.aft.a2z.com') {
      stop = installMeasurementCapture({ page, storage });
      return;
    }
    if (!/\/[A-Z0-9-]{2,12}\/results(?:\/|$)/.test(location.pathname) || /^#(?:fcr-tote-checker|iss-console)/.test(location.hash)) return;
    const runtime = createMasterRuntime({ window, page, storage, fetch: page.fetch.bind(page) });
    runtime.start(); watchNativeAjax(page, () => runtime);
    stop = () => runtime.dispose();
  }
  start();
  window.addEventListener('pagehide', () => stop());
  window.addEventListener('pageshow', event => { if (event.persisted) start(); });
  window.addEventListener('hashchange', () => { stop(); start(); });
  window.addEventListener('popstate', () => { stop(); start(); });
}
