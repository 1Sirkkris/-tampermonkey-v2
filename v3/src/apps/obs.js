V3.boot=()=>{
  const C=V3.core,life=C.lifecycle('obs'),prefix='bwu2.v3.obs.shard.',epochKey='bwu2.v3.obs.epoch',id=Date.now()+'.'+C.id('tab'),MAX=6000,MAX_SHARDS=4096,RETENTION_MS=3*24*60*60*1000;
  const api={
    set:(key,value)=>typeof GM==='object'&&GM.setValue?GM.setValue(key,value):GM_setValue(key,value),
    get:(key,initial)=>typeof GM==='object'&&GM.getValue?GM.getValue(key,initial):GM_getValue(key,initial),
    keys:()=>typeof GM==='object'&&GM.listValues?GM.listValues():GM_listValues(),
    remove:key=>typeof GM==='object'&&GM.deleteValue?GM.deleteValue(key):GM_deleteValue(key)
  };
  let events=[],pending=[],epoch=null,timer=0,chain=Promise.resolve(),dropped=0,failures=0,prunedContexts=0,pruned=false;
  const safe=detail=>{
    // Bound untrusted event payloads before recursively sanitizing. Never retain query strings or credentials.
    const clean=(value,depth=0)=>{
      if(depth>6)return '[depth limit]';
      if(typeof value==='string')return value.replace(/https?:\/\/[^\s"'<>]+/gi,url=>{try{const u=new URL(url);return u.origin+u.pathname;}catch{return '[url]';}}).slice(0,280);
      if(Array.isArray(value))return value.slice(0,20).map(item=>clean(item,depth+1));
      if(value&&typeof value==='object'){const out={};for(const [key,item] of Object.entries(value).slice(0,40)){if(/cookie|authorization|csrf|token|password|secret|header/i.test(key))continue;out[key]=clean(item,depth+1);}return out;}
      return typeof value==='number'&&Number.isFinite(value)||typeof value==='boolean'||value===null?value:undefined;
    };
    return C.sanitize(clean(detail));
  };
  const currentEpoch=async()=>String(await api.get(epochKey,'0'));
  const shardKey=value=>prefix+(value==='0'?'':value+'.')+id;
  const flush=()=>{
    clearTimeout(timer);timer=0;
    chain=chain.catch(()=>{}).then(async()=>{
      if(!pending.length)return;
      const latest=await currentEpoch();
      if(epoch!==null&&epoch!==latest){events=[];dropped=0;}
      pending=pending.filter(row=>row.epoch===latest);epoch=latest;
      const batch=pending.slice(),combined=events.concat(batch.map(row=>row.event)),overflow=Math.max(0,combined.length-MAX);
      const next=combined.slice(-MAX);
      try{await api.set(shardKey(epoch),{epoch,updatedAt:Date.now(),context:window.top===window?'page':'frame',dropped:dropped+overflow,events:next});}
      catch(error){failures++;throw error;}
      events=next;dropped+=overflow;pending.splice(0,batch.length);
      if(!pruned){pruned=true;const names=(await api.keys()).filter(key=>key.startsWith(prefix));const epochPrefix=epoch==='0'?prefix:prefix+epoch+'.';const stamp=key=>Number(key.slice(epochPrefix.length).split('.')[0])||0;const active=names.filter(key=>key.startsWith(epochPrefix)).sort((a,b)=>stamp(b)-stamp(a));const excess=new Set(active.slice(MAX_SHARDS));for(const key of active){const time=stamp(key);if(key===shardKey(epoch)||!excess.has(key)&&(!time||Date.now()-time<=RETENTION_MS))continue;await api.remove(key);prunedContexts++;}}
    });
    return chain;
  };
  const queue=async detail=>{
    const event=safe(detail);if(!event||typeof event!=='object')return;
    if(!Number.isFinite(event.ts))event.ts=Date.now();
    const eventEpoch=await currentEpoch();pending.push({epoch:eventEpoch,event});if(pending.length>MAX){pending.shift();dropped++;}
    if(!timer)timer=setTimeout(()=>void flush().catch(error=>console.error('V3 OBS save failed; pending logs retained',C.clean(error.message))),300);
  };
  // Read the clear generation before accepting events; worker operation events include GM-backed mutations.
  const ready=currentEpoch().then(value=>{epoch=value;});
  life.on(window,'bwu2-v3:event',event=>{if(event.detail&&typeof event.detail==='object')void ready.then(()=>queue(event.detail)).catch(error=>console.error('V3 OBS collect failed',C.clean(error.message)));});
  life.on(window,'error',event=>{void ready.then(()=>queue({ts:Date.now(),tool:'page',version:V3.build.version,event:'error',href:location.origin+location.pathname,data:{message:C.clean(event.message),source:C.clean(event.filename).split('/').pop(),line:event.lineno||0}})).catch(error=>console.error('V3 OBS collect failed',C.clean(error.message)));});
  life.on(window,'unhandledrejection',event=>{void ready.then(()=>queue({ts:Date.now(),tool:'page',version:V3.build.version,event:'unhandledrejection',href:location.origin+location.pathname,data:{message:C.clean(event.reason?.message||event.reason)}})).catch(error=>console.error('V3 OBS collect failed',C.clean(error.message)));});
  // Native traffic evidence is metadata only. HTTP success is not a confirmed inventory mutation.
  const page=typeof unsafeWindow==='object'?unsafeWindow:window;
  const metadata=(url,method)=>{try{const target=new URL(String(url),location.href);return{method:String(method||'GET').toUpperCase(),path:target.origin+target.pathname};}catch{return{method:String(method||'GET').toUpperCase(),path:'[unavailable]'};}};
  const network=(meta,phase,extra={})=>void ready.then(()=>queue({ts:Date.now(),tool:'native-network',version:V3.build.version,event:'network.'+phase,href:location.origin+location.pathname,data:{...meta,...extra}})).catch(error=>console.error('V3 OBS collect failed',C.clean(error.message)));
  let sequence=0;
  if(typeof page.fetch==='function'){
    const original=page.fetch;
    function observed(input,options){
      if(life.disposed)return original.apply(this,arguments);const meta={...metadata(input?.url||input,options?.method||input?.method),id:'fetch-'+(++sequence)},start=performance.now(),mutation=!['GET','HEAD','OPTIONS'].includes(meta.method);
      if(mutation)network(meta,'submitted');
      let promise;try{promise=original.apply(this,arguments);}catch(error){network(meta,'failed',{message:C.clean(error.message)});throw error;}
      return promise.then(response=>{if(mutation||response.status>=400)network(meta,'response',{status:response.status,ms:Math.round(performance.now()-start),redirected:!!response.redirected});return response;},error=>{network(meta,'failed',{message:C.clean(error.message),ms:Math.round(performance.now()-start)});throw error;});
    }
    page.fetch=observed;life.own(()=>{if(page.fetch===observed)page.fetch=original;});
  }
  const proto=page.XMLHttpRequest?.prototype;
  if(proto){
    const open=proto.open,send=proto.send,requests=new WeakMap();
    function observedOpen(method,url){if(life.disposed)return open.apply(this,arguments);requests.set(this,metadata(url,method));return open.apply(this,arguments);}
    function observedSend(){
      if(life.disposed)return send.apply(this,arguments);const meta={...requests.get(this),id:'xhr-'+(++sequence)},start=performance.now(),mutation=!['GET','HEAD','OPTIONS'].includes(meta.method);
      if(mutation)network(meta,'submitted');
      const completed=()=>{if(mutation||this.status===0||this.status>=400)network(meta,'response',{status:this.status,ms:Math.round(performance.now()-start)});};
      this.addEventListener('loadend',completed,{once:true,signal:life.signal});
      try{return send.apply(this,arguments);}catch(error){this.removeEventListener('loadend',completed);network(meta,'failed',{message:C.clean(error.message)});throw error;}
    }
    proto.open=observedOpen;proto.send=observedSend;life.own(()=>{if(proto.open===observedOpen)proto.open=open;if(proto.send===observedSend)proto.send=send;});
  }
  const snapshot=async()=>{
    await ready;await flush();const current=await currentEpoch();
    const names=(await api.keys()).filter(key=>key.startsWith(prefix));
    const shards=await Promise.all(names.map(async key=>{const saved=await api.get(key,[]);const value=Array.isArray(saved)?{epoch:'0',events:saved,updatedAt:Math.max(0,...saved.map(row=>row?.ts||0)),dropped:0}:saved;return{key,...value};}));
    const active=shards.filter(shard=>shard.epoch===current&&Array.isArray(shard.events)).sort((a,b)=>b.updatedAt-a.updatedAt);
    const retained=active.slice(0,MAX_SHARDS),excluded=active.slice(MAX_SHARDS);
    // Pruning occurs at an explicit export, not through an idle cleanup loop.
    for(const shard of shards.filter(shard=>shard.epoch!==current).concat(excluded))await api.remove(shard.key);
    return{exportedAt:new Date().toISOString(),version:V3.build.version,retention:{maxEventsPerContext:MAX,maxContexts:MAX_SHARDS,retentionDays:3,prunedContexts,excludedContexts:excluded.length,excludedEvents:excluded.reduce((sum,shard)=>sum+shard.events.length,0),droppedEvents:retained.reduce((sum,shard)=>sum+(shard.dropped||0),0),saveFailures:failures},events:retained.flatMap(shard=>shard.events.map(safe)).filter(Boolean).sort((a,b)=>a.ts-b.ts)};
  };
  const exportLogs=async()=>{
    const data=await snapshot(),blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='BWU2_V3_Observability_'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);
  };
  const clear=async()=>{
    await ready;await chain.catch(()=>{});const next=C.id('clear');await api.set(epochKey,next);epoch=next;events=[];pending=[];dropped=0;clearTimeout(timer);timer=0;
    // Old contexts cannot restore cleared logs: their later flush observes the new epoch.
    for(const key of (await api.keys()).filter(key=>key.startsWith(prefix)&&!key.startsWith(prefix+next+'.')))await api.remove(key);
  };
  if(window.top===window&&typeof GM_registerMenuCommand==='function'){
    GM_registerMenuCommand('V3 OBS '+V3.build.version+': Export',()=>exportLogs().catch(error=>alert(error.message)));
    GM_registerMenuCommand('V3 OBS '+V3.build.version+': Clear',()=>clear().catch(error=>alert(error.message)));
  }
  life.own(()=>{void ready.then(flush).catch(error=>console.error('V3 OBS save failed; pending logs retained',C.clean(error.message)));});
};
