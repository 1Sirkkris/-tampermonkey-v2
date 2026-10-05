# Tampermonkey V4

Active branch: `v4-cleanroom`. [Scope and rebuild order](BASELINE.md). [Recovery state](CHECKPOINT.md). [Current user instructions](BRIEF.txt).

| Installer | Version | Verification |
|---|---|---|
| [V4 OBS](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/OBS.user.js) | 0.1.2 | 26 offline installer fixtures and metadata/syntax/independence checks pass. Live Tampermonkey acceptance pending. |

V4 installers are self-contained. Inherited root scripts remain V2 reference files. The remaining V4 workflows are planned in the baseline and still require implementation.

Verification from this folder:

```sh
npm ci --ignore-scripts
npm test
npm run check
```

The pinned jsdom dependency is used only by tests. Authored `.user.js` files are the installers; there is no separate generated build to go stale. [OBS contract](OBS_CONTRACT.md) and [validation evidence](OBS_VALIDATION.md).
