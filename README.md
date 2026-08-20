# Tampermonkey V2

Private API-era working set. Older public repo is archive only.

## Current preferred versions

- Sideline — MAIN v0.2.1 Sideline API Move TEST
- Bin Overlay — TEST v7.3.6 Bin check Overlay
- Stow Andons Safe Trim — TEST v5.4.10
- FC-Lite — TEST v0.1.29
- FCR Data Core — TEST v0.2.3
- FCResearch Master — TEST v0.1.10
- Dropzone Selector Queue — TEST v0.2.16
- BWU2 Super Tracer — TEST v0.1.5
- AFT Edit/SKU/Move master — MAIN v0.9.4
- Sideline Close Container Capture — DIAG v0.1.0

Rule: when duplicate uploads exist, prefer the highest script version unless explicitly told otherwise. Diagnostic/usage-probe variants are kept separate from production/current scripts.

## Validation and release map

- `npm run validate` checks userscript syntax and protected metadata/contracts.
- `npm test` runs contract validation and sanitized response replay tests.
- `Diagnostics/DIAG_v0.2.0_Unified_Live_Evidence_Capture.user.js` is the single next-shift capture pack; see `Diagnostics/LIVE_EVIDENCE_CAPTURE.md`.
- `tests/fixtures/` contains sanitized structures already recognized by current code. It contains no captured production identifiers.
- `contracts/` locks metadata, endpoints, storage keys, selectors, shortcuts, labels, init guards, payload shapes, listeners, functions, and shared events.
- `.github/workflows/offline-static-validation.yml` runs the lightweight offline gate.
- `docs/RELEASE_AND_ROLLBACK.md` defines candidate promotion and rollback.
- `docs/EXTENSION_ARCHITECTURE.md` defines the safe future browser-extension boundary without changing current userscripts.

`main` (the repository's actual default branch, referred to as master in some task notes) remains the known-good line. `offline-cleanup-pass-1` is the accepted cleanup candidate plus offline validation/tooling; it must not be merged until the documented live gate is complete.
