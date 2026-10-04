V3.boot = () => {
  const C = V3.core, life = C.lifecycle('iss');
  const panel = C.panel({id: 'iss-console', title: 'V3 · ISS Console', width: 720, life});
  let worker=null,workerLife=null,workerRunning=false,workerProgress=false;
  const ensureWorker=()=>{
    if(!worker){
      workerLife=C.lifecycle('iss-aft-worker');
      worker=V3.bridge.client({origin:V3.aft.DEFAULT_ORIGIN,path:'/app/edititems?experience=Desktop',family:'aft',life:workerLife,
        onEvent:detail=>window.dispatchEvent(new CustomEvent('bwu2-v3:event',{detail}))});
    }
    return worker;
  };
  const runWorker=async(command,input={})=>{
    if(workerRunning)throw new Error('ISS AFT workflow already running');
    workerRunning=true;workerProgress=false;
    try{return await ensureWorker().run(command,{...input,onProgress:info=>{workerProgress=true;input.onProgress?.(info);}});}
    finally{workerRunning=false;}
  };
  const stopWorker=()=>{
    if(!workerRunning)return;
    worker.stop();
    // Before the first progress event, cancellation must also stop startup.
    // The canonical bridge rejects unsent work as cancelled and dispatched work
    // as UNKNOWN, preserving the verification barrier if delivery is uncertain.
    if(!workerProgress){workerLife.dispose();worker=null;workerLife=null;}
  };
  life.own(()=>workerLife?.dispose());
  const engine = V3.sideline.create({life, telemetry: C.telemetry('sideline', V3.build.version)});
  let tab = 'sideline', active = null, mounted = false;
  const render = () => {
    if (active?.isBusy) return;
    active?.dispose?.();
    const root = document.createElement('div');
    root.innerHTML = '<section class="v3-section"><b>ISS Console</b><div class="v3-tabs">' +
      [['edit','EDIT'],['move','MOVE'],['sideline','SIDELINE'],['fcsku','FCSKU']].map(([key,label]) =>
        '<button class="v3-btn' + (key === tab ? ' active' : '') + '" data-tab="' + key + '">' + label + '</button>').join('') +
      '</div></section><div data-work></div>';
    panel.set(root); const work = root.querySelector('[data-work]');
    for (const button of root.querySelectorAll('[data-tab]')) button.onclick = () => {
      if (active?.isBusy) return; tab = button.dataset.tab; render();
    };
    const options = {stop: stopWorker, resolveAttention: () => runWorker('resolve')};
    if (tab === 'edit') active = V3.workflowUI.mountEdit(work, {...options, prefix: 'iss.edit',
      runEach: input => runWorker('edit.each', input), runSku: input => runWorker('edit.sku', input)});
    else if (tab === 'move') active = V3.workflowUI.mountMove(work, {...options, prefix: 'iss.move', run: input => runWorker('move.run', input)});
    else if (tab === 'fcsku') active = V3.workflowUI.mountFcsku(work, {...options, prefix: 'iss.fcsku', run: input => runWorker('fcsku.run', input)});
    else active = V3.sidelineNative.mountModes(work, {engine, life, title: 'ISS Sideline', prefix: 'iss.sideline'});
    mounted = true;
  };
  C.dockButton({id: 'iss-console', label: 'ISS', title: 'V3 ISS Console', onClick: () => { if (!mounted) render(); panel.open(); }});
  life.own(() => active?.dispose?.());
  if (location.hash === '#iss-console') { render(); panel.open(); }
};
