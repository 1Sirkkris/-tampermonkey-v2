# FCR external enrichment contract

This is the next slice of the FCR read capability, before Master integration. Evidence: pinned V2 Data Core 0.2.41 and Master 0.1.84 at `e4399d8`. No old implementation or authentication storage is used.

## PRESERVE

- Pandash: restriction GET `GridServlet?fc=BWU2`, then form POST with `source=<restriction>-hazmat-FC`, `marketPlaces=AU`, exact `asins`, `rows=1`, `page=1`, `fc` and `language=default`. Explicit native level zero remains zero; missing data does not become zero.
- Poirot: read-only `api/scanitem`, container/item identity, null masterpack/andon fields and a fresh native request ID. The API's existing `tool: V3` field is a server protocol value, not a V3 implementation dependency. Read native `items[].binDescription` only for an exact item/verified alias, never a dimension estimate or an unrelated first row.
- Measurement: authenticated ID-token GET on the native Japanese Measurement API for FNSKU (preferred) or ASIN, fixed rolling 30-day window, sequential `nextToken`, and raw MADCAT source/time checks.
- Auth renewal is bounded and on demand. Future Master preserves automatic native auth acquisition and its existing deliberate visible login/retry action. Auth capture/transport installation is a separate integration slice, not satisfied by a mock token provider.
- History fallback remains explicitly `history-fallback`, with no claim of a validated raw 30-day negative. A partial negative is UNKNOWN. Consumer badges distinguish raw, history and auth/error states as V2 does.

## FAILURES

- Login/redirect/HTTP/invalid JSON, ambiguous exact rows, malformed levels/events/tokens, repeated/remaining continuation and cancellation never become safe/negative success.
- FNSKU-specific bin data cannot be accepted merely because a different SKU shares the ASIN. Conflicting exact sizes remain unresolved.
- Native GM transport returns one settled promise, preserves cancellation ownership and releases listeners; synchronous callbacks and late events cannot double-settle or revive cancelled reads.
- Tokens, query bodies and response payloads are never emitted to OBS. No inventory mutation endpoint is exposed.

## STATE

- Each call owns its signal and pagination window. Native authenticated GM requests are injected through a validated read-only JSON adapter. There is no daemon, shared old storage, competing owner or idle polling.
- The Measurement auth provider returns current native `{token, expiresAt}` and supports one renewal after auth rejection. Authentication capture must be implemented independently in the same eventual installer on both native origins.
- Measurement capture observes the effective outgoing Authorization header on the native API request, preserving V2's request-time acquisition. It does not wait for the native item's response: an item error is not evidence that its credential is unusable. Only fresh ID tokens are stored; unused overridden headers, unrelated endpoints and disposed collectors cannot seed auth. This is an observed credential, not acceptance or signature proof. The subsequent raw API read validates authentication and owns one renewal after rejection.
- V4-only `tm-v4.measurement.auth` stores the observed token with a unique capture record. Acquisition uses a temporary inert native item frame, GM value-change notification and one deadline. It reuses a current token when permitted, requires a distinct token after auth rejection, and removes frame/listener/timer on every exit. No poller or hidden automatic login popup is introduced; visible login remains a deliberate consumer action.
- Source capabilities are included in the eventual self-contained Master; they are not separately installed dependencies.
- Pandash retries only read-only restriction/hazmat requests after network/timeouts, HTTP 429 or 5xx, at most twice (500/1500ms), with cancellation throughout. AUTH, permanent HTTP and invalid schema do not loop. Restriction reads share work only among callers with the same cancellation owner; validated restrictions expire after 30 minutes. Failed/default restrictions are not cached. Exact hazmat levels remain strict; a missing message now triggers bounded incomplete-data rechecks, as approved below.
- MADCAT rechecking bypasses its result cache without unconditionally renewing a usable token. An auth-required history fallback watches one native auth update for the current generation and can automatically recheck once. It never polls or retries indefinitely; manual login/retry remains available. Auth acquisition and Pandash attempts emit stage/outcome/status evidence without credentials, identifiers or response bodies.

## SUCCESS

- Hazmat has one unambiguous exact ASIN row with a valid nonnegative integer level, a nonempty native message and a validated restriction.
- BinDescription has unambiguous exact item evidence and one consistent nonempty description.
- MADCAT YES has a valid raw MADCAT event inside the requested 30 days. MADCAT NO requires schema-valid pages through a validated terminal token. Raw and history evidence stay distinct.

## UNKNOWN

- Missing exact hazmat/bin result returns an explicit incomplete read. Invalid schema/auth/transport raises a typed read error.
- No token, exhausted renewal or Measurement HTTP 400 can use a distinctly labelled injected history fallback; no fallback or incomplete negative returns `madcat:null`/auth-required or a visible failure, never raw NO.
- Positive history evidence can be shown as history YES; it does not establish the raw 30-day window.

## RESET

- Stop/Clear/navigation cancellation aborts native GM handles and prevents pagination/renewal/fallback/result publication. Each retry is a new read request. No timer or request runs while idle. The sole auth-required recovery listener waits for one native update and is removed by that update, manual retry or generation reset.
- No cross-call inventory cache. Master cache/performance behaviour and user-triggered force rechecks remain integration requirements.

## DEPENDENCIES

- Native authenticated `GM_xmlhttpRequest`, Pandash, Poirot and Measurement API; ID-token freshness from the native Measurement application. Live token acquisition and browser-world access are still separate gates.
- Optional V4 OBS owner messages: explicit read intent, version, endpoint/outcome and bounded counts/error codes only.

## VERIFY

Fixtures cover exact/ambiguous/missing rows, protocol fields, auth/login/redirect/JSON/transport failures, synchronous and late GM callbacks, cancellation, valid level zero, FNSKU/ASIN mismatch, MADCAT date window, complete negative vs incomplete pages, renewal once, fallback provenance, malformed/repeated tokens, no raw/token evidence and idle construction. Fixtures are not native auth or live operational proof.

## Approved Hazmat/capture correction — 11 October
STATE: one Hazmat POST budget covers missing exact rows, missing level/message and transient network/429/5xx outcomes: initial read plus no more than two automatic rechecks. Auth, permanent HTTP, conflicting identity and malformed nonmissing values never loop. Cancellation stops later reads. Restriction fallback may be read for diagnostics but cannot validate L0/processable data. SUCCESS requires an exact unambiguous ASIN, valid level, nonempty native message and validated restriction. UNKNOWN returns hazmat:null/complete:false after exhaustion; no missing value becomes zero. Manual recheck is independently available at all times, including during loading. Explicit native L0 with complete evidence remains L0. Measurement uses one page hook with independent subscribers for separate Master/Tote storage adapters; disposal removes only its subscriber, and the last one releases the hooks. Native Promise/return/error semantics and credential redaction remain unchanged.
