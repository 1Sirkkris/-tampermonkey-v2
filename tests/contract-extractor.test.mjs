import test from 'node:test';
import assert from 'node:assert/strict';
import { extractContractCategories } from '../tools/userscript-contracts.mjs';

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
