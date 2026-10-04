V3.boot=()=>{
  const POIROT='https://aft-poirot-website-nrt.nrt.proxy.amazon.com';
  if(location.origin!==POIROT||location.hash!=='#iss-console')return;
  const life=V3.lifecycle.create('iss'),telemetry=V3.telemetry.create('iss',V3.build.version);
  const panel=V3.ui.panel({id:'bwu2-v3-iss-panel',title:'V3 · ISS Console',width:780,life});let current=null,currentLife=null;
  const mount=name=>{
    current?.dispose?.();currentLife?.dispose?.();currentLife=V3.lifecycle.create('iss:'+name);panel.body.replaceChildren();
    const nav=document.createElement('div');nav.className='section';nav.innerHTML='<div class="row"><button class="btn" data-app="edit">EDIT</button><button class="btn" data-app="move">MOVE</button><button class="btn" data-app="sideline">SIDELINE</button><button class="btn" data-app="fcsku">FCSKU</button><button class="btn" data-exit>SIDELINE SITE</button></div>';
    const work=document.createElement('div');panel.body.append(nav,work);for(const b of nav.querySelectorAll('[data-app]')){if(b.dataset.app===name)b.classList.add('primary');b.onclick=()=>mount(b.dataset.app);}nav.querySelector('[data-exit]').onclick=()=>{location.hash='';location.reload();};
    if(name==='sideline'){const p=V3.pandash.create({telemetry,warehouse:'BWU2'}),engine=V3.sideline.create({telemetry,pandash:p});current=V3.sidelineUi.mount(work,{engine,title:'ISS Sideline'});return;}
    const control={stop:false},client=V3.aft.create({origin:'https://aft-qt-jp.aka.nrt.corp.amazon.com',telemetry,life:currentLife,stopped:()=>control.stop});let ui=null;const workflows=V3.aftWorkflows.create({client,telemetry,stopped:()=>control.stop,onQuantity:value=>ui?.onQuantity(value)});
    if(name==='move')ui=V3.moveUi.mount(work,{workflows,control,title:'ISS MoveItems'});
    else ui=V3.editUi.mount(work,{workflows,control,title:'ISS Edit Tools',initial:name==='fcsku'?'fcsku':'sku'});
    current=ui;
  };
  mount('sideline');panel.open();
};