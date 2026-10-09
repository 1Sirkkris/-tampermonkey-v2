import{registerWatermark}from'./watermark.mjs';import{resolveIdentity}from'./identity.mjs';import{createNativeJson}from'./native-json.mjs';import{createHierarchyDriver}from'./hierarchy-driver.mjs';import{createHierarchyNative}from'./hierarchy-native.mjs';import{createHierarchyQueue}from'./hierarchy-runtime.mjs';import{evidence,installRouteLifecycle}from'./ui-tools.mjs';
export function installHierarchy(window,page,mode,version){
 const guard=Symbol.for('tampermonkey.v4.hierarchy.installer');if(page[guard])return;page[guard]={version};
 installRouteLifecycle(window,()=>{if(!new RegExp('^/'+mode+'Hierarchy(?:/|$)').test(window.location.pathname))return;
  const label=mode==='bind'?'BIND':'UNBD',release=registerWatermark(window,label,version),emit=data=>evidence(window,label,version,data),identity=()=>resolveIdentity(window,page);
  let template=null;try{template=JSON.parse(window.sessionStorage.getItem('tm-v4.hierarchy.template')||'null');}catch{}
  function save(value){template=value;try{window.sessionStorage.setItem('tm-v4.hierarchy.template',JSON.stringify(value));}catch{}}
  let native=mode==='bind'?createHierarchyNative({window,page,onTemplate:save,onMutation:record=>{if(record.request?.employeeLogin!==identity().login)throw new Error('Native Bind employee identity disagrees with authenticated user');}}):null;
  const request=createNativeJson({window,fetch:page.fetch.bind(page),onEvidence:emit});
  const driver=createHierarchyDriver({request,identity,seedBind:native?.seedBind,getTemplate:()=>template,setTemplate:save});
  const queue=createHierarchyQueue({window,mode,driver,identity,version,onEvidence:emit});
  return()=>{queue.dispose();native?.dispose();release();};
 },()=>window.location.pathname);
}
