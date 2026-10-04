V3.moveUi=(()=>{
  function mount(root,{workflows,life,title='MoveItems'}={}){
    let busy=false,stop=false,message='';
    root.innerHTML='<section class="section"><b>'+V3.base.esc(title)+'</b><div class="note" style="margin:5px 0 10px">ALL · EACH=1 · custom QTY</div><label class="field">Mode<select data-mode><option>ALL</option><option>EACH</option><option>QTY</option></select></label><label class="field">QTY<input data-qty type="number" min="1" value="1"></label><label class="field">Source<input data-source autocomplete="off"></label><label class="field">Destination<input data-dest autocomplete="off"></label><label class="field">Items<textarea data-items></textarea></label><div class="row"><button class="btn primary" data-run>RUN</button><button class="btn danger" data-stop>STOP AFTER CURRENT</button></div><div class="note" data-msg style="margin-top:8px"></div></section>';
    const q=s=>root.querySelector(s),msg=q('[data-msg]');
    const status=(text,tone='')=>{message=text;msg.className='note '+tone;msg.textContent=text;};
    q('[data-run]').onclick=async()=>{
      if(busy)return;busy=true;stop=false;q('[data-run]').disabled=true;status('RUNNING','warn');
      try{const result=await workflows.move({source:q('[data-source]').value,destination:q('[data-dest]').value,items:V3.base.lines(q('[data-items]').value,{dedupe:false}),qtyMode:q('[data-mode]').value,quantity:Number(q('[data-qty]').value)});status('DONE · '+result.length+' item'+(result.length===1?'':'s'),'ok');}
      catch(error){status((error?.outcome==='unknown'?'OUTCOME UNKNOWN — VERIFY · ':'')+String(error?.message||error),error?.outcome==='unknown'?'bad':'warn');}
      finally{busy=false;q('[data-run]').disabled=false;}
    };
    q('[data-stop]').onclick=()=>{stop=true;status('STOP REQUESTED','warn');};
    return Object.freeze({stopped:()=>stop,dispose:()=>{stop=true;}});
  }
  return Object.freeze({mount});
})();