import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { registerWatermark } from '../watermark.mjs';
const setup = () => new JSDOM('<body><input id="native"></body>', { url: 'https://example.com' });
test('isolated registrations share one footer with true versions and no input interception', () => {
  const dom = setup(), w = dom.window;
  const a = registerWatermark(w, 'OBS', '0.1.3'), b = registerWatermark(w, 'FCRM', '0.1.4');
  const host = w.document.querySelector('#tm-v4-runtime-watermark');
  assert.equal(host.textContent, 'V4 FCRM: 0.1.4 | V4 OBS: 0.1.3');
  assert.equal(host.style.pointerEvents, 'none');
  const input = w.document.querySelector('input'); input.focus();
  input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); assert.equal(w.document.activeElement, input);
  a(); assert.equal(host.textContent, 'V4 FCRM: 0.1.4'); b(); assert.equal(w.document.querySelector('#tm-v4-runtime-watermark'), null); dom.window.close();
});
test('deduplication and late disposal never delete a newer registration', () => {
  const dom = setup(), w = dom.window, old = registerWatermark(w, 'OBS', '0.1.2'), current = registerWatermark(w, 'OBS', '0.1.3');
  old(); assert.equal(w.document.querySelectorAll('[data-tm-v4-runtime]').length, 1);
  assert.equal(w.document.querySelector('#tm-v4-runtime-watermark').textContent, 'V4 OBS: 0.1.3');
  current(); dom.window.close();
});
test('pagehide clears stale entries; explicit navigation disposal is idempotent', () => {
  const dom = setup(), w = dom.window, stop = registerWatermark(w, 'TOTE', '0.1.0');
  w.dispatchEvent(new w.Event('pagehide')); stop();
  assert.equal(w.document.querySelector('#tm-v4-runtime-watermark'), null); dom.window.close();
});
test('invalid identity is rejected rather than displaying invented versions', () => {
  const dom = setup(); assert.throws(() => registerWatermark(dom.window, 'TOOLONG', '0.1.0')); assert.throws(() => registerWatermark(dom.window, 'OBS', 'fake')); dom.window.close();
});
