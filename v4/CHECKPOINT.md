# Recovery state

- Unit: OBS independent installer.
- Status: PARTIAL (installer and regression fixtures authored; behavioural execution pending).
- Reference main: `e4399d89ff11551ec1afb132d67c448da1e43568`.
- Frozen V3: `77ff9f7818ea8d2d53422654a7e6b7ca51b6db13`.
- Verification: installer/fixture syntax, `node v4/checks.mjs` metadata/independence and whitespace checks pass. No inherited root source changed. Behaviour tests have not yet run: offline npm cache lacks jsdom metadata; dependency setup is pending.
- Next: run existing installer fixtures for storage/export, cross-page epochs/deduplication, native transport semantics, redaction and disposal. Review failures before calling this unit complete. Stay in the OBS unit.
- Required gate: run `npm test` and `npm run check` in `v4/`, then push before another unit. Install the pinned test-only jsdom dependency; the authored userscript has no external runtime library.
- Runtime evidence: no V4 live operation exists yet; fixtures cannot replace live acceptance.

To resume, fetch `origin/v4-cleanroom`, verify its remote SHA, and use the latest pushed commit. Read `BRIEF.txt`, `BASELINE.md` and this file. Do not reconstruct completed work from chat. Remote `main` and `v3-groundup` must remain untouched.
