V3.boot=()=>{
  const C=V3.core,life=C.lifecycle('fnsku'),telemetry=C.telemetry('fnsku',V3.build.version);
  const HOSTS={na:'fba-fnsku-commingling-console-na.aka.amazon.com',eu:'fba-fnsku-commingling-console-eu.aka.amazon.com',jp:'fba-fnsku-commingling-console-jp.aka.amazon.com'};
  const isAsin=value=>/^(?:B[A-Z0-9]{9}|\d{9}[\dX])$/.test(value);
  const token=()=>new URL(location.href).searchParams.get('anti-csrftoken-a2z')||document.querySelector('[name="anti-csrftoken-a2z"]')?.value||'';
  const build=(region,type,{fnsku='',asin=''}={})=>{
    const u=new URL('/tool/fnsku-mappings-tool/get','https://'+HOSTS[region]);
    for(const [k,v] of Object.entries({getMappingsType:type,FNSku:'',FNSkus:fnsku?fnsku+'\r\n':'',merchantId:'',MSkus:'',ASIN:asin,includeInactive:'true',includeInternalMerchants:'false',submit:'get',paginationToken:''}))u.searchParams.set(k,v);
    if(token())u.searchParams.set('anti-csrftoken-a2z',token());return u;
  };
  function parse(raw){
    const doc=C.html(raw),table=doc.querySelector('#fnsku-table')||doc.querySelector('table.table');
    if(!table)throw new Error('Mapping table unavailable; check authentication');
    const rows=[...table.querySelectorAll('tr')],heads=[...rows[0]?.querySelectorAll('th,td')||[]].map(x=>C.lower(x.textContent));
    const idx={merchant:heads.findIndex(x=>/merchant\s*id/.test(x)),msku:heads.findIndex(x=>/msku/.test(x)),fnsku:heads.findIndex(x=>/^fnsku$/.test(x)),asin:heads.findIndex(x=>/^asin$/.test(x)),condition:heads.findIndex(x=>/condition/.test(x)),status:heads.findIndex(x=>/status/.test(x))};
    if(idx.fnsku<0||idx.asin<0)throw new Error('Mapping columns unavailable');
    const data=rows.slice(1).flatMap(tr=>{
      const cells=[...tr.querySelectorAll('td')];if(!cells.length)return[];
      if(cells.length===1&&cells[0].colSpan>1&&/no\s+(?:results|mappings|records|data)|not found/i.test(cells[0].textContent))return[];
      if(cells.length<=Math.max(idx.fnsku,idx.asin))throw new Error('Incomplete mapping row');
      const get=i=>i>=0?C.clean(cells[i]?.textContent):'';
      const row={merchantId:get(idx.merchant),msku:get(idx.msku),fnsku:C.upper(get(idx.fnsku)),asin:C.upper(get(idx.asin)),condition:get(idx.condition),status:get(idx.status)};
      if(!row.fnsku||!isAsin(row.asin))throw new Error('Invalid mapping identity');return[row];
    });
    return{doc,rows:data};
  }
  function continuation(doc,current){
    const next=[...doc.querySelectorAll('a,button,input[type="button"],input[type="submit"]')].find(el=>/^next\s*>?$/i.test(C.clean(el.textContent||el.value))&&!el.disabled&&el.getAttribute('aria-disabled')!=='true'&&!el.closest('.disabled'));
    if(!next)return null;
    const href=next.getAttribute('href');let url;
    if(href&&!/^(?:javascript:|#)/i.test(href))url=new URL(href,current);
    else{
      const form=next.closest('form')||(next.getAttribute('form')?doc.getElementById(next.getAttribute('form')):null);
      if(form&&C.lower(form.getAttribute('method')||'get')==='get'){
        url=new URL(next.getAttribute('formaction')||form.getAttribute('action')||current,current);
        // Retain the exact lookup even when the native next form contains only its cursor.
        url.search=new URL(current).search;
        for(const control of form.querySelectorAll('input,select,textarea,button')){
          if(!control.name||control.disabled)continue;
          const type=C.lower(control.type);if(['submit','button','reset','file'].includes(type)&&control!==next)continue;
          if(['checkbox','radio'].includes(type)&&!control.checked)continue;
          url.searchParams.set(control.name,control.value||'');
        }
      }else{
        const cursor=doc.querySelector('[name="paginationToken"]')?.value;
        if(!cursor)throw new Error('Next page unavailable');
        url=new URL(current);url.searchParams.set('paginationToken',cursor);
      }
    }
    const original=new URL(current);
    if(url.origin!==original.origin||url.pathname!==original.pathname)throw new Error('Unexpected mapping continuation');
    for(const key of ['getMappingsType','FNSkus','ASIN']){
      if(url.searchParams.has(key)&&url.searchParams.get(key)!==original.searchParams.get(key))throw new Error('Mapping continuation changed lookup');
      url.searchParams.set(key,original.searchParams.get(key)||'');
    }
    return url;
  }
  async function lookup(region,type,identity,signal){
    let url=build(region,type,identity);const seen=new Set(),rows=[];
    for(let page=0;page<100;page++){
      if(signal.aborted)throw new DOMException('Aborted','AbortError');
      if(seen.has(url.href))throw new Error('Repeated mapping continuation');seen.add(url.href);
      const response=await C.request(url.href,{headers:{Accept:'text/html, */*; q=0.01','X-Requested-With':'XMLHttpRequest'},timeout:12000,allowHtml:true,signal});
      if(response.finalUrl){const final=new URL(response.finalUrl);if(final.origin!==url.origin||final.pathname!==url.pathname)throw new Error('Mapping authentication redirect');}
      const parsed=parse(response.raw);rows.push(...parsed.rows.filter(row=>type==='FNSKU_MAPPINGS'?row.fnsku===identity.fnsku:row.asin===identity.asin).map(row=>({...row,region})));
      const next=continuation(parsed.doc,url);if(!next)return rows;url=next;
    }
    throw new Error('Mapping page limit reached');
  }
  const unique=rows=>{const seen=new Set();return rows.filter(row=>{const key=JSON.stringify(row);if(seen.has(key))return false;seen.add(key);return true;});};
  const panel=C.panel({id:'fnsku',title:'V3 · FNSKU Mapping',width:760,life});let mounted=false,generation=0,controller=null;
  life.own(()=>{generation++;controller?.abort();});
  const mount=()=>{
    if(mounted)return;mounted=true;const root=document.createElement('div');
    root.innerHTML='<section class="v3-section"><label class="v3-field">FNSKU / ASIN<input data-code autocomplete="off"></label><button class="v3-btn primary" data-run>LOOKUP</button><div class="v3-note" data-msg></div></section><section class="v3-section"><div data-out></div></section>';panel.set(root);
    const input=root.querySelector('[data-code]'),msg=root.querySelector('[data-msg]'),out=root.querySelector('[data-out]'),button=root.querySelector('[data-run]');
    input.addEventListener('input',()=>{generation++;controller?.abort();button.disabled=false;msg.textContent='';out.replaceChildren();});
    function show(rows,title){
      if(!rows.length)return;const section=document.createElement('section');section.className='v3-section';const heading=document.createElement('b');heading.textContent=title;section.append(heading);
      for(const row of unique(rows)){
        const line=document.createElement('div');line.className='v3-list-row';line.append(row.region.toUpperCase()+' · ');
        for(const value of [row.fnsku,row.asin]){const copy=document.createElement('button');copy.className='v3-btn';copy.textContent=value;copy.dataset.copy=value;copy.onclick=()=>{if(typeof GM_setClipboard==='function')GM_setClipboard(value,'text');else navigator.clipboard?.writeText(value);};line.append(copy,' · ');}
        line.append([row.msku,row.merchantId,row.condition,row.status].filter(Boolean).join(' · '));section.append(line);
      }
      out.append(section);
    }
    button.onclick=async()=>{
      const code=C.upper(input.value);if(!code)return;
      if(!/^[A-Z0-9]{10}$/.test(code)){msg.textContent='Enter a 10-character FNSKU / ASIN';return;}
      const run=++generation;controller?.abort();const abort=new AbortController();controller=abort;button.disabled=true;out.replaceChildren();msg.className='v3-note v3-warn';msg.textContent='LOOKING…';
      const current=()=>run===generation&&!life.disposed&&code===C.upper(input.value);
      try{
        let asin=code,source=[],warnings=[];
        if(!isAsin(code)){
          const regions=['na','eu','jp'],settled=await Promise.allSettled(regions.map(region=>lookup(region,'FNSKU_MAPPINGS',{fnsku:code},abort.signal)));if(!current())return;
          settled.forEach((result,index)=>{if(result.status==='fulfilled')source.push(...result.value);else warnings.push(regions[index].toUpperCase()+': '+result.reason.message);});
          const asins=[...new Set(source.map(row=>row.asin))];
          if(asins.length!==1)throw new Error(asins.length?'Multiple exact ASINs found — stopped instead of guessing':warnings.length?'Regional lookup failed · '+warnings.join(' · '):'No exact FNSKU mapping');
          asin=asins[0];
        }
        let related=[];
        try{related=await lookup('jp','ASIN_MAPPINGS',{asin},abort.signal);}catch(error){if(!source.length)throw error;warnings.push('JP ASIN: '+error.message);}
        if(!current())return;
        msg.className='v3-note '+(warnings.length?'v3-warn':'v3-ok');msg.textContent='ASIN '+asin+(warnings.length?' · PARTIAL REGIONS · '+warnings.join(' · '):' · Complete regional reads');
        show(source,'Exact input FNSKU mappings');show(related,isAsin(code)?'JP/AU exact ASIN mappings':'JP/AU related ASIN mappings — may contain other FNSKUs');
        if(!source.length&&!related.length)out.textContent='No exact rows.';
        telemetry.emit('lookup',{input:C.mask(code),asin:C.mask(asin),rows:source.length+related.length,partial:warnings.length>0});
      }catch(error){if(current()){msg.className='v3-note v3-bad';msg.textContent=error.message;}}
      finally{if(run===generation)button.disabled=false;}
    };
  };
  C.dockButton({id:'fnsku',label:'FNSKU',title:'V3 FNSKU Mapping',onClick:()=>{mount();panel.open();}});
};
