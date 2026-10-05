import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createMasterActions, cleanProductSelection, printmonUrl, printableCode } from '../master-actions.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const metadata = { asin: 'B012345678', fnsku: 'X012345678', aliases: ['B012345678', 'X012345678'], title: 'Correct title' };
const markup = '<div data-section-type="product"><table><tr><th>ASIN</th><td><a href="?s=B012345678">B012345678</a></td></tr><tr><th>FNSKU</th><td>X012345678</td></tr><tr><th>Title</th><td>Correct title</td></tr><tr><th>Weight</th><td>2 kg</td></tr></table></div>';
function setup(t, options = {}) {
  const dom = new JSDOM(markup, { url: 'https://fcresearch-fe.aka.amazon.com/BWU2/results?s=B012345678' }); const w = dom.window;
  const controller = new w.AbortController(), gen = { controller, sections: new Map([['product', { result: { product: metadata } }]]) };
  const calls = [], evidence = [], messages = [], reads = []; let current = gen;
  const runtime = { current: () => current, active: value => value === current && !controller.signal.aborted,
    mark: node => { node.setAttribute('data-tm-v4-master', ''); return node; }, notify: value => messages.push(value),
    reader: { product: async (code, settings) => { reads.push({ code, ...settings }); return options.product ? options.product(code, settings) : { product: { title: 'Fresh exact title' } }; } } };
  const fetch = async (url, settings) => { calls.push({ url, ...settings }); return options.fetch ? options.fetch(url, settings) : { ok: true, status: 200 }; };
  const actions = createMasterActions({ window: w, runtime, fetch, onEvidence: event => evidence.push(event), uuid: () => 'id' + evidence.length, timeoutMs: options.timeoutMs || 15000 });
  actions.refresh(); t.after(() => { actions.dispose(); w.close(); });
  return { w, actions, runtime, gen, calls, evidence, messages, reads, reset: () => { current = null; controller.abort(); actions.reset(); } };
}
const decode = value => value.match(/.{2}/g)?.map(byte => String.fromCharCode(parseInt(byte, 16))).join('') || '';

test('Printmon native fields, exact barcode/title hex, quantity and numeric sequence are preserved', () => {
  const url = new URL(printmonUrl({ code: 'X012345678', quantity: 1234, description: 'Exact title', badge: '17&22', sequence: 123 }));
  assert.equal(url.origin, 'http://localhost:5965'); assert.equal(url.pathname, '/printer');
  assert.equal(url.searchParams.get('action'), 'print'); assert.equal(url.searchParams.get('type'), 'barcode');
  assert.equal(decode(url.searchParams.get('data')), 'X012345678'); assert.equal(url.searchParams.get('text'), url.searchParams.get('data'));
  assert.equal(decode(url.searchParams.get('desc')), 'Exact title'); assert.equal(url.searchParams.get('quantity'), '1234'); assert.equal(url.searchParams.get('badgeid'), '17&22');
  for (const quantity of [0, -1, 10000, 1.5]) assert.throws(() => printmonUrl({ code: 'B012345678', quantity, sequence: 1 }));
  assert.equal(printableCode('LPN12-345678'), 'LPN12-345678'); assert.equal(printableCode('FBAabcdefgh'), 'FBAabcdefgh');
});

test('native product label click/keyboard and four-digit editable quantities submit exactly once each', async t => {
  const app = setup(t); const labels = [...app.w.document.querySelectorAll('th')];
  labels[0].click(); await tick();
  labels[1].dispatchEvent(new app.w.KeyboardEvent('keydown', { key: ' ', bubbles: true })); await tick();
  const qty = app.w.document.querySelector('[data-tm-v4-quantity="FNSKU"]'); qty.value = '1234';
  qty.dispatchEvent(new app.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await tick();
  assert.equal(app.calls.length, 3); assert.equal(new URL(app.calls[2].url).searchParams.get('quantity'), '1234'); assert.equal(app.reads.length, 0);
  qty.value = '0'; qty.dispatchEvent(new app.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); assert.equal(app.calls.length, 3);
  qty.value = 'a12345'; qty.dispatchEvent(new app.w.Event('input', { bubbles: true })); assert.equal(qty.value, '1234');
  app.actions.refresh(); assert.equal(app.w.document.querySelectorAll('[data-tm-v4-quantity]').length, 2);
});

test('ordinary label/Alt print descriptions are bound to their exact product or native row, never the preceding panel', async t => {
  const app = setup(t); const section = app.w.document.createElement('div'); section.dataset.sectionType = 'inventory';
  section.innerHTML = '<table id="table-inventory"><thead><tr><th>ASIN</th><th>Title</th></tr></thead><tbody><tr><td><a>B099999999</a></td><td>Row title</td></tr></tbody></table>'; app.w.document.body.append(section);
  section.querySelector('a').dispatchEvent(new app.w.MouseEvent('click', { altKey: true, bubbles: true })); await tick();
  assert.equal(decode(new URL(app.calls[0].url).searchParams.get('desc')), 'Row title'); assert.equal(app.reads.length, 0);
  await app.actions.print('B088888888'); assert.equal(app.reads[0].code, 'B088888888'); assert.equal(decode(new URL(app.calls[1].url).searchParams.get('desc')), 'Fresh exact title');
  const fallback = setup(t, { product: async () => { throw new Error('No exact title'); } }); await fallback.actions.print('B099999999');
  assert.equal(new URL(fallback.calls[0].url).searchParams.get('desc'), ''); assert(!fallback.calls[0].url.includes('Correct title'));
});

test('LPN printing requires explicit confirmation and preserves its complete code', async t => {
  const app = setup(t); let confirms = 0; app.w.confirm = () => { confirms++; return false; };
  await app.actions.print('LPN12-345678'); assert.equal(app.calls.length, 0);
  app.w.confirm = () => { confirms++; return true; }; await app.actions.print('LPN12-345678');
  assert.equal(confirms, 2); assert.equal(decode(new URL(app.calls[0].url).searchParams.get('data')), 'LPN12-345678'); assert.equal(app.reads.length, 0);
});

test('HTTP success cannot invent printer confirmation; uncertain/error actions are never automatically repeated', async t => {
  const app = setup(t); await app.actions.print('X012345678', 2);
  assert.deepEqual(app.evidence.map(event => event.phase), ['SUBMITTED', 'UNKNOWN']); assert.equal(app.evidence[1].data.outcome, 'response-received');
  assert.equal(app.evidence[0].operationId, app.evidence[1].operationId); assert.match(app.messages[0], /unverified/); assert.equal(app.calls.length, 1);
  const failure = setup(t, { fetch: async () => { throw new Error('Lost connection'); } }); await failure.actions.print('X012345678');
  await tick(); assert.equal(failure.calls.length, 1); assert.equal(failure.evidence.at(-1).phase, 'UNKNOWN'); assert.match(failure.messages.at(-1), /check the printer/);
});

test('printer disposal and bounded timeout emit one UNKNOWN and ignore late responses', async t => {
  let reply;
  const app = setup(t, { fetch: () => new Promise(resolve => { reply = resolve; }) });
  const pending = app.actions.print('X012345678'); await tick(); app.actions.dispose();
  assert.equal(app.calls[0].signal.aborted, true); assert.deepEqual(app.evidence.map(event => event.phase), ['SUBMITTED', 'UNKNOWN']);
  reply({ ok: true, status: 200 }); await pending; assert.equal(app.evidence.length, 2);
  const timed = setup(t, { fetch: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })), timeoutMs: 5 });
  await timed.actions.print('X012345678'); assert.equal(timed.calls.length, 1); assert.equal(timed.evidence.at(-1).data.outcome, 'timeout');
});

test('a cancelled exact-title read cannot submit a later label after a new query', async t => {
  let reply;
  const app = setup(t, { product: () => new Promise(resolve => { reply = resolve; }) });
  const pending = app.actions.print('B099999999'); app.reset(); reply({ product: { title: 'Late title' } }); await pending;
  assert.equal(app.calls.length, 0); assert.equal(app.evidence.length, 0); assert.equal(app.reads[0].signal.aborted, true);
});

test('copy strips injected controls while preserving native selected rows, links and clean partial Title selection', t => {
  const app = setup(t); const table = app.w.document.querySelector('table'), selection = app.w.getSelection();
  const badge = app.w.document.createElement('button'); badge.setAttribute('data-tm-v4-master', ''); badge.textContent = 'Madcat: YES'; table.rows[0].cells[1].append(badge);
  let range = app.w.document.createRange(); range.selectNodeContents(table.rows[0]); selection.addRange(range);
  const output = cleanProductSelection({ document: app.w.document, selection, table });
  assert.match(output.text, /ASIN.*B012345678/); assert(!output.text.includes('Madcat')); assert(!output.html.includes('data-tm-v4')); assert.match(output.html, /href="https:\/\//);
  selection.removeAllRanges(); range = app.w.document.createRange(); range.selectNodeContents(badge); selection.addRange(range);
  assert.deepEqual(cleanProductSelection({ document: app.w.document, selection, table }), { text: '', html: '' });
  selection.removeAllRanges(); range = app.w.document.createRange(); range.setStart(table.rows[2].cells[1].firstChild, 0); range.setEnd(table.rows[2].cells[1].firstChild, 7); selection.addRange(range);
  assert.equal(cleanProductSelection({ document: app.w.document, selection, table }), null); assert.equal(selection.toString(), 'Correct');
});

test('Firefox-style multiple cell ranges clean each selected native value independently', t => {
  const app = setup(t); const table = app.w.document.querySelector('table'); const ranges = [];
  for (const row of [table.rows[0], table.rows[1]]) { const range = app.w.document.createRange(); range.selectNodeContents(row.cells[1]); ranges.push(range); }
  const selection = { isCollapsed: false, rangeCount: 2, getRangeAt: index => ranges[index] };
  const output = cleanProductSelection({ document: app.w.document, selection, table });
  assert.equal(output.text, 'B012345678\nX012345678'); assert(!output.html.includes('data-tm-v4'));
});

test('Weight retains the ISS route entry; cleanup restores native label attributes and removes owned inputs/listeners', t => {
  const app = setup(t); const labels = app.w.document.querySelectorAll('th');
  labels[3].dispatchEvent(new app.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); assert.equal(app.w.location.hash, '#iss-console');
  app.actions.dispose(); assert.equal(app.w.document.querySelectorAll('[data-tm-v4-master]').length, 0);
  assert.equal(labels[0].hasAttribute('role'), false); assert.equal(labels[0].hasAttribute('tabindex'), false); labels[0].click(); assert.equal(app.calls.length, 0);
});
