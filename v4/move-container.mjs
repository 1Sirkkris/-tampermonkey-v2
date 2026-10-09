import{clean,upper}from'./ui-tools.mjs';import{NativeRequestError}from'./native-json.mjs';
export const MOVE_CONTAINER_URL='https://aft-moveapp-nrt-nrt.nrt.proxy.amazon.com/api/move-container';
export const DROPZONES=Object.freeze({upper:[['Cubiscan','dz-Pcubiscan-{floor}'],['Prep','dz-P-Prep-{floor}'],['ISS','dz-P-ISS-{floor}'],['Damages','dz-P-Damages-{floor}'],['Hazmat','dz-P-Hazmat-{floor}'],['Nonsort','dz-Pnonsort-{floor}']],p1:[['Hazmat','dz-P-HAZMAT_OUT'],['Ticketland','dz-P-Ticketland'],['Consolidation','dz-P-issconsol'],['ISS WIP','dz-S-ISSWIP1'],['Nonsort','dz-P-IB-nonsort'],['Shipdock','dz-P-ISS-Shipdock'],['OB IOL','dz-P-OBIOL'],['Damageland','dz-Pdamageland'],['Receive Damages','dz-P-rcv-Damages']]});
export function dropzone(floor,type){if(type==='PRIME')return'dz-P-PRIME';if(!['P1','P2','P3','P4'].includes(floor))return'';const row=(floor==='P1'?DROPZONES.p1:DROPZONES.upper).find(row=>row[0]===type);return row?row[1].replace('{floor}',floor):'';}
export function validateLocation(result,container,destination=null){
 if(!result?.complete||!Array.isArray(result.rows)||!result.rows.length||result.rows.some(row=>upper(row.container)!==upper(container)||!clean(row.outerLocation)))throw new NativeRequestError('Complete exact container location unavailable',{outcome:destination?'UNKNOWN':'REJECTED'});
 if(destination&&result.rows.some(row=>upper(row.outerLocation)!==upper(destination)))throw new NativeRequestError('Requested destination not confirmed by native location readback',{outcome:'UNKNOWN'});
 return result;
}
export function createMoveContainer({window,fetch,reader,identity,onEvidence=()=>{}}){
 return async(row,{signal,beforeMutation,checkRunning,onPhase=()=>{}})=>{
  const container=clean(row.container),destination=clean(row.destination);if(!/^(?:tsX|csX)[A-Z0-9_-]+$/i.test(container)||!/^dz-[A-Za-z0-9_-]+$/.test(destination))throw new NativeRequestError('Invalid exact container/destination');
  identity();onPhase('location-preflight');validateLocation(await reader.inventory(container,{signal}),container);checkRunning();identity();beforeMutation();onPhase('move');
  let response;try{response=await fetch(MOVE_CONTAINER_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceScannableId:null,destinationScannableId:destination,containerScannableId:container,confirmed:'true'}),signal});}catch{throw new NativeRequestError('Move submission outcome unknown',{outcome:'UNKNOWN'});}
  const raw=await response.text();const content=response.headers.get('content-type')||'';
  if(!response.ok||response.redirected||/html/i.test(content)||/^\s*</.test(raw))throw new NativeRequestError('Move response does not prove a native outcome',{outcome:'UNKNOWN',status:response.status});
  let data;try{data=raw?JSON.parse(raw):null;}catch{data=null;}
  if(data&&(data.success===false||data.error||data.errorMessage))throw new NativeRequestError('Move explicitly rejected',{outcome:'REJECTED',status:response.status});
  if(data&&/^(?:pending|submitted|queued|processing)$/i.test(String(data.status||data.state||'')))throw new NativeRequestError('Move remains pending — verify before retry',{outcome:'UNKNOWN'});
  onPhase('location-verification');let verified;try{verified=validateLocation(await reader.inventory(container,{signal}),container,destination);}catch(error){throw new NativeRequestError(error.message,{outcome:'UNKNOWN'});}
  onEvidence({type:'move.location',intent:'read',data:{outcome:'exact-destination',rows:verified.rows.length}});return{status:response.status,verifiedBy:'native-inventory-outerLocation'};
 };
}
