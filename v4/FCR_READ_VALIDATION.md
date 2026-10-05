# Native FCR read slice validation

5 October 2026. Independent source `fcr-read.mjs` 0.1.0; no V2/V3 source imported, no application requests submitted live.

- `npm test`: 66 passed, 0 failed (24 native read + 16 enrichment + 26 OBS fixtures).
- `npm run check`: installer/source syntax, metadata and independence pass.
- `git diff --check`: pass.

Fixtures exercise native request fields/allowlist, exact product aliases and scoped images, twelve inventory fields with reordered columns, fresh first-page preview and validated continuation, repeated SKU/disposition rows, explicit empty results, invalid quantities/identities, login/redirect/HTTP/transport errors, unknown/repeated tokens, malformed/missing/empty continuation pages, totals/page/row bounds, explicit partial results, caller cancellation and late responses, bounded 5xx retry, timeout abort, optional OBS failure, dated history/form fields/fragments and lazy generic sections. Construction starts no traffic.

This slice validates every inventory page rather than treating the absence of a usable next token as proof of completion. A complete result has a validated total; partial display output has `totalQuantity: null` and a warning/code. Full inventory is uncached. The consumer owns its AbortSignal and UI; there is no daemon, old event/storage protocol or cross-caller cancellation.

## Outstanding gates

- External Pandash/Poirot/Item Measurement request source is fixture-verified, but native ID-token capture/acquisition/renewal integration is still pending. The full FCR read capability is PARTIAL.
- Master consumer UI and the eventual self-contained installer are not implemented. Source fixtures are not installer/live acceptance.
- Fixtures use documented source-derived schemas and constructed HTML, not captured current live pages. Native empty/continuation markup, header total semantics, authentication and redirects must be checked at live acceptance. Unknown formats fail visibly rather than being guessed complete.
- A pagination walk is sequential but cannot make changing live stock an atomic snapshot. A caller requiring operational proof must reconcile current application state; these reads never assert movement.

Concurrent recovery note `recovery/FCR_NATIVE_READS_session1.md` is retained as supplementary evidence. Its exact-record ambiguity and generic-completeness findings are covered by fixtures; it does not replace the active contract.

## External enrichment slice

`fcr-enrichment.mjs` 0.1.0 adds 16 fixtures for exact native fields, valid level zero vs missing/ambiguous hazmat, explicit restriction fallback, FNSKU-specific bin identity and conflicting sizes, raw MADCAT time window/terminal negative, malformed/repeated/remaining pagination, bounded fresh-token renewal, history fallback provenance/UNKNOWN, caller cancellation, sanitized optional evidence, native GM synchronous/error/timeout/late callback semantics and independent cancellation ownership. The legacy `tool: V3` request field is preserved as a native API protocol value only.

The auth provider is injected in these fixtures. They do not prove native token capture, automatic auth acquisition, cross-origin execution or real browser GM timing. No live application request was submitted.
