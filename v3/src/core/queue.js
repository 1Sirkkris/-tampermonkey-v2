V3.queue=(()=>{
  function create({name,life,telemetry,validate=V3.base.container}={}){
    const store=V3.storage.create('queue.'+name,1),owner=V3.base.id('tab'),lockKey='bwu2.v3.lock.'+name;
    let state={running:false,current:'',items:[],message:''},loaded=false;
    const load=async()=>{if(loaded)return state;const saved=await store.get('state',null);if(saved?.items&&Array.isArray(saved.items))state=saved;for(const item of state.items){if(item.status==='active'||item.id===state.current){item.status='attention';item.error='Previous session ended while active — verify before retry';}}state.running=false;state.current='';loaded=true;await save();return state;};
    const save=()=>store.set('state',state);
    const lock=()=>{try{return JSON.parse(localStorage.getItem(lockKey)||'null');}catch{return null;}};
    const acquire=()=>{const now=Date.now(),existing=lock();if(existing&&existing.owner!==owner&&Number(existing.expires)>now)return false;const token={owner,nonce:V3.base.id('lock'),expires:now+8000};localStorage.setItem(lockKey,JSON.stringify(token));const check=lock();return check?.owner===owner&&check?.nonce===token.nonce;};
    const renew=()=>{const current=lock();if(current?.owner===owner)localStorage.setItem(lockKey,JSON.stringify({...current,expires:Date.now()+8000}));};
    const release=()=>{const current=lock();if(current?.owner===owner)localStorage.removeItem(lockKey);};
    life.interval(()=>{if(state.running)renew();},2500);life.own(release);
    const add=async values=>{await load();const seen=new Set(state.items.map(x=>V3.base.upper(x.id)));for(const raw of values){const id=V3.base.clean(raw),key=V3.base.upper(id);if(!validate(id)||seen.has(key))continue;seen.add(key);state.items.push({id,status:'queued',error:''});}await save();return state.items;};
    const set=async patch=>{Object.assign(state,patch);await save();};
    const item=async(target,patch)=>{Object.assign(target,patch);await save();};
    const next=()=>state.items.find(x=>x.status==='queued')||null;
    const clearDone=async()=>{state.items=state.items.filter(x=>x.status!=='done');await save();};
    const clearAll=async()=>{if(state.running)throw new Error('Stop queue before clearing');state={running:false,current:'',items:[],message:''};await save();};
    return Object.freeze({owner,load,save,add,set,item,next,acquire,release,clearDone,clearAll,get state(){return state;}});
  }
  return Object.freeze({create});
})();