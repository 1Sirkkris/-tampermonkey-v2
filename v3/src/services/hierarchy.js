V3.hierarchy=(()=>{
  const WAREHOUSE='BWU2',ORIGIN='https://tx-b-hierarchy-nrt.nrt.proxy.amazon.com';
  const API={validate:'/validateContainer',summary:'/getTransshipmentBindingSummary',unbind:'/unbindContainer'};
  async function post(path,body,options={}){
    const request={method:'POST',body:JSON.stringify(body),headers:{'content-type':'application/json'},timeout:options.timeout||15000,allowHttpError:options.allowHttpError===true};
    return location.hostname==='tx-b-hierarchy-nrt.nrt.proxy.amazon.com'
      ? V3.transport.page(path,request)
      : V3.transport.gm(ORIGIN+path,request);
  }
  async function validate(id){
    const code=V3.base.clean(id),r=await post(API.validate,{warehouseId:WAREHOUSE,scannableId:code});
    if(!r.data||V3.base.upper(r.data.warehouseId)!==WAREHOUSE)throw new Error('Container is not validated in '+WAREHOUSE);
    if(r.data.scannableId&&V3.base.lower(r.data.scannableId)!==V3.base.lower(code))throw new Error('Validation returned another container');
    return r.data;
  }
  async function summary(id){
    const r=await post(API.summary,{warehouseId:WAREHOUSE,scannableId:V3.base.clean(id)});
    if(!Array.isArray(r.data?.transferBindingSummaryList))throw new Error('Unexpected binding summary');
    return r.data;
  }
  async function unbind(id,employeeLogin,{telemetry}={}){
    const code=V3.base.clean(id),login=V3.identity.normalize(employeeLogin);
    if(!V3.base.container(code))throw new Error('Container must be tsX/csX');
    if(!login)throw new Error('Authenticated employee unavailable');
    await validate(code);await summary(code);
    const op=V3.operation.create({kind:'hierarchy-unbind',ref:code,telemetry});op.submitted();
    let r;
    try{r=await post(API.unbind,{sourceWarehouseId:WAREHOUSE,scannableId:code,employeeLogin:login},{timeout:20000,allowHttpError:true});}
    catch(error){op.unknown({reason:'transport'});throw new V3.operation.UnknownError('Unbind submitted; confirmation lost',{cause:error});}
    if(r.status>=500){op.unknown({status:r.status});throw new V3.operation.UnknownError('Unbind HTTP '+r.status+'; verify before retry');}
    if(r.status<200||r.status>=300){op.rejected({status:r.status});throw new V3.operation.RejectedError('Unbind rejected HTTP '+r.status);}
    if(!V3.base.clean(r.data?.hostName)){op.unknown({reason:'unexpected-response'});throw new V3.operation.UnknownError('Unbind response ambiguous; verify container');}
    op.confirmed();return r.data;
  }
  return Object.freeze({WAREHOUSE,ORIGIN,API,validate,summary,unbind});
})();