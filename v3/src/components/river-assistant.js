V3.riverAssistant=(()=>{
  const norm=value=>V3.base.lower(value).replace(/[^a-z0-9]+/g,' ').trim();

  function create({life,telemetry,store}={}){
    const panel=V3.ui.panel({id:'bwu2-v3-river-assistant',title:'V3 · RIVER Assistant',width:600,life});
    let watcher=null,severity=null;

    const visible=element=>{
      if(!element?.isConnected)return false;
      const rect=element.getBoundingClientRect(),style=getComputedStyle(element);
      return rect.width>0&&rect.height>0&&style.display!=='none'&&style.visibility!=='hidden';
    };
    const field=aliases=>{
      const wanted=aliases.map(norm);
      for(const element of document.querySelectorAll('input,textarea,select')){
        if(!visible(element))continue;
        const label=V3.base.clean(element.getAttribute('aria-label')||element.placeholder||element.name||element.id||element.closest('label')?.textContent||'');
        if(wanted.some(value=>norm(label).includes(value)))return element;
      }
      return null;
    };
    const setValue=async(element,value)=>{
      if(!element||!visible(element)||element.disabled||element.readOnly)return false;
      const next=String(value??'');let proto=element,setter=null;
      while((proto=Object.getPrototypeOf(proto))&&!setter)setter=Object.getOwnPropertyDescriptor(proto,'value')?.set||null;
      if(setter)setter.call(element,next);else element.value=next;
      element.dispatchEvent(new Event('input',{bubbles:true}));
      element.dispatchEvent(new Event('change',{bubbles:true}));
      await new Promise(resolve=>requestAnimationFrame(resolve));
      return V3.base.clean(element.value)===V3.base.clean(next);
    };
    const nextButton=()=>[...document.querySelectorAll('button,a,[role="button"],input[type="submit"],input[type="button"]')]
      .filter(visible).find(element=>norm(element.innerText||element.textContent||element.value||'')==='next');
    const label=()=>V3.base.clean(document.querySelector('page-info[label]')?.getAttribute('label')||[...document.querySelectorAll('h1,h2,h3,h4,[role="heading"],legend')].find(visible)?.textContent||'');
    const page=()=>{
      const text=norm(label()),route=(location.pathname+' '+location.search+' '+location.hash).toLowerCase();
      if(text.includes('information')||field(['physical location of the units','inventory cost per unit']))return'information';
      if(text.includes('severity')||field(['units impacted']))return'severity';
      if(text==='asin'||text.includes('enter asin')||field(['type asin here']))return'asin';
      if(text.includes('pandash')||/pandash|dangerous/.test(route))return'pandash';
      if(text.includes('sortab')||/sortab/.test(route))return'sortability';
      if(text.includes('related')||/related.?tt/.test(route))return'related';
      if(text.includes('image'))return'images';
      if(text.includes('create issue'))return'create';
      if(text.includes('issue')&&text.includes('fc'))return'issue';
      return'unknown';
    };
    const choose=payload=>{
      const po=Number(payload?.poLineQuantity),live=Number(payload?.liveInventoryQuantity);
      const poOk=Number.isFinite(po)&&po>0,liveOk=Number.isFinite(live)&&live>0;
      if(poOk&&liveOk&&po!==live)return{value:null,reason:'PO qty '+po+' ≠ live inventory '+live,po,live};
      if(poOk&&liveOk)return{value:po,reason:'PO/live agree'};
      if(liveOk)return{value:live,reason:'live inventory only'};
      if(poOk)return{value:po,reason:'PO only'};
      return{value:null,reason:'No positive quantity',po:poOk?po:null,live:liveOk?live:null};
    };

    const arm=previous=>{
      watcher?.disconnect();let timer=0;
      watcher=life.observe(document.body,()=>{
        clearTimeout(timer);
        timer=setTimeout(()=>{
          const current=page();
          if(current&&current!=='unknown'&&current!==previous){
            watcher?.disconnect();watcher=null;void run();
          }
        },150);
      },{childList:true,subtree:true,attributes:true,attributeFilter:['label','disabled','aria-label','data-step']});
    };

    async function render(message=''){
      const payload=await store.get('payload',null),root=document.createElement('div');
      let chooser='';
      if(severity){
        chooser='<section class="section"><b>Units impacted</b><div class="note warn" style="margin-top:5px">'+V3.base.esc(severity.reason)+'</div><div class="grid" style="margin-top:8px">'+
          (severity.po!=null?'<button class="btn" data-po><b style="font-size:20px">'+severity.po+'</b><br>PO LINE</button>':'')+
          (severity.live!=null?'<button class="btn" data-live><b style="font-size:20px">'+severity.live+'</b><br>LIVE INVENTORY</button>':'')+
          '</div><div class="row" style="margin-top:8px"><input class="input" type="number" min="0" data-manual placeholder="Manual qty"><button class="btn" data-apply>APPLY MANUAL</button></div>'+
          (severity.selected!=null?'<div class="note ok" style="margin-top:8px"><b>FILLED: '+severity.selected+' · '+V3.base.esc(severity.source)+'</b><br>Review RIVER, then click Next.</div>':'')+
          '</section>';
      }
      root.innerHTML='<section class="section"><b>RIVER Assistant</b><div class="note" style="margin-top:5px">Item: '+V3.base.esc(payload?.fnsku||payload?.asin||'NO CAPTURE')+'</div><div class="note" style="margin-top:5px">'+V3.base.esc(message||('Current: '+(label()||page())))+'</div><div class="row" style="margin-top:8px"><button class="btn primary" data-run>RUN</button><button class="btn danger" data-clear>CLEAR</button></div></section>'+chooser;
      panel.set(root);

      root.querySelector('[data-run]').onclick=run;
      root.querySelector('[data-clear]').onclick=async()=>{severity=null;watcher?.disconnect();watcher=null;await store.set('payload',null);render('CLEARED');};

      const apply=async(value,source)=>{
        const qty=Number(value),units=field(['units impacted','number of units impacted']),shipments=field(['shipments impacted','number of shipments impacted']);
        if(!Number.isInteger(qty)||qty<0)return render('Enter whole quantity 0+');
        if(!await setValue(units,qty)||!await setValue(shipments,0))return render('RIVER did not retain quantity');
        severity={...severity,selected:qty,source};
        telemetry?.emit('severity.choice',{value:qty,source});
        await render('Units impacted = '+qty+' ('+source+'). Review RIVER, then click Next.');
        arm('severity');
      };

      root.querySelector('[data-po]')?.addEventListener('click',()=>apply(severity.po,'PO'));
      root.querySelector('[data-live]')?.addEventListener('click',()=>apply(severity.live,'LIVE'));
      root.querySelector('[data-apply]')?.addEventListener('click',()=>apply(root.querySelector('[data-manual]').value,'MANUAL'));
      root.querySelector('[data-manual]')?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void apply(event.currentTarget.value,'MANUAL');}});
    }

    async function run(){
      const payload=await store.get('payload',null);if(!payload)return render('No FCR capture');
      const current=page();telemetry?.emit('step',{page:current,label:label()});

      if(['pandash','sortability','related','images','issue','create','unknown'].includes(current)){
        return render(current.toUpperCase()+' stays manual — complete it then RUN/Next');
      }
      if(current==='asin'){
        const input=field(['type asin here','asin']);
        if(!await setValue(input,payload.asin))return render('ASIN field not ready');
        nextButton()?.click();arm('asin');return;
      }
      if(current==='information'){
        const pairs=[
          [['x0 asin','fnsku','asin/fnsku'],payload.fnsku],
          [['purchase order','po'],payload.purchaseOrder],
          [['vendor code / seller id','vendor code','seller id'],payload.vendorCode],
          [['inventory cost per unit','inventory cost'],payload.inventoryCost],
          [['physical location of the units','physical location'],payload.physicalLocation],
          [['asin title','product title','title'],payload.title]
        ];
        for(const [aliases,value] of pairs){
          const input=field(aliases);
          if(!input||!await setValue(input,value||'N/A'))return render('Information field not ready: '+aliases[0]);
        }
        const next=nextButton();
        if(!next)return render('Information filled — review and click Next');
        next.click();arm('information');return;
      }
      if(current==='severity'){
        const choice=choose(payload),shipments=field(['shipments impacted','number of shipments impacted']);
        if(!choice.value){
          if(shipments)await setValue(shipments,0);
          severity={...choice,selected:null,source:''};
          return render('Choose Units impacted');
        }
        severity=null;
        const units=field(['units impacted','number of units impacted']);
        if(!await setValue(units,choice.value)||!await setValue(shipments,0))return render('Severity fields not ready');
        const next=nextButton();
        if(next){next.click();arm('severity');}
        else render('Severity filled — review and click Next');
      }
    }

    const open=()=>{void render().then(()=>panel.open());};
    return Object.freeze({open,run});
  }

  return Object.freeze({create});
})();