// Fetch-shaped cancellable GM transport for explicitly declared native origins.
export function createGmFetch(window,request){
 return(url,init={})=>new Promise((resolve,reject)=>{
  let handle,settled=false;const signal=init.signal;
  function finish(error,value){if(settled)return;settled=true;signal?.removeEventListener('abort',cancel);error?reject(error):resolve(value);}
  function cancel(){finish(new Error('Native request cancelled'));handle?.abort();}
  if(signal?.aborted){cancel();return;}signal?.addEventListener('abort',cancel,{once:true});
  try{handle=request({method:init.method||'GET',url:String(url),headers:init.headers||{},data:init.body,timeout:25000,anonymous:false,onload:response=>{
    if(typeof response.responseText!=='string'||response.responseText.length>8000000){finish(new Error('Native response invalid/oversized'));return;}
    const headers=new Map();for(const line of String(response.responseHeaders||'').split(/\r?\n/)){const index=line.indexOf(':');if(index>0)headers.set(line.slice(0,index).trim().toLowerCase(),line.slice(index+1).trim());}
    const final=response.finalUrl||String(url);let redirected;try{redirected=new window.URL(final).href!==new window.URL(url).href;}catch{finish(new Error('Native redirect URL invalid'));return;}
    finish(null,{status:response.status,ok:response.status>=200&&response.status<300,url:final,redirected,headers:{get:name=>headers.get(name.toLowerCase())||null},text:async()=>response.responseText});
  },onerror:()=>finish(new Error('Native network error')),ontimeout:()=>finish(new Error('Native request timed out')),onabort:()=>finish(new Error('Native request cancelled'))});}catch{finish(new Error('Native transport unavailable'));}
 });
}
