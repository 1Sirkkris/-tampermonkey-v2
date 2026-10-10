import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const source = readFileSync(new URL('../diagnostics/FCR_Native_Capture.user.js', import.meta.url), 'utf8');
const jwt = 'eyJabcdefghij.abcdefghijkl.signature';
function setup(t, options = {}) {
  const dom = new JSDOM(options.html || '<input name="csrfToken" value="private"><input name="s" value="B012345678"><script src="/native-renderer.js"></script><script>const idToken="' + jwt + '"; window.shouldNeverRun=1;</script>',
    { url: options.url || 'https://fcresearch-fe.aka.amazon.com/BWU2/results?s=B012345678&token=private', runScripts: 'outside-only' }); const w = dom.window;
  const calls = [], blobs = []; let menu, downloads = 0; w.Blob = Blob;
  w.GM_registerMenuCommand = (_label, callback) => { menu = callback; };
  w.URL.createObjectURL = blob => { blobs.push(blob); return 'blob:diagnostic'; }; w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () { downloads++; };
  w.fetch = async (url, init) => { calls.push({ url, ...init }); return options.fetch ? options.fetch(url, init) : new Response('window.nativeRenderer=function(html){ return html; };'); };
  w.alert = options.alert || (message => { throw new Error(message); }); w.eval(source);
  t.after(() => { w.dispatchEvent(new w.Event('pagehide')); w.close(); });
  return { w, calls, blobs, menu: () => menu(), downloads: () => downloads };
}
test('capture is inert until the menu action; downloads native HTML/JS without executing source or collecting credentials', async t => {
  const app = setup(t); assert.equal(app.calls.length, 0); assert.equal(app.downloads(), 0);
  await app.menu(); const result = JSON.parse(await app.blobs[0].text());
  assert.equal(app.calls.length, 1); assert.equal(app.calls[0].method, 'GET'); assert.equal(app.calls[0].credentials, 'same-origin');
  assert.equal(app.downloads(), 1); assert.equal(app.w.shouldNeverRun, undefined); assert.equal(app.w.nativeRenderer, undefined);
  assert.match(result.scripts[0].source, /nativeRenderer/); assert(!JSON.stringify(result).includes(jwt)); assert(!JSON.stringify(result).includes('private'));
  assert.match(result.html, /B012345678/); assert.equal(result.version, '0.1.2');
});
test('missing native script source is explicit and concurrent menu actions do not duplicate the capture', async t => {
  let answer; const app = setup(t, { fetch: () => new Promise(resolve => { answer = resolve; }) });
  const first = app.menu(); await app.menu(); assert.equal(app.calls.length, 1);
  answer(new Response('Sign in', { status: 403 })); await first;
  const result = JSON.parse(await app.blobs[0].text()); assert.match(result.scripts[0].error, /HTTP/); assert.equal(result.scripts[0].source, '');
});
test('pagehide cancels owned read-only capture and suppresses a late download', async t => {
  let answer; const app = setup(t, { fetch: () => new Promise(resolve => { answer = resolve; }) });
  const first = app.menu(); app.w.dispatchEvent(new app.w.Event('pagehide')); assert.equal(app.calls[0].signal.aborted, true);
  answer(new Response('native source')); await first; assert.equal(app.downloads(), 0);
});

test('diagnostic has one true-version shared footer, deduplicates startup and restores after BFCache without background reads',t=>{const app=setup(t);app.w.eval(source);assert.equal(app.calls.length,0);assert.equal(app.w.document.querySelectorAll('#tm-v4-runtime-watermark').length,1);assert.match(app.w.document.querySelector('#tm-v4-runtime-watermark').textContent,/V4 FCAP: 0.1.2/);app.w.dispatchEvent(new app.w.Event('pagehide'));assert.equal(app.w.document.querySelector('#tm-v4-runtime-watermark'),null);app.w.dispatchEvent(new app.w.PageTransitionEvent('pageshow',{persisted:true}));assert.match(app.w.document.querySelector('#tm-v4-runtime-watermark').textContent,/V4 FCAP: 0.1.2/);assert.equal(app.calls.length,0);});

test('generated diagnostic supports native AFT/MoveContainer metadata and performs only asset GETs with no native form actions',async t=>{
 const includes=[...source.matchAll(/^\/\/ @include (.+)$/gm)].map(match=>new RegExp(match[1].slice(1,-1)));
 for(const [workflow,url] of [
  ['AFT','https://aft-qt-jp.aka.nrt.corp.amazon.com/app/edititems'],
  ['AFT','https://aft-qt-jp.aka.nrt.corp.amazon.com/app/moveitems'],
  ['AFT','https://aft-qt-jp.aka.nrt.corp.amazon.com/app/fcskuflip'],
  ['MoveContainer','https://aft-moveapp-nrt-nrt.nrt.proxy.amazon.com/move-container']
 ]){
  assert(includes.some(pattern=>pattern.test(url)),url+' metadata');
  const app=setup(t,{url,html:'<form><input id="native" value="tsXprivate123"><button id="complete">Confirm</button></form><script src="/native.js"></script>'});let nativeEvents=0;
  app.w.document.querySelector('form').addEventListener('submit',()=>nativeEvents++);app.w.document.querySelector('#complete').addEventListener('click',()=>nativeEvents++);app.w.document.querySelector('input').addEventListener('input',()=>nativeEvents++);
  assert.equal(app.calls.length,0);await app.menu();const result=JSON.parse(await app.blobs[0].text());
  assert.equal(result.workflow,workflow);assert.equal(nativeEvents,0);assert.equal(app.w.document.querySelector('input').value,'tsXprivate123');
  assert.equal(app.calls.length,1);assert.equal(app.calls[0].method,'GET');assert(!app.calls[0].url.includes('/api/'));assert.match(result.limits.join(' '),/not operation/);
 }
});

test('native snapshots mask unlabeled passwords, identity fields, meta secrets and bearer tokens; container aliases correlate without exporting values',async t=>{
 const app=setup(t,{url:'https://aft-moveapp-nrt-nrt.nrt.proxy.amazon.com/move-container?s=tsXprivate123&sessionId=confidential',
  html:'<meta name="csrfToken" content="confidential"><input type="password" value="confidential"><input name="employeeLogin" value="confidential"><textarea name="accessToken">confidential</textarea><select name="employeeId"><option>confidential</option></select><input value="tsXprivate123"><div>TSXPRIVATE123</div><script>const destination="csXprivate456";const sessionId="confidential";const userLogin="confidential";const header="Bearer abcdefghijk987";</script><aside data-tm-v4-script="TEST">V4 owned UI</aside>'});
 await app.menu();const result=JSON.parse(await app.blobs[0].text()),json=JSON.stringify(result);
 assert(!/confidential|private123|private456|abcdefghijk987/i.test(json));assert(!result.html.includes('V4 owned UI'));assert.equal(app.calls.length,0);
 const pageCode=new URL(result.page).searchParams.get('s');assert.match(pageCode,/^tsXCAPTURE/);assert.equal(result.html.split(pageCode).length-1,2);assert(result.scripts[0].source.includes('csXCAPTURE'));
 assert.equal(app.w.document.querySelector('input[type=password]').value,'confidential');
});

test('native route navigation cancels a pending capture, removes stale footer and refuses unsupported-route collection',async t=>{
 let answer;const alerts=[];const app=setup(t,{url:'https://aft-qt-jp.aka.nrt.corp.amazon.com/app/edititems',fetch:()=>new Promise(resolve=>answer=resolve),alert:message=>alerts.push(message)});
 const capture=app.menu();app.w.history.pushState({},'','/outside');app.w.dispatchEvent(new app.w.PopStateEvent('popstate'));
 assert.equal(app.calls[0].signal.aborted,true);assert.equal(app.w.document.querySelector('#tm-v4-runtime-watermark'),null);answer(new Response('native'));await capture;
 assert.equal(app.downloads(),0);assert.equal(alerts.length,0);await app.menu();assert.match(alerts[0],/unavailable/);assert.equal(app.calls.length,1);
 app.w.history.pushState({},'','/app/moveitems');app.w.dispatchEvent(new app.w.PopStateEvent('popstate'));assert.match(app.w.document.querySelector('#tm-v4-runtime-watermark').textContent,/V4 FCAP: 0.1.2/);
});

test('redirected or oversized script assets remain explicit errors and never become usable native source',async t=>{
 const app=setup(t,{fetch:async()=>({ok:true,redirected:true,url:'https://fcresearch-fe.aka.amazon.com/auth',headers:new Headers(),text:async()=> 'native'})});await app.menu();
 const result=JSON.parse(await app.blobs[0].text());assert.equal(result.scripts[0].source,'');assert.match(result.scripts[0].error,/redirect/);assert.equal(app.downloads(),1);
 const oversized=setup(t,{fetch:async()=>new Response('x'.repeat(4000001))});await oversized.menu();const second=JSON.parse(await oversized.blobs[0].text());assert.equal(second.scripts[0].source,'');assert.match(second.scripts[0].error,/limit/);
});
