// Independent native FCR reads. Consumers own UI, authentication and cancellation.
export const FCR_READ_VERSION = '0.1.1';
export class FcrReadError extends Error {
  constructor(code, message, { status, cause, partial } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'FcrReadError';
    this.code = code;
    if (status != null) this.status = status;
    if (partial) this.partial = partial;
  }
}

export const FCR_SECTIONS = Object.freeze([
  'product', 'inventory', 'inventory-history', 'container-history', 'purchase-order-item',
  'purchase-order', 'receive-history', 'shipment', 'container-hierarchy', 'employee',
  'carton-general-info', 'carton-contents', 'sscc-info', 'carton-ambiguities',
  'vision-tunnel', 'problem', 'problems', 'event', 'authenticity-item'
]);

const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const identifier = value => text(value).toUpperCase();
const failure = (code, message, options) => new FcrReadError(code, message, options);
const columns = Object.freeze({
  container: ['container'], asin: ['asin'], fnsku: ['fnsku'], fcsku: ['fcsku'], lpn: ['lpn'],
  qty: ['quantity'], disposition: ['disposition'], consumer: ['consumer'],
  consumerId: ['consumer id', 'consumerid'], outerLocation: ['outer location'],
  outerLocationType: ['outer location type'], title: ['title']
});

function active(signal) {
  if (signal?.aborted) throw failure('CANCELLED', 'FCR read cancelled', { cause: signal.reason });
}

function searchValue(value) {
  const query = text(value);
  if (!query || query.length > 256 || /[\u0000-\u001f]/.test(String(value))) throw failure('INPUT', 'A valid FCR search is required');
  return query;
}

function quantity(value) {
  const raw = text(value);
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(raw)) throw failure('SCHEMA', 'Inventory quantity is invalid');
  const number = Number(raw.replaceAll(',', ''));
  if (!Number.isSafeInteger(number)) throw failure('SCHEMA', 'Inventory quantity exceeds the safe range');
  return number;
}

function pagination(document) {
  const markers = [...document.querySelectorAll('.pagination-token')].map(node => node.textContent.trim());
  // The captured native loader explicitly treats literal true as terminal.
  // A prefix such as true-truncated is not a validated terminal marker.
  const terminal = value => /^(?:true|false|null|done)$/i.test(value);
  const tokens = markers.filter(value => value && !terminal(value));
  if (!tokens.length) return '';
  if (markers.some(terminal)) throw failure('PAGINATION', 'Contradictory pagination markers');
  if (new Set(tokens).size !== 1 || tokens[0].length > 16384) throw failure('PAGINATION', 'Ambiguous pagination token');
  try {
    const parsed = JSON.parse(tokens[0]);
    if (!parsed || typeof parsed !== 'object') throw new Error('Not an object/array');
  } catch (cause) { throw failure('PAGINATION', 'Unrecognized pagination token', { cause }); }
  return tokens[0];
}

function schema(table) {
  const headers = [...table.querySelectorAll('thead th')];
  if (!headers.length) throw failure('SCHEMA', 'Inventory column headers are missing');
  const names = headers.map(node => text(node.id || node.textContent).toLowerCase()
    .replace(/^inventory-/, '').replace(/\([\d,]+\)/g, '').replaceAll('-', ' ').trim());
  const positions = Object.fromEntries(Object.entries(columns).map(([field, aliases]) => {
    const matches = names.flatMap((name, index) => aliases.includes(name) ? [index] : []);
    if (matches.length > 1) throw failure('SCHEMA', 'Duplicate inventory column: ' + field);
    return [field, matches[0] ?? -1];
  }));
  if (positions.container < 0 || positions.qty < 0 || ['asin', 'fnsku', 'fcsku'].every(field => positions[field] < 0)) {
    throw failure('SCHEMA', 'Inventory identity/container/quantity columns are missing');
  }
  return { positions, names, width: headers.length };
}

function parseInventoryRows(table, format) {
  const rows = [], nodes = [];
  for (const node of table.tBodies[0]?.rows || []) {
    // Native DataTables explicitly marks an empty result; arbitrary placeholder rows are errors.
    if (node.cells.length === 1 && node.querySelector('td.dataTables_empty')) continue;
    if (node.cells.length !== format.width) throw failure('SCHEMA', 'Inventory row has unexpected columns');
    const row = Object.fromEntries(Object.entries(format.positions).map(([field, index]) =>
      [field, index < 0 ? '' : text(node.cells[index].textContent)]));
    row.qty = quantity(row.qty);
    if (!row.container || ![row.asin, row.fnsku, row.fcsku].some(Boolean)) throw failure('IDENTITY', 'Inventory row has no container/item identity');
    rows.push(row); nodes.push(node);
  }
  return { rows, nodes };
}

function dateField(value) {
  const raw = text(value), iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw), native = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  const [year, month, day] = iso ? iso.slice(1).map(Number) : native ? [Number(native[3]), Number(native[1]), Number(native[2])] : [];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (!year || date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    throw failure('INPUT', 'A valid Inventory History date is required');
  }
  return { native: `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`, time: date.getTime() };
}

export function createFcrReader({
  origin, warehouse, fetch: nativeFetch = globalThis.fetch, DOMParser: Parser = globalThis.DOMParser,
  timeoutMs = 15000, maxPages = 200, maxRows = 100000, retryDelays = [250, 750], onEvidence = () => {}
}) {
  let site;
  try { site = new URL(origin); } catch { throw failure('INPUT', 'FCR origin is invalid'); }
  const allowedHost = /^(?:fcresearch-fe\.aka\.amazon\.com|qi-fcresearch-(?:fe|jp)\.corp\.amazon\.com|qifcr\.fe\.aftx\.amazonoperations\.app)$/i;
  if (!/^https?:$/.test(site.protocol) || !allowedHost.test(site.hostname) || site.username || site.password ||
      !/^[A-Z0-9-]{2,12}$/.test(warehouse) || typeof nativeFetch !== 'function' || typeof Parser !== 'function' ||
      !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 200 || !Number.isInteger(maxRows) || maxRows < 1 || maxRows > 100000 ||
      !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000 || !Array.isArray(retryDelays) || retryDelays.length > 3 ||
      retryDelays.some(ms => !Number.isFinite(ms) || ms < 0 || ms > 5000)) throw failure('INPUT', 'FCR reader configuration is invalid');
  const base = `${site.origin}/${encodeURIComponent(warehouse)}/results/`;
  const endpoints = new Set([...FCR_SECTIONS, ...FCR_SECTIONS.map(endpoint => endpoint + '-more')]);

  function evidence(data) {
    try { onEvidence({ type: 'fcr.read', script: 'FCR READ', version: FCR_READ_VERSION, intent: 'read', data }); }
    catch { /* OBS is optional. */ }
  }

  function documentFrom(html, fragment = false) {
    const document = new Parser().parseFromString(html, 'text/html');
    if (document.querySelector('input[type="password"], form[action*="signin"], form[action*="login"]')) {
      throw failure('AUTH_REQUIRED', 'FCR authentication is required');
    }
    if (fragment && !document.querySelector('table') && /<tr\b/i.test(html)) {
      return new Parser().parseFromString('<table><tbody>' + html + '</tbody></table>', 'text/html');
    }
    return document;
  }

  function wait(ms, signal) {
    active(signal);
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancelled); };
      const cancelled = () => { cleanup(); reject(failure('CANCELLED', 'FCR retry cancelled', { cause: signal.reason })); };
      const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
      signal?.addEventListener('abort', cancelled, { once: true });
    });
  }

  async function request(endpoint, fields, signal) {
    if (!endpoints.has(endpoint)) throw failure('INPUT', 'Unsupported FCR read endpoint');
    const url = base + endpoint;
    for (let attempt = 0; ; attempt++) {
      active(signal);
      const controller = new AbortController();
      const cancelled = () => controller.abort(signal.reason);
      signal?.addEventListener('abort', cancelled, { once: true });
      let timedOut = false, retry = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      try {
        const response = await nativeFetch(url, {
          method: 'POST', credentials: 'same-origin', cache: 'no-store',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest' },
          body: new URLSearchParams(fields).toString(), signal: controller.signal
        });
        active(signal);
        if (timedOut) throw failure('TIMEOUT', endpoint + ': timed out');
        if ([401, 403].includes(response.status) || (response.url && response.url.replace(/\/$/, '') !== url)) {
          throw failure('AUTH_REQUIRED', endpoint + ': authentication/redirect requires review', { status: response.status });
        }
        if (!response.ok) throw failure('HTTP', endpoint + ': HTTP ' + response.status, { status: response.status });
        const html = await response.text();
        active(signal);
        if (timedOut) throw failure('TIMEOUT', endpoint + ': timed out');
        if (typeof html !== 'string' || html.length > 8000000) throw failure('SCHEMA', endpoint + ': response exceeds the read limit');
        evidence({ endpoint, status: response.status, outcome: 'received', attempt: attempt + 1 });
        return documentFrom(html, endpoint.endsWith('-more'));
      } catch (cause) {
        active(signal);
        const error = timedOut ? failure('TIMEOUT', endpoint + ': timed out', { cause }) :
          cause instanceof FcrReadError ? cause : failure('NETWORK', endpoint + ': request failed', { cause });
        evidence({ endpoint, status: error.status, outcome: 'failed', code: error.code, attempt: attempt + 1 });
        retry = error.code === 'HTTP' && error.status >= 500 && error.status < 600 && attempt < retryDelays.length;
        if (!retry) throw error;
      } finally {
        clearTimeout(timer); signal?.removeEventListener('abort', cancelled);
      }
      if (retry) await wait(retryDelays[attempt], signal);
    }
  }

  async function product(queryValue, { signal } = {}) {
    const query = searchValue(queryValue), document = await request('product', { s: query }, signal);
    active(signal);
    let recognized = false;
    const matches = [];
    for (const table of document.querySelectorAll('table')) {
      const fields = {};
      for (const node of table.rows) {
        const label = node.querySelector('th'), value = node.querySelector('td');
        if (label && value) {
          const key = text(label.textContent).toLowerCase(), content = text(value.querySelector('a')?.textContent || value.textContent);
          if (fields[key] != null && fields[key] !== content) throw failure('SCHEMA', 'Product contains conflicting native fields');
          fields[key] = content;
        }
      }
      const aliases = ['asin', 'isbn', 'fnsku', 'fcsku'].map(field => identifier(fields[field])).filter(Boolean);
      if (!aliases.length) continue;
      recognized = true;
      if (!aliases.includes(identifier(query))) continue;
      const sortable = /^(?:true|yes|1)$/i.test(fields.sortable) ? true : /^(?:false|no|0)$/i.test(fields.sortable) ? false : null;
      matches.push({
        asin: fields.asin || '', isbn: fields.isbn || '', fnsku: fields.fnsku || '', fcsku: fields.fcsku || '',
        primary: fields.asin || fields.isbn || '', title: fields.title || '', dimensions: fields.dimensions || '',
        weight: fields.weight || '', sortable, sortableText: fields.sortable || '', aliases: [...new Set(aliases)],
        img: (table.closest('[data-section-type="product"], .a-box-group') || table).querySelector('img')?.getAttribute('src') || ''
      });
    }
    if (matches.length) {
      if (new Set(matches.map(match => JSON.stringify(match))).size > 1) throw failure('IDENTITY', 'Product response contains conflicting exact records');
      active(signal);
      return { query, product: matches[0], html: document.body.innerHTML, complete: true, source: 'network' };
    }
    throw failure(recognized ? 'IDENTITY' : 'SCHEMA', recognized ? 'Product does not match the requested identifier' : 'Product table was not returned');
  }

  async function inventory(queryValue, { signal, allowPartial = false, onPreview } = {}) {
    const query = searchValue(queryValue);
    const document = await request('inventory', { s: query }, signal);
    active(signal);
    const table = document.querySelector('#table-inventory');
    if (!table) throw failure('SCHEMA', 'Inventory table was not returned');
    const format = schema(table), body = table.tBodies[0];
    if (!body) throw failure('SCHEMA', 'Inventory table body is missing');
    let rows = parseInventoryRows(table, format).rows, pages = 1, complete = false, error = null;
    const header = table.querySelector('#inventory-quantity') || [...table.querySelectorAll('th')][format.positions.qty];
    const headerMatch = text(header?.textContent).match(/\(([\d,]+)\)/);
    const advertised = headerMatch ? quantity(headerMatch[1]) : null;
    const seen = new Set();
    const result = (warning = '', code = '') => {
      const copy = document.body.cloneNode(true);
      copy.querySelectorAll('.pagination-token').forEach(node => node.remove());
      const partialQuantity = rows.reduce((sum, row) => sum + row.qty, 0);
      return { query, rows: rows.map(row => ({ ...row })), html: copy.innerHTML, pages, records: rows.length,
        partialQuantity, totalQuantity: complete ? partialQuantity : null, complete, warning, ...(code ? { code } : {}), source: 'network' };
    };
    try {
      let token = pagination(document);
      if (rows.length > maxRows) throw failure('LIMIT', 'Inventory row limit reached');
      if (token && !rows.length) throw failure('PAGINATION', 'Empty nonterminal inventory page');
      if (onPreview) {
        active(signal); onPreview(result(token ? 'Loading remaining inventory pages' : 'Validating inventory completeness'));
        active(signal);
      }
      while (token) {
        if (seen.has(token)) throw failure('PAGINATION', 'Inventory continuation repeated a token');
        if (pages >= maxPages) throw failure('LIMIT', 'Inventory page limit reached');
        seen.add(token);
        const page = await request('inventory-more', { token }, signal);
        active(signal);
        const nextTable = page.querySelector('#table-inventory') || page.querySelector('table:not([id])');
        if (!nextTable) throw failure('SCHEMA', 'Inventory continuation table was not returned');
        if (!nextTable.tBodies[0]) throw failure('SCHEMA', 'Inventory continuation table body is missing');
        if (nextTable.querySelector('thead th') && JSON.stringify(schema(nextTable).names) !== JSON.stringify(format.names)) {
          throw failure('SCHEMA', 'Inventory continuation changed its column schema');
        }
        const parsed = parseInventoryRows(nextTable, format), next = pagination(page);
        if (!parsed.rows.length && next) throw failure('PAGINATION', 'Empty nonterminal inventory page');
        if (rows.length + parsed.rows.length > maxRows) throw failure('LIMIT', 'Inventory row limit reached');
        for (const node of parsed.nodes) body.appendChild(document.importNode(node, true));
        rows.push(...parsed.rows); pages++; token = next;
      }
      const sum = rows.reduce((sum, row) => sum + row.qty, 0);
      if (!Number.isSafeInteger(sum)) throw failure('SCHEMA', 'Inventory total exceeds the safe range');
      if (advertised !== null && sum !== advertised) throw failure('TOTAL', 'Inventory quantity does not match the advertised total');
      complete = true;
      active(signal); evidence({ endpoint: 'inventory', outcome: 'complete', pages, records: rows.length });
    } catch (cause) {
      active(signal);
      // Only expected read/validation failures may become partial display output.
      if (!(cause instanceof FcrReadError) || cause.code === 'CANCELLED') throw cause;
      error = cause;
      evidence({ endpoint: 'inventory', outcome: 'incomplete', code: error.code, pages, records: rows.length });
      if (!allowPartial) throw failure(error.code, 'Inventory incomplete: ' + error.message, { cause: error, partial: result(error.message, error.code) });
    }
    active(signal);
    return result(error?.message, error?.code);
  }

  async function history(queryValue, { signal, startDate, endDate, allowPartial = false } = {}) {
    const query = searchValue(queryValue), start = dateField(startDate), end = dateField(endDate);
    if (start.time > end.time) throw failure('INPUT', 'Inventory History start date is after its end date');
    const document = await request('inventory-history', {
      s: query, startSearchDateString: start.native, endSearchDateString: end.native, dateStringFormat: 'MM/dd/yyyy'
    }, signal);
    active(signal);
    const table = document.querySelector('#table-inventory-history');
    if (!table) throw failure('SCHEMA', 'Inventory History table was not returned');
    const width = table.tHead?.rows[0]?.cells.length;
    if (!width) throw failure('SCHEMA', 'Inventory History column headers are missing');
    const body = table.tBodies[0];
    if (!body) throw failure('SCHEMA', 'Inventory History table body is missing');
    const validateRows = candidate => [...(candidate.tBodies[0]?.rows || [])].filter(node => !node.querySelector('td.dataTables_empty')).map(node => {
      if (node.cells.length !== width) throw failure('SCHEMA', 'Inventory History row has unexpected columns');
      return node;
    });
    validateRows(table);
    let pages = 1, records = validateRows(table).length, complete = false, error;
    const seen = new Set();
    try {
      let token = pagination(document);
      if (records > maxRows || (token && !records)) throw failure('PAGINATION', 'Inventory History page is empty or exceeds the row limit');
      while (token) {
        if (seen.has(token) || pages >= maxPages) throw failure('PAGINATION', 'Inventory History continuation cycle/limit');
        seen.add(token);
        const page = await request('inventory-history-more', { token }, signal);
        active(signal);
        const nextTable = page.querySelector('#table-inventory-history') || page.querySelector('table:not([id])');
        if (!nextTable) throw failure('SCHEMA', 'Inventory History continuation table was not returned');
        if (!nextTable.tBodies[0]) throw failure('SCHEMA', 'Inventory History continuation table body is missing');
        const nodes = validateRows(nextTable), next = pagination(page);
        if ((!nodes.length && next) || records + nodes.length > maxRows) throw failure('PAGINATION', 'Inventory History continuation is empty or exceeds the row limit');
        for (const node of nodes) body.appendChild(document.importNode(node, true));
        records += nodes.length; pages++; token = next;
      }
      complete = true;
    } catch (cause) {
      active(signal);
      if (!(cause instanceof FcrReadError) || cause.code === 'CANCELLED' || !allowPartial) throw cause;
      error = cause;
    }
    document.querySelectorAll('.pagination-token').forEach(node => node.remove());
    active(signal);
    evidence({ endpoint: 'inventory-history', outcome: complete ? 'complete' : 'incomplete', pages, records, code: error?.code });
    active(signal);
    return { query, html: document.body.innerHTML, pages, records, complete, warning: error?.message || '', ...(error ? { code: error.code } : {}), source: 'network' };
  }

  async function section(endpoint, query, options = {}) {
    if (!FCR_SECTIONS.includes(endpoint)) throw failure('INPUT', 'Unsupported native FCR section');
    if (endpoint === 'inventory') return inventory(query, options);
    if (endpoint === 'product') return product(query, options);
    if (endpoint === 'inventory-history' && (options.startDate || options.endDate)) return history(query, options);
    const search = searchValue(query), document = await request(endpoint, { s: search }, options.signal);
    active(options.signal);
    const recognized = document.querySelector('table, [data-section-type="' + endpoint + '"]');
    if (!recognized) throw failure('SCHEMA', 'Native section markup was not returned');
    let pages = 1, records = 0, paginationComplete = false, error;
    const table = document.getElementById('table-' + endpoint), body = table?.tBodies[0], width = table?.tHead?.rows[0]?.cells.length;
    const validate = candidate => [...(candidate?.tBodies[0]?.rows || [])].filter(node => !node.querySelector('td.dataTables_empty')).map(node => {
      if (node.cells.length !== width) throw failure('SCHEMA', endpoint + ': continuation row has unexpected columns');
      return node;
    });
    if (body && width) records = validate(table).length;
    if (records > maxRows) throw failure('LIMIT', endpoint + ': native row limit reached');
    try {
      let token = pagination(document);
      if (token && (!body || !width)) throw failure('SCHEMA', endpoint + ': paginated native table was not returned');
      const seen = new Set();
      if (records > maxRows || (token && !records)) throw failure('PAGINATION', endpoint + ': nonterminal page is empty or exceeds the row limit');
      while (token) {
        if (seen.has(token) || pages >= maxPages) throw failure('PAGINATION', endpoint + ': continuation cycle/limit');
        seen.add(token);
        const page = await request(endpoint + '-more', { token }, options.signal);
        active(options.signal);
        const nextTable = page.getElementById('table-' + endpoint) || page.querySelector('table:not([id])');
        if (!nextTable?.tBodies[0]) throw failure('SCHEMA', endpoint + ': continuation table was not returned');
        const headers = [...(nextTable.tHead?.rows[0]?.cells || [])];
        if (headers.length && (headers.length !== width || headers.some((header, index) => text(header.textContent) !== text(table.tHead.rows[0].cells[index].textContent)))) {
          throw failure('SCHEMA', endpoint + ': continuation columns changed');
        }
        const nodes = validate(nextTable), next = pagination(page);
        if ((!nodes.length && next) || records + nodes.length > maxRows) throw failure('PAGINATION', endpoint + ': continuation is empty or exceeds the row limit');
        for (const marker of page.querySelectorAll('.show-message')) document.getElementById(text(marker.textContent))?.classList.remove('aok-hidden');
        for (const node of nodes) body.appendChild(document.importNode(node, true));
        records += nodes.length; pages++; token = next;
      }
      paginationComplete = true;
    } catch (cause) {
      active(options.signal);
      if (!(cause instanceof FcrReadError) || cause.code === 'CANCELLED' || !options.allowPartial) throw cause;
      error = cause;
    }
    document.querySelectorAll('.pagination-token').forEach(node => node.remove());
    active(options.signal);
    return { endpoint, query: search, html: document.body.innerHTML, complete: false, paginationComplete, pages, records,
      warning: error?.message || 'Native section completeness has not been validated', ...(error ? { code: error.code } : {}), source: 'network' };
  }

  return Object.freeze({ product, inventory, history, section });
}
