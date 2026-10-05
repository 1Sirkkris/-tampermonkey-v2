import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const context={console,crypto,performance,DOMException,setTimeout,clearTimeout,setInterval,clearInterval,URL,URLSearchParams,location:{origin:'https://example.amazon.com',href:'https://example.amazon.com/',pathname:'/',hostname:'example.amazon.com'},globalThis:null};
context.V3={};context.globalThis=context;context.window=context;
vm.createContext(context);
for(const file of ['core.js','actions.js','hierarchy.js','aft.js','sideline.js']){
  vm.runInContext(fs.readFileSync(path.join(root,'src',file),'utf8'),context,{filename:file});
}
vm.runInContext(fs.readFileSync(path.join(root,'src','transport.js'),'utf8'),context);
const A=context.V3.actions,H=context.V3.hierarchy;
assert.equal(A.destination('P3','Cubiscan'),'dz-Pcubiscan-P3');
assert.equal(A.destination('P1','P1-Nonsort'),'dz-P-IB-nonsort');
assert.equal(A.destination('P4','PRIME'),'dz-P-PRIME');
assert.equal(H.normalizeFacility(' bwu1 '),'BWU1');
assert.equal(H.normalizeFacility('AVV2'),'AVV2');
assert.equal(H.normalizeFacility('bad fc'),'');
assert.equal(H.tokenFromBody('{"destinationWarehouseId":"opaque-123"}'),'opaque-123');
assert.equal(H.tokenFromBody('destinationWarehouseId=opaque-456'),'opaque-456');
assert.equal(H.facilityFromResponse('"BWU1"'),'BWU1');

const aft=context.V3.aft;
assert.equal(aft.mapState('Sellable'),'INVENTORY');
assert.equal(aft.mapState('Pending Research'),'PENDING_RESEARCH');
assert.equal(aft.mapState('Unsellable'),'UNSELLABLE');
assert.equal(aft.mapDamage('Defective'),'DEFECTIVE');

const sideline=context.V3.sideline;
const overage={'@type':'ItemNotInContainerResponse',success:false,message:'Item not in source container',items:[{quantity:0,skuDetail:{asin:'B012345678',fnSku:'X000000000',fcSku:'FC123',hazmat:false,datelotDetail:{},itemDropzoneRecommendation:{permissionLevel:'ALLOW'}}}]};
assert.equal(sideline.allowedOverage(overage),true);
assert.notEqual(sideline.baseClassify(overage,'X000000000').kind,'red');
assert.equal(sideline.baseClassify({'@type':'InvalidBarcodeResponse',success:false},'BAD').kind,'red');

assert.throws(()=>A.strictMoveConfirmation({status:500,data:{success:false}}),/unknown/);
assert.throws(()=>A.strictMoveConfirmation({status:200,raw:'{\"foo\":1}',data:{foo:1}}),/not recognized/);
assert.equal(A.strictMoveConfirmation({status:204,raw:'',data:null}).status,204);
assert.throws(()=>A.strictMoveConfirmation({status:200,raw:'',flags:{auth:true}}),/authentication/);
assert.throws(()=>A.strictMoveConfirmation({status:200,raw:'',finalUrl:'https://evil.example/api/move-container'}),/redirected/);
assert.equal(sideline.baseClassify({'@type':'RequestMultipleBarcodesResponse',success:true,items:overage.items},'X').kind,'red');
assert.equal(sideline.validDate(29,2,2025),null);assert.notEqual(sideline.validDate(29,2,2024),null);
assert.throws(()=>aft.datePayload('2026-02-31'),/Invalid/);
console.log('PASS domain: destinations, auth/HTML, response ambiguity, overage, multi matches, date validity');