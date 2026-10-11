# Pass 8 — RIVER rendered native-control readiness

Status: COMPLETED — OFFLINE VERIFIED. Current candidate RIVER 0.1.3 includes the approved shared rendered-control definition from pass 9. Publication and live actions remain held.

PRESERVE: native step order, AU route and handoff ownership, one capture control, exact PO/quantity payload, native setters/events and final manual gates.
FAILURES: a control in a CSS-hidden native ancestor must not be filled or clicked; detached/replaced controls must not consume a Next submission.
STATE: the existing assistant owns its active/cancelled step and readiness waits; no new workflow/cache/poller.
SUCCESS: a connected, rendered, enabled current native control permits one existing action. This proves script handoff only, not native backend success.
UNKNOWN: the existing submitted-Next barrier remains; no uncertain action is retried.
RESET: Stop/Clear cancels pending readiness/frame work before further writes/Next; disposal preserves handoff payload.
DEPENDENCIES: real browser layout, current native form/heading DOM and cross-origin GM handoff remain live gates.

Implemented: reproduced source/installer ancestor-hidden behavior, require native rendered geometry/connection, revalidate an awaited Next control before submission, and cover visibility hydration/replacement/Stop in the ordinary test glob. The later approved pass 9 shares the minimal canonical rendered-control check with Carton; no extra observer, timer or workflow was introduced. Root owns versions/build/checkpoints.

## Candidate verification
RIVER was initially selectively rebuilt at 0.1.2; its final 0.1.3 candidate uses the shared rendered check and was rebuilt from canonical source in an isolated staging copy. Actual source and generated installer checks: 16 passed, zero failed (river + river-readiness). The four previously failing readiness cases now pass. No native ticket action was performed. Publication is held.
