# Pass 4 — native Sideline Stop during startup

Problem: QTY/Clear did not own cancellation until after bootstrap, so Stop could be lost and a later quantity/close submitted.
Correction: accepted action owns its lifecycle before awaiting the lock/bootstrap; startup signal reaches bootstrap, guards run after waits, and one owner prevents a second click scheduling another action. Native form helpers act only once the owner has its ledger row. Stop cancels unsent startup; submitted work remains observed and UNKNOWN is retained on disposal.
Origin: native perform() created owner after bootstrap. This same implementation handles QTY, Clear and native date assistance; ordinary native date and typed mutation proof preserved. No retries/extra delay added.
Verification: four original QTY/Clear delayed-owner/bootstrap failures reproduced. Original duplicate-start fixture stalled and was terminated, recorded in results; new implementation settles it. 50 source/generated Sideline normal/cancellation/expiry cases pass, including generated late-bootstrap Stop/closure, normal native QTY/Clear/date and submitted disposal quarantine. Sideline 0.1.6 built; ISS does not bundle sideline-native and is unaffected by this item.
Status: offline verified; native timing/live mutations remain acceptance gates. Publication held.
