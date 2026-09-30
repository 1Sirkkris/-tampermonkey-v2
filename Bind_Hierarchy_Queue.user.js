// ==UserScript==
// @name         Bind Hierarchy Queue
// @name:en      Bind Hierarchy Queue
// @namespace    BWU2
// @version      0.1.1
// @description  Sequential BWU2 hierarchy bind queue locked to BWU1, seeded from the proven native bind flow.
// @match        https://tx-b-hierarchy-nrt.nrt.proxy.amazon.com/bindHierarchy*
// @run-at       document-start
// @grant        none
// @require      https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/BWU2_Actions_Core.lib.js
// @require      https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/BWU2_Fleet_Core.lib.js
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Bind_Hierarchy_Queue.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Bind_Hierarchy_Queue.user.js
// ==/UserScript==

(() => {
  'use strict';

  if (window.__bwu2BindHierarchyQueue) return;
  window.__bwu2BindHierarchyQueue = true;

  const VERSION = '0.1.1';
  const SOURCE_FC = 'BWU2';
  const DESTINATION_FC = 'BWU1';
  const API_VALIDATE_DEST = '/validateDestination';
  const API_VALIDATE_CONTAINER = '/validateContainer';
  const API_SUMMARY = '/getTransshipmentBindingSummary';
  const API_FORCE_BIND = '/forceBind';
  const REQUEST_TIMEOUT_MS = 15000;
  const BIND_TIMEOUT_MS = 25000;
  const NATIVE_SEED_TIMEOUT_MS = 30000;
  const NEXT_GAP_MS = 250;
  const STATE_KEY = 'bwu2.bindQueue.state.v1';
  const DRAFT_KEY = 'bwu2.bindQueue.draft.v1';
  const LOCK_KEY = 'bwu2.bindQueue.lock.v1';
  const TAB_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const CONTAINER_PATTERN = /^(?:tsX|csX)[A-Za-z0-9_-]+$/i;

  const ACTIONS = globalThis.BWU2Actions;
  const FLEET = globalThis.BWU2Fleet;
  const { clean, registerRuntimeVersion, trace, normalizeContainer, nextQueued, queueCounts } = FLEET;

  registerRuntimeVersion('BIND', VERSION);

  let state = loadState();
  let processing = false;
  let lockTimer = 0;
  let directTemplate = null;
  let destinationToken = '';
  let networkSeq = 0;
  const networkHistory = [];
  const networkWaiters = new Set();
  const ui = {};

  const normalizeContainerId = value => {
    const id = normalizeContainer(value, CONTAINER_PATTERN);
    if (!id) return '';
    if (/^csx/i.test(id)) return `csX${id.slice(3)}`;
    if (/^tsx/i.test(id)) return `tsX${id.slice(3)}`;
    return '';
  };

  class RequestError extends Error {
    constructor(message, details = {}) {
      super(message);
      this.name = 'RequestError';
      Object.assign(this, details);
    }
  }

  class SafePauseError extends Error {
    constructor(message = 'Paused before bind') {
      super(message);
      this.name = 'SafePauseError';
      this.safePause = true;
    }
  }

  function defaultState() {
    return {
      running:false,
      currentId:'',
      phase:'idle',
      message:'Ready',
      invalid:[],
      items:[]
    };
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
      if (!saved || !Array.isArray(saved.items)) return defaultState();
      return {
        running:false,
        currentId:clean(saved.currentId),
        phase:clean(saved.phase) || 'idle',
        message:clean(saved.message) || 'Ready',
        invalid:Array.isArray(saved.invalid) ? saved.invalid.map(clean).filter(Boolean).slice(-30) : [],
        items:saved.items
          .filter(item => normalizeContainerId(item?.id))
          .map(item => ({
            id:normalizeContainerId(item.id),
            status:['queued','active','done','attention'].includes(item.status) ? item.status : 'queued',
            phase:clean(item.phase),
            error:clean(item.error),
            ms:Math.max(0,Number(item.ms)||0)
          }))
      };
    } catch {
      return defaultState();
    }
  }

  function saveState() {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch {}
  }

  function savedDraft() {
    try { return localStorage.getItem(DRAFT_KEY) || ''; } catch { return ''; }
  }

  function saveDraft(value) {
    try { localStorage.setItem(DRAFT_KEY, String(value || '')); } catch {}
  }

  function recoverAfterReload() {
    const active = state.items.find(item => item.status === 'active');
    if (active) {
      active.status = 'attention';
      active.error = /bind/i.test(state.phase)
        ? 'Page refreshed during bind — verify container before retrying'
        : 'Page refreshed during processing — verify container';
      active.phase = state.phase || 'unknown';
    }
    state.running = false;
    state.currentId = '';
    state.phase = 'idle';
    if (active) state.message = 'Recovered — verify ATTENTION row';
    saveState();
  }

  function readLock() {
    try { return JSON.parse(localStorage.getItem(LOCK_KEY) || 'null'); }
    catch { return null; }
  }

  function lockOwnedByOther() {
    const lock = readLock();
    return !!lock && lock.tabId !== TAB_ID && Number(lock.expiresAt) > Date.now();
  }

  function renewLock() {
    try {
      localStorage.setItem(LOCK_KEY, JSON.stringify({ tabId:TAB_ID, expiresAt:Date.now()+6000 }));
    } catch {}
  }

  function acquireLock() {
    if (lockOwnedByOther()) return false;
    renewLock();
    clearInterval(lockTimer);
    lockTimer = setInterval(renewLock,2000);
    return true;
  }

  function releaseLock() {
    clearInterval(lockTimer);
    lockTimer = 0;
    const lock = readLock();
    if (lock?.tabId === TAB_ID) {
      try { localStorage.removeItem(LOCK_KEY); } catch {}
    }
  }

  function currentLogin() {
    return ACTIONS.resolveEmployeeLogin({ document, pageWindow:window }).login;
  }

  function parseBody(body) {
    if (body == null) return null;
    if (typeof body === 'object') {
      if (body instanceof URLSearchParams) return Object.fromEntries(body.entries());
      if (typeof FormData !== 'undefined' && body instanceof FormData) return Object.fromEntries(body.entries());
      return body;
    }
    const raw = String(body || '');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch {}
    try { return Object.fromEntries(new URLSearchParams(raw).entries()); } catch {}
    return raw;
  }

  function parseResponse(raw) {
    const text = String(raw ?? '');
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
  }

  function pathOf(rawUrl) {
    try { return new URL(String(rawUrl || ''), location.href).pathname; }
    catch { return ''; }
  }

  function isHierarchyEndpoint(path) {
    return [API_VALIDATE_DEST,API_VALIDATE_CONTAINER,API_SUMMARY,API_FORCE_BIND].includes(path);
  }

  function recordNetwork(record) {
    record.seq = ++networkSeq;
    networkHistory.push(record);
    if (networkHistory.length > 120) networkHistory.splice(0, networkHistory.length - 120);

    if (record.path === API_VALIDATE_DEST && record.ok && clean(record.response).toUpperCase() === DESTINATION_FC) {
      const token = clean(record.request?.destinationWarehouseId);
      if (token) destinationToken = token;
    }

    for (const waiter of [...networkWaiters]) {
      if (record.seq <= waiter.afterSeq || record.path !== waiter.path) continue;
      if (waiter.predicate && !waiter.predicate(record)) continue;
      networkWaiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve(record);
    }

    trace('BIND_NATIVE_API', {
      path:record.path,
      method:record.method,
      status:record.status,
      ok:record.ok,
      ms:record.ms
    });
  }

  function waitForEndpoint(path, afterSeq, predicate = null, timeoutMs = REQUEST_TIMEOUT_MS) {
    for (const record of networkHistory) {
      if (record.seq <= afterSeq || record.path !== path) continue;
      if (predicate && !predicate(record)) continue;
      return Promise.resolve(record);
    }

    return new Promise((resolve,reject) => {
      const waiter = { path, afterSeq, predicate, resolve, reject, timer:0 };
      waiter.timer = setTimeout(() => {
        networkWaiters.delete(waiter);
        reject(new RequestError(`No native ${path} request detected`, {
          phase:path === API_FORCE_BIND ? 'bind' : 'native',
          status:0,
          ambiguous:path === API_FORCE_BIND
        }));
      }, timeoutMs);
      networkWaiters.add(waiter);
    });
  }

  function installNetworkTap() {
    try {
      const XHR = window.XMLHttpRequest;
      if (XHR?.prototype && !XHR.prototype.__bwu2BindTapV1) {
        const nativeOpen = XHR.prototype.open;
        const nativeSend = XHR.prototype.send;

        XHR.prototype.open = function(method,url) {
          this.__bwu2BindTap = {
            method:String(method || 'GET').toUpperCase(),
            url:String(url || ''),
            path:pathOf(url)
          };
          return nativeOpen.apply(this,arguments);
        };

        XHR.prototype.send = function(body) {
          const info = this.__bwu2BindTap || {};
          if (!isHierarchyEndpoint(info.path)) return nativeSend.apply(this,arguments);
          const started = performance.now();
          const request = parseBody(body);

          this.addEventListener('loadend',() => {
            let raw = '';
            try {
              if (!this.responseType || this.responseType === 'text') raw = this.responseText || '';
              else if (this.responseType === 'json') raw = JSON.stringify(this.response ?? null);
            } catch {}

            recordNetwork({
              transport:'xhr',
              method:info.method || 'GET',
              url:info.url || '',
              path:info.path,
              request,
              response:parseResponse(raw),
              responseText:raw,
              status:Number(this.status)||0,
              ok:Number(this.status)>=200 && Number(this.status)<300,
              ms:Math.round(performance.now()-started)
            });
          },{once:true});

          return nativeSend.apply(this,arguments);
        };

        XHR.prototype.__bwu2BindTapV1 = true;
      }
    } catch (error) {
      trace('BIND_TAP_ERROR',{ area:'xhr', error:clean(error?.message || error) });
    }

    try {
      const nativeFetch = window.fetch;
      if (typeof nativeFetch === 'function' && !nativeFetch.__bwu2BindTapV1) {
        const wrapped = async function(input,init={}) {
          const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : String(input?.url || '');
          const path = pathOf(rawUrl);
          if (!isHierarchyEndpoint(path)) return nativeFetch.apply(this,arguments);
          const started = performance.now();
          try {
            const response = await nativeFetch.apply(this,arguments);
            let raw = '';
            try { raw = await response.clone().text(); } catch {}
            recordNetwork({
              transport:'fetch',
              method:String(init?.method || input?.method || 'GET').toUpperCase(),
              url:rawUrl,
              path,
              request:parseBody(init?.body),
              response:parseResponse(raw),
              responseText:raw,
              status:response.status,
              ok:response.ok,
              ms:Math.round(performance.now()-started)
            });
            return response;
          } catch (error) {
            recordNetwork({
              transport:'fetch',
              method:String(init?.method || input?.method || 'GET').toUpperCase(),
              url:rawUrl,
              path,
              request:parseBody(init?.body),
              response:null,
              responseText:'',
              status:0,
              ok:false,
              ms:Math.round(performance.now()-started),
              error:clean(error?.message || error)
            });
            throw error;
          }
        };
        wrapped.__bwu2BindTapV1 = true;
        window.fetch = wrapped;
      }
    } catch (error) {
      trace('BIND_TAP_ERROR',{ area:'fetch', error:clean(error?.message || error) });
    }
  }

  function visible(element) {
    if (!(element instanceof Element) || !element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0;
  }

  function nativeDescriptor(input) {
    let label = '';
    try {
      const direct = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null;
      label = clean(direct?.textContent || input.closest('label')?.textContent || '');
    } catch {}
    return clean([
      label,
      input.getAttribute('name'),
      input.getAttribute('id'),
      input.getAttribute('placeholder'),
      input.getAttribute('aria-label')
    ].filter(Boolean).join(' ')).toLowerCase();
  }

  function nativeInputs() {
    return [...document.querySelectorAll('input[type="text"],input:not([type]),textarea,[role="combobox"]')]
      .filter(input => !ui.root?.contains(input) && visible(input));
  }

  function findDestinationInput() {
    const rows = nativeInputs().map(input => {
      const descriptor = nativeDescriptor(input);
      const value = clean(input.value || input.textContent || '').toUpperCase();
      let score = 0;
      if (/destination/.test(descriptor)) score += 8;
      if (/warehouse|location|site|fc/.test(descriptor)) score += 4;
      if (value === DESTINATION_FC) score += 12;
      return { input, score };
    }).sort((a,b) => b.score-a.score);
    return rows[0]?.score > 0 ? rows[0].input : (rows.length === 1 ? rows[0].input : null);
  }

  function findContainerInput() {
    const rows = nativeInputs().map(input => {
      const descriptor = nativeDescriptor(input);
      let score = 0;
      if (/container|scannable|scan|tote/.test(descriptor)) score += 10;
      if (/destination|warehouse|location|site/.test(descriptor)) score -= 12;
      return { input, score };
    }).sort((a,b) => b.score-a.score);
    return rows[0]?.score > 0 ? rows[0].input : null;
  }

  function setNativeValue(input,value) {
    if (!input) return false;
    try {
      const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto,'value')?.set;
      if (setter) setter.call(input,value);
      else input.value = value;
    } catch {
      try { input.value = value; } catch { return false; }
    }

    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  }

  function keyboardEvent(type,key,keyCode) {
    const event = new KeyboardEvent(type,{
      key,
      code:key === 'Enter' ? 'Enter' : (/^[A-Za-z]$/.test(key) ? `Key${key.toUpperCase()}` : ''),
      bubbles:true,
      cancelable:true
    });
    for (const name of ['keyCode','which','charCode']) {
      try { Object.defineProperty(event,name,{get:() => keyCode}); } catch {}
    }
    return event;
  }

  async function pressEnter(target) {
    const node = target || document.body || document.documentElement;
    for (const type of ['keydown','keypress','keyup']) {
      node.dispatchEvent(keyboardEvent(type,'Enter',13));
      await sleep(2);
    }
  }

  async function typeScannerToBody(value) {
    const target = document.body || document.documentElement;
    try { target.focus?.(); } catch {}
    for (const char of String(value)) {
      const code = char.toUpperCase().charCodeAt(0);
      for (const type of ['keydown','keypress','keyup']) {
        target.dispatchEvent(keyboardEvent(type,char,code));
      }
      await sleep(2);
    }
    await pressEnter(target);
  }

  async function emitNativeScan(container) {
    container = normalizeContainerId(container);
    if (!container) throw new RequestError('Invalid container barcode',{phase:'validate',status:0});
    const field = findContainerInput();
    if (field) {
      try { field.focus(); } catch {}
      setNativeValue(field,container);
      await pressEnter(field);
      return 'field';
    }
    await typeScannerToBody(container);
    return 'body';
  }

  function exactNativeText(value) {
    const wanted = clean(value).toUpperCase();
    for (const element of document.querySelectorAll('span,strong,b,div,button,label')) {
      if (ui.root?.contains(element) || !visible(element) || element.children.length) continue;
      if (clean(element.textContent).toUpperCase() === wanted) return true;
    }
    return false;
  }

  async function ensureDestination() {
    const latest = [...networkHistory].reverse().find(record =>
      record.path === API_VALIDATE_DEST &&
      record.ok &&
      clean(record.response).toUpperCase() === DESTINATION_FC &&
      clean(record.request?.destinationWarehouseId)
    );
    if (latest) {
      destinationToken = clean(latest.request.destinationWarehouseId);
      return true;
    }

    const input = findDestinationInput();
    const current = clean(input?.value || '').toUpperCase();

    if (input && current !== DESTINATION_FC) {
      const marker = networkSeq;
      try { input.focus(); } catch {}
      setNativeValue(input,DESTINATION_FC);
      await pressEnter(input);
      const result = await waitForEndpoint(
        API_VALIDATE_DEST,
        marker,
        record => record.ok && clean(record.response).toUpperCase() === DESTINATION_FC,
        8000
      );
      destinationToken = clean(result.request?.destinationWarehouseId);
      if (!destinationToken) throw new RequestError('BWU1 validated but destination token was not captured',{phase:'destination',status:0});
      return true;
    }

    if (input && current === DESTINATION_FC) {
      const marker = networkSeq;
      await pressEnter(input);
      try {
        const result = await waitForEndpoint(
          API_VALIDATE_DEST,
          marker,
          record => record.ok && clean(record.response).toUpperCase() === DESTINATION_FC,
          5000
        );
        destinationToken = clean(result.request?.destinationWarehouseId);
        if (destinationToken) return true;
      } catch {}
    }

    if (exactNativeText(DESTINATION_FC) && destinationToken) return true;

    throw new RequestError('BWU1 must be selected/validated in the native page',{phase:'destination',status:0});
  }

  function requestContainer(record) {
    return clean(record?.request?.scannableId);
  }

  function assertNetworkSuccess(record,phase) {
    if (!record) throw new RequestError(`Missing ${phase} response`,{phase,status:0});
    if (!record.ok) {
      const sessionExpired = [401,403,419].includes(Number(record.status));
      throw new RequestError(sessionExpired ? 'SESSION EXPIRED' : `${phase}: HTTP ${record.status || 0}`,{
        phase,
        status:Number(record.status)||0,
        sessionExpired,
        ambiguous:phase === 'bind'
      });
    }
    return record;
  }

  function assertValidate(record,container) {
    assertNetworkSuccess(record,'validate');
    const data = record.response;
    if (!data || typeof data !== 'object') throw new RequestError('Unexpected container validation response',{phase:'validate',status:record.status});
    if (clean(data.warehouseId).toUpperCase() !== SOURCE_FC) {
      throw new RequestError(`Container is not validated in ${SOURCE_FC}`,{phase:'validate',status:record.status});
    }
    if (clean(data.scannableId).toLowerCase() !== clean(container).toLowerCase()) {
      throw new RequestError('Validation returned another container',{phase:'validate',status:record.status});
    }
  }

  function assertSummary(record) {
    assertNetworkSuccess(record,'summary');
    if (!record.response || !Array.isArray(record.response.transferBindingSummaryList)) {
      throw new RequestError('Unexpected binding summary',{phase:'summary',status:record.status});
    }
  }

  function assertBind(record,container) {
    assertNetworkSuccess(record,'bind');
    const body = record.request || {};
    if (clean(body.scannableId).toLowerCase() !== clean(container).toLowerCase()) {
      throw new RequestError('Bind request used another container',{phase:'bind',status:record.status,ambiguous:true});
    }
    if (!destinationToken || clean(body.destinationWarehouseId) !== destinationToken) {
      throw new RequestError('Bind destination did not match validated BWU1 — verify container',{phase:'bind',status:record.status,ambiguous:true});
    }
    const data = record.response;
    if (!data || typeof data !== 'object' || !clean(data.hostName)) {
      throw new RequestError('Unexpected bind response — verify container',{phase:'bind',status:record.status,ambiguous:true});
    }
  }

  async function seedNativeTemplate(container) {
    container = normalizeContainerId(container);
    if (!container) throw new RequestError('Invalid container barcode',{phase:'validate',status:0});
    await ensureDestination();
    state.phase = 'native-validate';
    render();

    const firstMarker = networkSeq;
    const firstTransport = await emitNativeScan(container);
    trace('BIND_QUEUE_NATIVE_SCAN',{ container, pass:1, transport:firstTransport });

    const validate = await waitForEndpoint(
      API_VALIDATE_CONTAINER,
      firstMarker,
      record => requestContainer(record).toLowerCase() === container.toLowerCase(),
      NATIVE_SEED_TIMEOUT_MS
    );
    assertValidate(validate,container);

    const summary = await waitForEndpoint(
      API_SUMMARY,
      firstMarker,
      record => requestContainer(record).toLowerCase() === container.toLowerCase(),
      NATIVE_SEED_TIMEOUT_MS
    );
    assertSummary(summary);

    if (!state.running) throw new SafePauseError();

    state.phase = 'native-bind';
    render();

    const bindMarker = networkSeq;
    const secondTransport = await emitNativeScan(container);
    trace('BIND_QUEUE_NATIVE_SCAN',{ container, pass:2, transport:secondTransport });

    const bind = await waitForEndpoint(
      API_FORCE_BIND,
      bindMarker,
      record => requestContainer(record).toLowerCase() === container.toLowerCase(),
      BIND_TIMEOUT_MS
    );
    assertBind(bind,container);

    const sourceToken = clean(bind.request?.sourceWarehouseId);
    const destToken = clean(bind.request?.destinationWarehouseId);
    if (!sourceToken || !destToken) {
      throw new RequestError('Native bind succeeded but API template was incomplete',{phase:'bind',status:bind.status,ambiguous:true});
    }

    directTemplate = Object.freeze({ sourceWarehouseId:sourceToken, destinationWarehouseId:destToken });
    trace('BIND_QUEUE_TEMPLATE_READY',{ destination:DESTINATION_FC });
    return bind;
  }

  async function postJson(path,body,timeoutMs,phase) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(),timeoutMs);
    const started = performance.now();

    try {
      const response = await fetch(path,{
        method:'POST',
        credentials:'same-origin',
        headers:{'content-type':'application/json'},
        body:JSON.stringify(body),
        signal:controller.signal
      });
      const raw = await response.text();
      const data = parseResponse(raw);
      const contentType = clean(response.headers.get('content-type')).toLowerCase();
      const signalText = clean(typeof data === 'string' ? data : JSON.stringify(data || {})).slice(0,1800);
      const sessionExpired = [401,403,419].includes(response.status)
        || response.redirected
        || contentType.includes('text/html')
        || /(?:csrf|token|session).{0,40}(?:expired|invalid|missing)/i.test(signalText)
        || (typeof data === 'string' && /(?:sign[ -]?in|login)\b/i.test(signalText));

      if (sessionExpired) {
        throw new RequestError('SESSION EXPIRED — refresh/sign in before retrying',{
          phase,status:response.status,sessionExpired:true,ambiguous:phase==='bind'
        });
      }

      if (!response.ok) {
        throw new RequestError(`${phase}: HTTP ${response.status}`,{
          phase,status:response.status,data,ambiguous:phase==='bind'
        });
      }

      return {
        transport:'direct',
        path,
        request:body,
        response:data,
        responseText:raw,
        status:response.status,
        ok:true,
        ms:Math.round(performance.now()-started)
      };
    } catch (error) {
      if (error instanceof RequestError) throw error;
      const aborted = error?.name === 'AbortError';
      throw new RequestError(aborted ? `${phase}: timed out` : `${phase}: ${clean(error?.message || 'network error')}`,{
        phase,
        status:0,
        ambiguous:phase==='bind'
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function processDirect(container) {
    container = normalizeContainerId(container);
    if (!container) throw new RequestError('Invalid container barcode',{phase:'validate',status:0});
    if (!directTemplate) throw new RequestError('Bind API template is not ready',{phase:'template',status:0});
    await ensureDestination();

    state.phase = 'validate';
    render();
    const validate = await postJson(
      API_VALIDATE_CONTAINER,
      { warehouseId:SOURCE_FC, scannableId:container },
      REQUEST_TIMEOUT_MS,
      'validate'
    );
    assertValidate(validate,container);

    state.phase = 'summary';
    render();
    const summary = await postJson(
      API_SUMMARY,
      { warehouseId:SOURCE_FC, scannableId:container },
      REQUEST_TIMEOUT_MS,
      'summary'
    );
    assertSummary(summary);

    if (!state.running) throw new SafePauseError();

    const login = currentLogin();
    if (!login) throw new RequestError('Logged-in user could not be detected',{phase:'identity',status:0});

    state.phase = 'bind';
    render();
    const bind = await postJson(
      API_FORCE_BIND,
      {
        sourceWarehouseId:directTemplate.sourceWarehouseId,
        destinationWarehouseId:directTemplate.destinationWarehouseId,
        scannableId:container,
        employeeLogin:login
      },
      BIND_TIMEOUT_MS,
      'bind'
    );
    assertBind(bind,container);
    return bind;
  }

  function rememberInvalid(values) {
    const seen = new Set(state.invalid.map(value => value.toLowerCase()));
    for (const raw of values) {
      const value = clean(raw);
      if (!value || seen.has(value.toLowerCase())) continue;
      seen.add(value.toLowerCase());
      state.invalid.push(value);
    }
    state.invalid = state.invalid.slice(-30);
  }

  function addDraftToQueue() {
    if (!ui.draft) return 0;
    const raw = ui.draft.value.replace(/\r/g,'');
    const lines = raw.split(/[\n,]+/).map(clean).filter(Boolean);
    if (!lines.length) return 0;

    const existing = new Set(state.items.map(item => item.id.toLowerCase()));
    const invalid = [];
    let added = 0;

    for (const line of lines) {
      const id = normalizeContainerId(line);
      if (!id) {
        invalid.push(line);
        continue;
      }
      if (existing.has(id.toLowerCase())) continue;
      existing.add(id.toLowerCase());
      state.items.push({ id,status:'queued',phase:'',error:'',ms:0 });
      added++;
    }

    if (invalid.length) rememberInvalid(invalid);
    ui.draft.value = '';
    saveDraft('');
    state.message = added
      ? `${added} added${invalid.length ? ` | ${invalid.length} rejected` : ''}`
      : invalid.length ? 'Rejected — container barcode expected' : 'Already queued';
    saveState();
    render();
    trace('BIND_QUEUE_ADD',{ added,invalid:invalid.length,running:state.running });

    if (state.running && added) setTimeout(runQueue,0);
    setTimeout(() => ui.draft?.focus(),0);
    return added;
  }

  function activateNext() {
    const item = nextQueued(state.items);
    if (!item) return null;
    item.status = 'active';
    item.phase = directTemplate ? 'validate' : 'native-seed';
    item.error = '';
    item.ms = 0;
    state.currentId = item.id;
    state.phase = item.phase;
    state.message = directTemplate
      ? `Validating ${item.id}`
      : `Seeding native bind with ${item.id}`;
    saveState();
    render();
    trace('BIND_QUEUE_ITEM_START',{ container:item.id, seeded:!!directTemplate });
    return item;
  }

  function currentItem() {
    const key = clean(state.currentId).toLowerCase();
    return state.items.find(item => item.id.toLowerCase() === key) || null;
  }

  function markDone(item,started) {
    item.status = 'done';
    item.phase = 'done';
    item.error = '';
    item.ms = Math.round(performance.now()-started);
    state.currentId = '';
    state.phase = 'idle';
    state.message = `BOUND → ${DESTINATION_FC}: ${item.id} (${item.ms}ms)`;
    saveState();
    render();
    trace('BIND_QUEUE_ITEM_DONE',{ container:item.id,destination:DESTINATION_FC,ms:item.ms });
  }

  function markAttention(item,error) {
    if (error?.safePause) {
      item.status = 'queued';
      item.phase = '';
      item.error = '';
      state.currentId = '';
      state.phase = 'idle';
      state.message = 'Paused safely before bind';
      saveState();
      render();
      return;
    }

    item.status = 'attention';
    item.phase = clean(error?.phase || state.phase);
    item.error = clean(error?.message || 'Needs attention');
    state.currentId = '';
    state.phase = 'idle';
    state.running = false;
    state.message = error?.ambiguous
      ? `STOPPED — VERIFY ${item.id}: ${item.error}`
      : `STOPPED — ${item.id}: ${item.error}`;
    releaseLock();
    saveState();
    render();
    trace('BIND_QUEUE_ATTENTION',{
      container:item.id,
      phase:item.phase,
      reason:item.error,
      ambiguous:!!error?.ambiguous,
      sessionExpired:!!error?.sessionExpired
    });
  }

  async function processItem(item) {
    const started = performance.now();
    if (!directTemplate) await seedNativeTemplate(item.id);
    else await processDirect(item.id);
    markDone(item,started);
  }

  async function runQueue() {
    if (!state.running || processing) return;
    if (lockOwnedByOther()) {
      state.running = false;
      state.message = 'Queue is active in another tab';
      saveState();
      render();
      return;
    }

    renewLock();
    const item = currentItem() || activateNext();
    if (!item) {
      state.message = 'RUNNING — scan/paste more containers';
      saveState();
      render();
      ui.draft?.focus();
      return;
    }

    processing = true;
    try {
      await processItem(item);
    } catch (error) {
      markAttention(item,error);
    } finally {
      processing = false;
      if (!state.running) releaseLock();
      render();
    }

    if (state.running) setTimeout(runQueue,NEXT_GAP_MS);
  }

  async function startQueue() {
    if (state.running || processing) return;
    const login = currentLogin();
    if (!login) {
      state.message = 'Logged-in user could not be detected — refresh/sign in';
      saveState();
      render();
      return;
    }

    addDraftToQueue();
    if (!state.items.some(item => item.status === 'queued')) {
      state.message = 'Add containers first';
      saveState();
      render();
      return;
    }

    try {
      await ensureDestination();
    } catch (error) {
      state.message = clean(error?.message || error);
      saveState();
      render();
      return;
    }

    if (!acquireLock()) {
      state.message = 'Another tab already owns the Bind queue';
      saveState();
      render();
      return;
    }

    state.items = state.items.filter(item => item.status !== 'done');
    state.running = true;
    state.message = `RUNNING → ${DESTINATION_FC}`;
    saveState();
    render();
    trace('BIND_QUEUE_START',{
      queued:queueCounts(state.items).queued,
      source:SOURCE_FC,
      destination:DESTINATION_FC
    });
    setTimeout(runQueue,0);
  }

  function pauseQueue() {
    state.running = false;
    state.message = processing && /bind/i.test(state.phase)
      ? 'PAUSED — current bind will finish; no next container'
      : 'Paused';
    saveState();
    if (!processing) releaseLock();
    render();
    trace('BIND_QUEUE_PAUSE',{ currentId:state.currentId,phase:state.phase });
  }

  function clearQueue() {
    if (processing) {
      state.message = 'Cannot clear while a container is processing';
      saveState();
      render();
      return;
    }
    state.running = false;
    releaseLock();
    state = defaultState();
    directTemplate = null;
    saveState();
    if (ui.draft) ui.draft.value = '';
    saveDraft('');
    render();
    trace('BIND_QUEUE_CLEAR',{});
  }

  function retryAttention() {
    if (state.running || processing) return;
    const attention = state.items.filter(item => item.status === 'attention');
    if (!attention.length) return;
    for (const item of attention) {
      item.status = 'queued';
      item.phase = '';
      item.error = '';
      item.ms = 0;
    }
    state.message = `${attention.length} attention row(s) requeued — press START`;
    saveState();
    render();
  }

  function isolateDraft(field) {
    const stop = event => {
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (event.type !== 'keydown' || event.key !== 'Enter' || event.shiftKey) return;
      event.preventDefault();
      addDraftToQueue();
    };
    field.addEventListener('keydown',stop);
    field.addEventListener('keypress',stop);
    field.addEventListener('keyup',event => {
      event.stopPropagation();
      event.stopImmediatePropagation();
    });
  }

  function makeButton(text,handler,accent='') {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.style.cssText = `padding:7px 10px;border:1px solid #64748b;border-radius:5px;background:${accent || '#fff'};color:#111827;font:900 12px Arial;cursor:pointer`;
    button.addEventListener('click',handler);
    return button;
  }

  function mountUi() {
    if (!document.body || document.getElementById('bwu2-bind-queue')) return;

    const root = document.createElement('section');
    root.id = 'bwu2-bind-queue';
    root.setAttribute('data-bwu2-ui','1');
    root.style.cssText = [
      'position:fixed','right:12px','bottom:12px','z-index:2147483500',
      'width:430px','max-height:calc(100vh - 24px)','overflow:auto',
      'box-sizing:border-box','padding:10px','background:#fff',
      'border:2px solid #0f172a','border-radius:8px','box-shadow:0 5px 18px #0004',
      'font:12px Arial,sans-serif','color:#0f172a'
    ].join(';');

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px';
    const title = document.createElement('strong');
    title.textContent = `BIND QUEUE · v${VERSION}`;
    title.style.cssText = 'font-size:15px';
    const dest = document.createElement('span');
    dest.textContent = `DESTINATION: ${DESTINATION_FC} 🔒`;
    dest.style.cssText = 'padding:4px 7px;border:2px solid #1d4ed8;border-radius:5px;background:#dbeafe;color:#1e3a8a;font-weight:1000';
    header.append(title,dest);

    const meta = document.createElement('div');
    meta.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:7px';
    ui.login = document.createElement('div');
    ui.template = document.createElement('div');
    meta.append(ui.login,ui.template);

    const draft = document.createElement('textarea');
    draft.placeholder = 'Scan/paste tsX / csX containers — one per line';
    draft.value = savedDraft();
    draft.style.cssText = 'width:100%;height:72px;box-sizing:border-box;padding:7px;border:1px solid #94a3b8;border-radius:5px;font:12px Consolas,monospace;resize:vertical';
    draft.addEventListener('input',() => saveDraft(draft.value));
    isolateDraft(draft);
    ui.draft = draft;

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:7px';
    buttons.append(
      makeButton('START',startQueue,'#dcfce7'),
      makeButton('PAUSE',pauseQueue,'#fef3c7'),
      makeButton('RETRY',retryAttention,'#ffedd5'),
      makeButton('CLEAR',clearQueue)
    );

    ui.status = document.createElement('div');
    ui.status.style.cssText = 'margin-top:7px;padding:7px;border:1px solid #cbd5e1;border-radius:5px;background:#f8fafc;font-weight:900';

    ui.counts = document.createElement('div');
    ui.counts.style.cssText = 'margin-top:6px;font:800 11px Consolas,monospace;color:#334155';

    ui.items = document.createElement('div');
    ui.items.style.cssText = 'margin-top:6px;border:1px solid #cbd5e1;border-radius:5px;overflow:hidden';

    ui.invalid = document.createElement('div');
    ui.invalid.style.cssText = 'display:none;margin-top:6px;padding:6px;border:1px solid #b45309;background:#fffbeb;color:#78350f;font:800 11px Consolas,monospace';

    root.append(header,meta,draft,buttons,ui.status,ui.counts,ui.items,ui.invalid);
    document.body.appendChild(root);
    ui.root = root;

    render();
    setTimeout(() => draft.focus(),0);
  }

  function render() {
    if (!ui.root) return;
    const counts = queueCounts(state.items);
    const login = currentLogin();

    ui.login.textContent = `USER: ${login || 'NOT DETECTED'}`;
    ui.template.textContent = directTemplate ? 'API: READY' : 'API: NATIVE SEED NEEDED';
    ui.template.style.fontWeight = '900';
    ui.template.style.color = directTemplate ? '#166534' : '#9a3412';

    ui.status.textContent = state.message || 'Ready';
    ui.counts.textContent = `QUEUED ${counts.queued} · ACTIVE ${counts.active} · DONE ${counts.done} · ATTENTION ${counts.attention}`;

    ui.items.replaceChildren();
    for (const item of state.items.slice(-60)) {
      const row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:92px 1fr auto;gap:6px;align-items:center;padding:5px 6px;border-top:1px solid #e2e8f0;font:11px Consolas,monospace';

      const labels = {
        queued:['QUEUED','#475569','#f8fafc'],
        active:[clean(item.phase || 'ACTIVE').toUpperCase(),'#1e40af','#dbeafe'],
        done:['BOUND','#14532d','#dcfce7'],
        attention:['ATTENTION','#9a3412','#ffedd5']
      };
      const [label,color,bg] = labels[item.status] || labels.queued;
      row.style.background = item.status === 'attention'
        ? 'repeating-linear-gradient(135deg,#fff7ed,#fff7ed 7px,#ffedd5 7px,#ffedd5 14px)'
        : bg;

      const badge = document.createElement('strong');
      badge.textContent = label;
      badge.style.color = color;

      const id = document.createElement('span');
      id.textContent = item.id;
      id.style.fontWeight = '900';

      const detail = document.createElement('span');
      detail.textContent = item.error || (item.ms ? `${item.ms}ms` : '');
      detail.title = item.error || '';
      detail.style.cssText = 'max-width:175px;overflow:hidden;text-overflow:ellipsis;text-align:right;color:#475569';

      row.append(badge,id,detail);
      ui.items.appendChild(row);
    }

    if (state.invalid.length) {
      ui.invalid.style.display = 'block';
      ui.invalid.textContent = `Rejected: ${state.invalid.slice(-8).join(', ')}`;
    } else {
      ui.invalid.style.display = 'none';
      ui.invalid.textContent = '';
    }
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve,ms));
  }

  recoverAfterReload();
  installNetworkTap();

  const boot = () => {
    mountUi();
    trace('BIND_QUEUE_BOOT',{
      version:VERSION,
      source:SOURCE_FC,
      destination:DESTINATION_FC
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();

  window.addEventListener('beforeunload',releaseLock);
})();
