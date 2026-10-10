# Native Bind / Unbind contract

Evidence: V2 Bind_Hierarchy_Queue 0.3.0 / Unbind 1.1.6 and Actions Core 0.1.3; BASELINE F01/F08/F13. One canonical engine, separate native-route installers; no competing Unbind. Bind remains BWU2 → BWU1.

PRESERVE: native page queue; scan/paste containers, START/PAUSE/CLEAR, running scanner Enter, endless additions, clear for next batch, minimize/hide; persisted queued/done/attention outcomes. Bind's first native destination/validation/summary/double-scan captures real source/destination warehouse tokens; later rows use the validated native payload. No guessed opaque tokens.

STATE: durable V4-only rows and draft; one browser-owned hierarchy lock for entire batch (no expiry). QUEUED/READING are unsubmitted; SUBMITTED is persisted before a mutation call; reload converts only SUBMITTED to UNKNOWN. Clear retains SUBMITTED/UNKNOWN; duplicates cannot re-add unresolved containers. Pause cancels preflight but never discards submitted work. No automatic unknown replay.

SUCCESS: validated BWU2 + exact container, native summary schema, correlated native mutation response with nonempty hostName and no contradictory failure — the explicit V2 backend acknowledgement contract, not HTTP status alone. This remains a live acceptance gate; no physical hierarchy readback is claimed. Native Bind capture also validates BWU1 token correlation.

UNKNOWN: network/timeout/redirect/login/malformed/contradictory mutation response, lost acknowledgement and reload remain visibly quarantined; batch pauses. REJECTED requires explicit structured rejection. No blind retry. RESET: Clear cannot erase unresolved submissions; disposal persists UNKNOWN before releasing owner; read-only preflight is safely queueable again.

DEPENDENCIES: native hierarchy HTTPS/JSON/scanner fields/body controls, current authenticated identity and browser Web Locks. Missing identity/lock/native fields prevents submit. OBS optional. Bound request waits only; native scanner key cadence preserves the V2 2ms sequence, not queue timing sleeps. No background token-refresh traffic: each run/row revalidates current session; idle renewal remains an acceptance gate.

Live gates: native identity, first Bind scanner/template capture, exact backend acknowledgement, long idle/repeated batches, reload and cross-tab ownership. No live action authorised by offline fixtures. Canonical scoped CSS; native interface remains in place.

## Scanner/startup recovery correction — Bind/Unbind 0.1.2
Preserve source/destination scanner workflows, native queue location/style/API payloads, journal phases and one browser owner. Add consumes only its captured input; appended/replaced scans received during owner acquisition remain in visible/session draft. Start is tracked before Add/owner acquisition and disabled immediately against duplicate Run. Pause/Clear/disposal invalidate startup before native submission; Pause retains queued rows for a later deliberate Start, Clear awaits startup/active submitted settlement then retains only unresolved rows. Disposed startup may not later write the ledger or erase the saved draft. Actual-source tests first reproduce scanner loss, mutation after early Pause and late ledger writes; generated Bind and Unbind 123START/Pause/Clear cases require zero native requests. Already submitted results settle under the existing owner; UNKNOWN remains non-runnable across Clear/reload.
