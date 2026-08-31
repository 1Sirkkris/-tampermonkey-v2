from pathlib import Path

path = Path('Sideline_API_Move.user.js')
text = path.read_text(encoding='utf-8')

def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    text = text.replace(old, new, 1)

replace_once('// @name         MAIN v0.3.0 Sideline API Move TEST', '// @name         MAIN v0.3.1 Sideline API Move TEST', 'name version')
replace_once('// @version      0.3.0', '// @version      0.3.1', 'metadata version')
replace_once("const VERSION = '0.3.0';", "const VERSION = '0.3.1';", 'runtime version')

replace_once(
'''  function moveOk(response) {
    if (!response || response.success !== true) return false;
    if (response.filterResult?.compatible === false) return false;

    if (hasPredicant(response)) return false;

    return true;
  }
''',
'''  function hasHazmat(value) {
    if (value == null) return false;
    if (typeof value === 'string') return /(^|[^a-z])hazmat([^a-z]|$)/i.test(value);
    if (Array.isArray(value)) return value.some(hasHazmat);
    if (typeof value !== 'object') return false;
    return Object.entries(value).some(([key, nested]) =>
      /(^|[^a-z])hazmat([^a-z]|$)/i.test(key) || hasHazmat(nested)
    );
  }

  function hasMoveProblems(response) {
    return Array.isArray(response?.problems) && response.problems.some(Boolean);
  }

  function moveOk(response) {
    if (!response || response.success !== true) return false;
    if (response.filterResult?.compatible === false) return false;
    if (hasHazmat(response)) return false;
    if (hasMoveProblems(response)) return false;
    if (hasPredicant(response)) return false;

    return true;
  }
''',
'moveOk fail-closed gate',
)

replace_once(
'''  function moveReason(response) {
    if (!response) return 'EMPTY MOVE RESPONSE';

    const reason = response.filterResult?.reason;
''',
'''  function moveReason(response) {
    if (!response) return 'EMPTY MOVE RESPONSE';
    if (hasHazmat(response)) return 'HAZMAT';

    const reason = response.filterResult?.reason;
''',
'moveReason hazmat priority',
)

replace_once(
'''    } catch (error) {
      if (error?.name === 'AbortError') return;
      showOneByOneError(item, error?.message || 'MOVE API ERROR');
      return;
    }
''',
'''    } catch (error) {
      if (error?.name === 'AbortError') return;
      const payloadReason = moveReason(error?.payload);
      const reason = payloadReason !== 'EMPTY MOVE RESPONSE'
        ? payloadReason
        : (error?.message || 'MOVE API ERROR');
      showOneByOneError(
        item,
        reason,
        hasHazmat(error?.payload) ? 'HAZMAT — ITEM NOT MOVED' : 'MOVE API ERROR'
      );
      return;
    }
''',
'1x1 HTTP move failure',
)

replace_once(
"""      failLiveItem(item, 'MOVE API ERROR — ITEM NOT MOVED', error?.message || 'MOVE API ERROR', ctx);
      return false;
""",
"""      const payloadReason = moveReason(error?.payload);
      const reason = payloadReason !== 'EMPTY MOVE RESPONSE'
        ? payloadReason
        : (error?.message || 'MOVE API ERROR');
      failLiveItem(
        item,
        hasHazmat(error?.payload) ? 'HAZMAT — ITEM NOT MOVED' : 'MOVE API ERROR — ITEM NOT MOVED',
        reason,
        ctx
      );
      return false;
""",
'Live HTTP move failure',
)

path.write_text(text, encoding='utf-8')

readme = Path('README.md')
readme_text = readme.read_text(encoding='utf-8')
old = '| Sideline API Move | 0.3.0 |'
new = '| Sideline API Move | 0.3.1 |'
if readme_text.count(old) != 1:
    raise SystemExit('README Sideline version row did not match 0.3.0 exactly once')
readme.write_text(readme_text.replace(old, new, 1), encoding='utf-8')

final = path.read_text(encoding='utf-8')
required = [
    "const VERSION = '0.3.1';",
    'if (hasHazmat(response)) return false;',
    'if (hasMoveProblems(response)) return false;',
    "if (hasHazmat(response)) return 'HAZMAT';",
    "hasHazmat(error?.payload) ? 'HAZMAT — ITEM NOT MOVED'",
]
for needle in required:
    if needle not in final:
        raise SystemExit(f'missing required invariant: {needle}')
