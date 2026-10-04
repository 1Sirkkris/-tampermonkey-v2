V3.boot=()=>{
  const life=V3.lifecycle.create('move-native'),telemetry=V3.telemetry.create('move',V3.build.version),control={stop:false};
  let ui=null;
  const panel=V3.ui.panel({id:'bwu2-v3-move-panel',title:'V3 · MoveItems',width:560,life});
  const mount=()=>{if(ui)return;const client=V3.aft.create({origin:location.origin,telemetry,life,stopped:()=>control.stop});const workflows=V3.aftWorkflows.create({client,telemetry,stopped:()=>control.stop});ui=V3.moveUi.mount(panel.body,{workflows,control,title:'MoveItems'});};
  V3.ui.dockButton({id:'move',label:'MOVE',title:'V3 MoveItems',onClick:()=>{mount();panel.open();}});
};