V3.riverCapture=(()=>{
  const WORKFLOW_Q0='3654ec14-7232-4f65-84c3-87927cdb4d0c';
  const WORKFLOW_ID='0dbb253e-c43a-4a8b-a316-e32b8ab9be21';
  const norm=value=>V3.base.lower(value).replace(/[^a-z0-9]+/g,' ').trim();
  const code=value=>V3.base.upper(value).replace(/[^A-Z0-9]/g,'');

  const headers=table=>{
    const wrapper=table?.closest('.dataTables_wrapper,.dataTables_scroll')||table?.parentElement;
    const head=wrapper?.querySelector('.dataTables_scrollHead table')||table;
    return[...head?.querySelectorAll('thead th,thead td')||[]].map(cell=>norm(cell.textContent));
  };
  const column=(list,...names)=>list.findIndex(header=>names.some(name=>header===norm(name)||header.startsWith(norm(name)+' ')));
  const number=value=>{
    const text=V3.base.clean(value).replace(/,/g,'');
    if(!/^-?\d+(?:\.\d+)?$/.test(text))return null;
    const n=Number(text);return Number.isFinite(n)&&n>=0?n:null;
  };
  const date=value=>{const parsed=Date.parse(V3.base.clean(value));return Number.isFinite(parsed)?parsed:Number.NEGATIVE_INFINITY;};
  const vendor=value=>{
    const tokens=(V3.base.clean(value).match(/[A-Z0-9]+/gi)||[]).map(x=>x.toUpperCase());
    return tokens.find(x=>x.length>=2&&x.length<=6&&x!=='FBA')||'';
  };

  const poDetails=doc=>{
    const table=doc.querySelector('#table-purchase-order'),map=new Map();
    if(!table)return map;
    const hs=headers(table),poIndex=column(hs,'purchase order','po'),dateIndex=column(hs,'placed','confirmed','order date','date');
    if(poIndex<0)return map;
    [...table.querySelectorAll('tbody tr')].forEach((row,rowIndex)=>{
      const cells=[...row.children].filter(cell=>cell.matches?.('td,th'));
      const purchaseOrder=V3.base.clean(cells[poIndex]?.textContent);if(!purchaseOrder)return;
      const timestamp=dateIndex>=0?date(cells[dateIndex]?.textContent):Number.NEGATIVE_INFINITY;
      const old=map.get(code(purchaseOrder));
      if(!old||timestamp>old.timestamp)map.set(code(purchaseOrder),{purchaseOrder,timestamp,rowIndex});
    });
    return map;
  };

  const poRows=doc=>{
    const table=doc.querySelector('#table-purchase-order-item');if(!table)return[];
    const hs=headers(table),idx={
      po:column(hs,'purchase order','po'),
      sku:column(hs,'sku','fnsku','asin'),
      vendor:column(hs,'vendor code','seller id'),
      unfilled:column(hs,'unfilled'),
      cancelled:column(hs,'canceled','cancelled'),
      received:column(hs,'received'),
      title:column(hs,'title'),
      date:column(hs,'order date','placed','date')
    };
    if(idx.po<0||idx.sku<0)return[];
    return[...table.querySelectorAll('tbody tr')].map((row,rowIndex)=>{
      const cells=[...row.children].filter(cell=>cell.matches?.('td,th'));
      const purchaseOrder=V3.base.clean(cells[idx.po]?.textContent);if(!purchaseOrder)return null;
      return{
        purchaseOrder,
        sku:V3.base.clean(cells[idx.sku]?.textContent),
        vendorRaw:idx.vendor>=0?V3.base.clean(cells[idx.vendor]?.textContent):'',
        unfilled:idx.unfilled>=0?number(cells[idx.unfilled]?.textContent):null,
        cancelled:idx.cancelled>=0?number(cells[idx.cancelled]?.textContent):null,
        received:idx.received>=0?number(cells[idx.received]?.textContent):null,
        title:idx.title>=0?V3.base.clean(cells[idx.title]?.textContent):'',
        timestamp:idx.date>=0?date(cells[idx.date]?.textContent):Number.NEGATIVE_INFINITY,
        rowIndex,
        rowText:V3.base.clean(row.textContent)
      };
    }).filter(Boolean);
  };

  const selectPo=(itemDoc,detailDoc,identity)=>{
    const rows=poRows(itemDoc),details=poDetails(detailDoc);
    const wanted=[identity.search,identity.asin,identity.fnsku].map(code).filter(Boolean),candidates=[];
    for(const row of rows){
      const sku=code(row.sku),rowText=code(row.rowText);let strength=0,matchBy='';
      if(sku&&wanted.includes(sku)){strength=3;matchBy=sku===code(identity.fnsku)?'fnsku':sku===code(identity.asin)?'asin':'search';}
      else{
        const embedded=wanted.find(value=>value.length>=8&&rowText.includes(value));
        if(embedded){strength=2;matchBy=embedded===code(identity.fnsku)?'fnsku-row':embedded===code(identity.asin)?'asin-row':'search-row';}
        else if(identity.title&&row.title&&norm(identity.title)===norm(row.title)){strength=1;matchBy='title-exact';}
      }
      if(!strength)continue;
      const timestamp=Math.max(row.timestamp,details.get(code(row.purchaseOrder))?.timestamp??Number.NEGATIVE_INFINITY);
      candidates.push({...row,strength,matchBy,timestamp});
    }
    if(!candidates.length)return null;
    candidates.sort((a,b)=>b.timestamp-a.timestamp||b.strength-a.strength||a.rowIndex-b.rowIndex);
    const selected=candidates[0],parts=[selected.unfilled,selected.cancelled,selected.received];
    const known=parts.every(Number.isFinite),quantity=known?parts.reduce((sum,value)=>sum+value,0):null;
    return{
      purchaseOrder:selected.purchaseOrder,
      vendorCode:vendor(selected.vendorRaw)||'N/A',
      quantity:Number.isFinite(quantity)&&quantity>0?quantity:null,
      matchBy:selected.matchBy,
      candidateCount:candidates.length
    };
  };

  const riverUrl=warehouse=>{
    const url=new URL('https://river.amazon.com/'+encodeURIComponent(warehouse)+'/workflows');
    url.searchParams.set('buildingType','fc');
    url.searchParams.set('q0',WORKFLOW_Q0);
    url.searchParams.set('q1',WORKFLOW_ID);
    url.searchParams.set('id',WORKFLOW_ID);
    return url.href;
  };

  function create({life,telemetry,store}={}){
    const fcr=V3.fcr.create({telemetry,life});
    const panel=V3.ui.panel({id:'bwu2-v3-river-capture',title:'V3 · RIVER Capture',width:520,life});
    let mounted=false,payload=null;

    const open=()=>{mount();panel.open();};

    function mount(){
      if(mounted)return;mounted=true;
      const root=document.createElement('div');
      root.innerHTML='<section class="section"><label class="field">Current item<input data-code></label><div class="row"><button class="btn primary" data-cap>CAPTURE</button><button class="btn" data-open>OPEN RIVER</button></div><div class="note" data-msg style="margin-top:8px"></div><div data-data style="margin-top:8px"></div></section>';
      panel.set(root);
      const input=root.querySelector('[data-code]'),message=root.querySelector('[data-msg]'),dataBox=root.querySelector('[data-data]');
      input.value=V3.base.clean(new URLSearchParams(location.search).get('s'));

      const paint=()=>{
        dataBox.innerHTML=payload?'<div class="grid"><div class="note"><b>FNSKU</b><br>'+V3.base.esc(payload.fnsku)+'</div><div class="note"><b>PO</b><br>'+V3.base.esc(payload.purchaseOrder)+'</div><div class="note"><b>PO qty</b><br>'+(payload.poLineQuantity??'N/A')+'</div><div class="note"><b>Live qty</b><br>'+(payload.liveInventoryQuantity??'N/A')+'</div></div>':'';
      };

      root.querySelector('[data-cap]').onclick=async()=>{
        try{
          message.className='note warn';message.textContent='CAPTURING…';
          const search=V3.base.clean(input.value);if(!search)throw new Error('Search item required');
          const [product,inventory,itemHtml,poHtml]=await Promise.all([
            fcr.product(search),
            fcr.inventory(search,{allowPartial:false}),
            fcr.post('purchase-order-item',{s:search}),
            fcr.post('purchase-order',{s:search})
          ]);
          if(!product)throw new Error('Product unavailable');
          const po=selectPo(V3.base.html(itemHtml),V3.base.html(poHtml),{search,asin:product.asin,fnsku:product.fnsku,title:product.title});
          const warehouse=V3.fcr.warehouse()||'BWU2';
          payload={
            asin:product.asin||'N/A',
            fnsku:product.fnsku||'N/A',
            title:product.title||'N/A',
            purchaseOrder:po?.purchaseOrder||'N/A',
            vendorCode:po?.vendorCode||'N/A',
            poLineQuantity:po?.quantity??null,
            liveInventoryQuantity:inventory.totalQuantity,
            inventoryCost:product.inventoryCost||'N/A',
            physicalLocation:'TBD',
            warehouseId:warehouse,
            riverUrl:riverUrl(warehouse),
            capturedAt:Date.now()
          };
          payload.quantityDisagreement=Number.isFinite(payload.poLineQuantity)&&Number.isFinite(payload.liveInventoryQuantity)&&payload.poLineQuantity!==payload.liveInventoryQuantity;
          await store.set('payload',payload);
          telemetry?.emit('capture',{po:payload.poLineQuantity,live:payload.liveInventoryQuantity,disagreement:payload.quantityDisagreement,matchBy:po?.matchBy||''});
          message.className='note '+(payload.quantityDisagreement?'warn':'ok');
          message.textContent=payload.quantityDisagreement?'QTY DISAGREES':'READY';
          paint();
        }catch(error){message.className='note bad';message.textContent=error.message;}
      };

      root.querySelector('[data-open]').onclick=async()=>{
        payload=payload||await store.get('payload',null);
        if(!payload?.riverUrl)return;
        if(typeof GM_openInTab==='function')GM_openInTab(payload.riverUrl,{active:true,insert:true});
        else window.open(payload.riverUrl,'_blank','noopener');
      };
    }

    return Object.freeze({open});
  }

  return Object.freeze({create,selectPo,riverUrl});
})();