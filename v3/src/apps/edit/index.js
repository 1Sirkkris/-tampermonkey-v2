V3.boot=()=>{
  const life=V3.lifecycle.create('edit-native'),telemetry=V3.telemetry.create('edit',V3.build.version),control={stop:false};
  let ui=null,workflows=null;
  const panel=V3.ui.panel({id:'bwu2-v3-edit-panel',title:'V3 · Edit Tools',width:650,life});
  const mount=()=>{if(ui)return;const client=V3.aft.create({origin:location.origin,telemetry,life,stopped:()=>control.stop});workflows=V3.aftWorkflows.create({client,telemetry,stopped:()=>control.stop,onQuantity:value=>ui?.onQuantity(value)});ui=V3.editUi.mount(panel.body,{workflows,control,title:'Edit Tools',initial:/\/fcskuflip/i.test(location.pathname)?'fcsku':'sku'});};
  V3.ui.dockButton({id:'edit',label:'EDIT',title:'V3 Edit Tools',onClick:()=>{mount();panel.open();}});
};