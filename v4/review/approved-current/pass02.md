# Pass 2 — Stow clicked source and startup lifetime

Problem: delayed ownership used the later display container, and disposal could leave a native worker starting after closure.
Correction: capture the exact click source; a source change cancels unsent startup, including A → B → A. Recheck immediately after ownership and before handoff. Native bridge owns cancellation before submission and preserves UNKNOWN after submission; already-submitted A remains A even when the display changes.
Origin: Stow read mutable display state inside the awaited ownership callback; worker bridge lacked the same late-owner lifetime guard. V2 location/controls retained. Shared worker bridge covers move and unbind without changing held hierarchy concurrency policy (pass 6).
Verification: 27 source/generated installer fixtures pass. Delayed owner/source change/closure create no request or new ledger, waiting frame removed, confirmed movement still prints once, disposal preserves UNKNOWN and prevents replay. Candidate Stow 0.1.2. Historical offline reproductions and evidence coverage are in the original current-state review; these are simulated native outcomes, not live movement proof.
Status: correction offline verified. Existing empty-container contract gap and native auth/movement/print live gates remain; installer remains PARTIAL. Publication held.
