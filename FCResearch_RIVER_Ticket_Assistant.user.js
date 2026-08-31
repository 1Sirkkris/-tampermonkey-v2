// ==UserScript==
// @name         TEST FCResearch → RIVER Ticket Assistant v0.3.0
// @namespace    https://github.com/1Sirkkris
// @version      0.3.0
// @description  Capture FCResearch ticket data and drive the Hazmat RIVER workflow to manual checkpoints.
// @include      /^https?:\/\/(?:[^\/]*fcresearch[^\/]*|qifcr\.fe\.aftx\.amazonoperations\.app)\//
// @match        https://river.amazon.com/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_openInTab
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/FCResearch_RIVER_Ticket_Assistant.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/FCResearch_RIVER_Ticket_Assistant.user.js
// ==/UserScript==

(() => {
  'use strict';
  const VERSION = '0.3.0';
  const KEY = 'bwu2_ticket_assistant_payload_v3';
  const RIVER = 'https://river.amazon.com/BWU2/workflows?buildingType=fc&workflowId=undefined&q0=3654ec14-7232-4f65-84c3-87927cdb4d0c&q1=f2738dec-7f6f-4c2e-a85a-db7228de25f1&id=f2738dec-7f6f-4c2e-a85a-db7228de25f1';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
  const norm = v => clean(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const visible = el => !!el && el.isConnected && (() => { const r=el.getBoundingClientRect(),s=getComputedStyle(el); return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'; })();
  const emit = (type, data={}) => { try { window.dispatchEvent(new CustomEvent('bwu2-observability:event',{detail:JSON.stringify({type:`river.${type}`,data})})); } catch {} };

  function labelValue(labels) {
    const wanted = labels.map(norm);
    for (const row of document.querySelectorAll('tr')) {
      const cells = [...row.children].filter(c => c.matches?.('th,td'));
      if (cells.length < 2 || !wanted.includes(norm(cells[0].textContent))) continue;
      return clean(cells[1].querySelector('a')?.textContent || cells[1].textContent);
    }
    return '';
  }

  function tableWith(...headers) {
    return [...document.querySelectorAll('table')].find(table => {
      const text = norm([...table.querySelectorAll('thead th,thead td')].map(x=>x.textContent).join(' | '));
      return headers.every(h => text.includes(norm(h)));
    }) || null;
  }

  function columns(table) {
    const hs = [...table?.querySelectorAll('thead th,thead td') || []].map(x => norm(x.textContent));
    const find = (...names) => hs.findIndex(h => names.some(n => h===norm(n) || h.startsWith(norm(n)+' ')));
    return { po:find('purchase order'), vendor:find('vendor code'), date:find('order date','date'), qty:find('quantity'), asin:find('asin') };
  }

  function latestPo() {
    const table = tableWith('purchase order');
    if (!table) return {};
    const c = columns(table), rows=[...table.querySelectorAll('tbody tr')];
    const values = rows.map(row => {
      const cells=[...row.children].filter(x=>x.matches?.('td,th'));
      const dateText = c.date>=0 ? clean(cells[c.date]?.textContent) : '';
      const date = Date.parse(dateText) || 0;
      return { purchaseOrder:c.po>=0?clean(cells[c.po]?.textContent):'', vendorCode:c.vendor>=0?clean(cells[c.vendor]?.textContent):'', orderDate:dateText, date };
    }).filter(x=>x.purchaseOrder);
    values.sort((a,b)=>b.date-a.date);
    return values[0] || {};
  }

  function inventoryQty(asin) {
    const table = tableWith('quantity');
    if (!table) return 0;
    const c = columns(table); let sum=0;
    for (const row of table.querySelectorAll('tbody tr')) {
      const cells=[...row.children].filter(x=>x.matches?.('td,th'));
      if (c.asin>=0 && asin && !clean(cells[c.asin]?.textContent).includes(asin)) continue;
      const raw=c.qty>=0?clean(cells[c.qty]?.textContent):'';
      const n=Number(raw.replace(/[^0-9.-]/g,'')); if (Number.isFinite(n)) sum+=n;
    }
    return sum;
  }

  function capture() {
    const asin = (labelValue(['ASIN','ISBN']).match(/\b[A-Z0-9]{10}\b/i)||[])[0]?.toUpperCase() || '';
    const fnsku = (labelValue(['FNSKU','FNSku']).match(/\b(?:X0|ZZ)[A-Z0-9]{8}\b/i)||[])[0]?.toUpperCase() || '';
    const title = labelValue(['Title']);
    const sortable = /true|yes/i.test(labelValue(['Sortable']));
    const po = latestPo();
    const inventoryQuantity = inventoryQty(asin);
    const payload = { asin, fnsku, processingId:fnsku||asin, title, sortable, inventoryQuantity, shipmentsImpacted:0, physicalLocation:'N/A', ...po, sourceUrl:location.href, capturedAt:Date.now() };
    if (!asin || !title) throw new Error('FCResearch product data is not ready yet.');
    return payload;
  }

  async function captureReady(timeout=7000) {
    const end=Date.now()+timeout; let last;
    while(Date.now()<end){ try { return capture(); } catch(e){ last=e; await sleep(150); } }
    throw last || new Error('FCResearch capture timed out.');
  }

  function installFcrBridge() {
    document.addEventListener('click', event => {
      const badge = event.target instanceof Element ? event.target.closest('.fc-hazmat.fc-river-l0') : null;
      if (!badge) return;
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
      void (async()=>{
        try {
          const payload=await captureReady(); GM_setValue(KEY,payload); emit('payload.saved',{hasAsin:!!payload.asin,hasFnsku:!!payload.fnsku,hasPo:!!payload.purchaseOrder,hasTitle:!!payload.title,quantity:payload.inventoryQuantity});
          const tab=GM_openInTab(RIVER,{active:true,insert:true,setParent:true}); if(!tab) location.assign(RIVER);
        } catch(error){ alert(`RIVER ticket capture failed: ${error.message}`); }
      })();
    }, true);
  }

  function panel() {
    if (document.getElementById('bwu2-river-assistant')) return document.getElementById('bwu2-river-assistant');
    const el=document.createElement('div'); el.id='bwu2-river-assistant'; el.innerHTML=`<b>RIVER v${VERSION}</b><span data-id></span><div data-status>READY</div><button data-run>RUN</button><button data-clear>STOP / CLEAR</button>`;
    Object.assign(el.style,{position:'fixed',left:'14px',bottom:'14px',zIndex:2147483647,width:'280px',padding:'10px',border:'2px solid #475569',borderRadius:'8px',background:'#fff',color:'#111',font:'12px Arial',boxShadow:'0 4px 16px #0004'});
    const style=document.createElement('style'); style.textContent='#bwu2-river-assistant span{float:right;max-width:135px;overflow:hidden;text-overflow:ellipsis}#bwu2-river-assistant [data-status]{clear:both;padding:8px 0;font-weight:700}#bwu2-river-assistant button{width:49%;min-height:30px;font-weight:800;cursor:pointer}'; document.documentElement.append(style);
    (document.body||document.documentElement).append(el); return el;
  }

  function textOf(el){ return norm(el?.innerText||el?.textContent||el?.value||el?.getAttribute?.('aria-label')||''); }
  function findControl(aliases, selector='button,a,[role="button"],label,input[type="button"],input[type="submit"]') {
    const wanted=aliases.map(norm); return [...document.querySelectorAll(selector)].filter(visible).find(el=>{ const t=textOf(el); return wanted.some(w=>t===w||t.includes(w)); })||null;
  }
  function field(aliases){ const wanted=aliases.map(norm); for(const el of document.querySelectorAll('input,textarea,select')){ if(!visible(el)) continue; const id=el.id; const label=id?document.querySelector(`label[for="${CSS.escape(id)}"]`):null; const t=norm([el.name,el.placeholder,el.getAttribute('aria-label'),label?.textContent,el.closest('div,fieldset')?.querySelector('legend,label')?.textContent].filter(Boolean).join(' ')); if(wanted.some(w=>t.includes(w))) return el; } return null; }
  function setValue(el,value){ if(!el) return false; const v=String(value??''); const p=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value')?.set; if(p) p.call(el,v); else el.value=v; for(const type of ['input','change','blur']) el.dispatchEvent(new Event(type,{bubbles:true})); return clean(el.value)===clean(v); }
  function clickChoice(aliases){ const el=findControl(aliases,'label,button,[role="radio"],[role="option"],input[type="radio"],input[type="checkbox"]'); if(!el) return false; const input=el.matches('input')?el:el.querySelector('input'); (input||el).click(); return true; }
  function next(){ const el=findControl(['next'],'button,a,[role="button"],input[type="button"],input[type="submit"]'); if(!el) throw new Error('Next button not found.'); el.click(); }

  function pageKind(){ const u=(location.pathname+' '+location.search+' '+location.hash).toLowerCase(), body=norm(document.body?.innerText||'');
    if (/create.?issue/.test(u)||body.includes('create issue')) return 'create';
    if (/related.?tt/.test(u)||body.includes('related tt')) return 'related';
    if (/sortab/.test(u)||body.includes('non sortable')||body.includes('non-sortable')) return 'sortability';
    if (/severity/.test(u)||body.includes('units impacted')) return 'severity';
    if (/image/.test(u)||body.includes('image')) return 'images';
    if (/information/.test(u)||body.includes('vendor code')||body.includes('seller id')) return 'information';
    if (/(^|\W)asin(\W|$)/.test(u)||body.includes('type asin here')) return 'asin';
    if (/issue.?at.?fc/.test(u)||body.includes('inbound issue')) return 'issue';
    if (/pandash|dangerous|dg review/.test(u)||body.includes('lacks dg information')) return 'pandash'; return 'unknown'; }

  async function waitPage(previous=''){ const end=Date.now()+12000; while(Date.now()<end){ const p=pageKind(); if(p!=='unknown'&&p!==previous) return p; await sleep(150); } return pageKind(); }
  async function drive(ui, reason='RUN') {
    const payload=GM_getValue(KEY,null); if(!payload){ ui.querySelector('[data-status]').textContent='No saved FCResearch payload.'; return; }
    ui.querySelector('[data-id]').textContent=payload.fnsku||payload.asin||''; const status=ui.querySelector('[data-status]'); status.textContent=`${reason} • checking step…`;
    const p=await waitPage(); emit('step.detected',{step:p});
    if(p==='pandash'){ if(!clickChoice(["lacks dg information","couldn't be classified","could not be classified"])) throw new Error('DG option not found.'); next(); status.textContent='DG selected • advancing…'; }
    else if(p==='issue'){ if(!clickChoice(['inbound','fc inbound issue','inbound issue'])) throw new Error('Inbound option not found.'); next(); status.textContent='Inbound selected • advancing…'; }
    else if(p==='asin'){ if(!setValue(field(['type asin here','asin']),payload.asin)) throw new Error('ASIN field not found/retained.'); next(); status.textContent='ASIN entered • advancing…'; }
    else if(p==='related'){ status.textContent='PAUSED • related-ticket decision is manual.'; }
    else if(p==='information'){
      const vals=[ [['fnsku','x0 asin','asin/fnsku'],payload.fnsku||payload.asin], [['title','product title'],payload.title], [['purchase order','po'],payload.purchaseOrder], [['vendor code','seller id'],payload.vendorCode], [['inventory cost','cost per unit'],payload.inventoryCost], [['physical location','location'],payload.physicalLocation||'N/A'] ];
      let n=0; for(const [a,v] of vals){ const el=field(a); if(el&&setValue(el,v??'')) n++; } status.textContent=`Information filled ${n}/6 • verify, then click Next.`; if(n<6) emit('information.partial',{filled:n});
    }
    else if(p==='sortability'){ const a=payload.sortable?['asin is sortable','sortable']:['asin is non sortable','asin is non-sortable','non-sortable']; if(!clickChoice(a)) throw new Error('Sortability option not found.'); next(); status.textContent='Sortability selected • advancing…'; }
    else if(p==='severity'){ const u=field(['units impacted','number of units impacted']),s=field(['shipments impacted','number of shipments impacted']); if(!setValue(u,payload.inventoryQuantity||0)||!setValue(s,0)) throw new Error('Severity fields not found/retained.'); next(); status.textContent='Severity filled • advancing…'; }
    else if(p==='images'){ if(!clickChoice(['yes'])) throw new Error('Image Yes option not found.'); next(); status.textContent='Images Yes • advancing…'; }
    else if(p==='create'){ status.textContent='STOPPED • Create Issue remains manual.'; }
    else throw new Error('RIVER step not recognised.');
  }

  function installRiver(){ const start=()=>{ const ui=panel(); let busy=false,token=0; const run=async(reason='RUN')=>{ if(busy)return; busy=true; try{await drive(ui,reason);}catch(e){ui.querySelector('[data-status]').textContent=`WAITING • ${e.message}`; emit('error',{message:e.message,step:pageKind()});}finally{busy=false;} };
    ui.querySelector('[data-run]').onclick=()=>void run('Manual RUN'); ui.querySelector('[data-clear]').onclick=()=>{token++;GM_setValue(KEY,null);ui.querySelector('[data-id]').textContent='';ui.querySelector('[data-status]').textContent='STOPPED / CLEARED';};
    document.addEventListener('click',e=>{ const el=e.target instanceof Element?e.target.closest('button,a,[role="button"],input[type="button"],input[type="submit"]'):null; if(!el||el.closest('#bwu2-river-assistant')||!['next','previous'].includes(textOf(el)))return; const prev=pageKind(),t=++token; setTimeout(async()=>{const p=await waitPage(prev);if(t===token&&p!==prev)void run('Page loaded');},80); },true);
    if(GM_getValue(KEY,null)) setTimeout(()=>void run('Page loaded'),150); };
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true}); else start(); }

  if (location.hostname === 'river.amazon.com') installRiver(); else installFcrBridge();
})();
