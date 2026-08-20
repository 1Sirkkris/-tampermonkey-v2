import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
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
const MAX_CONTRACT_LITERAL_CHARS = 500;

export async function readScript(file) {
  return readFile(path.join(ROOT, file), 'utf8');
}

export async function discoverUserscriptFiles() {
  const found = [];
  async function walk(directory, relative = '') {
    for (const entry of await readdir(directory, { withFileTypes:true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const file = relative ? `${relative}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) { await walk(absolute, file); continue; }
      if (!entry.isFile() || (!entry.name.endsWith('.txt') && !entry.name.endsWith('.user.js'))) continue;
      if (parseMetadata(await readFile(absolute, 'utf8'))) found.push(file);
    }
  }
  await walk(ROOT);
  return found.sort();
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

function literalTokens(source) {
  const tokens = [];
  const regexPrefixes = new Set([
    '', '(', '[', '{', ',', ';', '=', ':', '!', '?', '&&', '||', '=>',
    'return', 'case', 'throw', 'else', 'do', 'yield', 'await'
  ]);

  function quoted(index, quote) {
    const tokenStart = index;
    const start = ++index;
    while (index < source.length) {
      if (source[index] === '\\') { index += 2; continue; }
      if (source[index] === quote) {
        tokens.push({ value:normalize(source.slice(start, index)), start:tokenStart, end:index });
        return index + 1;
      }
      index++;
    }
    return index;
  }

  function regex(index) {
    let inClass = false;
    index++;
    while (index < source.length) {
      const char = source[index];
      if (char === '\\') { index += 2; continue; }
      if (char === '[') inClass = true;
      else if (char === ']') inClass = false;
      else if (char === '/' && !inClass) {
        index++;
        while (/[A-Za-z]/.test(source[index] || '')) index++;
        return index;
      }
      index++;
    }
    return index;
  }

  function template(index) {
    const tokenStart = index;
    const start = ++index;
    while (index < source.length) {
      if (source[index] === '\\') { index += 2; continue; }
      if (source[index] === '`') {
        tokens.push({ value:normalize(source.slice(start, index)), start:tokenStart, end:index });
        return index + 1;
      }
      if (source[index] === '$' && source[index + 1] === '{') {
        index = code(index + 2, true);
        continue;
      }
      index++;
    }
    return index;
  }

  function code(index = 0, stopAtBrace = false) {
    let braceDepth = stopAtBrace ? 1 : 0;
    let previous = '';
    while (index < source.length) {
      const char = source[index];
      const next = source[index + 1];
      if (/\s/.test(char)) { index++; continue; }
      if (char === '/' && next === '/') {
        index += 2;
        while (index < source.length && source[index] !== '\n') index++;
        continue;
      }
      if (char === '/' && next === '*') {
        const end = source.indexOf('*/', index + 2);
        index = end < 0 ? source.length : end + 2;
        continue;
      }
      if (char === '"' || char === "'") { index = quoted(index, char); previous = 'value'; continue; }
      if (char === '`') { index = template(index); previous = 'value'; continue; }
      if (char === '/' && regexPrefixes.has(previous)) { index = regex(index); previous = 'value'; continue; }
      if (/[A-Za-z_$]/.test(char)) {
        const match = source.slice(index).match(/^[A-Za-z_$][\w$]*/);
        previous = match[0];
        index += match[0].length;
        continue;
      }
      if (/\d/.test(char)) {
        const match = source.slice(index).match(/^\d+(?:\.\d+)?/);
        previous = 'value';
        index += match[0].length;
        continue;
      }
      if (stopAtBrace && char === '{') braceDepth++;
      if (stopAtBrace && char === '}' && --braceDepth === 0) return index + 1;
      const pair = source.slice(index, index + 2);
      previous = ['&&', '||', '=>'].includes(pair) ? pair : char;
      index += previous.length;
    }
    return index;
  }

  code();
  return tokens;
}

function stringLiterals(source) {
  return uniqueSorted(literalTokens(source).map(token => token.value));
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
  const labels = [];
  for (const token of literalTokens(source)) {
    const prefix = source.slice(Math.max(0, token.start - 180), token.start);
    if (/(?:querySelector(?:All)?|closest|matches|getElementById|getElementsByClassName|\$\$?)\s*\(\s*$/.test(prefix)) {
      selectors.push(token.value);
    }
    if (/(?:\.textContent|\bplaceholder)\s*=\s*$/.test(prefix)) labels.push(token.value);
  }

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
    endpoints: uniqueSorted(literals.filter(value => /^(?:https?:\/\/[^/]|\/api\/|\/(?:action|status|end)$)|container-hierarchy/i.test(value))),
    storageKeys: uniqueSorted(literals.filter(value =>
      /^(?:__bwu2[_:.-]|aftm_|bwu2:|fcsku_|fcr[_:.-]|moveapp_|sideline[A-Za-z0-9_.:+-])[A-Za-z0-9_.:+-]*$/.test(value) &&
      !eventNames.includes(value)
    )),
    selectors: uniqueSorted(selectors.filter(value => value.length <= MAX_CONTRACT_LITERAL_CHARS)),
    shortcuts: uniqueSorted(shortcutLines),
    events: uniqueSorted(eventNames),
    labels: uniqueSorted(labels.filter(value => value.length <= MAX_CONTRACT_LITERAL_CHARS)),
    payloadShapes: payloadKeys(source)
  };
}

export function lockView(categories) {
  const digests = {};
  for (const [key, value] of Object.entries(categories)) digests[key] = digest(value);
  return { metadata:categories.metadata, digests };
}

export async function buildLock() {
  const scripts = {};
  for (const file of CURRENT_SCRIPTS) scripts[file] = lockView(extractContractCategories(await readScript(file)));
  return { schemaVersion:2, generatedFrom:'offline-cleanup-pass-1', scripts };
}
