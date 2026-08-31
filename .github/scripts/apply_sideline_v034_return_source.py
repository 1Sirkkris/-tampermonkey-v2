from pathlib import Path

path = Path('Sideline_API_Move.user.js')
text = path.read_text(encoding='utf-8')

def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    text = text.replace(old, new, 1)

replace_once('// @name         MAIN v0.3.3 Sideline API Move TEST', '// @name         MAIN v0.3.4 Sideline API Move TEST', 'name version')
replace_once('// @version      0.3.3', '// @version      0.3.4', 'metadata version')
replace_once("const VERSION = '0.3.3';", "const VERSION = '0.3.4';", 'runtime version')

replace_once(
"""  const helperSelector = '#sh-dock,#sh-queue,#sh-scrub,#sh-qty,#sh-lazy,#sh-live,#sh-scrub-warning,#sh-og-expiry,#sh-invalid-toast,#sh-lazy-running-indicator,#sh-move-corner';
  const shared = { owner:'', scrubBusy:false, queueBusy:false, expiryBusy:false };
""",
"""  const helperSelector = '#sh-dock,#sh-queue,#sh-scrub,#sh-qty,#sh-lazy,#sh-live,#sh-scrub-warning,#sh-og-expiry,#sh-invalid-toast,#sh-lazy-running-indicator,#sh-move-corner';
  const shared = { owner:'', scrubBusy:false, queueBusy:false, expiryBusy:false };
  let escapeEpoch = 0;
  let returnSourceBusy = false;
  let expiryRequestSeq = 0;
  let nativeExpirySuppressedUntil = 0;
""",
'shared escape state')

replace_once(
"""  async function fillAndConfirm(value, expected='') {
    const input = await waitFor(() => (!expected || screen() === expected) && scanInput(), 12000, 60);
    if (!input) return false;
    input.focus();
    input.select?.();
    setValue(input, '');
    await sleep(10);
    setValue(input, value);
    await sleep(25);
    const button = confirmButton();
    enabled(button) ? click(button) : enter(input);
    return true;
  }

  async function closeOpenContainer(choice='yes') {
    const change = await waitFor(changeButton, 12000, 35);
    if (!change) return 'change timeout';
    click(change);
    const answer = await waitFor(() => modalButton(choice), 3500, 25);
    if (!answer) return `${choice.toLowerCase()} timeout`;
    click(answer);
    return await waitFor(() => screen() === 'SOURCE' && scanInput(), 12000, 50) ? 'closed' : 'source timeout';
  }
""",
"""  async function fillAndConfirm(value, expected='', active=()=>true) {
    const input = await waitFor(() => active() && (!expected || screen() === expected) && scanInput(), 12000, 60);
    if (!input || !active()) return false;
    input.focus();
    input.select?.();
    setValue(input, '');
    await sleep(10);
    if (!active()) return false;
    setValue(input, value);
    await sleep(25);
    if (!active()) return false;
    const button = confirmButton();
    enabled(button) ? click(button) : enter(input);
    return active();
  }

  async function closeOpenContainer(choice='yes', active=()=>true) {
    const change = await waitFor(() => active() && changeButton(), 12000, 35);
    if (!change || !active()) return 'cancelled';
    click(change);
    const answer = await waitFor(() => active() && modalButton(choice), 3500, 25);
    if (!answer || !active()) return 'cancelled';
    click(answer);
    if (!active()) return 'cancelled';
    return await waitFor(() => active() && screen() === 'SOURCE' && scanInput(), 12000, 50) ? 'closed' : 'source timeout';
  }
""",
'cancellable native helpers')

replace_once(
"""#sh-dock button,.sh-btn{border:1px solid #aeb8c5;border-radius:3px;padding:8px 6px;font-weight:700;cursor:pointer;background:#f5f7fa;color:#1f2937}.sh-on{background:#146eb4!important;color:#fff!important;border-color:#0f5c99!important}
.sh-panel{position:fixed;right:14px;bottom:58px;z-index:2147483646;width:460px;max-width:calc(100vw - 28px);box-sizing:border-box;padding:10px;background:#fff;border:1px solid #c7d0dd;box-shadow:0 2px 8px #0003;font:12px Arial,sans-serif;color:#111827}.sh-title{font-weight:800;margin:-10px -10px 8px;padding:9px 10px;background:#f3f5f8;border-bottom:1px solid #d5dbe3}
""",
"""#sh-dock button,.sh-btn{border:1px solid #aeb8c5;border-radius:3px;padding:8px 6px;font-weight:700;cursor:pointer;background:#f5f7fa;color:#1f2937}.sh-on{background:#146eb4!important;color:#fff!important;border-color:#0f5c99!important}
.sh-panel{position:fixed;right:14px;bottom:58px;z-index:2147483646;width:460px;max-width:calc(100vw - 28px);box-sizing:border-box;padding:10px;background:#fff;border:1px solid #c7d0dd;box-shadow:0 2px 8px #0003;font:12px Arial,sans-serif;color:#111827}.sh-title{font-weight:800;margin:-10px -10px 8px;padding:9px 10px;background:#f3f5f8;border-bottom:1px solid #d5dbe3}
.sh-return-source{width:100%;margin:0 0 8px;padding:8px 10px!important;border:2px solid #146eb4!important;background:#eff6ff!important;color:#0f3d73!important;font-weight:1000!important}.sh-return-source:hover{background:#dbeafe!important}.sh-return-source-inline{margin-top:8px;width:100%;border:2px solid #146eb4!important;background:#eff6ff!important;color:#0f3d73!important;font-weight:1000!important}
""",
'return-source panel CSS')

replace_once(
"""#sh-og-expiry .og-footer{margin-top:7px}.og-footer button{width:100%;height:48px!important;background:#7c3aed!important;color:#fff!important;border-color:#6d28d9!important;font-size:15px!important}.og-footer .production-confirm{background:#146eb4!important;border-color:#0f5c99!important}
""",
"""#sh-og-expiry .og-footer{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:7px}.og-footer button{width:100%;height:48px!important;background:#7c3aed!important;color:#fff!important;border-color:#6d28d9!important;font-size:15px!important}.og-footer .production-confirm{background:#146eb4!important;border-color:#0f5c99!important}.og-footer .og-return-source{background:#eff6ff!important;color:#0f3d73!important;border:2px solid #146eb4!important}
""",
'date footer CSS')

replace_once(
"""    root.className = 'sh-panel';
    root.innerHTML = `<div class=\"sh-title\">${title}</div>`;
""",
"""    root.className = 'sh-panel';
    root.innerHTML = `<div class=\"sh-title\">${title}</div><button type=\"button\" class=\"sh-btn sh-return-source\" data-return-source>↩ Return to Source</button>`;
""",
'universal panel button')

replace_once(
"""  async function scrubTick() {
    if (!feature.scrub || shared.scrubBusy || shared.owner === 'queue' || shared.owner === 'lazy' || shared.owner === 'live') return;
    const change = changeButton();
    if (!change) return;
    shared.scrubBusy = true;
    shared.owner = 'scrub';
    try {
      click(change);
      const yes = await waitFor(() => modalButton('yes'), 3000, 20);
      if (yes) click(yes);
    } finally {
      shared.scrubBusy = false;
      shared.owner = '';
    }
  }

  const q = { running:false, paused:false, index:0, list:[], failed:[] };
""",
"""  async function scrubTick() {
    if (!feature.scrub || shared.scrubBusy || shared.owner === 'queue' || shared.owner === 'lazy' || shared.owner === 'live') return;
    const epoch = escapeEpoch;
    const change = changeButton();
    if (!change) return;
    shared.scrubBusy = true;
    shared.owner = 'scrub';
    try {
      if (epoch !== escapeEpoch || !feature.scrub) return;
      click(change);
      const yes = await waitFor(() => epoch === escapeEpoch && feature.scrub && modalButton('yes'), 3000, 20);
      if (yes && epoch === escapeEpoch && feature.scrub) click(yes);
    } finally {
      shared.scrubBusy = false;
      if (shared.owner === 'scrub') shared.owner = '';
    }
  }

  const q = { running:false, paused:false, index:0, list:[], failed:[], runSeq:0 };
""",
'scrub and queue cancellation state')

replace_once(
"""  async function queuePump() {
    if (!q.running || q.paused || shared.queueBusy) return;
""",
"""  async function queuePump(run=q.runSeq) {
    const active = () => run === q.runSeq && q.running;
    if (!active() || q.paused || shared.queueBusy) return;
""",
'queue run guard')

replace_once(
"""    try {
      if (screen() !== 'SOURCE' && changeButton()) {
        const r = await closeOpenContainer('yes');
        if (r !== 'closed') throw new Error(r);
      }
      renderQueue('scanning source');
      if (!await fillAndConfirm(code, 'SOURCE')) throw new Error('scan timeout');

      const openedOrBlocked = await waitFor(() => {
        if (customerBoundSourceMessage()) return 'customer-bound';
        if (changeButton()) return 'opened';
        return null;
      }, 4500, 40);
""",
"""    try {
      if (screen() !== 'SOURCE' && changeButton()) {
        const r = await closeOpenContainer('yes', active);
        if (!active()) return;
        if (r !== 'closed') throw new Error(r);
      }
      renderQueue('scanning source');
      if (!await fillAndConfirm(code, 'SOURCE', active)) {
        if (!active()) return;
        throw new Error('scan timeout');
      }

      const openedOrBlocked = await waitFor(() => {
        if (!active()) return 'cancelled';
        if (customerBoundSourceMessage()) return 'customer-bound';
        if (changeButton()) return 'opened';
        return null;
      }, 4500, 40);

      if (!active() || openedOrBlocked === 'cancelled') return;
""",
'queue guarded native steps')

replace_once(
"""      const result = await closeOpenContainer('yes');
      if (result !== 'closed') throw new Error(result);
      q.index++;
      renderQueue('cleared');
""",
"""      const result = await closeOpenContainer('yes', active);
      if (!active()) return;
      if (result !== 'closed') throw new Error(result);
      q.index++;
      renderQueue('cleared');
""",
'queue guarded close')

replace_once(
"""    } finally {
      shared.queueBusy = false;
      shared.owner = '';
      if (q.running && !q.paused) setTimeout(queuePump, 40);
    }
""",
"""    } finally {
      shared.queueBusy = false;
      if (shared.owner === 'queue') shared.owner = '';
      if (active() && !q.paused) setTimeout(() => queuePump(run), 40);
    }
""",
'queue guarded finally')

replace_once(
"""      q.list = parseContainers(qText.value);
      q.index = 0;
""",
"""      q.runSeq++;
      q.list = parseContainers(qText.value);
      q.index = 0;
""",
'queue start sequence')
replace_once('      queuePump();\n', '      queuePump(q.runSeq);\n', 'queue start call')
replace_once(
"""    if (a === 'stop') {
      q.running = false;
""",
"""    if (a === 'stop') {
      q.runSeq++;
      q.running = false;
""",
'queue stop sequence')

replace_once(
"""      input.focus();
      input.select?.();
      setValue(input, '');
      await sleep(10);
      setValue(input, qty);
      await sleep(25);

      const b = confirmButton();
      enabled(b) ? click(b) : enter(input);
""",
"""      if (token !== qtyRequestSeq) return;
      input.focus();
      input.select?.();
      setValue(input, '');
      await sleep(10);
      if (token !== qtyRequestSeq) return;
      setValue(input, qty);
      await sleep(25);
      if (token !== qtyRequestSeq) return;

      const b = confirmButton();
      enabled(b) ? click(b) : enter(input);
""",
'qty stale-action guard')

replace_once(
"""      `<div class=\"sh-live-action\"><b>SCAN A NEW DESTINATION ABOVE</b><br>Current item stays blocked and retries first.</div>` +
      `<div class=\"sh-live-issue-buttons\"><button class=\"sh-btn sh-stop\" data-live-a=\"skip\">Skip item</button></div>`
""",
"""      `<div class=\"sh-live-action\"><b>SCAN A NEW DESTINATION ABOVE</b><br>Current item stays blocked and retries first.</div>` +
      `<div class=\"sh-live-issue-buttons\"><button class=\"sh-btn sh-return-source-inline\" data-return-source>↩ Return to Source</button><button class=\"sh-btn sh-stop\" data-live-a=\"skip\">Skip item</button></div>`
""",
'live blocked escape')

replace_once(
"""        `<div class=\"sh-predicant-help\"><strong>SCAN THAT DESTINATION AGAIN NOW</strong><br>` +
        `Lazy is paused and waiting. Recovery starts automatically after the scan.</div>`;
""",
"""        `<div class=\"sh-predicant-help\"><strong>SCAN THAT DESTINATION AGAIN NOW</strong><br>` +
        `Lazy is paused and waiting. Recovery starts automatically after the scan.</div>` +
        `<button type=\"button\" class=\"sh-btn sh-return-source-inline\" data-return-source>↩ Return to Source</button>`;
""",
'lazy predicant escape')

replace_once(
"""          `<div class=\"og-footer\">${
            production
              ? `<button class=\"production-confirm\" data-a=\"apply\" ${selection.month&&selection.day&&selection.year?'':'disabled'}>USE PRODUCTION DATE</button>`
              : `<button data-a=\"pao\">PAO +900 DAYS &nbsp; ${dateLabel(paoDateMs())}</button>`
          }</div>`;
""",
"""          `<div class=\"og-footer\">${
            production
              ? `<button class=\"production-confirm\" data-a=\"apply\" ${selection.month&&selection.day&&selection.year?'':'disabled'}>USE PRODUCTION DATE</button>`
              : `<button data-a=\"pao\">PAO +900 DAYS &nbsp; ${dateLabel(paoDateMs())}</button>`
          }<button type=\"button\" class=\"og-return-source\" data-return-source>↩ RETURN TO SOURCE</button></div>`;
""",
'api date escape')

replace_once(
"""  async function submitNativeExpiryDate(ms) {
    if (shared.expiryBusy) return false;
    shared.expiryBusy = true;

    try {
      const inputs = await waitFor(() => screen() === 'EXPIRY' && nativeExpiryInputs(), 4500, 40);
      if (!inputs) return false;

      const parts = nativeExpiryDateParts(ms);

      for (const [input,value] of [
        [inputs.month,parts.mm],
        [inputs.day,parts.dd],
        [inputs.year,parts.yyyy]
      ]) {
        input.focus();
        input.select?.();
        setValue(input,'');
        await sleep(18);
        setValue(input,value);
        input.dispatchEvent(new Event('blur',{bubbles:true}));
        await sleep(28);
      }

      await sleep(60);

      const confirm = confirmButton();
      if (enabled(confirm)) click(confirm);
      else enter(inputs.year);

      return true;
    } finally {
      setTimeout(() => { shared.expiryBusy = false; }, 250);
    }
  }
""",
"""  async function submitNativeExpiryDate(ms) {
    if (shared.expiryBusy) return false;
    const token = ++expiryRequestSeq;
    shared.expiryBusy = true;

    try {
      const inputs = await waitFor(() => token === expiryRequestSeq && screen() === 'EXPIRY' && nativeExpiryInputs(), 4500, 40);
      if (!inputs || token !== expiryRequestSeq) return false;

      const parts = nativeExpiryDateParts(ms);

      for (const [input,value] of [
        [inputs.month,parts.mm],
        [inputs.day,parts.dd],
        [inputs.year,parts.yyyy]
      ]) {
        if (token !== expiryRequestSeq) return false;
        input.focus();
        input.select?.();
        setValue(input,'');
        await sleep(18);
        if (token !== expiryRequestSeq) return false;
        setValue(input,value);
        input.dispatchEvent(new Event('blur',{bubbles:true}));
        await sleep(28);
      }

      await sleep(60);
      if (token !== expiryRequestSeq) return false;

      const confirm = confirmButton();
      if (enabled(confirm)) click(confirm);
      else enter(inputs.year);

      return true;
    } finally {
      if (token === expiryRequestSeq) setTimeout(() => { shared.expiryBusy = false; }, 250);
    }
  }
""",
'native expiry cancellation')

replace_once(
"""  function showNativeExpiryPicker() {
    if (lazy.running || shared.expiryBusy || $('#sh-og-expiry') || screen() !== 'EXPIRY') return;
""",
"""  function showNativeExpiryPicker() {
    if (Date.now() < nativeExpirySuppressedUntil || lazy.running || shared.expiryBusy || $('#sh-og-expiry') || screen() !== 'EXPIRY') return;
""",
'native picker suppression')

replace_once(
"""        `<div class=\"og-footer\"><button data-a=\"pao\">PAO +900 DAYS &nbsp; ${dateLabel(paoDateMs())}</button></div>`;
""",
"""        `<div class=\"og-footer\"><button data-a=\"pao\">PAO +900 DAYS &nbsp; ${dateLabel(paoDateMs())}</button><button type=\"button\" class=\"og-return-source\" data-return-source>↩ RETURN TO SOURCE</button></div>`;
""",
'native date escape')

replace_once(
"""  function nativeExpiryTick() {
    if (lazy.running || live.running) return;
""",
"""  function nativeExpiryTick() {
    if (Date.now() < nativeExpirySuppressedUntil || lazy.running || live.running) return;
""",
'native expiry tick suppression')

insert_before = """  // Boot
  function boot() {
"""
if text.count(insert_before) != 1:
    raise SystemExit('universal return insertion point missing')
universal = r'''  function abandonLiveForReturn() {
    const seen = new Set();
    let abandoned = 0;
    const mark = item => {
      if (!item || seen.has(item) || ['MOVED','SKIPPED'].includes(item.status)) return;
      seen.add(item);
      item.status = 'SKIPPED';
      item.failReason = 'RETURN TO SOURCE — ABANDONED';
      abandoned += itemQty(item);
    };

    mark(live.current);
    mark(live.activeDateItem);
    for (const item of live.oneInFlight.values()) mark(item);
    for (const item of live.datePending) mark(item);

    live.skipped += abandoned;
    return abandoned;
  }

  function stopLiveForReturn(note) {
    cancelLiveRun();
    clearMoveCorner('live');
    live.dateResolve?.(null);
    live.dateResolve = null;
    clearLiveDateScanBuffer();
    clearTimeout(live.oneErrorTimer);
    live.oneErrorTimer = 0;
    live.oneErrorToken++;
    live.oneResult = null;
    clearTimeout(live.failureTimer);
    live.failureTimer = 0;
    live.failureToken++;
    live.failureNotice = null;

    const abandoned = abandonLiveForReturn();
    live.oneInFlight.clear();
    live.running = false;
    live.sourceReady = false;
    live.processing = false;
    live.src = '';
    live.dest = '';
    live.sourceMeta = null;
    live.queue = [];
    live.current = null;
    live.datePending = [];
    live.activeDateItem = null;
    resetLiveLookupPool();
    live.issue = null;
    live.error = '';
    live.note = `${note}${abandoned ? ` — abandoned ${abandoned} active unit${abandoned === 1 ? '' : 's'}` : ''}`;
    live.nextMoveAt = 0;

    liveSrc.disabled = false;
    liveDest.disabled = true;
    liveScan.disabled = true;
    liveSrc.value = '';
    liveDest.value = '';
    liveScan.value = '';
    liveSrc.classList.remove('good','bad','sh-live-idle-pulse');
    liveDest.classList.remove('good','bad','sh-live-idle-pulse');
    renderLive();
  }

  function stopLazyForReturn(note) {
    const current = lazy.items[lazy.index];
    if (current && !['MOVED','FAILED','INVALID'].includes(current.status)) {
      current.status = 'ABANDONED';
      current.failReason = 'RETURN TO SOURCE — ABANDONED';
    }

    cancelLazyRun();
    clearMoveCorner('lazy');
    lazy.running = false;
    lazy.paused = false;
    lazy.predicant = false;
    lazy.damagePaused = false;
    lazy.damagedDest = '';
    lazy.inputCollapsed = false;
    clearLazyCollapsedScanBuffer();
    stopDamageAttention();
    if (lPause) lPause.textContent = 'Pause';
    lazy.predicantResolve?.();
    lazy.predicantResolve = null;
    lazy.dateResolve?.(null);
    lazy.dateResolve = null;
    lazy.error = '';
    lazy.note = note;
    setLazyRunningIndicator(false);
    renderLazy();
  }

  async function returnNativeToSourceContainer(sourceCode) {
    screenDirty = true;

    if (sourceCode) {
      const returned = await nativeReturnToOriginalSource(sourceCode);
      if (returned) return 'original source';
    }

    if (screen() === 'SOURCE' && scanInput()) return 'source scan';

    const back = backToSourceButton();
    if (back) {
      click(back);
      const outcome = await waitFor(() => {
        screenDirty = true;
        if (sourceCode && norm(loadedSourceContainer()) === norm(sourceCode) && screen() === 'ITEM') return 'original source';
        if (screen() === 'SOURCE' && scanInput()) return 'source scan';
        return null;
      }, 10000, 50);
      if (outcome) return outcome;
    }

    const change = changeButton();
    if (change) {
      click(change);
      const no = await waitFor(() => modalButton('no'), 4000, 35);
      if (no) {
        click(no);
        if (await waitForNativeSourceScan(10000)) return 'source scan';
      }
    }

    return await waitForNativeSourceScan(1800) ? 'source scan' : '';
  }

  async function universalReturnToSource() {
    if (returnSourceBusy) return;
    returnSourceBusy = true;

    const sourceCode = clean(live.src || lazy.src || loadedSourceContainer());
    const liveWasActive = !!(live.running || live.sourceReady || live.current || live.datePending.length || live.issue || live.oneInFlight.size);
    const lazyWasActive = !!(lazy.running || lazy.activeRun || lazy.predicant || lazy.damagePaused || lazy.dateResolve);
    const queueWasActive = q.running;
    const qtyWasActive = shared.owner === 'qty' || shared.owner === 'qty-clear';

    escapeEpoch++;
    expiryRequestSeq++;
    qtyRequestSeq++;
    nativeExpirySuppressedUntil = Date.now() + 5000;

    q.runSeq++;
    q.running = false;
    q.paused = false;
    renderQueue('returned to source');

    feature.scrub = false;
    renderScrub();

    stopLiveForReturn('returned to source');
    stopLazyForReturn('returned to source — current item abandoned');

    $('#sh-og-expiry')?.remove();
    $('#sh-invalid-toast')?.remove();
    shared.scrubBusy = false;
    shared.queueBusy = false;
    shared.expiryBusy = true;
    shared.owner = 'return-source';
    qtyClear.disabled = false;
    if (qtyWasActive) qtyStatus.textContent = 'Returned to source — quantity action cancelled';

    savePanelStates();
    applyPanels();

    try {
      const outcome = await returnNativeToSourceContainer(sourceCode);
      const message = outcome
        ? `returned to ${outcome}`
        : 'helper escaped — native source control not found';

      if (liveWasActive) {
        live.note = message;
        renderLive();
      }
      if (lazyWasActive) {
        lazy.note = `${message} — queue/history preserved`;
        renderLazy();
      }
      if (queueWasActive) renderQueue(message);
      if (qtyWasActive) qtyStatus.textContent = message;
    } catch (error) {
      const message = `RETURN TO SOURCE FAILED — ${error?.message || error}`;
      live.error = liveWasActive ? message : live.error;
      lazy.error = lazyWasActive ? message : lazy.error;
      if (queueWasActive) qError.textContent = message;
      if (qtyWasActive) qtyStatus.textContent = message;
      renderLive();
      renderLazy();
    } finally {
      shared.expiryBusy = false;
      if (shared.owner === 'return-source') shared.owner = '';
      returnSourceBusy = false;
      screenDirty = true;
      requestPanelLayout();
      setTimeout(nativeExpiryTick, 5500);
    }
  }

  function handleUniversalReturnClick(event) {
    const button = event.target?.closest?.('[data-return-source]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    universalReturnToSource();
  }

'''
text = text.replace(insert_before, universal + insert_before, 1)

replace_once(
"""  function boot() {
    mountDock();
""",
"""  function boot() {
    document.addEventListener('click', handleUniversalReturnClick, true);
    mountDock();
""",
'boot return listener')

path.write_text(text, encoding='utf-8')

readme = Path('README.md')
readme_text = readme.read_text(encoding='utf-8')
old = '| Sideline API Move | 0.3.3 |'
new = '| Sideline API Move | 0.3.4 |'
if readme_text.count(old) != 1:
    raise SystemExit(f'README version row expected once, found {readme_text.count(old)}')
readme.write_text(readme_text.replace(old, new, 1), encoding='utf-8')

final = path.read_text(encoding='utf-8')
required = [
    "const VERSION = '0.3.4';",
    'data-return-source>↩ Return to Source</button>',
    'data-return-source>↩ RETURN TO SOURCE</button>',
    'async function universalReturnToSource()',
    "live.queue = [];",
    "lazy.note = note;",
    "qtyRequestSeq++;",
    "q.runSeq++;",
    "nativeExpirySuppressedUntil = Date.now() + 5000;",
    "document.addEventListener('click', handleUniversalReturnClick, true);",
]
for needle in required:
    if needle not in final:
        raise SystemExit(f'missing required invariant: {needle}')
