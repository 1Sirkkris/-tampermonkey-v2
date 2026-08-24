// ==UserScript==
// @name         Unbind Hierarchy Queue v1.0.1
// @namespace    BWU2
// @version      1.0.1
// @description  BWU2 Endless-style sequential tsX hierarchy unbind queue using the proven native backend flow.
// @match        https://tx-b-hierarchy-nrt.nrt.proxy.amazon.com/unbindHierarchy*
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Unbind_Hierarchy_Queue.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Unbind_Hierarchy_Queue.user.js
// ==/UserScript==

(() => {
  'use strict';

  if (window.__bwu2UnbindHierarchyQueue) return;
  window.__bwu2UnbindHierarchyQueue = true;

  const VERSION = '1.0.1';
  const WAREHOUSE_ID = 'BWU2';
  const API_VALIDATE = '/validateContainer';
  const API_SUMMARY = '/getTransshipmentBindingSummary';
  const API_UNBIND = '/unbindContainer';
  const TIMEOUT_VALIDATE_MS = 12000;
  const TIMEOUT_SUMMARY_MS = 12000;
  const TIMEOUT_UNBIND_MS = 20000;
  const NEXT_GAP_MS = 180;
  const STATE_KEY = 'bwu2.unbindQueue.state.v1';
  const LOGIN_KEY = 'bwu2.unbindQueue.employeeLogin.v1';
  const DRAFT_KEY = 'bwu2.unbindQueue.draft.v1';
  const LOCK_KEY = 'bwu2.unbindQueue.lock.v1';
  const TAB_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const LOGIN_PATTERN = /^[a-z][a-z0-9-]{2,31}$/i;
  const CONTAINER_PATTERN = /^tsX[A-Za-z0-9]+$/i;

  let processing = false;
  let lockTimer = 0;
  let state = loadState();
  const ui = {};

  function clean(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function normalizeContainer(value) {
    const id = clean(value);
    return CONTAINER_PATTERN.test(id) ? id : '';
  }

  function normalizeLogin(value) {
    const login = clean(value).toLowerCase();
    return LOGIN_PATTERN.test(login) ? login : '';
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
            ms: Math.max(0, Number(item.ms) || 0)
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

  function trace(event, data = {}) {
    try {
      if (typeof window.BWU2Trace === 'function') window.BWU2Trace(event, data);
      else window.postMessage({ __BWU2_TRACE__: true, type: event, data }, '*');
    } catch (_) {}
  }

  function itemFor(id = state.currentId) {
    const key = clean(id).toLowerCase();
    return state.items.find(item => item.id.toLowerCase() === key) || null;
  }

  function nextQueued() {
    return state.items.find(item => item.status === 'queued') || null;
  }

  function counts() {
    const result = { total: state.items.length, queued: 0, active: 0, done: 0, attention: 0 };
    for (const item of state.items) {
      if (Object.prototype.hasOwnProperty.call(result, item.status)) result[item.status]++;
    }
    return result;
  }

  function recoverAfterReload() {
    const active = state.items.find(item => item.status === 'active');
    if (active) {
      active.status = 'attention';
      active.error = state.phase === 'unbind'
        ? 'Page refreshed during unbind — verify before retrying'
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

  function findLoginInObject(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 3) return '';
    const preferred = ['employeeLogin', 'userLogin', 'username', 'login', 'alias'];
    for (const key of preferred) {
      const found = normalizeLogin(value[key]);
      if (found) return found;
    }
    for (const [key, child] of Object.entries(value).slice(0, 40)) {
      if (/(?:token|secret|cookie|auth|csrf|session)/i.test(key)) continue;
      const found = findLoginInObject(child, depth + 1);
      if (found) return found;
    }
    return '';
  }

  function discoverLogin() {
    try {
      const stored = normalizeLogin(localStorage.getItem(LOGIN_KEY));
      if (stored) return stored;
    } catch (_) {}

    const globals = [
      window.employeeLogin,
      window.userLogin,
      window.currentUser,
      window.user,
      window.employee,
      window.bootstrapData,
      window.__INITIAL_STATE__
    ];
    for (const value of globals) {
      const found = typeof value === 'string' ? normalizeLogin(value) : findLoginInObject(value);
      if (found) return found;
    }

    const selectors = [
      '[data-employee-login]', '[data-user-login]', '[data-username]',
      'input[name="employeeLogin"]', 'input[name="userLogin"]',
      'meta[name="employeeLogin"]', 'meta[name="username"]'
    ];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (!element) continue;
      const found = normalizeLogin(
        element.dataset?.employeeLogin ||
        element.dataset?.userLogin ||
        element.dataset?.username ||
        element.value ||
        element.content
      );
      if (found) return found;
    }

    for (const storage of [localStorage, sessionStorage]) {
      try {
        for (let index = 0; index < storage.length; index++) {
          const key = storage.key(index) || '';
          if (!/(?:employee.*login|user.*login|username|alias)/i.test(key)) continue;
          if (/(?:token|secret|cookie|auth|csrf|session)/i.test(key)) continue;
          const raw = storage.getItem(key);
          let found = normalizeLogin(raw);
          if (!found) {
            try { found = findLoginInObject(JSON.parse(raw)); } catch (_) {}
          }
          if (found) return found;
        }
      } catch (_) {}
    }

    return '';
  }

  function currentLogin() {
    return normalizeLogin(ui.login?.value || discoverLogin());
  }

  function saveLogin() {
    const login = currentLogin();
    if (!login) return '';
    try { localStorage.setItem(LOGIN_KEY, login); } catch (_) {}
    if (ui.login) ui.login.value = login;
    return login;
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
      : invalid.length ? 'Rejected — tsX containers only' : 'Already in queue';
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

      trace('UNBIND_API_RESPONSE', { path, phase, status: response.status, ms });

      if (!response.ok) {
        throw new RequestError(`HTTP ${response.status}`, {
          status: response.status,
          phase,
          data,
          ambiguous: phase === 'unbind'
        });
      }

      return { data, status: response.status, ms };
    } catch (error) {
      if (error instanceof RequestError) throw error;
      const timedOut = error?.name === 'AbortError';
      throw new RequestError(timedOut ? 'Timed out' : (error?.message || 'Network error'), {
        status: 0,
        phase,
        ambiguous: phase === 'unbind'
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  function assertValidate(data, id) {
    if (!data || typeof data !== 'object') {
      throw new RequestError('Unexpected validation response', { phase: 'validate' });
    }
    if (data.scannableId && clean(data.scannableId).toLowerCase() !== id.toLowerCase()) {
      throw new RequestError('Validation returned a different container', { phase: 'validate' });
    }
  }

  function assertSummary(data) {
    if (!data || !Array.isArray(data.transferBindingSummaryList)) {
      throw new RequestError('Unexpected binding-summary response', { phase: 'summary' });
    }
  }

  function assertUnbind(data) {
    if (!data || typeof data.hostName !== 'string' || !clean(data.hostName)) {
      throw new RequestError('Unexpected unbind response — verify container', {
        phase: 'unbind',
        ambiguous: true
      });
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
    trace('UNBIND_QUEUE_ITEM_START', { container: item.id });
    return item;
  }

  function shouldPause(error) {
    const status = Number(error?.status || 0);
    return error?.phase === 'unbind' || status === 0 || status === 401 || status === 403 || status === 429 || status >= 500;
  }

  function markAttention(item, error) {
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
      ambiguous: !!error?.ambiguous
    });
  }

  async function processItem(item) {
    const login = currentLogin();
    const started = performance.now();

    state.phase = item.phase = 'validate';
    state.message = `Validating ${item.id}`;
    saveState();
    render();
    const validated = await postJson(
      API_VALIDATE,
      { warehouseId: WAREHOUSE_ID, scannableId: item.id },
      TIMEOUT_VALIDATE_MS,
      'validate'
    );
    assertValidate(validated.data, item.id);

    state.phase = item.phase = 'summary';
    state.message = `Checking bindings ${item.id}`;
    saveState();
    render();
    const summary = await postJson(
      API_SUMMARY,
      { warehouseId: WAREHOUSE_ID, scannableId: item.id },
      TIMEOUT_SUMMARY_MS,
      'summary'
    );
    assertSummary(summary.data);

    state.phase = item.phase = 'unbind';
    state.message = `Unbinding ${item.id}`;
    saveState();
    render();
    const unbound = await postJson(
      API_UNBIND,
      { sourceWarehouseId: WAREHOUSE_ID, scannableId: item.id, employeeLogin: login },
      TIMEOUT_UNBIND_MS,
      'unbind'
    );
    assertUnbind(unbound.data);

    item.status = 'done';
    item.phase = 'done';
    item.error = '';
    item.ms = Math.round(performance.now() - started);
    state.currentId = '';
    state.phase = 'idle';
    state.message = `DONE ${item.id} (${item.ms}ms) — scan next`;
    saveState();
    render();
    trace('UNBIND_QUEUE_ITEM_DONE', { container: item.id, ms: item.ms });
  }

  async function runQueue() {
    if (!state.running || processing) return;
    if (lockOwnedByOther()) {
      state.message = 'Queue is active in another tab';
      render();
      return;
    }
    renewLock();

    const item = itemFor() || activateNext();
    if (!item) {
      state.message = 'ARMED — scan next tsX';
      saveState();
      render();
      ui.draft?.focus();
      return;
    }

    processing = true;
    try {
      await processItem(item);
    } catch (error) {
      markAttention(item, error);
    } finally {
      processing = false;
      if (!state.running) releaseLock();
      render();
    }

    if (state.running) setTimeout(runQueue, NEXT_GAP_MS);
  }

  function armQueue() {
    const login = saveLogin();
    if (!login) {
      state.message = 'Enter your employee login first';
      saveState();
      render();
      ui.login?.focus();
      return;
    }

    addDraftToQueue();
    if (!acquireLock()) {
      state.message = 'Another tab already owns the Unbind queue';
      saveState();
      render();
      return;
    }

    const queued = counts().queued;
    const approved = window.confirm(
      `Arm Endless Unbind Queue for ${WAREHOUSE_ID}?\n\n` +
      `${queued ? `${queued} queued. ` : ''}Every tsX added while armed will be unbound automatically.`
    );
    if (!approved) {
      releaseLock();
      state.message = 'Arm cancelled';
      saveState();
      render();
      return;
    }

    state.running = true;
    state.message = queued ? `ARMED — ${queued} queued` : 'ARMED — scan next tsX';
    saveState();
    trace('UNBIND_QUEUE_ARM', { queued, warehouseId: WAREHOUSE_ID });
    render();
    setTimeout(runQueue, 0);
  }

  function pauseQueue(reason = 'Paused safely') {
    state.running = false;
    state.message = processing ? `${reason} — current request will finish` : reason;
    saveState();
    if (!processing) releaseLock();
    trace('UNBIND_QUEUE_PAUSE', { reason, currentId: state.currentId, phase: state.phase });
    render();
  }

  function clearDone() {
    if (processing) return;
    state.items = state.items.filter(item => item.status !== 'done');
    state.message = 'Completed rows cleared';
    saveState();
    render();
  }

  function clearAll() {
    if (state.running || processing) return;
    if (state.items.length && !window.confirm('Clear the entire Unbind queue and history?')) return;
    state = defaultState();
    saveState();
    if (ui.draft) ui.draft.value = '';
    saveDraft('');
    render();
  }

  function retryAttention() {
    if (state.running || processing) return;
    const attention = state.items.filter(item => item.status === 'attention');
    if (!attention.length) return;
    if (!window.confirm(
      `Requeue ${attention.length} attention row(s)?\n\nVerify they still require unbinding first. An earlier unbind may have succeeded.`
    )) return;
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

  function isolateTextField(field, onEnter) {
    const blockNativeHotkeys = event => {
      // The native Unbind page treats printable keys as global menu shortcuts
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
        done: ['DONE', '#166534', '#dcfce7'],
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
    ui.invalid.textContent = `REJECTED — tsX only (${state.invalid.length})\n${state.invalid.join('\n')}`;
  }

  function render() {
    if (!ui.panel) return;
    const summary = counts();
    ui.version.textContent = `UNBIND QUEUE v${VERSION}`;
    ui.mode.textContent = state.running ? 'ENDLESS ARMED' : 'PAUSED';
    ui.mode.style.background = state.running ? '#1d4ed8' : '#475569';
    ui.status.textContent = state.message;
    ui.counts.textContent =
      `${summary.queued} queued  •  ${summary.active} active  •  ${summary.done} done  •  ${summary.attention} attention`;
    ui.arm.textContent = state.running ? 'ARMED' : 'ARM ENDLESS';
    ui.arm.disabled = state.running || processing;
    ui.arm.style.opacity = ui.arm.disabled ? '0.55' : '1';
    ui.pause.disabled = !state.running;
    ui.pause.style.opacity = ui.pause.disabled ? '0.55' : '1';
    ui.add.disabled = false;
    ui.clearDone.disabled = processing;
    ui.clearAll.disabled = state.running || processing;
    ui.retry.disabled = state.running || processing || !summary.attention;
    renderItems();
    renderInvalid();
  }

  function mount() {
    if (ui.panel || !document.body) return;

    ui.panel = element('section', null, [
      'position:fixed', 'top:10px', 'right:10px', 'z-index:2147483647', 'width:470px',
      'max-height:82vh', 'overflow:hidden', 'border:3px solid #1e3a8a', 'border-radius:9px',
      'background:#fff', 'color:#111827', 'box-shadow:0 10px 30px #0005', 'font:12px Arial,sans-serif'
    ].join(';'));
    ui.panel.id = 'bwu2-unbind-queue';

    const header = element('div', null,
      'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;background:#0f172a;color:#fff'
    );
    ui.version = element('strong', `UNBIND QUEUE v${VERSION}`, 'font-size:14px');
    ui.mode = element('strong', 'PAUSED',
      'padding:3px 7px;border-radius:999px;background:#475569;color:#fff;font-size:10px;letter-spacing:.4px'
    );
    header.append(ui.version, ui.mode);

    const body = element('div', null, 'padding:9px');
    const loginRow = element('div', null,
      'display:grid;grid-template-columns:auto 1fr auto;gap:6px;align-items:center;margin-bottom:7px'
    );
    loginRow.appendChild(element('strong', 'Login'));
    ui.login = element('input');
    ui.login.type = 'text';
    ui.login.autocomplete = 'off';
    ui.login.spellcheck = false;
    ui.login.placeholder = 'employee login — saved locally';
    ui.login.value = discoverLogin();
    ui.login.style.cssText = 'min-width:0;padding:6px;border:1px solid #94a3b8;border-radius:5px;font:12px Consolas,monospace';
    ui.login.addEventListener('change', () => { saveLogin(); render(); });
    isolateTextField(ui.login, event => {
      event.preventDefault();
      saveLogin();
      ui.draft?.focus();
      render();
    });
    loginRow.append(ui.login, element('strong', WAREHOUSE_ID,
      'padding:4px 7px;border-radius:4px;background:#e2e8f0;color:#334155'
    ));

    ui.draft = element('textarea');
    ui.draft.value = savedDraft();
    ui.draft.placeholder = 'Scan or paste tsX containers — one per line';
    ui.draft.rows = 4;
    ui.draft.spellcheck = false;
    ui.draft.style.cssText = 'box-sizing:border-box;width:100%;resize:vertical;padding:7px;border:2px solid #64748b;border-radius:6px;font:13px Consolas,monospace';
    ui.draft.addEventListener('input', () => saveDraft(ui.draft.value));
    isolateTextField(ui.draft, event => {
      // Paused: Enter remains a normal textarea newline so the operator can
      // scan a whole batch before pressing ARM ENDLESS.
      // Armed: scanner Enter submits the current line immediately and the
      // queue continues in native Endless style.
      if (!state.running) {
        setTimeout(() => saveDraft(ui.draft?.value || ''), 0);
        return;
      }
      event.preventDefault();
      addDraftToQueue();
    });

    const primary = element('div', null, 'display:flex;gap:5px;margin-top:6px');
    ui.add = makeButton('ADD', addDraftToQueue, 'flex:1');
    ui.arm = makeButton('ARM ENDLESS', armQueue, 'flex:1;background:#1d4ed8;color:#fff;border-color:#1d4ed8');
    ui.pause = makeButton('PAUSE', () => pauseQueue('Paused safely'), 'flex:1;background:#f59e0b;color:#111827;border-color:#d97706');
    primary.append(ui.add, ui.arm, ui.pause);

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
    ui.clearDone = makeButton('CLEAR DONE', clearDone, 'flex:1;font-size:10px');
    ui.retry = makeButton('REQUEUE ATTENTION', retryAttention, 'flex:1;font-size:10px');
    ui.clearAll = makeButton('CLEAR ALL', clearAll, 'flex:1;font-size:10px');
    secondary.append(ui.clearDone, ui.retry, ui.clearAll);

    body.append(loginRow, ui.draft, primary, ui.status, ui.counts, ui.invalid, ui.items, secondary);
    ui.panel.append(header, body);
    document.body.appendChild(ui.panel);
    render();
    setTimeout(() => ui.draft.focus(), 0);
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
