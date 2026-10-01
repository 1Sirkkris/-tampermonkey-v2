import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const context={
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  AbortController, DOMException, performance, crypto,
  localStorage:(()=>{const m=new Map();return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}})()
};
context.V3={build:{id:'test',version:'test',suite:'test'}};
vm.createContext(context);

for(const file of ['base.js','lifecycle.js','storage.js','telemetry.js','operation.js','queue.js']){
  vm.runInContext(fs.readFileSync(path.join(root,'src','core',file),'utf8'),context,{filename:file});
}

assert.equal(context.V3.base.validContainer('tsX123ABC'),true);
assert.equal(context.V3.base.validContainer('nope'),false);

const store=context.V3.storage.create('test');
store.set('x',{a:1});
assert.equal(store.get('x').a,1);

const life=context.V3.lifecycle.create('test');
let ticked=false;
life.timeout(()=>{ticked=true;},5);
await new Promise(r=>setTimeout(r,12));
assert.equal(ticked,true);
life.dispose();

const telemetry=context.V3.telemetry.create('test','1',{limit:3});
const op=context.V3.operation.create({kind:'move',ref:'tsX123456789',telemetry});
op.submitted();op.unknown({reason:'timeout'});
assert.equal(op.data.outcome,'unknown');
assert.equal(telemetry.list().at(-1).phase,'unknown');

const qLife=context.V3.lifecycle.create('q');
const queue=context.V3.queue.create({name:'testq',life:qLife,telemetry});
queue.addMany(['tsXAAA111','tsXAAA111','bad']);
assert.equal(queue.state.items.length,1);
qLife.dispose();

console.log('PASS core tests');
