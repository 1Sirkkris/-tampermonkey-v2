import{createFcrEnrichment,createGmJsonReader}from'./fcr-enrichment.mjs';
export function createSidelinePreflight({window,client,gmRequest,onEvidence=()=>{}}){let enrichment;return async(source,code,{signal}={})=>{
 const result=await client.item(source,code,{signal});if(result.kind==='red'||!result.ctx?.hazmat)return result;
 try{
  const context=await client.bootstrap({signal});enrichment||=createFcrEnrichment({warehouse:context.warehouse,readJson:createGmJsonReader(gmRequest),onEvidence,uuid:()=>window.crypto.randomUUID()});
  const hazard=await enrichment.hazmat(result.ctx.asin,{signal}),data=hazard.complete===true?hazard.hazmat:null;
  if(!data||!Number.isSafeInteger(data.level)||data.level<0||!data.message?.trim())return{kind:'retry',reason:'HAZMAT CHECK UNKNOWN — missing validated processing decision',ctx:result.ctx};
  const blocked=/cannot|can't|not be processed/i.test(data.message),allowed=/can be processed/i.test(data.message)&&!blocked;
  if(allowed)return{...result,reason:result.kind==='yellow'?result.reason:'HAZMAT L'+data.level+' — OK TO PROCESS'};
  if(blocked)return{kind:'red',reason:'HAZMAT L'+data.level+' — NOT PROCESSABLE',ctx:result.ctx};
  return{kind:'retry',reason:'HAZMAT CHECK UNKNOWN — unrecognised processing decision',ctx:result.ctx};
 }catch(error){return{kind:'retry',reason:'HAZMAT CHECK UNKNOWN — '+error.message,ctx:result.ctx};}
};}
