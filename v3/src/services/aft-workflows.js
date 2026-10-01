V3.aftWorkflows = (() => {
  function create(options){
    const client=options.client;
    const telemetry=options.telemetry;
    const stopped=()=>Boolean(options.stopped?.());
    const progress=(message,data={})=>options.onProgress?.(message,data);
    const qtyUpdate=value=>options.onQuantity?.(value);

    const readyWorkflow=async key=>{
      const def=V3.aft.DEFINITIONS[key];
      let workflow=await client.bootstrap(def);
      if(workflow.selector)return client.ensureMode(key);
      return client.ensureReady(def,workflow);
    };
    const confirmLoop=async(workflow,def,ref)=>{
      for(let round=1;round<=10;round++){
        progress('Confirm '+round,{round});
        const op=V3.operation.create({kind:'aft-confirm',ref,telemetry});
        await client.confirm(workflow,def,{operation:op,timeout:300000});
        op.confirmed({round});
        const snap=await client.snapshot(workflow,def,'After confirm '+round,V3.aft.classifyEdit);
        if(snap.state==='error')throw new Error('EditItems returned error after confirm');
        if(snap.state!=='confirm')return snap;
      }
      throw new Error('Too many confirmation rounds');
    };
    const targetState=async(workflow,def,state,damage)=>{
      const mapped=V3.aft.mapState(state);
      await client.input(workflow,def,mapped,'Target state',{timeout:120000});
      if(mapped==='UNSELLABLE')await client.input(workflow,def,V3.aft.mapDamage(damage),'Target disposition',{timeout:120000});
    };

    async function move(params){
      const source=V3.base.clean(params.source),dest=V3.base.clean(params.destination);
      const items=(params.items||[]).map(V3.base.clean).filter(Boolean);
      const qtyMode=String(params.qtyMode||'ALL').toUpperCase();
      const userQty=Number(params.quantity);
      if(!V3.base.validContainer(source)||!V3.base.validContainer(dest))throw new Error('Source and destination must be tsX/csX');
      if(V3.base.upper(source)===V3.base.upper(dest))throw new Error('Source and destination cannot match');
      if(!items.length)throw new Error('Need item barcodes');
      if(qtyMode==='QTY'&&(!Number.isInteger(userQty)||userQty<1))throw new Error('Enter QTY 1+');

      const def=V3.aft.DEFINITIONS['move:multi'];
      const workflow=await client.ensureMode('move:multi');
      progress('Source '+source,{stage:'source'});
      await client.input(workflow,def,source,'Source');

      const results=[];
      for(let i=0;i<items.length;i++){
        if(stopped())throw new Error('Stopped before next item');
        const code=items[i];
        progress((i+1)+'/'+items.length+' Item '+code,{stage:'item',index:i,total:items.length,code});
        await client.input(workflow,def,code,'Item '+(i+1));

        const page=await client.page(def,'Quantity page '+(i+1));
        if(page.objectId!==workflow.objectId)throw new Error('Quantity page workflow changed');
        const info=V3.aft.readMoveQuantity(page.html);
        if(!Number.isInteger(info.qty)){
          telemetry?.emit('aft.quantity.missing',{
            item:V3.telemetry.mask(code),verify:info.verify,
            markers:{quantity:/\bquantity\b/i.test(page.text),source:/scan source/i.test(page.text),destination:/destination/i.test(page.text)},
            text:V3.base.clean(page.text).slice(0,300)
          });
          throw new Error('Quantity unavailable for '+code+(info.verify?' — VERIFY ITEM screen':''));
        }

        const qty=qtyMode==='EACH'?1:qtyMode==='QTY'?userQty:info.qty;
        if(qty>info.qty)throw new Error('QTY UNAVAILABLE · '+code+' · requested '+qty+' · available '+info.qty);
        progress((i+1)+'/'+items.length+' Qty '+qty+'/'+info.qty,{stage:'quantity',available:info.qty,quantity:qty});
        await client.input(workflow,def,String(qty),'Quantity '+(i+1));

        if(stopped())throw new Error('Stopped safely before destination mutation');
        progress((i+1)+'/'+items.length+' Destination '+dest,{stage:'destination'});
        const op=V3.operation.create({kind:'aft-move-destination',ref:code,telemetry});
        await client.input(workflow,def,dest,'Destination '+(i+1),{operation:op,timeout:30000});
        op.confirmed({qty,available:info.qty});
        results.push({code,qty,available:info.qty,state:'done'});
        progress((i+1)+'/'+items.length+' moved ✓',{stage:'moved',done:i+1,total:items.length});
      }

      await client.done(workflow,def);
      await client.end(workflow,def);
      telemetry?.emit('move.done',{count:results.length});
      return results;
    }

    async function editEach(params){
      const rows=(params.rows||[]).filter(row=>row?.location&&row?.fnsku);
      if(!rows.length)throw new Error('Need Location + FNSKU rows');
      const def=V3.aft.DEFINITIONS['edit:each'];
      let workflow=await client.ensureMode('edit:each');
      const results=[];
      for(let i=0;i<rows.length;i++){
        if(stopped())throw new Error('Stopped before next row');
        if(i>0)workflow=await readyWorkflow('edit:each');
        const item=rows[i];
        progress((i+1)+'/'+rows.length+' Location '+item.location,{stage:'location',index:i,total:rows.length});
        await client.input(workflow,def,item.location,'Location');
        progress((i+1)+'/'+rows.length+' Item '+item.fnsku,{stage:'item'});
        await client.input(workflow,def,item.fnsku,'Item');
        const afterItem=await client.snapshot(workflow,def,'After item',V3.aft.classifyEdit);
        if(afterItem.state==='sourceState')throw new Error(item.fnsku+': source state could not be inferred');
        if(afterItem.state!=='newState')throw new Error(item.fnsku+': expected new state, got '+afterItem.state);
        await targetState(workflow,def,params.desiredState||'Unsellable',params.desiredDamage||'Defective');
        const final=await confirmLoop(workflow,def,item.fnsku);
        if(final.state==='success')await client.done(workflow,def);
        else if(final.state!=='item')throw new Error(item.fnsku+': expected success/item, got '+final.state);
        await client.end(workflow,def);
        results.push({...item,state:'done'});
        telemetry?.emit('edit.each.done',{item:V3.telemetry.mask(item.fnsku),location:V3.telemetry.mask(item.location)});
      }
      return results;
    }

    async function editSku(params){
      const sku=V3.base.clean(params.sku);
      if(!sku)throw new Error('Enter SKU / ASIN / FNSKU / FCSKU');
      const currentState=params.currentState||'Sellable';
      const currentDamage=params.currentDamage||'Defective';
      const desiredState=params.desiredState||'Unsellable';
      const desiredDamage=params.desiredDamage||'Defective';
      const wanted=V3.aft.mapState(currentState);
      const wantedChoice=wanted==='INVENTORY'?'SELLABLE':wanted;
      const def=V3.aft.DEFINITIONS['edit:sku'];
      let workflow=await client.ensureMode('edit:sku');
      let flips=0;

      for(let attempt=1;attempt<=50;attempt++){
        if(stopped())throw new Error('Stopped before next attempt');
        if(attempt>1)workflow=await readyWorkflow('edit:sku');
        progress('Attempt '+attempt+' · SKU lookup',{stage:'lookup',attempt});
        await client.input(workflow,def,sku,'SKU');
        const source=await client.snapshot(workflow,def,'Source state',V3.aft.classifyEdit);
        if(source.state==='retryError')throw new Error('AFT consumer-type retry error');
        if(source.state!=='sourceState')throw new Error('Expected sourceState, got '+source.state);

        const choices=V3.aft.readSourceChoices(source.doc);
        const quantities={sellable:null,pending:null,unsellable:null};
        for(const choice of choices){
          if(choice.state==='SELLABLE')quantities.sellable=choice.qty;
          else if(choice.state==='PENDING_RESEARCH')quantities.pending=choice.qty;
          else if(choice.state==='UNSELLABLE')quantities.unsellable=choice.qty;
        }
        qtyUpdate(quantities);

        const matches=choices.filter(choice=>choice.state===wantedChoice&&!choice.disabled);
        if(matches.length!==1){
          const available=choices.map(x=>x.state+':'+(x.qty??'?')).join(', ');
          throw new Error('Source '+wanted+' ambiguous/unavailable · '+available);
        }
        const selected=matches[0];
        if(selected.qty===0){
          await client.end(workflow,def);
          progress('DONE · 0 '+currentState+' remaining',{stage:'done',flips});
          return{flips,quantities};
        }
        if(!Number.isInteger(selected.qty))throw new Error('Could not read '+currentState+' quantity');

        progress('Attempt '+attempt+' · Source '+currentState+' ('+selected.qty+')',{stage:'source'});
        await client.input(workflow,def,selected.value||wanted,'Source state',{timeout:120000});
        if(wanted==='UNSELLABLE')await client.input(workflow,def,V3.aft.mapDamage(currentDamage),'Source disposition',{timeout:120000});

        const afterSource=await client.snapshot(workflow,def,'After source',V3.aft.classifyEdit);
        if(afterSource.state==='retryError'||afterSource.state==='sourceState')throw new Error('Source state did not advance');
        if(afterSource.state!=='newState')throw new Error('Expected newState, got '+afterSource.state);

        await targetState(workflow,def,desiredState,desiredDamage);
        const final=await confirmLoop(workflow,def,sku);
        if(final.state==='retryError')throw new Error('AFT consumer-type retry error');
        if(final.state!=='success')throw new Error('Expected success, got '+final.state);
        await client.done(workflow,def);
        await client.end(workflow,def);
        flips++;
        telemetry?.emit('edit.sku.flip',{sku:V3.telemetry.mask(sku),attempt,startQty:selected.qty});
      }
      throw new Error('Stopped after 50 SKU attempts');
    }

    async function fcsku(params){
      const oldCode=V3.base.clean(params.oldCode),newCode=V3.base.clean(params.newCode);
      const locations=(params.locations||[]).map(V3.base.clean).filter(Boolean);
      if(!oldCode||!newCode)throw new Error('Need OLD + NEW FCSKU');
      if(!locations.length)throw new Error('Need locations/containers');
      const def=V3.aft.DEFINITIONS['edit:fcsku'];
      let workflow=await client.ensureMode('edit:fcsku');
      const results=[];
      for(let i=0;i<locations.length;i++){
        if(stopped())throw new Error('Stopped before next location');
        if(i>0)workflow=await readyWorkflow('edit:fcsku');
        const location=locations[i];
        progress((i+1)+'/'+locations.length+' Container '+location,{stage:'container',index:i,total:locations.length});
        await client.input(workflow,def,location,'Container');
        await client.input(workflow,def,oldCode,'OLD');
        await client.input(workflow,def,newCode,'NEW');
        if(stopped())throw new Error('Stopped safely before confirm');
        const op=V3.operation.create({kind:'aft-fcsku-confirm',ref:location,telemetry});
        await client.confirm(workflow,def,{operation:op,timeout:30000});
        op.confirmed();
        await client.end(workflow,def);
        results.push({location,state:'done'});
        telemetry?.emit('fcsku.done',{location:V3.telemetry.mask(location),old:V3.telemetry.mask(oldCode),neu:V3.telemetry.mask(newCode)});
      }
      return results;
    }

    return Object.freeze({move,editEach,editSku,fcsku});
  }
  return Object.freeze({create});
})();