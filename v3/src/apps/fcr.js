V3.boot=()=>{
  const C=V3.core,life=C.lifecycle('fcr'),telemetry=C.telemetry('fcr',V3.build.version),fcr=V3.fcr.create({life,telemetry});
  if(location.origin===V3.measurement.SITE){V3.measurement.native({life});return;}
  if(window.parent!==window)return;
  if(!document.body){life.on(document,'DOMContentLoaded',()=>{life.dispose();V3.boot();},{once:true});return;}
  const current=()=>C.clean(new URL(location.href).searchParams.get('s')||'');
  const print=async(code,title='')=>{
    const value=C.clean(code);if(!value)throw new Error('Barcode required');
    const hex=v=>Array.from(new TextEncoder().encode(String(v??''))).map(b=>b.toString(16).padStart(2,'0')).join('');
    return C.request('http://localhost:5965/printer?action=print&type=barcode&data='+hex(value)+'&text='+hex(value)+'&quantity=1&desc='+hex(C.clean(title))+'&seq='+Date.now(),{timeout:5000,allowHtml:true});
  };

  const currentContainer=()=>C.container(current())?current():'';

  function itemPanel(){
    const panel=C.panel({id:'fcr-item',title:'V3 · FCR Item',width:560,life});let mounted=false;
    return{open(){if(!mounted){mounted=true;const root=document.createElement('div');
      root.innerHTML='<section class="v3-section"><label class="v3-field">Search code<input data-code></label><div class="v3-row"><button class="v3-btn primary" data-run>LOOKUP</button><button class="v3-btn" data-print>PRINT CODE</button></div><div class="v3-note" data-msg style="margin-top:8px"></div></section><section class="v3-section"><div data-out></div></section>';panel.set(root);
      const input=root.querySelector('[data-code]'),msg=root.querySelector('[data-msg]'),out=root.querySelector('[data-out]');input.value=current();let last=null,generation=0;
      input.oninput=()=>{generation++;last=null;out.innerHTML='';msg.textContent='Ready to look up';};life.own(()=>generation++);
      root.querySelector('[data-run]').onclick=async()=>{
        const code=C.clean(input.value);if(!code)return;const run=++generation;last=null;out.innerHTML='';msg.textContent='Loading…';
        try{
          const product=await fcr.product(code);if(run!==generation||C.clean(input.value)!==code)return;if(!product)throw new Error('Product not found');last=product;
          out.innerHTML='<div class="v3-grid">'+[['ASIN',product.asin],['FNSKU',product.fnsku],['FCSKU',product.fcsku],['Sortable',product.sortableText],['Dimensions',product.dimensions],['Weight',product.weight]].map(([label,value])=>'<div><b>'+label+'</b><br>'+C.esc(value||'—')+(label==='Dimensions'&&product.suspicious?' <span class="v3-warn"><b>CHECK</b></span>':'')+'</div>').join('')+'</div><div style="margin-top:9px"><b>'+C.esc(product.title||'')+'</b></div>';
          msg.className='v3-note v3-ok';msg.textContent='Ready';
        }catch(error){if(run!==generation||C.clean(input.value)!==code)return;msg.className='v3-note v3-bad';msg.textContent=error.message;}
      };
      root.querySelector('[data-print]').onclick=async()=>{try{const code=C.clean(input.value),title=last&&[last.asin,last.fnsku,last.fcsku].some(value=>C.upper(value)===C.upper(code))?last.title:'';await print(code,title);msg.textContent='Printed '+code;}catch(error){msg.textContent=error.message;}};
    }panel.open();}};
  }

  function totePanel(){
    const panel=C.panel({id:'fcr-tote',title:'V3 · Tote Audit',width:760,life});let mounted=false;
    return{open(){if(!mounted){mounted=true;const root=document.createElement('div');
      root.innerHTML='<section class="v3-section"><div class="v3-note" data-summary>Scan tsX/csX to begin.</div><label class="v3-field">Scanner<input data-scan autocomplete="off"></label><div class="v3-row"><button class="v3-btn" data-reset>NEW TOTE</button><button class="v3-btn primary" data-retry hidden>RETRY INVENTORY</button></div><div class="v3-note" data-msg></div></section><section class="v3-section"><b>Physical scans</b><div data-scans></div></section><section class="v3-section"><b>System inventory</b><div data-system></div></section>';panel.set(root);
      const q=selector=>root.querySelector(selector),scan=q('[data-scan]');let audit;
      const paint=state=>{
        const total=audit.totals();q('[data-summary]').textContent=(state.container||'NO CONTAINER')+' · '+total.scanned+'/'+total.units+' units'+(total.overage?' · EXTRA '+total.overage:'');
        q('[data-msg]').textContent=state.message;q('[data-retry]').hidden=state.phase!=='failed';
        q('[data-scans]').innerHTML=[...state.scans.values()].reverse().map(row=>'<div class="v3-list-row"><button class="v3-btn" data-print="'+C.esc(row.raw)+'">'+C.esc(row.raw)+(row.count>1?' ×'+row.count:'')+'</button> · <b class="'+(row.state==='found'?'v3-ok':['missing','overage','error'].includes(row.state)?'v3-bad':'v3-warn')+'">'+row.state.toUpperCase()+'</b></div>').join('')||'<div class="v3-note">No scans.</div>';
        q('[data-system]').innerHTML=state.rows.map(row=>'<div class="v3-list-row"><b>'+C.esc(row.fnsku||row.fcsku||row.asin||'—')+'</b> · '+row._scan+'/'+row.qty+' · '+C.esc(row.title||row.asin||'')+'</div>').join('')||'<div class="v3-note">No inventory loaded.</div>';
        for(const button of q('[data-scans]').querySelectorAll('[data-print]'))button.onclick=async()=>{
          const record=state.scans.get(C.upper(button.dataset.print));try{await print(record.raw,record.product?.title||record.matches[0]?.title||'');state.message='Printed '+record.raw;}catch(error){state.message='Print failed: '+error.message;}paint(state);
        };
      };
      audit=V3.fcrAudit.create({inventory:fcr.inventory,product:fcr.product,onChange:paint,telemetry});
      scan.onkeydown=async event=>{if(event.key!=='Enter')return;event.preventDefault();const value=scan.value;scan.value='';await audit.scan(value);scan.focus({preventScroll:true});};
      q('[data-reset]').onclick=()=>{audit.reset();scan.focus();};q('[data-retry]').onclick=()=>audit.retry();life.own(audit.reset);paint(audit.state);
    }panel.open();}};
  }

  function binPanel(){
    const panel=C.panel({id:'fcr-bin',title:'V3 · Bin Check',width:800,life});let mounted=false;
    return{open(){if(!mounted){mounted=true;const state={rows:[],floors:new Map(),filter:new Set(['P2','P3','P4']),generation:0,message:'Snapshot native inventory when ready.'};life.own(()=>state.generation++);const root=document.createElement('div');root.innerHTML='<section class="v3-section"><div class="v3-row"><button class="v3-btn primary" data-load>SNAPSHOT VISIBLE/FILTERED</button><button class="v3-btn" data-copy>COPY VISIBLE TSV</button><button class="v3-btn primary" data-floor="P2">P2</button><button class="v3-btn primary" data-floor="P3">P3</button><button class="v3-btn primary" data-floor="P4">P4</button></div><div class="v3-note" data-msg style="margin-top:8px"></div></section><section class="v3-section"><div data-list></div></section>';panel.set(root);const q=s=>root.querySelector(s);
      const snapshot=()=>{
        const table=document.querySelector('#table-inventory');if(!table)throw new Error('Native inventory table not ready');
        const idx=V3.fcr.inventoryIndexes(table);if(idx.container<0||idx.qty<0)throw new Error('Container / quantity column not found');
        let nodes=null;try{const jq=globalThis.jQuery||unsafeWindow?.jQuery,dt=jq&&jq.fn?.dataTable?.isDataTable?.(table)?jq(table).DataTable():null;if(dt)nodes=dt.rows({search:'applied'}).nodes().toArray();}catch{}
        if(!nodes)nodes=[...(table.tBodies?.[0]?.rows||[])].filter(row=>{const rect=row.getBoundingClientRect(),style=getComputedStyle(row);return rect.height>0&&style.display!=='none'&&style.visibility!=='hidden';});
        return nodes.map(row=>V3.fcr.inventoryRow(row,idx)).filter(row=>row?.container);
      };
      const visibleRows=()=>state.rows.filter(r=>{const pod=V3.fcr.podOf(r.container),floor=pod?state.floors.get(pod)||'PX':'PX';return !/^P[234]$/.test(floor)||state.filter.has(floor);});
      const paint=()=>{q('[data-msg]').textContent=state.message;for(const b of root.querySelectorAll('[data-floor]'))b.classList.toggle('primary',state.filter.has(b.dataset.floor));q('[data-list]').innerHTML=visibleRows().map((r,i)=>{const pod=V3.fcr.podOf(r.container),floor=pod?state.floors.get(pod)||'…':'—';return'<div class="v3-list-row">'+(i+1)+'. <b>'+C.esc(floor)+'</b> · <button class="v3-btn" data-print="'+C.esc(r.container)+'">'+C.esc(r.container)+'</button> · <button class="v3-btn" data-print="'+C.esc(r.fnsku)+'">'+C.esc(r.fnsku||'—')+'</button> · '+C.esc(r.fcsku||'—')+' · Q'+r.qty+'</div>';}).join('')||'<div class="v3-note">No rows.</div>';for(const b of q('[data-list]').querySelectorAll('[data-print]'))b.onclick=async e=>{if(!e.altKey)return;try{await print(b.dataset.print);state.message='Printed '+b.dataset.print;}catch(err){state.message=err.message;}paint();};};
      q('[data-load]').onclick=async()=>{
        const generation=++state.generation;
        try{
          state.rows=snapshot();state.floors.clear();state.message='Resolving '+state.rows.length+' filtered row(s)…';paint();
          const pods=[...new Set(state.rows.map(row=>V3.fcr.podOf(row.container)).filter(Boolean))];let cursor=0;
          const worker=async()=>{while(generation===state.generation&&cursor<pods.length){const pod=pods[cursor++],floor=await fcr.floor(pod);if(generation!==state.generation)return;state.floors.set(pod,floor);paint();}};
          await Promise.all(Array.from({length:Math.min(8,pods.length)},worker));
          if(generation!==state.generation)return;state.message='Ready · Alt-click Container/FNSKU to print';paint();
        }catch(error){if(generation===state.generation){state.message=error.message;paint();}}
      };
      for(const b of root.querySelectorAll('[data-floor]'))b.onclick=()=>{state.filter.has(b.dataset.floor)?state.filter.delete(b.dataset.floor):state.filter.add(b.dataset.floor);paint();};
      q('[data-copy]').onclick=()=>{const rows=visibleRows(),text=['Floor\tContainer\tASIN\tFNSKU\tFCSKU\tQty',...rows.map(r=>{const pod=V3.fcr.podOf(r.container),floor=pod?state.floors.get(pod)||'PX':'';return[floor,r.container,r.asin,r.fnsku,r.fcsku,r.qty].join('\t');})].join('\n');if(typeof GM_setClipboard==='function')GM_setClipboard(text,'text');else navigator.clipboard?.writeText(text);state.message='Copied '+rows.length+' visible row(s)';paint();};paint();}panel.open();}};
  }

  function pandashPanel(){
    const panel=C.panel({id:'fcr-pandash',title:'V3 · Pandash',width:480,life});let mounted=false;
    return{open(){if(!mounted){mounted=true;const root=document.createElement('div');root.innerHTML='<section class="v3-section"><label class="v3-field">ASIN<input data-asin></label><button class="v3-btn primary" data-run>CHECK</button><div class="v3-note" data-msg></div></section>';panel.set(root);
      const input=root.querySelector('[data-asin]'),msg=root.querySelector('[data-msg]');input.value=/^B[A-Z0-9]{9}$/i.test(current())?current():'';let generation=0;
      input.oninput=()=>{generation++;msg.className='v3-note';msg.textContent='CHECK required';};life.own(()=>generation++);
      root.querySelector('[data-run]').onclick=async()=>{
        const run=++generation,requested=input.value;let asin=C.upper(requested);msg.className='v3-note v3-warn';msg.textContent='Checking…';
        try{
          if(!asin){const product=await fcr.product(current());if(run!==generation||input.value!==requested)return;asin=C.upper(product?.asin);input.value=asin;}
          const result=await fcr.pandash(asin);if(run!==generation||C.upper(input.value)!==asin)return;
          msg.className='v3-note '+(result.allowed?'v3-ok':'v3-bad');msg.textContent='L'+result.level+' · '+result.message;
        }catch(error){if(run!==generation)return;msg.className='v3-note v3-bad';msg.textContent=error.message;}
      };
    }panel.open();}};
  }

  function actionPanel({family,id,title,path,origin,button,fields,prepare}) {
    const panel=C.panel({id,title,width:560,life});let mounted=false,external=null,runContext=null;
    const worker=V3.bridge.client({origin,path,family,life,onEvent:detail=>window.dispatchEvent(new CustomEvent('bwu2-v3:event',{detail}))});
    return{open(){if(!mounted){mounted=true;const root=document.createElement('div');
      root.innerHTML='<section class="v3-section"><label class="v3-field">Container<input data-container></label>'+fields+'<div class="v3-row"><button class="v3-btn primary" data-run>'+button+'</button><button class="v3-btn danger" data-verify hidden>I VERIFIED IT · CLEAR ATTENTION</button></div><div class="v3-note" data-msg></div></section>';
      panel.set(root);const input=root.querySelector('[data-container]'),run=root.querySelector('[data-run]'),verify=root.querySelector('[data-verify]'),msg=root.querySelector('[data-msg]');input.value=currentContainer();
      const key='bwu2.v3.form.fcr.'+family;let busy=false,blocked=localStorage.getItem(key)||'';
      const paint=()=>{run.disabled=busy||Boolean(blocked);verify.hidden=!blocked;for(const field of root.querySelectorAll('input,select'))field.disabled=busy;};
      const payload=prepare?.(root)||(()=>({container:input.value}));
      run.onclick=async()=>{if(busy||blocked)return;let sent=false;busy=true;paint();try{const data=external||payload();external=null;if(!C.container(data.container))throw new Error('Valid container required');
        localStorage.setItem(key,'Unfinished '+button+' · verify '+data.container);sent=true;msg.textContent=button+'…';await worker.run('run',data);msg.textContent=button+' CONFIRMED';localStorage.removeItem(key);
      }catch(error){if(error.outcome==='unknown'){blocked=error.message;localStorage.setItem(key,blocked);}else if(sent)localStorage.removeItem(key);msg.textContent=error.message;}finally{busy=false;paint();}};
      verify.onclick=async()=>{if(busy)return;try{await worker.run('resolve');blocked='';localStorage.removeItem(key);msg.textContent='Attention cleared';paint();}catch(error){msg.textContent=error.message;}};
      runContext=async data=>{if(busy||blocked)return;external=data;await run.onclick();};msg.textContent=blocked?'VERIFY PREVIOUS ACTION · '+blocked:'Ready';paint();}panel.open();},async runContext(data){this.open();await runContext(data);}};
  }
  function movePanel(){return actionPanel({family:'movecontainer',id:'fcr-move',title:'V3 · MoveContainer',path:'/move-container',origin:V3.actions.MOVE_ORIGIN,button:'MOVE',
    fields:'<div class="v3-grid"><label class="v3-field">Floor<select data-floor>'+V3.actions.FLOORS.map(x=>'<option>'+x+'</option>').join('')+'</select></label><label class="v3-field">Destination<select data-drop></select></label></div>',
    prepare:root=>{const floor=root.querySelector('[data-floor]'),drop=root.querySelector('[data-drop]');floor.value='P2';const fill=()=>{drop.innerHTML='<option value="PRIME">PRIME</option>'+V3.actions.dropChoices(floor.value).map(x=>'<option value="'+C.esc(x.key)+'">'+C.esc(x.label)+'</option>').join('');};floor.onchange=fill;fill();return()=>({container:root.querySelector('[data-container]').value,destination:V3.actions.destination(floor.value,drop.value)});}});}
  function unbindPanel(){return actionPanel({family:'hierarchy',id:'fcr-unbind',title:'V3 · Unbind',path:'/unbindHierarchy',origin:V3.actions.HIERARCHY_ORIGIN,button:'UNBIND',fields:''});}

  const tools=[
    ['fcr-item','ITEM','Product / exact print',itemPanel()],
    ['fcr-tote','TOTE','Tote Audit',totePanel()],
    ['fcr-bin','BIN','Bin Check',binPanel()],
    ['fcr-pandash','PANDASH','Pandash',pandashPanel()],
    ['fcr-move','MOVE','MoveContainer',movePanel()],
    ['fcr-unbind','UNBIND','Unbind',unbindPanel()]
  ];
  V3.fcrNative.mount({life,telemetry,fcr,print,move:tools.find(row=>row[0]==='fcr-move')[3],unbind:tools.find(row=>row[0]==='fcr-unbind')[3]});
  for(const [id,label,title,tool] of tools)C.dockButton({id,label,title,onClick:tool.open});
  C.dockButton({id:'fcr-iss',label:'ISS',title:'Open standalone V3 ISS Console',onClick:()=>{const url='https://aft-poirot-website-nrt.nrt.proxy.amazon.com/#iss-console';if(typeof GM_openInTab==='function')GM_openInTab(url,{active:true,insert:true});else window.open(url,'_blank','noopener');}});
};
