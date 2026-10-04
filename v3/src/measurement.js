V3.measurement = (() => {
  const C=V3.core,SITE='https://jp.item-measurement.aft.a2z.com',API='o0avbo02yl.execute-api.ap-northeast-1.amazonaws.com',WINDOW=30*86400000;
  const route=value=>{try{const url=new URL(value,location.href),match=url.pathname.match(/^\/prod\/measurementEvents\/([^/]+)\/(FNSKU|ASIN)$/i);return url.hostname===API&&match?{url,identifier:C.upper(decodeURIComponent(match[1])),type:C.upper(match[2])}:null;}catch{return null;}};
  const classify=(payload,request,now=Date.now())=>{
    if(!Array.isArray(payload?.measurementEvents))throw new Error('Measurement history response missing events');
    const events=payload.measurementEvents,yes=events.some(event=>C.upper(event.measurementSource)==='MADCAT'&&Date.parse(event.measurementInstant)>=now-WINDOW&&Date.parse(event.measurementInstant)<=now);
    const after=Date.parse(request.url.searchParams.get('effectiveAfter')),before=Date.parse(request.url.searchParams.get('effectiveBefore'));
    const complete=!C.clean(payload.nextToken)&&!request.url.searchParams.get('nextToken')&&after<=now-WINDOW&&before>=now-60000;
    return {identifier:request.identifier,madcat:yes?true:complete?false:null,source:'raw',at:now};
  };
  function native({life}={}){
    const page=typeof unsafeWindow==='object'?unsafeWindow:window,store=C.store('measurement',1),cache=new Map();
    const accept=async(url,payload,status)=>{const request=route(url);if(!request||status<200||status>=300)return;try{const value=classify(payload,request);cache.set(value.identifier,value);await store.set(value.identifier,value);window.dispatchEvent(new Event('bwu2-v3:measurement'));}catch(error){C.telemetry('measurement',V3.build.version).emit('read.error',{message:error.message});}};
    // Observe only the native measurement response. Never inspect request headers, cookies or auth tokens.
    const original=page.fetch;if(typeof original==='function'){const wrapped=async function(input,options){const url=typeof input==='string'?input:input?.url||String(input);const response=await original.apply(this,arguments);if(route(url))void response.clone().json().then(payload=>accept(url,payload,response.status)).catch(()=>{});return response;};page.fetch=wrapped;life.own(()=>{if(page.fetch===wrapped)page.fetch=original;});}
    const prototype=page.XMLHttpRequest?.prototype;if(prototype){const open=prototype.open,send=prototype.send,requests=new WeakMap();const wrappedOpen=function(method,url){requests.set(this,route(url)?String(url):'');return open.apply(this,arguments);};const wrappedSend=function(){const url=requests.get(this);if(url)this.addEventListener('load',()=>{try{const payload=this.responseType==='json'?this.response:JSON.parse(this.responseText);void accept(url,payload,this.status);}catch{}},{once:true});return send.apply(this,arguments);};prototype.open=wrappedOpen;prototype.send=wrappedSend;life.own(()=>{if(prototype.open===wrappedOpen)prototype.open=open;if(prototype.send===wrappedSend)prototype.send=send;});}
    V3.bridge.server({family:'measurement',life,allowed:V3.bridge.isFCR,commands:{lookup:async({identifier})=>{
      const code=C.upper(identifier);return V3.native.waitFor(()=>cache.get(code)||false,{life,target:document.documentElement,events:['bwu2-v3:measurement'],timeout:12000});
    }}});
  }
  function create({life}={}) {
    const store=C.store('measurement',1),clients=new Map();
    const lookup=async(identifier,force=false)=>{const code=C.upper(identifier);if(!/^[A-Z0-9]{10}$/.test(code))throw new Error('Exact measurement identifier required');const saved=await store.get(code,null);if(!force&&saved&&Date.now()-saved.at<300000&&saved.madcat!=null)return saved;
      let client=clients.get(code);if(!client){client=V3.bridge.client({origin:SITE,path:'/item/'+encodeURIComponent(code),family:'measurement',life});clients.set(code,client);}const value=await client.run('lookup',{identifier:code});if(value.madcat==null)throw new Error('Native measurement history incomplete — open Measurement and review');return value;};
    return Object.freeze({lookup,open:identifier=>{const url=SITE+'/item/'+encodeURIComponent(identifier);if(typeof GM_openInTab==='function')GM_openInTab(url,{active:true,insert:true});else window.open(url,'_blank','noopener');}});
  }
  return Object.freeze({SITE,route,classify,native,create});
})();
