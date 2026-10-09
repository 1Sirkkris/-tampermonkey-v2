import{clean,upper}from'./ui-tools.mjs';import{NativeRequestError}from'./native-json.mjs';
export const SIDELINE_TOOL='V3'; // Native Poirot protocol enum used by the proven V2 client.
export function sidelineRequestId(uuid){return'amzn1.fc.v1.common.request-id.v1.AFTPoirotWebsite.'+uuid();}
const labels=data=>[data?.['@type'],data?.message,data?.description,data?.errorMessage,data?.errorCode,data?.filterResult?.filterType,...Object.values(data?.filterResult?.reason||{}),...(Array.isArray(data?.problems)?data.problems.filter(Boolean).map(p=>typeof p==='string'?p:p.description||p.message||p.code||p['@type']):[])].filter(v=>typeof v==='string').map(clean);
export function hasPredicant(data){if(data===null||data===undefined)return false;if(typeof data==='string')return/predicant/i.test(data);if(typeof data!=='object')return false;return Object.entries(data).some(([k,v])=>/predicant/i.test(k)&&v!==false&&v!==null&&v!==''&&v!=='false'||hasPredicant(v));}
export function customerBound(data){return/customer\s*bound\s*shipment/i.test(JSON.stringify(data||{}));}
function allowedOverage(data){const list=labels(data),type=clean(data?.['@type']);if(/InvalidBarcode|RequestMultipleBarcodes/.test(type)||hasPredicant(data))return false;const overage=/\boverage\b|item\s+not\s+in\s+(?:source\s+)?container/i;const diagnostics=list.filter(v=>v!==type);return(type==='ItemNotInContainerResponse'||list.some(v=>overage.test(v)))&&diagnostics.every(v=>overage.test(v)||/^(?:bad request|conflict|http [45]\d\d|[45]\d\d)$/i.test(v))&&!(data?.filterResult?.compatible===false&&!overage.test(JSON.stringify(data.filterResult.reason||{})));}
export function resolveSidelineItem(data,barcode){
 const type=clean(data?.['@type']),text=labels(data).join(' '),red=reason=>({kind:'red',reason,ctx:null});
 if(customerBound(data))return red('CUSTOMER-BOUND SHIPMENT');if(/InvalidBarcode/.test(type))return red('INVALID BARCODE');if(/RequestMultipleBarcodes/.test(type))return red('MULTIPLE BARCODE MATCHES');
 if(/damaged/i.test(text))return red('DAMAGED / INCOMPATIBLE');
 const overage=allowedOverage(data);if(data?.success!==true&&!overage)return red(text||'NO POSITIVE ITEM DETAILS');
 if(data?.filterResult?.compatible===false&&!overage)return red(text||'INCOMPATIBLE');
 const records=Array.isArray(data?.items)?data.items:[];
 if(!records.length||records.some(r=>!r?.skuDetail||!clean(r.skuDetail.asin)||!clean(r.skuDetail.fnSku)||!clean(r.skuDetail.fcSku)||!Number.isFinite(Number(r.quantity))||Number(r.quantity)<0))return red('ITEM DETAILS INCOMPLETE');
 const keys=new Set(records.map(r=>upper(r.skuDetail.asin)+'|'+upper(r.skuDetail.fnSku)));if(keys.size!==1)return red('MULTIPLE DISTINCT ITEM IDENTITIES');
 const sku=records[0].skuDetail;if(clean(sku.itemDropzoneRecommendation?.permissionLevel).toUpperCase()==='UNDER_REVIEW')return red('ASIN UNDER REVIEW — RIVER REQUIRED');
 if(/hazmat|dangerous.?goods/i.test(text)&&(data.success===false||data.filterResult?.compatible===false||(data.problems||[]).filter(Boolean).length))return red('HAZMAT / DANGEROUS GOODS');
 const dateType=clean(sku.datelotDetail?.expirationPromptType);if(dateType&&!['EXPIRATION_DATE','PRODUCTION_DATE','NONE','NO_PROMPT'].includes(dateType))return red('UNKNOWN DATE REQUIREMENT');
 const ctx={barcode,records,sku,item:records[0],asin:clean(sku.asin),fnsku:clean(sku.fnSku),fcsku:clean(sku.fcSku),dateType,dateDetail:sku.datelotDetail||{},hazmat:sku.hazmat===true,overage};
 return{kind:['EXPIRATION_DATE','PRODUCTION_DATE'].includes(dateType)?'yellow':'green',reason:dateType==='PRODUCTION_DATE'?'PRODUCTION DATE':dateType==='EXPIRATION_DATE'?'EXPIRY DATE':'GOOD TO GO',ctx};
}
export function sidelineMovePayload({source,destination,sourceMeta,ctx,quantity,expiration=null,uuid}){
 return{itemExternalId:null,sourceContainerScannableId:source,destinationContainerScannableId:destination,scannableId:clean(ctx.item.scannableId||ctx.barcode),quantity:String(quantity),itemDetails:ctx.records.map(r=>({fcsku:clean(r.skuDetail.fcSku),quantity:Number(r.quantity),consumerType:r.consumer??null,disposition:r.disposition??null,referenceId:r.referenceId??null,fnsku:clean(r.skuDetail.fnSku)})),foundProblems:[null,null,null],scannedSourceContainerAsDestination:false,datelotDetail:ctx.sku.datelotDetail||null,userEnteredExpirationDate:expiration,mlcCaptureDetail:{mlcClass:ctx.sku.mlcDetail?.mlcClass??'UNKNOWN',userEnteredLotCode:null,mlcMissing:ctx.sku.mlcDetail?.mlcMissing??false,mlcNotEnteredReason:null,mlcCaptureMethod:null},itemMovedToISS:false,candidatePurchaseOrders:[],packHierarchyDetail:null,itemAndonContext:null,processPath:sourceMeta?.processPath??'UNDETERMINED',requestId:sidelineRequestId(uuid),tool:SIDELINE_TOOL};
}
export function classifySidelineMutation(data,kind){
 const expected=kind==='move'?'MoveItemsResponse':'CloseContainerResponse',type=data?.['@type'];
 const contradictory=data?.filterResult?.compatible===false||(Array.isArray(data?.problems)&&data.problems.some(Boolean))||data?.error||data?.errorCode||data?.exception||data?.errorMessage||(data?.problems!=null&&!Array.isArray(data.problems))||data?.filterResult?.reason?.containerDamaged===true||hasPredicant(data)||/^(pending|submitted|queued|processing)$/i.test(String(data?.status||data?.state||''));
 if(type===expected&&data.success===true&&!contradictory)return{outcome:'CONFIRMED'};
 if(type===expected&&data&&typeof data==='object'&&(data.success===false||data.filterResult?.compatible===false))return{outcome:'REJECTED',reason:labels(data).join(' ')||'Native operation rejected',predicant:kind==='move'&&hasPredicant(data),damaged:kind==='move'&&/damaged/i.test(labels(data).join(' '))};
 return{outcome:'UNKNOWN',reason:'Native '+kind+' result not positively confirmed'};
}
export function createSidelineClient({window,fetch=window.fetch.bind(window),identity,warehouse,uuid=()=>window.crypto.randomUUID(),timeoutMs=25000,onEvidence=()=>{}}){
 async function request(path,body,{signal,mutation=false,allowItem=false}={}){
  if(signal?.aborted)throw new NativeRequestError('Cancelled before request');const controller=new window.AbortController();const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});const timer=window.setTimeout(()=>controller.abort(),timeoutMs);
  try{const url=new window.URL(path,window.location.origin);const response=await fetch(url.href,{method:body===null?'GET':'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},...(body===null?{}:{body:JSON.stringify(body)}),signal:controller.signal});const raw=await response.text();let data;try{data=JSON.parse(raw);}catch{data=null;}
   const knownRejection=mutation&&[400,409,422].includes(response.status)&&data?.success===false&&data?.['@type']===(path==='/api/move-items'?'MoveItemsResponse':'CloseContainerResponse');const knownOverage=allowItem&&[400,409].includes(response.status)&&allowedOverage(data);
   if(response.redirected||response.url&&response.url!==url.href||(!response.ok&&!knownRejection&&!knownOverage)||/html/i.test(response.headers?.get?.('content-type')||'')||data===null||raw.length>8000000)throw new NativeRequestError('Native Poirot response/session invalid',{outcome:mutation?'UNKNOWN':'REJECTED',status:response.status});
   onEvidence({type:'sideline.response',intent:mutation?'mutation':'read',data:{endpoint:url.pathname,status:response.status,responseType:clean(data?.['@type'])}});return data;
  }catch(error){if(error instanceof NativeRequestError)throw error;throw new NativeRequestError('Native Poirot request failed/cancelled',{outcome:mutation?'UNKNOWN':'REJECTED'});}finally{window.clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
 }
 function validContainer(value){if(!/^(?:csX|tsX)[A-Za-z0-9_-]+$/i.test(clean(value)))throw new NativeRequestError('Valid csX/tsX container required');}
 return{
  async bootstrap({signal}={}){const data=await request('/api/get-bootstrap-data?tool='+SIDELINE_TOOL,null,{signal});const info=data?.warehouseInfo,id=typeof info==='string'?info:info?.warehouseId||info?.id||data?.warehouseId;if(!/^[A-Z0-9]{3}\d$/.test(id||'')||warehouse&&id!==warehouse)throw new NativeRequestError('Native warehouse identity unavailable/mismatched');identity();return{warehouse:id};},
  async source(container,{signal}={}){validContainer(container);const data=await request('/api/scan-source-container',{containerScannableId:container,requestId:sidelineRequestId(uuid),tool:SIDELINE_TOOL},{signal});if(customerBound(data))throw new NativeRequestError('CUSTOMER-BOUND SHIPMENT');if(data?.['@type']!=='ScanSourceContainerResponse'||data.success!==true)throw new NativeRequestError(labels(data).join(' ')||'Source not validated');return data;},
  async item(source,barcode,{signal}={}){validContainer(source);return resolveSidelineItem(await request('/api/scanitem',{containerScannableId:source,itemBarcode:barcode,isMasterpack:null,itemAndonContext:null,requestId:sidelineRequestId(uuid),tool:SIDELINE_TOOL},{signal,allowItem:true}),barcode);},
  async close(container,{signal,beforeMutation}={}){validContainer(container);identity();const body={containerScannableId:container,containerEmpty:true,directedLabel:false,processPath:'UNDETERMINED',requestId:sidelineRequestId(uuid),tool:SIDELINE_TOOL};beforeMutation(body.requestId);return classifySidelineMutation(await request('/api/close-container',body,{signal,mutation:true}),'close');},
  async move(data,{signal,beforeMutation}={}){validContainer(data.source);validContainer(data.destination);if(upper(data.source)===upper(data.destination)||!Number.isInteger(data.quantity)||data.quantity<1)throw new NativeRequestError('Invalid source/destination/quantity');identity();const body=sidelineMovePayload({...data,uuid});beforeMutation(body.requestId);return classifySidelineMutation(await request('/api/move-items',body,{signal,mutation:true}),'move');}
 };
}
