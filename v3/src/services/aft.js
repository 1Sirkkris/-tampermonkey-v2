V3.aft = (() => {
  const DEFINITIONS={
    'edit:each':{title:'Edit • Each',path:'/app/edititems',instructionId:'EditItems',tool:'edititems',input:'EACH'},
    'edit:sku':{title:'Edit • SKU',path:'/app/edititems',instructionId:'EditItems',tool:'edititems',input:'SKU'},
    'edit:date':{title:'Edit • Date',path:'/app/edititems',instructionId:'EditItems',tool:'edititems',input:'DATELOT'},
    'edit:fcsku':{title:'Edit • FCSKU',path:'/app/fcskuflip',instructionId:'FcSkuFlip',tool:'fcskuflip',input:'SKU'},
    'move:each':{title:'Move • Each',path:'/app/moveitems',instructionId:'MoveItems',tool:'moveitems',input:'EACH'},
    'move:multi':{title:'Move • Multi',path:'/app/moveitems',instructionId:'MoveItems',tool:'moveitems',input:'MULTI'},
    'move:container':{title:'Move • Container',path:'/app/moveitems',instructionId:'MoveItems',tool:'moveitems',input:'CONTAINER'}
  };
  const EDIT_STATES=[
    ['location',['scan location','scan container','input location','enter location','enter container']],
    ['item',['input fnsku or fcsku','input item','scan item','enter the sku','enter item']],
    ['sourceState',['select source inventory state']],
    ['sourceDisp',['select source disposition','select source disposition type']],
    ['newState',['select new inventory state']],
    ['newDisp',['select new disposition','select disposition type']],
    ['confirm',['confirm change','confirm to continue']],
    ['success',['success items changed','items changed from','current expiry date:']],
    ['retryError',['failed to change consumer type. please try again','failed to change consumer type']],
    ['error',['work is errored','the service failed to process your request','service failed']],
    ['loading',['loading']]
  ];
  const HEADERS={'Content-Type':'application/json; charset=utf-8','Accept':'application/json, text/javascript, */*; q=0.01','X-Requested-With':'XMLHttpRequest'};

  const classifyEdit=text=>{
    const value=V3.base.lower(text);let state='unknown',best=Infinity;
    for(const [name,phrases] of EDIT_STATES)for(const phrase of phrases){const i=value.indexOf(phrase);if(i>=0&&i<best){best=i;state=name;}}
    return state;
  };
  const objectId=html=>{
    const raw=String(html||'');
    return raw.match(/(?:&quot;|")objectId(?:&quot;|")\s*:\s*(?:&quot;|")([^"&<]+)(?:&quot;|")/i)?.[1] ||
      raw.match(/\b[A-Z0-9]{2,12}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i)?.[0] || '';
  };
  const bodySnapshot=html=>{
    const doc=V3.base.parseHtml(html);
    for(const el of doc.querySelectorAll('script,style,noscript,template,svg,[hidden],[aria-hidden="true"],[style*="display:none"],[style*="display: none"],[style*="visibility:hidden"],[style*="visibility: hidden"]'))el.remove();
    let headings='';for(const el of doc.querySelectorAll('h1,h2,h3,[role="heading"]'))headings+=' '+(el.textContent||'');
    return{doc,text:V3.base.clean((doc.body?.textContent||'')),headings:V3.base.clean(headings)};
  };
  const extractWorkflow=(html,definition)=>{
    const source=String(html||'').replace(/&quot;/gi,'"').replace(/&#34;/gi,'"').replace(/&#x22;/gi,'"').replace(/\\\"/g,'"').replace(/&amp;/gi,'&');
    const anchor=new RegExp('"instructionId"\\s*:\\s*"'+definition.instructionId+'"','i').exec(source);
    if(!anchor)return null;
    const scope=source.slice(anchor.index,anchor.index+2600);
    const grab=name=>scope.match(new RegExp('"'+name+'"\\s*:\\s*"([^"]+)"','i'))?.[1]||'';
    const workflow={instructionId:grab('instructionId'),tool:grab('tool').toLowerCase(),objectId:grab('objectId'),status:grab('status').toUpperCase(),selector:/<input\b[^>]*\bname\s*=\s*["']options["']/i.test(source)};
    if(!workflow.objectId||workflow.instructionId!==definition.instructionId)return null;
    if(workflow.tool&&workflow.tool!==definition.tool)return null;
    return workflow;
  };

  function create(options={}){
    const origin=String(options.origin||location.origin).replace(/\/$/,'');
    const telemetry=options.telemetry;
    const life=options.life;
    const crossOrigin=origin!==location.origin;
    const stopped=()=>Boolean(options.stopped?.());

    const url=path=>origin+path;
    const get=async(path,label='GET')=>{
      const result=crossOrigin
        ? await V3.api.gmRequest(url(path),{timeout:15000,allowHtml:true,telemetry})
        : await V3.api.fetchRequest(path,{timeout:15000,allowHtml:true,telemetry});
      telemetry?.emit('aft.page',{label,path,chars:String(result.raw||'').length});
      return result.raw;
    };
    const post=async(path,payload,opts={})=>{
      const body=JSON.stringify(payload);
      return crossOrigin
        ? V3.api.gmRequest(url(path),{method:'POST',data:body,headers:HEADERS,timeout:opts.timeout||20000,mutation:opts.mutation===true,operation:opts.operation,telemetry})
        : V3.api.fetchRequest(path,{method:'POST',body,headers:HEADERS,timeout:opts.timeout||20000,mutation:opts.mutation===true,operation:opts.operation,telemetry});
    };
    const id=(definition,object)=>({id:{instructionId:definition.instructionId,objectId:object}});

    const routePath=definition=>definition.path+'?experience=Desktop';
    const bootstrap=async definition=>{
      const html=await get(routePath(definition),definition.title+' bootstrap');
      const workflow=extractWorkflow(html,definition);
      if(!workflow)throw new Error(definition.title+': workflow not found');
      return workflow;
    };
    const getStatus=async(workflow,definition)=>{
      const result=await post('/status',id(definition,workflow.objectId));
      const state=String(result.data?.status||'').toUpperCase();
      if(!state)throw new Error('AFT status missing');
      return state;
    };
    const waitStatus=async(workflow,definition,accepted,opts={})=>{
      const wanted=new Set(accepted),started=performance.now();let polls=0,last=workflow.status||'';
      while(performance.now()-started<(opts.timeout||20000)){
        if(stopped()&&!opts.ignoreStop)throw new Error('Stopped by user');
        try{last=await getStatus(workflow,definition);}
        catch(error){
          if(opts.operation){
            opts.operation.unknown({reason:'status-transport'});
            throw new V3.operation.OutcomeUnknownError(opts.label+': status confirmation lost',{cause:error});
          }
          throw error;
        }
        polls++;
        if(wanted.has(last)){telemetry?.emit('aft.status',{label:opts.label||'',state:last,polls,ms:Math.round(performance.now()-started)});return last;}
        if(last==='ERRORED'){
          opts.operation?.rejected({reason:'backend-errored'});
          throw new V3.operation.RejectedError((opts.label||'AFT')+': backend ERRORED');
        }
        if(!['READY','PROCESSING','COMPLETE'].includes(last)){
          if(opts.operation){opts.operation.unknown({reason:'unexpected-status',state:last});throw new V3.operation.OutcomeUnknownError((opts.label||'AFT')+': unexpected status '+last);}
          throw new Error((opts.label||'AFT')+': status '+(last||'blank'));
        }
        await life.sleep(opts.pollMs??Math.min(300,60+polls*35));
      }
      if(opts.operation){opts.operation.unknown({reason:'status-timeout'});throw new V3.operation.OutcomeUnknownError((opts.label||'AFT')+': status timeout');}
      throw new Error((opts.label||'AFT')+': status timeout');
    };
    const action=async(workflow,definition,actionName,input,label,opts={})=>{
      if(stopped()&&!opts.ignoreStop)throw new Error('Stopped by user');
      const operation=opts.operation||null;
      try{
        await post('/action',{...id(definition,workflow.objectId),action:actionName,input},{timeout:opts.timeout||20000,mutation:Boolean(operation),operation});
      }catch(error){throw error;}
      const state=await waitStatus(workflow,definition,opts.complete?['COMPLETE']:['READY'],{timeout:opts.timeout||20000,pollMs:opts.pollMs,ignoreStop:opts.ignoreStop,operation,label});
      return{state};
    };
    const input=(workflow,definition,value,label,opts={})=>action(workflow,definition,'Input',value,label,opts);
    const confirm=(workflow,definition,opts={})=>action(workflow,definition,'Confirm','Confirm','Confirm',opts);
    const done=(workflow,definition)=>action(workflow,definition,'Done','Done','Done',{complete:true,timeout:180000,pollMs:300,ignoreStop:true});
    const end=(workflow,definition)=>post('/end',{...id(definition,workflow.objectId),tool:definition.tool},{timeout:20000});

    const waitFresh=async(definition,oldId,timeout=5000)=>{
      const started=performance.now();
      while(performance.now()-started<timeout){
        const next=await bootstrap(definition);
        if(next.objectId!==oldId)return next;
        await life.sleep(100);
      }
      throw new Error('Fresh AFT workflow not created');
    };
    const ensureReady=async(definition,workflow=null)=>{
      let current=workflow||await bootstrap(definition);
      for(let pass=0;pass<4;pass++){
        if(current.status==='READY')return current;
        if(current.status==='PROCESSING'){
          current.status=await waitStatus(current,definition,['READY','COMPLETE'],{label:'Ready'});
          if(current.status==='READY'){current=await bootstrap(definition);continue;}
        }
        if(current.status==='COMPLETE'){
          const old=current.objectId;await end(current,definition);current=await waitFresh(definition,old);continue;
        }
        throw new Error('Unexpected AFT state '+(current.status||'unknown'));
      }
      throw new Error('Could not obtain READY workflow');
    };
    const ensureMode=async key=>{
      const definition=DEFINITIONS[key];if(!definition)throw new Error('Unknown AFT mode '+key);
      let workflow=await ensureReady(definition);
      if(definition===DEFINITIONS['edit:fcsku']&&!workflow.selector)return workflow;
      if(!workflow.selector){
        await action(workflow,definition,'SelectMode','SelectMode','Select mode',{timeout:20000});
        workflow=await bootstrap(definition);
        if(!workflow.selector)throw new Error(definition.title+': mode selector unavailable');
      }
      await action(workflow,definition,'Input',definition.input,'Choose '+definition.input,{complete:true,timeout:20000});
      const old=workflow.objectId;await end(workflow,definition);
      workflow=await waitFresh(definition,old);
      return ensureReady(definition,workflow);
    };
    const page=async(definition,label,classifier)=>{
      const html=await get(routePath(definition),label);
      const view=bodySnapshot(html);
      return{html,doc:view.doc,text:view.text,state:classifier?classifier(view.headings+' '+view.text):'unknown',objectId:objectId(html)};
    };
    const snapshot=async(workflow,definition,label,classifier)=>{
      const snap=await page(definition,label,classifier);
      if(!snap.objectId)throw new Error(label+': objectId missing');
      if(snap.objectId!==workflow.objectId)throw new Error(label+': objectId changed');
      return snap;
    };

    return Object.freeze({origin,crossOrigin,definitions:DEFINITIONS,bootstrap,ensureMode,ensureReady,waitStatus,action,input,confirm,done,end,page,snapshot,classifyEdit});
  }

  const mapState=value=>{
    const v=V3.base.lower(value);
    if(v==='sellable'||v==='inventory')return'INVENTORY';
    if(v==='pending research'||v==='pending')return'PENDING_RESEARCH';
    if(v==='unsellable')return'UNSELLABLE';
    throw new Error('Unsupported inventory state '+value);
  };
  const mapDamage=value=>{
    const v=V3.base.lower(value);
    if(v==='amazon damage'||v==='warehouse damage')return'AMAZON_DAMAGE';
    if(v==='defective')return'DEFECTIVE';
    if(v==='distributor damage')return'DISTRIBUTOR_DAMAGE';
    if(v==='expired')return'EXPIRED';
    throw new Error('Unsupported disposition '+value);
  };
  const readMoveQuantity=html=>{
    const raw=String(html||'');
    for(const pattern of [
      /(?:["']|&quot;)quantity(?:["']|&quot;)\s*[:=]\s*(?:["']|&quot;)?([0-9]{1,6})\b/i,
      /\bQuantity\b(?:<[^>]+>|\s|&nbsp;|&#160;|:|-){0,20}([0-9]{1,6})\b/i
    ]){
      const qty=Number(raw.match(pattern)?.[1]);if(Number.isInteger(qty)&&qty>0)return{qty,verify:false};
    }
    return{qty:null,verify:/\bVerify item\b/i.test(raw)};
  };
  const readSourceChoices=doc=>{
    const out=[];
    for(const radio of doc?.querySelectorAll?.('input[type="radio"]')||[]){
      let label='';try{label=[...(radio.labels||[])].map(x=>x.textContent||'').join(' ');}catch{}
      if(!label)label=radio.closest('label')?.textContent||radio.parentElement?.textContent||'';
      label=V3.base.clean(label);
      if(!/Quantity\s*:/i.test(label)||!/Owner\s*:/i.test(label))continue;
      let state='';
      if(/Pending Research|PENDING_RESEARCH/i.test(label))state='PENDING_RESEARCH';
      else if(/Unsellable|UNSELLABLE/i.test(label))state='UNSELLABLE';
      else if(/(?:Inventory|Sellable)|\bSELLABLE\b/i.test(label))state='SELLABLE';
      if(!state)continue;
      const qty=Number(label.match(/\bQuantity\s*:\s*(\d{1,7})\b/i)?.[1]);
      out.push({state,label,value:radio.getAttribute('value')||'',qty:Number.isInteger(qty)?qty:null,disabled:Boolean(radio.disabled)});
    }
    return out;
  };

  return Object.freeze({create,DEFINITIONS,classifyEdit,mapState,mapDamage,readMoveQuantity,readSourceChoices});
})();