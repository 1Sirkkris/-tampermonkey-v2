V3.boot = () => {
  const VERSION=V3.build.version;
  const life=V3.lifecycle.create('aft-suite');
  const telemetry=V3.telemetry.create('aft',VERSION);
  const settings=V3.storage.create('aft.settings');
  let stopRequested=false,busy=false;
  const client=V3.aft.create({origin:location.origin,telemetry,life,stopped:()=>stopRequested});
  const shell=V3.ui.createShell({
    id:'bwu2-v3-aft',title:'BWU2 V3 AFT',subtitle:'Edit · Move · FCSKU',version:VERSION,life,
    tabs:[{id:'move',label:'MOVE'},{id:'edit',label:'EDIT'},{id:'fcsku',label:'FCSKU'},{id:'obs',label:'OBS'}],
    onTab:tab=>{settings.set('tab',tab);render();}
  });
  V3.screenshot.install({life,roots:[shell.host]});
  let tab=settings.get('tab','move');
  if(!['move','edit','fcsku','obs'].includes(tab))tab='move';

  const setStatus=(text,tone='')=>{shell.setStatus(text,tone);telemetry.emit('status',{tab,text});};
  const readyWorkflow=async(key)=>{
    const def=V3.aft.DEFINITIONS[key];
    let wf=await client.bootstrap(def);
    if(wf.selector)return client.ensureMode(key);
    return client.ensureReady(def,wf);
  };
  const confirmLoop=async(workflow,def,ref)=>{
    for(let round=1;round<=10;round++){
      setStatus('CONFIRM '+round,'work');
      const op=V3.operation.create({kind:'aft-confirm',ref,telemetry});
      await client.confirm(workflow,def,{operation:op,timeout:300000});
      op.confirmed({round});
      const snap=await client.snapshot(workflow,def,'After confirm '+round,V3.aft.classifyEdit);
      if(snap.state==='error')throw new Error('EditItems returned error after confirm');
      if(snap.state!=='confirm')return snap;
    }
    throw new Error('Too many confirmation rounds');
  };
  const targetState=async(workflow,def,state,damage,ref)=>{
    await client.input(workflow,def,V3.aft.mapState(state),'Target state',{timeout:120000});
    if(V3.aft.mapState(state)==='UNSELLABLE'){
      await client.input(workflow,def,V3.aft.mapDamage(damage),'Target disposition',{timeout:120000});
    }
  };

  async function runMove(){
    const source=V3.base.clean(shell.body.querySelector('[data-source]')?.value);
    const dest=V3.base.clean(shell.body.querySelector('[data-dest]')?.value);
    const items=V3.base.lines(shell.body.querySelector('[data-items]')?.value);
    const qtyMode=shell.body.querySelector('[data-qty-mode]')?.value||'ALL';
    const userQty=Number(shell.body.querySelector('[data-qty]')?.value);
    if(!V3.base.validContainer(source)||!V3.base.validContainer(dest))throw new Error('Source and destination must be tsX/csX');
    if(V3.base.upper(source)===V3.base.upper(dest))throw new Error('Source and destination cannot match');
    if(!items.length)throw new Error('Need item barcodes');
    if(qtyMode==='QTY'&&(!Number.isInteger(userQty)||userQty<1))throw new Error('Enter QTY 1+');

    const def=V3.aft.DEFINITIONS['move:multi'];
    let workflow=await client.ensureMode('move:multi');
    await client.input(workflow,def,source,'Source');
    const results=[];
    for(let i=0;i<items.length;i++){
      if(stopRequested)throw new Error('Stopped before next item');
      const code=items[i];setStatus((i+1)+'/'+items.length+' ITEM','work');
      await client.input(workflow,def,code,'Item '+(i+1));
      const page=await client.page(def,'Quantity page '+(i+1));
      if(page.objectId!==workflow.objectId)throw new Error('Quantity page workflow changed');
      const info=V3.aft.readMoveQuantity(page.html);
      if(!Number.isInteger(info.qty)){
        telemetry.emit('aft.quantity.missing',{item:V3.telemetry.mask(code),verify:info.verify,text:V3.base.clean(page.text).slice(0,240)});
        throw new Error('Quantity unavailable for '+code+(info.verify?' — VERIFY ITEM screen':''));
      }
      const qty=qtyMode==='EACH'?1:qtyMode==='QTY'?userQty:info.qty;
      if(qty>info.qty)throw new Error(code+' requested '+qty+' > available '+info.qty);
      await client.input(workflow,def,String(qty),'Quantity '+(i+1));

      const op=V3.operation.create({kind:'aft-move-destination',ref:code,telemetry});
      try{
        await client.input(workflow,def,dest,'Destination '+(i+1),{operation:op,timeout:30000});
        op.confirmed({qty,available:info.qty});
        results.push({code,qty,state:'done'});
      }catch(error){
        if(error?.outcome==='unknown')results.push({code,qty,state:'unknown'});
        throw error;
      }
      setStatus((i+1)+'/'+items.length+' MOVED','');
    }
    await client.done(workflow,def);
    await client.end(workflow,def);
    telemetry.emit('move.done',{count:results.length});
    return results;
  }

  async function runEach(){
    const rows=String(shell.body.querySelector('[data-each-rows]')?.value||'').split(/\r?\n/).map(V3.base.clean).filter(Boolean).map(line=>{
      const [location='',asin='',fnsku='']=line.split(/\s+/);
      return{location,asin,fnsku:fnsku||asin};
    }).filter(x=>x.location&&x.fnsku);
    const state=shell.body.querySelector('[data-each-state]')?.value||'Unsellable';
    const damage=shell.body.querySelector('[data-each-damage]')?.value||'Defective';
    if(!rows.length)throw new Error('Paste Location ASIN FNSKU rows');
    const def=V3.aft.DEFINITIONS['edit:each'];
    let workflow=await client.ensureMode('edit:each');

    for(let i=0;i<rows.length;i++){
      if(stopRequested)throw new Error('Stopped before next row');
      const item=rows[i];
      if(i>0)workflow=await readyWorkflow('edit:each');
      setStatus((i+1)+'/'+rows.length+' LOCATION','work');
      await client.input(workflow,def,item.location,'Location');
      await client.input(workflow,def,item.fnsku,'Item');
      const afterItem=await client.snapshot(workflow,def,'After item',V3.aft.classifyEdit);
      if(afterItem.state==='sourceState')throw new Error(item.fnsku+': source state could not be inferred');
      if(afterItem.state!=='newState')throw new Error(item.fnsku+': expected new state, got '+afterItem.state);
      await targetState(workflow,def,state,damage,item.fnsku);
      const final=await confirmLoop(workflow,def,item.fnsku);
      if(final.state==='success')await client.done(workflow,def);
      else if(final.state!=='item')throw new Error(item.fnsku+': expected success/item, got '+final.state);
      await client.end(workflow,def);
      telemetry.emit('edit.each.done',{item:V3.telemetry.mask(item.fnsku),location:V3.telemetry.mask(item.location)});
    }
  }

  async function runSku(){
    const sku=V3.base.clean(shell.body.querySelector('[data-sku]')?.value);
    const currentState=shell.body.querySelector('[data-current-state]')?.value||'Sellable';
    const currentDamage=shell.body.querySelector('[data-current-damage]')?.value||'Defective';
    const desiredState=shell.body.querySelector('[data-desired-state]')?.value||'Unsellable';
    const desiredDamage=shell.body.querySelector('[data-desired-damage]')?.value||'Defective';
    if(!sku)throw new Error('Enter SKU / ASIN / FNSKU / FCSKU');
    const wanted=V3.aft.mapState(currentState);
    const wantedChoice=wanted==='INVENTORY'?'SELLABLE':wanted;
    const def=V3.aft.DEFINITIONS['edit:sku'];
    let workflow=await client.ensureMode('edit:sku');

    for(let attempt=1;attempt<=50;attempt++){
      if(stopRequested)throw new Error('Stopped before next attempt');
      if(attempt>1)workflow=await readyWorkflow('edit:sku');
      setStatus('SKU '+attempt+' LOOKUP','work');
      await client.input(workflow,def,sku,'SKU');
      const source=await client.snapshot(workflow,def,'Source state',V3.aft.classifyEdit);
      if(source.state==='retryError')throw new Error('AFT consumer-type retry error');
      if(source.state!=='sourceState')throw new Error('Expected sourceState, got '+source.state);
      const choices=V3.aft.readSourceChoices(source.doc);
      const matches=choices.filter(x=>x.state===wantedChoice&&!x.disabled);
      if(matches.length!==1){
        const available=choices.map(x=>x.state+':'+(x.qty??'?')).join(', ');
        throw new Error('Source '+wanted+' ambiguous/unavailable · '+available);
      }
      const selected=matches[0];
      paintQty(choices);
      if(selected.qty===0){await client.end(workflow,def);setStatus('DONE · 0 '+currentState+' remaining','');return;}
      if(!Number.isInteger(selected.qty))throw new Error('Could not read '+currentState+' quantity');
      await client.input(workflow,def,selected.value||wanted,'Source state',{timeout:120000});
      if(wanted==='UNSELLABLE')await client.input(workflow,def,V3.aft.mapDamage(currentDamage),'Source disposition',{timeout:120000});
      const afterSource=await client.snapshot(workflow,def,'After source',V3.aft.classifyEdit);
      if(afterSource.state!=='newState')throw new Error('Expected newState, got '+afterSource.state);
      await targetState(workflow,def,desiredState,desiredDamage,sku);
      const final=await confirmLoop(workflow,def,sku);
      if(final.state!=='success')throw new Error('Expected success, got '+final.state);
      await client.done(workflow,def);
      await client.end(workflow,def);
      telemetry.emit('edit.sku.flip',{sku:V3.telemetry.mask(sku),attempt,startQty:selected.qty});
    }
    throw new Error('Stopped after 50 SKU attempts');
  }

  async function runFcsku(){
    const oldCode=V3.base.clean(shell.body.querySelector('[data-old]')?.value);
    const newCode=V3.base.clean(shell.body.querySelector('[data-new]')?.value);
    const locations=V3.base.lines(shell.body.querySelector('[data-locations]')?.value);
    if(!oldCode||!newCode)throw new Error('Need OLD + NEW FCSKU');
    if(!locations.length)throw new Error('Need locations/containers');
    const def=V3.aft.DEFINITIONS['edit:fcsku'];
    let workflow=await client.ensureMode('edit:fcsku');
    for(let i=0;i<locations.length;i++){
      if(stopRequested)throw new Error('Stopped before next location');
      if(i>0)workflow=await readyWorkflow('edit:fcsku');
      const location=locations[i];setStatus((i+1)+'/'+locations.length+' CONTAINER','work');
      await client.input(workflow,def,location,'Container');
      await client.input(workflow,def,oldCode,'OLD');
      await client.input(workflow,def,newCode,'NEW');
      const op=V3.operation.create({kind:'aft-fcsku-confirm',ref:location,telemetry});
      await client.confirm(workflow,def,{operation:op,timeout:30000});
      op.confirmed();
      await client.end(workflow,def);
      telemetry.emit('fcsku.done',{location:V3.telemetry.mask(location),old:V3.telemetry.mask(oldCode),neu:V3.telemetry.mask(newCode)});
    }
  }

  function paintQty(choices){
    const values={SELLABLE:'—',PENDING_RESEARCH:'—',UNSELLABLE:'—'};
    for(const choice of choices)if(choice.state in values&&Number.isInteger(choice.qty))values[choice.state]=choice.qty;
    for(const [key,selector] of [['SELLABLE','[data-qs]'],['PENDING_RESEARCH','[data-qp]'],['UNSELLABLE','[data-qu]']]){
      const el=shell.body.querySelector(selector);if(el)el.textContent=values[key];
    }
  }
  const stateOptions=selected=>['Sellable','Pending Research','Unsellable'].map(v=>'<option'+(v===selected?' selected':'')+'>'+v+'</option>').join('');
  const damageOptions=selected=>['Amazon Damage','Defective','Distributor Damage','Expired'].map(v=>'<option'+(v===selected?' selected':'')+'>'+v+'</option>').join('');

  function render(){
    if(shell.tab!==tab){shell.select(tab);return;}
    if(tab==='move')renderMove();
    else if(tab==='edit')renderEdit();
    else if(tab==='fcsku')renderFcsku();
    else renderObs();
  }
  function run(task){
    if(busy)return;busy=true;stopRequested=false;setStatus('RUNNING','work');render();
    Promise.resolve().then(task).then(()=>setStatus('DONE','')).catch(error=>{
      const unknown=error?.outcome==='unknown';
      setStatus(unknown?'UNKNOWN':'STOPPED',unknown?'bad':'warn');
      telemetry.emit('run.error',{tab,message:String(error?.message||error),unknown});
      appendMessage((unknown?'OUTCOME UNKNOWN — VERIFY BEFORE RETRY\n':'')+String(error?.message||error));
    }).finally(()=>{busy=false;render();});
  }
  function appendMessage(text){settings.set('lastMessage',String(text||''));}
  const lastMessage=()=>settings.get('lastMessage','');

  function controls(){
    return'<div class="v3-row"><button class="v3-btn primary" data-run '+(busy?'disabled':'')+'>RUN</button><button class="v3-btn danger" data-stop>STOP AFTER CURRENT</button></div>'+
      (lastMessage()?'<div class="v3-note" style="margin-top:7px;white-space:pre-wrap">'+V3.base.esc(lastMessage())+'</div>':'');
  }
  function renderMove(){
    const root=document.createElement('div');
    root.innerHTML='<section class="v3-section"><h3>MoveItems</h3>'+
      '<label class="v3-field">Mode<select data-qty-mode><option>ALL</option><option>EACH</option><option>QTY</option></select></label>'+
      '<label class="v3-field">QTY (used only in QTY mode)<input data-qty type="number" min="1" value="1"></label>'+
      '<label class="v3-field">Source<input data-source autocomplete="off"></label>'+
      '<label class="v3-field">Destination<input data-dest autocomplete="off"></label>'+
      '<label class="v3-field">Items<textarea data-items class="v3-input"></textarea></label>'+controls()+'</section>';
    shell.setContent(root);wire(()=>runMove());
  }
  function renderEdit(){
    const root=document.createElement('div');
    root.innerHTML='<section class="v3-section"><h3>EditItems</h3><div class="v3-row"><button class="v3-btn" data-edit-mode="each">EACH</button><button class="v3-btn" data-edit-mode="sku">SKU</button></div></section>'+
      '<section class="v3-section" data-each><h3>EACH · Location ASIN FNSKU</h3><label class="v3-field">Rows<textarea data-each-rows class="v3-input"></textarea></label>'+
      '<div class="v3-grid"><label class="v3-field">Target state<select data-each-state>'+stateOptions('Unsellable')+'</select></label><label class="v3-field">Disposition<select data-each-damage>'+damageOptions('Defective')+'</select></label></div>'+
      '<div data-each-controls>'+controls()+'</div></section>'+
      '<section class="v3-section" data-sku hidden><h3>SKU loop</h3>'+
      '<div class="v3-row"><span class="v3-note">SELLABLE <b data-qs>—</b></span><span class="v3-note">PENDING <b data-qp>—</b></span><span class="v3-note">UNSELL <b data-qu>—</b></span></div>'+
      '<label class="v3-field">SKU<input data-sku></label>'+
      '<div class="v3-grid"><label class="v3-field">Current<select data-current-state>'+stateOptions('Sellable')+'</select></label><label class="v3-field">Current disposition<select data-current-damage>'+damageOptions('Defective')+'</select></label>'+
      '<label class="v3-field">Desired<select data-desired-state>'+stateOptions('Unsellable')+'</select></label><label class="v3-field">Desired disposition<select data-desired-damage>'+damageOptions('Defective')+'</select></label></div>'+
      '<div data-sku-controls>'+controls()+'</div></section>';
    shell.setContent(root);
    let mode=settings.get('editMode','each');
    const paint=()=>{root.querySelector('[data-each]').hidden=mode!=='each';root.querySelector('[data-sku]').hidden=mode!=='sku';};
    for(const button of root.querySelectorAll('[data-edit-mode]'))button.onclick=()=>{mode=button.dataset.editMode;settings.set('editMode',mode);paint();};
    paint();
    for(const runButton of root.querySelectorAll('[data-run]'))runButton.onclick=()=>run(mode==='each'?runEach:runSku);
    for(const stop of root.querySelectorAll('[data-stop]'))stop.onclick=()=>{stopRequested=true;setStatus('STOP REQUESTED','warn');};
  }
  function renderFcsku(){
    const root=document.createElement('div');
    root.innerHTML='<section class="v3-section"><h3>FCSKU Flip</h3>'+
      '<label class="v3-field">OLD FCSKU<input data-old></label><label class="v3-field">NEW FCSKU<input data-new></label>'+
      '<label class="v3-field">Locations / containers<textarea data-locations class="v3-input"></textarea></label>'+controls()+'</section>';
    shell.setContent(root);wire(()=>runFcsku());
  }
  function renderObs(){
    const root=document.createElement('div');
    root.innerHTML='<section class="v3-section"><h3>AFT telemetry</h3><button class="v3-btn" data-export>EXPORT</button><button class="v3-btn danger" data-clear>CLEAR</button><pre class="v3-log">'+V3.base.esc(JSON.stringify(telemetry.list().slice(-30),null,2))+'</pre></section>';
    shell.setContent(root);
    root.querySelector('[data-export]').onclick=()=>{
      const blob=new Blob([telemetry.exportText()],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='BWU2_V3_AFT_OBS_'+Date.now()+'.json';a.click();URL.revokeObjectURL(a.href);
    };
    root.querySelector('[data-clear]').onclick=()=>{telemetry.clear();render();};
  }
  function wire(task){
    const runButton=shell.body.querySelector('[data-run]');if(runButton)runButton.onclick=()=>run(task);
    const stop=shell.body.querySelector('[data-stop]');if(stop)stop.onclick=()=>{stopRequested=true;setStatus('STOP REQUESTED','warn');};
  }

  shell.select(tab);
  render();
};