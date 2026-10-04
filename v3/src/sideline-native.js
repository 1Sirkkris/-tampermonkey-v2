V3.sidelineNative = (() => {
  const C=V3.core,N=V3.native;
  const step=()=>{
    const labels=[...N.root().querySelectorAll('h1,h2,h3,h4,label,legend,span,p,strong,[role="heading"]')].filter(N.visible).map(el=>C.lower(el.textContent));
    for(const [name,re] of [['quantity',/^enter quantity$/],['verify',/^verify item$/],['production',/^enter production date/],['expiry',/^enter (expiry|expiration) date/],['destination',/^scan destination container$/],['source',/^scan source container$/],['item',/^scan item$/]])if(labels.some(value=>re.test(value)))return name;
    return '';
  };
  const input=()=>{const direct=document.getElementById('scan-text-input');return N.visible(direct)?direct:N.inputs().find(el=>['text','search','tel','number',''].includes(el.type));};
  const button=re=>[...document.querySelectorAll('button,[role="button"],input[type="submit"],input[type="button"]')].filter(N.visible).find(el=>!el.disabled&&re.test(C.lower(el.innerText||el.textContent||el.value)));
  const confirm=()=>{const direct=document.getElementById('confirm-button');return N.visible(direct)&&!direct.disabled?direct:button(/^(confirm|item match|continue|submit|enter)\b/);};
  function mountQueue(root,{engine,life,prefix='sideline.queue'}={}) {
    return V3.queueUI.mount(root,{name:prefix,scope:'sideline',life,action:(container,_context,maySubmit)=>V3.state.exclusive('sideline',async()=>{
      V3.state.assertClear('sideline');await engine.source(container);if(!maySubmit())throw Object.assign(new Error('Paused before close'),{outcome:'cancelled'});await engine.close(container,true);
    })});
  }
  function mountQuantity(root,{life}={}) {
    let busy=false;const controller=new AbortController();life.own(()=>controller.abort());
    root.innerHTML='<section class="v3-section"><div class="v3-row">'+[1,2,3,4,5,10].map(qty=>'<button class="v3-btn" data-qty="'+qty+'">'+qty+'</button>').join('')+'</div><label class="v3-field">Quantity<input data-number type="number" min="1" value="1"></label><div class="v3-row"><button class="v3-btn primary" data-send>SEND QTY</button><button class="v3-btn danger" data-clear>DOUBLE CLICK · CLEAR CURRENT</button><button class="v3-btn" data-cancel>CANCEL WAIT</button></div><div class="v3-note" data-status></div></section>';
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
  function dateHelper({engine,life}={}) {
    let source='',generation=0,active=null;const controller=new AbortController();life.own(()=>{controller.abort();active?.abort();});
    life.on(document,'keydown',event=>{if(event.key!=='Enter'||event.target!==input())return;
      if(step()==='source'){generation++;active?.abort();source=C.clean(event.target.value);return;}
      if(step()!=='item'||!C.container(source))return;const barcode=C.clean(event.target.value);if(!barcode)return;const run=++generation;active?.abort();active=new AbortController();const signal=active.signal;
      void(async()=>{try{const rec=await engine.preflight(source,barcode,{signal});if(run!==generation||rec.result.kind!=='yellow')return;
        const expected=rec.result.ctx.dateType==='PRODUCTION_DATE'?'production':'expiry';await N.waitFor(()=>step()===expected,{life,signal,timeout:15000});
        const chosen=await V3.sidelineUI.pickDate({ctx:rec.result.ctx,life,signal});if(!chosen||run!==generation||step()!==expected)return;
        const fields={month:N.findInput(/\b(mm|month)\b/),day:N.findInput(/\b(dd|day)\b/),year:N.findInput(/\b(yyyy|year)\b/)};if(Object.values(fields).some(el=>!el))throw new Error('Native date fields unavailable — enter date manually');
        const date=new Date(chosen.enteredMs);for(const [el,value] of [[fields.month,date.getMonth()+1],[fields.day,date.getDate()],[fields.year,date.getFullYear()]]){N.setValue(el,String(value).padStart(2,'0'));el.dispatchEvent(new Event('blur',{bubbles:true}));}
        confirm()?.click();
      }catch(error){if(error.name!=='AbortError')C.telemetry('sideline',V3.build.version).emit('native.date.error',{message:error.message});}finally{if(run===generation)active=null;}})();
    },true);
  }
  function mountModes(root,{engine,life,prefix,title='Sideline'}={}) {
    let mode='lazy',active=null;const render=()=>{if(active?.isBusy)return;active?.dispose?.();root.innerHTML='<section class="v3-section"><div class="v3-row"><button class="v3-btn" data-lazy>LAZY</button><button class="v3-btn" data-queue>TOTE QUEUE</button></div></section><div data-work></div>';
      root.querySelector('[data-lazy]').onclick=()=>{mode='lazy';render();};root.querySelector('[data-queue]').onclick=()=>{mode='queue';render();};const work=root.querySelector('[data-work]');
      active=mode==='lazy'?V3.sidelineUI.mount(work,{engine,life,title,prefix}):mountQueue(work,{engine,life,prefix:prefix+'.queue'});
    };render();return Object.freeze({get isBusy(){return active?.isBusy;},dispose(){active?.dispose?.();}});
  }
  return Object.freeze({step,mountQueue,mountQuantity,dateHelper,mountModes});
})();
