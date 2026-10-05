import assert from 'node:assert/strict';
import {harness,tick} from './harness.mjs';
const h=harness({url:'https://tx-b-hierarchy-nrt.nrt.proxy.amazon.com/bindHierarchy',html:'<input id="destination" aria-label="Destination FC"><input id="container" aria-label="Container"><span class="app-user-name">krislogin</span>',modules:['core.js','state.js','transport.js','identity.js','native.js','hierarchy.js','measurement.js','fcr-audit.js','fcr-native.js']});
try{
 assert.equal(h.V3.core.identity({pageWindow:h.w}).login,'krislogin');
 const own=h.w.document.createElement('div');own.dataset.bwu2Ui='1';own.innerHTML='<input data-user="wrongalias">';h.w.document.body.appendChild(own);assert.equal(h.V3.core.identity({pageWindow:h.w}).login,'krislogin');
 let observed=[];h.w.fetch=async(url,options)=>{observed.push({url,body:JSON.parse(options.body)});return {status:200,clone:()=>({text:async()=>JSON.stringify('AVV2')})};};
 h.w.document.getElementById('destination').addEventListener('keydown',event=>{if(event.key==='Enter')void h.w.fetch('/validateDestination',{method:'POST',body:'{"destinationWarehouseId":"opaque-avv2"}'});});
 const life=h.V3.core.lifecycle('bind');const proof=await h.V3.hierarchy.validateDestinationNative('AVV2',{life});assert.equal(proof.facility,'AVV2');assert.equal(proof.destinationWarehouseId,'opaque-avv2');assert.equal(h.sharedStorage.values.size,0);
 h.V3.native.setValue(h.w.document.getElementById('destination'),'BWU1');await assert.rejects(h.V3.hierarchy.bindNative('tsX1',proof,{life}),/fresh native validation/);assert.equal(observed.length,1);
 assert.equal(h.V3.fcrNative.exactBin({items:[{binDescription:'WRONG',skuDetail:{fnSku:'X999999999'}},{binDescription:'SMALL',skuDetail:{fnSku:'X012345678'}}]},['X012345678']),'SMALL');assert.throws(()=>h.V3.fcrNative.exactBin({items:[{binDescription:'WRONG',skuDetail:{fnSku:'X999999999'}}]},['X012345678']),/No exact/);
 const now=Date.now(),request=h.V3.measurement.route('https://o0avbo02yl.execute-api.ap-northeast-1.amazonaws.com/prod/measurementEvents/X012345678/FNSKU?effectiveAfter='+new Date(now-31*86400000).toISOString()+'&effectiveBefore='+new Date(now).toISOString());
 assert.equal(h.V3.measurement.classify({measurementEvents:[]},request,now).madcat,false);assert.equal(h.V3.measurement.classify({measurementEvents:[],nextToken:'more'},request,now).madcat,null);assert.equal(h.V3.measurement.classify({measurementEvents:[{measurementSource:'MADCAT',measurementInstant:new Date(now-1).toISOString()}],nextToken:'more'},request,now).madcat,true);
 assert.equal(h.V3.measurement.route('https://evil.example/prod/measurementEvents/X012345678/FNSKU'),null);
 console.log('PASS behaviour: native identity, own-UI exclusion, typed AVV2 mapping, destination invalidation, exact bin attribution, raw MADCAT completeness');
}finally{h.close();}
// Carton latches per workflow/barcode, waits for >=2 and an enabled native button.
const carton=harness({url:'https://aftcartonpreditorapp-tcp-nrt.nrt.proxy.amazon.com/wf',html:'<span id="input-page-barcode-container-tertiary-text">csX123456</span><div data-count>Barcodes scanned: 1</div><button id="input-page-button-container-button" disabled>Complete</button>'});
try{
 Object.defineProperty(carton.w.document.body,'innerText',{get:()=>carton.w.document.body.textContent});let clicks=0;const button=carton.w.document.getElementById('input-page-button-container-button');button.onclick=()=>clicks++;carton.load('apps/carton.js');carton.V3.boot();
 carton.w.document.querySelector('[data-count]').textContent='Barcodes scanned: 2';await new Promise(resolve=>setTimeout(resolve,25));assert.equal(clicks,0);button.disabled=false;await new Promise(resolve=>setTimeout(resolve,25));assert.equal(clicks,1);carton.w.document.querySelector('[data-count]').textContent='Barcodes scanned: 3';await new Promise(resolve=>setTimeout(resolve,25));assert.equal(clicks,1);
 console.log('PASS Carton: count >=2, button readiness, no repeat on count 3');
}finally{carton.close();}
// A submitted Sideline UNKNOWN stays separate from known moved and never-submitted rows after reload.
const side=harness({modules:['core.js','state.js','transport.js','identity.js','native.js','sideline.js','sideline-ui.js']});
try{
 const key='bwu2.v3.form.recover.';side.sharedStorage.setItem(key+'items','X1\nX2\nX3');side.sharedStorage.setItem(key+'run',JSON.stringify({rows:[{code:'X1',qty:1,status:'done'},{code:'X2',qty:1,status:'moving'},{code:'X3',qty:1,status:'green'}]}));
 const work=side.w.document.createElement('div');side.w.document.body.appendChild(work);const life=side.V3.core.lifecycle('recover');side.V3.sidelineUI.mount(work,{engine:{},life,prefix:'recover'});assert.equal(work.querySelector('[data-items]').value,'X3');assert.equal(work.querySelector('[data-run]').disabled,true);
 console.log('PASS Sideline reload: moved/uncertain excluded; unsubmitted preserved; verification required');
}finally{side.close();}
// Regional results may be partial; no unrelated FNSKU row may supply an ASIN.
const mappings=harness({url:'https://fba-fnsku-commingling-console-jp.aka.amazon.com/tool/fnsku-mappings-tool'});
try{
 const table=rows=>'<table id="fnsku-table"><tr><th>FNSKU</th><th>ASIN</th></tr>'+rows.map(([fnsku,asin])=>'<tr><td>'+fnsku+'</td><td>'+asin+'</td></tr>').join('')+'</table>';let exact=false;
 mappings.V3.transport={...mappings.V3.transport,request:async url=>{const region=new URL(url).hostname;if(region.includes('-eu.'))throw new Error('AUTH');return {raw:table(exact?[['X012345678','B012345678']]:[['X999999999','B999999999']])};}};
 mappings.load('apps/fnsku.js');mappings.V3.boot();mappings.w.document.querySelector('[data-v3-button="fnsku"]').click();const work=mappings.w.document.querySelector('[data-bwu2-v3-panel="fnsku"]');work.querySelector('[data-code]').value='X012345678';await work.querySelector('[data-run]').onclick();assert.match(work.querySelector('[data-msg]').textContent,/No exact|Regional lookup failed/);assert.equal(work.querySelector('[data-out]').children.length,0);
 exact=true;await work.querySelector('[data-run]').onclick();assert.match(work.querySelector('[data-msg]').textContent,/PARTIAL REGIONS/);assert.match(work.querySelector('[data-out]').textContent,/B012345678/);assert.ok(!work.querySelector('[data-out]').textContent.includes('B999999999'));
 console.log('PASS FNSKU: unrelated rows rejected; exact partial regions visible');
}finally{mappings.close();}
// CLEAR invalidates an in-flight RIVER read before it can write an ASIN or click Next.
const river=harness({url:'https://river.amazon.com/BWU2/workflows',html:'<h1>Enter ASIN</h1><input placeholder="Type ASIN here"><button data-next>Next</button>'});
try{
 const payload={asin:'B012345678',fnsku:'X012345678'};let deferred=null,reads=0,next=0;river.w.document.querySelector('[data-next]').onclick=()=>next++;river.w.GM_getValue=()=>{reads++;if(reads===2)return new Promise(resolve=>{deferred=resolve;});return payload;};river.load('apps/river.js');river.V3.boot();river.w.document.querySelector('[data-v3-button="river"]').click();await tick();const work=river.w.document.querySelector('[data-bwu2-v3-panel="river-assistant"]');const running=work.querySelector('[data-run]').onclick();await tick();await work.querySelector('[data-clear]').onclick();deferred(payload);await running;assert.equal(river.w.document.querySelector('input').value,'');assert.equal(next,0);console.log('PASS RIVER: clear cancels stale writes and Next');
}finally{river.close();}
