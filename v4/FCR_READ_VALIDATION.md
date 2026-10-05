# Native FCR read slice validation

5 October 2026. Independent source `fcr-read.mjs` 0.1.0; no V2/V3 source imported, no application requests submitted live.

- `npm test`: 50 passed, 0 failed (24 native read fixtures + 26 OBS fixtures).
- `npm run check`: installer/source syntax, metadata and independence pass.
- `git diff --check`: pass.

Fixtures exercise native request fields/allowlist, exact product aliases and scoped images, twelve inventory fields with reordered columns, fresh first-page preview and validated continuation, repeated SKU/disposition rows, explicit empty results, invalid quantities/identities, login/redirect/HTTP/transport errors, unknown/repeated tokens, malformed/missing/empty continuation pages, totals/page/row bounds, explicit partial results, caller cancellation and late responses, bounded 5xx retry, timeout abort, optional OBS failure, dated history/form fields/fragments and lazy generic sections. Construction starts no traffic.

This slice validates every inventory page rather than treating the absence of a usable next token as proof of completion. A complete result has a validated total; partial display output has `totalQuantity: null` and a warning/code. Full inventory is uncached. The consumer owns its AbortSignal and UI; there is no daemon, old event/storage protocol or cross-caller cancellation.

## Outstanding gates

- External Pandash/Poirot/Item Measurement reads and authentication renewal are not implemented in this slice. The full FCR read capability is PARTIAL.
- Master consumer UI and the eventual self-contained installer are not implemented. Source fixtures are not installer/live acceptance.
- Fixtures use documented source-derived schemas and constructed HTML, not captured current live pages. Native empty/continuation markup, header total semantics, authentication and redirects must be checked at live acceptance. Unknown formats fail visibly rather than being guessed complete.
- A pagination walk is sequential but cannot make changing live stock an atomic snapshot. A caller requiring operational proof must reconcile current application state; these reads never assert movement.

Concurrent recovery note `recovery/FCR_NATIVE_READS_session1.md` is retained as supplementary evidence. Its exact-record ambiguity and generic-completeness findings are covered by fixtures; it does not replace the active contract.
