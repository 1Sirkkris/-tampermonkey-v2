from pathlib import Path

path = Path('Sideline_API_Move.user.js')
text = path.read_text(encoding='utf-8')

def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    text = text.replace(old, new, 1)

replace_once('// @name         MAIN v0.3.1 Sideline API Move TEST', '// @name         MAIN v0.3.2 Sideline API Move TEST', 'name version')
replace_once('// @version      0.3.1', '// @version      0.3.2', 'metadata version')
replace_once("const VERSION = '0.3.1';", "const VERSION = '0.3.2';", 'runtime version')

replace_once(
'''  function hasHazmat(value) {
    if (value == null) return false;
    if (typeof value === 'string') return /(^|[^a-z])hazmat([^a-z]|$)/i.test(value);
    if (Array.isArray(value)) return value.some(hasHazmat);
    if (typeof value !== 'object') return false;
    return Object.entries(value).some(([key, nested]) =>
      /(^|[^a-z])hazmat([^a-z]|$)/i.test(key) || hasHazmat(nested)
    );
  }
''',
'''  function hasHazmat(value) {
    const seen = new Set();
    const hazardKey = key => /hazmat|dangerous.?goods/i.test(clean(key));
    const negative = /^(?:false|no|none|null|unknown|not[_ -]?hazmat|non[_ -]?hazmat|not[_ -]?dangerous(?:[_ -]?goods)?|non[_ -]?dangerous(?:[_ -]?goods)?)$/i;

    const walk = (node, key='') => {
      if (node == null) return false;

      if (typeof node === 'boolean') return hazardKey(key) && node === true;
      if (typeof node === 'number') return hazardKey(key) && node > 0;

      if (typeof node === 'string') {
        const valueText = clean(node);
        if (!valueText || negative.test(valueText)) return false;
        if (/\\bHAZMAT\\b/i.test(valueText) && !/\\b(?:NOT|NON)[ _-]?HAZMAT\\b/i.test(valueText)) return true;
        if (/\\bDANGEROUS[ _-]?GOODS\\b/i.test(valueText) && !/\\b(?:NOT|NON)[ _-]?DANGEROUS[ _-]?GOODS\\b/i.test(valueText)) return true;
        return hazardKey(key);
      }

      if (typeof node !== 'object') return false;
      if (seen.has(node)) return false;
      seen.add(node);

      if (Array.isArray(node)) return node.some(child => walk(child, key));
      return Object.entries(node).some(([childKey, child]) => walk(child, childKey));
    };

    return walk(value);
  }
''',
'hazmat evidence parser',
)

replace_once(
'''    if (moveOk(response)) {
      finishOneByOneMoved(item);
      return;
    }

    const reason = moveReason(response);
    if (live.issue?.kind === 'destination' && live.current !== item) {
      showOneByOneError(item, 'DESTINATION BLOCKED — RESCAN AFTER FIX');
      return;
    }

    if (isDamagedDestinationResponse(response)) {
      blockOneByOneDestination(item, 'DESTINATION BLOCKED', 'DESTINATION DAMAGED', ctx, expirationMs);
      return;
    }

    if (reason === 'HAZMAT' || /destination incompatible/i.test(reason)) {
      showOneByOneError(item, reason || 'HAZMAT', reason === 'HAZMAT' ? 'HAZMAT — ITEM NOT MOVED' : 'ITEM / DESTINATION INCOMPATIBLE');
      return;
    }

    if (hasPredicant(response)) {
      blockOneByOneDestination(item, 'DESTINATION NEEDS ATTENTION', 'PREDICANT — USE/RESET A DIFFERENT DESTINATION', ctx, expirationMs);
      return;
    }

    showOneByOneError(item, reason || 'MOVE REJECTED', 'MOVE REJECTED');
''',
'''    const reason = moveReason(response);
    if (live.issue?.kind === 'destination' && live.current !== item) {
      showOneByOneError(item, 'DESTINATION BLOCKED — RESCAN AFTER FIX');
      return;
    }

    if (isDamagedDestinationResponse(response)) {
      blockOneByOneDestination(item, 'DESTINATION BLOCKED', 'DESTINATION DAMAGED', ctx, expirationMs);
      return;
    }

    if (reason === 'HAZMAT' || hasHazmat(response) || /destination incompatible/i.test(reason)) {
      showOneByOneError(
        item,
        reason === 'HAZMAT' || hasHazmat(response) ? 'HAZMAT' : (reason || 'DESTINATION INCOMPATIBLE'),
        reason === 'HAZMAT' || hasHazmat(response) ? 'HAZMAT — ITEM NOT MOVED' : 'ITEM / DESTINATION INCOMPATIBLE'
      );
      return;
    }

    if (hasPredicant(response)) {
      blockOneByOneDestination(item, 'DESTINATION NEEDS ATTENTION', 'PREDICANT — USE/RESET A DIFFERENT DESTINATION', ctx, expirationMs);
      return;
    }

    if (moveOk(response)) {
      finishOneByOneMoved(item);
      return;
    }

    showOneByOneError(item, reason || 'MOVE REJECTED', 'MOVE REJECTED');
''',
'1x1 move-response failure ordering',
)

replace_once(
'''    item.ctx = ctx;
    if (ctx.dateType === 'EXPIRATION_DATE' || ctx.dateType === 'PRODUCTION_DATE') {
      live.oneInFlight.delete(item.id);
      parkLiveDateItem(item, ctx);
      return;
    }

    await moveOneByOneResolved(item, ctx, null, run);
''',
'''    item.ctx = ctx;

    // Fail closed before any state-changing move request when scan metadata already
    // identifies the item as Hazmat / dangerous goods.
    if (hasHazmat(response)) {
      showOneByOneError(item, 'HAZMAT', 'HAZMAT — ITEM NOT MOVED');
      return;
    }

    if (ctx.dateType === 'EXPIRATION_DATE' || ctx.dateType === 'PRODUCTION_DATE') {
      live.oneInFlight.delete(item.id);
      parkLiveDateItem(item, ctx);
      return;
    }

    await moveOneByOneResolved(item, ctx, null, run);
''',
'1x1 pre-move hazmat gate',
)

replace_once(
'''    item.ctx = ctx;

    if (ctx.dateType === 'EXPIRATION_DATE' || ctx.dateType === 'PRODUCTION_DATE') {
      parkLiveDateItem(item, ctx);
      return;
    }

    await liveMoveCurrent(item, ctx, null);
''',
'''    item.ctx = ctx;

    // Normal Live also fails closed before /api/move-items when scan metadata says
    // Hazmat. The failed barcode is surfaced while the rest of Live can continue.
    if (hasHazmat(response)) {
      failLiveItem(item, 'HAZMAT — ITEM NOT MOVED', 'HAZMAT', ctx);
      return;
    }

    if (ctx.dateType === 'EXPIRATION_DATE' || ctx.dateType === 'PRODUCTION_DATE') {
      parkLiveDateItem(item, ctx);
      return;
    }

    await liveMoveCurrent(item, ctx, null);
''',
'Live pre-move hazmat gate',
)

replace_once(
'''    if (moveOk(response)) {
      finishLiveMoved(item);
      return true;
    }

    const reason = moveReason(response);

    if (isDamagedDestinationResponse(response)) {
      blockLiveDestination(item, 'DESTINATION BLOCKED', 'DESTINATION DAMAGED', ctx, expirationMs);
      return false;
    }

    if (reason === 'HAZMAT' || /destination incompatible/i.test(reason)) {
      failLiveItem(
        item,
        reason === 'HAZMAT' ? 'HAZMAT — ITEM NOT MOVED' : 'ITEM / DESTINATION INCOMPATIBLE',
        reason || 'DESTINATION INCOMPATIBLE',
        ctx
      );
      return false;
    }

    if (hasPredicant(response)) {
      blockLiveDestination(item, 'DESTINATION NEEDS ATTENTION', 'PREDICANT — USE/RESET A DIFFERENT DESTINATION', ctx, expirationMs);
      return false;
    }

    failLiveItem(item, 'MOVE REJECTED — ITEM NOT MOVED', reason || 'MOVE REJECTED', ctx);
''',
'''    const reason = moveReason(response);

    if (isDamagedDestinationResponse(response)) {
      blockLiveDestination(item, 'DESTINATION BLOCKED', 'DESTINATION DAMAGED', ctx, expirationMs);
      return false;
    }

    if (reason === 'HAZMAT' || hasHazmat(response) || /destination incompatible/i.test(reason)) {
      failLiveItem(
        item,
        reason === 'HAZMAT' || hasHazmat(response) ? 'HAZMAT — ITEM NOT MOVED' : 'ITEM / DESTINATION INCOMPATIBLE',
        reason === 'HAZMAT' || hasHazmat(response) ? 'HAZMAT' : (reason || 'DESTINATION INCOMPATIBLE'),
        ctx
      );
      return false;
    }

    if (hasPredicant(response)) {
      blockLiveDestination(item, 'DESTINATION NEEDS ATTENTION', 'PREDICANT — USE/RESET A DIFFERENT DESTINATION', ctx, expirationMs);
      return false;
    }

    if (moveOk(response)) {
      finishLiveMoved(item);
      return true;
    }

    failLiveItem(item, 'MOVE REJECTED — ITEM NOT MOVED', reason || 'MOVE REJECTED', ctx);
''',
'Live move-response failure ordering',
)

path.write_text(text, encoding='utf-8')

readme = Path('README.md')
readme_text = readme.read_text(encoding='utf-8')
old = '| Sideline API Move | 0.3.1 |'
new = '| Sideline API Move | 0.3.2 |'
if readme_text.count(old) != 1:
    raise SystemExit(f'README version row expected once, found {readme_text.count(old)}')
readme.write_text(readme_text.replace(old, new, 1), encoding='utf-8')

final = path.read_text(encoding='utf-8')
required = [
    "const VERSION = '0.3.2';",
    "showOneByOneError(item, 'HAZMAT', 'HAZMAT — ITEM NOT MOVED');",
    "failLiveItem(item, 'HAZMAT — ITEM NOT MOVED', 'HAZMAT', ctx);",
    'if (hasHazmat(response)) return false;',
]
for needle in required:
    if needle not in final:
        raise SystemExit(f'missing required invariant: {needle}')
