V3.boot=()=>{
  const C=V3.core,life=C.lifecycle('movecontainer'),telemetry=C.telemetry('movecontainer',V3.build.version),queue=C.queue({name:'movecontainer',life}),panel=C.panel({id:'movecontainer',title:'V3 · MoveContainer',width:620,life});
  let mounted=false,busy=false,floor='P2',drop='PRIME',lockedDestination='';
  const draw=async()=>{
    await queue.load();const s=queue.state,root=document.createElement('div');
    const choices=['<option value="PRIME">PRIME</option>',...V3.actions.dropChoices(floor).map(x=>'<option value="'+C.esc(x.key)+'"'+(x.key===drop?' selected':'')+'>'+C.esc(x.label)+'</option>')].join('');
    root.innerHTML='<section class="v3-section"><div class="v3-grid"><label class="v3-field">Floor<select data-floor>'+V3.actions.FLOORS.map(x=>'<option'+(x===floor?' selected':'')+'>'+x+'</option>').join('')+'</select></label><label class="v3-field">Dropzone<select data-drop>'+choices+'</select></label></div><label class="v3-field">Containers<textarea data-input placeholder="tsX...\ncsX..."></textarea></label><div class="v3-row"><button class="v3-btn" data-add>ADD</button><button class="v3-btn primary" data-run>RUN</button><button class="v3-btn" data-pause>PAUSE</button><button class="v3-btn" data-done>CLEAR DONE</button></div><div class="v3-note" data-msg>'+(s.running?'LOCKED → '+C.esc(lockedDestination||s.destination||'')+' · ':'')+C.esc(s.message||'Ready')+'</div></section><section class="v3-section"><div data-list></div></section>';
    panel.set(root);root.querySelector('[data-list]').innerHTML=s.items.map(x=>'<div class="v3-list-row"><b>'+C.esc(x.id)+'</b> · '+C.esc(x.status.toUpperCase())+(x.error?' · <span class="v3-bad">'+C.esc(x.error)+'</span>':'')+'</div>').join('')||'<div class="v3-note">Queue empty.</div>';
    const floorEl=root.querySelector('[data-floor]'),dropEl=root.querySelector('[data-drop]');floorEl.disabled=dropEl.disabled=s.running;floorEl.onchange=()=>{floor=floorEl.value;if(drop!=='PRIME'&&!V3.actions.dropChoices(floor).some(x=>x.key===drop))drop='PRIME';draw();};dropEl.onchange=()=>{drop=dropEl.value;};
    root.querySelector('[data-add]').onclick=async()=>{await queue.add(C.lines(root.querySelector('[data-input]').value));draw();};
    root.querySelector('[data-run]').onclick=async()=>{if(s.items.some(x=>x.status==='attention')){await queue.set({message:'Resolve ATTENTION before RUN'});return draw();}lockedDestination=V3.actions.destination(floor,drop);if(!lockedDestination){await queue.set({message:'Select destination first'});return draw();}await queue.set({running:true,destination:lockedDestination,message:'Running'});draw();pump();};
    root.querySelector('[data-pause]').onclick=async()=>{await queue.set({running:false,message:'Pause requested'});draw();};
    root.querySelector('[data-done]').onclick=async()=>{await queue.clearDone();draw();};
  };
  const pump=async()=>{
    if(busy||!queue.state.running)return;if(!queue.acquire()){await queue.set({running:false,message:'Queue active in another tab'});return draw();}
    const row=queue.next();if(!row){await queue.set({running:false,current:'',phase:'idle',message:'Queue complete'});lockedDestination='';queue.release();return draw();}
    busy=true;await queue.item(row,{status:'active',phase:'move',error:''});await queue.set({current:row.id,phase:'move',message:'Moving '+row.id});draw();
    try{await V3.actions.moveContainer(row.id,lockedDestination||queue.state.destination,{telemetry});await queue.item(row,{status:'done',phase:'done'});await queue.set({current:'',phase:'idle',message:'MOVED '+row.id});}
    catch(error){const unknown=error?.outcome==='unknown'||error instanceof C.UnknownError;await queue.item(row,{status:unknown?'attention':'rejected',phase:'',error:unknown?'OUTCOME UNKNOWN — VERIFY BEFORE RETRY':C.clean(error.message||error)});await queue.set({running:false,current:'',phase:'idle',message:C.clean(error.message||error)});}
    finally{busy=false;if(!queue.state.running)queue.release();draw();}
    if(queue.state.running)life.timeout(pump,180);
  };
  C.dockButton({id:'movecontainer',label:'MOVE',title:'V3 MoveContainer',onClick:()=>{if(!mounted)mounted=true;draw();panel.open();}});
};
