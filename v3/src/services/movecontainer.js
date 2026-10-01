V3.moveContainer = (() => {
  const URL='https://aft-moveapp-nrt-nrt.nrt.proxy.amazon.com/api/move-container';
  const FLOORS=['P1','P2','P3','P4'];
  const UPPER=[
    ['Cubiscan','dz-Pcubiscan-{floor}'],['Prep','dz-P-Prep-{floor}'],['ISS','dz-P-ISS-{floor}'],
    ['Damages','dz-P-Damages-{floor}'],['Hazmat','dz-P-Hazmat-{floor}'],['Nonsort','dz-Pnonsort-{floor}']
  ];
  const P1=[
    ['Hazmat','dz-P-HAZMAT_OUT'],['Ticketland','dz-P-Ticketland'],['Consolidation','dz-P-issconsol'],
    ['ISS WIP','dz-S-ISSWIP1'],['Nonsort','dz-P-IB-nonsort'],['Shipdock','dz-P-ISS-Shipdock'],
    ['OB IOL','dz-P-OBIOL'],['Damageland','dz-Pdamageland'],['Receive Damages','dz-P-rcv-Damages']
  ];
  const destination=(floor,type)=>{
    if(type==='PRIME')return'dz-P-PRIME';
    const found=(floor==='P1'?P1:UPPER).find(([name])=>name===type);
    return !found?'':floor==='P1'?found[1]:found[1].replace('{floor}',floor);
  };
  const choices=floor=>[['PRIME','dz-P-PRIME'],...(floor==='P1'?P1:UPPER.map(([name,tpl])=>[name,tpl.replace('{floor}',floor)]))];
  async function move(container,destinationScannableId,{telemetry}={}){
    const code=V3.base.clean(container),dest=V3.base.clean(destinationScannableId);
    if(!V3.base.validContainer(code))throw new Error('Container must be tsX/csX');
    if(!dest)throw new Error('Destination required');
    const operation=V3.operation.create({kind:'move-container',ref:code,telemetry});
    const payload={sourceScannableId:null,destinationScannableId:dest,containerScannableId:code,confirmed:'true'};
    const result=await V3.api.gmRequest(URL,{
      method:'POST',data:JSON.stringify(payload),headers:{'Content-Type':'application/json'},
      timeout:15000,mutation:true,operation,telemetry
    });
    const finalUrl=V3.base.clean(result.finalUrl||'');
    if(finalUrl){
      try{
        if(new URL(finalUrl).pathname.replace(/\/+$/,'')!==new URL(URL).pathname.replace(/\/+$/,'')){
          operation.unknown({reason:'redirect'});
          throw new V3.operation.OutcomeUnknownError('Move confirmation redirected unexpectedly');
        }
      }catch(error){if(error?.outcome==='unknown')throw error;}
    }
    operation.confirmed({status:result.status,destination:dest});
    return result;
  }
  return Object.freeze({URL,FLOORS,UPPER,P1,destination,choices,move});
})();