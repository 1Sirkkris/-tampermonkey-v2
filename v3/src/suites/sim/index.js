V3.boot = () => {
  const VERSION=V3.build.version;
  const life=V3.lifecycle.create('sim');
  const telemetry=V3.telemetry.create('sim',VERSION);
  const store=V3.storage.create('sim');
  let snippets=store.get('snippets',[]);
  if(!Array.isArray(snippets))snippets=[];

  const host=document.createElement('div');host.id='bwu2-v3-sim';host.dataset.bwu2V3Ui='1';
  const shadow=host.attachShadow({mode:'open'});
  document.body.appendChild(host);
  V3.screenshot.install({life,roots:[host]});
  shadow.innerHTML='<style>:host{all:initial;position:fixed;right:12px;bottom:12px;z-index:2147482500;font:800 11px Arial;color:#fff}.bar{max-width:760px;display:flex;gap:5px;flex-wrap:wrap;padding:7px;border:1px solid #526076;border-radius:10px;background:#131922;box-shadow:0 10px 28px #0007}button{min-height:28px;padding:4px 7px;border:1px solid #5b6a80;border-radius:7px;background:#222b38;color:#fff;cursor:pointer}button:focus-visible{outline:3px solid #ffd84d}.snips{display:none;width:100%;gap:5px;flex-wrap:wrap}.snips[data-open="1"]{display:flex}</style><div class="bar">'+
    '<button data-wrap="**|**">B</button><button data-wrap="_|_">I</button><button data-wrap="`|`">CODE</button>'+
    '<button data-prefix="> ">QUOTE</button><button data-prefix="- ">LIST</button><button data-table>TABLE</button>'+
    '<button data-snips>SNIPS</button><button data-save>+ SNIP</button><button data-export>EXPORT</button><button data-import>IMPORT</button>'+
    '<button data-open-images>OPEN IMG</button><button data-download-images>DL IMG</button><div class="snips" data-snips-list></div></div>';
  const bar=shadow.querySelector('.bar'),snipList=shadow.querySelector('[data-snips-list]');

  const editor=()=>{
    const candidates=[
      'textarea[placeholder*="markdown" i]','textarea[name*="description" i]','textarea',
      '[contenteditable="true"][role="textbox"]','[contenteditable="true"]'
    ];
    for(const selector of candidates){
      const el=document.querySelector(selector);
      if(el&&el.offsetParent!==null)return el;
    }
    return null;
  };
  const insert=(before,after='',prefix='')=>{
    const el=editor();if(!el)return;
    if(el instanceof HTMLTextAreaElement||el instanceof HTMLInputElement){
      const start=el.selectionStart??el.value.length,end=el.selectionEnd??start;
      const selected=el.value.slice(start,end);
      const body=prefix?selected.split(/\r?\n/).map(line=>prefix+line).join('\n'):before+selected+after;
      el.setRangeText(body,start,end,'end');el.dispatchEvent(new Event('input',{bubbles:true}));el.focus();
    }else{
      el.focus();document.execCommand('insertText',false,prefix||before+(after?'text'+after:''));
    }
  };
  const renderSnips=()=>{
    snipList.replaceChildren();
    snippets.forEach((snip,index)=>{
      const b=document.createElement('button');b.textContent=snip.name||('Snippet '+(index+1));b.title=snip.text||'';
      b.onclick=()=>insert(String(snip.text||''));snipList.appendChild(b);
    });
  };
  const imageUrls=()=>[...new Set([
    ...[...document.querySelectorAll('img')].map(img=>img.currentSrc||img.src),
    ...[...document.querySelectorAll('a[href]')].map(a=>a.href).filter(href=>/\.(?:png|jpe?g|gif|webp)(?:[?#]|$)/i.test(href))
  ].filter(url=>/^https?:/i.test(url)))];

  for(const button of shadow.querySelectorAll('[data-wrap]')){
    button.onclick=()=>{const [a,b]=button.dataset.wrap.split('|');insert(a,b);};
  }
  for(const button of shadow.querySelectorAll('[data-prefix]'))button.onclick=()=>insert('','',button.dataset.prefix);
  shadow.querySelector('[data-table]').onclick=()=>insert('| Header | Header |\n| --- | --- |\n|  |  |');
  shadow.querySelector('[data-snips]').onclick=()=>{snipList.dataset.open=snipList.dataset.open==='1'?'0':'1';renderSnips();};
  shadow.querySelector('[data-save]').onclick=()=>{
    const el=editor();const selected=el&&'selectionStart'in el?String(el.value||'').slice(el.selectionStart,el.selectionEnd):'';
    const text=selected||prompt('Snippet text?')||'';if(!text)return;
    const name=prompt('Snippet name?','Snippet '+(snippets.length+1))||'Snippet '+(snippets.length+1);
    snippets.push({name,text});store.set('snippets',snippets);renderSnips();
  };
  shadow.querySelector('[data-export]').onclick=()=>{
    const blob=new Blob([JSON.stringify(snippets,null,2)],{type:'application/json'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='BWU2_V3_SIM_snippets.json';a.click();URL.revokeObjectURL(a.href);
  };
  shadow.querySelector('[data-import]').onclick=()=>{
    const input=document.createElement('input');input.type='file';input.accept='.json,application/json';
    input.onchange=async()=>{try{const parsed=JSON.parse(await input.files[0].text());if(!Array.isArray(parsed))throw new Error('Expected array');snippets=parsed.filter(x=>x&&typeof x.text==='string').slice(0,200);store.set('snippets',snippets);renderSnips();}catch(error){alert('Import failed: '+error.message);}};
    input.click();
  };
  shadow.querySelector('[data-open-images]').onclick=()=>{const urls=imageUrls();for(const url of urls)window.open(url,'_blank','noopener');telemetry.emit('images.open',{count:urls.length});};
  shadow.querySelector('[data-download-images]').onclick=async()=>{
    const urls=imageUrls();let started=0,fallback=0,failed=0;
    for(let i=0;i<urls.length;i++){
      const url=urls[i];
      try{
        const response=await fetch(url,{credentials:'include'});
        if(!response.ok)throw new Error('HTTP '+response.status);
        const blob=await response.blob();
        const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='SIM-image-'+(i+1);a.click();URL.revokeObjectURL(a.href);started++;
      }catch{
        try{const a=document.createElement('a');a.href=url;a.download='';a.target='_blank';a.click();fallback++;}catch{failed++;}
      }
    }
    telemetry.emit('images.download',{count:urls.length,started,fallback,failed});
    alert('Images: '+started+' download started, '+fallback+' browser fallback, '+failed+' failed.');
  };
  renderSnips();
};