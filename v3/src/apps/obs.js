V3.boot=()=>{
  const C=V3.core,life=C.lifecycle('obs'),store=C.store('obs',1),MAX=6000,FLUSH=300;
  let events=[],pending=[],timer=0,loaded=false;
  const load=async()=>{if(loaded)return;const raw=await store.get('events',[]);events=Array.isArray(raw)?raw.slice(-MAX):[];loaded=true;};
  const flush=async()=>{timer=0;if(!pending.length)return;await load();events.push(...pending.splice(0));if(events.length>MAX)events=events.slice(-MAX);await store.set('events',events);};
  const queue=detail=>{pending.push(detail);if(!timer)timer=life.timeout(()=>{void flush();},FLUSH);};
  life.on(window,'bwu2-v3:event',event=>{const d=event.detail;if(!d||typeof d!=='object')return;queue(d);});
  life.on(window,'error',event=>queue({ts:Date.now(),tool:'page',version:'',event:'error',href:location.origin+location.pathname,data:{message:C.clean(event.message),source:C.clean(event.filename).split('/').pop(),line:event.lineno||0}}));
  life.on(window,'unhandledrejection',event=>queue({ts:Date.now(),tool:'page',version:'',event:'unhandledrejection',href:location.origin+location.pathname,data:{message:C.clean(event.reason?.message||event.reason)}}));
  const exportLogs=async()=>{await flush();await load();const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),events},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='BWU2_V3_Observability_'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);};
  const clear=async()=>{events=[];pending=[];await store.set('events',[]);};
  try{if(typeof GM_registerMenuCommand==='function'){GM_registerMenuCommand('V3 OBS: Export',()=>void exportLogs());GM_registerMenuCommand('V3 OBS: Clear',()=>void clear());}}catch{}
  life.own(()=>{void flush();});
};