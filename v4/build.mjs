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
if (process.argv.includes('--check')) {
  if (readFileSync(root + '/FCResearch_Master.user.js', 'utf8') !== masterBuild()) throw new Error('Master installer is stale: npm run build');
  console.log('PASS: Master installer matches canonical source');
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(root + '/FCResearch_Master.user.js', masterBuild());
  console.log('Built Master ' + version);
}
