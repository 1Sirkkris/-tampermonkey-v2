from pathlib import Path
import re


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 exact match, found {count}')
    return text.replace(old, new, 1)


def regex_once(text, pattern, repl, label):
    out, count = re.subn(pattern, repl, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 regex match, found {count}')
    return out


# ---------- Core ----------
path = 'FCR_Data_Core.user.js'
s = read(path)
s = replace_once(s, '// @name         TEST v0.2.16 FCR Data Core — MADCAT ASIN/FNSKU Fix', '// @name         TEST v0.2.17 FCR Data Core — Auto MADCAT Auth', 'core name')
s = replace_once(s, '// @version      0.2.16', '// @version      0.2.17', 'core version')
s = replace_once(s,
    '// @description  Strict binDescription plus 30-day raw MADCAT using FNSKU when available, ASIN otherwise, with automatic Inventory History fallback.',
    '// @description  Strict binDescription plus global 30-day raw MADCAT with automatic user-gesture auth renewal and auth-only Inventory History fallback.',
    'core description')
s = replace_once(s, "  const MEASUREMENT_AUTH_KEY = 'fcr-data-core:measurement-auth-v1';", """  const MEASUREMENT_AUTH_KEY = 'fcr-data-core:measurement-auth-v1';
  const MEASUREMENT_LAST_IDENTIFIER_KEY = 'fcr-data-core:measurement-last-identifier-v1';
  const MEASUREMENT_BRIDGE_ATTEMPT_KEY = 'fcr-data-core:measurement-bridge-at-v1';""", 'core keys')
s = replace_once(s, "  const VERSION = '0.2.16';", "  const VERSION = '0.2.17';", 'core VERSION')
s = replace_once(s, "  const MEASUREMENT_TIMEOUT_MS = 6000;", """  const MEASUREMENT_TIMEOUT_MS = 6000;
  const MEASUREMENT_RENEW_BEFORE_MS = 10 * 60 * 1000;
  const MEASUREMENT_BRIDGE_COOLDOWN_MS = 20 * 1000;
  const MEASUREMENT_BRIDGE_WAIT_MS = 6500;""", 'core auth constants')
s = replace_once(s, "    madcatHistoryFallback: 0,", """    madcatHistoryFallback: 0,
    madcatAuthWaits: 0,
    madcatAutoBridge: 0,
    madcatAutoBridgeBlocked: 0,""", 'core stats')

anchor = """  const clean = value => String(value ?? '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
  const upper = value => clean(value).toUpperCase();
"""
insert = anchor + r'''
  function measurementIdentifierCandidate(value) {
    const candidate = upper(value);
    return /^[A-Z0-9]{10}$/.test(candidate) ? candidate : '';
  }

  function rememberMeasurementIdentifier(value) {
    const identifier = measurementIdentifierCandidate(value);
    if (!identifier) return '';
    try { GM_setValue(MEASUREMENT_LAST_IDENTIFIER_KEY, identifier); } catch {}
    return identifier;
  }

  function readMeasurementIdentifier() {
    try { return measurementIdentifierCandidate(GM_getValue(MEASUREMENT_LAST_IDENTIFIER_KEY, '')); } catch { return ''; }
  }

  function readMeasurementBridgeAttemptAt() {
    try { return Number(GM_getValue(MEASUREMENT_BRIDGE_ATTEMPT_KEY, 0)) || 0; } catch { return 0; }
  }

  function markMeasurementBridgeAttempt() {
    const at = Date.now();
    try { GM_setValue(MEASUREMENT_BRIDGE_ATTEMPT_KEY, at); } catch {}
    return at;
  }

  function measurementBridgeUrl(identifier) {
    const url = new URL(`https://${MEASUREMENT_SITE_HOST}/item/${encodeURIComponent(identifier)}`);
    url.searchParams.set('fcrMadcatBridge', '1');
    url.searchParams.set('fcrMadcatAuto', '1');
    return url.href;
  }

  function gestureMeasurementIdentifier(target) {
    const direct = measurementIdentifierCandidate(target?.value || target?.getAttribute?.('value') || '');
    if (direct) return direct;
    const search = measurementIdentifierCandidate(new URLSearchParams(location.search).get('s') || '');
    if (search) return search;
    return readMeasurementIdentifier();
  }

  function measurementAuthStatus() {
    const auth = readMeasurementAuth();
    const lastAttempt = readMeasurementBridgeAttemptAt();
    const age = lastAttempt ? Date.now() - lastAttempt : Infinity;
    return {
      available: !!auth,
      expiresAt: Number(auth?.exp) || 0,
      expiresInMs: auth ? Math.max(0, auth.exp - Date.now()) : 0,
      renewSoon: !auth || auth.exp - Date.now() <= MEASUREMENT_RENEW_BEFORE_MS,
      bridgeRecent: age >= 0 && age <= MEASUREMENT_BRIDGE_WAIT_MS + 1500
    };
  }

  function installMeasurementAutoRenewal() {
    if (window.__fcrMeasurementAutoRenewal_v1) return;
    window.__fcrMeasurementAutoRenewal_v1 = true;

    const maybeOpen = event => {
      if (!event?.isTrusted) return;
      if (event.type === 'keydown' && event.key !== 'Enter') return;
      if (event.type === 'click' && event.target?.closest?.('.fc-madcat-badge,.madcat-pill')) return;

      const auth = readMeasurementAuth();
      if (auth && auth.exp - Date.now() > MEASUREMENT_RENEW_BEFORE_MS) return;

      const lastAttempt = readMeasurementBridgeAttemptAt();
      if (lastAttempt && Date.now() - lastAttempt < MEASUREMENT_BRIDGE_COOLDOWN_MS) return;

      const identifier = gestureMeasurementIdentifier(event.target);
      if (!identifier) return;
      rememberMeasurementIdentifier(identifier);
      markMeasurementBridgeAttempt();

      let bridge = null;
      try {
        bridge = window.open(measurementBridgeUrl(identifier), 'fcrMadcatBridge', 'popup,width=560,height=680');
      } catch {}
      if (bridge) {
        stats.madcatAutoBridge++;
        recordUsage('madcat.auth.auto-bridge');
      } else {
        stats.madcatAutoBridgeBlocked++;
        recordUsage('madcat.auth.auto-bridge-blocked');
      }
    };

    document.addEventListener('keydown', maybeOpen, true);
    document.addEventListener('click', maybeOpen, true);
  }

  async function waitForMeasurementAuth(timeoutMs = MEASUREMENT_BRIDGE_WAIT_MS) {
    const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
    let auth = readMeasurementAuth();
    if (auth) return auth;
    stats.madcatAuthWaits++;
    while (!auth && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 250));
      auth = readMeasurementAuth();
    }
    return auth;
  }

  installMeasurementAutoRenewal();
'''
s = replace_once(s, anchor, insert, 'core auto-renew helpers')

s = replace_once(s,
    """        closeTimer = setTimeout(() => {
          try { pageWindow.close(); } catch {}
        }, 700);""",
    """        closeTimer = setTimeout(() => {
          try { pageWindow.opener?.focus?.(); } catch {}
          try { pageWindow.close(); } catch {}
        }, 700);""",
    'core bridge close')

new_madcat = r'''  async function fallbackMadcatToInventoryHistory(identifier, force = false, reason = 'measurement-auth') {
    stats.madcatHistoryFallback++;
    recordUsage('madcat.fallback.inventory-history');
    const result = await fetchHistory(identifier, force);
    const history = result?.history || { rows: 0, madcat: false };
    return {
      madcat: history.madcat === true,
      eventsChecked: 0,
      pages: 0,
      source: 'history-fallback',
      madcatSource: 'history',
      windowDays: null,
      fallback: 'inventory-history',
      fallbackReason: reason,
      authRequired: true,
      historyRows: Number(history.rows) || 0
    };
  }

  async function fetchRecentMadcat(inputValue, force = false) {
    const input = inputValue && typeof inputValue === 'object' ? inputValue : { fnsku: inputValue };
    const fnsku = upper(input?.fnsku);
    const asin = upper(input?.asin || (!fnsku ? input?.code : ''));
    const identifier = fnsku || asin;
    const identifierType = fnsku ? 'FNSKU' : 'ASIN';
    if (!identifier) throw new Error('Measurement item unavailable');
    rememberMeasurementIdentifier(identifier);

    let auth = readMeasurementAuth();
    if (!auth) {
      const lastAttempt = readMeasurementBridgeAttemptAt();
      const recentAttempt = lastAttempt && Date.now() - lastAttempt <= MEASUREMENT_BRIDGE_WAIT_MS + 1500;
      const requestedWait = Math.max(0, Number(input?.waitForAuthMs) || 0);
      if (recentAttempt || requestedWait) {
        auth = await waitForMeasurementAuth(requestedWait || MEASUREMENT_BRIDGE_WAIT_MS);
      }
    }
    if (!auth) {
      stats.madcatAuthRequired++;
      return fallbackMadcatToInventoryHistory(identifier, force, 'measurement-login-required');
    }

    const key = `madcat30:${identifierType}:${identifier}:${force ? 'force' : 'normal'}`;
    if (inFlight.has(key)) {
      stats.dedupeHits++;
      const data = await inFlight.get(key);
      return { ...data, deduped: true };
    }

    const work = (async () => {
      stats.madcatNetwork++;
      const before = new Date();
      const after = new Date(before.getTime() - MEASUREMENT_LOOKBACK_MS);
      const url = new URL(`${MEASUREMENT_API}/${encodeURIComponent(identifier)}/${identifierType}`);
      url.searchParams.set('effectiveAfter', after.toISOString());
      url.searchParams.set('effectiveBefore', before.toISOString());

      let pages = 0;
      let eventsChecked = 0;
      let nextToken = '';

      do {
        if (nextToken) url.searchParams.set('nextToken', nextToken);
        else url.searchParams.delete('nextToken');

        const response = await requestMeasurementPage(url.href, auth.token);
        let payload;
        try {
          payload = JSON.parse(response.responseText || '{}');
        } catch {
          throw new Error('Measurement response invalid');
        }

        pages++;
        const events = Array.isArray(payload.measurementEvents) ? payload.measurementEvents : [];
        eventsChecked += events.length;
        const hasRecentMadcat = events.some(event => {
          if (upper(event?.measurementSource) !== 'MADCAT') return false;
          const instant = Date.parse(event?.measurementInstant || '');
          return Number.isFinite(instant) && instant >= after.getTime() && instant <= before.getTime();
        });
        if (hasRecentMadcat) {
          return {
            madcat: true,
            eventsChecked,
            pages,
            source: 'network',
            madcatSource: 'raw',
            windowDays: 30,
            identifierType,
            authExpiresAt: auth.exp
          };
        }

        nextToken = clean(payload.nextToken);
      } while (nextToken && pages < MEASUREMENT_MAX_PAGES);

      if (nextToken) throw new Error('Measurement history incomplete');
      return {
        madcat: false,
        eventsChecked,
        pages,
        source: 'network',
        madcatSource: 'raw',
        windowDays: 30,
        identifierType,
        authExpiresAt: auth.exp
      };
    })();

    inFlight.set(key, work);
    try {
      return await work;
    } catch (error) {
      const message = clean(error?.message || error || 'Measurement request failed');
      if (/measurement login required/i.test(message)) {
        stats.madcatAuthRequired++;
        return await fallbackMadcatToInventoryHistory(identifier, force, 'measurement-token-expired');
      }
      throw error;
    } finally {
      if (inFlight.get(key) === work) inFlight.delete(key);
    }
  }
'''
s = regex_once(s,
    r"  async function fallbackMadcatToInventoryHistory\(.*?\n  async function fetchBinSize\(",
    new_madcat + "\n  async function fetchBinSize(",
    'core MADCAT functions')

s = replace_once(s,
    "if (type === 'ping') data = { version: VERSION, modules: ['product', 'inventory', 'inventoryPreview', 'history', 'madcatRecent', 'hazmat', 'binSize', 'section'], stats: { ...stats } };",
    "if (type === 'ping') data = { version: VERSION, modules: ['product', 'inventory', 'inventoryPreview', 'history', 'madcatRecent', 'madcatAuthStatus', 'hazmat', 'binSize', 'section'], stats: { ...stats } };",
    'core ping modules')
s = replace_once(s,
    "      else if (type === 'madcatRecent') data = await fetchRecentMadcat(payload, payload.force === true);",
    """      else if (type === 'madcatRecent') data = await fetchRecentMadcat(payload, payload.force === true);
      else if (type === 'madcatAuthStatus') data = measurementAuthStatus();""",
    'core auth status handler')
write(path, s)


# ---------- Master ----------
path = 'FCResearch_Master.user.js'
s = read(path)
s = replace_once(s, '// @name         TEST v0.1.24 FCResearch Master — MADCAT Identifier Fix', '// @name         TEST v0.1.25 FCResearch Master — Auto MADCAT Auth', 'master name')
s = replace_once(s, '// @version      0.1.24', '// @version      0.1.25', 'master version')
s = replace_once(s, "  const VERSION = '0.1.24';", "  const VERSION = '0.1.25';", 'master VERSION')
s = replace_once(s,
    """      .fcrm-madcat-yes { background:#ffff00; }
      .fcrm-madcat-no { background:#ff0000; }
      .fcrm-madcat-loading { background:#d9d9d9; }
      .fcrm-madcat-error { background:#334155; color:#fff; cursor:pointer; }
      .fcrm-madcat-error:hover { background:#0f172a; }
      .fc-madcat-badge:disabled { opacity:1; cursor:default; }""",
    """      .fcrm-madcat-yes { background:#16a34a; color:#fff; }
      .fcrm-madcat-no,.fcrm-madcat-history-no { background:#ef4444; color:#111827; }
      .fcrm-madcat-history-yes { background:#2563eb; color:#fff; cursor:pointer; }
      .fcrm-madcat-history-no { cursor:pointer; }
      .fcrm-madcat-auth { background:#facc15; color:#111827; cursor:wait; }
      .fcrm-madcat-loading { background:#d9d9d9; }
      .fcrm-madcat-error { background:#334155; color:#fff; cursor:pointer; }
      .fcrm-madcat-history-yes:hover { background:#1d4ed8; }
      .fcrm-madcat-history-no:hover { background:#dc2626; }
      .fcrm-madcat-error:hover { background:#0f172a; }
      .fc-madcat-badge:disabled { opacity:1; cursor:default; }""",
    'master madcat css')

new_master = r'''  const madcatState = { signature: '', status: '', message: '', serial: 0 };

  function paintMadcat(panel, status, message = '') {
    const badge = ensureMadcatBadge(panel);
    if (!badge) return;
    const allowed = new Set(['yes', 'no', 'history-yes', 'history-no', 'auth', 'error']);
    const state = allowed.has(status) ? status : 'loading';
    badge.className = `fc-madcat-badge fcrm-madcat-${state}`;
    badge.textContent = state === 'yes' ? 'Madcat: YES'
      : state === 'no' ? 'Madcat: NO'
        : state === 'history-yes' ? 'Madcat: YES'
          : state === 'history-no' ? 'Madcat: NO?'
            : state === 'auth' ? 'Madcat: AUTH…'
              : state === 'error' ? 'Madcat: ERROR ↻'
                : 'Madcat: CHECK…';

    const retryable = state === 'history-yes' || state === 'history-no' || state === 'error';
    badge.disabled = !retryable;
    badge.title = state === 'yes' ? 'RAW Item Measurement: MADCAT found within the past 30 days'
      : state === 'no' ? 'RAW Item Measurement: no MADCAT found within the past 30 days'
        : state === 'history-yes' ? 'Inventory History fallback: MADCAT found — click to refresh RAW auth'
          : state === 'history-no' ? 'Inventory History fallback only — click to refresh RAW auth and confirm'
            : state === 'auth' ? 'Refreshing Item Measurement authentication…'
              : state === 'error' ? `${message || 'MADCAT check failed'} — click to refresh auth and retry`
                : 'Checking global raw MADCAT measurements from the past 30 days';

    badge.onclick = retryable ? () => {
      const current = readProductPanel();
      if (!current) return;
      checkMadcat(current, true, true);
    } : null;
  }

  function measurementBridgeUrl(identifier) {
    const url = new URL(`${MEASUREMENT_BRIDGE_SITE}/item/${encodeURIComponent(identifier)}`);
    url.searchParams.set('fcrMadcatBridge', '1');
    url.searchParams.set('fcrMadcatAuto', '1');
    return url.href;
  }

  async function checkMadcat(panel, force = false, openLoginBridge = false) {
    const signature = panel?.signature || '';
    const fnsku = clean(panel?.fnskuId).toUpperCase();
    const asin = clean(panel?.primaryId).toUpperCase();
    const measurementId = fnsku || asin;
    if (!signature) return;

    if (!force && madcatState.signature === signature && madcatState.status) {
      paintMadcat(panel, madcatState.status, madcatState.message);
      return;
    }

    const serial = ++madcatState.serial;
    madcatState.signature = signature;
    madcatState.status = openLoginBridge ? 'auth' : 'loading';
    madcatState.message = '';
    paintMadcat(panel, madcatState.status);

    if (!measurementId) {
      madcatState.status = 'error';
      madcatState.message = 'Measurement item unavailable';
      paintMadcat(panel, 'error', madcatState.message);
      return;
    }

    let bridge = null;
    if (openLoginBridge) {
      bridge = window.open(measurementBridgeUrl(measurementId), 'fcrMadcatBridge', 'popup,width=560,height=680');
      if (!bridge) {
        madcatState.status = 'error';
        madcatState.message = 'Measurement login popup blocked';
        paintMadcat(panel, 'error', madcatState.message);
        return;
      }
    } else {
      try {
        const auth = await coreRequest('madcatAuthStatus', {}, 1200);
        if (madcatState.serial !== serial || madcatState.signature !== signature) return;
        if (!auth?.available && auth?.bridgeRecent) {
          madcatState.status = 'auth';
          paintMadcat(panel, 'auth');
        }
      } catch {}
    }

    try {
      const result = await coreRequest('madcatRecent', {
        fnsku,
        asin,
        force,
        waitForAuthMs: bridge ? 6500 : 0
      }, 25000);
      if (madcatState.serial !== serial || madcatState.signature !== signature) return;
      const history = result?.madcatSource === 'history' || result?.fallback === 'inventory-history';
      madcatState.status = history
        ? (result?.madcat === true ? 'history-yes' : 'history-no')
        : (result?.madcat === true ? 'yes' : 'no');
      madcatState.message = clean(result?.fallbackReason || '');
      const current = readProductPanel();
      if (current?.signature === signature) paintMadcat(current, madcatState.status, madcatState.message);
    } catch (error) {
      if (madcatState.serial !== serial || madcatState.signature !== signature) return;
      madcatState.status = 'error';
      madcatState.message = clean(error?.message || 'MADCAT check failed');
      const current = readProductPanel();
      if (current?.signature === signature) paintMadcat(current, 'error', madcatState.message);
    }
  }
'''
s = regex_once(s,
    r"  const madcatState = \{.*?\n  const sizeState = \{",
    new_master + "\n  const sizeState = {",
    'master MADCAT block')
write(path, s)


# ---------- FC-Lite ----------
path = 'FC_Lite.user.js'
s = read(path)
s = replace_once(s, '// @name        TEST v0.1.63 FC-Lite — MADCAT Identifier Fix', '// @name        TEST v0.1.64 FC-Lite — Auto MADCAT Auth', 'fcl name')
s = replace_once(s, '// @version      0.1.63', '// @version      0.1.64', 'fcl version')
s = replace_once(s, "  const VERSION = '0.1.63';", "  const VERSION = '0.1.64';", 'fcl VERSION')
s = replace_once(s,
    """      .madcat-pill.yes { border-color:#a16207; background:#fde047; color:#422006; }
      .madcat-pill.no { border-color:#991b1b; background:#ef4444; color:#111827; }
      .madcat-pill.checking { border-color:#64748b; background:#e2e8f0; color:#334155; }
      .madcat-pill.error { border-color:#111827; background:#334155; color:#fff; cursor:pointer; }
      .madcat-pill.error:hover { background:#0f172a; }
      .madcat-pill:disabled { cursor:default; opacity:1; }""",
    """      .madcat-pill.yes { border-color:#15803d; background:#16a34a; color:#fff; }
      .madcat-pill.no,.madcat-pill.history-no { border-color:#991b1b; background:#ef4444; color:#111827; }
      .madcat-pill.history-yes { border-color:#1d4ed8; background:#2563eb; color:#fff; cursor:pointer; }
      .madcat-pill.history-no { cursor:pointer; }
      .madcat-pill.auth { border-color:#ca8a04; background:#facc15; color:#111827; cursor:wait; }
      .madcat-pill.checking { border-color:#64748b; background:#e2e8f0; color:#334155; }
      .madcat-pill.error { border-color:#111827; background:#334155; color:#fff; cursor:pointer; }
      .madcat-pill.history-yes:hover { background:#1d4ed8; }
      .madcat-pill.history-no:hover { background:#dc2626; }
      .madcat-pill.error:hover { background:#0f172a; }
      .madcat-pill:disabled { cursor:default; opacity:1; }""",
    'fcl madcat css')

new_fcl = r'''  function paintMadcat(row, state, message = '') {
    if (!row?.isConnected) return;
    const cell = row.querySelector('.madcat');
    if (!cell) return;

    const allowed = new Set(['yes', 'no', 'history-yes', 'history-no', 'auth', 'error', 'checking']);
    const value = allowed.has(state) ? state : 'error';
    cell.classList.toggle('yes', value === 'yes');
    cell.classList.toggle('no', value === 'no' || value === 'history-no');
    cell.classList.toggle('error', value === 'error');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `madcat-pill ${value}`;
    button.textContent = value === 'yes' ? 'YES'
      : value === 'no' ? 'NO'
        : value === 'history-yes' ? 'YES'
          : value === 'history-no' ? 'NO?'
            : value === 'auth' ? 'AUTH'
              : value === 'checking' ? 'CHECK…'
                : 'ERROR ↻';

    const retryable = value === 'history-yes' || value === 'history-no' || value === 'error';
    button.disabled = !retryable;
    button.title = value === 'yes'
      ? 'RAW Item Measurement: MADCAT found within the past 30 days'
      : value === 'no'
        ? 'RAW Item Measurement: no MADCAT found within the past 30 days'
        : value === 'history-yes'
          ? 'Inventory History fallback: MADCAT found — click to refresh RAW auth'
          : value === 'history-no'
            ? 'Inventory History fallback only — click to refresh RAW auth and confirm'
            : value === 'auth'
              ? 'Refreshing Item Measurement authentication…'
              : value === 'error'
                ? `${message || 'MADCAT check failed'} — click to refresh auth and retry`
                : 'Checking global raw MADCAT measurements from the past 30 days';

    if (retryable) {
      button.addEventListener('click', () => {
        const fnsku = clean(row._fcratcMadcatFnsku);
        const asin = clean(row._fcratcMadcatAsin);
        const measurementId = fnsku || asin;
        checkMadcat(row, fnsku, asin, true, Boolean(measurementId));
      }, { once: true });
    }

    cell.replaceChildren(button);
  }

  function measurementBridgeUrl(identifier) {
    const url = new URL(`${MEASUREMENT_BRIDGE_SITE}/${encodeURIComponent(clean(identifier))}`);
    url.searchParams.set('fcrMadcatBridge', '1');
    url.searchParams.set('fcrMadcatAuto', '1');
    return url.href;
  }

  async function checkMadcat(row, fnskuValue, asinValue = '', force = false, openLoginBridge = false) {
    const fnsku = clean(fnskuValue);
    const asin = clean(asinValue);
    const measurementId = fnsku || asin;
    if (!row?.isConnected) return;
    row._fcratcMadcatFnsku = fnsku;
    row._fcratcMadcatAsin = asin;
    const checkSerial = (Number(row._fcratcMadcatCheckSerial) || 0) + 1;
    row._fcratcMadcatCheckSerial = checkSerial;
    paintMadcat(row, openLoginBridge ? 'auth' : 'checking');

    if (!measurementId) {
      paintMadcat(row, 'error', 'Measurement item unavailable');
      return;
    }

    let bridge = null;
    if (openLoginBridge) {
      bridge = window.open(measurementBridgeUrl(measurementId), 'fcrMadcatBridge', 'popup,width=560,height=680');
      if (!bridge) {
        paintMadcat(row, 'error', 'Measurement login popup blocked');
        return;
      }
    } else {
      try {
        const auth = await coreRequest('madcatAuthStatus', {}, 1200);
        if (!row.isConnected || row._fcratcMadcatCheckSerial !== checkSerial) return;
        if (!auth?.available && auth?.bridgeRecent) paintMadcat(row, 'auth');
      } catch {}
    }

    try {
      const result = await coreRequest('madcatRecent', {
        fnsku,
        asin,
        force,
        waitForAuthMs: bridge ? 6500 : 0
      }, 25000);
      if (!row.isConnected || row._fcratcMadcatCheckSerial !== checkSerial) return;
      const history = result?.madcatSource === 'history' || result?.fallback === 'inventory-history';
      paintMadcat(row, history
        ? (result?.madcat === true ? 'history-yes' : 'history-no')
        : (result?.madcat === true ? 'yes' : 'no'), clean(result?.fallbackReason || ''));
    } catch (error) {
      if (!row.isConnected || row._fcratcMadcatCheckSerial !== checkSerial) return;
      paintMadcat(row, 'error', clean(error?.message || 'MADCAT check failed'));
    }
  }
'''
s = regex_once(s,
    r"  function paintMadcat\(row, state, message = ''\) \{.*?\n  function paintResult\(",
    new_fcl + "\n  function paintResult(",
    'fcl MADCAT block')
write(path, s)


# ---------- README ----------
path = 'README.md'
s = read(path)
s = replace_once(s, '| FCR Data Core | 0.2.15 |', '| FCR Data Core | 0.2.17 |', 'README core')
s = replace_once(s, '| FCResearch Master | 0.1.22 |', '| FCResearch Master | 0.1.25 |', 'README master')
s = replace_once(s, '| FC-Lite | 0.1.62 |', '| FC-Lite | 0.1.64 |', 'README fcl')
write(path, s)

print('MADCAT auto-auth patch applied')
