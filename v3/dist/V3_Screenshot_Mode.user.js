// ==UserScript==
// @name         V3 | BWU2 Screenshot Mode
// @name:en      V3 | BWU2 Screenshot Mode
// @namespace    https://github.com/1Sirkkris/-tampermonkey-v2/v3-groundup
// @version      0.2.0
// @description  Ctrl+Q hides/shows V3 userscript UI for clean screenshots.
// @include      /^https?:\/\/aft-poirot-website-nrt\.nrt\.proxy\.amazon\.com\//
// @include      *://aft-qt-*.corp.amazon.com/*
// @include      /^https?:\/\/(?:[^\/]*fcresearch[^\/]*|qifcr\.fe\.aftx\.amazonoperations\.app)\//
// @include      /^https?:\/\/aft-moveapp-[^\/]+(?:\.nrt)?\.proxy\.amazon\.com\//
// @include      /^https?:\/\/fba-fnsku-commingling-console-(?:eu|na|jp)\.aka\.amazon\.com\//
// @include      /^https?:\/\/river\.amazon\.com\//
// @include      /^https?:\/\/console\.harmony\.a2z\.com\/poportal\//
// @include      /^https?:\/\/tx-b-hierarchy-nrt\.nrt\.proxy\.amazon\.com\//
// @include      /^https?:\/\/aftcartonpreditorapp-tcp-nrt\.nrt\.proxy\.amazon\.com\//
// @include      /^https?:\/\/fcmenu-(?:iad|nrt)-regionalized\.corp\.amazon\.com\//
// @include      https://t.corp.amazon.com/*
// @run-at       document-start
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-groundup/v3/dist/V3_Screenshot_Mode.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-groundup/v3/dist/V3_Screenshot_Mode.user.js
// @v3-build     screenshot-0.2.0-3140b068
// ==/UserScript==

(()=>{
'use strict';
const V3=Object.create(null);
V3.build=Object.freeze({"id":"screenshot-0.2.0-3140b068","version":"0.2.0"});

// ---- src/apps/screenshot.js ----
V3.boot=()=>{
  const ATTR='data-bwu2-v3-screenshot',STYLE='bwu2-v3-screenshot-style';
  const install=()=>{if(document.getElementById(STYLE))return;const s=document.createElement('style');s.id=STYLE;s.textContent='html['+ATTR+'="1"] [data-bwu2-ui]{display:none !important;}';(document.head||document.documentElement).appendChild(s);};
  const toggle=()=>{install();const root=document.documentElement,on=root.getAttribute(ATTR)==='1';root.setAttribute(ATTR,on?'0':'1');};
  window.addEventListener('keydown',event=>{if(event.key.toLowerCase()!=='q'||!event.ctrlKey||event.shiftKey||event.altKey||event.metaKey)return;event.preventDefault();event.stopPropagation();toggle();},true);
};

if(typeof V3.boot!=='function')throw new Error('V3 boot missing');
V3.boot();
})();
