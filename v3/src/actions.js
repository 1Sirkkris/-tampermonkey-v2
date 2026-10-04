V3.actions=(()=>{
  const C=V3.core;
  const MOVE_ORIGIN='https://aft-moveapp-nrt-nrt.nrt.proxy.amazon.com';
  const HIERARCHY_ORIGIN='https://tx-b-hierarchy-nrt.nrt.proxy.amazon.com';
  const WAREHOUSE='BWU2';
  const MOVE_PATH='/api/move-container';
  const HIERARCHY={validate:'/validateContainer',summary:'/getTransshipmentBindingSummary',unbind:'/unbindContainer',destination:'/validateDestination'};
  const FLOORS=['P1','P2','P3','P4'];
  const UPPER=[
    {key:'Cubiscan',label:'Cubiscan',pattern:'dz-Pcubiscan-{floor}'},
    {key:'Damages',label:'Damages',pattern:'dz-P-Damages-{floor}'},
    {key:'Hazmat',label:'Hazmat',pattern:'dz-P-Hazmat-{floor}'},
    {key:'ISS',label:'ISS',pattern:'dz-P-ISS-{floor}'},
    {key:'Non-Sort',label:'Non-Sort',pattern:'dz-Pnonsort-{floor}'},
    {key:'Prep',label:'Prep',pattern:'dz-P-Prep-{floor}'}
  ];
  const P1=[
    {key:'P1-Hazmat',label:'Hazmat',dest:'dz-P-HAZMAT_OUT'},
    {key:'P1-Ticketland',label:'Ticketland',dest:'dz-P-Ticketland'},
    {key:'P1-Consolidation',label:'Consolidation',dest:'dz-P-issconsol'},
    {key:'P1-ISS-WIP',label:'ISS WIP',dest:'dz-S-ISSWIP1'},
    {key:'P1-Nonsort',label:'Nonsort',dest:'dz-P-IB-nonsort'},
    {key:'P1-Shipdock',label:'Shipdock',dest:'dz-P-ISS-Shipdock'},
    {key:'P1-OBIOL',label:'OB IOL',dest:'dz-P-OBIOL'},
    {key:'P1-Damageland',label:'Damageland',dest:'dz-Pdamageland'},
    {key:'P1-Receive-Damages',label:'Receive Damages',dest:'dz-P-rcv-Damages'}
  ];

  const dropChoices=floor=>floor==='P1'?P1:UPPER;
  const destination=(floor,key)=>{
    if(key==='PRIME'||key==='Prime')return'dz-P-PRIME';
    if(!FLOORS.includes(floor))return'';
    const row=dropChoices(floor).find(x=>x.key===key||x.label===key);
    return row?(floor==='P1'?row.dest:row.pattern.replace('{floor}',floor)):'';
  };

  const movePayload=(container,dest)=>({sourceScannableId:null,destinationScannableId:C.clean(dest),containerScannableId:C.clean(container),confirmed:'true'});
  const strictMoveConfirmation=result=>{
    if(!result||Number(result.status)<200||Number(result.status)>=300)throw new C.RejectedError('MoveContainer rejected HTTP '+Number(result?.status||0));
    if(result.flags?.auth||result.flags?.html)throw new C.UnknownError('MoveContainer confirmation was an authentication/HTML response');
    const expected=new URL(MOVE_ORIGIN+MOVE_PATH);
    const actual=new URL(result.finalUrl||expected.href,expected.href);
    if(actual.pathname.replace(/\/+$/,'')!==expected.pathname.replace(/\/+$/,''))throw new C.UnknownError('MoveContainer confirmation redirected unexpectedly');
    return result;
  };
  async function moveContainer(container,dest,{telemetry}={}){
    const code=C.clean(container),target=C.clean(dest);
    if(!C.container(code))throw new Error('Container must be tsX/csX');
    if(!target)throw new Error('Destination required');
    const op=C.operation({kind:'move-container',ref:code,telemetry});op.submitted({destination:target});
    let result;
    try{
      result=await C.request(MOVE_ORIGIN+MOVE_PATH,{method:'POST',body:JSON.stringify(movePayload(code,target)),headers:{'Content-Type':'application/json'},timeout:15000,allowHttpError:true});
    }catch(error){op.unknown({reason:'transport'});throw new C.UnknownError('Move submitted; confirmation lost — verify before retry',{cause:error});}
    try{
      strictMoveConfirmation(result);
      op.confirmed({status:result.status,destination:target});
      return result;
    }catch(error){
      if(error instanceof C.RejectedError){op.rejected({status:result.status});throw error;}
      op.unknown({status:result.status,reason:C.clean(error.message)});throw error;
    }
  }

  async function hierarchyPost(path,body,{timeout=15000,allowHttpError=false}={}){
    return C.request(HIERARCHY_ORIGIN+path,{method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json'},timeout,allowHttpError});
  }
  async function validateContainer(container){
    const code=C.clean(container),r=await hierarchyPost(HIERARCHY.validate,{warehouseId:WAREHOUSE,scannableId:code});
    if(!r.data||typeof r.data!=='object')throw new Error('Unexpected hierarchy validation response');
    if(C.upper(r.data.warehouseId)!==WAREHOUSE)throw new Error('Container is not validated in '+WAREHOUSE);
    if(r.data.scannableId&&C.lower(r.data.scannableId)!==C.lower(code))throw new Error('Validation returned another container');
    return r.data;
  }
  async function bindingSummary(container){
    const code=C.clean(container),r=await hierarchyPost(HIERARCHY.summary,{warehouseId:WAREHOUSE,scannableId:code});
    if(!Array.isArray(r.data?.transferBindingSummaryList))throw new Error('Unexpected binding summary');
    return r.data;
  }
  async function unbind(container,login,{telemetry}={}){
    const code=C.clean(container),employee=C.normLogin(login);
    if(!C.container(code))throw new Error('Container must be tsX/csX');
    if(!employee)throw new Error('Authenticated employee identity unavailable');
    await validateContainer(code);await bindingSummary(code);
    const op=C.operation({kind:'hierarchy-unbind',ref:code,telemetry});op.submitted();
    let r;
    try{r=await hierarchyPost(HIERARCHY.unbind,{sourceWarehouseId:WAREHOUSE,scannableId:code,employeeLogin:employee},{timeout:20000,allowHttpError:true});}
    catch(error){op.unknown({reason:'transport'});throw new C.UnknownError('Unbind submitted; confirmation lost — verify before retry',{cause:error});}
    if(r.status>=500){op.unknown({status:r.status});throw new C.UnknownError('Unbind HTTP '+r.status+' — verify before retry');}
    if(r.status<200||r.status>=300){op.rejected({status:r.status});throw new C.RejectedError('Unbind rejected HTTP '+r.status);}
    if(!C.clean(r.data?.hostName)){op.unknown({reason:'unexpected-response'});throw new C.UnknownError('Unbind response ambiguous — verify container');}
    op.confirmed({status:r.status});return r.data;
  }

  // Bind deliberately uses the native page. The only native network traffic observed
  // is /validateDestination, solely to map the user's typed FC to Amazon's opaque ID.
  const FACILITY=/^[A-Z0-9]{3,8}$/;
  const normalizeFacility=value=>{const fc=C.upper(value);return FACILITY.test(fc)?fc:'';};
  let destinationSeq=0;
  const destinationProofs=[];
  const endpointPath=value=>{try{return new URL(String(value||''),location.href).pathname;}catch{return'';}};
  const tokenFromBody=body=>{
    if(body==null)return'';
    if(typeof body==='object'){
      try{
        if(typeof FormData!=='undefined'&&body instanceof FormData)return C.clean(body.get('destinationWarehouseId'));
        if(typeof URLSearchParams!=='undefined'&&body instanceof URLSearchParams)return C.clean(body.get('destinationWarehouseId'));
        return C.clean(body.destinationWarehouseId);
      }catch{return'';}
    }
    const raw=String(body);
    try{return C.clean(JSON.parse(raw)?.destinationWarehouseId);}catch{}
    const match=raw.match(/(?:^|&)destinationWarehouseId=([^&]*)/);
    if(!match)return'';
    try{return C.clean(decodeURIComponent(match[1].replace(/\+/g,' ')));}catch{return C.clean(match[1]);}
  };
  const facilityFromResponse=raw=>{
    let value=raw;
    if(typeof raw==='string'){try{value=JSON.parse(raw);}catch{}}
    if(typeof value==='string')return normalizeFacility(value);
    if(value&&typeof value==='object')return normalizeFacility(value.warehouseId||value.destination||value.facility||value.fc||'');
    return'';
  };
  const recordDestination=(token,facility,status)=>{if(!token||!facility)return;destinationProofs.push({seq:++destinationSeq,token,facility,status:Number(status)||0,at:Date.now()});if(destinationProofs.length>12)destinationProofs.splice(0,destinationProofs.length-12);};
  function installDestinationTap(){
    const page=typeof unsafeWindow==='object'&&unsafeWindow?unsafeWindow:window;
    try{
      const XHR=page.XMLHttpRequest;
      if(XHR?.prototype&&!XHR.prototype.__bwu2V3GroundDestinationTap){
        const nativeOpen=XHR.prototype.open,nativeSend=XHR.prototype.send;
        XHR.prototype.open=function(method,url){this.__bwu2V3GroundDestinationPath=endpointPath(url);return nativeOpen.apply(this,arguments);};
        XHR.prototype.send=function(body){
          if(this.__bwu2V3GroundDestinationPath!==HIERARCHY.destination)return nativeSend.apply(this,arguments);
          const token=tokenFromBody(body);
          this.addEventListener('loadend',()=>{let raw='';try{if(!this.responseType||this.responseType==='text')raw=this.responseText||'';else if(this.responseType==='json')raw=JSON.stringify(this.response??null);}catch{}recordDestination(token,facilityFromResponse(raw),this.status);},{once:true});
          return nativeSend.apply(this,arguments);
        };
        Object.defineProperty(XHR.prototype,'__bwu2V3GroundDestinationTap',{value:true,configurable:true});
      }
    }catch{}
    try{
      const nativeFetch=page.fetch;
      if(typeof nativeFetch==='function'&&!nativeFetch.__bwu2V3GroundDestinationTap){
        const wrapped=async function(input,init={}){
          const rawUrl=typeof input==='string'||input instanceof URL?String(input):String(input?.url||'');
          if(endpointPath(rawUrl)!==HIERARCHY.destination)return nativeFetch.apply(this,arguments);
          const token=tokenFromBody(init?.body),response=await nativeFetch.apply(this,arguments);
          let raw='';try{raw=await response.clone().text();}catch{}
          recordDestination(token,facilityFromResponse(raw),response.status);return response;
        };
        Object.defineProperty(wrapped,'__bwu2V3GroundDestinationTap',{value:true});
        page.fetch=wrapped;
      }
    }catch{}
  }

  const visible=el=>{if(!(el instanceof Element)||!el.isConnected)return false;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity||1)!==0;};
  const descriptor=input=>{let label='';try{const direct=input.id?document.querySelector('label[for="'+CSS.escape(input.id)+'"]'):null;label=C.clean(direct?.textContent||input.closest('label')?.textContent||'');}catch{}return C.lower([label,input.getAttribute('name'),input.getAttribute('id'),input.getAttribute('placeholder'),input.getAttribute('aria-label')].filter(Boolean).join(' '));};
  const nativeInputs=()=>[...document.querySelectorAll('input[type="text"],input:not([type]),textarea,[role="combobox"]')].filter(visible);
  const findDestinationInput=()=>nativeInputs().map(input=>{const d=descriptor(input);let score=0;if(/destination/.test(d))score+=10;if(/warehouse|site|facility|\bfc\b/.test(d))score+=5;if(/container|scannable|scan|tote/.test(d))score-=14;return{input,score};}).sort((a,b)=>b.score-a.score)[0]?.score>0?nativeInputs().map(input=>{const d=descriptor(input);let score=0;if(/destination/.test(d))score+=10;if(/warehouse|site|facility|\bfc\b/.test(d))score+=5;if(/container|scannable|scan|tote/.test(d))score-=14;return{input,score};}).sort((a,b)=>b.score-a.score)[0].input:null;
  const findContainerInput=()=>{const rows=nativeInputs().map(input=>{const d=descriptor(input);let score=0;if(/container|scannable|scan|tote/.test(d))score+=12;if(/destination|warehouse|site|facility|\bfc\b/.test(d))score-=15;return{input,score};}).sort((a,b)=>b.score-a.score);return rows[0]?.score>0?rows[0].input:null;};
  const setNative=(input,value)=>{if(!input)return false;try{let proto=input,setter=null;while((proto=Object.getPrototypeOf(proto))&&!setter)setter=Object.getOwnPropertyDescriptor(proto,'value')?.set||null;if(setter)setter.call(input,value);else input.value=value;input.dispatchEvent(new Event('input',{bubbles:true,composed:true}));input.dispatchEvent(new Event('change',{bubbles:true,composed:true}));return true;}catch{return false;}};
  const pressEnter=async(input,life)=>{for(const type of ['keydown','keypress','keyup']){const e=new KeyboardEvent(type,{key:'Enter',code:'Enter',bubbles:true,cancelable:true});try{Object.defineProperty(e,'keyCode',{get:()=>13});Object.defineProperty(e,'which',{get:()=>13});}catch{}input.dispatchEvent(e);}await life.sleep(20);};
  const statusText=()=>[...document.querySelectorAll('[role="alert"],[role="status"],.alert,.error,.success,[class*="error"],[class*="Error"],[class*="success"],[class*="Success"]')].filter(visible).map(x=>C.clean(x.textContent)).filter(Boolean).join(' | ');
  const errorText=()=>{const text=statusText();return text&&/(?:error|invalid|failed|cannot|unable|not\s+found|not\s+valid|reject|wrong|unknown\s+(?:warehouse|facility|destination))/i.test(text)?text:'';};
  const pageText=()=>C.clean(document.body?.innerText||document.body?.textContent||'');
  const waitFor=async(predicate,{life,timeout=10000,minMs=0,label='native page'}={})=>{const started=performance.now();while(performance.now()-started<timeout){const elapsed=performance.now()-started,result=predicate(elapsed);if(elapsed>=minMs&&result)return result;await life.sleep(80);}throw new Error(label+' did not settle');};

  async function validateDestinationNative(destination,{life,telemetry}={}){
    const fc=normalizeFacility(destination);if(!fc)throw new Error('Enter destination FC, e.g. BWU1 or AVV2');
    installDestinationTap();const marker=destinationSeq,input=findDestinationInput();if(!input)throw new Error('Native destination field not found');
    if(!setNative(input,fc))throw new Error('Could not enter destination FC');try{input.focus({preventScroll:true});}catch{}await pressEnter(input,life);
    telemetry?.emit('hierarchy.destination.submit',{destination:fc});
    const proof=await waitFor(()=>{const error=errorText();if(error)throw new Error(error);return destinationProofs.find(x=>x.seq>marker&&x.facility===fc&&x.status>=200&&x.status<300&&x.token);},{life,timeout:10000,minMs:150,label:'Destination validation'});
    telemetry?.emit('hierarchy.destination.validated',{destination:fc});
    return Object.freeze({facility:fc,destinationWarehouseId:proof.token});
  }

  const successText=(before,container)=>{const status=statusText(),body=pageText(),re=/(?:success|successfully|\bbound\b|binding\s+(?:complete|completed)|container\s+bound)/i;if(re.test(status))return status;if(body!==before&&re.test(body)){const code=C.upper(container);if(C.upper(body).includes(code)||/successfully|binding\s+(?:complete|completed)/i.test(body))return body;}return'';};
  const nativeScan=async(container,life)=>{const input=findContainerInput();if(!input)throw new Error('Native container scan field not found');if(!setNative(input,container))throw new Error('Could not enter container');try{input.focus({preventScroll:true});}catch{}const before=pageText();await pressEnter(input,life);return before;};
  async function bindNative(container,context,{life,telemetry}={}){
    const code=C.clean(container),fc=normalizeFacility(context?.facility);if(!C.container(code))throw new Error('Container must be tsX/csX');if(!fc||!C.clean(context?.destinationWarehouseId))throw new Error('Destination must be validated before Bind');
    const before1=await nativeScan(code,life);
    await waitFor(elapsed=>{const error=errorText();if(error)throw new C.RejectedError(error);const text=pageText(),input=findContainerInput();return elapsed>=700&&text!==before1&&input&&visible(input)&&!input.disabled&&C.clean(input.value)!==code;},{life,timeout:12000,minMs:700,label:'Container validation'});
    const op=C.operation({kind:'hierarchy-bind',ref:code,telemetry});op.submitted({destination:fc});
    const before2=await nativeScan(code,life);
    try{
      const proof=await waitFor(()=>{const error=errorText();if(error)throw new C.RejectedError(error);return successText(before2,code);},{life,timeout:15000,minMs:250,label:'Bind confirmation'});
      op.confirmed({destination:fc,proof:C.clean(proof).slice(0,100)});return{container:code,destination:fc};
    }catch(error){
      if(error instanceof C.RejectedError){op.rejected({reason:C.clean(error.message)});throw error;}
      op.unknown({reason:'native-confirmation-missing'});throw new C.UnknownError('Bind submitted but native page did not prove success — verify container',{cause:error});
    }
  }

  return Object.freeze({MOVE_ORIGIN,HIERARCHY_ORIGIN,WAREHOUSE,FLOORS,UPPER,P1,dropChoices,destination,movePayload,strictMoveConfirmation,moveContainer,validateContainer,bindingSummary,unbind,normalizeFacility,tokenFromBody,facilityFromResponse,validateDestinationNative,bindNative});
})();
