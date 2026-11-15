# Bin overlay v7.4.14 — cautious adaptive pacing

Prepared 2026-11-15T21:38:59.702257+11:00.

The overlay accelerates only while normal, user-requested bin lookups succeed. It sends no calibration traffic, background stress tests, telemetry uploads or additional FCResearch requests for OBS.

## Source and authority

- Target: `1Sirkkris/-tampermonkey-v2`, branch `main`, `Bin_Check_Overlay.user.js`.
- Publication baseline: commit `048d6779273fca60a30955a5e8613be7026eac8a`, overlay v7.4.11 blob `f4be0df8bdea60589d7dd475afb4a993547d7828`.
- Implementation baseline: the newer delivered and user-tested v7.4.13, preserving sizes, floor toggles, numeric sorting, saved preferences, rechecks and Lazy TSV behaviour.
- Current explicit approval covers implementation, testing and GitHub publication, including OBS changes if needed. No installation or live tests performed by the agent.
- Overlay SHA256: `aa5fbea1e22ffdb105e6cf57550422731b24e769218849101392e0ddd1701485`.
- Existing userscript identity, namespace, dependency, update and download URLs are preserved. Metadata/internal version: 7.4.14.

## Request policy

- Default gap: 400ms; only one request in flight. Successful responses must arrive before another request starts.
- After 20 clean, complete network lookups, reduce the start gap by 25ms, down to 250ms. This bounds starts to four per second, without attempting to discover the server's limit by flooding it.
- A 429 doubles the gap up to 5000ms, stops further acceleration for that scan, and applies the existing queue-wide cooldown. Longer `Retry-After` values are honoured.
- Other errors clear the clean streak, stop acceleration for the scan and slow the gap by 25%, to at least 400ms. Existing delayed, bounded automatic retries and manual recovery remain.
- Remember only a gap that has passed a clean 20-lookup window, or a slower backoff gap. A new page adds 25ms of headroom. The remembered pace expires after 24 hours. A remembered throttle hold suppresses acceleration for 10 minutes.
- Manual retries and a fresh snapshot cannot bypass the current queue cooldown. Existing request timeout and stale-run protections remain.
- These bounds apply to this overlay instance; normal site requests and other tools/tabs also contribute to server load. Test one overlay scan at a time.

## OBS evidence

Existing OBS 0.1.44 and Fleet Core 0.1.1 can accept these events. Their source does not require modification.

| Event | Evidence retained |
| --- | --- |
| `BIN_OVERLAY_SCAN_START` | Version, run, total bins, cache hits, network work, starting pace and caps |
| `BIN_OVERLAY_REQUEST` | Bin fingerprint, sequence, attempt, start offset, selected gap, in-flight count |
| `BIN_OVERLAY_RESULT` | Same correlation, HTTP status, elapsed request time, response length, field availability, retry outcome and delay |
| `BIN_OVERLAY_RATE_CHANGE` | Reason, old/new gaps and clean window |
| `BIN_OVERLAY_THROTTLED` | HTTP 429, cooldown, Retry-After and backed-off gap |
| `BIN_OVERLAY_SCAN_PROGRESS` / `BIN_OVERLAY_SCAN_SUMMARY` | Loaded/pending/failed, attempts, cache hits, retries, status histogram, throttles, timeouts, wall/pause time, average/p95 latency, effective request rate and peak in-flight |

Progress summaries are bounded to completion windows or a 10-second interval when a request finishes. Per-request events are limited by the normal bounded lookup attempts. No raw response bodies, credentials or additional network probes are added. Existing OBS sanitization fingerprints bin identities and scrubs sensitive fields before export.

## Verification

Passed offline against actual candidate source:

```
node --check Bin_Check_Overlay.user.js
node tests/bin_overlay_rate.test.cjs
node tests/bin_overlay_obs.test.cjs
```

- 20 deterministic scenario groups: synthetic 331-bin scan; sizes; independent floor toggles; numeric sorting; saved settings; cache TTL; initial vs delayed retries; 429 and Retry-After; partial data; bounded/manual retry and deduplication; pause; timeout; stale-response reset; snapshot/cached reopen; Lazy TSV; clean-window pacing; remembered settings; rate-limit lockout; request timing.
- Actual Fleet trace and postMessage fallback passed through actual OBS bus and sanitization/export-record functions. Numeric timing/status data and correlation survive while bin IDs/sensitive fields are scrubbed.
- All operational test data is synthetic. DOM, fetch, storage and clocks are fixtures; no live FCResearch calls or browser visual verification occurred.
- Copy Code artifact was checked for full hidden-script equality and both clipboard routes.

## Test and recovery

Update the existing overlay through Tampermonkey, refresh FCResearch, run one ordinary scan and export OBS after completion. Compare fully loaded bins and wall time, separating cache hits, pauses and retries. Do not repeatedly launch scans to force a throttle.

The deployed/server-approved rate is unknown. This is a bounded adaptive policy, not a guarantee against throttling or a claim about organisational limits. If it repeatedly backs off, retain the slower successful pace and review the OBS summary.

Rollback for the previously tested controls: use the delivered `Bin_Check_Overlay_v7.4.13_Copy_Code.html`. Rolling back to the previous repository commit restores v7.4.11, which predates those controls. This receipt and the source/tests are stored with the release commit. Live acceptance and installed version remain pending user testing.
