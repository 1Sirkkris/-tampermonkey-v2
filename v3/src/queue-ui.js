V3.queueUI = (() => {
  const C = V3.core;
  function mount(root,{name,scope,life,fields='',prepare=async()=>null,action,onSettings=()=>{},values=()=>({})}={}) {
    const queue=C.queue({name,life});let busy=false,paused=false,context=null;
    root.innerHTML='<section class="v3-section">'+fields+'<label class="v3-field">Containers<textarea data-input placeholder="tsX...\ncsX..."></textarea></label>'+
      '<div class="v3-row"><button class="v3-btn" data-add>ADD</button><button class="v3-btn primary" data-run>RUN</button><button class="v3-btn" data-pause>PAUSE</button><button class="v3-btn" data-done>CLEAR DONE</button><button class="v3-btn danger" data-verify hidden>I VERIFIED IT · RETRY ATTENTION</button></div><div class="v3-note" data-msg></div></section><section class="v3-section"><div data-list></div></section>';
    const q=selector=>root.querySelector(selector),draftKey='bwu2.v3.form.'+name+'.draft';
    q('[data-input]').value=localStorage.getItem(draftKey)||'';q('[data-input]').oninput=()=>localStorage.setItem(draftKey,q('[data-input]').value);
    const message=(value,kind='')=>{q('[data-msg]').textContent=value;q('[data-msg]').className='v3-note '+(kind?'v3-'+kind:'');};
    const paint=()=>{
      q('[data-list]').innerHTML=queue.state.items.map(row=>'<div class="v3-list-row"><b>'+C.esc(row.id)+'</b> · '+C.esc(row.status.toUpperCase())+(row.error?' · <span class="v3-bad">'+C.esc(row.error)+'</span>':'')+'</div>').join('')||'<div class="v3-note">Queue empty.</div>';
      q('[data-run]').disabled=busy;q('[data-verify]').hidden=!queue.state.items.some(row=>['attention','rejected'].includes(row.status))&&!V3.state.attention(scope);
      for(const element of root.querySelectorAll('[data-setting]'))element.disabled=busy;
    };
    for(const element of root.querySelectorAll('[data-setting]'))element.onchange=()=>onSettings(root);
    const add=async()=>{if(busy)throw new Error('Pause before adding containers');await queue.add(C.lines(q('[data-input]').value));q('[data-input]').value='';localStorage.removeItem(draftKey);paint();};
    q('[data-add]').onclick=()=>void add().catch(error=>message(error.message,'bad'));
    q('[data-run]').onclick=async()=>{
      if(busy)return;
      busy=true;paused=false;let owns=false;paint();
      try{
        if(!await queue.acquire())throw new Error('Queue active in another tab');
        owns=true;
        if(queue.state.items.some(row=>row.status==='attention'))throw new C.UnknownError('Verify ATTENTION rows before RUN');
        V3.state.assertClear(scope);
        if(!queue.next())throw new Error('Add containers first');
        context=await prepare(values());if(paused)return;
        await queue.set({running:true,message:'Running'});
        for(let row=queue.next();row&&!paused;row=queue.next()){
          await queue.item(row,{status:'active',error:'',phase:'validating'});await queue.set({current:row.id,phase:'validating'});message('Processing '+row.id,'warn');paint();
          try{await action(row.id,context,()=>!paused);await queue.item(row,{status:'done',phase:'done'});message('DONE '+row.id,'ok');}
          catch(error){const cancelled=error.outcome==='cancelled',unknown=error.outcome==='unknown';
            await queue.item(row,{status:cancelled?'queued':unknown?'attention':'rejected',phase:'',error:cancelled?'':C.clean(error.message)});
            if(unknown||cancelled){paused=true;message(error.message,unknown?'bad':'warn');}
            else message('REJECTED '+row.id+' · '+error.message,'warn');
          }
          await queue.set({current:'',phase:'idle'});paint();
        }
        if(!paused)message('Queue complete','ok');
      }catch(error){message(error.message,error.outcome==='unknown'?'bad':'warn');}
      finally{busy=false;context=null;try{if(owns)await queue.set({running:false,current:'',phase:'idle'});}catch(error){message('Recovery save failed · '+error.message,'bad');}finally{await queue.release();paint();}}
    };
    q('[data-pause]').onclick=()=>{paused=true;message('Pause requested — finishing submitted action','warn');};
    q('[data-done]').onclick=async()=>{if(busy)return;try{await queue.clearDone();paint();}catch(error){message(error.message,'bad');}};
    q('[data-verify]').onclick=async()=>{if(busy)return;try{await V3.state.resolveAttention(scope);await queue.resolve();message('Verified rows returned to queue');paint();}catch(error){message(error.message,'bad');}};
    void queue.load().then(()=>{message(queue.state.items.some(row=>row.status==='attention')?'VERIFY PREVIOUS WORK':'Ready');paint();}).catch(error=>message(error.message,'bad'));
    life.own(()=>{paused=true;});
    return Object.freeze({get isBusy(){return busy;},dispose(){paused=true;}});
  }
  return Object.freeze({mount});
})();
