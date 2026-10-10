const privateField = /pass|token|secret|csrf|auth|cookie|session|employee|associate|login|user(?:id|name)|email/i;
const correlatedField = /^(?:object|workflow|request|transaction|correlation)[_-]?id$/i;

// One redactor owns one export. Aliases are stable within that file only.
export function createCaptureRedactor(window) {
  const containers = new Map(), identifiers = new Map();
  function alias(map, value, prefix) {
    if (!map.has(value)) map.set(value, prefix + String(map.size + 1).padStart(4, '0'));
    return map.get(value);
  }
  function text(value) {
    return String(value)
      .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED JWT]')
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
      .replace(/(["']?(?:authorization|access[_-]?token|id[_-]?token|refresh[_-]?token|password|secret|csrf[_-]?token|csrf|cookie|session(?:[_-]?id|[_-]?token)?|employee(?:Login|Id)|associate(?:Login|Id)|user(?:Login|Id|Name)|email)["']?\s*[:=]\s*)(["'])[^\r\n]*?\2/gi, '$1$2[REDACTED]$2')
      .replace(/(["']?(?:employee(?:Login|Id)|associate(?:Login|Id)|user(?:Login|Id|Name)|session(?:[_-]?id)?|csrf|password|secret)["']?\s*[:=]\s*)(?:-?\d+(?:\.\d+)?|true|false|null)(?=[\s,;}])/gi, '$1"[REDACTED]"')
      .replace(/(["']?(?:object|workflow|request|transaction|correlation)[_-]?id["']?\s*[:=]\s*)(["'])([^\r\n]*?)\2/gi,
        (_match, key, quote, value) => key + quote + alias(identifiers, value, 'IDCAPTURE') + quote)
      .replace(/\b(?:tsX|csX)[A-Za-z0-9_-]+\b/gi, code => alias(containers, code.toUpperCase(), code.slice(0, 3) + 'CAPTURE'));
  }
  function url(raw) {
    const parsed = new window.URL(raw, window.location.href);
    parsed.username = ''; parsed.password = '';
    for (const [key, value] of [...parsed.searchParams]) {
      if (privateField.test(key)) parsed.searchParams.set(key, '[REDACTED]');
      else if (correlatedField.test(key)) parsed.searchParams.set(key, alias(identifiers, value, 'IDCAPTURE'));
      else parsed.searchParams.set(key, text(value));
    }
    parsed.pathname = text(parsed.pathname);
    parsed.hash = privateField.test(parsed.hash) ? '[REDACTED]' : text(parsed.hash);
    return parsed.href;
  }
  function scrubDocument(doc) {
    doc.querySelectorAll('input,textarea,select').forEach(node => {
      if (!privateField.test(node.name + ' ' + node.id + ' ' + node.type)) {
        if (correlatedField.test(node.name) || correlatedField.test(node.id)) {
          node.setAttribute('value', alias(identifiers, node.value, 'IDCAPTURE'));
          if (node.tagName !== 'INPUT') node.textContent = node.getAttribute('value');
        }
        return;
      }
      node.setAttribute('value', '[REDACTED]');
      if (node.tagName !== 'INPUT') node.textContent = '[REDACTED]';
    });
    doc.querySelectorAll('meta[name]').forEach(node => {
      if (privateField.test(node.name)) node.setAttribute('content', '[REDACTED]');
    });
  }
  function body(raw) {
    const value = String(raw);
    let parsed;
    try { parsed = JSON.parse(value); } catch {}
    if (parsed !== undefined) {
      let nodes = 0;
      function walk(value, depth = 0) {
        if (++nodes > 10000 || depth > 32) throw new Error('Redaction structure limit reached');
        if (Array.isArray(value)) return value.map(item => walk(item, depth + 1));
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
          privateField.test(key) ? '[REDACTED]' : correlatedField.test(key) && (typeof item === 'string' || typeof item === 'number')
            ? alias(identifiers, String(item), 'IDCAPTURE') : walk(item, depth + 1)]));
        return typeof value === 'string' ? text(value) : value;
      }
      return JSON.stringify(walk(parsed));
    }
    if (/^\s*</.test(value)) {
      const doc = new window.DOMParser().parseFromString(value, 'text/html');
      scrubDocument(doc); return text(doc.documentElement.outerHTML);
    }
    // Native FCR POSTs use URL-encoded forms. Do not decode arbitrary source text.
    if (/^[\w.%+-]+=[^\r\n]*$/.test(value)) {
      const form = new window.URLSearchParams(value);
      for (const [key, item] of [...form]) {
        form.set(key, privateField.test(key) ? '[REDACTED]' : correlatedField.test(key)
          ? alias(identifiers, item, 'IDCAPTURE') : text(item));
      }
      return form.toString();
    }
    return text(value);
  }
  return { text, url, body, scrubDocument };
}
