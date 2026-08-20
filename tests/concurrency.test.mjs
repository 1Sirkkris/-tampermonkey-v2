import test from 'node:test';
import assert from 'node:assert/strict';
import { readScript } from '../tools/userscript-contracts.mjs';
import { compileFunction } from './lib/source-functions.mjs';

test('Stow suspicious-dimension lookups use a bounded worker pool', async () => {
  const source = await readScript('TEST_v5.4.10_Stow_Andons_Helper_Safe_Trim_USAGE.txt');
  const runWithConcurrency = compileFunction(source, 'runWithConcurrency');
  const completed = [];
  let active = 0;
  let maximum = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const work = Array.from({ length:20 }, (_, index) => index);
  const running = runWithConcurrency(work, 6, async item => {
    active++;
    maximum = Math.max(maximum, active);
    await gate;
    completed.push(item);
    active--;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(maximum, 6);
  release();
  await running;
  assert.deepEqual(completed.sort((a, b) => a - b), work);
});
