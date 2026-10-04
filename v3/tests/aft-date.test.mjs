import assert from 'node:assert/strict';
import {harness} from './harness.mjs';
const row=(date,asin='B012345678')=>({location:'tsX1',asin,date});
const result=data=>({status:200,data,raw:JSON.stringify(data),httpError:false});
function fixture({failItem='',failReplacement=false}={}){
 const h=harness({url:'https://aft-qt-jp.aka.nrt.corp.amazon.com/app/edititems',modules:['core.js','state.js','transport.js','identity.js','native.js','aft.js']});
 let id=1,phase='mode',status='READY',removed=false,calls=0,removals=0,confirmed=0;
 const headings={mode:'Select mode',location:'Scan location',item:'Input FNSKU or FCSKU',remove:'Confirm expiry date removal',date:'Enter expiry date',confirm:'Confirm new expiry date',success:'Success items changed'};
 h.V3.transport={request:async(url,options={})=>{
  calls++;const path=new URL(url).pathname;
  if(options.method!=='POST')return {raw:'<script>'+JSON.stringify({instructionId:'EditItems',objectId:'workflow-'+id,status,tool:'edititems'})+'</script><h1>'+headings[phase]+'</h1>'+(phase==='mode'?'<input name="options">':'')};
  const body=JSON.parse(options.body);
  if(path==='/status')return result({status});
  if(path==='/end'){id++;phase='location';status='READY';return result({});}
  assert.equal(path,'/action');
  if(body.action==='Input'){
   if(phase==='mode'){phase='location';status='COMPLETE';}
   else if(phase==='location')phase='item';
   else if(phase==='item'){if(body.input===failItem)throw new Error('fixture read/input failure');phase=removed?'date':'remove';}
   else if(phase==='date'){if(failReplacement)throw new Error('fixture replacement failure');phase='confirm';}
   else throw new Error('Unexpected input '+phase);
  }else if(body.action==='Confirm'){
   if(phase==='remove'){removals++;removed=true;phase='date';}
   else {assert.equal(phase,'confirm');confirmed++;phase='success';removed=false;}
  }else if(body.action==='Done')status='COMPLETE';
  return result({});
 }};
 const life=h.V3.core.lifecycle('date-test'),engine=h.V3.aft.create({life});
 return {h,engine,counts:()=>({calls,removals,confirmed})};
}
for(const rows of [[row('2026-02-31')],[row('2026-02-28'),row('2026-02-29')],[row('2026-2-28')]]){
 const f=fixture();try{await assert.rejects(f.engine.runDate({rows}),/Invalid date/);assert.deepEqual(f.counts(),{calls:0,removals:0,confirmed:0});}finally{f.h.close();}
}
const valid=fixture();try{
 const output=await valid.engine.runDate({rows:[row('2028-02-29')]});assert.equal(output.confirmed,1);assert.equal(valid.counts().removals,1);assert.equal(valid.counts().confirmed,1);
}finally{valid.h.close();}
const interrupted=fixture({failReplacement:true});try{
 await assert.rejects(interrupted.engine.runDate({rows:[row('2026-02-28'),row('2026-03-01','B012345679')]}),error=>{
  assert.equal(error.outcome,'unknown');assert.equal(error.aftPartial.uncertain.length,1);assert.equal(error.aftPartial.remaining.length,1);return true;
 });assert.equal(interrupted.h.V3.state.attention('aft').state,'UNKNOWN');assert.equal(interrupted.counts().removals,1);assert.equal(interrupted.counts().confirmed,0);
}finally{interrupted.h.close();}
const partial=fixture({failItem:'B012345679'});try{
 await assert.rejects(partial.engine.runDate({rows:[row('2026-02-28'),row('2026-03-01','B012345679')]}),error=>{
  assert.equal(error.aftPartial.confirmed,1);assert.equal(error.aftPartial.remaining.length,1);assert.equal(error.aftPartial.remaining[0].asin,'B012345679');return true;
 });assert.equal(partial.counts().confirmed,1);
}finally{partial.h.close();}
console.log('PASS AFT dates: whole-batch prevalidation, leap date, removal/replacement review, completed rows excluded');
