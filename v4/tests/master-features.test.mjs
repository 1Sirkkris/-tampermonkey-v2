import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import jquery from 'jquery';
import { createMasterRuntime, watchNativeAjax, MASTER_LABELS } from '../master-runtime.mjs';
import { FCR_SECTIONS } from '../fcr-read.mjs';
import { createMasterFeatures, nextSydneyCutoff, createMadcatCache, sizeCandidates, productPanel } from '../master-features.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const raw = madcat => ({ madcat, madcatSource: 'raw', windowDays: 30, complete: true, source: 'network' });
const fields = { ASIN: 'B012345678', FNSKU: 'X012345678', FCSKU: 'FC12345678', Title: 'Exact title', Dimensions: '1 x 2 x 3', Weight: '2 kg', Sortable: 'true', Conveyable: 'unknown', 'Master Case': 'false', 'Very High Value': 'yes' };
const product = (overrides = {}) => '<table>' + Object.entries({ ...fields, ...overrides }).map(([key, value]) => '<tr><th>' + key + '</th><td>' + value + '</td></tr>').join('') + '</table>';
const inventory = (rows = [['tsX111', 'B012345678', 'X012345678', 2]]) => '<table id="table-inventory"><thead><tr><th>Container</th><th>ASIN</th><th>FNSKU</th><th>Quantity</th></tr></thead><tbody>' + rows.map(row => '<tr>' + row.map(value => '<td>' + value + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
const markup = '<aside><h2>Sections</h2>' + MASTER_LABELS.map(label => '<div><a>' + label + '</a></div>').join('') + '</aside><main>' + FCR_SECTIONS.map(endpoint => '<div data-section-type="' + endpoint + '"></div>').join('') + '</main>';
function setup(t, { enrichment: overrides = {}, auth = {}, rows, stored = new Map(), now = () => Date.parse('2026-10-05T02:00:00Z') } = {}) {
  const dom = new JSDOM(markup, { url: 'https://fcresearch-fe.aka.amazon.com/BWU2/results?s=B012345678' }); const w = dom.window;
  const storage = { get: (key, fallback) => stored.get(key) ?? fallback, set: (key, value) => stored.set(key, value) };
  const calls = { reads: [], bin: [], haz: [], madcat: [] }; let features;
  const fetch = async (url, options) => { calls.reads.push({ url, ...options }); return new Response(url.endsWith('/product') ? product() : inventory(rows)); };
  const runtime = createMasterRuntime({ window: w, storage, fetch, onRefresh: () => features?.refresh(), onReset: () => features?.reset(), onDispose: () => features?.dispose() });
  const enrichment = {
    binDescription: async (...args) => { calls.bin.push(args); return overrides.binDescription ? overrides.binDescription(...args) : { size: 'MEDIUM', complete: true }; },
    hazmat: async (...args) => { calls.haz.push(args); return overrides.hazmat ? overrides.hazmat(...args) : { hazmat: { level: 0, message: 'None' }, complete: true }; },
    recentMadcat: async (...args) => { calls.madcat.push(args); return overrides.recentMadcat ? overrides.recentMadcat(...args) : raw(true); }
  };
  features = createMasterFeatures({ window: w, runtime, enrichment, auth: { loginUrl: code => 'https://jp.item-measurement.aft.a2z.com/item/' + code, ...auth }, storage, now });
  const jq = jquery(w); runtime.start(); watchNativeAjax(w, () => runtime); w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  t.after(() => { runtime.dispose(); w.close(); });
  function native(endpoint) {
    return new Promise((resolve, reject) => jq.ajax({ url: '/BWU2/results/' + endpoint, method: 'POST', data: { s: 'B012345678' }, dataType: 'html',
      success: html => { w.document.querySelector('[data-section-type="' + endpoint + '"]').innerHTML = html; } }).done(resolve).fail(reject));
  }
  const show = async () => { await Promise.all([native('product'), native('inventory')]); await tick(); await tick(); };
  return { w, jq, calls, runtime, features, storage, stored, native, show };
}

test('Sydney positive cache cutoff follows standard time, daylight time and both DST transitions', () => {
  const check = (before, after) => assert.equal(new Date(nextSydneyCutoff(Date.parse(before))).toISOString(), after);
  check('2026-07-10T01:00:00Z', '2026-07-10T08:00:00.000Z');
  check('2026-10-05T01:00:00Z', '2026-10-05T07:00:00.000Z');
  check('2026-10-03T08:00:00Z', '2026-10-04T07:00:00.000Z');
  check('2026-04-04T07:00:00Z', '2026-04-05T08:00:00.000Z');
  check('2026-10-05T07:00:00Z', '2026-10-06T07:00:00.000Z');
});

test('MADCAT raw caches distinguish identifier types; negative TTL is five minutes and history/partial data is never cached', () => {
  let time = Date.parse('2026-10-05T02:00:00Z'); const stored = new Map(); const storage = { get: key => stored.get(key), set: (key, value) => stored.set(key, value) };
  const cache = createMadcatCache({ storage, now: () => time }); cache.put('ASIN:B012345678', raw(true)); cache.put('FNSKU:X012345678', raw(false));
  assert.equal(cache.get('ASIN:B012345678').madcat, true); assert.equal(cache.get('FNSKU:B012345678'), null);
  const restored = createMadcatCache({ storage, now: () => time }); assert.equal(restored.get('FNSKU:X012345678').madcat, false);
  cache.put('ASIN:B099999999', { ...raw(true), madcatSource: 'history' }); assert.equal(cache.get('ASIN:B099999999'), null);
  time += 300000; assert.equal(cache.get('FNSKU:X012345678'), null); assert(cache.get('ASIN:B012345678'));
  time = Date.parse('2026-10-05T07:00:00Z'); assert.equal(cache.get('ASIN:B012345678'), null);
});

test('Size candidates preserve exact FNSKU, container priorities, quantity ordering and a three-container bound', () => {
  const row = (container, qty, fnsku = 'X012345678') => ({ container, qty, fnsku, asin: 'B012345678' });
  const rows = [row('other', 500), row('P-2-A', 300), row('tsXlow', 1), row('csXhigh', 20), row('tsXlow', 8), row('tsXwrong', 999, 'X099999999')];
  assert.deepEqual(sizeCandidates(rows, 'X012345678', ['B012345678']), ['csXhigh', 'tsXlow', 'P-2-A']);
});

test('product enrichment stays idle until exact native content is validated and rejects a stale/replaced title or alias', async t => {
  const app = setup(t); await tick(); assert.deepEqual(app.calls, { reads: [], bin: [], haz: [], madcat: [] });
  app.w.document.querySelector('[data-section-type="product"]').innerHTML = product({ ASIN: 'B099999999' }); app.runtime.refresh();
  assert.equal(app.calls.bin.length, 0);
  const verified = { title: 'Exact title', aliases: ['B012345678', 'X012345678', 'FC12345678'] };
  assert.equal(productPanel(app.w.document, verified), null);
});

test('automatic Size shares fresh inventory with native rendering and exact-item badges remain keyboard buttons', async t => {
  const app = setup(t); await app.show();
  assert.equal(app.calls.reads.filter(call => call.url.endsWith('/inventory')).length, 1);
  assert.deepEqual(app.calls.bin[0].slice(0, 2), ['tsX111', 'X012345678']); assert.equal(app.calls.bin.length, 1);
  assert.equal(app.w.document.querySelector('[data-tm-v4-badge="size"]').textContent, 'Size: MEDIUM');
  const badge = app.w.document.querySelector('[data-tm-v4-badge="madcat"]'); assert.equal(badge.tagName, 'BUTTON'); assert.equal(badge.textContent, 'Madcat: YES');
  assert.equal(app.w.document.querySelector('[data-tm-v4-property="unknown"]').textContent, 'unknown');
  app.runtime.refresh(); app.runtime.refresh(); await tick(); assert.equal(app.calls.bin.length, 1); assert.equal(app.calls.madcat.length, 1);
});

test('private Size inventory read does not open a lazy section or release its native callback', async t => {
  const stored = new Map([['tm-v4.master.section.inventory', false]]); const app = setup(t, { stored });
  let opened = false; app.native('inventory').then(() => { opened = true; }, () => {});
  await app.native('product'); await tick(); await tick();
  assert.equal(app.calls.bin.length, 1); assert.equal(opened, false);
  assert.equal(app.w.document.querySelector('[data-section-type="inventory"]').hidden, true);
  [...app.w.document.querySelectorAll('aside a')].find(node => node.textContent === 'Inventory').click(); await tick();
  assert.equal(opened, true); assert.equal(app.calls.reads.filter(call => call.url.endsWith('/inventory')).length, 1);
});

test('inexact sizes stay unavailable and recheck never tries more than three fresh candidates', async t => {
  const rows = Array.from({ length: 5 }, (_, i) => ['tsX' + i, 'B012345678', 'X012345678', 5 - i]);
  const app = setup(t, { rows, enrichment: { binDescription: async () => ({ size: 'UNRELATED', complete: false }) } }); await app.show();
  assert.equal(app.calls.bin.length, 3); assert.equal(app.w.document.querySelector('[data-tm-v4-badge="size"]').textContent, 'Size: Unavailable');
  app.w.document.querySelector('[data-tm-v4-badge="size"]').click(); await tick(); assert.equal(app.calls.bin.length, 6);
});

test('raw negative, history positive/unknown and malformed partial raw outcomes remain distinct', async t => {
  for (const result of [raw(false), { madcat: true, madcatSource: 'history', complete: false, authRequired: true }, { madcat: null, madcatSource: 'history', complete: false }, { ...raw(false), complete: false }]) {
    const app = setup(t, { enrichment: { recentMadcat: async () => result } }); await app.show();
    const badge = app.w.document.querySelector('[data-tm-v4-badge="madcat"]');
    assert.equal(badge.textContent, result.madcatSource === 'history' ? result.madcat ? 'Madcat: YES' : 'Madcat: NO?' : result.complete ? 'Madcat: NO' : 'Madcat: ERROR ↻');
    if (result.madcatSource === 'history') { assert.equal(badge.dataset.state, 'history'); assert.equal(badge.disabled, false); }
  }
});

test('hazmat groups repeated exact ASINs across product/inventory and product L0 opens only the native RIVER handoff', async t => {
  const app = setup(t, { rows: [['tsX1', 'B012345678', 'X012345678', 1], ['tsX2', 'B012345678', 'X012345678', 2]] });
  const opened = []; app.w.open = url => { opened.push(url); return {}; }; await app.show();
  assert.equal(app.calls.haz.length, 1); assert.equal(app.w.document.querySelectorAll('[data-tm-v4-badge="hazmat"]').length, 3);
  app.w.document.querySelector('[data-section-type="product"] [data-tm-v4-badge="hazmat"]').click();
  assert.equal(opened.length, 1); const url = new URL(opened[0]); assert.equal(url.pathname, '/BWU2/workflows'); assert.equal(url.searchParams.get('id'), '0dbb253e-c43a-4a8b-a316-e32b8ab9be21');
  app.w.document.querySelector('[data-tm-v4-badge="recheck-hazmat"]').click(); await tick(); assert.equal(app.calls.haz.length, 2);
});

test('manual Hazmat recheck remains enabled during loading, coalesces clicks and UNKNOWN cannot open RIVER', async t => {
  const pending = [], opened = [];
  const app = setup(t, { enrichment: { hazmat: async () => new Promise(resolve => pending.push(resolve)) } });
  app.w.open = url => { opened.push(url); return {}; };
  await app.show();
  const manual = app.w.document.querySelector('[data-section-type=product] [data-tm-v4-badge=pandash]');
  assert.equal(manual.disabled, false);
  manual.click(); manual.click(); manual.click(); assert.equal(app.calls.haz.length, 1);
  pending.shift()({ hazmat: null, complete: false }); await tick(); await tick();
  assert.equal(app.calls.haz.length, 2); assert.equal(manual.disabled, false);
  pending.shift()({ hazmat: null, complete: false }); await tick(); await tick();
  const badge = app.w.document.querySelector('[data-section-type=product] [data-tm-v4-badge=hazmat]');
  assert.equal(badge.textContent, 'UNKNOWN'); assert(!badge.title.includes('Create Hazmat RIVER'));
  badge.click(); assert.equal(opened.length, 0); assert.equal(app.calls.haz.length, 3);
  pending.shift()({ hazmat: { level: 0, message: 'Native L0' }, complete: true }); await tick(); await tick();
  badge.click(); assert.equal(opened.length, 1); assert.equal(app.calls.haz.length, 3);
});

test('hazmat worker concurrency is bounded and query cancellation prevents queued or late results', async t => {
  const pending = []; let inFlight = 0, maximum = 0;
  const rows = Array.from({ length: 8 }, (_, i) => ['tsX' + i, 'B00000000' + i, 'X00000000' + i, 1]);
  const app = setup(t, { rows, enrichment: { hazmat: async (_asin, { signal }) => {
    inFlight++; maximum = Math.max(maximum, inFlight);
    return new Promise(resolve => { pending.push({ signal, resolve: () => { inFlight--; resolve({ hazmat: null, complete: false }); } }); });
  } } });
  await app.show(); assert.equal(maximum, 4); assert.equal(pending.length, 4);
  app.runtime.dispose(); assert(pending.every(item => item.signal.aborted)); pending.forEach(item => item.resolve()); await tick();
  assert.equal(app.calls.haz.length, 4); assert.equal(app.w.document.querySelectorAll('[data-tm-v4-badge]').length, 0);
});

test('PO indicators preserve split native headers, numeric inputs and both date age thresholds', async t => {
  const app = setup(t); app.w.document.querySelector('[data-section-type="purchase-order-item"]').innerHTML = '<div class="dataTables_scroll"><div class="dataTables_scrollHead"><table><thead><tr><th>Unfilled</th><th>Cancelled</th><th>Order Date</th></tr></thead></table></div><table id="table-purchase-order-item"><tbody><tr><td><input value="3"></td><td>1</td><td>2025-12-01</td></tr></tbody></table></div>';
  app.runtime.refresh(); const cells = app.w.document.querySelector('#table-purchase-order-item').rows[0].cells;
  assert.match(cells[0].getAttribute('data-tm-v4-po'), /unfilled.*band/); assert.match(cells[1].getAttribute('data-tm-v4-po'), /cancelled.*band/); assert.match(cells[2].getAttribute('data-tm-v4-po'), /band.*old/);
  app.runtime.dispose(); assert.equal(cells[0].hasAttribute('data-tm-v4-po'), false);
});


test('MADCAT automatically upgrades auth-required history once on a native notification without forcing auth', async t => {
  let callback, ready = false, stops = 0;
  const app = setup(t, { auth: { read: () => ready ? { token: 'fresh' } : null, watch: (fn, { signal }) => {
    callback = fn; const stop = () => { stops++; }; signal.addEventListener('abort', stop, { once: true }); return stop;
  } }, enrichment: { recentMadcat: async () => ready ? raw(true) : { madcat: null, madcatSource: 'history', authRequired: true, fallbackReason: 'measurement-login-required' } } });
  await app.show(); assert.equal(app.w.document.querySelector('[data-tm-v4-badge="madcat"]').textContent, 'Madcat: NO?');
  ready = true; callback(); await tick(); await tick();
  assert.equal(app.w.document.querySelector('[data-tm-v4-badge="madcat"]').textContent, 'Madcat: YES');
  assert.equal(app.calls.madcat.length, 2); assert.equal(app.calls.madcat[1][1].forceAuth, undefined); assert(stops > 0);
  callback(); await tick(); assert.equal(app.calls.madcat.length, 2);
});

test('MADCAT notices auth arriving during history and bounds automatic recovery', async t => {
  let ready = false, count = 0;
  const app = setup(t, { auth: { read: () => ready ? { token: 'fresh' } : null }, enrichment: { recentMadcat: async () => {
    count++; ready = true; return { madcat: null, madcatSource: 'history', authRequired: true, fallbackReason: 'measurement-login-required' };
  } } });
  await app.show(); await tick(); assert.equal(count, 2);
  app.runtime.refresh(); await tick(); assert.equal(count, 2);
});

test('MADCAT auth updates cannot revive a disposed query and cached raw results need no auth', async t => {
  let callback;
  const app = setup(t, { auth: { watch: fn => { callback = fn; return () => {}; } }, enrichment: {
    recentMadcat: async () => ({ madcat: null, madcatSource: 'history', authRequired: true })
  } });
  await app.show(); app.runtime.dispose(); callback(); await tick(); assert.equal(app.calls.madcat.length, 1);
  const stored = new Map(), cache = createMadcatCache({ storage: { get: (key, fallback) => stored.get(key) ?? fallback, set: (key, value) => stored.set(key, value) }, now: () => Date.parse('2026-10-05T02:00:00Z') });
  cache.put('FNSKU:X012345678', raw(false));
  const cached = setup(t, { stored, auth: { read: () => { throw new Error('Cache must not depend on auth'); } } });
  await cached.show(); assert.equal(cached.calls.madcat.length, 0);
  assert.equal(cached.w.document.querySelector('[data-tm-v4-badge="madcat"]').textContent, 'Madcat: NO');
});

test('MADCAT manual transport recheck reuses auth and a blocked login remains visibly retryable', async t => {
  let fail = true;
  const app = setup(t, { auth: { read: () => ({ token: 'fresh' }) }, enrichment: { recentMadcat: async () => {
    if (fail) throw new Error('Temporary transport failure'); return raw(false);
  } } });
  await app.show(); fail = false; app.w.document.querySelector('[data-tm-v4-badge="madcat"]').click(); await tick(); await tick();
  assert.equal(app.calls.madcat[1][1].forceAuth, undefined);
  assert.equal(app.w.document.querySelector('[data-tm-v4-badge="madcat"]').textContent, 'Madcat: NO');
  const blocked = setup(t, { auth: { read: () => null }, enrichment: { recentMadcat: async () => ({ madcat: null, madcatSource: 'history', authRequired: true }) } });
  blocked.w.open = () => null; await blocked.show();
  blocked.w.document.querySelector('[data-tm-v4-badge="madcat"]').click(); await tick(); assert.equal(blocked.calls.madcat.length, 1);
  assert.match(blocked.w.document.body.textContent, /Measurement login popup blocked/);
});
