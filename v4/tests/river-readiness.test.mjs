import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createRiverAssistant } from '../river-runtime.mjs';
import { renderNativeControls } from './river-rendering.mjs';

const payload = { schema: 1, asin: 'B000000001', fnsku: 'X000000001' };
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
function setup(t, markup = '<section><label>ASIN<input name="asin"></label><button id="next">Next</button></section>') {
  const dom = new JSDOM('<body><page-info label="ASIN"></page-info>' + markup, { url: 'https://river.amazon.com/BWU2/workflows' });
  const window = dom.window;
  renderNativeControls(window);
  const submitted = [];
  const helper = createRiverAssistant({ window, getPayload: () => payload, clearPayload: () => {}, onEvidence: record => submitted.push(record) });
  let clicks = 0;
  const next = window.document.querySelector('#next');
  next.addEventListener('click', () => clicks++);
  t.after(() => { helper.dispose(); window.close(); });
  return { window, helper, next, submitted, clicks: () => clicks };
}

for (const [name, markup] of [
  ['CSS display:none ancestor', '<section style="display:none"><label>ASIN<input name="asin"></label><button id="next">Next</button></section>'],
  ['inherited CSS visibility:hidden', '<section style="visibility:hidden"><label>ASIN<input name="asin"></label><button id="next">Next</button></section>'],
  ['attribute-hidden ancestor', '<section hidden><label>ASIN<input name="asin"></label><button id="next">Next</button></section>'],
]) {
  test('RIVER ignores native fields and Next under ' + name, async t => {
    const state = setup(t, markup);
    state.helper.root.querySelector('[data-run]').click();
    await settle();
    assert.equal(state.window.document.querySelector('input').value, '');
    assert.equal(state.clicks(), 0);
    assert.equal(state.submitted.some(record => record.type === 'river.step'), false);
  });
}

test('RIVER rejects a zero-area native field even when its CSS display is visible', async t => {
  const state = setup(t), field = state.window.document.querySelector('input');
  field.getBoundingClientRect = () => new state.window.DOMRect(0, 0, 0, 0);
  state.helper.root.querySelector('[data-run]').click();
  await settle();
  assert.equal(field.value, '');
  assert.equal(state.clicks(), 0);
});

test('RIVER waits for a CSS-hidden Next to render and then advances exactly once', async t => {
  const state = setup(t);
  state.next.style.display = 'none';
  state.helper.root.querySelector('[data-run]').click();
  await settle();
  assert.equal(state.window.document.querySelector('input').value, payload.asin);
  assert.equal(state.clicks(), 0);
  state.next.style.removeProperty('display');
  await settle();
  assert.equal(state.clicks(), 1);
  state.helper.root.querySelector('[data-run]').click();
  await settle();
  assert.equal(state.clicks(), 1);
});

test('RIVER Stop while hidden Next is pending prevents a later reveal from submitting', async t => {
  const state = setup(t);
  state.next.style.display = 'none';
  state.helper.root.querySelector('[data-run]').click();
  await settle();
  assert.equal(state.clicks(), 0);
  state.helper.stop();
  state.next.style.removeProperty('display');
  await settle();
  assert.equal(state.clicks(), 0);
  assert.equal(state.submitted.some(record => record.type === 'river.step'), false);
});

test('RIVER rejects a Next replaced after readiness before submitting and permits deliberate fresh Run', async t => {
  const state = setup(t);
  state.next.disabled = true;
  state.helper.root.querySelector('[data-run]').click();
  await settle();
  const replacement = state.next.cloneNode(true);
  replacement.disabled = false;
  let replacementClicks = 0;
  replacement.addEventListener('click', () => replacementClicks++);
  state.next.disabled = false;
  state.window.queueMicrotask(() => state.next.replaceWith(replacement));
  await settle();
  assert.equal(state.clicks(), 0);
  assert.equal(replacementClicks, 0);
  assert.equal(state.submitted.some(record => record.type === 'river.step'), false);
  state.helper.root.querySelector('[data-run]').click();
  await settle();
  assert.equal(replacementClicks, 1);
});

test('RIVER field replacement before the first native write prevents stale writes and Next', async t => {
  const state = setup(t), field = state.window.document.querySelector('input'), frames = [];
  state.window.requestAnimationFrame = callback => frames.push(callback);
  state.helper.root.querySelector('[data-run]').click();
  await settle();
  assert.equal(frames.length, 1);
  const replacement = field.cloneNode();
  field.replaceWith(replacement);
  frames.shift()();
  await settle();
  assert.equal(field.value, '');
  assert.equal(replacement.value, '');
  assert.equal(state.clicks(), 0);
});


test('RIVER native field replacement during input validation prevents later Next', async t => {
  const state = setup(t), field = state.window.document.querySelector('input');
  const replacement = field.cloneNode();
  field.addEventListener('input', () => field.replaceWith(replacement), { once: true });
  state.helper.root.querySelector('[data-run]').click();
  await settle();
  assert.equal(field.value, payload.asin);
  assert.equal(replacement.value, '');
  assert.equal(state.clicks(), 0);
  assert.equal(state.submitted.some(record => record.type === 'river.step'), false);
});

test('generated RIVER ignores ASIN and Next in a CSS-hidden native ancestor', async t => {
  const dom = new JSDOM('<body><page-info label="ASIN"></page-info><section style="display:none"><label>ASIN<input name="asin"></label><button id="next">Next</button></section>', { url: 'https://river.amazon.com/BWU2/workflows', runScripts: 'outside-only' });
  const window = dom.window;
  renderNativeControls(window);
  window.GM_getValue = () => payload;
  window.GM_setValue = () => {};
  window.GM_openInTab = () => {};
  let clicks = 0;
  window.document.querySelector('#next').onclick = () => clicks++;
  t.after(() => { window.dispatchEvent(new window.Event('pagehide')); window.close(); });
  window.eval(readFileSync(new URL('../FCResearch_RIVER_Ticket_Assistant.user.js', import.meta.url), 'utf8'));
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await settle();
  window.document.querySelector('[data-run]').click();
  await settle();
  assert.equal(window.document.querySelector('input').value, '');
  assert.equal(clicks, 0);
});
