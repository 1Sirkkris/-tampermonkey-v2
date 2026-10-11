import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {AFT_MODES, createAftClient} from '../aft-client.mjs';
import {AFT_KEY, createAftRunner, parseAftRows} from '../aft-workflow.mjs';

function owned(t) {
 const dom=new JSDOM('<body>',{url:'https://aft-qt-nrt.corp.amazon.com/app/edititems'}),w=dom.window;
 t.after(()=>w.close());
 w.navigator.locks={request:async(name,_options,work)=>work({name})};
 return w;
}
const skuRows=()=>parseAftRows('sku','X000000001',{currentState:'INVENTORY',desiredState:'PENDING_RESEARCH'});
function skuNative(t,{results=['http'],quantity=2,readFailure=false,endFailure=false}={}) {
 const w=owned(t),calls=[],phases=[];let step='item',object=1,confirms=0,ends=0,status='READY';
 const texts={item:'Input FNSKU or FCSKU',sourceState:'Select source inventory state',newState:'Select new inventory state',confirm:'Confirm change',success:'Success items changed',error:'Failed to change consumer type'};
 function page(){return '<html><body><script type="a-state">'+JSON.stringify({objectId:'native-'+object,instructionId:'EditItems'})+'</script><h1>'+texts[step]+'</h1>'+(step==='sourceState'?'<label><input type="radio" value="SELLABLE">Owner: Amazon Quantity: '+quantity+' Sellable</label>':'')+'</body></html>';}
 const client=createAftClient({window:w,fetch:async(path,init)=>{
  const body=init.body?JSON.parse(init.body):null;calls.push({path,body});
  if(path.startsWith('/app/'))return new Response(page(),{status:readFailure?400:200});
  if(path==='/status')return new Response(status==='HTTP400'?'Unspecified status failure':JSON.stringify({status}),{status:status==='HTTP400'?400:200});
  if(path==='/end'){ends++;if(endFailure)return new Response('End outcome unspecified',{status:400});object++;step='item';status='READY';return new Response('');}
  assert.equal(path,'/action');
  if(body.action==='Confirm'){
   confirms++;assert.equal(JSON.parse(w.localStorage.getItem(AFT_KEY)).rows.at(-1).state,'SUBMITTED');
   const result=results[Math.min(confirms-1,results.length-1)];
   if(result==='http')return new Response('{"message":"upstream failure; outcome unspecified"}',{status:400});
   if(result==='lost')throw new Error('Confirmation response lost');
   if(result==='errored')status='ERRORED';
   else if(result==='consumerRejected')step='error';
   else if(result==='status400')status='HTTP400';
   else {quantity--;step='success';}
  } else if(body.action==='Done')status='COMPLETE';
  else step=step==='item'?'sourceState':step==='sourceState'?'newState':'confirm';
  return new Response('');
 }});
 const runner=createAftRunner({window:w,client,identity:()=>({login:'operator'}),onEvidence:record=>phases.push(record.phase)});
 t.after(runner.dispose);
 return {w,client,runner,calls,phases,get confirms(){return confirms;},get ends(){return ends;}};
}

for(const result of ['http','lost','status400'])test('actual SKU '+result+' after Confirm preserves one UNKNOWN and cannot replay through Run/Clear/reload',async t=>{
 const native=skuNative(t,{results:[result]});await native.runner.run(skuRows());
 assert.equal(native.confirms,1);assert.equal(native.ends,0);assert.equal(native.runner.rows[0].state,'UNKNOWN');
 assert.deepEqual(native.phases,['SUBMITTED','UNKNOWN']);
 await native.runner.run(skuRows());await native.runner.clear();assert.equal(native.runner.rows[0].state,'UNKNOWN');
 const restored=createAftRunner({window:native.w,client:native.client,identity:()=>({})});t.after(restored.dispose);
 await restored.run(skuRows());await assert.rejects(restored.switchMode('each',{navigate:false}),/Resolve\/clear/);
 assert.equal(native.confirms,1);assert.equal(native.ends,0);assert.equal(restored.rows[0].state,'UNKNOWN');
});

test('actual SKU retains already confirmed progress when a later Confirm receives an ambiguous HTTP400',async t=>{
 const native=skuNative(t,{results:['success','http']});await native.runner.run(skuRows());
 assert.equal(native.confirms,2);assert.equal(native.ends,1);assert.equal(native.runner.rows[0].state,'UNKNOWN');
 assert.equal(native.runner.rows[0].completedOperations.length,1);
 assert.deepEqual(native.phases,['SUBMITTED','CONFIRMED','SUBMITTED','UNKNOWN']);
 await native.runner.clear();assert.equal(native.runner.rows[0].completedOperations.length,1);
 assert.equal(native.confirms,2);assert.equal(native.ends,1);
});

test('actual typed native ERRORED retains bounded fresh-workflow recovery and new source quantity reads',async t=>{
 const native=skuNative(t,{results:['errored','success'],quantity:1});await native.runner.run(skuRows());
 assert.equal(native.runner.rows[0].state,'CONFIRMED');assert.equal(native.confirms,2);assert.equal(native.ends,3);
 assert.deepEqual(native.phases,['SUBMITTED','REJECTED','SUBMITTED','CONFIRMED']);
 const lookupInputs=native.calls.filter(call=>call.path==='/action'&&call.body.action==='Input'&&call.body.input==='X000000001');
 assert.equal(lookupInputs.length,3);
 assert.notEqual(lookupInputs[0].body.id.objectId,lookupInputs[1].body.id.objectId);
});

test('actual repeatedly typed native ERRORED stops at the existing three attempts',async t=>{
 const native=skuNative(t,{results:['errored']});await native.runner.run(skuRows());
 assert.equal(native.confirms,3);assert.equal(native.ends,2);assert.equal(native.runner.rows[0].state,'REJECTED');
 assert.deepEqual(native.phases,['SUBMITTED','REJECTED','SUBMITTED','REJECTED','SUBMITTED','REJECTED']);
});

test('an HTTP400 during initial read remains an unsent rejection and Clear permits a deliberate fresh start',async t=>{
 const native=skuNative(t,{readFailure:true});await native.runner.run(skuRows());
 assert.equal(native.runner.rows[0].state,'REJECTED');assert.equal(native.confirms,0);assert.equal(native.ends,0);
 assert(!native.calls.some(call=>call.path==='/action'));assert.deepEqual(native.phases,[]);
 await native.runner.clear();assert.equal(native.runner.rows.length,0);
});

test('normal actual SKU success still confirms once and verifies the native source reaches zero',async t=>{
 const native=skuNative(t,{results:['success'],quantity:1});await native.runner.run(skuRows());
 assert.equal(native.runner.rows[0].state,'CONFIRMED');assert.equal(native.confirms,1);assert.equal(native.ends,2);
 assert.equal(native.runner.rows[0].completedOperations.length,1);assert.deepEqual(native.phases,['SUBMITTED','CONFIRMED']);
 assert.match(native.runner.rows[0].message,/quantity zero/);
});

test('generic action HTTP4xx never supplies native rejection evidence to any shared AFT mode',async t=>{
 const w=owned(t);
 for(const mode of ['each','sku','date','flip','moveEach','moveAll']){
  const client=createAftClient({window:w,fetch:async()=>new Response('Unspecified failure',{status:mode==='sku'?429:400})});
  await assert.rejects(client.action(AFT_MODES[mode],'native-id','Confirm','Confirm'),error=>error.outcome!=='REJECTED');
 }
});

function otherNative(t,mode,{result='http',oldDate=false}={}) {
 const w=owned(t),definition=AFT_MODES[mode],calls=[],phases=[];
 let step='location',mutations=0,ends=0,moved=false,complete=false;
 const texts={location:definition.tool==='moveitems'||mode==='flip'?'Scan container':'Scan location',item:'Scan item',newState:'Select new inventory state',confirm:mode==='flip'?'Confirm Flip':'Confirm change',old:'Input item FNSKUs',new:'Enter new FCSKU',dateRemove:'Confirm expiry date removal',dateEntry:'Enter expiry date',dateConfirm:'Confirm new expiry date',destination:'Scan destination container',success:mode==='flip'?'Success':definition.tool==='moveitems'?'Items moved':'Success items changed'};
 const client=createAftClient({window:w,fetch:async(path,init)=>{
  const body=init.body?JSON.parse(init.body):null;calls.push({path,body});
  if(path.startsWith('/app/'))return new Response('<html><body><script type="a-state">'+JSON.stringify({instructionId:definition.instructionId,objectId:'native-'+mode})+'</script><h1>'+texts[step]+'</h1></body></html>');
  if(path==='/status')return new Response(JSON.stringify({status:complete?'COMPLETE':'READY'}));
  if(path==='/end'){ends++;return new Response('');}
  assert.equal(path,'/action');
  const mutation=body.action==='Confirm'||step==='destination';
  if(mutation){
   mutations++;assert.equal(JSON.parse(w.localStorage.getItem(AFT_KEY)).rows.at(-1).state,'SUBMITTED');
   if(result==='http')return new Response('The action outcome is unspecified',{status:400});
   moved=true;step='success';
  }else if(body.action==='Done')complete=true;
  else if(mode==='each')step=step==='location'?'item':step==='item'?'newState':'confirm';
  else if(mode==='date')step=step==='location'?'item':step==='item'?(oldDate?'dateRemove':'dateEntry'):'dateConfirm';
  else if(mode==='flip')step=step==='location'?'old':step==='old'?'new':'confirm';
  else step=step==='location'?'item':'destination';
  return new Response('');
 }});
 const reader={product:async()=>({complete:true,product:{fnsku:'X000000001'}}),inventory:async container=>({complete:true,rows:[{container,fnsku:'X000000001',qty:container==='tsXsource'?(moved?1:2):(moved?1:0)}]})};
 const runner=createAftRunner({window:w,client,reader,identity:()=>({}),onEvidence:record=>phases.push(record.phase)});t.after(runner.dispose);
 const item={mode,location:'tsXsource',code:'X000000001',source:'tsXsource',destination:'tsXdest',newCode:'X000000002',date:'2026-10-11',desiredState:'PENDING_RESEARCH'};
 return{w,runner,calls,phases,item,get mutations(){return mutations;},get ends(){return ends;}};
}

for(const mode of ['each','date','flip','moveEach'])for(const result of ['http','success'])test('actual '+mode+' '+result+' uses the shared classification without changing normal native steps',async t=>{
 const native=otherNative(t,mode,{result});await native.runner.run([native.item]);
 assert.equal(native.mutations,1);assert.equal(native.runner.rows[0].state,result==='http'?'UNKNOWN':'CONFIRMED');
 assert.deepEqual(native.phases,['SUBMITTED',result==='http'?'UNKNOWN':'CONFIRMED']);
 assert.equal(native.ends,result==='http'?0:1);
 if(result==='http'){
  await native.runner.clear();await native.runner.run([native.item]);
  assert.equal(native.mutations,1);assert.equal(native.runner.rows[0].state,'UNKNOWN');assert.equal(native.ends,0);
 }
});

test('actual old-date removal HTTP400 retains UNKNOWN and never starts replacement',async t=>{
 const native=otherNative(t,'date',{oldDate:true});await native.runner.run([native.item]);
 assert.equal(native.mutations,1);assert.equal(native.runner.rows[0].state,'UNKNOWN');assert.equal(native.ends,0);
 assert(!native.calls.some(call=>call.body?.input?.includes?.('year-input')));
});

test('Stop/Clear while actual SKU Confirm is pending settles the single uncertain operation and retains it',async t=>{
 const w=owned(t),phases=[];let step='item',confirms=0,ends=0,release,confirmSignal;
 const texts={item:'Input FNSKU or FCSKU',sourceState:'Select source inventory state',newState:'Select new inventory state',confirm:'Confirm change'};
 const client=createAftClient({window:w,fetch:async(path,init)=>{
  if(path.startsWith('/app/'))return new Response('<html><body><script type="a-state">{"instructionId":"EditItems","objectId":"pending"}</script><h1>'+texts[step]+'</h1>'+(step==='sourceState'?'<label><input type="radio" value="SELLABLE">Owner: Amazon Quantity: 2 Sellable</label>':'')+'</body></html>');
  if(path==='/status')return new Response('{"status":"READY"}');
  if(path==='/end'){ends++;return new Response('');}
  const body=JSON.parse(init.body);
  if(body.action==='Confirm'){confirms++;confirmSignal=init.signal;return new Promise(resolve=>release=()=>resolve(new Response('Outcome unspecified',{status:400})));}
  step=step==='item'?'sourceState':step==='sourceState'?'newState':'confirm';return new Response('');
 }});
 const runner=createAftRunner({window:w,client,identity:()=>({}),onEvidence:record=>phases.push(record.phase)});t.after(runner.dispose);
 const running=runner.run(skuRows());for(let i=0;i<50&&!release;i++)await new Promise(resolve=>setTimeout(resolve,0));assert(release);
 runner.stop();let cleared=false;const clearing=runner.clear().then(()=>cleared=true);
 assert.equal(confirmSignal.aborted,false);assert.equal(cleared,false);assert.equal(runner.rows[0].state,'SUBMITTED');
 release();await running;await clearing;assert.equal(confirms,1);assert.equal(ends,0);assert.equal(runner.rows[0].state,'UNKNOWN');
 assert.deepEqual(phases,['SUBMITTED','UNKNOWN']);
});

test('Stop during actual initial SKU read cancels unsent work and creates no submission barrier',async t=>{
 const w=owned(t);let readSignal,started=false,actions=0;
 const client=createAftClient({window:w,fetch:async(path,init)=>{
  if(!path.startsWith('/app/')){actions++;assert.fail('Cancelled preflight must send no action/status');}
  readSignal=init.signal;started=true;return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new w.DOMException('Cancelled','AbortError')),{once:true}));
 }});
 const runner=createAftRunner({window:w,client,identity:()=>({})});t.after(runner.dispose);
 const running=runner.run(skuRows());for(let i=0;i<50&&!started;i++)await new Promise(resolve=>setTimeout(resolve,0));assert(started);
 runner.stop();await running;assert.equal(readSignal.aborted,true);assert.equal(actions,0);assert.equal(runner.rows[0].state,'REJECTED');
 await runner.clear();assert.equal(runner.rows.length,0);
});


test('validated native consumer-type rejection retains existing bounded fresh-workflow recovery',async t=>{
 const native=skuNative(t,{results:['consumerRejected','success'],quantity:1});await native.runner.run(skuRows());
 assert.equal(native.runner.rows[0].state,'CONFIRMED');assert.equal(native.confirms,2);assert.equal(native.ends,3);
 assert.deepEqual(native.phases,['SUBMITTED','REJECTED','SUBMITTED','CONFIRMED']);
});

test('ambiguous End after confirmed SKU progress does not restart or erase the confirmed operation',async t=>{
 const native=skuNative(t,{results:['success'],quantity:2,endFailure:true});await native.runner.run(skuRows());
 assert.equal(native.confirms,1);assert.equal(native.ends,1);assert.equal(native.runner.rows[0].state,'UNKNOWN');
 assert.equal(native.runner.rows[0].completedOperations.length,1);assert.deepEqual(native.phases,['SUBMITTED','CONFIRMED']);
 await native.runner.clear();await native.runner.run(skuRows());assert.equal(native.confirms,1);assert.equal(native.ends,1);
 assert.equal(native.runner.rows[0].completedOperations.length,1);
});
