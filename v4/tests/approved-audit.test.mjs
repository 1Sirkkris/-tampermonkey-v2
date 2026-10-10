import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createSidelinePreflight } from '../sideline-preflight.mjs';
import { createIssConsole } from '../iss-runtime.mjs';
import { createNativeOperationTap } from '../native-operation-tap.mjs';
import { createRiverCapture } from '../river-fcr.mjs';
import { riverUrl } from '../river-capture.mjs';
import { paoExpiration } from '../date-picker.mjs';
const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
function windowFor(t, url = 'https://aft-poirot-website-nrt.nrt.proxy.amazon.com/') {
  const w = new JSDOM('<head></head><body><main>Native</main></body>', { url, runScripts: 'outside-only' }).window;
  t.after(() => w.close());
  w.navigator.locks = { request: async (name, options, fn) => fn({ name }) };
  return w;
}

test('Sideline Hazmat consumes nested exact result and separates allowed, restricted and unknown decisions', async t => {
  const w = windowFor(t), ctx = { hazmat: true, asin: 'B012345678' };
  for (const [message, expected] of [['The ASIN can be processed by this FC', 'green'], ['The ASIN cannot be processed by this FC', 'red'], ['Native decision unavailable', 'retry']]) {
    const preflight = createSidelinePreflight({ window: w, client: { item: async () => ({ kind: 'green', ctx }), bootstrap: async () => ({ warehouse: 'BWU2' }) },
      gmRequest: request => { request.onload({ status: 200, responseText: JSON.stringify(request.method === 'POST' ? { rows: [{ asin: ctx.asin, level: 1, message }] } : { restriction: 'AU' }) }); return {}; } });
    const result = await preflight('tsXsource', 'X012345678'); assert.equal(result.kind, expected); assert(!result.reason.includes('undefined'));
  }
  let external = 0;
  const blocked = createSidelinePreflight({ window: w, client: { item: async () => ({ kind: 'red', reason: 'UNDER_REVIEW', ctx }) }, gmRequest: () => { external++; } });
  assert.equal((await blocked('tsXsource', 'X012345678')).reason, 'UNDER_REVIEW'); assert.equal(external, 0);
});

test('ISS idle Clear and second Stop clear each area once without recursion or discarding UNKNOWN', async t => {
  const w = windowFor(t, 'https://fcresearch-fe.aka.amazon.com/BWU2/results#iss-console'), controls = [];
  const ui = createIssConsole({ window: w, version: 'test', bridgeFactory: () => ({ control: (kind, action, data) => controls.push([action, data.area]), dispose() {} }) });
  t.after(ui.dispose);
  for (const area of ['edit', 'move', 'sideline']) {
    const panel = ui.root.querySelector('[data-panel=' + area + ']'); panel.querySelector('textarea').value = 'saved';
    await ui.clear(area); assert.equal(panel.querySelector('textarea').value, '');
    panel.querySelector('textarea').value = 'saved'; ui.stop(area); await tick();
    assert.equal(panel.querySelector('textarea').value, '');
    assert.equal(controls.filter(([action, target]) => action === 'clear' && target === area).length, 2);
  }
});

test('ISS Clear waits for submitted native settlement and preserves an UNKNOWN handoff', async t => {
  const w = windowFor(t, 'https://fcresearch-fe.aka.amazon.com/BWU2/results#iss-console');
  let settle, calls = 0;
  const ui = createIssConsole({ window: w, version: 'test', bridgeFactory: () => ({ ready: async () => {}, run: () => { calls++; return new Promise(resolve => settle = resolve); }, control() {}, dispose() {} }) });
  t.after(ui.dispose); ui.root.querySelector('[data-panel=edit] textarea').value = 'X012345678';
  const running = ui.run('edit'); await tick(); const clearing = ui.clear('edit');
  assert.equal(ui.getRows('edit')[0].state, 'SUBMITTED');
  settle({ outcome: 'UNKNOWN', rows: [] }); await running; await clearing;
  assert.equal(ui.getRows('edit')[0].state, 'UNKNOWN'); assert.equal(calls, 1);
});

test('ISS second Stop waits for the active submission and then clears only safe rows once', async t => {
  const w = windowFor(t, 'https://fcresearch-fe.aka.amazon.com/BWU2/results#iss-console'), controls = [];
  let settle;
  const ui = createIssConsole({ window: w, version: 'test', bridgeFactory: () => ({ ready: async () => {}, run: () => new Promise(resolve => settle = resolve), control: (kind, action) => controls.push(action), dispose() {} }) });
  t.after(ui.dispose); ui.root.querySelector('[data-panel=edit] textarea').value = 'X012345678';
  const running = ui.run('edit'); await tick(); ui.stop('edit'); ui.stop('edit');
  assert.equal(controls.includes('clear'), false); assert.equal(ui.getRows('edit')[0].state, 'SUBMITTED');
  settle({ outcome: 'REJECTED', rows: [] }); await running; await tick();
  assert.equal(ui.getRows('edit').length, 0); assert.equal(controls.filter(action => action === 'clear').length, 1);
});

test('Sideline native barrier coexists with actual generated OBS in either install order and rejects a replaced hook', async t => {
  for (const obsFirst of [true, false]) {
    const w = windowFor(t), store = new Map(), native = function () { return Promise.resolve(new Response('{}')); };
    w.unsafeWindow = w; w.fetch = native;
    w.GM_getValue = (key, fallback) => store.get(key) ?? fallback; w.GM_setValue = (key, value) => store.set(key, value);
    w.GM_listValues = () => [...store.keys()]; w.GM_deleteValue = key => store.delete(key); w.GM_addValueChangeListener = () => 1; w.GM_removeValueChangeListener = () => {};
    const source = readFileSync(new URL('../OBS.user.js', import.meta.url), 'utf8');
    const obs = () => { w.eval(source); w.document.dispatchEvent(new w.Event('DOMContentLoaded')); };
    if (obsFirst) obs();
    let submissions = 0;
    const tap = createNativeOperationTap({ window: w, paths: ['/api/move-items'], onBefore: () => { submissions++; return null; }, onResult() {} });
    if (!obsFirst) obs();
    assert.equal(tap.owns(), true);
    await w.fetch('/api/move-items', { method: 'POST', body: '{}' }); assert.equal(submissions, 1);
    const cooperating = w.fetch; w.fetch = native; assert.equal(tap.owns(), false); w.fetch = cooperating;
    tap.dispose(); w.dispatchEvent(new w.Event('pagehide')); assert.equal(tap.owns(), false);
    w.dispatchEvent(new w.PageTransitionEvent('pageshow', { persisted: true }));
    const restored = createNativeOperationTap({ window: w, paths: [], onBefore() {}, onResult() {} });
    assert.equal(restored.owns(), true); restored.dispose(); w.dispatchEvent(new w.Event('pagehide'));
  }
});

test('RIVER reuses one control through Master hydration and owns an explicit Australia handoff', async t => {
  const w = windowFor(t, 'https://fcresearch-fe.aka.amazon.com/BWU2/results?s=B012345678');
  w.document.body.innerHTML = '<div id="results-content"><div data-section-type="product"><table id="table-product"></table></div></div>';
  const opened = [], stored = [], helper = createRiverCapture({ window: w, warehouse: 'BWU2', version: 'test', setValue: (...value) => stored.push(value), open: url => opened.push(url),
    reader: { product: async () => ({ complete: true, html: '', product: { asin: 'B012345678', fnsku: 'X012345678', title: 'Exact', aliases: ['B012345678'] } }), section: async () => { throw new Error('PO unavailable'); } } });
  t.after(helper.dispose); await tick(); const first = w.document.querySelector('.tm-v4-river-capture');
  const badge = w.document.createElement('button'); badge.dataset.tmV4Badge = 'hazmat'; w.document.querySelector('[data-section-type=product]').append(badge); await tick();
  assert.equal(w.document.querySelectorAll('.tm-v4-river-capture').length, 1); assert.equal(badge.nextElementSibling, first);
  const event = new w.CustomEvent('tampermonkey-v4:river-handoff', { cancelable: true, detail: JSON.stringify({ warehouse: 'BWU2', query: 'B012345678' }) });
  assert.equal(w.document.dispatchEvent(event), false); assert.deepEqual(opened, [riverUrl('BWU2')]); assert(stored.length >= 1);
  const wrong = new w.CustomEvent('tampermonkey-v4:river-handoff', { cancelable: true, detail: JSON.stringify({ warehouse: 'BWU2', query: 'B099999999' }) });
  assert.equal(w.document.dispatchEvent(wrong), true); assert.equal(opened.length, 1);
});

test('PAO uses the current local calendar date plus 900 days: 11 October 2026 becomes 29 March 2029', () => {
  const date = new Date(paoExpiration(new Date(2026, 9, 11, 19, 45)));
  assert.deepEqual([date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours()], [2029, 3, 29, 0]);
});
