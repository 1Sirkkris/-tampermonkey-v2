# Recovery state

- Unit: baseline inventory and rebuild sequence.
- Status: COMPLETE (documentation only; no implementation).
- Reference main: `e4399d89ff11551ec1afb132d67c448da1e43568`.
- Frozen V3: `77ff9f7818ea8d2d53422654a7e6b7ca51b6db13`.
- Verification: remote references checked; all 22 main source files inventoried; no inherited root source changes; no V3 code imported.
- Next: OBS behaviour contract, then its smallest independent implementation.
- Required gate: implement only after the unit contract is internally consistent; validate and push before another unit.
- Runtime evidence: no V4 live operation exists yet; fixtures cannot replace live acceptance.

To resume, fetch `origin/v4-cleanroom`, verify its remote SHA, and use the latest pushed commit. Read `BRIEF.txt`, `BASELINE.md` and this file. Do not reconstruct completed work from chat. Remote `main` and `v3-groundup` must remain untouched.
