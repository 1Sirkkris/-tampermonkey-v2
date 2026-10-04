V3.sidelineUI=(()=>{
  const C=V3.core;
  const parseItems=text=>{const map=new Map();for(const raw of String(text||'').split(/\r?\n/)){const code=C.clean(raw.split(/\s+/)[0]);if(!code)continue;const key=C.upper(code),row=map.get(key)||{code,qty:0};row.qty++;map.set(key,row);}return[...map.values()];};
  const formatDate=ms=>{const d=new Date(ms);return String(d.getMonth()+1).padStart(2,'0')+'/'+String(d.getDate()).padStart(2,'0')+'/'+d.getFullYear();};
  const today=()=>{const d=new Date();d.setHours(0,0,0,0);return d;};
  const pao900=()=>{const d=today();d.setDate(d.getDate()+900);return d.getTime();};

  const pickDate=({ctx,life}={})=>new Promise(resolve=>{
    const production=ctx?.dateType==='PRODUCTION_DATE',overlay=document.createElement('div');
    overlay.dataset.bwu2Ui='1';
    overlay.style.cssText='position:fixed;inset:0;z-index:2147483647;background:#0008;display:grid;place-items:start center;padding:38px 12px';
    const card=document.createElement('div');card.style.cssText='width:min(620px,calc(100vw - 24px));background:#111720;color:#fff;border:2px solid #77879b;border-radius:12px;padding:14px;font:13px Arial;box-shadow:0 14px 40px #0008';
    const mode=production?'PRODUCTION':'EXPIRATION';
    card.innerHTML='<h2 style="margin:0 0 10px">REQUIRES '+mode+' DATE</h2><div style="font-weight:800">'+C.esc(ctx?.sku?.title||ctx?.asin||ctx?.barcode||'Item')+'</div><div class="v3-note">ASIN '+C.esc(ctx?.asin||'—')+' · FNSKU '+C.esc(ctx?.fnsku||'—')+'</div><label style="display:block;margin-top:12px;font-weight:800">Date<input type="date" data-date style="width:100%;box-sizing:border-box;margin-top:5px;padding:10px"></label><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">'+(!production?'<button data-pao>PAO +900 DAYS · '+formatDate(pao900())+'</button>':'')+'<button data-use>USE DATE</button><button data-cancel>CANCEL</button></div>';
    for(const b of card.querySelectorAll('button'))b.style.cssText='padding:9px 12px;border:1px solid #718096;border-radius:7px;background:#263241;color:#fff;font-weight:800;cursor:pointer';
    overlay.appendChild(card);document.body.appendChild(overlay);
    const close=value=>{overlay.remove();resolve(value);};
    card.querySelector('[data-cancel]').onclick=()=>close(null);
    card.querySelector('[data-pao]')?.addEventListener('click',()=>close({enteredMs:pao900(),finalExpirationMs:pao900()}));
    card.querySelector('[data-use]').onclick=()=>{const raw=card.querySelector('[data-date]').value,m=raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return;const entered=V3.sideline.validDate(Number(m[3]),Number(m[2]),Number(m[1]));if(!entered)return;const final=production?entered+Number(ctx?.dateDetail?.shelfLife||0):entered;close({enteredMs:entered,finalExpirationMs:final});};
    life?.own(()=>overlay.remove());
  });

  function mount(root,{engine,life,title='Sideline',prefix='sideline'}={}){
    const state={source:'',destination:'',items:'',lookup:new Map(),generation:0,running:false,stop:false,paused:false,attention:'',dates:new Map(),establishedExpiry:null,sourceMeta:null};
    let debounce=0,resumeResolver=null,predicantResolver=null;
    root.innerHTML='<section class="v3-section"><b>'+C.esc(title)+'</b><div class="v3-grid" style="margin-top:8px"><label class="v3-field">Source<input data-source autocomplete="off"></label><label class="v3-field">Destination<input data-dest autocomplete="off"></label></div><label class="v3-field">Items<textarea data-items placeholder="scan / paste one barcode per line"></textarea></label><div class="v3-row"><label><input type="checkbox" data-clear checked> Clear source when done</label><label><input type="checkbox" data-delay checked> Delay 2–8s</label></div><div class="v3-row" style="margin-top:8px"><button class="v3-btn primary" data-run>RUN</button><button class="v3-btn" data-stop disabled>STOP AFTER CURRENT</button><button class="v3-btn" data-resume hidden>RESUME</button><button class="v3-btn danger" data-attn hidden>I VERIFIED IT · CLEAR ATTENTION</button></div><div class="v3-note" data-status>Scan source → destination → items.</div></section><section class="v3-section"><div data-metrics></div><div data-list style="margin-top:8px"></div></section>';
    const q=s=>root.querySelector(s),source=q('[data-source]'),dest=q('[data-dest]'),items=q('[data-items]'),status=(m,k='')=>{q('[data-status]').className='v3-note '+(k?'v3-'+k:'');q('[data-status]').textContent=m;};
    const parsed=()=>parseItems(items.value);
    const save=()=>{try{localStorage.setItem('bwu2.v3.form.'+prefix+'.source',source.value);localStorage.setItem('bwu2.v3.form.'+prefix+'.dest',dest.value);localStorage.setItem('bwu2.v3.form.'+prefix+'.items',items.value);}catch{}};
    try{source.value=localStorage.getItem('bwu2.v3.form.'+prefix+'.source')||'';dest.value=localStorage.getItem('bwu2.v3.form.'+prefix+'.dest')||'';items.value=localStorage.getItem('bwu2.v3.form.'+prefix+'.items')||'';}catch{}
    const resetWorkflow=()=>{state.generation++;state.lookup.clear();state.dates.clear();state.establishedExpiry=null;state.sourceMeta=null;state.attention='';q('[data-attn]').hidden=true;};
    const paint=()=>{
      const rows=parsed(),counts={green:0,yellow:0,red:0,retry:0,waiting:0};
      q('[data-list]').innerHTML=rows.map(row=>{const rec=state.lookup.get(C.upper(row.code)),kind=rec?.result?.kind||'waiting',label=rec?.result?.reason||'WAITING';counts[kind]=(counts[kind]||0)+row.qty;const cls=kind==='green'?'v3-ok':kind==='yellow'||kind==='retry'?'v3-warn':kind==='red'?'v3-bad':'v3-note';return'<div class="v3-list-row"><b>'+C.esc(row.code)+'</b>'+(row.qty>1?' ×'+row.qty:'')+' · <span class="'+cls+'"><b>'+C.esc(label)+'</b></span></div>';}).join('')||'<div class="v3-note">No items.</div>';
      q('[data-metrics]').textContent='GOOD '+counts.green+' · DATE '+counts.yellow+' · ASIDE '+counts.red+' · RETRY '+counts.retry;
    };
    const setBusy=v=>{state.running=v;q('[data-run]').disabled=v||Boolean(state.attention);q('[data-stop]').disabled=!v;source.disabled=v;items.disabled=v;dest.disabled=v&&!state.paused;};
    const preflightOne=async(row,generation,controller)=>{try{const value=await engine.preflight(source.value,row.code,{signal:controller.signal});if(generation!==state.generation)return;state.lookup.set(C.upper(row.code),value);paint();}catch(error){if(generation!==state.generation)return;state.lookup.set(C.upper(row.code),{result:{kind:'retry',reason:'LOOKUP FAILED — '+C.clean(error.message||error),ctx:null}});paint();}};
    const preflightAll=async()=>{
      const src=C.clean(source.value),rows=parsed();if(!C.container(src)||!rows.length)return;
      const generation=state.generation,controller=new AbortController();life?.own(()=>controller.abort());let cursor=0;
      const worker=async()=>{while(cursor<rows.length&&generation===state.generation){const row=rows[cursor++],key=C.upper(row.code);if(state.lookup.has(key))continue;await preflightOne(row,generation,controller);}};
      await Promise.all(Array.from({length:Math.min(5,rows.length)},worker));
    };
    const schedule=()=>{if(debounce)clearTimeout(debounce);debounce=life?.timeout?life.timeout(()=>{debounce=0;void preflightAll();},120):setTimeout(()=>{debounce=0;void preflightAll();},120);};
    source.oninput=()=>{save();resetWorkflow();schedule();};dest.oninput=()=>save();items.oninput=()=>{save();resetWorkflow();schedule();};
    source.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();dest.focus();dest.select?.();}};
    dest.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();items.focus();}};
    schedule();

    const resolveDates=async rows=>{
      for(const row of rows){
        const rec=state.lookup.get(C.upper(row.code)),result=rec?.result;
        if(result?.kind!=='yellow')continue;
        const key=C.upper(row.code);let chosen=state.dates.get(key);
        if(!chosen){chosen=await pickDate({ctx:result.ctx,life});if(!chosen)throw new Error('DATE REQUIRED — '+row.code);state.dates.set(key,chosen);}
        if(state.establishedExpiry!=null&&chosen.finalExpirationMs!==state.establishedExpiry){rec.result={...result,kind:'red',reason:'MIXED EXPIRY — PROCESS IN NEXT WORKFLOW'};continue;}
        if(state.establishedExpiry==null)state.establishedExpiry=chosen.finalExpirationMs;
      }
      paint();
    };

    const waitResume=message=>new Promise(resolve=>{state.paused=true;dest.disabled=false;q('[data-resume]').hidden=false;status(message,'bad');resumeResolver=()=>{state.paused=false;q('[data-resume]').hidden=true;dest.disabled=true;resolve();};});
    q('[data-resume]').onclick=()=>resumeResolver?.();

    q('[data-run]').onclick=async()=>{
      if(state.running||state.attention)return;
      resetWorkflow();setBusy(true);state.stop=false;status('Validating source…','warn');
      const rows=parsed();let moved=0,aside=0;
      try{
        if(!C.container(source.value)||!C.container(dest.value)||C.lower(source.value)===C.lower(dest.value))throw new Error('Valid different source/destination containers required');
        if(!rows.length)throw new Error('No items');
        state.sourceMeta=await engine.source(source.value);
        status('Preflight '+rows.length+' item(s)…','warn');await preflightAll();
        if([...state.lookup.values()].some(x=>x.result?.kind==='retry'))throw new Error('PREFLIGHT LOOKUP FAILED — no moves sent');
        await resolveDates(rows);
        const movable=rows.filter(row=>{const kind=state.lookup.get(C.upper(row.code))?.result?.kind;if(kind==='red'){aside+=row.qty;return false;}return kind==='green'||kind==='yellow';});
        if(!movable.length)throw new Error('Nothing to process — all items are ASIDE');
        for(let i=0;i<movable.length;i++){
          if(state.stop)break;const row=movable[i],rec=state.lookup.get(C.upper(row.code)),chosen=state.dates.get(C.upper(row.code));
          if(i>0&&q('[data-delay]').checked)await life.sleep(2000+Math.floor(Math.random()*6001));
          let retryCurrent=true;
          while(retryCurrent&&!state.stop){
            retryCurrent=false;status((i+1)+'/'+movable.length+' · MOVING '+row.code+' ×'+row.qty,'warn');
            try{await engine.move({sourceContainer:source.value,destination:dest.value,sourceMeta:state.sourceMeta,preflightResult:rec,qty:row.qty,expirationMs:chosen?.finalExpirationMs??null});moved+=row.qty;}
            catch(error){
              if(error?.outcome==='unknown'){state.attention='unknown';q('[data-attn]').hidden=false;throw error;}
              if(error?.predicant){
                await waitResume('PREDICANT — RESCAN SAME DESTINATION THEN RESUME');
                if(C.upper(dest.value)!==C.upper(state.destination||dest.value))throw new Error('Destination changed during predicant recovery');
                status('Emptying destination…','warn');await engine.close(dest.value,true);retryCurrent=true;continue;
              }
              if(error?.recoverable){
                const old=C.upper(dest.value);await waitResume('DESTINATION REJECTED — enter NEW destination then RESUME');
                if(!C.container(dest.value)||C.upper(dest.value)===old)throw new Error('Choose a different valid destination');retryCurrent=true;continue;
              }
              aside+=row.qty;state.lookup.set(C.upper(row.code),{...rec,result:{...rec.result,kind:'red',reason:C.clean(error.message||error)}});
            }
          }
          paint();
        }
        if(state.stop)status('Stopped after current item · moved '+moved,'warn');
        else{status('DONE ✓ '+moved+' moved · '+aside+' aside','ok');if(q('[data-clear]').checked){source.value='';items.value='';save();}}
      }catch(error){if(error?.outcome==='unknown')status('OUTCOME UNKNOWN — VERIFY BEFORE RETRY · '+C.clean(error.message||error),'bad');else status('STOPPED · '+C.clean(error.message||error),'bad');}
      finally{setBusy(false);}
    };
    q('[data-stop]').onclick=()=>{state.stop=true;status('Stop requested — finishing current action','warn');};
    q('[data-attn]').onclick=()=>{state.attention='';q('[data-attn]').hidden=true;q('[data-run]').disabled=false;status('Attention cleared');};
    paint();
    return Object.freeze({dispose(){state.stop=true;resumeResolver?.();predicantResolver?.();}});
  }

  return Object.freeze({parseItems,pickDate,mount});
})();
