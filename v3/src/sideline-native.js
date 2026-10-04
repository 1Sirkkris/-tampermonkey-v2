V3.sidelineNative = (() => {
  const C=V3.core,N=V3.native;
  const step=()=>{
    const labels=[...N.root().querySelectorAll('h1,h2,h3,h4,label,legend,span,div,p,strong,b,[role="heading"]')].filter(N.visible).map(el=>C.lower(el.textContent));
    for(const [name,re] of [['quantity',/^enter quantity$/],['verify',/^verify item$/],['production',/^enter production date/],['expiry',/^enter (expiry|expiration) date/],['destination',/^scan destination container$/],['source',/^scan source container$/],['item',/^scan item$/]])if(labels.some(value=>re.test(value)))return name;
    return '';
  };
  const input=()=>{const direct=document.getElementById('scan-text-input');return N.visible(direct)?direct:N.inputs().find(el=>['text','search','tel','number',''].includes(el.type));};
  const button=re=>[...document.querySelectorAll('button,[role="button"],input[type="submit"],input[type="button"]')].filter(N.visible).find(el=>!el.disabled&&re.test(C.lower(el.innerText||el.textContent||el.value)));
  const confirm=()=>{const direct=document.getElementById('confirm-button');return N.visible(direct)&&!direct.disabled?direct:button(/^(confirm|item match|continue|submit|enter)\b/);};
  function mountQueue(root,{engine,life,prefix='sideline.queue'}={}) {
    const queue=C.queue({name:prefix,life}),draftKey='bwu2.v3.form.'+prefix+'.draft';
    let busy=false,stopped=false,disposed=false,ready=false;
    root.innerHTML='<section class="v3-section"><label class="v3-field">Containers<textarea data-input placeholder="tsX...\ncsX..."></textarea></label><div class="v3-row"><button class="v3-btn" data-add>ADD</button><button class="v3-btn primary" data-run>RUN</button><button class="v3-btn" data-pause>PAUSE</button><button class="v3-btn danger" data-stop>STOP</button><button class="v3-btn danger" data-verify hidden>I VERIFIED IT · RETRY ATTENTION</button></div><div class="v3-note" data-msg></div></section><section class="v3-section"><div data-list></div></section>';
    const q=selector=>root.querySelector(selector),input=q('[data-input]');input.value=localStorage.getItem(draftKey)||'';
    input.oninput=()=>localStorage.setItem(draftKey,input.value);
    const message=value=>{if(!disposed)q('[data-msg]').textContent=value;};
    const paint=()=>{if(disposed)return;
      q('[data-list]').innerHTML=queue.state.items.map(row=>'<div class="v3-list-row"><b>'+C.esc(row.id)+'</b> · '+C.esc(row.status.toUpperCase())+(row.error?' · '+C.esc(row.error):'')+'</div>').join('')||'<div class="v3-note">Queue empty.</div>';
      input.disabled=q('[data-add]').disabled=busy||!ready;q('[data-run]').disabled=busy||!ready;
      q('[data-stop]').disabled=!ready;q('[data-verify]').hidden=!queue.state.items.some(row=>['attention','rejected'].includes(row.status))&&!V3.state.attention('sideline');
    };
    const add=async()=>{await queue.add(C.lines(input.value));input.value='';localStorage.removeItem(draftKey);paint();};
    q('[data-add]').onclick=async()=>{if(busy||!ready)return;try{await add();}catch(error){message(error.message);}};
    q('[data-run]').onclick=async()=>{
      if(busy||!ready||disposed)return;busy=true;stopped=false;let owns=false;paint();
      try{
        if(input.value.trim())await add();
        if(!await queue.acquire())throw new Error('Queue active in another tab');owns=true;
        V3.state.assertClear('sideline');if(queue.state.items.some(row=>row.status==='attention'))throw new C.UnknownError('Verify ATTENTION before RUN');
        if(!queue.next())throw new Error('Add containers first');
        await queue.set({running:true});
        for(let row=queue.next();row&&!stopped;row=queue.next()){
          await queue.item(row,{status:'active',error:''});await queue.set({current:row.id});paint();message('Validating '+row.id);
          try{await V3.state.exclusive('sideline',async()=>{
            V3.state.assertClear('sideline');await engine.source(row.id);
            if(stopped)throw Object.assign(new Error('Stopped before close'),{outcome:'cancelled'});
            message('Closing '+row.id);await engine.close(row.id,true);
          });await queue.item(row,{status:'done'});}
          catch(error){const unknown=error.outcome==='unknown',cancelled=error.outcome==='cancelled';
            await queue.item(row,{status:unknown?'attention':cancelled?'queued':'rejected',error:cancelled?'':C.clean(error.message)});
            message(error.message);if(unknown||cancelled)stopped=true;
          }
          await queue.set({current:''});paint();
        }
        message(stopped?'STOPPED · press STOP again to clear fields':'Queue complete');
      }catch(error){message(error.message);}
      finally{try{if(owns)await queue.set({running:false,current:''});}catch(error){message('Recovery save failed · '+error.message);}finally{await queue.release();busy=false;paint();}}
    };
    q('[data-pause]').onclick=()=>{stopped=true;message('Pause requested — finishing submitted action');};
    q('[data-stop]').onclick=async()=>{
      if(!ready||disposed)return;
      if(busy){stopped=true;message('Stop requested — finishing submitted action');return;}
      busy=true;paint();let owns=false;
      try{
        if(!await queue.acquire())throw new Error('Queue active in another tab');owns=true;
        // Clearing ordinary rows must never erase an uncertain mutation.
        await queue.set({items:queue.state.items.filter(row=>row.status==='attention'),running:false,current:'',phase:'idle'});
        input.value='';localStorage.removeItem(draftKey);
        message(queue.state.items.length||V3.state.attention('sideline')?'Fields cleared · VERIFY uncertain work':'Fields cleared');
      }catch(error){message(error.message);}finally{if(owns)await queue.release();busy=false;paint();}
    };
    q('[data-verify]').onclick=async()=>{if(busy)return;try{await V3.state.resolveAttention('sideline');await queue.resolve();message('Verified rows returned to queue');paint();}catch(error){message(error.message);}};
    paint();void queue.load().then(()=>{ready=true;message('Ready');paint();}).catch(error=>message(error.message));
    life.own(()=>{stopped=true;disposed=true;});
    return Object.freeze({get isBusy(){return busy;},dispose(){stopped=true;disposed=true;}});
  }
  function mountQuantity(root,{life}={}) {
    let busy=false;const controller=new AbortController();life.own(()=>controller.abort());
    root.innerHTML='<section class="v3-section"><div class="v3-row">'+Array.from({length:10},(_,i)=>i+1).map(qty=>'<button class="v3-btn" data-qty="'+qty+'">'+qty+'</button>').join('')+'</div><label class="v3-field">Quantity<input data-number type="number" min="1" value="1"></label><div class="v3-row"><button class="v3-btn primary" data-send>SEND QTY</button><button class="v3-btn danger" data-clear>DOUBLE CLICK · CLEAR CURRENT</button><button class="v3-btn" data-cancel>CANCEL WAIT</button></div><div class="v3-note" data-status></div></section>';
    let waitController=null;const message=value=>root.querySelector('[data-status]').textContent=value;
    const run=async qty=>{if(busy)return;if(!Number.isSafeInteger(qty)||qty<1){message('Whole positive quantity required');return;}busy=true;waitController=new AbortController();const cancel=()=>waitController.abort();controller.signal.addEventListener('abort',cancel,{once:true});
      try{await V3.state.exclusive('sideline',async()=>{V3.state.assertClear('sideline');if(step()==='verify'){const btn=confirm();if(!btn)throw new Error('Native Verify button unavailable');btn.click();}
        message('Waiting for native Enter Quantity · '+qty);const el=await N.waitFor(()=>step()==='quantity'&&input(),{life,signal:waitController.signal,timeout:300000});N.setValue(el,qty);const btn=confirm();if(!btn)throw new Error('Native quantity confirmation unavailable');btn.click();message('QTY '+qty+' sent');});
      }catch(error){message(error.name==='AbortError'?'Waiting cancelled':error.message);}finally{controller.signal.removeEventListener('abort',cancel);waitController=null;busy=false;}
    };
    for(const btn of root.querySelectorAll('[data-qty]'))btn.onclick=()=>void run(Number(btn.dataset.qty));root.querySelector('[data-send]').onclick=()=>void run(Number(root.querySelector('[data-number]').value));
    root.querySelector('[data-cancel]').onclick=()=>waitController?.abort();root.querySelector('[data-clear]').ondblclick=async()=>{if(busy)return;busy=true;try{await V3.state.exclusive('sideline',async()=>{
      V3.state.assertClear('sideline');const change=document.getElementById('change-container-button')||button(/^change container/);if(!N.visible(change)||change.disabled)throw new Error('No open native container');change.click();
      const yes=await N.waitFor(()=>button(/^(yes|yes close|yes, close|empty|empty container)\b/),{life,timeout:5000});const op=C.operation({kind:'sideline-native-close',ref:'current native container',scope:'sideline'});op.submitted();yes.click();
      try{await N.waitFor(()=>step()==='source'&&!N.visible(yes),{life,timeout:15000});op.confirmed();message('Container cleared');}catch(error){op.unknown();throw new C.UnknownError('Native close outcome unknown — verify before retry',{cause:error});}
    });}catch(error){message(error.message);}finally{busy=false;}};
    message('Select QTY, then scan using the native page.');return Object.freeze({get isBusy(){return busy;},dispose(){controller.abort();waitController?.abort();}});
  }
  function dateHelper({life}={}) {
    let lastStep='',active=null;
    const check=()=>{
      const current=step();
      if(current===lastStep)return;
      lastStep=current;active?.abort();active=null;
      if(!['expiry','production'].includes(current))return;
      const fields={month:N.findInput(/\b(mm|month)\b/),day:N.findInput(/\b(dd|day)\b/),year:N.findInput(/\b(yyyy|year)\b/)};
      if(Object.values(fields).some(el=>!el)){lastStep='';return;}
      const controller=new AbortController();active=controller;
      const nativeText=C.clean(N.root().textContent);
      const ctx={dateType:current==='production'?'PRODUCTION_DATE':'EXPIRATION_DATE',
        asin:nativeText.match(/\bB[A-Z0-9]{9}\b/)?.[0]||'',fnsku:nativeText.match(/\bX[A-Z0-9]{9}\b/)?.[0]||''};
      void(async()=>{
        try{
          const chosen=await V3.sidelineUI.pickDate({ctx,life,signal:controller.signal,requireShelfLife:false});
          if(!chosen||controller.signal.aborted||step()!==current)return;
          const date=new Date(chosen.enteredMs);
          for(const [el,value] of [[fields.month,date.getMonth()+1],[fields.day,date.getDate()],[fields.year,date.getFullYear()]]){
            if(!N.visible(el))throw new Error('Native date screen changed — enter date manually');
            N.setValue(el,String(value).padStart(2,'0'));el.dispatchEvent(new Event('blur',{bubbles:true}));
          }
          const submit=confirm();if(!submit)throw new Error('Native date confirmation unavailable');submit.click();
        }catch(error){if(error.name!=='AbortError')C.telemetry('sideline',V3.build.version).emit('native.date.error',{message:error.message});}
        finally{if(active===controller)active=null;}
      })();
    };
    // Native application transitions also cover reloads and click-based scans.
    // Own panels live outside this root and do not drive date discovery.
    const target=N.root();
    const observer=new MutationObserver(check);observer.observe(target,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['hidden','aria-hidden','disabled']});
    life.own(()=>{observer.disconnect();active?.abort();});check();
  }
  function mountModes(root,{engine,life,prefix,title='Sideline'}={}) {
    let mode='lazy',active=null;const render=()=>{if(active?.isBusy)return;active?.dispose?.();root.innerHTML='<section class="v3-section"><div class="v3-row"><button class="v3-btn" data-lazy>LAZY</button><button class="v3-btn" data-queue>TOTE QUEUE</button></div></section><div data-work></div>';
      root.querySelector('[data-lazy]').onclick=()=>{mode='lazy';render();};root.querySelector('[data-queue]').onclick=()=>{mode='queue';render();};const work=root.querySelector('[data-work]');
      active=mode==='lazy'?V3.sidelineUI.mount(work,{engine,life,title,prefix}):mountQueue(work,{engine,life,prefix:prefix+'.queue'});
    };render();return Object.freeze({get isBusy(){return active?.isBusy;},dispose(){active?.dispose?.();}});
  }
  return Object.freeze({step,mountQueue,mountQuantity,dateHelper,mountModes});
})();
