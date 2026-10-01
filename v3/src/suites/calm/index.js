V3.boot = () => {
  const VERSION=V3.build.version;
  const life=V3.lifecycle.create('calm');
  const telemetry=V3.telemetry.create('calm',VERSION);
  const shell=V3.ui.createShell({
    id:'bwu2-v3-calm',title:'BWU2 V3 Calm Code',subtitle:'Labor roles',version:VERSION,life,tabs:[]
  });
  V3.screenshot.install({life,roots:[shell.host]});
  const GROUPS=[
    ['ISS',[['IBPS','IBPS'],['RECON','RECON'],['PSBL','PSBL'],['ICVR','ICVR'],['LPSWEEP','LPSWEEP']]],
    ['Damages',[['ICQADMP','ICQADMP'],['DAMAGES','DAMAGES']]],
    ['Etc',[['HRACCOM','HRACCOM'],['IB Lead/PA','LRSR'],['Non-sort','FCPRJ'],['MSTOP','MSTOP']]]
  ];
  function submit(code){
    const input=document.getElementById('calmCode')||document.querySelector('input[name="calmCode"]');
    const form=input?.form||document.forms?.[0];
    if(!input||!form){shell.setStatus('NATIVE FORM NOT READY','bad');telemetry.emit('submit',{code,ok:false,reason:'form-missing'});return;}
    input.value=code;
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
    telemetry.emit('submit',{code,ok:true});
    form.requestSubmit?form.requestSubmit():form.submit();
  }
  const root=document.createElement('div');
  root.innerHTML=GROUPS.map(([title,roles])=>'<section class="v3-section"><h3>'+title+'</h3><div class="v3-row" style="flex-wrap:wrap">'+
    roles.map(([name,code])=>'<button class="v3-btn" data-code="'+code+'">'+V3.base.esc(name)+'</button>').join('')+'</div></section>').join('');
  shell.setContent(root);
  for(const button of shell.body.querySelectorAll('[data-code]'))button.onclick=()=>submit(button.dataset.code);
};