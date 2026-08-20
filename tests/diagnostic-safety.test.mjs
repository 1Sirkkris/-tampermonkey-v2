import test from 'node:test';
import assert from 'node:assert/strict';
import { readScript } from '../tools/userscript-contracts.mjs';
import { compileFunction, compileValue } from './lib/source-functions.mjs';

test('unified diagnostic redacts sensitive values and fingerprints identifiers', async () => {
  const source = await readScript('Diagnostics/DIAG_v0.2.0_Unified_Live_Evidence_Capture.user.js');
  const hash = compileFunction(source, 'hash');
  const fingerprint = compileFunction(source, 'fingerprint', { hash });
  const MAX_BODY_CHARS = 12000;
  const scrubText = compileFunction(source, 'scrubText', { fingerprint, MAX_BODY_CHARS });
  const SAFE_ROUTE_PART = compileValue(source, 'SAFE_ROUTE_PART');
  const sanitizeRoutePart = compileFunction(source, 'sanitizeRoutePart', {
    decodeURIComponent,
    scrubText,
    fingerprint,
    SAFE_ROUTE_PART
  });
  const SAFE_QUERY_KEY = /^(?:action|mode|page|sort|state|tab|type|view)$/i;
  const sanitizeUrl = compileFunction(source, 'sanitizeUrl', {
    location:{ href:'https://example.invalid/base' },
    SAFE_QUERY_KEY,
    scrubText,
    fingerprint,
    sanitizeRoutePart
  });
  const SENSITIVE_KEY = /auth|authorization|cookie|credential|csrf|jwt|password|secret|session|signature|token|x-amz/i;
  const IDENTIFIER_KEY = /asin|barcode|code|container|customer|destination|fcsku|fnsku|(?:^|_)id(?:$|_)|item|lpn|object|pod|scannable|sku|source/i;
  const CAMEL_IDENTIFIER_KEY = /(?:Id|ID)$/;
  const FINGERPRINT_VALUE = /^<[^<>#]+#[a-z0-9]{7}:\d+>$/;
  const sanitize = compileFunction(source, 'sanitize', {
    SENSITIVE_KEY,
    IDENTIFIER_KEY,
    CAMEL_IDENTIFIER_KEY,
    FINGERPRINT_VALUE,
    fingerprint,
    sanitizeUrl,
    scrubText,
    MAX_DEPTH:6
  });
  const capBody = compileFunction(source, 'capBody', { scrubText, JSON, MAX_BODY_CHARS });

  const raw = {
    authorization:'Bearer SECRET-TOKEN',
    containerScannableId:'tsXPRIVATE123',
    objectId:'OBJECT-PRIVATE-456',
    requestId:'REQ-PRIVATE-1',
    instructionId:'INS-PRIVATE-2',
    referenceId:'REF-PRIVATE-3',
    employeeId:'EMP-PRIVATE-4',
    nested:{
      email:'person@example.invalid',
      note:'Pod P-2-A123B456, item X0ABCDEFGH, Bearer GENERIC-SECRET, eyJabc.eyJdef.signature',
      'div#tsXPRIVATE123':3
    },
    url:'https://example.invalid/api/OBJECT-PRIVATE-456?token=SECRET-TOKEN&mode=view&s=tsXPRIVATE123#tsXPRIVATE123'
  };
  const sanitized = sanitize(raw);
  const output = JSON.stringify(sanitized);
  for (const secret of [
    'SECRET-TOKEN','GENERIC-SECRET','eyJabc.eyJdef.signature','tsXPRIVATE123','OBJECT-PRIVATE-456',
    'REQ-PRIVATE-1','INS-PRIVATE-2','REF-PRIVATE-3','EMP-PRIVATE-4','person@example.invalid','P-2-A123B456','X0ABCDEFGH'
  ]) {
    assert.equal(output.includes(secret), false, `leaked ${secret}`);
  }
  assert.match(output, /<redacted>/);
  assert.match(output, /<containerScannableId#/);
  assert.match(output, /mode=view/);
  assert.match(new URL(sanitized.url).searchParams.get('s'), /^<query:s#/);
  assert.match(decodeURIComponent(new URL(sanitized.url).pathname), /<path:2#/);
  assert.match(decodeURIComponent(new URL(sanitized.url).hash), /<container#/);
  const lowercasePath = decodeURIComponent(new URL(sanitizeUrl('https://example.invalid/api/privateemployeevalue')).pathname);
  assert.equal(lowercasePath.includes('privateemployeevalue'), false);
  assert.match(lowercasePath, /^\/api\/<path:2#/);
  assert.equal(sanitize(sanitized).requestId, sanitized.requestId, 'fingerprints should remain stable when persisted events reload');

  const parseBody = compileFunction(source, 'parseBody', {
    sanitize,
    scrubText,
    URLSearchParams,
    FormData,
    Blob,
    ArrayBuffer,
    capBody
  });
  const parseResponseText = compileFunction(source, 'parseResponseText', { sanitize, scrubText, capBody });
  const attachDetailedBodies = compileFunction(source, 'attachDetailedBodies');
  const detail = attachDetailedBodies(
    { transport:'fetch' },
    true,
    parseBody(JSON.stringify({ token:'SECRET-TOKEN', containerScannableId:'tsXPRIVATE123' })),
    parseResponseText('x'.repeat(13000), 'text/plain')
  );
  const detailOutput = JSON.stringify(detail);
  assert.equal(detailOutput.includes('SECRET-TOKEN'), false);
  assert.equal(detailOutput.includes('tsXPRIVATE123'), false);
  assert.match(detailOutput, /<truncated:13000>/);
  const oversizedJson = parseResponseText(JSON.stringify({ rows:Array.from({ length:100 }, () => 'x'.repeat(12000)) }), 'application/json');
  assert.equal(typeof oversizedJson, 'string');
  assert.ok(oversizedJson.length < 12100);
  assert.match(oversizedJson, /<truncated:/);
});

test('unified diagnostic body capture is opt-in, allowlisted, and absent from default exports', async () => {
  const source = await readScript('Diagnostics/DIAG_v0.2.0_Unified_Live_Evidence_Capture.user.js');
  const DETAIL_PATHS = compileValue(source, 'DETAIL_PATHS', { Object });
  const location = { href:'https://example.invalid/base' };
  const defaultAllowed = compileFunction(source, 'detailAllowed', { detailed:false, URL, location, DETAIL_PATHS });
  const optedInAllowed = compileFunction(source, 'detailAllowed', { detailed:true, URL, location, DETAIL_PATHS });
  assert.equal(defaultAllowed('https://example.invalid/api/move-items'), false);
  assert.equal(optedInAllowed('https://example.invalid/api/move-items?mode=view'), true);
  assert.equal(optedInAllowed('https://example.invalid/api/unrelated'), false);

  const eventForExport = compileFunction(source, 'eventForExport', { detailed:false, sanitize:value => value });
  const exported = eventForExport({
    type:'network',
    data:{ method:'POST', requestBody:{ secret:'redacted' }, responseBody:{ ok:true }, status:200 }
  });
  assert.deepEqual(exported, { type:'network', data:{ method:'POST', status:200 } });
});

test('unified diagnostic text scrubber caps body size', async () => {
  const source = await readScript('Diagnostics/DIAG_v0.2.0_Unified_Live_Evidence_Capture.user.js');
  const hash = compileFunction(source, 'hash');
  const fingerprint = compileFunction(source, 'fingerprint', { hash });
  const scrubText = compileFunction(source, 'scrubText', { fingerprint, MAX_BODY_CHARS:12000 });
  const output = scrubText('x'.repeat(13000));
  assert.ok(output.length < 12100);
  assert.match(output, /<truncated:13000>/);
});

test('unified diagnostic avoids buffering oversized or binary responses', async () => {
  const source = await readScript('Diagnostics/DIAG_v0.2.0_Unified_Live_Evidence_Capture.user.js');
  const responseBodySkip = compileFunction(source, 'responseBodySkip', {
    MAX_RESPONSE_READ_BYTES:65536,
    scrubText:value => String(value)
  });
  assert.equal(responseBodySkip('application/json', 1024), '');
  assert.equal(responseBodySkip('text/html; charset=utf-8', 1024), '');
  assert.equal(responseBodySkip('application/octet-stream', 1024), '<response-body-skipped:application/octet-stream>');
  assert.equal(responseBodySkip('application/json', 65537), '<response-body-skipped:65537-bytes>');
});

test('unified diagnostic reads no network headers except response content type', async () => {
  const source = await readScript('Diagnostics/DIAG_v0.2.0_Unified_Live_Evidence_Capture.user.js');
  const reads = [...source.matchAll(/(?:headers\.get|getResponseHeader)\(\s*(['"])([^'"]+)\1/g)].map(match => match[2]);
  assert.ok(reads.length > 0);
  assert.deepEqual([...new Set(reads)], ['content-type']);
  for (const forbidden of ['getAllResponseHeaders(', 'getAllRequestHeaders(', 'document.cookie', 'request.headers']) {
    assert.equal(source.includes(forbidden), false);
  }
});

test('unified diagnostic has a synchronous persistence path for page exit', async () => {
  const source = await readScript('Diagnostics/DIAG_v0.2.0_Unified_Live_Evidence_Capture.user.js');
  let stored = null;
  const events = [{ type:'page.pagehide' }];
  const persistNow = compileFunction(source, 'persistNow', {
    clearTimeout:() => {},
    flushTimer:1,
    sessionStorage:{ setItem:(key, value) => { stored = { key, value }; } },
    STORE_KEY:'test-store',
    JSON,
    events
  });
  persistNow();
  assert.deepEqual(stored, { key:'test-store', value:JSON.stringify(events) });
});
