V3.fcrIss = (() => {
  function create(options){
    const life=options.life,shell=options.shell,telemetry=options.telemetry;
    const settings=V3.storage.create('fcr.iss');
    let tab=settings.get('tab','sideline');
    if(!['sideline','move','edit','fcsku'].includes(tab))tab='sideline';
    let busy=false,stopRequested=false,lastMessage='';
    const qtyHistory=[];
    const aft=V3.aft.create({
      origin:'https://aft-qt-jp.aka.nrt.corp.amazon.com',
      telemetry,life,stopped:()=>stopRequested
    });
    const workflows=V3.aftWorkflows.create({
      client:aft,telemetry,stopped:()=>stopRequested,
      onProgress:(message,data)=>{setStatus(message,'work');telemetry.emit('iss.progress',{tab,message,...data});},
      onQuantity:value=>{
        qtyHistory.push({...value,at:Date.now()});
        if(qtyHistory.length>12)qtyHistory.shift();
        render();
      }
    });
    const sideline=V3.sideline.create({telemetry,life});
    const side={
      source:'',destination:'',text:'',lookups:new Map(),generation:0,active:0,queue:[],
      running:false,paused:false,clearSource:settings.get('side.clearSource',true)!==false,
      delay:settings.get('side.delay',true)!==false,message:'',lastOutcome:'',dateCache:new Map(),skipped:new Map(),
      workflowExpirationMs:null,workflowDone:false,attention:''
    };
    let preflightTimer=0;

    const setStatus=(text,tone='')=>{shell.setStatus(text,tone);lastMessage=String(text||'');};
    const parseSideItems=()=>{
      const counts=new Map();
      for(const line of String(side.text||'').split(/\r?\n/)){
        const code=V3.base.clean(line.split(/\s+/)[0]);if(!code)continue;
        const key=V3.base.upper(code),entry=counts.get(key)||{code,qty:0};entry.qty++;counts.set(key,entry);
      }
      return [...counts.values()];
    };
    const lookupKey=(source,code)=>V3.base.upper(source)+'|'+V3.base.upper(code);
    const resetPreflight=()=>{
      side.generation++;side.lookups.clear();side.queue=[];side.active=0;
      side.dateCache.clear();side.skipped.clear();side.workflowExpirationMs=null;
    };
    const setSource=value=>{
      const next=V3.base.clean(value);
      if(V3.base.upper(next)!==V3.base.upper(side.source)){side.source=next;side.workflowDone=false;resetPreflight();}
      else side.source=next;
    };
    const queuePreflight=()=>{
      if(side.running||!V3.base.validContainer(side.source))return;
      const gen=side.generation;
      for(const item of parseSideItems()){
        const key=lookupKey(side.source,item.code);
        if(side.lookups.has(key))continue;
        const entry={key,code:item.code,generation:gen,state:'queued',result:null,error:''};
        side.lookups.set(key,entry);side.queue.push(entry);
      }
      pumpPreflight();
    };
    const pumpPreflight=()=>{
      while(!side.running&&side.active<5&&side.queue.length){
        const entry=side.queue.shift();
        if(!entry||entry.generation!==side.generation||side.lookups.get(entry.key)!==entry)continue;
        side.active++;entry.state='checking';render();
        sideline.preflight(side.source,entry.code).then(result=>{
          if(entry.generation!==side.generation||side.lookups.get(entry.key)!==entry)return;
          entry.result=result;entry.state=result?.kind||'retry';
          if(result?.kind==='red')side.skipped.set(V3.base.upper(entry.code),result.reason||'NOT PROCESSING');
          if(result?.kind==='retry')entry.error=result.reason||'LOOKUP FAILED — RETRY';
        }).catch(error=>{
          if(entry.generation!==side.generation)return;
          entry.state='retry';entry.error='LOOKUP FAILED — '+String(error?.message||error);
        }).finally(()=>{
          side.active=Math.max(0,side.active-1);pumpPreflight();render();
        });
      }
    };
    const schedulePreflight=()=>{
      if(preflightTimer)clearTimeout(preflightTimer);
      preflightTimer=setTimeout(()=>{preflightTimer=0;queuePreflight();},80);
    };
    const settlePreflight=async()=>{
      queuePreflight();
      const started=Date.now();
      while(side.active||side.queue.length){
        if(Date.now()-started>30000)throw new Error('Preflight did not settle');
        await life.sleep(60);
      }
      const items=parseSideItems();
      for(const item of items){
        const entry=side.lookups.get(lookupKey(side.source,item.code));
        if(!entry||entry.state==='checking'||entry.state==='queued')throw new Error('Preflight incomplete: '+item.code);
        if(entry.state==='retry')throw new Error(entry.error||'Preflight retry required: '+item.code);
        if(entry.state==='yellow'&&!side.dateCache.has(V3.base.upper(item.code)))throw new Error('Date required: '+item.code);
      }
      return items;
    };
    const randomDelay=()=>2000+Math.floor(Math.random()*6001);

    async function runSideline(){
      if(side.attention)throw new Error('ATTENTION BLOCKED — verify the unknown move, then clear attention');
      if(side.workflowDone){resetPreflight();side.workflowDone=false;}
      if(!V3.base.validContainer(side.source)||!V3.base.validContainer(side.destination))throw new Error('Source and destination must be tsX/csX');
      if(V3.base.upper(side.source)===V3.base.upper(side.destination))throw new Error('Source and destination cannot match');
      const items=await settlePreflight();
      const movable=items.filter(item=>!side.skipped.has(V3.base.upper(item.code)));
      if(!movable.length)throw new Error('All scanned items are ASIDE — nothing will move');
      side.running=true;side.paused=false;render();
      setStatus('Validating source','work');
      const sourceMeta=await sideline.validateSource(side.source);
      let moved=0,failed=0;
      for(let i=0;i<movable.length;i++){
        if(stopRequested)throw new Error('Stopped before next move');
        while(side.paused&&!stopRequested)await life.sleep(80);
        if(stopRequested)throw new Error('Stopped before next move');
        const item=movable[i],entry=side.lookups.get(lookupKey(side.source,item.code));
        if(i>0&&side.delay){
          const ms=randomDelay(),until=Date.now()+ms;
          while(Date.now()<until&&!stopRequested){
            setStatus('Pacing '+Math.max(1,Math.ceil((until-Date.now())/1000))+'s','work');
            await life.sleep(Math.min(150,Math.max(25,until-Date.now())));
          }
        }
        const chosen=side.dateCache.get(V3.base.upper(item.code));
        setStatus((i+1)+'/'+movable.length+' '+item.code+' ×'+item.qty,'work');
        try{
          await sideline.move({
            source:side.source,destination:side.destination,sourceMeta,
            preflightResult:entry.result,qty:item.qty,expirationMs:chosen?.finalExpirationMs??null
          });
          moved+=item.qty;
        }catch(error){
          if(error?.outcome==='unknown'){
            side.lastOutcome='OUTCOME UNKNOWN · '+item.code+' · VERIFY BEFORE RETRY';
            throw error;
          }
          failed+=item.qty;
          side.skipped.set(V3.base.upper(item.code),String(error?.message||error));
          if(error?.recoverable){
            side.lastOutcome='RUN PAUSED/STOPPED · '+String(error?.message||error)+' · change/verify destination manually';
            throw error;
          }
          telemetry.emit('sideline.rejected',{item:V3.telemetry.mask(item.code),reason:String(error?.message||error)});
        }
      }
      const skipped=items.reduce((sum,item)=>sum+(side.skipped.has(V3.base.upper(item.code))?item.qty:0),0);
      if(side.clearSource&&failed===0&&skipped===0){
        setStatus('Clearing source','work');
        await sideline.close(side.source,true);
      }
      side.lastOutcome='COMPLETE · moved '+moved+(failed?' · failed '+failed:'')+(skipped?' · aside '+skipped:'');
      side.workflowDone=true;
      setStatus(side.lastOutcome,failed||skipped?'warn':'');
      telemetry.emit('sideline.done',{moved,failed,skipped,clearSource:side.clearSource});
      return{moved,failed,skipped};
    }

    const runTask=task=>{
      if(busy)return;
      busy=true;stopRequested=false;setStatus('RUNNING','work');render();
      Promise.resolve().then(task).then(result=>{
        if(tab!=='sideline')setStatus('DONE','');
        lastMessage=tab==='sideline'?(side.lastOutcome||'DONE'):'DONE';
      }).catch(error=>{
        const unknown=error?.outcome==='unknown';
        if(tab==='sideline'&&unknown)side.attention='OUTCOME UNKNOWN — VERIFY BEFORE RETRY';
        lastMessage=(unknown?'OUTCOME UNKNOWN — VERIFY BEFORE RETRY · ':'')+String(error?.message||error);
        setStatus(unknown?'UNKNOWN':'STOPPED',unknown?'bad':'warn');
        telemetry.emit('iss.run.error',{tab,message:String(error?.message||error),unknown});
      }).finally(()=>{busy=false;side.running=false;side.paused=false;render();});
    };
    const stop=()=>{
      stopRequested=true;
      if(side.running)side.paused=false;
      setStatus('STOP REQUESTED','warn');
    };
    const stateOptions=selected=>['Sellable','Pending Research','Unsellable'].map(v=>'<option'+(v===selected?' selected':'')+'>'+v+'</option>').join('');
    const damageOptions=selected=>['Amazon Damage','Defective','Distributor Damage','Expired'].map(v=>'<option'+(v===selected?' selected':'')+'>'+v+'</option>').join('');

    function render(){
      const root=document.createElement('div');
      root.innerHTML='<section class="v3-section"><div class="v3-row" style="flex-wrap:wrap">'+
        [['sideline','SIDELINE'],['move','MOVE'],['edit','EDIT'],['fcsku','FCSKU']].map(([id,label])=>
          '<button class="v3-btn'+(id===tab?' primary':'')+'" data-iss-tab="'+id+'">'+label+'</button>'
        ).join('')+'</div></section><div data-module></div>';
      shell.setContent(root);
      for(const button of shell.body.querySelectorAll('[data-iss-tab]'))button.onclick=()=>{
        if(busy)return;tab=button.dataset.issTab;settings.set('tab',tab);render();
      };
      const module=root.querySelector('[data-module]');
      if(tab==='sideline')renderSideline(module);
      else if(tab==='move')renderMove(module);
      else if(tab==='edit')renderEdit(module);
      else renderFcsku(module);
    }
    function commonControls(task){
      return'<div class="v3-row"><button class="v3-btn primary" data-run '+(busy?'disabled':'')+'>RUN</button>'+
        '<button class="v3-btn danger" data-stop>STOP AFTER CURRENT</button></div>'+
        (lastMessage?'<div class="v3-note" style="margin-top:7px;white-space:pre-wrap">'+V3.base.esc(lastMessage)+'</div>':'');
    }
    function wireCommon(host,task){
      host.querySelector('[data-run]').onclick=()=>runTask(task);
      host.querySelector('[data-stop]').onclick=stop;
    }
    function renderSideline(host){
      const items=parseSideItems(),counts={green:0,yellow:0,red:0,retry:0,checking:0};
      for(const item of items){
        const e=side.lookups.get(lookupKey(side.source,item.code));
        if(!e)counts.checking+=item.qty;
        else if(e.state in counts)counts[e.state]+=item.qty;
        else counts.checking+=item.qty;
      }
      host.innerHTML=
        '<section class="v3-section"><h3>Sideline</h3>'+
          '<div class="v3-grid"><label class="v3-field">Source<input data-side-source value="'+V3.base.esc(side.source)+'"></label>'+
          '<label class="v3-field">Destination<input data-side-dest value="'+V3.base.esc(side.destination)+'"></label></div>'+
          '<label class="v3-field">Item barcodes<textarea class="v3-input" data-side-items>'+V3.base.esc(side.text)+'</textarea></label>'+
          '<div class="v3-row" style="flex-wrap:wrap"><b style="color:var(--v3-ok)">'+counts.green+' GOOD</b><b style="color:var(--v3-warn)">'+counts.yellow+' DATE</b><b style="color:var(--v3-bad)">'+counts.red+' ASIDE</b><b>'+counts.retry+' RETRY</b><span>'+counts.checking+' CHECKING</span></div>'+
          '<div class="v3-row" style="margin-top:8px"><button class="v3-btn" data-clear-source>CLEAR SOURCE: '+(side.clearSource?'ON':'OFF')+'</button>'+
          '<button class="v3-btn" data-delay>DELAY 2–8s: '+(side.delay?'ON':'OFF')+'</button>'+
          (side.running?'<button class="v3-btn" data-pause>'+(side.paused?'RESUME':'PAUSE')+'</button>':'')+'</div>'+
          (side.attention?'<div class="v3-note" style="color:var(--v3-bad);margin-top:8px"><b>'+V3.base.esc(side.attention)+'</b><br><button class="v3-btn danger" data-ack style="margin-top:6px">I VERIFIED IT · CLEAR ATTENTION</button></div>':'')+
          commonControls(runSideline)+
        '</section>'+
        '<section class="v3-section"><h3>Preflight</h3><div class="v3-list" data-preflight></div></section>';
      const list=host.querySelector('[data-preflight]');
      for(const item of items){
        const key=V3.base.upper(item.code),entry=side.lookups.get(lookupKey(side.source,item.code));
        const row=document.createElement('div');row.className='v3-item';
        const stateName=entry?.state||'checking';
        row.dataset.state=stateName==='green'?'done':stateName==='yellow'?'active':stateName==='red'||stateName==='retry'?'attention':'active';
        const reason=entry?.result?.reason||entry?.error||(entry?'CHECKING':'QUEUED');
        row.innerHTML='<span>'+V3.base.esc(item.code)+' ×'+item.qty+'<br><small>'+V3.base.esc(reason)+'</small></span><b>'+stateName.toUpperCase()+'</b>';
        if(entry?.state==='yellow'){
          const date=side.dateCache.get(key);
          const controls=document.createElement('div');controls.style.gridColumn='1/-1';
          controls.innerHTML=date
            ? '<div class="v3-note">DATE '+new Date(date.enteredMs).toLocaleDateString()+' READY</div>'
            : '<div class="v3-row"><input type="date" data-date class="v3-input"><button class="v3-btn" data-apply>APPLY</button><button class="v3-btn danger" data-aside>MIXED DATE → ASIDE</button></div>';
          if(!date){
            controls.querySelector('[data-apply]').onclick=()=>{
              try{
                const value=controls.querySelector('[data-date]').value;
                const chosen=sideline.expirationFromDate(entry.result.ctx,value);
                if(side.workflowExpirationMs!=null&&side.workflowExpirationMs!==chosen.finalExpirationMs){
                  side.skipped.set(key,'MIXED EXPIRY — NEXT WORKFLOW');
                  entry.state='red';
                  entry.result={...entry.result,kind:'red',reason:'MIXED EXPIRY — NEXT WORKFLOW'};
                  render();return;
                }
                if(side.workflowExpirationMs==null)side.workflowExpirationMs=chosen.finalExpirationMs;
                side.dateCache.set(key,chosen);render();
              }catch(error){lastMessage=String(error.message||error);render();}
            };
            controls.querySelector('[data-aside]').onclick=()=>{side.skipped.set(key,'MIXED EXPIRY — NEXT WORKFLOW');entry.state='red';entry.result={...entry.result,kind:'red',reason:'MIXED EXPIRY — NEXT WORKFLOW'};render();};
          }
          row.appendChild(controls);
        }
        list.appendChild(row);
      }
      const src=host.querySelector('[data-side-source]'),dest=host.querySelector('[data-side-dest]'),text=host.querySelector('[data-side-items]');
      src.oninput=()=>{setSource(src.value);schedulePreflight();};
      dest.oninput=()=>{
        const next=V3.base.clean(dest.value);
        if(V3.base.upper(next)!==V3.base.upper(side.destination)){side.destination=next;side.workflowDone=false;resetPreflight();}
        else side.destination=next;
      };
      text.oninput=()=>{side.text=text.value;schedulePreflight();};
      host.querySelector('[data-clear-source]').onclick=()=>{side.clearSource=!side.clearSource;settings.set('side.clearSource',side.clearSource);render();};
      host.querySelector('[data-delay]').onclick=()=>{side.delay=!side.delay;settings.set('side.delay',side.delay);render();};
      host.querySelector('[data-pause]')?.addEventListener('click',()=>{side.paused=!side.paused;render();});
      host.querySelector('[data-ack]')?.addEventListener('click',()=>{side.attention='';side.workflowDone=false;resetPreflight();lastMessage='Attention cleared after verification';render();});
      const runButton=host.querySelector('[data-run]');if(runButton&&side.attention)runButton.disabled=true;
      wireCommon(host,runSideline);
      schedulePreflight();
    }
    function renderMove(host){
      host.innerHTML='<section class="v3-section"><h3>MoveItems</h3>'+
        '<label class="v3-field">Mode<select data-mode><option>ALL</option><option>EACH</option><option>QTY</option></select></label>'+
        '<label class="v3-field">QTY<input data-qty type="number" min="1" value="1"></label>'+
        '<label class="v3-field">Source<input data-source></label><label class="v3-field">Destination<input data-dest></label>'+
        '<label class="v3-field">Items<textarea class="v3-input" data-items></textarea></label>'+commonControls(()=>{})+'</section>';
      wireCommon(host,()=>workflows.move({
        source:host.querySelector('[data-source]').value,destination:host.querySelector('[data-dest]').value,
        items:V3.base.lines(host.querySelector('[data-items]').value,{dedupe:false}),
        qtyMode:host.querySelector('[data-mode]').value,quantity:Number(host.querySelector('[data-qty]').value)
      }));
    }
    function renderEdit(host){
      const mode=settings.get('editMode','sku');
      host.innerHTML='<section class="v3-section"><div class="v3-row"><button class="v3-btn '+(mode==='each'?'primary':'')+'" data-mode="each">EACH</button><button class="v3-btn '+(mode==='sku'?'primary':'')+'" data-mode="sku">SKU</button></div></section>'+
      (mode==='each'
        ? '<section class="v3-section"><h3>Edit EACH</h3><label class="v3-field">Location ASIN FNSKU rows<textarea class="v3-input" data-rows></textarea></label><div class="v3-grid"><label class="v3-field">Target<select data-target>'+stateOptions('Unsellable')+'</select></label><label class="v3-field">Disposition<select data-damage>'+damageOptions('Defective')+'</select></label></div>'+commonControls(()=>{})+'</section>'
        : '<section class="v3-section"><h3>Edit SKU</h3>'+
          '<div class="v3-row" style="margin-bottom:8px">'+(qtyHistory.slice(-3).map(q=>'<span class="v3-note">S '+(q.sellable??'—')+' · P '+(q.pending??'—')+' · U '+(q.unsellable??'—')+'</span>').join('')||'<span class="v3-note">Quantity history appears here.</span>')+'</div>'+
          '<label class="v3-field">SKU<input data-sku></label><div class="v3-grid"><label class="v3-field">Current<select data-current>'+stateOptions('Sellable')+'</select></label><label class="v3-field">Current disposition<select data-current-damage>'+damageOptions('Defective')+'</select></label><label class="v3-field">Desired<select data-desired>'+stateOptions('Unsellable')+'</select></label><label class="v3-field">Desired disposition<select data-desired-damage>'+damageOptions('Defective')+'</select></label></div>'+commonControls(()=>{})+'</section>');
      for(const b of host.querySelectorAll('[data-mode]'))b.onclick=()=>{if(busy)return;settings.set('editMode',b.dataset.mode);render();};
      if(mode==='each')wireCommon(host,()=>{
        const rows=String(host.querySelector('[data-rows]').value||'').split(/\r?\n/).map(V3.base.clean).filter(Boolean).map(line=>{const [location='',asin='',fnsku='']=line.split(/\s+/);return{location,asin,fnsku:fnsku||asin};});
        return workflows.editEach({rows,desiredState:host.querySelector('[data-target]').value,desiredDamage:host.querySelector('[data-damage]').value});
      });
      else wireCommon(host,()=>workflows.editSku({
        sku:host.querySelector('[data-sku]').value,currentState:host.querySelector('[data-current]').value,
        currentDamage:host.querySelector('[data-current-damage]').value,desiredState:host.querySelector('[data-desired]').value,
        desiredDamage:host.querySelector('[data-desired-damage]').value
      }));
    }
    function renderFcsku(host){
      host.innerHTML='<section class="v3-section"><h3>FCSKU Flip</h3><label class="v3-field">OLD<input data-old></label><label class="v3-field">NEW<input data-new></label><label class="v3-field">Locations<textarea class="v3-input" data-locations></textarea></label>'+commonControls(()=>{})+'</section>';
      wireCommon(host,()=>workflows.fcsku({
        oldCode:host.querySelector('[data-old]').value,newCode:host.querySelector('[data-new]').value,
        locations:V3.base.lines(host.querySelector('[data-locations]').value)
      }));
    }
    return Object.freeze({render,state:side});
  }
  return Object.freeze({create});
})();