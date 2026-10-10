import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(root).filter(name => name.endsWith('.user.js'));
files.push(...readdirSync(root + '/diagnostics').filter(name => name.endsWith('.user.js')).map(name => 'diagnostics/' + name));
assert(files.length > 0, 'No V4 installer');
const identities = new Set();
const readme = readFileSync(root + '/README.md', 'utf8');
const readiness = new Set(['READY FOR READ-ONLY TEST', 'READY FOR CONTROLLED LIVE TEST',
  'OFFLINE VERIFIED — LIVE GATE PENDING', 'PARTIAL', 'BLOCKED', 'NOT BUILT']);
for (const name of files) {
  const path = root + '/' + name;
  const source = readFileSync(path, 'utf8');
  const metadata = source.match(/\/\/ ==UserScript==([\s\S]*?)\/\/ ==\/UserScript==/)?.[1];
  assert(metadata, name + ': metadata missing');
  const field = key => metadata.match(new RegExp('// @' + key + '\\s+([^\\n]+)'))?.[1].trim();
  assert(field('name').startsWith('V4 '), name + ': wrong identity');
  const identity = field('namespace') + '|' + field('name');
  assert(!identities.has(identity), name + ': duplicate script identity'); identities.add(identity);
  assert(source.includes('tm-v4-runtime-watermark'), name + ': missing watermark');
  assert.equal(field('downloadURL'), 'https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/' + name);
  assert.equal(field('updateURL'), field('downloadURL'));
  assert.equal(source.match(/(?:const|var|let) VERSION\s*=\s*(['"])([^'"]+)\1/)?.[2], field('version'));
  for (const include of metadata.matchAll(/^\/\/ @include\s+(\/.*\/[a-z]*)\s*$/gm)) {
    const end = include[1].lastIndexOf('/');
    assert.doesNotThrow(() => new RegExp(include[1].slice(1, end), include[1].slice(end + 1)), name + ': invalid include regex');
  }
  const rows = readme.split('\n').filter(line => line.startsWith('|') && line.includes('](' + field('downloadURL') + ')'));
  assert.equal(rows.length, 1, name + ': missing/duplicate readiness row');
  const columns = rows[0].split('|').map(column => column.trim());
  assert.equal(columns[2], field('version'), name + ': README version drift');
  assert(['COMPLETE', 'PARTIAL', 'NOT BUILT', 'BLOCKED'].includes(columns[3]), name + ': invalid implementation status');
  assert(readiness.has(columns[4]), name + ': invalid readiness status');
  assert(!/\/\/ @require\b/.test(metadata), name + ': external implementation dependency');
  assert(!/BWU2Fleet|BWU2Actions|FCRDataCore|bwu2-observability:event|bwu2-v3:event|bwu2\.v3\./.test(source), name + ': old runtime dependency');
  assert(!/setInterval\s*\(/.test(source), name + ': recurring idle timer');
  const syntax = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
}
const modules = readdirSync(root).filter(name => name.endsWith('.mjs') && name !== 'checks.mjs');
for (const name of modules) {
  const path = root + '/' + name, source = readFileSync(path, 'utf8');
  assert(!/BWU2Fleet|BWU2Actions|FCRDataCore|fcr-data-core:|fcrm_native_section_load_v4|bwu2\.v3\./.test(source), name + ': old runtime dependency');
  assert(!/setInterval\s*\(/.test(source), name + ': recurring idle timer');
  const syntax = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
}
console.log('PASS: ' + files.length + ' V4 installers and ' + modules.length + ' source modules: syntax and independence; installer metadata/include regex/readiness documentation');
