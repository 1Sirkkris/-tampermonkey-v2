import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'build','manifest.json'),'utf8'));
const check=process.argv.includes('--check');

const hash=text=>{let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(16).padStart(8,'0');};
const meta=(k,v)=>'// @'+k.padEnd(13,' ')+v;
function header(entry,buildId){
  const out=['// ==UserScript==',meta('name',entry.name),meta('name:en',entry.name),meta('namespace',entry.namespace),meta('version',entry.version),meta('description',entry.description)];
  for(const v of entry.include||[])out.push(meta('include',v));
  for(const v of entry.match||[])out.push(meta('match',v));
  for(const v of entry.exclude||[])out.push(meta('exclude',v));
  out.push(meta('run-at',entry.runAt||'document-body'));
  if(entry.noframes)out.push('// @noframes');
  for(const v of entry.grant||[])out.push(meta('grant',v));
  for(const v of entry.connect||[])out.push(meta('connect',v));
  out.push(meta('updateURL',entry.updateURL),meta('downloadURL',entry.downloadURL),meta('v3-build',buildId),'// ==/UserScript==');
  return out.join('\n');
}
fs.mkdirSync(path.join(root,'dist'),{recursive:true});
let stale=false;
for(const entry of manifest.suites){
  const chunks=entry.sources.map(rel=>'// ---- '+rel+' ----\n'+fs.readFileSync(path.join(root,rel),'utf8').trim()).join('\n\n');
  const buildId=entry.id+'-'+entry.version+'-'+hash(chunks);
  const body=header(entry,buildId)+"\n\n(()=>{\n'use strict';\nconst V3=Object.create(null);\nV3.build=Object.freeze("+JSON.stringify({id:buildId,version:entry.version})+");\n\n"+chunks+"\n\nif(typeof V3.boot!=='function')throw new Error('V3 boot missing');\nV3.boot();\n})();\n";
  const out=path.join(root,'dist',entry.output);
  if(check){const old=fs.existsSync(out)?fs.readFileSync(out,'utf8'):'';if(old!==body){console.error('STALE '+entry.output);stale=true;}else console.log('PASS '+entry.output+' '+buildId);}
  else{fs.writeFileSync(out,body);console.log('BUILD '+entry.output+' '+buildId);}
}
if(stale)process.exit(1);
