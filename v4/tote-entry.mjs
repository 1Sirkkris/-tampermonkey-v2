import { registerWatermark } from './watermark.mjs';
import { createFcrReader } from './fcr-read.mjs';
import { createFcrEnrichment, createGmJsonReader } from './fcr-enrichment.mjs';
import { createMeasurementAuth, installMeasurementCapture } from './measurement-auth.mjs';
import { createToteAudit } from './tote-runtime.mjs';
import { evidence, clean } from './ui-tools.mjs';
const VERSION = '0.1.4';
const page = typeof unsafeWindow === 'object' ? unsafeWindow : window;
const guard = Symbol.for('tampermonkey.v4.tote.installer');
if (!page[guard]) {
  page[guard] = { version: VERSION };
  const storage = { get:(key,fallback)=>GM_getValue(key,fallback),set:(key,value)=>GM_setValue(key,value),listen:(key,callback)=>GM_addValueChangeListener(key,callback),remove:id=>GM_removeValueChangeListener(id) };
  let stop=()=>{};
  const emit=data=>evidence(window,'TOTE',VERSION,data);
  function start(){
    if(location.origin==='https://jp.item-measurement.aft.a2z.com'){const release=registerWatermark(window,'TOTE',VERSION),capture=installMeasurementCapture({page,storage});stop=()=>{capture();release();};return;}
    const warehouse=location.pathname.match(/^\/([A-Z0-9-]{2,12})\/results(?:\/|$)/)?.[1];
    if(!warehouse||location.hash.startsWith('#iss-console'))return;
    const release=registerWatermark(window,'TOTE',VERSION);
    if(!location.hash.startsWith('#fcr-tote-checker')){
      const controller=new window.AbortController();
      document.addEventListener('click',event=>{
        const cell=event.target.closest?.('th,td');if(event.button!==0||!cell||clean(cell.textContent).toLowerCase()!=='dimensions'||!cell.closest('[data-section-type="product"]'))return;
        event.preventDefault();event.stopPropagation();const url=new URL(location.href);url.search='';url.searchParams.set('fcrMode','tote-audit');url.hash='#fcr-tote-checker';location.assign(url.href);
      },{capture:true,signal:controller.signal});stop=()=>{controller.abort();release();};return;
    }
    window.stop();
    if(!document.head)document.documentElement.prepend(document.createElement('head'));
    if(!document.body)document.documentElement.append(document.createElement('body'));
    document.body.replaceChildren();document.title='FC-Lite Tote Audit • '+warehouse;
    const reader=createFcrReader({origin:location.origin,warehouse,fetch:page.fetch.bind(page),DOMParser:window.DOMParser,onEvidence:emit});
    const auth=createMeasurementAuth({window,storage,onEvidence:emit});
    const enrichment=createFcrEnrichment({warehouse,readJson:createGmJsonReader(GM_xmlhttpRequest),getMeasurementAuth:auth.acquire,onEvidence:emit,uuid:()=>window.crypto.randomUUID?.()||[...window.crypto.getRandomValues(new Uint32Array(4))].join('-'),
      historyFallback:async(code,{signal})=>{const end=new Date(),start=new Date(end.getTime()-30*86400000);const result=await reader.history(code,{signal,startDate:start.toISOString().slice(0,10),endDate:end.toISOString().slice(0,10),allowPartial:true});const doc=new DOMParser().parseFromString(result.html,'text/html');return{madcat:/\bMADCAT\b/i.test(doc.querySelector('#table-inventory-history')?.textContent||''),complete:result.complete,rows:doc.querySelectorAll('tbody tr').length};}});
    const audit=createToteAudit({window,reader,enrichment,warehouse,version:VERSION,onEvidence:emit,fetch:page.fetch.bind(page)});
    stop=()=>{audit.dispose();release();};emit({type:'script.start',intent:'read',data:{context:'tote-audit'}});
  }
  start();window.addEventListener('pagehide',()=>stop());window.addEventListener('pageshow',event=>{if(event.persisted)start();});
  let context=location.pathname+location.hash.match(/^#(?:fcr-tote-checker|iss-console)/)?.[0];
  const navigate=()=>{const next=location.pathname+location.hash.match(/^#(?:fcr-tote-checker|iss-console)/)?.[0];if(next!==context){context=next;stop();start();}};
  window.addEventListener('hashchange',navigate);window.addEventListener('popstate',navigate);
}
