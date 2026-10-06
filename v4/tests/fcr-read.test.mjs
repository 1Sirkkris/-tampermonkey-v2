import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createFcrReader, FcrReadError, FCR_SECTIONS } from '../fcr-read.mjs';

const origin = 'https://fcresearch-fe.aka.amazon.com';
const labels = ['Container', 'ASIN', 'FNSKU', 'FCSKU', 'LPN', 'Quantity', 'Disposition', 'Consumer', 'Consumer ID', 'Outer Location', 'Outer Location Type', 'Title'];
const values = ['tsX111', 'B012345678', 'X012345678', 'FC12345678', 'LPN123', '2', 'SELLABLE', 'STOW', 'employee-id', 'P-1-A001', 'BIN', 'Correct product'];
const token = value => '<div class="pagination-token">' + value.replaceAll('&', '&amp;').replaceAll('<', '&lt;') + '</div>';
const row = (data = values) => '<tr>' + data.map(value => '<td>' + value + '</td>').join('') + '</tr>';
function inventory({ rows = [values], total = 2, next = '', order = labels.map((_, i) => i), headers = true, id = 'table-inventory' } = {}) {
  return '<table' + (id ? ' id="' + id + '"' : '') + '>' + (headers ? '<thead><tr>' + order.map(i => '<th id="inventory-' + labels[i].toLowerCase().replaceAll(' ', '-') + '">' + labels[i] + (i === 5 && total !== null ? ' (' + total + ')' : '') + '</th>').join('') + '</tr></thead>' : '') +
    '<tbody>' + rows.map(data => row(order.map(i => data[i]))).join('') + '</tbody></table>' + (next ? token(next) : '');
}
function product({ asin = 'B012345678', fnsku = 'X012345678', title = 'Correct product', other = '' } = {}) {
  return other + '<div data-section-type="product"><img src="/correct.jpg"><table class="a-keyvalue">' +
    Object.entries({ ASIN: asin, FNSKU: fnsku, FCSKU: 'FC12345678', Title: title, Sortable: 'Yes', Dimensions: '1 x 2 x 3', Weight: '1 kg' })
      .map(([key, value]) => '<tr><th>' + key + '</th><td>' + value + '</td></tr>').join('') + '</table></div>';
}
function history(rows, next = '') {
  return '<table id="table-inventory-history"><thead><tr><th>Time</th><th>Action</th></tr></thead><tbody>' + rows.map(row).join('') + '</tbody></table>' + (next ? token(next) : '');
}

function fixture(t, responses = [], options = {}) {
  const dom = new JSDOM(); t.after(() => dom.window.close());
  const calls = [], evidence = [];
  const fetch = async (url, init) => {
    calls.push({ url, ...init });
    assert(responses.length, 'Unexpected FCR request');
    const response = responses.shift();
    if (response instanceof Error) throw response;
    if (typeof response === 'function') return response(url, init);
    return typeof response === 'string' ? new Response(response, { status: 200 }) : response;
  };
  const reader = createFcrReader({ origin, warehouse: 'BWU2', DOMParser: dom.window.DOMParser, fetch,
    onEvidence: detail => evidence.push(detail), retryDelays: [], ...options });
  return { reader, calls, evidence, dom };
}
const rejectsCode = async (promise, code) => assert.rejects(promise, error => error instanceof FcrReadError && error.code === code);

test('constructing native reads causes no traffic and rejects an arbitrary origin/warehouse', t => {
  const app = fixture(t);
  assert.equal(app.calls.length, 0);
  assert.throws(() => createFcrReader({ origin: 'https://example.com', warehouse: 'BWU2' }), { code: 'INPUT' });
  assert.throws(() => createFcrReader({ origin, warehouse: '../BWU2' }), { code: 'INPUT' });
  assert.equal(FCR_SECTIONS.length, 19);
});

test('product aliases, title and scoped image are exact, with native POST fields and optional read evidence', async t => {
  const app = fixture(t, [product({ other: '<img src="/wrong.jpg"><table><tr><th>ASIN</th><td>B099999999</td></tr><tr><th>Title</th><td>Wrong title</td></tr></table>' })]);
  const result = await app.reader.product(' x012345678 ');
  assert.equal(result.product.title, 'Correct product'); assert.equal(result.product.img, '/correct.jpg');
  assert.deepEqual(result.product.aliases, ['B012345678', 'X012345678', 'FC12345678']);
  assert.equal(result.product.sortable, true);
  assert.equal(app.calls[0].url, origin + '/BWU2/results/product');
  assert.equal(app.calls[0].method, 'POST'); assert.equal(app.calls[0].credentials, 'same-origin');
  assert.equal(app.calls[0].body, 's=x012345678');
  assert(app.evidence.every(event => event.intent === 'read' && !event.phase && !event.operationId));
  assert(!JSON.stringify(app.evidence).includes('X012345678'));
});

test('product substring/wrong identity and absent native schema never seed an exact result', async t => {
  const app = fixture(t, [product(), '<html><body>unrelated response</body></html>']);
  await rejectsCode(app.reader.product('012345678'), 'IDENTITY');
  await rejectsCode(app.reader.product('X012345678'), 'SCHEMA');
});

test('contradictory exact product records are unresolved rather than taking the first title', async t => {
  const app = fixture(t, [product() + product({ title: 'Conflicting title' })]);
  await rejectsCode(app.reader.product('X012345678'), 'IDENTITY');
});

test('inventory preserves all twelve fields when native columns are reordered', async t => {
  const app = fixture(t, [inventory({ order: [5, 2, 0, 3, 1, 4, 11, 6, 7, 8, 9, 10] })]);
  const result = await app.reader.inventory('tsX111');
  assert.equal(result.complete, true); assert.equal(result.totalQuantity, 2);
  assert.deepEqual(result.rows[0], { container: 'tsX111', asin: 'B012345678', fnsku: 'X012345678', fcsku: 'FC12345678',
    lpn: 'LPN123', qty: 2, disposition: 'SELLABLE', consumer: 'STOW', consumerId: 'employee-id', outerLocation: 'P-1-A001', outerLocationType: 'BIN', title: 'Correct product' });
});

test('a fresh preview precedes validated continuation and repeated SKU rows remain separate', async t => {
  const second = [...values]; second[0] = 'tsX222'; second[5] = '3'; second[6] = 'DAMAGED';
  const app = fixture(t, [inventory({ total: 5, next: '{"cursor":"page2"}' }), inventory({ rows: [second], headers: false, id: '' })]);
  const previews = [];
  const result = await app.reader.inventory('X012345678', { onPreview: value => previews.push(value) });
  assert.equal(previews.length, 1); assert.equal(previews[0].complete, false); assert.equal(previews[0].totalQuantity, null);
  assert.equal(previews[0].records, 1); assert.equal(result.pages, 2); assert.equal(result.records, 2);
  assert.equal(result.totalQuantity, 5); assert.equal(result.rows[1].disposition, 'DAMAGED');
  assert.equal(app.calls[1].url, origin + '/BWU2/results/inventory-more');
  assert.deepEqual([...new URLSearchParams(app.calls[1].body)], [['token', '{"cursor":"page2"}']]);
  assert(!result.html.includes('pagination-token'));
  const fresh = fixture(t, [inventory()]); await fresh.reader.inventory('tsX111');
  assert.equal(fresh.calls.length, 1);
});

test('inventory continuation row fragments are retained with the first page schema', async t => {
  const app = fixture(t, [inventory({ total: 4, next: '{"page":2}' }), row()]);
  const result = await app.reader.inventory('tsX111');
  assert.equal(result.totalQuantity, 4); assert.equal(result.records, 2); assert.equal(result.complete, true);
});

test('a generic history section cannot assert completeness from an absent continuation marker', async t => {
  const app = fixture(t, [history([['time', 'action']])]);
  const result = await app.reader.section('inventory-history', 'X012345678');
  assert.equal(result.complete, false); assert.match(result.warning, /not been validated/);
});

test('native empty inventory is valid, while missing body/schema and arbitrary rows are rejected', async t => {
  const app = fixture(t, [inventory({ rows: [], total: 0 }), '<table id="table-inventory"><thead><tr><th>Container</th><th>Quantity</th></tr></thead></table>',
    inventory().replace('<tbody>', '<tbody><tr><td colspan="12">Please sign in</td></tr>')]);
  const empty = await app.reader.inventory('tsXempty'); assert.equal(empty.totalQuantity, 0); assert.equal(empty.complete, true);
  await rejectsCode(app.reader.inventory('tsXbad'), 'SCHEMA');
  await rejectsCode(app.reader.inventory('tsXbad'), 'SCHEMA');
});

test('native DataTables empty markers do not become item rows', async t => {
  const html = inventory({ rows: [], total: 0 }).replace('<tbody>', '<tbody><tr><td class="dataTables_empty" colspan="12">No data available</td></tr>');
  const app = fixture(t, [html]);
  const result = await app.reader.inventory('tsXempty'); assert.deepEqual(result.rows, []); assert.equal(result.complete, true);
});

test('invalid quantity or missing item identity fails; comma quantities are validated integers', async t => {
  for (const bad of ['-1', '2pcs', '', '1.5', '1,23']) {
    const data = [...values]; data[5] = bad;
    const app = fixture(t, [inventory({ rows: [data], total: null })]);
    await rejectsCode(app.reader.inventory('tsX111'), 'SCHEMA');
  }
  const noItem = [...values]; noItem[1] = noItem[2] = noItem[3] = '';
  await rejectsCode(fixture(t, [inventory({ rows: [noItem] })]).reader.inventory('tsX111'), 'IDENTITY');
  const big = [...values]; big[5] = '1,234';
  assert.equal((await fixture(t, [inventory({ rows: [big], total: 1234 })]).reader.inventory('tsX111')).totalQuantity, 1234);
});

test('captured native true terminal marker ends pagination but conflicting markers stay incomplete', async t => {
  const app = fixture(t, [inventory({ next: 'true' })]);
  const result = await app.reader.inventory('tsX111');
  assert.equal(result.complete, true); assert.equal(result.totalQuantity, 2); assert.equal(app.calls.length, 1);
  assert(!result.html.includes('pagination-token'));
  const conflicting = fixture(t, [inventory({ next: 'true' }) + token('{"page":2}')]);
  await rejectsCode(conflicting.reader.inventory('tsX111'), 'PAGINATION');
});

test('unknown/malformed tokens, continuation login/missing table and repeated token stay incomplete', async t => {
  for (const next of ['opaque-unknown', '{not-json', 'true-truncated']) {
    const app = fixture(t, [inventory({ next })]);
    await rejectsCode(app.reader.inventory('tsX111'), 'PAGINATION');
  }
  const missing = fixture(t, [inventory({ next: '{"page":2}' }), '<div>No native inventory</div>']);
  await rejectsCode(missing.reader.inventory('tsX111'), 'SCHEMA');
  const repeated = fixture(t, [inventory({ total: 4, next: '{"page":2}' }), inventory({ next: '{"page":2}', headers: false })]);
  await rejectsCode(repeated.reader.inventory('tsX111'), 'PAGINATION');
  assert.equal(repeated.calls.length, 2);
  const login = fixture(t, [inventory({ next: '{"page":2}' }), '<form><input type="password"></form>']);
  await rejectsCode(login.reader.inventory('tsX111'), 'AUTH_REQUIRED');
});

test('empty nonterminal pages, incomplete width, schema changes and arbitrary terminal tables cannot be complete', async t => {
  const first = inventory({ next: '{"page":2}' });
  for (const more of [inventory({ rows: [], next: '{"page":3}' }), '<table><tbody><tr><td>only one</td></tr></tbody></table>',
    inventory({ order: [5, 2, 0, 3, 1, 4, 11, 6, 7, 8, 9, 10] }), '<table></table>']) {
    const app = fixture(t, [first, more]);
    await assert.rejects(app.reader.inventory('tsX111'), error => ['SCHEMA', 'PAGINATION'].includes(error.code));
  }
});

test('first-page totals and page/row bounds are validated instead of guessing completeness', async t => {
  await rejectsCode(fixture(t, [inventory({ total: 99 })]).reader.inventory('tsX111'), 'TOTAL');
  const limited = fixture(t, [inventory({ next: '{"page":2}' })], { maxPages: 1 });
  await rejectsCode(limited.reader.inventory('tsX111'), 'LIMIT'); assert.equal(limited.calls.length, 1);
  const rows = fixture(t, [inventory({ rows: [values, values], total: 4 })], { maxRows: 1 });
  await rejectsCode(rows.reader.inventory('tsX111'), 'LIMIT');
});

test('explicit partial display output retains valid rows but never returns a final quantity', async t => {
  const app = fixture(t, [inventory({ next: '{"page":2}' }), new Response('failure', { status: 503 })]);
  const result = await app.reader.inventory('tsX111', { allowPartial: true });
  assert.equal(result.complete, false); assert.equal(result.totalQuantity, null); assert.equal(result.partialQuantity, 2);
  assert.equal(result.records, 1); assert.equal(result.code, 'HTTP'); assert.match(result.warning, /503/);
});

test('a caller cancellation inside preview prevents the next page and never becomes partial success', async t => {
  const controller = new AbortController(), app = fixture(t, [inventory({ next: '{"page":2}' })]);
  await rejectsCode(app.reader.inventory('tsX111', { signal: controller.signal, allowPartial: true, onPreview: () => controller.abort() }), 'CANCELLED');
  assert.equal(app.calls.length, 1);
});

test('late native response after caller cancellation is rejected without publishing product/preview data', async t => {
  const controller = new AbortController(); let resolve;
  const app = fixture(t, [() => new Promise(done => { resolve = done; })]);
  let previews = 0;
  const pending = app.reader.inventory('tsX111', { signal: controller.signal, onPreview: () => previews++ });
  controller.abort(); resolve(new Response(inventory()));
  await rejectsCode(pending, 'CANCELLED'); assert.equal(previews, 0); assert.equal(app.calls[0].signal.aborted, true);
});

test('native HTTP/auth/redirect/transport failures remain distinguishable and auth is not retried', async t => {
  const cases = [
    [new Response('', { status: 401 }), 'AUTH_REQUIRED'], [new Response('', { status: 403 }), 'AUTH_REQUIRED'],
    [{ ok: true, status: 200, url: origin + '/signin', text: async () => product() }, 'AUTH_REQUIRED'],
    [new Response('', { status: 500 }), 'HTTP'], [new Error('native network failure'), 'NETWORK']
  ];
  for (const [response, code] of cases) {
    const app = fixture(t, [response]); await rejectsCode(app.reader.product('X012345678'), code); assert.equal(app.calls.length, 1);
  }
});

test('bounded read-only 5xx retry succeeds, while cancellation interrupts its retry delay', async t => {
  const app = fixture(t, [new Response('', { status: 503 }), product()], { retryDelays: [0] });
  assert.equal((await app.reader.product('X012345678')).product.title, 'Correct product'); assert.equal(app.calls.length, 2);
  const controller = new AbortController();
  const stopped = fixture(t, [new Response('', { status: 503 })], { retryDelays: [100], onEvidence: event => {
    if (event.data.code === 'HTTP') controller.abort();
  } });
  await rejectsCode(stopped.reader.product('X012345678', { signal: controller.signal }), 'CANCELLED'); assert.equal(stopped.calls.length, 1);
});

test('request timeout aborts native transport and does not leave a retry running', async t => {
  const app = fixture(t, [(_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('native abort')), { once: true }))], { timeoutMs: 5 });
  await rejectsCode(app.reader.product('X012345678'), 'TIMEOUT'); assert.equal(app.calls[0].signal.aborted, true); assert.equal(app.calls.length, 1);
});

test('throwing OBS callback is harmless; throwing preview callback stops that consumer', async t => {
  const app = fixture(t, [product()], { onEvidence: () => { throw new Error('OBS unavailable'); } });
  assert.equal((await app.reader.product('X012345678')).complete, true);
  const failure = new Error('consumer failed'), preview = fixture(t, [inventory({ next: '{"page":2}' })]);
  await assert.rejects(preview.reader.inventory('tsX111', { allowPartial: true, onPreview: () => { throw failure; } }), error => error === failure);
  assert.equal(preview.calls.length, 1);
});

test('dated history uses native form fields and accepts validated continuation row fragments', async t => {
  const app = fixture(t, [history([['2026-10-01', 'MADCAT']], '{"page":2}'), row(['2026-10-02', 'STOW'])]);
  const result = await app.reader.history('X012345678', { startDate: '2026-10-01', endDate: '10/05/2026' });
  assert.equal(result.complete, true); assert.equal(result.records, 2); assert.equal(result.pages, 2);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(app.calls[0].body)), {
    s: 'X012345678', startSearchDateString: '10/01/2026', endSearchDateString: '10/05/2026', dateStringFormat: 'MM/dd/yyyy'
  });
  assert.equal(app.calls[1].url, origin + '/BWU2/results/inventory-history-more');
});

test('invalid dates and reversed ranges are rejected before requests; malformed history stays partial only when requested', async t => {
  const app = fixture(t);
  for (const dates of [{ startDate: '2026-02-30', endDate: '2026-10-01' }, { startDate: '2026-10-05', endDate: '2026-10-01' }]) {
    await rejectsCode(app.reader.history('X012345678', dates), 'INPUT');
  }
  assert.equal(app.calls.length, 0);
  const partial = fixture(t, [history([['time', 'action']], '{"page":2}'), '<table><tbody><tr><td>bad</td></tr></tbody></table>']);
  const result = await partial.reader.history('X012345678', { startDate: '2026-10-01', endDate: '2026-10-05', allowPartial: true });
  assert.equal(result.complete, false); assert.equal(result.code, 'SCHEMA'); assert.equal(result.records, 1);
});

test('generic section reads preserve honest partial markup without releasing native continuation; arbitrary endpoints are absent', async t => {
  const app = fixture(t, ['<div data-section-type="container-hierarchy"><table><tbody></tbody></table></div>' + token('{"page":2}')]);
  const result = await app.reader.section('container-hierarchy', 'tsX111', { allowPartial: true }); assert.equal(result.complete, false); assert.match(result.html, /container-hierarchy/);
  assert(!result.html.includes('pagination-token')); assert.equal(result.paginationComplete, false);
  await rejectsCode(app.reader.section('movecontainer', 'tsX111'), 'INPUT');
  await rejectsCode(app.reader.section('../product', 'tsX111'), 'INPUT');
  assert.equal(app.calls.length, 1);
});

test('captured generic section continuation is bounded, validates rows and owns all native follow-up reads', async t => {
  const first = '<div id="notice" class="aok-hidden">Native notice</div><table id="table-container-hierarchy"><thead><tr><th>Container</th></tr></thead><tbody><tr><td>tsX111</td></tr></tbody></table>' + token('{"page":2}');
  const last = '<div class="show-message">notice</div><table><tbody><tr><td>tsX222</td></tr></tbody></table>' + token('true');
  const app = fixture(t, [first, last]);
  const result = await app.reader.section('container-hierarchy', 'tsXparent');
  assert.equal(result.complete, false); assert.equal(result.paginationComplete, true); assert.equal(result.records, 2);
  assert.equal(app.calls[1].url, origin + '/BWU2/results/container-hierarchy-more');
  assert.equal(new URLSearchParams(app.calls[1].body).get('token'), '{"page":2}');
  assert.match(result.html, /tsX222/); assert(!result.html.includes('pagination-token')); assert(!result.html.includes('aok-hidden'));
  const partial = fixture(t, [first, '<table><tbody><tr><td>Wrong</td><td>Width</td></tr></tbody></table>']);
  const bad = await partial.reader.section('container-hierarchy', 'tsXparent', { allowPartial: true });
  assert.equal(bad.paginationComplete, false); assert.equal(bad.code, 'SCHEMA'); assert(!bad.html.includes('Wrong'));
});

test('generic native section continuation cancellation and cycles cannot escape its owner', async t => {
  const first = '<table id="table-shipment"><thead><tr><th>Shipment</th></tr></thead><tbody><tr><td>One</td></tr></tbody></table>' + token('{"page":2}');
  const loop = '<table><tbody><tr><td>Two</td></tr></tbody></table>' + token('{"page":2}');
  const app = fixture(t, [first, loop]);
  await rejectsCode(app.reader.section('shipment', 'X012345678'), 'PAGINATION'); assert.equal(app.calls.length, 2);
  const controller = new AbortController();
  const cancelled = fixture(t, [first, () => { controller.abort(); return new Response(loop); }]);
  await rejectsCode(cancelled.reader.section('shipment', 'X012345678', { signal: controller.signal, allowPartial: true }), 'CANCELLED');
  assert.equal(cancelled.calls.length, 2);
});
