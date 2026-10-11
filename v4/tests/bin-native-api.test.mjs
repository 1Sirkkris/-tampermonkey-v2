import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {snapshotInventory,createBinOverlay} from '../bin-runtime.mjs';

const entry=(await build({entryPoints:[new URL('../bin-entry.mjs',import.meta.url).pathname],bundle:true,write:false,format:'iife',platform:'browser'})).outputFiles[0].text;
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setTimeout(resolve,0));};
const row=(i,qty)=>`<tr><td>P-1-A${String(i).padStart(3,'0')}B000</td><td>${qty}</td><td>X012345678</td><td>ZZ12345678</td><td>Fixture title</td></tr>`;
function setup(t){
 const dom=new JSDOM(`<head></head><body><div id="inventory-status"><a id="inventory-nav">Inventory</a></div><table id="table-inventory"><thead><tr><th id="inventory-container">Container</th><th>Quantity (111)</th><th>FNSKU</th><th>FCSKU</th><th>Title</th></tr></thead><tbody>${row(0,1)}${row(1,100)}${row(2,9)}</tbody></table></body>`,{url:'https://qi-fcresearch-fe.corp.amazon.com/BWU2/results?s=X012345678',runScripts:'outside-only'});
 t.after(()=>dom.window.close());
 const w=dom.window,table=w.document.getElementById('table-inventory'),rows=[...table.tBodies[0].rows];
 table.tBodies[0].replaceChildren(rows[0]);
 return{w,table,rows};
}
function legacy(table,rows,display=[0,2]){
 const settings={aiDisplay:display,aoData:rows.map(nTr=>({nTr}))};let calls=0;
 const jq=node=>{assert.equal(node,table);return{DataTable(){return this;},dataTable(){calls++;return{fnSettings:()=>settings};}};};
 jq.fn={jquery:'1.6.4',dataTable:{fnIsDataTable:node=>node===table}};
 return{jq,settings,calls:()=>calls};
}

test('captured legacy API contract snapshots every applied page and excludes filtered-out high quantities',t=>{
 const{w,table,rows}=setup(t),native=legacy(table,rows,[2,0]),snapshot=snapshotInventory(w,{jQuery:native.jq});
 assert.equal(native.jq.fn.dataTable.isDataTable,undefined);
 assert.equal(table.tBodies[0].rows.length,1);
 assert.deepEqual(snapshot.rows.map(row=>row.qty),[9,1]);
 assert.equal(snapshot.source,'DataTables applied filter');
 assert.equal(native.calls(),1);
});
test('legacy empty applied filter stays empty rather than restoring DOM rows',t=>{
 const{w,table,rows}=setup(t),native=legacy(table,rows,[]),snapshot=snapshotInventory(w,{jQuery:native.jq});
 assert.deepEqual(snapshot.rows,[]);assert.equal(snapshot.source,'DataTables applied filter');
});
test('legacy native API check never initializes an uninitialized table',t=>{
 const{w,table,rows}=setup(t),native=legacy(table,rows);native.jq.fn.dataTable.fnIsDataTable=()=>false;
 const snapshot=snapshotInventory(w,{jQuery:native.jq});
 assert.equal(snapshot.rows.length,1);assert.equal(snapshot.source,'visible DOM only');assert.equal(native.calls(),0);
});
test('incomplete native row nodes remain honestly DOM-only',t=>{
 const{w,table,rows}=setup(t),native=legacy(table,rows);native.settings.aoData[2].nTr=null;
 const snapshot=snapshotInventory(w,{jQuery:native.jq});
 assert.equal(snapshot.rows.length,1);assert.equal(snapshot.source,'visible DOM only');
});
test('modern native API continues to use only applied-filter nodes across loaded pages',t=>{
 const{w,table,rows}=setup(t);let calls=0;
 const jq=node=>{assert.equal(node,table);return{DataTable:()=>({rows:options=>{calls++;assert.deepEqual(options,{search:'applied'});return{nodes:()=>({toArray:()=>[rows[0],rows[2]]})};}})};};
 jq.fn={dataTable:{isDataTable:node=>node===table}};
 const snapshot=snapshotInventory(w,{jQuery:jq});assert.deepEqual(snapshot.rows.map(row=>row.qty),[1,9]);assert.equal(snapshot.source,'DataTables applied filter');assert.equal(calls,1);
});
test('source-bundled installer awaits private AUI jQuery, mounts once and starts no reads before clicking',async t=>{
 const{w,table,rows}=setup(t),native=legacy(table,rows),callbacks=[];let reads=0;
 w.unsafeWindow=w;w.fetch=async()=>{reads++;return new Response('<table><tr><th>Floor</th><td>2</td></tr></table>');};
 w.AmazonUIPageJS={when:name=>{assert.equal(name,'jQuery');return{execute:fn=>callbacks.push(fn)};}};
 w.eval(entry);w.eval(entry);w.document.dispatchEvent(new w.Event('DOMContentLoaded'));await settle();
 assert.equal(callbacks.length,1);assert.equal(reads,0);assert.equal(w.jQuery,undefined);
 callbacks[0](native.jq);assert.equal(w.document.querySelectorAll('button[data-tm-v4-script="BINC"]').length,1);
 w.document.querySelector('button[data-tm-v4-script="BINC"]').click();await settle();
 assert.equal(w.document.querySelectorAll('#tm-v4-bin tbody tr').length,2);assert.equal(reads,2);
 assert.match(w.document.querySelector('#tm-v4-bin [data-source]').textContent,/DataTables applied filter/);
});
test('source-bundled installer reads an already-ready private AUI dependency before scheduled when callbacks',async t=>{
 const{w,table,rows}=setup(t),native=legacy(table,rows),callbacks=[];
 w.unsafeWindow=w;w.fetch=async()=>new Response('<table><tr><th>Floor</th><td>2</td></tr></table>');
 w.P={now:()=>({execute:fn=>fn(native.jq)}),when:()=>({execute:fn=>callbacks.push(fn)})};
 w.eval(entry);w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
 assert.equal(callbacks.length,1);assert.equal(w.jQuery,undefined);
 w.document.querySelector('button[data-tm-v4-script="BINC"]').click();await settle();
 assert.equal(w.document.querySelectorAll('#tm-v4-bin tbody tr').length,2);
});
test('DOM readiness rechecks newly ready private jQuery without adding another when handler',async t=>{
 const{w,table,rows}=setup(t),native=legacy(table,rows),callbacks=[];let current;
 w.unsafeWindow=w;w.fetch=async()=>new Response('<table><tr><th>Floor</th><td>2</td></tr></table>');
 w.P={now:()=>({execute:fn=>fn(current)}),when:()=>({execute:fn=>callbacks.push(fn)})};
 w.eval(entry);current=native.jq;w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
 assert.equal(callbacks.length,1);w.document.querySelector('button[data-tm-v4-script="BINC"]').click();await settle();
 assert.equal(w.document.querySelectorAll('#tm-v4-bin tbody tr').length,2);
});
test('source-bundled installer discovers private loader created before DOM readiness',async t=>{
 const{w,table,rows}=setup(t),native=legacy(table,rows),callbacks=[];
 w.unsafeWindow=w;w.fetch=async()=>new Response('<table><tr><th>Floor</th><td>2</td></tr></table>');
 w.eval(entry);w.P={when:()=>({execute:fn=>callbacks.push(fn)})};
 w.document.dispatchEvent(new w.Event('DOMContentLoaded'));await settle();
 assert.equal(callbacks.length,1);callbacks[0](native.jq);
 w.document.querySelector('button[data-tm-v4-script="BINC"]').click();await settle();
 assert.equal(w.document.querySelectorAll('#tm-v4-bin tbody tr').length,2);
});
test('source-bundled installer sees a page-global jQuery installed after startup',async t=>{
 const{w,table,rows}=setup(t),native=legacy(table,rows);
 w.unsafeWindow=w;w.fetch=async()=>new Response('<table><tr><th>Floor</th><td>2</td></tr></table>');
 w.eval(entry);w.document.dispatchEvent(new w.Event('DOMContentLoaded'));await settle();w.jQuery=native.jq;
 w.document.querySelector('button[data-tm-v4-script="BINC"]').click();await settle();
 assert.equal(w.document.querySelectorAll('#tm-v4-bin tbody tr').length,2);
});
test('source-bundled installer keeps labelled visible fallback if dependency registration fails',async t=>{
 const{w}=setup(t);w.unsafeWindow=w;w.fetch=async()=>new Response('<table><tr><th>Floor</th><td>2</td></tr></table>');
 w.P={when:()=>{throw new Error('unavailable loader');}};
 assert.doesNotThrow(()=>w.eval(entry));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));await settle();
 w.document.querySelector('button[data-tm-v4-script="BINC"]').click();await settle();
 assert.equal(w.document.querySelectorAll('#tm-v4-bin tbody tr').length,1);assert.match(w.document.querySelector('#tm-v4-bin [data-source]').textContent,/visible DOM only/);
});
test('source-bundled route disposal prevents late dependency callback from reviving work',async t=>{
 const{w,table,rows}=setup(t),native=legacy(table,rows),callbacks=[];let reads=0;
 w.unsafeWindow=w;w.fetch=async()=>{reads++;throw new Error('unexpected read');};w.P={when:()=>({execute:fn=>callbacks.push(fn)})};
 w.eval(entry);w.document.dispatchEvent(new w.Event('DOMContentLoaded'));await settle();
 w.location.hash='#iss-console';w.dispatchEvent(new w.Event('hashchange'));callbacks[0](native.jq);await settle();
 assert.equal(reads,0);assert.equal(w.document.querySelector('#tm-v4-bin'),null);assert.equal(w.document.querySelector('button[data-tm-v4-script="BINC"]'),null);assert.equal(w.document.querySelector('#tm-v4-runtime-watermark'),null);
});
test('snapshot is fixed at click while filters and native quantities change during floor reads',async t=>{
 const{w,table,rows}=setup(t),native=legacy(table,rows),jobs=[];
 const overlay=createBinOverlay({window:w,page:{jQuery:native.jq},version:'test',reader:{section:()=>new Promise(resolve=>jobs.push(resolve))}});t.after(()=>overlay.dispose());
 overlay.open();await settle();native.settings.aiDisplay=[1];rows[2].cells[1].textContent='999';
 jobs.forEach(resolve=>resolve({html:'<table><tr><th>Floor</th><td>2</td></tr></table>'}));await settle();
 assert.deepEqual(overlay.visible().map(row=>row.qty).sort((a,b)=>a-b),[1,9]);
 overlay.open();await settle();assert.deepEqual(overlay.visible().map(row=>row.qty),[100]);
});
test('native applied rows preserve highest-quantity Lazy choice, floor filter, TSV and cached floor reads',async t=>{
 const{w,table,rows}=setup(t),native=legacy(table,rows);let copied='',reads=0;
 w.navigator.clipboard={writeText:async text=>copied=text};
 const overlay=createBinOverlay({window:w,page:{jQuery:native.jq},version:'test',reader:{section:async()=>{reads++;return{html:'<table><tr><th>Floor</th><td>2</td></tr></table>'};}}});t.after(()=>overlay.dispose());
 overlay.open();await settle();overlay.root.querySelector('[data-action=lazy]').click();await settle();
 assert.equal(copied,'X012345678\tP-1-A002B000\t\t');assert.equal(reads,2);
 overlay.root.querySelector('[data-filter=P2]').click();overlay.root.querySelector('[data-action=copy]').click();await settle();
 assert.match(copied,/P-1-A000B000/);assert.match(copied,/P-1-A002B000/);assert.doesNotMatch(copied,/P-1-A001B000/);
 overlay.open();await settle();assert.equal(reads,2);
});
test('native applied rows keep optional Alt-click print scoped to deliberate valid code only',async t=>{
 const{w,table,rows}=setup(t),native=legacy(table,rows),prints=[];
 const overlay=createBinOverlay({window:w,page:{jQuery:native.jq},version:'test',reader:{section:async()=>({html:'<table><tr><th>Floor</th><td>2</td></tr></table>'})},fetch:async url=>{prints.push(url);return new Response('');}});t.after(()=>overlay.dispose());
 overlay.open();await settle();overlay.root.querySelector('[data-print="X012345678"]').click();assert.equal(prints.length,0);
 overlay.root.querySelector('[data-print="X012345678"]').dispatchEvent(new w.MouseEvent('click',{altKey:true,bubbles:true,cancelable:true}));await settle();
 assert.equal(prints.length,1);const url=new URL(prints[0]);assert.equal(url.origin,'http://localhost:5965');assert.equal(url.searchParams.get('quantity'),'1');
 assert.equal(url.searchParams.get('data'),[...'X012345678'].map(c=>c.charCodeAt(0).toString(16)).join(''));
});
