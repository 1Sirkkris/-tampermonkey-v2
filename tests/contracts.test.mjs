import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../tools/userscript-contracts.mjs';

test('userscript syntax and protected contracts pass', () => {
  const result = spawnSync(process.execPath, ['tools/validate-userscripts.mjs'], {
    cwd:ROOT,
    encoding:'utf8'
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
