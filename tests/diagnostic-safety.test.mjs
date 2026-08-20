import test from 'node:test';
import assert from 'node:assert/strict';
import { readScript } from '../tools/userscript-contracts.mjs';
import { compileFunction } from './lib/source-functions.mjs';

test('unified diagnostic redacts sensitive values and fingerprints identifiers', async () => {
  const source = await readScript('Diagnostics/DIAG_v0.2.0_Unified_Live_Evidence_Capture.user.js');
  const hash = compileFunction(source, 'hash');
  const fingerprint = compileFunction(source, 'fingerprint', { hash });
  const MAX_BODY_CHARS = 12000;
  const scrubText = compileFunction(source, 'scrubText', { fingerprint, MAX_BODY_CHARS });
  const sanitizeRoutePart = compileFunction(source, 'sanitizeRoutePart', {
    decodeURIComponent,
    scrubText,
    fingerprint
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
  assert.equal(sanitize(sanitized).requestId, sanitized.requestId, 'fingerprints should remain stable when persisted events reload');
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
