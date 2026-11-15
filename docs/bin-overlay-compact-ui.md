# Bin overlay v7.4.15 — compact UI and bulk unresolved recheck

Approved 16 November 2026: implement the selected compact mockup, clickable Floor/Size/Qty headers, visible FcSKU, blue size badges and one bulk unresolved recheck; commit/push to main. Retain automatic timing adjustment and existing OBS capture. Installation and live tests are separate.

## Source and protected behaviour

- Repository: `1Sirkkris/-tampermonkey-v2`, branch `main`.
- Baseline HEAD: `4851497a9f1e7c9a0919c1ce48d5574a1eb2b669`.
- Baseline overlay v7.4.14 blob: `1ae1a2553326059fb2ba3f5dbb89df98c6b96d46`.
- Stable userscript name, namespace, Fleet dependency and Tampermonkey update/download URLs remain.
- The source of 15 network, pacing, telemetry, parser, cache and Lazy-copy functions was compared with v7.4.14 and is unchanged. Scheduler and OBS regression scenarios passed against the new source.
- Pacing continues at one request in flight, starting at the default or remembered interval. After 20 clean lookups, it reduces the gap by 25ms, down to a 250ms minimum. A 429 backs off, honours Retry-After and stops acceleration for that scan. No extra probe or stress traffic was added.

## UI behaviour

- Floor, Size and Qty headers are native buttons. Switching columns starts descending; another click on the same header reverses direction. The active header shows an arrow and has `aria-sort`. Unknown values stay last in either direction.
- Fresh default: Floor descending. Previously saved `DEFAULT` (the old ascending Floor option) migrates to `FLOOR_ASC`; existing quantity/size sorts retain their meaning. Sort and independent floor toggles persist.
- Visible columns: Floor, Container, Size, FcSKU, Qty. Bin text expands FNSKU and full Bin type details. A separate labelled native arrow link preserves opening that bin in FCResearch.
- Floor badges are neutral. Size badges use a light-to-dark blue scale for 6, 9, 11, 14 and 18.5 inches. Every badge keeps its numeric label; badge text contrast is at least 4.5:1. Unknown sizes are neutral.
- Unresolved rows include a warning symbol and text. No per-bin retry button or retry listener remains.
- One `Recheck unresolved (N)` button counts unique bins missing a floor or size, including hidden/filtered-out bins and partial results. It starts fresh attempts for terminal unresolved jobs; active/automatically queued jobs are never duplicated. The button is disabled while automatic work remains or the overlay is paused. Existing cooldown, timeout, maximum automatic attempts and stale-run protections still apply.
- Lazy copy retains all scanned floors regardless of display toggles; its format is unchanged. Its button and bulk recovery stay in the footer. Hide, Resume and the successful-result cache remain available.

## Verification

```
node --check Bin_Check_Overlay.user.js
node tests/bin_overlay_rate.test.cjs
node tests/bin_overlay_obs.test.cjs
```

Passed 24 deterministic source-execution scenario groups, including the original pacing/retry/timeout/reset/cache/Lazy regression paths and the new header cycles, unknown-last sorting, preference migration, FcSKU/FNSKU presentation, native bin links, bulk-only recovery and hidden partial results. The synthetic 331-bin scenario verifies bounded starts and one request in flight. Readable badge contrast was calculated for all five sizes.

Existing OBS 0.1.44 continues to capture the versioned request, result, rate-change, retry and summary events through the Fleet direct trace and postMessage fallback. Actual OBS bus/sanitization/export-record functions were tested; OBS source and its version did not change.

Copy Code delivery contains the complete verified script in a hidden textarea; exact content equality and both clipboard routes are verified separately.

Scope: offline execution with deterministic DOM/fetch/clock/storage fixtures. No FCResearch traffic, installation or live browser verification was performed. Real-workflow and native layout acceptance remain pending a normal user scan.

## Publication and rollback

The release commit contains only the overlay, affected regression tests and this receipt. Existing unrelated changes at the baseline HEAD are retained. Publication is verified against the raw Tampermonkey URL and branch HEAD after the push.

Rollback: restore `Bin_Check_Overlay.user.js` from baseline HEAD `4851497a9f1e7c9a0919c1ce48d5574a1eb2b669` or use the earlier v7.4.14 Copy Code delivery. The v7.4.15 preference migration remains compatible with the earlier saved quantity/size options; the earlier release may reset a new floor sort to its default.
