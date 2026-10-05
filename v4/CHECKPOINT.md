# Recovery state

- Unit: OBS independent installer.
- Status: COMPLETE (OBS 0.1.1; offline verification complete, live acceptance pending).
- Reference main: `e4399d89ff11551ec1afb132d67c448da1e43568`.
- Frozen V3: `77ff9f7818ea8d2d53422654a7e6b7ca51b6db13`.
- Verification: `npm test` = 22 passed, 0 failed; `npm run check` and whitespace checks pass. See `OBS_VALIDATION.md` for precise coverage/limits. No inherited root source changed. Pinned test dependencies and lockfile are present; the installer has no external require.
- Next: FCR read capability behaviour contract, scoped to the first FCR Master consumer. Inspect proven V2/API evidence before designing its implementation. Do not import V3 structure.
- Required gate: commit/publish/verify this OBS unit before starting FCR. Then follow contract → implementation → verification → pushed checkpoint for FCR; use intermediate checkpoints if it grows or becomes uncertain.
- Runtime evidence: OBS is fixture-verified; native Tampermonkey/live page acceptance remains pending. No V4 inventory workflow has been implemented or tested live.

To resume, fetch `origin/v4-cleanroom`, verify its remote SHA, and use the latest pushed commit. Read `BRIEF.txt`, `BASELINE.md` and this file. Do not reconstruct completed work from chat. Remote `main` and `v3-groundup` must remain untouched.
