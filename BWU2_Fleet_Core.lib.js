(() => {
  'use strict';

  const ROOT = globalThis;
  if (ROOT.BWU2Fleet) return;

  const clean = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const upper = value => clean(value).toUpperCase();

  function registerRuntimeVersion(label, version) {
    const mount = () => {
      const root = document.body || document.documentElement;
      if (!root) return;
      let host = document.getElementById('bwu2-runtime-version-stamp');
      if (!host) {
        host = document.createElement('div');
        host.id = 'bwu2-runtime-version-stamp';
        host.setAttribute('aria-hidden', 'true');
        host.style.cssText = 'position:fixed;left:50%;bottom:2px;transform:translateX(-50%);z-index:2147483000;display:flex;flex-wrap:wrap;justify-content:center;gap:2px 10px;max-width:94vw;padding:2px 7px;border-radius:6px 6px 0 0;background:rgba(255,255,255,.34);color:rgba(15,23,42,.52);box-shadow:0 0 0 1px rgba(15,23,42,.05);backdrop-filter:blur(1.5px);font:800 11px/1.25 Arial,sans-serif;letter-spacing:.2px;pointer-events:none;user-select:none;text-shadow:0 1px 1px rgba(255,255,255,.95),0 0 3px rgba(255,255,255,.75)';
        root.appendChild(host);
      }
      let item = [...host.children].find(node => node.dataset?.bwu2RuntimeKey === label);
      if (!item) {
        item = document.createElement('span');
        item.dataset.bwu2RuntimeKey = label;
        host.appendChild(item);
      }
      item.textContent = `${label} · v${version}`;
      [...host.children]
        .sort((a, b) => String(a.dataset?.bwu2RuntimeKey || '').localeCompare(String(b.dataset?.bwu2RuntimeKey || '')))
        .forEach(node => host.appendChild(node));
    };
    mount();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  }

  function createCoreClient(options = {}) {
    const client = clean(options.client);
    const defaultTimeout = Math.max(1, Number(options.defaultTimeout) || 17000);
    const responseCapture = options.responseCapture === true;
    const timeoutError = options.timeoutError;
    const pending = new Map();

    window.addEventListener('fcr-data-core:response', event => {
      let message;
      try { message = JSON.parse(String(event.detail || '')); } catch { return; }
      const job = pending.get(message?.id);
      if (!job) return;
      pending.delete(message.id);
      clearTimeout(job.timer);
      if (message.ok) job.resolve(message.data);
      else job.reject(new Error(message.error || 'FCR Data Core request failed'));
    }, responseCapture);

    window.addEventListener('fcr-data-core:progress', event => {
      let message;
      try { message = JSON.parse(String(event.detail || '')); } catch { return; }
      const job = pending.get(message?.id);
      if (!job?.onProgress) return;
      try { job.onProgress(message.data); } catch {}
    }, responseCapture);

    function request(type, payload = {}, requestOptions = {}) {
      const timeout = Math.max(1, Number(requestOptions.timeout) || defaultTimeout);
      const group = clean(requestOptions.group);
      const onProgress = typeof requestOptions.onProgress === 'function' ? requestOptions.onProgress : null;
      const id = crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          const message = typeof timeoutError === 'function'
            ? timeoutError(type)
            : clean(timeoutError) || 'FCR Data Core missing / timed out';
          reject(new Error(message));
        }, timeout);

        pending.set(id, { resolve, reject, timer, onProgress });
        window.dispatchEvent(new CustomEvent('fcr-data-core:request', {
          detail: JSON.stringify({ id, type, payload, client, group })
        }));
      });
    }

    function cancel(group = '') {
      window.dispatchEvent(new CustomEvent('fcr-data-core:cancel', {
        detail: JSON.stringify({ client, group: clean(group) })
      }));
    }

    return Object.freeze({ request, cancel });
  }

  async function runWithConcurrency(items, limit, worker) {
    let index = 0;
    const count = Math.min(Math.max(1, Number(limit) || 1), items.length);
    await Promise.all(Array.from({ length: count }, async () => {
      while (index < items.length) {
        const current = index++;
        await worker(items[current], current);
      }
    }));
  }


  function usage(prefix, key, ms = 0, count = 1) {
    window.dispatchEvent(new CustomEvent('fcr-usage:event', {
      detail: JSON.stringify({ key: `${clean(prefix)}.${clean(key)}`, ms, count })
    }));
  }

  function trace(type, data = {}) {
    try {
      if (typeof window.BWU2Trace === 'function') window.BWU2Trace(type, data);
      else window.postMessage({ __BWU2_TRACE__: true, type, data }, '*');
    } catch {}
  }

  function normalizeContainer(value, pattern) {
    const id = clean(value);
    return pattern instanceof RegExp && pattern.test(id) ? id : '';
  }

  function nextQueued(items) {
    return Array.isArray(items) ? items.find(item => item?.status === 'queued') || null : null;
  }

  function queueCounts(items) {
    const list = Array.isArray(items) ? items : [];
    const result = { total: list.length, queued: 0, active: 0, done: 0, attention: 0 };
    for (const item of list) {
      if (Object.prototype.hasOwnProperty.call(result, item?.status)) result[item.status]++;
    }
    return result;
  }

  function markUi(node, value = '1') {
    if (node?.setAttribute) node.setAttribute('data-bwu2-ui', value);
    return node;
  }

  ROOT.BWU2Fleet = Object.freeze({
    version: '0.1.1',
    clean,
    upper,
    registerRuntimeVersion,
    createCoreClient,
    runWithConcurrency,
    usage,
    trace,
    normalizeContainer,
    nextQueued,
    queueCounts,
    markUi
  });
})();