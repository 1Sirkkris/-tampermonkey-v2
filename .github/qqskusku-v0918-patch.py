from pathlib import Path

p = Path('AFT_Edit_SKU_Move.user.js')
s = p.read_text()


def rep(old, new, label):
    global s
    count = s.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, got {count}')
    s = s.replace(old, new, 1)


rep('// @name         MAIN v0.9.17 AFT Edit/SKU/Move master', '// @name         MAIN v0.9.18 AFT Edit/SKU/Move master', 'name')
rep('// @name:en      MAIN v0.9.17 AFT Edit/SKU/Move master', '// @name:en      MAIN v0.9.18 AFT Edit/SKU/Move master', 'name en')
rep('// @version      0.9.17', '// @version      0.9.18', 'meta version')
rep("const VERSION = '0.9.17';", "const VERSION = '0.9.18';", 'runtime version')

rep(
    '''            <div class="sku-batch-note">Uses the Current state → Desired state selected below.</div>
            <div class="sku-batch-failed" data-sku-batch-failed hidden></div>''',
    '''            <div class="sku-batch-note">Uses the Current state → Desired state selected below.</div>
            <style>
              #aftm-sku .sku-batch-progress{display:grid;gap:4px;max-height:156px;overflow:auto;padding:2px;border-radius:6px}
              #aftm-sku .sku-batch-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;min-height:29px;padding:5px 7px;border:1px solid #c1cbd0;border-left:5px solid #b8c1c5;border-radius:5px;background:#fff;color:#26343a;font:700 11px/1.2 Consolas,monospace}
              #aftm-sku .sku-batch-row[data-state="active"]{background:#fff2a8;border-color:#d1a300;border-left-color:#a86f00;color:#2e2600}
              #aftm-sku .sku-batch-row[data-state="done"]{background:#e5e8ea;border-color:#aeb7bc;border-left-color:#7d898f;color:#4a565c}
              #aftm-sku .sku-batch-row[data-state="error"]{background:#ffe0e0;border-color:#bd514d;border-left-color:#9f1f1a;color:#681714}
              #aftm-sku .sku-batch-code{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
              #aftm-sku .sku-batch-state{font:900 10px/1 Arial,sans-serif;letter-spacing:.25px;white-space:nowrap}
            </style>
            <div class="sku-batch-progress" data-sku-batch-progress hidden aria-live="polite"></div>
            <div class="sku-batch-failed" data-sku-batch-failed hidden></div>''',
    'batch progress markup'
)

rep(
    '''    showSkuBatchFailures(failed) {''',
    '''    initSkuBatchProgress(items) {
      this.skuBatchProgress = (items || []).map(sku => ({ sku, state: 'pending', label: 'WAIT' }));
      this.drawSkuBatchProgress();
    },

    clearSkuBatchProgress() {
      this.skuBatchProgress = [];
      const el = this.panel && $('[data-sku-batch-progress]', this.panel);
      if (!el) return;
      el.hidden = true;
      el.replaceChildren();
    },

    setSkuBatchProgressState(index, state, label = '') {
      const row = this.skuBatchProgress?.[index];
      if (!row) return;
      row.state = state;
      row.label = label || ({ pending: 'WAIT', active: '▶ RUNNING', done: '✓ DONE', error: '! ERROR' }[state] || String(state).toUpperCase());
      this.drawSkuBatchProgress(index);
    },

    drawSkuBatchProgress(focusIndex = -1) {
      const el = this.panel && $('[data-sku-batch-progress]', this.panel);
      if (!el) return;
      const rows = this.skuBatchProgress || [];
      if (!rows.length) {
        el.hidden = true;
        el.replaceChildren();
        return;
      }

      const frag = document.createDocumentFragment();
      for (const row of rows) {
        const line = document.createElement('div');
        line.className = 'sku-batch-row';
        line.dataset.state = row.state;

        const code = document.createElement('span');
        code.className = 'sku-batch-code';
        code.textContent = row.sku;

        const state = document.createElement('span');
        state.className = 'sku-batch-state';
        state.textContent = row.label;

        line.append(code, state);
        frag.append(line);
      }

      el.replaceChildren(frag);
      el.hidden = false;
      if (focusIndex >= 0 && el.children[focusIndex]) {
        const row = el.children[focusIndex];
        const top = row.offsetTop;
        const bottom = top + row.offsetHeight;
        if (top < el.scrollTop) el.scrollTop = top;
        else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
      }
    },

    showSkuBatchFailures(failed) {''',
    'progress methods'
)

rep(
    '''      skuQueue.oninput = debounce(() => {
        localStorage.setItem(this.keys.skuQueue, skuQueue.value);
        this.updateSkuBatchMeta();
      });''',
    '''      skuQueue.oninput = debounce(() => {
        localStorage.setItem(this.keys.skuQueue, skuQueue.value);
        this.clearSkuBatchProgress();
        this.showSkuBatchFailures([]);
        this.updateSkuBatchMeta();
      });''',
    'queue input reset'
)

rep(
    '''      this.setStartQty(null);
      this.tracker?.restartSameSku?.();
      this.showSkuBatchFailures([]);
      await this.directRun(() => this.runSkuBatchQueue(items, meta));''',
    '''      this.setStartQty(null);
      this.tracker?.restartSameSku?.();
      this.showSkuBatchFailures([]);
      this.initSkuBatchProgress(items);
      await this.directRun(() => this.runSkuBatchQueue(items, meta));''',
    'batch start progress'
)

rep(
    '''        const sku = items[i];
        this.status(`${i + 1}/${items.length} • ${sku}`);

        try {''',
    '''        const sku = items[i];
        this.status(`${i + 1}/${items.length} • ${sku}`);
        this.setSkuBatchProgressState(i, 'active', '▶ RUNNING');

        try {''',
    'current highlight'
)

rep(
    '''          if (result?.outcome === 'zero') zero++;
          else flipped++;''',
    '''          if (result?.outcome === 'zero') {
            zero++;
            this.setSkuBatchProgressState(i, 'done', '— 0 QTY');
          } else {
            flipped++;
            this.setSkuBatchProgressState(i, 'done', '✓ DONE');
          }''',
    'done highlight'
)

rep(
    '''          failed.push({ sku, message: String(error?.message || error) });''',
    '''          this.setSkuBatchProgressState(i, 'error', '! ERROR');
          failed.push({ sku, message: String(error?.message || error) });''',
    'error highlight'
)

rep(
    '''      if (clearFields) this.tracker?.clear();''',
    '''      if (clearFields) {
        this.tracker?.clear();
        this.clearSkuBatchProgress?.();
        this.showSkuBatchFailures?.([]);
      }''',
    'clear progress'
)

p.write_text(s)
