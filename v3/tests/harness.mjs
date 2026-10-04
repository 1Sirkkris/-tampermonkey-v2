import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const source=file=>fs.readFileSync(path.join(root,'src',file),'utf8');
export function storage(){const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),clear:()=>values.clear(),values};}
export function locks(){const active=new Set();return {async request(name,options,callback){if(active.has(name))return callback(null);active.add(name);try{return await callback({name});}finally{active.delete(name);}},active};}
export function harness({url='https://example.amazon.com/',html='',sharedStorage=storage(),sharedLocks=locks(),modules=['core.js','state.js','transport.js','identity.js','native.js']}={}){
 const dom=new JSDOM('<!doctype html><html><head></head><body><main id="root">'+html+'</main></body></html>',{url,runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window;
 Object.defineProperty(w,'localStorage',{value:sharedStorage});Object.defineProperty(w.navigator,'locks',{value:sharedLocks});w.structuredClone=structuredClone;w.CSS={escape:value=>String(value).replace(/[^A-Za-z0-9_-]/g,char=>'\\'+char)};
 w.HTMLElement.prototype.getBoundingClientRect=function(){const hidden=this.closest('[hidden]');return {width:hidden?0:100,height:hidden?0:20,top:0,left:0,bottom:20,right:100};};
 w.fetch=async()=>{throw new Error('Unexpected network in fixture');};const gm=new Map();w.GM_getValue=(key,initial)=>gm.get(key)??initial;w.GM_setValue=(key,value)=>gm.set(key,value);w.GM_listValues=()=>[...gm.keys()];w.GM_deleteValue=key=>gm.delete(key);w.GM_registerMenuCommand=()=>{};w.GM_setClipboard=()=>{};w.GM_openInTab=()=>{};w.unsafeWindow=w;w.alert=()=>{};
 w.eval('window.V3={build:{version:"0.2.0"}}');for(const file of modules)w.eval(source(file));
 return {w,V3:w.V3,dom,sharedStorage,sharedLocks,close:()=>{w.dispatchEvent(new w.Event('pagehide'));dom.window.close();},load:file=>w.eval(source(file))};
}
export const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
