import{createFcrEnrichment,createGmJsonReader}from'./fcr-enrichment.mjs';import{upper}from'./ui-tools.mjs';
export function createSidelinePreflight({window,client,gmRequest,onEvidence=()=>{}}){let enrichment,enrichmentWarehouse;return async(source,code,{signal,previous}={})=>{
 const result=await client.item(source,code,{signal});if(result.kind==='red'||!result.ctx?.hazmat)return result;
 try{
  const context=await client.bootstrap({signal}),prior=previous?.hazmatDecision;
  const reuse=prior&&['green','yellow'].includes(previous.kind)&&prior.warehouse===context.warehouse&&upper(prior.asin)===upper(result.ctx.asin)&&Number.isSafeInteger(prior.level)&&prior.level>=0&&typeof prior.message==='string'&&/can be processed/i.test(prior.message)&&!/cannot|can't|not be processed/i.test(prior.message);
  let data;if(reuse)data=prior;else{if(!enrichment||enrichmentWarehouse!==context.warehouse){enrichment=createFcrEnrichment({warehouse:context.warehouse,readJson:createGmJsonReader(gmRequest),onEvidence,uuid:()=>window.crypto.randomUUID()});enrichmentWarehouse=context.warehouse;}const hazard=await enrichment.hazmat(result.ctx.asin,{signal});data=hazard.complete===true?hazard.hazmat:null;}
  if(!data||!Number.isSafeInteger(data.level)||data.level<0||!data.message?.trim())return{kind:'retry',reason:'HAZMAT CHECK UNKNOWN — missing validated processing decision',ctx:result.ctx};
  const blocked=/cannot|can't|not be processed/i.test(data.message),allowed=/can be processed/i.test(data.message)&&!blocked;
  if(allowed)return{...result,reason:result.kind==='yellow'?result.reason:'HAZMAT L'+data.level+' — OK TO PROCESS',hazmatDecision:{warehouse:context.warehouse,asin:upper(result.ctx.asin),level:data.level,message:data.message}};
  if(blocked)return{kind:'red',reason:'HAZMAT L'+data.level+' — NOT PROCESSABLE',ctx:result.ctx};
  return{kind:'retry',reason:'HAZMAT CHECK UNKNOWN — unrecognised processing decision',ctx:result.ctx};
 }catch(error){return{kind:'retry',reason:'HAZMAT CHECK UNKNOWN — '+error.message,ctx:result.ctx};}
};}
