// ==UserScript==
// @name         BWU2 SIM Duplicate Review
// @namespace    bwu2.local.sim.duplicate-review.test
// @version      0.3.23
// @description  ISS duplicate discovery with exact ASIN/RPI-set checks (order ignored); original one-click ISS and two-step manual closures preserved.
// @match        https://t.corp.amazon.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_xmlhttpRequest
// @connect      wave.qubit.amazon.dev
// @connect      sim-ticketing-graphql-fleet.corp.amazon.com
// ==/UserScript==
(function () {
    'use strict';
    const VER='0.3.23', FC='BWU2', SIM='https://t.corp.amazon.com/issues/';
    const GRAPH='https://sim-ticketing-graphql-fleet.corp.amazon.com/graphql';
    const WAVE='https://wave.qubit.amazon.dev/api/graphql';
    const WAVE_PAGE='https://wave.qubit.amazon.dev/command-center/ISS';
    const ROOT_CAUSE='No Bin Checked - Duplicate Ticket';
    const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const BLANK=new Set(['','-','n/a','na','null','none','undefined','unknown']);
    const clean=v=>String(v==null?'':v).trim();
    const lower=v=>clean(v).toLowerCase();
    const has=v=>!BLANK.has(lower(v));
    const q=(s)=>document.querySelector(s);
    const Q_ISSUE='query issueOverview($issueId: String!) { issue(id: $issueId) { id __typename title description extensions { tt { asin item physicalLocation closureCode assignedGroup __typename } __typename } __typename } }';
    // Live SIM (issueOverview): issue.extensions.tt.assignedGroup is the actual assignment group.
    // Never infer ISS ownership from Wave Category=iss: ICQA/ERDR tickets may also use it.
    // Missing or different SIM assignment blocks every write for the affected pair.
    const Q_AFTER='query issueOverview($issueId: String!) { issue(id: $issueId) { id status extensions { tt { closureCode __typename } __typename } __typename } }';
    const Q_AFTER_FALLBACK='query issueOverview($issueId: String!) { issue(id: $issueId) { id extensions { tt { closureCode __typename } __typename } __typename } }';
    const Q_COMMENT='mutation createCommentOnThread($args: CommentInput!) { createCommentGetComment(args: $args) { id __typename } }';
    const Q_CLOSE='mutation editIssue($args: EditIssueInput!) { editIssue(args: $args) { id extensions { tt { closureCode rootCause rootCauseDetails __typename } __typename } __typename } }';
    const CSS=`
      #bwu-dr-launch{position:fixed;right:16px;bottom:18px;z-index:2147483550;border:1px solid #5982b1;border-radius:9px;background:#173657;color:white;font:600 12px Arial;padding:13px 15px;cursor:pointer;box-shadow:0 3px 16px #0006}
      #bwu-dr-version{position:fixed;bottom:4px;left:62%;z-index:2147483550;background:#e5edf6;color:#183052;font:700 11px Arial;border:1px solid #5982b1;border-radius:4px;padding:2px 7px;pointer-events:none}
      #bwu-dr-panel{display:none;position:fixed;inset:4% 4%;z-index:2147483551;overflow:auto;padding:18px;background:#0f1d2d;color:#eff6ff;border:1px solid #6686a9;border-radius:12px;font:13px Arial;box-shadow:0 6px 30px #000b}
      #bwu-dr-panel button{background:#1a3a58;color:white;border:1px solid #6686a9;border-radius:7px;padding:9px 12px;cursor:pointer;font:13px Arial}
      #bwu-dr-panel button:disabled{opacity:.45;cursor:not-allowed}
      #bwu-dr-panel a{color:#a4d2ff}
      #bwu-dr-panel h2{font-size:18px;margin:0 0 10px}
      #bwu-dr-panel .dr-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0}
      #bwu-dr-panel .dr-toolbar select{background:#1c344d;color:white;border:1px solid #6686a9;padding:10px;border-radius:7px}
      #bwu-dr-panel .dr-filterpane{display:none;background:#14283d;border:1px solid #506b89;border-radius:9px;padding:13px;margin:10px 0}
      #bwu-dr-panel .dr-filterhead{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px}
      #bwu-dr-panel .dr-checkgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px}
      #bwu-dr-panel .dr-filterrow{display:flex;align-items:center;justify-content:space-between;gap:8px;background:#1b344f;border-radius:6px;padding:8px}
      #bwu-dr-panel .dr-filterrow label{display:flex;align-items:center;gap:7px;flex:1;min-width:0;cursor:pointer}
      #bwu-dr-panel .dr-filterrow input[type=checkbox]{accent-color:#62adff;width:15px;height:15px;flex-shrink:0}
      #bwu-dr-panel .dr-filterrow .dr-count{font-size:11px}
      #bwu-dr-panel .dr-advanced{display:none;max-height:310px;overflow:auto;border:1px solid #506b89;border-radius:6px;padding:8px;margin-top:10px}
      #bwu-dr-panel .dr-search{background:#0f1d2d;color:white;padding:9px;border-radius:6px;border:1px solid #6686a9;box-sizing:border-box;width:100%;margin:6px 0}
      #bwu-dr-panel .dr-checkline{display:inline-flex;align-items:center;gap:5px;margin-right:16px}
      #bwu-dr-panel .dr-review-only{color:#ffcf77;font-weight:700}
      #bwu-dr-panel .dr-owner{color:#a9c6e4;font-size:11px;margin-top:2px}
      #bwu-dr-panel .dr-filterhint{color:#b8c9dd;margin:8px 0}
      #bwu-dr-panel .dr-auto-progress{color:#a9caeb;margin:7px 0;font-size:12px}
      #bwu-dr-panel .dr-id-scan{color:#f4d78c;font-size:12px;margin:5px 0}
      #bwu-dr-panel .dr-identifier{color:#b3e3fc;font-weight:700}
      #bwu-dr-panel .dr-ignored-list{display:none;border:1px solid #506b89;border-radius:7px;padding:8px;margin-top:8px;max-height:220px;overflow:auto}
      #bwu-dr-panel .dr-ignored-entry{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid #40566f}
      #bwu-dr-panel .dr-ignored-entry span{overflow-wrap:anywhere}
      #bwu-dr-panel .dr-muted-button{background:#27384a;color:#cfe0ee;border:1px solid #6686a9}
      #bwu-dr-panel .dr-group{background:#192e45;border:1px solid #506b89;border-radius:9px;padding:11px 13px;margin:10px 0}
      #bwu-dr-panel .dr-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
      #bwu-dr-panel .dr-head strong{font-size:14px;overflow-wrap:anywhere}
      #bwu-dr-panel .dr-count{background:#294461;border:1px solid #6686a9;color:#e1ebf7;border-radius:99px;padding:4px 8px;white-space:nowrap;font-size:11px}
      #bwu-dr-panel .dr-meta{color:#c9d9ed;margin:8px 0 5px;overflow-wrap:anywhere}
      #bwu-dr-panel .dr-note{color:#fbd47b;margin:6px 0;white-space:pre-wrap}
      #bwu-dr-panel .dr-status{color:#c7d8ef;margin:8px 0;white-space:pre-wrap}
      #bwu-dr-panel .dr-grid{overflow-x:auto}
      #bwu-dr-panel table{border-collapse:collapse;width:100%;margin-top:8px;color:#d8e6f4}
      #bwu-dr-panel td,#bwu-dr-panel th{padding:8px;text-align:left;border-bottom:1px solid #425a75}
      #bwu-dr-panel th{color:#b5c8df;font-weight:600}
      #bwu-dr-panel .dr-keep{font-weight:700;color:#b9e7cb}
      #bwu-dr-panel .dr-pending{color:#d8e6f4}
      #bwu-dr-panel .dr-good{font-weight:700;color:#b9e7cb}
      #bwu-dr-panel .dr-error{color:#ffb9ad}
      #bwu-dr-panel .dr-group-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px}
      #bwu-dr-panel button.dr-manual{background:#483c29;border:2px solid #f3c46d;color:#fff1d2;font-weight:700}
      #bwu-dr-manual-overlay{position:fixed;inset:0;z-index:2147483553;background:#050e1add;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box}
      #bwu-dr-manual-overlay .dr-manual-dialog{width:min(720px,96vw);max-height:85vh;overflow:auto;background:#172c42;color:#ecf4ff;border:2px solid #fac577;border-radius:12px;padding:20px;font:13px Arial;box-shadow:0 10px 40px #000b}
      #bwu-dr-manual-overlay h3{margin:0 0 12px;font-size:17px}
      #bwu-dr-manual-overlay .dr-manual-alert{border-left:6px solid #ffb53d;background:#473521;padding:12px;margin:12px 0;white-space:pre-wrap;line-height:1.5}
      #bwu-dr-manual-overlay .dr-manual-ticket{border-bottom:1px solid #57728f;padding:9px 0;overflow-wrap:anywhere}
      #bwu-dr-manual-overlay .dr-manual-buttons{display:flex;gap:12px;justify-content:flex-end;margin-top:18px;flex-wrap:wrap}
      #bwu-dr-manual-overlay button{background:#1b4666;color:#fff;border:1px solid #8ca9c4;border-radius:7px;padding:11px 15px;cursor:pointer}
      #bwu-dr-manual-overlay button.dr-manual-confirm{background:#a75b0f;border:2px solid #ffcf70;font-weight:700}

      #bwu-dr-panel button.dr-primary{background:#215b80;border:1px solid #7baac9;font-weight:700}
      #bwu-dr-panel .dr-progress{color:#d6e6f5;flex:1;white-space:pre-wrap;overflow-wrap:anywhere}
      #bwu-dr-panel .dr-ticket{display:inline-flex;align-items:center;gap:7px}
      #bwu-dr-panel .dr-grid table{table-layout:fixed;min-width:800px}
      #bwu-dr-panel .dr-grid th:nth-child(1){width:17%}
      #bwu-dr-panel .dr-grid th:nth-child(2){width:13%}
      #bwu-dr-panel .dr-grid th:nth-child(3){width:44%}
      #bwu-dr-panel .dr-grid th:nth-child(4){width:26%}
      #bwu-dr-panel .dr-ticket-title{white-space:normal;overflow-wrap:anywhere;line-height:1.35}
      #bwu-dr-panel .dr-title-wait{color:#9fb4cc;font-style:italic}
      #bwu-dr-panel .dr-title-alert{color:#ffcd7f;font-weight:700}
      #bwu-dr-panel .dr-alert{background:#402324;border:3px solid #ffb53d;border-left:9px solid #ffb53d;border-radius:7px;padding:12px 14px;margin:12px 0;color:#fff4d6;font-size:14px;font-weight:700;line-height:1.45;white-space:pre-wrap;box-shadow:0 0 0 1px #e6754c70}
      #bwu-dr-panel .dr-preview-trigger{font:700 12px Arial;background:transparent;color:#a4d2ff;border:1px solid #7293b2;padding:0;border-radius:50%;width:20px;height:20px;line-height:18px;text-align:center;cursor:help}
      #bwu-dr-panel .dr-preview-trigger:focus-visible{outline:2px solid #a4d2ff;outline-offset:2px}
      #bwu-dr-preview{display:none;position:fixed;z-index:2147483554;width:min(560px,calc(100vw - 28px));max-height:min(75vh,740px);overflow-y:auto;box-sizing:border-box;border:1px solid #7a9bbb;border-radius:10px;background:#182b40;color:#eff6ff;box-shadow:0 8px 28px #000b;padding:13px;font:12px Arial;overflow-wrap:anywhere;pointer-events:none}
      #bwu-dr-preview .dr-preview-title{font-size:14px;font-weight:700;margin:0 0 10px}
      #bwu-dr-preview .dr-preview-line{margin:7px 0;line-height:1.4;white-space:pre-wrap}
      #bwu-dr-preview .dr-preview-label{color:#b5c8df;font-weight:600}
      #bwu-dr-preview .dr-preview-message{padding-top:8px;color:#a4d2ff;border-top:1px solid #435d7a;margin-top:10px}
      #bwu-dr-preview .dr-preview-warning{color:#ffb9ad}
      #bwu-dr-panel .dr-rpi-match{font-size:12px;font-weight:700;margin-top:5px}
      #bwu-dr-panel .dr-rpi-ok{color:#b9e7cb}
      #bwu-dr-panel .dr-rpi-bad{color:#ffb9ad}
      #bwu-dr-panel .dr-rpi-wait{color:#fbd47b}
      #bwu-dr-preview .dr-preview-body{white-space:pre-wrap;overflow-wrap:anywhere;max-height:38vh;overflow-y:auto;padding:10px;background:#0d2033;border:1px solid #435d7a;border-radius:6px;line-height:1.45;user-select:text}

      #bwu-dr-panel .dr-compact{width:100%;border-collapse:collapse;table-layout:auto;margin:12px 0}
      #bwu-dr-panel .dr-compact th,#bwu-dr-panel .dr-compact td{padding:11px 9px;border-bottom:1px solid #39506a;text-align:left;vertical-align:middle}
      #bwu-dr-panel .dr-compact th{color:#acc4df;font-size:12px;font-weight:600}
      #bwu-dr-panel .dr-compact tr:hover td{background:#182f48}
      #bwu-dr-panel .dr-compact .dr-asin{font-weight:700;font-size:13px;overflow-wrap:anywhere}
      #bwu-dr-panel .dr-small{color:#abc3de;font-size:11px;line-height:1.5}
      #bwu-dr-panel .dr-compact .dr-mini{padding:6px 9px;font-size:12px}
      #bwu-dr-panel .dr-compact .dr-risk{color:#ffc882;font-size:12px;font-weight:700}
      #bwu-dr-panel .dr-compact .dr-ok{color:#bbdecf;font-size:12px}
      #bwu-dr-panel .dr-compact .dr-actions-cell{min-width:170px}
      #bwu-dr-panel .dr-compact .dr-actions-cell button{padding:6px 9px;font-size:12px;margin:2px 3px 2px 0}
      #bwu-dr-panel .dr-compact .dr-muted-button{font-size:11px;opacity:.78}
      #bwu-dr-inspector{display:none;position:fixed;z-index:2147483555;right:max(3vw,18px);top:12vh;width:min(700px,calc(100vw - 36px));height:min(65vh,540px);border-radius:11px;border:1px solid #789ec3;background:#10243a;color:#eaf4ff;box-shadow:0 16px 50px #000c;overflow:hidden;flex-direction:column}
      #bwu-dr-inspector .dr-insp-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #466482;gap:8px}
      #bwu-dr-inspector .dr-insp-layout{display:grid;grid-template-columns:170px minmax(0,1fr);min-height:0;flex:1}
      #bwu-dr-inspector .dr-insp-nav{overflow:auto;padding:8px;background:#1b324a;border-right:1px solid #466482}
      #bwu-dr-inspector .dr-insp-detail{padding:14px;overflow:auto;overflow-wrap:anywhere;white-space:normal;min-width:0}
      #bwu-dr-inspector .dr-insp-item{display:flex;gap:5px;align-items:center;margin:3px 0}
      #bwu-dr-inspector .dr-insp-item button{flex:1;text-align:left;font-size:12px;padding:8px;border:1px solid transparent;background:transparent}
      #bwu-dr-inspector .dr-insp-item button:hover,#bwu-dr-inspector .dr-insp-item button:focus-visible,#bwu-dr-inspector .dr-insp-item button.dr-insp-active{background:#305576;border:1px solid #6396c0}
      #bwu-dr-inspector .dr-insp-item a{font-size:12px;padding:8px;display:inline-block;flex-shrink:0}
      #bwu-dr-inspector .dr-insp-detail h3{font-size:14px;margin:6px 0}
      #bwu-dr-inspector .dr-insp-body{white-space:pre-wrap;background:#0c1b2b;border:1px solid #405b78;border-radius:7px;padding:10px;line-height:1.5;font-size:12px;user-select:text}
      #bwu-dr-inspector .dr-insp-label{font-size:11px;color:#abc3de;margin-bottom:8px}
      #bwu-dr-inspector .dr-insp-risk{color:#ffbc86;font-weight:700;font-size:12px;padding:8px;border:1px solid #a97733;border-radius:6px;margin:8px 0}
      #bwu-dr-inspector .dr-insp-close{padding:5px 9px}
      @media(max-width:680px){#bwu-dr-panel .dr-compact{min-width:650px}#bwu-dr-inspector .dr-insp-layout{grid-template-columns:105px minmax(0,1fr)}#bwu-dr-inspector .dr-insp-nav{padding:4px}#bwu-dr-inspector .dr-insp-detail{padding:8px}}
    `;
    const style=document.createElement('style');style.textContent=CSS;(document.head||document.documentElement).appendChild(style);
    function mk(tag,text,cls){const n=document.createElement(tag);if(text!=null)n.textContent=String(text);if(cls)n.className=cls;return n;}
    function btn(text,cb){const n=mk('button',text);n.type='button';n.addEventListener('click',cb);return n;}
    const ui={launcher:btn('BWU2 Duplicate Review',()=>{
      ui.panel.style.display=ui.panel.style.display==='block'?'none':'block';
      if(ui.panel.style.display!=='block'){hidePreview();closeInspector();}
      // Load only when the user opens the review. Never issue Wave calls on unrelated SIM pages.
      else if(!state.data&&!state.waveBusy&&!state.busy)void fetchWaveData();
      else if(state.data&&!state.busy){if(state.idScan?.started&&!state.idScan.done)resumeIdentityScan();else warmTitles(state.data);}
    }),version:mk('span','DUP v'+VER+' · READY'),panel:mk('section'),preview:mk('div')};
    ui.launcher.id='bwu-dr-launch';ui.version.id='bwu-dr-version';ui.panel.id='bwu-dr-panel';ui.preview.id='bwu-dr-preview';ui.preview.setAttribute('role','tooltip');
    ui.inspector=mk('section');ui.inspector.id='bwu-dr-inspector';ui.inspector.setAttribute('role','dialog');ui.inspector.setAttribute('aria-label','Read-only SIM ticket inspector');
    const state={data:null,busy:false,attempted:new Set(),active:null,waveBusy:false,idScan:null};
    // Hover previews are informational only. Cached data is NEVER used for closure preflight.
    const previewCache=new Map(),previewReads=new Map();
    // Ignore an exact candidate membership, not an ASIN forever: new Wave tickets
    // produce a different key and the group reappears for inspection.
    const IGNORED_STORAGE='BWU2_DR_IGNORED_GROUPS_v1';
    function loadIgnored(){try{const value=JSON.parse(localStorage.getItem(IGNORED_STORAGE)||'[]');return new Map(Array.isArray(value)?value.filter(x=>Array.isArray(x)&&x.length===2&&typeof x[0]==='string'):[]);}catch(_){return new Map();}}
    const ignoredGroups=loadIgnored();
    function saveIgnored(){try{localStorage.setItem(IGNORED_STORAGE,JSON.stringify([...ignoredGroups]));}catch(_){}}
    function ignoreKey(g){const parts=g.identifierGroup?[FC,g.identifierLabel,g.cat,g.type,g.item,g.asin||'']:[FC,g.cat,g.type,g.item,g.asin||''];return [...parts,...g.tickets.map(t=>t.id).sort()].map(lower).join('|');}
    function isIgnored(g){return ignoredGroups.has(ignoreKey(g));}
    function ignoreGroup(g){if(state.busy)return;ignoredGroups.set(ignoreKey(g),{label:(g.asin?'ASIN '+g.asin:'SIM title: '+(g.simTitle||g.item))+' · '+g.item+' ('+g.tickets.length+' tickets)',at:Date.now()});saveIgnored();render();updateIgnoredUI();}
    let previewTimer=null,previewSerial=0,previewFetching=0;
    let observer=null,watchedBody=null;
    function mount(){if(!document.body)return;if(!style.isConnected)(document.head||document.documentElement).appendChild(style);for(const n of [ui.launcher,ui.version,ui.panel,ui.preview])if(!document.body.contains(n))document.body.appendChild(n);if(observer&&watchedBody!==document.body){watchedBody=document.body;observer.observe(watchedBody,{childList:true});}}
    function status(msg,error=false){ui.message.textContent=msg;ui.message.style.color=error?'#ffaaa9':'#c7d8ef';}
    // Wave SLA uses MM/DD/YYYY, but display dates in Australian DD/MM/YYYY format.
    // Preserve full parsed milliseconds for oldest/newest ordering.
    function dateOnly(value){const m=clean(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);return m?m[2].padStart(2,'0')+'/'+m[1].padStart(2,'0')+'/'+m[3]:'—';}
    function hidePreview(){
      if(previewTimer!==null){clearTimeout(previewTimer);previewTimer=null;}
      previewSerial++;ui.preview.style.display='none';
    }
    function positionPreview(trigger){
      const rect=trigger.getBoundingClientRect(),width=Math.min(560,window.innerWidth-28),height=ui.preview.offsetHeight||360;
      const x=rect.right+width+12<=window.innerWidth-12?rect.right+12:Math.max(12,rect.left-width-12);
      const y=Math.max(12,Math.min(rect.top-10,window.innerHeight-height-12));
      ui.preview.style.left=x+'px';ui.preview.style.top=y+'px';
    }
    // Display-only comparison: counts unique complete RPIs shared with every other
    // ticket in the candidate pair/group. Never use cached data to authorise writes.
    function rpiMatchFor(group,ticket){
      const own=previewCache.get(ticket.id);
      if(!own)return {text:'RPI match: checking…',cls:'dr-rpi-wait'};
      const a=extractIdentifiers(own);
      if(!a.rpiScoped)return null;
      if(!a.rpiKey)return {text:'RPI match: unreadable — manual review',cls:'dr-rpi-bad'};
      const peers=group.tickets.filter(t=>t.id!==ticket.id);
      if(!peers.length)return null;
      const others=peers.map(t=>previewCache.get(t.id));
      if(others.some(x=>!x))return {text:'RPI match: awaiting other ticket…',cls:'dr-rpi-wait'};
      const ids=others.map(extractIdentifiers);
      if(ids.some(x=>!x.rpiKey))return {text:'RPI match: other ticket unreadable — manual review',cls:'dr-rpi-bad'};
      const ownSet=new Set(a.rpis);
      const common=a.rpis.filter(code=>ids.every(x=>x.rpis.includes(code))).length;
      const exact=ids.every(x=>x.rpiKey===a.rpiKey&&x.rpiAsin&&x.rpiAsin===a.rpiAsin)&&!!a.rpiAsin;
      const matchText=common+'/'+ownSet.size;
      return {text:'RPI match: '+matchText+(exact?' · ALL MATCH':' · MANUAL REVIEW'),cls:exact?'dr-rpi-ok':'dr-rpi-bad'};
    }
    function updateRpiDisplays(group){
      if(!group.view?.rpis)return;
      for(const ticket of group.tickets){
        const el=group.view.rpis.get(ticket.id);if(!el)continue;
        const result=rpiMatchFor(group,ticket);
        el.textContent=result?.text||'';
        el.className='dr-rpi-match '+(result?.cls||'');
      }
    }
    function paintPreview(ticket,group,record,message,warning=false){
      const box=ui.preview;box.replaceChildren();
      box.append(mk('div','Ticket overview','dr-preview-title'));
      const line=(label,value)=>{const row=mk('div',null,'dr-preview-line');row.append(mk('span',label+': ','dr-preview-label'),document.createTextNode(clean(value)||'—'));box.append(row);};
      const info=record?.issue,tt=info?.extensions?.tt;
      line('Ticket',ticket.id);
      line('ASIN',group.asin);
      line('Group',record?clean(tt?.assignedGroup)||'Unverified':'Loading live SIM group…');
      line('Title',info?info.title:group.simTitle||group.item);
       if(info){box.append(mk('div','SIM description (read-only):','dr-preview-line dr-preview-label'));box.append(mk('div',clean(info.description)||'No description returned by SIM','dr-preview-body'));}
      line('Created',dateOnly(ticket.created));
      line('Location',info?tt?.physicalLocation:ticket.bin);
      const ids=record?extractIdentifiers(record):null;
      if(ids?.ean)line('EAN/UPC',ids.eanDisplay||ids.ean);
      if(ids?.shipment)line('Shipment',ids.shipment);
      if(ids?.secondary)line('Request ref',ids.secondary);
      if(ids?.po)line('PO',ids.po);
      if(ids?.fnsku)line('FNSKU',ids.fnsku);
      if(ids?.fcsku)line('FCSKU',ids.fcsku);
      if(ids?.rpiScoped){const match=rpiMatchFor(group,ticket);if(match)line('RPI comparison',match.text);line('RPIs',ids.rpiKey?ids.rpis.join(', '):'Missing or unreadable — cannot match');}
      const msg=mk('div',message,'dr-preview-message'+(warning?' dr-preview-warning':''));box.append(msg);
    }
    // The list shows each ticket's actual SIM title. Wave's generic Item/ASIN is
    // insufficient to distinguish separate inbound shipments for the same vendor.
    // This read-only cache never replaces the fresh SIM checks before a write.
    function setTitle(group,ticket,record){
      const title=clean(record?.issue?.title);
      if(!title){
        if(!group.titleFailures)group.titleFailures=new Map();
        group.titleFailures.set(ticket.id,'SIM title not supplied');
        const cell=group.view?.titles?.get(ticket.id);
        if(cell){cell.textContent='SIM title not supplied';cell.className='dr-ticket-title dr-title-wait';}
        return;
      }
      group.titleFailures?.delete(ticket.id);
      if(!group.titles)group.titles=new Map();
      group.titles.set(ticket.id,title);
      const cell=group.view?.titles?.get(ticket.id);
      if(cell){cell.textContent=title;cell.className='dr-ticket-title';}
      if(group.view?.owners?.has(ticket.id)){
        const owner=clean(record?.issue?.extensions?.tt?.assignedGroup)||'UNVERIFIED';
        group.view.owners.get(ticket.id).textContent='SIM group: '+owner;
      }
      updateShipmentWarning(group);
      updateRpiDisplays(group);
    }
    function shipmentFromTitle(title){
      const m=clean(title).match(/\bShipment\s+(FBA[A-Z0-9]+)\b/i);
      return m?m[1].toUpperCase():'';
    }
    // Compare complete RPI sets, never their display order or a partial overlap.
    // Keep codes as strings so long identifiers cannot lose numeric precision.
    function extractRpis(source){
      const values=[];let present=false,valid=true;
      const fields=/(?:^|\n)[ \t]*RPIs?(?:[ \t]+(?:codes?|IDs?))?[ \t]*[:#=-][ \t]*(\[[\s\S]*?\]|[^\r\n]*)/gim;
      for(const m of source.matchAll(fields)){
        present=true;let body=clean(m[1]);
        if(body.startsWith('[')&&body.endsWith(']')){
          // Never accept just the bracketed prefix of a malformed RPI field.
          if(clean(source.slice(m.index+m[0].length).split(/\r?\n/,1)[0]))valid=false;
          body=body.slice(1,-1);
        }
        body=body.replace(/(^|[,;\s])(?:np|numpy)\s*\.\s*u?int(?:32|64)\s*\(\s*(\d+)\s*\)(?=$|[,;\s])/gi,'$1$2');
        const tokens=body.split(/[,;\s]+/).filter(Boolean);
        if(!tokens.length){valid=false;continue;}
        for(const token of tokens){
          if(!/^(?:\d+|'\d+'|"\d+")$/.test(token)){valid=false;continue;}
          const code=token.replace(/['"]/g,'').replace(/^0+(?=\d)/,'');
          if(code==='0'){valid=false;continue;}values.push(code);
        }
      }
      const rpis=[...new Set(values)].sort();
      return {rpiPresent:present,rpis,rpiKey:present&&valid&&rpis.length?rpis.join(','):''};
    }
    function rpiAsin(record){
      const values=[record?.issue?.extensions?.tt?.asin,record?.ticket?.asin].filter(has).map(x=>clean(x).toUpperCase());
      for(const m of clean(record?.issue?.description).matchAll(/(?:^|\n)[ \t]*ASIN[ \t]*:[ \t]*([^\r\n]*)/gim))values.push(clean(m[1]).toUpperCase());
      return values.length&&values.every(x=>/^[A-Z0-9]{10}$/.test(x))&&new Set(values).size===1?values[0]:'';
    }
    // Product identity and request identity are separate. Never require SIM
    // title equality when an EAN/UPC identifies the same product; never merge
    // unrelated shipments, POs or explicit request references.
    function extractIdentifiers(record){
      const title=clean(record?.issue?.title),description=clean(record?.issue?.description);
      const source=title+'\n'+description;
      const field=(pattern)=>{const m=source.match(pattern);return m?clean(m[1]).toUpperCase():'';};
      const eans=[];
      const barcodePattern=/(?:^|\n)\s*(?:EAN\s*(?:\/|\s+or\s+)\s*UPC|UPC\s*(?:\/|\s+or\s+)\s*EAN|EAN|UPC|GTIN|Barcode)\s*(?:\([^\n]*?\))?\s*[:#-]\s*([^\n\r]*)/gim;
      for(const m of source.matchAll(barcodePattern)){
        const digits=clean(m[1]).match(/(?:^|\D)(\d[\d -]{6,18}\d)(?!\d)/);
        if(!digits)continue;
        const v=digits[1].replace(/[^0-9]/g,'');
        if(v.length>=8&&v.length<=14&&!/^0+$/.test(v))eans.push(v);
      }
      // UPC-A (12 digits) and EAN-13 with a leading zero represent the
      // same GTIN. Compare a canonical fourteen-digit identifier, retaining
      // the source barcode for display.
      const distinct=[...new Set(eans.map(x=>x.padStart(14,'0')))];
      const relabel=title.match(/Re[- ]label\s+Request\s*[-:]?\s*\[\s*(FBA[A-Z0-9]+)\s*\]\s*\/\s*\[\s*([A-Z0-9]+)\s*\]/i);
      const shipment=field(/\b(?:External\s*\/\s*FBA\s+Shipment(?:\s+ID)?|FBA\s+Shipment(?:\s+ID)?)\s*[:#-]\s*(FBA[A-Z0-9]{6,22})/i)||
        (relabel?relabel[1].toUpperCase():'')||field(/\b(FBA[A-Z0-9]{8,22})\b/i);
      const secondary=relabel?relabel[2].toUpperCase():'';
      const po=field(/(?:^|\n)\s*(?:PO|Purchase\s+Order(?:\s+Number)?)\s*[:#-]\s*([A-Z0-9]{5,30})/im);
      const caseId=field(/\bCase\s*ID\s*[:#-]\s*([A-Z0-9]{6,30})/i);
      const fnsku=field(/(?:^|\n)\s*FNSKU\s*[:#-]\s*([A-Z0-9]{8,20})/im);
      const fcsku=field(/(?:^|\n)\s*FCSKU\s*[:#-]\s*([A-Z0-9]{8,20})/im);
      const tracking=field(/\bTracking(?:\s+Number)?\s*[:#-]\s*([A-Z0-9]{7,32})/i);
      const rpi=extractRpis(source);
      const rpiScoped=rpi.rpiPresent||/\bRPIs?\b|\bProblem\s+Receive\s+Liquidation\b/i.test([title,record?.ticket?.item,record?.issue?.extensions?.tt?.item].join(' '));
      return {ean:distinct.length===1?distinct[0]:'',eanDisplay:distinct.length===1?(eans[0]||''):'',ambiguousEAN:distinct.length>1,shipment,secondary,po,caseId,fnsku,fcsku,tracking,...rpi,rpiScoped,rpiAsin:rpiScoped?rpiAsin(record):''};
    }
    function identityFor(t){const record=previewCache.get(t.id);return record?extractIdentifiers(record):null;}
    function isGenericCatalog(title,item){return /\bitem\s+not\s+in\s+catalog\b/i.test(clean(title)+' '+clean(item));}
    function isRelabel(title){return /\bre[- ]label\s+request\b/i.test(clean(title));}
    function conflictIdentifiers(a,b){
      const A=extractIdentifiers(a),B=extractIdentifiers(b),reasons=[];
      if(A.rpiScoped||B.rpiScoped){
        if(!A.rpiKey||!B.rpiKey)reasons.push('Complete RPI sets missing or unreadable; not a proven duplicate.');
        else if(A.rpiKey!==B.rpiKey)reasons.push('Different RPI sets — not duplicates.');
        if(!A.rpiAsin||!B.rpiAsin)reasons.push('RPI ticket ASIN missing or inconsistent.');
        else if(A.rpiAsin!==B.rpiAsin)reasons.push('Different ASINs for RPI tickets — not duplicates.');
      }
      if(A.ambiguousEAN||B.ambiguousEAN)reasons.push('Multiple EAN/UPC values require manual investigation');
      for(const [key,label] of [['ean','EAN/UPC'],['shipment','FBA shipment'],['secondary','Re-label reference'],['po','PO'],['caseId','Case ID'],['fnsku','FNSKU'],['fcsku','FCSKU'],['tracking','Tracking']]){
        if(A[key]&&B[key]&&A[key]!==B[key])reasons.push('Different '+label+' ('+A[key]+' vs '+B[key]+')');
      }
      return {A,B,reasons};
    }
    function strongMatch(a,b,item){
      const {A,B,reasons}=conflictIdentifiers(a,b);
      if(reasons.length)return false;
      if(isRelabel(a.issue.title)||isRelabel(b.issue.title))return !!(A.shipment&&B.shipment&&A.shipment===B.shipment&&A.secondary&&B.secondary&&A.secondary===B.secondary);
      if(isGenericCatalog(a.issue.title,item)||isGenericCatalog(b.issue.title,item)){
        if(A.ean&&B.ean)return A.ean===B.ean;
        return !!((A.po&&A.po===B.po)&&(A.fnsku&&A.fnsku===B.fnsku));
      }
      return true;
    }
    // Explicit ASINs in SIM title/description and structured metadata trump
    // Wave's general ASIN bucket. Different explicit products are never duplicates.
    function simAsinEvidence(record){
      const title=clean(record?.issue?.title),body=clean(record?.issue?.description);
      const values=[];
      const structured=clean(record?.issue?.extensions?.tt?.asin).toUpperCase();
      if(/^[A-Z0-9]{10}$/.test(structured))values.push(structured);
      const re=/(?:^|[\s\[(])ASIN\s*[:#-]?\s*([A-Z0-9]{10})(?=$|[\s\])},;])/gim;
      for(const source of [title,body])for(const m of source.matchAll(re))values.push(m[1].toUpperCase());
      return [...new Set(values)];
    }
    function explicitProductConflict(a,b){
      const left=simAsinEvidence(a),right=simAsinEvidence(b);
      if(left.length>1||right.length>1)return 'SIM ticket has conflicting ASIN fields.';
      if(left.length&&right.length&&left[0]!==right[0])return 'Different SIM ASINs ('+left[0]+' vs '+right[0]+').';
      return '';
    }
    function groupProductConflict(g){
      const records=g.tickets.map(t=>previewCache.get(t.id));
      if(records.some(x=>!x))return '';
      // Every candidate pair must agree; a missing identifier cannot bridge
      // two otherwise contradictory tickets in the same Wave bucket.
      for(let i=0;i<records.length;i++)for(let j=i+1;j<records.length;j++){
        const conflict=explicitProductConflict(records[i],records[j]);
        if(conflict)return conflict;
        const {reasons}=conflictIdentifiers(records[i],records[j]);
        if(reasons.length)return reasons[0];
      }
      return '';
    }
    // Ticket metadata must be reacquired for EACH closure preflight: all browser
    // caches are informational and cannot authorise a mutation.
    function identityVerdict(a,b,g,manual){
      const x=conflictIdentifiers(a,b),problems=[...x.reasons],warnings=[];
      const productConflict=explicitProductConflict(a,b);if(productConflict)problems.push(productConflict);
      if(g.rpiKey&&(x.A.rpiKey!==g.rpiKey||x.B.rpiKey!==g.rpiKey||x.A.rpiAsin!==g.rpiAsin||x.B.rpiAsin!==g.rpiAsin))problems.push('ASIN/RPI set changed since discovery; reload candidates.');
      if((x.A.rpiScoped||x.B.rpiScoped)&&!x.reasons.length)warnings.push('Same ASIN and full RPI set confirmed ('+x.A.rpis.length+' codes; order ignored).');
      if(isRelabel(a.issue.title)||isRelabel(b.issue.title)){
        if(!x.A.shipment||!x.B.shipment||!x.A.secondary||!x.B.secondary)problems.push('Re-label shipment/reference incomplete; not a proven duplicate.');
      }
      if(isGenericCatalog(a.issue.title,g.item)||isGenericCatalog(b.issue.title,g.item)){
        if(!strongMatch(a,b,g.item))problems.push('Item Not In Catalog needs matching EAN/UPC or PO + FNSKU.');
      }
      if(g.identifierGroup){
        if(g.identKind==='ean'&&(!x.A.ean||x.A.ean!==x.B.ean||x.A.ean!==g.identValue))problems.push('Shared EAN/UPC was not confirmed by fresh SIM reads.');
        if(g.identKind==='request'&&(!x.A.shipment||!x.A.secondary||x.A.shipment!==x.B.shipment||x.A.secondary!==x.B.secondary))problems.push('Shared shipment and reference could not be verified.');
        if(g.identKind==='case'&&(!x.A.caseId||x.A.caseId!==x.B.caseId))problems.push('Shared Case ID could not be verified.');
        if(g.identKind==='po-fnsku'&&(!x.A.po||x.A.po!==x.B.po||!x.A.fnsku||x.A.fnsku!==x.B.fnsku))problems.push('Shared PO + FNSKU could not be verified.');
        if(g.identKind==='asin'&&(lower(a.ticket.asin)!==lower(b.ticket.asin)||lower(a.ticket.asin)!==lower(g.identValue)))problems.push('Same Wave ASIN could not be verified.');
        if(g.identKind==='rpi'&&(x.A.rpiAsin+'|'+x.A.rpiKey!==g.identValue||x.B.rpiAsin+'|'+x.B.rpiKey!==g.identValue))problems.push('Same ASIN and full RPI set were not confirmed by fresh SIM reads.');
      }
      if(!g.identifierGroup&&has(g.asin)){
        for(const [label,record] of [['Oldest',a],['Newer',b]]){
          const evidence=simAsinEvidence(record);
          if(evidence.length&&evidence[0]!==clean(g.asin).toUpperCase())
            problems.push(label+' SIM ASIN differs from Wave group ASIN.');
        }
      }
      if(!manual&&Boolean(x.A.po)!==Boolean(x.B.po))
        problems.push('PO present on only one ticket — manual review required.');
      if(!manual&&(Boolean(x.A.fnsku)!==Boolean(x.B.fnsku)||Boolean(x.A.fcsku)!==Boolean(x.B.fcsku)))
        problems.push('FNSKU/FCSKU present on only one ticket — manual review required.');
      if(!manual&&(!x.A.ean!==!x.B.ean)&&(!x.A.ambiguousEAN&&!x.B.ambiguousEAN))warnings.push('One EAN/UPC is missing; manual review recommended.');
      return {problems,warnings};
    }
    function groupFromTickets(template,tickets,label,identifier=false,kind='',value=''){
      const arr=[...tickets].sort((a,b)=>(a.ms??Infinity)-(b.ms??Infinity));
      const types=[...new Set(arr.map(t=>t.item||template.item))];
      const record=previewCache.get(arr[0]?.id),ids=record?extractIdentifiers(record):null;
      return {...template,view:null,outcomes:null,progress:'',runError:false,
        item:identifier?'Identifier match':template.item,cat:identifier?'Identifier discovery':template.cat,type:identifier?'Mixed Wave types':template.type,
        identifierGroup:identifier,identifierLabel:identifier?label:'',identKind:kind,identValue:value,
        rpiKey:ids?.rpiKey||'',rpiAsin:ids?.rpiAsin||'',
        waveTypes:types,tickets:arr,oldest:arr[0],orderOk:arr.length>1&&arr.every(t=>t.ms!==null)&&arr[0].ms!==arr[1].ms,
        closureBlocked:false,closureBlockReason:'',titles:new Map(arr.filter(t=>previewCache.has(t.id)).map(t=>[t.id,clean(previewCache.get(t.id).issue.title)]))};
    }
    // Within one Wave bucket, split conflicting product/request IDs instead of
    // letting a missing barcode bridge two different products.
    function safeBaseSubgroups(g,visible){
      const all=visible.map(t=>({t,record:previewCache.get(t.id)}));
      if(all.some(x=>!x.record))return [];
      const rpi=all.some(x=>extractIdentifiers(x.record).rpiScoped);
      if(isIlacGroup(g)&&!rpi){
        const buckets=new Map();for(const {t,record} of all){const k=titleKey(record.issue.title);if(!k||titleExcluded(k))continue;if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(t);}
        return [...buckets.entries()].filter(([,v])=>v.length>1).map(([k,v])=>{const sub=groupFromTickets(g,v,'',false);sub.simTitle=k;return sub;});
      }
      let buckets=[all];
      const split=(getId,force=false)=>{
        const next=[];
        for(const b of buckets){const keys=new Set(b.map(x=>getId(x)).filter(Boolean));
          if(keys.size<=1&&!force){next.push(b);continue;}
          const maps=new Map();for(const x of b){const k=getId(x)||'__MISSING__';if(!maps.has(k))maps.set(k,[]);maps.get(k).push(x);}
          next.push(...maps.values());
        }
        buckets=next;
      };
      if(rpi)split(x=>{const d=extractIdentifiers(x.record);return d.rpiAsin&&d.rpiKey?d.rpiAsin+'|'+d.rpiKey:'';},true);
      if(isIlacGroup(g))split(x=>titleKey(x.record.issue.title),true);
      // Re-label pairs require BOTH references. Generic catalog cases need a
      // barcode or a matching PO + FNSKU; exact generic titles are insufficient.
      const relabel=all.some(x=>isRelabel(x.record.issue.title));
      const catalog=all.some(x=>isGenericCatalog(x.record.issue.title,g.item));
      if(relabel)split(x=>{const d=extractIdentifiers(x.record);return d.shipment&&d.secondary?d.shipment+'|'+d.secondary:'';},true);
      else if(g.blankAsinFallback){
        // With no Wave ASIN a generic title is NOT proof that two tickets are
        // about one item. Require a real product or request key.
        split(x=>{const d=extractIdentifiers(x.record);return d.ean?'EAN|'+d.ean:
          d.shipment&&d.secondary?'SHIP|'+d.shipment+'|'+d.secondary:
          d.caseId?'CASE|'+d.caseId:
          d.po&&d.fnsku?'POF|'+d.po+'|'+d.fnsku:'';},true);
      }else{
        split(x=>extractIdentifiers(x.record).ean,catalog);
        split(x=>extractIdentifiers(x.record).shipment);
        split(x=>extractIdentifiers(x.record).po);
        split(x=>extractIdentifiers(x.record).caseId);
      }
      const out=[];
      for(const b of buckets){if(b.length<2)continue;
        if(rpi&&b.some(x=>{const d=extractIdentifiers(x.record);return !d.rpiAsin||!d.rpiKey;}))continue;
        if(relabel&&b.some(x=>{const id=extractIdentifiers(x.record);return !id.shipment||!id.secondary;}))continue;
        if(g.blankAsinFallback&&b.some(x=>!identityKeys(x.record).some(([kind])=>kind!=='asin')))continue;
        if(catalog){const pair=b[0].record;
          if(b.some(x=>!strongMatch(pair,x.record,g.item)))continue;
        }
        const tickets=b.map(x=>x.t),sub=groupFromTickets(g,tickets,'',false);
        // Existing one-click workflow is preserved if no new identifier is
        // missing; otherwise the same group requires the two-step review.
        if(!relabel&&!catalog){const eans=b.map(x=>extractIdentifiers(x.record).ean),some=eans.some(Boolean);
          sub.requiresManualIdentifier=some&&eans.some(x=>!x);
        }
        out.push(sub);
      }
      return out;
    }
    function identityKeys(record){
      const x=extractIdentifiers(record),keys=[];
      // RPI requests must never rejoin via a shared barcode, PO or Wave ASIN.
      if(x.rpiScoped)return x.rpiAsin&&x.rpiKey?[['rpi',x.rpiAsin+'|'+x.rpiKey]]:[];
      if(x.ambiguousEAN)return [];
      if(x.ean)keys.push(['ean',x.ean]);
      if(x.shipment&&x.secondary)keys.push(['request',x.shipment+'|'+x.secondary]);
      if(x.caseId)keys.push(['case',x.caseId]);
      if(x.po&&x.fnsku)keys.push(['po-fnsku',x.po+'|'+x.fnsku]);
      const asin=clean(record.ticket?.asin).toUpperCase();
      if(/^B[A-Z0-9]{9}$/.test(asin))keys.push(['asin',asin]);
      return keys;
    }
    function buildIdentifierGroups(data){
      const scans=data.identityRecords||new Map(),all=data.entries||[],buckets=new Map();
      const seenIds=new Set();
      for(const t of all){
        if(seenIds.has(t.id))continue;seenIds.add(t.id);
        if(!itemVisible(t.item)||titleExcluded(t.item))continue;
        const rec=scans.get(t.id);if(!rec||titleExcluded(rec.issue.title))continue;
        for(const [kind,value] of identityKeys(rec)){
          const key=kind+'|'+value;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(t);
        }
      }
      const rank={rpi:0,ean:1,request:2,case:3,'po-fnsku':4,asin:5};
      const chosen=new Set(),groups=[];
      const keys=[...buckets.entries()].sort((a,b)=>rank[a[0].split('|')[0]]-rank[b[0].split('|')[0]]||b[1].length-a[1].length);
      for(const [key,allTickets] of keys){
        const kind=key.slice(0,key.indexOf('|')),value=key.slice(key.indexOf('|')+1);
        const tickets=allTickets.filter(t=>!chosen.has(t.id));if(tickets.length<2)continue;
        // Same EAN can cover unrelated shipments and POs. Split by unique
        // request context; NEVER join through a missing identifier.
        const b=new Map();for(const t of tickets){
          const ids=extractIdentifiers(scans.get(t.id));
          const k=[ids.shipment||'?',ids.secondary||'?',ids.po||'?',ids.caseId||'?'].join('|');
          if(!b.has(k))b.set(k,[]);b.get(k).push(t);
        }
        // Avoid fragmenting tickets merely because one has an optional field
        // that another omits; known contradictory values must never group.
        const clusters=[];
        for(const t of tickets){const ids=extractIdentifiers(scans.get(t.id));let placed=false;
          for(const cluster of clusters){const other=extractIdentifiers(scans.get(cluster[0].id));
            const {reasons}=conflictIdentifiers(scans.get(t.id),scans.get(cluster[0].id));
            if(cluster.every(member=>!conflictIdentifiers(scans.get(t.id),scans.get(member.id)).reasons.length)){cluster.push(t);placed=true;break;}
          }if(!placed)clusters.push([t]);
        }
        for(const cluster of clusters){if(cluster.length<2)continue;
          // Extra identity-only groups are for matches ACROSS old Wave buckets.
          // Existing exact-bucket groups keep their original one-click path.
          const signature=t=>[t.cat,t.type,t.item,t.asin].map(lower).join('|');
          if(new Set(cluster.map(signature)).size<2)continue;
          const label=kind==='rpi'?'ASIN '+value.split('|')[0]+' · identical RPI set':kind==='ean'?'EAN/UPC '+(extractIdentifiers(scans.get(cluster[0].id)).eanDisplay||value):kind==='request'?'Shipment / reference '+value:kind==='case'?'Case ID '+value:kind==='asin'?'ASIN '+value+' across Wave types':'PO + FNSKU '+value;
          const g=groupFromTickets(cluster[0],cluster,label,true,kind,value);
          if(!g.orderOk)continue;
          groups.push(g);for(const t of cluster)chosen.add(t.id);
        }
      }
      return groups;
    }
    // ILAC/Missing From Inbound can share a Wave "ASIN" value containing a vendor ID,
    // even when the corresponding shipment tickets have completely different titles.
    // The ONLY permitted ILAC duplicate key is the full, exact SIM title.
    function isIlacGroup(g){return /fba\s+missing\s+from\s+inbound/i.test(g.item);}
    function titleKey(value){return clean(value);} // Preserve case, spacing within the title, shipment ID and all details.
    function updateShipmentWarning(group){
      if(!group.view?.warning)return;
      const titles=(group.tickets||[]).map(t=>titleKey(group.titles?.get(t.id)));
      const nonempty=titles.filter(Boolean);
      const different=new Set(nonempty).size>1;
      const element=group.view.warning;
      if(different){
        const shipments=[...new Set(nonempty.map(shipmentFromTitle).filter(Boolean))];
        element.textContent='⚠ POSSIBLE FALSE POSITIVE — SIM TITLES DIFFER'+
          (shipments.length>1?'\nDifferent FBA shipments: '+shipments.join(' vs '):'')+
          '\nReview each ticket carefully before resolving.';
        element.className='dr-alert';
      }else{
        element.textContent='';element.className='dr-note';
      }
    }
    function deriveTitleSubgroups(g){
      if(!g.titleGroups)g.titleGroups=new Map();
      // Never allow tentative groups based on generic Wave Item when the actual
      // ticket titles are the required duplicate key.
      if(g.tickets.some(t=>!g.titles?.has(t.id)))return [];
      const buckets=new Map();
      for(const t of g.tickets){
        const title=titleKey(g.titles.get(t.id));
        if(!title||titleExcluded(title))continue;
        if(!buckets.has(title))buckets.set(title,[]);
        buckets.get(title).push(t);
      }
      const groups=[];
      for(const [title,tickets] of buckets){
        if(tickets.length<2)continue;
        let sub=g.titleGroups.get(title);
        if(!sub){sub={...g,view:null,outcomes:null,progress:'',runError:false};g.titleGroups.set(title,sub);}
        Object.assign(sub,{tickets,oldest:tickets[0],orderOk:tickets.every(t=>t.ms!==null)&&tickets[0].ms!==tickets[1].ms,simTitle:title});
        groups.push(sub);
      }
      return groups;
    }
    // A candidate is displayed only after all its SIM titles have been checked.
    // This prevents ERMR/ERDR/RPI tickets from appearing as if they were duplicates.
    // One excluded ticket does NOT conceal unrelated tickets in the same Wave bucket.
    // Candidates require complete current-session SIM reads before they appear.
    // Distinct UPC/EAN, FBA shipment and other unique references split a Wave
    // bucket; a generic SIM title alone is never enough for Item Not In Catalog.
    const viewGroups=new Map();
    function stableView(g){
      const key=ignoreKey(g);const old=viewGroups.get(key);
      if(!old){viewGroups.set(key,g);return g;}
      // Keep the SAME live object for the same exact ticket membership. During
      // preflight, the UI and task must observe one progress/outcome state.
      // Refresh only discovery metadata; never replace active result or UI refs.
      for(const field of Object.keys(g)){
        if(['view','outcomes','progress','runError'].includes(field))continue;
        old[field]=g[field];
      }
      return old;
    }
    function filteredGroups(){
      if(!state.data)return [];
      const auto=[],manual=[],claimed=new Set();
      // Build original Wave groups first, preserving the authorised one-click
      // lane. The wider barcode scan must never downgrade or override it.
      for(const g of state.data.groups){
        if(!itemVisible(g.item)||titleExcluded(g.item))continue;
        if(g.tickets.some(t=>!g.titles?.has(t.id)&&!g.titleFailures?.has(t.id)))continue;
        const visible=g.tickets.filter(t=>!titleExcluded(g.titles?.get(t.id)||''));
        if(visible.length<2||visible.some(t=>g.titleFailures?.has(t.id)))continue;
        for(const part of safeBaseSubgroups(g,visible)){
          part.blankAsinFallback=g.blankAsinFallback;
          part.closureBlocked=visible[0].id!==g.oldest.id;
          part.closureBlockReason=part.closureBlocked?'Original oldest excluded by filters':'';
          if(isIgnored(part))continue;
          if(eligibleForClosure(part)&&!part.closureBlocked){auto.push(stableView(part));for(const t of part.tickets)claimed.add(t.id);}
          else manual.push(part);
        }
      }
      const groups=[...auto];
      for(const group of state.data.identifierGroups||[]){
        if(group.tickets.some(t=>!itemVisible(t.item)||titleExcluded(previewCache.get(t.id)?.issue?.title)))continue;
        const unclaimed=group.tickets.filter(t=>!claimed.has(t.id));
        if(unclaimed.length<2)continue;
        // Use the genuine oldest *within this identifier's ticket set*.
        const g=unclaimed.length===group.tickets.length?group:groupFromTickets(group,unclaimed,group.identifierLabel,true,group.identKind,group.identValue);
        if(!g.orderOk||isIgnored(g))continue;
        groups.push(stableView(g));for(const t of g.tickets)claimed.add(t.id);
      }
      for(const part of manual){
        const tickets=part.tickets.filter(t=>!claimed.has(t.id));if(tickets.length<2)continue;
        const g=tickets.length===part.tickets.length?part:groupFromTickets(part,tickets,'',false);
        g.blankAsinFallback=part.blankAsinFallback;
        g.requiresManualIdentifier=part.requiresManualIdentifier;
        g.closureBlocked=part.closureBlocked||tickets[0].id!==part.oldest.id;
        g.closureBlockReason=g.closureBlocked?'Original oldest excluded by filter/stronger identifier matching':'';
        if(!isIgnored(g))groups.push(stableView(g));
      }
      // Keep processing results visible after comment/closure invalidates the
      // informational cache. Do not offer a new write for attempted ticket IDs.
      const listed=new Set(groups.map(ignoreKey));
      for(const old of viewGroups.values()){
        if(!old.outcomes?.size||isIgnored(old)||!groupVisible(old))continue;
        const key=ignoreKey(old);
        if(listed.has(key))continue;
        if(!old.tickets.every(t=>state.data.entries.some(x=>x.id===t.id)))continue;
        groups.push(old);listed.add(key);
      }
      return groups;
    }
    let renderQueued=null;
    function scheduleRender(){if(renderQueued!==null)return;renderQueued=setTimeout(()=>{renderQueued=null;render();},100);}
    function autoTitleProgress(){
      if(!state.data)return {done:0,total:0,failed:0};
      let total=0,done=0,failed=0;
      for(const g of state.data.groups){
        if(!itemVisible(g.item)||titleExcluded(g.item))continue;
        for(const t of g.tickets){
          total++;
          if(g.titles?.has(t.id)||g.titleFailures?.has(t.id))done++;
          if(g.titleFailures?.has(t.id))failed++;
        }
      }
      return {done,total,failed};
    }
    // Deduplicate hover requests and background title requests for the same ticket.
    function loadReadOnly(ticket){
      if(previewCache.has(ticket.id))return Promise.resolve(previewCache.get(ticket.id));
      if(previewReads.has(ticket.id))return previewReads.get(ticket.id);
      previewFetching++;
      const promise=readTicket(ticket).then(record=>{previewCache.set(ticket.id,record);return record;})
        .finally(()=>{previewFetching--;previewReads.delete(ticket.id);});
      previewReads.set(ticket.id,promise);
      return promise;
    }
    // Independent bounded adaptive read lanes; no extra requests for benchmarking.
    // The title lane and optional full identifier lane already run sequentially.
    // Unbounded concurrency would risk triggering SIM throttling and SSO failures.
    const MAX_SIM_READS_PER_LANE=10;
    const titleQueue=[],queuedTitles=new Set();let titleWorkers=0;
    function newReadLane(initial){return {limit:initial,min:2,max:MAX_SIM_READS_PER_LANE,
      started:performance.now(),completed:0,failed:0,throttled:0,cache:0,reused:0,
      window:[],recent:[],lastEmitted:0};}
    let titleLane=newReadLane(8);
    function emitReadRates(stage,lane,reason){
      // OBS v0.1.41 listens for bwu2-observability:event. Only aggregate, nonsensitive metrics.
      const times=lane.recent.slice().sort((a,b)=>a-b),count=times.length;
      const elapsed=Math.max(0.001,(performance.now()-lane.started)/1000);
      const data={script:'SIM_DUPLICATE_REVIEW',version:VER,stage,reason,readOnly:true,
        concurrencyTarget:lane.limit,concurrencyMaximum:lane.max,completed:lane.completed,
        failures:lane.failed,throttleSignals:lane.throttled,cacheHits:lane.cache,
        joinedReads:lane.reused,readsPerSecond:+(lane.completed/elapsed).toFixed(2),
        averageMs:count?Math.round(times.reduce((a,b)=>a+b,0)/count):0,
        p95Ms:count?Math.round(times[Math.ceil(count*.95)-1]):0};
      try{window.dispatchEvent(new CustomEvent('bwu2-observability:event',
        {detail:{type:'SIM_DUPLICATE_READ_RATE',data}}));}catch(_){}
    }
    function observeRead(stage,lane,elapsed,ok,error){
      if(!lane)return;
      const throttled=/(?:\bHTTP\s+(?:429|503)\b|throttl|rate.limit|too many requests|quota)/i.test(clean(error?.message));
      lane.completed++;if(!ok)lane.failed++;if(throttled)lane.throttled++;
      lane.recent.push(elapsed);if(lane.recent.length>40)lane.recent.shift();
      lane.window.push({elapsed,ok,throttled});
      const changed=throttled;
      if(throttled){lane.limit=Math.max(lane.min,Math.floor(lane.limit/2));lane.window.length=0;}
      else if(lane.window.length>=16){
        const n=lane.window.length,fail=lane.window.filter(x=>!x.ok).length;
        const mean=lane.window.reduce((sum,x)=>sum+x.elapsed,0)/n;
        if(fail>=2||mean>11000)lane.limit=Math.max(lane.min,lane.limit-2);
        else if(!fail&&mean<6500)lane.limit=Math.min(lane.max,lane.limit+1);
        lane.window.length=0;
      }
      if(changed||lane.completed-lane.lastEmitted>=25){
        lane.lastEmitted=lane.completed;emitReadRates(stage,lane,throttled?'throttle':'sample');
      }
    }
    // Only network reads tune concurrency; cached and joined promises must not
    // masquerade as fast network responses. No duplicate requests are introduced.
    async function readMeasured(t,stage,lane){
      if(previewCache.has(t.id)){if(lane)lane.cache++;return loadReadOnly(t);}
      if(previewReads.has(t.id)){if(lane)lane.reused++;return loadReadOnly(t);}
      const start=performance.now();
      try{const v=await loadReadOnly(t);observeRead(stage,lane,performance.now()-start,true,null);return v;}
      catch(e){observeRead(stage,lane,performance.now()-start,false,e);throw e;}
    }
    function pumpTitles(){
      if(state.busy||ui.panel.style.display!=='block')return;
      while(titleWorkers<titleLane.limit&&titleQueue.length){titleWorkers++;void titleWorker();}
    }
    function warmTitles(data){
      if(state.data!==data||ui.panel.style.display!=='block'||(state.idScan?.started&&!state.idScan.done))return;
      const groups=data.groups.filter(g=>itemVisible(g.item)&&!titleExcluded(g.item)&&!isIgnored(g)).sort((a,b)=>a.tickets.length-b.tickets.length);
      for(const g of groups)for(const t of g.tickets){
        if(previewCache.has(t.id)){
          if(!g.titles?.has(t.id))setTitle(g,t,previewCache.get(t.id));
          continue;
        }
        if(g.titles?.has(t.id)||g.titleFailures?.has(t.id)||queuedTitles.has(t.id))continue;
        queuedTitles.add(t.id);titleQueue.push({data,g,t});
      }
      pumpTitles();
    }
    async function titleWorker(){
      try{
        while(titleQueue.length){
          if(state.busy||ui.panel.style.display!=='block'||titleWorkers>titleLane.limit)break;
          const {data,g,t}=titleQueue.shift();queuedTitles.delete(t.id);
          if(state.data!==data||!itemVisible(g.item)||isIgnored(g))continue;
          try{const record=await readMeasured(t,'titles',titleLane);
            if(state.data!==data)return;
            setTitle(g,t,record);
          }catch(_){
            if(state.data!==data)return;
            if(!g.titleFailures)g.titleFailures=new Map();
            g.titleFailures.set(t.id,'SIM title unavailable — hover to retry');
            const cell=g.view?.titles?.get(t.id);
            if(cell){cell.textContent='SIM title unavailable — hover to retry';cell.className='dr-ticket-title dr-title-wait';}
          }
          if(g.tickets.every(x=>g.titles?.has(x.id)||g.titleFailures?.has(x.id)))scheduleRender();
          updateAutoProgress();
          // An increase in the target can be filled without waiting for this worker to finish.
          if(titleWorkers<titleLane.limit)pumpTitles();
        }
      }finally{
        titleWorkers--;
        if(state.data&&titleQueue.length&&state.data===titleQueue[0].data)pumpTitles();
        if(!titleWorkers){emitReadRates('titles',titleLane,'finished-or-paused');
          if(state.idScan?.started&&!state.idScan.done)resumeIdentityScan();}
      }
    }
    // Optional broad identifier discovery runs after candidate title reads.
    function scanStatus(message){if(ui.identityStatus)ui.identityStatus.textContent=message;}
    function resumeIdentityScan(){
      const scan=state.idScan;if(!scan||scan.done||state.busy||ui.panel.style.display!=='block')return;
      if(titleWorkers)return;
      while(scan.workers<scan.lane.limit&&scan.index<scan.queue.length){scan.workers++;void identityWorker(scan);}
    }
    async function identityWorker(scan){
      try{
        while(scan.index<scan.queue.length&&state.idScan===scan){
          if(state.busy||ui.panel.style.display!=='block'||scan.workers>scan.lane.limit)break;
          const t=scan.queue[scan.index++];let ok=false;
          try{
            const record=await readMeasured(t,'identifiers',scan.lane);
            if(state.idScan!==scan)return;
            scan.data.identityRecords.set(t.id,record);ok=true;
          }catch(_){if(state.idScan===scan)scan.failed++;}
          if(state.idScan!==scan)return;
          scan.doneCount++;
          if(scan.doneCount%10===0||scan.doneCount===scan.queue.length)
            scanStatus('Identifier scan '+scan.doneCount+'/'+scan.queue.length+' · '+scan.failed+' unavailable · '+scan.lane.limit+' target / '+scan.workers+' active SIM reads');
          if(scan.workers<scan.lane.limit)resumeIdentityScan();
        }
      }finally{
        scan.workers--;
        if(state.idScan!==scan)return;
        if(scan.doneCount>=scan.queue.length&&scan.workers===0){
          scan.done=true;scan.data.identifierGroups=buildIdentifierGroups(scan.data);
          scanStatus('Identifier scan finished · '+scan.doneCount+' checked · '+scan.data.identifierGroups.length+' cross-workflow candidate groups');
          emitReadRates('identifiers',scan.lane,'finished');
          if(ui.identityScan)ui.identityScan.disabled=false;
          render();warmTitles(scan.data);
        }else if(!state.busy&&ui.panel.style.display==='block')resumeIdentityScan();
      }
    }
    function startIdentityScan(){
      const data=state.data;if(!data||state.busy)return;
      if(state.idScan?.started&&!state.idScan.done){resumeIdentityScan();return;}
      const selected=data.entries.filter(t=>itemVisible(t.item)&&!titleExcluded(t.item)&&UUID.test(t.id));
      const unique=[...new Map(selected.map(t=>[t.id,t])).values()];
      const queue=unique.filter(t=>!data.identityRecords.has(t.id));
      for(const t of unique){const cached=previewCache.get(t.id);if(cached)data.identityRecords.set(t.id,cached);}
      const pending=queue.filter(t=>!data.identityRecords.has(t.id));
      const scan={started:true,done:false,data,queue:pending,index:0,doneCount:0,failed:0,workers:0,lane:newReadLane(4)};
      state.idScan=scan;ui.identityScan.disabled=true;
      if(!pending.length){scan.done=true;data.identifierGroups=buildIdentifierGroups(data);scanStatus('Cached identifiers ready · '+data.identifierGroups.length+' cross-workflow groups');render();ui.identityScan.disabled=false;return;}
      scanStatus('Scanning '+pending.length+' selected tickets for cross-workflow identifiers (read-only · adaptive 4–10)…');
      resumeIdentityScan();
    }
    function showPreview(trigger,ticket,group){
      if(previewTimer!==null)clearTimeout(previewTimer);
      const token=++previewSerial;
      // A brief delay prevents incidental cursor movement from producing SIM requests.
      previewTimer=setTimeout(async()=>{
        previewTimer=null;
        if(token!==previewSerial||ui.panel.style.display!=='block')return;
        const cached=previewCache.get(ticket.id);
        const draw=(record,message,warning=false)=>{
          if(token!==previewSerial||!trigger.isConnected||ui.panel.style.display!=='block')return;
          paintPreview(ticket,group,record,message,warning);
          ui.preview.style.display='block';positionPreview(trigger);
        };
        if(cached){draw(cached,'Cached preview · fresh checks run before closure');return;}
        if(state.busy){draw(null,'Preview paused during duplicate processing');return;}
        draw(null,'Loading SIM ticket overview…');
        // Cap concurrent read-only previews to protect the responsive list.
        if(previewFetching>=2&&!previewReads.has(ticket.id)){
          draw(null,'Another preview is loading · hover again shortly');return;
        }
        try{const record=await loadReadOnly(ticket);
          setTitle(group,ticket,record);
          const notOurs=record.owner!=='iss-bwu2';
          draw(record,notOurs?'Other SIM owner · review only':'Read-only SIM overview · fresh checks before closure',notOurs);
        }catch(e){draw(null,'SIM preview unavailable: '+(e.message||e),true);}
      },250);
    }
    function addPreviewTrigger(parent,ticket,group){
      const trigger=mk('button','i','dr-preview-trigger');trigger.type='button';
      trigger.title='Hover for ticket overview';trigger.setAttribute('aria-label','Ticket overview '+ticket.id);
      trigger.addEventListener('mouseenter',()=>showPreview(trigger,ticket,group));
      trigger.addEventListener('mouseleave',hidePreview);
      trigger.addEventListener('focus',()=>showPreview(trigger,ticket,group));
      trigger.addEventListener('blur',hidePreview);
      // No click action: never interfere with the separate Resolve button.
      parent.append(trigger);
    }
    // Hover or click one Inspect button per group. Ticket navigation is immediate;
    // only its selected ticket's overview is loaded (no speculative fan-out).
    let inspectorGroup=null,inspectorToken=0,inspectorPinned=false,inspectorHideTimer=0;
    function closeInspector(){
      clearTimeout(inspectorHideTimer);inspectorHideTimer=0;
      inspectorPinned=false;inspectorGroup=null;inspectorToken++;
      ui.inspector.style.display='none';
    }
    function queueInspectorHide(){
      clearTimeout(inspectorHideTimer);
      if(!inspectorPinned)inspectorHideTimer=setTimeout(closeInspector,400);
    }
    function inspectorTicket(g,t,number,button){
      const token=++inspectorToken;
      if(inspectorGroup!==g)return;
      ui.inspector.querySelectorAll('.dr-insp-nav button').forEach(b=>b.classList.toggle('dr-insp-active',b===button));
      const doc=ui.inspector.querySelector('.dr-insp-detail');
      if(!doc)return;
      doc.replaceChildren();
      doc.append(mk('div',(number===0?'OLDEST · KEEP OPEN':'NEWER #'+number+' · READ-ONLY'),'dr-insp-label'));
      const link=mk('a',t.id);link.href=SIM+t.id;link.target='_blank';link.rel='noopener noreferrer';doc.append(link);
      const renderRecord=(record,detail)=>{
        if(token!==inspectorToken||inspectorGroup!==g||!doc.isConnected)return;
        doc.replaceChildren();
        doc.append(mk('div',(number===0?'OLDEST · KEEP OPEN':'NEWER #'+number+' · READ-ONLY'),'dr-insp-label'));
        const a=mk('a',t.id);a.href=SIM+t.id;a.target='_blank';a.rel='noopener noreferrer';doc.append(a);
        if(!record){doc.append(mk('div',detail,'dr-insp-risk'));return;}
        const issue=record.issue,fields=issue.extensions?.tt||{};
        doc.append(mk('h3',clean(issue.title)||'SIM title unavailable'));
        doc.append(mk('div','Owner: '+(clean(fields.assignedGroup)||'UNVERIFIED')+' · Created: '+dateOnly(t.created),'dr-insp-label'));
        const evidence=simAsinEvidence(record);
        const productIssue=evidence.length>1?'Conflicting ASIN fields in this ticket':evidence.length&&g.asin&&evidence[0]!==clean(g.asin).toUpperCase()?'SIM ASIN '+evidence[0]+' differs from Wave ASIN '+g.asin:'';
        if(productIssue)doc.append(mk('div',productIssue+' — never bulk resolve','dr-insp-risk'));
        const id=extractIdentifiers(record);
        const details=['Wave ASIN: '+(g.asin||'—'),'SIM ASIN: '+(evidence.join(', ')||'not confirmed'),
          'PO: '+(id.po||'—'),'FNSKU: '+(id.fnsku||'—'),'FCSKU: '+(id.fcsku||'—'),'EAN/UPC: '+(id.eanDisplay||'—'),
          'Shipment: '+(id.shipment||'—'), 'RPI codes: '+(id.rpis?.length||0)];
        doc.append(mk('div',details.join(' · '),'dr-insp-label'));
        if(id.rpiScoped){const compare=rpiMatchFor(g,t);if(compare)doc.append(mk('div',compare.text,compare.cls==='dr-rpi-ok'?'dr-ok':'dr-insp-risk'));}
        doc.append(mk('div','Full SIM description:','dr-insp-label'));
        doc.append(mk('div',clean(issue.description)||'No description returned','dr-insp-body'));
      };
      const cached=previewCache.get(t.id);
      if(cached){renderRecord(cached);return;}
      if(state.busy){renderRecord(null,'Read-only preview paused while resolving tickets');return;}
      doc.append(mk('div','Loading SIM overview…','dr-insp-label'));
      // Shared request cache deduplicates title loading and inspector hover reads.
      void loadReadOnly(t).then(record=>{if(token!==inspectorToken||inspectorGroup!==g)return;setTitle(g,t,record);renderRecord(record);})
        .catch(e=>renderRecord(null,'SIM overview unavailable: '+(e.message||e)));
    }
    function openInspector(g,pin=false){
      clearTimeout(inspectorHideTimer);
      if(inspectorGroup===g&&pin&&inspectorPinned){closeInspector();return;}
      inspectorPinned=pin||inspectorPinned&&inspectorGroup===g;
      if(inspectorGroup===g&&ui.inspector.style.display==='flex')return;
      inspectorGroup=g;
      ui.inspector.replaceChildren();
      const head=mk('div',null,'dr-insp-head');
      const label=mk('strong',(g.identifierGroup?g.identifierLabel:g.asin?'ASIN '+g.asin:'Exact SIM title')+' · '+g.tickets.length+' tickets');
      const close=btn('Close',closeInspector);close.className='dr-insp-close';
      head.append(label,close);
      const layout=mk('div',null,'dr-insp-layout'),nav=mk('nav',null,'dr-insp-nav'),doc=mk('div',null,'dr-insp-detail');
      const keep=mk('div','0 = oldest · protected','dr-insp-label');nav.append(keep);
      for(let i=0;i<g.tickets.length;i++){
        const t=g.tickets[i],row=mk('div',null,'dr-insp-item');
        const trigger=btn(i===0?'0 · Oldest':'#'+i+' · Newer',()=>inspectorTicket(g,t,i,trigger));
        trigger.title='Hover for full ticket overview';
        trigger.addEventListener('mouseenter',()=>inspectorTicket(g,t,i,trigger));
        trigger.addEventListener('focus',()=>inspectorTicket(g,t,i,trigger));
        const a=mk('a','↗');a.href=SIM+t.id;a.target='_blank';a.rel='noopener noreferrer';a.title='Open SIM ticket '+t.id;
        row.append(trigger,a);nav.append(row);
      }
      layout.append(nav,doc);ui.inspector.append(head,layout);ui.inspector.style.display='flex';
      inspectorTicket(g,g.oldest,0,nav.querySelector('button'));
    }
    ui.inspector.addEventListener('mouseenter',()=>clearTimeout(inspectorHideTimer));
    ui.inspector.addEventListener('mouseleave',queueInspectorHide);
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&inspectorGroup)closeInspector();});
    // Durable write-intent barrier survives refresh. Never replay an uncertain mutation.
    const MARK='BWU2_DR_ATTEMPT_';
    function stage(id){
      try{const v=localStorage.getItem(MARK+id);if(v){try{return JSON.parse(v).phase||'unknown';}catch(_){return v;}}}catch(_){}
      try{return sessionStorage.getItem(MARK+id)||'';}catch(_){return '';
      }
    }
    function attempted(id){return !!stage(id)||state.attempted.has(id);}
    function mark(id,phase){state.attempted.add(id);try{localStorage.setItem(MARK+id,JSON.stringify({phase,at:new Date().toISOString()}));}catch(_){}try{sessionStorage.setItem(MARK+id,phase);}catch(_){}}
    function comment(master){return 'Hi Team,\n\nResolving due to duplicate TT.\n\nRef: '+SIM+master.id+'\n\nRegards';}
    function request(url,operationName,query,variables){return new Promise((resolve,reject)=>{
      if(typeof GM_xmlhttpRequest!=='function'){reject(Error('Tampermonkey network permission unavailable.'));return;}
      let ended=false;const done=(cb,x)=>{if(!ended){ended=true;cb(x);}};
      try{GM_xmlhttpRequest({method:'POST',url,anonymous:false,withCredentials:true,timeout:30000,
        headers:{'Content-Type':'application/json',Accept:'application/json',...(url===GRAPH?{Origin:'https://t.corp.amazon.com',Referer:'https://t.corp.amazon.com/'}:{})},
        data:JSON.stringify({operationName,query,variables}),
        onload:r=>{if(!r||r.status!==200)return done(reject,Error('HTTP '+(r?r.status:0)+' — stop; check manually.'));
          try{const j=JSON.parse(r.responseText);if(j.errors&&j.errors.length)return done(reject,Error(j.errors.map(e=>e.message).join('; ')));if(!j.data)return done(reject,Error('Empty GraphQL reply.'));done(resolve,j.data);}catch(e){done(reject,e);}},
        onerror:()=>done(reject,Error('Network error — uncertain result. No retry.')),
        ontimeout:()=>done(reject,Error('Timeout — uncertain result. No retry.'))});
      }catch(e){done(reject,e);}
    });}
    function sim(name,query,variables){return request(GRAPH,name,query,variables);}
    function wave(){return request(WAVE,'generateCsv','query generateCsv($warehouseId: String!, $signalProcess: String!) { generateCsv(warehouseId: $warehouseId, signalProcess: $signalProcess) }',{warehouseId:FC,signalProcess:'ISS'});}
    // Read-only request using the same browser credentials. The browser may establish
    // SSO cookies on the redirect chain, but page JavaScript will NOT execute here;
    // interactive SSO cannot be silently bypassed and still needs a normal browser tab.
    function warmWaveSession(){return new Promise(resolve=>{
      if(typeof GM_xmlhttpRequest!=='function'){resolve('Tampermonkey network unavailable');return;}
      let done=false;const finish=msg=>{if(!done){done=true;resolve(msg);}};
      try{GM_xmlhttpRequest({method:'GET',url:WAVE_PAGE,anonymous:false,withCredentials:true,timeout:12000,
        headers:{Accept:'text/html'},
        onload:r=>finish(r&&r.status>=200&&r.status<400?'Wave page responded':'Wave page returned HTTP '+(r?.status||0)),
        onerror:()=>finish('Wave page network error'),ontimeout:()=>finish('Wave page timeout')});
      }catch(_){finish('Wave page initialisation unavailable');}
    });}
    async function fetchWaveData(){
      if(state.busy||state.waveBusy)return;
      state.waveBusy=true;ui.fetch.disabled=true;
      try{
        status('Starting Wave session (read-only)…');
        const session=await warmWaveSession();
        status('Fetching BWU2 Wave data… ('+session+')');
        // Exactly one GraphQL CSV fetch: no blind retries or authentication bypass.
        const d=await wave();
        if(typeof d.generateCsv!=='string')throw Error('Wave did not return CSV text.');
        setData(d.generateCsv,'Wave API (BWU2)',true);
      }catch(e){
        status('Wave startup failed: '+(e.message||e)+'. If Wave needs interactive SSO, open Wave normally and retry. No automatic retries.',true);
      }finally{state.waveBusy=false;ui.fetch.disabled=false;}
    }
    function csvRows(input){const s=String(input).replace(/^\uFEFF/,'');const delim=s.split(/\r?\n/,1)[0].includes('\t')?'\t':',';const out=[];let fields=[],val='',quote=false;
      for(let i=0;i<s.length;i++){const c=s[i];if(c==='"'){if(quote&&s[i+1]==='"'){val+='"';i++;}else quote=!quote;}
        else if(c===delim&&!quote){fields.push(val);val='';}
        else if((c==='\r'||c==='\n')&&!quote){if(c==='\r'&&s[i+1]==='\n')i++;fields.push(val);val='';if(fields.some(has))out.push(fields);fields=[];}
        else val+=c;}
      if(quote)throw Error('Invalid CSV quoting.');fields.push(val);if(fields.some(has))out.push(fields);return out;}
    function dateMs(v){const m=clean(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i);if(!m)return null;
      const [month,day,year,h,min,sec]=m.slice(1,7).map(Number);if(month<1||month>12||day<1||day>31||h<1||h>12||min>59||sec>59)return null;
      const d=new Date(Date.UTC(year,month-1,day,(h%12)+(m[7].toUpperCase()==='PM'?12:0),min,sec));return d.getUTCMonth()===month-1&&d.getUTCDate()===day&&d.getUTCFullYear()===year?d.getTime():null;}
    // Wave Item is a workflow label, not the individual SIM title. This map is a UI
    // classification only: duplicate keys still include the original exact Wave Item.
    // Unrecognised future Items fall into General / Misc for visible review.
    const FILTER_GROUPS=[
      ['ermr','ERMR / ERDR',false],['wave','WAVE Kickout',true],
      ['seller','FBA Seller',true],['recv','Receiving / Liquidation',true],
      ['inbound','FBA Missing from Inbound',false],['bins','Bin Checks',true],
      ['quality','Quality / Investigations',true],['expiry','Expiration / Food',true],
      ['catalog','Catalog / Barcode / Labels',true],['wheres',"Where's My Stuff",false],
      ['general','General / Misc',true],['cubi','Cubiscan',true]
    ];
    const ITEM_TO_GROUP=new Map();
    function mapItems(key,names){for(const name of names.split('|'))ITEM_TO_GROUP.set(lower(name),key);}
    mapItems('ermr','ERMR Sample - Australia|ERDR');
    mapItems('wave','WAVE Kickout - No Inventory|WAVE Kickout - Reopened Ticket|WAVE Kickout - Unprocessable|WAVE Kickout - Unsafe to Process|WAVE Kickout - Unsupported Container');
    mapItems('seller','FBA Seller - Reserved Inventory|FBA Seller - Suspected Receive Error|FBA Seller - Customer Reported Defect|FBA Seller - Prep Verification|FBA Seller - Expiration Date|FBA Seller - ASIN Flip/Relabel|FBA Seller - Missing From Inbound|FBA Seller - Catalog Change');
    mapItems('recv','Problem Receive Liquidation|Adjust Receive|Removals Pipeline|No PO Found|FC Inbound Issue|FC Outbound Issue');
    mapItems('inbound','FBA Missing from Inbound');
    mapItems('bins','FBA Bin Check|check item in bin|Global Product Verification Bin Check|Accounts Payable Bin Check|Bin Check Request|Authentication Verification Bin Check|Expiration Date Bin Check');
    mapItems('quality','High Value MFI Physical Search Request|Wrong Item - ACBC|FBA - Item Integrity|Damage - ACBC|Wrong Quantity of Units - ACBC|FBA - CT Insert Abuse Investigation|FBA BC Warehouse Dmg|C-Ops - Conflicting Detail Pages|Missing Item');
    mapItems('expiry','Expiration Date Issue|Add/Remove Expiration/Food Flag|Expiry - ACBC|Add/Remove Expiration Flag|ACES Escalation - Expiration Date Inspection');
    mapItems('catalog','Item Not In Catalog|Title Update|Barcode not linked|Misleading/Conflicting DP - ACBC|Barcode links multiple ASIN|FBA Item Label Mis-labeled|ASIN FLIP|Image Update|Item Label Issue');
    mapItems('wheres','Wheres My Stuff');
    mapItems('general','ISS-BWU2:General Request|General Request|SDS Request');
    mapItems('cubi','Seller Reimbursement Cubiscan Escalation|FBA-Cubiscan Item|Cubiscan Escalation');
    function filterKey(item){return ITEM_TO_GROUP.get(lower(item))||(lower(item).includes('erdr')||lower(item).includes('ermr')?'ermr':lower(item).startsWith('wave kickout')?'wave':lower(item).startsWith('fba seller -')?'seller':'general');}
    const FILTER_STORAGE='BWU2_DR_FILTERS_v1';
    function readFilterPrefs(){
      let saved={};try{saved=JSON.parse(localStorage.getItem(FILTER_STORAGE)||'{}')||{};}catch(_){}
      const cats=Object.fromEntries(FILTER_GROUPS.map(([k,,on])=>[k,typeof saved.cats?.[k]==='boolean'?saved.cats[k]:on]));
      const hide=Object.fromEntries(['ILAC','ERDR','ERMR','RPI'].map(k=>[k,typeof saved.hide?.[k]==='boolean'?saved.hide[k]:true]));
      return {cats,hide,items:saved.items&&typeof saved.items==='object'?saved.items:{}};
    }
    let filterPrefs=readFilterPrefs();
    function saveFilterPrefs(){try{localStorage.setItem(FILTER_STORAGE,JSON.stringify(filterPrefs));}catch(_){}}
    function itemVisible(item){const key=lower(item);const override=filterPrefs.items[key];return typeof override==='boolean'?override:!!filterPrefs.cats[filterKey(item)];}
    function titleExcluded(title){return (filterPrefs.hide.ILAC&&/\bILAC\b/i.test(title))||(filterPrefs.hide.ERDR&&/\bERDR\b/i.test(title))||(filterPrefs.hide.ERMR&&/\bERMR\b/i.test(title))||(filterPrefs.hide.RPI&&/\bRPIs?\b/i.test(title));}
    function eligibleForClosure(g){return !g.identifierGroup&&!g.requiresManualIdentifier&&!g.blankAsinFallback&&isOurWaveRow(g.cat,g.type,g.item);}
    function groupVisible(g){return g.identifierGroup?g.tickets.every(t=>itemVisible(t.item)):itemVisible(g.item);}
    // Explicit task lane, not a loosely labelled Category=iss; WAVE Kickout/ERDR/ICQA excluded.
    const ISS_ITEM_RE=/^(fba(?:[ -].+)|bin check request|check item in bin|expiration date bin check|global product verification bin check)$/i;
    function isOurWaveRow(cat,type,item){
      const c=lower(cat),t=lower(type),i=lower(item);
      if(/(?:\berdr\b|\bermr\b|\bicqa\b|wave kickout|random sample)/i.test([c,t,i].join(' ')))return false;
      if(c==='distribution center'&&t==='iss-bwu2')return true;
      return c==='iss'&&t==='retail request'&&ISS_ITEM_RE.test(i);
    }
    function parseWave(csv){const rows=csvRows(csv);if(rows.length<2)throw Error('Wave CSV is empty.');const heads=rows[0].map(x=>lower(x).replace(/[\s_-]+/g,''));
      const required=['category','type','item','issueid','sla','binid','sku','asin'];for(const k of required)if(!heads.includes(k))throw Error('Missing Wave column '+k);
      const idx=Object.fromEntries(heads.map((x,i)=>[x,i]));const get=(r,k)=>clean(r[idx[k]]);
      const groups=new Map(),itemCounts=new Map(),entries=[];let skipped=0,blank=0,total=0,excluded=0,fallback=0;
      for(const r of rows.slice(1)){
        total++;const id=get(r,'issueid'),bin=get(r,'binid'),type=get(r,'type'),cat=get(r,'category'),item=get(r,'item'),sku=get(r,'sku'),asin=get(r,'asin'),status0=get(r,'status');
        // Explicit requested exception: drop Wave type BWU2-ICQA from discovery.
        if(lower(type)==='bwu2-icqa'){excluded++;continue;}
        if(!UUID.test(id)||![type,cat,item].every(has)){skipped++;continue;}
        const n=lower(item);if(!itemCounts.has(n))itemCounts.set(n,{name:item,count:0});itemCounts.get(n).count++;
        if(!has(bin))blank++;
        if(/^(resolved|closed|cancelled|canceled|deleted)$/i.test(status0))continue;
        const blankAsinFallback=!has(asin);
        if(blankAsinFallback)fallback++;
        const t={id,status:status0,created:get(r,'sla'),ms:dateMs(get(r,'sla')),bin:has(bin)?bin:'',sku:has(sku)?sku:'',asin:has(asin)?asin:'',item,cat,type};
        entries.push(t);
        // Same Wave category, type, and exact Item must match. The 12 filter
        // categories NEVER merge different workflow Items together.
        const key=[FC,cat,type,item,blankAsinFallback?'NO_ASIN_USE_EXACT_SIM_TITLE':asin].map(lower).join('\u001f');
        if(!groups.has(key))groups.set(key,{item,cat,type,asin:blankAsinFallback?'':asin,blankAsinFallback,tickets:[]});
        const g=groups.get(key);
        if(!g.tickets.some(x=>lower(x.id)===lower(id)))g.tickets.push(t);
      }
      const result=[...groups.values()].filter(g=>g.tickets.length>1).map(g=>{
        g.tickets.sort((a,b)=>(a.ms===null?Infinity:a.ms)-(b.ms===null?Infinity:b.ms));
        g.oldest=g.tickets[0];g.orderOk=g.tickets.every(t=>t.ms!==null)&&g.tickets[0].ms!==g.tickets[1].ms;
        const bins=[...new Set(g.tickets.map(t=>lower(t.bin)).filter(has))];g.bin=bins.length===0?'':bins.length===1?g.tickets.find(t=>has(t.bin)).bin:'VARIES';
        g.sku=[...new Set(g.tickets.map(t=>lower(t.sku)).filter(has))].length===1?g.tickets.find(t=>has(t.sku)).sku:'VARIES';
        return g;
      });result.sort((a,b)=>b.tickets.length-a.tickets.length||a.item.localeCompare(b.item));
      return {groups:result,entries,itemCounts,total,blank,skipped,excluded,fallback,identityRecords:new Map(),identifierGroups:[]};
    }
    async function readTicket(t){
      const data=await sim('issueOverview',Q_ISSUE,{issueId:t.id});const issue=data?.issue;
      if(!issue||lower(issue.id)!==lower(t.id))throw Error('SIM returned a different/missing ticket.');
      const assignedGroup=issue.extensions?.tt?.assignedGroup;
      // Fail closed on missing, unexpected or non-ISS assignments. No fallback guessing.
      const owner=typeof assignedGroup==='string'?lower(assignedGroup):'';
      return {ticket:t,issue,owner};
    }
    function verifyPair(a,b,g){
      const problems=[],warnings=[];const older=a.ticket,newer=b.ticket;
      if(older.id===newer.id||!g.orderOk||older.ms===null||newer.ms===null||older.ms>=newer.ms)problems.push('Oldest/newer order cannot be verified.');
      const productConflict=explicitProductConflict(a,b);if(productConflict)problems.push(productConflict);
      for(const [name,x] of [['Oldest',a],['Newer',b]]){
        if(x.owner!=='iss-bwu2')problems.push(name+' SIM group is '+(x.owner||'UNVERIFIED')+' (required ISS-BWU2).');
        const item=lower(x.issue.extensions?.tt?.item);if(has(item)&&item!==lower(g.item))problems.push(name+' SIM workflow disagrees with Wave.');
        if(has(x.issue.extensions?.tt?.closureCode))problems.push(name+' already has a closure code.');
        if(/\b(erdr|ermr|icqa)\b|random sample/i.test(clean(x.issue.title)))problems.push(name+' ticket belongs to an excluded workflow.');
        const text=clean(x.issue.description);const explicit=text.match(/^\s*ASIN\s*:\s*(\S+)/im);
        if(explicit&&lower(explicit[1])!==lower(g.asin))warnings.push(name+' description ASIN differs from Wave (informational).');
      }
      const identity=identityVerdict(a,b,g,false);problems.push(...identity.problems);warnings.push(...identity.warnings);
      // Location is informational for this same-ASIN ISS workflow, even when bins differ.
      if(has(older.bin)&&has(newer.bin)&&lower(older.bin)!==lower(newer.bin))warnings.push('Different Wave bins (informational).');
      const places=[a.issue.extensions?.tt?.physicalLocation,b.issue.extensions?.tt?.physicalLocation];
      for(let i=0;i<2;i++)if(has(places[i])&&has([older.bin,newer.bin][i])&&lower(places[i])!==lower([older.bin,newer.bin][i]))warnings.push((i?'Newer':'Oldest')+' SIM/Wave location differs (informational).');
      if(has(places[0])&&has(places[1])&&lower(places[0])!==lower(places[1]))warnings.push('Different SIM locations (informational).');
      if(!has(older.bin)||!has(newer.bin))warnings.push('Bin not provided (informational).');
      if(!has(a.issue.title)||!has(b.issue.title))problems.push('SIM title missing.');
      if(titleExcluded(a.issue.title)||titleExcluded(b.issue.title))problems.push('SIM title excluded by active filter.');
      if(isIlacGroup(g)&&titleKey(a.issue.title)!==titleKey(b.issue.title))problems.push('ILAC SIM titles differ — not duplicate shipments.');
      else if(lower(a.issue.title)!==lower(b.issue.title))warnings.push('SIM titles differ; verify ASIN and workflow.');
      return {ok:!problems.length,problems,warnings};
    }
    // Manual override changes ONLY the matching-confidence threshold.
    // It NEVER bypasses ticket identity, chronological master ordering, active
    // closure state, excluded titles, or live ISS ownership verification.
    function verifyManualPair(a,b,g){
      const problems=[],warnings=[],older=a.ticket,newer=b.ticket;
      if(older.id===newer.id||!g.orderOk||older.ms===null||newer.ms===null||older.ms>=newer.ms)problems.push('Oldest/newer ticket order cannot be verified.');
      const productConflict=explicitProductConflict(a,b);if(productConflict)problems.push(productConflict);
      for(const [name,x] of [['Oldest',a],['Newer',b]]){
        if(x.owner!=='iss-bwu2')problems.push(name+' is assigned to '+(x.owner||'UNVERIFIED')+'; manual resolution requires ISS-BWU2 ownership.');
        if(has(x.issue.extensions?.tt?.closureCode))problems.push(name+' already has a closure code.');
        if(!has(x.issue.title))problems.push(name+' SIM title unavailable.');
        if(titleExcluded(x.issue.title))problems.push(name+' title excluded by active filters.');
        const item=lower(x.issue.extensions?.tt?.item);
        if(!g.identifierGroup&&has(item)&&item!==lower(g.item))warnings.push(name+' SIM workflow differs from Wave.');
      }
      const identity=identityVerdict(a,b,g,true);problems.push(...identity.problems);warnings.push(...identity.warnings);
      if(titleKey(a.issue.title)!==titleKey(b.issue.title))warnings.push('SIM titles are different. Confirm these really are duplicates.');
      if(has(older.bin)&&has(newer.bin)&&lower(older.bin)!==lower(newer.bin))warnings.push('Wave bins are different.');
      if(!has(older.bin)||!has(newer.bin))warnings.push('One or both Wave bins are missing.');
      if(!g.asin)warnings.push(g.identifierGroup?'Wave ASIN differs/missing; matched by stronger identifiers.':'Wave ASIN is blank; matched by SIM/strong identifier.');
      if(!eligibleForClosure(g))warnings.push('This workflow is discovery-only for automatic resolution; MANUAL CONFIRMATION REQUIRED.');
      return {ok:!problems.length,problems,warnings};
    }
    function confirmManual(g,oldest,review){
      return new Promise(resolve=>{
        const overlay=mk('div');overlay.id='bwu-dr-manual-overlay';
        const dialog=mk('div',null,'dr-manual-dialog');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
        dialog.setAttribute('aria-label','Confirm manual newer-ticket resolution');
        dialog.append(mk('h3','Manual Resolve — final confirmation'));
        dialog.append(mk('div','OLDEST — KEEP OPEN: '+oldest.ticket.id+' · '+clean(oldest.issue.title),'dr-manual-ticket'));
        const alert=mk('div','You are overriding automatic matching for this group. Only the '+review.length+' listed NEWER ticket(s) will receive a duplicate comment and closure. The oldest ticket always stays open. This cannot be automatically undone.','dr-manual-alert');dialog.append(alert);
        for(const record of review){
          const line=mk('div',null,'dr-manual-ticket');
          line.append(mk('strong','RESOLVE NEWER: '+record.ticket.id),mk('div',record.title),mk('div','SIM owner: '+record.owner));
          if(record.warnings.length)line.append(mk('div','CHECK: '+record.warnings.join(' · '),'dr-manual-alert'));
          dialog.append(line);
        }
        const actions=mk('div',null,'dr-manual-buttons');
        const cancel=btn('Cancel — no changes',()=>finish(false));
        const accept=btn('Confirm resolve '+review.length+' newer '+(review.length===1?'ticket':'tickets'),()=>finish(true));
        accept.className='dr-manual-confirm';actions.append(cancel,accept);dialog.append(actions);overlay.append(dialog);
        const onKey=e=>{if(e.key==='Escape'){e.preventDefault();finish(false);}};
        const finish=choice=>{window.removeEventListener('keydown',onKey,true);overlay.remove();resolve(choice);};
        window.addEventListener('keydown',onKey,true);document.body.append(overlay);cancel.focus();
      });
    }
    async function readback(t){
      let issue;try{issue=(await sim('issueOverview',Q_AFTER,{issueId:t.id}))?.issue;}
      catch(_){try{issue=(await sim('issueOverview',Q_AFTER_FALLBACK,{issueId:t.id}))?.issue;}catch(e){return {ok:false,reason:'Read-back failed.'};}}
      if(lower(issue?.id)!==lower(t.id))return {ok:false,reason:'Read-back ticket ID mismatch.'};
      if(lower(issue?.extensions?.tt?.closureCode)!=='duplicate')return {ok:false,reason:'Closure code not confirmed as Duplicate.'};
      const s=typeof issue.status==='string'?lower(issue.status):lower(issue.status?.name||issue.status?.value||'');
      if(s!=='resolved')return {ok:false,reason:'Resolution status not confirmed ('+(s||'unavailable')+').'};
      return {ok:true,reason:'Resolved + Duplicate confirmed.'};
    }
    // Normal supported ISS groups: one click. Discovery-only groups: manual two-step
    // preflight + explicit confirmation. Oldest is NEVER resolved; no global batch.
    // In-flight mutations are never aborted or retried. A Stop click only prevents
    // the NEXT mutation, and all started ticket IDs survive refresh in write markers.
    function runGroup(g,manual=false){
      if(!state.data?.verified||state.busy||!g.orderOk||g.closureBlocked||isIgnored(g)||(!manual&&!eligibleForClosure(g))||!groupVisible(g))return;
      if(g.tickets.some(t=>titleExcluded(g.titles?.get(t.id)||'')))return;
      if(groupProductConflict(g))return; // Known different SIM ASINs cannot start closure.
      if(!manual&&g.tickets.every(t=>g.titles?.has(t.id))&&new Set(g.tickets.map(t=>titleKey(g.titles.get(t.id)))).size>1)return; // Different titles require manual confirmation.
      const master=g.oldest,candidates=g.tickets.slice(1).filter(t=>!attempted(t.id));
      if(!candidates.length)return;
      const loaded=state.data;
      const run={group:g,phase:'checking',stopRequested:false};
      hidePreview();state.busy=true;state.active=run;
      g.progress=(manual?'Manual override: ':'')+'Checking SIM identity and ISS ownership…';g.runError=false;
      if(!g.outcomes)g.outcomes=new Map();
      for(const t of candidates)g.outcomes.set(t.id,{text:'Pending verification',kind:'dr-pending'});
      render();
      const update=(t,message,kind='dr-pending')=>{
        g.outcomes.set(t.id,{text:message,kind});
        const node=g.view?.rows.get(t.id);
        if(node){node.textContent=message;node.className=kind;}
      };
      const info=(message,error=false)=>{
        g.progress=message;g.runError=error;
        const node=g.view?.progress;
        if(node){node.textContent=message;node.className='dr-progress'+(error?' dr-error':'');}
      };
      const task=(async()=>{
        const passed=[],manualReview=[];let skipped=0,done=0,active=null;
        const oldest=await readTicket(master);
        previewCache.set(master.id,oldest); // Display-only; mutations always use fresh reads.
        g.simTitle=clean(oldest.issue.title)||g.item;
        setTitle(g,master,oldest);
        for(const t of candidates){
          if(run.stopRequested)break;
          try{
            const newer=await readTicket(t);
            previewCache.set(t.id,newer); // Show fresh contradictions to the reviewer.
            setTitle(g,t,newer);
            const verdict=manual?verifyManualPair(oldest,newer,g):verifyPair(oldest,newer,g);
            if(verdict.ok){passed.push(t);if(manual)manualReview.push({ticket:t,title:clean(newer.issue.title),owner:newer.owner,warnings:verdict.warnings});update(t,verdict.warnings.length?'Verified · '+verdict.warnings.join('; '):'Verified · ready');}
            else{skipped++;update(t,'SKIPPED · '+verdict.problems.join('; '),'dr-error');}
          }catch(e){skipped++;update(t,'SKIPPED · '+(e.message||String(e)),'dr-error');}
          info('Verified '+passed.length+' / '+candidates.length+' · skipped '+skipped);
        }
        // Do not write a partial group when any newer ticket fails fresh checks.
        if(skipped){
          for(const t of passed)update(t,'NOT STARTED · group verification inconsistent','dr-error');
          info('BLOCKED · '+skipped+' newer tickets failed checks · no writes started',true);
          return;
        }
        if(loaded!==state.data)throw Error('Wave data changed. No writes started.');
        if(run.stopRequested){for(const t of passed)update(t,'NOT STARTED · cancelled');info('CANCELLED before writes · oldest untouched');return;}
        if(!passed.length){info('No eligible newer tickets · '+skipped+' skipped · no changes');return;}
        if(manual){
          run.phase='confirming';info('Manual preflight complete · waiting for explicit confirmation');render();
          const confirmed=await confirmManual(g,oldest,manualReview);
          if(!confirmed||run.stopRequested){for(const t of passed)update(t,'NOT STARTED · manual confirmation cancelled');info('Manual review cancelled · no changes · oldest untouched');return;}
          if(loaded!==state.data||isIgnored(g)||!groupVisible(g))throw Error('Wave group or filters changed. No writes started.');
        }
        run.phase='writing';render();
        for(const t of passed){
          if(run.stopRequested){update(t,'NOT STARTED · stopped');continue;}
          if(attempted(t.id)){skipped++;update(t,'SKIPPED · previously attempted','dr-error');continue;}
          active=t;
          // Write-intent marker MUST precede the first mutation. No automatic replay.
          previewCache.delete(t.id);mark(t.id,'comment_started');update(t,'Adding reference comment…');
          info('Processing '+(done+1)+'/'+passed.length+' · comment on '+t.id.slice(0,8)+'…');
          const c=await sim('createCommentOnThread',Q_COMMENT,{args:{threadId:'updates:'+t.id,contentType:'text/plain',message:comment(master),mentions:[]}});
          if(!c?.createCommentGetComment?.id)throw Error('Comment acknowledgement uncertain for '+t.id);
          mark(t.id,'comment_confirmed');mark(t.id,'resolve_started');update(t,'Resolving ticket…');
          const x=await sim('editIssue',Q_CLOSE,{args:{issueId:t.id,rootCause:{value:ROOT_CAUSE,details:'BWU2_SIM_Duplicate_Review'},closureCode:'Duplicate',status:'Resolved'}});
          if(lower(x?.editIssue?.id)!==lower(t.id)||lower(x?.editIssue?.extensions?.tt?.closureCode)!=='duplicate')throw Error('Closure acknowledgement uncertain for '+t.id);
          mark(t.id,'resolve_acknowledged');update(t,'Checking SIM resolution…');
          const result=await readback(t);
          if(!result.ok)throw Error('SIM read-back NOT VERIFIED for '+t.id+': '+result.reason);
          mark(t.id,'verified');update(t,'VERIFIED RESOLVED','dr-good');active=null;done++;
        }
        info((run.stopRequested?'STOPPED':'COMPLETE')+' · '+done+' verified resolved · '+skipped+' skipped · oldest untouched');
        status((g.identifierGroup?g.identifierLabel:'ASIN '+g.asin)+': '+done+' verified resolved; oldest untouched.');
      })();
      task.catch(e=>{
        const message=e.message||String(e);
        for(const t of candidates){
          const current=g.outcomes.get(t.id)?.text||'';
          if(current.startsWith('Verified ·'))update(t,'NOT STARTED · stopped after error','dr-error');
          else if(current.startsWith('Adding reference')||current.startsWith('Resolving')||current.startsWith('Checking SIM resolution'))update(t,'NOT VERIFIED · inspect SIM before retry','dr-error');
        }
        info('STOP · '+message+' · No automatic write retries.',true);
        status('STOP '+(g.identifierGroup?g.identifierLabel:'ASIN '+g.asin)+': '+message,true);
      }).finally(()=>{state.active=null;state.busy=false;render();if(state.idScan?.started&&!state.idScan.done)resumeIdentityScan();else warmTitles(state.data);});
    }
    function render(){
      hidePreview();ui.results.replaceChildren();
      if(!state.data){ui.stats.textContent='Fetch BWU2 from Wave or load an ISS CSV.';closeInspector();return;}
      const groups=filteredGroups();updateAutoProgress(groups.length);
      const wrap=mk('div',null,'dr-grid'),table=mk('table',null,'dr-compact');
      const head=mk('tr');for(const label of ['Product / workflow','Oldest · KEEP','Newer','Comparison / status','Inspect & actions'])head.append(mk('th',label));
      table.append(head);
      for(const g of groups){
        g.view={rows:new Map(),titles:new Map(),owners:new Map(),rpis:new Map(),progress:null,warning:null};
        const row=mk('tr');
        const product=mk('td'),primary=mk('div',g.identifierGroup?g.identifierLabel:g.asin||'Exact SIM title match','dr-asin');
        product.append(primary,mk('div',g.item+(g.identifierGroup?' · '+g.cat:''),'dr-small'));
        if(g.rpiKey)product.append(mk('div',g.rpiKey.split(',').length+' identical RPIs (order independent)','dr-small'));
        const oldest=mk('td'),keep=mk('a',g.oldest.id.slice(0,8)+'…');
        keep.href=SIM+g.oldest.id;keep.target='_blank';keep.rel='noopener noreferrer';keep.title=g.oldest.id;
        oldest.append(keep,mk('div','Protected original · '+dateOnly(g.oldest.created),'dr-small'));
        const newer=mk('td');
        const pend=g.tickets.slice(1).filter(t=>!attempted(t.id));
        newer.append(mk('strong',String(pend.length)+' newer'));
        const completed=g.tickets.slice(1).filter(t=>stage(t.id)==='verified').length;
        if(completed)newer.append(mk('div',completed+' already resolved','dr-small'));
        const evidence=mk('td');
        const conflict=groupProductConflict(g);
        const titles=g.tickets.map(t=>clean(g.titles?.get(t.id)));
        const differs=titles.every(Boolean)&&new Set(titles).size>1;
        const waiting=g.tickets.some(t=>!g.titles?.has(t.id));
        const unsafe=!!conflict||!g.orderOk||!!g.closureBlocked;
        const finished=g.tickets.slice(1).every(t=>stage(t.id)==='verified');
        const allAttempted=g.tickets.slice(1).every(t=>attempted(t.id));
        const health=mk('div',finished?'COMPLETE · all newer tickets verified resolved':allAttempted?'ATTEMPTED · inspect SIM before retry':conflict?'BLOCKED · '+conflict:!g.orderOk?'Original ordering uncertain':g.closureBlocked?'Blocked · '+(g.closureBlockReason||'manual investigation required'):waiting?'Loading SIM ticket overviews…':differs?'SIM titles differ · inspect':g.identifierGroup?'Matching identifier · manual review':'Candidate · inspect before resolution',unsafe||differs||allAttempted?'dr-risk':'dr-ok');
        evidence.append(health);
        const outcomes=g.tickets.slice(1).map(t=>g.outcomes?.get(t.id)?.text).filter(Boolean);
        if(outcomes.length)evidence.append(mk('div',outcomes.length+' ticket updates · inspect individual tickets','dr-small'));
        const actions=mk('td',null,'dr-actions-cell');
        const inspect=btn('Inspect '+g.tickets.length,()=>openInspector(g,true));inspect.className='dr-mini';
        inspect.title='Hover to review oldest and every newer SIM ticket';
        inspect.addEventListener('mouseenter',()=>openInspector(g));inspect.addEventListener('mouseleave',queueInspectorHide);
        inspect.addEventListener('focus',()=>openInspector(g));actions.append(inspect);
        if(g.orderOk&&state.data.verified&&pend.length&&!g.closureBlocked&&!conflict){
          if(eligibleForClosure(g)&&!differs){
            const b=btn('Resolve '+pend.length,()=>runGroup(g));b.className='dr-primary';b.title='Fresh SIM verification before any comment or closure';b.disabled=state.busy||waiting;actions.append(b);
          }else{
            const b=btn('Manual review',()=>runGroup(g,true));b.className='dr-manual';b.disabled=state.busy||waiting;actions.append(b);
          }
        }
        const ignore=btn('Ignore',()=>ignoreGroup(g));ignore.className='dr-muted-button';ignore.disabled=state.busy;actions.append(ignore);
        if(state.active?.group===g){
          const stop=btn(state.active.stopRequested?'Stopping…':state.active.phase==='checking'?'Cancel checks':state.active.phase==='confirming'?'Cancel manual review':'Stop after current',()=>{
            if(state.active?.group!==g)return;state.active.stopRequested=true;g.progress='Stop requested · will not start another write';render();
          });stop.disabled=state.active.stopRequested;actions.append(stop);
        }
        const progress=mk('div',g.progress||'','dr-small'+(g.runError?' dr-error':''));g.view.progress=progress;actions.append(progress);
        row.append(product,oldest,newer,evidence,actions);table.append(row);
      }
      wrap.append(table);ui.results.append(wrap);
    }
    function updateAutoProgress(displayed){
      if(!state.data)return;
      const p=autoTitleProgress();
      const ready=displayed===undefined?filteredGroups().length:displayed;
      ui.stats.textContent=state.data.total+' Wave rows · '+state.data.excluded+' BWU2-ICQA type excluded · '+ready+' candidate groups after title filters · '+state.data.fallback+' blank-ASIN rows';
      const networkSeconds=Math.max(.001,(performance.now()-titleLane.started)/1000);
      const rate=(titleLane.completed/networkSeconds).toFixed(1);
      const durations=titleLane.recent.slice().sort((a,b)=>a-b);
      const p95=durations.length?Math.round(durations[Math.ceil(durations.length*.95)-1]):0;
      const metrics=' · '+rate+' network reads/s · p95 '+p95+'ms · '+titleWorkers+' active / '+titleLane.limit+' target';
      if(ui.autoProgress)ui.autoProgress.textContent=p.done<p.total?'Checking SIM titles: '+p.done+'/'+p.total+' tickets'+metrics+(p.failed?' · '+p.failed+' unavailable':'') : 'SIM title checks: '+p.done+'/'+p.total+' completed'+metrics+(p.failed?' · '+p.failed+' unavailable':'');
    }
    function updateIgnoredUI(){
      if(!ui.ignoredList)return;
      ui.ignoredToggle.textContent='▸ Ignored groups ('+ignoredGroups.size+') — restore';
      ui.ignoredList.replaceChildren();
      for(const [key,details] of ignoredGroups){
        const row=mk('div',null,'dr-ignored-entry'),label=mk('span',details?.label||'Ignored group'),restore=btn('Restore',()=>{
          if(state.busy)return;
          ignoredGroups.delete(key);saveIgnored();updateIgnoredUI();render();warmTitles(state.data);
        });
        row.append(label,restore);ui.ignoredList.append(row);
      }
      if(!ignoredGroups.size)ui.ignoredList.append(mk('div','No ignored groups.'));
    }
    function setData(csv,source,verified){
      if(state.busy)throw Error('Cannot load data during a SIM write.');
      const data=parseWave(csv);hidePreview();closeInspector();previewCache.clear();titleQueue.length=0;queuedTitles.clear();titleLane=newReadLane(8);state.idScan=null;viewGroups.clear();if(ui.identityScan)ui.identityScan.disabled=false;scanStatus('Optional: scan selected Wave tickets for shared EAN/UPC across titles.');
      data.verified=!!verified;data.source=source;state.data=data;
      status('Loaded '+source+'. SIM titles/owners checked automatically for candidates. Existing ISS one-click closures unchanged; other ISS-owned workflows allow two-step manual review.');
      updateFilters();render();warmTitles(data);
    }
    function updateFilters(){
      if(!ui.filterPane)return;
      const counts=new Map(FILTER_GROUPS.map(([k])=>[k,0]));
      const d=state.data;
      if(d)for(const {name,count} of d.itemCounts.values())counts.set(filterKey(name),(counts.get(filterKey(name))||0)+count);
      for(const [key,node] of ui.categoryCounts)node.textContent=(counts.get(key)||0).toLocaleString();
      const rawEntries=d?[...d.itemCounts.values()].sort((a,b)=>a.name.localeCompare(b.name)):[];
      ui.advancedList.replaceChildren();
      const term=lower(ui.advancedSearch.value);
      for(const {name,count} of rawEntries){
        if(term&&!lower(name).includes(term))continue;
        const row=mk('div',null,'dr-filterrow'),lab=mk('label'),check=document.createElement('input');check.type='checkbox';
        check.checked=itemVisible(name);check.addEventListener('change',()=>{
          filterPrefs.items[lower(name)]=check.checked;saveFilterPrefs();render();warmTitles(state.data);
        });
        lab.append(check,document.createTextNode(name));row.append(lab,mk('span',String(count),'dr-count'));ui.advancedList.append(row);
      }
      ui.filteredCount.textContent=d?(d.total-d.excluded).toLocaleString()+' rows available (before UI filters)':'Load Wave data to see counts';
    }
    const heading=mk('h2','BWU2 SIM Duplicate Review — v'+VER);const close=btn('Close',()=>{ui.panel.style.display='none';hidePreview();});close.style.cssFloat='right';
    const toolbar=mk('div',null,'dr-toolbar'),fetch=btn('Fetch BWU2 from Wave',()=>void fetchWaveData()),
      load=btn('Load CSV',()=>file.click()),file=document.createElement('input');file.type='file';file.accept='.csv,.tsv,text/csv';file.style.display='none';
    ui.fetch=fetch;
    file.addEventListener('change',async()=>{try{const f=file.files?.[0];if(f){if(f.size>25*1024*1024)throw Error('CSV is too large.');setData(await f.text(),f.name,false);}}catch(e){status(e.message,true);}finally{file.value='';}});
    const waveLink=mk('a','Open Wave Command Center ↗');waveLink.href=WAVE_PAGE;waveLink.target='_blank';waveLink.rel='noopener noreferrer';
    const filterToggle=btn('Filters ⚙',()=>{
      const open=ui.filterPane.style.display!=='block';ui.filterPane.style.display=open?'block':'none';
      filterToggle.textContent=open?'Hide filters ✕':'Filters ⚙';
    });
    ui.identityScan=btn('Scan EAN/UPC across Wave (read-only)',()=>startIdentityScan());ui.identityScan.title='Optional wider cross-workflow identifier search; adaptive 4–10 read-only requests';
    toolbar.append(fetch,load,waveLink,filterToggle,ui.identityScan,file);
    ui.filterPane=mk('div',null,'dr-filterpane');
    const fh=mk('div',null,'dr-filterhead');fh.append(mk('strong','Wave categories — simplified controls'));
    ui.filteredCount=mk('span','Load Wave data to see counts','dr-count');fh.append(ui.filteredCount);ui.filterPane.append(fh);
    const categoryGrid=mk('div',null,'dr-checkgrid');ui.categoryCounts=new Map();ui.categoryChecks=new Map();
    for(const [key,label] of FILTER_GROUPS){
      const row=mk('div',null,'dr-filterrow'),lab=mk('label'),check=document.createElement('input');check.type='checkbox';check.checked=filterPrefs.cats[key];
      check.addEventListener('change',()=>{
        filterPrefs.cats[key]=check.checked;
        // A category choice overrides prior per-title overrides inside that category.
        for(const k of Object.keys(filterPrefs.items))if(filterKey(k)===key)delete filterPrefs.items[k];
        saveFilterPrefs();updateFilters();render();warmTitles(state.data);
      });
      ui.categoryChecks.set(key,check);const count=mk('span','0','dr-count');ui.categoryCounts.set(key,count);
      lab.append(check,document.createTextNode(label));row.append(lab,count);categoryGrid.append(row);
    }
    ui.filterPane.append(categoryGrid);
    ui.filterPane.append(mk('div','Hide SIM titles containing:','dr-filterhint'));
    const titleRow=mk('div');
    for(const k of ['ILAC','ERDR','ERMR','RPI']){
      const lab=mk('label',null,'dr-checkline'),check=document.createElement('input');check.type='checkbox';check.checked=filterPrefs.hide[k];
      check.addEventListener('change',()=>{filterPrefs.hide[k]=check.checked;saveFilterPrefs();render();warmTitles(state.data);});
      lab.append(check,document.createTextNode(k));titleRow.append(lab);
    }
    ui.filterPane.append(titleRow);
    ui.filterPane.append(mk('div','RPI titles are hidden by default. Any manual Ignore group choices are saved separately.','dr-filterhint'));
    const advancedToggle=btn('▸ Advanced — individual Wave Item titles',()=>{
      const open=ui.advancedPane.style.display!=='block';ui.advancedPane.style.display=open?'block':'none';
      advancedToggle.textContent=(open?'▾':'▸')+' Advanced — individual Wave Item titles';
      if(open)updateFilters();
    });
    ui.filterPane.append(advancedToggle);
    ui.advancedPane=mk('div',null,'dr-advanced');ui.advancedSearch=document.createElement('input');
    ui.advancedSearch.className='dr-search';ui.advancedSearch.type='search';ui.advancedSearch.placeholder='Search individual Wave titles…';
    ui.advancedSearch.addEventListener('input',updateFilters);
    ui.advancedList=mk('div');ui.advancedPane.append(ui.advancedSearch,ui.advancedList);ui.filterPane.append(ui.advancedPane);
    const reset=btn('Reset default filters',()=>{
      filterPrefs={cats:Object.fromEntries(FILTER_GROUPS.map(([k,,on])=>[k,on])),hide:{ILAC:true,ERDR:true,ERMR:true,RPI:true},items:{}};
      for(const [key,check] of ui.categoryChecks)check.checked=filterPrefs.cats[key];
      for(const input of titleRow.querySelectorAll('input'))input.checked=true;
      saveFilterPrefs();updateFilters();render();warmTitles(state.data);
    });ui.filterPane.append(reset);
    ui.ignoredToggle=btn('▸ Ignored groups (0) — restore',()=>{
      const open=ui.ignoredList.style.display!=='block';ui.ignoredList.style.display=open?'block':'none';
      ui.ignoredToggle.textContent=(open?'▾':'▸')+' Ignored groups ('+ignoredGroups.size+') — restore';
    });
    ui.ignoredList=mk('div',null,'dr-ignored-list');ui.filterPane.append(ui.ignoredToggle,ui.ignoredList);
    updateIgnoredUI();
    ui.message=mk('div','Existing ISS work: one-click comments and closures only after fresh SIM verification. Other Wave workflows: two-step manual review; live ISS ownership required.','dr-status');
    ui.stats=mk('div','', 'dr-status');ui.autoProgress=mk('div','','dr-auto-progress');ui.identityStatus=mk('div','Optional barcode/identifier discovery: press Scan to compare tickets across different titles.','dr-id-scan');ui.results=mk('div');
    ui.panel.append(close,heading,mk('div','Wave duplicate discovery · 12 filter categories · Advanced optional. BWU2-ICQA type excluded. Other SIM owners visible for review; live ISS ownership still required for manual resolution.','dr-note'),toolbar,ui.filterPane,ui.message,ui.stats,ui.autoProgress,ui.identityStatus,ui.results,ui.inspector);
    function init(){mount();if(!document.documentElement)return;observer=new MutationObserver(()=>mount());
      observer.observe(document.documentElement,{childList:true});
      if(document.body){watchedBody=document.body;observer.observe(watchedBody,{childList:true});}
      if(document.head)observer.observe(document.head,{childList:true});}
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
