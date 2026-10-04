// ==UserScript==
// @name         V3 | BWU2 Sideline
// @name:en      V3 | BWU2 Sideline
// @namespace    https://github.com/1Sirkkris/-tampermonkey-v2/v3-groundup
// @version      0.1.0
// @description  Native Poirot Sideline helper using the same engine as ISS Console.
// @match        https://aft-poirot-website-nrt.nrt.proxy.amazon.com/*
// @run-at       document-body
// @noframes
// @grant        GM_xmlhttpRequest
// @connect      pandash.amazon.com
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-groundup/v3/dist/V3_Sideline.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-groundup/v3/dist/V3_Sideline.user.js
// @v3-build     sideline-0.1.0-70388ba3
// ==/UserScript==

(()=>{
'use strict';
const V3=Object.create(null);
V3.build=Object.freeze({"id":"sideline-0.1.0-70388ba3","version":"0.1.0"});

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

// ---- src/sideline.js ----
V3.sideline=(()=>{
  const C=V3.core,ORIGIN='https://aft-poirot-website-nrt.nrt.proxy.amazon.com',TOOL='V3';
  const PATH={bootstrap:'/api/get-bootstrap-data',source:'/api/scan-source-container',close:'/api/close-container',item:'/api/scanitem',move:'/api/move-items'};
  const requestId=()=>C.id('sideline');
  const scanSourcePayload=container=>({containerScannableId:container,requestId:requestId(),tool:TOOL});
  const scanItemPayload=(source,barcode)=>({containerScannableId:source,itemBarcode:barcode,isMasterpack:null,itemAndonContext:null,requestId:requestId(),tool:TOOL});
  const closePayload=(container,empty)=>({containerScannableId:container,containerEmpty:empty===true,directedLabel:false,processPath:'UNDETERMINED',requestId:requestId(),tool:TOOL});

  const problems=response=>(Array.isArray(response?.problems)?response.problems:[]).map(x=>C.clean(x?.description||x?.message||x?.reason||x?.code||x?.['@type']||'')).filter(Boolean);
  const deepHas=(value,re,seen=new Set())=>{if(value==null)return false;if(typeof value==='string')return re.test(value);if(typeof value!=='object'||seen.has(value))return false;seen.add(value);if(Array.isArray(value))return value.some(x=>deepHas(x,re,seen));return Object.entries(value).some(([k,v])=>re.test(k)||deepHas(v,re,seen));};
  const hasPredicant=value=>deepHas(value,/predicant/i);
  const payloadHasCustomerBound=value=>deepHas(value,/customer\s*bound\s*shipment/i);
  const hazmatRejected=response=>{
    if(!response||typeof response!=='object')return false;
    const filter=response.filterResult||{},reason=filter.reason||{};
    const labels=[response.message,response.description,response.errorMessage,response.errorCode,typeof response.reason==='string'?response.reason:'',response.reason?.type,response.reason?.description,response.reason?.message,reason.type,reason.description,reason.message,reason['@type'],filter.filterType,...problems(response)].map(C.clean).filter(Boolean);
    if(!labels.some(x=>/hazmat|dangerous.?goods/i.test(x)))return false;
    return response.success===false||filter.compatible===false||problems(response).length>0||Boolean(response.errorMessage||response.errorCode)||/error|reject|incompat|filter/i.test(C.clean(response['@type']));
  };
  const damagedDestination=response=>{const r=response?.filterResult?.reason;return response?.filterResult?.compatible===false&&/damag/i.test([r?.type,r?.description,r?.message,r?.['@type']].map(C.clean).join(' '));};
  const overageLabel=value=>/item\s*not\s*in\s*(?:source\s*)?container|not\s*in\s*container|overage/i.test(C.clean(value));
  const benignCompanion=value=>!/hazmat|dangerous.?goods|invalid\s+barcode|incompatib|damaged|predicant|customer\s*bound/i.test(C.clean(value));
  const allowedOverage=response=>{
    const type=C.clean(response?.['@type']),labels=[response?.message,response?.description,response?.errorMessage,response?.errorCode,response?.filterResult?.reason?.type,response?.filterResult?.reason?.description,response?.filterResult?.reason?.message,...problems(response)].map(C.clean).filter(Boolean);
    const explicit=overageLabel(type)||labels.some(overageLabel);
    if(!explicit||labels.some(x=>!benignCompanion(x)))return false;
    return !/hazmat|dangerous.?goods|invalid\s+barcode|incompatib|damaged|predicant|customer\s*bound/i.test([type,...labels].join(' '));
  };
  const resolveItem=(response,barcode)=>{
    const type=C.clean(response?.['@type']),overage=allowedOverage(response);
    if(!response||type==='InvalidBarcodeResponse'||(response.success===false&&!overage))return{ok:false,invalid:type==='InvalidBarcodeResponse',type:type||'Unknown'};
    const records=(Array.isArray(response.items)?response.items:[]).filter(x=>x?.skuDetail),item=records[0]||null,sku=item?.skuDetail;
    if(!item||!sku)return{ok:false,invalid:false,type:type||'Unknown'};
    return{ok:true,type,barcode,item,records,sku,asin:C.clean(sku.asin),fnsku:C.clean(sku.fnSku),fcsku:C.clean(sku.fcSku),dateType:C.clean(sku.datelotDetail?.expirationPromptType),dateDetail:sku.datelotDetail||{},hazmat:sku.hazmat===true,permissionLevel:C.upper(sku.itemDropzoneRecommendation?.permissionLevel),overage};
  };
  const responseText=response=>[response?.['@type'],response?.message,response?.description,response?.errorMessage,response?.errorCode,response?.filterResult?.filterType,response?.filterResult?.reason?.type,response?.filterResult?.reason?.description,response?.filterResult?.reason?.message,...problems(response)].map(C.clean).filter(Boolean).join(' ');
  const baseClassify=(response,barcode)=>{
    const ctx=resolveItem(response,barcode),text=responseText(response);
    if(/damaged/i.test(text))return{kind:'red',reason:'DAMAGED / INCOMPATIBLE',ctx};
    if(hazmatRejected(response))return{kind:'red',reason:'HAZMAT / DANGEROUS GOODS',ctx};
    if(!ctx.ok)return{kind:'red',reason:ctx.invalid?'INVALID BARCODE':ctx.type==='RequestMultipleBarcodesResponse'?'MULTIPLE BARCODE MATCHES':(ctx.type&&ctx.type!=='Unknown'?ctx.type:'NO ITEM DETAILS'),ctx};
    if(ctx.permissionLevel==='UNDER_REVIEW')return{kind:'red',reason:ctx.hazmat?'HAZMAT / UNDER REVIEW — RIVER REQUIRED':'ASIN UNDER REVIEW — RIVER REQUIRED',ctx};
    if(ctx.dateType==='EXPIRATION_DATE'||ctx.dateType==='PRODUCTION_DATE')return{kind:'yellow',reason:ctx.dateType==='PRODUCTION_DATE'?'PRODUCTION DATE':'EXPIRY DATE',ctx};
    return{kind:'green',reason:'GOOD TO GO',ctx};
  };
  const moveOk=response=>allowedOverage(response)||Boolean(response&&response.success===true&&response.filterResult?.compatible!==false&&!hazmatRejected(response)&&!hasPredicant(response));
  const moveReason=response=>{
    if(!response)return'EMPTY MOVE RESPONSE';if(hazmatRejected(response))return'HAZMAT';if(allowedOverage(response))return'OVERAGE';if(damagedDestination(response))return'DESTINATION DAMAGED';
    const reason=response.filterResult?.reason;if(response.filterResult?.compatible===false)return C.upper(reason?.type)||'DESTINATION INCOMPATIBLE';
    const p=problems(response);return p.length?p.join(', '):C.clean(response?.['@type']).replace(/Response$/,'')||'MOVE REJECTED';
  };
  const maxDay=(year,month)=>new Date(year,month,0).getDate();
  const validDate=(day,month,year)=>{const d=Number(day),m=Number(month),y=Number(year);if(!Number.isInteger(d)||!Number.isInteger(m)||!Number.isInteger(y)||y<2020||m<1||m>12||d<1||d>maxDay(y,m))return null;return new Date(y,m-1,d).getTime();};
  const pao900=productionMs=>productionMs+900*24*60*60*1000;

  function create({life,telemetry}={}){
    let warehousePromise=null,restriction='',preflightInflight=new Map(),hazmatCache=new Map();
    const api=async(path,{method='GET',body,signal,allowHttpError=false}={})=>{
      const r=await C.request(ORIGIN+path,{method,body:body==null?undefined:JSON.stringify(body),headers:body==null?{}:{'Content-Type':'application/json'},timeout:15000,allowHttpError,signal:signal||life?.signal});
      return r.data;
    };
    const warehouse=async()=>{if(!warehousePromise)warehousePromise=(async()=>{try{const p=await api(PATH.bootstrap+'?tool='+encodeURIComponent(TOOL));const info=p?.warehouseInfo;return C.upper((typeof info==='string'?info:'')||info?.warehouseId||info?.id||info?.warehouse||info?.fc||info?.code||p?.warehouseId||'');}catch{return'';}})();return warehousePromise;};
    const source=async container=>{
      const code=C.clean(container);if(!C.container(code))throw new Error('Invalid source container');
      const payload=await api(PATH.source,{method:'POST',body:scanSourcePayload(code)});
      if(payloadHasCustomerBound(payload))throw new Error('CUSTOMER-BOUND SHIPMENT');
      if(C.clean(payload?.['@type'])!=='ScanSourceContainerResponse'||payload?.success!==true)throw new Error(C.clean(payload?.message||payload?.description||payload?.errorMessage||payload?.['@type']||'SOURCE VALIDATION FAILED'));
      return payload;
    };
    const close=async(container,empty=false)=>{
      const code=C.clean(container);if(!C.container(code))throw new Error('Invalid container');
      const op=C.operation({kind:'sideline-close',ref:code,telemetry});op.submitted();
      let payload;try{payload=await api(PATH.close,{method:'POST',body:closePayload(code,empty)});}catch(error){op.unknown({reason:'transport'});throw new C.UnknownError('CLOSE OUTCOME UNKNOWN — '+code+' — VERIFY BEFORE RETRY',{cause:error});}
      if(C.clean(payload?.['@type'])!=='CloseContainerResponse'||payload?.success!==true){op.rejected({reason:moveReason(payload)});throw new C.RejectedError(C.clean(payload?.message||payload?.description||payload?.['@type']||'CLOSE REJECTED'));}
      op.confirmed();return payload;
    };
    const rawItem=(sourceContainer,barcode,signal)=>api(PATH.item,{method:'POST',body:scanItemPayload(sourceContainer,barcode),signal,allowHttpError:true});
    const hazmat=async asinValue=>{
      const asin=C.upper(asinValue),fc=await warehouse();if(!/^B[A-Z0-9]{9}$/.test(asin)||!fc)throw new Error('HAZMAT LOOKUP CONTEXT MISSING');
      const key=fc+'|'+asin,cached=hazmatCache.get(key);if(cached&&Date.now()-cached.at<6*60*60*1000)return cached.value;
      if(!restriction){const b=await C.request('https://pandash.amazon.com/GridServlet?fc='+encodeURIComponent(fc),{timeout:8000});restriction=C.clean(b.data?.restriction||'default')||'default';}
      let last;
      for(let attempt=0;attempt<2;attempt++){
        try{
          const form='language=default&source='+encodeURIComponent(restriction)+'-hazmat-FC&marketPlaces=AU&asins='+encodeURIComponent(asin)+'&rows=1&page=1&fc='+encodeURIComponent(fc);
          const r=await C.request('https://pandash.amazon.com/GridServlet',{method:'POST',body:form,headers:{'Content-Type':'application/x-www-form-urlencoded'},timeout:8000}),row=Array.isArray(r.data?.rows)?r.data.rows.find(x=>C.upper(x?.asin)===asin):null;
          if(!row)throw new Error('NO PANDASH RESULT');
          const value={asin,level:Number(row.level||0),message:C.clean(row.message),allowed:/can be processed/i.test(C.clean(row.message))};hazmatCache.set(key,{value,at:Date.now()});return value;
        }catch(error){last=error;if(attempt===0)await life.sleep(150);}
      }
      throw last||new Error('HAZMAT LOOKUP FAILED');
    };
    const classify=async(response,barcode)=>{
      let result=baseClassify(response,barcode);
      if(result.kind==='red'||!result.ctx?.hazmat)return result;
      try{
        const h=await hazmat(result.ctx.asin);
        if(!h.allowed)return{kind:'red',reason:'HAZMAT L'+h.level+' — NOT PROCESSABLE',ctx:result.ctx,hazmat:h};
        return{...result,reason:result.kind==='yellow'?result.reason:'HAZMAT L'+h.level+' — OK TO PROCESS',hazmat:h};
      }catch(error){return{kind:'retry',reason:'HAZMAT CHECK FAILED — '+C.clean(error.message||error),ctx:result.ctx};}
    };
    const preflight=async(sourceContainer,barcode,{signal}={})=>{
      const key=C.upper(sourceContainer)+'|'+C.upper(barcode);
      if(preflightInflight.has(key))return preflightInflight.get(key);
      const work=(async()=>{const response=await rawItem(sourceContainer,barcode,signal);const result=await classify(response,barcode);telemetry?.emit('sideline.preflight',{item:C.mask(barcode),kind:result.kind,reason:result.reason});return{response,result};})();
      preflightInflight.set(key,work);try{return await work;}finally{preflightInflight.delete(key);}
    };
    const movePayload=(sourceContainer,destination,sourceMeta,ctx,qty,expirationMs)=>{
      const item=ctx.item,sku=ctx.sku,records=ctx.records?.length?ctx.records:[item];
      return{itemExternalId:null,sourceContainerScannableId:sourceContainer,destinationContainerScannableId:destination,scannableId:C.clean(item.scannableId||ctx.barcode),quantity:String(Math.max(1,Number(qty)||1)),itemDetails:records.map(record=>{const s=record.skuDetail||sku;return{fcsku:C.clean(s.fcSku),quantity:Number.isFinite(Number(record.quantity))?Number(record.quantity):0,consumerType:record.consumer??null,disposition:record.disposition??null,referenceId:record.referenceId??null,fnsku:C.clean(s.fnSku)};}),foundProblems:[null,null,null],scannedSourceContainerAsDestination:false,datelotDetail:sku.datelotDetail||null,userEnteredExpirationDate:expirationMs??null,mlcCaptureDetail:{mlcClass:sku.mlcDetail?.mlcClass??'UNKNOWN',userEnteredLotCode:null,mlcMissing:sku.mlcDetail?.mlcMissing??false,mlcNotEnteredReason:null,mlcCaptureMethod:null},itemMovedToISS:false,candidatePurchaseOrders:[],packHierarchyDetail:null,itemAndonContext:null,processPath:sourceMeta?.processPath??'UNDETERMINED',requestId:requestId(),tool:TOOL};
    };
    const move=async({sourceContainer,destination,sourceMeta,preflightResult,qty=1,expirationMs=null})=>{
      const ctx=preflightResult?.result?.ctx||preflightResult?.ctx;if(!ctx?.ok)throw new Error('Item was not safely preflighted');
      const payload=movePayload(sourceContainer,destination,sourceMeta,ctx,qty,expirationMs),ref=ctx.barcode||ctx.fnsku||ctx.asin;
      const op=C.operation({kind:'sideline-move',ref,telemetry});op.submitted({qty:Number(qty)||1});
      let response;
      try{response=await api(PATH.move,{method:'POST',body:payload,allowHttpError:true});}
      catch(error){op.unknown({reason:'transport'});throw new C.UnknownError('MOVE OUTCOME UNKNOWN — '+C.clean(ref)+' — VERIFY BEFORE RETRY',{cause:error});}
      if(moveOk(response)){op.confirmed({reason:allowedOverage(response)?'overage':'success'});return response;}
      const reason=moveReason(response);op.rejected({reason});const e=new C.RejectedError(reason);e.predicant=hasPredicant(response);e.recoverable=damagedDestination(response)||/DESTINATION INCOMPATIBLE/i.test(reason);throw e;
    };
    return Object.freeze({warehouse,source,close,preflight,hazmat,move,movePayload});
  }

  return Object.freeze({ORIGIN,PATH,scanSourcePayload,scanItemPayload,closePayload,resolveItem,baseClassify,allowedOverage,hazmatRejected,damagedDestination,hasPredicant,moveOk,moveReason,validDate,pao900,create});
})();

// ---- src/sideline-ui.js ----
V3.sidelineUI=(()=>{
  const C=V3.core;
  const parseItems=text=>{const map=new Map();for(const raw of String(text||'').split(/\r?\n/)){const code=C.clean(raw.split(/\s+/)[0]);if(!code)continue;const key=C.upper(code),row=map.get(key)||{code,qty:0};row.qty++;map.set(key,row);}return[...map.values()];};
  const formatDate=ms=>{const d=new Date(ms);return String(d.getMonth()+1).padStart(2,'0')+'/'+String(d.getDate()).padStart(2,'0')+'/'+d.getFullYear();};
  const today=()=>{const d=new Date();d.setHours(0,0,0,0);return d;};
  const pao900=()=>{const d=today();d.setDate(d.getDate()+900);return d.getTime();};

  const pickDate=({ctx,life}={})=>new Promise(resolve=>{
    const production=ctx?.dateType==='PRODUCTION_DATE',overlay=document.createElement('div');
    overlay.dataset.bwu2Ui='1';
    overlay.style.cssText='position:fixed;inset:0;z-index:2147483647;background:#0008;display:grid;place-items:start center;padding:38px 12px';
    const card=document.createElement('div');card.style.cssText='width:min(620px,calc(100vw - 24px));background:#111720;color:#fff;border:2px solid #77879b;border-radius:12px;padding:14px;font:13px Arial;box-shadow:0 14px 40px #0008';
    const mode=production?'PRODUCTION':'EXPIRATION';
    card.innerHTML='<h2 style="margin:0 0 10px">REQUIRES '+mode+' DATE</h2><div style="font-weight:800">'+C.esc(ctx?.sku?.title||ctx?.asin||ctx?.barcode||'Item')+'</div><div class="v3-note">ASIN '+C.esc(ctx?.asin||'—')+' · FNSKU '+C.esc(ctx?.fnsku||'—')+'</div><label style="display:block;margin-top:12px;font-weight:800">Date<input type="date" data-date style="width:100%;box-sizing:border-box;margin-top:5px;padding:10px"></label><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">'+(!production?'<button data-pao>PAO +900 DAYS · '+formatDate(pao900())+'</button>':'')+'<button data-use>USE DATE</button><button data-cancel>CANCEL</button></div>';
    for(const b of card.querySelectorAll('button'))b.style.cssText='padding:9px 12px;border:1px solid #718096;border-radius:7px;background:#263241;color:#fff;font-weight:800;cursor:pointer';
    overlay.appendChild(card);document.body.appendChild(overlay);
    const close=value=>{overlay.remove();resolve(value);};
    card.querySelector('[data-cancel]').onclick=()=>close(null);
    card.querySelector('[data-pao]')?.addEventListener('click',()=>close({enteredMs:pao900(),finalExpirationMs:pao900()}));
    card.querySelector('[data-use]').onclick=()=>{const raw=card.querySelector('[data-date]').value,m=raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return;const entered=V3.sideline.validDate(Number(m[3]),Number(m[2]),Number(m[1]));if(!entered)return;const final=production?entered+Number(ctx?.dateDetail?.shelfLife||0):entered;close({enteredMs:entered,finalExpirationMs:final});};
    life?.own(()=>overlay.remove());
  });

  function mount(root,{engine,life,title='Sideline',prefix='sideline'}={}){
    const state={source:'',destination:'',items:'',lookup:new Map(),generation:0,running:false,stop:false,paused:false,attention:'',dates:new Map(),establishedExpiry:null,sourceMeta:null};
    let debounce=0,resumeResolver=null,predicantResolver=null;
    root.innerHTML='<section class="v3-section"><b>'+C.esc(title)+'</b><div class="v3-grid" style="margin-top:8px"><label class="v3-field">Source<input data-source autocomplete="off"></label><label class="v3-field">Destination<input data-dest autocomplete="off"></label></div><label class="v3-field">Items<textarea data-items placeholder="scan / paste one barcode per line"></textarea></label><div class="v3-row"><label><input type="checkbox" data-clear checked> Clear source when done</label><label><input type="checkbox" data-delay checked> Delay 2–8s</label></div><div class="v3-row" style="margin-top:8px"><button class="v3-btn primary" data-run>RUN</button><button class="v3-btn" data-stop disabled>STOP AFTER CURRENT</button><button class="v3-btn" data-resume hidden>RESUME</button><button class="v3-btn danger" data-attn hidden>I VERIFIED IT · CLEAR ATTENTION</button></div><div class="v3-note" data-status>Scan source → destination → items.</div></section><section class="v3-section"><div data-metrics></div><div data-list style="margin-top:8px"></div></section>';
    const q=s=>root.querySelector(s),source=q('[data-source]'),dest=q('[data-dest]'),items=q('[data-items]'),status=(m,k='')=>{q('[data-status]').className='v3-note '+(k?'v3-'+k:'');q('[data-status]').textContent=m;};
    const parsed=()=>parseItems(items.value);
    const save=()=>{try{localStorage.setItem('bwu2.v3.form.'+prefix+'.source',source.value);localStorage.setItem('bwu2.v3.form.'+prefix+'.dest',dest.value);localStorage.setItem('bwu2.v3.form.'+prefix+'.items',items.value);}catch{}};
    try{source.value=localStorage.getItem('bwu2.v3.form.'+prefix+'.source')||'';dest.value=localStorage.getItem('bwu2.v3.form.'+prefix+'.dest')||'';items.value=localStorage.getItem('bwu2.v3.form.'+prefix+'.items')||'';}catch{}
    const resetWorkflow=()=>{state.generation++;state.lookup.clear();state.dates.clear();state.establishedExpiry=null;state.sourceMeta=null;state.attention='';q('[data-attn]').hidden=true;};
    const paint=()=>{
      const rows=parsed(),counts={green:0,yellow:0,red:0,retry:0,waiting:0};
      q('[data-list]').innerHTML=rows.map(row=>{const rec=state.lookup.get(C.upper(row.code)),kind=rec?.result?.kind||'waiting',label=rec?.result?.reason||'WAITING';counts[kind]=(counts[kind]||0)+row.qty;const cls=kind==='green'?'v3-ok':kind==='yellow'||kind==='retry'?'v3-warn':kind==='red'?'v3-bad':'v3-note';return'<div class="v3-list-row"><b>'+C.esc(row.code)+'</b>'+(row.qty>1?' ×'+row.qty:'')+' · <span class="'+cls+'"><b>'+C.esc(label)+'</b></span></div>';}).join('')||'<div class="v3-note">No items.</div>';
      q('[data-metrics]').textContent='GOOD '+counts.green+' · DATE '+counts.yellow+' · ASIDE '+counts.red+' · RETRY '+counts.retry;
    };
    const setBusy=v=>{state.running=v;q('[data-run]').disabled=v||Boolean(state.attention);q('[data-stop]').disabled=!v;source.disabled=v;items.disabled=v;dest.disabled=v&&!state.paused;};
    const preflightOne=async(row,generation,controller)=>{try{const value=await engine.preflight(source.value,row.code,{signal:controller.signal});if(generation!==state.generation)return;state.lookup.set(C.upper(row.code),value);paint();}catch(error){if(generation!==state.generation)return;state.lookup.set(C.upper(row.code),{result:{kind:'retry',reason:'LOOKUP FAILED — '+C.clean(error.message||error),ctx:null}});paint();}};
    const preflightAll=async()=>{
      const src=C.clean(source.value),rows=parsed();if(!C.container(src)||!rows.length)return;
      const generation=state.generation,controller=new AbortController();life?.own(()=>controller.abort());let cursor=0;
      const worker=async()=>{while(cursor<rows.length&&generation===state.generation){const row=rows[cursor++],key=C.upper(row.code);if(state.lookup.has(key))continue;await preflightOne(row,generation,controller);}};
      await Promise.all(Array.from({length:Math.min(5,rows.length)},worker));
    };
    const schedule=()=>{if(debounce)clearTimeout(debounce);debounce=life?.timeout?life.timeout(()=>{debounce=0;void preflightAll();},120):setTimeout(()=>{debounce=0;void preflightAll();},120);};
    source.oninput=()=>{save();resetWorkflow();schedule();};dest.oninput=()=>save();items.oninput=()=>{save();resetWorkflow();schedule();};
    source.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();dest.focus();dest.select?.();}};
    dest.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();items.focus();}};
    schedule();

    const resolveDates=async rows=>{
      for(const row of rows){
        const rec=state.lookup.get(C.upper(row.code)),result=rec?.result;
        if(result?.kind!=='yellow')continue;
        const key=C.upper(row.code);let chosen=state.dates.get(key);
        if(!chosen){chosen=await pickDate({ctx:result.ctx,life});if(!chosen)throw new Error('DATE REQUIRED — '+row.code);state.dates.set(key,chosen);}
        if(state.establishedExpiry!=null&&chosen.finalExpirationMs!==state.establishedExpiry){rec.result={...result,kind:'red',reason:'MIXED EXPIRY — PROCESS IN NEXT WORKFLOW'};continue;}
        if(state.establishedExpiry==null)state.establishedExpiry=chosen.finalExpirationMs;
      }
      paint();
    };

    const waitResume=message=>new Promise(resolve=>{state.paused=true;dest.disabled=false;q('[data-resume]').hidden=false;status(message,'bad');resumeResolver=()=>{state.paused=false;q('[data-resume]').hidden=true;dest.disabled=true;resolve();};});
    q('[data-resume]').onclick=()=>resumeResolver?.();

    q('[data-run]').onclick=async()=>{
      if(state.running||state.attention)return;
      resetWorkflow();setBusy(true);state.stop=false;status('Validating source…','warn');
      const rows=parsed();let moved=0,aside=0;
      try{
        if(!C.container(source.value)||!C.container(dest.value)||C.lower(source.value)===C.lower(dest.value))throw new Error('Valid different source/destination containers required');
        if(!rows.length)throw new Error('No items');
        state.sourceMeta=await engine.source(source.value);
        status('Preflight '+rows.length+' item(s)…','warn');await preflightAll();
        if([...state.lookup.values()].some(x=>x.result?.kind==='retry'))throw new Error('PREFLIGHT LOOKUP FAILED — no moves sent');
        await resolveDates(rows);
        const movable=rows.filter(row=>{const kind=state.lookup.get(C.upper(row.code))?.result?.kind;if(kind==='red'){aside+=row.qty;return false;}return kind==='green'||kind==='yellow';});
        if(!movable.length)throw new Error('Nothing to process — all items are ASIDE');
        for(let i=0;i<movable.length;i++){
          if(state.stop)break;const row=movable[i],rec=state.lookup.get(C.upper(row.code)),chosen=state.dates.get(C.upper(row.code));
          if(i>0&&q('[data-delay]').checked)await life.sleep(2000+Math.floor(Math.random()*6001));
          let retryCurrent=true;
          while(retryCurrent&&!state.stop){
            retryCurrent=false;status((i+1)+'/'+movable.length+' · MOVING '+row.code+' ×'+row.qty,'warn');
            try{await engine.move({sourceContainer:source.value,destination:dest.value,sourceMeta:state.sourceMeta,preflightResult:rec,qty:row.qty,expirationMs:chosen?.finalExpirationMs??null});moved+=row.qty;}
            catch(error){
              if(error?.outcome==='unknown'){state.attention='unknown';q('[data-attn]').hidden=false;throw error;}
              if(error?.predicant){
                await waitResume('PREDICANT — RESCAN SAME DESTINATION THEN RESUME');
                if(C.upper(dest.value)!==C.upper(state.destination||dest.value))throw new Error('Destination changed during predicant recovery');
                status('Emptying destination…','warn');await engine.close(dest.value,true);retryCurrent=true;continue;
              }
              if(error?.recoverable){
                const old=C.upper(dest.value);await waitResume('DESTINATION REJECTED — enter NEW destination then RESUME');
                if(!C.container(dest.value)||C.upper(dest.value)===old)throw new Error('Choose a different valid destination');retryCurrent=true;continue;
              }
              aside+=row.qty;state.lookup.set(C.upper(row.code),{...rec,result:{...rec.result,kind:'red',reason:C.clean(error.message||error)}});
            }
          }
          paint();
        }
        if(state.stop)status('Stopped after current item · moved '+moved,'warn');
        else{status('DONE ✓ '+moved+' moved · '+aside+' aside','ok');if(q('[data-clear]').checked){source.value='';items.value='';save();}}
      }catch(error){if(error?.outcome==='unknown')status('OUTCOME UNKNOWN — VERIFY BEFORE RETRY · '+C.clean(error.message||error),'bad');else status('STOPPED · '+C.clean(error.message||error),'bad');}
      finally{setBusy(false);}
    };
    q('[data-stop]').onclick=()=>{state.stop=true;status('Stop requested — finishing current action','warn');};
    q('[data-attn]').onclick=()=>{state.attention='';q('[data-attn]').hidden=true;q('[data-run]').disabled=false;status('Attention cleared');};
    paint();
    return Object.freeze({dispose(){state.stop=true;resumeResolver?.();predicantResolver?.();}});
  }

  return Object.freeze({parseItems,pickDate,mount});
})();

// ---- src/apps/sideline.js ----
V3.boot=()=>{
  if(location.hash==='#iss-console')return;
  const C=V3.core,life=C.lifecycle('sideline-native'),telemetry=C.telemetry('sideline',V3.build.version),engine=V3.sideline.create({life,telemetry}),panel=C.panel({id:'sideline-native',title:'V3 · Sideline',width:720,life});
  let mounted=false,ui=null;
  C.dockButton({id:'sideline-native',label:'SIDELINE',title:'V3 Sideline',onClick:()=>{
    if(!mounted){mounted=true;const root=document.createElement('div');panel.set(root);ui=V3.sidelineUI.mount(root,{engine,life,title:'Sideline',prefix:'native.sideline'});}
    panel.open();
  }});
  life.own(()=>ui?.dispose?.());
};

if(typeof V3.boot!=='function')throw new Error('V3 boot missing');
V3.boot();
})();
