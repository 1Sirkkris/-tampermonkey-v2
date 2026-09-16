from pathlib import Path

def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)

p = Path("BWU2_Observability_Core.user.js")
s = p.read_text(encoding="utf-8")

s = replace_once(s, "// @version      0.1.13", "// @version      0.1.14", "metadata version")
s = replace_once(s, "const VERSION = '0.1.13';", "const VERSION = '0.1.14';", "runtime version")

s = replace_once(
    s,
    """  const DETAILED_PATH = /(?:\\/api\\/|edititems|fcskuflip|moveitems|move-container|close-container|scan-source-container|scanitem|sideline|dropzone|print)/i;
  const NOISE_HOST = /(?:^|\\.)(?:data\\.pendo\\.aft\\.amazon\\.dev|api\\.pendo\\.aft\\.amazon\\.dev)$/i;""",
    """  const DETAILED_PATH = /(?:\\/api\\/|edititems|fcskuflip|moveitems|move-container|close-container|scan-source-container|scanitem|sideline|dropzone|print)/i;
  const AFT_QT_HOST = /^aft-qt-[^.]+(?:\\.aka\\.[^.]+)?\\.corp\\.amazon\\.com$/i;
  const AFT_MOVE_PROBE_MAX = 250;
  const NOISE_HOST = /(?:^|\\.)(?:data\\.pendo\\.aft\\.amazon\\.dev|api\\.pendo\\.aft\\.amazon\\.dev)$/i;""",
    "probe constants"
)

s = replace_once(
    s,
    """  let coreSuccessTimer = 0;
  let coreSuccessStats = new Map();
  let lastRejection = null;""",
    """  let coreSuccessTimer = 0;
  let coreSuccessStats = new Map();
  let aftMoveProbeAction = 0;
  let aftMoveProbeStatus = '';
  let aftMoveProbeCount = 0;
  let lastRejection = null;""",
    "probe state"
)

s = replace_once(
    s,
    """    coreSuccessStats = new Map();
    gmSet(pageCountKey, 0);""",
    """    coreSuccessStats = new Map();
    aftMoveProbeAction = 0;
    aftMoveProbeStatus = '';
    aftMoveProbeCount = 0;
    gmSet(pageCountKey, 0);""",
    "session sync reset"
)

s = replace_once(
    s,
    """  function isDetailedApi(rawUrl) {
    const url = parsedUrl(rawUrl);
    if (SIM_HOST.test(location.hostname)) return false;
    if (url && FCR_HOST.test(url.hostname)) return false;
    const isStatic = !!url && /\\.(?:css|gif|ico|jpe?g|js|map|png|svg|webp|woff2?)(?:$|[?#])/i.test(url.pathname);
    if (RIVER_HOST.test(location.hostname) && url && !isStatic) return true;
    if (CARTON_HOST.test(location.hostname) && url?.origin === location.origin && !isStatic) return true;
    if (url) return DETAILED_PATH.test(url.pathname);
    return DETAILED_PATH.test(String(rawUrl || ''));
  }

""",
    """  function isDetailedApi(rawUrl) {
    const url = parsedUrl(rawUrl);
    if (SIM_HOST.test(location.hostname)) return false;
    if (url && FCR_HOST.test(url.hostname)) return false;
    const isStatic = !!url && /\\.(?:css|gif|ico|jpe?g|js|map|png|svg|webp|woff2?)(?:$|[?#])/i.test(url.pathname);
    if (RIVER_HOST.test(location.hostname) && url && !isStatic) return true;
    if (CARTON_HOST.test(location.hostname) && url?.origin === location.origin && !isStatic) return true;
    if (url) return DETAILED_PATH.test(url.pathname);
    return DETAILED_PATH.test(String(rawUrl || ''));
  }

  function isAftMoveProbe(rawUrl) {
    if (!AFT_QT_HOST.test(location.hostname) || !/^\\/app\\/moveitems\\/?$/i.test(location.pathname)) return false;
    const url = parsedUrl(rawUrl);
    return !!url && url.origin === location.origin &&
      (/^\\/(?:action|status|end)\\/?$/i.test(url.pathname) || /^\\/app\\/moveitems\\/?$/i.test(url.pathname));
  }

""",
    "move probe scope"
)

s = replace_once(
    s,
    """  function summarizeFcrResponse(text, contentType = '') {
""",
    r"""  function aftMoveProbeSummary(text, contentType = '') {
    const raw = String(text ?? '');
    const out = {
      chars: raw.length,
      kind: raw ? (/json/i.test(contentType) || /^\s*[\[{]/.test(raw) ? 'json' : /<\/?(?:html|body|form|main|div|section)\b/i.test(raw) ? 'html' : 'text') : 'empty'
    };

    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        out.keys = Object.keys(parsed).slice(0, 40);
        if (typeof parsed.status === 'string') out.status = cleanText(parsed.status).slice(0, 40);
      }
    } catch {}

    const found = new Set();
    const patterns = [
      /(?:["']|&quot;)[A-Za-z0-9_.-]*(?:quantity|qty|count|units|available|remaining|max|min)[A-Za-z0-9_.-]*(?:["']|&quot;)\s*[:=]\s*(?:["']|&quot;)?([0-9]{1,7})\b/gi,
      /\bQuantity\b(?:<[^>]+>|\s|&nbsp;|&#160;|:|-){0,20}([0-9]{1,7})\b/gi
    ];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(raw)) && found.size < 20) found.add(Number(match[1]));
    }
    if (found.size) out.quantityNumbers = [...found];
    return out;
  }

  function summarizeAftMoveRequest(body) {
    const out = summarizeRequestShape(body);
    try {
      const parsed = typeof body === 'string' ? JSON.parse(body) : body;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        if (typeof parsed.action === 'string') out.action = cleanText(parsed.action).slice(0, 40);
        if (typeof parsed.id?.instructionId === 'string') out.instructionId = cleanText(parsed.id.instructionId).slice(0, 40);
        if (Object.prototype.hasOwnProperty.call(parsed, 'input')) {
          const input = String(parsed.input ?? '');
          out.inputKind = classifySearchValue(input);
          out.inputLength = input.length;
          if (/^\d{1,7}$/.test(input.trim())) out.inputNumber = Number(input.trim());
        }
      }
    } catch {}
    return out;
  }

  function recordAftMoveProbe(base, rawUrl, body, responseText = '', contentType = '') {
    if (aftMoveProbeCount >= AFT_MOVE_PROBE_MAX) return;
    const path = parsedUrl(rawUrl)?.pathname || '';
    const response = aftMoveProbeSummary(responseText, contentType);

    if (/^\/action\/?$/i.test(path)) {
      aftMoveProbeAction++;
      aftMoveProbeStatus = '';
    }

    if (/^\/status\/?$/i.test(path)) {
      const signature = `${aftMoveProbeAction}|${response.status || ''}|${JSON.stringify(response.quantityNumbers || [])}`;
      if (signature === aftMoveProbeStatus) return;
      aftMoveProbeStatus = signature;
    }

    aftMoveProbeCount++;
    add('aft.move.probe', {
      ...base,
      path,
      actionSeq: aftMoveProbeAction,
      request: summarizeAftMoveRequest(body),
      response
    });
  }

  function summarizeFcrResponse(text, contentType = '') {
""",
    "move probe parser"
)

s = replace_once(
    s,
    """    coreSuccessStats = new Map();
    renderUi(true);""",
    """    coreSuccessStats = new Map();
    aftMoveProbeAction = 0;
    aftMoveProbeStatus = '';
    aftMoveProbeCount = 0;
    renderUi(true);""",
    "manual reset"
)

s = replace_once(
    s,
    """        const fcr = !noise && isFcrNetwork(rawUrl);
        const detailed = !noise && !fcr && isDetailedApi(rawUrl);""",
    """        const fcr = !noise && isFcrNetwork(rawUrl);
        const aftMoveProbe = !noise && !fcr && isAftMoveProbe(rawUrl);
        const detailed = !noise && !fcr && !aftMoveProbe && isDetailedApi(rawUrl);""",
    "fetch probe route"
)

s = replace_once(
    s,
    """          if (fcr) {
            void response.clone().text()
              .then(text => recordFcrNetwork(base, rawUrl, init?.body, text, response.headers.get('content-type') || ''))
              .catch(() => recordFcrNetwork(base, rawUrl, init?.body));
          } else if (detailed) {""",
    """          if (fcr) {
            void response.clone().text()
              .then(text => recordFcrNetwork(base, rawUrl, init?.body, text, response.headers.get('content-type') || ''))
              .catch(() => recordFcrNetwork(base, rawUrl, init?.body));
          } else if (aftMoveProbe) {
            void response.clone().text()
              .then(text => recordAftMoveProbe(base, rawUrl, init?.body, text, response.headers.get('content-type') || ''))
              .catch(error => add('aft.move.probe', {
                ...base,
                path: parsedUrl(rawUrl)?.pathname || '',
                actionSeq: aftMoveProbeAction,
                request: summarizeAftMoveRequest(init?.body),
                responseReadError: scrubText(error?.message || error)
              }));
          } else if (detailed) {""",
    "fetch probe capture"
)

s = replace_once(
    s,
    """              request: aborted ? null : (detailed ? summarizeRequestShape(init?.body) : null),""",
    """              request: aborted ? null : (aftMoveProbe ? summarizeAftMoveRequest(init?.body) : (detailed ? summarizeRequestShape(init?.body) : null)),""",
    "fetch error request"
)

s = replace_once(
    s,
    """        const fcr = isFcrNetwork(info.url);
        const detailed = !fcr && isDetailedApi(info.url);""",
    """        const fcr = isFcrNetwork(info.url);
        const aftMoveProbe = !fcr && isAftMoveProbe(info.url);
        const detailed = !fcr && !aftMoveProbe && isDetailedApi(info.url);""",
    "xhr probe route"
)

s = replace_once(
    s,
    """          } else if (cancelled) {
            add('network.cancelled', { ...base, reason: 'status-0' });
          } else if (detailed) {""",
    """          } else if (cancelled) {
            add('network.cancelled', { ...base, reason: 'status-0' });
          } else if (aftMoveProbe) {
            let text = '';
            let contentType = '';
            try {
              if (!this.responseType || this.responseType === 'text') text = this.responseText || '';
              contentType = this.getResponseHeader('content-type') || '';
            } catch {}
            recordAftMoveProbe(base, info.url, body, text, contentType);
          } else if (detailed) {""",
    "xhr probe capture"
)

p.write_text(s, encoding="utf-8")

r = Path("README.md")
readme = r.read_text(encoding="utf-8")
readme = replace_once(
    readme,
    "| BWU2 Observability Core | 0.1.13 |",
    "| BWU2 Observability Core | 0.1.14 |",
    "README observability version"
)
r.write_text(readme, encoding="utf-8")
