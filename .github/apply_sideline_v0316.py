from pathlib import Path

SIDELINE = Path('Sideline_API_Move.user.js')
AGENTS = Path('AGENTS.md')

text = SIDELINE.read_text(encoding='utf-8')
agents = AGENTS.read_text(encoding='utf-8')

original_move_refs = text.count('API_MOVE_ITEMS')
original_scan_item_refs = text.count('API_SCAN_ITEM')


def replace_once(source, old, new, label):
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, found {count}')
    return source.replace(old, new, 1)


def replace_between(source, start, end, replacement, label):
    if source.count(start) != 1:
        raise SystemExit(f'{label}: start marker count {source.count(start)}')
    start_index = source.index(start)
    end_index = source.find(end, start_index)
    if end_index < 0:
        raise SystemExit(f'{label}: end marker missing')
    return source[:start_index] + replacement + source[end_index:]


# Version only. Preserve metadata URLs and unrelated settings.
text = replace_once(text, '// @name         MAIN v0.3.15 Sideline API Move TEST', '// @name         MAIN v0.3.16 Sideline API Move TEST', 'name version')
text = replace_once(text, '// @version      0.3.15', '// @version      0.3.16', 'metadata version')
text = replace_once(text, "  const VERSION = '0.3.15';", "  const VERSION = '0.3.16';", 'runtime version')
text = replace_once(
    text,
    '  const LIVE_LOOKUP_CONCURRENCY = 3;\n',
    '  const LIVE_LOOKUP_CONCURRENCY = 3;\n  const SCRUB_VALIDATE_CONCURRENCY = 3;\n',
    'scrub concurrency constant'
)

# Old DOM scrub bookkeeping is superseded by the API scrub session.
text = replace_once(
    text,
    "  const shared = { owner:'', scrubBusy:false, queueBusy:false, expiryBusy:false };\n  let escapeEpoch = 0;\n",
    "  const shared = { owner:'', queueBusy:false, expiryBusy:false };\n",
    'old scrub shared state'
)

# Dead native helpers: current direct-close recovery no longer calls these.
text = replace_between(
    text,
    '  function customerBoundSourceMessage() {',
    '  async function waitForNativeSourceScan',
    '',
    'customer-bound DOM helper'
)
text = replace_between(
    text,
    '  async function waitForNativeLoadedSource',
    '  async function nativeReturnToOriginalSource',
    '',
    'dead native open/close helpers'
)
text = replace_between(
    text,
    '  async function normalizeNativeToSourceScan',
    '  // UI',
    '',
    'old predicant native/API ceremony'
)

# Scrub is a true ON/OFF workflow now, not just a panel visibility toggle.
text = replace_once(
    text,
    "        if (key === 'lazy' && !feature.lazy) {\n",
    "        if (key === 'scrub') {\n"
    "          const opening = !feature.scrub;\n"
    "          feature.scrub = opening;\n"
    "          if (opening) startScrubSession();\n"
    "          else stopScrubSession('off');\n"
    "          savePanelStates();\n"
    "          applyPanels();\n"
    "          return;\n"
    "        }\n\n"
    "        if (key === 'lazy' && !feature.lazy) {\n",
    'scrub dock toggle'
)

# Replace DOM Scrub + DOM Tote Queue with API-owned workflows. QTY begins at the
# end marker and is intentionally untouched.
new_scrub_queue = r'''  const scrubPanel = panel('sh-scrub', `Tote Scrubber v${VERSION}`, 'scrub');
  scrubPanel.insertAdjacentHTML('beforeend',
    '<input class="sh-input" data-scrub-scan placeholder="Scan tote — API empty ASAP" disabled>' +
    '<div class="sh-status"></div><div class="sh-error"></div>'
  );

  const scrubScan = $('[data-scrub-scan]', scrubPanel);
  const scrubStatus = $('.sh-status', scrubPanel);
  const scrubError = $('.sh-error', scrubPanel);
  const scrub = {
    session:0,
    items:[],
    closeIndex:0,
    validating:0,
    closeInFlight:false,
    cleared:0,
    skipped:0,
    failed:0,
    halted:false,
    note:'',
    error:''
  };

  function scrubPendingCount() {
    return scrub.items.reduce((count, item) =>
      ['CLEARED','SKIPPED','FAILED'].includes(item.state) ? count : count + 1,
    0);
  }

  function renderScrub() {
    const active = feature.scrub && !scrub.halted;
    const state = !feature.scrub
      ? 'OFF'
      : scrub.halted
        ? 'STOPPED — VERIFY'
        : 'ACTIVE — API';

    scrubScan.disabled = !active;
    setTextIfChanged(
      scrubStatus,
      `${state} | Cleared ${scrub.cleared} | Pending ${scrubPendingCount()} | Checking ${scrub.validating}` +
      (scrub.note ? ` | ${scrub.note}` : '')
    );
    setTextIfChanged(scrubError, scrub.error);

    let w = $('#sh-scrub-warning');
    const showWarning = feature.scrub || scrub.halted;
    if (showWarning && !w) {
      w = document.createElement('div');
      w.id = 'sh-scrub-warning';
      document.body.appendChild(w);
    }
    if (w) {
      w.textContent = scrub.halted
        ? '⚠ SCRUB STOPPED — CLOSE OUTCOME UNKNOWN — VERIFY TOTE STATE ⚠'
        : '⚠ TOTE SCRUBBER ACTIVE — SCANNED TOTES WILL BE EMPTIED ⚠';
    }
    if (!showWarning && w) w.remove();
  }

  function startScrubSession() {
    scrub.session++;
    scrub.items = [];
    scrub.closeIndex = 0;
    scrub.validating = 0;
    scrub.cleared = 0;
    scrub.skipped = 0;
    scrub.failed = 0;
    scrub.halted = false;
    scrub.note = 'scanner ready';
    scrub.error = '';

    const blocked = !!(
      q.running ||
      lazy.running ||
      live.running ||
      live.sourceReady ||
      (shared.owner && shared.owner !== 'scrub')
    );

    if (blocked) {
      scrub.halted = true;
      scrub.note = 'another Sideline workflow is active';
      scrub.error = 'STOP OTHER SIDELINE WORK FIRST';
      renderScrub();
      return;
    }

    shared.owner = 'scrub';
    renderScrub();
    setTimeout(() => {
      if (feature.scrub && !scrub.halted) scrubScan.focus();
    }, 0);
  }

  function stopScrubSession(note='off') {
    scrub.session++;
    scrub.items = [];
    scrub.closeIndex = 0;
    scrub.validating = 0;
    scrub.halted = false;
    scrub.note = note;
    scrub.error = '';
    scrubScan.disabled = true;
    if (shared.owner === 'scrub') shared.owner = '';
    renderScrub();
  }

  function pumpScrubValidation(session=scrub.session) {
    if (!feature.scrub || scrub.halted || session !== scrub.session) return;

    while (scrub.validating < SCRUB_VALIDATE_CONCURRENCY) {
      const item = scrub.items.find(candidate => candidate.state === 'QUEUED');
      if (!item) break;

      item.state = 'VALIDATING';
      scrub.validating++;
      renderScrub();

      (async () => {
        try {
          item.sourceMeta = await scanSourceDirect(item.code);
          if (session !== scrub.session) return;
          item.state = 'READY';
          item.reason = '';
        } catch (error) {
          if (session !== scrub.session) return;
          if (error?.customerBound) {
            item.state = 'SKIPPED';
            item.reason = 'CUSTOMER-BOUND — SKIPPED';
            scrub.skipped++;
            scrub.note = `${item.code} customer-bound — skipped`;
          } else {
            item.state = 'FAILED';
            item.reason = error?.message || 'SOURCE VALIDATION FAILED';
            scrub.failed++;
            scrub.error = `${item.code} — ${item.reason}`;
          }
        } finally {
          if (session === scrub.session) {
            scrub.validating = Math.max(0, scrub.validating - 1);
            renderScrub();
            pumpScrubValidation(session);
            pumpScrubClose(session);
          }
        }
      })();
    }
  }

  async function pumpScrubClose(session=scrub.session) {
    if (
      !feature.scrub ||
      scrub.halted ||
      session !== scrub.session ||
      scrub.closeInFlight
    ) return;

    while (scrub.closeIndex < scrub.items.length) {
      const item = scrub.items[scrub.closeIndex];
      if (!item) return;

      if (item.state === 'SKIPPED' || item.state === 'FAILED') {
        scrub.closeIndex++;
        continue;
      }

      if (item.state !== 'READY') return;

      scrub.closeInFlight = true;
      item.state = 'CLOSING';
      scrub.note = `emptying ${item.code}`;
      renderScrub();

      try {
        await closeContainerDirect(item.code, true);
        if (session === scrub.session) {
          item.state = 'CLEARED';
          scrub.cleared++;
          scrub.closeIndex++;
          scrub.note = `${item.code} cleared`;
        }
      } catch (error) {
        if (error?.outcomeUnknown) {
          item.state = 'UNKNOWN';
          scrub.halted = true;
          scrub.error = `CLOSE UNKNOWN — ${item.code} — VERIFY TOTE STATE MANUALLY`;
          scrub.note = 'no automatic retry sent';
          scrubScan.disabled = true;
        } else if (session === scrub.session) {
          item.state = 'FAILED';
          item.reason = error?.message || 'CLOSE FAILED';
          scrub.failed++;
          scrub.closeIndex++;
          scrub.error = `${item.code} — ${item.reason}`;
        }
      } finally {
        scrub.closeInFlight = false;
        renderScrub();
        if (feature.scrub && !scrub.halted) {
          pumpScrubValidation(scrub.session);
          queueMicrotask(() => pumpScrubClose(scrub.session));
        }
      }
      return;
    }
  }

  scrubScan.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    event.stopPropagation();

    const code = clean(scrubScan.value);
    scrubScan.value = '';

    if (!feature.scrub || scrub.halted || !code) return;
    if (!validContainer(code)) {
      scrub.error = 'Tote must start with csX or tsX.';
      scrub.note = `${code} rejected`;
      renderScrub();
      setTimeout(() => scrubScan.focus(), 0);
      return;
    }

    scrub.items.push({ code, state:'QUEUED', reason:'', sourceMeta:null });
    scrub.note = `${code} queued`;
    renderScrub();
    pumpScrubValidation(scrub.session);
    pumpScrubClose(scrub.session);
    setTimeout(() => {
      if (feature.scrub && !scrub.halted) scrubScan.focus();
    }, 0);
  });

  const q = { running:false, paused:false, index:0, list:[], failed:[], runSeq:0 };
  const queuePanel = panel('sh-queue', `Tote Queue v${VERSION}`, 'queue');
  queuePanel.insertAdjacentHTML('beforeend',
    '<textarea class="sh-input sh-area" placeholder="Paste tsX/csX list"></textarea>' +
    '<div class="sh-grid3"><button class="sh-btn sh-on" data-a="start">Start</button><button class="sh-btn" data-a="pause">Pause</button><button class="sh-btn sh-stop" data-a="stop">Stop</button></div>' +
    '<div class="sh-status"></div><div class="sh-error"></div>'
  );

  const qText = $('textarea', queuePanel), qStatus = $('.sh-status', queuePanel), qError = $('.sh-error', queuePanel);

  function parseContainers(text) {
    const seen = new Set();
    return (String(text).match(/\b(?:tsX|csX)[A-Za-z0-9_-]+\b/gi) || []).filter(v => {
      const k = v.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function renderQueue(note='') {
    const cur = q.list[q.index] || '—';
    setTextIfChanged(qStatus, `${q.running ? (q.paused ? 'PAUSED' : 'RUNNING') : 'STOPPED'} | ${Math.min(q.index,q.list.length)}/${q.list.length} | Current: ${cur}${note ? ' | '+note : ''}`);
    setTextIfChanged(qError, q.failed.length ? `Errors: ${q.failed.join(', ')}` : '');
  }

  async function queuePump(run=q.runSeq) {
    const active = () => run === q.runSeq && q.running;
    if (!active() || q.paused || shared.queueBusy) return;
    if (q.index >= q.list.length) {
      q.running = false;
      if (shared.owner === 'queue') shared.owner = '';
      renderQueue('done');
      return;
    }

    shared.queueBusy = true;
    shared.owner = 'queue';
    const code = q.list[q.index];

    try {
      renderQueue('validating by API');
      try {
        await scanSourceDirect(code);
      } catch (error) {
        if (!active()) return;
        if (error?.customerBound) {
          q.index++;
          renderQueue('customer-bound — skipped');
          return;
        }
        throw error;
      }

      if (!active()) return;
      renderQueue('emptying by API');
      await closeContainerDirect(code, true);
      if (!active()) return;

      q.index++;
      renderQueue('cleared');
    } catch (error) {
      if (!active()) return;

      if (error?.outcomeUnknown) {
        q.failed.push(`${code} (CLOSE UNKNOWN — VERIFY)`);
        q.running = false;
        q.paused = false;
        qError.textContent = `CLOSE UNKNOWN — ${code} — VERIFY TOTE STATE MANUALLY`;
        renderQueue('STOPPED — no automatic retry');
        return;
      }

      q.failed.push(`${code} (${error?.message || error})`);
      q.index++;
      renderQueue(error?.message || String(error));
    } finally {
      shared.queueBusy = false;
      if (!q.running && shared.owner === 'queue') shared.owner = '';
      if (active() && !q.paused) queueMicrotask(() => queuePump(run));
    }
  }

  queuePanel.onclick = event => {
    const action = event.target.dataset.a;
    if (!action) return;

    if (action === 'start') {
      if (feature.scrub && !scrub.halted) {
        qError.textContent = 'Scrub is active — turn Scrub OFF first.';
        return;
      }
      if (live.running || live.sourceReady) {
        qError.textContent = 'Live Lazy is active — stop/reset Live first.';
        return;
      }

      q.runSeq++;
      q.list = parseContainers(qText.value);
      q.index = 0;
      q.failed = [];
      q.running = !!q.list.length;
      q.paused = false;
      renderQueue(q.running ? 'starting API queue' : 'no containers');
      queuePump(q.runSeq);
      return;
    }

    if (action === 'pause') {
      q.paused = !q.paused;
      event.target.textContent = q.paused ? 'Resume' : 'Pause';
      renderQueue();
      if (!q.paused) queuePump(q.runSeq);
      return;
    }

    if (action === 'stop') {
      q.runSeq++;
      q.running = false;
      q.paused = false;
      if (shared.owner === 'queue') shared.owner = '';
      renderQueue('stopped');
    }
  };
  renderQueue();

'''
text = replace_between(
    text,
    "  const scrubPanel = panel('sh-scrub'",
    "  const qtyPanel = panel('sh-qty'",
    new_scrub_queue,
    'API scrub and tote block'
)

# Live 1x1 cleanup left a useless mode field in the failure notice.
text = replace_once(
    text,
    "  function setLiveFailureNotice(item, title, reason, mode='live') {\n",
    "  function setLiveFailureNotice(item, title, reason) {\n",
    'live failure mode parameter'
)
text = replace_once(text, "      mode,\n      title:clean(title) || 'ITEM NOT MOVED',\n", "      title:clean(title) || 'ITEM NOT MOVED',\n", 'live failure mode property')

# Dead Live retry helper.
text = replace_between(
    text,
    '  function restartLiveLookup(item) {',
    '  function scanSourcePayload',
    '',
    'restartLiveLookup barnacle'
)

# Lazy pre-resolve carried an unused copy of the source code.
text = replace_once(text, "    sourceKey:'',\n    sourceCode:'',\n", "    sourceKey:'',\n", 'lazy sourceCode property')
text = replace_once(text, "    lazyPreResolve.sourceCode = code;\n    lazyPreResolve.sourceKey = code ? norm(code) : '';\n", "    lazyPreResolve.sourceKey = code ? norm(code) : '';\n", 'lazy sourceCode assignment')

# Dead recursive Hazmat detector; active logic is scanStageIssue + isHazmatRejectionResponse.
text = replace_between(
    text,
    '  function hasHazmat(value) {',
    '  function isHazmatRejectionResponse',
    '',
    'hasHazmat barnacle'
)

# Add direct source validation next to the already-proven direct close helper.
scan_source_helpers = r'''  function payloadHasCustomerBound(value, seen=new Set()) {
    if (value == null) return false;
    if (typeof value === 'string') return /customer\s*bound\s*shipment/i.test(value);
    if (typeof value !== 'object') return false;
    if (seen.has(value)) return false;
    seen.add(value);

    if (Array.isArray(value)) return value.some(child => payloadHasCustomerBound(child, seen));
    return Object.entries(value).some(([key, child]) =>
      /customer\s*bound\s*shipment/i.test(key) || payloadHasCustomerBound(child, seen)
    );
  }

  async function scanSourceDirect(container) {
    const code = clean(container);
    if (!validContainer(code)) throw new Error('Source scan requires a valid csX/tsX container.');

    let response;
    try {
      response = await fetch(API_SCAN_SOURCE, {
        method:'POST',
        credentials:'same-origin',
        headers:{'content-type':'application/json'},
        body:JSON.stringify(scanSourcePayload(code))
      });
    } catch (cause) {
      const error = new Error(`Source scan failed for ${code}: ${cause?.message || cause}`);
      error.cause = cause;
      throw error;
    }

    let raw = '';
    try {
      raw = await response.text();
    } catch (cause) {
      const error = new Error(`Source response could not be read for ${code}.`);
      error.cause = cause;
      throw error;
    }

    let payload = raw;
    try { payload = raw ? JSON.parse(raw) : null; } catch {}

    if (payloadHasCustomerBound(payload)) {
      const error = new Error('CUSTOMER-BOUND SHIPMENT');
      error.customerBound = true;
      error.payload = payload;
      throw error;
    }

    if (
      !response.ok ||
      clean(payload?.['@type']) !== 'ScanSourceContainerResponse' ||
      payload?.success !== true
    ) {
      const reason = clean(
        payload?.message ||
        payload?.description ||
        payload?.errorMessage ||
        payload?.['@type'] ||
        (response.ok ? 'SOURCE VALIDATION FAILED' : `HTTP ${response.status}`)
      );
      const error = new Error(reason || 'SOURCE VALIDATION FAILED');
      error.payload = payload;
      throw error;
    }

    return payload;
  }

'''
text = replace_once(
    text,
    '  function closeContainerPayload(container, containerEmpty) {\n',
    scan_source_helpers + '  function closeContainerPayload(container, containerEmpty) {\n',
    'direct source validation helper'
)

# Predicant recovery no longer reenacts the old native source/destination ceremony.
new_wait_predicant = r'''  async function waitPredicant(item, run) {
    lazy.predicant = true;
    lazy.paused = true;
    lazy.error = `WAITING FOR YOU — RESCAN DESTINATION ${lazy.dest} TO CONTINUE`;
    lazy.note = `${item.code} paused — no more moves will run until destination is rescanned`;
    renderLazy();

    if (!lazy.inputCollapsed) lItems.focus();
    lPredicantCard?.scrollIntoView?.({block:'nearest', inline:'nearest'});

    await new Promise(resolve => { lazy.predicantResolve = resolve; });
    if (!currentLazyRun(run) || !lazy.running) return false;

    lazy.predicant = true;
    lazy.paused = true;
    shared.owner = 'lazy-recovery';

    const setRecovery = message => {
      lazy.error = '';
      lazy.note = message;
      renderLazy();
    };

    try {
      setRecovery(`Predicant — emptying destination ${lazy.dest} by API...`);
      await closeContainerDirect(lazy.dest, true);

      if (!currentLazyRun(run) || !lazy.running) return false;

      lazy.predicant = false;
      lazy.paused = false;
      lazy.error = '';
      lazy.note = `Destination emptied — retrying ${item.code} ×${item.qty}`;
      shared.owner = 'lazy';
      renderLazy();
      return true;
    } catch (error) {
      if (error?.outcomeUnknown) {
        cancelLazyRun();
        lazy.running = false;
        lazy.predicant = false;
        lazy.paused = false;
        lazy.error = `Predicant recovery stopped — ${error?.message || error}`;
        lazy.note = 'VERIFY DESTINATION STATE MANUALLY — no automatic close retry was sent';
        shared.owner = '';
        setLazyRunningIndicator(false);
        renderLazy();
        return false;
      }

      if (runWasCancelled(error, run)) return false;

      lazy.predicant = true;
      lazy.paused = true;
      lazy.error = `Predicant recovery stopped: ${error?.message || error}`;
      lazy.note = 'scan destination again to retry recovery';
      shared.owner = 'lazy';
      renderLazy();
      return false;
    }
  }

'''
text = replace_between(
    text,
    '  async function waitPredicant(item, run) {',
    '  async function moveResolved',
    new_wait_predicant,
    'simplified predicant recovery'
)

# Return-to-source must stop the new API scrub session rather than old DOM polling.
text = replace_once(
    text,
    "    } else if (mode === 'scrub') {\n      escapeEpoch++;\n      feature.scrub = false;\n      shared.scrubBusy = false;\n      renderScrub();\n",
    "    } else if (mode === 'scrub') {\n      feature.scrub = false;\n      stopScrubSession('returned to source');\n",
    'return-to-source scrub shutdown'
)

# Preserve prior persisted Scrub=ON behaviour after reload, but start the new API session.
text = replace_once(
    text,
    "    applyPanels();\n    renderScrub();\n    refreshItems();\n",
    "    applyPanels();\n    renderScrub();\n    if (feature.scrub) startScrubSession();\n    refreshItems();\n",
    'boot scrub session'
)

# Safety / scope guards.
if text.count('API_MOVE_ITEMS') != original_move_refs:
    raise SystemExit('API_MOVE_ITEMS reference count changed unexpectedly')
if text.count('API_SCAN_ITEM') != original_scan_item_refs:
    raise SystemExit('API_SCAN_ITEM reference count changed unexpectedly')
for dead in [
    'restartLiveLookup(',
    'nativeOpenSourceContainer(',
    'nativeCloseLoadedContainer(',
    'normalizeNativeToSourceScan(',
    'hasHazmat(',
    'customerBoundSourceMessage(',
    'waitForNativeLoadedSource(',
    'scrubTick(',
    'scrubTimer',
    'shared.scrubBusy',
    'escapeEpoch'
]:
    if dead in text:
        raise SystemExit(f'dead code still present: {dead}')

for required in [
    "const LOOKUP_CONCURRENCY = 5;",
    "const LIVE_LOOKUP_CONCURRENCY = 3;",
    "const SCRUB_VALIDATE_CONCURRENCY = 3;",
    "data-scrub-scan",
    "await scanSourceDirect(code);",
    "await closeContainerDirect(code, true);",
    "await closeContainerDirect(lazy.dest, true);",
    "const result = await closeOpenContainer('yes');",
    "VERIFY DESTINATION STATE MANUALLY"
]:
    if required not in text:
        raise SystemExit(f'required behaviour missing: {required}')

if 'Predicant recovery 1/4' in text or 'Destination reset — revalidating' in text:
    raise SystemExit('old Predicant ceremony still present')

SIDELINE.write_text(text, encoding='utf-8')

# AGENTS: remove only the stale deleted 1x1 workflow references.
agents = replace_once(
    agents,
    'Lazy Sideline, Live and 1x1 are separate workflows.',
    'Lazy Sideline and Live are separate workflows.',
    'AGENTS workflow list'
)
agents = replace_once(
    agents,
    'Lazy, Live and 1x1 must preserve a safe **Return to Source / escape path** from applicable manual-intervention states without requiring a page refresh.',
    'Lazy and Live must preserve a safe **Return to Source / escape path** from applicable manual-intervention states without requiring a page refresh.',
    'AGENTS return-source list'
)
if '1x1' in agents.lower():
    raise SystemExit('stale 1x1 text remains in AGENTS.md')
AGENTS.write_text(agents, encoding='utf-8')
