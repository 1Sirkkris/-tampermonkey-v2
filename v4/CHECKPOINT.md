# Recovery state

- Unit: OBS behaviour contract.
- Status: PARTIAL (contract established; no OBS implementation yet).
- Reference main: `e4399d89ff11551ec1afb132d67c448da1e43568`.
- Frozen V3: `77ff9f7818ea8d2d53422654a7e6b7ca51b6db13`.
- Verification: V2 OBS controls/export/lifecycle inspected; F14/F15 and V3 duplicate/read-noise cases included; contract states evidence and live limits. Baseline is already published at `8eda7ba490debda26a97f0e0813e4c67df4a96df`.
- Next: smallest independent OBS implementation and installer fixtures. Stay in the OBS unit.
- Required gate: implement only after the unit contract is internally consistent; validate and push before another unit.
- Runtime evidence: no V4 live operation exists yet; fixtures cannot replace live acceptance.

To resume, fetch `origin/v4-cleanroom`, verify its remote SHA, and use the latest pushed commit. Read `BRIEF.txt`, `BASELINE.md` and this file. Do not reconstruct completed work from chat. Remote `main` and `v3-groundup` must remain untouched.
