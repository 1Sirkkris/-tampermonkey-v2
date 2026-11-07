// ==UserScript==
// @name         V2.5 | TEST BWU2 ISS Drive Runtime
// @namespace    https://github.com/1Sirkkris/iss-drive
// @version      2.5.5
// @description  Standalone Drive ISS runtime; pinned EDIT/MOVE and Sideline engines, scoped to one HTML file.
// @match        https://drive-render.corp.amazon.com/view/krmclenn@/BWU2_ISS_Console.html*
// @match        https://drive-render.corp.amazon.com/view/krmclenn%40/BWU2_ISS_Console.html*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @connect      aft-qt-jp.aka.nrt.corp.amazon.com
// @connect      aft-poirot-website-nrt.nrt.proxy.amazon.com
// @connect      pandash.amazon.com
// ==/UserScript==

(() => {
'use strict';
/* Network and protocol boundary. No request URL or request body comes from the HTML UI. */
const ISS_DRIVE_PROTOCOL = 'bwu2-iss-drive/1';
const ISS_DRIVE_VERSION = '2.5.5';
const ISS_DRIVE_ORIGIN = 'https://drive-render.corp.amazon.com';
const ISS_DRIVE_PATH = '/view/krmclenn@/BWU2_ISS_Console.html';
// A DOM event with a JSON-string payload works across Firefox's userscript sandbox.
// Requests are read-only, accepted only in this top-level Drive document.
const ISS_DRIVE_SESSION_BRIDGE = 'bwu2-iss-drive:session-v2.5.5';
const ISS_AFT_ORIGIN = 'https://aft-qt-jp.aka.nrt.corp.amazon.com';
const ISS_POIROT_ORIGIN = 'https://aft-poirot-website-nrt.nrt.proxy.amazon.com';
const issDriveFragment = new URLSearchParams(location.hash.slice(1));
const ISS_DRIVE_WORKER = issDriveFragment.get('bwu2-iss-worker');
const ISS_DRIVE_CHANNEL = issDriveFragment.get('channel') || '';
const issDriveAllowedPath = location.origin === ISS_DRIVE_ORIGIN
  && decodeURIComponent(location.pathname) === ISS_DRIVE_PATH;

function issDriveError(message, category = 'network') {
  return Object.assign(new Error(message), {category});
}

function issDriveRequest(input, options = {}) {
  const url = new URL(input);
  const method = String(options.method || 'GET').toUpperCase();
  if (![ISS_AFT_ORIGIN, ISS_POIROT_ORIGIN, 'https://pandash.amazon.com'].includes(url.origin)) {
    return Promise.reject(issDriveError('ISS transport rejected an unexpected host', 'scope'));
  }
  if (url.origin === ISS_AFT_ORIGIN && !['/app/edititems','/app/moveitems','/app/fcskuflip','/status','/action','/end'].includes(url.pathname)) {
    return Promise.reject(issDriveError('ISS transport rejected an unexpected AFT path', 'scope'));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let handle;
    const signal = options.signal;
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const fail = error => { if (settled) return; settled = true; cleanup(); reject(error); };
    const abort = () => {
      try { handle?.abort?.(); } catch {}
      fail(Object.assign(new Error('Request cancelled'), {name:'AbortError', category:'cancelled'}));
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, {once:true});
    try {
      handle = GM_xmlhttpRequest({
        method, url:url.href, headers:options.headers || {},
        data:options.body == null ? undefined : String(options.body),
        anonymous:false, timeout:20000,
        onload(response) {
          if (settled) return;
          let final;
          try { final = new URL(response.finalUrl || url.href); }
          catch { return fail(issDriveError('Invalid response URL', 'redirect')); }
          if (final.origin !== url.origin || /\/(?:sso|login|signin|auth)(?:\/|$)/i.test(final.pathname)
            || [401,403,419].includes(Number(response.status))) {
            const error=issDriveError('Session unavailable — open the native app and sign in, then Check connections', 'auth');
            Object.assign(error,{httpStatus:Number(response.status),finalOrigin:final.origin,finalPath:final.pathname});
            return fail(error);
          }
          settled = true;
          cleanup();
          const raw = String(response.responseText || '');
          const responseHeaders = String(response.responseHeaders || '');
          resolve({
            ok:response.status >= 200 && response.status < 300,
            status:Number(response.status), url:final.href,
            headers:{get(name) { return responseHeaders.split(/\r?\n/).find(line => line.toLowerCase().startsWith(String(name).toLowerCase()+':'))?.split(':').slice(1).join(':').trim() || null; }},
            text:async () => raw,
            json:async () => JSON.parse(raw)
          });
        },
        onerror:() => fail(issDriveError('Backend request failed. Check the native app session.')),
        ontimeout:() => fail(issDriveError(method === 'GET' ? 'Read timed out' : 'Request timed out — outcome UNKNOWN; verify before retry', 'timeout')),
        onabort:() => fail(Object.assign(new Error('Request cancelled'), {name:'AbortError',category:'cancelled'}))
      });
    } catch (error) { fail(error); }
  });
}

// Read-only session probes are bounded independently. This code does not alter move/flip requests.
async function issDriveCheckSessions() {
  const timeoutMs = 12000;
  const run = async worker => {
    const startedAt = Date.now();
    const controller = new AbortController();
    let timer = 0;
    let timedOut = false;
    const target = worker === 'aft'
      ? ISS_AFT_ORIGIN + '/app/edititems?experience=Desktop'
      : ISS_POIROT_ORIGIN + '/api/get-bootstrap-data?tool=V3';
    try {
      const read = (async () => {
        const response = await issDriveRequest(target, {signal:controller.signal});
        if (!response.ok) {
          const error = issDriveError('HTTP ' + response.status, 'http');
          error.httpStatus = response.status;
          throw error;
        }
        const raw = await response.text();
        if (worker === 'aft') {
          const source = raw.replace(/&quot;|&#34;|&#x22;/gi, '"').replace(/\\"/g, '"');
          if (!/"objectId"\s*:\s*"[^"\s]+"/i.test(source) || !/"instructionId"\s*:\s*"EditItems"/i.test(source)) {
            throw issDriveError('AFT returned an unexpected page; sign in and check again', 'auth');
          }
        } else {
          let data;
          try { data = JSON.parse(raw); }
          catch { throw issDriveError('Sideline returned a non-JSON page; sign in and check again', 'auth'); }
          const info = data?.warehouseInfo;
          const site = String(typeof info === 'string' ? info : info?.warehouseId || info?.id || info?.warehouse || info?.fc || info?.code || data?.warehouseId || '').toUpperCase();
          if (site !== 'BWU2') throw issDriveError(site ? 'Sideline is set to ' + site + '; BWU2 is required' : 'Sideline did not confirm a warehouse', 'site');
        }
        return {worker, ok:true, message:'Session checked'};
      })();
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(issDriveError(worker.toUpperCase() + ' session read timed out after 12s', 'timeout'));
        }, timeoutMs);
      });
      const result = await Promise.race([read, deadline]);
      return {...result, elapsedMs:Date.now()-startedAt};
    } catch (error) {
      const category = timedOut ? 'timeout' : error?.category || 'session';
      return {
        worker, ok:false,
        message:timedOut ? worker.toUpperCase() + ' session read timed out after 12s' : String(error?.message || error),
        category, elapsedMs:Date.now()-startedAt,
        httpStatus:error?.httpStatus, finalOrigin:error?.finalOrigin, finalPath:error?.finalPath
      };
    } finally { clearTimeout(timer); }
  };
  // Each service produces its own result even when the other never responds.
  return Promise.all(['aft', 'sideline'].map(run));
}

function issDriveInstallTopRuntime() {
  if (window.parent !== window) return;
  let checking = false;
  const announce = () => window.postMessage({type:'BWU2_ISS_RUNTIME_READY',protocol:ISS_DRIVE_PROTOCOL,version:ISS_DRIVE_VERSION}, ISS_DRIVE_ORIGIN);
  document.addEventListener(ISS_DRIVE_SESSION_BRIDGE, async event => {
    // DOM-bound request: unlike postMessage, does not depend on WindowProxy identity.
    // Only this document can deliver the event; frames have separate documents.
    if (event.target !== document || event.currentTarget !== document) return;
    let m;
    try { m = JSON.parse(event.detail); } catch { return; }
    // Exact top-level origin/path is enforced before installing this handler.
    if (!m || typeof m !== 'object' || m.protocol !== ISS_DRIVE_PROTOCOL) return;
    if (m.type !== 'BWU2_ISS_RUNTIME_HELLO' && m.type !== 'BWU2_ISS_SESSION_CHECK') return;
    const respond = (type, detail = {}) => window.postMessage({
      type, protocol:ISS_DRIVE_PROTOCOL, version:ISS_DRIVE_VERSION, ...detail
    }, ISS_DRIVE_ORIGIN);
    const id = typeof m.id === 'string' && /^[a-z0-9:-]{8,100}$/i.test(m.id) ? m.id : '';
    if (m.version !== ISS_DRIVE_VERSION) {
      if (m.type === 'BWU2_ISS_SESSION_CHECK' && id)
        respond('BWU2_ISS_SESSION_REJECTED', {id,reason:'version-mismatch'});
      return;
    }
    if (m.type === 'BWU2_ISS_RUNTIME_HELLO') { announce(); return; }
    if (!id) {
      respond('BWU2_ISS_SESSION_REJECTED', {reason:'invalid-check-id'});
      return;
    }
    if (checking) {
      respond('BWU2_ISS_SESSION_BUSY', {id});
      return;
    }
    checking = true;
    respond('BWU2_ISS_SESSION_RECEIVED', {id,sourceMode:'document-event'});
    try {
      const results = await issDriveCheckSessions();
      window.postMessage({type:'BWU2_ISS_SESSION_RESULT',protocol:ISS_DRIVE_PROTOCOL,version:ISS_DRIVE_VERSION,id:m.id,results}, ISS_DRIVE_ORIGIN);
    } catch (error) {
      const results = ['aft','sideline'].map(worker => ({worker,ok:false,category:'check',message:'Session check failed internally'}));
      window.postMessage({type:'BWU2_ISS_SESSION_RESULT',protocol:ISS_DRIVE_PROTOCOL,version:ISS_DRIVE_VERSION,id:m.id,results}, ISS_DRIVE_ORIGIN);
    } finally { checking = false; }
  });
  announce();
}


if (!issDriveAllowedPath) return;
if (typeof GM_xmlhttpRequest !== 'function') return;
if (!ISS_DRIVE_WORKER) { issDriveInstallTopRuntime(); return; }
if (!['aft','sideline'].includes(ISS_DRIVE_WORKER) || window.parent === window || !/^[a-f0-9]{40}$/.test(ISS_DRIVE_CHANNEL)) return;
try { if (window.parent.location.origin !== ISS_DRIVE_ORIGIN || decodeURIComponent(window.parent.location.pathname) !== ISS_DRIVE_PATH) return; } catch { return; }
const issDriveAftLocation = {
  origin:ISS_AFT_ORIGIN,hostname:new URL(ISS_AFT_ORIGIN).hostname,pathname:'/app/edititems',search:'?experience=Desktop',hash:'#iss-console-worker',
  get href(){return this.origin+this.pathname+this.search;},
  assign(){throw new Error('Native AFT navigation is unavailable in Drive worker mode');},
  reload(){throw new Error('AFT worker reload requested — stop and reconnect the console');}
};

function issDriveStartWorker() {
(() => {
  'use strict';

  const ROOT = globalThis;
  if (ROOT.BWU2Fleet) return;

  const clean = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const upper = value => clean(value).toUpperCase();

  function registerRuntimeVersion(label, version) {
    const mount = () => {
      const root = document.body || document.documentElement;
      if (!root) return;
      let host = document.getElementById('bwu2-runtime-version-stamp');
      if (!host) {
        host = document.createElement('div');
        host.id = 'bwu2-runtime-version-stamp';
        host.setAttribute('aria-hidden', 'true');
        host.style.cssText = 'position:fixed;left:50%;bottom:2px;transform:translateX(-50%);z-index:2147483000;display:flex;flex-wrap:wrap;justify-content:center;gap:2px 10px;max-width:94vw;padding:2px 7px;border-radius:6px 6px 0 0;background:rgba(255,255,255,.34);color:rgba(15,23,42,.52);box-shadow:0 0 0 1px rgba(15,23,42,.05);backdrop-filter:blur(1.5px);font:800 11px/1.25 Arial,sans-serif;letter-spacing:.2px;pointer-events:none;user-select:none;text-shadow:0 1px 1px rgba(255,255,255,.95),0 0 3px rgba(255,255,255,.75)';
        root.appendChild(host);
      }
      let item = [...host.children].find(node => node.dataset?.bwu2RuntimeKey === label);
      if (!item) {
        item = document.createElement('span');
        item.dataset.bwu2RuntimeKey = label;
        host.appendChild(item);
      }
      item.textContent = `${label} · v${version}`;
      [...host.children]
        .sort((a, b) => String(a.dataset?.bwu2RuntimeKey || '').localeCompare(String(b.dataset?.bwu2RuntimeKey || '')))
        .forEach(node => host.appendChild(node));
    };
    mount();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  }

  function createCoreClient(options = {}) {
    const client = clean(options.client);
    const defaultTimeout = Math.max(1, Number(options.defaultTimeout) || 17000);
    const responseCapture = options.responseCapture === true;
    const timeoutError = options.timeoutError;
    const pending = new Map();

    window.addEventListener('fcr-data-core:response', event => {
      let message;
      try { message = JSON.parse(String(event.detail || '')); } catch { return; }
      const job = pending.get(message?.id);
      if (!job) return;
      pending.delete(message.id);
      clearTimeout(job.timer);
      if (message.ok) job.resolve(message.data);
      else job.reject(new Error(message.error || 'FCR Data Core request failed'));
    }, responseCapture);

    window.addEventListener('fcr-data-core:progress', event => {
      let message;
      try { message = JSON.parse(String(event.detail || '')); } catch { return; }
      const job = pending.get(message?.id);
      if (!job?.onProgress) return;
      try { job.onProgress(message.data); } catch {}
    }, responseCapture);

    function request(type, payload = {}, requestOptions = {}) {
      const timeout = Math.max(1, Number(requestOptions.timeout) || defaultTimeout);
      const group = clean(requestOptions.group);
      const onProgress = typeof requestOptions.onProgress === 'function' ? requestOptions.onProgress : null;
      const id = crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          const message = typeof timeoutError === 'function'
            ? timeoutError(type)
            : clean(timeoutError) || 'FCR Data Core missing / timed out';
          reject(new Error(message));
        }, timeout);

        pending.set(id, { resolve, reject, timer, onProgress });
        window.dispatchEvent(new CustomEvent('fcr-data-core:request', {
          detail: JSON.stringify({ id, type, payload, client, group })
        }));
      });
    }

    function cancel(group = '') {
      window.dispatchEvent(new CustomEvent('fcr-data-core:cancel', {
        detail: JSON.stringify({ client, group: clean(group) })
      }));
    }

    return Object.freeze({ request, cancel });
  }

  async function runWithConcurrency(items, limit, worker) {
    let index = 0;
    const count = Math.min(Math.max(1, Number(limit) || 1), items.length);
    await Promise.all(Array.from({ length: count }, async () => {
      while (index < items.length) {
        const current = index++;
        await worker(items[current], current);
      }
    }));
  }


  function usage(prefix, key, ms = 0, count = 1) {
    window.dispatchEvent(new CustomEvent('fcr-usage:event', {
      detail: JSON.stringify({ key: `${clean(prefix)}.${clean(key)}`, ms, count })
    }));
  }

  function trace(type, data = {}) {
    try {
      if (typeof window.BWU2Trace === 'function') window.BWU2Trace(type, data);
      else window.postMessage({ __BWU2_TRACE__: true, type, data }, '*');
    } catch {}
  }

  function normalizeContainer(value, pattern) {
    const id = clean(value);
    return pattern instanceof RegExp && pattern.test(id) ? id : '';
  }

  function nextQueued(items) {
    return Array.isArray(items) ? items.find(item => item?.status === 'queued') || null : null;
  }

  function queueCounts(items) {
    const list = Array.isArray(items) ? items : [];
    const result = { total: list.length, queued: 0, active: 0, done: 0, attention: 0 };
    for (const item of list) {
      if (Object.prototype.hasOwnProperty.call(result, item?.status)) result[item.status]++;
    }
    return result;
  }

  function markUi(node, value = '1') {
    if (node?.setAttribute) node.setAttribute('data-bwu2-ui', value);
    return node;
  }

  ROOT.BWU2Fleet = Object.freeze({
    version: '0.1.1',
    clean,
    upper,
    registerRuntimeVersion,
    createCoreClient,
    runWithConcurrency,
    usage,
    trace,
    normalizeContainer,
    nextQueued,
    queueCounts,
    markUi
  });
})();

if (ISS_DRIVE_WORKER === 'aft') {
(() => {
  'use strict';
  const location = issDriveAftLocation;
  const fetch = (path, options = {}) => issDriveRequest(new URL(path, ISS_AFT_ORIGIN).href, options);


  const trustedIssOrigin = value => value === ISS_DRIVE_ORIGIN;
  const ISS_CONSOLE_WORKER = true;
  if (window.top !== window.self && !ISS_CONSOLE_WORKER) return; // ignore ordinary app iframes; allow trusted ISS Console worker
  if (window.__bwu2AftEditSkuMove) return;
  window.__bwu2AftEditSkuMove = true;


  const VERSION = '0.9.50';
  const { registerRuntimeVersion } = globalThis.BWU2Fleet;
  registerRuntimeVersion('AFT', VERSION);


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
      else window.parent.postMessage({ __BWU2_TRACE__: true, _issDrive: ISS_DRIVE_CHANNEL, type, data: payload }, ISS_DRIVE_ORIGIN);
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
    'pending research': /\bPending[\s_]+Research\s*\(\s*Quantity\s*:\s*(\d{1,7})\s*\)/i,
    unsellable: /\bUnsellable\s*\(\s*Quantity\s*:\s*(\d{1,7})\s*\)/i
  };

  const HEADERS = {
    'Content-Type': 'application/json; charset=utf-8',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest'
  };

  async function post(path, payload, label = path) {
    const started = performance.now();
    let status = 0, ok = false;
    try {
      const res = await fetch(path, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: HEADERS, body: JSON.stringify(payload)
      });
      status = res.status;
      if (!res.ok) {
        let detail = '';
        try { detail = norm(await res.text()).slice(0, 180); } catch {}
        throw new Error(`${label}: HTTP ${res.status}${detail ? ` | ${detail}` : ''}`);
      }
      ok = true;
      return res;
    } finally {
      traceAft('AFT_API_CALL', { endpoint:path.split('?')[0], method:'POST',
        status, ok, ms:Math.round(performance.now()-started) });
    }
  }

  async function getHtml(label = 'GET') {
    const started = performance.now();
    let status = 0, ok = false, html = '';
    try {
      const res = await fetch(location.pathname + location.search, {
        credentials: 'same-origin', cache: 'no-store'
      });
      status = res.status;
      if (!res.ok) throw new Error(`${label}: GET HTTP ${res.status}`);
      html = await res.text();
      ok = true;
    } finally {
      traceAft('AFT_API_CALL', { endpoint:location.pathname, method:'GET',
        status, ok, ms:Math.round(performance.now()-started), bytes:html.length });
    }

    if (/\/app\/(?:edititems|moveitems)/i.test(location.pathname)) {
      const lower = html.toLowerCase();
      traceAft('AFT_PAGE_MARKERS', {
        label,
        path: location.pathname,
        chars: html.length,
        objectIdAt: lower.indexOf('objectid'),
        quantityAt: lower.indexOf('quantity'),
        sourceStateAt: lower.indexOf('select source inventory state'),
        newStateAt: lower.indexOf('select new inventory state'),
        confirmAt: lower.indexOf('confirm change'),
        successAt: lower.indexOf('success'),
        verifyAt: lower.indexOf('verify item')
      });
    }

    return html;
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

      try {
        await post('/action', { ...id(objectId), action: actionName, input }, `${label} action`);
      } catch (error) {
        // Explicit 4xx means the action was rejected. Network loss / 5xx is
        // uncertain because the backend may have received the mutation.
        if (!/\bHTTP 4\d\d\b/i.test(String(error?.message || error))) {
          if (error && typeof error === 'object') error.aftActionSubmitted = true;
        }
        throw error;
      }

      try {
        return await wait(objectId, label, opts);
      } catch (error) {
        // A backend ERRORED status is a definitive rejection. Lost/malformed/
        // timed-out confirmation after submission is not safe to replay.
        if (!/backend ERRORED/i.test(String(error?.message || error))) {
          if (error && typeof error === 'object') error.aftActionSubmitted = true;
        }
        throw error;
      }
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
      #aftm-each,#aftm-sku,#aftm-move{top:125px;left:15px;width:318px}#aftm-each{width:368px;max-width:calc(100vw - 30px);background:#eef7fb;border-color:#527985}#aftm-each .timer{display:flex;align-items:center;justify-content:space-between;gap:8px;background:#e8f6ff;padding:7px 10px;font-weight:700}#aftm-each .danger{background:#d94a4a;color:#fff;border:1px solid #b93737;padding:6px 10px;border-radius:6px}#aftm-each .body{gap:9px;background:#f4fafc}#aftm-each .each-choice-buttons{display:grid;gap:6px}#aftm-each .each-state-buttons{grid-template-columns:repeat(3,minmax(0,1fr))}#aftm-each .each-disp-buttons{grid-template-columns:repeat(2,minmax(0,1fr))}#aftm-each .each-choice-btn{min-width:0;padding:8px 5px;border:1px solid #8fa2aa;border-radius:6px;background:#fff;color:#26343a;font-size:12px;white-space:nowrap}#aftm-each .each-choice-btn[data-active="1"]{background:#295f58;color:#fff;border-color:#173f3a;box-shadow:inset 0 0 0 1px #fff7}#aftm-each .each-choice-btn:focus-visible{outline:3px solid #f59e0b;outline-offset:1px}#aftm-each [data-list]{min-height:126px;resize:vertical;font:12px/1.45 Consolas,monospace}#aftm-each .primary{min-height:38px;font-size:13px}#aftm-each .aftm-stepbox{height:126px;min-height:116px;font-size:11px;line-height:1.5;background:#fbfdfe}#aftm-each .aftm-status{min-height:28px;padding:5px 7px;border:1px solid #c3d3d9;border-radius:5px;background:#e8f3f7;font-weight:700}#aftm-sku .sku-top{display:grid;grid-template-columns:1fr;gap:7px}#aftm-sku .sku-qty-wrap{display:grid;gap:4px}#aftm-sku .sku-qty-label{font-weight:800}#aftm-sku .sku-qty-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}#aftm-sku .sku-qty-card{min-width:0;display:grid;gap:2px;padding:6px 7px;border:1px solid #9fb0b7;border-top-width:3px;border-radius:6px;background:#fff;text-align:center}#aftm-sku .sku-qty-name{font:800 10px/1 Arial,sans-serif;letter-spacing:.25px;color:#53666e}#aftm-sku .sku-qty-value{font:900 18px/1 Consolas,monospace;color:#17262d}#aftm-sku .sku-qty-card[data-tone="s"]{border-top-color:#146eb4;background:#eef6ff}#aftm-sku .sku-qty-card[data-tone="p"]{border-top-color:#c56a00;background:#fff6e8}#aftm-sku .sku-qty-card[data-tone="u"]{border-top-color:#5d6670;background:#f3f5f6}#aftm-sku .two{display:grid;grid-template-columns:1fr 1fr;gap:8px}#aftm-sku .sku-stepcards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;min-height:0}#aftm-sku .sku-stepcards[data-count="1"]{grid-template-columns:1fr}#aftm-sku .sku-card{min-width:0;border:1px solid #9aa8af;border-radius:6px;background:#fff;overflow:hidden}#aftm-sku .sku-card-title{padding:5px 7px;background:#e9eef0;border-bottom:1px solid #c8d0d4;font:700 10px/1.25 Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#aftm-sku .sku-card-steps{padding:5px 7px;display:grid;gap:2px;font:10px/1.25 Consolas,monospace}#aftm-sku .sku-step{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#aftm-sku .sku-step[data-state="active"]{font-weight:800;background:#eef7f4;border-radius:3px;padding:1px 3px;margin:0 -3px}#aftm-sku .sku-step[data-state="error"]{font-weight:800}
      #aftm-sku{width:368px;max-width:calc(100vw - 30px);background:#eef7fb;border-color:#527985}#aftm-sku .body{gap:9px;background:#f4fafc}#aftm-sku .two{grid-template-columns:1fr;gap:8px}#aftm-sku .sku-picker-group{display:grid;gap:6px;padding:8px;border:1px solid #c3d3d9;border-radius:7px;background:#f9fcfd}#aftm-sku .sku-picker-label{font-weight:800}#aftm-sku .sku-choice-buttons{display:grid;gap:6px}#aftm-sku .sku-state-buttons{grid-template-columns:repeat(3,minmax(0,1fr))}#aftm-sku .sku-disp-buttons{grid-template-columns:repeat(2,minmax(0,1fr))}#aftm-sku .sku-choice-btn{min-width:0;padding:8px 5px;border:1px solid #8fa2aa;border-radius:6px;background:#fff;color:#26343a;font-size:12px;white-space:nowrap}#aftm-sku .sku-choice-btn[data-active="1"]{background:#295f58;color:#fff;border-color:#173f3a;box-shadow:inset 0 0 0 1px #fff7}#aftm-sku .sku-choice-btn:disabled{background:#e5eaec;color:#879298;border-color:#c3ccd0;opacity:1;cursor:not-allowed}#aftm-sku .sku-choice-btn:focus-visible{outline:3px solid #f59e0b;outline-offset:1px}#aftm-sku .sku-route-summary{padding:8px 9px;border:2px solid #36545c;border-left:7px solid #146eb4;border-radius:6px;background:#eef6ff;color:#172536;font:900 12px/1.35 Arial,sans-serif;text-align:center}#aftm-sku .sku-route-summary .from,#aftm-sku .sku-route-summary .to{font-family:Consolas,monospace}#aftm-sku .sku-route-summary .arrow{padding:0 6px;color:#8a4b00;font-size:15px}#aftm-sku .aftm-status{min-height:28px;padding:5px 7px;border:1px solid #c3d3d9;border-radius:5px;background:#e8f3f7;font-weight:700}
      #aftm-datelot{right:12px;bottom:12px;width:420px}#aftm-datelot .exp-grid-head,#aftm-datelot .exp-row{display:grid;grid-template-columns:minmax(0,1fr) 150px;gap:10px;align-items:center;min-width:0;width:100%}#aftm-datelot .exp-grid-head{padding:0 2px;font-size:10px;font-weight:800;color:#617078}#aftm-datelot .exp-grid-head span{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#aftm-datelot .exp-rows{display:grid;gap:6px;max-height:205px;overflow-y:auto;overflow-x:hidden;padding-right:2px;min-width:0}#aftm-datelot .exp-row{min-width:0;width:100%;overflow:hidden}#aftm-datelot .exp-row input{min-width:0;max-width:100%;width:100%;padding:6px}#aftm-datelot .exp-row [data-code]{font-family:Consolas,monospace;font-size:12px}#aftm-datelot .exp-row [data-date]{min-width:0;width:100%}#aftm-datelot .exp-add{background:#edf1f2;color:#263238;border:1px solid #a8b4ba;padding:6px;border-radius:5px}#aftm-datelot .exp-busy{position:absolute;inset:39px 0 0;z-index:20;background:rgba(236,240,242,.86);backdrop-filter:blur(1px);display:grid;place-items:center;padding:18px}#aftm-datelot .exp-busy-card{min-width:210px;max-width:300px;padding:16px 18px;border:1px solid #94a3aa;border-radius:8px;background:#fff;box-shadow:0 5px 18px #0003;text-align:center}#aftm-datelot .exp-spinner{width:34px;height:34px;margin:0 auto 10px;border:4px solid #c7d0d4;border-top-color:#2f6f63;border-radius:50%;animation:aftm-exp-spin .75s linear infinite}#aftm-datelot .exp-busy-title{font-size:14px;font-weight:900;letter-spacing:.4px;color:#24343a}#aftm-datelot .exp-busy-status{margin-top:5px;min-height:16px;font-size:11px;font-weight:700;color:#54646b}#aftm-datelot .exp-busy-stop{margin-top:11px;width:100%;padding:7px;border:1px solid #a8b4ba;border-radius:5px;background:#e8ecee;color:#182126;font-weight:800}@keyframes aftm-exp-spin{to{transform:rotate(360deg)}}#aftm-move{border-color:#225d67}#aftm-move .move-head{background:#225d67}#aftm-move .move-items{height:104px;resize:vertical;font:11px Consolas,monospace}#aftm-move .move-note{font-size:10px;color:#68757b}#aftm-move .move-status{font-weight:700}
      #aftm-fcsku{top:86px;left:10px;width:320px;border-color:#002e36}#aftm-fcsku .fcsku-head{background:#002e36}#aftm-fcsku .fcsku-status{padding:5px 6px;border:1px solid #9bb;border-radius:4px;background:#fff;font-weight:700}#aftm-fcsku .fcsku-metrics{padding:4px 6px;background:#e9f6ff;border:1px solid #9bb;border-radius:4px;font-size:11px;font-weight:600}#aftm-fcsku .fcsku-label{font-weight:bold;margin-top:3px}#aftm-fcsku .fcsku-locations{height:120px;font:11px Consolas,monospace;resize:vertical}
      #aftm-control{top:76px;right:10px;width:278px;font-size:11px}#aftm-control .ctrl-head{width:100%;border:0;border-radius:0;background:#36545c;color:#fff;padding:6px 8px;display:flex;justify-content:space-between}#aftm-control .ctrl-body{padding:6px;display:grid;gap:6px;background:#eef1f2}#aftm-control[data-open="0"]{width:auto;min-width:102px}#aftm-control[data-open="0"] .ctrl-body{display:none}.ctrl-toggle{border:1px solid #9ca9ae;border-radius:5px;padding:5px 7px;background:#fff;color:#263238;text-align:left}.ctrl-toggle[data-on="1"]{background:#2f6f63;color:#fff;border-color:#25594f}.ctrl-toggle[data-on="0"]{background:#e8ecee;color:#59656b}.ctrl-toggle[data-active="1"]{box-shadow:inset 0 0 0 1px #fff8,0 0 0 1px #25594f}.ctrl-mode-group{display:grid;gap:4px;padding:5px;border:1px solid #bec9cd;border-radius:6px;background:#f8fbfc}.ctrl-mode-label{font-size:9px;font-weight:900;letter-spacing:.45px;color:#596a72}.ctrl-mode-grid{display:grid;gap:4px}.ctrl-mode-grid[data-area="edit"]{grid-template-columns:repeat(4,minmax(0,1fr))}.ctrl-mode-grid[data-area="move"]{grid-template-columns:repeat(3,minmax(0,1fr))}.ctrl-mode{min-width:0;padding:5px 3px;border:1px solid #9ca9ae;border-radius:5px;background:#fff;color:#263238;font-size:10px;font-weight:800}.ctrl-mode[data-active="1"]{background:#2f6f63;color:#fff;border-color:#25594f;box-shadow:inset 0 0 0 1px #fff8}.ctrl-mode[data-pending="1"]{background:#dce9f5;color:#174f7a;border-color:#4380ad}.ctrl-mode:disabled{opacity:.55;cursor:not-allowed}.ctrl-mode-status{min-height:25px;padding:5px 6px;border:1px solid #c4d0d4;border-radius:5px;background:#e8f2f5;font-size:10px;font-weight:800;color:#41545c}.ctrl-mode-status[data-kind="ok"]{border-color:#35836f;background:#dcefe8;color:#164d41}.ctrl-mode-status[data-kind="warn"]{border-color:#d38a19;background:#fff0cf;color:#5c3a00}.ctrl-note{font-size:10px;color:#68757b;padding:0 2px}
    `;
    style.textContent += `
      #aftm-move .move-qty{display:grid;gap:5px;padding:7px;border:1px solid #b3c0c5;border-radius:6px;background:#eaf1f3}
      #aftm-move .move-qty-title{font-size:11px;font-weight:800;color:#30444c}
      #aftm-move .move-qty-row{display:grid;grid-template-columns:64px 64px minmax(0,1fr);gap:6px}
      #aftm-move .move-qty-btn{padding:6px;border:1px solid #8fa2aa;border-radius:5px;background:#fff;color:#26343a}
      #aftm-move .move-qty-btn[data-active="1"]{background:#2f6f63;color:#fff;border-color:#25594f}
      #aftm-move .move-user-qty{text-align:center;font-weight:800}
      #aftm-move .move-qty-note{font-size:10px;color:#56666d}
    `;
    style.textContent += `
      #aftm-sku .sku-batch-wrap{display:grid;gap:6px;padding:8px;border:1px solid #b9c9cf;border-radius:7px;background:#f9fcfd}
      #aftm-sku .sku-batch-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:900}
      #aftm-sku .sku-batch-count{font-size:10px;color:#617078}
      #aftm-sku .sku-batch-queue{height:118px;min-height:88px;resize:vertical;font:12px/1.45 Consolas,monospace;background:#fff}
      #aftm-sku .sku-batch-note{font-size:10px;color:#617078}
      #aftm-sku .sku-batch-failed{padding:7px 8px;border:1px solid #a84234;border-left-width:5px;border-radius:5px;background:#fff3f1;color:#542018;font:800 11px/1.4 Consolas,monospace;white-space:pre-wrap;word-break:break-word}
      #aftm-control [data-toggle-sku-batch][hidden]{display:none!important}
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
      skuBatchMode: 'aftm_sku_batch_mode',
      skuQueue: 'aftm_sku_batch_queue',
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

    liveSnapshot() {
      const objectId = currentObjectId();
      if (!objectId) return null;
      const text = nativeText();
      return {
        doc: document,
        text,
        state: this.classify(text),
        objectId,
        live: true
      };
    },

    async snapshot(expectedObjectId, label) {
      const snap = await this.fetchState(label);
      assertObject(expectedObjectId, snap.objectId, label);
      return snap;
    },

    status(text) {
      if (this.statusEl) this.statusEl.textContent = text;
      if (this.busyStatusEl) this.busyStatusEl.textContent = text || 'Working…';
      if (ISS_CONSOLE_WORKER && this.workerProgress) {
        issWorkerProgress('edit', text, { ...this.workerProgress });
      }
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
      if (this.mode === 'sku') this.paintSkuBatchMode();
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
            <label data-sku-single-wrap>
              SKU / ASIN / FNSKU / FCSKU
              <input data-sku autocomplete="off">
            </label>
            <div class="sku-qty-wrap" aria-live="polite">
              <div class="sku-qty-label">Inventory qty</div>
              <div class="sku-qty-grid">
                <div class="sku-qty-card" data-tone="s"><span class="sku-qty-name">SELLABLE</span><span class="sku-qty-value" data-qty-s>—</span></div>
                <div class="sku-qty-card" data-tone="p"><span class="sku-qty-name">PENDING</span><span class="sku-qty-value" data-qty-p>—</span></div>
                <div class="sku-qty-card" data-tone="u"><span class="sku-qty-name">UNSELL</span><span class="sku-qty-value" data-qty-u>—</span></div>
              </div>
            </div>
          </div>

          <div class="sku-batch-wrap" data-sku-batch-wrap hidden>
            <div class="sku-batch-head">
              <span>QQSkuSku queue</span>
              <span class="sku-batch-count" data-sku-batch-count>0 items</span>
            </div>
            <textarea class="sku-batch-queue" data-sku-queue autocomplete="off" placeholder="One SKU / ASIN / FNSKU / FCSKU per line"></textarea>
            <div class="sku-batch-note">Uses the Current state → Desired state selected below.</div>
            <style>
              #aftm-sku .sku-batch-progress{display:grid;gap:4px;max-height:156px;overflow:auto;padding:2px;border-radius:6px}
              #aftm-sku .sku-batch-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;min-height:29px;padding:5px 7px;border:1px solid #c1cbd0;border-left:5px solid #b8c1c5;border-radius:5px;background:#fff;color:#26343a;font:700 11px/1.2 Consolas,monospace}
              #aftm-sku .sku-batch-row[data-state="active"]{background:#fff2a8;border-color:#d1a300;border-left-color:#a86f00;color:#2e2600}
              #aftm-sku .sku-batch-row[data-state="done"]{background:#e5e8ea;border-color:#aeb7bc;border-left-color:#7d898f;color:#4a565c}
              #aftm-sku .sku-batch-row[data-state="error"]{background:#ffe0e0;border-color:#bd514d;border-left-color:#9f1f1a;color:#681714}
              #aftm-sku .sku-batch-code{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
              #aftm-sku .sku-batch-state{font:900 10px/1 Arial,sans-serif;letter-spacing:.25px;white-space:nowrap}
            </style>
            <div class="sku-batch-progress" data-sku-batch-progress hidden aria-live="polite"></div>
            <div class="sku-batch-failed" data-sku-batch-failed hidden></div>
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

          <div class="sku-route-summary" data-sku-summary aria-live="polite">
            <span>FROM </span><span class="from" data-sku-from></span>
            <span class="arrow" aria-hidden="true">→</span>
            <span>TO </span><span class="to" data-sku-to></span>
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
      const skuQueue = $('[data-sku-queue]', panel);

      sku.value = localStorage.getItem(this.keys.sku) || '';
      skuQueue.value = localStorage.getItem(this.keys.skuQueue) || '';
      currentState.value = localStorage.getItem(this.keys.currentState) || 'Sellable';
      currentDamage.value = localStorage.getItem(this.keys.currentDamage) || 'Defective';
      desiredState.value = localStorage.getItem(this.keys.desiredState) || 'Unsellable';
      desiredDamage.value = localStorage.getItem(this.keys.desiredDamage) || 'Defective';

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

        const routeLabel = (state, damage) => {
          const stateLabel = state === 'Pending Research' ? 'Pending' : state;
          return low(state) === 'unsellable' ? `${stateLabel} • ${damage}` : stateLabel;
        };
        $('[data-sku-from]', panel).textContent = routeLabel(currentState.value, currentDamage.value);
        $('[data-sku-to]', panel).textContent = routeLabel(desiredState.value, desiredDamage.value);

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
        this.setStartQty(null);
      });
      skuQueue.oninput = debounce(() => {
        localStorage.setItem(this.keys.skuQueue, skuQueue.value);
        this.clearSkuBatchProgress();
        this.showSkuBatchFailures([]);
        this.updateSkuBatchMeta();
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

      if (this.runBtn) {
        this.runBtn.disabled = running;
        if (this.mode === 'sku') this.runBtn.textContent = this.batchSkuEnabled() ? 'RUN QUEUE' : 'RUN';
      }
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

      if (clearFields) {
        this.tracker?.clear();
        this.clearSkuBatchProgress?.();
        this.showSkuBatchFailures?.([]);
      }

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
      const lines = String(text || '').split(/\r?\n/);
      const locationOk = value => /^(?:(?:ts|cs)x[a-z0-9_-]+|P-[A-Z0-9-]+|pa[A-Z0-9_-]+)$/i.test(value);
      const itemOk = value => /^(?:[A-Z0-9]{10}|LPN[A-Z0-9]{6,24}|\d{8}|\d{12,14})$/i.test(value);
      for (let index=0; index<lines.length; index++) {
        const line = norm(lines[index]);
        if (!line) continue;
        const [location = '', asin = '', fnsku = ''] = line.split(/\s+/);
        const reason = !locationOk(location) ? 'invalid container/location'
          : !itemOk(asin) ? 'invalid ASIN/barcode'
          : fnsku && !itemOk(fnsku) ? 'invalid FNSKU/barcode (a quantity is not a barcode)' : '';
        if (reason) {
          traceAft('AFT_INPUT_BLOCKED',{mode:'each',row:index+1,reason});
          throw new Error(`Row ${index+1}: ${reason}. Expected TOTE ASIN [FNSKU]. No edit sent.`);
        }
        items.push({ location, asin, fnsku: fnsku || asin });
      }
      return items;
    },

    batchSkuEnabled() {
      return localStorage.getItem(this.keys.skuBatchMode) === '1';
    },

    setBatchSkuEnabled(on) {
      localStorage.setItem(this.keys.skuBatchMode, on ? '1' : '0');
      this.paintSkuBatchMode();
      Control.paint();
    },

    parseSkuBatchQueue(text) {
      const seen = new Set();
      const out = [];
      for (const raw of String(text || '').split(/[\s,;]+/)) {
        const value = norm(raw);
        if (!value) continue;
        const key = value.toUpperCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(value);
      }
      return out;
    },

    updateSkuBatchMeta() {
      if (!this.panel || this.mode !== 'sku') return;
      const queue = $('[data-sku-queue]', this.panel);
      const count = this.parseSkuBatchQueue(queue?.value).length;
      const el = $('[data-sku-batch-count]', this.panel);
      if (el) el.textContent = `${count} item${count === 1 ? '' : 's'}`;
    },

    paintSkuBatchMode() {
      if (!this.panel || this.mode !== 'sku') return;
      const on = this.batchSkuEnabled();
      const single = $('[data-sku-single-wrap]', this.panel);
      const batch = $('[data-sku-batch-wrap]', this.panel);
      const run = $('[data-run]', this.panel);
      if (single) single.hidden = on;
      if (batch) batch.hidden = !on;
      if (run && !this.directBusy) run.textContent = on ? 'RUN QUEUE' : 'RUN';
      this.updateSkuBatchMeta();
    },

    initSkuBatchProgress(items) {
      this.skuBatchProgress = (items || []).map(sku => ({ sku, state: 'pending', label: 'WAIT' }));
      this.drawSkuBatchProgress();
    },

    clearSkuBatchProgress() {
      this.skuBatchProgress = [];
      const el = this.panel && $('[data-sku-batch-progress]', this.panel);
      if (!el) return;
      el.hidden = true;
      el.replaceChildren();
    },

    setSkuBatchProgressState(index, state, label = '') {
      const row = this.skuBatchProgress?.[index];
      if (!row) return;
      row.state = state;
      row.label = label || ({ pending: 'WAIT', active: '▶ RUNNING', done: '✓ DONE', error: '! ERROR' }[state] || String(state).toUpperCase());
      this.drawSkuBatchProgress(index);
    },

    drawSkuBatchProgress(focusIndex = -1) {
      const el = this.panel && $('[data-sku-batch-progress]', this.panel);
      if (!el) return;
      const rows = this.skuBatchProgress || [];
      if (!rows.length) {
        el.hidden = true;
        el.replaceChildren();
        return;
      }

      const frag = document.createDocumentFragment();
      for (const row of rows) {
        const line = document.createElement('div');
        line.className = 'sku-batch-row';
        line.dataset.state = row.state;

        const code = document.createElement('span');
        code.className = 'sku-batch-code';
        code.textContent = row.sku;

        const state = document.createElement('span');
        state.className = 'sku-batch-state';
        state.textContent = row.label;

        line.append(code, state);
        frag.append(line);
      }

      el.replaceChildren(frag);
      el.hidden = false;
      if (focusIndex >= 0 && el.children[focusIndex]) {
        const row = el.children[focusIndex];
        const top = row.offsetTop;
        const bottom = top + row.offsetHeight;
        if (top < el.scrollTop) el.scrollTop = top;
        else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
      }
    },

    showSkuBatchFailures(failed) {
      const el = this.panel && $('[data-sku-batch-failed]', this.panel);
      if (!el) return;
      if (!failed?.length) {
        el.hidden = true;
        el.textContent = '';
        return;
      }
      el.hidden = false;
      el.textContent = `FAILED (${failed.length})\n${failed.map(item => item.sku).join('\n')}`;
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

      // Native EditItems exposes authoritative source quantities on the workflow radio labels.
      // Prefer those exact controls; retain broad scanning only as a compatibility fallback.
      for (const choice of this.readSkuSourceChoices(doc)) {
        const key = choice.state === 'SELLABLE'
          ? 'sellable'
          : choice.state === 'PENDING_RESEARCH'
            ? 'pending research'
            : choice.state === 'UNSELLABLE'
              ? 'unsellable'
              : '';
        if (!key || !Number.isInteger(choice.qty)) continue;
        out[key] = { qty: choice.qty, len: choice.label.length, structured: true };
      }

      const aliases = [
        ['sellable', /^(?:Inventory|Sellable)$/i],
        ['pending research', /^Pending[\s_]+Research$/i],
        ['unsellable', /^Unsellable$/i]
      ];

      for (const el of doc.body.querySelectorAll('label,li,tr,div')) {
        const t = norm(el.textContent || '');
        const qm = t.match(/^\s*([^()\n]{2,40})\s*\(\s*Quantity\s*:\s*(\d{1,7})\s*\)/i);
        if (!qm) continue;
        const label = norm(qm[1]);
        const qty = Number(qm[2]);
        for (const [key, rx] of aliases) {
          if (out[key]) break;
          if (rx.test(label)) {
            out[key] = { qty, len: t.length, structured: false };
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


    readSkuSourceChoices(source) {
      const doc = source?.doc || source;
      if (!doc?.querySelectorAll) return [];
      const out = [];

      for (const radio of doc.querySelectorAll('input[type="radio"]')) {
        const labels = [];
        try {
          for (const label of radio.labels || []) labels.push(label.textContent || '');
        } catch {}
        if (!labels.length) {
          labels.push(radio.closest('label')?.textContent || radio.parentElement?.textContent || '');
        }

        const label = norm(labels.join(' '));
        if (!/\bQuantity\s*:\s*\d+/i.test(label)) continue;

        const value = radio.hasAttribute('value') ? norm(radio.getAttribute('value')) : '';
        const valueState = value.replace(/\s+/g, '_').toUpperCase();
        let state = '';
        if (valueState === 'PENDING_RESEARCH' || /Pending[\s_]+Research/i.test(label)) state = 'PENDING_RESEARCH';
        else if (valueState === 'UNSELLABLE' || /\bUnsellable\b/i.test(label)) state = 'UNSELLABLE';
        else if (['INVENTORY','SELLABLE'].includes(valueState) || /\b(?:Inventory|Sellable)\b/i.test(label)) state = 'SELLABLE';
        if (!state) continue;

        const qtyMatch = label.match(/\bQuantity\s*:\s*(\d{1,7})\b/i);
        out.push({
          state,
          label,
          value,
          qty: qtyMatch ? Number(qtyMatch[1]) : null,
          disabled: !!radio.disabled
        });
      }

      return out;
    },

    resolveSkuSourceInput(source, wantedState) {
      const choices = this.readSkuSourceChoices(source);
      if (!choices.length) return { input: wantedState, matched: false, choices };

      const choiceState = wantedState === 'INVENTORY' ? 'SELLABLE' : wantedState;
      const matches = choices.filter(choice => choice.state === choiceState);
      if (matches.length === 1) {
        const selected = matches[0];
        return {
          input: selected.value || wantedState,
          matched: true,
          choices,
          selected
        };
      }

      const available = [...new Set(choices.map(choice => choice.state))].join(', ') || 'unknown';
      if (!matches.length) {
        throw new Error(`Requested source ${wantedState} not available; found ${available}`);
      }

      throw new Error(`Multiple ${wantedState} source options found (${matches.length}); manual selection required`);
    },

    setStartQty(value) {
      if (!this.panel) return;
      const qty = key => Number.isInteger(value?.[key]?.qty) ? value[key].qty : '—';
      const values = {
        '[data-qty-s]': value ? qty('sellable') : '—',
        '[data-qty-p]': value ? qty('pending research') : '—',
        '[data-qty-u]': value ? qty('unsellable') : '—'
      };
      for (const [selector, amount] of Object.entries(values)) {
        const el = $(selector, this.panel);
        if (el) el.textContent = String(amount);
      }
    },

    async resetSkuWorkflow(objectId, reason = 'Retry', endCurrent = true, allowReload = true) {
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
      if (!allowReload) throw new Error('Could not reset Edit SKU workflow without page reload');
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
                this.status(`RECOVERED ✓ • ${sku} • rechecking quantity`);
                return snap;
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

    async restoreSkuBatchReady(options = {}) {
      const endCurrent = options.endCurrent === true;
      const timeout = Number.isFinite(options.timeout) ? options.timeout : 30000;
      const started = performance.now();
      let blockedObjectId = options.oldObjectId || null;
      let cleanupDone = !endCurrent;
      let last = null;
      let attempt = 0;
      let readErrors = 0;

      while (performance.now() - started < timeout) {
        if (this.stopRequested) throw new Error('Stopped by user');
        attempt++;

        let snap;
        try {
          snap = await this.fetchState(`Queue recovery ${attempt}`);
          readErrors = 0;
        } catch (error) {
          const message = String(error?.message || error);
          if (/networkerror|failed to fetch|fetch resource/i.test(message) && readErrors < 2) {
            readErrors++;
            this.status(`Queue recovery • network blip ${readErrors}/2`);
            await sleep(220);
            continue;
          }
          throw error;
        }

        last = snap;

        if (snap.objectId && blockedObjectId && snap.objectId === blockedObjectId) {
          await sleep(220);
          continue;
        }

        if (snap.objectId && snap.state === 'item') {
          const ready = await EditApi.wait(snap.objectId, `Queue recovery ${attempt}`, { timeout: 12000 });
          if (ready.state === 'READY') return snap;
        }

        // Failed-item recovery may close the one workflow we actually failed in.
        // After that, only WAIT for AFT to create/settle the next task. Ending every
        // new object was causing the queue to destroy its own recovery tasks.
        if (!cleanupDone && snap.objectId) {
          cleanupDone = true;
          blockedObjectId = snap.objectId;
          try { await EditApi.end(snap.objectId); } catch {}
          this.status('Queue recovery • closed failed workflow • waiting');
        }

        await sleep(250);
      }

      throw new Error(`Queue recovery timed out; last state="${last?.state || 'unknown'}"`);
    },

    async startSkuBatchDirect() {
      if (this.directBusy || this.mode !== 'sku') return;
      const queueEl = $('[data-sku-queue]', this.panel);
      const items = this.parseSkuBatchQueue(queueEl?.value);
      if (!items.length) return this.status('Paste SKU / ASIN / FNSKU / FCSKU rows');

      const meta = {
        currentState: $('[data-cur-state]', this.panel).value,
        currentDamage: $('[data-cur-dmg]', this.panel).value,
        desiredState: $('[data-new-state]', this.panel).value,
        desiredDamage: $('[data-new-dmg]', this.panel).value
      };
      for (const [keyName, value] of [
        [this.keys.currentState, meta.currentState], [this.keys.currentDamage, meta.currentDamage],
        [this.keys.desiredState, meta.desiredState], [this.keys.desiredDamage, meta.desiredDamage],
        [this.keys.skuQueue, queueEl.value]
      ]) localStorage.setItem(keyName, value);

      this.setStartQty(null);
      this.tracker?.restartSameSku?.();
      this.showSkuBatchFailures([]);
      this.initSkuBatchProgress(items);
      await this.directRun(() => this.runSkuBatchQueue(items, meta));
    },

    async runSkuBatchQueue(items, baseMeta) {
      let flipped = 0;
      let zero = 0;
      const failed = [];

      for (let i = 0; i < items.length; i++) {
        if (this.stopRequested) throw new Error('Stopped by user');
        const sku = items[i];
        this.workerProgress = { current:i + 1, total:items.length, mode:'sku', sku, inventoryQty:null };
        this.status(`${i + 1}/${items.length} • ${sku}`);
        this.setSkuBatchProgressState(i, 'active', '▶ RUNNING');

        try {
          const result = await this.runSkuDirect(
            { ...baseMeta, sku },
            { maxRecoveries: 6, allowReload: false }
          );
          if (result?.outcome === 'zero') {
            zero++;
            this.setSkuBatchProgressState(i, 'done', '— 0 QTY');
          } else {
            flipped++;
            this.setSkuBatchProgressState(i, 'done', '✓ DONE');
          }
        } catch (error) {
          if (this.stopRequested) throw error;
          this.setSkuBatchProgressState(i, 'error', '! ERROR');
          failed.push({ sku, message: String(error?.message || error) });
          this.showSkuBatchFailures(failed);
          this.status(`${i + 1}/${items.length} FAILED • resetting`);
          try {
            await this.restoreSkuBatchReady({ endCurrent: true, timeout: 30000 });
          } catch (recoveryError) {
            recoveryError.aftPartial = {
              kind:'edit-sku',
              done:flipped + zero,
              total:items.length,
              failed:[...failed],
              remaining:[sku, ...items.slice(i + 1)]
            };
            throw recoveryError;
          }
        }
      }

      this.showSkuBatchFailures(failed);
      this.status(`DONE ✓ ${flipped} flipped • ${zero} zero • ${failed.length} failed`);
      return { flipped, zero, failed };
    },

    async startSkuDirect() {
      if (this.directBusy || this.mode !== 'sku') return;
      if (this.batchSkuEnabled()) return this.startSkuBatchDirect();
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

      const live = this.liveSnapshot();
      if (live?.state === 'item' && live.objectId) {
        try {
          const ready = await EditApi.wait(live.objectId, 'SKU preflight');
          if (ready.state === 'READY') {
            traceAft('AFT_STATE_SOURCE', {
              label: 'SKU preflight',
              source: 'live',
              state: live.state
            });
            return live;
          }
        } catch {}
      }

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

    async runSkuDirect(meta, options = {}) {
      const currentState = this.mapState(meta.currentState);
      const desiredState = this.mapState(meta.desiredState);
      const currentLabel = meta.currentState;
      const maxRecoveries = Number.isFinite(options.maxRecoveries) ? options.maxRecoveries : Infinity;

      let session = await this.acquireSkuObject();
      let attempt = 0;
      let initialQty = null;
      let lastQty = null;
      let didFlip = false;
      let recoveries = 0;

      const recover = async (objectId, reason, endCurrent = true) => {
        recoveries++;
        const recoveryLimit = Number.isFinite(maxRecoveries) ? Math.max(0, maxRecoveries - 1) : Infinity;
        if (Number.isFinite(recoveryLimit) && recoveries > recoveryLimit) {
          throw new Error(`${reason} • failed after ${recoveryLimit} recoveries`);
        }
        const recoveryText = Number.isFinite(recoveryLimit)
          ? `recovery ${recoveries}/${recoveryLimit}`
          : `recovery ${recoveries}`;
        this.status(`${reason} → ${recoveryText}`);
        return this.resetSkuWorkflow(
          objectId,
          `${reason} • ${recoveryText}`,
          endCurrent,
          options.allowReload !== false
        );
      };

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
          this.status(`Attempt ${attempt} • Qty`);
          const sourcePage = await this.snapshot(objectId, `Source inventory ${attempt}`);

          if (sourcePage.state === 'retryError') {
            this.tracker?.error('Qty');
            session = await recover(objectId, `Expected error ${attempt}`);
            continue;
          }
          if (sourcePage.state !== 'sourceState') {
            throw new Error(`Expected sourceState after lookup, got "${sourcePage.state}"`);
          }

          const inventory = this.readEditInventory(sourcePage.doc);
          this.setStartQty(inventory);
          if (ISS_CONSOLE_WORKER && this.workerProgress) {
            this.workerProgress = {
              ...this.workerProgress,
              inventoryQty:{
                sellable:Number.isInteger(inventory.sellable?.qty) ? inventory.sellable.qty : null,
                pending:Number.isInteger(inventory['pending research']?.qty) ? inventory['pending research'].qty : null,
                unsellable:Number.isInteger(inventory.unsellable?.qty) ? inventory.unsellable.qty : null
              }
            };
            issWorkerProgress('edit', `Attempt ${attempt} • Qty`, { ...this.workerProgress });
          }
          const qty = this.readEditQty(sourcePage, currentLabel);
          if (qty != null && initialQty == null) initialQty = qty;
          if (Number.isInteger(qty)) {
            if (Number.isInteger(lastQty) && qty < lastQty) {
              didFlip = true;
              recoveries = 0;
              traceAft('AFT_SKU_PROGRESS', {
                sku: meta.sku,
                attempt,
                currentState,
                previousQty: lastQty,
                qty,
                moved: lastQty - qty
              });
            }
            lastQty = qty;
          }
          traceAft('AFT_SKU_QTY', {
            sku: meta.sku,
            attempt,
            currentState,
            qty,
            initialQty,
            sellable: inventory.sellable?.qty ?? null,
            pendingResearch: inventory['pending research']?.qty ?? null,
            unsellable: inventory.unsellable?.qty ?? null
          });
          this.tracker?.done('Qty');

          if (qty === 0) {
            this.status(`DONE ✓ 0 ${currentLabel} remaining`);
            try { await EditApi.end(objectId); } catch {}
            return { outcome: didFlip ? 'done' : 'zero' };
          }
          if (qty == null) throw new Error(`Could not read ${currentLabel} quantity`);

          const sourceChoice = this.resolveSkuSourceInput(sourcePage, currentState);
          traceAft('AFT_SKU_SOURCE_CHOICE', {
            sku: meta.sku,
            requestedState: currentState,
            matchedStructuredChoice: sourceChoice.matched,
            selectedLabel: sourceChoice.selected?.label || '',
            optionStates: sourceChoice.choices.map(choice => choice.state)
          });
          if (sourceChoice.matched) {
            this.status(`Attempt ${attempt} • source matched ${currentLabel}`);
          }

          await this.tracked('Source', `Attempt ${attempt} • ${currentLabel} (${qty})`, () =>
            EditApi.action(objectId, 'Input', sourceChoice.input, 'Source state', {
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
            session = await recover(objectId, `Attempt ${attempt} source did not advance`);
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
              session = await recover(objectId, `Attempt ${attempt} consumer-type error`);
              continue;
            }
            throw error;
          }

          if (snap.state === 'retryError') {
            session = await recover(objectId, `Attempt ${attempt} retry error`);
            continue;
          }
          if (snap.state !== 'success') throw new Error(`Expected success after confirm, got "${snap.state}"`);

          this.tracker?.done('Confirm');
          await this.tracked('Done', `Attempt ${attempt} • Success → Done`, () => EditApi.done(objectId));
          await EditApi.end(objectId);
          didFlip = true;
          recoveries = 0;

          this.status(`Attempt ${attempt} complete • rechecking ${currentLabel}`);
          session = options.allowReload === false
  ? await this.restoreSkuBatchReady({ oldObjectId: objectId, timeout: 30000 })
  : await this.resetSkuWorkflow(objectId, `Attempt ${attempt} complete`, false);
        } catch (error) {
          const message = String(error?.message || error);

          if (/failed to change consumer type|retryError/i.test(message)) {
            session = await recover(objectId, `Attempt ${attempt} consumer-type error`);
            continue;
          }

          if (/backend ERRORED|status ERRORED|returned error/i.test(message)) {
            if (Number.isFinite(options.maxRecoveries)) {
              session = await recover(objectId, `Attempt ${attempt} backend error`);
              continue;
            }
            session = await this.recoverSkuBackendError(objectId, meta.sku, attempt);
            if (!session) return;
            continue;
          }

          throw error;
        }
      }

      throw new Error('Stopped by user');
    },

    async startEachDirect() {
      if (this.directBusy || this.mode !== 'each') return;
      let items;
      try { items = this.parseEachQueue($('[data-list]', this.panel)?.value); }
      catch (error) { this.status(error.message); return; }
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
      this.status(`${index}/${total} Source`);
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
          this.workerProgress = { current:i + 1, total:items.length, mode:'each' };
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
        return { done, total:items.length };
      } catch (error) {
        const active = this.eachActiveObjectId || session.objectId;

        if (active && !this.eachEndedObjectIds.has(active)) {
          try {
            await this.closeEachObject(active, 'Recover Each workflow');
          } catch {
            this.eachEndedObjectIds.add(active);
            this.eachActiveObjectId = null;
            const recoveryError = new Error(
              `${String(error?.message || error)} • Each recovery failed; refresh page before retry`
            );
            recoveryError.aftPartial = {
              kind:'edit-each',
              done,
              total:items.length,
              remaining:items.slice(done).map(item => [item.location, item.asin, item.fnsku].filter(Boolean).join(' '))
            };
            throw recoveryError;
          }
        }

        error.aftPartial = {
          kind:'edit-each',
          done,
          total:items.length,
          remaining:items.slice(done).map(item => [item.location, item.asin, item.fnsku].filter(Boolean).join(' '))
        };
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
    qtyControlsEl: null,
    qtyNoteEl: null,
    userQtyEl: null,
    qtyModeButtons: [],
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
    runQtyMode: 'all',
    runRequestedQty: null,
    runItems: [],
    runSource: '',
    runDest: '',

    keys: {
      source: 'aftm_move_source',
      dest: 'aftm_move_dest',
      items: 'aftm_move_items',
      qtyMode: 'aftm_move_qty_mode',
      userQty: 'aftm_move_user_qty',
      min: 'aftm_move_min'
    },

    match() {
      return /^aft-qt-/i.test(location.hostname) && /\/app\/moveitems/i.test(location.pathname);
    },

    detectMode(text = '') {
      if (!text && this.busy && this.detectedMode) return this.detectedMode;
      const mode = norm(text || nativeText()).match(/\bMode\s*:\s*(Multi|Each|Container)\b/i)?.[1]?.toLowerCase() || null;
      if (mode) this.detectedMode = mode;
      return mode;
    },

    updateModeNote() {
      if (!this.modeNoteEl) return;
      const mode = this.detectMode();
      this.modeNoteEl.textContent =
        mode === 'multi' ? 'Multi • native QualityTools API' :
        mode === 'each' ? 'Each • native QualityTools API' :
        mode === 'container' ? 'Container • native/manual mode' :
        'Waiting for native MoveItems mode…';
      if (this.qtyControlsEl) this.qtyControlsEl.hidden = mode !== 'multi';
      this.paintQtyControls();
    },

    getQtyMode() {
      return localStorage.getItem(this.keys.qtyMode) === 'user' ? 'user' : 'all';
    },

    readUserQty() {
      const raw = norm(this.userQtyEl?.value);
      if (!/^\d+$/.test(raw)) return null;
      const qty = Number(raw);
      return Number.isSafeInteger(qty) && qty >= 1 && qty <= 999999 ? qty : null;
    },

    setQtyMode(mode) {
      if (this.busy) return;
      localStorage.setItem(this.keys.qtyMode, mode === 'user' ? 'user' : 'all');
      this.paintQtyControls();
      if (mode === 'user') {
        this.userQtyEl?.focus();
        this.userQtyEl?.select();
      }
    },

    paintQtyControls() {
      const qtyMode = this.getQtyMode();
      for (const button of this.qtyModeButtons) {
        button.dataset.active = button.dataset.qtyMode === qtyMode ? '1' : '0';
        button.disabled = this.busy;
      }
      if (this.userQtyEl) this.userQtyEl.disabled = this.busy || qtyMode !== 'user';
      if (this.qtyNoteEl) {
        this.qtyNoteEl.textContent = qtyMode === 'user'
          ? 'Same entered quantity for every barcode.'
          : 'Moves all available quantity for each barcode.';
      }
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
      this.statusEl = this.modeNoteEl = this.qtyControlsEl = this.qtyNoteEl = this.userQtyEl = null;
      this.qtyModeButtons = [];
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
          <div class="move-qty" data-qty-controls hidden>
            <div class="move-qty-title">Multi quantity</div>
            <div class="move-qty-row">
              <button type="button" class="move-qty-btn" data-qty-mode="all">ALL</button>
              <button type="button" class="move-qty-btn" data-qty-mode="user">USER</button>
              <input class="move-user-qty" data-user-qty type="number" min="1" max="999999" step="1" inputmode="numeric" placeholder="Qty" disabled>
            </div>
            <div class="move-qty-note" data-qty-note></div>
          </div>
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
      this.qtyControlsEl = $('[data-qty-controls]', panel);
      this.qtyNoteEl = $('[data-qty-note]', panel);
      this.userQtyEl = $('[data-user-qty]', panel);
      this.qtyModeButtons = $$('[data-qty-mode]', panel);
      const run = this.runBtn = $('[data-run]', panel);
      const stop = this.stopBtn = $('[data-stop]', panel);
      const clear = this.clearBtn = $('[data-clear]', panel);
      const body = $('[data-body]', panel);
      const min = $('[data-min]', panel);

      source.value = localStorage.getItem(this.keys.source) || '';
      dest.value = localStorage.getItem(this.keys.dest) || '';
      items.value = localStorage.getItem(this.keys.items) || '';
      this.userQtyEl.value = localStorage.getItem(this.keys.userQty) || '';

      source.oninput = debounce(() => localStorage.setItem(this.keys.source, norm(source.value)));
      dest.oninput = debounce(() => localStorage.setItem(this.keys.dest, norm(dest.value)));
      items.oninput = debounce(() => localStorage.setItem(this.keys.items, items.value));
      this.userQtyEl.oninput = debounce(() => localStorage.setItem(this.keys.userQty, norm(this.userQtyEl.value)));
      for (const button of this.qtyModeButtons) {
        button.onclick = () => this.setQtyMode(button.dataset.qtyMode);
      }

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
      this.paintQtyControls();
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

      if (this.runBtn) this.runBtn.disabled = this.busy || this.detectMode() === 'container';
      if (this.stopBtn) this.stopBtn.disabled = !this.busy;
      if (this.clearBtn) this.clearBtn.disabled = this.busy;
      this.paintQtyControls();
      if (!this.tracker) return;

      const items = barcodes || this.runItems;
      if (!this.busy || !items.length) return;
      const lines = [
        `${this.runSource} → ${this.runDest}`,
        `Mode: ${String(this.runMode || '').toUpperCase()}`
      ];
      if (this.runMode === 'multi') {
        lines.push(this.runQtyMode === 'user'
          ? `Quantity: USER ${this.runRequestedQty}`
          : 'Quantity: ALL');
      }

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

    keepRemainingItems(barcodes) {
      if (!this.itemsEl) return;
      const remaining = barcodes.join('\n');
      this.itemsEl.value = remaining;
      localStorage.setItem(this.keys.items, remaining);
    },

    quantityInfoFromRaw(html) {
      const raw = String(html || '');

      for (const pattern of MOVE_QTY_PATTERNS) {
        const qty = Number(raw.match(pattern)?.[1]);
        if (Number.isInteger(qty) && qty > 0) {
          return { qty, verify: false };
        }
      }

      return {
        qty: null,
        verify: /\bVerify item\b/i.test(raw)
      };
    },

    quantityInfoFromHtml(html) {
      const raw = String(html || '');
      const direct = this.quantityInfoFromRaw(raw);
      if (direct.qty || direct.verify) return direct;

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

      // OBS v0.1.17 proved MoveItems quantity lands essentially at the end of the
      // ~907k response, so streaming/early-abort adds complexity without saving transfer.
      // Fetch once, use the cheap raw matcher first, then DOM/iframe only as fallbacks.
      const html = await getHtml(label);
      const fetchedObjectId = objectId(html);
      assertObject(expectedObjectId, fetchedObjectId, label);

      const direct = this.quantityInfoFromRaw(html);
      if (direct.qty) {
        traceAft('AFT_MOVE_QTY_READ', {
          label,
          source: 'raw',
          qty: direct.qty,
          charsRead: html.length
        });
        return direct.qty;
      }
      if (direct.verify) throw new Error(`${label}: Verify Item screen detected`);

      const info = this.quantityInfoFromHtml(html);
      if (info.qty) {
        traceAft('AFT_MOVE_QTY_READ', {
          label,
          source: 'dom-fallback',
          qty: info.qty,
          charsRead: html.length
        });
        return info.qty;
      }
      if (info.verify) throw new Error(`${label}: Verify Item screen detected`);

      traceAft('AFT_MOVE_QTY_READ', {
        label,
        source: 'iframe-fallback',
        qty: null,
        charsRead: html.length
      });
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
      const qtyMode = this.getQtyMode();
      const requestedQty = qtyMode === 'user' ? this.readUserQty() : null;

      if (!/^(?:(?:ts|cs)x[0-9a-z]+|P-[0-9]+-[A-Z0-9]+)$/i.test(source)) return this.status('Invalid source container');
      if (!/^(?:ts|cs)x[0-9a-z]+$/i.test(dest)) return this.status('Invalid destination container');
      if (low(source) === low(dest)) return this.status('Source and destination cannot match');
      if (!barcodes.length) return this.status('Scan/paste at least one item barcode');
      if (mode !== 'multi' && mode !== 'each') return this.status('Cannot detect Multi / Each mode');
      if (mode === 'multi' && qtyMode === 'user' && requestedQty == null) {
        this.userQtyEl?.focus();
        return this.status('Enter a whole user quantity of 1 or more');
      }

      this.stopRequested = false;
      this.busy = true;
      this.doneCount = 0;
      this.currentIndex = 0;
      this.currentStage = 'Starting';
      this.runMode = mode;
      this.runQtyMode = mode === 'multi' ? qtyMode : 'all';
      this.runRequestedQty = mode === 'multi' ? requestedQty : null;
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
            const availableQty = await this.getNativeQuantity(workflowId, `Quantity page ${i + 1}`);
            const qty = this.runQtyMode === 'user' ? this.runRequestedQty : availableQty;

            if (qty > availableQty) {
              throw new Error(
                `QTY UNAVAILABLE • ${barcode} • requested ${qty} • available ${availableQty}`
              );
            }

            this.status(`${i + 1}/${barcodes.length} Qty ${qty}/${availableQty}`);
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
        let message = String(error?.message || error);

        if (this.doneCount > 0 && this.doneCount < barcodes.length) {
          this.keepRemainingItems(barcodes.slice(this.doneCount));
          message += ` • ${this.doneCount} already moved • remaining queue kept`;
        }

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
          <textarea class="fcsku-log" data-failed readonly hidden></textarea>
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

    clearForm(clearFailures = true) {
      if (!this.panel) return;
      $('[data-old]', this.panel).value = '';
      $('[data-new]', this.panel).value = '';
      $('[data-locations]', this.panel).value = '';
      for (const key of [this.keys.old, this.keys.neu, this.keys.locations]) localStorage.removeItem(key);
      this.tracker?.clear();
      if (clearFailures) this.showFailures([]);
      if (this.metricsEl) this.metricsEl.textContent = '0/0 done | last — | avg —';
    },

    showFailures(failed = []) {
      const el = this.panel ? $('[data-failed]', this.panel) : null;
      if (!el) return;
      const containers = failed.map(item => norm(item?.container || item)).filter(Boolean);
      el.value = containers.join('\n');
      el.hidden = containers.length === 0;
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
        try {
          await fn();
          this.tracker?.done(name);
        } catch (error) {
          this.tracker?.error(name);
          throw error;
        }
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
      const failed = [];

      this.showFailures([]);
      this.metrics(0, locations.length, started);

      for (let i = 0; i < locations.length; i++) {
        if (this.stopRequested) break;

        const container = locations[i];
        const needNext = i < locations.length - 1;

        try {
          const result = await this.runOne(
            objectId,
            container,
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
        } catch (error) {
          if (this.stopRequested) break;

          failed.push({ container, message: String(error?.message || error) });
          this.showFailures(failed);
          this.status(`${i + 1}/${locations.length} REVIEW • restarting`);

          try { await FcApi.end(objectId); } catch {}

          if (needNext) {
            try {
              const next = await this.acquireNextObject(objectId);
              objectId = next.objectId;
            } catch (recoveryError) {
              recoveryError.fcskuPartial = {
                done,
                total: locations.length,
                failed: [...failed],
                remaining: locations.slice(i + 1)
              };
              throw recoveryError;
            }
          }
        }

        if (this.stopRequested) break;
      }

      this.showFailures(failed);

      if (this.stopRequested) {
        this.status(`Stopped safely after ${done}/${locations.length} • ${failed.length} review`);
        return { done, failed };
      }

      const elapsed = performance.now() - started;
      const avg = done ? `${(elapsed / done / 1000).toFixed(2)}s` : '—';
      this.clearForm(false);
      this.showFailures(failed);
      this.status(`DONE ✓ ${done}/${locations.length} • ${failed.length} review • avg ${avg}`);
      return { done, failed };
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


  const MODE_SWITCH_POLL_MS = 100;
  const MODE_SWITCH_STATUS_TIMEOUT_MS = 8000;
  const MODE_SWITCH_FRESH_TIMEOUT_MS = 2500;

  const MODE_DEFINITIONS = {
    'edit:each': {
      title: 'Edit • Each', area: 'edit', mode: 'each', path: '/app/edititems',
      instructionId: 'EditItems', tool: 'edititems', input: 'EACH'
    },
    'edit:sku': {
      title: 'Edit • SKU', area: 'edit', mode: 'sku', path: '/app/edititems',
      instructionId: 'EditItems', tool: 'edititems', input: 'SKU'
    },
    'edit:date': {
      title: 'Edit • Date', area: 'edit', mode: 'date', path: '/app/edititems',
      instructionId: 'EditItems', tool: 'edititems', input: 'DATELOT'
    },
    'edit:fcsku': {
      title: 'Edit • FCSKU', area: 'edit', mode: 'fcsku', path: '/app/fcskuflip',
      instructionId: 'FcSkuFlip', tool: 'fcskuflip', input: 'SKU'
    },
    'move:each': {
      title: 'Move • Each', area: 'move', mode: 'each', path: '/app/moveitems',
      instructionId: 'MoveItems', tool: 'moveitems', input: 'EACH'
    },
    'move:multi': {
      title: 'Move • Multi', area: 'move', mode: 'multi', path: '/app/moveitems',
      instructionId: 'MoveItems', tool: 'moveitems', input: 'MULTI'
    },
    'move:container': {
      title: 'Move • Container', area: 'move', mode: 'container', path: '/app/moveitems',
      instructionId: 'MoveItems', tool: 'moveitems', input: 'CONTAINER'
    }
  };

  const ModeSwitch = {
    busy: false,
    requestedKey: '',
    message: 'Mode switch ready',
    kind: '',

    target(definition) {
      return `${location.origin}${definition.path}?experience=Desktop`;
    },

    currentKey() {
      if (FcSku.match()) return 'edit:fcsku';

      if (Edit.match()) {
        const mode = Edit.mode || Edit.detect();
        if (mode === 'datelot') return 'edit:date';
        if (mode === 'each' || mode === 'sku') return `edit:${mode}`;
      }

      if (MoveItems.match()) {
        const mode = MoveItems.detectMode();
        if (mode === 'multi' || mode === 'each' || mode === 'container') return `move:${mode}`;
      }

      return '';
    },

    workBusy() {
      return Boolean(Edit.directBusy || MoveItems.busy || FcSku.busy);
    },

    setStatus(message, kind = '') {
      this.message = message;
      this.kind = kind;
      Control.paint();
    },

    workflowId(workflow, definition) {
      return {
        instructionId: workflow.instructionId || definition.instructionId,
        objectId: workflow.objectId
      };
    },

    async routeHtml(definition, label = 'Mode route') {
      issDriveAftLocation.pathname = definition.path;
      const res = await fetch(this.target(definition), {
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'follow'
      });
      if (!res.ok) throw new Error(`${label}: GET HTTP ${res.status}`);
      return res.text();
    },

    extractWorkflow(html, definition) {
      const source = String(html || '')
        .replace(/&quot;/gi, '"')
        .replace(/&#34;/gi, '"')
        .replace(/&#x22;/gi, '"')
        .replace(/\\"/g, '"')
        .replace(/&amp;/gi, '&');

      const anchor = new RegExp(`"instructionId"\\s*:\\s*"${definition.instructionId}"`, 'i').exec(source);
      if (!anchor) return null;
      const scope = source.slice(anchor.index, anchor.index + 2400);
      const grab = name => scope.match(new RegExp(`"${name}"\\s*:\\s*"([^"]+)"`, 'i'))?.[1] || '';

      const workflow = {
        instructionId: grab('instructionId'),
        tool: grab('tool').toLowerCase(),
        objectId: grab('objectId'),
        status: grab('status').toUpperCase(),
        selector: /<input\b[^>]*\bname\s*=\s*["']options["']/i.test(source)
      };

      if (!workflow.objectId || workflow.instructionId !== definition.instructionId) return null;
      if (workflow.tool && workflow.tool !== definition.tool) return null;
      return workflow;
    },

    async bootstrap(definition) {
      const workflow = this.extractWorkflow(await this.routeHtml(definition), definition);
      if (!workflow) throw new Error('AFT workflow not found');
      return workflow;
    },

    async getStatus(workflow, definition) {
      const res = await post('/status', {
        id: this.workflowId(workflow, definition)
      }, 'Mode status');
      let data;
      try { data = await res.json(); }
      catch { throw new Error('Mode status: invalid JSON'); }

      const status = String(data?.status || '').toUpperCase();
      if (!status) throw new Error('Mode status missing');
      return status;
    },

    async waitStatus(workflow, definition, accepted, timeoutMs = MODE_SWITCH_STATUS_TIMEOUT_MS) {
      const wanted = new Set(accepted);
      const deadline = Date.now() + timeoutMs;
      let last = workflow.status || '';

      while (Date.now() < deadline) {
        last = await this.getStatus(workflow, definition);
        if (wanted.has(last)) return last;
        if (!['READY', 'PROCESSING', 'COMPLETE'].includes(last)) throw new Error(`AFT workflow ${last}`);
        await sleep(MODE_SWITCH_POLL_MS);
      }

      throw new Error(`AFT workflow timeout (${last || 'unknown'})`);
    },

    async waitSelector(workflow, definition) {
      const deadline = Date.now() + MODE_SWITCH_STATUS_TIMEOUT_MS;

      while (Date.now() < deadline) {
        const status = await this.getStatus(workflow, definition);
        if (status === 'READY') {
          const refreshed = await this.bootstrap(definition);
          if (refreshed.objectId === workflow.objectId && refreshed.selector) return refreshed;
        } else if (status !== 'PROCESSING') {
          throw new Error(`AFT workflow ${status}`);
        }
        await sleep(MODE_SWITCH_POLL_MS);
      }

      throw new Error('AFT mode selector timeout');
    },

    async sendAction(workflow, definition, action, input) {
      await post('/action', {
        id: this.workflowId(workflow, definition),
        action,
        input
      }, `Mode ${action}`);
    },

    async end(workflow, definition) {
      await post('/end', {
        id: this.workflowId(workflow, definition),
        tool: definition.tool
      }, 'Mode end');
    },

    async waitFresh(definition, endedObjectId) {
      const deadline = Date.now() + MODE_SWITCH_FRESH_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const workflow = await this.bootstrap(definition);
        if (workflow.objectId !== endedObjectId) return workflow;
        await sleep(MODE_SWITCH_POLL_MS);
      }
      throw new Error('Fresh AFT workflow not created');
    },

    async ensureReady(definition, workflow = null) {
      let current = workflow || await this.bootstrap(definition);

      for (let pass = 0; pass < 4; pass++) {
        if (current.status === 'READY') return current;

        if (current.status === 'PROCESSING') {
          current.status = await this.waitStatus(current, definition, ['READY', 'COMPLETE']);
          if (current.status === 'READY') {
            current = await this.bootstrap(definition);
            continue;
          }
        }

        if (current.status === 'COMPLETE') {
          const endedObjectId = current.objectId;
          await this.end(current, definition);
          current = await this.waitFresh(definition, endedObjectId);
          continue;
        }

        if (current.status === 'ERRORED') {
          const endedObjectId = current.objectId;
          await this.end(current, definition);
          current = await this.waitFresh(definition, endedObjectId);
          continue;
        }

        throw new Error(`Unexpected AFT state ${current.status || 'unknown'}`);
      }

      throw new Error('Could not obtain READY workflow');
    },

    async switchBackend(definition) {
      let workflow = await this.ensureReady(definition);

      // FcSkuFlip has no mode picker once it is already on its native workflow.
      if (definition.mode === 'fcsku' && !workflow.selector) return;

      if (!workflow.selector) {
        this.setStatus(`${definition.title} • opening mode…`);
        await this.sendAction(workflow, definition, 'SelectMode', 'SelectMode');
        workflow = await this.waitSelector(workflow, definition);
      }

      this.setStatus(`${definition.title} • selecting…`);
      await this.sendAction(workflow, definition, 'Input', definition.input);
      workflow.status = await this.waitStatus(workflow, definition, ['COMPLETE']);

      const endedObjectId = workflow.objectId;
      await this.end(workflow, definition);
      workflow = await this.waitFresh(definition, endedObjectId);
      await this.ensureReady(definition, workflow);
    },

    async request(key) {
      const definition = MODE_DEFINITIONS[key];
      if (!definition) return;

      if (this.busy) {
        this.setStatus('Mode switch already running', 'warn');
        return;
      }

      if (this.workBusy()) {
        this.setStatus('Finish the current AFT run before changing mode', 'warn');
        return;
      }

      if (this.currentKey() === key) {
        this.setStatus(`${definition.title} already active`, 'ok');
        return;
      }

      const started = performance.now();
      this.busy = true;
      this.requestedKey = key;
      this.setStatus(`${definition.title} • backend switch…`);
      traceAft('AFT_MODE_SWITCH', { key, outcome: 'start' });

      try {
        await this.switchBackend(definition);
        this.setStatus(`${definition.title} selected • syncing page…`, 'ok');
        traceAft('AFT_MODE_SWITCH', {
          key,
          outcome: 'selected',
          ms: Math.round(performance.now() - started)
        });

        // Successful backend selection is authoritative; immediately refresh native AFT
        // so the page and the master panel land on the requested mode automatically.
        location.assign(this.target(definition));
      } catch (error) {
        const message = String(error?.message || error || 'unknown error');
        traceAft('AFT_MODE_SWITCH', {
          key,
          outcome: 'failed',
          ms: Math.round(performance.now() - started),
          message
        });
        this.setStatus(`Mode switch failed • ${message}`, 'warn');
      } finally {
        this.busy = false;
        this.requestedKey = '';
        Control.paint();
      }
    }
  };

  const Control = {
    panel: null,
    editBtn: null,
    skuBatchBtn: null,
    moveBtn: null,
    modeButtons: [],
    modeStatusEl: null,
    titleEl: null,
    noteEl: null,
    keys: {
      edit: 'aftm_toggle_edititems',
      move: 'aftm_toggle_moveitems'
    },

    relevantPage() {
      return Edit.match() || MoveItems.match() || FcSku.match();
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
      if (FcSku.match()) return 'AFT • FCSKU';

      if (Edit.match()) {
        if (!this.enabled('edit')) return 'AFT • EDIT OFF';
        const key = ModeSwitch.currentKey();
        const label = key === 'edit:date'
          ? 'DATE'
          : key === 'edit:sku'
            ? 'SKU'
            : key === 'edit:each'
              ? 'EACH'
              : 'EDIT';
        return `AFT • ${label}`;
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
          <button type="button" class="ctrl-toggle" data-toggle-sku-batch hidden>QQSkuSku OFF</button>
          <button type="button" class="ctrl-toggle" data-toggle-move>MoveItems</button>

          <div class="ctrl-mode-group">
            <div class="ctrl-mode-label">EDIT MODE</div>
            <div class="ctrl-mode-grid" data-area="edit">
              <button type="button" class="ctrl-mode" data-mode-key="edit:each">EACH</button>
              <button type="button" class="ctrl-mode" data-mode-key="edit:sku">SKU</button>
              <button type="button" class="ctrl-mode" data-mode-key="edit:date">DATE</button>
              <button type="button" class="ctrl-mode" data-mode-key="edit:fcsku">FCSKU</button>
            </div>
          </div>

          <div class="ctrl-mode-group">
            <div class="ctrl-mode-label">MOVE MODE</div>
            <div class="ctrl-mode-grid" data-area="move">
              <button type="button" class="ctrl-mode" data-mode-key="move:each">EACH</button>
              <button type="button" class="ctrl-mode" data-mode-key="move:multi">MULTI</button>
              <button type="button" class="ctrl-mode" data-mode-key="move:container">CONTAINER</button>
            </div>
          </div>

          <div class="ctrl-mode-status" data-mode-status></div>
          <div class="ctrl-note" data-control-note></div>
        </div>
      `;

      document.body.appendChild(panel);
      this.panel = panel;
      this.editBtn = $('[data-toggle-edit]', panel);
      this.skuBatchBtn = $('[data-toggle-sku-batch]', panel);
      this.moveBtn = $('[data-toggle-move]', panel);
      this.modeButtons = $$('[data-mode-key]', panel);
      this.modeStatusEl = $('[data-mode-status]', panel);
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

      this.skuBatchBtn.onclick = () => {
        Edit.setBatchSkuEnabled(!Edit.batchSkuEnabled());
      };

      this.moveBtn.onclick = () => {
        this.setEnabled('move', !this.enabled('move'));
      };

      for (const button of this.modeButtons) {
        button.onclick = () => ModeSwitch.request(button.dataset.modeKey);
      }
    },

    paint() {
      const panel = this.panel;
      if (!panel?.isConnected) return;

      const editOn = this.enabled('edit');
      const moveOn = this.enabled('move');
      const editActive = Edit.match() && editOn && Edit.active;
      const moveActive = MoveItems.match() && moveOn && MoveItems.active;
      const skuBatchVisible = Edit.match() && Edit.mode === 'sku' && editOn;
      const skuBatchOn = Edit.batchSkuEnabled();
      const activeModeKey = ModeSwitch.currentKey();
      const modeLocked = ModeSwitch.busy || ModeSwitch.workBusy();

      this.titleEl.textContent = this.currentLabel();
      this.editBtn.dataset.on = editOn ? '1' : '0';
      this.moveBtn.dataset.on = moveOn ? '1' : '0';
      this.editBtn.dataset.active = editActive ? '1' : '0';
      this.moveBtn.dataset.active = moveActive ? '1' : '0';
      this.editBtn.textContent = `EditItems  ${editOn ? 'ON' : 'OFF'}${editActive ? ' • ACTIVE' : ''}`;
      this.skuBatchBtn.hidden = !skuBatchVisible;
      this.skuBatchBtn.dataset.on = skuBatchOn ? '1' : '0';
      this.skuBatchBtn.dataset.active = skuBatchVisible && skuBatchOn ? '1' : '0';
      this.skuBatchBtn.textContent = `QQSkuSku  ${skuBatchOn ? 'ON' : 'OFF'}`;
      this.moveBtn.textContent = `MoveItems  ${moveOn ? 'ON' : 'OFF'}${moveActive ? ' • ACTIVE' : ''}`;

      for (const button of this.modeButtons) {
        const key = button.dataset.modeKey;
        button.dataset.active = key === activeModeKey ? '1' : '0';
        button.dataset.pending = ModeSwitch.busy && key === ModeSwitch.requestedKey ? '1' : '0';
        button.disabled = modeLocked;
      }

      if (this.modeStatusEl) {
        this.modeStatusEl.textContent = ModeSwitch.message;
        this.modeStatusEl.dataset.kind = ModeSwitch.kind;
      }

      this.noteEl.textContent = Edit.match()
        ? `Page: EditItems${Edit.mode ? ` / ${Edit.mode.toUpperCase()}` : ''}`
        : MoveItems.match()
          ? `Page: MoveItems${activeModeKey.startsWith('move:') ? ` / ${activeModeKey.slice(5).toUpperCase()}` : ' / Native'}`
          : FcSku.match() ? 'Page: FcSkuFlip' : '';
    },

    refresh() {
      if (!this.relevantPage()) {
        this.panel?.remove();
        this.panel = null;
        this.editBtn = this.skuBatchBtn = this.moveBtn = this.modeStatusEl = this.titleEl = this.noteEl = null;
        this.modeButtons = [];
        return;
      }

      this.render();
      this.paint();
    }
  };


  // ISS Console worker bridge.
  // The parent never receives auth/session material; commands execute inside AFT's own origin.
  let issWorkerModeKey = '';
  let issWorkerBusy = false;

  function issWorkerSend(type, detail = {}) {
    if (!ISS_CONSOLE_WORKER || window.parent === window) return;
    try {
      window.parent.postMessage({
        type,
        worker: 'aft',
        _issDrive: ISS_DRIVE_CHANNEL,
        version: VERSION,
        ...detail
      }, ISS_DRIVE_ORIGIN);
    } catch {}
  }

  function issWorkerProgress(area, message, extra = {}) {
    issWorkerSend('ISS_CONSOLE_PROGRESS', {
      area,
      message: String(message || ''),
      ...extra
    });
  }

  async function issWorkerEnsureMode(key) {
    const definition = MODE_DEFINITIONS[key];
    if (!definition) throw new Error(`Unsupported AFT mode ${key}`);

    if (issWorkerModeKey !== key) {
      issWorkerProgress(definition.area, `${definition.title} • switching backend`, { loading: true, mode: key });
      await ModeSwitch.switchBackend(definition);
      issWorkerModeKey = key;
      if (definition.area === 'move') MoveItems.detectedMode = definition.mode;
      if (definition.area === 'edit' && ['each','sku'].includes(definition.mode)) Edit.mode = definition.mode;
      issWorkerProgress(definition.area, `${definition.title} • ready`, { loading: false, mode: key });
    }

    const workflow = await ModeSwitch.ensureReady(definition);
    return { definition, workflow };
  }

  async function issWorkerEditRun(payload = {}) {
    const mode = String(payload.mode || 'sku').toLowerCase() === 'each' ? 'each' : 'sku';
    const rawItems = Array.isArray(payload.items) ? payload.items.join('\n') : payload.items || '';
    const desiredState = String(payload.destState || 'Pending Research');
    const desiredDamage = String(payload.destDamage || 'Defective');

    const parsedEach = mode === 'each' ? Edit.parseEachQueue(rawItems) : null;
    if (parsedEach && (!parsedEach.length || parsedEach.length > 500)) throw new Error('EACH requires 1–500 valid TOTE ASIN [FNSKU] rows — no edit sent');
    await issWorkerEnsureMode(`edit:${mode}`);
    Edit.stopRequested = false;
    Edit.directBusy = true;
    Edit.workerProgress = null;

    try {
      if (mode === 'each') {
        const items = parsedEach;
        if (!items.length) throw new Error('EACH needs: TOTE ASIN [FNSKU] — one row per item');
        if (items.length > 500) throw new Error('Edit queue too large');

        Edit.workerProgress = { current:0, total:items.length, mode };
        issWorkerProgress('edit', `EACH • starting ${items.length} row${items.length === 1 ? '' : 's'}`, {
          current:0,
          total:items.length,
          mode
        });

        const result = await Edit.runEachQueue(items, { desiredState, desiredDamage });
        const done = Number(result?.done) || items.length;
        issWorkerProgress('edit', `DONE ✓ ${done}/${items.length}`, {
          done,
          total:items.length,
          mode
        });
        return { done, total:items.length, failed:[], mode };
      }

      const items = Edit.parseSkuBatchQueue(rawItems);
      if (!items.length) throw new Error('No Edit items');
      if (items.length > 500) throw new Error('Edit queue too large');

      const currentState = String(payload.sourceState || 'Sellable');
      if (low(currentState) === low(desiredState) && low(currentState) !== 'unsellable') {
        throw new Error('Source and destination disposition cannot match');
      }

      Edit.workerProgress = { current:0, total:items.length, mode };
      issWorkerProgress('edit', `SKU • starting ${items.length} item${items.length === 1 ? '' : 's'}`, {
        current:0,
        total:items.length,
        mode
      });

      const result = await Edit.runSkuBatchQueue(items, {
        currentState,
        currentDamage:String(payload.sourceDamage || 'Defective'),
        desiredState,
        desiredDamage
      });
      const failed = Array.isArray(result?.failed) ? result.failed : [];
      const flipped = Number(result?.flipped) || 0;
      const zero = Number(result?.zero) || 0;
      const done = flipped + zero;

      issWorkerProgress(
        'edit',
        `DONE ✓ ${flipped} flipped • ${zero} zero • ${failed.length} failed`,
        { done, total:items.length, failed:failed.length, mode }
      );
      return { done, total:items.length, flipped, zero, failed, mode };
    } finally {
      Edit.workerProgress = null;
      Edit.directBusy = false;
    }
  }

  async function issWorkerMoveQuantity(definition, objectId, label) {
    // Worker iframe stays on EditItems. Read the MoveItems route explicitly so
    // quantity parsing uses the same native response shape without changing iframe route.
    const html = await ModeSwitch.routeHtml(definition, label);
    const fetchedObjectId = objectIdFromHtmlForWorker(html);
    assertObject(objectId, fetchedObjectId, label);

    const direct = MoveItems.quantityInfoFromRaw(html);
    if (direct.qty) return direct.qty;
    if (direct.verify) throw new Error(`${label}: Verify Item screen detected`);

    const info = MoveItems.quantityInfoFromHtml(html);
    if (info.qty) return info.qty;
    if (info.verify) throw new Error(`${label}: Verify Item screen detected`);

    throw new Error(`${label}: quantity not found`);
  }

  function objectIdFromHtmlForWorker(html) {
    return objectId(html);
  }

  async function issWorkerMoveRun(payload = {}) {
    const source = norm(payload.source);
    const dest = norm(payload.dest);
    const items = MoveItems.parseItems(Array.isArray(payload.items) ? payload.items.join('\n') : payload.items || '');
    const uiMode = String(payload.mode || 'all').toLowerCase();
    if (!['all','qty'].includes(uiMode)) throw new Error(`Unsupported Move mode ${uiMode}`);
    const modeKey = 'move:multi';
    const qtyMode = uiMode === 'qty' ? 'user' : 'all';
    const requestedQty = qtyMode === 'user' ? Number(payload.qty) : null;

    if (!/^(?:(?:ts|cs)x[0-9a-z]+|P-[0-9]+-[A-Z0-9]+)$/i.test(source)) throw new Error('Invalid source container');
    if (!/^(?:ts|cs)x[0-9a-z]+$/i.test(dest)) throw new Error('Invalid destination container');
    if (low(source) === low(dest)) throw new Error('Source and destination cannot match');
    if (!items.length) throw new Error('No Move items');
    if (qtyMode === 'user' && (!Number.isSafeInteger(requestedQty) || requestedQty < 1 || requestedQty > 999999)) {
      throw new Error('Invalid quantity');
    }

    const { definition, workflow } = await issWorkerEnsureMode(modeKey);
    const objectId = workflow.objectId;
    let done = 0;
    MoveItems.stopRequested = false;
    MoveItems.busy = true;

    try {
      issWorkerProgress('move', `Source ${source}`, { current: 0, total: items.length });
      await MoveApi.input(objectId, source, 'Source');

      for (let i = 0; i < items.length; i++) {
        if (MoveItems.stopRequested) throw new Error('Stopped by user');
        const barcode = items[i];
        issWorkerProgress('move', `${i + 1}/${items.length} • Item ${barcode}`, {
          current: i + 1,
          total: items.length
        });
        await MoveApi.input(objectId, barcode, `Item ${i + 1}`);

        if (definition.mode === 'multi') {
          const availableQty = await issWorkerMoveQuantity(definition, objectId, `Quantity page ${i + 1}`);
          const qty = qtyMode === 'user' ? requestedQty : availableQty;
          if (qty > availableQty) {
            throw new Error(`QTY UNAVAILABLE • ${barcode} • requested ${qty} • available ${availableQty}`);
          }
          issWorkerProgress('move', `${i + 1}/${items.length} • Qty ${qty}/${availableQty}`, {
            current: i + 1,
            total: items.length
          });
          await MoveApi.input(objectId, String(qty), `Quantity ${i + 1}`);
        }

        issWorkerProgress('move', `${i + 1}/${items.length} • Destination ${dest}`, {
          current: i + 1,
          total: items.length
        });
        try {
          await MoveApi.input(objectId, dest, `Destination ${i + 1}`);
        } catch (error) {
          if (error?.aftActionSubmitted) {
            error.aftUncertainMove = { index:i, barcode };
          }
          throw error;
        }
        done++;
      }

      issWorkerProgress('move', 'Finishing…', { done, total: items.length });
      await MoveApi.done(objectId);
      await MoveApi.end(objectId);
      issWorkerProgress('move', `DONE ✓ ${done}/${items.length}`, { done, total: items.length });
      return { done, total: items.length };
    } catch (error) {
      try { await MoveApi.end(objectId); } catch {}
      const message = String(error?.message || error);
      const uncertainIndex = Number.isInteger(error?.aftUncertainMove?.index)
        ? error.aftUncertainMove.index
        : -1;
      const uncertain = uncertainIndex >= 0 ? [items[uncertainIndex]] : [];
      const remaining = uncertainIndex >= 0 ? items.slice(uncertainIndex + 1) : items.slice(done);
      error.aftPartial = {
        kind:'move',
        done,
        total:items.length,
        uncertain,
        remaining,
        source,
        dest
      };
      if (uncertain.length) {
        error.message = `${message} • ${done} confirmed moved • ${uncertain[0]} OUTCOME UNKNOWN — VERIFY BEFORE RETRY • remaining queue kept`;
      } else if (done > 0) {
        error.message = `${message} • ${done} already moved • remaining queue kept`;
      }
      throw error;
    } finally {
      MoveItems.busy = false;
    }
  }

  function installIssConsoleWorkerBridge() {
    if (!ISS_CONSOLE_WORKER || window.parent === window) return;

    window.addEventListener('message', async event => {
      const message = event.data;
      if (
        event.source !== window.parent || !trustedIssOrigin(event.origin) || message?._issDrive !== ISS_DRIVE_CHANNEL ||
        message?.type !== 'ISS_CONSOLE_RPC' ||
        message?.worker !== 'aft'
      ) return;

      const id = String(message.id || '');
      const command = String(message.command || '');
      if (!id || !command) return;
      traceAft('ISS_WORKER_RPC_RECEIVE', { command });

      if (issWorkerBusy && command !== 'stop' && command !== 'ping') {
        issWorkerSend('ISS_CONSOLE_RPC_RESULT', { id, ok: false, error: 'AFT worker busy' });
        return;
      }

      try {
        let data = null;
        if (command === 'ping') {
          issWorkerSend('ISS_CONSOLE_WORKER_READY', { ready: true });
          data = { ready: true, mode: issWorkerModeKey };
        } else if (command === 'stop') {
          Edit.stopRequested = true;
          MoveItems.stopRequested = true;
          data = { stopped: true };
        } else if (command === 'mode') {
          issWorkerBusy = true;
          await issWorkerEnsureMode(String(message.payload?.key || ''));
          data = { mode: issWorkerModeKey };
        } else if (command === 'edit.run') {
          issWorkerBusy = true;
          data = await issWorkerEditRun(message.payload || {});
        } else if (command === 'move.run') {
          issWorkerBusy = true;
          data = await issWorkerMoveRun(message.payload || {});
        } else {
          throw new Error(`Unknown AFT worker command: ${command}`);
        }
        traceAft('ISS_WORKER_RPC_RESULT', { command, ok:true });
        issWorkerSend('ISS_CONSOLE_RPC_RESULT', { id, ok: true, data });
      } catch (error) {
        const workerError = String(error?.message || error || 'AFT worker error');
        traceAft('ISS_WORKER_RPC_RESULT', { command, ok:false, error:workerError.slice(0, 180) });
        issWorkerSend('ISS_CONSOLE_RPC_RESULT', {
          id,
          ok:false,
          error:workerError,
          data:error?.aftPartial || null
        });
      } finally {
        if (command !== 'ping' && command !== 'stop') issWorkerBusy = false;
      }
    });

    traceAft('ISS_WORKER_BRIDGE_READY', { worker:'aft' });
    issWorkerSend('ISS_CONSOLE_WORKER_READY', { ready: true });
  }

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

  if (ISS_CONSOLE_WORKER) {
    const workerStart = () => installIssConsoleWorkerBridge();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', workerStart, { once: true });
    else workerStart();
  } else {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
})();


} else {
(() => {
  'use strict';

  const IS_POIROT = location.hostname === 'aft-poirot-website-nrt.nrt.proxy.amazon.com';
  const IS_FCR = /fcresearch/i.test(location.hostname) || location.hostname === 'qifcr.fe.aftx.amazonoperations.app';
  const ISS_LOCAL_FCR_WORKER = true;
  if (!IS_POIROT && !ISS_LOCAL_FCR_WORKER) return;

  if (window.__sidelineRebuildTest_v009) return;
  window.__sidelineRebuildTest_v009 = true;

  const VERSION = '0.0.40-DRIVE';
  const POIROT_ORIGIN = 'https://aft-poirot-website-nrt.nrt.proxy.amazon.com';
  const { registerRuntimeVersion } = globalThis.BWU2Fleet;
  registerRuntimeVersion('SIDELINE-REBUILD', VERSION);

  const TOOL = 'V3';
  const START_TRIGGER = '123START';
  const LOOKUP_CONCURRENCY = 5;
  const PANEL_STATE_KEY = 'sidelineRebuild.panelStates.v1';
  const LAZY_DELAY_KEY = 'sidelineRebuild.lazyDelay.v1';
  const LAZY_DELAY_MIN_MS = 2000;
  const LAZY_DELAY_MAX_MS = 8000;
  const CLEAR_SOURCE_KEY = 'sidelineApiLazy.clearSource';
  const API_SCAN_SOURCE = '/api/scan-source-container';
  const API_CLOSE_CONTAINER = '/api/close-container';
  const API_SCAN_ITEM = '/api/scanitem';
  const API_MOVE_ITEMS = '/api/move-items';
  const API_BOOTSTRAP = '/api/get-bootstrap-data';
  const HAZMAT_MARKETPLACE = 'AU';
  const ISS_WORKER_BY_HASH = location.hash.startsWith('#iss-console-worker');
  const ISS_WORKER_BY_QUERY = new URLSearchParams(location.search).get('issConsoleWorker') === '1';
  const ISS_WORKER_BY_NAME = window.name === 'bwu2-iss-drive-sideline-worker';
  const ISS_CONSOLE_WORKER = ISS_LOCAL_FCR_WORKER || ISS_WORKER_BY_HASH || ISS_WORKER_BY_QUERY || ISS_WORKER_BY_NAME;

  function issControllerWindow() {
    try {
      if (window.opener && !window.opener.closed) return window.opener;
    } catch {}
    return window.parent;
  }

  const itemQty = item => Math.max(1, Number(item?.qty) || 1);
  const sumQty = items => items.reduce((sum, item) => sum + itemQty(item), 0);

  const $ = (s, r = document) => { try { return r.querySelector(s); } catch { return null; } };
  const $$ = (s, r = document) => { try { return [...r.querySelectorAll(s)]; } catch { return []; } };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const norm = v => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const clean = v => String(v ?? '').trim();
  const esc = v => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  let warehouseIdPromise = null;
  const hazmatRestrictionCache = new Map();
  const hazmatEligibilityCache = new Map();
  const hazmatEligibilityInFlight = new Map();

  let sidelineRequestSeq = 0;

  function traceSideline(type, data = {}) {
    try {
      window.parent.postMessage({__BWU2_OBS__:true,_issDrive:ISS_DRIVE_CHANNEL,type:'SIDELINE_' + type,
        data:{script:'SIDELINE',version:VERSION,...data}}, ISS_DRIVE_ORIGIN);
    } catch {}
  }

  function sidelineIssue(message, category, extra = {}) {
    return Object.assign(new Error(message), {category,...extra});
  }

  function readContextCurrent(entry) {
    return !entry || currentPreflightEntry(entry);
  }

  // Only this allowlisted read path may retry. Mutation transports never do.
  async function sidelineRead(request, context = {}) {
    const current = () => readContextCurrent(context.entry);
    for (let attempt=1; attempt<=2; attempt++) {
      if (!current()) throw makeAbortError('Lookup context changed');
      try {
        const response = await request(attempt);
        if (!current()) throw makeAbortError('Lookup context changed');
        if (!response.ok || response.failureCategory) {
          throw sidelineIssue(response.failureMessage || `HTTP ${response.status}`,
            response.failureCategory || 'http', {status:response.status,phase:context.phase});
        }
        return response;
      } catch (error) {
        const category = error?.name === 'AbortError' ? 'cancelled' : (error?.category || 'unknown');
        const status = Number(error?.status) || 0;
        const transient = ['timeout','network'].includes(category)
          || (category === 'http' && [408,429,500,502,503,504].includes(status));
        traceSideline('LOOKUP_FAILURE', {phase:context.phase,source:context.entry?.source,
          barcode:context.entry?.code,generation:context.entry?.generation,attempt,
          category,status,error:String(error?.message || error).slice(0,500),retryable:transient});
        if (attempt===2 || !transient || !current() || context.entry?.readRetryUsed) throw error;
        if (context.entry) context.entry.readRetryUsed = true;
        traceSideline('READ_RETRY', {phase:context.phase,source:context.entry?.source,
          barcode:context.entry?.code,generation:context.entry?.generation,attempt:2,category,status});
      }
    }
  }

  async function gmJsonRequest(options, entry = null, phase = 'hazmat.lookup') {
    const response = await sidelineRead(attempt => sidelineFetch(options.url, {
      method:options.method || 'GET',headers:options.headers || {},body:options.data,
      gm:true,requestTimeout:8000,signal:entry?.controller?.signal,
      obs:{phase,attempt,entry,readOnly:true}
    }), {entry,phase});
    return response.json();
  }

  async function sidelineFetch(path, options = {}) {
    const url = /^https?:\/\//i.test(String(path || '')) ? String(path) : POIROT_ORIGIN + String(path || '');
    const endpoint = new URL(url).pathname;
    const readOnly = options.obs?.readOnly === true ||
      [API_SCAN_ITEM,API_SCAN_SOURCE,API_BOOTSTRAP,'/api/permissions'].includes(endpoint);
    const request = ++sidelineRequestSeq;
    const started = performance.now();
    const metadata = {request,phase:options.obs?.phase || endpoint,endpoint,
      transport:(ISS_LOCAL_FCR_WORKER || options.gm) ? 'gm' : 'fetch',
      readOnly,attempt:options.obs?.attempt || 1,
      source:options.obs?.entry?.source,barcode:options.obs?.entry?.code,
      generation:options.obs?.entry?.generation};
    traceSideline('API_REQUEST', metadata);
    try {
      const response = await sidelineFetchOnce(path,options);
      const raw = await response.text();
      let payload = null;
      try { payload = raw ? JSON.parse(raw) : null; } catch {}
      const final = new URL(response.url || url, url);
      const redirected = final.origin !== new URL(url).origin || final.pathname !== endpoint;
      const html = /^\s*</.test(raw) || /html/i.test(response.contentType || '');
      const auth = [401,403,419].includes(Number(response.status)) || /\/(?:sso|login|signin)(?:\/|$)/i.test(final.pathname);
      const invalidJson = !payload || typeof payload !== 'object' || Array.isArray(payload);
      const failureCategory = auth ? 'auth' : redirected ? 'redirect' : html ? 'html'
        : !response.ok ? 'http' : invalidJson ? 'invalid-response' : '';
      const failureMessage = failureCategory ? `${metadata.phase}: ${failureCategory}${response.status ? ' (HTTP '+response.status+')' : ''}` : '';
      traceSideline('API_RESULT', {...metadata,status:Number(response.status)||0,
        ms:Math.round(performance.now()-started),redirected,html,
        category:failureCategory || (payload?.success === false ? 'rejected' : 'response'),
        responseType:clean(payload?.['@type']),semanticSuccess:typeof payload?.success === 'boolean' ? payload.success : undefined,
        movementPerformed:typeof payload?.movementPerformed === 'boolean' ? payload.movementPerformed : undefined,
        error:failureMessage || clean(payload?.errorMessage || payload?.errorCode || '').slice(0,500)});
      return {ok:response.ok,status:response.status,url:response.url || url,
        failureCategory,failureMessage,text:async()=>raw,json:async()=>payload};
    } catch (error) {
      if (!error.category) error.category = error.name === 'AbortError' ? 'cancelled' : 'network';
      traceSideline('API_RESULT', {...metadata,status:Number(error.status)||0,
        ms:Math.round(performance.now()-started),category:error.category,
        error:String(error.message || error).slice(0,500),outcome:readOnly ? 'failed' : 'unknown'});
      throw error;
    }
  }

  function sidelineFetchOnce(path, options = {}) {
    if (!ISS_LOCAL_FCR_WORKER && !options.gm) return fetch(path, options);

    const url = /^https?:\/\//i.test(String(path || ''))
      ? String(path)
      : POIROT_ORIGIN + String(path || '');
    const method = String(options.method || 'GET').toUpperCase();
    const headers = options.headers || {};
    const body = options.body == null ? undefined : String(options.body);

    return new Promise((resolve,reject) => {
      if (options.signal?.aborted) {
        reject(makeAbortError('Run cancelled'));
        return;
      }

      let settled = false;
      let request = null;
      const cleanup = () => {
        try { options.signal?.removeEventListener('abort', abort); } catch {}
      };
      const abort = () => {
        if (settled) return;
        settled = true;
        try { request?.abort?.(); } catch {}
        cleanup();
        reject(makeAbortError('Run cancelled'));
      };

      request = GM_xmlhttpRequest({
        method,
        url,
        headers,
        data:body,
        anonymous:false,
        timeout:options.requestTimeout || 15000,
        onload:response => {
          if (settled) return;
          settled = true;
          cleanup();
          const raw = String(response.responseText || '');
          resolve({
            ok:response.status >= 200 && response.status < 300,
            status:response.status,
            url:response.finalUrl || url,
            contentType:String(response.responseHeaders || '').match(/^content-type:\s*([^;\r\n]+)/im)?.[1] || '',
            text:async () => raw,
            json:async () => raw ? JSON.parse(raw) : null
          });
        },
        onerror:error => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(sidelineIssue(error?.error || error?.message || 'Poirot request failed','network'));
        },
        ontimeout:() => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(sidelineIssue('Poirot request timed out','timeout'));
        }
      });

      try { options.signal?.addEventListener('abort', abort, {once:true}); } catch {}
    });
  }

  async function warehouseId() {
    if (warehouseIdPromise) return warehouseIdPromise;
    warehouseIdPromise = (async () => {
      try {
        const response = await sidelineFetch(`${API_BOOTSTRAP}?tool=${encodeURIComponent(TOOL)}`, {
          method:'GET',
          credentials:'same-origin'
        });
        if (response.ok) {
          const payload = await response.json();
          const info = payload?.warehouseInfo;
          const candidate = clean(
            (typeof info === 'string' ? info : '') ||
            info?.warehouseId || info?.id || info?.warehouse || info?.fc || info?.code ||
            payload?.warehouseId || ''
          ).toUpperCase();
          if (candidate) return candidate;
        }
      } catch {}

      const text = clean(document.body?.innerText || '').toUpperCase();
      return text.match(/\b[A-Z]{3}\d\b/)?.[0] || '';
    })();
    return warehouseIdPromise;
  }

  async function pandashHazmatEligibility(asinValue, entry = null) {
    const asin = clean(asinValue).toUpperCase();
    const fc = await warehouseId();
    if (!/^B[A-Z0-9]{9}$/.test(asin) || !fc) throw new Error('HAZMAT LOOKUP CONTEXT MISSING');

    const key = `${fc}|${asin}`;
    if (hazmatEligibilityCache.has(key)) return hazmatEligibilityCache.get(key);
    if (hazmatEligibilityInFlight.has(key)) return hazmatEligibilityInFlight.get(key);

    const work = (async () => {
      let restriction = hazmatRestrictionCache.get(fc) || '';
      if (!restriction) {
        const bootstrap = await gmJsonRequest({
          method:'GET',
          url:`https://pandash.amazon.com/GridServlet?fc=${encodeURIComponent(fc)}`
        },entry,'hazmat.bootstrap');
        restriction = clean(bootstrap?.restriction || 'default') || 'default';
        hazmatRestrictionCache.set(fc,restriction);
      }

      const body =
        `language=default&source=${encodeURIComponent(restriction)}-hazmat-FC` +
        `&marketPlaces=${HAZMAT_MARKETPLACE}` +
        `&asins=${encodeURIComponent(asin)}&rows=1&page=1&fc=${encodeURIComponent(fc)}`;

      const payload = await gmJsonRequest({
        method:'POST',
        url:'https://pandash.amazon.com/GridServlet',
        headers:{'Content-Type':'application/x-www-form-urlencoded'},
        data:body
      },entry,'hazmat.lookup');

      const row = Array.isArray(payload?.rows)
        ? payload.rows.find(item => clean(item?.asin).toUpperCase() === asin)
        : null;
      if (!row) throw new Error('NO PANDASH RESULT');

      const message = clean(row.message);
      const result = {
        asin,
        level:Number(row.level || 0),
        message,
        allowed:/can be processed/i.test(message)
      };
      hazmatEligibilityCache.set(key,result);
      return result;
    })();

    hazmatEligibilityInFlight.set(key,work);
    try {
      return await work;
    } finally {
      hazmatEligibilityInFlight.delete(key);
    }
  }

  function setTextIfChanged(el, value) {
    const text = String(value);
    if (el.textContent !== text) el.textContent = text;
  }

  function makeAbortError(message='Run cancelled') {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
  }

  function cancelRun(state) {
    const run = state.activeRun;
    state.activeRun = null;
    if (run?.controller && !run.controller.signal.aborted) run.controller.abort();
  }

  function beginRun(state) {
    cancelRun(state);
    const run = { id:++state.runSeq, controller:new AbortController() };
    state.activeRun = run;
    return run;
  }

  function currentRun(state, run=state.activeRun) {
    return !!run && state.activeRun === run && !run.controller.signal.aborted;
  }

  function finishRun(state, run) {
    if (state.activeRun === run) state.activeRun = null;
  }

  async function postJson(path, body, state, run=state.activeRun, cancelMessage='Run cancelled') {
    if (!currentRun(state, run)) throw makeAbortError(cancelMessage);

    let response;
    try {
      response = await sidelineFetch(path, {
        method:'POST',
        credentials:'same-origin',
        headers:{'content-type':'application/json'},
        body:JSON.stringify(body),
        signal:run.controller.signal
      });
    } catch (error) {
      if (error && typeof error === 'object') {
        error.submitted = true;
        error.responseReceived = false;
      }
      throw error;
    }

    if (!currentRun(state, run)) {
      const error = makeAbortError(cancelMessage);
      error.submitted = true;
      error.responseReceived = true;
      throw error;
    }
    const raw = await response.text();
    if (!currentRun(state, run)) {
      const error = makeAbortError(cancelMessage);
      error.submitted = true;
      error.responseReceived = true;
      throw error;
    }

    let payload = raw;
    try { payload = raw ? JSON.parse(raw) : null; } catch {}

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.payload = payload;
      error.submitted = true;
      error.responseReceived = true;
      throw error;
    }
    return payload;
  }

  const helperSelector = '#sh-dock,#sh-queue,#sh-qty,#sh-lazy,#sh-og-expiry,#sh-lazy-running-indicator,#sh-move-corner';
  const shared = { owner:'', queueBusy:false, expiryBusy:false };
  let returnSourceBusy = false;
  let expiryRequestSeq = 0;
  let nativeExpirySuppressedUntil = 0;

  // Native
  function visible(el) {
    if (!(el instanceof Element) || !el.isConnected || el.hidden) return false;
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' && r.width > 0 && r.height > 0;
  }

  function enabled(el) {
    return visible(el) && !el.disabled && !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true';
  }

  function appElements(selector) {
    return $$(selector).filter(el => !el.closest(helperSelector));
  }

  let screenDirty = true, screenCache = 'UNKNOWN';

  function nativePageText() {
    const parts = [];

    for (const child of document.body?.children || []) {
      if (child.matches?.(helperSelector)) continue;
      parts.push(child.innerText || child.textContent || '');
    }

    return norm(parts.join(' '));
  }

  function detectScreen() {
    const t = nativePageText();
    if (t.includes('enter quantity')) return 'QTY';
    if (t.includes('verify item')) return 'VERIFY';
    if (t.includes('scan destination container')) return 'DEST';
    if (t.includes('scan source container')) return 'SOURCE';
    if (t.includes('scan item')) return 'ITEM';
    if (t.includes('expiration date') || t.includes('expiry date')) return 'EXPIRY';
    if (t.includes('predicant')) return 'PREDICANT';
    if (t.includes('successfully')) return 'SUCCESS';
    return 'UNKNOWN';
  }

  function screen() {
    if (screenDirty) {
      screenCache = detectScreen();
      screenDirty = false;
    }
    return screenCache;
  }

  function scanInput() {
    const direct = $('#scan-text-input');
    if (enabled(direct) && !direct.closest(helperSelector)) return direct;
    return appElements('input,textarea,[role="textbox"],[contenteditable="true"]').find(el => {
      if (!enabled(el)) return false;
      const type = norm(el.type);
      return !type || ['text','search','tel','number'].includes(type) || el.tagName === 'TEXTAREA' || el.isContentEditable;
    }) || null;
  }

  function buttonByText(re) {
    return appElements('button,[role="button"],a,alchemy-button,mdw-button,input[type="button"],input[type="submit"]')
      .find(el => enabled(el) && re.test(norm(el.innerText || el.textContent || el.value || ''))) || null;
  }

  function confirmButton() {
    const direct = $('#confirm-button');
    return enabled(direct) && !direct.closest(helperSelector) ? direct : buttonByText(/^(confirm|item match|continue|submit|enter)\b/);
  }

  function changeButton() {
    const direct = $('#change-container-button');
    return enabled(direct) && !direct.closest(helperSelector) ? direct : buttonByText(/change container/);
  }

  function deepRoots(start=document) {
    const roots = [start];
    const stack = [start];

    while (stack.length) {
      const root = stack.pop();
      const elements = root.querySelectorAll?.('*') || [];

      for (const el of elements) {
        if (!el.shadowRoot) continue;
        roots.push(el.shadowRoot);
        stack.push(el.shadowRoot);
      }
    }

    return roots;
  }

  function buttonLabel(el) {
    if (!el) return '';

    const direct = [
      el.innerText,
      el.textContent,
      el.value,
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('title')
    ].filter(Boolean).join(' ');

    const shadow = el.shadowRoot
      ? [
          el.shadowRoot.innerText,
          el.shadowRoot.textContent,
          el.shadowRoot.querySelector?.('button,[role="button"],input')?.innerText,
          el.shadowRoot.querySelector?.('button,[role="button"],input')?.textContent,
          el.shadowRoot.querySelector?.('button,[role="button"],input')?.value
        ].filter(Boolean).join(' ')
      : '';

    return norm(`${direct} ${shadow}`);
  }

  function modalButton(choice) {
    const wanted = norm(choice);
    const selectors = 'button,[role="button"],input[type="button"],input[type="submit"],alchemy-button,mdw-button';

    const matchesChoice = el => {
      if (!enabled(el)) return false;
      const label = buttonLabel(el);

      if (wanted === 'no') {
        return label === 'no' || /^no\b/.test(label);
      }

      if (wanted === 'yes') {
        return (
          ['yes', 'yes close', 'yes, close', 'empty', 'empty container'].includes(label) ||
          /^(yes|empty)\b/.test(label)
        );
      }

      return label === wanted;
    };

    const normalScopes = [
      $('#modal-root'),
      ...$$('[role="dialog"],dialog,.modal,.Dialog,.dialog,.ReactModal__Content,[aria-modal="true"]')
    ].filter(Boolean);

    for (const scope of normalScopes) {
      const hit = $$(selectors, scope).find(matchesChoice);
      if (hit) return hit;

      for (const root of deepRoots(scope)) {
        const deepHit = $$(selectors, root).find(matchesChoice);
        if (deepHit) return deepHit;
      }
    }

    const documentRoots = deepRoots(document);
    for (const root of documentRoots) {
      const dialogs = $$('[role="dialog"],dialog,.modal,.Dialog,.dialog,.ReactModal__Content,[aria-modal="true"]', root);

      for (const dialog of dialogs) {
        const hit = $$(selectors, dialog).find(matchesChoice);
        if (hit) return hit;

        for (const dialogRoot of deepRoots(dialog)) {
          const deepHit = $$(selectors, dialogRoot).find(matchesChoice);
          if (deepHit) return deepHit;
        }
      }
    }

    for (const root of documentRoots) {
      const hit = $$(selectors, root)
        .filter(el => !el.closest?.(helperSelector))
        .find(matchesChoice);
      if (hit) return hit;
    }

    return null;
  }

  function setValue(input, value) {
    if (!input) return false;
    if (input.isContentEditable) input.textContent = String(value);
    else {
      const proto = Object.getPrototypeOf(input);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value')
        || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
        || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
      const old = input.value;
      if (desc?.set) desc.set.call(input, String(value));
      else input.value = String(value);
      input._valueTracker?.setValue?.(old);
    }
    input.dispatchEvent(new Event('input', { bubbles:true }));
    input.dispatchEvent(new Event('change', { bubbles:true }));
    screenDirty = true;
    return true;
  }

  function enter(el) {
    for (const type of ['keydown','keypress','keyup']) {
      el?.dispatchEvent(new KeyboardEvent(type, {
        key:'Enter', code:'Enter', keyCode:13, which:13,
        bubbles:true, cancelable:true, composed:true
      }));
    }
    screenDirty = true;
  }

  function click(el) {
    if (!el) return false;
    const target = el.shadowRoot?.querySelector('button,[role="button"],input[type="button"],input[type="submit"]') || el;
    for (const type of ['mouseover','mousedown','mouseup']) {
      target.dispatchEvent(new MouseEvent(type, { bubbles:true, composed:true }));
    }
    target.click();
    screenDirty = true;
    return true;
  }

  async function waitFor(test, timeout=10000, gap=50) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const value = test();
      if (value) return value;
      await sleep(gap);
    }
    return null;
  }

  async function closeOpenContainer(choice='yes', active=()=>true) {
    const change = await waitFor(() => active() && changeButton(), 12000, 35);
    if (!change || !active()) return 'cancelled';
    click(change);
    const answer = await waitFor(() => active() && modalButton(choice), 3500, 25);
    if (!answer || !active()) return 'cancelled';
    click(answer);
    if (!active()) return 'cancelled';
    return await waitFor(() => active() && screen() === 'SOURCE' && scanInput(), 12000, 50) ? 'closed' : 'source timeout';
  }

  function backToSourceButton() {
    return buttonByText(/back to source container/);
  }

  function loadedSourceContainer() {
    const text = nativePageText();
    const match = text.match(/source\s+container[\s:]*((?:ts|cs)x[0-9a-z_-]+)/i);
    return match ? match[1] : '';
  }

  async function waitForNativeSourceScan(timeout=12000) {
    return !!await waitFor(() => screen() === 'SOURCE' && scanInput(), timeout, 50);
  }

  async function nativeReturnToOriginalSource(sourceCode) {
    const alreadyBack =
      norm(loadedSourceContainer()) === norm(sourceCode) &&
      screen() === 'ITEM' &&
      !!changeButton();

    if (alreadyBack) return true;

    const back = await waitFor(backToSourceButton, 1800, 40);
    if (!back) return false;

    click(back);

    const ready = await waitFor(() =>
      norm(loadedSourceContainer()) === norm(sourceCode) &&
      screen() === 'ITEM' &&
      !!changeButton(),
      10000,
      50
    );

    if (!ready) return false;
    return true;
  }

  // UI
  const style = document.createElement('style');
  style.textContent = `
#sh-dock{position:fixed;right:14px;bottom:12px;z-index:2147483647;display:grid;grid-template-columns:repeat(3,1fr);gap:5px;width:278px;padding:5px;background:#fff;border:1px solid #c7d0dd;border-radius:5px;box-shadow:0 2px 8px #0003;font:12px Arial,sans-serif}
#sh-dock button,.sh-btn{border:1px solid #aeb8c5;border-radius:4px;padding:7px 6px;font-weight:800;cursor:pointer;background:#f5f7fa;color:#1f2937}.sh-on{background:#146eb4!important;color:#fff!important;border-color:#0f5c99!important}
.sh-panel{position:fixed;right:14px;bottom:56px;z-index:2147483646;width:430px;max-width:calc(100vw - 28px);box-sizing:border-box;padding:8px;background:#fff;border:1px solid #c7d0dd;border-radius:5px;box-shadow:0 2px 8px #0003;font:12px Arial,sans-serif;color:#111827}.sh-title{font-weight:900;margin:-8px -8px 7px;padding:7px 9px;background:#f3f5f8;border-bottom:1px solid #d5dbe3;border-radius:5px 5px 0 0}
.sh-return-source{width:auto;display:block;margin:0 0 6px auto;padding:5px 9px!important;border:1px solid #146eb4!important;background:#eff6ff!important;color:#0f3d73!important;font-weight:900!important;font-size:11px}.sh-return-source:hover{background:#dbeafe!important}.sh-return-source-inline{margin-top:8px;width:100%;border:2px solid #146eb4!important;background:#eff6ff!important;color:#0f3d73!important;font-weight:1000!important}
.sh-grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}.sh-grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}.sh-input{width:100%;box-sizing:border-box;border:1px solid #b8c2cf;border-radius:4px;padding:7px;font:12px Arial,sans-serif}.sh-input.good{border-color:#16a34a}.sh-input.bad{border-color:#dc2626}.sh-area{height:76px;resize:vertical}.sh-status{margin-top:5px;font-weight:700;line-height:1.3}.sh-error{margin-top:3px;color:#b91c1c;font-weight:700}.sh-row{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px}#sh-lazy-settings{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:6px 0}#sh-lazy-settings .sh-btn{min-height:34px;font-size:11px;font-weight:900;letter-spacing:.1px}#sh-lazy-settings .sh-setting-off{background:#f5f7fa!important;color:#475569!important;border-color:#b8c2cf!important}
#sh-qty{left:14px;right:auto;width:306px}.sh-qty-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}.sh-qty-grid button{min-height:42px;font-size:16px}.sh-clear-tote{width:100%;margin-top:8px;background:#fff1f2!important;color:#991b1b!important;border-color:#fecaca!important}.sh-stop{background:#fff7ed!important;color:#9a3412!important;border-color:#fed7aa!important}
.sh-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin:6px 0 3px}.sh-metric{border:1px solid #c7d0dd;background:#f8fafc;padding:6px 3px;text-align:center;font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.15px}.sh-metric b{display:block;font-size:19px;line-height:1.05;margin-top:2px}.sh-notmoved-line{display:none;font-size:11px;color:#475569;text-align:right;margin:2px 1px 7px}.sh-notmoved-line.show{display:block}.sh-notmoved-line b{font-size:13px;color:#991b1b}.sh-lazy-input-summary{display:none;align-items:center;justify-content:space-between;gap:8px;margin:6px 0;padding:8px 10px;border:1px solid #cbd5e1;border-left:5px solid #146eb4;background:#f8fafc;border-radius:4px;font-weight:850;color:#334155}.sh-lazy-input-summary.show{display:flex}.sh-lazy-input-summary.auto{border-left-color:#16a34a;background:#f0fdf4;box-shadow:0 0 0 2px rgba(22,163,74,.10)}.sh-lazy-input-summary button{padding:5px 9px;border:1px solid #94a3b8;border-radius:4px;background:#fff;font-weight:800;cursor:pointer}.sh-lazy-collapsed{display:none!important}.sh-result-summary{display:none;margin:7px 0;border:1px solid #cbd5e1;border-radius:4px;background:#f8fafc;overflow:hidden}.sh-result-summary.show{display:block}.sh-result-ok{padding:8px 9px;background:#eff6ff;color:#0f3d73;font-weight:900}.sh-result-bad{padding:8px 9px;background:#fff7f7;color:#991b1b;font-weight:900;font-size:13px;line-height:1.35;border-top:1px solid #fecaca;border-left:6px solid #dc2626}.sh-result-bad-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}.sh-result-bad-title{font-size:13px;font-weight:1000}.sh-result-bad code{font:900 13px Consolas,monospace;color:#7f1d1d}.sh-failed-actions{display:flex;gap:6px}.sh-failed-actions button{padding:6px 9px;border:1px solid #ef4444;background:#fff;color:#991b1b;border-radius:3px;font-weight:900;cursor:pointer}.sh-failed-list{margin-top:8px;border-top:1px solid #fecaca;padding-top:8px;display:grid;gap:8px}.sh-failed-card{padding:7px 8px;background:#fff;border:1px solid #fecaca;border-left:4px solid #ef4444;border-radius:4px}.sh-failed-top{font:1000 13px/1.2 Consolas,monospace;color:#7f1d1d;margin-bottom:5px}.sh-failed-grid{display:grid;grid-template-columns:auto 1fr;column-gap:7px;row-gap:3px;font-size:12px;line-height:1.25}.sh-failed-grid b{color:#7f1d1d}.sh-predicant-card{display:none;margin:8px 0;padding:10px 12px;border:3px solid #f59e0b;border-left:8px solid #dc2626;border-radius:6px;background:#fff7ed;color:#7c2d12;text-align:center;box-shadow:0 0 0 2px rgba(245,158,11,.12);animation:shPredicantPulse .85s ease-in-out infinite alternate}.sh-predicant-card.show{display:block}.sh-predicant-title{font-size:17px;font-weight:1000;line-height:1.15}.sh-predicant-dest{margin:6px 0 4px;padding:7px 8px;background:#fff;border:2px solid #dc2626;border-radius:4px;font:1000 18px Consolas,monospace;color:#7f1d1d;letter-spacing:.4px}.sh-predicant-help{font-size:12px;font-weight:900;line-height:1.35}.sh-predicant-help strong{font-size:13px}.sh-predicant-scan{outline:4px solid #f59e0b!important;box-shadow:0 0 0 5px rgba(245,158,11,.18)!important}@keyframes shPredicantPulse{from{background:#fff7ed;box-shadow:0 0 0 2px rgba(245,158,11,.10)}to{background:#fef3c7;box-shadow:0 0 0 6px rgba(245,158,11,.22)}}.sh-failure-pill{display:none;margin:6px 0 2px;padding:7px 9px;border:1px solid #ef4444;border-left:5px solid #dc2626;border-radius:4px;background:#fff1f2;color:#991b1b;font-weight:900;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sh-failure-pill.show{display:block}.sh-failure-pill:hover{background:#ffe4e6}.sh-progress{max-height:210px;overflow:auto;border-top:1px solid #d5dbe3;margin-top:8px;padding-top:6px;font-family:Consolas,monospace}.sh-item{padding:6px 7px;border-radius:3px;margin-bottom:3px;border:1px solid transparent}.sh-item.current{background:#fff3bf;border-color:#f59e0b;font-weight:900}.sh-item.moved{background:#eff6ff;color:#0f3d73;border-color:#bfdbfe;font-weight:800}.sh-item.failed{background:#fff1f2;color:#991b1b;border:2px solid #ef4444;border-left-width:6px;font-weight:900}.sh-item.parked{background:#fff7ed;color:#9a3412;border-color:#fed7aa;font-weight:800}.sh-item.retry{background:#fff7ed;color:#9a3412;border:2px solid #f59e0b;border-left-width:6px;font-weight:900}
#sh-lazy-footer{display:none}
#sh-damage-alert{position:fixed;inset:0;z-index:2147483647;pointer-events:none;border:10px solid #dc2626;box-sizing:border-box;background:rgba(220,38,38,.08);animation:shDamageFlash .42s steps(2,end) 10}
#sh-damage-alert .sh-damage-box{position:absolute;left:50%;top:72px;transform:translateX(-50%);min-width:520px;max-width:calc(100vw - 40px);padding:16px 22px;text-align:center;background:#7f1d1d;color:#fff;border:5px solid #facc15;border-radius:8px;box-shadow:0 8px 28px #0008;font:900 22px/1.25 Arial,sans-serif;letter-spacing:.3px}
#sh-damage-alert .sh-damage-box small{display:block;margin-top:7px;font-size:14px;letter-spacing:0}
@keyframes shDamageFlash{0%,100%{background:rgba(220,38,38,.08);border-color:#dc2626}50%{background:rgba(250,204,21,.20);border-color:#facc15}}

  0%,100%{border-color:#146eb4!important;box-shadow:0 0 0 3px rgba(20,110,180,.24)}
  50%{border-color:#f59e0b!important;box-shadow:0 0 0 5px rgba(245,158,11,.28)}
}

#sh-lazy-running-indicator{position:fixed;inset:0;z-index:2147483644;pointer-events:none;background:rgba(15,23,42,.09);box-shadow:inset 0 0 0 4px rgba(20,110,180,.34);animation:shLazyPulse 1.2s ease-in-out infinite}
#sh-lazy-running-indicator .sh-lazy-spinner{position:absolute;left:50%;top:46%;width:42px;height:42px;margin:-21px 0 0 -21px;border-radius:50%;border:5px solid rgba(255,255,255,.48);border-top-color:#146eb4;border-right-color:#146eb4;box-shadow:0 2px 10px rgba(0,0,0,.22);animation:shLazySpin .72s linear infinite}
@keyframes shLazySpin{to{transform:rotate(360deg)}}
@keyframes shLazyPulse{0%,100%{box-shadow:inset 0 0 0 4px rgba(20,110,180,.28)}50%{box-shadow:inset 0 0 0 5px rgba(20,110,180,.48)}}
#sh-move-corner{position:fixed;right:416px;bottom:12px;z-index:2147483647;width:68px;height:34px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:6px;border:2px solid #146eb4;border-radius:8px;background:#eff6ff;color:#0f3d73;box-shadow:0 2px 9px #0005;font:900 10px Arial,sans-serif;letter-spacing:.3px;pointer-events:none}
@media(max-width:500px){#sh-move-corner{right:3px;top:3px;bottom:auto}}
#sh-move-corner .sh-move-wheel{width:14px;height:14px;box-sizing:border-box;border:3px solid #bfdbfe;border-top-color:#146eb4;border-right-color:#146eb4;border-radius:50%;animation:shMoveCornerSpin .7s linear infinite}
#sh-move-corner .sh-move-mark{font:1000 18px/1 Arial,sans-serif}
#sh-move-corner.waiting{border-color:#f59e0b;background:#fff7ed;color:#9a3412}
#sh-move-corner.done{border-color:#16a34a;background:#f0fdf4;color:#166534}
#sh-move-corner.check{border-color:#dc2626;background:#fff1f2;color:#991b1b}
@keyframes shMoveCornerSpin{to{transform:rotate(360deg)}}
#sh-og-expiry{position:fixed;inset:0;z-index:2147483647;background:rgba(31,41,55,.35);font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;pointer-events:none}
#sh-og-expiry .og-wrap{position:absolute;left:50%;top:38px;transform:translateX(-50%);width:920px;max-width:calc(100vw - 24px);background:#4b5563;border:7px solid #4b5563;border-radius:14px;box-shadow:0 12px 30px rgba(0,0,0,.38);pointer-events:auto}
#sh-og-expiry .og-id{background:#fff;padding:10px 12px;border-radius:7px 7px 0 0;font-size:16px;font-weight:900;text-align:center;color:#111827}
#sh-og-expiry .og-item-preview{display:grid;grid-template-columns:170px 1fr;gap:18px;align-items:center;background:#fff;margin-top:8px;padding:12px;border-radius:9px;border:2px solid #d7dee8}
#sh-og-expiry .og-item-img{width:170px;height:170px;object-fit:contain;background:#fff;border:1px solid #d7dee8;border-radius:7px}
#sh-og-expiry .og-item-title{font-size:28px;line-height:1.18;font-weight:900;color:#111827;margin-bottom:10px}
#sh-og-expiry .og-item-meta{font-size:15px;line-height:1.4;color:#475569;font-weight:700}#sh-og-expiry .og-meta-row{display:flex;gap:8px;align-items:baseline;margin:2px 0}#sh-og-expiry .og-meta-label{min-width:58px;color:#334155;font-weight:900}#sh-og-expiry .og-scan-code{display:inline-block;margin-top:5px;padding:6px 9px;border:2px solid #146eb4;border-radius:5px;background:#eff6ff;color:#0f3d73;font:900 19px Consolas,monospace;letter-spacing:.2px}
#sh-og-expiry .og-grid-wrap{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;margin-top:7px}
#sh-og-expiry .og-panel{box-sizing:border-box;background:#fff;border:2px solid #f97316;border-radius:11px;padding:9px}
#sh-og-expiry .og-head{display:flex;align-items:center;justify-content:space-between;margin:0 0 8px;font-size:13px;font-weight:900;color:#9a3412}#sh-og-expiry .og-head strong{color:#111827}
#sh-og-expiry .og-grid{display:grid;gap:5px}.og-month{grid-template-columns:repeat(4,minmax(0,1fr))}.og-day{grid-template-columns:repeat(7,minmax(0,1fr))}.og-year{grid-template-columns:repeat(4,minmax(0,1fr))}
#sh-og-expiry button{min-width:0;height:35px;border:1px solid #c7d2fe;border-radius:7px;background:#f5f7ff;color:#1e3a8a;font-size:13px;font-weight:850;cursor:pointer}#sh-og-expiry button:hover:not(:disabled){background:#e0e7ff}#sh-og-expiry button.selected{background:#2563eb;color:#fff;border-color:#1d4ed8}#sh-og-expiry button:disabled{opacity:.35;cursor:not-allowed}
#sh-og-expiry .og-footer{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:7px}.og-footer.og-footer-single{grid-template-columns:1fr}.og-footer button{width:100%;height:48px!important;background:#7c3aed!important;color:#fff!important;border-color:#6d28d9!important;font-size:15px!important}.og-footer .production-confirm{background:#146eb4!important;border-color:#0f5c99!important}.og-footer .og-return-source{background:#eff6ff!important;color:#0f3d73!important;border:2px solid #146eb4!important}

/* v0.0.4 — ISS Console visual alignment; UI only */
#sh-dock{
  width:430px;box-sizing:border-box;padding:6px;
  background:#f2f4f6;border-color:#aab7c6;border-top:0;
  border-radius:0 0 4px 4px;box-shadow:0 3px 9px #0002;
  font:700 11px Arial,sans-serif
}
#sh-dock button,.sh-btn{
  border-color:#9faec0;border-radius:3px;
  font-weight:800;color:#122b49
}
#sh-dock button.sh-on,.sh-on{
  background:#315f7f!important;color:#fff!important;border-color:#315f7f!important
}
.sh-panel{
  width:430px;padding:12px;border-color:#aab7c6;
  border-radius:4px 4px 0 0;box-shadow:0 3px 9px #0002;
  font:11px Arial,sans-serif;color:#122b49
}
.sh-title{
  margin:-12px -12px 11px;padding:9px 11px;
  background:#f1f3f5;border-left:3px solid #7894ad;
  border-bottom:1px solid #c4ced8;border-radius:0;
  color:#0f2d4c
}
.sh-title-brand{display:flex;align-items:center;justify-content:space-between;padding:10px 11px}
.sh-title-brand div{display:flex;flex-direction:column;gap:1px}
.sh-title-brand strong{font-size:22px;line-height:1;color:#0b2c4b;letter-spacing:.5px}
.sh-title-brand span{font-size:10px;font-weight:700;color:#60758c}
.sh-title-brand b{
  padding:5px 10px;border:1px solid #9fb0c0;border-radius:3px;
  background:#fff;color:#173c5d;font-size:10px;letter-spacing:.4px
}
.sh-return-source{
  margin:-2px 0 8px auto;padding:5px 8px!important;
  border:1px solid #315f7f!important;background:#fff!important;
  color:#17466b!important;font-size:10px!important
}
.sh-field-label{
  display:block;margin:7px 0 4px;font-size:10px;font-weight:900;
  color:#385674;letter-spacing:.45px
}
.sh-flow-arrow{text-align:center;color:#7894ad;font-size:18px;line-height:14px;margin:4px 0}
.sh-input{
  border-color:#aab7c6;border-radius:3px;padding:9px;
  background:#fff;color:#1b2e43
}
.sh-input:focus{outline:2px solid rgba(49,95,127,.16);border-color:#315f7f}
#sh-lazy .sh-area{height:106px}
#sh-lazy-settings{margin:9px 0 7px}
#sh-lazy-settings .sh-btn{min-height:34px}
.sh-grid4{grid-template-columns:1.45fr .9fr .9fr .9fr}
.sh-metric{
  border-color:#b8c5d2;background:#f5f7f9;
  color:#28445f
}
.sh-metric b{color:#0e2f4f}
#sh-lazy>.sh-status{
  margin-top:7px;padding:7px 9px;border:1px solid #9eb8cd;
  background:#eef8ff;color:#153d5f
}
#sh-qty{width:300px}
#sh-qty .sh-qty-grid{gap:5px}
#sh-qty .sh-qty-grid button{min-height:38px;font-size:14px}
#sh-queue .sh-area{height:66px}

/* v0.0.5 — wider concise layout + super preflight */
#sh-dock{width:510px}
.sh-panel{width:510px}
#sh-lazy .sh-return-source{width:100%;box-sizing:border-box;margin:0 0 8px;padding:7px 10px!important}
.sh-field-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.sh-field-grid .sh-field-label{margin-top:0}
#sh-lazy .sh-area{height:96px}
#sh-lazy .sh-metrics{grid-template-columns:repeat(2,1fr)}
#sh-lazy .sh-metric{padding:7px 4px}
#sh-lazy .sh-metric b{font-size:20px}
.sh-preflight{
  margin:7px 0;padding:8px 9px;border:2px solid #94a3b8;border-left-width:7px;
  border-radius:3px;background:#f8fafc;display:grid;grid-template-columns:1fr auto;
  gap:8px;align-items:center
}
.sh-preflight-main{min-width:0;display:flex;flex-direction:column;gap:2px}
.sh-preflight-main strong{font-size:12px;font-weight:1000;letter-spacing:.25px}
.sh-preflight-main span{font:800 11px/1.25 Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sh-preflight-counts{display:flex;gap:5px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
.sh-preflight-counts b{padding:4px 6px;border:1px solid #b8c4cf;border-radius:3px;background:#fff;font-size:9px}
.sh-preflight-green{border-color:#18794e;border-left-color:#18794e;background:#ecfdf5;color:#14532d}
.sh-preflight-yellow{border-color:#b7791f;border-left-color:#b7791f;background:#fffbeb;color:#78350f}
.sh-preflight-red{
  border:4px solid #7a0000!important;
  border-left:12px solid #7a0000!important;
  background:#b00020!important;
  color:#fff!important;
  box-shadow:0 0 0 3px #fff,0 0 0 6px #b00020,0 6px 18px rgba(0,0,0,.28)!important;
  min-height:76px;
  padding:12px 14px!important
}
.sh-preflight-red .sh-preflight-main{gap:7px}
.sh-preflight-red .sh-preflight-main strong{
  color:#fff!important;
  font-size:20px!important;
  line-height:1.05!important;
  letter-spacing:.5px!important;
  text-transform:uppercase
}
.sh-preflight-red .sh-preflight-main span{
  color:#fff!important;
  font-size:14px!important;
  line-height:1.35!important;
  font-weight:1000!important;
  white-space:normal!important;
  overflow:visible!important;
  text-overflow:clip!important
}
.sh-preflight-red .sh-preflight-counts b{
  border:2px solid #fff!important;
  background:#fff!important;
  color:#7a0000!important;
  font-size:11px!important;
  padding:6px 8px!important
}
.sh-preflight-checking{border-color:#315f7f;border-left-color:#315f7f;background:#eef6fb;color:#173c5d}
.sh-preflight-idle{color:#475569}
@media(max-width:560px){#sh-dock,.sh-panel{width:calc(100vw - 28px)}.sh-field-grid{grid-template-columns:1fr}.sh-preflight{grid-template-columns:1fr}}

/* v0.0.18 — permanent wide + low profile so native Item Issue controls stay exposed */
#sh-dock{width:720px;max-width:calc(100vw - 28px)}
#sh-lazy,#sh-queue{width:720px;max-width:calc(100vw - 28px)}
#sh-lazy{padding:8px 10px}
#sh-lazy .sh-title{margin:-8px -10px 6px;padding:6px 9px}
#sh-lazy .sh-title-brand{padding:6px 9px}
#sh-lazy .sh-title-brand strong{font-size:18px}
#sh-lazy .sh-title-brand span{font-size:9px}
#sh-lazy .sh-title-brand b{padding:3px 8px}
#sh-lazy .sh-return-source{margin:0 0 5px;padding:4px 8px!important;min-height:25px}
#sh-lazy .sh-field-grid{gap:6px}
#sh-lazy .sh-field-label{margin:3px 0 2px;font-size:9px}
#sh-lazy .sh-input{padding:6px 7px}
#sh-lazy .sh-area{height:54px;min-height:54px}
#sh-lazy .sh-preflight{margin:5px 0;padding:5px 7px;min-height:0}
#sh-lazy .sh-preflight-main{gap:1px}
#sh-lazy .sh-preflight-main strong{font-size:11px}
#sh-lazy .sh-preflight-main span{font-size:10px}
#sh-lazy .sh-preflight-counts b{padding:3px 5px;font-size:8px}
#sh-lazy-settings{margin:5px 0;gap:5px}
#sh-lazy-settings .sh-btn{min-height:27px;padding:4px 6px;font-size:10px}
#sh-lazy .sh-grid4{gap:5px}
#sh-lazy .sh-grid4 .sh-btn{min-height:29px;padding:5px 6px}
#sh-lazy .sh-metrics{grid-template-columns:repeat(4,1fr);gap:4px;margin:5px 0 2px}
#sh-lazy .sh-metric{padding:4px 3px;font-size:8px}
#sh-lazy .sh-metric b{font-size:16px;margin-top:1px}
#sh-lazy>.sh-status{margin-top:4px;padding:4px 7px;min-height:24px}
#sh-lazy .sh-error{margin-top:2px}
#sh-lazy .sh-progress{max-height:72px;margin-top:4px;padding-top:4px}
#sh-lazy .sh-item{padding:3px 5px;margin-bottom:2px}
#sh-lazy .sh-result-summary{margin:4px 0}
#sh-lazy .sh-result-ok,#sh-lazy .sh-result-bad{padding:5px 7px}
#sh-lazy .sh-failure-pill{margin:4px 0 2px;padding:5px 7px}
#sh-lazy .sh-predicant-card{margin:5px 0;padding:7px 9px}
#sh-lazy .sh-notmoved-line{margin:1px 1px 3px}
#sh-lazy .sh-preflight-red{min-height:58px;padding:8px 10px!important}
#sh-lazy .sh-preflight-red .sh-preflight-main{gap:4px}
#sh-lazy .sh-preflight-red .sh-preflight-main strong{font-size:16px!important}
#sh-lazy .sh-preflight-red .sh-preflight-main span{font-size:12px!important}
#sh-lazy .sh-preflight-red .sh-preflight-counts b{font-size:9px!important;padding:4px 6px!important}
@media(max-width:760px){
  #sh-dock,#sh-lazy,#sh-queue{width:calc(100vw - 28px)}
}

/* v0.0.19 — non-modal RED/ASIDE sidecar */
#sh-aside{
  position:fixed;right:742px;bottom:58px;z-index:2147483645;
  width:250px;max-height:360px;box-sizing:border-box;overflow:auto;
  padding:8px;background:#fff;border:2px solid #991b1b;border-radius:5px;
  box-shadow:0 3px 10px #0002;font:11px Arial,sans-serif;color:#7f1d1d
}
#sh-aside[hidden]{display:none!important}
#sh-aside .sh-aside-head{
  display:flex;align-items:center;justify-content:space-between;gap:8px;
  margin:-8px -8px 7px;padding:7px 8px;background:#fff1f2;
  border-bottom:1px solid #fecaca;font-weight:1000
}
#sh-aside .sh-aside-total{font-size:10px;color:#991b1b;white-space:nowrap}
#sh-aside .sh-aside-list{display:grid;gap:6px}
#sh-aside .sh-aside-card{
  padding:6px 7px;border:1px solid #fecaca;border-left:5px solid #b91c1c;
  border-radius:3px;background:#fff7f7
}
#sh-aside .sh-aside-code{font:1000 12px Consolas,monospace;color:#7f1d1d}
#sh-aside .sh-aside-reason{margin-top:3px;font-weight:900;line-height:1.25;color:#991b1b}
#sh-aside .sh-aside-qty{margin-top:4px;font-weight:1000;color:#111827}
#sh-aside .sh-aside-note{
  margin-top:7px;padding-top:6px;border-top:1px solid #fecaca;
  font-size:10px;font-weight:800;color:#7f1d1d
}
@media(max-width:1100px){#sh-aside{right:14px;bottom:calc(58px + 330px);width:230px;max-height:220px}}

`;
  document.documentElement.appendChild(style);

  const moveCorner = { mode:'', state:'idle', holdUntil:0, timer:0 };

  function renderMoveCorner() {
    let root = $('#sh-move-corner');

    if (moveCorner.state === 'idle') {
      root?.remove();
      return;
    }

    if (!root) {
      root = document.createElement('div');
      root.id = 'sh-move-corner';
      document.body.appendChild(root);
    }

    root.className = moveCorner.state;
    if (moveCorner.state === 'active') {
      root.innerHTML = `<span class="sh-move-wheel"></span><b>${moveCorner.mode.toUpperCase()}</b>`;
      return;
    }

    const mark = moveCorner.state === 'waiting' ? '!' : moveCorner.state === 'done' ? '✓' : '×';
    const label = moveCorner.state === 'waiting'
      ? moveCorner.mode.toUpperCase()
      : moveCorner.state === 'done' ? 'DONE' : 'CHECK';
    root.innerHTML = `<span class="sh-move-mark">${mark}</span><b>${label}</b>`;
  }

  function setMoveCorner(mode, state) {
    const now = Date.now();
    if (state === 'idle' && moveCorner.mode && moveCorner.mode !== mode && moveCorner.state !== 'idle') {
      return;
    }
    if (
      state === 'idle' &&
      moveCorner.mode === mode &&
      (moveCorner.state === 'done' || moveCorner.state === 'check') &&
      moveCorner.holdUntil > now
    ) return;

    if (state === 'active' || state === 'waiting') {
      moveCorner.holdUntil = 0;
      if (moveCorner.timer) clearTimeout(moveCorner.timer);
      moveCorner.timer = 0;
    }

    moveCorner.mode = mode;
    moveCorner.state = state;
    renderMoveCorner();
  }

  function finishMoveCorner(mode, ok=true) {
    if (moveCorner.timer) clearTimeout(moveCorner.timer);
    moveCorner.mode = mode;
    moveCorner.state = ok ? 'done' : 'check';
    moveCorner.holdUntil = Date.now() + 5000;
    renderMoveCorner();
    moveCorner.timer = setTimeout(() => {
      if (moveCorner.mode !== mode || moveCorner.holdUntil > Date.now()) return;
      moveCorner.timer = 0;
      moveCorner.state = 'idle';
      renderMoveCorner();
    }, 5050);
  }

  function clearMoveCorner(mode) {
    if (moveCorner.mode !== mode) return;
    if (moveCorner.timer) clearTimeout(moveCorner.timer);
    moveCorner.timer = 0;
    moveCorner.mode = '';
    moveCorner.state = 'idle';
    moveCorner.holdUntil = 0;
    renderMoveCorner();
  }

  const feature = { queue:false, qty:false, lazy:false };
  const panels = {};
  const dockButtons = [];

  function panel(id, title, key) {
    const root = document.createElement('div');
    root.id = id;
    root.className = 'sh-panel';
    const returnSource = key === 'lazy'
      ? '<button type="button" class="sh-btn sh-return-source" data-return-source>↩ Return to Source</button>'
      : '';
    const header = key === 'lazy'
      ? '<div class="sh-title sh-title-brand"><div><strong>SIDELINE</strong><span>Container workflow</span></div><b>LAZY</b></div>'
      : `<div class="sh-title">${title}</div>`;
    root.innerHTML = header + returnSource;
    root.style.display = 'none';
    document.body.appendChild(root);
    panels[key] = root;
    return root;
  }

  function savePanelStates() {
    try { localStorage.setItem(PANEL_STATE_KEY, JSON.stringify(feature)); } catch {}
  }

  function restorePanelStates() {
    try {
      const saved = JSON.parse(localStorage.getItem(PANEL_STATE_KEY) || '{}');
      for (const key of ['queue','lazy','qty']) feature[key] = saved[key] === true;
    } catch {}
  }

  function mountDock() {
    if ($('#sh-dock')) return;
    restorePanelStates();
    const dock = document.createElement('div');
    dock.id = 'sh-dock';
    for (const [key,label] of [['queue','QUEUE'],['lazy','LAZY'],['qty','QTY']]) {
      const b = document.createElement('button');
      b.textContent = label;
      b.dataset.key = key;
      b.onclick = () => {
        feature[key] = !feature[key];
        savePanelStates();
        applyPanels();
      };
      dockButtons.push(b);
      dock.appendChild(b);
    }
    document.body.appendChild(dock);
  }

  function applyPanels() {
    for (const b of dockButtons) b.classList.toggle('sh-on', feature[b.dataset.key]);
    for (const [key,p] of Object.entries(panels)) {
      const display = feature[key] ? 'block' : 'none';
      if (p.style.display !== display) p.style.display = display;
    }
    let bottom = 58;
    for (const key of ['lazy','queue']) {
      const p = panels[key];
      if (!p || !feature[key]) continue;
      p.style.top = 'auto';
      p.style.maxHeight = '';
      p.style.overflowY = '';
      const position = `${bottom}px`;
      if (p.style.bottom !== position) p.style.bottom = position;
      bottom += Math.max(80, p.offsetHeight) + 10;
    }
  }

  let panelLayoutRaf = 0;
  function requestPanelLayout() {
    if (panelLayoutRaf) return;
    panelLayoutRaf = requestAnimationFrame(() => {
      panelLayoutRaf = 0;
      applyPanels();
    });
  }

  const q = { running:false, paused:false, index:0, list:[], failed:[], runSeq:0 };
  const queuePanel = panel('sh-queue', `Tote Queue v${VERSION}`, 'queue');
  queuePanel.insertAdjacentHTML('beforeend',
    '<textarea class="sh-input sh-area" placeholder="Paste tsX/csX list"></textarea>' +
    '<div class="sh-grid3"><button class="sh-btn sh-on" data-a="start">Start</button><button class="sh-btn" data-a="pause">Pause</button><button class="sh-btn sh-stop" data-a="stop">Stop</button></div>' +
    '<div class="sh-status"></div><div class="sh-error"></div>'
  );

  const qText = $('textarea', queuePanel), qStatus = $('.sh-status', queuePanel), qError = $('.sh-error', queuePanel);

  function parseContainers(text) {
    const seen = new Set();
    return (String(text).match(/\b(?:tsX|csX)[A-Za-z0-9_-]+\b/gi) || []).filter(v => {
      const k = v.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function renderQueue(note='') {
    const cur = q.list[q.index] || '—';
    setTextIfChanged(qStatus, `${q.running ? (q.paused ? 'PAUSED' : 'RUNNING') : 'STOPPED'} | ${Math.min(q.index,q.list.length)}/${q.list.length} | Current: ${cur}${note ? ' | '+note : ''}`);
    setTextIfChanged(qError, q.failed.length ? `Errors: ${q.failed.join(', ')}` : '');
  }

  async function queuePump(run=q.runSeq) {
    const active = () => run === q.runSeq && q.running;
    if (!active() || q.paused || shared.queueBusy) return;
    if (q.index >= q.list.length) {
      q.running = false;
      if (shared.owner === 'queue') shared.owner = '';
      renderQueue('done');
      return;
    }

    shared.queueBusy = true;
    shared.owner = 'queue';
    const code = q.list[q.index];

    try {
      renderQueue('validating by API');
      try {
        await scanSourceDirect(code);
      } catch (error) {
        if (!active()) return;
        if (error?.customerBound) {
          q.index++;
          renderQueue('customer-bound — skipped');
          return;
        }
        throw error;
      }

      if (!active()) return;
      renderQueue('emptying by API');
      await closeContainerDirect(code, true);
      if (!active()) return;

      q.index++;
      renderQueue('cleared');
    } catch (error) {
      if (!active()) return;

      if (error?.outcomeUnknown) {
        q.failed.push(`${code} (CLOSE UNKNOWN — VERIFY)`);
        q.running = false;
        q.paused = false;
        qError.textContent = `CLOSE UNKNOWN — ${code} — VERIFY TOTE STATE MANUALLY`;
        renderQueue('STOPPED — no automatic retry');
        return;
      }

      q.failed.push(`${code} (${error?.message || error})`);
      q.index++;
      renderQueue(error?.message || String(error));
    } finally {
      shared.queueBusy = false;
      if (!q.running && shared.owner === 'queue') shared.owner = '';
      if (active() && !q.paused) queueMicrotask(() => queuePump(run));
    }
  }

  queuePanel.onclick = event => {
    const action = event.target.dataset.a;
    if (!action) return;

    if (action === 'start') {

      q.runSeq++;
      q.list = parseContainers(qText.value);
      q.index = 0;
      q.failed = [];
      q.running = !!q.list.length;
      q.paused = false;
      renderQueue(q.running ? 'starting API queue' : 'no containers');
      queuePump(q.runSeq);
      return;
    }

    if (action === 'pause') {
      q.paused = !q.paused;
      event.target.textContent = q.paused ? 'Resume' : 'Pause';
      renderQueue();
      if (!q.paused) queuePump(q.runSeq);
      return;
    }

    if (action === 'stop') {
      q.runSeq++;
      q.running = false;
      q.paused = false;
      if (shared.owner === 'queue') shared.owner = '';
      renderQueue('stopped');
    }
  };
  renderQueue();

  const qtyPanel = panel('sh-qty', `Qty quick select v${VERSION}`, 'qty');
  qtyPanel.innerHTML += '<div class="sh-qty-grid"></div><button class="sh-btn sh-clear-tote" data-clear-tote>double click = clear</button><div class="sh-status"></div>';
  const qtyGrid = $('.sh-qty-grid', qtyPanel), qtyStatus = $('.sh-status', qtyPanel), qtyClear = $('[data-clear-tote]', qtyPanel);

  for (let i=1; i<=10; i++) {
    const b = document.createElement('button');
    b.className = 'sh-btn';
    b.textContent = i;
    b.onclick = () => runQty(i);
    qtyGrid.appendChild(b);
  }

  let qtyRequestSeq = 0;

  async function runQty(qty) {
    if (shared.owner) return;

    const token = ++qtyRequestSeq;
    shared.owner = 'qty';
    qtyStatus.textContent = `QTY ${qty} selected`;

    try {
      if (screen() === 'VERIFY') {
        const b = confirmButton();
        if (b) click(b);
      }

      const end = Date.now() + 300000; // 5 minutes for manual date entry.
      let input = null;
      let lastScreen = '';

      while (Date.now() < end && token === qtyRequestSeq) {
        const current = screen();

        if (current !== lastScreen) {
          lastScreen = current;

          if (current === 'EXPIRY') {
            qtyStatus.textContent = `QTY ${qty} saved — enter date`;
          } else if (current === 'VERIFY') {
            qtyStatus.textContent = `QTY ${qty} saved — verifying item`;
          } else if (current === 'QTY') {
            qtyStatus.textContent = `QTY ${qty} — entering now`;
          } else {
            qtyStatus.textContent = `QTY ${qty} saved — waiting`;
          }
        }

        if (current === 'QTY') {
          input = scanInput();
          if (input) break;
        }

        await sleep(50);
      }

      if (token !== qtyRequestSeq) return;
      if (!input) throw new Error(`QTY ${qty} timed out waiting for quantity screen`);

      if (token !== qtyRequestSeq) return;
      input.focus();
      input.select?.();
      setValue(input, '');
      await sleep(10);
      if (token !== qtyRequestSeq) return;
      setValue(input, qty);
      await sleep(25);
      if (token !== qtyRequestSeq) return;

      const b = confirmButton();
      enabled(b) ? click(b) : enter(input);

      qtyStatus.textContent = `QTY ${qty} sent`;
    } catch (e) {
      qtyStatus.textContent = e?.message || String(e);
    } finally {
      if (token === qtyRequestSeq) {
        setTimeout(() => {
          if (token === qtyRequestSeq && shared.owner === 'qty') shared.owner = '';
        }, 150);
      }
    }
  }

  qtyClear.addEventListener('dblclick', async e => {
    e.preventDefault();
    if (shared.owner) {
      qtyStatus.textContent = 'Busy — try again';
      return;
    }
    shared.owner = 'qty-clear';
    qtyClear.disabled = true;
    qtyStatus.textContent = 'Clearing current tote…';
    try {
      if (!changeButton()) throw new Error('No open container');
      const result = await closeOpenContainer('yes');
      if (result !== 'closed') throw new Error(result);
      qtyStatus.textContent = 'Current tote cleared';
    } catch (err) {
      qtyStatus.textContent = `Clear failed: ${err.message}`;
    } finally {
      qtyClear.disabled = false;
      shared.owner = '';
    }
  });

  const lazy = {
    running:false,
    preflightStart:null,
    paused:false,
    predicant:false,
    index:0,
    items:[],
    deferred:[],
    errors:0,
    src:'',
    dest:'',
    sourceMeta:null,
    error:'',
    note:'',
    runSeq:0,
    activeRun:null,
    predicantResolve:null,
    dateResolve:null,
    damagePaused:false,
    damagedDest:'',
    inputCollapsed:false,
    delayEnabled: localStorage.getItem(LAZY_DELAY_KEY) !== '0',
    nextMoveAt:0,
    recoveryStep:'',
    recoveryItem:''
  };


  // Super Preflight is the ONLY scan-item lookup engine.
  // Up to 5 harmless /api/scanitem lookups run in parallel. No move/close calls happen here.
  const preflightLookup = {
    sourceKey:'',
    generation:0,
    queue:[],
    entries:new Map(),
    controllers:new Set(),
    active:0
  };

  function preflightLookupKey(source, barcode) {
    return `${norm(source)}\u0000${clean(barcode).toUpperCase()}`;
  }

  function currentPreflightContext(generation) {
    return generation === preflightLookup.generation &&
      norm(lSrc.value) === preflightLookup.sourceKey;
  }

  function currentPreflightEntry(entry) {
    return !!entry && currentPreflightContext(entry.generation) &&
      preflightLookup.entries.get(entry.key) === entry;
  }

  function resetPreflightLookups(source='') {
    preflightLookup.generation++;
    lazy.preflightStart = null;
    lazy.dateResolve?.(null);
    for (const controller of preflightLookup.controllers) {
      try { controller.abort(); } catch {}
    }
    preflightLookup.controllers.clear();
    preflightLookup.queue.length = 0;
    for (const entry of preflightLookup.entries.values()) {
      if (!entry.settled) {
        entry.settled = true;
        entry.resolve(null);
      }
    }
    preflightLookup.entries.clear();

    const code = validContainer(source) ? clean(source) : '';
    preflightLookup.sourceKey = code ? norm(code) : '';
    resetPreflightWorkflowState();
  }

  function syncPreflightSource() {
    const source = validContainer(lSrc.value) ? clean(lSrc.value) : '';
    const key = source ? norm(source) : '';
    if (key !== preflightLookup.sourceKey) {
      if (key && preflightLookup.sourceKey !== key) clearAsidePanel();
      resetPreflightLookups(source);
    }
    return source;
  }

  function finishPreflightEntry(entry, value) {
    if (!entry || entry.settled) return;
    entry.settled = true;
    entry.resolve(value);
  }

  function pumpPreflightLookups() {
    while (preflightLookup.active < LOOKUP_CONCURRENCY && preflightLookup.queue.length) {
      const entry = preflightLookup.queue.shift();
      if (!currentPreflightEntry(entry)) { finishPreflightEntry(entry,null); continue; }
      preflightLookup.active++;
      entry.state = 'pending';
      const controller = new AbortController();
      entry.controller = controller;
      preflightLookup.controllers.add(controller);
      (async () => {
        try {
          const response = await sidelineRead(attempt => sidelineFetch(API_SCAN_ITEM, {
            method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},
            body:JSON.stringify(scanItemPayload(entry.source,entry.code)),signal:controller.signal,
            obs:{phase:'preflight.scan',attempt,entry,readOnly:true}
          }), {entry,phase:'preflight.scan'});
          if (!currentPreflightEntry(entry)) throw makeAbortError('Lookup context changed');
          const payload = await response.json();
          entry.response = payload;
          const result = await deepenHazmatPreflight(classifyPreflight(payload,entry.code),entry);
          if (!currentPreflightEntry(entry)) throw makeAbortError('Lookup context changed');
          if (result?.kind === 'retry') throw result.error || sidelineIssue(result.reason,'unknown');
          entry.result = result;
          entry.state = 'done';
          finishPreflightEntry(entry,result);
          onPreflightResolved(entry.code,result);
          traceSideline('PREFLIGHT_RESULT',{source:entry.source,barcode:entry.code,
            generation:entry.generation,decision:result.kind,reason:result.reason});
        } catch (error) {
          entry.error = {message:String(error?.message || error).slice(0,500),
            category:error?.name === 'AbortError' ? 'cancelled' : (error?.category || 'unknown'),
            status:Number(error?.status)||0};
          entry.state = entry.error.category === 'cancelled' ? 'cancelled' : 'failed';
          finishPreflightEntry(entry,null);
          if (currentPreflightEntry(entry)) {
            preflightState.last = {kind:'red',code:entry.code,reason:'CHECK FAILED — '+entry.error.message};
            renderPreflight();
          }
          traceSideline('PREFLIGHT_RESULT',{source:entry.source,barcode:entry.code,
            generation:entry.generation,decision:'blocked',...entry.error});
        } finally {
          preflightLookup.controllers.delete(controller);
          preflightLookup.active = Math.max(0,preflightLookup.active-1);
          // Keep failed entries until an explicit START or a new context. New
          // scans must not turn one allowed retry into an endless retry loop.
          if (!currentPreflightEntry(entry) && preflightLookup.entries.get(entry.key) === entry) {
            preflightLookup.entries.delete(entry.key);
          }
          pumpPreflightLookups();
          if (ISS_CONSOLE_WORKER) issSideEmitProgress(true);
        }
      })();
    }
  }

  function queuePreflightLookups(items=parseItems(lItems.value)) {
    if (lazy.running) return;
    const source = syncPreflightSource();
    if (!source) return;

    const generation = preflightLookup.generation;
    for (const item of items) {
      const key = preflightLookupKey(source,item.code);
      if (preflightLookup.entries.has(key)) continue;

      let resolve;
      const promise = new Promise(r => { resolve = r; });
      const entry = {
        key,source,code:item.code,generation,
        state:'queued',response:null,result:null,
        promise,resolve,settled:false,controller:null
      };
      preflightLookup.entries.set(key,entry);
      preflightLookup.queue.push(entry);
    }
    pumpPreflightLookups();
  }

  async function getPreflightResult(source,barcode) {
    const key = preflightLookupKey(source,barcode);
    let entry = preflightLookup.entries.get(key);
    if (!entry || entry.generation !== preflightLookup.generation) {
      queuePreflightLookups([{code:barcode,qty:1}]);
      entry = preflightLookup.entries.get(key);
    }
    if (!entry) return null;
    return entry.state === 'done' ? entry.result : await entry.promise;
  }

  const lazyPanel = panel('sh-lazy', `Lazy Sideline v${VERSION}`, 'lazy');
  lazyPanel.insertAdjacentHTML('beforeend',
    '<div class="sh-field-grid">' +
      '<div><label class="sh-field-label">SOURCE</label><input class="sh-input" data-f="src" placeholder="tsX / csX"></div>' +
      '<div><label class="sh-field-label">DESTINATION</label><input class="sh-input" data-f="dest" placeholder="tsX / csX"></div>' +
    '</div>' +
    '<label class="sh-field-label">ITEM BARCODES</label>' +
    '<textarea class="sh-input sh-area" data-f="items" placeholder="Scan or paste one per line"></textarea>' +
    '<div class="sh-preflight sh-preflight-idle">' +
      '<div class="sh-preflight-main"><strong>PREFLIGHT READY</strong><span>Scan an item</span></div>' +
      '<div class="sh-preflight-counts"><b data-pf="green">0 GOOD</b><b data-pf="yellow">0 EXPIRY</b><b data-pf="red">0 ASIDE</b></div>' +
    '</div>' +
    '<div class="sh-lazy-input-summary"><span data-lazy-input-summary>0 unique / 0 units</span><button type="button" data-a="toggle-items">Expand</button></div>' +
    '<div id="sh-lazy-settings">' +
      '<button class="sh-btn sh-on" data-a="clear-source">CLEAR SOURCE: ON</button>' +
      '<button class="sh-btn sh-on" data-a="delay">DELAY 2–8s: ON</button>' +
      '<input type="checkbox" data-f="clear" hidden>' +
    '</div>' +
    '<div class="sh-grid4">' +
      '<button class="sh-btn sh-on" data-a="start">RUN LAZY</button>' +
      '<button class="sh-btn" data-a="pause">Pause</button>' +
      '<button class="sh-btn sh-stop" data-a="stop">Stop</button>' +
      '<button class="sh-btn" data-a="reset">Reset</button>' +
    '</div>' +
    '<div class="sh-metrics">' +
      '<div class="sh-metric">Total units<b data-m="total">0</b></div>' +
      '<div class="sh-metric">Unique items<b data-m="unique">0</b></div>' +
      '<div class="sh-metric">Moved<b data-m="moved">0</b></div>' +
      '<div class="sh-metric">Remaining<b data-m="remaining">0</b></div>' +
    '</div>' +
    '<div class="sh-notmoved-line">Errors: <b data-m="failed">0</b></div>' +
    '<div class="sh-predicant-card"></div>' +
    '<div class="sh-failure-pill" data-a="copy-failed" title="Current run only — clears on Start, Reset, or page reload"></div>' +
    '<div class="sh-status"></div><div class="sh-error"></div><div class="sh-result-summary"></div><div class="sh-progress"></div>'
  );

  const lSrc = $('[data-f="src"]', lazyPanel);
  const lDest = $('[data-f="dest"]', lazyPanel);
  const lItems = $('[data-f="items"]', lazyPanel);
  const lClear = $('[data-f="clear"]', lazyPanel);
  const lStatus = $('.sh-status', lazyPanel);
  const lError = $('.sh-error', lazyPanel);
  const lResultSummary = $('.sh-result-summary', lazyPanel);
  const lPredicantCard = $('.sh-predicant-card', lazyPanel);
  const lFailurePill = $('.sh-failure-pill', lazyPanel);
  const lProgress = $('.sh-progress', lazyPanel);
  const lPause = $('[data-a="pause"]', lazyPanel);
  const lDelay = $('[data-a="delay"]', lazyPanel);
  const lClearToggle = $('[data-a="clear-source"]', lazyPanel);
  const lInputSummary = $('.sh-lazy-input-summary', lazyPanel);
  const lInputSummaryText = $('[data-lazy-input-summary]', lazyPanel);
  const lInputToggle = $('[data-a="toggle-items"]', lazyPanel);
  const lErrorCountLine = $('.sh-notmoved-line', lazyPanel);
  const mTotal = $('[data-m="total"]', lazyPanel);
  const mUnique = $('[data-m="unique"]', lazyPanel);
  const mMoved = $('[data-m="moved"]', lazyPanel);
  const mFailed = $('[data-m="failed"]', lazyPanel);
  const mRemaining = $('[data-m="remaining"]', lazyPanel);
  const lPreflight = $('.sh-preflight', lazyPanel);
  const lPreflightMain = $('.sh-preflight-main', lazyPanel);
  const pfGreen = $('[data-pf="green"]', lazyPanel);
  const pfYellow = $('[data-pf="yellow"]', lazyPanel);
  const pfRed = $('[data-pf="red"]', lazyPanel);

  const asidePanel = document.createElement('div');
  asidePanel.id = 'sh-aside';
  asidePanel.hidden = true;
  asidePanel.innerHTML =
    '<div class="sh-aside-head"><span>ASIDE / NOT PROCESSING</span><span class="sh-aside-total"></span></div>' +
    '<div class="sh-aside-list"></div>' +
    '<div class="sh-aside-note">These units will be removed when RUN starts.</div>';
  document.body.appendChild(asidePanel);
  const asideList = $('.sh-aside-list', asidePanel);
  const asideTotal = $('.sh-aside-total', asidePanel);

  lClear.checked = localStorage.getItem(CLEAR_SOURCE_KEY) === '1';
  lClear.addEventListener('change', () => localStorage.setItem(CLEAR_SOURCE_KEY, lClear.checked ? '1' : '0'));

  function validContainer(v) {
    return /^(?:cs|ts)x[0-9a-z_-]+$/i.test(clean(v));
  }

  function partialContainer(v) {
    return /^(?:|c|t|cs|ts|csx|tsx|csx[0-9a-z_-]*|tsx[0-9a-z_-]*)$/i.test(clean(v));
  }

  const preflightState = {
    pendingOccurrences:new Map(),
    trackedCounts:new Map(),
    redEntries:new Map(),
    dateCache:new Map(),
    dateQueue:[],
    dateBusy:false,
    stats:{green:0,yellow:0,red:0},
    last:{kind:'idle',code:'',reason:'Scan an item'}
  };

  function itemKey(code) {
    return clean(code).toUpperCase();
  }

  function clearAsidePanel() {
    preflightState.redEntries.clear();
    renderAsidePanel();
  }

  function renderAsidePanel() {
    if (!asidePanel) return;
    const entries = [...preflightState.redEntries.values()]
      .filter(entry => entry.qty > 0)
      .sort((a,b) => a.code.localeCompare(b.code));
    const total = entries.reduce((sum,entry) => sum + entry.qty,0);

    asidePanel.hidden = !entries.length;
    if (!entries.length) {
      asideList.innerHTML = '';
      asideTotal.textContent = '';
      return;
    }

    asideTotal.textContent = `${total} unit${total===1?'':'s'} affected`;
    asideList.innerHTML = entries.map(entry =>
      `<div class="sh-aside-card">` +
        `<div class="sh-aside-code">${esc(entry.code)}</div>` +
        `<div class="sh-aside-reason">${esc(entry.reason || 'NOT PROCESSING')}</div>` +
        `<div class="sh-aside-qty">Qty: ${entry.qty}</div>` +
      `</div>`
    ).join('');
  }

  function addRedEntry(code, reason, count=1) {
    const key = itemKey(code);
    if (!key) return;
    const amount = Math.max(1,Number(count)||1);
    const existing = preflightState.redEntries.get(key) || {code:clean(code),reason:'',qty:0,pendingQty:0};
    existing.code = clean(code) || existing.code;
    existing.reason = clean(reason) || existing.reason || 'NOT PROCESSING';
    existing.qty += amount;
    existing.pendingQty += amount;
    preflightState.redEntries.set(key,existing);
    renderAsidePanel();
  }

  function resetPreflightWorkflowState() {
    if (typeof preflightState === 'undefined') return;
    preflightState.pendingOccurrences.clear();
    preflightState.trackedCounts.clear();
    preflightState.dateCache.clear();
    preflightState.dateQueue.length = 0;
    preflightState.dateBusy = false;
    preflightState.stats = {green:0,yellow:0,red:0};
    preflightState.last = {kind:'idle',code:'',reason:'Scan an item'};
    renderPreflight();
  }

  function renderPreflight() {
    if (!lPreflight) return;
    const {kind,code,reason} = preflightState.last;
    lPreflight.className = `sh-preflight sh-preflight-${kind || 'idle'}`;
    const title = kind === 'green' ? '✓ GOOD — KEEP'
      : kind === 'yellow' ? '⚠ EXPIRY — KEEP'
      : kind === 'red' ? '✕ PUT ASIDE — DO NOT PROCESS'
      : kind === 'checking' ? '… CHECKING'
      : 'PREFLIGHT READY';
    lPreflightMain.innerHTML = `<strong>${esc(title)}</strong><span>${esc(code ? `${code} — ${reason || ''}` : (reason || 'Scan an item'))}</span>`;
    setTextIfChanged(pfGreen,`${preflightState.stats.green} GOOD`);
    setTextIfChanged(pfYellow,`${preflightState.stats.yellow} EXPIRY`);
    const redTotal = [...preflightState.redEntries.values()].reduce((sum,entry) => sum + Math.max(0,Number(entry.qty)||0),0);
    setTextIfChanged(pfRed,`${redTotal} ASIDE`);
  }

  function preflightResponseText(response) {
    return [
      response?.['@type'],response?.message,response?.description,
      response?.errorMessage,response?.errorCode,
      response?.filterResult?.filterType,
      response?.filterResult?.reason?.type,
      response?.filterResult?.reason?.description,
      response?.filterResult?.reason?.message,
      ...responseProblemLabels(response)
    ].map(clean).filter(Boolean).join(' ');
  }

  // ONE classifier used by both preflight and the actual Lazy run.
  function classifyPreflight(response,code) {
    const ctx = resolveItem(response,code);
    const text = preflightResponseText(response);

    if (/damaged/i.test(text)) return {kind:'red',reason:'DAMAGED / INCOMPATIBLE',ctx};
    if (isHazmatRejectionResponse(response)) return {kind:'red',reason:'HAZMAT / DANGEROUS GOODS',ctx};

    if (!ctx.ok) {
      const type = clean(ctx.type);
      const reason = ctx.invalid ? 'INVALID BARCODE'
        : type === 'RequestMultipleBarcodesResponse' ? 'MULTIPLE BARCODE MATCHES'
        : (type && type !== 'Unknown' ? type : 'NO ITEM DETAILS');
      return {kind:'red',reason,ctx};
    }

    const issue = scanStageIssue(ctx);
    if (issue) return {kind:'red',reason:issue.reason,ctx};

    // Overage / ItemNotInContainer remains allowed, matching known-good Lazy behaviour.
    if (ctx.dateType === 'EXPIRATION_DATE' || ctx.dateType === 'PRODUCTION_DATE') {
      return {kind:'yellow',reason:ctx.dateType === 'PRODUCTION_DATE' ? 'PRODUCTION DATE' : 'EXPIRY DATE',ctx};
    }

    return {kind:'green',reason:'GOOD TO GO',ctx};
  }

  async function deepenHazmatPreflight(result, entry = null) {
    const ctx = result?.ctx;
    if (!ctx?.ok || ctx.hazmat !== true || result.kind === 'red') return result;

    try {
      const hazmat = await pandashHazmatEligibility(ctx.asin,entry);
      if (hazmat.allowed) {
        return {
          ...result,
          reason:result.kind === 'yellow'
            ? result.reason
            : `HAZMAT L${hazmat.level} — OK TO PROCESS`,
          hazmat
        };
      }
      return {
        kind:'red',
        reason:`HAZMAT L${hazmat.level} — NOT PROCESSABLE`,
        ctx,
        hazmat
      };
    } catch (error) {
      return {
        kind:'retry',
        reason:`HAZMAT CHECK FAILED — ${clean(error?.message || error || 'RETRY')}`,
        error,
        ctx
      };
    }
  }

  function cachedPreflightResult(code) {
    const source = syncPreflightSource();
    if (!source) return null;
    return preflightLookup.entries.get(preflightLookupKey(source,code))?.result || null;
  }

  function handlePreflightOccurrence(code,result) {
    if (!result) return;
    if (result.kind === 'red') {
      addRedEntry(code,result.reason);
      preflightState.last = {kind:'red',code,reason:result.reason};
      renderPreflight();
      return;
    }
    if (result.kind === 'yellow') {
      // Drive shows a date-required row immediately; the operator chooses when to answer.
      // Native standalone retains its automatic preflight date question.
      if (ISS_LOCAL_FCR_WORKER) {
        preflightState.stats.yellow++;
        preflightState.last = {kind:'yellow',code,reason:result.reason};
        renderPreflight();
      } else {
        preflightState.dateQueue.push({code,ctx:result.ctx});
        pumpPreflightDates();
      }
      return;
    }
    preflightState.stats.green++;
    preflightState.last = {kind:'green',code,reason:result.reason};
    renderPreflight();
  }

  function onPreflightResolved(code,result) {
    const key = itemKey(code);
    const count = preflightState.pendingOccurrences.get(key)||0;
    if (!count) return;
    preflightState.pendingOccurrences.delete(key);
    for (let i=0;i<count;i++) handlePreflightOccurrence(code,result);
  }

  function registerPreflightOccurrence(code) {
    const key = itemKey(code);
    if (!key) return;
    const existing = cachedPreflightResult(code);
    if (existing) {
      handlePreflightOccurrence(code,existing);
      return;
    }
    preflightState.pendingOccurrences.set(key,(preflightState.pendingOccurrences.get(key)||0)+1);
  }

  function syncPreflightOccurrences(items=parseItems(lItems.value)) {
    const current = new Map(items.map(item=>[itemKey(item.code),item]));
    for (const [key,item] of current) {
      const now = itemQty(item);
      const tracked = preflightState.trackedCounts.get(key)||0;
      if (now > tracked) {
        for (let i=tracked;i<now;i++) registerPreflightOccurrence(item.code);
      }
      preflightState.trackedCounts.set(key,now);
    }
    for (const key of [...preflightState.trackedCounts.keys()]) {
      if (!current.has(key)) preflightState.trackedCounts.delete(key);
    }
  }

  async function pumpPreflightDates() {
    if (preflightState.dateBusy || !preflightState.dateQueue.length || lazy.running) return;
    if (ISS_CONSOLE_WORKER && !lazy.preflightStart) return;
    const generation = preflightLookup.generation;
    preflightState.dateBusy = true;
    try {
      while (currentPreflightContext(generation) && preflightState.dateQueue.length && !lazy.running) {
        const next = preflightState.dateQueue.shift();
        const key = itemKey(next.code);
        const item = {code:next.code,qty:1,ctx:next.ctx,status:'DATE'};

        let chosen = preflightState.dateCache.get(key) || null;

        if (!chosen) {
          // One question per DISTINCT barcode per RUN.
          // Repeated units of the same barcode silently reuse this RUN-only answer.
          chosen = await showApiDatePicker(item);
          if (!currentPreflightContext(generation)) return;
          if (!chosen) continue;
          preflightState.dateCache.set(key,chosen);
        }
        preflightState.stats.yellow++;
        preflightState.last = {kind:'yellow',code:next.code,reason:`DATE ${dateLabel(chosen.enteredMs)} — READY`};
        renderPreflight();
        setMoveCorner('lazy','idle');
        if (!ISS_CONSOLE_WORKER && !lazy.running) lItems.focus();
      }
    } finally {
      if (generation === preflightLookup.generation) preflightState.dateBusy = false;
    }
  }

  function purgeKnownRedTextareaLines() {
    const pending = [...preflightState.redEntries.entries()]
      .filter(([,entry]) => Math.max(0,Number(entry?.pendingQty)||0) > 0);
    if (!pending.length) return 0;

    const lines = String(lItems.value).split(/\r?\n/);
    let removed = 0;

    for (const [key,entry] of pending) {
      let left = Math.max(0,Number(entry.pendingQty)||0);
      for (let i=lines.length-1;i>=0 && left>0;i--) {
        if (itemKey(lines[i]) !== key) continue;
        lines.splice(i,1);
        left--;
        removed++;
      }
      entry.pendingQty = 0;
    }

    if (removed) {
      lItems.value = lines.join('\n').replace(/^\n+|\n+$/g,'');
      const end = lItems.value.length;
      lItems.setSelectionRange?.(end,end);
      preflightState.trackedCounts.clear();
      lazy.items = parseItems(lItems.value);
      syncPreflightOccurrences(lazy.items);
      renderLazy();
    }
    return removed;
  }

  async function settlePreflightForCurrentInput() {
    const items = parseItems(lItems.value);
    queuePreflightLookups(items);
    syncPreflightOccurrences(items);
    const source = syncPreflightSource();
    if (!source) return false;

    const generation = preflightLookup.generation;

    let failedLookup = '';
    await Promise.allSettled(items.map(async item => {
      const result = await getPreflightResult(source,item.code);
      if (!result) failedLookup ||= item.code;
    }));

    if (!currentPreflightContext(generation)) return false;

    if (failedLookup) {
      const failure = preflightLookup.entries.get(preflightLookupKey(source,failedLookup))?.error;
      lazy.error = `PREFLIGHT CHECK FAILED — ${failedLookup}: ${failure?.message || 'lookup incomplete'}`;
      preflightState.last = {kind:'red',code:failedLookup,reason:'LOOKUP FAILED — RETRY'};
      renderPreflight();
      return false;
    }

    // Drive processes ordinary READY items first. Unanswered dates are deferred,
    // not a mandatory blocking prompt before the first move.
    if (ISS_LOCAL_FCR_WORKER) return true;
    while (preflightState.dateBusy || preflightState.dateQueue.length || lazy.dateResolve) {
      pumpPreflightDates();
      await sleep(50);
      if (!currentPreflightContext(generation)) return false;
    }
    return true;
  }

  function parseItems(text) {
    const map = new Map();
    const src = norm(lSrc.value);
    const dest = norm(lDest.value);
    const trigger = norm(START_TRIGGER);

    for (const raw of String(text).split(/\r?\n/)) {
      const value = clean(raw);
      if (!value) continue;
      const normalized = norm(value);
      if (normalized === src || normalized === dest || normalized === trigger) continue;

      const key = value.toUpperCase();
      const item = map.get(key);
      if (item) item.qty++;
      else map.set(key, { code:value, qty:1, status:'', ctx:null });
    }
    return [...map.values()];
  }

  function markLazyRemovedItemsOnResume() {
    const wanted = new Set(parseItems(lItems.value).map(item => clean(item.code).toUpperCase()));
    let skippedUnits = 0;

    for (const item of lazy.items) {
      if (['MOVED','FAILED','INVALID','SKIPPED'].includes(item.status)) continue;
      if (wanted.has(clean(item.code).toUpperCase())) continue;

      skippedUnits += itemQty(item);
      item.skipRequested = true;
      item.status = 'SKIPPED';
      item.failReason = 'REMOVED WHILE PAUSED — NOT MOVED';
    }

    if (skippedUnits) renderLazy();
    return skippedUnits;
  }

  function lazyItemShouldSkip(item) {
    return !!(item?.skipRequested || item?.status === 'SKIPPED');
  }

  function markLazyItemSkipped(item) {
    if (!item) return;
    item.skipRequested = true;
    item.status = 'SKIPPED';
    item.failReason = item.failReason || 'REMOVED WHILE PAUSED — NOT MOVED';
    renderLazy();
  }

  function refreshItems() {
    if (!lazy.running) {
      lazy.items = parseItems(lItems.value);
      lazy.index = 0;
      queuePreflightLookups(lazy.items);
      syncPreflightOccurrences(lazy.items);
    }
    renderLazy();
  }

  let lazyProgressShape = '';

  function lazyRowView(it, i) {
    const cls = it.status === 'MOVED' ? 'moved'
      : it.status === 'UNKNOWN' ? 'failed'
      : it.status === 'INVALID' || it.status === 'FAILED' ? 'failed'
      : it.status === 'DEST_RETRY' ? 'retry'
      : it.status === 'DATE' ? 'parked'
      : (i === lazy.index && lazy.running ? 'current' : '');

    if (it.status === 'MOVED') {
      return {
        cls,
        html:`✓ MOVED → ${esc(lazy.dest || lDest.value || 'DEST')} &nbsp; | &nbsp; ${esc(it.code)} ×${it.qty}`
      };
    }

    if (it.status === 'UNKNOWN') {
      return {
        cls,
        html:`⚠ OUTCOME UNKNOWN — VERIFY BEFORE RETRY &nbsp; | &nbsp; ${esc(it.code)} ×${it.qty}${it.failReason ? ` &nbsp; | &nbsp; ${esc(it.failReason)}` : ''}`
      };
    }

    if (it.status === 'INVALID' || it.status === 'FAILED') {
      return {
        cls,
        html:`✕ NOT MOVED &nbsp; | &nbsp; ${esc(it.code)} ×${it.qty}${it.failReason ? ` &nbsp; | &nbsp; ${esc(it.failReason)}` : ''}`
      };
    }

    if (it.status === 'DEST_RETRY') {
      return {
        cls,
        html:`⚠ WAITING TO RETRY &nbsp; | &nbsp; ${esc(it.code)} ×${it.qty}` +
          (it.ctx?.fnsku ? ` &nbsp; | &nbsp; FNSKU ${esc(it.ctx.fnsku)}` : '')
      };
    }

    if (it.status === 'DATE') {
      const label = it.ctx?.dateType === 'PRODUCTION_DATE' ? 'PRODUCTION DATE' : 'EXPIRATION DATE';
      return {
        cls,
        html:`⚠ DATE REQUIRED &nbsp; | &nbsp; ${esc(it.code)} ×${it.qty} &nbsp; | &nbsp; ${label}`
      };
    }

    const icon = i === lazy.index && lazy.running ? '▶ ' : '• ';
    const status = it.status ? ` — ${esc(it.status)}` : '';
    return { cls, html:`${icon}${esc(it.code)} ×${it.qty}${status}` };
  }

  function renderLazyProgress() {
    const shape = lazy.items.map(it => `${it.code}\u0000${it.qty}`).join('\u0001');

    if (shape !== lazyProgressShape || lProgress.children.length !== lazy.items.length) {
      lazyProgressShape = shape;
      lProgress.innerHTML = lazy.items
        .map((_, i) => `<div class="sh-item" data-i="${i}"></div>`)
        .join('');
    }

    for (let i = 0; i < lazy.items.length; i++) {
      const row = lProgress.children[i];
      if (!row) continue;

      const view = lazyRowView(lazy.items[i], i);
      const signature = `${view.cls}|${view.html}`;

      if (row.dataset.sig === signature) continue;
      row.dataset.sig = signature;
      row.className = `sh-item ${view.cls}`;
      row.innerHTML = view.html;
    }
  }

  function setSummaryHtml(html) {
    if (lResultSummary.dataset.html === html) return;
    lResultSummary.dataset.html = html;
    lResultSummary.innerHTML = html;
    lResultSummary.classList.toggle('show', !!html);
  }

  function renderLazy(note='') {
    let total = 0;
    let movedUnits = 0;
    let failedUnits = 0;
    let unknownUnits = 0;
    let skippedUnits = 0;
    const movedItems = [];
    const failedItems = [];
    const unknownItems = [];

    for (const item of lazy.items) {
      const qty = itemQty(item);
      total += qty;

      if (item.status === 'MOVED') {
        movedUnits += qty;
        movedItems.push(item);
      } else if (item.status === 'UNKNOWN') {
        unknownUnits += qty;
        unknownItems.push(item);
      } else if (item.status === 'INVALID' || item.status === 'FAILED') {
        failedUnits += qty;
        failedItems.push(item);
      } else if (item.status === 'SKIPPED') {
        skippedUnits += qty;
      }
    }

    const remainingUnits = Math.max(0, total - movedUnits - failedUnits - unknownUnits - skippedUnits);

    const uniqueItems = lazy.items.length;
    setTextIfChanged(mTotal, total);
    setTextIfChanged(mUnique, uniqueItems);
    setTextIfChanged(mMoved, movedUnits);
    setTextIfChanged(mFailed, failedUnits + unknownUnits);
    setTextIfChanged(mRemaining, remainingUnits);

    const compactInput = !!lazy.inputCollapsed;
    const autoCapture = !!(
      compactInput &&
      (
        lazy.predicant ||
        (!lazy.running && validContainer(lSrc.value) && validContainer(lDest.value))
      )
    );

    setTextIfChanged(lInputSummaryText, autoCapture
      ? `AUTO SCAN ON • ${uniqueItems} unique / ${total} units`
      : `${uniqueItems} unique / ${total} units`);

    lItems.classList.toggle('sh-lazy-collapsed', compactInput);
    lInputSummary.classList.toggle('show', compactInput);
    lInputSummary.classList.toggle('auto', autoCapture);
    setTextIfChanged(lInputToggle, compactInput ? 'Expand' : 'Collapse');

    lErrorCountLine.classList.toggle('show', failedUnits > 0);

    if (lazy.predicant) {
      const predicantHtml =
        `<div class="sh-predicant-title">⚠ ACTION REQUIRED — RESCAN DESTINATION</div>` +
        `<div class="sh-predicant-dest">${esc(lazy.dest || 'DESTINATION')}</div>` +
        `<div class="sh-predicant-help"><strong>SCAN THAT DESTINATION AGAIN NOW</strong><br>` +
        `Lazy is paused and waiting. Recovery starts automatically after the scan.</div>` +
        `<button type="button" class="sh-btn sh-return-source-inline" data-return-source>↩ Return to Source</button>`;
      if (lPredicantCard.dataset.html !== predicantHtml) {
        lPredicantCard.dataset.html = predicantHtml;
        lPredicantCard.innerHTML = predicantHtml;
      }
    } else {
      if (lPredicantCard.dataset.html) {
        lPredicantCard.dataset.html = '';
        lPredicantCard.innerHTML = '';
      }
    }
    lPredicantCard.classList.toggle('show', lazy.predicant);
    lItems.classList.toggle('sh-predicant-scan', lazy.predicant);

    const showFailures = !!(failedItems.length && lazy.running);
    if (showFailures) {
      const preview = failedItems.slice(0, 2).map(it => it.code).join(', ');
      const extra = failedItems.length > 2 ? ` +${failedItems.length - 2} more` : '';
      setTextIfChanged(lFailurePill, `Failures: ${failedUnits} — ${preview}${extra} [click to copy]`);
    } else {
      setTextIfChanged(lFailurePill, '');
    }
    lFailurePill.classList.toggle('show', showFailures);

    const mode = lazy.predicant ? 'PREDICANT' : lazy.running ? (lazy.paused ? 'PAUSED' : 'RUNNING') : 'IDLE';
    setTextIfChanged(lStatus, `${mode}${lazy.note ? ` | ${lazy.note}` : ''}${note ? ' | '+note : ''}`);
    setTextIfChanged(lError, lazy.error);

    let summaryHtml = '';
    if (!lazy.running && (movedItems.length || failedItems.length || unknownItems.length)) {
      const movedLine = movedUnits
        ? `<div class="sh-result-ok">✓ ${movedUnits} MOVED → ${esc(lazy.dest || lDest.value || 'DESTINATION')}</div>`
        : '';

      const unknownLine = unknownItems.length
        ? `<div class="sh-result-bad"><div class="sh-result-bad-head"><div class="sh-result-bad-title">⚠ ${unknownUnits} OUTCOME UNKNOWN — VERIFY BEFORE RETRY</div></div><div class="sh-failed-list">${unknownItems.map(it => `<div class="sh-failed-card"><div class="sh-failed-top">${esc(it.code)}</div><div class="sh-failed-grid"><b>Qty:</b><span>${esc(String(it.qty))}</span><b>Issue:</b><span>${esc(it.failReason || 'MOVE OUTCOME UNKNOWN')}</span></div></div>`).join('')}</div></div>`
        : '';

      const failedLine = failedItems.length
        ? `<div class="sh-result-bad">` +
            `<div class="sh-result-bad-head">` +
              `<div class="sh-result-bad-title">✕ ${failedUnits} NOT MOVED</div>` +
              `<div class="sh-failed-actions"><button type="button" data-a="copy-failed">Copy failed barcodes</button></div>` +
            `</div>` +
            `<div class="sh-failed-list">${
              failedItems.map(it => {
                const asin = clean(it.ctx?.asin || it.code || '—');
                const fnsku = clean(it.ctx?.fnsku || '—');
                const issue = clean(it.failReason || (it.status === 'INVALID' ? 'INVALID BARCODE' : 'MOVE FAILED')) || 'MOVE FAILED';
                const scan = clean(it.code || '—');
                return `<div class="sh-failed-card">` +
                  `<div class="sh-failed-top">${esc(scan)}</div>` +
                  `<div class="sh-failed-grid">` +
                    `<b>ASIN:</b><span>${esc(asin)}</span>` +
                    `<b>FNSKU:</b><span>${esc(fnsku)}</span>` +
                    `<b>Qty:</b><span>${esc(String(it.qty))}</span>` +
                    `<b>Issue:</b><span>${esc(issue)}</span>` +
                  `</div>` +
                `</div>`;
              }).join('')
            }</div>` +
          `</div>`
        : '';

      summaryHtml = movedLine + unknownLine + failedLine;
    }

    setSummaryHtml(summaryHtml);
    renderLazyProgress();

    const lazyWaiting = !!(
      lazy.running &&
      (lazy.paused || lazy.predicant || lazy.damagePaused || lazy.dateResolve)
    );
    setMoveCorner('lazy', lazyWaiting ? 'waiting' : lazy.running ? 'active' : 'idle');
    if (lDelay) {
      lDelay.textContent = `DELAY 2–8s: ${lazy.delayEnabled ? 'ON' : 'OFF'}`;
      lDelay.classList.toggle('sh-on', lazy.delayEnabled);
      lDelay.classList.toggle('sh-setting-off', !lazy.delayEnabled);
      lDelay.title = lazy.delayEnabled ? 'Artificial Lazy move pacing is ON (2–8 seconds between confirmed moves).' : 'Artificial Lazy move pacing is OFF.';
    }
    if (lClearToggle) {
      lClearToggle.textContent = `CLEAR SOURCE: ${lClear.checked ? 'ON' : 'OFF'}`;
      lClearToggle.classList.toggle('sh-on', lClear.checked);
      lClearToggle.classList.toggle('sh-setting-off', !lClear.checked);
      lClearToggle.title = lClear.checked ? 'Clear source container when Lazy finishes.' : 'Leave source container open when Lazy finishes.';
    }
    requestPanelLayout();
  }

  let damageTitleTimer = 0;
  let damageOriginalTitle = '';

  function stopDamageAttention() {
    if (damageTitleTimer) {
      clearInterval(damageTitleTimer);
      damageTitleTimer = 0;
    }

    if (damageOriginalTitle) {
      document.title = damageOriginalTitle;
      damageOriginalTitle = '';
    }

    $('#sh-damage-alert')?.remove();
  }

  function startDamageAttention(destination) {
    stopDamageAttention();

    damageOriginalTitle = document.title || 'SidelineApp';

    const alert = document.createElement('div');
    alert.id = 'sh-damage-alert';
    alert.innerHTML =
      `<div class="sh-damage-box">⚠ DESTINATION CONTAINER DAMAGED — LAZY PAUSED` +
      `<small>${esc(destination)} — use a different destination before resuming</small></div>`;

    document.body.appendChild(alert);

    let flashes = 0;
    let warningTitle = false;

    damageTitleTimer = setInterval(() => {
      warningTitle = !warningTitle;
      document.title = warningTitle
        ? '⚠ DAMAGED DESTINATION — LAZY PAUSED ⚠'
        : damageOriginalTitle;

      flashes++;
      if (flashes >= 12) {
        clearInterval(damageTitleTimer);
        damageTitleTimer = 0;
        document.title = damageOriginalTitle;
      }
    }, 420);
  }

  function isDamagedDestinationResponse(response) {
    const result = response?.filterResult;
    const reason = result?.reason;

    if (result?.compatible !== false) return false;

    return (
      reason?.containerDamaged === true ||
      clean(reason?.['@type']).toLowerCase() === 'damageditemsfilterresultreason' ||
      /damageditemsfilter/i.test(clean(result?.filterType))
    );
  }

  function pauseForDamagedDestination(item, ctx, response) {
    item.status = 'DEST_RETRY';
    item.failReason = `DESTINATION DAMAGED — ${lazy.dest} — WAITING TO RETRY`;

    lazy.damagePaused = true;
    lazy.damagedDest = lazy.dest;
    lazy.paused = true;
    lazy.error = `DESTINATION DAMAGED — ${lazy.dest} — RUN PAUSED`;
    lazy.note = `${ctx.barcode}${ctx.fnsku ? ` / ${ctx.fnsku}` : ''} NOT MOVED YET — change destination, then Resume to retry it`;

    lDest.classList.remove('good');
    lDest.classList.add('bad');
    if (lPause) lPause.textContent = 'Resume';

    setLazyRunningIndicator(false);
    startDamageAttention(lazy.dest);
    renderLazy();
  }

  function resetLazy(note='reset') {
    cancelLazyRun();
    clearAsidePanel();
    resetPreflightLookups();
    clearMoveCorner('lazy');
    lazyProgressShape = '';
    lazy.running = false;
    lazy.paused = false;
    lazy.predicant = false;
    lazy.damagePaused = false;
    lazy.damagedDest = '';
    lazy.inputCollapsed = false;
    clearLazyCollapsedScanBuffer();
    stopDamageAttention();
    if (lPause) lPause.textContent = 'Pause';
    lazy.index = 0;
    lazy.items = [];
    lazy.deferred = [];
    lazy.errors = 0;
    lazy.src = '';
    lazy.dest = '';
    lazy.sourceMeta = null;
    lazy.error = '';
    lazy.note = note;
    lazy.predicantResolve?.();
    lazy.predicantResolve = null;
    clearLazyRecovery();
    lazy.dateResolve?.(null);
    lazy.dateResolve = null;
    shared.owner = '';
    lSrc.value = '';
    lDest.value = '';
    lItems.value = '';
    lSrc.classList.remove('good','bad');
    lDest.classList.remove('good','bad');
    $('#sh-og-expiry')?.remove();
    setLazyRunningIndicator(false);
    renderLazy();
    if (!ISS_CONSOLE_WORKER) setTimeout(() => lSrc.focus(), 0);
  }

  function setLazyInputCollapsed(collapsed, { focusItems = false } = {}) {
    lazy.inputCollapsed = !!collapsed;
    if (!lazy.inputCollapsed) clearLazyCollapsedScanBuffer();
    renderLazy();

    if (!ISS_CONSOLE_WORKER && focusItems && !lazy.inputCollapsed) {
      setTimeout(() => lItems.focus(), 0);
    }
  }

  let lazySourceRevealTimer = 0;
  function revealLazyItemsForSource() {
    clearTimeout(lazySourceRevealTimer);
    lazySourceRevealTimer = 0;

    if (lazy.running || !validContainer(lSrc.value)) return false;
    setLazyInputCollapsed(false);
    return true;
  }

  function scheduleLazySourceReveal() {
    clearTimeout(lazySourceRevealTimer);
    if (!validContainer(lSrc.value)) return;
    lazySourceRevealTimer = setTimeout(revealLazyItemsForSource, 90);
  }

  function installContainerAdvance(input, next, { revealItems = false } = {}) {
    input.addEventListener('input', () => {
      if (!partialContainer(input.value)) {
        input.value = '';
        input.classList.remove('good');
        input.classList.add('bad');
        lazy.error = 'Container must start with csX or tsX.';
      } else {
        const ok = validContainer(input.value);
        input.classList.toggle('good', ok);
        input.classList.toggle('bad', !!input.value && !ok);
        if (ok) lazy.error = '';
      }
      refreshItems();
      if (revealItems) scheduleLazySourceReveal();
    });

    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== 'Tab') return;
      e.preventDefault();
      const v = clean(input.value);
      if (!validContainer(v)) {
        lazy.error = 'Container must start with csX or tsX.';
        input.value = '';
        input.classList.remove('good');
        input.classList.add('bad');
        renderLazy();
        return;
      }
      lazy.error = '';
      input.classList.add('good');
      if (revealItems) revealLazyItemsForSource();
      setTimeout(() => next.focus(), 0);
      renderLazy();
    });

    input.addEventListener('paste', () => setTimeout(() => {
      if (validContainer(input.value)) {
        lazy.error = '';
        input.classList.add('good');
        input.classList.remove('bad');
        if (revealItems) revealLazyItemsForSource();
        next.focus();
      } else {
        lazy.error = 'Container must start with csX or tsX.';
        input.value = '';
        input.classList.remove('good');
        input.classList.add('bad');
      }
      renderLazy();
    }, 0));
  }

  installContainerAdvance(lSrc, lDest, { revealItems: true });
  installContainerAdvance(lDest, lItems);

  let itemRefreshTimer = 0;
  function scheduleItemRefresh(delay=100) {
    clearTimeout(itemRefreshTimer);
    itemRefreshTimer = setTimeout(refreshItems, delay);
  }

  lItems.addEventListener('input', () => scheduleItemRefresh(80));
  lItems.addEventListener('paste', () => scheduleItemRefresh(0));

  function currentTextareaLine() {
    const value = lItems.value;
    const pos = lItems.selectionStart ?? value.length;
    const start = value.lastIndexOf('\n', Math.max(0, pos - 1)) + 1;
    const next = value.indexOf('\n', pos);
    const end = next < 0 ? value.length : next;
    return { value, start, end, code:clean(value.slice(start,end)) };
  }

  function removeTextareaLine(line) {
    let before = line.value.slice(0,line.start);
    let after = line.value.slice(line.end);
    if (before.endsWith('\n') && after.startsWith('\n')) after = after.slice(1);
    lItems.value = before + after;
    lItems.focus();
    lItems.setSelectionRange?.(lItems.value.length,lItems.value.length);
    refreshItems();
  }

  function acceptCollapsedLazyScan(rawCode) {
    const code = clean(rawCode);
    if (!code) return false;

    const sameSrc = norm(code) === norm(lSrc.value);
    const sameDest = norm(code) === norm(lDest.value);
    const startTrigger = norm(code) === norm(START_TRIGGER);

    if (lazy.predicant && sameDest) {
      if (lazy.predicantResolve) {
        const done = lazy.predicantResolve;
        lazy.predicantResolve = null;
        lazy.error = '';
        lazy.note = 'destination rescan received — recovery continuing';
        lItems.classList.remove('sh-predicant-scan');
        done();
      } else {
        lazy.note = 'destination rescan received — recovery already running';
        renderLazy();
      }
      return true;
    }

    if (!lazy.running && validContainer(lSrc.value) && validContainer(lDest.value)) {
      if (sameSrc || sameDest) return true;

      if (startTrigger) {
        refreshItems();
        if (lazy.items.length) startLazy();
        return true;
      }

      const current = lItems.value.trimEnd();
      lItems.value = current ? `${current}\n${code}` : code;
      refreshItems();
      lazy.inputCollapsed = true;
      lazy.note = `auto-captured ${code}`;
      renderLazy();
      return true;
    }

    return false;
  }

  let lazyCollapsedScanBuffer = '';
  let lazyCollapsedScanTimer = 0;

  function clearLazyCollapsedScanBuffer() {
    lazyCollapsedScanBuffer = '';
    if (lazyCollapsedScanTimer) {
      clearTimeout(lazyCollapsedScanTimer);
      lazyCollapsedScanTimer = 0;
    }
  }

  document.addEventListener('keydown', e => {
    if (!lazy.inputCollapsed || e.ctrlKey || e.altKey || e.metaKey) return;

    const shouldCapture =
      lazy.predicant ||
      (!lazy.running && validContainer(lSrc.value) && validContainer(lDest.value));

    if (!shouldCapture) return;

    const target = e.target;
    const typingElsewhere =
      target &&
      target !== document.body &&
      target !== document.documentElement &&
      target !== lItems &&
      (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      );

    if (typingElsewhere) return;

    if (typeof e.key === 'string' && e.key.length === 1) {
      lazyCollapsedScanBuffer += e.key;

      if (lazyCollapsedScanTimer) clearTimeout(lazyCollapsedScanTimer);
      lazyCollapsedScanTimer = setTimeout(clearLazyCollapsedScanBuffer, 1200);

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return;
    }

    if (e.key === 'Enter' && lazyCollapsedScanBuffer) {
      const code = clean(lazyCollapsedScanBuffer);
      clearLazyCollapsedScanBuffer();

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      acceptCollapsedLazyScan(code);
    }
  }, true);

  lItems.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;

    let line = currentTextareaLine();
    const specialLine =
      (line.code && norm(line.code) === norm(lSrc.value)) ||
      (line.code && norm(line.code) === norm(lDest.value)) ||
      (line.code && norm(line.code) === norm(START_TRIGGER));

    const sameSrc = line.code && norm(line.code) === norm(lSrc.value);
    const sameDest = line.code && norm(line.code) === norm(lDest.value);
    const startTrigger = line.code && norm(line.code) === norm(START_TRIGGER);

    if (sameSrc || sameDest || startTrigger) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      removeTextareaLine(line);

      if (lazy.predicant && sameDest) {
        if (lazy.predicantResolve) {
          const done = lazy.predicantResolve;
          lazy.predicantResolve = null;
          lazy.error = '';
          lazy.note = 'destination rescan received — recovery continuing';
          lItems.classList.remove('sh-predicant-scan');
          done();
        } else {
          lazy.note = 'destination rescan received — recovery already running';
          renderLazy();
        }
        return;
      }

      if (!lazy.running && lazy.items.length) startLazy();
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const start = lItems.selectionStart ?? lItems.value.length;
    const end = lItems.selectionEnd ?? start;
    const before = lItems.value.slice(0,start).replace(/[\t ]+$/,'');
    const after = lItems.value.slice(end).replace(/^\r?\n+/,'');
    lItems.value = `${before}\n${after}`;
    const caret = before.length + 1;
    lItems.setSelectionRange?.(caret,caret);
    scheduleItemRefresh(0);
  }, true);

  function setLazyRunningIndicator(on) {
    let el = $('#sh-lazy-running-indicator');

    if (on) {
      if (!el) {
        el = document.createElement('div');
        el.id = 'sh-lazy-running-indicator';
        el.innerHTML = '<div class="sh-lazy-spinner"></div>';
        document.body.appendChild(el);
      }
      return;
    }

    el?.remove();
  }

  function requestId() {
    const id = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `amzn1.fc.v1.common.request-id.v1.AFTPoirotWebsite.${id}`;
  }

  function scanSourcePayload(container) {
    return { containerScannableId:container, requestId:requestId(), tool:TOOL };
  }

  function scanItemPayload(source, barcode) {
    return {
      containerScannableId:source,
      itemBarcode:barcode,
      isMasterpack:null,
      itemAndonContext:null,
      requestId:requestId(),
      tool:TOOL
    };
  }

  function buildMovePayload(source, destination, sourceMeta, ctx, qty=1, expirationMs=null) {
    const item = ctx.item;
    const sku = ctx.sku;
    const records = ctx.records?.length ? ctx.records : [item];

    return {
      itemExternalId:null,
      sourceContainerScannableId:source,
      destinationContainerScannableId:destination,
      scannableId:clean(item.scannableId || ctx.barcode),
      quantity:String(Math.max(1, Number(qty) || 1)),
      itemDetails:records.map(record => {
        const recordSku = record.skuDetail || sku;
        return {
          fcsku:clean(recordSku.fcSku),
          quantity:Number.isFinite(Number(record.quantity)) ? Number(record.quantity) : 0,
          consumerType:record.consumer ?? null,
          disposition:record.disposition ?? null,
          referenceId:record.referenceId ?? null,
          fnsku:clean(recordSku.fnSku)
        };
      }),
      foundProblems:[null,null,null],
      scannedSourceContainerAsDestination:false,
      datelotDetail:sku.datelotDetail || null,
      userEnteredExpirationDate:expirationMs,
      mlcCaptureDetail:{
        mlcClass:sku.mlcDetail?.mlcClass ?? 'UNKNOWN',
        userEnteredLotCode:null,
        mlcMissing:sku.mlcDetail?.mlcMissing ?? false,
        mlcNotEnteredReason:null,
        mlcCaptureMethod:null
      },
      itemMovedToISS:false,
      candidatePurchaseOrders:[],
      packHierarchyDetail:null,
      itemAndonContext:null,
      processPath:sourceMeta?.processPath ?? 'UNDETERMINED',
      requestId:requestId(),
      tool:TOOL
    };
  }

  function payloadHasCustomerBound(value, seen=new Set()) {
    if (value == null) return false;
    if (typeof value === 'string') return /customer\s*bound\s*shipment/i.test(value);
    if (typeof value !== 'object') return false;
    if (seen.has(value)) return false;
    seen.add(value);

    if (Array.isArray(value)) return value.some(child => payloadHasCustomerBound(child, seen));
    return Object.entries(value).some(([key, child]) =>
      /customer\s*bound\s*shipment/i.test(key) || payloadHasCustomerBound(child, seen)
    );
  }

  async function scanSourceDirect(container) {
    const code = clean(container);
    if (!validContainer(code)) throw new Error('Source scan requires a valid csX/tsX container.');

    let response;
    try {
      response = await sidelineFetch(API_SCAN_SOURCE, {
        method:'POST',
        credentials:'same-origin',
        headers:{'content-type':'application/json'},
        body:JSON.stringify(scanSourcePayload(code))
      });
    } catch (cause) {
      const error = new Error(`Source scan failed for ${code}: ${cause?.message || cause}`);
      error.cause = cause;
      throw error;
    }

    let raw = '';
    try {
      raw = await response.text();
    } catch (cause) {
      const error = new Error(`Source response could not be read for ${code}.`);
      error.cause = cause;
      throw error;
    }

    let payload = raw;
    try { payload = raw ? JSON.parse(raw) : null; } catch {}

    if (payloadHasCustomerBound(payload)) {
      const error = new Error('CUSTOMER-BOUND SHIPMENT');
      error.customerBound = true;
      error.payload = payload;
      throw error;
    }

    if (
      !response.ok ||
      clean(payload?.['@type']) !== 'ScanSourceContainerResponse' ||
      payload?.success !== true
    ) {
      const reason = clean(
        payload?.message ||
        payload?.description ||
        payload?.errorMessage ||
        payload?.['@type'] ||
        (response.ok ? 'SOURCE VALIDATION FAILED' : `HTTP ${response.status}`)
      );
      const error = new Error(reason || 'SOURCE VALIDATION FAILED');
      error.payload = payload;
      throw error;
    }

    return payload;
  }

  function closeContainerPayload(container, containerEmpty) {
    return {
      containerScannableId:container,
      containerEmpty:containerEmpty === true,
      directedLabel:false,
      processPath:'UNDETERMINED',
      requestId:requestId(),
      tool:TOOL
    };
  }

  async function closeContainerDirect(container, containerEmpty) {
    const code = clean(container);
    if (!validContainer(code)) throw new Error('Direct close requires a valid csX/tsX container.');

    let response;
    try {
      response = await sidelineFetch(API_CLOSE_CONTAINER, {
        method:'POST',
        credentials:'same-origin',
        headers:{'content-type':'application/json'},
        body:JSON.stringify(closeContainerPayload(code, containerEmpty))
      });
    } catch (cause) {
      const error = new Error(`Close outcome UNKNOWN for ${code} — verify container state manually before retrying.`);
      error.name = 'CloseOutcomeUnknownError';
      error.outcomeUnknown = true;
      error.cause = cause;
      throw error;
    }

    let raw = '';
    try {
      raw = await response.text();
    } catch (cause) {
      const error = new Error(`Close outcome UNKNOWN for ${code} — response could not be read. Verify container state manually before retrying.`);
      error.name = 'CloseOutcomeUnknownError';
      error.outcomeUnknown = true;
      error.cause = cause;
      throw error;
    }

    let payload = raw;
    try { payload = raw ? JSON.parse(raw) : null; } catch {}

    if (
      !response.ok ||
      clean(payload?.['@type']) !== 'CloseContainerResponse' ||
      payload?.success !== true
    ) {
      const error = new Error(`Close NOT CONFIRMED for ${code}${response.ok ? '' : ` — HTTP ${response.status}`} — verify state before retrying.`);
      error.name = 'CloseNotConfirmedError';
      error.outcomeUnknown = true;
      error.payload = payload;
      throw error;
    }

    return payload;
  }

  function beginLazyRun() {
    return beginRun(lazy);
  }

  function cancelLazyRun() {
    cancelRun(lazy);
  }

  function finishLazyRun(run) {
    finishRun(lazy, run);
  }

  function currentLazyRun(run=lazy.activeRun) {
    return currentRun(lazy, run);
  }

  function runWasCancelled(error, run) {
    return error?.name === 'AbortError' || !currentLazyRun(run);
  }

  function api(path, body, run=lazy.activeRun) {
    return postJson(path, body, lazy, run);
  }

  function isOverageLabel(value) {
    return /\boverage(?:s)?\b|\bitem\s+not\s+in\s+(?:source\s+)?container\b|\bnot\s+in\s+source\s+container\b/i.test(clean(value));
  }

  function isBenignOverageCompanion(value) {
    const label = clean(value);
    return !label || isOverageLabel(label) || /^(?:bad request|conflict|request failed|http\s*[45]\d\d|[45]\d\d)$/i.test(label);
  }

  function responseProblemLabels(response) {
    return (Array.isArray(response?.problems) ? response.problems : [])
      .filter(Boolean)
      .map(problem => clean(
        problem?.description ||
        problem?.message ||
        problem?.reason ||
        problem?.code ||
        problem?.['@type'] ||
        ''
      ))
      .filter(Boolean);
  }

  function isAllowedOverageResponse(response) {
    if (!response || typeof response !== 'object') return false;

    const type = clean(response?.['@type']);
    if (type === 'InvalidBarcodeResponse' || type === 'RequestMultipleBarcodesResponse') return false;
    if (isHazmatRejectionResponse(response) || hasPredicant(response) || isDamagedDestinationResponse(response)) return false;

    const filter = response?.filterResult;
    const filterReason = clean(
      filter?.reason?.type ||
      filter?.reason?.description ||
      filter?.reason?.message ||
      filter?.reason?.['@type'] ||
      filter?.filterType ||
      ''
    );
    if (filter?.compatible === false && !isOverageLabel(filterReason)) return false;

    const problems = responseProblemLabels(response);
    if (problems.some(label => !isOverageLabel(label))) return false;

    const diagnosticLabels = [
      response?.message,
      response?.description,
      response?.errorMessage,
      response?.errorCode,
      filterReason,
      ...problems
    ].map(clean).filter(Boolean);

    const explicitOverage = isOverageLabel(type) || diagnosticLabels.some(isOverageLabel);    if (!explicitOverage) return false;

    // Overage is the ONLY exception. A response that also carries another
    // substantive problem stays fail-closed even if the word Overage appears.
    if (diagnosticLabels.some(label => !isBenignOverageCompanion(label))) return false;

    const fatalText = [type, ...diagnosticLabels].join(' ');
    if (/hazmat|dangerous.?goods|invalid\s+barcode|incompatib|damaged|predicant|customer\s*bound/i.test(fatalText)) {
      return false;
    }

    return true;
  }

  function resolveItem(response, barcode) {
    const type = clean(response?.['@type']);
    const allowedOverage = isAllowedOverageResponse(response);
    if (!response || type === 'InvalidBarcodeResponse' || (response.success === false && !allowedOverage)) {
      return { ok:false, invalid:type === 'InvalidBarcodeResponse', type:type || 'Unknown' };
    }

    const records = (Array.isArray(response.items) ? response.items : [])
      .filter(record => record?.skuDetail);

    const primary = records[0] || null;
    const sku = primary?.skuDetail;

    if (!primary || !sku) {
      return { ok:false, invalid:false, type:type || 'Unknown' };
    }

    return {
      ok:true,
      type,
      barcode,
      item:primary,
      records,
      sku,
      asin:clean(sku.asin),
      fnsku:clean(sku.fnSku),
      fcsku:clean(sku.fcSku),
      dateType:clean(sku.datelotDetail?.expirationPromptType),
      dateDetail:sku.datelotDetail || {},
      hazmat:sku.hazmat === true,
      permissionLevel:clean(sku.itemDropzoneRecommendation?.permissionLevel).toUpperCase(),
      overage:allowedOverage,
      notInSource:type === 'ItemNotInContainerResponse' || records.every(record => Number(record.quantity) === 0)
    };
  }

  function scanStageIssue(ctx) {
    const permissionLevel = clean(ctx?.permissionLevel).toUpperCase();
    if (permissionLevel !== 'UNDER_REVIEW') return null;

    const hazmat = ctx?.hazmat === true;
    return {
      kind:hazmat ? 'hazmat' : 'under-review',
      title:hazmat ? 'HAZMAT / UNDER REVIEW — PUT ASIDE' : 'ASIN UNDER REVIEW — ITEM NOT MOVED',
      reason:hazmat ? 'HAZMAT / UNDER REVIEW — RIVER REQUIRED' : 'ASIN UNDER REVIEW — RIVER REQUIRED'
    };
  }

  function isHazmatRejectionResponse(response) {
    if (!response || typeof response !== 'object') return false;

    const filter = response.filterResult || {};
    const filterReason = filter.reason || {};
    const responseReason = response.reason || {};
    const problems = (Array.isArray(response.problems) ? response.problems : []).filter(Boolean);
    const labels = [
      response.message,
      response.description,
      response.errorMessage,
      response.errorCode,
      typeof response.reason === 'string' ? response.reason : '',
      responseReason.type,
      responseReason.description,
      responseReason.message,
      responseReason['@type'],
      filterReason.type,
      filterReason.description,
      filterReason.message,
      filterReason['@type'],
      filter.filterType,
      ...problems.flatMap(problem => [
        problem?.description,
        problem?.message,
        problem?.reason,
        problem?.code,
        problem?.['@type']
      ])
    ].map(clean).filter(Boolean);

    if (!labels.some(label => /hazmat|dangerous.?goods/i.test(label))) return false;

    const responseType = clean(response?.['@type']);
    return !!(
      response.success === false ||
      filter.compatible === false ||
      problems.length ||
      response.errorMessage ||
      response.errorCode ||
      /error|reject|incompat|filter/i.test(responseType)
    );
  }

  function moveOk(response) {
    if (isAllowedOverageResponse(response)) return true;
    if (!response || response.success !== true) return false;
    if (response.filterResult?.compatible === false) return false;
    if (isHazmatRejectionResponse(response)) return false;
    if (hasPredicant(response)) return false;

    return true;
  }

  function moveReason(response) {
    if (!response) return 'EMPTY MOVE RESPONSE';
    if (isHazmatRejectionResponse(response)) return 'HAZMAT';
    if (isAllowedOverageResponse(response)) return 'OVERAGE';

    const reason = response.filterResult?.reason;
    const reasonType = clean(reason?.['@type']).toLowerCase();
    const responseType = clean(response?.['@type']);

    if (
      reason?.containerDamaged === true ||
      reasonType === 'damageditemsfilterresultreason' ||
      /damageditemsfilter/i.test(clean(response.filterResult?.filterType))
    ) {
      return 'DESTINATION DAMAGED';
    }

    if (reasonType === 'rafilterresultreason') {
      const type = clean(reason?.type).toUpperCase();
      if (type === 'HAZMAT') return 'HAZMAT';
      if (type) return type;
      return 'DESTINATION INCOMPATIBLE';
    }

    if (response.filterResult?.compatible === false) {
      if (reason?.type) return clean(reason.type).toUpperCase();
      return 'DESTINATION INCOMPATIBLE';
    }

    const problems = (response.problems || []).filter(Boolean);
    if (problems.length) {
      const labels = problems.map(problem =>
        clean(problem?.description || problem?.['@type'] || '')
      ).filter(Boolean);
      if (labels.length) return labels.join(', ');
    }

    if (response.success === false) {
      return responseType && responseType !== 'MoveItemsResponse'
        ? responseType.replace(/Response$/,'')
        : 'MOVE REJECTED';
    }

    return responseType || 'MOVE REJECTED';
  }

  function hasPredicant(value) {
    if (value == null) return false;
    if (typeof value === 'string') return /predicant/i.test(value);
    if (Array.isArray(value)) return value.some(hasPredicant);
    if (typeof value !== 'object') return false;
    return Object.entries(value).some(([k,v]) => {
      if (/predicant/i.test(k)) {
        if (v === true) return true;
        if (typeof v === 'string' && v && !/^false$/i.test(v)) return true;
      }
      return hasPredicant(v);
    });
  }

  function lazyRecoveryEvent(step, item=null, detail='') {
    const code = clean(item?.code || lazy.recoveryItem || '');
    lazy.recoveryStep = clean(step);
    lazy.recoveryItem = code;
    issSideSend('ISS_CONSOLE_RECOVERY', {
      recovery:{
        step:lazy.recoveryStep,
        code,
        destination:clean(lazy.dest),
        detail:clean(detail)
      }
    });
  }

  function clearLazyRecovery() {
    lazy.recoveryStep = '';
    lazy.recoveryItem = '';
  }

  async function waitWhilePaused(run=lazy.activeRun) {
    while (currentLazyRun(run) && lazy.running && lazy.paused && !lazy.predicant) await sleep(80);
    return currentLazyRun(run) && lazy.running;
  }

  async function waitPredicant(item, run) {
    lazy.predicant = true;
    lazy.paused = true;
    shared.owner = 'lazy';
    lazy.error = `WAITING FOR YOU — RESCAN DESTINATION ${lazy.dest} TO CONTINUE`;
    lazy.note = `${item.code} paused — no more moves will run until destination is rescanned`;
    lazyRecoveryEvent('PREDICANT_DETECTED', item);
    renderLazy();

    if (!ISS_CONSOLE_WORKER && !lazy.inputCollapsed) lItems.focus();
    lPredicantCard?.scrollIntoView?.({block:'nearest', inline:'nearest'});

    while (currentLazyRun(run) && lazy.running) {
      await new Promise(resolve => { lazy.predicantResolve = resolve; });
      lazy.predicantResolve = null;

      if (!currentLazyRun(run) || !lazy.running) return false;

      lazy.predicant = true;
      lazy.paused = true;
      shared.owner = 'lazy-recovery';
      lazy.error = '';
      lazy.note = `Destination confirmed — emptying ${lazy.dest}`;
      lazyRecoveryEvent('DEST_RESCAN_ACCEPTED', item);
      renderLazy();

      try {
        lazyRecoveryEvent('DEST_EMPTY_START', item);
        await closeContainerDirect(lazy.dest, true);

        if (!currentLazyRun(run) || !lazy.running) return false;

        lazyRecoveryEvent('DEST_EMPTY_OK', item);
        lazy.predicant = false;
        lazy.paused = false;
        lazy.error = '';
        lazy.note = `Destination emptied — retrying ${item.code} ×${itemQty(item)}`;
        shared.owner = 'lazy';
        renderLazy();
        return true;
      } catch (error) {
        if (error?.outcomeUnknown) {
          lazyRecoveryEvent('DEST_EMPTY_UNKNOWN', item, error?.message || error);
          cancelLazyRun();
          lazy.running = false;
          lazy.predicant = false;
          lazy.paused = false;
          lazy.error = `Predicant recovery stopped — ${error?.message || error}`;
          lazy.note = 'VERIFY DESTINATION STATE MANUALLY — no automatic retry was sent';
          shared.owner = '';
          setLazyRunningIndicator(false);
          renderLazy();
          return false;
        }

        if (runWasCancelled(error, run)) return false;

        lazyRecoveryEvent('DEST_EMPTY_FAILED', item, error?.message || error);
        lazy.predicant = true;
        lazy.paused = true;
        lazy.error = `Predicant recovery stopped: ${error?.message || error}`;
        lazy.note = 'Rescan destination to retry emptying — item has NOT been retried';
        shared.owner = 'lazy';
        renderLazy();
        // Stay in this recovery owner and wait for another deliberate destination scan.
      }
    }

    return false;
  }

  function randomLazyMoveDelayMs() {
    return LAZY_DELAY_MIN_MS + Math.floor(Math.random() * (LAZY_DELAY_MAX_MS - LAZY_DELAY_MIN_MS + 1));
  }

  async function waitLazyMovePacing(run=lazy.activeRun) {
    while (lazy.delayEnabled && lazy.nextMoveAt > Date.now()) {
      if (!currentLazyRun(run) || !lazy.running) return false;
      if (lazy.paused || lazy.predicant || lazy.damagePaused) {
        if (!await waitWhilePaused(run)) return false;
      }
      const left = lazy.nextMoveAt - Date.now();
      lazy.note = `artificial pacing ${Math.max(1, Math.ceil(left / 1000))}s`;
      renderLazy();
      await sleep(Math.min(150, Math.max(20, left)));
    }
    return currentLazyRun(run) && lazy.running;
  }

  function haltUnknownMove(item, ctx, reason, run=lazy.activeRun) {
    const detail = clean(reason || 'confirmation lost');
    item.status = 'UNKNOWN';
    item.failReason = `MOVE OUTCOME UNKNOWN: ${detail}`;
    lazy.errors++;
    lazy.error = `${ctx.barcode} — MOVE OUTCOME UNKNOWN — VERIFY RESULT BEFORE RETRY`;
    lazy.note = 'RUN HALTED — backend result must be verified';
    lazy.running = false;
    lazy.paused = false;
    shared.owner = '';
    setLazyRunningIndicator(false);
    finishLazyRun(run);
    preflightState.dateCache.clear();
    finishMoveCorner('lazy', false);
    renderLazy();
    return false;
  }

  async function moveResolved(item, ctx, expirationMs=null, run=lazy.activeRun) {
    if (lazyItemShouldSkip(item)) {
      markLazyItemSkipped(item);
      return false;
    }

    const totalQty = itemQty(item);

    item.status = 'MOVING';
    lazy.note = `${ctx.asin || ctx.barcode} / ${ctx.fnsku || ctx.barcode} | QTY ${totalQty}`;
    renderLazy();

    const payload = buildMovePayload(lazy.src, lazy.dest, lazy.sourceMeta, ctx, totalQty, expirationMs);
    let predicantRetry = false;

    while (lazy.running && currentLazyRun(run)) {
      if (lazyItemShouldSkip(item)) {
        markLazyItemSkipped(item);
        return false;
      }

      let response;

      try {
        if (!await waitLazyMovePacing(run)) return false;
        // Every known-safe retry gets a new request id. Never reuse the rejected
        // Predicant attempt's id, which can be deduped/replayed by the backend.
        payload.requestId = requestId();
        response = await api(API_MOVE_ITEMS, payload, run);
      } catch (error) {
        if (error?.submitted && error?.responseReceived !== true) {
          return haltUnknownMove(item, ctx, error?.message || error, run);
        }
        if (runWasCancelled(error, run)) {
          if (error?.submitted) return haltUnknownMove(item, ctx, 'run stopped after submission', run);
          return false;
        }
        if (isAllowedOverageResponse(error?.payload)) {
          response = error.payload;
        } else {
          item.status = 'FAILED';
          item.failReason = `MOVE API ERROR: ${error?.message || error}`;
          lazy.errors++;
          lazy.error = `${ctx.barcode} — ${item.failReason} — NOT MOVED`;
          renderLazy();
          return false;
        }
      }

      if (!response || typeof response !== 'object') {
        return haltUnknownMove(item, ctx, 'unexpected move confirmation', run);
      }

      if (hasPredicant(response) && !moveOk(response)) {
        const recovered = await waitPredicant(item, run);
        if (!recovered || !lazy.running || !currentLazyRun(run)) return false;

        predicantRetry = true;
        lazyRecoveryEvent('MOVE_RETRY', item);
        // Retry this exact item only after close-container returned confirmed success.
        continue;
      }

      if (isDamagedDestinationResponse(response)) {
        pauseForDamagedDestination(item, ctx, response);

        if (!await waitWhilePaused(run)) return false;

        payload.destinationContainerScannableId = lazy.dest;
        item.status = 'MOVING';
        item.failReason = '';
        lazy.note = `retrying ${ctx.barcode} ×${totalQty} → ${lazy.dest}`;
        renderLazy();
        continue;
      }

      if (!moveOk(response)) {
        item.status = 'FAILED';
        item.failReason = moveReason(response) || 'MOVE REJECTED';
        lazy.errors++;
        lazy.error = `${ctx.barcode} — ${item.failReason} — NOT MOVED`;
        renderLazy();
        return false;
      }

      item.status = 'MOVED';
      traceSideline('MOVE_RESULT',{source:lazy.src,destination:lazy.dest,barcode:item.code,qty:totalQty,outcome:'confirmed'});
      if (predicantRetry) {
        lazyRecoveryEvent('MOVE_OK', item);
        clearLazyRecovery();
        predicantRetry = false;
      }
      lazy.nextMoveAt = lazy.delayEnabled ? Date.now() + randomLazyMoveDelayMs() : 0;
      lazy.error = '';
      renderLazy();
      return true;
    }

    return false;
  }

  async function prepareItemFromPreflight(item,run=lazy.activeRun) {
    if (lazyItemShouldSkip(item)) {
      markLazyItemSkipped(item);
      return {kind:'skipped'};
    }

    let result = cachedPreflightResult(item.code);

    // Single safety fallback only; this is not another worker pool.
    if (!result) {
      result = await getPreflightResult(lazy.src,item.code);
      if (!result) {
        item.status = 'FAILED';
        item.failReason = 'PREFLIGHT LOOKUP FAILED';
        lazy.errors++;
        lazy.error = `${item.code} — PREFLIGHT LOOKUP FAILED — NOT MOVED`;
        renderLazy();
        return {kind:'failed'};
      }
    }

    if (!currentLazyRun(run)) return {kind:'aborted'};
    item.ctx = result.ctx || null;

    if (result.kind === 'red') {
      item.status = result?.ctx?.invalid ? 'INVALID' : 'FAILED';
      item.failReason = result.reason || 'PREFLIGHT REJECTED';
      lazy.errors++;
      lazy.error = `${item.code} — ${item.failReason} — NOT MOVED`;
      renderLazy();
      return {kind:'failed'};
    }

    if (result.kind === 'yellow') {
      const chosen = preflightState.dateCache.get(itemKey(item.code));
      if (!chosen) {
        item.status = 'DATE';
        renderLazy();
        return {kind:'date',ctx:item.ctx};
      }
      item.status = 'READY';
      renderLazy();
      return {kind:'ready-date',ctx:item.ctx,chosen};
    }

    item.status = 'READY';
    renderLazy();
    return {kind:'ready',ctx:item.ctx};
  }

  function parkDeferredDate(item, ctx) {
    lazy.deferred.push(item);
    renderLazy();
  }

  // Dates
  const MONTHS = [['JAN',1],['FEB',2],['MAR',3],['APR',4],['MAY',5],['JUN',6],['JUL',7],['AUG',8],['SEP',9],['OCT',10],['NOV',11],['DEC',12]];

  function maxDay(month) {
    if (month === 2) return 29;
    return [4,6,9,11].includes(month) ? 30 : 31;
  }

  function validDate(month,day,year) {
    const d = new Date(year,month-1,day,0,0,0,0);
    return d.getFullYear() === year && d.getMonth() === month-1 && d.getDate() === day ? d.getTime() : 0;
  }

  function futureOrToday(ms) {
    const t = new Date();
    t.setHours(0,0,0,0);
    return ms >= t.getTime();
  }

  function pastOrToday(ms) {
    const t = new Date();
    t.setHours(23,59,59,999);
    return ms <= t.getTime();
  }

  function paoDateMs() {
    const d = new Date();
    d.setHours(0,0,0,0);
    d.setDate(d.getDate()+900);
    return d.getTime();
  }

  function dateLabel(ms) {
    const d = new Date(ms);
    return `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}/${d.getFullYear()}`;
  }

  function normalizeImageUrl(raw) {
    const url = clean(raw);
    if (!url) return '';
    return url
      .replace(/^http:\/\/ecx\.images-amazon\.com\/images\/I\//i, 'https://m.media-amazon.com/images/I/')
      .replace(/^http:\/\//i, 'https://');
  }

  function productImageUrl(ctx) {
    return normalizeImageUrl(ctx?.sku?.imageUrls?.[0]);
  }

  function expiryPickerHostDocument() {
    if (!ISS_LOCAL_FCR_WORKER) return document;
    try {
      const parentDoc = window.parent?.document;
      if (window.parent !== window && parentDoc?.body) return parentDoc;
    } catch {}
    return document;
  }

  function ensureExpiryPickerHostStyle(hostDoc) {
    if (!hostDoc || hostDoc === document || hostDoc.getElementById('sh-worker-expiry-style')) return;
    const hostStyle = hostDoc.createElement('style');
    hostStyle.id = 'sh-worker-expiry-style';
    hostStyle.textContent = style.textContent;
    (hostDoc.head || hostDoc.documentElement).appendChild(hostStyle);
  }

  // The Drive worker cannot display controls inside its hidden iframe.
  // The Console owns presentation; this worker owns validation and move eligibility.
  let issDriveDatePending = null;
  let issDriveDateSeq = 0;

  function askIssDriveDate(item) {
    const generation = preflightLookup.generation;
    const run = lazy.activeRun;
    const requestId = `${generation}:${++issDriveDateSeq}`;
    lazy.dateResolve?.(null);
    return new Promise(resolve => {
      let settled = false;
      const settle = answer => {
        if (settled) return;
        settled = true;
        if (lazy.dateResolve === settle) lazy.dateResolve = null;
        if (issDriveDatePending?.requestId === requestId) issDriveDatePending = null;
        const current = generation === preflightLookup.generation &&
          (run ? currentLazyRun(run) : currentPreflightContext(generation));
        issSideSend('ISS_CONSOLE_DATE_CLOSED',{requestId});
        resolve(current ? answer : null);
      };
      issDriveDatePending = {requestId,code:item.code,settle,generation};
      lazy.dateResolve = settle;
      issSideSend('ISS_CONSOLE_DATE_REQUEST',{
        requestId,code:item.code,asin:item.ctx?.asin || '',fnsku:item.ctx?.fnsku || '',
        dateType:item.ctx?.dateType || '',source:lazy.src,revision:issSideRunRevision
      });
    });
  }

  function showApiDatePicker(item) {
    if (ISS_LOCAL_FCR_WORKER) return askIssDriveDate(item);
    const owner = lazy;
    const generation = preflightLookup.generation;
    const run = lazy.activeRun;
    const current = () => generation === preflightLookup.generation &&
      (run ? currentLazyRun(run) : currentPreflightContext(generation));
    owner.dateResolve?.(null);
    return new Promise(resolve => {
      const ctx = item.ctx;
      const production = ctx.dateType === 'PRODUCTION_DATE';
      const selection = { month:null, day:1, year:null };
      const hostDoc = expiryPickerHostDocument();
      ensureExpiryPickerHostStyle(hostDoc);
      hostDoc.getElementById('sh-og-expiry')?.remove();
      const root = hostDoc.createElement('div');
      root.id = 'sh-og-expiry';
      root.dataset.owner = 'lazy';
      root.innerHTML = '<div class="og-wrap"></div>';
      hostDoc.body.appendChild(root);
      const wrap = $('.og-wrap',root);

      let settled = false;
      const settle = value => {
        if (settled) return;
        settled = true;
        if (owner.dateResolve === settle) owner.dateResolve = null;
        root.remove();
        resolve(current() ? value : null);
      };
      owner.dateResolve = settle;

      if (owner === lazy) setMoveCorner('lazy', 'waiting');

      function makePanel(name,strong,cls,buttons) {
        return `<section class="og-panel"><div class="og-head"><span>${name}</span><strong>${strong || '—'}</strong></div><div class="og-grid ${cls}">${buttons}</div></section>`;
      }

      function renderPicker() {
        const currentYear = new Date().getFullYear();
        const years = production
          ? Array.from({length:16},(_,i)=>currentYear-i)
          : Array.from({length:16},(_,i)=>currentYear+i);
        const monthName = MONTHS.find(([,v])=>v===selection.month)?.[0] || '—';
        const monthButtons = MONTHS.map(([label,v])=>`<button data-a="month" data-v="${v}" class="${selection.month===v?'selected':''}">${label}</button>`).join('');
        const dayButtons = Array.from({length:31},(_,i)=>i+1).map(v=>`<button data-a="day" data-v="${v}" class="${selection.day===v?'selected':''}" ${!selection.month||v>maxDay(selection.month)?'disabled':''}>${v}</button>`).join('');
        const yearButtons = years.map(v=>{
          const ms = validDate(selection.month,selection.day,v);
          const disabled = !selection.month || !selection.day || !ms ||
            (production ? !pastOrToday(ms) : !futureOrToday(ms));
          return `<button data-a="year" data-v="${v}" class="${selection.year===v?'selected':''}" ${disabled?'disabled':''}>${v}</button>`;
        }).join('');

        const itemTitle = clean(ctx?.sku?.title || ctx?.sku?.normalizedTitle || '');
        const imageUrl = productImageUrl(ctx);
        wrap.innerHTML =
          `<div class="og-id"><div>${esc(ctx.asin || '?')} / ${esc(ctx.fnsku || ctx.barcode)}</div><div>REQUIRES ${production?'PRODUCTION':'EXPIRATION'} DATE</div></div>` +
          `<div class="og-item-preview">` +
            (imageUrl
              ? `<img class="og-item-img" src="${esc(imageUrl)}" alt="">`
              : `<div class="og-item-img"></div>`) +
            `<div>` +
              `<div class="og-item-title">${esc(itemTitle || 'Item title unavailable')}</div>` +
              `<div class="og-item-meta">` +
                `<div class="og-meta-row"><span class="og-meta-label">ASIN</span><span>${esc(ctx.asin || '—')}</span></div>` +
                `<div class="og-meta-row"><span class="og-meta-label">FNSKU</span><span>${esc(ctx.fnsku || '—')}</span></div>` +
                `<div class="og-meta-row"><span class="og-meta-label">SCAN</span><span class="og-scan-code">${esc(item.code || ctx.barcode || '—')}</span></div>` +
              `</div>` +
            `</div>` +
          `</div>` +
          `<div class="og-grid-wrap">` +
            makePanel('MONTH',monthName,'og-month',monthButtons) +
            makePanel('DAY',selection.day ? String(selection.day).padStart(2,'0') : '—','og-day',dayButtons) +
            makePanel('YEAR',selection.year || '—','og-year',yearButtons) +
          `</div>` +
          `<div class="og-footer">${
            production
              ? `<button class="production-confirm" data-a="apply" ${selection.month&&selection.day&&selection.year?'':'disabled'}>USE PRODUCTION DATE</button>`
              : `<button data-a="pao">PAO +900 DAYS &nbsp; ${dateLabel(paoDateMs())}</button>`
          }${hostDoc === document ? `<button type="button" class="og-return-source" data-return-source>↩ RETURN TO SOURCE</button>` : ''}</div>`;
      }

      root.addEventListener('click',e=>{
        if (settled || owner.dateResolve !== settle || !current()) return;
        const b=e.target.closest('button[data-a]');
        if(!b||b.disabled)return;
        const a=b.dataset.a,v=Number(b.dataset.v);

        if(a==='month'){selection.month=v;selection.day=1;selection.year=null;renderPicker();return;}
        if(a==='day'){selection.day=v;selection.year=null;renderPicker();return;}
        if(a==='year'){
          selection.year=v;
          if(!production){
            const entered=validDate(selection.month,selection.day,selection.year);
            if(!entered||!futureOrToday(entered))return;
            settle({enteredMs:entered,finalExpirationMs:entered});
            return;
          }
          renderPicker();
          return;
        }
        if(a==='apply'){
          const entered=validDate(selection.month,selection.day,selection.year);
          if(!entered || !pastOrToday(entered))return;
          const finalExpirationMs=entered+Number(ctx.dateDetail?.shelfLife||0);
          settle({enteredMs:entered,finalExpirationMs});
          return;
        }
        if(a==='pao'){
          const entered=paoDateMs();
          settle({enteredMs:entered,finalExpirationMs:entered});
        }
      });

      renderPicker();
    });
  }

  function nativeExpiryInputs() {
    const inputs = appElements('input,textarea').filter(el => {
      if (!enabled(el)) return false;
      const type = norm(el.type || 'text');
      return !type || ['text','tel','number','search'].includes(type);
    });

    const hint = el => norm(
      `${el.name || ''} ${el.id || ''} ${el.placeholder || ''} ${el.getAttribute('aria-label') || ''}`
    );

    const month = inputs.find(el => /\b(mm|month)\b/.test(hint(el)));
    const day = inputs.find(el => /\b(dd|day)\b/.test(hint(el)));
    const year = inputs.find(el => /\b(yyyy|year)\b/.test(hint(el)));

    if (month && day && year) return { month, day, year };

    if (inputs.length >= 3) return { month:inputs[0], day:inputs[1], year:inputs[2] };
    return null;
  }

  function nativeExpiryProductInfo() {
    const ignored = /^(menu|change container|back to source|source container|item issue|expiry date missing|production date missing|confirm|enter expiry|enter expiration|enter production)/i;

    const textCandidates = appElements('a,h1,h2,h3,h4,strong')
      .filter(visible)
      .map(el => clean(el.innerText || el.textContent))
      .filter(v => v.length >= 18 && !ignored.test(v))
      .sort((a,b) => b.length - a.length);

    const title = textCandidates[0] || '';

    const imageUrls = [];
    const seen = new Set();

    const pushImage = raw => {
      const url = normalizeImageUrl(raw);
      if (!url || seen.has(url)) return;
      seen.add(url);
      imageUrls.push(url);
    };

    const images = appElements('img')
      .map(img => ({ img, rect:img.getBoundingClientRect() }))
      .filter(x => visible(x.img) || x.rect.width >= 25 || x.rect.height >= 25)
      .sort((a,b) => (b.rect.width*b.rect.height) - (a.rect.width*a.rect.height));

    for (const {img} of images) {
      pushImage(img.currentSrc);
      pushImage(img.src);
      pushImage(img.getAttribute('src'));
      pushImage(img.getAttribute('data-src'));
      pushImage(img.getAttribute('data-original'));

      const srcset = clean(img.getAttribute('srcset'));
      if (srcset) {
        for (const candidate of srcset.split(',')) {
          pushImage(candidate.trim().split(/\s+/)[0]);
        }
      }
    }

    const pageText = nativePageText();
    let asin = (pageText.match(/\basin\s*:?\s*([a-z0-9]{10})\b/i) || [])[1]?.toUpperCase() || '';
    let fnsku = (pageText.match(/\bfnsku\s*:?\s*([a-z0-9]{10})\b/i) || [])[1]?.toUpperCase() || '';
    let barcode = (pageText.match(/\b(?:barcode|scan(?:ned)?)\s*:?\s*([a-z0-9_-]{8,24})\b/i) || [])[1]?.toUpperCase() || '';

    if (!asin) {
      for (const link of appElements('a[href]')) {
        const href = clean(link.getAttribute('href'));
        const match = href.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?#]|$)/i);
        if (match) {
          asin = match[1].toUpperCase();
          break;
        }
      }
    }

    return {
      title,
      imageUrls,
      imageUrl:imageUrls[0] || '',
      asin,
      fnsku,
      barcode
    };
  }

  function mergeNativeExpiryProductInfo(oldInfo, freshInfo) {
    const imageUrls = [...new Set([
      ...(oldInfo?.imageUrls || []),
      ...(freshInfo?.imageUrls || [])
    ].filter(Boolean))];

    return {
      title:freshInfo?.title || oldInfo?.title || '',
      asin:freshInfo?.asin || oldInfo?.asin || '',
      fnsku:freshInfo?.fnsku || oldInfo?.fnsku || '',
      barcode:freshInfo?.barcode || oldInfo?.barcode || '',
      imageUrls,
      imageUrl:imageUrls[0] || ''
    };
  }

  function nativeExpiryDateParts(ms) {
    const d = new Date(ms);
    return {
      mm:String(d.getMonth()+1).padStart(2,'0'),
      dd:String(d.getDate()).padStart(2,'0'),
      yyyy:String(d.getFullYear())
    };
  }

  async function submitNativeExpiryDate(ms) {
    if (shared.expiryBusy) return false;
    const token = ++expiryRequestSeq;
    shared.expiryBusy = true;

    try {
      const inputs = await waitFor(() => token === expiryRequestSeq && screen() === 'EXPIRY' && nativeExpiryInputs(), 4500, 40);
      if (!inputs || token !== expiryRequestSeq) return false;

      const parts = nativeExpiryDateParts(ms);

      for (const [input,value] of [
        [inputs.month,parts.mm],
        [inputs.day,parts.dd],
        [inputs.year,parts.yyyy]
      ]) {
        if (token !== expiryRequestSeq) return false;
        input.focus();
        input.select?.();
        setValue(input,'');
        await sleep(18);
        if (token !== expiryRequestSeq) return false;
        setValue(input,value);
        input.dispatchEvent(new Event('blur',{bubbles:true}));
        await sleep(28);
      }

      await sleep(60);
      if (token !== expiryRequestSeq) return false;

      const confirm = confirmButton();
      if (enabled(confirm)) click(confirm);
      else enter(inputs.year);

      return true;
    } finally {
      if (token === expiryRequestSeq) setTimeout(() => { shared.expiryBusy = false; }, 250);
    }
  }

  function showNativeExpiryPicker() {
    if (Date.now() < nativeExpirySuppressedUntil || lazy.running || shared.expiryBusy || $('#sh-og-expiry') || screen() !== 'EXPIRY') return;

    const selection = { month:null, day:1, year:null };
    let info = nativeExpiryProductInfo();

    const root = document.createElement('div');
    root.id = 'sh-og-expiry';
    root.dataset.mode = 'native';
    root.innerHTML = '<div class="og-wrap"></div>';
    document.body.appendChild(root);
    const wrap = $('.og-wrap',root);

    const makePanel = (name,strong,cls,buttons) =>
      `<section class="og-panel"><div class="og-head"><span>${name}</span><strong>${strong || '—'}</strong></div><div class="og-grid ${cls}">${buttons}</div></section>`;

    function renderPicker() {
      const currentYear = new Date().getFullYear();
      const years = Array.from({length:16},(_,i)=>currentYear+i);
      const monthName = MONTHS.find(([,v])=>v===selection.month)?.[0] || '—';

      const monthButtons = MONTHS.map(([label,v]) =>
        `<button data-a="month" data-v="${v}" class="${selection.month===v?'selected':''}">${label}</button>`
      ).join('');

      const dayButtons = Array.from({length:31},(_,i)=>i+1).map(v =>
        `<button data-a="day" data-v="${v}" class="${selection.day===v?'selected':''}" ${!selection.month||v>maxDay(selection.month)?'disabled':''}>${v}</button>`
      ).join('');

      const yearButtons = years.map(v => {
        const ms = validDate(selection.month,selection.day,v);
        const disabled = !selection.month || !selection.day || !ms || !futureOrToday(ms);
        return `<button data-a="year" data-v="${v}" class="${selection.year===v?'selected':''}" ${disabled?'disabled':''}>${v}</button>`;
      }).join('');

      const meta =
        `<div class="og-meta-row"><span class="og-meta-label">ASIN</span><span>${esc(info.asin || '—')}</span></div>` +
        `<div class="og-meta-row"><span class="og-meta-label">FNSKU</span><span>${esc(info.fnsku || '—')}</span></div>` +
        (info.barcode
          ? `<div class="og-meta-row"><span class="og-meta-label">SCAN</span><span class="og-scan-code">${esc(info.barcode)}</span></div>`
          : `<div class="og-meta-row"><span class="og-meta-label">SCAN</span><span>Not exposed by native Sideline</span></div>`);

      wrap.innerHTML =
        `<div class="og-id"><div>REQUIRES EXPIRATION DATE</div></div>` +
        `<div class="og-item-preview">` +
          `<img class="og-item-img" data-role="native-product-image" ${info.imageUrl ? `src="${esc(info.imageUrl)}"` : ''} alt="" style="${info.imageUrl ? '' : 'visibility:hidden'}">` +
          `<div>` +
            `<div class="og-item-title">${esc(info.title || 'Loading item details…')}</div>` +
            `<div class="og-item-meta">${meta}</div>` +
          `</div>` +
        `</div>` +
        `<div class="og-grid-wrap">` +
          makePanel('MONTH',monthName,'og-month',monthButtons) +
          makePanel('DAY',selection.day ? String(selection.day).padStart(2,'0') : '—','og-day',dayButtons) +
          makePanel('YEAR',selection.year || '—','og-year',yearButtons) +
        `</div>` +
        `<div class="og-footer og-footer-single"><button data-a="pao">PAO +900 DAYS &nbsp; ${dateLabel(paoDateMs())}</button></div>`;

      const image = $('[data-role="native-product-image"]', root);
      if (image) {
        let imageIndex = Math.max(0, info.imageUrls.indexOf(image.getAttribute('src')));

        image.addEventListener('load', () => {
          image.style.visibility = 'visible';
        }, { once:true });

        image.addEventListener('error', () => {
          imageIndex++;
          if (imageIndex < info.imageUrls.length) {
            image.src = info.imageUrls[imageIndex];
          } else {
            image.style.visibility = 'hidden';
          }
        });
      }
    }

    root.addEventListener('click', async e => {
      const b = e.target.closest('button[data-a]');
      if (!b || b.disabled) return;

      e.preventDefault();
      e.stopPropagation();

      const a = b.dataset.a;
      const v = Number(b.dataset.v);

      if (a === 'month') {
        selection.month = v;
        selection.day = 1;
        selection.year = null;
        renderPicker();
        return;
      }

      if (a === 'day') {
        selection.day = v;
        selection.year = null;
        renderPicker();
        return;
      }

      if (a === 'year') {
        selection.year = v;
        const entered = validDate(selection.month,selection.day,selection.year);
        if (!entered || !futureOrToday(entered)) return;

        root.remove();
        await submitNativeExpiryDate(entered);
        return;
      }

      if (a === 'pao') {
        const entered = paoDateMs();
        root.remove();
        await submitNativeExpiryDate(entered);
      }
    }, true);

    renderPicker();

    for (const delay of [150, 400, 900, 1800, 3200]) {
      setTimeout(() => {
        if (!root.isConnected || screen() !== 'EXPIRY') return;

        const fresh = nativeExpiryProductInfo();
        const merged = mergeNativeExpiryProductInfo(info, fresh);

        const changed =
          merged.title !== info.title ||
          merged.asin !== info.asin ||
          merged.fnsku !== info.fnsku ||
          merged.barcode !== info.barcode ||
          merged.imageUrls.join('|') !== info.imageUrls.join('|');

        if (changed) {
          info = merged;
          renderPicker();
        }
      }, delay);
    }
  }

  function nativeExpiryTick() {
    if (Date.now() < nativeExpirySuppressedUntil || lazy.running) return;

    const root = $('#sh-og-expiry');
    const nativeRoot = root?.dataset?.mode === 'native';

    if (screen() === 'EXPIRY') {
      if (!root) showNativeExpiryPicker();
      return;
    }

    if (nativeRoot) root.remove();
  }

  async function safeClearSourceWhenDone() {
    if (!lClear.checked) return true;

    const previousOwner = shared.owner;
    shared.owner = 'lazy-clear';
    lazy.note = `clearing source ${lazy.src} by API`;
    lazy.error = '';
    renderLazy();

    try {
      await closeContainerDirect(lazy.src, true);
      return true;
    } catch (error) {
      lazy.error = error?.outcomeUnknown
        ? `Moves complete — source clear UNKNOWN: ${error?.message || error}`
        : `Moves complete — source clear failed: ${error?.message || error}`;
      return false;
    } finally {
      shared.owner = previousOwner;
    }
  }

  async function startLazy() {
    if (lazy.running || lazy.preflightStart) return;

    lazy.src = clean(lSrc.value);
    lazy.dest = clean(lDest.value);
    lazy.items = parseItems(lItems.value);
    lazy.index = 0;
    lazy.deferred = [];
    lazy.errors = 0;
    lazy.error = '';
    lazy.note = '';
    lazy.predicant = false;
    lazy.damagePaused = false;
    lazy.damagedDest = '';
    stopDamageAttention();
    if (lPause) lPause.textContent = 'Pause';

    if (!validContainer(lazy.src) || !validContainer(lazy.dest)) {
      lazy.error = 'SRC and DEST must start with csX or tsX.';
      renderLazy();
      return;
    }
    if (norm(lazy.src) === norm(lazy.dest)) {
      lazy.error = 'SRC and DEST cannot match.';
      renderLazy();
      return;
    }
    if (!lazy.items.length) {
      lazy.error = 'No item barcodes.';
      renderLazy();
      return;
    }

    // START is the user's explicit retry boundary; background scans retain failures.
    for (const [key,entry] of preflightLookup.entries) {
      if (entry.state === 'failed' || entry.state === 'cancelled') preflightLookup.entries.delete(key);
    }
    lazy.note = 'finishing preflight';
    renderLazy();
    syncPreflightSource();
    const start = {generation:preflightLookup.generation,dest:lazy.dest};
    lazy.preflightStart = start;
    let ready, owned;
    try {
      ready = await settlePreflightForCurrentInput();
    } finally {
      owned = lazy.preflightStart === start;
      if (owned) lazy.preflightStart = null;
    }
    if (!owned) return;
    if (!currentPreflightContext(start.generation) || norm(lDest.value) !== norm(start.dest)) return;
    if (!ready) {
      lazy.note = 'preflight incomplete — retry';
      renderLazy();
      return;
    }
    const removedRed = purgeKnownRedTextareaLines();
    lazy.items = parseItems(lItems.value);
    lazy.index = 0;

    if (!lazy.items.length) {
      lazy.error = removedRed ? 'All scanned items are ASIDE — nothing will be processed.' : 'No item barcodes.';
      lazy.note = removedRed ? `${removedRed} ASIDE unit${removedRed===1?'':'s'} excluded from RUN` : '';
      renderLazy();
      return;
    }

    if (removedRed) {
      lazy.note = `${removedRed} ASIDE unit${removedRed===1?'':'s'} excluded — processing valid items only`;
      renderLazy();
    }

    // Ensure every current item is in the single Super Preflight lookup queue before movement.
    queuePreflightLookups(lazy.items);

    const run = beginLazyRun();

    lazy.running = true;
    lazy.paused = false;
    lazy.nextMoveAt = 0;
    lazy.inputCollapsed = true;
    shared.owner = 'lazy';
    setLazyRunningIndicator(true);
    lazy.note = 'validating source';
    renderLazy();

    try {
      const sourceResponse = await api(API_SCAN_SOURCE, scanSourcePayload(lazy.src), run);

      if (!currentLazyRun(run)) return;
      if (!sourceResponse || sourceResponse.success !== true) throw new Error('Source validation failed');

      lazy.sourceMeta = sourceResponse;
    } catch (error) {
      if (runWasCancelled(error, run)) return;

      resetPreflightLookups();
      lazy.running = false;
      shared.owner = '';
      setLazyRunningIndicator(false);
      finishLazyRun(run);
      lazy.error = `Source error: ${error?.message || error}`;
      renderLazy();
      return;
    }
    for (let index=0; index<lazy.items.length && lazy.running && currentLazyRun(run); index++) {
      if (!await waitWhilePaused(run)) break;

      lazy.index = index;
      const item = lazy.items[index];
      lazy.note = `processing ${index + 1}/${lazy.items.length} | ${item.code}`;
      renderLazy();

      const result = await prepareItemFromPreflight(item,run);
      if (!currentLazyRun(run) || !lazy.running) break;

      if (result?.kind === 'date') {
        parkDeferredDate(item,result.ctx);
        continue;
      }
      if (result?.kind === 'ready-date') {
        await moveResolved(item,result.ctx,result.chosen?.finalExpirationMs ?? null,run);
        continue;
      }
      if (result?.kind !== 'ready') continue;

      await moveResolved(item,result.ctx,null,run);
    }

    if (!currentLazyRun(run) || !lazy.running) return;

    for (let i=0; i<lazy.deferred.length && lazy.running && currentLazyRun(run); i++) {
      if (!await waitWhilePaused(run)) break;

      const item = lazy.deferred[i];
      const ctx = item.ctx;
      lazy.note = `DATE ${i+1}/${lazy.deferred.length} | ${ctx.asin || item.code}`;
      renderLazy();

      const key = itemKey(item.code);
      let chosen = preflightState.dateCache.get(key) || null;
      if (!chosen) {
        chosen = await showApiDatePicker(item);
        if (!lazy.running || !currentLazyRun(run)) return;
        if (chosen) preflightState.dateCache.set(key,chosen);
      }
      if (!chosen && item.status === 'SKIPPED' && lazy.running && currentLazyRun(run)) continue;
      if (!chosen || !lazy.running || !currentLazyRun(run)) break;

      await moveResolved(item, ctx, chosen.finalExpirationMs, run);
    }

    if (!currentLazyRun(run) || !lazy.running) return;

    lazy.running = false;
    lazy.paused = false;
    shared.owner = '';
    setLazyRunningIndicator(false);

    const skippedUnits = lazy.items
      .filter(item => item.status === 'SKIPPED')
      .reduce((sum,item) => sum + itemQty(item), 0);

    if (lazy.errors || skippedUnits) {
      const movedUnits = lazy.items
        .filter(item => item.status === 'MOVED')
        .reduce((sum,item) => sum + item.qty, 0);

      lazy.error = '';
      lazy.note = skippedUnits
        ? `complete | moved ${movedUnits} qty | skipped ${skippedUnits} removed qty | source left open`
        : `complete | moved ${movedUnits} qty to ${lazy.dest}`;
      finishLazyRun(run);
      preflightState.dateCache.clear();
      finishMoveCorner('lazy', false);
      renderLazy();
      return;
    }

    const clearOk = await safeClearSourceWhenDone();
    if (lClear.checked && !clearOk) {
      lazy.note = 'complete';
      finishLazyRun(run);
      preflightState.dateCache.clear();
      finishMoveCorner('lazy', false);
      renderLazy();
      return;
    }

    lazy.note = 'complete';
    finishLazyRun(run);
    preflightState.dateCache.clear();
    finishMoveCorner('lazy', true);
    renderLazy();

    const finalNote = lazy.note;
    const completedGeneration = preflightLookup.generation;
    setTimeout(() => {
      if (lazy.running || lazy.activeRun || preflightLookup.generation !== completedGeneration) return;
      lazy.src = '';
      lazy.dest = '';
      lazy.sourceMeta = null;
      resetPreflightLookups();
      lazy.items = [];
      lazy.deferred = [];
      lazy.index = 0;
      lazyProgressShape = '';
      lSrc.value = '';
      lDest.value = '';
      lItems.value = '';
      lSrc.classList.remove('good','bad');
      lDest.classList.remove('good','bad');
      lazy.note = finalNote;
      renderLazy();
      if (!ISS_CONSOLE_WORKER) lSrc.focus();
    }, 180);
  }

  lazyPanel.onclick = e => {
    const actionTarget = e.target.closest?.('[data-a]');
    if (!actionTarget || !lazyPanel.contains(actionTarget)) return;
    const a = actionTarget.dataset.a;
    if (!a) return;

    if (a === 'toggle-items') {
      setLazyInputCollapsed(!lazy.inputCollapsed, { focusItems: lazy.inputCollapsed });
      return;
    }

    if (a === 'start') startLazy();

    if (a === 'copy-failed') {
      const failed = lazy.items.filter(item => item.status === 'INVALID' || item.status === 'FAILED');
      const lines = [];
      for (const item of failed) {
        for (let i = 0; i < itemQty(item); i++) lines.push(item.code);
      }

      if (!lines.length) {
        lazy.note = 'no failed barcodes to copy';
        renderLazy();
        return;
      }

      const payload = lines.join('\n');

      navigator.clipboard.writeText(payload).then(() => {
        lazy.note = `copied ${lines.length} failed barcode${lines.length===1?'':'s'}`;
        renderLazy();
      }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = payload;
        ta.style.position = 'fixed';
        ta.style.left = '-99999px';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
          lazy.note = `copied ${lines.length} failed barcode${lines.length===1?'':'s'}`;
        } catch {
          lazy.error = 'Could not copy failed barcodes.';
        }
        ta.remove();
        renderLazy();
      });
      return;
    }

    if (a === 'pause') {
      if (!lazy.running || lazy.predicant) return;

      if (lazy.damagePaused && lazy.paused) {
        const nextDest = clean(lDest.value);

        if (!validContainer(nextDest) || norm(nextDest) === norm(lazy.src)) {
          lazy.error = 'DAMAGED DESTINATION PAUSE — enter a valid NEW destination before Resume.';
          lDest.classList.add('bad');
          startDamageAttention(lazy.damagedDest || lazy.dest);
          renderLazy();
          return;
        }

        if (norm(nextDest) === norm(lazy.damagedDest)) {
          lazy.error = `DESTINATION ${nextDest} is damaged — use a different destination before Resume.`;
          lDest.classList.add('bad');
          startDamageAttention(nextDest);
          renderLazy();
          return;
        }

        const skippedUnits = markLazyRemovedItemsOnResume();
        lazy.dest = nextDest;
        lazy.damagePaused = false;
        lazy.damagedDest = '';
        lazy.paused = false;
        lazy.error = '';
        lazy.note = skippedUnits
          ? `resumed with new destination ${lazy.dest} | skipped ${skippedUnits} removed qty`
          : `resumed with new destination ${lazy.dest}`;
        lDest.classList.remove('bad');
        lDest.classList.add('good');
        actionTarget.textContent = 'Pause';
        stopDamageAttention();
        setLazyRunningIndicator(true);
        renderLazy();
        return;
      }

      if (lazy.paused) {
        const skippedUnits = markLazyRemovedItemsOnResume();
        lazy.paused = false;
        actionTarget.textContent = 'Pause';
        lazy.note = skippedUnits ? `resumed | skipped ${skippedUnits} removed qty` : 'resumed';
        setLazyRunningIndicator(true);
      } else {
        lazy.paused = true;
        actionTarget.textContent = 'Resume';
        lazy.note = 'paused';
      }
      renderLazy();
    }

    if (a === 'stop') {
      cancelLazyRun();
      resetPreflightLookups();
      clearMoveCorner('lazy');
      lazy.running = false;
      lazy.paused = false;
      lazy.predicant = false;
      lazy.damagePaused = false;
      lazy.damagedDest = '';
      stopDamageAttention();
      if (lPause) lPause.textContent = 'Pause';
      lazy.predicantResolve?.();
      lazy.predicantResolve = null;
      lazy.dateResolve?.(null);
      lazy.dateResolve = null;
      $('#sh-og-expiry')?.remove();
      setLazyRunningIndicator(false);
      shared.owner = '';
      lazy.note = 'stopped';
      renderLazy();
    }

    if (a === 'clear-source') {
      lClear.checked = !lClear.checked;
      localStorage.setItem(CLEAR_SOURCE_KEY, lClear.checked ? '1' : '0');
      lazy.note = lClear.checked ? 'clear source ON' : 'clear source OFF';
      renderLazy();
      return;
    }

    if (a === 'delay') {
      lazy.delayEnabled = !lazy.delayEnabled;
      if (!lazy.delayEnabled) lazy.nextMoveAt = 0;
      localStorage.setItem(LAZY_DELAY_KEY, lazy.delayEnabled ? '1' : '0');
      lazy.note = lazy.delayEnabled ? 'artificial delay ON — 2–8s' : 'artificial delay OFF';
      renderLazy();
      return;
    }

    if (a === 'reset') resetLazy('reset');
  };

  function stopLazyForReturn(note) {
    const wasActive = !!(lazy.running || lazy.activeRun || lazy.predicant || lazy.damagePaused || lazy.dateResolve);
    const current = wasActive ? lazy.items[lazy.index] : null;
    if (current && !['MOVED','FAILED','INVALID'].includes(current.status)) {
      current.status = 'ABANDONED';
      current.failReason = 'RETURN TO SOURCE — ABANDONED';
    }

    cancelLazyRun();
    resetPreflightLookups();
    clearMoveCorner('lazy');
    lazy.running = false;
    lazy.paused = false;
    lazy.predicant = false;
    lazy.damagePaused = false;
    lazy.damagedDest = '';
    lazy.inputCollapsed = false;
    clearLazyCollapsedScanBuffer();
    stopDamageAttention();
    if (lPause) lPause.textContent = 'Pause';
    lazy.predicantResolve?.();
    lazy.predicantResolve = null;
    clearLazyRecovery();
    lazy.dateResolve?.(null);
    lazy.dateResolve = null;
    lazy.error = '';
    lazy.note = note;
    setLazyRunningIndicator(false);
    renderLazy();
  }

  async function returnNativeToSourceContainer(sourceCode) {
    screenDirty = true;

    if (sourceCode) {
      const returned = await nativeReturnToOriginalSource(sourceCode);
      if (returned) return 'original source';
    }

    if (screen() === 'SOURCE' && scanInput()) return 'source scan';

    const back = backToSourceButton();
    if (back) {
      click(back);
      const outcome = await waitFor(() => {
        screenDirty = true;
        if (sourceCode && norm(loadedSourceContainer()) === norm(sourceCode) && screen() === 'ITEM') return 'original source';
        if (screen() === 'SOURCE' && scanInput()) return 'source scan';
        return null;
      }, 10000, 50);
      if (outcome) return outcome;
    }

    const change = changeButton();
    if (change) {
      click(change);
      const no = await waitFor(() => modalButton('no'), 4000, 35);
      if (no) {
        click(no);
        if (await waitForNativeSourceScan(10000)) return 'source scan';
      }
    }

    return await waitForNativeSourceScan(1800) ? 'source scan' : '';
  }

  function returnModeFromButton(button) {
    const expiryRoot = button.closest?.('#sh-og-expiry');
    if (expiryRoot) {
      if (lazy.running || lazy.activeRun || lazy.predicant || lazy.damagePaused || lazy.dateResolve) return 'lazy';
      if (shared.owner === 'qty' || shared.owner === 'qty-clear') return 'qty';
      return 'native';
    }
    if (button.closest?.('#sh-lazy')) return 'lazy';
    if (button.closest?.('#sh-queue')) return 'queue';
    if (button.closest?.('#sh-qty')) return 'qty';
    return 'native';
  }

  function returnSourceCodeForMode(mode) {
    if (mode === 'lazy') return clean(lazy.src || loadedSourceContainer());
    return clean(loadedSourceContainer());
  }

  async function universalReturnToSource(mode='native') {
    if (returnSourceBusy) return;
    returnSourceBusy = true;

    const sourceCode = returnSourceCodeForMode(mode);
    const previousOwner = shared.owner;
    const dateOpen = !!$('#sh-og-expiry') || screen() === 'EXPIRY';

    if (dateOpen) {
      expiryRequestSeq++;
      nativeExpirySuppressedUntil = Date.now() + 5000;
    }

    if (mode === 'queue') {
      q.runSeq++;
      q.running = false;
      q.paused = false;
      renderQueue('returned to source');
    } else if (mode === 'qty') {
      qtyRequestSeq++;
      qtyClear.disabled = false;
      qtyStatus.textContent = 'Returning to source — quantity action cancelled';
    } else if (mode === 'lazy') {
      stopLazyForReturn('returned to source — current item abandoned');
    }

    $('#sh-og-expiry')?.remove();
    shared.expiryBusy = dateOpen;
    shared.owner = 'return-source';

    savePanelStates();
    applyPanels();

    try {
      const outcome = await returnNativeToSourceContainer(sourceCode);
      const message = outcome
        ? `returned to ${outcome}`
        : 'helper escaped — native source control not found';
      if (mode === 'lazy') {
        lazy.note = `${message} — queue/history preserved`;
        renderLazy();
      } else if (mode === 'queue') {
        renderQueue(message);
      } else if (mode === 'qty') {
        qtyStatus.textContent = message;
      }
    } catch (error) {
      const message = `RETURN TO SOURCE FAILED — ${error?.message || error}`;
      if (mode === 'lazy') {
        lazy.error = message;
        renderLazy();
      } else if (mode === 'queue') {
        qError.textContent = message;
      } else if (mode === 'qty') {
        qtyStatus.textContent = message;
      }
    } finally {
      if (dateOpen) shared.expiryBusy = false;
      if (shared.owner === 'return-source') {
        const ownerWasTarget =
          previousOwner === mode ||
          (mode === 'lazy' && /^lazy(?:-|$)/.test(previousOwner)) ||
          (mode === 'qty' && (previousOwner === 'qty' || previousOwner === 'qty-clear'));
        shared.owner = previousOwner && !ownerWasTarget ? previousOwner : '';
      }
      returnSourceBusy = false;
      screenDirty = true;
      requestPanelLayout();
      if (dateOpen) setTimeout(nativeExpiryTick, 5500);
    }
  }

  function handleUniversalReturnClick(event) {
    const button = event.target?.closest?.('[data-return-source]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    universalReturnToSource(returnModeFromButton(button));
  }

  // ISS Console worker bridge: REBUILD supports Queue + Lazy only.
  let issSideWorkerBusy = false;
  let issSideWorkerMode = 'lazy';
  let issSideProgressTimer = 0;
  let issSideProgressSignature = '';
  let issSideLastProgressAt = 0;
  let issSideControlSeq = 0;
  const ISS_SIDE_PROGRESS_CHECK_MS = 1500;
  const ISS_SIDE_PROGRESS_HEARTBEAT_MS = 30000;

  function issSideSend(type, detail = {}) {
    if (!ISS_CONSOLE_WORKER) return;
    try {
      issControllerWindow().postMessage({
        type,
        worker:'sideline',
        _issDrive:ISS_DRIVE_CHANNEL,
        version:VERSION,
        ...detail
      }, ISS_DRIVE_ORIGIN);
    } catch {}
  }

  function issSideLazyItems() {
    return lazy.items.map(item => ({
      code:clean(item.code),
      qty:itemQty(item),
      status:clean(item.status || ''),
      asin:clean(item.ctx?.asin || ''),
      fnsku:clean(item.ctx?.fnsku || ''),
      issue:clean(item.failReason || ''),
      dateType:clean(item.ctx?.dateType || '')
    }));
  }

  function issSideLazyMetrics(items = lazy.items) {
    const rows = Array.isArray(items) ? items : [];
    return {
      total:sumQty(rows),
      unique:rows.length,
      moved:sumQty(rows.filter(item => item.status === 'MOVED')),
      remaining:sumQty(rows.filter(item => !['MOVED','FAILED','INVALID','SKIPPED'].includes(item.status))),
      failed:sumQty(rows.filter(item => ['FAILED','INVALID','SKIPPED'].includes(item.status)))
    };
  }

  function issSideAsideEntries() {
    return [...preflightState.redEntries.values()].map(entry => ({
      code:clean(entry.code),
      reason:clean(entry.reason),
      qty:Math.max(0,Number(entry.qty)||0)
    })).filter(entry => entry.qty > 0);
  }

  let issSideDraft = null;
  let issSideRunRevision = 0;
  let issSideClearJob = null;
  const ISS_CLEAR_PENDING_KEY = 'sidelineRebuild.clear.pending.v1.';

  function issSideDraftSnapshot() {
    const rows = parseItems(lItems.value).map(item => {
      const entry = preflightLookup.entries.get(preflightLookupKey(lSrc.value,item.code));
      const result = entry?.result;
      const chosen = result?.kind === 'yellow' ? preflightState.dateCache.get(itemKey(item.code)) : null;
      const status = entry?.state === 'failed' ? 'LOOKUP_FAILED'
        : result?.kind === 'red' ? 'INVALID' : result?.kind === 'yellow' ? (chosen ? 'READY' : 'DATE')
        : result?.kind === 'green' ? 'READY' : 'CHECKING';
      return {code:item.code,qty:item.qty,status,asin:result?.ctx?.asin || '',
        fnsku:result?.ctx?.fnsku || '',dateType:result?.ctx?.dateType || '',
        issue:chosen ? 'DATE SET — ' + dateLabel(chosen.enteredMs) : (entry?.error?.message || result?.reason || '')};
    });
    const bad = rows.filter(row => ['INVALID','LOOKUP_FAILED'].includes(row.status));
    const checking = rows.filter(row => row.status === 'CHECKING');
    const dates = rows.filter(row => row.status === 'DATE');
    return {draft:true,revision:issSideDraft?.revision,mode:'lazy',running:false,
      source:clean(lSrc.value),dest:clean(lDest.value),items:rows,
      current:0,total:rows.length,pending:checking.length,
      metrics:{total:sumQty(rows),unique:rows.length,moved:0,remaining:sumQty(rows)},
      message:bad.length ? bad.map(row=>`${row.code} — ${row.issue}`).join(' • ')
        : checking.length ? `Checking ${checking.length} item${checking.length===1?'':'s'}…`
        : dates.length ? 'Date required — ENTER DATE now or RUN ready items first' : rows.length ? 'All checked items ready' : 'Ready',
      error:bad.length > 0,
      aside:rows.filter(row=>row.status==='INVALID').map(row=>({code:row.code,reason:row.issue,qty:row.qty}))};
  }

  function issSideDraftSync(payload = {}) {
    if (issSideDraft && Number(payload.revision) < Number(issSideDraft.revision)) return {ignored:true};
    if (issSideWorkerBusy || lazy.running || lazy.activeRun || lazy.preflightStart || issSideClearJob) {
      throw new Error('Sideline is processing — draft not replaced');
    }
    issSideSetMode('lazy');
    const source = clean(payload.source), dest = clean(payload.dest);
    const changed = !issSideDraft || norm(source)!==norm(issSideDraft.source) || norm(dest)!==norm(issSideDraft.dest);
    if (changed) resetLazy('New ISS preflight context');
    lSrc.value = source;
    lDest.value = dest;
    lItems.value = (Array.isArray(payload.items) ? payload.items : []).map(clean).filter(Boolean).join('\n');
    issSideDraft = {revision:payload.revision,source,dest};
    lazy.src = source;
    lazy.dest = dest;
    lazy.items = parseItems(lItems.value);
    syncPreflightSource();
    const wanted = new Set(lazy.items.map(item=>preflightLookupKey(source,item.code)));
    for (const [key,entry] of preflightLookup.entries) {
      if (!wanted.has(key)) {
        preflightLookup.entries.delete(key);
        preflightState.dateCache.delete(itemKey(entry.code));
        entry.controller?.abort();
        finishPreflightEntry(entry,null);
      }
    }
    if (validContainer(source)) {
      queuePreflightLookups(lazy.items);
      syncPreflightOccurrences(lazy.items);
    }
    issSideEmitProgress(true);
    return {revision:payload.revision};
  }

  function issSideApplyDate(payload = {}) {
    const source = clean(payload.source);
    const dest = clean(payload.dest);
    const code = clean(payload.code);
    if (issSideWorkerMode !== 'lazy' || !validContainer(source) || !validContainer(dest) ||
        norm(source) !== norm(lSrc.value) || norm(dest) !== norm(lDest.value)) {
      throw new Error('Date context changed — scan the item again');
    }
    const row = parseItems(lItems.value).find(item => itemKey(item.code) === itemKey(code));
    const entry = preflightLookup.entries.get(preflightLookupKey(source,code));
    if (!row || entry?.state !== 'done' || entry?.result?.kind !== 'yellow' || !entry.result.ctx) {
      throw new Error('Item does not have a current date requirement');
    }
    const ctx = entry.result.ctx;
    const activeRequest = issDriveDatePending;
    if (lazy.running) {
      if (!activeRequest || activeRequest.requestId !== payload.requestId ||
          itemKey(activeRequest.code) !== itemKey(code) || activeRequest.generation !== preflightLookup.generation) {
        throw new Error('Date request expired — wait for the active item');
      }
    } else if (issSideWorkerBusy || lazy.preflightStart || lazy.activeRun || !issSideDraft ||
               norm(source) !== norm(issSideDraft.source) || norm(dest) !== norm(issSideDraft.dest)) {
      throw new Error('Date cannot be saved while the workflow is changing');
    }
    let enteredMs = 0;
    if (payload.mode === 'pao') {
      if (ctx.dateType !== 'EXPIRATION_DATE') throw new Error('PAO is for expiration dates only');
      enteredMs = paoDateMs();
    } else if (payload.mode === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(String(payload.date || ''))) {
      const [year,month,day] = String(payload.date).split('-').map(Number);
      enteredMs = validDate(month,day,year);
      const todayYear = new Date().getFullYear();
      if (!enteredMs || year < todayYear-15 || year > todayYear+15 ||
          !(ctx.dateType === 'PRODUCTION_DATE' ? pastOrToday(enteredMs) : futureOrToday(enteredMs))) {
        throw new Error('Date is invalid for this item (production=past, expiration=future)');
      }
    } else {
      throw new Error('Select a date or PAO +900 days');
    }
    const chosen = {enteredMs,finalExpirationMs:ctx.dateType === 'PRODUCTION_DATE'
      ? enteredMs + Number(ctx.dateDetail?.shelfLife || 0) : enteredMs};
    preflightState.dateCache.set(itemKey(code),chosen);
    if (activeRequest && activeRequest.requestId === payload.requestId) activeRequest.settle(chosen);
    issSideEmitProgress(true);
    return {saved:true,code,date:dateLabel(enteredMs),dateType:ctx.dateType};
  }

  function issSideDeferDate(payload = {}) {
    const pending = issDriveDatePending;
    if (!lazy.running || !pending || pending.requestId !== clean(payload.requestId) ||
        itemKey(pending.code) !== itemKey(payload.code) ||
        pending.generation !== preflightLookup.generation) {
      throw new Error('Date request is no longer active');
    }
    const item = lazy.deferred.find(row => itemKey(row.code) === itemKey(pending.code));
    if (!item || item.status !== 'DATE') throw new Error('Current date item is unavailable');
    item.status = 'SKIPPED';
    item.failReason = 'DATE DEFERRED — NOT MOVED';
    lazy.note = 'Date deferred — item stays in source; processing remaining items';
    pending.settle(null);
    issSideEmitProgress(true);
    return {deferred:true,code:item.code};
  }

  async function issSideClearContainer(payload = {}) {
    const container = clean(payload.container);
    if (!validContainer(container)) throw new Error('CC requires a valid tsX/csX container');
    if (lazy.running || lazy.activeRun || lazy.preflightStart || q.running || issQueueInFlight || issSideClearJob) {
      throw new Error('A workflow is active — CC not sent');
    }
    if (!navigator.locks?.request) throw new Error('Browser tab lock unavailable — CC not sent');
    const key = ISS_CLEAR_PENDING_KEY + norm(container);
    const controlSeq = issSideControlSeq;
    const job = {container,submitted:false};
    issSideClearJob = job;
    resetPreflightLookups();
    issSideDraft = null;
    try {
      return await navigator.locks.request('bwu2-v2-sideline-clear', {ifAvailable:true}, async lock => {
        if (!lock) throw new Error('Another container clear is active — CC not sent');
        if (localStorage.getItem(key) && payload.verifiedRetry !== true) {
          const error = new Error('Previous clear outcome UNKNOWN — verify container before another clear');
          error.issData = {clearUnknown:true,container};
          throw error;
        }
        traceSideline('CLEAR_START',{container,field:payload.field,revision:payload.revision});
        await scanSourceDirect(container);
        if (controlSeq !== issSideControlSeq) throw makeAbortError('CC stopped before close — not sent');
        // A submitted close owns its result even if STOP is pressed afterward.
        localStorage.setItem(key,JSON.stringify({at:Date.now(),container}));
        job.submitted = true;
        await closeContainerDirect(container,true);
        localStorage.removeItem(key);
        traceSideline('CLEAR_RESULT',{container,confirmed:true});
        return {container,cleared:true};
      });
    } catch (error) {
      const unknown = job.submitted || !!error?.issData?.clearUnknown;
      traceSideline('CLEAR_RESULT',{container,confirmed:false,unknown,
        error:String(error?.message || error).slice(0,500)});
      error.issData = {...(error.issData || {}),container,clearUnknown:unknown};
      throw error;
    } finally {
      if (issSideClearJob === job) issSideClearJob = null;
    }
  }

  function issSideSnapshot() {
    if (issSideDraft && !issSideWorkerBusy && !lazy.running && !lazy.preflightStart && !issSideClearJob && issSideWorkerMode === 'lazy') return issSideDraftSnapshot();
    if (issSideWorkerMode === 'queue') {
      return {
        mode:'queue',
        running:!!q.running,
        message:clean(qError?.textContent || qStatus?.textContent || 'Ready'),
        current:Math.min(q.index,q.list.length),
        total:q.list.length,
        cleared:issQueueSession?.cleared || 0,
        skipped:issQueueSession?.issues?.size || 0,
        pending:issQueueSession?.awaitingApproval ? issQueueSession.retryPending.length : 0,
        queueReport:issQueueSession ? issQueueResult(issQueueSession) : null
      };
    }

    const items = issSideLazyItems();
    const predicantRecovery = !!(lazy.predicant && shared.owner === 'lazy-recovery');
    return {
      mode:'lazy',
      running:!!lazy.running,
      message:clean(lazy.error || lazy.note || 'Ready'),
      attention:predicantRecovery ? 'predicant-recovery' : (lazy.predicant ? 'rescan-destination' : ''),
      revision:issSideRunRevision,
      current:lazy.items.filter(item => ['MOVED','FAILED','INVALID','SKIPPED','UNKNOWN'].includes(item.status)).length,
      total:lazy.items.length,
      metrics:issSideLazyMetrics(lazy.items),
      aside:issSideAsideEntries(),
      items
    };
  }

  function issSideEmitProgress(force = false) {
    const snapshot = issSideSnapshot();
    const payload = {area:'sideline', message:snapshot.message, ...snapshot};
    const signature = JSON.stringify(payload);
    const now = Date.now();
    if (!force && signature === issSideProgressSignature && now - issSideLastProgressAt < ISS_SIDE_PROGRESS_HEARTBEAT_MS) return false;
    issSideProgressSignature = signature;
    issSideLastProgressAt = now;
    issSideSend('ISS_CONSOLE_PROGRESS', payload);
    return true;
  }

  function issSideStartProgress() {
    clearInterval(issSideProgressTimer);
    issSideProgressSignature = '';
    issSideLastProgressAt = 0;
    issSideProgressTimer = setInterval(issSideEmitProgress, ISS_SIDE_PROGRESS_CHECK_MS);
    issSideEmitProgress(true);
  }

  function issSideStopQueue(note='stopped') {
    q.runSeq++;
    q.running = false;
    q.paused = false;
    if (ISS_CONSOLE_WORKER && issQueueSession) {
      issQueueSession.stopped = true;
      issQueueSession.awaitingApproval = false;
      issQueueSession.retryPending = [];
    }
    if (shared.owner === 'queue' && (!ISS_CONSOLE_WORKER || !issQueueInFlight)) shared.owner = '';
    renderQueue(note);
  }

  function issSideStopLazy(note='stopped from ISS Console') {
    issSideControlSeq++;
    issSideDraft = null;
    cancelLazyRun();
    resetPreflightLookups();
    clearMoveCorner('lazy');
    lazy.running = false;
    lazy.paused = false;
    lazy.predicant = false;
    lazy.damagePaused = false;
    lazy.damagedDest = '';
    lazy.predicantResolve?.();
    lazy.predicantResolve = null;
    clearLazyRecovery();
    lazy.dateResolve?.(null);
    lazy.dateResolve = null;
    $('#sh-og-expiry')?.remove();
    setLazyRunningIndicator(false);
    if (shared.owner === 'lazy' || /^lazy-/.test(shared.owner || '')) shared.owner = '';
    lazy.note = note;
    renderLazy();
  }

  function issSideSetMode(mode) {
    const wanted = clean(mode).toLowerCase();
    if (!['queue','lazy'].includes(wanted)) {
      throw new Error(`Unsupported Sideline Rebuild mode: ${wanted || 'blank'}`);
    }
    if (issSideWorkerBusy && wanted !== issSideWorkerMode) throw new Error('Sideline worker busy');
    if (wanted !== 'queue' && q.running) issSideStopQueue('mode switched');
    if (wanted !== 'lazy' && (lazy.running || lazy.activeRun || lazy.preflightStart || lazy.dateResolve)) issSideStopLazy('mode switched');

    feature.queue = wanted === 'queue';
    feature.lazy = wanted === 'lazy';
    feature.qty = false;
    issSideWorkerMode = wanted;
    if (!ISS_CONSOLE_WORKER) applyPanels();
    issSideEmitProgress(true);
    return wanted;
  }

  async function issSideLazyRun(payload = {}) {
    for (const container of [payload.source,payload.dest]) {
      if (localStorage.getItem(ISS_CLEAR_PENDING_KEY + norm(container))) {
        const error = new Error('Previous clear outcome UNKNOWN for '+clean(container)+' — verify before START');
        error.issData = {clearUnknown:true,container:clean(container)};
        throw error;
      }
    }
    issSideSetMode('lazy');
    const source = clean(payload.source), dest = clean(payload.dest);
    const reuse = issSideDraft && payload.revision === issSideDraft.revision
      && norm(source) === norm(issSideDraft.source) && norm(dest) === norm(issSideDraft.dest);
    if (!reuse) resetLazy('ISS Console ready');
    issSideRunRevision = payload.revision || 0;
    issSideDraft = null;
    const controlSeq = issSideControlSeq;

    lSrc.value = clean(payload.source);
    lDest.value = clean(payload.dest);
    lItems.value = (Array.isArray(payload.items) ? payload.items : String(payload.items || '').split(/\r?\n/))
      .map(clean).filter(Boolean).join('\n');

    if (typeof payload.clearSource === 'boolean') {
      lClear.checked = payload.clearSource;
      localStorage.setItem(CLEAR_SOURCE_KEY, lClear.checked ? '1' : '0');
    }
    if (typeof payload.processDelay === 'boolean') {
      lazy.delayEnabled = payload.processDelay;
      localStorage.setItem(LAZY_DELAY_KEY, lazy.delayEnabled ? '1' : '0');
    }
    lazy.nextMoveAt = 0;
    // Do not re-register occurrences already checked while scanning.
    lazy.items = parseItems(lItems.value);
    if (!reuse) refreshItems();
    else renderLazy();
    issSideEmitProgress(true);

    await startLazy();

    if (controlSeq !== issSideControlSeq) {
      const error = new Error('Run cancelled');
      error.issCancelled = true;
      throw error;
    }
    if (lazy.error) {
      const error = new Error(lazy.error);
      error.issData = {
        kind:'lazy',
        metrics:issSideLazyMetrics(lazy.items),
        aside:issSideAsideEntries(),
        items:issSideLazyItems()
      };
      throw error;
    }

    const moved = lazy.items
      .filter(item => item.status === 'MOVED')
      .reduce((sum,item) => sum + itemQty(item),0);
    const failed = lazy.items
      .filter(item => ['FAILED','INVALID','SKIPPED'].includes(item.status))
      .reduce((sum,item) => sum + itemQty(item),0);
    const items = issSideLazyItems();

    return {
      moved,
      failed,
      message:clean(lazy.note || 'complete'),
      metrics:issSideLazyMetrics(lazy.items),
      aside:issSideAsideEntries(),
      items,
      failures:items.filter(item => ['FAILED','INVALID','SKIPPED'].includes(item.status))
    };
  }

  function issSideLazyScan(payload = {}) {
    const code = clean(payload.code || payload.item || '');
    if (!code) throw new Error('Scan required');

    const sameDest = norm(code) === norm(lazy.dest);
    const waitingForRecoveryScan = !!(lazy.predicant && sameDest && lazy.predicantResolve);
    const recoveryAlreadyRunning = !!(lazy.predicant && sameDest && !lazy.predicantResolve);
    const accepted = acceptCollapsedLazyScan(code);
    if (!accepted) throw new Error('Lazy scan not accepted in current state');

    // ISS is transport only. waitPredicant() exclusively owns recovery state.
    issSideEmitProgress(true);
    return {
      accepted:true,
      code,
      recovery:waitingForRecoveryScan,
      recoveryAlreadyRunning
    };
  }


  // ISS Console's API queue is deliberately separate from the standalone UI queue.
  // Both use the same source/close API functions; standalone behaviour stays unchanged.
  let issQueueSession = null;
  let issQueueInFlight = 0;

  function issQueueActive(session) {
    return issQueueSession === session && q.runSeq === session.seq && q.running;
  }

  function issQueueResult(session) {
    const failed = [...session.issues.values()];
    return {
      done:session.done,
      total:session.list.length,
      cleared:session.cleared,
      skipped:failed.length,
      verify:failed.filter(item => item.kind === 'verify').length,
      failed,
      awaitingApproval:session.awaitingApproval,
      retryPending:session.awaitingApproval ? session.retryPending.length : 0,
      timedOut:!!session.timedOut,
      stopped:!!session.stopped,
      running:issQueueActive(session),
      inFlight:session.inFlight || 0
    };
  }

  function issQueueCancelled(session) {
    session.stopped = true;
    session.awaitingApproval = false;
    session.retryPending = [];
    for (const code of session.list) {
      if (!session.completed.has(code) && !session.issues.has(code)) session.issues.set(code, {
        code, kind:'not-attempted', reason:'Queue stopped — NOT ATTEMPTED', attempt:0
      });
    }
    const error = new Error('Run cancelled');
    error.issCancelled = true;
    error.issData = issQueueResult(session);
    return error;
  }

  async function issQueueProcess(session, code, attempt) {
    let stage = 'scan';
    issQueueInFlight++;
    session.inFlight++;
    try {
      await scanSourceDirect(code);
      if (!issQueueActive(session)) {
        session.issues.set(code, {code, kind:'not-attempted', reason:'Stopped before close — NOT ATTEMPTED', attempt});
        return;
      }
      stage = 'close';
      session.issues.set(code, {code, kind:'verify', reason:'Close submitted — confirmation pending', attempt});
      issSideEmitProgress(true);
      await closeContainerDirect(code, true);
      // STOP cancels scheduling, not the outcome of an already submitted close.
      session.cleared++;
      session.issues.delete(code);
    } catch (error) {
      const customerShipment = error?.customerBound ||
        /customer[\s-]*(?:bound[\s-]*)?shipment/i.test(clean(error?.message || ''));
      const kind = customerShipment ? 'blocked'
        : error?.outcomeUnknown ? 'verify'
        : stage === 'scan' ? 'retryable' : 'verify';
      // A close request might have succeeded despite an error. Never resend it.
      const reason = clean(error?.message || String(error)).slice(0, 500) || 'Unknown error';
      session.issues.set(code, {code, kind, reason, attempt});
    } finally {
      issQueueInFlight--;
      session.inFlight--;
      if (attempt === 1) {
        session.completed.add(code);
        session.done = session.completed.size;
      }
      if (issQueueSession === session) {
        q.index = session.done;
        q.failed = [...session.issues.values()].map(item => item.code + ' (' + item.reason + ')');
        if (!issQueueActive(session)) issSideEmitProgress(true);
      }
    }
  }

  async function issQueuePass(session, codes, attempt) {
    let cursor = 0;
    shared.queueBusy = true;
    shared.owner = 'queue';
    try {
      const runWorker = async () => {
        while (issQueueActive(session) && cursor < codes.length) {
          if (Date.now() >= session.deadline) {
            session.timedOut = true;
            return;
          }
          const code = codes[cursor++];
          await issQueueProcess(session, code, attempt);
          if (!issQueueActive(session)) return;
          renderQueue(attempt === 1 ? 'first pass' : 'retry pass');
          issSideEmitProgress(true);
        }
      };
      await Promise.all(Array.from({length:Math.min(2,codes.length)}, () => runWorker()));
    } finally {
      shared.queueBusy = false;
      if (shared.owner === 'queue') shared.owner = '';
    }
  }

  function issQueueFinish(session) {
    q.running = false;
    session.retryPending = [];
    session.awaitingApproval = false;
    renderQueue(session.timedOut ? 'TIME LIMIT — review untouched containers' : 'finished');
    issSideEmitProgress(true);
    return issQueueResult(session);
  }

  async function issSideQueueRun(payload = {}) {
    if (issQueueSession?.awaitingApproval) throw new Error('Approve pending retries or CLEAR the queue before starting another batch');
    if (issQueueInFlight || q.running) throw new Error('Previous queue is still processing a tote');
    issSideSetMode('queue');
    const controlSeq = issSideControlSeq;
    qText.value = (Array.isArray(payload.items) ? payload.items : String(payload.items || '').split(/\r?\n/))
      .map(clean).filter(Boolean).join('\n');
    q.runSeq++;
    q.list = parseContainers(qText.value);
    q.index = 0;
    q.failed = [];
    q.running = !!q.list.length;
    q.paused = false;
    const session = {
      seq:q.runSeq, list:[...q.list], issues:new Map(), completed:new Set(), done:0, cleared:0, inFlight:0,
      retryPending:[], awaitingApproval:false, timedOut:false,
      deadline:Date.now() + 10 * 60 * 1000
    };
    issQueueSession = session;
    renderQueue(q.running ? 'first pass — 2 workers' : 'no containers');
    if (!q.running) return issQueueResult(session);

    await issQueuePass(session, session.list, 1);
    if (controlSeq !== issSideControlSeq || issQueueSession !== session || session.stopped) {
      throw issQueueCancelled(session);
    }
    if (session.timedOut) {
      for (const code of session.list) {
        if (!session.completed.has(code) && !session.issues.has(code)) session.issues.set(code, {
          code, kind:'not-attempted', reason:'Queue time limit — NOT ATTEMPTED', attempt:0
        });
      }
      return issQueueFinish(session);
    }
    const retryable = [...session.issues.values()]
      .filter(item => item.kind === 'retryable').map(item => item.code);
    if (retryable.length && session.issues.size > 4) {
      session.retryPending = retryable;
      session.awaitingApproval = true;
      q.running = false;
      renderQueue('AUTHORIZE RETRY in ISS Console');
      issSideEmitProgress(true);
      return issQueueResult(session);
    }
    if (retryable.length) {
      session.deadline = Date.now() + 10 * 60 * 1000;
      await issQueuePass(session, retryable, 2);
    }
    if (controlSeq !== issSideControlSeq || issQueueSession !== session || session.stopped) {
      throw issQueueCancelled(session);
    }
    return issQueueFinish(session);
  }

  async function issSideQueueRetry() {
    const session = issQueueSession;
    if (!session || !session.awaitingApproval || !session.retryPending.length)
      throw new Error('No pending queue retries — start a new queue');
    if (issQueueInFlight || q.running) throw new Error('Previous queue still active');
    const controlSeq = issSideControlSeq;
    const codes = [...session.retryPending];
    session.awaitingApproval = false;
    q.running = true;
    session.deadline = Date.now() + 10 * 60 * 1000;
    renderQueue('authorized retry — 2 workers');
    await issQueuePass(session, codes, 2);
    if (controlSeq !== issSideControlSeq || issQueueSession !== session || session.stopped) {
      throw issQueueCancelled(session);
    }
    return issQueueFinish(session);
  }

  function issSideReset(payload = {}) {
    const mode = clean(payload.mode || issSideWorkerMode || 'lazy').toLowerCase();
    issSideControlSeq++;
    issSideDraft = null;
    if (mode === 'queue') {
      issSideStopQueue('reset');
      q.list = [];
      q.index = 0;
      q.failed = [];
      issQueueSession = null;
      qText.value = '';
      renderQueue('reset');
    } else {
      resetLazy('ISS Console reset');
    }
    issSideEmitProgress(true);
    return {reset:true,mode};
  }

  let issSideBridgeInstalled = false;
  function installIssConsoleSidelineWorkerBridge() {
    if (!ISS_CONSOLE_WORKER || issSideBridgeInstalled) return;
    issSideBridgeInstalled = true;

    window.addEventListener('message', async event => {
      const message = event.data;
      const sourceOk = event.source === issControllerWindow();
      const originOk = event.origin === ISS_DRIVE_ORIGIN && message?._issDrive === ISS_DRIVE_CHANNEL;
      if (!sourceOk || !originOk || message?.type !== 'ISS_CONSOLE_RPC' || message?.worker !== 'sideline') return;

      const id = String(message.id || '');
      const command = String(message.command || '');
      if (!id || !command) return;

      if (issSideWorkerBusy && !['ping','stop','reset','lazy.scan','date.apply','date.defer'].includes(command)) {
        issSideSend('ISS_CONSOLE_RPC_RESULT',{id,ok:false,error:'Sideline worker busy'});
        return;
      }

      try {
        let data = null;
        if (command === 'ping') {
          issSideSend('ISS_CONSOLE_WORKER_READY',{ready:true});
          data = {ready:true,mode:issSideWorkerMode,state:issSideSnapshot()};
        } else if (command === 'mode') {
          const mode = issSideSetMode(message.payload?.mode);
          data = {mode,state:issSideSnapshot()};
        } else if (command === 'stop') {
          issSideControlSeq++;
          if (lazy.running || lazy.activeRun || lazy.preflightStart || lazy.dateResolve) issSideStopLazy();
          if (q.running || issQueueSession?.awaitingApproval) issSideStopQueue('stopped from ISS Console');
          data = {stopped:true};
        } else if (command === 'preflight.sync') {
          data = issSideDraftSync(message.payload || {});
        } else if (command === 'date.apply') {
          data = issSideApplyDate(message.payload || {});
        } else if (command === 'date.defer') {
          data = issSideDeferDate(message.payload || {});
        } else if (command === 'container.clear') {
          issSideWorkerBusy = true;
          data = await issSideClearContainer(message.payload || {});
        } else if (command === 'lazy.run') {
          issSideWorkerBusy = true;
          data = await issSideLazyRun(message.payload || {});
        } else if (command === 'lazy.scan') {
          data = issSideLazyScan(message.payload || {});
        } else if (command === 'queue.run') {
          issSideWorkerBusy = true;
          data = await issSideQueueRun(message.payload || {});
        } else if (command === 'queue.retry') {
          issSideWorkerBusy = true;
          data = await issSideQueueRetry();
        } else if (command === 'reset') {
          data = issSideReset(message.payload || {});
        } else {
          throw new Error(`Unsupported Sideline Rebuild worker command: ${command}`);
        }

        issSideSend('ISS_CONSOLE_RPC_RESULT',{id,ok:true,data});
      } catch (error) {
        issSideSend('ISS_CONSOLE_RPC_RESULT',{
          id,
          ok:false,
          error:String(error?.message || error || 'Sideline worker error'),
          data:error?.issCancelled
            ? {...(error.issData || {}),cancelled:true}
            : (error?.issData && typeof error.issData === 'object' ? error.issData : null)
        });
      } finally {
        if (['lazy.run','queue.run','queue.retry','container.clear'].includes(command)) issSideWorkerBusy = false;
        issSideEmitProgress(true);
      }
    });

    issSideStartProgress();
    issSideSend('ISS_CONSOLE_WORKER_READY',{ready:true});
  }

  // Boot
  function boot() {
    if (ISS_CONSOLE_WORKER) {
      installIssConsoleSidelineWorkerBridge();
      return;
    }

    refreshItems();

    document.addEventListener('click', handleUniversalReturnClick, true);
    mountDock();
    applyPanels();

    const isHelperMutationTarget = node => {
      const el = node?.nodeType === 1 ? node : node?.parentElement;
      return !!el?.closest?.(helperSelector);
    };

    let expiryRaf = 0;
    let recoveryTimer = 0;
    let recoveryUntil = 0;
    const scheduleNativeExpiry = () => {
      if (expiryRaf) return;
      expiryRaf = requestAnimationFrame(() => {
        expiryRaf = 0;
        nativeExpiryTick();
        const state = screen();
        if (state !== 'ITEM' && state !== 'UNKNOWN') armRecoveryWatchdog(8000);
      });
    };

    const armRecoveryWatchdog = (durationMs = 12000) => {
      recoveryUntil = Math.max(recoveryUntil, Date.now() + durationMs);
      if (recoveryTimer) return;
      const poll = () => {
        recoveryTimer = 0;
        screenDirty = true;
        nativeExpiryTick();
        if (Date.now() < recoveryUntil) recoveryTimer = setTimeout(poll, 500);
      };
      recoveryTimer = setTimeout(poll, 500);
    };

    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (isHelperMutationTarget(mutation.target)) continue;
        if (mutation.type === 'childList' && mutation.addedNodes.length) {
          const nativeAdded = [...mutation.addedNodes].some(node => !isHelperMutationTarget(node));
          if (!nativeAdded) continue;
        }
        screenDirty = true;
        scheduleNativeExpiry();
        break;
      }
    });

    observer.observe(document.body,{
      subtree:true,
      childList:true,
      characterData:true,
      attributes:true,
      attributeFilter:['hidden','aria-hidden']
    });

    window.addEventListener('pageshow', scheduleNativeExpiry);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) scheduleNativeExpiry();
    });
    window.addEventListener('pagehide', () => {
      observer.disconnect();
      if (expiryRaf) cancelAnimationFrame(expiryRaf);
      clearTimeout(recoveryTimer);
    }, { once:true });

    scheduleNativeExpiry();
  }

  const launch = boot;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',launch,{once:true});
  else launch();
})();


}
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', issDriveStartWorker, {once:true});
else issDriveStartWorker();
})();
