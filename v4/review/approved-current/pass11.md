# Pass 11 — SIM lifetime cleanup

Problem: closed snippet dialogs and cancelled file inputs stayed in the toolbar's owned-node collection and retained handlers.
Correction: one canonical release path removes tracking, node and handlers; file inputs own and cancel their reader, preventing late storage writes. Replaced native editor toolbars use the same release path. Existing snippets, merge choice and one-time automatic collapse are preserved.
Origin: owned Set was cleared only on route disposal. V2 behaviour informed the controls, not this retention defect. Original whole-suite report contains history/OBS coverage; OBS does not prove browser heap behaviour.
Verification: 20 source/generated installer fixtures passed, including 25 repeated closures/cancellations, replacement, normal save/merge, parse/read errors and delayed FileReader disposal. Candidate SIM 0.1.2. Five installer regressions failed against the old candidate and now pass. Results: private implementation review results/pass11.txt.
Status: offline correction verified. Native SIM markup/download acceptance remains pending; no publishing or live action. GitHub publication held.
