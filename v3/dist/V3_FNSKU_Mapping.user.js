// ==UserScript==
// @name         V3 | BWU2 FNSKU Mapping
// @name:en      V3 | BWU2 FNSKU Mapping
// @namespace    https://github.com/1Sirkkris/-tampermonkey-v2/v3-groundup
// @version      0.1.0
// @description  Exact regional FNSKU/ASIN mapping helper.
// @match        https://fba-fnsku-commingling-console-eu.aka.amazon.com/tool/fnsku-mappings-tool*
// @match        https://fba-fnsku-commingling-console-na.aka.amazon.com/tool/fnsku-mappings-tool*
// @match        https://fba-fnsku-commingling-console-jp.aka.amazon.com/tool/fnsku-mappings-tool*
// @run-at       document-body
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @connect      fba-fnsku-commingling-console-eu.aka.amazon.com
// @connect      fba-fnsku-commingling-console-na.aka.amazon.com
// @connect      fba-fnsku-commingling-console-jp.aka.amazon.com
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-groundup/v3/dist/V3_FNSKU_Mapping.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-groundup/v3/dist/V3_FNSKU_Mapping.user.js
// @v3-build     fnsku-0.1.0-5ac176f7
// ==/UserScript==

(()=>{
'use strict';
const V3=Object.create(null);
V3.build=Object.freeze({"id":"fnsku-0.1.0-5ac176f7","version":"0.1.0"});

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

// ---- src/apps/fnsku.js ----
V3.boot=()=>{
  const C=V3.core,life=C.lifecycle('fnsku'),telemetry=C.telemetry('fnsku',V3.build.version);
  const HOSTS={na:'fba-fnsku-commingling-console-na.aka.amazon.com',eu:'fba-fnsku-commingling-console-eu.aka.amazon.com',jp:'fba-fnsku-commingling-console-jp.aka.amazon.com'};
  const token=()=>new URL(location.href).searchParams.get('anti-csrftoken-a2z')||document.querySelector('[name="anti-csrftoken-a2z"]')?.value||'';
  const build=(region,type,{fnsku='',asin=''}={})=>{
    const u=new URL('/tool/fnsku-mappings-tool/get','https://'+HOSTS[region]);
    for(const [k,v] of Object.entries({getMappingsType:type,FNSku:'',FNSkus:fnsku?fnsku+'\r\n':'',merchantId:'',MSkus:'',ASIN:asin,includeInactive:'true',includeInternalMerchants:'false',submit:'get',paginationToken:''}))u.searchParams.set(k,v);
    if(token())u.searchParams.set('anti-csrftoken-a2z',token());return u;
  };
  const parse=raw=>{
    const doc=C.html(raw),table=doc.querySelector('#fnsku-table')||doc.querySelector('table.table');if(!table)return[];
    const rows=[...table.querySelectorAll('tr')];if(rows.length<2)return[];
    const heads=[...rows[0].querySelectorAll('th,td')].map(x=>C.lower(x.textContent));
    const idx={merchant:heads.findIndex(x=>/merchant\s*id/.test(x)),msku:heads.findIndex(x=>/msku/.test(x)),fnsku:heads.findIndex(x=>/fnsku/.test(x)),asin:heads.findIndex(x=>/^asin$/.test(x)),condition:heads.findIndex(x=>/condition/.test(x)),status:heads.findIndex(x=>/status/.test(x))};
    return rows.slice(1).map(tr=>{const cells=[...tr.querySelectorAll('td')].map(x=>C.clean(x.textContent)),get=i=>i>=0?cells[i]||'':'';return{merchantId:get(idx.merchant),msku:get(idx.msku),fnsku:C.upper(get(idx.fnsku)),asin:C.upper(get(idx.asin)),condition:get(idx.condition),status:get(idx.status)};}).filter(x=>x.fnsku||x.asin);
  };
  const request=async url=>(await C.request(url.toString(),{headers:{Accept:'text/html, */*; q=0.01','X-Requested-With':'XMLHttpRequest'},timeout:12000,allowHtml:true})).raw;
  const exactFnsku=async(region,fnsku)=>parse(await request(build(region,'FNSKU_MAPPINGS',{fnsku}))).filter(r=>r.fnsku===fnsku);
  const exactAsin=async asin=>parse(await request(build('jp','ASIN_MAPPINGS',{asin}))).filter(r=>r.asin===asin);
  const panel=C.panel({id:'fnsku',title:'V3 · FNSKU Mapping',width:760,life});let mounted=false;
  const mount=()=>{if(mounted)return;mounted=true;const root=document.createElement('div');
    root.innerHTML='<section class="v3-section"><label class="v3-field">FNSKU / ASIN<input data-code autocomplete="off"></label><button class="v3-btn primary" data-run>LOOKUP</button><div class="v3-note" data-msg></div></section><section class="v3-section"><div data-out></div></section>';panel.set(root);
    const input=root.querySelector('[data-code]'),msg=root.querySelector('[data-msg]'),out=root.querySelector('[data-out]');
    const copy=text=>{if(typeof GM_setClipboard==='function')GM_setClipboard(text,'text');else navigator.clipboard?.writeText(text);};
    root.querySelector('[data-run]').onclick=async()=>{const code=C.upper(input.value);if(!code)return;msg.className='v3-note v3-warn';msg.textContent='LOOKING…';out.innerHTML='';
      try{let asin='',source=[];if(/^B0[A-Z0-9]{8}$/.test(code)){asin=code;}else{
        const results=(await Promise.all(['na','eu','jp'].map(region=>exactFnsku(region,code)))).flat();
        const asins=[...new Set(results.map(r=>r.asin).filter(x=>/^B0[A-Z0-9]{8}$/.test(x)))];
        if(asins.length!==1)throw new Error(asins.length?'Multiple exact ASINs found — stopped instead of guessing':'No exact FNSKU mapping');
        asin=asins[0];source=results.filter(r=>r.asin===asin);
      }
      const jp=await exactAsin(asin);msg.className='v3-note v3-ok';msg.textContent='ASIN '+asin+' · '+jp.length+' JP/AU exact row(s)';
      const rows=(source.length?source:jp).concat(source.length?jp:[]);out.innerHTML=rows.map(r=>'<div class="v3-list-row"><button class="v3-btn" data-copy="'+C.esc(r.fnsku)+'">'+C.esc(r.fnsku||'—')+'</button> · <button class="v3-btn" data-copy="'+C.esc(r.asin)+'">'+C.esc(r.asin||'—')+'</button> · '+C.esc(r.msku||'—')+' · '+C.esc(r.merchantId||'—')+' · '+C.esc(r.status||'')+'</div>').join('')||'<div class="v3-note">No exact rows.</div>';
      for(const b of out.querySelectorAll('[data-copy]'))b.onclick=()=>copy(b.dataset.copy);
      telemetry.emit('lookup',{input:C.mask(code),asin:C.mask(asin),rows:jp.length});
      }catch(error){msg.className='v3-note v3-bad';msg.textContent=error.message;}
    };
  };
  C.dockButton({id:'fnsku',label:'FNSKU',title:'V3 FNSKU Mapping',onClick:()=>{mount();panel.open();}});
};

if(typeof V3.boot!=='function')throw new Error('V3 boot missing');
V3.boot();
})();
