# V2 -> V3 Evidence / Rebuild Matrix

This is **not** a porting checklist.

V2 files are evidence sources. V3 modules are rebuilt from required behavior, proven backend contracts, OBS evidence and accepted workflows. Historical implementation detail is not preserved by default.

| V2 file | V3 treatment | Target |
|---|---|---|
| AFT_Edit_SKU_Move.user.js | BEHAVIOR/API REFERENCE -> FRESH BUILD | AFT Suite |
| BWU2_Actions_Core.lib.js | CONTRACT REFERENCE -> FRESH CORE | core/api + core/identity + operation contracts |
| BWU2_Fleet_Core.lib.js | BEHAVIOR REFERENCE -> FRESH CORE | core runtime |
| BWU2_Observability_Core.user.js | DO NOT COPY; REDESIGN | OBS / telemetry |
| Bin_Check_Overlay.user.js | WORKFLOW REFERENCE -> FRESH BUILD | FCResearch Suite |
| Bind_Hierarchy_Queue.user.js | BEHAVIOR/API REFERENCE ONLY | Hierarchy Suite |
| Calm_Code.user.js | WORKFLOW REFERENCE -> SMALL FRESH BUILD | Utilities |
| Carton_PrEditor.user.js | WORKFLOW REFERENCE -> SMALL FRESH BUILD | Utilities |
| Diagnostics/Amazon_ASIN_Variation_Finder_TEST.user.js | DEAD | Do not port |
| Dropzone_Selector_Queue.user.js | WORKFLOW/API REFERENCE -> FRESH BUILD | MoveApp Suite |
| FCR_Data_Core.user.js | DATA CONTRACT REFERENCE -> FRESH BUILD | FCResearch Suite data module |
| FCResearch_Master.user.js | ROUTING/FEATURE REFERENCE -> FRESH SHELL | FCResearch Suite |
| FCResearch_RIVER_Ticket_Assistant.user.js | WORKFLOW REFERENCE -> FRESH BUILD | FCResearch Suite / RIVER route |
| FC_Lite.user.js | TOTE AUDIT BEHAVIOR REFERENCE -> FRESH BUILD | FCResearch Suite / Tote Audit |
| FNSKU_Mapping_Lookup.user.js | WORKFLOW/API REFERENCE -> FRESH BUILD | FNSKU Mapping |
| ISS_Console.user.js | UI/WORKFLOW REFERENCE -> FRESH BUILD | FCResearch Suite / ISS route |
| PO_Portal_Lite.user.js | WORKFLOW REFERENCE -> FRESH BUILD | PO Portal |
| SIM_Markdown_Toolbar.user.js | WORKFLOW REFERENCE -> SMALL FRESH BUILD | Utilities |
| Screenshot_Mode.user.js | BEHAVIOR REFERENCE -> SHARED CORE CAPABILITY | core/screenshot |
| Sideline_REBUILD_TEST.user.js | PROVEN BEHAVIOR BASELINE -> FRESH ENGINE | FCResearch Suite / Sideline |
| Stow_Andons_Helper.user.js | WORKFLOW/API REFERENCE -> FRESH BUILD | FCResearch Suite |
| Unbind_Hierarchy_Queue.user.js | V2 ONLY / DO NOT PORT | None |

## Explicitly dead / V2-only
- Retired pre-rebuild Sideline: never enters V3.
- Standalone V2 Unbind: never enters V3.
- Amazon AU ASIN Variation Finder diagnostic: never enters V3.

## Historical-code filter
Before carrying any V2 logic forward, answer all four:
1. What current workflow needs it?
2. What evidence shows the workaround is still required?
3. Can the underlying problem be solved directly in the fresh architecture?
4. Is there a smaller deterministic implementation?

If those answers are weak, the code stays dead in V2.

## Migration rule
A V2 feature is only retired after the fresh V3 equivalent has:
1. syntax/build validation,
2. isolated regression coverage,
3. live workflow confirmation where applicable,
4. no unresolved UNKNOWN mutation state,
5. user acceptance.
