from pathlib import Path

p = Path('Sideline_API_Move.user.js')
s = p.read_text(encoding='utf-8')

old = r'''  function isOverageLabel(value) {
    return /\boverage(?:s)?\b/i.test(clean(value));
  }
'''
new = r'''  function isOverageLabel(value) {
    return /\boverage(?:s)?\b|\bitem\s+not\s+in\s+(?:source\s+)?container\b|\bnot\s+in\s+source\s+container\b/i.test(clean(value));
  }

  function isBenignOverageCompanion(value) {
    const label = clean(value);
    return !label || isOverageLabel(label) || /^(?:bad request|conflict|request failed|http\s*[45]\d\d|[45]\d\d)$/i.test(label);
  }
'''
if s.count(old) != 1:
    raise SystemExit(f'overage label patch expected once, found {s.count(old)}')
s = s.replace(old, new, 1)

old = r'''    const explicitLabels = [
      type,
      response?.message,
      response?.description,
      response?.reason,
      response?.errorMessage,
      response?.errorCode,
      filterReason,
      ...problems
    ].map(clean).filter(Boolean);

    const itemNotInSource = type === 'ItemNotInContainerResponse';
    const explicitOverage = explicitLabels.some(isOverageLabel);
    if (!itemNotInSource && !explicitOverage) return false;

    const fatalText = explicitLabels.join(' ');
    if (/hazmat|dangerous.?goods|invalid\s+barcode|incompatib|damaged|predicant|customer\s*bound/i.test(fatalText)) {
      return false;
    }

    return true;
'''
new = r'''    const diagnosticLabels = [
      response?.message,
      response?.description,
      response?.errorMessage,
      response?.errorCode,
      filterReason,
      ...problems
    ].map(clean).filter(Boolean);

    const itemNotInSource = type === 'ItemNotInContainerResponse';
    const explicitOverage = itemNotInSource || isOverageLabel(type) || diagnosticLabels.some(isOverageLabel);
    if (!explicitOverage) return false;

    // Overage is the ONLY exception. A response that also carries another
    // substantive problem stays fail-closed even if the word Overage appears.
    if (diagnosticLabels.some(label => !isBenignOverageCompanion(label))) return false;

    const fatalText = [type, ...diagnosticLabels].join(' ');
    if (/hazmat|dangerous.?goods|invalid\s+barcode|incompatib|damaged|predicant|customer\s*bound/i.test(fatalText)) {
      return false;
    }

    return true;
'''
if s.count(old) != 1:
    raise SystemExit(f'overage gate patch expected once, found {s.count(old)}')
s = s.replace(old, new, 1)

p.write_text(s, encoding='utf-8')
