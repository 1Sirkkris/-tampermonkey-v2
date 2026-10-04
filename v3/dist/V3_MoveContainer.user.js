// ==UserScript==
// @name         V3 | BWU2 MoveContainer
// @name:en      V3 | BWU2 MoveContainer
// @namespace    https://github.com/1Sirkkris/-tampermonkey-v2/v3-relaunch
// @version      0.1.0
// @description  Native MoveContainer sequential queue using the shared V3 move engine.
// @include      /^https?:\/\/aft-moveapp-[^\/.]+(?:\.nrt)?\.proxy\.amazon\.com\/move-container(?:[\/?#]|$)/
// @run-at       document-body
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      aft-moveapp-nrt-nrt.nrt.proxy.amazon.com
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-relaunch/v3/dist/V3_MoveContainer.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-relaunch/v3/dist/V3_MoveContainer.user.js
// @v3-build     movecontainer-0.1.0-dbce33eb
// ==/UserScript==

(()=>{
'use strict';
const V3=Object.create(null);
V3.build=Object.freeze({"id":"movecontainer-0.1.0-dbce33eb","version":"0.1.0","suite":"movecontainer"});

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

// ---- src/services/movecontainer.js ----
V3.moveContainer=(()=>{
  const URL='https://aft-moveapp-nrt-nrt.nrt.proxy.amazon.com/api/move-container';
  const FLOORS=['P1','P2','P3','P4'];
  const UPPER=[['Cubiscan','dz-Pcubiscan-{floor}'],['Prep','dz-P-Prep-{floor}'],['ISS','dz-P-ISS-{floor}'],['Damages','dz-P-Damages-{floor}'],['Hazmat','dz-P-Hazmat-{floor}'],['Nonsort','dz-Pnonsort-{floor}']];
  const P1=[['Hazmat','dz-P-HAZMAT_OUT'],['Ticketland','dz-P-Ticketland'],['Consolidation','dz-P-issconsol'],['ISS WIP','dz-S-ISSWIP1'],['Nonsort','dz-P-IB-nonsort'],['Shipdock','dz-P-ISS-Shipdock'],['OB IOL','dz-P-OBIOL'],['Damageland','dz-Pdamageland'],['Receive Damages','dz-P-rcv-Damages']];
  const destination=(floor,type)=>{if(type==='PRIME')return'dz-P-PRIME';const found=(floor==='P1'?P1:UPPER).find(([name])=>name===type);return !found?'':floor==='P1'?found[1]:found[1].replace('{floor}',floor);};
  const choices=floor=>[['PRIME','dz-P-PRIME'],...(floor==='P1'?P1:UPPER.map(([name,tpl])=>[name,tpl.replace('{floor}',floor)]))];
  async function move(container,dest,{telemetry}={}){
    const code=V3.base.clean(container),target=V3.base.clean(dest);if(!V3.base.container(code))throw new Error('Container must be tsX/csX');if(!target)throw new Error('Destination required');
    const op=V3.operation.create({kind:'move-container',ref:code,telemetry});op.submitted({destination:target});
    let result;
    try{result=await V3.transport.gm(URL,{method:'POST',body:JSON.stringify({sourceScannableId:null,destinationScannableId:target,containerScannableId:code,confirmed:'true'}),headers:{'Content-Type':'application/json'},timeout:15000,allowHttpError:true});}
    catch(error){op.unknown({reason:'transport'});throw new V3.operation.UnknownError('Move submitted; confirmation lost',{cause:error});}
    if(result.status>=500){op.unknown({status:result.status});throw new V3.operation.UnknownError('Move HTTP '+result.status+'; verify before retry');}
    if(result.status<200||result.status>=300){op.rejected({status:result.status});throw new V3.operation.RejectedError('Move rejected HTTP '+result.status,{status:result.status,data:result.data});}
    try{if(result.finalUrl&&new URL(result.finalUrl).pathname.replace(/\/+$/,'')!==new URL(URL).pathname.replace(/\/+$/,'')){op.unknown({reason:'redirect'});throw new V3.operation.UnknownError('Move confirmation redirected unexpectedly');}}catch(error){if(error?.outcome==='unknown')throw error;}
    op.confirmed({status:result.status,destination:target});return result;
  }
  return Object.freeze({URL,FLOORS,UPPER,P1,destination,choices,move});
})();

// ---- src/apps/movecontainer/index.js ----
V3.boot=()=>{
  const life=V3.lifecycle.create('movecontainer'),telemetry=V3.telemetry.create('movecontainer',V3.build.version),queue=V3.queue.create({name:'movecontainer',life,telemetry});
  const panel=V3.ui.panel({id:'bwu2-v3-movecontainer-panel',title:'V3 · MoveContainer',width:560,life});let busy=false,floor='P2',type='PRIME';
  async function render(){await queue.load();const s=queue.state,root=document.createElement('div'),choices=V3.moveContainer.choices(floor);root.innerHTML='<section class="section"><div class="grid"><label class="field">Floor<select data-floor>'+V3.moveContainer.FLOORS.map(x=>'<option'+(x===floor?' selected':'')+'>'+x+'</option>').join('')+'</select></label><label class="field">Drop<select data-drop>'+choices.map(([n])=>'<option'+(n===type?' selected':'')+'>'+V3.base.esc(n)+'</option>').join('')+'</select></label></div><label class="field">Containers<textarea data-input></textarea></label><div class="row"><button class="btn" data-add>ADD</button><button class="btn primary" data-run>RUN</button><button class="btn" data-pause>PAUSE</button><button class="btn" data-done>CLEAR DONE</button></div><div class="note" style="margin-top:8px">'+V3.base.esc(s.message||'Ready')+'</div></section><section class="section"><div data-list></div></section>';panel.set(root);
    const list=root.querySelector('[data-list]');list.innerHTML=s.items.map(i=>'<div style="padding:6px;border-bottom:1px solid #39475b"><b>'+V3.base.esc(i.id)+'</b> · '+i.status.toUpperCase()+(i.error?' · '+V3.base.esc(i.error):'')+'</div>').join('')||'<div class="note">Queue empty.</div>';
    root.querySelector('[data-floor]').onchange=e=>{floor=e.target.value;type='PRIME';render();};root.querySelector('[data-drop]').onchange=e=>{type=e.target.value;};
    root.querySelector('[data-add]').onclick=async()=>{await queue.add(V3.base.lines(root.querySelector('[data-input]').value));render();};
    root.querySelector('[data-run]').onclick=async()=>{if(s.items.some(i=>i.status==='attention'))return queue.set({message:'Resolve ATTENTION before RUN'}).then(render);await queue.set({running:true,message:'Starting'});render();pump();};
    root.querySelector('[data-pause]').onclick=async()=>{await queue.set({running:false,message:'Pause requested'});render();};
    root.querySelector('[data-done]').onclick=async()=>{await queue.clearDone();render();};
  }
  async function pump(){if(busy||!queue.state.running)return;if(!queue.acquire()){await queue.set({running:false,message:'Queue active in another tab'});return render();}const item=queue.next();if(!item){await queue.set({running:false,current:'',message:'Queue complete'});queue.release();return render();}busy=true;await queue.item(item,{status:'active',error:''});await queue.set({current:item.id,message:'Moving '+item.id});render();try{await V3.moveContainer.move(item.id,V3.moveContainer.destination(floor,type),{telemetry});await queue.item(item,{status:'done'});await queue.set({current:'',message:'MOVED '+item.id});}catch(error){const unknown=error?.outcome==='unknown';await queue.item(item,{status:unknown?'attention':'rejected',error:unknown?'OUTCOME UNKNOWN — VERIFY BEFORE RETRY':String(error.message||error)});await queue.set({running:false,current:'',message:String(error.message||error)});}finally{busy=false;if(!queue.state.running)queue.release();render();}if(queue.state.running)life.timeout(pump,160);}
  V3.ui.dockButton({id:'movecontainer',label:'MOVE CONTAINER',title:'V3 MoveContainer Queue',onClick:()=>{render();panel.open();}});
};

if(typeof V3.boot!=='function')throw new Error('V3 boot missing');
V3.boot();
})();
