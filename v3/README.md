# Tampermonkey V3 — test fleet 0.2.0

Branch: `v3-groundup`. V2 `main` is the behavioural reference and remains separate.

Disable the V2 and old V3 fleet before enabling these installers. Install all 14, including the native workers and OBS. Each installer is self-contained; there are no runtime library dependencies. Refresh the relevant Amazon tabs after installation and sign in on their native pages.

| Tool | One-click install |
|---|---|
| FCResearch | [Install 0.2.0](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-groundup/v3/dist/V3_FCResearch.user.js) |
| ISS Console | [Install 0.2.0](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-groundup/v3/dist/V3_ISS_Console.user.js) |
| AFT Tools | [Install 0.2.0](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-groundup/v3/dist/V3_AFT_Tools.user.js) |
| Sideline | [Install 0.2.0](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-groundup/v3/dist/V3_Sideline.user.js) |
| Hierarchy | [Install 0.2.0](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-groundup/v3/dist/V3_Hierarchy.user.js) |
| MoveContainer | [Install 0.2.0](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-groundup/v3/dist/V3_MoveContainer.user.js) |
| RIVER Assistant | [Install 0.2.0](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-groundup/v3/dist/V3_RIVER_Assistant.user.js) |
| FNSKU Mapping | [Install 0.2.0](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-groundup/v3/dist/V3_FNSKU_Mapping.user.js) |
| PO Portal | [Install 0.2.0](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-groundup/v3/dist/V3_PO_Portal.user.js) |
| Carton PrEditor | [Install 0.2.0](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-groundup/v3/dist/V3_Carton_PrEditor.user.js) |
| Calm Code | [Install 0.2.0](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-groundup/v3/dist/V3_Calm_Code.user.js) |
| SIM Toolbar | [Install 0.2.0](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-groundup/v3/dist/V3_SIM_Toolbar.user.js) |
| OBS | [Install 0.2.0](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-groundup/v3/dist/V3_OBS.user.js) |
| Screenshot Mode | [Install 0.2.0](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v3-groundup/v3/dist/V3_Screenshot_Mode.user.js) |

Structural and mocked domain/DOM validation has passed. **Actual Amazon workflow behaviour is unproven until user testing or logs establish it.**

Start with small controlled cases: native AFT EACH/Move, ISS handoff, Sideline Lazy/Queue and clear-source, typed-destination Bind, native/contextual Unbind and MoveContainer. A lost confirmation must halt with UNKNOWN and require verification. Do not interpret UNKNOWN as a rejected action.

FCR keeps Tote Audit, Bin Check, Pandash, inline Move/Unbind, exact printing/copy, size/MADCAT indicators and hover information. ISS remains on Poirot. Calm shortcuts remain inline on their native page. OBS exports via the Tampermonkey menu; Screenshot Mode uses Ctrl+Q.

MADCAT uses the native Measurement application's response bodies, without copying auth tokens. If native embedding/authentication is unavailable or history is incomplete, the badge stays AUTH/RETRY instead of claiming NO. Open native Measurement from the badge, then retry.

Build and verify: `npm ci --ignore-scripts && npm run build && npm run verify` inside `v3`.

See [architecture](ARCHITECTURE.md), [audit map](AUDIT_MAP.md) and [validation](VALIDATION.md).
