V3.actions=(()=>{
  const C=V3.core;
  const MOVE_ORIGIN='https://aft-moveapp-nrt-nrt.nrt.proxy.amazon.com';
  const HIERARCHY_ORIGIN='https://tx-b-hierarchy-nrt.nrt.proxy.amazon.com';
  const MOVE_PATH='/api/move-container';
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

  const dropChoices=floor=>FLOORS.includes(floor)?floor==='P1'?P1:UPPER:[];
  const destination=(floor,key)=>{
    if(!FLOORS.includes(floor))return'';
    if(key==='PRIME'||key==='Prime')return'dz-P-PRIME';
    const row=dropChoices(floor).find(x=>x.key===key||x.label===key);
    return row?(floor==='P1'?row.dest:row.pattern.replace('{floor}',floor)):'';
  };

  const movePayload=(container,dest)=>({sourceScannableId:null,destinationScannableId:C.clean(dest),containerScannableId:C.clean(container),confirmed:'true'});
  const strictMoveConfirmation=(result,{container,destination}={})=>{
    const status=Number(result?.status);
    if(!Number.isInteger(status)||status<=0||status>=500||status===408||status===202)throw new C.UnknownError('MoveContainer outcome unknown HTTP '+(status||0));
    if(result.flags?.auth||result.flags?.html)throw new C.UnknownError('MoveContainer confirmation was an authentication/HTML response');
    const expected=new URL(MOVE_ORIGIN+MOVE_PATH);let actual;
    try{actual=new URL(result.finalUrl||expected.href,expected.href);}catch{throw new C.UnknownError('MoveContainer confirmation URL is invalid');}
    if(actual.origin!==expected.origin||actual.pathname.replace(/\/+$/,'')!==expected.pathname)throw new C.UnknownError('MoveContainer confirmation redirected unexpectedly');
    if(status<200||status>=300)throw new C.RejectedError('MoveContainer rejected HTTP '+status);
    const data=result.data,positive=data?.success===true||data?.status==='SUCCESS',negative=data?.success===false||data?.error||data?.errorMessage;
    if(positive&&negative)throw new C.UnknownError('MoveContainer confirmation is contradictory — verify before retry');
    if(negative)throw new C.RejectedError(C.clean(data.message||data.errorMessage||'MoveContainer rejected'));
    if((container&&data?.containerScannableId!=null&&C.upper(data.containerScannableId)!==C.upper(container))||
      (destination&&data?.destinationScannableId!=null&&C.upper(data.destinationScannableId)!==C.upper(destination)))
      throw new C.UnknownError('MoveContainer response identifies another container/destination');
    // V2's native API permits an empty synchronous response. An accepted/pending response is not completion.
    const empty=!C.clean(result.raw)&&data==null;
    if(!positive&&!(empty&&[200,204].includes(status)))throw new C.UnknownError('MoveContainer response not recognized — verify before retry');
    return result;
  };
  async function moveContainer(container,dest,{telemetry,maySubmit=()=>true}={}){
    const code=C.clean(container),target=C.clean(dest);
    if(!C.container(code))throw new Error('Container must be tsX/csX');
    if(!target)throw new Error('Destination required');
    if(C.upper(code)===C.upper(target))throw new Error('Source and destination are the same');
    if(!maySubmit())throw Object.assign(new Error('Paused before Move submission'),{outcome:'cancelled'});
    const op=C.operation({kind:'move-container',ref:code,scope:'movecontainer',telemetry});op.submitted({destination:target});
    let result;
    try{
      result=await C.request(MOVE_ORIGIN+MOVE_PATH,{method:'POST',body:JSON.stringify(movePayload(code,target)),headers:{'Content-Type':'application/json'},timeout:15000,allowHttpError:true});
    }catch(error){op.unknown({reason:'transport'});throw new C.UnknownError('Move submitted; confirmation lost — verify before retry',{cause:error});}
    try{
      strictMoveConfirmation(result,{container:code,destination:target});
      op.confirmed({status:result.status,destination:target});
      return result;
    }catch(error){
      if(error instanceof C.RejectedError){op.rejected({status:result.status});throw error;}
      op.unknown({status:result.status,reason:C.clean(error.message)});throw error;
    }
  }

  const ownedMove=(...args)=>V3.state.exclusive('movecontainer',()=>{V3.state.assertClear('movecontainer');return moveContainer(...args);});
  return Object.freeze({MOVE_ORIGIN,HIERARCHY_ORIGIN,FLOORS,UPPER,P1,dropChoices,destination,movePayload,strictMoveConfirmation,moveContainer:ownedMove});
})();
