// ==UserScript==
// @name         V3 | BWU2 Hierarchy
// @name:en      V3 | BWU2 Hierarchy
// @namespace    https://github.com/1Sirkkris/-tampermonkey-v2/v3-groundup
// @version      0.1.0
// @description  Native Bind/Unbind queues with typed Bind destination validation.
// @match        https://tx-b-hierarchy-nrt.nrt.proxy.amazon.com/unbindHierarchy*
// @match        https://tx-b-hierarchy-nrt.nrt.proxy.amazon.com/bindHierarchy*
// @run-at       document-body
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-groundup/v3/dist/V3_Hierarchy.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-groundup/v3/dist/V3_Hierarchy.user.js
// @v3-build     hierarchy-0.1.0-f4f4f270
// ==/UserScript==

(()=>{
'use strict';
const V3=Object.create(null);
V3.build=Object.freeze({"id":"hierarchy-0.1.0-f4f4f270","version":"0.1.0"});

// ---- src/core.js ----
V3.core=(()=>{
  const clean=v=>String(v??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
  const upper=v=>clean(v).toUpperCase(),lower=v=>clean(v).toLowerCase();
  const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
  const container=v=>/^(?:ts|cs)x[0-9a-z_-]+$/i.test(clean(v));
  const lines=(v,{dedupe=true}={})=>{const out=[],seen=new Set();for(const raw of String(v??'').split(/[\r\n,]+/)){const x=clean(raw.split(/\s+/)[0]);if(!x)continue;const k=upper(x);if(dedupe&&seen.has(k))continue;seen.add(k);out.push(x);}return out;};
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,Number(v)||0));
  const id=prefix=>String(prefix||'v3')+'-'+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
  const sleep=(ms,signal)=>new Promise((resolve,reject)=>{if(signal?.aborted)return reject(new DOMException('Aborted','AbortError'));const t=setTimeout(done,Math.max(0,Number(ms)||0));function abort(){clearTimeout(t);reject(new DOMException('Aborted','AbortError'));}function done(){signal?.removeEventListener('abort',abort);resolve();}signal?.addEventListener('abort',abort,{once:true});});
  const html=raw=>new DOMParser().parseFromString(String(raw??''),'text/html');

  function lifecycle(name='module'){
    const controller=new AbortController(),disposers=new Set();let dead=false;
    const own=fn=>{if(typeof fn==='function')disposers.add(fn);return fn;};
    const on=(target,type,fn,options={})=>{if(dead||!target?.addEventListener)return()=>{};const o=typeof options==='boolean'?{capture:options,signal:controller.signal}:{...options,signal:controller.signal};target.addEventListener(type,fn,o);return()=>target.removeEventListener(type,fn,o);};
    const observe=(target,fn,options)=>{if(dead||!target||typeof MutationObserver==='undefined')return null;const observer=new MutationObserver(fn);observer.observe(target,options);own(()=>observer.disconnect());return observer;};
    const timeout=(fn,ms)=>{if(dead)return 0;const t=setTimeout(()=>{if(!dead)fn();},Math.max(0,Number(ms)||0));own(()=>clearTimeout(t));return t;};
    const interval=(fn,ms)=>{if(dead)return 0;const t=setInterval(()=>{if(!dead)fn();},Math.max(250,Number(ms)||0));own(()=>clearInterval(t));return t;};
    const dispose=()=>{if(dead)return;dead=true;controller.abort();for(const fn of [...disposers])try{fn();}catch{}disposers.clear();};
    return Object.freeze({name,signal:controller.signal,own,on,observe,timeout,interval,sleep:ms=>sleep(ms,controller.signal),dispose,get disposed(){return dead;}});
  }

  const gmGet=async(k,d)=>{try{if(typeof GM==='object'&&GM?.getValue)return await GM.getValue(k,d);if(typeof GM_getValue==='function')return GM_getValue(k,d);}catch{}return d;};
  const gmSet=async(k,v)=>{try{if(typeof GM==='object'&&GM?.setValue)return await GM.setValue(k,v);if(typeof GM_setValue==='function')return GM_setValue(k,v);}catch{}};
  function store(namespace,version=1){
    const prefix='bwu2.v3.'+namespace+'.v'+version+'.';
    return Object.freeze({get:(k,d)=>gmGet(prefix+k,d),set:(k,v)=>gmSet(prefix+k,v),key:k=>prefix+k});
  }

  const mask=value=>{const s=clean(value);if(!s)return'';let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return'#'+(h>>>0).toString(16).padStart(8,'0');};
  const sanitize=value=>{
    if(value==null||typeof value==='boolean'||typeof value==='number')return value;
    if(typeof value==='string')return value.length>280?value.slice(0,280)+'…':value;
    if(Array.isArray(value))return value.slice(0,20).map(sanitize);
    if(typeof value==='object'){const out={};for(const [k,v] of Object.entries(value)){if(/cookie|authorization|csrf|token|password|secret|header/i.test(k))continue;out[k]=sanitize(v);}return out;}
    return String(value);
  };
  function telemetry(tool,version){
    const emit=(event,data={})=>{try{window.dispatchEvent(new CustomEvent('bwu2-v3:event',{detail:{ts:Date.now(),tool,version,event,href:location.origin+location.pathname,data:sanitize(data)}}));}catch{}};
    return Object.freeze({emit,mask});
  }

  class UnknownError extends Error{constructor(message,details={}){super(message);this.name='UnknownError';this.outcome='unknown';Object.assign(this,details);}}
  class RejectedError extends Error{constructor(message,details={}){super(message);this.name='RejectedError';this.outcome='rejected';Object.assign(this,details);}}
  function operation({kind,ref,telemetry:obs}={}){
    let state='PREPARED',terminal=false;const opId=id('op');
    const move=(next,data={})=>{if(terminal)throw new Error('Operation already terminal: '+state);const allowed={PREPARED:['SUBMITTED','REJECTED'],SUBMITTED:['CONFIRMED','REJECTED','UNKNOWN']}[state]||[];if(!allowed.includes(next))throw new Error('Illegal operation transition '+state+' -> '+next);state=next;terminal=['CONFIRMED','REJECTED','UNKNOWN'].includes(next);obs?.emit('operation',{id:opId,kind,ref:mask(ref),state,...data});return state;};
    return Object.freeze({id:opId,get state(){return state;},submitted:d=>move('SUBMITTED',d),confirmed:d=>move('CONFIRMED',d),rejected:d=>move('REJECTED',d),unknown:d=>move('UNKNOWN',d)});
  }

  function queue({name,life,validate=container}={}){
    const s=store('queue.'+name,1),owner=id('tab'),lockKey='bwu2.v3.queue.lock.'+name;let loaded=false,state={running:false,current:'',phase:'idle',message:'Ready',items:[]};
    const save=()=>s.set('state',state);
    const load=async()=>{if(loaded)return state;const raw=await s.get('state',null);if(raw&&Array.isArray(raw.items))state={...state,...raw,items:raw.items.filter(x=>validate(x?.id)).map(x=>({...x}))};for(const item of state.items){if(item.status==='active'||item.id===state.current){item.status='attention';item.error='Previous session ended during active work — verify before retry';}}state.running=false;state.current='';state.phase='idle';loaded=true;await save();return state;};
    const lock=()=>{try{return JSON.parse(localStorage.getItem(lockKey)||'null');}catch{return null;}};
    const acquire=()=>{const now=Date.now(),old=lock();if(old&&old.owner!==owner&&Number(old.expires)>now)return false;const next={owner,nonce:id('lock'),expires:now+9000};localStorage.setItem(lockKey,JSON.stringify(next));const check=lock();return check?.owner===owner&&check?.nonce===next.nonce;};
    const renew=()=>{const x=lock();if(x?.owner===owner)localStorage.setItem(lockKey,JSON.stringify({...x,expires:Date.now()+9000}));};
    const release=()=>{const x=lock();if(x?.owner===owner)localStorage.removeItem(lockKey);};
    life?.interval(()=>{if(state.running)renew();},3000);life?.own(release);
    const add=async values=>{await load();const seen=new Set(state.items.map(x=>upper(x.id)));for(const raw of values){const v=clean(raw),k=upper(v);if(!validate(v)||seen.has(k))continue;seen.add(k);state.items.push({id:v,status:'queued',error:'',phase:''});}await save();return state.items;};
    const set=async patch=>{Object.assign(state,patch);await save();};
    const item=async(target,patch)=>{Object.assign(target,patch);await save();};
    const next=()=>state.items.find(x=>x.status==='queued')||null;
    const clearDone=async()=>{state.items=state.items.filter(x=>x.status!=='done');await save();};
    return Object.freeze({owner,load,save,add,set,item,next,acquire,release,clearDone,get state(){return state;}});
  }

  const authLike=(status,contentType,finalUrl,raw)=>{const htmlish=/text\/html|application\/xhtml/i.test(contentType||'')||/^\s*(?:<!doctype\s+html|<html\b)/i.test(raw||'');const auth=[401,403,419].includes(Number(status))||/(?:login|signin|midway|sso|auth)/i.test(finalUrl||'')||(htmlish&&/\b(?:sign\s*in|log\s*in|authentication|midway|single\s+sign[- ]?on)\b/i.test(raw||''));return{html:htmlish,auth};};
  const parseData=raw=>{try{return raw?JSON.parse(raw):null;}catch{return raw;}};
  const classify=(result,options={})=>{const flags=authLike(result.status,result.contentType,result.finalUrl,result.raw);if(flags.auth||(flags.html&&options.allowHtml!==true))throw Object.assign(new Error('Authentication/HTML response instead of expected API response'),{status:result.status,flags});if((result.status<200||result.status>=300)&&options.allowHttpError!==true)throw Object.assign(new Error('HTTP '+result.status),{status:result.status,body:parseData(result.raw)});return{...result,data:parseData(result.raw),flags,httpError:result.status<200||result.status>=300};};
  async function request(url,options={}){
    const same=new URL(url,location.href).origin===location.origin;
    if(same){
      const response=await fetch(url,{method:options.method||'GET',body:options.body,headers:options.headers||{},credentials:'same-origin',cache:'no-store',redirect:'follow',signal:options.signal});
      const raw=await response.text();return classify({status:response.status,raw,finalUrl:response.url||url,contentType:response.headers.get('content-type')||'',response},options);
    }
    const gm=typeof GM==='object'&&typeof GM.xmlHttpRequest==='function'?GM.xmlHttpRequest:null;
    if(gm){
      const response=await gm({method:options.method||'GET',url,data:options.body,headers:options.headers||{},timeout:options.timeout||15000,redirect:'follow'});
      const raw=String(response.responseText??'');const ct=String(response.responseHeaders||'').match(/content-type:\s*([^\r\n]+)/i)?.[1]||'';
      return classify({status:response.status,raw,finalUrl:response.finalUrl||url,contentType:ct,response},options);
    }
    if(typeof GM_xmlhttpRequest!=='function')throw new Error('Cross-origin request unavailable');
    return new Promise((resolve,reject)=>GM_xmlhttpRequest({method:options.method||'GET',url,data:options.body,headers:options.headers||{},timeout:options.timeout||15000,onload:r=>{try{resolve(classify({status:r.status,raw:String(r.responseText||''),finalUrl:r.finalUrl||url,contentType:String(r.responseHeaders||'').match(/content-type:\s*([^\r\n]+)/i)?.[1]||'',response:r},options));}catch(e){reject(e);}},ontimeout:()=>reject(new Error('Request timeout')),onerror:()=>reject(new Error('Network error')),onabort:()=>reject(new DOMException('Aborted','AbortError'))}));
  }

  const LOGIN=/^[a-z][a-z0-9-]{2,31}$/i,RESERVED=/^(?:login|logout|signin|signout|username|employee|alias|user|account|profile|settings|help|admin)$/i;
  const normLogin=value=>{const v=clean(value);return LOGIN.test(v)&&!RESERVED.test(v)?v:'';};
  const identity=({pageWindow=window}={})=>{
    const candidates=[];
    const add=(v,source,score)=>{const login=normLogin(v);if(login)candidates.push({login,source,score});};
    try{
      const objects=[pageWindow?.identity,pageWindow?.user,pageWindow?.currentUser,pageWindow?.bootstrapData?.user,pageWindow?.application?.user];
      for(const obj of objects){if(!obj||typeof obj!=='object')continue;for(const k of ['login','alias','employeeLogin','userId','username'])add(obj[k],k,100);}
    }catch{}
    for(const selector of ['[data-login]','[data-employee-login]','[data-user-login]','[aria-label*="signed in" i]']){
      for(const el of document.querySelectorAll(selector)){if(el.matches('input,textarea,[contenteditable="true"]'))continue;add(el.getAttribute('data-login')||el.getAttribute('data-employee-login')||el.getAttribute('data-user-login')||el.textContent,selector,70);}
    }
    candidates.sort((a,b)=>b.score-a.score);return candidates[0]||{login:'',source:'none',score:0};
  };

  const STYLE_ID='bwu2-v3-core-style';
  const ensureStyle=()=>{if(document.getElementById(STYLE_ID)||!document.head)return;const s=document.createElement('style');s.id=STYLE_ID;s.dataset.bwu2Ui='1';s.textContent=`
[data-bwu2-v3-dock]{position:fixed;right:12px;bottom:12px;z-index:2147483000;display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;max-width:min(90vw,900px);font:700 12px/1.2 Arial,sans-serif}
[data-bwu2-v3-dock] button,.v3-btn{border:1px solid #526174;border-radius:8px;background:#202936;color:#f4f7fb;padding:7px 10px;font:700 12px Arial;cursor:pointer}
[data-bwu2-v3-dock] button:hover,.v3-btn:hover{background:#2d394a}.v3-btn.primary{background:#284f75;border-color:#7ca6d3}.v3-btn.danger{background:#643532;border-color:#d98a82}
.v3-panel{position:fixed;right:12px;top:12px;z-index:2147482999;width:min(560px,calc(100vw - 24px));max-height:calc(100vh - 70px);display:flex;flex-direction:column;background:#111720;color:#eef3f8;border:1px solid #526174;border-radius:12px;box-shadow:0 16px 45px rgba(0,0,0,.45);font:13px/1.35 Arial,sans-serif}
.v3-panel[hidden]{display:none}.v3-head{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #334154}.v3-head b{font-size:15px}.v3-head .spacer{flex:1}.v3-body{min-height:0;overflow:auto;padding:11px}
.v3-section{padding:10px;margin-bottom:9px;border:1px solid #334154;border-radius:9px;background:#18202b}.v3-row{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.v3-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.v3-field{display:block;font-weight:700;margin-bottom:8px}.v3-field input,.v3-field textarea,.v3-field select,.v3-input{box-sizing:border-box;width:100%;margin-top:4px;padding:7px 8px;border-radius:7px;border:1px solid #53647a;background:#0d131b;color:#fff;font:13px Arial}.v3-field textarea{min-height:80px;resize:vertical}.v3-note{color:#aebbc9}.v3-ok{color:#70d6a0}.v3-warn{color:#ffd166}.v3-bad{color:#ff827a}.v3-list-row{padding:6px 0;border-bottom:1px solid #2d3948}.v3-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:9px}.v3-tabs .active{background:#284f75;border-color:#7ca6d3}
@media(max-width:650px){.v3-panel{right:6px;top:6px;width:calc(100vw - 12px);max-height:calc(100vh - 58px)}}
`;document.head.appendChild(s);};
  const panels=new Map();
  const closeAll=except=>{for(const [id,p] of panels)if(id!==except)p.hidden=true;};
  function panel({id,title,width=560,life}={}){
    ensureStyle();let el=document.querySelector('[data-bwu2-v3-panel="'+CSS.escape(id)+'"]');
    if(!el){el=document.createElement('section');el.className='v3-panel';el.hidden=true;el.dataset.bwu2V3Panel=id;el.dataset.bwu2Ui='1';el.style.width='min('+width+'px,calc(100vw - 24px))';el.innerHTML='<div class="v3-head"><b>'+esc(title)+'</b><span class="spacer"></span><button class="v3-btn" data-close>×</button></div><div class="v3-body"></div>';document.body.appendChild(el);el.querySelector('[data-close]').onclick=()=>{el.hidden=true;};}
    panels.set(id,el);life?.own(()=>{panels.delete(id);el.remove();});
    const body=el.querySelector('.v3-body');
    return Object.freeze({el,body,open(){closeAll(id);el.hidden=false;},close(){el.hidden=true;},set(node){body.replaceChildren(node);}});
  }
  function dockButton({id,label,title,onClick}={}){
    ensureStyle();let dock=document.querySelector('[data-bwu2-v3-dock]');if(!dock){dock=document.createElement('div');dock.dataset.bwu2V3Dock='1';dock.dataset.bwu2Ui='1';document.body.appendChild(dock);}
    let b=dock.querySelector('[data-v3-button="'+CSS.escape(id)+'"]');if(!b){b=document.createElement('button');b.dataset.v3Button=id;dock.appendChild(b);}b.textContent=label;b.title=title||label;b.onclick=onClick;return b;
  }

  function barcodeInput(input,onScan,{life,delay=80}={}){
    let timer=0,last='';
    const fire=()=>{timer=0;const v=clean(input.value);if(!v||v===last)return;last=v;onScan(v);};
    const schedule=()=>{if(timer)clearTimeout(timer);timer=life?.timeout?life.timeout(fire,delay):setTimeout(fire,delay);};
    life?.on(input,'input',schedule);life?.on(input,'keydown',e=>{if(e.key==='Enter'){e.preventDefault();if(timer)clearTimeout(timer);timer=0;const v=clean(input.value);if(v){last=v;onScan(v);}}});
    return()=>{if(timer)clearTimeout(timer);};
  }

  return Object.freeze({clean,upper,lower,esc,container,lines,clamp,id,sleep,html,lifecycle,store,telemetry,mask,operation,UnknownError,RejectedError,queue,request,authLike,normLogin,identity,panel,dockButton,barcodeInput});
})();

// ---- src/actions.js ----
V3.actions=(()=>{
  const C=V3.core;
  const MOVE_ORIGIN='https://aft-moveapp-nrt-nrt.nrt.proxy.amazon.com';
  const HIERARCHY_ORIGIN='https://tx-b-hierarchy-nrt.nrt.proxy.amazon.com';
  const WAREHOUSE='BWU2';
  const MOVE_PATH='/api/move-container';
  const HIERARCHY={validate:'/validateContainer',summary:'/getTransshipmentBindingSummary',unbind:'/unbindContainer',destination:'/validateDestination'};
  const FLOORS=['P1','P2','P3','P4'];
  const UPPER=[
    {key:'Cubiscan',label:'Cubiscan',pattern:'dz-Pcubiscan-{floor}'},
    {key:'Damages',label:'Damages',pattern:'dz-P-Damages-{floor}'},
    {key:'Hazmat',label:'Hazmat',pattern:'dz-P-Hazmat-{floor}'},
    {key:'ISS',label:'ISS',pattern:'dz-P-ISS-{floor}'},
    {key:'Non-Sort',label:'Non-Sort',pattern:'dz-Pnonsort-{floor}'},
    {key:'Prep',label:'Prep',pattern:'dz-P-Prep-{floor}'}
  ];
  const P1=[
    {key:'P1-Hazmat',label:'Hazmat',dest:'dz-P-HAZMAT_OUT'},
    {key:'P1-Ticketland',label:'Ticketland',dest:'dz-P-Ticketland'},
    {key:'P1-Consolidation',label:'Consolidation',dest:'dz-P-issconsol'},
    {key:'P1-ISS-WIP',label:'ISS WIP',dest:'dz-S-ISSWIP1'},
    {key:'P1-Nonsort',label:'Nonsort',dest:'dz-P-IB-nonsort'},
    {key:'P1-Shipdock',label:'Shipdock',dest:'dz-P-ISS-Shipdock'},
    {key:'P1-OBIOL',label:'OB IOL',dest:'dz-P-OBIOL'},
    {key:'P1-Damageland',label:'Damageland',dest:'dz-Pdamageland'},
    {key:'P1-Receive-Damages',label:'Receive Damages',dest:'dz-P-rcv-Damages'}
  ];

  const dropChoices=floor=>floor==='P1'?P1:UPPER;
  const destination=(floor,key)=>{
    if(key==='PRIME'||key==='Prime')return'dz-P-PRIME';
    if(!FLOORS.includes(floor))return'';
    const row=dropChoices(floor).find(x=>x.key===key||x.label===key);
    return row?(floor==='P1'?row.dest:row.pattern.replace('{floor}',floor)):'';
  };

  const movePayload=(container,dest)=>({sourceScannableId:null,destinationScannableId:C.clean(dest),containerScannableId:C.clean(container),confirmed:'true'});
  const strictMoveConfirmation=result=>{
    if(!result||Number(result.status)<200||Number(result.status)>=300)throw new C.RejectedError('MoveContainer rejected HTTP '+Number(result?.status||0));
    if(result.flags?.auth||result.flags?.html)throw new C.UnknownError('MoveContainer confirmation was an authentication/HTML response');
    const expected=new URL(MOVE_ORIGIN+MOVE_PATH);
    const actual=new URL(result.finalUrl||expected.href,expected.href);
    if(actual.pathname.replace(/\/+$/,'')!==expected.pathname.replace(/\/+$/,''))throw new C.UnknownError('MoveContainer confirmation redirected unexpectedly');
    return result;
  };
  async function moveContainer(container,dest,{telemetry}={}){
    const code=C.clean(container),target=C.clean(dest);
    if(!C.container(code))throw new Error('Container must be tsX/csX');
    if(!target)throw new Error('Destination required');
    const op=C.operation({kind:'move-container',ref:code,telemetry});op.submitted({destination:target});
    let result;
    try{
      result=await C.request(MOVE_ORIGIN+MOVE_PATH,{method:'POST',body:JSON.stringify(movePayload(code,target)),headers:{'Content-Type':'application/json'},timeout:15000,allowHttpError:true});
    }catch(error){op.unknown({reason:'transport'});throw new C.UnknownError('Move submitted; confirmation lost — verify before retry',{cause:error});}
    try{
      strictMoveConfirmation(result);
      op.confirmed({status:result.status,destination:target});
      return result;
    }catch(error){
      if(error instanceof C.RejectedError){op.rejected({status:result.status});throw error;}
      op.unknown({status:result.status,reason:C.clean(error.message)});throw error;
    }
  }

  async function hierarchyPost(path,body,{timeout=15000,allowHttpError=false}={}){
    return C.request(HIERARCHY_ORIGIN+path,{method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json'},timeout,allowHttpError});
  }
  async function validateContainer(container){
    const code=C.clean(container),r=await hierarchyPost(HIERARCHY.validate,{warehouseId:WAREHOUSE,scannableId:code});
    if(!r.data||typeof r.data!=='object')throw new Error('Unexpected hierarchy validation response');
    if(C.upper(r.data.warehouseId)!==WAREHOUSE)throw new Error('Container is not validated in '+WAREHOUSE);
    if(r.data.scannableId&&C.lower(r.data.scannableId)!==C.lower(code))throw new Error('Validation returned another container');
    return r.data;
  }
  async function bindingSummary(container){
    const code=C.clean(container),r=await hierarchyPost(HIERARCHY.summary,{warehouseId:WAREHOUSE,scannableId:code});
    if(!Array.isArray(r.data?.transferBindingSummaryList))throw new Error('Unexpected binding summary');
    return r.data;
  }
  async function unbind(container,login,{telemetry}={}){
    const code=C.clean(container),employee=C.normLogin(login);
    if(!C.container(code))throw new Error('Container must be tsX/csX');
    if(!employee)throw new Error('Authenticated employee identity unavailable');
    await validateContainer(code);await bindingSummary(code);
    const op=C.operation({kind:'hierarchy-unbind',ref:code,telemetry});op.submitted();
    let r;
    try{r=await hierarchyPost(HIERARCHY.unbind,{sourceWarehouseId:WAREHOUSE,scannableId:code,employeeLogin:employee},{timeout:20000,allowHttpError:true});}
    catch(error){op.unknown({reason:'transport'});throw new C.UnknownError('Unbind submitted; confirmation lost — verify before retry',{cause:error});}
    if(r.status>=500){op.unknown({status:r.status});throw new C.UnknownError('Unbind HTTP '+r.status+' — verify before retry');}
    if(r.status<200||r.status>=300){op.rejected({status:r.status});throw new C.RejectedError('Unbind rejected HTTP '+r.status);}
    if(!C.clean(r.data?.hostName)){op.unknown({reason:'unexpected-response'});throw new C.UnknownError('Unbind response ambiguous — verify container');}
    op.confirmed({status:r.status});return r.data;
  }

  // Bind deliberately uses the native page. The only native network traffic observed
  // is /validateDestination, solely to map the user's typed FC to Amazon's opaque ID.
  const FACILITY=/^[A-Z0-9]{3,8}$/;
  const normalizeFacility=value=>{const fc=C.upper(value);return FACILITY.test(fc)?fc:'';};
  let destinationSeq=0;
  const destinationProofs=[];
  const endpointPath=value=>{try{return new URL(String(value||''),location.href).pathname;}catch{return'';}};
  const tokenFromBody=body=>{
    if(body==null)return'';
    if(typeof body==='object'){
      try{
        if(typeof FormData!=='undefined'&&body instanceof FormData)return C.clean(body.get('destinationWarehouseId'));
        if(typeof URLSearchParams!=='undefined'&&body instanceof URLSearchParams)return C.clean(body.get('destinationWarehouseId'));
        return C.clean(body.destinationWarehouseId);
      }catch{return'';}
    }
    const raw=String(body);
    try{return C.clean(JSON.parse(raw)?.destinationWarehouseId);}catch{}
    const match=raw.match(/(?:^|&)destinationWarehouseId=([^&]*)/);
    if(!match)return'';
    try{return C.clean(decodeURIComponent(match[1].replace(/\+/g,' ')));}catch{return C.clean(match[1]);}
  };
  const facilityFromResponse=raw=>{
    let value=raw;
    if(typeof raw==='string'){try{value=JSON.parse(raw);}catch{}}
    if(typeof value==='string')return normalizeFacility(value);
    if(value&&typeof value==='object')return normalizeFacility(value.warehouseId||value.destination||value.facility||value.fc||'');
    return'';
  };
  const recordDestination=(token,facility,status)=>{if(!token||!facility)return;destinationProofs.push({seq:++destinationSeq,token,facility,status:Number(status)||0,at:Date.now()});if(destinationProofs.length>12)destinationProofs.splice(0,destinationProofs.length-12);};
  function installDestinationTap(){
    const page=typeof unsafeWindow==='object'&&unsafeWindow?unsafeWindow:window;
    try{
      const XHR=page.XMLHttpRequest;
      if(XHR?.prototype&&!XHR.prototype.__bwu2V3GroundDestinationTap){
        const nativeOpen=XHR.prototype.open,nativeSend=XHR.prototype.send;
        XHR.prototype.open=function(method,url){this.__bwu2V3GroundDestinationPath=endpointPath(url);return nativeOpen.apply(this,arguments);};
        XHR.prototype.send=function(body){
          if(this.__bwu2V3GroundDestinationPath!==HIERARCHY.destination)return nativeSend.apply(this,arguments);
          const token=tokenFromBody(body);
          this.addEventListener('loadend',()=>{let raw='';try{if(!this.responseType||this.responseType==='text')raw=this.responseText||'';else if(this.responseType==='json')raw=JSON.stringify(this.response??null);}catch{}recordDestination(token,facilityFromResponse(raw),this.status);},{once:true});
          return nativeSend.apply(this,arguments);
        };
        Object.defineProperty(XHR.prototype,'__bwu2V3GroundDestinationTap',{value:true,configurable:true});
      }
    }catch{}
    try{
      const nativeFetch=page.fetch;
      if(typeof nativeFetch==='function'&&!nativeFetch.__bwu2V3GroundDestinationTap){
        const wrapped=async function(input,init={}){
          const rawUrl=typeof input==='string'||input instanceof URL?String(input):String(input?.url||'');
          if(endpointPath(rawUrl)!==HIERARCHY.destination)return nativeFetch.apply(this,arguments);
          const token=tokenFromBody(init?.body),response=await nativeFetch.apply(this,arguments);
          let raw='';try{raw=await response.clone().text();}catch{}
          recordDestination(token,facilityFromResponse(raw),response.status);return response;
        };
        Object.defineProperty(wrapped,'__bwu2V3GroundDestinationTap',{value:true});
        page.fetch=wrapped;
      }
    }catch{}
  }

  const visible=el=>{if(!(el instanceof Element)||!el.isConnected)return false;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity||1)!==0;};
  const descriptor=input=>{let label='';try{const direct=input.id?document.querySelector('label[for="'+CSS.escape(input.id)+'"]'):null;label=C.clean(direct?.textContent||input.closest('label')?.textContent||'');}catch{}return C.lower([label,input.getAttribute('name'),input.getAttribute('id'),input.getAttribute('placeholder'),input.getAttribute('aria-label')].filter(Boolean).join(' '));};
  const nativeInputs=()=>[...document.querySelectorAll('input[type="text"],input:not([type]),textarea,[role="combobox"]')].filter(visible);
  const findDestinationInput=()=>nativeInputs().map(input=>{const d=descriptor(input);let score=0;if(/destination/.test(d))score+=10;if(/warehouse|site|facility|\bfc\b/.test(d))score+=5;if(/container|scannable|scan|tote/.test(d))score-=14;return{input,score};}).sort((a,b)=>b.score-a.score)[0]?.score>0?nativeInputs().map(input=>{const d=descriptor(input);let score=0;if(/destination/.test(d))score+=10;if(/warehouse|site|facility|\bfc\b/.test(d))score+=5;if(/container|scannable|scan|tote/.test(d))score-=14;return{input,score};}).sort((a,b)=>b.score-a.score)[0].input:null;
  const findContainerInput=()=>{const rows=nativeInputs().map(input=>{const d=descriptor(input);let score=0;if(/container|scannable|scan|tote/.test(d))score+=12;if(/destination|warehouse|site|facility|\bfc\b/.test(d))score-=15;return{input,score};}).sort((a,b)=>b.score-a.score);return rows[0]?.score>0?rows[0].input:null;};
  const setNative=(input,value)=>{if(!input)return false;try{let proto=input,setter=null;while((proto=Object.getPrototypeOf(proto))&&!setter)setter=Object.getOwnPropertyDescriptor(proto,'value')?.set||null;if(setter)setter.call(input,value);else input.value=value;input.dispatchEvent(new Event('input',{bubbles:true,composed:true}));input.dispatchEvent(new Event('change',{bubbles:true,composed:true}));return true;}catch{return false;}};
  const pressEnter=async(input,life)=>{for(const type of ['keydown','keypress','keyup']){const e=new KeyboardEvent(type,{key:'Enter',code:'Enter',bubbles:true,cancelable:true});try{Object.defineProperty(e,'keyCode',{get:()=>13});Object.defineProperty(e,'which',{get:()=>13});}catch{}input.dispatchEvent(e);}await life.sleep(20);};
  const statusText=()=>[...document.querySelectorAll('[role="alert"],[role="status"],.alert,.error,.success,[class*="error"],[class*="Error"],[class*="success"],[class*="Success"]')].filter(visible).map(x=>C.clean(x.textContent)).filter(Boolean).join(' | ');
  const errorText=()=>{const text=statusText();return text&&/(?:error|invalid|failed|cannot|unable|not\s+found|not\s+valid|reject|wrong|unknown\s+(?:warehouse|facility|destination))/i.test(text)?text:'';};
  const pageText=()=>C.clean(document.body?.innerText||document.body?.textContent||'');
  const waitFor=async(predicate,{life,timeout=10000,minMs=0,label='native page'}={})=>{const started=performance.now();while(performance.now()-started<timeout){const elapsed=performance.now()-started,result=predicate(elapsed);if(elapsed>=minMs&&result)return result;await life.sleep(80);}throw new Error(label+' did not settle');};

  async function validateDestinationNative(destination,{life,telemetry}={}){
    const fc=normalizeFacility(destination);if(!fc)throw new Error('Enter destination FC, e.g. BWU1 or AVV2');
    installDestinationTap();const marker=destinationSeq,input=findDestinationInput();if(!input)throw new Error('Native destination field not found');
    if(!setNative(input,fc))throw new Error('Could not enter destination FC');try{input.focus({preventScroll:true});}catch{}await pressEnter(input,life);
    telemetry?.emit('hierarchy.destination.submit',{destination:fc});
    const proof=await waitFor(()=>{const error=errorText();if(error)throw new Error(error);return destinationProofs.find(x=>x.seq>marker&&x.facility===fc&&x.status>=200&&x.status<300&&x.token);},{life,timeout:10000,minMs:150,label:'Destination validation'});
    telemetry?.emit('hierarchy.destination.validated',{destination:fc});
    return Object.freeze({facility:fc,destinationWarehouseId:proof.token});
  }

  const successText=(before,container)=>{const status=statusText(),body=pageText(),re=/(?:success|successfully|\bbound\b|binding\s+(?:complete|completed)|container\s+bound)/i;if(re.test(status))return status;if(body!==before&&re.test(body)){const code=C.upper(container);if(C.upper(body).includes(code)||/successfully|binding\s+(?:complete|completed)/i.test(body))return body;}return'';};
  const nativeScan=async(container,life)=>{const input=findContainerInput();if(!input)throw new Error('Native container scan field not found');if(!setNative(input,container))throw new Error('Could not enter container');try{input.focus({preventScroll:true});}catch{}const before=pageText();await pressEnter(input,life);return before;};
  async function bindNative(container,context,{life,telemetry}={}){
    const code=C.clean(container),fc=normalizeFacility(context?.facility);if(!C.container(code))throw new Error('Container must be tsX/csX');if(!fc||!C.clean(context?.destinationWarehouseId))throw new Error('Destination must be validated before Bind');
    const before1=await nativeScan(code,life);
    await waitFor(elapsed=>{const error=errorText();if(error)throw new C.RejectedError(error);const text=pageText(),input=findContainerInput();return elapsed>=700&&text!==before1&&input&&visible(input)&&!input.disabled&&C.clean(input.value)!==code;},{life,timeout:12000,minMs:700,label:'Container validation'});
    const op=C.operation({kind:'hierarchy-bind',ref:code,telemetry});op.submitted({destination:fc});
    const before2=await nativeScan(code,life);
    try{
      const proof=await waitFor(()=>{const error=errorText();if(error)throw new C.RejectedError(error);return successText(before2,code);},{life,timeout:15000,minMs:250,label:'Bind confirmation'});
      op.confirmed({destination:fc,proof:C.clean(proof).slice(0,100)});return{container:code,destination:fc};
    }catch(error){
      if(error instanceof C.RejectedError){op.rejected({reason:C.clean(error.message)});throw error;}
      op.unknown({reason:'native-confirmation-missing'});throw new C.UnknownError('Bind submitted but native page did not prove success — verify container',{cause:error});
    }
  }

  return Object.freeze({MOVE_ORIGIN,HIERARCHY_ORIGIN,WAREHOUSE,FLOORS,UPPER,P1,dropChoices,destination,movePayload,strictMoveConfirmation,moveContainer,validateContainer,bindingSummary,unbind,normalizeFacility,tokenFromBody,facilityFromResponse,validateDestinationNative,bindNative});
})();

// ---- src/apps/hierarchy.js ----
V3.boot=()=>{
  const C=V3.core,life=C.lifecycle('hierarchy'),telemetry=C.telemetry('hierarchy',V3.build.version),mode=/\/bindHierarchy/i.test(location.pathname)?'bind':'unbind',queue=C.queue({name:'hierarchy-'+mode,life});
  const panel=C.panel({id:'hierarchy',title:'V3 · '+(mode==='bind'?'Bind':'Unbind'),width:600,life});
  let busy=false,destination='',bindContext=null,mounted=false;

  const employee=()=>C.identity({pageWindow:typeof unsafeWindow==='object'&&unsafeWindow?unsafeWindow:window}).login;
  const draw=async()=>{
    await queue.load();
    const s=queue.state,root=document.createElement('div');
    root.innerHTML='<section class="v3-section">'+
      (mode==='bind'?'<label class="v3-field">Destination FC<input data-dest autocomplete="off" placeholder="BWU1 / AVV2" value="'+C.esc(destination)+'"></label><div class="v3-note">Destination is validated by Amazon before the queue starts. Hidden destination ID is kept in memory only.</div>':'')+
      '<label class="v3-field">Containers<textarea data-input placeholder="tsX...\ncsX..."></textarea></label>'+
      '<div class="v3-row"><button class="v3-btn" data-add>ADD</button><button class="v3-btn primary" data-run>RUN</button><button class="v3-btn" data-pause>PAUSE</button><button class="v3-btn" data-done>CLEAR DONE</button></div>'+
      '<div class="v3-note" data-msg style="margin-top:8px">'+C.esc(s.message||'Ready')+'</div></section><section class="v3-section"><div data-list></div></section>';
    panel.set(root);
    root.querySelector('[data-list]').innerHTML=s.items.map(x=>'<div class="v3-list-row"><b>'+C.esc(x.id)+'</b> · '+C.esc(x.status.toUpperCase())+(x.error?' · <span class="v3-bad">'+C.esc(x.error)+'</span>':'')+'</div>').join('')||'<div class="v3-note">Queue empty.</div>';
    const dest=root.querySelector('[data-dest]');
    if(dest){dest.disabled=s.running;dest.oninput=()=>{destination=C.upper(dest.value);bindContext=null;};}
    root.querySelector('[data-add]').onclick=async()=>{await queue.add(C.lines(root.querySelector('[data-input]').value));draw();};
    root.querySelector('[data-run]').onclick=async()=>{
      if(s.items.some(x=>x.status==='attention')){await queue.set({message:'Resolve ATTENTION before RUN'});return draw();}
      if(mode==='bind'){
        destination=V3.actions.normalizeFacility(destination);
        if(!destination){await queue.set({message:'Enter destination FC first, e.g. BWU1 or AVV2'});return draw();}
        await queue.set({running:false,message:'Validating '+destination+'…'});await draw();
        try{bindContext=await V3.actions.validateDestinationNative(destination,{life,telemetry});}
        catch(error){bindContext=null;await queue.set({running:false,message:'Destination rejected: '+C.clean(error.message||error)});return draw();}
      }
      await queue.set({running:true,message:'Starting'});draw();pump();
    };
    root.querySelector('[data-pause]').onclick=async()=>{await queue.set({running:false,message:'Pause requested'});bindContext=null;draw();};
    root.querySelector('[data-done]').onclick=async()=>{await queue.clearDone();draw();};
  };

  const pump=async()=>{
    if(busy||!queue.state.running)return;
    if(!queue.acquire()){await queue.set({running:false,message:'Queue active in another tab'});return draw();}
    const row=queue.next();
    if(!row){await queue.set({running:false,current:'',phase:'idle',message:'Queue complete'});bindContext=null;queue.release();return draw();}
    busy=true;await queue.item(row,{status:'active',error:'',phase:mode});await queue.set({current:row.id,phase:mode,message:(mode==='bind'?'Binding '+row.id+' → '+destination:'Unbinding '+row.id)});draw();
    try{
      if(mode==='bind'){
        if(!bindContext||bindContext.facility!==destination)throw new Error('Destination no longer validated — press RUN again');
        await V3.actions.bindNative(row.id,bindContext,{life,telemetry});
        await queue.item(row,{status:'done',phase:'done'});await queue.set({current:'',phase:'idle',message:'BOUND '+row.id+' → '+destination});
      }else{
        const login=employee();if(!login)throw new Error('Authenticated employee identity unavailable');
        await V3.actions.unbind(row.id,login,{telemetry});
        await queue.item(row,{status:'done',phase:'done'});await queue.set({current:'',phase:'idle',message:'UNBOUND '+row.id});
      }
    }catch(error){
      const unknown=error?.outcome==='unknown'||error instanceof C.UnknownError;
      await queue.item(row,{status:unknown?'attention':'rejected',phase:'',error:unknown?'OUTCOME UNKNOWN — VERIFY BEFORE RETRY':C.clean(error.message||error)});
      await queue.set({running:false,current:'',phase:'idle',message:C.clean(error.message||error)});bindContext=null;
    }finally{busy=false;if(!queue.state.running)queue.release();draw();}
    if(queue.state.running)life.timeout(pump,180);
  };

  C.dockButton({id:'hierarchy',label:mode==='bind'?'BIND':'UNBIND',title:'V3 Hierarchy',onClick:()=>{if(!mounted)mounted=true;draw();panel.open();}});
};

if(typeof V3.boot!=='function')throw new Error('V3 boot missing');
V3.boot();
})();
