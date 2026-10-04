V3.moveContainer=(()=>{
  const URL='https://aft-moveapp-nrt-nrt.nrt.proxy.amazon.com/api/move-container';
  const FLOORS=['P1','P2','P3','P4'];
  const UPPER=[['Cubiscan','dz-Pcubiscan-{floor}'],['Prep','dz-P-Prep-{floor}'],['ISS','dz-P-ISS-{floor}'],['Damages','dz-P-Damages-{floor}'],['Hazmat','dz-P-Hazmat-{floor}'],['Nonsort','dz-Pnonsort-{floor}']];
  const P1=[['Hazmat','dz-P-HAZMAT_OUT'],['Ticketland','dz-P-Ticketland'],['Consolidation','dz-P-issconsol'],['ISS WIP','dz-S-ISSWIP1'],['Nonsort','dz-P-IB-nonsort'],['Shipdock','dz-P-ISS-Shipdock'],['OB IOL','dz-P-OBIOL'],['Damageland','dz-Pdamageland'],['Receive Damages','dz-P-rcv-Damages']];
  const destination=(floor,type)=>{if(type==='PRIME')return'dz-P-PRIME';const found=(floor==='P1'?P1:UPPER).find(([name])=>name===type);return !found?'':floor==='P1'?found[1]:found[1].replace('{floor}',floor);};
  const choices=floor=>[['PRIME','dz-P-PRIME'],...(floor==='P1'?P1:UPPER.map(([name,tpl])=>[name,tpl.replace('{floor}',floor)]))];
  async function move(container,dest,{telemetry}={}){
    const code=V3.base.clean(container),target=V3.base.clean(dest);if(!V3.base.container(code))throw new Error('Container must be tsX/csX');if(!target)throw new Error('Destination required');
    const op=V3.operation.create({kind:'move-container',ref:code,telemetry});op.submitted({destination:target});
    let result;
    try{result=await V3.transport.gm(URL,{method:'POST',body:JSON.stringify({sourceScannableId:null,destinationScannableId:target,containerScannableId:code,confirmed:'true'}),headers:{'Content-Type':'application/json'},timeout:15000,allowHttpError:true});}
    catch(error){op.unknown({reason:'transport'});throw new V3.operation.UnknownError('Move submitted; confirmation lost',{cause:error});}
    if(result.status>=500){op.unknown({status:result.status});throw new V3.operation.UnknownError('Move HTTP '+result.status+'; verify before retry');}
    if(result.status<200||result.status>=300){op.rejected({status:result.status});throw new V3.operation.RejectedError('Move rejected HTTP '+result.status,{status:result.status,data:result.data});}
    try{if(result.finalUrl&&new URL(result.finalUrl).pathname.replace(/\/+$/,'')!==new URL(URL).pathname.replace(/\/+$/,'')){op.unknown({reason:'redirect'});throw new V3.operation.UnknownError('Move confirmation redirected unexpectedly');}}catch(error){if(error?.outcome==='unknown')throw error;}
    op.confirmed({status:result.status,destination:target});return result;
  }
  return Object.freeze({URL,FLOORS,UPPER,P1,destination,choices,move});
})();