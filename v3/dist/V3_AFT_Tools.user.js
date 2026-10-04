// ==UserScript==
// @name         V3 | BWU2 AFT Tools
// @name:en      V3 | BWU2 AFT Tools
// @namespace    https://github.com/1Sirkkris/-tampermonkey-v2/v3-groundup
// @version      0.1.0
// @description  Native EditItems, MoveItems and FCSKU helper using one AFT engine.
// @include      *://aft-qt-*.corp.amazon.com/app/edititems*
// @include      *://aft-qt-*.corp.amazon.com/app/fcskuflip*
// @include      *://aft-qt-*.corp.amazon.com/app/moveitems*
// @run-at       document-body
// @grant        none
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-groundup/v3/dist/V3_AFT_Tools.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-groundup/v3/dist/V3_AFT_Tools.user.js
// @v3-build     aft-0.1.0-311c8761
// ==/UserScript==

(()=>{
'use strict';
const V3=Object.create(null);
V3.build=Object.freeze({"id":"aft-0.1.0-311c8761","version":"0.1.0"});

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

// ---- src/aft.js ----
V3.aft=(()=>{
  const C=V3.core;
  const DEFAULT_ORIGIN='https://aft-qt-jp.aka.nrt.corp.amazon.com';
  const DEFINITIONS={
    'edit:each':{title:'Edit EACH',area:'edit',mode:'each',path:'/app/edititems',instructionId:'EditItems',tool:'edititems',input:'EACH'},
    'edit:sku':{title:'Edit SKU',area:'edit',mode:'sku',path:'/app/edititems',instructionId:'EditItems',tool:'edititems',input:'SKU'},
    'edit:date':{title:'Edit DATE',area:'edit',mode:'date',path:'/app/edititems',instructionId:'EditItems',tool:'edititems',input:'DATELOT'},
    'edit:fcsku':{title:'FCSKU Flip',area:'edit',mode:'fcsku',path:'/app/fcskuflip',instructionId:'FcSkuFlip',tool:'fcskuflip',input:'SKU'},
    'move:multi':{title:'Move Multi',area:'move',mode:'multi',path:'/app/moveitems',instructionId:'MoveItems',tool:'moveitems',input:'MULTI'}
  };
  const EDIT_STATES=[
    ['location',['scan location','scan container','input location','enter location','enter container']],
    ['item',['input fnsku or fcsku','input item','scan item','enter the sku','enter item']],
    ['sourceState',['select source inventory state']],
    ['sourceDisp',['select source disposition','select source disposition type']],
    ['newState',['select new inventory state']],
    ['newDisp',['select new disposition','select disposition type']],
    ['dateRemove',['confirm expiry date removal','remove expiry date']],
    ['dateEntry',['enter expiry date','enter expiration date']],
    ['dateConfirm',['confirm new expiry date','save expiry date']],
    ['confirm',['confirm change','confirm to continue']],
    ['success',['success items changed','items changed from','current expiry date:']],
    ['retryError',['failed to change consumer type. please try again','failed to change consumer type']],
    ['error',['work is errored','the service failed to process your request','service failed']],
    ['loading',['loading']]
  ];
  const HEADERS={'Content-Type':'application/json; charset=utf-8','Accept':'application/json, text/javascript, */*; q=0.01','X-Requested-With':'XMLHttpRequest'};
  const classifyEdit=text=>{const value=C.lower(text);let state='unknown',best=Infinity;for(const [name,phrases] of EDIT_STATES)for(const phrase of phrases){const i=value.indexOf(phrase);if(i>=0&&i<best){best=i;state=name;}}return state;};
  const classifyFcsku=text=>{const v=C.lower(text);if(v.includes('success'))return'success';if(v.includes('confirm flip'))return'confirm';if(v.includes('enter new fnsku')||v.includes('enter new fcsku'))return'new';if(v.includes('input item')&&v.includes('fnskus'))return'old';if(v.includes('scan container'))return'container';return'unknown';};
  const objectId=raw=>String(raw||'').match(/(?:&quot;|")objectId(?:&quot;|")\s*:\s*(?:&quot;|")([^"&<]+)(?:&quot;|")/i)?.[1]||String(raw||'').match(/\b[A-Z0-9]{2,12}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i)?.[0]||'';
  const snapshotView=raw=>{const doc=C.html(raw);for(const el of doc.querySelectorAll('script,style,noscript,template,svg,[hidden],[aria-hidden="true"],.aft-tool-hide,.aok-hidden,.a-hidden,[style*="display:none"],[style*="visibility:hidden"]'))el.remove();const headings=C.clean([...doc.querySelectorAll('h1,h2,h3,[role="heading"]')].map(x=>x.textContent||'').join(' '));return{doc,text:C.clean(doc.body?.textContent||''),headings};};
  const extractWorkflow=(raw,def)=>{
    const source=String(raw||'').replace(/&quot;/gi,'"').replace(/&#34;/gi,'"').replace(/&#x22;/gi,'"').replace(/\\"/g,'"').replace(/&amp;/gi,'&');
    const anchor=new RegExp('"instructionId"\\s*:\\s*"'+def.instructionId+'"','i').exec(source);if(!anchor)return null;
    const scope=source.slice(anchor.index,anchor.index+3000),grab=name=>scope.match(new RegExp('"'+name+'"\\s*:\\s*"([^"]+)"','i'))?.[1]||'';
    const wf={instructionId:grab('instructionId'),tool:C.lower(grab('tool')),objectId:grab('objectId'),status:C.upper(grab('status')),selector:/<input\b[^>]*\bname\s*=\s*["']options["']/i.test(source)};
    if(!wf.objectId||wf.instructionId!==def.instructionId)return null;if(wf.tool&&wf.tool!==def.tool)return null;return wf;
  };
  const mapState=value=>{const v=C.lower(value);if(v==='sellable'||v==='inventory')return'INVENTORY';if(v==='pending research'||v==='pending')return'PENDING_RESEARCH';if(v==='unsellable')return'UNSELLABLE';throw new Error('Unsupported inventory state '+value);};
  const mapDamage=value=>{const v=C.lower(value);if(v==='amazon damage'||v==='warehouse damage')return'AMAZON_DAMAGE';if(v==='defective')return'DEFECTIVE';if(v==='distributor damage')return'DISTRIBUTOR_DAMAGE';if(v==='expired')return'EXPIRED';throw new Error('Unsupported disposition '+value);};
  const readMoveQuantity=raw=>{for(const re of [/(?:["']|&quot;)quantity(?:["']|&quot;)\s*[:=]\s*(?:["']|&quot;)?([0-9]{1,6})\b/i,/\bQuantity\b(?:<[^>]+>|\s|&nbsp;|&#160;|:|-){0,20}([0-9]{1,6})\b/i]){const qty=Number(String(raw||'').match(re)?.[1]);if(Number.isInteger(qty)&&qty>0)return{qty,verify:false};}return{qty:null,verify:/\bVerify item\b/i.test(String(raw||''))};};
  const sourceChoices=doc=>{
    const out=[];for(const radio of doc?.querySelectorAll?.('input[type="radio"]')||[]){let label='';try{label=[...(radio.labels||[])].map(x=>x.textContent||'').join(' ');}catch{}if(!label)label=radio.closest('label')?.textContent||radio.parentElement?.textContent||'';label=C.clean(label);if(!/Quantity\s*:/i.test(label)||!/Owner\s*:/i.test(label))continue;let state='';if(/Pending Research|PENDING_RESEARCH/i.test(label))state='PENDING_RESEARCH';else if(/Unsellable|UNSELLABLE/i.test(label))state='UNSELLABLE';else if(/(?:Inventory|Sellable)|\bSELLABLE\b/i.test(label))state='SELLABLE';if(!state)continue;const qty=Number(label.match(/\bQuantity\s*:\s*(\d{1,7})\b/i)?.[1]);out.push({state,label,value:radio.value||'',qty:Number.isInteger(qty)?qty:null,disabled:Boolean(radio.disabled)});}return out;
  };
  const parseEach=text=>String(text||'').split(/\r?\n/).map(C.clean).filter(Boolean).map(line=>{const [location='',asin='',fnsku='']=line.split(/\s+/);return location&&asin?{location,asin,fnsku:fnsku||asin}:null;}).filter(Boolean);
  const parseItems=text=>{const seen=new Set(),out=[];for(const line of String(text||'').split(/\r?\n/)){const value=C.clean(line.split(/\s+/)[0]);if(!value)continue;const key=C.upper(value);if(seen.has(key))continue;seen.add(key);out.push(value);}return out;};
  const datePayload=date=>{const m=String(date||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)throw new Error('Invalid date '+date);return JSON.stringify({'year-input':m[1],'month-input':m[2],'day-input':m[3],'':''});};

  function create({origin,life,telemetry,stopped=()=>false}={}){
    origin=String(origin||(/^aft-qt-/i.test(location.hostname)?location.origin:DEFAULT_ORIGIN)).replace(/\/$/,'');
    const url=path=>origin+path;
    const req=async(path,options={})=>C.request(url(path),{...options,signal:options.signal||life?.signal});
    const get=async path=>(await req(path,{allowHtml:true,timeout:15000})).raw;
    const post=async(path,payload,{timeout=20000,allowHttpError=false}={})=>req(path,{method:'POST',body:JSON.stringify(payload),headers:HEADERS,timeout,allowHttpError});
    const route=def=>def.path+'?experience=Desktop';
    const pageRaw=def=>get(route(def));
    const page=async(def,classifier)=>{const raw=await pageRaw(def),view=snapshotView(raw);return{raw,doc:view.doc,text:view.text,state:classifier?classifier(view.headings+' '+view.text):'unknown',objectId:objectId(raw)};};
    const workflow=async def=>{const wf=extractWorkflow(await pageRaw(def),def);if(!wf)throw new Error(def.title+': workflow not found');return wf;};
    const ids=(def,wf)=>({id:{instructionId:def.instructionId,objectId:wf.objectId}});
    const status=async(def,wf)=>{const r=await post('/status',ids(def,wf));const value=C.upper(r.data?.status);if(!value)throw new Error('AFT status missing');return value;};
    const waitStatus=async(def,wf,accepted,{timeout=20000,pollMs,operation:op,label='AFT',ignoreStop=false}={})=>{
      const wanted=new Set(accepted),started=performance.now();let polls=0,last=wf.status||'';
      while(performance.now()-started<timeout){
        if(stopped()&&!ignoreStop)throw new Error('Stopped by user');
        try{last=await status(def,wf);}catch(error){if(op){op.unknown({reason:'status-transport'});throw new C.UnknownError(label+': confirmation lost',{cause:error});}throw error;}
        polls++;if(wanted.has(last)){telemetry?.emit('aft.status',{label,state:last,polls,ms:Math.round(performance.now()-started)});return last;}
        if(last==='ERRORED'){if(op)op.rejected({reason:'backend-errored'});throw new C.RejectedError(label+': backend ERRORED');}
        if(!['READY','PROCESSING','COMPLETE'].includes(last)){if(op){op.unknown({reason:'unexpected-status',state:last});throw new C.UnknownError(label+': unexpected status '+last);}throw new Error(label+': status '+last);}
        await life.sleep(pollMs??Math.min(300,60+polls*35));
      }
      if(op){op.unknown({reason:'status-timeout'});throw new C.UnknownError(label+': status timeout');}
      throw new Error(label+': status timeout');
    };
    const action=async(def,wf,actionName,input,label,{complete=false,timeout=20000,pollMs,operation:op,ignoreStop=false}={})=>{
      if(stopped()&&!ignoreStop)throw new Error('Stopped by user');
      if(op)op.submitted({label});
      let r;
      try{r=await post('/action',{...ids(def,wf),action:actionName,input},{timeout,allowHttpError:Boolean(op)});}
      catch(error){if(op){op.unknown({reason:'action-transport'});throw new C.UnknownError(label+': submission confirmation lost',{cause:error});}throw error;}
      if(op&&r.httpError){if(r.status>=500){op.unknown({status:r.status});throw new C.UnknownError(label+': HTTP '+r.status+' outcome unknown');}op.rejected({status:r.status});throw new C.RejectedError(label+': rejected HTTP '+r.status);}
      return waitStatus(def,wf,complete?['COMPLETE']:['READY'],{timeout,pollMs,operation:op,label,ignoreStop});
    };
    const input=(def,wf,value,label,opts)=>action(def,wf,'Input',value,label,opts);
    const confirm=(def,wf,opts)=>action(def,wf,'Confirm','Confirm','Confirm',opts);
    const done=(def,wf)=>action(def,wf,'Done','Done','Done',{complete:true,timeout:180000,pollMs:300,ignoreStop:true});
    const end=(def,wf)=>post('/end',{...ids(def,wf),tool:def.tool},{timeout:20000});
    const fresh=async(def,oldId,timeout=6000)=>{const start=performance.now();while(performance.now()-start<timeout){const next=await workflow(def);if(next.objectId!==oldId)return next;await life.sleep(100);}throw new Error('Fresh AFT workflow not created');};
    const ensureReady=async(def,wf=null)=>{let current=wf||await workflow(def);for(let i=0;i<5;i++){if(current.status==='READY')return current;if(current.status==='PROCESSING'){current.status=await waitStatus(def,current,['READY','COMPLETE'],{label:'Ready'});if(current.status==='READY')return current;}if(current.status==='COMPLETE'){const old=current.objectId;await end(def,current);current=await fresh(def,old);continue;}throw new Error('Unexpected AFT state '+current.status);}throw new Error('Could not obtain READY workflow');};
    const ensureMode=async key=>{
      const def=DEFINITIONS[key];if(!def)throw new Error('Unknown AFT mode '+key);let wf=await ensureReady(def);
      if(key==='edit:fcsku'&&!wf.selector)return{def,wf};
      if(!wf.selector){await action(def,wf,'SelectMode','SelectMode','Select mode');wf=await workflow(def);if(!wf.selector)throw new Error(def.title+': mode selector unavailable');}
      await action(def,wf,'Input',def.input,'Choose '+def.input,{complete:true});const old=wf.objectId;await end(def,wf);wf=await fresh(def,old);return{def,wf:await ensureReady(def,wf)};
    };
    const snap=async(def,wf,classifier)=>{const s=await page(def,classifier);if(!s.objectId||s.objectId!==wf.objectId)throw new Error('AFT workflow changed');return s;};
    const exactSource=(doc,state)=>{
      const wanted=state==='INVENTORY'?'SELLABLE':state,matches=sourceChoices(doc).filter(x=>x.state===wanted&&!x.disabled);
      if(matches.length!==1)throw new Error(matches.length?'Multiple '+state+' source options — manual review required':'Requested source '+state+' not available');
      return matches[0];
    };
    const applyTarget=async(def,wf,state,damage)=>{
      await input(def,wf,state,'Target state');
      if(state==='UNSELLABLE')await input(def,wf,mapDamage(damage),'Target disposition');
    };
    const confirmUntilDone=async(def,wf)=>{
      for(let round=0;round<4;round++){
        const before=await snap(def,wf,classifyEdit);
        if(before.state==='success'||before.state==='item')return before;
        if(before.state!=='confirm')throw new Error('Expected confirmation, got '+before.state);
        const op=C.operation({kind:'aft-edit',ref:wf.objectId,telemetry});
        await confirm(def,wf,{timeout:180000,operation:op});
        const after=await snap(def,wf,classifyEdit);
        if(after.state!=='confirm')return after;
      }
      throw new Error('Too many confirmation rounds');
    };

    async function runMove({source,destination,items,mode='all',qty=1,onProgress=()=>{}}={}){
      source=C.clean(source);destination=C.clean(destination);items=parseItems(Array.isArray(items)?items.join('\n'):items);
      if(!C.container(source)||!C.container(destination)||C.lower(source)===C.lower(destination))throw new Error('Valid different source/destination containers required');
      if(!items.length)throw new Error('No Move items');
      const userQty=Number(qty);if(mode==='qty'&&(!Number.isSafeInteger(userQty)||userQty<1))throw new Error('Invalid quantity');
      const {def,wf}=await ensureMode('move:multi');let confirmed=0;
      try{
        onProgress({stage:'source',confirmed,total:items.length});await input(def,wf,source,'Source');
        for(let i=0;i<items.length;i++){
          if(stopped())throw new Error('Stopped by user');
          const barcode=items[i];onProgress({stage:'item',barcode,current:i+1,total:items.length,confirmed});
          await input(def,wf,barcode,'Item '+(i+1));
          const raw=await pageRaw(def),idNow=objectId(raw);if(idNow!==wf.objectId)throw new Error('AFT workflow changed while reading quantity');
          const info=readMoveQuantity(raw);if(info.verify)throw new Error('Verify Item screen detected');if(!info.qty)throw new Error('Quantity not found for '+barcode);
          const wanted=mode==='each'?1:mode==='qty'?userQty:info.qty;if(wanted>info.qty)throw new Error('QTY UNAVAILABLE • '+barcode+' • requested '+wanted+' • available '+info.qty);
          onProgress({stage:'quantity',barcode,qty:wanted,available:info.qty,current:i+1,total:items.length,confirmed});
          await input(def,wf,String(wanted),'Quantity '+(i+1));
          const op=C.operation({kind:'aft-move',ref:barcode,telemetry});
          onProgress({stage:'destination',barcode,current:i+1,total:items.length,confirmed});
          try{await input(def,wf,destination,'Destination '+(i+1),{operation:op});}
          catch(error){
            error.aftPartial={kind:'move',confirmed,total:items.length,uncertain:error?.outcome==='unknown'?[barcode]:[],remaining:items.slice(i+1),source,destination};
            throw error;
          }
          confirmed++;
        }
        onProgress({stage:'finish',confirmed,total:items.length});await done(def,wf);
        try{await end(def,wf);}catch(error){const e=new C.UnknownError('Items confirmed moved, but AFT finalization was not confirmed',{cause:error});e.aftPartial={kind:'move-finalize',confirmed,total:items.length,uncertain:[],remaining:[]};throw e;}
        return{confirmed,total:items.length};
      }catch(error){
        try{await end(def,wf);}catch{}
        if(!error.aftPartial)error.aftPartial={kind:'move',confirmed,total:items.length,uncertain:[],remaining:items.slice(confirmed),source,destination};
        throw error;
      }
    }

    async function runEditEach({items,destState='Pending Research',destDamage='Defective',onProgress=()=>{}}={}){
      const rows=Array.isArray(items)?items:parseEach(items);if(!rows.length)throw new Error('EACH needs: TOTE ASIN [FNSKU]');
      const desired=mapState(destState),{def}=await ensureMode('edit:each');let wf=await ensureReady(def),confirmed=0,currentLocation='';
      try{
        for(let i=0;i<rows.length;i++){
          if(stopped())throw new Error('Stopped by user');const row=rows[i];
          if(C.lower(row.location)!==C.lower(currentLocation)){if(currentLocation){try{await end(def,wf);}catch{}wf=await fresh(def,wf.objectId);wf=await ensureReady(def,wf);}onProgress({stage:'location',current:i+1,total:rows.length,row});await input(def,wf,row.location,'Location');currentLocation=row.location;}
          onProgress({stage:'item',current:i+1,total:rows.length,row});await input(def,wf,row.fnsku||row.asin,'Item');
          const afterItem=await snap(def,wf,classifyEdit);if(afterItem.state==='sourceState')throw new Error('EditItems could not infer source state; stopped before mutation');if(afterItem.state!=='newState')throw new Error('After item expected newState, got '+afterItem.state);
          await applyTarget(def,wf,desired,destDamage);
          const before=await snap(def,wf,classifyEdit);if(before.state!=='confirm')throw new Error('Expected confirm, got '+before.state);
          const op=C.operation({kind:'aft-edit-each',ref:row.fnsku||row.asin,telemetry});
          await confirm(def,wf,{timeout:180000,operation:op});
          const result=await snap(def,wf,classifyEdit);
          if(result.state==='success')await done(def,wf);else if(result.state!=='item')throw new Error('Unexpected post-confirm state '+result.state);
          confirmed++;onProgress({stage:'confirmed',confirmed,total:rows.length,row});
        }
        try{await end(def,wf);}catch{}
        return{confirmed,total:rows.length};
      }catch(error){try{await end(def,wf);}catch{}error.aftPartial={kind:'edit-each',confirmed,total:rows.length,uncertain:error?.outcome==='unknown'?[rows[confirmed]]:[],remaining:rows.slice(confirmed+(error?.outcome==='unknown'?1:0))};throw error;}
    }

    async function runEditSku({items,sourceState='Sellable',sourceDamage='Defective',destState='Pending Research',destDamage='Defective',onProgress=()=>{}}={}){
      const list=parseItems(Array.isArray(items)?items.join('\n'):items);if(!list.length)throw new Error('No Edit items');
      const from=mapState(sourceState),to=mapState(destState);if(from===to&&from!=='UNSELLABLE')throw new Error('Source and destination state cannot match');
      const def=DEFINITIONS['edit:sku'];let flipped=0,zero=0;const failed=[];
      await ensureMode('edit:sku');
      for(let index=0;index<list.length;index++){
        const sku=list[index];let attempts=0,skuFlipped=false;
        try{
          while(attempts++<50){
            if(stopped())throw new Error('Stopped by user');
            let wf=await ensureReady(def);onProgress({stage:'lookup',sku,current:index+1,total:list.length,attempt:attempts});
            await input(def,wf,sku,'SKU');
            const sourcePage=await snap(def,wf,classifyEdit);if(sourcePage.state!=='sourceState')throw new Error('Expected sourceState after lookup, got '+sourcePage.state);
            const choice=exactSource(sourcePage.doc,from),qty=choice.qty;
            onProgress({stage:'quantity',sku,qty,current:index+1,total:list.length,attempt:attempts,inventory:Object.fromEntries(sourceChoices(sourcePage.doc).map(x=>[x.state,x.qty]))});
            if(qty===0){zero++;try{await end(def,wf);}catch{}break;}
            if(!Number.isInteger(qty))throw new Error('Could not read '+sourceState+' quantity');
            await input(def,wf,choice.value||from,'Source state',{timeout:120000});
            if(from==='UNSELLABLE')await input(def,wf,mapDamage(sourceDamage),'Source disposition',{timeout:120000});
            const afterSource=await snap(def,wf,classifyEdit);if(afterSource.state!=='newState')throw new Error('Expected newState after source selection, got '+afterSource.state);
            await applyTarget(def,wf,to,destDamage);
            const before=await snap(def,wf,classifyEdit);if(before.state!=='confirm')throw new Error('Expected confirm, got '+before.state);
            const op=C.operation({kind:'aft-edit-sku',ref:sku,telemetry});await confirm(def,wf,{timeout:180000,operation:op});
            let result=await snap(def,wf,classifyEdit);
            if(result.state==='confirm')result=await confirmUntilDone(def,wf);
            if(result.state!=='success'&&result.state!=='item')throw new Error('Expected success after confirm, got '+result.state);
            if(result.state==='success')await done(def,wf);
            try{await end(def,wf);}catch{}
            flipped++;skuFlipped=true;onProgress({stage:'confirmed',sku,current:index+1,total:list.length,attempt:attempts});
          }
          if(attempts>50)throw new Error('Stopped after 50 SKU attempts');
        }catch(error){
          if(error?.outcome==='unknown'){error.aftPartial={kind:'edit-sku',confirmed:flipped,total:list.length,uncertain:[sku],remaining:list.slice(index+1),failed};throw error;}
          failed.push({sku,message:C.clean(error.message||error)});onProgress({stage:'failed',sku,current:index+1,total:list.length,message:C.clean(error.message||error)});
          try{const current=await workflow(def);await end(def,current);}catch{}
        }
      }
      return{flipped,zero,failed,total:list.length};
    }

    async function runFcsku({oldCode,newCode,locations,onProgress=()=>{}}={}){
      oldCode=C.clean(oldCode);newCode=C.clean(newCode);const list=parseItems(Array.isArray(locations)?locations.join('\n'):locations);
      if(!oldCode||!newCode||!list.length)throw new Error('Need OLD + NEW FCSKU and at least one location');
      const def=DEFINITIONS['edit:fcsku'];let confirmed=0,failed=[];
      let wf=(await ensureMode('edit:fcsku')).wf;
      for(let i=0;i<list.length;i++){
        const location=list[i];if(stopped())break;
        try{
          if(i>0){wf=await fresh(def,wf.objectId);wf=await ensureReady(def,wf);}
          onProgress({stage:'container',current:i+1,total:list.length,location});await input(def,wf,location,'Container');
          await input(def,wf,oldCode,'Old FCSKU');await input(def,wf,newCode,'New FCSKU');
          const op=C.operation({kind:'aft-fcsku',ref:location,telemetry});await confirm(def,wf,{operation:op,timeout:120000});await end(def,wf);confirmed++;
        }catch(error){
          if(error?.outcome==='unknown'){error.aftPartial={kind:'fcsku',confirmed,total:list.length,uncertain:[location],remaining:list.slice(i+1),failed};throw error;}
          failed.push({location,message:C.clean(error.message||error)});try{await end(def,wf);}catch{}
        }
      }
      return{confirmed,total:list.length,failed};
    }

    async function runDate({rows,onProgress=()=>{}}={}){
      const list=(Array.isArray(rows)?rows:[]).filter(x=>C.clean(x?.location)&&C.clean(x?.asin)&&C.clean(x?.date));if(!list.length)throw new Error('No expiry rows');
      const def=DEFINITIONS['edit:date'];let confirmed=0,wf=(await ensureMode('edit:date')).wf;
      for(let i=0;i<list.length;i++){
        const row=list[i];if(stopped())break;
        try{
          if(i>0){wf=await fresh(def,wf.objectId);wf=await ensureReady(def,wf);}
          await input(def,wf,row.location,'Container',{timeout:120000});await input(def,wf,row.asin,'Item',{timeout:120000});
          let s=await snap(def,wf,classifyEdit);
          if(s.state==='dateRemove'){await confirm(def,wf,{timeout:180000});await end(def,wf);wf=await fresh(def,wf.objectId);wf=await ensureReady(def,wf);await input(def,wf,row.location,'Container restart',{timeout:120000});await input(def,wf,row.asin,'Item restart',{timeout:120000});s=await snap(def,wf,classifyEdit);}
          if(s.state!=='dateEntry')throw new Error('Expected expiry date entry, got '+s.state);
          await input(def,wf,datePayload(row.date),'Expiry date',{timeout:120000});const before=await snap(def,wf,classifyEdit);if(before.state!=='dateConfirm'&&before.state!=='confirm')throw new Error('Expected expiry confirmation, got '+before.state);
          const op=C.operation({kind:'aft-edit-date',ref:row.asin,telemetry});await confirm(def,wf,{timeout:180000,operation:op});confirmed++;onProgress({stage:'confirmed',confirmed,total:list.length,row});
          try{await end(def,wf);}catch{}
        }catch(error){if(error?.outcome==='unknown'){error.aftPartial={kind:'edit-date',confirmed,total:list.length,uncertain:[row],remaining:list.slice(i+1)};throw error;}throw error;}
      }
      return{confirmed,total:list.length};
    }

    return Object.freeze({origin,route,page,workflow,status,waitStatus,action,input,confirm,done,end,ensureReady,ensureMode,runMove,runEditEach,runEditSku,runFcsku,runDate});
  }

  return Object.freeze({DEFAULT_ORIGIN,DEFINITIONS,classifyEdit,classifyFcsku,extractWorkflow,mapState,mapDamage,readMoveQuantity,sourceChoices,parseEach,parseItems,datePayload,create});
})();

// ---- src/workflow-ui.js ----
V3.workflowUI=(()=>{
  const C=V3.core;
  const memory=(key,initial='')=>{const full='bwu2.v3.form.'+key;let value='';try{value=localStorage.getItem(full)??initial;}catch{value=initial;}return{get:()=>value,set:v=>{value=String(v??'');try{localStorage.setItem(full,value);}catch{}}};};

  function mountMove(root,{run,stop,prefix='move'}={}){
    let busy=false,attention=false,mode='all';
    const source=memory(prefix+'.source'),dest=memory(prefix+'.dest'),items=memory(prefix+'.items'),qty=memory(prefix+'.qty','1');
    root.innerHTML='<section class="v3-section"><div class="v3-tabs"><button class="v3-btn active" data-mode="all">ALL</button><button class="v3-btn" data-mode="each">EACH = 1</button><button class="v3-btn" data-mode="qty">QTY</button></div><div class="v3-grid"><label class="v3-field">Source<input data-source></label><label class="v3-field">Destination<input data-dest></label></div><label class="v3-field" data-qty-wrap hidden>Quantity<input type="number" min="1" data-qty></label><label class="v3-field">Items<textarea data-items></textarea></label><div class="v3-row"><button class="v3-btn primary" data-run>RUN</button><button class="v3-btn" data-stop disabled>STOP AFTER CURRENT</button><button class="v3-btn danger" data-attn hidden>I VERIFIED IT · CLEAR ATTENTION</button></div><div class="v3-note" data-status>Ready</div></section><section class="v3-section"><div data-progress></div></section>';
    const q=s=>root.querySelector(s),status=(m,kind='')=>{q('[data-status]').className='v3-note '+(kind?'v3-'+kind:'');q('[data-status]').textContent=m;},setBusy=v=>{busy=v;q('[data-run]').disabled=v||attention;q('[data-stop]').disabled=!v;for(const el of root.querySelectorAll('input,textarea,[data-mode]'))el.disabled=v;};
    q('[data-source]').value=source.get();q('[data-dest]').value=dest.get();q('[data-items]').value=items.get();q('[data-qty]').value=qty.get();
    q('[data-source]').oninput=e=>source.set(e.target.value);q('[data-dest]').oninput=e=>dest.set(e.target.value);q('[data-items]').oninput=e=>items.set(e.target.value);q('[data-qty]').oninput=e=>qty.set(e.target.value);
    const paintMode=()=>{for(const b of root.querySelectorAll('[data-mode]'))b.classList.toggle('active',b.dataset.mode===mode);q('[data-qty-wrap]').hidden=mode!=='qty';};
    for(const b of root.querySelectorAll('[data-mode]'))b.onclick=()=>{if(!busy){mode=b.dataset.mode;paintMode();}};paintMode();
    const progress=p=>{status(p.stage==='confirmed'?(p.confirmed+'/'+p.total+' confirmed'):(p.current?(p.current+'/'+p.total+' · '+p.stage+(p.barcode?' · '+p.barcode:'')):p.stage),'warn');q('[data-progress]').textContent=p.confirmed!=null?'Confirmed: '+p.confirmed+(p.total!=null?' / '+p.total:''):'';};
    q('[data-run]').onclick=async()=>{if(busy||attention)return;setBusy(true);status('Starting…','warn');try{const result=await run({source:source.get(),destination:dest.get(),items:items.get(),mode,qty:Number(qty.get()),onProgress:progress});status('DONE ✓ '+(result.confirmed??result.done??0)+'/'+(result.total??''),'ok');}catch(error){if(error?.outcome==='unknown'){attention=true;q('[data-attn]').hidden=false;status('OUTCOME UNKNOWN — VERIFY BEFORE RETRY · '+C.clean(error.message||error),'bad');}else status('STOPPED · '+C.clean(error.message||error),'bad');}finally{setBusy(false);}};
    q('[data-stop]').onclick=()=>{stop?.();status('Stop requested — finishing current action','warn');};
    q('[data-attn]').onclick=()=>{attention=false;q('[data-attn]').hidden=true;q('[data-run]').disabled=false;status('Attention cleared');};
    return{dispose(){stop?.();}};
  }

  function mountEdit(root,{runEach,runSku,stop,prefix='edit'}={}){
    let busy=false,attention=false,mode='sku';
    const items=memory(prefix+'.items'),from=memory(prefix+'.from','Sellable'),fromDamage=memory(prefix+'.fromDamage','Defective'),to=memory(prefix+'.to','Pending Research'),toDamage=memory(prefix+'.toDamage','Defective');
    const states=['Sellable','Pending Research','Unsellable'],damages=['Defective','Amazon Damage','Distributor Damage','Expired'];
    root.innerHTML='<section class="v3-section"><div class="v3-tabs"><button class="v3-btn" data-mode="each">EACH</button><button class="v3-btn active" data-mode="sku">SKU</button></div><div data-source-wrap><div class="v3-grid"><label class="v3-field">Source state<select data-from>'+states.map(x=>'<option>'+x+'</option>').join('')+'</select></label><label class="v3-field">Source disposition<select data-from-damage>'+damages.map(x=>'<option>'+x+'</option>').join('')+'</select></label></div></div><div class="v3-grid"><label class="v3-field">Target state<select data-to>'+states.map(x=>'<option>'+x+'</option>').join('')+'</select></label><label class="v3-field">Target disposition<select data-to-damage>'+damages.map(x=>'<option>'+x+'</option>').join('')+'</select></label></div><label class="v3-field"><span data-items-label>SKU / ASIN / FNSKU / FCSKU</span><textarea data-items></textarea></label><div class="v3-row"><button class="v3-btn primary" data-run>RUN</button><button class="v3-btn" data-stop disabled>STOP AFTER CURRENT</button><button class="v3-btn danger" data-attn hidden>I VERIFIED IT · CLEAR ATTENTION</button></div><div class="v3-note" data-status>Ready</div></section><section class="v3-section"><div data-qty></div><div data-progress></div></section>';
    const q=s=>root.querySelector(s),status=(m,k='')=>{q('[data-status]').className='v3-note '+(k?'v3-'+k:'');q('[data-status]').textContent=m;},setBusy=v=>{busy=v;q('[data-run]').disabled=v||attention;q('[data-stop]').disabled=!v;for(const el of root.querySelectorAll('input,textarea,select,[data-mode]'))el.disabled=v;};
    q('[data-items]').value=items.get();q('[data-from]').value=from.get();q('[data-from-damage]').value=fromDamage.get();q('[data-to]').value=to.get();q('[data-to-damage]').value=toDamage.get();
    q('[data-items]').oninput=e=>items.set(e.target.value);q('[data-from]').onchange=e=>from.set(e.target.value);q('[data-from-damage]').onchange=e=>fromDamage.set(e.target.value);q('[data-to]').onchange=e=>to.set(e.target.value);q('[data-to-damage]').onchange=e=>toDamage.set(e.target.value);
    const paintMode=()=>{for(const b of root.querySelectorAll('[data-mode]'))b.classList.toggle('active',b.dataset.mode===mode);q('[data-source-wrap]').hidden=mode==='each';q('[data-items-label]').textContent=mode==='each'?'TOTE  ASIN  [FNSKU] — one row per item':'SKU / ASIN / FNSKU / FCSKU — one per line';};
    for(const b of root.querySelectorAll('[data-mode]'))b.onclick=()=>{if(!busy){mode=b.dataset.mode;paintMode();}};paintMode();
    const progress=p=>{status(p.current?(p.current+'/'+p.total+' · '+p.stage+(p.sku?' · '+p.sku:'')):p.stage,'warn');if(p.inventory){const s=p.inventory.SELLABLE??'—',pr=p.inventory.PENDING_RESEARCH??'—',u=p.inventory.UNSELLABLE??'—';q('[data-qty]').innerHTML='<b>Qty:</b> S '+s+' · P '+pr+' · U '+u;}q('[data-progress]').textContent=p.confirmed!=null?'Confirmed: '+p.confirmed+(p.total!=null?' / '+p.total:''):'';};
    q('[data-run]').onclick=async()=>{if(busy||attention)return;setBusy(true);status('Starting…','warn');try{const common={items:items.get(),destState:to.get(),destDamage:toDamage.get(),onProgress:progress};const result=mode==='each'?await runEach(common):await runSku({...common,sourceState:from.get(),sourceDamage:fromDamage.get()});const done=result.confirmed??result.flipped??0;status('DONE ✓ '+done+(result.zero?' · '+result.zero+' zero':'')+(result.failed?.length?' · '+result.failed.length+' failed':''),'ok');}catch(error){if(error?.outcome==='unknown'){attention=true;q('[data-attn]').hidden=false;status('OUTCOME UNKNOWN — VERIFY BEFORE RETRY · '+C.clean(error.message||error),'bad');}else status('STOPPED · '+C.clean(error.message||error),'bad');}finally{setBusy(false);}};
    q('[data-stop]').onclick=()=>{stop?.();status('Stop requested — finishing current action','warn');};
    q('[data-attn]').onclick=()=>{attention=false;q('[data-attn]').hidden=true;q('[data-run]').disabled=false;status('Attention cleared');};
    return{dispose(){stop?.();}};
  }

  function mountFcsku(root,{run,stop,prefix='fcsku'}={}){
    let busy=false,attention=false;const old=memory(prefix+'.old'),neu=memory(prefix+'.new'),locations=memory(prefix+'.locations');
    root.innerHTML='<section class="v3-section"><label class="v3-field">OLD FCSKU<input data-old></label><label class="v3-field">NEW FCSKU<input data-new></label><label class="v3-field">Locations / Containers<textarea data-locations></textarea></label><div class="v3-row"><button class="v3-btn primary" data-run>RUN</button><button class="v3-btn" data-stop disabled>STOP AFTER CURRENT</button><button class="v3-btn danger" data-attn hidden>I VERIFIED IT · CLEAR ATTENTION</button></div><div class="v3-note" data-status>Ready</div></section>';
    const q=s=>root.querySelector(s),status=(m,k='')=>{q('[data-status]').className='v3-note '+(k?'v3-'+k:'');q('[data-status]').textContent=m;},setBusy=v=>{busy=v;q('[data-run]').disabled=v||attention;q('[data-stop]').disabled=!v;for(const el of root.querySelectorAll('input,textarea'))el.disabled=v;};q('[data-old]').value=old.get();q('[data-new]').value=neu.get();q('[data-locations]').value=locations.get();q('[data-old]').oninput=e=>old.set(e.target.value);q('[data-new]').oninput=e=>neu.set(e.target.value);q('[data-locations]').oninput=e=>locations.set(e.target.value);
    q('[data-run]').onclick=async()=>{setBusy(true);try{const result=await run({oldCode:old.get(),newCode:neu.get(),locations:locations.get(),onProgress:p=>status((p.current||'')+'/'+(p.total||'')+' · '+p.stage+(p.location?' · '+p.location:''),'warn')});status('DONE ✓ '+(result.confirmed??0)+'/'+(result.total??''),'ok');}catch(error){if(error?.outcome==='unknown'){attention=true;q('[data-attn]').hidden=false;status('OUTCOME UNKNOWN — VERIFY · '+C.clean(error.message||error),'bad');}else status('STOPPED · '+C.clean(error.message||error),'bad');}finally{setBusy(false);}};
    q('[data-stop]').onclick=()=>{stop?.();status('Stop requested','warn');};q('[data-attn]').onclick=()=>{attention=false;q('[data-attn]').hidden=true;q('[data-run]').disabled=false;status('Attention cleared');};return{dispose(){stop?.();}};
  }

  function mountDate(root,{run,stop,prefix='date'}={}){
    let busy=false,attention=false;const rows=memory(prefix+'.rows');
    root.innerHTML='<section class="v3-section"><label class="v3-field">LOCATION  ASIN  YYYY-MM-DD<textarea data-rows></textarea></label><div class="v3-row"><button class="v3-btn primary" data-run>RUN</button><button class="v3-btn" data-stop disabled>STOP AFTER CURRENT</button><button class="v3-btn danger" data-attn hidden>I VERIFIED IT · CLEAR ATTENTION</button></div><div class="v3-note" data-status>Ready</div></section>';
    const q=s=>root.querySelector(s),status=(m,k='')=>{q('[data-status]').className='v3-note '+(k?'v3-'+k:'');q('[data-status]').textContent=m;},setBusy=v=>{busy=v;q('[data-run]').disabled=v||attention;q('[data-stop]').disabled=!v;q('[data-rows]').disabled=v;};q('[data-rows]').value=rows.get();q('[data-rows]').oninput=e=>rows.set(e.target.value);
    q('[data-run]').onclick=async()=>{const parsed=String(rows.get()).split(/\r?\n/).map(C.clean).filter(Boolean).map(line=>{const parts=line.split(/\s+/);return{location:parts[0],asin:parts[1],date:parts[2]};});setBusy(true);try{const result=await run({rows:parsed,onProgress:p=>status((p.confirmed||0)+'/'+p.total+' confirmed','warn')});status('DONE ✓ '+result.confirmed+'/'+result.total,'ok');}catch(error){if(error?.outcome==='unknown'){attention=true;q('[data-attn]').hidden=false;status('OUTCOME UNKNOWN — VERIFY · '+C.clean(error.message||error),'bad');}else status('STOPPED · '+C.clean(error.message||error),'bad');}finally{setBusy(false);}};
    q('[data-stop]').onclick=()=>stop?.();q('[data-attn]').onclick=()=>{attention=false;q('[data-attn]').hidden=true;q('[data-run]').disabled=false;status('Attention cleared');};return{dispose(){stop?.();}};
  }

  return Object.freeze({mountMove,mountEdit,mountFcsku,mountDate});
})();

// ---- src/apps/aft.js ----
V3.boot=()=>{
  const C=V3.core,life=C.lifecycle('aft'),telemetry=C.telemetry('aft',V3.build.version);
  let stopFlag=false,busy=false,pulseTimer=0,currentUi=null;
  const engine=V3.aft.create({life,telemetry,stopped:()=>stopFlag});
  const WORKER=location.hash==='#v3-iss-worker'&&window.parent!==window;
  const PARENT='https://aft-poirot-website-nrt.nrt.proxy.amazon.com';

  const runFresh=fn=>async payload=>{stopFlag=false;return fn(payload);};
  const direct={
    move:runFresh(p=>engine.runMove(p)),
    editEach:runFresh(p=>engine.runEditEach(p)),
    editSku:runFresh(p=>engine.runEditSku(p)),
    fcsku:runFresh(p=>engine.runFcsku(p)),
    date:runFresh(p=>engine.runDate(p)),
    stop(){stopFlag=true;}
  };

  if(WORKER){
    const send=(type,payload={})=>{try{window.parent.postMessage({type,worker:'aft',version:V3.build.version,...payload},PARENT);}catch{}};
    const pulseStart=()=>{pulseStop();pulseTimer=setInterval(()=>{if(busy)send('V3_AFT_PROGRESS',{pulse:true,message:'working'});},12000);};
    const pulseStop=()=>{if(pulseTimer){clearInterval(pulseTimer);pulseTimer=0;}};
    life.own(pulseStop);
    life.on(window,'message',async event=>{
      if(event.origin!==PARENT||event.source!==window.parent)return;
      const msg=event.data;if(msg?.type!=='V3_AFT_RPC'||!msg.id)return;
      if(msg.command==='ping'){send('V3_AFT_RESULT',{id:msg.id,ok:true,data:{ready:true}});return;}
      if(msg.command==='stop'){stopFlag=true;send('V3_AFT_RESULT',{id:msg.id,ok:true,data:{stopped:true}});return;}
      if(busy){send('V3_AFT_RESULT',{id:msg.id,ok:false,error:'AFT worker busy'});return;}
      busy=true;stopFlag=false;pulseStart();
      const progress=p=>send('V3_AFT_PROGRESS',{id:msg.id,area:String(msg.command||'').split('.')[0],progress:p});
      try{
        let data;
        if(msg.command==='move.run')data=await engine.runMove({...msg.payload,onProgress:progress});
        else if(msg.command==='edit.each')data=await engine.runEditEach({...msg.payload,onProgress:progress});
        else if(msg.command==='edit.sku')data=await engine.runEditSku({...msg.payload,onProgress:progress});
        else if(msg.command==='fcsku.run')data=await engine.runFcsku({...msg.payload,onProgress:progress});
        else if(msg.command==='date.run')data=await engine.runDate({...msg.payload,onProgress:progress});
        else throw new Error('Unknown AFT worker command');
        send('V3_AFT_RESULT',{id:msg.id,ok:true,data});
      }catch(error){
        send('V3_AFT_RESULT',{id:msg.id,ok:false,error:C.clean(error.message||error),outcome:error?.outcome||'',partial:error?.aftPartial||null});
      }finally{busy=false;pulseStop();}
    });
    send('V3_AFT_READY',{ready:true});
    return;
  }

  const panel=C.panel({id:'aft-tools',title:'V3 · AFT Tools',width:620,life});
  let mounted=false,sub='edit';
  const mount=()=>{
    if(!mounted)mounted=true;
    const root=document.createElement('div');
    const route=location.pathname.toLowerCase();
    if(route.includes('/app/moveitems')){
      V3.workflowUI.mountMove(root,{run:direct.move,stop:direct.stop,prefix:'aft.move'});
    }else if(route.includes('/app/fcskuflip')){
      V3.workflowUI.mountFcsku(root,{run:direct.fcsku,stop:direct.stop,prefix:'aft.fcsku'});
    }else{
      root.innerHTML='<div class="v3-tabs"><button class="v3-btn" data-sub="edit">EDIT</button><button class="v3-btn" data-sub="date">DATE</button></div><div data-work></div>';
      const work=root.querySelector('[data-work]'),paint=()=>{for(const b of root.querySelectorAll('[data-sub]'))b.classList.toggle('active',b.dataset.sub===sub);work.replaceChildren();if(sub==='date')V3.workflowUI.mountDate(work,{run:direct.date,stop:direct.stop,prefix:'aft.date'});else V3.workflowUI.mountEdit(work,{runEach:direct.editEach,runSku:direct.editSku,stop:direct.stop,prefix:'aft.edit'});};
      for(const b of root.querySelectorAll('[data-sub]'))b.onclick=()=>{direct.stop();sub=b.dataset.sub;paint();};paint();
    }
    panel.set(root);
  };
  C.dockButton({id:'aft-tools',label:'AFT',title:'V3 AFT Tools',onClick:()=>{mount();panel.open();}});
};

if(typeof V3.boot!=='function')throw new Error('V3 boot missing');
V3.boot();
})();
