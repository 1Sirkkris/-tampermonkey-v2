import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const source = readFileSync(new URL('../OBS.user.js', import.meta.url), 'utf8');
const fcr = 'https://fcresearch-fe.aka.amazon.com/results?s=tsX111';
const bus = 'tampermonkey-v4:evidence';
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

class Storage {
  values = new Map(); listeners = new Map(); sequence = 0; reads = [];
  beforeDelete = null;
  failWrites = false; failMeta = false; failLists = false; failNotifications = false; failMetaReads = false;
  get(key, fallback) {
    this.reads.push(key);
    if (this.failMetaReads && key === 'tm-v4.obs.session') throw new Error('metadata read unavailable');
    return this.values.has(key) ? this.values.get(key) : fallback;
  }
  set(key, value, page) {
    if (this.failWrites || (this.failMeta && key === 'tm-v4.obs.session')) throw new Error('write unavailable');
    const old = this.values.get(key); this.values.set(key, value);
    for (const listener of this.listeners.values()) {
      if (listener.key === key) queueMicrotask(() => {
        if (this.listeners.has(listener.id)) listener.callback(key, old, value, listener.page !== page);
      });
    }
  }
  list() { if (this.failLists) throw new Error('list unavailable'); return [...this.values.keys()]; }
  listen(key, callback, page) {
    if (this.failNotifications) throw new Error('notifications unavailable');
    const id = ++this.sequence; this.listeners.set(id, { id, key, callback, page }); return id;
  }
}

function clock(window) {
  let now = 1000, sequence = 0, intervalCalls = 0;
  const tasks = new Map();
  window.setTimeout = (fn, delay = 0) => { const id = ++sequence; tasks.set(id, { fn, at: now + delay }); return id; };
  window.clearTimeout = id => tasks.delete(id);
  window.setInterval = () => { intervalCalls++; throw new Error('Unexpected recurring timer'); };
  window.Date.now = () => 1791200000000 + now;
  Object.defineProperty(window.performance, 'now', { value: () => now });
  return {
    get timers() { return tasks.size; }, get intervals() { return intervalCalls; },
    tick(ms) {
      const target = now + ms; let count = 0;
      for (;;) {
        const next = [...tasks].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > target) break;
        assert(++count < 10000, 'Timer loop');
        now = next[1].at; tasks.delete(next[0]); next[1].fn();
      }
      now = target;
    }
  };
}

function fixture({ store = new Storage(), url = fcr, html, fetch, fat = false, randomUUID = true } = {}) {
  if (fat) store.values.set('tm-v4.obs.session', JSON.stringify({ id: 'fixture-fat', startedAt: 1791200000000, mode: 'fat' }));
  const console = new VirtualConsole(), warnings = [], downloads = [];
  console.on('jsdomError', error => warnings.push(error.message));
  const dom = new JSDOM(html ?? '<!doctype html><html><head></head><body><header><div class="a-row"><span class="warehouse-id">BWU2</span><input type="search"></div></header></body></html>', {
    url, runScripts: 'outside-only', virtualConsole: console
  });
  const window = dom.window, time = clock(window);
  if (!randomUUID) Object.defineProperty(window.crypto, 'randomUUID', { value: undefined });
  let failDownload = false, fetchCalls = 0;
  const blobs = new Map();
  window.Blob = Blob; window.TextDecoder = TextDecoder;
  window.URL.createObjectURL = blob => { const url = 'blob:test-' + blobs.size; blobs.set(url, blob); return url; };
  window.URL.revokeObjectURL = url => blobs.delete(url);
  window.HTMLAnchorElement.prototype.click = function () {
    if (failDownload) throw new Error('download blocked');
    downloads.push({ blob: blobs.get(this.href), filename: this.download });
  };
  class NativeXhr extends window.EventTarget {
    status = 200; responseURL = ''; responseText = '{"success":true}'; responseType = '';
    open(method, url) { this.method = method; this.url = url; return 'open-result'; }
    send(body) {
      this.body = body;
      if (this.fail) throw this.fail;
      this.responseURL = new URL(this.url, window.location.href).href;
      this.dispatchEvent(new window.Event('loadend'));
      return 'send-result';
    }
  }
  window.XMLHttpRequest = NativeXhr;
  const originalOpen = NativeXhr.prototype.open, originalSend = NativeXhr.prototype.send;
  const originalFetch = function (...args) { fetchCalls++; return fetch ? fetch.apply(this, args) : Promise.resolve(new Response('{}', { status: 200 })); };
  window.fetch = originalFetch;
  window.unsafeWindow = window;
  window.GM_getValue = (key, fallback) => store.get(key, fallback);
  window.GM_setValue = (key, value) => store.set(key, value, window);
  window.GM_deleteValue = key => { store.beforeDelete?.(key); return store.values.delete(key); };
  window.GM_listValues = () => store.list();
  window.GM_addValueChangeListener = (key, fn) => store.listen(key, fn, window);
  window.GM_removeValueChangeListener = id => store.listeners.delete(id);
  window.eval(source);
  return {
    dom, window, time, store, downloads, warnings, originalFetch, originalOpen, originalSend,
    get fetchCalls() { return fetchCalls; }, get blobs() { return blobs.size; },
    get ui() { return window.document.querySelector('[data-tm-v4-script="OBS"]'); },
    emit(detail) { window.dispatchEvent(new window.CustomEvent(bus, { detail: JSON.stringify(detail) })); },
    operation(id, phase, data = {}, eventId) {
      this.emit({ eventId, type: 'operation', script: 'SIDELINE', version: '4.0.1', intent: 'mutation', operationId: id, phase, data });
    },
    click(action) { assert(this.ui); this.ui.querySelector('[data-action="' + action + '"]').click(); },
    async export() {
      this.click('export'); await settle();
      assert(downloads.length, 'No export');
      const text = await downloads.at(-1).blob.text();
      return { text, events: text.split('\nEVENTS\n')[1].split('\n').filter(Boolean).map(line => JSON.parse(line)) };
    },
    downloadFailure(value) { failDownload = value; },
    hide() { window.dispatchEvent(new window.PageTransitionEvent('pagehide', { persisted: true })); },
    restore() { window.dispatchEvent(new window.PageTransitionEvent('pageshow', { persisted: true })); },
    dispose() { this.hide(); dom.window.close(); }
  };
}

test('installs alone with the familiar FCR header controls and explicit build identity', async t => {
  const app = fixture(); t.after(() => app.dispose());
  assert.equal(app.ui.parentElement.querySelector('.warehouse-id').textContent, 'BWU2');
  assert.deepEqual([...app.ui.querySelectorAll('button')].map(x => x.textContent), ['OBS 1/6000', 'FAT OFF', 'Clear']);
  assert.match(app.ui.textContent, /V4 0\.1\.1/);
  assert.equal(app.ui.dataset.tmV4Version, '0.1.1');
  assert.equal(app.window.BWU2Fleet, undefined);
  assert.equal(app.fetchCalls, 0);
  app.time.tick(2000); await settle();
  assert.equal(app.time.timers, 0);
  const before = [...app.store.values];
  app.time.tick(3600000); await settle();
  assert.deepEqual([...app.store.values], before);
  assert.equal(app.time.intervals, 0);
  assert.equal(app.fetchCalls, 0);
});

test('collects on native tool pages without moving OBS controls there or into ISS', t => {
  for (const url of ['https://aft-poirot-website-nrt.nrt.proxy.amazon.com/', fcr + '#iss-console']) {
    const app = fixture({ url }); t.after(() => app.dispose());
    assert.equal(app.ui, null);
    app.operation('native-only', 'SUBMITTED'); app.time.tick(300);
    assert([...app.store.values.values()].some(x => typeof x === 'string' && x.includes('native-only')));
  }
});

test('one mutation phase survives cross-document duplicates and GM-only owner evidence reaches export', async t => {
  const store = new Storage(), app = fixture({ store }), worker = fixture({ store, url: 'https://aft-poirot-website-nrt.nrt.proxy.amazon.com/' });
  t.after(() => { app.dispose(); worker.dispose(); });
  for (const phase of ['SUBMITTED', 'CONFIRMED']) {
    app.operation('move-1', phase, { status: 200 }, 'parent-' + phase);
    worker.operation('move-1', phase, { status: 200 }, 'worker-' + phase);
  }
  app.time.tick(300); worker.time.tick(300); await settle();
  const transcript = await app.export();
  assert.deepEqual(transcript.events.filter(x => x.operationId === 'move-1').map(x => x.phase).sort(), ['CONFIRMED', 'SUBMITTED']);
  assert(transcript.events.filter(x => x.type === 'operation').every(x => x.evidenceSource === 'workflow-owner'));
  assert.equal(app.fetchCalls + worker.fetchCalls, 0);
  assert.match(transcript.text, /Native network is observation only/);
});

test('read-only POST and native HTTP success never assert mutation phases; fetch result/error identity is preserved', async t => {
  const response = new Response('{"success":true}', { status: 200 });
  const failure = new Error('token=SECRET https://example.test/status?password=HIDDEN');
  const app = fixture({ fat: true, fetch: url => url === '/bad' ? Promise.reject(failure) : Promise.resolve(response) });
  t.after(() => app.dispose());
  assert.equal(await app.window.fetch('/status', { method: 'POST', body: '{"source":"tsX111","token":"SECRET"}' }), response);
  await assert.rejects(app.window.fetch('/bad'), error => error === failure);
  const transcript = await app.export();
  const network = transcript.events.filter(x => x.type.startsWith('network.'));
  assert(network.some(x => x.data.method === 'POST' && x.data.url.endsWith('/status')));
  assert(network.some(x => x.type === 'network.error'));
  assert(network.every(x => !x.phase && !x.operationId));
  assert(!transcript.text.includes('SECRET')); assert(!transcript.text.includes('HIDDEN'));
});

test('XHR preserves return values, repeated calls and exact thrown errors without claiming movement', async t => {
  const app = fixture({ fat: true }); t.after(() => app.dispose());
  const xhr = new app.window.XMLHttpRequest();
  assert.equal(xhr.open('POST', '/status'), 'open-result');
  assert.equal(xhr.send('{"barcode":"ITEM1"}'), 'send-result');
  xhr.status = 500; xhr.open('POST', '/rejected'); xhr.send();
  const failure = new Error('native failure'); xhr.fail = failure; xhr.open('POST', '/throw');
  assert.throws(() => xhr.send('body'), error => error === failure);
  const transcript = await app.export();
  assert.equal(transcript.events.filter(x => x.type === 'network.response').length, 2);
  assert.equal(transcript.events.filter(x => x.type === 'network.error').length, 1);
  assert(!transcript.events.some(x => x.phase));
});

test('persistence failure is visible and leaves evidence available for a successful retry/export', async t => {
  const app = fixture(); t.after(() => app.dispose());
  app.operation('retained-1', 'UNKNOWN'); app.store.failWrites = true;
  app.time.tick(300); await settle();
  assert.equal(app.ui.querySelector('button').textContent, 'OBS STORAGE ERROR');
  app.click('export'); assert.equal(app.downloads.length, 0);
  app.store.failWrites = false;
  const transcript = await app.export();
  assert.equal(transcript.events.find(x => x.operationId === 'retained-1').phase, 'UNKNOWN');
});

test('Clear in another page discards a pending old buffer without reviving old evidence', async t => {
  const store = new Storage(), app = fixture({ store }), worker = fixture({ store });
  t.after(() => { app.dispose(); worker.dispose(); });
  worker.operation('old-pending', 'SUBMITTED');
  app.click('clear');
  worker.time.tick(1000); await settle();
  worker.operation('new-session', 'SUBMITTED'); worker.time.tick(300); await settle();
  const transcript = await app.export();
  assert(!transcript.events.some(x => x.operationId === 'old-pending'));
  assert(transcript.events.some(x => x.operationId === 'new-session'));
});

test('failed Clear or browser download does not erase the session', async t => {
  const app = fixture(); t.after(() => app.dispose());
  app.operation('keep-this', 'REJECTED');
  app.store.failMeta = true; app.click('clear');
  app.store.failMeta = false; app.downloadFailure(true); app.click('export');
  assert.equal(app.downloads.length, 0);
  assert.equal(app.ui.querySelector('button').textContent, 'OBS STORAGE ERROR');
  assert.match(app.ui.querySelector('button').title, /download could not be initiated/);
  app.downloadFailure(false);
  const transcript = await app.export();
  assert(transcript.events.some(x => x.operationId === 'keep-this'));
});

test('redacts credentials/raw payloads and ignores read messages carrying mutation phases', async t => {
  const app = fixture(); t.after(() => app.dispose());
  app.emit({ type: 'error.detail', script: 'AFT', version: '4.0.1', data: {
    authorization: 'LEAK-A', token: 'LEAK-B', requestBody: 'LEAK-C', employee: 'operatorname',
    nested: { password: 'LEAK-D' }, message: 'Bearer LEAK-E https://example.test/path?token=LEAK-F'
  } });
  app.emit({ type: 'operation', script: 'FCR', version: '4.0.1', intent: 'read', operationId: 'invalid-read', phase: 'CONFIRMED' });
  const transcript = await app.export();
  assert(!/LEAK-|operatorname/.test(transcript.text));
  assert(!transcript.events.some(x => x.operationId === 'invalid-read'));
});

test('header replacement keeps one control; pagehide/BFCache restore clean hooks, listeners and timers', async t => {
  const app = fixture(); t.after(() => app.dispose());
  const header = app.window.document.querySelector('header');
  header.innerHTML = '<div class="a-row"><span class="warehouse-id">BWU2</span><input type="search"></div>';
  await settle();
  assert.equal(app.window.document.querySelectorAll('[data-tm-v4-script="OBS"]').length, 1);
  app.operation('before-cache', 'SUBMITTED'); app.hide(); await settle();
  assert.equal(app.window.fetch, app.originalFetch);
  assert.equal(app.window.XMLHttpRequest.prototype.open, app.originalOpen);
  assert.equal(app.window.XMLHttpRequest.prototype.send, app.originalSend);
  assert.equal(app.time.timers, 0); assert.equal(app.store.listeners.size, 0); assert.equal(app.ui, null);
  app.restore(); app.window.eval(source); await settle();
  assert.equal(app.store.listeners.size, 2);
  assert.equal(app.window.document.querySelectorAll('[data-tm-v4-script="OBS"]').length, 1);
  app.operation('after-cache', 'CONFIRMED');
  const transcript = await app.export();
  assert.equal(transcript.events.filter(x => x.operationId === 'before-cache').length, 1);
  assert.equal(transcript.events.filter(x => x.operationId === 'after-cache').length, 1);
});

test('normal/FAT controls use the proven capacities and mode reset/reload behaviour', async t => {
  const app = fixture(); t.after(() => app.dispose());
  for (let i = 0; i < 6050; i++) app.emit({ type: 'test.event', script: 'FCR', version: '4.0.1', eventId: 'e-' + i });
  app.time.tick(300); await settle();
  assert.equal(app.ui.querySelector('button').textContent, 'OBS 6000/6000');
  assert.equal(app.ui.dataset.level, 'full');
  assert.equal((await app.export()).events.length, 6000);
  app.click('fat'); await settle();
  assert.match(app.ui.textContent, /FAT ON/); assert.match(app.ui.textContent, /\/50000/);
  assert(app.warnings.some(x => x.includes('navigation')), 'The V2-compatible reload must be initiated');
  for (let i = 0; i < 6100; i++) app.emit({ type: 'test.event', script: 'FCR', version: '4.0.1', eventId: 'fat-' + i });
  assert((await app.export()).events.length > 6000);
});

test('normal mode summarizes successful native reads without background polling or POST-as-mutation', async t => {
  const app = fixture(); t.after(() => app.dispose());
  await app.window.fetch('/status', { method: 'POST' });
  await app.window.fetch('/status', { method: 'POST' });
  app.time.tick(1000); await settle();
  const transcript = await app.export();
  const summary = transcript.events.find(x => x.type === 'network.summary');
  assert.equal(summary.data.endpoints[0].count, 2);
  assert(!transcript.events.some(x => x.phase));
  app.time.tick(5000); await settle();
  assert.equal(app.time.timers, 0); assert.equal(app.fetchCalls, 2);
});

test('missing operation identity or required protocol strings cannot create a submitted/confirmed event', async t => {
  const app = fixture(); t.after(() => app.dispose());
  app.emit({ type: 'operation', script: 'AFT', version: '4.0.1', intent: 'mutation', phase: 'SUBMITTED' });
  app.emit({ type: 'operation', script: 'AFT', intent: 'mutation', operationId: 'bad-version', phase: 'CONFIRMED' });
  app.emit({ script: 'AFT', version: '4.0.1' });
  app.emit({});
  const transcript = await app.export();
  assert(transcript.events.every(event => event.type && event.script && event.version));
  assert(!transcript.events.some(event => event.type === 'operation'));
});

test('failed FAT reset retains the old mode and all existing evidence', async t => {
  const app = fixture(); t.after(() => app.dispose());
  app.operation('mode-reset-held', 'UNKNOWN');
  app.store.failMeta = true; app.click('fat'); await settle();
  assert.match(app.ui.textContent, /FAT OFF/);
  assert(!app.warnings.some(x => x.includes('navigation')));
  app.store.failMeta = false;
  const transcript = await app.export();
  assert.match(transcript.text, /Mode: NORMAL/);
  assert(transcript.events.some(event => event.operationId === 'mode-reset-held'));
});

test('an unrelated successful flush cannot hide unavailable cross-page storage notifications', async t => {
  const store = new Storage(); store.failNotifications = true;
  const app = fixture({ store }); t.after(() => app.dispose());
  assert.equal(app.ui.querySelector('button').textContent, 'OBS STORAGE ERROR');
  app.operation('notification-failed', 'SUBMITTED'); app.time.tick(300); await settle();
  assert.equal(app.ui.querySelector('button').textContent, 'OBS STORAGE ERROR');
  assert.match(app.ui.querySelector('button').title, /notifications/);
  const transcript = await app.export();
  assert(transcript.events.some(event => event.operationId === 'notification-failed'));
});

test('unreadable session metadata cannot reset the active buffer to a guessed initial session', async t => {
  const app = fixture({ fat: true }); t.after(() => app.dispose());
  app.operation('before-read-failure', 'SUBMITTED');
  app.store.failMetaReads = true;
  app.operation('during-read-failure', 'UNKNOWN'); app.time.tick(300); await settle();
  app.click('export'); assert.equal(app.downloads.length, 0);
  assert.equal(app.ui.querySelector('button').textContent, 'OBS STORAGE ERROR');
  app.store.failMetaReads = false;
  const transcript = await app.export();
  assert(transcript.events.some(event => event.operationId === 'before-read-failure'));
  assert(transcript.events.some(event => event.operationId === 'during-read-failure'));
  assert.match(transcript.text, /FULL FAT/);
});

test('oversized FAT sampling cancels its branch once without waiting for the native consumer', async t => {
  let reads = 0, cancels = 0;
  const response = { status: 200, url: fcr + '/status', headers: { get: () => 'application/json' },
    clone: () => ({ body: { getReader: () => ({
      read: async () => { reads++; return { done: false, value: new Uint8Array(40000) }; },
      cancel: () => { cancels++; return new Promise(() => {}); }
    }) } })
  };
  const app = fixture({ fat: true, fetch: () => Promise.resolve(response) }); t.after(() => app.dispose());
  assert.equal(await app.window.fetch('/status'), response); await settle();
  assert.equal(reads, 1); assert.equal(cancels, 1);
  app.hide(); await settle();
  assert.equal(cancels, 1);
});

test('export object URLs are released on pagehide before their delayed release timer fires', async t => {
  const app = fixture(); t.after(() => app.dispose());
  await app.export(); assert.equal(app.blobs, 1);
  app.hide(); assert.equal(app.blobs, 0); assert.equal(app.time.timers, 0);
});

test('HTTP native pages can collect with secure random values when randomUUID is unavailable', t => {
  const app = fixture({ url: 'http://fcmenu-nrt-regionalized.corp.amazon.com/BWU2/calmCode', randomUUID: false });
  t.after(() => app.dispose());
  app.operation('http-page', 'SUBMITTED'); app.time.tick(300);
  assert.equal(app.time.intervals, 0);
  assert([...app.store.values.values()].some(x => typeof x === 'string' && x.includes('http-page')));
});

test('known native cross-origin PO reads retain network evidence without mutation phases', async t => {
  const app = fixture({ fat: true, url: 'https://console.harmony.a2z.com/poportal/fe' }); t.after(() => app.dispose());
  await app.window.fetch('https://example.execute-api.us-east-1.amazonaws.com/beta/getPoHeaders', { method: 'POST' });
  const exporter = fixture({ store: app.store }); t.after(() => exporter.dispose());
  app.time.tick(300); await settle();
  const transcript = await exporter.export();
  assert(transcript.events.some(x => x.type === 'network.response' && x.data.url.includes('/getPoHeaders')));
  assert(!transcript.events.some(x => x.phase));
});

test('Clear cleanup cannot delete a new-session worker write interleaved with deleting old shards', async t => {
  const store = new Storage(), app = fixture({ store }), worker = fixture({ store });
  t.after(() => { app.dispose(); worker.dispose(); });
  app.time.tick(300); worker.time.tick(300); await settle();
  let interleaved = false;
  store.beforeDelete = () => {
    if (interleaved) return;
    interleaved = true;
    worker.operation('written-during-clear', 'SUBMITTED'); worker.time.tick(300);
  };
  app.click('clear'); await settle(); store.beforeDelete = null;
  assert(interleaved);
  const transcript = await app.export();
  assert(transcript.events.some(event => event.operationId === 'written-during-clear'));
});

test('a corrupted stored event cannot become a silent partial export; Clear restores collection', async t => {
  const app = fixture(); t.after(() => app.dispose());
  app.time.tick(300); await settle();
  const [key, raw] = [...app.store.values].find(([key]) => key.startsWith('tm-v4.obs.page.'));
  const damaged = JSON.parse(raw); damaged.events = [null];
  app.store.values.set(key.replace(/[^.]+$/, 'damaged-page'), JSON.stringify(damaged));
  app.click('export'); await settle();
  assert.equal(app.downloads.length, 0);
  assert.equal(app.ui.querySelector('button').textContent, 'OBS STORAGE ERROR');
  app.click('clear'); app.operation('after-cleanup', 'SUBMITTED');
  const transcript = await app.export();
  assert(transcript.events.some(event => event.operationId === 'after-cleanup'));
});
