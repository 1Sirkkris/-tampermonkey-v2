// ==UserScript==
// @name         V3 | BWU2 ISS Console
// @name:en      V3 | BWU2 ISS Console
// @namespace    https://github.com/1Sirkkris/-tampermonkey-v2/v3-relaunch
// @version      0.1.0
// @description  ISS Console for Edit, Move, Sideline and FCSKU using shared V3 engines.
// @match        https://aft-poirot-website-nrt.nrt.proxy.amazon.com/*
// @run-at       document-body
// @noframes
// @grant        GM_xmlhttpRequest
// @connect      aft-qt-jp.aka.nrt.corp.amazon.com
// @connect      aft-poirot-website-nrt.nrt.proxy.amazon.com
// @connect      pandash.amazon.com
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-relaunch/v3/dist/V3_ISS_Console.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-relaunch/v3/dist/V3_ISS_Console.user.js
// @v3-build     iss-0.1.0-c14bd335
// ==/UserScript==

(()=>{
'use strict';
const V3=Object.create(null);
V3.build=Object.freeze({"id":"iss-0.1.0-c14bd335","version":"0.1.0","suite":"iss"});

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

// ---- src/services/pandash.js ----
V3.pandash=(()=>{
  function create({telemetry,warehouse}={}){
    const cache=new Map();
    const fc=()=>V3.base.upper(typeof warehouse==='function'?warehouse():warehouse||V3.fcr?.warehouse?.()||'BWU2');
    async function check(asinValue){
      const asin=V3.base.upper(asinValue),site=fc();if(!/^B[A-Z0-9]{9}$/.test(asin))throw new Error('ASIN required');if(!site)throw new Error('Warehouse unavailable');
      const key=site+'|'+asin;if(cache.has(key))return cache.get(key);
      const boot=await V3.transport.gm('https://pandash.amazon.com/GridServlet?fc='+encodeURIComponent(site),{timeout:8000});
      const restriction=V3.base.clean(boot.data?.restriction||'default')||'default';
      const body='language=default&source='+encodeURIComponent(restriction)+'-hazmat-FC&marketPlaces=AU&asins='+encodeURIComponent(asin)+'&rows=1&page=1&fc='+encodeURIComponent(site);
      const result=await V3.transport.gm('https://pandash.amazon.com/GridServlet',{method:'POST',body,headers:{'Content-Type':'application/x-www-form-urlencoded'},timeout:8000});
      const row=Array.isArray(result.data?.rows)?result.data.rows.find(x=>V3.base.upper(x?.asin)===asin):null;if(!row)throw new Error('No Pandash result');
      const value={asin,warehouse:site,level:Number(row.level||0),message:V3.base.clean(row.message),allowed:/can be processed/i.test(V3.base.clean(row.message))};
      cache.set(key,value);telemetry?.emit('pandash',{asin:V3.telemetry.mask(asin),level:value.level,allowed:value.allowed});return value;
    }
    return Object.freeze({check,clear:()=>cache.clear()});
  }
  return Object.freeze({create});
})();

// ---- src/services/aft.js ----
V3.aft=(()=>{
  const DEFINITIONS={
    'edit:each':{title:'Edit EACH',path:'/app/edititems',instructionId:'EditItems',tool:'edititems',input:'EACH'},
    'edit:sku':{title:'Edit SKU',path:'/app/edititems',instructionId:'EditItems',tool:'edititems',input:'SKU'},
    'edit:date':{title:'Edit DATE',path:'/app/edititems',instructionId:'EditItems',tool:'edititems',input:'DATELOT'},
    'edit:fcsku':{title:'FCSKU Flip',path:'/app/fcskuflip',instructionId:'FcSkuFlip',tool:'fcskuflip',input:'SKU'},
    'move:multi':{title:'Move Multi',path:'/app/moveitems',instructionId:'MoveItems',tool:'moveitems',input:'MULTI'}
  };
  const EDIT_STATES=[
    ['location',['scan location','scan container','input location','enter location','enter container']],
    ['item',['input fnsku or fcsku','input item','scan item','enter the sku','enter item']],
    ['sourceState',['select source inventory state']],
    ['sourceDisp',['select source disposition','select source disposition type']],
    ['newState',['select new inventory state']],
    ['newDisp',['select new disposition','select disposition type']],
    ['confirm',['confirm change','confirm to continue']],
    ['success',['success items changed','items changed from','current expiry date:']],
    ['retryError',['failed to change consumer type. please try again','failed to change consumer type']],
    ['error',['work is errored','the service failed to process your request','service failed']]
  ];
  const HEADERS={'Content-Type':'application/json; charset=utf-8','Accept':'application/json, text/javascript, */*; q=0.01','X-Requested-With':'XMLHttpRequest'};
  const classifyEdit=text=>{const v=V3.base.lower(text);let state='unknown',best=Infinity;for(const [name,phrases] of EDIT_STATES)for(const phrase of phrases){const i=v.indexOf(phrase);if(i>=0&&i<best){best=i;state=name;}}return state;};
  const objectId=raw=>String(raw||'').match(/(?:&quot;|")objectId(?:&quot;|")\s*:\s*(?:&quot;|")([^"&<]+)(?:&quot;|")/i)?.[1]||String(raw||'').match(/\b[A-Z0-9]{2,12}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i)?.[0]||'';
  const snapshotText=raw=>{const doc=V3.base.html(raw);for(const el of doc.querySelectorAll('script,style,noscript,template,svg,[hidden],[aria-hidden="true"],[style*="display:none"],[style*="visibility:hidden"]'))el.remove();return{doc,text:V3.base.clean(doc.body?.textContent||''),headings:V3.base.clean([...doc.querySelectorAll('h1,h2,h3,[role="heading"]')].map(x=>x.textContent||'').join(' '))};};
  const extractWorkflow=(raw,definition)=>{
    const source=String(raw||'').replace(/&quot;/gi,'"').replace(/&#34;/gi,'"').replace(/&#x22;/gi,'"').replace(/\\\"/g,'"').replace(/&amp;/gi,'&');
    const anchor=new RegExp('"instructionId"\\s*:\\s*"'+definition.instructionId+'"','i').exec(source);if(!anchor)return null;
    const scope=source.slice(anchor.index,anchor.index+2600),grab=name=>scope.match(new RegExp('"'+name+'"\\s*:\\s*"([^"]+)"','i'))?.[1]||'';
    const wf={instructionId:grab('instructionId'),tool:grab('tool').toLowerCase(),objectId:grab('objectId'),status:grab('status').toUpperCase(),selector:/<input\b[^>]*\bname\s*=\s*["']options["']/i.test(source)};
    if(!wf.objectId||wf.instructionId!==definition.instructionId)return null;if(wf.tool&&wf.tool!==definition.tool)return null;return wf;
  };
  const mapState=value=>{const v=V3.base.lower(value);if(v==='sellable'||v==='inventory')return'INVENTORY';if(v==='pending research'||v==='pending')return'PENDING_RESEARCH';if(v==='unsellable')return'UNSELLABLE';throw new Error('Unsupported inventory state '+value);};
  const mapDamage=value=>{const v=V3.base.lower(value);if(v==='amazon damage'||v==='warehouse damage')return'AMAZON_DAMAGE';if(v==='defective')return'DEFECTIVE';if(v==='distributor damage')return'DISTRIBUTOR_DAMAGE';if(v==='expired')return'EXPIRED';throw new Error('Unsupported disposition '+value);};
  const readMoveQuantity=raw=>{for(const re of [/(?:["']|&quot;)quantity(?:["']|&quot;)\s*[:=]\s*(?:["']|&quot;)?([0-9]{1,6})\b/i,/\bQuantity\b(?:<[^>]+>|\s|&nbsp;|&#160;|:|-){0,20}([0-9]{1,6})\b/i]){const qty=Number(String(raw||'').match(re)?.[1]);if(Number.isInteger(qty)&&qty>0)return{qty,verify:false};}return{qty:null,verify:/\bVerify item\b/i.test(String(raw||''))};};
  const readSourceChoices=doc=>{
    const out=[];for(const radio of doc?.querySelectorAll?.('input[type="radio"]')||[]){let label='';try{label=[...(radio.labels||[])].map(x=>x.textContent||'').join(' ');}catch{}if(!label)label=radio.closest('label')?.textContent||radio.parentElement?.textContent||'';label=V3.base.clean(label);if(!/Quantity\s*:/i.test(label)||!/Owner\s*:/i.test(label))continue;let state='';if(/Pending Research|PENDING_RESEARCH/i.test(label))state='PENDING_RESEARCH';else if(/Unsellable|UNSELLABLE/i.test(label))state='UNSELLABLE';else if(/(?:Inventory|Sellable)|\bSELLABLE\b/i.test(label))state='SELLABLE';if(!state)continue;const qty=Number(label.match(/\bQuantity\s*:\s*(\d{1,7})\b/i)?.[1]);out.push({state,label,value:radio.value||'',qty:Number.isInteger(qty)?qty:null,disabled:Boolean(radio.disabled)});}return out;
  };
  function create({origin=location.origin,telemetry,life,stopped}={}){
    origin=String(origin).replace(/\/$/,'');const cross=origin!==location.origin,stop=()=>Boolean(stopped?.()),url=path=>origin+path;
    const request=async(path,options={})=>cross?V3.transport.gm(url(path),options):V3.transport.page(path,options);
    const get=async path=>(await request(path,{allowHtml:true,timeout:15000,signal:life?.signal})).raw;
    const post=async(path,payload,options={})=>request(path,{method:'POST',body:JSON.stringify(payload),headers:HEADERS,timeout:options.timeout||20000,allowHttpError:options.allowHttpError===true,signal:life?.signal});
    const id=(def,wf)=>({id:{instructionId:def.instructionId,objectId:wf.objectId}});
    const route=def=>def.path+'?experience=Desktop';
    const bootstrap=async def=>{const wf=extractWorkflow(await get(route(def)),def);if(!wf)throw new Error(def.title+': workflow not found');return wf;};
    const status=async(wf,def)=>{const r=await post('/status',id(def,wf));const s=String(r.data?.status||'').toUpperCase();if(!s)throw new Error('AFT status missing');return s;};
    const waitStatus=async(wf,def,accepted,{timeout=20000,pollMs,label='AFT',operation,ignoreStop=false}={})=>{
      const wanted=new Set(accepted),started=performance.now();let polls=0,last=wf.status||'';
      while(performance.now()-started<timeout){
        if(stop()&&!ignoreStop)throw new Error('Stopped by user');
        try{last=await status(wf,def);}catch(error){if(operation){operation.unknown({reason:'status-transport'});throw new V3.operation.UnknownError(label+': status confirmation lost',{cause:error});}throw error;}
        polls++;if(wanted.has(last)){telemetry?.emit('aft.status',{label,state:last,polls,ms:Math.round(performance.now()-started)});return last;}
        if(last==='ERRORED'){if(operation)operation.rejected({reason:'backend-errored'});throw new V3.operation.RejectedError(label+': backend ERRORED');}
        if(!['READY','PROCESSING','COMPLETE'].includes(last)){if(operation){operation.unknown({reason:'unexpected-status',state:last});throw new V3.operation.UnknownError(label+': unexpected status '+last);}throw new Error(label+': status '+last);}
        await life.sleep(pollMs??Math.min(300,60+polls*35));
      }
      if(operation){operation.unknown({reason:'status-timeout'});throw new V3.operation.UnknownError(label+': status timeout');}
      throw new Error(label+': status timeout');
    };
    const action=async(wf,def,actionName,input,label,options={})=>{
      if(stop()&&!options.ignoreStop)throw new Error('Stopped by user');
      const op=options.operation;
      if(op)op.submitted({label});
      let r;
      try{r=await post('/action',{...id(def,wf),action:actionName,input},{timeout:options.timeout||20000,allowHttpError:Boolean(op)});}
      catch(error){if(op){op.unknown({reason:'action-transport'});throw new V3.operation.UnknownError(label+': confirmation lost',{cause:error});}throw error;}
      if(op&&r.httpError){
        if(r.status>=500){op.unknown({status:r.status});throw new V3.operation.UnknownError(label+': HTTP '+r.status+' outcome unknown');}
        op.rejected({status:r.status});throw new V3.operation.RejectedError(label+': rejected HTTP '+r.status,{status:r.status,data:r.data});
      }
      const s=await waitStatus(wf,def,options.complete?['COMPLETE']:['READY'],{timeout:options.timeout||20000,pollMs:options.pollMs,ignoreStop:options.ignoreStop,operation:op,label});
      return{state:s};
    };
    const input=(wf,def,value,label,options)=>action(wf,def,'Input',value,label,options);
    const confirm=(wf,def,options)=>action(wf,def,'Confirm','Confirm','Confirm',options);
    const done=(wf,def)=>action(wf,def,'Done','Done','Done',{complete:true,timeout:180000,pollMs:300,ignoreStop:true});
    const end=(wf,def)=>post('/end',{...id(def,wf),tool:def.tool},{timeout:20000});
    const waitFresh=async(def,oldId,timeout=5000)=>{const started=performance.now();while(performance.now()-started<timeout){const next=await bootstrap(def);if(next.objectId!==oldId)return next;await life.sleep(100);}throw new Error('Fresh AFT workflow not created');};
    const ensureReady=async(def,wf=null)=>{let current=wf||await bootstrap(def);for(let i=0;i<4;i++){if(current.status==='READY')return current;if(current.status==='PROCESSING'){current.status=await waitStatus(current,def,['READY','COMPLETE'],{label:'Ready'});if(current.status==='READY'){current=await bootstrap(def);continue;}}if(current.status==='COMPLETE'){const old=current.objectId;await end(current,def);current=await waitFresh(def,old);continue;}throw new Error('Unexpected AFT state '+current.status);}throw new Error('Could not obtain READY workflow');};
    const ensureMode=async key=>{const def=DEFINITIONS[key];if(!def)throw new Error('Unknown AFT mode '+key);let wf=await ensureReady(def);if(def===DEFINITIONS['edit:fcsku']&&!wf.selector)return wf;if(!wf.selector){await action(wf,def,'SelectMode','SelectMode','Select mode');wf=await bootstrap(def);if(!wf.selector)throw new Error(def.title+': mode selector unavailable');}await action(wf,def,'Input',def.input,'Choose '+def.input,{complete:true});const old=wf.objectId;await end(wf,def);wf=await waitFresh(def,old);return ensureReady(def,wf);};
    const page=async(def,classifier)=>{const raw=await get(route(def)),view=snapshotText(raw);return{html:raw,doc:view.doc,text:view.text,state:classifier?classifier(view.headings+' '+view.text):'unknown',objectId:objectId(raw)};};
    const snapshot=async(wf,def,classifier)=>{const snap=await page(def,classifier);if(!snap.objectId||snap.objectId!==wf.objectId)throw new Error('AFT workflow changed');return snap;};
    return Object.freeze({definitions:DEFINITIONS,bootstrap,ensureReady,ensureMode,input,confirm,done,end,page,snapshot,classifyEdit});
  }
  return Object.freeze({create,DEFINITIONS,classifyEdit,mapState,mapDamage,readMoveQuantity,readSourceChoices});
})();

// ---- src/services/aft-workflows.js ----
V3.aftWorkflows=(()=>{
  function create({client,telemetry,stopped,onProgress,onQuantity}={}){
    const stop=()=>Boolean(stopped?.()),progress=(message,data={})=>onProgress?.(message,data);
    const ready=async key=>{const def=V3.aft.DEFINITIONS[key];let wf=await client.bootstrap(def);if(wf.selector)return client.ensureMode(key);return client.ensureReady(def,wf);};
    const confirmLoop=async(wf,def,ref)=>{for(let round=1;round<=10;round++){progress('Confirm '+round,{round});const op=V3.operation.create({kind:'aft-confirm',ref,telemetry});await client.confirm(wf,def,{operation:op,timeout:300000});op.confirmed({round});const snap=await client.snapshot(wf,def,V3.aft.classifyEdit);if(snap.state==='error')throw new Error('EditItems returned error');if(snap.state!=='confirm')return snap;}throw new Error('Too many confirmation rounds');};
    const target=async(wf,def,state,damage)=>{const mapped=V3.aft.mapState(state);await client.input(wf,def,mapped,'Target state',{timeout:120000});if(mapped==='UNSELLABLE')await client.input(wf,def,V3.aft.mapDamage(damage),'Target disposition',{timeout:120000});};
    async function move({source,destination,items,qtyMode='ALL',quantity=1}){
      source=V3.base.clean(source);destination=V3.base.clean(destination);items=(items||[]).map(V3.base.clean).filter(Boolean);qtyMode=String(qtyMode).toUpperCase();quantity=Number(quantity);
      if(!V3.base.container(source)||!V3.base.container(destination))throw new Error('Source and destination must be tsX/csX');if(V3.base.upper(source)===V3.base.upper(destination))throw new Error('Source and destination cannot match');if(!items.length)throw new Error('Need item barcodes');if(qtyMode==='QTY'&&(!Number.isInteger(quantity)||quantity<1))throw new Error('Enter QTY 1+');
      const def=V3.aft.DEFINITIONS['move:multi'],wf=await client.ensureMode('move:multi');await client.input(wf,def,source,'Source');const results=[];
      for(let i=0;i<items.length;i++){if(stop())throw new Error('Stopped before next item');const code=items[i];progress((i+1)+'/'+items.length+' '+code,{stage:'item',code});await client.input(wf,def,code,'Item');const page=await client.page(def);if(page.objectId!==wf.objectId)throw new Error('Quantity workflow changed');const info=V3.aft.readMoveQuantity(page.html);if(!Number.isInteger(info.qty))throw new Error('Quantity unavailable for '+code+(info.verify?' — VERIFY ITEM screen':''));const qty=qtyMode==='EACH'?1:qtyMode==='QTY'?quantity:info.qty;if(qty>info.qty)throw new Error('QTY UNAVAILABLE · '+code+' · requested '+qty+' · available '+info.qty);await client.input(wf,def,String(qty),'Quantity');if(stop())throw new Error('Stopped safely before destination');const op=V3.operation.create({kind:'aft-move-destination',ref:code,telemetry});await client.input(wf,def,destination,'Destination',{operation:op,timeout:30000});op.confirmed({qty,available:info.qty});results.push({code,qty,available:info.qty});progress((i+1)+'/'+items.length+' moved',{stage:'moved'});}
      await client.done(wf,def);await client.end(wf,def);return results;
    }
    async function editEach({rows,desiredState='Unsellable',desiredDamage='Defective'}){
      rows=(rows||[]).filter(x=>x?.location&&x?.fnsku);if(!rows.length)throw new Error('Need Location + FNSKU rows');const def=V3.aft.DEFINITIONS['edit:each'];let wf=await client.ensureMode('edit:each'),results=[];
      for(let i=0;i<rows.length;i++){if(stop())throw new Error('Stopped before next row');if(i>0)wf=await ready('edit:each');const item=rows[i];await client.input(wf,def,item.location,'Location');await client.input(wf,def,item.fnsku,'Item');const after=await client.snapshot(wf,def,V3.aft.classifyEdit);if(after.state==='sourceState')throw new Error(item.fnsku+': source state could not be inferred');if(after.state!=='newState')throw new Error(item.fnsku+': expected new state, got '+after.state);await target(wf,def,desiredState,desiredDamage);const final=await confirmLoop(wf,def,item.fnsku);if(final.state==='success')await client.done(wf,def);else if(final.state!=='item')throw new Error(item.fnsku+': expected success/item, got '+final.state);await client.end(wf,def);results.push({...item,state:'done'});}
      return results;
    }
    async function editSku({sku,currentState='Sellable',currentDamage='Defective',desiredState='Unsellable',desiredDamage='Defective'}){
      sku=V3.base.clean(sku);if(!sku)throw new Error('Enter SKU / ASIN / FNSKU / FCSKU');const wanted=V3.aft.mapState(currentState),choiceState=wanted==='INVENTORY'?'SELLABLE':wanted,def=V3.aft.DEFINITIONS['edit:sku'];let wf=await client.ensureMode('edit:sku'),flips=0;
      for(let attempt=1;attempt<=50;attempt++){if(stop())throw new Error('Stopped before next attempt');if(attempt>1)wf=await ready('edit:sku');await client.input(wf,def,sku,'SKU');const source=await client.snapshot(wf,def,V3.aft.classifyEdit);if(source.state==='retryError')throw new Error('AFT consumer-type retry error');if(source.state!=='sourceState')throw new Error('Expected source state, got '+source.state);const choices=V3.aft.readSourceChoices(source.doc),qty={sellable:null,pending:null,unsellable:null};for(const c of choices){if(c.state==='SELLABLE')qty.sellable=c.qty;else if(c.state==='PENDING_RESEARCH')qty.pending=c.qty;else if(c.state==='UNSELLABLE')qty.unsellable=c.qty;}onQuantity?.({sku,...qty,attempt});const matches=choices.filter(c=>c.state===choiceState&&!c.disabled);if(matches.length!==1)throw new Error('Source '+wanted+' ambiguous/unavailable');const selected=matches[0];if(selected.qty===0){await client.end(wf,def);return{flips,quantities:qty};}if(!Number.isInteger(selected.qty))throw new Error('Could not read '+currentState+' quantity');await client.input(wf,def,selected.value||wanted,'Source state',{timeout:120000});if(wanted==='UNSELLABLE')await client.input(wf,def,V3.aft.mapDamage(currentDamage),'Source disposition',{timeout:120000});const after=await client.snapshot(wf,def,V3.aft.classifyEdit);if(after.state!=='newState')throw new Error('Expected new state, got '+after.state);await target(wf,def,desiredState,desiredDamage);const final=await confirmLoop(wf,def,sku);if(final.state!=='success')throw new Error('Expected success, got '+final.state);await client.done(wf,def);await client.end(wf,def);flips++;}
      throw new Error('Stopped after 50 SKU attempts');
    }
    async function fcsku({oldCode,newCode,locations}){
      oldCode=V3.base.clean(oldCode);newCode=V3.base.clean(newCode);locations=(locations||[]).map(V3.base.clean).filter(Boolean);if(!oldCode||!newCode)throw new Error('Need OLD + NEW FCSKU');if(!locations.length)throw new Error('Need locations');const def=V3.aft.DEFINITIONS['edit:fcsku'];let wf=await client.ensureMode('edit:fcsku'),results=[];
      for(let i=0;i<locations.length;i++){if(stop())throw new Error('Stopped before next location');if(i>0)wf=await ready('edit:fcsku');const location=locations[i];await client.input(wf,def,location,'Container');await client.input(wf,def,oldCode,'OLD');await client.input(wf,def,newCode,'NEW');if(stop())throw new Error('Stopped safely before confirm');const op=V3.operation.create({kind:'aft-fcsku-confirm',ref:location,telemetry});await client.confirm(wf,def,{operation:op,timeout:30000});op.confirmed();await client.end(wf,def);results.push({location,state:'done'});}
      return results;
    }
    return Object.freeze({move,editEach,editSku,fcsku});
  }
  return Object.freeze({create});
})();

// ---- src/services/sideline.js ----
V3.sideline=(()=>{
  const ORIGIN='https://aft-poirot-website-nrt.nrt.proxy.amazon.com',TOOL='V3';
  const API={bootstrap:'/api/get-bootstrap-data',source:'/api/scan-source-container',item:'/api/scanitem',move:'/api/move-items',close:'/api/close-container'};
  const requestId=()=> 'amzn1.fc.v1.common.request-id.v1.AFTPoirotWebsite.'+(crypto?.randomUUID?.()||Date.now()+'-'+Math.random().toString(16).slice(2));
  const sourcePayload=container=>({containerScannableId:container,requestId:requestId(),tool:TOOL});
  const itemPayload=(source,barcode)=>({containerScannableId:source,itemBarcode:barcode,isMasterpack:null,itemAndonContext:null,requestId:requestId(),tool:TOOL});
  const closePayload=(container,empty)=>({containerScannableId:container,containerEmpty:empty===true,directedLabel:false,processPath:'UNDETERMINED',requestId:requestId(),tool:TOOL});
  const problems=r=>(Array.isArray(r?.problems)?r.problems:[]).map(p=>V3.base.clean(p?.description||p?.message||p?.reason||p?.code||p?.['@type']||'')).filter(Boolean);
  const hazmatRejected=r=>{if(!r||typeof r!=='object')return false;const f=r.filterResult||{},reason=f.reason||{},rr=r.reason||{},ps=problems(r),labels=[r.message,r.description,r.errorMessage,r.errorCode,typeof r.reason==='string'?r.reason:'',rr.type,rr.description,rr.message,rr['@type'],reason.type,reason.description,reason.message,reason['@type'],f.filterType,...ps].map(V3.base.clean).filter(Boolean);return labels.some(x=>/hazmat|dangerous.?goods/i.test(x))&&(r.success===false||f.compatible===false||ps.length>0||r.errorMessage||r.errorCode||/error|reject|incompat|filter/i.test(V3.base.clean(r['@type'])));};
  const predicant=v=>{if(v==null)return false;if(typeof v==='string')return/predicant/i.test(v);if(Array.isArray(v))return v.some(predicant);if(typeof v!=='object')return false;return Object.entries(v).some(([k,x])=>(/predicant/i.test(k)&&(x===true||(typeof x==='string'&&x&&!/^false$/i.test(x))))||predicant(x));};
  const damaged=r=>r?.filterResult?.compatible===false&&(r.filterResult?.reason?.containerDamaged===true||V3.base.lower(r.filterResult?.reason?.['@type'])==='damageditemsfilterresultreason'||/damageditemsfilter/i.test(V3.base.clean(r.filterResult?.filterType)));
  const overageLabel=v=>/\boverage(?:s)?\b|\bitem\s+not\s+in\s+(?:source\s+)?container\b|\bnot\s+in\s+source\s+container\b/i.test(V3.base.clean(v));
  const allowedOverage=r=>{if(!r||typeof r!=='object')return false;const type=V3.base.clean(r['@type']);if(type==='InvalidBarcodeResponse'||type==='RequestMultipleBarcodesResponse'||hazmatRejected(r)||predicant(r)||damaged(r))return false;const f=r.filterResult,fr=V3.base.clean(f?.reason?.type||f?.reason?.description||f?.reason?.message||f?.reason?.['@type']||f?.filterType||''),ps=problems(r);if(f?.compatible===false&&!overageLabel(fr))return false;if(ps.some(x=>!overageLabel(x)))return false;const diag=[r.message,r.description,r.errorMessage,r.errorCode,fr,...ps].map(V3.base.clean).filter(Boolean);return(overageLabel(type)||diag.some(overageLabel))&&!/hazmat|dangerous.?goods|invalid\s+barcode|incompatib|damaged|predicant|customer\s*bound/i.test([type,...diag].join(' '));};
  const resolve=(r,barcode)=>{const type=V3.base.clean(r?.['@type']),overage=allowedOverage(r);if(!r||type==='InvalidBarcodeResponse'||(r.success===false&&!overage))return{ok:false,invalid:type==='InvalidBarcodeResponse',type:type||'Unknown'};const records=(Array.isArray(r.items)?r.items:[]).filter(x=>x?.skuDetail),item=records[0],sku=item?.skuDetail;if(!item||!sku)return{ok:false,invalid:false,type:type||'Unknown'};return{ok:true,type,barcode,item,records,sku,asin:V3.base.clean(sku.asin),fnsku:V3.base.clean(sku.fnSku),fcsku:V3.base.clean(sku.fcSku),dateType:V3.base.clean(sku.datelotDetail?.expirationPromptType),dateDetail:sku.datelotDetail||{},hazmat:sku.hazmat===true,permissionLevel:V3.base.upper(sku.itemDropzoneRecommendation?.permissionLevel),overage,notInSource:type==='ItemNotInContainerResponse'||records.every(x=>Number(x.quantity)===0)};};
  const classify=(r,code)=>{const ctx=resolve(r,code),text=[r?.['@type'],r?.message,r?.description,r?.errorMessage,r?.errorCode,r?.filterResult?.filterType,r?.filterResult?.reason?.type,...problems(r)].map(V3.base.clean).join(' ');if(/damaged/i.test(text))return{kind:'red',reason:'DAMAGED / INCOMPATIBLE',ctx};if(hazmatRejected(r))return{kind:'red',reason:'HAZMAT / DANGEROUS GOODS',ctx};if(!ctx.ok)return{kind:'red',reason:ctx.invalid?'INVALID BARCODE':ctx.type==='RequestMultipleBarcodesResponse'?'MULTIPLE BARCODE MATCHES':ctx.type,ctx};if(ctx.permissionLevel==='UNDER_REVIEW')return{kind:'red',reason:'ASIN UNDER REVIEW — RIVER REQUIRED',ctx};if(ctx.dateType==='EXPIRATION_DATE'||ctx.dateType==='PRODUCTION_DATE')return{kind:'yellow',reason:ctx.dateType==='PRODUCTION_DATE'?'PRODUCTION DATE':'EXPIRY DATE',ctx};return{kind:'green',reason:'GOOD TO GO',ctx};};
  const movePayload=(source,dest,meta,ctx,qty,expirationMs)=>({itemExternalId:null,sourceContainerScannableId:source,destinationContainerScannableId:dest,scannableId:V3.base.clean(ctx.item.scannableId||ctx.barcode),quantity:String(Math.max(1,Number(qty)||1)),itemDetails:(ctx.records?.length?ctx.records:[ctx.item]).map(record=>({fcsku:V3.base.clean((record.skuDetail||ctx.sku).fcSku),quantity:Number(record.quantity)||0,consumerType:record.consumer??null,disposition:record.disposition??null,referenceId:record.referenceId??null,fnsku:V3.base.clean((record.skuDetail||ctx.sku).fnSku)})),foundProblems:[null,null,null],scannedSourceContainerAsDestination:false,datelotDetail:ctx.sku.datelotDetail||null,userEnteredExpirationDate:expirationMs,mlcCaptureDetail:{mlcClass:ctx.sku.mlcDetail?.mlcClass??'UNKNOWN',userEnteredLotCode:null,mlcMissing:ctx.sku.mlcDetail?.mlcMissing??false,mlcNotEnteredReason:null,mlcCaptureMethod:null},itemMovedToISS:false,candidatePurchaseOrders:[],packHierarchyDetail:null,itemAndonContext:null,processPath:meta?.processPath??'UNDETERMINED',requestId:requestId(),tool:TOOL});
  const reason=r=>hazmatRejected(r)?'HAZMAT':allowedOverage(r)?'OVERAGE':damaged(r)?'DESTINATION DAMAGED':predicant(r)?'PREDICANT':r?.filterResult?.compatible===false?V3.base.upper(r.filterResult?.reason?.type)||'DESTINATION INCOMPATIBLE':problems(r).join(', ')||V3.base.clean(r?.['@type']||'MOVE REJECTED').replace(/Response$/,'');
  function create({telemetry,pandash}={}){
    let warehousePromise=null;
    const call=(path,options={})=>location.origin===ORIGIN?V3.transport.page(path,options):V3.transport.gm(ORIGIN+path,options);
    const request=(path,body,options={})=>call(path,{method:'POST',body:JSON.stringify(body),headers:{'content-type':'application/json'},timeout:options.timeout||15000,allowHttpError:options.allowHttpError===true});
    const warehouse=async()=>{if(warehousePromise)return warehousePromise;warehousePromise=(async()=>{try{const r=await call(API.bootstrap+'?tool='+encodeURIComponent(TOOL),{timeout:8000});const info=r.data?.warehouseInfo,c=V3.base.upper((typeof info==='string'?info:'')||info?.warehouseId||info?.id||info?.warehouse||info?.fc||r.data?.warehouseId);if(c)return c;}catch{}return V3.base.upper(V3.fcr?.warehouse?.()||'BWU2');})();return warehousePromise;};
    const haz= pandash||V3.pandash.create({telemetry,warehouse:()=> 'BWU2'});
    const validateSource=async source=>{source=V3.base.clean(source);if(!V3.base.container(source))throw new Error('Source must be tsX/csX');const r=await request(API.source,sourcePayload(source));if(/customer\s*bound\s*shipment/i.test(JSON.stringify(r.data||{})))throw new Error('CUSTOMER-BOUND SHIPMENT');if(V3.base.clean(r.data?.['@type'])!=='ScanSourceContainerResponse'||r.data?.success!==true)throw new Error(V3.base.clean(r.data?.message||r.data?.description||r.data?.errorMessage||r.data?.['@type'])||'SOURCE VALIDATION FAILED');return r.data;};
    const preflight=async(source,barcode)=>{barcode=V3.base.clean(barcode);const r=await request(API.item,itemPayload(source,barcode),{allowHttpError:true}),base=classify(r.data,barcode);if(base.ctx?.ok&&base.ctx.hazmat&&base.kind!=='red'){try{const h=await haz.check(base.ctx.asin);if(!h.allowed)return{kind:'red',reason:'HAZMAT L'+h.level+' — NOT PROCESSABLE',ctx:base.ctx,hazmat:h};return{...base,reason:base.kind==='yellow'?base.reason:'HAZMAT L'+h.level+' — OK TO PROCESS',hazmat:h};}catch(error){return{kind:'retry',reason:'HAZMAT CHECK FAILED — '+String(error.message||error),ctx:base.ctx};}}return base;};
    const move=async({source,destination,sourceMeta,preflightResult,qty=1,expirationMs=null})=>{const ctx=preflightResult?.ctx;if(!ctx?.ok)throw new Error('Item context not moveable');const op=V3.operation.create({kind:'sideline-move',ref:ctx.barcode,telemetry});op.submitted({qty});let r;try{r=await request(API.move,movePayload(source,destination,sourceMeta,ctx,qty,expirationMs),{allowHttpError:true});}catch(error){op.unknown({reason:'transport'});throw new V3.operation.UnknownError('Move submitted; confirmation lost',{cause:error});}if(r.status>=500){op.unknown({status:r.status});throw new V3.operation.UnknownError('Move HTTP '+r.status+'; verify before retry');}const payload=r.data;if(!payload||typeof payload!=='object'){op.unknown({reason:'unexpected-response'});throw new V3.operation.UnknownError('Unexpected move confirmation');}if(allowedOverage(payload)||(r.status>=200&&r.status<300&&payload.success===true&&payload.filterResult?.compatible!==false&&!hazmatRejected(payload)&&!predicant(payload))){op.confirmed({status:r.status});return payload;}const why=reason(payload);op.rejected({reason:why,status:r.status});throw new V3.operation.RejectedError(why,{data:payload,recoverable:predicant(payload)||damaged(payload)});};
    const close=async(container,empty=true)=>{container=V3.base.clean(container);if(!V3.base.container(container))throw new Error('Container must be tsX/csX');const op=V3.operation.create({kind:'sideline-close',ref:container,telemetry});op.submitted();let r;try{r=await request(API.close,closePayload(container,empty),{allowHttpError:true});}catch(error){op.unknown({reason:'transport'});throw new V3.operation.UnknownError('Close submitted; confirmation lost',{cause:error});}if(r.status>=200&&r.status<300&&V3.base.clean(r.data?.['@type'])==='CloseContainerResponse'&&r.data?.success===true){op.confirmed();return r.data;}if(r.status>=500||!r.data){op.unknown({status:r.status});throw new V3.operation.UnknownError('Close not confirmed — verify before retry');}op.rejected({status:r.status});throw new V3.operation.RejectedError(V3.base.clean(r.data?.message||r.data?.['@type'])||'Close rejected');};
    const expiration=(ctx,date)=>{const entered=new Date(String(date)+'T00:00:00').getTime();if(!Number.isFinite(entered))throw new Error('Invalid date');return{enteredMs:entered,finalExpirationMs:ctx.dateType==='PRODUCTION_DATE'?entered+Number(ctx.dateDetail?.shelfLife||0):entered};};
    return Object.freeze({warehouse,validateSource,preflight,move,close,expiration});
  }
  return Object.freeze({create,classify,resolve,allowedOverage,hazmatRejected});
})();

// ---- src/components/edit-ui.js ----
V3.editUi=(()=>{
  const states=selected=>['Sellable','Pending Research','Unsellable'].map(v=>'<option'+(v===selected?' selected':'')+'>'+v+'</option>').join('');
  const damage=selected=>['Amazon Damage','Defective','Distributor Damage','Expired'].map(v=>'<option'+(v===selected?' selected':'')+'>'+v+'</option>').join('');
  function mount(root,{workflows,control={stop:false},title='Edit Tools',initial='sku'}={}){
    let mode=initial,busy=false;const history=[];
    const shell=document.createElement('div');root.replaceChildren(shell);
    const render=()=>{
      shell.innerHTML='<section class="section"><b>'+V3.base.esc(title)+'</b><div class="row" style="margin-top:8px"><button class="btn'+(mode==='each'?' primary':'')+'" data-mode="each">EACH</button><button class="btn'+(mode==='sku'?' primary':'')+'" data-mode="sku">SKU</button><button class="btn'+(mode==='fcsku'?' primary':'')+'" data-mode="fcsku">FCSKU</button></div></section><div data-work></div>';
      for(const button of shell.querySelectorAll('[data-mode]'))button.onclick=()=>{if(!busy){mode=button.dataset.mode;render();}};
      const work=shell.querySelector('[data-work]');
      if(mode==='each')work.innerHTML='<section class="section"><label class="field">Location ASIN FNSKU rows<textarea data-rows></textarea></label><div class="grid"><label class="field">Target state<select data-target>'+states('Unsellable')+'</select></label><label class="field">Disposition<select data-damage>'+damage('Defective')+'</select></label></div>'+controls()+'</section>';
      if(mode==='sku')work.innerHTML='<section class="section"><div class="note" style="margin-bottom:6px">Recent SKU quantities</div><div data-history style="max-height:92px;overflow:auto;margin-bottom:8px"></div><label class="field">SKU<input data-sku autocomplete="off"></label><div class="grid"><label class="field">Current<select data-current>'+states('Sellable')+'</select></label><label class="field">Current disposition<select data-current-damage>'+damage('Defective')+'</select></label><label class="field">Desired<select data-desired>'+states('Unsellable')+'</select></label><label class="field">Desired disposition<select data-desired-damage>'+damage('Defective')+'</select></label></div>'+controls()+'</section>';
      if(mode==='fcsku')work.innerHTML='<section class="section"><label class="field">OLD FCSKU<input data-old></label><label class="field">NEW FCSKU<input data-new></label><label class="field">Locations / containers<textarea data-locations></textarea></label>'+controls()+'</section>';
      wire(work);paintHistory();
    };
    const controls=()=>'<div class="row"><button class="btn primary" data-run>RUN</button><button class="btn danger" data-stop>STOP AFTER CURRENT</button></div><div class="note" data-msg style="margin-top:8px"></div>';
    const paintHistory=()=>{const box=shell.querySelector('[data-history]');if(!box)return;box.innerHTML=history.length?history.map(h=>'<div class="note" style="padding:4px 0;border-bottom:1px solid #39475b"><b>'+V3.base.esc(h.sku)+'</b> · S '+(h.sellable??'—')+' · P '+(h.pending??'—')+' · U '+(h.unsellable??'—')+'</div>').join(''):'<div class="note">No reads yet.</div>';box.scrollTop=box.scrollHeight;};
    const addQty=value=>{history.push(value);if(history.length>25)history.shift();paintHistory();};
    const wire=work=>{
      const run=work.querySelector('[data-run]'),stopBtn=work.querySelector('[data-stop]'),msg=work.querySelector('[data-msg]'),status=(text,tone='')=>{msg.className='note '+tone;msg.textContent=text;};
      run.onclick=async()=>{
        if(busy)return;busy=true;control.stop=false;run.disabled=true;status('RUNNING','warn');
        try{
          if(mode==='each'){const rows=String(work.querySelector('[data-rows]').value||'').split(/\r?\n/).map(V3.base.clean).filter(Boolean).map(line=>{const [location='',asin='',fnsku='']=line.split(/\s+/);return{location,asin,fnsku:fnsku||asin};});await workflows.editEach({rows,desiredState:work.querySelector('[data-target]').value,desiredDamage:work.querySelector('[data-damage]').value});}
          if(mode==='sku')await workflows.editSku({sku:work.querySelector('[data-sku]').value,currentState:work.querySelector('[data-current]').value,currentDamage:work.querySelector('[data-current-damage]').value,desiredState:work.querySelector('[data-desired]').value,desiredDamage:work.querySelector('[data-desired-damage]').value});
          if(mode==='fcsku')await workflows.fcsku({oldCode:work.querySelector('[data-old]').value,newCode:work.querySelector('[data-new]').value,locations:V3.base.lines(work.querySelector('[data-locations]').value)});
          status('DONE','ok');
        }catch(error){status((error?.outcome==='unknown'?'OUTCOME UNKNOWN — VERIFY · ':'')+String(error?.message||error),error?.outcome==='unknown'?'bad':'warn');}
        finally{busy=false;run.disabled=false;}
      };
      stopBtn.onclick=()=>{control.stop=true;status('STOP REQUESTED','warn');};
    };
    render();
    return Object.freeze({stopped:()=>control.stop,onQuantity:addQty,dispose:()=>{control.stop=true;}});
  }
  return Object.freeze({mount});
})();

// ---- src/components/move-ui.js ----
V3.moveUi=(()=>{
  function mount(root,{workflows,control={stop:false},life,title='MoveItems'}={}){
    let busy=false,message='';
    root.innerHTML='<section class="section"><b>'+V3.base.esc(title)+'</b><div class="note" style="margin:5px 0 10px">ALL · EACH=1 · custom QTY</div><label class="field">Mode<select data-mode><option>ALL</option><option>EACH</option><option>QTY</option></select></label><label class="field">QTY<input data-qty type="number" min="1" value="1"></label><label class="field">Source<input data-source autocomplete="off"></label><label class="field">Destination<input data-dest autocomplete="off"></label><label class="field">Items<textarea data-items></textarea></label><div class="row"><button class="btn primary" data-run>RUN</button><button class="btn danger" data-stop>STOP AFTER CURRENT</button></div><div class="note" data-msg style="margin-top:8px"></div></section>';
    const q=s=>root.querySelector(s),msg=q('[data-msg]');
    const status=(text,tone='')=>{message=text;msg.className='note '+tone;msg.textContent=text;};
    q('[data-run]').onclick=async()=>{
      if(busy)return;busy=true;control.stop=false;q('[data-run]').disabled=true;status('RUNNING','warn');
      try{const result=await workflows.move({source:q('[data-source]').value,destination:q('[data-dest]').value,items:V3.base.lines(q('[data-items]').value,{dedupe:false}),qtyMode:q('[data-mode]').value,quantity:Number(q('[data-qty]').value)});status('DONE · '+result.length+' item'+(result.length===1?'':'s'),'ok');}
      catch(error){status((error?.outcome==='unknown'?'OUTCOME UNKNOWN — VERIFY · ':'')+String(error?.message||error),error?.outcome==='unknown'?'bad':'warn');}
      finally{busy=false;q('[data-run]').disabled=false;}
    };
    q('[data-stop]').onclick=()=>{control.stop=true;status('STOP REQUESTED','warn');};
    return Object.freeze({stopped:()=>control.stop,dispose:()=>{control.stop=true;}});
  }
  return Object.freeze({mount});
})();

// ---- src/components/sideline-ui.js ----
V3.sidelineUi=(()=>{
  function mount(root,{engine,title='Sideline',life}={}){
    const sleep=ms=>life?.sleep?life.sleep(ms):new Promise(resolve=>setTimeout(resolve,ms));
    const state={source:'',destination:'',items:'',lookups:new Map(),queue:[],active:0,generation:0,running:false,paused:false,stop:false,clearSource:true,delay:true,expiry:null,dates:new Map(),aside:new Map(),attention:'',done:false};
    let preflightTimer=0;
    root.innerHTML='<section class="section"><b>'+V3.base.esc(title)+'</b><div class="grid" style="margin-top:9px"><label class="field">Source<input data-source></label><label class="field">Destination<input data-dest></label></div><label class="field">Item barcodes<textarea data-items></textarea></label><div class="row"><span class="ok" data-good>0 GOOD</span><span class="warn" data-date>0 DATE</span><span class="bad" data-aside>0 ASIDE</span><span class="note" data-check>0 CHECKING</span></div><div class="row" style="margin-top:9px"><button class="btn" data-clear>CLEAR SOURCE: ON</button><button class="btn" data-delay>DELAY: ON</button><button class="btn" data-pause hidden>PAUSE</button></div><div class="row" style="margin-top:9px"><button class="btn primary" data-run>RUN</button><button class="btn danger" data-stop>STOP AFTER CURRENT</button></div><div class="note" data-msg style="margin-top:8px"></div><div class="bad" data-attention style="margin-top:8px"></div></section><section class="section"><b>Preflight</b><div data-list style="margin-top:8px"></div></section>';
    const q=s=>root.querySelector(s),source=q('[data-source]'),dest=q('[data-dest]'),items=q('[data-items]'),list=q('[data-list]'),msg=q('[data-msg]'),attention=q('[data-attention]');
    const parsed=()=>{const map=new Map();for(const line of String(state.items||'').split(/\r?\n/)){const code=V3.base.clean(line.split(/\s+/)[0]);if(!code)continue;const key=V3.base.upper(code),entry=map.get(key)||{code,qty:0};entry.qty++;map.set(key,entry);}return[...map.values()];};
    const key=code=>V3.base.upper(state.source)+'|'+V3.base.upper(code);
    const reset=()=>{state.generation++;state.lookups.clear();state.queue=[];state.active=0;state.expiry=null;state.dates.clear();state.aside.clear();state.done=false;};
    const status=(text,tone='')=>{msg.className='note '+tone;msg.textContent=text;};
    const schedule=()=>{if(state.running||!V3.base.container(state.source))return;for(const item of parsed()){const k=key(item.code);if(state.lookups.has(k))continue;const e={key:k,code:item.code,generation:state.generation,state:'queued',result:null,error:''};state.lookups.set(k,e);state.queue.push(e);}pump();paint();};
    const scheduleSoon=()=>{
      if(preflightTimer)clearTimeout(preflightTimer);
      preflightTimer=life?.timeout?life.timeout(()=>{preflightTimer=0;schedule();},100):setTimeout(()=>{preflightTimer=0;schedule();},100);
    };
    const pump=()=>{while(!state.running&&state.active<5&&state.queue.length){const e=state.queue.shift();if(!e||e.generation!==state.generation)continue;state.active++;e.state='checking';paint();engine.preflight(state.source,e.code).then(result=>{if(e.generation!==state.generation)return;e.result=result;e.state=result.kind;if(result.kind==='red')state.aside.set(V3.base.upper(e.code),result.reason);if(result.kind==='retry')e.error=result.reason;}).catch(error=>{if(e.generation===state.generation){e.state='retry';e.error=String(error.message||error);}}).finally(()=>{state.active--;pump();paint();});}};
    const settle=async()=>{schedule();const start=Date.now();while(state.active||state.queue.length){if(Date.now()-start>30000)throw new Error('Preflight did not settle');await sleep(60);}for(const item of parsed()){const e=state.lookups.get(key(item.code));if(!e||['queued','checking','retry'].includes(e.state))throw new Error(e?.error||'Preflight incomplete: '+item.code);if(e.state==='yellow'&&!state.dates.has(V3.base.upper(item.code)))throw new Error('Date required: '+item.code);}return parsed();};
    const paint=()=>{
      let good=0,date=0,aside=0,checking=0;const rows=[];
      for(const item of parsed()){const e=state.lookups.get(key(item.code)),st=e?.state||'checking';if(st==='green')good+=item.qty;else if(st==='yellow')date+=item.qty;else if(st==='red')aside+=item.qty;else checking+=item.qty;
        let extra='';
        if(st==='yellow'&&!state.dates.has(V3.base.upper(item.code)))extra='<div class="row" style="margin-top:5px"><input class="input" type="date" data-exp="'+V3.base.esc(item.code)+'"><button class="btn" data-apply="'+V3.base.esc(item.code)+'">APPLY</button></div>';
        rows.push('<div style="padding:7px;border-bottom:1px solid #39475b"><div class="row"><b>'+V3.base.esc(item.code)+' ×'+item.qty+'</b><span class="'+(st==='green'?'ok':st==='yellow'?'warn':st==='red'?'bad':'note')+'">'+st.toUpperCase()+'</span></div><div class="note">'+V3.base.esc(e?.result?.reason||e?.error||'CHECKING')+'</div>'+extra+'</div>');
      }
      q('[data-good]').textContent=good+' GOOD';q('[data-date]').textContent=date+' DATE';q('[data-aside]').textContent=aside+' ASIDE';q('[data-check]').textContent=checking+' CHECKING';list.innerHTML=rows.join('')||'<div class="note">Enter source + items to preflight.</div>';
      for(const button of list.querySelectorAll('[data-apply]'))button.onclick=()=>{const code=button.dataset.apply,e=state.lookups.get(key(code)),input=list.querySelector('[data-exp="'+CSS.escape(code)+'"]');try{const chosen=engine.expiration(e.result.ctx,input.value);if(state.expiry!=null&&state.expiry!==chosen.finalExpirationMs){state.aside.set(V3.base.upper(code),'MIXED EXPIRY — NEXT WORKFLOW');e.state='red';e.result={...e.result,kind:'red',reason:'MIXED EXPIRY — NEXT WORKFLOW'};}else{if(state.expiry==null)state.expiry=chosen.finalExpirationMs;state.dates.set(V3.base.upper(code),chosen);}paint();}catch(error){status(String(error.message||error),'bad');}};
      attention.innerHTML=state.attention?'<b>'+V3.base.esc(state.attention)+'</b><br><button class="btn danger" data-ack style="margin-top:6px">I VERIFIED IT · CLEAR ATTENTION</button>':'';attention.querySelector('[data-ack]')?.addEventListener('click',()=>{state.attention='';reset();paint();status('Attention cleared after verification');});
      q('[data-run]').disabled=Boolean(state.attention);
    };
    source.oninput=()=>{const next=V3.base.clean(source.value);if(V3.base.upper(next)!==V3.base.upper(state.source)){state.source=next;reset();}else state.source=next;scheduleSoon();};
    dest.oninput=()=>{const next=V3.base.clean(dest.value);if(V3.base.upper(next)!==V3.base.upper(state.destination)){state.destination=next;reset();}else state.destination=next;scheduleSoon();};
    items.oninput=()=>{state.items=items.value;reset();scheduleSoon();};
    q('[data-clear]').onclick=()=>{state.clearSource=!state.clearSource;q('[data-clear]').textContent='CLEAR SOURCE: '+(state.clearSource?'ON':'OFF');};
    q('[data-delay]').onclick=()=>{state.delay=!state.delay;q('[data-delay]').textContent='DELAY: '+(state.delay?'ON':'OFF');};
    q('[data-pause]').onclick=()=>{state.paused=!state.paused;q('[data-pause]').textContent=state.paused?'RESUME':'PAUSE';};
    q('[data-stop]').onclick=()=>{state.stop=true;state.paused=false;status('STOP REQUESTED','warn');};
    q('[data-run]').onclick=async()=>{
      if(state.running)return;if(state.done)reset();state.stop=false;
      try{if(!V3.base.container(state.source)||!V3.base.container(state.destination))throw new Error('Source and destination must be tsX/csX');if(V3.base.upper(state.source)===V3.base.upper(state.destination))throw new Error('Source and destination cannot match');const all=await settle(),movable=all.filter(x=>!state.aside.has(V3.base.upper(x.code)));if(!movable.length)throw new Error('Nothing moveable');state.running=true;q('[data-pause]').hidden=false;status('Validating source','warn');const meta=await engine.validateSource(state.source);let moved=0,failed=0;
        for(let i=0;i<movable.length;i++){if(state.stop)throw new Error('Stopped before next item');while(state.paused&&!state.stop)await sleep(80);if(i>0&&state.delay)await sleep(2000+Math.floor(Math.random()*6001));const item=movable[i],e=state.lookups.get(key(item.code)),chosen=state.dates.get(V3.base.upper(item.code));status((i+1)+'/'+movable.length+' '+item.code+' ×'+item.qty,'warn');try{await engine.move({source:state.source,destination:state.destination,sourceMeta:meta,preflightResult:e.result,qty:item.qty,expirationMs:chosen?.finalExpirationMs??null});moved+=item.qty;}catch(error){if(error?.outcome==='unknown'){state.attention='OUTCOME UNKNOWN — VERIFY '+item.code+' BEFORE RETRY';throw error;}failed+=item.qty;state.aside.set(V3.base.upper(item.code),String(error.message||error));if(error?.recoverable)throw new Error(String(error.message||error)+' — verify/change destination before continuing');}}
        if(state.clearSource&&failed===0&&state.aside.size===0)await engine.close(state.source,true);state.done=true;status('COMPLETE · moved '+moved+(failed?' · failed '+failed:''),failed?'warn':'ok');
      }catch(error){status((error?.outcome==='unknown'?'OUTCOME UNKNOWN — VERIFY · ':'')+String(error.message||error),error?.outcome==='unknown'?'bad':'warn');}
      finally{state.running=false;state.paused=false;q('[data-pause]').hidden=true;paint();}
    };
    paint();return Object.freeze({dispose:()=>{state.stop=true;state.paused=false;}});
  }
  return Object.freeze({mount});
})();

// ---- src/apps/iss/index.js ----
V3.boot=()=>{
  const POIROT='https://aft-poirot-website-nrt.nrt.proxy.amazon.com';
  if(location.origin!==POIROT||location.hash!=='#iss-console')return;
  const life=V3.lifecycle.create('iss'),telemetry=V3.telemetry.create('iss',V3.build.version);
  const panel=V3.ui.panel({id:'bwu2-v3-iss-panel',title:'V3 · ISS Console',width:780,life});let current=null,currentLife=null;
  const mount=name=>{
    current?.dispose?.();currentLife?.dispose?.();currentLife=V3.lifecycle.create('iss:'+name);panel.body.replaceChildren();
    const nav=document.createElement('div');nav.className='section';nav.innerHTML='<div class="row"><button class="btn" data-app="edit">EDIT</button><button class="btn" data-app="move">MOVE</button><button class="btn" data-app="sideline">SIDELINE</button><button class="btn" data-app="fcsku">FCSKU</button><button class="btn" data-exit>SIDELINE SITE</button></div>';
    const work=document.createElement('div');panel.body.append(nav,work);for(const b of nav.querySelectorAll('[data-app]')){if(b.dataset.app===name)b.classList.add('primary');b.onclick=()=>mount(b.dataset.app);}nav.querySelector('[data-exit]').onclick=()=>{location.hash='';location.reload();};
    if(name==='sideline'){const p=V3.pandash.create({telemetry,warehouse:'BWU2'}),engine=V3.sideline.create({telemetry,pandash:p});current=V3.sidelineUi.mount(work,{engine,title:'ISS Sideline',life:currentLife});return;}
    const control={stop:false},client=V3.aft.create({origin:'https://aft-qt-jp.aka.nrt.corp.amazon.com',telemetry,life:currentLife,stopped:()=>control.stop});let ui=null;const workflows=V3.aftWorkflows.create({client,telemetry,stopped:()=>control.stop,onQuantity:value=>ui?.onQuantity(value)});
    if(name==='move')ui=V3.moveUi.mount(work,{workflows,control,title:'ISS MoveItems'});
    else ui=V3.editUi.mount(work,{workflows,control,title:'ISS Edit Tools',initial:name==='fcsku'?'fcsku':'sku'});
    current=ui;
  };
  mount('sideline');panel.open();
};

if(typeof V3.boot!=='function')throw new Error('V3 boot missing');
V3.boot();
})();
