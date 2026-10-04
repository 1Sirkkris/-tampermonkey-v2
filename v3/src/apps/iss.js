V3.boot=()=>{
  const C=V3.core,life=C.lifecycle('iss'),telemetry=C.telemetry('iss',V3.build.version),panel=C.panel({id:'iss-console',title:'V3 · ISS Console',width:720,life});
  const AFT_ORIGIN='https://aft-qt-jp.aka.nrt.corp.amazon.com';
  let frame=null,ready=false,readyPromise=null,seq=0,tab='sideline',activeUi=null;
  const pending=new Map();

  const ensureFrame=()=>{
    if(frame?.isConnected)return frame;
    frame=document.createElement('iframe');frame.src=AFT_ORIGIN+'/app/edititems?experience=Desktop#v3-iss-worker';frame.hidden=true;frame.setAttribute('aria-hidden','true');frame.tabIndex=-1;document.body.appendChild(frame);life.own(()=>frame?.remove());ready=false;return frame;
  };
  const waitReady=()=>{if(ready)return Promise.resolve(true);if(readyPromise)return readyPromise;ensureFrame();readyPromise=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{readyPromise=null;reject(new Error('AFT worker did not become ready'));},20000);const check=()=>{if(ready){clearTimeout(timer);readyPromise=null;resolve(true);}else life.timeout(check,100);};check();});return readyPromise;};
  const arm=(id,job)=>{clearTimeout(job.timer);job.timer=setTimeout(()=>{pending.delete(id);const e=new C.UnknownError('AFT worker connection lost/silent — verify active workflow before retry');e.aftPartial=job.partial||null;job.reject(e);},75000);};
  life.on(window,'message',event=>{
    if(event.origin!==AFT_ORIGIN||event.source!==frame?.contentWindow)return;
    const msg=event.data;if(msg?.worker!=='aft')return;
    if(msg.type==='V3_AFT_READY'){ready=true;return;}
    if(msg.type==='V3_AFT_PROGRESS'){
      const job=pending.get(String(msg.id||''));if(!job)return;arm(String(msg.id),job);if(!msg.pulse){job.partial=msg.progress||job.partial;try{job.onProgress?.(msg.progress||{});}catch{}}
      return;
    }
    if(msg.type!=='V3_AFT_RESULT')return;
    const id=String(msg.id||''),job=pending.get(id);if(!job)return;pending.delete(id);clearTimeout(job.timer);
    if(msg.ok)job.resolve(msg.data);else{const ErrorType=msg.outcome==='unknown'?C.UnknownError:msg.outcome==='rejected'?C.RejectedError:Error;const error=new ErrorType(msg.error||'AFT worker failed');if(msg.partial)error.aftPartial=msg.partial;job.reject(error);}
  });
  const rpc=async(command,payload={},onProgress)=>{
    await waitReady();const id='iss-'+(++seq)+'-'+Date.now().toString(36);
    return new Promise((resolve,reject)=>{const job={resolve,reject,onProgress,timer:0,partial:null};pending.set(id,job);arm(id,job);frame.contentWindow.postMessage({type:'V3_AFT_RPC',id,command,payload},AFT_ORIGIN);});
  };
  const stopWorker=()=>{if(!ready||!frame?.contentWindow)return;const id='stop-'+(++seq);frame.contentWindow.postMessage({type:'V3_AFT_RPC',id,command:'stop',payload:{}},AFT_ORIGIN);};

  const controller={
    move:p=>rpc('move.run',p,p.onProgress),
    editEach:p=>rpc('edit.each',p,p.onProgress),
    editSku:p=>rpc('edit.sku',p,p.onProgress),
    fcsku:p=>rpc('fcsku.run',p,p.onProgress),
    stop:stopWorker
  };
  const sidelineEngine=V3.sideline.create({life,telemetry:C.telemetry('sideline',V3.build.version)});

  const render=()=>{
    activeUi?.dispose?.();activeUi=null;
    const root=document.createElement('div');
    root.innerHTML='<section class="v3-section"><b>ISS Console</b><div class="v3-note">Edit · Move · Sideline · FCSKU</div><div class="v3-tabs" style="margin-top:8px">'+[['edit','EDIT'],['move','MOVE'],['sideline','SIDELINE'],['fcsku','FCSKU']].map(([id,label])=>'<button class="v3-btn'+(id===tab?' active':'')+'" data-tab="'+id+'">'+label+'</button>').join('')+'</div></section><div data-work></div>';
    panel.set(root);const work=root.querySelector('[data-work]');
    for(const b of root.querySelectorAll('[data-tab]'))b.onclick=()=>{stopWorker();tab=b.dataset.tab;render();};
    if(tab==='edit')activeUi=V3.workflowUI.mountEdit(work,{runEach:controller.editEach,runSku:controller.editSku,stop:controller.stop,prefix:'iss.edit'});
    else if(tab==='move')activeUi=V3.workflowUI.mountMove(work,{run:controller.move,stop:controller.stop,prefix:'iss.move'});
    else if(tab==='fcsku')activeUi=V3.workflowUI.mountFcsku(work,{run:controller.fcsku,stop:controller.stop,prefix:'iss.fcsku'});
    else activeUi=V3.sidelineUI.mount(work,{engine:sidelineEngine,life,title:'ISS Sideline',prefix:'iss.sideline'});
  };

  C.dockButton({id:'iss-console',label:'ISS',title:'V3 ISS Console',onClick:()=>{render();panel.open();}});
  if(location.hash==='#iss-console'){render();panel.open();}
};
