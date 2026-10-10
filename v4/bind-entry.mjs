import{installHierarchy}from'./hierarchy-entry.mjs';
const VERSION = '0.1.2';
installHierarchy(window,typeof unsafeWindow==='object'?unsafeWindow:window,'bind',VERSION);
