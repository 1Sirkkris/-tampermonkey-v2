V3.fcrUnbind=(()=>{
  function create({life,telemetry,current}={}){
    const panel=V3.ui.panel({id:'bwu2-v3-fcr-unbind-panel',title:'V3 · Unbind',width:500,life});
    let mounted=false;
    const open=()=>{mount();panel.open();};

    function mount(){
      if(mounted)return;mounted=true;
      const root=document.createElement('div');
      root.innerHTML='<section class="section"><label class="field">Container<input data-container></label><button class="btn primary" data-run>UNBIND</button><div class="note" data-msg style="margin-top:8px"></div></section>';
      panel.set(root);
      const container=root.querySelector('[data-container]'),message=root.querySelector('[data-msg]');
      container.value=V3.base.container(current())?current():'';
      root.querySelector('[data-run]').onclick=async()=>{
        try{
          const pageWindow=typeof unsafeWindow==='object'&&unsafeWindow?unsafeWindow:window;
          const login=V3.identity.resolve({pageWindow}).login;
          if(!login)throw new Error('Authenticated employee identity unavailable');
          message.className='note warn';message.textContent='UNBINDING…';
          await V3.hierarchy.unbind(container.value,login,{telemetry});
          message.className='note ok';message.textContent='UNBOUND';
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