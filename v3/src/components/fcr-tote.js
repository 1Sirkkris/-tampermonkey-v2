V3.fcrTote=(()=>{
  function create({life,telemetry,client}={}){
    const panel=V3.ui.panel({id:'bwu2-v3-tote-panel',title:'V3 · Tote Audit',width:700,life});
    let mounted=false;
    const open=()=>{mount();panel.open();};

    function mount(){
      if(mounted)return;mounted=true;
      const state={container:'',loading:false,rows:[],lookup:new Map(),pending:[],scans:new Map(),seq:0,message:'Scan source container'};
      const root=document.createElement('div');
      root.innerHTML='<section class="section"><div class="note" data-summary>Scan tsX/csX to begin.</div><label class="field" style="margin-top:8px">Scanner<input data-scan autocomplete="off"></label><div class="row"><button class="btn" data-reset>NEW TOTE</button></div><div class="note" data-msg style="margin-top:8px"></div></section><section class="section"><b>Physical scans</b><div data-scans style="margin-top:7px"></div></section><section class="section"><b>System inventory</b><div data-system style="margin-top:7px"></div></section>';
      panel.set(root);
      const q=s=>root.querySelector(s),scan=q('[data-scan]');

      const buildLookup=rows=>{
        const map=new Map();
        for(const row of rows){
          row._scan=0;
          for(const value of [row.asin,row.fnsku,row.fcsku]){
            const key=V3.base.upper(value);if(!key)continue;
            if(!map.has(key))map.set(key,[]);
            map.get(key).push(row);
          }
        }
        return map;
      };
      const allocate=(rows,count=1)=>{
        let remaining=count;
        for(const row of rows){
          if(remaining<=0)break;
          const available=Math.max(0,Number(row.qty||0)-Number(row._scan||0));
          const add=Math.min(available,remaining);
          row._scan+=add;remaining-=add;
        }
      };
      const matches=(product,raw)=>{
        const strict=/^(?:X0|ZZ)[A-Z0-9]{8}$/i.test(raw);
        const keys=(strict?[raw]:[raw,product?.asin,product?.isbn,product?.fnsku,product?.fcsku]).map(V3.base.upper).filter(Boolean);
        const out=[],seen=new Set();
        for(const key of keys){
          for(const row of state.lookup.get(key)||[]){
            const id=[row.container,row.asin,row.fnsku,row.fcsku,row.disposition].join('|');
            if(seen.has(id))continue;
            seen.add(id);out.push(row);
          }
        }
        return out;
      };

      const paint=()=>{
        const total=state.rows.reduce((sum,row)=>sum+Number(row.qty||0),0);
        const scanned=state.rows.reduce((sum,row)=>sum+Number(row._scan||0),0);
        q('[data-summary]').textContent=(state.container||'NO CONTAINER')+' · '+scanned+'/'+total+' units';
        q('[data-msg]').textContent=state.message;
        q('[data-scans]').innerHTML=[...state.scans.values()].reverse().map(rec=>
          '<div style="padding:6px;border-bottom:1px solid #39475b"><button class="btn" data-print="'+V3.base.esc(rec.raw)+'">'+V3.base.esc(rec.raw)+(rec.count>1?' ×'+rec.count:'')+'</button> · <span class="'+(rec.state==='found'?'ok':rec.state==='missing'?'bad':'warn')+'">'+rec.state.toUpperCase()+'</span></div>'
        ).join('')||'<div class="note">No scans.</div>';
        q('[data-system]').innerHTML=state.rows.map(row=>
          '<div style="padding:5px;border-bottom:1px solid #39475b"><b>'+V3.base.esc(row.fnsku||row.fcsku||row.asin||'—')+'</b> · '+Number(row._scan||0)+'/'+Number(row.qty||0)+' · '+V3.base.esc(row.title||row.asin||'')+'</div>'
        ).join('')||'<div class="note">No inventory loaded.</div>';
        for(const button of q('[data-scans]').querySelectorAll('[data-print]')){
          button.onclick=async()=>{
            const rec=state.scans.get(V3.base.upper(button.dataset.print));
            try{await V3.print.barcode(rec.raw,{description:rec.product?.title||'',telemetry});state.message='Printed '+rec.raw;}
            catch(error){state.message='Print failed: '+error.message;}
            paint();
          };
        }
      };

      const load=async code=>{
        const seq=++state.seq;
        state.container=code;state.loading=true;state.rows=[];state.lookup=new Map();state.pending=[];state.scans.clear();state.message='Loading full inventory…';paint();
        try{
          const result=await client.inventory(code,{allowPartial:false,onPreview:preview=>{if(seq===state.seq){state.message='Loading inventory page '+preview.pages;paint();}}});
          if(seq!==state.seq)return;
          state.rows=result.rows;state.lookup=buildLookup(result.rows);state.loading=false;state.message='Ready';
          const queued=state.pending.splice(0);paint();
          for(const value of queued)await handle(value);
        }catch(error){
          if(seq===state.seq){state.loading=false;state.message='Inventory failed: '+error.message;paint();}
        }
      };

      const handle=async value=>{
        const raw=V3.base.clean(value);if(!raw)return;
        if(!state.container){
          if(!V3.base.container(raw)){state.message='SCAN SOURCE CONTAINER FIRST';paint();return;}
          return load(raw);
        }
        if(V3.base.container(raw)&&V3.base.upper(raw)!==V3.base.upper(state.container))return load(raw);
        if(state.loading){state.pending.push(raw);state.message='Queued '+state.pending.length+' scan(s)';paint();return;}

        const key=V3.base.upper(raw),existing=state.scans.get(key);
        if(existing){existing.count++;allocate(existing.matches);state.message=raw+' ×'+existing.count;paint();return;}

        const rec={raw,count:1,state:'checking',matches:[],product:null};
        state.scans.set(key,rec);paint();
        try{
          let product=null;try{product=await client.product(raw);}catch{}
          rec.product=product;rec.matches=matches(product,raw);rec.state=rec.matches.length?'found':'missing';
          if(rec.matches.length)allocate(rec.matches);
          state.message=rec.matches.length?'IN '+state.container:'NOT IN '+state.container;
          telemetry?.emit('tote.scan',{code:V3.telemetry.mask(raw),found:Boolean(rec.matches.length)});
        }catch(error){rec.state='error';state.message=error.message;}
        paint();
      };

      scan.onkeydown=async event=>{
        if(event.key!=='Enter')return;
        event.preventDefault();
        const value=scan.value;scan.value='';
        await handle(value);
        scan.focus({preventScroll:true});
      };
      q('[data-reset]').onclick=()=>{
        state.seq++;
        Object.assign(state,{container:'',loading:false,rows:[],lookup:new Map(),pending:[],scans:new Map(),message:'Scan source container'});
        paint();scan.focus();
      };
      paint();
    }

    return Object.freeze({open});
  }
  return Object.freeze({create});
})();