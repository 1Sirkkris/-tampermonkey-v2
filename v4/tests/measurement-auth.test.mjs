import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { normalizeMeasurementToken, createMeasurementAuth, installMeasurementCapture, MEASUREMENT_AUTH_KEY } from '../measurement-auth.mjs';
import { MEASUREMENT_ORIGIN } from '../fcr-enrichment.mjs';
import { createFcrEnrichment } from '../fcr-enrichment.mjs';

const now = Date.UTC(2026, 9, 5, 12);
const jwt = (data = {}) => ['header', Buffer.from(JSON.stringify({ token_use: 'id', exp: now / 1000 + 3600, ...data })).toString('base64url'), 'signature'].join('.');
const token = jwt(), otherToken = jwt({ exp: now / 1000 + 7200 });
class Storage {
  data = new Map(); listeners = new Map(); sequence = 0; failGet = false; failSet = false;
  get(key, fallback) { if (this.failGet) throw new Error('read unavailable'); return this.data.get(key) ?? fallback; }
  set(key, value) {
    if (this.failSet) throw new Error('write unavailable');
    const old = this.data.get(key); this.data.set(key, value);
    for (const { key: watched, callback } of this.listeners.values()) if (watched === key && old !== value) callback(key, old, value, true);
  }
  listen(key, callback) { const id = ++this.sequence; this.listeners.set(id, { key, callback }); return id; }
  remove(id) { this.listeners.delete(id); }
  save(value = token, captureId = 'fresh') { this.set(MEASUREMENT_AUTH_KEY, JSON.stringify({ token: value, capturedAt: now, captureId })); }
}
function fixture(t, { native = false, storage = new Storage(), fetch, onEvidence } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>', { url: native ? 'https://jp.item-measurement.aft.a2z.com/item/X012345678' : 'https://fcresearch-fe.aka.amazon.com/BWU2/results' });
  t.after(() => dom.window.close()); const page = dom.window;
  const tasks = new Map(); let sequence = 0;
  page.setTimeout = callback => { const id = ++sequence; tasks.set(id, callback); return id; };
  page.clearTimeout = id => tasks.delete(id);
  let fetchCalls = 0;
  const originalFetch = function (...args) { fetchCalls++; return fetch ? fetch.apply(this, args) : Promise.resolve(new Response('{}', { status: 200 })); };
  page.fetch = originalFetch;
  class Xhr extends page.EventTarget {
    status = 200;
    open() { return 'native-open'; }
    setRequestHeader() { return 'native-header'; }
    send() { if (this.failure) throw this.failure; this.dispatchEvent(new page.Event('loadend')); return 'native-send'; }
  }
  page.XMLHttpRequest = Xhr;
  const originals = { open: Xhr.prototype.open, header: Xhr.prototype.setRequestHeader, send: Xhr.prototype.send };
  const auth = createMeasurementAuth({ window: page, storage, now: () => now, onEvidence });
  return { page, storage, auth, tasks, originalFetch, originals, get fetchCalls() { return fetchCalls; },
    frames: () => [...page.document.querySelectorAll('iframe')], timeout() { for (const [id, callback] of [...tasks]) { tasks.delete(id); callback(); } } };
}

test('Measurement ID-token freshness is validated without treating access/expired/malformed tokens as usable', () => {
  assert.deepEqual(normalizeMeasurementToken('Bearer ' + token, now), { token, expiresAt: now + 3600000 });
  for (const value of [jwt({ token_use: 'access' }), jwt({ exp: now / 1000 + 5 }), 'not-a-token', 'x.'.repeat(10000), jwt({ exp: 'not a number' })]) {
    assert.equal(normalizeMeasurementToken(value, now), null);
  }
});

test('auth construction is idle; current native token reuse needs no iframe, listener or timer', async t => {
  const app = fixture(t); assert.equal(app.fetchCalls, 0); assert.equal(app.frames().length, 0); assert.equal(app.tasks.size, 0);
  app.storage.save(); const result = await app.auth.acquire('X012345678');
  assert.equal(result.token, token); assert.equal(app.frames().length, 0); assert.equal(app.storage.listeners.size, 0); assert.equal(app.tasks.size, 0);
  assert.equal(new URL(app.auth.loginUrl('X012345678')).hostname, 'jp.item-measurement.aft.a2z.com');
});

test('on-demand acquisition uses an inert native frame and GM notification, then fully cleans up', async t => {
  const app = fixture(t), pending = app.auth.acquire('X012345678');
  assert.equal(app.frames().length, 1); assert.equal(app.storage.listeners.size, 1); assert.equal(app.tasks.size, 1);
  assert.equal(app.frames()[0].getAttribute('inert'), ''); assert.equal(app.frames()[0].tabIndex, -1);
  assert.match(app.frames()[0].src, /\/item\/X012345678\?tmV4MeasurementAuth=1/);
  app.storage.save(); assert.equal((await pending).token, token);
  assert.equal(app.frames().length, 0); assert.equal(app.storage.listeners.size, 0); assert.equal(app.tasks.size, 0);
});

test('acquisition timeout returns unavailable and cancellation never leaves native auth resources running', async t => {
  const app = fixture(t), timed = app.auth.acquire('X012345678'); app.timeout(); assert.equal(await timed, null);
  assert.equal(app.frames().length, 0); assert.equal(app.storage.listeners.size, 0);
  const controller = new AbortController(), pending = app.auth.acquire('X012345678', { signal: controller.signal });
  controller.abort(); await assert.rejects(pending, { code: 'CANCELLED' });
  assert.equal(app.tasks.size, 0); assert.equal(app.storage.listeners.size, 0); assert.equal(app.frames().length, 0);
  app.storage.save(); assert.equal(app.frames().length, 0);
});

test('renewal rejects the old token, and force recheck needs a new native capture record', async t => {
  const app = fixture(t); app.storage.save(token, 'old');
  const renewal = app.auth.acquire('X012345678', { force: true, previousToken: token });
  app.storage.save(token, 'same-token-native-read'); assert.equal(app.frames().length, 1);
  app.storage.save(otherToken, 'new-token-native-read'); assert.equal((await renewal).token, otherToken);
  const forced = app.auth.acquire('X012345678', { force: true }); assert.equal(app.frames().length, 1);
  app.storage.save(otherToken, 'fresh-native-confirmation'); assert.equal((await forced).token, otherToken);
  assert.equal(app.tasks.size, 0); assert.equal(app.storage.listeners.size, 0);
});

test('unreadable native token storage is a typed failure and cannot silently reuse guessed credentials', async t => {
  const app = fixture(t); app.storage.failGet = true;
  await assert.rejects(app.auth.acquire('X012345678'), { code: 'STORAGE' });
  assert.equal(app.tasks.size, 0); assert.equal(app.frames().length, 0);
});

test('token update during listener registration cannot be missed or leak a synchronously notified listener', async t => {
  const storage = new Storage(), originalListen = storage.listen.bind(storage);
  storage.listen = (key, callback) => { const id = originalListen(key, callback); storage.save(); return id; };
  const app = fixture(t, { storage });
  assert.equal((await app.auth.acquire('X012345678')).token, token);
  assert.equal(storage.listeners.size, 0); assert.equal(app.tasks.size, 0); assert.equal(app.frames().length, 0);
});

test('native fetch capture stores the outgoing fresh credential and keeps response identity', async t => {
  const response = new Response('{}', { status: 200 }), app = fixture(t, { native: true, fetch: () => Promise.resolve(response) });
  const dispose = installMeasurementCapture({ page: app.page, storage: app.storage, now: () => now }); t.after(dispose);
  assert.equal(installMeasurementCapture({ page: app.page, storage: app.storage, now: () => now }), dispose);
  assert.equal(await app.page.fetch(MEASUREMENT_ORIGIN + '/prod/measurementEvents/X012345678/FNSKU', { headers: { Authorization: 'Bearer ' + token } }), response);
  assert.equal(app.auth.read().token, token);
  const keys = [...app.storage.data.keys()]; assert.deepEqual(keys, [MEASUREMENT_AUTH_KEY]);
  dispose(); assert.equal(app.page.fetch, app.originalFetch);
});

test('native API failures do not block credential observation; unrelated hosts and storage errors cannot change native calls', async t => {
  const response = new Response('{}', { status: 401 }), failure = new Error('exact native rejection');
  const app = fixture(t, { native: true, fetch: url => url.endsWith('/failure') ? Promise.reject(failure) : Promise.resolve(response) });
  const dispose = installMeasurementCapture({ page: app.page, storage: app.storage, now: () => now }); t.after(dispose);
  assert.equal(await app.page.fetch(MEASUREMENT_ORIGIN + '/prod/measurementEvents/X012345678/FNSKU', { headers: { Authorization: token } }), response);
  assert.equal(app.auth.read().token, token);
  app.storage.data.clear();
  await assert.rejects(app.page.fetch(MEASUREMENT_ORIGIN + '/prod/measurementEvents/failure', { headers: { Authorization: token } }), caught => caught === failure);
  app.storage.failSet = true;
  assert.equal(await app.page.fetch('https://example.test/other', { headers: { Authorization: token } }), response);
  assert.equal(app.storage.data.size, 0);
  const successful = fixture(t, { native: true }); successful.storage.failSet = true;
  const stop = installMeasurementCapture({ page: successful.page, storage: successful.storage, now: () => now }); t.after(stop);
  const accepted = await successful.page.fetch(MEASUREMENT_ORIGIN + '/prod/measurementEvents/X012345678/FNSKU', { headers: { Authorization: token } });
  assert.equal(accepted.status, 200); assert.equal(successful.storage.data.size, 0);
});

test('init headers override a Request header set; an unused original credential is not captured', async t => {
  const app = fixture(t, { native: true }), dispose = installMeasurementCapture({ page: app.page, storage: app.storage, now: () => now }); t.after(dispose);
  const request = new Request(MEASUREMENT_ORIGIN + '/prod/measurementEvents/X012345678/FNSKU', { headers: { Authorization: token } });
  await app.page.fetch(request, { headers: {} }); assert.equal(app.auth.read(), null);
  await app.page.fetch(request); assert.equal(app.auth.read().token, token);
});

test('native XHR return/error semantics and hook disposal are preserved', t => {
  const app = fixture(t, { native: true }), dispose = installMeasurementCapture({ page: app.page, storage: app.storage, now: () => now }); t.after(dispose);
  const xhr = new app.page.XMLHttpRequest();
  assert.equal(xhr.open('GET', MEASUREMENT_ORIGIN + '/prod/measurementEvents/X012345678/FNSKU'), 'native-open');
  assert.equal(xhr.setRequestHeader('Authorization', token), 'native-header'); assert.equal(xhr.send(), 'native-send');
  assert.equal(app.auth.read().token, token);
  const failure = new Error('exact send failure'); xhr.failure = failure; assert.throws(() => xhr.send(), caught => caught === failure);
  dispose(); assert.equal(app.page.XMLHttpRequest.prototype.open, app.originals.open);
  assert.equal(app.page.XMLHttpRequest.prototype.setRequestHeader, app.originals.header); assert.equal(app.page.XMLHttpRequest.prototype.send, app.originals.send);
});

test('late native capture after disposal cannot revive auth state, and hooks installed by someone else are retained', async t => {
  let resolve;
  const app = fixture(t, { native: true, fetch: () => new Promise(done => { resolve = done; }) });
  const dispose = installMeasurementCapture({ page: app.page, storage: app.storage, now: () => now });
  const pending = app.page.fetch(MEASUREMENT_ORIGIN + '/prod/measurementEvents/X012345678/FNSKU', { headers: { Authorization: token } });
  assert.equal(app.auth.read().token, token); app.storage.data.clear();
  const otherOwner = () => Promise.resolve(new Response('{}')); app.page.fetch = otherOwner; dispose();
  const response = new Response('{}'); resolve(response); assert.equal(await pending, response);
  assert.equal(app.page.fetch, otherOwner); assert.equal(app.auth.read(), null);
});

test('real source capabilities compose: native token capture feeds acquisition and a raw Measurement read', async t => {
  const storage = new Storage(), fcr = fixture(t, { storage }), native = fixture(t, { native: true, storage });
  const dispose = installMeasurementCapture({ page: native.page, storage, now: () => now }); t.after(dispose);
  const reader = createFcrEnrichment({ warehouse: 'BWU2', now: () => now, getMeasurementAuth: fcr.auth.acquire, readJson: async request => {
    assert.equal(request.headers.Authorization, token); return { measurementEvents: [] };
  } });
  const pending = reader.recentMadcat({ fnsku: 'X012345678' });
  assert.equal(fcr.frames().length, 1);
  await native.page.fetch(MEASUREMENT_ORIGIN + '/prod/measurementEvents/X012345678/FNSKU', { headers: { Authorization: token } });
  const result = await pending; assert.equal(result.madcat, false); assert.equal(result.madcatSource, 'raw');
  assert.equal(fcr.frames().length, 0); assert.equal(storage.listeners.size, 0); assert.equal(fcr.tasks.size, 0);
});


test('native request-time acquisition does not wait for a pending or HTTP 400 item response', async t => {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  const app = fixture(t, { native: true, fetch: () => promise });
  const stop = installMeasurementCapture({ page: app.page, storage: app.storage, now: () => now }); t.after(stop);
  const result = app.page.fetch(MEASUREMENT_ORIGIN + '/prod/measurementEvents/X012345678/FNSKU', { headers: { Authorization: token } });
  assert.equal(result, promise); assert.equal(app.auth.read().token, token);
  release(new Response('{}', { status: 400 })); assert.equal((await result).status, 400);
});

test('auth recovery watches one valid update and cleans up cancellation and synchronous notification', t => {
  const app = fixture(t), controller = new AbortController(); let calls = 0;
  const stop = app.auth.watch(() => { calls++; }, { signal: controller.signal });
  app.storage.save(jwt({ token_use: 'access' })); assert.equal(calls, 0);
  app.storage.save(); app.storage.save(otherToken); assert.equal(calls, 1); assert.equal(app.storage.listeners.size, 0); stop();
  app.auth.watch(() => { calls++; }, { signal: controller.signal }); controller.abort(); app.storage.save(token, 'late');
  assert.equal(calls, 1); assert.equal(app.storage.listeners.size, 0); assert.equal(app.tasks.size, 0); assert.equal(app.frames().length, 0);
  const original = app.storage.listen.bind(app.storage);
  app.storage.listen = (key, callback) => { const id = original(key, callback); app.storage.save(otherToken, 'sync'); return id; };
  app.auth.watch(() => { calls++; }); assert.equal(calls, 2); assert.equal(app.storage.listeners.size, 0);
});

test('auth diagnostics distinguish cache/frame/deadline/cancellation without credentials or identifiers', async t => {
  const evidence = [], app = fixture(t, { onEvidence: value => evidence.push(value) });
  const pending = app.auth.acquire('X012345678'); app.timeout(); assert.equal(await pending, null);
  const controller = new AbortController(), cancelled = app.auth.acquire('X012345678', { signal: controller.signal });
  controller.abort(); await assert.rejects(cancelled, { code: 'CANCELLED' });
  app.storage.save(); await app.auth.acquire('X012345678');
  assert.deepEqual(evidence.map(value => value.data.outcome), ['started', 'unavailable', 'started', 'failed', 'cached']);
  const serialized = JSON.stringify(evidence);
  assert(!serialized.includes(token)); assert(!serialized.includes('X012345678')); assert(!serialized.includes('Authorization'));
});

test('Master and Tote capture subscribers receive native credentials independently until the last disposal', async t => {
  const app = fixture(t, { native: true }), tote = new Storage();
  const first = installMeasurementCapture({ page: app.page, storage: app.storage, now: () => now });
  const hook = app.page.fetch;
  const second = installMeasurementCapture({ page: app.page, storage: tote, now: () => now });
  t.after(first); t.after(second);
  assert.equal(app.page.fetch, hook);
  const url = MEASUREMENT_ORIGIN + '/prod/measurementEvents/X012345678/FNSKU';
  await app.page.fetch(url, { headers: { Authorization: token } });
  assert.equal(JSON.parse(tote.get(MEASUREMENT_AUTH_KEY)).token, token);
  assert.equal(app.auth.read().token, token);
  first(); app.storage.data.clear();
  await app.page.fetch(url, { headers: { Authorization: otherToken } });
  assert.equal(app.storage.data.size, 0);
  assert.equal(JSON.parse(tote.get(MEASUREMENT_AUTH_KEY)).token, otherToken);
  second(); assert.equal(app.page.fetch, app.originalFetch);
});

// Pass 16: acquisition sharing is local to this auth provider, not native capture or GM storage.
test('four compatible cold callers share one frame and listener while retaining their own deadlines', async t => {
  const app = fixture(t);
  const pending = ['X012345678', 'X012345679', 'B012345678', 'B012345679'].map(code => app.auth.acquire(code));
  assert.equal(app.frames().length, 1);
  assert.equal(app.storage.listeners.size, 1);
  assert.equal(app.tasks.size, 4);
  app.storage.save();
  assert.deepEqual((await Promise.all(pending)).map(value => value.token), [token, token, token, token]);
  assert.equal(app.frames().length, 0); assert.equal(app.storage.listeners.size, 0); assert.equal(app.tasks.size, 0);
});

test('cancelling one shared caller retains its peers; cancelling the last releases the frame and allows fresh acquisition', async t => {
  const app = fixture(t), first = new AbortController(), second = new AbortController();
  const cancelled = app.auth.acquire('X012345678', { signal: first.signal });
  const survivor = app.auth.acquire('B012345678', { signal: second.signal });
  const sharedFrame = app.frames()[0];
  first.abort(); await assert.rejects(cancelled, { code: 'CANCELLED' });
  assert.deepEqual(app.frames(), [sharedFrame]); assert.equal(app.storage.listeners.size, 1); assert.equal(app.tasks.size, 1);
  app.storage.save(); assert.equal((await survivor).token, token);
  assert.equal(app.frames().length, 0); assert.equal(app.storage.listeners.size, 0); assert.equal(app.tasks.size, 0);
  app.storage.data.clear();
  const last = new AbortController(), lastPending = app.auth.acquire('X012345678', { signal: last.signal });
  last.abort(); await assert.rejects(lastPending, { code: 'CANCELLED' });
  assert.equal(app.frames().length, 0); assert.equal(app.storage.listeners.size, 0); assert.equal(app.tasks.size, 0);
  const fresh = app.auth.acquire('B012345678'); assert.equal(app.frames().length, 1); assert.notEqual(app.frames()[0], sharedFrame);
  app.storage.save(); assert.equal((await fresh).token, token);
});

test('a shared caller deadline does not expire a later caller or its native frame', async t => {
  const app = fixture(t), early = app.auth.acquire('X012345678');
  const [firstTimer, expireEarly] = [...app.tasks][0];
  const later = app.auth.acquire('B012345678'), frame = app.frames()[0];
  app.tasks.delete(firstTimer); expireEarly(); assert.equal(await early, null);
  assert.deepEqual(app.frames(), [frame]); assert.equal(app.tasks.size, 1); assert.equal(app.storage.listeners.size, 1);
  app.storage.save(); assert.equal((await later).token, token);
  assert.equal(app.frames().length, 0); assert.equal(app.storage.listeners.size, 0); assert.equal(app.tasks.size, 0);
});

test('different previous-token conditions and forced native captures never join a cold acquisition', async t => {
  const app = fixture(t), controllers = Array.from({ length: 5 }, () => new AbortController());
  const rejectsOld = app.auth.acquire('X012345678', { signal: controllers[0].signal, previousToken: token });
  const rejectsOther = app.auth.acquire('B012345678', { signal: controllers[1].signal, previousToken: otherToken });
  const ordinary = app.auth.acquire('X012345679', { signal: controllers[2].signal });
  const forced = app.auth.acquire('B012345679', { signal: controllers[3].signal, force: true });
  const forcedOld = app.auth.acquire('X012345670', { signal: controllers[4].signal, force: true, previousToken: token });
  assert.equal(app.frames().length, 5); assert.equal(app.storage.listeners.size, 5);
  app.storage.save(token);
  assert.equal((await rejectsOther).token, token); assert.equal((await ordinary).token, token); assert.equal((await forced).token, token);
  assert.equal(app.frames().length, 2); assert.equal(app.storage.listeners.size, 2);
  app.storage.save(otherToken);
  assert.equal((await rejectsOld).token, otherToken); assert.equal((await forcedOld).token, otherToken);
  assert.equal(app.frames().length, 0); assert.equal(app.storage.listeners.size, 0); assert.equal(app.tasks.size, 0);
});

test('matching rejected-token requirements can share while forced acquisition still needs a new capture record', async t => {
  const app = fixture(t); app.storage.save(token, 'old');
  const first = app.auth.acquire('X012345678', { previousToken: token });
  const second = app.auth.acquire('B012345678', { previousToken: token });
  const forced = app.auth.acquire('X012345679', { force: true });
  assert.equal(app.frames().length, 2); assert.equal(app.storage.listeners.size, 2);
  // Notify without changing the stored native capture: forced acquisition must wait.
  for (const { callback } of [...app.storage.listeners.values()]) callback();
  assert.equal(app.frames().length, 2);
  app.storage.save(token, 'new-record-same-token'); assert.equal((await forced).token, token);
  assert.equal(app.frames().length, 1); assert.equal(app.tasks.size, 2);
  app.storage.save(otherToken); assert.equal((await first).token, otherToken); assert.equal((await second).token, otherToken);
  assert.equal(app.frames().length, 0); assert.equal(app.tasks.size, 0); assert.equal(app.storage.listeners.size, 0);
});

test('separate auth runtime owners retain independent acquisition frames and listeners', async t => {
  const app = fixture(t), other = createMeasurementAuth({ window: app.page, storage: app.storage, now: () => now });
  const first = app.auth.acquire('X012345678'), second = other.acquire('B012345678');
  assert.equal(app.frames().length, 2); assert.equal(app.storage.listeners.size, 2);
  app.storage.save(); assert.equal((await first).token, token); assert.equal((await second).token, token);
  assert.equal(app.frames().length, 0); assert.equal(app.storage.listeners.size, 0); assert.equal(app.tasks.size, 0);
});

test('shared acquisition storage failure settles every caller and releases all native resources', async t => {
  const app = fixture(t), pending = Array.from({ length: 4 }, () => app.auth.acquire('X012345678'));
  app.storage.failGet = true;
  for (const { callback } of [...app.storage.listeners.values()]) callback();
  for (const result of pending) await assert.rejects(result, { code: 'STORAGE' });
  assert.equal(app.frames().length, 0); assert.equal(app.storage.listeners.size, 0); assert.equal(app.tasks.size, 0);
});
