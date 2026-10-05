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
