# Tampermonkey V3 rebuild boundaries

The user requires a ground-up V3: V2 specifies behaviour; Restructure 1.0 is an unproven design reference; previous V3 work supplies evidence, not an automatically approved implementation. Preserve native tool locations and familiar controls. Do not centralise every UI in FCResearch.

## Approval and stop rules

- Work on only the 1–2 scripts named in the current approved batch.
- Count behaviour changes in other installers caused by shared modules as additional scripts. Obtain approval before expanding that scope.
- Read-only history/code/log review is authorised across the fleet. This does not authorise implementation outside the batch.
- At each completed batch, report changed scripts and versions, verified behaviour, unproven runtime behaviour, and the proposed next 1–2 scripts. End the turn and wait for explicit approval.
- An earlier full-fleet approval does not override this batch boundary.
- On a STOP or PAUSE instruction, stop initiating work. Do not continue the batch in the background or automatically resume it.
- Do not delegate to other agents without explicit authorisation.

## Delivery and evidence

- Use OBS and prior working V2 behaviour to explain regressions; do not assume a newer revision works.
- Keep one authoritative engine for compatible actions. Native interfaces may have different controls.
- No mutation retry after an uncertain outcome. Preserve UNKNOWN barriers through stop, reset and reload.
- Keep V2 main separate. Commit approved V3 changes on the selected V3 branch; do not replace V2 with an unproven candidate.
- Verify reproducible installers and meaningful regression cases. Automated fixtures do not prove live Amazon operation.
- Keep the current batch state in v3/BATCH_CHECKPOINT.md. Do not silently start its proposed next batch.
