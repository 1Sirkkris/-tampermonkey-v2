V3.fcrPandash=(()=>{
  function create({life,client,pandash,current}={}){
    const panel=V3.ui.panel({id:'bwu2-v3-pandash-panel',title:'V3 · Pandash',width:500,life});
    let mounted=false;
    const open=()=>{mount();panel.open();};

    function mount(){
      if(mounted)return;mounted=true;
      const root=document.createElement('div');
      root.innerHTML='<section class="section"><label class="field">ASIN<input data-asin></label><button class="btn primary" data-run>CHECK</button><div class="note" data-result style="margin-top:9px"></div></section>';
      panel.set(root);
      const input=root.querySelector('[data-asin]'),result=root.querySelector('[data-result]');
      input.value=/^B[A-Z0-9]{9}$/i.test(current())?current():'';
      root.querySelector('[data-run]').onclick=async()=>{
        try{
          let asin=V3.base.upper(input.value);
          if(!asin){
            const product=await client.product(current());
            asin=V3.base.upper(product?.asin);input.value=asin;
          }
          if(!/^B[A-Z0-9]{9}$/.test(asin))throw new Error('Valid ASIN required');
          const check=await pandash.check(asin);
          result.className='note '+(check.allowed?'ok':'bad');
          result.textContent='L'+check.level+' · '+check.message;
        }catch(error){result.className='note bad';result.textContent=error.message;}
      };
    }

    return Object.freeze({open});
  }
  return Object.freeze({create});
})();