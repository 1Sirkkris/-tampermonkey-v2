import assert from 'node:assert/strict';
import {harness,storage,locks,tick} from './harness.mjs';
const sharedStorage=storage(),sharedLocks=locks(),a=harness({sharedStorage,sharedLocks}),b=harness({sharedStorage,sharedLocks});
try{
 const C=a.V3.core,S=a.V3.state;
 assert.equal(C.clean(' a   b '),'a b');assert.equal(C.container('tsX123'),true);assert.equal(C.container('abc'),false);
 const op=C.operation({kind:'test',ref:'abc',scope:'test'});assert.equal(op.state,'PREPARED');op.submitted();assert.equal(b.V3.state.attention('test').state,'SUBMITTED');op.unknown();assert.throws(()=>op.confirmed(),/terminal/);assert.throws(()=>b.V3.state.assertClear('test'),/VERIFY/);await S.resolveAttention('test');
 const confirmed=C.operation({kind:'test',ref:'def',scope:'test'});confirmed.submitted();confirmed.confirmed();assert.equal(S.attention('test'),null);
 const release=await S.acquire('test');await assert.rejects(b.V3.state.acquire('test'),/another tab/);await release();await tick();const release2=await b.V3.state.acquire('test');await release2();await tick();
 const qa=C.queue({name:'ownership'}),qb=b.V3.core.queue({name:'ownership'});await qa.add(['tsX1','tsX1','csX2']);assert.equal(qa.state.items.length,2);assert.equal(await qa.acquire(),true);await qa.set({running:true,current:'tsX1'});await qa.item(qa.next(),{status:'active'});assert.equal(await qb.acquire(),false);await assert.rejects(qb.add(['tsX3']),/another tab/);await qa.release();await tick();assert.equal(await qb.acquire(),true);assert.equal(qb.state.items[0].status,'attention');assert.equal(qb.next().id,'csX2');await qb.release();await tick();
 await qb.resolve();assert.equal(qb.next().id,'tsX1');
 const saved=sharedStorage.getItem(S.keyFor('queue.ownership'));sharedStorage.setItem(S.keyFor('queue.broken'),'{bad');await assert.rejects(C.queue({name:'broken'}).load(),/unreadable/);assert.equal(sharedStorage.getItem(S.keyFor('queue.broken')),'{bad');assert.ok(saved);
 assert.deepEqual(JSON.parse(JSON.stringify(C.sanitize({authorization:'secret',nested:{csrfToken:'secret',safe:1},message:'token=abc'}))),{nested:{safe:1},message:'[redacted]'});
 console.log('PASS core: terminal mutation journals, reload, browser ownership, concurrent queue editing, corruption, telemetry');
}finally{a.close();b.close();}
