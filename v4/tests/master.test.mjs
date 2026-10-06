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

test('saved A/L choices apply to the next search and preserve the current generation loading choice', async t => {
  const app = setup(t); app.window.document.querySelector('[data-tm-v4-section="product"]').click();
  assert.equal(app.runtime.automatic('product'), true); await resolved(app.native('product')); assert.equal(app.calls.length, 1);
  const next = app.native('product', 'B099999999'); next.fail(() => {}); await tick();
  assert.equal(app.runtime.automatic('product'), false); assert.equal(app.calls.length, 1); app.runtime.dispose();
});

test('native search Submit/Clear cancels prior owners before any replacement request can finish', async t => {
  const app = setup(t); let aborted = false; app.native('shipment').fail(() => { aborted = true; });
  const input = app.window.document.querySelector('#search'); input.value = 'B099999999';
  input.form.dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(aborted, true); assert.equal(app.runtime.current().query, 'B099999999');
  input.value = ''; input.dispatchEvent(new app.window.Event('input', { bubbles: true })); assert.equal(app.runtime.current().query, ''); assert.equal(app.calls.length, 0);
});

test('unidentified renderer preserves original content and exposes its integration error', async t => {
  const app = setup(t); const section = app.window.document.querySelector('[data-section-type="inventory"]');
  await resolved(app.native('inventory', undefined, { success: html => { section.innerHTML = html; } }));
  const nativeTable = section.querySelector('table'); await app.runtime.load('inventory', { force: true }); await tick();
  assert.equal(section.querySelector('table'), nativeTable); assert.match(section.querySelector('[data-tm-v4-read-status]').textContent, /Native rendering callback unavailable/);
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

test('native auth/schema failure settles its native request once and does not fabricate a successful callback', async t => {
  let valid = false;
  const app = setup(t, { fetch: async () => new Response(valid ? product() : '<form><input type="password"></form>') });
  const xhr = app.native('product'); let successes = 0, failures = 0; xhr.done(() => successes++).fail(() => failures++); await tick();
  assert.equal(successes, 0); assert.match(app.window.document.querySelector('[data-tm-v4-read-status]').textContent, /authentication/);
  valid = true; app.window.document.querySelector('[data-tm-v4-read-status] button').click();
  await tick(); assert.equal(successes, 0); assert.equal(failures, 1); assert.equal(app.jq.active, 0); assert.equal(app.calls.length, 2);
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
  w.GM_xmlhttpRequest = () => { throw new Error('Unexpected external read'); };
  w.GM_addValueChangeListener = () => 1; w.GM_removeValueChangeListener = () => {};
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

test('generated installer composes canonical reads, real native callbacks, external exact-item badges and optional OBS', async t => {
  const dom = new JSDOM(markup(), { url: 'https://fcresearch-fe.aka.amazon.com/BWU2/results?s=B012345678', runScripts: 'outside-only' }); const w = dom.window;
  w.TextDecoder = TextDecoder;
  t.after(() => { w.dispatchEvent(new w.PageTransitionEvent('pagehide')); w.close(); });
  const stored = new Map(), events = [], calls = [];
  const token = 'header.' + Buffer.from(JSON.stringify({ token_use: 'id', exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url') + '.sig';
  stored.set('tm-v4.measurement.auth', JSON.stringify({ token }));
  w.GM_getValue = (key, fallback) => stored.get(key) ?? fallback; w.GM_setValue = (key, value) => stored.set(key, value);
  w.GM_addValueChangeListener = () => 1; w.GM_removeValueChangeListener = () => {};
  w.GM_xmlhttpRequest = settings => {
    calls.push(settings.url); let payload;
    if (settings.url.includes('/api/scanitem')) payload = { items: [{ skuDetail: { fnSku: 'X012345678', asin: 'B012345678' }, binDescription: 'MEDIUM' }] };
    else if (settings.url.includes('/measurementEvents/')) payload = { measurementEvents: [{ measurementSource: 'MADCAT', measurementInstant: new Date(Date.now() - 1000).toISOString() }] };
    else payload = settings.method === 'POST' ? { rows: [{ asin: 'B012345678', level: 0, message: 'None' }] } : { restriction: 'default' };
    settings.onload({ status: 200, finalUrl: settings.url, responseText: JSON.stringify(payload) }); return { abort() {} };
  };
  const nativeProduct = '<table>' + Object.entries({ ASIN: 'B012345678', FNSKU: 'X012345678', Title: 'Exact title', Dimensions: '1 x 2 x 3', Weight: '1 kg' }).map(([label, value]) => '<tr><th>' + label + '</th><td>' + value + '</td></tr>').join('') + '</table>';
  w.fetch = async url => { assert(!url.includes('localhost'), 'Fixture cannot submit a print'); return new Response(url.endsWith('/product') ? nativeProduct : inventory); };
  const jq = jquery(w); w.addEventListener('tampermonkey-v4:evidence', event => events.push(JSON.parse(event.detail)));
  w.eval(readFileSync(new URL('../FCResearch_Master.user.js', import.meta.url), 'utf8')); w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  await Promise.all(['product', 'inventory'].map(endpoint => resolved(jq.ajax({ url: '/BWU2/results/' + endpoint, method: 'POST', data: { s: 'B012345678' }, dataType: 'html', success: html => { w.document.querySelector('[data-section-type="' + endpoint + '"]').innerHTML = html; } }))));
  await tick(); await tick();
  assert.equal(w.document.querySelector('[data-tm-v4-badge="size"]').textContent, 'Size: MEDIUM');
  assert.equal(w.document.querySelector('[data-tm-v4-badge="madcat"]').textContent, 'Madcat: YES');
  assert.equal(w.document.querySelector('[data-tm-v4-badge="hazmat"]').textContent, 'L0'); assert.equal(w.document.querySelectorAll('[data-tm-v4-quantity]').length, 2);
  assert.equal(calls.length, 4); assert(events.some(event => event.script === 'FCR MASTER' && event.type === 'script.start'));
  assert(events.every(event => !event.phase)); assert(!JSON.stringify(events).includes(token));
});

test('generated native Measurement branch captures successful auth and restores its native fetch on pagehide', async t => {
  const dom = new JSDOM('', { url: 'https://jp.item-measurement.aft.a2z.com/item/B012345678', runScripts: 'outside-only' }); const w = dom.window;
  w.TextDecoder = TextDecoder;
  t.after(() => { w.dispatchEvent(new w.PageTransitionEvent('pagehide')); w.close(); }); const stored = new Map();
  w.GM_getValue = (key, fallback) => stored.get(key) ?? fallback; w.GM_setValue = (key, value) => stored.set(key, value);
  const original = async () => ({ status: 200 }); w.fetch = original;
  const token = 'head.' + Buffer.from(JSON.stringify({ token_use: 'id', exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url') + '.sig';
  w.eval(readFileSync(new URL('../FCResearch_Master.user.js', import.meta.url), 'utf8'));
  await w.fetch('https://o0avbo02yl.execute-api.ap-northeast-1.amazonaws.com/prod/measurementEvents/B012345678/ASIN', { headers: { Authorization: token } });
  assert.equal(JSON.parse(stored.get('tm-v4.measurement.auth')).token, token); w.dispatchEvent(new w.PageTransitionEvent('pagehide')); assert.equal(w.fetch, original);
  assert.equal(w.document.querySelectorAll('[data-tm-v4-master]').length, 0);
});
