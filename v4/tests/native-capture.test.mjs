import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const source = readFileSync(new URL('../diagnostics/FCR_Native_Capture.user.js', import.meta.url), 'utf8');
const jwt = 'eyJabcdefghij.abcdefghijkl.signature';
function setup(t, options = {}) {
  const dom = new JSDOM(options.html || '<input name="csrfToken" value="private"><input name="s" value="B012345678"><script src="/native-renderer.js"></script><script>const idToken="' + jwt + '"; window.shouldNeverRun=1;</script>',
    { url: options.url || 'https://fcresearch-fe.aka.amazon.com/BWU2/results?s=B012345678&token=private', runScripts: 'outside-only' }); const w = dom.window;
  const calls = [], blobs = [], menus = new Map(); let menu, downloads = 0; w.Blob = Blob; w.TextDecoder = TextDecoder;
  w.GM_registerMenuCommand = (label, callback) => { menus.set(label, callback); if (label.startsWith('Capture native contract')) menu = callback; };
  w.URL.createObjectURL = blob => { blobs.push(blob); return 'blob:diagnostic'; }; w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () { downloads++; };
  w.fetch = async (url, init) => { calls.push({ url, ...init }); return options.fetch ? options.fetch(url, init) : new Response('window.nativeRenderer=function(html){ return html; };'); };
  w.alert = options.alert || (message => { throw new Error(message); }); if (options.page) w.unsafeWindow = options.page; w.eval(source);
  t.after(() => { w.dispatchEvent(new w.Event('pagehide')); w.close(); });
  return { w, calls, blobs, menu: () => menu(), menus, downloads: () => downloads };
}
test('capture is inert until the menu action; downloads native HTML/JS without executing source or collecting credentials', async t => {
  const app = setup(t); assert.equal(app.calls.length, 0); assert.equal(app.downloads(), 0);
  await app.menu(); const result = JSON.parse(await app.blobs[0].text());
  assert.equal(app.calls.length, 1); assert.equal(app.calls[0].method, 'GET'); assert.equal(app.calls[0].credentials, 'same-origin');
  assert.equal(app.downloads(), 1); assert.equal(app.w.shouldNeverRun, undefined); assert.equal(app.w.nativeRenderer, undefined);
  assert.match(result.scripts[0].source, /nativeRenderer/); assert(!JSON.stringify(result).includes(jwt)); assert(!JSON.stringify(result).includes('private'));
  assert.match(result.html, /B012345678/); assert.equal(result.version, '0.1.3');
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

test('diagnostic has one true-version shared footer, deduplicates startup and restores after BFCache without background reads',t=>{const app=setup(t);app.w.eval(source);assert.equal(app.calls.length,0);assert.equal(app.w.document.querySelectorAll('#tm-v4-runtime-watermark').length,1);assert.match(app.w.document.querySelector('#tm-v4-runtime-watermark').textContent,/V4 FCAP: 0.1.3/);app.w.dispatchEvent(new app.w.Event('pagehide'));assert.equal(app.w.document.querySelector('#tm-v4-runtime-watermark'),null);app.w.dispatchEvent(new app.w.PageTransitionEvent('pageshow',{persisted:true}));assert.match(app.w.document.querySelector('#tm-v4-runtime-watermark').textContent,/V4 FCAP: 0.1.3/);assert.equal(app.calls.length,0);});

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
 app.w.history.pushState({},'','/app/moveitems');app.w.dispatchEvent(new app.w.PopStateEvent('popstate'));assert.match(app.w.document.querySelector('#tm-v4-runtime-watermark').textContent,/V4 FCAP: 0.1.3/);
});

test('redirected or oversized script assets remain explicit errors and never become usable native source',async t=>{
 const app=setup(t,{fetch:async()=>({ok:true,redirected:true,url:'https://fcresearch-fe.aka.amazon.com/auth',headers:new Headers(),text:async()=> 'native'})});await app.menu();
 const result=JSON.parse(await app.blobs[0].text());assert.equal(result.scripts[0].source,'');assert.match(result.scripts[0].error,/redirect/);assert.equal(app.downloads(),1);
 const oversized=setup(t,{fetch:async()=>new Response('x'.repeat(4000001))});await oversized.menu();const second=JSON.parse(await oversized.blobs[0].text());assert.equal(second.scripts[0].source,'');assert.match(second.scripts[0].error,/limit/);
});

const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
const traceMenu = (app, prefix) => [...app.menus].find(([label]) => label.startsWith(prefix))[1]();

test('generated diagnostic trace is opt-in on native page transport and exports correlated responses without initiating an action', async t => {
  let nativeCalls = 0, submitted = 0; const alerts = [], page = {
    fetch: function (_url, init) { nativeCalls++; assert.equal(init.body, '{"objectId":"opaque","action":"Confirm","container":"tsXPRIVATE"}'); return Promise.resolve(new Response('{"objectId":"opaque","status":"WAITING","container":"tsXPRIVATE","employeeId":54321}')); }
  }, original = page.fetch;
  const app = setup(t, { page, alert: message => alerts.push(message), url: 'https://aft-qt-jp.aka.nrt.corp.amazon.com/app/edititems', html: '<form><input value="tsXPRIVATE"><button>Confirm</button></form>' });
  app.w.document.querySelector('form').addEventListener('submit', () => submitted++);
  assert.equal(app.menus.size, 3); assert.equal(page.fetch, original); assert.equal(nativeCalls, 0); assert.equal(app.calls.length, 0);
  traceMenu(app, 'Start passive'); const wrapper = page.fetch; traceMenu(app, 'Start passive'); assert.equal(page.fetch, wrapper); assert.match(alerts.at(-1), /already active/);
  await page.fetch('/action', { method: 'POST', body: '{"objectId":"opaque","action":"Confirm","container":"tsXPRIVATE"}' }); await tick();
  traceMenu(app, 'Stop and export'); const result = JSON.parse(await app.blobs[0].text());
  assert.equal(result.version, '0.1.3'); assert.equal(result.workflow, 'AFT'); assert.equal(result.records[0].response.state, 'CAPTURED');
  assert.equal(page.fetch, original); assert.equal(nativeCalls, 1); assert.equal(submitted, 0); assert.equal(app.calls.length, 0); assert.equal(app.downloads(), 1);
  assert(!/opaque|tsXPRIVATE|54321/i.test(JSON.stringify(result))); assert.equal(app.w.document.querySelector('input').value, 'tsXPRIVATE');
});

test('generated trace navigation/pagehide restores transports, discards evidence and suppresses late export; BFCache starts inert', async t => {
  let resolve; const alerts = [], app = setup(t, { alert: text => alerts.push(text), url: 'https://aft-qt-jp.aka.nrt.corp.amazon.com/app/moveitems', fetch: () => new Promise(answer => resolve = answer) });
  const original = app.w.fetch; traceMenu(app, 'Start passive'); const pending = app.w.fetch('/status', { method: 'POST', body: '{}' });
  app.w.history.pushState({}, '', '/app/edititems'); app.w.dispatchEvent(new app.w.PopStateEvent('popstate')); assert.equal(app.w.fetch, original);
  resolve(new Response('{"status":"READY"}')); await pending; await tick(); traceMenu(app, 'Stop and export'); assert.match(alerts.at(-1), /No native trace/); assert.equal(app.downloads(), 0);
  traceMenu(app, 'Start passive'); assert.notEqual(app.w.fetch, original); app.w.dispatchEvent(new app.w.Event('pagehide')); assert.equal(app.w.fetch, original);
  app.w.dispatchEvent(new app.w.PageTransitionEvent('pageshow', { persisted: true })); assert.equal(app.w.fetch, original); assert.equal(app.calls.length, 1);
  assert.match(app.w.document.querySelector('#tm-v4-runtime-watermark').textContent, /V4 FCAP: 0.1.3/);
});

test('generated MoveContainer trace captures one existing native request and export metadata; Stop is not a movement retry', async t => {
  const alerts = [], app = setup(t, { alert: message => alerts.push(message), url: 'https://aft-moveapp-nrt-nrt.nrt.proxy.amazon.com/move-container', html: '<input value="tsXPRIVATE">', fetch: () => Promise.resolve(new Response('{"status":"PENDING","containerScannableId":"tsXPRIVATE"}')) });
  traceMenu(app, 'Start passive'); await app.w.fetch('/api/move-container', { method: 'POST', body: '{"containerScannableId":"tsXPRIVATE","destinationScannableId":"dz-P-PRIME","confirmed":"true"}' }); await tick();
  traceMenu(app, 'Stop and export'); const result = JSON.parse(await app.blobs[0].text()); assert.equal(result.records.length, 1); assert.equal(app.calls.length, 1);
  assert.equal(JSON.parse(result.records[0].response.body).status, 'PENDING'); assert.match(result.warnings.join(' '), /never automatic confirmation/); assert(!JSON.stringify(result).includes('tsXPRIVATE'));
  traceMenu(app, 'Stop and export'); assert.equal(app.calls.length, 1); assert.equal(app.downloads(), 1); assert.match(alerts.at(-1), /No native trace/);
});
