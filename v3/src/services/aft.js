V3.aft=(()=>{
  const DEFINITIONS={
    'edit:each':{title:'Edit EACH',path:'/app/edititems',instructionId:'EditItems',tool:'edititems',input:'EACH'},
    'edit:sku':{title:'Edit SKU',path:'/app/edititems',instructionId:'EditItems',tool:'edititems',input:'SKU'},
    'edit:date':{title:'Edit DATE',path:'/app/edititems',instructionId:'EditItems',tool:'edititems',input:'DATELOT'},
    'edit:fcsku':{title:'FCSKU Flip',path:'/app/fcskuflip',instructionId:'FcSkuFlip',tool:'fcskuflip',input:'SKU'},
    'move:multi':{title:'Move Multi',path:'/app/moveitems',instructionId:'MoveItems',tool:'moveitems',input:'MULTI'}
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
    ['error',['work is errored','the service failed to process your request','service failed']]
  ];
  const HEADERS={'Content-Type':'application/json; charset=utf-8','Accept':'application/json, text/javascript, */*; q=0.01','X-Requested-With':'XMLHttpRequest'};
  const classifyEdit=text=>{const v=V3.base.lower(text);let state='unknown',best=Infinity;for(const [name,phrases] of EDIT_STATES)for(const phrase of phrases){const i=v.indexOf(phrase);if(i>=0&&i<best){best=i;state=name;}}return state;};
  const objectId=raw=>String(raw||'').match(/(?:&quot;|")objectId(?:&quot;|")\s*:\s*(?:&quot;|")([^"&<]+)(?:&quot;|")/i)?.[1]||String(raw||'').match(/\b[A-Z0-9]{2,12}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i)?.[0]||'';
  const snapshotText=raw=>{const doc=V3.base.html(raw);for(const el of doc.querySelectorAll('script,style,noscript,template,svg,[hidden],[aria-hidden="true"],[style*="display:none"],[style*="visibility:hidden"]'))el.remove();return{doc,text:V3.base.clean(doc.body?.textContent||''),headings:V3.base.clean([...doc.querySelectorAll('h1,h2,h3,[role="heading"]')].map(x=>x.textContent||'').join(' '))};};
  const extractWorkflow=(raw,definition)=>{
    const source=String(raw||'').replace(/&quot;/gi,'"').replace(/&#34;/gi,'"').replace(/&#x22;/gi,'"').replace(/\\\"/g,'"').replace(/&amp;/gi,'&');
    const anchor=new RegExp('"instructionId"\\s*:\\s*"'+definition.instructionId+'"','i').exec(source);if(!anchor)return null;
    const scope=source.slice(anchor.index,anchor.index+2600),grab=name=>scope.match(new RegExp('"'+name+'"\\s*:\\s*"([^"]+)"','i'))?.[1]||'';
    const wf={instructionId:grab('instructionId'),tool:grab('tool').toLowerCase(),objectId:grab('objectId'),status:grab('status').toUpperCase(),selector:/<input\b[^>]*\bname\s*=\s*["']options["']/i.test(source)};
    if(!wf.objectId||wf.instructionId!==definition.instructionId)return null;if(wf.tool&&wf.tool!==definition.tool)return null;return wf;
  };
  const mapState=value=>{const v=V3.base.lower(value);if(v==='sellable'||v==='inventory')return'INVENTORY';if(v==='pending research'||v==='pending')return'PENDING_RESEARCH';if(v==='unsellable')return'UNSELLABLE';throw new Error('Unsupported inventory state '+value);};
  const mapDamage=value=>{const v=V3.base.lower(value);if(v==='amazon damage'||v==='warehouse damage')return'AMAZON_DAMAGE';if(v==='defective')return'DEFECTIVE';if(v==='distributor damage')return'DISTRIBUTOR_DAMAGE';if(v==='expired')return'EXPIRED';throw new Error('Unsupported disposition '+value);};
  const readMoveQuantity=raw=>{for(const re of [/(?:["']|&quot;)quantity(?:["']|&quot;)\s*[:=]\s*(?:["']|&quot;)?([0-9]{1,6})\b/i,/\bQuantity\b(?:<[^>]+>|\s|&nbsp;|&#160;|:|-){0,20}([0-9]{1,6})\b/i]){const qty=Number(String(raw||'').match(re)?.[1]);if(Number.isInteger(qty)&&qty>0)return{qty,verify:false};}return{qty:null,verify:/\bVerify item\b/i.test(String(raw||''))};};
  const readSourceChoices=doc=>{
    const out=[];for(const radio of doc?.querySelectorAll?.('input[type="radio"]')||[]){let label='';try{label=[...(radio.labels||[])].map(x=>x.textContent||'').join(' ');}catch{}if(!label)label=radio.closest('label')?.textContent||radio.parentElement?.textContent||'';label=V3.base.clean(label);if(!/Quantity\s*:/i.test(label)||!/Owner\s*:/i.test(label))continue;let state='';if(/Pending Research|PENDING_RESEARCH/i.test(label))state='PENDING_RESEARCH';else if(/Unsellable|UNSELLABLE/i.test(label))state='UNSELLABLE';else if(/(?:Inventory|Sellable)|\bSELLABLE\b/i.test(label))state='SELLABLE';if(!state)continue;const qty=Number(label.match(/\bQuantity\s*:\s*(\d{1,7})\b/i)?.[1]);out.push({state,label,value:radio.value||'',qty:Number.isInteger(qty)?qty:null,disabled:Boolean(radio.disabled)});}return out;
  };
  function create({origin=location.origin,telemetry,life,stopped}={}){
    origin=String(origin).replace(/\/$/,'');const cross=origin!==location.origin,stop=()=>Boolean(stopped?.()),url=path=>origin+path;
    const request=async(path,options={})=>cross?V3.transport.gm(url(path),options):V3.transport.page(path,options);
    const get=async path=>(await request(path,{allowHtml:true,timeout:15000,signal:life?.signal})).raw;
    const post=async(path,payload,options={})=>request(path,{method:'POST',body:JSON.stringify(payload),headers:HEADERS,timeout:options.timeout||20000,allowHttpError:options.allowHttpError===true,signal:life?.signal});
    const id=(def,wf)=>({id:{instructionId:def.instructionId,objectId:wf.objectId}});
    const route=def=>def.path+'?experience=Desktop';
    const bootstrap=async def=>{const wf=extractWorkflow(await get(route(def)),def);if(!wf)throw new Error(def.title+': workflow not found');return wf;};
    const status=async(wf,def)=>{const r=await post('/status',id(def,wf));const s=String(r.data?.status||'').toUpperCase();if(!s)throw new Error('AFT status missing');return s;};
    const waitStatus=async(wf,def,accepted,{timeout=20000,pollMs,label='AFT',operation,ignoreStop=false}={})=>{
      const wanted=new Set(accepted),started=performance.now();let polls=0,last=wf.status||'';
      while(performance.now()-started<timeout){
        if(stop()&&!ignoreStop)throw new Error('Stopped by user');
        try{last=await status(wf,def);}catch(error){if(operation){operation.unknown({reason:'status-transport'});throw new V3.operation.UnknownError(label+': status confirmation lost',{cause:error});}throw error;}
        polls++;if(wanted.has(last)){telemetry?.emit('aft.status',{label,state:last,polls,ms:Math.round(performance.now()-started)});return last;}
        if(last==='ERRORED'){if(operation)operation.rejected({reason:'backend-errored'});throw new V3.operation.RejectedError(label+': backend ERRORED');}
        if(!['READY','PROCESSING','COMPLETE'].includes(last)){if(operation){operation.unknown({reason:'unexpected-status',state:last});throw new V3.operation.UnknownError(label+': unexpected status '+last);}throw new Error(label+': status '+last);}
        await life.sleep(pollMs??Math.min(300,60+polls*35));
      }
      if(operation){operation.unknown({reason:'status-timeout'});throw new V3.operation.UnknownError(label+': status timeout');}
      throw new Error(label+': status timeout');
    };
    const action=async(wf,def,actionName,input,label,options={})=>{
      if(stop()&&!options.ignoreStop)throw new Error('Stopped by user');
      const op=options.operation;
      if(op)op.submitted({label});
      let r;
      try{r=await post('/action',{...id(def,wf),action:actionName,input},{timeout:options.timeout||20000,allowHttpError:Boolean(op)});}
      catch(error){if(op){op.unknown({reason:'action-transport'});throw new V3.operation.UnknownError(label+': confirmation lost',{cause:error});}throw error;}
      if(op&&r.httpError){
        if(r.status>=500){op.unknown({status:r.status});throw new V3.operation.UnknownError(label+': HTTP '+r.status+' outcome unknown');}
        op.rejected({status:r.status});throw new V3.operation.RejectedError(label+': rejected HTTP '+r.status,{status:r.status,data:r.data});
      }
      const s=await waitStatus(wf,def,options.complete?['COMPLETE']:['READY'],{timeout:options.timeout||20000,pollMs:options.pollMs,ignoreStop:options.ignoreStop,operation:op,label});
      return{state:s};
    };
    const input=(wf,def,value,label,options)=>action(wf,def,'Input',value,label,options);
    const confirm=(wf,def,options)=>action(wf,def,'Confirm','Confirm','Confirm',options);
    const done=(wf,def)=>action(wf,def,'Done','Done','Done',{complete:true,timeout:180000,pollMs:300,ignoreStop:true});
    const end=(wf,def)=>post('/end',{...id(def,wf),tool:def.tool},{timeout:20000});
    const waitFresh=async(def,oldId,timeout=5000)=>{const started=performance.now();while(performance.now()-started<timeout){const next=await bootstrap(def);if(next.objectId!==oldId)return next;await life.sleep(100);}throw new Error('Fresh AFT workflow not created');};
    const ensureReady=async(def,wf=null)=>{let current=wf||await bootstrap(def);for(let i=0;i<4;i++){if(current.status==='READY')return current;if(current.status==='PROCESSING'){current.status=await waitStatus(current,def,['READY','COMPLETE'],{label:'Ready'});if(current.status==='READY'){current=await bootstrap(def);continue;}}if(current.status==='COMPLETE'){const old=current.objectId;await end(current,def);current=await waitFresh(def,old);continue;}throw new Error('Unexpected AFT state '+current.status);}throw new Error('Could not obtain READY workflow');};
    const ensureMode=async key=>{const def=DEFINITIONS[key];if(!def)throw new Error('Unknown AFT mode '+key);let wf=await ensureReady(def);if(def===DEFINITIONS['edit:fcsku']&&!wf.selector)return wf;if(!wf.selector){await action(wf,def,'SelectMode','SelectMode','Select mode');wf=await bootstrap(def);if(!wf.selector)throw new Error(def.title+': mode selector unavailable');}await action(wf,def,'Input',def.input,'Choose '+def.input,{complete:true});const old=wf.objectId;await end(wf,def);wf=await waitFresh(def,old);return ensureReady(def,wf);};
    const page=async(def,classifier)=>{const raw=await get(route(def)),view=snapshotText(raw);return{html:raw,doc:view.doc,text:view.text,state:classifier?classifier(view.headings+' '+view.text):'unknown',objectId:objectId(raw)};};
    const snapshot=async(wf,def,classifier)=>{const snap=await page(def,classifier);if(!snap.objectId||snap.objectId!==wf.objectId)throw new Error('AFT workflow changed');return snap;};
    return Object.freeze({definitions:DEFINITIONS,bootstrap,ensureReady,ensureMode,input,confirm,done,end,page,snapshot,classifyEdit});
  }
  return Object.freeze({create,DEFINITIONS,classifyEdit,mapState,mapDamage,readMoveQuantity,readSourceChoices});
})();