# Recovery evidence — FCR native reads

This session stopped after two checkpoint ref updates were rejected because another writer advanced `v4-cleanroom`. No FCR implementation was started here. This document preserves additional reference findings; it does not supersede the active `FCR_READ_CONTRACT.md`, `CHECKPOINT.md`, or the governing brief.

Observed published checkpoints: OBS 0.1.1 at `5d8ae2f61a18907f04d668a51347b1df34b06b5c`; independently verified OBS 0.1.2 at `403eef39485b55ba508193257495d3c0ffb6d23c` (26 fixtures plus static checks); another writer's FCR contract at `4fd91e5d157e80b161deae069e57659458ccf417`. Live OBS acceptance remains pending. V2 `main` remained `e4399d89ff11551ec1afb132d67c448da1e43568`; V3 remained `77ff9f7818ea8d2d53422654a7e6b7ca51b6db13`.

Recovery: use the latest published branch, its active checkpoint, and a single active writer before implementation resumes. Two unreferenced API commit objects and local unpublished commits are not published checkpoints. The contract below records behavioural/source evidence only, not completed implementation or live proof.

# FCR read capability contract — first consumer

Reference: V2 Data Core 0.2.41 and Master 0.1.84 at `e4399d8`; audit F06/F16; Oct 5 OBS shows native POST `/BWU2/results/inventory`, `inventory-more`, `inventory-history-more` and product calls, including continuation HTTP 500. These logs establish routes/outcomes, not full response bodies.

Scope of this recoverable unit: native FCR section/product/inventory/history reads needed by the first Master consumer. Measurement authentication/MADCAT, Pandash, Sideline binDescription and printing remain explicit subsequent Master dependencies; this unit does not claim to replace all Data Core capabilities. No standalone core UI or fleet architecture is prescribed.

## PRESERVE

- Keep FCR's native page and native sections. Master defaults Product + Inventory to automatic loading and retains its other section choices. The read capability itself adds no controls or relocated panel.
- Native POST form requests to `/<warehouse>/results/<section>`, `credentials: same-origin`, `s=<search>`, appropriate HTML/XHR headers. Continuations POST their opaque token to `inventory-more` / `inventory-history-more`.
- Product fields: native identifiers, title, dimensions/weight/sortability/image. Inventory retains all twelve named columns and duplicate rows/quantities; never reduce records merely because identifiers repeat.
- Early inventory preview can render explicitly partial while more pages load. Complete audit inventory requires the full result. Inventory history preserves an intentional partial-display result with a warning.
- Date-range history uses `startSearchDateString`, `endSearchDateString`, `dateStringFormat=MM/dd/yyyy`; validate real dates before any request.
- Native read failures remain visible and deliberately retryable by the eventual UI. Read-only transient server retry may be bounded; do not import V2's retry/dedupe/group framework.

## FAILURES

- F06: repeated token, page ceiling, missing/malformed rows/token, HTTP/auth failure or contradictory quantity cannot escape as complete inventory. A display preview is never an audit base.
- F16/exact-item lessons: cached/native product data for another query cannot supply the requested item's title or aliases. Typed identity-sensitive product lookup accepts authoritative matching identifier fields; unrelated-only/multiple contradictory records are unresolved. Native section HTML remains query-scoped data, not proof of an inferred cross-identifier relationship.
- Handle fragment continuation rows as well as full tables without silently dropping malformed rows. Explicit end markers and advertised quantity, where present, must agree with completion. Arbitrary empty responses are not terminal proof.
- Cancel and ignore stale reads on search/reset/navigation. A consumer's cancellation must not abort another consumer's independent request. Do not retain inventory as a cross-run cache or guess identity from old DOM panels.
- Login HTML/redirects or JSON masquerading as a native HTML section are not successful section data. No live proof is claimed from mocked fixtures.

## STATE

- A read call owns its request, abort signal, timeout and pagination accumulator. The consumer owns current search/generation/render state and decides whether a returned query-scoped result is still current.
- Initial implementation does not need shared in-flight ownership or durable caches. Add cache/deduplication only for a demonstrated consumer need, scoped by host/warehouse/query and validated identity.
- Inventory result carries rows, preserved section markup, pages, quantity sum, optional advertised quantity, `complete`, and an explicit warning for display partials. Strict calls throw with their partial evidence instead of returning a runnable complete result.
- Product extraction keeps declared identifier fields; it does not broaden a scanned FNSKU/FCSKU to every label on the same ASIN. Query association and verified aliases are distinct concepts.
- Temporary DOMParser documents are response parsing, not workflow state. No broad observer, idle timer, cross-window event RPC or old core global is needed here.

## SUCCESS

- A section read requires an acceptable native-origin final URL, successful HTTP status and expected HTML fragment/schema. Product/inventory parsers positively validate their table/fields.
- Complete inventory requires valid rows through a validated terminal page, no unresolved/repeated continuation, bounded page count and agreement with any advertised quantity. Preserve zero quantities and duplicates; reject invalid or negative quantities.
- Strict product match is exact in a native authoritative identifier field after whitespace/case normalization. A response may supply native query-scoped HTML without establishing an unrelated alias; consumers cannot turn that into a verified mapping or unrelated print title.
- Generic section reads return their native query-scoped markup and status; completeness is asserted only where the section's pagination contract is implemented. A consumer cannot infer complete history from a generic unpaginated fetch.

## UNKNOWN

- Read uncertainty is a visible read error/partial result, not an inventory mutation state. This capability never emits SUBMITTED/CONFIRMED movement phases.
- Strict inventory throws on incomplete/unknown data; intentional preview/partial display keeps `complete:false`, unknown total and a useful warning. No NOT-IN decision is supported from it.
- Unsupported schema/identifier mapping, malformed opaque token or an ambiguous product remains unresolved; preserve the native UI and resolve real markup at Master integration. Do not silently discard controls or invent a new numeric-barcode workflow.

## RESET

- Consumer Stop/Clear/navigation aborts its read signal and invalidates its generation. Abort during body reading/pagination prevents the next continuation. Timeouts and cancellation listeners are removed on every exit.
- Refresh obtains fresh inventory. Repeated calls have independent accumulators/signals; no other installed script must initialize anything.
- No requests or recurring timers exist until a consumer deliberately invokes a read. A bounded request deadline is allowed.

## DEPENDENCIES

- Authenticated native FCR origin and warehouse route, native fetch, AbortController and DOMParser. Source evidence supports form POST and HTML tables/fragments with `.pagination-token` content and `#table-inventory` column IDs.
- Section allowlist follows V2's actual native sections: product, inventory, inventory-history, container-history, purchase-order-item, purchase-order, receive-history, shipment, container-hierarchy, employee, carton-general-info, carton-contents, sscc-info, carton-ambiguities, vision-tunnel, problems, problem, event, authenticity-item.
- Optional V4 OBS read evidence with script/version/endpoint/pages/outcome; never raw continuation/auth tokens. OBS installation is not a dependency.
- Measurement/MADCAT, Pandash, Sideline binDescription and local Printmon (`localhost:5965`) will have their own explicit request/identity/auth contracts in Master. Proven badge/recheck/printing workflow is still required there.

## VERIFY BEFORE COMPLETION

- Offline native-response fixtures: exact product and unrelated/ambiguous identifiers; complete multi-page inventory including row fragments and duplicate/zero quantities; explicit partial preview; repeated/malformed/missing continuation and missing rows; total mismatch; strict failure vs honest partial display; history dates/pagination; redirects/login/HTTP 500; cancellation during fetch/body/continuation; independent calls and zero idle work.
- Syntax and independence; exact source/API request contract; no V2/V3 code/global/storage/events/libraries. Consumer integration and deployed markup are subsequent live acceptance, not evidence already obtained here.

Next: independently implement these scoped reads, then fixtures and a pushed checkpoint. Master is a separate unit and remains unimplemented.
