from pathlib import Path

path = Path('Sideline_API_Move.user.js')
text = path.read_text(encoding='utf-8')

def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    text = text.replace(old, new, 1)

replace_once('// @name         MAIN v0.3.2 Sideline API Move TEST', '// @name         MAIN v0.3.3 Sideline API Move TEST', 'name version')
replace_once('// @version      0.3.2', '// @version      0.3.3', 'metadata version')
replace_once("const VERSION = '0.3.2';", "const VERSION = '0.3.3';", 'runtime version')

replace_once(
'''    item.ctx = ctx;
    item.preflightIssue = null;

    if (ctx.dateType === 'EXPIRATION_DATE' || ctx.dateType === 'PRODUCTION_DATE') {
''',
'''    item.ctx = ctx;
    item.preflightIssue = null;

    // Live lookups run ahead of processing. Hazmat must be rejected here before an
    // item can ever be labelled READY and take the fast prechecked move path.
    if (hasHazmat(result.response)) {
      item.preflightStatus = 'ISSUE';
      item.preflightIssue = { kind:'hazmat', title:'HAZMAT — ITEM NOT MOVED', reason:'HAZMAT' };

      if (!autoSkipQueuedLiveItem(item, 'HAZMAT — ITEM NOT MOVED', 'HAZMAT')) {
        renderLive();
      }
      return;
    }

    if (ctx.dateType === 'EXPIRATION_DATE' || ctx.dateType === 'PRODUCTION_DATE') {
''',
'Live preflight Hazmat gate',
)

path.write_text(text, encoding='utf-8')

readme = Path('README.md')
readme_text = readme.read_text(encoding='utf-8')
old = '| Sideline API Move | 0.3.2 |'
new = '| Sideline API Move | 0.3.3 |'
if readme_text.count(old) != 1:
    raise SystemExit(f'README version row expected once, found {readme_text.count(old)}')
readme.write_text(readme_text.replace(old, new, 1), encoding='utf-8')

final = path.read_text(encoding='utf-8')
for needle in [
    "const VERSION = '0.3.3';",
    "if (hasHazmat(result.response)) {",
    "autoSkipQueuedLiveItem(item, 'HAZMAT — ITEM NOT MOVED', 'HAZMAT')",
    "showOneByOneError(item, 'HAZMAT', 'HAZMAT — ITEM NOT MOVED');",
]:
    if needle not in final:
        raise SystemExit(f'missing required invariant: {needle}')
