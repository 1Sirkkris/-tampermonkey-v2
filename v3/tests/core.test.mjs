import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const context={console,crypto,performance,DOMException,setTimeout,clearTimeout,setInterval,clearInterval,URL,location:{origin:'https://example.amazon.com',href:'https://example.amazon.com/',pathname:'/',hostname:'example.amazon.com'},globalThis:null};
context.globalThis=context;context.window=context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'src','core.js'),'utf8'),context,{filename:'core.js'});
const C=context.V3.core;

assert.equal(C.clean('  a   b  '),'a b');
assert.equal(C.upper(' bwu1 '),'BWU1');
assert.equal(C.container('tsX123'),true);
assert.equal(C.container('abc'),false);
assert.deepEqual(JSON.parse(JSON.stringify(C.lines('a\na\nb'))),['a','b']);

const op=C.operation({kind:'test',ref:'abc'});
assert.equal(op.state,'PREPARED');
op.submitted();
assert.equal(op.state,'SUBMITTED');
op.unknown();
assert.equal(op.state,'UNKNOWN');
assert.throws(()=>op.confirmed(),/terminal/);

console.log('PASS core');