const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const path=require('path');
const obs=fs.readFileSync(path.join(__dirname,'..','BWU2_Observability_Core.user.js'),'utf8');
const fleet=fs.readFileSync(path.join(__dirname,'..','BWU2_Fleet_Core.lib.js'),'utf8');
function fn(source,name){let start=source.indexOf('  function '+name+'(');assert(start>=0,name);let end=source.indexOf('\n  }',start)+5;return source.slice(start,end)}
const constants=['SENSITIVE_KEY','IDENTIFIER_KEY','SAFE_SOURCE_VALUE','SAFE_QUERY_KEY','MAX_BODY_CHARS'].map(name=>{const line=obs.split('\n').find(l=>l.includes('const '+name+' ='));assert(line,name);return line}).join('\n');
const code=constants+'\n'+['clip','hash','fingerprint','scrubText','sanitizePath','sanitizeUrl','sanitize','add','installScriptBus'].map(n=>fn(obs,n)).join('\n');
function verify(fallback){
 const handlers={},win={addEventListener:(name,f)=>handlers[name]=f};win.postMessage=data=>handlers.message({source:win,data});
 const c={window:win,W:win,location:{href:'https://offline.test/BWU2/results?s=TEST',hostname:'offline.test'},URL,Date,performance:{now:()=>100},MAX_EVENTS:6000,pageId:'offline',pageEvents:[],eventSeq:0,lastGlobalCount:0,full:false,sessionCount:()=>0,syncSession(){},scheduleFlush(){},renderUi(){},rememberRuntimeVersion:()=>false,scheduleRuntimeVersions(){}};
 vm.createContext(c);vm.runInContext(code+'\ninstallScriptBus();',c);
 if(fallback)delete win.BWU2Trace;
 vm.runInContext(fn(fleet,'trace')+'\nthis.fleetTrace=trace;',c);
 const event={script:'BIN_OVERLAY',version:'7.4.15',run:1,pod:'P-1-A000B000',sequence:3,attempt:2,httpStatus:429,durationMs:294,responseChars:0,errorKind:'http',floorFound:false,sizeFound:false,outcome:'retry',willRetry:true,retryInMs:30000,gapMs:800};
 c.fleetTrace('BIN_OVERLAY_RESULT',event);
 const saved=c.pageEvents[0];assert.equal(saved.type,'script.BIN_OVERLAY_RESULT');assert.equal(saved.data.httpStatus,429);assert.equal(saved.data.durationMs,294);assert.equal(saved.data.sequence,3);assert.equal(saved.data.run,1);assert.equal(saved.data.gapMs,800);assert.equal(saved.data.willRetry,true);assert(saved.data.pod.startsWith('<pod#'));assert(!JSON.stringify(saved).includes('P-1-A000B000'));
 const summary={script:'BIN_OVERLAY',version:'7.4.15',run:1,total:300,ready:299,pending:0,failed:1,requests:302,cacheHits:20,retries:22,throttles:1,timeouts:0,httpStatusCounts:{200:301,429:1},elapsedMs:90000,pausedMs:1000,averageMs:294,p95Ms:400,requestsPerSecond:3.36,gapMs:800,peakInFlight:1,accelerationBlocked:true};
 c.fleetTrace('BIN_OVERLAY_SCAN_SUMMARY',summary);const got=c.pageEvents[1].data;
 for(const key of Object.keys(summary))assert.deepEqual(JSON.parse(JSON.stringify(got[key])),summary[key]);
 c.fleetTrace('BIN_OVERLAY_RATE_CHANGE',{script:'BIN_OVERLAY',version:'7.4.15',run:1,reason:'clean-window',previousGapMs:400,gapMs:375,cleanLookups:20});assert.equal(c.pageEvents[2].data.previousGapMs,400);
 c.fleetTrace('BIN_OVERLAY_DIAGNOSTIC',{authorization:'SYNTHETIC_SECRET',pod:'P-1-A000B000'});assert.equal(c.pageEvents[3].data.authorization,'<redacted>');
 console.log('PASS actual Fleet '+(fallback?'postMessage fallback':'direct trace')+' → OBS bus → sanitized export record; timing/rate/status correlation retained and identifiers scrubbed');
}
verify(false);verify(true);
console.log('OBS 0.1.44 already captures the required events. No OBS source change or added network probes required.');

