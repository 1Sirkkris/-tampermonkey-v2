// V3 source module: one isolated suite root.
// The native page is an input surface, not the layout host for our application.

export function createSuiteRoot({
  id,
  title,
  version,
  documentRef = document
}) {
  if (!documentRef.body) throw new Error('V3 suite root requires document.body');
  const existing = documentRef.getElementById(id);
  if (existing) return { host: existing, shadow: existing.shadowRoot, reused: true };

  const host = documentRef.createElement('div');
  host.id = id;
  host.dataset.bwu2V3Ui = '1';
  host.dataset.bwu2Owner = title;
  const shadow = host.attachShadow({ mode: 'open' });
  documentRef.body.appendChild(host);

  return { host, shadow, reused: false, title, version };
}
