import test from 'node:test';
import assert from 'node:assert/strict';
import { createFcrEnrichment, createGmJsonReader, MEASUREMENT_ORIGIN } from '../fcr-enrichment.mjs';
import { FcrReadError } from '../fcr-read.mjs';

const now = Date.UTC(2026, 9, 5, 12), auth = { token: 'PRIVATE-ID-TOKEN', expiresAt: now + 3600000 };
const event = (source = 'MADCAT', time = now - 1000) => ({ measurementSource: source, measurementInstant: new Date(time).toISOString() });
const error = (code, status) => new FcrReadError(code, 'Fixture read failure', { status });
const rejects = (promise, code) => assert.rejects(promise, failure => failure instanceof FcrReadError && failure.code === code);
function fixture(responses = [], options = {}) {
  const calls = [], evidence = [];
  const reader = createFcrEnrichment({ warehouse: 'BWU2', now: () => now, uuid: () => 'fixture-id', getMeasurementAuth: async () => auth,
    onEvidence: entry => evidence.push(entry), readJson: async request => {
      calls.push(request); assert(responses.length, 'Unexpected enrichment request');
      const reply = responses.shift(); if (reply instanceof Error) throw reply;
      return typeof reply === 'function' ? reply(request) : reply;
    }, ...options });
  return { reader, calls, evidence };
}

test('construction is idle and hazmat forms retain exact native request fields including real level zero', async () => {
  const app = fixture([{ restriction: 'AU' }, { rows: [{ asin: 'B012345678', level: 0, message: 'Native message' }] }]);
  assert.equal(app.calls.length, 0);
  const result = await app.reader.hazmat('b012345678'); assert.equal(result.hazmat.level, 0); assert.equal(result.complete, true);
  assert.equal(app.calls[0].url, 'https://pandash.amazon.com/GridServlet?fc=BWU2');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(app.calls[1].body)), {
    language: 'default', source: 'AU-hazmat-FC', marketPlaces: 'AU', asins: 'B012345678', rows: '1', page: '1', fc: 'BWU2'
  });
});

test('missing/invalid/ambiguous exact hazmat never becomes level zero or a safe result', async () => {
  const missing = fixture([{ restriction: 'AU' }, { rows: [{ asin: 'B099999999', level: 1, message: 'Unrelated' }] }]);
  assert.equal((await missing.reader.hazmat('B012345678')).complete, false);
  for (const row of [{ asin: 'B012345678', message: '' }, { asin: 'B012345678', level: -1, message: '' }]) {
    await rejects(fixture([{ restriction: 'AU' }, { rows: [row] }]).reader.hazmat('B012345678'), 'SCHEMA');
  }
  await rejects(fixture([{ restriction: 'AU' }, { rows: [
    { asin: 'B012345678', level: 1, message: 'one' }, { asin: 'B012345678', level: 2, message: 'two' }
  ] }]).reader.hazmat('B012345678'), 'IDENTITY');
});

test('restriction fallback stays explicit, while authentication and caller cancellation prevent the POST', async () => {
  const app = fixture([error('NETWORK'), { rows: [{ asin: 'B012345678', level: 1, message: 'Native' }] }]);
  const result = await app.reader.hazmat('B012345678'); assert.match(result.warning, /default restriction/);
  assert.equal(new URLSearchParams(app.calls[1].body).get('source'), 'default-hazmat-FC');
  const authFail = fixture([error('AUTH_REQUIRED')]); await rejects(authFail.reader.hazmat('B012345678'), 'AUTH_REQUIRED'); assert.equal(authFail.calls.length, 1);
  const controller = new AbortController();
  const cancelled = fixture([() => { controller.abort(); throw error('NETWORK'); }]);
  await rejects(cancelled.reader.hazmat('B012345678', { signal: controller.signal }), 'CANCELLED'); assert.equal(cancelled.calls.length, 1);
});

test('binDescription is exact and preserves native read protocol fields/request identity', async () => {
  const app = fixture([{ items: [
    { scannableId: 'OTHER', binDescription: 'Wrong' }, { skuDetail: { fnSku: 'X012345678' }, binDescription: 'Native size' }
  ] }]);
  const result = await app.reader.binDescription('tsX111', 'X012345678'); assert.equal(result.size, 'Native size');
  assert.deepEqual(JSON.parse(app.calls[0].body), {
    containerScannableId: 'tsX111', isMasterpack: null, itemAndonContext: null, itemBarcode: 'X012345678',
    requestId: 'amzn1.fc.v1.common.request-id.v1.AFTPoirotWebsite.fixture-id', tool: 'V3'
  });
});

test('shared ASIN, top-level description, absent rows and conflicting exact sizes cannot prove an item size', async () => {
  const app = fixture([{ items: [{ scannedBarcode: 'X012345678', skuDetail: { fnSku: 'X099999999', asin: 'B012345678' }, binDescription: 'Wrong SKU' }] }]);
  const result = await app.reader.binDescription('tsX111', 'X012345678', { verifiedAliases: ['B012345678'] });
  assert.equal(result.complete, false); assert.equal(result.size, '');
  await rejects(fixture([{ binDescription: 'Unscoped' }]).reader.binDescription('tsX111', 'X012345678'), 'SCHEMA');
  await rejects(fixture([{ items: [{ scannableId: 'X012345678', binDescription: 'A' }, { scannableId: 'X012345678', binDescription: 'B' }] }])
    .reader.binDescription('tsX111', 'X012345678'), 'IDENTITY');
});

test('raw MADCAT checks the fixed 30-day window, exact native route and FNSKU preference', async () => {
  const app = fixture([{ measurementEvents: [event('MADCAT', now - 31 * 86400000), event('MADCAT', now + 1), event()], nextToken: 'unused-after-positive' }]);
  const result = await app.reader.recentMadcat({ fnsku: 'X012345678', asin: 'B012345678' });
  assert.equal(result.madcat, true); assert.equal(result.madcatSource, 'raw'); assert.equal(result.windowDays, 30);
  const url = new URL(app.calls[0].url); assert.equal(url.origin, MEASUREMENT_ORIGIN);
  assert.equal(url.pathname, '/prod/measurementEvents/X012345678/FNSKU'); assert.equal(url.searchParams.get('effectiveBefore'), new Date(now).toISOString());
  assert.equal(url.searchParams.get('effectiveAfter'), new Date(now - 30 * 86400000).toISOString());
  assert.equal(app.calls.length, 1);
});

test('raw MADCAT NO requires schema-valid terminal pages and preserves the continuation token', async () => {
  const app = fixture([{ measurementEvents: [event('OTHER')], nextToken: 'page 2' }, { measurementEvents: [], nextToken: null }]);
  const result = await app.reader.recentMadcat({ asin: 'B012345678' }); assert.equal(result.madcat, false); assert.equal(result.complete, true);
  assert.equal(result.pages, 2); assert.equal(new URL(app.calls[1].url).searchParams.get('nextToken'), 'page 2');
});

test('missing/malformed events and incomplete/repeated/invalid tokens never become raw NO', async () => {
  for (const response of [{}, { measurementEvents: null }, { measurementEvents: [{ measurementSource: 'MADCAT', measurementInstant: 'bad' }] },
    { measurementEvents: [], nextToken: {} }]) {
    await assert.rejects(fixture([response]).reader.recentMadcat({ asin: 'B012345678' }), failure => ['SCHEMA', 'PAGINATION'].includes(failure.code));
  }
  const repeated = fixture([{ measurementEvents: [], nextToken: 'same' }, { measurementEvents: [], nextToken: 'same' }]);
  await rejects(repeated.reader.recentMadcat({ asin: 'B012345678' }), 'PAGINATION'); assert.equal(repeated.calls.length, 2);
  const capped = fixture([{ measurementEvents: [], nextToken: 'more' }], { maxMeasurementPages: 1 });
  await rejects(capped.reader.recentMadcat({ asin: 'B012345678' }), 'PAGINATION'); assert.equal(capped.calls.length, 1);
});

test('Measurement auth rejection gets one fresh-token renewal and uses the same read window', async () => {
  const authCalls = [], app = fixture([error('AUTH_REQUIRED', 401), { measurementEvents: [] }], { getMeasurementAuth: async (_identifier, options) => {
    authCalls.push(options); return authCalls.length === 1 ? auth : { ...auth, token: 'FRESH-ID-TOKEN' };
  } });
  assert.equal((await app.reader.recentMadcat({ fnsku: 'X012345678' })).madcat, false);
  assert.equal(authCalls.length, 2); assert.equal(authCalls[1].force, true); assert.equal(authCalls[1].previousToken, auth.token);
  assert.equal(app.calls[0].url, app.calls[1].url); assert.equal(app.calls[1].headers.Authorization, 'FRESH-ID-TOKEN');
});

test('failed renewal and partial history fallback remain distinctly unknown, never raw NO', async () => {
  let authCalls = 0;
  const app = fixture([error('AUTH_REQUIRED', 401)], { getMeasurementAuth: async () => { authCalls++; return auth; },
    historyFallback: async () => ({ madcat: false, complete: false, rows: 3 }) });
  const result = await app.reader.recentMadcat({ fnsku: 'X012345678' });
  assert.equal(result.madcat, null); assert.equal(result.madcatSource, 'history'); assert.equal(result.windowDays, null); assert.equal(result.authRequired, true);
  assert.equal(authCalls, 2); assert.equal(app.calls.length, 1);
});

test('missing auth/HTTP 400 retains history provenance and a positive fallback is never a raw 30-day claim', async () => {
  const noAuth = fixture([], { getMeasurementAuth: async () => null, historyFallback: async () => ({ madcat: true, complete: false, rows: 1 }) });
  const result = await noAuth.reader.recentMadcat({ fnsku: 'X012345678' }); assert.equal(result.madcat, true); assert.equal(result.madcatSource, 'history'); assert.equal(result.windowDays, null);
  const badRequest = fixture([error('HTTP', 400)], { historyFallback: async () => ({ madcat: false, complete: true, rows: 0 }) });
  const fallback = await badRequest.reader.recentMadcat({ fnsku: 'X012345678' }); assert.equal(fallback.authRequired, false); assert.equal(fallback.source, 'history-fallback');
});

test('cancelled enrichment does not renew, paginate, fall back or publish a late result', async () => {
  const controller = new AbortController(); let resolve, authCalls = 0, fallbackCalls = 0;
  const app = fixture([() => new Promise(done => { resolve = done; })], { getMeasurementAuth: async () => { authCalls++; return auth; },
    historyFallback: async () => { fallbackCalls++; return { madcat: false, complete: true }; } });
  const pending = app.reader.recentMadcat({ fnsku: 'X012345678' }, { signal: controller.signal });
  for (let i = 0; i < 3; i++) await Promise.resolve();
  controller.abort(); resolve({ measurementEvents: [], nextToken: 'more' });
  await rejects(pending, 'CANCELLED'); assert.equal(authCalls, 1); assert.equal(fallbackCalls, 0); assert.equal(app.calls.length, 1);
});

test('enrichment emits read-only bounded evidence without credentials, query bodies or event payloads', async () => {
  const app = fixture([{ measurementEvents: [event()] }]); await app.reader.recentMadcat({ fnsku: 'X012345678' });
  assert(app.evidence.every(entry => entry.intent === 'read' && !entry.phase && !entry.operationId));
  const serialized = JSON.stringify(app.evidence);
  assert(!serialized.includes(auth.token)); assert(!serialized.includes('X012345678')); assert(!serialized.includes('measurementInstant'));
  const failed = fixture([error('HTTP', 500)]);
  await rejects(failed.reader.recentMadcat({ fnsku: 'X012345678' }), 'HTTP');
  assert(!JSON.stringify(failed.evidence).includes('X012345678'));
});

test('GM JSON adapter supports synchronous success, exact errors and rejects non-read resources', async () => {
  const read = createGmJsonReader(options => { options.onload({ status: 200, responseText: '{"rows":[]}' }); return { abort() {} }; });
  assert.deepEqual(await read({ url: 'https://pandash.amazon.com/GridServlet' }), { rows: [] });
  assert.throws(() => read({ url: 'https://example.com/move', method: 'POST' }), { code: 'INPUT' });
  for (const [response, code] of [
    [{ status: 401, responseText: '{}' }, 'AUTH_REQUIRED'], [{ status: 503, responseText: '{}' }, 'HTTP'],
    [{ status: 200, finalUrl: 'https://pandash.amazon.com/login', responseText: '{}' }, 'AUTH_REQUIRED'],
    [{ status: 200, responseText: '<html>login</html>' }, 'SCHEMA']
  ]) {
    const transport = createGmJsonReader(options => { options.onload(response); return { abort() {} }; });
    await rejects(transport({ url: 'https://pandash.amazon.com/GridServlet' }), code);
  }
});

test('GM cancellation aborts one owned handle and ignores late callbacks without affecting another read', async () => {
  const callbacks = [], aborts = [];
  const read = createGmJsonReader(options => { const index = callbacks.length; callbacks.push(options); return { abort() { aborts.push(index); options.onabort(); } }; });
  const controller = new AbortController();
  const first = read({ url: 'https://pandash.amazon.com/GridServlet', signal: controller.signal });
  const second = read({ url: 'https://pandash.amazon.com/GridServlet' });
  controller.abort(); callbacks[0].onload({ status: 200, responseText: '{}' });
  callbacks[1].onload({ status: 200, responseText: '{"restriction":"AU"}' });
  await rejects(first, 'CANCELLED'); assert.deepEqual(await second, { restriction: 'AU' }); assert.deepEqual(aborts, [0]);
});

test('GM timeout/network/start errors have typed outcomes and preserve an idle constructor', async () => {
  for (const [hook, code] of [['ontimeout', 'TIMEOUT'], ['onerror', 'NETWORK']]) {
    let calls = 0;
    const read = createGmJsonReader(options => { calls++; options[hook](); return { abort() {} }; });
    assert.equal(calls, 0); await rejects(read({ url: 'https://pandash.amazon.com/GridServlet' }), code); assert.equal(calls, 1);
  }
  await rejects(createGmJsonReader(() => { throw new Error('native failure'); })({ url: 'https://pandash.amazon.com/GridServlet' }), 'NETWORK');
});
