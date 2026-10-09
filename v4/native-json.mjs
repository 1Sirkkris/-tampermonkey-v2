export class NativeRequestError extends Error {constructor(message,{outcome='REJECTED',status=0}={}){super(message);this.outcome=outcome;this.status=status;}}
export function createNativeJson({window,fetch=window.fetch.bind(window),timeoutMs=25000,onEvidence=()=>{}}){
 return async(path,body,{signal,mutation=false}={})=>{
  const url=new window.URL(path,window.location.href);if(url.origin!==window.location.origin)throw new NativeRequestError('Native request origin mismatch');
  if(signal?.aborted)throw new NativeRequestError('Preflight cancelled');
  const controller=new window.AbortController();let timeout=false;const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});
  const timer=window.setTimeout(()=>{timeout=true;controller.abort();},timeoutMs);
  try{
   const response=await fetch(url.href,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
   const raw=await response.text();let data;try{data=JSON.parse(raw);}catch{data=null;}
   const redirect=response.redirected||(response.url&&new window.URL(response.url).pathname!==url.pathname);
   if(redirect||/text\/html/i.test(response.headers.get('content-type')||'')||/^[\s]*</.test(raw)||[401,403,419].includes(response.status))throw new NativeRequestError('Native session/authentication response',{outcome:mutation?'UNKNOWN':'REJECTED',status:response.status});
   if(!response.ok)throw new NativeRequestError('Native HTTP '+response.status,{outcome:mutation?'UNKNOWN':'REJECTED',status:response.status});
   if(data===null||raw.length>8000000)throw new NativeRequestError('Native JSON response invalid',{outcome:mutation?'UNKNOWN':'REJECTED',status:response.status});
   if(typeof data==='object'&&(data.success===false||data.error||data.errorMessage||data.exception))throw new NativeRequestError('Native operation explicitly rejected',{outcome:'REJECTED',status:response.status});
   onEvidence({type:'native.response',intent:mutation?'mutation':'read',data:{endpoint:url.pathname,status:response.status}});return{data,status:response.status};
  }catch(error){if(error instanceof NativeRequestError)throw error;throw new NativeRequestError(timeout?'Native request timed out':controller.signal.aborted?'Native request cancelled':'Native request failed',{outcome:mutation?'UNKNOWN':'REJECTED'});}
  finally{window.clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
 };
}
