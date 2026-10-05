# Recovery state

- Unit: OBS independent installer.
- Status: PARTIAL (authored installer; regression verification pending).
- Reference main: `e4399d89ff11551ec1afb132d67c448da1e43568`.
- Frozen V3: `77ff9f7818ea8d2d53422654a7e6b7ca51b6db13`.
- Verification: `node --check v4/OBS.user.js` and `git diff --check` pass. Source is independent, with no external require. No inherited root source changed. Behaviour tests have not yet run.
- Next: add/run installer fixtures for storage/export, cross-page epochs/deduplication, native transport semantics, redaction and disposal. Review any failures before calling this unit complete. Stay in the OBS unit.
- Required gate: run the OBS contract fixtures and consistency/independence checks, then push before another unit. `package.json` declares the intended checks; its test/check files are not present in this partial checkpoint yet.
- Runtime evidence: no V4 live operation exists yet; fixtures cannot replace live acceptance.

To resume, fetch `origin/v4-cleanroom`, verify its remote SHA, and use the latest pushed commit. Read `BRIEF.txt`, `BASELINE.md` and this file. Do not reconstruct completed work from chat. Remote `main` and `v3-groundup` must remain untouched.
