// ==UserScript==
// @name         v2 BWU2 Identity Bridge
// @namespace    BWU2
// @version      0.1.0
// @description  Share short-lived FCResearch login evidence across V2 Amazon apps. No stored passwords.
// @include      /^https?:\/\/.*fcresearch.*\//
// @include      /^https?:\/\/qifcr\.fe\.aftx\.amazonoperations\.app\//
// @match        https://tx-b-hierarchy-nrt.nrt.proxy.amazon.com/bindHierarchy*
// @run-at       document-end
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addValueChangeListener
// @grant        unsafeWindow
// @require      https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/BWU2_Actions_Core.lib.js
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/BWU2_Identity_Bridge.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/BWU2_Identity_Bridge.user.js
// ==/UserScript==

(() => {
  'use strict';
  // GM_* belongs to THIS installed userscript, shared across the @include/@match origins.
  // Never read stale host-localStorage identity or trust unverified text from OBS.
  const PREFIX = 'bwu2.identityBridge.v1.publisher.';
  const REVISION = 'bwu2.identityBridge.v1.revision';
  const REQUEST = 'bwu2:identity:request';
  const UPDATE = 'bwu2:identity:update';
  const TTL_MS = 45000;
  const REFRESH_MS = 10000;
  const VERSION = '0.1.0';
  const isFcr = /fcresearch/i.test(location.hostname) || location.hostname === 'qifcr.fe.aftx.amazonoperations.app';
  const isBind = location.hostname === 'tx-b-hierarchy-nrt.nrt.proxy.amazon.com'
    && /^\/bindHierarchy(?:\/|$)/i.test(location.pathname);
  if (!isFcr && !isBind) return;
  const action = globalThis.BWU2Actions;
  if (!action?.resolveEmployeeLogin || !action?.normalizeLogin) return;

  // Match only evidence from the authenticated application's identity controls/state.
  // Do not accept arbitrary body text, search results, history, cached logins or OBS events.
  const trustedSource = source => source === 'dom:top-right-visible-login'
    || source === 'dom:aui-nav-row'
    || /^dom:(?:\.app-user-name|\[data-test-id="user-name"\]|\.nav-user|\.user-name|\[data-employee-login\]|\[data-user-login\]|\[data-username\]|\[data-autoid\]|meta\[name="employeeLogin"\]|meta\[name="username"\]|meta\[name="autoid"\])$/.test(source)
    || /^(?:global:employeeLogin|global:userLogin|global:autoId|global:autoID|global:currentUser|global:employee|global:bootstrapData|global:__INITIAL_STATE__)$/.test(source);
  const disposableStorage = { setItem() {}, getItem() { return null; } };
  const owner = String(Date.now()) + '-' + Math.random().toString(36).slice(2);
  const key = PREFIX + owner;
  let published = '';
  let lastStatus = '';
  const read = k => { try { return GM_getValue(k, null); } catch { return null; } };
  const save = (k, value) => { try { GM_setValue(k, value); return true; } catch { return false; } };
  const remove = k => { try { GM_deleteValue(k); } catch {} };
  const valid = login => action.normalizeLogin(login);
  const notify = () => save(REVISION, owner + ':' + Date.now() + ':' + Math.random().toString(36).slice(2));

  function findFcrLogin() {
    // A visible signed-in FCR header is preferred over ambiguous page globals.
    // Some FCR builds expose a broad "user" object that can mask the real header
    // when the shared resolver stops at its first candidate.
    const page = typeof unsafeWindow === 'object' && unsafeWindow ? unsafeWindow : window;
    const domOnlyWindow = {
      innerWidth: window.innerWidth,
      getComputedStyle: node => window.getComputedStyle(node),
      location: { hostname: location.hostname }
    };
    for (const candidateWindow of [domOnlyWindow, page]) {
      let result;
      try {
        result = action.resolveEmployeeLogin({
          document, pageWindow: candidateWindow,
          storage: disposableStorage, allowCachedLogin: false
        });
      } catch { continue; }
      const login = valid(result?.login);
      const source = String(result?.source || '');
      if (login && trustedSource(source)) return { login, source };
    }
    return null;
  }

  function publish() {
    if (!isFcr) return;
    const found = findFcrLogin();
    if (!found) {
      if (published) { remove(key); published = ''; notify(); }
      return;
    }
    published = found.login;
    if (save(key, {
      login: found.login, source: found.source, origin: location.origin,
      owner, at: Date.now(), version: VERSION
    })) notify();
  }

  function getSnapshot() {
    const now = Date.now();
    const active = [];
    try {
      for (const entry of GM_listValues()) {
        if (!entry.startsWith(PREFIX)) continue;
        const v = read(entry);
        const at = Number(v?.at || 0);
        if (!at || at > now + 5000 || now - at > TTL_MS
            || !valid(v?.login) || !trustedSource(String(v?.source || ''))) {
          remove(entry);
          continue;
        }
        if (!/^https:\/\/(?:[^/]*fcresearch[^/]*|qifcr\.fe\.aftx\.amazonoperations\.app)$/i.test(String(v.origin || ''))) continue;
        active.push(v);
      }
    } catch {
      return { status: 'unavailable', login: '', source: '', expiresAt: 0 };
    }
    const names = [...new Set(active.map(v => valid(v.login)))];
    if (names.length !== 1) return {
      status: names.length > 1 ? 'conflict' : 'missing',
      login: '', source: '', expiresAt: 0
    };
    const newest = active.filter(v => valid(v.login) === names[0]).sort((a,b) => b.at - a.at)[0];
    return {
      status: 'ready', login: names[0], source: 'FCR ' + newest.source,
      expiresAt: newest.at + TTL_MS
    };
  }

  function deliver() {
    if (!isBind) return;
    const snapshot = getSnapshot();
    lastStatus = snapshot.status;
    // JSON string is intentional: Firefox extensions isolate object-based CustomEvent.detail.
    document.dispatchEvent(new CustomEvent(UPDATE, {
      detail: JSON.stringify({ ...snapshot, version: VERSION })
    }));
  }

  if (isFcr) {
    publish();
    const timer = setInterval(publish, REFRESH_MS);
    window.addEventListener('focus', publish);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) publish(); });
    window.addEventListener('pagehide', () => {
      clearInterval(timer);
      remove(key);
      notify();
    }, { once: true });
  }
  if (isBind) {
    document.addEventListener(REQUEST, deliver);
    try { GM_addValueChangeListener(REVISION, deliver); } catch {}
    window.addEventListener('focus', deliver);
    const timer = setInterval(deliver, REFRESH_MS);
    window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
    deliver();
  }
})();
