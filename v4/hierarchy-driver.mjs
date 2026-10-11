import{clean,upper}from'./ui-tools.mjs';import{NativeRequestError}from'./native-json.mjs';
export function validateHierarchy(data,container){if(!data||typeof data!=='object'||upper(data.warehouseId)!=='BWU2'||upper(data.scannableId)!==upper(container))throw new NativeRequestError('Validation did not prove exact BWU2 container');}
export function validateSummary(data){if(!data||!Array.isArray(data.transferBindingSummaryList))throw new NativeRequestError('Native hierarchy summary invalid');}
export function validateHierarchyAcknowledgement(data){if(!data||typeof data.hostName!=='string'||!clean(data.hostName)||data.success===false||data.error||data.errorMessage||data.exception||['PENDING','PROCESSING','QUEUED'].includes(upper(data.status)))throw new NativeRequestError('Hierarchy result not positively acknowledged',{outcome:'UNKNOWN'});}
export function createHierarchyDriver({request,identity,seedBind,getTemplate,setTemplate}){
 return async(row,{mode,signal,beforeMutation,checkRunning,onPhase=()=>{}})=>{
  const container=row.container;
  if(mode==='bind'){
   let template=getTemplate();
   if(template){const dest=await request('/validateDestination',{destinationWarehouseId:template.destinationWarehouseId},{signal});if(upper(dest.data)!=='BWU1'){setTemplate(null);template=null;}}
   if(!template){if(!seedBind)throw new NativeRequestError('Native Bind scanner/template capability unavailable');return seedBind(row,{signal,beforeMutation,checkRunning,onPhase});}
  }
  onPhase('validate');const validated=await request('/validateContainer',{warehouseId:'BWU2',scannableId:container},{signal});validateHierarchy(validated.data,container);
  onPhase('summary');const summary=await request('/getTransshipmentBindingSummary',{warehouseId:'BWU2',scannableId:container},{signal});validateSummary(summary.data);
  checkRunning();const login=identity().login;const template=mode==='bind'?getTemplate():null;
  const body={sourceWarehouseId:template?.sourceWarehouseId||'BWU2',scannableId:container,employeeLogin:login};if(mode==='bind')body.destinationWarehouseId=template.destinationWarehouseId;
  beforeMutation();onPhase(mode);
  const result=await request(mode==='bind'?'/forceBind':'/unbindContainer',body,{signal,mutation:true});validateHierarchyAcknowledgement(result.data);return result;
 };
}
