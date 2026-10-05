import { FcrReadError } from './fcr-read.mjs';

export const FCR_ENRICHMENT_VERSION = '0.1.0';
export const MEASUREMENT_ORIGIN = 'https://o0avbo02yl.execute-api.ap-northeast-1.amazonaws.com';
const BIN_URL = 'https://aft-poirot-website-nrt.nrt.proxy.amazon.com/api/scanitem';
const PANDASH_URL = 'https://pandash.amazon.com/GridServlet';
const clean = value => String(value ?? '').trim();
const upper = value => clean(value).toUpperCase();
const fail = (code, message, options) => new FcrReadError(code, message, options);
function active(signal) { if (signal?.aborted) throw fail('CANCELLED', 'Enrichment read cancelled', { cause: signal.reason }); }

function allowed(url, method) {
  const value = new URL(url);
  return !value.username && !value.password && (
    (value.origin + value.pathname === PANDASH_URL && ['GET', 'POST'].includes(method)) ||
    (value.origin + value.pathname === BIN_URL && method === 'POST') ||
    (value.origin === MEASUREMENT_ORIGIN && /^\/prod\/measurementEvents\/[A-Z0-9]{10}\/(?:FNSKU|ASIN)$/.test(value.pathname) && method === 'GET')
  );
}

export function createGmJsonReader(gmRequest, { timeoutMs = 15000 } = {}) {
  if (typeof gmRequest !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw fail('INPUT', 'GM read transport configuration is invalid');
  return function read({ url, method = 'GET', headers = {}, body, signal }) {
    active(signal);
    try { if (!allowed(url, method)) throw new Error(); } catch { throw fail('INPUT', 'Unsupported external read endpoint'); }
    return new Promise((resolve, reject) => {
      let handle, settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true; signal?.removeEventListener('abort', cancelled);
        if (error) reject(error); else resolve(value);
      };
      const cancelled = () => {
        finish(fail('CANCELLED', 'External read cancelled', { cause: signal.reason }));
        try { handle?.abort(); } catch { /* Cancellation outcome remains cancelled. */ }
      };
      signal?.addEventListener('abort', cancelled, { once: true });
      try {
        handle = gmRequest({
          url, method, headers, ...(body == null ? {} : { data: body }), responseType: 'text', timeout: timeoutMs,
          onload: response => {
            if (settled) return;
            try {
              active(signal);
              if ([401, 403].includes(response.status)) throw fail('AUTH_REQUIRED', 'External read authentication required', { status: response.status });
              const final = response.finalUrl ? new URL(response.finalUrl) : new URL(url), requested = new URL(url);
              if (final.origin !== requested.origin || final.pathname !== requested.pathname) throw fail('AUTH_REQUIRED', 'External read redirected to another resource');
              if (response.status < 200 || response.status >= 300) throw fail('HTTP', 'External read HTTP ' + response.status, { status: response.status });
              if (typeof response.responseText !== 'string' || response.responseText.length > 1000000) throw fail('SCHEMA', 'External read body is invalid or too large');
              let value;
              try { value = JSON.parse(response.responseText); } catch { throw fail('SCHEMA', 'External read did not return JSON'); }
              if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('SCHEMA', 'External read JSON object is missing');
              finish(null, value);
            } catch (error) { finish(error); }
          },
          onerror: () => finish(fail('NETWORK', 'External read request failed')),
          ontimeout: () => finish(fail('TIMEOUT', 'External read timed out')),
          onabort: () => finish(fail('CANCELLED', 'External read aborted'))
        });
        if (signal?.aborted) cancelled();
      } catch (cause) { finish(fail('NETWORK', 'External read could not start', { cause })); }
    });
  };
}

export function createFcrEnrichment({
  warehouse, readJson, getMeasurementAuth = async () => null, historyFallback,
  now = Date.now, uuid = () => crypto.randomUUID(), maxMeasurementPages = 10, onEvidence = () => {}
}) {
  if (!/^[A-Z0-9-]{2,12}$/.test(warehouse) || typeof readJson !== 'function' ||
      !Number.isInteger(maxMeasurementPages) || maxMeasurementPages < 1 || maxMeasurementPages > 100) throw fail('INPUT', 'Enrichment configuration is invalid');
  function evidence(endpoint, data) {
    try { onEvidence({ type: 'fcr.read', script: 'FCR ENRICHMENT', version: FCR_ENRICHMENT_VERSION, intent: 'read', data: { endpoint, ...data } }); }
    catch { /* OBS is optional. */ }
  }
  async function read(options) {
    active(options.signal);
    try { const result = await readJson(options); active(options.signal); return result; }
    catch (error) {
      active(options.signal);
      const path = new URL(options.url).pathname;
      evidence(path.startsWith('/prod/measurementEvents/') ? 'measurementEvents' : path.split('/').at(-1), { outcome: 'failed', code: error.code || 'NETWORK' });
      throw error;
    }
  }

  async function hazmat(asinValue, { signal } = {}) {
    const asin = upper(asinValue);
    if (!/^B[A-Z0-9]{9}$/.test(asin)) throw fail('INPUT', 'An exact ASIN is required');
    let restriction = 'default', restrictionWarning = '';
    try {
      const settings = await read({ url: PANDASH_URL + '?fc=' + encodeURIComponent(warehouse), signal });
      if (typeof settings.restriction === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(settings.restriction)) restriction = settings.restriction;
      else restrictionWarning = 'Native restriction unavailable; default restriction used';
    } catch (error) {
      active(signal);
      if (error.code === 'AUTH_REQUIRED') throw error;
      restrictionWarning = 'Restriction lookup failed; default restriction used';
    }
    const payload = await read({ url: PANDASH_URL, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ language: 'default', source: restriction + '-hazmat-FC', marketPlaces: 'AU', asins: asin, rows: '1', page: '1', fc: warehouse }).toString(), signal });
    if (!Array.isArray(payload.rows)) throw fail('SCHEMA', 'Hazmat rows are missing');
    const matches = payload.rows.filter(row => upper(row?.asin) === asin);
    if (!matches.length) return { hazmat: null, complete: false, warning: 'No exact ASIN hazmat result', source: 'network' };
    const mapped = matches.map(row => {
      const level = Number(row.level);
      if (row.level == null || clean(row.level) === '' || !Number.isInteger(level) || level < 0 || typeof row.message !== 'string') throw fail('SCHEMA', 'Hazmat level/message is invalid');
      return { level, message: row.message };
    });
    if (new Set(mapped.map(row => JSON.stringify(row))).size > 1) throw fail('IDENTITY', 'Conflicting exact ASIN hazmat rows');
    active(signal); evidence('hazmat', { outcome: 'complete', level: mapped[0].level });
    return { hazmat: mapped[0], complete: true, warning: restrictionWarning, source: 'network' };
  }

  async function binDescription(containerValue, itemValue, { signal, verifiedAliases = [] } = {}) {
    const container = clean(containerValue), item = upper(itemValue);
    if (!container || container.length > 128 || !item || item.length > 128 || !Array.isArray(verifiedAliases)) throw fail('INPUT', 'Bin read identities are invalid');
    const payload = await read({ url: BIN_URL, method: 'POST', headers: { Accept: '*/*', 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ containerScannableId: container, isMasterpack: null, itemAndonContext: null,
        itemBarcode: item, requestId: 'amzn1.fc.v1.common.request-id.v1.AFTPoirotWebsite.' + uuid(), tool: 'V3' }) });
    if (!Array.isArray(payload.items)) throw fail('SCHEMA', 'Native bin item rows are missing');
    const wanted = new Set([item, ...verifiedAliases.map(upper)]), matches = [];
    for (const row of payload.items) {
      if (!row || typeof row !== 'object') throw fail('SCHEMA', 'Native bin item row is invalid');
      // A shared ASIN cannot override an explicitly different returned FNSKU.
      if (/^X[A-Z0-9]{9}$/.test(item) && row.skuDetail?.fnSku && upper(row.skuDetail.fnSku) !== item) continue;
      const codes = [row.scannableId, row.value, row.scannedBarcode, row.skuDetail?.fnSku, row.skuDetail?.asin, row.skuDetail?.fcSku].map(upper).filter(Boolean);
      const matched = codes.find(code => wanted.has(code));
      if (matched && typeof row.binDescription === 'string' && clean(row.binDescription)) matches.push({ size: clean(row.binDescription), matched });
    }
    if (!matches.length) return { size: '', complete: false, warning: 'No exact-item binDescription returned', source: 'network' };
    if (new Set(matches.map(row => row.size)).size > 1) throw fail('IDENTITY', 'Conflicting exact-item binDescription');
    active(signal); evidence('scanitem', { outcome: 'complete' });
    return { ...matches[0], complete: true, source: 'network' };
  }

  async function fallback(identifier, reason, signal, authRequired) {
    active(signal);
    const result = historyFallback ? await historyFallback(identifier, { signal }) : null;
    active(signal);
    if (result && typeof result.madcat !== 'boolean') throw fail('SCHEMA', 'History fallback result is invalid');
    return { madcat: result?.madcat === true ? true : result?.complete === true ? false : null,
      source: 'history-fallback', madcatSource: 'history', complete: result?.complete === true, windowDays: null,
      authRequired, fallbackReason: reason, historyRows: result?.rows || 0 };
  }

  async function recentMadcat({ fnsku, asin }, { signal, forceAuth = false } = {}) {
    const identifier = upper(fnsku || asin), identifierType = fnsku ? 'FNSKU' : 'ASIN';
    if (!/^[A-Z0-9]{10}$/.test(identifier)) throw fail('INPUT', 'Measurement identifier is invalid');
    const before = now(), after = before - 30 * 24 * 60 * 60 * 1000;
    let auth = await getMeasurementAuth(identifier, { signal, force: forceAuth });
    active(signal);
    const validAuth = value => value && typeof value.token === 'string' && value.token && Number.isFinite(value.expiresAt) && value.expiresAt > now() + 10000;
    if (!validAuth(auth)) return fallback(identifier, 'measurement-login-required', signal, true);
    const url = new URL(MEASUREMENT_ORIGIN + '/prod/measurementEvents/' + identifier + '/' + identifierType);
    url.searchParams.set('effectiveAfter', new Date(after).toISOString()); url.searchParams.set('effectiveBefore', new Date(before).toISOString());
    const seen = new Set(); let next = '', pages = 0, eventsChecked = 0, renewed = false;
    do {
      active(signal);
      if (pages >= maxMeasurementPages || (next && seen.has(next))) throw fail('PAGINATION', 'Measurement history incomplete or repeated');
      if (next) { seen.add(next); url.searchParams.set('nextToken', next); } else url.searchParams.delete('nextToken');
      let payload;
      try { payload = await read({ url: url.href, headers: { Accept: 'application/json', Authorization: auth.token }, signal }); }
      catch (error) {
        active(signal);
        if (error.code === 'AUTH_REQUIRED' && !renewed) {
          renewed = true;
          const fresh = await getMeasurementAuth(identifier, { signal, force: true, previousToken: auth.token });
          active(signal);
          if (!validAuth(fresh) || fresh.token === auth.token) return fallback(identifier, 'measurement-token-expired', signal, true);
          auth = fresh;
          try { payload = await read({ url: url.href, headers: { Accept: 'application/json', Authorization: auth.token }, signal }); }
          catch (retryError) {
            active(signal);
            if (retryError.code === 'AUTH_REQUIRED') return fallback(identifier, 'measurement-token-expired', signal, true);
            if (retryError.status === 400) return fallback(identifier, 'measurement-http-400', signal, false);
            throw retryError;
          }
        } else if (error.code === 'AUTH_REQUIRED') return fallback(identifier, 'measurement-token-expired', signal, true);
        else if (error.status === 400) return fallback(identifier, 'measurement-http-400', signal, false);
        else throw error;
      }
      if (!Array.isArray(payload.measurementEvents) || payload.measurementEvents.length > 10000) throw fail('SCHEMA', 'Measurement events are missing or oversized');
      let positive = false;
      for (const event of payload.measurementEvents) {
        if (!event || typeof event.measurementSource !== 'string' || !event.measurementSource || !Number.isFinite(Date.parse(event.measurementInstant))) {
          throw fail('SCHEMA', 'Measurement event source/time is invalid');
        }
        const instant = Date.parse(event.measurementInstant);
        if (upper(event.measurementSource) === 'MADCAT' && instant >= after && instant <= before) positive = true;
      }
      pages++; eventsChecked += payload.measurementEvents.length;
      if (payload.nextToken != null && typeof payload.nextToken !== 'string') throw fail('PAGINATION', 'Measurement continuation token is invalid');
      next = clean(payload.nextToken);
      if (next.length > 16384) throw fail('PAGINATION', 'Measurement continuation token is oversized');
      if (positive) {
        active(signal); evidence('measurementEvents', { outcome: 'positive', pages, eventsChecked });
        return { madcat: true, madcatSource: 'raw', windowDays: 30, complete: true, pages, eventsChecked, identifierType, source: 'network' };
      }
    } while (next);
    active(signal); evidence('measurementEvents', { outcome: 'negative', pages, eventsChecked });
    return { madcat: false, madcatSource: 'raw', windowDays: 30, complete: true, pages, eventsChecked, identifierType, source: 'network' };
  }
  return Object.freeze({ hazmat, binDescription, recentMadcat });
}
