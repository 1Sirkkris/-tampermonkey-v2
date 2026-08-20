import test from 'node:test';
import assert from 'node:assert/strict';
import { extractContractCategories, readScript } from '../tools/userscript-contracts.mjs';

test('contract extractor covers every protected category', () => {
  const source = `// ==UserScript==
// @name Sample
// @version 1.2.3
// @match https://example.invalid/*
// @grant none
// ==/UserScript==
if (window.__sampleGuard) return;
const ENDPOINT = '/api/sample';
const STORAGE_KEY = 'sideline.sample.key';
document.querySelector('#protected-selector');
document.addEventListener('keydown', event => {
  if (event.altKey && event.key === '+') button.textContent = 'Protected label';
});
window.dispatchEvent(new CustomEvent('shared:sample'));
JSON.stringify({ sourceId:null, nested:{ quantity:1 } });
function once() {}
`;
  const contract = extractContractCategories(source);
  assert.deepEqual(contract.metadata.name, ['Sample']);
  assert.deepEqual(contract.metadata.version, ['1.2.3']);
  assert.deepEqual(contract.initGuards, ['__sampleGuard']);
  assert.deepEqual(contract.endpoints, ['/api/sample']);
  assert.deepEqual(contract.storageKeys, ['sideline.sample.key']);
  assert.deepEqual(contract.selectors, ['#protected-selector']);
  assert.ok(contract.shortcuts.some(line => line.includes("event.key === '+'")));
  assert.deepEqual(contract.events, ['keydown','shared:sample']);
  assert.deepEqual(contract.labels, ['Protected label']);
  assert.deepEqual(contract.payloadShapes, ['nested,quantity,sourceId']);
  assert.deepEqual(contract.functions, { once:1 });
  assert.deepEqual(contract.listeners, { 'document:keydown':1 });
});

test('new duplicate functions and listeners change extracted inventory', () => {
  const source = `
function duplicate() {}
function duplicate() {}
document.addEventListener('click', handler);
document.addEventListener('click', handler);
`;
  const contract = extractContractCategories(source);
  assert.equal(contract.functions.duplicate, 2);
  assert.equal(contract.listeners['document:click'], 2);
});

test('bare global listeners are inventoried as window listeners', () => {
  const contract = extractContractCategories("addEventListener('hashchange', handler);");
  assert.deepEqual(contract.listeners, { 'window:hashchange':1 });
});

test('regexes and nested templates do not corrupt literal contracts', () => {
  const source = [
    'const pattern = /["\u0027]/g;',
    "const endpoint = '/api/real';",
    "const label = `outer ${items.map(item => `<b>${item || 'fallback'}</b>`).join('')}`;",
    "const storage = 'sideline.real.key';"
  ].join('\n');
  const contract = extractContractCategories(source);
  assert.deepEqual(contract.endpoints, ['/api/real']);
  assert.deepEqual(contract.storageKeys, ['sideline.real.key']);
  assert.ok(contract.endpoints.every(value => value.length < 100));
});

test('real-script endpoint and storage inventories stay readable', async () => {
  const sideline = extractContractCategories(await readScript('MAIN_v0.2.1_Sideline_API_Move_TEST.txt'));
  for (const endpoint of ['/api/move-items','/api/scan-source-container','/api/scanitem']) assert.ok(sideline.endpoints.includes(endpoint));
  assert.ok(sideline.endpoints.every(value => value.length < 500));
  assert.deepEqual(sideline.storageKeys, ['sidelineApiLazy.clearSource','sidelineClean.panelStates.v1']);

  const aft = extractContractCategories(await readScript('MAIN_v0.9.4_AFT_Edit-SKU-Move_master_PRODUCTION_CLEAN.txt'));
  assert.deepEqual(aft.endpoints, ['/action','/end','/status']);
  assert.ok(aft.storageKeys.includes('aftm_sku_entry'));

  const lite = extractContractCategories(await readScript('TEST_v0.1.29_FC-Lite_USAGE.txt'));
  assert.equal(lite.storageKeys.some(value => /\s/.test(value)), false);

  const tracer = extractContractCategories(await readScript('TEST_v0.1.5_BWU2_Super_Tracer.txt'));
  assert.deepEqual(tracer.storageKeys, ['bwu2:supertrace:v010:']);

  for (const contract of [sideline, aft, lite, tracer]) {
    assert.ok(contract.selectors.every(value => value.length < 500));
    assert.ok(contract.labels.every(value => value.length < 500));
  }
});
