# V2 -> V3 Migration Matrix

| V2 file | V3 disposition | Target |
|---|---|---|
| AFT_Edit_SKU_Move.user.js | PORT / REFACTOR | AFT Suite |
| BWU2_Actions_Core.lib.js | REBUILD AS MODULES | core/api + core/identity + operation contracts |
| BWU2_Fleet_Core.lib.js | REBUILD AS MODULES | core runtime |
| BWU2_Observability_Core.user.js | DO NOT COPY; REDESIGN | OBS / telemetry |
| Bin_Check_Overlay.user.js | PORT / REFACTOR | FCResearch Suite |
| Bind_Hierarchy_Queue.user.js | PORT AS CANONICAL | Hierarchy Suite |
| Calm_Code.user.js | PORT SMALL | Utilities |
| Carton_PrEditor.user.js | PORT SMALL; API rework optional later | Utilities |
| Diagnostics/Amazon_ASIN_Variation_Finder_TEST.user.js | DEAD | Do not port |
| Dropzone_Selector_Queue.user.js | PORT / REFACTOR | MoveApp Suite |
| FCR_Data_Core.user.js | PORT / REFACTOR | FCResearch Suite data module |
| FCResearch_Master.user.js | REBUILD AS SHELL/ROUTER | FCResearch Suite |
| FCResearch_RIVER_Ticket_Assistant.user.js | PORT / REFACTOR | FCResearch Suite / RIVER route |
| FC_Lite.user.js | PORT / REFACTOR | FCResearch Suite / Tote Audit |
| FNSKU_Mapping_Lookup.user.js | PORT | FNSKU Mapping |
| ISS_Console.user.js | REBUILD / INTEGRATE | FCResearch Suite / ISS route |
| PO_Portal_Lite.user.js | PORT | PO Portal |
| SIM_Markdown_Toolbar.user.js | PORT SMALL | Utilities |
| Screenshot_Mode.user.js | REBUILD AS SHARED CAPABILITY | core/screenshot |
| Sideline_REBUILD_TEST.user.js | PORT AS BASELINE | FCResearch Suite / Sideline engine |
| Stow_Andons_Helper.user.js | PORT / SPLIT SHARED ACTIONS | FCResearch Suite |
| Unbind_Hierarchy_Queue.user.js | V2 ROLLBACK ONLY; DO NOT PORT | retire after merged Hierarchy proven |

## Explicitly dead
- Retired pre-rebuild Sideline: not part of the V3 source set.
- Amazon AU ASIN Variation Finder diagnostic: not part of V3.

## Migration rule
A V2 feature is only retired after the V3 equivalent has:
1. syntax/build validation,
2. isolated regression coverage,
3. live workflow confirmation where applicable,
4. no unresolved UNKNOWN mutation state,
5. user acceptance.
