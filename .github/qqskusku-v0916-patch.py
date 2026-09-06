from pathlib import Path
p = Path('AFT_Edit_SKU_Move.user.js')
s = p.read_text()

def rep(old, new, count=1):
    global s
    if s.count(old) < count:
        raise SystemExit(f"Missing patch target ({s.count(old)}/{count}): {old[:160]!r}")
    s = s.replace(old, new, count)

rep('// @name         MAIN v0.9.15 AFT Edit/SKU/Move master', '// @name         MAIN v0.9.16 AFT Edit/SKU/Move master')
rep('// @name:en      MAIN v0.9.15 AFT Edit/SKU/Move master', '// @name:en      MAIN v0.9.16 AFT Edit/SKU/Move master')
rep('// @version      0.9.15', '// @version      0.9.16')
rep("const VERSION = '0.9.15';", "const VERSION = '0.9.16';")

rep(
'''    document.documentElement.appendChild(style);
  }''',
'''    style.textContent += `
      #aftm-sku .sku-batch-wrap{display:grid;gap:6px;padding:8px;border:1px solid #b9c9cf;border-radius:7px;background:#f9fcfd}
      #aftm-sku .sku-batch-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:900}
      #aftm-sku .sku-batch-count{font-size:10px;color:#617078}
      #aftm-sku .sku-batch-queue{height:118px;min-height:88px;resize:vertical;font:12px/1.45 Consolas,monospace;background:#fff}
      #aftm-sku .sku-batch-note{font-size:10px;color:#617078}
      #aftm-sku .sku-batch-failed{padding:7px 8px;border:1px solid #a84234;border-left-width:5px;border-radius:5px;background:#fff3f1;color:#542018;font:800 11px/1.4 Consolas,monospace;white-space:pre-wrap;word-break:break-word}
      #aftm-control [data-toggle-sku-batch][hidden]{display:none!important}
    `;
    document.documentElement.appendChild(style);
  }'''
)

rep(
'''      sku: 'aftm_sku_entry',
      currentState: 'aftm_sku_current_state',''',
'''      sku: 'aftm_sku_entry',
      skuBatchMode: 'aftm_sku_batch_mode',
      skuQueue: 'aftm_sku_batch_queue',
      currentState: 'aftm_sku_current_state','''
)

rep(
'''            <label>
              SKU / ASIN / FNSKU / FCSKU
              <input data-sku autocomplete="off">
            </label>''',
'''            <label data-sku-single-wrap>
              SKU / ASIN / FNSKU / FCSKU
              <input data-sku autocomplete="off">
            </label>'''
)

rep(
'''          </div>

          <div class="two">
            <div class="sku-picker-group">''',
'''          </div>

          <div class="sku-batch-wrap" data-sku-batch-wrap hidden>
            <div class="sku-batch-head">
              <span>QQSkuSku queue</span>
              <span class="sku-batch-count" data-sku-batch-count>0 items</span>
            </div>
            <textarea class="sku-batch-queue" data-sku-queue autocomplete="off" placeholder="One SKU / ASIN / FNSKU / FCSKU per line"></textarea>
            <div class="sku-batch-note">Uses the Current state → Desired state selected below.</div>
            <div class="sku-batch-failed" data-sku-batch-failed hidden></div>
          </div>

          <div class="two">
            <div class="sku-picker-group">'''
)

rep(
'''      const desiredState = $('[data-new-state]', panel);
      const desiredDamage = $('[data-new-dmg]', panel);

      sku.value = localStorage.getItem(this.keys.sku) || '';''',
'''      const desiredState = $('[data-new-state]', panel);
      const desiredDamage = $('[data-new-dmg]', panel);
      const skuQueue = $('[data-sku-queue]', panel);

      sku.value = localStorage.getItem(this.keys.sku) || '';
      skuQueue.value = localStorage.getItem(this.keys.skuQueue) || '';'''
)

rep(
'''      sku.oninput = debounce(() => {
        localStorage.setItem(this.keys.sku, norm(sku.value));
        this.setStartQty(null);
      });

      for (const [el, keyName] of [''',
'''      sku.oninput = debounce(() => {
        localStorage.setItem(this.keys.sku, norm(sku.value));
        this.setStartQty(null);
      });
      skuQueue.oninput = debounce(() => {
        localStorage.setItem(this.keys.skuQueue, skuQueue.value);
        this.updateSkuBatchMeta();
      });

      for (const [el, keyName] of ['''
)

rep(
'''      drawSkuChoices();

      wireMin(panel, this.keys.skuMin);''',
'''      drawSkuChoices();
      this.paintSkuBatchMode();

      wireMin(panel, this.keys.skuMin);'''
)

rep(
'''    parseEachQueue(text) {
      const items = [];
      for (const raw of String(text || '').split(/\r?\n/)) {
        const line = norm(raw);
        if (!line) continue;
        const [location = '', asin = '', fnsku = ''] = line.split(/\s+/);
        if (location && asin) items.push({ location, asin, fnsku: fnsku || asin });
      }
      return items;
    },

    async directRun(task) {''',
'''    parseEachQueue(text) {
      const items = [];
      for (const raw of String(text || '').split(/\r?\n/)) {
        const line = norm(raw);
        if (!line) continue;
        const [location = '', asin = '', fnsku = ''] = line.split(/\s+/);
        if (location && asin) items.push({ location, asin, fnsku: fnsku || asin });
      }
      return items;
    },

    batchSkuEnabled() {
      return localStorage.getItem(this.keys.skuBatchMode) === '1';
    },

    setBatchSkuEnabled(on) {
      localStorage.setItem(this.keys.skuBatchMode, on ? '1' : '0');
      this.paintSkuBatchMode();
      Control.paint();
    },

    parseSkuBatchQueue(text) {
      const seen = new Set();
      const out = [];
      for (const raw of String(text || '').split(/[\s,;]+/)) {
        const value = norm(raw);
        if (!value) continue;
        const key = value.toUpperCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(value);
      }
      return out;
    },

    updateSkuBatchMeta() {
      if (!this.panel || this.mode !== 'sku') return;
      const queue = $('[data-sku-queue]', this.panel);
      const count = this.parseSkuBatchQueue(queue?.value).length;
      const el = $('[data-sku-batch-count]', this.panel);
      if (el) el.textContent = `${count} item${count === 1 ? '' : 's'}`;
    },

    paintSkuBatchMode() {
      if (!this.panel || this.mode !== 'sku') return;
      const on = this.batchSkuEnabled();
      const single = $('[data-sku-single-wrap]', this.panel);
      const batch = $('[data-sku-batch-wrap]', this.panel);
      const run = $('[data-run]', this.panel);
      if (single) single.hidden = on;
      if (batch) batch.hidden = !on;
      if (run && !this.directBusy) run.textContent = on ? 'RUN QUEUE' : 'RUN';
      this.updateSkuBatchMeta();
    },

    showSkuBatchFailures(failed) {
      const el = this.panel && $('[data-sku-batch-failed]', this.panel);
      if (!el) return;
      if (!failed?.length) {
        el.hidden = true;
        el.textContent = '';
        return;
      }
      el.hidden = false;
      el.textContent = `FAILED (${failed.length})\n${failed.map(item => item.sku).join('\n')}`;
    },

    async directRun(task) {'''
)

rep(
'''      if (this.runBtn) this.runBtn.disabled = running;
      if (this.stopBtn) this.stopBtn.disabled = !running;''',
'''      if (this.runBtn) {
        this.runBtn.disabled = running;
        if (this.mode === 'sku') this.runBtn.textContent = this.batchSkuEnabled() ? 'RUN QUEUE' : 'RUN';
      }
      if (this.stopBtn) this.stopBtn.disabled = !running;'''
)

rep(
'''    async resetSkuWorkflow(objectId, reason = 'Retry', endCurrent = true) {''',
'''    async resetSkuWorkflow(objectId, reason = 'Retry', endCurrent = true, allowReload = true) {'''
)
rep(
'''      location.reload();
      throw new Error('Retry reset required page reload');
    },''',
'''      if (!allowReload) throw new Error('Could not reset Edit SKU workflow without page reload');
      location.reload();
      throw new Error('Retry reset required page reload');
    },'''
)

rep(
'''    async startSkuDirect() {
      if (this.directBusy || this.mode !== 'sku') return;''',
'''    async restoreSkuBatchReady() {
      const ended = new Set();
      let last = null;
      for (let attempt = 1; attempt <= 12; attempt++) {
        if (this.stopRequested) throw new Error('Stopped by user');
        const snap = await this.fetchState(`Queue recovery ${attempt}`);
        last = snap;
        if (snap.objectId && snap.state === 'item') {
          const ready = await EditApi.wait(snap.objectId, `Queue recovery ${attempt}`, { timeout: 12000 });
          if (ready.state === 'READY') return snap;
        }
        if (snap.objectId && !ended.has(snap.objectId)) {
          ended.add(snap.objectId);
          try { await EditApi.end(snap.objectId); } catch {}
        }
        await sleep(attempt < 4 ? 90 : 180);
      }
      throw new Error(`Queue recovery failed; last state="${last?.state || 'unknown'}"`);
    },

    async startSkuBatchDirect() {
      if (this.directBusy || this.mode !== 'sku') return;
      const queueEl = $('[data-sku-queue]', this.panel);
      const items = this.parseSkuBatchQueue(queueEl?.value);
      if (!items.length) return this.status('Paste SKU / ASIN / FNSKU / FCSKU rows');

      const meta = {
        currentState: $('[data-cur-state]', this.panel).value,
        currentDamage: $('[data-cur-dmg]', this.panel).value,
        desiredState: $('[data-new-state]', this.panel).value,
        desiredDamage: $('[data-new-dmg]', this.panel).value
      };
      for (const [keyName, value] of [
        [this.keys.currentState, meta.currentState], [this.keys.currentDamage, meta.currentDamage],
        [this.keys.desiredState, meta.desiredState], [this.keys.desiredDamage, meta.desiredDamage],
        [this.keys.skuQueue, queueEl.value]
      ]) localStorage.setItem(keyName, value);

      this.setStartQty(null);
      this.tracker?.restartSameSku?.();
      this.showSkuBatchFailures([]);
      await this.directRun(() => this.runSkuBatchQueue(items, meta));
    },

    async runSkuBatchQueue(items, baseMeta) {
      let flipped = 0;
      let zero = 0;
      const failed = [];

      for (let i = 0; i < items.length; i++) {
        if (this.stopRequested) throw new Error('Stopped by user');
        const sku = items[i];
        this.status(`${i + 1}/${items.length} • ${sku}`);

        try {
          const result = await this.runSkuDirect(
            { ...baseMeta, sku },
            { maxRecoveries: 2, allowReload: false }
          );
          if (result?.outcome === 'zero') zero++;
          else flipped++;
        } catch (error) {
          if (this.stopRequested) throw error;
          failed.push({ sku, message: String(error?.message || error) });
          this.showSkuBatchFailures(failed);
          this.status(`${i + 1}/${items.length} FAILED • resetting`);
          await this.restoreSkuBatchReady();
        }
      }

      this.showSkuBatchFailures(failed);
      this.status(`DONE ✓ ${flipped} flipped • ${zero} zero • ${failed.length} failed`);
      return { flipped, zero, failed };
    },

    async startSkuDirect() {
      if (this.directBusy || this.mode !== 'sku') return;
      if (this.batchSkuEnabled()) return this.startSkuBatchDirect();'''
)

rep(
'''    async runSkuDirect(meta) {
      const currentState = this.mapState(meta.currentState);
      const desiredState = this.mapState(meta.desiredState);
      const currentLabel = meta.currentState;

      let session = await this.acquireSkuObject();
      let attempt = 0;
      let initialQty = null;''',
'''    async runSkuDirect(meta, options = {}) {
      const currentState = this.mapState(meta.currentState);
      const desiredState = this.mapState(meta.desiredState);
      const currentLabel = meta.currentState;
      const maxRecoveries = Number.isFinite(options.maxRecoveries) ? options.maxRecoveries : Infinity;

      let session = await this.acquireSkuObject();
      let attempt = 0;
      let initialQty = null;
      let didFlip = false;
      let recoveries = 0;

      const recover = async (objectId, reason, endCurrent = true) => {
        recoveries++;
        if (recoveries >= maxRecoveries) {
          throw new Error(`${reason} • failed twice`);
        }
        return this.resetSkuWorkflow(
          objectId,
          `${reason} • retry ${recoveries}/1`,
          endCurrent,
          options.allowReload !== false
        );
      };'''
)

rep(
'''            session = await this.resetSkuWorkflow(objectId, `Expected error ${attempt}`);
            continue;''',
'''            session = await recover(objectId, `Expected error ${attempt}`);
            continue;'''
)

rep(
'''            this.status(`Attempt ${attempt} • source did not advance → retrying`);
            session = await this.resetSkuWorkflow(objectId, `Attempt ${attempt}`);
            continue;''',
'''            this.status(`Attempt ${attempt} • source did not advance → retrying`);
            session = await recover(objectId, `Attempt ${attempt} source did not advance`);
            continue;'''
)

rep(
'''              this.status(`Attempt ${attempt} • expected consumer-type error → retrying`);
              session = await this.resetSkuWorkflow(objectId, `Attempt ${attempt}`);
              continue;''',
'''              this.status(`Attempt ${attempt} • expected consumer-type error → retrying`);
              session = await recover(objectId, `Attempt ${attempt} consumer-type error`);
              continue;'''
)

rep(
'''          if (snap.state === 'retryError') {
            session = await this.resetSkuWorkflow(objectId, `Attempt ${attempt}`);
            continue;
          }''',
'''          if (snap.state === 'retryError') {
            session = await recover(objectId, `Attempt ${attempt} retry error`);
            continue;
          }'''
)

rep(
'''            this.status(`DONE ✓ 0 ${currentLabel} remaining`);
            try { await EditApi.end(objectId); } catch {}
            return;''',
'''            this.status(`DONE ✓ 0 ${currentLabel} remaining`);
            try { await EditApi.end(objectId); } catch {}
            return { outcome: didFlip ? 'done' : 'zero' };'''
)

rep(
'''          await EditApi.end(objectId);

          this.status(`Attempt ${attempt} complete • rechecking ${currentLabel}`);''',
'''          await EditApi.end(objectId);
          didFlip = true;
          recoveries = 0;

          this.status(`Attempt ${attempt} complete • rechecking ${currentLabel}`);'''
)

rep(
'''          if (/failed to change consumer type|retryError/i.test(message)) {
            session = await this.resetSkuWorkflow(objectId, `Attempt ${attempt}`);
            continue;
          }

          if (/backend ERRORED|status ERRORED|returned error/i.test(message)) {
            await this.recoverSkuBackendError(objectId, meta.sku, attempt);
            return;
          }''',
'''          if (/failed to change consumer type|retryError/i.test(message)) {
            session = await recover(objectId, `Attempt ${attempt} consumer-type error`);
            continue;
          }

          if (/backend ERRORED|status ERRORED|returned error/i.test(message)) {
            if (Number.isFinite(options.maxRecoveries)) {
              session = await recover(objectId, `Attempt ${attempt} backend error`);
              continue;
            }
            await this.recoverSkuBackendError(objectId, meta.sku, attempt);
            return;
          }'''
)

rep(
'''    editBtn: null,
    moveBtn: null,
    titleEl: null,''',
'''    editBtn: null,
    skuBatchBtn: null,
    moveBtn: null,
    titleEl: null,'''
)

rep(
'''          <button type="button" class="ctrl-toggle" data-toggle-edit>EditItems</button>
          <button type="button" class="ctrl-toggle" data-toggle-move>MoveItems</button>''',
'''          <button type="button" class="ctrl-toggle" data-toggle-edit>EditItems</button>
          <button type="button" class="ctrl-toggle" data-toggle-sku-batch hidden>QQSkuSku OFF</button>
          <button type="button" class="ctrl-toggle" data-toggle-move>MoveItems</button>'''
)

rep(
'''      this.editBtn = $('[data-toggle-edit]', panel);
      this.moveBtn = $('[data-toggle-move]', panel);''',
'''      this.editBtn = $('[data-toggle-edit]', panel);
      this.skuBatchBtn = $('[data-toggle-sku-batch]', panel);
      this.moveBtn = $('[data-toggle-move]', panel);'''
)

rep(
'''      this.moveBtn.onclick = () => {
        this.setEnabled('move', !this.enabled('move'));
      };

    },''',
'''      this.skuBatchBtn.onclick = () => {
        Edit.setBatchSkuEnabled(!Edit.batchSkuEnabled());
      };

      this.moveBtn.onclick = () => {
        this.setEnabled('move', !this.enabled('move'));
      };

    },'''
)

rep(
'''      const editActive = Edit.match() && editOn && Edit.active;
      const moveActive = MoveItems.match() && moveOn && MoveItems.active;

      this.titleEl.textContent = this.currentLabel();''',
'''      const editActive = Edit.match() && editOn && Edit.active;
      const moveActive = MoveItems.match() && moveOn && MoveItems.active;
      const skuBatchVisible = Edit.match() && Edit.mode === 'sku' && editOn;
      const skuBatchOn = Edit.batchSkuEnabled();

      this.titleEl.textContent = this.currentLabel();'''
)

rep(
'''      this.editBtn.textContent = `EditItems  ${editOn ? 'ON' : 'OFF'}${editActive ? ' • ACTIVE' : ''}`;
      this.moveBtn.textContent = `MoveItems  ${moveOn ? 'ON' : 'OFF'}${moveActive ? ' • ACTIVE' : ''}`;''',
'''      this.editBtn.textContent = `EditItems  ${editOn ? 'ON' : 'OFF'}${editActive ? ' • ACTIVE' : ''}`;
      this.skuBatchBtn.hidden = !skuBatchVisible;
      this.skuBatchBtn.dataset.on = skuBatchOn ? '1' : '0';
      this.skuBatchBtn.dataset.active = skuBatchVisible && skuBatchOn ? '1' : '0';
      this.skuBatchBtn.textContent = `QQSkuSku  ${skuBatchOn ? 'ON' : 'OFF'}`;
      this.moveBtn.textContent = `MoveItems  ${moveOn ? 'ON' : 'OFF'}${moveActive ? ' • ACTIVE' : ''}`;'''
)

rep(
'''        this.editBtn = this.moveBtn = this.titleEl = this.noteEl = null;''',
'''        this.editBtn = this.skuBatchBtn = this.moveBtn = this.titleEl = this.noteEl = null;'''
)

p.write_text(s)
