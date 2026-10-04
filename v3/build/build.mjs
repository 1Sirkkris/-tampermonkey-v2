import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'build','manifest.json'),'utf8'));
const check=process.argv.includes('--check');
const meta=(key,value)=>'// @'+key.padEnd(13,' ')+value;
const fnv=text=>{let hash=2166136261;for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}return(hash>>>0).toString(16).padStart(8,'0');};

function header(entry,buildId){
  const out=['// ==UserScript==',meta('name',entry.name),meta('name:en',entry.name),meta('namespace',entry.namespace),meta('version',entry.version),meta('description',entry.description)];
  for(const value of entry.include||[])out.push(meta('include',value));
  for(const value of entry.match||[])out.push(meta('match',value));
  for(const value of entry.exclude||[])out.push(meta('exclude',value));
  out.push(meta('run-at',entry.runAt||'document-body'));
  if(entry.noframes)out.push('// @noframes');
  for(const value of entry.grant||[])out.push(meta('grant',value));
  for(const value of entry.connect||[])out.push(meta('connect',value));
  out.push(meta('updateURL',entry.updateURL),meta('downloadURL',entry.downloadURL),'// @v3-build     '+buildId,'// ==/UserScript==');
  return out.join('\n');
}

function generate(entry){
  const parts=entry.sources.map(rel=>{
    const full=path.join(root,rel);
    if(!fs.existsSync(full))throw new Error(entry.id+': missing '+rel);
    return '// ---- '+rel+' ----\n'+fs.readFileSync(full,'utf8').trim();
  });
  const joined=parts.join('\n\n'),buildId=entry.id+'-'+entry.version+'-'+fnv(joined);
  const body=header(entry,buildId)+'\n\n(()=>{\n\'use strict\';\nconst V3=Object.create(null);\nV3.build=Object.freeze('+JSON.stringify({id:buildId,version:entry.version,suite:entry.id})+');\n\n'+joined+'\n\nif(typeof V3.boot!==\'function\')throw new Error(\'V3 boot missing\');\nV3.boot();\n})();\n';
  new Function(body);
  return{body,buildId};
}

let failed=false;
for(const entry of manifest.suites){
  const {body,buildId}=generate(entry),output=path.join(root,'dist',entry.output);
  if(check){
    const current=fs.existsSync(output)?fs.readFileSync(output,'utf8'):'';
    if(current!==body){console.error('STALE '+entry.output);failed=true;}else console.log('PASS '+entry.output+' '+buildId);
  }else{
    fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,body);console.log('BUILD '+entry.output+' '+buildId);
  }
}
if(failed)process.exit(1);
