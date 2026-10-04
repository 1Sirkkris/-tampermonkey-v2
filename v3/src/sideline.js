V3.sideline=(()=>{
  const C=V3.core,ORIGIN='https://aft-poirot-website-nrt.nrt.proxy.amazon.com',TOOL='V3';
  const PATH={bootstrap:'/api/get-bootstrap-data',source:'/api/scan-source-container',close:'/api/close-container',item:'/api/scanitem',move:'/api/move-items'};
  const requestId=()=>C.id('sideline');
  const scanSourcePayload=container=>({containerScannableId:container,requestId:requestId(),tool:TOOL});
  const scanItemPayload=(source,barcode)=>({containerScannableId:source,itemBarcode:barcode,isMasterpack:null,itemAndonContext:null,requestId:requestId(),tool:TOOL});
  const closePayload=(container,empty)=>({containerScannableId:container,containerEmpty:empty===true,directedLabel:false,processPath:'UNDETERMINED',requestId:requestId(),tool:TOOL});

  const problems=response=>(Array.isArray(response?.problems)?response.problems:[]).map(x=>C.clean(x?.description||x?.message||x?.reason||x?.code||x?.['@type']||'')).filter(Boolean);
  const deepHas=(value,re,seen=new Set())=>{if(value==null)return false;if(typeof value==='string')return re.test(value);if(typeof value!=='object'||seen.has(value))return false;seen.add(value);if(Array.isArray(value))return value.some(x=>deepHas(x,re,seen));return Object.entries(value).some(([k,v])=>re.test(k)||deepHas(v,re,seen));};
  const hasPredicant=value=>deepHas(value,/predicant/i);
  const payloadHasCustomerBound=value=>deepHas(value,/customer\s*bound\s*shipment/i);
  const hazmatRejected=response=>{
    if(!response||typeof response!=='object')return false;
    const filter=response.filterResult||{},reason=filter.reason||{};
    const labels=[response.message,response.description,response.errorMessage,response.errorCode,typeof response.reason==='string'?response.reason:'',response.reason?.type,response.reason?.description,response.reason?.message,reason.type,reason.description,reason.message,reason['@type'],filter.filterType,...problems(response)].map(C.clean).filter(Boolean);
    if(!labels.some(x=>/hazmat|dangerous.?goods/i.test(x)))return false;
    return response.success===false||filter.compatible===false||problems(response).length>0||Boolean(response.errorMessage||response.errorCode)||/error|reject|incompat|filter/i.test(C.clean(response['@type']));
  };
  const damagedDestination=response=>{const r=response?.filterResult?.reason;return response?.filterResult?.compatible===false&&/damag/i.test([r?.type,r?.description,r?.message,r?.['@type']].map(C.clean).join(' '));};
  const overageLabel=value=>/item\s*not\s*in\s*(?:source\s*)?container|not\s*in\s*container|overage/i.test(C.clean(value));
  const benignCompanion=value=>!/hazmat|dangerous.?goods|invalid\s+barcode|incompatib|damaged|predicant|customer\s*bound/i.test(C.clean(value));
  const allowedOverage=response=>{
    const type=C.clean(response?.['@type']),labels=[response?.message,response?.description,response?.errorMessage,response?.errorCode,response?.filterResult?.reason?.type,response?.filterResult?.reason?.description,response?.filterResult?.reason?.message,...problems(response)].map(C.clean).filter(Boolean);
    const explicit=overageLabel(type)||labels.some(overageLabel);
    if(!explicit||labels.some(x=>!benignCompanion(x)))return false;
    return !/hazmat|dangerous.?goods|invalid\s+barcode|incompatib|damaged|predicant|customer\s*bound/i.test([type,...labels].join(' '));
  };
  const resolveItem=(response,barcode)=>{
    const type=C.clean(response?.['@type']),overage=allowedOverage(response);
    if(!response||type==='InvalidBarcodeResponse'||(response.success===false&&!overage))return{ok:false,invalid:type==='InvalidBarcodeResponse',type:type||'Unknown'};
    const records=(Array.isArray(response.items)?response.items:[]).filter(x=>x?.skuDetail),item=records[0]||null,sku=item?.skuDetail;
    if(!item||!sku)return{ok:false,invalid:false,type:type||'Unknown'};
    return{ok:true,type,barcode,item,records,sku,asin:C.clean(sku.asin),fnsku:C.clean(sku.fnSku),fcsku:C.clean(sku.fcSku),dateType:C.clean(sku.datelotDetail?.expirationPromptType),dateDetail:sku.datelotDetail||{},hazmat:sku.hazmat===true,permissionLevel:C.upper(sku.itemDropzoneRecommendation?.permissionLevel),overage};
  };
  const responseText=response=>[response?.['@type'],response?.message,response?.description,response?.errorMessage,response?.errorCode,response?.filterResult?.filterType,response?.filterResult?.reason?.type,response?.filterResult?.reason?.description,response?.filterResult?.reason?.message,...problems(response)].map(C.clean).filter(Boolean).join(' ');
  const baseClassify=(response,barcode)=>{
    const ctx=resolveItem(response,barcode),text=responseText(response);
    if(/damaged/i.test(text))return{kind:'red',reason:'DAMAGED / INCOMPATIBLE',ctx};
    if(hazmatRejected(response))return{kind:'red',reason:'HAZMAT / DANGEROUS GOODS',ctx};
    if(!ctx.ok)return{kind:'red',reason:ctx.invalid?'INVALID BARCODE':ctx.type==='RequestMultipleBarcodesResponse'?'MULTIPLE BARCODE MATCHES':(ctx.type&&ctx.type!=='Unknown'?ctx.type:'NO ITEM DETAILS'),ctx};
    if(ctx.permissionLevel==='UNDER_REVIEW')return{kind:'red',reason:ctx.hazmat?'HAZMAT / UNDER REVIEW — RIVER REQUIRED':'ASIN UNDER REVIEW — RIVER REQUIRED',ctx};
    if(ctx.dateType==='EXPIRATION_DATE'||ctx.dateType==='PRODUCTION_DATE')return{kind:'yellow',reason:ctx.dateType==='PRODUCTION_DATE'?'PRODUCTION DATE':'EXPIRY DATE',ctx};
    return{kind:'green',reason:'GOOD TO GO',ctx};
  };
  const moveOk=response=>allowedOverage(response)||Boolean(response&&response.success===true&&response.filterResult?.compatible!==false&&!hazmatRejected(response)&&!hasPredicant(response));
  const moveReason=response=>{
    if(!response)return'EMPTY MOVE RESPONSE';if(hazmatRejected(response))return'HAZMAT';if(allowedOverage(response))return'OVERAGE';if(damagedDestination(response))return'DESTINATION DAMAGED';
    const reason=response.filterResult?.reason;if(response.filterResult?.compatible===false)return C.upper(reason?.type)||'DESTINATION INCOMPATIBLE';
    const p=problems(response);return p.length?p.join(', '):C.clean(response?.['@type']).replace(/Response$/,'')||'MOVE REJECTED';
  };
  const maxDay=(year,month)=>new Date(year,month,0).getDate();
  const validDate=(day,month,year)=>{const d=Number(day),m=Number(month),y=Number(year);if(!Number.isInteger(d)||!Number.isInteger(m)||!Number.isInteger(y)||y<2020||m<1||m>12||d<1||d>maxDay(y,m))return null;return new Date(y,m-1,d).getTime();};
  const pao900=productionMs=>productionMs+900*24*60*60*1000;

  function create({life,telemetry}={}){
    let warehousePromise=null,restriction='',preflightInflight=new Map(),hazmatCache=new Map();
    const api=async(path,{method='GET',body,signal,allowHttpError=false}={})=>{
      const r=await C.request(ORIGIN+path,{method,body:body==null?undefined:JSON.stringify(body),headers:body==null?{}:{'Content-Type':'application/json'},timeout:15000,allowHttpError,signal:signal||life?.signal});
      return r.data;
    };
    const warehouse=async()=>{if(!warehousePromise)warehousePromise=(async()=>{try{const p=await api(PATH.bootstrap+'?tool='+encodeURIComponent(TOOL));const info=p?.warehouseInfo;return C.upper((typeof info==='string'?info:'')||info?.warehouseId||info?.id||info?.warehouse||info?.fc||info?.code||p?.warehouseId||'');}catch{return'';}})();return warehousePromise;};
    const source=async container=>{
      const code=C.clean(container);if(!C.container(code))throw new Error('Invalid source container');
      const payload=await api(PATH.source,{method:'POST',body:scanSourcePayload(code)});
      if(payloadHasCustomerBound(payload))throw new Error('CUSTOMER-BOUND SHIPMENT');
      if(C.clean(payload?.['@type'])!=='ScanSourceContainerResponse'||payload?.success!==true)throw new Error(C.clean(payload?.message||payload?.description||payload?.errorMessage||payload?.['@type']||'SOURCE VALIDATION FAILED'));
      return payload;
    };
    const close=async(container,empty=false)=>{
      const code=C.clean(container);if(!C.container(code))throw new Error('Invalid container');
      const op=C.operation({kind:'sideline-close',ref:code,telemetry});op.submitted();
      let payload;try{payload=await api(PATH.close,{method:'POST',body:closePayload(code,empty)});}catch(error){op.unknown({reason:'transport'});throw new C.UnknownError('CLOSE OUTCOME UNKNOWN — '+code+' — VERIFY BEFORE RETRY',{cause:error});}
      if(C.clean(payload?.['@type'])!=='CloseContainerResponse'||payload?.success!==true){op.rejected({reason:moveReason(payload)});throw new C.RejectedError(C.clean(payload?.message||payload?.description||payload?.['@type']||'CLOSE REJECTED'));}
      op.confirmed();return payload;
    };
    const rawItem=(sourceContainer,barcode,signal)=>api(PATH.item,{method:'POST',body:scanItemPayload(sourceContainer,barcode),signal,allowHttpError:true});
    const hazmat=async asinValue=>{
      const asin=C.upper(asinValue),fc=await warehouse();if(!/^B[A-Z0-9]{9}$/.test(asin)||!fc)throw new Error('HAZMAT LOOKUP CONTEXT MISSING');
      const key=fc+'|'+asin,cached=hazmatCache.get(key);if(cached&&Date.now()-cached.at<6*60*60*1000)return cached.value;
      if(!restriction){const b=await C.request('https://pandash.amazon.com/GridServlet?fc='+encodeURIComponent(fc),{timeout:8000});restriction=C.clean(b.data?.restriction||'default')||'default';}
      let last;
      for(let attempt=0;attempt<2;attempt++){
        try{
          const form='language=default&source='+encodeURIComponent(restriction)+'-hazmat-FC&marketPlaces=AU&asins='+encodeURIComponent(asin)+'&rows=1&page=1&fc='+encodeURIComponent(fc);
          const r=await C.request('https://pandash.amazon.com/GridServlet',{method:'POST',body:form,headers:{'Content-Type':'application/x-www-form-urlencoded'},timeout:8000}),row=Array.isArray(r.data?.rows)?r.data.rows.find(x=>C.upper(x?.asin)===asin):null;
          if(!row)throw new Error('NO PANDASH RESULT');
          const value={asin,level:Number(row.level||0),message:C.clean(row.message),allowed:/can be processed/i.test(C.clean(row.message))};hazmatCache.set(key,{value,at:Date.now()});return value;
        }catch(error){last=error;if(attempt===0)await life.sleep(150);}
      }
      throw last||new Error('HAZMAT LOOKUP FAILED');
    };
    const classify=async(response,barcode)=>{
      let result=baseClassify(response,barcode);
      if(result.kind==='red'||!result.ctx?.hazmat)return result;
      try{
        const h=await hazmat(result.ctx.asin);
        if(!h.allowed)return{kind:'red',reason:'HAZMAT L'+h.level+' — NOT PROCESSABLE',ctx:result.ctx,hazmat:h};
        return{...result,reason:result.kind==='yellow'?result.reason:'HAZMAT L'+h.level+' — OK TO PROCESS',hazmat:h};
      }catch(error){return{kind:'retry',reason:'HAZMAT CHECK FAILED — '+C.clean(error.message||error),ctx:result.ctx};}
    };
    const preflight=async(sourceContainer,barcode,{signal}={})=>{
      const key=C.upper(sourceContainer)+'|'+C.upper(barcode);
      if(preflightInflight.has(key))return preflightInflight.get(key);
      const work=(async()=>{const response=await rawItem(sourceContainer,barcode,signal);const result=await classify(response,barcode);telemetry?.emit('sideline.preflight',{item:C.mask(barcode),kind:result.kind,reason:result.reason});return{response,result};})();
      preflightInflight.set(key,work);try{return await work;}finally{preflightInflight.delete(key);}
    };
    const movePayload=(sourceContainer,destination,sourceMeta,ctx,qty,expirationMs)=>{
      const item=ctx.item,sku=ctx.sku,records=ctx.records?.length?ctx.records:[item];
      return{itemExternalId:null,sourceContainerScannableId:sourceContainer,destinationContainerScannableId:destination,scannableId:C.clean(item.scannableId||ctx.barcode),quantity:String(Math.max(1,Number(qty)||1)),itemDetails:records.map(record=>{const s=record.skuDetail||sku;return{fcsku:C.clean(s.fcSku),quantity:Number.isFinite(Number(record.quantity))?Number(record.quantity):0,consumerType:record.consumer??null,disposition:record.disposition??null,referenceId:record.referenceId??null,fnsku:C.clean(s.fnSku)};}),foundProblems:[null,null,null],scannedSourceContainerAsDestination:false,datelotDetail:sku.datelotDetail||null,userEnteredExpirationDate:expirationMs??null,mlcCaptureDetail:{mlcClass:sku.mlcDetail?.mlcClass??'UNKNOWN',userEnteredLotCode:null,mlcMissing:sku.mlcDetail?.mlcMissing??false,mlcNotEnteredReason:null,mlcCaptureMethod:null},itemMovedToISS:false,candidatePurchaseOrders:[],packHierarchyDetail:null,itemAndonContext:null,processPath:sourceMeta?.processPath??'UNDETERMINED',requestId:requestId(),tool:TOOL};
    };
    const move=async({sourceContainer,destination,sourceMeta,preflightResult,qty=1,expirationMs=null})=>{
      const ctx=preflightResult?.result?.ctx||preflightResult?.ctx;if(!ctx?.ok)throw new Error('Item was not safely preflighted');
      const payload=movePayload(sourceContainer,destination,sourceMeta,ctx,qty,expirationMs),ref=ctx.barcode||ctx.fnsku||ctx.asin;
      const op=C.operation({kind:'sideline-move',ref,telemetry});op.submitted({qty:Number(qty)||1});
      let response;
      try{response=await api(PATH.move,{method:'POST',body:payload,allowHttpError:true});}
      catch(error){op.unknown({reason:'transport'});throw new C.UnknownError('MOVE OUTCOME UNKNOWN — '+C.clean(ref)+' — VERIFY BEFORE RETRY',{cause:error});}
      if(moveOk(response)){op.confirmed({reason:allowedOverage(response)?'overage':'success'});return response;}
      const reason=moveReason(response);op.rejected({reason});const e=new C.RejectedError(reason);e.recoverable=damagedDestination(response)||/DESTINATION INCOMPATIBLE/i.test(reason);throw e;
    };
    return Object.freeze({warehouse,source,close,preflight,hazmat,move,movePayload});
  }

  return Object.freeze({ORIGIN,PATH,scanSourcePayload,scanItemPayload,closePayload,resolveItem,baseClassify,allowedOverage,hazmatRejected,damagedDestination,hasPredicant,moveOk,moveReason,validDate,pao900,create});
})();
