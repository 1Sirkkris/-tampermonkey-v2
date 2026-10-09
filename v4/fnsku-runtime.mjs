import { clean, upper, escapeHtml as esc } from './ui-tools.mjs';
export const MAPPING_HOSTS = Object.freeze({na:'fba-fnsku-commingling-console-na.aka.amazon.com',eu:'fba-fnsku-commingling-console-eu.aka.amazon.com',jp:'fba-fnsku-commingling-console-jp.aka.amazon.com'});
export function mappingUrl(region, type, code, token, native=false) {
  if(!MAPPING_HOSTS[region]||!['FNSKU_MAPPINGS','ASIN_MAPPINGS'].includes(type)||!/^[A-Z0-9]{10}$/.test(code)||!token)throw new Error('Invalid mapping request/current CSRF token unavailable');
  const url=new URL('/tool/fnsku-mappings-tool'+(native?'':'/get'),'https://'+MAPPING_HOSTS[region]);
  for(const [key,value] of Object.entries({getMappingsType:type,FNSku:'',FNSkus:type==='FNSKU_MAPPINGS'?code+'\r\n':'',merchantId:'',MSkus:'',ASIN:type==='ASIN_MAPPINGS'?code:'',includeInactive:'true',includeInternalMerchants:'false','anti-csrftoken-a2z':token,submit:'get',paginationToken:''}))url.searchParams.set(key,value);
  if(native)url.hash='#fnsku-direct-min';return url.href;
}
export function parseMapping(window, html, region, type, code) {
  const d=new window.DOMParser().parseFromString(html,'text/html');
  if(d.querySelector('input[type=password],form[action*=signin],form[action*=login]')||/sign in to continue|authentication required/i.test(d.body.textContent))throw new Error(region.toUpperCase()+': authentication required');
  const table=d.querySelector('#fnsku-table')||d.querySelector('table.table');
  if(!table){if(/no (?:mappings|results)(?: found| available| returned)?|0 mappings/i.test(clean(d.body.textContent)))return{region,type,code,rows:[],complete:true};throw new Error(region.toUpperCase()+': mapping table missing');}
  const first=table.rows[0];if(!first)throw new Error(region.toUpperCase()+': mapping headers missing');
  const names=[...first.cells].map(cell=>clean(cell.textContent).toLowerCase());
  const patterns={merchantId:/^merchant\s*id$/,msku:/^msku$/,fnsku:/^fnsku$/,asin:/^asin$/,condition:/^condition$/,status:/^status$/};
  const indexes=Object.fromEntries(Object.entries(patterns).map(([field,pattern])=>{const matches=names.flatMap((name,index)=>pattern.test(name)?[index]:[]);if(matches.length!==1)throw new Error(region.toUpperCase()+': invalid '+field+' column');return[field,matches[0]];}));
  const rows=[];
  for(const node of [...table.rows].slice(1)){
    if(node.cells.length===1&&/no (?:mappings|results)|dataTables_empty/i.test(node.textContent+' '+node.cells[0].className))continue;
    if(node.cells.length!==names.length)throw new Error(region.toUpperCase()+': incomplete mapping row');
    const row=Object.fromEntries(Object.entries(indexes).map(([field,index])=>[field,clean(node.cells[index].textContent)]));row.fnsku=upper(row.fnsku);row.asin=upper(row.asin);row.region=region.toUpperCase();
    if(!/^[A-Z0-9]{10}$/.test(row.fnsku)||!/^[A-Z0-9]{10}$/.test(row.asin))throw new Error(region.toUpperCase()+': invalid mapping identity');
    if((type==='FNSKU_MAPPINGS'?row.fnsku:row.asin)!==code)continue;
    if(!rows.some(existing=>JSON.stringify(existing)===JSON.stringify(row)))rows.push(row);
  }
  const next=[...d.querySelectorAll('a,button,input[type=submit],input[type=button]')].some(node=>/^next\s*>?$/i.test(clean(node.textContent||node.value))&&!node.disabled&&node.getAttribute('aria-disabled')!=='true'&&!node.classList.contains('disabled'));
  return{region,type,code,rows,complete:!next,hasNext:next};
}
export function createMappingTransport(window, gmRequest) {
  return (url,{signal}={})=>new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(new Error('Lookup cancelled'));return;}
    let request,done=false;
    function finish(error,value){if(done)return;done=true;signal?.removeEventListener('abort',cancel);error?reject(error):resolve(value);}
    function cancel(){finish(new Error('Lookup cancelled'));request?.abort();}
    signal?.addEventListener('abort',cancel,{once:true});
    try{request=gmRequest({method:'GET',url,timeout:20000,anonymous:false,onload:response=>{
      if(response.status!==200){finish(new Error('Mapping HTTP '+response.status));return;}
      let final;const expected=new URL(url);try{final=new URL(response.finalUrl||url);}catch{finish(new Error('Mapping redirect URL invalid'));return;}
      if(final.origin!==expected.origin||!/^\/tool\/fnsku-mappings-tool(?:\/get)?\/?$/.test(final.pathname)){finish(new Error('Mapping authentication/redirect response'));return;}
      if(typeof response.responseText!=='string'||response.responseText.length>8000000){finish(new Error('Mapping response invalid/oversized'));return;}
      finish(null,response.responseText);
    },onerror:()=>finish(new Error('Mapping network error')),ontimeout:()=>finish(new Error('Mapping timeout')),onabort:()=>finish(new Error('Lookup cancelled'))});}catch{finish(new Error('Mapping transport unavailable'));}
  });
}
export function candidateRank(row, sources) {
  const merchant=upper(row.merchantId),msku=upper(row.msku);
  if(merchant&&msku&&sources.some(source=>upper(source.merchantId)===merchant&&upper(source.msku)===msku))return{rank:3,label:'BOTH'};
  if(msku&&sources.some(source=>upper(source.msku)===msku))return{rank:2,label:'MSKU'};
  if(merchant&&sources.some(source=>upper(source.merchantId)===merchant))return{rank:1,label:'MERCHANT'};
  return{rank:0,label:'—'};
}
export async function lookupMapping({window,read,code,token,signal,onProgress=()=>{}}) {
  const query=async(region,type)=>{onProgress(region.toUpperCase()+' lookup');return parseMapping(window,await read(mappingUrl(region,type,code,token),{signal}),region,type,code);};
  const regions=[],errors=[];
  if(/^B0[A-Z0-9]{8}$/.test(code)){const jp=await query('jp','ASIN_MAPPINGS');return{code,asin:code,sources:[],candidates:jp.rows,regions:[jp],errors:[],partial:!jp.complete,hasNext:jp.hasNext};}
  const settled=await Promise.allSettled(['na','eu'].map(region=>query(region,'FNSKU_MAPPINGS')));
  settled.forEach((result,index)=>{if(result.status==='fulfilled')regions.push(result.value);else errors.push(['NA','EU'][index]+': '+result.reason.message);});
  if(signal?.aborted)throw new Error('Lookup cancelled');
  let sources=regions.flatMap(region=>region.rows);
  if(!sources.length){try{const jp=await query('jp','FNSKU_MAPPINGS');regions.push(jp);sources=jp.rows;}catch(error){errors.push('JP: '+error.message);}}
  const asins=[...new Set(sources.map(row=>row.asin))];
  const result={code,asins,sources,candidates:[],regions,errors,partial:errors.length>0||regions.some(region=>!region.complete),hasNext:regions.some(region=>region.hasNext)};
  if(asins.length!==1)return{...result,ambiguous:asins.length>1};
  result.asin=asins[0];
  if(sources.every(row=>row.region==='JP'))return result;
  onProgress('JP ASIN mappings');
  try{const html=await read(mappingUrl('jp','ASIN_MAPPINGS',result.asin,token),{signal});const jp=parseMapping(window,html,'jp','ASIN_MAPPINGS',result.asin);result.regions.push(jp);result.candidates=jp.rows;result.hasNext||=jp.hasNext;result.partial||=!jp.complete;}catch(error){if(signal?.aborted)throw error;result.errors.push('JP: '+error.message);result.partial=true;}
  return result;
}
export function createMappingUI({window,read,version,onEvidence=()=>{},getToken}) {
  const d=window.document,listeners=new window.AbortController();let generation=0,active=null,result=null,minimized=window.location.hash==='#fnsku-direct-min',disposed=false,debug=[];
  if(minimized)window.history.replaceState(null,'',window.location.pathname+window.location.search);
  const style=d.createElement('style');style.dataset.tmV4Style='FNSKU';style.textContent=`#tm-v4-fnsku{position:fixed;top:16px;right:16px;z-index:999999;width:min(860px,calc(100vw - 32px));box-sizing:border-box;padding:14px;background:rgba(248,250,252,.97);border:1px solid #d7deea;border-radius:18px;box-shadow:0 18px 48px #0f172e30;font:13px Arial,sans-serif;color:#172033}#tm-v4-fnsku header{display:flex;align-items:center;justify-content:space-between;font-weight:900}#tm-v4-fnsku .body{max-height:75vh;overflow:auto}#tm-v4-fnsku .search{display:flex;gap:8px;margin:12px 0}#tm-v4-fnsku input{flex:1;font-size:18px;padding:9px;border:1px solid #c5d1e0;border-radius:8px;min-width:0}#tm-v4-fnsku button{padding:6px 9px;border:1px solid #c5d1e0;border-radius:7px;background:white;color:#12345b;font-weight:700;cursor:pointer}#tm-v4-fnsku .primary{background:#174e85;color:white}#tm-v4-fnsku .toolbar{display:flex;gap:6px}#tm-v4-fnsku [role=status]{padding:12px 0}#tm-v4-fnsku section{border:1px solid #d5dfeb;border-radius:9px;padding:9px;margin:10px 0;background:white;overflow:auto}#tm-v4-fnsku table{width:100%;border-collapse:collapse}#tm-v4-fnsku td,#tm-v4-fnsku th{text-align:left;padding:6px;border-bottom:1px solid #e2e8f0}#tm-v4-fnsku [data-rank="3"]{background:#d4f8d7}#tm-v4-fnsku [data-rank="2"]{background:#fff0c6}#tm-v4-fnsku .partial{background:#fff0c6;padding:7px}#tm-v4-fnsku[data-minimized=true]{width:auto}#tm-v4-fnsku[data-minimized=true] .body{display:none}`;
  const root=d.createElement('aside');root.id='tm-v4-fnsku';root.dataset.tmV4Script='FNSKU';root.dataset.minimized=String(minimized);
  root.innerHTML=`<header><b>FNSKU Direct Lookup • V4 ${esc(version)}</b><button data-action="minimize">${minimized?'Expand':'Minimize'}</button></header><div class="body"><div class="search"><input autocomplete="off" spellcheck="false" placeholder="Scan / paste FNSKU or ASIN"><button data-action="lookup" class="primary">LOOKUP</button></div><div class="toolbar">${['na','eu','jp'].map(region=>`<button data-region="${region}">${region.toUpperCase()}</button>`).join('')}<button data-action="clear">CLEAR</button><button data-action="debug">COPY DEBUG</button></div><div role="status">Ready for FNSKU or ASIN.</div><div data-results></div></div>`;
  const input=root.querySelector('input'),output=root.querySelector('[data-results]'),status=text=>root.querySelector('[role=status]').textContent=text;
  const alive=run=>!disposed&&run===generation;
  function table(rows,candidate=false){return`<table><thead><tr>${[candidate?'Match':'Region','Merchant ID','MSKU','FNSKU','ASIN','State'].map(label=>'<th>'+label+'</th>').join('')}</tr></thead><tbody>${rows.map(row=>{const rank=candidateRank(row,result?.sources||[]);return`<tr data-rank="${candidate?rank.rank:0}"><td>${esc(candidate?rank.label:row.region)}</td>${['merchantId','msku','fnsku','asin'].map(field=>`<td><button data-copy="${esc(row[field])}">${esc(row[field])}</button></td>`).join('')}<td>${esc([row.condition,row.status].filter(Boolean).join(' · '))}</td></tr>`;}).join('')}</tbody></table>`;}
  function render(){if(!result)return;const candidates=result.candidates.map(row=>({...row,match:candidateRank(row,result.sources)})).sort((a,b)=>b.match.rank-a.match.rank||Number(!/^active$/i.test(a.status))-Number(!/^active$/i.test(b.status))||a.merchantId.localeCompare(b.merchantId)||a.msku.localeCompare(b.msku)||a.fnsku.localeCompare(b.fnsku));
    status(result.ambiguous?'AMBIGUOUS — multiple exact source ASINs':result.asin?`${result.code} → ${result.asin}${result.partial?' • PARTIAL RESULTS':''}`:result.partial?'PARTIAL / UNRESOLVED — see region errors':'No exact mapping found in NA/EU/JP');
    output.innerHTML=(result.partial?`<div class="partial">Partial lookup: ${esc(result.errors.join(' | ')||'More native pages available; this is the first page only.')}</div>`:'')+(result.sources.length?'<section><b>Source mappings</b>'+table(result.sources)+'</section>':'')+(candidates.length?'<section><b>JP / AU candidates</b>'+table(candidates,true)+'</section>':'')+result.regions.filter(region=>region.hasNext).map(region=>`<button data-more-region="${region.region}" data-more-type="${region.type}" data-more-code="${region.code}">More mappings available — VIEW ALL IN ${region.region.toUpperCase()} →</button>`).join('');
  }
  async function lookup(){const code=upper(input.value);if(!/^[A-Z0-9]{10}$/.test(code)){status('Scan / paste a valid 10-character FNSKU or ASIN.');input.focus();return;}
    const token=getToken();if(!token){status('Current native CSRF token missing. Reload the console normally.');return;}
    active?.abort();active=new window.AbortController();const run=++generation;debug=[];result=null;output.replaceChildren();status('Looking up…');root.querySelector('[data-action=lookup]').disabled=true;
    try{const found=await lookupMapping({window,read,code,token,signal:active.signal,onProgress:text=>{if(alive(run))status(text);}});if(!alive(run))return;result=found;debug=found.regions.map(region=>({region:region.region,rows:region.rows.length,complete:region.complete}));debug.push({partial:found.partial,errors:found.errors,ambiguous:!!found.ambiguous});render();onEvidence({type:'fnsku.lookup',intent:'read',data:{outcome:found.partial?'partial':found.ambiguous?'ambiguous':'complete',regions:found.regions.length,rows:found.sources.length+found.candidates.length}});}catch(error){if(alive(run)){status(error.message);debug.push({outcome:'error',message:error.message});}}finally{if(alive(run)){root.querySelector('[data-action=lookup]').disabled=false;input.focus();input.select();}}
  }
  function clear(){generation++;active?.abort();result=null;debug=[];input.value='';output.replaceChildren();root.querySelector('[data-action=lookup]').disabled=false;status('Ready for FNSKU or ASIN.');input.focus();}
  input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void lookup();}},{signal:listeners.signal});
  root.addEventListener('click',async event=>{const target=event.target.closest('button');if(!target)return;const action=target.dataset.action;
    if(action==='lookup')void lookup();if(action==='clear')clear();if(action==='minimize'){minimized=!minimized;root.dataset.minimized=String(minimized);target.textContent=minimized?'Expand':'Minimize';if(!minimized)input.focus();}
    if(target.dataset.region){const code=upper(input.value);if(!/^[A-Z0-9]{10}$/.test(code)){status('Enter a code first');return;}try{window.open(mappingUrl(target.dataset.region,/^B0/.test(code)?'ASIN_MAPPINGS':'FNSKU_MAPPINGS',code,getToken(),true),'_blank','noopener');}catch(error){status(error.message);}}
    if(target.dataset.moreRegion){try{window.open(mappingUrl(target.dataset.moreRegion,target.dataset.moreType,target.dataset.moreCode,getToken(),true),'_blank','noopener');}catch(error){status(error.message);}}
    if(target.dataset.open)window.open(mappingUrl('jp','ASIN_MAPPINGS',target.dataset.open,getToken(),true),'_blank','noopener');
    if(action==='debug'||target.dataset.copy){try{await window.navigator.clipboard.writeText(action==='debug'?JSON.stringify({version,stages:debug},null,2):target.dataset.copy);if(!disposed)status('COPIED ✓');}catch{if(!disposed)status('COPY FAILED');}}
  },{signal:listeners.signal});
  d.documentElement.append(style,root);if(!minimized)input.focus();
  return{root,lookup,clear,getResult:()=>result,dispose(){disposed=true;generation++;active?.abort();listeners.abort();root.remove();style.remove();}};
}
