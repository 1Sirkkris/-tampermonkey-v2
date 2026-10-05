import assert from 'node:assert/strict';
import {harness,tick} from './harness.mjs';
const table=(rows,next='')=>'<table id="fnsku-table"><tr><th>FNSKU</th><th>ASIN</th></tr>'+rows.map(([f,a])=>`<tr><td>${f}</td><td>${a}</td></tr>`).join('')+'</table>'+next;
function mappings(request){const h=harness({url:'https://fba-fnsku-commingling-console-jp.aka.amazon.com/tool/fnsku-mappings-tool'});h.V3.transport={...h.V3.transport,request};h.load('apps/fnsku.js');h.V3.boot();h.w.document.querySelector('[data-v3-button="fnsku"]').click();const panel=h.w.document.querySelector('[data-bwu2-v3-panel="fnsku"]');return{...h,panel,input:panel.querySelector('[data-code]'),run:()=>panel.querySelector('[data-run]').onclick()};}
// A second page can contradict the first. Never resolve a unique ASIN from page one alone.
{
 const calls=[];const h=mappings(async(raw)=>{const u=new URL(raw);calls.push(u);if(u.hostname.includes('-eu.')||u.hostname.includes('-jp.'))return{raw:table([])};return{raw:u.searchParams.get('paginationToken')?table([['X012345678','B999999999']]):table([['X012345678','B012345678']],'<button>Next</button><input name="paginationToken" value="two">')};});
 try{h.input.value='X012345678';await h.run();assert.equal(calls.length,4);assert.match(h.panel.textContent,/Multiple exact ASINs/);assert.equal(h.panel.querySelector('[data-out]').children.length,0);}finally{h.close();}
}
// Authentication HTML is failed evidence, not a valid empty region. Retain proven exact rows if JP expansion fails.
{
 const h=mappings(async raw=>{const u=new URL(raw);return{raw:u.hostname.includes('-na.')?table([['X012345678','B012345678']]):'<h1>Sign in</h1>'};});
 try{h.input.value='X012345678';await h.run();assert.match(h.panel.textContent,/PARTIAL REGIONS/);assert.match(h.panel.textContent,/Exact input FNSKU mappings/);assert.match(h.panel.querySelector('[data-out]').textContent,/NA.*X012345678/);h.panel.querySelector('[data-copy]').click();}finally{h.close();}
}
// Native GET next forms preserve identity; related rows are explicitly distinct from input FNSKU proof.
{
 let reads=0;const h=mappings(async raw=>{const u=new URL(raw);reads++;assert.equal(u.searchParams.get('ASIN'),'B012345678');return{raw:u.searchParams.get('paginationToken')?table([['X999999999','B012345678']]):table([['X012345678','B012345678']],'<form method="get"><input name="paginationToken" value="two"><button>Next</button></form>')};});
 try{h.input.value='B012345678';await h.run();assert.equal(reads,2);assert.match(h.panel.textContent,/X999999999/);assert.match(h.panel.textContent,/exact ASIN mappings/);}finally{h.close();}
}
// An unresolved continuation cannot be presented as a complete result.
{
 const h=mappings(async()=>({raw:table([['X012345678','B012345678']],'<button>Next</button>')}));
 try{h.input.value='B012345678';await h.run();assert.match(h.panel.textContent,/Next page unavailable/);assert.equal(h.panel.querySelector('[data-out]').children.length,0);}finally{h.close();}
}
// Changing input aborts and discards even an uncooperative delayed transport.
{
 let resolve;const h=mappings(()=>new Promise(r=>{resolve=r;}));
 try{h.input.value='B012345678';const running=h.run();await tick();h.input.value='B999999999';h.input.dispatchEvent(new h.w.Event('input'));resolve({raw:table([['X012345678','B012345678']])});await running;assert.equal(h.panel.querySelector('[data-out]').textContent,'');assert.equal(h.panel.querySelector('[data-msg]').textContent,'');}finally{h.close();}
}
const frame=()=>new Promise(resolve=>setTimeout(resolve,100));
async function river(payload,html){const h=harness({url:'https://river.amazon.com/BWU2/workflows',html});h.w.GM_getValue=()=>payload;h.load('apps/river.js');h.V3.boot();h.w.document.querySelector('[data-v3-button="river"]').click();await tick();h.panel=h.w.document.querySelector('[data-bwu2-v3-panel="river-assistant"]');return h;}
// Zero live quantity must produce an explicit disagreement with a positive PO, never silently choose the PO.
{
 const h=await river({asin:'B012345678',poLineQuantity:5,liveInventoryQuantity:0},'<h1>Severity</h1><label>Units impacted<input data-units></label><label>Shipments impacted<input data-shipments></label><button data-next>Next</button>');let next=0;h.w.document.querySelector('[data-next]').onclick=()=>next++;
 try{await h.panel.querySelector('[data-run]').onclick();assert.match(h.panel.textContent,/PO qty 5 ≠ live inventory 0/);assert.equal(h.w.document.querySelector('[data-units]').value,'');h.panel.querySelector('[data-apply]').click();await frame();assert.equal(h.w.document.querySelector('[data-units]').value,'');h.panel.querySelector('[data-live]').click();await frame();assert.equal(h.w.document.querySelector('[data-units]').value,'0');assert.equal(next,0);}finally{h.close();}
}
// Observe before native Next: synchronous native transitions are still recognized; final create stays manual.
{
 const h=await river({asin:'B012345678',poLineQuantity:2,liveInventoryQuantity:2},'<h1>Enter ASIN</h1><input placeholder="Type ASIN here"><button data-next>Next</button>');let next=0;
 h.w.document.querySelector('[data-next]').onclick=()=>{next++;h.w.document.querySelector('#root').innerHTML='<h1>Severity</h1><input aria-label="Units impacted"><input aria-label="Shipments impacted"><button data-next>Next</button>';h.w.document.querySelector('[data-next]').onclick=()=>{next++;h.w.document.querySelector('#root').innerHTML='<h1>Create issue</h1><button data-create>Create</button>';};};
 try{await h.panel.querySelector('[data-run]').onclick();await frame();assert.equal(next,2);assert.match(h.panel.textContent,/CREATE stays manual/);}finally{h.close();}
}
// Capture rejects undated ambiguity and delayed results from the previous code.
{
 let resolve;let delayed=false;const po='<table id="table-purchase-order-item"><thead><tr><th>PO</th><th>FNSKU</th><th>Unfilled</th><th>Cancelled</th><th>Received</th></tr></thead><tbody><tr><td>PO1</td><td>X012345678</td><td>2</td><td>0</td><td>0</td></tr><tr><td>PO2</td><td>X012345678</td><td>9</td><td>0</td><td>0</td></tr></tbody></table>';
 const h=harness({url:'https://fcresearch.amazon.com/BWU2/results?s=X012345678'});h.V3.fcr={warehouse:()=> 'BWU2',create:()=>({product:async()=>delayed?new Promise(r=>resolve=r):{asin:'B012345678',fnsku:'X012345678'},inventory:async()=>({totalQuantity:2,complete:true}),post:async endpoint=>endpoint==='purchase-order-item'?po:''})};h.load('apps/river.js');h.V3.boot();h.w.document.querySelector('[data-v3-button="river-capture"]').click();const panel=h.w.document.querySelector('[data-bwu2-v3-panel="river-capture"]');
 try{await panel.querySelector('[data-cap]').onclick();let stored=await h.V3.core.store('river',1).get('payload');assert.equal(stored.purchaseOrder,'N/A');assert.equal(stored.poLineQuantity,null);delayed=true;const running=panel.querySelector('[data-cap]').onclick();await tick();const input=panel.querySelector('[data-code]');input.value='X999999999';input.dispatchEvent(new h.w.Event('input'));resolve({asin:'B012345678',fnsku:'X012345678'});await running;assert.equal(await h.V3.core.store('river',1).get('payload',null),null);assert.equal(panel.querySelector('[data-open]').disabled,true);}finally{h.close();}
}
console.log('PASS RIVER/FNSKU: all-page identity, malformed/auth reads, partial proof, native continuation forms, stale-input cancellation, zero disagreement, explicit manual choice, synchronous Next, undated PO ambiguity');
