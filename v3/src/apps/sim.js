V3.boot=()=>{
  const C=V3.core,life=C.lifecycle('sim'),telemetry=C.telemetry('sim',V3.build.version),store=C.store('sim',1),panel=C.panel({id:'sim',title:'V3 · SIM Toolbar',width:680,life});
  let snippets=[],mounted=false,navStarted=false;

  const editor=()=>['textarea[placeholder*="markdown" i]','textarea','[contenteditable="true"][role="textbox"]','[contenteditable="true"]'].map(s=>[...document.querySelectorAll(s)].find(V3.native.visible)).find(Boolean)||null;
  const insert=(before,after='',prefix='',replace=false)=>{const el=editor();if(!el)return;if('selectionStart'in el){const s=el.selectionStart??el.value.length,e=el.selectionEnd??s,selected=el.value.slice(s,e),body=prefix?selected.split(/\r?\n/).map(x=>prefix+x).join('\n'):before+(replace?'':selected)+after;el.setRangeText(body,s,e,'end');el.dispatchEvent(new Event('input',{bubbles:true}));el.focus();}else{el.focus();document.execCommand('insertText',false,before);}};
  const download=(name,text)=>{const a=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type:'application/json'}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),0);};
  const merge=(oldRows,newRows)=>{const out=[...oldRows],used=new Set(out.map(x=>x.name));for(const row of newRows){let name=C.clean(row?.name),text=String(row?.text??'');if(!name||!text)continue;let n=name,i=2;while(used.has(n))n=name+' ('+(i++)+')';used.add(n);out.push({name:n,text});}return out;};

  const ticketLink=anchor=>{
    if(!anchor?.href||!V3.native.visible(anchor))return null;
    const shortId=C.clean(anchor.textContent);
    if(!/^[PV]\d{7,14}$/i.test(shortId))return null;
    let url;
    try{url=new URL(anchor.href,location.href);}catch{return null;}
    if(url.origin!==location.origin)return null;
    url.hash='';
    return {shortId,url:url.href};
  };

  const ticketRow=anchor=>{
    const direct=anchor.closest('tr,[role="row"],li');
    if(direct&&V3.native.visible(direct))return direct;
    let node=anchor.parentElement;
    for(let depth=0;node&&depth<6;depth++,node=node.parentElement){
      if(!V3.native.visible(node))continue;
      const rect=node.getBoundingClientRect();
      if(rect.height>=28&&rect.height<=180&&rect.width>500)return node;
    }
    return null;
  };

  const startTicketNavigator=()=>{
    if(navStarted||!/^\/issues(?:\/|$)/.test(location.pathname))return;
    navStarted=true;

    let rows=[],lastIndex=-1,scanQueued=false,syncing=false,busy=false,drag=null,suppressShiftClick=false;

    const checked=box=>box?.matches?.('input[type="checkbox"]')
      ? !!box.checked
      : box?.getAttribute?.('aria-checked')==='true';

    const nativeToggle=(box,on)=>{
      if(!box||checked(box)===on)return false;
      syncing=true;
      try{box.click();}finally{syncing=false;}
      return true;
    };

    const style=document.createElement('style');
    style.dataset.bwu2Ui='1';
    style.dataset.v3SimNav='1';
    style.textContent=`
[data-v3-sim-check-cell]{position:relative}
[data-v3-sim-check-cell]::after{content:attr(data-v3-sim-row-number);position:absolute;right:2px;top:50%;transform:translateY(-50%);min-width:10px;text-align:center;color:#6b7785;font:800 9px/1 Arial,sans-serif;pointer-events:none}
[data-v3-sim-check-cell][data-v3-sim-checked="1"]::after{color:#245b86}
[data-v3-sim-preview="on"]{background:rgba(35,110,170,.10)!important}
[data-v3-sim-preview="off"]{background:rgba(176,0,32,.07)!important}
#v3-sim-nav-bar{position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:2147482998;display:flex;align-items:center;gap:5px;padding:5px 6px;border:1px solid #b7c1cc;border-radius:7px;background:#fff;color:#27384b;box-shadow:0 3px 10px #0002;font:800 11px Arial,sans-serif}
#v3-sim-nav-bar[hidden]{display:none!important}
#v3-sim-nav-bar strong{min-width:70px;padding:0 4px;text-align:center;white-space:nowrap}
#v3-sim-nav-bar .v3-btn{height:28px;padding:4px 9px;border:1px solid #9da9b6;border-radius:5px;background:#fff;color:#27384b;font:800 11px Arial;box-shadow:none}
#v3-sim-nav-bar .v3-btn:hover{background:#f3f6f8}
#v3-sim-nav-bar .v3-btn.primary{background:#2f5f88;color:#fff;border-color:#2f5f88}
#v3-sim-nav-bar[data-busy="1"]{opacity:.72;pointer-events:none}
`;
    document.head.appendChild(style);
    life.own(()=>style.remove());

    const bar=document.createElement('div');
    bar.id='v3-sim-nav-bar';
    bar.dataset.bwu2Ui='1';
    bar.dataset.v3SimNav='1';
    bar.hidden=true;
    bar.innerHTML='<strong data-count>Selected 0</strong><button class="v3-btn primary" data-open>OPEN TABS</button><button class="v3-btn" data-clear>CLEAR</button>';
    document.body.appendChild(bar);
    life.own(()=>bar.remove());

    const count=bar.querySelector('[data-count]');
    const open=bar.querySelector('[data-open]');
    const clear=bar.querySelector('[data-clear]');

    const paint=()=>{
      let total=0;
      rows.forEach((record,index)=>{
        const on=checked(record.checkbox);
        if(on)total++;
        if(record.cell){
          record.cell.dataset.v3SimRowNumber=String(index+1);
          record.cell.dataset.v3SimChecked=on?'1':'0';
        }
      });
      count.textContent=(busy?'Working · ':'Selected ')+total;
      bar.hidden=total===0&&!busy;
      bar.dataset.busy=busy?'1':'0';
    };

    const clearPreview=()=>{
      for(const record of rows)delete record.row.dataset.v3SimPreview;
    };

    const preview=(from,to,on)=>{
      clearPreview();
      const a=Math.min(from,to),b=Math.max(from,to);
      for(let index=a;index<=b;index++)rows[index].row.dataset.v3SimPreview=on?'on':'off';
    };

    const eventRecord=event=>{
      const path=event.composedPath?.()||[];
      const pathBox=path.find(node=>node?.matches?.('input[type="checkbox"],[role="checkbox"]'));
      if(pathBox){
        const direct=rows.find(record=>record.checkbox===pathBox);
        if(direct)return direct;
      }
      const row=path.find(node=>rows.some(record=>record.row===node))
        || event.target?.closest?.('tr,[role="row"],li');
      return row?rows.find(record=>record.row===row)||null:null;
    };

    const checkboxHit=(event,record)=>{
      if(!record)return false;
      const path=event.composedPath?.()||[];
      return path.includes(record.checkbox)||path.includes(record.cell)
        || record.cell?.contains?.(event.target);
    };

    const masterCheckbox=()=>{
      if(!rows.length)return null;
      const rowBoxes=new Set(rows.map(record=>record.checkbox));
      const scope=rows[0].row.closest('table,[role="table"],[role="grid"]')||document;
      const rowLeft=rows[0].checkbox.getBoundingClientRect().left;
      return [...scope.querySelectorAll('input[type="checkbox"],[role="checkbox"]')]
        .filter(box=>V3.native.visible(box)&&!rowBoxes.has(box))
        .map(box=>({box,rect:box.getBoundingClientRect()}))
        .filter(item=>item.rect.top<rows[0].row.getBoundingClientRect().top&&Math.abs(item.rect.left-rowLeft)<80)
        .sort((a,b)=>b.rect.top-a.rect.top)[0]?.box||null;
    };

    const scan=()=>{
      scanQueued=false;
      if(!/^\/issues(?:\/|$)/.test(location.pathname)){
        rows=[];lastIndex=-1;bar.hidden=true;clearPreview();
        for(const cell of document.querySelectorAll('[data-v3-sim-check-cell]')){
          delete cell.dataset.v3SimCheckCell;
          delete cell.dataset.v3SimRowNumber;
          delete cell.dataset.v3SimChecked;
        }
        return;
      }

      const found=[],seen=new Set();
      for(const anchor of document.querySelectorAll('a[href]')){
        const ticket=ticketLink(anchor);
        if(!ticket||seen.has(ticket.url))continue;
        const row=ticketRow(anchor);
        if(!row)continue;
        const checkbox=[...row.querySelectorAll('input[type="checkbox"],[role="checkbox"]')].find(V3.native.visible);
        if(!checkbox)continue;
        const cell=checkbox.closest('td,[role="cell"]')||checkbox.parentElement;
        if(!cell)continue;
        seen.add(ticket.url);
        found.push({url:ticket.url,shortId:ticket.shortId,row,anchor,checkbox,cell});
      }

      const activeCells=new Set(found.map(record=>record.cell));
      for(const cell of document.querySelectorAll('[data-v3-sim-check-cell]')){
        if(activeCells.has(cell))continue;
        delete cell.dataset.v3SimCheckCell;
        delete cell.dataset.v3SimRowNumber;
        delete cell.dataset.v3SimChecked;
      }

      rows=found;
      rows.forEach((record,index)=>{
        record.cell.dataset.v3SimCheckCell='1';
        record.cell.dataset.v3SimRowNumber=String(index+1);
      });
      paint();
    };

    const settle=async(wanted,timeout=1800)=>{
      const end=performance.now()+timeout;
      while(performance.now()<end){
        await new Promise(resolve=>requestAnimationFrame(resolve));
        scan();
        if(rows.length&&rows.every(record=>checked(record.checkbox)===wanted))return true;
      }
      scan();
      return rows.length&&rows.every(record=>checked(record.checkbox)===wanted);
    };

    const applyRange=async(from,to,on)=>{
      if(busy||!rows.length)return;
      const a=Math.min(from,to),b=Math.max(from,to);
      const snapshot=new Map(rows.map(record=>[record.url,checked(record.checkbox)]));
      const direct=rows.slice(a,b+1).filter(record=>checked(record.checkbox)!==on);

      busy=true;
      paint();
      try{
        if(on){
          const master=masterCheckbox();
          const outsideFalse=rows.filter((record,index)=>(index<a||index>b)&&snapshot.get(record.url)===false);
          const directCost=direct.length;
          const bulkCost=master?3+outsideFalse.length:Number.POSITIVE_INFINITY;

          if(master&&bulkCost<directCost){
            syncing=true;
            try{master.click();}finally{syncing=false;}
            await settle(true);

            for(const url of outsideFalse.map(record=>record.url)){
              const current=rows.find(record=>record.url===url);
              nativeToggle(current?.checkbox,false);
            }
          }else{
            for(const record of direct)nativeToggle(record.checkbox,true);
          }
        }else{
          for(const record of direct)nativeToggle(record.checkbox,false);
        }
      }finally{
        busy=false;
        scan();
        clearPreview();
        paint();
      }
    };

    const clearAll=async()=>{
      if(busy)return;
      const selected=rows.filter(record=>checked(record.checkbox));
      if(!selected.length)return;

      busy=true;
      paint();
      try{
        const master=masterCheckbox();
        if(master&&selected.length>4){
          syncing=true;
          try{master.click();}finally{syncing=false;}
          await new Promise(resolve=>setTimeout(resolve,0));
          scan();

          if(rows.some(record=>checked(record.checkbox))){
            syncing=true;
            try{masterCheckbox()?.click();}finally{syncing=false;}
            await settle(false);
          }
        }else{
          for(const record of selected)nativeToggle(record.checkbox,false);
        }
      }finally{
        lastIndex=-1;
        busy=false;
        scan();
        paint();
      }
    };

    const schedule=()=>{
      if(scanQueued)return;
      scanQueued=true;
      life.timeout(scan,60);
    };

    const recordAtPoint=(x,y)=>{
      const hit=document.elementFromPoint(x,y);
      const row=hit?.closest?.('tr,[role="row"],li');
      return row?rows.find(record=>record.row===row)||null:null;
    };

    life.on(document,'pointerdown',event=>{
      if(syncing||busy||!event.shiftKey||event.button!==0)return;
      const record=eventRecord(event);
      if(!checkboxHit(event,record))return;
      const index=rows.indexOf(record);
      if(index<0)return;

      event.preventDefault();
      event.stopImmediatePropagation();

      const from=lastIndex>=0?lastIndex:index;
      const on=lastIndex>=0?checked(rows[from].checkbox):!checked(record.checkbox);
      drag={from,to:index,on,pointerId:event.pointerId};
      suppressShiftClick=true;
      preview(from,index,on);

      try{event.target?.setPointerCapture?.(event.pointerId);}catch{}
    },true);

    life.on(document,'pointermove',event=>{
      if(!drag||busy||!(event.buttons&1))return;
      const record=recordAtPoint(event.clientX,event.clientY)||eventRecord(event);
      if(!record)return;
      const index=rows.indexOf(record);
      if(index<0||index===drag.to)return;
      drag.to=index;
      preview(drag.from,drag.to,drag.on);
    },true);

    life.on(document,'pointerup',event=>{
      if(!drag)return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const work=drag;
      drag=null;
      try{event.target?.releasePointerCapture?.(work.pointerId);}catch{}
      lastIndex=work.to;
      void applyRange(work.from,work.to,work.on);
      setTimeout(()=>{suppressShiftClick=false;},0);
    },true);

    life.on(document,'click',event=>{
      if(syncing)return;
      const record=eventRecord(event);
      if(!record)return;

      if(event.shiftKey&&suppressShiftClick){
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      if(!checkboxHit(event,record))return;
      lastIndex=rows.indexOf(record);
      queueMicrotask(paint);
    },true);

    life.on(document,'change',event=>{
      const record=eventRecord(event);
      if(record)queueMicrotask(paint);
    },true);

    life.on(window,'blur',()=>{
      if(!drag)return;
      drag=null;
      suppressShiftClick=false;
      clearPreview();
    });

    life.observe(document.body,records=>{
      const nativeChange=records.some(record=>{
        const target=record.target?.nodeType===1?record.target:record.target?.parentElement;
        if(target?.closest?.('[data-v3-sim-nav]'))return false;
        return true;
      });
      if(nativeChange)schedule();
    },{childList:true,subtree:true});

    clear.addEventListener('click',()=>{void clearAll();});

    open.addEventListener('click',()=>{
      const urls=rows.filter(record=>checked(record.checkbox)).map(record=>record.url);
      if(!urls.length)return;
      for(const url of urls){
        if(typeof GM_openInTab==='function')GM_openInTab(url,{active:false,insert:true,setParent:true});
        else window.open(url,'_blank','noopener,noreferrer');
      }
      telemetry.emit('ticketNav.open',{count:urls.length});
    });

    scan();
  };
  const mount=async()=>{if(mounted)return;mounted=true;snippets=await store.get('snippets',[]);if(!Array.isArray(snippets))snippets=[];const root=document.createElement('div');
    root.innerHTML='<section class="v3-section"><div class="v3-row"><button class="v3-btn" data-wrap="**|**">B</button><button class="v3-btn" data-wrap="_|_">I</button><button class="v3-btn" data-wrap="`|`">CODE</button><button class="v3-btn" data-prefix="> ">QUOTE</button><button class="v3-btn" data-prefix="- ">LIST</button><button class="v3-btn" data-prefix="1. ">NUMBERED</button><button class="v3-btn" data-link>LINK</button><button class="v3-btn" data-table>TABLE</button><button class="v3-btn" data-save>+ SNIP</button><button class="v3-btn" data-export>EXPORT</button><label class="v3-btn">IMPORT<input data-import type="file" accept="application/json" hidden></label></div></section><section class="v3-section"><b>Snippets</b><div class="v3-row" data-snips style="margin-top:8px"></div></section><section class="v3-section"><b>Image attachments</b><div data-images class="v3-row" style="margin-top:8px"></div></section>';panel.set(root);
    const paint=()=>{const box=root.querySelector('[data-snips]');box.innerHTML='';snippets.forEach((s,i)=>{const b=document.createElement('button');b.className='v3-btn';b.textContent=s.name||('Snippet '+(i+1));b.onclick=()=>insert(s.text||'');box.appendChild(b);});const images=[...document.querySelectorAll('a[href]')].filter(a=>/\.(?:jpe?g|png|gif|webp|bmp|avif)(?:$|[?#])/i.test(a.href));root.querySelector('[data-images]').innerHTML=images.slice(0,20).map((a,i)=>'<a class="v3-btn" target="_blank" rel="noopener" href="'+C.esc(a.href)+'">IMAGE '+(i+1)+'</a>').join('')||'<span class="v3-note">No image attachments found.</span>';};
    for(const b of root.querySelectorAll('[data-wrap]'))b.onclick=()=>{const [a,z]=b.dataset.wrap.split('|');insert(a,z);};
    for(const b of root.querySelectorAll('[data-prefix]'))b.onclick=()=>insert('','',b.dataset.prefix);
    root.querySelector('[data-table]').onclick=()=>{const el=editor(),selected=el&&'selectionStart'in el?String(el.value||'').slice(el.selectionStart,el.selectionEnd):'';if(selected.includes('\t')){const rows=selected.split(/\r?\n/).filter(Boolean).map(r=>r.split('\t'));const width=Math.max(...rows.map(r=>r.length)),head=rows[0],body=rows.slice(1),line=r=>'| '+Array.from({length:width},(_,i)=>C.clean(r[i]||'').replace(/\|/g,'\\|')).join(' | ')+' |';insert(line(head)+'\n| '+Array(width).fill('---').join(' | ')+' |\n'+body.map(line).join('\n'),'','',true);}else insert('| Header | Header |\n| --- | --- |\n|  |  |');};
    root.querySelector('[data-link]').onclick=()=>{const url=prompt('Link URL?','https://');if(url&&/^https?:\/\//i.test(url))insert('[',']('+url+')');};
    root.querySelector('[data-save]').onclick=async()=>{const el=editor(),selected=el&&'selectionStart'in el?String(el.value||'').slice(el.selectionStart,el.selectionEnd):'';const text=selected||prompt('Snippet text?')||'';if(!text)return;const name=prompt('Snippet name?','Snippet '+(snippets.length+1))||'Snippet';snippets.push({name,text});await store.set('snippets',snippets);paint();};
    root.querySelector('[data-export]').onclick=()=>download('sim-snippets-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json',JSON.stringify(snippets,null,2));
    root.querySelector('[data-import]').onchange=event=>{const file=event.target.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=async()=>{try{const incoming=JSON.parse(String(reader.result||'[]'));if(!Array.isArray(incoming))throw new Error('Expected snippet array');snippets=merge(snippets,incoming);await store.set('snippets',snippets);paint();telemetry.emit('snippets.import',{count:incoming.length});}catch(e){alert('Import failed: '+e.message);}};reader.readAsText(file);};
    paint();
  };

  startTicketNavigator();
  C.dockButton({id:'sim',label:'SIM',title:'V3 SIM Toolbar',onClick:()=>{void mount().then(()=>panel.open());}});
};