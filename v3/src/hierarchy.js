V3.hierarchy = (() => {
  const C = V3.core;
  const ORIGIN = 'https://tx-b-hierarchy-nrt.nrt.proxy.amazon.com', WAREHOUSE = 'BWU2';
  const PATH = Object.freeze({validate:'/validateContainer',summary:'/getTransshipmentBindingSummary',destination:'/validateDestination',bind:'/forceBind',unbind:'/unbindContainer'});
  const EVENT = 'bwu2-v3:hierarchy-response';
  const normalizeFacility = value => /^[A-Z0-9]{3,8}$/.test(C.upper(value)) ? C.upper(value) : '';
  const same = (a,b) => C.lower(a) === C.lower(b);
  const cancelled = () => Object.assign(new Error('Paused before Hierarchy submission'),{outcome:'cancelled'});
  const parseBody = body => {
    if (body == null) return {};
    if (typeof body === 'string') { try { return JSON.parse(body); } catch { return Object.fromEntries(new URLSearchParams(body)); } }
    if (body instanceof URLSearchParams || body instanceof FormData) return Object.fromEntries(body);
    return typeof body === 'object' ? body : {};
  };
  const tokenFromBody = body => C.clean(parseBody(body)?.destinationWarehouseId);
  const facilityFromResponse = data => {
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch {} }
    return normalizeFacility(typeof data === 'string' ? data : data?.warehouseId || data?.destination || data?.facility || data?.fc);
  };
  const errorResponse = data => data?.success === false || data?.error || data?.errorMessage;
  const assertValidation = (data,code) => {
    if (!data || typeof data !== 'object' || errorResponse(data)) throw new Error('Unexpected hierarchy validation response');
    if (C.upper(data.warehouseId) !== WAREHOUSE) throw new Error('Container is not validated in '+WAREHOUSE);
    if (!same(data.scannableId,code)) throw new Error('Validation returned another container');
  };
  const assertSummary = data => {
    if (!Array.isArray(data?.transferBindingSummaryList) || errorResponse(data)) throw new Error('Unexpected binding summary');
  };
  const responseRoute = (result,path) => {
    try { const url = new URL(result.finalUrl || ORIGIN+path);return url.origin === ORIGIN && url.pathname === path; } catch { return false; }
  };
  const cleanResponse = (result,path) => Number.isInteger(result?.status) && result.status >= 200 && result.status < 300 &&
    !result.flags?.auth && !result.flags?.html && responseRoute(result,path);
  const assertRead = (result,path) => {
    if (!cleanResponse(result,path)) throw new Error('Hierarchy validation response was not confirmed');
    return result.data;
  };
  const mutationResult = (result,path,code,destination) => {
    const status = Number(result?.status);
    if (!Number.isInteger(status) || status <= 0 || status >= 500 || status === 408 || result.flags?.auth || result.flags?.html || !responseRoute(result,path))
      throw new C.UnknownError('Hierarchy response ambiguous — verify container');
    if (status < 200 || status >= 300) throw new C.RejectedError('Hierarchy rejected HTTP '+status);
    // hostName is the known V2 mutation response contract. Contradictory fields are never confirmation.
    if (typeof result.data?.hostName !== 'string' || !C.clean(result.data.hostName) || errorResponse(result.data) ||
      (result.data.scannableId != null && !same(result.data.scannableId,code)) ||
      (destination && result.data.destinationWarehouseId != null && result.data.destinationWarehouseId !== destination))
      throw new C.UnknownError('Hierarchy response did not prove the requested mutation — verify container');
    return result.data;
  };
  const post = (path,body,options={}) => C.request(ORIGIN+path,{method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json'},timeout:15000,...options});
  async function validateContainer(container) {
    const code = C.clean(container),result = await post(PATH.validate,{warehouseId:WAREHOUSE,scannableId:code});
    const data = assertRead(result,PATH.validate);assertValidation(data,code);return data;
  }
  async function bindingSummary(container) {
    const result = await post(PATH.summary,{warehouseId:WAREHOUSE,scannableId:C.clean(container)});
    const data = assertRead(result,PATH.summary);assertSummary(data);return data;
  }
  async function unbind(container,login,{telemetry,maySubmit=()=>true}={}) {
    const code = C.clean(container),employee = C.normLogin(login);
    if (!C.container(code)) throw new Error('Container must be tsX/csX');
    if (!employee) throw new Error('Authenticated employee identity unavailable');
    if (!maySubmit()) throw cancelled();
    await validateContainer(code);await bindingSummary(code);
    if (!maySubmit()) throw cancelled();
    const op = C.operation({kind:'hierarchy-unbind',ref:code,scope:'hierarchy',telemetry});op.submitted();
    try {
      const result = await post(PATH.unbind,{sourceWarehouseId:WAREHOUSE,scannableId:code,employeeLogin:employee},{timeout:20000,allowHttpError:true});
      const data = mutationResult(result,PATH.unbind,code);op.confirmed({status:result.status});return data;
    } catch (error) {
      if (error instanceof C.RejectedError) { op.rejected({reason:error.message});throw error; }
      op.unknown({reason:'unbind-confirmation-missing'});
      throw new C.UnknownError('Unbind submitted; result unproven — verify before retry',{cause:error});
    }
  }

  // Observe only native Hierarchy contracts; never send a Bind API request or retain credentials.
  let sequence = 0, latestDestination = 0, destinationRecord = null, revision = 0, installed = false;
  const records = [], watchedInputs = new WeakSet();
  const endpoint = value => {
    try { const url = new URL(String(value || ''),location.href);return url.origin === ORIGIN &&
      [PATH.validate,PATH.summary,PATH.destination,PATH.bind].includes(url.pathname) ? url.pathname : ''; } catch { return ''; }
  };
  const notify = () => window.dispatchEvent(new Event(EVENT));
  const begin = (path,method,body) => {
    const data = parseBody(body);
    const record = {seq:++sequence,path,method:C.upper(method),request:{scannableId:C.clean(data?.scannableId),warehouseId:C.upper(data?.warehouseId),sourceWarehouseId:C.clean(data?.sourceWarehouseId),destinationWarehouseId:C.clean(data?.destinationWarehouseId)},done:false};
    if (path === PATH.destination) { latestDestination = record.seq;destinationRecord = record; }
    records.push(record);if(records.length > 32) records.shift();notify();return record;
  };
  const finish = (record,status,raw,finalUrl,contentType='') => {
    let data;try { data = JSON.parse(raw); } catch { data = raw; }
    // Retain only fields used for proof; summary contents and employee identity are unnecessary.
    record.result = {status:Number(status)||0,finalUrl:finalUrl || ORIGIN+record.path,
      flags:V3.transport.authLike(status,contentType,finalUrl,raw),data:typeof data === 'object' && data ? {
        warehouseId:data.warehouseId,scannableId:data.scannableId,hostName:data.hostName,destinationWarehouseId:data.destinationWarehouseId,
        success:data.success,error:Boolean(data.error),errorMessage:Boolean(data.errorMessage),
        transferBindingSummaryList:Array.isArray(data.transferBindingSummaryList)?[]:undefined,
        destination:data.destination,facility:data.facility,fc:data.fc
      }:data};record.done = true;notify();
  };
  function installNativeTap() {
    if (installed) return;installed = true;
    const page = typeof unsafeWindow === 'object' && unsafeWindow ? unsafeWindow : window;
    const XHR = page.XMLHttpRequest;
    if (XHR?.prototype) {
      const nativeOpen = XHR.prototype.open,nativeSend = XHR.prototype.send,requests = new WeakMap();
      XHR.prototype.open = function(method,url) { const result = nativeOpen.apply(this,arguments);requests.set(this,{path:endpoint(url),method});return result; };
      XHR.prototype.send = function(body) {
        const request = requests.get(this);
        if (request?.path) {
          const record = begin(request.path,request.method,body);
          this.addEventListener('loadend',() => {
            let raw = '',contentType = '';try { raw = this.responseType === 'json' ? JSON.stringify(this.response) : this.responseText;contentType = this.getResponseHeader('content-type') || ''; } catch {}
            finish(record,this.status,raw,this.responseURL,contentType);
          },{once:true});
          try { return nativeSend.apply(this,arguments); } catch (error) { finish(record,0,'','');throw error; }
        }
        return nativeSend.apply(this,arguments);
      };
    }
    const nativeFetch = page.fetch;
    if (typeof nativeFetch === 'function') page.fetch = function(input,init) {
      const path = endpoint(typeof input === 'string' || input instanceof URL ? input : input?.url);
      if (!path) return nativeFetch.apply(this,arguments);
      const record = begin(path,init?.method || input?.method || 'GET',init?.body);
      // Clone a Request body without consuming the native request. Sequence belongs to request start.
      const bodyReady = init?.body == null && typeof input?.clone === 'function' ?
        input.clone().text().then(body => { const data = parseBody(body);record.request = {scannableId:C.clean(data?.scannableId),warehouseId:C.upper(data?.warehouseId),sourceWarehouseId:C.clean(data?.sourceWarehouseId),destinationWarehouseId:C.clean(data?.destinationWarehouseId)}; }).catch(()=>{}) : Promise.resolve();
      let response;
      try { response = nativeFetch.apply(this,arguments); } catch (error) { finish(record,0,'','');throw error; }
      return Promise.resolve(response).then(value => {
        void bodyReady.then(async()=>{try { finish(record,value.status,await value.clone().text(),value.url,value.headers?.get('content-type') || ''); } catch { finish(record,value.status,'',value.url); }});
        return value;
      },error => { finish(record,0,'','');throw error; });
    };
  }
  const destinationInput = () => V3.native.findInput(/destination|warehouse|facility|\bfc\b/,/container|scannable|tote/);
  const containerInput = () => V3.native.findInput(/container|scannable|scan|tote/,/destination|warehouse|facility|\bfc\b/);
  const waitFor = (predicate,life,timeout=12000) => V3.native.waitFor(predicate,{life,timeout,events:[EVENT]});
  const after = (path,marker,predicate=()=>true) => records.find(record=>record.seq>marker && record.path===path && predicate(record));
  const sameContainer = code => record => record.method === 'POST' && same(record.request.scannableId,code);
  function assertContext(context) {
    const proof = destinationRecord,fc = normalizeFacility(context?.facility);
    if (!fc || !context?.destinationWarehouseId || context.revision!==revision || latestDestination!==context.proofSeq ||
      !proof?.done || !cleanResponse(proof.result,PATH.destination) || facilityFromResponse(proof.result.data)!==fc ||
      proof.request.destinationWarehouseId!==context.destinationWarehouseId)
      throw new Error('Destination changed — fresh native validation required');
    return fc;
  }
  async function validateDestinationNative(destination,{life,telemetry}={}) {
    const fc = normalizeFacility(destination);if(!fc) throw new Error('Enter destination FC, e.g. BWU1 or AVV2');
    installNativeTap();const marker = sequence,input = destinationInput();if(!input) throw new Error('Native destination field not found');
    if (!watchedInputs.has(input)) { watchedInputs.add(input);for(const event of ['input','change'])input.addEventListener(event,()=>revision++); }
    V3.native.setValue(input,fc);try { input.focus({preventScroll:true}); } catch {}V3.native.enter(input);
    const proof = await waitFor(()=>{
      const record = after(PATH.destination,marker,record=>record.method==='POST' && record.seq===latestDestination);
      if (!record?.done) return false;
      if (!cleanResponse(record.result,PATH.destination) || facilityFromResponse(record.result.data)!==fc || !record.request.destinationWarehouseId)
        throw new Error('Native destination validation did not prove '+fc);
      return record;
    },life,10000);
    telemetry?.emit('hierarchy.destination.validated',{destination:fc});
    return Object.freeze({facility:fc,destinationWarehouseId:proof.request.destinationWarehouseId,proofSeq:proof.seq,revision});
  }
  const nativeScan = (code,beforeEnter) => {
    const input = containerInput();if(!input) throw new Error('Native container scan field not found');
    V3.native.setValue(input,code);try { input.focus({preventScroll:true}); } catch {}beforeEnter?.();V3.native.enter(input);
  };
  async function bindNative(container,context,{life,telemetry,maySubmit=()=>true}={}) {
    const code = C.clean(container);if(!C.container(code)) throw new Error('Container must be tsX/csX');
    const fc = assertContext(context);if(!maySubmit()) throw cancelled();
    const marker = sequence,op = C.operation({kind:'hierarchy-bind',ref:code,scope:'hierarchy',telemetry});
    // The native page may already be at confirmation: even the first scan can submit a mutation.
    op.submitted({destination:fc});
    let scanned=false,safeToCancel=false;
    try {
      nativeScan(code,()=>{scanned=true;});
      const stage = await waitFor(()=>{
        const bound = after(PATH.bind,marker);if(bound) return {bound};
        const validation = after(PATH.validate,marker,sameContainer(code)),summary = after(PATH.summary,marker,sameContainer(code));
        if(validation?.done) { assertValidation(assertRead(validation.result,PATH.validate),code);if(validation.request.warehouseId!==WAREHOUSE)throw new Error('Native validation used another warehouse'); }
        if(summary?.done) { assertSummary(assertRead(summary.result,PATH.summary));if(summary.request.warehouseId!==WAREHOUSE)throw new Error('Native summary used another warehouse'); }
        const input = containerInput();
        return validation?.done && summary?.done && input && !input.disabled && !same(input.value,code) ? {ready:true} : false;
      },life);
      let bound = stage.bound;
      if (!bound) {
        safeToCancel=true;
        if(!maySubmit()) throw cancelled();assertContext(context);
        const secondMarker = sequence;nativeScan(code,()=>{safeToCancel=false;});
        bound = await waitFor(()=>after(PATH.bind,secondMarker),life,15000);
      }
      await waitFor(()=>bound.done,life,15000);
      // Success text has no authority. Both the native request and response must match this operation.
      if(records.filter(record=>record.seq>marker && record.path===PATH.bind).length!==1 || bound.method!=='POST' || !same(bound.request.scannableId,code) || !bound.request.sourceWarehouseId ||
        bound.request.destinationWarehouseId!==context.destinationWarehouseId)
        throw new C.UnknownError('Native Bind request did not match container/destination');
      assertContext(context);mutationResult(bound.result,PATH.bind,code,context.destinationWarehouseId);
      op.confirmed({destination:fc,status:bound.result.status});return {container:code,destination:fc};
    } catch(error) {
      const submitted = after(PATH.bind,marker);
      if((!scanned || (safeToCancel && !submitted)) || error instanceof C.RejectedError) { op.rejected({reason:C.clean(error.message)});throw error; }
      op.unknown({reason:'native-bind-confirmation-missing'});
      throw new C.UnknownError('Bind submitted; requested result unproven — verify container',{cause:error});
    }
  }
  const owned = fn => (...args) => V3.state.exclusive('hierarchy',()=>{V3.state.assertClear('hierarchy');return fn(...args);});
  return Object.freeze({ORIGIN,WAREHOUSE,normalizeFacility,tokenFromBody,facilityFromResponse,validateContainer,bindingSummary,
    validateDestinationNative,bindNative:owned(bindNative),unbind:owned(unbind)});
})();
