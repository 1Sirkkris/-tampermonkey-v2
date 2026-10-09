import{createOperationJournal,withOperationLock}from'./operation-journal.mjs';import{clean,upper}from'./ui-tools.mjs';
export const validSidelineContainer=value=>/^(?:csX|tsX)[A-Za-z0-9_-]+$/i.test(clean(value));
export function parseSidelineItems(text,source,destination){const map=new Map();for(const raw of String(text).split(/\r?\n/)){const value=clean(raw),key=upper(value);if(!value||['123START',upper(source),upper(destination)].includes(key))continue;if(validSidelineContainer(value))continue;const row=map.get(key);if(row)row.quantity++;else map.set(key,{code:value,quantity:1});}return[...map.values()];}
export function createSidelineWorkflow({window,client,preflight,pickDate,onChange=()=>{},onEvidence=()=>{}}){
 const key='tm-v4.sideline.rows',uuid=()=>window.crypto.randomUUID();let journal=createOperationJournal({storage:window.localStorage,key,uuid}),running=false,busy=false,owns=false,clearAfterSettled=false,paused=false,disposed=false,active=null,attentionRow=null,readController,wake,scanResolve,attention='',message='',stopStage=0,dates=new Map(),sourceMeta=null;
 const notify=()=>onChange({running,busy,paused,attention,message,rows:journal.rows,stopStage});
 const signal=()=>{readController=new window.AbortController();return readController.signal;};
 function check(){if(disposed||!running||paused)throw new Error('Workflow halted before submission');}
 async function control(){if(!running||disposed)return false;if(!paused)return true;await new Promise(r=>wake=r);wake=null;return running&&!disposed;}
 async function waitScan(kind,row){attentionRow=row;attention=kind;paused=true;message=kind==='predicant'?'RESCAN DESTINATION '+row.destination+' — known rejected move':'DESTINATION DAMAGED — scan a different destination';notify();const dest=await new Promise(r=>scanResolve=r);scanResolve=null;return running&&!disposed?dest:null;}
 function terminal(row,phase,reason){journal.transition(row,phase,reason);onEvidence({type:'sideline.result',intent:'mutation',phase,operationId:row.requestId,data:{kind:row.kind,state:phase}});}
 function submit(row,id){check();journal.transition(row,'SUBMITTED','Submitted — awaiting native result',{requestId:id,attempts:(row.attempts||0)+1});notify();onEvidence({type:'sideline.submit',intent:'mutation',phase:'SUBMITTED',operationId:id,data:{kind:row.kind,state:'SUBMITTED'}});}
 function settle(row,result){journal.transition(row,result.outcome,result.reason||'Confirmed by typed native response');notify();if(result.outcome==='UNKNOWN'){running=false;paused=false;message='UNKNOWN — verify native outcome before any retry';notify();}onEvidence({type:'sideline.result',intent:'mutation',phase:result.outcome,operationId:row.requestId,data:{kind:row.kind,state:result.outcome}});}
 async function close(container,kind){check();const existing=journal.rows.find(r=>upper(r.container)===upper(container)&&['UNKNOWN','SUBMITTED','QUEUED','READING'].includes(r.state));if(existing)throw new Error('Unresolved native close exists for '+container);const row=journal.add([container],{mode:'close',kind,quantity:0})[0];active=row;journal.transition(row,'READING','Validating close source');notify();await client.source(container,{signal:signal()});check();const result=await client.close(container,{signal:readController.signal,beforeMutation:id=>submit(row,id)});settle(row,result);return result;}
 async function move(row,meta,ctx,date){
  while(running&&!disposed){if(!await control())return;journal.transition(row,'READING','Ready to move');active=row;
   const result=await client.move({source:row.source,destination:row.destination,sourceMeta:meta,ctx,quantity:row.quantity,expiration:date},{signal:signal(),beforeMutation:id=>submit(row,id)});settle(row,result);
   if(result.outcome==='UNKNOWN')return;if(result.outcome==='CONFIRMED')return;
   if(!running)return;
   if(result.predicant){
    while(running){const dest=await waitScan('predicant',row);if(!dest)return;attention='recovery';paused=false;notify();let cleared;
     try{cleared=await close(dest,'predicant-close');}catch(error){if(active?.state==='SUBMITTED'){terminal(active,'UNKNOWN',error.message);running=false;message='UNKNOWN close — verify destination; item NOT retried';notify();return;}if(active?.state==='READING')journal.transition(active,'REJECTED',error.message);message='Destination clear failed — rescan deliberately to retry';notify();continue;}
     if(cleared.outcome==='UNKNOWN')return;if(cleared.outcome==='CONFIRMED'){attention='';paused=false;break;}message='Destination clear rejected — rescan deliberately to retry';notify();
    }
    if(!running)return;active=row; // fresh request ID is created by client.move on each permitted retry
    continue;
   }
   if(result.damaged){const dest=await waitScan('damaged',row);if(!dest)return;for(const pending of journal.rows.filter(r=>r.mode==='lazy'&&['QUEUED','READING'].includes(r.state)))journal.transition(pending,pending.state,pending.message,{destination:dest});journal.transition(row,'READING','New destination chosen',{destination:dest});paused=false;attention='';continue;}
   return;
  }
 }
 async function run(mode,options={}){if(busy||disposed)return;busy=true;stopStage=0;message='';
  try{await withOperationLock(window,'tm-v4.sideline.owner',async()=>{owns=true;try{if(stopStage>0||disposed)return;
   journal=createOperationJournal({storage:window.localStorage,key,uuid});if(journal.rows.some(r=>['SUBMITTED','UNKNOWN'].includes(r.state)))throw new Error('UNKNOWN recovery rows require native verification before another run');
   journal.clearKnown();
   if(mode==='lazy'&&(!validSidelineContainer(options.source)||!validSidelineContainer(options.destination)||upper(options.source)===upper(options.destination)))throw new Error('Valid different source and destination required');
   if(mode==='lazy'&&journal.rows.some(r=>r.mode==='lazy'&&r.state==='QUEUED'&&(upper(r.source)!==upper(options.source)||upper(r.destination)!==upper(options.destination))))throw new Error('Saved unsubmitted batch uses another source/destination — Reset explicitly before changing it');
   let list=mode==='queue'?[...new Set((options.containers||[]).filter(validSidelineContainer))].map(code=>({code,quantity:0})):options.items||[];
   if(!list.length&&!journal.rows.some(r=>r.mode===mode&&r.state==='QUEUED'))throw new Error(mode==='queue'?'No containers':'No item barcodes');
   for(const item of list){if(!item.code||!Number.isInteger(item.quantity)||item.quantity<0)throw new Error('Invalid queue item');journal.add([item.code],{mode,kind:mode==='queue'?'queue-close':'move',source:options.source||'',destination:options.destination||'',quantity:item.quantity});}
   running=true;paused=false;attention='';notify();await client.bootstrap({signal:signal()});if(!await control())return;
   if(mode==='lazy'){sourceMeta=await client.source(options.source,{signal:signal()});if(!await control())return;}
   while(running&&!disposed){
    if(!await control())break;const row=journal.rows.find(r=>r.mode===mode&&r.state==='QUEUED');if(!row)break;active=row;journal.transition(row,'READING','Preflight');notify();
    try{if(mode==='queue'){await client.source(row.container,{signal:signal()});if(!await control())break;const result=await client.close(row.container,{signal:readController.signal,beforeMutation:id=>submit(row,id)});settle(row,result);}
     else{const result=await preflight(row.source,row.container,{signal:signal()});if(!await control())break;
      if(result.kind==='red'){journal.transition(row,'REJECTED','ASIDE • '+result.reason);notify();continue;}if(result.kind==='retry'||!result.ctx)throw new Error(result.reason||'Preflight failed');
      let date=dates.get(upper(row.container))??null;if(result.kind==='yellow'&&date===null){attention='date';notify();date=await pickDate({code:row.container,ctx:result.ctx,signal:readController.signal});if(date===null||!running){journal.transition(row,'QUEUED','Date cancelled — not submitted');if(paused)continue;running=false;break;}dates.set(upper(row.container),date);attention='';}
      if(!await control())break;await move(row,sourceMeta,result.ctx,date);
      if(running&&row.state==='CONFIRMED'&&options.delay){const ms=2000+window.crypto.getRandomValues(new Uint32Array(1))[0]%6001;message='Delay '+Math.ceil(ms/1000)+'s';notify();await new Promise(resolve=>{const timer=window.setTimeout(resolve,ms);readController=new window.AbortController();readController.signal.addEventListener('abort',()=>{window.clearTimeout(timer);resolve();},{once:true});});}
     }
    }catch(error){const target=active||row;if(target.state==='SUBMITTED'){terminal(target,error.outcome==='REJECTED'?'REJECTED':'UNKNOWN',error.message);if(target.state==='UNKNOWN'){running=false;message='UNKNOWN — verify before retry';}}else if(target.state==='READING'){if(!running||paused){journal.transition(target,'QUEUED','Stopped before submission');}else journal.transition(target,'REJECTED',error.message);}notify();}
   }
   if(running&&mode==='lazy'&&options.clearSource){const batch=journal.rows.filter(r=>r.mode==='lazy'&&r.source===options.source);if(batch.length&&batch.every(r=>r.state==='CONFIRMED')){try{await close(options.source,'source-clear');}catch(error){if(active?.state==='SUBMITTED')terminal(active,'UNKNOWN',error.message);else if(active?.state==='READING')journal.transition(active,'REJECTED',error.message);message=error.message;}}else message='Source retained: some items were not confirmed';}
  }finally{try{if(clearAfterSettled){journal.clear();clearAfterSettled=false;}}finally{owns=false;}}});}catch(error){message=error.message;}finally{if(active?.state==='READING')try{journal.transition(active,'QUEUED','Stopped before submission');}catch{}running=false;busy=false;paused=false;attention='';active=null;readController=null;dates.clear();notify();}
 }
 function scan(code){const value=clean(code);if(attention==='predicant'){if(upper(value)===upper(attentionRow?.destination)&&scanResolve){const resolve=scanResolve;scanResolve=null;resolve(value);return true;}return validSidelineContainer(value);}if(attention==='damaged'){if(validSidelineContainer(value)&&upper(value)!==upper(attentionRow?.source)&&upper(value)!==upper(attentionRow?.destination)&&scanResolve){const resolve=scanResolve;scanResolve=null;resolve(value);return true;}return validSidelineContainer(value);}return false;}
 function pause(){if(!running||attention==='predicant'||attention==='damaged'||attention==='recovery')return;paused=!paused;if(paused&&active?.state!=='SUBMITTED')readController?.abort();if(!paused)wake?.();notify();}
 function stop(){
  stopStage++;
  if(running){running=false;paused=false;attention='';if(active?.state!=='SUBMITTED')readController?.abort();wake?.();scanResolve?.(null);message='Stopped — submitted request settles; recovery rows retained';notify();return;}
  if(stopStage>=2){
   if(owns){if(active?.state==='READING')clearAfterSettled=true;else try{journal.clear();}catch(error){message=error.message;notify();return;}dates.clear();message='Reset safe rows; submitted/UNKNOWN retained';notify();return;}
   if(busy){message='Stopped before ownership; recovery retained';notify();return;}
   return reset();
  }
 }
 async function reset(){
  if(busy){stop();return false;}
  try{await withOperationLock(window,'tm-v4.sideline.owner',()=>{journal=createOperationJournal({storage:window.localStorage,key,uuid});journal.clear();dates.clear();stopStage=0;message='Reset — UNKNOWN retained';});notify();return true;}
  catch(error){message=error.message;notify();return false;}
 }
 function dispose(){if(disposed)return;disposed=true;running=false;paused=false;try{if(active?.state==='SUBMITTED')terminal(active,'UNKNOWN','Page disposed after submission');else if(active?.state==='READING')journal.transition(active,'QUEUED','Page disposed before submission');}catch{}readController?.abort();wake?.();scanResolve?.(null);}
 return{run,scan,pause,stop,reset,dispose,getRows:()=>journal.rows,getState:()=>({running,busy,paused,attention,message,stopStage}),setDate:(code,value)=>dates.set(upper(code),value)};
}
