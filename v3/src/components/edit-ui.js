V3.editUi=(()=>{
  const states=selected=>['Sellable','Pending Research','Unsellable'].map(v=>'<option'+(v===selected?' selected':'')+'>'+v+'</option>').join('');
  const damage=selected=>['Amazon Damage','Defective','Distributor Damage','Expired'].map(v=>'<option'+(v===selected?' selected':'')+'>'+v+'</option>').join('');
  function mount(root,{workflows,control={stop:false},title='Edit Tools',initial='sku'}={}){
    let mode=initial,busy=false;const history=[];
    const shell=document.createElement('div');root.replaceChildren(shell);
    const render=()=>{
      shell.innerHTML='<section class="section"><b>'+V3.base.esc(title)+'</b><div class="row" style="margin-top:8px"><button class="btn'+(mode==='each'?' primary':'')+'" data-mode="each">EACH</button><button class="btn'+(mode==='sku'?' primary':'')+'" data-mode="sku">SKU</button><button class="btn'+(mode==='fcsku'?' primary':'')+'" data-mode="fcsku">FCSKU</button></div></section><div data-work></div>';
      for(const button of shell.querySelectorAll('[data-mode]'))button.onclick=()=>{if(!busy){mode=button.dataset.mode;render();}};
      const work=shell.querySelector('[data-work]');
      if(mode==='each')work.innerHTML='<section class="section"><label class="field">Location ASIN FNSKU rows<textarea data-rows></textarea></label><div class="grid"><label class="field">Target state<select data-target>'+states('Unsellable')+'</select></label><label class="field">Disposition<select data-damage>'+damage('Defective')+'</select></label></div>'+controls()+'</section>';
      if(mode==='sku')work.innerHTML='<section class="section"><div class="note" style="margin-bottom:6px">Recent SKU quantities</div><div data-history style="max-height:92px;overflow:auto;margin-bottom:8px"></div><label class="field">SKU<input data-sku autocomplete="off"></label><div class="grid"><label class="field">Current<select data-current>'+states('Sellable')+'</select></label><label class="field">Current disposition<select data-current-damage>'+damage('Defective')+'</select></label><label class="field">Desired<select data-desired>'+states('Unsellable')+'</select></label><label class="field">Desired disposition<select data-desired-damage>'+damage('Defective')+'</select></label></div>'+controls()+'</section>';
      if(mode==='fcsku')work.innerHTML='<section class="section"><label class="field">OLD FCSKU<input data-old></label><label class="field">NEW FCSKU<input data-new></label><label class="field">Locations / containers<textarea data-locations></textarea></label>'+controls()+'</section>';
      wire(work);paintHistory();
    };
    const controls=()=>'<div class="row"><button class="btn primary" data-run>RUN</button><button class="btn danger" data-stop>STOP AFTER CURRENT</button></div><div class="note" data-msg style="margin-top:8px"></div>';
    const paintHistory=()=>{const box=shell.querySelector('[data-history]');if(!box)return;box.innerHTML=history.length?history.map(h=>'<div class="note" style="padding:4px 0;border-bottom:1px solid #39475b"><b>'+V3.base.esc(h.sku)+'</b> · S '+(h.sellable??'—')+' · P '+(h.pending??'—')+' · U '+(h.unsellable??'—')+'</div>').join(''):'<div class="note">No reads yet.</div>';box.scrollTop=box.scrollHeight;};
    const addQty=value=>{history.push(value);if(history.length>25)history.shift();paintHistory();};
    const wire=work=>{
      const run=work.querySelector('[data-run]'),stopBtn=work.querySelector('[data-stop]'),msg=work.querySelector('[data-msg]'),status=(text,tone='')=>{msg.className='note '+tone;msg.textContent=text;};
      run.onclick=async()=>{
        if(busy)return;busy=true;control.stop=false;run.disabled=true;status('RUNNING','warn');
        try{
          if(mode==='each'){const rows=String(work.querySelector('[data-rows]').value||'').split(/\r?\n/).map(V3.base.clean).filter(Boolean).map(line=>{const [location='',asin='',fnsku='']=line.split(/\s+/);return{location,asin,fnsku:fnsku||asin};});await workflows.editEach({rows,desiredState:work.querySelector('[data-target]').value,desiredDamage:work.querySelector('[data-damage]').value});}
          if(mode==='sku')await workflows.editSku({sku:work.querySelector('[data-sku]').value,currentState:work.querySelector('[data-current]').value,currentDamage:work.querySelector('[data-current-damage]').value,desiredState:work.querySelector('[data-desired]').value,desiredDamage:work.querySelector('[data-desired-damage]').value});
          if(mode==='fcsku')await workflows.fcsku({oldCode:work.querySelector('[data-old]').value,newCode:work.querySelector('[data-new]').value,locations:V3.base.lines(work.querySelector('[data-locations]').value)});
          status('DONE','ok');
        }catch(error){status((error?.outcome==='unknown'?'OUTCOME UNKNOWN — VERIFY · ':'')+String(error?.message||error),error?.outcome==='unknown'?'bad':'warn');}
        finally{busy=false;run.disabled=false;}
      };
      stopBtn.onclick=()=>{control.stop=true;status('STOP REQUESTED','warn');};
    };
    render();
    return Object.freeze({stopped:()=>control.stop,onQuantity:addQty,dispose:()=>{control.stop=true;}});
  }
  return Object.freeze({mount});
})();