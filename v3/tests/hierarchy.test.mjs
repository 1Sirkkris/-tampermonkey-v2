import assert from 'node:assert/strict';
import {harness,tick} from './harness.mjs';
const origin='https://tx-b-hierarchy-nrt.nrt.proxy.amazon.com';
const modules=['core.js','state.js','transport.js','identity.js','native.js','hierarchy.js'];
const response=(data,{status=200,url='',type='application/json'}={})=>({status,url,headers:{get:()=>type},clone:()=>({text:async()=>JSON.stringify(data)})});
const apiResult=(data,status=200,extra={})=>({status,data,raw:JSON.stringify(data),flags:{auth:false,html:false},...extra});
function bindFixture({mode='normal',mutation={},status=200,url='',type='application/json',transport='fetch'}={}) {
 const h=harness({url:origin+'/bindHierarchy',html:'<h1>Scan container</h1><input aria-label="Destination FC" id="destination"><input aria-label="Container" id="container"><div role="status" id="status"></div>',modules});
 const destination=h.w.document.getElementById('destination'),container=h.w.document.getElementById('container'),heading=h.w.document.querySelector('h1'),notice=h.w.document.getElementById('status');
 let scans=0,mutations=0,requests=[];
 const server=async(input,options={})=>{
  const path=new URL(typeof input==='string'?input:input.url,origin).pathname,body=JSON.parse(options.body ?? await input.clone().text());requests.push({path,body});
  if(path==='/validateDestination')return response(destination.value);
  if(path==='/validateContainer')return response({warehouseId:'BWU2',scannableId:mode==='wrongValidation'?'tsXOTHER':body.scannableId});
  if(path==='/getTransshipmentBindingSummary')return response({transferBindingSummaryList:[]});
  assert.equal(path,'/forceBind');mutations++;
  if(mode==='lost')throw new Error('lost native response');
  return response({hostName:'native-host',...mutation},{status,url,type});
 };
 h.w.fetch=server;
 h.w.XMLHttpRequest=class extends h.w.EventTarget {
  open(method,url){this.method=method;this.url=url;}
  getResponseHeader(){return this.contentType;}
  send(body){void server(this.url,{method:this.method,body}).then(async result=>{
   this.status=result.status;this.responseURL=result.url;this.contentType=result.headers.get('content-type');this.responseText=await result.clone().text();this.dispatchEvent(new h.w.Event('loadend'));
  },()=>{this.status=0;this.responseText='';this.dispatchEvent(new h.w.Event('loadend'));});}
 };
 const send=(path,body)=>{
  if(transport==='request')return h.w.fetch(new Request(origin+path,{method:'POST',body:JSON.stringify(body)}));
  if(transport==='xhr')return new Promise(resolve=>{const xhr=new h.w.XMLHttpRequest();xhr.open('POST',path);xhr.addEventListener('loadend',resolve,{once:true});xhr.send(JSON.stringify(body));});
  return h.w.fetch(path,{method:'POST',body:JSON.stringify(body)});
 };
 destination.addEventListener('keydown',event=>{if(event.key==='Enter')void send('/validateDestination',{destinationWarehouseId:'opaque-'+destination.value}).catch(()=>{});});
 container.addEventListener('keydown',event=>{
  if(event.key!=='Enter')return;scans++;const code=container.value;
  if(mode!=='oneScan' && scans%2===1){
   void Promise.all([send('/validateContainer',{warehouseId:'BWU2',scannableId:code}),send('/getTransshipmentBindingSummary',{warehouseId:'BWU2',scannableId:code})]).then(()=>{container.value='';heading.textContent='Ready to bind '+scans;notice.textContent='';});return;
  }
  container.value='';notice.textContent=mode==='notBound'?'Container '+code+' not bound':'Container tsXOTHER successfully bound';
  if(mode==='textOnly'||mode==='notBound')return;
  const body={sourceWarehouseId:'BWU2',destinationWarehouseId:'opaque-AVV2',scannableId:code};
  if(mode==='wrongContainer')body.scannableId='tsXOTHER';
  if(mode==='wrongDestination')body.destinationWarehouseId='opaque-BWU1';
  if(mode==='missingSource')body.sourceWarehouseId='';
  if(mode==='opaqueSource')body.sourceWarehouseId='opaque-native-source';
  if(mode==='changeDestination')h.V3.native.setValue(destination,'BWU1');
  void send('/forceBind',body).catch(()=>{});
  if(mode==='duplicate')void send('/forceBind',body).catch(()=>{});
 });
 const nativeWait=h.V3.native.waitFor;h.V3.native={...h.V3.native,waitFor:(predicate,options)=>nativeWait(predicate,{...options,timeout:Math.min(options.timeout,120)})};
 const life=h.V3.core.lifecycle('hierarchy-test');
 return {...h,life,destination,container,proof:()=>h.V3.hierarchy.validateDestinationNative('AVV2',{life}),counts:()=>({scans,mutations,requests})};
}
// A network proof, not unrelated status text, establishes success.
for(const mode of ['normal','oneScan','opaqueSource']){
 const h=bindFixture({mode});try{
  const context=await h.proof(),result=await h.V3.hierarchy.bindNative('tsX1',context,{life:h.life});
  assert.equal(result.container,'tsX1');assert.equal(result.destination,'AVV2');assert.equal(h.counts().mutations,1);
  assert.equal(h.counts().scans,mode==='oneScan'?1:2);assert.equal(h.V3.state.attention('hierarchy'),null);
 }finally{h.close();}
}
for(const transport of ['xhr','request']){
 const h=bindFixture({transport});try{
  const context=await h.proof();await h.V3.hierarchy.bindNative('tsX1',context,{life:h.life});assert.equal(h.counts().mutations,1);assert.equal(h.V3.state.attention('hierarchy'),null);
 }finally{h.close();}
}
for(const config of [{mode:'textOnly'},{mode:'notBound'},{mode:'wrongContainer'},{mode:'wrongDestination'},{mode:'missingSource'},{mode:'changeDestination'},
 {mode:'duplicate'},{mode:'lost'},{status:500},{mutation:{success:false}},{mutation:{scannableId:'tsXOTHER'}},{mutation:{hostName:''}},{mutation:{hostName:{}}},{mutation:{destinationWarehouseId:'opaque-BWU1'}},
 {url:'https://midway.amazon.com/login'},{type:'text/html'}]){
 const h=bindFixture(config);try{
  const context=await h.proof();await assert.rejects(h.V3.hierarchy.bindNative('tsX1',context,{life:h.life}),error=>error.outcome==='unknown');
  assert.equal(h.V3.state.attention('hierarchy').state,'UNKNOWN');const before=h.counts().scans;
  await assert.rejects(h.V3.hierarchy.bindNative('tsX1',context,{life:h.life}),error=>error.outcome==='unknown');assert.equal(h.counts().scans,before,'UNKNOWN must prevent another scan');
  const reloaded=harness({url:origin+'/bindHierarchy',modules,sharedStorage:h.sharedStorage});try{assert.equal(reloaded.V3.state.attention('hierarchy').state,'UNKNOWN');}finally{reloaded.close();}
 }finally{h.close();}
}
const stale=bindFixture();try{
 const context=await stale.proof();stale.V3.native.setValue(stale.destination,'BWU1');
 await assert.rejects(stale.V3.hierarchy.bindNative('tsX1',context,{life:stale.life}),/fresh native validation/);assert.equal(stale.counts().scans,0);
}finally{stale.close();}
const paused=bindFixture();try{
 const context=await paused.proof();let checks=0;
 await assert.rejects(paused.V3.hierarchy.bindNative('tsX1',context,{life:paused.life,maySubmit:()=>++checks<2}),error=>error.outcome==='cancelled');
 assert.equal(paused.counts().scans,1);assert.equal(paused.counts().mutations,0);assert.equal(paused.V3.state.attention('hierarchy'),null);
}finally{paused.close();}
const long=bindFixture();try{
 const context=await long.proof();for(let i=0;i<15;i++)await long.V3.hierarchy.bindNative('tsX'+i,context,{life:long.life});
 assert.equal(long.counts().mutations,15,'destination proof must survive the bounded traffic buffer');
}finally{long.close();}
// Native queue must stop at an ambiguous first row; it may finish a submitted row after PAUSE.
for(const mode of ['wrongContainer','normal']){
 const h=bindFixture({mode});try{
  h.load('queue-ui.js');h.load('bridge.js');h.load('apps/hierarchy.js');h.V3.boot();h.w.document.querySelector('[data-v3-button="hierarchy"]').click();await tick();
  const root=h.w.document.querySelector('[data-bwu2-v3-panel="hierarchy"]');root.querySelector('[data-dest]').value='AVV2';root.querySelector('[data-input]').value='tsX1\ntsX2';root.querySelector('[data-add]').click();await tick();
  if(mode==='normal')h.container.addEventListener('keydown',()=>{if(h.counts().mutations===1)root.querySelector('[data-pause]').click();});
  await root.querySelector('[data-run]').onclick();const text=root.querySelector('[data-list]').textContent;
  assert.match(text,mode==='normal'?/tsX1.*DONE/:/tsX1.*ATTENTION/);assert.match(text,/tsX2.*QUEUED/);assert.equal(h.counts().mutations,1);
  if(mode==='wrongContainer'){root.querySelector('[data-done]').click();await tick();assert.match(root.querySelector('[data-list]').textContent,/ATTENTION/);await root.querySelector('[data-run]').onclick();assert.equal(h.counts().mutations,1);}
 }finally{h.close();}
}
// Unbind retains V2 request shape and authenticated identity, with conservative mutation outcomes.
for(const scenario of ['ok','paused','badValidation','badSummary','missingLogin','lost','serverError','html','redirect','negative','wrongResponse','badStatus','rejected']){
 const h=harness({url:origin+'/unbindHierarchy',html:'<span class="app-user-name">krislogin</span>',modules});let mutations=0,calls=[];
 h.V3.transport={...h.V3.transport,request:async(url,options)=>{
  const path=new URL(url).pathname,body=JSON.parse(options.body);calls.push({path,body});
  if(path==='/validateContainer')return apiResult({warehouseId:'BWU2',scannableId:scenario==='badValidation'?'tsXOTHER':body.scannableId});
  if(path==='/getTransshipmentBindingSummary')return apiResult(scenario==='badSummary'?{}:{transferBindingSummaryList:[]});
  assert.equal(path,'/unbindContainer');mutations++;assert.deepEqual(body,{sourceWarehouseId:'BWU2',scannableId:'tsX1',employeeLogin:'krislogin'});
  if(scenario==='lost')throw new Error('connection lost');
  return apiResult({hostName:'host',...(scenario==='negative'?{success:false}:{}),...(scenario==='wrongResponse'?{scannableId:'tsXOTHER'}:{})},scenario==='serverError'?500:scenario==='badStatus'?0:scenario==='rejected'?400:200,
   scenario==='html'?{flags:{html:true}}:scenario==='redirect'?{finalUrl:'https://other.amazon.com/unbindContainer'}:{});
 }};
 try{
  const login=scenario==='missingLogin'?'':h.V3.core.identity().login,run=()=>h.V3.hierarchy.unbind('tsX1',login,{maySubmit:()=>scenario!=='paused'});
  if(scenario==='ok'){await run();assert.equal(mutations,1);assert.equal(h.V3.state.attention('hierarchy'),null);}
  else if(['paused','badValidation','badSummary','missingLogin'].includes(scenario)){await assert.rejects(run());assert.equal(mutations,0);}
  else if(scenario==='rejected'){await assert.rejects(run(),error=>error.outcome==='rejected');assert.equal(h.V3.state.attention('hierarchy'),null);}
  else{await assert.rejects(run(),error=>error.outcome==='unknown');assert.equal(h.V3.state.attention('hierarchy').state,'UNKNOWN');await assert.rejects(run(),error=>error.outcome==='unknown');assert.equal(mutations,1);}
 }finally{h.close();}
}
console.log('PASS Hierarchy: native container/destination proof, first-scan mutation, no text confirmation, pause, UNKNOWN/reload, long queues, strict Unbind/identity');
