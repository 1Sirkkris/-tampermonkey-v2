V3.hierarchyNative=(()=>{
  const clean=V3.base.clean;
  const upper=V3.base.upper;
  const FACILITY=/^[A-Z0-9]{3,8}$/;

  const normalizeFacility=value=>{
    const fc=upper(value).replace(/[^A-Z0-9]/g,'');
    return FACILITY.test(fc)?fc:'';
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
    return clean([
      label,
      input.getAttribute('name'),
      input.getAttribute('id'),
      input.getAttribute('placeholder'),
      input.getAttribute('aria-label')
    ].filter(Boolean).join(' ')).toLowerCase();
  };

  const nativeInputs=()=>[...document.querySelectorAll('input[type="text"],input:not([type]),textarea,[role="combobox"]')]
    .filter(visible);

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

  const keyEvent=(type,key)=>{
    const event=new KeyboardEvent(type,{key,code:key==='Enter'?'Enter':'',bubbles:true,cancelable:true});
    if(key==='Enter'){
      try{Object.defineProperty(event,'keyCode',{get:()=>13});}catch{}
      try{Object.defineProperty(event,'which',{get:()=>13});}catch{}
      if(type==='keypress')try{Object.defineProperty(event,'charCode',{get:()=>13});}catch{}
    }
    return event;
  };

  const enter=async(target,life)=>{
    target.dispatchEvent(keyEvent('keydown','Enter'));
    target.dispatchEvent(keyEvent('keypress','Enter'));
    target.dispatchEvent(keyEvent('keyup','Enter'));
    await life.sleep(20);
  };

  const pageText=()=>clean(document.body?.innerText||document.body?.textContent||'');
  const statusText=()=>[...document.querySelectorAll(
    '[role="alert"],[role="status"],.alert,.error,.success,[class*="error"],[class*="Error"],[class*="success"],[class*="Success"]'
  )].filter(visible).map(node=>clean(node.textContent)).filter(Boolean).join(' | ');

  const errorSignal=()=>{
    const text=statusText();
    if(!text)return'';
    return /(?:error|invalid|failed|cannot|unable|not\s+found|not\s+valid|reject|wrong|unknown\s+(?:warehouse|facility|destination))/i.test(text)?text:'';
  };

  const successSignal=(beforeText,container)=>{
    const status=statusText();
    const body=pageText();
    const changed=body!==beforeText;
    const success=/(?:success|successfully|\bbound\b|binding\s+(?:complete|completed)|container\s+bound)/i;
    if(success.test(status))return status;
    if(changed&&success.test(body)){
      const code=upper(container);
      if(!code||upper(body).includes(code)||/successfully|binding\s+(?:complete|completed)/i.test(body))return body.slice(0,1200);
    }
    return'';
  };

  const waitFor=async(predicate,{life,timeout=10000,minMs=0,label='native page'}={})=>{
    const started=performance.now();
    while(performance.now()-started<timeout){
      const elapsed=performance.now()-started;
      const result=predicate(elapsed);
      if(elapsed>=minMs&&result)return result;
      await life.sleep(80);
    }
    throw new Error(label+' did not settle');
  };

  const validateDestination=async(destination,{life,telemetry}={})=>{
    const fc=normalizeFacility(destination);
    if(!fc)throw new Error('Enter destination FC, e.g. BWU1 or AVV2');
    const input=destinationInput();
    if(!input)throw new Error('Native destination field not found');
    if(!nativeSetter(input,fc))throw new Error('Could not enter destination FC');
    try{input.focus({preventScroll:true});}catch{}
    const before=pageText();
    await enter(input,life);
    telemetry?.emit('native.destination.submit',{destination:fc});

    await waitFor(()=>{
      const error=errorSignal();if(error)throw new Error(error);
      const container=containerInput();
      const current=upper(input.value||input.textContent||'');
      const body=upper(pageText());
      return container&&visible(container)&&!container.disabled&&(current===fc||body.includes(fc));
    },{life,timeout:10000,minMs:350,label:'Destination validation'});

    const error=errorSignal();if(error)throw new Error(error);
    telemetry?.emit('native.destination.ready',{destination:fc});
    return fc;
  };

  const settleValidationPass=async(container,beforeText,{life,telemetry}={})=>{
    let last='',stableSince=0;
    await waitFor(elapsed=>{
      const error=errorSignal();if(error)throw new Error(error);
      const current=pageText();
      const input=containerInput();
      if(current!==beforeText&&current!==last){last=current;stableSince=elapsed;}
      const stable=current!==beforeText&&elapsed-stableSince>=350;
      const ready=input&&visible(input)&&!input.disabled&&clean(input.value||'')!==container;
      return elapsed>=700&&stable&&ready;
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

  const bind=async(container,destination,{life,telemetry}={})=>{
    const code=clean(container);
    if(!V3.base.container(code))throw new Error('Container must be tsX/csX');
    const fc=await validateDestination(destination,{life,telemetry});

    const op=V3.operation.create({kind:'hierarchy-bind-native',ref:code,telemetry});
    telemetry?.emit('native.bind.pass1',{container:V3.telemetry.mask(code),destination:fc});
    const beforeValidation=await scan(code,{life});
    await settleValidationPass(code,beforeValidation,{life,telemetry});

    const error=errorSignal();if(error)throw new V3.operation.RejectedError(error);
    op.submitted({destination:fc});
    telemetry?.emit('native.bind.pass2',{container:V3.telemetry.mask(code),destination:fc});
    const beforeBind=await scan(code,{life});

    try{
      await settleBindPass(code,beforeBind,{life,telemetry});
      op.confirmed({destination:fc});
      return{container:code,destination:fc};
    }catch(error){
      if(error?.outcome==='rejected'||error instanceof V3.operation.RejectedError){
        op.rejected({reason:String(error.message||error)});
        throw error;
      }
      op.unknown({reason:'native-confirmation-missing'});
      throw error;
    }
  };

  return Object.freeze({
    normalizeFacility,
    destinationInput,
    containerInput,
    validateDestination,
    bind
  });
})();