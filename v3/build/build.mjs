import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const manifestPath = path.join(root, 'build', 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const checkOnly = process.argv.includes('--check');

function metaLine(key, value) {
  return '// @' + key.padEnd(12, ' ') + value;
}

function metadata(entry, buildId) {
  const lines = [
    '// ==UserScript==',
    metaLine('name', entry.name),
    metaLine('name:en', entry.name),
    metaLine('namespace', entry.namespace),
    metaLine('version', entry.version),
    metaLine('description', entry.description),
    metaLine('run-at', entry.runAt || 'document-body')
  ];
  for (const value of entry.match || []) lines.push(metaLine('match', value));
  for (const value of entry.include || []) lines.push(metaLine('include', value));
  for (const value of entry.exclude || []) lines.push(metaLine('exclude', value));
  for (const value of entry.grant || []) lines.push(metaLine('grant', value));
  for (const value of entry.connect || []) lines.push(metaLine('connect', value));
  lines.push(metaLine('updateURL', entry.updateURL));
  lines.push(metaLine('downloadURL', entry.downloadURL));
  lines.push('// @v3-build    ' + buildId);
  lines.push('// ==/UserScript==');
  return lines.join('\n');
}

function generate(entry) {
  const parts = entry.sources.map(rel => {
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) throw new Error(entry.id + ': missing source ' + rel);
    return '// ---- ' + rel + ' ----\n' + fs.readFileSync(full, 'utf8').trim();
  });
  const fingerprintInput = JSON.stringify(entry) + '\n' + parts.join('\n');
  const hash = crypto.createHash('sha256').update(fingerprintInput).digest('hex').slice(0,12);
  const buildId = entry.id + '-' + entry.version + '-' + hash;
  const header = metadata(entry, buildId);
  const body = [
    header,
    '',
    '(() => {',
    "  'use strict';",
    '  const V3 = Object.create(null);',
    '  V3.build = Object.freeze(' + JSON.stringify({id:buildId,version:entry.version,suite:entry.id}) + ');',
    parts.join('\n\n'),
    '  if (typeof V3.boot !== "function") throw new Error("V3 suite boot function missing");',
    '  V3.boot();',
    '})();',
    ''
  ].join('\n');
  new Function(body);
  return {body,buildId};
}

let failed = false;
for (const entry of manifest.suites) {
  const output = path.join(root, 'dist', entry.output);
  const {body,buildId} = generate(entry);
  if (checkOnly) {
    const current = fs.existsSync(output) ? fs.readFileSync(output,'utf8') : '';
    if (current !== body) {
      console.error('STALE ' + entry.output);
      failed = true;
    } else {
      console.log('PASS  ' + entry.output + ' ' + buildId);
    }
  } else {
    fs.mkdirSync(path.dirname(output), {recursive:true});
    fs.writeFileSync(output, body);
    console.log('BUILD ' + entry.output + ' ' + buildId);
  }
}
if (failed) process.exit(1);
