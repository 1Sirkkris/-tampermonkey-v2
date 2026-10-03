V3.fcrRiver = (() => {
  const KEY='bwu2.v3.river.payload.v1';
  const WORKFLOW_Q0='3654ec14-7232-4f65-84c3-87927cdb4d0c';
  const WORKFLOW_ID='0dbb253e-c43a-4a8b-a316-e32b8ab9be21';

  const norm=value=>V3.base.lower(value).replace(/[^a-z0-9]+/g,' ').trim();
  const code=value=>V3.base.upper(value).replace(/[^A-Z0-9]/g,'');
  const visible=element=>{
    if(!element?.isConnected)return false;
    const rect=element.getBoundingClientRect(),style=getComputedStyle(element);
    return rect.width>0&&rect.height>0&&style.display!=='none'&&style.visibility!=='hidden';
  };
  const tableHeaders=table=>{
    const wrapper=table?.closest('.dataTables_wrapper,.dataTables_scroll')||table?.parentElement;
    const headerTable=wrapper?.querySelector('.dataTables_scrollHead table')||table;
    return [...headerTable?.querySelectorAll('thead th,thead td')||[]].map(node=>norm(node.textContent));
  };
  const columnIndex=(headers,...names)=>headers.findIndex(header=>names.some(name=>header===norm(name)||header.startsWith(norm(name)+' ')));
  const numericCell=value=>{
    const text=V3.base.clean(value).replace(/,/g,'');
    if(!/^-?\d+(?:\.\d+)?$/.test(text))return null;
    const number=Number(text);return Number.isFinite(number)&&number>=0?number:null;
  };
  const parseDate=value=>{
    const text=V3.base.clean(value);if(!text)return Number.NEGATIVE_INFINITY;
    const iso=text.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if(iso){const[,y,m,d,h='0',mm='0',s='0']=iso;return Date.UTC(+y,+m-1,+d,+h,+mm,+s);}
    const dmy=text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if(dmy){const[,d,m,y,h='0',mm='0',s='0']=dmy;return Date.UTC(+y,+m-1,+d,+h,+mm,+s);}
    const parsed=Date.parse(text);return Number.isFinite(parsed)?parsed:Number.NEGATIVE_INFINITY;
  };
  const shortVendor=value=>{
    const tokens=(V3.base.clean(value).match(/[A-Z0-9]+/gi)||[]).map(x=>x.toUpperCase());
    return tokens.find(x=>x.length>=2&&x.length<=5&&x!=='FBA')||tokens.find(x=>x.length===6&&x!=='FBA')||'';
  };
  const purchaseOrderDetails=doc=>{
    const table=doc.querySelector('#table-purchase-order');if(!table)return new Map();
    const headers=tableHeaders(table),poIndex=columnIndex(headers,'purchase order','po'),dateIndex=columnIndex(headers,'placed','confirmed','order date','date');
    const details=new Map();if(poIndex<0)return details;
    [...table.querySelectorAll('tbody tr')].forEach((row,rowIndex)=>{
      const cells=[...row.children].filter(cell=>cell.matches?.('td,th'));
      const purchaseOrder=V3.base.clean(cells[poIndex]?.textContent);if(!purchaseOrder||/no matching records/i.test(purchaseOrder))return;
      const placed=dateIndex>=0?V3.base.clean(cells[dateIndex]?.textContent):'',timestamp=parseDate(placed),key=code(purchaseOrder),previous=details.get(key);
      if(!previous||timestamp>previous.timestamp)details.set(key,{purchaseOrder,placed,timestamp,rowIndex});
    });
    return details;
  };
  const purchaseOrderRows=doc=>{
    const table=doc.querySelector('#table-purchase-order-item');if(!table)return[];
    const headers=tableHeaders(table),idx={
      po:columnIndex(headers,'purchase order','po'),sku:columnIndex(headers,'sku','fnsku','asin'),
      vendor:columnIndex(headers,'vendor code','seller id'),unfilled:columnIndex(headers,'unfilled'),
      cancelled:columnIndex(headers,'canceled','cancelled'),received:columnIndex(headers,'received'),
      title:columnIndex(headers,'title'),date:columnIndex(headers,'order date','placed','date')
    };
    if(idx.po<0||idx.sku<0)return[];
    return [...table.querySelectorAll('tbody tr')].map((row,rowIndex)=>{
      const cells=[...row.children].filter(cell=>cell.matches?.('td,th')),po=V3.base.clean(cells[idx.po]?.textContent);
      if(!po||/no matching records/i.test(po))return null;
      return{
        purchaseOrder:po,sku:V3.base.clean(cells[idx.sku]?.textContent),
        vendorRaw:idx.vendor>=0?V3.base.clean(cells[idx.vendor]?.textContent):'',
        unfilled:idx.unfilled>=0?numericCell(cells[idx.unfilled]?.textContent):null,
        cancelled:idx.cancelled>=0?numericCell(cells[idx.cancelled]?.textContent):null,
        received:idx.received>=0?numericCell(cells[idx.received]?.textContent):null,
        title:idx.title>=0?V3.base.clean(cells[idx.title]?.textContent):'',
        timestamp:idx.date>=0?parseDate(cells[idx.date]?.textContent):Number.NEGATIVE_INFINITY,
        rowIndex,rowText:V3.base.clean(row.textContent)
      };
    }).filter(Boolean);
  };
  const selectPo=(itemDoc,detailDoc,identity)=>{
    const rows=purchaseOrderRows(itemDoc),details=purchaseOrderDetails(detailDoc),wanted=[identity.search,identity.asin,identity.fnsku].map(code).filter(Boolean),candidates=[];
    for(const row of rows){
      const sku=code(row.sku),rowText=code(row.rowText);let strength=0,by='';
      if(sku&&wanted.includes(sku)){strength=3;by=sku===code(identity.fnsku)?'fnsku':sku===code(identity.asin)?'asin':'search';}
      else{
        const embedded=wanted.find(value=>value.length>=8&&rowText.includes(value));
        if(embedded){strength=2;by=embedded===code(identity.fnsku)?'fnsku-row':embedded===code(identity.asin)?'asin-row':'search-row';}
        else if(identity.title&&row.title&&norm(identity.title)===norm(row.title)){strength=1;by='title-exact';}
      }
      if(!strength)continue;
      const detail=details.get(code(row.purchaseOrder)),detailTime=detail?.timestamp??Number.NEGATIVE_INFINITY;
      const timestamp=Math.max(row.timestamp,detailTime);
      candidates.push({...row,strength,by,timestamp});
    }
    if(!candidates.length)return{state:'unavailable',reason:'no-matching-po-line'};
    const dated=candidates.filter(x=>Number.isFinite(x.timestamp)&&x.timestamp!==Number.NEGATIVE_INFINITY);
    if(!dated.length&&candidates.length>1)return{state:'ambiguous',reason:'multiple-matching-po-lines-without-dates',candidates:candidates.length};
    const pool=dated.length?dated:candidates;pool.sort((a,b)=>b.timestamp-a.timestamp||b.strength-a.strength||a.rowIndex-b.rowIndex);
    const selected=pool[0],parts=[selected.unfilled,selected.cancelled,selected.received],known=parts.every(Number.isFinite),quantity=known?parts.reduce((a,b)=>a+b,0):null;
    return{
      state:'available',purchaseOrder:selected.purchaseOrder,vendorCode:shortVendor(selected.vendorRaw)||'N/A',
      quantity:Number.isFinite(quantity)&&quantity>0?quantity:null,
      quantityMode:Number.isFinite(quantity)&&quantity>0?'po-line-total':known?'zero-po-total':'missing-po-components',
      matchBy:selected.by,candidateCount:candidates.length
    };
  };
  const riverUrl=warehouse=>{
    const url=new URL('https://river.amazon.com/'+encodeURIComponent(warehouse)+'/workflows');
    url.searchParams.set('buildingType','fc');url.searchParams.set('q0',WORKFLOW_Q0);url.searchParams.set('q1',WORKFLOW_ID);url.searchParams.set('id',WORKFLOW_ID);
    return url.href;
  };

  function createCapture(options){
    const shell=options.shell,client=options.client,telemetry=options.telemetry;
    let busy=false,last=typeof GM_getValue==='function'?GM_getValue(KEY,null):null;

    async function capture(){
      if(busy)return;busy=true;shell.setStatus('CAPTURING','work');render();
      try{
        const search=V3.base.clean(new URLSearchParams(location.search).get('s')||shell.body.querySelector('[data-river-code]')?.value);
        if(!search)throw new Error('Search an item in FCResearch first');
        const [product,inventory,itemHtml,poHtml]=await Promise.all([
          client.product(search),
          client.inventory(search,{allowPartial:false}),
          client.post('purchase-order-item',{s:search}),
          client.post('purchase-order',{s:search})
        ]);
        if(!product)throw new Error('Product details unavailable');
        const itemDoc=V3.base.parseHtml(itemHtml),poDoc=V3.base.parseHtml(poHtml);
        const po=selectPo(itemDoc,poDoc,{search,asin:product.asin,fnsku:product.fnsku,title:product.title});
        const warehouse=V3.fcr.warehouse()||'BWU2';
        last={
          asin:product.asin||'N/A',fnsku:product.fnsku||'N/A',title:product.title||'N/A',
          purchaseOrder:po.state==='available'?po.purchaseOrder:'N/A',
          vendorCode:po.state==='available'?po.vendorCode:'N/A',
          poLineQuantity:po.state==='available'?po.quantity:null,
          poQuantityMode:po.state==='available'?po.quantityMode:po.reason,
          liveInventoryQuantity:inventory.totalQuantity,
          inventoryCost:product.inventoryCost||'N/A',physicalLocation:'TBD',shipmentsImpacted:0,
          sourceSearch:search,sourceUrl:location.href,warehouseId:warehouse,riverUrl:riverUrl(warehouse),
          capturedAt:Date.now(),build:V3.build.id
        };
        last.quantityDisagreement=Number.isFinite(last.poLineQuantity)&&Number.isFinite(last.liveInventoryQuantity)&&last.poLineQuantity!==last.liveInventoryQuantity;
        if(typeof GM_setValue==='function')GM_setValue(KEY,last);
        telemetry.emit('river.capture',{
          search:V3.telemetry.mask(search),poQuantity:last.poLineQuantity,liveQuantity:last.liveInventoryQuantity,
          disagreement:last.quantityDisagreement,poMode:last.poQuantityMode
        });
        shell.setStatus(last.quantityDisagreement?'QTY DISAGREES':'READY',last.quantityDisagreement?'warn':'');
      }catch(error){
        shell.setStatus('CAPTURE ERROR','bad');telemetry.emit('river.capture.error',{message:String(error?.message||error)});last={error:String(error?.message||error)};
      }finally{busy=false;render();}
    }
    function openRiver(){
      if(!last?.riverUrl)return;
      if(typeof GM_openInTab==='function')GM_openInTab(last.riverUrl,{active:true,insert:true,setParent:true});
      else window.open(last.riverUrl,'_blank','noopener');
    }
    function render(){
      const root=document.createElement('div'),po=last?.poLineQuantity,live=last?.liveInventoryQuantity;
      root.innerHTML='<section class="v3-section"><h3>RIVER Capture</h3>'+
        '<label class="v3-field">Current item<input data-river-code value="'+V3.base.esc(last?.sourceSearch||new URLSearchParams(location.search).get('s')||'')+'"></label>'+
        '<div class="v3-row"><button class="v3-btn primary" data-capture>'+(busy?'CAPTURING…':'CAPTURE')+'</button><button class="v3-btn" data-open '+(!last?.riverUrl?'disabled':'')+'>OPEN RIVER</button></div>'+
        (last?.error?'<div class="v3-note" style="color:var(--v3-bad);margin-top:8px">'+V3.base.esc(last.error)+'</div>':'')+
        (last&&!last.error?'<div class="v3-grid" style="margin-top:9px">'+
          '<div class="v3-note"><b>FNSKU</b><br>'+V3.base.esc(last.fnsku)+'</div>'+
          '<div class="v3-note"><b>PO</b><br>'+V3.base.esc(last.purchaseOrder)+'</div>'+
          '<div class="v3-note"><b>PO qty</b><br>'+(po??'N/A')+'</div>'+
          '<div class="v3-note"><b>Live inventory</b><br>'+(live??'N/A')+'</div></div>'+
          (last.quantityDisagreement?'<div class="v3-note" style="color:var(--v3-warn);margin-top:8px"><b>QUANTITY DISAGREEMENT — RIVER will pause on Severity.</b></div>':''):'')+
        '</section>';
      shell.setContent(root);
      root.querySelector('[data-capture]').onclick=capture;
      root.querySelector('[data-open]').onclick=openRiver;
    }
    return Object.freeze({render,capture});
  }

  function bootRiverHost(options){
    const life=options.life,telemetry=options.telemetry;
    const shell=V3.ui.createShell({id:'bwu2-v3-river',title:'BWU2 V3 RIVER',subtitle:'Manual-assisted',version:V3.build.version,life,tabs:[]});
    V3.screenshot.install({life,roots:[shell.host]});
    let generation=0,busy=false,watcher=null,lastPage='',severityChoice=null;
    const payload=()=>typeof GM_getValue==='function'?GM_getValue(KEY,null):null;
    const associatedLabel=element=>{
      if(!(element instanceof Element))return'';
      const explicit=V3.base.clean(element.getAttribute('aria-label')||element.getAttribute('title')||'');if(explicit)return explicit;
      if(element.id){try{const label=document.querySelector('label[for="'+CSS.escape(element.id)+'"]');if(label)return V3.base.clean(label.textContent);}catch{}}
      return V3.base.clean(element.closest('label')?.textContent||element.closest('fieldset')?.querySelector('legend')?.textContent||'');
    };
    const field=aliases=>{
      const wanted=aliases.map(norm);
      for(const element of document.querySelectorAll('input,textarea,select')){
        if(!visible(element))continue;
        const context=norm([element.name,element.id,element.placeholder,element.getAttribute('aria-label'),associatedLabel(element)].filter(Boolean).join(' '));
        if(wanted.some(value=>context.includes(value)))return element;
      }
      return null;
    };
    const setter=element=>{
      let proto=element;while((proto=Object.getPrototypeOf(proto))){const d=Object.getOwnPropertyDescriptor(proto,'value');if(d?.set)return d.set;}return null;
    };
    const setValue=async(element,value)=>{
      if(!element||!visible(element)||element.matches?.(':disabled')||element.readOnly)return false;
      const next=String(value??'');element.focus({preventScroll:true});await new Promise(r=>requestAnimationFrame(r));
      const set=setter(element);if(set)set.call(element,next);else element.value=next;
      const inputEvent=typeof InputEvent==='function'?new InputEvent('input',{bubbles:true,composed:true,data:next,inputType:'insertText'}):new Event('input',{bubbles:true,composed:true});
      element.dispatchEvent(inputEvent);element.dispatchEvent(new Event('change',{bubbles:true,composed:true}));element.blur();
      await new Promise(r=>requestAnimationFrame(r));return V3.base.clean(element.value)===V3.base.clean(next);
    };
    const nextButton=()=>[...document.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"]')]
      .filter(visible).find(candidate=>norm(candidate.innerText||candidate.textContent||candidate.value||candidate.getAttribute('aria-label')||'')==='next')||null;
    const label=()=>V3.base.clean(document.querySelector('page-info[label]')?.getAttribute('label')||[...document.querySelectorAll('h1,h2,h3,h4,[role="heading"],legend')].find(visible)?.textContent||'');
    const pageKind=()=>{
      const text=norm(label()),route=(location.pathname+' '+location.search+' '+location.hash).toLowerCase();
      if(text.includes('pandash')||/pandash|dangerous|dg review/.test(route))return'pandash';
      if(text.includes('related')&&(text.includes('tt')||text.includes('ticket'))||/related.?tt/.test(route))return'related';
      if(text.includes('information')||field(['physical location of the units','inventory cost per unit','vendor code / seller id']))return'information';
      if(text.includes('sortab')||/sortab/.test(route))return'sortability';
      if(text.includes('severity')||field(['units impacted','shipments impacted']))return'severity';
      if(text.includes('image')||/image/.test(route))return'images';
      if(text.includes('create issue')||/create.?issue/.test(route))return'create';
      if(text==='asin'||text.includes('asin check')||text.includes('enter asin')||field(['type asin here']))return'asin';
      if(text.includes('issue')&&text.includes('fc')||/issue.?at.?fc/.test(route))return'issue';
      return'unknown';
    };
    const waitFields=async(aliasesList,timeout=8000)=>{
      const started=Date.now();
      while(Date.now()-started<timeout){
        const fields=aliasesList.map(aliases=>field(aliases));
        if(fields.every(el=>el&&visible(el)&&!el.matches?.(':disabled')&&!el.readOnly))return fields;
        await life.sleep(100);
      }
      throw new Error('RIVER fields did not become ready');
    };
    const chooseUnits=p=>{
      const po=Number(p?.poLineQuantity),live=Number(p?.liveInventoryQuantity),poOk=Number.isFinite(po)&&po>0,liveOk=Number.isFinite(live)&&live>0;
      if(poOk&&liveOk&&po!==live)return{value:null,reason:'PO qty '+po+' ≠ live inventory '+live};
      if(poOk&&liveOk)return{value:po,reason:'PO and live agree'};
      if(liveOk)return{value:live,reason:'live inventory only'};
      if(poOk)return{value:po,reason:'PO quantity only'};
      return{value:null,reason:'No positive quantity available'};
    };
    const manual=message=>{shell.setStatus('MANUAL','warn');render(message);return{wait:false};};

    async function applySeverityChoice(value,source){
      const qty=Number(value);
      if(!Number.isInteger(qty)||qty<0){
        severityChoice={...(severityChoice||{}),error:'Enter a whole number 0 or greater'};
        render('SEVERITY quantity needs review');
        return false;
      }
      const units=field(['units impacted','number of units impacted']);
      const shipments=field(['shipments impacted','number of shipments impacted']);
      if(!units||!shipments){
        severityChoice={...(severityChoice||{}),error:'RIVER Severity fields are not ready'};
        render('SEVERITY quantity needs review');
        return false;
      }
      const unitsOk=await setValue(units,qty);
      const shipmentsOk=await setValue(shipments,0);
      if(!unitsOk||!shipmentsOk){
        severityChoice={...(severityChoice||{}),error:'RIVER did not retain the selected quantity'};
        render('SEVERITY quantity needs review');
        return false;
      }
      severityChoice={...(severityChoice||{}),selected:qty,source,error:''};
      shell.setStatus('FILLED · REVIEW + NEXT','');
      telemetry.emit('river.severity.choice',{value:qty,source});
      render('Units impacted = '+qty+' ('+source+'). Review it, then click RIVER Next.');
      return true;
    }
    async function drive(reason='RUN',gen=generation){
      if(gen!==generation)return;
      const p=payload();if(!p)return manual('No V3 FCResearch capture. Capture the item first.');
      const page=pageKind();lastPage=page;telemetry.emit('river.step',{page,label:label(),reason});
      shell.setStatus(page.toUpperCase(),'work');render(reason+' · '+(label()||page));
      if(page==='unknown')return manual('Workflow step not recognised yet. Wait for the page, then RUN again.');
      if(['pandash','issue','sortability','images'].includes(page)){
        return manual(page.toUpperCase()+' choice stays manual in preliminary V3. Select the correct option, click Next, and V3 will resume.');
      }
      if(page==='related')return manual('Related TT review stays manual. Complete the step and click Next.');
      if(page==='create')return manual('DONE · final Create Issue submission remains manual.');
      if(page==='asin'){
        const asin=p.asin&&p.asin!=='N/A'?p.asin:'';
        if(!asin)return manual('Captured ASIN unavailable — enter manually.');
        const el=field(['type asin here','asin']);if(!el||!await setValue(el,asin))throw new Error('ASIN field did not retain');
        nextButton()?.click();return{wait:true};
      }
      if(page==='information'){
        const values=[
          [['x0 asin','x00 asin / fnsku','x00 asin','fnsku','asin/fnsku'],p.fnsku||'N/A'],
          [['purchase order','po'],p.purchaseOrder||'N/A'],
          [['vendor code / seller id','vendor code','seller id'],p.vendorCode||'N/A'],
          [['inventory cost per unit','inventory cost','cost per unit'],p.inventoryCost||'N/A'],
          [['physical location of the units','physical location','location'],p.physicalLocation||'TBD'],
          [['asin title','product title','title'],p.title||'N/A']
        ];
        const fields=await waitFields(values.map(x=>x[0]));
        for(let i=0;i<values.length;i++){
          if(gen!==generation)return;
          if(!await setValue(fields[i],values[i][1]))throw new Error('Information field did not retain: '+values[i][0][0]);
        }
        const next=nextButton();
        if(!next||next.matches?.(':disabled')||next.getAttribute('aria-disabled')==='true')return manual('Information values entered, but Next is not enabled. Review fields manually.');
        next.click();return{wait:true};
      }
      if(page==='severity'){
        const selected=chooseUnits(p);
        const shipments=field(['shipments impacted','number of shipments impacted']);
        if(!selected.value){
          if(shipments)await setValue(shipments,0);
          severityChoice={
            po:Number.isFinite(Number(p?.poLineQuantity))?Number(p.poLineQuantity):null,
            live:Number.isFinite(Number(p?.liveInventoryQuantity))?Number(p.liveInventoryQuantity):null,
            reason:selected.reason,
            selected:null,
            source:'',
            error:''
          };
          return manual('SEVERITY quantity needs review · '+selected.reason);
        }
        severityChoice=null;
        const units=field(['units impacted','number of units impacted']);
        if(!await setValue(units,selected.value)||!await setValue(shipments,0))throw new Error('Severity fields did not retain');
        const next=nextButton();if(!next)return manual('Severity filled ('+selected.reason+'), but Next not found.');
        next.click();return{wait:true};
      }
      return manual('Unhandled RIVER step: '+page);
    }
    const clearWatch=()=>{watcher?.disconnect();watcher=null;};
    const armWatch=previous=>{
      clearWatch();const gen=generation,root=document.body||document.documentElement;
      if(!root)return;
      let timer=0;
      watcher=life.observe(root,()=>{
        clearTimeout(timer);timer=setTimeout(()=>{
          if(gen!==generation)return clearWatch();
          const current=pageKind();if(current==='unknown'||current===previous)return;
          clearWatch();void run('Step changed');
        },120);
      },{childList:true,subtree:true,attributes:true,attributeFilter:['label','id','name','role','aria-label','data-step','data-state','disabled']});
    };
    async function run(reason='RUN'){
      if(busy)return;busy=true;const gen=generation;
      try{
        const before=pageKind(),result=await drive(reason,gen);
        if(gen===generation&&result?.wait)armWatch(before);else clearWatch();
      }catch(error){
        clearWatch();shell.setStatus('WAITING','warn');render(String(error?.message||error));
        telemetry.emit('river.error',{page:pageKind(),message:String(error?.message||error)});
      }finally{busy=false;}
    }
    function render(message=''){
      const p=payload(),units=chooseUnits(p);
      const root=document.createElement('div');
      const severityHtml=severityChoice
        ? '<section class="v3-section"><h3>Units impacted</h3>'+
          '<div class="v3-note"><b>'+V3.base.esc(severityChoice.reason||'Choose quantity')+'</b></div>'+
          '<div class="v3-grid" style="margin-top:9px">'+
            (severityChoice.po!=null?'<button class="v3-btn'+(severityChoice.source==='PO'?' primary':'')+'" data-severity-po style="min-height:58px"><b style="font-size:20px">'+severityChoice.po+'</b><br><small>PO LINE</small></button>':'')+
            (severityChoice.live!=null?'<button class="v3-btn'+(severityChoice.source==='LIVE'?' primary':'')+'" data-severity-live style="min-height:58px"><b style="font-size:20px">'+severityChoice.live+'</b><br><small>LIVE INVENTORY</small></button>':'')+
          '</div>'+
          '<div class="v3-row" style="margin-top:9px"><input class="v3-input" data-severity-manual type="number" min="0" step="1" placeholder="Manual qty"><button class="v3-btn" data-severity-apply>APPLY MANUAL</button></div>'+
          (severityChoice.selected!=null?'<div class="v3-note" style="color:var(--v3-ok);margin-top:8px"><b>FILLED: '+severityChoice.selected+' · '+V3.base.esc(severityChoice.source)+'</b><br>Review RIVER, then click Next.</div>':'')+
          (severityChoice.error?'<div class="v3-note" style="color:var(--v3-bad);margin-top:8px"><b>'+V3.base.esc(severityChoice.error)+'</b></div>':'')+
        '</section>'
        : '';
      root.innerHTML='<section class="v3-section"><h3>RIVER Assistant</h3>'+
        '<div class="v3-note">Item: <b>'+V3.base.esc(p?.fnsku||p?.asin||'NO CAPTURE')+'</b></div>'+
        (p?'<div class="v3-grid" style="margin-top:8px"><div class="v3-note"><b>PO qty</b><br>'+(p.poLineQuantity??'N/A')+'</div><div class="v3-note"><b>Live qty</b><br>'+(p.liveInventoryQuantity??'N/A')+'</div></div>':'')+
        '<div class="v3-note" style="margin-top:8px">'+V3.base.esc(message||('Current: '+(label()||pageKind())))+'</div>'+
        (p&&p.quantityDisagreement?'<div class="v3-note" style="color:var(--v3-warn);margin-top:6px"><b>QUANTITY DISAGREEMENT — choose below.</b></div>':'')+
        '<div class="v3-row" style="margin-top:9px"><button class="v3-btn primary" data-run>RUN</button><button class="v3-btn danger" data-clear>CLEAR</button></div></section>'+
        severityHtml;
      shell.setContent(root);
      root.querySelector('[data-run]').onclick=()=>run('Manual RUN');
      root.querySelector('[data-clear]').onclick=()=>{generation++;severityChoice=null;clearWatch();if(typeof GM_setValue==='function')GM_setValue(KEY,null);shell.setStatus('CLEARED','');render('STOPPED / CLEARED');};
      root.querySelector('[data-severity-po]')?.addEventListener('click',()=>applySeverityChoice(severityChoice.po,'PO'));
      root.querySelector('[data-severity-live]')?.addEventListener('click',()=>applySeverityChoice(severityChoice.live,'LIVE'));
      root.querySelector('[data-severity-apply]')?.addEventListener('click',()=>applySeverityChoice(root.querySelector('[data-severity-manual]')?.value,'MANUAL'));
      root.querySelector('[data-severity-manual]')?.addEventListener('keydown',event=>{
        if(event.key!=='Enter')return;
        event.preventDefault();
        void applySeverityChoice(event.currentTarget.value,'MANUAL');
      });
    }
    render();
    return Object.freeze({run,render});
  }

  return Object.freeze({createCapture,bootRiverHost,selectPo,riverUrl});
})();