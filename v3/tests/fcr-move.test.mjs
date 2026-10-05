import assert from 'node:assert/strict';
import {harness,tick} from './harness.mjs';
const row=(qty=5,extra={})=>({container:'tsX1',asin:'B012345678',fnsku:'X012345678',fcsku:'FC1',qty,...extra});
const complete=rows=>({rows,complete:true});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const auditHarness=()=>harness({modules:['core.js','state.js','transport.js','identity.js','native.js','fcr-audit.js']});
// Rapid duplicate UPC scans count every physical unit when one shared lookup finishes.
const rapid=auditHarness();try{
 const lookup=deferred();let reads=0;const audit=rapid.V3.fcrAudit.create({inventory:async()=>complete([row()]),product:()=>{reads++;return lookup.promise;}});
 await audit.scan('tsX1');const first=audit.scan('123456789012');await audit.scan('123456789012');lookup.resolve({asin:'B012345678',fnsku:'X012345678'});await first;
 assert.equal(reads,1);assert.equal(audit.state.scans.get('123456789012').count,2);assert.equal(audit.totals().scanned,2);
 await audit.scan('123456789012');assert.equal(audit.totals().scanned,3);
 await audit.scan('X012345678');assert.equal(reads,1,'known native identifier needs no product request');assert.equal(audit.totals().scanned,4);
}finally{rapid.close();}
// Identical system rows are separate quantities; FNSKU must not expand to another SKU sharing its ASIN.
const exact=auditHarness();try{
 let reads=0;const audit=exact.V3.fcrAudit.create({inventory:async()=>complete([row(1),row(1),row(2,{fnsku:'X099999999',fcsku:'FC2'})]),product:async()=>{reads++;return {asin:'B012345678',fnsku:'X099999999'};}});
 await audit.scan('tsX1');await audit.scan('X012345678');await audit.scan('X012345678');assert.equal(audit.totals().scanned,2);assert.equal(audit.state.rows[2]._scan,0);
 await audit.scan('X012345678');assert.equal(audit.totals().scanned,2);assert.equal(audit.totals().overage,1);assert.equal(audit.state.scans.get('X012345678').state,'overage');
 await audit.scan('X088888888');assert.equal(audit.state.scans.get('X088888888').state,'missing');assert.equal(reads,0);assert.equal(audit.state.rows[2]._scan,0);
}finally{exact.close();}
// Missing/incomplete inventory retains scans for retry instead of calling them absent.
for(const partial of [false,true]){
 const h=auditHarness();try{
  const initial=deferred();let calls=0;const audit=h.V3.fcrAudit.create({inventory:async()=>++calls===1?initial.promise:complete([row(2)]),product:async()=>null});
  const loading=audit.scan('tsX1');await audit.scan('X012345678');if(partial)initial.resolve({rows:[row(1)],complete:false});else initial.reject(new Error('inventory-more HTTP500'));await loading;
  await audit.scan('X012345678');assert.equal(audit.state.phase,'failed');assert.equal(audit.state.pending.length,2);assert.equal(audit.state.scans.size,0);
  await audit.retry();assert.equal(audit.state.phase,'ready');assert.equal(audit.totals().scanned,2);assert.equal(audit.state.pending.length,0);
 }finally{h.close();}
}
const stale=auditHarness();try{
 const lookup=deferred();const audit=stale.V3.fcrAudit.create({inventory:async()=>complete([row()]),product:()=>lookup.promise});await audit.scan('tsX1');
 const loading=audit.scan('123456789012');audit.reset();lookup.resolve({asin:'B012345678'});await loading;assert.equal(audit.state.container,'');assert.equal(audit.state.scans.size,0);
 const first=deferred();let count=0;const switching=stale.V3.fcrAudit.create({inventory:async()=>++count===1?first.promise:complete([row(2,{container:'tsX2'})])});
 const old=switching.scan('tsX1');await switching.scan('tsX2');first.resolve(complete([row(5)]));await old;assert.equal(switching.state.container,'tsX2');assert.equal(switching.totals().units,2);
}finally{stale.close();}
const unresolved=auditHarness();try{
 const audit=unresolved.V3.fcrAudit.create({inventory:async()=>complete([row()]),product:async()=>null});await audit.scan('tsX1');await audit.scan('123456789012');assert.equal(audit.state.scans.get('123456789012').state,'error');
}finally{unresolved.close();}
// Exact product validation must not cache another SKU; read-only pagination errors remain incomplete.
const data=harness({url:'https://fcresearch-fe.aka.amazon.com/BWU2/results?s=tsX1',modules:['core.js','state.js','transport.js','identity.js','native.js','pandash.js','fcr-data.js']});try{
 let wrong=true,calls=0;const productTable=fnsku=>'<table class="a-keyvalue"><tr><th>ASIN</th><td>B012345678</td></tr><tr><th>FNSKU</th><td>'+fnsku+'</td></tr></table>';
 data.V3.transport={request:async()=>{calls++;return {raw:productTable(wrong?'X099999999':'X012345678')};}};const engine=data.V3.fcr.create({});
 await assert.rejects(engine.product('X012345678'),/does not match/);wrong=false;assert.equal((await engine.product('X012345678')).fnsku,'X012345678');assert.equal(calls,2);
 let pages=0,previews=[];data.V3.transport={request:async url=>{if(url.endsWith('/inventory-more')){pages++;throw Object.assign(new Error('HTTP500'),{status:500});}return{raw:'<table id="table-inventory"><thead><tr><th>Container</th><th>FNSKU</th><th>Quantity</th></tr></thead><tbody><tr><td>tsX1</td><td>X012345678</td><td>2</td></tr></tbody></table><span class="pagination-token">{"next":1}</span>'};}};
 await assert.rejects(engine.inventory('tsX1',{onPreview:value=>previews.push(value)}),/HTTP500/);assert.equal(pages,3,'bounded read retry');assert.equal(previews.length,1);assert.equal(previews[0].complete,false);
}finally{data.close();}
// Native bin responses with another FNSKU cannot borrow a shared ASIN or an echoed request barcode.
const bin=harness({modules:['core.js','state.js','transport.js','identity.js','native.js','fcr-audit.js','fcr-native.js']});try{
 assert.throws(()=>bin.V3.fcrNative.exactBin({items:[{scannedBarcode:'X012345678',binDescription:'WRONG',skuDetail:{asin:'B012345678',fnSku:'X099999999'}}]},['B012345678','X012345678']),/No exact/);
 assert.equal(bin.V3.fcrNative.exactBin({items:[{binDescription:'SMALL',skuDetail:{asin:'B012345678',fnSku:'X012345678'}}]},['B012345678','X012345678']),'SMALL');
}finally{bin.close();}
function fcrUI({html='',services}={}){
 const h=harness({url:'https://fcresearch-fe.aka.amazon.com/BWU2/results?s=tsX1',html,modules:['core.js','state.js','transport.js','identity.js','native.js','pandash.js','fcr-data.js','fcr-audit.js','actions.js','bridge.js','measurement.js','fcr-native.js']});
 h.V3.fcr={...h.V3.fcr,create:()=>services};h.V3.fcrNative={mount:()=>{}};h.load('apps/fcr.js');h.V3.boot();return h;
}
const auditUI=fcrUI({services:{inventory:async()=>complete([row(2)]),product:async()=>null}});try{
 auditUI.w.document.querySelector('[data-v3-button="fcr-tote"]').click();const root=auditUI.w.document.querySelector('[data-bwu2-v3-panel="fcr-tote"]'),input=root.querySelector('[data-scan]');
 const scan=async value=>{input.value=value;await input.onkeydown({key:'Enter',preventDefault(){}});};await scan('tsX1');await scan('X012345678');await scan('X012345678');assert.match(root.querySelector('[data-summary]').textContent,/2\/2 units/);
}finally{auditUI.close();}
// Delayed lookup and hazard results must not overwrite the newer requested item.
const itemA=deferred(),itemB=deferred(),hazardA=deferred(),hazardB=deferred();
const lookupUI=fcrUI({services:{product:code=>code==='B012345678'?itemA.promise:itemB.promise,pandash:code=>code==='B012345678'?hazardA.promise:hazardB.promise}});try{
 lookupUI.w.document.querySelector('[data-v3-button="fcr-item"]').click();const item=lookupUI.w.document.querySelector('[data-bwu2-v3-panel="fcr-item"]'),input=item.querySelector('[data-code]');
 input.value='B012345678';const first=item.querySelector('[data-run]').onclick();input.value='B012345679';input.dispatchEvent(new lookupUI.w.Event('input'));const second=item.querySelector('[data-run]').onclick();
 itemB.resolve({asin:'B012345679',title:'NEW ITEM'});await second;itemA.resolve({asin:'B012345678',title:'OLD ITEM'});await first;
 assert.match(item.querySelector('[data-out]').textContent,/NEW ITEM/);assert.ok(!item.querySelector('[data-out]').textContent.includes('OLD ITEM'));
 lookupUI.w.document.querySelector('[data-v3-button="fcr-pandash"]').click();const hazard=lookupUI.w.document.querySelector('[data-bwu2-v3-panel="fcr-pandash"]'),asin=hazard.querySelector('[data-asin]');
 asin.value='B012345678';const oldHazard=hazard.querySelector('[data-run]').onclick();asin.value='B012345679';asin.dispatchEvent(new lookupUI.w.Event('input'));const newHazard=hazard.querySelector('[data-run]').onclick();
 hazardB.resolve({allowed:false,level:3,message:'BLOCKED NEW ITEM'});await newHazard;hazardA.resolve({allowed:true,level:0,message:'ALLOWED OLD ITEM'});await oldHazard;
 assert.match(hazard.querySelector('[data-msg]').textContent,/BLOCKED NEW ITEM/);assert.ok(!hazard.querySelector('[data-msg]').textContent.includes('ALLOWED'));
}finally{lookupUI.close();}
const inventoryHTML=rows=>'<table id="table-inventory"><thead><tr><th>Container</th><th>ASIN</th><th>FNSKU</th><th>FCSKU</th><th>Quantity</th></tr></thead><tbody>'+rows.map(container=>'<tr><td>'+container+'</td><td>B012345678</td><td>X012345678</td><td>FC1</td><td>1</td></tr>').join('')+'</tbody></table>';
const pods=Array.from({length:9},(_,i)=>'P-2-A00'+i+'B00'+i),readers=new Map();let floorCalls=0,clipboard='',prints=[];
const binUI=fcrUI({html:inventoryHTML(pods),services:{floor:pod=>{floorCalls++;const reader=deferred();readers.set(pod,reader);return reader.promise;}}});try{
 binUI.w.TextEncoder=TextEncoder;binUI.w.GM_setClipboard=text=>{clipboard=text;};binUI.V3.transport={request:async url=>{prints.push(url);return {raw:'OK'};}};
 binUI.w.document.querySelector('[data-v3-button="fcr-bin"]').click();const root=binUI.w.document.querySelector('[data-bwu2-v3-panel="fcr-bin"]');
 const first=root.querySelector('[data-load]').onclick();assert.equal(floorCalls,8);
 binUI.w.document.querySelector('#table-inventory').outerHTML=inventoryHTML(['P-4-A999B999']);const second=root.querySelector('[data-load]').onclick();assert.equal(floorCalls,9);
 for(const pod of pods.slice(0,8))readers.get(pod).resolve('P2');await first;assert.match(root.querySelector('[data-msg]').textContent,/Resolving/);assert.equal(floorCalls,9,'obsolete snapshot must not request its ninth pod');
 readers.get('P-4-A999B999').resolve('P4');await second;assert.match(root.querySelector('[data-list]').textContent,/P4/);assert.ok(!root.querySelector('[data-list]').textContent.includes(pods[0]));
 root.querySelector('[data-copy]').onclick();assert.match(clipboard,/P4\tP-4-A999B999/);assert.ok(!clipboard.includes(pods[0]));
 await root.querySelector('[data-print]').onclick({altKey:false});assert.equal(prints.length,0);await root.querySelector('[data-print]').onclick({altKey:true});assert.equal(prints.length,1);
 assert.equal(Buffer.from(new URL(prints[0]).searchParams.get('data'),'hex').toString(),'P-4-A999B999');
}finally{binUI.close();}
// Standalone movement preserves exact V2 payload, PAUSE-after-current, and persistent UNKNOWN quarantine.
const result=(data,status=200,extra={})=>({status,data,raw:data==null?'':JSON.stringify(data),flags:{auth:false,html:false},...extra});
for(const scenario of ['success','paused','unknown','contradictory','wrongContainer','wrongDestination','accepted','redirect','html']){
 const h=harness({url:'https://aft-moveapp-nrt-nrt.nrt.proxy.amazon.com/move-container',modules:['core.js','state.js','transport.js','identity.js','native.js','actions.js','bridge.js','queue-ui.js']});let requests=0,release;let root;
 h.sharedStorage.setItem('bwu2.v3.move.floor','corrupt-floor');
 h.V3.transport={request:async(url,options)=>{
  requests++;const body=JSON.parse(options.body);assert.deepEqual(body,{sourceScannableId:null,destinationScannableId:'dz-Pcubiscan-P3',containerScannableId:'tsX1',confirmed:'true'});
  if(scenario==='paused'){root.querySelector('[data-pause]').click();await new Promise(resolve=>{release=resolve;});return result(null,204);}
  if(scenario==='success')root.querySelector('[data-pause]').click();
  if(scenario==='unknown')throw new Error('lost response');
  return result({success:true,...(scenario==='contradictory'?{error:'failed'}:{}),...(scenario==='wrongContainer'?{containerScannableId:'tsXOTHER'}:{}),...(scenario==='wrongDestination'?{destinationScannableId:'dz-P-PRIME'}:{})},scenario==='accepted'?202:200,
   scenario==='redirect'?{finalUrl:'https://other.amazon.com/api/move-container'}:scenario==='html'?{flags:{html:true}}:{});
 }};
 try{
  h.load('apps/movecontainer.js');h.V3.boot();h.w.document.querySelector('[data-v3-button="movecontainer"]').click();await tick();root=h.w.document.querySelector('[data-bwu2-v3-panel="movecontainer"]');
  assert.equal(root.querySelector('[data-floor]').value,'P2');root.querySelector('[data-floor]').value='P3';root.querySelector('[data-floor]').onchange();root.querySelector('[data-drop]').value='Cubiscan';root.querySelector('[data-drop]').onchange();
  root.querySelector('[data-input]').value='tsX1\ntsX2';root.querySelector('[data-add]').click();await tick();
  const run=root.querySelector('[data-run]').onclick();if(scenario==='paused'){await tick();release();}await run;
  if(['success','paused'].includes(scenario)){assert.match(root.querySelector('[data-list]').textContent,/tsX1.*DONE/);assert.equal(h.V3.state.attention('movecontainer'),null);}
  else{assert.match(root.querySelector('[data-list]').textContent,/tsX1.*ATTENTION/);assert.match(root.querySelector('[data-list]').textContent,/tsX2.*QUEUED/);assert.equal(h.V3.state.attention('movecontainer').state,'UNKNOWN');await root.querySelector('[data-run]').onclick();assert.equal(requests,1);}
 }finally{h.close();}
}
console.log('PASS FCR/Move: physical counts, SKU identity, failed inventory recovery, snapshot generations, exact print, destination defaults, movement proof, PAUSE and UNKNOWN');
