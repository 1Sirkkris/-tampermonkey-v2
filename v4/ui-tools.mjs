export const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
export const upper = value => clean(value).toUpperCase();
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
export function evidence(window, script, version, data) {
  try { window.dispatchEvent(new window.CustomEvent('tampermonkey-v4:evidence', { detail: JSON.stringify({ script, version, ...data }) })); } catch {}
}
export function createReadPool(limit = 4) {
  let running = 0; const jobs = [];
  function drain() {
    while (running < limit && jobs.length) {
      const job = jobs.shift();
      if (job.signal?.aborted) { job.reject(job.signal.reason); continue; }
      running++;
      Promise.resolve().then(job.work).then(job.resolve, job.reject).finally(() => { running--; drain(); });
    }
  }
  return (work, signal) => new Promise((resolve, reject) => { jobs.push({ work, signal, resolve, reject }); drain(); });
}
export function suspiciousDimensions(value) {
  const parts = String(value || '').match(/\d+(?:\.\d+)?/g)?.slice(0, 3);
  if (parts?.length !== 3) return false;
  const sizes = parts.map(Number), rounded = parts.filter(part => /\.00$/.test(part)).length;
  return sizes.some((size, i) => sizes.some((other, j) => i !== j && Math.abs(size - other) < .001)) || rounded === 3 || (Math.min(...sizes) <= 2.001 && rounded >= 2);
}
export function printBarcode(window, fetch, code, title, script, version) {
  const raw = clean(code).replace(/[\s-]/g, '');
  if (!/^[A-Za-z0-9]+$/.test(raw)) return Promise.reject(new Error('Invalid printable code'));
  const hex = value => [...String(value)].map(char => char.charCodeAt(0).toString(16)).join('');
  const badge = window.document.cookie.split('; ').find(row => row.startsWith('fcmenu-employeeId='))?.slice(18) || '';
  const params = new URLSearchParams({ action: 'print', type: 'barcode', data: hex(raw), text: hex(raw), quantity: '1', desc: hex(title || ''), badgeid: badge, seq: String(Date.now()) });
  evidence(window, script, version, { type: 'print.submit', intent: 'print', phase: 'SUBMITTED', data: { quantity: 1 } });
  return fetch('http://localhost:5965/printer?' + params).then(response => {
    if (!response.ok) throw new Error('Printmon rejected request');
    evidence(window, script, version, { type: 'print.response', intent: 'print', phase: 'UNKNOWN', data: { status: response.status, physicalOutput: 'unverified' } });
    return 'Print request sent — verify output';
  }, error => { evidence(window, script, version, { type: 'print.response', intent: 'print', phase: 'UNKNOWN', data: { outcome: 'network-error' } }); throw error; });
}
export function installRouteLifecycle(window, start, context = () => window.location.pathname + window.location.search + window.location.hash) {
  let dispose=()=>{}, current=context(), hidden=false;
  const run=()=>{dispose();dispose=start()||(()=>{});};
  run();
  const navigate=()=>{const next=context();if(next!==current){current=next;if(!hidden)run();}};
  const hide=()=>{hidden=true;dispose();dispose=()=>{};};
  const show=event=>{if(event.persisted){hidden=false;current=context();run();}};
  window.addEventListener('hashchange',navigate);window.addEventListener('popstate',navigate);window.addEventListener('pagehide',hide);window.addEventListener('pageshow',show);
  return()=>{hide();window.removeEventListener('hashchange',navigate);window.removeEventListener('popstate',navigate);window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',show);};
}
