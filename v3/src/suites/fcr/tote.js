V3.fcrTote = (() => {
  function create(options){
    const life=options.life,client=options.client,telemetry=options.telemetry,shell=options.shell;
    const state={
      container:'',loading:false,rows:[],lookup:new Map(),pending:[],
      scans:new Map(),error:'',message:'Scan container',loadSeq:0
    };

    const buildLookup=rows=>{
      const map=new Map();
      for(const row of rows){
        row._v3Scanned=0;
        for(const code of [row.asin,row.fnsku,row.fcsku]){
          const key=V3.base.upper(code);if(!key)continue;
          if(!map.has(key))map.set(key,[]);
          map.get(key).push(row);
        }
      }
      return map;
    };
    const matchesFor=(product,raw)=>{
      const rawKey=V3.base.upper(raw);
      const strict=/^(?:X0|ZZ)[A-Z0-9]{8}$/.test(rawKey);
      const keys=(strict?[rawKey]:[
        rawKey,product?.asin,product?.isbn,product?.primary,product?.fnsku,product?.fcsku
      ]).map(V3.base.upper).filter(Boolean);
      const out=[],seen=new Set();
      for(const key of keys){
        for(const row of state.lookup.get(key)||[]){
          const id=[row.asin,row.fnsku,row.fcsku,row.disposition,row.consumer].map(V3.base.upper).join('|');
          if(seen.has(id))continue;seen.add(id);out.push(row);
        }
      }
      return out;
    };
    const allocate=(rows,amount=1)=>{
      let remaining=Math.max(0,Number(amount)||0);
      for(const row of rows||[]){
        if(remaining<=0)break;
        const qty=Math.max(0,Number(row.qty)||0),current=Math.max(0,Number(row._v3Scanned)||0);
        const add=Math.min(Math.max(0,qty-current),remaining);
        row._v3Scanned=current+add;remaining-=add;
      }
    };
    const coverage=()=>{
      const totalUnits=state.rows.reduce((sum,row)=>sum+(Number(row.qty)||0),0);
      const scannedUnits=state.rows.reduce((sum,row)=>sum+(Number(row._v3Scanned)||0),0);
      const keys=new Set(state.rows.map(row=>V3.base.upper(row.fnsku||row.fcsku||row.asin)).filter(Boolean));
      const scannedKeys=new Set(state.rows.filter(row=>Number(row._v3Scanned)>0).map(row=>V3.base.upper(row.fnsku||row.fcsku||row.asin)).filter(Boolean));
      return{totalUnits,scannedUnits,totalSkus:keys.size,scannedSkus:scannedKeys.size};
    };
    async function loadContainer(code){
      const container=V3.base.clean(code);
      if(!V3.base.validContainer(container))throw new Error('Container must be tsX/csX');
      const seq=++state.loadSeq;
      state.container=container;state.loading=true;state.rows=[];state.lookup=new Map();state.pending=[];state.scans.clear();
      state.error='';state.message='Loading full inventory · scans may queue';render();
      try{
        const result=await client.inventory(container,{
          allowPartial:false,
          onPreview:preview=>{if(seq===state.loadSeq){state.message='Inventory page '+preview.pages+' loading…';render();}}
        });
        if(seq!==state.loadSeq)return;
        if(!result.complete)throw new Error('Inventory incomplete');
        state.rows=result.rows;state.lookup=buildLookup(result.rows);state.loading=false;
        state.message=container+' ready · '+result.rows.length+' rows';
        telemetry.emit('tote.loaded',{container:V3.telemetry.mask(container),rows:result.rows.length,total:result.totalQuantity});
        const queued=state.pending.splice(0);
        render();
        for(const scan of queued)await handleScan(scan);
      }catch(error){
        if(seq!==state.loadSeq)return;
        state.loading=false;state.error=String(error?.message||error);state.message='Inventory failed';render();
      }
    }
    async function handleScan(value){
      const raw=V3.base.clean(value);if(!raw)return;
      if(!state.container){await loadContainer(raw);return;}
      if(V3.base.validContainer(raw)&&V3.base.upper(raw)!==V3.base.upper(state.container)){
        await loadContainer(raw);return;
      }
      if(state.loading){state.pending.push(raw);state.message='Queued '+state.pending.length+' scan'+(state.pending.length===1?'':'s');render();return;}

      const key=V3.base.upper(raw);
      const existing=state.scans.get(key);
      if(existing){
        existing.count++;allocate(existing.matches,1);state.message=raw+' ×'+existing.count+' rescanned';render();return;
      }

      const record={raw,count:1,state:'checking',matches:[],product:null,error:''};
      state.scans.set(key,record);state.message='Checking '+raw;render();
      try{
        let product=null;
        try{product=await client.product(raw);}catch(error){telemetry.emit('tote.product.error',{code:V3.telemetry.mask(raw),message:String(error?.message||error)});}
        const matches=matchesFor(product,raw);
        record.product=product;record.matches=matches;
        if(matches.length){
          record.state='found';allocate(matches,1);state.message='✓ '+raw+' IN '+state.container;
        }else{
          record.state='missing';state.message='✕ '+raw+' NOT IN '+state.container;
        }
        telemetry.emit('tote.scan',{code:V3.telemetry.mask(raw),found:Boolean(matches.length),matches:matches.length});
      }catch(error){
        record.state='error';record.error=String(error?.message||error);state.message='Check failed '+raw;
      }
      render();
    }
    const reset=()=>{
      state.loadSeq++;state.container='';state.loading=false;state.rows=[];state.lookup=new Map();state.pending=[];state.scans.clear();state.error='';state.message='Scan container';render();
    };
    function render(){
      const stats=coverage(),root=document.createElement('div');
      root.innerHTML=
        '<section class="v3-section"><h3>Tote Audit</h3>'+
          '<div class="v3-note">'+V3.base.esc(state.container||'NO CONTAINER')+' · '+stats.scannedSkus+'/'+stats.totalSkus+' SKU · '+stats.scannedUnits+'/'+stats.totalUnits+' units</div>'+
          '<label class="v3-field">Scanner<input data-scan autocomplete="off" placeholder="'+(state.container?'Scan item barcode':'Scan tsX / csX')+'"></label>'+
          '<div class="v3-row"><button class="v3-btn" data-reset>NEW TOTE</button></div>'+
          '<div class="v3-note" style="margin-top:7px">'+V3.base.esc(state.message)+(state.error?' · '+V3.base.esc(state.error):'')+'</div>'+
        '</section>'+
        '<section class="v3-section"><h3>Physical scans</h3><div class="v3-list" data-scans></div></section>'+
        '<section class="v3-section"><h3>System inventory</h3><div class="v3-list" data-system></div></section>';
      const scans=root.querySelector('[data-scans]');
      for(const record of [...state.scans.values()].reverse()){
        const row=document.createElement('div');row.className='v3-item';
        row.dataset.state=record.state==='found'?'done':record.state==='checking'?'active':record.state==='missing'||record.state==='error'?'attention':'';
        const qty=record.matches.reduce((sum,r)=>sum+(Number(r.qty)||0),0);
        const checked=Math.min(record.count,qty||record.count);
        row.innerHTML='<button class="v3-btn" data-print style="text-align:left">'+V3.base.esc(record.raw)+(record.count>1?' ×'+record.count:'')+'</button>'+
          '<b>'+(record.state==='found'?'IN '+state.container+(qty>1?' '+checked+'/'+qty:''):record.state.toUpperCase())+'</b>';
        row.querySelector('[data-print]').onclick=async()=>{
          try{
            await V3.print.barcode(record.raw,{description:record.product?.title||'',quantity:1,telemetry});
            state.message='Printed '+record.raw;render();
          }catch(error){state.message='Print failed: '+String(error?.message||error);render();}
        };
        scans.appendChild(row);
      }
      const sys=root.querySelector('[data-system]');
      for(const row of state.rows){
        const item=document.createElement('div');item.className='v3-item';item.dataset.state=Number(row._v3Scanned)>0?'done':'';
        item.innerHTML='<span>'+V3.base.esc(row.fnsku||row.fcsku||row.asin||'—')+
          '<br><small>'+V3.base.esc(row.title||row.asin||'')+'</small></span>'+
          '<b>'+Number(row._v3Scanned||0)+'/'+Number(row.qty||0)+'</b>';
        sys.appendChild(item);
      }
      shell.setContent(root);
      const scan=shell.body.querySelector('[data-scan]');
      scan.onkeydown=async event=>{
        if(event.key!=='Enter')return;event.preventDefault();
        const value=scan.value;scan.value='';await handleScan(value);scan.focus({preventScroll:true});
      };
      shell.body.querySelector('[data-reset]').onclick=reset;
    }
    return Object.freeze({render,handleScan,reset,state});
  }
  return Object.freeze({create});
})();