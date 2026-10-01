V3.boot = () => {
  const VERSION=V3.build.version;
  const life=V3.lifecycle.create('fnsku');
  const telemetry=V3.telemetry.create('fnsku',VERSION);
  const shell=V3.ui.createShell({
    id:'bwu2-v3-fnsku',title:'BWU2 V3 FNSKU Mapping',subtitle:'Exact regional mapping',version:VERSION,life,tabs:[]
  });
  V3.screenshot.install({life,roots:[shell.host]});

  const HOSTS={
    na:'fba-fnsku-commingling-console-na.aka.amazon.com',
    eu:'fba-fnsku-commingling-console-eu.aka.amazon.com',
    jp:'fba-fnsku-commingling-console-jp.aka.amazon.com'
  };
  let running=false,last=null;

  const token=()=>{
    try{
      const fromUrl=new URL(location.href).searchParams.get('anti-csrftoken-a2z');
      if(fromUrl)return fromUrl;
    }catch{}
    return document.querySelector('input[name="anti-csrftoken-a2z"],textarea[name="anti-csrftoken-a2z"]')?.value||'';
  };
  const buildUrl=(region,type,{fnsku='',asin=''}={})=>{
    const url=new URL('/tool/fnsku-mappings-tool/get','https://'+HOSTS[region]);
    url.searchParams.set('getMappingsType',type);
    url.searchParams.set('FNSku','');
    url.searchParams.set('FNSkus',fnsku?fnsku+'\r\n':'');
    url.searchParams.set('merchantId','');
    url.searchParams.set('MSkus','');
    url.searchParams.set('ASIN',asin);
    url.searchParams.set('includeInactive','true');
    url.searchParams.set('includeInternalMerchants','false');
    if(token())url.searchParams.set('anti-csrftoken-a2z',token());
    url.searchParams.set('submit','get');
    url.searchParams.set('paginationToken','');
    return url.toString();
  };
  const parseRows=html=>{
    const doc=V3.base.parseHtml(html);
    const table=doc.querySelector('#fnsku-table')||doc.querySelector('table.table');
    if(!table)return[];
    const rows=[...table.querySelectorAll('tr')];
    if(rows.length<2)return[];
    const headers=[...rows[0].querySelectorAll('th,td')].map(x=>V3.base.lower(x.textContent));
    const index={
      merchant:headers.findIndex(h=>/merchant\s*id/.test(h)),
      msku:headers.findIndex(h=>/msku/.test(h)),
      fnsku:headers.findIndex(h=>/fnsku/.test(h)),
      asin:headers.findIndex(h=>/^asin$/.test(h)),
      condition:headers.findIndex(h=>/condition/.test(h)),
      status:headers.findIndex(h=>/status/.test(h))
    };
    return rows.slice(1).map(row=>{
      const cells=[...row.querySelectorAll('td')].map(x=>V3.base.clean(x.textContent));
      const get=i=>i>=0&&i<cells.length?cells[i]:'';
      return{
        merchantId:get(index.merchant),msku:get(index.msku),
        fnsku:V3.base.upper(get(index.fnsku)),asin:V3.base.upper(get(index.asin)),
        condition:get(index.condition),status:get(index.status)
      };
    }).filter(row=>row.fnsku||row.asin);
  };
  const uniqueRows=rows=>{
    const seen=new Set();
    return rows.filter(row=>{
      const key=[row.merchantId,row.msku,row.fnsku,row.asin,row.condition,row.status].map(V3.base.upper).join('|');
      if(seen.has(key))return false;seen.add(key);return true;
    });
  };
  const get=async(url,label)=>{
    const result=await V3.api.gmRequest(url,{
      headers:{Accept:'text/html, */*; q=0.01','X-Requested-With':'XMLHttpRequest'},
      timeout:10000,telemetry,allowHtml:true
    });
    if(/sign\s*in|sso\/login|is_authenticated/i.test(result.raw)&&!/fnsku-table/i.test(result.raw)){
      throw new Error(label+': authentication required');
    }
    return result;
  };
  const lookupFnsku=async(region,code)=>{
    const result=await get(buildUrl(region,'FNSKU_MAPPINGS',{fnsku:code}),region.toUpperCase());
    const rows=parseRows(result.raw).filter(row=>row.fnsku===code);
    return{region,rows,asins:[...new Set(rows.map(row=>row.asin).filter(x=>/^B0[A-Z0-9]{8}$/.test(x)))]};
  };
  const lookupAsin=async asin=>{
    const result=await get(buildUrl('jp','ASIN_MAPPINGS',{asin}),'JP/AU');
    const rows=uniqueRows(parseRows(result.raw).filter(row=>row.asin===asin));
    return{region:'JP',rows,fnskus:[...new Set(rows.map(row=>row.fnsku).filter(Boolean))]};
  };

  const matchRank=(row,sourceRows)=>{
    const merchant=V3.base.upper(row.merchantId);
    const msku=V3.base.upper(row.msku);
    const both=merchant&&msku&&sourceRows.some(x=>V3.base.upper(x.merchantId)===merchant&&V3.base.upper(x.msku)===msku);
    if(both)return{rank:3,label:'BOTH'};
    if(msku&&sourceRows.some(x=>V3.base.upper(x.msku)===msku))return{rank:2,label:'MSKU'};
    if(merchant&&sourceRows.some(x=>V3.base.upper(x.merchantId)===merchant))return{rank:1,label:'MERCHANT'};
    return{rank:0,label:'—'};
  };
  const copy=text=>{try{GM_setClipboard(String(text),'text');}catch{navigator.clipboard?.writeText(String(text)).catch(()=>{});}};

  function table(rows,candidates=false){
    if(!rows.length)return'<div class="v3-note">No exact rows returned.</div>';
    return'<div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font:10px Consolas,monospace"><thead><tr>'+
      (candidates?'<th>Match</th>':'')+'<th>Merchant</th><th>MSKU</th><th>FNSKU</th><th>ASIN</th><th>State</th></tr></thead><tbody>'+
      rows.map(row=>'<tr>'+
        (candidates?'<td>'+V3.base.esc(row.match?.label||'—')+'</td>':'')+
        [row.merchantId,row.msku,row.fnsku,row.asin,[row.condition,row.status].filter(Boolean).join(' · ')].map(value=>
          '<td style="border-top:1px solid #384559;padding:5px">'+(value?'<button class="v3-btn" style="min-height:24px;padding:3px 5px" data-copy="'+V3.base.esc(value)+'">'+V3.base.esc(value)+'</button>':'—')+'</td>'
        ).join('')+'</tr>').join('')+
      '</tbody></table></div>';
  }
  function render(){
    const root=document.createElement('div');
    root.innerHTML='<section class="v3-section"><h3>FNSKU / ASIN</h3>'+
      '<label class="v3-field">Barcode<input data-code autocomplete="off" placeholder="X004... or B0..."></label>'+
      '<button class="v3-btn primary" data-run>'+(running?'RUNNING…':'LOOKUP')+'</button>'+
      '<div class="v3-note" style="margin-top:7px">Exact attribution only. Foreign FNSKU → ASIN → JP/AU candidates.</div></section>'+
      (last?.html||'');
    shell.setContent(root);
    const input=shell.body.querySelector('[data-code]');
    if(last?.code)input.value=last.code;
    input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();run();}};
    shell.body.querySelector('[data-run]').onclick=run;
    for(const button of shell.body.querySelectorAll('[data-copy]'))button.onclick=()=>copy(button.dataset.copy);
  }
  async function run(){
    if(running)return;
    const input=shell.body.querySelector('[data-code]');
    const code=V3.base.upper(input?.value);
    if(!code)return;
    running=true;shell.setStatus('LOOKING','work');last={code,html:''};render();
    try{
      if(/^B0[A-Z0-9]{8}$/.test(code)){
        const jp=await lookupAsin(code);
        last.html='<section class="v3-section"><h3>JP / AU mappings · '+V3.base.esc(code)+'</h3>'+table(jp.rows,false)+'</section>';
        shell.setStatus(jp.rows.length?'FOUND':'NO EXACT','');
      }else{
        const settled=await Promise.allSettled([lookupFnsku('na',code),lookupFnsku('eu',code)]);
        const found=settled.filter(x=>x.status==='fulfilled').map(x=>x.value).filter(x=>x.asins.length);
        const asins=[...new Set(found.flatMap(x=>x.asins))];
        if(!asins.length){
          const jpSource=await lookupFnsku('jp',code);
          for(const asin of jpSource.asins)asins.push(asin);
          if(!asins.length)throw new Error('No exact FNSKU mapping found in NA, EU or JP/AU');
          found.push(jpSource);
        }
        if(asins.length!==1)throw new Error('Multiple exact ASINs returned — stopped instead of guessing: '+asins.join(', '));
        const asin=asins[0];
        const sourceRows=uniqueRows(found.flatMap(x=>x.rows).filter(x=>x.asin===asin));
        const jp=await lookupAsin(asin);
        const candidates=jp.rows.map(row=>({...row,match:matchRank(row,sourceRows)}))
          .sort((a,b)=>b.match.rank-a.match.rank||String(a.fnsku).localeCompare(String(b.fnsku)));
        last.html='<section class="v3-section"><h3>ASIN · '+V3.base.esc(asin)+'</h3>'+table(sourceRows,false)+'</section>'+
          '<section class="v3-section"><h3>JP / AU candidates</h3><div class="v3-note">Merchant/MSKU matches are ranking hints only.</div>'+table(candidates,true)+'</section>';
        shell.setStatus('FOUND','');
      }
      telemetry.emit('lookup',{input:V3.telemetry.mask(code),ok:true});
    }catch(error){
      last.html='<section class="v3-section"><h3>Lookup stopped</h3><div class="v3-note">'+V3.base.esc(error?.message||error)+'</div></section>';
      shell.setStatus('ERROR','bad');
      telemetry.emit('lookup',{input:V3.telemetry.mask(code),ok:false,message:String(error?.message||error)});
    }finally{running=false;render();}
  }
  render();
};