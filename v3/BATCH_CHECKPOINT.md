# Rebuild checkpoint — batch 1

Branch: `v3-groundup`.
Approved scope: Sideline + ISS Console only.
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
