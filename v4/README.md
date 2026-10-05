# Tampermonkey V4

Active branch: `v4-cleanroom`. [Scope and rebuild order](BASELINE.md). [Recovery state](CHECKPOINT.md). [Current user instructions](BRIEF.txt).

| Installer | Version | Verification |
|---|---|---|
| [V4 OBS](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/OBS.user.js) | 0.1.2 | 26 offline installer fixtures and metadata/syntax/independence checks pass. Live Tampermonkey acceptance pending. |
| FCR Master development checkpoint | 0.1.0 | Native section loading milestone only: 12 installer/real-jQuery fixtures. Remaining Master features and live acceptance pending; not a replacement candidate. |

V4 installers are self-contained. Inherited root scripts remain V2 reference files. The remaining V4 workflows are planned in the baseline and still require implementation.

FCR read source capability is offline-verified: 24 native read, 16 enrichment and 13 Measurement auth fixtures pass. Master consumer/installer integration and live acceptance remain pending. These modules are internal source, not installers. [Read contract](FCR_READ_CONTRACT.md), [enrichment contract](FCR_ENRICHMENT_CONTRACT.md) and [validation](FCR_READ_VALIDATION.md).

Active unit: [FCR Master contract](FCR_MASTER_CONTRACT.md). Native section consumer/installer implemented; badges, copy, print, PO highlights and full lifecycle acceptance still pending. [Milestone evidence](FCR_MASTER_VALIDATION.md).

Verification from this folder:

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run check
```

The pinned jsdom/jQuery dependencies are used only by tests. OBS is authored directly. Master is generated from canonical source with pinned esbuild; `npm run check` rejects a stale installer. No build/test dependencies load in Tampermonkey. [OBS contract](OBS_CONTRACT.md) and [validation evidence](OBS_VALIDATION.md).
