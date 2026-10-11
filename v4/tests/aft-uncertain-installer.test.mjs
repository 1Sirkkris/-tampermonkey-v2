import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';

const KEY='tm-v4.aft.rows',PARENT='https://fcresearch-fe.aka.amazon.com',NONCE='aabbccdd-1111-2222-3333-444455556666';
const items=[{mode:'sku',code:'X000000001',currentState:'INVENTORY',desiredState:'PENDING_RESEARCH'}];
const payload={area:'edit',mode:'sku',items};
async function tick(){for(let i=0;i<6;i++)await new Promise(resolve=>setTimeout(resolve,0));}
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,0));}assert.fail('Generated AFT fixture did not settle');}

function nativeModel(result='http'){
 let step='item',object=1,quantity=result==='success'?1:2,confirms=0,ends=0,complete=false;const calls=[];
 const texts={item:'Input FNSKU or FCSKU',sourceState:'Select source inventory state',newState:'Select new inventory state',confirm:'Confirm change',success:'Success items changed'};
 const fetch=async(path,init)=>{
  const body=init.body?JSON.parse(init.body):null;calls.push({path,body});
  if(path.startsWith('/app/'))return new Response('<html><body><script type="a-state">'+JSON.stringify({instructionId:'EditItems',objectId:'native-'+object})+'</script><p>Mode: Sku</p><h1>'+texts[step]+'</h1>'+(step==='sourceState'?'<label><input type="radio" value="SELLABLE">Owner: Amazon Quantity: '+quantity+' Sellable</label>':'')+'</body></html>');
  if(path==='/status')return new Response(JSON.stringify({status:complete?'COMPLETE':'READY'}));
  if(path==='/end'){ends++;object++;step='item';complete=false;return new Response('');}
  assert.equal(path,'/action');
  if(body.action==='Confirm'){
   confirms++;if(result==='http')return new Response('{"message":"action reply failed; outcome unspecified"}',{status:400});
   quantity--;step='success';
  }else if(body.action==='Done')complete=true;
  else step=step==='item'?'sourceState':step==='sourceState'?'newState':'confirm';
  return new Response('');
 };
 return{fetch,calls,get confirms(){return confirms;},get ends(){return ends;}};
}

async function install(t,native,{worker=false,saved={}}={}){
 const url='https://aft-qt-jp.aka.nrt.corp.amazon.com/app/edititems'+(worker?'?tmV4ParentOrigin='+encodeURIComponent(PARENT)+'#tm-v4-iss-worker='+NONCE:'');
 const dom=new JSDOM('<body><main>Mode: Sku<h1>Input FNSKU or FCSKU</h1></main></body>',{url,runScripts:'outside-only'}),w=dom.window,messages=[];
 t.after(()=>{w.dispatchEvent(new w.Event('pagehide'));w.close();});
 w.unsafeWindow=w;w.employeeLogin='fixture-user';w.fetch=native.fetch;w.GM_xmlhttpRequest=()=>assert.fail('SKU fixture must not create unrelated requests');
 w.navigator.locks={request:async(name,_options,work)=>work({name})};
 for(const [key,value]of Object.entries(saved))w.localStorage.setItem(key,value);
 const parent={postMessage:data=>messages.push(data)};if(worker)Object.defineProperty(w,'parent',{value:parent});
 w.eval(readFileSync(new URL('../'+(worker?'ISS_Console.user.js':'AFT_Edit_SKU_Move.user.js'),import.meta.url),'utf8'));
 w.document.dispatchEvent(new w.Event('DOMContentLoaded'));await tick();
 const rows=()=>JSON.parse(w.localStorage.getItem(KEY)||'{"rows":[]}').rows;
 const storage=()=>Object.fromEntries(Array.from({length:w.localStorage.length},(_,i)=>{const key=w.localStorage.key(i);return[key,w.localStorage.getItem(key)];}));
 const send=(type,data={})=>w.dispatchEvent(new w.MessageEvent('message',{source:parent,origin:PARENT,data:{protocol:'tm-v4.iss',nonce:NONCE,type,...data}}));
 return{w,messages,rows,storage,send};
}
function input(ui){const root=ui.w.document.querySelector('#tm-v4-aft');root.querySelector('[data-field=code]').value='X000000001';root.querySelector('[data-choice=desiredState][data-value=PENDING_RESEARCH]').click();return root;}

for(const result of ['http','success'])test('actual generated standalone AFT SKU '+result+' preserves native confirmation and UI recovery',async t=>{
 const native=nativeModel(result),ui=await install(t,native),root=input(ui);
 assert.match(ui.w.document.querySelector('#tm-v4-runtime-watermark').textContent,/V4 AFT: 0.1.5/);
 root.querySelector('[data-run]').click();await until(()=>ui.rows().some(row=>row.state===(result==='http'?'UNKNOWN':'CONFIRMED'))&&!root.querySelector('[data-run]').disabled);
 assert.equal(native.confirms,1);assert.equal(native.ends,result==='http'?0:2);
 assert.equal(root.querySelector('.rows [data-state]').dataset.state,result==='http'?'UNKNOWN':'CONFIRMED');
 if(result==='success'){assert.equal(ui.rows()[0].completedOperations.length,1);return;}
 root.querySelector('[data-clear]').click();await until(()=>/Cleared safe rows/.test(root.querySelector('[role=status]').textContent));
 assert.equal(ui.rows()[0].state,'UNKNOWN');input(ui).querySelector('[data-run]').click();await tick();
 assert.equal(native.confirms,1);assert.equal(native.ends,0);assert.equal(ui.rows()[0].state,'UNKNOWN');
 const saved=ui.storage();ui.w.dispatchEvent(new ui.w.Event('pagehide'));const restored=await install(t,native,{saved});
 assert.equal(restored.rows()[0].state,'UNKNOWN');input(restored).querySelector('[data-run]').click();await tick();
 assert.equal(native.confirms,1);assert.equal(native.ends,0);assert.equal(restored.rows()[0].state,'UNKNOWN');
});

for(const result of ['http','success'])test('actual generated ISS native AFT SKU worker '+result+' keeps the shared outcome and replay barriers',async t=>{
 const native=nativeModel(result),worker=await install(t,native,{worker:true});assert(worker.messages.some(data=>data.type==='ready'));
 worker.send('run',{requestId:'first',payload});await until(()=>worker.messages.some(data=>data.type==='result'&&data.requestId==='first'));
 const first=worker.messages.find(data=>data.type==='result'&&data.requestId==='first');
 assert.equal(first.result.outcome,result==='http'?'UNKNOWN':'CONFIRMED');assert.equal(native.confirms,1);assert.equal(native.ends,result==='http'?0:2);
 assert.deepEqual(worker.messages.filter(data=>data.type==='evidence').map(data=>data.record.phase),['SUBMITTED',result==='http'?'UNKNOWN':'CONFIRMED']);
 if(result==='success')return;
 worker.send('control',{action:'clear',area:'edit'});await tick();assert.equal(worker.rows().find(row=>row.mode==='sku').state,'UNKNOWN');
 worker.send('run',{requestId:'second',payload});await until(()=>worker.messages.some(data=>data.type==='result'&&data.requestId==='second'));
 assert.equal(worker.messages.find(data=>data.type==='result'&&data.requestId==='second').error.outcome,'UNKNOWN');
 assert.equal(native.confirms,1);assert.equal(native.ends,0);
 const saved=worker.storage();worker.w.dispatchEvent(new worker.w.Event('pagehide'));const restored=await install(t,native,{worker:true,saved});
 restored.send('run',{requestId:'reloaded',payload});await until(()=>restored.messages.some(data=>data.type==='result'&&data.requestId==='reloaded'));
 assert.equal(restored.messages.find(data=>data.type==='result'&&data.requestId==='reloaded').error.outcome,'UNKNOWN');
 assert.equal(restored.rows().find(row=>row.mode==='sku').state,'UNKNOWN');assert.equal(native.confirms,1);assert.equal(native.ends,0);
});
