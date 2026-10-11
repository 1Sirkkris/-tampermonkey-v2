import { FcrReadError } from './fcr-read.mjs';
import { MEASUREMENT_ORIGIN } from './fcr-enrichment.mjs';

export const MEASUREMENT_AUTH_VERSION = '0.1.3';
export const MEASUREMENT_AUTH_KEY = 'tm-v4.measurement.auth';
const SITE = 'https://jp.item-measurement.aft.a2z.com';
const GUARD = Symbol.for('tampermonkey.v4.measurement.capture');
const failure = (code, message, cause) => new FcrReadError(code, message, { cause });

export function normalizeMeasurementToken(value, now = Date.now()) {
  const token = String(value ?? '').trim().replace(/^Bearer\s+/i, '');
  if (token.length > 16384 || token.split('.').length !== 3) return null;
  try {
    const middle = token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/');
    const binary = atob(middle.padEnd(Math.ceil(middle.length / 4) * 4, '='));
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, character => character.charCodeAt(0))));
    const expiresAt = payload.exp * 1000;
    if (payload.token_use !== 'id' || typeof payload.exp !== 'number' || !Number.isInteger(payload.exp) || !Number.isFinite(expiresAt) || expiresAt <= now + 10000) return null;
    return { token, expiresAt };
  } catch { return null; }
}

function authHeader(headers) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get('Authorization') || '';
  const entries = Array.isArray(headers) ? headers : Object.entries(headers);
  return entries.find(entry => Array.isArray(entry) && /^authorization$/i.test(String(entry[0])))?.[1] || '';
}

function nativeMeasurementUrl(value, page) {
  try {
    const url = new URL(value, page.location.href);
    return url.origin === MEASUREMENT_ORIGIN && /^\/prod\/measurementEvents\/[A-Z0-9]{10}\/(?:FNSKU|ASIN)$/.test(url.pathname);
  } catch { return false; }
}

// Installs only on the native Measurement site. The eventual Master installer includes both origins.
export function installMeasurementCapture({ page, storage, now = Date.now }) {
  if (page.location.origin !== SITE) throw failure('INPUT', 'Measurement capture requires the native Measurement page');
  if (page[GUARD]) return page[GUARD].subscribe(storage, now);
  const controller = new page.AbortController(), details = new WeakMap();
  const subscribers = new Map();
  const originalFetch = page.fetch, proto = page.XMLHttpRequest?.prototype;
  const originalOpen = proto?.open, originalHeader = proto?.setRequestHeader, originalSend = proto?.send;
  const observe = fn => { try { fn(); } catch { /* Native calls must remain unchanged. */ } };
  function save(raw) {
    if (controller.signal.aborted) return;
    for (const [target, subscriber] of subscribers) observe(() => {
      const capturedAt = subscriber.now(), value = normalizeMeasurementToken(raw, capturedAt);
      if (value) target.set(MEASUREMENT_AUTH_KEY, JSON.stringify({ ...value, capturedAt, captureId: page.crypto.randomUUID() }));
    });
  }
  const wrappedFetch = function (...args) {
    const result = Reflect.apply(originalFetch, this, args);
    let raw = '';
    observe(() => {
      const input = args[0], url = typeof input === 'string' || input instanceof page.URL ? String(input) : input?.url;
      if (nativeMeasurementUrl(url, page)) raw = args[1]?.headers !== undefined ? authHeader(args[1].headers) : authHeader(input?.headers);
    });
    observe(() => save(raw));
    return result;
  };
  const wrappedOpen = function (...args) {
    const result = Reflect.apply(originalOpen, this, args);
    observe(() => details.set(this, { wanted: nativeMeasurementUrl(args[1], page), token: '' }));
    return result;
  };
  const wrappedHeader = function (...args) {
    const result = Reflect.apply(originalHeader, this, args);
    observe(() => { const detail = details.get(this); if (detail?.wanted && /^authorization$/i.test(String(args[0]))) detail.token = String(args[1]); });
    return result;
  };
  const wrappedSend = function (...args) {
    const detail = details.get(this);
    const result = Reflect.apply(originalSend, this, args);
    if (detail?.wanted) observe(() => save(detail.token));
    return result;
  };
  function dispose() {
    if (controller.signal.aborted) return;
    controller.abort();
    if (page.fetch === wrappedFetch) page.fetch = originalFetch;
    if (proto?.open === wrappedOpen) proto.open = originalOpen;
    if (proto?.setRequestHeader === wrappedHeader) proto.setRequestHeader = originalHeader;
    if (proto?.send === wrappedSend) proto.send = originalSend;
    if (page[GUARD] === capture) delete page[GUARD];
  }
  if (typeof originalFetch === 'function') page.fetch = wrappedFetch;
  if (typeof originalOpen === 'function' && typeof originalHeader === 'function' && typeof originalSend === 'function') {
    proto.open = wrappedOpen; proto.setRequestHeader = wrappedHeader; proto.send = wrappedSend;
  }
  function subscribe(target, clock) {
    const existing = subscribers.get(target);
    if (existing) return existing.dispose;
    let stopped = false;
    const release = () => {
      if (stopped) return;
      stopped = true; subscribers.delete(target);
      if (!subscribers.size) dispose();
    };
    subscribers.set(target, { now: clock, dispose: release });
    return release;
  }
  const capture = { subscribe };
  page[GUARD] = capture;
  return subscribe(storage, now);
}

export function createMeasurementAuth({ window, storage, now = Date.now, timeoutMs = 10000, onEvidence = () => {} }) {
  if (!window?.document || !storage || !['get', 'listen', 'remove'].every(key => typeof storage[key] === 'function') ||
      !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw failure('INPUT', 'Measurement auth configuration is invalid');
  // Only this provider's compatible cold callers share a native frame. Forced
  // capture and different rejected-token requirements retain separate owners.
  const coldAcquisitions = new Map();
  function evidence(data) {
    try { onEvidence({ type: 'fcr.auth', script: 'MEASUREMENT AUTH', version: MEASUREMENT_AUTH_VERSION, intent: 'read', data: { endpoint: 'measurement-auth', ...data } }); }
    catch { /* OBS is optional; never include credential or item values. */ }
  }
  function read() {
    try {
      const raw = storage.get(MEASUREMENT_AUTH_KEY, 'null');
      const stored = JSON.parse(raw);
      return stored ? normalizeMeasurementToken(stored.token, now()) : null;
    } catch (cause) { throw failure('STORAGE', 'Measurement auth storage cannot be read', cause); }
  }
  function loginUrl(identifier) {
    const code = String(identifier ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(code)) throw failure('INPUT', 'Measurement login identifier is invalid');
    const url = new URL(SITE + '/item/' + code);
    url.searchParams.set('tmV4MeasurementAuth', '1');
    return url.href;
  }
  async function acquire(identifier, { signal, force = false, previousToken } = {}) {
    const url = loginUrl(identifier);
    if (signal?.aborted) throw failure('CANCELLED', 'Measurement acquisition cancelled', signal.reason);
    const cached = read();
    if (!force && cached && cached.token !== previousToken) { evidence({ outcome: 'cached' }); return cached; }
    let baseline;
    try { baseline = force ? storage.get(MEASUREMENT_AUTH_KEY, 'null') : null; }
    catch (cause) { throw failure('STORAGE', 'Measurement auth storage cannot be read', cause); }
    let acquisition = !force && coldAcquisitions.get(previousToken);
    if (!acquisition) {
      acquisition = createAcquisition(url, { force, previousToken, baseline });
      if (!force) coldAcquisitions.set(previousToken, acquisition);
    }
    return acquisition.subscribe(signal);
  }
  function createAcquisition(url, { force, previousToken, baseline }) {
    const subscribers = new Set();
    let listener = null, frame = null, started = false, closed = false;
    function cleanup() {
      if (listener != null) { try { storage.remove(listener); } catch { /* Document lifecycle owns the native listener fallback. */ } }
      listener = null; frame?.remove(); frame = null;
    }
    function release() {
      if (subscribers.size) return;
      closed = true;
      if (!force && coldAcquisitions.get(previousToken) === acquisition) coldAcquisitions.delete(previousToken);
      cleanup();
    }
    function finish(error, value = null) {
      for (const subscriber of [...subscribers]) subscriber.finish(error, value);
    }
    function changed() {
      if (closed) return;
      try {
        if (force && storage.get(MEASUREMENT_AUTH_KEY, 'null') === baseline) return;
        const value = read(); if (value && value.token !== previousToken) finish(null, value);
      } catch (error) { finish(error); }
    }
    function start() {
      started = true;
      try {
        listener = storage.listen(MEASUREMENT_AUTH_KEY, changed);
        // Synchronous notification can settle the last subscriber before listen
        // returns its handle; release that handle after it becomes available.
        if (closed) { cleanup(); return; }
        if (!force) changed();
        if (closed) return;
        frame = window.document.createElement('iframe');
        frame.dataset.tmV4Auth = 'measurement'; frame.tabIndex = -1;
        frame.setAttribute('aria-hidden', 'true'); frame.setAttribute('inert', '');
        frame.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;opacity:0;pointer-events:none;border:0';
        frame.src = force ? url + '&tmV4MeasurementRefresh=' + encodeURIComponent(now()) : url;
        evidence({ outcome: 'started', stage: 'native-frame', renewal: force });
        (window.document.body || window.document.documentElement).append(frame);
      } catch (cause) { finish(cause instanceof FcrReadError ? cause : failure('AUTH_REQUIRED', 'Measurement acquisition could not start', cause)); }
    }
    const acquisition = { subscribe(signal) {
      return new Promise((resolve, reject) => {
        const joinedAt = now(); let timer = null, settled = false;
        const subscriber = { finish(error, value = null) {
          if (settled) return;
          settled = true;
          if (timer != null) window.clearTimeout(timer);
          signal?.removeEventListener('abort', cancelled);
          subscribers.delete(subscriber); release();
          evidence({ outcome: error ? 'failed' : value ? 'acquired' : 'unavailable', code: error?.code, stage: 'native-frame', elapsedMs: Math.max(0, now() - joinedAt) });
          if (error) reject(error); else resolve(value);
        } };
        const cancelled = () => subscriber.finish(failure('CANCELLED', 'Measurement acquisition cancelled', signal.reason));
        subscribers.add(subscriber);
        signal?.addEventListener('abort', cancelled, { once: true });
        if (signal?.aborted) { cancelled(); return; }
        timer = window.setTimeout(() => subscriber.finish(null), timeoutMs);
        if (!started) start();
      });
    } };
    return acquisition;
  }
  function watch(callback, { signal } = {}) {
    if (typeof callback !== 'function') throw failure('INPUT', 'Measurement auth callback is invalid');
    if (signal?.aborted) return () => {};
    let listener = null, stopped = false;
    const stop = () => {
      stopped = true;
      if (listener != null) { try { storage.remove(listener); } catch {} }
      signal?.removeEventListener('abort', stop);
    };
    signal?.addEventListener('abort', stop, { once: true });
    try {
      listener = storage.listen(MEASUREMENT_AUTH_KEY, () => {
        if (stopped) return;
        try {
          if (!read()) return;
          stop(); callback();
        } catch { stop(); }
      });
      if (stopped || signal?.aborted) stop();
    } catch { stop(); }
    return stop;
  }
  return Object.freeze({ read, acquire, loginUrl, watch });
}
