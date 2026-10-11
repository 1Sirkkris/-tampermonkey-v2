# Pass 5 — ISS cancelled startup

Problem: a late console owner callback could create a worker after Stop/closure; waiting health/load work could continue after cancellation.
Correction: each accepted console run owns its startup cancellation. Guard before ledger/peer access after ownership; pass cancellation through readiness. One peer owns its frame/load handler/health waiters; per-caller cancellation releases the frame when nobody needs it. Closure cannot create/reconnect peers; Clear rechecks disposal after ownership. After native handoff, Stop still observes submitted work and preserves UNKNOWN records.
Origin: console checked Stop only after ready(), bridge peer() had no disposed guard, shared ready Promise had no cancellable ownership, load listener outlived cancelled startup. Familiar three-area UI and native operation paths unchanged.
Verification: six failures reproduced against the prior parent/generated candidate (one cancellation case already repaired by worker WIP). All seven new cases plus retained normal/spoofed/timeout/Stop/Clear/submitted-UNKNOWN cases pass; combined Sideline/ISS/suite 72 pass. Actual ISS 0.1.6 installer verifies late-owner Stop/closure. No live native action.
Status: correction offline verified; ISS remains PARTIAL for pre-existing AFT confirmation contract gap and live acceptance. Publication held.
