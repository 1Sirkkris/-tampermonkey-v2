V3.boot=()=>{
  const C=V3.core,life=C.lifecycle('sim'),telemetry=C.telemetry('sim',V3.build.version),store=C.store('sim',1),panel=C.panel({id:'sim',title:'V3 · SIM Toolbar',width:680,life});
  let snippets=[],mounted=false,navStarted=false;

  const editor=()=>['textarea[placeholder*="markdown" i]','textarea','[contenteditable="true"][role="textbox"]','[contenteditable="true"]'].map(s=>[...document.querySelectorAll(s)].find(V3.native.visible)).find(Boolean)||null;
  const insert=(before,after='',prefix='',replace=false)=>{const el=editor();if(!el)return;if('selectionStart'in el){const s=el.selectionStart??el.value.length,e=el.selectionEnd??s,selected=el.value.slice(s,e),body=prefix?selected.split(/\r?\n/).map(x=>prefix+x).join('\n'):before+(replace?'':selected)+after;el.setRangeText(body,s,e,'end');el.dispatchEvent(new Event('input',{bubbles:true}));el.focus();}else{el.focus();document.execCommand('insertText',false,before);}};
  const download=(name,text)=>{const a=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type:'application/json'}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),0);};
  const merge=(oldRows,newRows)=>{const out=[...oldRows],used=new Set(out.map(x=>x.name));for(const row of newRows){let name=C.clean(row?.name),text=String(row?.text??'');if(!name||!text)continue;let n=name,i=2;while(used.has(n))n=name+' ('+(i++)+')';used.add(n);out.push({name:n,text});}return out;};

  const ticketUrl=anchor=>{
    if(!anchor?.href)return'';
    let url;
    try{url=new URL(anchor.href,location.href);}catch{return'';}
    if(url.origin!==location.origin)return'';
    let path=url.pathname;
    try{path=decodeURIComponent(path);}catch{}
    if(!/^\/<ticket#[^>]+>(?:\/overview)?\/?$/i.test(path))return'';
    url.hash='';
    return url.href;
  };

  const ticketRow=anchor=>{
    const direct=anchor.closest('tr,[role="row"],li');
    if(direct&&V3.native.visible(direct))return direct;
    let node=anchor.parentElement,best=null;
    for(let depth=0;node&&depth<7;depth++,node=node.parentElement){
      if(!V3.native.visible(node))continue;
      const rect=node.getBoundingClientRect();
      if(rect.height<28||rect.height>240)continue;
      const urls=new Set([...node.querySelectorAll('a[href]')].map(ticketUrl).filter(Boolean));
      if(urls.size!==1)continue;
      best=node;
      if(rect.width>300)break;
    }
    return best;
  };

  const startTicketNavigator=()=>{
    if(navStarted||!/^\/issues(?:\/|$)/.test(location.pathname))return;
    navStarted=true;

    const selected=new Set();
    let rows=[],lastIndex=-1,paintState=null,scanQueued=false;

    const style=document.createElement('style');
    style.dataset.bwu2Ui='1';
    style.dataset.v3SimNav='1';
    style.textContent=`
[data-v3-sim-nav-gutter]{box-sizing:border-box;width:58px;min-width:58px;padding:3px 5px!important;vertical-align:middle;text-align:center}
div[data-v3-sim-nav-gutter],span[data-v3-sim-nav-gutter]{display:flex;flex:0 0 58px;align-items:center;justify-content:center}
.v3-sim-nav-pick{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-width:46px;height:28px;padding:2px 5px;border:1px solid #8795a5;border-radius:6px;background:#fff;color:#26384b;font:800 11px/1 Arial;cursor:pointer;user-select:none}
.v3-sim-nav-pick:hover{background:#eef3f8}.v3-sim-nav-pick[data-selected="1"]{background:#284f75;color:#fff;border-color:#7ca6d3}
.v3-sim-nav-box{display:inline-grid;place-items:center;width:14px;height:14px;border:2px solid currentColor;border-radius:3px;font-size:10px;line-height:1}
.v3-sim-nav-pick[data-selected="0"] .v3-sim-nav-box{color:transparent}
[data-v3-sim-nav-selected="1"]{box-shadow:inset 3px 0 #4f7da7}
#v3-sim-nav-bar{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147482998;display:flex;align-items:center;gap:8px;padding:7px 9px;border:1px solid #526174;border-radius:10px;background:#111720;color:#eef3f8;box-shadow:0 8px 24px #0006;font:800 12px Arial,sans-serif}
#v3-sim-nav-bar[hidden]{display:none!important}
#v3-sim-nav-bar strong{min-width:82px;text-align:center}
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
      const visible=new Set(rows.map(row=>row.url));
      for(const url of [...selected])if(!visible.has(url))selected.delete(url);

      rows.forEach((record,index)=>{
        const button=record.button;
        if(!button)return;
        const on=selected.has(record.url);
        button.dataset.selected=on?'1':'0';
        button.setAttribute('aria-pressed',on?'true':'false');
        button.title='Row '+(index+1)+(on?' selected':' — select');
        record.row.dataset.v3SimNavSelected=on?'1':'0';
      });

      count.textContent='Selected '+selected.size;
      bar.hidden=selected.size===0;
    };

    const setSelected=(index,on)=>{
      const record=rows[index];
      if(!record)return;
      if(on)selected.add(record.url);else selected.delete(record.url);
    };

    const choose=(index,event)=>{
      if(index<0||index>=rows.length)return;
      if(event.shiftKey&&lastIndex>=0){
        const a=Math.min(lastIndex,index),b=Math.max(lastIndex,index);
        for(let i=a;i<=b;i++)setSelected(i,true);
        paintState=true;
      }else{
        const next=!selected.has(rows[index].url);
        setSelected(index,next);
        paintState=next;
      }
      lastIndex=index;
      paint();
    };

    const makeGutter=(record,index)=>{
      const isTable=record.row.tagName==='TR';
      let gutter=record.row.querySelector('[data-v3-sim-nav-gutter]');
      if(!gutter){
        gutter=document.createElement(isTable?'td':'div');
        gutter.dataset.bwu2Ui='1';
        gutter.dataset.v3SimNav='1';
        gutter.dataset.v3SimNavGutter='1';
        const button=document.createElement('button');
        button.type='button';
        button.className='v3-sim-nav-pick';
        button.dataset.v3SimNav='1';
        button.innerHTML='<span class="v3-sim-nav-box">✓</span><span data-number></span>';
        button.addEventListener('pointerdown',event=>{
          if(event.button!==0)return;
          event.preventDefault();
          event.stopPropagation();
          const current=rows.findIndex(row=>row.url===record.url);
          choose(current,event);
        });
        button.addEventListener('pointerenter',event=>{
          if(paintState===null||!(event.buttons&1))return;
          const current=rows.findIndex(row=>row.url===record.url);
          setSelected(current,paintState);
          lastIndex=current;
          paint();
        });
        button.addEventListener('dragstart',event=>event.preventDefault());
        gutter.appendChild(button);
        record.row.insertBefore(gutter,record.row.firstChild);
      }
      record.gutter=gutter;
      record.button=gutter.querySelector('.v3-sim-nav-pick');
      record.button.querySelector('[data-number]').textContent=String(index+1);
    };

    const scan=()=>{
      scanQueued=false;
      if(!/^\/issues(?:\/|$)/.test(location.pathname)){
        selected.clear();
        rows=[];
        bar.hidden=true;
        for(const gutter of document.querySelectorAll('[data-v3-sim-nav-gutter]'))gutter.remove();
        return;
      }

      const found=[],seen=new Set();
      for(const anchor of document.querySelectorAll('a[href]')){
        if(!V3.native.visible(anchor))continue;
        const url=ticketUrl(anchor);
        if(!url||seen.has(url))continue;
        const row=ticketRow(anchor);
        if(!row)continue;
        seen.add(url);
        found.push({url,row,anchor,gutter:null,button:null});
      }

      const currentRows=new Set(found.map(record=>record.row));
      for(const gutter of document.querySelectorAll('[data-v3-sim-nav-gutter]')){
        if(!currentRows.has(gutter.parentElement))gutter.remove();
      }

      rows=found;
      rows.forEach(makeGutter);
      paint();
    };

    const schedule=()=>{
      if(scanQueued)return;
      scanQueued=true;
      life.timeout(scan,60);
    };

    life.on(window,'pointerup',()=>{paintState=null;});
    life.on(window,'pointercancel',()=>{paintState=null;});
    life.observe(document.body,records=>{
      const nativeChange=records.some(record=>{
        const target=record.target?.nodeType===1?record.target:record.target?.parentElement;
        if(target?.closest?.('[data-v3-sim-nav]'))return false;
        return true;
      });
      if(nativeChange)schedule();
    },{childList:true,subtree:true});

    clear.addEventListener('click',()=>{
      selected.clear();
      lastIndex=-1;
      paint();
    });

    open.addEventListener('click',()=>{
      const urls=rows.filter(row=>selected.has(row.url)).map(row=>row.url);
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