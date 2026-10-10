import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createSidelineUi } from '../sideline-runtime.mjs';
import { resolveSidelineItem } from '../sideline-client.mjs';
import { createDatePicker } from '../date-picker.mjs';
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0)); };
function setup(t) {
  const window = new JSDOM('<head></head><body><main>Native source page</main></body>', { url: 'https://aft-poirot-website-nrt.nrt.proxy.amazon.com/' }).window;
  Object.defineProperty(window.navigator, 'locks', { value: { request: async (name, options, fn) => fn({ name }) } });
  window.localStorage.setItem('tm-v4.sideline.settings', JSON.stringify({ delay: false }));
  t.after(() => window.close());
  return window;
}
function item(dateType) {
  return resolveSidelineItem({ '@type': 'ScanItemResponse', success: true, items: [{ scannableId: 'X000000001', quantity: 3, skuDetail: { asin: 'B000000001', fnSku: 'X000000001', fcSku: 'FC00000001', datelotDetail: { expirationPromptType: dateType } } }] }, 'X000000001');
}
async function choosePreflightDate(window, ui) {
  ui.fields.source.value = 'tsXsourceA';
  ui.fields.destination.value = 'tsXdestination';
  ui.fields.items.value = 'X000000001';
  ui.fields.items.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await tick();
  const dialog = window.document.querySelector('#tm-v4-date-picker');
  assert(dialog, 'authoritative EXPIRATION_DATE scan should open the picker');
  dialog.querySelector('[data-month="12"]').click();
  dialog.querySelector('[data-year="' + (new Date().getFullYear() + 2) + '"]').click();
  await tick();
  assert.equal(window.document.querySelector('#tm-v4-date-picker'), null);
}
function uiFor(t, window, preflight) {
  const moves = [];
  const ui = createSidelineUi({ window, version: '0.1.3', preflight, client: {
    bootstrap: async () => ({ warehouse: 'BWU2' }), source: async () => ({ processPath: 'NORMAL' }),
    move: async (data, options) => { moves.push(data); options.beforeMutation('offline-' + moves.length); return { outcome: 'CONFIRMED' }; }
  } });
  t.after(() => ui.dispose());
  return { ui, moves };
}
test('source rescan must not reuse another source batch expiry answer', async t => {
  const window = setup(t), { ui, moves } = uiFor(t, window, async () => item('EXPIRATION_DATE'));
  await choosePreflightDate(window, ui);
  ui.fields.source.value = 'tsXsourceB';
  ui.fields.source.dispatchEvent(new window.Event('input', { bubbles: true }));
  const pending = ui.run('lazy');
  await tick();
  const submitted = moves.length;
  const prompted = !!window.document.querySelector('#tm-v4-date-picker');
  ui.workflow.stop();
  await pending;
  assert.equal(submitted, 0, 'new-source expiry must be reviewed before movement; observed ' + submitted + ' offline movement call');
  assert.equal(prompted, true, 'new source batch needs a correctly scoped date answer');
});
test('fresh NONE requirement must not receive a leftover expiry from another source', async t => {
  const window = setup(t), { ui, moves } = uiFor(t, window, async source => item(source === 'tsXsourceA' ? 'EXPIRATION_DATE' : 'NONE'));
  await choosePreflightDate(window, ui);
  ui.fields.source.value = 'tsXsourceB';
  ui.fields.source.dispatchEvent(new window.Event('input', { bubbles: true }));
  await ui.run('lazy');
  assert.equal(moves.length, 1);
  assert.equal(moves[0].expiration, null, 'native NONE requirement must not inherit an old-source date');
});
test('expiry modal must be above the owned Sideline panels', async t => {
  const window = setup(t), { ui } = uiFor(t, window, async () => item('NONE'));
  const picker = createDatePicker(window);
  t.after(() => picker.dispose());
  const pending = picker.pick({ code: 'X000000001', ctx: item('EXPIRATION_DATE').ctx });
  const dialog = window.document.querySelector('#tm-v4-date-picker');
  const dialogZ = Number(window.getComputedStyle(dialog).zIndex);
  const panelZ = Number(window.getComputedStyle(window.document.querySelector('#tm-v4-side-lazy')).zIndex);
  picker.dispose();
  await pending;
  assert(dialogZ > panelZ, 'modal z-index ' + dialogZ + ' is below the panel ' + panelZ);
});

test('same source and requirement reuse one answer for repeated physical scans', async t => {
  const window = setup(t), { ui, moves } = uiFor(t, window, async () => item('EXPIRATION_DATE'));
  await choosePreflightDate(window, ui);
  ui.fields.items.value += '\nX000000001';
  ui.fields.items.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await tick();
  assert.equal(window.document.querySelector('#tm-v4-date-picker'), null);
  await ui.run('lazy');
  assert.equal(moves.length, 1);
  assert.equal(moves[0].quantity, 2);
  assert(Number.isFinite(moves[0].expiration));
});

import { readFileSync } from 'node:fs';
test('actual generated Sideline scanner START cannot submit with another source expiry', async t => {
  const dom = new JSDOM('<head></head><body><main>Native source page</main></body>', { url: 'https://aft-poirot-website-nrt.nrt.proxy.amazon.com/', runScripts: 'outside-only' });
  const window = dom.window;
  t.after(() => window.close());
  window.localStorage.setItem('tm-v4.sideline.settings', JSON.stringify({ delay: false }));
  window.unsafeWindow = window; window.employeeLogin = 'validuser';
  window.navigator.locks = { request: async (name, options, fn) => fn({ name }) };
  let moves = 0;
  window.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    let data;
    if (path === '/api/get-bootstrap-data') data = { warehouseInfo: 'BWU2' };
    else if (path === '/api/scan-source-container') data = { '@type': 'ScanSourceContainerResponse', success: true, processPath: 'NORMAL' };
    else if (path === '/api/scanitem') data = { '@type': 'ScanItemResponse', success: true, items: item('EXPIRATION_DATE').ctx.records };
    else { assert.equal(path, '/api/move-items'); moves++; data = { '@type': 'MoveItemsResponse', success: true }; }
    return { ok: true, status: 200, url, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(data) };
  };
  window.GM_xmlhttpRequest = () => { throw new Error('No external reads expected'); };
  window.eval(readFileSync(new URL('../Sideline_Queue_Lazy.user.js', import.meta.url), 'utf8'));
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await tick();
  t.after(() => window.dispatchEvent(new window.Event('pagehide')));
  const panel = window.document.querySelector('#tm-v4-side-lazy');
  const fields = Object.fromEntries([...panel.querySelectorAll('[data-field]')].map(node => [node.dataset.field, node]));
  await choosePreflightDate(window, { fields });
  fields.source.value = 'tsXsourceB';
  fields.source.dispatchEvent(new window.Event('input', { bubbles: true }));
  fields.items.value += '\n123START';
  fields.items.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await tick();
  const count = moves;
  const prompted = !!window.document.querySelector('#tm-v4-date-picker');
  panel.querySelector('[data-action=stop]').click();
  await tick();
  assert.equal(count, 0, 'generated native client submitted after source rescan with a stale date');
  assert(prompted);
});

test('changing source or removing the prompted item cancels the active preflight date immediately', async t => {
  const window = setup(t), { ui } = uiFor(t, window, async () => item('EXPIRATION_DATE'));
  ui.fields.source.value = 'tsXsourceA'; ui.fields.destination.value = 'tsXdestination'; ui.fields.items.value = 'X000000001';
  const scan = () => ui.fields.items.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  scan(); await tick(); assert(window.document.querySelector('#tm-v4-date-picker'));
  ui.fields.source.value = 'tsXsourceB'; ui.fields.source.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(window.document.querySelector('#tm-v4-date-picker'), null);
  scan(); await tick(); assert(window.document.querySelector('#tm-v4-date-picker'));
  ui.fields.items.value = ''; ui.fields.items.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick(); assert.equal(window.document.querySelector('#tm-v4-date-picker'), null);
});

test('a changed authoritative prompt for the same source/item requires a fresh answer', async t => {
  let requirement = 'EXPIRATION_DATE';
  const window = setup(t), { ui, moves } = uiFor(t, window, async () => item(requirement));
  await choosePreflightDate(window, ui); requirement = 'PRODUCTION_DATE';
  ui.fields.source.dispatchEvent(new window.Event('input', { bubbles: true }));
  const pending = ui.run('lazy'); await tick();
  assert.equal(moves.length, 0); assert.match(window.document.querySelector('#tm-v4-date-picker').textContent, /REQUIRES PRODUCTION DATE/);
  ui.workflow.stop(); await pending;
});

test('an UNKNOWN preflight result cannot prevent a deliberate same-item scanner recheck', async t => {
  let reads = 0;
  const window = setup(t), { ui } = uiFor(t, window, async () => ++reads === 1 ? { kind: 'retry', reason: 'Hazmat UNKNOWN' } : item('NONE'));
  ui.fields.source.value = 'tsXsourceA'; ui.fields.destination.value = 'tsXdestination'; ui.fields.items.value = 'X000000001';
  const scan = () => ui.fields.items.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  scan(); await tick(); assert.equal(reads, 1); assert.match(window.document.querySelector('[data-preflight]').textContent, /UNKNOWN/);
  scan(); await tick(); assert.equal(reads, 2); assert.match(window.document.querySelector('[data-preflight]').textContent, /GOOD/);
});
