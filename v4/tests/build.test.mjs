import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const sourceRoot = dirname(fileURLToPath(new URL('../build.mjs', import.meta.url)));
function fixture(t) {
  const temp = mkdtempSync(join(tmpdir(), 'v4-build-recovery-')), root = join(temp, 'v4');
  cpSync(sourceRoot, root, { recursive: true, filter: path => basename(path) !== 'node_modules' && !basename(path).startsWith('build-staging-') });
  symlinkSync(realpathSync(join(sourceRoot, 'node_modules')), join(root, 'node_modules'), 'dir');
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const files = [...readdirSync(root).filter(name => name.endsWith('.user.js')),
    ...readdirSync(join(root, 'diagnostics')).filter(name => name.endsWith('.user.js')).map(name => 'diagnostics/' + name)].sort();
  const snapshot = () => files.map(name => [name, createHash('sha256').update(readFileSync(join(root, name))).digest('hex')]);
  const build = args => spawnSync(process.execPath, [...(args || []), join(root, 'build.mjs')], { cwd: root, encoding: 'utf8', timeout: 30000 });
  const stages = () => readdirSync(root).filter(name => name.startsWith('build-staging-'));
  return { temp, root, files, snapshot, build, stages };
}

function interruptHook(fixture, mode) {
  const path = join(fixture.temp, 'interrupt.mjs');
  writeFileSync(path, [
    "import fs from 'node:fs';",
    "import {syncBuiltinESMExports} from 'node:module';",
    "const original=fs.writeFileSync;",
    "fs.writeFileSync=(path,data,...options)=>{",
    " if(String(path).endsWith('.user.js')){",
    "  original(path,String(data).slice(0,100),...options);",
    mode === 'kill' ? "  process.kill(process.pid,'SIGKILL');" : "  throw Object.assign(new Error('fixture disk full'),{code:'ENOSPC'});",
    " }",
    " return original(path,data,...options);",
    "};",
    "syncBuiltinESMExports();"
  ].join('\n'));
  return ['--import', path];
}

test('actual build interrupted during an installer write preserves all 19 published candidates and a later build recovers', t => {
  const f = fixture(t), before = f.snapshot(); assert.equal(f.files.length, 19);
  const interrupted = f.build(interruptHook(f, 'kill'));
  assert.equal(interrupted.signal, 'SIGKILL', interrupted.stderr);
  assert.deepEqual(f.snapshot(), before, 'an interrupted staging write cannot truncate a published installer');
  const oldStages = f.stages(); assert.equal(oldStages.length, 1);
  const recovered = f.build(); assert.equal(recovered.status, 0, recovered.stderr);
  assert.deepEqual(f.snapshot(), before); assert.deepEqual(f.stages(), oldStages, 'normal build removes its own staging; does not delete another build');
  const match = spawnSync(process.execPath, [join(f.root, 'build.mjs'), '--check'], { cwd: f.root, encoding: 'utf8', timeout: 30000 });
  assert.equal(match.status, 0, match.stderr);
});

test('actual staging disk failure leaves published installers byte-identical and cleans its own incomplete staging', t => {
  const f = fixture(t), before = f.snapshot(), failed = f.build(interruptHook(f, 'throw'));
  assert.notEqual(failed.status, 0); assert.match(failed.stderr, /fixture disk full/);
  assert.deepEqual(f.snapshot(), before); assert.equal(f.stages().length, 0);
});

test('a late canonical source compilation failure cannot replace any earlier valid installer', t => {
  const f = fixture(t), before = f.snapshot();
  writeFileSync(join(f.root, 'tote-entry.mjs'), readFileSync(join(f.root, 'tote-entry.mjs'), 'utf8') + '\nconst broken = ;');
  const failed = f.build(); assert.notEqual(failed.status, 0); assert.match(failed.stderr, /Expected|Unexpected/);
  assert.deepEqual(f.snapshot(), before); assert.equal(f.stages().length, 0);
});
