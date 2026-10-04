// ==UserScript==
// @name         V3 | BWU2 Hierarchy
// @name:en      V3 | BWU2 Hierarchy
// @namespace    https://github.com/1Sirkkris/-tampermonkey-v2/v3-relaunch
// @version      0.1.1
// @description  Native Hierarchy helper: typed-destination Bind queue plus direct Unbind queue.
// @match        https://tx-b-hierarchy-nrt.nrt.proxy.amazon.com/unbindHierarchy*
// @match        https://tx-b-hierarchy-nrt.nrt.proxy.amazon.com/bindHierarchy*
// @run-at       document-body
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-relaunch/v3/dist/V3_Hierarchy.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-relaunch/v3/dist/V3_Hierarchy.user.js
// @v3-build     hierarchy-0.1.1-62bc107e
// ==/UserScript==

(()=>{
'use strict';
const V3=Object.create(null);
V3.build=Object.freeze({"id":"hierarchy-0.1.1-62bc107e","version":"0.1.1","suite":"hierarchy"});

// ---- src/core/base.js ----
V3.base=(()=>{
  const clean=v=>String(v??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
  const upper=v=>clean(v).toUpperCase();
  const lower=v=>clean(v).toLowerCase();
  const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
  const id=prefix=>String(prefix||'v3')+'-'+(crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
  const container=v=>/^(?:ts|cs)x[0-9a-z_-]+$/i.test(clean(v));
  const lines=(v,{dedupe=true}={})=>{
    const out=[],seen=new Set();
    for(const raw of String(v??'').split(/\r?\n/)){
      const value=clean(raw.split(/\s+/)[0]);if(!value)continue;
      const key=upper(value);if(dedupe&&seen.has(key))continue;
      seen.add(key);out.push(value);
    }
    return out;
  };
  const json=raw=>{try{return JSON.parse(String(raw??''));}catch{return null;}};
  const html=raw=>new DOMParser().parseFromString(String(raw??''),'text/html');
  const clamp=(n,min,max)=>Math.min(max,Math.max(min,Number(n)||0));
  return Object.freeze({clean,upper,lower,esc,id,container,lines,json,html,clamp});
})();

// ---- src/core/lifecycle.js ----
V3.lifecycle=(()=>{
  function create(name='module'){
    const controller=new AbortController(),disposers=new Set();let dead=false;
    const own=fn=>{if(typeof fn==='function')disposers.add(fn);return fn;};
    const on=(target,type,listener,options={})=>{
      if(dead||!target?.addEventListener)return()=>{};
      const opts=typeof options==='boolean'?{capture:options,signal:controller.signal}:{...options,signal:controller.signal};
      target.addEventListener(type,listener,opts);
      return()=>target.removeEventListener(type,listener,opts);
    };
    const observe=(target,callback,options)=>{
      if(dead||!target||typeof MutationObserver==='undefined')return null;
      const observer=new MutationObserver(callback);observer.observe(target,options);own(()=>observer.disconnect());return observer;
    };
    const timeout=(fn,ms)=>{
      if(dead)return 0;
      const timer=setTimeout(()=>{if(!dead)fn();},Math.max(0,Number(ms)||0));own(()=>clearTimeout(timer));return timer;
    };
    const interval=(fn,ms)=>{
      if(dead)return 0;
      const timer=setInterval(()=>{if(!dead)fn();},Math.max(100,Number(ms)||0));own(()=>clearInterval(timer));return timer;
    };
    const sleep=ms=>new Promise((resolve,reject)=>{
      if(dead)return reject(new DOMException('Disposed','AbortError'));
      const timer=setTimeout(done,Math.max(0,Number(ms)||0));
      const abort=()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));};
      function done(){controller.signal.removeEventListener('abort',abort);resolve();}
      controller.signal.addEventListener('abort',abort,{once:true});
    });
    const dispose=()=>{if(dead)return;dead=true;controller.abort();for(const fn of [...disposers]){try{fn();}catch{}}disposers.clear();};
    return Object.freeze({name,signal:controller.signal,own,on,observe,timeout,interval,sleep,dispose,get disposed(){return dead;}});
  }
  return Object.freeze({create});
})();

// ---- src/core/storage.js ----
V3.storage=(()=>{
  const hasModern=()=>typeof GM==='object'&&typeof GM.getValues==='function'&&typeof GM.setValues==='function';
  async function getMany(defaults){
    if(hasModern())return GM.getValues(defaults);
    const out={};for(const [key,fallback] of Object.entries(defaults))out[key]=typeof GM_getValue==='function'?GM_getValue(key,fallback):fallback;
    return out;
  }
  async function setMany(values){
    if(hasModern())return GM.setValues(values);
    for(const [key,value] of Object.entries(values))if(typeof GM_setValue==='function')GM_setValue(key,value);
  }
  function create(namespace,schema=1){
    const prefix='bwu2.v3.'+namespace+'.s'+schema+'.';
    const key=name=>prefix+name;
    const get=async(name,fallback=null)=>(await getMany({[key(name)]:fallback}))[key(name)];
    const set=async(name,value)=>{await setMany({[key(name)]:value});return value;};
    const getAll=async defaults=>{
      const mapped={};for(const [name,value] of Object.entries(defaults))mapped[key(name)]=value;
      const raw=await getMany(mapped),out={};for(const name of Object.keys(defaults))out[name]=raw[key(name)];
      return out;
    };
    const setAll=async values=>{const mapped={};for(const [name,value] of Object.entries(values))mapped[key(name)]=value;await setMany(mapped);};
    return Object.freeze({namespace,schema,prefix,key,get,set,getAll,setAll});
  }
  return Object.freeze({create,getMany,setMany});
})();

// ---- src/core/telemetry.js ----
V3.telemetry=(()=>{
  const EVENT='bwu2:v3:obs';
  const secret=/token|secret|cookie|authorization|csrf|password|credential/i;
  const mask=value=>{const text=V3.base.clean(value);return !text||text.length<8?text:text.slice(0,3)+'…'+text.slice(-4)+'('+text.length+')';};
  const sanitize=(value,depth=0)=>{
    if(depth>4)return'[depth]';
    if(value==null||typeof value==='number'||typeof value==='boolean')return value;
    if(typeof value==='string')return value.length>500?value.slice(0,500)+'…':value;
    if(Array.isArray(value))return value.slice(0,30).map(v=>sanitize(v,depth+1));
    if(typeof value==='object'){const out={};for(const [k,v] of Object.entries(value).slice(0,50))out[k]=secret.test(k)?'[redacted]':sanitize(v,depth+1);return out;}
    return String(value);
  };
  function create(app,version){
    const emit=(type,data={})=>{
      const event={t:new Date().toISOString(),app,version,type,...sanitize(data)};
      try{window.dispatchEvent(new CustomEvent(EVENT,{detail:JSON.stringify(event)}));}catch{}
      return event;
    };
    return Object.freeze({emit});
  }
  return Object.freeze({EVENT,create,mask,sanitize});
})();

// ---- src/core/operation.js ----
V3.operation=(()=>{
  class UnknownError extends Error{constructor(message='Outcome unknown',meta={}){super(message);this.name='UnknownError';this.outcome='unknown';Object.assign(this,meta);}}
  class RejectedError extends Error{constructor(message='Rejected',meta={}){super(message);this.name='RejectedError';this.outcome='rejected';Object.assign(this,meta);}}
  const legal={prepared:new Set(['submitted','rejected']),submitted:new Set(['confirmed','rejected','unknown']),confirmed:new Set(),rejected:new Set(),unknown:new Set()};
  function create({kind='operation',ref='',telemetry}={}){
    const data={id:V3.base.id(kind),kind,ref:V3.telemetry?.mask?.(ref)||V3.base.clean(ref),phase:'prepared',outcome:'pending',started:performance.now()};
    telemetry?.emit('operation',{...data});
    const move=(phase,extra={})=>{
      if(!legal[data.phase]?.has(phase))throw new Error('Illegal operation transition '+data.phase+' → '+phase);
      data.phase=phase;
      if(phase==='confirmed')data.outcome='confirmed';
      if(phase==='rejected')data.outcome='rejected';
      if(phase==='unknown')data.outcome='unknown';
      telemetry?.emit('operation',{...data,ms:Math.round(performance.now()-data.started),...extra});
      return data;
    };
    return Object.freeze({data,submitted:x=>move('submitted',x),confirmed:x=>move('confirmed',x),rejected:x=>move('rejected',x),unknown:x=>move('unknown',x)});
  }
  return Object.freeze({create,UnknownError,RejectedError});
})();

// ---- src/core/transport.js ----
V3.transport=(()=>{
  const authLike=(status,contentType,finalUrl,raw)=>{
    const html=/text\/html|application\/xhtml/i.test(contentType||'')||/^\s*(?:<!doctype\s+html|<html\b)/i.test(raw||'');
    const auth=[401,403,419].includes(Number(status))||/(?:^|[\/?#._-])(?:login|signin|sign-in|midway|sso|auth|authenticate|federat)(?:[\/?#._-]|$)/i.test(finalUrl||'')||(html&&/\b(?:sign\s*in|log\s*in|authentication|midway|single\s+sign[- ]?on)\b/i.test(raw||''));
    return{html,auth};
  };
  const data=raw=>{try{return raw?JSON.parse(raw):null;}catch{return raw;}};
  async function gm(url,options={}){
    const request=typeof GM==='object'&&typeof GM.xmlHttpRequest==='function'?GM.xmlHttpRequest:null;
    if(request){
      let response;
      try{response=await request({method:options.method||'GET',url,data:options.body,headers:options.headers||{},timeout:options.timeout||15000,redirect:'follow'});}
      catch(error){throw error;}
      const raw=String(response.responseText??(typeof response.response==='string'?response.response:''));
      const contentType=String(response.responseHeaders||'').split(/\r?\n/).find(x=>/^content-type:/i.test(x))?.split(':').slice(1).join(':').trim()||'';
      return classify({status:response.status,raw,finalUrl:response.finalUrl||url,contentType,response},options);
    }
    if(typeof GM_xmlhttpRequest!=='function')throw new Error('GM request unavailable');
    return new Promise((resolve,reject)=>GM_xmlhttpRequest({
      method:options.method||'GET',url,data:options.body,headers:options.headers||{},timeout:options.timeout||15000,
      onload:r=>{try{resolve(classify({status:r.status,raw:String(r.responseText||''),finalUrl:r.finalUrl||url,contentType:String(r.responseHeaders||'').match(/content-type:\s*([^\r\n]+)/i)?.[1]||'',response:r},options));}catch(e){reject(e);}},
      ontimeout:()=>reject(new Error('Request timeout')),onerror:()=>reject(new Error('Network error')),onabort:()=>reject(new DOMException('Aborted','AbortError'))
    }));
  }
  async function page(url,options={}){
    const response=await fetch(url,{method:options.method||'GET',body:options.body,headers:options.headers||{},credentials:'same-origin',cache:'no-store',redirect:'follow',signal:options.signal});
    const raw=await response.text();
    return classify({status:response.status,raw,finalUrl:response.url||url,contentType:response.headers.get('content-type')||'',response},options);
  }
  function classify(result,options){
    const flags=authLike(result.status,result.contentType,result.finalUrl,result.raw);
    if(flags.auth||(flags.html&&options.allowHtml!==true))throw Object.assign(new Error('Authentication/HTML response instead of expected API response'),{status:result.status,flags});
    if((result.status<200||result.status>=300)&&options.allowHttpError!==true)throw Object.assign(new Error('HTTP '+result.status),{status:result.status,body:data(result.raw)});
    return{...result,data:data(result.raw),flags,httpError:result.status<200||result.status>=300};
  }
  return Object.freeze({gm,page,authLike});
})();

// ---- src/core/identity.js ----
V3.identity=(()=>{
  const LOGIN=/^[a-z][a-z0-9-]{2,31}$/i;
  const BAD=/^(?:login|username|user|employee|alias|logout|signin|profile|account|settings|search)$/i;
  const normalize=value=>{const v=V3.base.lower(value);return LOGIN.test(v)&&!BAD.test(v)?v:'';};
  const cookie=(doc,name)=>{
    try{for(const part of String(doc.cookie||'').split(';')){const i=part.indexOf('=');if(i<1||part.slice(0,i).trim().toLowerCase()!==name.toLowerCase())continue;let v=part.slice(i+1).trim();try{v=decodeURIComponent(v);}catch{}return v;}}catch{}
    return'';
  };
  function resolve({doc=document,pageWindow=window}={}){
    for(const key of ['employeeLogin','userLogin','autoId','autoID']){
      const value=normalize(pageWindow?.[key]);if(value)return{login:value,source:'global:'+key};
    }
    for(const selector of ['[data-employee-login]','[data-user-login]','[data-autoid]','meta[name="employeeLogin"]','meta[name="autoid"]']){
      const el=doc.querySelector(selector);if(!el)continue;
      const value=normalize(el.dataset?.employeeLogin||el.dataset?.userLogin||el.dataset?.autoid||el.content);if(value)return{login:value,source:'dom:'+selector};
    }
    for(const name of ['employeeLogin','userLogin','autoid']){
      const value=normalize(cookie(doc,name));if(value)return{login:value,source:'cookie:'+name};
    }
    const fc=normalize(cookie(doc,'fcmenu-employeeId'));if(fc)return{login:fc,source:'cookie:fcmenu-employeeId'};
    return{login:'',source:''};
  }
  return Object.freeze({normalize,resolve});
})();

// ---- src/core/ui.js ----
V3.ui=(()=>{
  const DOCK='bwu2-v3-dock',OPEN='bwu2:v3:panel-open';
  const dockCss=`:host{all:initial;position:fixed;right:12px;bottom:12px;z-index:2147482000;font-family:Arial,sans-serif}.dock{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;max-width:min(760px,calc(100vw - 24px))}button{min-height:32px;padding:6px 9px;border:1px solid #68778d;border-radius:8px;background:#161c25;color:#fff;font:800 11px Arial;cursor:pointer;box-shadow:0 4px 14px #0005}button:focus-visible{outline:3px solid #ffd84d;outline-offset:2px}`;
  const panelCss=`:host{all:initial;position:fixed;right:12px;top:12px;z-index:2147483000;font-family:Arial,sans-serif;color:#f5f7fb}.panel{width:min(var(--w,520px),calc(100vw - 24px));max-height:calc(100vh - 24px);display:flex;flex-direction:column;border:1px solid #536178;border-radius:13px;background:#10151d;box-shadow:0 18px 50px #0008;overflow:hidden}.head{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:10px 12px;background:#1a2230;border-bottom:1px solid #536178}.head b{flex:1;font:900 15px Arial}.close{width:34px;height:32px;border:1px solid #68778d;border-radius:8px;background:#252f3e;color:#fff;font:900 16px Arial;cursor:pointer}.body{flex:1 1 auto;min-height:0;overflow:auto;padding:12px}.section{padding:11px;border:1px solid #465367;border-radius:10px;background:#171d27;margin-bottom:10px}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.field{display:grid;gap:4px;margin-bottom:8px;color:#c4cedd;font:800 10px Arial}.field input,.field textarea,.field select,input.input,textarea.input,select.input{width:100%;box-sizing:border-box;min-height:35px;padding:7px 9px;border:1px solid #607087;border-radius:8px;background:#0c1118;color:#fff;font:12px Arial}.field textarea,textarea.input{min-height:90px;resize:vertical;font-family:Consolas,monospace}.btn{min-height:34px;padding:7px 10px;border:1px solid #68778d;border-radius:8px;background:#263142;color:#fff;font:900 11px Arial;cursor:pointer}.btn.primary{background:#eaf1ff;color:#111827}.btn.danger{background:#8c2420}.note{color:#bcc7d7;font:11px/1.4 Arial}.ok{color:#65f08f}.warn{color:#ffd166}.bad{color:#ff7068}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:3px solid #ffd84d;outline-offset:2px}`;
  const ensureDock=()=>{
    let host=document.getElementById(DOCK);
    if(!host){host=document.createElement('div');host.id=DOCK;host.dataset.bwu2V3Ui='1';host.attachShadow({mode:'open'}).innerHTML='<style>'+dockCss+'</style><div class="dock"></div>';document.documentElement.appendChild(host);}
    return host.shadowRoot;
  };
  const dockButton=({id,label,title,onClick})=>{
    const shadow=ensureDock();let button=shadow.querySelector('[data-id="'+CSS.escape(id)+'"]');
    if(!button){button=document.createElement('button');button.dataset.id=id;button.textContent=label;button.title=title||label;shadow.querySelector('.dock').appendChild(button);}
    button.onclick=onClick;return button;
  };
  const panel=({id,title,width=520,life})=>{
    let host=document.getElementById(id);
    if(!host){host=document.createElement('div');host.id=id;host.dataset.bwu2V3Ui='1';host.style.display='none';const shadow=host.attachShadow({mode:'open'});shadow.innerHTML='<style>'+panelCss+'</style><section class="panel" style="--w:'+Number(width)+'px"><header class="head"><b></b><button class="close" type="button">×</button></header><main class="body"></main></section>';shadow.querySelector('.head b').textContent=title;document.documentElement.appendChild(host);}
    const body=host.shadowRoot.querySelector('.body');
    const close=()=>{host.style.display='none';};
    const open=()=>{window.dispatchEvent(new CustomEvent(OPEN,{detail:id}));host.style.display='block';};
    life?.on(window,OPEN,event=>{if(event.detail!==id)close();});
    host.shadowRoot.querySelector('.close').onclick=close;
    return Object.freeze({host,body,open,close,set(content){body.replaceChildren();if(content instanceof Node)body.appendChild(content);else body.innerHTML=String(content||'');}});
  };
  return Object.freeze({dockButton,panel,OPEN});
})();

// ---- src/core/queue.js ----
V3.queue=(()=>{
  function create({name,life,telemetry,validate=V3.base.container}={}){
    const store=V3.storage.create('queue.'+name,1),owner=V3.base.id('tab'),lockKey='bwu2.v3.lock.'+name;
    let state={running:false,current:'',items:[],message:''},loaded=false;
    const load=async()=>{if(loaded)return state;const saved=await store.get('state',null);if(saved?.items&&Array.isArray(saved.items))state=saved;for(const item of state.items){if(item.status==='active'||item.id===state.current){item.status='attention';item.error='Previous session ended while active — verify before retry';}}state.running=false;state.current='';loaded=true;await save();return state;};
    const save=()=>store.set('state',state);
    const lock=()=>{try{return JSON.parse(localStorage.getItem(lockKey)||'null');}catch{return null;}};
    const acquire=()=>{const now=Date.now(),existing=lock();if(existing&&existing.owner!==owner&&Number(existing.expires)>now)return false;const token={owner,nonce:V3.base.id('lock'),expires:now+8000};localStorage.setItem(lockKey,JSON.stringify(token));const check=lock();return check?.owner===owner&&check?.nonce===token.nonce;};
    const renew=()=>{const current=lock();if(current?.owner===owner)localStorage.setItem(lockKey,JSON.stringify({...current,expires:Date.now()+8000}));};
    const release=()=>{const current=lock();if(current?.owner===owner)localStorage.removeItem(lockKey);};
    life.interval(()=>{if(state.running)renew();},2500);life.own(release);
    const add=async values=>{await load();const seen=new Set(state.items.map(x=>V3.base.upper(x.id)));for(const raw of values){const id=V3.base.clean(raw),key=V3.base.upper(id);if(!validate(id)||seen.has(key))continue;seen.add(key);state.items.push({id,status:'queued',error:''});}await save();return state.items;};
    const set=async patch=>{Object.assign(state,patch);await save();};
    const item=async(target,patch)=>{Object.assign(target,patch);await save();};
    const next=()=>state.items.find(x=>x.status==='queued')||null;
    const clearDone=async()=>{state.items=state.items.filter(x=>x.status!=='done');await save();};
    const clearAll=async()=>{if(state.running)throw new Error('Stop queue before clearing');state={running:false,current:'',items:[],message:''};await save();};
    return Object.freeze({owner,load,save,add,set,item,next,acquire,release,clearDone,clearAll,get state(){return state;}});
  }
  return Object.freeze({create});
})();

// ---- src/services/hierarchy.js ----
V3.hierarchy=(()=>{
  const WAREHOUSE='BWU2',ORIGIN='https://tx-b-hierarchy-nrt.nrt.proxy.amazon.com';
  const API={validate:'/validateContainer',summary:'/getTransshipmentBindingSummary',unbind:'/unbindContainer'};
  async function post(path,body,options={}){
    const request={method:'POST',body:JSON.stringify(body),headers:{'content-type':'application/json'},timeout:options.timeout||15000,allowHttpError:options.allowHttpError===true};
    return location.hostname==='tx-b-hierarchy-nrt.nrt.proxy.amazon.com'
      ? V3.transport.page(path,request)
      : V3.transport.gm(ORIGIN+path,request);
  }
  async function validate(id){
    const code=V3.base.clean(id),r=await post(API.validate,{warehouseId:WAREHOUSE,scannableId:code});
    if(!r.data||V3.base.upper(r.data.warehouseId)!==WAREHOUSE)throw new Error('Container is not validated in '+WAREHOUSE);
    if(r.data.scannableId&&V3.base.lower(r.data.scannableId)!==V3.base.lower(code))throw new Error('Validation returned another container');
    return r.data;
  }
  async function summary(id){
    const r=await post(API.summary,{warehouseId:WAREHOUSE,scannableId:V3.base.clean(id)});
    if(!Array.isArray(r.data?.transferBindingSummaryList))throw new Error('Unexpected binding summary');
    return r.data;
  }
  async function unbind(id,employeeLogin,{telemetry}={}){
    const code=V3.base.clean(id),login=V3.identity.normalize(employeeLogin);
    if(!V3.base.container(code))throw new Error('Container must be tsX/csX');
    if(!login)throw new Error('Authenticated employee unavailable');
    await validate(code);await summary(code);
    const op=V3.operation.create({kind:'hierarchy-unbind',ref:code,telemetry});op.submitted();
    let r;
    try{r=await post(API.unbind,{sourceWarehouseId:WAREHOUSE,scannableId:code,employeeLogin:login},{timeout:20000,allowHttpError:true});}
    catch(error){op.unknown({reason:'transport'});throw new V3.operation.UnknownError('Unbind submitted; confirmation lost',{cause:error});}
    if(r.status>=500){op.unknown({status:r.status});throw new V3.operation.UnknownError('Unbind HTTP '+r.status+'; verify before retry');}
    if(r.status<200||r.status>=300){op.rejected({status:r.status});throw new V3.operation.RejectedError('Unbind rejected HTTP '+r.status);}
    if(!V3.base.clean(r.data?.hostName)){op.unknown({reason:'unexpected-response'});throw new V3.operation.UnknownError('Unbind response ambiguous; verify container');}
    op.confirmed();return r.data;
  }
  return Object.freeze({WAREHOUSE,ORIGIN,API,validate,summary,unbind});
})();

// ---- src/services/hierarchy-native.js ----
V3.hierarchyNative=(()=>{
  const clean=V3.base.clean,upper=V3.base.upper;
  const FACILITY=/^[A-Z0-9]{3,8}$/,DESTINATION_PATH='/validateDestination';
  let seq=0;
  const records=[];

  const normalizeFacility=value=>{
    const fc=upper(clean(value));
    return FACILITY.test(fc)?fc:'';
  };

  const pathOf=value=>{
    try{return new URL(String(value||''),location.href).pathname;}
    catch{return'';}
  };

  const destinationTokenFromBody=body=>{
    if(body==null)return'';
    let value=body;
    try{
      if(typeof FormData!=='undefined'&&body instanceof FormData)value=Object.fromEntries(body.entries());
      else if(body instanceof URLSearchParams)value=Object.fromEntries(body.entries());
      else if(typeof body==='string'){
        try{value=JSON.parse(body);}
        catch{try{value=Object.fromEntries(new URLSearchParams(body).entries());}catch{}}
      }
    }catch{}
    return clean(value&&typeof value==='object'?value.destinationWarehouseId:'');
  };

  const responseFacility=raw=>{
    let value=raw;
    if(typeof raw==='string'){
      try{value=JSON.parse(raw);}catch{}
    }
    if(typeof value==='string')return normalizeFacility(value);
    if(value&&typeof value==='object'){
      return normalizeFacility(value.warehouseId||value.destination||value.facility||value.fc||'');
    }
    return'';
  };

  const record=(token,facility,status)=>{
    if(!token||!facility)return;
    records.push({seq:++seq,token,facility,status:Number(status)||0,at:Date.now()});
    if(records.length>20)records.splice(0,records.length-20);
  };

  const installDestinationTap=()=>{
    const page=typeof unsafeWindow==='object'&&unsafeWindow?unsafeWindow:window;

    try{
      const XHR=page.XMLHttpRequest;
      if(XHR?.prototype&&!XHR.prototype.__bwu2V3DestinationTap){
        const nativeOpen=XHR.prototype.open,nativeSend=XHR.prototype.send;
        XHR.prototype.open=function(method,url){
          this.__bwu2V3DestinationTapInfo={path:pathOf(url)};
          return nativeOpen.apply(this,arguments);
        };
        XHR.prototype.send=function(body){
          const info=this.__bwu2V3DestinationTapInfo||{};
          if(info.path!==DESTINATION_PATH)return nativeSend.apply(this,arguments);
          const token=destinationTokenFromBody(body);
          this.addEventListener('loadend',()=>{
            let raw='';
            try{
              if(!this.responseType||this.responseType==='text')raw=this.responseText||'';
              else if(this.responseType==='json')raw=JSON.stringify(this.response??null);
            }catch{}
            record(token,responseFacility(raw),this.status);
          },{once:true});
          return nativeSend.apply(this,arguments);
        };
        Object.defineProperty(XHR.prototype,'__bwu2V3DestinationTap',{value:true,configurable:true});
      }
    }catch{}

    try{
      const nativeFetch=page.fetch;
      if(typeof nativeFetch==='function'&&!nativeFetch.__bwu2V3DestinationTap){
        const wrapped=async function(input,init={}){
          const url=typeof input==='string'||input instanceof URL?String(input):String(input?.url||'');
          if(pathOf(url)!==DESTINATION_PATH)return nativeFetch.apply(this,arguments);
          const token=destinationTokenFromBody(init?.body);
          const response=await nativeFetch.apply(this,arguments);
          let raw='';
          try{raw=await response.clone().text();}catch{}
          record(token,responseFacility(raw),response.status);
          return response;
        };
        Object.defineProperty(wrapped,'__bwu2V3DestinationTap',{value:true});
        page.fetch=wrapped;
      }
    }catch{}
  };

  const visible=element=>{
    if(!(element instanceof Element)||!element.isConnected)return false;
    const rect=element.getBoundingClientRect();
    if(rect.width<=0||rect.height<=0)return false;
    const style=getComputedStyle(element);
    return style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity||1)!==0;
  };

  const descriptor=input=>{
    let label='';
    try{
      const direct=input.id?document.querySelector('label[for="'+CSS.escape(input.id)+'"]'):null;
      label=clean(direct?.textContent||input.closest('label')?.textContent||'');
    }catch{}
    return clean([label,input.getAttribute('name'),input.getAttribute('id'),input.getAttribute('placeholder'),input.getAttribute('aria-label')].filter(Boolean).join(' ')).toLowerCase();
  };

  const nativeInputs=()=>[...document.querySelectorAll('input[type="text"],input:not([type]),textarea,[role="combobox"]')].filter(visible);

  const destinationInput=()=>{
    const rows=nativeInputs().map(input=>{
      const d=descriptor(input);let score=0;
      if(/destination/.test(d))score+=10;
      if(/warehouse|site|facility|\bfc\b/.test(d))score+=5;
      if(/container|scannable|scan|tote/.test(d))score-=14;
      return{input,score};
    }).sort((a,b)=>b.score-a.score);
    return rows[0]?.score>0?rows[0].input:null;
  };

  const containerInput=()=>{
    const rows=nativeInputs().map(input=>{
      const d=descriptor(input);let score=0;
      if(/container|scannable|scan|tote/.test(d))score+=12;
      if(/destination|warehouse|site|facility|\bfc\b/.test(d))score-=15;
      return{input,score};
    }).sort((a,b)=>b.score-a.score);
    return rows[0]?.score>0?rows[0].input:null;
  };

  const nativeSetter=(input,value)=>{
    if(!input)return false;
    try{
      let proto=input,setter=null;
      while((proto=Object.getPrototypeOf(proto))&&!setter)setter=Object.getOwnPropertyDescriptor(proto,'value')?.set||null;
      if(setter)setter.call(input,value);else input.value=value;
      input.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
      input.dispatchEvent(new Event('change',{bubbles:true,composed:true}));
      return true;
    }catch{return false;}
  };

  const enter=async(target,life)=>{
    for(const type of ['keydown','keypress','keyup']){
      const event=new KeyboardEvent(type,{key:'Enter',code:'Enter',bubbles:true,cancelable:true});
      try{Object.defineProperty(event,'keyCode',{get:()=>13});}catch{}
      try{Object.defineProperty(event,'which',{get:()=>13});}catch{}
      if(type==='keypress')try{Object.defineProperty(event,'charCode',{get:()=>13});}catch{}
      target.dispatchEvent(event);
    }
    await life.sleep(20);
  };

  const pageText=()=>clean(document.body?.innerText||document.body?.textContent||'');
  const statusText=()=>[...document.querySelectorAll('[role="alert"],[role="status"],.alert,.error,.success,[class*="error"],[class*="Error"],[class*="success"],[class*="Success"]')]
    .filter(visible).map(node=>clean(node.textContent)).filter(Boolean).join(' | ');

  const errorSignal=()=>{
    const text=statusText();
    return text&&/(?:error|invalid|failed|cannot|unable|not\s+found|not\s+valid|reject|wrong|unknown\s+(?:warehouse|facility|destination))/i.test(text)?text:'';
  };

  const successSignal=(beforeText,container)=>{
    const status=statusText(),body=pageText(),success=/(?:success|successfully|\bbound\b|binding\s+(?:complete|completed)|container\s+bound)/i;
    if(success.test(status))return status;
    if(body!==beforeText&&success.test(body)){
      const code=upper(container);
      if(!code||upper(body).includes(code)||/successfully|binding\s+(?:complete|completed)/i.test(body))return body.slice(0,1200);
    }
    return'';
  };

  const waitFor=async(predicate,{life,timeout=10000,minMs=0,label='native page'}={})=>{
    const started=performance.now();
    while(performance.now()-started<timeout){
      const elapsed=performance.now()-started,result=predicate(elapsed);
      if(elapsed>=minMs&&result)return result;
      await life.sleep(80);
    }
    throw new Error(label+' did not settle');
  };

  const validateDestination=async(destination,{life,telemetry}={})=>{
    const fc=normalizeFacility(destination);
    if(!fc)throw new Error('Enter destination FC, e.g. BWU1 or AVV2');
    installDestinationTap();
    const marker=seq,input=destinationInput();
    if(!input)throw new Error('Native destination field not found');
    if(!nativeSetter(input,fc))throw new Error('Could not enter destination FC');
    try{input.focus({preventScroll:true});}catch{}
    await enter(input,life);
    telemetry?.emit('native.destination.submit',{destination:fc});

    const proof=await waitFor(()=>{
      const error=errorSignal();if(error)throw new Error(error);
      return records.find(item=>item.seq>marker&&item.facility===fc&&item.status>=200&&item.status<300&&item.token);
    },{life,timeout:10000,minMs:150,label:'Destination validation'});

    telemetry?.emit('native.destination.ready',{destination:fc});
    return Object.freeze({facility:fc,destinationWarehouseId:proof.token,validatedAt:Date.now()});
  };

  const settleValidationPass=async(container,beforeText,{life,telemetry}={})=>{
    let last='',stableSince=0;
    await waitFor(elapsed=>{
      const error=errorSignal();if(error)throw new Error(error);
      const current=pageText(),input=containerInput();
      if(current!==beforeText&&current!==last){last=current;stableSince=elapsed;}
      return elapsed>=700&&current!==beforeText&&elapsed-stableSince>=350&&input&&visible(input)&&!input.disabled&&clean(input.value||'')!==container;
    },{life,timeout:12000,minMs:700,label:'Container validation'});
    telemetry?.emit('native.bind.validated',{container:V3.telemetry.mask(container)});
  };

  const settleBindPass=async(container,beforeText,{life,telemetry}={})=>{
    try{
      const proof=await waitFor(()=>{
        const error=errorSignal();if(error)throw new V3.operation.RejectedError(error);
        return successSignal(beforeText,container);
      },{life,timeout:15000,minMs:250,label:'Bind confirmation'});
      telemetry?.emit('native.bind.confirmed',{container:V3.telemetry.mask(container),proof:clean(proof).slice(0,160)});
      return true;
    }catch(error){
      if(error instanceof V3.operation.RejectedError)throw error;
      throw new V3.operation.UnknownError('Bind submitted but native page did not prove success — verify container',{cause:error});
    }
  };

  const scan=async(container,{life}={})=>{
    const code=clean(container);
    if(!V3.base.container(code))throw new Error('Container must be tsX/csX');
    const input=containerInput();
    if(!input)throw new Error('Native container scan field not found');
    if(!nativeSetter(input,code))throw new Error('Could not enter container');
    try{input.focus({preventScroll:true});}catch{}
    const before=pageText();
    await enter(input,life);
    return before;
  };

  const bind=async(container,context,{life,telemetry}={})=>{
    const code=clean(container),fc=normalizeFacility(context?.facility);
    if(!V3.base.container(code))throw new Error('Container must be tsX/csX');
    if(!fc||!clean(context?.destinationWarehouseId))throw new Error('Destination must be validated before Bind');

    telemetry?.emit('native.bind.pass1',{container:V3.telemetry.mask(code),destination:fc});
    const beforeValidation=await scan(code,{life});
    await settleValidationPass(code,beforeValidation,{life,telemetry});

    const error=errorSignal();if(error)throw new V3.operation.RejectedError(error);
    const op=V3.operation.create({kind:'hierarchy-bind-native',ref:code,telemetry});
    op.submitted({destination:fc});
    telemetry?.emit('native.bind.pass2',{container:V3.telemetry.mask(code),destination:fc});
    const beforeBind=await scan(code,{life});

    try{
      await settleBindPass(code,beforeBind,{life,telemetry});
      op.confirmed({destination:fc});
      return{container:code,destination:fc};
    }catch(error2){
      if(error2?.outcome==='rejected'||error2 instanceof V3.operation.RejectedError){
        op.rejected({reason:String(error2.message||error2)});
        throw error2;
      }
      op.unknown({reason:'native-confirmation-missing'});
      throw error2;
    }
  };

  return Object.freeze({normalizeFacility,destinationTokenFromBody,responseFacility,destinationInput,containerInput,validateDestination,bind});
})();

// ---- src/apps/hierarchy/index.js ----
V3.boot=()=>{
  const life=V3.lifecycle.create('hierarchy');
  const telemetry=V3.telemetry.create('hierarchy',V3.build.version);
  const mode=/\/bindHierarchy/i.test(location.pathname)?'bind':'unbind';
  const queue=V3.queue.create({name:'hierarchy-'+mode,life,telemetry});
  const panel=V3.ui.panel({id:'bwu2-v3-hierarchy-panel',title:'V3 · '+(mode==='bind'?'Bind':'Unbind'),width:590,life});
  let busy=false,destination='',bindContext=null;

  const identity=()=>V3.identity.resolve({
    pageWindow:typeof unsafeWindow==='object'&&unsafeWindow?unsafeWindow:window
  }).login;

  async function render(){
    await queue.load();
    const s=queue.state,root=document.createElement('div');
    root.innerHTML=
      '<section class="section">'+
        (mode==='bind'
          ? '<label class="field">Destination FC<input data-destination autocomplete="off" placeholder="BWU1 / AVV2" value="'+V3.base.esc(destination)+'"></label>'+
            '<div class="note">Destination is session-only. Native /validateDestination must confirm the FC before the queue can start.</div>'
          : '')+
        '<label class="field" style="margin-top:8px">Containers<textarea data-input placeholder="tsX...\ncsX..."></textarea></label>'+
        '<div class="row"><button class="btn" data-add>ADD</button><button class="btn primary" data-run>RUN</button><button class="btn" data-pause>PAUSE</button><button class="btn" data-done>CLEAR DONE</button></div>'+
        '<div class="note" style="margin-top:8px">'+V3.base.esc(s.message||'Ready')+'</div>'+
      '</section>'+
      '<section class="section"><div data-list></div></section>';
    panel.set(root);

    const list=root.querySelector('[data-list]');
    list.innerHTML=s.items.map(item=>
      '<div style="padding:6px;border-bottom:1px solid #39475b"><b>'+V3.base.esc(item.id)+'</b> · '+item.status.toUpperCase()+
      (item.error?' · '+V3.base.esc(item.error):'')+'</div>'
    ).join('')||'<div class="note">Queue empty.</div>';

    const destinationInput=root.querySelector('[data-destination]');
    if(destinationInput){
      destinationInput.disabled=Boolean(s.running);
      destinationInput.oninput=()=>{
        destination=V3.hierarchyNative.normalizeFacility(destinationInput.value)||V3.base.upper(destinationInput.value);
        bindContext=null;
      };
    }

    root.querySelector('[data-add]').onclick=async()=>{
      await queue.add(V3.base.lines(root.querySelector('[data-input]').value));
      render();
    };

    root.querySelector('[data-run]').onclick=async()=>{
      if(s.items.some(item=>item.status==='attention')){
        await queue.set({message:'Resolve ATTENTION before RUN'});return render();
      }
      if(mode==='bind'){
        const fc=V3.hierarchyNative.normalizeFacility(destination);
        if(!fc){
          await queue.set({message:'Enter destination FC first, e.g. BWU1 or AVV2'});
          return render();
        }
        destination=fc;
        bindContext=null;
        await queue.set({running:false,message:'Validating destination '+fc+'…'});
        render();
        try{
          bindContext=await V3.hierarchyNative.validateDestination(fc,{life,telemetry});
        }catch(error){
          await queue.set({running:false,message:'Destination rejected: '+String(error.message||error)});
          bindContext=null;
          return render();
        }
      }
      await queue.set({running:true,message:'Starting'});
      render();pump();
    };

    root.querySelector('[data-pause]').onclick=async()=>{
      await queue.set({running:false,message:'Pause requested'});
      bindContext=null;
      render();
    };
    root.querySelector('[data-done]').onclick=async()=>{
      await queue.clearDone();
      render();
    };
  }

  async function pump(){
    if(busy||!queue.state.running)return;
    if(!queue.acquire()){
      await queue.set({running:false,message:'Queue active in another tab'});
      return render();
    }

    const item=queue.next();
    if(!item){
      await queue.set({running:false,current:'',message:'Queue complete'});
      bindContext=null;
      queue.release();
      return render();
    }

    busy=true;
    await queue.item(item,{status:'active',error:''});
    await queue.set({
      current:item.id,
      message:mode==='bind'?'Binding '+item.id+' → '+destination:'Unbinding '+item.id
    });
    render();

    try{
      if(mode==='bind'){
        if(!bindContext||bindContext.facility!==destination)throw new Error('Destination is no longer validated — press RUN again');
        await V3.hierarchyNative.bind(item.id,bindContext,{life,telemetry});
        await queue.item(item,{status:'done'});
        await queue.set({current:'',message:'BOUND '+item.id+' → '+destination});
      }else{
        const login=identity();
        if(!login)throw new Error('Authenticated employee identity unavailable');
        await V3.hierarchy.unbind(item.id,login,{telemetry});
        await queue.item(item,{status:'done'});
        await queue.set({current:'',message:'UNBOUND '+item.id});
      }
    }catch(error){
      const unknown=error?.outcome==='unknown'||error instanceof V3.operation.UnknownError;
      await queue.item(item,{
        status:unknown?'attention':'rejected',
        error:unknown?'OUTCOME UNKNOWN — VERIFY BEFORE RETRY':String(error.message||error)
      });
      await queue.set({running:false,current:'',message:String(error.message||error)});
      if(mode==='bind')bindContext=null;
    }finally{
      busy=false;
      if(!queue.state.running)queue.release();
      render();
    }

    if(queue.state.running)life.timeout(pump,180);
  }

  V3.ui.dockButton({
    id:'hierarchy',
    label:mode==='bind'?'BIND':'UNBIND',
    title:'V3 Hierarchy',
    onClick:()=>{render();panel.open();}
  });
};

if(typeof V3.boot!=='function')throw new Error('V3 boot missing');
V3.boot();
})();
