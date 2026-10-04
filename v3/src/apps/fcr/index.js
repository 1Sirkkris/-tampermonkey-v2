V3.boot=()=>{
  const life=V3.lifecycle.create('fcr-toolkit');
  const telemetry=V3.telemetry.create('fcr',V3.build.version);
  const client=V3.fcr.create({telemetry,life});
  const bin=V3.bincheck.create({telemetry,life});
  const pandash=V3.pandash.create({telemetry,warehouse:()=>V3.fcr.warehouse()||'BWU2'});
  const current=()=>V3.base.clean(new URLSearchParams(location.search).get('s'));

  const tools=[
    ['fcr-tote','TOTE','Tote Audit',V3.fcrTote.create({life,telemetry,client})],
    ['fcr-bin','BIN','Bin Check',V3.fcrBin.create({life,telemetry,client,bin,current})],
    ['fcr-pandash','PANDASH','Pandash',V3.fcrPandash.create({life,client,pandash,current})],
    ['fcr-move','MOVE CONTAINER','MoveContainer',V3.fcrMove.create({life,telemetry,current})],
    ['fcr-unbind','UNBIND','Unbind container',V3.fcrUnbind.create({life,telemetry,current})]
  ];

  for(const [id,label,title,tool] of tools)V3.ui.dockButton({id,label,title,onClick:tool.open});

  V3.ui.dockButton({
    id:'fcr-iss',
    label:'ISS',
    title:'Open standalone V3 ISS Console',
    onClick:()=>{
      const url='https://aft-poirot-website-nrt.nrt.proxy.amazon.com/#iss-console';
      if(typeof GM_openInTab==='function')GM_openInTab(url,{active:true,insert:true});
      else window.open(url,'_blank','noopener');
    }
  });
};