# OBS behaviour contract

Reference: V2 `BWU2_Observability_Core.user.js` 0.1.37 at `e4399d8`; audit F14/F15; V3 duplicate/read-noise reproductions. Current V4 brief governs.

## PRESERVE

- Collect across native fleet pages and worker frames; export the combined session from the existing FCR header location beside the warehouse/search area.
- Existing controls: `OBS n/6000` (download current log, then start fresh), `FAT OFF/ON` (50,000 capacity when on; toggle resets and reloads), `Clear`. Warn at 80% and when full. Do not introduce a floating console on every page. Do not mount this inline control in `#iss-console`.
- Useful page/version, workflow, request/response, rejection/error and slow-operation evidence. Normal mode stays concise; FAT adds bounded native response shape/detail. Native traffic must remain untouched.
- Visible V4 build identity, useful exported timestamps/versions, sanitized content, bounded retention and no idle polling.
- The V2 FAT tooltip mentions one hour, but implementation stores a boolean and reloads; no proven automatic expiry was found. Preserve its actual toggle behaviour; do not invent an expiry sequence.

## FAILURES

- F14: GM mutations invisible. Workflow owners must emit explicit intent and phase themselves; collector hooks are supplementary, not the source of mutation truth.
- V3: forwarded worker event duplicates. Collect each document once; no parent-message forwarding listener. Merge deduplicates event identity and operation + phase across shards.
- V3: POST `/status` appears submitted. A native network event never constitutes SUBMITTED or CONFIRMED, regardless of HTTP method/status. Only an explicit workflow-owner mutation event carries a lifecycle phase.
- Prevent auth/token/raw body leakage, stale-session resurrection after Clear, replacement of native fetch/XHR results, lost other-page data, and silent storage/export failures.

## STATE

- The OBS installer owns collector state; each document owns one bounded event shard per session in V4-only GM storage. Session IDs are part of shard keys, so deleting old shards cannot race with new-session writes. GM storage belongs to this V4 installer and is shared across its pages/frames. No V2/V3 state is read.
- A session epoch and mode live in one atomic metadata value and change only on Clear/download/FAT reset. Initial epoch is deterministic, avoiding competing first-page session creation. Every record/flush reads the current epoch. An old frame cannot bring old events into the new session; a failed mode reset cannot leave a partially changed FAT preference.
- Export merges current-epoch shards in time order, deduplicates, and observes the current mode's capacity. Each shard also has a hard bound; limit/full status is honest. Writes coalesce after activity, never poll while idle.
- Cross-page count changes use GM value-change notification; pagehide flushes then cleans listeners, hooks, timers and the header observer. Restore a hook only if it is still ours.
- UI and styles use explicit V4 ownership markers for future Screenshot Mode. Observe only the native header parent once located; use DOMContentLoaded/load for bootstrap, no body-subtree observer.

## SUCCESS

- Collection success means a sanitized event is present in the persisted current-session transcript. It does not prove inventory changed.
- Positive operational confirmation belongs to the workflow engine and its documented response/reconciliation contract. OBS records who asserted it and the operation identity.
- Download success here means the browser download was initiated without an exception. OBS cannot prove the file was saved by the browser. Retain the session if creating/clicking the download fails.
- An export contains each canonical operation phase once, useful version/route context and exact evidence limits. A read-only POST has only network/read evidence.

## UNKNOWN

- Explicit UNKNOWN stays UNKNOWN in evidence. Collector does not retry, resume, reconcile or clear operational barriers.
- Malformed owner messages are rejected as evidence messages; they never alter a workflow. Failed persistence is shown as `OBS STORAGE ERROR` in the FCR control and keeps the local buffer for another flush/export. Native calls and workflow execution continue.
- Failed export leaves logs intact and visibly reports `OBS EXPORT ERROR`.

## RESET

- Clear creates a new session and deletes obsolete OBS shards; other live pages observe the epoch and discard old buffers. It never touches workflow state.
- Download gathers and initiates the text export before resetting. FAT toggle uses V4 preference storage, resets, then reloads as V2 does.
- Reload retains the accumulated session and adds a new document shard. Repeated export/Clear/FAT use must not duplicate listeners or restore old evidence.
- pagehide disposes; BFCache pageshow reinstalls one collector, with the session re-read. Long idle produces no synthetic network requests or recurring timers.

## DEPENDENCIES

- Tampermonkey synchronous GM get/set/delete/list/value-change APIs, page access through `unsafeWindow`, native CustomEvent, Blob/download and page fetch/XHR. No external script/library required.
- Current page authentication is needed only for native traffic; OBS never reads credentials or performs a network request.
- Owner evidence event: `tampermonkey-v4:evidence`, JSON string detail. Fields: `eventId`, `type`, `script`, `version`, optional `operationId`, `intent`, `phase`, and bounded sanitized `data`. Mutation phase values: `SUBMITTED`, `CONFIRMED`, `REJECTED`, `UNKNOWN`. Safe retry is a new operation identity. Read evidence cannot carry mutation phases.
- V4 scripts publish versions with `data-tm-v4-script` / `data-tm-v4-version` on owned UI or version events. OBS is optional; scripts do not wait for its presence.

## VERIFY

Offline installer fixtures: no V2/V3 globals/libraries/storage; current FCR controls/location; normal/FAT capacities and reload; native fetch/XHR success/error semantics unchanged; POST status is not a mutation; GM owner events visible; cross-document duplicate/export/count/Clear race; storage/export failures retain evidence; redaction; pagehide/BFCache cleanup; zero idle interval/background requests. Syntax and independence checks on the exact authored installer.

Live acceptance remains outstanding: Tampermonkey page-world hooks and GM notification timing, deployed FCR header, cross-origin worker frames, actual browser downloads and long idle. No live Amazon operation is authorised merely by these fixtures.
