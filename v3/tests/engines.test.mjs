import assert from 'node:assert/strict';
import {harness,tick} from './harness.mjs';
const result=(data,{status=200,raw=JSON.stringify(data),finalUrl,flags={auth:false,html:false}}={})=>({status,raw,data,finalUrl,flags,httpError:status<200||status>=300});
const h=harness({url:'https://aft-poirot-website-nrt.nrt.proxy.amazon.com/',modules:['core.js','state.js','transport.js','identity.js','native.js','pandash.js','actions.js','sideline.js','aft.js','sideline-ui.js','workflow-ui.js','bridge.js']});
try{
 const C=h.V3.core,original=C.request,transport=h.V3.transport;let calls=[];
 const replaceRequest=handler=>{h.V3.transport={...transport,request:async(url,options)=>{calls.push({url,options});return handler(url,options);}};calls=[];};
 replaceRequest(()=>{throw new Error('connection lost');});await assert.rejects(h.V3.actions.moveContainer('tsX1','dz-P-PRIME'),error=>error.outcome==='unknown');assert.equal(calls.length,1);await assert.rejects(h.V3.actions.moveContainer('tsX1','dz-P-PRIME'),error=>error.outcome==='unknown');assert.equal(calls.length,1);assert.equal(h.V3.state.attention('movecontainer').state,'UNKNOWN');await h.V3.state.resolveAttention('movecontainer');
 replaceRequest(()=>result(null,{status:204,raw:''}));await h.V3.actions.moveContainer('tsX1','dz-P-PRIME');assert.equal(h.V3.state.attention('movecontainer'),null);
 // Sideline reads preserve error transport status; never interpret an HTTP500 error as a safe rejection.
 replaceRequest(()=>result({success:false,message:'Internal failure'},{status:500}));const engine=h.V3.sideline.create({telemetry:C.telemetry('sideline','test')});
 await assert.rejects(engine.close('tsX1',true),error=>error.outcome==='unknown');assert.equal(h.V3.state.attention('sideline').state,'UNKNOWN');await h.V3.state.resolveAttention('sideline');
 const sku={asin:'B012345678',fnSku:'X012345678',fcSku:'FC123',datelotDetail:{}};const ctx=h.V3.sideline.resolveItem({success:true,items:[{quantity:1,skuDetail:sku}]},'X012345678');
 await assert.rejects(engine.move({sourceContainer:'tsX1',destination:'csX1',preflightResult:{ctx},qty:1}),error=>error.outcome==='unknown');assert.equal(calls.length,2);await h.V3.state.resolveAttention('sideline');
 await assert.rejects(engine.move({sourceContainer:'tsX1',destination:'csX1',preflightResult:{ctx},qty:1.5}),/Whole/);assert.equal(calls.length,2);
 replaceRequest(()=>result({'@type':'CloseContainerResponse',success:true}));await engine.close('tsX1',true);assert.equal(JSON.parse(calls[0].options.body).containerEmpty,true);assert.equal(h.V3.state.attention('sideline'),null);
 h.V3.transport=transport;
 // Same-origin timeout aborts a hung transport, without retrying it.
 let requests=0;h.w.fetch=(_url,options)=>{requests++;return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new h.w.DOMException('Aborted','AbortError'))));};
 await assert.rejects(original(h.w.location.href,{timeout:5}),/Aborted/);assert.equal(requests,1);
 const flags=h.V3.transport.authLike(200,'text/html','https://midway.amazon.com/login','<html>Sign in to Amazon</html>');assert.equal(flags.auth,true);
 // AFT ERRORED after the mutation remains UNKNOWN; STOP cannot interrupt confirmation.
 h.V3.transport={...transport,request:async(url)=>url.endsWith('/status')?result({status:'ERRORED'}):result({})};
 const aft=h.V3.aft.create({life:{signal:new h.w.AbortController().signal,sleep:async()=>{}},telemetry:C.telemetry('aft','test')});const def=h.V3.aft.DEFINITIONS['edit:each'],wf={objectId:'wf1',status:'READY'},op=C.operation({kind:'aft-test',ref:'X1',scope:'aft'});
 await assert.rejects(aft.confirm(def,wf,{operation:op}),error=>error.outcome==='unknown');assert.equal(op.state,'UNKNOWN');await h.V3.state.resolveAttention('aft');
 // UI excludes a submitted UNKNOWN item while retaining items which were never submitted.
 h.V3.transport=transport;const work=h.w.document.createElement('div');h.w.document.body.appendChild(work);
 h.V3.workflowUI.mountMove(work,{prefix:'test.move',run:async()=>{throw new C.UnknownError('lost',{aftPartial:{remaining:['X3'],uncertain:['X2'],confirmed:1}});},resolveAttention:async()=>{}});
 work.querySelector('[data-field="items"]').value='X1\nX2\nX3';await work.querySelector('[data-run]').onclick();assert.equal(work.querySelector('[data-field="items"]').value,'X3');assert.equal(work.querySelector('[data-run]').disabled,true);
 console.log('PASS engines: lost responses, no UNKNOWN replay, close-source payload, mutation timeout, AFT ERRORED, remaining work');
}finally{h.close();}
const f=harness({url:'https://fcresearch-fe.aka.amazon.com/BWU2/results?s=tsX1',modules:['core.js','state.js','transport.js','identity.js','native.js','pandash.js','fcr-data.js']});
try{
 const head='<table id="table-inventory"><thead><tr><th>Container</th><th>ASIN</th><th>FNSKU</th><th>FCSKU</th><th>Quantity</th></tr></thead><tbody>',row='<tr><td>tsX1</td><td>B012345678</td><td>X012345678</td><td>FC123</td><td>1</td></tr>',first=head+row+'</tbody></table><span class="pagination-token">{"next":1}</span>';
 let responses=[first,row],requests=0;f.V3.transport={...f.V3.transport,request:async()=>({raw:responses[requests++]})};const engine=f.V3.fcr.create({});const inventory=await engine.inventory('tsX1');assert.equal(inventory.rows.length,2);assert.equal(inventory.totalQuantity,2);assert.equal(inventory.complete,true);
 responses=[first,'<html><p>Unexpected page</p></html>'];requests=0;await assert.rejects(engine.inventory('tsX1'),/incomplete/);
 responses=[first,head+row+'</tbody></table><span class="pagination-token">{"next":1}</span>'];requests=0;await assert.rejects(engine.inventory('tsX1'),/repeated/);
 console.log('PASS FCR: row-fragment pagination, missing rows, repeated tokens');
}finally{f.close();}
const bridge=harness({url:'https://parent.amazon.com/',modules:['core.js','state.js','transport.js','identity.js','native.js','bridge.js']});
try{
 const life=bridge.V3.core.lifecycle('bridge'),client=bridge.V3.bridge.client({origin:'https://worker.amazon.com',path:'/work',family:'test',life});const promise=client.run('run',{items:['A'],onProgress:()=>{}});const frame=bridge.w.document.querySelector('iframe');
 bridge.w.dispatchEvent(new bridge.w.MessageEvent('message',{origin:'https://worker.amazon.com',source:frame.contentWindow,data:{protocol:'bwu2.v3.bridge',family:'test',type:'ready'}}));await tick();life.dispose();await assert.rejects(promise,error=>error.outcome==='unknown');console.log('PASS bridge: callbacks excluded from cloned payload, lazy startup, disposal becomes UNKNOWN');
}finally{bridge.close();}
// Each must obtain a fresh workflow after COMPLETE, even for two rows in the same tote.
const each=harness({url:'https://aft-qt-jp.aka.nrt.corp.amazon.com/app/edititems',modules:['core.js','state.js','transport.js','identity.js','native.js','aft.js']});
try{
 let id=1,phase='mode',status='READY',confirmations=0,inputs=[];
 const headings={mode:'Select mode',location:'Scan location',item:'Input FNSKU or FCSKU',target:'Select new inventory state',confirm:'Confirm change',success:'Success items changed'};
 each.V3.transport={request:async(url,options={})=>{
  const path=new URL(url).pathname;if(options.method!=='POST')return {raw:'<script>'+JSON.stringify({id:{instructionId:'EditItems',objectId:'workflow-'+id},status,tool:'edititems'})+'</script><h1>'+headings[phase]+'</h1>'+(phase==='mode'?'<input name="options">':'')};
  const body=JSON.parse(options.body);if(path==='/status')return result({status});if(path==='/end'){id++;phase='location';status='READY';return result({});}
  assert.equal(path,'/action');assert.notEqual(status,'COMPLETE','must not reuse completed Each workflow');
  if(body.action==='Input'){inputs.push({id,input:body.input});if(phase==='mode'){phase='location';status='COMPLETE';}else if(phase==='location')phase='item';else if(phase==='item')phase='target';else if(phase==='target')phase='confirm';else throw new Error('Unexpected Input '+phase);}
  else if(body.action==='Confirm'){assert.equal(phase,'confirm');phase='success';confirmations++;}
  else if(body.action==='Done'){assert.equal(phase,'success');status='COMPLETE';}
  return result({});
 }};
 const life=each.V3.core.lifecycle('each');const engine=each.V3.aft.create({life,telemetry:each.V3.core.telemetry('aft','test')});const value=await engine.runEditEach({items:[{location:'tsX1',asin:'B012345678',fnsku:'X012345678'},{location:'tsX1',asin:'B012345679',fnsku:'X012345679'}]});
 assert.equal(value.confirmed,2);assert.equal(confirmations,2);assert.notEqual(inputs.find(row=>row.input==='X012345678').id,inputs.find(row=>row.input==='X012345679').id);assert.equal(each.V3.state.attention('aft'),null);console.log('PASS AFT EACH: two confirmed items, fresh workflow after COMPLETE, no duplicate confirm');
}finally{each.close();}
