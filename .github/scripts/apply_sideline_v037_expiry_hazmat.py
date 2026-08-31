from pathlib import Path

path = Path('Sideline_API_Move.user.js')
text = path.read_text(encoding='utf-8')

def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    text = text.replace(old, new, 1)

def replace_all(old: str, new: str, expected: int, label: str) -> None:
    global text
    count = text.count(old)
    if count != expected:
        raise SystemExit(f'{label}: expected {expected} matches, found {count}')
    text = text.replace(old, new)

replace_once('// @name         MAIN v0.3.6 Sideline API Move TEST', '// @name         MAIN v0.3.7 Sideline API Move TEST', 'name version')
replace_once('// @version      0.3.6', '// @version      0.3.7', 'metadata version')
replace_once("const VERSION = '0.3.6';", "const VERSION = '0.3.7';", 'runtime version')

# Return-to-source is a workflow escape only for Lazy / Live / 1x1.
replace_once(
"""  function panel(id, title, key) {
    const root = document.createElement('div');
    root.id = id;
    root.className = 'sh-panel';
    root.innerHTML = `<div class="sh-title">${title}</div><button type="button" class="sh-btn sh-return-source" data-return-source>↩ Return to Source</button>`;
    root.style.display = 'none';
    document.body.appendChild(root);
    panels[key] = root;
    return root;
  }
""",
"""  function panel(id, title, key) {
    const root = document.createElement('div');
    root.id = id;
    root.className = 'sh-panel';
    const returnSource = key === 'lazy' || key === 'live'
      ? '<button type="button" class="sh-btn sh-return-source" data-return-source>↩ Return to Source</button>'
      : '';
    root.innerHTML = `<div class="sh-title">${title}</div>${returnSource}`;
    root.style.display = 'none';
    document.body.appendChild(root);
    panels[key] = root;
    return root;
  }
""",
'panel return-source scope')

# Native/QTY expiry helper is not one of the three scoped workflows.
replace_once(
"""        `<div class="og-footer"><button data-a="pao">PAO +900 DAYS &nbsp; ${dateLabel(paoDateMs())}</button><button type="button" class="og-return-source" data-return-source>↩ RETURN TO SOURCE</button></div>`;
""",
"""        `<div class="og-footer og-footer-single"><button data-a="pao">PAO +900 DAYS &nbsp; ${dateLabel(paoDateMs())}</button></div>`;
""",
'native expiry return-source removal')
replace_once(
"""#sh-og-expiry .og-footer{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:7px}.og-footer button{width:100%;height:48px!important;background:#7c3aed!important;color:#fff!important;border-color:#6d28d9!important;font-size:15px!important}.og-footer .production-confirm{background:#146eb4!important;border-color:#0f5c99!important}.og-footer .og-return-source{background:#eff6ff!important;color:#0f3d73!important;border:2px solid #146eb4!important}
""",
"""#sh-og-expiry .og-footer{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:7px}.og-footer.og-footer-single{grid-template-columns:1fr}.og-footer button{width:100%;height:48px!important;background:#7c3aed!important;color:#fff!important;border-color:#6d28d9!important;font-size:15px!important}.og-footer .production-confirm{background:#146eb4!important;border-color:#0f5c99!important}.og-footer .og-return-source{background:#eff6ff!important;color:#0f3d73!important;border:2px solid #146eb4!important}
""",
'native expiry footer layout')

# Product metadata may say Hazmat even when Sideline can process the item after expiry.
# Only a rejection-shaped workflow/move response with an explicit Hazmat reason is a hard Hazmat failure.
replace_once(
"""  function hasMoveProblems(response) {
""",
"""  function isHazmatRejectionResponse(response) {
    if (!response || typeof response !== 'object') return false;

    const filter = response.filterResult || {};
    const filterReason = filter.reason || {};
    const responseReason = response.reason || {};
    const problems = (Array.isArray(response.problems) ? response.problems : []).filter(Boolean);
    const labels = [
      response.message,
      response.description,
      response.errorMessage,
      response.errorCode,
      typeof response.reason === 'string' ? response.reason : '',
      responseReason.type,
      responseReason.description,
      responseReason.message,
      responseReason['@type'],
      filterReason.type,
      filterReason.description,
      filterReason.message,
      filterReason['@type'],
      filter.filterType,
      ...problems.flatMap(problem => [
        problem?.description,
        problem?.message,
        problem?.reason,
        problem?.code,
        problem?.['@type']
      ])
    ].map(clean).filter(Boolean);

    if (!labels.some(label => /hazmat|dangerous.?goods/i.test(label))) return false;

    const responseType = clean(response?.['@type']);
    return !!(
      response.success === false ||
      filter.compatible === false ||
      problems.length ||
      response.errorMessage ||
      response.errorCode ||
      /error|reject|incompat|filter/i.test(responseType)
    );
  }

  function hasMoveProblems(response) {
""",
'hazmat rejection classifier')

replace_once(
"if (hasHazmat(response) || hasPredicant(response) || isDamagedDestinationResponse(response)) return false;",
"if (isHazmatRejectionResponse(response) || hasPredicant(response) || isDamagedDestinationResponse(response)) return false;",
'overage hazmat gate')
replace_once(
"""    if (hasHazmat(response)) return false;
""",
"""    if (isHazmatRejectionResponse(response)) return false;
""",
'moveOk hazmat gate')
replace_once(
"""    if (hasHazmat(response)) return 'HAZMAT';
""",
"""    if (isHazmatRejectionResponse(response)) return 'HAZMAT';
""",
'moveReason hazmat gate')

# Scan/preflight metadata must never hard-skip merely because the product itself is Hazmat-tagged.
replace_once(
"""    // Live lookups run ahead of processing. Hazmat must be rejected here before an
    // item can ever be labelled READY and take the fast prechecked move path.
    if (hasHazmat(result.response)) {
      item.preflightStatus = 'ISSUE';
      item.preflightIssue = { kind:'hazmat', title:'HAZMAT — ITEM NOT MOVED', reason:'HAZMAT' };

      if (!autoSkipQueuedLiveItem(item, 'HAZMAT — ITEM NOT MOVED', 'HAZMAT')) {
        renderLive();
      }
      return;
    }

""",
"""    // Product hazard metadata is informational here. Expiry/manual requirements
    // are resolved first; a real Hazmat rejection is decided only by the move response.
""",
'Live preflight metadata Hazmat skip removal')

replace_once(
"""    // Fail closed before any state-changing move request when scan metadata already
    // identifies the item as Hazmat / dangerous goods.
    if (hasHazmat(response)) {
      showOneByOneError(item, 'HAZMAT', 'HAZMAT — ITEM NOT MOVED');
      return;
    }

    if (ctx.dateType === 'EXPIRATION_DATE' || ctx.dateType === 'PRODUCTION_DATE') {
""",
"""    // Expiry/manual data requirements take precedence over product Hazmat metadata.
    // A Hazmat hard failure is only raised if the move/workflow response rejects for Hazmat.
    if (ctx.dateType === 'EXPIRATION_DATE' || ctx.dateType === 'PRODUCTION_DATE') {
""",
'1x1 expiry precedence')

replace_once(
"""    // Normal Live also fails closed before /api/move-items when scan metadata says
    // Hazmat. The failed barcode is surfaced while the rest of Live can continue.
    if (hasHazmat(response)) {
      failLiveItem(item, 'HAZMAT — ITEM NOT MOVED', 'HAZMAT', ctx);
      return;
    }

    if (ctx.dateType === 'EXPIRATION_DATE' || ctx.dateType === 'PRODUCTION_DATE') {
""",
"""    // Product Hazmat metadata alone is not a rejection. Handle expiry first and
    // let the actual move/workflow response decide whether Hazmat blocks processing.
    if (ctx.dateType === 'EXPIRATION_DATE' || ctx.dateType === 'PRODUCTION_DATE') {
""",
'Live expiry precedence')

replace_all(
"hasHazmat(error?.payload) ? 'HAZMAT — ITEM NOT MOVED' : 'MOVE API ERROR'",
"isHazmatRejectionResponse(error?.payload) ? 'HAZMAT — ITEM NOT MOVED' : 'MOVE API ERROR'",
1,
'1x1 HTTP Hazmat title')
replace_all(
"hasHazmat(error?.payload) ? 'HAZMAT — ITEM NOT MOVED' : 'MOVE API ERROR — ITEM NOT MOVED'",
"isHazmatRejectionResponse(error?.payload) ? 'HAZMAT — ITEM NOT MOVED' : 'MOVE API ERROR — ITEM NOT MOVED'",
1,
'Live HTTP Hazmat title')
replace_all(
"reason === 'HAZMAT' || hasHazmat(response) || /destination incompatible/i.test(reason)",
"reason === 'HAZMAT' || isHazmatRejectionResponse(response) || /destination incompatible/i.test(reason)",
2,
'move response Hazmat conditions')
replace_all(
"reason === 'HAZMAT' || hasHazmat(response) ? 'HAZMAT' : (reason || 'DESTINATION INCOMPATIBLE')",
"reason === 'HAZMAT' || isHazmatRejectionResponse(response) ? 'HAZMAT' : (reason || 'DESTINATION INCOMPATIBLE')",
2,
'move response Hazmat reason labels')
replace_all(
"reason === 'HAZMAT' || hasHazmat(response) ? 'HAZMAT — ITEM NOT MOVED' : 'ITEM / DESTINATION INCOMPATIBLE'",
"reason === 'HAZMAT' || isHazmatRejectionResponse(response) ? 'HAZMAT — ITEM NOT MOVED' : 'ITEM / DESTINATION INCOMPATIBLE'",
1,
'1x1 move response Hazmat title')
replace_all(
"reason === 'HAZMAT' || hasHazmat(response) ? 'HAZMAT — ITEM NOT MOVED' : 'ITEM / DESTINATION INCOMPATIBLE'",
"reason === 'HAZMAT' || isHazmatRejectionResponse(response) ? 'HAZMAT — ITEM NOT MOVED' : 'ITEM / DESTINATION INCOMPATIBLE'",
1,
'Live move response Hazmat title')

# Overage remains accepted exactly as before, but it is routine workflow and gets no special UI message.
replace_once(
"""    if (moveOk(response)) {
      item.acceptedOverage = isAllowedOverageResponse(response);
      finishOneByOneMoved(item);
      if (item.acceptedOverage) live.note = 'OVERAGE OK — moved QTY 1 — ready for next scan';
      renderLive();
      return;
    }
""",
"""    if (moveOk(response)) {
      finishOneByOneMoved(item);
      return;
    }
""",
'1x1 silent overage')
replace_once(
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
"""    if (moveOk(response)) {
      finishLiveMoved(item);
      return true;
    }
""",
'Live silent overage')
replace_once(
"""      item.status = 'MOVED';
      item.acceptedOverage = isAllowedOverageResponse(response);
      lazy.error = '';
      if (item.acceptedOverage) lazy.note = `OVERAGE OK — moved ${totalQty} unit${totalQty === 1 ? '' : 's'} — continuing`;
      renderLazy();
      return true;
""",
"""      item.status = 'MOVED';
      lazy.error = '';
      renderLazy();
      return true;
""",
'Lazy silent overage')

path.write_text(text, encoding='utf-8')

readme = Path('README.md')
readme_text = readme.read_text(encoding='utf-8')
old = '| Sideline API Move | 0.3.6 |'
new = '| Sideline API Move | 0.3.7 |'
if readme_text.count(old) != 1:
    raise SystemExit(f'README version row expected once, found {readme_text.count(old)}')
readme.write_text(readme_text.replace(old, new, 1), encoding='utf-8')

final = path.read_text(encoding='utf-8')
for needle in [
    "const VERSION = '0.3.7';",
    'function isHazmatRejectionResponse(response)',
    "if (ctx.dateType === 'EXPIRATION_DATE' || ctx.dateType === 'PRODUCTION_DATE')",
    'isHazmatRejectionResponse(response)',
    "key === 'lazy' || key === 'live'",
    'og-footer og-footer-single',
]:
    if needle not in final:
        raise SystemExit(f'missing v0.3.7 invariant: {needle}')

for forbidden in [
    'OVERAGE OK —',
    "showOneByOneError(item, 'HAZMAT', 'HAZMAT — ITEM NOT MOVED');",
    "autoSkipQueuedLiveItem(item, 'HAZMAT — ITEM NOT MOVED', 'HAZMAT')",
    "failLiveItem(item, 'HAZMAT — ITEM NOT MOVED', 'HAZMAT', ctx);",
]:
    if forbidden in final:
        raise SystemExit(f'forbidden stale behavior remains: {forbidden}')
