import assert from 'node:assert/strict';
import {harness,tick,source} from './harness.mjs';
const frame=()=>new Promise(resolve=>setTimeout(resolve,35));
const boot=(h,app)=>{h.load('apps/'+app+'.js');h.V3.boot();return h;};
const panel=(h,id)=>h.w.document.querySelector(`[data-bwu2-v3-panel="${id}"]`);
// PO Lite survives whole result replacement, keeps precise headers and validates date ranges.
{
 const headers=['PO ID','Status','FC','Ordered','Shipped','First Recv','Last Recv','Exp','Recipient secret'];
 const table=()=>'<table><thead><tr>'+headers.map(x=>'<th>'+x+'</th>').join('')+'</tr></thead><tbody><tr>'+headers.map(x=>'<td>'+x+'</td>').join('')+'</tr></tbody></table>';
 const h=harness({url:'https://console.harmony.a2z.com/poportal/fe',html:table()});
 try{
  const Original=h.w.Date;h.w.Date=class extends Original{constructor(...args){super(...(args.length?args:['2026-03-31T12:00:00']));}};
  boot(h,'poportal');assert.equal(h.w.document.querySelector('th:last-child').style.display,'none');h.w.document.querySelector('[data-v3-button="poportal"]').click();const p=panel(h,'poportal');assert.equal(p.querySelector('[data-start]').value,'2025-09-30');p.querySelector('[data-end]').value='2025-09-29';p.querySelector('[data-search]').onclick();assert.match(p.textContent,/valid start\/end dates/);p.querySelector('[data-view]').click();assert.equal(h.w.document.querySelector('th:last-child').style.display,'');p.querySelector('[data-view]').click();h.w.document.querySelector('#root').innerHTML=table();await frame();assert.equal(h.w.document.querySelector('th:last-child').style.display,'none');
 }finally{h.close();}
}
// Saved OFF must resolve before any automatic click; hydration/readiness and count resets remain supported.
{
 const markup='<span id="input-page-barcode-container-tertiary-text">csX123456</span><div>Barcodes scanned: 2</div><button id="input-page-button-container-button">Complete</button>';
 const h=harness({url:'https://aftcartonpreditorapp-tcp-nrt.nrt.proxy.amazon.com/wf',html:markup});let resolve,clicks=0;h.w.GM_getValue=()=>new Promise(r=>resolve=r);h.w.document.getElementById('input-page-button-container-button').onclick=()=>clicks++;
 try{boot(h,'carton');await frame();assert.equal(clicks,0);resolve(false);await frame();assert.equal(clicks,0);await h.w.document.querySelector('[data-v3-button="carton"]').onclick();h.w.document.querySelector('#root').innerHTML=markup;h.w.document.getElementById('input-page-button-container-button').onclick=()=>clicks++;await frame();assert.equal(clicks,1);h.w.document.querySelector('#root div').textContent='Barcodes scanned: 3';await frame();assert.equal(clicks,1);}finally{h.close();}
}
// Calm cannot fall back to an unrelated form or submit twice on a double click.
{
 const h=harness({html:'<form id="unrelated"><input></form><form id="native"><input id="calmCode"></form>'});let wrong=0,right=0;h.w.document.getElementById('unrelated').requestSubmit=()=>wrong++;h.w.document.getElementById('native').requestSubmit=()=>right++;
 try{boot(h,'calm');const button=panel(h,'calm').querySelector('[data-code="IBPS"]');button.onclick();button.onclick();assert.equal(right,1);assert.equal(wrong,0);assert.equal(h.w.document.getElementById('calmCode').value,'IBPS');}finally{h.close();}
 const h2=harness({html:'<form><input></form><input id="calmCode">'});h2.w.document.querySelector('form').requestSubmit=()=>wrong++;
 try{boot(h2,'calm');panel(h2,'calm').querySelector('[data-code]').onclick();assert.equal(wrong,0);}finally{h2.close();}
}
// SIM editor focus wins over an unrelated textarea; formatting preserves selected rich text.
{
 const h=harness({url:'https://t.corp.amazon.com/issues/example',html:'<textarea id="wrong">search</textarea><textarea id="reply">hello</textarea>'});
 try{boot(h,'sim');const reply=h.w.document.getElementById('reply');reply.focus();reply.setSelectionRange(0,5);h.w.document.querySelector('[data-v3-button="sim"]').click();await tick();panel(h,'sim').querySelector('[data-wrap]').click();assert.equal(reply.value,'**hello**');assert.equal(h.w.document.getElementById('wrong').value,'search');}finally{h.close();}
 const h2=harness({url:'https://t.corp.amazon.com/example',html:'<div contenteditable="true" role="textbox">hello</div>'});
 try{boot(h2,'sim');const el=h2.w.document.querySelector('[contenteditable]'),range=h2.w.document.createRange();range.selectNodeContents(el);h2.w.getSelection().addRange(range);h2.w.document.querySelector('[data-v3-button="sim"]').click();await tick();panel(h2,'sim').querySelector('[data-wrap]').click();assert.equal(el.textContent,'**hello**');}finally{h2.close();}
}
// Range selection follows ticket identities across React replacement and preserves an outside selected row.
{
 const h=harness({url:'https://t.corp.amazon.com/issues'});const selected=new Set([4]);
 const render=()=>{h.w.document.querySelector('#root').innerHTML='<table><tbody>'+[1,2,3,4].map(i=>`<tr><td><input type="checkbox" data-index="${i}" ${selected.has(i)?'checked':''}></td><td><a href="/issues/id${i}">P000000${i}</a></td></tr>`).join('')+'</tbody></table>';for(const box of h.w.document.querySelectorAll('[data-index]'))box.onclick=()=>{const i=Number(box.dataset.index);box.checked?selected.add(i):selected.delete(i);render();};};render();
 try{boot(h,'sim');h.w.document.querySelector('[data-index="1"]').click();await frame();const third=h.w.document.querySelector('[data-index="3"]');third.dispatchEvent(new h.w.MouseEvent('pointerdown',{bubbles:true,shiftKey:true,button:0}));third.dispatchEvent(new h.w.MouseEvent('pointerup',{bubbles:true,shiftKey:true,button:0}));await frame();assert.deepEqual([...selected].sort(),[1,2,3,4]);h.w.document.querySelector('#v3-sim-nav-bar [data-clear]').click();assert.equal(selected.size,0);}finally{h.close();}
}
function obs(shared=new Map(),fail=()=>false,setup=()=>{}){
 const h=harness(),menus=new Map();let exported;
 h.w.GM_getValue=(key,initial)=>shared.has(key)?shared.get(key):initial;
 h.w.GM_setValue=(key,value)=>{if(fail())throw new Error('storage unavailable');shared.set(key,value);};
 h.w.GM_listValues=()=>[...shared.keys()];h.w.GM_deleteValue=key=>shared.delete(key);h.w.GM_registerMenuCommand=(name,action)=>menus.set(name,action);h.w.alert=()=>{};
 h.w.Blob=class{constructor(parts){this.parts=parts;}};h.w.URL.createObjectURL=blob=>{exported=JSON.parse(blob.parts.join(''));return 'blob:test';};h.w.URL.revokeObjectURL=()=>{};h.w.HTMLAnchorElement.prototype.click=()=>{};
 setup(h);boot(h,'obs');return{...h,emit:data=>h.w.dispatchEvent(new h.w.CustomEvent('bwu2-v3:event',{detail:data})),export:()=>[...menus].find(([key])=>key.includes(': Export'))[1](),clear:()=>[...menus].find(([key])=>key.includes(': Clear'))[1](),data:()=>exported};
}
// A failed storage write is retried with the exact pending operation, and credentials are stripped.
{
 let once=true;const h=obs(new Map(),()=>{if(once){once=false;return true;}return false;});
 try{h.emit({ts:1,tool:'movecontainer',event:'operation',data:{id:'op1',state:'UNKNOWN',cookie:'secret',message:'https://example.com/path?anti-csrftoken-a2z=secret'}});await tick();await h.export();assert.equal(h.data(),undefined);await h.export();assert.equal(h.data().events.length,1);assert.equal(h.data().events[0].data.state,'UNKNOWN');assert.ok(!JSON.stringify(h.data()).includes('secret'));assert.equal(h.data().retention.saveFailures,1);}finally{h.close();}
}
// Another tab cannot resurrect cleared pre-clear events, but its new operations survive.
{
 const shared=new Map(),a=obs(shared),b=obs(shared);
 try{a.emit({ts:1,event:'oldA'});b.emit({ts:2,event:'oldB'});await tick();await a.export();await a.clear();b.emit({ts:3,event:'newB'});await tick();await b.export();assert.deepEqual(b.data().events.map(row=>row.event),['newB']);}finally{a.close();b.close();}
}
// Network hooks preserve the exact native response/request while logging only high-signal metadata.
{
 const response={status:202,redirected:false},calls=[];let original,OriginalXHR;
 const h=obs(new Map(),()=>false,h=>{
  original=h.w.fetch=async(...args)=>{calls.push(args);return response;};
  OriginalXHR=class extends h.w.EventTarget{open(method,url){this.method=method;this.url=url;}send(body){this.body=body;this.status=204;this.dispatchEvent(new h.w.Event('loadend'));}};
  h.w.XMLHttpRequest=OriginalXHR;
 });
 try{
  const options={method:'POST',body:'private payload',headers:{Authorization:'Bearer secret'}};
  assert.equal(await h.w.fetch('https://example.com/move?token=secret',options),response);assert.equal(calls[0][1],options);
  await h.w.fetch('https://example.com/read');const xhr=new h.w.XMLHttpRequest();xhr.open('POST','https://example.com/bind?csrf=secret');xhr.send('private payload');
  const operation=h.V3.core.operation({kind:'gm-move',ref:'tsX123',telemetry:h.V3.core.telemetry('movecontainer','test')});operation.submitted();operation.unknown();await tick();await h.export();
  assert.equal(h.data().events.filter(row=>row.tool==='native-network').length,4);assert.equal(h.data().events.filter(row=>row.event==='operation').length,2);assert.ok(!JSON.stringify(h.data()).includes('secret'));assert.ok(!JSON.stringify(h.data()).includes('private payload'));assert.ok(h.data().events.some(row=>row.data?.status===202));
 }finally{h.close();assert.equal(h.w.fetch,original);assert.equal(OriginalXHR.prototype.open.toString().includes('this.method'),true);}
}
// An actual worker-frame realm emits canonical mutation outcomes into the shared OBS store.
{
 const shared=new Map(),parent=obs(shared),iframe=parent.w.document.createElement('iframe');parent.w.document.body.append(iframe);const worker=iframe.contentWindow;
 worker.structuredClone=structuredClone;worker.GM_getValue=(key,initial)=>shared.has(key)?shared.get(key):initial;worker.GM_setValue=(key,value)=>shared.set(key,value);worker.GM_listValues=()=>[...shared.keys()];worker.GM_deleteValue=key=>shared.delete(key);worker.GM_registerMenuCommand=()=>{throw new Error('Worker must not register duplicate menus');};worker.unsafeWindow=worker;worker.fetch=async()=>({status:200});
 try{
  worker.eval('window.V3={build:{version:"test"}}');for(const file of ['core.js','state.js','transport.js','identity.js','native.js','apps/obs.js'])worker.eval(source(file));worker.V3.boot();const operation=worker.V3.core.operation({kind:'worker-gm-move',ref:'tsX123',telemetry:worker.V3.core.telemetry('aft-worker','test')});operation.submitted();operation.unknown();await tick();worker.dispatchEvent(new worker.Event('pagehide'));await tick();await parent.export();assert.equal(parent.data().events.filter(row=>row.tool==='aft-worker').length,2);assert.ok([...shared.values()].some(value=>value?.context==='frame'));
 }finally{parent.close();}
}
// Screenshot hiding applies to newly-added UI, restores CSS rather than overwriting styles, and ignores repeat keys.
{
 const h=harness({html:'<div data-bwu2-ui style="display:flex">tools</div><p>native</p>'});
 try{boot(h,'screenshot');h.V3.boot();const key=repeat=>new h.w.KeyboardEvent('keydown',{key:'q',ctrlKey:true,repeat,bubbles:true,cancelable:true});h.w.dispatchEvent(key(false));assert.equal(h.w.document.documentElement.getAttribute('data-bwu2-v3-screenshot'),'1');h.w.dispatchEvent(key(true));assert.equal(h.w.document.documentElement.getAttribute('data-bwu2-v3-screenshot'),'1');h.w.dispatchEvent(key(false));assert.equal(h.w.document.documentElement.getAttribute('data-bwu2-v3-screenshot'),'0');assert.equal(h.w.document.querySelector('[data-bwu2-ui]').style.display,'flex');assert.equal(h.w.document.querySelectorAll('#bwu2-v3-screenshot-style').length,1);}finally{h.close();}
}
console.log('PASS remaining: PO local calendar/month end/schema/result replacement; Carton saved OFF/latch; Calm native form/double click; SIM focused/rich editors and React range; OBS failure retry/clear isolation/redaction; screenshot repeat/restore');
