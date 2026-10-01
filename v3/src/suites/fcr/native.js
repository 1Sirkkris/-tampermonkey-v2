V3.fcrNative = (() => {
  function create(options){
    const life=options.life,client=options.client,telemetry=options.telemetry,shell=options.shell;
    const settings=V3.storage.create('fcr.native');
    const floorCache=V3.storage.create('fcr.floorCache');
    const state={code:new URLSearchParams(location.search).get('s')||'',loading:false,product:null,inventory:null,error:'',message:'Ready',floors:new Map(),floorRunning:false};

    const conflicts=rows=>{
      const groups=new Map();
      for(const row of rows||[]){
        const container=V3.base.upper(row.container),fnsku=V3.base.upper(row.fnsku),fcsku=V3.base.upper(row.fcsku);
        if(!container||!fnsku||!fcsku)continue;
        const key=container+'\u0000'+fnsku;
        if(!groups.has(key))groups.set(key,{container,fnsku,fcskus:new Set(),rows:[]});
        const group=groups.get(key);group.fcskus.add(fcsku);group.rows.push(row);
      }
      return [...groups.values()].filter(group=>group.fcskus.size>1);
    };
    const hierarchyUrl=pod=>{
      const url=new URL(location.href);url.search='';url.hash='';
      url.pathname=url.pathname.replace(/\/$/,'')+'/container-hierarchy';
      url.searchParams.set('s',pod);return url.href;
    };
    const parseFloor=html=>{
      const doc=V3.base.parseHtml(html);
      const cell=doc.querySelector('div.a-span6:nth-child(1) > table:nth-child(1) > tbody:nth-child(1) > tr:nth-child(4) > td:nth-child(2)');
      const raw=V3.base.clean(cell?.textContent).split(',')[0];
      const num=raw.match(/\b(\d+)\b/)?.[1]||'';
      return num?'P'+num:'PX';
    };
    const resolveFloor=async pod=>{
      const cached=floorCache.read(V3.base.upper(pod),null);
      if(cached.ok&&cached.value&&Date.now()-Number(cached.at||0)<30*60*1000)return cached.value;
      let last='PX';
      for(let attempt=0;attempt<2;attempt++){
        try{
          const result=await V3.api.fetchRequest(hierarchyUrl(pod),{timeout:8000,allowHtml:true,telemetry,signal:life.signal});
          last=parseFloor(result.raw);if(last!=='PX')break;
        }catch(error){telemetry.emit('bin.floor.error',{pod:V3.telemetry.mask(pod),attempt,message:String(error?.message||error)});}
        if(attempt===0)await life.sleep(350);
      }
      floorCache.set(V3.base.upper(pod),last);return last;
    };
    async function resolveFloors(){
      if(state.floorRunning||!state.inventory)return;
      state.floorRunning=true;state.floors.clear();render();
      const pods=[...new Set((state.inventory.rows||[]).map(row=>V3.base.clean(row.container).match(/\bP-\d-(?:[A-Z]\d{3}){2}\b/i)?.[0]?.toUpperCase()).filter(Boolean))];
      let cursor=0;
      const worker=async()=>{
        while(cursor<pods.length){
          const pod=pods[cursor++],floor=await resolveFloor(pod);state.floors.set(pod,floor);render();
        }
      };
      await Promise.all(Array.from({length:Math.min(6,pods.length)},worker));
      state.floorRunning=false;telemetry.emit('bin.floor.done',{pods:pods.length});render();
    }
    async function load(){
      const code=V3.base.clean(shell.body.querySelector('[data-code]')?.value||state.code);
      if(!code)return;
      state.code=code;state.loading=true;state.error='';state.message='Loading…';state.product=null;state.inventory=null;state.floors.clear();render();
      const [productResult,inventoryResult]=await Promise.allSettled([client.product(code),client.inventory(code,{allowPartial:false})]);
      if(productResult.status==='fulfilled')state.product=productResult.value;
      else telemetry.emit('fcr.product.error',{search:V3.telemetry.mask(code),message:String(productResult.reason?.message||productResult.reason)});
      if(inventoryResult.status==='fulfilled')state.inventory=inventoryResult.value;
      else telemetry.emit('fcr.inventory.error',{search:V3.telemetry.mask(code),message:String(inventoryResult.reason?.message||inventoryResult.reason)});
      state.loading=false;
      if(!state.product&&!state.inventory){
        state.error='No usable product/inventory data';state.message='Unavailable';
      }else state.message='Loaded';
      render();
    }
    const print=async(code,title='')=>{
      try{await V3.print.barcode(code,{description:title,telemetry});state.message='Printed '+code;}
      catch(error){state.error='Print failed: '+String(error?.message||error);}render();
    };
    async function moveContainer(){
      if(!V3.base.validContainer(state.code))throw new Error('Current search is not a tsX/csX container');
      const floor=shell.body.querySelector('[data-floor]')?.value||'P2';
      const type=shell.body.querySelector('[data-drop]')?.value||'PRIME';
      const dest=V3.moveContainer.destination(floor,type);if(!dest)throw new Error('No destination');
      state.message='Moving '+state.code+' → '+dest;render();
      try{await V3.moveContainer.move(state.code,dest,{telemetry});state.message='MOVED → '+dest;}
      catch(error){state.error=(error?.outcome==='unknown'?'OUTCOME UNKNOWN — VERIFY · ':'')+String(error?.message||error);}
      render();
    };
    function render(){
      const root=document.createElement('div'),product=state.product,rows=state.inventory?.rows||[],dupes=conflicts(rows);
      root.innerHTML=
        '<section class="v3-section"><h3>FCResearch</h3>'+
          '<label class="v3-field">Search<input data-code value="'+V3.base.esc(state.code)+'" autocomplete="off"></label>'+
          '<div class="v3-row"><button class="v3-btn primary" data-load>'+(state.loading?'LOADING…':'LOAD')+'</button>'+
          (rows.length?'<button class="v3-btn" data-floors>'+(state.floorRunning?'RESOLVING…':'P-LEVELS')+'</button>':'')+'</div>'+
          '<div class="v3-note" style="margin-top:7px">'+V3.base.esc(state.message)+(state.error?' · '+V3.base.esc(state.error):'')+'</div>'+
        '</section>'+
        (product?'<section class="v3-section"><h3>'+V3.base.esc(product.title||product.primary||'Product')+'</h3>'+
          '<div class="v3-grid">'+
            [['ASIN',product.asin],['FNSKU',product.fnsku],['FCSKU',product.fcsku],['Sortable',product.sortableText],['Dimensions',product.dimensions],['Weight',product.weight]].map(([label,value])=>
              '<div class="v3-note"><b>'+label+'</b><br>'+(value?'<button class="v3-btn" data-print="'+V3.base.esc(value)+'">'+V3.base.esc(value)+'</button>':'—')+'</div>'
            ).join('')+
          '</div>'+(product.suspicious?'<div class="v3-note" style="color:var(--v3-warn);margin-top:8px"><b>SUSPICIOUS DIMENSIONS</b></div>':'')+
        '</section>':'')+
        (V3.base.validContainer(state.code)?'<section class="v3-section"><h3>Move container</h3><div class="v3-grid">'+
          '<label class="v3-field">Floor<select data-floor>'+V3.moveContainer.FLOORS.map(f=>'<option>'+f+'</option>').join('')+'</select></label>'+
          '<label class="v3-field">Drop<select data-drop></select></label></div><button class="v3-btn" data-move>MOVE '+V3.base.esc(state.code)+'</button></section>':'')+
        (dupes.length?'<section class="v3-section"><h3 style="color:var(--v3-bad)">FCSKU CONFLICTS · '+dupes.length+'</h3>'+
          '<div class="v3-list">'+dupes.map(group=>'<div class="v3-item" data-state="attention"><span>'+V3.base.esc(group.container)+'<br><small>'+V3.base.esc(group.fnsku)+'</small></span><b>'+V3.base.esc([...group.fcskus].join(' + '))+'</b></div>').join('')+'</div></section>':'')+
        (rows.length?'<section class="v3-section"><h3>Inventory · '+rows.length+' rows · '+(state.inventory?.totalQuantity??'?')+' units</h3><div class="v3-list">'+rows.map(row=>{
          const pod=V3.base.clean(row.container).match(/\bP-\d-(?:[A-Z]\d{3}){2}\b/i)?.[0]?.toUpperCase()||'';
          const floor=pod?(state.floors.get(pod)||'…'):'';
          return'<div class="v3-item"><span>'+V3.base.esc(row.container||'—')+(floor?' · '+floor:'')+'<br><small>'+V3.base.esc(row.fnsku||row.fcsku||row.asin||'')+'</small></span><b>'+Number(row.qty||0)+'</b></div>';
        }).join('')+'</div></section>':'');
      shell.setContent(root);
      const input=shell.body.querySelector('[data-code]');
      input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();load();}};
      shell.body.querySelector('[data-load]').onclick=load;
      shell.body.querySelector('[data-floors]')?.addEventListener('click',resolveFloors);
      for(const button of shell.body.querySelectorAll('[data-print]')){
        const code=button.dataset.print;
        if(!/^(?:B0[A-Z0-9]{8}|X0[A-Z0-9]{8}|ZZ[A-Z0-9]{8})$/i.test(code))button.disabled=true;
        else button.onclick=()=>print(code,product?.title||'');
      }
      const floor=shell.body.querySelector('[data-floor]'),drop=shell.body.querySelector('[data-drop]');
      const paintDrops=()=>{
        if(!drop||!floor)return;
        drop.innerHTML=V3.moveContainer.choices(floor.value).map(([name])=>'<option>'+V3.base.esc(name)+'</option>').join('');
      };
      if(floor){floor.value=settings.get('floor','P2');floor.onchange=()=>{settings.set('floor',floor.value);paintDrops();};paintDrops();}
      shell.body.querySelector('[data-move]')?.addEventListener('click',moveContainer);
    }
    return Object.freeze({render,load,state});
  }
  return Object.freeze({create});
})();