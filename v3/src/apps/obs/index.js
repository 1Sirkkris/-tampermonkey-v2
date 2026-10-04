V3.boot=()=>{
  const life=V3.lifecycle.create('obs'),store=V3.storage.create('obs',1),MAX=1200;let events=[],timer=0,hidden=false;
  const load=async()=>{events=await store.get('events',[]);if(!Array.isArray(events))events=[];};
  const flush=async()=>{timer=0;if(events.length>MAX)events.splice(0,events.length-MAX);await store.set('events',events);};
  const schedule=()=>{if(timer)return;timer=setTimeout(flush,750);};
  life.on(window,V3.telemetry.EVENT,event=>{try{const data=JSON.parse(String(event.detail||''));if(!data?.t||!data?.app)return;events.push(data);schedule();}catch{}});
  const toggle=()=>{hidden=!hidden;let style=document.getElementById('bwu2-v3-screenshot-style');if(hidden&&!style){style=document.createElement('style');style.id='bwu2-v3-screenshot-style';style.textContent='[data-bwu2-v3-ui]{display:none!important}';document.documentElement.appendChild(style);}if(!hidden)style?.remove();};
  life.on(document,'keydown',event=>{if(event.ctrlKey&&!event.shiftKey&&!event.altKey&&!event.metaKey&&String(event.key).toLowerCase()==='q'){event.preventDefault();toggle();}},true);
  const exportObs=async()=>{await flush();const blob=new Blob([JSON.stringify({format:'BWU2-V3-OBS',exportedAt:new Date().toISOString(),events},null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='BWU2_V3_OBS_'+Date.now()+'.json';a.click();URL.revokeObjectURL(a.href);};
  if(typeof GM_registerMenuCommand==='function'){GM_registerMenuCommand('Export V3 OBS',exportObs);GM_registerMenuCommand('Clear V3 OBS',async()=>{events=[];await flush();});GM_registerMenuCommand('Toggle V3 Screenshot Mode',toggle);}
  life.on(window,'pagehide',()=>{void flush();},{once:true});void load();
};