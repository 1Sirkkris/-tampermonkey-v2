# V3 architecture — 0.2.0

V2 defines behaviour. The previous V3 branches supply evidence, not runtime dependencies.

| Surface | Owner | Shared implementation |
|---|---|---|
| FCResearch | Native information, Tote Audit, Bin Check, Pandash, contextual MoveContainer/Unbind, exact print/copy | FCR parser, Pandash service, native action workers |
| ISS Console | Dedicated Poirot Edit, Move, Sideline, FCSKU | AFT engine through its authenticated native worker; local Sideline engine |
| Native AFT | Edit EACH/SKU/DATE, Move, FCSKU | Same AFT engine and workflow forms |
| Native Sideline | Lazy, Tote Queue, native QTY, date picker | Same Sideline engine; explicit native controls |
| Native Hierarchy | Typed-FC Bind and Unbind queues | Hierarchy engine and durable queue |
| Native MoveContainer | Floor/dropzone queue | MoveContainer engine and durable queue |
| RIVER | FCR capture and native step assistant | Strict FCR data; cancellable generation |
| FNSKU, PO, Carton, Calm, SIM | Their native applications | Transport, native input, lifecycle, UI primitives |
| OBS / Screenshot | Independent collector / Ctrl+Q helper | Sanitized operation events / UI markers |

## Shared concerns

- `core.js`: normalization, lifecycle, UI and sanitized telemetry.
- `state.js`: synchronous mutation journal, browser-owned Web Locks, durable queues.
- `transport.js`: bounded requests, abort handling, authentication/HTML classification. No mutation retries.
- `identity.js`: current authenticated application evidence; mutable controls and script UI are excluded.
- `native.js`: native fields, input events and active-only waits.
- `bridge.js`: lazy authenticated workers, source/origin validation, serializable commands, active deadlines. No heartbeat or idle readiness polling.
- `pandash.js`: one exact-ASIN service for FCR and Sideline.
- `aft.js`, `sideline.js`, `actions.js`, `fcr.js`: canonical domain engines.
- App modules own native controls and orchestration.

## Mutation and recovery

`PREPARED → SUBMITTED → CONFIRMED / REJECTED / UNKNOWN`

Persist SUBMITTED before sending. UNKNOWN is terminal and retains a verification barrier. A reload quarantines active queue rows and excludes known moved/uncertain items from normal remaining work. Only an explicit user verification clears the barrier; it never triggers a mutation itself.

Browser-owned locks do not expire when a tab is throttled. Queue editing uses the execution lock and refreshes stored state before writing. Queue ownership and mutation ownership have distinct purposes.

Bind validates the user-entered destination FC through the native page. Only `/validateDestination` supplies the temporary opaque destination ID, after Amazon returns the matching FC. The proof and edit revision remain in memory. No Bind auth/header/cookie capture and no direct force-bind or mutation interception.

## Reads and idle activity

FCR full inventory is requested only for explicit workflows. Continuation fragments, tokens, quantities and schemas must validate. Native product information uses native inventory already loaded by Amazon. Hover reads are user initiated and bounded in cache size.

MADCAT observes only native measurement response bodies. It does not copy authentication material. YES requires a dated raw event inside 30 days; NO additionally requires a complete response covering the window. Incomplete history is shown as unavailable. Native authentication, iframe policy and Amazon response shapes remain user-test requirements.

Observers monitor native workflow/result containers or an active bounded wait. No idle intervals, lease timers or keepalive messages. The user-selectable Sideline delay is retained as familiar workflow behaviour.

## Validation boundary

Generated installers are self-contained and reproducible. Static, domain, DOM fixture, ownership and recovery regressions do not prove live Amazon workflows. Live results and OBS exports are the next source of evidence.
