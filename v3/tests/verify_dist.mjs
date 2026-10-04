import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'build','manifest.json'),'utf8'));
for(const entry of manifest.suites){
  const file=path.join(root,'dist',entry.output);
  assert.ok(fs.existsSync(file),'missing '+entry.output);
  const body=fs.readFileSync(file,'utf8');
  assert.ok(body.includes('// @name         '+entry.name),entry.output+' wrong name');
  assert.ok(body.includes('// @version      '+entry.version),entry.output+' wrong version');
  assert.ok(body.includes('/v3-groundup/'),entry.output+' wrong update branch');
  assert.ok(!body.includes('/v3-rebuild/'),entry.output+' contains old V3 branch');
  assert.ok(!body.includes('BWU2Fleet'),entry.output+' contains V2 runtime dependency');
  assert.ok(!body.includes('@require'),entry.output+' runtime @require forbidden');
  new Function(body);
  console.log('PASS '+entry.output);
}
