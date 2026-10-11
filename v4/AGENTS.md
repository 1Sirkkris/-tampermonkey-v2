# V4 working boundaries

Read `BRIEF.txt` and `BASELINE.md` before implementation. The user's current V4 brief is authoritative.

- Active branch: `v4-cleanroom`. V2 `main` and V3 `v3-groundup` are read-only references.
- New work stays under `v4/`. Inherited V2 root scripts/libraries are reference files, not V4 runtime dependencies. Do not edit or import them.
- Start each workflow with its behaviour contract: PRESERVE, FAILURES, STATE, SUCCESS, UNKNOWN, RESET, DEPENDENCIES.
- Do not use V3 architecture, source structure, UI or state as a base. Recover evidence and test cases independently.
- Preserve proven native locations, controls, scan/keyboard/default/quantity/expiry/Stop/Clear/recovery behaviour. Ask only before a material user-facing change.
- No sub-agents unless the user explicitly authorises them.
- One script or logically coupled major workflow per recovery unit. Validate, commit, push and confirm remote SHA before the next unit. Push partial checkpoints when risk, uncertainty or duration warrants it.
- Checkpoint commits use `[checkpoint] <workflow> <state>`. Never force-push, squash away or otherwise rewrite recovery history.
- After a checkpoint report only CHECKPOINT / SHA / STATUS / VERIFIED / NEXT. Normal implementation continues without checkpoint approval.
- Stop if progress hangs or repeatedly fails. Push valid work before reporting the exact blocker and last verified remote SHA.
- Do not call mocked/offline verification live proof. Never retry a mutation with an uncertain outcome or hide its recovery state.

Keep `CHECKPOINT.md` current so recovery does not depend on chat history. Its commit is the checkpoint SHA; do not embed a self-referential SHA in the file.

## 10 October universal recovery timestamp rule
The latest user instructions require every checkpoint/progress update to include actual current Sydney local time from the system clock, format YYYY-MM-DD HH:mm:ss AEST/AEDT (Australia/Sydney, DST aware). Record creation and confirmed push/readback times separately in CHECKPOINT.md; never infer push time from commit time. Aim for 10 minute saves; never intentionally exceed 15. Record elapsed time from latest successful push when available. Chat: CHECKPOINT | SYDNEY TIME | SCRIPT | STATUS | TESTS | SHA | NEXT. Preserve WIP/tests and known-good installers; expected-parent non-force push and remote readback required.

## Earlier published approval scope — historical, 11 October 2026
The user approved the thirteen numbered audit passes. Issue 7 explicitly keeps manual Hazmat recheck always available; missing/incomplete automatic rechecks are capped at two. Issue 13 explicitly preserves today +900 calendar days. The issue 12 follow-up selected “Keep automatic collapse”. These current instructions lift the earlier runtime-edit hold for the approved passes. Preserve all other native contracts and UNKNOWN barriers. The user subsequently approved committing and pushing the concrete tested result on 11 October at 08:20 AEDT. That concrete earlier batch was published and verified at 1e9c610; this is historical authority, not permission to publish later changes. No live operational action or production acceptance is authorized. This record supersedes the historical uncertainty below in CHECKPOINT.md.

## Earlier 19-pass decision — historical, 2026-10-11
Approved scopes and explicit holds are in `review/approved-current/README.md`. Passes 2–5, 7–9, 11–18 have been implemented and verified offline; 19 maintains records. This decision lifts the audit-only restriction only for those scopes. Passes 1/6/10 remain HELD for discussion. GitHub publication, deployment and live actions remain HELD. Local commits/private review checkpoints preserve work without publication. Parallel workers were authorised; root owns builds/version/checkpoints. Never apply older dirty work wholesale. The README and top CHECKPOINT record take precedence over historical instructions below.

## New approval — 2026-10-11 12:12:57 AEDT
The user replied "approved" to fresh passes 1, 6, 10 and separate publication of the tested batch. Those corrections and GitHub checkpoints are now authorised; deployment and all live operational/printing actions remain held. Preserve existing verified implementations. First publish the previously verified 15-pass batch, then independently verify/checkpoint 1, 6, 10; WIP source may be saved with known-good installers intact. Root owns versions/builds/publication and expected-parent non-force updates.

## Current completion — 2026-10-11 12:30:29 AEDT
All18 fresh approved code passes1–18 are offline verified and checkpointed;19 maintains current recovery/readiness.537tests pass;19exact installers and71source syntax/independence checks pass. No operational WIP. The earlier holds for1/6/10/publication are superseded by explicit approval and confirmed checkpoints. Remaining implementation requires absent empty-container location and extra AFT Confirm contracts; live operations/printing/deployment remain held. Use current CHECKPOINT and README for actual candidate versions/readiness/NEXT.
