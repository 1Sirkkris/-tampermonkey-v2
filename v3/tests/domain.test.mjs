import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const context={
  console,
  crypto,
  performance,
  DOMException,
  location:{
    origin:'https://example.amazon.com',
    hostname:'example.amazon.com',
    pathname:'/BWU2/results',
    href:'https://example.amazon.com/BWU2/results'
  }
};
context.V3={};
vm.createContext(context);

for(const file of [
  ['core','base.js'],
  ['core','telemetry.js'],
  ['core','operation.js'],
  ['services','movecontainer.js'],
  ['services','aft.js'],
  ['services','sideline.js']
]){
  vm.runInContext(
    fs.readFileSync(path.join(root,'src',file[0],file[1]),'utf8'),
    context,
    {filename:file.join('/')}
  );
}

assert.equal(context.V3.moveContainer.destination('P3','Cubiscan'),'dz-Pcubiscan-P3');
assert.equal(context.V3.moveContainer.destination('P1','Nonsort'),'dz-P-IB-nonsort');
assert.equal(context.V3.moveContainer.destination('P4','PRIME'),'dz-P-PRIME');

assert.equal(context.V3.aft.mapState('Sellable'),'INVENTORY');
assert.equal(context.V3.aft.mapState('Pending Research'),'PENDING_RESEARCH');
assert.equal(context.V3.aft.mapState('Unsellable'),'UNSELLABLE');
assert.equal(context.V3.aft.mapDamage('Amazon Damage'),'AMAZON_DAMAGE');
assert.equal(context.V3.aft.mapDamage('Defective'),'DEFECTIVE');
assert.equal(context.V3.aft.mapDamage('Distributor Damage'),'DISTRIBUTOR_DAMAGE');
assert.equal(context.V3.aft.mapDamage('Expired'),'EXPIRED');
assert.deepEqual(
  JSON.parse(JSON.stringify(context.V3.aft.readMoveQuantity('Quantity: 7'))),
  {qty:7,verify:false}
);
assert.equal(context.V3.aft.readMoveQuantity('Verify item').verify,true);

const overage={
  '@type':'ItemNotInContainerResponse',
  success:false,
  message:'Item not in source container',
  items:[{
    quantity:0,
    skuDetail:{
      asin:'B012345678',
      fnSku:'X000000000',
      fcSku:'FC123',
      hazmat:false,
      datelotDetail:{},
      itemDropzoneRecommendation:{permissionLevel:'ALLOW'}
    }
  }]
};
assert.equal(context.V3.sideline.allowedOverage(overage),true);
assert.notEqual(context.V3.sideline.classify(overage,'X000000000').kind,'red');

const invalid={'@type':'InvalidBarcodeResponse',success:false};
assert.equal(context.V3.sideline.classify(invalid,'BAD').kind,'red');

assert.equal(
  context.V3.sideline.hazmatRejected({success:false,message:'Hazmat restriction'}),
  true
);

console.log('PASS domain');
