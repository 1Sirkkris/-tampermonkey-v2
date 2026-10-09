// Shared DOM registration works across isolated userscript worlds; no runtime dependency.
export function registerWatermark(window, label, version) {
  if (!/^[A-Za-z0-9]{1,5}$/.test(label) || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version)) throw new Error('Invalid V4 runtime identity');
  const document = window.document, id = 'tm-v4-runtime-watermark';
  const token = typeof window.crypto.randomUUID === 'function' ? window.crypto.randomUUID() :
    [...window.crypto.getRandomValues(new Uint32Array(4))].map(value => value.toString(16)).join('-');
  let disposed = false;
  function render(host) {
    const entries = [...host.children].sort((a, b) => a.dataset.tmV4Runtime.localeCompare(b.dataset.tmV4Runtime));
    entries.forEach((entry, index) => { entry.textContent = (index ? ' | ' : '') + 'V4 ' + entry.dataset.tmV4Runtime + ': ' + entry.dataset.tmV4Version; host.appendChild(entry); });
    if (!entries.length) host.remove();
  }
  function mount() {
    if (disposed) return;
    let host = document.getElementById(id);
    if (!host) {
      host = document.createElement('div'); host.id = id; host.dataset.tmV4Script = 'RUNTIME'; host.setAttribute('aria-hidden', 'true');
      host.style.cssText = 'position:fixed;left:50%;bottom:2px;transform:translateX(-50%);z-index:2147483000;max-width:94vw;padding:2px 7px;border-radius:6px 6px 0 0;background:rgba(255,255,255,.34);color:rgba(15,23,42,.52);font:800 11px/1.25 Arial,sans-serif;letter-spacing:.2px;pointer-events:none;user-select:none;text-align:center;text-shadow:0 1px 1px rgba(255,255,255,.95)';
      document.documentElement.appendChild(host);
    }
    let entry = [...host.children].find(node => node.dataset.tmV4Runtime === label);
    if (!entry) { entry = document.createElement('span'); entry.dataset.tmV4Runtime = label; host.appendChild(entry); }
    entry.dataset.tmV4Version = version; entry.dataset.tmV4Owner = token; render(host);
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    document.removeEventListener('DOMContentLoaded', mount); window.removeEventListener('pagehide', dispose);
    const host = document.getElementById(id); if (!host) return;
    const entry = [...host.children].find(node => node.dataset.tmV4Runtime === label && node.dataset.tmV4Owner === token);
    entry?.remove(); render(host);
  }
  mount();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  window.addEventListener('pagehide', dispose, { once: true });
  return dispose;
}
