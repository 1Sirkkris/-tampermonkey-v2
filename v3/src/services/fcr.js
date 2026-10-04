V3.fcr=(()=>{
  const warehouse=()=>location.pathname.match(/^\/([^/]+)\/results(?:\/|$)/i)?.[1]||'';
  const base=()=>{const fc=warehouse();if(!fc)throw new Error('Warehouse not found in URL');return location.origin+'/'+encodeURIComponent(fc)+'/results';};
  const headers={'Content-Type':'application/x-www-form-urlencoded','Accept':'text/html, */*; q=0.01','X-Requested-With':'XMLHttpRequest'};
  const parseBool=v=>/^(true|yes|1)$/i.test(V3.base.clean(v))?true:/^(false|no|0)$/i.test(V3.base.clean(v))?false:null;
  const suspicious=value=>{
    let p=String(value||'').match(/\d+(?:\.\d+)?/g);if(!p||p.length<3)return false;p=p.slice(0,3);
    const n=p.map(Number),eq=(a,b)=>Math.abs(a-b)<.001,rounded=p.filter(x=>/\.00$/.test(x)).length;
    return eq(n[0],n[1])||eq(n[0],n[2])||eq(n[1],n[2])||rounded>=3||(Math.min(...n)<=2.001&&rounded>=2);
  };
  const parseProduct=raw=>{
    const doc=V3.base.html(raw);
    const table=doc.querySelector('.a-box-group .a-keyvalue')||[...doc.querySelectorAll('table')].find(t=>[...t.querySelectorAll('th')].some(th=>/^(asin|isbn|fnsku)$/i.test(V3.base.clean(th.textContent))))||doc.querySelector('.a-keyvalue');
    if(!table)return null;
    const data={};
    for(const row of table.querySelectorAll('tr')){const th=row.querySelector('th'),td=row.querySelector('td');if(th&&td)data[V3.base.lower(th.textContent)]=V3.base.clean(td.querySelector('a')?.textContent||td.textContent);}
    const sortable=parseBool(data.sortable);
    const product={asin:V3.base.clean(data.asin),isbn:V3.base.clean(data.isbn),fnsku:V3.base.clean(data.fnsku),fcsku:V3.base.clean(data.fcsku),title:V3.base.clean(data.title),dimensions:V3.base.clean(data.dimensions),weight:V3.base.clean(data.weight),inventoryCost:V3.base.clean(data['list price']||data.price||data['inventory cost']||''),sortable,sortableText:sortable==null?V3.base.clean(data.sortable):String(sortable),suspicious:suspicious(data.dimensions)};
    product.primary=product.asin||product.isbn;
    return product.primary||product.fnsku||product.fcsku?product:null;
  };
  const indexes=table=>{
    const hs=[...table.querySelectorAll('thead th')].map(th=>({id:V3.base.lower(th.id),text:V3.base.lower(String(th.textContent||'').replace(/\(\d+\)/g,''))}));
    const find=(...names)=>hs.findIndex(h=>names.includes(h.id)||names.includes(h.text));
    return{container:find('inventory-container','container'),asin:find('inventory-asin','asin'),fnsku:find('inventory-fnsku','fnsku'),fcsku:find('inventory-fcsku','fcsku'),lpn:find('inventory-lpn','lpn'),qty:find('inventory-quantity','quantity'),disposition:find('inventory-disposition','disposition'),consumer:find('inventory-consumer','consumer'),consumerId:find('inventory-consumer-id','consumer id','consumerid'),outerLocation:find('inventory-outer-location','outer location'),outerLocationType:find('inventory-outer-location-type','outer location type'),title:find('inventory-title','title')};
  };
  const parseInventory=doc=>{
    const table=doc.querySelector('#table-inventory');if(!table)throw new Error('Inventory table not returned');
    const idx=indexes(table),rows=[];
    for(const tr of table.tBodies?.[0]?.rows||[]){
      const val=i=>i>=0?V3.base.clean(tr.cells[i]?.textContent):'';
      const row={container:val(idx.container),asin:val(idx.asin),fnsku:val(idx.fnsku),fcsku:val(idx.fcsku),lpn:val(idx.lpn),qty:Number(val(idx.qty).replace(/[^\d.-]/g,''))||0,disposition:val(idx.disposition),consumer:val(idx.consumer),consumerId:val(idx.consumerId),outerLocation:val(idx.outerLocation),outerLocationType:val(idx.outerLocationType),title:val(idx.title)};
      if(row.asin||row.fnsku||row.fcsku)rows.push(row);
    }
    return rows;
  };
  const token=doc=>{const raw=V3.base.clean(doc.querySelector('.pagination-token')?.textContent);return raw&&/^(?:\{|\[)/.test(raw)?raw:'';};
  function create({telemetry,life}={}){
    const inFlight=new Map();
    const post=async(endpoint,fields)=>{
      const params=new URLSearchParams();for(const [k,v] of Object.entries(fields||{}))params.set(k,String(v??''));
      const key=endpoint+'|'+params.toString();if(inFlight.has(key))return inFlight.get(key);
      const work=(async()=>{let retry=0;for(;;){try{return(await V3.transport.page(base()+'/'+endpoint,{method:'POST',body:params.toString(),headers,allowHtml:true,signal:life?.signal})).raw;}catch(error){if(!(error.status>=500&&error.status<600)||retry>=2)throw error;await life.sleep([120,350][retry++]||350);}}})();
      inFlight.set(key,work);try{return await work;}finally{if(inFlight.get(key)===work)inFlight.delete(key);}
    };
    const product=async code=>parseProduct(await post('product',{s:V3.base.clean(code)}));
    const inventory=async(code,{allowPartial=false,onPreview}={})=>{
      const started=performance.now(),first=await post('inventory',{s:V3.base.clean(code)}),doc=V3.base.html(first),table=doc.querySelector('#table-inventory');
      if(!table)throw new Error('Inventory table not returned');
      const tbody=table.tBodies?.[0]||table.appendChild(doc.createElement('tbody')),expected=table.tHead?.rows?.[0]?.cells?.length||0,seen=new Set();
      let next=token(doc),pages=1,complete=true,warning='';
      onPreview?.({rows:parseInventory(doc),complete:!next,pages});
      while(next){
        if(seen.has(next)){complete=false;warning='repeated pagination token';if(!allowPartial)throw new Error('Inventory incomplete: '+warning);break;}
        if(pages>=200){complete=false;warning='pagination safety limit';if(!allowPartial)throw new Error('Inventory incomplete: '+warning);break;}
        seen.add(next);
        try{
          const moreDoc=V3.base.html(await post('inventory-more',{token:next}));pages++;
          const moreTable=moreDoc.querySelector('#table-inventory')||moreDoc.querySelector('table');
          const rows=moreTable?[...moreTable.querySelectorAll('tbody tr')].filter(r=>!expected||r.cells.length>=expected):[];
          if(!rows.length&&token(moreDoc)){complete=false;warning='pagination returned no usable rows';if(!allowPartial)throw new Error('Inventory incomplete: '+warning);break;}
          for(const row of rows)tbody.appendChild(doc.importNode(row,true));
          next=token(moreDoc);
        }catch(error){complete=false;warning=String(error.message||error);if(!allowPartial)throw new Error('Inventory incomplete: '+warning);break;}
      }
      const rows=parseInventory(doc),partialQuantity=rows.reduce((sum,row)=>sum+(Number(row.qty)||0),0);
      telemetry?.emit('fcr.inventory',{search:V3.telemetry.mask(code),pages,rows:rows.length,complete,ms:Math.round(performance.now()-started)});
      return{rows,pages,complete,warning,totalQuantity:complete?partialQuantity:null,partialQuantity};
    };
    return Object.freeze({post,product,inventory});
  }
  return Object.freeze({create,warehouse,base,parseProduct,parseInventory});
})();