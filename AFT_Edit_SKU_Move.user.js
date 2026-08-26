// ==UserScript==
// @name         MAIN v0.9.11 AFT Edit/SKU/Move master
// @name:en      MAIN v0.9.11 AFT Edit/SKU/Move master
// @namespace    https://github.com/1Sirkkris
// @version      0.9.11
// @description  Lean AFT-only master: EditItems/FcSku/MoveItems native QualityTools API.
// @include      *://aft-qt-*.corp.amazon.com/app/edititems*
// @include      *://aft-qt-*.corp.amazon.com/app/fcskuflip*
// @include      *://aft-qt-*.corp.amazon.com/app/moveitems*
// @run-at       document-start
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/AFT_Edit_SKU_Move.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/AFT_Edit_SKU_Move.user.js
// ==/UserScript==

(() => {
  'use strict';

  if (window.top !== window.self) return; // Move qty iframe
  if (window.__AFT_MASTER_V098__) return;
  window.__AFT_MASTER_V098__ = true;
  if (!/^aft-qt-/i.test(location.hostname) || !/\.corp\.amazon\.com$/i.test(location.hostname)) return;

  const VERSION = '0.9.11';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const debounce = (fn, ms = 180) => { let timer = 0; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); }; };
  const norm = v => String(v ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const low = v => norm(v).toLowerCase();

  function traceAft(type, data = {}) {
    try {
      const payload = { version: VERSION, ...data };
      if (typeof window.BWU2Trace === 'function') window.BWU2Trace(type, payload);
      else window.postMessage({ __BWU2_TRACE__: true, type, data: payload }, '*');
    } catch {}
  }

  const EDIT_STATE_TESTS = [
    ['location', ['scan location', 'scan container', 'input location', 'enter location', 'enter container']],
    ['item', ['input fnsku or fcsku', 'input item', 'scan item', 'enter the sku', 'enter item']],
    ['sourceState', ['select source inventory state']],
    ['sourceDisp', ['select source disposition', 'select source disposition type']],
    ['newState', ['select new inventory state']],
    ['newDisp', ['select new disposition', 'select disposition type']],
    ['dateRemove', ['confirm expiry date removal', 'remove expiry date']],
    ['dateEntry', ['enter expiry date', 'enter expiration date']],
    ['dateConfirm', ['confirm new expiry date', 'save expiry date']],
    ['confirm', ['confirm change', 'confirm to continue']],
    ['success', ['success items changed', 'items changed from', 'current expiry date:']],
    ['retryError', ['failed to change consumer type. please try again', 'failed to change consumer type']],
    ['error', ['work is errored', 'the service failed to process your request', 'service failed']],
    ['loading', ['loading']]
  ];
  const MOVE_QTY_PATTERNS = [
    /(?:["']|&quot;)quantity(?:["']|&quot;)\s*[:=]\s*(?:["']|&quot;)?([0-9]{1,6})\b/i,
    /\bQuantity\b(?:<[^>]+>|\s|&nbsp;|&#160;|:|-){0,20}([0-9]{1,6})\b/i
  ];
  const EDIT_QTY_PATTERNS = {
    sellable: /\b(?:Inventory|Sellable)\s*\(\s*Quantity\s*:\s*(\d{1,7})\s*\)/i,
    'pending research': /\bPending Research\s*\(\s*Quantity\s*:\s*(\d{1,7})\s*\)/i,
    unsellable: /\bUnsellable\s*\(\s*Quantity\s*:\s*(\d{1,7})\s*\)/i
  };

  const HEADERS = {
    'Content-Type': 'application/json; charset=utf-8',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest'
  };

  async function post(path, payload, label = path) {
    const res = await fetch(path, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: HEADERS, body: JSON.stringify(payload)
    });
    if (!res.ok) {
      let detail = '';
      try { detail = norm(await res.text()).slice(0, 180); } catch {}
      throw new Error(`${label}: HTTP ${res.status}${detail ? ` | ${detail}` : ''}`);
    }
    return res;
  }

  async function getHtml(label = 'GET') {
    const res = await fetch(location.pathname + location.search, {
      credentials: 'same-origin', cache: 'no-store'
    });
    if (!res.ok) throw new Error(`${label}: GET HTTP ${res.status}`);
    return res.text();
  }

  function objectId(html) {
    const raw = String(html || '');
    return raw.match(/(?:&quot;|")objectId(?:&quot;|")\s*:\s*(?:&quot;|")([^"&<]+)(?:&quot;|")/i)?.[1] ||
      raw.match(/\b[A-Z0-9]{2,12}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i)?.[0] || null;
  }

  function currentObjectId(root = document) {
    try {
      for (const el of root.querySelectorAll('script[type="a-state"]')) {
        const raw = (el.textContent || '').trim();
        if (!raw || !/"objectId"/i.test(raw)) continue;
        try {
          const value = JSON.parse(raw);
          if (value?.objectId) return value.objectId;
        } catch {}
      }
    } catch {}
    return null;
  }

  function bodyHtml(html) {
    const raw = String(html || '');
    const open = raw.search(/<body\b/i);
    if (open < 0) return raw;
    const start = raw.indexOf('>', open) + 1;
    const close = raw.search(/<\/body\s*>/i);
    return raw.slice(start || open, close > start ? close : undefined);
  }

  function bodySnapshot(html) {
    const doc = new DOMParser().parseFromString(`<body>${bodyHtml(html)}</body>`, 'text/html');
    for (const el of doc.querySelectorAll(
      'script,style,noscript,template,svg,[hidden],[aria-hidden="true"],' +
      '.aft-tool-hide,.aok-hidden,.a-hidden,.aft-tool-sub:not(#aft-tool-sub-main),' +
      '[style*="display:none"],[style*="display: none"],' +
      '[style*="visibility:hidden"],[style*="visibility: hidden"]'
    )) el.remove();

    let headings = '';
    for (const el of doc.querySelectorAll('h1,h2,h3,[role="heading"]')) {
      if (el.textContent) headings += ` ${el.textContent}`;
    }
    return { doc, headings: norm(headings), text: norm(doc.body?.textContent || '') };
  }

  async function page(label, classify) {
    const html = await getHtml(label);
    const view = bodySnapshot(html);
    return {
      doc: view.doc,
      text: view.text,
      state: classify ? classify(`${view.headings} ${view.text}`) : 'unknown',
      objectId: objectId(html)
    };
  }

  function assertObject(expected, actual, label) {
    if (!actual) throw new Error(`${label}: objectId missing`);
    if (expected && expected !== actual) throw new Error(`${label}: objectId changed`);
  }

  function makeApi(instructionId, tool, stopped = () => false) {
    const id = objectId => ({ id: { instructionId, objectId } });

    const wait = async (objectId, label, opts = {}) => {
      const started = performance.now();
      const timeout = opts.timeout ?? 20000;
      const requireComplete = opts.complete === true;
      let polls = 0;

      const report = (outcome, state = '') => {
        traceAft('AFT_STATUS_WAIT', {
          label,
          outcome,
          state,
          polls,
          ms: Math.round(performance.now() - started),
          requireComplete
        });
      };

      while (performance.now() - started < timeout) {
        if (!opts.ignoreStop && stopped()) {
          report('stopped');
          throw new Error('Stopped by user');
        }

        const res = await post('/status', id(objectId), `${label} status`);
        let data;
        try { data = await res.json(); }
        catch {
          report('invalid-json');
          throw new Error(`${label}: invalid /status JSON`);
        }

        const state = String(data?.status || '').toUpperCase();
        polls++;

        if (requireComplete) {
          if (state === 'COMPLETE') {
            report('complete', state);
            return { state };
          }
          if (state === 'READY') {
            report('unexpected-ready', state);
            throw new Error(`${label}: additional input required`);
          }
        } else if (state === 'READY') {
          report('ready', state);
          return { state };
        }

        if (state === 'ERRORED') {
          report('errored', state);
          throw new Error(`${label}: backend ERRORED`);
        }
        if (state !== 'PROCESSING') {
          report('unexpected-status', state);
          throw new Error(`${label}: status ${state || 'blank'}`);
        }

        // Keep the proven timing unchanged. Old traces show /action returns an empty body,
        // so /status is the authoritative readiness signal; v0.9.8 measures script-owned
        // polling before we consider reducing it.
        const delay = opts.pollMs ?? Math.min(300, 60 + polls * 35);
        await sleep(delay);
      }

      report('timeout');
      throw new Error(`${label}: status timeout`);
    };

    const action = async (objectId, actionName, input, label, opts = {}) => {
      if (!opts.ignoreStop && stopped()) throw new Error('Stopped by user');

      await post('/action', { ...id(objectId), action: actionName, input }, `${label} action`);
      return wait(objectId, label, opts);
    };

    return {
      id,
      wait,
      action,
      input: (o, v, l, opts = {}) => action(o, 'Input', v, l, opts),
      confirm: (o, opts = {}) => action(o, 'Confirm', 'Confirm', 'Confirm', opts),
      done: o => action(o, 'Done', 'Done', 'Done', {
        complete: true,
        timeout: 180000,
        pollMs: 300
      }),
      end: o => post('/end', { ...id(o), tool }, 'End'),
      page: (label, classify) => page(label, classify)
    };
  }

  function visible(el) {
    if (!el?.isConnected || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
  }

  function nativeText() {
    let text = '';
    for (const el of document.body?.children || []) {
      if (!el.classList?.contains('aftm')) text += ` ${el.innerText || el.textContent || ''}`;
    }
    return norm(text);
  }

  function liveState(classify) {
    let text = '';
    for (const el of document.querySelectorAll('h1,h2,h3,[role="heading"],main,form')) {
      if (!el.closest('.aftm') && visible(el)) text += ` ${el.innerText || el.textContent || ''}`;
    }
    return classify(text);
  }

  function stepTracker(el) {
    let group = '', rows = [], current = null;
    const draw = () => {
      if (!el) return;
      const icons = { done: '✓', active: '→', error: '!', pending: '○' };
      const lines = group ? [`Container: ${group}`] : [];
      for (const row of rows) {
        lines.push(row.label);
        for (const step of row.steps) lines.push(`  ${icons[step.state]} ${step.name}`);
      }
      el.value = lines.join('\n');
      el.scrollTop = el.scrollHeight;
    };
    const set = (name, state) => {
      const step = current?.steps.find(s => s.name === name);
      if (!step) return;
      if (state === 'active') current.steps.forEach(s => { if (s.state === 'active') s.state = 'pending'; });
      step.state = state;
      draw();
    };
    return {
      begin(nextGroup, label, names) {
        nextGroup = norm(nextGroup);
        if (nextGroup !== group) { group = nextGroup; rows = []; }
        current = { label: norm(label), steps: names.map(name => ({ name, state: 'pending' })) };
        rows.push(current); draw();
      },
      active: n => set(n, 'active'), done: n => set(n, 'done'), error: n => set(n, 'error'),
      clear() { group = ''; rows = []; current = null; draw(); }
    };
  }

  function skuStepTracker(el) {
    let skuKey = '', rows = [], current = null;
    const icons = { done: '✓', active: '→', error: '!', pending: '○' };
    const esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const draw = () => {
      if (!el) return;
      const visibleRows = rows.slice(-2).reverse();
      el.dataset.count = String(visibleRows.length);
      el.innerHTML = visibleRows.map(row => `
        <div class="sku-card">
          <div class="sku-card-title">${esc(row.label)}</div>
          <div class="sku-card-steps">${row.steps.map(step => `
            <div class="sku-step" data-state="${step.state}">${icons[step.state]} ${esc(step.name)}</div>`).join('')}</div>
        </div>`).join('');
    };
    const set = (name, state) => {
      const step = current?.steps.find(s => s.name === name);
      if (!step) return;
      if (state === 'active') current.steps.forEach(s => { if (s.state === 'active') s.state = 'pending'; });
      step.state = state; draw();
    };
    return {
      begin(_group, label, names) {
        const cleanLabel = norm(label);
        const nextSku = cleanLabel.split(/\s+•\s+attempt\b/i)[0];
        if (nextSku && nextSku !== skuKey) { skuKey = nextSku; rows = []; }
        current = { label: cleanLabel, steps: names.map(name => ({ name, state: 'pending' })) };
        rows.push(current); if (rows.length > 2) rows = rows.slice(-2); draw();
      },
      restartSameSku() { rows = []; current = null; draw(); },
      active: n => set(n, 'active'), done: n => set(n, 'done'), error: n => set(n, 'error'),
      clear() { skuKey = ''; rows = []; current = null; draw(); }
    };
  }

  function wireMin(panel, keyName, body = $('[data-body]', panel) || $('.body', panel), btn = $('[data-min]', panel)) {
    let minimized = localStorage.getItem(keyName) === '1';
    const apply = () => {
      if (body) body.hidden = minimized;
      if (btn) btn.textContent = minimized ? '+' : '−';
      panel.dataset.min = minimized ? '1' : '0';
      localStorage.setItem(keyName, minimized ? '1' : '0');
    };
    apply();
    btn?.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); minimized = !minimized; apply(); }, true);
    return () => { minimized = !minimized; apply(); };
  }

  function readQuantity(text) {
    for (const pattern of [
      /\bQuantity\b\s*[:：\-]?\s*([0-9]{1,6})\b/i,
      /\bQuantity\b[^0-9]{0,40}([0-9]{1,6})\b/i
    ]) {
      const qty = Number(String(text || '').match(pattern)?.[1]);
      if (Number.isInteger(qty) && qty > 0) return qty;
    }
    return null;
  }

  function injectCss() {
    if ($('#aftm-style')) return;
    const style = document.createElement('style');
    style.id = 'aftm-style';
    style.textContent = `
      .aftm{position:fixed;z-index:2147483647;font:13px/1.35 Arial,sans-serif;color:#1f2a30;background:#f4f6f7;border:1px solid #89979e;border-radius:8px;overflow:hidden;box-shadow:0 6px 20px #0004}.aftm *{box-sizing:border-box}.aftm button{cursor:pointer;font-weight:700}.aftm button:disabled{opacity:.5;cursor:not-allowed}.aftm input,.aftm textarea,.aftm select{width:100%;padding:7px;border:1px solid #91a0aa;border-radius:5px;background:#fff;color:#1d252b}.aftm select:disabled{background:#d7dcdf!important;color:#7a858b!important;border-color:#bcc5c9!important;opacity:1!important;cursor:not-allowed!important}.aftm [hidden]{display:none!important}
      .aftm .head,.aftm .move-head,.aftm .section-head,.aftm .fcsku-head{display:flex;align-items:center;justify-content:space-between;background:#36545c;color:#fff;padding:8px 10px;font-weight:800}.aftm .head button,.aftm .move-head button,.aftm .section-head button,.aftm .fcsku-head button{width:27px;height:22px;padding:0;border:1px solid #9eb0b5;border-radius:5px;background:#294249;color:#fff}.aftm .body,.aftm .move-body,.aftm .fcsku-body{padding:9px;display:grid;gap:7px}.aftm label{display:grid;gap:3px;font-weight:700}.aftm-row{display:flex;gap:7px}.aftm-row>*{flex:1}.aftm-run,.move-run,.fcsku-run,#aftm-each .primary{background:#2f6f63!important;color:#fff!important;border:0!important;padding:8px;border-radius:5px}.aftm-stop,.aftm-clear,.move-stop,.move-clear,.fcsku-stop,.fcsku-clear{background:#e8ecee;color:#182126;border:1px solid #a8b4ba;padding:7px;border-radius:5px}.aftm-status,.move-status{min-height:17px}.aftm-stepbox,.fcsku-log{width:100%;height:82px;padding:6px;border:1px solid #9aa8af;border-radius:5px;background:#fff;color:#1f2a30;font:10px/1.45 Consolas,monospace;resize:vertical;white-space:pre;overflow:auto}
      #aftm-each,#aftm-sku,#aftm-move{top:125px;left:15px;width:318px}#aftm-each{width:368px;max-width:calc(100vw - 30px);background:#eef7fb;border-color:#527985}#aftm-each .timer{display:flex;align-items:center;justify-content:space-between;gap:8px;background:#e8f6ff;padding:7px 10px;font-weight:700}#aftm-each .danger{background:#d94a4a;color:#fff;border:1px solid #b93737;padding:6px 10px;border-radius:6px}#aftm-each .body{gap:9px;background:#f4fafc}#aftm-each .each-choice-buttons{display:grid;gap:6px}#aftm-each .each-state-buttons{grid-template-columns:repeat(3,minmax(0,1fr))}#aftm-each .each-disp-buttons{grid-template-columns:repeat(2,minmax(0,1fr))}#aftm-each .each-choice-btn{min-width:0;padding:8px 5px;border:1px solid #8fa2aa;border-radius:6px;background:#fff;color:#26343a;font-size:12px;white-space:nowrap}#aftm-each .each-choice-btn[data-active="1"]{background:#295f58;color:#fff;border-color:#173f3a;box-shadow:inset 0 0 0 1px #fff7}#aftm-each .each-choice-btn:focus-visible{outline:3px solid #f59e0b;outline-offset:1px}#aftm-each [data-list]{min-height:126px;resize:vertical;font:12px/1.45 Consolas,monospace}#aftm-each .primary{min-height:38px;font-size:13px}#aftm-each .aftm-stepbox{height:126px;min-height:116px;font-size:11px;line-height:1.5;background:#fbfdfe}#aftm-each .aftm-status{min-height:28px;padding:5px 7px;border:1px solid #c3d3d9;border-radius:5px;background:#e8f3f7;font-weight:700}#aftm-sku .sku-top{display:grid;grid-template-columns:minmax(0,1fr) 72px;gap:8px;align-items:end}#aftm-sku .sku-start input{font-weight:800;text-align:center;background:#eef1f2}#aftm-sku .two{display:grid;grid-template-columns:1fr 1fr;gap:8px}#aftm-sku .sku-stepcards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;min-height:0}#aftm-sku .sku-stepcards[data-count="1"]{grid-template-columns:1fr}#aftm-sku .sku-card{min-width:0;border:1px solid #9aa8af;border-radius:6px;background:#fff;overflow:hidden}#aftm-sku .sku-card-title{padding:5px 7px;background:#e9eef0;border-bottom:1px solid #c8d0d4;font:700 10px/1.25 Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#aftm-sku .sku-card-steps{padding:5px 7px;display:grid;gap:2px;font:10px/1.25 Consolas,monospace}#aftm-sku .sku-step{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#aftm-sku .sku-step[data-state="active"]{font-weight:800;background:#eef7f4;border-radius:3px;padding:1px 3px;margin:0 -3px}#aftm-sku .sku-step[data-state="error"]{font-weight:800}
      #aftm-sku{width:368px;max-width:calc(100vw - 30px);background:#eef7fb;border-color:#527985}#aftm-sku .body{gap:9px;background:#f4fafc}#aftm-sku .two{grid-template-columns:1fr;gap:8px}#aftm-sku .sku-picker-group{display:grid;gap:6px;padding:8px;border:1px solid #c3d3d9;border-radius:7px;background:#f9fcfd}#aftm-sku .sku-picker-label{font-weight:800}#aftm-sku .sku-choice-buttons{display:grid;gap:6px}#aftm-sku .sku-state-buttons{grid-template-columns:repeat(3,minmax(0,1fr))}#aftm-sku .sku-disp-buttons{grid-template-columns:repeat(2,minmax(0,1fr))}#aftm-sku .sku-choice-btn{min-width:0;padding:8px 5px;border:1px solid #8fa2aa;border-radius:6px;background:#fff;color:#26343a;font-size:12px;white-space:nowrap}#aftm-sku .sku-choice-btn[data-active="1"]{background:#295f58;color:#fff;border-color:#173f3a;box-shadow:inset 0 0 0 1px #fff7}#aftm-sku .sku-choice-btn:disabled{background:#e5eaec;color:#879298;border-color:#c3ccd0;opacity:1;cursor:not-allowed}#aftm-sku .sku-choice-btn:focus-visible{outline:3px solid #f59e0b;outline-offset:1px}#aftm-sku .aftm-status{min-height:28px;padding:5px 7px;border:1px solid #c3d3d9;border-radius:5px;background:#e8f3f7;font-weight:700}
      #aftm-datelot{right:12px;bottom:12px;width:420px}#aftm-datelot .exp-grid-head,#aftm-datelot .exp-row{display:grid;grid-template-columns:minmax(0,1fr) 150px;gap:10px;align-items:center;min-width:0;width:100%}#aftm-datelot .exp-grid-head{padding:0 2px;font-size:10px;font-weight:800;color:#617078}#aftm-datelot .exp-grid-head span{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#aftm-datelot .exp-rows{display:grid;gap:6px;max-height:205px;overflow-y:auto;overflow-x:hidden;padding-right:2px;min-width:0}#aftm-datelot .exp-row{min-width:0;width:100%;overflow:hidden}#aftm-datelot .exp-row input{min-width:0;max-width:100%;width:100%;padding:6px}#aftm-datelot .exp-row [data-code]{font-family:Consolas,monospace;font-size:12px}#aftm-datelot .exp-row [data-date]{min-width:0;width:100%}#aftm-datelot .exp-add{background:#edf1f2;color:#263238;border:1px solid #a8b4ba;padding:6px;border-radius:5px}#aftm-datelot .exp-busy{position:absolute;inset:39px 0 0;z-index:20;background:rgba(236,240,242,.86);backdrop-filter:blur(1px);display:grid;place-items:center;padding:18px}#aftm-datelot .exp-busy-card{min-width:210px;max-width:300px;padding:16px 18px;border:1px solid #94a3aa;border-radius:8px;background:#fff;box-shadow:0 5px 18px #0003;text-align:center}#aftm-datelot .exp-spinner{width:34px;height:34px;margin:0 auto 10px;border:4px solid #c7d0d4;border-top-color:#2f6f63;border-radius:50%;animation:aftm-exp-spin .75s linear infinite}#aftm-datelot .exp-busy-title{font-size:14px;font-weight:900;letter-spacing:.4px;color:#24343a}#aftm-datelot .exp-busy-status{margin-top:5px;min-height:16px;font-size:11px;font-weight:700;color:#54646b}#aftm-datelot .exp-busy-stop{margin-top:11px;width:100%;padding:7px;border:1px solid #a8b4ba;border-radius:5px;background:#e8ecee;color:#182126;font-weight:800}@keyframes aftm-exp-spin{to{transform:rotate(360deg)}}#aftm-move{border-color:#225d67}#aftm-move .move-head{background:#225d67}#aftm-move .move-items{height:104px;resize:vertical;font:11px Consolas,monospace}#aftm-move .move-note{font-size:10px;color:#68757b}#aftm-move .move-status{font-weight:700}
      #aftm-fcsku{top:86px;left:10px;width:320px;border-color:#002e36}#aftm-fcsku .fcsku-head{background:#002e36}#aftm-fcsku .fcsku-status{padding:5px 6px;border:1px solid #9bb;border-radius:4px;background:#fff;font-weight:700}#aftm-fcsku .fcsku-metrics{padding:4px 6px;background:#e9f6ff;border:1px solid #9bb;border-radius:4px;font-size:11px;font-weight:600}#aftm-fcsku .fcsku-label{font-weight:bold;margin-top:3px}#aftm-fcsku .fcsku-locations{height:120px;font:11px Consolas,monospace;resize:vertical}
      #aftm-control{top:76px;right:10px;width:174px;font-size:11px}#aftm-control .ctrl-head{width:100%;border:0;border-radius:0;background:#36545c;color:#fff;padding:6px 8px;display:flex;justify-content:space-between}#aftm-control .ctrl-body{padding:6px;display:grid;gap:5px;background:#eef1f2}#aftm-control[data-open="0"]{width:auto;min-width:102px}#aftm-control[data-open="0"] .ctrl-body{display:none}.ctrl-toggle{border:1px solid #9ca9ae;border-radius:5px;padding:5px 7px;background:#fff;color:#263238;text-align:left}.ctrl-toggle[data-on="1"]{background:#2f6f63;color:#fff;border-color:#25594f}.ctrl-toggle[data-on="0"]{background:#e8ecee;color:#59656b}.ctrl-toggle[data-active="1"]{box-shadow:inset 0 0 0 1px #fff8,0 0 0 1px #25594f}.ctrl-note{font-size:10px;color:#68757b;padding:0 2px}
    `;
    document.documentElement.appendChild(style);
  }

  const EditApi = makeApi('EditItems', 'edititems', () => Edit.stopRequested);

  const Edit = {
    id: 'edit',
    active: false,
    mode: null,
    panel: null,

    directBusy: false,
    stopRequested: false,

    tracker: null,
    eachEndedObjectIds: new Set(),
    eachActiveObjectId: null,

    keys: {
      sku: 'aftm_sku_entry',
      currentState: 'aftm_sku_current_state',
      currentDamage: 'aftm_sku_current_damage',
      desiredState: 'aftm_sku_desired_state',
      desiredDamage: 'aftm_sku_desired_damage',

      skuMin: 'aftm_sku_min',
      eachMin: 'aftm_each_min',
      dateMin: 'aftm_date_min',
      skuRecoveryNotice: 'aftm_sku_recovery_notice'
    },

    match() {
      return /\/app\/edititems/i.test(location.pathname);
    },

    classify(text) {
      const value = low(text);
      let bestState = 'unknown';
      let bestIndex = Infinity;
      for (const [state, phrases] of EDIT_STATE_TESTS) {
        for (const phrase of phrases) {
          const index = value.indexOf(phrase);
          if (index >= 0 && index < bestIndex) {
            bestIndex = index;
            bestState = state;
          }
        }
      }
      return bestState;
    },

    fetchState(label) {
      return EditApi.page(label, text => this.classify(text));
    },

    async snapshot(expectedObjectId, label) {
      const snap = await this.fetchState(label);
      assertObject(expectedObjectId, snap.objectId, label);
      return snap;
    },

    status(text) {
      if (this.statusEl) this.statusEl.textContent = text;
      if (this.busyStatusEl) this.busyStatusEl.textContent = text || 'Working…';
    },

    detect() {
      const match = nativeText().match(/\bMode\s*:\s*(Datelot|Each|Sku)\b/i);
      return match ? match[1].toLowerCase() : null;
    },

    start() {
      this.refresh();
    },

    stop() {
      this.stopRequested = true;
      this.directBusy = false;
      this.panel?.remove();
      this.panel = null;
      this.mode = null;
      this.tracker = null;
      this.statusEl = this.busyStatusEl = null;
      this.runBtn = this.stopBtn = this.clearBtn = null;
    },

    refresh() {
      if (this.directBusy) return;

      const detected = this.detect();

      if (detected && (detected !== this.mode || !this.panel?.isConnected)) {
        this.stopRequested = true;
        this.directBusy = false;

        this.mode = detected;
        this.render();
      }

    },

    render() {
      this.panel?.remove();

      if (this.mode === 'each') this.panel = this.renderEach();
      else if (this.mode === 'sku') this.panel = this.renderSku();
      else if (this.mode === 'datelot') this.panel = this.renderDatelot();
      else this.panel = null;

      if (!this.panel) return;
      this.statusEl = $('[data-status]', this.panel);
      this.busyStatusEl = $('[data-exp-busy-status]', this.panel);
      this.runBtn = $('[data-run]', this.panel) || $('[data-start]', this.panel);
      this.stopBtn = $('[data-stop]', this.panel);
      this.clearBtn = $('[data-clear]', this.panel);

      if (this.mode === 'sku') {
        const notice = sessionStorage.getItem(this.keys.skuRecoveryNotice);
        if (notice) {
          sessionStorage.removeItem(this.keys.skuRecoveryNotice);
          this.status(notice);
        }
      }
    },

    wireDamage(stateEl, damageEl, damageWrap = damageEl.closest('label')) {
      const sync = () => {
        const enabled = low(stateEl.value) === 'unsellable';
        damageEl.disabled = !enabled;
        if (damageWrap) damageWrap.hidden = !enabled;
        if (!enabled) damageEl.blur();
      };

      stateEl.addEventListener('change', sync);
      sync();
    },

    wireSkuRules(currentState, currentDamage, desiredState, desiredDamage) {
      const option = (select, value) =>
        [...select.options].find(o => low(o.value) === low(value));

      const firstEnabled = select =>
        [...select.options].find(o => !o.disabled);

      const sync = () => {
        const curState = low(currentState.value);
        currentDamage.disabled = curState !== 'unsellable';

        [...desiredState.options].forEach(o => { o.disabled = false; });

        if (curState !== 'unsellable') {
          const same = option(desiredState, currentState.value);
          if (same) same.disabled = true;
        }

        let selectedState = desiredState.options[desiredState.selectedIndex];
        if (!selectedState || selectedState.disabled) {
          const next = firstEnabled(desiredState);
          if (next) desiredState.value = next.value;
        }

        const desiredUnsellable = low(desiredState.value) === 'unsellable';
        desiredDamage.disabled = !desiredUnsellable;

        [...desiredDamage.options].forEach(o => { o.disabled = false; });

        if (curState === 'unsellable' && desiredUnsellable) {
          const sameDamage = option(desiredDamage, currentDamage.value);
          if (sameDamage) sameDamage.disabled = true;

          const selectedDamage = desiredDamage.options[desiredDamage.selectedIndex];
          if (!selectedDamage || selectedDamage.disabled) {
            const nextDamage = firstEnabled(desiredDamage);
            if (nextDamage) desiredDamage.value = nextDamage.value;
          }
        }

        if (currentDamage.disabled) currentDamage.blur();
        if (desiredDamage.disabled) desiredDamage.blur();
      };

      [currentState, currentDamage, desiredState, desiredDamage]
        .forEach(el => el.addEventListener('change', sync));

      sync();
      return sync;
    },

    renderEach() {
      const panel = document.createElement('section');
      panel.id = 'aftm-each';
      panel.className = 'aftm';

      panel.innerHTML = `
        <div class="timer">
          <span>⚡ Smart Auto Timer</span>
          <button class="danger" data-clear>CLEAR</button>
        </div>

        <div class="section-head" data-toggle>
          <span>Multi Flip</span>
          <button data-min>−</button>
        </div>

        <div class="body">
          <label class="each-state-picker">
            Inventory State
            <input type="hidden" data-state value="Unsellable">
            <span class="each-choice-buttons each-state-buttons" data-state-buttons role="group" aria-label="Inventory State">
              <button type="button" class="each-choice-btn" data-state-value="Sellable">Sellable</button>
              <button type="button" class="each-choice-btn" data-state-value="Pending Research">Pending</button>
              <button type="button" class="each-choice-btn" data-state-value="Unsellable">Unsellable</button>
            </span>
          </label>

          <label data-disp-wrap>
            Disposition
            <input type="hidden" data-disp value="Amazon Damage">
            <span class="each-choice-buttons each-disp-buttons" role="group" aria-label="Disposition">
              <button type="button" class="each-choice-btn" data-disp-value="Amazon Damage">Amazon Damage</button>
              <button type="button" class="each-choice-btn" data-disp-value="Defective">Defective</button>
              <button type="button" class="each-choice-btn" data-disp-value="Distributor Damage">Distributor Damage</button>
              <button type="button" class="each-choice-btn" data-disp-value="Expired">Expired</button>
            </span>
          </label>

          <textarea
            data-list
            rows="6"
            placeholder="Paste:&#10;TOTE ASIN&#10;or&#10;TOTE ASIN FNSKU"
          ></textarea>

          <button class="primary" data-start>Start Multi Flip</button>

          <textarea class="aftm-stepbox" data-steps readonly></textarea>
          <div class="aftm-status" data-status>Idle</div>
        </div>
      `;

      document.body.appendChild(panel);
      this.tracker = stepTracker($('[data-steps]', panel));

      const state = $('[data-state]', panel);
      const disp = $('[data-disp]', panel);
      const stateButtons = $$('[data-state-value]', panel);
      const dispButtons = $$('[data-disp-value]', panel);

      const savedState = localStorage.getItem('aftm_each_state');
      state.value = ['Sellable', 'Pending Research', 'Unsellable'].includes(savedState)
        ? savedState
        : 'Unsellable';
      const dispositions = ['Amazon Damage', 'Defective', 'Distributor Damage', 'Expired'];
      const savedDisposition = localStorage.getItem('aftm_each_disp');
      disp.value = dispositions.includes(savedDisposition) ? savedDisposition : 'Amazon Damage';

      const drawStateButtons = () => {
        for (const button of stateButtons) {
          const active = button.dataset.stateValue === state.value;
          button.dataset.active = active ? '1' : '0';
          button.setAttribute('aria-pressed', active ? 'true' : 'false');
          const label = button.dataset.stateValue === 'Pending Research'
            ? 'Pending'
            : button.dataset.stateValue;
          button.textContent = `${active ? '✓ ' : ''}${label}`;
        }
      };

      for (const button of stateButtons) {
        button.onclick = () => {
          state.value = button.dataset.stateValue;
          state.dispatchEvent(new Event('change', { bubbles: true }));
        };
      }

      state.addEventListener('change', drawStateButtons);

      const drawDispositionButtons = () => {
        for (const button of dispButtons) {
          const active = button.dataset.dispValue === disp.value;
          button.dataset.active = active ? '1' : '0';
          button.setAttribute('aria-pressed', active ? 'true' : 'false');
          button.textContent = `${active ? '✓ ' : ''}${button.dataset.dispValue}`;
        }
      };

      for (const button of dispButtons) {
        button.onclick = () => {
          disp.value = button.dataset.dispValue;
          disp.dispatchEvent(new Event('change', { bubbles: true }));
        };
      }

      disp.addEventListener('change', drawDispositionButtons);
      this.wireDamage(state, disp, $('[data-disp-wrap]', panel));
      drawStateButtons();
      drawDispositionButtons();

      const toggleMin = wireMin(panel, this.keys.eachMin);
      $('[data-toggle]', panel).onclick = event => {
        if (event.target.closest('button')) return;
        toggleMin();
      };

      $('[data-start]', panel).onclick = () => this.startEachDirect();
      $('[data-clear]', panel).onclick = () => this.clear('Cleared', true);

      return panel;
    },

    renderSku() {
      const panel = document.createElement('section');
      panel.id = 'aftm-sku';
      panel.className = 'aftm';

      panel.innerHTML = `
        <div class="head">
          <span>EditItems Loop v${VERSION}</span>
          <button data-min>−</button>
        </div>

        <div class="body">
          <div class="sku-top">
            <label>
              SKU / ASIN / FNSKU / FCSKU
              <input data-sku autocomplete="off">
            </label>
            <label class="sku-start">
              Qty
              <input data-start-qty value="—" readonly tabindex="-1">
            </label>
          </div>

          <div class="two">
            <div class="sku-picker-group">
              <div class="sku-picker-label">Current state</div>
              <select data-cur-state hidden aria-hidden="true" tabindex="-1">
                <option>Sellable</option>
                <option>Unsellable</option>
                <option>Pending Research</option>
              </select>
              <span class="sku-choice-buttons sku-state-buttons" role="group" aria-label="Current state">
                <button type="button" class="sku-choice-btn" data-cur-state-value="Sellable">Sellable</button>
                <button type="button" class="sku-choice-btn" data-cur-state-value="Pending Research">Pending</button>
                <button type="button" class="sku-choice-btn" data-cur-state-value="Unsellable">Unsellable</button>
              </span>
            </div>

            <div class="sku-picker-group" data-cur-dmg-wrap>
              <div class="sku-picker-label">Current disposition</div>
              <select data-cur-dmg hidden aria-hidden="true" tabindex="-1">
                <option>Amazon Damage</option>
                <option>Defective</option>
                <option>Distributor Damage</option>
                <option>Expired</option>
              </select>
              <span class="sku-choice-buttons sku-disp-buttons" role="group" aria-label="Current disposition">
                <button type="button" class="sku-choice-btn" data-cur-dmg-value="Amazon Damage">Amazon Damage</button>
                <button type="button" class="sku-choice-btn" data-cur-dmg-value="Defective">Defective</button>
                <button type="button" class="sku-choice-btn" data-cur-dmg-value="Distributor Damage">Distributor Damage</button>
                <button type="button" class="sku-choice-btn" data-cur-dmg-value="Expired">Expired</button>
              </span>
            </div>

            <div class="sku-picker-group">
              <div class="sku-picker-label">Desired state</div>
              <select data-new-state hidden aria-hidden="true" tabindex="-1">
                <option>Sellable</option>
                <option>Unsellable</option>
                <option>Pending Research</option>
              </select>
              <span class="sku-choice-buttons sku-state-buttons" role="group" aria-label="Desired state">
                <button type="button" class="sku-choice-btn" data-new-state-value="Sellable">Sellable</button>
                <button type="button" class="sku-choice-btn" data-new-state-value="Pending Research">Pending</button>
                <button type="button" class="sku-choice-btn" data-new-state-value="Unsellable">Unsellable</button>
              </span>
            </div>

            <div class="sku-picker-group" data-new-dmg-wrap>
              <div class="sku-picker-label">Desired disposition</div>
              <select data-new-dmg hidden aria-hidden="true" tabindex="-1">
                <option>Amazon Damage</option>
                <option>Defective</option>
                <option>Distributor Damage</option>
                <option>Expired</option>
              </select>
              <span class="sku-choice-buttons sku-disp-buttons" role="group" aria-label="Desired disposition">
                <button type="button" class="sku-choice-btn" data-new-dmg-value="Amazon Damage">Amazon Damage</button>
                <button type="button" class="sku-choice-btn" data-new-dmg-value="Defective">Defective</button>
                <button type="button" class="sku-choice-btn" data-new-dmg-value="Distributor Damage">Distributor Damage</button>
                <button type="button" class="sku-choice-btn" data-new-dmg-value="Expired">Expired</button>
              </span>
            </div>
          </div>

          <div class="sku-stepcards" data-steps data-count="0"></div>
          <div class="aftm-status" data-status>Idle</div>

          <div class="aftm-row">
            <button class="aftm-run" data-run>RUN</button>
            <button class="aftm-stop" data-stop>STOP</button>
            <button class="aftm-clear" data-clear>CLEAR</button>
          </div>
        </div>
      `;

      document.body.appendChild(panel);
      this.tracker = skuStepTracker($('[data-steps]', panel));

      const sku = $('[data-sku]', panel);
      const currentState = $('[data-cur-state]', panel);
      const currentDamage = $('[data-cur-dmg]', panel);
      const desiredState = $('[data-new-state]', panel);
      const desiredDamage = $('[data-new-dmg]', panel);

      sku.value = localStorage.getItem(this.keys.sku) || '';
      currentState.value = localStorage.getItem(this.keys.currentState) || 'Sellable';
      currentDamage.value = localStorage.getItem(this.keys.currentDamage) || 'Defective';
      desiredState.value = localStorage.getItem(this.keys.desiredState) || 'Unsellable';
      desiredDamage.value = localStorage.getItem(this.keys.desiredDamage) || 'Defective';

      const startQty = $('[data-start-qty]', panel);
      const syncSkuRules = this.wireSkuRules(currentState, currentDamage, desiredState, desiredDamage);
      const skuPickers = [
        { valueEl: currentState, selector: '[data-cur-state-value]', dataKey: 'curStateValue' },
        { valueEl: currentDamage, selector: '[data-cur-dmg-value]', dataKey: 'curDmgValue' },
        { valueEl: desiredState, selector: '[data-new-state-value]', dataKey: 'newStateValue' },
        { valueEl: desiredDamage, selector: '[data-new-dmg-value]', dataKey: 'newDmgValue' }
      ];

      const drawSkuChoices = () => {
        $('[data-cur-dmg-wrap]', panel).hidden = low(currentState.value) !== 'unsellable';
        $('[data-new-dmg-wrap]', panel).hidden = low(desiredState.value) !== 'unsellable';

        for (const picker of skuPickers) {
          for (const button of $$(picker.selector, panel)) {
            const value = button.dataset[picker.dataKey];
            const matchingOption = [...picker.valueEl.options]
              .find(option => low(option.value) === low(value));
            const active = low(picker.valueEl.value) === low(value);
            button.disabled = !!matchingOption?.disabled;
            button.dataset.active = active ? '1' : '0';
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
            const label = value === 'Pending Research' ? 'Pending' : value;
            button.textContent = `${active ? '✓ ' : ''}${label}`;
          }
        }
      };

      for (const picker of skuPickers) {
        for (const button of $$(picker.selector, panel)) {
          button.onclick = () => {
            if (button.disabled) return;
            picker.valueEl.value = button.dataset[picker.dataKey];
            picker.valueEl.dispatchEvent(new Event('change', { bubbles: true }));
          };
        }
      }

      sku.oninput = debounce(() => {
        localStorage.setItem(this.keys.sku, norm(sku.value));
        if (startQty) startQty.value = '—';
      });

      for (const [el, keyName] of [
        [currentState, this.keys.currentState], [currentDamage, this.keys.currentDamage],
        [desiredState, this.keys.desiredState], [desiredDamage, this.keys.desiredDamage]
      ]) {
        el.addEventListener('change', () => {
          localStorage.setItem(keyName, el.value);
          syncSkuRules();
          drawSkuChoices();
        });
      }

      drawSkuChoices();

      wireMin(panel, this.keys.skuMin);

      $('[data-run]', panel).onclick = () => {
        document.activeElement?.blur?.();
        this.startSkuDirect();
      };

      $('[data-stop]', panel).onclick = () => {
        this.stopRequested = true;
        document.activeElement?.blur?.();
        this.status('Stopping…');
      };

      $('[data-clear]', panel).onclick = () => this.clear('Cleared', true);

      sku.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        event.stopPropagation();
        sku.blur();
        this.startSkuDirect();
      }, true);

      return panel;
    },

    renderDatelot() {
      const panel = document.createElement('section');
      panel.id = 'aftm-datelot';
      panel.className = 'aftm';

      panel.innerHTML = `
        <div class="head">
          <span data-exp-title>Expiration Queue v${VERSION}</span>
          <button data-min>−</button>
        </div>

        <div class="body">
          <label>
            Tote
            <input data-cont autocomplete="off" placeholder="tsX / csX">
          </label>

          <div class="exp-grid-head">
            <span>ASIN / FNSKU / UPC / EAN</span>
            <span>Desired date</span>
          </div>

          <div class="exp-rows" data-exp-rows></div>
          <button class="exp-add" data-add-row>+ ADD ROW</button>

          <div class="aftm-status" data-status>Idle</div>

          <div class="aftm-row">
            <button class="aftm-run" data-run>RUN</button>
            <button class="aftm-stop" data-stop>STOP</button>
            <button class="aftm-clear" data-clear>CLEAR</button>
          </div>
        </div>

        <div class="exp-busy" data-exp-busy hidden>
          <div class="exp-busy-card">
            <div class="exp-spinner"></div>
            <div class="exp-busy-title">WORKING…</div>
            <div class="exp-busy-status" data-exp-busy-status>Starting…</div>
            <button class="exp-busy-stop" data-exp-busy-stop>STOP</button>
          </div>
        </div>
      `;

      document.body.appendChild(panel);

      const rowsEl = $('[data-exp-rows]', panel);

      const makeRow = (code = '', date = '') => {
        const row = document.createElement('div');
        row.className = 'exp-row';
        row.innerHTML = `
          <input data-code autocomplete="off" placeholder="ASIN / FNSKU / UPC / EAN">
          <input data-date type="date">
        `;
        $('[data-code]', row).value = code;
        $('[data-date]', row).value = date;
        rowsEl.appendChild(row);

        const codeEl = $('[data-code]', row);

        codeEl.addEventListener('paste', event => {
          const raw = event.clipboardData?.getData('text') || '';
          if (!/[\r\n\t]/.test(raw)) return;

          const lines = raw
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean);

          if (!lines.length) return;
          event.preventDefault();

          const parsed = lines.map(line => {
            const parts = line.split('\t').map(v => v.trim());
            return { code: parts[0] || '', date: parts[1] || '' };
          }).filter(item => item.code);

          const rows = $$('.exp-row', rowsEl);
          let index = rows.indexOf(row);

          for (const item of parsed) {
            if (!rows[index]) rows.push(makeRow());
            const target = rows[index++];
            $('[data-code]', target).value = item.code;
            if (/^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
              $('[data-date]', target).value = item.date;
            }
          }

          const last = rowsEl.lastElementChild;
          if (norm($('[data-code]', last)?.value)) makeRow();
        });

        codeEl.addEventListener('change', () => {
          if (row === rowsEl.lastElementChild && norm(codeEl.value)) makeRow();
        });

        return row;
      };

      for (let i = 0; i < 4; i++) makeRow();

      $('[data-add-row]', panel).onclick = () => {
        const row = makeRow();
        $('[data-code]', row)?.focus();
      };

      wireMin(panel, this.keys.dateMin);

      $('[data-run]', panel).onclick = () => {
        document.activeElement?.blur?.();
        this.startExpiration();
      };

      const requestDatelotStop = () => {
        this.stopRequested = true;
        document.activeElement?.blur?.();
        this.status('Stopping…');
      };

      $('[data-stop]', panel).onclick = requestDatelotStop;
      $('[data-exp-busy-stop]', panel).onclick = requestDatelotStop;

      $('[data-clear]', panel).onclick = () => {
        this.clear('Cleared', true);
        rowsEl.innerHTML = '';
        for (let i = 0; i < 4; i++) makeRow();
      };

      return panel;
    },

    setDirectButtons(running) {
      if (!this.panel) return;

      if (this.runBtn) this.runBtn.disabled = running;
      if (this.stopBtn) this.stopBtn.disabled = !running;
      if (this.clearBtn) this.clearBtn.disabled = false;

      if (this.mode === 'datelot') {
        const busy = $('[data-exp-busy]', this.panel);
        if (busy) busy.hidden = !running;
        if (this.busyStatusEl && running) {
          this.busyStatusEl.textContent = this.statusEl?.textContent || 'Starting…';
        }
      }
    },

    clear(message = 'Idle', clearFields = false) {
      this.stopRequested = true;

      if (clearFields && this.panel) {
        $$('input[type="text"],input:not([type]),textarea,input[type="date"]', this.panel)
          .forEach(el => {
            el.value = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          });

        $$('input[type="checkbox"]', this.panel)
          .forEach(el => { el.checked = false; });

        localStorage.removeItem(this.keys.sku);
      }

      if (clearFields) this.tracker?.clear();

      document.activeElement?.blur?.();
      this.status(this.directBusy ? 'Stopping…' : message);
    },

    mapState(value) {
      const state = low(value);

      if (state === 'sellable' || state === 'inventory') return 'INVENTORY';
      if (state === 'pending research') return 'PENDING_RESEARCH';
      if (state === 'unsellable') return 'UNSELLABLE';

      throw new Error(`Unsupported inventory state: ${value}`);
    },

    mapDamage(value) {
      const damage = low(value);

      if (damage === 'amazon damage' || damage === 'warehouse damage') {
        return 'AMAZON_DAMAGE';
      }
      if (damage === 'defective') return 'DEFECTIVE';
      if (damage === 'distributor damage') return 'DISTRIBUTOR_DAMAGE';
      if (damage === 'expired') return 'EXPIRED';

      throw new Error(`Unsupported disposition: ${value}`);
    },

    parseEachQueue(text) {
      const items = [];
      for (const raw of String(text || '').split(/\r?\n/)) {
        const line = norm(raw);
        if (!line) continue;
        const [location = '', asin = '', fnsku = ''] = line.split(/\s+/);
        if (location && asin) items.push({ location, asin, fnsku: fnsku || asin });
      }
      return items;
    },

    async directRun(task) {
      this.directBusy = true;
      this.stopRequested = false;
      this.setDirectButtons(true);
      try { await task(); }
      catch (error) {
        const message = String(error?.message || error);
        this.status(`STOPPED: ${message}`);
      } finally {
        this.directBusy = false;
        this.setDirectButtons(false);
      }
    },

    async tracked(step, status, task) {
      this.tracker?.active(step);
      this.status(status);
      try {
        const result = await task();
        this.tracker?.done(step);
        return result;
      } catch (error) {
        this.tracker?.error(step);
        throw error;
      }
    },

    async targetState(objectId, state, damage, prefix = '', dispStep = 'Disp') {
      await this.tracked('Target', `${prefix}New state`, () =>
        EditApi.action(objectId, 'Input', state, 'New state', {
          timeout: 120000
        })
      );
      if (state === 'UNSELLABLE') {
        await this.tracked(dispStep, `${prefix}Disposition`, () =>
          EditApi.action(objectId, 'Input', this.mapDamage(damage), 'New disposition', {
            timeout: 120000
        })
        );
      }
    },

    async confirmLoop(objectId, prefix = '') {
      this.tracker?.active('Confirm');
      for (let round = 1; round <= 10; round++) {
        this.status(`${prefix}Confirm ${round}`);
        await EditApi.confirm(objectId, {
          timeout: 300000
        });
        const snap = await this.snapshot(objectId, `After confirm ${round}`);
        if (snap.state === 'error') throw new Error('EditItems returned error after confirm');
        if (snap.state !== 'confirm') return snap;
      }
      throw new Error('Too many confirmation rounds; stopped safely');
    },

    readEditInventory(source) {
      const doc = source?.body ? source : new DOMParser().parseFromString(String(source || ''), 'text/html');
      const out = Object.create(null);
      if (!doc.body) return out;

      const aliases = [
        ['sellable', /^(?:Inventory|Sellable)$/i],
        ['pending research', /^Pending Research$/i],
        ['unsellable', /^Unsellable$/i]
      ];

      for (const el of doc.body.querySelectorAll('label,li,tr,div')) {
        const t = norm(el.textContent || '');
        const qm = t.match(/^\s*([^()\n]{2,40})\s*\(\s*Quantity\s*:\s*(\d{1,7})\s*\)/i);
        if (!qm) continue;
        const label = norm(qm[1]);
        const qty = Number(qm[2]);
        for (const [key, rx] of aliases) {
          if (rx.test(label)) {
            const prev = out[key];
            if (!prev || t.length < prev.len) out[key] = { qty, len: t.length };
            break;
          }
        }
      }

      return out;
    },

    readEditQty(source, stateLabel = '') {
      const key = low(stateLabel) === 'inventory' ? 'sellable' : low(stateLabel);
      const pattern = EDIT_QTY_PATTERNS[key];
      const text = source?.text || '';

      if (pattern && text) {
        const qty = Number(text.match(pattern)?.[1]);
        if (Number.isInteger(qty)) return qty;
      }

      const map = this.readEditInventory(source?.doc || source);
      return map[key]?.qty ?? null;
    },

    setStartQty(qty) {
      const el = this.panel && $('[data-start-qty]', this.panel);
      if (el) el.value = qty == null ? '—' : String(qty);
    },

    async resetSkuWorkflow(objectId, reason = 'Retry', endCurrent = true) {
      this.status(`${reason} → reset`);
      if (endCurrent) {
        try { await EditApi.end(objectId); } catch {}
      }
      for (let attempt = 1; attempt <= 12; attempt++) {
        if (this.stopRequested) throw new Error('Stopped by user');
        const snap = await this.fetchState(`SKU reset ${attempt}`);
        if (snap.objectId && snap.objectId !== objectId) {
          try {
            const ready = await EditApi.wait(snap.objectId, `SKU reset ${attempt}`);
            if (ready.state === 'READY' && snap.state === 'item') return snap;
          } catch {}
        }
        await sleep(attempt < 4 ? 80 : 180);
      }
      location.reload();
      throw new Error('Retry reset required page reload');
    },

    async recoverSkuBackendError(objectId, sku, attempt) {
      this.status(`Attempt ${attempt} • backend error → recovering`);
      this.setStartQty(null);

      try { await EditApi.end(objectId); } catch {}

      for (let n = 1; n <= 12; n++) {
        if (this.stopRequested) throw new Error('Stopped by user');

        try {
          const snap = await this.fetchState(`SKU error recovery ${n}`);
          if (snap.objectId && snap.state === 'item') {
            try {
              const ready = await EditApi.wait(snap.objectId, `SKU error recovery ${n}`, {
                timeout: 6000
              });
              if (ready.state === 'READY') {
                this.status(`RECOVERED ✓ • ${sku} failed • ready`);
                return true;
              }
            } catch {}
          }
        } catch {}

        await sleep(n < 4 ? 100 : 220);
      }

      sessionStorage.setItem(
        this.keys.skuRecoveryNotice,
        `RECOVERED/RESET ✓ • ${sku} failed • ready`
      );
      location.reload();
      return false;
    },

    async startSkuDirect() {
      if (this.directBusy || this.mode !== 'sku') return;
      const sku = norm($('[data-sku]', this.panel)?.value);
      if (!sku) return this.status('Enter SKU / ASIN / FNSKU / FCSKU');

      const meta = {
        sku,
        currentState: $('[data-cur-state]', this.panel).value,
        currentDamage: $('[data-cur-dmg]', this.panel).value,
        desiredState: $('[data-new-state]', this.panel).value,
        desiredDamage: $('[data-new-dmg]', this.panel).value
      };
      for (const [keyName, value] of [
        [this.keys.sku, sku], [this.keys.currentState, meta.currentState],
        [this.keys.currentDamage, meta.currentDamage], [this.keys.desiredState, meta.desiredState],
        [this.keys.desiredDamage, meta.desiredDamage]
      ]) localStorage.setItem(keyName, value);

      this.setStartQty(null);
      this.tracker?.restartSameSku?.();
      await this.directRun(() => this.runSkuDirect(meta));
    },

    async acquireSkuObject() {
      let last = null;
      for (let attempt = 0; attempt < 7; attempt++) {
        if (this.stopRequested) throw new Error('Stopped by user');
        const snap = await this.fetchState(attempt ? `SKU page ${attempt}` : 'SKU preflight');
        last = snap;
        if (!snap.objectId) { await sleep(30); continue; }
        await EditApi.wait(snap.objectId, 'SKU preflight');
        if (snap.state === 'item') return snap;
        if (!['loading', 'error', 'unknown'].includes(snap.state)) break;
        await sleep(attempt < 2 ? 20 : 60);
      }
      throw new Error(`Start on "Input fnSku or fcSku". Server state="${last?.state || 'unknown'}".`);
    },

    async runSkuDirect(meta) {
      const currentState = this.mapState(meta.currentState);
      const desiredState = this.mapState(meta.desiredState);
      const currentLabel = meta.currentState;

      let session = await this.acquireSkuObject();
      let attempt = 0;
      let initialQty = null;

      while (!this.stopRequested) {
        attempt++;
        if (attempt > 50) throw new Error('Stopped after 50 SKU attempts');

        const objectId = session.objectId;
        const steps = ['Lookup', 'Qty', 'Source'];
        if (currentState === 'UNSELLABLE') steps.push('Source disp');
        steps.push('Target');
        if (desiredState === 'UNSELLABLE') steps.push('Target disp');
        steps.push('Confirm', 'Done');
        this.tracker?.begin('', `${meta.sku} • attempt ${attempt}`, steps);

        try {
          await this.tracked('Lookup', `Attempt ${attempt} • SKU lookup`, () =>
            EditApi.input(objectId, meta.sku, 'SKU')
          );

          this.tracker?.active('Qty');
          const sourcePage = await this.snapshot(objectId, `Source inventory ${attempt}`);

          if (sourcePage.state === 'retryError') {
            this.tracker?.error('Qty');
            session = await this.resetSkuWorkflow(objectId, `Expected error ${attempt}`);
            continue;
          }
          if (sourcePage.state !== 'sourceState') {
            throw new Error(`Expected sourceState after lookup, got "${sourcePage.state}"`);
          }

          const qty = this.readEditQty(sourcePage, currentLabel);
          if (qty != null) {
            if (initialQty == null) initialQty = qty;
            this.setStartQty(qty);
          }
          this.tracker?.done('Qty');

          if (qty === 0) {
            this.status(`DONE ✓ 0 ${currentLabel} remaining`);
            try { await EditApi.end(objectId); } catch {}
            return;
          }
          if (qty == null) throw new Error(`Could not read ${currentLabel} quantity`);

          await this.tracked('Source', `Attempt ${attempt} • ${currentLabel} (${qty})`, () =>
            EditApi.action(objectId, 'Input', currentState, 'Source state', {
              timeout: 120000
        })
          );
          if (currentState === 'UNSELLABLE') {
            await this.tracked('Source disp', `Attempt ${attempt} • Source disposition`, () =>
              EditApi.action(objectId, 'Input', this.mapDamage(meta.currentDamage), 'Source disposition', {
                timeout: 120000
        })
            );
          }

          const afterSource = await this.snapshot(objectId, `After source ${attempt}`);
          if (afterSource.state === 'retryError' || afterSource.state === 'sourceState') {
            this.status(`Attempt ${attempt} • source did not advance → retrying`);
            session = await this.resetSkuWorkflow(objectId, `Attempt ${attempt}`);
            continue;
          }
          if (afterSource.state !== 'newState') {
            throw new Error(`Expected newState after source selection, got "${afterSource.state}"`);
          }

          await this.targetState(objectId, desiredState, meta.desiredDamage, `Attempt ${attempt} • `, 'Target disp');

          let snap;
          try {
            snap = await this.confirmLoop(objectId, `Attempt ${attempt} • `);
          } catch (error) {
            const retrySnap = await this.fetchState(`SKU retry check ${attempt}`);
            if (retrySnap.objectId === objectId && retrySnap.state === 'retryError') {
              this.status(`Attempt ${attempt} • expected consumer-type error → retrying`);
              session = await this.resetSkuWorkflow(objectId, `Attempt ${attempt}`);
              continue;
            }
            throw error;
          }

          if (snap.state === 'retryError') {
            session = await this.resetSkuWorkflow(objectId, `Attempt ${attempt}`);
            continue;
          }
          if (snap.state !== 'success') throw new Error(`Expected success after confirm, got "${snap.state}"`);

          this.tracker?.done('Confirm');
          await this.tracked('Done', `Attempt ${attempt} • Success → Done`, () => EditApi.done(objectId));
          await EditApi.end(objectId);

          this.status(`Attempt ${attempt} complete • rechecking ${currentLabel}`);
          session = await this.resetSkuWorkflow(objectId, `Attempt ${attempt} complete`, false);
        } catch (error) {
          const message = String(error?.message || error);

          if (/failed to change consumer type|retryError/i.test(message)) {
            session = await this.resetSkuWorkflow(objectId, `Attempt ${attempt}`);
            continue;
          }

          if (/backend ERRORED|status ERRORED|returned error/i.test(message)) {
            await this.recoverSkuBackendError(objectId, meta.sku, attempt);
            return;
          }

          throw error;
        }
      }

      throw new Error('Stopped by user');
    },

    async startEachDirect() {
      if (this.directBusy || this.mode !== 'each') return;
      const items = this.parseEachQueue($('[data-list]', this.panel)?.value);
      if (!items.length) return this.status('Paste TOTE ASIN rows');
      const meta = {
        desiredState: $('[data-state]', this.panel).value,
        desiredDamage: $('[data-disp]', this.panel).value
      };
      localStorage.setItem('aftm_each_state', meta.desiredState);
      localStorage.setItem('aftm_each_disp', meta.desiredDamage);
      await this.directRun(() => this.runEachQueue(items, meta));
    },

    async closeEachObject(objectId, label = 'Close Each workflow') {
      if (!objectId) return;
      try {
        await EditApi.end(objectId);
        this.eachEndedObjectIds.add(objectId);
      } finally {
        if (this.eachActiveObjectId === objectId) this.eachActiveObjectId = null;
      }
    },

    async acquireEachObject(oldObjectId = null, targetLocation = '') {
      let last = null;

      // Server state owns Each task identity. Visible DOM can stay stale after /end.
      for (let attempt = 1; attempt <= 12; attempt++) {
        if (this.stopRequested) throw new Error('Stopped by user');

        const snap = await this.fetchState(`Each start ${attempt}`);
        last = snap;

        if (!snap.objectId) {
          await sleep(attempt <= 3 ? 40 : 80);
          continue;
        }

        if (
          snap.objectId === oldObjectId ||
          this.eachEndedObjectIds.has(snap.objectId)
        ) {
          await sleep(attempt <= 3 ? 40 : 80);
          continue;
        }

        const ready = await EditApi.wait(snap.objectId, `Each start ${attempt}`);

        if (ready.state !== 'READY') {
          await sleep(40);
          continue;
        }

        if (snap.state === 'location') {
          return { ...snap, startState: 'location' };
        }

        if (snap.state === 'item') {
          const target = low(targetLocation);
          if (target && low(snap.text).includes(target)) {
            return { ...snap, startState: 'item' };
          }

          throw new Error(
            `Each is already on Item entry for another/unknown container. ` +
            `Start over to Scan location before running ${targetLocation || 'this row'}.`
          );
        }

        if (['loading', 'error', 'unknown'].includes(snap.state)) {
          await sleep(attempt <= 2 ? 20 : 60);
          continue;
        }

        throw new Error(
          `Mode: Each must be at Scan location or Item entry. ` +
          `Server state="${snap.state}".`
        );
      }

      throw new Error(
        `Could not acquire usable Each workflow. ` +
        `Last state="${last?.state || 'unknown'}".`
      );
    },

    async runEachOne(objectId, item, meta, index, total, startState) {
      const started = performance.now();
      const desiredState = this.mapState(meta.desiredState);
      const label = item.fnsku && low(item.fnsku) !== low(item.asin) ? `${item.fnsku} · ${item.asin}` : item.asin;
      const steps = ['Lookup', 'Source', 'Target'];
      if (desiredState === 'UNSELLABLE') steps.push('Disp');
      steps.push('Confirm', 'Done');
      this.tracker?.begin(item.location, label, steps);

      if (startState === 'location') {
        this.status(`${index}/${total} Location`);
        await EditApi.input(objectId, item.location, 'Location');
      } else if (startState !== 'item') {
        throw new Error(`Unsupported Each start state "${startState}"`);
      }

      await this.tracked('Lookup', `${index}/${total} Item`, () => EditApi.input(objectId, item.fnsku, 'Item'));
      let snap = await this.snapshot(objectId, 'After item');
      this.tracker?.active('Source');
      if (snap.state !== 'newState') {
        this.tracker?.error('Source');
        if (snap.state === 'sourceState') throw new Error('EditItems could not infer source state; stopped before mutation');
        throw new Error(`After item expected newState, got "${snap.state}"`);
      }
      this.tracker?.done('Source');

      await this.targetState(objectId, desiredState, meta.desiredDamage, `${index}/${total} `, 'Disp');
      snap = await this.confirmLoop(objectId, `${index}/${total} `);
      this.tracker?.done('Confirm');
      this.tracker?.active('Done');

      let workflowOpen = false;
      if (snap.state === 'item') {
        workflowOpen = true;
        this.tracker?.done('Done');
      } else if (snap.state === 'success') {
        await this.tracked('Done', `${index}/${total} Done`, () => EditApi.done(objectId));
      } else {
        this.tracker?.error('Done');
        throw new Error(`Expected item/success after confirm, got "${snap.state}"`);
      }

      return { objectId, workflowOpen, location: item.location, elapsed: performance.now() - started };
    },

    async runEachQueue(items, meta) {
      const started = performance.now();
      let done = 0, oldObjectId = null;
      let session = { objectId: null, location: '', open: false };

      try {
        for (let i = 0; i < items.length; i++) {
          if (this.stopRequested) throw new Error('Stopped by user');

          const item = items[i];
          let startState = 'location';

          if (session.open && low(session.location) === low(item.location)) {
            startState = 'item';
          } else {
            if (session.open && session.objectId) {
              this.status(`${done}/${items.length} Change container`);
              await this.closeEachObject(session.objectId);
              oldObjectId = session.objectId;
            }

            const fresh = await this.acquireEachObject(oldObjectId, item.location);
            session = {
              objectId: fresh.objectId,
              location: item.location,
              open: false
            };
            this.eachActiveObjectId = fresh.objectId;
            startState = fresh.startState;
          }

          const result = await this.runEachOne(
            session.objectId,
            item,
            meta,
            i + 1,
            items.length,
            startState
          );

          session = {
            objectId: result.objectId,
            location: result.location,
            open: result.workflowOpen
          };

          // COMPLETE tasks must never be reused on a later RUN.
          if (!result.workflowOpen && result.objectId) {
            this.eachEndedObjectIds.add(result.objectId);
            if (this.eachActiveObjectId === result.objectId) {
              this.eachActiveObjectId = null;
            }
          }

          done++;
          const avg = (performance.now() - started) / done;
          this.status(
            `${done}/${items.length} done • last ${(result.elapsed / 1000).toFixed(2)}s • ` +
            `avg ${(avg / 1000).toFixed(2)}s`
          );
        }

        if (session.open && session.objectId) {
          this.status('Closing workflow');
          await this.closeEachObject(session.objectId);
        }

        const total = performance.now() - started;
        this.status(
          `DONE ✓ ${done}/${items.length} • avg ${(total / done / 1000).toFixed(2)}s`
        );
      } catch (error) {
        const active = this.eachActiveObjectId || session.objectId;

        if (active && !this.eachEndedObjectIds.has(active)) {
          try {
            await this.closeEachObject(active, 'Recover Each workflow');
          } catch {
            this.eachEndedObjectIds.add(active);
            this.eachActiveObjectId = null;
            throw new Error(
              `${String(error?.message || error)} • Each recovery failed; refresh page before retry`
            );
          }
        }

        throw error;
      } finally {
        this.eachActiveObjectId = null;
      }
    },


    parseExpirationRows() {
      if (!this.panel) return [];
      return $$('.exp-row', this.panel)
        .map(row => ({
          asin: norm($('[data-code]', row)?.value),
          date: norm($('[data-date]', row)?.value)
        }))
        .filter(item => item.asin || item.date);
    },

    datePayload(date) {
      const match = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) throw new Error(`Invalid date: ${date || 'blank'}`);
      const [, year, month, day] = match;
      return JSON.stringify({
        'year-input': year,
        'month-input': month,
        'day-input': day,
        '': ''
      });
    },

    async acquireDatelotObject(oldObjectId = '') {
      let last = null;
      let resetAttempted = false;

      for (let attempt = 0; attempt < 14; attempt++) {
        if (this.stopRequested) throw new Error('Stopped by user');

        const snap = await this.fetchState(attempt ? `Datelot page ${attempt}` : 'Datelot preflight');
        last = snap;

        if (!snap.objectId) {
          await sleep(attempt < 3 ? 80 : 180);
          continue;
        }

        if (oldObjectId && snap.objectId === oldObjectId) {
          await sleep(attempt < 3 ? 100 : 220);
          continue;
        }

        try {
          await EditApi.wait(snap.objectId, 'Datelot preflight', {
            timeout: 120000
          });
        } catch {
          await sleep(150);
          continue;
        }

        if (snap.state === 'location') return snap;

        const ready = await this.fetchState(`Datelot ready ${attempt}`);
        last = ready;

        if (ready.objectId === snap.objectId && ready.state === 'location') {
          return ready;
        }

        if (!oldObjectId && !resetAttempted && ready.objectId && ready.state !== 'location') {
          resetAttempted = true;
          try {
            await EditApi.end(ready.objectId);
            oldObjectId = ready.objectId;
          } catch {}
        }

        await sleep(attempt < 4 ? 120 : 260);
      }

      throw new Error(`Could not reach Scan container. Server state="${last?.state || 'unknown'}".`);
    },

    async runDatelotItem(session, item, index, total) {
      let objectId = session.objectId;
      const prefix = `${index}/${total} ${item.asin}`;

      this.status(`${prefix} • tote`);
      await EditApi.action(objectId, 'Input', item.location, 'Datelot container', {
        timeout: 120000
        });

      let snap = await this.snapshot(objectId, 'After container');
      if (snap.state !== 'item') {
        throw new Error(`Expected Scan item after tote, got "${snap.state}"`);
      }

      this.status(`${prefix} • item`);
      await EditApi.action(objectId, 'Input', item.asin, 'Datelot item', {
        timeout: 120000
        });

      snap = await this.snapshot(objectId, 'After item');

      if (snap.state === 'dateRemove') {
        this.status(`${prefix} • remove old date`);

        await EditApi.confirm(objectId, {
          timeout: 180000
        });

        snap = await this.snapshot(objectId, 'After old date removal');
        if (snap.state !== 'success') {
          throw new Error(`Expected Success after removing old date, got "${snap.state}"`);
        }

        await EditApi.end(objectId);
        const fresh = await this.acquireDatelotObject(objectId);
        objectId = fresh.objectId;

        this.status(`${prefix} • restart tote`);
        await EditApi.action(objectId, 'Input', item.location, 'Datelot container restart', {
          timeout: 120000
        });

        snap = await this.snapshot(objectId, 'After restart container');
        if (snap.state !== 'item') {
          throw new Error(`Expected Scan item after restart tote, got "${snap.state}"`);
        }

        this.status(`${prefix} • restart item`);
        await EditApi.action(objectId, 'Input', item.asin, 'Datelot item restart', {
          timeout: 120000
        });

        snap = await this.snapshot(objectId, 'After restart item');
      }

      if (snap.state !== 'dateEntry') {
        throw new Error(`Expected Enter expiry date, got "${snap.state}"`);
      }

      this.status(`${prefix} • ${item.date}`);
      const payload = this.datePayload(item.date);

      await EditApi.action(objectId, 'Input', payload, 'Expiration date', {
        timeout: 180000
        });

      snap = await this.snapshot(objectId, 'After new date input');
      if (snap.state !== 'dateConfirm') {
        throw new Error(`Expected Confirm new expiry date, got "${snap.state}"`);
      }

      this.status(`${prefix} • save`);
      await EditApi.confirm(objectId, {
        timeout: 180000
        });

      snap = await this.snapshot(objectId, 'After save expiry date');
      if (snap.state !== 'success') {
        throw new Error(`Expected Success after saving date, got "${snap.state}"`);
      }

      return { objectId };
    },

    async runExpirationQueue(items) {
      const started = performance.now();
      let done = 0;
      let oldObjectId = '';

      for (let i = 0; i < items.length; i++) {
        if (this.stopRequested) throw new Error('Stopped by user');

        const session = await this.acquireDatelotObject(oldObjectId);
        const result = await this.runDatelotItem(session, items[i], i + 1, items.length);
        oldObjectId = result.objectId;

        done++;
        this.status(`${done}/${items.length} done`);

        try { await EditApi.end(oldObjectId); } catch {}
      }

      const seconds = ((performance.now() - started) / 1000).toFixed(2);
      this.status(`DONE ✓ ${done}/${items.length} • ${seconds}s`);
    },

    async startExpiration() {
      if (this.directBusy || this.mode !== 'datelot') return;

      const location = norm($('[data-cont]', this.panel)?.value);
      const rows = this.parseExpirationRows();

      if (!location) {
        this.status('Enter tote');
        return;
      }
      if (!rows.length) {
        this.status('Enter ASIN / FNSKU / UPC / EAN + date');
        return;
      }

      const missing = rows.find(item => !item.asin || !/^\d{4}-\d{2}-\d{2}$/.test(item.date));
      if (missing) {
        this.status('Every item needs a date');
        return;
      }

      const unique = new Map();
      for (const item of rows) {
        const key = low(item.asin);
        const existing = unique.get(key);
        if (existing && existing.date !== item.date) {
          this.status(`Duplicate ${item.asin} has different dates`);
          return;
        }
        if (!existing) unique.set(key, item);
      }

      const items = [...unique.values()].map(item => ({
        location,
        asin: item.asin,
        date: item.date
      }));

      await this.directRun(() => this.runExpirationQueue(items));
    },

  };

  const MoveApi = makeApi('MoveItems', 'moveitems', () => MoveItems.stopRequested);

  const MoveItems = {
    id: 'move',
    active: false,
    busy: false,
    stopRequested: false,
    panel: null,
    tracker: null,
    statusEl: null,
    modeNoteEl: null,
    sourceEl: null,
    destEl: null,
    itemsEl: null,
    runBtn: null,
    stopBtn: null,
    clearBtn: null,
    detectedMode: null,
    primeToken: 0,
    doneCount: 0,
    currentIndex: -1,
    currentStage: 'Idle',
    nextObjectId: null,
    primePromise: null,
    runMode: null,
    runItems: [],
    runSource: '',
    runDest: '',

    keys: {
      source: 'aftm_move_source',
      dest: 'aftm_move_dest',
      items: 'aftm_move_items',
      min: 'aftm_move_min'
    },

    match() {
      return /^aft-qt-/i.test(location.hostname) && /\/app\/moveitems/i.test(location.pathname);
    },

    detectMode(text = '') {
      if (!text && this.busy && this.detectedMode) return this.detectedMode;
      const mode = norm(text || nativeText()).match(/\bMode\s*:\s*(Multi|Each)\b/i)?.[1]?.toLowerCase() || null;
      if (mode) this.detectedMode = mode;
      return mode;
    },

    updateModeNote() {
      if (!this.modeNoteEl) return;
      const mode = this.detectMode();
      this.modeNoteEl.textContent =
        mode === 'multi' ? 'Multi • native QualityTools API' :
        mode === 'each' ? 'Each • native QualityTools API' :
        'Waiting for native Multi / Each mode…';
    },

    status(text) {
      this.currentStage = text;
      if (this.statusEl) this.statusEl.textContent = text;
      this.paintRun();
    },

    parseItems(text) {
      const seen = new Set();
      const out = [];

      for (const raw of String(text || '').split(/\r?\n/)) {
        const code = norm(raw.split(/\s+/)[0]);
        if (!code) continue;
        const key = code.toUpperCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(code);
      }

      return out;
    },

    start() {
      this.stopRequested = false;
      this.render();
    },

    stop() {
      this.stopRequested = true;
      this.busy = false;
      this.nextObjectId = null;
      this.primePromise = null;
      this.primeToken++;
      this.detectedMode = null;
      this.panel?.remove();
      this.panel = null;
      this.tracker = null;
      this.statusEl = this.modeNoteEl = null;
      this.sourceEl = this.destEl = this.itemsEl = null;
      this.runBtn = this.stopBtn = this.clearBtn = null;
    },

    refresh() {
      if (!this.panel?.isConnected) {
        this.render();
        return;
      }
      this.updateModeNote();
    },

    render() {
      if (!document.body || this.panel?.isConnected) return;

      const panel = document.createElement('section');
      panel.id = 'aftm-move';
      panel.className = 'aftm';
      panel.innerHTML = `
        <div class="move-head">
          <span>MoveItems API v${VERSION}</span>
          <button type="button" data-min>−</button>
        </div>
        <div class="move-body" data-body>
          <label>Source container
            <input data-source autocomplete="off" placeholder="tsX...">
          </label>
          <label>Destination container
            <input data-dest autocomplete="off" placeholder="tsX...">
          </label>
          <label>Items — one barcode per line
            <textarea class="move-items" data-items placeholder="X001...&#10;X001..."></textarea>
          </label>
          <div class="move-note" data-mode-note>Native QualityTools API</div>
          <textarea class="aftm-stepbox" data-steps readonly></textarea>
          <div class="move-status" data-status>Idle</div>
          <div class="aftm-row">
            <button type="button" class="move-run" data-run>RUN MOVE</button>
            <button type="button" class="move-stop" data-stop disabled>STOP</button>
            <button type="button" class="move-clear" data-clear>CLEAR</button>
          </div>
        </div>
      `;

      document.body.appendChild(panel);
      this.panel = panel;
      this.statusEl = $('[data-status]', panel);
      this.tracker = $('[data-steps]', panel);

      const source = this.sourceEl = $('[data-source]', panel);
      const dest = this.destEl = $('[data-dest]', panel);
      const items = this.itemsEl = $('[data-items]', panel);
      this.modeNoteEl = $('[data-mode-note]', panel);
      const run = this.runBtn = $('[data-run]', panel);
      const stop = this.stopBtn = $('[data-stop]', panel);
      const clear = this.clearBtn = $('[data-clear]', panel);
      const body = $('[data-body]', panel);
      const min = $('[data-min]', panel);

      source.value = localStorage.getItem(this.keys.source) || '';
      dest.value = localStorage.getItem(this.keys.dest) || '';
      items.value = localStorage.getItem(this.keys.items) || '';

      source.oninput = debounce(() => localStorage.setItem(this.keys.source, norm(source.value)));
      dest.oninput = debounce(() => localStorage.setItem(this.keys.dest, norm(dest.value)));
      items.oninput = debounce(() => localStorage.setItem(this.keys.items, items.value));

      source.addEventListener('keydown', event => {
        if (event.key !== 'Enter' || this.busy) return;
        event.preventDefault();
        event.stopPropagation();
        dest.focus();
        dest.select();
      });

      dest.addEventListener('keydown', event => {
        if (event.key !== 'Enter' || this.busy) return;
        event.preventDefault();
        event.stopPropagation();
        items.focus();
      });

      wireMin(panel, this.keys.min, body, min);

      run.onclick = () => this.startDirect();

      stop.onclick = () => {
        if (!this.busy) return;
        this.stopRequested = true;
        this.status('Stop requested');
      };

      clear.onclick = () => {
        if (this.busy) return;
        this.clearEntryFields();
        this.status('Scan source');
      };

      this.updateModeNote();
      this.paintRun();
      queueMicrotask(() => source.focus());
    },

    clearEntryFields({ focusSource = true, clearTracker = true } = {}) {
      if (!this.panel?.isConnected) return;

      const source = this.sourceEl;
      if (source) source.value = '';
      if (this.destEl) this.destEl.value = '';
      if (this.itemsEl) this.itemsEl.value = '';
      if (clearTracker && this.tracker) this.tracker.value = '';

      localStorage.removeItem(this.keys.source);
      localStorage.removeItem(this.keys.dest);
      localStorage.removeItem(this.keys.items);

      if (focusSource) {
        source?.focus();
        source?.select();
      }
    },

    paintRun(barcodes = null) {
      if (!this.panel?.isConnected) return;

      if (this.runBtn) this.runBtn.disabled = this.busy;
      if (this.stopBtn) this.stopBtn.disabled = !this.busy;
      if (this.clearBtn) this.clearBtn.disabled = this.busy;
      if (!this.tracker) return;

      const items = barcodes || this.runItems;
      if (!this.busy || !items.length) return;
      const lines = [
        `${this.runSource} → ${this.runDest}`,
        `Mode: ${String(this.runMode || '').toUpperCase()}`
      ];

      const compact = items.length > 30;
      const anchor = this.currentIndex >= 0 ? this.currentIndex : Math.min(this.doneCount, items.length - 1);
      const start = compact ? Math.max(0, anchor - 4) : 0;
      const end = compact ? Math.min(items.length, anchor + 8) : items.length;

      if (start > 0) lines.push(`… ${start} earlier`);
      for (let i = start; i < end; i++) {
        const icon = i < this.doneCount ? '✓' : i === this.currentIndex ? '→' : '○';
        lines.push(`${icon} ${items[i]}`);
      }
      if (end < items.length) lines.push(`… ${items.length - end} remaining`);

      lines.push(`API: ${this.currentStage}`);
      this.tracker.value = lines.join('\n');
      this.tracker.scrollTop = this.tracker.scrollHeight;
    },

    quantityInfoFromHtml(html) {
      const raw = String(html || '');

      for (const pattern of MOVE_QTY_PATTERNS) {
        const qty = Number(raw.match(pattern)?.[1]);
        if (Number.isInteger(qty) && qty > 0) {
          return { qty, verify: false };
        }
      }

      try {
        const doc = new DOMParser().parseFromString(raw, 'text/html');
        const bodyText = norm(doc.body?.textContent || '');

        if (/\bVerify item\b/i.test(bodyText)) {
          return { qty: null, verify: true };
        }

        let qty = readQuantity(bodyText);
        if (qty) return { qty, verify: false };

        const candidates = [...doc.querySelectorAll('body *')]
          .filter(el => /\bQuantity\b/i.test(el.textContent || ''))
          .slice(0, 80);

        for (const el of candidates) {
          const parts = [
            el.textContent || '',
            el.getAttribute?.('value') || '',
            el.getAttribute?.('data-value') || '',
            el.getAttribute?.('aria-label') || '',
            el.nextElementSibling?.textContent || '',
            el.previousElementSibling?.textContent || '',
            el.parentElement?.textContent || ''
          ];

          el.querySelectorAll?.('input,textarea,select,[value],[data-value]').forEach(child => {
            parts.push(child.value || '');
            parts.push(child.getAttribute?.('value') || '');
            parts.push(child.getAttribute?.('data-value') || '');
          });

          qty = readQuantity(norm(parts.join(' ')));
          if (qty) return { qty, verify: false };
        }
      } catch {}

      return { qty: null, verify: false };
    },

    async renderedQuantity(expectedObjectId, label) {

      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      Object.assign(frame.style, {
        position: 'fixed',
        left: '-12000px',
        top: '0',
        width: '1280px',
        height: '900px',
        opacity: '0',
        pointerEvents: 'none',
        border: '0'
      });

      document.documentElement.appendChild(frame);

      try {
        const url = new URL(location.href);
        url.hash = `aft-qty-${Date.now()}`;
        frame.src = url.href;

        const started = performance.now();
        let lastText = '';

        while (performance.now() - started < 3500) {
          if (this.stopRequested) throw new Error('Stopped by user');

          let doc = null;
          try { doc = frame.contentDocument; } catch {}

          if (doc?.documentElement) {
            const frameHtml = doc.documentElement.innerHTML || '';
            const frameObjectId = objectId(frameHtml);

            if (frameObjectId && frameObjectId !== expectedObjectId) {
              throw new Error(`${label}: rendered page objectId changed`);
            }

            const text = norm(doc.body?.innerText || doc.body?.textContent || '');
            lastText = text;

            let qty = readQuantity(text);
            if (!qty && Math.floor((performance.now() - started) / 320) % 2 === 0) {
              qty = this.quantityInfoFromHtml(frameHtml).qty;
            }
            if (qty) return qty;

            if (/\bVerify item\b/i.test(text)) {
              throw new Error(`${label}: Verify Item screen detected`);
            }
          }

          await sleep(80);
        }

        throw new Error(`${label}: rendered quantity not found${lastText ? ` | ${lastText.slice(0, 160)}` : ''}`);
      } finally {
        frame.remove();
      }
    },

    async getNativeQuantity(expectedObjectId, label) {
      if (this.stopRequested) throw new Error('Stopped by user');

      const html = await getHtml(label);
      const fetchedObjectId = objectId(html);
      assertObject(expectedObjectId, fetchedObjectId, label);

      const info = this.quantityInfoFromHtml(html);
      if (info.qty) return info.qty;
      if (info.verify) throw new Error(`${label}: Verify Item screen detected`);

      return this.renderedQuantity(expectedObjectId, label);
    },

    async primeNextSession(previousObjectId, token = null) {
      for (let attempt = 0; attempt < 5; attempt++) {
        if (token != null && token !== this.primeToken) throw new Error('Prime cancelled');
        const html = await getHtml('New MoveItems session');
        const nextId = objectId(html);

        if (nextId && nextId !== previousObjectId) {
          await MoveApi.wait(nextId, 'New MoveItems session', { ignoreStop: true, pollMs: 50, timeout: 8000 });
          if (token != null && token !== this.primeToken) throw new Error('Prime cancelled');
          this.nextObjectId = nextId;
          return nextId;
        }

        await sleep(100);
      }

      throw new Error('Could not create fresh MoveItems session');
    },

    async resetNativeSession(previousObjectId, label = 'Resetting MoveItems') {
      this.nextObjectId = null;

      if (previousObjectId) {
        this.status(`${label}…`);
        try { await MoveApi.end(previousObjectId); } catch {}
      }

      const nextId = await this.primeNextSession(previousObjectId || null);
      this.nextObjectId = null; // Fresh task consumed now
      return nextId;
    },

    async recoverAfterFailure(previousObjectId, message) {
      this.nextObjectId = null;
      this.status(`STOPPED: ${message} • resetting…`);

      try {
        const nextId = await this.resetNativeSession(
          previousObjectId || currentObjectId(),
          'Recovering MoveItems'
        );
        this.nextObjectId = nextId;
        this.status(`STOPPED: ${message} • ready to retry`);
        return true;
      } catch {
        this.status(`STOPPED: ${message} • refreshing session…`);
        setTimeout(() => location.reload(), 150);
        return false;
      }
    },

    moveInput(objectId, value, label) {
      return MoveApi.input(objectId, value, label, { pollMs: 50 });
    },

    async startDirect() {
      if (this.busy || !this.panel) return;

      const source = norm(this.sourceEl?.value);
      const dest = norm(this.destEl?.value);
      const barcodes = this.parseItems(this.itemsEl?.value);
      const mode = this.detectMode();

      if (!/^(?:ts|cs)x[0-9a-z]+$/i.test(source)) return this.status('Invalid source container');
      if (!/^(?:ts|cs)x[0-9a-z]+$/i.test(dest)) return this.status('Invalid destination container');
      if (low(source) === low(dest)) return this.status('Source and destination cannot match');
      if (!barcodes.length) return this.status('Scan/paste at least one item barcode');
      if (mode !== 'multi' && mode !== 'each') return this.status('Cannot detect Multi / Each mode');

      this.stopRequested = false;
      this.busy = true;
      this.doneCount = 0;
      this.currentIndex = 0;
      this.currentStage = 'Starting';
      this.runMode = mode;
      this.runItems = barcodes;
      this.runSource = source;
      this.runDest = dest;
      this.paintRun(barcodes);

      const started = performance.now();
      let workflowId = this.nextObjectId;

      if (!workflowId && this.primePromise) {
        try { await this.primePromise; } catch {}
        workflowId = this.nextObjectId;
      }

      this.primePromise = null;
      this.nextObjectId = null;

      try {
        if (!workflowId) {
          const liveId = currentObjectId();
          const atSourceStart = /\bScan (?:source )?container\b/i.test(nativeText());

          if (atSourceStart && liveId) {
            workflowId = liveId;
          } else {
            workflowId = await this.resetNativeSession(
              liveId,
              'Resetting previous MoveItems task'
            );
          }
        }

        if (!workflowId) throw new Error('MoveItems workflowId missing');
        this.status(`Source ${source}`);
        await this.moveInput(workflowId, source, 'Source');

        for (let i = 0; i < barcodes.length; i++) {
          if (this.stopRequested) throw new Error('Stopped by user');

          this.currentIndex = i;
          const barcode = barcodes[i];

          this.status(`${i + 1}/${barcodes.length} Item ${barcode}`);
          await this.moveInput(workflowId, barcode, `Item ${i + 1}`);

          if (mode === 'multi') {
            this.status(`${i + 1}/${barcodes.length} Reading qty`);
            const qty = await this.getNativeQuantity(workflowId, `Quantity page ${i + 1}`);

            this.status(`${i + 1}/${barcodes.length} Qty ${qty}`);
            await this.moveInput(workflowId, String(qty), `Quantity ${i + 1}`);
          }

          this.status(`${i + 1}/${barcodes.length} Destination ${dest}`);
          await this.moveInput(workflowId, dest, `Destination ${i + 1}`);

          this.doneCount = i + 1;
          this.currentIndex = i + 1 < barcodes.length ? i + 1 : -1;
          this.status(`${this.doneCount}/${barcodes.length} moved ✓`);
        }

        this.status('Finishing…');
        await MoveApi.done(workflowId);
        await MoveApi.end(workflowId);

        const elapsed = performance.now() - started;
        this.clearEntryFields({ focusSource: true, clearTracker: false });

        this.busy = false;
        this.currentIndex = -1;
        this.status(`DONE ✓ ${barcodes.length} item${barcodes.length === 1 ? '' : 's'} • ${(elapsed / 1000).toFixed(2)}s`);
        this.paintRun(barcodes);
        this.runItems = [];

        const primeToken = ++this.primeToken;
        this.primePromise = this.primeNextSession(workflowId, primeToken)
          .catch(() => null)
          .finally(() => {
            if (primeToken === this.primeToken) this.primePromise = null;
          });
      } catch (error) {
        const message = String(error?.message || error);

        this.busy = false;
        this.nextObjectId = null;
        this.paintRun(barcodes);

        await this.recoverAfterFailure(
          workflowId || currentObjectId(),
          message
        );

        this.runItems = [];
      }
    }
  };

  const FcApi = makeApi('FcSkuFlip', 'fcskuflip');

  const FcSku = {
    id: 'fcsku',
    active: false,
    busy: false,
    stopRequested: false,
    panel: null,
    statusEl: null,
    metricsEl: null,
    tracker: null,
    runBtn: null,
    stopBtn: null,

    keys: {
      old: 'fcsku_direct_queue_old',
      neu: 'fcsku_direct_queue_new',
      locations: 'fcsku_direct_queue_locations',
      min: 'aftm_fcsku_min'
    },

    match() {
      return /\/app\/fcskuflip/i.test(location.pathname);
    },

    classify(text) {
      const value = low(text);
      if (value.includes('success')) return 'success';
      if (value.includes('confirm flip')) return 'confirm';
      if (value.includes('enter new fnsku') || value.includes('enter new fcsku')) return 'new';
      if (value.includes('input item') && value.includes('fnskus')) return 'old';
      if (value.includes('scan container')) return 'container';
      return 'unknown';
    },

    status(text) {
      if (this.statusEl) this.statusEl.textContent = text;
    },

    metrics(done, total, started, lastMs = 0) {
      if (!this.metricsEl) return;
      const elapsed = performance.now() - started;
      const avg = done ? elapsed / done : 0;
      const fmt = ms => `${(ms / 1000).toFixed(2)}s`;
      this.metricsEl.textContent =
        `${done}/${total} done | last ${lastMs ? fmt(lastMs) : '—'} | avg ${done ? fmt(avg) : '—'}`;
    },

    start() {
      this.stopRequested = false;
      this.render();
    },

    stop() {
      this.stopRequested = true;
      this.busy = false;
      this.panel?.remove();
      this.panel = null;
      this.statusEl = this.metricsEl = null;
      this.tracker = null;
      this.runBtn = this.stopBtn = null;
    },

    refresh() {
      if (!this.panel?.isConnected) this.render();
    },

    render() {
      if (!document.body || this.panel?.isConnected) return;
      const panel = document.createElement('section');
      panel.id = 'aftm-fcsku'; panel.className = 'aftm';
      panel.innerHTML = `
        <div class="fcsku-head"><span>FcSku v${VERSION}</span><button data-min>−</button></div>
        <div class="fcsku-body" data-body>
          <div class="fcsku-status" data-status>Idle</div>
          <div class="fcsku-metrics" data-metrics>0/0 done | last — | avg —</div>
          <div class="fcsku-label">OLD FCSKU:</div><input data-old autocomplete="off">
          <div class="fcsku-label">NEW FCSKU:</div><input data-new autocomplete="off">
          <div class="fcsku-label">LOCATIONS / CONTAINERS:</div>
          <textarea class="fcsku-locations" data-locations placeholder="P-6-AAAAA111&#10;P-6-BBBBB222"></textarea>
          <button class="fcsku-run" data-run>START DIRECT QUEUE</button>
          <button class="fcsku-stop" data-stop disabled>STOP AFTER CURRENT ITEM</button>
          <button class="fcsku-clear" data-clear>CLEAR</button>
          <textarea class="fcsku-log" data-steps readonly></textarea>
        </div>`;
      document.body.appendChild(panel);
      this.panel = panel;
      this.statusEl = $('[data-status]', panel);
      this.metricsEl = $('[data-metrics]', panel);
      this.tracker = stepTracker($('[data-steps]', panel));
      this.runBtn = $('[data-run]', panel);
      this.stopBtn = $('[data-stop]', panel);

      const oldEl = $('[data-old]', panel), newEl = $('[data-new]', panel), locations = $('[data-locations]', panel);
      oldEl.value = localStorage.getItem(this.keys.old) || '';
      newEl.value = localStorage.getItem(this.keys.neu) || '';
      locations.value = localStorage.getItem(this.keys.locations) || '';
      oldEl.oninput = debounce(() => localStorage.setItem(this.keys.old, norm(oldEl.value)));
      newEl.oninput = debounce(() => localStorage.setItem(this.keys.neu, norm(newEl.value)));
      locations.oninput = debounce(() => localStorage.setItem(this.keys.locations, locations.value));
      wireMin(panel, this.keys.min);

      this.runBtn.onclick = () => this.startQueue();
      this.stopBtn.onclick = () => { this.stopRequested = true; this.status('Stop requested — finishing current item'); };
      $('[data-clear]', panel).onclick = () => {
        if (this.busy) return;
        this.clearForm();
        this.status('Cleared');
      };
    },

    clearForm() {
      if (!this.panel) return;
      $('[data-old]', this.panel).value = '';
      $('[data-new]', this.panel).value = '';
      $('[data-locations]', this.panel).value = '';
      for (const key of [this.keys.old, this.keys.neu, this.keys.locations]) localStorage.removeItem(key);
      this.tracker?.clear();
      if (this.metricsEl) this.metricsEl.textContent = '0/0 done | last — | avg —';
    },

    fetchState(label) { return FcApi.page(label, text => this.classify(text)); },

    currentState() {
      return liveState(text => this.classify(text));
    },

    async acquireInitialObject() {
      const state = this.currentState();
      const objectId = currentObjectId();

      if (state === 'container' && objectId) {
        return { state, objectId };
      }

      const snap = await this.fetchState('Initial workflow');
      if (snap.state !== 'container') {
        throw new Error(`Start page must be Scan container; server says ${snap.state}`);
      }
      if (!snap.objectId) throw new Error('Initial objectId not found');

      return snap;
    },

    async acquireNextObject(oldObjectId) {
      let last = null;

      for (let attempt = 0; attempt < 5; attempt++) {
        last = await this.fetchState('Next workflow');

        if (
          last.state === 'container' &&
          last.objectId &&
          last.objectId !== oldObjectId
        ) {
          return last;
        }

        await sleep(attempt < 2 ? 20 : 60);
      }

      throw new Error(
        `Next workflow unavailable | state=${last?.state || '?'} | ` +
        `object=${last?.objectId || 'missing'}`
      );
    },

    async runOne(workflowId, container, oldCode, newCode, index, total, needNext) {
      const started = performance.now();
      this.tracker?.begin(container, `${oldCode} → ${newCode}`, ['Container', 'OLD', 'NEW', 'Confirm', 'End']);
      const step = async (name, fn) => {
        this.tracker?.active(name); this.status(`${index}/${total} ${name}`);
        await fn(); this.tracker?.done(name);
      };
      await step('Container', () => FcApi.input(workflowId, container, 'Container'));
      await step('OLD', () => FcApi.input(workflowId, oldCode, 'Old'));
      await step('NEW', () => FcApi.input(workflowId, newCode, 'New'));
      await step('Confirm', () => FcApi.confirm(workflowId));
      await step('End', () => FcApi.end(workflowId));
      const next = needNext && !this.stopRequested ? await this.acquireNextObject(workflowId) : null;
      return { nextObjectId: next?.objectId || null, ms: performance.now() - started };
    },

    async runQueue(locations, oldCode, newCode) {
      const started = performance.now();
      const initial = await this.acquireInitialObject();
      let objectId = initial.objectId;
      let done = 0;
      let lastMs = 0;

      this.metrics(0, locations.length, started);

      for (let i = 0; i < locations.length; i++) {
        if (this.stopRequested) break;

        const needNext = i < locations.length - 1;
        const result = await this.runOne(
          objectId,
          locations[i],
          oldCode,
          newCode,
          i + 1,
          locations.length,
          needNext
        );

        objectId = result.nextObjectId;
        lastMs = result.ms;
        done++;
        this.metrics(done, locations.length, started, lastMs);

        if (this.stopRequested) break;
      }

      if (this.stopRequested) {
        this.status(`Stopped safely after ${done}/${locations.length}`);
        return;
      }

      const elapsed = performance.now() - started;
      this.clearForm();
      this.status(`DONE ✓ ${done} flips | avg ${(elapsed / done / 1000).toFixed(2)}s`);
    },

    async startQueue() {
      if (this.busy || !this.panel) return;

      const oldCode = norm($('[data-old]', this.panel).value);
      const newCode = norm($('[data-new]', this.panel).value);
      const seenLocations = new Set();
      const locations = [];
      for (const raw of $('[data-locations]', this.panel).value.split(/\r?\n/)) {
        const value = norm(raw);
        if (!value) continue;
        const key = low(value);
        if (seenLocations.has(key)) continue;
        seenLocations.add(key);
        locations.push(value);
      }

      if (!oldCode || !newCode) {
        this.status('Need OLD + NEW FCSKU');
        return;
      }
      if (!locations.length) {
        this.status('Need at least one container');
        return;
      }

      this.busy = true;
      this.stopRequested = false;
      this.runBtn.disabled = true;
      this.stopBtn.disabled = false;

      try {
        await this.runQueue(locations, oldCode, newCode);
      } catch (error) {
        const message = String(error?.message || error);
        this.status(`STOPPED: ${message}`);
      } finally {
        this.busy = false;
        this.runBtn.disabled = false;
        this.stopBtn.disabled = true;
      }
    }
  };

  const Control = {
    panel: null,
    editBtn: null,
    moveBtn: null,
    titleEl: null,
    noteEl: null,
    keys: {
      edit: 'aftm_toggle_edititems',
      move: 'aftm_toggle_moveitems'
    },

    relevantPage() {
      return Edit.match() || MoveItems.match();
    },

    enabled(id) {
      if (!(id in this.keys)) return true;
      return localStorage.getItem(this.keys[id]) !== '0';
    },

    setEnabled(id, on) {
      if (!(id in this.keys)) return;
      localStorage.setItem(this.keys[id], on ? '1' : '0');
      this.refresh();
      route();
    },

    currentLabel() {
      if (Edit.match()) {
        if (!this.enabled('edit')) return 'AFT • EDIT OFF';
        const mode = Edit.mode ? Edit.mode.toUpperCase() : 'EDIT';
        return `AFT • ${mode}`;
      }

      if (MoveItems.match()) {
        return this.enabled('move') ? 'AFT • MOVE' : 'AFT • MOVE OFF';
      }

      return 'AFT';
    },

    render() {
      if (!document.body || this.panel?.isConnected || !this.relevantPage()) return;

      const panel = document.createElement('section');
      panel.id = 'aftm-control';
      panel.className = 'aftm';
      panel.dataset.open = '0';
      panel.innerHTML = `
        <button type="button" class="ctrl-head" data-control-head>
          <span data-control-title>AFT</span>
          <span class="ctrl-arrow" data-control-arrow>▸</span>
        </button>
        <div class="ctrl-body">
          <button type="button" class="ctrl-toggle" data-toggle-edit>EditItems</button>
          <button type="button" class="ctrl-toggle" data-toggle-move>MoveItems</button>
          <div class="ctrl-note" data-control-note></div>
        </div>
      `;

      document.body.appendChild(panel);
      this.panel = panel;
      this.editBtn = $('[data-toggle-edit]', panel);
      this.moveBtn = $('[data-toggle-move]', panel);
      this.titleEl = $('[data-control-title]', panel);
      this.noteEl = $('[data-control-note]', panel);

      $('[data-control-head]', panel).onclick = () => {
        const open = panel.dataset.open === '1';
        panel.dataset.open = open ? '0' : '1';
        $('[data-control-arrow]', panel).textContent = open ? '▸' : '▾';
      };

      this.editBtn.onclick = () => {
        this.setEnabled('edit', !this.enabled('edit'));
      };

      this.moveBtn.onclick = () => {
        this.setEnabled('move', !this.enabled('move'));
      };

    },

    paint() {
      const panel = this.panel;
      if (!panel?.isConnected) return;

      const editOn = this.enabled('edit');
      const moveOn = this.enabled('move');
      const editActive = Edit.match() && editOn && Edit.active;
      const moveActive = MoveItems.match() && moveOn && MoveItems.active;

      this.titleEl.textContent = this.currentLabel();
      this.editBtn.dataset.on = editOn ? '1' : '0';
      this.moveBtn.dataset.on = moveOn ? '1' : '0';
      this.editBtn.dataset.active = editActive ? '1' : '0';
      this.moveBtn.dataset.active = moveActive ? '1' : '0';
      this.editBtn.textContent = `EditItems  ${editOn ? 'ON' : 'OFF'}${editActive ? ' • ACTIVE' : ''}`;
      this.moveBtn.textContent = `MoveItems  ${moveOn ? 'ON' : 'OFF'}${moveActive ? ' • ACTIVE' : ''}`;
      this.noteEl.textContent = Edit.match()
        ? `Page: EditItems${Edit.mode ? ` / ${Edit.mode.toUpperCase()}` : ''}`
        : MoveItems.match() ? 'Page: MoveItems / Native' : '';
    },

    refresh() {
      if (!this.relevantPage()) {
        this.panel?.remove();
        this.panel = null;
        this.editBtn = this.moveBtn = this.titleEl = this.noteEl = null;
        return;
      }

      this.render();
      this.paint();
    }
  };

  const modules = [Edit, MoveItems, FcSku];
  let routeQueued = false;

  function route() {
    if (routeQueued) return;
    routeQueued = true;
    requestAnimationFrame(() => {
      routeQueued = false;
      for (const module of modules) {
        const enabled = module.id === 'edit' ? Control.enabled('edit') : module.id === 'move' ? Control.enabled('move') : true;
        const run = module.match() && enabled;
        if (run && !module.active) { module.active = true; module.start(); }
        else if (!run && module.active) { module.active = false; module.stop?.(); }
        else if (run) module.refresh?.();
      }
      Control.refresh();
    });
  }

  function start() {
    injectCss();
    new MutationObserver(mutations => {
      for (const mutation of mutations) {
        const target = mutation.target?.nodeType === 1 ? mutation.target : mutation.target?.parentElement;
        if (target?.closest?.('.aftm')) continue;

        let external = !mutation.addedNodes.length && !mutation.removedNodes.length;
        for (const list of [mutation.addedNodes, mutation.removedNodes]) {
          if (external) break;
          for (const node of list) {
            const el = node.nodeType === 1 ? node : node.parentElement;
            if (!(el?.matches?.('.aftm') || el?.closest?.('.aftm'))) {
              external = true;
              break;
            }
          }
        }
        if (external) { route(); break; }
      }
    }).observe(document.body, { childList: true, subtree: true });
    addEventListener('hashchange', route, true);
    addEventListener('popstate', route, true);
    route();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
