# FCR Master milestone verification

6 October 2026 (Australia/Sydney). Development installer 0.1.2; **PARTIAL — captured native retry gap repaired, live acceptance pending**.

- `npm test`: **133 passed**, including 27 native reads, 17 Master, 10 native-integration, 11 feature, 10 action, 3 capture, 16 enrichment, 13 auth and 26 OBS cases.
- `npm run check`: three installers' metadata/syntax/independence, source syntax and byte-exact source/installer consistency pass. `git diff --check` passes. Source, tests and installers stay under `v4/`; inherited root code is unchanged.
- V2 main remains `e4399d89ff11551ec1afb132d67c448da1e43568`; frozen V3 remains `77ff9f7818ea8d2d53422654a7e6b7ca51b6db13`.

## Captured native evidence

The user's `FCR_native_capture_2026-10-06T03-15-08-111Z.json` contains the native inline FCR bundle and results markup. Capture SHA-256: `465b72366f0129727daae5147aaebf32fc5ac3b85654032e77cd7ec6b051a808`. Native bundle SHA-256: `901a3ab47a763f9c66a722b578d20bafcb919c2097dc2051640867806023eaf7`. The raw capture and internal application source are not published in this repository.

The bundle establishes private AUI jQuery 1.6.4, DataTables 1.9.4, the bare section POST followed by synchronous native `.done` registration, the rendering function's independent HTML argument, native advanced filters/totals/scrolling, endpoint-specific status/nav rows and `{section}-more` pagination. AUI defines its globals rather than assigning them: the old window-jQuery watcher alone did not attach on this bootstrap. The document-ready dependency hook now attaches before native results execution.

`node verify-native-capture.mjs /path/to/capture.json` executes the relevant captured native bootstrap, jQuery, rendering, DataTables and advancedFilter modules in an isolated JSDOM page with synthetic data and blocked native XHR. This separately passed initial partial inventory, three completed-render retries, a functional native input filter after retry, native scrolling/page length, one table instance/nav link/control, settled global Ajax and fresh-read restart. Analytics, original captured result data and operational actions are not executed. This is captured-code integration evidence, **not live Tampermonkey proof**. The script fails explicitly if the expected capture layout changes.

The committed tests additionally exercise official test-only jQuery 1.6.4 with an independently authored native loader model. No test library or captured application implementation is bundled in Master.

## Section and lifecycle verification

All 19 native A/L choices/defaults/readback failure; case and singular/plural endpoint labels from deployed markup; lazy unsent requests with no global/native spinner; native success/done/complete and headers; completed partial retry through the identified renderer with no repeated unrelated callbacks; failed read settles once then deliberately recovers; native external abort cannot paint late; stale query/dates and replaced-placeholder barriers; old native DataTables disposal; exactly one nav link/control; normal section hashes keep the current owner; disposal/BFCache restarts use fresh data. The generated installer composes exact badges with private jQuery 1.6.4 and restores them after BFCache.

Canonical read 0.1.1 accepts the captured literal `true` terminal marker, rejects conflicting/truncated markers and owns bounded generic section continuation. It validates table/row shape, follows exact native token POSTs, preserves show-message signals, and strips pagination markers before rendering so the native function cannot launch unowned later pages. Generic semantic completeness stays explicitly unknown; invalid later data remains partial. Query/disposal cancels those continuations.

API basis: official [jQuery ajaxTransport](https://api.jquery.com/jQuery.ajaxTransport/) and [ajaxPrefilter](https://api.jquery.com/jQuery.ajaxPrefilter/) documentation, verified against both the deployed-version fixture and the actual captured library. The captured native rendering function is replayed only for its exact document placeholder/query/options. A completed jqXHR is never re-resolved and native global completion is never fabricated.

## Feature and action verification

Exact FNSKU Size identity and container priorities/three-attempt bound; private fresh inventory reuse; grouped exact-ASIN hazmat/four-worker cancellation/RIVER; raw/history/auth/unknown MADCAT provenance and Sydney cutoff/DST/five-minute caches; partial/stale product barriers; PO split headers/age/numeric inputs; label click/keyboard/four-digit quantities; exact row/current-product/fresh-lookup title association; explicit LPN confirmation; code-only fallback; no automatic print repeat; timeout/disposal UNKNOWN evidence; selected rows/links/partial Title/Firefox multi-range copy; ISS Weight-label entry and cleanup.

Printmon fields and numeric sequence are preserved. Response received is not confirmed job acceptance or physical output; its acknowledgement contract remains undocumented. No real printer request was submitted.

## Remaining live acceptance

The reproduced Retry Inventory source blocker is resolved. The next gate is the standalone V4 installer in Tampermonkey with V2/V3 disabled: read-only native searches, A/L click/navigation, table/filter/date controls, exact Size/MADCAT/hazmat, replacement and BFCache/repeated use, and OBS evidence. Actual browser-world hooks, cross-origin Measurement auth/framing, native date-filter state after repeated rendering, long idle and local printer acceptance remain live requirements. Do not call Master a proven V2 replacement yet or treat the uploaded V2 page as a live V4 run.

No live Amazon service request, inventory mutation, auth acquisition or printer operation succeeded during this verification. All captured-code responses were synthetic and native XHR was blocked in the successful harness run.
