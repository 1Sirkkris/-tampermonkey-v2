// ==UserScript==
// @name         v2 Bind Hierarchy Queue
// @name:en      v2 Hierarchy Queue
// @namespace    BWU2
// @version      0.4.2
// @description  Unified BWU2 Bind/Unbind hierarchy queue. Bind is hard-locked to BWU1.
// @match        https://tx-b-hierarchy-nrt.nrt.proxy.amazon.com/unbindHierarchy*
// @match        https://tx-b-hierarchy-nrt.nrt.proxy.amazon.com/bindHierarchy*
// @grant        none
// @require      https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/BWU2_Actions_Core.lib.js
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Bind_Hierarchy_Queue.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Bind_Hierarchy_Queue.user.js
// @require      https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/BWU2_Fleet_Core.lib.js
// ==/UserScript==

(() => {
  'use strict';

  const UNBIND_PAGE = /\/unbindHierarchy(?:\/|$)/i.test(location.pathname);
  if (window.__bwu2HierarchyQueue) return;
  if (UNBIND_PAGE && window.__bwu2UnbindHierarchyQueue) return;
  window.__bwu2HierarchyQueue = true;
  window.__bwu2UnbindHierarchyQueue = true;
  window.__bwu2BindHierarchyQueue = true;

  // Keep the base @name above permanently fixed: Tampermonkey uses it with
  // @namespace as the update identity. Display versions belong here,
  // @version, @name:en, and the UI only.
  const VERSION = '0.4.2';
  const ACTIONS = globalThis.BWU2Actions;
  const { registerRuntimeVersion } = globalThis.BWU2Fleet;
  const MODE = /\/bindHierarchy(?:\/|$)/i.test(location.pathname) ? 'bind' : 'unbind';
  const IS_BIND = MODE === 'bind';
  registerRuntimeVersion(IS_BIND ? 'BIND' : 'UNBIND', VERSION);

  const WAREHOUSE_ID = 'BWU2';
  const DESTINATION_FC = 'BWU1';
  const API_VALIDATE_DEST = '/validateDestination';
  const API_VALIDATE = '/validateContainer';
  const API_SUMMARY = '/getTransshipmentBindingSummary';
  const API_BIND = '/forceBind';
  const API_UNBIND = '/unbindContainer';
  const TIMEOUT_VALIDATE_MS = 12000;
  const TIMEOUT_SUMMARY_MS = 12000;
  const TIMEOUT_MUTATION_MS = 25000;
  const NEXT_GAP_MS = 180;
  const STATE_KEY = IS_BIND ? 'bwu2.bindQueue.state.v2' : 'bwu2.unbindQueue.state.v1';
  const DRAFT_KEY = IS_BIND ? 'bwu2.bindQueue.draft.v2' : 'bwu2.unbindQueue.draft.v1';
  const LOCK_KEY = 'bwu2.hierarchyQueue.lock.v1';
  const MINIMIZED_KEY = IS_BIND ? 'bwu2.bindQueue.minimized.v2' : 'bwu2.unbindQueue.minimized.v1';
  const SESSION_RECOVERY_KEY = IS_BIND ? 'bwu2.bindQueue.sessionRecovery.v2' : 'bwu2.unbindQueue.sessionRecovery.v1';
  const BIND_TEMPLATE_KEY = 'bwu2.bindQueue.template.v2';
  const SESSION_RECOVERY_MAX_AGE_MS = 60 * 1000;
  const SESSION_RECOVERY_MAX_ATTEMPTS = 2;
  const TAB_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const CONTAINER_PATTERN = /^(?:tsX|csX)[A-Za-z0-9_-]+$/i;

  const { clean } = globalThis.BWU2Fleet;

  const normalizeContainer = value => {
    const id = globalThis.BWU2Fleet.normalizeContainer(value, CONTAINER_PATTERN);
    if (!id || !IS_BIND) return id;
    if (/^csx/i.test(id)) return `csX${id.slice(3)}`;
    if (/^tsx/i.test(id)) return `tsX${id.slice(3)}`;
    return '';
  };

  let processing = false;
  let manualBindLogin = false;
  let bindRunLogin = '';
  let bridgeIdentity = { status: 'missing', login: '', source: '', expiresAt: 0 };
  let lockTimer = 0;
  let positionFrame = 0;
  let lastAnchorTop = 10;
  let minimized = loadMinimized();
  let state = loadState();
  let directTemplate = null;
  let bindTemplateVerified = false;
  let destinationToken = '';
  const bindActive = new Set();
  const BIND_CONCURRENCY = 2;
  let bindTemplateCheck = null;
  let nativeTemplateCapture = false;
  const ui = {};

  if (IS_BIND) {
    directTemplate = loadBindTemplate();
    destinationToken = directTemplate?.destinationWarehouseId || '';
  }

  function defaultState() {
    return {
      running: false,
      currentId: '',
      phase: 'idle',
      message: 'Ready',
      invalid: [],
      items: []
    };
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
      if (!saved || !Array.isArray(saved.items)) return defaultState();
      return {
        running: !!saved.running,
        currentId: clean(saved.currentId),
        phase: clean(saved.phase) || 'idle',
        message: clean(saved.message) || 'Ready',
        invalid: Array.isArray(saved.invalid)
          ? saved.invalid.map(clean).filter(Boolean).slice(-30)
          : [],
        items: saved.items
          .filter(item => normalizeContainer(item?.id))
          .map(item => ({
            id: normalizeContainer(item.id),
            status: ['queued', 'active', 'done', 'attention'].includes(item.status)
              ? item.status
              : 'queued',
            phase: clean(item.phase),
            error: clean(item.error),
            ms: Math.max(0, Number(item.ms) || 0),
            ambiguous: IS_BIND && !!item.ambiguous
          }))
      };
    } catch (_) {
      return defaultState();
    }
  }

  function saveState() {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (_) {}
  }

  function savedDraft() {
    try { return localStorage.getItem(DRAFT_KEY) || ''; } catch (_) { return ''; }
  }

  function saveDraft(value) {
    try { localStorage.setItem(DRAFT_KEY, String(value || '')); } catch (_) {}
  }

  function loadMinimized() {
    try { return localStorage.getItem(MINIMIZED_KEY) === '1'; }
    catch (_) { return false; }
  }

  function saveMinimized() {
    try { localStorage.setItem(MINIMIZED_KEY, minimized ? '1' : '0'); } catch (_) {}
  }

  function readSessionRecovery() {
    try {
      const value = JSON.parse(localStorage.getItem(SESSION_RECOVERY_KEY) || 'null');
      if (!value || !Number(value.at)) return null;
      if (Date.now() - Number(value.at) > SESSION_RECOVERY_MAX_AGE_MS) {
        localStorage.removeItem(SESSION_RECOVERY_KEY);
        return null;
      }
      return value;
    } catch (_) {
      return null;
    }
  }

  function saveSessionRecovery(value) {
    try { localStorage.setItem(SESSION_RECOVERY_KEY, JSON.stringify(value)); } catch (_) {}
  }

  function clearSessionRecovery() {
    try { localStorage.removeItem(SESSION_RECOVERY_KEY); } catch (_) {}
  }

  const trace = (event, data = {}) => {
    const name = IS_BIND ? String(event).replace(/^UNBIND_/, 'BIND_') : event;
    globalThis.BWU2Fleet.trace(name, data);
  };

  const mutationPhase = () => IS_BIND ? 'bind' : 'unbind';
  const isMutationPhase = phase => clean(phase) === mutationPhase();

  function itemFor(id = state.currentId) {
    const key = clean(id).toLowerCase();
    return state.items.find(item => item.id.toLowerCase() === key) || null;
  }

  const nextQueued = () => globalThis.BWU2Fleet.nextQueued(state.items);

  const counts = () => globalThis.BWU2Fleet.queueCounts(state.items);

  function recoverAfterReload() {
    if (IS_BIND) {
      const active = state.items.filter(item => item.status === 'active');
      for (const item of active) {
        const wasMutating = item.phase === 'bind';
        item.status = wasMutating ? 'attention' : 'queued';
        item.error = wasMutating ? 'UNKNOWN — page refreshed during bind; verify before retrying' : '';
        item.ambiguous = wasMutating;
        if (!wasMutating) item.phase = '';
      }
      state.running = false;
      state.currentId = '';
      state.phase = 'idle';
      if (active.length) state.message = 'Recovered — verify uncertain binds before retrying';
      saveState();
      return;
    }
    const active = state.items.find(item => item.status === 'active');
    if (active) {
      active.status = 'attention';
      active.error = isMutationPhase(state.phase)
        ? `Page refreshed during ${mutationPhase()} — verify before retrying`
        : 'Page refreshed during processing — verify container';
      active.phase = state.phase;
    }
    state.running = false;
    state.currentId = '';
    state.phase = 'idle';
    if (active) state.message = 'Queue recovered — verify attention row';
    saveState();
  }

  recoverAfterReload();
  if (IS_BIND) installBindNativeTap();

  function readLock() {
    try { return JSON.parse(localStorage.getItem(LOCK_KEY) || 'null'); }
    catch (_) { return null; }
  }

  function lockOwnedByOther() {
    const lock = readLock();
    return !!lock && lock.tabId !== TAB_ID && Number(lock.expiresAt) > Date.now();
  }

  function renewLock() {
    try {
      localStorage.setItem(LOCK_KEY, JSON.stringify({ tabId: TAB_ID, expiresAt: Date.now() + 6000 }));
    } catch (_) {}
  }

  function acquireLock() {
    if (lockOwnedByOther()) return false;
    renewLock();
    clearInterval(lockTimer);
    lockTimer = setInterval(renewLock, 2000);
    return true;
  }

  function releaseLock() {
    clearInterval(lockTimer);
    lockTimer = 0;
    const lock = readLock();
    if (lock?.tabId === TAB_ID) {
      try { localStorage.removeItem(LOCK_KEY); } catch (_) {}
    }
  }

  function freshBridgeLogin() {
    if (bridgeIdentity.status !== 'ready'
        || Number(bridgeIdentity.expiresAt) <= Date.now()) return '';
    return ACTIONS.normalizeLogin(bridgeIdentity.login);
  }

  function localDetectedLogin() {
    // Never use the host-localStorage login cache on a shared laptop.
    return ACTIONS.resolveEmployeeLogin({
      document, pageWindow: window,
      storage: { setItem() {}, getItem() { return null; } },
      allowCachedLogin: false
    }).login;
  }

  function detectedLogin() {
    if (IS_BIND) {
      if (bridgeIdentity.status === 'conflict') return '';
      const shared = freshBridgeLogin();
      if (shared) return shared;
    }
    return localDetectedLogin();
  }

  function currentLogin() {
    if (IS_BIND && manualBindLogin) return ACTIONS.normalizeLogin(ui.login?.value);
    return detectedLogin();
  }

  function refreshDetectedLogin() {
    const detected = detectedLogin();
    if (IS_BIND) {
      // Explicit manual input always wins; never overwrite it or reset it on reload.
      if (ui.login && !manualBindLogin && !state.running) ui.login.value = detected;
      if (ui.login) ui.login.placeholder = detected ? 'Employee login' : 'ENTER EMPLOYEE LOGIN';
      if (ui.identitySource) {
        const source = manualBindLogin ? 'MANUAL OVERRIDE'
          : bridgeIdentity.status === 'conflict' ? 'CONFLICT — different FCR logins; enter manually'
          : freshBridgeLogin() ? bridgeIdentity.source + ' · live'
          : detected ? 'HIERARCHY LOCAL'
          : 'NOT DETECTED — open FCR, or enter manually';
        ui.identitySource.textContent = 'Login source: ' + source;
        ui.identitySource.style.color = bridgeIdentity.status === 'conflict' && !manualBindLogin
          ? '#9a3412' : detected || manualBindLogin ? '#166534' : '#9a3412';
      }
      return currentLogin();
    }
    if (ui.login) ui.login.textContent = detected || 'NOT DETECTED';
    return detected;
  }

  if (IS_BIND) {
    document.addEventListener('bwu2:identity:update', event => {
      let value;
      try { value = JSON.parse(String(event.detail || '')); } catch { return; }
      if (!value || !['ready', 'missing', 'conflict', 'unavailable'].includes(value.status)) return;
      const login = ACTIONS.normalizeLogin(value.login);
      const expiry = Number(value.expiresAt || 0);
      bridgeIdentity = {
        status: value.status === 'ready' && login && expiry > Date.now() && expiry < Date.now() + 60000
          ? 'ready' : value.status === 'ready' ? 'missing' : value.status,
        login, source: clean(value.source).slice(0, 100), expiresAt: expiry
      };
      refreshDetectedLogin();
      // OBS owns FCR-to-Hierarchy identity; no separately installed bridge is needed.
      // A changed or vanished automatic identity must stop NEW mutations.
      // In-flight requests keep the login captured at START and settle normally.
      if (!manualBindLogin && state.running && bindRunLogin !== detectedLogin()) {
        pauseQueue('Identity changed / expired — verify login before resuming');
      }
    });
  }

  function requestSharedLogin() {
    if (IS_BIND) document.dispatchEvent(new Event('bwu2:identity:request'));
  }


  function loadBindTemplate() {
    if (!IS_BIND) return null;
    try {
      const value = JSON.parse(sessionStorage.getItem(BIND_TEMPLATE_KEY) || 'null');
      if (!value) return null;
      const sourceWarehouseId = clean(value.sourceWarehouseId);
      const destinationWarehouseId = clean(value.destinationWarehouseId);
      if (!sourceWarehouseId || !destinationWarehouseId || clean(value.destination).toUpperCase() !== DESTINATION_FC) return null;
      return { sourceWarehouseId, destinationWarehouseId, destination: DESTINATION_FC };
    } catch (_) {
      return null;
    }
  }

  function saveBindTemplate(sourceWarehouseId, destinationWarehouseId) {
    const value = {
      sourceWarehouseId: clean(sourceWarehouseId),
      destinationWarehouseId: clean(destinationWarehouseId),
      destination: DESTINATION_FC
    };
    if (!value.sourceWarehouseId || !value.destinationWarehouseId) return false;
    directTemplate = Object.freeze(value);
    destinationToken = value.destinationWarehouseId;
    bindTemplateVerified = true;
    try { sessionStorage.setItem(BIND_TEMPLATE_KEY, JSON.stringify(value)); } catch (_) {}
    trace('UNBIND_TEMPLATE_READY', { destination: DESTINATION_FC });
    return true;
  }

  function clearBindTemplate() {
    directTemplate = null;
    destinationToken = '';
    bindTemplateVerified = false;
    bindTemplateCheck = null;
    try { sessionStorage.removeItem(BIND_TEMPLATE_KEY); } catch (_) {}
  }

  function parseNativeBody(body) {
    if (body == null) return null;
    if (typeof body === 'object') {
      if (body instanceof URLSearchParams) return Object.fromEntries(body.entries());
      if (typeof FormData !== 'undefined' && body instanceof FormData) return Object.fromEntries(body.entries());
      return body;
    }
    const raw = String(body || '');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) {}
    try { return Object.fromEntries(new URLSearchParams(raw).entries()); } catch (_) {}
    return raw;
  }

  function parseNativeResponse(raw) {
    const text = String(raw ?? '');
    if (!text) return null;
    try { return JSON.parse(text); } catch (_) { return text; }
  }

  function pathOf(rawUrl) {
    try { return new URL(String(rawUrl || ''), location.href).pathname; }
    catch (_) { return ''; }
  }

  function isBindNativeEndpoint(path) {
    return [API_VALIDATE_DEST, API_VALIDATE, API_SUMMARY, API_BIND].includes(path);
  }

  function recordBindNative(record) {
    trace('UNBIND_NATIVE_API', {
      path: record.path, method: record.method,
      status: record.status, ok: record.ok, ms: record.ms
    });
    // Never replace genuine native opaque IDs with a displayed warehouse code.
    if (!IS_BIND || directTemplate || nativeTemplateCapture
        || record.path !== API_BIND || !record.ok
        || !clean(record.response?.hostName)) return;
    const sourceWarehouseId = clean(record.request?.sourceWarehouseId);
    const destinationWarehouseId = clean(record.request?.destinationWarehouseId);
    const scannableId = normalizeContainer(record.request?.scannableId);
    if (!sourceWarehouseId || !destinationWarehouseId || !scannableId) return;

    nativeTemplateCapture = true;
    void (async () => {
      try {
        const check = await postJson(
          API_VALIDATE_DEST, { destinationWarehouseId },
          TIMEOUT_VALIDATE_MS, 'destination'
        );
        if (clean(check.data).toUpperCase() !== DESTINATION_FC) {
          throw new Error('Native bind destination is not BWU1');
        }
        if (!directTemplate) saveBindTemplate(sourceWarehouseId, destinationWarehouseId);
        // A genuine native bind acknowledgement means this queued tote must not be sent again.
        const item = state.items.find(row =>
          row.id.toLowerCase() === scannableId.toLowerCase() && row.status === 'queued'
        );
        if (item && !state.running) {
          item.status = 'done'; item.phase = 'done'; item.error = ''; item.ms = 0;
          trace('UNBIND_QUEUE_ITEM_DONE', { container: item.id, source: 'native-manual', mode: MODE });
        }
        state.message = 'API READY — verified native setup; press START';
        saveState();
        render();
      } catch (error) {
        trace('UNBIND_TEMPLATE_CAPTURE_FAILED', { reason: clean(error?.message || error) });
      } finally {
        nativeTemplateCapture = false;
      }
    })();
  }

  function installBindNativeTap() {
    try {
      const XHR = window.XMLHttpRequest;
      if (XHR?.prototype && !XHR.prototype.__bwu2HierarchyBindTapV3) {
        const nativeOpen = XHR.prototype.open;
        const nativeSend = XHR.prototype.send;

        XHR.prototype.open = function(method, url) {
          this.__bwu2HierarchyBindTap = {
            method: String(method || 'GET').toUpperCase(),
            url: String(url || ''),
            path: pathOf(url)
          };
          return nativeOpen.apply(this, arguments);
        };

        XHR.prototype.send = function(body) {
          const info = this.__bwu2HierarchyBindTap || {};
          if (!isBindNativeEndpoint(info.path)) return nativeSend.apply(this, arguments);

          const started = performance.now();
          const request = parseNativeBody(body);
          this.addEventListener('loadend', () => {
            let raw = '';
            try {
              if (!this.responseType || this.responseType === 'text') raw = this.responseText || '';
              else if (this.responseType === 'json') raw = JSON.stringify(this.response ?? null);
            } catch (_) {}

            recordBindNative({
              transport: 'xhr',
              method: info.method || 'GET',
              url: info.url || '',
              path: info.path,
              request,
              response: parseNativeResponse(raw),
              status: Number(this.status) || 0,
              ok: Number(this.status) >= 200 && Number(this.status) < 300,
              ms: Math.round(performance.now() - started)
            });
          }, { once: true });

          return nativeSend.apply(this, arguments);
        };

        XHR.prototype.__bwu2HierarchyBindTapV3 = true;
      }
    } catch (error) {
      trace('UNBIND_TAP_ERROR', { transport: 'xhr', error: clean(error?.message || error) });
    }

    try {
      const nativeFetch = window.fetch;
      if (typeof nativeFetch === 'function' && !nativeFetch.__bwu2HierarchyBindTapV3) {
        const wrapped = async function(input, init = {}) {
          const rawUrl = typeof input === 'string' || input instanceof URL
            ? String(input)
            : String(input?.url || '');
          const path = pathOf(rawUrl);
          if (!isBindNativeEndpoint(path)) return nativeFetch.apply(this, arguments);

          const started = performance.now();
          const request = parseNativeBody(init?.body);

          try {
            const response = await nativeFetch.apply(this, arguments);
            let raw = '';
            try { raw = await response.clone().text(); } catch (_) {}

            recordBindNative({
              transport: 'fetch',
              method: String(init?.method || input?.method || 'GET').toUpperCase(),
              url: rawUrl,
              path,
              request,
              response: parseNativeResponse(raw),
              status: Number(response.status) || 0,
              ok: !!response.ok,
              ms: Math.round(performance.now() - started)
            });
            return response;
          } catch (error) {
            recordBindNative({
              transport: 'fetch',
              method: String(init?.method || input?.method || 'GET').toUpperCase(),
              url: rawUrl,
              path,
              request,
              response: null,
              status: 0,
              ok: false,
              ms: Math.round(performance.now() - started),
              error: clean(error?.message || error)
            });
            throw error;
          }
        };

        wrapped.__bwu2HierarchyBindTapV3 = true;
        window.fetch = wrapped;
      }
    } catch (error) {
      trace('UNBIND_TAP_ERROR', { transport: 'fetch', error: clean(error?.message || error) });
    }
  }

  function assertBindValidate(data, container, status = 200) {
    if (!data || typeof data !== 'object') throw new RequestError('Unexpected validation response', { phase: 'validate', status });
    if (clean(data.warehouseId).toUpperCase() !== WAREHOUSE_ID) {
      throw new RequestError(`Container is not validated in ${WAREHOUSE_ID}`, { phase: 'validate', status });
    }
    if (clean(data.scannableId).toLowerCase() !== clean(container).toLowerCase()) {
      throw new RequestError('Validation returned another container', { phase: 'validate', status });
    }
  }

  function assertBindSummary(data, status = 200) {
    if (!data || !Array.isArray(data.transferBindingSummaryList)) {
      throw new RequestError('Unexpected binding summary', { phase: 'summary', status });
    }
  }

  function assertBindMutation(data, status = 200) {
    if (!data || typeof data !== 'object' || !clean(data.hostName)) {
      throw new RequestError('Unexpected bind response — verify container', {
        phase: 'bind',
        status,
        ambiguous: true
      });
    }
  }

  async function verifyBindTemplate() {
    if (!directTemplate) return false;
    if (bindTemplateVerified) return true;
    const response = await postJson(
      API_VALIDATE_DEST,
      { destinationWarehouseId: directTemplate.destinationWarehouseId },
      TIMEOUT_VALIDATE_MS,
      'destination'
    );
    if (clean(response.data).toUpperCase() !== DESTINATION_FC) {
      clearBindTemplate();
      return false;
    }
    destinationToken = directTemplate.destinationWarehouseId;
    bindTemplateVerified = true;
    return true;
  }

  function setItemPhase(item, phase, message) {
    item.phase = phase;
    if (!IS_BIND) state.phase = phase;
    state.message = message;
    saveState();
    render();
  }

  async function processBindDirect(item) {
    const container = item.id;
    const login = bindRunLogin || currentLogin();
    if (!login) throw new RequestError('Logged-in user could not be detected', { phase: 'identity', status: 0 });

    setItemPhase(item, 'validate', `Validating ${container}`);
    const validated = await postJson(
      API_VALIDATE,
      { warehouseId: WAREHOUSE_ID, scannableId: container },
      TIMEOUT_VALIDATE_MS,
      'validate'
    );
    assertBindValidate(validated.data, container, validated.status);

    setItemPhase(item, 'summary', `Checking bindings ${container}`);
    const summary = await postJson(
      API_SUMMARY,
      { warehouseId: WAREHOUSE_ID, scannableId: container },
      TIMEOUT_SUMMARY_MS,
      'summary'
    );
    assertBindSummary(summary.data, summary.status);

    if (!state.running) throw new SafePauseError();

    setItemPhase(item, 'bind', `Binding ${container} → ${DESTINATION_FC}`);
    const template = directTemplate;
    if (!template) throw new RequestError('API template unavailable', { phase: 'destination', status: 0 });
    const bound = await postJson(
      API_BIND,
      {
        sourceWarehouseId: template.sourceWarehouseId,
        destinationWarehouseId: template.destinationWarehouseId,
        scannableId: container,
        employeeLogin: login
      },
      TIMEOUT_MUTATION_MS,
      'bind'
    );
    assertBindMutation(bound.data, bound.status);
  }

  async function ensureBindApiReady() {
    if (!directTemplate) throw new RequestError('API template missing — make one native BWU1 bind', {
      phase: 'destination', status: 0
    });
    if (bindTemplateVerified) return;
    if (!bindTemplateCheck) bindTemplateCheck = verifyBindTemplate();
    let verified;
    try { verified = await bindTemplateCheck; }
    finally { bindTemplateCheck = null; }
    if (!verified || !directTemplate) {
      throw new RequestError('Cached API destination invalid — native setup required', {
        phase: 'destination', status: 0
      });
    }
  }

  async function processBindItem(item) {
    const started = performance.now();
    await ensureBindApiReady();
    if (!state.running) throw new SafePauseError();
    await processBindDirect(item);
    clearSessionRecovery();
    item.status = 'done';
    item.phase = 'done';
    item.error = '';
    item.ambiguous = false;
    item.ms = Math.round(performance.now() - started);
    state.message = `BOUND ${item.id} → ${DESTINATION_FC} (${item.ms}ms)`;
    saveState();
    render();
    trace('UNBIND_QUEUE_ITEM_DONE', {
      container: item.id, destination: DESTINATION_FC, ms: item.ms, mode: MODE
    });
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
    if (lockOwnedByOther()) {
      state.message = 'Queue is active in another tab — scan there';
      render();
      return 0;
    }
    const raw = ui.draft.value.replace(/\r/g, '');
    const lines = raw.split(/[\n,]+/).map(clean).filter(Boolean);
    if (!lines.length) return 0;

    const existing = new Set(state.items.map(item => item.id.toLowerCase()));
    const invalid = [];
    let added = 0;

    for (const line of lines) {
      const id = normalizeContainer(line);
      if (!id) {
        invalid.push(line);
        continue;
      }
      if (existing.has(id.toLowerCase())) continue;
      existing.add(id.toLowerCase());
      state.items.push({ id, status: 'queued', phase: '', error: '', ms: 0 });
      added++;
    }

    if (invalid.length) rememberInvalid(invalid);
    ui.draft.value = '';
    saveDraft('');
    state.message = added
      ? `${added} added${invalid.length ? ` | ${invalid.length} rejected` : ''}`
      : invalid.length ? 'Rejected — tsX/csX containers only' : 'Already in queue';
    saveState();
    render();

    trace('UNBIND_QUEUE_ADD', { added, invalid: invalid.length, running: state.running });
    if (state.running && added) setTimeout(runQueue, 0);
    setTimeout(() => ui.draft?.focus(), 0);
    return added;
  }

  class RequestError extends Error {
    constructor(message, details = {}) {
      super(message);
      this.name = 'RequestError';
      Object.assign(this, details);
    }
  }

  class SafePauseError extends Error {
    constructor(message = 'Paused safely before mutation') {
      super(message);
      this.name = 'SafePauseError';
      this.safePause = true;
    }
  }

  async function postJson(path, body, timeoutMs, phase) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const started = performance.now();

    trace('UNBIND_API_REQUEST', { path, phase });

    try {
      const response = await fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const raw = await response.text();
      let data = raw;
      try { data = raw ? JSON.parse(raw) : null; } catch (_) {}
      const ms = Math.round(performance.now() - started);
      const contentType = clean(response.headers.get('content-type')).toLowerCase();
      const stringResponse = typeof data === 'string';
      const responseSignal = clean(stringResponse ? data.slice(0, 2000) : (JSON.stringify(data) || '').slice(0, 2000));
      const sessionExpired = [401, 403, 419].includes(response.status)
        || response.redirected
        || contentType.includes('text/html')
        || /(?:csrf|token|session).{0,40}(?:expired|invalid|missing)/i.test(responseSignal)
        || (stringResponse && /(?:sign[ -]?in|login)\b/i.test(responseSignal));

      trace('UNBIND_API_RESPONSE', { path, phase, status: response.status, ms, sessionExpired });

      if (sessionExpired) {
        throw new RequestError('SESSION EXPIRED — refresh page, then press START', {
          status: response.status,
          phase,
          sessionExpired: true
        });
      }

      if (!response.ok) {
        throw new RequestError(`HTTP ${response.status}`, {
          status: response.status,
          phase,
          data,
          ambiguous: isMutationPhase(phase)
        });
      }

      return { data, status: response.status, ms };
    } catch (error) {
      if (error instanceof RequestError) throw error;
      const timedOut = error?.name === 'AbortError';
      throw new RequestError(timedOut ? 'Timed out' : (error?.message || 'Network error'), {
        status: 0,
        phase,
        ambiguous: isMutationPhase(phase)
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  function activateNext() {
    const item = nextQueued();
    if (!item) return null;
    item.status = 'active';
    item.phase = 'validate';
    item.error = '';
    item.ms = 0;
    state.currentId = item.id;
    state.phase = 'validate';
    state.message = `Validating ${item.id}`;
    saveState();
    render();
    trace('UNBIND_QUEUE_ITEM_START', { container: item.id, mode: MODE });
    return item;
  }

  function shouldPause(error) {
    const status = Number(error?.status || 0);
    return !!error?.sessionExpired || isMutationPhase(error?.phase) || status === 0 || status === 401 || status === 403 || status === 429 || status >= 500;
  }

  function markAttention(item, error) {
    if (error?.safePause) {
      item.status = 'queued';
      item.phase = '';
      item.error = '';
      item.ms = 0;
      state.currentId = '';
      state.phase = 'idle';
      state.running = false;
      state.message = 'PAUSED SAFELY — current container requeued before mutation';
      releaseLock();
      saveState();
      render();
      trace('UNBIND_QUEUE_SAFE_PAUSE', { container: item.id, mode: MODE });
      return;
    }

    if (error?.sessionExpired) {
      const phase = clean(error.phase);
      const previous = readSessionRecovery();
      const attempts = previous?.resume ? Math.max(1, Number(previous.attempts) || 1) + 1 : 1;
      state.currentId = '';
      state.phase = 'idle';
      state.running = false;
      releaseLock();

      if (isMutationPhase(phase)) {
        item.status = 'attention';
        item.phase = mutationPhase();
        item.error = `Session expired during ${mutationPhase()} — verify container before retrying`;
        saveSessionRecovery({ at: Date.now(), resume: false, ambiguous: true, container: item.id, phase });
        state.message = `SESSION EXPIRED DURING ${mutationPhase().toUpperCase()} — refreshing; verify attention row`;
        saveState();
        render();
        trace('UNBIND_QUEUE_SESSION_EXPIRED', { container: item.id, phase, autoRefresh: true, resume: false, mode: MODE });
        queueMicrotask(() => location.reload());
        return;
      }

      item.status = 'queued';
      item.phase = '';
      item.error = '';
      item.ms = 0;

      if (attempts > SESSION_RECOVERY_MAX_ATTEMPTS) {
        clearSessionRecovery();
        state.message = 'SESSION STILL EXPIRED — queue preserved; sign in again if required';
        saveState();
        render();
        trace('UNBIND_QUEUE_SESSION_EXPIRED', { container: item.id, phase, autoRefresh: false, attempts, mode: MODE });
        return;
      }

      saveSessionRecovery({ at: Date.now(), resume: true, attempts, container: item.id, phase });
      state.message = `SESSION EXPIRED — refreshing automatically (${attempts}/${SESSION_RECOVERY_MAX_ATTEMPTS})`;
      saveState();
      render();
      trace('UNBIND_QUEUE_SESSION_EXPIRED', { container: item.id, phase, autoRefresh: true, resume: true, attempts, mode: MODE });
      queueMicrotask(() => location.reload());
      return;
    }

    if (readSessionRecovery()?.resume) clearSessionRecovery();

    item.status = 'attention';
    item.phase = clean(error?.phase || state.phase);
    item.error = clean(error?.message || 'Needs attention');
    state.currentId = '';
    state.phase = 'idle';

    const pause = shouldPause(error);
    if (pause) {
      state.running = false;
      state.message = `PAUSED — ${item.id}: ${item.error}`;
      releaseLock();
    } else {
      state.message = `Skipped ${item.id}: ${item.error}`;
    }

    saveState();
    render();
    trace('UNBIND_QUEUE_ATTENTION', {
      container: item.id,
      phase: item.phase,
      reason: item.error,
      paused: pause,
      ambiguous: !!error?.ambiguous,
      mode: MODE
    });
  }

  async function processUnbindItem(item) {
    const login = currentLogin();
    if (!login) throw new RequestError('Logged-in user could not be detected', { phase: 'identity', status: 0 });
    const started = performance.now();
    const timeouts = { validate: TIMEOUT_VALIDATE_MS, summary: TIMEOUT_SUMMARY_MS, unbind: TIMEOUT_MUTATION_MS };
    const messages = {
      validate: `Validating ${item.id}`,
      summary: `Checking bindings ${item.id}`,
      unbind: `Unbinding ${item.id}`
    };

    await ACTIONS.runUnbind({
      container: item.id,
      login,
      warehouseId: WAREHOUSE_ID,
      endpoints: { validate: API_VALIDATE, summary: API_SUMMARY, unbind: API_UNBIND },
      onPhase: phase => {
        if (phase === 'unbind' && !state.running) throw new SafePauseError();
        state.phase = item.phase = phase;
        state.message = messages[phase] || phase;
        saveState();
        render();
      },
      request: ({ phase, url, body }) => postJson(url, body, timeouts[phase], phase)
    });

    clearSessionRecovery();
    item.status = 'done';
    item.phase = 'done';
    item.error = '';
    item.ms = Math.round(performance.now() - started);
    state.currentId = '';
    state.phase = 'idle';
    state.message = `DONE ${item.id} (${item.ms}ms) — scan next`;
    saveState();
    render();
    trace('UNBIND_QUEUE_ITEM_DONE', { container: item.id, ms: item.ms, mode: MODE });
  }

  async function processItem(item) {
    if (IS_BIND) return processBindItem(item);
    return processUnbindItem(item);
  }

  function markBindAttention(item, error) {
    if (error?.safePause) {
      item.status = 'queued'; item.phase = ''; item.error = ''; item.ambiguous = false;
      saveState(); render(); return;
    }
    item.status = 'attention';
    const phase = clean(error?.phase || item.phase);
    item.phase = phase;
    item.ambiguous = !!error?.ambiguous || phase === 'bind';
    item.error = `${item.ambiguous ? 'UNKNOWN — verify before retrying: ' : ''}${clean(error?.message || 'Needs attention')}`;
    state.running = false;
    state.message = `PAUSED — ${item.id}: ${item.error}`;
    saveState(); render();
    trace('UNBIND_QUEUE_ATTENTION', {
      container: item.id, phase, reason: item.error,
      ambiguous: item.ambiguous, paused: true, mode: MODE
    });
  }

  function scheduleBindQueue() {
    if (!state.running) return;
    // Do not dispatch another API mutation under an expired or changed FCR login.
    if (!manualBindLogin && bindRunLogin && detectedLogin() !== bindRunLogin) {
      pauseQueue('Identity changed / expired — verify login before resuming');
      return;
    }
    if (lockOwnedByOther()) {
      state.running = false;
      state.message = 'Another tab owns the Hierarchy queue';
      saveState(); render();
      return;
    }
    renewLock();
    while (state.running && bindActive.size < BIND_CONCURRENCY) {
      const item = nextQueued();
      if (!item) break;
      const key = item.id.toLowerCase();
      if (bindActive.has(key)) break;
      bindActive.add(key);
      item.status = 'active';
      item.phase = 'validate'; item.error = ''; item.ambiguous = false; item.ms = 0;
      saveState();
      trace('UNBIND_QUEUE_ITEM_START', { container: item.id, mode: MODE, api: true });
      void processBindItem(item)
        .catch(error => markBindAttention(item, error))
        .finally(() => {
          bindActive.delete(key);
          if (!state.running && bindActive.size === 0) releaseLock();
          if (state.running) scheduleBindQueue();
          else render();
        });
    }
    if (!nextQueued() && bindActive.size === 0) {
      state.message = `RUNNING — scan next tsX/csX → ${DESTINATION_FC}`;
      saveState();
    }
    render();
  }

  async function runQueue() {
    if (IS_BIND) { scheduleBindQueue(); return; }
    if (!state.running || processing) return;
    if (lockOwnedByOther()) {
      state.message = 'Queue is active in another tab';
      render();
      return;
    }
    renewLock();
    const item = itemFor() || activateNext();
    if (!item) {
      state.message = 'RUNNING — scan next tsX/csX';
      saveState(); render(); ui.draft?.focus(); return;
    }
    processing = true;
    try { await processItem(item); }
    catch (error) { markAttention(item, error); }
    finally {
      processing = false;
      if (!state.running) releaseLock();
      render();
    }
    if (state.running) setTimeout(runQueue, NEXT_GAP_MS);
  }

  function resumeAfterSessionReload() {
    if (IS_BIND) return; // Manual identity and uncertain parallel writes must never auto-resume.
    const recovery = readSessionRecovery();
    if (!recovery) return;

    if (!recovery.resume) {
      clearSessionRecovery();
      state.message = 'Session refreshed — verify attention row before retrying';
      saveState();
      render();
      return;
    }

    const login = refreshDetectedLogin();
    if (!login) {
      clearSessionRecovery();
      state.message = 'Session refreshed — logged-in user could not be detected';
      saveState();
      render();
      return;
    }

    if (!acquireLock()) {
      state.message = 'Session refreshed — another tab owns the Hierarchy queue';
      saveState();
      render();
      return;
    }

    state.running = true;
    state.message = 'SESSION REFRESHED — resuming queue';
    saveState();
    render();
    trace('UNBIND_QUEUE_SESSION_RESUME', {
      container: clean(recovery.container),
      phase: clean(recovery.phase),
      attempts: Number(recovery.attempts) || 1
    });
    queueMicrotask(runQueue);
  }

  function startQueue() {
    if (state.running || processing || (IS_BIND && bindActive.size)) return;
    requestSharedLogin();
    const login = refreshDetectedLogin();
    if (!login) {
      state.message = IS_BIND
        ? 'Enter your employee login above before START'
        : 'Logged-in user could not be detected — refresh/sign in';
      saveState();
      render();
      return;
    }

    state.items = state.items.filter(item => item.status !== 'done');
    state.invalid = [];
    addDraftToQueue();
    if (IS_BIND && !directTemplate) {
      state.message = 'API SETUP REQUIRED — make ONE native BWU1 bind; script will capture identifiers';
      saveState(); render(); return;
    }
    if (!acquireLock()) {
      state.message = 'Another tab already owns the Hierarchy queue';
      saveState();
      render();
      return;
    }

    const queued = counts().queued;
    if (IS_BIND) bindRunLogin = login; // freeze identity for in-flight API jobs
    state.running = true;
    state.message = queued
      ? `RUNNING — ${queued} queued${IS_BIND ? ` → ${DESTINATION_FC}` : ''}`
      : `RUNNING — scan next tsX/csX${IS_BIND ? ` → ${DESTINATION_FC}` : ''}`;
    saveState();
    trace('UNBIND_QUEUE_START', {
      queued,
      warehouseId: WAREHOUSE_ID,
      destination: IS_BIND ? DESTINATION_FC : '',
      mode: MODE
    });
    render();
    setTimeout(runQueue, 0);
  }

  function pauseQueue(reason = 'Paused safely') {
    state.running = false;
    if (IS_BIND && bindActive.size) {
      state.message = `${reason} — ${bindActive.size} in-flight API operation(s) settling; no new binds`;
    } else if (processing && isMutationPhase(state.phase)) {
      state.message = `${reason} — current ${mutationPhase()} will finish; no next container`;
    } else if (processing) {
      state.message = `${reason} — current check will finish; mutation blocked`;
    } else {
      state.message = reason;
    }
    saveState();
    if (!processing && !(IS_BIND && bindActive.size)) releaseLock();
    trace('UNBIND_QUEUE_PAUSE', { reason, currentId: state.currentId, phase: state.phase, mode: MODE });
    render();
  }

  function clearQueue() {
    if (processing || (IS_BIND && bindActive.size)) return;
    const hasDraft = !!clean(ui.draft?.value || '');
    if (!state.items.length && !hasDraft) {
      state.message = 'Queue is already clear';
      saveState();
      render();
      return;
    }
    const wasRunning = state.running;
    state.running = false;
    releaseLock();
    state = defaultState();
    clearSessionRecovery();
    saveState();
    if (ui.draft) ui.draft.value = '';
    saveDraft('');
    trace('UNBIND_QUEUE_CLEAR', { wasRunning, mode: MODE });
    render();
  }

  function retryAttention() {
    if (state.running || processing || (IS_BIND && bindActive.size)) return;
    const attention = state.items.filter(item => item.status === 'attention');
    if (!attention.length) return;
    if (IS_BIND) {
      const safe = attention.filter(item => !item.ambiguous && item.phase !== 'bind');
      if (!safe.length) {
        state.message = 'UNKNOWN binds require manual verification — not automatically requeued';
        saveState(); render(); return;
      }
      for (const item of safe) {
        item.status = 'queued'; item.phase = ''; item.error = ''; item.ambiguous = false;
      }
      state.message = `${safe.length} safe failure(s) requeued; ${attention.length - safe.length} uncertain retained`;
      saveState(); render(); return;
    }
    for (const item of attention) {
      item.status = 'queued';
      item.phase = '';
      item.error = '';
    }
    state.message = `${attention.length} attention row(s) requeued`;
    saveState();
    render();
  }

  function element(tag, text, css = '') {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (css) node.style.cssText = css;
    return node;
  }

  function makeButton(text, action, css = '') {
    const button = element('button', text,
      `padding:6px 9px;border:1px solid #64748b;border-radius:5px;background:#fff;color:#111827;font-weight:900;cursor:pointer;${css}`
    );
    button.type = 'button';
    button.addEventListener('click', action);
    return button;
  }

  function setMinimized(value) {
    minimized = !!value;
    saveMinimized();
    render();
    schedulePosition();
    if (!minimized) setTimeout(() => ui.draft?.focus(), 0);
  }

  function parseColor(value) {
    const match = String(value || '').match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/i);
    if (!match) return null;
    return {
      r: Number(match[1]),
      g: Number(match[2]),
      b: Number(match[3]),
      a: match[4] == null ? 1 : Number(match[4])
    };
  }

  function isLightColor(color) {
    return !!color && color.a > 0.05 && color.r >= 205 && color.g >= 205 && color.b >= 205;
  }

  function effectiveColorAt(x, y) {
    let node = document.elementFromPoint(x, y);
    while (node && node !== document.documentElement) {
      const color = parseColor(getComputedStyle(node).backgroundColor);
      if (color?.a > 0.05) return color;
      node = node.parentElement;
    }
    return parseColor(getComputedStyle(document.documentElement).backgroundColor);
  }

  function findScanHeading() {
    return [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].find(node =>
      clean(node.textContent).toLowerCase() === 'scan container' &&
      node.getClientRects().length &&
      getComputedStyle(node).visibility !== 'hidden'
    ) || null;
  }

  function findScanAreaBottom() {
    const heading = findScanHeading();
    if (!heading) return 0;
    const headingRect = heading.getBoundingClientRect();

    for (let node = heading.parentElement; node && node !== document.body; node = node.parentElement) {
      const rect = node.getBoundingClientRect();
      const color = parseColor(getComputedStyle(node).backgroundColor);
      if (
        rect.width >= window.innerWidth * 0.55 &&
        rect.height >= 80 && rect.height <= 520 &&
        rect.bottom >= headingRect.bottom + 28 &&
        rect.bottom <= window.innerHeight + 2 &&
        isLightColor(color)
      ) return rect.bottom;
    }

    const panelVisibility = ui.panel?.style.visibility || '';
    const miniVisibility = ui.mini?.style.visibility || '';
    if (ui.panel) ui.panel.style.visibility = 'hidden';
    if (ui.mini) ui.mini.style.visibility = 'hidden';

    let boundary = 0;
    try {
      const x = Math.max(8, Math.min(window.innerWidth - 8, Math.round(window.innerWidth / 2)));
      let sawLight = false;
      let darkStart = 0;
      for (let y = Math.max(0, Math.round(headingRect.bottom + 4)); y < window.innerHeight - 4; y += 4) {
        if (isLightColor(effectiveColorAt(x, y))) {
          sawLight = true;
          darkStart = 0;
        } else if (sawLight) {
          if (!darkStart) darkStart = y;
          if (y - darkStart >= 12) {
            boundary = darkStart;
            break;
          }
        }
      }
    } finally {
      if (ui.panel) ui.panel.style.visibility = panelVisibility;
      if (ui.mini) ui.mini.style.visibility = miniVisibility;
    }

    return boundary || Math.round(headingRect.bottom + 90);
  }

  function positionUi() {
    positionFrame = 0;
    const bottom = findScanAreaBottom();
    if (bottom > 0) lastAnchorTop = Math.max(8, Math.round(bottom + 8));
    const top = Math.min(lastAnchorTop, Math.max(8, window.innerHeight - 46));
    if (ui.panel) {
      ui.panel.style.top = `${top}px`;
      ui.panel.style.maxHeight = `${Math.max(180, window.innerHeight - top - 10)}px`;
    }
    if (ui.mini) ui.mini.style.top = `${top}px`;
  }

  function schedulePosition() {
    if (positionFrame) return;
    positionFrame = requestAnimationFrame(positionUi);
  }

  function isolateTextField(field, onEnter) {
    const blockNativeHotkeys = event => {
      // The native hierarchy pages may treat printable keys as global menu shortcuts
      // (notably T = TextBox and S = Sign Out). Scanner input belongs only to
      // our focused field and must never bubble into those handlers.
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (event.type !== 'keydown' || event.key !== 'Enter' || event.shiftKey) return;
      if (typeof onEnter === 'function') onEnter(event);
    };

    field.addEventListener('keydown', blockNativeHotkeys);
    field.addEventListener('keypress', blockNativeHotkeys);
    field.addEventListener('keyup', blockNativeHotkeys);
  }

  function renderItems() {
    if (!ui.items) return;
    ui.items.replaceChildren();
    const shown = state.items.slice(-80);
    for (const item of shown) {
      const row = element('div', null,
        'display:grid;grid-template-columns:86px 1fr auto;gap:6px;align-items:center;padding:5px 6px;border-top:1px solid #e2e8f0;font:11px Consolas,monospace'
      );
      const styles = {
        queued: ['QUEUED', '#475569', '#f1f5f9'],
        active: [`${clean(item.phase || 'ACTIVE').toUpperCase()}`, '#1d4ed8', '#dbeafe'],
        done: [IS_BIND ? 'BOUND' : 'DONE', '#166534', '#dcfce7'],
        attention: ['ATTENTION', '#9a3412', '#ffedd5']
      };
      const [label, color, background] = styles[item.status] || styles.queued;
      row.style.background = item.status === 'attention'
        ? 'repeating-linear-gradient(135deg,#fff7ed,#fff7ed 7px,#ffedd5 7px,#ffedd5 14px)'
        : background;

      const badge = element('strong', label, `color:${color}`);
      const id = element('span', item.id, 'font-weight:800;color:#111827');
      const detail = element('span', item.error || (item.ms ? `${item.ms}ms` : ''),
        `color:${item.status === 'attention' ? '#9a3412' : '#475569'};text-align:right;max-width:180px;overflow:hidden;text-overflow:ellipsis`
      );
      detail.title = item.error || '';
      row.append(badge, id, detail);
      ui.items.appendChild(row);
    }
  }

  function renderInvalid() {
    if (!ui.invalid) return;
    if (!state.invalid.length) {
      ui.invalid.style.display = 'none';
      ui.invalid.textContent = '';
      return;
    }
    ui.invalid.style.display = 'block';
    ui.invalid.textContent = `REJECTED — tsX/csX only (${state.invalid.length})\n${state.invalid.join('\n')}`;
  }

  function render() {
    if (!ui.panel) return;
    const summary = counts();
    ui.version.textContent = `HIERARCHY · ${IS_BIND ? 'BIND' : 'UNBIND'} v${VERSION}`;
    ui.mode.textContent = state.running ? 'RUNNING' : 'PAUSED';
    ui.mode.style.background = state.running ? '#1d4ed8' : '#475569';
    ui.status.textContent = state.message;
    ui.counts.textContent =
      `${summary.queued} queued  •  ${summary.active} active  •  ${summary.done} done  •  ${summary.attention} attention`;
    if (IS_BIND) {
      ui.login.disabled = state.running || bindActive.size > 0;
      ui.apiState.textContent = directTemplate
        ? (bindTemplateVerified ? 'API READY · BWU2 → BWU1' : 'API SAVED · verifying BWU1 on START')
        : 'API SETUP REQUIRED · perform one native BWU1 bind';
      ui.apiState.style.color = directTemplate ? '#166534' : '#9a3412';
    }
    ui.start.textContent = state.running ? 'RUNNING' : 'START';
    ui.start.disabled = state.running || processing || (IS_BIND && bindActive.size > 0);
    ui.start.style.opacity = ui.start.disabled ? '0.55' : '1';
    ui.pause.disabled = !state.running;
    ui.pause.style.opacity = ui.pause.disabled ? '0.55' : '1';
    ui.clear.disabled = processing || (IS_BIND && bindActive.size > 0);
    ui.retry.disabled = state.running || processing || (IS_BIND && bindActive.size > 0) || !summary.attention;
    ui.panel.style.display = minimized ? 'none' : 'block';
    ui.mini.style.display = minimized ? 'flex' : 'none';
    ui.mini.title = processing
      ? state.message
      : state.running ? `${IS_BIND ? 'Bind' : 'Unbind'} Queue running — ${summary.queued} queued` : `Open ${IS_BIND ? 'Bind' : 'Unbind'} Queue`;
    ui.miniRing.style.animation = (processing || (IS_BIND && bindActive.size > 0)) ? 'bwu2-hierarchy-spin .75s linear infinite' : 'none';
    ui.miniRing.style.borderColor = summary.attention
      ? '#fdba74'
      : state.running ? '#93c5fd' : '#94a3b8';
    ui.miniRing.style.borderTopColor = summary.attention
      ? '#c2410c'
      : state.running ? '#1d4ed8' : '#475569';
    if (!minimized) {
      renderItems();
      renderInvalid();
    }
    schedulePosition();
  }

  function mount() {
    if (ui.panel || !document.body) return;

    const style = element('style');
    style.textContent = '@keyframes bwu2-hierarchy-spin{to{transform:rotate(360deg)}}';
    document.head?.appendChild(style);

    ui.panel = element('section', null, [
      'position:fixed', 'top:10px', 'right:10px', 'z-index:2147483647', 'width:470px',
      'max-width:calc(100vw - 20px)', 'overflow:auto', 'border:3px solid #1e3a8a', 'border-radius:9px',
      'background:#fff', 'color:#111827', 'box-shadow:0 10px 30px #0005', 'font:12px Arial,sans-serif'
    ].join(';'));
    ui.panel.id = 'bwu2-hierarchy-queue';
    ACTIONS.markUi(ui.panel);

    ui.mini = element('button', null, [
      'display:none', 'position:fixed', 'top:10px', 'right:10px', 'z-index:2147483647',
      'width:42px', 'height:36px', 'align-items:center', 'justify-content:center',
      'border:2px solid #1e3a8a', 'border-radius:9px', 'background:#0f172a',
      'box-shadow:0 6px 18px #0005', 'cursor:pointer'
    ].join(';'));
    ui.mini.type = 'button';
    ui.mini.setAttribute('aria-label', `Open ${IS_BIND ? 'Bind' : 'Unbind'} Queue`);
    ACTIONS.markUi(ui.mini);
    ui.miniRing = element('span', null,
      'box-sizing:border-box;width:17px;height:17px;border:3px solid #94a3b8;border-top-color:#475569;border-radius:50%'
    );
    ui.mini.appendChild(ui.miniRing);
    ui.mini.addEventListener('click', () => setMinimized(false));

    const header = element('div', null,
      'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;background:#0f172a;color:#fff'
    );
    ui.version = element('strong', `HIERARCHY · ${IS_BIND ? 'BIND' : 'UNBIND'} v${VERSION}`, 'font-size:14px');
    const headerActions = element('div', null, 'display:flex;align-items:center;gap:6px');
    ui.mode = element('strong', 'PAUSED',
      'padding:3px 7px;border-radius:999px;background:#475569;color:#fff;font-size:10px;letter-spacing:.4px'
    );
    ui.minimize = makeButton('—', () => setMinimized(true),
      'padding:1px 7px;border-color:#64748b;background:#1e293b;color:#fff;font-size:14px;line-height:16px'
    );
    ui.minimize.title = 'Minimize';
    ui.minimize.setAttribute('aria-label', `Minimize ${IS_BIND ? 'Bind' : 'Unbind'} Queue`);
    headerActions.append(ui.mode, ui.minimize);
    header.append(ui.version, headerActions);

    const body = element('div', null, 'padding:9px');
    const loginRow = element('div', null,
      'display:grid;grid-template-columns:auto 1fr auto;gap:6px;align-items:center;margin-bottom:7px'
    );
    loginRow.appendChild(element('strong', 'Login'));
    ui.login = IS_BIND
      ? element('input', null,
        'min-width:0;width:100%;box-sizing:border-box;padding:6px;border:1px solid #94a3b8;border-radius:5px;background:#f8fafc;font:12px Consolas,monospace;color:#0f172a'
      )
      : element('strong', 'Detecting…',
        'min-width:0;padding:6px;border:1px solid #94a3b8;border-radius:5px;background:#f8fafc;font:12px Consolas,monospace;color:#0f172a'
      );
    if (IS_BIND) {
      ui.login.type = 'text';
      ui.login.autocomplete = 'off';
      ui.login.autocapitalize = 'off';
      ui.login.spellcheck = false;
      ui.login.maxLength = 32;
      ui.login.setAttribute('aria-label', 'Employee login (editable)');
      ui.login.title = 'Type your login if auto-detection fails. Not saved on shared computers.';
      ui.login.addEventListener('input', () => {
        manualBindLogin = true;
        refreshDetectedLogin();
        if (!state.running && ACTIONS.normalizeLogin(ui.login.value)
            && /logged-in user could not be detected/i.test(state.message)) {
          state.message = 'Login entered — press START';
          saveState();
          render();
        }
      });
      isolateTextField(ui.login);
    }
    refreshDetectedLogin();
    loginRow.append(ui.login, element('strong', IS_BIND ? `${WAREHOUSE_ID} → ${DESTINATION_FC} 🔒` : WAREHOUSE_ID,
      'padding:4px 7px;border-radius:4px;background:#e2e8f0;color:#334155'
    ));

    ui.identitySource = element('div', '', 'margin:-2px 0 7px 0;font:10px Arial,sans-serif;font-weight:800');
    ui.apiState = element('div', '', 'margin-bottom:6px;font:11px Arial,sans-serif;font-weight:900');
    ui.draft = element('textarea');
    ui.draft.value = savedDraft();
    ui.draft.placeholder = 'Scan or paste tsX/csX containers — one per line';
    ui.draft.rows = 4;
    ui.draft.spellcheck = false;
    ui.draft.style.cssText = 'box-sizing:border-box;width:100%;resize:vertical;padding:7px;border:2px solid #64748b;border-radius:6px;font:13px Consolas,monospace';
    ui.draft.addEventListener('input', () => saveDraft(ui.draft.value));
    isolateTextField(ui.draft, event => {
      // Paused: Enter remains a normal textarea newline so the operator can
      // scan a whole batch before pressing START once.
      // Running: scanner Enter submits the current line immediately and the
      // queue continues in native Endless style.
      if (!state.running) {
        setTimeout(() => saveDraft(ui.draft?.value || ''), 0);
        return;
      }
      event.preventDefault();
      addDraftToQueue();
    });

    const primary = element('div', null, 'display:flex;gap:5px;margin-top:6px');
    ui.start = makeButton('START', startQueue, 'flex:2;background:#1d4ed8;color:#fff;border-color:#1d4ed8');
    ui.pause = makeButton('PAUSE', () => pauseQueue('Paused safely'), 'flex:1;background:#f59e0b;color:#111827;border-color:#d97706');
    primary.append(ui.start, ui.pause);

    ui.status = element('div', 'Ready',
      'margin-top:7px;padding:7px;border-radius:5px;background:#eff6ff;color:#1e3a8a;font-weight:900'
    );
    ui.counts = element('div', '', 'margin:6px 0;color:#475569;font-weight:800');
    ui.invalid = element('pre', '',
      'display:none;max-height:75px;overflow:auto;margin:6px 0;padding:6px;border:1px solid #fb923c;border-radius:5px;background:#fff7ed;color:#9a3412;white-space:pre-wrap;font:10px Consolas,monospace'
    );
    ui.items = element('div', null,
      'max-height:37vh;overflow:auto;border:1px solid #cbd5e1;border-radius:5px;background:#fff'
    );

    const secondary = element('div', null, 'display:flex;gap:5px;margin-top:7px');
    ui.retry = makeButton('REQUEUE ATTENTION', retryAttention, 'flex:1;font-size:10px');
    ui.clear = makeButton('CLEAR', clearQueue, 'flex:1;font-size:10px');
    secondary.append(ui.retry, ui.clear);

    body.append(loginRow, ...(IS_BIND ? [ui.identitySource, ui.apiState] : []), ui.draft, primary, ui.status, ui.counts, ui.invalid, ui.items, secondary);
    ui.panel.append(header, body);
    document.body.append(ui.panel, ui.mini);

    const observer = new MutationObserver(records => {
      const nativeChange = records.some(record =>
        !ui.panel.contains(record.target) && !ui.mini.contains(record.target)
      );
      if (nativeChange) schedulePosition();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedulePosition, { passive: true });

    if (IS_BIND) {
      state.message = directTemplate
        ? 'API template cached — verify destination on START'
        : 'API SETUP REQUIRED — make one native BWU1 bind to capture identifiers';
      saveState();
    }
    render();
    positionUi();
    requestSharedLogin();
    if (!minimized) setTimeout(() => ui.draft.focus(), 0);
    queueMicrotask(resumeAfterSessionReload);
  }

  window.addEventListener('storage', event => {
    if (event.key !== STATE_KEY || processing) return;
    state = loadState();
    render();
  });

  window.addEventListener('beforeunload', releaseLock);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
