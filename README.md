# Tampermonkey V2

Canonical source and Tampermonkey update host. The older `tampermonkey-scripts` repository is archive-only.

## Current fleet

| Script | Version | Install/update |
| --- | --- | --- |
| Carton PrEditor | 7.4 | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Carton_PrEditor.user.js) |
| SIM Markdown Toolbar | 5.1.6 | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/SIM_Markdown_Toolbar.user.js) |
| FNSKU Mapping Lookup | 1.4.1-test | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/FNSKU_Mapping_Lookup.user.js) |
| Sideline API Move | 0.3.38 | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Sideline_API_Move.user.js) |
| AFT Edit/SKU/Move | 0.9.37 | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/AFT_Edit_SKU_Move.user.js) |
| ISS Console | 0.1.27 | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/ISS_Console.user.js) |
| FCR Data Core | 0.2.29 | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/FCR_Data_Core.user.js) |
| FCResearch Master | 0.1.60 | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/FCResearch_Master.user.js) |
| FC-Lite | 0.1.73 | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/FC_Lite.user.js) |
| Stow Andons Helper | 5.5.7 | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Stow_Andons_Helper.user.js) |
| Bin Check Overlay | 7.4.5 | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Bin_Check_Overlay.user.js) |
| Dropzone Selector Queue | 0.2.19 | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Dropzone_Selector_Queue.user.js) |
| BWU2 Observability Core | 0.1.25 | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/BWU2_Observability_Core.user.js) |
| Calm Code | 1.3.2 | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Calm_Code.user.js) |
| Unbind Hierarchy Queue | 1.0.6 | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Unbind_Hierarchy_Queue.user.js) |
| Screenshot Mode | 0.1.3 | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Screenshot_Mode.user.js) |

Tampermonkey manager titles are intentionally version-free via `@name:en`; legacy base `@name` values stay frozen as update identity. Every active fleet script renders a shared low-profile runtime version stamp at the bottom of the page, so the actually running version is visible immediately after reload.

Each stable `.user.js` file owns its permanent `@updateURL` and `@downloadURL`. Git history is the archive; `main` keeps one canonical active source per deployed script plus diagnostics that are still actively useful.

Do not keep versioned full-script snapshots, duplicate source copies, completed probes or superseded implementations on `main`. Temporary diagnostics stay separate from the active fleet and should be removed after their question is answered unless they remain intentionally useful.

## Temporary diagnostics

| Script | Version | Purpose | Install/update |
| --- | --- | --- | --- |
| AFT Super Overlay | 0.4.2 | Immediate adaptive Edit/Move mode switcher using AFT's native selector. Checkmarks reflect AFT's confirmed mode; MoveItems modes remain distinct from the separate MoveContainer app. | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Diagnostics/AFT_Super_Overlay_TEST.user.js) |
| AFT UI State Logger | 0.1.2 | Read-only same-tab trace for AFT mode switches, DOM states, form actions, XHR/fetch results and errors. Visible MARK, COPY LOG, DOWNLOAD and CLEAR controls. | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Diagnostics/AFT_UI_State_Logger_TEST.user.js) |
| Amazon AU ASIN Variation Finder | 0.1.2 | Right-click current Amazon inline/classic variation swatches and reveal matching child ASINs from the loaded page, including unavailable options when exposed. | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Diagnostics/Amazon_ASIN_Variation_Finder_TEST.user.js) |
| FCResearch Section Probe | 0.2.0 | Map native section XHR/render timing and run one explicit, reversible Product request suppression test. | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Diagnostics/FCR_Section_Probe.user.js) |
| FCResearch → RIVER Ticket Assistant | 0.3.12 | Event-driven Hazmat N/A/L0 capture. Information W1 now recognises the actual `X0 ASIN` field and fills `N/A` when no X0 FNSKU exists; `Sort/Non-Sort Identification` is recognised as the sortability step so Option 1 + Next can continue automatically. Latest matching PO/vendor/quantity rules remain unchanged. | [Open](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/FCResearch_RIVER_Ticket_Assistant.user.js) |

Diagnostic userscript identity is immutable once deployed too. Existing diagnostic `@name`, `@name:en`, `@namespace`, filename and canonical update/download paths are frozen during normal updates, even when an old version number is embedded in the title. Current versions belong in `@version`, matching internal version constants and visible runtime UI where present.
