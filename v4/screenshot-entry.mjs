import{registerWatermark}from'./watermark.mjs';import{createScreenshotMode}from'./screenshot-runtime.mjs';import{installRouteLifecycle}from'./ui-tools.mjs';
const VERSION = '0.1.0';
const guard=Symbol.for('tampermonkey.v4.screenshot.installer');if(!window[guard]){window[guard]={version:VERSION};installRouteLifecycle(window,()=>{if(window.top!==window.self)return;const release=registerWatermark(window,'SRCS',VERSION),helper=createScreenshotMode(window);return()=>{helper.dispose();release();};},()=>location.pathname);}
