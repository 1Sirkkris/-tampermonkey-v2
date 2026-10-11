import { clean, upper, escapeHtml as esc, suspiciousDimensions, createReadPool, printBarcode } from './ui-tools.mjs';
export function createToteAudit({ window, reader, enrichment, warehouse, version, onEvidence = () => {}, fetch = window.fetch?.bind(window) }) {
  const d = window.document, pool = createReadPool(4);
  let session, serial = 0, hoverSerial = 0, disposed = false;
  const root = d.createElement('main'); root.id = 'tm-v4-tote'; root.dataset.tmV4Script = 'TOTE';
  const style = d.createElement('style'); style.dataset.tmV4Style = 'TOTE';
  style.textContent = `#tm-v4-tote{font:14px Arial,sans-serif;color:#172033;background:#e7edf3;padding:12px;min-height:96vh;box-sizing:border-box}#tm-v4-tote *{box-sizing:border-box}#tm-v4-tote header{background:#0f2744;color:white;border-radius:8px;padding:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}#tm-v4-tote header strong{font-size:24px}#tm-v4-tote button{cursor:pointer;border:1px solid #a8bdd5;border-radius:6px;padding:7px 11px;background:#fff;color:#163a63;font-weight:700}#tm-v4-tote button:disabled{opacity:.6;cursor:default}#tm-v4-tote .scanner{display:flex;gap:10px;margin-top:12px;align-items:center}#tm-v4-tote input{flex:1;max-width:700px;font:700 24px Arial;padding:12px;border:2px solid #7993b4;border-radius:8px}#tm-v4-tote .meta{display:flex;gap:16px;margin:12px 0;flex-wrap:wrap}#tm-v4-tote .scroll{overflow:auto;background:white;border-radius:8px;margin:12px 0}#tm-v4-tote table{width:100%;border-collapse:collapse}#tm-v4-tote td,#tm-v4-tote th{padding:9px;border-bottom:1px solid #cbd5e1;text-align:left}#tm-v4-tote th{background:#dce8f4;white-space:nowrap}#tm-v4-tote tr[data-state=IN]{background:#d4f8d7}#tm-v4-tote tr[data-state=OUT],#tm-v4-tote tr[data-state=ERROR]{background:#ffe1e1}#tm-v4-tote .suspicious{background:#ffe08c}#tm-v4-tote [data-haz]{display:inline-block;padding:3px;margin-left:4px;border-radius:4px;border:1px solid #94a3b8}#tm-v4-tote [data-haz=HIGH]{background:#ffcf66;color:#111}#tm-v4-tote [data-hover]{cursor:help;text-decoration:underline}#tm-v4-tote .hover{position:fixed;background:white;border:2px solid #244e7c;border-radius:8px;padding:12px;z-index:1200;width:430px;box-shadow:0 3px 14px #33415555}#tm-v4-tote .hover img{max-width:100px;max-height:160px;float:left;margin-right:12px}#tm-v4-tote .hover[hidden]{display:none}`;
  root.innerHTML = `<header><button data-action="full" title="Return to full FCResearch"><strong>FC-LITE</strong></button><b>${esc(warehouse)} TOTE AUDIT</b><span data-container>NO CONTAINER</span><span data-core>V4 READ READY</span><button data-action="stats">COPY STATS</button><button data-action="full">FULL FCRESEARCH ↗</button></header><div class="scanner"><button data-action="focus" data-phase>CONTAINER</button><input autocomplete="off" spellcheck="false" placeholder="Scan tsX / csX"><button data-action="reset" title="Reset">↺</button><button data-action="retry" hidden>Retry inventory</button></div><div class="meta"><b data-summary>No container loaded</b><span role="status" data-status>Scan container</span></div><div class="scroll"><table data-physical><thead><tr><th>Scanned code / count</th><th>Sortable</th><th>Dimensions / Bin</th><th>MADCAT</th><th>Result</th></tr></thead><tbody></tbody></table></div><section data-system hidden><b>SYSTEM INVENTORY — WHAT AMAZON SAYS IS HERE</b> <span data-dims>DIMS …</span> <button data-action="haz">Recheck N/A + L0</button><div class="scroll"><table><thead><tr>${['Container','ASIN / Haz','FNSKU','FcSku','LPN','Qty','Disposition','Consumer','Consumer ID','Outer location','Outer location type','Title'].map(label=>'<th>'+label+'</th>').join('')}</tr></thead><tbody data-inventory></tbody></table></div></section><div class="hover" hidden></div>`;
  const input = root.querySelector('input'), physical = root.querySelector('[data-physical] tbody'), systemBody = root.querySelector('[data-inventory]'), hover = root.querySelector('.hover');
  const status = text => { root.querySelector('[data-status]').textContent = text; };
  const current = s => !disposed && session === s && !s.controller.signal.aborted;
  const focus = () => { if (!disposed) input.focus({ preventScroll: true }); };
  const containerCode = code => /^(?:TSX|CSX)[A-Z0-9]+$/i.test(code);
  function product(s, code) {
    const key = upper(code);
    if (!s.products.has(key)) s.products.set(key, pool(() => /^\d{8,14}$/.test(key) ? reader.barcodeProduct(code, { signal: s.controller.signal }) : reader.product(code, { signal: s.controller.signal }), s.controller.signal).then(result => result.product).catch(error => { s.products.delete(key); throw error; }));
    return s.products.get(key);
  }
  function matches(s, entry) {
    if (!entry.product || s.inventoryState !== 'READY') return [];
    const strict = /^(?:X0|ZZ)[A-Z0-9]{8}$/.test(upper(entry.raw));
    const aliases = strict ? [upper(entry.raw)] : [upper(entry.raw), ...entry.product.aliases.map(upper)];
    return s.inventory.filter(row => [row.asin, row.fnsku, row.fcsku].map(upper).some(code => aliases.includes(code)));
  }
  function redraw(s) {
    if (!current(s)) return;
    s.inventory.forEach(row => { row.physical = 0; });
    for (const entry of s.entries) {
      const rows = matches(s, entry); let units = entry.count;
      for (const row of rows) { const allocated = Math.min(units, row.qty - row.physical); row.physical += allocated; units -= allocated; }
      if (entry.product) entry.state = rows.length ? 'IN' : 'OUT';
    }
    root.querySelector('[data-container]').textContent = s.container;
    root.querySelector('[data-phase]').textContent = s.done ? 'DONE' : 'ITEMS';
    const units = s.inventory.reduce((sum, row) => sum + row.qty, 0), checked = s.inventory.reduce((sum, row) => sum + row.physical, 0);
    const skus = new Set(s.inventory.map(row => upper(row.fnsku || row.fcsku || row.asin))).size;
    const scannedSkus = new Set(s.inventory.filter(row=>row.physical>0).map(row=>upper(row.fnsku||row.fcsku||row.asin))).size;
    root.querySelector('[data-summary]').textContent = s.inventoryState === 'READY' ? `${scannedSkus}/${skus} SKU • ${checked}/${units}u${checked===units && units>0?' • ✓ COMPLETE':''}${s.done?' • DONE':''}` : `QUEUE ${s.pending.length} • inventory ${s.inventoryState.toLowerCase()}`;
    root.querySelector('[data-action="retry"]').hidden = s.inventoryState !== 'ERROR';
    physical.replaceChildren();
    for (const entry of [...s.entries].reverse()) {
      const tr = d.createElement('tr'); tr.dataset.state = entry.state;
      const rows = matches(s, entry), total = rows.reduce((sum,row)=>sum+row.qty,0);
      tr.innerHTML = `<td><button data-print="${entry.id}">${esc(entry.raw)}</button> ×${entry.count}</td><td>${entry.product?.sortable===true?'TRUE':entry.product?.sortable===false?'FALSE':'…'}</td><td class="${entry.product&&suspiciousDimensions(entry.product.dimensions)?'suspicious':''}">${esc(entry.product?.dimensions||'…')}<br>BIN ${esc(entry.bin||'…')}</td><td><button data-madcat="${entry.id}">${esc(entry.madcat||'CHECK…')}</button></td><td title="${esc(entry.error||'')}">${entry.state==='IN'?`✓ IN TOTE ${Math.min(entry.count,total)}/${total}${entry.count>total?' • EXTRA '+(entry.count-total):''}`:entry.state==='OUT'?'✕ NOT IN TOTE':entry.state==='ERROR'?'ERROR ↻':'CHECKING'}</td>`;
      tr.querySelector('[data-print]').disabled = !entry.product;
      if(entry.state==='ERROR') { tr.lastElementChild.tabIndex=0; tr.lastElementChild.onclick=()=>resolveItem(s,entry); }
      physical.append(tr);
    }
  }
  function mergeAliases(s, entry) {
    if (/^(?:X0|ZZ)[A-Z0-9]{8}$/.test(upper(entry.raw))) return entry;
    const other = s.entries.find(row => row!==entry && row.product && !/^(?:X0|ZZ)[A-Z0-9]{8}$/.test(upper(row.raw)) && row.product.aliases.some(alias => entry.product.aliases.includes(alias)));
    if (other) { other.count += entry.count; s.entries = s.entries.filter(row=>row!==entry); for (const [key,value] of s.aliases) if(value===entry)s.aliases.set(key,other); return other; }
    for(const alias of entry.product.aliases) if(!/^(?:X0|ZZ)[A-Z0-9]{8}$/.test(alias))s.aliases.set(upper(alias),entry);
    return entry;
  }
  function enrichmentRead(s,cache,key,read,valid,refresh=false) {
    if(!refresh&&cache.has(key))return cache.get(key);
    const pending=pool(read,s.controller.signal).then(result=>{if(!valid(result)&&cache.get(key)===pending)cache.delete(key);return result;},error=>{if(cache.get(key)===pending)cache.delete(key);throw error;});
    cache.set(key,pending);return pending;
  }
  function binIdentity(s,entry) {
    const p=entry.product,raw=upper(entry.raw),fnsku=upper(p.fnsku),fcsku=upper(p.fcsku),asin=upper(p.asin||p.isbn);
    // Exact internal codes must match their own canonical field. A shared ASIN
    // alone cannot make a different FNSKU/FCSKU compatible.
    if(!fnsku||!asin||/^X0/.test(raw)&&raw!==fnsku||/^ZZ/.test(raw)&&raw!==fcsku)return JSON.stringify([upper(s.container),raw]);
    return JSON.stringify([upper(s.container),asin,fnsku,fcsku,p.aliases.map(upper).sort()]);
  }
  async function madcat(s, entry, force = false, refresh = false) {
    const run = ++entry.measurementSerial;
    entry.madcat = force ? 'AUTH…' : 'CHECK…'; redraw(s);
    try {
      const match = matches(s,entry).find(row=>row.fnsku);
      const identity={fnsku:match?.fnsku||entry.product.fnsku,asin:entry.product.asin||entry.product.isbn};
      const key=JSON.stringify([identity.fnsku?'FNSKU':'ASIN',upper(identity.fnsku||identity.asin),upper(entry.product.fnsku),upper(entry.product.fcsku)]);
      const result=await enrichmentRead(s,s.measurements,key,()=>enrichment.recentMadcat(identity,{signal:s.controller.signal,forceAuth:force}),result=>result.complete===true&&result.madcatSource==='raw'&&typeof result.madcat==='boolean',refresh||force);
      if(!current(s)||entry.measurementSerial!==run)return;
      entry.madcat=result.madcat===null?'UNKNOWN':result.madcat?'YES':result.madcatSource==='history'?'NO?':'NO'; entry.measurement=result;
    } catch(error) { if(current(s)&&entry.measurementSerial===run){entry.madcat='ERROR ↻';entry.error=error.message;} }
    redraw(s);
  }
  async function resolveItem(s, original) {
    original.state='PENDING';original.error='';redraw(s);
    try {
      original.product=await product(s,original.raw); if(!current(s))return;
      const entry=mergeAliases(s,original); redraw(s); status(`${matches(s,entry).length?'✓ IN':'✕ NOT IN'} ${s.container} — ${entry.raw}`);
      if(entry!==original)return;
      void madcat(s,entry);
      enrichmentRead(s,s.bins,binIdentity(s,entry),()=>enrichment.binDescription(s.container,entry.raw,{signal:s.controller.signal,verifiedAliases:entry.product.aliases}),result=>result.complete===true&&typeof result.size==='string'&&!!result.size.trim()).then(result=>{if(current(s)){entry.bin=result.size||'N/A';redraw(s);}},error=>{if(current(s)){entry.bin='ERROR';entry.error=error.message;redraw(s);}});
      onEvidence({type:'tote.scan',intent:'read',data:{outcome:entry.state,count:entry.count}});
    } catch(error) {if(current(s)){original.state='ERROR';original.error=error.message;status(error.message);redraw(s);}}
  }
  function item(s, raw) {
    const existing = s.aliases.get(upper(raw));
    if(existing){existing.count++;redraw(s);return;}
    const entry={id:++serial,raw,count:1,state:'PENDING',measurementSerial:0}; s.entries.push(entry);s.aliases.set(upper(raw),entry);void resolveItem(s,entry);
  }
  async function systemEnrich(s, failuresOnly = false) {
    const groups = [...new Set(s.inventory.map(row=>upper(row.asin)).filter(Boolean))];
    await Promise.all(groups.map(asin=>pool(async()=>{
      if(failuresOnly && s.haz.get(asin)?.level>0)return;
      try{const result=await enrichment.hazmat(asin,{signal:s.controller.signal});if(current(s))s.haz.set(asin,result.hazmat||{level:null});}catch(error){if(current(s))s.haz.set(asin,{level:null,error:error.message});}
      if(current(s))systemRender(s);
    },s.controller.signal).catch(()=>{})));
    if(failuresOnly)return;
    await Promise.all([...new Set(s.inventory.map(row=>row.fnsku||row.asin||row.fcsku))].map(code=>product(s,code).then(p=>{if(current(s)){s.dims.set(upper(code),suspiciousDimensions(p.dimensions));systemRender(s);}},()=>{if(current(s)){s.dims.set(upper(code),null);systemRender(s);}})));
  }
  function systemRender(s) {
    if(!current(s))return;
    systemBody.innerHTML=s.inventory.map(row=>{
      const haz=s.haz.get(upper(row.asin)), flag=s.dims.get(upper(row.fnsku||row.asin||row.fcsku));
      return `<tr class="${flag?'suspicious':''}">${['container','asin','fnsku','fcsku','lpn','qty','disposition','consumer','consumerId','outerLocation','outerLocationType','title'].map(field=>'<td>'+ (field==='asin'?`<span data-hover="${esc(row.asin)}">${esc(row.asin)}</span><span data-haz="${haz?.level>0?'HIGH':'OTHER'}" title="${esc(haz?.message||haz?.error||'')}">${haz?haz.level===null?'N/A':'L'+haz.level:'…'}</span>`:esc(row[field]))+'</td>').join('')}</tr>`;
    }).join('') || '<tr><td colspan="12">No inventory returned</td></tr>';
    const values=[...s.dims.values()];root.querySelector('[data-dims]').textContent=`DIMS ${values.filter(Boolean).length} suspicious / ${values.length} checked${values.some(value=>value===null)?' • errors':''}`;
  }
  async function load(s) {
    s.inventoryState='LOADING';redraw(s);status('Loading system inventory • KEEP SCANNING');root.querySelector('[data-system]').hidden=false;
    try {
      const result=await reader.inventory(s.container,{signal:s.controller.signal}); if(!current(s))return;
      if(!result.complete)throw new Error('Incomplete inventory — audit blocked');
      if(result.rows.some(row=>upper(row.container)!==upper(s.container)))throw new Error('Inventory contains another container — audit blocked');
      s.inventory=result.rows.map(row=>({...row,physical:0}));s.inventoryState='READY';systemRender(s);
      const queued=s.pending.splice(0);queued.forEach(raw=>item(s,raw));redraw(s);status(`✓ ${s.container} ready — ${s.inventory.length} rows${s.done?' • DONE':' • keep scanning'}`);void systemEnrich(s);
    }catch(error){if(current(s)){s.inventoryState='ERROR';systemBody.innerHTML='<tr><td colspan="12">'+esc(error.message)+'</td></tr>';status(`${error.message} • ${s.pending.length} scans retained`);redraw(s);}}
  }
  function reset() {
    session?.controller.abort();session=null;hoverSerial++;hover.hidden=true;physical.replaceChildren();systemBody.replaceChildren();root.querySelector('[data-system]').hidden=true;root.querySelector('[data-container]').textContent='NO CONTAINER';root.querySelector('[data-phase]').textContent='CONTAINER';root.querySelector('[data-summary]').textContent='No container loaded';root.querySelector('[data-action="retry"]').hidden=true;input.value='';input.placeholder='Scan tsX / csX';status('Scan container');focus();
  }
  function scan(value) {
    if(disposed)return;const code=clean(value);if(!code)return;input.value='';
    if(containerCode(code)){
      if(session && upper(code)===upper(session.container)){session.done=true;redraw(session);status('DONE — scan next container');}
      else {reset();session={container:code,inventory:[],entries:[],pending:[],aliases:new Map(),products:new Map(),bins:new Map(),measurements:new Map(),haz:new Map(),dims:new Map(),controller:new window.AbortController(),inventoryState:'LOADING',done:false};input.placeholder='Scan item barcode';void load(session);}
    } else if(!session)status('Scan container first');
    else if(session.done)status('Session done — scan next container');
    else if(session.inventoryState!=='READY'){session.pending.push(code);redraw(session);status(`QUEUE ${session.pending.length} • inventory ${session.inventoryState.toLowerCase()}`);}
    else item(session,code);
    focus();
  }
  const listeners = new window.AbortController();
  input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();event.stopPropagation();scan(input.value);}},{signal:listeners.signal});
  root.addEventListener('click',async event=>{
    const target=event.target.closest('button');if(!target)return;
    const s=session, action=target.dataset.action;
    if(action==='reset')reset();if(action==='focus')focus();
    if(action==='retry'&&s&&s.inventoryState==='ERROR')void load(s);
    if(action==='full'){const url=new window.URL(`${window.location.origin}/${warehouse}/results`);if(s)url.searchParams.set('s',s.container);url.hash='#fcr-native';window.location.assign(url.href);}
    if(action==='stats'){try{await window.navigator.clipboard.writeText(JSON.stringify({container:s?.container,scans:s?.entries.reduce((sum,row)=>sum+row.count,0)||0,queued:s?.pending.length||0,inventoryState:s?.inventoryState||'WAIT_CONTAINER'},null,2));status('COPIED ✓');}catch{status('COPY FAILED');}}
    if(action==='haz'&&s){target.disabled=true;try{await systemEnrich(s,true);}finally{if(current(s))target.disabled=false;}}
    const entry=s?.entries.find(row=>String(row.id)===(target.dataset.madcat||target.dataset.print));
    if(entry?.product&&target.dataset.madcat)void madcat(s,entry,entry.measurement?.authRequired===true,true);
    if(entry?.product&&target.dataset.print){try{const message=await printBarcode(window,fetch,entry.raw,entry.product.title,'TOTE',version);if(current(s))status(message);}catch(error){if(current(s))status(error.message);}focus();}
  },{signal:listeners.signal});
  root.addEventListener('mouseover',async event=>{
    const target=event.target.closest('[data-hover]');if(!target||!session)return;const s=session,run=++hoverSerial;
    hover.hidden=false;hover.textContent='Loading…';const rect=target.getBoundingClientRect();hover.style.left=Math.max(8,Math.min(rect.left,window.innerWidth-440))+'px';hover.style.top=Math.max(8,Math.min(rect.bottom+8,window.innerHeight-230))+'px';
    try{const p=await product(s,target.dataset.hover);if(!current(s)||run!==hoverSerial)return;const image=/^https?:|^\//i.test(p.img||'')?`<img src="${esc(p.img)}" alt="">`:'';hover.innerHTML=image+`<b>${esc(p.title)}</b><p>DIMENSIONS ${esc(p.dimensions)}</p><p>WEIGHT ${esc(p.weight)}</p><p>SORTABLE ${p.sortable===true?'TRUE':p.sortable===false?'FALSE':'UNKNOWN'}</p>`;}catch(error){if(current(s)&&run===hoverSerial)hover.textContent=error.message;}
  },{signal:listeners.signal});
  root.addEventListener('mouseout',event=>{if(event.target.closest('[data-hover]')){hoverSerial++;hover.hidden=true;}},{signal:listeners.signal});
  d.head.append(style);d.body.prepend(root);focus();
  return { scan,reset,root,getState:()=>session,dispose(){disposed=true;session?.controller.abort();listeners.abort();root.remove();style.remove();} };
}
