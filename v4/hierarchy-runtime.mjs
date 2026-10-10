import{clean,upper,escapeHtml as esc}from'./ui-tools.mjs';import{createOperationJournal,withOperationLock}from'./operation-journal.mjs';
export function normalizeHierarchyContainer(value){const raw=clean(value);if(!/^(?:tsx|csx)[A-Za-z0-9_-]+$/i.test(raw))return'';return(/^tsx/i.test(raw)?'tsX':'csX')+raw.slice(3);}
export function createHierarchyQueue({window,mode,driver,identity,version,onEvidence=()=>{},storage=window.localStorage}){
 const d=window.document,key='tm-v4.hierarchy.rows',lock='tm-v4.hierarchy.owner',prefix='tm-v4.hierarchy.'+mode+'.';let journal,processing=false,running=false,disposed=false,controller=null,currentRow=null,owned=false,runPromise=null,generation=0;
 const uuid=()=>window.crypto.randomUUID?.()||[...window.crypto.getRandomValues(new Uint32Array(4))].join('-');
 const load=()=>{journal=createOperationJournal({storage,key,normalize:normalizeHierarchyContainer,uuid});};
 const root=d.createElement('aside');root.id='tm-v4-hierarchy';root.dataset.tmV4Script=mode==='bind'?'BIND':'UNBD';
 const style=d.createElement('style');style.dataset.tmV4Style=root.dataset.tmV4Script;style.textContent=`#tm-v4-hierarchy{position:fixed;right:12px;top:12px;width:400px;max-width:calc(100vw - 24px);z-index:999990;border:2px solid #123455;border-radius:9px;background:#fff;box-shadow:0 4px 20px #0004;color:#172033;font:13px Arial,sans-serif}#tm-v4-hierarchy header{display:flex;align-items:center;gap:8px;background:#123455;color:white;padding:9px;font-weight:bold}#tm-v4-hierarchy header strong{flex:1}#tm-v4-hierarchy .body{padding:10px}#tm-v4-hierarchy textarea{width:100%;height:115px;resize:vertical;box-sizing:border-box;font:16px monospace;padding:7px}#tm-v4-hierarchy button{cursor:pointer;border:1px solid #9aaec5;border-radius:5px;padding:6px 10px;background:#edf4fc;color:#123455;font-weight:bold}#tm-v4-hierarchy .controls{display:flex;gap:5px;margin:8px 0;flex-wrap:wrap}#tm-v4-hierarchy [data-action=start]{background:#176a3a;color:white}#tm-v4-hierarchy [data-action=pause]{background:#f5aa25;color:#111}#tm-v4-hierarchy .rows{max-height:40vh;overflow:auto}#tm-v4-hierarchy table{width:100%;border-collapse:collapse}#tm-v4-hierarchy td{padding:5px;border-bottom:1px solid #d5dfe9;word-break:break-word}#tm-v4-hierarchy tr[data-state=CONFIRMED]{background:#d4f8d7}#tm-v4-hierarchy tr[data-state=UNKNOWN],#tm-v4-hierarchy tr[data-state=SUBMITTED]{background:#ffe08c}#tm-v4-hierarchy tr[data-state=REJECTED]{background:#ffe1e1}#tm-v4-hierarchy[data-minimized=true] .body{display:none}#tm-v4-hierarchy[hidden]{display:none}`;
 root.innerHTML=`<header><strong>${mode==='bind'?'Bind → BWU1':'Unbind'} Queue • V4 ${esc(version)}</strong><button data-action="minimize">−</button><button data-action="hide">Hide</button></header><div class="body"><div data-identity></div><textarea placeholder="Scan / paste tsX or csX containers"></textarea><div class="controls"><button data-action="add">ADD</button><button data-action="start">START</button><button data-action="pause">PAUSE</button><button data-action="clear">CLEAR</button></div><div role="status">Ready</div><div data-counts></div><div class="rows"><table><tbody></tbody></table></div></div>`;
 const mini=d.createElement('button');mini.type='button';mini.dataset.tmV4Script=root.dataset.tmV4Script;mini.textContent='Show '+mode+' queue';mini.style.cssText='position:fixed;right:12px;top:12px;z-index:999990';mini.hidden=true;
 const input=root.querySelector('textarea'),status=text=>{root.querySelector('[role=status]').textContent=text;};const listeners=new window.AbortController();
 function render(){if(disposed||!journal)return;root.querySelector('[data-counts]').textContent=`${journal.rows.filter(row=>row.state==='QUEUED'&&row.mode===mode).length} queued • ${journal.rows.filter(row=>row.state==='CONFIRMED').length} done • ${journal.rows.filter(row=>['UNKNOWN','SUBMITTED'].includes(row.state)).length} unresolved`;
  root.querySelector('tbody').innerHTML=journal.rows.map(row=>`<tr data-state="${row.state}"><td><b>${esc(row.container)}</b><br>${esc(row.mode||mode)}</td><td>${row.state}<br>${esc(row.message)}</td></tr>`).join('');root.querySelector('[data-action=start]').disabled=processing;
  try{root.querySelector('[data-identity]').textContent='AUTO ID: '+identity().login;}catch(error){root.querySelector('[data-identity]').textContent=error.message;}
 }
 function transition(row,state,message,extra={}){journal.transition(row,state,message,extra);render();if(['SUBMITTED','CONFIRMED','REJECTED','UNKNOWN'].includes(state))onEvidence({type:'hierarchy.operation',intent:'mutation',phase:state,operationId:row.operationId,data:{mode,stage:row.phase||mode,outcome:state}});}
 async function edit(work){if(disposed)throw new Error('Queue disposed before edit');if(owned)return work();return withOperationLock(window,lock,async()=>{if(disposed)throw new Error('Queue disposed before edit');load();return work();});}
 async function add(text=input.value){const captured=String(text),values=captured.split(/[\s,;]+/).filter(Boolean);if(!values.length)return;await edit(()=>journal.add(values,{mode}));if(input.value===captured)input.value='';else if(captured&&input.value.startsWith(captured))input.value=input.value.slice(captured.length).replace(/^[\s,;]+/,'');window.sessionStorage.setItem(prefix+'draft',input.value);status('Queued '+values.length+' containers');render();input.focus();}
 function pause(){generation++;running=false;status(currentRow?.state==='SUBMITTED'?'PAUSED — waiting for submitted result':'Paused safely');if(currentRow&&currentRow.state==='READING')controller?.abort();render();}
 function start(){
  if(processing||disposed)return Promise.resolve();
  const run=++generation;processing=true;render();
  // The tracked run includes Add and both asynchronous ownership acquisitions.
  runPromise=(async()=>{
   try{
    await add();if(disposed||run!==generation)return;running=true;
    await withOperationLock(window,lock,async()=>{
     if(disposed||!running||run!==generation)return;
     owned=true;load();journal.save();identity();
     while(running&&!disposed&&run===generation){
      const row=journal.rows.find(row=>row.mode===mode&&row.state==='QUEUED');if(!row)break;
      currentRow=row;controller=new window.AbortController();transition(row,'READING','Validating native session');let submitted=false;
      try{
       await driver(row,{mode,signal:controller.signal,
        checkRunning:()=>{if(!running||disposed||run!==generation)throw new Error('Paused before mutation');},
        onPhase:phase=>{if(disposed)return;row.phase=phase;row.message='Processing '+phase;journal.save();render();},
        beforeMutation:()=>{if(!running||disposed||run!==generation)throw new Error('Paused before mutation');identity();if(submitted)throw new Error('Duplicate submission blocked');row.operationId=uuid();transition(row,'SUBMITTED','Submitted — waiting for native acknowledgement');submitted=true;}});
       if(disposed)break;transition(row,'CONFIRMED','Native hierarchy acknowledged');status('DONE '+row.container+' — scan next');
      }catch(error){
       if(disposed)break;const state=submitted?(error.outcome==='REJECTED'?'REJECTED':'UNKNOWN'):!running||controller.signal.aborted?'QUEUED':'REJECTED';
       transition(row,state,error.message);status(error.message);running=false;
      }finally{currentRow=null;controller=null;}
     }
    });
   }catch(error){status(error.message);}
   finally{owned=false;running=false;processing=false;runPromise=null;render();if(!disposed)input.focus();}
  })();return runPromise;
 }
 async function clear(){pause();if(runPromise)await runPromise;try{await edit(()=>journal.clear());input.value='';window.sessionStorage.setItem(prefix+'draft','');status(journal.rows.length?'Unresolved submissions retained — verify native result':'Cleared — next batch');render();}catch(error){status(error.message);}}
 input.addEventListener('input',()=>window.sessionStorage.setItem(prefix+'draft',input.value),{signal:listeners.signal});
 input.addEventListener('keydown',event=>{if(event.key!=='Enter')return;const lines=input.value.split(/\r?\n/),last=clean(lines.at(-1));if(upper(last)==='123START'){event.preventDefault();lines.pop();input.value=lines.join('\n');void start();return;}if(running&&last){event.preventDefault();void add().catch(error=>status(error.message));}},{signal:listeners.signal});
 root.addEventListener('click',event=>{const action=event.target.closest('button')?.dataset.action;if(action==='add')void add().catch(error=>status(error.message));if(action==='start')void start();if(action==='pause')pause();if(action==='clear')void clear();if(action==='minimize'){root.dataset.minimized=String(root.dataset.minimized!=='true');window.sessionStorage.setItem(prefix+'minimized',root.dataset.minimized);}if(action==='hide'){root.hidden=true;mini.hidden=false;}},{signal:listeners.signal});
 mini.addEventListener('click',()=>{root.hidden=false;mini.hidden=true;input.focus();},{signal:listeners.signal});
 window.addEventListener('storage',event=>{if(event.key===key&&!processing){try{load();render();}catch(error){status(error.message);}}},{signal:listeners.signal});
 try{load();input.value=window.sessionStorage.getItem(prefix+'draft')||'';root.dataset.minimized=window.sessionStorage.getItem(prefix+'minimized')||'false';render();}catch(error){status(error.message);root.querySelectorAll('[data-action=start],[data-action=add],[data-action=clear]').forEach(node=>node.disabled=true);}
 d.documentElement.append(style,root,mini);
 return{root,add,start,pause,clear,getState:()=>journal?.rows,dispose(){if(disposed)return;running=false;generation++;if(currentRow){try{transition(currentRow,currentRow.state==='SUBMITTED'?'UNKNOWN':'QUEUED',currentRow.state==='SUBMITTED'?'Page disposed during submission — verify native result':'Preflight interrupted before submission');}catch{}}disposed=true;controller?.abort();listeners.abort();root.remove();mini.remove();style.remove();}};
}
