import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'build','manifest.json'),'utf8'));
const byId=Object.fromEntries(manifest.suites.map(x=>[x.id,x]));
const expected=['fcr','iss','aft','sideline','hierarchy','movecontainer','river','fnsku','poportal','carton','calm','sim','obs','screenshot'];
assert.deepEqual(manifest.suites.map(x=>x.id),expected);
assert.equal(new Set(manifest.suites.map(x=>x.output)).size,manifest.suites.length);

for(const entry of manifest.suites){
  assert.ok(entry.name.startsWith('V3 | '),entry.id+' missing V3 prefix');
  assert.ok(entry.namespace.includes('/v3-groundup'),entry.id+' wrong namespace');
  assert.ok(entry.updateURL.includes('/v3-groundup/'),entry.id+' wrong update branch');
  assert.ok(entry.downloadURL.includes('/v3-groundup/'),entry.id+' wrong download branch');
  for(const src of entry.sources)assert.ok(fs.existsSync(path.join(root,src)),entry.id+' missing '+src);
}

const fcr=byId.fcr.sources.join('\n');
for(const forbidden of ['src/aft.js','src/sideline.js','src/workflow-ui.js','src/sideline-ui.js','src/apps/iss.js']){
  assert.ok(!fcr.includes(forbidden),'FCR must not own '+forbidden);
}
assert.ok(byId.iss.sources.includes('src/aft.js'));
assert.ok(byId.iss.sources.includes('src/sideline.js'));
assert.ok(byId.aft.sources.includes('src/aft.js'));
assert.ok(byId.sideline.sources.includes('src/sideline.js'));

const actions=fs.readFileSync(path.join(root,'src','actions.js'),'utf8');
assert.ok(actions.includes("destination:'/validateDestination'"));
assert.ok(!/localStorage|sessionStorage|GM_setValue|GM\.setValue/.test(actions.slice(actions.indexOf('// Bind deliberately'),actions.indexOf('return Object.freeze'))),'Bind destination proof must stay memory-only');
assert.ok(!actions.includes("forceBind"),'Ground-up Bind must not directly call forceBind');

assert.notEqual(byId.obs.output,byId.screenshot.output,'OBS and Screenshot must remain independent');

console.log('PASS architecture');