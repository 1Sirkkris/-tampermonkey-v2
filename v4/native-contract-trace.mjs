import { createCaptureRedactor } from './native-capture-redact.mjs';

function selected(window, workflow, raw, method) {
  if (!/^(?:GET|POST)$/i.test(method)) return false;
  try {
    const url = new window.URL(raw, window.location.href);
    if (url.origin !== window.location.origin || url.username || url.password) return false;
    if (workflow === 'FCR') return /^\/[A-Z0-9-]+\/results\/(?:container-hierarchy(?:-up)?|inventory)$/.test(url.pathname);
    if (workflow === 'AFT') return /^\/(?:instruction|status|action|end)$/.test(url.pathname)
      || method.toUpperCase() === 'GET' && /^\/app\/(?:edititems|moveitems|fcskuflip)$/.test(url.pathname);
    return workflow === 'MoveContainer' && url.pathname === '/api/move-container';
  } catch { return false; }
}

// Installed only by an explicit menu action. Observes native calls; never sends one.
export function createNativeContractTrace({ window, page = window, workflow, version,
  maxRecords = 100, maxBytes = 4000000, maxBody = 250000, durationMs = 180000, onStop = () => {} }) {
  const redact = createCaptureRedactor(window), records = [], readers = new Set(), listeners = new Set(), xhrDetails = new WeakMap();
  const startedAt = new Date().toISOString(), pageUrl = redact.url(window.location.href);
  const originalFetch = page.fetch, proto = page.XMLHttpRequest?.prototype, originalOpen = proto?.open, originalSend = proto?.send;
  let active = true, reason = null, stoppedAt = null, bytes = 0, timer;
  const size = text => new window.Blob([text]).size;
  const errorName = error => /^[A-Za-z]*Error$/.test(error?.name) ? error.name : 'Error';
  function capturedBody(raw) {
    if (typeof raw !== 'string') return { state: 'UNAVAILABLE', reason: 'Nontext body not collected' };
    if (size(raw) > maxBody) return { state: 'OMITTED_LIMIT', reason: 'Body size limit' };
    try {
      const body = redact.body(raw), length = size(body);
      if (length > maxBody || bytes + length > maxBytes) return { state: 'OMITTED_LIMIT', reason: 'Body/total size limit' };
      bytes += length; return { state: 'CAPTURED', body };
    } catch { return { state: 'UNAVAILABLE', reason: 'Body redaction failed or exceeded structural limit' }; }
  }
  function begin(rawUrl, method, body, transport, requestObject = false) {
    if (!active || !selected(window, workflow, rawUrl, method)) return null;
    if (records.length >= maxRecords) { stop('record-limit'); return null; }
    let request;
    if (body == null) request = requestObject && method.toUpperCase() !== 'GET'
      ? { state: 'UNAVAILABLE', reason: 'Request body not synchronously supplied; original Request untouched' } : { state: 'ABSENT' };
    else if (typeof body === 'string') request = capturedBody(body);
    else if (body instanceof window.URLSearchParams) request = capturedBody(body.toString());
    else request = { state: 'UNAVAILABLE', reason: 'Nontext request body not collected' };
    const record = { id: 'CAPTURE' + String(records.length + 1).padStart(4, '0'), transport,
      method: String(method).toUpperCase(), url: redact.url(rawUrl), startedAt: new Date().toISOString(), request,
      response: { state: 'PENDING' } };
    records.push(record); return record;
  }
  function finish(record, response) {
    if (!active || record.response.state !== 'PENDING') return;
    record.response = { ...response, finishedAt: new Date().toISOString() };
    if (bytes >= maxBytes) stop('byte-limit');
  }
  function responseMetadata(response, fallback) {
    let url;
    let finalUrlMatchesRequest = false;
    try {
      const raw = response.responseURL || response.url || fallback;
      finalUrlMatchesRequest = new window.URL(raw, window.location.href).href === new window.URL(fallback, window.location.href).href;
      url = redact.url(raw);
    } catch { url = '[INVALID URL]'; }
    return { status: Number(response.status) || 0, url, redirected: !!response.redirected, finalUrlMatchesRequest };
  }
  async function readClone(clone) {
    if (clone.body === null) return { state: 'CAPTURED', body: '' };
    if (typeof clone.body?.getReader !== 'function') return { state: 'UNAVAILABLE', reason: 'Bounded response stream unavailable' };
    const decoder = new window.TextDecoder(), reader = clone.body.getReader(); readers.add(reader);
    let raw = '', length = 0;
    try {
      while (active) {
        const { done, value } = await reader.read();
        if (!active) return null;
        if (done) return capturedBody(raw + decoder.decode());
        length += value.byteLength;
        if (length > maxBody || bytes + length > maxBytes) {
          void reader.cancel().catch(() => {});
          return { state: 'OMITTED_LIMIT', reason: 'Body/total stream size limit' };
        }
        raw += decoder.decode(value, { stream: true });
      }
      return null;
    } finally { readers.delete(reader); }
  }
  const fetchWrapper = function (input, init) {
    const options = init || {}, rawUrl = typeof input === 'string' || input instanceof window.URL ? String(input) : input?.url;
    let record;
    try { record = begin(rawUrl, options.method || input?.method || 'GET', options.body, 'fetch', !!input?.url); } catch {}
    let promise;
    try { promise = originalFetch.apply(this, arguments); }
    catch (error) { if (record) finish(record, { state: 'FAILED', reason: 'Native fetch threw ' + errorName(error) }); throw error; }
    if (record) {
      try {
        // Attach an observer but return the exact original Promise to the caller.
        void promise.then(response => {
          if (!active) return;
          let clone, metadata;
          try { metadata = responseMetadata(response, rawUrl); clone = response.clone(); }
          catch { finish(record, { state: 'UNAVAILABLE', reason: 'Native response clone unavailable' }); return; }
          void readClone(clone).then(body => { if (body) finish(record, { ...metadata, ...body }); },
            error => finish(record, { ...metadata, state: 'FAILED', reason: 'Clone read failed ' + errorName(error) }));
        }, error => finish(record, { state: 'FAILED', reason: 'Native fetch rejected ' + errorName(error) }));
      } catch { finish(record, { state: 'UNAVAILABLE', reason: 'Native fetch is not observable as a Promise' }); }
    }
    return promise;
  };
  function openWrapper(method, url) {
    const result = originalOpen.apply(this, arguments);
    try { if (active) xhrDetails.set(this, { method: String(method), url: String(url) }); } catch {}
    return result;
  }
  function sendWrapper(body) {
    const details = xhrDetails.get(this); let record;
    try { if (details) record = begin(details.url, details.method, body, 'xhr'); } catch {}
    if (!record) return originalSend.apply(this, arguments);
    const xhr = this; let failure = null;
    const error = event => { failure = event.type; };
    const cleanup = () => { xhr.removeEventListener('loadend', ended); for (const type of ['error', 'abort', 'timeout']) xhr.removeEventListener(type, error); listeners.delete(cleanup); };
    const ended = () => {
      cleanup(); if (!active) return;
      try {
        const metadata = responseMetadata(xhr, details.url);
        const raw = xhr.responseType === 'json' ? JSON.stringify(xhr.response)
          : !xhr.responseType || xhr.responseType === 'text' ? xhr.responseText : null;
        finish(record, { ...metadata, ...(failure ? { state: 'FAILED', reason: 'Native XHR ' + failure } : capturedBody(raw)) });
      } catch { finish(record, { state: 'UNAVAILABLE', reason: 'Native XHR response inaccessible' }); }
    };
    listeners.add(cleanup); xhr.addEventListener('loadend', ended, { once: true });
    for (const type of ['error', 'abort', 'timeout']) xhr.addEventListener(type, error);
    try { return originalSend.apply(this, arguments); }
    catch (error) { cleanup(); finish(record, { state: 'FAILED', reason: 'Native XHR send threw ' + errorName(error) }); throw error; }
  }
  function stop(why = 'manual') {
    if (!active) return snapshot();
    active = false; reason = why; stoppedAt = new Date().toISOString(); window.clearTimeout(timer);
    if (page.fetch === fetchWrapper) page.fetch = originalFetch;
    if (proto?.open === openWrapper) proto.open = originalOpen;
    if (proto?.send === sendWrapper) proto.send = originalSend;
    for (const cleanup of [...listeners]) cleanup();
    for (const reader of readers) { try { void reader.cancel().catch(() => {}); } catch {} } readers.clear();
    for (const record of records) if (record.response.state === 'PENDING') record.response = {
      state: 'INTERRUPTED', reason: 'Trace stopped before native response was captured', finishedAt: stoppedAt };
    try { onStop(why); } catch {}
    return snapshot();
  }
  function snapshot() {
    return { diagnostic: workflow + ' passive native response trace', workflow, version, page: pageUrl,
      startedAt, stoppedAt, reason, records, limits: { maxRecords, maxBytes, maxBody, durationMs, capturedBodyBytes: bytes },
      warnings: ['Passive observation only: no native request, input or workflow action is initiated.',
        'Native status/body are evidence, never automatic confirmation of an operation or authentication.',
        'No cookies, browser storage or request/response headers collected. Review remaining text before sharing.',
        'Container and workflow/request aliases correlate only within this file; originals/mappings are not exported.',
        'Pending, failed, omitted and unavailable responses are explicit; late results after Stop are not collected.'] };
  }
  try {
    if (typeof originalFetch === 'function') page.fetch = fetchWrapper;
    if (typeof originalOpen === 'function' && typeof originalSend === 'function') { proto.open = openWrapper; proto.send = sendWrapper; }
  } catch { stop('transport-unavailable'); throw new Error('Native trace transport is unavailable; no request sent'); }
  timer = window.setTimeout(() => stop('duration-limit'), durationMs);
  return { stop, get active() { return active; }, dispose() { stop('navigation/disposal'); records.length = 0; } };
}
