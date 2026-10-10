import { createFcrReader, FCR_SECTIONS } from './fcr-read.mjs';

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
  registry = { getRuntime, attached: new WeakSet(), loaders: new WeakSet(), restorers: new Set(), renderers: new Map() };
  page[registryKey] = registry;
  const identify = options => registry.getRuntime()?.nativeRequest(options);
  function attach(jq) {
    if (typeof jq?.ajaxTransport !== 'function' || typeof jq.ajaxPrefilter !== 'function') return false;
    if (registry.attached.has(jq)) return true;
    registry.attached.add(jq);
    registry.jq = jq;
    jq.ajaxPrefilter((options, original, xhr) => {
      const request = identify(options);
      if (!request) return;
      registry.getRuntime().captureRenderer(request, jq, xhr, original);
      if (!registry.getRuntime().automatic(request.endpoint, request.query)) {
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
    registry.restore();
    return true;
  }
  function attachLoader(loader) {
    if (typeof loader?.when !== 'function') return false;
    // AUI defines its globals with Object.defineProperty, bypassing assignment
    // setters. At DOMContentLoaded its existing dependency can be obtained
    // synchronously, before the native results callback's ready gate opens.
    if (typeof loader.now === 'function') loader.now('jQuery').execute(attach);
    if (!registry.loaders.has(loader)) {
      registry.loaders.add(loader);
      // The deployed AUI jQuery is a private dependency, not a window global.
      loader.when('jQuery').execute('tampermonkey-v4-master-native', attach);
    }
    return true;
  }
  function watchProperty(key, accept) {
    if (accept(page[key])) return;
    const descriptor = Object.getOwnPropertyDescriptor(page, key);
    if (!descriptor || (descriptor.configurable && 'value' in descriptor)) {
      let value = descriptor?.value;
      const getter = () => value;
      const setter = next => { value = next; accept(next); };
      Object.defineProperty(page, key, { configurable: true, enumerable: descriptor?.enumerable ?? true, get: getter, set: setter });
      const restore = () => {
        if (Object.getOwnPropertyDescriptor(page, key)?.get === getter) {
          if (!descriptor && value === undefined) delete page[key];
          else Object.defineProperty(page, key, { configurable: true, enumerable: descriptor?.enumerable ?? true, writable: descriptor?.writable ?? true, value });
        }
        registry.restorers.delete(restore);
      };
      registry.restorers.add(restore);
    }
  }
  registry.restore = () => {
    for (const restore of [...registry.restorers]) restore();
    if (registry.domReady) page.document.removeEventListener('DOMContentLoaded', registry.domReady);
    registry.domReady = null;
  };
  registry.watch = () => {
    if (attach(page.jQuery || registry.jq)) { registry.restore(); return; }
    watchProperty('jQuery', attach);
    attachLoader(page.AmazonUIPageJS || page.P);
    if (registry.jq) { registry.restore(); return; }
    if (!registry.domReady && !registry.jq) {
      registry.domReady = () => attachLoader(page.AmazonUIPageJS || page.P);
      if (page.document.readyState === 'loading') page.document.addEventListener('DOMContentLoaded', registry.domReady, { once: true });
      else registry.domReady();
    }
  };
  registry.watch();
  return registry;
}

export function createMasterRuntime({ window, page = window, version = 'test', storage, fetch, onRender = () => {}, onRefresh = () => {}, onReset = () => {}, onDispose = () => {}, onEvidence = () => {} }) {
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
    // Native rendering functions belong to this document/placeholder. A BFCache
    // or route restart rebinds that capability to a new owner and fresh reads;
    // no previous result, jqXHR or asynchronous action is adopted.
    const templates = page[registryKey]?.renderers;
    for (const [endpoint, record] of templates || []) {
      if (record.request.query !== query || !record.node.isConnected || placeholder(endpoint) !== record.node) {
        templates.delete(endpoint); continue;
      }
      const section = state(endpoint, generation); section.options = record.request.options;
      section.renderer = bindRenderer(record, section, generation); generation.recovered = true;
    }
    return generation;
  }
  function state(endpoint, gen = generation) {
    if (!gen.sections.has(endpoint)) gen.sections.set(endpoint, { endpoint, visible: false, status: 'idle', result: null, error: null, promise: null, waiters: new Set(), options: {} });
    return gen.sections.get(endpoint);
  }
  const placeholder = endpoint => document.querySelector('.section-placeholder[data-section-type="' + endpoint + '"]') ||
    document.querySelector('[data-section-type="' + endpoint + '"]');
  const nativeStatus = endpoint => document.querySelector('#sections-list > #' + endpoint + '-status');
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
  function captureRenderer(request, jq, xhr, original) {
    const node = placeholder(request.endpoint);
    // This is the precise loader shape observed in the native capture. Other
    // callers' success/done subscribers are never retained or replayed.
    const keys = Object.keys(original || {}).sort().join(',');
    if (keys !== 'data,dataType,type,url' || original.type !== 'POST' || original.dataType !== 'html' ||
        !node?.matches('.section-placeholder') || !nativeStatus(request.endpoint) || typeof xhr.done !== 'function') return;
    const gen = begin(request.query), section = state(request.endpoint, gen), done = xhr.done;
    const signature = JSON.stringify(request.options);
    const restore = () => { if (xhr.done === capture) xhr.done = done; };
    function capture(...callbacks) {
      if (!callbacks.some(callback => typeof callback === 'function' || Array.isArray(callback))) return done.apply(this, callbacks);
      restore();
      if (callbacks.length !== 1 || typeof callbacks[0] !== 'function') return done.apply(this, callbacks);
      const callback = callbacks[0];
      const record = { request, jq, node, callback, context: original, signature };
      page[registryKey]?.renderers.set(request.endpoint, record);
      const renderer = bindRenderer(record, section, gen);
      section.renderer = renderer;
      return done.call(this, function(...args) { if (renderer.valid()) callback.apply(this, args); });
    }
    xhr.done = capture;
    // Native registration is synchronous after $.ajax returns. A later unrelated
    // subscriber must never become the renderer if that registration is absent.
    window.queueMicrotask(restore);
  }
  function bindRenderer({ request, jq, node, callback, context, signature }, section, gen) {
    const renderer = { valid: () => active(gen) && section.renderer === renderer &&
      JSON.stringify(section.options) === signature && placeholder(request.endpoint) === node && node.isConnected,
    render(html) {
      if (!renderer.valid()) throw new Error('Native section changed — repeat the native search');
      // DataTables 1.9 keeps settings beyond jQuery's .html() cleanup. Dispose
      // that instance before the native function creates its next table.
      for (const table of node.querySelectorAll('table[id]')) {
        if (jq.fn.dataTable?.fnIsDataTable?.(table)) jq(table).dataTable().fnDestroy();
      }
      const status = nativeStatus(request.endpoint);
      for (const link of [...(status?.querySelectorAll('a') || [])].reverse()) {
        if (link.getAttribute('href') === '#' + request.endpoint + '-nav') link.replaceWith(...link.childNodes);
      }
      callback.call(context, html);
    } };
    return renderer;
  }
  function subscribe(request, complete) {
    const gen = begin(request.query), section = state(request.endpoint, gen);
    if (JSON.stringify(section.options) !== JSON.stringify(request.options)) {
      section.controller?.abort(); section.result = null; section.status = 'idle'; section.promise = null;
      section.renderer = null; section.renderedResult = null;
      page[registryKey]?.renderers.delete(request.endpoint);
      for (const waiter of [...section.waiters]) waiter.finish(0, 'abort');
    }
    section.options = request.options;
    const waiter = { finish(status, statusText, responses) {
      if (!section.waiters.delete(waiter)) return;
      try { complete(status, statusText, responses, 'Content-Type: text/html; charset=UTF-8\r\n'); }
      catch (error) { if (active(gen)) {
        section.status = 'error'; section.error = error;
        notify('Native ' + MASTER_LABELS[FCR_SECTIONS.indexOf(request.endpoint)] + ' rendering failed: ' + clean(error.message));
      } }
    } };
    section.waiters.add(waiter);
    if (automatic(request.endpoint) || section.visible) void load(request.endpoint, { gen });
    schedule();
    return () => {
      if (section.waiters.delete(waiter) && !section.waiters.size && active(gen)) {
        section.nativeAborted = true; section.status = 'error';
        section.error = new Error('Native read cancelled — retry this section'); schedule();
      }
      // Aborting one native subscriber never cancels another's read.
    };
  }
  async function load(endpoint, { gen = generation, force = false, render = true } = {}) {
    if (!gen || !active(gen)) return null;
    const section = state(endpoint, gen);
    if (render) { section.visible = true; section.nativeAborted = false; }
    if (section.promise) return section.promise;
    if (!force && section.result) {
      if (section.visible && !section.nativeAborted) {
        deliver(section, section.result);
        if (section.status !== 'error') onRender({ endpoint, result: section.result, generation: gen, signal: gen.controller.signal, reader, runtime: api });
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
        if (section.visible && !section.nativeAborted) {
          deliver(section, result);
          if (section.status !== 'error') onRender({ endpoint, result, generation: gen, signal: controller.signal, reader, runtime: api });
        } else if (section.nativeAborted) {
          section.status = 'error'; section.error = new Error('Native read cancelled — retry this section');
        }
        return result;
      } catch (error) {
        if (!active(gen) || controller.signal.aborted || error.code === 'CANCELLED') return null;
        section.error = error; section.status = 'error';
        // Settle native loading once. Retry uses the identified rendering
        // function, not another completion of this failed jqXHR.
        for (const waiter of [...section.waiters]) waiter.finish(error.status || 502, error.code || 'error');
        return null;
      } finally {
        gen.controller.signal.removeEventListener('abort', cancel);
        if (section.controller === controller) { section.promise = null; schedule(); }
      }
    })();
    section.promise = work; return work;
  }
  function deliver(section, result) {
    section.status = result.complete ? 'ready' : 'partial'; section.error = null;
    if (section.waiters.size) {
      for (const waiter of [...section.waiters]) waiter.finish(200, 'success', { text: result.html });
    } else if (section.renderedResult !== result) paint(section.endpoint, section);
    if (section.status !== 'error') section.renderedResult = result;
  }
  function paint(endpoint, section) {
    try {
      if (!section.renderer) throw new Error('Native rendering callback unavailable — repeat the native search');
      section.renderer.render(section.result.html);
    } catch (error) {
      section.status = 'error'; section.error = error;
      notify('Native ' + MASTER_LABELS[FCR_SECTIONS.indexOf(endpoint)] + ': ' + clean(error.message));
    }
  }
  function schedule() {
    if (!life || life.signal.aborted || !ready || scheduled) return;
    scheduled = true; window.queueMicrotask(() => { scheduled = false; if (life && !life.signal.aborted) refresh(); });
  }
  function findNavigation() {
    const native = document.querySelector('#sections-list');
    if (native) return native;
    const heading = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,strong,span')].find(node => clean(node.textContent).toLowerCase() === 'sections');
    for (let host = heading?.parentElement; host && host !== document.body; host = host.parentElement) {
      const texts = [...host.querySelectorAll('a,button,li,span')].filter(node => !node.closest(UI)).map(node => clean(node.textContent));
      if (MASTER_LABELS.filter(label => texts.some(text => text.toLowerCase() === label.toLowerCase())).length >= 8) return host;
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
    status.textContent = 'V4 FCR Master ' + version + (problem ? ' — ' + problem : !nav ? ' — Native Sections navigation unavailable' : '');
    if (!nav) return;
    for (const [index, label] of MASTER_LABELS.entries()) {
      const endpoint = FCR_SECTIONS[index];
      let toggle = nav.querySelector('[data-tm-v4-section="' + endpoint + '"]');
      if (!toggle) {
        const labels = [...nav.querySelectorAll('a,li,span,button')].filter(node => !node.closest(UI) && clean(node.textContent).toLowerCase() === label.toLowerCase());
        const row = nativeStatus(endpoint);
        const anchor = row || labels.find(node => ![...node.children].some(child => clean(child.textContent).toLowerCase() === label.toLowerCase()));
        if (!anchor) { problem = 'Native section label missing: ' + label; continue; }
        toggle = button('', event => {
          event.preventDefault(); event.stopPropagation();
          const previous = preferred(endpoint), next = !previous;
          try { storage.set(PREFIX + endpoint, next); if (storage.get(PREFIX + endpoint) !== next) throw new Error('Readback failed'); prefs.set(endpoint, next); saveErrors.delete(endpoint); }
          catch { saveErrors.add(endpoint); }
          refresh();
        });
        toggle.setAttribute('data-tm-v4-section', endpoint);
        if (row) row.append(toggle); else anchor.insertAdjacentElement('afterend', toggle);
        anchor.addEventListener('click', event => { if (!event.target.closest(UI) && generation) void load(endpoint); }, { signal: life.signal });
      }
      const failed = saveErrors.has(endpoint);
      toggle.textContent = failed ? '!' : preferred(endpoint) ? 'A' : 'L'; toggle.setAttribute('aria-pressed', String(preferred(endpoint)));
      toggle.title = label + ': ' + (failed ? 'SAVE FAILED — selection unchanged' : preferred(endpoint) ? 'AUTO — loads every search' : 'LAZY — click section to load');
      toggle.setAttribute('aria-label', toggle.title);
      const container = placeholder(endpoint);
      const section = generation?.sections.get(endpoint);
      if (!container) continue;
      if (!hidden.has(container)) hidden.set(container, container.hidden);
      container.hidden = !automatic(endpoint) && !section?.visible;
      const native = nativeStatus(endpoint);
      if (native && section) {
        native.classList.toggle('loading', section.status === 'loading' && section.visible);
        native.classList.toggle('failure', section.status === 'error');
      }
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
    const roots = new Set([findNavigation(), ...FCR_SECTIONS.map(placeholder)].filter(Boolean));
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
    const mount = () => {
      if (!life || life.signal.aborted || ready) return;
      ready = true; refresh(); observeNative();
      if (generation?.recovered) for (const endpoint of generation.sections.keys()) if (automatic(endpoint)) void load(endpoint);
    };
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
  const api = Object.freeze({ start, dispose, automatic, nativeRequest, captureRenderer, subscribe, load, mark, notify,
    current: () => generation, active, refresh, reader, warehouse, version, schedule });
  return api;
}
