from pathlib import Path

path = Path('Sideline_API_Move.user.js')
text = path.read_text(encoding='utf-8')

def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    text = text.replace(old, new, 1)

replace_once('// @name         MAIN v0.3.5 Sideline API Move TEST', '// @name         MAIN v0.3.6 Sideline API Move TEST', 'name version')
replace_once('// @version      0.3.5', '// @version      0.3.6', 'metadata version')
replace_once("const VERSION = '0.3.5';", "const VERSION = '0.3.6';", 'runtime version')

replace_once(
"""        } catch (error) {
          result = error?.name === 'AbortError'
            ? { kind:'aborted' }
            : { kind:'error', error };
        } finally {
""",
"""        } catch (error) {
          result = error?.name === 'AbortError'
            ? { kind:'aborted' }
            : isAllowedOverageResponse(error?.payload)
              ? { kind:'response', response:error.payload, overage:true }
              : { kind:'error', error };
        } finally {
""",
'Live preflight HTTP overage')

replace_once(
"""    } catch (error) {
      if (error?.name === 'AbortError') return;
      const payloadReason = moveReason(error?.payload);
      const reason = payloadReason !== 'EMPTY MOVE RESPONSE'
        ? payloadReason
        : (error?.message || 'MOVE API ERROR');
      showOneByOneError(
        item,
        reason,
        hasHazmat(error?.payload) ? 'HAZMAT — ITEM NOT MOVED' : 'MOVE API ERROR'
      );
      return;
    }

    if (!currentLiveRun(run)) return;
""",
"""    } catch (error) {
      if (error?.name === 'AbortError') return;
      if (isAllowedOverageResponse(error?.payload)) {
        response = error.payload;
      } else {
        const payloadReason = moveReason(error?.payload);
        const reason = payloadReason !== 'EMPTY MOVE RESPONSE'
          ? payloadReason
          : (error?.message || 'MOVE API ERROR');
        showOneByOneError(
          item,
          reason,
          hasHazmat(error?.payload) ? 'HAZMAT — ITEM NOT MOVED' : 'MOVE API ERROR'
        );
        return;
      }
    }

    if (!currentLiveRun(run)) return;
""",
'1x1 move HTTP overage')

replace_once(
"""    if (moveOk(response)) {
      finishOneByOneMoved(item);
      return;
    }
""",
"""    if (moveOk(response)) {
      item.acceptedOverage = isAllowedOverageResponse(response);
      finishOneByOneMoved(item);
      if (item.acceptedOverage) live.note = 'OVERAGE OK — moved QTY 1 — ready for next scan';
      renderLive();
      return;
    }
""",
'1x1 overage success note')

replace_once(
"""    } catch (error) {
      if (error?.name === 'AbortError') return;
      showOneByOneError(item, error?.message || 'SCAN API ERROR', 'SCAN API ERROR');
      return;
    }

    if (!currentLiveRun(run)) return;
""",
"""    } catch (error) {
      if (error?.name === 'AbortError') return;
      if (isAllowedOverageResponse(error?.payload)) {
        response = error.payload;
      } else {
        showOneByOneError(item, error?.message || 'SCAN API ERROR', 'SCAN API ERROR');
        return;
      }
    }

    if (!currentLiveRun(run)) return;
""",
'1x1 scan HTTP overage')

replace_once(
"""    } catch (error) {
      if (error?.name === 'AbortError') return false;

      live.nextMoveAt = Date.now() + randomLiveMoveDelayMs();

      const payloadReason = moveReason(error?.payload);
      const reason = payloadReason !== 'EMPTY MOVE RESPONSE'
        ? payloadReason
        : (error?.message || 'MOVE API ERROR');
      failLiveItem(
        item,
        hasHazmat(error?.payload) ? 'HAZMAT — ITEM NOT MOVED' : 'MOVE API ERROR — ITEM NOT MOVED',
        reason,
        ctx
      );
      return false;
    }

    if (!currentLiveRun(run)) return false;
""",
"""    } catch (error) {
      if (error?.name === 'AbortError') return false;

      live.nextMoveAt = Date.now() + randomLiveMoveDelayMs();

      if (isAllowedOverageResponse(error?.payload)) {
        response = error.payload;
      } else {
        const payloadReason = moveReason(error?.payload);
        const reason = payloadReason !== 'EMPTY MOVE RESPONSE'
          ? payloadReason
          : (error?.message || 'MOVE API ERROR');
        failLiveItem(
          item,
          hasHazmat(error?.payload) ? 'HAZMAT — ITEM NOT MOVED' : 'MOVE API ERROR — ITEM NOT MOVED',
          reason,
          ctx
        );
        return false;
      }
    }

    if (!currentLiveRun(run)) return false;
""",
'Live move HTTP overage')

replace_once(
"""    if (moveOk(response)) {
      finishLiveMoved(item);
      return true;
    }
""",
"""    if (moveOk(response)) {
      item.acceptedOverage = isAllowedOverageResponse(response);
      finishLiveMoved(item);
      if (item.acceptedOverage) {
        live.note = `OVERAGE OK — moved ${itemQty(item)} unit${itemQty(item) === 1 ? '' : 's'} — ready for next scan`;
        renderLive();
      }
      return true;
    }
""",
'Live overage success note')

replace_once(
"""  function resolveItem(response, barcode) {
    const type = clean(response?.['@type']);
    if (!response || type === 'InvalidBarcodeResponse' || response.success === false) {
      return { ok:false, invalid:type === 'InvalidBarcodeResponse', type:type || 'Unknown' };
    }
""",
"""  function isOverageLabel(value) {
    return /\\boverage(?:s)?\\b/i.test(clean(value));
  }

  function responseProblemLabels(response) {
    return (Array.isArray(response?.problems) ? response.problems : [])
      .filter(Boolean)
      .map(problem => clean(
        problem?.description ||
        problem?.message ||
        problem?.reason ||
        problem?.code ||
        problem?.['@type'] ||
        ''
      ))
      .filter(Boolean);
  }

  function isAllowedOverageResponse(response) {
    if (!response || typeof response !== 'object') return false;

    const type = clean(response?.['@type']);
    if (type === 'InvalidBarcodeResponse' || type === 'RequestMultipleBarcodesResponse') return false;
    if (hasHazmat(response) || hasPredicant(response) || isDamagedDestinationResponse(response)) return false;

    const filter = response?.filterResult;
    const filterReason = clean(
      filter?.reason?.type ||
      filter?.reason?.description ||
      filter?.reason?.message ||
      filter?.reason?.['@type'] ||
      filter?.filterType ||
      ''
    );
    if (filter?.compatible === false && !isOverageLabel(filterReason)) return false;

    const problems = responseProblemLabels(response);
    if (problems.some(label => !isOverageLabel(label))) return false;

    const explicitLabels = [
      type,
      response?.message,
      response?.description,
      response?.reason,
      response?.errorMessage,
      response?.errorCode,
      filterReason,
      ...problems
    ].map(clean).filter(Boolean);

    const itemNotInSource = type === 'ItemNotInContainerResponse';
    const explicitOverage = explicitLabels.some(isOverageLabel);
    if (!itemNotInSource && !explicitOverage) return false;

    const fatalText = explicitLabels.join(' ');
    if (/hazmat|dangerous.?goods|invalid\\s+barcode|incompatib|damaged|predicant|customer\\s*bound/i.test(fatalText)) {
      return false;
    }

    return true;
  }

  function resolveItem(response, barcode) {
    const type = clean(response?.['@type']);
    const allowedOverage = isAllowedOverageResponse(response);
    if (!response || type === 'InvalidBarcodeResponse' || (response.success === false && !allowedOverage)) {
      return { ok:false, invalid:type === 'InvalidBarcodeResponse', type:type || 'Unknown' };
    }
""",
'Overage classifier and scan acceptance')

replace_once(
"""      dateDetail:sku.datelotDetail || {},
      notInSource:type === 'ItemNotInContainerResponse' || records.every(record => Number(record.quantity) === 0)
    };
  }
""",
"""      dateDetail:sku.datelotDetail || {},
      overage:allowedOverage,
      notInSource:type === 'ItemNotInContainerResponse' || records.every(record => Number(record.quantity) === 0)
    };
  }
""",
'Overage context flag')

replace_once(
"""  function moveOk(response) {
    if (!response || response.success !== true) return false;
    if (response.filterResult?.compatible === false) return false;
    if (hasHazmat(response)) return false;
    if (hasMoveProblems(response)) return false;
    if (hasPredicant(response)) return false;

    return true;
  }
""",
"""  function moveOk(response) {
    if (isAllowedOverageResponse(response)) return true;
    if (!response || response.success !== true) return false;
    if (response.filterResult?.compatible === false) return false;
    if (hasHazmat(response)) return false;
    if (hasMoveProblems(response)) return false;
    if (hasPredicant(response)) return false;

    return true;
  }
""",
'Overage move acceptance')

replace_once(
"""  function moveReason(response) {
    if (!response) return 'EMPTY MOVE RESPONSE';
    if (hasHazmat(response)) return 'HAZMAT';
""",
"""  function moveReason(response) {
    if (!response) return 'EMPTY MOVE RESPONSE';
    if (hasHazmat(response)) return 'HAZMAT';
    if (isAllowedOverageResponse(response)) return 'OVERAGE';
""",
'Overage move reason')

replace_once(
"""      } catch (error) {
        if (runWasCancelled(error, run)) return false;
        item.status = 'FAILED';
        item.failReason = `MOVE API ERROR: ${error?.message || error}`;
        lazy.errors++;
        lazy.error = `${ctx.barcode} — ${item.failReason} — NOT MOVED`;
        renderLazy();
        return false;
      }

      if (hasPredicant(response) && !moveOk(response)) {
""",
"""      } catch (error) {
        if (runWasCancelled(error, run)) return false;
        if (isAllowedOverageResponse(error?.payload)) {
          response = error.payload;
        } else {
          item.status = 'FAILED';
          item.failReason = `MOVE API ERROR: ${error?.message || error}`;
          lazy.errors++;
          lazy.error = `${ctx.barcode} — ${item.failReason} — NOT MOVED`;
          renderLazy();
          return false;
        }
      }

      if (hasPredicant(response) && !moveOk(response)) {
""",
'Lazy move HTTP overage')

replace_once(
"""      item.status = 'MOVED';
      lazy.error = '';
      renderLazy();
      return true;
""",
"""      item.status = 'MOVED';
      item.acceptedOverage = isAllowedOverageResponse(response);
      lazy.error = '';
      if (item.acceptedOverage) lazy.note = `OVERAGE OK — moved ${totalQty} unit${totalQty === 1 ? '' : 's'} — continuing`;
      renderLazy();
      return true;
""",
'Lazy overage success note')

replace_once(
"""    } catch (error) {
      if (runWasCancelled(error, run)) return { kind:'aborted' };
      item.status = 'FAILED';
      item.failReason = 'SCAN API ERROR';
      lazy.errors++;
      lazy.error = `${item.code} — SCAN API ERROR — NOT MOVED`;
      renderLazy();
      return { kind:'failed' };
    }

    if (!currentLazyRun(run)) return { kind:'aborted' };
""",
"""    } catch (error) {
      if (runWasCancelled(error, run)) return { kind:'aborted' };
      if (isAllowedOverageResponse(error?.payload)) {
        response = error.payload;
      } else {
        item.status = 'FAILED';
        item.failReason = 'SCAN API ERROR';
        lazy.errors++;
        lazy.error = `${item.code} — SCAN API ERROR — NOT MOVED`;
        renderLazy();
        return { kind:'failed' };
      }
    }

    if (!currentLazyRun(run)) return { kind:'aborted' };
""",
'Lazy scan HTTP overage')

path.write_text(text, encoding='utf-8')

readme = Path('README.md')
readme_text = readme.read_text(encoding='utf-8')
old = '| Sideline API Move | 0.3.5 |'
new = '| Sideline API Move | 0.3.6 |'
if readme_text.count(old) != 1:
    raise SystemExit(f'README version row expected once, found {readme_text.count(old)}')
readme.write_text(readme_text.replace(old, new, 1), encoding='utf-8')

final = path.read_text(encoding='utf-8')
for needle in [
    "const VERSION = '0.3.6';",
    'function isAllowedOverageResponse(response)',
    "const itemNotInSource = type === 'ItemNotInContainerResponse';",
    'if (isAllowedOverageResponse(response)) return true;',
    "if (isAllowedOverageResponse(response)) return 'OVERAGE';",
    "? { kind:'response', response:error.payload, overage:true }",
    "item.acceptedOverage = isAllowedOverageResponse(response);",
    "OVERAGE OK — moved",
]:
    if needle not in final:
        raise SystemExit(f'missing required invariant: {needle}')
