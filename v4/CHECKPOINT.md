# Recovery state

- Unit: FCR read capability.
- Status: PARTIAL (behaviour contract established; native reads implementation next).
- Recovery lineage: remote was ahead of the supplied `22e2da265766348a43c26854d3e802d85320f62f`; preserved `1fc7ab89c34db26236af1eba69b2575d31553070` and the subsequently published `5d8ae2f61a18907f04d668a51347b1df34b06b5c`. All their source corrections and 22 fixtures remain, with four additional fixtures and targeted asynchronous-observation corrections.
- Reference main: `e4399d89ff11551ec1afb132d67c448da1e43568`.
- Frozen V3: `77ff9f7818ea8d2d53422654a7e6b7ca51b6db13`.
- Verification: `npm test` = 26 passed, 0 failed; `npm run check` and whitespace checks pass. See `OBS_VALIDATION.md` for precise coverage/limits. No inherited root source changed. Pinned test dependencies and lockfile are present; the installer has no external require.
- Completed OBS: 0.1.2 is pushed at `403eef39485b55ba508193257495d3c0ffb6d23c`, with 26 passing fixtures; live acceptance pending.
- FCR evidence: pinned V2 Data Core 0.2.41 and Master 0.1.84 inspected for native POST forms, product/inventory schemas, continuation tokens, dated history and external enrichment. `FCR_READ_CONTRACT.md` records required behaviour and scope.
- Next: implement/verify native FCR product/inventory/section/history reads independently. Keep preview/partial output honest and reject malformed continuation pages. Pandash/Poirot/Measurement enrichment is still pending within this capability before Master readiness.
- Required gate: contract → implementation → verification → pushed checkpoint for each FCR milestone. Do not call the complete FCR capability ready while external enrichment remains unimplemented.
- Runtime evidence: OBS is fixture-verified; native Tampermonkey/live page acceptance remains pending. No V4 inventory workflow has been implemented or tested live.

To resume, fetch `origin/v4-cleanroom`, verify its remote SHA, and use the latest pushed commit. Read `BRIEF.txt`, `BASELINE.md` and this file. Do not reconstruct completed work from chat. Remote `main` and `v3-groundup` must remain untouched.
