from pathlib import Path
import re

ROWS = '''
AFT_Edit_SKU_Move.user.js|0.9.19|0.9.20|MAIN AFT Edit/SKU/Move master|AFT|VERSION|MAIN v0.9.17 AFT Edit/SKU/Move master
Sideline_API_Move.user.js|0.3.16|0.3.17|MAIN Sideline API Move TEST|SIDELINE|VERSION|MAIN v0.3.16 Sideline API Move TEST
FNSKU_Mapping_Lookup.user.js|1.4.0-test|1.4.1-test|MAIN FNSKU mapping Lookup|FNSKU|VERSION|MAIN v1.4.0-test FNSKU mapping Lookup
FC_Lite.user.js|0.1.65|0.1.66|TEST FC-Lite — Accessible MADCAT Green|FC-LITE|VERSION|TEST v0.1.65 FC-Lite — Accessible MADCAT Green
FCR_Data_Core.user.js|0.2.18|0.2.19|TEST FCR Data Core — MADCAT Auto Auth|FCR CORE|VERSION|TEST v0.2.18 FCR Data Core — MADCAT Auto Auth
FCResearch_Master.user.js|0.1.27|0.1.28|TEST FCResearch Master — Accessible MADCAT Green|FCR MASTER|VERSION|TEST v0.1.27 FCResearch Master — Accessible MADCAT Green
FCResearch_RIVER_Ticket_Assistant.user.js|0.3.11|0.3.12|TEST FCResearch → RIVER Ticket Assistant|RIVER|VERSION|TEST FCResearch → RIVER Ticket Assistant v0.3.9
Diagnostics/Amazon_ASIN_Variation_Finder_TEST.user.js|0.1.1|0.1.2|TEST Amazon AU ASIN Variation Finder|ASIN FINDER|VERSION|TEST v0.1.1 Amazon AU ASIN Variation Finder
Calm_Code.user.js|1.3.1|1.3.2|MAIN Calm Code|CALM|CALM_VERSION|MAIN v1.3.1 Calm Code
Unbind_Hierarchy_Queue.user.js|1.0.3|1.0.4|Unbind Hierarchy Queue|UNBIND|VERSION|Unbind Hierarchy Queue v1.0.1
BWU2_Observability_Core.user.js|0.1.11|0.1.12|CORE BWU2 Observability Core|OBS|VERSION|CORE v0.1.11 BWU2 Observability Core
Dropzone_Selector_Queue.user.js|0.2.18|0.2.19|TEST Dropzone Selector Queue|DROPZONE|VERSION|TEST v0.2.18 Dropzone Selector Queue
Bin_Check_Overlay.user.js|7.4.3|7.4.4|TEST Bin check Overlay — Filter Snapshot|BIN|VERSION|TEST v7.4.3 Bin check Overlay — Filter Snapshot
Stow_Andons_Helper.user.js|5.5.1|5.5.2|TEST Stow Andons Helper — FCSKU Conflict Alert|STOW|VERSION|TEST v5.5.1 Stow Andons Helper — FCSKU Conflict Alert
SIM_Markdown_Toolbar.user.js|5.1.5|5.1.6|MAIN SIM Markdown Toolbar|SIM|VERSION|MAIN v5.1.5 SIM Markdown Toolbar
Carton_PrEditor.user.js|7.3|7.4|MAIN Carton PrEditor|CARTON|VERSION|MAIN v7.3 Carton PrEditor
'''
TARGETS = [tuple(x.strip() for x in line.split('|', 6)) for line in ROWS.strip().splitlines()]

STAMP = '''
  function registerRuntimeVersion(label, version) {{
    const mount = () => {{
      const root = document.body || document.documentElement;
      if (!root) return;
      let host = document.getElementById('bwu2-runtime-version-stamp');
      if (!host) {{
        host = document.createElement('div');
        host.id = 'bwu2-runtime-version-stamp';
        host.setAttribute('aria-hidden', 'true');
        host.style.cssText = 'position:fixed;left:50%;bottom:2px;transform:translateX(-50%);z-index:2147483000;display:flex;flex-wrap:wrap;justify-content:center;gap:2px 10px;max-width:94vw;padding:2px 7px;border-radius:6px 6px 0 0;background:rgba(255,255,255,.34);color:rgba(15,23,42,.52);box-shadow:0 0 0 1px rgba(15,23,42,.05);backdrop-filter:blur(1.5px);font:800 11px/1.25 Arial,sans-serif;letter-spacing:.2px;pointer-events:none;user-select:none;text-shadow:0 1px 1px rgba(255,255,255,.95),0 0 3px rgba(255,255,255,.75)';
        root.appendChild(host);
      }}
      let item = Array.from(host.children).find(node => node.dataset?.bwu2RuntimeKey === label);
      if (!item) {{ item = document.createElement('span'); item.dataset.bwu2RuntimeKey = label; host.appendChild(item); }}
      item.textContent = `${{label}} · v${{version}}`;
      Array.from(host.children).sort((a,b) => String(a.dataset?.bwu2RuntimeKey || '').localeCompare(String(b.dataset?.bwu2RuntimeKey || ''))).forEach(node => host.appendChild(node));
    }};
    mount();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {{ once:true }});
  }}
  registerRuntimeVersion('{label}', {var});
'''

def one(s, old, new, label):
    n = s.count(old)
    if n != 1: raise SystemExit(f'{label}: expected 1 match, got {n}')
    return s.replace(old, new, 1)

def set_name_en(s, visible):
    line = f'// @name:en      {visible}'
    if re.search(r'(?m)^// @name:en\s+.*$', s):
        return re.sub(r'(?m)^// @name:en\s+.*$', lambda _: line, s, count=1)
    m = re.search(r'(?m)^// @name\s+.*$', s)
    if not m: raise SystemExit('base @name missing')
    return s[:m.end()] + '\n' + line + s[m.end():]

for path, old, new, visible, label, var, base in TARGETS:
    p = Path(path); s = p.read_text()
    if not re.search(rf'(?m)^// @name\s+{re.escape(base)}$', s): raise SystemExit(f'{path}: frozen base @name mismatch')
    s = set_name_en(s, visible)
    s, n = re.subn(rf'(?m)^// @version\s+{re.escape(old)}$', f'// @version      {new}', s, count=1)
    if n != 1: raise SystemExit(f'{path}: @version {old} missing')
    old1, old2 = f"const {var} = '{old}';", f'const {var} = "{old}";'
    new1, new2 = f"const {var} = '{new}';", f'const {var} = "{new}";'
    if path == 'Stow_Andons_Helper.user.js':
        anchor = '  window.__stowAndonsCore548test = true;\n'; marker = '  ' + new1
        if anchor not in s: raise SystemExit(f'{path}: VERSION anchor missing')
        s = one(s, anchor, anchor + '\n' + marker + '\n', f'{path} VERSION insert')
    elif old1 in s:
        s = one(s, old1, new1, f'{path} internal version'); marker = new1
    elif old2 in s:
        s = one(s, old2, new2, f'{path} internal version'); marker = new2
    else: raise SystemExit(f'{path}: internal {var} {old} missing')
    if 'function registerRuntimeVersion(' in s: raise SystemExit(f'{path}: runtime stamp already present')
    s = one(s, marker, marker + STAMP.format(label=label, var=var), f'{path} runtime stamp')
    raw = f'https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/{path}'
    if f'// @updateURL    {raw}' not in s or f'// @downloadURL  {raw}' not in s: raise SystemExit(f'{path}: updater URL mismatch')
    p.write_text(s)

for path, old, new, visible, label, var, base in TARGETS:
    s = Path(path).read_text()
    assert re.search(rf'(?m)^// @name\s+{re.escape(base)}$', s)
    assert re.search(rf'(?m)^// @name:en\s+{re.escape(visible)}$', s)
    assert not re.search(r'(?m)^// @name:en.*\bv?\d+\.\d+', s)
    assert re.search(rf'(?m)^// @version\s+{re.escape(new)}$', s)
    assert f"const {var} = '{new}';" in s or f'const {var} = "{new}";' in s
    assert f"registerRuntimeVersion('{label}', {var});" in s

print(f'Patched and validated {len(TARGETS)} active scripts')
