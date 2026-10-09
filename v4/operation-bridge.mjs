import {createOperationJournal,withOperationLock} from './operation-journal.mjs';
import {clean,upper} from './ui-tools.mjs';
const FCR=/^(?:fcresearch-fe\.aka\.amazon\.com|qi-fcresearch-(?:fe|jp)\.corp\.amazon\.com|qifcr\.fe\.aftx\.amazonoperations\.app)$/;
export function workerContext(window){
 const nonce=/^#tm-v4-worker=([a-f0-9-]{20,80})$/.exec(window.location.hash)?.[1];
 let parentOrigin;try{parentOrigin=new window.URL(window.location.href).searchParams.get('tmV4ParentOrigin');const url=new window.URL(parentOrigin);if(!FCR.test(url.hostname)||!/^https?:$/.test(url.protocol)||url.origin!==parentOrigin)return null;}catch{return null;}
 return nonce&&window.parent!==window?{nonce,parentOrigin}:null;
}
// Each installer bundles its own worker. Browser ownership and the durable ledger live
// on the native operation origin, shared with its native queue, rather than on FCR.
export function serveOperationBridge({window,mode,driver,identity,onEvidence=()=>{}}){
 const context=workerContext(window);if(!context)return null;
 const controller=new window.AbortController();let disposed=false,busy=false,journal,row;
 const lockName=mode==='move'?'tm-v4.move-container.owner':'tm-v4.hierarchy.owner';
 const key=mode==='move'?'tm-v4.drop.rows':'tm-v4.hierarchy.rows';
 const reply=(type,data={})=>{if(!disposed)window.parent.postMessage({protocol:'tm-v4.operation',nonce:context.nonce,type,...data},context.parentOrigin);};
 const handle=async event=>{
  const data=event.data;if(event.source!==window.parent||event.origin!==context.parentOrigin||data?.protocol!=='tm-v4.operation'||data.nonce!==context.nonce)return;
  if(data.type==='hello'){reply('ready');return;}
  if(data.type!=='run'||busy||disposed)return;busy=true;
  try{await withOperationLock(window,lockName,async()=>{
   const input=data.row;if(!input||typeof input.id!=='string'||!/^(?:tsX|csX)[A-Z0-9_-]+$/i.test(clean(input.container)))throw new Error('Invalid operation request');
   identity();journal=createOperationJournal({storage:window.localStorage,key,uuid:()=>window.crypto.randomUUID()});
   if(journal.rows.some(r=>r.requestId===input.id||upper(r.container)===upper(input.container)&&['SUBMITTED','UNKNOWN','QUEUED','READING'].includes(r.state)))throw new Error('Native recovery ledger already owns this container — verify unresolved work');
   row=journal.add([input.container],{mode:mode==='move'?'drop':'unbind',destination:clean(input.destination),requestId:input.id})[0];
   journal.transition(row,'READING','Native preflight');
   const result=await driver(row,{mode:'unbind',signal:controller.signal,checkRunning:()=>{if(disposed||controller.signal.aborted)throw new Error('Native preflight cancelled');},beforeMutation:()=>{if(disposed||controller.signal.aborted)throw new Error('Native preflight cancelled');identity();journal.transition(row,'SUBMITTED','Submitted — native outcome pending',{operationId:row.id});onEvidence({type:'operation',intent:'mutation',phase:'SUBMITTED',operationId:row.id,data:{mode}});reply('submitted');},onPhase:phase=>reply('phase',{phase})});
   journal.transition(row,'CONFIRMED','Native result confirmed');onEvidence({type:'operation',intent:'mutation',phase:'CONFIRMED',operationId:row.id,data:{mode}});reply('result',{outcome:'CONFIRMED',verifiedBy:result?.verifiedBy||'native-hierarchy-acknowledgement'});
  });}catch(error){
   let outcome=row?.state==='SUBMITTED'||row?.state==='UNKNOWN'?'UNKNOWN':'REJECTED';if(row?.state==='SUBMITTED'&&error.outcome==='REJECTED')outcome='REJECTED';
   try{if(row)journal.transition(row,outcome,error.message);}catch{outcome='UNKNOWN';}
   if(row?.operationId)onEvidence({type:'operation',intent:'mutation',phase:outcome,operationId:row.operationId,data:{mode}});reply('result',{outcome,message:clean(error.message)});
  }finally{onEvidence({type:'operation.worker',intent:'workflow',data:{mode,state:row?.state||'blocked'}});}
 };
 window.addEventListener('message',handle);reply('ready');
 const dispose=()=>{if(disposed)return;disposed=true;try{if(row?.state==='SUBMITTED'){journal.transition(row,'UNKNOWN','Native worker disposed after submission');onEvidence({type:'operation',intent:'mutation',phase:'UNKNOWN',operationId:row.operationId,data:{mode}});}else if(row?.state==='READING')journal.transition(row,'REJECTED','Native preflight disposed');}catch{}controller.abort();window.removeEventListener('message',handle);};
 window.addEventListener('pagehide',dispose,{once:true});return dispose;
}
export function createOperationBridge({window,timeoutMs=120000,readyMs=25000}){
 return (row,{mode,signal,beforeMutation,onPhase=()=>{},checkRunning=()=>{}})=>new Promise((resolve,reject)=>{
  const origin=mode==='move'?'https://aft-moveapp-nrt-nrt.nrt.proxy.amazon.com':'https://tx-b-hierarchy-nrt.nrt.proxy.amazon.com';
  const nonce=window.crypto.randomUUID(),url=new window.URL(mode==='move'?'/move-container':'/unbindHierarchy',origin);
  url.searchParams.set('tmV4ParentOrigin',window.location.origin);url.hash='tm-v4-worker='+nonce;
  const frame=window.document.createElement('iframe');frame.hidden=true;frame.dataset.tmV4Script='STOW';let sent=false,done=false,timer;
  function finish(error,result){if(done)return;done=true;window.clearTimeout(timer);window.removeEventListener('message',message);signal?.removeEventListener('abort',cancel);frame.remove();error?reject(error):resolve(result);}
  const fail=(message,outcome)=>Object.assign(new Error(message),{outcome});
  const cancel=()=>finish(fail(sent?'Native operation outcome unknown after disposal':'Native preflight cancelled',sent?'UNKNOWN':'REJECTED'));
  const message=event=>{
   const data=event.data;if(event.source!==frame.contentWindow||event.origin!==origin||data?.protocol!=='tm-v4.operation'||data.nonce!==nonce)return;
   if(data.type==='ready'&&!sent){try{checkRunning();beforeMutation();sent=true;window.clearTimeout(timer);timer=window.setTimeout(()=>finish(fail('Native worker outcome timed out — verify before retry','UNKNOWN')),timeoutMs);frame.contentWindow.postMessage({protocol:'tm-v4.operation',nonce,type:'run',row:{id:row.id,container:row.container,destination:row.destination}},origin);}catch(error){finish(error);}return;}
   if(!sent)return;if(data.type==='phase')onPhase(data.phase);else if(data.type==='submitted')onPhase('SUBMITTED');else if(data.type==='result'){
    if(data.outcome==='CONFIRMED')finish(null,{verifiedBy:data.verifiedBy});else finish(fail(clean(data.message)||'Native outcome requires review',data.outcome==='REJECTED'?'REJECTED':'UNKNOWN'));
   }
  };
  window.addEventListener('message',message);signal?.addEventListener('abort',cancel,{once:true});timer=window.setTimeout(()=>finish(fail('Authenticated native worker unavailable — no operation sent','REJECTED')),readyMs);
  frame.addEventListener('load',()=>{if(!done)frame.contentWindow?.postMessage({protocol:'tm-v4.operation',nonce,type:'hello'},origin);});frame.src=url.href;window.document.body.append(frame);if(signal?.aborted)cancel();
 });
}
