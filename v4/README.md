# Tampermonkey V4

Active branch: `v4-cleanroom`. Read [BRIEF](BRIEF.txt), [BASELINE](BASELINE.md), [AGENTS](AGENTS.md), and [CHECKPOINT](CHECKPOINT.md) to resume. V2 root and frozen V3 are unchanged.

| Script / installer | Version | Status | Offline fixtures | Remaining issue |
|---|---|---|---|---|
| [OBS](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/OBS.user.js) | 0.1.3 | READY FOR READ-ONLY TEST | 28 | Tampermonkey/long-session export |
| [FCR Master](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/FCResearch_Master.user.js) | 0.1.5 | READY FOR READ-ONLY TEST | 54 Master integration/features/actions | Native A/L/filter/date/navigation, cold/expired auth; partial live read evidence |
| [Tote Audit](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/FC_Lite.user.js) | 0.1.1 | OFFLINE VERIFIED — LIVE GATE PENDING | 9 + 2 barcode | Scanner/native barcode schema/auth/print |
| [Bin Check](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Bin_Check_Overlay.user.js) | 0.1.1 | OFFLINE VERIFIED — LIVE GATE PENDING | 7 | Native filters/floor schema/print |
| [FNSKU Mapping](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/FNSKU_Mapping_Lookup.user.js) | 0.1.0 | OFFLINE VERIFIED — LIVE GATE PENDING | 10 | Native regional auth/results/pagination |
| [Bind](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Bind_Hierarchy_Queue.user.js) | 0.1.1 | OFFLINE VERIFIED — LIVE GATE PENDING | 14 shared hierarchy | Native seed/identity/ack; approval |
| [Unbind](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Unbind_Hierarchy_Queue.user.js) | 0.1.1 | OFFLINE VERIFIED — LIVE GATE PENDING | 14 shared hierarchy | Native identity/ack; approval |
| [Dropzone](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Dropzone_Selector_Queue.user.js) | 0.1.2 | PARTIAL | 14 | Empty-container location proof; native browser/auth acceptance |
| [Stow](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Stow_Andons_Helper.user.js) | 0.1.1 | PARTIAL | 9 | Native frames/auth/locks; empty-container movement |
| [Sideline Queue + Lazy](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Sideline_Queue_Lazy.user.js) | 0.1.2 | OFFLINE VERIFIED — LIVE GATE PENDING | 23 | Native identity/API/QTY/date/scanner acceptance; approval |
| [AFT Edit/Move/FCSKU Flip](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/AFT_Edit_SKU_Move.user.js) | 0.1.3 | OFFLINE VERIFIED — LIVE GATE PENDING | 19 | Native workflow/modes/quantity/date/scanner/auth/additional-confirmation |
| [ISS Console](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/ISS_Console.user.js) | 0.1.1 | OFFLINE VERIFIED — LIVE GATE PENDING | 13 | Native workers/framing/auth/locks/scanners/date/Predicant |
| [Carton PrEditor](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Carton_PrEditor.user.js) | 0.1.0 | OFFLINE VERIFIED — LIVE GATE PENDING | 3 | Native readiness/Complete/audio; approval |
| [Calm Code](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Calm_Code.user.js) | 0.1.0 | OFFLINE VERIFIED — LIVE GATE PENDING | 3 | Native form/labor result; approval |
| [PO Portal](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/PO_Portal_Lite.user.js) | 0.1.0 | READY FOR READ-ONLY TEST | 3 | Native dates/results/navigation |
| [Screenshot](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Screenshot_Mode.user.js) | 0.1.0 | READY FOR READ-ONLY TEST | 2 | Actual visual/keyboard acceptance |
| [SIM Toolbar](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/SIM_Markdown_Toolbar.user.js) | 0.1.0 | OFFLINE VERIFIED — LIVE GATE PENDING | 9 | Native editor/popup/attachment auth |
| [RIVER](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/FCResearch_RIVER_Ticket_Assistant.user.js) | 0.1.0 | OFFLINE VERIFIED — LIVE GATE PENDING | 6 | Native capture/page-info/fields/GM handoff |

[Native FCR capture helper](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/diagnostics/FCR_Native_Capture.user.js) 0.1.1 is a manual read-only diagnostic, with 4 fixtures. No automatic collection or operational action.

Current verification: **303 passed / 0 failed**; deterministic generation, metadata/version/update URL/duplicate identity, syntax, no old runtime dependency or recurring polling checks pass. Internal FCR reads/enrichment/auth are bundled capabilities, not separate installers. Fixture evidence is not live proof. Shared footer shows only registered active scripts and real versions. All 19 installers include it; separate generated bundles verify FCR/ISS navigation, Ctrl+Q and BFCache with zero idle API requests in the fixture.

Test in stages with corresponding V2/V3 installers disabled: OBS + Master read-only first; then Tote, Bin, Mapping; inspect hierarchy/Sideline native UI and scanner/date controls without submitting operations. Controlled hierarchy/movement/editing/printing requires explicit approval, one known test case at a time, native readback and OBS export. Dropzone native Enter and queue now share submission ownership; empty-container location evidence remains a parity gate. Production rollout is separate.

Meaningful source improvements verified so far: self-contained installers with zero runtime @require dependencies; one hierarchy engine/journal; native-origin Stow workers share native ownership; explicit submitted/unknown recovery; bounded/coalesced reads; scoped canonical component styles and one event-driven runtime footer. No overall performance or full visual/live parity claim has been measured.

Verification from this folder:

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run check
# Optional captured native-code harness (raw capture stays outside Git)
node verify-native-capture.mjs /path/to/capture.json
```
