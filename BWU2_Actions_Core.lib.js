(() => {
  'use strict';

  const VERSION = '0.1.3';
  const ROOT = globalThis;
  if (ROOT.BWU2Actions?.version === VERSION) return;

  const TRUSTED_LOGIN_KEY = 'bwu2.actions.trustedEmployeeLogin.v1';
  const LOGIN_RE = /^[a-z][a-z0-9-]{2,31}$/i;
  const RESERVED_LOGINS = /^(?:login|username|user|employee|alias|autoid|logout|logoff|signout|sign-out|signin|sign-in|profile|account|settings)$/i;
  const TRUSTED_LOGIN_TTL_MS = 12 * 60 * 60 * 1000;

  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();

  function normalizeLogin(value) {
    const login = clean(value).toLowerCase();
    if (!LOGIN_RE.test(login) || RESERVED_LOGINS.test(login)) return '';
    return login;
  }

  function findLoginInObject(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 1) return '';
    for (const key of ['employeeLogin', 'userLogin', 'username', 'login', 'alias', 'autoId', 'autoID']) {
      const found = normalizeLogin(value[key]);
      if (found) return found;
    }
    for (const [key, child] of Object.entries(value).slice(0, 24)) {
      if (!/(?:current|employee|user|profile|identity|operator)/i.test(key)) continue;
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

  function saveTrustedLogin(storage, login, source, host = '') {
    const value = normalizeLogin(login);
    if (!value || !storage) return value;
    try {
      storage.setItem(TRUSTED_LOGIN_KEY, JSON.stringify({
        login: value,
        source: clean(source),
        host: clean(host).toLowerCase(),
        at: Date.now()
      }));
    } catch {}
    return value;
  }

  function readTrustedLogin(storage, host = '') {
    if (!storage) return '';
    try {
      const saved = JSON.parse(storage.getItem(TRUSTED_LOGIN_KEY) || 'null');
      const at = Number(saved?.at || 0);
      if (!at || Date.now() - at > TRUSTED_LOGIN_TTL_MS) return '';
      const wantedHost = clean(host).toLowerCase();
      const savedHost = clean(saved?.host).toLowerCase();
      if (wantedHost && savedHost && wantedHost !== savedHost) return '';
      return normalizeLogin(saved?.login);
    } catch {
      return '';
    }
  }

  function visibleHeaderLogin(doc, pageWindow) {
    const viewportWidth = Number(pageWindow?.innerWidth || doc?.documentElement?.clientWidth || 0);
    if (!viewportWidth || !doc?.querySelectorAll) return '';

    const blocked = /^(?:search|profile|refresh|settings|sections|inventory|history|product|employee|events|problem|problems|shipment|receive|container|items|title|bwui?2|logout|logoff|signout|sign-in|signin|account)$/i;
    const candidates = [];

    for (const element of doc.querySelectorAll('a,span,strong,b,button,div')) {
      if (element.children?.length) continue;
      const raw = clean(element.textContent);
      if (!raw || raw !== raw.toLowerCase() || blocked.test(raw)) continue;
      const login = normalizeLogin(raw);
      if (!login) continue;

      const owner = element.closest('header,nav,[role="banner"],[role="navigation"],[class*="user" i],[class*="profile" i],[class*="account" i],[id*="user" i],[id*="profile" i],[id*="account" i]');
      if (!owner) continue;

      let rect;
      try { rect = element.getBoundingClientRect(); } catch { continue; }
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;
      if (rect.top < -2 || rect.top > 140) continue;
      if (rect.left < viewportWidth * 0.68) continue;

      const style = pageWindow?.getComputedStyle?.(element);
      if (style && (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)) continue;

      candidates.push({ login, left: rect.left, top: rect.top });
    }

    candidates.sort((a, b) => (b.left - a.left) || (a.top - b.top));
    return candidates[0]?.login || '';
  }

  function resolveEmployeeLogin(options = {}) {
    const doc = options.document || globalThis.document;
    const pageWindow = options.pageWindow || globalThis.window || ROOT;
    const storage = options.storage || globalThis.localStorage;
    const remember = (candidate, source) => {
      const login = normalizeLogin(candidate);
      if (!login) return null;
      saveTrustedLogin(storage, login, source, pageWindow?.location?.hostname || '');
      return { login, source };
    };

    const globals = [
      ['employeeLogin', pageWindow?.employeeLogin],
      ['userLogin', pageWindow?.userLogin],
      ['autoId', pageWindow?.autoId],
      ['autoID', pageWindow?.autoID],
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
      '[data-autoid]',
      'meta[name="employeeLogin"]',
      'meta[name="username"]',
      'meta[name="autoid"]'
    ];
    for (const selector of selectors) {
      const element = doc?.querySelector?.(selector);
      if (!element) continue;
      const candidate =
        element.dataset?.employeeLogin ||
        element.dataset?.userLogin ||
        element.dataset?.username ||
        element.dataset?.autoid ||
        element.value ||
        element.content ||
        element.textContent;
      const result = remember(candidate, `dom:${selector}`);
      if (result) return result;
    }

    const visibleLogin = remember(visibleHeaderLogin(doc, pageWindow), 'dom:top-right-visible-login');
    if (visibleLogin) return visibleLogin;

    for (const row of doc?.querySelectorAll?.('.aui-nav-row') || []) {
      const match = clean(row.textContent).match(/\bSearch\s+([a-z][a-z0-9-]{2,31})\b/i);
      const result = remember(match?.[1], 'dom:aui-nav-row');
      if (result) return result;
    }

    for (const cookieName of ['employeeLogin', 'userLogin', 'username', 'autoid']) {
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

    if (options.allowCachedLogin === true) {
      const cached = readTrustedLogin(storage, pageWindow?.location?.hostname || '');
      if (cached) return { login: cached, source: 'trusted-cache' };
    }
    return { login: '', source: '' };
  }

  function responseHeader(response, name) {
    const wanted = clean(name).toLowerCase();
    for (const line of String(response?.responseHeaders || '').split(/\r?\n/)) {
      const split = line.indexOf(':');
      if (split < 1) continue;
      if (clean(line.slice(0, split)).toLowerCase() === wanted) return clean(line.slice(split + 1));
    }
    return '';
  }

  function assertMoveContainerResponse(response, requestedUrl = '') {
    const status = Number(response?.status || 0);
    if (status < 200 || status >= 300) {
      throw actionError(`HTTP ${status || 0}`, 'move', { status });
    }

    const raw = String(response?.responseText ?? (typeof response?.response === 'string' ? response.response : ''));
    const contentType = responseHeader(response, 'content-type').toLowerCase();
    const finalUrl = clean(response?.finalUrl || response?.responseURL || '');
    const looksHtml = /text\/html|application\/xhtml/i.test(contentType) || /^\s*(?:<!doctype\s+html|<html\b)/i.test(raw);
    const looksAuth = /(?:^|[\/?#._-])(?:login|signin|sign-in|midway|sso|auth|authenticate|federat)(?:[\/?#._-]|$)/i.test(finalUrl)
      || (looksHtml && /\b(?:sign\s*in|log\s*in|authentication|midway|single\s+sign[- ]?on)\b/i.test(raw));

    let unexpectedRedirect = false;
    if (finalUrl && requestedUrl) {
      try {
        const actual = new URL(finalUrl, globalThis.location?.href || undefined);
        const expected = new URL(requestedUrl, globalThis.location?.href || undefined);
        const trimPath = value => value.replace(/\/+$/, '') || '/';
        unexpectedRedirect = trimPath(actual.pathname) !== trimPath(expected.pathname);
      } catch {}
    }

    if (looksHtml || looksAuth || unexpectedRedirect) {
      throw actionError('Move confirmation was not the MoveContainer API response', 'move', {
        status,
        ambiguous: true
      });
    }
    return response;
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
    assertMoveContainerResponse,
    markUi
  });
})();