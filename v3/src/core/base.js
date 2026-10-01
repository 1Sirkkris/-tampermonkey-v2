V3.base = (() => {
  const clean = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const upper = value => clean(value).toUpperCase();
  const lower = value => clean(value).toLowerCase();
  const esc = value => String(value ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  const id = prefix => String(prefix || 'op') + '-' + (crypto?.randomUUID?.() || (Date.now() + '-' + Math.random().toString(16).slice(2)));
  const validContainer = value => /^(?:ts|cs)x[0-9a-z_-]+$/i.test(clean(value));
  const lines = (value, options = {}) => {
    const dedupe = options.dedupe !== false;
    const out = [], seen = new Set();
    for (const raw of String(value ?? '').split(/\r?\n/)) {
      const v = clean(raw.split(/\s+/)[0]);
      if (!v) continue;
      const key = upper(v);
      if (dedupe && seen.has(key)) continue;
      seen.add(key); out.push(v);
    }
    return out;
  };
  const sleep = (ms, signal) => new Promise((resolve,reject) => {
    if (signal?.aborted) return reject(signal.reason || new DOMException('Aborted','AbortError'));
    const timer = setTimeout(done, Math.max(0, Number(ms) || 0));
    const abort = () => { clearTimeout(timer); reject(signal.reason || new DOMException('Aborted','AbortError')); };
    function done() { signal?.removeEventListener?.('abort', abort); resolve(); }
    signal?.addEventListener?.('abort', abort, { once:true });
  });
  const safeJson = raw => { try { return JSON.parse(String(raw || '')); } catch { return null; } };
  const parseHtml = html => new DOMParser().parseFromString(String(html || ''), 'text/html');
  return Object.freeze({ clean, upper, lower, esc, id, validContainer, lines, sleep, safeJson, parseHtml });
})();