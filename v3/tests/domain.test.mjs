import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const context={console,crypto,performance,DOMException,setTimeout,clearTimeout,setInterval,clearInterval,URL,URLSearchParams,location:{origin:'https://example.amazon.com',href:'https://example.amazon.com/',pathname:'/',hostname:'example.amazon.com'},globalThis:null};
context.V3={};context.globalThis=context;context.window=context;
vm.createContext(context);
for(const file of ['core.js','actions.js','aft.js','sideline.js']){
  vm.runInContext(fs.readFileSync(path.join(root,'src',file),'utf8'),context,{filename:file});
}
const A=context.V3.actions;
assert.equal(A.destination('P3','Cubiscan'),'dz-Pcubiscan-P3');
assert.equal(A.destination('P1','P1-Nonsort'),'dz-P-IB-nonsort');
assert.equal(A.destination('P4','PRIME'),'dz-P-PRIME');
assert.equal(A.normalizeFacility(' bwu1 '),'BWU1');
assert.equal(A.normalizeFacility('AVV2'),'AVV2');
assert.equal(A.normalizeFacility('bad fc'),'');
assert.equal(A.tokenFromBody('{"destinationWarehouseId":"opaque-123"}'),'opaque-123');
assert.equal(A.tokenFromBody('destinationWarehouseId=opaque-456'),'opaque-456');
assert.equal(A.facilityFromResponse('"BWU1"'),'BWU1');

const aft=context.V3.aft;
assert.equal(aft.mapState('Sellable'),'INVENTORY');
assert.equal(aft.mapState('Pending Research'),'PENDING_RESEARCH');
assert.equal(aft.mapState('Unsellable'),'UNSELLABLE');
assert.equal(aft.mapDamage('Defective'),'DEFECTIVE');

const sideline=context.V3.sideline;
const overage={'@type':'ItemNotInContainerResponse',success:false,message:'Item not in source container',items:[{quantity:0,skuDetail:{asin:'B012345678',fnSku:'X000000000',fcSku:'FC123',hazmat:false,datelotDetail:{},itemDropzoneRecommendation:{permissionLevel:'ALLOW'}}}]};
assert.equal(sideline.allowedOverage(overage),true);
assert.notEqual(sideline.classify(overage,'X000000000').kind,'red');
assert.equal(sideline.classify({'@type':'InvalidBarcodeResponse',success:false},'BAD').kind,'red');

console.log('PASS domain');