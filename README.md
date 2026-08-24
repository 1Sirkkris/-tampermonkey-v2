# Tampermonkey V2

Canonical source and Tampermonkey update host. The older `tampermonkey-scripts` repository is archive-only.

## Current fleet

| Script | Version | Install/update |
| --- | --- | --- |
| Carton PrEditor | 7.2 | [Open](./Carton_PrEditor.user.js) |
| SIM Markdown Toolbar | 5.1.0 | [Open](./SIM_Markdown_Toolbar.user.js) |
| FNSKU Mapping Lookup | 1.3.0-test | [Open](./FNSKU_Mapping_Lookup.user.js) |
| Sideline API Move | 0.2.2 | [Open](./Sideline_API_Move.user.js) |
| AFT Edit/SKU/Move | 0.9.8 | [Open](./AFT_Edit_SKU_Move.user.js) |
| FCR Data Core | 0.2.9 | [Open](./FCR_Data_Core.user.js) |
| FCResearch Master | 0.1.10 | [Open](./FCResearch_Master.user.js) |
| Stow Andons Helper | 5.5.1 | [Open](./Stow_Andons_Helper.user.js) |
| Bin Check Overlay | 7.4.1 | [Open](./Bin_Check_Overlay.user.js) |
| Dropzone Selector Queue | 0.2.17 | [Open](./Dropzone_Selector_Queue.user.js) |
| BWU2 Observability Core | 0.1.2 | [Open](./BWU2_Observability_Core.user.js) |

Each stable `.user.js` file owns its permanent `@updateURL` and `@downloadURL`. Versioned `.txt` files remain as historical/diagnostic artifacts.

FC-Lite is intentionally excluded from the stable updater set pending the next runtime revision.

Rule: when duplicate uploads exist, prefer the stable `.user.js` file unless explicitly told otherwise. Diagnostic/usage-probe variants are kept separate from production/current scripts.
