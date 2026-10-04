V3.boot=()=>{
  const C=V3.core,life=C.lifecycle('hierarchy'),telemetry=C.telemetry('hierarchy',V3.build.version),mode=/\/bindHierarchy/i.test(location.pathname)?'bind':'unbind',queue=C.queue({name:'hierarchy-'+mode,life});
  const panel=C.panel({id:'hierarchy',title:'V3 · '+(mode==='bind'?'Bind':'Unbind'),width:600,life});
  let busy=false,destination='',bindContext=null,mounted=false;

  const employee=()=>C.identity({pageWindow:typeof unsafeWindow==='object'&&unsafeWindow?unsafeWindow:window}).login;
  const draw=async()=>{
    await queue.load();
    const s=queue.state,root=document.createElement('div');
    root.innerHTML='<section class="v3-section">'+
      (mode==='bind'?'<label class="v3-field">Destination FC<input data-dest autocomplete="off" placeholder="BWU1 / AVV2" value="'+C.esc(destination)+'"></label><div class="v3-note">Destination is validated by Amazon before the queue starts. Hidden destination ID is kept in memory only.</div>':'')+
      '<label class="v3-field">Containers<textarea data-input placeholder="tsX...\ncsX..."></textarea></label>'+
      '<div class="v3-row"><button class="v3-btn" data-add>ADD</button><button class="v3-btn primary" data-run>RUN</button><button class="v3-btn" data-pause>PAUSE</button><button class="v3-btn" data-done>CLEAR DONE</button></div>'+
      '<div class="v3-note" data-msg style="margin-top:8px">'+C.esc(s.message||'Ready')+'</div></section><section class="v3-section"><div data-list></div></section>';
    panel.set(root);
    root.querySelector('[data-list]').innerHTML=s.items.map(x=>'<div class="v3-list-row"><b>'+C.esc(x.id)+'</b> · '+C.esc(x.status.toUpperCase())+(x.error?' · <span class="v3-bad">'+C.esc(x.error)+'</span>':'')+'</div>').join('')||'<div class="v3-note">Queue empty.</div>';
    const dest=root.querySelector('[data-dest]');
    if(dest){dest.disabled=s.running;dest.oninput=()=>{destination=C.upper(dest.value);bindContext=null;};}
    root.querySelector('[data-add]').onclick=async()=>{await queue.add(C.lines(root.querySelector('[data-input]').value));draw();};
    root.querySelector('[data-run]').onclick=async()=>{
      if(s.items.some(x=>x.status==='attention')){await queue.set({message:'Resolve ATTENTION before RUN'});return draw();}
      if(mode==='bind'){
        destination=V3.actions.normalizeFacility(destination);
        if(!destination){await queue.set({message:'Enter destination FC first, e.g. BWU1 or AVV2'});return draw();}
        await queue.set({running:false,message:'Validating '+destination+'…'});await draw();
        try{bindContext=await V3.actions.validateDestinationNative(destination,{life,telemetry});}
        catch(error){bindContext=null;await queue.set({running:false,message:'Destination rejected: '+C.clean(error.message||error)});return draw();}
      }
      await queue.set({running:true,message:'Starting'});draw();pump();
    };
    root.querySelector('[data-pause]').onclick=async()=>{await queue.set({running:false,message:'Pause requested'});bindContext=null;draw();};
    root.querySelector('[data-done]').onclick=async()=>{await queue.clearDone();draw();};
  };

  const pump=async()=>{
    if(busy||!queue.state.running)return;
    if(!queue.acquire()){await queue.set({running:false,message:'Queue active in another tab'});return draw();}
    const row=queue.next();
    if(!row){await queue.set({running:false,current:'',phase:'idle',message:'Queue complete'});bindContext=null;queue.release();return draw();}
    busy=true;await queue.item(row,{status:'active',error:'',phase:mode});await queue.set({current:row.id,phase:mode,message:(mode==='bind'?'Binding '+row.id+' → '+destination:'Unbinding '+row.id)});draw();
    try{
      if(mode==='bind'){
        if(!bindContext||bindContext.facility!==destination)throw new Error('Destination no longer validated — press RUN again');
        await V3.actions.bindNative(row.id,bindContext,{life,telemetry});
        await queue.item(row,{status:'done',phase:'done'});await queue.set({current:'',phase:'idle',message:'BOUND '+row.id+' → '+destination});
      }else{
        const login=employee();if(!login)throw new Error('Authenticated employee identity unavailable');
        await V3.actions.unbind(row.id,login,{telemetry});
        await queue.item(row,{status:'done',phase:'done'});await queue.set({current:'',phase:'idle',message:'UNBOUND '+row.id});
      }
    }catch(error){
      const unknown=error?.outcome==='unknown'||error instanceof C.UnknownError;
      await queue.item(row,{status:unknown?'attention':'rejected',phase:'',error:unknown?'OUTCOME UNKNOWN — VERIFY BEFORE RETRY':C.clean(error.message||error)});
      await queue.set({running:false,current:'',phase:'idle',message:C.clean(error.message||error)});bindContext=null;
    }finally{busy=false;if(!queue.state.running)queue.release();draw();}
    if(queue.state.running)life.timeout(pump,180);
  };

  C.dockButton({id:'hierarchy',label:mode==='bind'?'BIND':'UNBIND',title:'V3 Hierarchy',onClick:()=>{if(!mounted)mounted=true;draw();panel.open();}});
};
