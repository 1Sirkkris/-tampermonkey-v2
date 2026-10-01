// V3 static independence guard.
// Run against built userscripts before a preliminary/release build is considered installable.
// Usage: node v3/tests/v3_independence_guard.mjs <dist-file> [...]

import fs from 'node:fs';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Pass one or more V3 dist files.');
  process.exit(2);
}

const forbidden = [
  ['runtime @require', /^\s*\/\/\s*@require\s+/m],
  ['V2 Fleet global', /\bBWU2Fleet\b/],
  ['V2 Actions global', /\bBWU2Actions\b/],
  ['V2 FCResearch master guard', /__bwu2FcrMaster\b/],
  ['V2 FC-Lite guard', /__bwu2FcLite\b/],
  ['V2 ISS guard', /__bwu2IssConsole\b/],
  ['V2 hierarchy guard', /__bwu2(?:Bind|Unbind|Hierarchy)Queue\b/],
  ['V2 main raw dependency', /raw\.githubusercontent\.com\/1Sirkkris\/-tampermonkey-v2\/main\//]
];

let failed = false;

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const hits = forbidden.filter(([, pattern]) => pattern.test(source)).map(([label]) => label);

  if (hits.length) {
    failed = true;
    console.error(`FAIL ${file}: ${hits.join(', ')}`);
  } else {
    console.log(`PASS ${file}: V3 runtime independent`);
  }
}

process.exit(failed ? 1 : 0);
