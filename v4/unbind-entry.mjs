import{installHierarchy}from'./hierarchy-entry.mjs';
const VERSION = '0.1.0';
installHierarchy(window,typeof unsafeWindow==='object'?unsafeWindow:window,'unbind',VERSION);
