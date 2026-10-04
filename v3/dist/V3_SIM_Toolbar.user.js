// ==UserScript==
// @name         V3 | BWU2 SIM Toolbar
// @name:en      V3 | BWU2 SIM Toolbar
// @namespace    https://github.com/1Sirkkris/-tampermonkey-v2/v3-relaunch
// @version      0.1.0
// @description  Native SIM Markdown toolbar and snippets.
// @match        https://t.corp.amazon.com/*
// @run-at       document-body
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-relaunch/v3/dist/V3_SIM_Toolbar.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-relaunch/v3/dist/V3_SIM_Toolbar.user.js
// @v3-build     sim-0.1.0-c0bbee5b
// ==/UserScript==

(()=>{
'use strict';
const V3=Object.create(null);
V3.build=Object.freeze({"id":"sim-0.1.0-c0bbee5b","version":"0.1.0","suite":"sim"});

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

// ---- src/apps/sim/index.js ----
V3.boot=()=>{
  const life=V3.lifecycle.create('sim'),telemetry=V3.telemetry.create('sim',V3.build.version),store=V3.storage.create('sim',1),panel=V3.ui.panel({id:'bwu2-v3-sim',title:'V3 · SIM Toolbar',width:620,life});let mounted=false,snippets=[];
  const editor=()=>['textarea[placeholder*="markdown" i]','textarea','[contenteditable="true"][role="textbox"]','[contenteditable="true"]'].map(s=>document.querySelector(s)).find(x=>x&&x.offsetParent!==null)||null;
  const insert=(before,after='',prefix='')=>{const el=editor();if(!el)return;if('selectionStart'in el){const s=el.selectionStart??el.value.length,e=el.selectionEnd??s,selected=el.value.slice(s,e),body=prefix?selected.split(/\r?\n/).map(x=>prefix+x).join('\n'):before+selected+after;el.setRangeText(body,s,e,'end');el.dispatchEvent(new Event('input',{bubbles:true}));el.focus();}else{el.focus();document.execCommand('insertText',false,before);}};
  const mount=async()=>{if(mounted)return;mounted=true;snippets=await store.get('snippets',[]);if(!Array.isArray(snippets))snippets=[];const root=document.createElement('div');root.innerHTML='<section class="section"><div class="row"><button class="btn" data-wrap="**|**">B</button><button class="btn" data-wrap="_|_">I</button><button class="btn" data-wrap="`|`">CODE</button><button class="btn" data-prefix="> ">QUOTE</button><button class="btn" data-prefix="- ">LIST</button><button class="btn" data-table>TABLE</button><button class="btn" data-save>+ SNIP</button></div></section><section class="section"><b>Snippets</b><div class="row" data-snips style="margin-top:8px"></div></section>';panel.set(root);const paint=()=>{const box=root.querySelector('[data-snips]');box.innerHTML='';snippets.forEach((s,i)=>{const b=document.createElement('button');b.className='btn';b.textContent=s.name||('Snippet '+(i+1));b.onclick=()=>insert(s.text||'');box.appendChild(b);});};for(const b of root.querySelectorAll('[data-wrap]'))b.onclick=()=>{const [a,z]=b.dataset.wrap.split('|');insert(a,z);};for(const b of root.querySelectorAll('[data-prefix]'))b.onclick=()=>insert('','',b.dataset.prefix);root.querySelector('[data-table]').onclick=()=>insert('| Header | Header |\n| --- | --- |\n|  |  |');root.querySelector('[data-save]').onclick=async()=>{const el=editor(),selected=el&&'selectionStart'in el?String(el.value||'').slice(el.selectionStart,el.selectionEnd):'';const text=selected||prompt('Snippet text?')||'';if(!text)return;const name=prompt('Snippet name?','Snippet '+(snippets.length+1))||'Snippet';snippets.push({name,text});await store.set('snippets',snippets);paint();};paint();};
  V3.ui.dockButton({id:'sim',label:'SIM',title:'V3 SIM Toolbar',onClick:()=>{void mount().then(()=>panel.open());}});
};

if(typeof V3.boot!=='function')throw new Error('V3 boot missing');
V3.boot();
})();
