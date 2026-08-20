import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, readScript } from '../tools/userscript-contracts.mjs';
import { compileFunction, compileValue } from './lib/source-functions.mjs';

const fixture = async name => JSON.parse(await readFile(path.join(ROOT, 'tests', 'fixtures', name), 'utf8'));
const clean = value => String(value ?? '').trim();

test('Sideline known response and payload contracts replay through production functions', async () => {
  const source = await readScript('MAIN_v0.2.1_Sideline_API_Move_TEST.txt');
  const hasPredicant = compileFunction(source, 'hasPredicant');
  const moveReason = compileFunction(source, 'moveReason', { clean });
  const moveOk = compileFunction(source, 'moveOk', { hasPredicant });
  const damaged = compileFunction(source, 'isDamagedDestinationResponse', { clean });
  const resolveItem = compileFunction(source, 'resolveItem', { clean });
  const requestId = () => 'REQUEST-SANITIZED';
  const scanSourcePayload = compileFunction(source, 'scanSourcePayload', { requestId, TOOL:'V3' });
  const scanItemPayload = compileFunction(source, 'scanItemPayload', { requestId, TOOL:'V3' });
  const buildMovePayload = compileFunction(source, 'buildMovePayload', { requestId, TOOL:'V3', clean });
  const data = await fixture('sideline.responses.json');

  for (const row of data.resolveItem) {
    const actual = resolveItem(row.response, row.barcode);
    if (row.expected) assert.deepEqual(actual, row.expected, row.name);
    else for (const [key, value] of Object.entries(row.expectedFlags)) assert.equal(actual[key], value, `${row.name}: ${key}`);
  }
  for (const row of data.moveResponses) {
    assert.equal(moveOk(row.response), row.ok, `${row.name}: moveOk`);
    assert.equal(damaged(row.response), !!row.damaged, `${row.name}: damaged`);
    if ('predicant' in row) assert.equal(hasPredicant(row.response), row.predicant, `${row.name}: predicant`);
    if (row.reason) assert.equal(moveReason(row.response), row.reason, `${row.name}: reason`);
  }

  assert.deepEqual(Object.keys(scanSourcePayload('SOURCE-SANITIZED')).sort(), ['containerScannableId','requestId','tool']);
  assert.deepEqual(Object.keys(scanItemPayload('SOURCE-SANITIZED', 'ITEM-SANITIZED')).sort(), ['containerScannableId','isMasterpack','itemAndonContext','itemBarcode','requestId','tool']);
  const normal = resolveItem(data.resolveItem[2].response, data.resolveItem[2].barcode);
  const payload = buildMovePayload('SOURCE-SANITIZED', 'DEST-SANITIZED', { processPath:'SANITIZED' }, normal, 2, null);
  assert.deepEqual(Object.keys(payload).sort(), [
    'candidatePurchaseOrders','datelotDetail','destinationContainerScannableId','foundProblems','itemAndonContext',
    'itemDetails','itemExternalId','itemMovedToISS','mlcCaptureDetail','packHierarchyDetail','processPath','quantity',
    'requestId','scannableId','scannedSourceContainerAsDestination','sourceContainerScannableId','tool','userEnteredExpirationDate'
  ]);
  assert.equal(payload.quantity, '2');
  assert.deepEqual(Object.keys(payload.itemDetails[0]).sort(), ['consumerType','disposition','fcsku','fnsku','quantity','referenceId']);
});

test('AFT objectId fixtures replay through production extraction', async () => {
  const source = await readScript('MAIN_v0.9.4_AFT_Edit-SKU-Move_master_PRODUCTION_CLEAN.txt');
  const objectId = compileFunction(source, 'objectId');
  const aftNorm = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const readQuantity = compileFunction(source, 'readQuantity');
  const MOVE_QTY_PATTERNS = compileValue(source, 'MOVE_QTY_PATTERNS');
  class TextDOMParser {
    parseFromString(html) {
      const textContent = String(html).replace(/<[^>]+>/g, ' ');
      return { body:{ textContent }, querySelectorAll:() => [] };
    }
  }
  const quantityInfoFromHtml = compileFunction(source, 'quantityInfoFromHtml', {
    MOVE_QTY_PATTERNS,
    DOMParser:TextDOMParser,
    norm:aftNorm,
    readQuantity
  });
  const data = await fixture('aft.responses.json');
  for (const row of data.objectIds) assert.equal(objectId(row.html), row.expected, row.name);
  const statusQueue = [];
  const post = async () => ({ json:async () => ({ status:statusQueue.shift() }) });
  let tick = 0;
  const api = compileFunction(source, 'makeApi', {
    performance:{ now:() => tick++ },
    post,
    sleep:async () => {},
    Error
  })('InstructionSanitized', 'ToolSanitized');
  statusQueue.push('PROCESSING', 'READY');
  assert.deepEqual(await api.wait('ObjectSanitized', 'Ready replay'), { state:'READY' });
  statusQueue.push('COMPLETE');
  assert.deepEqual(await api.wait('ObjectSanitized', 'Complete replay', { complete:true }), { state:'COMPLETE' });
  statusQueue.push('ERRORED');
  await assert.rejects(api.wait('ObjectSanitized', 'Error replay'), /backend ERRORED/);
  assert.deepEqual(new Set(data.knownStatuses), new Set(['READY','PROCESSING','COMPLETE','ERRORED']));
  for (const row of data.quantityHtml) {
    const actual = quantityInfoFromHtml(row.html);
    assert.equal(actual.qty, row.expected, row.html);
    assert.equal(actual.verify, !!row.verify, row.html);
  }
});

test('Dropzone state inputs replay through production normalization', async () => {
  const source = await readScript('TEST_v0.2.16_Dropzone_Selector_Queue.txt');
  const normalizeContainer = compileFunction(source, 'normalizeContainer');
  const defaultQueueState = compileFunction(source, 'defaultQueueState');
  const data = await fixture('dropzone.states.json');
  for (const row of data.containerInputs) assert.equal(normalizeContainer(row.input), row.expected);
  const localStorage = {
    value:'',
    getItem() { return this.value; }
  };
  const loadQueueState = compileFunction(source, 'loadQueueState', {
    localStorage,
    defaultQueueState,
    STORAGE_QUEUE:'moveapp_dz_selector_queue_v2'
  });
  for (const status of data.knownItemStates) {
    localStorage.value = JSON.stringify({ items:[{ id:'tsXSTATE1', status, error:'' }] });
    assert.equal(loadQueueState().items[0].status, status);
  }
  localStorage.value = JSON.stringify({ items:[{ id:'tsXSTATE1', status:'unknown', error:'' }] });
  assert.equal(loadQueueState().items[0].status, 'queued');

  const fatal = status => compileValue(source, 'fatal', { status });
  for (const status of data.fatalStatuses) assert.equal(fatal(status), true, `fatal ${status}`);
  for (const status of data.nonFatalStatuses) assert.equal(fatal(status), false, `nonfatal ${status}`);
});

test('Bin hierarchy and quantity fixtures replay through production parsers', async () => {
  const source = await readScript('TEST_v7.3.6_Bin_check_Overlay_USAGE.txt');
  const unknownFloor = compileFunction(source, 'unknownFloor');
  class FixtureDOMParser {
    parseFromString(html) {
      return {
        querySelector(selector) {
          assert.equal(selector, 'div.a-span6:nth-child(1) > table:nth-child(1) > tbody:nth-child(1) > tr:nth-child(4) > td:nth-child(2)');
          const rows = [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].map(match => match[1]);
          const cells = [...(rows[3] || '').matchAll(/<td>([\s\S]*?)<\/td>/gi)].map(match => match[1].replace(/<[^>]+>/g, ''));
          return cells[1] == null ? null : { textContent:cells[1] };
        }
      };
    }
  }
  const parseFloor = compileFunction(source, 'parseFloor', { DOMParser:FixtureDOMParser, unknownFloor });
  const numericQuantity = compileFunction(source, 'numericQuantity');
  const data = await fixture('bin-hierarchy.responses.json');
  const html = floor => `<div class="a-span6"><table><tbody><tr><td>x</td></tr><tr><td>x</td></tr><tr><td>x</td></tr><tr><td>x</td><td>${floor}</td></tr></tbody></table></div>`;
  for (const row of data.hierarchyHtml) assert.deepEqual(parseFloor(html(row.floorCell)), row.expected);
  for (const row of data.quantities) assert.equal(numericQuantity(row.input), row.expected);
});

test('FCR Data Core product fixtures replay through production normalization', async () => {
  const source = await readScript('TEST_v0.2.3_FCR_Data_Core_USAGE.txt');
  const coreClean = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const parseBool = compileFunction(source, 'parseBool', { clean:coreClean });
  const suspiciousDimensions = compileFunction(source, 'suspiciousDimensions');
  const normalizeProduct = compileFunction(source, 'normalizeProduct', { clean:coreClean, parseBool, suspiciousDimensions });
  const data = await fixture('data-core.responses.json');
  for (const row of data.products) {
    const actual = normalizeProduct(row.input);
    for (const [key, value] of Object.entries(row.expected)) assert.equal(actual[key], value, `${row.name}: ${key}`);
  }
});
