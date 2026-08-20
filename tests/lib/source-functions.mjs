function findFunctionStart(source, name) {
  const escaped = name.replace(/[$]/g, '\\$&');
  const declaration = new RegExp(`\\b(?:async\\s+)?function\\s+${escaped}\\s*\\(`).exec(source);
  if (declaration) return { start:declaration.index, declaration:true };
  const method = new RegExp(`\\b${escaped}\\s*\\(`).exec(source);
  if (method) return { start:method.index, declaration:false };
  throw new Error(`Function ${name} not found`);
}

function openingBrace(source, start) {
  let quote = '';
  let escaped = false;
  let parens = 0;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '(') parens++;
    else if (char === ')') parens--;
    else if (char === '{' && parens === 0) return index;
  }
  throw new Error('Function opening brace not found');
}

function closingBrace(source, start) {
  let depth = 0;
  let mode = 'code';
  let escaped = false;
  let regexClass = false;
  let previous = '';

  for (let index = start; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (mode === 'line') { if (char === '\n') mode = 'code'; continue; }
    if (mode === 'block') { if (char === '*' && next === '/') { mode = 'code'; index++; } continue; }
    if (mode === 'string') {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === previous) mode = 'code';
      continue;
    }
    if (mode === 'regex') {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '[') regexClass = true;
      else if (char === ']') regexClass = false;
      else if (char === '/' && !regexClass) mode = 'code';
      continue;
    }
    if (char === '/' && next === '/') { mode = 'line'; index++; continue; }
    if (char === '/' && next === '*') { mode = 'block'; index++; continue; }
    if (char === '"' || char === "'" || char === '`') { mode = 'string'; previous = char; continue; }
    if (char === '/' && /[([=,:;!&|?{}]/.test(previous || '(')) { mode = 'regex'; regexClass = false; continue; }
    if (char === '{') depth++;
    if (char === '}' && --depth === 0) return index;
    if (!/\s/.test(char)) previous = char;
  }
  throw new Error('Function closing brace not found');
}

export function extractFunction(source, name) {
  const found = findFunctionStart(source, name);
  const open = openingBrace(source, found.start);
  const close = closingBrace(source, open);
  const raw = source.slice(found.start, close + 1);
  if (found.declaration) return raw;
  const params = raw.slice(raw.indexOf('('), raw.indexOf('{'));
  return `function ${name}${params}${raw.slice(raw.indexOf('{'))}`;
}

export function compileFunction(source, name, bindings = {}) {
  const keys = Object.keys(bindings);
  const values = Object.values(bindings);
  const body = `"use strict"; return (${extractFunction(source, name)});`;
  return Function(...keys, body)(...values);
}

export function extractInitializer(source, name) {
  const escaped = name.replace(/[$]/g, '\\$&');
  const match = new RegExp(`\\b(?:const|let|var)\\s+${escaped}\\s*=`).exec(source);
  if (!match) throw new Error(`Variable ${name} not found`);
  const start = match.index + match[0].length;
  let mode = 'code';
  let escapedChar = false;
  let regexClass = false;
  let quote = '';
  let previous = '=';
  let round = 0;
  let square = 0;
  let curly = 0;

  for (let index = start; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (mode === 'line') { if (char === '\n') mode = 'code'; continue; }
    if (mode === 'block') { if (char === '*' && next === '/') { mode = 'code'; index++; } continue; }
    if (mode === 'string') {
      if (escapedChar) escapedChar = false;
      else if (char === '\\') escapedChar = true;
      else if (char === quote) mode = 'code';
      continue;
    }
    if (mode === 'regex') {
      if (escapedChar) escapedChar = false;
      else if (char === '\\') escapedChar = true;
      else if (char === '[') regexClass = true;
      else if (char === ']') regexClass = false;
      else if (char === '/' && !regexClass) mode = 'code';
      continue;
    }
    if (char === '/' && next === '/') { mode = 'line'; index++; continue; }
    if (char === '/' && next === '*') { mode = 'block'; index++; continue; }
    if (char === '"' || char === "'" || char === '`') { mode = 'string'; quote = char; continue; }
    if (char === '/' && /[([=,:;!&|?{}]/.test(previous || '=')) { mode = 'regex'; regexClass = false; continue; }
    if (char === '(') round++;
    else if (char === ')') round--;
    else if (char === '[') square++;
    else if (char === ']') square--;
    else if (char === '{') curly++;
    else if (char === '}') curly--;
    else if (char === ';' && round === 0 && square === 0 && curly === 0) return source.slice(start, index).trim();
    if (!/\s/.test(char)) previous = char;
  }
  throw new Error(`Variable ${name} initializer is not terminated`);
}

export function compileValue(source, name, bindings = {}) {
  const keys = Object.keys(bindings);
  const values = Object.values(bindings);
  return Function(...keys, `"use strict"; return (${extractInitializer(source, name)});`)(...values);
}
