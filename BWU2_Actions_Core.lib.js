(() => {
  'use strict';

  const VERSION = '0.1.7';
  const ROOT = globalThis;
  if (ROOT.BWU2Actions?.version === VERSION) return;

  const LOGIN_RE = /^[a-z][a-z0-9-]{2,31}$/i;
  const RESERVED_LOGINS = /^(?:login|username|user|employee|alias|autoid|logout|logoff|signout|sign-out|signin|sign-in|profile|account|settings)$/i;

  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();

  function normalizeLogin(value) {
    const login = clean(value).toLowerCase();
    if (!LOGIN_RE.test(login) || RESERVED_LOGINS.test(login)) return '';
    return login;
  }

  const identityClients = new WeakMap();
  const LOGIN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const FCR_LOGIN_URL = 'https://fcresearch-fe.aka.amazon.com/BWU2/results';

  function createIdentityClient(options = {}) {
    const doc = options.document || globalThis.document;
    const page = options.pageWindow || globalThis.window;
    if (identityClients.has(doc)) return identityClients.get(doc);
    const REQUEST = 'fcr-data-core:identity:request';
    const UPDATE = 'fcr-data-core:identity:update';
    const missing = () => ({ login: '', source: '', capturedAt: 0, expiresAt: 0 });
    let value = missing(), expiryTimer = 0, dialog = null, providerSeen = false;
    const subscribers = new Set();

    function get() {
      const now = Date.now();
      return value.login && value.capturedAt <= now && value.expiresAt > now ? { ...value } : missing();
    }
    function refresh() { doc.dispatchEvent(new Event(REQUEST)); return get(); }
    function notify() { for (const fn of subscribers) fn(get()); }
    function closePrompt() {
      if (dialog) { dialog.close(); dialog.remove(); dialog = null; }
    }
    function receive(event) {
      let next;
      try { next = JSON.parse(event.detail); } catch { return; }
      if (next?.schema !== 1 || next?.owner !== 'FCR Data Core') return;
      providerSeen = true;
      const login = normalizeLogin(next.login);
      const at = Number(next.capturedAt), expiry = Number(next.expiresAt), now = Date.now();
      const valid = next.status === 'ready' && login && Number.isFinite(at) && at > 0 && at <= now
        && expiry === at + LOGIN_TTL_MS && expiry > now;
      const incoming = valid ? { login, source: 'FCR Data Core', capturedAt: at, expiresAt: expiry } : missing();
      if (JSON.stringify(incoming) === JSON.stringify(value)) return;
      value = incoming;
      clearTimeout(expiryTimer);
      if (value.login) {
        closePrompt();
        expiryTimer = setTimeout(() => { value = missing(); notify(); }, expiry - now + 1);
      }
      queueMicrotask(notify);
    }
    function prompt() {
      if (refresh().login || !doc.body) return;
      const existing = doc.getElementById('bwu2-fcr-login-prompt');
      if (existing) return;
      dialog = doc.createElement('dialog');
      dialog.id = 'bwu2-fcr-login-prompt';
      markUi(dialog);
      dialog.setAttribute('aria-label', 'Refresh your FCR login');
      dialog.style.cssText = 'max-width:380px;padding:22px;border:2px solid #334155;border-radius:12px;background:#fff;color:#0f172a;font:15px Arial,sans-serif;box-shadow:0 12px 45px #0006';
      const title = doc.createElement('strong');
      title.textContent = 'Refresh your FCR login';
      const text = doc.createElement('p');
      text.textContent = providerSeen
        ? 'Your saved username is missing or over seven days old. Open FCR, then return here. Your queued work is kept; press Start or Unbind when ready.'
        : 'Enable or update your existing FCR Data Core script, then reload this app and open FCR. Your queued work is kept.';
      const link = doc.createElement('a');
      link.textContent = 'Open FCR';
      link.href = FCR_LOGIN_URL;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.style.cssText = 'display:inline-block;padding:10px 16px;background:#1d4ed8;color:white;border-radius:6px;text-decoration:none;font-weight:bold';
      const later = doc.createElement('button');
      later.type = 'button'; later.textContent = 'Later';
      later.style.cssText = 'margin-left:12px;padding:9px';
      later.addEventListener('click', closePrompt);
      dialog.addEventListener('cancel', event => { event.preventDefault(); closePrompt(); });
      dialog.append(title, text, link, later);
      doc.body.appendChild(dialog);
      dialog.showModal();
    }
    function requireLogin() {
      const login = refresh().login;
      if (!login) prompt();
      return login;
    }
    doc.addEventListener(UPDATE, receive);
    page.addEventListener('focus', refresh);
    page.addEventListener('pageshow', refresh);
    doc.addEventListener('visibilitychange', () => { if (!doc.hidden) { refresh(); notify(); } });
    page.addEventListener('pagehide', () => { clearTimeout(expiryTimer); closePrompt(); });
    const client = Object.freeze({ get, refresh, prompt, requireLogin,
      subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); }
    });
    identityClients.set(doc, client);
    queueMicrotask(refresh);
    return client;
  }

  function resolveEmployeeLogin(options = {}) {
    return createIdentityClient(options).get();
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
        unexpectedRedirect = actual.origin !== expected.origin || trimPath(actual.pathname) !== trimPath(expected.pathname);
      } catch { unexpectedRedirect = true; }
    }

    if (looksHtml || looksAuth || unexpectedRedirect) {
      throw actionError('Move confirmation was not the MoveContainer API response', 'move', {
        status,
        ambiguous: true
      });
    }
    let payload = response?.response;
    if (!payload || typeof payload !== 'object') {
      try { payload = JSON.parse(raw); } catch { payload = null; }
    }
    if (!payload || Array.isArray(payload) || typeof payload.success !== 'boolean') {
      throw actionError('Move outcome UNKNOWN — verify the container before retrying', 'move', { status, ambiguous:true });
    }
    if (payload.success !== true) {
      const reason = clean(payload.simpleMessage || payload.detailedMessage).slice(0, 500);
      throw actionError(reason || 'Move was rejected', 'move', { status, rejected:true });
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
    createIdentityClient,
    runUnbind,
    movePayload,
    moveContainer,
    assertMoveContainerResponse,
    markUi
  });
})();
