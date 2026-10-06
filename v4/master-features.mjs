import { MASTER_VERSION } from './master-runtime.mjs';
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const upper = value => clean(value).toUpperCase();
const UI = '[data-tm-v4-master]';
const STYLE = `
[data-tm-v4-section]{margin-left:5px;padding:0 4px;font-weight:bold}
[data-tm-v4-master-status]{display:block;font-size:11px;margin:4px 0}
[data-tm-v4-badge]{display:inline-block;margin-left:6px;padding:2px 6px;border:1px solid #666;border-radius:5px;background:#fff;color:#111;font-weight:bold;font-size:12px}
[data-tm-v4-badge][data-state="yes"],[data-tm-v4-property="true"]{background:#00875a;color:#fff}
[data-tm-v4-badge][data-state="no"],[data-tm-v4-property="false"]{background:#bb1637;color:#fff}
[data-tm-v4-badge][data-state="history"],[data-tm-v4-badge][data-state="error"],[data-tm-v4-property="unknown"]{background:#ffe299;color:#111}
[data-tm-v4-property]{font-weight:bold}
[data-tm-v4-po~="unfilled"]{background:#ffe299;font-weight:bold}
[data-tm-v4-po~="cancelled"]{background:#bb1637;color:#fff;font-weight:bold}
[data-tm-v4-po~="band"]{box-shadow:inset 0 0 0 2px #bb1637}
[data-tm-v4-po~="old"]{background:#f6b6c2;color:#111;font-weight:bold}
[data-tm-v4-label-action]{cursor:pointer;text-decoration:underline dotted}
[data-tm-v4-quantity]{margin-left:6px;width:4.5em;font-size:12px}
`;

const sydney = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
// Evaluate actual timezone offsets at each candidate instead of assuming a
// fixed UTC offset across the DST transition.
export function nextSydneyCutoff(now) {
  const day = new Date(now); const midnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  const candidates = [];
  for (let offset = 0; offset < 3; offset++) for (const hour of [7, 8]) {
    const candidate = midnight + offset * 86400000 + hour * 3600000;
    if (candidate <= now) continue;
    const parts = Object.fromEntries(sydney.formatToParts(new Date(candidate)).map(part => [part.type, part.value]));
    if (parts.hour === '18' && parts.minute === '00') candidates.push(candidate);
  }
  if (!candidates.length) throw new Error('Sydney cache cutoff unavailable');
  return Math.min(...candidates);
}

export function sizeCandidates(rows, item, aliases = []) {
  const wanted = new Set([item, ...aliases].map(upper));
  const rank = value => /^(?:tsX|csX)[A-Za-z0-9]+$/i.test(value) ? 0 : /^P-\d-/i.test(value) ? 1 : 2;
  const sorted = rows.filter(row => row.container &&
    (!/^X[A-Z0-9]{9}$/.test(upper(item)) || !row.fnsku || upper(row.fnsku) === upper(item)) &&
    [row.asin, row.fnsku, row.fcsku, row.lpn].some(code => wanted.has(upper(code))))
    .sort((a, b) => rank(a.container) - rank(b.container) || b.qty - a.qty);
  return [...new Map(sorted.map(row => [upper(row.container), row.container])).values()].slice(0, 3);
}

export function createMadcatCache({ storage, now = Date.now }) {
  const key = 'tm-v4.master.madcat.cache', entries = new Map();
  function valid([identity, entry]) {
    return /^(?:ASIN|FNSKU):[A-Z0-9]{10}$/.test(identity) && entry && Number.isFinite(entry.expiresAt) && entry.expiresAt > now() &&
      entry.expiresAt <= (entry.value?.madcat ? nextSydneyCutoff(now()) : now() + 300000) &&
      typeof entry.value?.madcat === 'boolean' && entry.value.madcatSource === 'raw' && entry.value.complete === true && entry.value.windowDays === 30;
  }
  try { const stored = storage.get(key, []); if (Array.isArray(stored)) for (const pair of stored.slice(-200)) if (Array.isArray(pair) && pair.length === 2 && valid(pair)) entries.set(...pair); }
  catch { /* Cache is optional; a fresh read remains available. */ }
  function get(identity) { const entry = entries.get(identity); if (entry && valid([identity, entry])) return { ...entry.value, source: 'cache' }; entries.delete(identity); return null; }
  function put(identity, value) {
    if (value.madcatSource !== 'raw' || !value.complete || value.windowDays !== 30 || typeof value.madcat !== 'boolean') return;
    const entry = { expiresAt: value.madcat ? nextSydneyCutoff(now()) : now() + 300000,
      value: { madcat: value.madcat, madcatSource: 'raw', complete: true, windowDays: 30 } };
    if (!valid([identity, entry])) return;
    entries.delete(identity); entries.set(identity, entry);
    for (const pair of entries) if (!valid(pair)) entries.delete(pair[0]);
    while (entries.size > 200) entries.delete(entries.keys().next().value);
    try { storage.set(key, [...entries]); } catch { /* Memory cache remains scoped and validated. */ }
  }
  return Object.freeze({ get, put });
}

export function productPanel(document, verified) {
  if (!verified) return null;
  const table = document.querySelector('[data-section-type="product"] table');
  if (!table) return null;
  const entries = new Map();
  for (const row of table.rows) {
    const label = row.querySelector('th'), value = row.querySelector('td');
    if (!label || !value) continue;
    const clone = value.cloneNode(true); clone.querySelectorAll(UI).forEach(node => node.remove());
    entries.set(upper(label.textContent), { label, value, text: clean(clone.textContent) });
  }
  const declared = ['ASIN', 'ISBN', 'FNSKU', 'FCSKU'].map(field => upper(entries.get(field)?.text)).filter(Boolean);
  // A replaced native panel cannot borrow the preceding validated product.
  if (!declared.length || declared.some(code => !verified.aliases.includes(code))) return null;
  if (clean(entries.get('TITLE')?.text) !== clean(verified.title)) return null;
  return { table, entries, product: verified };
}

export function createMasterFeatures({ window, page = window, runtime, enrichment, auth, storage, now = Date.now, onEvidence = () => {} }) {
  const document = window.document, lifetime = new window.AbortController();
  const cache = createMadcatCache({ storage, now });
  const hazCache = new Map(), states = new WeakMap(), modified = new Map(), nodes = new Set();
  let style;
  const isCurrent = gen => !lifetime.signal.aborted && runtime.active(gen);
  const mark = node => { runtime.mark(node); nodes.add(node); return node; };
  function setAttribute(node, name, value) {
    if (!modified.has(node)) modified.set(node, new Map());
    const attributes = modified.get(node); if (!attributes.has(name)) attributes.set(name, node.getAttribute(name));
    node.setAttribute(name, value);
  }
  function state(gen) {
    if (!states.has(gen)) states.set(gen, { size: { status: 'idle', serial: 0 }, madcat: { status: 'idle', serial: 0 }, haz: new Map(), jobs: [], workers: 0 });
    return states.get(gen);
  }
  function ownButton(host, name, label, action) {
    let node = host.querySelector(':scope > [data-tm-v4-badge="' + name + '"]');
    if (!node) { node = mark(document.createElement('button')); node.type = 'button'; node.setAttribute('data-tm-v4-badge', name); host.append(node); }
    if (node.textContent !== label) node.textContent = label;
    node.onclick = action; return node;
  }
  async function size(gen, force = false) {
    const product = gen.sections.get('product')?.result?.product;
    if (!product || !isCurrent(gen)) return;
    const current = state(gen).size;
    if (current.status === 'loading' || (!force && current.status !== 'idle')) return;
    const serial = ++current.serial; current.status = 'loading'; current.value = ''; current.error = ''; runtime.schedule();
    try {
      const inventory = await runtime.load('inventory', { gen, render: false });
      if (!isCurrent(gen) || current.serial !== serial) return;
      if (!inventory) throw new Error('Inventory read unavailable');
      const item = product.fnsku || product.asin || product.isbn, candidates = sizeCandidates(inventory.rows, item, product.aliases);
      let lastError;
      for (const container of candidates) {
        let result;
        try { result = await enrichment.binDescription(container, item, { signal: gen.controller.signal, verifiedAliases: product.aliases }); }
        catch (error) { if (error.code === 'CANCELLED' || error.code === 'AUTH_REQUIRED') throw error; lastError = error; continue; }
        if (!isCurrent(gen) || current.serial !== serial) return;
        if (result.complete && result.size) { current.value = result.size; break; }
      }
      if (!current.value && lastError) throw lastError;
      current.status = current.value ? 'ready' : 'unavailable';
    } catch (error) {
      if (!isCurrent(gen) || current.serial !== serial) return;
      current.status = 'error'; current.error = clean(error.message);
    }
    if (isCurrent(gen)) runtime.schedule();
  }
  async function madcat(gen, force = false) {
    const product = gen.sections.get('product')?.result?.product;
    if (!product || !isCurrent(gen)) return;
    const current = state(gen).madcat;
    if (current.status === 'loading' || (!force && current.status !== 'idle')) return;
    current.stopAuth?.(); current.stopAuth = null;
    const code = upper(product.fnsku || product.asin || product.isbn), identity = (product.fnsku ? 'FNSKU:' : 'ASIN:') + code;
    const serial = ++current.serial; current.status = 'loading'; current.error = ''; runtime.schedule();
    try {
      const cached = !force && cache.get(identity);
      current.authPending = !cached && typeof auth.read === 'function' && !auth.read();
      const result = cached || await enrichment.recentMadcat({ fnsku: product.fnsku, asin: product.asin || product.isbn }, { signal: gen.controller.signal });
      if (!isCurrent(gen) || current.serial !== serial) return;
      if (result.madcatSource === 'raw' && (result.complete !== true || result.windowDays !== 30 || typeof result.madcat !== 'boolean')) throw new Error('Incomplete raw Measurement result');
      if (!['raw', 'history'].includes(result.madcatSource) || (result.madcatSource === 'history' && result.madcat !== null && typeof result.madcat !== 'boolean')) throw new Error('Unrecognized Measurement provenance');
      current.result = result; current.status = 'ready'; cache.put(identity, result);
      if (result.madcatSource === 'history' && result.authRequired && !current.autoAuthRetried) {
        const recover = () => {
          if (!isCurrent(gen) || current.serial !== serial || current.autoAuthRetried) return;
          current.autoAuthRetried = true; current.stopAuth?.(); current.stopAuth = null;
          void madcat(gen, true);
        };
        current.stopAuth = auth.watch?.(recover, { signal: gen.controller.signal });
        // A token arriving during the history read must not require a click.
        if (result.fallbackReason === 'measurement-login-required' && auth.read?.()) recover();
      }
    } catch (error) { if (!isCurrent(gen) || current.serial !== serial) return; current.status = 'error'; current.error = clean(error.message); }
    if (isCurrent(gen)) runtime.schedule();
  }
  function queueHaz(gen, asin, force = false) {
    if (!/^B[A-Z0-9]{9}$/.test(asin) || !isCurrent(gen)) return;
    const group = state(gen), previous = group.haz.get(asin);
    if (previous?.status === 'loading' || (!force && previous)) return;
    const cached = hazCache.get(asin);
    if (!force && cached && cached.expiresAt > now()) { group.haz.set(asin, { ...cached.value }); return; }
    group.haz.set(asin, { status: 'loading' }); group.jobs.push(asin); pump(gen);
  }
  function pump(gen) {
    const group = state(gen);
    while (isCurrent(gen) && group.jobs.length && group.workers < 4) {
      const asin = group.jobs.shift(); group.workers++;
      (async () => {
        let value;
        try { const result = await enrichment.hazmat(asin, { signal: gen.controller.signal }); value = { status: 'ready', result }; }
        catch (error) { value = { status: 'error', error: clean(error.message) }; }
        finally { group.workers--; }
        if (!isCurrent(gen)) return;
        group.haz.set(asin, value);
        hazCache.delete(asin); hazCache.set(asin, { value, expiresAt: now() + (value.result?.complete ? 21600000 : 60000) });
        while (hazCache.size > 500) hazCache.delete(hazCache.keys().next().value);
        pump(gen); runtime.schedule();
      })();
    }
  }
  function river(gen) {
    if (!isCurrent(gen)) return;
    const url = new URL('https://river.amazon.com/' + runtime.warehouse + '/workflows');
    for (const [key, value] of Object.entries({ buildingType: 'fc', workflowId: 'undefined', q0: '3654ec14-7232-4f65-84c3-87927cdb4d0c', q1: 'f2738dec-7f6f-4c2e-a85a-db7228de25f1', id: 'f2738dec-7f6f-4c2e-a85a-db7228de25f1' })) url.searchParams.set(key, value);
    const tab = window.open(url.href, '_blank'); if (tab) tab.opener = null; else runtime.notify('RIVER popup blocked — allow popups and retry');
    try { onEvidence({ type: 'fcr.handoff', script: 'FCR MASTER', version: MASTER_VERSION, intent: 'read', data: { action: 'river.open', warehouse: runtime.warehouse } }); } catch {}
  }
  function paintHaz(host, asin, gen, product = false) {
    queueHaz(gen, asin); const status = state(gen).haz.get(asin);
    if (!status) return;
    const hazmat = status.result?.complete ? status.result.hazmat : null;
    const label = status.status === 'loading' ? 'CHECK…' : status.status === 'error' ? 'ERROR' : hazmat ? 'L' + hazmat.level : 'N/A';
    const canRiver = product && status.status === 'ready' && (!hazmat || hazmat.level === 0);
    const badge = ownButton(host, 'hazmat', label, () => canRiver ? river(gen) : (queueHaz(gen, asin, true), runtime.schedule()));
    badge.disabled = status.status === 'loading'; badge.dataset.state = status.status === 'error' ? 'error' : 'hazmat';
    badge.title = canRiver ? 'Create Hazmat RIVER ticket' : status.error || hazmat?.message || 'No exact ASIN hazmat result; recheck';
    const colours = ['#999', '#33cc02', '#ffe103', '#ffbf03', '#ff8002', '#ff4001', '#ed0700', '#ad03de', '#3333ff'];
    badge.style.background = hazmat && hazmat.level < colours.length ? colours[hazmat.level] : '#fff';
    badge.style.color = hazmat && hazmat.level >= 6 ? '#fff' : '#111';
    if (product) { const recheck = ownButton(host, 'pandash', 'Pandash', () => { queueHaz(gen, asin, true); runtime.schedule(); }); recheck.disabled = status.status === 'loading'; }
  }
  function highlightProperties(panel) {
    for (const label of ['SORTABLE', 'VERY HIGH VALUE', 'CONVEYABLE', 'MASTER CASE']) {
      const entry = panel.entries.get(label); if (!entry) continue;
      const value = /^(?:true|yes|1)$/i.test(entry.text) ? 'true' : /^(?:false|no|0)$/i.test(entry.text) ? 'false' : 'unknown';
      setAttribute(entry.value, 'data-tm-v4-property', value);
    }
  }
  function poHighlights() {
    const table = document.querySelector('#table-purchase-order-item'); if (!table?.tBodies[0]) return;
    const wrapper = table.closest('.dataTables_scroll'), head = wrapper?.querySelector('.dataTables_scrollHead table') || table;
    const headers = [...head.querySelectorAll('thead th')].map(node => clean(node.textContent).toLowerCase());
    const unfilled = headers.findIndex(value => value.includes('unfilled')), cancelled = headers.findIndex(value => /cancelled|canceled/.test(value)), dateIndex = headers.findIndex(value => /order date|^date$/.test(value));
    const six = new Date(now()); six.setMonth(six.getMonth() - 6); const seven = new Date(now()); seven.setMonth(seven.getMonth() - 7);
    for (const row of table.tBodies[0].rows) {
      const flags = row.cells ? [...row.cells].map(() => []) : [];
      const readNumber = index => Number(clean(row.cells[index]?.querySelector('input')?.value ?? row.cells[index]?.textContent).replace(/[ ,]/g, ''));
      if (unfilled >= 0 && readNumber(unfilled) > 0) flags[unfilled]?.push('unfilled');
      if (cancelled >= 0 && readNumber(cancelled) > 0) flags[cancelled]?.push('cancelled');
      const raw = clean(row.cells[dateIndex]?.textContent), match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
      if (match) {
        const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        if (date.getFullYear() === Number(match[1]) && date.getMonth() + 1 === Number(match[2]) && date.getDate() === Number(match[3])) {
          if (date < six) for (let delta = 0; delta <= 2; delta++) flags[dateIndex - delta]?.push('band');
          if (date < seven) flags[dateIndex]?.push('old');
        }
      }
      [...row.cells].forEach((cell, index) => { if (flags[index].length || modified.get(cell)?.has('data-tm-v4-po')) setAttribute(cell, 'data-tm-v4-po', flags[index].join(' ')); });
    }
  }
  function refresh() {
    const gen = runtime.current(); if (!gen || !isCurrent(gen)) return;
    for (const node of nodes) if (!node.isConnected) nodes.delete(node);
    for (const node of modified.keys()) if (!node.isConnected) modified.delete(node);
    if (!style?.isConnected) { style = runtime.mark(document.createElement('style')); style.textContent = STYLE; (document.head || document.documentElement).append(style); }
    const group = state(gen), product = gen.sections.get('product')?.result?.product, panel = productPanel(document, product);
    if (panel) {
      highlightProperties(panel);
      const host = (panel.entries.get('DIMENSIONS') || panel.entries.get('ASIN') || panel.entries.get('ISBN'))?.value;
      if (host) {
        const sizeLabel = 'Size: ' + (group.size.status === 'loading' || group.size.status === 'idle' ? 'CHECK…' : group.size.status === 'error' ? 'ERROR ↻' : group.size.value || 'Unavailable');
        const badge = ownButton(host, 'size', sizeLabel, () => void size(gen, true)); badge.disabled = group.size.status === 'loading'; badge.title = group.size.error || 'Exact native binDescription — click to recheck';
        const result = group.madcat.result, history = result?.madcatSource === 'history';
        const label = group.madcat.status === 'error' ? 'Madcat: ERROR ↻' : group.madcat.status !== 'ready' ? group.madcat.authPending ? 'Madcat: AUTH…' : 'Madcat: CHECK…' : result.madcat === true ? 'Madcat: YES' : history ? 'Madcat: NO?' : 'Madcat: NO';
        const mad = ownButton(host, 'madcat', label, () => {
          if (group.madcat.status === 'ready' && history && result.authRequired) {
            if (result.fallbackReason === 'measurement-token-expired' || !auth.read?.()) {
              const tab = window.open(auth.loginUrl(product.fnsku || product.asin || product.isbn), 'tm-v4-measurement-login');
              if (tab) tab.opener = null;
              else { runtime.notify('Measurement login popup blocked — allow popups and retry'); return; }
            }
          }
          void madcat(gen, true);
        });
        mad.dataset.state = group.madcat.status === 'error' ? 'error' : history ? 'history' : result ? result.madcat ? 'yes' : 'no' : 'checking';
        mad.disabled = group.madcat.status === 'loading' || (group.madcat.status === 'ready' && !history);
        mad.title = group.madcat.error || (history ? 'Inventory History fallback only; click to renew RAW auth and retry' : 'RAW Item Measurement: rolling 30-day check');
      }
      const primary = (panel.entries.get('ASIN') || panel.entries.get('ISBN'))?.value;
      if (primary && /^B[A-Z0-9]{9}$/.test(upper(product.asin))) paintHaz(primary, upper(product.asin), gen, true);
      void size(gen); void madcat(gen);
    }
    const inventory = gen.sections.get('inventory')?.result;
    const table = inventory && document.querySelector('#table-inventory');
    if (table) {
      const head = table.closest('.dataTables_scroll')?.querySelector('.dataTables_scrollHead table') || table;
      const asinIndex = [...head.querySelectorAll('thead th')].findIndex(node => /^ASIN$/i.test(clean(node.textContent)));
      const permitted = new Set(inventory.rows.map(row => upper(row.asin)));
      for (const row of table.tBodies[0]?.rows || []) {
        const cell = row.cells[asinIndex]; if (!cell) continue;
        const clone = cell.cloneNode(true); clone.querySelectorAll(UI).forEach(node => node.remove()); const asin = upper(clone.textContent);
        if (permitted.has(asin)) paintHaz(cell, asin, gen);
      }
      let recheck = table.closest('[data-section-type="inventory"]')?.querySelector(':scope > [data-tm-v4-badge="recheck-hazmat"]');
      if (!recheck) recheck = ownButton(table.closest('[data-section-type="inventory"]') || table.parentElement, 'recheck-hazmat', 'Recheck N/A + L0', () => {
        for (const [asin, value] of group.haz) if (permitted.has(asin) && value.status !== 'loading' && (!value.result?.hazmat || value.result.hazmat.level === 0)) queueHaz(gen, asin, true);
        runtime.schedule();
      });
    }
    poHighlights();
  }
  function reset() {
    for (const node of nodes) node.remove(); nodes.clear();
    for (const [node, attributes] of modified) for (const [name, original] of attributes) original == null ? node.removeAttribute(name) : node.setAttribute(name, original);
    modified.clear();
  }
  function dispose() { lifetime.abort(); reset(); }
  return Object.freeze({ refresh, reset, dispose, size, madcat });
}
