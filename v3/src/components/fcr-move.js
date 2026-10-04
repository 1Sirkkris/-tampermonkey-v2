V3.fcrMove=(()=>{
  function create({life,telemetry,current}={}){
    const panel=V3.ui.panel({id:'bwu2-v3-fcr-move-panel',title:'V3 · MoveContainer',width:500,life});
    let mounted=false;
    const open=()=>{mount();panel.open();};

    function mount(){
      if(mounted)return;mounted=true;
      const root=document.createElement('div');
      root.innerHTML='<section class="section"><label class="field">Container<input data-container></label><div class="grid"><label class="field">Floor<select data-floor>'+V3.moveContainer.FLOORS.map(x=>'<option>'+x+'</option>').join('')+'</select></label><label class="field">Drop<select data-drop></select></label></div><button class="btn primary" data-run>MOVE</button><div class="note" data-msg style="margin-top:8px"></div></section>';
      panel.set(root);
      const container=root.querySelector('[data-container]'),floor=root.querySelector('[data-floor]'),drop=root.querySelector('[data-drop]'),message=root.querySelector('[data-msg]');
      container.value=V3.base.container(current())?current():'';
      floor.value='P2';
      const paintDrops=()=>{drop.innerHTML=V3.moveContainer.choices(floor.value).map(([name])=>'<option>'+V3.base.esc(name)+'</option>').join('');};
      floor.onchange=paintDrops;paintDrops();
      root.querySelector('[data-run]').onclick=async()=>{
        try{
          message.className='note warn';message.textContent='MOVING…';
          await V3.moveContainer.move(container.value,V3.moveContainer.destination(floor.value,drop.value),{telemetry});
          message.className='note ok';message.textContent='MOVED';
        }catch(error){
          message.className='note '+(error?.outcome==='unknown'?'bad':'warn');
          message.textContent=(error?.outcome==='unknown'?'OUTCOME UNKNOWN — VERIFY · ':'')+error.message;
        }
      };
    }

    return Object.freeze({open});
  }
  return Object.freeze({create});
})();