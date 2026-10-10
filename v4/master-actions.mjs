import { productPanel } from './master-features.mjs';

const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const upper = value => clean(value).toUpperCase();
const UI = '[data-tm-v4-master]';
const hex = value => Array.from(String(value)).map(character => character.charCodeAt(0).toString(16)).join('');
export function printableCode(value) {
  const match = clean(value).match(/\b(?:LPN[A-Za-z0-9-]{4,}|FBA[A-Za-z0-9]{6,}|[A-Za-z0-9]{10})\b/);
  return match?.[0] || '';
}
export function printmonUrl({ code, quantity, description = '', badge = '', sequence }) {
  if (!code || !/^[A-Za-z0-9-]{1,128}$/.test(code) || !Number.isInteger(quantity) || quantity < 1 || quantity > 9999) throw new Error('Invalid print code or quantity');
  const url = new URL('http://localhost:5965/printer');
  for (const [key, value] of Object.entries({ action: 'print', type: 'barcode', data: hex(code), text: hex(code), quantity, desc: hex(description), badgeid: badge, seq: sequence })) url.searchParams.set(key, String(value));
  return url.href;
}

function plainText(fragment) {
  const walk = node => {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1 && node.nodeType !== 11) return '';
    if (node.tagName === 'BR') return '\n';
    const values = [...node.childNodes].map(walk);
    if (node.tagName === 'TR') return [...node.children].map(walk).join('\t') + '\n';
    return values.join('') + (/^(?:TABLE|P|DIV)$/.test(node.tagName) ? '\n' : '');
  };
  return walk(fragment).trim();
}
export function cleanProductSelection({ document, selection, table }) {
  if (!selection || !table || selection.isCollapsed || !selection.rangeCount) return null;
  const ranges = Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index));
  if (!ranges.some(range => { try { return range.intersectsNode(table); } catch { return false; } })) return null;
  const touchedUi = [...table.querySelectorAll(UI)].some(node => ranges.some(range => { try { return range.intersectsNode(node); } catch { return false; } }));
  // Leave clean native partial selections (especially Title) to the browser.
  if (!touchedUi) return null;
  const text = [], html = [];
  for (const range of ranges) {
    const ancestor = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    if (ancestor?.closest(UI)) continue;
    const fragment = range.cloneContents(); fragment.querySelectorAll(UI).forEach(node => node.remove());
    fragment.querySelectorAll('[data-tm-v4-label-action], [data-tm-v4-property]').forEach(node => {
      node.removeAttribute('data-tm-v4-label-action'); node.removeAttribute('data-tm-v4-property'); node.removeAttribute('role'); node.removeAttribute('tabindex');
    });
    for (const anchor of fragment.querySelectorAll('a[href]')) anchor.setAttribute('href', anchor.href);
    const wrapper = document.createElement('div'); wrapper.append(fragment);
    text.push(plainText(wrapper)); html.push(wrapper.innerHTML);
  }
  return { text: text.filter(Boolean).join('\n'), html: html.join('<br>') };
}

export function createMasterActions({ window, runtime, fetch = window.fetch.bind(window), onEvidence = () => {}, uuid = () => window.crypto.randomUUID(), timeoutMs = 15000 }) {
  const document = window.document, lifetime = new window.AbortController();
  const modified = new Map(), nodes = new Set(), prints = new Set();
  const mark = node => { runtime.mark(node); nodes.add(node); return node; };
  function attr(node, name, value) {
    if (!modified.has(node)) modified.set(node, new Map());
    if (!modified.get(node).has(name)) modified.get(node).set(name, node.getAttribute(name));
    node.setAttribute(name, value);
  }
  function panel() { return productPanel(document, runtime.current()?.sections.get('product')?.result?.product); }
  function emit(operationId, phase, data) {
    try { onEvidence({ type: 'operation', script: 'FCR MASTER', version: runtime.version, intent: 'mutation', operationId, phase, data: { kind: 'label-print', endpoint: 'Printmon', ...data } }); }
    catch { /* Printing cannot require OBS. */ }
  }
  function clickedDescription(code, target, currentPanel) {
    const row = target?.closest('tr'), table = row?.closest('table');
    if (row && table) {
      const head = table.closest('.dataTables_scroll')?.querySelector('.dataTables_scrollHead table') || table;
      const index = [...head.querySelectorAll('thead th')].findIndex(node => /^(?:title|product|description|item name)$/i.test(clean(node.textContent)));
      if (index >= 0) return clean(row.cells[index]?.textContent);
    }
    return currentPanel?.product.aliases.includes(upper(code)) ? currentPanel.product.title : '';
  }
  async function print(code, quantity = 1, target) {
    const gen = runtime.current(); if (!gen || !runtime.active(gen) || lifetime.signal.aborted) return;
    if (/^LPN/i.test(code) && !window.confirm('Barcode: ' + code + '\n\nLPNs are unique. Print this LPN?')) return;
    let description = /^LPN|^FBA/i.test(code) ? '' : clickedDescription(code, target, panel());
    if (!description && /^[A-Z0-9]{10}$/i.test(code)) {
      try { const result = await runtime.reader.product(code, { signal: gen.controller.signal }); description = result.product.title; }
      catch { /* An unresolved exact title may use the proven code-only fallback. */ }
    }
    if (!runtime.active(gen) || lifetime.signal.aborted) return;
    const operationId = 'print.' + uuid(), controller = new window.AbortController();
    const job = { controller, settled: false, timer: null, finish: null };
    const badge = document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith('fcmenu-employeeId='))?.slice('fcmenu-employeeId='.length) || '';
    let url;
    try { url = printmonUrl({ code, quantity, description, badge, sequence: window.crypto.getRandomValues(new Uint32Array(1))[0] }); }
    catch (error) { runtime.notify(error.message); return; }
    const finished = (outcome, message) => {
      if (job.settled) return; job.settled = true; window.clearTimeout(job.timer); prints.delete(job);
      // Neither HTTP success nor body absence establishes accepted-job or
      // physical label output. A confirmed service contract is still required.
      emit(operationId, 'UNKNOWN', { quantity, outcome, acknowledgement: 'unverified' });
      if (runtime.active(gen) && !lifetime.signal.aborted) runtime.notify(message);
    };
    job.finish = finished; prints.add(job);
    emit(operationId, 'SUBMITTED', { quantity });
    job.timer = window.setTimeout(() => { finished('timeout', 'Printmon timed out — check the printer before printing again'); controller.abort(); }, timeoutMs);
    try {
      const response = await fetch(url, { method: 'GET', signal: controller.signal });
      if (response.ok) finished('response-received', 'Print request sent; label output unverified');
      else finished('http-' + response.status, 'Printmon HTTP ' + response.status + ' — check the printer before printing again');
    } catch { finished('transport-failed', 'Printmon request failed — check the printer before printing again'); }
  }
  function targetCode(target) {
    if (!(target instanceof window.Element) || target.closest(UI)) return '';
    const context = target.closest('[data-section-type],table[id^="table-"]'); if (!context) return '';
    const node = target.closest('a,td,th') || target;
    const clone = node.cloneNode(true); clone.querySelectorAll(UI).forEach(child => child.remove());
    return printableCode(clone.textContent);
  }
  const activate = event => {
    if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
    const target = event.target instanceof window.Element ? event.target : event.target?.parentElement;
    if (!target) return;
    const quantity = target.closest('[data-tm-v4-quantity]');
    if (quantity && event.type === 'keydown' && event.key === 'Enter') {
      event.preventDefault(); event.stopPropagation();
      const code = quantity.dataset.code, count = Number(quantity.value);
      if (/^\d{1,4}$/.test(quantity.value) && count > 0) void print(code, count, quantity);
      return;
    }
    if (event.type === 'click' && event.altKey) {
      const code = targetCode(target); if (!code) return;
      event.preventDefault(); event.stopImmediatePropagation(); void print(code, 1, target); return;
    }
    const label = target.closest('[data-tm-v4-label-action]'); if (!label) return;
    event.preventDefault(); event.stopPropagation();
    if (label.dataset.tmV4LabelAction === 'ISS') { window.location.hash = '#iss-console'; return; }
    const current = panel(), entry = current?.entries.get(label.dataset.tmV4LabelAction);
    if (entry) void print(entry.text, 1, label);
  };
  document.addEventListener('click', activate, { capture: true, signal: lifetime.signal });
  document.addEventListener('keydown', activate, { capture: true, signal: lifetime.signal });
  for (const type of ['pointerdown', 'mousedown', 'auxclick']) document.addEventListener(type, event => {
    if (event.altKey && targetCode(event.target)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, { capture: true, signal: lifetime.signal });
  document.addEventListener('input', event => {
    if (event.target.matches?.('[data-tm-v4-quantity]')) event.target.value = event.target.value.replace(/\D/g, '').slice(0, 4);
  }, { signal: lifetime.signal });
  document.addEventListener('copy', event => {
    const current = panel(); if (!current || !event.clipboardData) return;
    const output = cleanProductSelection({ document, selection: window.getSelection(), table: current.table });
    if (!output) return;
    event.preventDefault(); event.clipboardData.setData('text/plain', output.text); event.clipboardData.setData('text/html', output.html);
  }, { capture: true, signal: lifetime.signal });
  function refresh() {
    for (const node of nodes) if (!node.isConnected) nodes.delete(node);
    for (const node of modified.keys()) if (!node.isConnected) modified.delete(node);
    const current = panel(); if (!current) return;
    for (const field of ['ASIN', 'ISBN', 'FNSKU', 'WEIGHT']) {
      const entry = current.entries.get(field); if (!entry) continue;
      attr(entry.label, 'data-tm-v4-label-action', field === 'WEIGHT' ? 'ISS' : field);
      attr(entry.label, 'role', 'button'); attr(entry.label, 'tabindex', '0');
      attr(entry.label, 'title', field === 'WEIGHT' ? 'Open ISS Console' : 'Click to print ' + field);
      if (field === 'WEIGHT' || entry.value.querySelector('[data-tm-v4-quantity]')) continue;
      const input = mark(document.createElement('input')); input.type = 'text'; input.inputMode = 'numeric'; input.maxLength = 4;
      input.value = '1'; input.setAttribute('data-tm-v4-quantity', field); input.dataset.code = entry.text;
      input.setAttribute('aria-label', field + ' print quantity'); entry.value.append(input);
    }
  }
  function reset() {
    for (const node of nodes) node.remove(); nodes.clear();
    for (const [node, attributes] of modified) for (const [name, value] of attributes) value == null ? node.removeAttribute(name) : node.setAttribute(name, value);
    modified.clear();
  }
  function dispose() {
    lifetime.abort(); reset();
    for (const job of [...prints]) { job.finish('page-disposed', ''); job.controller.abort(); }
  }
  return Object.freeze({ refresh, reset, dispose, print });
}
