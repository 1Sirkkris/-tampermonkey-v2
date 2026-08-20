import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');

export const CURRENT_SCRIPTS = [
  'MAIN_v0.2.1_Sideline_API_Move_TEST.txt',
  'MAIN_v0.9.4_AFT_Edit-SKU-Move_master_PRODUCTION_CLEAN.txt',
  'TEST_v0.1.10_FCResearch_Master_CLEAN_TEST_USAGE.txt',
  'TEST_v0.1.29_FC-Lite_USAGE.txt',
  'TEST_v0.1.5_BWU2_Super_Tracer.txt',
  'TEST_v0.2.16_Dropzone_Selector_Queue.txt',
  'TEST_v0.2.3_FCR_Data_Core_USAGE.txt',
  'TEST_v5.4.10_Stow_Andons_Helper_Safe_Trim_USAGE.txt',
  'TEST_v7.3.6_Bin_check_Overlay_USAGE.txt'
];

export const DIAGNOSTIC_SCRIPTS = [
  'DIAG_v0.1.0_Sideline_Close_Container_Capture.txt',
  'Diagnostics/DIAG_v0.1.0_Sideline_Close_Container_Capture.user.js',
  'Diagnostics/DIAG_v0.2.0_Unified_Live_Evidence_Capture.user.js'
];

const uniqueSorted = values => [...new Set(values.filter(Boolean))].sort();
const normalize = value => String(value ?? '').replace(/\r/g, '').replace(/\s+/g, ' ').trim();
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function readScript(file) {
  return readFile(path.join(ROOT, file), 'utf8');
}

export function parseMetadata(source) {
  const start = source.indexOf('// ==UserScript==');
  const end = source.indexOf('// ==/UserScript==');
  if (start < 0 || end < start) return null;
  const entries = {};
  for (const line of source.slice(start, end).split(/\r?\n/)) {
    const match = line.match(/^\/\/\s+@([\w-]+)\s*(.*)$/);
    if (!match) continue;
    const [, key, raw] = match;
    (entries[key] ||= []).push(raw.trim());
  }
  for (const values of Object.values(entries)) values.sort();
  return entries;
}

function collect(source, pattern, group = 1) {
  const values = [];
  for (const match of source.matchAll(pattern)) values.push(normalize(match[group]));
  return uniqueSorted(values);
}

function stringLiterals(source) {
  return collect(source, /(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g, 2);
}

function functionCounts(source) {
  const counts = {};
  for (const name of collect(source, /\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    const pattern = new RegExp(`\\b(?:async\\s+)?function\\s+${name.replace(/[$]/g, '\\$&')}\\s*\\(`, 'g');
    counts[name] = [...source.matchAll(pattern)].length;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function listenerSignatures(source) {
  const counts = {};
  const pattern = /([A-Za-z_$][\w$]*(?:\?\.|\.)?[\w$]*(?:\([^\n]{0,80}\))?)\.addEventListener\(\s*(['"])([^'"]+)\2/g;
  for (const match of source.matchAll(pattern)) {
    const key = `${normalize(match[1])}:${match[3]}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function payloadKeys(source) {
  const shapes = [];
  const marker = /JSON\.stringify\s*\(\s*\{/g;
  for (const match of source.matchAll(marker)) {
    const start = source.indexOf('{', match.index);
    let depth = 0;
    let quote = '';
    let escaped = false;
    let end = -1;
    for (let index = start; index < source.length; index++) {
      const char = source[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === quote) quote = '';
        continue;
      }
      if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
      if (char === '{') depth++;
      if (char === '}' && --depth === 0) { end = index; break; }
    }
    if (end < 0) continue;
    const body = source.slice(start + 1, end);
    const keys = collect(body, /(?:^|[,{])\s*(?:\.\.\.)?(['"]?)([A-Za-z_$][\w$-]*)\1\s*:/gm, 2);
    if (keys.length) shapes.push(keys);
  }
  return uniqueSorted(shapes.map(keys => keys.join(',')));
}

export function extractContractCategories(source) {
  const literals = stringLiterals(source);
  const selectors = [];
  const selectorPattern = /(?:querySelector(?:All)?|closest|matches|getElementById|getElementsByClassName|\$\$?)\s*\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  for (const match of source.matchAll(selectorPattern)) selectors.push(normalize(match[2]));

  const labels = [
    ...collect(source, /\.textContent\s*=\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g, 2),
    ...collect(source, /\bplaceholder\s*=\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g, 2)
  ];

  const shortcutLines = source.split(/\r?\n/)
    .filter(line => /\.(?:key|altKey|ctrlKey|metaKey|shiftKey)\b/.test(line))
    .map(normalize);

  const eventNames = [
    ...collect(source, /(?:addEventListener|CustomEvent)\s*\(\s*(['"])([^'"]+)\1/g, 2),
    ...collect(source, /\b[A-Z][A-Z0-9_]*EVENT\s*=\s*(['"])([^'"]+)\1/g, 2)
  ];

  return {
    metadata: parseMetadata(source),
    initGuards: collect(source, /\b(?:window|W)\.(__[A-Za-z0-9_$]+)\b/g),
    endpoints: uniqueSorted(literals.filter(value => /https?:\/\/|\/api\/|^\/(?:action|status|end)$|container-hierarchy/i.test(value))),
    storageKeys: uniqueSorted(literals.filter(value => /^(?:__bwu2|aftm_|bwu2|fcsku_|fcr_|moveapp_|sideline)/i.test(value))),
    selectors: uniqueSorted(selectors),
    shortcuts: uniqueSorted(shortcutLines),
    events: uniqueSorted(eventNames),
    labels: uniqueSorted(labels),
    payloadShapes: payloadKeys(source),
    functions: functionCounts(source),
    listeners: listenerSignatures(source)
  };
}

export function lockView(categories) {
  const digests = {};
  for (const [key, value] of Object.entries(categories)) digests[key] = digest(value);
  return {
    metadata: categories.metadata,
    digests,
    duplicateFunctions: Object.fromEntries(Object.entries(categories.functions).filter(([, count]) => count > 1)),
    duplicateListeners: Object.fromEntries(Object.entries(categories.listeners).filter(([, count]) => count > 1))
  };
}

export async function buildLock() {
  const scripts = {};
  for (const file of CURRENT_SCRIPTS) scripts[file] = lockView(extractContractCategories(await readScript(file)));
  return { schemaVersion:1, generatedFrom:'offline-cleanup-pass-1', scripts };
}
