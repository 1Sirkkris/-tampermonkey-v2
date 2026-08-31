from pathlib import Path

path = Path('Sideline_API_Move.user.js')
text = path.read_text(encoding='utf-8')

def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    text = text.replace(old, new, 1)

replace_once('// @name         MAIN v0.3.4 Sideline API Move TEST', '// @name         MAIN v0.3.5 Sideline API Move TEST', 'name version')
replace_once('// @version      0.3.4', '// @version      0.3.5', 'metadata version')
replace_once("const VERSION = '0.3.4';", "const VERSION = '0.3.5';", 'runtime version')

replace_once(
"""      const root = document.createElement('div');
      root.id = 'sh-og-expiry';
      root.innerHTML = '<div class=\"og-wrap\"></div>';
""",
"""      const root = document.createElement('div');
      root.id = 'sh-og-expiry';
      root.dataset.owner = owner === live ? 'live' : 'lazy';
      root.innerHTML = '<div class=\"og-wrap\"></div>';
""",
'API date owner')

replace_once(
"""  function stopLazyForReturn(note) {
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
""",
"""  function stopLazyForReturn(note) {
    const wasActive = !!(lazy.running || lazy.activeRun || lazy.predicant || lazy.damagePaused || lazy.dateResolve);
    const current = wasActive ? lazy.items[lazy.index] : null;
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
""",
'lazy active-only abandon')

start = text.index('  async function universalReturnToSource()')
end = text.index('  // Boot\n', start)
new_block = r'''  function returnModeFromButton(button) {
    const expiryRoot = button.closest?.('#sh-og-expiry');
    if (expiryRoot) {
      if (expiryRoot.dataset.owner === 'live' || expiryRoot.dataset.owner === 'lazy') return expiryRoot.dataset.owner;
      if (live.running || live.sourceReady || live.current || live.datePending.length || live.issue || live.oneInFlight.size) return 'live';
      if (lazy.running || lazy.activeRun || lazy.predicant || lazy.damagePaused || lazy.dateResolve) return 'lazy';
      if (shared.owner === 'qty' || shared.owner === 'qty-clear') return 'qty';
      return 'native';
    }

    if (button.closest?.('#sh-live')) return 'live';
    if (button.closest?.('#sh-lazy')) return 'lazy';
    if (button.closest?.('#sh-queue')) return 'queue';
    if (button.closest?.('#sh-scrub')) return 'scrub';
    if (button.closest?.('#sh-qty')) return 'qty';
    return 'native';
  }

  function returnSourceCodeForMode(mode) {
    if (mode === 'live') return clean(live.src || loadedSourceContainer());
    if (mode === 'lazy') return clean(lazy.src || loadedSourceContainer());
    return clean(loadedSourceContainer());
  }

  async function universalReturnToSource(mode='native') {
    if (returnSourceBusy) return;
    returnSourceBusy = true;

    const sourceCode = returnSourceCodeForMode(mode);
    const previousOwner = shared.owner;
    const dateOpen = !!$('#sh-og-expiry') || screen() === 'EXPIRY';

    if (dateOpen) {
      expiryRequestSeq++;
      nativeExpirySuppressedUntil = Date.now() + 5000;
    }

    if (mode === 'queue') {
      q.runSeq++;
      q.running = false;
      q.paused = false;
      renderQueue('returned to source');
    } else if (mode === 'scrub') {
      escapeEpoch++;
      feature.scrub = false;
      shared.scrubBusy = false;
      renderScrub();
    } else if (mode === 'qty') {
      qtyRequestSeq++;
      qtyClear.disabled = false;
      qtyStatus.textContent = 'Returning to source — quantity action cancelled';
    } else if (mode === 'live') {
      stopLiveForReturn('returned to source');
    } else if (mode === 'lazy') {
      stopLazyForReturn('returned to source — current item abandoned');
    }

    $('#sh-og-expiry')?.remove();
    $('#sh-invalid-toast')?.remove();
    shared.expiryBusy = dateOpen;
    shared.owner = 'return-source';

    savePanelStates();
    applyPanels();

    try {
      const outcome = await returnNativeToSourceContainer(sourceCode);
      const message = outcome
        ? `returned to ${outcome}`
        : 'helper escaped — native source control not found';

      if (mode === 'live') {
        live.note = message;
        renderLive();
      } else if (mode === 'lazy') {
        lazy.note = `${message} — queue/history preserved`;
        renderLazy();
      } else if (mode === 'queue') {
        renderQueue(message);
      } else if (mode === 'qty') {
        qtyStatus.textContent = message;
      } else if (mode === 'scrub') {
        scrubStatus.textContent = `OFF | ${message}`;
      }
    } catch (error) {
      const message = `RETURN TO SOURCE FAILED — ${error?.message || error}`;
      if (mode === 'live') {
        live.error = message;
        renderLive();
      } else if (mode === 'lazy') {
        lazy.error = message;
        renderLazy();
      } else if (mode === 'queue') {
        qError.textContent = message;
      } else if (mode === 'qty') {
        qtyStatus.textContent = message;
      } else if (mode === 'scrub') {
        scrubStatus.textContent = `OFF | ${message}`;
      }
    } finally {
      if (dateOpen) shared.expiryBusy = false;
      if (shared.owner === 'return-source') {
        const unrelatedOwner = previousOwner && ![
          mode,
          mode === 'queue' ? 'queue' : '',
          mode === 'scrub' ? 'scrub' : '',
          mode === 'qty' ? 'qty-clear' : ''
        ].includes(previousOwner) ? previousOwner : '';
        shared.owner = unrelatedOwner;
      }
      returnSourceBusy = false;
      screenDirty = true;
      requestPanelLayout();
      if (dateOpen) setTimeout(nativeExpiryTick, 5500);
    }
  }

  function handleUniversalReturnClick(event) {
    const button = event.target?.closest?.('[data-return-source]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    universalReturnToSource(returnModeFromButton(button));
  }

'''
text = text[:start] + new_block + text[end:]

path.write_text(text, encoding='utf-8')

readme = Path('README.md')
readme_text = readme.read_text(encoding='utf-8')
old = '| Sideline API Move | 0.3.4 |'
new = '| Sideline API Move | 0.3.5 |'
if readme_text.count(old) != 1:
    raise SystemExit(f'README version row expected once, found {readme_text.count(old)}')
readme.write_text(readme_text.replace(old, new, 1), encoding='utf-8')

final = path.read_text(encoding='utf-8')
for needle in [
    "const VERSION = '0.3.5';",
    "root.dataset.owner = owner === live ? 'live' : 'lazy';",
    'function returnModeFromButton(button)',
    "universalReturnToSource(returnModeFromButton(button));",
    "if (mode === 'live') {",
    "} else if (mode === 'lazy') {",
    "} else if (mode === 'queue') {",
    "} else if (mode === 'scrub') {",
    "} else if (mode === 'qty') {",
]:
    if needle not in final:
        raise SystemExit(f'missing required invariant: {needle}')
