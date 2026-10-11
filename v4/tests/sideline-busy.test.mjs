import test from'node:test';import assert from'node:assert/strict';import{JSDOM}from'jsdom';import{readFileSync}from'node:fs';import{createSidelineUi}from'../sideline-runtime.mjs';
const tick=async()=>{for(let i=0;i<3;i++)await new Promise(r=>setTimeout(r,0));};
for(const installer of [false,true])test('Sideline '+(installer?'installer':'source')+' paints accepted START before ownership',async t=>{
 const w=new JSDOM('<head></head><body><main>Scan item</main></body>',{url:'https://aft-poirot-website-nrt.nrt.proxy.amazon.com/',runScripts:'outside-only'}).window;t.after(()=>w.close());let grant,calls=0,api;
 w.navigator.locks={request:(n,o,work)=>new Promise((resolve,reject)=>grant=()=>Promise.resolve(work({name:n})).then(resolve,reject))};
 if(installer){w.unsafeWindow=w;w.fetch=()=>{calls++;throw new Error('No cancelled request');};w.GM_xmlhttpRequest=()=>{};w.eval(readFileSync(new URL('../Sideline_Queue_Lazy.user.js',import.meta.url),'utf8'));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));await tick();}else api=createSidelineUi({window:w,version:'test',preflight:async()=>{throw new Error('cancelled');},client:{bootstrap:async()=>{calls++;}}});
 const panel=w.document.querySelector('#tm-v4-side-lazy'),fields=Object.fromEntries([...panel.querySelectorAll('[data-field]')].map(n=>[n.dataset.field,n]));fields.source.value='tsXone';fields.destination.value='tsXtwo';fields.items.value='X000000001\n123START';fields.items.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
 const disabled=panel.querySelector('[data-action=run]').disabled,status=panel.querySelector('[data-status]').textContent;
 panel.querySelector('[data-action=stop]').click();await tick();grant();await tick();api?.dispose();w.dispatchEvent(new w.Event('pagehide'));assert.equal(calls,0);assert.equal(disabled,true);assert.match(status,/Waiting|START|Starting/i);
});
