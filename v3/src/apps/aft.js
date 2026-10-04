V3.boot = () => {
  const C = V3.core, life = C.lifecycle('aft'), telemetry = C.telemetry('aft', V3.build.version);
  let stopFlag = false, active = null, mounted = false;
  const engine = V3.aft.create({life, telemetry, stopped: () => stopFlag});
  const run = fn => input => V3.state.exclusive('aft', async () => {
    V3.state.assertClear('aft'); stopFlag = false; return fn(input);
  });
  const commands = {'move.run': run(input => engine.runMove(input)), 'edit.each': run(input => engine.runEditEach(input)),
    'edit.sku': run(input => engine.runEditSku(input)), 'fcsku.run': run(input => engine.runFcsku(input)),
    'date.run': run(input => engine.runDate(input)), resolve: () => V3.state.resolveAttention('aft')};
  const stop = () => { stopFlag = true; };
  if (location.hash === '#v3-aft-worker' && window.parent !== window) {
    V3.bridge.server({family: 'aft', life, commands, stop,
      allowed: origin => origin === 'https://aft-poirot-website-nrt.nrt.proxy.amazon.com'});
    return;
  }
  const panel = C.panel({id: 'aft-tools', title: 'V3 · AFT Tools', width: 620, life});
  const options = {stop, resolveAttention: commands.resolve};
  const mount = () => {
    if (mounted) return; mounted = true; const root = document.createElement('div');
    if (location.pathname.includes('/app/moveitems')) active = V3.workflowUI.mountMove(root, {...options, prefix: 'aft.move', run: commands['move.run']});
    else if (location.pathname.includes('/app/fcskuflip')) active = V3.workflowUI.mountFcsku(root, {...options, prefix: 'aft.fcsku', run: commands['fcsku.run']});
    else {
      root.innerHTML = '<div class="v3-tabs"><button class="v3-btn" data-edit>EDIT</button><button class="v3-btn" data-date>DATE</button></div><div data-work></div>';
      const work = root.querySelector('[data-work]');
      const paint = date => { if (active?.isBusy) return; active?.dispose?.();
        active = date ? V3.workflowUI.mountDate(work, {...options, prefix: 'aft.date', run: commands['date.run']}) :
          V3.workflowUI.mountEdit(work, {...options, prefix: 'aft.edit', runEach: commands['edit.each'], runSku: commands['edit.sku']}); };
      root.querySelector('[data-edit]').onclick = () => paint(false); root.querySelector('[data-date]').onclick = () => paint(true); paint(false);
    }
    panel.set(root);
  };
  life.own(() => active?.dispose?.());
  C.dockButton({id: 'aft-tools', label: 'AFT', title: 'V3 AFT Tools', onClick: () => { mount(); panel.open(); }});
};
