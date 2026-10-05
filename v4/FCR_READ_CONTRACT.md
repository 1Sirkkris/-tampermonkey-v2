# FCR read capability contract

Scope: authenticated native FCR reads required by FCR Master. This unit supplies data and inert markup; it does not install, move or redesign user controls.

Evidence: pinned V2 `FCR_Data_Core.user.js` 0.2.41 and `FCResearch_Master.user.js` 0.1.84 at `e4399d89ff11551ec1afb132d67c448da1e43568`; `BASELINE.md` F06/F07/F16 and current `BRIEF.txt`. Old source is endpoint/behaviour evidence only.

## PRESERVE

- Native FCR warehouse routes: same-origin POST `/{warehouse}/results/{section}` with URL-encoded `s`. Inventory continuation uses `inventory-more` with `token`, not another query. Preserve all twelve inventory fields, original native markup and query identity.
- Product and Inventory are the next consumer's automatic defaults. Other native sections remain deliberate/lazy consumer choices; a data module initiates nothing on construction.
- An inventory first-page preview is available promptly, but carries `complete: false`, `totalQuantity: null` and a warning while pages remain. Full inventory is fresh, never served from a stale tote cache.
- Exact product identifiers/aliases and titles must belong to the requested item. A substring, unrelated table/image or a previous query cannot prove identity.
- Native Inventory History accepts `MM/dd/yyyy` dates using `startSearchDateString`, `endSearchDateString` and `dateStringFormat`; continuation uses `inventory-history-more` with `token`.
- FCR Master also needs external Pandash hazmat, Poirot exact binDescription and authenticated Item Measurement/MADCAT enrichment. These remain explicitly pending until independently contracted and verified; native FCR reads alone do not finish the entire capability.

## FAILURES

- F06: missing/malformed later pages, repeated or invalid tokens, page/row limits and inconsistent quantity totals must never become complete inventory.
- F07/F16: reject unrelated product identity and keep exact aliases with their own title. Do not seed a cache from unverified DOM data.
- Login HTML, redirects, 401/403, unexpected tables, malformed rows and unknown pagination are failures or partial read results, never empty/complete success.
- Caller cancellation, refresh/disposal and a late response cannot publish a new preview/result for cancelled work. OBS failure must not alter a read result.

## STATE

- A plain V4 source capability has explicit injected native fetch/DOMParser, authenticated origin/warehouse and caller AbortSignal. No installed data-core daemon, old globals, RPC bus, shared old storage or universal fleet engine.
- Each read owns its request controllers, timeout, continuation tokens and accumulated inert documents/rows. Disposal belongs to its consumer through AbortSignal. There are no idle observers, timers or network requests.
- No inventory cache and no cross-caller cancellation sharing. The consumer can reuse the preview emitted by its own full read rather than issuing a second lookup.
- Internal source will be included in the eventual self-contained consumer installer. This module is not a standalone Tampermonkey installer and does not require another installed script.

## SUCCESS

- Product: a validated native key/value product table containing the exact requested identifier and its aliases; optional data stays optional.
- Inventory: recognized schema and valid quantity/identity rows on every page, explicit valid pagination termination, no continuation cycle and (when returned) header quantity agreeing with the accumulated quantity. `totalQuantity` is reported only for a complete result.
- An explicit native empty table is valid; an absent table, malformed row or empty nonterminal page is not proof of no stock. Physical/container and differing-disposition rows are retained individually, not deduplicated by SKU.
- Generic sections retain native markup; completeness stays unverified until that section's pagination contract is implemented, whether or not a continuation marker appears. No generic table is silently promoted to complete inventory/history.

## UNKNOWN

- Read failures do not establish operational mutation state and never emit SUBMITTED/CONFIRMED. Optional evidence carries `intent: read` and endpoint/status/phase-of-read counts without raw query/token/body.
- The strict inventory call rejects incompleteness. A display consumer may explicitly request `allowPartial: true`: validated rows/markup survive with `complete: false`, `totalQuantity: null`, a stable error code and a warning.
- Authentication failure remains distinguishable from transport, timeout, schema, identity, cancellation and pagination failure. There is no guessed empty or negative measurement result.

## RESET

- Cancellation aborts active transport and retry delay, releases their timers/listeners, stops pagination and suppresses further callbacks. A subsequent deliberate read starts fresh.
- Read-only 5xx retries are bounded and cancellable. Auth/schema/identity/pagination failures are not blindly retried. No mutation endpoint is exposed.
- OBS is optional and never gates reads. A throwing preview callback cancels that consumer's work; a throwing evidence callback is ignored.

## DEPENDENCIES

- Authenticated native FCR origin/warehouse; native fetch, AbortController, DOMParser and form encoding. Supported section allowlist comes from the pinned Master controls, not arbitrary caller URL construction.
- Known pagination marker: `.pagination-token` containing a JSON object/array; explicit empty/false/null/done ends pagination. Unknown nonempty formats remain incomplete. Fixtures cannot assert live undocumented formats.
- External enrichment authentication/response contracts remain a later slice of this same unit, before FCR Master is called ready.

## VERIFY

Offline fixtures must exercise exact request fields, product aliases/mismatch, reordered inventory columns and all twelve fields, normal/empty inventory, preview then complete, valid repeated SKUs, 5xx/auth/login/redirect, invalid rows/quantities/tokens, missing continuation tables, repeated-token/limit/total failures, explicit partial output, cancellation during request/retry/preview and zero idle traffic. Live native HTML and authentication acceptance remain outstanding.
