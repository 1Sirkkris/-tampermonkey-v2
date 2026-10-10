import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createNativeContractTrace } from '../native-contract-trace.mjs';
import { createCaptureRedactor } from '../native-capture-redact.mjs';

const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
function setup(t, url = 'https://aft-qt-jp.aka.nrt.corp.amazon.com/app/edititems') {
  const dom = new JSDOM('<body><form><input value="tsXPRIVATE"><button>Confirm</button></form>', { url, runScripts: 'outside-only' });
  const w = dom.window; w.TextDecoder = TextDecoder; w.Blob = Blob;
  t.after(() => w.close()); return w;
}

test('passive fetch preserves exact Promise/arguments/body, correlates out-of-order replies and leaves native responses usable', async t => {
  const w = setup(t), calls = [], answers = [];
  w.fetch = function (...args) { calls.push({ receiver: this, args }); return new Promise(resolve => answers.push(resolve)); };
  const original = w.fetch, trace = createNativeContractTrace({ window: w, workflow: 'AFT', version: 'test' }); t.after(trace.dispose);
  assert.equal(calls.length, 0); const headers = { Authorization: 'secret header' };
  const firstInit = { method: 'POST', headers, body: JSON.stringify({ id: { objectId: 'opaque-work', instructionId: 'EditItems' }, action: 'Confirm', requestId: 'opaque-request', container: 'tsXPRIVATE', employeeId: 123456, accessToken: 'secret-token' }) };
  const a = w.fetch('/action', firstInit), b = w.fetch('/status', { method: 'POST', body: JSON.stringify({ id: { objectId: 'opaque-work', instructionId: 'EditItems' } }) });
  assert.equal(calls.length, 2); assert.equal(calls[0].receiver, w); assert.equal(calls[0].args[1], firstInit); assert.equal(calls[0].args[1].headers, headers);
  answers[1](new Response(JSON.stringify({ status: 'READY', objectId: 'opaque-work', container: 'TSXPRIVATE' })));
  answers[0](new Response(JSON.stringify({ status: 'WAITING', requestId: 'opaque-request', quantity: 7, sessionId: 'secret-session' })));
  assert.equal((await a).status, 200); assert.match(await (await b).text(), /opaque-work/); await tick();
  const result = trace.stop(), json = JSON.stringify(result);
  assert.equal(w.fetch, original); assert.equal(result.records.length, 2); assert.equal(result.records[0].url.endsWith('/action'), true);
  assert(!/secret|opaque-work|opaque-request|123456|tsXPRIVATE/i.test(json));
  const request = JSON.parse(result.records[0].request.body), action = JSON.parse(result.records[0].response.body), state = JSON.parse(result.records[1].response.body);
  assert.equal(request.id.instructionId, 'EditItems'); assert.equal(request.action, 'Confirm'); assert.equal(action.quantity, 7);
  assert.equal(request.id.objectId, state.objectId); assert.equal(request.requestId, action.requestId); assert.equal(request.container, state.container);
  assert.equal(result.records[0].response.state, 'CAPTURED'); assert.equal(calls.length, 2);
});

test('trace excludes assets, other origins, unsupported methods and endpoints without changing native errors or Request identity', async t => {
  const w = setup(t), calls = [], nativeError = new TypeError('private native error'); let nativePromise;
  w.fetch = (...args) => { calls.push(args); return nativePromise = args[0] === '/end' ? Promise.reject(nativeError) : Promise.resolve(new Response('{}')); };
  const trace = createNativeContractTrace({ window: w, workflow: 'AFT', version: 'test' }); t.after(trace.dispose);
  for (const [url, init] of [['/native.js', {}], ['https://unrelated.example/action', { method: 'POST' }], ['/action', { method: 'PUT' }], ['/unrelated', {}]]) await w.fetch(url, init);
  const request = new Request(w.location.origin + '/status', { method: 'POST', body: '{"objectId":"opaque"}' });
  const promise = w.fetch(request); assert.equal(promise, nativePromise); assert.equal(calls.at(-1)[0], request); await promise;
  const rejected = w.fetch('/end', { method: 'POST' }); assert.equal(rejected, nativePromise); await assert.rejects(rejected, error => error === nativeError); await tick();
  const result = trace.stop(); assert.equal(result.records.length, 2); assert.equal(calls.length, 6);
  assert.equal(result.records[0].request.state, 'UNAVAILABLE'); assert.equal(result.records[1].response.state, 'FAILED');
  assert(!JSON.stringify(result).includes('private native error')); assert.equal(request.bodyUsed, false);
});

test('FCR trace preserves hierarchy/location HTML while scrubbing form credentials and correlating container URL/form/response', async t => {
  const w = setup(t, 'https://fcresearch-fe.aka.amazon.com/BWU2/results?s=tsXPRIVATE'), calls = [];
  w.fetch = (...args) => { calls.push(args); return Promise.resolve(new Response('<table id="table-container-hierarchy"><tr><td>tsXPRIVATE</td><td>dz-P-PRIME</td></tr></table><input type="password" value="secret-password"><meta name="csrfToken" content="secret-token"><script type="a-state">{"objectId":"opaque","userId":9999}</script>')); };
  const trace = createNativeContractTrace({ window: w, workflow: 'FCR', version: 'test' }); t.after(trace.dispose);
  const init = { method: 'POST', body: new w.URLSearchParams({ s: 'tsXPRIVATE', csrfToken: 'secret-token' }) };
  await w.fetch('/BWU2/results/container-hierarchy-up?s=tsXPRIVATE', init); await tick();
  await w.fetch('/BWU2/results/product', init); await tick(); const result = trace.stop(), record = result.records[0];
  assert.equal(calls.length, 2); assert.equal(calls[0][1], init); assert.equal(result.records.length, 1);
  const code = new w.URL(record.url).searchParams.get('s'); assert.match(code, /^tsXCAPTURE/);
  assert(record.request.body.includes(code)); assert(record.response.body.includes(code)); assert(result.page.includes(code));
  assert.match(record.response.body, /table-container-hierarchy/); assert.match(record.response.body, /dz-P-PRIME/);
  assert(!/tsXPRIVATE|secret-password|secret-token|opaque|9999/i.test(JSON.stringify(result)));
});

test('Stop and disposal interrupt pending records, restore only owned hooks and never abort native requests or accept late bodies', async t => {
  const w = setup(t); let answer, calls = 0;
  w.fetch = () => { calls++; return new Promise(resolve => answer = resolve); }; const original = w.fetch;
  const trace = createNativeContractTrace({ window: w, workflow: 'AFT', version: 'test' }); t.after(trace.dispose);
  const pending = w.fetch('/action', { method: 'POST', body: '{}' }), hooked = w.fetch;
  const outer = function (...args) { return hooked.apply(this, args); }; w.fetch = outer;
  const result = trace.stop(); assert.equal(w.fetch, outer); assert.equal(result.records[0].response.state, 'INTERRUPTED');
  answer(new Response('{"status":"READY"}')); await pending; await tick(); assert.equal(result.records[0].response.state, 'INTERRUPTED');
  const unrecorded = w.fetch('/status', { method: 'POST' }); answer(new Response('{}')); await unrecorded; assert.equal(result.records.length, 1); assert.equal(calls, 2);
  trace.dispose(); assert.equal(result.records.length, 0); assert.notEqual(w.fetch, original);
});

test('bounded fetch streams omit large payloads without consuming or cancelling the native response; duration and record caps detach', async t => {
  const w = setup(t), body = '界'.repeat(100); w.fetch = () => Promise.resolve(new Response(body)); const original = w.fetch;
  const trace = createNativeContractTrace({ window: w, workflow: 'AFT', version: 'test', maxBody: 50 }); t.after(trace.dispose);
  const response = await w.fetch('/status', { method: 'POST' }); assert.equal(await response.text(), body); await tick();
  assert.equal(trace.stop().records[0].response.state, 'OMITTED_LIMIT');
  const limited = createNativeContractTrace({ window: w, workflow: 'AFT', version: 'test', maxRecords: 1 }); t.after(limited.dispose);
  await w.fetch('/status', { method: 'POST' }); await tick(); await w.fetch('/action', { method: 'POST' });
  assert.equal(limited.active, false); assert.equal(limited.stop().reason, 'record-limit'); assert.equal(w.fetch, original);
  const timed = createNativeContractTrace({ window: w, workflow: 'AFT', version: 'test', durationMs: 1 }); t.after(timed.dispose); await tick();
  assert.equal(timed.active, false); assert.equal(timed.stop().reason, 'duration-limit'); assert.equal(w.fetch, original);
});

test('actual trace XHR wrappers preserve synchronous returns/events, JSON responses, reused instances, abort and cleanup', t => {
  const w = setup(t), events = [], calls = [];
  class Xhr extends w.EventTarget {
    responseType = ''; readyState = 0; status = 0;
    open(...args) { calls.push(['open', ...args]); this.url = args[1]; this.readyState = 1; return 'native-open'; }
    send(body) { calls.push(['send', body]); this.status = 200; this.responseURL = new w.URL(this.url, w.location.href).href; this.readyState = 4;
      this.response = { objectId: 'opaque', status: 'WAITING', quantity: 3, accessToken: 'secret' }; this.responseText = JSON.stringify(this.response);
      this.dispatchEvent(new w.Event('load')); this.dispatchEvent(new w.Event('loadend')); return 'native-send'; }
    abort() { calls.push(['abort']); this.status = 0; this.dispatchEvent(new w.Event('abort')); this.dispatchEvent(new w.Event('loadend')); }
    getResponseHeader() { throw new Error('Headers must not be collected'); }
  }
  w.XMLHttpRequest = Xhr; w.fetch = () => { throw new Error('No fetch expected'); };
  const open = Xhr.prototype.open, send = Xhr.prototype.send, trace = createNativeContractTrace({ window: w, workflow: 'AFT', version: 'test' }); t.after(trace.dispose);
  const xhr = new Xhr(); for (const name of ['load', 'loadend', 'abort']) xhr.addEventListener(name, () => events.push(name));
  assert.equal(xhr.open('POST', '/action', false), 'native-open'); xhr.responseType = 'json'; assert.equal(xhr.send('{"objectId":"opaque","action":"Confirm"}'), 'native-send');
  xhr.open('GET', '/native.js', true); xhr.send(); assert.equal(trace.stop().records.length, 1); assert.equal(Xhr.prototype.open, open); assert.equal(Xhr.prototype.send, send);
  assert.deepEqual(events, ['load', 'loadend', 'load', 'loadend']); const record = trace.stop().records[0];
  assert.equal(JSON.parse(record.response.body).status, 'WAITING'); assert.equal(JSON.parse(record.request.body).objectId, JSON.parse(record.response.body).objectId);
  assert(!JSON.stringify(record).includes('secret')); assert.equal(calls.length, 4);
});

test('XHR abort, binary, redirected URL and synchronous native exceptions remain evidence without changing delivery', t => {
  const w = setup(t); const nativeError = new w.DOMException('secret', 'InvalidStateError'); let mode = 'abort', sends = 0;
  class Xhr extends w.EventTarget {
    open(_method, url) { this.url = url; }
    send() { sends++; if (mode === 'throw') throw nativeError; this.status = mode === 'abort' ? 0 : 200;
      this.responseURL = w.location.origin + '/auth?token=secret'; this.responseType = mode === 'binary' ? 'blob' : ''; this.responseText = '';
      if (mode === 'abort') this.dispatchEvent(new w.Event('abort')); this.dispatchEvent(new w.Event('loadend')); }
  }
  w.XMLHttpRequest = Xhr; const trace = createNativeContractTrace({ window: w, workflow: 'AFT', version: 'test' }); t.after(trace.dispose);
  for (mode of ['abort', 'binary', 'throw']) { const xhr = new Xhr(); xhr.open('POST', '/action'); if (mode === 'throw') assert.throws(() => xhr.send(), error => error === nativeError); else xhr.send(); }
  const result = trace.stop(); assert.deepEqual(result.records.map(row => row.response.state), ['FAILED', 'UNAVAILABLE', 'FAILED']);
  assert.equal(sends, 3); assert(!JSON.stringify(result).includes('secret')); assert.match(result.records[0].response.url, /REDACTED/);
});

test('one redactor masks nested numeric secrets, preserves workflow semantics and enforces structural bounds without altering raw inputs', t => {
  const w = setup(t), redact = createCaptureRedactor(w), value = { id: { objectId: 'opaque', instructionId: 'EditItems' }, action: 'Confirm', details: [{ employeeId: 42, password: 'secret', qty: 6 }], requestId: 'req', container: 'tsXPRIVATE' };
  const safe = JSON.parse(redact.body(JSON.stringify(value))); assert.equal(value.details[0].password, 'secret'); assert.equal(safe.details[0].employeeId, '[REDACTED]'); assert.equal(safe.details[0].qty, 6);
  const html = redact.body('<input name="objectId" value="opaque"><textarea name="userName">secret</textarea>'); assert(html.includes(safe.id.objectId)); assert(!html.includes('opaque')); assert(!html.includes('secret'));
  const url = redact.url(w.location.origin + '/status?objectId=opaque&s=tsXPRIVATE&token=secret'); assert(url.includes(safe.id.objectId)); assert(url.includes(safe.container));
  let nested = {}; for (let i = 0; i < 40; i++) nested = { nested }; assert.throws(() => redact.body(JSON.stringify(nested)), /structure limit/);
});
