# FCR Master milestone verification

6 October 2026 (Australia/Sydney). Development installer 0.1.1; **PARTIAL / BLOCKED, not a replacement candidate**.

- Governing brief, baseline, active Master/read/enrichment/auth contracts and both recovery notes read. Latest remote was `fe597914f8f9d8404ea0da8ab162e9d36af929ca`, ahead of the screenshot's native-read checkpoint `977fe33`. Existing 79 fixtures preserved.
- V2 main remains `e4399d89ff11551ec1afb132d67c448da1e43568`; frozen V3 remains `77ff9f7818ea8d2d53422654a7e6b7ca51b6db13`. New source/installers/tests stay under `v4/`.
- `npm test`: **120 passed**, including 17 Master, 11 feature, 10 action and 3 diagnostic cases. The actual pinned jQuery implementation and generated installer are exercised alone; generated-installer composition includes canonical native/enrichment/auth source and the native Measurement branch.
- `npm run check`: both installers' metadata/syntax/independence, source syntax and byte-exact source/installer consistency pass. `git diff --check` passes.

## Native section milestone

All 19 inline A/L choices and defaults; exact preference readback/failure; lazy unsent request/global-loading behavior; native success/done/complete callbacks and headers; same-query deduplication; full inventory continuation and honest partial retry; native auth/schema failure and deliberate retry; stale query cancellation; native table/navigation replacement; disposal/restart; excluded ISS route; generated-installer duplicate start and BFCache restoration.

The native jQuery transport handles only exact same-origin section POSTs with supported native form fields. It supplies canonical validated read HTML through the native application's callbacks rather than fabricating XHR state. Lazy requests have no network or deadline until clicked, and are excluded from native global loading. Page/search disposal aborts their owned jqXHR callbacks. Unsupported requests remain native.

API basis: official [jQuery ajaxTransport](https://api.jquery.com/jQuery.ajaxTransport/) and [ajaxPrefilter](https://api.jquery.com/jQuery.ajaxPrefilter/) documentation; positional completion is supported by the tested native library. This choice is an inference from native HTML/XHR evidence and V2 native section behavior. It is **not proof of the deployed FCR application's library/bootstrap/markup**. Those must be checked in a read-only live acceptance run.

## Feature and action milestone

Exact FNSKU Size identity and container priorities/three-attempt bound; private fresh inventory reuse without opening lazy UI; grouped exact-ASIN hazmat/four-worker cancellation/RIVER; raw/history/unknown MADCAT distinctions; positive Sydney cutoff across both DST transitions and five-minute negative cache; partial/stale product barriers; PO split headers/age/numeric inputs; native label click/keyboard and four-digit quantities; exact native row/current-product/fresh-lookup title association; explicit LPN confirmation; code-only fallback; no automatic print repeat; disposal/timeout UNKNOWN transcript; selected native rows/hyperlinks/partial Title/Firefox multi-range copy; ISS Weight-label route and cleanup. Auto/lazy choices apply to future searches; native Submit/Clear cancels earlier query owners.

Printmon's known query fields and numeric sequence are preserved. A response is reported as response received with unverified acknowledgement; physical output/job acceptance is not confirmed. Tests submit no real printer request.

## Exact blocker and required evidence

The deployed FCR library/bootstrap and native render callback are unseen. A specific offline reproduction now confirms that a retry after the original native jqXHR has completed/been externally aborted cannot reuse its callback. **Retry Inventory parity is therefore incomplete.** The previous generic DataTables fallback was removed before this checkpoint; original native content is retained with an explicit integration error. No alternate table configuration is invented.

The next required evidence is native FCR HTML and loaded page JavaScript. The manual [capture helper](diagnostics/FCR_Native_Capture.user.js) downloads those into JSON, with missing/CORS-blocked assets explicit. Its tests prove idle installation, GET-only asset reads, common credential redaction, no script evaluation, no duplicate capture and pagehide cancellation. Run it on a normal FCR result page via the Tampermonkey menu and provide the downloaded JSON.

From that evidence, establish the native section render/retry/global-loading lifecycle and complete this contract. Do not progress to Tote Audit or label this installer ready while the reproduced native retry gap remains.

## Live limits

Real native FCR/Measurement browser-world access, deployed markup/table settings, long idle/repeated use and local printer acceptance remain unverified. Pure/source/installer fixtures do not establish them.

No Amazon mutation, live auth acquisition or local printer operation was performed. No fixture is live evidence.
