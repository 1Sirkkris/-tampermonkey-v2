V3.fcrAudit = (() => {
  const C = V3.core;
  const strictInternal = code => /^(?:X0|ZZ)[A-Z0-9]{8}$/.test(C.upper(code));
  const preferredAliases=values=>{const all=values.map(C.upper).filter(Boolean),strict=all.filter(strictInternal);return new Set(strict.length?strict:all);};
  function create({inventory,product,onChange=()=>{},telemetry}={}) {
    let generation=0;
    const state={container:'',phase:'empty',rows:[],lookup:new Map(),scans:new Map(),pending:[],message:'Scan source container'};
    const paint=()=>onChange(state);
    const reset=()=>{generation++;Object.assign(state,{container:'',phase:'empty',rows:[],lookup:new Map(),scans:new Map(),pending:[],message:'Scan source container'});paint();};
    const index=rows=>{
      const map=new Map();
      for(const row of rows)for(const code of [row.asin,row.fnsku,row.fcsku]){
        const key=C.upper(code);if(!key)continue;if(!map.has(key))map.set(key,new Set());map.get(key).add(row);
      }
      return map;
    };
    const matches=(raw,metadata)=>{
      const exact=state.lookup.get(C.upper(raw));if(exact)return [...exact];
      if(strictInternal(raw))return [];
      const out=new Set();for(const code of [metadata?.asin,metadata?.isbn,metadata?.fnsku,metadata?.fcsku])
        for(const row of state.lookup.get(C.upper(code))||[])out.add(row);
      return [...out];
    };
    const allocate=(rows,quantity)=>{
      let left=quantity;
      for(const row of rows){const amount=Math.min(left,Math.max(0,row.qty-row._scan));row._scan+=amount;left-=amount;if(!left)break;}
      return left;
    };
    const totals=()=>({units:state.rows.reduce((sum,row)=>sum+row.qty,0),scanned:state.rows.reduce((sum,row)=>sum+row._scan,0),
      overage:[...state.scans.values()].reduce((sum,row)=>sum+row.overage,0)});
    async function load(container,{keepPending=false}={}) {
      const run=++generation,pending=keepPending?state.pending:[];
      Object.assign(state,{container,phase:'loading',rows:[],lookup:new Map(),scans:new Map(),pending,message:'Loading full inventory…'});paint();
      try{
        const result=await inventory(container,{onPreview:preview=>{if(run===generation){state.message='Loading inventory page '+preview.pages+'…';paint();}}});
        if(run!==generation)return;
        if(result.complete!==true || !Array.isArray(result.rows))throw new Error('Inventory is incomplete');
        state.rows=result.rows.map(row=>({...row,_scan:0}));state.lookup=index(state.rows);state.phase='ready';state.message='Ready';
        const queued=state.pending.splice(0);paint();
        for(const code of queued){if(run!==generation)break;await scan(code);}
      }catch(error){if(run===generation){state.phase='failed';state.rows=[];state.lookup=new Map();state.message='Inventory unavailable · '+error.message+' · '+state.pending.length+' scan(s) saved';paint();}}
    }
    async function scan(value){
      const raw=C.clean(value);if(!raw)return;
      if(C.container(raw)){
        if(!C.upper(state.container)||C.upper(raw)!==C.upper(state.container))return load(raw);
        if(state.phase==='failed')return load(raw,{keepPending:true});
        state.message=state.phase==='loading'?'Inventory loading · keep scanning':'Container already loaded';paint();return;
      }
      if(!state.container){state.message='SCAN SOURCE CONTAINER FIRST';paint();return;}
      if(state.phase!=='ready'){
        state.pending.push(raw);state.message=(state.phase==='failed'?'RETRY INVENTORY · ':'Loading inventory · ')+state.pending.length+' scan(s) saved';paint();return;
      }
      const key=C.upper(raw),old=state.scans.get(key);
      if(old){old.count++;if(old.state!=='checking'&&old.matches.length){old.overage+=allocate(old.matches,1);old.state=old.overage?'overage':'found';}
        state.message=raw+' ×'+old.count+(old.state==='checking'?' · checking':' · '+old.state.toUpperCase());paint();return;}
      const run=generation,record={raw,count:1,state:'checking',matches:[],product:null,overage:0};state.scans.set(key,record);paint();
      try{
        record.matches=matches(raw,null);
        // Native exact identifiers need no extra product request. Unresolved UPC/EAN scans still resolve through FCR.
        if(!record.matches.length&&!strictInternal(raw)){record.product=await product(raw);if(run!==generation)return;if(!record.product)throw new Error('Product barcode could not be resolved');record.matches=matches(raw,record.product);}
        if(run!==generation)return;
        if(record.matches.length){record.overage=allocate(record.matches,record.count);record.state=record.overage?'overage':'found';}
        else record.state='missing';
        state.message=record.state==='found'?'IN '+state.container:record.state==='overage'?'EXTRA '+record.overage+' · '+raw:'NOT IN '+state.container;
        telemetry?.emit('tote.scan',{code:C.mask(raw),found:record.matches.length>0,count:record.count,overage:record.overage});
      }catch(error){if(run!==generation)return;record.state='error';state.message=error.message;}
      paint();
    }
    const retry=()=>state.phase==='failed'&&state.container?load(state.container,{keepPending:true}):Promise.resolve();
    return Object.freeze({state,scan,reset,retry,totals});
  }
  return Object.freeze({create,preferredAliases});
})();
