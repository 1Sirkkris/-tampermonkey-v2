import{clean,upper}from'./ui-tools.mjs';import{NativeRequestError,createNativeJson}from'./native-json.mjs';import{createOperationJournal,withOperationLock}from'./operation-journal.mjs';import{normalizeHierarchyContainer}from'./hierarchy-runtime.mjs';import{resolveIdentity}from'./identity.mjs';import{validateHierarchy,validateSummary,validateHierarchyAcknowledgement}from'./hierarchy-driver.mjs';
const endpoints=new Set(['/validateDestination','/validateContainer','/getTransshipmentBindingSummary','/forceBind','/unbindContainer']);
export function createHierarchyNative({window,page=window,onMutation=()=>{},onTemplate=()=>{},identity=()=>resolveIdentity(window,page),onChange=()=>{},onEvidence=()=>{}}){
 let sequence=0,records=[],waiters=new Set(),disposed=false,seed=null;const details=new WeakMap(),tasks=new Set();
 function begin(url,body){let path,payload;try{const target=new window.URL(url,window.location.href);if(target.origin!==window.location.origin||!endpoints.has(target.pathname))return;path=target.pathname;}catch{return;}try{payload=typeof body==='string'?JSON.parse(body):null;}catch{payload=null;}
  const record={seq:++sequence,path,request:payload};
  if(path==='/forceBind'&&seed){if(!seed.allow||upper(payload?.scannableId)!==upper(seed.container)||payload?.destinationWarehouseId!==seed.destination)throw new Error('V4 blocked unexpected native Bind submission');seed.beforeMutation();onMutation(record);}
  return record;
 }
 function finish(record,status,raw,finalUrl=''){if(!record||disposed)return;let data;try{data=JSON.parse(raw);}catch{data=raw;}
  let redirected=false;try{redirected=!!finalUrl&&new window.URL(finalUrl,window.location.href).pathname!==record.path;}catch{redirected=true;}
  const entry={...record,status,data,redirected};records.push(entry);records=records.slice(-40);for(const waiter of [...waiters])waiter.check(entry);
  if(record.path==='/forceBind'&&status===200&&!redirected&&typeof data?.hostName==='string'&&data.hostName&&record.request?.sourceWarehouseId&&record.request?.destinationWarehouseId){try{validateHierarchyAcknowledgement(data);}catch{return;}onTemplate({sourceWarehouseId:record.request.sourceWarehouseId,destinationWarehouseId:record.request.destinationWarehouseId});}
 }
 const originalFetch=page.fetch;
 const mutation=record=>record?.path==='/forceBind'||record?.path==='/unbindContainer';
 async function guard(record,sendNative,responseInfo,signal){
  const controller=new window.AbortController(),task={controller,journal:null,row:null};tasks.add(task);
  const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});
  let native;
  try{return await withOperationLock(window,'tm-v4.hierarchy.owner',async()=>{try{
   if(disposed||signal?.aborted||controller.signal.aborted)throw new Error('Native hierarchy cancelled before submission');
   const payload=record.request,container=normalizeHierarchyContainer(payload?.scannableId),mode=record.path==='/forceBind'?'bind':'unbind';
   if(!payload||!container||typeof payload.sourceWarehouseId!=='string'||!clean(payload.sourceWarehouseId)||typeof payload.employeeLogin!=='string'||!clean(payload.employeeLogin)||mode==='bind'&&(typeof payload.destinationWarehouseId!=='string'||!clean(payload.destinationWarehouseId)))throw new Error('Native hierarchy payload/context is unsupported — no request sent');
   if(payload.employeeLogin!==identity().login)throw new Error('Native hierarchy employee identity disagrees with authenticated user');
   const journal=createOperationJournal({storage:window.localStorage,key:'tm-v4.hierarchy.rows',normalize:normalizeHierarchyContainer,uuid:()=>window.crypto.randomUUID()});task.journal=journal;
   if(journal.rows.some(row=>upper(row.container)===upper(container)&&!['CONFIRMED','REJECTED'].includes(row.state)))throw new Error('Native hierarchy has unresolved or queued ownership for this container');
   const row=journal.add([container],{mode,kind:'native-hierarchy'})[0];task.row=row;
   journal.transition(row,'SUBMITTED','Native hierarchy submitted — result pending',{operationId:row.id});onChange('SUBMITTED • native '+container,journal);
   onEvidence({type:'hierarchy.operation',intent:'mutation',operationId:row.id,phase:'SUBMITTED',data:{mode,kind:'native-hierarchy'}});
   const request=createNativeJson({window,fetch:async(_url,options)=>{native=await sendNative(options.signal);return responseInfo(native);}});
   let interrupted;const cancelled=new Promise((_,reject)=>{interrupted=()=>reject(new NativeRequestError('Native hierarchy cancelled after submission',{outcome:'UNKNOWN'}));controller.signal.addEventListener('abort',interrupted,{once:true});});
   try{const result=await Promise.race([request(record.path,payload,{signal:controller.signal,mutation:true}),cancelled]);validateHierarchyAcknowledgement(result.data);
    if(disposed||row.state==='UNKNOWN')throw new NativeRequestError('Native hierarchy disposed after submission',{outcome:'UNKNOWN'});
    journal.transition(row,'CONFIRMED','Native hierarchy positively acknowledged');onChange('CONFIRMED • native '+container,journal);onEvidence({type:'hierarchy.operation',intent:'mutation',operationId:row.id,phase:'CONFIRMED',data:{mode,kind:'native-hierarchy'}});
   }finally{controller.signal.removeEventListener('abort',interrupted);}
   return native;
  }catch(error){if(!task.row)throw error;
   const row=task.row,outcome=row&&(row.state==='SUBMITTED'||row.state==='UNKNOWN')?(error.outcome==='REJECTED'&&row.state!=='UNKNOWN'?'REJECTED':'UNKNOWN'):'REJECTED';
   if(row&&row.state!=='UNKNOWN'){try{task.journal.transition(row,outcome,error.message);}catch{}onEvidence({type:'hierarchy.operation',intent:'mutation',operationId:row.operationId,phase:outcome,data:{mode:row.mode,kind:'native-hierarchy'}});}
   onChange(outcome+' • native hierarchy • '+error.message,task.journal);
   // Preserve native HTTP/error responses; only blocked or lost requests reject.
   if(native&&!disposed&&!controller.signal.aborted)return native;throw error;
  }});}catch(error){if(!task.row)onChange('REJECTED • native hierarchy • '+error.message);throw error;}finally{signal?.removeEventListener('abort',cancel);tasks.delete(task);}
 }
 function observe(record,promise){if(record)void promise.then(async response=>{try{finish(record,response.status,await response.clone().text(),response.url);}catch{finish(record,0,'');}},()=>finish(record,0,''));return promise;}
 const wrappedFetch=function(input,init={}){
  const url=typeof input==='string'||input instanceof window.URL?String(input):input?.url,method=init.method||input?.method||'GET';
  const record=String(method).toUpperCase()==='POST'?begin(url,init.body):null;
  if(!record)return originalFetch.apply(this,arguments);
  if(mutation(record)&&!(seed&&record.path==='/forceBind')){const receiver=this;return observe(record,guard(record,nativeSignal=>originalFetch.call(receiver,input,{...init,signal:nativeSignal}),response=>response.clone(),init.signal||input?.signal));}
  return observe(record,originalFetch.apply(this,arguments));
 };page.fetch=wrappedFetch;
 const prototype=page.XMLHttpRequest?.prototype,originalOpen=prototype?.open,originalSend=prototype?.send,originalAbort=prototype?.abort;
 function open(method,url,async=true){details.get(this)?.controller?.abort();details.set(this,{url,method,async,controller:null});return originalOpen.apply(this,arguments);}
 function send(body){
  const detail=details.get(this),record=detail?.method?.toUpperCase()==='POST'?begin(detail.url,body):null;
  if(!record)return originalSend.apply(this,arguments);
  const xhr=this;const info=response=>({ok:response.status>=200&&response.status<300,status:response.status,url:response.responseURL,redirected:false,headers:{get:name=>response.getResponseHeader?.(name)||''},text:async()=>response.responseType==='json'?JSON.stringify(response.response):response.responseText||''});
  if(mutation(record)&&!(seed&&record.path==='/forceBind')){
   if(detail.async===false)throw new Error('Synchronous native hierarchy cannot acquire ownership — request blocked');
   detail.controller=new window.AbortController();
   void guard(record,nativeSignal=>new Promise((resolve,reject)=>{
    const abortNative=()=>originalAbort.call(xhr);nativeSignal.addEventListener('abort',abortNative,{once:true});
    const complete=()=>{nativeSignal.removeEventListener('abort',abortNative);resolve(xhr);};xhr.addEventListener('loadend',complete,{once:true});
    try{originalSend.call(xhr,body);}catch(error){xhr.removeEventListener('loadend',complete);nativeSignal.removeEventListener('abort',abortNative);reject(error);}
   }),info,detail.controller.signal).then(async response=>finish(record,response.status,await info(response).text(),response.responseURL),()=>{finish(record,0,'');if(details.get(xhr)===detail&&xhr.readyState===1){xhr.dispatchEvent(new window.ProgressEvent('error'));xhr.dispatchEvent(new window.ProgressEvent('loadend'));}});return undefined;
  }
  xhr.addEventListener('loadend',()=>{let raw='';try{raw=xhr.responseType==='json'?JSON.stringify(xhr.response):xhr.responseText;}catch{}finish(record,xhr.status,raw,xhr.responseURL);},{once:true});return originalSend.apply(this,arguments);
 }
 function abort(){details.get(this)?.controller?.abort();return originalAbort.apply(this,arguments);}
 if(prototype){prototype.open=open;prototype.send=send;prototype.abort=abort;}
 function wait(path,after,predicate,signal){const promise=new Promise((resolve,reject)=>{if(signal?.aborted){reject(new NativeRequestError('Native scan cancelled'));return;}let timer;const cancel=()=>done(new NativeRequestError('Native scan cancelled'));function done(error,entry){window.clearTimeout(timer);signal?.removeEventListener('abort',cancel);waiters.delete(job);error?reject(error):resolve(entry);}const job={check(entry){if(entry.seq>after&&entry.path===path&&predicate(entry)){if(entry.status!==200||entry.redirected){done(new NativeRequestError('Native scan response unverified',{outcome:path==='/forceBind'?'UNKNOWN':'REJECTED'}));return;}done(null,entry);}},cancel};waiters.add(job);signal?.addEventListener('abort',cancel,{once:true});timer=window.setTimeout(()=>done(new NativeRequestError('Native scan response timed out',{outcome:path==='/forceBind'?'UNKNOWN':'REJECTED'})),25000);for(const entry of records)job.check(entry);});void promise.catch(()=>{});return promise;}
 function key(target,type,value){const event=new window.KeyboardEvent(type,{key:value,code:value==='Enter'?'Enter':'',bubbles:true,cancelable:true,shiftKey:/^[A-Z]$/.test(value)});const number=value==='Enter'?13:type==='keypress'?value.charCodeAt(0):value.toUpperCase().charCodeAt(0);for(const property of ['keyCode','which','charCode'])Object.defineProperty(event,property,{get:()=>number});target.dispatchEvent(event);}
 function fields(kind){return[...window.document.querySelectorAll('input[type=text],input:not([type]),textarea,[role=combobox]')].filter(node=>!node.closest('[data-tm-v4-script]')&&!node.hidden&&window.getComputedStyle(node).display!=='none').map(node=>{const descriptor=[node.id,node.name,node.placeholder,node.getAttribute('aria-label'),node.closest('label')?.textContent,node.id?[...window.document.querySelectorAll('label')].find(label=>label.htmlFor===node.id)?.textContent:''].join(' ').toLowerCase();return{node,descriptor};}).filter(row=>kind==='destination'?/destination/.test(row.descriptor):/container|scannable|scan|tote/.test(row.descriptor)&&!/destination/.test(row.descriptor));}
 async function scanner(value,kind,signal){const candidates=fields(kind);if(candidates.length>1)throw new NativeRequestError('Native '+kind+' fields are ambiguous');const field=candidates[0]?.node;
  if(field){const prototype=field.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(field,value);field.dispatchEvent(new window.Event('input',{bubbles:true}));field.dispatchEvent(new window.Event('change',{bubbles:true}));field.focus();for(const type of ['keydown','keypress','keyup'])key(field,type,'Enter');return;}
  if(kind==='destination')throw new NativeRequestError('Native BWU1 destination field unavailable');
  const body=window.document.body;for(const char of value){if(signal.aborted)throw new NativeRequestError('Native scan cancelled');for(const type of ['keydown','keypress','keyup'])key(body,type,char);await new Promise(resolve=>window.setTimeout(resolve,2));}for(const type of ['keydown','keypress','keyup'])key(body,type,'Enter');
 }
 async function seedBind(row,{signal,beforeMutation,checkRunning,onPhase}){
  seed={container:row.container,beforeMutation,allow:false,destination:''};
  try{
   onPhase('destination');let mark=sequence;const destination=wait('/validateDestination',mark,record=>upper(record.data)==='BWU1',signal);await scanner('BWU1','destination',signal);const dest=await destination;seed.destination=clean(dest.request?.destinationWarehouseId);if(!seed.destination)throw new NativeRequestError('Native destination token not captured');
   onPhase('native-validate');mark=sequence;const match=record=>upper(record.request?.scannableId)===upper(row.container);const valid=wait('/validateContainer',mark,match,signal),summary=wait('/getTransshipmentBindingSummary',mark,match,signal);await scanner(row.container,'container',signal);const[v,s]=await Promise.all([valid,summary]);validateHierarchy(v.data,row.container);validateSummary(s.data);checkRunning();
   onPhase('native-bind');seed.allow=true;mark=sequence;const bound=wait('/forceBind',mark,match,signal);await scanner(row.container,'container',signal);const result=await bound;validateHierarchyAcknowledgement(result.data);if(result.request?.destinationWarehouseId!==seed.destination||!result.request.sourceWarehouseId)throw new NativeRequestError('Native Bind destination/source tokens unverified',{outcome:'UNKNOWN'});return result;
  }finally{seed=null;}
 }
 return{seedBind,fetch:originalFetch.bind(page),dispose(){if(disposed)return;disposed=true;for(const task of tasks){try{if(task.row?.state==='SUBMITTED'){task.journal.transition(task.row,'UNKNOWN','Native hierarchy disposed after submission');onEvidence({type:'hierarchy.operation',intent:'mutation',operationId:task.row.operationId,phase:'UNKNOWN',data:{mode:task.row.mode,kind:'native-hierarchy'}});}}catch{}task.controller.abort();}for(const job of [...waiters])job.cancel();if(page.fetch===wrappedFetch)page.fetch=originalFetch;if(prototype?.open===open)prototype.open=originalOpen;if(prototype?.send===send)prototype.send=originalSend;if(prototype?.abort===abort)prototype.abort=originalAbort;}};
}
