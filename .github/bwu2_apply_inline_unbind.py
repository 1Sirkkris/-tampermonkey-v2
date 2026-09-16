from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


p = Path("Stow_Andons_Helper.user.js")
s = p.read_text(encoding="utf-8")

s = replace_once(s, "// @version      5.5.4", "// @version      5.5.5", "metadata version")
s = replace_once(s, "const VERSION = '5.5.4';", "const VERSION = '5.5.5';", "runtime version")
s = replace_once(
    s,
    "// @connect      aft-moveapp-nrt-nrt.nrt.proxy.amazon.com\n// @connect      localhost",
    "// @connect      aft-moveapp-nrt-nrt.nrt.proxy.amazon.com\n// @connect      tx-b-hierarchy-nrt.nrt.proxy.amazon.com\n// @connect      localhost",
    "unbind connect"
)
s = replace_once(
    s,
    "  const MOVE_URL = 'https://aft-moveapp-nrt-nrt.nrt.proxy.amazon.com/api/move-container';\n",
    """  const MOVE_URL = 'https://aft-moveapp-nrt-nrt.nrt.proxy.amazon.com/api/move-container';
  const UNBIND_BASE = 'https://tx-b-hierarchy-nrt.nrt.proxy.amazon.com';
  const UNBIND_VALIDATE_URL = `${UNBIND_BASE}/validateContainer`;
  const UNBIND_SUMMARY_URL = `${UNBIND_BASE}/getTransshipmentBindingSummary`;
  const UNBIND_URL = `${UNBIND_BASE}/unbindContainer`;
  const UNBIND_LOGIN_KEY = 'vm_fc_unbind_login_v1';
""",
    "unbind constants"
)
s = replace_once(
    s,
    "  const moveButtonFeedback = new WeakMap();\n",
    "  const moveButtonFeedback = new WeakMap();\n  let unbindBusy = false;\n",
    "unbind busy state"
)

marker = "  function renderDropButtons() {\n"
unbind_helpers = r'''  function normalizeUnbindLogin(value) {
    const login = clean(value).toLowerCase();
    return /^[a-z][a-z0-9-]{2,31}$/i.test(login) ? login : '';
  }

  function unbindLogin() {
    try {
      const saved = normalizeUnbindLogin(localStorage.getItem(UNBIND_LOGIN_KEY));
      if (saved) return saved;
    } catch {}

    for (const rawPart of document.cookie.split(';')) {
      const part = rawPart.trim();
      const split = part.indexOf('=');
      if (split < 1) continue;
      const name = part.slice(0, split).trim();
      if (!/^(?:user|login|name|username|alias)$/i.test(name)) continue;
      let value = part.slice(split + 1);
      try { value = decodeURIComponent(value); } catch {}
      const found = normalizeUnbindLogin(value);
      if (!found) continue;
      try { localStorage.setItem(UNBIND_LOGIN_KEY, found); } catch {}
      return found;
    }

    const entered = normalizeUnbindLogin(window.prompt('Employee login for Unbind:', '') || '');
    if (!entered) return '';
    try { localStorage.setItem(UNBIND_LOGIN_KEY, entered); } catch {}
    return entered;
  }

  function unbindPostJson(url, body, timeout, phase) {
    return new Promise((resolve, reject) => {
      const started = performance.now();
      GM_xmlhttpRequest({
        method: 'POST',
        url,
        timeout,
        anonymous: false,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Accept': 'application/json; charset=utf-8'
        },
        data: JSON.stringify(body),
        onload: response => {
          let data = response.responseText;
          try { data = response.responseText ? JSON.parse(response.responseText) : null; } catch {}
          if (response.status >= 200 && response.status < 300) {
            resolve({ data, status: response.status, ms: Math.round(performance.now() - started) });
            return;
          }
          const error = new Error(`${phase}: HTTP ${response.status}`);
          error.phase = phase;
          error.status = response.status;
          reject(error);
        },
        onerror: () => {
          const error = new Error(`${phase}: network error`);
          error.phase = phase;
          error.ambiguous = phase === 'unbind';
          reject(error);
        },
        ontimeout: () => {
          const error = new Error(`${phase}: timeout`);
          error.phase = phase;
          error.ambiguous = phase === 'unbind';
          reject(error);
        }
      });
    });
  }

  function assertInlineUnbindValidate(data, container) {
    if (!data || typeof data !== 'object') throw new Error('Unexpected validation response');
    if (data.scannableId && clean(data.scannableId).toLowerCase() !== container.toLowerCase()) {
      throw new Error('Validation returned another container');
    }
  }

  function assertInlineUnbindSummary(data) {
    if (!data || !Array.isArray(data.transferBindingSummaryList)) {
      throw new Error('Unexpected binding summary');
    }
  }

  function assertInlineUnbindResult(data) {
    if (!data || typeof data.hostName !== 'string' || !clean(data.hostName)) {
      const error = new Error('Unexpected unbind response');
      error.phase = 'unbind';
      error.ambiguous = true;
      throw error;
    }
  }

  async function unbindCurrentContainer(button) {
    if (unbindBusy || button?.disabled) return;
    const container = currentContainer();
    if (!/^tsX[A-Z0-9]+$/i.test(container)) return toast('Unbind requires tsX', true);
    const login = unbindLogin();
    if (!login) return toast('Employee login required', true);

    usage('unbind');
    unbindBusy = true;
    const original = button?.textContent || 'Unbind';
    if (button) {
      button.disabled = true;
      button.textContent = 'Validating…';
    }

    let finalText = original;
    let resetDelay = 1400;
    try {
      const validated = await unbindPostJson(
        UNBIND_VALIDATE_URL,
        { warehouseId: 'BWU2', scannableId: container },
        12000,
        'validate'
      );
      assertInlineUnbindValidate(validated.data, container);

      if (button) button.textContent = 'Checking…';
      const summary = await unbindPostJson(
        UNBIND_SUMMARY_URL,
        { warehouseId: 'BWU2', scannableId: container },
        12000,
        'summary'
      );
      assertInlineUnbindSummary(summary.data);

      if (button) button.textContent = 'Unbinding…';
      const unbound = await unbindPostJson(
        UNBIND_URL,
        { sourceWarehouseId: 'BWU2', scannableId: container, employeeLogin: login },
        20000,
        'unbind'
      );
      assertInlineUnbindResult(unbound.data);

      finalText = 'Unbound ✓';
      toast(`Unbound ${container}`);
    } catch (error) {
      console.error('[Stow Unbind]', error);
      if (error?.ambiguous) {
        finalText = 'Check result';
        resetDelay = 2600;
        toast(`Unbind result unknown — check ${container}`, true);
      } else {
        finalText = 'Failed';
        resetDelay = 2000;
        const phase = clean(error?.phase || '');
        toast(`Unbind failed${phase ? ` (${phase})` : ''}`, true);
      }
    } finally {
      unbindBusy = false;
      if (button) {
        button.textContent = finalText;
        setTimeout(() => {
          if (!button.isConnected) return;
          button.disabled = false;
          button.textContent = original;
        }, resetDelay);
      }
      refocusSearch(100);
    }
  }

'''
s = replace_once(s, marker, unbind_helpers + marker, "inline unbind helpers")

old_controls = '''  function renderDropButtons() {
    const buttons = activeDrops().map(item => `<button type="button" class="vm-tag-btn" data-drop="${item.key}" title="${item.dest || item.pattern}">${item.label}</button>`).join('');
    return `${buttons}<button type="button" class="vm-tag-btn" data-drop="Prime" title="dz-P-PRIME">Prime</button>`;
  }

  function wireDropButtons(root) {
    $$('.vm-tag-btn', root).forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        moveContainer(button.dataset.drop, button);
      });
    });
  }
'''
new_controls = '''  function renderDropButtons() {
    const buttons = activeDrops().map(item => `<button type="button" class="vm-tag-btn" data-drop="${item.key}" title="${item.dest || item.pattern}">${item.label}</button>`).join('');
    const unbind = /^tsX[A-Z0-9]+$/i.test(currentContainer())
      ? '<span class="vm-drop-divider">|</span><button type="button" class="vm-tag-btn" data-unbind title="Unbind current tsX hierarchy">Unbind</button>'
      : '';
    return `${buttons}<button type="button" class="vm-tag-btn" data-drop="Prime" title="dz-P-PRIME">Prime</button>${unbind}`;
  }

  function wireDropButtons(root) {
    $$('.vm-tag-btn[data-drop]', root).forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        moveContainer(button.dataset.drop, button);
      });
    });
    const unbind = $('[data-unbind]', root);
    if (unbind) unbind.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      unbindCurrentContainer(unbind);
    });
  }
'''
s = replace_once(s, old_controls, new_controls, "inline unbind control")

p.write_text(s, encoding="utf-8")

r = Path("README.md")
readme = r.read_text(encoding="utf-8")
readme = replace_once(
    readme,
    "| Stow Andons Helper | 5.5.2 |",
    "| Stow Andons Helper | 5.5.5 |",
    "README Stow version"
)
r.write_text(readme, encoding="utf-8")
