# Unified live evidence capture

Install `DIAG_v0.2.0_Unified_Live_Evidence_Capture.user.js` for the next internal-site validation shift. It runs only on the Sideline, AFT QualityTools, MoveContainer, and FCResearch hosts already used by this repository.

## Privacy and safety

- Request headers and sensitive response headers, cookies, credentials, and browser tokens are never collected. Only response `Content-Type` is retained.
- Known identifier fields and common container/pod values are replaced with deterministic fingerprints. The same value remains correlatable inside one export without exposing the value.
- Captures stay in memory and same-tab `sessionStorage`. Clear removes the current origin's capture.
- The default is **METADATA ONLY**: transport, method, sanitized URL, result, timing, safe sizes, duplicate signatures, and errors. No request or response bodies are stored or exported.
- In metadata-only mode, response text is inspected locally and then discarded only for the exact `/results/inventory` and `/inventory-more` paths. The bounded inspection records `Quantity (N)`, row count, literal `hasNext`, continuation presence (never its value), truncation/incomplete flags, and whether the first following `/inventory-more` failed. Unknown shapes remain `null` and flagged incomplete; raw content never enters events, storage, summaries, clipboard output, downloads, logs, or error text.
- **Enable detail** is an explicit, same-tab-session opt-in. It captures redacted, size/depth/item-capped bodies only for the listed Sideline, AFT, Dropzone, and Bin workflow endpoints. Disabling detail removes captured bodies from the session. The panel and export always state the current mode and allowlist.
- The diagnostic observes normal work. It does not send requests, click controls, or alter payloads.

## One-shift checklist

Use **Mark** before each case, perform the normal workflow once, then use **Copy** or **Download**. Export before changing to a different host.

Stay in **METADATA ONLY** for request duplication, timing, observer, polling, and lifecycle evidence. Enable detail only immediately before a case that needs request/response structure evidence, confirm the panel says **DETAIL ON**, then disable it after that case. Review every export before sharing.

### Sideline

1. Open a source container, then close it through the native **Change container** flow: one non-empty/No result and one empty/Yes result if safe.
2. Scan a normal source container and one customer-bound source that the site rejects.
3. Run one normal item lookup and one invalid/not-in-source item lookup.
4. Capture one successful move, one Predicant/rescan-destination response, and one incompatible destination response.
5. Capture a damaged destination response and the subsequent resume using a different destination.
6. If `/api/close-container` appears, include one success and one ordinary failure. Do not manufacture a failure.

### AFT Edit/SKU/Move

1. Mark and perform one normal native quantity-bearing MoveItems workflow without the helper changing quantity behavior.
2. Capture the initial page, `/status`, `/action`, `/end`, objectId transitions, quantity screen, Verify Item edge, and normal completion.
3. For quantity replacement research, capture only the native workflow the site already performs. Do not invent an action name or payload.
4. Include one normal backend validation/error response if it naturally occurs.

### Dropzone

1. Capture initial render and each visible state: idle, prepared, running, paused, attention/error, resumed, completed, clear-done, and clear-all.
2. Capture one successful `/api/move-container` request and one naturally occurring non-2xx/network error if available.
3. Note whether state survives refresh and whether the renderer matches stored queue state after each transition.

### Bin Overlay

1. Capture representative hierarchy calls for at least one P2, P3, and P4 pod.
2. Include an unknown/empty hierarchy result and a normal retry if naturally available.
3. Record row count, unique pod count, request count, duplicate request signatures, durations, and observer mutation summaries.

## What to return

Return the exported text files plus a short note mapping each manual marker to the expected outcome. The export already summarizes duplicate request signatures, failures, durations, resources, long tasks, and DOM mutation volume.

Do not send screenshots containing customer, associate, shipment, container, or product identifiers unless separately redacted.
