from pathlib import Path
import re

path = Path('Sideline_API_Move.user.js')
text = path.read_text()


def rep(old, new, label, count=1):
    global text
    n = text.count(old)
    if n != count:
        raise SystemExit(f'{label}: expected {count}, found {n}')
    text = text.replace(old, new, count)


def sub(pattern, repl, label, count=1, flags=0):
    global text
    text2, n = re.subn(pattern, repl, text, count=count, flags=flags)
    if n != count:
        raise SystemExit(f'{label}: expected {count}, found {n}')
    text = text2


rep('MAIN v0.3.14 Sideline API Move TEST', 'MAIN v0.3.15 Sideline API Move TEST', 'name')
rep('// @version      0.3.14', '// @version      0.3.15', 'metadata version')
rep("const VERSION = '0.3.14';", "const VERSION = '0.3.15';", 'runtime version')

sub(r'^#sh-dock button\.sh-live-one-mode.*\n@keyframes shLiveOneFlash.*\n', '', '1x1 dock css', flags=re.M)
sub(r'^#sh-live \.sh-live-one-result\{.*?^#sh-live \.sh-live-one-result-grid b\{.*?\}\n', '', '1x1 result css', flags=re.M | re.S)

old = """      if (key === 'live') b.title = 'Click: show/hide Live | Ctrl+click: toggle immediate 1×1 mode';
      b.onclick = event => {
        if (key === 'live') {
          if (event.ctrlKey) {
            stopLazyForModeSwitch('switched to 1×1');
            feature.lazy = false;
            const nextMode = toggleLiveOneByOneMode();
            feature.live = !!nextMode;
            savePanelStates();
            applyPanels();
            if (nextMode) setTimeout(() => liveSrc.focus(), 0);
            return;
          }

          if (live.oneByOne) {
            toggleLiveOneByOneMode();
            stopLazyForModeSwitch('switched to Live');
            feature.lazy = false;
            feature.live = true;
            savePanelStates();
            applyPanels();
            setTimeout(() => liveSrc.focus(), 0);
            return;
          }

          const opening = !feature.live;
          if (opening) {
            stopLazyForModeSwitch('switched to Live');
            feature.lazy = false;
          }
          feature.live = opening;
          savePanelStates();
          applyPanels();
          if (opening) setTimeout(() => live.sourceReady ? liveScan.focus() : liveSrc.focus(), 0);
          return;
        }
"""
new = """      b.onclick = () => {
        if (key === 'live') {
          const opening = !feature.live;
          if (opening) {
            stopLazyForModeSwitch('switched to Live');
            feature.lazy = false;
          }
          feature.live = opening;
          savePanelStates();
          applyPanels();
          if (opening) setTimeout(() => live.sourceReady ? liveScan.focus() : liveSrc.focus(), 0);
          return;
        }
"""
rep(old, new, 'dock live branch')

rep("    oneByOne:false,\n    oneInFlight:new Map(),\n    oneResult:null,\n    oneErrorToken:0,\n    oneErrorTimer:0,\n", '', '1x1 state')
rep("    '<div class=\"sh-live-one-result\" data-live-one-result></div>' +\n", '', '1x1 result dom')
rep("  const liveOneResult = $('[data-live-one-result]', livePanel);\n", '', '1x1 result ref')

sub(
    r"  function syncLiveModeUi\(\) \{.*?\n  function beginLiveRun\(\) \{",
    """  function syncLiveModeUi() {
    const dockButton = dockButtons.find(button => button.dataset.key === 'live');
    const title = $('.sh-title', livePanel);

    if (dockButton) dockButton.textContent = 'Live';
    if (title) title.textContent = `Live Lazy QTY 1 v${VERSION}`;
    setTextIfChanged(liveQueueLabel, 'Queued');
    if (liveDelay) {
      liveDelay.style.display = '';
      liveDelay.textContent = `Delay: ${live.delayEnabled ? 'YES' : 'NO'}`;
      liveDelay.classList.toggle('sh-on', live.delayEnabled);
      liveDelay.title = live.delayEnabled
        ? 'Artificial Live move pacing is ON (5–11 seconds).'
        : 'Artificial Live move pacing is OFF.';
    }
    setTextIfChanged(
      liveReady,
      live.delayEnabled
        ? 'QTY = 1 PER SCAN — PRECHECK snoops queued items immediately; duplicates merge; moves pace 5–11s apart.'
        : 'QTY = 1 PER SCAN — PRECHECK snoops queued items immediately; duplicates merge; NO ARTIFICIAL MOVE DELAY.'
    );
  }

  function deactivateLiveForModeSwitch(note='mode switched') {
    resetLive(note, false);
  }

  function beginLiveRun() {""",
    'mode functions',
    flags=re.S,
)

rep("    live.oneInFlight.clear();\n    live.oneResult = null;\n    clearTimeout(live.oneErrorTimer);\n    live.oneErrorTimer = 0;\n    live.oneErrorToken++;\n", '', 'begin 1x1 cleanup')
rep("  function setLiveFailureNotice(item, title, reason, mode=live.oneByOne ? '1x1' : 'live') {", "  function setLiveFailureNotice(item, title, reason, mode='live') {", 'failure mode default')
rep("    }, mode === '1x1' ? 8000 : 12000);", "    }, 12000);", 'failure timer')
sub(
    r"    const action = notice\.mode === '1x1'\n      \? '<b>AUTO-SKIPPED — NOTHING WAS FORCED\.</b><br>Scan the next item\.'\n      : '<b>AUTO-SKIPPED — NOTHING WAS FORCED\.</b><br>Live queue continues automatically\.';",
    "    const action = '<b>AUTO-SKIPPED — NOTHING WAS FORCED.</b><br>Live queue continues automatically.';",
    'failure action',
)

rep("    const queuedUnits = live.oneByOne ? live.oneInFlight.size : sumQty(live.queue);", "    const queuedUnits = sumQty(live.queue);", 'queued units')
rep("    const precheckedQueuedUnits = live.oneByOne ? 0 : live.queue.reduce(\n", "    const precheckedQueuedUnits = live.queue.reduce(\n", 'prechecked queued')
rep("    const precheckedCurrentUnits = !live.oneByOne && live.current?.preflightStatus ? itemQty(live.current) : 0;", "    const precheckedCurrentUnits = live.current?.preflightStatus ? itemQty(live.current) : 0;", 'prechecked current')
rep("    const precheckTotalUnits = live.oneByOne ? 0 : queuedUnits + currentUnits + expiryUnits;", "    const precheckTotalUnits = queuedUnits + currentUnits + expiryUnits;", 'precheck total')
rep("    const preflightIssues = live.oneByOne ? [] : liveQueuedPreflightIssues();", "    const preflightIssues = liveQueuedPreflightIssues();", 'preflight issues')
rep("      live.queue.length === 0 &&\n      live.oneInFlight.size === 0 &&\n", "      live.queue.length === 0 &&\n", 'idle state')
sub(
    r"    const state = live\.issue\n      \? 'BLOCKED — ACTION REQUIRED'\n      : live\.oneByOne && live\.oneInFlight\.size\n        \? `1×1 SENDING \$\{live\.oneInFlight\.size\}`\n        : live\.processing\n          \? 'PROCESSING'\n          : live\.running\n            \? live\.oneByOne \? '1×1 READY — SCAN ITEM' : 'READY — SCAN ITEM'\n            : live\.sourceReady\n              \? 'SOURCE READY — SCAN DESTINATION'\n              : live\.oneByOne \? '1×1 — SCAN SOURCE' : 'SCAN SOURCE';",
    """    const state = live.issue
      ? 'BLOCKED — ACTION REQUIRED'
      : live.processing
        ? 'PROCESSING'
        : live.running
          ? 'READY — SCAN ITEM'
          : live.sourceReady
            ? 'SOURCE READY — SCAN DESTINATION'
            : 'SCAN SOURCE';""",
    'live state',
)
sub(r"\n    const oneResult = live\.oneByOne \? live\.oneResult : null;.*?\n    const hardIssueHtml =", "\n    const hardIssueHtml =", '1x1 result render', flags=re.S)

old_history = """    if (live.oneByOne) {
      if (liveHistory.style.display !== 'none') liveHistory.style.display = 'none';
      if (liveHistory.innerHTML) liveHistory.innerHTML = '';
      liveHistoryToken = '';
    } else {
      if (liveHistory.style.display !== '') liveHistory.style.display = '';
      const historyToken = `${live.history.length}:${live.history[0]?.id || ''}`;
      if (historyToken !== liveHistoryToken) {
        liveHistoryToken = historyToken;
        liveHistory.innerHTML = live.history.slice(0, 14).map(item => {
          const ctx = item.ctx;
          return `<div class=\"sh-live-history-row\">✓ ${esc(item.code)} ×${esc(String(item.qty || 1))}` +
            (ctx?.fnsku ? ` &nbsp; | &nbsp; ${esc(ctx.fnsku)}` : '') +
            ` → ${esc(item.destination || live.dest)}</div>`;
        }).join('');
      }
    }
"""
new_history = """    if (liveHistory.style.display !== '') liveHistory.style.display = '';
    const historyToken = `${live.history.length}:${live.history[0]?.id || ''}`;
    if (historyToken !== liveHistoryToken) {
      liveHistoryToken = historyToken;
      liveHistory.innerHTML = live.history.slice(0, 14).map(item => {
        const ctx = item.ctx;
        return `<div class=\"sh-live-history-row\">✓ ${esc(item.code)} ×${esc(String(item.qty || 1))}` +
          (ctx?.fnsku ? ` &nbsp; | &nbsp; ${esc(ctx.fnsku)}` : '') +
          ` → ${esc(item.destination || live.dest)}</div>`;
      }).join('');
    }
"""
rep(old_history, new_history, 'history branch')
rep("      (live.processing || live.current || live.queue.length || live.oneInFlight.size)\n", "      (live.processing || live.current || live.queue.length)\n", 'working state')

cleanup = "    clearTimeout(live.oneErrorTimer);\n    live.oneErrorTimer = 0;\n    live.oneErrorToken++;\n    live.oneResult = null;\n"
rep(cleanup, '', 'reset/stop cleanup', count=2)
rep("    live.oneInFlight.clear();\n", '', 'inflight clears', count=3)
rep("      live.oneInFlight.size +\n", '', 'clear source pending')
rep("    for (const item of live.oneInFlight.values()) mark(item);\n", '', 'return abandon inflight')
rep("      if (live.running || live.sourceReady || live.current || live.datePending.length || live.issue || live.oneInFlight.size) return 'live';", "      if (live.running || live.sourceReady || live.current || live.datePending.length || live.issue) return 'live';", 'return mode')

rep("      if (live.oneByOne) retryOneByOneBlockedMove(live.current);\n      else retryLiveCurrentMove();", "      retryLiveCurrentMove();", 'destination retry')
rep("    live.note = live.oneByOne ? '1×1 immediate ready' : 'ready';", "    live.note = 'ready';", 'ready note')
rep("      if (!live.running || live.oneByOne || live.issue) return;", "      if (!live.running || live.issue) return;", 'failure continue')
rep("    if (!item || live.oneByOne || live.current === item) return false;", "    if (!item || live.current === item) return false;", 'autoskip')

sub(r"\n  function setOneByOneResult\(.*?\n  function finishLiveMoved\(item\) \{", "\n  function finishLiveMoved(item) {", 'dedicated 1x1 functions', flags=re.S)

rep("    live.note = live.oneByOne ? 'item skipped — 1×1 ready' : 'item skipped — queue continuing';", "    live.note = 'item skipped — queue continuing';", 'skip note')
rep("      if (!live.oneByOne) pumpLive();", "      pumpLive();", 'skip pump')

old_date_tail = """    live.error = '';
    live.note = unitCount > 1
      ? `parked ${ctx.asin || item.code} ×${unitCount} — date required; split to individual units`
      : live.oneByOne
        ? `expiry required for ${ctx.asin || item.code} — finish this item first`
        : `parked ${ctx.asin || item.code} — date required; continuing queue`;
    if (live.oneByOne) liveScan.disabled = true;
    renderLive();

    if (live.oneByOne) openNextLiveDatePicker();
    else setTimeout(openNextLiveDatePicker, 0);
"""
new_date_tail = """    live.error = '';
    live.note = unitCount > 1
      ? `parked ${ctx.asin || item.code} ×${unitCount} — date required; split to individual units`
      : `parked ${ctx.asin || item.code} — date required; continuing queue`;
    renderLive();

    setTimeout(openNextLiveDatePicker, 0);
"""
rep(old_date_tail, new_date_tail, 'date park')
rep("    if (!live.oneByOne && (live.processing || live.current || live.queue.length)) return;", "    if (live.processing || live.current || live.queue.length) return;", 'date gate')
rep("        if (live.oneByOne && live.running && currentLiveRun()) setTimeout(openNextLiveDatePicker, 0);\n", '', 'date cancel')
old_date_move = """      if (live.oneByOne) {
        item.status = 'MOVING_DATE';
        live.oneInFlight.set(item.id, item);
        live.note = `date saved for ${item.ctx.asin || item.code} — sending QTY 1`;
        renderLive();
        moveOneByOneResolved(item, item.ctx, chosen.finalExpirationMs);
      } else {
        item.status = 'QUEUED_DATE';
        live.queue.push(item);
        live.note = `date saved for ${item.ctx.asin || item.code} — queued after normal work`;
        renderLive();
        pumpLive();
      }
"""
new_date_move = """      item.status = 'QUEUED_DATE';
      live.queue.push(item);
      live.note = `date saved for ${item.ctx.asin || item.code} — queued after normal work`;
      renderLive();
      pumpLive();
"""
rep(old_date_move, new_date_move, 'date move')

sub(r"\n    if \(live\.oneByOne\) \{.*?\n    if \(live\.issue\) \{", "\n    if (live.issue) {", 'enqueue branch', flags=re.S)
rep("      if (live.running && !live.issue && !(live.oneByOne && live.datePending.length)) liveScan.focus();", "      if (live.running && !live.issue) liveScan.focus();", 'focus')
rep("      if (live.oneByOne) return;\n", '', 'delay guard')

forbidden = ['oneByOne', 'oneInFlight', 'oneResult', 'oneError', 'OneByOne', '1×1', 'sh-live-one', 'data-live-one-result']
leftovers = {token: text.count(token) for token in forbidden if token in text}
if leftovers:
    raise SystemExit(f'1x1 leftovers: {leftovers}')

required = [
    "const LOOKUP_CONCURRENCY = 5;",
    "const LIVE_LOOKUP_CONCURRENCY = 3;",
    'data-live-a="delay"',
    'function waitForLiveMovePace',
    'function scheduleLiveLookup',
    'function drainLiveLookups',
    'async function liveMoveCurrent',
    'async function processLiveCurrent',
    'async function pumpLive',
    'function enqueueLiveBarcode',
    'function parkLiveDateItem',
    'function retryLiveCurrentMove',
    'function blockLiveDestination',
]
missing = [token for token in required if token not in text]
if missing:
    raise SystemExit(f'missing normal Live invariants: {missing}')

path.write_text(text)
