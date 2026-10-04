// ==UserScript==
// @name         V3 | BWU2 RIVER Assistant
// @name:en      V3 | BWU2 RIVER Assistant
// @namespace    https://github.com/1Sirkkris/-tampermonkey-v2/v3-relaunch
// @version      0.1.0
// @description  FCResearch capture plus native RIVER assistant with PO/live quantity choice.
// @include      /^https?:\/\/.*fcresearch.*\//
// @include      /^https?:\/\/qifcr\.fe\.aftx\.amazonoperations\.app\//
// @match        https://river.amazon.com/*
// @run-at       document-body
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_openInTab
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-relaunch/v3/dist/V3_RIVER_Assistant.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-relaunch/v3/dist/V3_RIVER_Assistant.user.js
// @v3-build     river-0.1.0-b83d58af
// ==/UserScript==

(()=>{
'use strict';
const V3=Object.create(null);
V3.build=Object.freeze({"id":"river-0.1.0-b83d58af","version":"0.1.0","suite":"river"});

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

// ---- src/services/fcr.js ----
V3.fcr=(()=>{
  const warehouse=()=>location.pathname.match(/^\/([^/]+)\/results(?:\/|$)/i)?.[1]||'';
  const base=()=>{const fc=warehouse();if(!fc)throw new Error('Warehouse not found in URL');return location.origin+'/'+encodeURIComponent(fc)+'/results';};
  const headers={'Content-Type':'application/x-www-form-urlencoded','Accept':'text/html, */*; q=0.01','X-Requested-With':'XMLHttpRequest'};
  const parseBool=v=>/^(true|yes|1)$/i.test(V3.base.clean(v))?true:/^(false|no|0)$/i.test(V3.base.clean(v))?false:null;
  const suspicious=value=>{
    let p=String(value||'').match(/\d+(?:\.\d+)?/g);if(!p||p.length<3)return false;p=p.slice(0,3);
    const n=p.map(Number),eq=(a,b)=>Math.abs(a-b)<.001,rounded=p.filter(x=>/\.00$/.test(x)).length;
    return eq(n[0],n[1])||eq(n[0],n[2])||eq(n[1],n[2])||rounded>=3||(Math.min(...n)<=2.001&&rounded>=2);
  };
  const parseProduct=raw=>{
    const doc=V3.base.html(raw);
    const table=doc.querySelector('.a-box-group .a-keyvalue')||[...doc.querySelectorAll('table')].find(t=>[...t.querySelectorAll('th')].some(th=>/^(asin|isbn|fnsku)$/i.test(V3.base.clean(th.textContent))))||doc.querySelector('.a-keyvalue');
    if(!table)return null;
    const data={};
    for(const row of table.querySelectorAll('tr')){const th=row.querySelector('th'),td=row.querySelector('td');if(th&&td)data[V3.base.lower(th.textContent)]=V3.base.clean(td.querySelector('a')?.textContent||td.textContent);}
    const sortable=parseBool(data.sortable);
    const product={asin:V3.base.clean(data.asin),isbn:V3.base.clean(data.isbn),fnsku:V3.base.clean(data.fnsku),fcsku:V3.base.clean(data.fcsku),title:V3.base.clean(data.title),dimensions:V3.base.clean(data.dimensions),weight:V3.base.clean(data.weight),inventoryCost:V3.base.clean(data['list price']||data.price||data['inventory cost']||''),sortable,sortableText:sortable==null?V3.base.clean(data.sortable):String(sortable),suspicious:suspicious(data.dimensions)};
    product.primary=product.asin||product.isbn;
    return product.primary||product.fnsku||product.fcsku?product:null;
  };
  const indexes=table=>{
    const hs=[...table.querySelectorAll('thead th')].map(th=>({id:V3.base.lower(th.id),text:V3.base.lower(String(th.textContent||'').replace(/\(\d+\)/g,''))}));
    const find=(...names)=>hs.findIndex(h=>names.includes(h.id)||names.includes(h.text));
    return{container:find('inventory-container','container'),asin:find('inventory-asin','asin'),fnsku:find('inventory-fnsku','fnsku'),fcsku:find('inventory-fcsku','fcsku'),lpn:find('inventory-lpn','lpn'),qty:find('inventory-quantity','quantity'),disposition:find('inventory-disposition','disposition'),consumer:find('inventory-consumer','consumer'),consumerId:find('inventory-consumer-id','consumer id','consumerid'),outerLocation:find('inventory-outer-location','outer location'),outerLocationType:find('inventory-outer-location-type','outer location type'),title:find('inventory-title','title')};
  };
  const parseInventory=doc=>{
    const table=doc.querySelector('#table-inventory');if(!table)throw new Error('Inventory table not returned');
    const idx=indexes(table),rows=[];
    for(const tr of table.tBodies?.[0]?.rows||[]){
      const val=i=>i>=0?V3.base.clean(tr.cells[i]?.textContent):'';
      const row={container:val(idx.container),asin:val(idx.asin),fnsku:val(idx.fnsku),fcsku:val(idx.fcsku),lpn:val(idx.lpn),qty:Number(val(idx.qty).replace(/[^\d.-]/g,''))||0,disposition:val(idx.disposition),consumer:val(idx.consumer),consumerId:val(idx.consumerId),outerLocation:val(idx.outerLocation),outerLocationType:val(idx.outerLocationType),title:val(idx.title)};
      if(row.asin||row.fnsku||row.fcsku)rows.push(row);
    }
    return rows;
  };
  const token=doc=>{const raw=V3.base.clean(doc.querySelector('.pagination-token')?.textContent);return raw&&/^(?:\{|\[)/.test(raw)?raw:'';};
  function create({telemetry,life}={}){
    const inFlight=new Map();
    const post=async(endpoint,fields)=>{
      const params=new URLSearchParams();for(const [k,v] of Object.entries(fields||{}))params.set(k,String(v??''));
      const key=endpoint+'|'+params.toString();if(inFlight.has(key))return inFlight.get(key);
      const work=(async()=>{let retry=0;for(;;){try{return(await V3.transport.page(base()+'/'+endpoint,{method:'POST',body:params.toString(),headers,allowHtml:true,signal:life?.signal})).raw;}catch(error){if(!(error.status>=500&&error.status<600)||retry>=2)throw error;await life.sleep([120,350][retry++]||350);}}})();
      inFlight.set(key,work);try{return await work;}finally{if(inFlight.get(key)===work)inFlight.delete(key);}
    };
    const product=async code=>parseProduct(await post('product',{s:V3.base.clean(code)}));
    const inventory=async(code,{allowPartial=false,onPreview}={})=>{
      const started=performance.now(),first=await post('inventory',{s:V3.base.clean(code)}),doc=V3.base.html(first),table=doc.querySelector('#table-inventory');
      if(!table)throw new Error('Inventory table not returned');
      const tbody=table.tBodies?.[0]||table.appendChild(doc.createElement('tbody')),expected=table.tHead?.rows?.[0]?.cells?.length||0,seen=new Set();
      let next=token(doc),pages=1,complete=true,warning='';
      onPreview?.({rows:parseInventory(doc),complete:!next,pages});
      while(next){
        if(seen.has(next)){complete=false;warning='repeated pagination token';if(!allowPartial)throw new Error('Inventory incomplete: '+warning);break;}
        if(pages>=200){complete=false;warning='pagination safety limit';if(!allowPartial)throw new Error('Inventory incomplete: '+warning);break;}
        seen.add(next);
        try{
          const moreDoc=V3.base.html(await post('inventory-more',{token:next}));pages++;
          const moreTable=moreDoc.querySelector('#table-inventory')||moreDoc.querySelector('table');
          const rows=moreTable?[...moreTable.querySelectorAll('tbody tr')].filter(r=>!expected||r.cells.length>=expected):[];
          if(!rows.length&&token(moreDoc)){complete=false;warning='pagination returned no usable rows';if(!allowPartial)throw new Error('Inventory incomplete: '+warning);break;}
          for(const row of rows)tbody.appendChild(doc.importNode(row,true));
          next=token(moreDoc);
        }catch(error){complete=false;warning=String(error.message||error);if(!allowPartial)throw new Error('Inventory incomplete: '+warning);break;}
      }
      const rows=parseInventory(doc),partialQuantity=rows.reduce((sum,row)=>sum+(Number(row.qty)||0),0);
      telemetry?.emit('fcr.inventory',{search:V3.telemetry.mask(code),pages,rows:rows.length,complete,ms:Math.round(performance.now()-started)});
      return{rows,pages,complete,warning,totalQuantity:complete?partialQuantity:null,partialQuantity};
    };
    return Object.freeze({post,product,inventory});
  }
  return Object.freeze({create,warehouse,base,parseProduct,parseInventory});
})();

// ---- src/components/river-capture.js ----
V3.riverCapture=(()=>{
  const WORKFLOW_Q0='3654ec14-7232-4f65-84c3-87927cdb4d0c';
  const WORKFLOW_ID='0dbb253e-c43a-4a8b-a316-e32b8ab9be21';
  const norm=value=>V3.base.lower(value).replace(/[^a-z0-9]+/g,' ').trim();
  const code=value=>V3.base.upper(value).replace(/[^A-Z0-9]/g,'');

  const headers=table=>{
    const wrapper=table?.closest('.dataTables_wrapper,.dataTables_scroll')||table?.parentElement;
    const head=wrapper?.querySelector('.dataTables_scrollHead table')||table;
    return[...head?.querySelectorAll('thead th,thead td')||[]].map(cell=>norm(cell.textContent));
  };
  const column=(list,...names)=>list.findIndex(header=>names.some(name=>header===norm(name)||header.startsWith(norm(name)+' ')));
  const number=value=>{
    const text=V3.base.clean(value).replace(/,/g,'');
    if(!/^-?\d+(?:\.\d+)?$/.test(text))return null;
    const n=Number(text);return Number.isFinite(n)&&n>=0?n:null;
  };
  const date=value=>{const parsed=Date.parse(V3.base.clean(value));return Number.isFinite(parsed)?parsed:Number.NEGATIVE_INFINITY;};
  const vendor=value=>{
    const tokens=(V3.base.clean(value).match(/[A-Z0-9]+/gi)||[]).map(x=>x.toUpperCase());
    return tokens.find(x=>x.length>=2&&x.length<=6&&x!=='FBA')||'';
  };

  const poDetails=doc=>{
    const table=doc.querySelector('#table-purchase-order'),map=new Map();
    if(!table)return map;
    const hs=headers(table),poIndex=column(hs,'purchase order','po'),dateIndex=column(hs,'placed','confirmed','order date','date');
    if(poIndex<0)return map;
    [...table.querySelectorAll('tbody tr')].forEach((row,rowIndex)=>{
      const cells=[...row.children].filter(cell=>cell.matches?.('td,th'));
      const purchaseOrder=V3.base.clean(cells[poIndex]?.textContent);if(!purchaseOrder)return;
      const timestamp=dateIndex>=0?date(cells[dateIndex]?.textContent):Number.NEGATIVE_INFINITY;
      const old=map.get(code(purchaseOrder));
      if(!old||timestamp>old.timestamp)map.set(code(purchaseOrder),{purchaseOrder,timestamp,rowIndex});
    });
    return map;
  };

  const poRows=doc=>{
    const table=doc.querySelector('#table-purchase-order-item');if(!table)return[];
    const hs=headers(table),idx={
      po:column(hs,'purchase order','po'),
      sku:column(hs,'sku','fnsku','asin'),
      vendor:column(hs,'vendor code','seller id'),
      unfilled:column(hs,'unfilled'),
      cancelled:column(hs,'canceled','cancelled'),
      received:column(hs,'received'),
      title:column(hs,'title'),
      date:column(hs,'order date','placed','date')
    };
    if(idx.po<0||idx.sku<0)return[];
    return[...table.querySelectorAll('tbody tr')].map((row,rowIndex)=>{
      const cells=[...row.children].filter(cell=>cell.matches?.('td,th'));
      const purchaseOrder=V3.base.clean(cells[idx.po]?.textContent);if(!purchaseOrder)return null;
      return{
        purchaseOrder,
        sku:V3.base.clean(cells[idx.sku]?.textContent),
        vendorRaw:idx.vendor>=0?V3.base.clean(cells[idx.vendor]?.textContent):'',
        unfilled:idx.unfilled>=0?number(cells[idx.unfilled]?.textContent):null,
        cancelled:idx.cancelled>=0?number(cells[idx.cancelled]?.textContent):null,
        received:idx.received>=0?number(cells[idx.received]?.textContent):null,
        title:idx.title>=0?V3.base.clean(cells[idx.title]?.textContent):'',
        timestamp:idx.date>=0?date(cells[idx.date]?.textContent):Number.NEGATIVE_INFINITY,
        rowIndex,
        rowText:V3.base.clean(row.textContent)
      };
    }).filter(Boolean);
  };

  const selectPo=(itemDoc,detailDoc,identity)=>{
    const rows=poRows(itemDoc),details=poDetails(detailDoc);
    const wanted=[identity.search,identity.asin,identity.fnsku].map(code).filter(Boolean),candidates=[];
    for(const row of rows){
      const sku=code(row.sku),rowText=code(row.rowText);let strength=0,matchBy='';
      if(sku&&wanted.includes(sku)){strength=3;matchBy=sku===code(identity.fnsku)?'fnsku':sku===code(identity.asin)?'asin':'search';}
      else{
        const embedded=wanted.find(value=>value.length>=8&&rowText.includes(value));
        if(embedded){strength=2;matchBy=embedded===code(identity.fnsku)?'fnsku-row':embedded===code(identity.asin)?'asin-row':'search-row';}
        else if(identity.title&&row.title&&norm(identity.title)===norm(row.title)){strength=1;matchBy='title-exact';}
      }
      if(!strength)continue;
      const timestamp=Math.max(row.timestamp,details.get(code(row.purchaseOrder))?.timestamp??Number.NEGATIVE_INFINITY);
      candidates.push({...row,strength,matchBy,timestamp});
    }
    if(!candidates.length)return null;
    candidates.sort((a,b)=>b.timestamp-a.timestamp||b.strength-a.strength||a.rowIndex-b.rowIndex);
    const selected=candidates[0],parts=[selected.unfilled,selected.cancelled,selected.received];
    const known=parts.every(Number.isFinite),quantity=known?parts.reduce((sum,value)=>sum+value,0):null;
    return{
      purchaseOrder:selected.purchaseOrder,
      vendorCode:vendor(selected.vendorRaw)||'N/A',
      quantity:Number.isFinite(quantity)&&quantity>0?quantity:null,
      matchBy:selected.matchBy,
      candidateCount:candidates.length
    };
  };

  const riverUrl=warehouse=>{
    const url=new URL('https://river.amazon.com/'+encodeURIComponent(warehouse)+'/workflows');
    url.searchParams.set('buildingType','fc');
    url.searchParams.set('q0',WORKFLOW_Q0);
    url.searchParams.set('q1',WORKFLOW_ID);
    url.searchParams.set('id',WORKFLOW_ID);
    return url.href;
  };

  function create({life,telemetry,store}={}){
    const fcr=V3.fcr.create({telemetry,life});
    const panel=V3.ui.panel({id:'bwu2-v3-river-capture',title:'V3 · RIVER Capture',width:520,life});
    let mounted=false,payload=null;

    const open=()=>{mount();panel.open();};

    function mount(){
      if(mounted)return;mounted=true;
      const root=document.createElement('div');
      root.innerHTML='<section class="section"><label class="field">Current item<input data-code></label><div class="row"><button class="btn primary" data-cap>CAPTURE</button><button class="btn" data-open>OPEN RIVER</button></div><div class="note" data-msg style="margin-top:8px"></div><div data-data style="margin-top:8px"></div></section>';
      panel.set(root);
      const input=root.querySelector('[data-code]'),message=root.querySelector('[data-msg]'),dataBox=root.querySelector('[data-data]');
      input.value=V3.base.clean(new URLSearchParams(location.search).get('s'));

      const paint=()=>{
        dataBox.innerHTML=payload?'<div class="grid"><div class="note"><b>FNSKU</b><br>'+V3.base.esc(payload.fnsku)+'</div><div class="note"><b>PO</b><br>'+V3.base.esc(payload.purchaseOrder)+'</div><div class="note"><b>PO qty</b><br>'+(payload.poLineQuantity??'N/A')+'</div><div class="note"><b>Live qty</b><br>'+(payload.liveInventoryQuantity??'N/A')+'</div></div>':'';
      };

      root.querySelector('[data-cap]').onclick=async()=>{
        try{
          message.className='note warn';message.textContent='CAPTURING…';
          const search=V3.base.clean(input.value);if(!search)throw new Error('Search item required');
          const [product,inventory,itemHtml,poHtml]=await Promise.all([
            fcr.product(search),
            fcr.inventory(search,{allowPartial:false}),
            fcr.post('purchase-order-item',{s:search}),
            fcr.post('purchase-order',{s:search})
          ]);
          if(!product)throw new Error('Product unavailable');
          const po=selectPo(V3.base.html(itemHtml),V3.base.html(poHtml),{search,asin:product.asin,fnsku:product.fnsku,title:product.title});
          const warehouse=V3.fcr.warehouse()||'BWU2';
          payload={
            asin:product.asin||'N/A',
            fnsku:product.fnsku||'N/A',
            title:product.title||'N/A',
            purchaseOrder:po?.purchaseOrder||'N/A',
            vendorCode:po?.vendorCode||'N/A',
            poLineQuantity:po?.quantity??null,
            liveInventoryQuantity:inventory.totalQuantity,
            inventoryCost:product.inventoryCost||'N/A',
            physicalLocation:'TBD',
            warehouseId:warehouse,
            riverUrl:riverUrl(warehouse),
            capturedAt:Date.now()
          };
          payload.quantityDisagreement=Number.isFinite(payload.poLineQuantity)&&Number.isFinite(payload.liveInventoryQuantity)&&payload.poLineQuantity!==payload.liveInventoryQuantity;
          await store.set('payload',payload);
          telemetry?.emit('capture',{po:payload.poLineQuantity,live:payload.liveInventoryQuantity,disagreement:payload.quantityDisagreement,matchBy:po?.matchBy||''});
          message.className='note '+(payload.quantityDisagreement?'warn':'ok');
          message.textContent=payload.quantityDisagreement?'QTY DISAGREES':'READY';
          paint();
        }catch(error){message.className='note bad';message.textContent=error.message;}
      };

      root.querySelector('[data-open]').onclick=async()=>{
        payload=payload||await store.get('payload',null);
        if(!payload?.riverUrl)return;
        if(typeof GM_openInTab==='function')GM_openInTab(payload.riverUrl,{active:true,insert:true});
        else window.open(payload.riverUrl,'_blank','noopener');
      };
    }

    return Object.freeze({open});
  }

  return Object.freeze({create,selectPo,riverUrl});
})();

// ---- src/components/river-assistant.js ----
V3.riverAssistant=(()=>{
  const norm=value=>V3.base.lower(value).replace(/[^a-z0-9]+/g,' ').trim();

  function create({life,telemetry,store}={}){
    const panel=V3.ui.panel({id:'bwu2-v3-river-assistant',title:'V3 · RIVER Assistant',width:600,life});
    let watcher=null,severity=null;

    const visible=element=>{
      if(!element?.isConnected)return false;
      const rect=element.getBoundingClientRect(),style=getComputedStyle(element);
      return rect.width>0&&rect.height>0&&style.display!=='none'&&style.visibility!=='hidden';
    };
    const field=aliases=>{
      const wanted=aliases.map(norm);
      for(const element of document.querySelectorAll('input,textarea,select')){
        if(!visible(element))continue;
        const label=V3.base.clean(element.getAttribute('aria-label')||element.placeholder||element.name||element.id||element.closest('label')?.textContent||'');
        if(wanted.some(value=>norm(label).includes(value)))return element;
      }
      return null;
    };
    const setValue=async(element,value)=>{
      if(!element||!visible(element)||element.disabled||element.readOnly)return false;
      const next=String(value??'');let proto=element,setter=null;
      while((proto=Object.getPrototypeOf(proto))&&!setter)setter=Object.getOwnPropertyDescriptor(proto,'value')?.set||null;
      if(setter)setter.call(element,next);else element.value=next;
      element.dispatchEvent(new Event('input',{bubbles:true}));
      element.dispatchEvent(new Event('change',{bubbles:true}));
      await new Promise(resolve=>requestAnimationFrame(resolve));
      return V3.base.clean(element.value)===V3.base.clean(next);
    };
    const nextButton=()=>[...document.querySelectorAll('button,a,[role="button"],input[type="submit"],input[type="button"]')]
      .filter(visible).find(element=>norm(element.innerText||element.textContent||element.value||'')==='next');
    const label=()=>V3.base.clean(document.querySelector('page-info[label]')?.getAttribute('label')||[...document.querySelectorAll('h1,h2,h3,h4,[role="heading"],legend')].find(visible)?.textContent||'');
    const page=()=>{
      const text=norm(label()),route=(location.pathname+' '+location.search+' '+location.hash).toLowerCase();
      if(text.includes('information')||field(['physical location of the units','inventory cost per unit']))return'information';
      if(text.includes('severity')||field(['units impacted']))return'severity';
      if(text==='asin'||text.includes('enter asin')||field(['type asin here']))return'asin';
      if(text.includes('pandash')||/pandash|dangerous/.test(route))return'pandash';
      if(text.includes('sortab')||/sortab/.test(route))return'sortability';
      if(text.includes('related')||/related.?tt/.test(route))return'related';
      if(text.includes('image'))return'images';
      if(text.includes('create issue'))return'create';
      if(text.includes('issue')&&text.includes('fc'))return'issue';
      return'unknown';
    };
    const choose=payload=>{
      const po=Number(payload?.poLineQuantity),live=Number(payload?.liveInventoryQuantity);
      const poOk=Number.isFinite(po)&&po>0,liveOk=Number.isFinite(live)&&live>0;
      if(poOk&&liveOk&&po!==live)return{value:null,reason:'PO qty '+po+' ≠ live inventory '+live,po,live};
      if(poOk&&liveOk)return{value:po,reason:'PO/live agree'};
      if(liveOk)return{value:live,reason:'live inventory only'};
      if(poOk)return{value:po,reason:'PO only'};
      return{value:null,reason:'No positive quantity',po:poOk?po:null,live:liveOk?live:null};
    };

    const arm=previous=>{
      watcher?.disconnect();let timer=0;
      watcher=life.observe(document.body,()=>{
        clearTimeout(timer);
        timer=setTimeout(()=>{
          const current=page();
          if(current&&current!=='unknown'&&current!==previous){
            watcher?.disconnect();watcher=null;void run();
          }
        },150);
      },{childList:true,subtree:true,attributes:true,attributeFilter:['label','disabled','aria-label','data-step']});
    };

    async function render(message=''){
      const payload=await store.get('payload',null),root=document.createElement('div');
      let chooser='';
      if(severity){
        chooser='<section class="section"><b>Units impacted</b><div class="note warn" style="margin-top:5px">'+V3.base.esc(severity.reason)+'</div><div class="grid" style="margin-top:8px">'+
          (severity.po!=null?'<button class="btn" data-po><b style="font-size:20px">'+severity.po+'</b><br>PO LINE</button>':'')+
          (severity.live!=null?'<button class="btn" data-live><b style="font-size:20px">'+severity.live+'</b><br>LIVE INVENTORY</button>':'')+
          '</div><div class="row" style="margin-top:8px"><input class="input" type="number" min="0" data-manual placeholder="Manual qty"><button class="btn" data-apply>APPLY MANUAL</button></div>'+
          (severity.selected!=null?'<div class="note ok" style="margin-top:8px"><b>FILLED: '+severity.selected+' · '+V3.base.esc(severity.source)+'</b><br>Review RIVER, then click Next.</div>':'')+
          '</section>';
      }
      root.innerHTML='<section class="section"><b>RIVER Assistant</b><div class="note" style="margin-top:5px">Item: '+V3.base.esc(payload?.fnsku||payload?.asin||'NO CAPTURE')+'</div><div class="note" style="margin-top:5px">'+V3.base.esc(message||('Current: '+(label()||page())))+'</div><div class="row" style="margin-top:8px"><button class="btn primary" data-run>RUN</button><button class="btn danger" data-clear>CLEAR</button></div></section>'+chooser;
      panel.set(root);

      root.querySelector('[data-run]').onclick=run;
      root.querySelector('[data-clear]').onclick=async()=>{severity=null;watcher?.disconnect();watcher=null;await store.set('payload',null);render('CLEARED');};

      const apply=async(value,source)=>{
        const qty=Number(value),units=field(['units impacted','number of units impacted']),shipments=field(['shipments impacted','number of shipments impacted']);
        if(!Number.isInteger(qty)||qty<0)return render('Enter whole quantity 0+');
        if(!await setValue(units,qty)||!await setValue(shipments,0))return render('RIVER did not retain quantity');
        severity={...severity,selected:qty,source};
        telemetry?.emit('severity.choice',{value:qty,source});
        await render('Units impacted = '+qty+' ('+source+'). Review RIVER, then click Next.');
        arm('severity');
      };

      root.querySelector('[data-po]')?.addEventListener('click',()=>apply(severity.po,'PO'));
      root.querySelector('[data-live]')?.addEventListener('click',()=>apply(severity.live,'LIVE'));
      root.querySelector('[data-apply]')?.addEventListener('click',()=>apply(root.querySelector('[data-manual]').value,'MANUAL'));
      root.querySelector('[data-manual]')?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void apply(event.currentTarget.value,'MANUAL');}});
    }

    async function run(){
      const payload=await store.get('payload',null);if(!payload)return render('No FCR capture');
      const current=page();telemetry?.emit('step',{page:current,label:label()});

      if(['pandash','sortability','related','images','issue','create','unknown'].includes(current)){
        return render(current.toUpperCase()+' stays manual — complete it then RUN/Next');
      }
      if(current==='asin'){
        const input=field(['type asin here','asin']);
        if(!await setValue(input,payload.asin))return render('ASIN field not ready');
        nextButton()?.click();arm('asin');return;
      }
      if(current==='information'){
        const pairs=[
          [['x0 asin','fnsku','asin/fnsku'],payload.fnsku],
          [['purchase order','po'],payload.purchaseOrder],
          [['vendor code / seller id','vendor code','seller id'],payload.vendorCode],
          [['inventory cost per unit','inventory cost'],payload.inventoryCost],
          [['physical location of the units','physical location'],payload.physicalLocation],
          [['asin title','product title','title'],payload.title]
        ];
        for(const [aliases,value] of pairs){
          const input=field(aliases);
          if(!input||!await setValue(input,value||'N/A'))return render('Information field not ready: '+aliases[0]);
        }
        const next=nextButton();
        if(!next)return render('Information filled — review and click Next');
        next.click();arm('information');return;
      }
      if(current==='severity'){
        const choice=choose(payload),shipments=field(['shipments impacted','number of shipments impacted']);
        if(!choice.value){
          if(shipments)await setValue(shipments,0);
          severity={...choice,selected:null,source:''};
          return render('Choose Units impacted');
        }
        severity=null;
        const units=field(['units impacted','number of units impacted']);
        if(!await setValue(units,choice.value)||!await setValue(shipments,0))return render('Severity fields not ready');
        const next=nextButton();
        if(next){next.click();arm('severity');}
        else render('Severity filled — review and click Next');
      }
    }

    const open=()=>{void render().then(()=>panel.open());};
    return Object.freeze({open,run});
  }

  return Object.freeze({create});
})();

// ---- src/apps/river/index.js ----
V3.boot=()=>{
  const life=V3.lifecycle.create('river');
  const telemetry=V3.telemetry.create('river',V3.build.version);
  const store=V3.storage.create('river',1);

  if(location.hostname==='river.amazon.com'){
    const assistant=V3.riverAssistant.create({life,telemetry,store});
    V3.ui.dockButton({id:'river',label:'RIVER',title:'V3 RIVER Assistant',onClick:assistant.open});
    return;
  }

  const capture=V3.riverCapture.create({life,telemetry,store});
  V3.ui.dockButton({id:'river',label:'RIVER',title:'RIVER capture',onClick:capture.open});
};

if(typeof V3.boot!=='function')throw new Error('V3 boot missing');
V3.boot();
})();
