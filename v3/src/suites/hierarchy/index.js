V3.boot = () => {
  const VERSION=V3.build.version;
  const life=V3.lifecycle.create('hierarchy');
  const telemetry=V3.telemetry.create('hierarchy',VERSION);
  const mode=/\/bindHierarchy(?:\/|$)/i.test(location.pathname)?'bind':'unbind';
  const queue=V3.queue.create({name:'hierarchy-'+mode,life,telemetry});
  const shell=V3.ui.createShell({
    id:'bwu2-v3-hierarchy',title:'BWU2 V3 Hierarchy',
    subtitle:mode.toUpperCase()+' · BWU2',version:VERSION,life,tabs:[]
  });
  V3.screenshot.install({life,roots:[shell.host]});

  const WAREHOUSE='BWU2', DEST='BWU1';
  const endpoints={
    validate:'/validateContainer',
    destination:'/validateDestination',
    summary:'/getTransshipmentBindingSummary',
    bind:'/forceBind',
    unbind:'/unbindContainer'
  };
  let busy=false;

  const setStatus=(text,tone='')=>shell.setStatus(text,tone);
  const json=body=>JSON.stringify(body);
  const request=async(path,body,{mutation=false,kind='read',ref=''}={})=>{
    const operation=mutation?V3.operation.create({kind,ref,telemetry}):null;
    const response=await V3.api.fetchRequest(path,{
      method:'POST',
      body:json(body),
      headers:{'content-type':'application/json'},
      timeout:mutation?25000:12000,
      mutation,operation,telemetry
    });
    return {response,operation};
  };
  const assertValidate=(data,id)=>{
    if(!data||typeof data!=='object')throw new Error('Unexpected validation response');
    if(V3.base.upper(data.warehouseId)!==WAREHOUSE)throw new Error('Container is not validated in '+WAREHOUSE);
    if(data.scannableId&&V3.base.lower(data.scannableId)!==V3.base.lower(id))throw new Error('Validation returned another container');
  };
  const assertSummary=data=>{
    if(!data||!Array.isArray(data.transferBindingSummaryList))throw new Error('Unexpected binding summary');
  };
  const assertMutation=(data,operation,label)=>{
    if(!data||typeof data!=='object'||!V3.base.clean(data.hostName)){
      operation?.unknown({reason:'unexpected-response'});
      throw new V3.operation.OutcomeUnknownError(label+' response was ambiguous — verify container');
    }
    operation?.confirmed();
  };

  async function login(){
    const pageWindow=typeof unsafeWindow==='object'&&unsafeWindow?unsafeWindow:window;
    let identity=V3.identity.resolve({doc:document,pageWindow});
    if(!identity.login) identity=await V3.identity.resolveWiki();
    if(!identity.login) throw new Error('Current authenticated employee could not be determined');
    telemetry.emit('identity',{source:identity.source});
    return identity.login;
  }

  async function processItem(item){
    const id=item.id;
    queue.itemSet(item,{status:'active',phase:'validate',error:''});
    queue.set({currentId:id,phase:'validate',message:'Validating '+id});
    const validated=await request(endpoints.validate,{warehouseId:WAREHOUSE,scannableId:id});
    assertValidate(validated.response.data,id);

    queue.itemSet(item,{phase:'summary'});
    queue.set({phase:'summary',message:'Checking bindings '+id});
    const summary=await request(endpoints.summary,{warehouseId:WAREHOUSE,scannableId:id});
    assertSummary(summary.response.data);

    if(!queue.state.running) return 'paused';
    const employeeLogin=await login();

    if(mode==='unbind'){
      queue.itemSet(item,{phase:'unbind'});
      queue.set({phase:'unbind',message:'Unbinding '+id});
      const result=await request(endpoints.unbind,{
        sourceWarehouseId:WAREHOUSE,scannableId:id,employeeLogin
      },{mutation:true,kind:'hierarchy-unbind',ref:id});
      assertMutation(result.response.data,result.operation,'Unbind');
    }else{
      queue.itemSet(item,{phase:'destination'});
      queue.set({phase:'destination',message:'Validating '+DEST+' destination'});
      const dest=await request(endpoints.destination,{destinationWarehouseId:DEST});
      if(V3.base.upper(dest.response.data)!==DEST){
        throw new Error('BWU1 destination token not established — use native Bind once, then retry V3');
      }
      if(!queue.state.running)return 'paused';

      queue.itemSet(item,{phase:'bind'});
      queue.set({phase:'bind',message:'Binding '+id+' → '+DEST});
      const result=await request(endpoints.bind,{
        sourceWarehouseId:WAREHOUSE,destinationWarehouseId:DEST,
        scannableId:id,employeeLogin
      },{mutation:true,kind:'hierarchy-bind',ref:id});
      assertMutation(result.response.data,result.operation,'Bind');
    }

    queue.itemSet(item,{status:'done',phase:'done',error:''});
    queue.set({currentId:'',phase:'idle',message:(mode==='bind'?'BOUND ':'UNBOUND ')+id});
    return 'done';
  }

  async function pump(){
    if(busy||!queue.state.running)return;
    if(!queue.acquire()){
      queue.set({running:false,message:'Hierarchy queue is active in another tab'});
      render();return;
    }
    const item=queue.next();
    if(!item){queue.set({running:false,currentId:'',phase:'idle',message:'Queue complete'});queue.release();render();return;}
    busy=true;render();
    try{
      const outcome=await processItem(item);
      if(outcome==='paused'){queue.itemSet(item,{status:'queued',phase:'idle'});queue.set({currentId:'',phase:'idle',message:'Paused safely before mutation'});}
    }catch(error){
      const unknown=error?.outcome==='unknown'||error instanceof V3.operation.OutcomeUnknownError;
      if(unknown){
        queue.itemSet(item,{status:'attention',phase:'unknown',error:'OUTCOME UNKNOWN — VERIFY BEFORE RETRY'});
        queue.set({running:false,currentId:'',phase:'idle',message:item.id+' outcome UNKNOWN'});
      }else if(error?.outcome==='rejected'||error instanceof V3.operation.RejectedError){
        queue.itemSet(item,{status:'rejected',phase:'rejected',error:String(error.message||error)});
        queue.set({running:false,currentId:'',phase:'idle',message:'Rejected: '+item.id});
      }else{
        queue.itemSet(item,{status:'rejected',phase:'error',error:String(error.message||error)});
        queue.set({running:false,currentId:'',phase:'idle',message:String(error.message||error)});
      }
      telemetry.emit('queue.error',{mode,item:V3.telemetry.mask(item.id),message:String(error?.message||error),unknown});
    }finally{
      busy=false;
      if(!queue.state.running)queue.release();
      render();
    }
    if(queue.state.running)life.timeout(pump,180);
  }

  function render(){
    const s=queue.state;
    setStatus(s.running?'RUNNING':(s.items.some(i=>i.status==='attention')?'ATTENTION':'READY'),
      s.items.some(i=>i.status==='attention')?'bad':s.running?'work':'');
    const root=document.createElement('div');
    root.innerHTML=
      '<section class="v3-section"><h3>'+(mode==='bind'?'Bind → BWU1':'Unbind')+'</h3>'+
      '<div class="v3-note">One canonical V3 queue · tsX/csX only · uncertain mutations stop.</div></section>'+
      '<section class="v3-section">'+
        '<label class="v3-field">Containers<textarea class="v3-input" data-input placeholder="tsX...&#10;csX..."></textarea></label>'+
        '<div class="v3-row">'+
          '<button class="v3-btn" data-add>ADD</button>'+
          '<button class="v3-btn primary" data-run>RUN</button>'+
          '<button class="v3-btn" data-pause>PAUSE</button>'+
          '<button class="v3-btn" data-clear-done>CLEAR DONE</button>'+
        '</div>'+
      '</section>'+
      '<section class="v3-section"><h3>'+V3.base.esc(s.message||'Ready')+'</h3><div class="v3-list" data-list></div></section>'+
      '<section class="v3-section"><button class="v3-btn" data-export>EXPORT OBS</button></section>';
    const list=root.querySelector('[data-list]');
    for(const item of s.items){
      const row=document.createElement('div');row.className='v3-item';row.dataset.state=item.status;
      row.innerHTML='<span>'+V3.base.esc(item.id)+(item.error?'<br><small>'+V3.base.esc(item.error)+'</small>':'')+'</span><b>'+V3.base.esc(item.status.toUpperCase())+'</b>';
      list.appendChild(row);
    }
    shell.setContent(root);
    shell.body.querySelector('[data-add]').onclick=()=>{
      const input=shell.body.querySelector('[data-input]');
      const values=String(input.value||'').split(/[\n,]+/).map(V3.base.clean).filter(Boolean);
      queue.addMany(values);input.value='';render();
    };
    shell.body.querySelector('[data-run]').onclick=()=>{
      if(s.items.some(i=>i.status==='attention')){queue.set({message:'Resolve ATTENTION rows before RUN'});render();return;}
      queue.set({running:true,message:'Starting…'});render();pump();
    };
    shell.body.querySelector('[data-pause]').onclick=()=>{queue.set({running:false,message:'Pause requested — no new mutation will start'});render();};
    shell.body.querySelector('[data-clear-done]').onclick=()=>{queue.clearDone();render();};
    shell.body.querySelector('[data-export]').onclick=()=>{
      const blob=new Blob([telemetry.exportText()],{type:'application/json'});
      const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='BWU2_V3_Hierarchy_OBS_'+Date.now()+'.json';a.click();URL.revokeObjectURL(a.href);
    };
  }

  life.on(window,'pagehide',()=>queue.release(),{once:true});
  render();
};