V3.boot = () => {
  const VERSION=V3.build.version;
  const life=V3.lifecycle.create('moveapp');
  const telemetry=V3.telemetry.create('moveapp',VERSION);
  const queue=V3.queue.create({name:'moveapp',life,telemetry});
  const settings=V3.storage.create('moveapp.settings');
  const shell=V3.ui.createShell({id:'bwu2-v3-moveapp',title:'BWU2 V3 MoveApp',subtitle:'Dropzone Queue',version:VERSION,life,tabs:[]});
  V3.screenshot.install({life,roots:[shell.host]});
  const MOVE_URL='https://aft-moveapp-nrt-nrt.nrt.proxy.amazon.com/api/move-container';
  const FLOORS=['P1','P2','P3','P4'];
  const UPPER=[
    ['Cubiscan','dz-Pcubiscan-{floor}'],['Prep','dz-P-Prep-{floor}'],['ISS','dz-P-ISS-{floor}'],
    ['Damages','dz-P-Damages-{floor}'],['Hazmat','dz-P-Hazmat-{floor}'],['Nonsort','dz-Pnonsort-{floor}']
  ];
  const P1=[
    ['Hazmat','dz-P-HAZMAT_OUT'],['Ticketland','dz-P-Ticketland'],['Consolidation','dz-P-issconsol'],
    ['ISS WIP','dz-S-ISSWIP1'],['Nonsort','dz-P-IB-nonsort'],['Shipdock','dz-P-ISS-Shipdock'],
    ['OB IOL','dz-P-OBIOL'],['Damageland','dz-Pdamageland'],['Receive Damages','dz-P-rcv-Damages']
  ];
  let busy=false;
  let floor=settings.get('floor','P2');
  if(!FLOORS.includes(floor))floor='P2';
  let type=settings.get('type','PRIME');

  function destination(){
    if(type==='PRIME')return'dz-P-PRIME';
    const list=floor==='P1'?P1:UPPER;
    const found=list.find(([name])=>name===type);
    if(!found)return'';
    return floor==='P1'?found[1]:found[1].replace('{floor}',floor);
  }
  function validateConfirmation(result,requestedUrl,operation){
    const response=result.response;
    const finalUrl=V3.base.clean(result.finalUrl||'');
    let unexpected=false;
    if(finalUrl){
      try{unexpected=new URL(finalUrl).pathname.replace(/\/+$/,'')!==new URL(requestedUrl).pathname.replace(/\/+$/,'');}catch{}
    }
    if(unexpected){
      operation.unknown({reason:'redirect'});
      throw new V3.operation.OutcomeUnknownError('Move confirmation redirected unexpectedly');
    }
    operation.confirmed({status:result.status});
  }
  async function moveOne(item,dz){
    const operation=V3.operation.create({kind:'move-container',ref:item.id,telemetry});
    queue.itemSet(item,{status:'active',phase:'move',error:''});
    queue.set({currentId:item.id,phase:'move',message:'Moving '+item.id+' → '+dz});
    const payload={sourceScannableId:null,destinationScannableId:dz,containerScannableId:item.id,confirmed:'true'};
    const result=await V3.api.gmRequest(MOVE_URL,{
      method:'POST',data:JSON.stringify(payload),headers:{'Content-Type':'application/json'},
      timeout:15000,mutation:true,operation,telemetry
    });
    validateConfirmation(result,MOVE_URL,operation);
    queue.itemSet(item,{status:'done',phase:'done',error:''});
    queue.set({currentId:'',phase:'idle',message:'MOVED '+item.id+' → '+dz});
  }
  async function pump(){
    if(busy||!queue.state.running)return;
    if(!queue.acquire()){queue.set({running:false,message:'Move queue is active in another tab'});render();return;}
    const item=queue.next();
    if(!item){queue.set({running:false,currentId:'',phase:'idle',message:'Queue complete'});queue.release();render();return;}
    const dz=queue.state.lockedDestination||destination();
    if(!dz){queue.set({running:false,message:'Select a destination'});queue.release();render();return;}
    busy=true;render();
    try{await moveOne(item,dz);}
    catch(error){
      const unknown=error?.outcome==='unknown'||error instanceof V3.operation.OutcomeUnknownError;
      queue.itemSet(item,{status:unknown?'attention':'rejected',phase:unknown?'unknown':'rejected',error:unknown?'OUTCOME UNKNOWN — VERIFY BEFORE RETRY':String(error?.message||error)});
      queue.set({running:false,currentId:'',phase:'idle',message:unknown?item.id+' outcome UNKNOWN':String(error?.message||error)});
      telemetry.emit('queue.error',{item:V3.telemetry.mask(item.id),message:String(error?.message||error),unknown});
    }finally{busy=false;if(!queue.state.running)queue.release();render();}
    if(queue.state.running)life.timeout(pump,180);
  }
  function render(){
    const s=queue.state,dz=s.lockedDestination||destination();
    shell.setStatus(s.running?'RUNNING':(s.items.some(i=>i.status==='attention')?'ATTENTION':'READY'),s.items.some(i=>i.status==='attention')?'bad':s.running?'work':'');
    const root=document.createElement('div');
    const options=(floor==='P1'?P1:UPPER).map(([name])=>'<option'+(name===type?' selected':'')+'>'+V3.base.esc(name)+'</option>').join('');
    root.innerHTML=
      '<section class="v3-section"><h3>MoveContainer</h3><div class="v3-note">Destination locks when RUN starts. PRIME is always dz-P-PRIME.</div></section>'+
      '<section class="v3-section"><div class="v3-grid">'+
        '<label class="v3-field">Floor<select data-floor>'+FLOORS.map(f=>'<option'+(f===floor?' selected':'')+'>'+f+'</option>').join('')+'</select></label>'+
        '<label class="v3-field">Drop<select data-type><option'+(type==='PRIME'?' selected':'')+'>PRIME</option>'+options+'</select></label>'+
      '</div><div class="v3-note">Selected: <b>'+V3.base.esc(dz||'NONE')+'</b></div></section>'+
      '<section class="v3-section"><label class="v3-field">Containers<textarea class="v3-input" data-input placeholder="tsX...&#10;csX..."></textarea></label>'+
        '<div class="v3-row"><button class="v3-btn" data-add>ADD</button><button class="v3-btn primary" data-run>RUN</button><button class="v3-btn" data-pause>PAUSE</button><button class="v3-btn" data-done>CLEAR DONE</button></div></section>'+
      '<section class="v3-section"><h3>'+V3.base.esc(s.message||'Ready')+'</h3><div class="v3-list" data-list></div></section>';
    const list=root.querySelector('[data-list]');
    for(const item of s.items){const row=document.createElement('div');row.className='v3-item';row.dataset.state=item.status;row.innerHTML='<span>'+V3.base.esc(item.id)+(item.error?'<br><small>'+V3.base.esc(item.error)+'</small>':'')+'</span><b>'+item.status.toUpperCase()+'</b>';list.appendChild(row);}
    shell.setContent(root);
    shell.body.querySelector('[data-floor]').onchange=e=>{if(s.running)return;floor=e.target.value;settings.set('floor',floor);type='PRIME';settings.set('type',type);render();};
    shell.body.querySelector('[data-type]').onchange=e=>{if(s.running)return;type=e.target.value;settings.set('type',type);render();};
    shell.body.querySelector('[data-add]').onclick=()=>{const input=shell.body.querySelector('[data-input]');queue.addMany(String(input.value||'').split(/[\n,]+/).map(V3.base.clean));input.value='';render();};
    shell.body.querySelector('[data-run]').onclick=()=>{
      if(s.items.some(i=>i.status==='attention')){queue.set({message:'Resolve ATTENTION rows before RUN'});render();return;}
      const selected=destination();if(!selected){queue.set({message:'Select a destination'});render();return;}
      s.lockedDestination=selected;queue.save();queue.set({running:true,message:'Starting → '+selected});render();pump();
    };
    shell.body.querySelector('[data-pause]').onclick=()=>{queue.set({running:false,message:'Paused — current submitted move may finish'});render();};
    shell.body.querySelector('[data-done]').onclick=()=>{queue.clearDone();render();};
  }
  render();
};