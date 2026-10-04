// ==UserScript==
// @name         V3 | BWU2 OBS + Screenshot
// @name:en      V3 | BWU2 OBS + Screenshot
// @namespace    https://github.com/1Sirkkris/-tampermonkey-v2/v3-relaunch
// @version      0.1.0
// @description  Fleet telemetry collector and Ctrl+Q screenshot mode.
// @include      /^https?:\/\/aft-poirot-website-nrt\.nrt\.proxy\.amazon\.com\//
// @include      *://aft-qt-*.corp.amazon.com/*
// @include      /^https?:\/\/(?:[^\/]*fcresearch[^\/]*|qifcr\.fe\.aftx\.amazonoperations\.app)\//
// @include      /^https?:\/\/aft-moveapp-[^\/]+(?:\.nrt)?\.proxy\.amazon\.com\//
// @include      /^https?:\/\/fba-fnsku-commingling-console-(?:eu|na|jp)\.aka\.amazon\.com\//
// @include      /^https?:\/\/river\.amazon\.com\//
// @include      /^https?:\/\/console\.harmony\.a2z\.com\/poportal\//
// @include      /^https?:\/\/tx-b-hierarchy-nrt\.nrt\.proxy\.amazon\.com\//
// @include      /^https?:\/\/aftcartonpreditorapp-tcp-nrt\.nrt\.proxy\.amazon\.com\//
// @include      /^https?:\/\/fcmenu-(?:iad|nrt)-regionalized\.corp\.amazon\.com\//
// @include      https://t.corp.amazon.com/*
// @run-at       document-start
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-relaunch/v3/dist/V3_OBS_Screenshot.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-relaunch/v3/dist/V3_OBS_Screenshot.user.js
// @v3-build     obs-0.1.0-cf15bf95
// ==/UserScript==

(()=>{
'use strict';
const V3=Object.create(null);
V3.build=Object.freeze({"id":"obs-0.1.0-cf15bf95","version":"0.1.0","suite":"obs"});

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

// ---- src/apps/obs/index.js ----
V3.boot=()=>{
  const life=V3.lifecycle.create('obs'),store=V3.storage.create('obs',1),MAX=1200;let events=[],timer=0,hidden=false;
  const load=async()=>{const pending=events.slice(),saved=await store.get('events',[]);events=Array.isArray(saved)?saved:[];events.push(...pending);if(events.length>MAX)events.splice(0,events.length-MAX);};
  const flush=async()=>{timer=0;if(events.length>MAX)events.splice(0,events.length-MAX);await store.set('events',events);};
  const schedule=()=>{if(timer)return;timer=setTimeout(flush,750);};
  life.on(window,V3.telemetry.EVENT,event=>{try{const data=JSON.parse(String(event.detail||''));if(!data?.t||!data?.app)return;events.push(data);schedule();}catch{}});
  const toggle=()=>{hidden=!hidden;let style=document.getElementById('bwu2-v3-screenshot-style');if(hidden&&!style){style=document.createElement('style');style.id='bwu2-v3-screenshot-style';style.textContent='[data-bwu2-v3-ui]{display:none!important}';document.documentElement.appendChild(style);}if(!hidden)style?.remove();};
  life.on(document,'keydown',event=>{if(event.ctrlKey&&!event.shiftKey&&!event.altKey&&!event.metaKey&&String(event.key).toLowerCase()==='q'){event.preventDefault();toggle();}},true);
  const exportObs=async()=>{await flush();const blob=new Blob([JSON.stringify({format:'BWU2-V3-OBS',exportedAt:new Date().toISOString(),events},null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='BWU2_V3_OBS_'+Date.now()+'.json';a.click();URL.revokeObjectURL(a.href);};
  if(typeof GM_registerMenuCommand==='function'){GM_registerMenuCommand('Export V3 OBS',exportObs);GM_registerMenuCommand('Clear V3 OBS',async()=>{events=[];await flush();});GM_registerMenuCommand('Toggle V3 Screenshot Mode',toggle);}
  life.on(window,'pagehide',()=>{void flush();},{once:true});void load();
};

if(typeof V3.boot!=='function')throw new Error('V3 boot missing');
V3.boot();
})();
