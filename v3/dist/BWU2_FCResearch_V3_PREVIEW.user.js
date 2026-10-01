// ==UserScript==
// @name         BWU2 V3 FCResearch Preview
// @name:en      BWU2 V3 FCResearch Preview
// @namespace    https://github.com/1Sirkkris/-tampermonkey-v2/v3
// @version      0.0.1
// @description  Non-destructive V3 FCResearch shell preview. UI/lifecycle testing only; no warehouse actions.
// @include      /^https?:\/\/.*fcresearch.*\//
// @include      /^https?:\/\/qifcr\.fe\.aftx\.amazonoperations\.app\//
// @run-at       document-body
// @grant        none
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-rebuild/v3/dist/BWU2_FCResearch_V3_PREVIEW.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-rebuild/v3/dist/BWU2_FCResearch_V3_PREVIEW.user.js
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = '0.0.1';
  const ROOT_ID = 'bwu2-v3-fcr-root';
  if (document.getElementById(ROOT_ID)) return;

  function createLifecycle(name = 'module') {
    const controller = new AbortController();
    const disposers = new Set();
    let disposed = false;

    const on = (target, type, listener, options = {}) => {
      if (!target?.addEventListener || disposed) return () => {};
      const merged = typeof options === 'boolean'
        ? { capture: options, signal: controller.signal }
        : { ...options, signal: controller.signal };
      target.addEventListener(type, listener, merged);
      return () => target.removeEventListener(type, listener, merged);
    };

    const own = disposer => {
      if (typeof disposer === 'function') disposers.add(disposer);
      return disposer;
    };

    const dispose = () => {
      if (disposed) return;
      disposed = true;
      controller.abort();
      for (const disposer of [...disposers]) {
        try { disposer(); } catch {}
      }
      disposers.clear();
    };

    return { name, signal: controller.signal, on, own, dispose };
  }

  const life = createLifecycle('fcr-preview');

  const host = document.createElement('div');
  host.id = ROOT_ID;
  host.dataset.bwu2V3Ui = '1';
  host.dataset.bwu2Owner = 'FCResearch';
  const shadow = host.attachShadow({ mode: 'open' });
  document.body.appendChild(host);

  const state = {
    open: true,
    tab: 'FCR',
    route: '',
    screenshotHidden: false
  };

  const detectSurface = () => {
    const hash = String(location.hash || '').toLowerCase();
    if (hash.startsWith('#iss-console')) return 'ISS';
    if (hash.startsWith('#fcr-tote-checker')) return 'TOTE';
    if (hash.includes('worker')) return 'WORKER';
    return 'FCR';
  };

  const css = `
    :host{
      all:initial;
      --bg:#101319;
      --panel:#171c24;
      --panel2:#202733;
      --line:#3a4556;
      --text:#f4f7fb;
      --muted:#aeb8c8;
      --focus:#f8d14b;
      --ok:#5fe38d;
      --warn:#ffd166;
      --bad:#ff6961;
      --shadow:0 16px 44px rgba(0,0,0,.38);
      position:fixed;
      z-index:2147482500;
      right:16px;
      top:16px;
      font-family:Arial,Helvetica,sans-serif;
      color:var(--text);
    }
    *{box-sizing:border-box}
    button{font:inherit}
    .shell{
      width:390px;
      overflow:hidden;
      border:1px solid var(--line);
      border-radius:14px;
      background:var(--bg);
      box-shadow:var(--shadow);
    }
    .head{
      display:flex;
      align-items:center;
      gap:10px;
      min-height:52px;
      padding:9px 10px 9px 13px;
      border-bottom:1px solid var(--line);
      background:linear-gradient(180deg,#1d2430,#151a22);
    }
    .brand{min-width:0;flex:1}
    .brand b{display:block;font-size:15px;letter-spacing:.3px}
    .brand small{display:block;margin-top:2px;color:var(--muted);font-size:10px;font-weight:700}
    .status{
      border:1px solid #4a5669;
      border-radius:999px;
      padding:5px 8px;
      color:var(--ok);
      background:#14231b;
      font-size:10px;
      font-weight:900;
      letter-spacing:.4px;
    }
    .icon{
      width:32px;height:32px;border:1px solid var(--line);border-radius:9px;
      color:var(--text);background:var(--panel2);cursor:pointer;font-weight:900;
    }
    .icon:hover,.tab:hover{border-color:#71809a}
    .icon:focus-visible,.tab:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
    .tabs{
      display:grid;
      grid-template-columns:repeat(4,1fr);
      gap:6px;
      padding:9px;
      border-bottom:1px solid var(--line);
    }
    .tab{
      min-height:34px;
      border:1px solid #394557;
      border-radius:8px;
      background:#161b23;
      color:var(--muted);
      cursor:pointer;
      font-size:11px;
      font-weight:900;
    }
    .tab[data-active="1"]{
      color:#fff;
      border-color:#7a8aa4;
      background:#2b3442;
    }
    .body{padding:12px}
    .hero{
      padding:12px;
      border:1px solid var(--line);
      border-radius:10px;
      background:var(--panel);
    }
    .hero h2{margin:0 0 5px;font-size:18px}
    .hero p{margin:0;color:var(--muted);font-size:12px;line-height:1.45}
    .grid{
      display:grid;
      grid-template-columns:1fr 1fr;
      gap:8px;
      margin-top:10px;
    }
    .card{
      min-height:72px;
      padding:10px;
      border:1px solid #354052;
      border-radius:10px;
      background:#131820;
    }
    .card b{display:block;font-size:12px}
    .card span{display:block;margin-top:5px;color:var(--muted);font-size:10px;line-height:1.35}
    .foot{
      display:flex;justify-content:space-between;gap:8px;
      padding:9px 12px;
      border-top:1px solid var(--line);
      color:var(--muted);
      font-size:9px;font-weight:700;
    }
    .preview{
      color:var(--warn);
      font-weight:900;
    }
    .collapsed .tabs,.collapsed .body,.collapsed .foot{display:none}
    .collapsed{width:175px}
    .collapsed .status{display:none}
    .hidden-shot{display:none!important}
  `;

  shadow.innerHTML = `
    <style>${css}</style>
    <section class="shell" data-shell>
      <header class="head">
        <div class="brand">
          <b>BWU2 V3</b>
          <small>FCResearch Suite · v${VERSION}</small>
        </div>
        <span class="status" data-route>READY</span>
        <button class="icon" type="button" data-collapse title="Minimise V3">—</button>
      </header>
      <nav class="tabs" aria-label="V3 preview surfaces">
        <button class="tab" type="button" data-tab="FCR">FCR</button>
        <button class="tab" type="button" data-tab="TOTE">TOTE</button>
        <button class="tab" type="button" data-tab="ISS">ISS</button>
        <button class="tab" type="button" data-tab="OBS">OBS</button>
      </nav>
      <main class="body" data-body></main>
      <footer class="foot">
        <span class="preview">PREVIEW ONLY · NO ACTIONS</span>
        <span>one root · zero attach polling</span>
      </footer>
    </section>
  `;

  const shell = shadow.querySelector('[data-shell]');
  const body = shadow.querySelector('[data-body]');
  const route = shadow.querySelector('[data-route]');

  const copy = {
    FCR: {
      title:'FCResearch',
      text:'One suite shell. Native FCR stays untouched while V3 modules read only the state they actually need.',
      cards:[
        ['PRODUCT','Product + exact IDs + print'],
        ['INVENTORY','Inventory + bins + hierarchy'],
        ['TOOLS','Stow · RIVER · Bin Check'],
        ['ROUTER','One lifecycle owns the page']
      ]
    },
    TOTE: {
      title:'Tote Audit',
      text:'Scanner-first surface rebuilt as a V3 module instead of a separate application fighting for the page.',
      cards:[
        ['SCAN','Container → item scanning'],
        ['MATCH','Exact aliases + quantities'],
        ['PRINT','Item-bound click-to-print'],
        ['STATE','Loading / scan / done']
      ]
    },
    ISS: {
      title:'ISS Console',
      text:'Fresh console layout. Edit, Move and Sideline share one shell while engines stay independently testable.',
      cards:[
        ['EDIT','EditItems / flip workflow'],
        ['MOVE','MoveItems with owned operation state'],
        ['SIDELINE','REBUILD behaviour baseline'],
        ['PREFLIGHT','Hazmat / expiry / ASIDE']
      ]
    },
    OBS: {
      title:'OBS / Diagnostics',
      text:'Operation-centric telemetry rather than global noise. Mutations become confirmed, rejected or unknown.',
      cards:[
        ['OP ID','Cross-module correlation'],
        ['PHASE','Prepared → submitted → outcome'],
        ['BUILD','Exact V3 build fingerprint'],
        ['EXPORT','Small useful diagnostic bundles']
      ]
    }
  };

  function render() {
    const model = copy[state.tab] || copy.FCR;
    route.textContent = state.route || detectSurface();
    for (const button of shadow.querySelectorAll('[data-tab]')) {
      button.dataset.active = button.dataset.tab === state.tab ? '1' : '0';
    }
    body.innerHTML = `
      <section class="hero">
        <h2>${model.title}</h2>
        <p>${model.text}</p>
      </section>
      <section class="grid">
        ${model.cards.map(([title,desc]) => `<article class="card"><b>${title}</b><span>${desc}</span></article>`).join('')}
      </section>
    `;
  }

  function syncRoute() {
    state.route = detectSurface();
    if (state.route !== 'WORKER' && ['FCR','TOTE','ISS'].includes(state.route)) {
      state.tab = state.route;
    }
    render();
  }

  life.on(shadow, 'click', event => {
    const tab = event.target.closest?.('[data-tab]');
    if (tab) {
      state.tab = tab.dataset.tab;
      render();
      return;
    }
    if (event.target.closest?.('[data-collapse]')) {
      state.open = !state.open;
      shell.classList.toggle('collapsed', !state.open);
      const button = shadow.querySelector('[data-collapse]');
      button.textContent = state.open ? '—' : '+';
      button.title = state.open ? 'Minimise V3' : 'Expand V3';
    }
  });

  life.on(window, 'hashchange', syncRoute);
  life.on(window, 'popstate', syncRoute);
  life.on(window, 'pagehide', () => {
    life.dispose();
    host.remove();
  }, { once: true });

  syncRoute();
})();
