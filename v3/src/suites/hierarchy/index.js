V3.boot = () => {
  const VERSION=V3.build.version;
  const life=V3.lifecycle.create('hierarchy');
  const telemetry=V3.telemetry.create('hierarchy',VERSION);
  const mode=/\/bindHierarchy(?:\/|$)/i.test(location.pathname)?'bind':'unbind';
  const queue=V3.queue.create({name:'hierarchy-'+mode,life,telemetry});
  const bindStore=V3.storage.create('hierarchy.bind');
  const shell=V3.ui.createShell({
    id:'bwu2-v3-hierarchy',title:'BWU2 V3 Hierarchy',
    subtitle:mode.toUpperCase()+' · BWU2',version:VERSION,life,tabs:[]
  });
  V3.screenshot.install({life,roots:[shell.host]});

  const WAREHOUSE='BWU2',DEST='BWU1';
  const endpoints={validate:'/validateContainer',destination:'/validateDestination',summary:'/getTransshipmentBindingSummary',bind:'/forceBind',unbind:'/unbindContainer'};
  let busy=false;

  const setStatus=(text,tone='')=>shell.setStatus(text,tone);
  const json=body=>JSON.stringify(body);
  const pathOf=url=>{try{return new URL(String(url||''),location.href).pathname;}catch{return'';}};
  const parseBody=raw=>{if(raw==null)return null;if(typeof raw==='object')return raw;try{return JSON.parse(String(raw));}catch{return String(raw);}};
  const template=()=>{
    const value=bindStore.get('template',null);
    return value&&V3.base.clean(value.sourceWarehouseId)&&V3.base.clean(value.destinationWarehouseId)?value:null;
  };
  const clearTemplate=()=>{bindStore.remove('template');bindStore.remove('destinationToken');};

  function learnNative(path,request,response,status){
    if(mode!=='bind'||status<200||status>=300)return;
    const data=parseBody(response);
    if(path===endpoints.destination&&V3.base.upper(typeof data==='string'?data:'')===DEST){
      const token=V3.base.clean(request?.destinationWarehouseId);
      if(token){bindStore.set('destinationToken',token);telemetry.emit('bind.learn.destination',{ok:true});render();}
      return;
    }
    if(path===endpoints.bind&&data&&typeof data==='object'&&V3.base.clean(data.hostName)){
      const sourceWarehouseId=V3.base.clean(request?.sourceWarehouseId);
      const destinationWarehouseId=V3.base.clean(request?.destinationWarehouseId);
      const learnedDestination=V3.base.clean(bindStore.get('destinationToken',''));
      if(sourceWarehouseId&&destinationWarehouseId&&(!learnedDestination||destinationWarehouseId===learnedDestination)){
        bindStore.set('template',{sourceWarehouseId,destinationWarehouseId,learnedAt:Date.now()});
        telemetry.emit('bind.learn.template',{ok:true});
        render();
      }
    }
  }

  function installNativeLearning(){
    if(mode!=='bind')return;
    const page=typeof unsafeWindow==='object'&&unsafeWindow?unsafeWindow:window;
    try{
      const nativeFetch=page.fetch;
      if(typeof nativeFetch==='function'&&!nativeFetch.__bwu2V3HierarchyLearn){
        const wrapped=async function(input,init={}){
          const rawUrl=typeof input==='string'||input instanceof URL?String(input):String(input?.url||'');
          const path=pathOf(rawUrl);
          const watched=[endpoints.destination,endpoints.bind].includes(path);
          let request=null;if(watched)request=parseBody(init?.body);
          const response=await nativeFetch.apply(this,arguments);
          if(watched){
            try{const raw=await response.clone().text();learnNative(path,request,raw,Number(response.status)||0);}catch{}
          }
          return response;
        };
        wrapped.__bwu2V3HierarchyLearn=true;
        page.fetch=wrapped;
      }
    }catch(error){telemetry.emit('bind.learn.tap.error',{transport:'fetch',message:String(error?.message||error)});}

    try{
      const XHR=page.XMLHttpRequest;
      if(XHR?.prototype&&!XHR.prototype.__bwu2V3HierarchyLearn){
        const open=XHR.prototype.open,send=XHR.prototype.send;
        XHR.prototype.open=function(method,url){
          this.__bwu2V3Learn={method:String(method||'GET'),path:pathOf(url)};
          return open.apply(this,arguments);
        };
        XHR.prototype.send=function(body){
          const info=this.__bwu2V3Learn||{},watched=[endpoints.destination,endpoints.bind].includes(info.path);
          const request=watched?parseBody(body):null;
          if(watched)this.addEventListener('loadend',()=>{
            let raw='';try{raw=!this.responseType||this.responseType==='text'?this.responseText||'':this.responseType==='json'?JSON.stringify(this.response??null):'';}catch{}
            learnNative(info.path,request,raw,Number(this.status)||0);
          },{once:true});
          return send.apply(this,arguments);
        };
        XHR.prototype.__bwu2V3HierarchyLearn=true;
      }
    }catch(error){telemetry.emit('bind.learn.tap.error',{transport:'xhr',message:String(error?.message||error)});}
  }

  const request=async(path,body,{mutation=false,kind='read',ref=''}={})=>{
    const operation=mutation?V3.operation.create({kind,ref,telemetry}):null;
    const response=await V3.api.fetchRequest(path,{
      method:'POST',body:json(body),headers:{'content-type':'application/json'},
      timeout:mutation?25000:12000,mutation,operation,telemetry
    });
    return{response,operation};
  };
  const assertValidate=(data,id)=>{
    if(!data||typeof data!=='object')throw new Error('Unexpected validation response');
    if(V3.base.upper(data.warehouseId)!==WAREHOUSE)throw new Error('Container is not validated in '+WAREHOUSE);
    if(data.scannableId&&V3.base.lower(data.scannableId)!==V3.base.lower(id))throw new Error('Validation returned another container');
  };
  const assertSummary=data=>{if(!data||!Array.isArray(data.transferBindingSummaryList))throw new Error('Unexpected binding summary');};
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
    if(!identity.login)identity=await V3.identity.resolveWiki();
    if(!identity.login)throw new Error('Current authenticated employee could not be determined');
    telemetry.emit('identity',{source:identity.source});
    return identity.login;
  }

  async function bindTemplate(){
    const learned=template();
    if(!learned)throw new Error('BIND TEMPLATE NOT LEARNED — do one normal native Bind to BWU1 while V3 is enabled');
    const check=await request(endpoints.destination,{destinationWarehouseId:learned.destinationWarehouseId});
    if(V3.base.upper(check.response.data)!==DEST){
      clearTemplate();render();
      throw new Error('Saved Bind destination no longer validates as BWU1 — learn again with one native Bind');
    }
    return learned;
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

    if(!queue.state.running)return'paused';
    const employeeLogin=await login();

    if(mode==='unbind'){
      queue.itemSet(item,{phase:'unbind'});
      queue.set({phase:'unbind',message:'Unbinding '+id});
      const result=await request(endpoints.unbind,{
        sourceWarehouseId:WAREHOUSE,scannableId:id,employeeLogin
      },{mutation:true,kind:'hierarchy-unbind',ref:id});
      assertMutation(result.response.data,result.operation,'Unbind');
    }else{
      const learned=await bindTemplate();
      if(!queue.state.running)return'paused';
      queue.itemSet(item,{phase:'bind'});
      queue.set({phase:'bind',message:'Binding '+id+' → '+DEST});
      const result=await request(endpoints.bind,{
        sourceWarehouseId:learned.sourceWarehouseId,destinationWarehouseId:learned.destinationWarehouseId,
        scannableId:id,employeeLogin
      },{mutation:true,kind:'hierarchy-bind',ref:id});
      assertMutation(result.response.data,result.operation,'Bind');
    }

    queue.itemSet(item,{status:'done',phase:'done',error:''});
    queue.set({currentId:'',phase:'idle',message:(mode==='bind'?'BOUND ':'UNBOUND ')+id});
    return'done';
  }

  async function pump(){
    if(busy||!queue.state.running)return;
    if(!queue.acquire()){queue.set({running:false,message:'Hierarchy queue is active in another tab'});render();return;}
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
      busy=false;if(!queue.state.running)queue.release();render();
    }
    if(queue.state.running)life.timeout(pump,180);
  }

  function render(){
    const s=queue.state,attention=s.items.some(i=>i.status==='attention'),learned=template();
    setStatus(s.running?'RUNNING':attention?'ATTENTION':'READY',attention?'bad':s.running?'work':'');
    const root=document.createElement('div');
    root.innerHTML=
      '<section class="v3-section"><h3>'+(mode==='bind'?'Bind → BWU1':'Unbind')+'</h3>'+
      '<div class="v3-note">One canonical V3 queue · tsX/csX only · uncertain mutations stop.</div>'+
      (mode==='bind'?'<div class="v3-note" style="margin-top:7px;color:'+(learned?'var(--v3-ok)':'var(--v3-warn)')+'"><b>BIND TEMPLATE: '+(learned?'READY':'NEEDS ONE NATIVE BIND')+'</b><br>'+(learned?'Destination token re-validates as BWU1 before each V3 bind.':'Use the native page once to Bind any container to BWU1. V3 passively learns the opaque source/destination tokens.')+'</div>':'')+
      '</section>'+
      '<section class="v3-section"><label class="v3-field">Containers<textarea class="v3-input" data-input placeholder="tsX...&#10;csX..."></textarea></label>'+
      '<div class="v3-row"><button class="v3-btn" data-add>ADD</button><button class="v3-btn primary" data-run>RUN</button><button class="v3-btn" data-pause>PAUSE</button><button class="v3-btn" data-clear-done>CLEAR DONE</button>'+
      (mode==='bind'&&learned?'<button class="v3-btn danger" data-forget>FORGET TEMPLATE</button>':'')+'</div></section>'+
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
      queue.addMany(String(input.value||'').split(/[\n,]+/).map(V3.base.clean).filter(Boolean));input.value='';render();
    };
    shell.body.querySelector('[data-run]').onclick=()=>{
      if(attention){queue.set({message:'Resolve ATTENTION rows before RUN'});render();return;}
      if(mode==='bind'&&!template()){queue.set({message:'Do one native Bind to BWU1 first so V3 can learn the opaque tokens'});render();return;}
      queue.set({running:true,message:'Starting…'});render();pump();
    };
    shell.body.querySelector('[data-pause]').onclick=()=>{queue.set({running:false,message:'Pause requested — no new mutation will start'});render();};
    shell.body.querySelector('[data-clear-done]').onclick=()=>{queue.clearDone();render();};
    shell.body.querySelector('[data-forget]')?.addEventListener('click',()=>{clearTemplate();queue.set({message:'Bind template forgotten'});render();});
    shell.body.querySelector('[data-export]').onclick=()=>{
      const blob=new Blob([telemetry.exportText()],{type:'application/json'}),a=document.createElement('a');
      a.href=URL.createObjectURL(blob);a.download='BWU2_V3_Hierarchy_OBS_'+Date.now()+'.json';a.click();URL.revokeObjectURL(a.href);
    };
  }

  installNativeLearning();
  life.on(window,'pagehide',()=>queue.release(),{once:true});
  render();
};