import test from 'node:test';
import assert from 'node:assert/strict';
import { readScript } from '../tools/userscript-contracts.mjs';
import { compileFunction } from './lib/source-functions.mjs';

test('FCR Data Core keeps stored cache age when hydrating memory', async () => {
  const source = await readScript('TEST_v0.2.3_FCR_Data_Core_USAGE.txt');
  let now = 950;
  const Clock = { now:() => now };
  const values = new Map();
  const sessionStorage = {
    getItem:key => values.get(key) ?? null,
    removeItem:key => values.delete(key)
  };
  const cacheKey = (kind, key) => `${kind}:${String(key).toUpperCase()}`;
  const readStored = compileFunction(source, 'readStored', { cacheKey, sessionStorage, Date:Clock });
  const upper = value => String(value ?? '').trim().toUpperCase();
  const clean = value => String(value ?? '').trim();
  const ttl = 1000;

  values.set('product:ITEM', JSON.stringify({ ts:100, value:{ asin:'ITEM' } }));
  const productMemory = new Map();
  const getCachedProduct = compileFunction(source, 'getCachedProduct', {
    upper, productMemory, Date:Clock, PRODUCT_TTL:ttl, readStored
  });
  assert.deepEqual(getCachedProduct('item'), { asin:'ITEM' });
  assert.equal(productMemory.get('ITEM').ts, 100);

  values.set('history:ITEM', JSON.stringify({ ts:100, value:{ moves:2 } }));
  const historyMemory = new Map();
  const getCachedHistory = compileFunction(source, 'getCachedHistory', {
    upper, historyMemory, Date:Clock, HISTORY_TTL:ttl, readStored
  });
  assert.deepEqual(getCachedHistory('item'), { moves:2 });
  assert.equal(historyMemory.get('ITEM').ts, 100);

  values.set('bin:CONTAINER|ITEM', JSON.stringify({ ts:100, value:'P-2-A' }));
  const binMemory = new Map();
  const binKey = (container, item) => `${upper(container)}|${upper(item)}`;
  const getCachedBin = compileFunction(source, 'getCachedBin', {
    binKey, binMemory, Date:Clock, BIN_TTL:ttl, readStored, clean
  });
  assert.equal(getCachedBin('container', 'item'), 'P-2-A');
  assert.equal(binMemory.get('CONTAINER|ITEM').ts, 100);

  now = 1101;
  assert.equal(getCachedProduct('item'), null);
  assert.equal(getCachedHistory('item'), null);
  assert.equal(getCachedBin('container', 'item'), '');
});

test('FCR Data Core rejects malformed stored timestamps', async () => {
  const source = await readScript('TEST_v0.2.3_FCR_Data_Core_USAGE.txt');
  const values = new Map([['product:ITEM', JSON.stringify({ ts:'bad', value:{ asin:'ITEM' } })]]);
  const sessionStorage = {
    getItem:key => values.get(key) ?? null,
    removeItem:key => values.delete(key)
  };
  const readStored = compileFunction(source, 'readStored', {
    cacheKey:(kind, key) => `${kind}:${key}`,
    sessionStorage,
    Date:{ now:() => 500 }
  });
  assert.equal(readStored('product', 'ITEM', 1000), null);
  assert.equal(values.has('product:ITEM'), false);
});
