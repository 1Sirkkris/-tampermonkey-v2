import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import jquery from 'jquery';
import { readFileSync } from 'node:fs';
import { createMasterRuntime, watchNativeAjax, MASTER_LABELS } from '../master-runtime.mjs';
import { FCR_SECTIONS } from '../fcr-read.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const product = (code = 'B012345678') => '<table><tr><th>ASIN</th><td>' + code + '</td></tr><tr><th>Title</th><td>Exact title</td></tr></table>';
const inventory = '<table id="table-inventory"><thead><tr><th>Container</th><th>ASIN</th><th>Quantity (1)</th></tr></thead><tbody><tr><td>tsX111</td><td>B012345678</td><td>1</td></tr></tbody></table>';
const markup = () => '<form><input id="search" value="B012345678"></form><aside><h2>Sections</h2>' + MASTER_LABELS.map((label, i) => '<div><a href="#' + FCR_SECTIONS[i] + '">' + label + '</a></div>').join('') + '</aside><main>' + FCR_SECTIONS.map(endpoint => '<div data-section-type="' + endpoint + '"></div>').join('') + '</main>';
function setup(t, { fetch = async url => new Response(url.endsWith('/product') ? product() : url.endsWith('/inventory') ? inventory : '<table><tr><td>Native section</td></tr></table>'), stored = new Map(), lateJquery = false } = {}) {
  const dom = new JSDOM(markup(), { url: 'https://fcresearch-fe.aka.amazon.com/BWU2/results?s=B012345678', runScripts: 'outside-only' });
  const { window } = dom, calls = [], renders = [];
  const transport = async (url, options) => { calls.push({ url, ...options }); return fetch(url, options); };
  const storage = { get: (key, fallback) => stored.has(key) ? stored.get(key) : fallback, set: (key, value) => stored.set(key, value) };
  const runtime = createMasterRuntime({ window, storage, fetch: transport, onRender: value => renders.push(value) });
  let jq;
  if (!lateJquery) jq = jquery(window);
  runtime.start(); watchNativeAjax(window, () => runtime);
  if (lateJquery) jq = jquery(window);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  t.after(() => { runtime.dispose(); window.close(); });
  const native = (endpoint, code = 'B012345678', options = {}) => jq.ajax({ url: '/BWU2/results/' + endpoint, method: 'POST', data: { s: code }, dataType: 'html', ...options });
  return { window, runtime, jq, calls, renders, stored, storage, native };
}
const resolved = xhr => new Promise((resolve, reject) => xhr.done(resolve).fail((_xhr, status) => reject(new Error(status))));

test('native installer startup is independent and idle; all nineteen inline choices/defaults are preserved', async t => {
  const app = setup(t); await tick();
  const buttons = [...app.window.document.querySelectorAll('[data-tm-v4-section]')];
  assert.equal(buttons.length, 19); assert.deepEqual(buttons.map(node => node.textContent), ['A', 'A', ...Array(17).fill('L')]);
  assert.equal(app.calls.length, 0); assert.equal(app.window.document.querySelectorAll('[data-tm-v4-master-status]').length, 1);
  assert.equal(app.window.document.querySelector('[data-section-type="inventory-history"]').hidden, true);
});

test('late native jQuery registration is observed once without polling or changing its identity', async t => {
  const app = setup(t, { lateJquery: true });
  assert.equal(app.window.jQuery, app.jq); assert('value' in Object.getOwnPropertyDescriptor(app.window, 'jQuery'));
  watchNativeAjax(app.window, () => app.runtime);
  await resolved(app.native('product')); assert.equal(app.calls.length, 1);
});

test('native success, done, complete and headers survive, with a single canonical automatic read', async t => {
  const app = setup(t); const seen = [];
  const xhr = app.native('product', undefined, { success: html => seen.push(['success', html]), complete: response => seen.push(['complete', response.status]) });
  xhr.done(html => { seen.push(['done', html]); app.window.document.querySelector('[data-section-type="product"]').innerHTML = html; });
  await resolved(xhr); await tick();
  assert.deepEqual(seen.map(row => row[0]), ['success', 'done', 'complete']); assert.equal(xhr.status, 200);
  assert.match(xhr.getResponseHeader('Content-Type'), /text\/html/); assert.equal(app.calls.length, 1);
  assert.equal(app.renders[0].result.product.title, 'Exact title');
  await resolved(app.native('product')); assert.equal(app.calls.length, 1);
});

test('lazy native requests stay unsent and do not keep global loading active; click releases the native callback', async t => {
  const app = setup(t); let stopped = 0, rendered = false;
  app.jq(app.window.document).on('ajaxStart', () => stopped++);
  const xhr = app.native('shipment', undefined, { timeout: 1 });
  xhr.done(() => { rendered = true; }); await tick();
  assert.equal(app.calls.length, 0); assert.equal(stopped, 0); assert.equal(rendered, false);
  [...app.window.document.querySelectorAll('aside a')].find(node => node.textContent === 'Shipment').click();
  await resolved(xhr); assert.equal(rendered, true); assert.equal(app.calls.length, 1);
  assert.equal(app.window.document.querySelector('[data-section-type="shipment"]').hidden, false);
});

test('preference writes require exact readback; failures keep the previous choice visible', async t => {
  const app = setup(t); app.storage.set = () => {};
  const node = app.window.document.querySelector('[data-tm-v4-section="product"]'); node.click();
  assert.equal(node.textContent, '!'); assert.equal(node.getAttribute('aria-pressed'), 'true'); assert.match(node.title, /SAVE FAILED/);
  app.storage.set = (key, value) => app.stored.set(key, value); node.click();
  assert.equal(node.textContent, 'L'); assert.equal(app.stored.get('tm-v4.master.section.product'), false);
});

test('query replacement cancels owned reads and unsent lazy requests; late data never reaches a new panel', async t => {
  let answer;
  const app = setup(t, { fetch: (url, options) => url.endsWith('/product') && new URLSearchParams(options.body).get('s') === 'B012345678' ?
    new Promise(resolve => { answer = resolve; }) : Promise.resolve(new Response(product('B099999999'))) });
  const old = app.native('product'); let oldSuccess = 0; old.done(() => oldSuccess++); old.fail(() => {});
  const lazy = app.native('shipment'); let lazyAborted = false; lazy.fail(() => { lazyAborted = true; });
  app.window.history.replaceState(null, '', '?s=B099999999');
  await resolved(app.native('product', 'B099999999'));
  assert.equal(app.calls[0].signal.aborted, true); assert.equal(lazyAborted, true);
  answer(new Response(product())); await tick();
  assert.equal(oldSuccess, 0); assert.equal(app.renders.length, 1); assert.equal(app.renders[0].result.query, 'B099999999');
});

test('complete inventory reaches native callbacks only after canonical continuation validation', async t => {
  const next = inventory.replace('Quantity (1)', 'Quantity (2)') + '<div class="pagination-token">{"p":2}</div>';
  const app = setup(t, { fetch: async url => new Response(url.endsWith('/inventory-more') ? '<tr><td>tsX222</td><td>B012345678</td><td>1</td></tr>' : next) });
  const html = await resolved(app.native('inventory'));
  assert.equal(app.calls.length, 2); assert(!html.includes('pagination-token')); assert.match(html, /tsX222/);
  assert.equal(app.renders[0].result.totalQuantity, 2); assert.equal(app.renders[0].result.complete, true);
});

test('incomplete inventory remains visibly partial and deliberately retryable', async t => {
  const app = setup(t, { fetch: async () => new Response(inventory.replace('Quantity (1)', 'Quantity (99)')) });
  await resolved(app.native('inventory')); await tick();
  assert.equal(app.renders[0].result.complete, false); assert.equal(app.renders[0].result.totalQuantity, null);
  assert.match(app.window.document.querySelector('[data-tm-v4-read-status]').textContent, /Retry Inventory/);
});

test('native auth/schema failure preserves retry callbacks and does not produce a successful read', async t => {
  let valid = false;
  const app = setup(t, { fetch: async () => new Response(valid ? product() : '<form><input type="password"></form>') });
  const xhr = app.native('product'); let successes = 0; xhr.done(() => successes++); await tick();
  assert.equal(successes, 0); assert.match(app.window.document.querySelector('[data-tm-v4-read-status]').textContent, /authentication/);
  valid = true; app.window.document.querySelector('[data-tm-v4-read-status] button').click();
  await resolved(xhr); assert.equal(successes, 1); assert.equal(app.calls.length, 2);
});

test('native table/navigation replacement and repeated refresh retain one control and no extra reads', async t => {
  const app = setup(t); const nav = app.window.document.querySelector('aside');
  nav.innerHTML = '<h2>Sections</h2>' + MASTER_LABELS.map(label => '<div><a>' + label + '</a></div>').join('');
  const section = app.window.document.querySelector('[data-section-type="inventory"]'); section.replaceWith(section.cloneNode(false));
  await tick(); app.runtime.refresh(); app.runtime.refresh();
  assert.equal(app.window.document.querySelectorAll('[data-tm-v4-section]').length, 19);
  assert.equal(app.window.document.querySelectorAll('[data-tm-v4-master-status]').length, 1); assert.equal(app.calls.length, 0);
});

test('disposal aborts reads, resolves lazy owners and restores owned UI/visibility; restart is clean and idle', async t => {
  const app = setup(t); let aborts = 0;
  app.native('shipment').fail(() => aborts++); app.runtime.dispose();
  assert.equal(aborts, 1); assert.equal(app.window.document.querySelectorAll('[data-tm-v4-master]').length, 0);
  assert.equal(app.window.document.querySelector('[data-section-type="shipment"]').hidden, false);
  app.runtime.start(); app.window.document.dispatchEvent(new app.window.Event('DOMContentLoaded')); await tick();
  assert.equal(app.window.document.querySelectorAll('[data-tm-v4-section]').length, 19); assert.equal(app.calls.length, 0);
});

test('generated installer starts alone, ignores ISS/Tote routes and restarts once after BFCache', async t => {
  const dom = new JSDOM(markup(), { url: 'https://fcresearch-fe.aka.amazon.com/BWU2/results?s=B012345678', runScripts: 'outside-only' });
  t.after(() => { dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pagehide')); dom.window.close(); }); const w = dom.window;
  const stored = new Map(); w.GM_getValue = (key, fallback) => stored.get(key) ?? fallback; w.GM_setValue = (key, value) => stored.set(key, value);
  w.fetch = async () => new Response(product()); jquery(w);
  const installer = readFileSync(new URL('../FCResearch_Master.user.js', import.meta.url), 'utf8');
  w.eval(installer); w.document.dispatchEvent(new w.Event('DOMContentLoaded')); await tick();
  assert.equal(w.document.querySelectorAll('[data-tm-v4-section]').length, 19);
  w.dispatchEvent(new w.PageTransitionEvent('pagehide', { persisted: true })); assert.equal(w.document.querySelectorAll('[data-tm-v4-master]').length, 0);
  w.dispatchEvent(new w.PageTransitionEvent('pageshow', { persisted: true })); await tick();
  assert.equal(w.document.querySelectorAll('[data-tm-v4-section]').length, 19);
  w.eval(installer); assert.equal(w.document.querySelectorAll('[data-tm-v4-section]').length, 19);
  w.history.replaceState(null, '', '#iss-console'); w.dispatchEvent(new w.HashChangeEvent('hashchange'));
  await tick(); assert.equal(w.document.querySelectorAll('[data-tm-v4-master]').length, 0);
});
