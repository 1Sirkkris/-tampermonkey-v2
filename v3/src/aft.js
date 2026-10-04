V3.aft=(()=>{
  const C=V3.core;
  const DEFAULT_ORIGIN='https://aft-qt-jp.aka.nrt.corp.amazon.com';
  const DEFINITIONS={
    'edit:each':{title:'Edit EACH',area:'edit',mode:'each',path:'/app/edititems',instructionId:'EditItems',tool:'edititems',input:'EACH'},
    'edit:sku':{title:'Edit SKU',area:'edit',mode:'sku',path:'/app/edititems',instructionId:'EditItems',tool:'edititems',input:'SKU'},
    'edit:date':{title:'Edit DATE',area:'edit',mode:'date',path:'/app/edititems',instructionId:'EditItems',tool:'edititems',input:'DATELOT'},
    'edit:fcsku':{title:'FCSKU Flip',area:'edit',mode:'fcsku',path:'/app/fcskuflip',instructionId:'FcSkuFlip',tool:'fcskuflip',input:'SKU'},
    'move:multi':{title:'Move Multi',area:'move',mode:'multi',path:'/app/moveitems',instructionId:'MoveItems',tool:'moveitems',input:'MULTI'}
  };
  const EDIT_STATES=[
    ['location',['scan location','scan container','input location','enter location','enter container']],
    ['item',['input fnsku or fcsku','input item','scan item','enter the sku','enter item']],
    ['sourceState',['select source inventory state']],
    ['sourceDisp',['select source disposition','select source disposition type']],
    ['newState',['select new inventory state']],
    ['newDisp',['select new disposition','select disposition type']],
    ['dateRemove',['confirm expiry date removal','remove expiry date']],
    ['dateEntry',['enter expiry date','enter expiration date']],
    ['dateConfirm',['confirm new expiry date','save expiry date']],
    ['confirm',['confirm change','confirm to continue']],
    ['success',['success items changed','items changed from','current expiry date:']],
    ['retryError',['failed to change consumer type. please try again','failed to change consumer type']],
    ['error',['work is errored','the service failed to process your request','service failed']],
    ['loading',['loading']]
  ];
  const HEADERS={'Content-Type':'application/json; charset=utf-8','Accept':'application/json, text/javascript, */*; q=0.01','X-Requested-With':'XMLHttpRequest'};
  const classifyEdit=text=>{const value=C.lower(text);let state='unknown',best=Infinity;for(const [name,phrases] of EDIT_STATES)for(const phrase of phrases){const i=value.indexOf(phrase);if(i>=0&&i<best){best=i;state=name;}}return state;};
  const classifyFcsku=text=>{const v=C.lower(text);if(v.includes('success'))return'success';if(v.includes('confirm flip'))return'confirm';if(v.includes('enter new fnsku')||v.includes('enter new fcsku'))return'new';if(v.includes('input item')&&v.includes('fnskus'))return'old';if(v.includes('scan container'))return'container';return'unknown';};
  const objectId=raw=>String(raw||'').match(/(?:&quot;|")objectId(?:&quot;|")\s*:\s*(?:&quot;|")([^"&<]+)(?:&quot;|")/i)?.[1]||String(raw||'').match(/\b[A-Z0-9]{2,12}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i)?.[0]||'';
  const snapshotView=raw=>{const doc=C.html(raw);for(const el of doc.querySelectorAll('script,style,noscript,template,svg,[hidden],[aria-hidden="true"],.aft-tool-hide,.aok-hidden,.a-hidden,[style*="display:none"],[style*="visibility:hidden"]'))el.remove();const headings=C.clean([...doc.querySelectorAll('h1,h2,h3,[role="heading"]')].map(x=>x.textContent||'').join(' '));return{doc,text:C.clean(doc.body?.textContent||''),headings};};
  const extractWorkflow=(raw,def)=>{
    const source=String(raw||'').replace(/&quot;/gi,'"').replace(/&#34;/gi,'"').replace(/&#x22;/gi,'"').replace(/\\"/g,'"').replace(/&amp;/gi,'&');
    const anchor=new RegExp('"instructionId"\\s*:\\s*"'+def.instructionId+'"','i').exec(source);if(!anchor)return null;
    const remaining=source.slice(anchor.index),next=remaining.slice(anchor[0].length).search(/"instructionId"/),scope=remaining.slice(0,Math.min(3000,next<0?remaining.length:anchor[0].length+next)),grab=name=>scope.match(new RegExp('"'+name+'"\\s*:\\s*"([^"]+)"','i'))?.[1]||'';
    const wf={instructionId:grab('instructionId'),tool:C.lower(grab('tool')),objectId:grab('objectId'),status:C.upper(grab('status')),selector:/<input\b[^>]*\bname\s*=\s*["']options["']/i.test(source)};
    if(!wf.objectId||!wf.status||wf.instructionId!==def.instructionId)return null;if(wf.tool&&wf.tool!==def.tool)return null;return wf;
  };
  const mapState=value=>{const v=C.lower(value);if(v==='sellable'||v==='inventory')return'INVENTORY';if(v==='pending research'||v==='pending')return'PENDING_RESEARCH';if(v==='unsellable')return'UNSELLABLE';throw new Error('Unsupported inventory state '+value);};
  const mapDamage=value=>{const v=C.lower(value);if(v==='amazon damage'||v==='warehouse damage')return'AMAZON_DAMAGE';if(v==='defective')return'DEFECTIVE';if(v==='distributor damage')return'DISTRIBUTOR_DAMAGE';if(v==='expired')return'EXPIRED';throw new Error('Unsupported disposition '+value);};
  const readMoveQuantity=raw=>{const view=snapshotView(raw),match=view.text.match(/\bQuantity\s*[:\-]?\s*(\d{1,6})\b/i),qty=Number(match?.[1]);return{qty:Number.isSafeInteger(qty)&&qty>0?qty:null,verify:/\bVerify item\b/i.test(view.headings+' '+view.text)};};
  const sourceChoices=doc=>{
    const out=[];for(const radio of doc?.querySelectorAll?.('input[type="radio"]')||[]){let label='';try{label=[...(radio.labels||[])].map(x=>x.textContent||'').join(' ');}catch{}if(!label)label=radio.closest('label')?.textContent||radio.parentElement?.textContent||'';label=C.clean(label);if(!/Quantity\s*:/i.test(label)||!/Owner\s*:/i.test(label))continue;let state='';if(/Pending Research|PENDING_RESEARCH/i.test(label))state='PENDING_RESEARCH';else if(/Unsellable|UNSELLABLE/i.test(label))state='UNSELLABLE';else if(/(?:Inventory|Sellable)|\bSELLABLE\b/i.test(label))state='SELLABLE';if(!state)continue;const qty=Number(label.match(/\bQuantity\s*:\s*(\d{1,7})\b/i)?.[1]);out.push({state,label,value:radio.value||'',qty:Number.isInteger(qty)?qty:null,disabled:Boolean(radio.disabled)});}return out;
  };
  const parseEach=text=>String(text||'').split(/\r?\n/).map(C.clean).filter(Boolean).map(line=>{const [location='',asin='',fnsku='']=line.split(/\s+/);return location&&asin?{location,asin,fnsku:fnsku||asin}:null;}).filter(Boolean);
  const parseItems=text=>{const seen=new Set(),out=[];for(const line of String(text||'').split(/\r?\n/)){const value=C.clean(line.split(/\s+/)[0]);if(!value)continue;const key=C.upper(value);if(seen.has(key))continue;seen.add(key);out.push(value);}return out;};
  const datePayload=date=>{const m=String(date||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m||new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]))).toISOString().slice(0,10)!==date)throw new Error('Invalid date '+date);return JSON.stringify({'year-input':m[1],'month-input':m[2],'day-input':m[3],'':''});};

  function create({origin,life,telemetry,stopped=()=>false}={}){
    origin=String(origin||(/^aft-qt-/i.test(location.hostname)?location.origin:DEFAULT_ORIGIN)).replace(/\/$/,'');
    const url=path=>origin+path;
    const req=async(path,options={})=>C.request(url(path),{...options,signal:options.signal||life?.signal});
    const get=async path=>(await req(path,{allowHtml:true,timeout:15000})).raw;
    const post=async(path,payload,{timeout=20000,allowHttpError=false}={})=>req(path,{method:'POST',body:JSON.stringify(payload),headers:HEADERS,timeout,allowHttpError});
    const route=def=>def.path+'?experience=Desktop';
    const pageRaw=def=>get(route(def));
    const page=async(def,classifier)=>{const raw=await pageRaw(def),view=snapshotView(raw);return{raw,doc:view.doc,text:view.text,state:classifier?classifier(view.headings+' '+view.text):'unknown',objectId:objectId(raw)};};
    const workflow=async def=>{const wf=extractWorkflow(await pageRaw(def),def);if(!wf)throw new Error(def.title+': workflow not found');return wf;};
    const ids=(def,wf)=>({id:{instructionId:def.instructionId,objectId:wf.objectId}});
    const status=async(def,wf)=>{const r=await post('/status',ids(def,wf));const value=C.upper(r.data?.status);if(!value)throw new Error('AFT status missing');return value;};
    const waitStatus=async(def,wf,accepted,{timeout=20000,pollMs,operation:op,label='AFT',ignoreStop=false}={})=>{
      const wanted=new Set(accepted),started=performance.now();let polls=0,last=wf.status||'';
      while(performance.now()-started<timeout){
        if(stopped()&&!ignoreStop)throw new Error('Stopped by user');
        try{last=await status(def,wf);}catch(error){if(op){op.unknown({reason:'status-transport'});throw new C.UnknownError(label+': confirmation lost',{cause:error});}throw error;}
        polls++;if(wanted.has(last)){telemetry?.emit('aft.status',{label,state:last,polls,ms:Math.round(performance.now()-started)});return last;}
        if(last==='ERRORED'){if(op){op.unknown({reason:'backend-errored'});throw new C.UnknownError(label+': backend ERRORED after submission — verify resulting inventory');}throw new C.RejectedError(label+': backend ERRORED');}
        if(!['READY','PROCESSING','COMPLETE'].includes(last)){if(op){op.unknown({reason:'unexpected-status',state:last});throw new C.UnknownError(label+': unexpected status '+last);}throw new Error(label+': status '+last);}
        await life.sleep(pollMs??Math.min(300,60+polls*35));
      }
      if(op){op.unknown({reason:'status-timeout'});throw new C.UnknownError(label+': status timeout');}
      throw new Error(label+': status timeout');
    };
    const action=async(def,wf,actionName,input,label,{complete=false,timeout=20000,pollMs,operation:op,ignoreStop=false}={})=>{
      if(stopped()&&!ignoreStop)throw new Error('Stopped by user');
      if(op)op.submitted({label});
      let r;
      try{r=await post('/action',{...ids(def,wf),action:actionName,input},{timeout,allowHttpError:Boolean(op)});}
      catch(error){if(op){op.unknown({reason:'action-transport'});throw new C.UnknownError(label+': submission confirmation lost',{cause:error});}throw error;}
      if(op&&r.httpError){if(r.status>=500||r.status===408){op.unknown({status:r.status});throw new C.UnknownError(label+': HTTP '+r.status+' outcome unknown');}op.rejected({status:r.status});throw new C.RejectedError(label+': rejected HTTP '+r.status);}
      const settled=await waitStatus(def,wf,complete?['COMPLETE']:['READY'],{timeout,pollMs,operation:op,label,ignoreStop:ignoreStop||Boolean(op)});
      if(op){
        try{
          const after=await page(def,def.tool==='fcskuflip'?classifyFcsku:classifyEdit);
          if(after.objectId!==wf.objectId)throw new Error('Workflow changed during confirmation');
          const proved=op.kind==='aft-date-remove'?['success','dateEntry','item'].includes(after.state):def.tool==='moveitems'?/input item|scan item|enter item/i.test(after.text)&&!/verify item|work is errored/i.test(after.text):['success','item'].includes(after.state);
          if(!proved)throw new Error('Application did not prove the mutation result');
          op.confirmed({state:after.state});return after;
        }catch(error){op.unknown({reason:'application-confirmation-missing'});throw new C.UnknownError(label+': result not proven — verify before retry',{cause:error});}
      }
      return settled;
    };
    const input=(def,wf,value,label,opts)=>action(def,wf,'Input',value,label,opts);
    const confirm=(def,wf,opts)=>action(def,wf,'Confirm','Confirm','Confirm',opts);
    const done=(def,wf)=>action(def,wf,'Done','Done','Done',{complete:true,timeout:180000,pollMs:300,ignoreStop:true});
    const end=(def,wf)=>post('/end',{...ids(def,wf),tool:def.tool},{timeout:20000});
    const fresh=async(def,oldId,timeout=6000)=>{const start=performance.now();while(performance.now()-start<timeout){const next=await workflow(def);if(next.objectId!==oldId)return next;await life.sleep(100);}throw new Error('Fresh AFT workflow not created');};
    const ensureReady=async(def,wf=null)=>{let current=wf||await workflow(def);for(let i=0;i<5;i++){if(current.status==='READY')return current;if(current.status==='PROCESSING'){current.status=await waitStatus(def,current,['READY','COMPLETE'],{label:'Ready'});if(current.status==='READY')return current;}if(current.status==='COMPLETE'){const old=current.objectId;await end(def,current);current=await fresh(def,old);continue;}throw new Error('Unexpected AFT state '+current.status);}throw new Error('Could not obtain READY workflow');};
    const ensureMode=async key=>{
      const def=DEFINITIONS[key];if(!def)throw new Error('Unknown AFT mode '+key);let wf=await ensureReady(def);
      if(key==='edit:fcsku'&&!wf.selector)return{def,wf};
      if(!wf.selector){await action(def,wf,'SelectMode','SelectMode','Select mode');wf=await workflow(def);if(!wf.selector)throw new Error(def.title+': mode selector unavailable');}
      await action(def,wf,'Input',def.input,'Choose '+def.input,{complete:true});const old=wf.objectId;await end(def,wf);wf=await fresh(def,old);return{def,wf:await ensureReady(def,wf)};
    };
    const snap=async(def,wf,classifier)=>{const s=await page(def,classifier);if(!s.objectId||s.objectId!==wf.objectId)throw new Error('AFT workflow changed');return s;};
    const exactSource=(doc,state)=>{
      const wanted=state==='INVENTORY'?'SELLABLE':state,matches=sourceChoices(doc).filter(x=>x.state===wanted&&!x.disabled);
      if(matches.length!==1)throw new Error(matches.length?'Multiple '+state+' source options — manual review required':'Requested source '+state+' not available');
      return matches[0];
    };
    const applyTarget=async(def,wf,state,damage)=>{
      await input(def,wf,state,'Target state');
      if(state==='UNSELLABLE')await input(def,wf,mapDamage(damage),'Target disposition');
    };
    async function runMove({source,destination,items,mode='all',qty=1,onProgress=()=>{}}={}){
      source=C.clean(source);destination=C.clean(destination);items=parseItems(Array.isArray(items)?items.join('\n'):items);
      if(!C.container(source)||!C.container(destination)||C.lower(source)===C.lower(destination))throw new Error('Valid different source/destination containers required');
      if(!items.length)throw new Error('No Move items');
      const userQty=Number(qty);if(mode==='qty'&&(!Number.isSafeInteger(userQty)||userQty<1))throw new Error('Invalid quantity');
      const {def,wf}=await ensureMode('move:multi');let confirmed=0;
      try{
        onProgress({stage:'source',confirmed,total:items.length});await input(def,wf,source,'Source');
        for(let i=0;i<items.length;i++){
          if(stopped())throw new Error('Stopped by user');
          const barcode=items[i];onProgress({stage:'item',barcode,current:i+1,total:items.length,confirmed});
          await input(def,wf,barcode,'Item '+(i+1));
          const raw=await pageRaw(def),idNow=objectId(raw);if(idNow!==wf.objectId)throw new Error('AFT workflow changed while reading quantity');
          const info=readMoveQuantity(raw);if(info.verify)throw new Error('Verify Item screen detected');if(!info.qty)throw new Error('Quantity not found for '+barcode);
          const wanted=mode==='each'?1:mode==='qty'?userQty:info.qty;if(wanted>info.qty)throw new Error('QTY UNAVAILABLE • '+barcode+' • requested '+wanted+' • available '+info.qty);
          onProgress({stage:'quantity',barcode,qty:wanted,available:info.qty,current:i+1,total:items.length,confirmed});
          await input(def,wf,String(wanted),'Quantity '+(i+1));
          const op=C.operation({kind:'aft-move',ref:barcode,telemetry});
          onProgress({stage:'destination',barcode,current:i+1,total:items.length,confirmed});
          try{await input(def,wf,destination,'Destination '+(i+1),{operation:op});}
          catch(error){
            error.aftPartial={kind:'move',confirmed,total:items.length,uncertain:error?.outcome==='unknown'?[barcode]:[],remaining:items.slice(i+(error?.outcome==='unknown'?1:0)),source,destination};
            throw error;
          }
          confirmed++;onProgress({stage:'confirmed',barcode,current:i+1,total:items.length,confirmed});
        }
        onProgress({stage:'finish',confirmed,total:items.length});await done(def,wf);
        try{await end(def,wf);}catch(error){const e=new C.UnknownError('Items confirmed moved, but AFT finalization was not confirmed',{cause:error});e.aftPartial={kind:'move-finalize',confirmed,total:items.length,uncertain:[],remaining:[]};throw e;}
        return{confirmed,total:items.length};
      }catch(error){
        if(error?.outcome!=='unknown')try{await end(def,wf);}catch{}
        if(!error.aftPartial)error.aftPartial={kind:'move',confirmed,total:items.length,uncertain:[],remaining:items.slice(confirmed),source,destination};
        throw error;
      }
    }

    async function runEditEach({items,destState='Pending Research',destDamage='Defective',onProgress=()=>{}}={}){
      const rows=Array.isArray(items)?items:parseEach(items);if(!rows.length)throw new Error('EACH needs: TOTE ASIN [FNSKU]');
      const desired=mapState(destState),{def}=await ensureMode('edit:each');let wf=await ensureReady(def),confirmed=0,currentLocation='',needsFresh=false;
      try{
        for(let i=0;i<rows.length;i++){
          if(stopped())throw new Error('Stopped by user');const row=rows[i];if(needsFresh){await end(def,wf);wf=await fresh(def,wf.objectId);wf=await ensureReady(def,wf);currentLocation='';needsFresh=false;}
          if(C.lower(row.location)!==C.lower(currentLocation)){if(currentLocation){try{await end(def,wf);}catch{}wf=await fresh(def,wf.objectId);wf=await ensureReady(def,wf);}onProgress({stage:'location',current:i+1,total:rows.length,row});await input(def,wf,row.location,'Location');currentLocation=row.location;}
          onProgress({stage:'item',current:i+1,total:rows.length,row});await input(def,wf,row.fnsku||row.asin,'Item');
          const afterItem=await snap(def,wf,classifyEdit);if(afterItem.state==='sourceState')throw new Error('EditItems could not infer source state; stopped before mutation');if(afterItem.state!=='newState')throw new Error('After item expected newState, got '+afterItem.state);
          await applyTarget(def,wf,desired,destDamage);
          const before=await snap(def,wf,classifyEdit);if(before.state!=='confirm')throw new Error('Expected confirm, got '+before.state);
          const op=C.operation({kind:'aft-edit-each',ref:row.fnsku||row.asin,telemetry});
          const result=await confirm(def,wf,{timeout:180000,operation:op});
          confirmed++;if(result.state==='success'){await done(def,wf);needsFresh=true;}onProgress({stage:'confirmed',confirmed,total:rows.length,row});
        }
        try{await end(def,wf);}catch{}
        return{confirmed,total:rows.length};
      }catch(error){if(error?.outcome!=='unknown')try{await end(def,wf);}catch{}error.aftPartial={kind:'edit-each',confirmed,total:rows.length,uncertain:error?.outcome==='unknown'?[rows[confirmed]]:[],remaining:rows.slice(confirmed+(error?.outcome==='unknown'?1:0))};throw error;}
    }

    async function runEditSku({items,sourceState='Sellable',sourceDamage='Defective',destState='Pending Research',destDamage='Defective',onProgress=()=>{}}={}){
      const list=parseItems(Array.isArray(items)?items.join('\n'):items);if(!list.length)throw new Error('No Edit items');
      const from=mapState(sourceState),to=mapState(destState);if(from===to&&from!=='UNSELLABLE')throw new Error('Source and destination state cannot match');
      const def=DEFINITIONS['edit:sku'];let flipped=0,zero=0;const failed=[];
      await ensureMode('edit:sku');
      for(let index=0;index<list.length;index++){
        const sku=list[index];let attempts=0,lastQty=Infinity;
        try{
          while(attempts++<50){
            if(stopped())throw new Error('Stopped by user');
            let wf=await ensureReady(def);onProgress({stage:'lookup',sku,current:index+1,total:list.length,attempt:attempts});
            await input(def,wf,sku,'SKU');
            const sourcePage=await snap(def,wf,classifyEdit);if(sourcePage.state!=='sourceState')throw new Error('Expected sourceState after lookup, got '+sourcePage.state);
            const choice=exactSource(sourcePage.doc,from),qty=choice.qty;
            onProgress({stage:'quantity',sku,qty,current:index+1,total:list.length,attempt:attempts,inventory:Object.fromEntries(sourceChoices(sourcePage.doc).map(x=>[x.state,x.qty]))});
            if(qty===0){zero++;try{await end(def,wf);}catch{}break;}
            if(!Number.isInteger(qty))throw new Error('Could not read '+sourceState+' quantity');
            if(qty>=lastQty)throw new Error('No inventory progress after confirmed change — stopped before another edit');
            lastQty=qty;
            await input(def,wf,choice.value||from,'Source state',{timeout:120000});
            if(from==='UNSELLABLE')await input(def,wf,mapDamage(sourceDamage),'Source disposition',{timeout:120000});
            const afterSource=await snap(def,wf,classifyEdit);if(afterSource.state!=='newState')throw new Error('Expected newState after source selection, got '+afterSource.state);
            await applyTarget(def,wf,to,destDamage);
            const before=await snap(def,wf,classifyEdit);if(before.state!=='confirm')throw new Error('Expected confirm, got '+before.state);
            const op=C.operation({kind:'aft-edit-sku',ref:sku,telemetry});const result=await confirm(def,wf,{timeout:180000,operation:op});
            flipped++;
            if(result.state==='success')await done(def,wf);
            try{await end(def,wf);}catch{}
            onProgress({stage:'confirmed',sku,current:index+1,total:list.length,attempt:attempts});
          }
          if(attempts>50)throw new Error('Stopped after 50 SKU attempts');
        }catch(error){
          if(error?.outcome==='unknown'){error.aftPartial={kind:'edit-sku',confirmed:flipped,total:list.length,uncertain:[sku],remaining:list.slice(index+1),failed};throw error;}
          if(stopped()){error.aftPartial={kind:'edit-sku',confirmed:flipped,total:list.length,uncertain:[],remaining:list.slice(index),failed};throw error;}
          failed.push({sku,message:C.clean(error.message||error)});onProgress({stage:'failed',sku,current:index+1,total:list.length,message:C.clean(error.message||error)});
          try{const current=await workflow(def);await end(def,current);}catch{}
        }
      }
      return{flipped,zero,failed,total:list.length};
    }

    async function runFcsku({oldCode,newCode,locations,onProgress=()=>{}}={}){
      oldCode=C.clean(oldCode);newCode=C.clean(newCode);const list=parseItems(Array.isArray(locations)?locations.join('\n'):locations);
      if(!oldCode||!newCode||!list.length)throw new Error('Need OLD + NEW FCSKU and at least one location');
      const def=DEFINITIONS['edit:fcsku'];let confirmed=0,failed=[],remaining=[];
      let wf=(await ensureMode('edit:fcsku')).wf;
      for(let i=0;i<list.length;i++){
        const location=list[i];if(stopped()){remaining=list.slice(i);break;}
        try{
          if(i>0){wf=await fresh(def,wf.objectId);wf=await ensureReady(def,wf);}
          onProgress({stage:'container',current:i+1,total:list.length,location});await input(def,wf,location,'Container');
          await input(def,wf,oldCode,'Old FCSKU');await input(def,wf,newCode,'New FCSKU');
          const op=C.operation({kind:'aft-fcsku',ref:location,telemetry});await confirm(def,wf,{operation:op,timeout:120000});confirmed++;try{await end(def,wf);}catch(error){error.aftPartial={kind:'fcsku-finalize',confirmed,total:list.length,uncertain:[],remaining:list.slice(i+1),failed};throw error;}
        }catch(error){
          if(error?.outcome==='unknown'){error.aftPartial={kind:'fcsku',confirmed,total:list.length,uncertain:[location],remaining:list.slice(i+1),failed};throw error;}
          if(error.aftPartial)throw error;
          failed.push({location,message:C.clean(error.message||error)});try{await end(def,wf);}catch{}
        }
      }
      return{confirmed,total:list.length,failed,remaining};
    }

    async function runDate({rows,onProgress=()=>{}}={}){
      const list=(Array.isArray(rows)?rows:[]).filter(x=>C.clean(x?.location)&&C.clean(x?.asin)&&C.clean(x?.date));if(!list.length)throw new Error('No expiry rows');
      // Validate the entire batch before opening a workflow or removing an existing expiry.
      const payloads=list.map(row=>datePayload(row.date));
      const def=DEFINITIONS['edit:date'];let confirmed=0,remaining=[],wf=(await ensureMode('edit:date')).wf;
      for(let i=0;i<list.length;i++){
        const row=list[i];if(stopped()){remaining=list.slice(i);break;}
        let expiryRemoved=false,rowConfirmed=false;
        try{
          if(i>0){wf=await fresh(def,wf.objectId);wf=await ensureReady(def,wf);}
          await input(def,wf,row.location,'Container',{timeout:120000});await input(def,wf,row.asin,'Item',{timeout:120000});
          let s=await snap(def,wf,classifyEdit);
          if(s.state==='dateRemove'){const remove=C.operation({kind:'aft-date-remove',ref:row.asin,telemetry});await confirm(def,wf,{timeout:180000,operation:remove});expiryRemoved=true;await end(def,wf);wf=await fresh(def,wf.objectId);wf=await ensureReady(def,wf);await input(def,wf,row.location,'Container restart',{timeout:120000});await input(def,wf,row.asin,'Item restart',{timeout:120000});s=await snap(def,wf,classifyEdit);}
          if(s.state!=='dateEntry')throw new Error('Expected expiry date entry, got '+s.state);
          await input(def,wf,payloads[i],'Expiry date',{timeout:120000});const before=await snap(def,wf,classifyEdit);if(before.state!=='dateConfirm'&&before.state!=='confirm')throw new Error('Expected expiry confirmation, got '+before.state);
          const op=C.operation({kind:'aft-edit-date',ref:row.asin,telemetry});await confirm(def,wf,{timeout:180000,operation:op});confirmed++;rowConfirmed=true;onProgress({stage:'confirmed',confirmed,total:list.length,row});
          try{await end(def,wf);}catch{}
        }catch(error){
          // Removal is a separate committed mutation. A failed replacement requires review.
          if(expiryRemoved&&!rowConfirmed&&error?.outcome!=='unknown'){
            const review=C.operation({kind:'aft-date-replacement',ref:row.asin,scope:'aft',telemetry});review.submitted({reason:'existing-expiry-already-removed'});review.unknown({reason:'expiry-removed-replacement-incomplete'});
            error=new C.UnknownError('Existing expiry removed; replacement not confirmed — verify item before retry',{cause:error});
          }
          const uncertain=error?.outcome==='unknown'&&!rowConfirmed;
          error.aftPartial={kind:'edit-date',confirmed,total:list.length,uncertain:uncertain?[row]:[],remaining:list.slice(i+(uncertain||rowConfirmed?1:0))};throw error;
        }
      }
      return{confirmed,total:list.length,remaining};
    }

    return Object.freeze({origin,route,page,workflow,status,waitStatus,action,input,confirm,done,end,ensureReady,ensureMode,runMove,runEditEach,runEditSku,runFcsku,runDate});
  }

  return Object.freeze({DEFAULT_ORIGIN,DEFINITIONS,classifyEdit,classifyFcsku,extractWorkflow,mapState,mapDamage,readMoveQuantity,sourceChoices,parseEach,parseItems,datePayload,create});
})();
