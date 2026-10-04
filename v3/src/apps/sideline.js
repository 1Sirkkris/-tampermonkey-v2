V3.boot=()=>{
  if(location.hash==='#iss-console')return;
  const C=V3.core,life=C.lifecycle('sideline-native'),telemetry=C.telemetry('sideline',V3.build.version),engine=V3.sideline.create({life,telemetry}),panel=C.panel({id:'sideline-native',title:'V3 · Sideline',width:720,life});
  let mounted=false,ui=null;
  C.dockButton({id:'sideline-native',label:'SIDELINE',title:'V3 Sideline',onClick:()=>{
    if(!mounted){mounted=true;const root=document.createElement('div');panel.set(root);ui=V3.sidelineNative.mountModes(root,{engine,life,title:'Sideline',prefix:'native.sideline'});}
    panel.open();
  }});
  const quantity=C.panel({id:'sideline-qty',title:'V3 · QTY QUICK SELECT',width:480,life});let qtyUI=null;
  C.dockButton({id:'sideline-qty',label:'QTY',title:'Native quantity helper',onClick:()=>{if(!qtyUI){const root=document.createElement('div');quantity.set(root);qtyUI=V3.sidelineNative.mountQuantity(root,{life});}if(quantity.el.hidden)quantity.open();else quantity.close();}});
  V3.sidelineNative.dateHelper({engine,life});
  life.own(()=>{ui?.dispose?.();qtyUI?.dispose?.();});
};
