import { buildSync } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(root + '/master-entry.mjs', 'utf8');
const version = source.match(/const VERSION = '([^']+)'/)[1];
const metadata = `// ==UserScript==
// @name         V4 FCResearch Master
// @namespace    https://github.com/1Sirkkris/tampermonkey-v4
// @version      ${version}
// @description  Independent native FCR sections; development checkpoint, full Master parity pending.
// @match        http://fcresearch-fe.aka.amazon.com/*
// @match        https://fcresearch-fe.aka.amazon.com/*
// @match        http://qi-fcresearch-fe.corp.amazon.com/*
// @match        https://qi-fcresearch-fe.corp.amazon.com/*
// @match        http://qi-fcresearch-jp.corp.amazon.com/*
// @match        https://qi-fcresearch-jp.corp.amazon.com/*
// @match        http://qifcr.fe.aftx.amazonoperations.app/*
// @match        https://qifcr.fe.aftx.amazonoperations.app/*
// @match        https://jp.item-measurement.aft.a2z.com/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_xmlhttpRequest
// @connect      aft-poirot-website-nrt.nrt.proxy.amazon.com
// @connect      pandash.amazon.com
// @connect      o0avbo02yl.execute-api.ap-northeast-1.amazonaws.com
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/FCResearch_Master.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/FCResearch_Master.user.js
// ==/UserScript==`;
export function masterBuild() {
  return buildSync({ entryPoints: [root + '/master-entry.mjs'], bundle: true, write: false, format: 'iife', target: 'es2022',
    legalComments: 'none', banner: { js: metadata }, charset: 'utf8' }).outputFiles[0].text;
}
export function obsBuild() {
  const obsSource = readFileSync(root + '/obs-entry.mjs', 'utf8');
  const version = obsSource.match(/const VERSION = '([^']+)'/)[1];
  const banner = readFileSync(root + '/obs-metadata.txt', 'utf8').replace('${version}', version);
  return buildSync({ entryPoints: [root + '/obs-entry.mjs'], bundle: true, write: false, format: 'iife', target: 'es2022', legalComments: 'none', banner: { js: banner }, charset: 'utf8' }).outputFiles[0].text;
}
const fcrMatches = ['http://fcresearch-fe.aka.amazon.com/*','https://fcresearch-fe.aka.amazon.com/*','http://qi-fcresearch-fe.corp.amazon.com/*','https://qi-fcresearch-fe.corp.amazon.com/*','http://qi-fcresearch-jp.corp.amazon.com/*','https://qi-fcresearch-jp.corp.amazon.com/*','http://qifcr.fe.aftx.amazonoperations.app/*','https://qifcr.fe.aftx.amazonoperations.app/*'].map(url=>'@match '+url);
const additional = [
  {file:'Sideline_Queue_Lazy.user.js',entry:'sideline-entry.mjs',name:'V4 Sideline Queue + Lazy',description:'Native Queue/Lazy/QTY scanners, preflight, expiry and durable outcome recovery.',extra:['@match https://aft-poirot-website-nrt.nrt.proxy.amazon.com/*','@grant unsafeWindow','@grant GM_xmlhttpRequest','@connect pandash.amazon.com']},
  {file:'Stow_Andons_Helper.user.js',entry:'stow-entry.mjs',name:'V4 Stow Andons Helper',description:'Native inline drop controls, product warnings and origin-owned operation workers.',extra:[...fcrMatches,'@match https://aft-moveapp-nrt-nrt.nrt.proxy.amazon.com/move-container*','@match https://tx-b-hierarchy-nrt.nrt.proxy.amazon.com/unbindHierarchy*','@grant unsafeWindow','@grant GM_xmlhttpRequest','@connect localhost','@connect aft-moveapp-nrt-nrt.nrt.proxy.amazon.com',...['fcresearch-fe.aka.amazon.com','qi-fcresearch-fe.corp.amazon.com','qi-fcresearch-jp.corp.amazon.com','qifcr.fe.aftx.amazonoperations.app'].map(host=>'@connect '+host)]},
  {file:'Dropzone_Selector_Queue.user.js',entry:'drop-entry.mjs',name:'V4 Dropzone Selector Queue',description:'Native dropzones, durable queue and exact native destination verification.',extra:['@include /^https?:\\/\\/aft-moveapp-[^\\/.]+(?:\\.nrt)?\\.proxy\\.amazon\\.com\\/move-container(?:[\\/?#]|$)/','@grant unsafeWindow','@grant GM_xmlhttpRequest','@connect aft-moveapp-nrt-nrt.nrt.proxy.amazon.com',...['fcresearch-fe.aka.amazon.com','qi-fcresearch-fe.corp.amazon.com','qi-fcresearch-jp.corp.amazon.com','qifcr.fe.aftx.amazonoperations.app'].map(host=>'@connect '+host)]},
  ...['bind','unbind'].map(mode=>({file:(mode==='bind'?'Bind':'Unbind')+'_Hierarchy_Queue.user.js',entry:mode+'-entry.mjs',name:'V4 '+(mode==='bind'?'Bind':'Unbind')+' Hierarchy',description:'Native hierarchy queue with durable submission barriers and one batch owner.',extra:['@match https://tx-b-hierarchy-nrt.nrt.proxy.amazon.com/'+mode+'Hierarchy*','@grant unsafeWindow']})),
  {file:'FNSKU_Mapping_Lookup.user.js',entry:'fnsku-entry.mjs',name:'V4 FNSKU Mapping',description:'Exact regional native mapping lookup with partial-result provenance.',extra:['@match https://fba-fnsku-commingling-console-na.aka.amazon.com/tool/fnsku-mappings-tool*','@match https://fba-fnsku-commingling-console-eu.aka.amazon.com/tool/fnsku-mappings-tool*','@match https://fba-fnsku-commingling-console-jp.aka.amazon.com/tool/fnsku-mappings-tool*','@grant GM_xmlhttpRequest',...['na','eu','jp'].map(region=>'@connect fba-fnsku-commingling-console-'+region+'.aka.amazon.com')]},
  {file:'Bin_Check_Overlay.user.js',entry:'bin-entry.mjs',name:'V4 Bin Check Overlay',description:'Native filtered inventory snapshot and P-level floor overlay.',extra:[...fcrMatches,'@grant unsafeWindow']},
  { file: 'FC_Lite.user.js', entry: 'tote-entry.mjs', name: 'V4 Tote Audit', description: 'Independent FC-Lite Tote Audit; complete inventory and physical scans.', extra: [
    '@match http://fcresearch-fe.aka.amazon.com/*', '@match https://fcresearch-fe.aka.amazon.com/*',
    '@match http://qi-fcresearch-fe.corp.amazon.com/*', '@match https://qi-fcresearch-fe.corp.amazon.com/*',
    '@match http://qi-fcresearch-jp.corp.amazon.com/*', '@match https://qi-fcresearch-jp.corp.amazon.com/*',
    '@match http://qifcr.fe.aftx.amazonoperations.app/*', '@match https://qifcr.fe.aftx.amazonoperations.app/*',
    '@match https://jp.item-measurement.aft.a2z.com/*', '@grant unsafeWindow', '@grant GM_getValue', '@grant GM_setValue',
    '@grant GM_addValueChangeListener', '@grant GM_removeValueChangeListener', '@grant GM_xmlhttpRequest',
    '@connect aft-poirot-website-nrt.nrt.proxy.amazon.com', '@connect pandash.amazon.com', '@connect o0avbo02yl.execute-api.ap-northeast-1.amazonaws.com'
  ] }
];
export function additionalBuild(spec) {
  const version = readFileSync(root + '/' + spec.entry, 'utf8').match(/const VERSION = '([^']+)'/)[1];
  const url = 'https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/' + spec.file;
  const header = ['==UserScript==', '@name ' + spec.name, '@namespace https://github.com/1Sirkkris/tampermonkey-v4', '@version ' + version,
    '@description ' + spec.description, ...spec.extra, '@run-at document-start', '@updateURL ' + url, '@downloadURL ' + url, '==/UserScript=='].map(line=>'// '+line).join('\n');
  return buildSync({entryPoints:[root+'/'+spec.entry],bundle:true,write:false,format:'iife',target:'es2022',legalComments:'none',banner:{js:header},charset:'utf8'}).outputFiles[0].text;
}
function installers() { return [['FCResearch_Master.user.js',masterBuild()],['OBS.user.js',obsBuild()],...additional.map(spec=>[spec.file,additionalBuild(spec)])]; }
if (process.argv.includes('--check')) {
  for(const [name,source] of installers()) if(readFileSync(root+'/'+name,'utf8')!==source)throw new Error(name+' installer is stale: npm run build');
  console.log('PASS: all generated installers match canonical source');
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Build every output successfully before replacing any existing candidate.
  for(const [name,source] of installers())writeFileSync(root+'/'+name,source);
  console.log('Built all V4 installers');
}
