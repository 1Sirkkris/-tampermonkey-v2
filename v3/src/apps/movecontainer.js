V3.boot=()=>{
  const C=V3.core,life=C.lifecycle('movecontainer'),telemetry=C.telemetry('movecontainer',V3.build.version);
  if(location.hash==='#v3-movecontainer-worker'&&window.parent!==window){
    V3.bridge.server({family:'movecontainer',life,commands:{run:input=>V3.actions.moveContainer(input.container,input.destination,{telemetry}),resolve:()=>V3.state.resolveAttention('movecontainer')},allowed:V3.bridge.isFCR});return;
  }
  const panel=C.panel({id:'movecontainer',title:'V3 · MoveContainer',width:620,life});let mounted=false;
  const mount=()=>{if(mounted)return;mounted=true;const root=document.createElement('div');panel.set(root);
    const settings=()=>{const floor=root.querySelector('[data-floor]'),drop=root.querySelector('[data-drop]'),old=drop.value||localStorage.getItem('bwu2.v3.move.drop')||'PRIME';
      drop.innerHTML='<option value="PRIME">PRIME</option>'+V3.actions.dropChoices(floor.value).map(row=>'<option value="'+C.esc(row.key)+'">'+C.esc(row.label)+'</option>').join('');
      drop.value=[...drop.options].some(option=>option.value===old)?old:'PRIME';localStorage.setItem('bwu2.v3.move.floor',floor.value);localStorage.setItem('bwu2.v3.move.drop',drop.value);};
    V3.queueUI.mount(root,{name:'movecontainer',scope:'movecontainer',life,
      fields:'<div class="v3-grid"><label class="v3-field">Floor<select data-setting data-floor>'+V3.actions.FLOORS.map(floor=>'<option>'+floor+'</option>').join('')+'</select></label><label class="v3-field">Dropzone<select data-setting data-drop></select></label></div>',
      onSettings:settings,values:()=>({destination:V3.actions.destination(root.querySelector('[data-floor]').value,root.querySelector('[data-drop]').value)}),
      prepare:input=>{if(!input.destination)throw new Error('Select destination first');return input.destination;},
      action:(container,destination,maySubmit)=>V3.actions.moveContainer(container,destination,{telemetry,maySubmit})});
    root.querySelector('[data-floor]').value=localStorage.getItem('bwu2.v3.move.floor')||'P2';settings();
  };
  C.dockButton({id:'movecontainer',label:'MOVE',title:'V3 MoveContainer',onClick:()=>{mount();panel.open();}});
};
