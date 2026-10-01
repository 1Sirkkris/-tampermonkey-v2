V3.boot = () => {
  const VERSION=V3.build.version;
  const life=V3.lifecycle.create('poportal');
  const telemetry=V3.telemetry.create('poportal',VERSION);
  if(/^\/poportal\/?$/i.test(location.pathname)){
    location.replace('/poportal/fe'+location.search+location.hash);
    return;
  }

  const shell=V3.ui.createShell({
    id:'bwu2-v3-poportal',title:'BWU2 V3 PO Portal',subtitle:'ISS Lite',version:VERSION,life,tabs:[]
  });
  V3.screenshot.install({life,roots:[shell.host]});

  const CONDITIONS=['Complete','CompletelyConfirmed','PartiallyConfirmed','Submitted','Reserved','Confirmed'];
  const KEEP=[
    /^po id\b/i,/^status\b/i,/^fc\b/i,/^ordered\b/i,/^shipped\b/i,
    /^first recv\b/i,/^last recv\b/i,/^exp(?:\b|\W)/i,/^rec(?:\b|\W)/i,/^disc(?:\b|\W)/i
  ];
  let full=false,applyQueued=false;

  const pad=n=>String(n).padStart(2,'0');
  const fmt=date=>date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate());
  const monthsAgo=(date,months)=>{
    const out=new Date(date.getFullYear(),date.getMonth(),1);
    const day=date.getDate();out.setMonth(out.getMonth()-months);
    out.setDate(Math.min(day,new Date(out.getFullYear(),out.getMonth()+1,0).getDate()));
    return out;
  };
  const defaults=()=>{
    const p=new URLSearchParams(location.search),today=new Date();
    return{asin:p.get('asin')||'',start:p.get('startDate')||fmt(monthsAgo(today,6)),end:p.get('endDate')||fmt(today)};
  };
  const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(new Date(value+'T00:00:00').getTime());
  const normalize=text=>V3.base.clean(String(text||'').replace(/[↑↓↕⇅]/g,' '));
  function tableHeader(table){
    return [...table.rows].find(row=>{
      const vals=[...row.cells].map(c=>normalize(c.textContent));
      return vals.some(v=>/^po id\b/i.test(v))&&vals.some(v=>/^status\b/i.test(v))&&vals.some(v=>/^fc\b/i.test(v));
    })||null;
  }
  function applyLite(){
    applyQueued=false;
    for(const table of document.querySelectorAll('table')){
      const header=tableHeader(table);if(!header)continue;
      const keep=[...header.cells].map(c=>KEEP.some(re=>re.test(normalize(c.textContent))));
      if(keep.filter(Boolean).length<6)continue;
      for(const row of table.rows){
        if(row.cells.length!==header.cells.length)continue;
        [...row.cells].forEach((cell,i)=>{cell.style.display=full||keep[i]?'':'none';});
      }
      table.dataset.bwu2V3Po='1';
    }
  }
  function schedule(){
    if(applyQueued)return;applyQueued=true;
    requestAnimationFrame(applyLite);
  }
  function render(){
    const d=defaults();
    const root=document.createElement('div');
    root.innerHTML='<section class="v3-section"><h3>PO search</h3>'+
      '<label class="v3-field">ASIN / FNSKU<input data-asin value="'+V3.base.esc(d.asin)+'" autocomplete="off"></label>'+
      '<div class="v3-grid"><label class="v3-field">Start<input data-start type="date" value="'+V3.base.esc(d.start)+'"></label>'+
      '<label class="v3-field">End<input data-end type="date" value="'+V3.base.esc(d.end)+'"></label></div>'+
      '<div class="v3-row"><button class="v3-btn primary" data-search>SEARCH</button><button class="v3-btn" data-view>'+(full?'LITE VIEW':'FULL PORTAL')+'</button></div>'+
      '<div class="v3-note" data-error></div></section>';
    shell.setContent(root);
    const run=()=>{
      const asin=V3.base.upper(shell.body.querySelector('[data-asin]').value);
      const start=shell.body.querySelector('[data-start]').value;
      const end=shell.body.querySelector('[data-end]').value;
      const err=shell.body.querySelector('[data-error]');
      if(!asin){err.textContent='Enter ASIN / FNSKU';return;}
      if(!validDate(start)||!validDate(end)||new Date(start)>new Date(end)){err.textContent='Check date range';return;}
      const url=new URL('/poportal/fe',location.origin);
      url.searchParams.set('asin',asin);
      url.searchParams.set('startDate',start);url.searchParams.set('endDate',end);
      url.searchParams.set('countries','AU');
      url.searchParams.set('distributorChecks',CONDITIONS.join(','));
      url.searchParams.set('removeZeroFilter','false');
      telemetry.emit('search',{code:V3.telemetry.mask(asin),start,end});
      location.assign(url.href);
    };
    shell.body.querySelector('[data-search]').onclick=run;
    shell.body.querySelector('[data-asin]').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();run();}};
    shell.body.querySelector('[data-view]').onclick=()=>{full=!full;schedule();render();};
  }

  // One result-table observer; no UI attachment reconciliation.
  life.observe(document.body,records=>{
    if(records.some(r=>r.addedNodes?.length||r.removedNodes?.length))schedule();
  },{childList:true,subtree:true});
  render();applyLite();
};