V3.boot=()=>{
  const C=V3.core,life=C.lifecycle('carton'),telemetry=C.telemetry('carton',V3.build.version),store=C.store('carton',1);
  const BAR='input-page-barcode-container-tertiary-text',BTN='input-page-button-container-button',RE=/(csx[a-z0-9]{5,}|fba[a-z0-9]{8,}|amzn[a-z0-9]{8,}|\d{16,24}|[A-Z0-9]{7,12})/i,COUNT=/Barcodes scanned:\s*(\d+)/i;
  let enabled=true,last='',observer=null,target=null,queued=false;
  const button=C.dockButton({id:'carton',label:'CARTON ON',title:'Toggle Carton autocomplete',onClick:async()=>{enabled=!enabled;button.textContent='CARTON '+(enabled?'ON':'OFF');await store.set('enabled',enabled);}});
  void store.get('enabled',true).then(v=>{enabled=v!==false;button.textContent='CARTON '+(enabled?'ON':'OFF');});
  const inspect=()=>{if(!enabled)return;const el=document.getElementById(BAR);if(!el)return;const barcode=C.clean(el.textContent),count=Number(String(document.body?.innerText||'').match(COUNT)?.[1]||0);if(count<2){last='';return;}if(!barcode||!RE.test(barcode))return;const id=barcode+'|'+count;if(id===last)return;const btn=document.getElementById(BTN);if(!btn)return;for(const type of ['pointerdown','mousedown','mouseup','click'])btn.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true}));last=id;telemetry.emit('complete',{barcode:C.mask(barcode),count});};
  const schedule=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;attach();inspect();});};
  const attach=()=>{const barcode=document.getElementById(BAR),next=barcode?.parentElement||document.body;if(!next||next===target)return;observer?.disconnect();target=next;observer=life.observe(next,schedule,{childList:true,subtree:true,characterData:true});};
  attach();inspect();life.on(document,'input',schedule,true);life.on(document,'keydown',schedule,true);
};