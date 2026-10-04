import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {harness,root,tick} from './harness.mjs';
const manifest=JSON.parse(fs.readFileSync(path.join(root,'build/manifest.json'),'utf8'));
const urls={fcr:'https://fcresearch-fe.aka.amazon.com/BWU2/results?s=tsX123',iss:'https://aft-poirot-website-nrt.nrt.proxy.amazon.com/#iss-console',aft:'https://aft-qt-jp.aka.nrt.corp.amazon.com/app/moveitems',sideline:'https://aft-poirot-website-nrt.nrt.proxy.amazon.com/',hierarchy:'https://tx-b-hierarchy-nrt.nrt.proxy.amazon.com/bindHierarchy',movecontainer:'https://aft-moveapp-nrt-nrt.nrt.proxy.amazon.com/move-container',river:'https://river.amazon.com/BWU2/workflows',fnsku:'https://fba-fnsku-commingling-console-jp.aka.amazon.com/tool/fnsku-mappings-tool',poportal:'https://console.harmony.a2z.com/poportal/fe',carton:'https://aftcartonpreditorapp-tcp-nrt.nrt.proxy.amazon.com/wf',calm:'https://fcmenu-nrt-regionalized.corp.amazon.com/BWU2/calmCode',sim:'https://t.corp.amazon.com/example',obs:'https://example.amazon.com/',screenshot:'https://example.amazon.com/'};
for(const suite of manifest.suites){const h=harness({url:urls[suite.id],modules:[],html:'<form><input id="calmCode"><textarea placeholder="Markdown"></textarea></form>'});const errors=[];let intervals=0;const setInterval=h.w.setInterval;h.w.setInterval=(...args)=>{intervals++;return setInterval.apply(h.w,args);};h.w.addEventListener('error',event=>errors.push(event.error));
 try{h.w.eval(fs.readFileSync(path.join(root,'dist',suite.output),'utf8'));await tick();const buttons=[...h.w.document.querySelectorAll('[data-v3-button]')];for(const button of buttons){if(button.dataset.v3Button==='fcr-iss')continue;button.click();await tick();}
  if(suite.id==='iss'){for(const tab of ['move','edit','fcsku','sideline']){h.w.document.querySelector('[data-tab="'+tab+'"]')?.click();await tick();}}
  if(suite.id==='sideline')h.w.document.querySelector('[data-queue]')?.click();
  if(suite.id==='screenshot'){h.w.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'q',ctrlKey:true}));assert.equal(h.w.document.documentElement.getAttribute('data-bwu2-v3-screenshot'),'1');}
  if(!['obs','screenshot'].includes(suite.id))assert.ok(h.w.document.querySelector('[data-bwu2-ui]'),suite.id+' has UI');
  assert.equal(intervals,0,suite.id+' idle interval');assert.equal(errors.length,0,suite.id+' runtime error: '+errors.map(e=>e?.stack).join('\n'));
  assert.equal(h.w.document.querySelectorAll('iframe').length,0,suite.id+' eagerly creates worker');
  console.log('PASS runtime '+suite.id);
 }finally{h.close();}}
