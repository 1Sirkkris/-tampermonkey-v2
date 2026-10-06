# FCR Master behaviour contract

Next consumer after the pushed FCR read capability. Evidence: pinned V2 Master 0.1.84/Data Core 0.2.41 at `e4399d8`, baseline F06/F08/F16 and current `BRIEF.txt`. Current source is behavioural evidence, not proof that every latest V2 change worked live. No V2/V3 source or architecture is imported.

## PRESERVE

| Native behaviour | V4 acceptance requirement |
|---|---|
| Location and routes | Enhance native FCR sections on all four documented FCR hosts. Ignore `#fcr-tote-checker` and `#iss-console`; do not move controls into a universal console. Product Weight label retains the familiar ISS route entry; it must not load/import the old ISS script. |
| Section choices | All 19 native labels retain inline A/L controls. Product + Inventory default AUTO; others default LAZY. Clicking a lazy section loads it; saved choices apply to future searches. Failed preference writes visibly preserve the previous choice. No Apply button is introduced. |
| Native section content | Preserve native headers, tables, links, sorting/filtering/navigation and native section locations. Partial inventory stays visibly partial; Retry Inventory restores a failed read. Do not make all sections fetch on every render or duplicate the same automatic lookup. |
| Product properties | Preserve Sortable, Very High Value, Conveyable and Master Case native values/highlights; never turn an unknown native value into an affirmative safe condition. |
| Exact size | Inline Size badge near Dimensions (or primary item field), automatic read, click/Enter/Space to recheck. Use the exact current product's live inventory preview; prioritize tsX/csX, then P bins, then other containers, quantity descending within a priority; try at most three distinct containers. Return only an exact native binDescription, otherwise Unavailable/error. No dimension guess or unrelated first item. |
| MADCAT | Keep CHECK/AUTH/YES/NO/history/ERROR distinctions and accessible colours/text. Raw checks cover 30 days; history fallback cannot supply raw NO. History/error badge click offers deliberate native login/refresh/retry. Positive raw result cache expires at the next 18:00 Australia/Sydney cutoff; negative raw cache is five minutes. Cache identity includes identifier type/code; force bypasses it. |
| Hazmat | Product badge with native Pandash recheck, inventory badges per ASIN and Recheck N/A + L0. Distinguish valid L0, N/A and ERROR. Retain processing indication and native RIVER handoff on appropriate product L0/N/A; Enter/Space works. Use grouping/bounded concurrency and validated per-ASIN cache to avoid repeated requests on a table repaint. |
| Copy | Native product text/hyperlinks copy without injected Size/MADCAT/Pandash/level labels. Preserve selections of values, labels, rows and clean partial Title selection, including Firefox cell selection. Do not replace ordinary copy elsewhere. |
| Print controls | ASIN/ISBN and FNSKU label click/Enter/Space prints one; inline editable numeric quantity (up to four digits) + Enter prints that quantity. Preserve Alt+click printable rows/codes, code-only fallback, explicit LPN confirmation and local Printmon failure indication. A description must be bound to the exact printed code or its authoritative alias, never the previous product panel. |
| Purchase Order Items | Preserve unfilled/cancelled indicators, the six-month band and seven-month date indication in native columns, including split DataTables headers. |
| Lifecycle/version | One visible V4 build identity and owned UI/style markers, no duplicate controls on native table/header replacement, zero idle requests/polling, clean pagehide and BFCache restoration. |

## FAILURES

- F06/F16: invalid/partial inventory cannot underpin a complete audit or unrelated item title/size. Parsed rows are query-scoped evidence, not a substitute for current authenticated identity.
- Earlier V3 drift: retain native controls, locations, section choices and keyboard interaction. Do not centralize/reduce UI for implementation convenience.
- Search/navigation/clear/disposal must invalidate outstanding reads and queued renders. A late response cannot overwrite another product, print the wrong description or start the next stale request.
- Native authentication errors remain retryable and visible; rejected/malformed/unknown enrichment does not become green/safe/NO. No recurring reconciliation observer or old core daemon is rebuilt.
- Read-only POST is not a mutation. Print and handoff evidence is owned by Master; supplementary native traffic does not assert inventory movement or physical printer completion.

## STATE

- Master owns current query/generation, native section loading state/preferences, product identity, user actions and bounded read caches. Every generation owns an AbortController; native response association must include exact request query/endpoint, not old DOM text alone.
- Include the canonical V4 read/enrichment/auth source in one self-contained installer with native FCR and Measurement site branches. No separately installed core, `@require` to old scripts or V2/V3 storage/event dependencies.
- Source bundling is permitted to avoid copying the three verified modules into another hand-maintained implementation. If used, source/installer consistency, metadata version and tests must be checked before every checkpoint; no stale generated installer is acceptable.
- Use application/native section signals where available and narrowly scoped observers when necessary. Do not observe the full document subtree indefinitely or poll for a title/read result.
- A print request owns its clicked identity, quantity, query and explicit operation ID until sent/failed/unknown. It cannot borrow state from the next panel. OBS remains optional.

## SUCCESS

- A/L preference is positively read back from V4 storage; loaded/partial/error section states reflect the validated read result without changing the native navigation workflow.
- Product/size/hazmat/MADCAT badges reflect the exact active query with the verified source capability's evidence limits.
- Copy output contains the actual selected native information and preserves appropriate hyperlinks; injected controls are removed from the copied representation.
- Printing submits the specified code/quantity and correctly scoped description through native Printmon parameters. A successful browser fetch is not proof of physical label output; accepted-job evidence requires a documented service acknowledgement.
- RIVER action only opens the correct warehouse/workflow handoff; no final ticket submission is performed by Master.

## UNKNOWN

- Keep current native content and a visible retry/error/partial state when read data cannot be established. Raw MADCAT, history and unavailable/auth states remain distinct.
- Failed/unresolved print transport never causes an automatic repeat. A later deliberate print remains a new user action; do not infer a printer acknowledgement format that has not been observed.
- Unsupported native markup/control anchoring is a visible integration failure. Do not silently omit a feature or compensate with a different panel/location.

## RESET

- A new search/hash/navigation generation aborts its reads/auth frames and prevents further callbacks. Saved A/L choices survive; inventory is fetched fresh and transient product/action state does not.
- pagehide removes owned listeners/observers/timers/UI/styles and restores only owned hooks. BFCache pageshow reinstalls exactly once with new signal ownership.
- Manual retry/recheck is deliberate, bounded and tied to the current identity. Long idle is inert.

## DEPENDENCIES

- Canonical V4 native FCR read, enrichment and Measurement auth source; current native FCR markup/section labels and authenticated endpoints.
- Native Printmon `http://localhost:5965/printer` uses existing barcode hex/data/text/quantity/description/badge/sequence fields. Current source does not establish its acknowledgement body; capture that contract before claiming a confirmed job.
- Native RIVER workflow/handoff URLs and the later independently implemented V4 ISS route. They do not authorize an inventory mutation or ticket submission during fixtures.

## VERIFY

Use the actual self-contained installer alone. Add fixtures for all 19 native A/L choices/defaults/readback failure; lazy/automatic query association and no duplicate reads; table replacements/repeated use; exact identity and stale query cancellation; Size priorities/three-container bound and keyboard; raw/history/auth/cache cutoffs including Sydney DST; hazmat grouping/errors/rechecks/RIVER identity; plain/HTML copy and partial selection; quantity/Alt+click/LPN/description/Printmon error semantics; PO indicators; pagehide/BFCache and zero idle work. Re-run all 79 existing fixtures and source/installer metadata/independence/consistency checks. Deployed markup, actual native auth and local printer acceptance remain live gates.

## Captured native integration contract — 6 October 2026

The user-supplied native capture establishes the deployed bootstrap and renderer. FCR obtains its private jQuery 1.6.4 through `AmazonUIPageJS/P`; it need not assign `window.jQuery`. AUI defines its globals with `Object.defineProperty`, bypassing assignment setters. At DOMContentLoaded use its synchronous `now('jQuery')` dependency signal before the native results module's ready gate; use `when('jQuery')` if the dependency is not yet declared. Native navigation uses `#sections-list`, endpoint-specific status rows and `.section-placeholder`; labels may differ in capitalization. The deployed singular `problem` endpoint is labelled Problems, and plural `problems` is labelled Problem.

For each section the native loader makes a bare `{type:'POST', url, data, dataType:'html'}` request and immediately registers one `.done` rendering function. That function creates its HTML afresh from its first argument; its status/jqXHR arguments are unused. Preserve this identified native renderer for the exact generation, dates and placeholder. Capture only that first synchronous registration on this precise native request shape, then restore the request's original `.done` method. Retry calls the retained renderer with fresh validated, token-free HTML; it must not re-resolve the completed jqXHR, repeat other subscribers, or simulate another global Ajax completion.

Before a replay, destroy the old native DataTables instance and unwrap the section's existing native navigation link. The retained renderer then recreates the native sorting, scrolling, sum/deviation headers, advanced filters, hierarchy draw callback, timestamp formatting, sizing and calendars. Reject a renderer whose original placeholder has been replaced. Failed canonical reads settle their native request once, remove native loading, show failure and permit deliberate retry through this retained renderer. Lazy sections hold no native/global spinner while unsent. Reset/disposal invalidates every retained renderer; no callback from an earlier query/dates/page lifetime may render.

The document retains only these native rendering capabilities across BFCache/ISS/Tote route transitions. A new runtime rebinds an exact query/placeholder capability to a new generation and fresh automatic reads; it never adopts old results or pending work. Normal `#section-nav` navigation keeps the active generation and lazy read intact. A different query/date selection or replaced placeholder invalidates the corresponding capability.
