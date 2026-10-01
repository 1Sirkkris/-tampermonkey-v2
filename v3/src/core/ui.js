V3.ui = (() => {
  const BASE_CSS = [
    ':host{all:initial;--v3-bg:#101319;--v3-panel:#171c24;--v3-panel2:#202733;--v3-line:#465367;--v3-text:#f5f7fb;--v3-muted:#b8c2d1;--v3-focus:#ffd84d;--v3-ok:#65f08f;--v3-warn:#ffd166;--v3-bad:#ff655d;position:fixed;z-index:2147482500;right:14px;top:14px;font-family:Arial,Helvetica,sans-serif;color:var(--v3-text)}',
    '*{box-sizing:border-box}button,input,textarea,select{font:inherit}',
    '.v3-shell{width:410px;max-height:calc(100vh - 28px);display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--v3-line);border-radius:14px;background:var(--v3-bg);box-shadow:0 16px 44px rgba(0,0,0,.42)}',
    '.v3-head{display:flex;align-items:center;gap:9px;min-height:50px;padding:9px 10px 9px 13px;border-bottom:1px solid var(--v3-line);background:#181e28}',
    '.v3-brand{min-width:0;flex:1}.v3-brand b{display:block;font-size:15px;letter-spacing:.25px}.v3-brand small{display:block;margin-top:2px;color:var(--v3-muted);font-size:10px;font-weight:700}',
    '.v3-status{max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid var(--v3-line);border-radius:999px;padding:5px 8px;color:var(--v3-ok);background:#13231a;font-size:10px;font-weight:900}',
    '.v3-status[data-tone="warn"]{color:#17120a;background:var(--v3-warn)}.v3-status[data-tone="bad"]{color:#fff;background:#8f211c}.v3-status[data-tone="work"]{color:#17120a;background:#ffd84d}',
    '.v3-icon,.v3-tab,.v3-btn{border:1px solid var(--v3-line);border-radius:8px;background:var(--v3-panel2);color:var(--v3-text);cursor:pointer;font-weight:900}',
    '.v3-icon{width:32px;height:32px}.v3-btn{min-height:34px;padding:7px 10px}.v3-btn.primary{background:#eef4ff;color:#111827}.v3-btn.danger{background:#8f211c;color:#fff}',
    '.v3-icon:focus-visible,.v3-tab:focus-visible,.v3-btn:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:3px solid var(--v3-focus);outline-offset:2px}',
    '.v3-tabs{display:flex;gap:6px;padding:8px;border-bottom:1px solid var(--v3-line);overflow:auto}.v3-tab{min-height:32px;padding:6px 10px;color:var(--v3-muted);white-space:nowrap}.v3-tab[data-active="1"]{color:#fff;background:#303a49;border-color:#78889f}',
    '.v3-body{overflow:auto;padding:11px}.v3-section{padding:10px;border:1px solid var(--v3-line);border-radius:10px;background:var(--v3-panel);margin-bottom:9px}',
    '.v3-section h3{margin:0 0 7px;font-size:13px}.v3-note{color:var(--v3-muted);font-size:11px;line-height:1.4}',
    '.v3-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.v3-row{display:flex;gap:7px;align-items:center}.v3-row>*{min-width:0}',
    'label.v3-field{display:grid;gap:4px;color:var(--v3-muted);font-size:10px;font-weight:800;margin-bottom:8px}',
    '.v3-field input,.v3-field textarea,.v3-field select,input.v3-input,textarea.v3-input{width:100%;border:1px solid #56657a;border-radius:8px;background:#0d1117;color:#fff;padding:8px 9px;min-height:35px}',
    'textarea.v3-input,.v3-field textarea{min-height:92px;resize:vertical;font-family:Consolas,monospace;font-size:12px}',
    '.v3-list{display:grid;gap:5px}.v3-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;padding:6px 8px;border:1px solid #3b4658;border-left:5px solid #748096;border-radius:7px;background:#11161e;font:700 11px/1.25 Consolas,monospace}',
    '.v3-item[data-state="done"]{border-left-color:#68e690}.v3-item[data-state="attention"],.v3-item[data-state="rejected"]{border-left-color:#ff655d}.v3-item[data-state="active"]{border-left-color:#ffd84d}',
    '.v3-log{width:100%;min-height:90px;max-height:180px;overflow:auto;white-space:pre-wrap;border:1px solid #39465a;border-radius:8px;background:#0b0f14;padding:8px;color:#d9e2ef;font:11px/1.35 Consolas,monospace}',
    '.v3-footer{display:flex;justify-content:space-between;gap:8px;padding:7px 11px;border-top:1px solid var(--v3-line);color:var(--v3-muted);font-size:9px;font-weight:800}',
    '.v3-shell[data-collapsed="1"]{width:190px}.v3-shell[data-collapsed="1"] .v3-tabs,.v3-shell[data-collapsed="1"] .v3-body,.v3-shell[data-collapsed="1"] .v3-footer{display:none}',
    '@media(max-width:700px){:host{right:6px;top:6px}.v3-shell{width:min(410px,calc(100vw - 12px));max-height:calc(100vh - 12px)}}'
  ].join('');

  function createShell(options) {
    if (!document.body) throw new Error('V3 UI requires document.body');
    const id = options.id;
    const existing = document.getElementById(id);
    if (existing) {
      if (!existing.shadowRoot || existing.dataset.bwu2V3Ui !== '1') throw new Error('V3 root collision: ' + id);
      return existing.__v3ShellApi;
    }

    const host = document.createElement('div');
    host.id = id;
    host.dataset.bwu2V3Ui = '1';
    host.dataset.bwu2Owner = options.title || 'BWU2 V3';
    const shadow = host.attachShadow({mode:'open'});
    document.body.appendChild(host);

    const tabs = Array.isArray(options.tabs) ? options.tabs : [];
    shadow.innerHTML =
      '<style>' + BASE_CSS + (options.css || '') + '</style>' +
      '<section class="v3-shell" data-shell>' +
        '<header class="v3-head">' +
          '<div class="v3-brand"><b>' + V3.base.esc(options.title || 'BWU2 V3') + '</b><small>' +
            V3.base.esc(options.subtitle || '') + ' · v' + V3.base.esc(options.version || V3.build.version) +
          '</small></div>' +
          '<span class="v3-status" data-status data-tone="">READY</span>' +
          '<button type="button" class="v3-icon" data-collapse title="Minimise">−</button>' +
        '</header>' +
        (tabs.length ? '<nav class="v3-tabs">' + tabs.map(tab =>
          '<button type="button" class="v3-tab" data-tab="' + V3.base.esc(tab.id) + '">' + V3.base.esc(tab.label || tab.id) + '</button>'
        ).join('') + '</nav>' : '') +
        '<main class="v3-body" data-body></main>' +
        '<footer class="v3-footer"><span>BWU2 V3</span><span data-build>' + V3.base.esc(V3.build.id) + '</span></footer>' +
      '</section>';

    const shell = shadow.querySelector('[data-shell]');
    const body = shadow.querySelector('[data-body]');
    const status = shadow.querySelector('[data-status]');
    let selected = tabs[0]?.id || '';

    const paintTabs = () => {
      for (const button of shadow.querySelectorAll('[data-tab]')) {
        button.dataset.active = button.dataset.tab === selected ? '1' : '0';
      }
    };

    const api = {
      host, shadow, shell, body,
      get tab(){ return selected; },
      select(tab){ selected=tab; paintTabs(); options.onTab?.(tab); },
      setStatus(text,tone=''){ status.textContent=String(text||''); status.dataset.tone=tone; },
      setContent(content){
        body.replaceChildren();
        if (content instanceof Node) body.appendChild(content);
        else body.innerHTML=String(content||'');
      },
      collapse(value){
        const next=value == null ? shell.dataset.collapsed !== '1' : Boolean(value);
        shell.dataset.collapsed=next?'1':'0';
        const button=shadow.querySelector('[data-collapse]');
        button.textContent=next?'+':'−';
      }
    };

    options.life.on(shadow,'click',event => {
      const tab = event.target.closest?.('[data-tab]');
      if (tab) { api.select(tab.dataset.tab); return; }
      if (event.target.closest?.('[data-collapse]')) api.collapse();
    });

    host.__v3ShellApi=api;
    paintTabs();
    return api;
  }

  return Object.freeze({ createShell, BASE_CSS });
})();