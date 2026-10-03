V3.boot = () => {
  const VERSION=V3.build.version;
  const life=V3.lifecycle.create('fcr-suite');
  const telemetry=V3.telemetry.create('fcr',VERSION);

  if(location.hostname==='river.amazon.com'){
    V3.fcrRiver.bootRiverHost({life,telemetry});
    return;
  }

  const client=V3.fcr.create({telemetry,life});
  const settings=V3.storage.create('fcr.shell');
  const tabs=[
    {id:'fcr',label:'FCR'},
    {id:'tote',label:'TOTE'},
    {id:'iss',label:'ISS'},
    {id:'river',label:'RIVER'},
    {id:'obs',label:'OBS'}
  ];
  let active=settings.get('tab','fcr');
  if(!tabs.some(tab=>tab.id===active))active='fcr';

  const shell=V3.ui.createShell({
    id:'bwu2-v3-fcr',
    title:'BWU2 V3 FCResearch',
    subtitle:'FCR · Tote · ISS · RIVER',
    version:VERSION,
    life,
    tabs,
    onTab:tab=>{
      active=tab;
      settings.set('tab',tab);
      render();
    }
  });
  V3.screenshot.install({life,roots:[shell.host]});

  const modules=Object.create(null);
  let nativeAutoloaded=false;

  function getModule(name){
    if(modules[name])return modules[name];
    if(name==='fcr')modules[name]=V3.fcrNative.create({life,client,telemetry,shell});
    else if(name==='tote')modules[name]=V3.fcrTote.create({life,client,telemetry,shell});
    else if(name==='iss')modules[name]=V3.fcrIss.create({life,telemetry,shell});
    else if(name==='river')modules[name]=V3.fcrRiver.createCapture({life,client,telemetry,shell});
    return modules[name];
  }

  function renderObs(){
    const events=telemetry.list();
    const root=document.createElement('div');
    root.innerHTML=
      '<section class="v3-section"><h3>OBS / Diagnostics</h3>'+
        '<div class="v3-note"><b>Build</b><br>'+V3.base.esc(V3.build.id)+'</div>'+
        '<div class="v3-note" style="margin-top:5px"><b>Events</b> '+events.length+'</div>'+
        '<div class="v3-row" style="margin-top:8px"><button class="v3-btn" data-export>EXPORT</button><button class="v3-btn danger" data-clear>CLEAR</button></div>'+
      '</section>'+
      '<section class="v3-section"><pre class="v3-log">'+V3.base.esc(JSON.stringify(events.slice(-80),null,2))+'</pre></section>';
    shell.setContent(root);
    root.querySelector('[data-export]').onclick=()=>{
      const blob=new Blob([telemetry.exportText()],{type:'application/json'});
      const a=document.createElement('a');
      a.href=URL.createObjectURL(blob);
      a.download='BWU2_V3_FCR_OBS_'+Date.now()+'.json';
      a.click();
      URL.revokeObjectURL(a.href);
    };
    root.querySelector('[data-clear]').onclick=()=>{telemetry.clear();renderObs();};
  }

  function render(){
    if(shell.tab!==active){
      shell.select(active);
      return;
    }
    if(active==='obs'){renderObs();return;}
    const module=getModule(active);
    module.render();
    if(active==='fcr'&&!nativeAutoloaded){
      nativeAutoloaded=true;
      const code=V3.base.clean(new URLSearchParams(location.search).get('s'));
      if(code)life.timeout(()=>module.load(),0);
    }
  }

  const syncUrl=()=>{
    const module=modules.fcr;
    if(!module)return;
    const next=V3.base.clean(new URLSearchParams(location.search).get('s'));
    if(next&&next!==module.state.code){
      module.state.code=next;
      nativeAutoloaded=false;
      if(active==='fcr')render();
    }
  };
  life.on(window,'hashchange',syncUrl);
  life.on(window,'popstate',syncUrl);
  try{life.on(window,'urlchange',syncUrl);}catch{}

  shell.select(active);
  render();
};