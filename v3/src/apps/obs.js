V3.boot=()=>{
  const C=V3.core,life=C.lifecycle('obs'),prefix='bwu2.v3.obs.shard.',shard=prefix+C.id('tab'),MAX=6000;
  let events=[],pending=[],timer=0,chain=Promise.resolve();
  const set=(key,value)=>typeof GM==='object'&&GM.setValue?GM.setValue(key,value):GM_setValue(key,value);
  const get=(key)=>typeof GM==='object'&&GM.getValue?GM.getValue(key,[]):GM_getValue(key,[]);
  const keys=()=>typeof GM==='object'&&GM.listValues?GM.listValues():GM_listValues();
  const flush=()=>{clearTimeout(timer);timer=0;chain=chain.catch(()=>{}).then(async()=>{if(!pending.length)return;events=events.concat(pending.splice(0)).slice(-MAX);await set(shard,events);});return chain;};
  const queue=detail=>{pending.push(C.sanitize(detail));if(!timer)timer=setTimeout(()=>void flush().catch(error=>console.error('V3 OBS save failed',error.message)),300);};
  life.on(window,'bwu2-v3:event',event=>{if(event.detail&&typeof event.detail==='object')queue(event.detail);});
  life.on(window,'error',event=>queue({ts:Date.now(),tool:'page',version:V3.build.version,event:'error',href:location.origin+location.pathname,data:{message:C.clean(event.message),source:C.clean(event.filename).split('/').pop(),line:event.lineno||0}}));
  life.on(window,'unhandledrejection',event=>queue({ts:Date.now(),tool:'page',version:V3.build.version,event:'unhandledrejection',href:location.origin+location.pathname,data:{message:C.clean(event.reason?.message||event.reason)}}));
  const exportLogs=async()=>{await flush();const names=(await keys()).filter(key=>key.startsWith(prefix));const all=(await Promise.all(names.map(get))).flat().filter(row=>row&&typeof row==='object').sort((a,b)=>a.ts-b.ts);
    const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),version:V3.build.version,events:all},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='BWU2_V3_Observability_'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);};
  const clear=async()=>{await flush();events=[];pending=[];for(const key of (await keys()).filter(key=>key.startsWith(prefix))){if(typeof GM==='object'&&GM.deleteValue)await GM.deleteValue(key);else GM_deleteValue(key);}};
  if(typeof GM_registerMenuCommand==='function'){GM_registerMenuCommand('V3 OBS '+V3.build.version+': Export',()=>void exportLogs().catch(error=>alert(error.message)));GM_registerMenuCommand('V3 OBS '+V3.build.version+': Clear',()=>void clear().catch(error=>alert(error.message)));}
  life.own(()=>{void flush().catch(error=>console.error('V3 OBS save failed',error.message));});
};
