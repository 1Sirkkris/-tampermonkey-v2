V3.boot=()=>{
  if(location.hash==='#iss-console')return;
  const C=V3.core,life=C.lifecycle('sideline-native'),telemetry=C.telemetry('sideline',V3.build.version),engine=V3.sideline.create({life,telemetry}),panel=C.panel({id:'sideline-native',title:'V3 · Sideline',width:720,life});
  let mounted=false,ui=null;
  C.dockButton({id:'sideline-native',label:'SIDELINE',title:'V3 Sideline',onClick:()=>{
    if(!mounted){mounted=true;const root=document.createElement('div');panel.set(root);ui=V3.sidelineUI.mount(root,{engine,life,title:'Sideline',prefix:'native.sideline'});}
    panel.open();
  }});
  life.own(()=>ui?.dispose?.());
};
