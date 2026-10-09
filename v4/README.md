# Tampermonkey V4

Active branch: `v4-cleanroom`. [Scope and rebuild order](BASELINE.md). [Recovery state](CHECKPOINT.md). [Current user instructions](BRIEF.txt).

| Installer | Version | Verification |
|---|---|---|
| [V4 OBS](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/OBS.user.js) | 0.1.3 | 26 offline installer fixtures and metadata/syntax/independence checks pass. Live Tampermonkey acceptance pending. |
| [FCR Master test candidate](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/FCResearch_Master.user.js) | 0.1.5 | 54 Master/native/feature/action fixtures and captured native-code integration pass. Clean live sample: empty Product, inventory, Pandash, Size and cached-auth MADCAT succeed; full V2 replacement acceptance remains pending. |
| [FCR capture helper](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/diagnostics/FCR_Native_Capture.user.js) | 0.1.0 | Manual read-only diagnostic; 3 fixtures. In FCR, use Tampermonkey menu → Capture native FCR → upload the JSON. No automatic collection or inventory action. |

V4 installers are self-contained. Inherited root scripts remain V2 reference files. The remaining V4 workflows are planned in the baseline and still require implementation.

FCR read source capability is offline-verified: 28 native read, 21 enrichment and 16 Measurement auth fixtures pass. Master consumer/installer integration and live acceptance remain pending. These modules are internal source, not installers. [Read contract](FCR_READ_CONTRACT.md), [enrichment contract](FCR_ENRICHMENT_CONTRACT.md) and [validation](FCR_READ_VALIDATION.md).

Active unit: [FCR Master contract](FCR_MASTER_CONTRACT.md). Section, badge/auth/cache, copy/print/keyboard/ISS and PO source are fixture-verified. The native capture resolved the Retry Inventory/bootstrap gap. The subsequent live OBS report prompted container empty-state, bounded Pandash recovery and request-time MADCAT auth corrections. [Milestone evidence](FCR_MASTER_VALIDATION.md). Master 0.1.3 is available for standalone read-only acceptance with V2/V3 disabled; production replacement is not yet verified.

Verification from this folder:

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run check
# Optional: actual native-code integration, with the supplied capture
node verify-native-capture.mjs /path/to/capture.json
```

The pinned jsdom/jQuery dependencies are used only by tests. OBS is authored directly. Master is generated from canonical source with pinned esbuild; `npm run check` rejects a stale installer. No build/test dependencies load in Tampermonkey. [OBS contract](OBS_CONTRACT.md) and [validation evidence](OBS_VALIDATION.md).

Shared V4 active runtime footer is included in Master/OBS; 4 source lifecycle fixtures pass. Total 152 offline tests. Tampermonkey sandbox and Screenshot Mode acceptance remain pending.

| New installer | Version | Status | Tests | Remaining live gate |
|---|---|---|---|---|
| [V4 Tote Audit](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/FC_Lite.user.js) | 0.1.0 | OFFLINE VERIFIED — LIVE GATE PENDING | 9 Tote + 2 barcode | Scanner pace, deployed barcode schema, auth, optional printer |

Current full suite: 163 offline tests. Tote keeps all twelve system columns and queued scans after inventory failure. No live mutations performed.

| [V4 Bin Check](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Bin_Check_Overlay.user.js) | 0.1.0 | OFFLINE VERIFIED — LIVE GATE PENDING | 7 Bin | Native filter/floor schema, optional printer |

Current full suite: 170 offline tests; generated installers + source checks pass.

| [V4 FNSKU Mapping](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/FNSKU_Mapping_Lookup.user.js) | 0.1.0 | OFFLINE VERIFIED — LIVE GATE PENDING | 10 FNSKU | Native regional auth/results |

Current full suite: 180 offline tests. Read-only candidate testing order: OBS + Master, Tote, Bin, FNSKU. Optional printing remains separately approved.

| [V4 Bind](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Bind_Hierarchy_Queue.user.js) | 0.1.0 | OFFLINE VERIFIED — LIVE GATE PENDING | 14 shared hierarchy | Native seed/identity/acknowledgement + controlled approval |
| [V4 Unbind](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Unbind_Hierarchy_Queue.user.js) | 0.1.0 | OFFLINE VERIFIED — LIVE GATE PENDING | 14 shared hierarchy | Native identity/acknowledgement + controlled approval |

194 offline tests. Hierarchy fixtures prove source state/recovery and request composition, not real inventory outcomes. Do not run mutations without approval; unknown rows remain visible and non-runnable.

| [V4 Dropzone](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Dropzone_Selector_Queue.user.js) | 0.1.0 | PARTIAL | 8 Drop | Empty-container native location evidence; authenticated exact destination readback |

202 offline tests. Dropzone refuses to submit containers whose location cannot be safely verified. HTTP 200 never marks a move complete. This empty-container gate is an explicit V2 parity limitation, not test readiness for that case.

| [V4 Stow](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Stow_Andons_Helper.user.js) | 0.1.0 | PARTIAL | 9 Stow/bridge | Native frame/auth/ownership, exact location evidence and empty containers |

211 offline tests. Stow preserves its inline native controls and product warnings. Its self-contained native-origin workers provide a common operation lock and ledger; deployed browser authentication/framing remains a live gate. No live operation/printing performed.

Sideline WIP source is now preserved with 12 behavioural fixtures (223 total tests). **PARTIAL: no Sideline installer yet.** Native QTY/expiry integration and complete entry/installer verification are next; do not treat the source-only checkpoint as a test candidate.
