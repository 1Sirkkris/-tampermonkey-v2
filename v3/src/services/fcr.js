V3.fcr = (() => {
  const warehouse=()=>location.pathname.match(/^\/([^/]+)\/results(?:\/|$)/i)?.[1]||'';
  const apiBase=()=>{const fc=warehouse();if(!fc)throw new Error('Warehouse not found in URL');return location.origin+'/'+encodeURIComponent(fc)+'/results';};
  const headers={'Content-Type':'application/x-www-form-urlencoded','Accept':'text/html, */*; q=0.01','X-Requested-With':'XMLHttpRequest'};
  const parseBool=value=>/^(true|yes|1)$/i.test(V3.base.clean(value))?true:/^(false|no|0)$/i.test(V3.base.clean(value))?false:null;
  const suspiciousDimensions=value=>{
    let parts=String(value||'').match(/\d+(?:\.\d+)?/g);if(!parts||parts.length<3)return false;parts=parts.slice(0,3);
    const values=parts.map(Number),eq=(a,b)=>Math.abs(a-b)<.001,rounded=parts.filter(x=>/\.00$/.test(x)).length;
    return eq(values[0],values[1])||eq(values[0],values[2])||eq(values[1],values[2])||rounded>=3||(Math.min(...values)<=2.001&&rounded>=2);
  };
  const normalizeProduct=data=>{
    const sortable=parseBool(data.sortable);
    return{
      asin:V3.base.clean(data.asin),isbn:V3.base.clean(data.isbn),primary:V3.base.clean(data.asin||data.isbn),
      fnsku:V3.base.clean(data.fnsku),fcsku:V3.base.clean(data.fcsku),title:V3.base.clean(data.title),
      dimensions:V3.base.clean(data.dimensions),weight:V3.base.clean(data.weight),img:V3.base.clean(data.img),
      sortable,sortableText:sortable==null?V3.base.clean(data.sortable):String(sortable),
      suspicious:suspiciousDimensions(data.dimensions)
    };
  };
  const parseProduct=html=>{
    const doc=V3.base.parseHtml(html);
    const table=doc.querySelector('.a-box-group .a-keyvalue')||
      [...doc.querySelectorAll('table')].find(t=>{const labels=[...t.querySelectorAll('th')].map(th=>V3.base.lower(th.textContent));return labels.includes('asin')||labels.includes('isbn')||labels.includes('fnsku');})||
      doc.querySelector('.a-keyvalue');
    if(!table)return null;
    const data={};
    for(const row of table.querySelectorAll('tr')){
      const th=row.querySelector('th'),td=row.querySelector('td');if(!th||!td)continue;
      data[V3.base.lower(th.textContent)]=V3.base.clean(td.querySelector('a')?.textContent||td.textContent);
    }
    data.img=(doc.querySelector('.a-box-group img')||doc.querySelector('img'))?.getAttribute('src')||'';
    const product=normalizeProduct(data);
    return product.primary||product.fnsku||product.fcsku?product:null;
  };
  const indexes=table=>{
    const headers=[...table.querySelectorAll('thead th')].map(th=>({id:V3.base.lower(th.id),text:V3.base.lower(String(th.textContent||'').replace(/\(\d+\)/g,''))}));
    const find=(...names)=>headers.findIndex(h=>names.includes(h.id)||names.includes(h.text));
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
  const token=doc=>{const raw=V3.base.clean(doc?.querySelector('.pagination-token')?.textContent);return raw&&/^(?:\{|\[)/.test(raw)?raw:'';};

  function create({telemetry,life}={}){
    const inFlight=new Map();
    const post=async(endpoint,fields)=>{
      const params=new URLSearchParams();for(const [k,v] of Object.entries(fields||{}))params.set(k,String(v??''));
      const key=endpoint+'|'+params.toString();
      if(inFlight.has(key))return inFlight.get(key);
      const work=(async()=>{
        let retry=0;
        while(true){
          try{
            const r=await V3.api.fetchRequest(apiBase()+'/'+endpoint,{method:'POST',body:params.toString(),headers,timeout:15000,allowHtml:true,telemetry,signal:life?.signal});
            return r.raw;
          }catch(error){
            const status=Number(error?.status||0);
            if(!(status>=500&&status<600)||retry>=2)throw error;
            await life.sleep([120,350][retry++]||350);
          }
        }
      })();
      inFlight.set(key,work);try{return await work;}finally{if(inFlight.get(key)===work)inFlight.delete(key);}
    };
    const product=async code=>parseProduct(await post('product',{s:V3.base.clean(code)}));
    const inventory=async(code,{allowPartial=false,onPreview}={})=>{
      const started=performance.now();
      const first=await post('inventory',{s:V3.base.clean(code)});
      const doc=V3.base.parseHtml(first),table=doc.querySelector('#table-inventory');
      if(!table)throw new Error('Inventory table not returned');
      const tbody=table.tBodies?.[0]||table.appendChild(doc.createElement('tbody'));
      const expected=table.tHead?.rows?.[0]?.cells?.length||0;
      const seen=new Set();let next=token(doc),pages=1,complete=true,warning='';
      if(onPreview)onPreview({rows:parseInventory(doc),complete:!next,pages:1});
      while(next){
        if(seen.has(next)){complete=false;warning='inventory pagination repeated token';if(!allowPartial)throw new Error('Inventory incomplete: '+warning);break;}
        if(pages>=200){complete=false;warning='inventory pagination safety limit reached';if(!allowPartial)throw new Error('Inventory incomplete: '+warning);break;}
        seen.add(next);
        try{
          const html=await post('inventory-more',{token:next});pages++;
          const more=V3.base.parseHtml(html);
          const tableMore=more.querySelector('#table-inventory')||more.querySelector('table');
          const rows=tableMore?[...tableMore.querySelectorAll('tbody tr')].filter(row=>!expected||row.cells.length>=expected):[];
          if(!rows.length&&token(more)){complete=false;warning='pagination returned no usable rows';if(!allowPartial)throw new Error('Inventory incomplete: '+warning);break;}
          for(const row of rows)tbody.appendChild(doc.importNode(row,true));
          next=token(more);
        }catch(error){
          complete=false;warning=String(error?.message||error);if(!allowPartial)throw new Error('Inventory incomplete: '+warning);break;
        }
      }
      const rows=parseInventory(doc),partialQuantity=rows.reduce((sum,row)=>sum+(Number(row.qty)||0),0);
      telemetry?.emit('fcr.inventory',{search:V3.telemetry.mask(code),pages,rows:rows.length,complete,ms:Math.round(performance.now()-started)});
      return{rows,pages,complete,warning,totalQuantity:complete?partialQuantity:null,partialQuantity};
    };
    return Object.freeze({post,product,inventory});
  }
  return Object.freeze({create,warehouse,apiBase,parseProduct,parseInventory});
})();