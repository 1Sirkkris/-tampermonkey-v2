# Rebuild checkpoint — batch 5 complete

Branch: `v3-groundup`.
Current approved scope: RIVER + FNSKU Mapping. Batches 1–4 history follows.
Status: implementation and automated validation complete; live Amazon testing pending. STOP HERE until the user approves a further batch.

## Delivered versions

- `V3_Sideline.user.js`: 0.2.1.
- `V3_ISS_Console.user.js`: 0.2.1.
- The other twelve generated installers are byte-identical to the batch baseline.
- V2 main and the V2 Restructure script were not edited.

## Evidence and changes

Three unique OBS exports from Oct 4 at 21:07, 21:20 and 21:21 UTC were examined (62, 397 and 59 exported events). They repeatedly report `$(...).some is not a function`; the V2 Restructure detector calls `.some` on `querySelector`'s single element. Its failure is relevant historical evidence, not a live V3 result. The V3 native detector operates on an explicit array, including native div/b heading labels.

Native date selection now starts from the actual date screen, including startup on that screen, rather than relying on an earlier captured source scan and redundant preflight request. One picker serves native and Lazy paths. Selecting a valid year completes date selection; invalid and leap dates remain rejected. Native production entry does not pretend to know shelf life; Lazy production conversion still requires it.

QTY toggles open/closed and preserves all ten quick selections. Sideline uses the canonical persistent queue engine with its own Stop/clear controls; it no longer imports unrelated queue UI controls. The first Stop finishes any submitted action and prevents another close; a subsequent Stop clears ordinary fields/rows. Uncertain rows and mutation barriers survive clearing and reload. Lazy Stop also cancels outstanding preflight reads before sending a move.

ISS still uses the canonical native AFT bridge/engine, with a separately disposable worker lifecycle. Stop before worker startup completes prevents delayed dispatch. Stop after dispatch but before progress preserves UNKNOWN. After progress, Stop finishes the current action. Ready/success and failed-startup cases are covered. The exact logged V2 crash is not claimed fixed in V2.

## Validation

`npm run verify` passed: generated output, syntax/metadata, domain/architecture/engine tests, all installer fixture startups, and the new Sideline/ISS regressions in `tests/sideline-iss.test.mjs`.

Fixtures cover native date reload and transitions, automatic year selection, production/expiry handling, invalid leap dates, QTY and toggle, Stop during validation, second-Stop clearing, uncertain close quarantine, preflight cancellation, ISS success/startup timeout, startup Stop, uncertain dispatched Stop, and stopping after progress.

No live Amazon inventory mutation was submitted. Authentication, native deployed markup and real backend outcomes remain unproven. ISS requires the existing V3 AFT Tools worker; do not enable the old V2 worker alongside it.

## Proposed next batch — not approved

AFT Tools + Hierarchy. Review the actual native Edit/Move/FCSKU engine and Bind/Unbind contracts against V2, history and OBS. Ask for explicit approval before starting implementation.

This is a scoped recovery batch, not a claim that every V3 script or all archived work has been fully reviewed or rebuilt.

## Batch 2 — approved AFT Tools + ISS Console

Both installers delivered at 0.2.2. Only these two generated installers differ from the publication parent (6b9a0d2); other twelve are byte-identical to that parent. Concurrent SIM changes on the remote branch were preserved. V2 remains untouched.

Reproduced invalid calendar dates being rejected only after the native engine confirmed removal of existing expiry. The canonical AFT date engine now validates every date in the entire batch before any network request. Validated native payloads are reused during entry. If removal succeeds but replacement fails, the item is quarantined with a persistent AFT UNKNOWN barrier and requires review. Completed rows are excluded from remaining work on later failures; unsubmitted rows are retained.

Full npm verification passed, including new date fixtures: invalid first/later rows cause zero requests/removals, leap-day success, replacement failure preserves attention, and earlier confirmed rows are excluded from a later failure. Existing ISS startup/Stop regressions also pass. No live Amazon mutations were performed; deployed markup and backend outcomes remain unproven.

## Batch 2 checkpoint — superseded by batch 3 approval

Proposed: Hierarchy only. Reproduced Bind falsely confirming a different container's success text. Review exact Bind identity proof and preserve Unbind contracts. Its current shared actions module is also bundled into FCResearch and MoveContainer: isolate Hierarchy's adapter before implementing so those installers remain unchanged. If that cannot be achieved without behaviour changes to other scripts, stop for revised approval. Do not start this batch automatically.

## Batch 3 — approved Hierarchy only

Delivered `V3_Hierarchy.user.js` 0.2.1. The other thirteen installers are byte-identical to this batch's parent. V2 files remain untouched.

Reproduced Bind accepting another container's success text. V2 native contracts provided the evidence for `/validateContainer`, `/getTransshipmentBindingSummary`, `/validateDestination` and `/forceBind`: request container/destination must match, validations must prove BWU2 and response must contain the known nonempty string `hostName`. Success text alone is no longer proof. The new event-driven native observer correlates request-start sequence, POST method, container and destination and rejects contradictory, missing, redirected or error responses. It observes native Bind; it never issues a Bind API request. Only fields needed for proof are retained in bounded memory, without credentials or idle polling.

The native page can submit on its first scan when already at confirmation. Journal ownership is persisted before scanning, and an observed first-scan Bind is confirmed without a second scan. Submitted ambiguity creates a persistent UNKNOWN barrier; pause prevents the next scan while allowing submitted confirmation to finish. Destination proof remains valid through long queues and is invalidated on native destination changes. Unbind keeps authenticated identity and V2 request shape; malformed/contradictory mutation responses require review, and pause before submission sends no mutation.

The active canonical Hierarchy engine is now `src/hierarchy.js`, used by both native UI and its FCResearch worker. Hierarchy no longer imports the unrelated movement module. Older unreachable Hierarchy helpers remain inside the unchanged FCResearch/MoveContainer bundles until their approved cleanup batch; those apps invoke the Hierarchy worker rather than those legacy helpers.

`npm run verify` passed. New fixtures cover native XHR, fetch and Request bodies; exact request/response proof; text-only and not-bound messages; wrong container/destination; first-scan mutation; duplicate submission detection; lost/negative/HTML/redirected responses; UNKNOWN replay and reload barriers; changed destination; pause before Bind and after submission; a long queue beyond the traffic buffer; and Unbind payload, authenticated identity, pause, read validation, rejection and uncertain outcomes. No live Amazon inventory mutations were submitted. Current deployed markup and backend contracts remain unproven until a live test.

## Batch 3 checkpoint — superseded by batch 4 approval

FCResearch + MoveContainer. Review native movement, destination selection, audit/bin behaviour and movement outcomes against V2; remove their unused Hierarchy helpers now that native Hierarchy owns the active engine. Keep other installers unchanged. Shared module behaviour outside this pair requires revised approval. STOP HERE; do not start automatically.

## Batch 4 — approved FCResearch + MoveContainer

Delivered both installers at 0.2.1. Only these two generated installers change; other twelve remain byte-identical to the publication parent. V2 remains untouched. Six unique scripts have now completed scoped recovery batches: Sideline, ISS Console, AFT Tools, Hierarchy, FCResearch and MoveContainer. Eight installers still await their own batch review: RIVER, FNSKU Mapping, PO Portal, Carton PrEditor, Calm Code, SIM Toolbar, OBS and Screenshot Mode. These batches do not establish live correctness or completion of every fleet behaviour.

Evidence: reproduced two rapid physical scans displayed as ×2 but counted as one unit by the previous V3 Tote Audit. Read the current 1667-event OBS export (`BWU2_Observability_2026-10-05T00-27-36-233Z_1667events.txt`) for relevant FCR evidence; its historical `/inventory-more` requests at 23:37:11 UTC returned HTTP500. That export is V2 evidence, not proof of a V3 runtime failure. V2 FC Lite, Bin Check and Dropzone/Actions Core provided behavioural contracts for native inventory, exact internal FNSKUs, filtered snapshots, printer payloads, destinations and pause-after-current movement. No live Amazon inventory mutation was performed.

Tote Audit now owns a clean controller in `src/fcr-audit.js`: every queued physical scan is accounted for, duplicate system rows retain their separate quantities, direct internal FNSKU scans cannot expand through a shared ASIN, and known native identifiers avoid redundant product requests. Excess physical units are shown as OVERAGE. Failed or incomplete full inventory keeps incoming scans pending for explicit retry; it cannot report those items NOT IN. Reset or source changes invalidate old responses.

The clean FCR data implementation is `src/fcr-data.js`. It validates exact product identifiers before caching, preserves bounded read-only pagination retries and completeness checks, and provides one row parser for full inventory and filtered Bin Check. RIVER still imports the unchanged historical `src/fcr.js`; migrate it to the canonical data engine during its approved batch, then remove that legacy source. This separation keeps RIVER byte-identical and avoids runtime patch/wrapper layering.

Bin Check ignores obsolete snapshots and stops scheduling their remaining floor reads. Its Copy and Alt-print controls use the displayed snapshot. Native bin description lookup rejects another FNSKU sharing the requested item's ASIN or echoing its barcode. Item/Pandash panels discard delayed results after another code is entered, so an older ALLOWED result cannot overwrite a newer item check.

The shared movement engine in `src/actions.js` now contains only movement contracts and routing constants: inactive Hierarchy code was removed from both approved installers. It preserves the known empty synchronous 200/204 V2 response convention and exact request payload. Accepted/pending, contradictory, redirected, HTML and mismatched echoed container/destination responses are UNKNOWN and cannot replay automatically. Invalid saved floors recover to P2/PRIME rather than produce an empty floor. Native queues still finish a submitted move after PAUSE and leave the next row queued. Hierarchy remains the active native Unbind worker for FCResearch; its installer is unchanged.

Full `npm run verify` passed, including new `tests/fcr-move.test.mjs` fixtures: rapid duplicate UPC resolution, exact identifier fast path, distinct identical rows, SKU isolation and overage, failed/incomplete inventory with pending-scan retry, source/reset invalidation, unknown product resolution, exact product cache rejection, bounded HTTP500 continuation failure, native bin attribution, real Tote UI count, stale item/hazard results, filtered snapshot generations without extra reads, Copy/Alt-print payload, saved-floor repair, exact movement payload, PAUSE-after-current and UNKNOWN replay prevention. Real deployed markup/authentication/backend responses remain unproven.

## Batch 4 checkpoint — superseded by batch 5 approval

RIVER + FNSKU Mapping. Review native RIVER scans/quantity and lookup/copy flows, migrate RIVER to the canonical FCR data implementation, and review exact regional FNSKU matches/partial-region outcomes against V2 and OBS. Keep other installers unchanged; edits to shared engines that affect earlier scripts require revised approval. STOP HERE and wait for explicit approval.


## Batch 5 — approved RIVER + FNSKU Mapping

Both installers delivered at 0.2.1. Only this pair changes; other twelve installers remain byte-identical to the publication parent. V2 remains untouched. Eight unique installers have completed scoped review batches; six remain: PO Portal, Carton PrEditor, Calm Code, SIM Toolbar, OBS and Screenshot Mode.

V2 RIVER's dated latest-PO selection and FNSKU native GET/pagination forms supplied the contracts. RIVER now imports the canonical `src/fcr-data.js`; the unused legacy `src/fcr.js` is removed. The canonical data engine and FCResearch installer are unchanged. Ambiguous undated matching PO lines cannot silently choose the first. Quantities require safe whole numbers, and zero live inventory remains evidence of disagreement with a positive PO. Manual blank quantity cannot become zero. Native field lookup includes associated labels and excludes assistant UI. Observers arm before native Next, catching synchronous transitions; disabled Next cannot advance. Clear/disposal invalidates pending writes. Create/manual steps remain manual.

Capture serializes button work, invalidates old results on input changes, clears obsolete saved capture, requires a valid ASIN and opens only a newly captured, generated RIVER URL. Failed or obsolete capture cannot revive a previous payload through Open.

FNSKU lookup now validates returned table/schema/identities and reads every native continuation before using regional results. Repeated, missing, changed-identity or off-origin/path continuations fail explicitly; native GET forms retain the requested identity. Authentication HTML is failed regional evidence rather than an empty success. Conflicting exact ASINs across pages prevent guessing. Regional failures remain visible and successful exact rows survive a failed JP ASIN expansion. Exact input FNSKU proof and JP related-ASIN rows are separately labeled, with region and deduplicated rows. Input changes abort pending reads and discard stale results; teardown cancels work.

Full `npm run verify` passed, including `tests/river-fnsku.test.mjs`: multi-page ASIN conflicts, GET continuation forms, missing continuation, authentication HTML, partial exact proof retained, stale lookup/capture rejection, zero disagreement/manual choice, synchronous Next recognition, final create staying manual, and undated PO ambiguity. Existing RIVER Clear regression and all earlier batches also pass. No live Amazon workflow or inventory mutation was submitted. Actual deployed markup, regional authentication/token acceptance and backend operation remain unproven.

## Current next batch — approval required

PO Portal + Carton PrEditor. Review their native interaction and request contracts against V2, rebuild within this pair and verify the other installers remain unchanged. STOP HERE; require explicit user reapproval before implementation.
