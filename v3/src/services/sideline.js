V3.sideline = (() => {
  const ORIGIN='https://aft-poirot-website-nrt.nrt.proxy.amazon.com';
  const TOOL='V3';
  const API={
    bootstrap:'/api/get-bootstrap-data',
    source:'/api/scan-source-container',
    item:'/api/scanitem',
    move:'/api/move-items',
    close:'/api/close-container'
  };
  const requestId=()=>{
    const id=crypto.randomUUID?.()||(Date.now()+'-'+Math.random().toString(16).slice(2));
    return 'amzn1.fc.v1.common.request-id.v1.AFTPoirotWebsite.'+id;
  };
  const sourcePayload=container=>({containerScannableId:container,requestId:requestId(),tool:TOOL});
  const itemPayload=(source,barcode)=>({
    containerScannableId:source,itemBarcode:barcode,isMasterpack:null,itemAndonContext:null,
    requestId:requestId(),tool:TOOL
  });
  const closePayload=(container,empty)=>({
    containerScannableId:container,containerEmpty:empty===true,directedLabel:false,
    processPath:'UNDETERMINED',requestId:requestId(),tool:TOOL
  });

  const problemLabels=response=>(Array.isArray(response?.problems)?response.problems:[])
    .filter(Boolean).map(problem=>V3.base.clean(
      problem?.description||problem?.message||problem?.reason||problem?.code||problem?.['@type']||''
    )).filter(Boolean);
  const hazmatRejected=response=>{
    if(!response||typeof response!=='object')return false;
    const filter=response.filterResult||{},reason=filter.reason||{},responseReason=response.reason||{},problems=(response.problems||[]).filter(Boolean);
    const labels=[
      response.message,response.description,response.errorMessage,response.errorCode,
      typeof response.reason==='string'?response.reason:'',
      responseReason.type,responseReason.description,responseReason.message,responseReason['@type'],
      reason.type,reason.description,reason.message,reason['@type'],filter.filterType,
      ...problems.flatMap(p=>[p?.description,p?.message,p?.reason,p?.code,p?.['@type']])
    ].map(V3.base.clean).filter(Boolean);
    if(!labels.some(label=>/hazmat|dangerous.?goods/i.test(label)))return false;
    return response.success===false||filter.compatible===false||problems.length>0||
      Boolean(response.errorMessage||response.errorCode)||/error|reject|incompat|filter/i.test(V3.base.clean(response?.['@type']));
  };
  const hasPredicant=value=>{
    if(value==null)return false;
    if(typeof value==='string')return /predicant/i.test(value);
    if(Array.isArray(value))return value.some(hasPredicant);
    if(typeof value!=='object')return false;
    return Object.entries(value).some(([key,child])=>{
      if(/predicant/i.test(key)){
        if(child===true)return true;
        if(typeof child==='string'&&child&&!/^false$/i.test(child))return true;
      }
      return hasPredicant(child);
    });
  };
  const damagedDestination=response=>{
    const filter=response?.filterResult,reason=filter?.reason;
    if(filter?.compatible!==false)return false;
    return reason?.containerDamaged===true||
      V3.base.lower(reason?.['@type'])==='damageditemsfilterresultreason'||
      /damageditemsfilter/i.test(V3.base.clean(filter?.filterType));
  };
  const overageLabel=value=>/\boverage(?:s)?\b|\bitem\s+not\s+in\s+(?:source\s+)?container\b|\bnot\s+in\s+source\s+container\b/i.test(V3.base.clean(value));
  const benignOverage=value=>{
    const label=V3.base.clean(value);
    return !label||overageLabel(label)||/^(?:bad request|conflict|request failed|http\s*[45]\d\d|[45]\d\d)$/i.test(label);
  };
  const allowedOverage=response=>{
    if(!response||typeof response!=='object')return false;
    const type=V3.base.clean(response?.['@type']);
    if(type==='InvalidBarcodeResponse'||type==='RequestMultipleBarcodesResponse')return false;
    if(hazmatRejected(response)||hasPredicant(response)||damagedDestination(response))return false;
    const filter=response.filterResult;
    const filterReason=V3.base.clean(filter?.reason?.type||filter?.reason?.description||filter?.reason?.message||filter?.reason?.['@type']||filter?.filterType||'');
    if(filter?.compatible===false&&!overageLabel(filterReason))return false;
    const problems=problemLabels(response);
    if(problems.some(label=>!overageLabel(label)))return false;
    const diagnostics=[response.message,response.description,response.errorMessage,response.errorCode,filterReason,...problems].map(V3.base.clean).filter(Boolean);
    if(!(overageLabel(type)||diagnostics.some(overageLabel)))return false;
    if(diagnostics.some(label=>!benignOverage(label)))return false;
    return !/hazmat|dangerous.?goods|invalid\s+barcode|incompatib|damaged|predicant|customer\s*bound/i.test([type,...diagnostics].join(' '));
  };
  const resolveItem=(response,barcode)=>{
    const type=V3.base.clean(response?.['@type']),overage=allowedOverage(response);
    if(!response||type==='InvalidBarcodeResponse'||(response.success===false&&!overage)){
      return{ok:false,invalid:type==='InvalidBarcodeResponse',type:type||'Unknown'};
    }
    const records=(Array.isArray(response.items)?response.items:[]).filter(record=>record?.skuDetail);
    const item=records[0]||null,sku=item?.skuDetail;
    if(!item||!sku)return{ok:false,invalid:false,type:type||'Unknown'};
    return{
      ok:true,type,barcode,item,records,sku,
      asin:V3.base.clean(sku.asin),fnsku:V3.base.clean(sku.fnSku),fcsku:V3.base.clean(sku.fcSku),
      dateType:V3.base.clean(sku.datelotDetail?.expirationPromptType),dateDetail:sku.datelotDetail||{},
      hazmat:sku.hazmat===true,
      permissionLevel:V3.base.upper(sku.itemDropzoneRecommendation?.permissionLevel),
      overage,
      notInSource:type==='ItemNotInContainerResponse'||records.every(record=>Number(record.quantity)===0)
    };
  };
  const responseText=response=>[
    response?.['@type'],response?.message,response?.description,response?.errorMessage,response?.errorCode,
    response?.filterResult?.filterType,response?.filterResult?.reason?.type,response?.filterResult?.reason?.description,
    response?.filterResult?.reason?.message,...problemLabels(response)
  ].map(V3.base.clean).filter(Boolean).join(' ');
  const classify=(response,code)=>{
    const ctx=resolveItem(response,code),text=responseText(response);
    if(/damaged/i.test(text))return{kind:'red',reason:'DAMAGED / INCOMPATIBLE',ctx};
    if(hazmatRejected(response))return{kind:'red',reason:'HAZMAT / DANGEROUS GOODS',ctx};
    if(!ctx.ok){
      const type=V3.base.clean(ctx.type);
      const reason=ctx.invalid?'INVALID BARCODE':type==='RequestMultipleBarcodesResponse'?'MULTIPLE BARCODE MATCHES':(type&&type!=='Unknown'?type:'NO ITEM DETAILS');
      return{kind:'red',reason,ctx};
    }
    if(ctx.permissionLevel==='UNDER_REVIEW')return{kind:'red',reason:'ASIN UNDER REVIEW — RIVER REQUIRED',ctx};
    if(ctx.dateType==='EXPIRATION_DATE'||ctx.dateType==='PRODUCTION_DATE'){
      return{kind:'yellow',reason:ctx.dateType==='PRODUCTION_DATE'?'PRODUCTION DATE':'EXPIRY DATE',ctx};
    }
    return{kind:'green',reason:'GOOD TO GO',ctx};
  };
  const movePayload=(source,destination,sourceMeta,ctx,qty=1,expirationMs=null)=>({
    itemExternalId:null,
    sourceContainerScannableId:source,
    destinationContainerScannableId:destination,
    scannableId:V3.base.clean(ctx.item.scannableId||ctx.barcode),
    quantity:String(Math.max(1,Number(qty)||1)),
    itemDetails:(ctx.records?.length?ctx.records:[ctx.item]).map(record=>{
      const sku=record.skuDetail||ctx.sku;
      return{
        fcsku:V3.base.clean(sku.fcSku),
        quantity:Number.isFinite(Number(record.quantity))?Number(record.quantity):0,
        consumerType:record.consumer??null,disposition:record.disposition??null,
        referenceId:record.referenceId??null,fnsku:V3.base.clean(sku.fnSku)
      };
    }),
    foundProblems:[null,null,null],
    scannedSourceContainerAsDestination:false,
    datelotDetail:ctx.sku.datelotDetail||null,
    userEnteredExpirationDate:expirationMs,
    mlcCaptureDetail:{
      mlcClass:ctx.sku.mlcDetail?.mlcClass??'UNKNOWN',userEnteredLotCode:null,
      mlcMissing:ctx.sku.mlcDetail?.mlcMissing??false,mlcNotEnteredReason:null,mlcCaptureMethod:null
    },
    itemMovedToISS:false,candidatePurchaseOrders:[],packHierarchyDetail:null,itemAndonContext:null,
    processPath:sourceMeta?.processPath??'UNDETERMINED',requestId:requestId(),tool:TOOL
  });
  const moveReason=response=>{
    if(!response)return'EMPTY MOVE RESPONSE';
    if(hazmatRejected(response))return'HAZMAT';
    if(allowedOverage(response))return'OVERAGE';
    if(damagedDestination(response))return'DESTINATION DAMAGED';
    if(hasPredicant(response))return'PREDICANT';
    const reason=response.filterResult?.reason;
    if(response.filterResult?.compatible===false)return V3.base.upper(reason?.type)||'DESTINATION INCOMPATIBLE';
    const problems=problemLabels(response);if(problems.length)return problems.join(', ');
    const type=V3.base.clean(response?.['@type']);
    return type&&type!=='MoveItemsResponse'?type.replace(/Response$/,''):'MOVE REJECTED';
  };

  function create(options={}){
    const telemetry=options.telemetry;
    const life=options.life;
    const hazmatCache=new Map();
    let warehousePromise=null;
    const request=async(path,body,opts={})=>{
      const operation=opts.operation;
      return V3.api.gmRequest(ORIGIN+path,{
        method:'POST',data:JSON.stringify(body),headers:{'content-type':'application/json'},
        timeout:opts.timeout||15000,mutation:Boolean(operation),operation,telemetry,
        allowHttpError:opts.allowHttpError===true
      });
    };
    const warehouse=async()=>{
      if(warehousePromise)return warehousePromise;
      warehousePromise=(async()=>{
        try{
          const result=await V3.api.gmRequest(ORIGIN+API.bootstrap+'?tool='+encodeURIComponent(TOOL),{timeout:8000,telemetry});
          const info=result.data?.warehouseInfo;
          const candidate=V3.base.upper((typeof info==='string'?info:'')||info?.warehouseId||info?.id||info?.warehouse||info?.fc||info?.code||result.data?.warehouseId);
          if(candidate)return candidate;
        }catch{}
        const fromPath=V3.fcr?.warehouse?.()||'';
        return V3.base.upper(fromPath||'BWU2');
      })();
      return warehousePromise;
    };
    const pandash=async asinValue=>{
      const asin=V3.base.upper(asinValue),fc=await warehouse();
      if(!/^B[A-Z0-9]{9}$/.test(asin)||!fc)throw new Error('HAZMAT LOOKUP CONTEXT MISSING');
      const key=fc+'|'+asin;if(hazmatCache.has(key))return hazmatCache.get(key);
      const boot=await V3.api.gmRequest('https://pandash.amazon.com/GridServlet?fc='+encodeURIComponent(fc),{timeout:8000,telemetry});
      const restriction=V3.base.clean(boot.data?.restriction||'default')||'default';
      const body='language=default&source='+encodeURIComponent(restriction)+'-hazmat-FC&marketPlaces=AU&asins='+encodeURIComponent(asin)+'&rows=1&page=1&fc='+encodeURIComponent(fc);
      const result=await V3.api.gmRequest('https://pandash.amazon.com/GridServlet',{
        method:'POST',data:body,headers:{'Content-Type':'application/x-www-form-urlencoded'},timeout:8000,telemetry
      });
      const row=Array.isArray(result.data?.rows)?result.data.rows.find(item=>V3.base.upper(item?.asin)===asin):null;
      if(!row)throw new Error('NO PANDASH RESULT');
      const answer={asin,level:Number(row.level||0),message:V3.base.clean(row.message),allowed:/can be processed/i.test(V3.base.clean(row.message))};
      hazmatCache.set(key,answer);return answer;
    };
    const validateSource=async container=>{
      const code=V3.base.clean(container);if(!V3.base.validContainer(code))throw new Error('Source must be tsX/csX');
      const result=await request(API.source,sourcePayload(code));
      const payload=result.data;
      const customer=/customer\s*bound\s*shipment/i.test(JSON.stringify(payload||{}));
      if(customer)throw new Error('CUSTOMER-BOUND SHIPMENT');
      if(V3.base.clean(payload?.['@type'])!=='ScanSourceContainerResponse'||payload?.success!==true){
        throw new Error(V3.base.clean(payload?.message||payload?.description||payload?.errorMessage||payload?.['@type'])||'SOURCE VALIDATION FAILED');
      }
      return payload;
    };
    const preflight=async(source,barcode)=>{
      const code=V3.base.clean(barcode);
      const result=await request(API.item,itemPayload(source,code),{allowHttpError:true});
      const base=classify(result.data,code);
      if(base.ctx?.ok&&base.ctx.hazmat===true&&base.kind!=='red'){
        try{
          const haz=await pandash(base.ctx.asin);
          if(!haz.allowed)return{kind:'red',reason:'HAZMAT L'+haz.level+' — NOT PROCESSABLE',ctx:base.ctx,hazmat:haz};
          return{...base,reason:base.kind==='yellow'?base.reason:'HAZMAT L'+haz.level+' — OK TO PROCESS',hazmat:haz};
        }catch(error){
          return{kind:'retry',reason:'HAZMAT CHECK FAILED — '+V3.base.clean(error?.message||error),ctx:base.ctx};
        }
      }
      return base;
    };
    const move=async({source,destination,sourceMeta,preflightResult,qty=1,expirationMs=null})=>{
      const ctx=preflightResult?.ctx;if(!ctx?.ok)throw new Error('Item context is not moveable');
      const operation=V3.operation.create({kind:'sideline-move',ref:ctx.barcode,telemetry});
      const result=await request(API.move,movePayload(source,destination,sourceMeta,ctx,qty,expirationMs),{operation,allowHttpError:true,timeout:15000});
      const payload=result.data;
      if(!payload||typeof payload!=='object'){
        operation.unknown({reason:'unexpected-confirmation'});
        throw new V3.operation.OutcomeUnknownError('Unexpected move confirmation');
      }
      if(allowedOverage(payload)||(payload.success===true&&payload.filterResult?.compatible!==false&&!hazmatRejected(payload)&&!hasPredicant(payload))){
        operation.confirmed({status:result.status,qty});return payload;
      }
      const reason=moveReason(payload);
      operation.rejected({reason,status:result.status});
      const error=new V3.operation.RejectedError(reason,{data:payload});
      if(hasPredicant(payload)||damagedDestination(payload))error.recoverable=true;
      throw error;
    };
    const close=async(container,empty=true)=>{
      const code=V3.base.clean(container);if(!V3.base.validContainer(code))throw new Error('Container must be tsX/csX');
      const operation=V3.operation.create({kind:'sideline-close',ref:code,telemetry});
      const result=await request(API.close,closePayload(code,empty),{operation,allowHttpError:true,timeout:15000});
      const payload=result.data;
      if(result.status>=200&&result.status<300&&V3.base.clean(payload?.['@type'])==='CloseContainerResponse'&&payload?.success===true){
        operation.confirmed();return payload;
      }
      operation.unknown({status:result.status,reason:'not-confirmed'});
      throw new V3.operation.OutcomeUnknownError('Close NOT CONFIRMED — verify container before retry');
    };
    const expirationFromDate=(ctx,dateValue)=>{
      const entered=new Date(String(dateValue)+'T00:00:00').getTime();
      if(!Number.isFinite(entered))throw new Error('Invalid date');
      if(ctx.dateType==='PRODUCTION_DATE')return{enteredMs:entered,finalExpirationMs:entered+Number(ctx.dateDetail?.shelfLife||0)};
      return{enteredMs:entered,finalExpirationMs:entered};
    };
    return Object.freeze({validateSource,preflight,move,close,warehouse,pandash,expirationFromDate});
  }
  return Object.freeze({create,resolveItem,classify,allowedOverage,hazmatRejected,hasPredicant,damagedDestination,moveReason});
})();