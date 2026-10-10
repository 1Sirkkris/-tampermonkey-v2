import{registerWatermark}from'./watermark.mjs';import{createSimToolbar}from'./sim-runtime.mjs';import{evidence,installRouteLifecycle}from'./ui-tools.mjs';
const VERSION = '0.1.1';
const guard=Symbol.for('tampermonkey.v4.sim.installer');if(!window[guard]){window[guard]={version:VERSION};installRouteLifecycle(window,()=>{if(window.top!==window.self)return;const release=registerWatermark(window,'SIMTt',VERSION),helper=createSimToolbar({window,onEvidence:data=>evidence(window,'SIMTt',VERSION,data)});return()=>{helper.dispose();release();};},()=>location.pathname,{waitForDom:true});}
