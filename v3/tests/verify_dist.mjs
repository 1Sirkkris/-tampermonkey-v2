import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'build','manifest.json'),'utf8'));

const forbidden=[
  ['runtime @require',/^\s*\/\/\s*@require\s+/m],
  ['V2 Fleet global',/\bBWU2Fleet\b/],
  ['V2 Actions global',/\bBWU2Actions\b/],
  ['V2 FCR guard',/__bwu2FcrMaster\b/],
  ['V2 Lite guard',/__bwu2FcLite\b/],
  ['V2 ISS guard',/__bwu2IssConsole\b/],
  ['V2 hierarchy guard',/__bwu2(?:Bind|Unbind|Hierarchy)Queue\b/],
  ['V2 main raw dependency',/raw\.githubusercontent\.com\/1Sirkkris\/-tampermonkey-v2\/main\//],
  ['old Sideline identity',/__sidelineRebuildTest|Sideline_REBUILD_TEST/],
  ['standalone Unbind identity',/Unbind_Hierarchy_Queue/],
  ['dead ASIN variation tool',/Amazon_ASIN_Variation_Finder_TEST/]
];

let failed=false;
for(const suite of manifest.suites){
  const file=path.join(root,'dist',suite.output);
  const source=fs.readFileSync(file,'utf8');
  try{new Function(source);}catch(error){console.error('SYNTAX '+suite.output+' '+error.message);failed=true;continue;}
  const hits=forbidden.filter(([,re])=>re.test(source)).map(([label])=>label);
  if(hits.length){console.error('FAIL '+suite.output+': '+hits.join(', '));failed=true;}
  else console.log('PASS '+suite.output);
}
if(failed)process.exit(1);
