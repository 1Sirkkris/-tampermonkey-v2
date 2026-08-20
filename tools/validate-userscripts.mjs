import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {
  CURRENT_SCRIPTS,
  DIAGNOSTIC_SCRIPTS,
  ROOT,
  buildLock,
  discoverUserscriptFiles,
  extractContractCategories,
  lockView,
  readScript
} from './userscript-contracts.mjs';

const LOCK_FILE = path.join(ROOT, 'contracts', 'userscripts.lock.json');
const CRITICAL_FILE = path.join(ROOT, 'contracts', 'critical-contracts.json');
const writeLock = process.argv.includes('--write-lock');

function fail(message) {
  console.error(`CONTRACT FAILURE: ${message}`);
  process.exitCode = 1;
}

async function syntaxChecks() {
  for (const file of [...CURRENT_SCRIPTS, ...DIAGNOSTIC_SCRIPTS]) {
    const source = await readScript(file);
    try {
      new vm.Script(source, { filename:file });
      console.log(`syntax ok  ${file}`);
    } catch (error) {
      fail(`${file} does not parse: ${error.message}`);
    }
  }
}

async function inventoryChecks() {
  const declared = [...CURRENT_SCRIPTS, ...DIAGNOSTIC_SCRIPTS].sort();
  const discovered = await discoverUserscriptFiles();
  for (const file of discovered.filter(file => !declared.includes(file))) {
    fail(`${file} is an unclassified userscript and would escape validation`);
  }
  for (const file of declared.filter(file => !discovered.includes(file))) {
    fail(`${file} is declared for validation but is missing or lacks userscript metadata`);
  }
}

async function criticalChecks() {
  const manifest = JSON.parse(await readFile(CRITICAL_FILE, 'utf8'));
  for (const [file, contract] of Object.entries(manifest.scripts)) {
    const source = await readScript(file);
    for (const anchor of contract.anchors || []) {
      if (!source.includes(anchor)) fail(`${file} lost protected anchor: ${JSON.stringify(anchor)}`);
    }
    for (const forbidden of contract.forbidden || []) {
      if (source.includes(forbidden)) fail(`${file} contains forbidden offline migration anchor: ${JSON.stringify(forbidden)}`);
    }
  }

  for (const shared of manifest.sharedInterfaces || []) {
    let occurrences = 0;
    for (const file of shared.files) {
      const fileOccurrences = (await readScript(file)).split(shared.anchor).length - 1;
      if (!fileOccurrences) fail(`${file} lost shared interface ${JSON.stringify(shared.anchor)}`);
      occurrences += fileOccurrences;
    }
    if (occurrences < shared.minimumOccurrences) {
      fail(`shared interface ${JSON.stringify(shared.anchor)} has ${occurrences}; expected at least ${shared.minimumOccurrences}`);
    }
  }
}

async function lockChecks() {
  const current = await buildLock();
  if (writeLock) {
    if (process.exitCode) {
      console.error('contract lock not updated because earlier validation failed');
      return;
    }
    await writeFile(LOCK_FILE, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
    console.log(`updated ${path.relative(ROOT, LOCK_FILE)}`);
    return;
  }

  const expected = JSON.parse(await readFile(LOCK_FILE, 'utf8'));
  if (expected.schemaVersion !== current.schemaVersion) {
    fail(`contract lock schema ${expected.schemaVersion}; expected ${current.schemaVersion}. Regenerate the lock deliberately.`);
    return;
  }
  for (const file of CURRENT_SCRIPTS) {
    const actualView = current.scripts[file];
    const expectedView = expected.scripts?.[file];
    if (!expectedView) { fail(`${file} is missing from the contract lock`); continue; }
    for (const category of Object.keys(actualView.digests)) {
      if (actualView.digests[category] === expectedView.digests?.[category]) continue;
      const actual = extractContractCategories(await readScript(file));
      fail(`${file} changed protected ${category}. Current extracted value:\n${JSON.stringify(actual[category], null, 2)}`);
    }
  }
}

await inventoryChecks();
await syntaxChecks();
await criticalChecks();
await lockChecks();
if (process.exitCode) process.exit(process.exitCode);
console.log('offline userscript validation passed');
