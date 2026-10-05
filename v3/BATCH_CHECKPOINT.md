# Rebuild checkpoint — batch 3 complete

Branch: `v3-groundup`.
Current approved scope: Hierarchy only. Batches 1–2 history follows.
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

## Current next batch — approval required

FCResearch + MoveContainer. Review native movement, destination selection, audit/bin behaviour and movement outcomes against V2; remove their unused Hierarchy helpers now that native Hierarchy owns the active engine. Keep other installers unchanged. Shared module behaviour outside this pair requires revised approval. STOP HERE; do not start automatically.
