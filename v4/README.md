# Tampermonkey V4

Active branch: `v4-cleanroom`. [Scope and rebuild order](BASELINE.md). [Recovery state](CHECKPOINT.md). [Current user instructions](BRIEF.txt).

| Installer | Version | Verification |
|---|---|---|
| [V4 OBS](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/OBS.user.js) | 0.1.2 | 26 offline installer fixtures and metadata/syntax/independence checks pass. Live Tampermonkey acceptance pending. |
| [FCR Master test candidate](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/FCResearch_Master.user.js) | 0.1.3 | 54 Master/native/feature/action fixtures and captured native-code integration pass. Clean live sample: empty Product, inventory, Pandash, Size and cached-auth MADCAT succeed; full V2 replacement acceptance remains pending. |
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
