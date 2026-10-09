# Tote Audit contract

Evidence: V2 FC_Lite 0.1.83, FCR Data Core 0.2.41, BASELINE F06/F07/F16 and V3 readiness review. V2 source is behavioural evidence, not live proof of every revision.

- PRESERVE: native Dimensions launcher → real navigation to `#fcr-tote-checker`; standalone FC-LITE bar, container scanner then items, same-container scan finishes, new container resets; scan while inventory loads; duplicates count units; reset; all twelve system inventory columns; exact X0/ZZ identities; sortable/dimensions/bin/MADCAT, suspicious dimensions, hazmat recheck, ASIN hover, code click print, Copy Stats and Full FCResearch.
- FAILURES: never audit against partial inventory; never count another FNSKU merely through its ASIN; retain failed-inventory pending scans; stale reads cannot update new tote; no FCR/old core installed dependency; title belongs to resolved code.
- STATE: one route owner, cancellable session generation, bounded read workers and per-session product coalescing; UI derives from model. Complete inventory + physical scans are separate.
- SUCCESS: read completeness enforced by the verified FCR reader; matching identity proves in-tote. Duplicate physical units allocate across all matching native rows without exceeding system count; overcounts stay visible.
- UNKNOWN: incomplete inventory/error produces no IN/OUT conclusion. Barcode resolution provenance is native search, followed by strict canonical-product verification; deployed barcode search remains a live gate.
- RESET: Reset/new container aborts old session; failed inventory retains pending scans for deliberate retry. Finish does not cancel submitted reads; further item scans are refused, results already queued still settle. Disposal cancels only reads.
- DEPENDENCIES: native FCR POSTs, Pandash and Measurement auth via bundled V4 modules; local Printmon only on explicit click, no retry or physical print confirmation claim. OBS optional.

Canonical scoped CSS replaces V2's layered styles. No native page-wide reset. Normal FCR only receives the Dimensions launcher. Live gates: barcode response schema/resolution, auth, browser scanner speed/focus, native inventory continuation and print output (approval required).
