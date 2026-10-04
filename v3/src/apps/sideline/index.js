V3.boot=()=>{
  const life=V3.lifecycle.create('sideline-native'),telemetry=V3.telemetry.create('sideline',V3.build.version);let ui=null;
  const panel=V3.ui.panel({id:'bwu2-v3-sideline-panel',title:'V3 · Sideline',width:680,life});
  const mount=()=>{if(ui)return;const pandash=V3.pandash.create({telemetry,warehouse:'BWU2'}),engine=V3.sideline.create({telemetry,pandash});ui=V3.sidelineUi.mount(panel.body,{engine,title:'Sideline'});};
  V3.ui.dockButton({id:'sideline',label:'SIDELINE',title:'V3 Sideline',onClick:()=>{mount();panel.open();}});
};