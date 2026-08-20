# Release and rollback

## Branch roles

- `main`: known-good production source and the repository's actual default branch. Keep untouched until a deliberate promotion decision. Some task notes call this branch master.
- `offline-cleanup-pass-1`: accepted offline-cleanup candidate. It contains behavior-preserving optimizations, statically proven race fixes, diagnostics, contracts, fixtures, and CI.
- Diagnostics are not production replacements. Install them only for evidence collection and disable them afterward.

Every cleanup commit before the tooling pass is single-production-file scoped. Tooling and documentation commits are separately scoped so any layer can be reviewed or reverted without mixing production behavior.

## Candidate gate

1. Confirm the branch is clean and its local HEAD matches `origin/offline-cleanup-pass-1`.
2. Run `npm run validate` and `npm test` with Node 20 or newer.
3. Confirm GitHub **Offline static validation** is green.
4. Perform the smoke matrix below using the candidate scripts, not `master`.
5. Collect the specific live evidence listed in `Diagnostics/LIVE_EVIDENCE_CAPTURE.md`.
6. Review any protected-contract lock update as a contract change, never as routine generated churn.
7. Promote only after an explicit decision. Do not silently fast-forward or merge `main` as part of validation.

## Minimum smoke matrix

| Script | Required live check |
|---|---|
| Sideline | Normal source/item/move; cancel/restart; Predicant; damaged destination; customer-bound source |
| AFT | One Edit, Move, and FcSku path currently used; objectId transition; quantity read only |
| Dropzone | Existing single-container workflow plus queue render/state transitions |
| Bin Overlay | Representative P2/P3/P4 hierarchy lookup, retry, pause, copy |
| FCR Data Core | Product/inventory/history/Hazmat/bin cache hit and forced refresh |
| FCResearch Master | Product/inventory refresh, print shortcut, Sideline size lookup |
| FC-Lite | Container load, queued scan, duplicate scan, copy stats |
| Stow | Floor/drop controls, move success/failure, hover and Sussy refresh |

## Rollback

The safest rollback is operational, not destructive Git history:

1. Disable the candidate userscript in the userscript manager.
2. Re-enable or reinstall the same script from `main` at the known-good SHA.
3. Do not clear production local/session/GM storage unless a specific migration document says it is safe. This pass intentionally preserved all existing keys.
4. Disable the unified diagnostic. Its sanitized same-tab data can be removed with **Clear** or by closing the tab; its storage key is diagnostic-only.
5. Record the failing candidate commit and workflow before changing code.

For repository rollback, create a new revert commit for the exact scoped commit. Do not rewrite shared history and do not use a broad reset against the worktree.

## Repository areas

- Root `MAIN_*.txt` and `TEST_*.txt`: independently installable current scripts.
- Root/`Diagnostics/` `DIAG_*` and Super Tracer: probes and capture tools, not production workflow replacements.
- `contracts/`: generated category lock plus readable critical anchors.
- `tests/fixtures/`: sanitized, source-backed response structures only.
- `tools/`: dependency-free validation and source-function extraction.
- `docs/`: release and future architecture decisions.
- `.github/workflows/`: read-only CI validation.
