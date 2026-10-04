import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'build','manifest.json'),'utf8'));
const byId=Object.fromEntries(manifest.suites.map(entry=>[entry.id,entry]));

for(const id of ['fcr','iss','edit','move','sideline','hierarchy','movecontainer','river','fnsku','poportal','carton','calm','sim','obs']){
  assert.ok(byId[id], 'missing suite '+id);
}

const outputs=manifest.suites.map(x=>x.output);
assert.equal(new Set(outputs).size,outputs.length,'duplicate dist output');

const fcr=byId.fcr;
for(const forbidden of [
  'src/services/aft.js',
  'src/services/aft-workflows.js',
  'src/services/sideline.js',
  'src/components/edit-ui.js',
  'src/components/move-ui.js',
  'src/components/sideline-ui.js',
  'src/apps/iss/index.js'
]) assert.ok(!fcr.sources.includes(forbidden),'FCR must not bundle '+forbidden);

const iss=byId.iss;
assert.deepEqual(iss.match,['https://aft-poirot-website-nrt.nrt.proxy.amazon.com/*']);
assert.equal(iss.include,undefined,'ISS must not match FCResearch');
for(const shared of ['src/services/aft.js','src/services/aft-workflows.js','src/services/sideline.js']){
  assert.ok(iss.sources.includes(shared),'ISS missing shared engine '+shared);
}
for(const shared of ['src/services/aft.js','src/services/aft-workflows.js']){
  assert.ok(byId.edit.sources.includes(shared),'Edit must use shared '+shared);
  assert.ok(byId.move.sources.includes(shared),'Move must use shared '+shared);
}
assert.ok(byId.sideline.sources.includes('src/services/sideline.js'),'Native Sideline must use shared Sideline engine');

for(const entry of manifest.suites){
  assert.ok(entry.name.startsWith('V3 | '),entry.id+' missing V3 title prefix');
  assert.ok(entry.updateURL.includes('/v3-relaunch/'),entry.id+' update URL not on relaunch branch');
  assert.ok(entry.downloadURL.includes('/v3-relaunch/'),entry.id+' download URL not on relaunch branch');
}

console.log('PASS architecture');
