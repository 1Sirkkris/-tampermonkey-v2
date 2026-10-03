V3.boot = () => {
  const VERSION=V3.build.version;
  const life=V3.lifecycle.create('aft-suite');
  const telemetry=V3.telemetry.create('aft',VERSION);
  const settings=V3.storage.create('aft.settings');
  let busy=false,stopRequested=false,lastMessage='';
  let tab=/\/moveitems/i.test(location.pathname)?'move':/\/fcskuflip/i.test(location.pathname)?'fcsku':settings.get('tab','edit');
  if(!['move','edit','fcsku','obs'].includes(tab))tab='edit';
  const qtyHistory=[];

  const client=V3.aft.create({origin:location.origin,telemetry,life,stopped:()=>stopRequested});
  const workflows=V3.aftWorkflows.create({
    client,telemetry,stopped:()=>stopRequested,
    onProgress:(message,data)=>{shell.setStatus(message,'work');telemetry.emit('aft.ui.progress',{tab,message,...data});},
    onQuantity:value=>{qtyHistory.push({...value,at:Date.now()});if(qtyHistory.length>12)qtyHistory.shift();if(tab==='edit')render();}
  });

  const shell=V3.ui.createShell({
    id:'bwu2-v3-aft',title:'BWU2 V3 AFT',subtitle:'Edit · Move · FCSKU',version:VERSION,life,
    tabs:[{id:'move',label:'MOVE'},{id:'edit',label:'EDIT'},{id:'fcsku',label:'FCSKU'},{id:'obs',label:'OBS'}],
    onTab:next=>{if(busy){shell.select(tab);return;}tab=next;settings.set('tab',tab);render();}
  });
  V3.screenshot.install({life,roots:[shell.host]});

  const stateOptions=selected=>['Sellable','Pending Research','Unsellable'].map(v=>'<option'+(v===selected?' selected':'')+'>'+v+'</option>').join('');
  const damageOptions=selected=>['Amazon Damage','Defective','Distributor Damage','Expired'].map(v=>'<option'+(v===selected?' selected':'')+'>'+v+'</option>').join('');
  const controls=()=>'<div class="v3-row"><button class="v3-btn primary" data-run '+(busy?'disabled':'')+'>RUN</button><button class="v3-btn danger" data-stop>STOP AFTER CURRENT</button></div>'+
    (lastMessage?'<div class="v3-note" style="margin-top:7px;white-space:pre-wrap">'+V3.base.esc(lastMessage)+'</div>':'');

  function wire(host,task){
    host.querySelector('[data-run]').onclick=()=>runTask(task);
    host.querySelector('[data-stop]').onclick=()=>{stopRequested=true;shell.setStatus('STOP REQUESTED','warn');};
  }
  function runTask(task){
    if(busy)return;
    busy=true;stopRequested=false;lastMessage='';shell.setStatus('RUNNING','work');render();
    Promise.resolve().then(task).then(result=>{
      lastMessage='DONE';shell.setStatus('DONE','');telemetry.emit('aft.ui.done',{tab,result:V3.telemetry.sanitize(result)});
    }).catch(error=>{
      const unknown=error?.outcome==='unknown';
      lastMessage=(unknown?'OUTCOME UNKNOWN — VERIFY BEFORE RETRY · ':'')+String(error?.message||error);
      shell.setStatus(unknown?'UNKNOWN':'STOPPED',unknown?'bad':'warn');
      telemetry.emit('aft.ui.error',{tab,message:String(error?.message||error),unknown});
    }).finally(()=>{busy=false;render();});
  }

  function renderMove(){
    const root=document.createElement('div');
    root.innerHTML='<section class="v3-section"><h3>MoveItems</h3>'+
      '<label class="v3-field">Mode<select data-mode><option>ALL</option><option>EACH</option><option>QTY</option></select></label>'+
      '<label class="v3-field">QTY<input data-qty type="number" min="1" value="1"></label>'+
      '<label class="v3-field">Source<input data-source autocomplete="off"></label>'+
      '<label class="v3-field">Destination<input data-dest autocomplete="off"></label>'+
      '<label class="v3-field">Items<textarea class="v3-input" data-items></textarea></label>'+controls()+'</section>';
    shell.setContent(root);
    wire(root,()=>workflows.move({
      source:root.querySelector('[data-source]').value,destination:root.querySelector('[data-dest]').value,
      items:V3.base.lines(root.querySelector('[data-items]').value,{dedupe:false}),
      qtyMode:root.querySelector('[data-mode]').value,quantity:Number(root.querySelector('[data-qty]').value)
    }));
  }

  function renderEdit(){
    const mode=settings.get('editMode','sku');
    const root=document.createElement('div');
    root.innerHTML='<section class="v3-section"><div class="v3-row"><button class="v3-btn '+(mode==='each'?'primary':'')+'" data-edit-mode="each">EACH</button><button class="v3-btn '+(mode==='sku'?'primary':'')+'" data-edit-mode="sku">SKU</button></div></section>'+
      (mode==='each'
        ? '<section class="v3-section"><h3>Edit EACH</h3><label class="v3-field">Location ASIN FNSKU rows<textarea class="v3-input" data-rows></textarea></label>'+
          '<div class="v3-grid"><label class="v3-field">Target<select data-target>'+stateOptions('Unsellable')+'</select></label><label class="v3-field">Disposition<select data-damage>'+damageOptions('Defective')+'</select></label></div>'+controls()+'</section>'
        : '<section class="v3-section"><h3>Edit SKU</h3>'+
          '<div class="v3-row" style="margin-bottom:8px">'+(qtyHistory.slice(-3).map(q=>'<span class="v3-note">S '+(q.sellable??'—')+' · P '+(q.pending??'—')+' · U '+(q.unsellable??'—')+'</span>').join('')||'<span class="v3-note">Quantity history appears here.</span>')+'</div>'+
          '<label class="v3-field">SKU<input data-sku autocomplete="off"></label>'+
          '<div class="v3-grid"><label class="v3-field">Current<select data-current>'+stateOptions('Sellable')+'</select></label><label class="v3-field">Current disposition<select data-current-damage>'+damageOptions('Defective')+'</select></label>'+
          '<label class="v3-field">Desired<select data-desired>'+stateOptions('Unsellable')+'</select></label><label class="v3-field">Desired disposition<select data-desired-damage>'+damageOptions('Defective')+'</select></label></div>'+controls()+'</section>');
    shell.setContent(root);
    for(const button of root.querySelectorAll('[data-edit-mode]'))button.onclick=()=>{if(busy)return;settings.set('editMode',button.dataset.editMode);render();};
    if(mode==='each')wire(root,()=>{
      const rows=String(root.querySelector('[data-rows]').value||'').split(/\r?\n/).map(V3.base.clean).filter(Boolean).map(line=>{
        const [location='',asin='',fnsku='']=line.split(/\s+/);return{location,asin,fnsku:fnsku||asin};
      });
      return workflows.editEach({rows,desiredState:root.querySelector('[data-target]').value,desiredDamage:root.querySelector('[data-damage]').value});
    });
    else wire(root,()=>workflows.editSku({
      sku:root.querySelector('[data-sku]').value,currentState:root.querySelector('[data-current]').value,
      currentDamage:root.querySelector('[data-current-damage]').value,desiredState:root.querySelector('[data-desired]').value,
      desiredDamage:root.querySelector('[data-desired-damage]').value
    }));
  }

  function renderFcsku(){
    const root=document.createElement('div');
    root.innerHTML='<section class="v3-section"><h3>FCSKU Flip</h3>'+
      '<label class="v3-field">OLD FCSKU<input data-old autocomplete="off"></label>'+
      '<label class="v3-field">NEW FCSKU<input data-new autocomplete="off"></label>'+
      '<label class="v3-field">Locations / containers<textarea class="v3-input" data-locations></textarea></label>'+controls()+'</section>';
    shell.setContent(root);
    wire(root,()=>workflows.fcsku({
      oldCode:root.querySelector('[data-old]').value,newCode:root.querySelector('[data-new]').value,
      locations:V3.base.lines(root.querySelector('[data-locations]').value)
    }));
  }

  function renderObs(){
    const events=telemetry.list(),root=document.createElement('div');
    root.innerHTML='<section class="v3-section"><h3>AFT OBS</h3><div class="v3-note">'+V3.base.esc(V3.build.id)+' · '+events.length+' events</div>'+
      '<div class="v3-row" style="margin-top:8px"><button class="v3-btn" data-export>EXPORT</button><button class="v3-btn danger" data-clear>CLEAR</button></div></section>'+
      '<section class="v3-section"><pre class="v3-log">'+V3.base.esc(JSON.stringify(events.slice(-80),null,2))+'</pre></section>';
    shell.setContent(root);
    root.querySelector('[data-export]').onclick=()=>{
      const blob=new Blob([telemetry.exportText()],{type:'application/json'}),a=document.createElement('a');
      a.href=URL.createObjectURL(blob);a.download='BWU2_V3_AFT_OBS_'+Date.now()+'.json';a.click();URL.revokeObjectURL(a.href);
    };
    root.querySelector('[data-clear]').onclick=()=>{telemetry.clear();renderObs();};
  }

  function render(){
    if(shell.tab!==tab){shell.select(tab);return;}
    if(tab==='move')renderMove();
    else if(tab==='edit')renderEdit();
    else if(tab==='fcsku')renderFcsku();
    else renderObs();
  }

  shell.select(tab);
  render();
};