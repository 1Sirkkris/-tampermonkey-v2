import{registerWatermark}from'./watermark.mjs';import{resolveIdentity}from'./identity.mjs';import{createSidelineClient}from'./sideline-client.mjs';import{createSidelineUi}from'./sideline-runtime.mjs';import{createSidelineNative}from'./sideline-native.mjs';import{createSidelinePreflight}from'./sideline-preflight.mjs';import{evidence,installRouteLifecycle}from'./ui-tools.mjs';
const VERSION = '0.1.7';
const page=typeof unsafeWindow==='object'?unsafeWindow:window,guard=Symbol.for('tampermonkey.v4.sideline.installer');
if(!page[guard]){page[guard]={version:VERSION};installRouteLifecycle(window,()=>{
 if(window.top!==window.self||location.hostname!=='aft-poirot-website-nrt.nrt.proxy.amazon.com')return;const emit=data=>evidence(window,'SIDE',VERSION,data),identity=()=>resolveIdentity(window,page),client=createSidelineClient({window,fetch:page.fetch.bind(page),identity,onEvidence:emit});let ui;
 const preflight=createSidelinePreflight({window,client,gmRequest:GM_xmlhttpRequest,onEvidence:emit});
 const native=createSidelineNative({window,page,client,identity,canAssist:()=>!ui?.workflow?.getState().busy,onEvidence:emit});const release=registerWatermark(window,'SIDE',VERSION);ui=createSidelineUi({window,client,preflight,native,version:VERSION,onEvidence:emit});native.refresh();return()=>{ui.dispose();release();};
},()=>location.pathname,{waitForDom:true});}
