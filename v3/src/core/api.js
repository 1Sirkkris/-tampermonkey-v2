V3.api = (() => {
  const OutcomeUnknownError = V3.operation.OutcomeUnknownError;
  const RejectedError = V3.operation.RejectedError;

  const authLike = (status, contentType, finalUrl, raw) => {
    const html = /text\/html|application\/xhtml/i.test(contentType || '') ||
      /^\s*(?:<!doctype\s+html|<html\b)/i.test(raw || '');
    const auth = [401,403,419].includes(Number(status)) ||
      /(?:^|[\/?#._-])(?:login|signin|sign-in|midway|sso|auth|authenticate|federat)(?:[\/?#._-]|$)/i.test(finalUrl || '') ||
      (html && /\b(?:sign\s*in|log\s*in|authentication|midway|single\s+sign[- ]?on)\b/i.test(raw || ''));
    return { html, auth };
  };
  const parseRaw = raw => { try { return raw ? JSON.parse(raw) : null; } catch { return raw; } };

  async function fetchRequest(url, options = {}) {
    const method = options.method || 'GET';
    const timeout = Number(options.timeout || 15000);
    const mutation = options.mutation === true;
    const operation = options.operation;
    const telemetry = options.telemetry;
    const externalSignal = options.signal;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('timeout'), timeout);
    const forward = () => controller.abort(externalSignal.reason || 'aborted');
    externalSignal?.addEventListener?.('abort', forward, { once:true });
    const started = performance.now();

    if (mutation) operation?.submitted({ url:String(url).split('?')[0] });

    try {
      let response;
      try {
        response = await fetch(url, {
          method,
          body:options.body,
          headers:options.headers || {},
          credentials:options.credentials || 'same-origin',
          cache:'no-store',
          redirect:'follow',
          signal:controller.signal
        });
      } catch (error) {
        if (mutation) {
          operation?.unknown({ reason:'transport', message:String(error?.message || error) });
          throw new OutcomeUnknownError('Request submitted; confirmation was lost', { cause:error });
        }
        throw error;
      }

      const raw = await response.text();
      const finalUrl = response.url || String(url);
      const contentType = response.headers.get('content-type') || '';
      const auth = authLike(response.status, contentType, finalUrl, raw);
      telemetry?.emit('transport', {
        method, url:String(url).split('?')[0], status:response.status,
        ms:Math.round(performance.now()-started), auth:auth.auth, html:auth.html, mutation
      });

      if (auth.auth || auth.html) {
        if (mutation) {
          operation?.unknown({ status:response.status, reason:'auth-or-html' });
          throw new OutcomeUnknownError('Mutation confirmation was not an API response', { status:response.status });
        }
        throw new Error('Authentication/HTML response instead of API data');
      }

      if (!response.ok) {
        if (mutation && response.status >= 500) {
          operation?.unknown({ status:response.status, reason:'server' });
          throw new OutcomeUnknownError('HTTP ' + response.status + '; mutation outcome unknown', { status:response.status });
        }
        operation?.rejected({ status:response.status });
        throw new RejectedError('HTTP ' + response.status, { status:response.status, data:parseRaw(raw) });
      }

      return {
        status:response.status, raw, data:parseRaw(raw), finalUrl, contentType,
        ms:Math.round(performance.now()-started), response
      };
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener?.('abort', forward);
    }
  }

  function gmRequest(url, options = {}) {
    if (typeof GM_xmlhttpRequest !== 'function') return Promise.reject(new Error('GM_xmlhttpRequest unavailable'));
    const method = options.method || 'GET';
    const mutation = options.mutation === true;
    const operation = options.operation;
    const telemetry = options.telemetry;
    const started = performance.now();

    if (mutation) operation?.submitted({ url:String(url).split('?')[0] });

    return new Promise((resolve,reject) => {
      let settled = false;
      const unknown = (message, meta = {}) => {
        if (settled) return;
        settled = true;
        operation?.unknown(meta);
        reject(new OutcomeUnknownError(message, meta));
      };
      try {
        GM_xmlhttpRequest({
          method,
          url,
          data:options.data,
          headers:options.headers || {},
          timeout:Number(options.timeout || 15000),
          anonymous:options.anonymous === true,
          onload:response => {
            if (settled) return;
            settled = true;
            const raw = String(response.responseText ?? (typeof response.response === 'string' ? response.response : ''));
            const contentType = String(response.responseHeaders || '').split(/\r?\n/)
              .find(line => /^content-type:/i.test(line))?.split(':').slice(1).join(':').trim() || '';
            const finalUrl = response.finalUrl || response.responseURL || url;
            const auth = authLike(response.status, contentType, finalUrl, raw);
            telemetry?.emit('transport', {
              method, url:String(url).split('?')[0], status:response.status,
              ms:Math.round(performance.now()-started), auth:auth.auth, html:auth.html, mutation
            });

            if (auth.auth || auth.html) {
              if (mutation) {
                operation?.unknown({ status:response.status, reason:'auth-or-html' });
                reject(new OutcomeUnknownError('Mutation confirmation was not an API response', { status:response.status }));
              } else reject(new Error('Authentication/HTML response instead of API data'));
              return;
            }

            if (response.status < 200 || response.status >= 300) {
              if (mutation && response.status >= 500) {
                operation?.unknown({ status:response.status, reason:'server' });
                reject(new OutcomeUnknownError('HTTP ' + response.status + '; mutation outcome unknown', { status:response.status }));
              } else {
                operation?.rejected({ status:response.status });
                reject(new RejectedError('HTTP ' + response.status, { status:response.status, data:parseRaw(raw) }));
              }
              return;
            }

            resolve({
              status:response.status, raw, data:parseRaw(raw), finalUrl, contentType,
              ms:Math.round(performance.now()-started), response
            });
          },
          ontimeout:() => mutation ? unknown('Request timed out after submission', {reason:'timeout'}) : reject(new Error('Request timed out')),
          onerror:() => mutation ? unknown('Network error after submission', {reason:'network'}) : reject(new Error('Network error')),
          onabort:() => mutation ? unknown('Request aborted after submission', {reason:'abort'}) : reject(new DOMException('Aborted','AbortError'))
        });
      } catch (error) {
        mutation ? unknown('Request failed after submission', {reason:'throw'}) : reject(error);
      }
    });
  }

  return Object.freeze({ fetchRequest, gmRequest, authLike, parseRaw });
})();