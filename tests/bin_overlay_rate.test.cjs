const fs=require('fs'), vm=require('vm'), assert=require('assert/strict');
const path=require('path');
const source=fs.readFileSync(path.join(__dirname,'..','Bin_Check_Overlay.user.js'),'utf8');
const fixture=(size='9',floor=4)=>`<table><tr><th>Bin type</th><td>${size}-KIVA-DEEP</td></tr><tr><th>Noise</th><td>99</td></tr>${floor===null?'':`<tr><th>Location</th><td>Floor: ${floor}, Aisle: 1, Shelf: C, Slot: 52</td></tr>`}</table>`;
const exported='state,parseFloor,unknownFloor,makeInventoryRecord,applyPodResult,writeFloorCache,readFloorCache,renderRow,visibleRows,copyLazyBinCheck,lookupCounts,pumpQueue,resetRun,recheckUnresolved,enqueuePod,toggleFloor,savePreferences,readPreferences,updateControlStates,updateStatus,retryAfterMs,loadSnapshot,readPace,adjustPace,statsSnapshot,sortByHeader,renderDetailsRow,sizeBadgeClass,unresolvedPods,buildOverlay';
const names=['P-1-A000B000','P-1-A001B000','P-1-A002B000'];
function harness({prefs=null,session=null,fetcher=null,pace=null,clockStart=1800000000000}={}){
 let clock=clockStart,nextTimer=0;const timers=new Map(),ids=new Map(),calls=[],traces=[];
 const persisted=new Map(prefs?[['bwu2-bin-overlay-preferences-v1',JSON.stringify(prefs)]]:[]),stored=session||new Map();if(pace)persisted.set('bwu2-bin-overlay-pace-v1',JSON.stringify(pace));
 class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.style={};this.textContent='';this.dataset={};this.attributes={};this.listeners={};this.classes=new Set();this.classList={toggle:(k,on)=>on?this.classes.add(k):this.classes.delete(k)};}
  append(...x){this.children.push(...x)} appendChild(x){this.append(x);return x} get cells(){return this.children}
  focus(){document.activeElement=this} select(){} setSelectionRange(){} remove(){} addEventListener(k,fn){this.listeners[k]=fn}
  setAttribute(k,v){this.attributes[k]=v} replaceChildren(...x){this.children=x}
  querySelector(tag){return this.children.find(child=>child.tagName===tag.toUpperCase())||null}
 }
 const document={createElement:t=>new Element(t),createDocumentFragment:()=>new Element('fragment'),body:new Element('body'),activeElement:null,getElementById:id=>ids.get(id)||null,querySelector:()=>null,querySelectorAll:sel=>[...ids.values()].filter(e=>sel.includes('[data-filter]')?e.dataset?.filter:sel.includes('[data-sort-column]')?e.dataset?.sortColumn:false)};
 const storage=m=>({getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)});
 const date=class extends Date{constructor(...args){super(...(args.length?args:[clock]))} static now(){return clock}};
 const c={window:{},location:{hash:'',href:'https://offline.test/BWU2/results?s=item'},URL,document,Date:date,performance:{now:()=>clock},AbortController,
 sessionStorage:storage(stored),localStorage:storage(persisted),setTimeout:(fn,ms)=>{const id=++nextTimer;timers.set(id,{at:clock+Math.max(0,ms),fn});return id},clearTimeout:id=>timers.delete(id),navigator:{},
 DOMParser:class{parseFromString(html){const rows=[...html.matchAll(/<tr>(.*?)<\/tr>/gs)].map(m=>({children:[...m[1].matchAll(/<(td|th)>(.*?)<\/\1>/gs)].map(c=>({tagName:c[1].toUpperCase(),textContent:c[2].replace(/<[^>]*>/g,'')}))}));return {querySelectorAll:()=>rows}}},
 BWU2Fleet:{clean:v=>String(v??'').replace(/\s+/g,' ').trim(),registerRuntimeVersion(){},usage(){},trace:(name,data)=>traces.push({name,data})},fetch:async(url,options)=>{
 const pod=new URL(url).searchParams.get('s');calls.push({at:clock,pod});return fetcher?fetcher(pod,options,calls,c):response();
 }};
 vm.createContext(c);vm.runInContext(source.replace('  start();',`  window.testBin={${exported}};`),c);
 const t=c.window.testBin;
 const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()};
 async function advance(ms){const until=clock+ms;await flush();let guard=0;while(true){let first=[...timers].filter(([,v])=>v.at<=until).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!first)break;if(++guard>100000)throw Error('timer loop');clock=first[1].at;timers.delete(first[0]);first[1].fn();await flush();}clock=until;await flush()}
 function add(pod,qty=1,fnsku='TEST'){
 const record=t.makeInventoryRecord({container:pod,qty,fnsku});assert(record);t.state.rows.push(record);
 if(!t.state.podBuckets.has(pod)){t.state.podBuckets.set(pod,[]);t.state.jobs.set(pod,{status:'pending',attempts:0,nextAt:0,error:'',result:t.unknownFloor()});t.enqueuePod(pod)}
 t.state.podBuckets.get(pod).push(record);t.state.totalPods=t.state.podBuckets.size;return record;
 }
 function element(id,tag='button'){const e=new Element(tag);ids.set(id,e);return e}
 return {t,c,ids,calls,traces,timers,stored,persisted,add,element,flush,advance,now:()=>clock};
}
function response(status=200,html=fixture(),retryAfter=''){return {status,ok:status>=200&&status<300,headers:{get:()=>retryAfter},text:async()=>html}}
let checks=0;async function test(name,fn){await fn();checks++;console.log('PASS',name)}
(async()=>{
await test('all five sizes, reordered fields and missing/unknown data',()=>{
 const h=harness();for(const s of ['6','9','11','14','18.5']){let r=h.t.parseFloor(fixture(s));assert.equal(r.binSize,s+'"');assert.equal(r.label,'P4')}
 assert.equal(h.t.parseFloor('<p>Login</p>').label,'P-');assert.equal(h.t.parseFloor(fixture('SPECIAL')).binSize,'');
});
await test('independent floor toggles, All, unknown floor option, empty selection and persisted settings',()=>{
 const h=harness();const a=h.add(names[0]),b=h.add(names[1]),u=h.add(names[2]);h.t.applyPodResult(a.pod,h.t.parseFloor(fixture('9',2)));h.t.applyPodResult(b.pod,h.t.parseFloor(fixture('11',4)));
 h.t.toggleFloor('P2');h.t.toggleFloor('P1');assert.deepEqual([...h.t.visibleRows()].map(r=>r.pod),[b.pod,u.pod]);
 h.t.state.sort='SIZE_DESC';h.t.savePreferences();const loaded=harness({prefs:JSON.parse(h.persisted.values().next().value)});assert(!loaded.t.state.selectedFloors.has('P2'));assert.equal(loaded.t.state.sort,'SIZE_DESC');
 for(const f of [...h.t.state.selectedFloors])h.t.toggleFloor(f);assert.equal(h.t.visibleRows().length,0);
 h.t.toggleFloor('ALL');assert.equal(h.t.visibleRows().length,3);h.t.resetRun();assert.equal(h.t.state.selectedFloors.size,5);assert.equal(h.t.state.sort,'SIZE_DESC');
 assert.equal(harness({prefs:{floors:['BAD'],sort:'BAD'}}).t.state.selectedFloors.size,5);
});
await test('numeric size sorting both ways, unknown always last, quantity sorting preserved',()=>{
 const h=harness();const rows=[h.add(names[0],3),h.add(names[1],1),h.add(names[2],2)];h.t.applyPodResult(rows[0].pod,h.t.parseFloor(fixture('18.5')));h.t.applyPodResult(rows[1].pod,h.t.parseFloor(fixture('9')));
 h.t.state.sort='SIZE_ASC';assert.deepEqual([...h.t.visibleRows()].map(r=>r.binSize),['9"','18.5"','']);h.t.state.sort='SIZE_DESC';assert.deepEqual([...h.t.visibleRows()].map(r=>r.binSize),['18.5"','9"','']);
 h.t.state.sort='QTY_ASC';assert.deepEqual([...h.t.visibleRows()].map(r=>r.quantityValue),[1,2,3]);h.t.state.sort='QTY_DESC';assert.deepEqual([...h.t.visibleRows()].map(r=>r.quantityValue),[3,2,1]);
});
await test('paced initial requests, three hundred thirty-one successes and no duplicate records',async()=>{
 const h=harness();for(let i=0;i<331;i++)h.add(`P-1-A${String(i).padStart(3,'0')}B000`);h.t.pumpQueue();await h.advance(135000);
 assert.equal(h.calls.length,331);assert.equal(h.t.lookupCounts().ready,331);assert.equal(h.t.state.rows.length,331);assert.equal(h.t.state.activeRequests,0);
 assert(h.calls.slice(1).every((r,i)=>r.at-h.calls[i].at>=250));assert.equal(h.traces.filter(e=>e.name==='BIN_OVERLAY_READY').length,1);
});
await test('429 shared cooldown respects Retry-After and slows subsequent traffic',async()=>{
 const h=harness({fetcher:(_,__,calls)=>calls.length===1?response(429,'','30'):response()});h.add(names[0]);h.add(names[1]);h.t.pumpQueue();await h.flush();
 assert.equal(h.t.state.requestGapMs,800);assert.equal(h.t.lookupCounts().pending,2);await h.advance(29999);assert.equal(h.calls.length,1);await h.advance(1);assert.equal(h.calls.length,2);await h.advance(1000);assert.equal(h.t.lookupCounts().ready,2);
 assert(h.calls[1].at-h.calls[0].at>=30000);assert(h.calls[2].at-h.calls[1].at>=800);
 assert.equal(h.t.retryAfterMs('bad'),0);assert.equal(h.t.retryAfterMs('5'),5000);assert.equal(h.t.retryAfterMs(new Date(h.now()+60000).toUTCString()),60000);
});
await test('automatic retries wait until initial lookups complete and recover in place',async()=>{
 let failed=false;const h=harness({fetcher:pod=>{if(pod===names[0]&&!failed){failed=true;return response(500)}return response()}});h.add(names[0]);h.add(names[1]);h.t.pumpQueue();await h.advance(11000);
 assert.deepEqual(h.calls.map(r=>r.pod),[names[0],names[1],names[0]]);assert(h.calls[2].at-h.calls[0].at>=10000);assert.equal(h.t.lookupCounts().ready,2);assert.equal(h.t.state.rows.length,2);
});
await test('size-only failures retry; confirmed floor survives a partial response',async()=>{
 const h=harness({fetcher:(_,__,calls)=>calls.length===1?response(200,'<table><tr><th>Location</th><td>Floor: 3, Aisle: 1</td></tr></table>'):response(200,fixture('18.5',null))});h.add(names[0]);h.t.pumpQueue();await h.flush();assert.equal(h.t.state.rows[0].floorLabel,'P3');assert.equal(h.t.lookupCounts().pending,1);await h.advance(11000);assert.equal(h.t.lookupCounts().ready,1);assert.equal(h.t.state.rows[0].binSize,'18.5"');assert.equal(h.t.state.rows[0].floorLabel,'P3');
});
await test('bounded failures, truthful counts, bulk-only recovery and repeated-click deduplication',async()=>{
 let fail=true;const h=harness({fetcher:()=>fail?response(429):response()});const a=h.add(names[0]);h.add(names[0],2);h.add(names[1]);h.t.pumpQueue();await h.advance(400000);
 assert.equal(h.calls.length,6);assert.equal(h.t.lookupCounts().failed,2);assert.equal(h.t.state.rows.length,3);assert.equal(h.stored.size,0);
 const status=h.element('pLevelOverlayStatus','span'),bulk=h.element('pLevelRecheckBtn');h.t.updateStatus();assert.equal(status.textContent,'0/2 loaded • 0 pending • 2 unresolved');assert.equal(bulk.disabled,false);assert.equal(bulk.textContent,'Recheck unresolved (2)');
 const row=h.t.renderRow(a);assert.equal(row.cells[1].children.filter(child=>child.tagName==='BUTTON').length,1);assert.match(row.cells[1].children[2].title,/HTTP 429/);assert.equal(row.cells[1].children[2].textContent,'⚠ Unresolved');
 fail=false;h.t.recheckUnresolved();h.t.recheckUnresolved();await h.flush();assert.equal(h.calls.length,7);assert.equal(h.t.lookupCounts().ready,1);
 await h.advance(6000);assert.equal(h.calls.length,8);assert.equal(h.t.lookupCounts().ready,2);assert.equal(h.t.state.rows.length,3);assert.equal(h.t.renderRow(a).cells[1].children.length,2);
 h.t.updateStatus();assert.equal(bulk.textContent,'Recheck unresolved (0)');assert.equal(bulk.disabled,true);
});
await test('manual recheck and reset do not bypass a current rate-limit cooldown',async()=>{
 const h=harness({fetcher:()=>response(429,'','60')});h.add(names[0]);h.t.pumpQueue();await h.flush();const until=h.t.state.cooldownUntil;
 h.t.state.jobs.get(names[0]).status='failed';h.t.state.queue=[];h.t.state.queued.clear();h.t.recheckUnresolved();await h.advance(1000);assert.equal(h.calls.length,1);h.t.resetRun();assert.equal(h.t.state.cooldownUntil,until);h.add(names[0]);h.t.pumpQueue();await h.advance(58000);assert.equal(h.calls.length,1);await h.advance(1000);assert.equal(h.calls.length,2);
});
await test('pause prevents queued attempts; Resume continues; one request in flight at a time',async()=>{
 let resolve;const h=harness({fetcher:()=>new Promise(r=>resolve=r)});h.add(names[0]);h.add(names[1]);h.t.pumpQueue();h.t.pumpQueue();assert.equal(h.calls.length,1);h.t.state.paused=true;resolve(response());await h.advance(5000);assert.equal(h.calls.length,1);h.t.state.paused=false;h.t.pumpQueue();assert.equal(h.calls.length,2);resolve(response());await h.flush();assert.equal(h.t.lookupCounts().ready,2);
});
await test('request timeout becomes retryable; stale responses after reset cannot mutate a new run',async()=>{
 const h=harness({fetcher:(_,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>{const e=Error('abort');e.name='AbortError';reject(e)}))});h.add(names[0]);h.t.pumpQueue();await h.advance(25000);assert.equal(h.t.state.jobs.get(names[0]).status,'retry');assert.equal(h.t.state.jobs.get(names[0]).error,'Request timed out');
 let oldResolve,newResolve;const h2=harness({fetcher:(_,__,calls)=>new Promise(resolve=>{if(calls.length===1)oldResolve=resolve;else newResolve=resolve})});h2.add(names[0]);h2.t.pumpQueue();h2.t.resetRun();h2.add(names[0]);await h2.advance(500);h2.t.pumpQueue();oldResolve(response(200,fixture('18.5',2)));await h2.flush();assert.equal(h2.t.state.rows[0].floorLabel,'P-');assert.equal(h2.t.state.activeRequests,1);newResolve(response());await h2.flush();assert.equal(h2.t.state.rows[0].floorLabel,'P4');assert.equal(h2.t.state.activeRequests,0);
});
await test('only complete timestamped successes cache, both memory and session TTL expire',async()=>{
 const h=harness();const good=h.t.parseFloor(fixture()),partial=h.t.parseFloor(fixture('9',null));h.t.writeFloorCache(names[0],partial);assert.equal(h.t.readFloorCache(names[0]),null);h.t.writeFloorCache(names[0],good);assert.equal(h.t.readFloorCache(names[0]).binSize,'9"');await h.advance(30*60*1000+1);assert.equal(h.t.readFloorCache(names[0]),null);
 h.stored.set('bwu2-bin-floor-v2:'+names[1],JSON.stringify({ts:h.now(),value:partial}));assert.equal(h.t.readFloorCache(names[1]),null);
});
await test('Lazy copy uses all scanned floors while display filters hide them, and waits for retries',async()=>{
 const h=harness();h.add(names[0],2);h.add(names[1],5);h.t.pumpQueue();await h.advance(1000);
 h.t.applyPodResult(names[0],h.t.parseFloor(fixture('9',2)));h.t.applyPodResult(names[1],h.t.parseFloor(fixture('9',4)));h.t.toggleFloor('P2');h.t.toggleFloor('P4');let copied='';h.c.document.execCommand=()=>{copied=h.c.document.activeElement.value;return true};h.t.copyLazyBinCheck();assert.equal(copied,`TEST\t${names[0]}\t\t${names[1]}`);
 copied='';h.t.state.jobs.get(names[0]).status='retry';h.t.copyLazyBinCheck();assert.equal(copied,'');
});
await test('floor toggle accessibility states reflect saved choices',()=>{
 const h=harness();for(const f of ['ALL','P1','P2','P3','P4','OTHER'])h.element(f).dataset.filter=f;h.t.toggleFloor('P1');assert.equal(h.ids.get('P1').attributes['aria-pressed'],'false');assert.equal(h.ids.get('P4').attributes['aria-pressed'],'true');assert.equal(h.ids.get('ALL').attributes['aria-pressed'],'false');
});
await test('Inventory snapshot integration, duplicate SKU rows, cached reopen and preserved preferences',async()=>{
 const h=harness();
 const table={querySelectorAll:()=>['Container','FNSKU','FcSku','Quantity'].map(text=>({id:'',textContent:text})),tBodies:[{rows:[
  {cells:[names[0],'TEST','SKU','2'].map(textContent=>({textContent})),style:{},getAttribute:()=>null},
  {cells:[names[0],'TEST2','SKU2','5'].map(textContent=>({textContent})),style:{},getAttribute:()=>null},
  {cells:['tsOTHER','TEST','SKU','1'].map(textContent=>({textContent})),style:{},getAttribute:()=>null}
 ]}]};
 h.ids.set('table-inventory',table);h.t.toggleFloor('P2');h.t.state.sort='SIZE_DESC';await h.t.loadSnapshot();await h.advance(1000);
 assert.equal(h.calls.length,1);assert.equal(h.t.state.totalPods,1);assert.equal(h.t.state.rows.length,2);assert.equal(h.t.lookupCounts().ready,1);
 await h.t.loadSnapshot();await h.advance(1000);assert.equal(h.calls.length,1);assert.equal(h.t.state.rows.length,2);assert.equal(h.t.lookupCounts().ready,1);assert(!h.t.state.selectedFloors.has('P2'));assert.equal(h.t.state.sort,'SIZE_DESC');
});
await test('speed changes only after 20 clean lookups, in 25ms steps, bounded at 250ms',async()=>{
 const h=harness();for(let i=0;i<200;i++)h.add(`P-1-A${String(i).padStart(3,'0')}B000`);h.t.pumpQueue();await h.advance(100000);
 assert.equal(h.t.state.requestGapMs,250);const changes=h.traces.filter(e=>e.name==='BIN_OVERLAY_RATE_CHANGE');assert.deepEqual(changes.map(e=>e.data.gapMs),[375,350,325,300,275,250]);assert(h.calls.slice(1).every((r,i)=>r.at-h.calls[i].at>=250));
 assert.equal(h.t.statsSnapshot().peakInFlight,1);assert.equal(h.t.statsSnapshot().requests,200);
});
await test('only a proven pace is remembered; next load adds headroom; stale/invalid pace resets',async()=>{
 const h=harness();for(let i=0;i<20;i++)h.add(`P-1-A${String(i).padStart(3,'0')}B000`);h.t.pumpQueue();await h.advance(10000);assert.equal(h.t.state.requestGapMs,375);
 const pace=JSON.parse(h.persisted.get('bwu2-bin-overlay-pace-v1'));assert.equal(pace.gapMs,400);assert.equal(harness({pace,clockStart:h.now()}).t.state.requestGapMs,425);
 assert.equal(harness({pace:{...pace,gapMs:1}}).t.state.requestGapMs,400);assert.equal(harness({pace:{...pace,ts:pace.ts-25*60*60*1000}}).t.state.requestGapMs,400);
});
await test('one 429 freezes acceleration for the scan and persists the backed-off pace',async()=>{
 const h=harness({fetcher:(_,__,calls)=>calls.length===22?response(429):response()});for(let i=0;i<100;i++)h.add(`P-1-A${String(i).padStart(3,'0')}B000`);h.t.pumpQueue();await h.advance(150000);
 assert.equal(h.t.lookupCounts().ready,100);assert.equal(h.t.state.requestGapMs,750);assert.equal(h.t.state.accelerationBlocked,true);assert.equal(h.traces.filter(e=>e.name==='BIN_OVERLAY_RATE_CHANGE'&&e.data.reason==='clean-window').length,1);
 const pace=JSON.parse(h.persisted.get('bwu2-bin-overlay-pace-v1'));assert.equal(harness({pace,clockStart:h.now()}).t.state.accelerationBlocked,true);
});
await test('server errors stop acceleration and timing/status telemetry distinguishes them',async()=>{
 const h=harness({fetcher:(_,__,calls)=>calls.length===1?response(503):response()});for(let i=0;i<45;i++)h.add(`P-1-A${String(i).padStart(3,'0')}B000`);h.t.pumpQueue();await h.advance(60000);
 const summary=h.traces.find(e=>e.name==='BIN_OVERLAY_SCAN_SUMMARY').data;
 assert.equal(summary.requests,46);assert.equal(summary.retries,1);assert.equal(summary.httpStatusCounts[503],1);assert.equal(summary.httpStatusCounts[200],45);assert.equal(summary.ready,45);assert.equal(summary.failed,0);assert.equal(summary.gapMs,500);assert.equal(summary.accelerationBlocked,true);
 const results=h.traces.filter(e=>e.name==='BIN_OVERLAY_RESULT');assert.equal(results.length,46);assert.equal(results[0].data.errorKind,'http');assert.equal(results[0].data.willRetry,true);assert(results.slice(1).every(e=>e.data.floorFound&&e.data.sizeFound));
 assert(h.traces.some(e=>e.name==='BIN_OVERLAY_SCAN_PROGRESS'));assert.equal(h.traces.filter(e=>e.name==='BIN_OVERLAY_REQUEST').length,46);
});
await test('realistic response latency is measured and never creates overlapping lookups',async()=>{
 const h=harness({fetcher:(_,__,___,c)=>new Promise(resolve=>c.setTimeout(()=>resolve(response()),300))});
 for(let i=0;i<60;i++)h.add(`P-1-A${String(i).padStart(3,'0')}B000`);
 h.t.pumpQueue();await h.advance(30000);const summary=h.traces.find(e=>e.name==='BIN_OVERLAY_SCAN_SUMMARY').data;
 assert.equal(summary.averageMs,300);assert.equal(summary.p95Ms,300);assert.equal(summary.peakInFlight,1);assert.equal(summary.requests,60);assert(h.calls.slice(1).every((r,i)=>r.at-h.calls[i].at>=300));
});
await test('clickable header cycles, unknown floors/sizes last and saved sort migration',()=>{
 const h=harness();const a=h.add(names[0]),b=h.add(names[1]),u=h.add(names[2]);h.t.applyPodResult(a.pod,h.t.parseFloor(fixture('9',2)));h.t.applyPodResult(b.pod,h.t.parseFloor(fixture('18.5',4)));
 assert.equal(h.t.state.sort,'FLOOR_DESC');assert.deepEqual([...h.t.visibleRows()].map(r=>r.floorLabel),['P4','P2','P-']);
 h.t.sortByHeader('FLOOR');assert.equal(h.t.state.sort,'FLOOR_ASC');assert.deepEqual([...h.t.visibleRows()].map(r=>r.floorLabel),['P2','P4','P-']);
 h.t.sortByHeader('SIZE');assert.equal(h.t.state.sort,'SIZE_DESC');assert.deepEqual([...h.t.visibleRows()].map(r=>r.binSize),['18.5"','9"','']);h.t.sortByHeader('SIZE');assert.equal(h.t.state.sort,'SIZE_ASC');assert.equal(h.t.visibleRows()[2].binSize,'');
 h.t.sortByHeader('QTY');assert.equal(h.t.state.sort,'QTY_DESC');h.t.sortByHeader('QTY');assert.equal(h.t.state.sort,'QTY_ASC');
 assert.equal(harness({prefs:{floors:['P4'],sort:'DEFAULT'}}).t.state.sort,'FLOOR_ASC');assert.equal(harness({prefs:JSON.parse(h.persisted.get('bwu2-bin-overlay-preferences-v1'))}).t.state.sort,'QTY_ASC');
 const unchanged=h.t.state.sort;h.t.sortByHeader('INVALID');assert.equal(h.t.state.sort,unchanged);
});
await test('sort header accessibility, visible FcSKU, FNSKU disclosure and preserved FCResearch link',()=>{
 const h=harness();const header=h.element('sizeHeader','th'),button=h.element('sizeButton');header.dataset.sortColumn='SIZE';header.appendChild(button);h.t.sortByHeader('SIZE');assert.equal(header.attributes['aria-sort'],'descending');assert.equal(button.textContent,'Size ↓');h.t.sortByHeader('SIZE');assert.equal(header.attributes['aria-sort'],'ascending');assert.equal(button.textContent,'Size ↑');
 const a=h.add(names[0],7,'FNSKU_TEST');a.fcsku='FCSKU_TEST';h.t.applyPodResult(a.pod,h.t.parseFloor(fixture('18.5',4)));const row=h.t.renderRow(a);assert.equal(row.cells.length,5);assert.equal(row.cells[3].textContent,'FCSKU_TEST');assert.equal(row.cells[4].textContent,'7');assert.equal(row.cells[2].children[0].className,'p-size-badge p-size-18-5');
 row.cells[1].children[0].listeners.click();assert(h.t.state.openDetails.has(a.rowId));assert(h.t.renderDetailsRow(a).cells[0].textContent.includes('FNSKU_TEST'));assert.equal(row.cells[1].children[1].href,a.containerHref);assert.equal(row.cells[1].children[1].target,'_blank');h.t.resetRun();assert.equal(h.t.state.openDetails.size,0);
});
await test('bulk unresolved includes hidden floors and partial data; active jobs stay deduplicated',async()=>{
 const h=harness();const a=h.add(names[0]);const partial=h.t.parseFloor('<table><tr><td>Location</td><td>Floor: 2</td></tr></table>');const job=h.t.state.jobs.get(a.pod);job.result=partial;job.status='failed';h.t.applyPodResult(a.pod,partial);h.t.toggleFloor('P2');assert.equal(h.t.visibleRows().length,0);
 h.t.state.queue=[];h.t.state.queued.clear();h.t.recheckUnresolved();h.t.recheckUnresolved();await h.advance(1000);assert.equal(h.calls.length,1);assert.equal(h.t.lookupCounts().ready,1);assert.equal(h.t.state.rows.length,1);
 const pending=h.add(names[1]);const before=h.t.state.jobs.get(pending.pod).attempts;h.t.recheckUnresolved();assert.equal(h.t.state.jobs.get(pending.pod).attempts,before);assert.equal(h.t.state.queue.filter(x=>x===pending.pod).length,1);
});
await test('blue size badges retain readable contrast and no per-row retry listener exists',()=>{
 const lum=hex=>{const c=[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2]};
 for(const [size,bg,fg] of [['6','e7f1ff','17365f'],['9','bdd7f5','16355c'],['11','82afe2','102e50'],['14','386fae','ffffff'],['18.5','16457a','ffffff']]){const a=lum(bg),b=lum(fg);assert((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5);assert.equal(harness().t.sizeBadgeClass(size+'"'),'p-size-'+size.replace('.','-'));}
 assert(!source.includes('Retry this bin'));assert(!source.includes('p-level-retry'));assert(!source.includes('data-sort="'));assert(source.includes('Recheck unresolved'));
});
console.log(`${checks} scenario groups passed. Actual-source VM execution with deterministic fetch/clock and DOM fixtures. No browser rendering or live FCResearch calls.`);
})().catch(e=>{console.error(e);process.exit(1)});

