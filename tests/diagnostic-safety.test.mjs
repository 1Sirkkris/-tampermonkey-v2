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
  assert.deepEqual(sanitize({ inventoryFacts:{ continuationPresent:true, hasNext:false, rowCount:0 } }), {
    inventoryFacts:{ continuationPresent:true, hasNext:false, rowCount:0 }
  });

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
  assert.equal(DETAIL_PATHS.includes('/results/inventory'), false);
  assert.equal(DETAIL_PATHS.includes('/inventory-more'), false);

  const eventForExport = compileFunction(source, 'eventForExport', { detailed:false, sanitize:value => value });
  const exported = eventForExport({
    type:'network',
    data:{ method:'POST', requestBody:{ secret:'redacted' }, responseBody:{ ok:true }, status:200 }
  });
  assert.deepEqual(exported, { type:'network', data:{ method:'POST', status:200 } });
});

test('metadata-only inventory inspection exports safe facts and never raw content', async () => {
  const source = await readScript('Diagnostics/DIAG_v0.2.0_Unified_Live_Evidence_Capture.user.js');
  const singleSafeFact = compileFunction(source, 'singleSafeFact');
  const inspectInventoryResponse = compileFunction(source, 'inspectInventoryResponse', {
    singleSafeFact,
    MAX_INVENTORY_INSPECT_NODES:500,
    MAX_DEPTH:6,
    JSON,
    Number
  });
  const inventoryNetworkData = compileFunction(source, 'inventoryNetworkData');
  const rawToken = 'CONTINUATION-PRIVATE-SECRET';
  const rawIdentifier = 'tsXPRIVATE123';
  const raw = JSON.stringify({
    display:'Quantity (3)',
    rows:[{ containerScannableId:rawIdentifier }, {}, {}],
    hasNext:true,
    continuationToken:rawToken,
    secret:'BODY-PRIVATE-SECRET'
  });
  const facts = inspectInventoryResponse(raw, {
    contentType:'application/json',
    inspectedCount:raw.length,
    inspectionUnit:'chars'
  });
  assert.deepEqual({
    quantityLabel:facts.quantityLabel,
    quantity:facts.quantity,
    rowCount:facts.rowCount,
    hasNext:facts.hasNext,
    continuationPresent:facts.continuationPresent,
    inspectionFailure:facts.inspectionFailure
  }, {
    quantityLabel:'Quantity (3)',
    quantity:3,
    rowCount:3,
    hasNext:true,
    continuationPresent:true,
    inspectionFailure:false
  });
  const storedEvent = {
    type:'network',
    data:inventoryNetworkData({ status:200, ok:true, ms:17 }, 'inventory', facts)
  };
  const stored = JSON.stringify(storedEvent);
  for (const rawValue of [raw, rawToken, rawIdentifier, 'BODY-PRIVATE-SECRET']) {
    assert.equal(stored.includes(rawValue), false, `persisted raw inventory content: ${rawValue}`);
  }
  assert.equal(storedEvent.data.status, 200);
  assert.equal(storedEvent.data.ms, 17);
  let persisted = '';
  const persistNow = compileFunction(source, 'persistNow', {
    clearTimeout:() => {},
    flushTimer:0,
    sessionStorage:{ setItem:(_key, value) => { persisted = value; } },
    STORE_KEY:'inventory-test',
    JSON,
    events:[storedEvent]
  });
  persistNow();
  for (const rawValue of [raw, rawToken, rawIdentifier, 'BODY-PRIVATE-SECRET']) {
    assert.equal(persisted.includes(rawValue), false, `stored raw inventory content: ${rawValue}`);
  }

  const htmlToken = 'HTML-CONTINUATION-SECRET';
  const html = `<div>Quantity (2)</div><table><tbody><tr></tr><tr></tr></tbody></table>` +
    `<input name="continuationToken" value="${htmlToken}">`;
  const htmlFacts = inspectInventoryResponse(html, { contentType:'text/html', inspectedCount:html.length });
  assert.equal(htmlFacts.quantity, 2);
  assert.equal(htmlFacts.rowCount, 2);
  assert.equal(htmlFacts.hasNext, null);
  assert.equal(htmlFacts.continuationPresent, true);
  assert.equal(JSON.stringify(htmlFacts).includes(htmlToken), false);
  assert.equal(htmlFacts.inspectionIncomplete, true);

  const noContinuation = inspectInventoryResponse(JSON.stringify({ rows:[], hasNext:false, continuationToken:null }), {
    contentType:'application/json'
  });
  assert.equal(noContinuation.rowCount, 0);
  assert.equal(noContinuation.hasNext, false);
  assert.equal(noContinuation.continuationPresent, false);
  assert.equal(/\bconsole\./.test(source), false);
});

test('inventory inspection is exact-path bounded and reports malformed or incomplete input', async () => {
  const source = await readScript('Diagnostics/DIAG_v0.2.0_Unified_Live_Evidence_Capture.user.js');
  const location = { href:'https://example.invalid/base' };
  const inventoryPathKind = compileFunction(source, 'inventoryPathKind', {
    URL,
    location,
    INVENTORY_PATH:'/results/inventory',
    INVENTORY_MORE_PATH:'/inventory-more'
  });
  assert.equal(inventoryPathKind('/results/inventory?view=all'), 'inventory');
  assert.equal(inventoryPathKind('/inventory-more'), 'inventory-more');
  assert.equal(inventoryPathKind('/results/inventory/other'), '');
  assert.equal(inventoryPathKind('/unrelated/inventory-more'), '');

  const boundedInspectionText = compileFunction(source, 'boundedInspectionText', { MAX_INVENTORY_INSPECT_BYTES:65536, Math });
  const bounded = boundedInspectionText(`Quantity (9)${'x'.repeat(70000)}`);
  assert.equal(bounded.truncated, true);
  assert.equal(bounded.text.length, 65536);
  assert.equal(bounded.inspectedCount, 65536);

  const readBoundedResponseText = compileFunction(source, 'readBoundedResponseText', {
    MAX_INVENTORY_INSPECT_BYTES:5,
    TextDecoder
  });
  const chunks = [new TextEncoder().encode('abcd'), new TextEncoder().encode('ePRIVATE-SECRET')];
  let cancelled = false;
  const streamed = await readBoundedResponseText({
    body:{
      getReader:() => ({
        read:async () => chunks.length ? { done:false, value:chunks.shift() } : { done:true },
        cancel:async () => { cancelled = true; },
        releaseLock:() => {}
      })
    }
  });
  assert.deepEqual({ text:streamed.text, truncated:streamed.truncated, inspectedCount:streamed.inspectedCount }, {
    text:'abcde', truncated:true, inspectedCount:5
  });
  assert.equal(cancelled, true);
  assert.equal(streamed.text.includes('PRIVATE-SECRET'), false);

  const singleSafeFact = compileFunction(source, 'singleSafeFact');
  const inspectInventoryResponse = compileFunction(source, 'inspectInventoryResponse', {
    singleSafeFact,
    MAX_INVENTORY_INSPECT_NODES:500,
    MAX_DEPTH:6,
    JSON,
    Number
  });
  const oversizedFacts = inspectInventoryResponse(bounded.text, { ...bounded, contentType:'text/plain' });
  assert.equal(oversizedFacts.quantity, 9);
  assert.equal(oversizedFacts.inspectionTruncated, true);
  assert.equal(oversizedFacts.inspectionIncomplete, true);

  const malformed = inspectInventoryResponse('{not-json', { contentType:'application/json', inspectedCount:9 });
  assert.equal(malformed.inspectionFailure, true);
  assert.equal(malformed.inspectionIncomplete, true);
  assert.equal(malformed.quantity, null);
  assert.equal(malformed.rowCount, null);
});

test('inventory-more correlation and failure flags are safe and explicit', async () => {
  const source = await readScript('Diagnostics/DIAG_v0.2.0_Unified_Live_Evidence_Capture.user.js');
  const beginInventoryInspection = compileFunction(source, 'beginInventoryInspection', { inventoryAwaitingMore:false });
  assert.equal(beginInventoryInspection('inventory'), false);
  assert.equal(beginInventoryInspection('inventory-more'), true);
  assert.equal(beginInventoryInspection('inventory-more'), false);

  const inspectInventoryMoreResponse = compileFunction(source, 'inspectInventoryMoreResponse', { JSON });
  const inventoryNetworkData = compileFunction(source, 'inventoryNetworkData');
  const valid = inspectInventoryMoreResponse('{"ok":true}', { contentType:'application/json', inspectedCount:11 });
  const success = inventoryNetworkData({ status:200, ok:true, ms:12 }, 'inventory-more', valid, true);
  assert.deepEqual({ follows:success.inventoryFollowUp.followsInventory, failed:success.inventoryFollowUp.failed }, { follows:true, failed:false });

  const malformed = inspectInventoryMoreResponse('PRIVATE BODY {', { contentType:'application/json', inspectedCount:14 });
  const parseFailed = inventoryNetworkData({ status:200, ok:true, ms:8 }, 'inventory-more', malformed, true);
  assert.equal(parseFailed.inventoryFollowUp.parseFailure, true);
  assert.equal(parseFailed.inventoryFollowUp.failed, true);
  assert.equal(JSON.stringify(parseFailed).includes('PRIVATE BODY'), false);

  const non2xx = inventoryNetworkData({ status:500, ok:false, ms:6 }, 'inventory-more', valid, true);
  assert.equal(non2xx.inventoryFollowUp.non2xx, true);
  assert.equal(non2xx.inventoryFollowUp.failed, true);
  const network = inventoryNetworkData({ status:0, ok:false, error:'network-failure', ms:4 }, 'inventory-more', valid, true);
  assert.equal(network.inventoryFollowUp.networkFailure, true);
  assert.equal(network.inventoryFollowUp.failed, true);
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
  const safeContentType = compileFunction(source, 'safeContentType');
  assert.equal(safeContentType('Application/JSON; boundary=PRIVATE-SECRET'), 'application/json');
  assert.equal(safeContentType('not a type PRIVATE-SECRET'), '');
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
