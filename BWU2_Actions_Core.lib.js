(() => {
  'use strict';

  const VERSION = '0.1.0';
  const ROOT = globalThis;
  if (ROOT.BWU2Actions?.version === VERSION) return;

  const TRUSTED_LOGIN_KEY = 'bwu2.actions.trustedEmployeeLogin.v1';
  const LOGIN_RE = /^[a-z][a-z0-9-]{2,31}$/i;
  const RESERVED_LOGINS = /^(?:login|username|user|employee|alias|autoid)$/i;

  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();

  function normalizeLogin(value) {
    const login = clean(value).toLowerCase();
    if (!LOGIN_RE.test(login) || RESERVED_LOGINS.test(login)) return '';
    return login;
  }

  function findLoginInObject(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 3) return '';
    for (const key of ['employeeLogin', 'userLogin', 'username', 'login', 'alias', 'autoId', 'autoID']) {
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

  function readCookie(doc, wanted) {
    try {
      for (const rawPart of String(doc?.cookie || '').split(';')) {
        const part = rawPart.trim();
        const split = part.indexOf('=');
        if (split < 1) continue;
        if (clean(part.slice(0, split)).toLowerCase() !== wanted.toLowerCase()) continue;
        let value = clean(part.slice(split + 1));
        try { value = decodeURIComponent(value); } catch {}
        return value;
      }
    } catch {}
    return '';
  }

  function saveTrustedLogin(storage, login, source) {
    const value = normalizeLogin(login);
    if (!value || !storage) return value;
    try {
      storage.setItem(TRUSTED_LOGIN_KEY, JSON.stringify({ login: value, source: clean(source), at: Date.now() }));
    } catch {}
    return value;
  }

  function readTrustedLogin(storage) {
    if (!storage) return '';
    try {
      const saved = JSON.parse(storage.getItem(TRUSTED_LOGIN_KEY) || 'null');
      return normalizeLogin(saved?.login);
    } catch {
      return '';
    }
  }

  function resolveEmployeeLogin(options = {}) {
    const doc = options.document || globalThis.document;
    const pageWindow = options.pageWindow || globalThis.window || ROOT;
    const storage = options.storage || globalThis.localStorage;
    const remember = (candidate, source) => {
      const login = normalizeLogin(candidate);
      if (!login) return null;
      saveTrustedLogin(storage, login, source);
      return { login, source };
    };

    const globals = [
      ['employeeLogin', pageWindow?.employeeLogin],
      ['userLogin', pageWindow?.userLogin],
      ['currentUser', pageWindow?.currentUser],
      ['user', pageWindow?.user],
      ['employee', pageWindow?.employee],
      ['bootstrapData', pageWindow?.bootstrapData],
      ['__INITIAL_STATE__', pageWindow?.__INITIAL_STATE__]
    ];
    for (const [name, value] of globals) {
      const found = typeof value === 'string' ? normalizeLogin(value) : findLoginInObject(value);
      const result = remember(found, `global:${name}`);
      if (result) return result;
    }

    const selectors = [
      '.app-user-name',
      '[data-test-id="user-name"]',
      '.nav-user',
      '.user-name',
      '[data-employee-login]',
      '[data-user-login]',
      '[data-username]',
      'input[name="employeeLogin"]',
      'input[name="userLogin"]',
      'meta[name="employeeLogin"]',
      'meta[name="username"]'
    ];
    for (const selector of selectors) {
      const element = doc?.querySelector?.(selector);
      if (!element) continue;
      const candidate =
        element.dataset?.employeeLogin ||
        element.dataset?.userLogin ||
        element.dataset?.username ||
        element.value ||
        element.content ||
        element.textContent;
      const result = remember(candidate, `dom:${selector}`);
      if (result) return result;
    }

    for (const row of doc?.querySelectorAll?.('.aui-nav-row') || []) {
      const match = clean(row.textContent).match(/\bSearch\s+([a-z][a-z0-9-]{2,31})\b/i);
      const result = remember(match?.[1], 'dom:aui-nav-row');
      if (result) return result;
    }

    for (const cookieName of ['employeeLogin', 'userLogin', 'username', 'login', 'alias', 'autoid']) {
      const result = remember(readCookie(doc, cookieName), `cookie:${cookieName}`);
      if (result) return result;
    }

    // FC Menu exposes an employee identifier cookie. Only accept it when it
    // actually looks like a login alias; numeric badge IDs are deliberately ignored.
    const fcMenuEmployee = readCookie(doc, 'fcmenu-employeeId');
    if (/[a-z]/i.test(fcMenuEmployee)) {
      const result = remember(fcMenuEmployee, 'cookie:fcmenu-employeeId');
      if (result) return result;
    }

    const cached = readTrustedLogin(storage);
    return cached ? { login: cached, source: 'trusted-cache' } : { login: '', source: '' };
  }

  function actionError(message, phase, details = {}) {
    const error = new Error(message);
    error.phase = phase;
    Object.assign(error, details);
    return error;
  }

  function assertUnbindResponse(phase, data, container) {
    if (phase === 'validate') {
      if (!data || typeof data !== 'object') throw actionError('Unexpected validation response', phase);
      if (data.scannableId && clean(data.scannableId).toLowerCase() !== clean(container).toLowerCase()) {
        throw actionError('Validation returned another container', phase);
      }
      return;
    }
    if (phase === 'summary') {
      if (!data || !Array.isArray(data.transferBindingSummaryList)) {
        throw actionError('Unexpected binding summary', phase);
      }
      return;
    }
    if (phase === 'unbind') {
      if (!data || typeof data.hostName !== 'string' || !clean(data.hostName)) {
        throw actionError('Unexpected unbind response — verify container', phase, { ambiguous: true });
      }
    }
  }

  async function runUnbind(options = {}) {
    const container = clean(options.container);
    const login = normalizeLogin(options.login);
    const warehouseId = clean(options.warehouseId || 'BWU2');
    const request = options.request;
    const endpoints = options.endpoints || {};
    const onPhase = typeof options.onPhase === 'function' ? options.onPhase : () => {};
    if (!container) throw actionError('Container required', 'validate');
    if (!login) throw actionError('Logged-in user could not be detected', 'identity');
    if (typeof request !== 'function') throw new Error('Unbind request transport required');

    const steps = [
      ['validate', endpoints.validate || '/validateContainer', { warehouseId, scannableId: container }],
      ['summary', endpoints.summary || '/getTransshipmentBindingSummary', { warehouseId, scannableId: container }],
      ['unbind', endpoints.unbind || '/unbindContainer', { sourceWarehouseId: warehouseId, scannableId: container, employeeLogin: login }]
    ];
    const result = {};

    for (const [phase, url, body] of steps) {
      await onPhase(phase);
      const response = await request({ phase, url, body, container });
      const data = response?.data ?? response;
      assertUnbindResponse(phase, data, container);
      result[phase] = response;
    }
    return result;
  }

  function movePayload(container, destination) {
    return {
      sourceScannableId: null,
      destinationScannableId: clean(destination),
      containerScannableId: clean(container),
      confirmed: 'true'
    };
  }

  async function moveContainer(options = {}) {
    const container = clean(options.container);
    const destination = clean(options.destination);
    if (!container) throw new Error('Container required');
    if (!destination) throw new Error('Destination required');
    if (typeof options.request !== 'function') throw new Error('MoveContainer request transport required');
    return options.request({
      url: options.url || '/api/move-container',
      body: movePayload(container, destination),
      container,
      destination
    });
  }

  function markUi(node) {
    if (node?.setAttribute) node.setAttribute('data-bwu2-ui', '1');
    return node;
  }

  ROOT.BWU2Actions = Object.freeze({
    version: VERSION,
    normalizeLogin,
    resolveEmployeeLogin,
    runUnbind,
    movePayload,
    moveContainer,
    markUi
  });
})();