V3.hierarchyNative=(()=>{
  const clean=V3.base.clean,upper=V3.base.upper;
  const FACILITY=/^[A-Z0-9]{3,8}$/,DESTINATION_PATH='/validateDestination';
  let seq=0;
  const records=[];

  const normalizeFacility=value=>{
    const fc=upper(clean(value));
    return FACILITY.test(fc)?fc:'';
  };

  const pathOf=value=>{
    try{return new URL(String(value||''),location.href).pathname;}
    catch{return'';}
  };

  const destinationTokenFromBody=body=>{
    if(body==null)return'';
    let value=body;
    try{
      if(typeof FormData!=='undefined'&&body instanceof FormData)value=Object.fromEntries(body.entries());
      else if(body instanceof URLSearchParams)value=Object.fromEntries(body.entries());
      else if(typeof body==='string'){
        try{value=JSON.parse(body);}
        catch{try{value=Object.fromEntries(new URLSearchParams(body).entries());}catch{}}
      }
    }catch{}
    return clean(value&&typeof value==='object'?value.destinationWarehouseId:'');
  };

  const responseFacility=raw=>{
    let value=raw;
    if(typeof raw==='string'){
      try{value=JSON.parse(raw);}catch{}
    }
    if(typeof value==='string')return normalizeFacility(value);
    if(value&&typeof value==='object'){
      return normalizeFacility(value.warehouseId||value.destination||value.facility||value.fc||'');
    }
    return'';
  };

  const record=(token,facility,status)=>{
    if(!token||!facility)return;
    records.push({seq:++seq,token,facility,status:Number(status)||0,at:Date.now()});
    if(records.length>20)records.splice(0,records.length-20);
  };

  const installDestinationTap=()=>{
    const page=typeof unsafeWindow==='object'&&unsafeWindow?unsafeWindow:window;

    try{
      const XHR=page.XMLHttpRequest;
      if(XHR?.prototype&&!XHR.prototype.__bwu2V3DestinationTap){
        const nativeOpen=XHR.prototype.open,nativeSend=XHR.prototype.send;
        XHR.prototype.open=function(method,url){
          this.__bwu2V3DestinationTapInfo={path:pathOf(url)};
          return nativeOpen.apply(this,arguments);
        };
        XHR.prototype.send=function(body){
          const info=this.__bwu2V3DestinationTapInfo||{};
          if(info.path!==DESTINATION_PATH)return nativeSend.apply(this,arguments);
          const token=destinationTokenFromBody(body);
          this.addEventListener('loadend',()=>{
            let raw='';
            try{
              if(!this.responseType||this.responseType==='text')raw=this.responseText||'';
              else if(this.responseType==='json')raw=JSON.stringify(this.response??null);
            }catch{}
            record(token,responseFacility(raw),this.status);
          },{once:true});
          return nativeSend.apply(this,arguments);
        };
        Object.defineProperty(XHR.prototype,'__bwu2V3DestinationTap',{value:true,configurable:true});
      }
    }catch{}

    try{
      const nativeFetch=page.fetch;
      if(typeof nativeFetch==='function'&&!nativeFetch.__bwu2V3DestinationTap){
        const wrapped=async function(input,init={}){
          const url=typeof input==='string'||input instanceof URL?String(input):String(input?.url||'');
          if(pathOf(url)!==DESTINATION_PATH)return nativeFetch.apply(this,arguments);
          const token=destinationTokenFromBody(init?.body);
          const response=await nativeFetch.apply(this,arguments);
          let raw='';
          try{raw=await response.clone().text();}catch{}
          record(token,responseFacility(raw),response.status);
          return response;
        };
        Object.defineProperty(wrapped,'__bwu2V3DestinationTap',{value:true});
        page.fetch=wrapped;
      }
    }catch{}
  };

  const visible=element=>{
    if(!(element instanceof Element)||!element.isConnected)return false;
    const rect=element.getBoundingClientRect();
    if(rect.width<=0||rect.height<=0)return false;
    const style=getComputedStyle(element);
    return style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity||1)!==0;
  };

  const descriptor=input=>{
    let label='';
    try{
      const direct=input.id?document.querySelector('label[for="'+CSS.escape(input.id)+'"]'):null;
      label=clean(direct?.textContent||input.closest('label')?.textContent||'');
    }catch{}
    return clean([label,input.getAttribute('name'),input.getAttribute('id'),input.getAttribute('placeholder'),input.getAttribute('aria-label')].filter(Boolean).join(' ')).toLowerCase();
  };

  const nativeInputs=()=>[...document.querySelectorAll('input[type="text"],input:not([type]),textarea,[role="combobox"]')].filter(visible);

  const destinationInput=()=>{
    const rows=nativeInputs().map(input=>{
      const d=descriptor(input);let score=0;
      if(/destination/.test(d))score+=10;
      if(/warehouse|site|facility|\bfc\b/.test(d))score+=5;
      if(/container|scannable|scan|tote/.test(d))score-=14;
      return{input,score};
    }).sort((a,b)=>b.score-a.score);
    return rows[0]?.score>0?rows[0].input:null;
  };

  const containerInput=()=>{
    const rows=nativeInputs().map(input=>{
      const d=descriptor(input);let score=0;
      if(/container|scannable|scan|tote/.test(d))score+=12;
      if(/destination|warehouse|site|facility|\bfc\b/.test(d))score-=15;
      return{input,score};
    }).sort((a,b)=>b.score-a.score);
    return rows[0]?.score>0?rows[0].input:null;
  };

  const nativeSetter=(input,value)=>{
    if(!input)return false;
    try{
      let proto=input,setter=null;
      while((proto=Object.getPrototypeOf(proto))&&!setter)setter=Object.getOwnPropertyDescriptor(proto,'value')?.set||null;
      if(setter)setter.call(input,value);else input.value=value;
      input.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
      input.dispatchEvent(new Event('change',{bubbles:true,composed:true}));
      return true;
    }catch{return false;}
  };

  const enter=async(target,life)=>{
    for(const type of ['keydown','keypress','keyup']){
      const event=new KeyboardEvent(type,{key:'Enter',code:'Enter',bubbles:true,cancelable:true});
      try{Object.defineProperty(event,'keyCode',{get:()=>13});}catch{}
      try{Object.defineProperty(event,'which',{get:()=>13});}catch{}
      if(type==='keypress')try{Object.defineProperty(event,'charCode',{get:()=>13});}catch{}
      target.dispatchEvent(event);
    }
    await life.sleep(20);
  };

  const pageText=()=>clean(document.body?.innerText||document.body?.textContent||'');
  const statusText=()=>[...document.querySelectorAll('[role="alert"],[role="status"],.alert,.error,.success,[class*="error"],[class*="Error"],[class*="success"],[class*="Success"]')]
    .filter(visible).map(node=>clean(node.textContent)).filter(Boolean).join(' | ');

  const errorSignal=()=>{
    const text=statusText();
    return text&&/(?:error|invalid|failed|cannot|unable|not\s+found|not\s+valid|reject|wrong|unknown\s+(?:warehouse|facility|destination))/i.test(text)?text:'';
  };

  const successSignal=(beforeText,container)=>{
    const status=statusText(),body=pageText(),success=/(?:success|successfully|\bbound\b|binding\s+(?:complete|completed)|container\s+bound)/i;
    if(success.test(status))return status;
    if(body!==beforeText&&success.test(body)){
      const code=upper(container);
      if(!code||upper(body).includes(code)||/successfully|binding\s+(?:complete|completed)/i.test(body))return body.slice(0,1200);
    }
    return'';
  };

  const waitFor=async(predicate,{life,timeout=10000,minMs=0,label='native page'}={})=>{
    const started=performance.now();
    while(performance.now()-started<timeout){
      const elapsed=performance.now()-started,result=predicate(elapsed);
      if(elapsed>=minMs&&result)return result;
      await life.sleep(80);
    }
    throw new Error(label+' did not settle');
  };

  const validateDestination=async(destination,{life,telemetry}={})=>{
    const fc=normalizeFacility(destination);
    if(!fc)throw new Error('Enter destination FC, e.g. BWU1 or AVV2');
    installDestinationTap();
    const marker=seq,input=destinationInput();
    if(!input)throw new Error('Native destination field not found');
    if(!nativeSetter(input,fc))throw new Error('Could not enter destination FC');
    try{input.focus({preventScroll:true});}catch{}
    await enter(input,life);
    telemetry?.emit('native.destination.submit',{destination:fc});

    const proof=await waitFor(()=>{
      const error=errorSignal();if(error)throw new Error(error);
      return records.find(item=>item.seq>marker&&item.facility===fc&&item.status>=200&&item.status<300&&item.token);
    },{life,timeout:10000,minMs:150,label:'Destination validation'});

    telemetry?.emit('native.destination.ready',{destination:fc});
    return Object.freeze({facility:fc,destinationWarehouseId:proof.token,validatedAt:Date.now()});
  };

  const settleValidationPass=async(container,beforeText,{life,telemetry}={})=>{
    let last='',stableSince=0;
    await waitFor(elapsed=>{
      const error=errorSignal();if(error)throw new Error(error);
      const current=pageText(),input=containerInput();
      if(current!==beforeText&&current!==last){last=current;stableSince=elapsed;}
      return elapsed>=700&&current!==beforeText&&elapsed-stableSince>=350&&input&&visible(input)&&!input.disabled&&clean(input.value||'')!==container;
    },{life,timeout:12000,minMs:700,label:'Container validation'});
    telemetry?.emit('native.bind.validated',{container:V3.telemetry.mask(container)});
  };

  const settleBindPass=async(container,beforeText,{life,telemetry}={})=>{
    try{
      const proof=await waitFor(()=>{
        const error=errorSignal();if(error)throw new V3.operation.RejectedError(error);
        return successSignal(beforeText,container);
      },{life,timeout:15000,minMs:250,label:'Bind confirmation'});
      telemetry?.emit('native.bind.confirmed',{container:V3.telemetry.mask(container),proof:clean(proof).slice(0,160)});
      return true;
    }catch(error){
      if(error instanceof V3.operation.RejectedError)throw error;
      throw new V3.operation.UnknownError('Bind submitted but native page did not prove success — verify container',{cause:error});
    }
  };

  const scan=async(container,{life}={})=>{
    const code=clean(container);
    if(!V3.base.container(code))throw new Error('Container must be tsX/csX');
    const input=containerInput();
    if(!input)throw new Error('Native container scan field not found');
    if(!nativeSetter(input,code))throw new Error('Could not enter container');
    try{input.focus({preventScroll:true});}catch{}
    const before=pageText();
    await enter(input,life);
    return before;
  };

  const bind=async(container,context,{life,telemetry}={})=>{
    const code=clean(container),fc=normalizeFacility(context?.facility);
    if(!V3.base.container(code))throw new Error('Container must be tsX/csX');
    if(!fc||!clean(context?.destinationWarehouseId))throw new Error('Destination must be validated before Bind');

    telemetry?.emit('native.bind.pass1',{container:V3.telemetry.mask(code),destination:fc});
    const beforeValidation=await scan(code,{life});
    await settleValidationPass(code,beforeValidation,{life,telemetry});

    const error=errorSignal();if(error)throw new V3.operation.RejectedError(error);
    const op=V3.operation.create({kind:'hierarchy-bind-native',ref:code,telemetry});
    op.submitted({destination:fc});
    telemetry?.emit('native.bind.pass2',{container:V3.telemetry.mask(code),destination:fc});
    const beforeBind=await scan(code,{life});

    try{
      await settleBindPass(code,beforeBind,{life,telemetry});
      op.confirmed({destination:fc});
      return{container:code,destination:fc};
    }catch(error2){
      if(error2?.outcome==='rejected'||error2 instanceof V3.operation.RejectedError){
        op.rejected({reason:String(error2.message||error2)});
        throw error2;
      }
      op.unknown({reason:'native-confirmation-missing'});
      throw error2;
    }
  };

  return Object.freeze({normalizeFacility,destinationTokenFromBody,responseFacility,destinationInput,containerInput,validateDestination,bind});
})();