V3.pandash = (() => {
  const C=V3.core;
  function create({life}={}) {
    const results=new Map(),restrictions=new Map(),pending=new Map();
    async function lookup(asinValue,warehouseValue) {
      const asin=C.upper(asinValue),warehouse=C.upper(warehouseValue),key=warehouse+'|'+asin;
      if(!/^[A-Z0-9]{10}$/.test(asin)||!/^\w{3,8}$/.test(warehouse))throw new Error('Pandash requires exact ASIN + warehouse');
      const cached=results.get(key);if(cached&&Date.now()-cached.at<6*3600000)return cached.value;
      if(pending.has(key))return pending.get(key);
      const task=(async()=>{
        let restriction=restrictions.get(warehouse);
        if(!restriction){const boot=await C.request('https://pandash.amazon.com/GridServlet?fc='+encodeURIComponent(warehouse),{timeout:8000,signal:life?.signal});
          restriction=C.clean(boot.data?.restriction||'default');restrictions.set(warehouse,restriction);}
        const body=new URLSearchParams({language:'default',source:restriction+'-hazmat-FC',marketPlaces:'AU',asins:asin,rows:'1',page:'1',fc:warehouse});
        const response=await C.request('https://pandash.amazon.com/GridServlet',{method:'POST',body:body.toString(),headers:{'Content-Type':'application/x-www-form-urlencoded'},timeout:8000,signal:life?.signal});
        const rows=response.data?.rows,row=Array.isArray(rows)?rows.find(item=>C.upper(item?.asin)===asin):null;
        if(!row)throw new Error('No exact Pandash result');
        const value={asin,level:Number(row.level||0),message:C.clean(row.message),allowed:/can be processed/i.test(C.clean(row.message))};
        results.set(key,{value,at:Date.now()});return value;
      })();pending.set(key,task);try{return await task;}finally{pending.delete(key);}
    }
    return Object.freeze({lookup});
  }
  return Object.freeze({create});
})();
