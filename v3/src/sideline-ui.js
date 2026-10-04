V3.sidelineUI = (() => {
  const C = V3.core, globalDates = new Map();
  let activeDate = null;
  const parseItems = (text, source = '', dest = '') => {
    const rows = new Map();
    for (const line of String(text || '').split(/\r?\n/)) {
      const code = C.clean(line.split(/\s+/)[0]);
      if (!code || [source,dest].some(value => C.upper(value) === C.upper(code))) continue;
      const key = C.upper(code), row = rows.get(key) || {code, qty: 0}; row.qty++; rows.set(key,row);
    }
    return [...rows.values()];
  };
  const dateLabel = ms => new Date(ms).toLocaleDateString('en-AU');
  const today = () => { const date = new Date(); date.setHours(0,0,0,0); return date; };
  const pao900 = () => { const date = today(); date.setDate(date.getDate()+900); return date.getTime(); };
  const dateKey = ctx => [C.upper(ctx?.fnsku || ctx?.asin || ctx?.barcode),ctx?.dateType,ctx?.dateDetail?.shelfLife || 0].join('|');
  function pickDate({ctx, life, signal = life?.signal} = {}) {
    if (activeDate) return Promise.resolve(null);
    return new Promise(resolve => {
      const production = ctx?.dateType === 'PRODUCTION_DATE', currentYear = today().getFullYear();
      const selection = {month: 0, day: 1, year: 0};
      const overlay = document.createElement('div'); overlay.dataset.bwu2Ui = '1';
      overlay.className = 'v3-expiry'; overlay.innerHTML = '<div class="v3-expiry-card"></div>';
      document.body.appendChild(overlay); const card = overlay.firstElementChild;
      const close = value => { signal?.removeEventListener('abort', cancel); overlay.remove(); activeDate = null; resolve(value); };
      const cancel = () => close(null); activeDate = {close: cancel}; signal?.addEventListener('abort', cancel, {once:true});
      const allowed = ms => ms != null && (production ? ms <= Date.now() : ms >= today().getTime());
      const render = () => {
        const image = C.clean(ctx?.sku?.imageUrls?.[0]).replace(/^http:/,'https:');
        const title = ctx?.sku?.title || ctx?.sku?.normalizedTitle || ctx?.asin || ctx?.barcode || 'Item';
        const buttons = (name, values) => values.map(([value,label]) => {
          const ms = name === 'year' ? V3.sideline.validDate(selection.day,selection.month,value) : null;
          const disabled = name === 'day' && (!selection.month || value > new Date(selection.year || 2000,selection.month,0).getDate()) || name === 'year' && !allowed(ms);
          return '<button class="v3-btn'+(selection[name]===value?' primary':'')+'" data-part="'+name+'" data-value="'+value+'"'+(disabled?' disabled':'')+'>'+label+'</button>';
        }).join('');
        card.innerHTML = '<h2>REQUIRES '+(production?'PRODUCTION':'EXPIRATION')+' DATE</h2><div class="v3-row">'+
          (image?'<img width="90" height="90" style="object-fit:contain" src="'+C.esc(image)+'" alt="">':'')+
          '<div><b>'+C.esc(title)+'</b><div>ASIN '+C.esc(ctx?.asin)+' · FNSKU '+C.esc(ctx?.fnsku)+'</div></div></div>'+
          '<div class="v3-date-grid"><section><b>MONTH</b><div>'+buttons('month',Array.from({length:12},(_,i)=>[i+1,new Date(2026,i,1).toLocaleString('en-AU',{month:'short'})]))+'</div></section>'+
          '<section><b>DAY</b><div>'+buttons('day',Array.from({length:31},(_,i)=>[i+1,i+1]))+'</div></section>'+
          '<section><b>YEAR</b><div>'+buttons('year',Array.from({length:16},(_,i)=>[currentYear+(production?-i:i),currentYear+(production?-i:i)]))+'</div></section></div>'+
          '<div class="v3-row">'+(!production?'<button class="v3-btn" data-pao>PAO +900 DAYS · '+dateLabel(pao900())+'</button>':'')+
          '<button class="v3-btn primary" data-use '+(!selection.year?'disabled':'')+'>USE DATE</button><button class="v3-btn" data-cancel>CANCEL</button></div>';
        for (const button of card.querySelectorAll('[data-part]')) button.onclick=()=>{
          selection[button.dataset.part]=Number(button.dataset.value); if(button.dataset.part!=='year')selection.year=0;
          if(button.dataset.part==='month')selection.day=1; render();
        };
        card.querySelector('[data-cancel]').onclick=cancel;
        card.querySelector('[data-pao]')?.addEventListener('click',()=>{const ms=pao900();close({enteredMs:ms,finalExpirationMs:ms});});
        card.querySelector('[data-use]').onclick=()=>{
          const enteredMs=V3.sideline.validDate(selection.day,selection.month,selection.year);if(!allowed(enteredMs))return;
          const shelfLife=Number(ctx?.dateDetail?.shelfLife);
          if(production&&(!Number.isFinite(shelfLife)||shelfLife<=0))return;
          close({enteredMs,finalExpirationMs:production?enteredMs+shelfLife:enteredMs});
        };
      };
      render(); if(signal?.aborted)cancel();
    });
  }
  function mount(root,{engine,life,title='Sideline',prefix='sideline'}={}) {
    const key='bwu2.v3.form.'+prefix+'.',get=(name,fallback='')=>localStorage.getItem(key+name)??fallback;
    let running=false,stop=false,paused=false,attention=get('attention'),generation=0,controller=new AbortController(),debounce=0,waiter=null;
    const lookup=new Map(),inflight=new Map(),dates=new Map(); let rows=[];
    root.innerHTML='<section class="v3-section"><b>'+C.esc(title)+'</b><div class="v3-grid">'+
      '<label class="v3-field">Source<input data-source autocomplete="off"></label><label class="v3-field">Destination<input data-dest autocomplete="off"></label></div>'+
      '<label class="v3-field">Items<textarea data-items placeholder="scan / paste one barcode per line"></textarea></label>'+
      '<div class="v3-row"><button class="v3-btn primary" data-clear>CLEAR SOURCE: ON</button><button class="v3-btn primary" data-delay>DELAY 2–8s: ON</button></div>'+
      '<div class="v3-row"><button class="v3-btn primary" data-run>RUN LAZY</button><button class="v3-btn" data-pause>PAUSE</button><button class="v3-btn" data-resume hidden>RESUME</button><button class="v3-btn danger" data-stop>STOP</button><button class="v3-btn" data-reset>RESET</button><button class="v3-btn danger" data-attn hidden>I VERIFIED IT · CLEAR ATTENTION</button></div><div class="v3-note" data-status></div></section>'+
      '<section class="v3-section"><div data-metrics></div><div data-list></div></section>';
    const q=selector=>root.querySelector(selector),source=q('[data-source]'),dest=q('[data-dest]'),items=q('[data-items]');
    source.value=get('source');dest.value=get('dest');items.value=get('items');
    let clear=get('clear','1')==='1',delay=get('delay','1')==='1';
    const status=(message,kind='')=>{q('[data-status]').className='v3-note '+(kind?'v3-'+kind:'');q('[data-status]').textContent=message;};
    const save=()=>{for(const [name,element] of [['source',source],['dest',dest],['items',items]])localStorage.setItem(key+name,element.value);};
    const paint=()=>{
      const list=running?rows:parseItems(items.value,source.value,dest.value),counts={moved:0,aside:0,good:0,date:0,retry:0,total:0};
      q('[data-list]').innerHTML=list.map(row=>{const record=lookup.get(C.upper(row.code)),kind=row.status||record?.result?.kind||'waiting',reason=row.reason||record?.result?.reason||'WAITING';
        counts.total+=row.qty;if(kind==='done')counts.moved+=row.qty;else if(kind==='red'||kind==='rejected')counts.aside+=row.qty;else if(kind==='green')counts.good+=row.qty;else if(kind==='yellow')counts.date+=row.qty;else if(kind==='retry')counts.retry+=row.qty;
        return '<div class="v3-list-row"><b>'+C.esc(row.code)+'</b> ×'+row.qty+' · <b class="'+(['red','unknown','rejected'].includes(kind)?'v3-bad':kind==='yellow'||kind==='retry'?'v3-warn':'v3-ok')+'">'+C.esc(kind==='done'?'MOVED':reason)+'</b></div>';
      }).join('')||'<div class="v3-note">No items.</div>';
      q('[data-metrics]').textContent='TOTAL '+counts.total+' · MOVED '+counts.moved+' · GOOD '+counts.good+' · DATE '+counts.date+' · ASIDE '+counts.aside+' · RETRY '+counts.retry;
      source.disabled=items.disabled=running;dest.disabled=running&&!paused;
      q('[data-run]').disabled=running||Boolean(attention);q('[data-reset]').disabled=running;
      q('[data-attn]').hidden=!attention;q('[data-resume]').hidden=!paused;
      for(const [name,value] of [['clear',clear],['delay',delay]]){q('[data-'+name+']').textContent=(name==='clear'?'CLEAR SOURCE: ':'DELAY 2–8s: ')+(value?'ON':'OFF');q('[data-'+name+']').classList.toggle('primary',value);}
    };
    const resetLookups=()=>{generation++;controller.abort();controller=new AbortController();lookup.clear();inflight.clear();dates.clear();};
    const preflight=async()=>{
      const src=C.clean(source.value),list=parseItems(items.value,src,dest.value),run=generation;if(!C.container(src))return;
      let cursor=0;const worker=async()=>{while(cursor<list.length&&run===generation&&!controller.signal.aborted){
        const row=list[cursor++],code=C.upper(row.code);if(lookup.has(code))continue;
        if(inflight.has(code)){await inflight.get(code);continue;}
        const request=(async()=>{try{const rec=await engine.preflight(src,row.code,{signal:controller.signal});if(run===generation)lookup.set(code,rec);}
          catch(error){if(run===generation)lookup.set(code,{result:{kind:'retry',reason:'LOOKUP FAILED · '+C.clean(error.message)}});}finally{if(run===generation){inflight.delete(code);paint();}}})();
        inflight.set(code,request);await request;
      }};await Promise.all(Array.from({length:Math.min(5,list.length)},worker));
    };
    const schedule=()=>{clearTimeout(debounce);debounce=setTimeout(()=>void preflight(),120);};
    source.oninput=()=>{save();resetLookups();schedule();};dest.oninput=save;items.oninput=()=>{save();paint();schedule();};
    source.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();dest.focus();dest.select();}};
    dest.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();if(paused)q('[data-resume]').click();else items.focus();}};
    for(const name of ['clear','delay'])q('[data-'+name+']').onclick=()=>{if(name==='clear')clear=!clear;else delay=!delay;localStorage.setItem(key+name,(name==='clear'?clear:delay)?'1':'0');paint();};
    const wait=message=>new Promise(resolve=>{paused=true;waiter=resolve;status(message,'warn');paint();});
    q('[data-resume]').onclick=()=>{if(!paused)return;paused=false;const resolve=waiter;waiter=null;resolve?.();paint();};
    q('[data-pause]').onclick=()=>{if(running){paused=true;status('Pause requested — finishing current action','warn');paint();}};
    const requestStop=()=>{stop=true;paused=false;waiter?.();waiter=null;activeDate?.close();status('Stop requested — finishing current action','warn');paint();};
    q('[data-stop]').onclick=requestStop;
    q('[data-reset]').onclick=()=>{if(running||attention)return;resetLookups();source.value=dest.value=items.value='';save();rows=[];status('Ready');paint();};
    q('[data-attn]').onclick=async()=>{try{await V3.state.resolveAttention('sideline');attention='';localStorage.removeItem(key+'attention');status('Attention cleared');paint();}catch(error){status(error.message,'bad');}};
    q('[data-run]').onclick=async()=>{
      if(running||attention)return;
      running=true;stop=false;rows=parseItems(items.value,source.value,dest.value);paint();
      const journal=()=>localStorage.setItem(key+'run',JSON.stringify({source:source.value,dest:dest.value,rows}));
      try{await V3.state.exclusive('sideline',async()=>{
        V3.state.assertClear('sideline');
        if(!C.container(source.value)||!C.container(dest.value)||C.upper(source.value)===C.upper(dest.value))throw new Error('Valid different source/destination containers required');
        if(!rows.length)throw new Error('No items');journal();status('Preflight…','warn');await preflight();
        if(rows.some(row=>!lookup.has(C.upper(row.code))||lookup.get(C.upper(row.code)).result.kind==='retry'))throw new Error('PREFLIGHT FAILED — no moves sent');
        const sourceMeta=await engine.source(source.value);let establishedExpiry=null;
        for(const row of rows){if(stop)break;const rec=lookup.get(C.upper(row.code));row.status=rec.result.kind;
          if(rec.result.kind==='red')continue;
          if(rec.result.kind==='yellow'){
            const dkey=dateKey(rec.result.ctx),cached=globalDates.get(dkey);let chosen=dates.get(dkey)||(cached&&Date.now()-cached.at<8*60*60*1000?cached.value:null);
            if(!chosen)chosen=await pickDate({ctx:rec.result.ctx,life});if(!chosen)throw new Error('Date entry cancelled — no move sent for '+row.code);
            dates.set(dkey,chosen);globalDates.set(dkey,{value:chosen,at:Date.now()});
            if(globalDates.size>300)globalDates.delete(globalDates.keys().next().value);
            if(establishedExpiry!=null&&establishedExpiry!==chosen.finalExpirationMs){row.status='red';row.reason='MIXED EXPIRY — PROCESS IN NEXT WORKFLOW';continue;}
            establishedExpiry=chosen.finalExpirationMs;row.date=chosen;
          }
        }
        let moved=0;
        for(const row of rows){
          if(stop)break;if(paused)await wait('PAUSED — RESUME when ready');if(stop)break;
          if(row.status==='red')continue;
          if(moved&&delay)await C.sleep(2000+Math.floor(Math.random()*6001),life.signal);if(stop)break;
          let recovery=false;
          for(;;){if(stop)break;
            const target=C.clean(dest.value);if(!C.container(target)||C.upper(target)===C.upper(source.value))throw new Error('Invalid destination');
            row.status='moving';journal();paint();status('MOVING '+row.code+' ×'+row.qty,'warn');
            try{await engine.move({sourceContainer:source.value,destination:target,sourceMeta,preflightResult:lookup.get(C.upper(row.code)),qty:row.qty,expirationMs:row.date?.enteredMs??null});row.status='done';moved+=row.qty;journal();break;}
            catch(error){if(error.outcome==='unknown'){row.status='unknown';journal();throw error;}
              if(!recovery&&(error.predicant||error.recoverable)){recovery=true;row.status='rejected';journal();
                await wait(error.predicant?'PREDICANT — rescan SAME destination then RESUME':'DESTINATION REJECTED — enter NEW destination then RESUME');if(stop)break;
                if(error.predicant){if(C.upper(dest.value)!==C.upper(target))throw new Error('Rescan the same destination');await engine.close(target,true);}
                else if(!C.container(dest.value)||C.upper(dest.value)===C.upper(target))throw new Error('Choose a new valid destination');
                continue;
              }
              row.status='rejected';row.reason=C.clean(error.message);journal();break;
            }
          }paint();
        }
        const clean=rows.every(row=>row.status==='done');
        if(clean&&clear&&!stop){status('Clearing source…','warn');await engine.close(source.value,true);}
        items.value=rows.filter(row=>row.status!=='done').flatMap(row=>Array(row.qty).fill(row.code)).join('\n');save();
        status((stop?'STOPPED':clean?'DONE ✓':'DONE · source left open')+' · '+moved+' moved',clean?'ok':'warn');
      });}catch(error){items.value=rows.filter(row=>!['done','unknown','moving'].includes(row.status)).flatMap(row=>Array(row.qty).fill(row.code)).join('\n');save();if(error.outcome==='unknown'){attention=C.clean(error.message);localStorage.setItem(key+'attention',attention);}
        status((attention?'OUTCOME UNKNOWN — VERIFY BEFORE RETRY · ':'STOPPED · ')+C.clean(error.message),attention?'bad':'warn');
      }finally{running=false;paused=false;waiter=null;localStorage.setItem(key+'lastRun',JSON.stringify(rows));localStorage.removeItem(key+'run');paint();}
    };
    const previous=get('run');if(previous){try{const saved=JSON.parse(previous);rows=saved.rows||[];items.value=rows.filter(row=>!['done','unknown','moving'].includes(row.status)).flatMap(row=>Array(row.qty).fill(row.code)).join('\n');save();localStorage.setItem(key+'lastRun',JSON.stringify(rows));}catch{}attention='Previous session ended during work — verify before retry';localStorage.setItem(key+'attention',attention);}
    if(attention)status('VERIFY PREVIOUS RUN · '+attention,'bad');else status('Scan source → destination → items.');paint();schedule();
    life.own(()=>{clearTimeout(debounce);controller.abort();requestStop();});
    return Object.freeze({get isBusy(){return running;},dispose(){clearTimeout(debounce);controller.abort();requestStop();}});
  }
  return Object.freeze({parseItems,pickDate,mount});
})();
