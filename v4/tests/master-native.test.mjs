import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createMasterRuntime, watchNativeAjax, MASTER_LABELS } from '../master-runtime.mjs';
import { FCR_SECTIONS } from '../fcr-read.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const inventory = (container = 'tsX111', total = 1) => '<div class="filter"></div><table id="table-inventory"><thead><tr>' +
  '<th id="inventory-container">Container</th><th>ASIN</th><th data-sort-col="2" data-func="sum">Quantity (' + total + ')</th>' +
  '</tr></thead><tbody><tr><td>' + container + '</td><td>B012345678</td><td>1</td></tr></tbody></table>';
function bootstrap() {
  const modules = new Map(), pending = [];
  function flush() {
    for (const job of [...pending]) if (job.names.every(name => modules.has(name))) {
      pending.splice(pending.indexOf(job), 1); job.callback(...job.names.map(name => modules.get(name)));
    }
  }
  return { now: (...names) => ({ execute: (...args) => args.at(-1)(...names.map(name => modules.get(name))) }),
    when: (...names) => ({ execute: (...args) => { pending.push({ names, callback: args.at(-1) }); flush(); } }),
    declare: (name, value) => { modules.set(name, value); flush(); } };
}
function setup(t, { fetch = async () => new Response(inventory()), late = true } = {}) {
  const nav = '<nav><h6>Sections</h6><ul id="sections-list">' + FCR_SECTIONS.map((endpoint, index) =>
    '<li id="' + endpoint + '-status"><i></i>' + (index === 3 ? 'Container history' : MASTER_LABELS[index]) + '</li>').join('') + '</ul></nav>';
  // Native settings rows also carry section-type. They must not be hidden or
  // mistaken for a result placeholder.
  const dom = new JSDOM('<li id="setting" data-section-type="inventory"></li>' + nav + '<main>' + FCR_SECTIONS.map(endpoint =>
    '<div class="section-placeholder" data-section-type="' + endpoint + '"></div>').join('') + '</main>',
  { url: 'https://qi-fcresearch-fe.corp.amazon.com/BWU2/results?s=B012345678', runScripts: 'outside-only' });
  const w = dom.window; w.eval(readFileSync(new URL('./vendor/jquery-1.6.4.min.js', import.meta.url), 'utf8'));
  const jq = w.jQuery; delete w.jQuery; delete w.$;
  const loader = bootstrap(); if (!late) { w.P = loader; loader.declare('jQuery', jq); }
  const calls = [], renders = [], instances = new Map(), tables = [], stored = new Map(); let destroyed = 0;
  jq.fn.dataTable = function(options) {
    if (options) {
      const instance = { options, table: this[0] }; instances.set(this[0], instance); tables.push(instance);
    }
    this.fnDestroy = () => { instances.delete(this[0]); destroyed++; }; return this;
  };
  jq.fn.dataTable.fnIsDataTable = table => instances.has(table);
  const runtime = createMasterRuntime({ window: w, storage: { get: key => stored.get(key), set: (key, value) => stored.set(key, value) },
    fetch: (url, options) => { calls.push({ url, ...options }); return fetch(url, options); }, onRender: value => renders.push(value) });
  runtime.start(); const bridge = watchNativeAjax(w, () => runtime);
  if (late) { Object.defineProperty(w, 'AmazonUIPageJS', { value: loader, writable: false }); loader.declare('jQuery', jq); }
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  // Independently authored model of the captured native loader contract. The
  // actual captured Amazon modules are also exercised locally before publishing.
  const native = (endpoint = 'inventory', data = { s: 'B012345678' }) => {
    const node = w.document.querySelector('.section-placeholder[data-section-type="' + endpoint + '"]');
    const status = jq('#' + endpoint + '-status'); status.addClass('loading');
    return jq.ajax({ type: 'POST', url: '/BWU2/results/' + endpoint, data, dataType: 'html' })
      .fail(() => status.addClass('failure')).done(html => {
        jq(node).html(html); status.removeClass('loading').wrapInner('<a href="#' + endpoint + '-nav"></a>');
        const table = jq(node).find('#table-' + endpoint);
        if (table.length) table.dataTable({ aaSorting: [[table.find('[data-sort-col]').data('sort-col') || 0, 'desc']],
          iDisplayLength: 100, bScrollInfinite: true, bScrollCollapse: true, sScrollY: '600px', sScrollX: '100%', sDom: 'lfrti' });
      });
  };
  t.after(() => { runtime.dispose(); bridge.restore(); w.close(); });
  return { w, jq, runtime, bridge, native, calls, renders, tables, instances, destroyed: () => destroyed };
}
const resolved = xhr => new Promise((resolve, reject) => xhr.done(resolve).fail((_xhr, status) => reject(new Error(status))));

test('private deployed-version jQuery attaches through late AUI declaration; real nav case and endpoint labels survive', async t => {
  const app = setup(t); assert.equal(app.jq.fn.jquery, '1.6.4'); assert.equal(app.w.jQuery, undefined);
  assert.equal(app.w.document.querySelectorAll('[data-tm-v4-section]').length, 19);
  assert.equal(app.w.document.querySelector('#problem-status').textContent, 'ProblemsL');
  assert.equal(app.w.document.querySelector('#problems-status').textContent, 'ProblemL');
  assert.equal(app.w.document.querySelector('#setting').hidden, false);
  assert('value' in Object.getOwnPropertyDescriptor(app.w, 'AmazonUIPageJS'));
  assert.equal(Object.getOwnPropertyDescriptor(app.w, 'jQuery'), undefined);
  await resolved(app.native()); assert.equal(app.calls.length, 1);
});

test('existing private AUI dependency attaches without global jQuery or bootstrap property hooks', async t => {
  const app = setup(t, { late: false }); await resolved(app.native());
  assert.equal(app.calls.length, 1); assert.equal(Object.getOwnPropertyDescriptor(app.w, 'jQuery'), undefined);
  app.bridge.watch(); await app.runtime.load('inventory', { force: true }); assert.equal(app.calls.length, 2);
});

test('completed partial retry reuses native renderer, destroys old instance and never repeats other jqXHR callbacks', async t => {
  let attempt = 0;
  const app = setup(t, { fetch: async () => new Response(inventory('tsX' + ++attempt, attempt === 1 ? 99 : 1)) });
  let subscribers = 0, completed = 0, starts = 0, stops = 0;
  app.jq(app.w.document).bind('ajaxStart', () => starts++).bind('ajaxStop', () => stops++);
  const xhr = app.native().done(() => subscribers++).complete(() => completed++); await resolved(xhr); await tick();
  const first = app.w.document.querySelector('#table-inventory'); assert.match(first.textContent, /tsX1/);
  const retry = app.w.document.querySelector('[data-tm-v4-read-status] button'); assert.equal(retry.textContent, 'Retry Inventory');
  retry.click(); await tick();
  assert.match(app.w.document.querySelector('#table-inventory').textContent, /tsX2/);
  assert.notEqual(app.w.document.querySelector('#table-inventory'), first);
  assert.equal(app.runtime.current().sections.get('inventory').status, 'ready');
  assert.equal(app.destroyed(), 1); assert.equal(app.instances.size, 1); assert.equal(app.tables.length, 2);
  assert.deepEqual(app.tables[1].options.aaSorting, [[2, 'desc']]); assert.equal(app.tables[1].options.sScrollY, '600px');
  assert.equal(subscribers, 1); assert.equal(completed, 1); assert.equal(starts, 1); assert.equal(stops, 1); assert.equal(app.jq.active, 0);
  await app.runtime.load('inventory', { force: true }); await tick();
  assert.equal(app.w.document.querySelectorAll('#inventory-status a').length, 1);
  assert.equal(app.w.document.querySelectorAll('[data-tm-v4-section]').length, 19);
  assert.equal(app.instances.size, 1); assert.equal(subscribers, 1);
});

test('failed read settles native loading and deliberately recovers through native renderer without resolving old jqXHR', async t => {
  let valid = false;
  const app = setup(t, { fetch: async () => new Response(valid ? inventory() : '<form><input type="password"></form>') });
  let failures = 0, subscribers = 0, completed = 0;
  app.native().fail(() => failures++).done(() => subscribers++).complete(() => completed++); await tick();
  const status = app.w.document.querySelector('#inventory-status');
  assert.equal(app.jq.active, 0); assert.equal(failures, 1); assert.equal(completed, 1); assert.equal(subscribers, 0);
  assert.equal(status.classList.contains('loading'), false); assert.equal(status.classList.contains('failure'), true);
  valid = true; app.w.document.querySelector('[data-tm-v4-read-status] button').click(); await tick();
  assert(app.w.document.querySelector('#table-inventory')); assert.equal(status.classList.contains('failure'), false);
  assert.equal(app.runtime.current().sections.get('inventory').status, 'ready');
  assert.equal(failures, 1); assert.equal(subscribers, 0); assert.equal(completed, 1);
});

test('lazy native status has no spinner or traffic; one click releases its registered renderer', async t => {
  const app = setup(t); let done = 0; const xhr = app.native('shipment').done(() => done++); await tick();
  assert.equal(app.calls.length, 0); assert.equal(app.jq.active, 0);
  assert.equal(app.w.document.querySelector('#shipment-status').classList.contains('loading'), false);
  app.w.document.querySelector('#shipment-status').click(); await resolved(xhr);
  assert.equal(done, 1); assert.equal(app.calls.length, 1);
});

test('external native abort cannot paint late; deliberate retry uses fresh data and the retained native renderer', async t => {
  let answer, first = true;
  const app = setup(t, { fetch: () => first ? (first = false, new Promise(resolve => { answer = resolve; })) : Promise.resolve(new Response(inventory('tsX222'))) });
  let done = 0; const xhr = app.native().done(() => done++); xhr.abort();
  answer(new Response(inventory('tsX111'))); await tick();
  assert.equal(app.w.document.querySelector('#table-inventory'), null); assert.equal(done, 0); assert.equal(app.jq.active, 0);
  await app.runtime.load('inventory', { force: true }); await tick();
  assert.match(app.w.document.querySelector('#table-inventory').textContent, /tsX222/); assert.equal(done, 0); assert.equal(app.calls.length, 2);
});

test('replaced placeholder rejects a retained renderer and preserves replacement native content', async t => {
  const app = setup(t); await resolved(app.native());
  const node = app.w.document.querySelector('.section-placeholder[data-section-type="inventory"]');
  const replacement = node.cloneNode(false); replacement.textContent = 'New native panel'; node.replaceWith(replacement);
  await app.runtime.load('inventory', { force: true }); await tick();
  assert.match(replacement.textContent, /New native panel/); assert.match(replacement.textContent, /Native section changed/);
  assert.equal(replacement.querySelector('table'), null);
});

test('request registration is restored immediately and query/disposal invalidate captured native functions', async t => {
  let answer;
  const app = setup(t, { fetch: (url, options) => new URLSearchParams(options.body).get('s') === 'B012345678' ?
    new Promise(resolve => { answer = resolve; }) : Promise.resolve(new Response(inventory('tsX222'))) });
  const xhr = app.native(); const done = xhr.done;
  app.w.history.replaceState(null, '', '?s=B099999999'); await resolved(app.native('inventory', { s: 'B099999999' }));
  answer(new Response(inventory('tsX111'))); await tick();
  assert.equal(xhr.done, done); assert.match(app.w.document.querySelector('#table-inventory').textContent, /tsX222/);
  assert.equal(app.calls[0].signal.aborted, true); app.runtime.dispose();
  assert.equal(app.w.document.querySelectorAll('[data-tm-v4-master]').length, 0);
});

test('BFCache-style restart rebinds the document renderer to fresh reads without stale jqXHR callbacks or table leaks', async t => {
  let attempt = 0;
  const app = setup(t, { fetch: async () => new Response(inventory('tsX' + ++attempt)) });
  let callbacks = 0; await resolved(app.native().done(() => callbacks++));
  const old = app.runtime.current(); app.runtime.dispose(); app.runtime.start(); app.bridge.watch(); await tick();
  assert.notEqual(app.runtime.current(), old); assert.equal(old.controller.signal.aborted, true);
  assert.match(app.w.document.querySelector('#table-inventory').textContent, /tsX2/);
  assert.equal(app.calls.length, 2); assert.equal(callbacks, 1); assert.equal(app.instances.size, 1);
  assert.equal(app.w.document.querySelectorAll('[data-tm-v4-section]').length, 19);
  const before = app.calls.length; await tick(); assert.equal(app.calls.length, before);
});

test('generated installer composes with private jQuery 1.6.4 and restores native rendering and exact badges after BFCache', async t => {
  const app = setup(t), { w } = app; app.runtime.dispose();
  w.TextDecoder = TextDecoder;
  const stored = new Map(), token = 'head.' + Buffer.from(JSON.stringify({ token_use: 'id', exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url') + '.sig';
  stored.set('tm-v4.measurement.auth', JSON.stringify({ token }));
  w.GM_getValue = (key, fallback) => stored.get(key) ?? fallback; w.GM_setValue = (key, value) => stored.set(key, value);
  w.GM_addValueChangeListener = () => 1; w.GM_removeValueChangeListener = () => {};
  w.GM_xmlhttpRequest = settings => {
    const payload = settings.url.includes('/api/scanitem') ? { items: [{ skuDetail: { asin: 'B012345678' }, binDescription: 'MEDIUM' }] } :
      settings.url.includes('/measurementEvents/') ? { measurementEvents: [{ measurementSource: 'MADCAT', measurementInstant: new Date(Date.now() - 1000).toISOString() }] } :
        settings.method === 'POST' ? { rows: [{ asin: 'B012345678', level: 1 }] } : { restriction: 'default' };
    settings.onload({ status: 200, finalUrl: settings.url, responseText: JSON.stringify(payload) }); return { abort() {} };
  };
  let reads = 0;
  w.fetch = async url => { reads++; assert(!url.includes('localhost')); return new Response(url.endsWith('/product') ?
    '<table><tr><th>ASIN</th><td>B012345678</td></tr><tr><th>Title</th><td>Fixture product</td></tr><tr><th>Dimensions</th><td>1 x 2 x 3</td></tr></table>' : inventory()); };
  w.eval(readFileSync(new URL('../FCResearch_Master.user.js', import.meta.url), 'utf8'));
  await Promise.all([resolved(app.native('product')), resolved(app.native('inventory'))]); await tick(); await tick();
  assert.equal(w.document.querySelector('[data-tm-v4-badge="size"]').textContent, 'Size: MEDIUM');
  assert.equal(w.document.querySelector('[data-tm-v4-badge="madcat"]').textContent, 'Madcat: YES');
  assert.equal(app.instances.size, 1); assert.equal(reads, 2);
  const nativeTable = w.document.querySelector('#table-inventory');
  w.history.replaceState(null, '', '#inventory-nav'); w.dispatchEvent(new w.HashChangeEvent('hashchange')); await tick();
  assert.equal(reads, 2); assert.equal(w.document.querySelector('#table-inventory'), nativeTable);
  w.dispatchEvent(new w.PageTransitionEvent('pagehide', { persisted: true }));
  w.dispatchEvent(new w.PageTransitionEvent('pageshow', { persisted: true })); await tick(); await tick();
  assert.equal(reads, 4); assert.equal(app.instances.size, 1);
  assert.equal(w.document.querySelector('[data-tm-v4-badge="size"]').textContent, 'Size: MEDIUM');
  assert.equal(w.document.querySelectorAll('[data-tm-v4-section]').length, 19);
  w.dispatchEvent(new w.PageTransitionEvent('pagehide'));
});
