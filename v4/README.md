# Tampermonkey V4

Active branch: `v4-cleanroom`. [Scope and rebuild order](BASELINE.md). [Recovery state](CHECKPOINT.md). [Current user instructions](BRIEF.txt).

| Installer | Version | Verification |
|---|---|---|
| [V4 OBS](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/OBS.user.js) | 0.1.2 | 26 offline installer fixtures and metadata/syntax/independence checks pass. Live Tampermonkey acceptance pending. |

V4 installers are self-contained. Inherited root scripts remain V2 reference files. The remaining V4 workflows are planned in the baseline and still require implementation.

FCR read source capability is offline-verified: 24 native read, 16 enrichment and 13 Measurement auth fixtures pass. Master consumer/installer integration and live acceptance remain pending. These modules are internal source, not installers. [Read contract](FCR_READ_CONTRACT.md), [enrichment contract](FCR_ENRICHMENT_CONTRACT.md) and [validation](FCR_READ_VALIDATION.md).

Next unit: [FCR Master contract](FCR_MASTER_CONTRACT.md). Its consumer installer is not implemented yet.

Verification from this folder:

```sh
npm ci --ignore-scripts
npm test
npm run check
```

The pinned jsdom dependency is used only by tests. Authored `.user.js` files are the installers; there is no separate generated build to go stale. [OBS contract](OBS_CONTRACT.md) and [validation evidence](OBS_VALIDATION.md).
