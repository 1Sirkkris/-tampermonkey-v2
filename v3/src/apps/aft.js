V3.boot=()=>{
  const C=V3.core,life=C.lifecycle('aft'),telemetry=C.telemetry('aft',V3.build.version);
  let stopFlag=false,busy=false,pulseTimer=0,currentUi=null;
  const engine=V3.aft.create({life,telemetry,stopped:()=>stopFlag});
  const WORKER=location.hash==='#v3-iss-worker'&&window.parent!==window;
  const PARENT='https://aft-poirot-website-nrt.nrt.proxy.amazon.com';

  const runFresh=fn=>async payload=>{stopFlag=false;return fn(payload);};
  const direct={
    move:runFresh(p=>engine.runMove(p)),
    editEach:runFresh(p=>engine.runEditEach(p)),
    editSku:runFresh(p=>engine.runEditSku(p)),
    fcsku:runFresh(p=>engine.runFcsku(p)),
    date:runFresh(p=>engine.runDate(p)),
    stop(){stopFlag=true;}
  };

  if(WORKER){
    const send=(type,payload={})=>{try{window.parent.postMessage({type,worker:'aft',version:V3.build.version,...payload},PARENT);}catch{}};
    const pulseStart=()=>{pulseStop();pulseTimer=setInterval(()=>{if(busy)send('V3_AFT_PROGRESS',{pulse:true,message:'working'});},12000);};
    const pulseStop=()=>{if(pulseTimer){clearInterval(pulseTimer);pulseTimer=0;}};
    life.own(pulseStop);
    life.on(window,'message',async event=>{
      if(event.origin!==PARENT||event.source!==window.parent)return;
      const msg=event.data;if(msg?.type!=='V3_AFT_RPC'||!msg.id)return;
      if(msg.command==='ping'){send('V3_AFT_RESULT',{id:msg.id,ok:true,data:{ready:true}});return;}
      if(msg.command==='stop'){stopFlag=true;send('V3_AFT_RESULT',{id:msg.id,ok:true,data:{stopped:true}});return;}
      if(busy){send('V3_AFT_RESULT',{id:msg.id,ok:false,error:'AFT worker busy'});return;}
      busy=true;stopFlag=false;pulseStart();
      const progress=p=>send('V3_AFT_PROGRESS',{id:msg.id,area:String(msg.command||'').split('.')[0],progress:p});
      try{
        let data;
        if(msg.command==='move.run')data=await engine.runMove({...msg.payload,onProgress:progress});
        else if(msg.command==='edit.each')data=await engine.runEditEach({...msg.payload,onProgress:progress});
        else if(msg.command==='edit.sku')data=await engine.runEditSku({...msg.payload,onProgress:progress});
        else if(msg.command==='fcsku.run')data=await engine.runFcsku({...msg.payload,onProgress:progress});
        else if(msg.command==='date.run')data=await engine.runDate({...msg.payload,onProgress:progress});
        else throw new Error('Unknown AFT worker command');
        send('V3_AFT_RESULT',{id:msg.id,ok:true,data});
      }catch(error){
        send('V3_AFT_RESULT',{id:msg.id,ok:false,error:C.clean(error.message||error),outcome:error?.outcome||'',partial:error?.aftPartial||null});
      }finally{busy=false;pulseStop();}
    });
    send('V3_AFT_READY',{ready:true});
    return;
  }

  const panel=C.panel({id:'aft-tools',title:'V3 · AFT Tools',width:620,life});
  let mounted=false,sub='edit';
  const mount=()=>{
    if(!mounted)mounted=true;
    const root=document.createElement('div');
    const route=location.pathname.toLowerCase();
    if(route.includes('/app/moveitems')){
      V3.workflowUI.mountMove(root,{run:direct.move,stop:direct.stop,prefix:'aft.move'});
    }else if(route.includes('/app/fcskuflip')){
      V3.workflowUI.mountFcsku(root,{run:direct.fcsku,stop:direct.stop,prefix:'aft.fcsku'});
    }else{
      root.innerHTML='<div class="v3-tabs"><button class="v3-btn" data-sub="edit">EDIT</button><button class="v3-btn" data-sub="date">DATE</button></div><div data-work></div>';
      const work=root.querySelector('[data-work]'),paint=()=>{for(const b of root.querySelectorAll('[data-sub]'))b.classList.toggle('active',b.dataset.sub===sub);work.replaceChildren();if(sub==='date')V3.workflowUI.mountDate(work,{run:direct.date,stop:direct.stop,prefix:'aft.date'});else V3.workflowUI.mountEdit(work,{runEach:direct.editEach,runSku:direct.editSku,stop:direct.stop,prefix:'aft.edit'});};
      for(const b of root.querySelectorAll('[data-sub]'))b.onclick=()=>{direct.stop();sub=b.dataset.sub;paint();};paint();
    }
    panel.set(root);
  };
  C.dockButton({id:'aft-tools',label:'AFT',title:'V3 AFT Tools',onClick:()=>{mount();panel.open();}});
};
