import { captureRiver, RIVER_KEY } from './river-capture.mjs';
import { clean, upper } from './ui-tools.mjs';
export function createRiverCapture({ window, reader, setValue, open, onEvidence = () => {}, version, warehouse }) {
  const d = window.document, events = new window.AbortController(), style = d.createElement('style');
  style.dataset.tmV4Style = 'RIVR';
  style.textContent = '.tm-v4-river-capture{display:inline-flex;align-items:center;margin-left:7px;padding:2px 7px;border:1px solid #765900;border-radius:12px;background:#fff3b0;color:#111;font:800 11px Arial;cursor:pointer}.tm-v4-river-capture[data-ready=true]{background:#dff6ff;border-color:#005a78}';
  d.head.append(style);
  let controller = null, payload = null, current = '', disposed = false, button = null, label = 'RIVER CAPTURE…', ready = false;
  const query = () => clean(new window.URLSearchParams(window.location.search).get('s') || d.getElementById('search')?.value);
  function paint(text, isReady = false) {
    label = text; ready = isReady;
    if (!button) return;
    if (button.textContent !== text) button.textContent = text;
    button.dataset.ready = String(ready);
    button.title = payload?.warning || 'Exact FCR product + latest native PO line capture';
  }
  async function capture() {
    const search = query();
    if (!search || search === current) return;
    controller?.abort(); payload = null; current = search;
    if (!/^[A-Za-z0-9]{10}$/.test(search)) { paint('RIVER • exact item required'); return; }
    controller = new window.AbortController(); const signal = controller.signal;
    paint('RIVER CAPTURE…');
    try {
      const data = await captureRiver({ window, reader, query: search, warehouse, signal, version });
      if (disposed || signal.aborted || search !== query()) return;
      payload = data; setValue(RIVER_KEY, data); paint('RIVER READY ✓', true);
      onEvidence({ type: 'river.capture', intent: 'read', data: { quantityAvailable: data.inventoryQuantity !== null, quantityMode: data.quantityMode } });
    } catch (error) { if (!disposed && !signal.aborted) paint('RIVER • ' + error.message); }
  }
  function launch() {
    if (disposed) return;
    if (payload && upper(query()) === upper(payload.sourceSearch)) { setValue(RIVER_KEY, payload); open(payload.riverUrl); }
    else { current = ''; void capture(); paint('RIVER capture pending — click when ready'); }
  }
  function handoff(event) {
    let data; try { data = JSON.parse(event.detail); } catch { return; }
    if (data.warehouse !== warehouse || upper(data.query) !== upper(query())) return;
    event.preventDefault(); launch();
  }
  function reconcile() {
    if (disposed) return;
    const product = d.querySelector('[data-section-type=product]'), target = product?.querySelector('[data-tm-v4-badge=hazmat]') || product?.querySelector('table') || d.getElementById('table-product');
    if (!target) { button?.remove(); return; }
    if (!button) {
      button = d.createElement('button'); button.type = 'button'; button.className = 'tm-v4-river-capture'; button.dataset.tmV4Script = 'RIVR';
      button.addEventListener('click', launch, { signal: events.signal });
    }
    if (target.nextElementSibling !== button) target.after(button);
    paint(label, ready); void capture();
  }
  const observer = new window.MutationObserver(records => {
    if (records.every(record => button?.contains(record.target))) return;
    reconcile();
  });
  observer.observe(d.querySelector('#results-content') || d.body, { childList: true, subtree: true });
  d.addEventListener('tampermonkey-v4:river-handoff', handoff, { signal: events.signal });
  reconcile();
  return { capture, dispose() { disposed = true; controller?.abort(); observer.disconnect(); events.abort(); button?.remove(); style.remove(); } };
}
