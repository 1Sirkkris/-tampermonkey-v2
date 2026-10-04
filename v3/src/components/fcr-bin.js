V3.fcrBin=(()=>{
  function create({life,telemetry,client,bin,current}={}){
    const panel=V3.ui.panel({id:'bwu2-v3-bin-panel',title:'V3 · Bin Check',width:760,life});
    const state={rows:[],floors:new Map(),filter:new Set(['P2','P3','P4']),message:''};
    let mounted=false;

    const open=()=>{mount();panel.open();};

    function mount(){
      if(mounted)return;mounted=true;
      const root=document.createElement('div');
      root.innerHTML='<section class="section"><div class="row"><button class="btn primary" data-snapshot>LOAD FULL INVENTORY</button><button class="btn" data-copy>COPY VISIBLE TSV</button><button class="btn" data-f="P2">P2</button><button class="btn" data-f="P3">P3</button><button class="btn" data-f="P4">P4</button></div><div class="note" data-msg style="margin-top:8px">No inventory loaded.</div></section><section class="section"><div data-list></div></section>';
      panel.set(root);
      const q=s=>root.querySelector(s);

      const conflictKeys=()=>{
        const groups=new Map();
        for(const row of state.rows){
          const key=V3.base.upper(row.container)+'|'+V3.base.upper(row.fnsku);
          if(!groups.has(key))groups.set(key,new Set());
          if(row.fcsku)groups.get(key).add(V3.base.upper(row.fcsku));
        }
        return new Set([...groups].filter(([,values])=>values.size>1).map(([key])=>key));
      };
      const visibleRows=()=>state.rows.filter(row=>{
        const pod=bin.podOf(row.container),floor=pod?state.floors.get(pod)||'PX':'PX';
        return !/^P[234]$/.test(floor)||state.filter.has(floor);
      });

      const paint=()=>{
        q('[data-msg]').textContent=state.message||state.rows.length+' row(s)';
        for(const button of root.querySelectorAll('[data-f]'))button.classList.toggle('primary',state.filter.has(button.dataset.f));
        const conflicts=conflictKeys();
        q('[data-list]').innerHTML=visibleRows().map(row=>{
          const pod=bin.podOf(row.container),floor=pod?state.floors.get(pod)||'…':'—';
          const conflict=conflicts.has(V3.base.upper(row.container)+'|'+V3.base.upper(row.fnsku));
          return '<div style="padding:7px;border-bottom:1px solid #39475b;'+(conflict?'border-left:5px solid #ff7068;padding-left:8px':'')+'"><span class="note">'+V3.base.esc(floor)+'</span> · <button class="btn" data-print="'+V3.base.esc(row.container)+'">'+V3.base.esc(row.container||'—')+'</button> · <button class="btn" data-print="'+V3.base.esc(row.fnsku)+'">'+V3.base.esc(row.fnsku||'—')+'</button> · '+V3.base.esc(row.fcsku||'—')+' · Q'+Number(row.qty||0)+'</div>';
        }).join('')||'<div class="note">No matching rows.</div>';
        for(const button of q('[data-list]').querySelectorAll('[data-print]')){
          button.onclick=async event=>{
            if(!event.altKey)return;
            try{await V3.print.barcode(button.dataset.print,{telemetry});state.message='Printed '+button.dataset.print;}
            catch(error){state.message='Print failed: '+error.message;}
            paint();
          };
        }
      };

      q('[data-snapshot]').onclick=async()=>{
        try{
          const search=current();if(!search)throw new Error('Search something in FCResearch first');
          state.message='Loading full inventory…';paint();
          const inventory=await client.inventory(search,{allowPartial:false});
          state.rows=inventory.rows;state.floors.clear();state.message='Resolving floors…';paint();
          const pods=[...new Set(state.rows.map(row=>bin.podOf(row.container)).filter(Boolean))];
          let cursor=0;
          const worker=async()=>{while(cursor<pods.length){const pod=pods[cursor++];state.floors.set(pod,await bin.floor(pod));paint();}};
          await Promise.all(Array.from({length:Math.min(8,pods.length)},worker));
          state.message='Ready · Alt-click container/FNSKU to print';paint();
          telemetry?.emit('bin.ready',{rows:state.rows.length,pods:pods.length});
        }catch(error){state.message='Bin Check failed: '+error.message;paint();}
      };
      for(const button of root.querySelectorAll('[data-f]'))button.onclick=()=>{state.filter.has(button.dataset.f)?state.filter.delete(button.dataset.f):state.filter.add(button.dataset.f);paint();};
      q('[data-copy]').onclick=()=>{
        const rows=visibleRows();
        const text=['Floor\tContainer\tASIN\tFNSKU\tFCSKU\tQty',...rows.map(row=>{
          const pod=bin.podOf(row.container),floor=pod?state.floors.get(pod)||'PX':'';
          return[floor,row.container,row.asin,row.fnsku,row.fcsku,row.qty].join('\t');
        })].join('\n');
        if(typeof GM_setClipboard==='function')GM_setClipboard(text,'text');else navigator.clipboard?.writeText(text);
        state.message='Copied '+rows.length+' visible row(s)';paint();
      };
      paint();
    }

    return Object.freeze({open});
  }
  return Object.freeze({create});
})();