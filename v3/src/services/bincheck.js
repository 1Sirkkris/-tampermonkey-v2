V3.bincheck=(()=>{
  const POD=/\bP-\d-(?:[A-Z]\d{3}){2}\b/i;
  const shiftExpiry=()=>{const now=new Date(),end=new Date(now);end.setHours(18,0,0,0);if(end<=now)end.setDate(end.getDate()+1);return end.getTime();};
  function create({telemetry,life}={}){
    const store=V3.storage.create('bincheck',1),memory=new Map();
    const hierarchyUrl=pod=>{const u=new URL(location.href);u.hash='';u.search='';u.pathname=u.pathname.replace(/\/$/,'')+'/container-hierarchy';u.searchParams.set('s',pod);return u.href;};
    const parse=raw=>{const doc=V3.base.html(raw),cell=doc.querySelector('div.a-span6:nth-child(1) > table:nth-child(1) > tbody:nth-child(1) > tr:nth-child(4) > td:nth-child(2)');const value=V3.base.clean(cell?.textContent).split(',')[0],n=value.match(/\b(\d+)\b/)?.[1];return n?'P'+n:'PX';};
    async function floor(podValue){
      const pod=V3.base.upper(podValue.match?.(POD)?.[0]||podValue);if(!pod)return'PX';
      const mem=memory.get(pod);if(mem&&mem.expires>Date.now())return mem.floor;
      const saved=await store.get('floor.'+pod,null);if(saved?.expires>Date.now()){memory.set(pod,saved);return saved.floor;}
      let result='PX';for(let attempt=0;attempt<2;attempt++){try{result=parse((await V3.transport.page(hierarchyUrl(pod),{allowHtml:true,signal:life?.signal})).raw);if(result!=='PX')break;}catch(error){telemetry?.emit('bin.floor.error',{pod:V3.telemetry.mask(pod),attempt,message:String(error.message||error)});}if(attempt===0)await life.sleep(300);}
      const entry={floor:result,expires:shiftExpiry()};memory.set(pod,entry);await store.set('floor.'+pod,entry);return result;
    }
    return Object.freeze({floor,podOf:value=>V3.base.clean(value).match(POD)?.[0]?.toUpperCase()||''});
  }
  return Object.freeze({create});
})();