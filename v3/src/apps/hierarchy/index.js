V3.boot=()=>{
  const life=V3.lifecycle.create('hierarchy');
  const telemetry=V3.telemetry.create('hierarchy',V3.build.version);
  const mode=/\/bindHierarchy/i.test(location.pathname)?'bind':'unbind';
  const queue=V3.queue.create({name:'hierarchy-'+mode,life,telemetry});
  const panel=V3.ui.panel({id:'bwu2-v3-hierarchy-panel',title:'V3 · '+(mode==='bind'?'Bind':'Unbind'),width:590,life});
  let busy=false,destination='',bindContext=null;

  const identity=()=>V3.identity.resolve({
    pageWindow:typeof unsafeWindow==='object'&&unsafeWindow?unsafeWindow:window
  }).login;

  async function render(){
    await queue.load();
    const s=queue.state,root=document.createElement('div');
    root.innerHTML=
      '<section class="section">'+
        (mode==='bind'
          ? '<label class="field">Destination FC<input data-destination autocomplete="off" placeholder="BWU1 / AVV2" value="'+V3.base.esc(destination)+'"></label>'+
            '<div class="note">Destination is session-only. Native /validateDestination must confirm the FC before the queue can start.</div>'
          : '')+
        '<label class="field" style="margin-top:8px">Containers<textarea data-input placeholder="tsX...\ncsX..."></textarea></label>'+
        '<div class="row"><button class="btn" data-add>ADD</button><button class="btn primary" data-run>RUN</button><button class="btn" data-pause>PAUSE</button><button class="btn" data-done>CLEAR DONE</button></div>'+
        '<div class="note" style="margin-top:8px">'+V3.base.esc(s.message||'Ready')+'</div>'+
      '</section>'+
      '<section class="section"><div data-list></div></section>';
    panel.set(root);

    const list=root.querySelector('[data-list]');
    list.innerHTML=s.items.map(item=>
      '<div style="padding:6px;border-bottom:1px solid #39475b"><b>'+V3.base.esc(item.id)+'</b> · '+item.status.toUpperCase()+
      (item.error?' · '+V3.base.esc(item.error):'')+'</div>'
    ).join('')||'<div class="note">Queue empty.</div>';

    const destinationInput=root.querySelector('[data-destination]');
    if(destinationInput){
      destinationInput.disabled=Boolean(s.running);
      destinationInput.oninput=()=>{
        destination=V3.hierarchyNative.normalizeFacility(destinationInput.value)||V3.base.upper(destinationInput.value);
        bindContext=null;
      };
    }

    root.querySelector('[data-add]').onclick=async()=>{
      await queue.add(V3.base.lines(root.querySelector('[data-input]').value));
      render();
    };

    root.querySelector('[data-run]').onclick=async()=>{
      if(s.items.some(item=>item.status==='attention')){
        await queue.set({message:'Resolve ATTENTION before RUN'});return render();
      }
      if(mode==='bind'){
        const fc=V3.hierarchyNative.normalizeFacility(destination);
        if(!fc){
          await queue.set({message:'Enter destination FC first, e.g. BWU1 or AVV2'});
          return render();
        }
        destination=fc;
        bindContext=null;
        await queue.set({running:false,message:'Validating destination '+fc+'…'});
        render();
        try{
          bindContext=await V3.hierarchyNative.validateDestination(fc,{life,telemetry});
        }catch(error){
          await queue.set({running:false,message:'Destination rejected: '+String(error.message||error)});
          bindContext=null;
          return render();
        }
      }
      await queue.set({running:true,message:'Starting'});
      render();pump();
    };

    root.querySelector('[data-pause]').onclick=async()=>{
      await queue.set({running:false,message:'Pause requested'});
      bindContext=null;
      render();
    };
    root.querySelector('[data-done]').onclick=async()=>{
      await queue.clearDone();
      render();
    };
  }

  async function pump(){
    if(busy||!queue.state.running)return;
    if(!queue.acquire()){
      await queue.set({running:false,message:'Queue active in another tab'});
      return render();
    }

    const item=queue.next();
    if(!item){
      await queue.set({running:false,current:'',message:'Queue complete'});
      bindContext=null;
      queue.release();
      return render();
    }

    busy=true;
    await queue.item(item,{status:'active',error:''});
    await queue.set({
      current:item.id,
      message:mode==='bind'?'Binding '+item.id+' → '+destination:'Unbinding '+item.id
    });
    render();

    try{
      if(mode==='bind'){
        if(!bindContext||bindContext.facility!==destination)throw new Error('Destination is no longer validated — press RUN again');
        await V3.hierarchyNative.bind(item.id,bindContext,{life,telemetry});
        await queue.item(item,{status:'done'});
        await queue.set({current:'',message:'BOUND '+item.id+' → '+destination});
      }else{
        const login=identity();
        if(!login)throw new Error('Authenticated employee identity unavailable');
        await V3.hierarchy.unbind(item.id,login,{telemetry});
        await queue.item(item,{status:'done'});
        await queue.set({current:'',message:'UNBOUND '+item.id});
      }
    }catch(error){
      const unknown=error?.outcome==='unknown'||error instanceof V3.operation.UnknownError;
      await queue.item(item,{
        status:unknown?'attention':'rejected',
        error:unknown?'OUTCOME UNKNOWN — VERIFY BEFORE RETRY':String(error.message||error)
      });
      await queue.set({running:false,current:'',message:String(error.message||error)});
      if(mode==='bind')bindContext=null;
    }finally{
      busy=false;
      if(!queue.state.running)queue.release();
      render();
    }

    if(queue.state.running)life.timeout(pump,180);
  }

  V3.ui.dockButton({
    id:'hierarchy',
    label:mode==='bind'?'BIND':'UNBIND',
    title:'V3 Hierarchy',
    onClick:()=>{render();panel.open();}
  });
};