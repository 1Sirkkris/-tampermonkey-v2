# Rebuild checkpoint — remaining batches complete

Branch: `v3-groundup`.
Current scope: all six remaining scripts explicitly approved by the user on Oct 5, 2026, after batch 5. This later authorization covers the three remaining pairs without another approval request; future changes still require their own scope. Batches 1–5 history follows.
Status: all fourteen installers have completed scoped recovery reviews and automated validation. Live Amazon testing remains pending. STOP HERE; do not initiate further changes automatically.

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

## Batch 5 checkpoint — superseded by all-remaining approval

PO Portal + Carton PrEditor. Review their native interaction and request contracts against V2, rebuild within this pair and verify the other installers remain unchanged. STOP HERE; require explicit user reapproval before implementation.


## Remaining approval — PO Portal + Carton PrEditor; Calm Code + SIM Toolbar; OBS + Screenshot Mode

The user explicitly approved all six remaining scripts on Oct 5 at 12:59 Sydney time. This supersedes the preceding request for just PO Portal + Carton and permits completing these three pairs without reapproval. No delegation was used. V2 main remains untouched. Only these six installers differ from the publication parent; the eight earlier installers remain byte-identical. Concurrent SIM updates through 0.2.8, including window-capture pointer tracking and final-release row detection, were merged and preserved.

Delivered: PO Portal, Carton PrEditor, Calm Code, OBS and Screenshot Mode 0.2.1; SIM Toolbar 0.2.9. All fourteen installers have now received their scoped review; this is not proof of live fleet correctness or a claim that every historical log was re-read in this final batch.

PO Portal preserves V2's local-calendar formatting, clamped six-month month-end default and valid ordered date range. Its Lite headers use word boundaries, avoiding an unrelated Recipient column being mistaken for Rec. A stable document-body observer supports native result subtree replacement without polling or fragile reattachment. Search request parameters and Lite/Full controls remain native.

Carton still requires two scans and a ready native Complete button, with one click per barcode and reset on count decrease. Saved ON/OFF must load before any automatic click, eliminating startup submission despite a persisted OFF. Read failure defaults to OFF; teardown stops scheduled inspection. Native markup replacement remains observed, and textContent is a fallback where innerText is unavailable. No keyboard fallback or automatic mutation replay was introduced.

Calm preserves the eleven V2 role shortcuts and native location. It targets only the form owning the enabled native calmCode input, checks field retention and form validity, and suppresses a rapid double click. It cannot fall back to an unrelated first form.

SIM formatting follows the last focused native editor and rejects disabled/readonly/assistant inputs. Ambiguous unfocused editors are not guessed. Rich-text wrapping now includes the selected text, prefix and suffix, with native insertText where supported and a Range fallback. Invalid persisted snippets are filtered and failed initialization can retry. Range selection rescans by ticket identity through synchronous React row replacement. It uses individual native checkbox changes rather than a master-checkbox operation that could select unrelated/new rows or ignore a failed bulk settle. This removes the animation-frame polling loop. Existing numbering, open tabs, drag/window capture and outside-row selection are retained.

OBS is one collector in both native pages and worker frames, so canonical operation events include GM-backed mutations in those workers. Fetch/XHR hooks record only native mutation start/result or read failures, with correlation, HTTP status and elapsed time. They preserve original arguments, return values, errors and native response objects, do not read request bodies/headers, and restore or become inert on disposal. HTTP202/2xx is merely network evidence and is never classified as a confirmed mutation. Other userscripts' private GM calls are not globally interceptable: canonical V3 operation telemetry is the source of their mutation outcomes.

Collector writes serialize and retain their pending batch on storage failure. A shared clear generation prevents other contexts or delayed old events from restoring cleared history, while new events survive. Exports sanitize query strings/credentials even on legacy data, report save failures/drops and preserve chronological order. Queued and per-context events are bounded at 6000; context retention is three days/4096 contexts, with pruning on a context's first saved batch and explicit export rather than an idle timer. Shards permit independent contexts to write without replacing another context's array. Export requires current pending logs to save successfully; failures remain visible. Persistent storage denial at teardown cannot guarantee saving an in-memory batch.

Screenshot Mode keeps the single CSS marker approach, hides later-added marked UI and SIM row-number pseudo-elements, and restores existing styles unchanged. Repeated keydown cannot toggle multiple times while Ctrl+Q is held. Duplicate installation and iframe handling are guarded. OBS/Screenshot now also cover the native measurement page.

Full `npm run verify` passed, including `tests/remaining.test.mjs`: local month-end/date validation and replacement tables; saved Carton OFF, count latch and native readiness; Calm owning-form and double click; focused and rich-text SIM editors, selection through React replacement and preserved outside selection; failed OBS save/retry, cross-context Clear isolation, credential redaction, canonical operation outcomes from a real iframe realm into shared storage, native fetch/XHR argument/response passthrough and hook disposal; Screenshot repeat and restoration. Earlier batch regressions and all fourteen generated-installer startups pass.

## Final checkpoint

No scripts remain for this scoped recovery review. Real Amazon authentication, deployed markup, regional token acceptance and end-to-end workflows remain unproven. Next action: install/update the V3 set, keep duplicate V2 workers disabled, and run native workflow smoke tests while OBS is enabled. Investigate runtime evidence only after a new user request; do not change further scripts automatically.
