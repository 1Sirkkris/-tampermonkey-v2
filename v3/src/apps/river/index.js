V3.boot=()=>{
  const life=V3.lifecycle.create('river');
  const telemetry=V3.telemetry.create('river',V3.build.version);
  const store=V3.storage.create('river',1);

  if(location.hostname==='river.amazon.com'){
    const assistant=V3.riverAssistant.create({life,telemetry,store});
    V3.ui.dockButton({id:'river',label:'RIVER',title:'V3 RIVER Assistant',onClick:assistant.open});
    return;
  }

  const capture=V3.riverCapture.create({life,telemetry,store});
  V3.ui.dockButton({id:'river',label:'RIVER',title:'RIVER capture',onClick:capture.open});
};