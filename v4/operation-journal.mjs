import {clean,upper}from'./ui-tools.mjs';
const phases=new Set(['QUEUED','READING','SUBMITTED','CONFIRMED','REJECTED','UNKNOWN']);
export function createOperationJournal({storage,key,normalize=value=>clean(value),uuid=()=>crypto.randomUUID()}){
 let rows=[],draft='';
 const saved=storage.getItem(key);
 if(saved){let parsed;try{parsed=JSON.parse(saved);}catch{throw new Error('Recovery data is corrupt — preserve it before repair');}
   if(parsed.schema!==1||!Array.isArray(parsed.rows))throw new Error('Recovery schema unsupported — no work discarded');
   rows=parsed.rows.map(row=>{if(!row||!normalize(row.container)||!phases.has(row.state)||typeof row.id!=='string')throw new Error('Recovery row invalid — no work discarded');return{...row,state:row.state==='SUBMITTED'?'UNKNOWN':row.state==='READING'?'QUEUED':row.state,message:row.state==='SUBMITTED'?'Reload interrupted submitted operation — verify native result':row.message||''};});draft=typeof parsed.draft==='string'?parsed.draft:'';
 }
 function save(){const json=JSON.stringify({schema:1,rows,draft});storage.setItem(key,json);if(storage.getItem(key)!==json)throw new Error('Recovery storage did not persist — submission blocked');}
 // Recovery is persisted only after acquiring the workflow owner.
 function add(values,details={}){const added=[];for(const value of values){const container=normalize(value);if(!container)throw new Error('Invalid container: '+clean(value));if(rows.some(row=>upper(row.container)===upper(container)&&!['CONFIRMED','REJECTED'].includes(row.state)))continue;const row={...details,id:uuid(),container,state:'QUEUED',message:'Queued'};rows.push(row);added.push(row);}save();return added;}
 function transition(row,state,message='',details={}){if(!phases.has(state)||!rows.includes(row))throw new Error('Invalid operation state');if(row.state==='UNKNOWN'&&state!=='UNKNOWN')throw new Error('UNKNOWN cannot be automatically replayed');if(row.state==='SUBMITTED'&&!['SUBMITTED','CONFIRMED','REJECTED','UNKNOWN'].includes(state))throw new Error('Submitted work cannot become runnable');const old={...row};Object.assign(row,details,{state,message});try{save();}catch(error){Object.assign(row,old);throw error;}return row;}
 function clearKnown(){rows=rows.filter(row=>!['CONFIRMED','REJECTED'].includes(row.state));save();}
 function clearConfirmed(){rows=rows.filter(row=>row.state!=='CONFIRMED');save();}
 function clear(){rows=rows.filter(row=>['SUBMITTED','UNKNOWN'].includes(row.state));draft='';save();}
 return{get rows(){return rows;},get draft(){return draft;},setDraft(value){draft=String(value);save();},add,transition,clear,clearConfirmed,clearKnown,save,next:()=>rows.find(row=>row.state==='QUEUED')};
}
export async function withOperationLock(window,name,work){
 if(typeof window.navigator.locks?.request!=='function')throw new Error('Browser Web Locks unavailable — operation blocked');
 return window.navigator.locks.request(name,{mode:'exclusive',ifAvailable:true},async lock=>{if(!lock)throw new Error('Another V4 tab owns this workflow');return work();});
}
