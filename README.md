# Tampermonkey V2

Canonical source and Tampermonkey update host. The older `tampermonkey-scripts` repository is archive-only.

## Current fleet

| Script | Version | Install/update |
| --- | --- | --- |
| Carton PrEditor | 7.3 | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Carton_PrEditor.user.js) |
| SIM Markdown Toolbar | 5.1.5 | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/SIM_Markdown_Toolbar.user.js) |
| FNSKU Mapping Lookup | 1.3.3-test | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/FNSKU_Mapping_Lookup.user.js) |
| Sideline API Move | 0.3.1 | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Sideline_API_Move.user.js) |
| AFT Edit/SKU/Move | 0.9.12 | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/AFT_Edit_SKU_Move.user.js) |
| FCR Data Core | 0.2.11 | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/FCR_Data_Core.user.js) |
| FCResearch Master | 0.1.21 | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/FCResearch_Master.user.js) |
| FC-Lite | 0.1.59 | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/FC_Lite.user.js) |
| Stow Andons Helper | 5.5.1 | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Stow_Andons_Helper.user.js) |
| Bin Check Overlay | 7.4.3 | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Bin_Check_Overlay.user.js) |
| Dropzone Selector Queue | 0.2.18 | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Dropzone_Selector_Queue.user.js) |
| BWU2 Observability Core | 0.1.8 | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/BWU2_Observability_Core.user.js) |

Each stable `.user.js` file owns its permanent `@updateURL` and `@downloadURL`. Versioned `.txt` files remain as historical/diagnostic artifacts.

Rule: when duplicate uploads exist, prefer the stable `.user.js` file unless explicitly told otherwise. Diagnostic/usage-probe variants are kept separate from production/current scripts.

## Temporary diagnostics

| Script | Version | Purpose | Install/update |
| --- | --- | --- | --- |
| Amazon AU ASIN Variation Finder | 0.1.0-test | Right-click a product variation and reveal matching child ASINs from Amazon's loaded variation data, including unavailable swatches when exposed. | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Diagnostics/Amazon_ASIN_Variation_Finder_TEST.user.js) |
| FCResearch Section Probe | 0.2.0 | Map native section XHR/render timing and run one explicit, reversible Product request suppression test. | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Diagnostics/FCR_Section_Probe.user.js) |
| FCResearch → RIVER Ticket Assistant | 0.3.1 | Restore Hazmat N/A/L0 payload capture and the historical RIVER option-driving sequence using the current workflow ID; keep Related TTs, information verification and Create Issue manual pending live validation. | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/FCResearch_RIVER_Ticket_Assistant.user.js) |
| RIVER Workflow Observability | 0.1.0 | Capture RIVER inputs, navigation and fetch/XHR request/response shape while redacting secrets and fingerprinting identifiers. | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Diagnostics/RIVER_Observability_Capture.user.js) |
