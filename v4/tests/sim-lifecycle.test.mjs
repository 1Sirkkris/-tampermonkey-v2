import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createSimToolbar } from '../sim-runtime.mjs';

const tick = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
async function setup(t, installer) {
  const dom = new JSDOM('<body><div><textarea data-testid="sim-markdownEditor--textArea">hello</textarea></div>', {
    url: 'https://t.corp.amazon.com/test', runScripts: 'outside-only'
  }), w = dom.window;
  let helper;
  if (installer) {
    w.eval(readFileSync(new URL('../SIM_Markdown_Toolbar.user.js', import.meta.url), 'utf8'));
    w.document.dispatchEvent(new w.Event('DOMContentLoaded')); await tick();
  } else helper = createSimToolbar({ window: w });
  const dispose = () => helper ? helper.dispose() : w.dispatchEvent(new w.Event('pagehide'));
  t.after(() => { dispose(); w.close(); });
  return { w, dispose };
}
function open(w, value) {
  const select = w.document.querySelector('.tm-v4-sim-bar select');
  select.value = value; select.dispatchEvent(new w.Event('change'));
  return w.document.querySelector('.tm-v4-sim-modal');
}
function startImport(w) {
  [...w.document.querySelectorAll('.tm-v4-sim-bar button')].find(button => button.textContent === 'Import').click();
  return w.document.querySelector('input[type=file]');
}
function controlledReaders(w) {
  const readers = [];
  w.FileReader = class {
    constructor() { this.readyState = 0; this.aborts = 0; readers.push(this); }
    readAsText() { this.readyState = 1; }
    abort() { this.aborts++; this.readyState = 2; this.onabort?.(); }
    finish(result) { this.result = result; this.readyState = 2; this.onload?.(); }
    fail() { this.readyState = 2; this.onerror?.(); }
  };
  const read = () => {
    const input = startImport(w);
    Object.defineProperty(input, 'files', { value: [new w.File(['data'], 'snippets.json')] });
    input.dispatchEvent(new w.Event('change'));
    return { input, reader: readers.at(-1) };
  };
  return { readers, read };
}
for (const installer of [false, true]) {
  const label = installer ? 'installer' : 'source';
  test(`SIM ${label}: repeated dialog closure releases handlers; save/validation/manage still work`, async t => {
    const { w, dispose } = await setup(t, installer);
    for (let i = 0; i < 25; i++) {
      const node = open(w, 'add'), save = node.querySelector('[data-save]'), cancel = node.querySelector('[data-cancel]');
      cancel.click(); assert.equal(node.isConnected, false); assert.equal(save.onclick, null); assert.equal(cancel.onclick, null);
      save.click(); assert.equal(w.localStorage.getItem('tm-v4.sim.snippets'), null);
    }
    let node = open(w, 'add'); node.querySelector('[data-save]').click();
    assert.equal(node.isConnected, true); assert.match(node.querySelector('[role=status]').textContent, /name\/text/);
    node.querySelector('[data-name]').value = 'One'; node.querySelector('[data-text]').value = 'Body';
    node.querySelector('[data-save]').click(); assert.equal(node.isConnected, false);
    assert.deepEqual(JSON.parse(w.localStorage.getItem('tm-v4.sim.snippets')), [{ name: 'One', text: 'Body' }]);
    node = open(w, 'manage'); const old = node;
    open(w, 'add'); assert.equal(old.isConnected, false); assert.equal(old.onclick, null);
    node = open(w, 'manage'); node.querySelector('[data-close]').click(); assert.equal(node.onclick, null);
    node = open(w, 'add'); dispose(); assert.equal(node.isConnected, false); assert.equal(node.querySelector('[data-save]').onclick, null);
  });
  test(`SIM ${label}: 25 cancelled imports remove their nodes and handlers`, async t => {
    const { w } = await setup(t, installer);
    for (let i = 0; i < 25; i++) {
      const input = startImport(w); input.dispatchEvent(new w.Event('cancel'));
      assert.equal(w.document.querySelectorAll('input[type=file]').length, 0);
      assert.equal(input.onchange, null); assert.equal(input.oncancel, null);
    }
    const input = startImport(w); input.dispatchEvent(new w.Event('change'));
    assert.equal(input.isConnected, false); assert.equal(input.onchange, null);
  });
  test(`SIM ${label}: import success/merge/parse failure/read failure close one owned attempt`, async t => {
    const { w } = await setup(t, installer), { read } = controlledReaders(w);
    let attempt = read(); attempt.reader.finish('[{"name":"One","text":"old"}]');
    assert.equal(attempt.input.isConnected, false); assert.equal(attempt.reader.onload, null);
    w.confirm = () => false;
    attempt = read(); attempt.reader.finish('[{"name":"One","text":"new"}]');
    const stored = w.localStorage.getItem('tm-v4.sim.snippets');
    assert.deepEqual(JSON.parse(stored), [{ name: 'One', text: 'old' }, { name: 'One (2)', text: 'new' }]);
    attempt = read(); attempt.reader.finish('invalid JSON'); assert.equal(attempt.input.isConnected, false);
    assert.equal(w.localStorage.getItem('tm-v4.sim.snippets'), stored);
    attempt = read(); attempt.reader.fail(); assert.equal(attempt.input.isConnected, false); assert.equal(attempt.reader.onerror, null);
    assert.equal(w.document.querySelectorAll('input[type=file]').length, 0);
    assert.equal(w.localStorage.getItem('tm-v4.sim.snippets'), stored);
  });
  test(`SIM ${label}: cancelled/disposed pending FileReader cannot write snippets`, async t => {
    const { w, dispose } = await setup(t, installer), { read } = controlledReaders(w);
    const cancelled = read(), late = cancelled.reader.onload;
    cancelled.input.dispatchEvent(new w.Event('cancel'));
    assert.equal(cancelled.reader.aborts, 1); assert.equal(cancelled.reader.onload, null);
    cancelled.reader.result = '[{"name":"Late","text":"bad"}]'; late();
    assert.equal(w.localStorage.getItem('tm-v4.sim.snippets'), null);
    const pending = read(); dispose();
    assert.equal(pending.reader.aborts, 1); assert.equal(pending.reader.onload, null); assert.equal(pending.input.onchange, null);
    assert.equal(w.document.querySelectorAll('input[type=file]').length, 0);
  });
  test(`SIM ${label}: native editor replacement releases old toolbar handlers`, async t => {
    const { w } = await setup(t, installer), old = w.document.querySelector('.tm-v4-sim-bar'), oldSelect = old.querySelector('select');
    const textarea = w.document.querySelector('textarea'), replacement = textarea.cloneNode(true);
    textarea.replaceWith(replacement); await tick();
    assert.equal(w.document.querySelectorAll('.tm-v4-sim-bar').length, 1); assert.equal(old.isConnected, false);
    assert.equal(oldSelect.onchange, null); assert.equal(old.querySelector('button').onclick, null);
    oldSelect.value = 'add'; oldSelect.dispatchEvent(new w.Event('change'));
    assert.equal(w.document.querySelector('.tm-v4-sim-modal'), null);
  });
}
