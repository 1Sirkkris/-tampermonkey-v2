// V3 source module: FCResearch preview surface.
// Preliminary UI only. No warehouse mutation actions.

export const PREVIEW_VERSION = '0.0.1-pre';

export function detectFcrSurface(locationRef = location) {
  const hash = String(locationRef.hash || '').toLowerCase();
  if (hash.startsWith('#iss-console')) return 'ISS';
  if (hash.startsWith('#fcr-tote-checker')) return 'TOTE';
  if (hash.includes('worker')) return 'WORKER';
  return 'FCR';
}
