V3.fcr=(()=>{
  const C=V3.core;
  const warehouse=()=>location.pathname.match(/^\/([^/]+)\/results(?:\/|$)/i)?.[1]||'';
  const base=()=>{const fc=warehouse();if(!fc)throw new Error('Warehouse not found in FCResearch URL');return location.origin+'/'+encodeURIComponent(fc)+'/results';};
  const FORM_HEADERS={'Content-Type':'application/x-www-form-urlencoded','Accept':'text/html, */*; q=0.01','X-Requested-With':'XMLHttpRequest'};
  const parseBool=v=>/^(?:true|yes|1)$/i.test(C.clean(v))?true:/^(?:false|no|0)$/i.test(C.clean(v))?false:null;
  const suspicious=value=>{const p=String(value||'').match(/\d+(?:\.\d+)?/g);if(!p||p.length<3)return false;const raw=p.slice(0,3),n=raw.map(Number),eq=(a,b)=>Math.abs(a-b)<.001,rounded=raw.filter(x=>/\.00$/.test(x)).length;return eq(n[0],n[1])||eq(n[0],n[2])||eq(n[1],n[2])||rounded>=3||(Math.min(...n)<=2.001&&rounded>=2);};

  const product=raw=>{
    const doc=C.html(raw),table=doc.querySelector('.a-box-group .a-keyvalue')||[...doc.querySelectorAll('table')].find(t=>[...t.querySelectorAll('th')].some(th=>/^(asin|isbn|fnsku)$/i.test(C.clean(th.textContent))))||doc.querySelector('.a-keyvalue');
    if(!table)return null;
    const data={};
    for(const row of table.querySelectorAll('tr')){const th=row.querySelector('th'),td=row.querySelector('td');if(th&&td)data[C.lower(th.textContent)]=C.clean(td.querySelector('a')?.textContent||td.textContent);}
    const sortable=parseBool(data.sortable),out={asin:C.clean(data.asin),isbn:C.clean(data.isbn),fnsku:C.clean(data.fnsku),fcsku:C.clean(data.fcsku),title:C.clean(data.title),dimensions:C.clean(data.dimensions),weight:C.clean(data.weight),inventoryCost:C.clean(data['list price']||data.price||data['inventory cost']||''),sortable,sortableText:sortable==null?C.clean(data.sortable):String(sortable),suspicious:suspicious(data.dimensions)};
    out.img=C.clean(doc.querySelector('img')?.src||'');out.primary=out.asin||out.isbn;return out.primary||out.fnsku||out.fcsku?out:null;
  };

  const inventoryIndexes=table=>{
    const hs=[...table.querySelectorAll('thead th')].map(th=>({id:C.lower(th.id),text:C.lower(String(th.textContent||'').replace(/\(\d+\)/g,''))}));
    const find=(...names)=>hs.findIndex(h=>names.includes(h.id)||names.includes(h.text));
    return{container:find('inventory-container','container'),asin:find('inventory-asin','asin'),fnsku:find('inventory-fnsku','fnsku'),fcsku:find('inventory-fcsku','fcsku'),lpn:find('inventory-lpn','lpn'),qty:find('inventory-quantity','quantity'),disposition:find('inventory-disposition','disposition'),consumer:find('inventory-consumer','consumer'),consumerId:find('inventory-consumer-id','consumer id','consumerid'),outerLocation:find('inventory-outer-location','outer location'),outerLocationType:find('inventory-outer-location-type','outer location type'),title:find('inventory-title','title')};
  };
  const inventoryRow=(tr,idx)=>{
    const value=i=>i>=0?C.clean(tr.cells[i]?.textContent):'';
    const row={container:value(idx.container),asin:value(idx.asin),fnsku:value(idx.fnsku),fcsku:value(idx.fcsku),lpn:value(idx.lpn),qty:Number(value(idx.qty).replace(/,/g,'')),disposition:value(idx.disposition),consumer:value(idx.consumer),consumerId:value(idx.consumerId),outerLocation:value(idx.outerLocation),outerLocationType:value(idx.outerLocationType),title:value(idx.title)};
    if(!row.container&&!row.asin&&!row.fnsku&&!row.fcsku)return null;
    if(!value(idx.qty)||!Number.isSafeInteger(row.qty)||row.qty<0)throw new Error('Inventory row has invalid quantity');
    return row;
  };
  const inventoryRows=doc=>{
    const table=doc.querySelector('#table-inventory');if(!table)throw new Error('Inventory table not returned');
    const idx=inventoryIndexes(table);if(idx.qty<0||[idx.asin,idx.fnsku,idx.fcsku].every(index=>index<0))throw new Error('Inventory schema missing item / quantity columns');
    return [...(table.tBodies?.[0]?.rows||[])].map(row=>inventoryRow(row,idx)).filter(Boolean);
  };
  const paginationToken=doc=>{const raw=C.clean(doc.querySelector('.pagination-token')?.textContent);if(!raw)return '';try{const token=JSON.parse(raw);if(!token||typeof token!=='object')throw new Error();return raw;}catch{throw new Error('Inventory incomplete: malformed pagination token');}};
  const podOf=value=>C.clean(value).match(/\bP-\d-(?:[A-Z]\d{3}){2}\b/i)?.[0]||'';
  const floorFromHtml=raw=>{const doc=C.html(raw),cell=doc.querySelector('div.a-span6:nth-child(1) > table:nth-child(1) > tbody:nth-child(1) > tr:nth-child(4) > td:nth-child(2)'),n=C.clean(cell?.textContent).split(',')[0].match(/\b(\d+)\b/)?.[1]||'';return n?'P'+n:'PX';};

  function create({life,telemetry}={}){
    const inFlight=new Map(),floorCache=new Map();
    const post=async(endpoint,fields)=>{
      const params=new URLSearchParams();for(const [k,v] of Object.entries(fields||{}))params.set(k,String(v??''));
      const key=endpoint+'|'+params.toString();if(inFlight.has(key))return inFlight.get(key);
      const work=(async()=>{let attempt=0;for(;;){try{return(await C.request(base()+'/'+endpoint,{method:'POST',body:params.toString(),headers:FORM_HEADERS,allowHtml:true,signal:life?.signal})).raw;}catch(error){if(!(error.status>=500&&error.status<600)||attempt>=2)throw error;await C.sleep([150,400][attempt++]||400,life?.signal);}}})();
      inFlight.set(key,work);try{return await work;}finally{if(inFlight.get(key)===work)inFlight.delete(key);}
    };
    const products=new Map();const getProduct=async code=>{const key=C.upper(code),cached=products.get(key);if(cached&&Date.now()-cached.at<300000)return cached.value;const value=product(await post('product',{s:C.clean(code)}));if(value){if(/^(?:B[A-Z0-9]{9}|(?:X0|ZZ)[A-Z0-9]{8})$/.test(key)&&![value.asin,value.isbn,value.fnsku,value.fcsku].map(C.upper).includes(key))throw new Error('Product response does not match requested identifier');products.set(key,{value,at:Date.now()});if(products.size>300)products.delete(products.keys().next().value);}return value;};

    const fullInventory=async(code,{onPreview}={})=>{
      const started=performance.now(),first=await post('inventory',{s:C.clean(code)}),doc=C.html(first),table=doc.querySelector('#table-inventory');
      if(!table)throw new Error('Inventory table not returned');
      const tbody=table.tBodies?.[0]||table.appendChild(doc.createElement('tbody')),expected=table.tHead?.rows?.[0]?.cells?.length||0,seen=new Set();
      let next=paginationToken(doc),pages=1;
      onPreview?.({rows:inventoryRows(doc),complete:!next,pages});
      while(next){
        if(seen.has(next))throw new Error('Inventory incomplete: repeated pagination token');
        if(pages>=200)throw new Error('Inventory incomplete: pagination safety limit');
        seen.add(next);
        const moreRaw=await post('inventory-more',{token:next}),moreDoc=C.html(moreRaw);pages++;
        const moreTable=moreDoc.querySelector('#table-inventory')||moreDoc.querySelector('table');
        const fragment=moreTable?moreDoc:C.html('<table><tbody>'+moreRaw+'</tbody></table>');
        const candidates=[...fragment.querySelectorAll('tbody tr')];
        const rows=candidates.filter(r=>!expected||r.cells.length===expected);
        if(candidates.length!==rows.length)throw new Error('Inventory incomplete: malformed continuation rows');
        const following=paginationToken(moreDoc);
        if(!rows.length)throw new Error('Inventory incomplete: pagination returned no usable rows');
        for(const row of rows)tbody.appendChild(doc.importNode(row,true));
        next=following;
      }
      const rows=inventoryRows(doc),totalQuantity=rows.reduce((sum,row)=>sum+row.qty,0);if(!Number.isSafeInteger(totalQuantity))throw new Error('Inventory quantity exceeds safe range');
      const headerTotal=Number(table.querySelector('#inventory-quantity')?.textContent?.match(/\(([\d,]+)\)/)?.[1]?.replace(/,/g,''));if(Number.isFinite(headerTotal)&&headerTotal!==totalQuantity)throw new Error('Inventory incomplete: quantity header does not match returned rows');
      telemetry?.emit('fcr.inventory',{search:C.mask(code),pages,rows:rows.length,complete:true,ms:Math.round(performance.now()-started)});
      return{rows,pages,complete:true,totalQuantity};
    };

    const floor=async pod=>{
      const key=C.upper(pod),cached=floorCache.get(key);if(cached&&Date.now()-cached.at<10*60*60*1000)return cached.floor;
      const url=new URL(location.href);url.search='';url.hash='';url.pathname='/'+encodeURIComponent(warehouse())+'/results/container-hierarchy';url.searchParams.set('s',pod);
      let last;
      for(let attempt=0;attempt<2;attempt++){
        try{
          const r=await C.request(url.href,{allowHtml:true,timeout:8000,signal:life?.signal}),value=floorFromHtml(r.raw);
          if(value!=='PX'){floorCache.set(key,{floor:value,at:Date.now()});return value;}
          last=new Error('Floor not resolved');
        }catch(error){last=error;}
        if(attempt===0)await C.sleep(250,life?.signal);
      }
      telemetry?.emit('fcr.floor.error',{pod:C.mask(pod),message:C.clean(last?.message)});
      return'PX';
    };

    const pandashService=V3.pandash.create({life});
    const pandash=asin=>pandashService.lookup(asin,warehouse());

    return Object.freeze({post,product:getProduct,inventory:fullInventory,floor,pandash});
  }

  return Object.freeze({create,warehouse,base,product,inventoryIndexes,inventoryRow,inventoryRows,paginationToken,podOf,floorFromHtml});
})();
