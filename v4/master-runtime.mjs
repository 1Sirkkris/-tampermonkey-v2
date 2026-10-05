import { createFcrReader, FCR_SECTIONS } from './fcr-read.mjs';

export const MASTER_VERSION = '0.1.1';
export const MASTER_LABELS = Object.freeze([
  'Product', 'Inventory', 'Inventory History', 'Container History', 'Purchase Order Items',
  'Purchase Order', 'Receive History', 'Shipment', 'Container Details', 'Employee',
  'Carton General Information', 'Carton Contents', 'SSCC Information', 'Items in Multiple Cartons',
  'Vision Tunnel', 'Problems', 'Problem', 'Events', 'Authenticity Item'
]);
const UI = '[data-tm-v4-master]';
const PREFIX = 'tm-v4.master.section.';
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const registryKey = Symbol.for('tampermonkey.v4.master.native-transport');

// A native jQuery transport preserves the application's success/done callbacks,
// including its table initialization. Only the exact same-origin section POSTs
// are handled. There is no synthetic XMLHttpRequest or replacement native UI.
export function watchNativeAjax(page, getRuntime) {
  let registry = page[registryKey];
  if (registry) { registry.getRuntime = getRuntime; registry.watch(); return registry; }
  registry = { getRuntime, attached: new WeakSet(), restore: null };
  page[registryKey] = registry;
  const identify = options => registry.getRuntime()?.nativeRequest(options);
  function attach(jq) {
    if (typeof jq?.ajaxTransport !== 'function' || typeof jq.ajaxPrefilter !== 'function') return false;
    if (registry.attached.has(jq)) { registry.restore?.(); return true; }
    registry.attached.add(jq);
    jq.ajaxPrefilter(options => {
      const request = identify(options);
      if (request && !registry.getRuntime().automatic(request.endpoint, request.query)) {
        // An unsent lazy read must not leave native global loading active or time
        // out while the user deliberately leaves the section closed.
        options.global = false;
        options.timeout = 0;
      }
    });
    jq.ajaxTransport('+*', options => {
      const runtime = registry.getRuntime(), request = runtime?.nativeRequest(options);
      if (!request) return;
      let unsubscribe = () => {};
      return {
        send(_headers, complete) { unsubscribe = runtime.subscribe(request, complete); },
        abort() { unsubscribe(); }
      };
    });
    registry.restore?.();
    return true;
  }
  registry.watch = () => { if (!attach(page.jQuery)) {
    const descriptor = Object.getOwnPropertyDescriptor(page, 'jQuery');
    if (!descriptor || (descriptor.configurable && 'value' in descriptor)) {
      let value = descriptor?.value;
      const getter = () => value;
      const setter = next => { value = next; attach(next); };
      Object.defineProperty(page, 'jQuery', { configurable: true, enumerable: descriptor?.enumerable ?? true, get: getter, set: setter });
      registry.restore = () => {
        if (Object.getOwnPropertyDescriptor(page, 'jQuery')?.get === getter) {
          Object.defineProperty(page, 'jQuery', { configurable: true, enumerable: descriptor?.enumerable ?? true, writable: descriptor?.writable ?? true, value });
        }
        registry.restore = null;
      };
    }
  } };
  registry.watch();
  return registry;
}

export function createMasterRuntime({ window, page = window, storage, fetch, onRender = () => {}, onRefresh = () => {}, onReset = () => {}, onDispose = () => {}, onEvidence = () => {} }) {
  const document = window.document;
  let life = null, generation = null, ready = false, observers = [], scheduled = false;
  const owned = new Set(), hidden = new Map(), prefs = new Map(), saveErrors = new Set();
  let problem = '';
  const route = () => !/^#(?:fcr-tote-checker|iss-console)/.test(window.location.hash) && /\/[A-Z0-9-]{2,12}\/results(?:\/|$)/.test(window.location.pathname);
  const warehouse = window.location.pathname.split('/').filter(Boolean)[0];
  const currentQuery = () => clean(new URL(window.location.href).searchParams.get('s') || document.querySelector('#search')?.value);
  const reader = createFcrReader({ origin: window.location.origin, warehouse, fetch, DOMParser: window.DOMParser, onEvidence });
  function mark(node) { node.setAttribute('data-tm-v4-master', ''); owned.add(node); return node; }
  function button(label, action) {
    const node = mark(document.createElement('button')); node.type = 'button'; node.textContent = label;
    node.addEventListener('click', action, { signal: life.signal }); return node;
  }
  function notify(message) { problem = message; refresh(); }
  function active(gen) { return life && !life.signal.aborted && generation === gen && !gen.controller.signal.aborted && route(); }
  function preferred(endpoint) { return prefs.get(endpoint) ?? ['product', 'inventory'].includes(endpoint); }
  function automatic(endpoint, query = generation?.query) { return generation && generation.query === query ? generation.automatic.get(endpoint) : preferred(endpoint); }
  function begin(query) {
    if (generation?.query === query && !generation.controller.signal.aborted) return generation;
    if (generation) {
      generation.controller.abort();
      for (const section of generation.sections.values()) for (const waiter of [...section.waiters]) waiter.finish(0, 'abort');
      onReset();
    }
    generation = { query, controller: new window.AbortController(), sections: new Map(), automatic: new Map(FCR_SECTIONS.map(endpoint => [endpoint, preferred(endpoint)])) };
    return generation;
  }
  function state(endpoint, gen = generation) {
    if (!gen.sections.has(endpoint)) gen.sections.set(endpoint, { endpoint, visible: false, status: 'idle', result: null, error: null, promise: null, waiters: new Set(), options: {} });
    return gen.sections.get(endpoint);
  }
  function nativeRequest(options) {
    if (!life || life.signal.aborted || !route() || String(options.type || options.method || 'GET').toUpperCase() !== 'POST' || options.async === false) return null;
    let url; try { url = new URL(options.url, window.location.href); } catch { return null; }
    const match = url.pathname.match(new RegExp('^/' + warehouse + '/results/([^/]+)$'));
    if (url.origin !== window.location.origin || !match || !FCR_SECTIONS.includes(match[1])) return null;
    const fields = new URLSearchParams(typeof options.data === 'string' ? options.data : options.data || {});
    const query = clean(fields.get('s'));
    // Unsupported forms stay native; the adapter never discards extra fields.
    const allowed = match[1] === 'inventory-history' ? ['s', 'startSearchDateString', 'endSearchDateString', 'dateStringFormat'] : ['s'];
    if (!query || [...fields.keys()].some(key => !allowed.includes(key))) return null;
    if (fields.has('dateStringFormat') && fields.get('dateStringFormat') !== 'MM/dd/yyyy') return null;
    const optionsForRead = fields.has('startSearchDateString') || fields.has('endSearchDateString') ?
      { startDate: fields.get('startSearchDateString'), endDate: fields.get('endSearchDateString') } : {};
    return { endpoint: match[1], query, options: optionsForRead };
  }
  function subscribe(request, complete) {
    const gen = begin(request.query), section = state(request.endpoint, gen);
    if (JSON.stringify(section.options) !== JSON.stringify(request.options)) {
      section.controller?.abort(); section.result = null; section.status = 'idle'; section.promise = null;
      for (const waiter of [...section.waiters]) waiter.finish(0, 'abort');
    }
    section.options = request.options;
    const waiter = { finish(status, statusText, responses) {
      if (!section.waiters.delete(waiter)) return;
      try { complete(status, statusText, responses, 'Content-Type: text/html; charset=UTF-8\r\n'); }
      catch (error) { if (active(gen)) notify('Native ' + MASTER_LABELS[FCR_SECTIONS.indexOf(request.endpoint)] + ' rendering failed: ' + clean(error.message)); }
    } };
    section.waiters.add(waiter);
    if (automatic(request.endpoint) || section.visible) void load(request.endpoint, { gen });
    schedule();
    return () => {
      section.waiters.delete(waiter);
      // Aborting one native subscriber never cancels another's read.
    };
  }
  async function load(endpoint, { gen = generation, force = false, render = true } = {}) {
    if (!gen || !active(gen)) return null;
    const section = state(endpoint, gen);
    if (render) section.visible = true;
    if (section.promise) return section.promise;
    if (!force && section.result) {
      if (section.visible) {
        if (section.waiters.size) { section.status = section.result.complete ? 'ready' : 'partial'; section.error = null; }
        for (const waiter of [...section.waiters]) waiter.finish(200, 'success', { text: section.result.html });
        onRender({ endpoint, result: section.result, generation: gen, signal: gen.controller.signal, reader, runtime: api });
        schedule();
      }
      return section.result;
    }
    const controller = new window.AbortController();
    const cancel = () => controller.abort(); gen.controller.signal.addEventListener('abort', cancel, { once: true });
    section.controller = controller; section.status = 'loading'; section.error = null;
    schedule();
    const work = (async () => {
      try {
        const result = await reader.section(endpoint, gen.query, { ...section.options, signal: controller.signal, allowPartial: true });
        if (!active(gen) || controller.signal.aborted) return null;
        section.result = result; section.status = result.complete ? 'ready' : 'partial';
        if (section.visible) {
          if (section.waiters.size) for (const waiter of [...section.waiters]) waiter.finish(200, 'success', { text: result.html });
          else if (!paint(endpoint)) {
            section.status = 'error'; section.error = new Error('Native rendering callback unavailable — repeat the native search');
          }
          if (section.status !== 'error') onRender({ endpoint, result, generation: gen, signal: controller.signal, reader, runtime: api });
        }
        return result;
      } catch (error) {
        if (!active(gen) || controller.signal.aborted || error.code === 'CANCELLED') return null;
        section.error = error; section.status = 'error';
        // Keep native callbacks for the deliberate retry rather than replacing
        // the application's table rendering with a second implementation.
        return null;
      } finally {
        gen.controller.signal.removeEventListener('abort', cancel);
        if (section.controller === controller) { section.promise = null; schedule(); }
      }
    })();
    section.promise = work; return work;
  }
  function paint(endpoint) {
    // No replacement table or guessed generic DataTables initialization. The
    // deployed native renderer contract must be captured for retry after the
    // first native jqXHR has completed/been externally aborted.
    notify('Native ' + MASTER_LABELS[FCR_SECTIONS.indexOf(endpoint)] + ' rendering callback unavailable — repeat the native search');
    return false;
  }
  function schedule() {
    if (!life || life.signal.aborted || !ready || scheduled) return;
    scheduled = true; window.queueMicrotask(() => { scheduled = false; if (life && !life.signal.aborted) refresh(); });
  }
  function findNavigation() {
    const heading = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,strong,span')].find(node => clean(node.textContent).toLowerCase() === 'sections');
    for (let host = heading?.parentElement; host && host !== document.body; host = host.parentElement) {
      const texts = [...host.querySelectorAll('a,button,li,span')].filter(node => !node.closest(UI)).map(node => clean(node.textContent));
      if (MASTER_LABELS.filter(label => texts.includes(label)).length >= 8) return host;
    }
    return null;
  }
  function refresh() {
    if (!ready || !route()) return;
    for (const node of owned) if (!node.isConnected) owned.delete(node);
    const nav = findNavigation();
    let status = document.querySelector('[data-tm-v4-master-status]');
    if (!status) {
      status = mark(document.createElement('span')); status.setAttribute('data-tm-v4-master-status', ''); status.setAttribute('role', 'status');
      (nav || document.querySelector('#search')?.parentElement || document.body).append(status);
    }
    status.textContent = 'V4 FCR Master ' + MASTER_VERSION + (problem ? ' — ' + problem : !nav ? ' — Native Sections navigation unavailable' : '');
    if (!nav) return;
    for (const [index, label] of MASTER_LABELS.entries()) {
      const endpoint = FCR_SECTIONS[index];
      let toggle = nav.querySelector('[data-tm-v4-section="' + endpoint + '"]');
      if (!toggle) {
        const labels = [...nav.querySelectorAll('a,li,span,button')].filter(node => !node.closest(UI) && clean(node.textContent) === label);
        const anchor = labels.find(node => ![...node.children].some(child => clean(child.textContent) === label));
        if (!anchor) { problem = 'Native section label missing: ' + label; continue; }
        toggle = button('', event => {
          event.preventDefault(); event.stopPropagation();
          const previous = preferred(endpoint), next = !previous;
          try { storage.set(PREFIX + endpoint, next); if (storage.get(PREFIX + endpoint) !== next) throw new Error('Readback failed'); prefs.set(endpoint, next); saveErrors.delete(endpoint); }
          catch { saveErrors.add(endpoint); }
          refresh();
        });
        toggle.setAttribute('data-tm-v4-section', endpoint); anchor.insertAdjacentElement('afterend', toggle);
        anchor.addEventListener('click', () => { if (generation) void load(endpoint); }, { signal: life.signal });
      }
      const failed = saveErrors.has(endpoint);
      toggle.textContent = failed ? '!' : preferred(endpoint) ? 'A' : 'L'; toggle.setAttribute('aria-pressed', String(preferred(endpoint)));
      toggle.title = label + ': ' + (failed ? 'SAVE FAILED — selection unchanged' : preferred(endpoint) ? 'AUTO — loads every search' : 'LAZY — click section to load');
      toggle.setAttribute('aria-label', toggle.title);
      const container = document.querySelector('[data-section-type="' + endpoint + '"]');
      const section = generation?.sections.get(endpoint);
      if (!container) continue;
      if (!hidden.has(container)) hidden.set(container, container.hidden);
      container.hidden = !automatic(endpoint) && !section?.visible;
      let note = container.querySelector(':scope > [data-tm-v4-read-status]');
      if (!note && section) { note = mark(document.createElement('div')); note.setAttribute('data-tm-v4-read-status', ''); note.setAttribute('role', 'status'); container.prepend(note); }
      if (note && section) {
        note.replaceChildren();
        if (section.status === 'loading') note.textContent = 'Loading ' + label + '…';
        if (section.status === 'partial') note.textContent = section.result.warning || 'Partial ' + label;
        if (section.status === 'error' || (endpoint === 'inventory' && section.status === 'partial')) {
          const retry = button(endpoint === 'inventory' ? 'Retry Inventory' : 'Retry ' + label, () => void load(endpoint, { force: true }));
          note.append(retry, document.createTextNode(' ' + (section.error?.message || section.result.warning)));
        }
      }
    }
    onRefresh(api);
  }
  function observeNative() {
    const roots = new Set([findNavigation(), ...document.querySelectorAll('[data-section-type]')].filter(Boolean));
    const replacementRoots = new Set([...roots].map(node => node.parentElement).filter(Boolean));
    const meaningful = records => records.some(record => !record.target.closest?.(UI) && [...record.addedNodes, ...record.removedNodes].some(node => !node.matches?.(UI)));
    for (const root of roots) {
      const observer = new window.MutationObserver(records => { if (meaningful(records)) schedule(); });
      observer.observe(root, { childList: true, subtree: true }); observers.push(observer);
    }
    for (const root of replacementRoots) {
      const observer = new window.MutationObserver(records => { if (meaningful(records)) { observers.forEach(item => item.disconnect()); observers = []; observeNative(); schedule(); } });
      observer.observe(root, { childList: true }); observers.push(observer);
    }
  }
  function start() {
    if (life && !life.signal.aborted) return;
    life = new window.AbortController(); ready = false; problem = ''; prefs.clear();
    for (const endpoint of FCR_SECTIONS) {
      try { const value = storage.get(PREFIX + endpoint); if (typeof value === 'boolean') prefs.set(endpoint, value); }
      catch { problem = 'Section preferences unavailable'; }
    }
    begin(currentQuery());
    document.addEventListener('submit', event => {
      const input = event.target.querySelector?.('#search,input[name="s"]');
      if (input) { begin(clean(input.value)); schedule(); }
    }, { capture: true, signal: life.signal });
    document.addEventListener('input', event => {
      if (event.target.matches?.('#search,input[name="s"]') && !clean(event.target.value)) { begin(''); schedule(); }
    }, { signal: life.signal });
    const mount = () => { if (!life || life.signal.aborted || ready) return; ready = true; refresh(); observeNative(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true, signal: life.signal }); else mount();
  }
  function dispose() {
    if (!life || life.signal.aborted) return;
    life.abort(); generation?.controller.abort();
    onDispose();
    for (const section of generation?.sections.values() || []) for (const waiter of [...section.waiters]) waiter.finish(0, 'abort');
    observers.forEach(observer => observer.disconnect()); observers = []; scheduled = false;
    for (const node of owned) node.remove(); owned.clear();
    for (const [node, previous] of hidden) node.hidden = previous; hidden.clear();
    ready = false; generation = null;
  }
  const api = Object.freeze({ start, dispose, automatic, nativeRequest, subscribe, load, mark, notify,
    current: () => generation, active, refresh, reader, warehouse, schedule });
  return api;
}
