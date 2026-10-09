# MoveContainer / Dropzone contract

Evidence: V2 Dropzone 0.3.4 and Stow/Actions source, BASELINE F02/F03/F08. V2's broad 2xx acknowledgement is insufficient under the current brief.

PRESERVE: native MoveContainer dark bottom-right panel; PRIME default, P1–P4 and exact dropzones; automatic selected destination at the native destination prompt; queue input ON/OFF, scan/paste, RUN/PAUSE/CLEAR DONE/CLEAR ALL, invalid container display, Alt+= hide/show. Native input automation targets exactly one native field, never body keyboard events.

STATE: one durable queue, browser-owned batch lock, immutable destination per queued row. SUBMITTED persisted before API call; UNKNOWN remains visible/non-runnable after Pause/Clear/reload. Current identity is read from authenticated app, never old cache. RESET: Pause never aborts a submitted move; Clear waits for its result and retains UNKNOWN. Dispose records UNKNOWN before abort.

SUCCESS: authenticated complete native FCR inventory readback, nonempty exact container rows, every outerLocation exactly equals requested destination. API 2xx only means request accepted for verification, never movement proof. Unknown/pending/contradictory/redirect/error responses cannot be confirmed. One mutation call only; no retry. Read-only retries are bounded by the verified reader.

UNKNOWN: unavailable/incomplete/mixed location readback; empty containers cannot be proven by inventory and remain a known parity gate requiring a captured native hierarchy/location schema. Preflight fails before mutation when reliable readback is unavailable. No fabricated positive API response contract.

DEPENDENCIES: native MoveContainer endpoint, authenticated FCR native POSTs (configured host), current native identity, GM and Web Locks; all capabilities bundled; OBS optional. Two native FCR reads per eligible move are a correctness cost, not a measured performance improvement. No live inventory action authorised. Live gates: FCR auth/outerLocation semantics, native auto-destination field, acknowledgement, scanner speed/long batches, empty-container location evidence.
