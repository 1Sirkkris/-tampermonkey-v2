import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createStowHelper} from '../stow-runtime.mjs';
import {createOperationBridge,serveOperationBridge} from '../operation-bridge.mjs';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function until(check){for(let i=0;i<30&&!check();i++)await tick();assert(check(),'Expected workflow phase was not reached');}
const parentOrigin='https://fcresearch-fe.aka.amazon.com',nonce='12345678-1234-1234-1234-123456789abc';
function setup(t,url=parentOrigin+'/BWU2/results?s=tsXone',html='<div id="tm-v4-tote"><span data-container>tsXone</span><section data-system></section><input></div>'){
 const dom=new JSDOM('<head></head><body>'+html+'</body>',{url,runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window;
 Object.defineProperty(w.navigator,'locks',{configurable:true,value:{request:async(_name,_opts,work)=>work({})}});return w;
}
function helper(t,w,options={}){const api=createStowHelper({window:w,version:'test',reader:{product:async()=>({product:null})},operate:async()=>{throw new Error('Unexpected operation');},print:async()=>{},...options});t.after(api.dispose);return api;}
function delayOwner(w){let acquire;Object.defineProperty(w.navigator,'locks',{configurable:true,value:{request:(_name,_opts,work)=>new Promise((resolve,reject)=>{acquire=()=>Promise.resolve(work({})).then(resolve,reject);})}});return()=>acquire();}
function changeSource(w,api,value){w.document.querySelector('[data-container]').textContent=value;api.refresh();}
function nativeWorker(t,mode,driver,options={}){
 const host=mode==='move'?'https://aft-moveapp-nrt-nrt.nrt.proxy.amazon.com/move-container':'https://tx-b-hierarchy-nrt.nrt.proxy.amazon.com/unbindHierarchy';
 const w=setup(t,host+'?tmV4ParentOrigin='+encodeURIComponent(parentOrigin)+'#tm-v4-worker='+nonce,''),messages=[],parent={postMessage:data=>messages.push(data)};Object.defineProperty(w,'parent',{value:parent});
 const stop=serveOperationBridge({window:w,mode,driver,identity:()=>({login:'fixture'}),...options});t.after(stop);
 const run=()=>w.dispatchEvent(new w.MessageEvent('message',{origin:parentOrigin,source:parent,data:{protocol:'tm-v4.operation',nonce,type:'run',row:{id:'request-once',container:'tsXone',destination:'dz-P-PRIME'}}}));
 return{w,messages,stop,run,key:mode==='move'?'tm-v4.drop.rows':'tm-v4.hierarchy.rows'};
}

test('Stow clicked A cannot become B after delayed ownership, including A to B to A',async t=>{
 for(const sources of [['tsXtwo'],['tsXtwo','tsXone']])await t.test(sources.join(' → '),async t=>{
  const w=setup(t),release=delayOwner(w);let calls=0;const api=helper(t,w,{operate:async()=>{calls++;return{verifiedBy:'fixture'};}});
  const pending=api.act('move','dz-P-PRIME');for(const source of sources)changeSource(w,api,source);release();await pending;
  assert.equal(calls,0);assert.equal(api.getRows().length,0);assert.equal(w.localStorage.getItem('tm-v4.stow.rows'),null);
 });
});
test('Stow rechecks current source after ownership even before a refresh callback',async t=>{
 const w=setup(t),release=delayOwner(w);let calls=0;const api=helper(t,w,{operate:async()=>{calls++;return{verifiedBy:'fixture'};}});const pending=api.act('unbind','');
 w.document.querySelector('[data-container]').textContent='tsXtwo';release();await pending;assert.equal(calls,0);assert.equal(api.getRows().length,0);
});
test('disposed Stow parent creates no ledger or operation after delayed ownership',async t=>{
 const w=setup(t),release=delayOwner(w);let calls=0,evidence=0,focus=0;const api=helper(t,w,{operate:async()=>{calls++;return{verifiedBy:'fixture'};},onEvidence:()=>evidence++});w.document.querySelector('input').focus=()=>focus++;
 const pending=api.act('unbind','');api.dispose();release();await pending;assert.equal(calls,0);assert.equal(api.getRows().length,0);assert.equal(w.localStorage.getItem('tm-v4.stow.rows'),null);assert.equal(evidence,0);assert.equal(focus,0);
 await api.act('move','dz-P-PRIME');assert.equal(calls,0);
});
test('changed source closes the waiting native bridge before any worker handoff',async t=>{
 const w=setup(t),api=helper(t,w,{operate:createOperationBridge({window:w,readyMs:1000})});let settled=false;const pending=api.act('move','dz-P-PRIME').then(()=>settled=true);await until(()=>w.document.querySelector('iframe'));const frame=w.document.querySelector('iframe');let handoffs=0;frame.contentWindow.postMessage=()=>handoffs++;
 changeSource(w,api,'tsXtwo');await tick();assert.equal(settled,true);await pending;assert.equal(frame.isConnected,false);assert.equal(handoffs,0);assert.equal(api.getRows()[0].container,'tsXone');assert.equal(api.getRows()[0].state,'REJECTED');
});
test('a click accepted before display refresh uses its exact current source and can complete normally',async t=>{
 const w=setup(t),release=delayOwner(w);let captured;const api=helper(t,w,{operate:async(row,options)=>{captured=row.container;options.checkRunning();options.beforeMutation();return{verifiedBy:'native-exact-location'};}});
 w.document.querySelector('[data-container]').textContent='tsXtwo';const pending=api.act('move','dz-P-PRIME');api.refresh();release();await pending;assert.equal(captured,'tsXtwo');assert.equal(api.getRows()[0].state,'CONFIRMED');
});
test('disposed parent closes the waiting native bridge and retains its unsent rejection',async t=>{
 const w=setup(t),api=helper(t,w,{operate:createOperationBridge({window:w,readyMs:1000})});const pending=api.act('unbind','');await until(()=>w.document.querySelector('iframe'));api.dispose();await pending;
 assert.equal(w.document.querySelector('iframe'),null);assert.equal(api.getRows()[0].state,'REJECTED');
});
test('a submitted Stow operation settles for clicked A despite later source changes and prints once',async t=>{
 const w=setup(t);let settle,signal,prints=0,captured;const api=helper(t,w,{operate:async(row,options)=>{captured=row.container;signal=options.signal;options.beforeMutation();return new Promise(resolve=>settle=resolve);},print:async(destination,quantity)=>{assert.equal(destination,'dz-P-PRIME');assert.equal(quantity,2);prints++;}});
 const print=w.document.querySelector('[data-setting=print]');print.checked=true;print.dispatchEvent(new w.Event('change',{bubbles:true}));const pending=api.act('move','dz-P-PRIME');await until(()=>settle);changeSource(w,api,'tsXtwo');assert.equal(signal.aborted,false);settle({verifiedBy:'native-exact-location'});await pending;
 assert.equal(captured,'tsXone');assert.equal(api.getRows()[0].container,'tsXone');assert.equal(api.getRows()[0].state,'CONFIRMED');assert.equal(prints,1);
});
test('submitted Stow disposal retains UNKNOWN and ignores a late successful callback without printing or replay',async t=>{
 const w=setup(t);let settle,calls=0,prints=0;let api=helper(t,w,{operate:async(_row,options)=>{calls++;options.beforeMutation();return new Promise(resolve=>settle=resolve);},print:async()=>prints++});
 const print=w.document.querySelector('[data-setting=print]');print.checked=true;print.dispatchEvent(new w.Event('change',{bubbles:true}));const pending=api.act('move','dz-P-PRIME');await until(()=>settle);api.dispose();settle({verifiedBy:'late-native'});await pending;assert.equal(api.getRows()[0].state,'UNKNOWN');assert.equal(prints,0);
 api=helper(t,w,{operate:async()=>{calls++;return{verifiedBy:'unexpected'};}});await api.act('move','dz-P-PRIME');assert.equal(calls,1);assert.equal(api.getRows()[0].state,'UNKNOWN');
});
for(const mode of ['move','unbind'])test('disposed '+mode+' native worker cannot start after delayed ownership',async t=>{
 let calls=0,identities=0,evidence=0;const worker=nativeWorker(t,mode,async()=>calls++,{identity:()=>{identities++;return{login:'fixture'};},onEvidence:()=>evidence++}),release=delayOwner(worker.w);worker.run();worker.stop();release();await tick();await tick();
 assert.equal(calls,0);assert.equal(identities,0);assert.equal(evidence,0);assert.equal(worker.w.localStorage.getItem(worker.key),null);
});
test('native worker disposal during submitted work retains UNKNOWN after late success',async t=>{
 let settle;const evidence=[],worker=nativeWorker(t,'unbind',async(_row,options)=>{options.beforeMutation();return new Promise(resolve=>settle=resolve);},{onEvidence:record=>evidence.push(record)});worker.run();await until(()=>settle);worker.stop();settle({verifiedBy:'late-native'});await tick();await tick();
 const row=JSON.parse(worker.w.localStorage.getItem(worker.key)).rows[0];assert.equal(row.state,'UNKNOWN');assert.deepEqual(evidence.filter(record=>record.type==='operation').map(record=>record.phase),['SUBMITTED','UNKNOWN']);assert(!worker.messages.some(message=>message.type==='result'));
});
for(const mode of ['move','unbind'])test('unchanged '+mode+' worker still owns native preflight and records one confirmed operation',async t=>{
 let calls=0;const evidence=[],worker=nativeWorker(t,mode,async(_row,options)=>{calls++;options.checkRunning();options.beforeMutation();return{verifiedBy:'native-exact-proof'};},{onEvidence:record=>evidence.push(record)});worker.run();await until(()=>worker.messages.some(message=>message.type==='result'));
 assert.equal(calls,1);assert.equal(JSON.parse(worker.w.localStorage.getItem(worker.key)).rows[0].state,'CONFIRMED');assert.equal(worker.messages.find(message=>message.type==='result').outcome,'CONFIRMED');assert.deepEqual(evidence.filter(record=>record.type==='operation').map(record=>record.phase),['SUBMITTED','CONFIRMED']);worker.run();await tick();assert.equal(calls,1);
});
test('already cancelled parent bridge creates no frame or handoff',async t=>{
 const w=setup(t),controller=new w.AbortController();controller.abort();let submissions=0;const operate=createOperationBridge({window:w});const append=w.document.body.append;let frames=0;w.document.body.append=function(...nodes){frames+=nodes.filter(node=>node.tagName==='IFRAME').length;return append.apply(this,nodes);};
 await assert.rejects(operate({id:'row',container:'tsXone'},{mode:'unbind',signal:controller.signal,beforeMutation:()=>submissions++}),error=>error.outcome==='REJECTED');assert.equal(frames,0);assert.equal(submissions,0);
});

for(const close of [false,true])test('generated Stow cancels delayed clicked-source startup: '+(close?'closure':'source change'),async t=>{
 const w=setup(t),release=delayOwner(w);w.unsafeWindow=w;w.fetch=async()=>{throw new Error('No native operation permitted');};w.GM_xmlhttpRequest=()=>{throw new Error('No live request');};
 w.eval(readFileSync(new URL('../Stow_Andons_Helper.user.js',import.meta.url),'utf8'));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));await tick();await tick();
 w.document.querySelector('[data-drop]').click();
 if(close)w.dispatchEvent(new w.Event('pagehide'));else{w.document.querySelector('[data-container]').textContent='tsXtwo';await tick();}
 release();await tick();await tick();assert.equal(w.localStorage.getItem('tm-v4.stow.rows'),null);assert.equal(w.document.querySelector('iframe'),null);
});
