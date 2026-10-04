V3.pandash=(()=>{
  function create({telemetry,warehouse}={}){
    const cache=new Map();
    const fc=()=>V3.base.upper(typeof warehouse==='function'?warehouse():warehouse||V3.fcr?.warehouse?.()||'BWU2');
    async function check(asinValue){
      const asin=V3.base.upper(asinValue),site=fc();if(!/^B[A-Z0-9]{9}$/.test(asin))throw new Error('ASIN required');if(!site)throw new Error('Warehouse unavailable');
      const key=site+'|'+asin;if(cache.has(key))return cache.get(key);
      const boot=await V3.transport.gm('https://pandash.amazon.com/GridServlet?fc='+encodeURIComponent(site),{timeout:8000});
      const restriction=V3.base.clean(boot.data?.restriction||'default')||'default';
      const body='language=default&source='+encodeURIComponent(restriction)+'-hazmat-FC&marketPlaces=AU&asins='+encodeURIComponent(asin)+'&rows=1&page=1&fc='+encodeURIComponent(site);
      const result=await V3.transport.gm('https://pandash.amazon.com/GridServlet',{method:'POST',body,headers:{'Content-Type':'application/x-www-form-urlencoded'},timeout:8000});
      const row=Array.isArray(result.data?.rows)?result.data.rows.find(x=>V3.base.upper(x?.asin)===asin):null;if(!row)throw new Error('No Pandash result');
      const value={asin,warehouse:site,level:Number(row.level||0),message:V3.base.clean(row.message),allowed:/can be processed/i.test(V3.base.clean(row.message))};
      cache.set(key,value);telemetry?.emit('pandash',{asin:V3.telemetry.mask(asin),level:value.level,allowed:value.allowed});return value;
    }
    return Object.freeze({check,clear:()=>cache.clear()});
  }
  return Object.freeze({create});
})();