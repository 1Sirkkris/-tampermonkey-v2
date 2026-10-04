V3.boot=()=>{
  const C=V3.core,life=C.lifecycle('hierarchy'),telemetry=C.telemetry('hierarchy',V3.build.version);
  const login=()=>C.identity().login;
  if(location.hash==='#v3-hierarchy-worker'&&window.parent!==window){
    V3.bridge.server({family:'hierarchy',life,commands:{run:input=>V3.actions.unbind(input.container,login(),{telemetry}),resolve:()=>V3.state.resolveAttention('hierarchy')},allowed:V3.bridge.isFCR});return;
  }
  const bind=/\/bindHierarchy/i.test(location.pathname),panel=C.panel({id:'hierarchy',title:'V3 · '+(bind?'Bind':'Unbind'),width:600,life});let mounted=false;
  const mount=()=>{if(mounted)return;mounted=true;const root=document.createElement('div');panel.set(root);
    V3.queueUI.mount(root,{name:'hierarchy-'+(bind?'bind':'unbind'),scope:'hierarchy',life,
      fields:bind?'<label class="v3-field">Destination FC<input data-setting data-dest autocomplete="off" placeholder="BWU1 / AVV2"></label>':'',
      values:()=>({destination:root.querySelector('[data-dest]')?.value}),
      prepare:async input=>bind?V3.actions.validateDestinationNative(input.destination,{life,telemetry}):null,
      action:(container,context,maySubmit)=>bind?V3.actions.bindNative(container,context,{life,telemetry,maySubmit}):V3.actions.unbind(container,login(),{telemetry,maySubmit})});
  };
  C.dockButton({id:'hierarchy',label:bind?'BIND':'UNBIND',title:'V3 Hierarchy',onClick:()=>{mount();panel.open();}});
};
