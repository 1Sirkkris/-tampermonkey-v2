import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { transform } from 'esbuild';
import { createMasterRuntime, watchNativeAjax, MASTER_LABELS } from './master-runtime.mjs';
import { FCR_SECTIONS } from './fcr-read.mjs';
if (!process.argv[2]) throw new Error('Pass the downloaded native capture JSON path');
const capture = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const native = capture.scripts?.find(script => script.source?.includes('section-placeholder') && script.source.includes('ajaxTransport'));
if (!native) throw new Error('Capture has no complete native FCR bundle');
const source = (await transform(native.source, { minify: false })).code;
const jqStart=source.indexOf('(function(H) {\n  var r2 = window.AmazonUIPageJS');
const jqEnd=source.indexOf('(function(f2) {\n  var g2 = window.AmazonUIPageJS',jqStart);
const rendererStart=source.indexOf('  pa.when(\n    "A",\n    "dataTables"');
const dtStart=source.indexOf('  pa.when("A").register("dataTables"');
const dtEnd=source.indexOf('  pa.when("A").register("datepicker"',dtStart);
const afStart=source.indexOf('  pa.when("A", "dataTables", "a-popover", "dateRangePicker").register("advancedFilter"');
const afEnd=source.indexOf('  pa.when("A", "fcr-search-box", "ready")',afStart);
assert([jqStart,jqEnd,rendererStart,dtStart,dtEnd,afStart,afEnd].every(x=>x>=0));
async function settle(ready,label) {
  for (let attempt=0;attempt<100;attempt++) { if (ready()) return; await new Promise(resolve=>setTimeout(resolve,10)); }
  throw new Error('Offline capture check did not reach '+label);
}
const response=(container,total=1)=>'<div class="filter"></div><div class="advanced-filters"><table><tr data-col="inventory-container"><td><div class="filters-input"><input></div></td></tr><tr data-col="inventory-asin"><td><div class="filters-select"><select><option></option></select></div></td></tr></table></div><table id="table-inventory"><thead><tr><th id="inventory-container">Container</th><th id="inventory-asin">ASIN</th><th data-func="sum" data-sort-col="2">Quantity ('+total+')</th></tr></thead><tbody><tr><td>'+container+'</td><td>B012345678</td><td>1</td></tr></tbody></table>';
const dom=new JSDOM('<nav><h6>Sections</h6><ul id="sections-list">'+FCR_SECTIONS.map((e,i)=>'<li id="'+e+'-status"><i></i>'+MASTER_LABELS[i]+'</li>').join('')+'</ul></nav><main>'+FCR_SECTIONS.map(e=>'<div class="section-placeholder" data-section-type="'+e+'"></div>').join('')+'</main>',{url:'https://qi-fcresearch-fe.corp.amazon.com/BWU2/results?s=B012345678',runScripts:'outside-only'});
const w=dom.window; w.R=w; w.XMLHttpRequest=function(){throw new Error('Offline harness blocked unexpected native XHR');}; const calls=[];let attempt=0; const renders=[];const stored=new Map();
const runtime=createMasterRuntime({window:w,storage:{get:k=>stored.get(k),set:(k,v)=>stored.set(k,v)},fetch:async(url,options)=>{calls.push({url,options}); return new Response(url.endsWith('/inventory')?response('tsX'+(++attempt),attempt===1?99:1):'<table><tr><th>ASIN</th><td>B012345678</td></tr><tr><th>Title</th><td>Fixture product</td></tr></table>');},onRender:r=>renders.push(r)});
runtime.start();const bridge=watchNativeAjax(w,()=>runtime);
try {
  // Run only captured native bootstrap, jQuery, renderer, DataTables and filter
  // modules; no analytics, original product data, external requests or actions.
  w.eval(source.slice(0,jqEnd));w.pa=w.AmazonUIPageJS;
  const p=w.AmazonUIPageJS;
  let jq; p.when('jQuery').execute(x=>jq=x);
  await settle(()=>jq,'captured jQuery dependency');assert(jq);assert.equal(jq.fn.jquery,'1.6.4');assert.equal(w.jQuery,undefined);
  const declaratives=new Map();const A={$:jq,state:()=>({query:'B012345678',warehouseId:'BWU2'}),on:()=>{},declarative:(k,e,fn)=>declaratives.set(k,fn)};
  p.declare('A',A);p.declare('a-popover',{});p.declare('a-calendar-framework',{createAll:()=>{}});p.declare('history',{update:()=>{}});p.declare('activeProfile',{set:()=>{}});p.declare('dateRangePicker',{createFilter:()=>{}});p.declare('fcr-results',{});
  w.eval(source.slice(dtStart,dtEnd));w.eval(source.slice(afStart,afEnd));w.eval(source.slice(rendererStart,dtStart));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));p.declare('ready',{});
  await settle(()=>runtime.current().sections.get('inventory')?.status==='partial','native initial render');
  assert.equal(calls.length,2);assert.equal(jq.active,0);assert.equal(runtime.current().sections.get('inventory').status,'partial');
  assert.equal(jq.fn.dataTable.fnIsDataTable(w.document.querySelector('#table-inventory')),true);
  assert.equal(jq.fn.dataTableSettings.length,1);assert(w.document.querySelector('#table-inventory_filter'));
  assert.equal(w.document.querySelectorAll('[data-tm-v4-section]').length,19);
  for(let i=0;i<3;i++) {await runtime.load('inventory',{force:true});await new Promise(r=>setImmediate(r));assert.equal(jq.fn.dataTableSettings.length,1);}
  assert.equal(runtime.current().sections.get('inventory').status,'ready');assert.match(w.document.querySelector('#table-inventory').textContent,/tsX4/);
  assert.equal(w.document.querySelectorAll('#inventory-status a').length,1);assert.equal(jq.active,0);
  const instance=jq('#table-inventory').dataTable();const settings=instance.fnSettings();
  assert.equal(settings.oScroll.sY,'600px');assert.equal(settings._iDisplayLength,100);
  const filter=w.document.querySelector('.section-placeholder[data-section-type="inventory"] .filters-input input');filter.value='MISSING';jq(filter).trigger('keyup');assert.equal(instance.fnSettings().aiDisplay.length,0);
  filter.value='tsX4';jq(filter).trigger('keyup');assert.equal(instance.fnSettings().aiDisplay.length,1);
  assert.equal(w.document.querySelectorAll('#inventory-status [data-tm-v4-section]').length,1);
  runtime.dispose();runtime.start();bridge.watch();await settle(()=>runtime.current().sections.get('inventory')?.status==='ready','native restart');assert.equal(jq.fn.dataTableSettings.length,1);assert.equal(w.document.querySelectorAll('[data-tm-v4-section]').length,19);
  console.log('PASS actual captured AUI/bootstrap/jQuery 1.6.4/renderer/DataTables 1.9.4/advancedFilter: partial retry, three replays, totals, sorting/scrolling, functional filter, zero leaked instances, one nav/control, native Ajax settled. No live requests.');
} finally {runtime.dispose();bridge.restore();w.close();}
