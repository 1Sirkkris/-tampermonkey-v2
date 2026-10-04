V3.boot=()=>{
  const C=V3.core,life=C.lifecycle('fnsku'),telemetry=C.telemetry('fnsku',V3.build.version);
  const HOSTS={na:'fba-fnsku-commingling-console-na.aka.amazon.com',eu:'fba-fnsku-commingling-console-eu.aka.amazon.com',jp:'fba-fnsku-commingling-console-jp.aka.amazon.com'};
  const token=()=>new URL(location.href).searchParams.get('anti-csrftoken-a2z')||document.querySelector('[name="anti-csrftoken-a2z"]')?.value||'';
  const build=(region,type,{fnsku='',asin=''}={})=>{
    const u=new URL('/tool/fnsku-mappings-tool/get','https://'+HOSTS[region]);
    for(const [k,v] of Object.entries({getMappingsType:type,FNSku:'',FNSkus:fnsku?fnsku+'\r\n':'',merchantId:'',MSkus:'',ASIN:asin,includeInactive:'true',includeInternalMerchants:'false',submit:'get',paginationToken:''}))u.searchParams.set(k,v);
    if(token())u.searchParams.set('anti-csrftoken-a2z',token());return u;
  };
  const parse=raw=>{
    const doc=C.html(raw),table=doc.querySelector('#fnsku-table')||doc.querySelector('table.table');if(!table)return[];
    const rows=[...table.querySelectorAll('tr')];if(rows.length<2)return[];
    const heads=[...rows[0].querySelectorAll('th,td')].map(x=>C.lower(x.textContent));
    const idx={merchant:heads.findIndex(x=>/merchant\s*id/.test(x)),msku:heads.findIndex(x=>/msku/.test(x)),fnsku:heads.findIndex(x=>/fnsku/.test(x)),asin:heads.findIndex(x=>/^asin$/.test(x)),condition:heads.findIndex(x=>/condition/.test(x)),status:heads.findIndex(x=>/status/.test(x))};
    return rows.slice(1).map(tr=>{const cells=[...tr.querySelectorAll('td')].map(x=>C.clean(x.textContent)),get=i=>i>=0?cells[i]||'':'';return{merchantId:get(idx.merchant),msku:get(idx.msku),fnsku:C.upper(get(idx.fnsku)),asin:C.upper(get(idx.asin)),condition:get(idx.condition),status:get(idx.status)};}).filter(x=>x.fnsku||x.asin);
  };
  const request=async url=>(await C.request(url.toString(),{headers:{Accept:'text/html, */*; q=0.01','X-Requested-With':'XMLHttpRequest'},timeout:12000,allowHtml:true})).raw;
  const exactFnsku=async(region,fnsku)=>parse(await request(build(region,'FNSKU_MAPPINGS',{fnsku}))).filter(r=>r.fnsku===fnsku);
  const exactAsin=async asin=>parse(await request(build('jp','ASIN_MAPPINGS',{asin}))).filter(r=>r.asin===asin);
  const panel=C.panel({id:'fnsku',title:'V3 · FNSKU Mapping',width:760,life});let mounted=false,busy=false;
  const mount=()=>{if(mounted)return;mounted=true;const root=document.createElement('div');
    root.innerHTML='<section class="v3-section"><label class="v3-field">FNSKU / ASIN<input data-code autocomplete="off"></label><button class="v3-btn primary" data-run>LOOKUP</button><div class="v3-note" data-msg></div></section><section class="v3-section"><div data-out></div></section>';panel.set(root);
    const input=root.querySelector('[data-code]'),msg=root.querySelector('[data-msg]'),out=root.querySelector('[data-out]');
    const copy=text=>{if(typeof GM_setClipboard==='function')GM_setClipboard(text,'text');else navigator.clipboard?.writeText(text);};
    root.querySelector('[data-run]').onclick=async()=>{const code=C.upper(input.value);if(!code||busy)return;busy=true;root.querySelector('[data-run]').disabled=true;msg.className='v3-note v3-warn';msg.textContent='LOOKING…';out.innerHTML='';
      try{let asin='',source=[],notice='';if(/^(?:B[A-Z0-9]{9}|\d{9}[\dX])$/.test(code)){asin=code;}else{
        const settled=await Promise.allSettled(['na','eu','jp'].map(region=>exactFnsku(region,code)));const results=settled.filter(result=>result.status==='fulfilled').flatMap(result=>result.value);const missed=settled.filter(result=>result.status==='rejected');if(missed.length){notice=' · PARTIAL REGIONS '+missed.length;if(!results.length)throw new Error('Regional lookup failed · '+missed.map(result=>result.reason.message).join(' · '));}
        const asins=[...new Set(results.map(r=>r.asin).filter(x=>/^(?:B[A-Z0-9]{9}|\d{9}[\dX])$/.test(x)))];
        if(asins.length!==1)throw new Error(asins.length?'Multiple exact ASINs found — stopped instead of guessing':'No exact FNSKU mapping');
        asin=asins[0];source=results.filter(r=>r.asin===asin);
      }
      const jp=await exactAsin(asin);msg.className='v3-note '+(notice?'v3-warn':'v3-ok');msg.textContent='ASIN '+asin+' · '+jp.length+' JP/AU exact row(s)'+notice;
      const rows=(source.length?source:jp).concat(source.length?jp:[]);out.innerHTML=rows.map(r=>'<div class="v3-list-row"><button class="v3-btn" data-copy="'+C.esc(r.fnsku)+'">'+C.esc(r.fnsku||'—')+'</button> · <button class="v3-btn" data-copy="'+C.esc(r.asin)+'">'+C.esc(r.asin||'—')+'</button> · '+C.esc(r.msku||'—')+' · '+C.esc(r.merchantId||'—')+' · '+C.esc(r.status||'')+'</div>').join('')||'<div class="v3-note">No exact rows.</div>';
      for(const b of out.querySelectorAll('[data-copy]'))b.onclick=()=>copy(b.dataset.copy);
      telemetry.emit('lookup',{input:C.mask(code),asin:C.mask(asin),rows:jp.length});
      }catch(error){msg.className='v3-note v3-bad';msg.textContent=error.message;}finally{busy=false;root.querySelector('[data-run]').disabled=false;}
    };
  };
  C.dockButton({id:'fnsku',label:'FNSKU',title:'V3 FNSKU Mapping',onClick:()=>{mount();panel.open();}});
};