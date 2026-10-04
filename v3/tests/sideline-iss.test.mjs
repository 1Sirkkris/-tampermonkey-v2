import assert from 'node:assert/strict';
import {harness,tick} from './harness.mjs';
const modules=['core.js','state.js','transport.js','identity.js','native.js','sideline.js','sideline-ui.js','sideline-native.js'];
const mountRoot=h=>{const root=h.w.document.createElement('div');root.dataset.bwu2Ui='1';h.w.document.body.appendChild(root);return root;};
const choose=(h,year)=>{for(const [part,value] of [['month',12],['day',1],['year',year]]){const button=h.w.document.querySelector(`[data-part="${part}"][data-value="${value}"]`);assert.ok(button&&!button.disabled);button.click();}};
// Native date discovery must work after reload, without observing an earlier scan.
for(const production of [false,true]){
 const h=harness({modules,html:`<div>Enter ${production?'production':'expiration'} date displayed on item</div><input placeholder="MM"><input placeholder="DD"><input placeholder="YYYY"><button id="confirm-button">Confirm</button>`});
 try{
  let submitted=0;h.w.document.getElementById('confirm-button').onclick=()=>submitted++;
  const life=h.V3.core.lifecycle('native-date');h.V3.sidelineNative.dateHelper({life});
  assert.ok(h.w.document.querySelector('.v3-expiry'));
  const year=new Date().getFullYear()+(production?-1:1);choose(h,year);await tick();
  assert.equal(h.w.document.querySelector('.v3-expiry'),null);assert.equal(submitted,1);
  assert.deepEqual([...h.w.document.querySelectorAll('main input')].map(el=>el.value),['12','01',String(year)]);
  // Native rendering after submit must not reopen or resubmit the same screen.
  h.w.document.querySelector('main').appendChild(h.w.document.createElement('span'));await tick();assert.equal(submitted,1);assert.equal(h.w.document.querySelector('.v3-expiry'),null);
  h.w.document.querySelector('main').innerHTML='<div>Scan item</div>';await tick();
  h.w.document.querySelector('main').innerHTML='<div>Enter expiration date</div><input placeholder="MM"><input placeholder="DD"><input placeholder="YYYY"><button id="confirm-button">Confirm</button>';await tick();assert.ok(h.w.document.querySelector('.v3-expiry'));
  life.dispose();await tick();assert.equal(h.w.document.querySelector('.v3-expiry'),null);
 }finally{h.close();}
}
// Invalid/leap dates stay disabled; Lazy selection resolves on YEAR, once.
{
 const h=harness({modules});try{
  const life=h.V3.core.lifecycle('picker');const year=new Date().getFullYear()+1;
  const picked=h.V3.sidelineUI.pickDate({ctx:{dateType:'EXPIRATION_DATE'},life});choose(h,year);
  assert.equal((await picked).enteredMs,new Date(year,11,1).getTime());
  const leap=h.V3.sidelineUI.pickDate({ctx:{dateType:'EXPIRATION_DATE'},life});
  h.w.document.querySelector('[data-part="month"][data-value="2"]').click();h.w.document.querySelector('[data-part="day"][data-value="29"]').click();
  const nonLeap=Array.from({length:5},(_,i)=>year+i).find(y=>y%4!==0);assert.equal(h.w.document.querySelector(`[data-part="year"][data-value="${nonLeap}"]`).disabled,true);
  h.w.document.querySelector('[data-cancel]').click();assert.equal(await leap,null);
 }finally{h.close();}
}
// Quantity helper works with native div headings, uses native input events, and toggles.
{
 const h=harness({modules,url:'https://aft-poirot-website-nrt.nrt.proxy.amazon.com/',html:'<div>Verify item</div><button id="confirm-button">Confirm</button>'});try{
  let qty=null;h.w.document.getElementById('confirm-button').onclick=()=>{h.w.document.querySelector('main').innerHTML='<div>Enter quantity</div><input id="scan-text-input"><button id="confirm-button">Confirm</button>';h.w.document.getElementById('confirm-button').onclick=()=>{qty=h.w.document.getElementById('scan-text-input').value;};};
  h.load('pandash.js');h.load('apps/sideline.js');h.V3.boot();
  const toggle=h.w.document.querySelector('[data-v3-button="sideline-qty"]');toggle.click();
  const panel=h.w.document.querySelector('[data-bwu2-v3-panel="sideline-qty"]');assert.equal(panel.hidden,false);assert.equal(panel.querySelectorAll('[data-qty]').length,10);
  panel.querySelector('[data-qty="7"]').click();await tick();await tick();assert.equal(qty,'7');
  toggle.click();assert.equal(panel.hidden,true);toggle.click();assert.equal(panel.hidden,false);
  assert.equal(h.sharedLocks.active.size,0);
 }finally{h.close();}
}
// Queue STOP during validation prevents close; a second STOP clears ordinary rows.
{
 const h=harness({modules});try{
  const work=mountRoot(h),life=h.V3.core.lifecycle('queue');let releaseSource,closes=0;
  const ui=h.V3.sidelineNative.mountQueue(work,{life,prefix:'test.queue',engine:{source:()=>new Promise(resolve=>{releaseSource=resolve;}),close:async()=>{closes++;}}});await tick();
  work.querySelector('[data-input]').value='tsX111\ntsX222';const running=work.querySelector('[data-run]').onclick();await tick();assert.equal(ui.isBusy,true);
  await work.querySelector('[data-stop]').onclick();releaseSource({});await running;assert.equal(closes,0);assert.equal(ui.isBusy,false);
  await work.querySelector('[data-stop]').onclick();assert.equal(work.querySelector('[data-input]').value,'');assert.equal(work.querySelectorAll('.v3-list-row').length,0);assert.equal(h.sharedLocks.active.size,0);
 }finally{h.close();}
}
// An uncertain close remains quarantined across STOP/reset/reload, without resend.
{
 const h=harness({modules});try{
  const life=h.V3.core.lifecycle('unknown-queue');let calls=0;const engine={source:async()=>({}),close:async code=>{calls++;const op=h.V3.core.operation({kind:'sideline-close',ref:code,scope:'sideline'});op.submitted();op.unknown();throw new h.V3.core.UnknownError('Verify close');}};
  const work=mountRoot(h);h.V3.sidelineNative.mountQueue(work,{life,engine,prefix:'unknown.queue'});await tick();
  work.querySelector('[data-input]').value='tsX111\ntsX222';await work.querySelector('[data-run]').onclick();await work.querySelector('[data-stop]').onclick();
  assert.equal(calls,1);assert.equal(work.querySelectorAll('.v3-list-row').length,1);assert.match(work.querySelector('[data-list]').textContent,/ATTENTION/);assert.ok(h.V3.state.attention('sideline'));
  await work.querySelector('[data-run]').onclick();assert.equal(calls,1);
  const next=mountRoot(h);h.V3.sidelineNative.mountQueue(next,{life,engine,prefix:'unknown.queue'});await tick();assert.match(next.querySelector('[data-list]').textContent,/ATTENTION/);assert.equal(calls,1);
 }finally{h.close();}
}
// Stop while Lazy reads are pending cancels preflight and sends no mutation.
{
 const h=harness({modules});try{
  const work=mountRoot(h),life=h.V3.core.lifecycle('stop-preflight');let moves=0,sources=0,reads=0;
  const engine={preflight:(_src,_code,{signal})=>{reads++;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new h.w.DOMException('Aborted','AbortError')),{once:true}));},source:async()=>{sources++;},move:async()=>{moves++;}};
  h.V3.sidelineUI.mount(work,{life,engine,prefix:'stop.preflight'});work.querySelector('[data-source]').value='tsX111';work.querySelector('[data-dest]').value='tsX222';work.querySelector('[data-items]').value='X111';
  const running=work.querySelector('[data-run]').onclick();await tick();assert.equal(reads,1);work.querySelector('[data-stop]').click();await running;
  assert.equal(moves,0);assert.equal(sources,0);assert.equal(work.querySelector('[data-items]').value,'X111');
  work.querySelector('[data-stop]').click();assert.equal(work.querySelector('[data-items]').value,'');assert.equal(work.querySelector('[data-source]').value,'');assert.equal(work.querySelector('[data-dest]').value,'');assert.equal(h.sharedLocks.active.size,0);
 }finally{h.close();}
}
// ISS Edit reaches the native bridge, processes success, and exits a startup timeout.
{
 const h=harness({url:'https://aft-poirot-website-nrt.nrt.proxy.amazon.com/#iss-console',modules:[...modules,'pandash.js','aft.js','workflow-ui.js','bridge.js']});try{
  h.load('apps/iss.js');h.V3.boot();h.w.document.querySelector('[data-tab="edit"]').click();
  const panel=h.w.document.querySelector('[data-bwu2-v3-panel="iss-console"]');panel.querySelector('[data-field="items"]').value='X111';
  const running=panel.querySelector('[data-run]').onclick();await tick();const frame=h.w.document.querySelector('iframe');assert.ok(frame);
  let request;frame.contentWindow.postMessage=msg=>{if(msg.type==='run')request=msg;};
  const send=data=>h.w.dispatchEvent(new h.w.MessageEvent('message',{origin:h.V3.aft.DEFAULT_ORIGIN,source:frame.contentWindow,data:{protocol:'bwu2.v3.bridge',family:'aft',...data}}));
  send({type:'ready'});await tick();assert.equal(request.command,'edit.sku');assert.equal(typeof request.payload.onProgress,'undefined');
  send({type:'result',id:request.id,ok:true,data:{flipped:1,total:1,remaining:[],failed:[]}});await running;
  assert.match(panel.querySelector('[data-status]').textContent,/DONE/);assert.equal(panel.querySelector('[data-run]').disabled,false);
 }finally{h.close();}
 const timeout=harness({url:'https://aft-poirot-website-nrt.nrt.proxy.amazon.com/#iss-console',modules:[...modules,'pandash.js','aft.js','workflow-ui.js','bridge.js']});try{
  const setTimeout=timeout.w.setTimeout;timeout.w.setTimeout=(fn,ms,...args)=>setTimeout.call(timeout.w,fn,ms===20000?0:ms,...args);
  timeout.load('apps/iss.js');timeout.V3.boot();timeout.w.document.querySelector('[data-tab="edit"]').click();const panel=timeout.w.document.querySelector('[data-bwu2-v3-panel="iss-console"]');panel.querySelector('[data-field="items"]').value='X111';await panel.querySelector('[data-run]').onclick();
  assert.match(panel.querySelector('[data-status]').textContent,/worker not ready/);assert.equal(panel.querySelector('[data-run]').disabled,false);assert.equal(panel.querySelector('[data-field="items"]').value,'X111');
 }finally{timeout.close();}
}
console.log('PASS Sideline/ISS batch: native date reload/transition, auto YEAR, leap-date rejection, QTY 1–10/toggle, two-stage STOP, UNKNOWN quarantine, preflight abort, ISS bridge success/startup failure');
// ISS STOP during worker startup must not submit a run later when READY arrives.
{
 const h=harness({url:'https://aft-poirot-website-nrt.nrt.proxy.amazon.com/#iss-console',modules:[...modules,'pandash.js','aft.js','workflow-ui.js','bridge.js']});try{
  h.load('apps/iss.js');h.V3.boot();h.w.document.querySelector('[data-tab="edit"]').click();const panel=h.w.document.querySelector('[data-bwu2-v3-panel="iss-console"]');panel.querySelector('[data-field="items"]').value='X111';
  const pending=panel.querySelector('[data-run]').onclick();await tick();const frame=h.w.document.querySelector('iframe'),source=frame.contentWindow;let sent=0;source.postMessage=msg=>{if(msg.type==='run')sent++;};
  panel.querySelector('[data-stop]').click();await pending;assert.equal(h.w.document.querySelector('iframe'),null);assert.match(panel.querySelector('[data-status]').textContent,/startup cancelled/);assert.equal(panel.querySelector('[data-run]').disabled,false);
  h.w.dispatchEvent(new h.w.MessageEvent('message',{origin:h.V3.aft.DEFAULT_ORIGIN,source,data:{protocol:'bwu2.v3.bridge',family:'aft',type:'ready'}}));await tick();assert.equal(sent,0);assert.equal(panel.querySelector('[data-field="items"]').value,'X111');
 }finally{h.close();}
}
// STOP after dispatch but before progress retains UNKNOWN; after progress it waits for result.
for(const progress of [false,true]){
 const h=harness({url:'https://aft-poirot-website-nrt.nrt.proxy.amazon.com/#iss-console',modules:[...modules,'pandash.js','aft.js','workflow-ui.js','bridge.js']});try{
  h.load('apps/iss.js');h.V3.boot();h.w.document.querySelector('[data-tab="edit"]').click();const panel=h.w.document.querySelector('[data-bwu2-v3-panel="iss-console"]');panel.querySelector('[data-field="items"]').value='X111';const pending=panel.querySelector('[data-run]').onclick();await tick();const frame=h.w.document.querySelector('iframe');let request,stops=0;frame.contentWindow.postMessage=msg=>{if(msg.type==='run')request=msg;if(msg.type==='stop')stops++;};
  const send=data=>h.w.dispatchEvent(new h.w.MessageEvent('message',{origin:h.V3.aft.DEFAULT_ORIGIN,source:frame.contentWindow,data:{protocol:'bwu2.v3.bridge',family:'aft',...data}}));send({type:'ready'});await tick();assert.ok(request);
  if(progress)send({type:'progress',id:request.id,progress:{stage:'source',current:1,total:1,confirmed:0}});
  panel.querySelector('[data-stop]').click();assert.equal(stops,1);
  if(progress){assert.ok(frame.isConnected);send({type:'result',id:request.id,ok:true,data:{stopped:true,confirmed:0,total:1,remaining:['X111']}});await pending;assert.match(panel.querySelector('[data-status]').textContent,/STOPPED/);assert.equal(panel.querySelector('[data-field="items"]').value,'X111');}
  else{await pending;assert.equal(frame.isConnected,false);assert.match(panel.querySelector('[data-status]').textContent,/OUTCOME UNKNOWN/);assert.equal(panel.querySelector('[data-run]').disabled,true);}
 }finally{h.close();}
}
console.log('PASS ISS STOP: startup cannot submit later; uncertain dispatch quarantined; active progress finishes current action');
