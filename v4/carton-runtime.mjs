import{createOperationJournal,withOperationLock}from'./operation-journal.mjs';import{clean}from'./ui-tools.mjs';
export function createCartonHelper({window,onEvidence=()=>{}}){
 const d=window.document,events=new window.AbortController(),storage=window.localStorage,key='tm-v4.carton.rows';let disposed=false,busy=false,audio,enabled=storage.getItem('tm-v4.carton.enabled')!=='false';
 const root=d.createElement('button');root.id='tm-v4-carton';root.dataset.tmV4Script='CART';root.type='button';const style=d.createElement('style');style.dataset.tmV4Style='CART';style.textContent='#tm-v4-carton{position:fixed;right:12px;bottom:12px;z-index:999999;background:#222;color:white;padding:6px 10px;border:0;border-radius:8px;box-shadow:0 2px 5px #0005;font:12px Arial;cursor:pointer}#tm-v4-carton[data-enabled=false]{opacity:.7}#tm-v4-carton::before{content:"";display:inline-block;width:11px;height:11px;border:2px solid #b9e0ff;border-radius:50%;background:#1677c8;margin-right:6px;vertical-align:middle}#tm-v4-carton[data-enabled=false]::before{background:#8b1e6b;border-color:#ffd0ef}';
 function paint(message=''){root.dataset.enabled=String(enabled);root.textContent='AutoComplete: '+(enabled?'✓ ON':'× OFF')+(message?' • '+message:'');}
 function beep(){try{const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;if(!audio||audio.state==='closed')audio=new Audio();if(audio.state==='suspended')void audio.resume().catch(()=>{});const base=audio.currentTime+.01;for(const offset of[0,.25]){const oscillator=audio.createOscillator(),gain=audio.createGain();oscillator.frequency.value=880;oscillator.connect(gain);gain.connect(audio.destination);gain.gain.setValueAtTime(.25,base+offset);oscillator.addEventListener('ended',()=>{oscillator.disconnect();gain.disconnect();},{once:true});oscillator.start(base+offset);oscillator.stop(base+offset+.12);}}catch{}}
 function readyCarton(){
  const barcode=clean(d.getElementById('input-page-barcode-container-tertiary-text')?.textContent),counts=[...clean(d.body.textContent).matchAll(/Barcodes scanned:\s*(\d+)/gi)].map(match=>Number(match[1])),button=d.getElementById('input-page-button-container-button');
  if(!/^(?:csx[a-z0-9]{5,}|fba[a-z0-9]{8,}|amzn[a-z0-9]{8,}|\d{16,24}|[A-Z0-9]{7,12})$/i.test(barcode)||counts.length!==1||counts[0]<2||!button||!button.isConnected||button.disabled||button.getAttribute('aria-disabled')==='true'||button.closest('[hidden],[aria-hidden=true]')||!/^complete\b/i.test(clean(button.textContent)))return null;
  return {barcode,count:counts[0],button};
 }
 async function inspect(){
  if(disposed||busy||!enabled)return;const snapshot=readyCarton();if(!snapshot)return;
  busy=true;let changed=false;
  try{await withOperationLock(window,'tm-v4.carton.owner',async()=>{
   if(disposed||!enabled)return;const current=readyCarton();
   if(!current||current.barcode!==snapshot.barcode||current.count!==snapshot.count||current.button!==snapshot.button){changed=true;paint('Native readiness changed — checking current carton');return;}
   const {barcode,count,button}=current,journal=createOperationJournal({storage,key,uuid:()=>window.crypto.randomUUID()});
   if(journal.rows.some(row=>row.container.toUpperCase()===barcode.toUpperCase())){paint('Already submitted — verify native result');return;}
   const row=journal.add([barcode],{count,kind:'carton-complete'})[0];
   journal.transition(row,'SUBMITTED','Complete control submitted',{operationId:row.id});
   onEvidence({type:'operation',intent:'mutation',operationId:row.id,phase:'SUBMITTED',data:{kind:'carton-complete'}});
   for(const type of['pointerdown','mousedown','mouseup','click'])button.dispatchEvent(new window.MouseEvent(type,{bubbles:true,cancelable:true}));
   beep();journal.transition(row,'UNKNOWN','Native Complete clicked; physical/backend confirmation unavailable');
   onEvidence({type:'operation',intent:'mutation',operationId:row.id,phase:'UNKNOWN',data:{kind:'carton-complete'}});paint('Submitted • verify native result');
  });}catch(error){paint(error.message);}finally{busy=false;if(changed&&!disposed)window.queueMicrotask(()=>void inspect());}
 }
 root.addEventListener('click',()=>{enabled=!enabled;storage.setItem('tm-v4.carton.enabled',String(enabled));paint();void inspect();},{signal:events.signal});d.body.append(style,root);paint();let scheduled=false;const observer=new window.MutationObserver(records=>{if(records.every(record=>root.contains(record.target)))return;if(scheduled)return;scheduled=true;window.queueMicrotask(()=>{scheduled=false;void inspect();});});observer.observe(d.querySelector('#root,#app,main')||d.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['disabled','aria-disabled']});for(const type of['input','change','keydown'])d.addEventListener(type,()=>void inspect(),{capture:true,signal:events.signal});void inspect();
 return{root,inspect,dispose(){if(disposed)return;disposed=true;observer.disconnect();events.abort();void audio?.close().catch(()=>{});root.remove();style.remove();}};
}
