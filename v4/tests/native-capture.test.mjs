import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const source = readFileSync(new URL('../diagnostics/FCR_Native_Capture.user.js', import.meta.url), 'utf8');
const jwt = 'eyJabcdefghij.abcdefghijkl.signature';
function setup(t, options = {}) {
  const dom = new JSDOM('<input name="csrfToken" value="private"><input name="s" value="B012345678"><script src="/native-renderer.js"></script><script>const idToken="' + jwt + '"; window.shouldNeverRun=1;</script>',
    { url: 'https://fcresearch-fe.aka.amazon.com/BWU2/results?s=B012345678&token=private', runScripts: 'outside-only' }); const w = dom.window;
  const calls = [], blobs = []; let menu, downloads = 0; w.Blob = Blob;
  w.GM_registerMenuCommand = (_label, callback) => { menu = callback; };
  w.URL.createObjectURL = blob => { blobs.push(blob); return 'blob:diagnostic'; }; w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () { downloads++; };
  w.fetch = async (url, init) => { calls.push({ url, ...init }); return options.fetch ? options.fetch(url, init) : new Response('window.nativeRenderer=function(html){ return html; };'); };
  w.alert = message => { throw new Error(message); }; w.eval(source);
  t.after(() => { w.dispatchEvent(new w.Event('pagehide')); w.close(); });
  return { w, calls, blobs, menu: () => menu(), downloads: () => downloads };
}
test('capture is inert until the menu action; downloads native HTML/JS without executing source or collecting credentials', async t => {
  const app = setup(t); assert.equal(app.calls.length, 0); assert.equal(app.downloads(), 0);
  await app.menu(); const result = JSON.parse(await app.blobs[0].text());
  assert.equal(app.calls.length, 1); assert.equal(app.calls[0].method, 'GET'); assert.equal(app.calls[0].credentials, 'same-origin');
  assert.equal(app.downloads(), 1); assert.equal(app.w.shouldNeverRun, undefined); assert.equal(app.w.nativeRenderer, undefined);
  assert.match(result.scripts[0].source, /nativeRenderer/); assert(!JSON.stringify(result).includes(jwt)); assert(!JSON.stringify(result).includes('private'));
  assert.match(result.html, /B012345678/); assert.equal(result.version, '0.1.0');
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
